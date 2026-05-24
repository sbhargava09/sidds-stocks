// Shared UI helpers
export function fmtMoney(n, opts = {}) {
  const { compact = false, sign = false } = opts;
  if (!isFinite(n)) return '—';
  const sgn = sign && n > 0 ? '+' : '';
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    notation: compact && Math.abs(n) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(n) >= 1000 ? (compact ? 1 : 2) : 2,
  });
  return sgn + formatter.format(n);
}
export function fmtPct(n, opts = {}) {
  const { sign = false, decimals = 2 } = opts;
  if (!isFinite(n)) return '—';
  const sgn = sign && n > 0 ? '+' : '';
  return `${sgn}${n.toFixed(decimals)}%`;
}
export function fmtNumber(n, decimals = 2) {
  if (!isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(n);
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v != null && v !== false) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null || c === false) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

let toastTimer = null;
export function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ── Logo strategy ──────────────────────────────────────────────────────────
// 1. Financial Modeling Prep CDN by ticker (free, no auth, S&P500/Nasdaq100 coverage)
// 2. DuckDuckGo favicon by domain (broad fallback)
// 3. Rendered initials (always works)

// Manual domain overrides for tickers whose company name guesses wrong
// or whose FMP logo is missing/broken.
const DOMAIN_OVERRIDES = {
  V:    'visa.com',
  MA:   'mastercard.com',
  BRK:  'berkshirehathaway.com',
  'BRK.B': 'berkshirehathaway.com',
  'BRK.A': 'berkshirehathaway.com',
  BRKB: 'berkshirehathaway.com',
  BRKA: 'berkshirehathaway.com',
  JPM:  'jpmorganchase.com',
  GS:   'goldmansachs.com',
  MS:   'morganstanley.com',
  BAC:  'bankofamerica.com',
  WFC:  'wellsfargo.com',
  C:    'citigroup.com',
  USB:  'usbank.com',
  TFC:  'truist.com',
  PNC:  'pnc.com',
  COF:  'capitalone.com',
  AXP:  'americanexpress.com',
  DIS:  'disney.com',
  CMCSA:'comcast.com',
  T:    'att.com',
  VZ:   'verizon.com',
  TMUS: 't-mobile.com',
  XOM:  'exxonmobil.com',
  CVX:  'chevron.com',
  COP:  'conocophillips.com',
  SLB:  'slb.com',
  EOG:  'eogresources.com',
  PXD:  'pioneernaturalresources.com',
  MPC:  'marathonpetroleum.com',
  VLO:  'valero.com',
  PSX:  'phillips66.com',
  MRO:  'marathonoil.com',
  KO:   'coca-cola.com',
  PEP:  'pepsico.com',
  MCD:  'mcdonalds.com',
  SBUX: 'starbucks.com',
  YUM:  'yum.com',
  CMG:  'chipotle.com',
  DPZ:  'dominos.com',
  QSR:  'rbi.com',
  PM:   'pmi.com',
  MO:   'altria.com',
  BTI:  'bat.com',
  PG:   'pg.com',
  JNJ:  'jnj.com',
  UNH:  'unitedhealthgroup.com',
  CVS:  'cvshealth.com',
  CI:   'cigna.com',
  HUM:  'humana.com',
  ELV:  'elevancehealth.com',
  MCK:  'mckesson.com',
  ABC:  'amerisourcebergen.com',
  CAH:  'cardinalhealth.com',
  LLY:  'lilly.com',
  PFE:  'pfizer.com',
  MRK:  'merck.com',
  ABBV: 'abbvie.com',
  BMY:  'bms.com',
  AMGN: 'amgen.com',
  GILD: 'gilead.com',
  BIIB: 'biogen.com',
  REGN: 'regeneron.com',
  VRTX: 'vrtx.com',
  ISRG: 'intuitive.com',
  SYK:  'stryker.com',
  BSX:  'bostonscientific.com',
  MDT:  'medtronic.com',
  ABT:  'abbott.com',
  ZBH:  'zimmerbiomet.com',
  BDX:  'bd.com',
  TMO:  'thermofisher.com',
  DHR:  'danaher.com',
  IQV:  'iqvia.com',
  AAPL: 'apple.com',
  MSFT: 'microsoft.com',
  GOOGL:'google.com',
  GOOG: 'google.com',
  META: 'meta.com',
  AMZN: 'amazon.com',
  NVDA: 'nvidia.com',
  TSLA: 'tesla.com',
  NFLX: 'netflix.com',
  ADBE: 'adobe.com',
  CRM:  'salesforce.com',
  ORCL: 'oracle.com',
  INTC: 'intel.com',
  AMD:  'amd.com',
  QCOM: 'qualcomm.com',
  TXN:  'ti.com',
  AVGO: 'broadcom.com',
  MU:   'micron.com',
  KLAC: 'kla.com',
  LRCX: 'lamresearch.com',
  AMAT: 'appliedmaterials.com',
  MRVL: 'marvell.com',
  ON:   'onsemi.com',
  STM:  'st.com',
  MCHP: 'microchip.com',
  SWKS: 'skyworks.com',
  QRVO: 'qorvo.com',
  MPWR: 'monolithicpower.com',
  CSCO: 'cisco.com',
  IBM:  'ibm.com',
  HPQ:  'hp.com',
  HPE:  'hpe.com',
  DELL: 'dell.com',
  ANET: 'arista.com',
  JNPR: 'juniper.net',
  ACN:  'accenture.com',
  INTU: 'intuit.com',
  NOW:  'servicenow.com',
  WDAY: 'workday.com',
  SNOW: 'snowflake.com',
  PLTR: 'palantir.com',
  ZS:   'zscaler.com',
  CRWD: 'crowdstrike.com',
  PANW: 'paloaltonetworks.com',
  FTNT: 'fortinet.com',
  NET:  'cloudflare.com',
  DDOG: 'datadoghq.com',
  CFLT: 'confluent.io',
  MDB:  'mongodb.com',
  ESTC: 'elastic.co',
  GTLB: 'gitlab.com',
  ZM:   'zoom.us',
  TEAM: 'atlassian.com',
  OKTA: 'okta.com',
  DOCU: 'docusign.com',
  TWLO: 'twilio.com',
  SHOP: 'shopify.com',
  SQ:   'squareup.com',
  PYPL: 'paypal.com',
  COIN: 'coinbase.com',
  HOOD: 'robinhood.com',
  AFRM: 'affirm.com',
  SOFI: 'sofi.com',
  UBER: 'uber.com',
  LYFT: 'lyft.com',
  ABNB: 'airbnb.com',
  BKNG: 'booking.com',
  EXPE: 'expedia.com',
  MAR:  'marriott.com',
  HLT:  'hilton.com',
  LVS:  'lasvegassands.com',
  MGM:  'mgmresorts.com',
  WYNN: 'wynnresorts.com',
  CZR:  'caesars.com',
  AAL:  'aa.com',
  DAL:  'delta.com',
  UAL:  'united.com',
  LUV:  'southwest.com',
  ALK:  'alaskaair.com',
  JBLU: 'jetblue.com',
  BA:   'boeing.com',
  LMT:  'lockheedmartin.com',
  RTX:  'rtx.com',
  NOC:  'northropgrumman.com',
  GD:   'gd.com',
  L3H:  'l3harris.com',
  TDG:  'transdigm.com',
  HON:  'honeywell.com',
  MMM:  '3m.com',
  GE:   'ge.com',
  CAT:  'caterpillar.com',
  DE:   'deere.com',
  EMR:  'emerson.com',
  ETN:  'eaton.com',
  ROK:  'rockwellautomation.com',
  PH:   'parker.com',
  IR:   'irco.com',
  AMT:  'americantower.com',
  CCI:  'crowncastle.com',
  SBAC: 'sbasite.com',
  PLD:  'prologis.com',
  EQIX: 'equinix.com',
  DLR:  'digitalrealty.com',
  PSA:  'publicstorage.com',
  EXR:  'extraspace.com',
  O:    'realtyincome.com',
  SPG:  'simon.com',
  BXP:  'bxp.com',
  VTR:  'ventasreit.com',
  WELL: 'welltower.com',
  NEE:  'nexteraenergy.com',
  DUK:  'duke-energy.com',
  SO:   'southerncompany.com',
  D:    'dominionenergy.com',
  AEP:  'aep.com',
  EXC:  'exeloncorp.com',
  XEL:  'xcelenergy.com',
  ED:   'coned.com',
  WM:   'wm.com',
  RSG:  'republicservices.com',
  ECL:  'ecolab.com',
  DOW:  'dow.com',
  LIN:  'linde.com',
  APD:  'airproducts.com',
  SHW:  'sherwin-williams.com',
  PPG:  'ppg.com',
  NUE:  'nucor.com',
  FCX:  'freeportmcmoran.com',
  NEM:  'newmont.com',
  AA:   'alcoa.com',
  X:    'ussteel.com',
  CLF:  'clevelandcliffs.com',
  VMC:  'vulcanmaterials.com',
  MLM:  'martinmarietta.com',
  VOO:  'vanguard.com',
  SPY:  'ssga.com',
  QQQ:  'invesco.com',
  VTI:  'vanguard.com',
  IVV:  'ishares.com',
  VEA:  'vanguard.com',
  VWO:  'vanguard.com',
  AGG:  'ishares.com',
  BND:  'vanguard.com',
  GLD:  'spdrgoldshares.com',
  SLV:  'ishares.com',
  ARKK: 'ark-funds.com',
  ARKG: 'ark-funds.com',
  ARKW: 'ark-funds.com',
};

