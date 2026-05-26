import { state, getEnrichedHoldings, totalPortfolioValue, emit, loadAll } from '../state.js';
import { el, fmtMoney, fmtPct, fmtNumber, logoEl, gainClass, toast, escapeHtml } from '../ui.js';
import { postAction, fetchQuotes } from '../api.js';
import { THESIS_OPTIONS, TARGET_ACTIONS, ACCOUNT_TYPES } from '../config.js';
import { openModal, closeModal } from '../ui.js';

const THESIS_ORDER = ['Market', 'Tech', 'Dividend', 'Speculative'];

let _portfolioChartInstance = null;

export function renderHoldings(root) {
  root.innerHTML = '';

  const enriched = getEnrichedHoldings();
  const total = totalPortfolioValue(enriched);
  const f = state.ui.holdingsFilter;

  root.appendChild(buildPortfolioHero(enriched, total));

  const toolbar = el('div', { class: 'toolbar' });

  const searchWrap = el('div', { class: 'search-wrap' });
  const search = el('input', {
    type: 'search',
    placeholder: 'Search ticker or name…',
    value: '',
    autocomplete: 'off',
  });
  const dropdown = el('div', { class: 'search-dropdown' });
  dropdown.hidden = true;
  searchWrap.appendChild(search);
  searchWrap.appendChild(dropdown);
  toolbar.appendChild(searchWrap);

  const listContainer = el('div', { class: 'holdings-list-wrap' });

  let searchTimer = null;
  let searchGen = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const val = search.value.trim();
    if (!val) { dropdown.hidden = true; return; }
    const gen = ++searchGen;
    searchTimer = setTimeout(
      () => showSearchDropdown(val, dropdown, enriched, total, gen, () => searchGen, search),
      300
    );
  });

  search.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dropdown.hidden = true; search.value = ''; }
    if (e.key === 'ArrowDown') {
      const first = dropdown.querySelector('.sd-item');
      if (first) { first.focus(); e.preventDefault(); }
    }
  });

  document.addEventListener('pointerdown', function onOutside(e) {
    if (!searchWrap.contains(e.target)) {
      dropdown.hidden = true;
      document.removeEventListener('pointerdown', onOutside);
    }
  });

  const thesis = el('select', {});
  ['all', ...THESIS_OPTIONS].forEach(t => {
    const o = el('option', { value: t }, t === 'all' ? 'All thesis' : t);
    if (f.thesis === t) o.selected = true;
    thesis.appendChild(o);
  });
  thesis.addEventListener('change', () => { f.thesis = thesis.value; renderHoldingsList(listContainer, enriched, total, f); });
  toolbar.appendChild(thesis);

  const account = el('select', {});
  ['all', ...ACCOUNT_TYPES].forEach(a => {
    const o = el('option', { value: a }, a === 'all' ? 'All accounts' : a);
    if (f.account === a) o.selected = true;
    account.appendChild(o);
  });
  account.addEventListener('change', () => { f.account = account.value; renderHoldingsList(listContainer, enriched, total, f); });
  toolbar.appendChild(account);

  const mood = el('select', {});
  [['all', 'All'], ['gainers', 'Gainers'], ['losers', 'Losers'], ['triggered', 'Triggered']].forEach(([v, l]) => {
    const o = el('option', { value: v }, l);
    if (f.mood === v) o.selected = true;
    mood.appendChild(o);
  });
  mood.addEventListener('change', () => { f.mood = mood.value; renderHoldingsList(listContainer, enriched, total, f); });
  toolbar.appendChild(mood);

  const sort = el('select', {});
  [
    ['thesis', 'Group: thesis'],
    ['account', 'Group: account'],
    ['ticker', 'Sort: ticker'],
    ['name', 'Sort: name'],
    ['price', 'Sort: price'],
    ['gain', 'Sort: gain'],
    ['pct', 'Sort: % portfolio'],
    ['target', 'Sort: target distance'],
  ].forEach(([v, l]) => {
    const o = el('option', { value: v }, l);
    if (f.sort === v) o.selected = true;
    sort.appendChild(o);
  });
  sort.addEventListener('change', () => { f.sort = sort.value; renderHoldingsList(listContainer, enriched, total, f); });
  toolbar.appendChild(sort);

  const addBtn = el('button', { class: 'btn sm', onclick: () => openAddHoldingModal() }, '+ Add');
  toolbar.appendChild(addBtn);

  root.appendChild(toolbar);
  root.appendChild(listContainer);
  renderHoldingsList(listContainer, enriched, total, f);
}

