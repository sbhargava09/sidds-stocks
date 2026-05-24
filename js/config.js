// Front-end configuration (persisted to localStorage)
export const APP_VERSION = '1.0.3';
export const STORAGE_KEYS = {
  apiUrl: 'ss.apiUrl',
  token: 'ss.token',
  seenTriggers: 'ss.seenTriggers',
  manualPrices: 'ss.manualPrices', // optional override (rarely used)
};

export function getApiUrl() {
  return localStorage.getItem(STORAGE_KEYS.apiUrl) || '';
}
export function setApiUrl(v) { localStorage.setItem(STORAGE_KEYS.apiUrl, (v || '').trim()); }
export function getToken() { return localStorage.getItem(STORAGE_KEYS.token) || ''; }
export function setToken(v) { localStorage.setItem(STORAGE_KEYS.token, (v || '').trim()); }

export const THESIS_OPTIONS = ['Market', 'Tech', 'Dividend', 'Speculative'];
export const TARGET_ACTIONS = ['', 'Buy', 'Sell', 'Watch'];
