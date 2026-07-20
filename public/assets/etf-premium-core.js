const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(later, earlier) {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS);
}

export function buildPremiumPoints(prices, navs, maxNavLagDays = 7) {
  const cleanPrices = [...prices]
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.close) && item.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const cleanNavs = [...navs]
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.nav) && item.nav > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const points = [];
  let navIndex = -1;
  for (const price of cleanPrices) {
    while (navIndex + 1 < cleanNavs.length && cleanNavs[navIndex + 1].date < price.date) navIndex += 1;
    if (navIndex < 0) continue;

    const nav = cleanNavs[navIndex];
    const lagDays = daysBetween(price.date, nav.date);
    if (lagDays > maxNavLagDays) continue;
    const premiumRate = (price.close / nav.nav - 1) * 100;
    points.push([
      price.date,
      round(price.close, 4),
      nav.date,
      round(nav.nav, 4),
      lagDays,
      round(premiumRate, 4)
    ]);
  }
  return points;
}

export function quantile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower + 1] === undefined
    ? sorted[lower]
    : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

export function summarizePremium(points) {
  const rates = points.map((point) => point[5]).filter(Number.isFinite);
  if (!rates.length) return null;
  const latest = rates.at(-1);
  return {
    count: rates.length,
    latest: round(latest, 4),
    percentile: round(rates.filter((value) => value <= latest).length / rates.length * 100, 2),
    minimum: round(Math.min(...rates), 4),
    p10: round(quantile(rates, .1), 4),
    p25: round(quantile(rates, .25), 4),
    median: round(quantile(rates, .5), 4),
    p75: round(quantile(rates, .75), 4),
    p90: round(quantile(rates, .9), 4),
    maximum: round(Math.max(...rates), 4)
  };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
