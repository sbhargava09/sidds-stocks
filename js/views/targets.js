import { state, getEnrichedTargets, markTriggersSeen, getTriggeredTargets, loadAll } from '../state.js';
import { el, fmtMoney, fmtPct, openModal, closeModal, toast, logoEl } from '../ui.js';
import { postAction } from '../api.js';
import { THESIS_OPTIONS } from '../config.js';

export function renderTargets(root) {
  const f = state.ui.targetsFilter;
  const all = getEnrichedTargets();

  // Toolbar
  const toolbar = el('div', { class: 'toolbar' });
  const kind = el('select', {});
  [['all', 'All actions'], ['Buy', 'Buy'], ['Sell', 'Sell'], ['Watch', 'Watch']].forEach(([v, l]) => {
    const o = el('option', { value: v }, l); if (f.kind === v) o.selected = true; kind.appendChild(o);
  });
  kind.addEventListener('change', () => { f.kind = kind.value; renderTargets(root); });
  toolbar.appendChild(kind);

  const owned = el('select', {});
  [['all', 'Owned + Watch'], ['owned', 'Owned only'], ['watch', 'Not owned']].forEach(([v, l]) => {
    const o = el('option', { value: v }, l); if (f.owned === v) o.selected = true; owned.appendChild(o);
  });
  owned.addEventListener('change', () => { f.owned = owned.value; renderTargets(root); });
  toolbar.appendChild(owned);

  const sort = el('select', {});
  [['closest', 'Closest to target'], ['triggered', 'Most overdue'], ['newest', 'Newest']].forEach(([v, l]) => {
    const o = el('option', { value: v }, l); if (f.sort === v) o.selected = true; sort.appendChild(o);
  });
  sort.addEventListener('change', () => { f.sort = sort.value; renderTargets(root); });
  toolbar.appendChild(sort);

  toolbar.appendChild(el('button', { class: 'btn sm', onclick: openWatchModal }, '+ Watchlist'));
  root.appendChild(toolbar);

  // Filter
  let list = all.slice();
  if (f.kind !== 'all') list = list.filter(t => t.target_action === f.kind);
  if (f.owned === 'owned') list = list.filter(t => t.owned);
  if (f.owned === 'watch') list = list.filter(t => !t.owned);

  // Sort
  if (f.sort === 'closest') {
    list.sort((a, b) => Math.abs(a.distancePct ?? 999) - Math.abs(b.distancePct ?? 999));
  } else if (f.sort === 'triggered') {
    list.sort((a, b) => (b.triggered ? 1 : 0) - (a.triggered ? 1 : 0));
  }

  // Mark triggers as seen
  markTriggersSeen(getTriggeredTargets());

  // Sections
  const sections = ['Buy', 'Sell', 'Watch'];
  const triggered = list.filter(t => t.triggered);
  if (triggered.length) {
    const sec = el('div', { class: 'target-section' });
    sec.appendChild(el('h3', { class: 'section-title' }, `Triggered · ${triggered.length}`));
    triggered.forEach(t => sec.appendChild(targetRow(t)));
    root.appendChild(sec);
  }

  sections.forEach(act => {
    const items = list.filter(t => t.target_action === act && !t.triggered);
    if (!items.length && (f.kind !== 'all' && f.kind !== act)) return;
    const sec = el('div', { class: 'target-section' });
    sec.appendChild(el('h3', { class: 'section-title' }, `${act} · ${items.length}`));
    if (!items.length) sec.appendChild(el('div', { class: 'card faint' }, `No ${act.toLowerCase()} targets.`));
    items.forEach(t => sec.appendChild(targetRow(t)));
    root.appendChild(sec);
  });
}

