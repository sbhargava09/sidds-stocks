import { getState, subscribe } from '../state.js';
import { renderHoldingCard } from '../components/holdingCard.js';
import { openAddHolding } from '../modals/addHolding.js';

const CHEVRON_SVG = `<svg class="thesis-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>`;

export function renderHoldingsView(container) {
  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = `
    <div class="search-wrap">
      <input id="h-search" type="search" placeholder="Search holdings…" autocomplete="off" />
      <div class="search-dropdown" id="h-search-dd" style="display:none"></div>
    </div>
    <select id="h-sort">
      <option value="thesis">Group by Thesis</option>
      <option value="gain_desc">Gain ↓</option>
      <option value="gain_asc">Gain ↑</option>
      <option value="value_desc">Value ↓</option>
      <option value="alpha">A → Z</option>
    </select>
    <button class="btn" id="h-add">+ Add</button>
  `;
  container.appendChild(toolbar);

  const listEl = document.createElement('div');
  listEl.id = 'holdings-list';
  container.appendChild(listEl);

  let unsub = subscribe(() => renderHoldingsList(listEl));
  renderHoldingsList(listEl);

  // sort
  toolbar.querySelector('#h-sort').addEventListener('change', e => {
    currentSort = e.target.value;
    renderHoldingsList(listEl);
  });

  // add
  toolbar.querySelector('#h-add').addEventListener('click', () => openAddHolding());

  // search
  setupSearch(toolbar);

  // cleanup
  container._cleanup = () => unsub();
}

let currentSort = 'thesis';
// track collapsed state per thesis group (persists across re-renders)
const collapsedGroups = new Set(['Market']);

