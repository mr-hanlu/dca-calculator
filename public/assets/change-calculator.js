const STORAGE_KEY = 'dca-change-calculator-history-v1';
const MAX_HISTORY = 5;

const valueFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4
});

const percentFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];

    return value
      .filter((item) => Number.isFinite(item?.oldValue) && item.oldValue > 0
        && Number.isFinite(item?.newValue) && item.newValue >= 0)
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function writeHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // The calculator still works when private browsing blocks local storage.
  }
}

function signed(value, formatter, suffix = '') {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatter.format(value)}${suffix}`;
}

function createCalculator() {
  const root = document.createElement('aside');
  root.className = 'change-calculator';
  root.dataset.open = 'false';
  root.innerHTML = `
    <div class="change-calculator__backdrop" data-action="close" aria-hidden="true"></div>
    <section class="change-calculator__panel" id="changeCalculatorPanel" role="dialog" aria-labelledby="changeCalculatorTitle" aria-describedby="changeCalculatorSubtitle">
      <header class="change-calculator__header">
        <div>
          <span class="change-calculator__eyebrow">Quick calculator</span>
          <h2 class="change-calculator__title" id="changeCalculatorTitle">涨跌幅速算</h2>
          <p class="change-calculator__subtitle" id="changeCalculatorSubtitle">金额、价格和指数点位都可以计算</p>
        </div>
        <button class="change-calculator__close" type="button" data-action="close" aria-label="关闭涨跌幅计算器">×</button>
      </header>
      <div class="change-calculator__body">
        <form data-role="form" novalidate>
          <div class="change-calculator__fields">
            <div class="change-calculator__field">
              <label for="changeCalculatorOldValue">起始数值</label>
              <input id="changeCalculatorOldValue" data-role="old" type="number" min="0" step="any" inputmode="decimal" placeholder="例如 1000" autocomplete="off">
            </div>
            <div class="change-calculator__field">
              <label for="changeCalculatorNewValue">当前数值</label>
              <input id="changeCalculatorNewValue" data-role="new" type="number" min="0" step="any" inputmode="decimal" placeholder="例如 1250" autocomplete="off">
            </div>
          </div>
          <button class="change-calculator__submit" type="submit">计算涨跌幅</button>
        </form>
        <div class="change-calculator__result" data-role="result" role="status" aria-live="polite" hidden>
          <span class="change-calculator__result-label" data-role="result-label">计算结果</span>
          <strong class="change-calculator__result-value" data-role="result-value"></strong>
          <span class="change-calculator__result-detail" data-role="result-detail"></span>
        </div>
        <section class="change-calculator__history" aria-labelledby="changeCalculatorHistoryTitle">
          <div class="change-calculator__history-head">
            <h3 class="change-calculator__history-title" id="changeCalculatorHistoryTitle">最近 5 次</h3>
            <button class="change-calculator__clear" type="button" data-action="clear-history">清空记录</button>
          </div>
          <ol class="change-calculator__history-list" data-role="history"></ol>
        </section>
      </div>
    </section>
    <button class="change-calculator__trigger" type="button" aria-label="打开涨跌幅速算" aria-controls="changeCalculatorPanel" aria-expanded="false">
      <span class="change-calculator__trigger-mark" aria-hidden="true">%</span>
    </button>
  `;

  document.body.append(root);

  const trigger = root.querySelector('.change-calculator__trigger');
  const panel = root.querySelector('.change-calculator__panel');
  const form = root.querySelector('[data-role="form"]');
  const oldInput = root.querySelector('[data-role="old"]');
  const newInput = root.querySelector('[data-role="new"]');
  const result = root.querySelector('[data-role="result"]');
  const resultLabel = root.querySelector('[data-role="result-label"]');
  const resultValue = root.querySelector('[data-role="result-value"]');
  const resultDetail = root.querySelector('[data-role="result-detail"]');
  const historyContainer = root.querySelector('[data-role="history"]');
  const clearHistoryButton = root.querySelector('[data-action="clear-history"]');
  let history = readHistory();

  function setOpen(open, returnFocus = false) {
    root.dataset.open = String(open);
    document.body.classList.toggle('change-calculator-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? '收起涨跌幅速算' : '打开涨跌幅速算');

    if (open) {
      window.setTimeout(() => oldInput.focus(), 30);
    } else if (returnFocus) {
      trigger.focus();
    }
  }

  function showError(message) {
    result.hidden = false;
    result.className = 'change-calculator__result change-calculator__result--error';
    resultLabel.textContent = '无法计算';
    resultValue.textContent = message;
    resultDetail.textContent = '';
  }

  function showCalculation(oldValue, newValue) {
    const difference = newValue - oldValue;
    const rate = difference / oldValue * 100;
    const direction = rate > 0 ? 'up' : rate < 0 ? 'down' : 'flat';

    result.hidden = false;
    result.className = `change-calculator__result change-calculator__result--${direction}`;
    resultLabel.textContent = rate > 0 ? '上涨' : rate < 0 ? '下跌' : '持平';
    resultValue.textContent = signed(rate, percentFormatter, '%');
    resultDetail.textContent = difference === 0
      ? '数值没有变化'
      : `${difference > 0 ? '增加' : '减少'} ${valueFormatter.format(Math.abs(difference))}`;
  }

  function calculate(oldValue, newValue, save = true) {
    if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) {
      showError('请输入两个有效数值');
      return;
    }
    if (oldValue <= 0) {
      showError('起始数值必须大于 0');
      return;
    }
    if (newValue < 0) {
      showError('当前数值不能小于 0');
      return;
    }

    showCalculation(oldValue, newValue);

    if (!save) return;
    const latest = history[0];
    if (!latest || latest.oldValue !== oldValue || latest.newValue !== newValue) {
      history = [{ oldValue, newValue, createdAt: Date.now() }, ...history].slice(0, MAX_HISTORY);
      writeHistory(history);
      renderHistory();
    }
  }

  function renderHistory() {
    historyContainer.replaceChildren();
    clearHistoryButton.hidden = history.length === 0;

    if (history.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'change-calculator__empty';
      empty.textContent = '计算后会在此保留最近记录';
      historyContainer.append(empty);
      return;
    }

    history.forEach((item) => {
      const rate = (item.newValue - item.oldValue) / item.oldValue * 100;
      const direction = rate > 0 ? 'up' : rate < 0 ? 'down' : 'flat';
      const listItem = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'change-calculator__history-button';
      button.dataset.oldValue = String(item.oldValue);
      button.dataset.newValue = String(item.newValue);
      button.setAttribute('aria-label', `重新使用 ${valueFormatter.format(item.oldValue)} 到 ${valueFormatter.format(item.newValue)} 的计算`);

      const values = document.createElement('span');
      values.className = 'change-calculator__history-values';
      values.textContent = `${valueFormatter.format(item.oldValue)} → ${valueFormatter.format(item.newValue)}`;

      const hint = document.createElement('span');
      hint.className = 'change-calculator__history-hint';
      hint.textContent = '点击重新填入';

      const rateElement = document.createElement('strong');
      rateElement.className = `change-calculator__history-rate change-calculator__history-rate--${direction}`;
      rateElement.textContent = signed(rate, percentFormatter, '%');

      button.append(values, hint, rateElement);
      listItem.append(button);
      historyContainer.append(listItem);
    });
  }

  trigger.addEventListener('click', () => {
    setOpen(root.dataset.open !== 'true');
  });

  root.querySelectorAll('[data-action="close"]').forEach((button) => {
    button.addEventListener('click', () => setOpen(false, true));
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const oldValue = oldInput.value.trim() === '' ? Number.NaN : Number(oldInput.value);
    const newValue = newInput.value.trim() === '' ? Number.NaN : Number(newInput.value);
    calculate(oldValue, newValue);
  });

  clearHistoryButton.addEventListener('click', () => {
    history = [];
    writeHistory(history);
    renderHistory();
  });

  historyContainer.addEventListener('click', (event) => {
    const button = event.target.closest('.change-calculator__history-button');
    if (!button) return;

    oldInput.value = button.dataset.oldValue;
    newInput.value = button.dataset.newValue;
    calculate(Number(button.dataset.oldValue), Number(button.dataset.newValue), false);
    newInput.focus();
  });

  document.addEventListener('pointerdown', (event) => {
    if (root.dataset.open === 'true' && !root.contains(event.target)) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.dataset.open === 'true') {
      setOpen(false, true);
    }
  });

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      const focusable = [...panel.querySelectorAll('button:not([hidden]), input:not([disabled])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  renderHistory();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createCalculator, { once: true });
} else {
  createCalculator();
}
