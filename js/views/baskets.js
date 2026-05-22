import { state, loadAll, num } from '../state.js';
import { el, fmtMoney, fmtPct, fmtNumber, openModal, closeModal, toast, logoEl } from '../ui.js';
import { postAction } from '../api.js';

export function renderBaskets(root) {
  const baskets = state.baskets || [];

  const toolbar = el('div', { class: 'toolbar' });
  toolbar.appendChild(el('div', { class: 'spacer' }));
  toolbar.appendChild(el('button', { class: 'btn sm', onclick: openCreateBasketModal }, '+ New basket'));
  root.appendChild(toolbar);

  if (!baskets.length) {
    root.appendChild(el('div', { class: 'empty-state card' }, [
      el('div', { class: 'es-title' }, 'No baskets yet'),
      el('div', { class: 'es-sub' }, 'Group stocks like a custom ETF — set goal weights and track drift.'),
    ]));
    return;
  }

  baskets.forEach(b => root.appendChild(renderBasket(b)));
}

function renderBasket(b) {
  const constituents = state.basketHoldings.filter(c => c.basket_id === b.basket_id);
  let totalValue = 0;
  const enriched = constituents.map(c => {
    const q = state.quotes[c.ticker] || {};
    const holding = state.holdings.find(h => h.ticker === c.ticker);
    const shares = num(holding ? holding.shares_owned : 0);
    const price = num(q.price);
    const value = shares * price;
    totalValue += value;
    return { ...c, price, shares, value, q };
  });

  const goalSum = enriched.reduce((s, c) => s + num(c.goal_basket_allocation_percent), 0);

  const wrap = el('div', { class: 'basket' });
  const header = el('div', { class: 'basket-header' });
  const left = el('div');
  left.appendChild(el('h3', { class: 'basket-name' }, b.basket_name));
  if (b.description) left.appendChild(el('div', { class: 'faint' }, b.description));
  left.appendChild(el('div', { class: 'basket-stat tabular' }, [
    el('span', {}, 'Value: ' + fmtMoney(totalValue)),
    el('span', {}, `Components: ${constituents.length}`),
    el('span', { class: goalSum === 100 ? 'up' : 'down' }, `Goal sum: ${fmtPct(goalSum, { decimals: 1 })}` + (goalSum !== 100 ? ' ⚠' : '')),
  ]));
  header.appendChild(left);

  const actions = el('div');
  actions.appendChild(el('button', { class: 'btn ghost sm', onclick: () => openAddBasketHoldingModal(b) }, '+ Stock'));
  actions.appendChild(el('button', { class: 'btn secondary sm', onclick: () => openEditBasketModal(b) }, 'Edit'));
  header.appendChild(actions);
  wrap.appendChild(header);

  if (!enriched.length) {
    wrap.appendChild(el('div', { class: 'faint', style: 'margin-top:12px;' }, 'No stocks yet — tap “+ Stock”.'));
    return wrap;
  }

  // Components
  enriched.forEach(c => {
    const comp = el('div', { class: 'basket-comp' });
    comp.appendChild(logoEl(c.company_name, c.ticker, guessDomain(c.company_name, c.ticker)));

    const main = el('div');
    const currentPct = totalValue > 0 ? (c.value / totalValue) * 100 : 0;
    const goalPct = num(c.goal_basket_allocation_percent);
    const drift = currentPct - goalPct;
    const overweight = drift > 1, underweight = drift < -1;

    main.appendChild(el('div', { class: 'h-line1' }, [
      el('span', { class: 'h-ticker' }, c.ticker),
      el('span', { class: 'h-name' }, c.company_name || ''),
    ]));
    main.appendChild(el('div', { class: 'target-meta tabular' }, [
      el('span', {}, `${fmtNumber(c.shares, 4)} sh · ${fmtMoney(c.value, { compact: true })}`),
    ]));
    const bar = el('div', { class: 'basket-bar ' + (overweight ? 'over' : underweight ? 'under' : '') });
    bar.appendChild(el('div', { style: `width:${Math.min(100, Math.max(0, currentPct)).toFixed(1)}%` }));
    main.appendChild(bar);
    comp.appendChild(main);

    const right = el('div', { class: 'tabular', style: 'text-align:right;' });
    right.appendChild(el('div', {}, fmtPct(currentPct, { decimals: 1 })));
    right.appendChild(el('div', { class: 'faint' }, `goal ${fmtPct(goalPct, { decimals: 1 })}`));
    if (Math.abs(drift) > 0.05) {
      const cls = overweight ? 'down' : underweight ? 'up' : '';
      right.appendChild(el('div', { class: cls }, (drift > 0 ? 'over ' : 'under ') + fmtPct(drift, { sign: true, decimals: 1 })));
    }
    const editBtn = el('button', { class: 'btn ghost sm', style: 'margin-top:4px;padding:2px 6px;font-size:12px;' }, 'Edit');
    editBtn.addEventListener('click', () => openEditConstituentModal(c));
    right.appendChild(editBtn);
    comp.appendChild(right);

    wrap.appendChild(comp);
  });

  // Rebalance hint
  const rebal = enriched.map(c => {
    const cur = totalValue > 0 ? (c.value / totalValue) * 100 : 0;
    const goal = num(c.goal_basket_allocation_percent);
    const targetVal = (goal / 100) * totalValue;
    return { ticker: c.ticker, deltaDollar: targetVal - c.value, drift: cur - goal };
  }).filter(r => Math.abs(r.drift) > 1);
  if (rebal.length) {
    const hint = el('div', { class: 'card', style: 'margin-top:14px;background:var(--surface-2);' });
    hint.appendChild(el('div', { class: 'card-title' }, 'Rebalance suggestions'));
    rebal.sort((a, b) => Math.abs(b.deltaDollar) - Math.abs(a.deltaDollar));
    rebal.forEach(r => {
      const action = r.deltaDollar > 0 ? 'Add' : 'Trim';
      hint.appendChild(el('div', { style: 'display:flex;justify-content:space-between;font-size:13px;padding:2px 0;' }, [
        el('span', {}, `${action} ${r.ticker}`),
        el('span', { class: 'tabular ' + (r.deltaDollar > 0 ? 'up' : 'down') }, fmtMoney(Math.abs(r.deltaDollar))),
      ]));
    });
    wrap.appendChild(hint);
  }

  return wrap;
}

