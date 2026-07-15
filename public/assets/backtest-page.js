import { runBacktest } from './backtest-core.js';

const els = Object.fromEntries([
  'indexSelect', 'indexDescription', 'initial', 'monthly', 'managementFee',
  'dataAsOf', 'sourceLabel', 'errorMessage', 'principal', 'futureValue', 'profit',
  'returnRate', 'priceReturn', 'priceAnnualized', 'totalFees', 'periodSummary', 'chart', 'yearRows',
  'rangeControl', 'startDateButton', 'endDateButton', 'startDateLabel', 'endDateLabel',
  'rangeDuration', 'rangeNotice', 'monthPicker', 'pickerTargetLabel', 'pickerHeading',
  'pickerClose', 'pickerPrevious', 'pickerNext', 'pickerPeriod', 'monthGrid', 'pickerBackdrop'
].map((id) => [id, document.getElementById(id)]));

const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const cache = new Map();
let registry = [];
let currentData = null;
let availableStart = '';
let availableEnd = '';
let selection = { start: '', end: '' };
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
  const numeric = Math.min(monthNumber(maximum), Math.max(monthNumber(minimum), monthNumber(value)));
  return monthFromNumber(numeric);
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

function setRange(start, end, notice = '') {
  selection = {
    start: clampMonth(start, availableStart, availableEnd),
    end: clampMonth(end, availableStart, availableEnd)
  };
  if (selection.start > selection.end) selection.start = selection.end;
  els.rangeNotice.textContent = notice;
  renderRange();
  calculate();
}

function setPreset(months) {
  const end = availableEnd;
  const start = months === 'all'
    ? availableStart
    : monthFromNumber(Math.max(monthNumber(availableStart), monthNumber(end) - Number(months) + 1));
  setRange(start, end);
}

function renderRange() {
  els.startDateLabel.textContent = formatMonth(selection.start);
  els.endDateLabel.textContent = formatMonth(selection.end);
  els.rangeDuration.textContent = durationText(selection.start, selection.end);
}

async function selectIndex() {
  try {
    setError('');
    closePicker(false);
    const previous = selection.start ? { ...selection } : null;
    const index = registry.find((item) => item.id === els.indexSelect.value);
    if (!cache.has(index.id)) cache.set(index.id, await loadJson(index.dataFile));
    currentData = cache.get(index.id);
    availableStart = currentData.points[0][0].slice(0, 7);
    availableEnd = currentData.points.at(-1)[0].slice(0, 7);

    els.indexDescription.textContent = `${index.description} · ${index.currency} 计价`;
    els.dataAsOf.textContent = `截至 ${dateLabel.format(new Date(`${currentData.lastDataDate}T00:00:00Z`))}`;
    els.sourceLabel.textContent = `来源：${index.source.label}`;

    if (!previous) {
      setPreset(120);
      return;
    }

    const start = clampMonth(previous.start, availableStart, availableEnd);
    const end = clampMonth(previous.end, availableStart, availableEnd);
    const adjusted = start !== previous.start || end !== previous.end;
    setRange(start, end, adjusted ? `已按${index.name}可用数据范围调整` : '');
  } catch (error) {
    setError(error.message);
  }
}

function calculate() {
  if (!currentData || !selection.start) return;
  try {
    setError('');
    const result = runBacktest({
      points: currentData.points,
      startMonth: selection.start,
      endMonth: selection.end,
      initial: els.initial.value,
      monthly: els.monthly.value,
      annualFee: Math.min(99.9, Math.max(0, Number(els.managementFee.value) || 0)) / 100
    });
    renderResult(result);
  } catch (error) {
    setError(error.message);
  }
}

function renderResult(result) {
  els.principal.textContent = money.format(result.principal);
  els.futureValue.textContent = money.format(result.value);
  els.profit.textContent = money.format(result.profit);
  els.returnRate.textContent = percent.format(result.returnRate);
  els.priceReturn.textContent = percent.format(result.priceReturn);
  els.priceAnnualized.textContent = percent.format(result.priceAnnualized);
  els.totalFees.textContent = money.format(result.totalFees);
  els.periodSummary.textContent = `${result.timeline[0].date} 至 ${result.timeline.at(-1).date} · 共 ${result.months} 次月度投入`;
  els.yearRows.innerHTML = result.yearly.map((row) => `
    <tr><td>${row.year}</td><td>${money.format(row.principal)}</td><td>${money.format(row.value)}</td><td>${money.format(row.profit)}</td></tr>
  `).join('');
  renderChart(result.timeline);
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
  if (!currentData) return;
  pickerTarget = target;
  pickerYear = Number(selection[target].slice(0, 4));
  previousFocus = target === 'start' ? els.startDateButton : els.endDateButton;
  els.monthPicker.hidden = false;
  els.pickerBackdrop.hidden = false;
  els.monthPicker.setAttribute('aria-modal', String(window.matchMedia('(max-width: 620px)').matches));
  els.startDateButton.setAttribute('aria-expanded', String(target === 'start'));
  els.endDateButton.setAttribute('aria-expanded', String(target === 'end'));
  document.body.classList.add('picker-open');
  renderPicker();
  requestAnimationFrame(() => focusPickerValue(`[data-month="${selection[target]}"]`));
}

