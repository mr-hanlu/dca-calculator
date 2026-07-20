import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPremiumPoints, quantile, summarizePremium } from '../public/assets/etf-premium-core.js';

test('溢价率只使用交易日前最近一期净值', () => {
  const points = buildPremiumPoints([
    { date: '2026-07-02', close: 1.1 },
    { date: '2026-07-03', close: 1.2 }
  ], [
    { date: '2026-07-01', nav: 1 },
    { date: '2026-07-02', nav: 1.1 },
    { date: '2026-07-03', nav: 1.5 }
  ]);

  assert.deepEqual(points, [
    ['2026-07-02', 1.1, '2026-07-01', 1, 1, 10],
    ['2026-07-03', 1.2, '2026-07-02', 1.1, 1, 9.0909]
  ]);
});

test('净值滞后超过上限时排除数据点', () => {
  const points = buildPremiumPoints(
    [{ date: '2026-07-10', close: 1.2 }],
    [{ date: '2026-07-01', nav: 1 }],
    7
  );
  assert.deepEqual(points, []);
});

test('历史分位和分位数计算稳定', () => {
  const points = [1, 2, 3, 4, 5].map((rate, index) => [
    `2026-07-0${index + 1}`, 1, `2026-06-3${index}`, 1, 1, rate
  ]);
  assert.equal(quantile([1, 2, 3, 4, 5], .25), 2);
  assert.deepEqual(summarizePremium(points), {
    count: 5,
    latest: 5,
    percentile: 100,
    minimum: 1,
    p10: 1.4,
    p25: 2,
    median: 3,
    p75: 4,
    p90: 4.6,
    maximum: 5
  });
});
