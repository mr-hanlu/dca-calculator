function monthOf(date) {
  return date.slice(0, 7);
}

function sampleDeviation(values) {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function commonRange(series) {
  if (series.length < 2) throw new Error('请至少选择两个指数');
  return {
    start: series.map((item) => monthOf(item.points[0][0])).sort().at(-1),
    end: series.map((item) => monthOf(item.points.at(-1)[0])).sort()[0]
  };
}

export function compareIndices(series, startMonth, endMonth) {
  if (series.length < 2) throw new Error('请至少选择两个指数');
  if (startMonth > endMonth) throw new Error('开始月份不能晚于结束月份');

  const prepared = series.map((item) => {
    const points = item.points.filter(([date]) => {
      const month = monthOf(date);
      return month >= startMonth && month <= endMonth;
    });
    if (!points.length) throw new Error(`${item.name}在所选区间没有数据`);
    return { ...item, points, byMonth: new Map(points.map(([date, close]) => [monthOf(date), close])) };
  });

  const months = prepared[0].points.map(([date]) => monthOf(date)).filter((month) =>
    prepared.every((item) => item.byMonth.has(month))
  );
  if (!months.length) throw new Error('所选指数没有共同月份数据');

  const results = prepared.map((item) => {
    const prices = months.map((month) => item.byMonth.get(month));
    const first = prices[0];
    let peak = first;
    const values = prices.map((price) => {
      peak = Math.max(peak, price);
      return {
        normalized: price / first * 100,
        drawdown: price / peak - 1
      };
    });
    const returns = prices.slice(1).map((price, index) => price / prices[index] - 1);
    const totalReturn = prices.at(-1) / first - 1;
    return {
      id: item.id,
      name: item.name,
      shortName: item.shortName,
      currency: item.currency,
      values,
      stats: {
        totalReturn,
        annualizedReturn: prices.length > 1 ? (prices.at(-1) / first) ** (12 / (prices.length - 1)) - 1 : 0,
        maxDrawdown: Math.min(...values.map((value) => value.drawdown)),
        annualizedVolatility: sampleDeviation(returns) * Math.sqrt(12)
      }
    };
  });

  return { months, series: results };
}
