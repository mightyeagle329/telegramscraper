# Run locally (no Supabase, no cloud)

For developing / testing without any external services. Everything runs on your machine against the Python worker and local JSON files — exactly like before the Supabase integration.

## What "local-only" mode does

- **No login gate.** The dashboard opens directly with nav links to Groups / Accounts / Campaigns.
- **No multi-tenant scoping.** You see every account / campaign the Python worker knows about.
- **No Supabase calls.** `proxy.ts` and the `(dashboard)` layout detect missing env vars and skip auth entirely.
- **`/` redirects to `/dashboard`.** The marketing landing page only appears when Supabase is configured.
- **`/login`, `/signup`, `/callback` redirect to `/dashboard`** too, so you can't accidentally hit a broken auth form.
- A small yellow **"local dev"** badge appears in the nav to remind you which mode you're in.

## Quick start (fresh clone)

### Terminal 1 — Python backend

```bash
cd backend
python -m venv venv      # first time only
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # then edit it with your Telegram API id/hash/phone
python main.py
```

Backend listens on `http://localhost:8000`. First start prompts for a Telegram SMS code on your scraper account (written to `session.session`). Subsequent starts skip the prompt.

### Terminal 2 — Next.js dashboard

```bash
cd frontend
npm install              # first time only
# DO NOT create .env.local — that's what keeps you in local-only mode.
npm run dev
```

Open http://localhost:3000. You'll land directly on `/dashboard` (the overview page). Click **Groups / Accounts / Campaigns** in the top nav to reach the Phase 1 pages that call the Python backend.

## Switching to the full Supabase flow later

When you're ready to try the auth flow / multi-tenant setup, create `frontend/.env.local` from `.env.local.example` and fill in the three Supabase env vars. The same codebase then gates `/dashboard/*` behind login and shows the landing page at `/`.

The Python backend stays identical — we haven't wired it to Supabase yet. That's the next integration session.

## Troubleshooting local-only mode

**Dashboard shows "Backend Offline" in the top-right**
The Python backend isn't running or not on port 8000. Start it with `python main.py` in `backend/`.

**Visiting `/login` bounces me to `/dashboard`**
That's expected in local-only mode — Supabase isn't configured, so the login form would fail if you filled it in. The bounce prevents the dead-end.

**"local dev" yellow badge looks ugly**
It's intentional — visually distinguishes a dev environment from production. Once you configure Supabase, the badge is replaced by the user-menu button.

**I set Supabase env vars but still see local-dev mode**
Stop `npm run dev` and restart. Next.js only reads `.env.local` at server boot.

## Where state lives in local-only mode

| Data | File | Notes |
|---|---|---|
| Groups tracked | `backend/groups.json` | Phase 0 scraper state |
| Sender accounts | `backend/accounts.json` | created by `add_account.py` or the web wizard |
| Per-account Telethon sessions | `backend/sessions/acc_*.session` | binary SQLite; gitignored |
| DM queue | `backend/queue.json` | pending/sent per account |
| Send audit log | `backend/sent_log.json` | last 10k sends |
| Warm-up group URLs | `backend/warmup_groups.json` | seeded via PUT /api/warmup/groups |
| Scraped contacts | Google Sheets (configured in `.env`) | not yet migrated to Supabase |

All of these are gitignored already. Delete any of them to reset that piece of state.
