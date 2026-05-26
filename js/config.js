// Front-end configuration
export const APP_VERSION = '1.3.2';
export const STORAGE_KEYS = {
  apiUrl: 'ss.apiUrl',
  token: 'ss.token',
  seenTriggers: 'ss.seenTriggers',
  manualPrices: 'ss.manualPrices',
  theme: 'ss.theme',
};

export function getApiUrl() {
  return localStorage.getItem(STORAGE_KEYS.apiUrl) || '';
}
export function setApiUrl(v) { localStorage.setItem(STORAGE_KEYS.apiUrl, (v || '').trim()); }
export function getToken() { return localStorage.getItem(STORAGE_KEYS.token) || ''; }
export function setToken(v) { localStorage.setItem(STORAGE_KEYS.token, (v || '').trim()); }
export function getTheme() { return localStorage.getItem(STORAGE_KEYS.theme) || 'system'; }
export function setTheme(v) { localStorage.setItem(STORAGE_KEYS.theme, v); }

export const THESIS_OPTIONS = ['Market', 'Tech', 'Dividend', 'Speculative'];
export const TARGET_ACTIONS = ['', 'Buy', 'Sell', 'Watch'];
export const ACCOUNT_TYPES  = ['Brokerage', 'Roth IRA', '401k'];