function renderHoldingsList(listEl) {
  const { holdings, prices } = getState();
  listEl.innerHTML = '';

  if (!holdings.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:48px 16px;color:var(--text-muted)">
      <div style="font-size:32px;margin-bottom:12px">📋</div>
      <div style="font-weight:600;margin-bottom:6px">No holdings yet</div>
      <div style="font-size:13px">Tap <strong>+ Add</strong> to track your first position.</div>
    </div>`;
    return;
  }

  if (currentSort !== 'thesis') {
    const sorted = sortHoldings([...holdings], prices, currentSort);
    sorted.forEach(h => listEl.appendChild(renderHoldingCard(h)));
    return;
  }

  // group by thesis
  const groups = {};
  holdings.forEach(h => {
    const key = h.thesis || 'Uncategorized';
    if (!groups[key]) groups[key] = [];
    groups[key].push(h);
  });

  Object.entries(groups).forEach(([thesis, items]) => {
    const isCollapsed = collapsedGroups.has(thesis);

    const groupEl = document.createElement('div');
    groupEl.className = 'thesis-group' + (isCollapsed ? ' collapsed' : '');
    groupEl.dataset.thesis = thesis;

    const header = document.createElement('div');
    header.className = 'thesis-header';
    header.innerHTML = `
      <div class="th-left">
        <span class="name">${thesis}</span>
        <span class="meta">${items.length} position${items.length !== 1 ? 's' : ''}</span>
      </div>
      ${CHEVRON_SVG}
    `;

    header.addEventListener('click', () => {
      const collapsed = groupEl.classList.toggle('collapsed');
      if (collapsed) {
        collapsedGroups.add(thesis);
      } else {
        collapsedGroups.delete(thesis);
      }
    });

    const body = document.createElement('div');
    body.className = 'thesis-body';
    items.forEach(h => body.appendChild(renderHoldingCard(h)));

    groupEl.appendChild(header);
    groupEl.appendChild(body);
    listEl.appendChild(groupEl);
  });
}

function sortHoldings(arr, prices, mode) {
  return arr.sort((a, b) => {
    if (mode === 'gain_desc' || mode === 'gain_asc') {
      const gainPct = h => {
        const p = prices[h.ticker];
        if (!p || !h.avgCost) return 0;
        return (p - h.avgCost) / h.avgCost;
      };
      return mode === 'gain_desc' ? gainPct(b) - gainPct(a) : gainPct(a) - gainPct(b);
    }
    if (mode === 'value_desc') {
      const val = h => (prices[h.ticker] || 0) * (h.shares || 0);
      return val(b) - val(a);
    }
    if (mode === 'alpha') return a.ticker.localeCompare(b.ticker);
    return 0;
  });
}

function setupSearch(toolbar) {
  const input = toolbar.querySelector('#h-search');
  const dd = toolbar.querySelector('#h-search-dd');

  let debounceT;
  input.addEventListener('input', () => {
    clearTimeout(debounceT);
    const q = input.value.trim();
    if (!q) { dd.style.display = 'none'; return; }
    debounceT = setTimeout(() => runSearch(q, dd), 220);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) dd.style.display = 'block';
  });

  document.addEventListener('click', e => {
    if (!toolbar.contains(e.target)) dd.style.display = 'none';
  });
}

async function runSearch(q, dd) {
  const { holdings, prices } = getState();
  const ql = q.toLowerCase();

  const held = holdings.filter(h =>
    h.ticker.toLowerCase().includes(ql) || (h.name || '').toLowerCase().includes(ql)
  );

  let sections = '';

  if (held.length) {
    sections += `<div class="sd-section-label">Your Holdings</div>`;
    held.forEach(h => {
      const price = prices[h.ticker];
      const val = price && h.shares ? price * h.shares : null;
      const gain = price && h.avgCost && h.shares
        ? (price - h.avgCost) * h.shares : null;
      const gainCls = gain > 0 ? 'up' : gain < 0 ? 'down' : 'flat';
      const gainColor = gain > 0 ? 'var(--success)' : gain < 0 ? 'var(--danger)' : 'var(--text-muted)';

      sections += `
        <button class="sd-item" data-action="scroll" data-ticker="${h.ticker}">
          <div class="sd-main">
            <div class="sd-ticker">
              <span class="sd-tick">${h.ticker}</span>
            </div>
            <div class="sd-name">${h.name || ''}</div>
            <div class="sd-meta">
              ${price ? `<span class="sd-price">$${price.toFixed(2)}</span>` : ''}
              ${h.shares ? `<span class="sd-shares">${h.shares} shares</span>` : ''}
            </div>
          </div>
          <div class="sd-right">
            ${val !== null ? `<span class="sd-val">$${val.toLocaleString('en-US', {maximumFractionDigits:0})}</span>` : ''}
            ${gain !== null ? `<span class="sd-gain" style="color:${gainColor}">${gain >= 0 ? '+' : ''}$${Math.abs(gain).toFixed(0)}</span>` : ''}
          </div>
        </button>`;
    });
  }

  // remote search
  dd.style.display = 'block';
  dd.innerHTML = sections + (held.length ? '' : '<div class="sd-loading">Searching…</div>');

  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0&enableFuzzyQuery=false`, { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    const quotes = (data.quotes || []).filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF');
    const heldTickers = new Set(holdings.map(h => h.ticker));
    const remote = quotes.filter(r => !heldTickers.has(r.symbol));

    if (remote.length) {
      let remSection = `<div class="sd-section-label">Search Results</div>`;
      remote.forEach(r => {
        remSection += `
          <button class="sd-item" data-action="add" data-ticker="${r.symbol}" data-name="${r.shortname || r.longname || ''}">
            <div class="sd-main">
              <div class="sd-ticker"><span class="sd-tick">${r.symbol}</span></div>
              <div class="sd-name">${r.shortname || r.longname || ''}</div>
              <div class="sd-meta"><span style="font-size:11px;color:var(--text-faint)">${r.exchDisp || ''}</span></div>
            </div>
            <div class="sd-right"><span class="sd-not-held">+ Add</span></div>
          </button>`;
      });
      dd.innerHTML = sections + remSection;
    } else if (!held.length) {
      dd.innerHTML = `<div class="sd-empty">No results for "${q}"</div>`;
    } else {
      dd.innerHTML = sections;
    }
  } catch {
    if (!held.length) dd.innerHTML = `<div class="sd-empty">No results</div>`;
    else dd.innerHTML = sections;
  }

  // click handlers
  dd.querySelectorAll('.sd-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const ticker = btn.dataset.ticker;
      dd.style.display = 'none';
      dd.closest('.toolbar').querySelector('#h-search').value = '';

      if (action === 'scroll') {
        const card = document.querySelector(`[data-ticker="${ticker}"]`);
        if (card) {
          // expand collapsed thesis group if needed
          const group = card.closest('.thesis-group');
          if (group && group.classList.contains('collapsed')) {
            group.classList.remove('collapsed');
            collapsedGroups.delete(group.dataset.thesis);
          }
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('expanded');
          setTimeout(() => card.classList.remove('expanded'), 1800);
        }
      } else if (action === 'add') {
        openAddHolding({ ticker, name: btn.dataset.name });
      }
    });
  });
}
