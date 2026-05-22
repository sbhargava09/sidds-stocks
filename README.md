# Sidd's Stocks

A clean, mobile-first personal stock portfolio web app. Front end is a static site hosted on **GitHub Pages**; the back end is a **Google Apps Script** web app reading and writing a **Google Sheets** workbook.

> **Architecture**
> - Front end (this repo) → static HTML/CSS/vanilla JS, charts via Chart.js
> - Back end → Google Apps Script `doGet` / `doPost` returning JSON
> - Source of truth → Google Sheets workbook (6 tabs)
> - Quotes → Yahoo Finance, fetched server-side from Apps Script (free, no API key)
> - Logos → `logo.clearbit.com` (free, best-effort)

## Features

**Five tabs** with bottom navigation:

1. **Holdings** — grouped by thesis (Market / Tech / Dividend / Speculative), search, filter by gainers/losers/triggered, sort by ticker / name / price / gain / portfolio % / target distance, accordion edit panels.
2. **Buy/Sell Targets** — separate Buy / Sell / Watch sections, automatic trigger detection when current price crosses target, filter by owned/watch, sort by closest / overdue / newest.
3. **Analytics** — KPI cards (value, P/L, alerts), donut by thesis, top-10 weight bar, top-5 concentration, day gainers/losers, best/worst dollar positions, action lists.
4. **Baskets** — custom ETF-style grouping with goal weights, drift, rebalance suggestions, 100% sum validation.
5. **Settings** — backend URL & write secret config, app version, last sync, refresh & hard refresh.

Other goodies:
- iPhone Safari-friendly hard refresh with cache-busting
- Notification badge on Targets tab when triggers fire
- Visible app version in footer
- Add as home-screen web app (manifest included)
- Designed for one user

## Quick start

See [SETUP.md](./SETUP.md) for full step-by-step instructions. The short version:

1. Make a copy of a Google Sheet (any blank one).
2. Extensions → Apps Script → paste `apps-script/Code.gs`.
3. Set Script Property `WRITE_SECRET` to a random string.
4. Run `initializeWorkbook` once from the editor.
5. Deploy → New deployment → Web app, "Execute as: me", "Who has access: Anyone".
6. Copy the `/exec` URL.
7. Open the deployed front-end (your GitHub Pages URL), go to **Settings**, paste the URL and your `WRITE_SECRET`, hit **Save & reload**.

## Files

```
sidds-stocks/
├── index.html
├── manifest.webmanifest
├── css/
│   └── styles.css
├── js/
│   ├── app.js           # entry, navigation, render orchestration
│   ├── api.js           # fetch/post against the Apps Script web app
│   ├── config.js        # localStorage-backed settings
│   ├── state.js         # central app state + derived selectors
│   ├── ui.js            # element/format/modal/toast helpers
│   └── views/
│       ├── holdings.js
│       ├── targets.js
│       ├── analytics.js
│       ├── baskets.js
│       └── settings.js
├── apps-script/
│   ├── Code.gs          # backend — paste into Apps Script editor
│   └── appsscript.json  # manifest (optional reference)
├── README.md
└── SETUP.md
```

## Versioning

The app version lives in two places — keep them aligned:
- `js/config.js` → `APP_VERSION`
- `apps-script/Code.gs` → `APP_VERSION`

## License

MIT — personal use.