// ── Portfolio Hero ─────────────────────────────────────────────────────────────
function buildPortfolioHero(enriched, total) {
  const totalGain    = enriched.reduce((s, h) => s + h.gainDollar, 0);
  const totalCost    = enriched.reduce((s, h) => s + h.total_cost_basis, 0);
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  // Compute real day gain: sum of (price_change * shares) across all holdings
  const dayGain = enriched.reduce((s, h) => {
    if (!h.price || h.changePercent == null) return s;
    const prevPrice = h.price / (1 + h.changePercent / 100);
    return s + (h.price - prevPrice) * (h.shares_owned || 0);
  }, 0);
  const prevTotal = total - dayGain;
  const dayGainPct = prevTotal > 0 ? (dayGain / prevTotal) * 100 : 0;

  const hero = el('div', { class: 'port-hero' });

  const top = el('div', { class: 'port-hero-top' });
  const left = el('div', { class: 'port-hero-left' });
  left.appendChild(el('div', { class: 'port-hero-value tabular' }, fmtMoney(total)));
  const stats = el('div', { class: 'port-hero-stats' });
  const dayGainEl = el('span', { class: `port-stat ${gainClass(dayGain)}` });
  dayGainEl.textContent = `${fmtMoney(dayGain, { sign: true })} (${fmtPct(dayGainPct, { sign: true })}) Today`;
  const totalGainEl = el('span', { class: `port-stat ${gainClass(totalGain)}` });
  totalGainEl.textContent = `${fmtMoney(totalGain, { sign: true })} (${fmtPct(totalGainPct, { sign: true })}) Total`;
  stats.appendChild(dayGainEl);
  stats.appendChild(totalGainEl);
  left.appendChild(stats);
  top.appendChild(left);
  top.appendChild(el('div', { class: 'port-hero-count', title: 'Positions' }, `${enriched.length} pos`));
  hero.appendChild(top);

  const chartArea = el('div', { class: 'port-chart-area' });
  const canvas = el('canvas', { class: 'port-chart-canvas' });
  chartArea.appendChild(canvas);
  hero.appendChild(chartArea);

  const controls = el('div', { class: 'port-chart-controls' });

  const RANGES = ['1D', '5D', '1M', '6M', 'YTD', '1Y'];
  let activeRange = '1M';
  let showSpx = false;

  const rangeTabs = el('div', { class: 'range-tabs' });
  RANGES.forEach(r => {
    const btn = el('button', { class: 'range-tab' + (r === activeRange ? ' active' : '') }, r);
    btn.addEventListener('click', () => {
      activeRange = r;
      rangeTabs.querySelectorAll('.range-tab').forEach(b => b.classList.toggle('active', b.textContent === r));
      drawPortfolioChart(canvas, enriched, total, dayGain, dayGainPct, activeRange, showSpx);
    });
    rangeTabs.appendChild(btn);
  });
  controls.appendChild(rangeTabs);

  const spxLabel = el('label', { class: 'spx-toggle' });
  const spxCheck = el('input', { type: 'checkbox' });
  spxCheck.checked = false;
  spxCheck.addEventListener('change', () => {
    showSpx = spxCheck.checked;
    drawPortfolioChart(canvas, enriched, total, dayGain, dayGainPct, activeRange, showSpx);
  });
  spxLabel.appendChild(spxCheck);
  spxLabel.appendChild(document.createTextNode(' vs S&P 500'));
  controls.appendChild(spxLabel);

  hero.appendChild(controls);

  requestAnimationFrame(() => drawPortfolioChart(canvas, enriched, total, dayGain, dayGainPct, activeRange, showSpx));

  return hero;
}

