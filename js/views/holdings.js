import { state, getEnrichedHoldings, totalPortfolioValue, emit, loadAll } from '../state.js';
import { el, fmtMoney, fmtPct, fmtNumber, logoEl, gainClass, toast, escapeHtml } from '../ui.js';
import { postAction } from '../api.js';
import { THESIS_OPTIONS, TARGET_ACTIONS } from '../config.js';

const THESIS_ORDER = ['Market', 'Tech', 'Dividend', 'Speculative'];

export function renderHoldings(root) {
  const enriched = getEnrichedHoldings();
  const total = totalPortfolioValue(enriched);
  const f = state.ui.holdingsFilter;

  // Toolbar
  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', { type: 'search', placeholder: 'Search ticker or name', value: f.search });
  search.addEventListener('input', () => { f.search = search.value; renderHoldings(root); });
  toolbar.appendChild(search);

  const thesis = el('select', {});
  ['all', ...THESIS_OPTIONS].forEach(t => {
    const o = el('option', { value: t }, t === 'all' ? 'All thesis' : t);
    if (f.thesis === t) o.selected = true;
    thesis.appendChild(o);
  });
  thesis.addEventListener('change', () => { f.thesis = thesis.value; renderHoldings(root); });
  toolbar.appendChild(thesis);

  const mood = el('select', {});
  [['all', 'All'], ['gainers', 'Gainers'], ['losers', 'Losers'], ['triggered', 'Triggered']].forEach(([v, l]) => {
    const o = el('option', { value: v }, l);
    if (f.mood === v) o.selected = true;
    mood.appendChild(o);
  });
  mood.addEventListener('change', () => { f.mood = mood.value; renderHoldings(root); });
  toolbar.appendChild(mood);

  const sort = el('select', {});
  [
    ['thesis', 'Group: thesis'],
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
  sort.addEventListener('change', () => { f.sort = sort.value; renderHoldings(root); });
  toolbar.appendChild(sort);

  const addBtn = el('button', { class: 'btn sm', onclick: () => openAddHoldingModal() }, '+ Add');
  toolbar.appendChild(addBtn);

  root.appendChild(toolbar);

  // Top KPI strip
  const totalGain = enriched.reduce((s, h) => s + h.gainDollar, 0);
  const totalCost = enriched.reduce((s, h) => s + h.total_cost_basis, 0);
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  const kpis = el('div', { class: 'kpi-grid' });
  kpis.appendChild(kpiCard('Portfolio value', fmtMoney(total)));
  kpis.appendChild(kpiCard('Unrealized P/L', fmtMoney(totalGain, { sign: true }), {
    deltaText: fmtPct(totalGainPct, { sign: true }), delta: totalGain,
  }));
  kpis.appendChild(kpiCard('Holdings', fmtNumber(enriched.length, 0)));
  root.appendChild(kpis);

  // Filter
  let list = enriched.slice();
  const q = f.search.trim().toLowerCase();
  if (q) list = list.filter(h => h.ticker.toLowerCase().includes(q) || (h.company_name || '').toLowerCase().includes(q));
  if (f.thesis !== 'all') list = list.filter(h => (h.thesis_category || 'Market') === f.thesis);
  if (f.mood === 'gainers') list = list.filter(h => h.gainDollar > 0);
  if (f.mood === 'losers') list = list.filter(h => h.gainDollar < 0);

  // Add portfolio %
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

  // Sort
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
    // Group by thesis
    const groups = {};
    list.forEach(h => {
      const key = h.thesis_category || 'Market';
      (groups[key] = groups[key] || []).push(h);
    });
    const orderedKeys = [...THESIS_ORDER, ...Object.keys(groups).filter(k => !THESIS_ORDER.includes(k))];
    if (list.length === 0) {
      root.appendChild(emptyHoldings());
      return;
    }
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
      root.appendChild(group);
    });
  } else {
    list.sort(sorters[f.sort]);
    if (list.length === 0) { root.appendChild(emptyHoldings()); return; }
    const wrap = el('div', { class: 'thesis-group' });
    list.forEach(h => wrap.appendChild(holdingCard(h, total)));
    root.appendChild(wrap);
  }
}

function targetDist(h) {
  if (!h.target_action || !h.target_price || !h.price) return null;
  return Math.abs(h.price - Number(h.target_price)) / Number(h.target_price);
}

function emptyHoldings() {
  return el('div', { class: 'empty-state card' }, [
    el('div', { class: 'es-title' }, 'No holdings yet'),
    el('div', { class: 'es-sub' }, 'Tap “+ Add” to log your first position.'),
  ]);
}

function kpiCard(label, value, opts = {}) {
  const card = el('div', { class: 'kpi' });
  card.appendChild(el('div', { class: 'kpi-label' }, label));
  card.appendChild(el('div', { class: 'kpi-value tabular' }, value));
  if (opts.deltaText !== undefined) {
    const cls = opts.delta > 0 ? 'up' : opts.delta < 0 ? 'down' : '';
    card.appendChild(el('div', { class: 'kpi-delta tabular ' + cls }, opts.deltaText));
  }
  return card;
}

