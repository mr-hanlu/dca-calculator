import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from '../public/assets/backtest-core.js';

test('首次投入与每月投入按月末点位买入', () => {
  const result = runBacktest({
    points: [['2020-01-31', 100], ['2020-02-28', 200]],
    startMonth: '2020-01',
    endMonth: '2020-02',
    initial: 1000,
    monthly: 100
  });
  assert.equal(result.principal, 1200);
  assert.equal(result.value, 2300);
  assert.equal(result.profit, 1100);
  assert.equal(result.priceReturn, 1);
});

test('日期范围会过滤范围外的数据', () => {
  const result = runBacktest({
    points: [['2020-01-31', 100], ['2020-02-28', 110], ['2020-03-31', 120]],
    startMonth: '2020-02',
    endMonth: '2020-03',
    initial: 0,
    monthly: 100
  });
  assert.equal(result.months, 2);
  assert.equal(result.timeline[0].date, '2020-02-28');
  assert.equal(result.timeline.at(-1).date, '2020-03-31');
});

test('年管理费换算为等效月费率并在相邻月份之间扣除', () => {
  const points = Array.from({ length: 13 }, (_, index) => {
    const date = new Date(Date.UTC(2020, index + 1, 0)).toISOString().slice(0, 10);
    return [date, 100];
  });
  const result = runBacktest({
    points,
    startMonth: '2020-01',
    endMonth: '2021-01',
    initial: 1000,
    monthly: 0,
    annualFee: 0.12
  });
  assert.ok(Math.abs(result.value - 880) < 1e-9);
  assert.ok(Math.abs(result.totalFees - 120) < 1e-9);
});
