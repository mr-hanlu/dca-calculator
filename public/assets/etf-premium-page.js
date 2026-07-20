import { daysBetween, summarizePremium } from './etf-premium-core.js';

const els = Object.fromEntries([
  'dataAsOf', 'dataFreshness', 'groupTabs', 'rangeTabs', 'groupTitle', 'periodSummary',
  'chartLegend', 'chartStage', 'premiumChart', 'chartTooltip', 'latestCards', 'statsRows',
  'errorMessage'
].map((id) => [id, document.getElementById(id)]));

const percent = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 });
let registry;
let datasets = new Map();
let activeGroupId = '';
let activeDays = 365;
let chartState = null;

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`加载失败：${url}`);
  return response.json();
}

function groupEtfs() {
  return registry.etfs.filter((etf) => etf.groupId === activeGroupId);
}

function activeGroup() {
  return registry.groups.find((group) => group.id === activeGroupId);
}

function formatRate(value, withSign = true) {
  if (!Number.isFinite(value)) return '—';
  return `${withSign && value > 0 ? '+' : ''}${percent.format(value)}%`;
}

function formatDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function currentShanghaiDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function signClass(value) {
  return value > 0 ? 'rate-positive' : value < 0 ? 'rate-negative' : '';
}

function filteredPoints(data) {
  if (activeDays === 'all') return data.points;
  const latest = data.points.at(-1)?.[0];
  if (!latest) return [];
  const cutoff = new Date(Date.parse(`${latest}T00:00:00Z`) - Number(activeDays) * 86400000).toISOString().slice(0, 10);
  return data.points.filter((point) => point[0] >= cutoff);
}

function renderTabs() {
  els.groupTabs.replaceChildren(...registry.groups.map((group) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = group.name;
    button.dataset.group = group.id;
    button.setAttribute('aria-pressed', String(group.id === activeGroupId));
    button.addEventListener('click', () => {
      activeGroupId = group.id;
      render();
    });
    return button;
  }));
}

function renderHeader() {
  const etfs = groupEtfs();
  const lastDates = etfs.map((etf) => datasets.get(etf.id).lastDataDate).sort();
  const latest = lastDates.at(-1);
  const oldest = lastDates[0];
  const staleDays = daysBetween(currentShanghaiDate(), latest);
  els.dataAsOf.textContent = `截至 ${formatDate(latest)}`;
  els.dataFreshness.textContent = staleDays > 7 ? `数据可能已过期 · 最旧截止 ${oldest}` : '手动更新 · 静态历史数据';
  els.groupTitle.textContent = `${activeGroup().name} ETF 溢价走势`;

  const allPoints = etfs.map((etf) => filteredPoints(datasets.get(etf.id))).filter((points) => points.length);
  const starts = allPoints.map((points) => points[0][0]).sort();
  const ends = allPoints.map((points) => points.at(-1)[0]).sort();
  els.periodSummary.textContent = `${formatDate(starts[0])}—${formatDate(ends.at(-1))} · ${activeGroup().description}`;
}

function renderLegend() {
  els.chartLegend.innerHTML = groupEtfs().map((etf) =>
    `<span><i style="background:${etf.color}"></i>${etf.name}</span>`
  ).join('');
}

function renderLatestCards() {
  const values = groupEtfs().map((etf) => {
    const points = filteredPoints(datasets.get(etf.id));
    return { etf, points, latest: datasets.get(etf.id).points.at(-1), stats: summarizePremium(points) };
  }).filter((item) => item.latest && item.stats);
  const lowest = Math.min(...values.map((item) => item.latest[5]));

  els.latestCards.innerHTML = values.map(({ etf, latest, stats }) => `
    <article class="latest-card ${latest[5] === lowest ? 'is-lowest' : ''}" style="--series-color:${etf.color}">
      <div class="latest-card-head">
        <div><h3>${etf.name}</h3><span class="latest-card-code">${etf.code} · ${etf.market}</span></div>
        ${latest[5] === lowest ? '<span class="lowest-badge">同组较低</span>' : ''}
      </div>
      <strong class="latest-rate">${formatRate(latest[5])}</strong>
      <div class="latest-meta">
        当前处于所选区间 <strong>${percent.format(stats.percentile)}%</strong> 分位<br>
        收盘 ${number.format(latest[1])} · 净值 ${number.format(latest[3])}（滞后 ${latest[4]} 天）
      </div>
    </article>
  `).join('');
}

function renderStatsTable() {
  els.statsRows.innerHTML = groupEtfs().map((etf) => {
    const stats = summarizePremium(filteredPoints(datasets.get(etf.id)));
    if (!stats) return '';
    return `
      <tr>
        <td><span class="etf-cell"><i class="etf-dot" style="background:${etf.color}"></i>${etf.name}<small>${etf.code}</small></span></td>
        <td class="${signClass(stats.latest)}">${formatRate(stats.latest)}</td>
        <td>${percent.format(stats.percentile)}%</td>
        <td>${formatRate(stats.p10)}</td>
        <td>${formatRate(stats.p25)}</td>
        <td>${formatRate(stats.median)}</td>
        <td>${formatRate(stats.p75)}</td>
        <td>${formatRate(stats.p90)}</td>
      </tr>
    `;
  }).join('');
}

