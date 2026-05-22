# Sidd's Stocks — Setup Guide

End-to-end setup, ~10 minutes. You'll need a Google account.

---

## 1) Create the Google Sheet

1. Go to [sheets.new](https://sheets.new) — a new blank spreadsheet opens.
2. Rename it to **Sidd's Stocks Data** (top-left title).
3. Leave the default `Sheet1`; the script will create the proper tabs in step 3.

---

## 2) Paste the Apps Script

1. In the sheet, click **Extensions → Apps Script**. A new editor tab opens with a single `Code.gs` file.
2. Delete the contents of `Code.gs`.
3. Open `apps-script/Code.gs` from this repo, copy the entire contents, and paste into the Apps Script editor.
4. Click the floppy-disk **Save** icon. Name the project **Sidds Stocks Backend** if asked.

### 2a) Set the write secret

1. In the Apps Script editor, click the gear icon → **Project Settings**.
2. Scroll to **Script Properties** → **Add script property**.
3. Property: `WRITE_SECRET` · Value: any random string (e.g. paste from a password manager — 24+ chars).
4. **Save**. Keep this value — you'll paste it into the front-end Settings tab.

---

## 3) Initialize the workbook

1. Back in **Editor**, in the top function dropdown select `initializeWorkbook`.
2. Click **Run**.
3. Google will prompt you to authorize — click **Review permissions**, choose your account, click **Advanced → Go to Sidds Stocks Backend (unsafe)** (this warning shows because the script is unverified — that's normal for personal scripts), click **Allow**.
4. The function runs and creates 6 tabs: `Holdings`, `Transactions`, `WatchlistTargets`, `Baskets`, `BasketHoldings`, `AppMeta`.

Switch back to the spreadsheet tab to confirm the new sheets exist.

---

## 4) Deploy as a web app

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to **Select type** → choose **Web app**.
3. Settings:
   - **Description**: `Sidds Stocks v1.0.0`
   - **Execute as**: **Me** (your account)
   - **Who has access**: **Anyone**
4. Click **Deploy**.
5. Copy the **Web app URL** — it ends in `/exec`. Save it somewhere.

> **About "Anyone" access:** the URL itself acts like a secret, and writes additionally require the `WRITE_SECRET` token. Reads are public to anyone who has the URL — fine for personal-use price data, but don't share the URL publicly. For maximum privacy, choose **Anyone with Google account** instead and use the front end inside Chrome with that account signed in.

> **When you update `Code.gs` later:** click **Deploy → Manage deployments → pencil icon on the existing deployment → Version: New version → Deploy**. The URL stays the same.

---

## 5) Host the front end on GitHub Pages

If I created the repo for you, this is already done. Otherwise:

1. Create a new public GitHub repo (e.g. `sidds-stocks`).
2. Upload everything in this folder **except** `apps-script/` and `SETUP.md` is fine to include.
3. Repo → **Settings → Pages** → Source: `main` branch / `/` (root) → **Save**.
4. Wait ~1 minute, your site is live at `https://<your-username>.github.io/sidds-stocks/`.

---

## 6) Connect the front end to the backend

1. Open the live GitHub Pages URL on your phone or desktop.
2. You'll be greeted with a "Welcome" screen → tap **Open Settings**.
3. Paste the Apps Script `/exec` URL into **Apps Script web app URL**.
4. Paste your `WRITE_SECRET` into **Write secret (token)**.
5. Tap **Test** — should say "Connection OK".
6. Tap **Save & reload**.
7. The Holdings tab will load (empty at first). Tap **+ Add** to log your first position.

---

## 7) Add to iPhone Home Screen

1. Open the GitHub Pages URL in **Safari** on iOS.
2. Tap the share button → **Add to Home Screen** → Add.
3. Launch from the home-screen icon — it runs full-screen with the bottom nav.
4. If data ever looks stale, open Settings → tap **Hard refresh**.

---

## Troubleshooting

**"API URL not configured"** — Open Settings, paste the `/exec` URL, Save & reload.

**"Unauthorized"** on writes — your front-end `WRITE_SECRET` doesn't match the Apps Script Script Property. Double-check both.

**Quotes show `—`** — Yahoo Finance rate-limited or unreachable from Apps Script. Wait a minute, hit Hard Refresh. Apps Script caches quotes for 60s.

**Got a CORS error** — make sure the deployment is set to "Who has access: Anyone" (not "Only myself"). The front end posts as `text/plain` to avoid CORS preflights, which Apps Script handles cleanly.

**Triggers don't appear** — verify the holding (or watchlist entry) has both `target_action` and `target_price` set. Triggers fire when:
- Buy: current price ≤ target
- Sell: current price ≥ target

**"Holding not found" when saving** — the script matches by `ticker` (case-insensitive). Make sure you didn't change the ticker mid-edit.

---

## Updating the app

Front end: edit files, commit & push to `main` — GitHub Pages redeploys automatically. Use Settings → **Hard refresh** to bust caches on iPhone.

Back end: edit `Code.gs` in the Apps Script editor → **Deploy → Manage deployments → pencil → New version → Deploy**.

Bump `APP_VERSION` in both `js/config.js` and `apps-script/Code.gs` when you ship a notable change.
