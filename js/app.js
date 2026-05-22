// Sidd's Stocks — main entry
import { state, loadAll, subscribe, emit, getUnseenTriggerCount } from './state.js';
import { el, toast, relativeTime } from './ui.js';
import { APP_VERSION, getApiUrl } from './config.js';
import { renderHoldings } from './views/holdings.js';
import { renderTargets } from './views/targets.js';
import { renderAnalytics } from './views/analytics.js';
import { renderBaskets } from './views/baskets.js';
import { renderSettings } from './views/settings.js';

const VIEWS = {
  holdings: renderHoldings,
  targets: renderTargets,
  analytics: renderAnalytics,
  baskets: renderBaskets,
  settings: renderSettings,
};

function setActive(view) {
  state.ui.view = view;
  state.ui.expandedTicker = null;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  render();
  // Scroll top
  window.scrollTo({ top: 0 });
}

function render() {
  const root = document.getElementById('view-root');
  root.innerHTML = '';
  // Show Settings prompt if not configured
  if (!getApiUrl() && state.ui.view !== 'settings') {
    root.appendChild(el('div', { class: 'empty-state card' }, [
      el('div', { class: 'es-title' }, 'Welcome to Sidd\'s Stocks'),
      el('div', { class: 'es-sub' }, 'Connect your Google Sheets backend to get started.'),
      el('div', { class: 'es-action' }, [
        el('button', { class: 'btn', onclick: () => setActive('settings') }, 'Open Settings'),
      ]),
    ]));
    return;
  }

  if (state.loading && !state.initialized) {
    root.appendChild(el('div', { class: 'empty-state' }, [el('div', { class: 'es-title' }, 'Loading…')]));
    return;
  }

  const fn = VIEWS[state.ui.view] || VIEWS.holdings;
  fn(root);

  // Update header sub & footer
  const sub = document.getElementById('brand-sub');
  if (sub) sub.textContent = state.lastSync ? `synced ${relativeTime(state.lastSync)}` : '—';
  const fv = document.getElementById('footer-version'); if (fv) fv.textContent = `App v${APP_VERSION}`;
  const fs = document.getElementById('footer-sync'); if (fs) fs.textContent = `Last sync: ${relativeTime(state.lastSync)}`;

  // Update target badge
  const badge = document.getElementById('badge-targets');
  const count = getUnseenTriggerCount();
  if (badge) {
    if (count > 0) { badge.hidden = false; badge.textContent = count > 99 ? '99+' : String(count); }
    else { badge.hidden = true; }
  }
}

function bindNav() {
  document.querySelectorAll('.nav-item').forEach(b => {
    b.addEventListener('click', () => setActive(b.dataset.view));
  });
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.classList.add('spinning');
    try { await loadAll({ hard: false }); toast('Refreshed', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { btn.classList.remove('spinning'); }
  });
}

async function init() {
  bindNav();
  subscribe(() => render());
  if (!getApiUrl()) {
    render();
    return;
  }
  try {
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
    render();
  }
}

document.addEventListener('DOMContentLoaded', init);
