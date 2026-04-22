# Telegram Outreach Automation

Multi-account Telegram outreach platform. Scrape members from groups, warm up sender accounts automatically, and send personalised DMs at scale with random delays, per-account proxies, and auto-recovery — all from a multi-tenant web dashboard.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Next.js 16 dashboard                                                  │
│  Landing · Auth · Overview · Groups · Contacts · Accounts · Templates  │
│  Campaigns · Settings · Dark/Light · EN/PT/ES                          │
└───────────────────────────┬────────────────────────────────────────────┘
                            │ REST + Supabase Auth cookies
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Python FastAPI worker                                                 │
│  Scraper · Signup wizard · Safe sender · Warm-up · Error handler       │
│  Health checks · Per-account Telethon client pool w/ SOCKS5 proxies    │
└──────────┬─────────────────────────────────────────┬───────────────────┘
           │                                         │
           ▼                                         ▼
  ┌────────────────┐                       ┌────────────────────┐
  │  Supabase      │                       │  Google Sheets     │
  │  Postgres+RLS  │                       │  scraped contacts  │
  │  Auth          │                       └────────────────────┘
  └────────────────┘
```

## What it does

**Phase 0 — Data collection**
- Scrape full member lists from supergroups
- Scrape unique senders from message history (works on broadcast channels too — auto-detects linked discussion groups)
- Auto-export to Google Sheets with deduplication
- Background monitor for new members (per-group, resumable)

**Phase 1 — Multi-account sender**
- Up to 10 Telegram accounts managed from one dashboard
- Per-account residential or mobile proxy (SOCKS5 / SOCKS4 / HTTP)
- Web-based SMS signup wizard (3-step: phone+proxy → code → optional 2FA)
- 7-day warm-up: each account joins groups, reads messages, reacts — no DMs
- Daily DM ladder: 0 → 3 → 5 → 10 → 15 → 20 → 30 → 40 → 50 over ~21 days
- Safe sender: random 45–180s delays, unique invisible suffix per message, weighted template rotation
- Optional send-delete (deletes our copy N seconds after sending)
- Auto-pause on `PeerFloodError` (48h cooldown)
- Auto-pause on long `FloodWaitError` (respects Telegram's exact wait)
- Auto-ban detection (`PhoneNumberBannedError`, `UserDeactivatedBanError`)
- Per-account health checks every 30 min
- Queue persisted across restarts

**Dashboard**
- Public landing page
- Email/password signup, login, password reset via Supabase Auth
- Protected dashboard with mobile-responsive nav
- 7 pages: Overview · Groups · Contacts · Accounts · Templates · Campaigns · Settings
- Worker health banner (yellow/red) when any account is paused/banned
- Dark · Light · System theme
- English · Português · Español translations
- Pagination + sort + search + CSV export on all data tables
- Inline-edit account friendly names

## Stack

- **Frontend**: Next.js 16 (App Router, Turbopack) + React 19 + Tailwind 4 + TypeScript
- **Backend**: Python 3.12 + FastAPI + Telethon + APScheduler
- **Database**: Supabase (Postgres + RLS + Auth)
- **Contacts store**: Google Sheets (migrating to Supabase in Phase 2)
- **Proxies**: IPRoyal residential sticky sessions, mobile proxies (fxdx.in and compatible)
- **Deployment**: Vercel (frontend) + Fly.io (backend + volume) + Supabase (DB+Auth)

## Quick start (local, no Supabase, no cloud)

Two terminals. Everything runs on your machine.

### Terminal 1 — Python backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Linux/Mac
# venv\Scripts\activate         # Windows
pip install -r requirements.txt

cp .env.example .env             # then edit with your Telegram creds
python main.py
```

On first run:
1. Your browser opens a Google OAuth page (for Google Sheets). Sign in with the account that owns your target Google Sheet → creates `backend/token.json`.
2. The terminal prompts for a Telegram SMS code (for the scraper account). Enter the code → creates `backend/session.session`.

Backend listens on `http://localhost:8000`.

### Terminal 2 — Next.js dashboard

```bash
cd frontend
npm install
# DO NOT create .env.local — staying empty keeps the app in local-dev mode
npm run dev
```

Open `http://localhost:3000` — redirects straight to `/dashboard` (no login needed in local mode). A yellow **local dev** badge appears in the nav to remind you.

See [docs/RUN-LOCALLY.md](docs/RUN-LOCALLY.md) for troubleshooting.

## Full setup (Supabase + production deploy)

