import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildPremiumPoints, summarizePremium } from '../public/assets/etf-premium-core.js';

const root = resolve(import.meta.dirname, '..');
const registryPath = resolve(root, 'public/data/etf-premium/registry.json');
const args = parseArgs(process.argv.slice(2));
const MAX_NAV_LAG_DAYS = 7;
const REQUEST_TIMEOUT_MS = 15000;
const RETRY_DELAYS = [0, 1000, 2500, 5000];

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

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function parseDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
}

function positiveNumber(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function marketPrefix(etf) {
  return etf.market === 'SH' ? 'sh' : 'sz';
}

function eastmoneySecid(etf) {
  return `${etf.market === 'SH' ? 1 : 0}.${etf.code}`;
}

function completedDateLimit() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return formatter.format(new Date());
}

async function fetchWithRetry(url, options = {}) {
  let latestError;
  for (const delay of RETRY_DELAYS) {
    if (delay) await sleep(delay);
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: '*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; dca-calculator-data-update/1.0)',
          ...options.headers
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      latestError = error;
    }
  }
  throw new Error(`${latestError?.message || '请求失败'}：${url}`);
}

async function fetchEastmoneyPrice(etf) {
  const query = new URLSearchParams({
    secid: eastmoneySecid(etf),
    klt: '101',
    fqt: '0',
    lmt: '100000',
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
  });
  const response = await fetchWithRetry(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${query}`);
  const payload = await response.json();
  if (payload?.rc !== 0 || !Array.isArray(payload?.data?.klines)) throw new Error('东方财富行情返回结构异常');
  const today = completedDateLimit();
  return payload.data.klines.map((line) => {
    const [date, , close] = line.split(',');
    return { date: parseDate(date), close: positiveNumber(close) };
  }).filter((item) => item.date && item.date < today && item.close);
}

async function fetchSinaPrice(etf) {
  const code = `${marketPrefix(etf)}${etf.code}`;
  const query = new URLSearchParams({ symbol: code, scale: '240', ma: '5', datalen: '5000' });
  const response = await fetchWithRetry(`https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?${query}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('新浪行情返回结构异常');
  const today = completedDateLimit();
  return payload.map((item) => ({ date: parseDate(item.day), close: positiveNumber(item.close) }))
    .filter((item) => item.date && item.date < today && item.close);
}

async function fetchPrice(etf) {
  const outcomes = await Promise.allSettled([fetchEastmoneyPrice(etf), fetchSinaPrice(etf)]);
  const eastmoney = outcomes[0].status === 'fulfilled' ? outcomes[0].value : null;
  const sina = outcomes[1].status === 'fulfilled' ? outcomes[1].value : null;
  if (!eastmoney && !sina) {
    throw new Error(`行情主备源均失败：${outcomes.map((item) => item.reason?.message).filter(Boolean).join('；')}`);
  }
  if (eastmoney && sina) validatePriceAgreement(etf, eastmoney, sina);
  return {
    rows: eastmoney || sina,
    provider: eastmoney ? 'eastmoney' : 'sina',
    verifiedBy: eastmoney && sina ? 'sina' : null
  };
}

function validatePriceAgreement(etf, primary, secondary) {
  const secondaryMap = new Map(secondary.map((item) => [item.date, item.close]));
  const common = primary.filter((item) => secondaryMap.has(item.date)).slice(-5);
  if (!common.length) return;
  for (const item of common) {
    const other = secondaryMap.get(item.date);
    const difference = Math.abs(item.close / other - 1);
    if (difference > .005) {
      throw new Error(`${etf.code} 行情源校验不一致：${item.date} ${item.close} / ${other}`);
    }
  }
}

function timestampToShanghaiDate(value) {
  return new Date(Number(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchStaticNav(etf) {
  const response = await fetchWithRetry(`https://fund.eastmoney.com/pingzhongdata/${etf.code}.js?time=${Date.now()}`, {
    headers: { Referer: `https://fund.eastmoney.com/${etf.code}.html` }
  });
  const text = await response.text();
  const match = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('天天基金静态净值中未找到 Data_netWorthTrend');
  const rows = JSON.parse(match[1]).map((item) => ({
    date: timestampToShanghaiDate(item.x),
    nav: positiveNumber(item.y)
  })).filter((item) => item.date && item.nav);
  if (!rows.length) throw new Error('天天基金静态净值为空');
  return rows;
}

async function fetchPagedNav(etf) {
  const query = new URLSearchParams({ fundCode: etf.code, pageIndex: '1', pageSize: '10000' });
  const response = await fetchWithRetry(`https://api.fund.eastmoney.com/f10/lsjz?${query}`, {
    headers: { Referer: `https://fundf10.eastmoney.com/jjjz_${etf.code}.html` }
  });
  const payload = await response.json();
  const list = payload?.Data?.LSJZList;
  if (!Array.isArray(list)) throw new Error('天天基金分页净值返回结构异常');
  return list.map((item) => ({ date: parseDate(item.FSRQ), nav: positiveNumber(item.DWJZ) }))
    .filter((item) => item.date && item.nav);
}

async function fetchNav(etf) {
  try {
    return { rows: await fetchStaticNav(etf), provider: 'eastmoney-static' };
  } catch (staticError) {
    try {
      return { rows: await fetchPagedNav(etf), provider: 'eastmoney-paged' };
    } catch (pagedError) {
      throw new Error(`净值主备源均失败：${staticError.message}；${pagedError.message}`);
    }
  }
}

function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"' && line[i + 1] === '"' && quoted) {
      current += '"';
      i += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else current += character;
  }
  fields.push(current);
  return fields;
}

async function readCsvFallback(path) {
  const text = (await readFile(resolve(path), 'utf8')).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift()).map((item) => item.trim().toLowerCase());
  const indexes = Object.fromEntries(['code', 'date', 'close', 'nav_date', 'nav'].map((name) => [name, headers.indexOf(name)]));
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error('ETF CSV 必须包含 code,date,close,nav_date,nav 列');
  }
  const grouped = new Map();
  for (const line of lines) {
    const fields = splitCsvLine(line);
    const code = fields[indexes.code]?.trim();
    if (!grouped.has(code)) grouped.set(code, { prices: new Map(), navs: new Map() });
    const item = grouped.get(code);
    const date = parseDate(fields[indexes.date]);
    const navDate = parseDate(fields[indexes.nav_date]);
    const close = positiveNumber(fields[indexes.close]);
    const nav = positiveNumber(fields[indexes.nav]);
    if (date && close) item.prices.set(date, close);
    if (navDate && nav) item.navs.set(navDate, nav);
  }
  return grouped;
}

