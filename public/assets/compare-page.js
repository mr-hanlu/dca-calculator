import { commonRange, compareIndices } from './compare-core.js';

const els = Object.fromEntries([
  'dataAsOf', 'selectedCount', 'indexChecks', 'errorMessage', 'periodSummary', 'chartLegend',
  'compareChart', 'chartStage', 'chartTooltip', 'chartNote', 'comparisonRows', 'rangeControl',
  'startDateButton', 'endDateButton', 'startDateLabel', 'endDateLabel', 'rangeDuration',
  'rangeNotice', 'monthPicker', 'pickerTargetLabel', 'pickerHeading', 'pickerClose',
  'pickerPrevious', 'pickerNext', 'pickerPeriod', 'monthGrid', 'pickerBackdrop'
].map((id) => [id, document.getElementById(id)]));

const colors = ['#0f766e', '#315f9d', '#d97706', '#7c3aed', '#db2777'];
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
let registry = [];
let datasets = new Map();
let availableStart = '';
let availableEnd = '';
let selection = { start: '', end: '' };
let mode = 'performance';
let result = null;
let pickerTarget = 'start';
let pickerYear = new Date().getUTCFullYear();
let previousFocus = null;

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`加载失败：${url}`);
  return response.json();
}

function monthNumber(value) {
  const [year, month] = value.split('-').map(Number);
  return year * 12 + month - 1;
}

