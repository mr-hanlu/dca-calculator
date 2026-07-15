export function runBacktest({ points, startMonth, endMonth, initial, monthly, annualFee = 0 }) {
  const selected = points.filter(([date]) => {
    const month = date.slice(0, 7);
    return month >= startMonth && month <= endMonth;
  });
  if (!selected.length) throw new Error('所选日期范围内没有数据');

  const safeInitial = Math.max(0, Number(initial) || 0);
  const safeMonthly = Math.max(0, Number(monthly) || 0);
  const safeAnnualFee = Math.min(0.999, Math.max(0, Number(annualFee) || 0));
  const monthlyFeeRate = 1 - Math.pow(1 - safeAnnualFee, 1 / 12);
  let shares = 0;
  let principal = 0;
  let totalFees = 0;
  const timeline = [];

  selected.forEach(([date, price], position) => {
    if (position > 0 && shares > 0) {
      const fee = shares * price * monthlyFeeRate;
      shares *= 1 - monthlyFeeRate;
      totalFees += fee;
    }
    const contribution = safeMonthly + (position === 0 ? safeInitial : 0);
    shares += contribution / price;
    principal += contribution;
    timeline.push({
      date,
      price,
      contribution,
      principal,
      value: shares * price,
      profit: shares * price - principal,
      totalFees
    });
  });

  const last = timeline.at(-1);
  const firstPrice = timeline[0].price;
  const priceReturn = last.price / firstPrice - 1;
  const elapsedMonths = Math.max(1, timeline.length - 1);
  const priceAnnualized = timeline.length > 1
    ? Math.pow(last.price / firstPrice, 12 / elapsedMonths) - 1
    : 0;

  const yearly = [];
  for (const item of timeline) {
    const year = item.date.slice(0, 4);
    if (yearly.at(-1)?.year === year) yearly[yearly.length - 1] = { year, ...item };
    else yearly.push({ year, ...item });
  }

  return {
    months: timeline.length,
    principal: last.principal,
    value: last.value,
    profit: last.profit,
    totalFees: last.totalFees,
    returnRate: last.principal ? last.profit / last.principal : 0,
    priceReturn,
    priceAnnualized,
    timeline,
    yearly
  };
}
