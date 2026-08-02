# Trade Journal — Phase 1 (Zero Local Execution)

Everything below runs in a browser tab or in the cloud. Nothing runs on
your laptop except opening a browser and, once, dragging a folder onto
a webpage.

## Step 1 — Supabase (database)

1. supabase.com/dashboard → New Project. Save the DB password you set.
2. Open SQL Editor → New query → paste all of `db/schema.sql` → Run.
3. Click **Connect** (top of dashboard) → copy the **Transaction pooler**
   connection string (port 6543 — this one, not Direct or Session, because
   Vercel functions are short-lived and need pooling). Replace the
   password placeholder with your real DB password. This is your
   `DATABASE_URL`.

## Step 2 — Get this project onto GitHub (no git command needed)

1. Extract the zip I gave you into one folder on your machine (just
   extracting a zip isn't "running" anything).
2. github.com → New repository → name it `trade-journal` → Create
   (don't initialize with a README, we already have one).
3. On the empty repo page, click **uploading an existing file**.
4. Open the extracted folder in Finder/Explorer, select everything
   inside it (not the outer folder itself), and drag the whole
   selection onto the GitHub upload page. Modern Chrome/Edge preserves
   the folder structure automatically.
5. Scroll down, commit directly to `main`.

## Step 3 — Vercel (deploy)

1. vercel.com → New Project → Import your `trade-journal` GitHub repo.
2. Before clicking Deploy, expand **Environment Variables** and add:
   - `DATABASE_URL` = the pooler string from Step 1
   - `INGEST_API_KEY` = a random string. Generate one at
     https://www.uuidgenerator.net/ or randomkeygen.com — no terminal
     needed.
3. Click Deploy. You'll get a live URL like
   `trade-journal-yourname.vercel.app`.

## Step 4 — Verify it's actually working (no curl, no Postman install)

1. Visit `https://your-app.vercel.app/api/health` in your browser.
   You should see `"ok": true` and `"db_connected": true`. If not, the
   error message tells you exactly what's wrong (usually DATABASE_URL).
2. To test the POST-based ingest endpoint without a terminal, use
   hoppscotch.io (free, browser-based, no install) — set method POST,
   URL `https://your-app.vercel.app/api/ingest`, add header
   `x-ingest-key: your-key`, body as JSON, Send.

## Step 5 — TradeLocker sync (fully cloud, via GitHub Actions)

No laptop and no VM needed for this one — it runs on GitHub's own
servers on a schedule.

1. In your GitHub repo → Settings → Secrets and variables → Actions →
   New repository secret. Add each of these one at a time:
   - `TL_ENV` (e.g. `https://demo.tradelocker.com`)
   - `TL_USERNAME`
   - `TL_PASSWORD`
   - `TL_SERVER`
   - `INGEST_URL` (your Vercel app's `/api/ingest` URL)
   - `INGEST_API_KEY` (same key as Step 3)
2. The workflow file `.github/workflows/tradelocker-sync.yml` is
   already in the repo — it runs automatically every 30 minutes once
   the secrets above are set.
3. To test it immediately instead of waiting 30 minutes: repo →
   Actions tab → "TradeLocker Sync" → Run workflow. Click into the run
   to see logs and confirm it succeeded.

## Step 6 — MT5 sync (this one does need the VM — unavoidable)

This is the one exception. `MetaTrader5`'s Python package only works
against a terminal running on the same machine — it cannot run on
GitHub's cloud servers or Vercel. It has to run on the Windows VM
where your MT5 terminal is already logged in (the same one running
your prop firm bot). That's your VM, not your laptop, so it still
matches "don't run this on my laptop."

1. On the VM (RDP in, same as when you work on the bot): install
   Python packages, drop in `.env` with `INGEST_URL` and
   `INGEST_API_KEY`, run `mt5_sync.py` once manually to confirm it
   works, then add it to Windows Task Scheduler to run every 15-30 min
   — same pattern as your bot's own schedule.

## What to check once data starts flowing

- Supabase → Table Editor → `trades` and `accounts` tables should
  start populating.
- `/api/health` will show `accounts_in_db` increasing from 0.
- GitHub → Actions tab shows green checkmarks for each scheduled run,
  or red X's with logs if something's misconfigured.

## Not built yet (next phases)

- Dashboard UI (charts, per-account view, drawdown) — Phase 1b, once
  a few days of real synced data looks correct.
- Journal entries, checklists, calendar — Phase 2.
- AI Insights/Coach/Chat — Phase 4, deliberately last.
