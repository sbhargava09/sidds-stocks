import { state, loadAll } from '../state.js';
import { el, fmtMoney, toast, relativeTime } from '../ui.js';
import { getApiUrl, setApiUrl, getToken, setToken, APP_VERSION } from '../config.js';
import { ping } from '../api.js';

export function renderSettings(root) {
  // Connection card
  const connCard = el('div', { class: 'card' });
  connCard.appendChild(el('div', { class: 'card-title' }, 'Backend connection'));

  const urlField = el('div', { class: 'field' });
  urlField.appendChild(el('label', {}, 'Apps Script web app URL'));
  const urlInput = el('input', {
    type: 'url',
    placeholder: 'https://script.google.com/macros/s/.../exec',
    value: getApiUrl(),
  });
  urlField.appendChild(urlInput);
  connCard.appendChild(urlField);

  const tokenField = el('div', { class: 'field' });
  tokenField.appendChild(el('label', {}, 'Write secret (token)'));
  const tokenInput = el('input', { type: 'password', placeholder: 'Same value as WRITE_SECRET in Apps Script', value: getToken() });
  tokenField.appendChild(tokenInput);
  connCard.appendChild(tokenField);

  const btnRow = el('div', { class: 'edit-actions' });
  const testBtn = el('button', { class: 'btn secondary sm' }, 'Test');
  testBtn.addEventListener('click', async () => {
    setApiUrl(urlInput.value);
    testBtn.disabled = true; testBtn.textContent = 'Testing…';
    const r = await ping();
    testBtn.disabled = false; testBtn.textContent = 'Test';
    toast(r.ok ? 'Connection OK' : 'Failed: ' + r.message, r.ok ? 'success' : 'error');
  });
  btnRow.appendChild(testBtn);

  const saveBtn = el('button', { class: 'btn sm' }, 'Save & reload');
  saveBtn.addEventListener('click', async () => {
    setApiUrl(urlInput.value);
    setToken(tokenInput.value);
    toast('Saved', 'success');
    try { await loadAll({ hard: true }); } catch (e) { toast(e.message, 'error'); }
  });
  btnRow.appendChild(saveBtn);

  connCard.appendChild(btnRow);
  root.appendChild(connCard);

  // App info card
  const infoCard = el('div', { class: 'card' });
  infoCard.appendChild(el('div', { class: 'card-title' }, 'App info'));
  infoCard.appendChild(settingsRow('App version', APP_VERSION));
  infoCard.appendChild(settingsRow('Last sync', relativeTime(state.lastSync)));
  infoCard.appendChild(settingsRow('Backend last sync', state.settings.last_successful_sync ? relativeTime(state.settings.last_successful_sync) : '—'));
  infoCard.appendChild(settingsRow('Schema version', state.settings.schema_version || '1'));
  infoCard.appendChild(settingsRow('Holdings count', String(state.holdings.length)));
  infoCard.appendChild(settingsRow('Baskets count', String(state.baskets.length)));
  root.appendChild(infoCard);

  // Refresh card
  const refreshCard = el('div', { class: 'card' });
  refreshCard.appendChild(el('div', { class: 'card-title' }, 'Refresh'));
  refreshCard.appendChild(el('div', { class: 'faint', style: 'margin-bottom:10px;' },
    'Hard refresh re-fetches everything with cache busting (useful for iPhone Safari home-screen).'));
  const rrow = el('div', { class: 'edit-actions' });
  const rsoft = el('button', { class: 'btn secondary sm' }, 'Refresh data');
  rsoft.addEventListener('click', async () => { try { await loadAll(); toast('Refreshed', 'success'); } catch (e) { toast(e.message, 'error'); } });
  const rhard = el('button', { class: 'btn sm' }, 'Hard refresh');
  rhard.addEventListener('click', async () => {
    try { await loadAll({ hard: true }); toast('Hard refreshed', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    // Reload assets too
    setTimeout(() => location.replace(location.pathname + '?t=' + Date.now()), 400);
  });
  rrow.appendChild(rsoft); rrow.appendChild(rhard);
  refreshCard.appendChild(rrow);
  root.appendChild(refreshCard);

  // Placeholders
  const placeCard = el('div', { class: 'card' });
  placeCard.appendChild(el('div', { class: 'card-title' }, 'Preferences (coming soon)'));
  placeCard.appendChild(el('div', { class: 'faint' }, 'Notifications · Theme · Display density · Default refresh interval'));
  root.appendChild(placeCard);

  // Help / setup
  const helpCard = el('div', { class: 'card' });
  helpCard.appendChild(el('div', { class: 'card-title' }, 'Setup help'));
  helpCard.appendChild(el('div', { class: 'faint', html:
    'See <a href="./SETUP.md" target="_blank" rel="noopener">SETUP.md</a> in the repo for step-by-step instructions: create the Google Sheet, paste the Apps Script, deploy as a web app, then paste the URL above.'
  }));
  root.appendChild(helpCard);
}

function settingsRow(label, value) {
  const row = el('div', { class: 'settings-row' });
  row.appendChild(el('span', { class: 'label' }, label));
  row.appendChild(el('span', { class: 'value tabular' }, value));
  return row;
}