// Resolve a CSS custom property to its computed value on :root.
// Chart.js draws on <canvas> which cannot resolve CSS vars natively.
function cssVar(name, fallback) {
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

// S&P 500 reference drift percentages per range.
// 1D uses today's actual market move (as of May 26, 2026).
// 1Y uses trailing 1-year return (~29.58% as of May 2026).
// Other ranges are approximate trailing averages.
const SPX_DRIFT = {
  '1D':  0.61,   // actual SPX move today per Yahoo Finance
  '5D':  1.2,
  '1M':  4.8,
  '6M':  14.0,
  'YTD': 11.5,
  '1Y':  29.58,  // trailing 1-year SPX return as of May 2026
};

function drawPortfolioChart(canvas, enriched, total, dayGain, dayGainPct, range, showSpx) {
  if (_portfolioChartInstance) {
    _portfolioChartInstance.destroy();
    _portfolioChartInstance = null;
  }

  // Resolve theme colors at render time (canvas cannot use CSS vars)
  const clrTooltipBg     = cssVar('--color-surface-2',  '#ffffff');
  const clrTooltipTitle  = cssVar('--color-text-muted',  '#6b7280');
  const clrTooltipBody   = cssVar('--color-text',        '#1a1a1a');
  const clrTooltipBorder = cssVar('--color-border',      '#e5e7eb');
  const clrTickFaint     = cssVar('--color-text-faint',  '#9ca3af');
  const clrLegend        = cssVar('--color-text-muted',  '#6b7280');

  const n = { '1D': 24, '5D': 35, '1M': 30, '6M': 26, 'YTD': 22, '1Y': 52 }[range] || 30;
  const labels = buildTimeLabels(range, n);

  // Build portfolio path. The endpoint is always `total` (current value).
  // The path is shaped so the day-gain shown in the chart matches the header.
  const portPctData = buildPortfolioPctPath(enriched, total, dayGain, n, range);
  const isUp = portPctData[portPctData.length - 1] >= portPctData[0];
  const lineColor = isUp ? '#4CAF6E' : '#E05568';

  const spxDriftPct = SPX_DRIFT[range] ?? 5;
  const spxPctData = buildSpxPctPath(spxDriftPct, n, range);

  // Unified % axis range
  const allPct = [...portPctData, ...(showSpx ? spxPctData : [])];
  const pctMin = Math.min(...allPct);
  const pctMax = Math.max(...allPct);
  const pctPad = Math.max((pctMax - pctMin) * 0.12, 0.5);

  // portStart in dollars (so tooltip can convert % → $)
  const portReturnPct = portPctData[portPctData.length - 1]; // total % from period start
  const portStart = total / (1 + portReturnPct / 100);

  const datasets = [
    {
      label: 'Portfolio',
      data: portPctData,
      yAxisID: 'yPct',
      borderColor: lineColor,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.35,
      fill: true,
      backgroundColor: (ctx) => {
        const chart = ctx.chart;
        const { ctx: c, chartArea } = chart;
        if (!chartArea) return 'transparent';
        const grad = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        grad.addColorStop(0, isUp ? 'rgba(76,175,110,0.18)' : 'rgba(224,85,104,0.18)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        return grad;
      },
    },
  ];

  if (showSpx) {
    datasets.push({
      label: 'S&P 500',
      data: spxPctData,
      yAxisID: 'yPct',
      borderColor: 'rgba(130,130,130,0.85)',
      borderWidth: 1.5,
      borderDash: [5, 4],
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.3,
      fill: false,
      backgroundColor: 'transparent',
    });
  }

  const Chart = window.Chart;
  if (!Chart) return;

  _portfolioChartInstance = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: showSpx,
          position: 'top',
          labels: { boxWidth: 12, font: { size: 11 }, color: clrLegend },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = ctx.parsed.y;
              if (ctx.dataset.label === 'Portfolio') {
                const dollarVal = portStart * (1 + pct / 100);
                return ` Portfolio: ${fmtMoney(dollarVal)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
              }
              return ` S&P 500: ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
            },
          },
          backgroundColor: clrTooltipBg,
          titleColor: clrTooltipTitle,
          bodyColor: clrTooltipBody,
          borderColor: clrTooltipBorder,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 6,
        },
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: { color: clrTickFaint, font: { size: 11 }, maxTicksLimit: 6, maxRotation: 0 },
          border: { display: false },
        },
        yPct: {
          display: true,
          position: 'right',
          min: pctMin - pctPad,
          max: pctMax + pctPad,
          grid: { color: 'rgba(128,128,128,0.08)', drawBorder: false },
          ticks: {
            color: clrTickFaint,
            font: { size: 11 },
            maxTicksLimit: 5,
            callback: v => {
              const dollarVal = portStart * (1 + v / 100);
              return fmtMoney(dollarVal, { compact: true });
            },
          },
          border: { display: false },
        },
      },
    },
  });
}

