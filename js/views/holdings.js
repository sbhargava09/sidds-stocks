import { state, getEnrichedHoldings, totalPortfolioValue, emit, loadAll } from '../state.js';
import { el, fmtMoney, fmtPct, fmtNumber, logoEl, gainClass, toast, escapeHtml } from '../ui.js';
import { postAction, fetchQuotes } from '../api.js';
import { THESIS_OPTIONS, TARGET_ACTIONS, ACCOUNT_TYPES } from '../config.js';
import { openModal, closeModal } from '../ui.js';

const THESIS_ORDER = ['Market', 'Tech', 'Dividend', 'Speculative'];

export function renderHoldings(root) {
  root.innerHTML = ''; // FIX: clear on every render so keystroke results don't stack

  const enriched = getEnrichedHoldings();
  const total = totalPortfolioValue(enriched);
  const f = state.ui.holdingsFilter;

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const toolbar = el('div', { class: 'toolbar' });

  // Search with floating dropdown
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

  // Persistent list container — toolbar controls only repaint this
  const listContainer = el('div', { class: 'holdings-list-wrap' });

  let searchTimer = null;
  let searchGen = 0;
  search.addEventListener('input', () => {
    // Do NOT filter the holdings list — search is only for the dropdown (live quote / add)
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
    if (e.key === 'Escape') {
      dropdown.hidden = true;
      search.value = '';
    }
    if (e.key === 'ArrowDown') {
      const first = dropdown.querySelector('.sd-item');
      if (first) { first.focus(); e.preventDefault(); }
    }
  });

  // Close dropdown on outside click
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

  // ── KPI strip ──────────────────────────────────────────────────────────────
  const totalGain = enriched.reduce((s, h) => s + h.gainDollar, 0);
  const totalCost = enriched.reduce((s, h) => s + h.total_cost_basis, 0);
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  const kpis = el('div', { class: 'kpi-grid' });
  kpis.appendChild(kpiCard('Portfolio value', fmtMoney(total)));
  kpis.appendChild(kpiCard('Unrealized P/L', fmtMoney(totalGain, { sign: true }), {
    deltaText: fmtPct(totalGainPct, { sign: true }), delta: totalGain,
  }));
  kpis.appendChild(kpiCard('Positions', String(enriched.length)));
  root.appendChild(kpis);

  root.appendChild(listContainer);
  renderHoldingsList(listContainer, enriched, total, f);
}

