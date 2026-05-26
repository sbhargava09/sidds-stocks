import { state, getEnrichedHoldings, totalPortfolioValue, getEnrichedTargets, getTriggeredTargets } from '../state.js';
import { el, fmtMoney, fmtPct, fmtNumber } from '../ui.js';

const CHART_COLORS = ['#01696F', '#A84B2F', '#1B474D', '#BCE2E7', '#944454', '#FFC553', '#848456', '#6E522B'];

let chartInstances = [];

export function renderAnalytics(root) {
  // Cleanup previous charts
  chartInstances.forEach(c => { try { c.destroy(); } catch {} });
  chartInstances = [];

  const enriched = getEnrichedHoldings();
  const total = totalPortfolioValue(enriched);
  const totalCost = enriched.reduce((s, h) => s + h.total_cost_basis, 0);
  const totalGain = total - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  const triggered = getTriggeredTargets();

  if (!enriched.length) {
    root.appendChild(el('div', { class: 'empty-state card' }, [
      el('div', { class: 'es-title' }, 'No data yet'),
      el('div', { class: 'es-sub' }, 'Add holdings to see analytics.'),
    ]));
    return;
  }

  // Non-market holdings for top 10 chart and top 5 concentration
  const nonMarket = enriched.filter(h => (h.thesis_category || '').toLowerCase() !== 'market');
  const nonMarketTotal = nonMarket.reduce((s, h) => s + h.value, 0);

  // KPIs
  const kpis = el('div', { class: 'kpi-grid' });
  kpis.appendChild(kpi('Portfolio value', fmtMoney(total)));
  kpis.appendChild(kpi('Unrealized P/L', fmtMoney(totalGain, { sign: true }), totalGainPct, true));
  kpis.appendChild(kpi('Return %', fmtPct(totalGainPct, { sign: true }), totalGainPct, true));
  kpis.appendChild(kpi('Holdings', fmtNumber(enriched.length, 0)));
  kpis.appendChild(kpi('Alerts', fmtNumber(triggered.length, 0)));
  root.appendChild(kpis);

  // Allocation section
  root.appendChild(el('h3', { class: 'section-title' }, 'Allocation'));
  const allocCard = el('div', { class: 'card chart-card' });
  allocCard.appendChild(el('div', { class: 'card-title' }, 'By thesis category'));
  const donutWrap = el('div', { class: 'chart-wrap' });
  const donutCanvas = el('canvas');
  donutWrap.appendChild(donutCanvas);
  allocCard.appendChild(donutWrap);
  root.appendChild(allocCard);
  setTimeout(() => drawDonut(donutCanvas, enriched, total), 0);

  const top10Card = el('div', { class: 'card chart-card' });
  top10Card.appendChild(el('div', { class: 'card-title' }, 'Top 10 holdings by weight (excl. Market)'));
  const barWrap = el('div', { class: 'chart-wrap' });
  const barCanvas = el('canvas');
  barWrap.appendChild(barCanvas);
  top10Card.appendChild(barWrap);
  root.appendChild(top10Card);
  // Percentages relative to non-market subtotal so bars are meaningful
  setTimeout(() => drawTop10(barCanvas, nonMarket, nonMarketTotal), 0);

  // Top 5 concentration (excl. Market, % of non-market subtotal)
  const sortedByValue = [...nonMarket].sort((a, b) => b.value - a.value);
  const top5Sum = sortedByValue.slice(0, 5).reduce((s, h) => s + h.value, 0);
  const top5Pct = nonMarketTotal > 0 ? (top5Sum / nonMarketTotal) * 100 : 0;
  const concCard = el('div', { class: 'card' });
  concCard.appendChild(el('div', { class: 'card-title' }, 'Top 5 concentration (excl. Market)'));
  concCard.appendChild(el('div', { class: 'kpi-value tabular' }, fmtPct(top5Pct, { decimals: 1 })));
  concCard.appendChild(el('div', { class: 'faint' }, sortedByValue.slice(0, 5).map(h => h.ticker).join(' · ')));
  root.appendChild(concCard);

  // Performance
  root.appendChild(el('h3', { class: 'section-title' }, 'Performance'));
  const dayChange = enriched.filter(h => isFinite(h.changePercent) && h.changePercent !== 0);
  const topGainers = [...dayChange].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
  const topLosers = [...dayChange].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
  const bestDollar = [...enriched].sort((a, b) => b.gainDollar - a.gainDollar).slice(0, 5);
  const worstDollar = [...enriched].sort((a, b) => a.gainDollar - b.gainDollar).slice(0, 5);

  const perfGrid = el('div', { class: 'kpi-grid' });
  perfGrid.appendChild(listCard('Top day gainers', topGainers, h => fmtPct(h.changePercent, { sign: true }), 'up'));
  perfGrid.appendChild(listCard('Top day losers', topLosers, h => fmtPct(h.changePercent, { sign: true }), 'down'));
  perfGrid.appendChild(listCard('Best by $ gain', bestDollar, h => fmtMoney(h.gainDollar, { sign: true, compact: true }), 'up'));
  perfGrid.appendChild(listCard('Worst by $ loss', worstDollar, h => fmtMoney(h.gainDollar, { sign: true, compact: true }), 'down'));
  root.appendChild(perfGrid);

  // Action section
  root.appendChild(el('h3', { class: 'section-title' }, 'Actions'));
  const targets = getEnrichedTargets();
  const closestBuy = [...targets].filter(t => t.target_action === 'Buy' && !t.triggered && t.distancePct != null)
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct)).slice(0, 5);
  const closestSell = [...targets].filter(t => t.target_action === 'Sell' && !t.triggered && t.distancePct != null)
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct)).slice(0, 5);
  const recentTrig = triggered.slice(0, 5);

  const actGrid = el('div', { class: 'kpi-grid' });
  actGrid.appendChild(listCard('Closest to buy', closestBuy, t => fmtPct(t.distancePct, { sign: true, decimals: 1 }), ''));
  actGrid.appendChild(listCard('Closest to sell', closestSell, t => fmtPct(t.distancePct, { sign: true, decimals: 1 }), ''));
  actGrid.appendChild(listCard('Recently triggered', recentTrig, t => `${t.target_action} ${fmtMoney(t.target_price)}`, ''));
  root.appendChild(actGrid);

  // Future placeholder
  const futCard = el('div', { class: 'card' });
  futCard.appendChild(el('div', { class: 'card-title' }, 'Coming soon'));
  futCard.appendChild(el('div', { class: 'faint' }, 'Volatility · Sharpe · Sortino · Drawdown · Benchmarks'));
  root.appendChild(futCard);
}