Walkthrough: [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

The short version:
1. Create a Supabase project, run the two SQL files in `supabase/migrations/` in the SQL editor.
2. Put the Supabase URL + keys in `frontend/.env.local` and, eventually, in Vercel and Fly env vars.
3. Deploy backend to Fly.io (`flyctl launch` in `backend/` — `Dockerfile` and `fly.toml` are ready).
4. Deploy frontend to Vercel (root directory = `frontend`).
5. Point Vercel's `NEXT_PUBLIC_API_URL` at the Fly URL.

## Prerequisites

- **Python 3.10+** (3.12 recommended)
- **Node.js 18+** (for Next.js 16)
- **Telegram account** with API credentials from https://my.telegram.org
- **Google Cloud project** with OAuth client credentials (for Sheets)
- **Google Sheet** the account can access
- *(Optional)* **Supabase project** for auth + multi-tenant
- *(Phase 1)* **Residential or mobile proxies** (IPRoyal ~$20–30/mo covers 10 accounts)
- *(Phase 1)* **Phone numbers** for sender accounts — physical SIMs recommended for 2–3 anchors, virtual from 5sim for the rest

## Project structure

```
telegram_bot/
├── backend/                          Python FastAPI worker
│   ├── main.py                       API routes + lifespan + scheduled jobs
│   ├── scraper.py                    Phase 0 Telethon scraping (members + messages)
│   ├── sheets.py                     Google Sheets export
│   ├── monitor.py                    APScheduler background monitor
│   ├── storage.py                    JSON persistence for groups
│   ├── accounts.py                   Phase 1 account registry + warm-up ladder
│   ├── client_pool.py                Per-account Telethon clients with proxies
│   ├── sender.py                     Safe sender: queue, delays, templating
│   ├── warmup.py                     Warm-up worker (joins, reads, reactions)
│   ├── error_handler.py              Classifies FloodWait/PeerFlood/Banned/etc.
│   ├── signup.py                     Web-based SMS signup flow (stateful)
│   ├── add_account.py                CLI signup (alternative to web wizard)
│   ├── models.py                     Pydantic request/response models
│   ├── config.py                     Environment variables
│   ├── requirements.txt
│   ├── Dockerfile                    Fly.io deployment image
│   ├── fly.toml                      Fly.io app config (persistent volume)
│   ├── .env.example
│   ├── session.session               (auto) scraper account Telethon session
│   ├── sessions/                     (auto) Phase 1 sender sessions per account
│   ├── accounts.json                 (auto) 10-account registry
│   ├── queue.json                    (auto) pending DMs per account
│   ├── sent_log.json                 (auto) audit log of every send attempt
│   └── groups.json                   (auto) tracked groups
│
├── frontend/                         Next.js 16 dashboard (React 19 + Tailwind 4)
│   └── src/
│       ├── app/
│       │   ├── (landing)/            Public marketing page
│       │   ├── (auth)/               Login, signup, callback
│       │   ├── (dashboard)/          Protected pages
│       │   │   ├── layout.tsx        Auth guard + nav + health banner
│       │   │   ├── dashboard/        Overview
│       │   │   ├── groups/           Phase 0 scraper
│       │   │   ├── contacts/         Scraped users table
│       │   │   ├── accounts/         Sender fleet + signup wizard
│       │   │   ├── templates/        Message templates CRUD (Supabase)
│       │   │   ├── campaigns/        Launch + queue view
│       │   │   └── settings/         Profile + sending defaults
│       │   ├── layout.tsx            Root + theme-boot script + LocaleProvider
│       │   └── globals.css           Light/dark theme tokens
│       ├── components/               Shared UI: NavBar, ThemeToggle, LanguageToggle,
│       │                             AddAccountModal, ProxyCell, Pagination,
│       │                             WorkerHealthBanner, AccountLabelEditor, ...
│       ├── lib/
│       │   ├── api.ts                Typed API client for the Python backend
│       │   ├── supabase/             Browser/server/admin clients + proxy.ts
│       │   ├── actions/              Server actions (templates, settings)
│       │   └── i18n/                 Messages (en/pt/es) + LocaleProvider + useT
│       ├── types/
│       │   └── database.ts           TypeScript mirror of the Supabase schema
│       └── proxy.ts                  Next.js 16 middleware (auth session refresh)
│
├── supabase/
│   └── migrations/
│       ├── 00001_initial_schema.sql  10 tables + 4 enums + RLS policies + triggers
│       └── 00002_user_settings.sql   Per-user sending preferences
│
├── docs/
│   ├── DEPLOYMENT.md                 Vercel + Fly.io + Supabase step-by-step
│   ├── SETUP-SUPABASE.md             Supabase provisioning walkthrough
│   └── RUN-LOCALLY.md                Local-only dev (no cloud services)
│
├── .gitignore
└── README.md                         This file
```

## Configuration

### Backend `.env` (in `backend/.env`, never commit)

```env
# Telegram (scraper + default for new sender accounts)
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=abcdef0123456789abcdef0123456789
TELEGRAM_PHONE=+1234567890

# Google Sheets
GOOGLE_SHEET_URL=https://docs.google.com/spreadsheets/d/your_sheet_id/edit
GOOGLE_CREDENTIALS_FILE=credentials.json

# Optional
MONITOR_INTERVAL=300
FRONTEND_URL=http://localhost:3000

# Optional (for Supabase-aware backend — Phase 2)
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

### Frontend `.env.local` (in `frontend/.env.local`, gitignored)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000

# Leave these blank for local-dev mode; fill in for production
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## How to use

### 1. Scrape a group

1. Open the dashboard at `/groups`.
2. Paste a Telegram URL (`https://t.me/groupname`, `https://t.me/+hash`, or `@username`) → click **+ Add**.
3. Click **Scrape Members** (for supergroups) or **Scrape Messages** (for broadcast channels).
4. Click **Monitor** to auto-detect new members every 5 min.

Results land in your Google Sheet: one tab per group, plus a Dashboard summary tab.

### 2. Onboard a sender account

**Option A — Web wizard** (recommended)

1. `/accounts` → **+ Add account**.
2. Fill phone (E.164 format), optional label, and the proxy details (IPRoyal or mobile proxy).
3. Click **Send SMS code** → enter the code.
4. If the account has 2FA cloud password → enter it.
5. Success → the account appears in the table with status `warming`, worker auto-starts.

**Option B — CLI**

```bash
cd backend && source venv/bin/activate
python add_account.py
```

Answers the same prompts interactively. Useful for headless setups.

### 3. Create message templates

1. `/templates` → **+ New template**.
2. Name: `Opener EN — casual`.
3. Body: `Hey {first_name}, saw you in the group — mind a quick chat?`
4. Create **at least 3 variants** — the sender picks one at random per DM so no two go out byte-identical.

Placeholders:
- `{first_name}` — from the recipient's Telegram profile
- `{last_name}`
- `{username}`

### 4. Launch a campaign

1. `/campaigns`.
2. **Source sheet**: pick the scraped group.
3. **Sender accounts**: tick the accounts to use (warming accounts are pickable — DMs will queue until day 8).
4. **Message templates**: paste 3+ variants separated by a line containing `---`.
5. Optional: name, limit (caps total DMs), delete-after (seconds).
6. **Enqueue campaign**.

The sender worker picks up the queue and starts sending at each account's current daily limit with random 45–180s delays between sends.

## Phase 1 safety details (under the hood)

| Safety | Source |
|---|---|
| Warm-up ladder: days 1–7 zero, 3 → 50 over days 8–22 | `backend/accounts.py::WARMUP_LADDER` |
| Random delay between sends: uniform 45–180s | `backend/sender.py::DELAY_RANGE_S` |
| Unique message per send: 1–3 zero-width chars appended | `backend/sender.py::_invisible_suffix` |
| Weighted template rotation | `backend/sender.py::_pick_message` |
| 48h cool-down after `PeerFloodError` | `backend/error_handler.py::PEER_FLOOD_PAUSE_S` |
| Long `FloodWaitError` pauses account for that exact duration | `backend/error_handler.py::classify` |
| Terminal-ban detection | `backend/client_pool.py::health_check` |
| Daily counter resets at UTC midnight | `backend/accounts.py::reset_daily_counter_if_stale` |
| Per-account SOCKS5 proxy with `rdns=True` (no DNS leak) | `backend/client_pool.py::build_proxy_tuple` |

## API reference

All endpoints at `http://localhost:8000` (or your deployed Fly URL). See inline FastAPI docstrings + OpenAPI at `/docs` on the running server.

**Groups** (Phase 0)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/groups` | Add group |
| GET | `/api/groups` | List groups |
| DELETE | `/api/groups/{id}` | Remove group |
| POST | `/api/groups/{id}/scrape` | Scrape member list |
| POST | `/api/groups/{id}/scrape-messages` | Scrape from messages |
| POST | `/api/groups/{id}/monitor/start` | Start background monitor |
| POST | `/api/groups/{id}/monitor/stop` | Stop monitor |
| GET | `/api/monitoring` | Status of all monitors |
| GET | `/api/sheets/stats` | Row counts per group |
| GET | `/api/sheets/{group_name}/members` | Fetch members of a group |

**Accounts** (Phase 1)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/accounts` | List all accounts |
| GET | `/api/accounts/{id}` | Single account |
| PATCH | `/api/accounts/{id}` | Update label |
| DELETE | `/api/accounts/{id}` | Remove + delete session file |
| POST | `/api/accounts/{id}/pause` | Pause (stop worker + flag) |
| POST | `/api/accounts/{id}/resume` | Resume |
| POST | `/api/accounts/{id}/health-check` | Liveness probe |
| POST | `/api/accounts/health-check-all` | All accounts |

**Signup** (Phase 1 web wizard)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/accounts/signup/start` | Step 1: request SMS code |
| POST | `/api/accounts/signup/verify` | Step 2: submit code |
| POST | `/api/accounts/signup/password` | Step 3: submit 2FA if needed |
| DELETE | `/api/accounts/signup/{token}` | Abandon |

**Sender** (Phase 1)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/sender/enqueue` | Queue DMs for one account |
| POST | `/api/sender/distribute` | Round-robin across accounts |
| GET | `/api/sender/queue` | Snapshot |
| DELETE | `/api/sender/queue/{id}` | Clear one account's queue |
| DELETE | `/api/sender/queue` | Clear all |
| GET | `/api/sender/sent-log` | Tail of send audit log |
| POST | `/api/sender/workers/{id}/start` | Start worker |
| POST | `/api/sender/workers/{id}/stop` | Stop worker |
| POST | `/api/sender/workers/start-all` | Bulk start |
| POST | `/api/sender/workers/stop-all` | Bulk stop |
| GET | `/api/sender/workers` | All worker states |

**Warm-up** (Phase 1)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/warmup/groups` | List warm-up group URLs |
| PUT | `/api/warmup/groups` | Replace list |
| POST | `/api/warmup/run/{id}` | Run warm-up for one account |
| POST | `/api/warmup/run-all` | Run for all |

**Campaigns**
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/campaigns/enqueue-from-sheet` | Pull members from Sheet + distribute |

## Development

Backend tests: none formal yet; run `python -c "import main"` from `backend/` to smoke-test imports.

Frontend typecheck + build:
```bash
cd frontend
npx tsc --noEmit
npm run build
```

## Internationalisation

Add a new locale:
1. In [frontend/src/lib/i18n/messages.ts](frontend/src/lib/i18n/messages.ts):
   - Extend the `LOCALES` tuple (e.g. `["en", "pt", "es", "fr"]`).
   - Add `fr: "Français"` to `LOCALE_NAMES` and an emoji to `LOCALE_FLAGS`.
   - Add a full `const fr: Dict = { ... }` object with every key from `en`.
   - Register it in `messages`: `export const messages = { en, pt, es, fr };`
2. Rebuild — the `LanguageToggle` picks it up automatically.

## Troubleshooting

**"Method Not Allowed" on PATCH after code changes**
Restart the Python backend. FastAPI registers routes at startup.

**Backend shows offline in dashboard**
Python backend isn't running or `NEXT_PUBLIC_API_URL` is wrong. Verify with `curl http://localhost:8000/api/health`.

**"The key is not registered" / `AuthKeyUnregisteredError`**
Delete `backend/session.session` and restart. Re-enter the SMS code.

**Google OAuth 403 `org_internal`**
OAuth consent screen is set to "Internal" but you're using a personal Gmail. Change to "External" in Google Cloud Console + add your Gmail as a test user. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#troubleshooting).

**Signup SMS code never arrives**
Your API app is likely flagged by Telegram (too many failed signups). Create a fresh `api_id`/`api_hash` at https://my.telegram.org, paste into the wizard's **Advanced** section. See the docs.

**Cloudflare Tunnel URL changed after restart**
Quick tunnels get random subdomains. For a stable URL, use a named Cloudflare tunnel tied to a free Cloudflare account.

**All accounts paused / banned simultaneously**
Usually means a shared issue (proxy provider outage, Telegram datacenter blip, or API app flag). Run `POST /api/accounts/health-check-all` and check `flyctl logs` (if deployed) or the local Python terminal.

## Licence

Private project. All rights reserved.
