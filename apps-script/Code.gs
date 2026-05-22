/**
 * Sidd's Stocks — Google Apps Script Backend
 * ------------------------------------------
 * Deploy as a Web App ("Execute as: Me", "Who has access: Anyone")
 * and paste the resulting /exec URL into the front-end Settings tab.
 *
 * IMPORTANT: Set a write secret in Script Properties (key: WRITE_SECRET).
 *  File → Project Settings → Script Properties → Add: WRITE_SECRET = <your secret>
 * Then enter the same secret in the front-end Settings tab. Reads do not
 * require the secret; all writes do.
 */

const APP_VERSION = '1.0.0';
const SCHEMA_VERSION = '1';

const SHEETS = {
  HOLDINGS: 'Holdings',
  TRANSACTIONS: 'Transactions',
  WATCHLIST: 'WatchlistTargets',
  BASKETS: 'Baskets',
  BASKET_HOLDINGS: 'BasketHoldings',
  APP_META: 'AppMeta',
};

const HEADERS = {
  [SHEETS.HOLDINGS]: [
    'holding_id', 'ticker', 'company_name', 'shares_owned', 'avg_cost_basis',
    'total_cost_basis', 'thesis_category', 'notes', 'target_action', 'target_price',
    'goal_portfolio_allocation_percent', 'owned_status', 'last_modified'
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
function initializeWorkbook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.values(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const hdr = HEADERS[name];
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  // Seed AppMeta
  const meta = ss.getSheetByName(SHEETS.APP_META);
  const existing = meta.getDataRange().getValues();
  const seed = {
    app_version: APP_VERSION,
    last_successful_sync: new Date().toISOString(),
    default_refresh_interval: '300',
    schema_version: SCHEMA_VERSION,
  };
  Object.entries(seed).forEach(([k, v]) => {
    const rowIdx = existing.findIndex(r => r[0] === k);
    if (rowIdx === -1) meta.appendRow([k, v]);
  });
  // Remove default Sheet1 if empty
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0) ss.deleteSheet(def);
  return 'Workbook initialized.';
}

/* =========================================================
 * HTTP entry points
 * ========================================================= */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'getAll';
    let data;
    switch (action) {
      case 'getHoldings':      data = getHoldings();      break;
      case 'getTransactions':  data = getTransactions();  break;
      case 'getTargets':       data = getTargets();       break;
      case 'getBaskets':       data = getBaskets();       break;
      case 'getSettings':      data = getSettings();      break;
      case 'getQuotes':        data = getQuotes((e.parameter.tickers || '').split(',').filter(Boolean)); break;
      case 'getNotifications': data = getNotifications(); break;
      case 'getAnalytics':     data = getAnalyticsBundle(); break;
      case 'ping':             data = { ok: true }; break;
      case 'getAll':
      default:
        data = {
          holdings: getHoldings(),
          watchlist: getWatchlist(),
          baskets: getBaskets(),
          basketHoldings: getBasketHoldings(),
          settings: getSettings(),
        };
    }
    return jsonOk(data);
  } catch (err) {
    return jsonErr(err);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (!verifyToken(body.token)) return jsonErr(new Error('Unauthorized'), 401);
    const action = body.action;
    let result;
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
      default: throw new Error('Unknown action: ' + action);
    }
    setMeta('last_successful_sync', new Date().toISOString());
    return jsonOk(result);
  } catch (err) {
    return jsonErr(err);
  }
}

/* =========================================================
 * Helpers
 * ========================================================= */
