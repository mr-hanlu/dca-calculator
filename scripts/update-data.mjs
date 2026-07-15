import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const registryPath = resolve(root, 'public/data/indices.json');
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    result[key] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return result;
}

function parseDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return null;
}

function number(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function toCompletedMonthly(rows) {
  const byMonth = new Map();
  for (const row of rows) {
    if (!row.date || !row.close || row.date.slice(0, 7) >= currentMonth()) continue;
    const month = row.date.slice(0, 7);
    const previous = byMonth.get(month);
    if (!previous || row.date > previous[0]) byMonth.set(month, [row.date, row.close]);
  }
  return [...byMonth.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

function mergeMonthly(existing, incoming, inceptionDate) {
  const merged = new Map();
  for (const point of [...existing, ...incoming]) {
    if (point[0] >= inceptionDate) merged.set(point[0].slice(0, 7), point);
  }
  return [...merged.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (compatible; dca-calculator-data-update/1.0)'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'dca-calculator-data-update/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

async function fetchNasdaq(index) {
  const end = new Date().toISOString().slice(0, 10);
  const base = `https://api.nasdaq.com/api/quote/${index.source.symbol.toLowerCase()}/historical`;
  const pageSize = 5000;
  const rows = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const query = new URLSearchParams({
      assetclass: 'index',
      fromdate: index.inceptionDate,
      todate: end,
      limit: String(pageSize),
      offset: String(offset)
    });
    const payload = await fetchJson(`${base}?${query}`);
    if (payload?.status?.rCode !== 200 || !payload?.data?.tradesTable?.rows) {
      throw new Error(`Nasdaq 返回异常：${JSON.stringify(payload?.status || payload)}`);
    }
    total = payload.data.totalRecords;
    const page = payload.data.tradesTable.rows;
    rows.push(...page.map((row) => ({ date: parseDate(row.date), close: number(row.close) })));
    offset += page.length;
    if (!page.length) break;
  }
  return toCompletedMonthly(rows);
}

async function fetchEastmoney(index) {
  const query = new URLSearchParams({
    secid: index.source.symbol,
    klt: '103',
    fqt: '0',
    lmt: '100000',
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
  });
  const payload = await fetchJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${query}`);
  if (payload?.rc !== 0 || !payload?.data?.klines) {
    throw new Error(`东方财富返回异常：${JSON.stringify(payload)}`);
  }
  const rows = payload.data.klines.map((line) => {
    const [date, , close] = line.split(',');
    return { date: parseDate(date), close: number(close) };
  });
  return toCompletedMonthly(rows);
}

async function fetchFred() {
  const csv = await fetchText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500');
  return toCompletedMonthly(parseCsv(csv));
}

function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(csv) {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift()).map((value) => value.trim().toLowerCase());
  const dateIndex = headers.findIndex((value) => ['date', '日期', 'observation_date'].includes(value));
  const closeIndex = headers.findIndex((value) => ['close', 'close/last', 'price', 'sp500', 'value', '收盘'].includes(value));
  if (dateIndex < 0 || closeIndex < 0) {
    throw new Error(`CSV 必须包含日期列和收盘列；当前列：${headers.join(', ')}`);
  }
  return lines.map((line) => {
    const fields = splitCsvLine(line);
    return { date: parseDate(fields[dateIndex]), close: number(fields[closeIndex]) };
  }).filter((row) => row.date && row.close);
}

async function readExisting(index) {
  const path = resolve(root, 'public', index.dataFile.replace(/^\//, ''));
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function updateIndex(index) {
  const existing = await readExisting(index);
  let incoming;
  let importedFrom = null;

  if (args.file) {
    incoming = toCompletedMonthly(parseCsv(await readFile(resolve(args.file), 'utf8')));
    importedFrom = resolve(args.file);
  } else if (index.source.provider === 'nasdaq') {
    incoming = await fetchNasdaq(index);
  } else if (index.source.provider === 'eastmoney') {
    incoming = await fetchEastmoney(index);
  } else if (index.source.provider === 'fred') {
    if (!existing) throw new Error(`${index.name} 缺少长期种子数据，请先使用 --file 导入完整 CSV`);
    incoming = await fetchFred(index);
  } else if (index.source.provider === 'csv' && existing && !args.index) {
    console.log(`${index.name}: CSV 手动维护，已跳过自动拉取`);
    return;
  } else {
    throw new Error(`${index.name} 使用手动 CSV 数据源，请同时提供 --index 和 --file`);
  }

  if (!incoming.length) throw new Error(`${index.name} 没有获得有效的已完成月份数据`);
  const points = mergeMonthly(existing?.points || [], incoming, index.inceptionDate);
  validatePoints(index, points);

  const output = {
    schemaVersion: 1,
    indexId: index.id,
    frequency: 'monthly',
    priceType: 'close',
    firstDataDate: points[0][0],
    lastDataDate: points.at(-1)[0],
    generatedAt: new Date().toISOString(),
    importedFrom,
    points
  };
  const outputPath = resolve(root, 'public', index.dataFile.replace(/^\//, ''));
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  index.firstDataDate = output.firstDataDate;
  index.lastDataDate = output.lastDataDate;
  console.log(`${index.name}: ${points.length} 个月，${output.firstDataDate} 至 ${output.lastDataDate}`);
}

function validatePoints(index, points) {
  if (points.length < 12) throw new Error(`${index.name} 数据不足 12 个月`);
  let previous = '';
  let previousMonth = null;
  for (const [date, close] of points) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) {
      throw new Error(`${index.name} 包含无效数据：${date}, ${close}`);
    }
    if (date <= previous) throw new Error(`${index.name} 日期未严格递增：${date}`);
    const [year, month] = date.slice(0, 7).split('-').map(Number);
    const monthNumber = year * 12 + month;
    if (previousMonth !== null && monthNumber !== previousMonth + 1) {
      throw new Error(`${index.name} 月份不连续：${previous.slice(0, 7)} 至 ${date.slice(0, 7)}`);
    }
    previous = date;
    previousMonth = monthNumber;
  }
}

const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const selected = args.index
  ? registry.indices.filter((index) => index.id === args.index)
  : registry.indices;

if (!selected.length) throw new Error(`找不到指数：${args.index}`);
if (args.file && selected.length !== 1) throw new Error('使用 --file 时必须同时指定 --index');

for (const index of selected) await updateIndex(index);
await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
