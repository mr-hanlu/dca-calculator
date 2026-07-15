import test from 'node:test';
import assert from 'node:assert/strict';
import { commonRange, compareIndices } from '../public/assets/compare-core.js';

const a = {
  id: 'a', name: '指数A', shortName: 'A', currency: 'USD',
  points: [['2020-01-31', 100], ['2020-02-29', 120], ['2020-03-31', 90]]
};
const b = {
  id: 'b', name: '指数B', shortName: 'B', currency: 'CNY',
  points: [['2019-12-31', 50], ['2020-01-31', 50], ['2020-02-29', 55], ['2020-03-31', 60]]
};

test('共同区间取所选指数最晚开始和最早结束月份', () => {
  assert.deepEqual(commonRange([a, b]), { start: '2020-01', end: '2020-03' });
});

test('对比序列统一以首月为100并计算区间涨幅', () => {
  const result = compareIndices([a, b], '2020-01', '2020-03');
  assert.deepEqual(result.months, ['2020-01', '2020-02', '2020-03']);
  assert.equal(result.series[0].values[0].normalized, 100);
  assert.equal(result.series[0].values[2].normalized, 90);
  assert.equal(result.series[1].values[2].normalized, 120);
  assert.ok(Math.abs(result.series[1].stats.totalReturn - 0.2) < 1e-12);
});

test('历史回撤使用此前最高点计算', () => {
  const result = compareIndices([a, b], '2020-01', '2020-03');
  assert.equal(result.series[0].values[1].drawdown, 0);
  assert.equal(result.series[0].values[2].drawdown, -0.25);
  assert.equal(result.series[0].stats.maxDrawdown, -0.25);
});
