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
 * to create / repair all sheets and headers.
 * ========================================================= */
function initializeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.entries(SHEETS).forEach(([, name]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const hdr = HEADERS[name];
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold');
  });
  // Seed AppMeta defaults
  const defaults = { app_version: '1.1.0', write_secret: '' };
  Object.entries(defaults).forEach(([k, v]) => {
    const rowIdx = findRow(SHEETS.APP_META, 'key', k);
    const meta = getSheet(SHEETS.APP_META);
    if (rowIdx === -1) meta.appendRow([k, v]);
  });
  return 'Initialized';
}

/* =========================================================
 * One-time migration: fix rows where account_type column
 * contains an ISO date (legacy data from before column M was
 * renamed). Moves the date into last_modified (column N) and
 * clears account_type. Safe to run multiple times.
 *
 * Run manually from the Apps Script editor.
 * ========================================================= */
function migrateAccountTypeColumn() {
  const sh = getSheet(SHEETS.HOLDINGS);
  const headers = HEADERS[SHEETS.HOLDINGS];
  const acctIdx = headers.indexOf('account_type');       // 0-based
  const lastIdx = headers.indexOf('last_modified');
  if (acctIdx === -1 || lastIdx === -1) throw new Error('Headers missing — run initializeSheets() first.');

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
    // If account_type looks like an ISO date AND last_modified is empty,
    // shift the date into last_modified and clear account_type.
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

/* =========================================================
 * HTTP entry points
 * ========================================================= */
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'getAll';
  let data, status = 200;
  try {
    switch (action) {
      case 'ping':             data = { message: 'pong' };             break;
      case 'getHoldings':      data = getHoldings();      break;
      case 'getTransactions':  data = getTransactions();  break;
      case 'getWatchlist':     data = getWatchlist();     break;
      case 'getBaskets':       data = getBaskets();       break;
      case 'getQuotes':        data = handleGetQuotes(e); break;
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
    return jsonErr(err.message, status);
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (_) { return jsonErr('Invalid JSON body'); }

  // Auth check
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
      default: return jsonErr('Unknown action: ' + action);
    }
    return jsonOk(result);
  } catch (err) {
    return jsonErr(err.message);
  }
}

/* =========================================================
 * Quote proxy — Yahoo Finance (unofficial)
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

/** Read all data rows as an array of objects keyed by header. */
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

/**
 * Upsert a row identified by its primary-key field (first header).
 * If a row with the given key exists, update it. Otherwise append.
 */
function upsertRow(sheetName, record) {
  const sh      = getSheet(sheetName);
  const headers = HEADERS[sheetName];
  const idField = HEADERS[sheetName][0];

  // Normalise: ensure every header has a value
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

/** Delete the first row where column `key` === `value` (case-insensitive string match). */
function deleteRow(sheetName, key, value) {
  const rowIdx = findRow(sheetName, key, value);
  if (rowIdx === -1) throw new Error(`Row not found: ${key}=${value}`);
  getSheet(sheetName).deleteRow(rowIdx);
}

/** Return the 1-based row index of the first row where column `key` === `value`, or -1. */
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
  if (idx === -1) sh.appendRow([key, value]);
  else getSheet(SHEETS.APP_META).getRange(idx, 2).setValue(value);
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

  // Recalculate total_cost_basis
  const shares = Number(p.shares_owned) || 0;
  const acb    = Number(p.avg_cost_basis) || 0;

  const id = `H-${ticker}-${Date.now()}`;
  upsertRow(SHEETS.HOLDINGS, {
    holding_id:   id,
    ticker,
    company_name: p.company_name || '',
    shares_owned: shares,
    avg_cost_basis: acb,
    total_cost_basis: shares * acb,
    thesis_category: p.thesis_category || '',
    notes:        p.notes || '',
    target_action: p.target_action || '',
    target_price:  p.target_price  || '',
    goal_portfolio_allocation_percent: p.goal_portfolio_allocation_percent || '',
    owned_status: p.owned_status || 'owned',
    account_type: p.account_type || '',
    last_modified: new Date().toISOString(),
  });
  return { holding_id: id };
}

function updateHolding(p) {
  if (!p.ticker) throw new Error('ticker required');
  const ticker = p.ticker.toUpperCase().trim();
  const rowIdx = findRow(SHEETS.HOLDINGS, 'ticker', ticker);
  if (rowIdx === -1) throw new Error(`Holding not found: ${ticker}`);

  const sh      = getSheet(SHEETS.HOLDINGS);
  const headers = HEADERS[SHEETS.HOLDINGS];
  const existing = {};
  const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  headers.forEach((h, i) => existing[h] = row[i]);

  // Recalculate total_cost_basis if shares or acb changed
  const shares = p.shares_owned !== undefined ? Number(p.shares_owned) : Number(existing.shares_owned);
  const acb    = p.avg_cost_basis !== undefined ? Number(p.avg_cost_basis) : Number(existing.avg_cost_basis);

  const updated = {
    ...existing,
    ...p,
    ticker, // always uppercase
    shares_owned:     shares,
    avg_cost_basis:   acb,
    total_cost_basis: shares * acb,
    last_modified:    new Date().toISOString(),
  };

  const newRow = headers.map(h => updated[h] != null ? updated[h] : '');
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([newRow]);
  return { updated: ticker };
}

function deleteHolding(p) {
  if (!p.ticker) throw new Error('ticker required');
  deleteRow(SHEETS.HOLDINGS, 'ticker', p.ticker.toUpperCase().trim());
  return { deleted: p.ticker };
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

  // Update holding average cost basis after buy
  if (p.action === 'Buy') {
    try {
      const holdings = getHoldings();
      const existing = holdings.find(h => h.ticker === ticker);
      if (existing) {
        const oldShares = Number(existing.shares_owned) || 0;
        const oldAcb    = Number(existing.avg_cost_basis) || 0;
        const newShares = Number(p.shares) || 0;
        const newPrice  = Number(p.price_per_share) || 0;
        const totalShares = oldShares + newShares;
        const newAcb = totalShares > 0
          ? (oldShares * oldAcb + newShares * newPrice) / totalShares
          : newPrice;
        updateHolding({ ticker, shares_owned: totalShares, avg_cost_basis: newAcb });
      }
    } catch (_) { /* non-fatal */ }
  }

  return { transaction_id: id };
}

/* =========================================================
 * Convenience updaters (partial-patch pattern)
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
    watch_id:       id,
    ticker,
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
  const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  headers.forEach((h, i) => existing[h] = row[i]);
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
    basket_id:    id,
    basket_name:  p.basket_name,
    description:  p.description  || '',
    created_at:   new Date().toISOString(),
    last_modified: new Date().toISOString(),
    is_active:    true,
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
  // Remove associated holdings
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
    basket_holding_id: id,
    basket_id:  p.basket_id,
    ticker,
    company_name: p.company_name || '',
    goal_basket_allocation_percent: p.goal_basket_allocation_percent || '',
    notes:       p.notes || '',
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
    if (k === 'write_secret') return; // never overwrite via API
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

function jsonErr(message, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, message: message || 'Error' }))
    .setMimeType(ContentService.MimeType.JSON);
}