function holdingCard(h, total) {
  const expanded = state.ui.expandedTicker === h.ticker;
  const wrap = el('div', { class: 'holding' + (expanded ? ' expanded' : '') });
  const portfolioPct = total > 0 ? (h.value / total) * 100 : 0;
  const goalPct = Number(h.goal_portfolio_allocation_percent) || 0;
  const drift = goalPct > 0 ? portfolioPct - goalPct : 0;

  const triggered = (() => {
    if (!h.target_action || !h.target_price || !h.price) return false;
    const tp = Number(h.target_price);
    if (h.target_action === 'Buy') return h.price <= tp;
    if (h.target_action === 'Sell') return h.price >= tp;
    return false;
  })();

  // Top row
  const row = el('div', { class: 'holding-row' });
  row.appendChild(logoEl(h.shortName || h.company_name, h.ticker, h.logoDomain));

  const main = el('div', { class: 'h-main' });
  const line1 = el('div', { class: 'h-line1' }, [
    el('span', { class: 'h-ticker' }, h.ticker),
    el('span', { class: 'h-name' }, h.company_name || h.shortName || ''),
  ]);
  main.appendChild(line1);
  const pctLine = `${fmtNumber(h.shares_owned, 4)} sh · ${fmtPct(portfolioPct, { decimals: 1 })} of port`;
  const driftFlag = goalPct > 0 ? (drift > 0.5 ? ` · over ${fmtPct(drift, { sign: true, decimals: 1 })}` : drift < -0.5 ? ` · under ${fmtPct(drift, { sign: true, decimals: 1 })}` : '') : '';
  main.appendChild(el('div', { class: 'h-line2' }, [
    el('span', { class: 'h-price tabular' }, fmtMoney(h.price)),
    el('span', { class: 'h-pct tabular' }, pctLine + driftFlag),
  ]));
  row.appendChild(main);

  const right = el('div', { class: 'h-right' });
  const gainLine = `${fmtMoney(h.gainDollar, { sign: true, compact: true })}`;
  right.appendChild(el('div', { class: 'h-gain tabular ' + gainClass(h.gainDollar) }, gainLine));
  right.appendChild(el('div', { class: 'h-pct tabular ' + gainClass(h.gainPct) }, fmtPct(h.gainPct, { sign: true, decimals: 2 })));
  if (h.target_action) {
    const tagCls = 'h-tag ' + (h.target_action === 'Buy' ? 'buy' : h.target_action === 'Sell' ? 'sell' : 'watch') + (triggered ? ' triggered' : '');
    right.appendChild(el('div', { class: tagCls }, h.target_action + (h.target_price ? ` ${fmtMoney(Number(h.target_price))}` : '')));
  }
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

/* Modals */
import { openModal, closeModal } from '../ui.js';
function openAddHoldingModal() {
  const form = el('div');
  form.appendChild(el('h2', {}, 'Add holding'));
  const fields = [
    ['Ticker', 'ticker', 'text'],
    ['Company name', 'company_name', 'text'],
    ['Shares', 'shares_owned', 'number'],
    ['Avg cost basis', 'avg_cost_basis', 'number'],
    ['Goal % of portfolio', 'goal_portfolio_allocation_percent', 'number'],
  ];
  const inputs = {};
  fields.forEach(([l, k, t]) => {
    const fld = el('div', { class: 'field' });
    fld.appendChild(el('label', {}, l));
    const inp = el('input', { type: t, step: t === 'number' ? '0.0001' : null });
    fld.appendChild(inp); inputs[k] = inp; form.appendChild(fld);
  });
  const thesis = el('select', {});
  THESIS_OPTIONS.forEach(t => thesis.appendChild(el('option', { value: t }, t)));
  const tFld = el('div', { class: 'field' }, [el('label', {}, 'Thesis'), thesis]);
  form.appendChild(tFld);

  const actions = el('div', { class: 'modal-actions' });
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Add');
  save.addEventListener('click', async () => {
    const payload = { thesis_category: thesis.value };
    Object.entries(inputs).forEach(([k, i]) => payload[k] = i.value);
    if (!payload.ticker) return toast('Ticker required', 'error');
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('addHolding', payload);
      toast('Added', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Add'; }
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
  const price = el('input', { type: 'number', step: '0.0001' });
  const date = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Shares'), shares]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Price/share'), price]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Date'), date]));

  const actions = el('div', { class: 'modal-actions' });
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Save & apply');
  save.addEventListener('click', async () => {
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('addTransaction', {
        ticker, action: action.value,
        shares: shares.value, price_per_share: price.value, date: date.value,
        applyToHolding: true,
      });
      toast('Transaction logged', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Save & apply'; }
  });
  actions.appendChild(save);
  form.appendChild(actions);
  openModal(form);
}
