// API client for Apps Script web app
import { getApiUrl, getToken } from './config.js';

let lastError = null;
export function getLastError() { return lastError; }

export async function fetchAll({ hard = false } = {}) {
  const base = getApiUrl();
  if (!base) throw new Error('API URL not configured. Open Settings.');
  const cb = hard ? `&t=${Date.now()}` : '';
  const url = `${base}?action=getAll${cb}`;
  const res = await fetch(url, { method: 'GET', cache: hard ? 'no-store' : 'default' });
  if (!res.ok) throw new Error('Network error: ' + res.status);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Backend error');
  return json;
}

export async function fetchQuotes(tickers, { hard = false } = {}) {
  const base = getApiUrl();
  if (!base || !tickers || !tickers.length) return {};
  const cb = hard ? `&t=${Date.now()}` : '';
  const url = `${base}?action=getQuotes&tickers=${encodeURIComponent(tickers.join(','))}${cb}`;
  try {
    const res = await fetch(url, { method: 'GET', cache: hard ? 'no-store' : 'default' });
    const json = await res.json();
    if (!json.success) return {};
    return json.data || {};
  } catch (e) {
    console.warn('Quote fetch failed', e);
    return {};
  }
}

/**
 * Fetch real OHLC close data for a ticker and range.
 * Returns { timestamps: number[], closes: number[] } or null on failure.
 *
 * Range maps:
 *   1D  -> interval=5m,  range=1d
 *   5D  -> interval=30m, range=5d
 *   1M  -> interval=1d,  range=1mo
 *   6M  -> interval=1wk, range=6mo
 *   YTD -> interval=1wk, range=ytd
 *   1Y  -> interval=1wk, range=1y
 */
export async function fetchChart(ticker, range) {
  const base = getApiUrl();
  if (!base) return { ok: false, reason: 'no-backend-url' };
  const url = `${base}?action=getChart&ticker=${encodeURIComponent(ticker)}&range=${encodeURIComponent(range)}&t=${Date.now()}`;
  try {
    const res  = await fetch(url, { method: 'GET', cache: 'no-store' });
    const json = await res.json();
    if (!json.success || !json.data) {
      return { ok: false, reason: json.message || 'backend-error' };
    }
    return { ok: true, data: json.data }; // data: { timestamps, closes, currency }
  } catch (e) {
    console.warn('Chart fetch failed', ticker, range, e);
    return { ok: false, reason: e.message || 'network-error' };
  }
}

/**
 * Fetch real historical closes for a basket of tickers, aligned to a single
 * timestamp axis (the same axis ^GSPC uses for that range). Caller multiplies
 * by shares_owned to compute portfolio value over time.
 *
 * Returns { ok, data?: { timestamps, perTicker: {T: closes[]}, missing[] }, reason? }
 */
export async function fetchPortfolioChart(tickers, range) {
  const base = getApiUrl();
  if (!base) return { ok: false, reason: 'no-backend-url' };
  if (!tickers || !tickers.length) return { ok: false, reason: 'no-tickers' };
  const url = `${base}?action=getPortfolioChart&tickers=${encodeURIComponent(tickers.join(','))}&range=${encodeURIComponent(range)}&t=${Date.now()}`;
  try {
    const res  = await fetch(url, { method: 'GET', cache: 'no-store' });
    const json = await res.json();
    if (!json.success || !json.data) {
      return { ok: false, reason: json.message || 'backend-error' };
    }
    return { ok: true, data: json.data };
  } catch (e) {
    console.warn('Portfolio chart fetch failed', range, e);
    return { ok: false, reason: e.message || 'network-error' };
  }
}

// Apps Script web apps reject custom Content-Type CORS preflights.
// Send as text/plain so it's a "simple" request. Backend parses JSON from body.
export async function postAction(action, payload) {
  const base = getApiUrl();
  if (!base) throw new Error('API URL not configured.');
  const token = getToken();
  if (!token) throw new Error('Write secret not configured. Open Settings.');
  const body = JSON.stringify({ action, payload, token });
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
    });
    const json = await res.json();
    if (!json.success) {
      lastError = json.message || 'Write failed';
      throw new Error(lastError);
    }
    lastError = null;
    return json.data;
  } catch (e) {
    lastError = e.message;
    throw e;
  }
}

export async function ping() {
  const base = getApiUrl();
  if (!base) return { ok: false, message: 'No URL' };
  try {
    const res = await fetch(`${base}?action=ping`);
    const json = await res.json();
    return { ok: !!json.success, message: json.message || '' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
