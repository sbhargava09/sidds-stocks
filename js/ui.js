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

// Logo strategy: try Financial Modeling Prep's free logo CDN by ticker
// (works for stocks and ETFs, no key required). If it fails, fall back
// to a domain-based logo via DuckDuckGo's icon service. Final fallback:
// rendered initials.
export function logoUrlsByTicker(ticker, name) {
  const t = String(ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const urls = [];
  if (t) {
    urls.push(`https://financialmodelingprep.com/image-stock/${t}.png`);
  }
  // Domain-based fallback for things FMP misses
  const domain = guessDomain(name, ticker);
  if (domain) {
    urls.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  }
  return urls;
}

function guessDomain(name, ticker) {
  const n = (name || '').toLowerCase()
    .replace(/\b(inc|corp|corporation|company|co\.?|ltd|llc|plc|holdings|group|the|s\.?a\.?|n\.?v\.?)\b/g, '')
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
    // Use a detached Image() to test loading without inserting a broken img
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer';
    probe.decoding = 'async';
    probe.onerror = () => { i++; tryNext(); };
    probe.onload = () => {
      if (probe.naturalWidth < 16 || probe.naturalHeight < 16) {
        i++; tryNext(); return;
      }
      // Replace initials with the actual <img>
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

// Kept for back-compat; some views imported this earlier.
export function logoUrl(domainOrTicker) {
  if (!domainOrTicker) return null;
  // Prefer ticker-style match
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
  // ESC to close
  const onKey = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return { close: closeModal };
}
export function closeModal() {
  const root = document.getElementById('modal-root');
  while (root.firstChild) root.firstChild.remove();
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
