/**
 * Sidd's Stocks — Google Apps Script backend
 * Single-file web app serving JSON to the front-end.
 */

/* =========================================================
 * Sheet / header definitions
 * ========================================================= */
const SHEETS = {
  HOLDINGS:       'Holdings',
  TRANSACTIONS:   'Transactions',
  WATCHLIST:      'Watchlist',
  BASKETS:        'Baskets',
  BASKET_HOLDINGS:'BasketHoldings',
  APP_META:       'AppMeta',
};

const HEADERS = {
  [SHEETS.HOLDINGS]: [
    'holding_id', 'ticker', 'company_name', 'shares_owned', 'avg_cost_basis',
    'total_cost_basis', 'thesis_category', 'notes', 'target_action', 'target_price',
    'goal_portfolio_allocation_percent', 'owned_status', 'account_type', 'last_modified'
  ],
  [SHEETS.TRANSACTIONS]: [
    'transaction_id', 'date', 'ticker', 'action', 'shares',
    'price_per_share', 'fees', 'notes', 'created_at'
  ],
  [SHEETS.WATCHLIST]: [
    'watch_id', 'ticker', 'company_name', 'target_action', 'target_price',
    'thesis_category', 'notes', 'last_modified'
  ],
  [SHEETS.BASKETS]: [
    'basket_id', 'basket_name', 'description', 'created_at', 'last_modified', 'is_active'
  ],
  [SHEETS.BASKET_HOLDINGS]: [
    'basket_holding_id', 'basket_id', 'ticker', 'company_name',
    'goal_basket_allocation_percent', 'notes', 'last_modified'
  ],
  [SHEETS.APP_META]: ['key', 'value'],
};

/* =========================================================
 * Initialization — run this ONCE manually from the editor
 * ========================================================= */
function initializeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.entries(SHEETS).forEach(([, name]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const hdr = HEADERS[name];
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold');
  });
  const defaults = { app_version: '1.2.6', write_secret: '' };
  Object.entries(defaults).forEach(([k, v]) => {
    const rowIdx = findRow(SHEETS.APP_META, 'key', k);
    const meta = getSheet(SHEETS.APP_META);
    if (rowIdx === -1) meta.appendRow([k, v]);
  });
  return 'Initialized';
}

/* =========================================================
 * One-time migration helpers (run manually)
 * ========================================================= */
function migrateAccountTypeColumn() {
  const sh = getSheet(SHEETS.HOLDINGS);
  const headers = HEADERS[SHEETS.HOLDINGS];
  const acctIdx = headers.indexOf('account_type');
  const lastIdx = headers.indexOf('last_modified');
  if (acctIdx === -1 || lastIdx === -1) throw new Error('Headers missing.');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 'Nothing to migrate.';
  const range  = sh.getRange(2, 1, lastRow - 1, headers.length);
  const values = range.getValues();
  const isoRe  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  let fixed = 0;
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const acctVal = row[acctIdx];
    const lastVal = row[lastIdx];
    const acctStr = acctVal instanceof Date ? acctVal.toISOString() : String(acctVal || '');
    if (isoRe.test(acctStr) && (lastVal === '' || lastVal == null)) {
      row[lastIdx] = acctStr;
      row[acctIdx] = '';
      fixed++;
    }
  }
  range.setValues(values);
  return `Migrated ${fixed} row(s).`;
}

function consolidateHoldings() {
  const sh = getSheet(SHEETS.HOLDINGS);
  const headers = HEADERS[SHEETS.HOLDINGS];
  const lastRow = sh.getLastRow();
  if (lastRow < 3) return 'Nothing to consolidate.';
  const range  = sh.getRange(2, 1, lastRow - 1, headers.length);
  const values = range.getValues();
  const tIdx = headers.indexOf('ticker');
  const sIdx = headers.indexOf('shares_owned');
  const aIdx = headers.indexOf('avg_cost_basis');
  const cIdx = headers.indexOf('total_cost_basis');
  const groups = {};
  for (let i = 0; i < values.length; i++) {
    const t = String(values[i][tIdx] || '').trim().toUpperCase();
    if (!t) continue;
    (groups[t] = groups[t] || []).push(i);
  }
  const rowsToDelete = [];
  let merged = 0;
  Object.keys(groups).forEach(t => {
    const idxs = groups[t];
    if (idxs.length < 2) return;
    let totalShares = 0, totalCost = 0;
    idxs.forEach(i => {
      totalShares += Number(values[i][sIdx]) || 0;
      totalCost   += (Number(values[i][sIdx]) || 0) * (Number(values[i][aIdx]) || 0);
    });
    const keepIdx = idxs[0];
    const newAcb  = totalShares > 0 ? totalCost / totalShares : 0;
    values[keepIdx][sIdx] = totalShares;
    values[keepIdx][aIdx] = newAcb;
    if (cIdx !== -1) values[keepIdx][cIdx] = totalShares * newAcb;
    idxs.slice(1).forEach(i => rowsToDelete.push(i + 2));
    merged += idxs.length - 1;
  });
  range.setValues(values);
  rowsToDelete.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
  return `Consolidated ${merged} duplicate row(s).`;
}

