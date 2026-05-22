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

export function logoUrl(domain) {
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}?size=64`;
}

export function logoEl(name, ticker, domain) {
  const initial = (ticker || name || '?').slice(0, 2).toUpperCase();
  if (!domain) {
    return el('div', { class: 'logo' }, initial);
  }
  const wrap = el('div', { class: 'logo' }, initial);
  const img = el('img', { src: logoUrl(domain), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.remove());
  img.addEventListener('load', () => { wrap.textContent = ''; wrap.appendChild(img); });
  return wrap;
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
