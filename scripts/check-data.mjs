import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const registry = JSON.parse(await readFile(resolve(root, 'public/data/indices.json'), 'utf8'));
let failed = false;

for (const index of registry.indices) {
  try {
    const path = resolve(root, 'public', index.dataFile.replace(/^\//, ''));
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (data.indexId !== index.id) throw new Error('indexId 不匹配');
    if (!Array.isArray(data.points) || data.points.length < 12) throw new Error('数据不足 12 个月');
    let previous = '';
    let previousMonth = null;
    for (const point of data.points) {
      if (!Array.isArray(point) || !/^\d{4}-\d{2}-\d{2}$/.test(point[0]) || !(point[1] > 0)) {
        throw new Error(`无效数据点：${JSON.stringify(point)}`);
      }
      if (point[0] <= previous) throw new Error(`日期没有严格递增：${point[0]}`);
      const [year, month] = point[0].slice(0, 7).split('-').map(Number);
      const monthNumber = year * 12 + month;
      if (previousMonth !== null && monthNumber !== previousMonth + 1) {
        throw new Error(`月份不连续：${previous.slice(0, 7)} 至 ${point[0].slice(0, 7)}`);
      }
      previous = point[0];
      previousMonth = monthNumber;
    }
    if (index.firstDataDate !== data.points[0][0] || index.lastDataDate !== data.points.at(-1)[0]) {
      throw new Error('注册表的起止日期与数据文件不一致');
    }
    console.log(`✓ ${index.name}: ${data.points.length} 个月，截止 ${index.lastDataDate}`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${index.name}: ${error.message}`);
  }
}

if (failed) process.exitCode = 1;