/* =========================================================
 * HTTP entry points
 * ========================================================= */
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'getAll';
  let data;
  try {
    switch (action) {
      case 'ping':       data = { message: 'pong' };                break;
      case 'getHoldings':      data = getHoldings();               break;
      case 'getTransactions':  data = getTransactions();           break;
      case 'getWatchlist':     data = getWatchlist();              break;
      case 'getBaskets':       data = getBaskets();                break;
      case 'getQuotes':        data = handleGetQuotes(e);          break;
      case 'getChart':         data = handleGetChart(e);           break;
      case 'getPortfolioChart': data = handleGetPortfolioChart(e);   break;
      case 'getAll':
      default:
        data = {
          holdings:       getHoldings(),
          transactions:   getTransactions(),
          watchlist:      getWatchlist(),
          baskets:        getBaskets(),
          basketHoldings: getBasketHoldings(),
          settings:       getSettings(),
        };
    }
    return jsonOk(data);
  } catch (err) {
    return jsonErr(err.message);
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (_) { return jsonErr('Invalid JSON body'); }
  const secret = getMetaValue('write_secret');
  if (secret && body.token !== secret) return jsonErr('Unauthorized', 403);
  const action  = body.action  || '';
  const payload = body.payload || {};
  let result;
  try {
    switch (action) {
      case 'addHolding':           result = addHolding(body.payload);           break;
      case 'updateHolding':        result = updateHolding(body.payload);        break;
      case 'deleteHolding':        result = deleteHolding(body.payload);        break;
      case 'addTransaction':       result = addTransaction(body.payload);       break;
      case 'updateTarget':         result = updateTarget(body.payload);         break;
      case 'updateNote':           result = updateNote(body.payload);           break;
      case 'addWatchlist':         result = addWatchlist(body.payload);         break;
      case 'updateWatchlist':      result = updateWatchlist(body.payload);      break;
      case 'deleteWatchlist':      result = deleteWatchlist(body.payload);      break;
      case 'addBasket':            result = addBasket(body.payload);            break;
      case 'updateBasket':         result = updateBasket(body.payload);         break;
      case 'deleteBasket':         result = deleteBasket(body.payload);         break;
      case 'addBasketHolding':     result = addBasketHolding(body.payload);     break;
      case 'updateBasketHolding':  result = updateBasketHolding(body.payload);  break;
      case 'removeBasketHolding':  result = removeBasketHolding(body.payload);  break;
      case 'updateSettings':       result = updateSettings(body.payload);       break;
      case 'consolidateHoldings':  result = { message: consolidateHoldings() }; break;
      default: return jsonErr('Unknown action: ' + action);
    }
    return jsonOk(result);
  } catch (err) {
    return jsonErr(err.message);
  }
}

/* =========================================================
 * Quote proxy — Yahoo Finance v8 (unofficial)
 * ========================================================= */
function handleGetQuotes(e) {
  const raw = (e.parameter && e.parameter.tickers) || '';
  const tickers = raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) return {};
  const results = {};
  tickers.forEach(ticker => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
      const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      const json = JSON.parse(res.getContentText());
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta) { results[ticker] = null; return; }
      results[ticker] = {
        price:         meta.regularMarketPrice         || null,
        previousClose: meta.chartPreviousClose         || meta.previousClose || null,
        change:        (meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose)) || null,
        changePercent: meta.regularMarketPrice && (meta.chartPreviousClose || meta.previousClose)
                         ? ((meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose))
                            / (meta.chartPreviousClose || meta.previousClose)) * 100
                         : null,
        volume:        meta.regularMarketVolume        || null,
        marketCap:     meta.marketCap                  || null,
        shortName:     meta.shortName                  || null,
        longName:      meta.longName                   || null,
        currency:      meta.currency                   || 'USD',
        exchange:      meta.exchangeName               || null,
        quoteType:     meta.instrumentType             || null,
      };
    } catch (_) {
      results[ticker] = null;
    }
  });
  return results;
}