// ── Holdings list (re-rendered on every filter/sort change) ──────────────────
function renderHoldingsList(container, enriched, total, f) {
  container.innerHTML = '';

  let list = enriched.slice();
  // NOTE: search input no longer filters this list — it only drives the dropdown
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

// ── Search dropdown (floating, with live quote for non-held tickers) ──────────
async function showSearchDropdown(query, dropdown, enriched, total, gen, getGen, searchInput) {
  const q = query.trim();
  if (!q) { dropdown.hidden = true; return; }

  dropdown.hidden = false;
  dropdown.innerHTML = '';
  dropdown.appendChild(el('div', { class: 'sd-loading' }, 'Looking up…'));

  const ql = q.toLowerCase();
  const qU = q.toUpperCase();

  // Holdings matching the current query (shown in dropdown for quick navigation)
  const holdingMatches = enriched.filter(h =>
    h.ticker.toLowerCase().includes(ql) ||
    (h.shortName || h.company_name || '').toLowerCase().includes(ql)
  ).slice(0, 6);

  // Live quote for the exact typed ticker — only fetch for 2+ char queries
  let liveQuote = null;
  const exact = qU.replace(/[^A-Z0-9.\\/\-]/g, '');
  if (exact.length >= 2) {
    try {
      const quotes = await fetchQuotes([exact]);
      if (getGen() !== gen) return; // stale — newer search started
      const qd = quotes[exact];
      if (qd && qd.price) liveQuote = { ticker: exact, ...qd };
    } catch (_) { /* swallow */ }
  }

  if (getGen() !== gen) return; // stale check before render

  dropdown.innerHTML = '';

  // ── Held matches ──
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
      meta.appendChild(el('span', { class: `sd-chg tabular ${gainClass(h.changePercent)}` },
        fmtPct(h.changePercent, { sign: true })));
      meta.appendChild(el('span', { class: 'sd-shares tabular' }, `${fmtNumber(h.shares_owned, 4)} sh`));
      main.appendChild(meta);
      btn.appendChild(main);
      const right = el('div', { class: 'sd-right' });
      right.appendChild(el('span', { class: `sd-val tabular ${gainClass(h.gainDollar)}` }, fmtMoney(h.value)));
      right.appendChild(el('span', { class: `sd-gain tabular ${gainClass(h.gainDollar)}` },
        fmtMoney(h.gainDollar, { sign: true })));
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

  // ── Live quote (if not already shown as a holding) ──
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
    meta.appendChild(el('span', { class: `sd-chg tabular ${gainClass(liveQuote.changePercent)}` },
      fmtPct(liveQuote.changePercent || 0, { sign: true })));
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

  // Left: ticker + name + price row
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

  // Right: value + gain
  const right = el('div', { class: 'h-right' });
  right.appendChild(el('div', { class: 'h-gain tabular' + (h.gainDollar >= 0 ? ' up' : ' down') },
    fmtMoney(h.value)));
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

  // Header
  const header = el('div', { class: 'form-header' });
  header.appendChild(el('h2', { class: 'form-title' }, 'Add holding'));
  header.appendChild(el('p', { class: 'form-sub' }, 'Enter the ticker and your position details.'));
  form.appendChild(header);

  // Helper to build a labeled field
  const inputs = {};
  const mkField = (label, key, type, { placeholder, value, span } = {}) => {
    const fld = el('div', { class: 'field' + (span === 'full' ? ' full' : '') });
    fld.appendChild(el('label', {}, label));
    const inp = el('input', {
      type,
      step: type === 'number' ? '0.0001' : null,
      placeholder: placeholder || '',
      value: value != null ? value : '',
      autocomplete: 'off',
    });
    if (key === 'ticker') inp.setAttribute('autocapitalize', 'characters');
    fld.appendChild(inp);
    inputs[key] = inp;
    return fld;
  };

  // Section 1: Identity
  const sec1 = el('div', { class: 'form-section' });
  sec1.appendChild(el('div', { class: 'form-section-label' }, 'Stock'));
  const grid1 = el('div', { class: 'form-grid' });
  grid1.appendChild(mkField('Ticker', 'ticker', 'text', { placeholder: 'AAPL', value: prefillTicker }));
  grid1.appendChild(mkField('Company name', 'company_name', 'text', { placeholder: 'Apple Inc.', value: prefillName }));
  sec1.appendChild(grid1);
  form.appendChild(sec1);

  // Section 2: Position
  const sec2 = el('div', { class: 'form-section' });
  sec2.appendChild(el('div', { class: 'form-section-label' }, 'Position'));
  const grid2 = el('div', { class: 'form-grid' });
  grid2.appendChild(mkField('Shares', 'shares_owned', 'number', { placeholder: '0' }));
  grid2.appendChild(mkField('Avg cost basis', 'avg_cost_basis', 'number', { placeholder: '0.00' }));
  grid2.appendChild(mkField('Goal % of portfolio', 'goal_portfolio_allocation_percent', 'number', { placeholder: '0', span: 'full' }));
  sec2.appendChild(grid2);
  form.appendChild(sec2);

  // Section 3: Classification (selects)
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

  // Actions
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

// ── Quick-view modal (from search dropdown) ────────────────────────────────────
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
  actions.appendChild(el('button', { class: 'btn', onclick: () => {
    closeModal();
    openAddHoldingModal(quote.ticker, quote.shortName || quote.longName || '');
  }}, 'Add to holdings'));
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
  d.appendChild(el('div', { class: 'es-action' }, [
    el('button', { class: 'btn', onclick: () => openAddHoldingModal() }, '+ Add holding'),
  ]));
  return d;
}

function targetDist(h) {
  if (!h.target_price || !h.price) return null;
  const tp = Number(h.target_price);
  return tp > 0 && h.price > 0 ? Math.abs((h.price - tp) / tp) * 100 : null;
}