function closePicker(restoreFocus = true) {
  if (els.monthPicker.hidden) return;
  els.monthPicker.hidden = true;
  els.pickerBackdrop.hidden = true;
  els.startDateButton.setAttribute('aria-expanded', 'false');
  els.endDateButton.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('picker-open');
  if (restoreFocus && previousFocus) previousFocus.focus();
}

function chooseMonth(value) {
  selection[pickerTarget] = value;
  els.rangeNotice.textContent = '';
  closePicker();
  renderRange();
  calculate();
}

function focusPickerValue(selector) {
  const preferred = els.monthPicker.querySelector(`${selector}:not(:disabled)`);
  const fallback = els.monthPicker.querySelector('[data-month]:not(:disabled)');
  (preferred || fallback || els.pickerClose).focus();
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

function renderChart(timeline) {
  const width = 760, height = 280, left = 54, right = 14, top = 16, bottom = 30;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const max = Math.max(...timeline.flatMap((item) => [item.value, item.principal]), 1);
  const x = (i) => left + (timeline.length === 1 ? plotWidth / 2 : i * plotWidth / (timeline.length - 1));
  const y = (value) => top + plotHeight - value / max * plotHeight;
  const path = (key) => timeline.map((item, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(item[key]).toFixed(1)}`).join(' ');
  const ticks = [0, .25, .5, .75, 1];
  els.chart.innerHTML = `
    ${ticks.map((tick) => `<line x1="${left}" x2="${width - right}" y1="${y(max * tick)}" y2="${y(max * tick)}" stroke="#e6eaef"/>`).join('')}
    ${ticks.map((tick) => `<text x="${left - 8}" y="${y(max * tick) + 4}" text-anchor="end" fill="#7a8798" font-size="10">${compactMoney(max * tick)}</text>`).join('')}
    <path d="${path('principal')}" fill="none" stroke="#8795a9" stroke-width="2" stroke-dasharray="5 4"/>
    <path d="${path('value')}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${left}" y="${height - 7}" fill="#7a8798" font-size="10">${timeline[0].date.slice(0, 7)}</text>
    <text x="${width - right}" y="${height - 7}" text-anchor="end" fill="#7a8798" font-size="10">${timeline.at(-1).date.slice(0, 7)}</text>
  `;
}

function compactMoney(value) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return Math.round(value).toLocaleString('zh-CN');
}

function setError(message) { els.errorMessage.textContent = message; }

document.querySelectorAll('input').forEach((input) => input.addEventListener('input', calculate));
els.indexSelect.addEventListener('change', selectIndex);
els.startDateButton.addEventListener('click', () => openPicker('start'));
els.endDateButton.addEventListener('click', () => openPicker('end'));
els.pickerClose.addEventListener('click', () => closePicker());
els.pickerBackdrop.addEventListener('click', () => closePicker());
els.pickerPrevious.addEventListener('click', () => movePickerPeriod(-1));
els.pickerNext.addEventListener('click', () => movePickerPeriod(1));
els.monthGrid.addEventListener('keydown', handleMonthKeys);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.monthPicker.hidden) {
    event.preventDefault();
    closePicker();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!els.monthPicker.hidden && !els.rangeControl.contains(event.target) && event.target !== els.pickerBackdrop) closePicker(false);
});
document.querySelectorAll('[data-months]').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.months)));
document.querySelectorAll('[data-fee]').forEach((button) => button.addEventListener('click', () => {
  els.managementFee.value = button.dataset.fee;
  calculate();
}));

try {
  const payload = await loadJson('/data/indices.json');
  registry = payload.indices;
  els.indexSelect.innerHTML = registry.map((index) => `<option value="${index.id}">${index.name} · ${index.shortName}</option>`).join('');
  await selectIndex();
} catch (error) {
  setError(`${error.message}。请通过 HTTP 服务器打开页面，不要直接双击 HTML 文件。`);
}