/* =========================================================
 * Chart OHLC proxy — Yahoo Finance v8
 *
 * Range → interval mapping:
 *   1d   → 5m   (intraday, ~78 bars)
 *   5d   → 30m  (~65 bars)
 *   1mo  → 1d   (~22 bars)
 *   6mo  → 1wk  (~26 bars)
 *   ytd  → 1wk  (variable)
 *   1y   → 1wk  (~52 bars)
 *
 * Returns { timestamps: number[], closes: number[], currency: string }
 * timestamps are Unix epoch seconds.
 * ========================================================= */
function handleGetChart(e) {
  const ticker = ((e.parameter && e.parameter.ticker) || '').trim().toUpperCase();
  const range  = ((e.parameter && e.parameter.range)  || '1mo').toLowerCase();
  if (!ticker) throw new Error('ticker parameter required');

  // Map front-end range key → Yahoo range + interval
  const rangeMap = {
    '1d':  { yRange: '1d',  interval: '5m'  },
    '5d':  { yRange: '5d',  interval: '30m' },
    '1mo': { yRange: '1mo', interval: '1d'  },
    '6mo': { yRange: '6mo', interval: '1wk' },
    'ytd': { yRange: 'ytd', interval: '1wk' },
    '1y':  { yRange: '1y',  interval: '1wk' },
  };
  const cfg = rangeMap[range] || rangeMap['1mo'];

  const url = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
    `?interval=${cfg.interval}&range=${cfg.yRange}&includePrePost=false`,
  ].join('');

  const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(res.getContentText());

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${ticker} (${range})`);

  const timestamps = result.timestamp || [];
  const closes     = (result.indicators?.quote?.[0]?.close) || [];
  const currency   = result.meta?.currency || 'USD';
  // chartPreviousClose = close just BEFORE the first bar in `range`
  // (e.g. for 1d intraday this is yesterday's close — the correct baseline
  // for computing today's % change, including the overnight gap).
  const previousClose = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? null;

  // Filter out nulls (market closed / pre-post bars)
  const filtered = { timestamps: [], closes: [] };
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) {
      filtered.timestamps.push(timestamps[i]);
      filtered.closes.push(closes[i]);
    }
  }

  return { timestamps: filtered.timestamps, closes: filtered.closes, previousClose: previousClose, currency };
}

/* =========================================================
 * Portfolio history aggregator
 *
 * Params: tickers=A,B,C  range=1d|5d|1mo|6mo|ytd|1y
 *
 * Strategy:
 *   1. Fetch ^GSPC for the requested range to establish the canonical
 *      timestamp axis (front-end already uses this for alignment).
 *   2. Fetch each ticker's history in parallel via UrlFetchApp.fetchAll.
 *   3. For each canonical timestamp, take each ticker's most-recent close at
 *      or before that timestamp (carry-forward within each series only).
 *   4. Return per-ticker closes aligned to the canonical timestamps. The
 *      caller multiplies by shares_owned to compute portfolio value.
 *      Tickers Yahoo fails on are reported in `missing` and omitted from
 *      `perTicker` (front-end is expected to drop those tickers when
 *      computing the aggregate, with a console warning).
 *
 * Returns:
 *   { timestamps: number[], perTicker: { TICKER: number[] }, missing: string[], currency: 'USD' }
 * ========================================================= */
function handleGetPortfolioChart(e) {
  const raw    = (e.parameter && e.parameter.tickers) || '';
  const range  = ((e.parameter && e.parameter.range) || '1mo').toLowerCase();
  const tickers = raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) return { timestamps: [], perTicker: {}, missing: [], currency: 'USD' };

  const rangeMap = {
    '1d':  { yRange: '1d',  interval: '5m'  },
    '5d':  { yRange: '5d',  interval: '30m' },
    '1mo': { yRange: '1mo', interval: '1d'  },
    '6mo': { yRange: '6mo', interval: '1wk' },
    'ytd': { yRange: 'ytd', interval: '1wk' },
    '1y':  { yRange: '1y',  interval: '1wk' },
  };
  const cfg = rangeMap[range] || rangeMap['1mo'];

  const buildUrl = (t) =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}` +
    `?interval=${cfg.interval}&range=${cfg.yRange}&includePrePost=false`;

  // Canonical axis: ^GSPC (always available; same axis frontend uses for SPX overlay)
  let canonicalTs;
  try {
    const spxRes  = UrlFetchApp.fetch(buildUrl('^GSPC'), { muteHttpExceptions: true });
    const spxJson = JSON.parse(spxRes.getContentText());
    const spxResult = spxJson?.chart?.result?.[0];
    const spxStamps = spxResult?.timestamp || [];
    const spxCloses = spxResult?.indicators?.quote?.[0]?.close || [];
    canonicalTs = [];
    for (let i = 0; i < spxStamps.length; i++) {
      if (spxCloses[i] != null) canonicalTs.push(spxStamps[i]);
    }
  } catch (_) {
    canonicalTs = [];
  }
  // Per-ticker previousClose lookup (close BEFORE first bar in window)
  const previousCloseByT = {};
  if (!canonicalTs.length) {
    throw new Error('Failed to establish canonical timestamp axis (^GSPC unavailable)');
  }

  // Parallel fetch all tickers (primary: requested interval/range)
  const requests = tickers.map(t => ({ url: buildUrl(t), muteHttpExceptions: true }));
  const responses = UrlFetchApp.fetchAll(requests);

  const perTicker     = {};
  const synthesized   = [];        // tickers handled via daily-NAV fallback
  const missing       = [];        // tickers we couldn't get any data for
  const fallbackQueue = [];        // tickers needing daily NAV fallback

  for (let k = 0; k < tickers.length; k++) {
    const t = tickers[k];
    try {
      const json = JSON.parse(responses[k].getContentText());
      const r    = json?.chart?.result?.[0];
      const ts   = r?.timestamp || [];
      const cl   = r?.indicators?.quote?.[0]?.close || [];
      const prev = r?.meta?.chartPreviousClose ?? r?.meta?.previousClose ?? null;
      if (prev != null) previousCloseByT[t] = prev;

      // Empty intraday series — typical for mutual funds. Queue for daily NAV fallback.
      if (!ts.length || !cl.length) { fallbackQueue.push(t); continue; }

      const pts = [];
      for (let i = 0; i < ts.length; i++) {
        if (cl[i] != null) pts.push([ts[i], cl[i]]);
      }
      if (!pts.length) { fallbackQueue.push(t); continue; }

      // Align to canonical axis using a single forward walk (both arrays sorted ascending)
      const aligned = new Array(canonicalTs.length).fill(null);
      let j = 0;
      let lastClose = null;
      for (let i = 0; i < canonicalTs.length; i++) {
        const cts = canonicalTs[i];
        while (j < pts.length && pts[j][0] <= cts) {
          lastClose = pts[j][1];
          j++;
        }
        aligned[i] = lastClose;
      }
      const firstSample = pts[0][1];
      for (let i = 0; i < aligned.length; i++) {
        if (aligned[i] == null) aligned[i] = firstSample;
        else break;
      }
      perTicker[t] = aligned;
    } catch (_) {
      fallbackQueue.push(t);
    }
  }

  // ── Daily-NAV fallback for tickers without intraday data (mutual funds) ─────────────
  // Mutual funds publish a single NAV after market close. We synthesize a
  // step-function: prevClose for every bar except the last, which gets the
  // most recent NAV. During the trading day this means the fund's value is
  // held at yesterday's NAV until the final bar — reflecting reality (the
  // user can't actually realize today's NAV until 4pm).
  //
  // Skipped on the 1d (intraday) range — a single end-of-day step on an
  // intraday line is misleading. Mutual funds are simply omitted there and
  // shown in the "skipped" status note instead. Longer ranges use it because
  // every bar is a daily close, where end-of-day NAVs are the natural unit.
  if (fallbackQueue.length && range !== '1d') {
    const fbUrl = (t) =>
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}` +
      `?interval=1d&range=5d&includePrePost=false`;
    const fbReqs = fallbackQueue.map(t => ({ url: fbUrl(t), muteHttpExceptions: true }));
    const fbRes  = UrlFetchApp.fetchAll(fbReqs);

    for (let k = 0; k < fallbackQueue.length; k++) {
      const t = fallbackQueue[k];
      try {
        const json = JSON.parse(fbRes[k].getContentText());
        const r    = json?.chart?.result?.[0];
        const cl   = (r?.indicators?.quote?.[0]?.close) || [];
        const prev = r?.meta?.chartPreviousClose ?? r?.meta?.previousClose ?? null;

        const validCloses = cl.filter(v => v != null);
        const todayPrice  = r?.meta?.regularMarketPrice
                          ?? (validCloses.length ? validCloses[validCloses.length - 1] : null);
        // Prefer the meta previousClose (close of the prior session); fall back to
        // the next-to-last daily close if needed.
        const yestNAV = (prev != null && prev > 0)
          ? prev
          : (validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null);

        if (todayPrice == null || yestNAV == null) {
          missing.push(t);
          continue;
        }
        if (!(t in previousCloseByT)) previousCloseByT[t] = yestNAV;

        // Step-function: yesterday's NAV for every bar except the last
        const aligned = new Array(canonicalTs.length).fill(yestNAV);
        aligned[aligned.length - 1] = todayPrice;
        perTicker[t] = aligned;
        synthesized.push(t);
      } catch (_) {
        missing.push(t);
      }
    }
  } else if (fallbackQueue.length) {
    // 1d range: don't synthesize; surface as skipped
    for (let k = 0; k < fallbackQueue.length; k++) missing.push(fallbackQueue[k]);
  }

  return {
    timestamps: canonicalTs,
    perTicker: perTicker,
    previousCloseByT: previousCloseByT,
    missing: missing,
    synthesized: synthesized,
    currency: 'USD',
  };
}

/* =========================================================
 * Generic sheet helpers
 * ========================================================= */
function getSheet(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error(`Sheet "${name}" not found. Run initializeSheets().`);
  return sh;
}

function repairHeaders(sheetName) {
  const sh = getSheet(sheetName);
  sh.getRange(1, 1, 1, HEADERS[sheetName].length).setValues([HEADERS[sheetName]]).setFontWeight('bold');
}

function readSheet(sheetName) {
  const sh = getSheet(sheetName);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const headers = HEADERS[sheetName];
  const values  = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined))
    .map(row => {
      const o = {};
      headers.forEach((h, i) => o[h] = row[i]);
      return o;
    });
}

function upsertRow(sheetName, record) {
  const sh      = getSheet(sheetName);
  const headers = HEADERS[sheetName];
  const idField = HEADERS[sheetName][0];
  const fixed = { ...record };
  headers.forEach(h => { if (fixed[h] === undefined) fixed[h] = ''; });
  const rowIdx = findRow(sheetName, idField, fixed[idField]);
  if (rowIdx === -1) {
    sh.appendRow(headers.map(h => fixed[h]));
  } else {
    const newRow = headers.map(h => fixed[h] != null ? fixed[h] : '');
    sh.getRange(rowIdx, 1, 1, headers.length).setValues([newRow]);
  }
}

function deleteRow(sheetName, key, value) {
  const rowIdx = findRow(sheetName, key, value);
  if (rowIdx === -1) throw new Error(`Row not found: ${key}=${value}`);
  getSheet(sheetName).deleteRow(rowIdx);
}

function findRow(sheetName, key, value) {
  const sh      = getSheet(sheetName);
  const headers = HEADERS[sheetName];
  const colIdx  = headers.indexOf(key);
  if (colIdx === -1) return -1;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const target  = String(value).trim().toLowerCase();
  const col     = sh.getRange(2, colIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim().toLowerCase() === target) return i + 2;
  }
  return -1;
}

/* =========================================================
 * AppMeta helpers
 * ========================================================= */
function getMetaValue(key) {
  const idx = findRow(SHEETS.APP_META, 'key', key);
  if (idx === -1) return '';
  return getSheet(SHEETS.APP_META).getRange(idx, 2).getValue();
}
function setMetaValue(key, value) {
  const idx = findRow(SHEETS.APP_META, 'key', key);
  const sh  = getSheet(SHEETS.APP_META);
  if (idx === -1) sh.appendRow([key, value]);
  else sh.getRange(idx, 2).setValue(value);
}

/* =========================================================
 * Holdings CRUD
 * ========================================================= */
function getHoldings() { return readSheet(SHEETS.HOLDINGS); }

function getTargetsFromSheet() {
  const holdings = getHoldings().filter(h => h.target_action && h.target_price);
  const watchlist = getWatchlist();
  return { fromHoldings: holdings, fromWatchlist: watchlist };
}

function addHolding(p) {
  if (!p.ticker) throw new Error('ticker required');
  const ticker = p.ticker.toUpperCase().trim();
  const newShares = Number(p.shares_owned)   || 0;
  const newAcb    = Number(p.avg_cost_basis) || 0;
  const sh      = getSheet(SHEETS.HOLDINGS);
  const headers = HEADERS[SHEETS.HOLDINGS];
  const tickerCol = headers.indexOf('ticker') + 1;
  const lastRow = sh.getLastRow();
  const matchingRows = [];
  if (lastRow >= 2) {
    const col = sh.getRange(2, tickerCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < col.length; i++) {
      if (String(col[i][0]).trim().toUpperCase() === ticker) matchingRows.push(i + 2);
    }
  }
  if (matchingRows.length > 0) {
    let oldShares = 0, oldCost = 0;
    let keeper = null;
    matchingRows.forEach(r => {
      const row = sh.getRange(r, 1, 1, headers.length).getValues()[0];
      const rec = {}; headers.forEach((h, i) => rec[h] = row[i]);
      const s = Number(rec.shares_owned)   || 0;
      const a = Number(rec.avg_cost_basis) || 0;
      oldShares += s; oldCost += s * a;
      if (!keeper) keeper = rec;
    });
    const totalShares = oldShares + newShares;
    const totalCost   = oldCost   + newShares * newAcb;
    const mergedAcb   = totalShares > 0 ? totalCost / totalShares : 0;
    const updated = {
      ...keeper, ticker,
      company_name:  p.company_name  || keeper.company_name  || '',
      shares_owned:  totalShares,
      avg_cost_basis: mergedAcb,
      total_cost_basis: totalShares * mergedAcb,
      thesis_category: p.thesis_category || keeper.thesis_category || '',
      notes:         p.notes         || keeper.notes         || '',
      target_action: p.target_action || keeper.target_action || '',
      target_price:  p.target_price  || keeper.target_price  || '',
      goal_portfolio_allocation_percent: p.goal_portfolio_allocation_percent || keeper.goal_portfolio_allocation_percent || '',
      owned_status:  p.owned_status  || keeper.owned_status  || 'owned',
      account_type:  p.account_type  || keeper.account_type  || '',
      last_modified: new Date().toISOString(),
    };
    const newRow = headers.map(h => updated[h] != null ? updated[h] : '');
    sh.getRange(matchingRows[0], 1, 1, headers.length).setValues([newRow]);
    matchingRows.slice(1).sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
    return { holding_id: updated.holding_id, merged: true, rowsCollapsed: matchingRows.length };
  }
  const id = `H-${ticker}-${Date.now()}`;
  upsertRow(SHEETS.HOLDINGS, {
    holding_id: id, ticker,
    company_name: p.company_name || '',
    shares_owned: newShares,
    avg_cost_basis: newAcb,
    total_cost_basis: newShares * newAcb,
    thesis_category: p.thesis_category || '',
    notes: p.notes || '',
    target_action: p.target_action || '',
    target_price:  p.target_price  || '',
    goal_portfolio_allocation_percent: p.goal_portfolio_allocation_percent || '',
    owned_status: p.owned_status || 'owned',
    account_type: p.account_type || '',
    last_modified: new Date().toISOString(),
  });
  return { holding_id: id, merged: false };
}

function updateHolding(p) {
  if (!p.ticker) throw new Error('ticker required');
  const ticker = p.ticker.toUpperCase().trim();
  const rowIdx = findRow(SHEETS.HOLDINGS, 'ticker', ticker);
  if (rowIdx === -1) throw new Error(`Holding not found: ${ticker}`);
  const sh      = getSheet(SHEETS.HOLDINGS);
  const headers = HEADERS[SHEETS.HOLDINGS];
  const existing = {};
  sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0].forEach((v, i) => existing[headers[i]] = v);
  const shares = p.shares_owned   !== undefined ? Number(p.shares_owned)   : Number(existing.shares_owned);
  const acb    = p.avg_cost_basis !== undefined ? Number(p.avg_cost_basis) : Number(existing.avg_cost_basis);
  const updated = { ...existing, ...p, ticker, shares_owned: shares, avg_cost_basis: acb,
                    total_cost_basis: shares * acb, last_modified: new Date().toISOString() };
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([headers.map(h => updated[h] != null ? updated[h] : '')]);
  return { updated: ticker };
}

function deleteHolding(p) {
  if (!p.ticker) throw new Error('ticker required');
  const ticker  = p.ticker.toUpperCase().trim();
  const sh      = getSheet(SHEETS.HOLDINGS);
  const headers = HEADERS[SHEETS.HOLDINGS];
  const tCol    = headers.indexOf('ticker') + 1;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { deleted: ticker, rows: 0 };
  const col = sh.getRange(2, tCol, lastRow - 1, 1).getValues();
  const matches = [];
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim().toUpperCase() === ticker) matches.push(i + 2);
  }
  if (!matches.length) throw new Error(`Holding not found: ${ticker}`);
  matches.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
  return { deleted: ticker, rows: matches.length };
}

/* =========================================================
 * Transactions CRUD
 * ========================================================= */
function getTransactions() { return readSheet(SHEETS.TRANSACTIONS); }

function addTransaction(p) {
  if (!p.ticker || !p.action) throw new Error('ticker and action required');
  const ticker = p.ticker.toUpperCase().trim();
  const id = `T-${ticker}-${Date.now()}`;
  upsertRow(SHEETS.TRANSACTIONS, {
    transaction_id:  id,
    date:            p.date || new Date().toISOString().slice(0, 10),
    ticker,
    action:          p.action,
    shares:          Number(p.shares)          || 0,
    price_per_share: Number(p.price_per_share) || 0,
    fees:            Number(p.fees)            || 0,
    notes:           p.notes || '',
    created_at:      new Date().toISOString(),
  });
  if (p.action === 'Buy') {
    try {
      const shares = Number(p.shares) || 0;
      const price  = Number(p.price_per_share) || 0;
      if (shares > 0) addHolding({ ticker, shares_owned: shares, avg_cost_basis: price });
    } catch (_) {}
  }
  return { transaction_id: id };
}

/* =========================================================
 * Convenience updaters
 * ========================================================= */
function updateTarget(p) {
  return updateHolding({ ticker: p.ticker, target_action: p.target_action, target_price: p.target_price });
}
function updateNote(p) {
  return updateHolding({ ticker: p.ticker, notes: p.notes });
}

/* =========================================================
 * Watchlist CRUD
 * ========================================================= */
function getWatchlist() { return readSheet(SHEETS.WATCHLIST); }

function addWatchlist(p) {
  if (!p.ticker) throw new Error('ticker required');
  const ticker = p.ticker.toUpperCase().trim();
  const id = `W-${ticker}-${Date.now()}`;
  upsertRow(SHEETS.WATCHLIST, {
    watch_id: id, ticker,
    company_name:   p.company_name   || '',
    target_action:  p.target_action  || '',
    target_price:   p.target_price   || '',
    thesis_category: p.thesis_category || '',
    notes:          p.notes          || '',
    last_modified:  new Date().toISOString(),
  });
  return { watch_id: id };
}

function updateWatchlist(p) {
  if (!p.ticker) throw new Error('ticker required');
  const ticker = p.ticker.toUpperCase().trim();
  const rowIdx = findRow(SHEETS.WATCHLIST, 'ticker', ticker);
  if (rowIdx === -1) throw new Error(`Watchlist item not found: ${ticker}`);
  const sh = getSheet(SHEETS.WATCHLIST);
  const headers = HEADERS[SHEETS.WATCHLIST];
  const existing = {};
  sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0].forEach((v, i) => existing[headers[i]] = v);
  const updated = { ...existing, ...p, ticker, last_modified: new Date().toISOString() };
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([headers.map(h => updated[h] != null ? updated[h] : '')]);
  return { updated: ticker };
}

function deleteWatchlist(p) {
  if (!p.ticker) throw new Error('ticker required');
  deleteRow(SHEETS.WATCHLIST, 'ticker', p.ticker.toUpperCase().trim());
  return { deleted: p.ticker };
}

/* =========================================================
 * Baskets CRUD
 * ========================================================= */
function getBaskets() { return readSheet(SHEETS.BASKETS); }
function getBasketHoldings() { return readSheet(SHEETS.BASKET_HOLDINGS); }

function addBasket(p) {
  if (!p.basket_name) throw new Error('basket_name required');
  const id = `B-${Date.now()}`;
  upsertRow(SHEETS.BASKETS, {
    basket_id: id, basket_name: p.basket_name,
    description: p.description || '',
    created_at: new Date().toISOString(),
    last_modified: new Date().toISOString(),
    is_active: true,
  });
  return { basket_id: id };
}

function updateBasket(p) {
  if (!p.basket_id) throw new Error('basket_id required');
  const rowIdx = findRow(SHEETS.BASKETS, 'basket_id', p.basket_id);
  if (rowIdx === -1) throw new Error(`Basket not found: ${p.basket_id}`);
  const sh = getSheet(SHEETS.BASKETS);
  const headers = HEADERS[SHEETS.BASKETS];
  const existing = {};
  sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0].forEach((v, i) => existing[headers[i]] = v);
  const updated = { ...existing, ...p, last_modified: new Date().toISOString() };
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([headers.map(h => updated[h] != null ? updated[h] : '')]);
  return { updated: p.basket_id };
}

function deleteBasket(p) {
  if (!p.basket_id) throw new Error('basket_id required');
  deleteRow(SHEETS.BASKETS, 'basket_id', p.basket_id);
  const bh = getBasketHoldings().filter(r => r.basket_id === p.basket_id);
  bh.forEach(r => {
    try { deleteRow(SHEETS.BASKET_HOLDINGS, 'basket_holding_id', r.basket_holding_id); } catch (_) {}
  });
  return { deleted: p.basket_id };
}

function addBasketHolding(p) {
  if (!p.basket_id || !p.ticker) throw new Error('basket_id and ticker required');
  const ticker = p.ticker.toUpperCase().trim();
  const id = `BH-${ticker}-${Date.now()}`;
  upsertRow(SHEETS.BASKET_HOLDINGS, {
    basket_holding_id: id, basket_id: p.basket_id, ticker,
    company_name: p.company_name || '',
    goal_basket_allocation_percent: p.goal_basket_allocation_percent || '',
    notes: p.notes || '',
    last_modified: new Date().toISOString(),
  });
  return { basket_holding_id: id };
}

function updateBasketHolding(p) {
  if (!p.basket_holding_id) throw new Error('basket_holding_id required');
  const rowIdx = findRow(SHEETS.BASKET_HOLDINGS, 'basket_holding_id', p.basket_holding_id);
  if (rowIdx === -1) throw new Error(`BasketHolding not found: ${p.basket_holding_id}`);
  const sh = getSheet(SHEETS.BASKET_HOLDINGS);
  const headers = HEADERS[SHEETS.BASKET_HOLDINGS];
  const existing = {};
  sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0].forEach((v, i) => existing[headers[i]] = v);
  const updated = { ...existing, ...p, last_modified: new Date().toISOString() };
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([headers.map(h => updated[h] != null ? updated[h] : '')]);
  return { updated: p.basket_holding_id };
}

function removeBasketHolding(p) {
  if (!p.basket_holding_id) throw new Error('basket_holding_id required');
  deleteRow(SHEETS.BASKET_HOLDINGS, 'basket_holding_id', p.basket_holding_id);
  return { removed: p.basket_holding_id };
}

/* =========================================================
 * Settings (AppMeta key-value store)
 * ========================================================= */
function getSettings() {
  const rows = readSheet(SHEETS.APP_META);
  const out = {};
  rows.forEach(r => { if (r.key && r.key !== 'write_secret') out[r.key] = r.value; });
  return out;
}

function updateSettings(p) {
  if (!p || typeof p !== 'object') throw new Error('payload must be an object');
  Object.entries(p).forEach(([k, v]) => {
    if (k === 'write_secret') return;
    const idx = findRow(SHEETS.APP_META, 'key', k);
    const sh  = getSheet(SHEETS.APP_META);
    if (idx === -1) sh.appendRow([k, v]);
    else sh.getRange(idx, 2).setValue(v);
  });
  return { updated: Object.keys(p).length };
}

/* =========================================================
 * Response helpers
 * ========================================================= */
function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, data, lastUpdated: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, message: message || 'Error' }))
    .setMimeType(ContentService.MimeType.JSON);
}