function renderChart() {
  const series = groupEtfs().map((etf) => ({ etf, points: filteredPoints(datasets.get(etf.id)) }));
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point[0])))].sort();
  const rates = series.flatMap((item) => item.points.map((point) => point[5]));
  if (!dates.length || !rates.length) throw new Error('所选区间没有可用数据');

  const width = 920, height = 410, left = 58, right = 24, top = 24, bottom = 46;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const startTime = Date.parse(`${dates[0]}T00:00:00Z`);
  const endTime = Date.parse(`${dates.at(-1)}T00:00:00Z`);
  let minimum = Math.min(0, ...rates), maximum = Math.max(0, ...rates);
  const padding = Math.max(1, (maximum - minimum) * .1);
  minimum -= padding;
  maximum += padding;

  const x = (date) => left + (endTime === startTime ? plotWidth / 2
    : (Date.parse(`${date}T00:00:00Z`) - startTime) / (endTime - startTime) * plotWidth);
  const y = (value) => top + (maximum - value) / (maximum - minimum) * plotHeight;
  const yTicks = Array.from({ length: 6 }, (_, index) => minimum + (maximum - minimum) * index / 5);
  const xIndexes = [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])];
  const paths = series.map((item) => item.points.map((point, index) =>
    `${index ? 'L' : 'M'}${x(point[0]).toFixed(1)},${y(point[5]).toFixed(1)}`
  ).join(' '));

  els.premiumChart.innerHTML = `
    <rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="transparent"/>
    ${yTicks.map((tick) => `<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" stroke="#e5e9ee"/>`).join('')}
    ${yTicks.map((tick) => `<text x="${left - 9}" y="${y(tick) + 4}" text-anchor="end" fill="#7a8798" font-size="10">${percent.format(tick)}%</text>`).join('')}
    <line x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}" stroke="#8f9bab" stroke-width="1.2" stroke-dasharray="5 4"/>
    ${series.map((item, index) => `<path d="${paths[index]}" fill="none" stroke="${item.etf.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${xIndexes.map((index) => `<text x="${x(dates[index])}" y="${height - 11}" text-anchor="${index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle'}" fill="#7a8798" font-size="10">${dates[index]}</text>`).join('')}
    <g id="premiumHoverLayer" visibility="hidden">
      <line id="premiumHoverLine" y1="${top}" y2="${height - bottom}" stroke="#8390a2" stroke-width="1" stroke-dasharray="3 3"/>
      ${series.map((item, index) => `<circle id="premiumHoverDot${index}" r="4" fill="#fff" stroke="${item.etf.color}" stroke-width="2.5" visibility="hidden"/>`).join('')}
    </g>
  `;

  chartState = { width, left, plotWidth, x, y, dates, series, startTime, endTime };
  els.premiumChart.onpointermove = showHover;
  els.premiumChart.onpointerleave = hideHover;
}

function showHover(event) {
  if (!chartState) return;
  const rect = els.premiumChart.getBoundingClientRect();
  const svgX = (event.clientX - rect.left) / rect.width * chartState.width;
  const ratio = Math.max(0, Math.min(1, (svgX - chartState.left) / chartState.plotWidth));
  const targetTime = chartState.startTime + ratio * (chartState.endTime - chartState.startTime);
  let bestIndex = 0;
  let bestDistance = Infinity;
  chartState.dates.forEach((date, index) => {
    const distance = Math.abs(Date.parse(`${date}T00:00:00Z`) - targetTime);
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  });

  const date = chartState.dates[bestIndex];
  const xPosition = chartState.x(date);
  const layer = document.getElementById('premiumHoverLayer');
  const line = document.getElementById('premiumHoverLine');
  layer.setAttribute('visibility', 'visible');
  line.setAttribute('x1', xPosition);
  line.setAttribute('x2', xPosition);

  const rows = [];
  chartState.series.forEach((item, index) => {
    const point = item.points.find((candidate) => candidate[0] === date);
    const dot = document.getElementById(`premiumHoverDot${index}`);
    if (!point) {
      dot.setAttribute('visibility', 'hidden');
      return;
    }
    dot.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', xPosition);
    dot.setAttribute('cy', chartState.y(point[5]));
    rows.push(`<div class="premium-tooltip-row"><i style="background:${item.etf.color}"></i><b>${item.etf.name}</b><span>${formatRate(point[5])}</span></div>`);
  });

  els.chartTooltip.innerHTML = `<strong>${formatDate(date)}</strong>${rows.join('')}`;
  els.chartTooltip.hidden = false;
  const pixelX = xPosition / chartState.width * rect.width;
  els.chartTooltip.style.left = `${pixelX}px`;
  els.chartTooltip.classList.toggle('right', pixelX > rect.width * .7);
}

function hideHover() {
  document.getElementById('premiumHoverLayer')?.setAttribute('visibility', 'hidden');
  els.chartTooltip.hidden = true;
}

function render() {
  setError('');
  renderTabs();
  els.rangeTabs.querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(String(activeDays) === button.dataset.days));
  });
  renderHeader();
  renderLegend();
  renderLatestCards();
  renderStatsTable();
  renderChart();
}

function setError(message) {
  els.errorMessage.textContent = message;
}

els.rangeTabs.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-days]');
  if (!button) return;
  activeDays = button.dataset.days === 'all' ? 'all' : Number(button.dataset.days);
  try { render(); } catch (error) { setError(error.message); }
});

async function initialize() {
  try {
    registry = await loadJson('/data/etf-premium/registry.json');
    activeGroupId = registry.groups[0]?.id || '';
    const entries = await Promise.all(registry.etfs.map(async (etf) => [etf.id, await loadJson(etf.dataFile)]));
    datasets = new Map(entries);
    render();
  } catch (error) {
    setError(`ETF 溢价数据加载失败：${error.message}`);
    els.dataAsOf.textContent = '加载失败';
  }
}

initialize();
