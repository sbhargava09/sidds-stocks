// Central app state (single user, in-memory)
import { fetchAll, fetchQuotes } from './api.js';
import { STORAGE_KEYS } from './config.js';

// Cache keys
const CACHE_QUOTES_KEY   = 'ss.cache.quotes';
const CACHE_HOLDINGS_KEY = 'ss.cache.holdings';
const CACHE_TTL_QUOTES   = 5 * 60 * 1000;   // 5 min — quotes go stale fast
const CACHE_TTL_HOLDINGS = 60 * 60 * 1000;  // 60 min — holdings rarely change

function readCache(key, ttl) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > ttl) return null; // expired
    return data;
  } catch (_) { return null; }
}

function writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
}

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
    holdingsFilter: { search: '', thesis: 'all', account: 'all', mood: 'all', sort: 'thesis' },
    targetsFilter: { kind: 'all', owned: 'all', sort: 'closest' },
  },
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }

// Defensive: legacy rows may have an ISO date in account_type because
// column M was renamed in the sheet without migrating cell data.
// Clear those values so the UI doesn't show a date as an account label.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
function sanitizeHoldings(rows) {
  return (rows || []).map(r => {
    const a = String(r.account_type ?? '');
    if (ISO_RE.test(a)) {
      return { ...r, account_type: '', last_modified: r.last_modified || a };
    }
    return r;
  });
}

export async function loadAll({ hard = false } = {}) {
  state.loading = true;

  // --- Instant render from cache (stale-while-revalidate) ---
  if (!hard) {
    const cachedHoldings = readCache(CACHE_HOLDINGS_KEY, CACHE_TTL_HOLDINGS);
    const cachedQuotes   = readCache(CACHE_QUOTES_KEY,   CACHE_TTL_QUOTES);
    if (cachedHoldings) {
      state.holdings       = cachedHoldings.holdings       || [];
      state.watchlist      = cachedHoldings.watchlist      || [];
      state.baskets        = cachedHoldings.baskets        || [];
      state.basketHoldings = cachedHoldings.basketHoldings || [];
      state.settings       = cachedHoldings.settings       || {};
      state.initialized    = true;
    }
    if (cachedQuotes) {
      state.quotes = cachedQuotes;
    }
    // If we have anything cached, render immediately before the API returns
    if (cachedHoldings || cachedQuotes) {
      state.loading = false;
      emit();
      state.loading = true; // keep loading flag true while refreshing in background
    }
  }

  try {
    // --- Parallel fetch: sheet data + quotes at the same time ---
    const [json] = await Promise.all([
      fetchAll({ hard }),
      // quotes fetched below once we know the tickers from json
    ]);

    const holdings       = sanitizeHoldings(json.data.holdings || []);
    const watchlist      = json.data.watchlist      || [];
    const baskets        = json.data.baskets        || [];
    const basketHoldings = json.data.basketHoldings || [];
    const settings       = json.data.settings       || {};

    // Cache holdings data
    writeCache(CACHE_HOLDINGS_KEY, { holdings, watchlist, baskets, basketHoldings, settings });

    // Build ticker list and fetch quotes in parallel with state update
    const tickers = Array.from(new Set([
      ...holdings.map(h => h.ticker),
      ...watchlist.map(w => w.ticker),
      ...basketHoldings.map(b => b.ticker),
    ].filter(Boolean)));

    // Kick off quotes fetch immediately
    const quotesPromise = tickers.length ? fetchQuotes(tickers, { hard }) : Promise.resolve({});

    // Update holdings state right away so UI shows names/shares without waiting for quotes
    state.holdings       = holdings;
    state.watchlist      = watchlist;
    state.baskets        = baskets;
    state.basketHoldings = basketHoldings;
    state.settings       = settings;
    state.lastSync       = json.lastUpdated;
    state.initialized    = true;

    // Await quotes and update
    const freshQuotes = await quotesPromise;
    state.quotes = freshQuotes;
    writeCache(CACHE_QUOTES_KEY, freshQuotes);

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
  const freshQuotes = await fetchQuotes(tickers, { hard });
  state.quotes  = freshQuotes;
  state.lastSync = new Date().toISOString();
  writeCache(CACHE_QUOTES_KEY, freshQuotes);
  emit();
}

/* Merge raw holdings rows that share the same ticker.
   - shares_owned: sum
   - avg_cost_basis: weighted average by shares
   - All other fields (thesis, goal %, target, notes, company_name): taken from
     the row with the most shares (the "primary" row), so the user's latest /
     largest entry wins. */
function mergeHoldingsByTicker(holdings) {
  const map = new Map(); // ticker -> merged row

  for (const h of holdings) {
    const ticker = (h.ticker || '').toUpperCase();
    if (!ticker) continue;

    const shares = num(h.shares_owned);
    const cost   = num(h.avg_cost_basis);

    if (!map.has(ticker)) {
      map.set(ticker, { ...h, ticker, _totalShares: shares, _totalCost: shares * cost });
    } else {
      const existing = map.get(ticker);
      const newTotalShares = existing._totalShares + shares;
      const newTotalCost   = existing._totalCost   + shares * cost;

      // Keep metadata from whichever row has more shares
      const primary = shares > existing._totalShares ? h : existing;

      map.set(ticker, {
        ...primary,
        ticker,
        holding_id: existing.holding_id, // keep first id as canonical
        shares_owned: newTotalShares,
        avg_cost_basis: newTotalShares > 0 ? newTotalCost / newTotalShares : 0,
        _totalShares: newTotalShares,
        _totalCost: newTotalCost,
      });
    }
  }

  // Strip internal bookkeeping fields before returning
  return Array.from(map.values()).map(({ _totalShares, _totalCost, ...rest }) => rest);
}

/* Derived data */
export function getEnrichedHoldings() {
  const merged = mergeHoldingsByTicker(state.holdings);
  return merged.map(h => {
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
export function markTriggersSeen(triggers) {
  try {
    const ids = triggers.map(t => `${t.ticker}:${t.target_action}:${t.target_price}`);
    localStorage.setItem(STORAGE_KEYS.seenTriggers, JSON.stringify(ids));
  } catch (_) {}
}

export function getUnseenTriggerCount() {
  try {
    const seen = JSON.parse(localStorage.getItem(STORAGE_KEYS.seenTriggers) || '[]');
    const current = getTriggeredTargets().map(t => `${t.ticker}:${t.target_action}:${t.target_price}`);
    return current.filter(id => !seen.includes(id)).length;
  } catch (_) { return 0; }
}
