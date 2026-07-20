import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizePremium } from '../public/assets/etf-premium-core.js';

const root = resolve(import.meta.dirname, '..');
const registry = JSON.parse(await readFile(resolve(root, 'public/data/etf-premium/registry.json'), 'utf8'));
let failed = false;

const groupIds = new Set();
for (const group of registry.groups ?? []) {
  if (!group.id || !group.name || groupIds.has(group.id)) {
    console.error(`✗ 无效或重复的分组：${JSON.stringify(group)}`);
    failed = true;
  }
  groupIds.add(group.id);
}

const etfIds = new Set();
const etfCodes = new Set();
for (const etf of registry.etfs ?? []) {
  const invalid = !etf.id || !/^\d{6}$/.test(etf.code) || !['SH', 'SZ'].includes(etf.market)
    || !etf.name || !etf.manager || !etf.color || !etf.dataFile || !groupIds.has(etf.groupId)
    || etfIds.has(etf.id) || etfCodes.has(etf.code);
  if (invalid) {
    console.error(`✗ 无效或重复的 ETF 配置：${JSON.stringify(etf)}`);
    failed = true;
  }
  etfIds.add(etf.id);
  etfCodes.add(etf.code);
}

for (const group of registry.groups) {
  if (!registry.etfs.some((etf) => etf.groupId === group.id)) {
    console.error(`✗ 分组 ${group.id} 没有 ETF`);
    failed = true;
  }
}

for (const etf of registry.etfs) {
  try {
    const path = resolve(root, 'public', etf.dataFile.replace(/^\//, ''));
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (data.etfId !== etf.id || data.code !== etf.code) throw new Error('ETF 身份不匹配');
    if (data.premiumBasis !== 'previous-nav-date') throw new Error('溢价口径不匹配');
    if (!Array.isArray(data.points) || data.points.length < 30) throw new Error('有效数据不足 30 条');
    let previous = '';
    for (const point of data.points) {
      if (!Array.isArray(point) || point.length !== 6 || point[0] <= previous || !(point[1] > 0)
        || point[2] >= point[0] || !(point[3] > 0) || !(point[4] >= 1 && point[4] <= data.maxNavLagDays)
        || !Number.isFinite(point[5])) throw new Error(`无效数据点：${JSON.stringify(point)}`);
      previous = point[0];
    }
    if (data.firstDataDate !== data.points[0][0] || data.lastDataDate !== data.points.at(-1)[0]) {
      throw new Error('起止日期与数据点不一致');
    }
    const calculated = summarizePremium(data.points);
    if (JSON.stringify(calculated) !== JSON.stringify(data.summary)) throw new Error('汇总统计与数据点不一致');
    console.log(`✓ ${etf.name}: ${data.points.length} 条，截止 ${data.lastDataDate}`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${etf.name}: ${error.message}`);
  }
}

if (failed) process.exitCode = 1;