// Build ordered list of logo URLs to try for a given ticker/name
// 1. Financial Modeling Prep CDN by ticker — best free coverage for S&P500/Nasdaq100
// 2. DuckDuckGo favicon by domain — broad fallback for any company
// 3. Rendered initials — always works
export function logoUrlsByTicker(ticker, name) {
  const t = String(ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const urls = [];

  // 1. FMP CDN — free, no auth, excellent coverage for all major US equities & ETFs
  if (t) urls.push(`https://financialmodelingprep.com/image-stock/${t}.png`);

  // 2. DuckDuckGo favicon fallback (domain-based)
  const domain = DOMAIN_OVERRIDES[t] || guessDomain(name, ticker);
  if (domain) urls.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);

  return urls;
}

function guessDomain(name, ticker) {
  const n = (name || '').toLowerCase()
    .replace(/\b(inc|corp|corporation|company|co\.?|ltd|llc|plc|holdings|group|the|s\.?a\.?|n\.?v\.?|class [ab]|common stock|ordinary shares?)\b/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ').trim();
  const word = (n || (ticker || '').toLowerCase()).split(/[\s,&]+/)[0];
  if (!word || word.length < 2) return null;
  return word.replace(/[^a-z0-9-]/g, '') + '.com';
}

export function logoEl(name, ticker /*, _legacyDomain */) {
  const initial = (ticker || name || '?').slice(0, 2).toUpperCase();
  const wrap = el('div', { class: 'logo' }, initial);
  const urls = logoUrlsByTicker(ticker, name);
  if (!urls.length) return wrap;

  let i = 0;
  const tryNext = () => {
    if (i >= urls.length) return; // all failed → keep initials
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer';
    probe.decoding = 'async';
    probe.onerror = () => { i++; tryNext(); };
    probe.onload = () => {
      if (probe.naturalWidth < 16 || probe.naturalHeight < 16) {
        i++; tryNext(); return;
      }
      wrap.textContent = '';
      const img = el('img', {
        src: urls[i],
        alt: '', loading: 'lazy',
        referrerpolicy: 'no-referrer', decoding: 'async',
      });
      wrap.appendChild(img);
    };
    probe.src = urls[i];
  };
  tryNext();
  return wrap;
}

export function logoUrl(domainOrTicker) {
  if (!domainOrTicker) return null;
  if (/^[A-Z0-9.-]{1,6}$/.test(domainOrTicker)) {
    return `https://financialmodelingprep.com/image-stock/${domainOrTicker}.png`;
  }
  return `https://icons.duckduckgo.com/ip3/${domainOrTicker}.ico`;
}

export function gainClass(n) {
  if (!isFinite(n) || Math.abs(n) < 0.005) return 'flat';
  return n > 0 ? 'up' : 'down';
}

export function openModal(content) {
  const root = document.getElementById('modal-root');
  closeModal();
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' });
  modal.appendChild(content);
  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  root.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => backdrop.classList.add('visible'));
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  document.body.style.overflow = '';
}