function monthFromNumber(value) {
  const year = Math.floor(value / 12);
  const month = value % 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function clampMonth(value, minimum, maximum) {
  return monthFromNumber(Math.min(monthNumber(maximum), Math.max(monthNumber(minimum), monthNumber(value))));
}

function formatMonth(value) {
  const [year, month] = value.split('-').map(Number);
  return `${year}年${month}月`;
}

function durationText(start, end) {
  const months = monthNumber(end) - monthNumber(start) + 1;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  const readable = [years ? `${years}年` : '', remainder ? `${remainder}个月` : ''].filter(Boolean).join('');
  return `共 ${months} 个月${readable ? ` / ${readable}` : ''}`;
}

function selectedRegistry() {
  const ids = [...els.indexChecks.querySelectorAll('input:checked')].map((input) => input.value);
  return ids.map((id) => registry.find((item) => item.id === id));
}

function colorFor(id) {
  return colors[registry.findIndex((item) => item.id === id) % colors.length];
}

function selectedSeries() {
  return selectedRegistry().map((index) => ({ ...index, points: datasets.get(index.id).points }));
}

function renderIndexChoices() {
  els.indexChecks.replaceChildren(...registry.map((index, position) => {
    const label = document.createElement('label');
    label.className = 'index-option';
    label.innerHTML = `
      <input type="checkbox" value="${index.id}" checked>
      <span><strong>${index.name}</strong><small>${index.shortName} · ${index.currency}</small></span>
      <i style="background:${colorFor(index.id)}"></i>
    `;
    label.querySelector('input').addEventListener('change', handleIndexChange);
    return label;
  }));
}

function handleIndexChange(event) {
  const count = els.indexChecks.querySelectorAll('input:checked').length;
  if (count < 2 || count > 5) {
    event.target.checked = !event.target.checked;
    setError(count < 2 ? '至少选择两个指数进行对比' : '最多选择五个指数');
    return;
  }
  setError('');
  refreshCommonRange();
}

function refreshCommonRange() {
  closePicker(false);
  const wasFullRange = selection.start === availableStart && selection.end === availableEnd;
  const next = commonRange(selectedSeries());
  const previous = { ...selection };
  availableStart = next.start;
  availableEnd = next.end;
  if (!selection.start || wasFullRange) {
    selection = { start: availableStart, end: availableEnd };
  } else {
    selection = {
      start: clampMonth(selection.start, availableStart, availableEnd),
      end: clampMonth(selection.end, availableStart, availableEnd)
    };
    if (selection.start > selection.end) selection.start = selection.end;
  }
  const adjusted = previous.start && (previous.start !== selection.start || previous.end !== selection.end);
  els.rangeNotice.textContent = adjusted ? '已按所选指数的共同数据范围调整' : '';
  els.selectedCount.textContent = `已选 ${selectedRegistry().length} 个`;
  els.dataAsOf.textContent = `截至 ${formatMonth(availableEnd)}`;
  renderRange();
  calculate();
}

function setRange(start, end) {
  selection = {
    start: clampMonth(start, availableStart, availableEnd),
    end: clampMonth(end, availableStart, availableEnd)
  };
  if (selection.start > selection.end) selection.start = selection.end;
  els.rangeNotice.textContent = '';
  renderRange();
  calculate();
}

function setPreset(months) {
  const start = months === 'all'
    ? availableStart
    : monthFromNumber(Math.max(monthNumber(availableStart), monthNumber(availableEnd) - Number(months) + 1));
  setRange(start, availableEnd);
}

function renderRange() {
  els.startDateLabel.textContent = formatMonth(selection.start);
  els.endDateLabel.textContent = formatMonth(selection.end);
  els.rangeDuration.textContent = durationText(selection.start, selection.end);
}

function calculate() {
  try {
    setError('');
    result = compareIndices(selectedSeries(), selection.start, selection.end);
    renderResult();
  } catch (error) {
    setError(error.message);
  }
}

function renderResult() {
  els.periodSummary.textContent = `${formatMonth(result.months[0])}—${formatMonth(result.months.at(-1))} · ${result.months.length} 个共同月份`;
  els.chartLegend.innerHTML = result.series.map((item) =>
    `<span><i class="legend-dot" style="background:${colorFor(item.id)}"></i>${item.name}</span>`
  ).join('');
  els.comparisonRows.innerHTML = result.series.map((item) => `
    <tr>
      <td><span class="index-cell"><i class="row-dot" style="background:${colorFor(item.id)}"></i>${item.name}</span></td>
      <td class="${signClass(item.stats.totalReturn)}">${percent.format(item.stats.totalReturn)}</td>
      <td class="${signClass(item.stats.annualizedReturn)}">${percent.format(item.stats.annualizedReturn)}</td>
      <td class="negative">${percent.format(item.stats.maxDrawdown)}</td>
      <td>${percent.format(item.stats.annualizedVolatility)}</td>
    </tr>
  `).join('');
  renderChart();
}

function signClass(value) {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
}

function renderChart() {
  const width = 900, height = 390, left = 58, right = 24, top = 24, bottom = 45;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const key = mode === 'performance' ? 'normalized' : 'drawdown';
  const rawValues = result.series.flatMap((item) => item.values.map((value) => value[key]));
  let minimum = Math.min(...rawValues), maximum = Math.max(...rawValues);
  if (mode === 'performance') {
    minimum = Math.min(minimum, 100);
    maximum = Math.max(maximum, 100);
    const padding = Math.max(3, (maximum - minimum) * .1);
    minimum = Math.max(0, minimum - padding);
    maximum += padding;
  } else {
    minimum = Math.min(minimum * 1.08, -.05);
    maximum = 0;
  }
  if (maximum === minimum) maximum = minimum + 1;

  const x = (index) => left + (result.months.length === 1 ? plotWidth / 2 : index * plotWidth / (result.months.length - 1));
  const y = (value) => top + (maximum - value) / (maximum - minimum) * plotHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => minimum + (maximum - minimum) * index / 4);
  const xTickIndexes = [...new Set([0, Math.floor((result.months.length - 1) / 2), result.months.length - 1])];
  const path = (values) => values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value[key]).toFixed(1)}`).join(' ');

  els.compareChart.innerHTML = `
    <rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="transparent"/>
    ${ticks.map((tick) => `<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" stroke="#e5e9ee"/>`).join('')}
    ${ticks.map((tick) => `<text x="${left - 9}" y="${y(tick) + 4}" text-anchor="end" fill="#7a8798" font-size="10">${formatAxis(tick)}</text>`).join('')}
    ${mode === 'performance' && minimum <= 100 && maximum >= 100 ? `<line x1="${left}" x2="${width - right}" y1="${y(100)}" y2="${y(100)}" stroke="#aeb8c5" stroke-dasharray="4 4"/>` : ''}
    ${result.series.map((item) => `<path d="${path(item.values)}" fill="none" stroke="${colorFor(item.id)}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${xTickIndexes.map((index) => `<text x="${x(index)}" y="${height - 10}" text-anchor="${index === 0 ? 'start' : index === result.months.length - 1 ? 'end' : 'middle'}" fill="#7a8798" font-size="10">${result.months[index]}</text>`).join('')}
    <g id="hoverLayer" visibility="hidden">
      <line id="hoverLine" y1="${top}" y2="${height - bottom}" stroke="#8390a2" stroke-width="1" stroke-dasharray="3 3"/>
      ${result.series.map((item, index) => `<circle id="hoverDot${index}" r="4" fill="#fff" stroke="${colorFor(item.id)}" stroke-width="2.5"/>`).join('')}
    </g>
  `;

  els.chartNote.textContent = mode === 'performance'
    ? '数值 100 代表比较开始时的指数点位；150 表示累计上涨 50%。'
    : '0% 代表处于此前最高点；-20% 代表相对此前最高点下跌 20%。';

  els.compareChart.onpointermove = (event) => showHover(event, { width, left, plotWidth, x, y, key });
  els.compareChart.onpointerleave = hideHover;
}

function formatAxis(value) {
  return mode === 'performance' ? Math.round(value).toLocaleString('zh-CN') : `${Math.round(value * 100)}%`;
}

function showHover(event, chart) {
  const rect = els.compareChart.getBoundingClientRect();
  const viewX = (event.clientX - rect.left) / rect.width * chart.width;
  const ratio = Math.max(0, Math.min(1, (viewX - chart.left) / chart.plotWidth));
  const index = Math.round(ratio * (result.months.length - 1));
  const exactX = chart.x(index);
  const hoverLayer = els.compareChart.querySelector('#hoverLayer');
  hoverLayer.setAttribute('visibility', 'visible');
  els.compareChart.querySelector('#hoverLine').setAttribute('x1', exactX);
  els.compareChart.querySelector('#hoverLine').setAttribute('x2', exactX);
  result.series.forEach((item, seriesIndex) => {
    const dot = els.compareChart.querySelector(`#hoverDot${seriesIndex}`);
    dot.setAttribute('cx', exactX);
    dot.setAttribute('cy', chart.y(item.values[index][chart.key]));
  });

  els.chartTooltip.hidden = false;
  els.chartTooltip.style.left = `${exactX / chart.width * 100}%`;
  els.chartTooltip.classList.toggle('right', index > result.months.length * .58);
  els.chartTooltip.innerHTML = `
    <strong>${formatMonth(result.months[index])}</strong>
    ${result.series.map((item, seriesIndex) => {
      const value = item.values[index];
      const display = mode === 'performance'
        ? `${value.normalized.toFixed(1)} · ${percent.format(value.normalized / 100 - 1)}`
        : percent.format(value.drawdown);
      return `<div class="tooltip-row"><i class="legend-dot" style="background:${colorFor(item.id)}"></i><b>${item.name}</b><span>${display}</span></div>`;
    }).join('')}
  `;
}

function hideHover() {
  els.compareChart.querySelector('#hoverLayer')?.setAttribute('visibility', 'hidden');
  els.chartTooltip.hidden = true;
}

function targetLimits() {
  return pickerTarget === 'start'
    ? { minimum: availableStart, maximum: selection.end }
    : { minimum: selection.start, maximum: availableEnd };
}

function renderPicker() {
  const selected = selection[pickerTarget];
  const { minimum, maximum } = targetLimits();
  const minYear = Number(minimum.slice(0, 4));
  const maxYear = Number(maximum.slice(0, 4));
  els.pickerTargetLabel.textContent = pickerTarget === 'start' ? '选择开始月份' : '选择结束月份';
  els.pickerHeading.textContent = `${formatMonth(selection.start)} → ${formatMonth(selection.end)}`;
  pickerYear = Math.min(maxYear, Math.max(minYear, pickerYear));
  els.pickerPeriod.textContent = `${pickerYear}年`;
  els.pickerPrevious.disabled = pickerYear <= minYear;
  els.pickerNext.disabled = pickerYear >= maxYear;
  els.monthGrid.replaceChildren(...Array.from({ length: 12 }, (_, index) => {
    const value = `${pickerYear}-${String(index + 1).padStart(2, '0')}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.month = value;
    button.textContent = `${index + 1}月`;
    button.disabled = value < minimum || value > maximum;
    button.setAttribute('aria-pressed', String(value === selected));
    button.setAttribute('aria-label', `${pickerYear}年${index + 1}月`);
    if (value === selection[pickerTarget === 'start' ? 'end' : 'start']) button.classList.add('range-boundary');
    button.addEventListener('click', () => chooseMonth(value));
    return button;
  }));
}

function openPicker(target) {
  pickerTarget = target;
  pickerYear = Number(selection[target].slice(0, 4));
  previousFocus = target === 'start' ? els.startDateButton : els.endDateButton;
  els.monthPicker.hidden = false;
  els.pickerBackdrop.hidden = false;
  els.monthPicker.setAttribute('aria-modal', String(window.matchMedia('(max-width: 620px)').matches));
  els.startDateButton.setAttribute('aria-expanded', String(target === 'start'));
  els.endDateButton.setAttribute('aria-expanded', String(target === 'end'));
  renderPicker();
  requestAnimationFrame(() => focusPickerValue(`[data-month="${selection[target]}"]`));
}

function closePicker(restoreFocus = true) {
  if (els.monthPicker.hidden) return;
  els.monthPicker.hidden = true;
  els.pickerBackdrop.hidden = true;
  els.startDateButton.setAttribute('aria-expanded', 'false');
  els.endDateButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus && previousFocus) previousFocus.focus();
}

function chooseMonth(value) {
  selection[pickerTarget] = value;
  closePicker();
  renderRange();
  calculate();
}

function focusPickerValue(selector) {
  (els.monthPicker.querySelector(`${selector}:not(:disabled)`) || els.monthPicker.querySelector('[data-month]:not(:disabled)') || els.pickerClose).focus();
}

function movePickerPeriod(direction) {
  pickerYear += direction;
  renderPicker();
  focusPickerValue(`[data-month^="${pickerYear}-"]`);
}

function handleMonthKeys(event) {
  const button = event.target.closest('[data-month]');
  if (!button) return;
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4, PageUp: -12, PageDown: 12 };
  if (!(event.key in offsets)) return;
  event.preventDefault();
  const { minimum, maximum } = targetLimits();
  const desired = monthFromNumber(monthNumber(button.dataset.month) + offsets[event.key]);
  if (desired < minimum || desired > maximum) return;
  pickerYear = Number(desired.slice(0, 4));
  renderPicker();
  focusPickerValue(`[data-month="${desired}"]`);
}

function setError(message) {
  els.errorMessage.textContent = message;
}

els.startDateButton.addEventListener('click', () => openPicker('start'));
els.endDateButton.addEventListener('click', () => openPicker('end'));
els.pickerClose.addEventListener('click', () => closePicker());
els.pickerBackdrop.addEventListener('click', () => closePicker());
els.pickerPrevious.addEventListener('click', () => movePickerPeriod(-1));
els.pickerNext.addEventListener('click', () => movePickerPeriod(1));
els.monthGrid.addEventListener('keydown', handleMonthKeys);
document.querySelectorAll('[data-months]').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.months)));
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  hideHover();
  renderChart();
}));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.monthPicker.hidden) closePicker();
});
document.addEventListener('pointerdown', (event) => {
  if (!els.monthPicker.hidden && !els.rangeControl.contains(event.target) && event.target !== els.pickerBackdrop) closePicker(false);
});

try {
  const payload = await loadJson('/data/indices.json');
  registry = payload.indices;
  const loaded = await Promise.all(registry.map(async (index) => [index.id, await loadJson(index.dataFile)]));
  datasets = new Map(loaded);
  renderIndexChoices();
  refreshCommonRange();
} catch (error) {
  setError(`${error.message}。请通过 HTTP 服务器打开页面，不要直接双击 HTML 文件。`);
}