function guessDomain(name, ticker) {
  const n = (name || ticker || '').toLowerCase().replace(/\s+(inc|corp|corporation|company|co\.?|ltd|llc|plc|holdings|group|the)\b/g, '').trim();
  const word = n.split(/[\s,&]+/)[0];
  if (!word || word.length < 2) return null;
  return word.replace(/[^a-z0-9-]/g, '') + '.com';
}

function openCreateBasketModal() {
  const form = el('div');
  form.appendChild(el('h2', {}, 'New basket'));
  const name = el('input', { placeholder: 'e.g. Mag 7' });
  const desc = el('input', { placeholder: 'Optional description' });
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Name'), name]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Description'), desc]));
  const actions = el('div', { class: 'modal-actions' });
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Create');
  save.addEventListener('click', async () => {
    if (!name.value) return toast('Name required', 'error');
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('addBasket', { basket_name: name.value, description: desc.value });
      toast('Created', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Create'; }
  });
  actions.appendChild(save);
  form.appendChild(actions);
  openModal(form);
}

function openEditBasketModal(b) {
  const form = el('div');
  form.appendChild(el('h2', {}, 'Edit basket'));
  const name = el('input', { value: b.basket_name });
  const desc = el('input', { value: b.description || '' });
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Name'), name]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Description'), desc]));
  const actions = el('div', { class: 'modal-actions' });
  const del = el('button', { class: 'btn secondary' }, 'Delete');
  del.addEventListener('click', async () => {
    if (!confirm('Delete this basket and all its constituents?')) return;
    try { del.disabled = true; await postAction('deleteBasket', { basket_id: b.basket_id }); toast('Deleted', 'success'); closeModal(); await loadAll(); }
    catch (e) { toast(e.message, 'error'); del.disabled = false; }
  });
  actions.appendChild(del);
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Save');
  save.addEventListener('click', async () => {
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('updateBasket', { basket_id: b.basket_id, basket_name: name.value, description: desc.value });
      toast('Saved', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Save'; }
  });
  actions.appendChild(save);
  form.appendChild(actions);
  openModal(form);
}

function openAddBasketHoldingModal(b) {
  const form = el('div');
  form.appendChild(el('h2', {}, `Add stock to ${b.basket_name}`));
  const ticker = el('input', { placeholder: 'AAPL' });
  const company = el('input', { placeholder: 'Apple Inc.' });
  const goal = el('input', { type: 'number', step: '0.01', placeholder: 'e.g. 14.3' });
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Ticker'), ticker]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Company'), company]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Goal % of basket'), goal]));
  const actions = el('div', { class: 'modal-actions' });
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Add');
  save.addEventListener('click', async () => {
    if (!ticker.value) return toast('Ticker required', 'error');
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('addBasketHolding', {
        basket_id: b.basket_id,
        ticker: ticker.value, company_name: company.value,
        goal_basket_allocation_percent: goal.value,
      });
      toast('Added', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Add'; }
  });
  actions.appendChild(save);
  form.appendChild(actions);
  openModal(form);
}

function openEditConstituentModal(c) {
  const form = el('div');
  form.appendChild(el('h2', {}, `Edit ${c.ticker}`));
  const goal = el('input', { type: 'number', step: '0.01', value: c.goal_basket_allocation_percent });
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Goal % of basket'), goal]));
  const actions = el('div', { class: 'modal-actions' });
  const del = el('button', { class: 'btn secondary' }, 'Remove');
  del.addEventListener('click', async () => {
    if (!confirm('Remove from basket?')) return;
    try { del.disabled = true; await postAction('removeBasketHolding', { basket_holding_id: c.basket_holding_id }); toast('Removed', 'success'); closeModal(); await loadAll(); }
    catch (e) { toast(e.message, 'error'); del.disabled = false; }
  });
  actions.appendChild(del);
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Save');
  save.addEventListener('click', async () => {
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('updateBasketHolding', {
        basket_holding_id: c.basket_holding_id,
        goal_basket_allocation_percent: goal.value,
      });
      toast('Saved', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Save'; }
  });
  actions.appendChild(save);
  form.appendChild(actions);
  openModal(form);
}
