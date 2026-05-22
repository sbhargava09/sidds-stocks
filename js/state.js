// Central app state (single user, in-memory)
import { fetchAll, fetchQuotes } from './api.js';
import { STORAGE_KEYS } from './config.js';

export const state = {
  loading: false,
  initialized: false,
  lastSync: null,
  holdings: [],
  watchlist: [],
  baskets: [],
  basketHoldings: [],
  settings: {},
  quotes: {}, // ticker -> { price, change, changePercent, ... }
  ui: {
    view: 'holdings',
    expandedTicker: null,
    holdingsFilter: { search: '', thesis: 'all', mood: 'all', sort: 'thesis' },
    targetsFilter: { kind: 'all', owned: 'all', sort: 'closest' },
  },
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }

export async function loadAll({ hard = false } = {}) {
  state.loading = true; emit();
  try {
    const json = await fetchAll({ hard });
    state.holdings = json.data.holdings || [];
    state.watchlist = json.data.watchlist || [];
    state.baskets = json.data.baskets || [];
    state.basketHoldings = json.data.basketHoldings || [];
    state.settings = json.data.settings || {};
    state.lastSync = json.lastUpdated;
    state.initialized = true;
    // Quotes
    const tickers = Array.from(new Set([
      ...state.holdings.map(h => h.ticker),
      ...state.watchlist.map(w => w.ticker),
      ...state.basketHoldings.map(b => b.ticker),
    ].filter(Boolean)));
    if (tickers.length) state.quotes = await fetchQuotes(tickers, { hard });
  } finally {
    state.loading = false; emit();
  }
}

export async function refreshQuotesOnly({ hard = false } = {}) {
  const tickers = Array.from(new Set([
    ...state.holdings.map(h => h.ticker),
    ...state.watchlist.map(w => w.ticker),
    ...state.basketHoldings.map(b => b.ticker),
  ].filter(Boolean)));
  if (!tickers.length) return;
  state.quotes = await fetchQuotes(tickers, { hard });
  state.lastSync = new Date().toISOString();
  emit();
}

/* Derived data */
export function getEnrichedHoldings() {
  return state.holdings.map(h => {
    const q = state.quotes[h.ticker] || {};
    const shares = num(h.shares_owned);
    const avgCost = num(h.avg_cost_basis);
    const totalCost = shares * avgCost;
    const price = num(q.price);
    const value = shares * price;
    const gainDollar = value - totalCost;
    const gainPct = totalCost > 0 ? (gainDollar / totalCost) * 100 : 0;
    return {
      ...h,
      shares_owned: shares,
      avg_cost_basis: avgCost,
      total_cost_basis: totalCost,
      price, value, gainDollar, gainPct,
      changePercent: num(q.changePercent),
      shortName: q.shortName || q.longName || h.company_name || '',
      logoDomain: guessDomain(q.shortName || q.longName || h.company_name, h.ticker),
    };
  });
}

export function totalPortfolioValue(enriched) {
  return enriched.reduce((s, h) => s + h.value, 0);
}

export function getEnrichedTargets() {
  // Combine holdings (with target) + watchlist
  const fromHoldings = state.holdings
    .filter(h => h.target_action && h.target_price)
    .map(h => ({
      kind: 'holding', ticker: h.ticker, company_name: h.company_name,
      target_action: h.target_action, target_price: num(h.target_price),
      thesis_category: h.thesis_category, notes: h.notes,
      owned: true, sourceId: h.holding_id,
    }));
  const fromWatch = state.watchlist.map(w => ({
    kind: 'watchlist', ticker: w.ticker, company_name: w.company_name,
    target_action: w.target_action, target_price: num(w.target_price),
    thesis_category: w.thesis_category, notes: w.notes,
    owned: false, sourceId: w.watch_id,
  }));
  return [...fromHoldings, ...fromWatch].map(t => {
    const q = state.quotes[t.ticker] || {};
    const price = num(q.price);
    const target = num(t.target_price);
    let triggered = false;
    if (t.target_action === 'Buy' && price > 0 && price <= target) triggered = true;
    if (t.target_action === 'Sell' && price > 0 && price >= target) triggered = true;
    const distancePct = target > 0 && price > 0 ? ((price - target) / target) * 100 : null;
    return { ...t, price, triggered, distancePct };
  });
}

export function getTriggeredTargets() {
  return getEnrichedTargets().filter(t => t.triggered);
}

export function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function guessDomain(name, ticker) {
  if (!name && !ticker) return null;
  const n = (name || ticker || '').toLowerCase().replace(/\s+(inc|corp|corporation|company|co\.?|ltd|llc|plc|holdings|group|the)\b/g, '').trim();
  // Just return first word — Clearbit will best-effort match
  const word = n.split(/[\s,&]+/)[0];
  if (!word || word.length < 2) return null;
  return word.replace(/[^a-z0-9-]/g, '') + '.com';
}

/* Seen triggers (for badge new-count vs total) */
export function markTriggersSeen(triggered) {
  const seen = new Set(triggered.map(t => `${t.ticker}:${t.target_action}`));
  localStorage.setItem(STORAGE_KEYS.seenTriggers, JSON.stringify([...seen]));
}
export function getUnseenTriggerCount() {
  const triggered = getTriggeredTargets();
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(STORAGE_KEYS.seenTriggers) || '[]'); } catch {}
  const seenSet = new Set(seen);
  return triggered.filter(t => !seenSet.has(`${t.ticker}:${t.target_action}`)).length;
}