function validateDataset(etf, output) {
  if (output.etfId !== etf.id || output.code !== etf.code) throw new Error(`${etf.code} 数据身份不匹配`);
  if (!Array.isArray(output.points) || output.points.length < 30) throw new Error(`${etf.code} 有效数据不足 30 条`);
  let previous = '';
  for (const point of output.points) {
    if (!Array.isArray(point) || point.length !== 6 || !/^\d{4}-\d{2}-\d{2}$/.test(point[0])
      || !(point[1] > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(point[2]) || !(point[3] > 0)
      || !(point[4] >= 1 && point[4] <= MAX_NAV_LAG_DAYS) || !Number.isFinite(point[5])) {
      throw new Error(`${etf.code} 包含无效数据点：${JSON.stringify(point)}`);
    }
    if (point[0] <= previous) throw new Error(`${etf.code} 日期未严格递增：${point[0]}`);
    previous = point[0];
  }
}

async function buildDataset(etf, csvRows) {
  let prices;
  let navs;
  let priceProvider;
  let priceVerifiedBy = null;
  let navProvider;

  if (csvRows) {
    prices = [...csvRows.prices].map(([date, close]) => ({ date, close }));
    navs = [...csvRows.navs].map(([date, nav]) => ({ date, nav }));
    priceProvider = 'csv';
    navProvider = 'csv';
  } else {
    const priceResult = await fetchPrice(etf);
    await sleep(500);
    const navResult = await fetchNav(etf);
    prices = priceResult.rows;
    navs = navResult.rows;
    priceProvider = priceResult.provider;
    priceVerifiedBy = priceResult.verifiedBy;
    navProvider = navResult.provider;
  }

  const incomingPoints = buildPremiumPoints(prices, navs, MAX_NAV_LAG_DAYS);
  if (incomingPoints.length < 30) throw new Error(`${etf.code} 本次只获得 ${incomingPoints.length} 条有效数据，拒绝更新`);
  const existing = await readExistingDataset(etf);
  const points = mergePoints(existing?.points || [], incomingPoints);
  const output = {
    schemaVersion: 1,
    etfId: etf.id,
    code: etf.code,
    frequency: 'daily',
    premiumBasis: 'previous-nav-date',
    maxNavLagDays: MAX_NAV_LAG_DAYS,
    firstDataDate: points[0]?.[0] || null,
    lastDataDate: points.at(-1)?.[0] || null,
    generatedAt: new Date().toISOString(),
    sources: {
      price: priceProvider,
      priceVerifiedBy,
      nav: navProvider
    },
    summary: summarizePremium(points),
    points
  };
  validateDataset(etf, output);
  return output;
}

async function readExistingDataset(etf) {
  const path = resolve(root, 'public', etf.dataFile.replace(/^\//, ''));
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function mergePoints(existing, incoming) {
  const merged = new Map();
  for (const point of [...existing, ...incoming]) merged.set(point[0], point);
  return [...merged.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function writeAtomically(outputs) {
  const staged = [];
  try {
    for (const { etf, output } of outputs) {
      const destination = resolve(root, 'public', etf.dataFile.replace(/^\//, ''));
      const temporary = `${destination}.tmp`;
      await writeFile(temporary, `${JSON.stringify(output)}\n`);
      staged.push({ temporary, destination });
    }
    for (const item of staged) await rename(item.temporary, item.destination);
  } catch (error) {
    throw new Error(`写入 ETF 数据失败，正式数据未完整替换：${error.message}`);
  }
}

const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const selected = args.etf
  ? registry.etfs.filter((etf) => etf.code === String(args.etf) || etf.id === args.etf)
  : registry.etfs;
if (!selected.length) throw new Error(`找不到 ETF：${args.etf}`);

const csv = args['etf-file'] ? await readCsvFallback(args['etf-file']) : null;
const outputs = [];
for (const [index, etf] of selected.entries()) {
  console.log(`[${index + 1}/${selected.length}] 更新 ${etf.name}（${etf.code}）`);
  const csvRows = csv?.get(etf.code);
  if (csv && !csvRows) throw new Error(`CSV 中没有 ${etf.code} 的数据`);
  const output = await buildDataset(etf, csvRows);
  outputs.push({ etf, output });
  console.log(`  ${output.points.length} 条，${output.firstDataDate} 至 ${output.lastDataDate}，价格 ${output.sources.price}，净值 ${output.sources.nav}`);
  if (!csv && index < selected.length - 1) await sleep(700);
}

await writeAtomically(outputs);
console.log(`ETF 溢价数据更新完成：${outputs.length} 只`);