function jsonOk(data, message = '') {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true, data, message,
      lastUpdated: new Date().toISOString(),
      version: APP_VERSION,
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(err, code) {
  console.error(err);
  return ContentService
    .createTextOutput(JSON.stringify({
      success: false, data: null,
      message: err.message || String(err),
      code: code || 500,
      version: APP_VERSION,
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyToken(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('WRITE_SECRET');
  if (!expected) return false;
  return token && token === expected;
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readSheet(name) {
  const sh = getSheet(name);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const headers = HEADERS[name];
  const values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(row => {
    const o = {};
    headers.forEach((h, i) => o[h] = row[i]);
    return o;
  }).filter(o => o[headers[0]] !== '' && o[headers[0]] != null);
}

function findRowIndex(sheetName, key, value) {
  const sh = getSheet(sheetName);
  const headers = HEADERS[sheetName];
  const colIdx = headers.indexOf(key);
  if (colIdx === -1) return -1;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const col = sh.getRange(2, colIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]).toLowerCase() === String(value).toLowerCase()) return i + 2;
  }
  return -1;
}

function uid(prefix) {
  return prefix + '_' + Utilities.getUuid().slice(0, 8);
}

function nowIso() { return new Date().toISOString(); }

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function setMeta(key, value) {
  const sh = getSheet(SHEETS.APP_META);
  const idx = findRowIndex(SHEETS.APP_META, 'key', key);
  if (idx === -1) sh.appendRow([key, value]);
  else sh.getRange(idx, 2).setValue(value);
}

function getMeta(key) {
  const idx = findRowIndex(SHEETS.APP_META, 'key', key);
  if (idx === -1) return null;
  return getSheet(SHEETS.APP_META).getRange(idx, 2).getValue();
}

/* =========================================================
 * Read endpoints
 * ========================================================= */
function getHoldings() { return readSheet(SHEETS.HOLDINGS); }
function getTransactions() { return readSheet(SHEETS.TRANSACTIONS); }
function getWatchlist() { return readSheet(SHEETS.WATCHLIST); }
function getBaskets() { return readSheet(SHEETS.BASKETS); }
function getBasketHoldings() { return readSheet(SHEETS.BASKET_HOLDINGS); }

function getTargets() {
  const holdings = getHoldings().filter(h => h.target_action && h.target_price);
  const watchlist = getWatchlist();
  return { fromHoldings: holdings, fromWatchlist: watchlist };
}

function getSettings() {
  const meta = readSheet(SHEETS.APP_META);
  const obj = {};
  meta.forEach(r => obj[r.key] = r.value);
  obj.app_version = APP_VERSION;
  obj.schema_version = SCHEMA_VERSION;
  return obj;
}

function getNotifications() {
  // Compute server-side trigger list as a convenience
  const holdings = getHoldings();
  const watchlist = getWatchlist();
  const tickers = Array.from(new Set([...holdings, ...watchlist].map(x => x.ticker).filter(Boolean)));
  const quotes = getQuotes(tickers);
  const triggered = [];
  [...holdings, ...watchlist].forEach(item => {
    if (!item.target_action || !item.target_price) return;
    const q = quotes[item.ticker];
    if (!q || !q.price) return;
    const tp = num(item.target_price);
    if (item.target_action === 'Buy' && q.price <= tp) {
      triggered.push({ ticker: item.ticker, action: 'Buy', price: q.price, target: tp });
    } else if (item.target_action === 'Sell' && q.price >= tp) {
      triggered.push({ ticker: item.ticker, action: 'Sell', price: q.price, target: tp });
    }
  });
  return { triggered, count: triggered.length };
}

function getAnalyticsBundle() {
  return {
    holdings: getHoldings(),
    baskets: getBaskets(),
    basketHoldings: getBasketHoldings(),
  };
}

/* =========================================================
 * Quotes (Yahoo Finance — free, no key)
 * ========================================================= */
function getQuotes(tickers) {
  if (!tickers || !tickers.length) return {};
  const cache = CacheService.getScriptCache();
  const out = {};
  const fresh = [];
  tickers.forEach(t => {
    const c = cache.get('q_' + t);
    if (c) out[t] = JSON.parse(c);
    else fresh.push(t);
  });
  if (fresh.length) {
    try {
      const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(fresh.join(','));
      const resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0 SiddsStocks/1.0' },
      });
      const json = JSON.parse(resp.getContentText());
      const results = (json.quoteResponse && json.quoteResponse.result) || [];
      results.forEach(r => {
        const obj = {
          ticker: r.symbol,
          price: r.regularMarketPrice,
          change: r.regularMarketChange,
          changePercent: r.regularMarketChangePercent,
          previousClose: r.regularMarketPreviousClose,
          currency: r.currency,
          shortName: r.shortName,
          longName: r.longName,
          marketState: r.marketState,
        };
        out[r.symbol] = obj;
        cache.put('q_' + r.symbol, JSON.stringify(obj), 60); // 60s cache
      });
    } catch (e) {
      console.error('Quote fetch failed:', e);
    }
  }
  return out;
}

/* =========================================================
 * Write endpoints
 * ========================================================= */
function addHolding(p) {
  validate(p, ['ticker', 'shares_owned', 'avg_cost_basis']);
  const sh = getSheet(SHEETS.HOLDINGS);
  const ticker = String(p.ticker).toUpperCase();
  const existingIdx = findRowIndex(SHEETS.HOLDINGS, 'ticker', ticker);
  if (existingIdx !== -1) {
    return updateHolding({ ...p, ticker });
  }
  const row = [
    uid('h'), ticker, p.company_name || '',
    num(p.shares_owned), num(p.avg_cost_basis),
    num(p.shares_owned) * num(p.avg_cost_basis),
    p.thesis_category || 'Market', p.notes || '',
    p.target_action || '', p.target_price || '',
    num(p.goal_portfolio_allocation_percent) || 0,
    'owned', nowIso()
  ];
  sh.appendRow(row);
  return { ok: true, ticker };
}

function updateHolding(p) {
  validate(p, ['ticker']);
  const ticker = String(p.ticker).toUpperCase();
  const sh = getSheet(SHEETS.HOLDINGS);
  const rowIdx = findRowIndex(SHEETS.HOLDINGS, 'ticker', ticker);
  if (rowIdx === -1) throw new Error('Holding not found: ' + ticker);
  const headers = HEADERS[SHEETS.HOLDINGS];
  const cur = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  const obj = {}; headers.forEach((h, i) => obj[h] = cur[i]);
  ['company_name','shares_owned','avg_cost_basis','thesis_category',
   'notes','target_action','target_price','goal_portfolio_allocation_percent','owned_status']
    .forEach(k => { if (p[k] !== undefined && p[k] !== null) obj[k] = p[k]; });
  obj.shares_owned = num(obj.shares_owned);
  obj.avg_cost_basis = num(obj.avg_cost_basis);
  obj.total_cost_basis = obj.shares_owned * obj.avg_cost_basis;
  obj.last_modified = nowIso();
  const newRow = headers.map(h => obj[h]);
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([newRow]);
  return { ok: true, ticker };
}

function deleteHolding(p) {
  validate(p, ['ticker']);
  const sh = getSheet(SHEETS.HOLDINGS);
  const rowIdx = findRowIndex(SHEETS.HOLDINGS, 'ticker', String(p.ticker).toUpperCase());
  if (rowIdx === -1) throw new Error('Holding not found');
  sh.deleteRow(rowIdx);
  return { ok: true };
}

function addTransaction(p) {
  validate(p, ['ticker', 'action', 'shares', 'price_per_share']);
  const sh = getSheet(SHEETS.TRANSACTIONS);
  const row = [
    uid('t'), p.date || nowIso(),
    String(p.ticker).toUpperCase(), p.action,
    num(p.shares), num(p.price_per_share),
    num(p.fees), p.notes || '', nowIso()
  ];
  sh.appendRow(row);
  // Optionally update holding
  if (p.applyToHolding) {
    const ticker = String(p.ticker).toUpperCase();
    const idx = findRowIndex(SHEETS.HOLDINGS, 'ticker', ticker);
    if (idx === -1 && p.action === 'Buy') {
      addHolding({
        ticker, company_name: p.company_name || '',
        shares_owned: num(p.shares),
        avg_cost_basis: num(p.price_per_share),
        thesis_category: p.thesis_category || 'Market',
      });
    } else if (idx !== -1) {
      const sh2 = getSheet(SHEETS.HOLDINGS);
      const headers = HEADERS[SHEETS.HOLDINGS];
      const cur = sh2.getRange(idx, 1, 1, headers.length).getValues()[0];
      const obj = {}; headers.forEach((h, i) => obj[h] = cur[i]);
      const oldShares = num(obj.shares_owned);
      const oldCost = num(obj.avg_cost_basis);
      let newShares, newCost;
      if (p.action === 'Buy') {
        newShares = oldShares + num(p.shares);
        const totalCost = oldShares * oldCost + num(p.shares) * num(p.price_per_share);
        newCost = newShares ? totalCost / newShares : 0;
      } else { // Sell
        newShares = Math.max(0, oldShares - num(p.shares));
        newCost = oldCost; // keep avg cost basis
      }
      obj.shares_owned = newShares;
      obj.avg_cost_basis = newCost;
      obj.total_cost_basis = newShares * newCost;
      obj.last_modified = nowIso();
      sh2.getRange(idx, 1, 1, headers.length).setValues([headers.map(h => obj[h])]);
    }
  }
  return { ok: true };
}

function updateTarget(p) {
  validate(p, ['ticker']);
  const ticker = String(p.ticker).toUpperCase();
  const ownedIdx = findRowIndex(SHEETS.HOLDINGS, 'ticker', ticker);
  if (ownedIdx !== -1) {
    return updateHolding({ ticker, target_action: p.target_action, target_price: p.target_price });
  }
  // Else watchlist
  const wIdx = findRowIndex(SHEETS.WATCHLIST, 'ticker', ticker);
  if (wIdx === -1) return addWatchlist(p);
  return updateWatchlist({ ...p, ticker });
}

function updateNote(p) {
  validate(p, ['ticker']);
  const ticker = String(p.ticker).toUpperCase();
  const ownedIdx = findRowIndex(SHEETS.HOLDINGS, 'ticker', ticker);
  if (ownedIdx !== -1) return updateHolding({ ticker, notes: p.notes });
  return updateWatchlist({ ticker, notes: p.notes });
}

function addWatchlist(p) {
  validate(p, ['ticker']);
  const sh = getSheet(SHEETS.WATCHLIST);
  const ticker = String(p.ticker).toUpperCase();
  const existing = findRowIndex(SHEETS.WATCHLIST, 'ticker', ticker);
  if (existing !== -1) return updateWatchlist({ ...p, ticker });
  sh.appendRow([
    uid('w'), ticker, p.company_name || '',
    p.target_action || 'Watch', p.target_price || '',
    p.thesis_category || 'Market', p.notes || '', nowIso()
  ]);
  return { ok: true, ticker };
}

function updateWatchlist(p) {
  validate(p, ['ticker']);
  const ticker = String(p.ticker).toUpperCase();
  const sh = getSheet(SHEETS.WATCHLIST);
  const idx = findRowIndex(SHEETS.WATCHLIST, 'ticker', ticker);
  if (idx === -1) throw new Error('Watchlist entry not found');
  const headers = HEADERS[SHEETS.WATCHLIST];
  const cur = sh.getRange(idx, 1, 1, headers.length).getValues()[0];
  const obj = {}; headers.forEach((h, i) => obj[h] = cur[i]);
  ['company_name','target_action','target_price','thesis_category','notes']
    .forEach(k => { if (p[k] !== undefined && p[k] !== null) obj[k] = p[k]; });
  obj.last_modified = nowIso();
  sh.getRange(idx, 1, 1, headers.length).setValues([headers.map(h => obj[h])]);
  return { ok: true, ticker };
}

function deleteWatchlist(p) {
  validate(p, ['ticker']);
  const sh = getSheet(SHEETS.WATCHLIST);
  const idx = findRowIndex(SHEETS.WATCHLIST, 'ticker', String(p.ticker).toUpperCase());
  if (idx === -1) throw new Error('Not found');
  sh.deleteRow(idx);
  return { ok: true };
}

function addBasket(p) {
  validate(p, ['basket_name']);
  const sh = getSheet(SHEETS.BASKETS);
  const id = uid('b');
  sh.appendRow([id, p.basket_name, p.description || '', nowIso(), nowIso(), 'TRUE']);
  return { ok: true, basket_id: id };
}

function updateBasket(p) {
  validate(p, ['basket_id']);
  const sh = getSheet(SHEETS.BASKETS);
  const idx = findRowIndex(SHEETS.BASKETS, 'basket_id', p.basket_id);
  if (idx === -1) throw new Error('Basket not found');
  const headers = HEADERS[SHEETS.BASKETS];
  const cur = sh.getRange(idx, 1, 1, headers.length).getValues()[0];
  const obj = {}; headers.forEach((h, i) => obj[h] = cur[i]);
  ['basket_name','description','is_active'].forEach(k => { if (p[k] !== undefined) obj[k] = p[k]; });
  obj.last_modified = nowIso();
  sh.getRange(idx, 1, 1, headers.length).setValues([headers.map(h => obj[h])]);
  return { ok: true };
}

function deleteBasket(p) {
  validate(p, ['basket_id']);
  const sh = getSheet(SHEETS.BASKETS);
  const idx = findRowIndex(SHEETS.BASKETS, 'basket_id', p.basket_id);
  if (idx === -1) throw new Error('Basket not found');
  sh.deleteRow(idx);
  // Cascade: remove constituents
  const bh = getSheet(SHEETS.BASKET_HOLDINGS);
  const data = bh.getDataRange().getValues();
  for (let r = data.length - 1; r >= 1; r--) {
    if (data[r][1] === p.basket_id) bh.deleteRow(r + 1);
  }
  return { ok: true };
}

function addBasketHolding(p) {
  validate(p, ['basket_id', 'ticker']);
  const sh = getSheet(SHEETS.BASKET_HOLDINGS);
  sh.appendRow([
    uid('bh'), p.basket_id, String(p.ticker).toUpperCase(),
    p.company_name || '', num(p.goal_basket_allocation_percent),
    p.notes || '', nowIso()
  ]);
  return { ok: true };
}

function updateBasketHolding(p) {
  validate(p, ['basket_holding_id']);
  const sh = getSheet(SHEETS.BASKET_HOLDINGS);
  const idx = findRowIndex(SHEETS.BASKET_HOLDINGS, 'basket_holding_id', p.basket_holding_id);
  if (idx === -1) throw new Error('Basket holding not found');
  const headers = HEADERS[SHEETS.BASKET_HOLDINGS];
  const cur = sh.getRange(idx, 1, 1, headers.length).getValues()[0];
  const obj = {}; headers.forEach((h, i) => obj[h] = cur[i]);
  ['ticker','company_name','goal_basket_allocation_percent','notes'].forEach(k => {
    if (p[k] !== undefined) obj[k] = k === 'ticker' ? String(p[k]).toUpperCase() : p[k];
  });
  obj.last_modified = nowIso();
  sh.getRange(idx, 1, 1, headers.length).setValues([headers.map(h => obj[h])]);
  return { ok: true };
}

function removeBasketHolding(p) {
  validate(p, ['basket_holding_id']);
  const sh = getSheet(SHEETS.BASKET_HOLDINGS);
  const idx = findRowIndex(SHEETS.BASKET_HOLDINGS, 'basket_holding_id', p.basket_holding_id);
  if (idx === -1) throw new Error('Not found');
  sh.deleteRow(idx);
  return { ok: true };
}

function updateSettings(p) {
  Object.entries(p || {}).forEach(([k, v]) => {
    if (k === 'token') return;
    setMeta(k, v);
  });
  return { ok: true };
}

function validate(p, required) {
  if (!p) throw new Error('Missing payload');
  required.forEach(k => {
    if (p[k] === undefined || p[k] === null || p[k] === '') {
      throw new Error('Missing required field: ' + k);
    }
  });
}