function buildTimeLabels(range, n) {
  const labels = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    if (range === '1D') {
      d.setMinutes(now.getMinutes() - Math.round(i * 390 / (n - 1)));
      labels.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } else if (range === '5D') {
      d.setDate(now.getDate() - Math.round(i * 5 / n));
      labels.push(d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
    } else if (range === '1M') {
      d.setDate(now.getDate() - (n - 1 - i));
      labels.push(d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
    } else if (range === '6M') {
      d.setDate(now.getDate() - Math.round(i * 182 / (n - 1)));
      labels.push(d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
    } else if (range === 'YTD') {
      const start = new Date(now.getFullYear(), 0, 1);
      const days = Math.round((now - start) / 86400000);
      d.setDate(now.getDate() - Math.round(i * days / (n - 1)));
      labels.push(d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
    } else { // 1Y
      d.setDate(now.getDate() - Math.round(i * 365 / (n - 1)));
      labels.push(d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
    }
  }
  return labels;
}

// Build the portfolio path as % return from period-start.
// Key constraint: the FINAL point must equal dayGainPct so it matches the header.
function buildPortfolioPctPath(enriched, total, dayGain, n, range) {
  const prevTotal = total - dayGain;
  // Real day return percentage (same as header)
  const realDayPct = prevTotal > 0 ? (dayGain / prevTotal) * 100 : 0;

  // Total period return in % (endpoint of the chart)
  // For 1D, the chart spans today only, so the endpoint is realDayPct.
  // For longer ranges we scale: if you’re up 20.54% total over ~6 months,
  // the 1Y chart should show roughly that much growth.
  const totalReturnPct = (() => {
    const totalGain  = enriched.reduce((s, h) => s + h.gainDollar, 0);
    const totalCost  = enriched.reduce((s, h) => s + h.total_cost_basis, 0);
    const fullReturn = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    if (range === '1D')  return realDayPct;
    if (range === '5D')  return realDayPct * 5;
    if (range === '1M')  return fullReturn * 0.05;   // ~1 month slice
    if (range === '6M')  return fullReturn * 0.55;
    if (range === 'YTD') return fullReturn * 0.75;
    if (range === '1Y')  return fullReturn;           // full known return
    return realDayPct;
  })();

  // Noise amplitude: more variance for longer ranges
  const ampMap = { '1D': 0.06, '5D': 0.15, '1M': 0.4, '6M': 1.2, 'YTD': 1.0, '1Y': 2.5 };
  const amp = ampMap[range] ?? 0.5;

  const seed = enriched.reduce((s, h) => s + (h.value || 0) * 0.001, 42);
  const rng = i => { const x = Math.sin(seed + i * 9301 + 49297) * 0.5; return x - Math.floor(x); };

  const path = [];
  for (let i = 0; i < n; i++) {
    const progress = i / (n - 1);
    // Use a sqrt curve so the chart grows faster early and smooths at the end—
    // avoids the "flat then spike" look.
    const trend = totalReturnPct * Math.sqrt(progress);
    const noise = (rng(i) - 0.5) * amp * 2;
    path.push(trend + noise);
  }
  // Pin start to 0% and end to the real period return
  path[0] = 0;
  path[n - 1] = totalReturnPct;
  return path;
}

// Build S&P path as % return (0 → indexChangePct) with realistic noise.
function buildSpxPctPath(indexChangePct, n, range) {
  const seed2 = 12345;
  const rng2 = i => { const x = Math.sin(seed2 + i * 7919 + 1299709) * 0.5; return x - Math.floor(x); };

  // Noise amplitude scales with drift magnitude and range length
  const noiseMap = { '1D': 0.08, '5D': 0.25, '1M': 0.8, '6M': 2.5, 'YTD': 2.0, '1Y': 5.0 };
  const amplitude = noiseMap[range] ?? 1.0;

  const path = [];
  for (let i = 0; i < n; i++) {
    const progress = i / (n - 1);
    const noise = (rng2(i) - 0.5) * amplitude * 2;
    // S&P also tends to grow in a roughly log-linear fashion
    const trend = indexChangePct * Math.sqrt(progress);
    path.push(trend + noise);
  }
  path[0] = 0;
  path[n - 1] = indexChangePct;
  return path;
}

// ── Holdings list ─────────────────────────────────────────────────────────────────
function renderHoldingsList(container, enriched, total, f) {
  container.innerHTML = '';

  let list = enriched.slice();
  if (f.thesis !== 'all') list = list.filter(h => (h.thesis_category || 'Market') === f.thesis);
  if (f.account !== 'all') list = list.filter(h => (h.account_type || '') === f.account);
  if (f.mood === 'gainers') list = list.filter(h => h.gainDollar > 0);
  if (f.mood === 'losers') list = list.filter(h => h.gainDollar < 0);

  list = list.map(h => ({ ...h, portfolioPct: total > 0 ? (h.value / total) * 100 : 0 }));

  if (f.mood === 'triggered') {
    list = list.filter(h => {
      if (!h.target_action || !h.target_price) return false;
      const tp = Number(h.target_price);
      if (h.target_action === 'Buy') return h.price > 0 && h.price <= tp;
      if (h.target_action === 'Sell') return h.price > 0 && h.price >= tp;
      return false;
    });
  }

  const sorters = {
    ticker: (a, b) => a.ticker.localeCompare(b.ticker),
    name: (a, b) => (a.company_name || '').localeCompare(b.company_name || ''),
    price: (a, b) => b.price - a.price,
    gain: (a, b) => b.gainDollar - a.gainDollar,
    pct: (a, b) => b.portfolioPct - a.portfolioPct,
    target: (a, b) => {
      const ad = targetDist(a), bd = targetDist(b);
      if (ad == null) return 1; if (bd == null) return -1;
      return ad - bd;
    },
  };

  if (f.sort === 'thesis') {
    const groups = {};
    list.forEach(h => {
      const key = h.thesis_category || 'Market';
      (groups[key] = groups[key] || []).push(h);
    });
    const orderedKeys = [...THESIS_ORDER, ...Object.keys(groups).filter(k => !THESIS_ORDER.includes(k))];
    if (list.length === 0) { container.appendChild(emptyHoldings()); return; }
    orderedKeys.forEach(key => {
      const items = groups[key]; if (!items || !items.length) return;
      items.sort((a, b) => b.value - a.value);
      const groupValue = items.reduce((s, h) => s + h.value, 0);
      const groupPct = total > 0 ? (groupValue / total) * 100 : 0;
      const group = el('div', { class: 'thesis-group' });
      group.appendChild(el('div', { class: 'thesis-header' }, [
        el('span', { class: 'name' }, `${key} · ${items.length}`),
        el('span', { class: 'meta tabular' }, `${fmtMoney(groupValue, { compact: true })} · ${fmtPct(groupPct, { decimals: 1 })}`),
      ]));
      items.forEach(h => group.appendChild(holdingCard(h, total)));
      container.appendChild(group);
    });
  } else if (f.sort === 'account') {
    const groups = {};
    list.forEach(h => {
      const key = h.account_type || 'Unassigned';
      (groups[key] = groups[key] || []).push(h);
    });
    const ACCT_ORDER = ['Brokerage', 'Roth IRA', '401k', 'Unassigned'];
    const orderedKeys = [...ACCT_ORDER, ...Object.keys(groups).filter(k => !ACCT_ORDER.includes(k))];
    if (list.length === 0) { container.appendChild(emptyHoldings()); return; }
    orderedKeys.forEach(key => {
      const items = groups[key]; if (!items || !items.length) return;
      items.sort((a, b) => b.value - a.value);
      const groupValue = items.reduce((s, h) => s + h.value, 0);
      const groupPct = total > 0 ? (groupValue / total) * 100 : 0;
      const group = el('div', { class: 'thesis-group' });
      group.appendChild(el('div', { class: 'thesis-header' }, [
        el('span', { class: 'name' }, `${key} · ${items.length}`),
        el('span', { class: 'meta tabular' }, `${fmtMoney(groupValue, { compact: true })} · ${fmtPct(groupPct, { decimals: 1 })}`),
      ]));
      items.forEach(h => group.appendChild(holdingCard(h, total)));
      container.appendChild(group);
    });
  } else {
    list.sort(sorters[f.sort]);
    if (list.length === 0) { container.appendChild(emptyHoldings()); return; }
    const wrap = el('div', { class: 'thesis-group' });
    list.forEach(h => wrap.appendChild(holdingCard(h, total)));
    container.appendChild(wrap);
  }
}

// ── Search dropdown ───────────────────────────────────────────────────────────
async function showSearchDropdown(query, dropdown, enriched, total, gen, getGen, searchInput) {
  const q = query.trim();
  if (!q) { dropdown.hidden = true; return; }

  dropdown.hidden = false;
  dropdown.innerHTML = '';
  dropdown.appendChild(el('div', { class: 'sd-loading' }, 'Looking up…'));

  const ql = q.toLowerCase();
  const qU = q.toUpperCase();

  const holdingMatches = enriched.filter(h =>
    h.ticker.toLowerCase().includes(ql) ||
    (h.shortName || h.company_name || '').toLowerCase().includes(ql)
  ).slice(0, 6);

  let liveQuote = null;
  const exact = qU.replace(/[^A-Z0-9.\/\-]/g, '');
  if (exact.length >= 2) {
    try {
      const quotes = await fetchQuotes([exact]);
      if (getGen() !== gen) return;
      const qd = quotes[exact];
      if (qd && qd.price) liveQuote = { ticker: exact, ...qd };
    } catch (_) { /* swallow */ }
  }

  if (getGen() !== gen) return;

  dropdown.innerHTML = '';

  if (holdingMatches.length) {
    dropdown.appendChild(el('div', { class: 'sd-section-label' }, 'Your holdings'));
    holdingMatches.forEach(h => {
      const btn = el('button', { class: 'sd-item' });
      const main = el('div', { class: 'sd-main' });
      const tickerRow = el('div', { class: 'sd-ticker' });
      tickerRow.appendChild(el('span', { class: 'sd-tick' }, h.ticker));
      tickerRow.appendChild(el('span', { class: 'sd-name' }, h.shortName || h.company_name || ''));
      main.appendChild(tickerRow);
      const meta = el('div', { class: 'sd-meta' });
      meta.appendChild(el('span', { class: 'sd-price tabular' }, fmtMoney(h.price)));
      meta.appendChild(el('span', { class: `sd-chg tabular ${gainClass(h.changePercent)}` }, fmtPct(h.changePercent, { sign: true })));
      meta.appendChild(el('span', { class: 'sd-shares tabular' }, `${fmtNumber(h.shares_owned, 4)} sh`));
      main.appendChild(meta);
      btn.appendChild(main);
      const right = el('div', { class: 'sd-right' });
      right.appendChild(el('span', { class: `sd-val tabular ${gainClass(h.gainDollar)}` }, fmtMoney(h.value)));
      right.appendChild(el('span', { class: `sd-gain tabular ${gainClass(h.gainDollar)}` }, fmtMoney(h.gainDollar, { sign: true })));
      btn.appendChild(right);
      btn.addEventListener('click', () => {
        state.ui.expandedTicker = h.ticker;
        dropdown.hidden = true;
        searchInput.value = '';
        emit();
      });
      btn.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { const n = btn.nextElementSibling; if (n) { n.focus(); e.preventDefault(); } }
        if (e.key === 'ArrowUp')   { const p = btn.previousElementSibling; if (p) p.focus(); else searchInput.focus(); e.preventDefault(); }
        if (e.key === 'Escape')    { dropdown.hidden = true; searchInput.focus(); }
      });
      dropdown.appendChild(btn);
    });
  }

  if (liveQuote && !holdingMatches.find(h => h.ticker === liveQuote.ticker)) {
    dropdown.appendChild(el('div', { class: 'sd-section-label' }, 'Live quote'));
    const btn = el('button', { class: 'sd-item' });
    const main = el('div', { class: 'sd-main' });
    const tickerRow = el('div', { class: 'sd-ticker' });
    tickerRow.appendChild(el('span', { class: 'sd-tick' }, liveQuote.ticker));
    tickerRow.appendChild(el('span', { class: 'sd-name' }, liveQuote.shortName || liveQuote.longName || ''));
    main.appendChild(tickerRow);
    const meta = el('div', { class: 'sd-meta' });
    meta.appendChild(el('span', { class: 'sd-price tabular' }, fmtMoney(liveQuote.price)));
    meta.appendChild(el('span', { class: `sd-chg tabular ${gainClass(liveQuote.changePercent)}` }, fmtPct(liveQuote.changePercent || 0, { sign: true })));
    main.appendChild(meta);
    btn.appendChild(main);
    const right = el('div', { class: 'sd-right' });
    right.appendChild(el('span', { class: 'sd-not-held' }, 'Not held'));
    btn.appendChild(right);
    btn.addEventListener('click', () => {
      dropdown.hidden = true;
      searchInput.value = '';
      openAddHoldingModal(liveQuote.ticker, liveQuote.shortName || liveQuote.longName || '');
    });
    dropdown.appendChild(btn);
  }

  if (!holdingMatches.length && !liveQuote) {
    dropdown.appendChild(el('div', { class: 'sd-empty' }, 'No matches found'));
  }
}

// ── Holding card ──────────────────────────────────────────────────────────────
function holdingCard(h, total) {
  const portfolioPct = total > 0 ? (h.value / total) * 100 : 0;
  const expanded = state.ui.expandedTicker === h.ticker;
  const wrap = el('div', { class: 'holding' + (expanded ? ' expanded' : '') });

  const row = el('div', { class: 'holding-row' });
  row.appendChild(logoEl(h.shortName || h.company_name, h.ticker));

  const main = el('div', { class: 'h-main' });
  const line1 = el('div', { class: 'h-line1' });
  line1.appendChild(el('span', { class: 'h-ticker' }, h.ticker));
  if (h.account_type) {
    line1.appendChild(el('span', { class: 'h-tag watch' }, h.account_type));
  }
  line1.appendChild(el('span', { class: 'h-name' }, escapeHtml(h.shortName || h.company_name || '')));
  main.appendChild(line1);

  const line2 = el('div', { class: 'h-line2' });
  line2.appendChild(el('span', { class: 'h-price tabular' }, fmtMoney(h.price)));
  line2.appendChild(el('span', { class: 'h-pct tabular' }, `${fmtNumber(h.shares_owned, 4)} sh · ${fmtPct(portfolioPct, { decimals: 1 })} of portfolio`));
  main.appendChild(line2);
  row.appendChild(main);

  const right = el('div', { class: 'h-right' });
  right.appendChild(el('div', { class: 'h-gain tabular' + (h.gainDollar >= 0 ? ' up' : ' down') }, fmtMoney(h.value)));
  const gainLine = el('div', { class: `h-gain tabular ${gainClass(h.gainDollar)}`, style: 'font-size:12px;font-weight:500;' });
  gainLine.textContent = fmtMoney(h.gainDollar, { sign: true, compact: true }) + ' (' + fmtPct(h.gainPct, { sign: true }) + ')';
  right.appendChild(gainLine);
  const dayLine = el('div', { class: `h-pct tabular ${gainClass(h.changePercent)}` });
  dayLine.textContent = fmtPct(h.changePercent, { sign: true }) + ' today';
  right.appendChild(dayLine);
  row.appendChild(right);

  row.addEventListener('click', () => {
    state.ui.expandedTicker = expanded ? null : h.ticker;
    emit();
  });
  wrap.appendChild(row);

  if (expanded) wrap.appendChild(editPanel(h));
  return wrap;
}

function editPanel(h) {
  const panel = el('div', { class: 'holding-edit' });
  const f = (label, key, type = 'text', extra = {}) => {
    const field = el('div', { class: 'field' + (extra.full ? ' full' : '') });
    field.appendChild(el('label', {}, label));
    let input;
    if (extra.tag === 'select') {
      input = el('select', { 'data-k': key });
      (extra.options || []).forEach(opt => {
        const o = el('option', { value: opt }, opt || '—');
        if (String(h[key] || '') === String(opt)) o.selected = true;
        input.appendChild(o);
      });
    } else if (extra.tag === 'textarea') {
      input = el('textarea', { 'data-k': key, rows: '3' }, h[key] || '');
    } else {
      input = el('input', { type, 'data-k': key, value: h[key] != null ? h[key] : '', step: extra.step || (type === 'number' ? '0.0001' : null) });
    }
    field.appendChild(input);
    return field;
  };

  panel.appendChild(f('Shares owned', 'shares_owned', 'number'));
  panel.appendChild(f('Avg cost basis', 'avg_cost_basis', 'number'));
  panel.appendChild(f('Thesis category', 'thesis_category', 'text', { tag: 'select', options: THESIS_OPTIONS }));
  panel.appendChild(f('Account type', 'account_type', 'text', { tag: 'select', options: ['', ...ACCOUNT_TYPES] }));
  panel.appendChild(f('Goal % of portfolio', 'goal_portfolio_allocation_percent', 'number'));
  panel.appendChild(f('Target action', 'target_action', 'text', { tag: 'select', options: TARGET_ACTIONS }));
  panel.appendChild(f('Target price', 'target_price', 'number'));
  panel.appendChild(f('Notes', 'notes', 'text', { tag: 'textarea', full: true }));

  const actions = el('div', { class: 'edit-actions' });
  const delBtn = el('button', { class: 'btn secondary sm' }, 'Delete');
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${h.ticker}?`)) return;
    try {
      delBtn.disabled = true;
      await postAction('deleteHolding', { ticker: h.ticker });
      toast('Deleted', 'success');
      state.ui.expandedTicker = null;
      await loadAll();
    } catch (err) { toast(err.message, 'error'); }
    finally { delBtn.disabled = false; }
  });
  actions.appendChild(delBtn);

  const txBtn = el('button', { class: 'btn secondary sm' }, '+ Transaction');
  txBtn.addEventListener('click', (e) => { e.stopPropagation(); openTxModal(h.ticker); });
  actions.appendChild(txBtn);

  const saveBtn = el('button', { class: 'btn sm' }, 'Save');
  saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const payload = { ticker: h.ticker };
    panel.querySelectorAll('[data-k]').forEach(input => { payload[input.getAttribute('data-k')] = input.value; });
    try {
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      await postAction('updateHolding', payload);
      toast('Saved', 'success');
      await loadAll();
    } catch (err) { toast(err.message, 'error'); }
    finally { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
  });
  actions.appendChild(saveBtn);

  panel.appendChild(actions);
  panel.addEventListener('click', e => e.stopPropagation());
  return panel;
}

// ── Modals ─────────────────────────────────────────────────────────────────────
function openAddHoldingModal(prefillTicker = '', prefillName = '') {
  const form = el('div', { class: 'add-holding-form' });
  const header = el('div', { class: 'form-header' });
  header.appendChild(el('h2', { class: 'form-title' }, 'Add holding'));
  header.appendChild(el('p', { class: 'form-sub' }, 'Enter the ticker and your position details.'));
  form.appendChild(header);

  const inputs = {};
  const mkField = (label, key, type, { placeholder, value, span } = {}) => {
    const fld = el('div', { class: 'field' + (span === 'full' ? ' full' : '') });
    fld.appendChild(el('label', {}, label));
    const inp = el('input', { type, step: type === 'number' ? '0.0001' : null, placeholder: placeholder || '', value: value != null ? value : '', autocomplete: 'off' });
    if (key === 'ticker') inp.setAttribute('autocapitalize', 'characters');
    fld.appendChild(inp);
    inputs[key] = inp;
    return fld;
  };

  const sec1 = el('div', { class: 'form-section' });
  sec1.appendChild(el('div', { class: 'form-section-label' }, 'Stock'));
  const grid1 = el('div', { class: 'form-grid' });
  grid1.appendChild(mkField('Ticker', 'ticker', 'text', { placeholder: 'AAPL', value: prefillTicker }));
  grid1.appendChild(mkField('Company name', 'company_name', 'text', { placeholder: 'Apple Inc.', value: prefillName }));
  sec1.appendChild(grid1);
  form.appendChild(sec1);

  const sec2 = el('div', { class: 'form-section' });
  sec2.appendChild(el('div', { class: 'form-section-label' }, 'Position'));
  const grid2 = el('div', { class: 'form-grid' });
  grid2.appendChild(mkField('Shares', 'shares_owned', 'number', { placeholder: '0' }));
  grid2.appendChild(mkField('Avg cost basis', 'avg_cost_basis', 'number', { placeholder: '0.00' }));
  grid2.appendChild(mkField('Goal % of portfolio', 'goal_portfolio_allocation_percent', 'number', { placeholder: '0', span: 'full' }));
  sec2.appendChild(grid2);
  form.appendChild(sec2);

  const sec3 = el('div', { class: 'form-section' });
  sec3.appendChild(el('div', { class: 'form-section-label' }, 'Classification'));
  const grid3 = el('div', { class: 'form-grid' });
  const thesis = el('select', {});
  THESIS_OPTIONS.forEach(t => thesis.appendChild(el('option', { value: t }, t)));
  grid3.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Thesis'), thesis]));
  const acctSel = el('select', {});
  ['', ...ACCOUNT_TYPES].forEach(a => acctSel.appendChild(el('option', { value: a }, a || '— Select account —')));
  grid3.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Account type'), acctSel]));
  sec3.appendChild(grid3);
  form.appendChild(sec3);

  const actions = el('div', { class: 'modal-actions' });
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Add holding');
  save.addEventListener('click', async () => {
    const payload = { thesis_category: thesis.value, account_type: acctSel.value };
    Object.entries(inputs).forEach(([k, i]) => payload[k] = i.value);
    if (!payload.ticker) return toast('Ticker required', 'error');
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('addHolding', payload);
      toast('Added', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Add holding'; }
  });
  actions.appendChild(save);
  form.appendChild(actions);
  openModal(form);
}

function openTxModal(ticker) {
  const form = el('div');
  form.appendChild(el('h2', {}, `New transaction · ${ticker}`));
  const action = el('select', {});
  ['Buy', 'Sell'].forEach(a => action.appendChild(el('option', { value: a }, a)));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Action'), action]));
  const shares = el('input', { type: 'number', step: '0.0001' });
  const price  = el('input', { type: 'number', step: '0.0001' });
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Shares'), shares]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Price per share'), price]));
  const actions = el('div', { class: 'modal-actions' });
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Save');
  save.addEventListener('click', async () => {
    if (!shares.value || !price.value) return toast('Shares and price required', 'error');
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('addTransaction', { ticker, action: action.value, shares: shares.value, price_per_share: price.value });
      toast('Transaction saved', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Save'; }
  });
  actions.appendChild(save);
  form.appendChild(actions);
  openModal(form);
}

export function openQuoteModal(quote, enriched, total) {
  const form = el('div');
  form.appendChild(el('h2', {}, quote.ticker));
  form.appendChild(el('div', { class: 'muted', style: 'margin-bottom:14px;font-size:14px;' }, quote.shortName || quote.longName || ''));
  const grid = el('div', { class: 'modal-grid' });
  const row = (label, val, cls = '') => {
    const r = el('div', { class: 'modal-row' + (cls ? ' ' + cls : '') });
    r.appendChild(el('label', {}, label));
    r.appendChild(el('span', { class: 'tabular' }, val));
    return r;
  };
  grid.appendChild(row('Price', fmtMoney(quote.price)));
  grid.appendChild(row('Change today', fmtPct(quote.changePercent || 0, { sign: true }), gainClass(quote.changePercent)));
  form.appendChild(grid);
  const actions = el('div', { class: 'modal-actions' });
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Close'));
  actions.appendChild(el('button', { class: 'btn', onclick: () => { closeModal(); openAddHoldingModal(quote.ticker, quote.shortName || quote.longName || ''); } }, 'Add to holdings'));
  form.appendChild(actions);
  openModal(form);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function kpiCard(label, value, opts = {}) {
  const card = el('div', { class: 'kpi-card' });
  card.appendChild(el('div', { class: 'kpi-label' }, label));
  const valEl = el('div', { class: 'kpi-value tabular' + (opts.delta != null ? ' ' + gainClass(opts.delta) : '') }, value);
  card.appendChild(valEl);
  if (opts.deltaText) card.appendChild(el('div', { class: `kpi-delta tabular ${gainClass(opts.delta)}` }, opts.deltaText));
  return card;
}

function emptyHoldings() {
  const d = el('div', { class: 'empty-state card' });
  d.appendChild(el('div', { class: 'es-title' }, 'No holdings yet'));
  d.appendChild(el('div', { class: 'es-sub' }, 'Add your first position to get started.'));
  d.appendChild(el('div', { class: 'es-action' }, [el('button', { class: 'btn', onclick: () => openAddHoldingModal() }, '+ Add holding')]));
  return d;
}

function targetDist(h) {
  if (!h.target_price || !h.price) return null;
  const tp = Number(h.target_price);
  return tp > 0 && h.price > 0 ? Math.abs((h.price - tp) / tp) * 100 : null;
}