function targetRow(t) {
  const wrap = el('div', { class: 'target-row' + (t.triggered ? ' triggered' : '') });
  wrap.appendChild(logoEl(t.company_name, t.ticker, guessDomain(t.company_name, t.ticker)));

  const main = el('div');
  main.appendChild(el('div', { class: 'h-line1' }, [
    el('span', { class: 'h-ticker' }, t.ticker),
    el('span', { class: 'h-name' }, t.company_name || ''),
  ]));
  const meta = `${t.owned ? 'Owned' : 'Watchlist'} · ${t.thesis_category || 'Market'}`;
  main.appendChild(el('div', { class: 'target-meta' }, meta));
  // Progress bar
  const pb = el('div', { class: 'target-progress' + (t.triggered ? ' triggered' : '') });
  let progressPct = 0;
  if (t.price > 0 && t.target_price > 0) {
    if (t.target_action === 'Buy') {
      // closer to target as price drops; full when price <= target
      progressPct = Math.min(100, Math.max(0, (1 - (t.price - t.target_price) / t.price) * 100));
    } else if (t.target_action === 'Sell') {
      progressPct = Math.min(100, Math.max(0, (1 - (t.target_price - t.price) / t.target_price) * 100));
    }
  }
  pb.appendChild(el('div', { style: `width:${progressPct.toFixed(1)}%` }));
  main.appendChild(pb);
  wrap.appendChild(main);

  const center = el('div', { class: 'tabular', style: 'text-align:right;' });
  center.appendChild(el('div', {}, fmtMoney(t.price)));
  center.appendChild(el('div', { class: 'faint' }, `→ ${fmtMoney(t.target_price)}`));
  if (t.distancePct != null) {
    center.appendChild(el('div', { class: 'faint' }, fmtPct(t.distancePct, { sign: true, decimals: 1 })));
  }
  wrap.appendChild(center);

  const right = el('div');
  const tagCls = 'h-tag ' + (t.target_action === 'Buy' ? 'buy' : t.target_action === 'Sell' ? 'sell' : 'watch') + (t.triggered ? ' triggered' : '');
  right.appendChild(el('div', { class: tagCls }, t.target_action));
  const editBtn = el('button', { class: 'btn ghost sm', style: 'padding:4px 6px;margin-top:4px;' }, 'Edit');
  editBtn.addEventListener('click', () => openTargetEdit(t));
  right.appendChild(editBtn);
  wrap.appendChild(right);

  return wrap;
}

function guessDomain(name, ticker) {
  const n = (name || ticker || '').toLowerCase().replace(/\s+(inc|corp|corporation|company|co\.?|ltd|llc|plc|holdings|group|the)\b/g, '').trim();
  const word = n.split(/[\s,&]+/)[0];
  if (!word || word.length < 2) return null;
  return word.replace(/[^a-z0-9-]/g, '') + '.com';
}

function openTargetEdit(t) {
  const form = el('div');
  form.appendChild(el('h2', {}, `Edit target · ${t.ticker}`));
  const action = el('select', {});
  ['Buy', 'Sell', 'Watch', ''].forEach(a => {
    const o = el('option', { value: a }, a || 'Clear');
    if (t.target_action === a) o.selected = true;
    action.appendChild(o);
  });
  const price = el('input', { type: 'number', step: '0.01', value: t.target_price || '' });
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Action'), action]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Target price'), price]));

  const actions = el('div', { class: 'modal-actions' });
  if (!t.owned) {
    const del = el('button', { class: 'btn secondary' }, 'Delete');
    del.addEventListener('click', async () => {
      if (!confirm('Remove from watchlist?')) return;
      try { del.disabled = true; await postAction('deleteWatchlist', { ticker: t.ticker }); toast('Deleted', 'success'); closeModal(); await loadAll(); }
      catch (e) { toast(e.message, 'error'); del.disabled = false; }
    });
    actions.appendChild(del);
  }
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Save');
  save.addEventListener('click', async () => {
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('updateTarget', {
        ticker: t.ticker, target_action: action.value, target_price: price.value,
      });
      toast('Saved', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Save'; }
  });
  actions.appendChild(save);
  form.appendChild(actions);
  openModal(form);
}

function openWatchModal() {
  const form = el('div');
  form.appendChild(el('h2', {}, 'Add to watchlist'));
  const ticker = el('input', { placeholder: 'AAPL' });
  const company = el('input', { placeholder: 'Apple Inc.' });
  const action = el('select', {});
  ['Watch', 'Buy', 'Sell'].forEach(a => action.appendChild(el('option', { value: a }, a)));
  const price = el('input', { type: 'number', step: '0.01' });
  const thesis = el('select', {});
  THESIS_OPTIONS.forEach(t => thesis.appendChild(el('option', { value: t }, t)));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Ticker'), ticker]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Company'), company]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Action'), action]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Target price'), price]));
  form.appendChild(el('div', { class: 'field' }, [el('label', {}, 'Thesis'), thesis]));

  const actions = el('div', { class: 'modal-actions' });
  actions.appendChild(el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel'));
  const save = el('button', { class: 'btn' }, 'Add');
  save.addEventListener('click', async () => {
    if (!ticker.value) return toast('Ticker required', 'error');
    try {
      save.disabled = true; save.textContent = 'Saving…';
      await postAction('addWatchlist', {
        ticker: ticker.value, company_name: company.value,
        target_action: action.value, target_price: price.value,
        thesis_category: thesis.value,
      });
      toast('Added', 'success'); closeModal(); await loadAll();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; save.textContent = 'Add'; }
  });
  actions.appendChild(save);
  form.appendChild(actions);
  openModal(form);
}