function kpi(label, value, delta, isPct = false) {
  const card = el('div', { class: 'kpi' });
  card.appendChild(el('div', { class: 'kpi-label' }, label));
  card.appendChild(el('div', { class: 'kpi-value tabular' }, value));
  return card;
}

function listCard(title, items, valueFn, color) {
  const card = el('div', { class: 'kpi' });
  card.appendChild(el('div', { class: 'kpi-label' }, title));
  if (!items.length) { card.appendChild(el('div', { class: 'faint', style: 'margin-top:6px;' }, '—')); return card; }
  const list = el('div', { style: 'margin-top:6px;' });
  items.forEach(i => {
    const row = el('div', { style: 'display:flex;justify-content:space-between;font-size:13px;padding:3px 0;' });
    row.appendChild(el('span', {}, i.ticker));
    row.appendChild(el('span', { class: 'tabular ' + (color || '') }, valueFn(i)));
    list.appendChild(row);
  });
  card.appendChild(list);
  return card;
}

function drawDonut(canvas, enriched, total) {
  if (!window.Chart) return setTimeout(() => drawDonut(canvas, enriched, total), 100);
  const groups = {};
  enriched.forEach(h => {
    const k = h.thesis_category || 'Market';
    groups[k] = (groups[k] || 0) + h.value;
  });
  const labels = Object.keys(groups);
  const values = labels.map(l => groups[l]);
  const c = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: CHART_COLORS, borderColor: '#fff', borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 10, padding: 10 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed;
              const pct = total ? (v / total) * 100 : 0;
              return `${ctx.label}: ${fmtMoney(v)} (${fmtPct(pct, { decimals: 1 })})`;
            },
          },
        },
      },
    },
  });
  chartInstances.push(c);
}

function drawTop10(canvas, enriched, total) {
  if (!window.Chart) return setTimeout(() => drawTop10(canvas, enriched, total), 100);
  const sorted = [...enriched].sort((a, b) => b.value - a.value).slice(0, 10);
  const labels = sorted.map(h => h.ticker);
  const values = sorted.map(h => total ? (h.value / total) * 100 : 0);
  const c = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: '% of non-market holdings', data: values, backgroundColor: '#01696F', borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPct(ctx.parsed.x, { decimals: 1 }) } } },
      scales: {
        x: { ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: '#EFEEEA' } },
        y: { ticks: { font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
  chartInstances.push(c);
}
