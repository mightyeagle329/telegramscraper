# Outpilot

**Personal Telegram outreach, on autopilot.** Scrape group members, warm
up multiple sender accounts, run A/B-tested DM campaigns with
GPT-personalised openers, detect replies in real time, auto-respond with
a group invite, and track funnel conversions — all from one dashboard,
behind safety rails that keep accounts unbanned.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Next.js 16 dashboard                                                    │
│  Landing · Auth · Overview · Groups · Contacts · Accounts · Templates    │
│  Campaigns · Analytics · Bot · Settings · Dark/Light · EN/PT/ES          │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ REST + Supabase Auth cookies
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Python FastAPI worker                                                   │
│  Scraper · Signup wizard · Safe sender · Warm-up · Error handler         │
│  Reply watcher · Auto-responder · Group tracker · Campaign runs          │
│  Engagement bot (Telegram Bot API) · AI engagement writer                │
│  Health checks · Per-account Telethon client pool w/ SOCKS5 proxies      │
└────────────┬─────────────────────────────────────────┬───────────────────┘
             │                                         │
             ▼                                         ▼
   ┌──────────────────┐                       ┌─────────────────────────┐
   │  Supabase        │                       │  Google Sheets          │
   │  Postgres + RLS  │                       │  Scraped contacts       │
   │  Auth            │                       │  Engagement bot queue   │
   └──────────────────┘                       └─────────────────────────┘
                                                          │
                                                          ▼
                                              ┌─────────────────────────┐
                                              │  OpenAI                 │
                                              │  Opener generation      │
                                              │  Engagement content     │
                                              │  Reply drafting         │
                                              └─────────────────────────┘
```

---

## Features by phase

### Phase 0 — Data collection
- Scrape full member lists from supergroups
- Scrape unique senders from message history (works on broadcast channels too — auto-detects linked discussion groups)
- Auto-export to Google Sheets with deduplication
- Background monitor for new members (per-group, resumable)

### Phase 1 — Multi-account sender
- Up to 10 Telegram accounts managed from one dashboard
- Per-account residential or mobile proxy (SOCKS5 / SOCKS4 / HTTP)
- Web-based SMS signup wizard (3-step: phone+proxy → code → optional 2FA)
- Anti-share-code proxy routing during signup (avoids country-mismatch login refusals)
- 7-day warm-up: each account joins groups, reads messages, reacts — no DMs
- Daily DM ladder: 0 → 3 → 5 → 10 → 15 → 20 → 30 → 40 → 50 over ~21 days
- Safe sender: random 45–180s delays, unique invisible suffix per message, weighted template rotation
- Optional send-delete (deletes our copy N seconds after sending)
- Per-account health checks every 30 min
- Queue persisted across restarts
- **Silent flood recovery**: PeerFlood/long FloodWait events trigger a 48h cooldown the worker observes internally, then a 7-day reduced-rate window (50% daily limit, 120–300s delays) — all without changing the account's visible status

### Phase 2 — Intelligence & observability
- **Live reply detection** on every account; replies appear in the dashboard within seconds and auto-cancel pending follow-ups
- **Templates library** in Postgres (Supabase) — shared across campaigns; inline-typed copy promotes to library with one click
- **A/B testing framework** — multiple "arms" per campaign with independent copy + follow-up cadence; per-arm reply rate + join rate tracked
- **AI-personalised openers** — any arm can flip from static templates to GPT-generated openers (~$0.0001 per message); two-stage generation option (draft 3 → critic picks best) for premium campaigns
- **AI follow-up nudges** — same mechanism for the second-touch message
- **Output validation** — every AI opener regex-screened (no URLs, no urgency, no scam-flavoured guarantees, no placeholder leaks); failures regenerate with a graceful fallback
- **Performance dashboard** at `/analytics` — totals, daily-volume chart, per-account performance, per-campaign A/B winners, skip-reason histogram (7 / 14 / 30 day windows)
- **Global de-duplication** — every successfully DM'd recipient is recorded; future campaigns skip them by default
- **Smart pre-filters** — `require_username`, `filter_bots`, `dedupe_already_contacted` all default ON

### Phase 3 — Funnel & engagement
- **Group-join tracker** — auto-monitors one or more "owned" destination groups (e.g. your community); detects new joiners every 30 min and attributes each one to the campaign + arm that DM'd them
- **Funnel analytics** — `/analytics` shows **join rate** as the headline KPI alongside reply rate; per-campaign tables surface both reply and join winners
- **Source-group scorecards** — every scraped source group gets a T1/T2/T3 tier from reachable-% + join-rate so you can drop bot-farms and double down on real audiences
- **Engagement bot** — `@OutpilotBot` (Telegram Bot API) reads a Google Sheet on a 5-min schedule and publishes wins / game announcements / engagement posts into the destination group
- **AI engagement writer** — GPT auto-generates a daily batch of posts (wins, polls, questions, game announcements) calibrated to your brand voice; each post lands as `pending_review` for VA approval before publishing
- **VA workflow** — `/bot` page with **Compose** (single post), **Bulk import wins** (paste many, auto-spread across active hours), **Pending review** (approve / edit / reject AI batches), **Scheduled queue** (edit/delete inline), and **Posted history**
- **Auto-respond to first reply** — when a recipient replies to a cold DM, the system fires ONE GPT-drafted response that pivots to the destination group invite; fires once per recipient, with 30–90s human-like delay, sentiment classification (skips negative replies), validation layer, and template fallback if OpenAI fails
- **Backfill mode** — one-click catch-up for replies that landed before auto-respond was deployed; staggers sends 90–180s per account so no account bursts
- **Background campaign runs** — large AI campaigns (200+ targets) return a `run_id` immediately and process in 50-target chunks so Cloudflare's 100s edge timeout never trips; sender workers start firing within 30s of launch while later chunks are still being generated
- **In-flight runs panel** — live progress on `/campaigns` for any background run, ticks every 5 seconds

### Polish
- **Outpilot brand** — logo + favicon, redesigned landing page (feature grid + how-it-works + what-you'll-need), auth pages with the logo
- **Tri-lingual** — every customer-facing string in EN / PT / ES, language toggle in the header
- **Theme** — dark / light / system, with shared accent tokens across both modes
- **Mobile responsive** — every dashboard page reflows for narrow screens
- **Pagination** — replies and recent-sends panels grow with "Load 10 more" buttons that survive auto-refresh

---

## Stack

- **Frontend**: Next.js 16 (App Router, Turbopack) + React 19 + Tailwind 4 + TypeScript
- **Backend**: Python 3.12 + FastAPI + Telethon (user accounts) + python-telegram-bot (engagement bot) + APScheduler
- **AI**: OpenAI (`gpt-4o-mini` default, `gpt-4o` per-arm override available)
- **Database**: Supabase (Postgres + RLS + Auth)
- **Contacts + bot content**: Google Sheets (one sheet, separate tabs per group + a `BotPosts` tab for engagement queue)
- **Proxies**: IPRoyal residential sticky sessions, mobile proxies (fxdx.in and compatible)
- **Deployment**: Vercel (frontend) + Fly.io (backend + persistent volume) + Supabase (DB+Auth)

---

## Quick start (local, no Supabase, no cloud)

Two terminals. Everything runs on your machine.

### Terminal 1 — Python backend

```bash
cd backend
python -m venv venv
source venv/bin/activate         # Linux/Mac
pip install -r requirements.txt

cp .env.example .env             # then edit with your Telegram + OpenAI creds
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
# Leave .env.local empty for local-dev mode (no auth)
npm run dev
```

Open `http://localhost:3000` — redirects straight to `/dashboard`. A yellow **local dev** badge appears in the nav.

See [docs/RUN-LOCALLY.md](docs/RUN-LOCALLY.md) for troubleshooting.

---

## Full setup (Supabase + Vercel + Fly.io)

Walkthrough: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md), and [docs/PHASE-3-TESTING.md](docs/PHASE-3-TESTING.md) for the VA workflow + Phase 3 features.

Short version:
1. **Supabase**: create a project, run both SQL files in `supabase/migrations/` in the SQL editor.
2. **Env vars**: put Supabase URL + keys in `frontend/.env.local`; backend secrets in `backend/.env`.
3. **Fly.io**: `fly launch` in the repo root (the `fly.toml` template is ready); set secrets via `fly secrets set ...`.
4. **Vercel**: deploy `frontend/`; set `NEXT_PUBLIC_API_URL` to the Fly URL; set the Supabase env vars.
5. **Engagement bot**: register a bot via `@BotFather`, add it to your destination group as admin with "post messages" permission, paste the token + chat_id into `backend/.env`.

---

## Prerequisites

- **Python 3.10+** (3.12 recommended)
- **Node.js 18+** (for Next.js 16)
- **Telegram account** with API credentials from https://my.telegram.org
- **Google Cloud project** with OAuth client credentials (for Sheets)
- **Google Sheet** the account can access
- **OpenAI API key** — required for AI openers + auto-respond + engagement writer
- *(Optional)* **Supabase project** for auth + multi-tenant
- **Residential or mobile proxies** — IPRoyal ~$20–30/mo covers 10 accounts
- **Phone numbers** for sender accounts — physical SIMs recommended for 2–3 anchors, virtual from 5sim for the rest
- *(Phase 3)* **One Telegram bot** registered via `@BotFather`, added to your destination group as admin

---

## Project structure

```
telegram_bot/
├── backend/                            Python FastAPI worker
│   ├── main.py                         API routes + lifespan + scheduled jobs
│   ├── scraper.py                      Phase 0 Telethon scraping
│   ├── sheets.py                       Google Sheets export
│   ├── monitor.py                      APScheduler background monitor
│   ├── storage.py                      JSON persistence for groups
│   ├── accounts.py                     Account registry + warm-up + flood recovery
│   ├── client_pool.py                  Per-account Telethon clients with proxies
│   ├── sender.py                       Safe sender: queue, delays, templating
│   ├── warmup.py                       Warm-up worker (joins, reads, reactions)
│   ├── error_handler.py                Classifies FloodWait / PeerFlood / Banned
│   ├── signup.py                       Web-based SMS signup flow
│   ├── add_account.py                  CLI signup (alternative to web wizard)
│   ├── target_filter.py                Bot/admin pattern filter
│   ├── reply_watcher.py                Phase 2A live reply detection
│   ├── reply_responder.py              Phase 3 auto-respond with group invite
│   ├── ai_openers.py                   Phase 2C personalised opener generation
│   ├── ai_engagement_writer.py         Phase 3 AI-drafted bot post batches
│   ├── engagement_bot.py               Phase 3 Telegram Bot API + Sheet pipeline
│   ├── group_tracker.py                Phase 3 funnel destination monitor
│   ├── scorecards.py                   Phase 3 source-group tiering (T1/T2/T3)
│   ├── analytics.py                    /analytics endpoint aggregator
│   ├── campaign_runs.py                Background chunked campaign processor
│   ├── models.py                       Pydantic request/response models
│   ├── config.py                       Environment variables
│   ├── requirements.txt
│   ├── Dockerfile                      Fly.io deployment image
│   ├── .env.example
│   └── (auto-generated runtime files — all gitignored:)
│       ├── session.session             scraper account Telethon session
│       ├── sessions/                   Phase 1 sender sessions per account
│       ├── accounts.json               account registry + warm-up state
│       ├── queue.json                  pending DMs per account
│       ├── sent_log.json               audit log of every send attempt
│       ├── replies.json                inbound replies audit log
│       ├── contacted.json              global dedup set (every user we've DM'd)
│       ├── tracked_groups.json         Phase 3 funnel destinations
│       ├── joins.json                  Phase 3 join events
│       ├── auto_responses.json         Phase 3 auto-reply audit log
│       ├── bot_history.json            Phase 3 engagement-bot post audit log
│       ├── campaign_runs.json          Background run status
│       ├── engagement_writer_config.json  AI writer config (toggle + mix + voice)
│       ├── groups.json                 scraped source groups
│       └── warmup_groups.json          warm-up group list
│
├── frontend/                           Next.js 16 dashboard
│   └── src/
│       ├── app/
│       │   ├── (landing)/              Public marketing page
│       │   ├── (auth)/                 Login, signup, callback
│       │   ├── (dashboard)/            Protected pages
│       │   │   ├── dashboard/          Overview + replies + auto-responses
│       │   │   ├── groups/             Phase 0 scraper
│       │   │   ├── contacts/           Scraped users table
│       │   │   ├── accounts/           Sender fleet + signup wizard
│       │   │   ├── templates/          Message templates CRUD (Supabase)
│       │   │   ├── campaigns/          Launch + A/B + in-flight runs
│       │   │   ├── analytics/          Funnel + per-account + per-campaign + scorecards
│       │   │   ├── bot/                Engagement bot (Compose / Bulk / Pending / Queue)
│       │   │   └── settings/           Profile + sending defaults
│       │   └── globals.css             Light/dark theme tokens
│       ├── components/                 Shared UI (Logo, NavBar, ThemeToggle,
│       │                               ArmsEditor, TemplatePicker, WorkerHealthBanner, ...)
│       ├── lib/
│       │   ├── api.ts                  Typed API client
│       │   ├── supabase/               Auth clients + proxy.ts
│       │   ├── actions/                Server actions (templates, settings)
│       │   └── i18n/                   Messages (en/pt/es) + LocaleProvider
│       └── types/
│           └── database.ts             TypeScript mirror of the Supabase schema
│
├── supabase/
│   └── migrations/
│       ├── 00001_initial_schema.sql    10 tables + RLS policies + triggers
│       └── 00002_user_settings.sql     Per-user sending preferences
│
├── docs/
│   ├── DEPLOYMENT.md                   Vercel + Fly.io + Supabase step-by-step
│   ├── SETUP-SUPABASE.md               Supabase provisioning walkthrough
│   ├── RUN-LOCALLY.md                  Local-only dev
│   ├── PHASE-3-TESTING.md              VA workflow + Phase 3 features
│   └── OUTPILOT-PHASE-2.md             Client-facing delivery document
│
├── images/                             (gitignored) — screenshots staging area
├── fly.toml                            Fly.io app config (persistent volume)
├── .gitignore
└── README.md                           This file
```

---

## Configuration

### Backend `.env`

```env
# === Telegram (scraper + default for new sender accounts) ===
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=abcdef0123456789abcdef0123456789
TELEGRAM_PHONE=+1234567890

# === Scraper proxy (recommended) — country-matched SOCKS5 ===
SCRAPER_PROXY_TYPE=socks5
SCRAPER_PROXY_HOST=geo.iproyal.com
SCRAPER_PROXY_PORT=12321
SCRAPER_PROXY_USERNAME=...
SCRAPER_PROXY_PASSWORD=..._country-pt_session-XXX_lifetime-24h

# === Google Sheets ===
GOOGLE_SHEET_URL=https://docs.google.com/spreadsheets/d/your_sheet_id/edit
GOOGLE_CREDENTIALS_FILE=credentials.json

# === OpenAI (required for AI openers, auto-respond, engagement writer) ===
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# === Phase 3 — Engagement bot ===
ENGAGEMENT_BOT_TOKEN=8664877079:AAH...                  # @BotFather
ENGAGEMENT_BOT_CHAT_ID=-1001234567890                   # destination group
ENGAGEMENT_BOT_SHEET_ID=                                # blank = reuse main sheet
ENGAGEMENT_BOT_SHEET_TAB=BotPosts

# === Phase 3 — Auto-respond on first reply ===
AUTO_REPLY_ENABLED=true
AUTO_REPLY_GROUP_URL=https://t.me/titantreasurecasino
AUTO_REPLY_STYLE=Casual, friendly, brief. Acknowledge their reply, invite them to the group.
AUTO_REPLY_FALLBACK=Thanks for replying! We run a community group — feel free to drop in: {url}

# === Misc ===
MONITOR_INTERVAL=300
FRONTEND_URL=http://localhost:3000
```

### Frontend `.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:8000

# Leave blank for local-dev mode; fill in for production
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## How to use

### 1. Scrape a source group

1. Open `/groups` → paste a Telegram URL → **+ Add**.
2. Click **Scrape Members** (supergroups) or **Scrape Messages** (broadcast channels).
3. Optionally click **Monitor** for auto-refresh every 5 min.

Results land in your Google Sheet — one tab per group.

### 2. Onboard sender accounts

`/accounts` → **+ Add account** → phone + proxy → SMS code → optional 2FA. Status starts at `warming`; worker auto-starts.

### 3. Track your destination group

`/analytics` → **Tracked groups** panel → paste `https://t.me/yourgroup` → **Track this group**. Outpilot snapshots current members as the baseline and starts polling every 30 min for new joiners.

### 4. Launch a campaign

1. `/campaigns` → pick the source sheet + sender accounts.
2. Define one or two **arms** (A/B). Each arm picks **Templates** (static rotation) or **AI** (per-target opener). Set the follow-up cadence + AI style for the nudge.
3. Optional: pick `gpt-4o` for premium quality, toggle two-stage generation, set a target limit.
4. **Launch.** Small campaigns enqueue inline; large AI campaigns return a `run_id` and process in background chunks — the In-flight runs panel shows live progress.

The system:
- Distributes targets round-robin across (account × arm)
- Filters bots, no-username targets, already-contacted users
- Pre-generates AI openers (and AI follow-ups if configured)
- Streams the work to sender workers chunk-by-chunk so DMs start within ~30s

### 5. Let the funnel close itself

When a recipient replies:
- **Reply detection** records it within seconds (visible on `/dashboard`)
- **Pending follow-ups cancelled** automatically (no double-nudging)
- **Auto-respond fires** after a 30–90s human-like delay — GPT drafts a casual response that pivots to the group invite, sends from the same account that received the reply, marks the recipient as auto-handled (one-shot per user; subsequent messages stay manual)

When a recipient joins your destination group:
- **Group tracker** detects them within 30 min
- **Cross-references** with sent_log to attribute the join to the campaign + arm + account that DM'd them
- `/analytics` join rate climbs

### 6. Keep the group active

Your VA opens `/bot`:
- **Bulk import wins** — paste the day's wins, click Import, the bot publishes them across active hours
- **Compose** — single post for hot wins or announcements
- **Pending review** — approve / edit / reject AI-generated batches
- **Scheduled queue + Posted** — full visibility, inline edit/delete

The engagement bot (`@OutpilotBot`) publishes on a 5-min cycle; the AI writer auto-fills the queue every 12 hours if enabled.

---

## Safety details (under the hood)

| Safety | Source |
|---|---|
| Warm-up ladder: days 1–7 zero, 3 → 50 over days 8–22 | `backend/accounts.py::WARMUP_LADDER` |
| Random delay between sends: uniform 45–180s | `backend/accounts.py::effective_delay_range_s` |
| Unique message per send: 1–3 zero-width chars appended | `backend/sender.py::_invisible_suffix` |
| Weighted template rotation | `backend/sender.py::_pick_message` |
| Silent 48h cool-down after `PeerFloodError` (no status flip) | `backend/sender.py::_atomic_mark_error` |
| Long `FloodWaitError` pauses account for the exact wait | `backend/error_handler.py::classify` |
| Flood-recovery 7-day half-rate window after cooldown | `backend/accounts.py::start_flood_recovery` |
| Slower delays during recovery: 120–300s | `backend/accounts.py::effective_delay_range_s` |
| Terminal-ban detection | `backend/client_pool.py::health_check` |
| Daily counter resets at UTC midnight | `backend/accounts.py::reset_daily_counter_if_stale` |
| Per-account SOCKS5 proxy with `rdns=True` (no DNS leak) | `backend/client_pool.py::build_proxy_tuple` |
| AI opener output validation (regex blocklist + retry) | `backend/ai_openers.py::BLOCKLIST_PATTERNS` |
| AI auto-respond: skip negative sentiment + sentiment classification | `backend/reply_responder.py::_draft_response` |
| Auto-respond 30–90s human-like delay | `backend/reply_responder.py::DELAY_RANGE_S` |
| Global de-dup set (every successfully DM'd user) | `backend/sender.py::record_contacted` |
| Bot/admin/official-account filter | `backend/target_filter.py::is_likely_non_user` |
| Background campaign chunking (50 targets at a time) | `backend/campaign_runs.py::run_chunked_distribute` |

---

## API reference

All endpoints at `http://localhost:8000` (or your deployed Fly URL). Full OpenAPI spec at `/docs` on the running server.

### Groups (Phase 0)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/groups` | Add source group |
| GET | `/api/groups` | List source groups |
| DELETE | `/api/groups/{id}` | Remove |
| POST | `/api/groups/{id}/scrape` | Scrape member list |
| POST | `/api/groups/{id}/scrape-messages` | Scrape from messages |
| POST | `/api/groups/{id}/monitor/start` | Start background monitor |
| POST | `/api/groups/{id}/monitor/stop` | Stop monitor |
| GET | `/api/groups/scorecards` | Phase 3 T1/T2/T3 tiering |
| GET | `/api/sheets/stats` | Row counts per group |

### Accounts (Phase 1)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/accounts` | List all |
| PATCH | `/api/accounts/{id}` | Update label |
| DELETE | `/api/accounts/{id}` | Remove + delete session |
| POST | `/api/accounts/{id}/pause` | Manual pause |
| POST | `/api/accounts/{id}/resume` | Resume |
| POST | `/api/accounts/{id}/health-check` | Liveness probe |
| POST | `/api/accounts/health-check-all` | All accounts |
| POST | `/api/accounts/signup/start` | Step 1: request SMS code |
| POST | `/api/accounts/signup/verify` | Step 2: submit code |
| POST | `/api/accounts/signup/password` | Step 3: submit 2FA if needed |

### Sender (Phase 1)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sender/queue` | Queue snapshot |
| DELETE | `/api/sender/queue` | Clear all |
| GET | `/api/sender/sent-log` | Audit log tail |
| GET | `/api/sender/workers` | Worker states (running / resting / stopped) |
| POST | `/api/sender/workers/start-all` | Bulk start |

### Campaigns
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/campaigns/enqueue-from-sheet` | Launch — returns inline or `run_id` if backgrounded |
| GET | `/api/campaigns/runs` | Recent background runs |
| GET | `/api/campaigns/runs/{id}` | Single run status |
| GET | `/api/campaigns/{name}/stats` | Per-arm reply + join rate |
| GET | `/api/campaigns/ai/status` | Whether OpenAI is configured |

### Replies & funnel (Phase 2A + 3)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/replies` | Recent inbound replies |
| GET | `/api/auto-responses` | Recent auto-responses we sent |
| GET | `/api/auto-responses/config` | Auto-respond config (toggle + URL) |
| POST | `/api/auto-responses/backfill` | Catch up on past replies (default 7-day lookback) |
| GET | `/api/tracked-groups` | Funnel destinations under tracking |
| POST | `/api/tracked-groups` | Add a destination |
| POST | `/api/tracked-groups/{id}/poll` | Force a poll cycle |
| GET | `/api/joins` | Recent attributed join events |

### Engagement bot (Phase 3)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/bot/status` | Bot connectivity + sheet status |
| GET | `/api/bot/queue` | Full sheet contents (queued / posted) |
| GET | `/api/bot/history` | Local audit of published posts |
| POST | `/api/bot/post` | Add one post |
| POST | `/api/bot/posts/bulk` | Bulk-import + spread across days |
| PATCH | `/api/bot/post/{row}` | Edit |
| DELETE | `/api/bot/post/{row}` | Delete |
| POST | `/api/bot/post/{row}/approve` | Approve pending-review |
| POST | `/api/bot/post-now/{row}` | Force-publish |
| POST | `/api/bot/run-cycle` | Trigger one publish cycle now |
| GET | `/api/bot/writer/config` | AI writer config |
| PUT | `/api/bot/writer/config` | Update AI writer config |
| POST | `/api/bot/writer/preview` | Generate a sample batch (no sheet write) |
| POST | `/api/bot/writer/run-now` | Generate + append now |

### Analytics
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/analytics/summary?days=14` | One-shot performance roll-up: totals + daily volume + per-account + per-campaign A/B winners + skip reasons |

### Warm-up
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/warmup/groups` | List warm-up group URLs |
| PUT | `/api/warmup/groups` | Replace list |
| POST | `/api/warmup/run-all` | Run for all accounts |

---

## Development

Backend smoke test:
```bash
cd backend && source venv/bin/activate
python -c "import main; print('imports OK')"
```

Frontend typecheck + build:
```bash
cd frontend
npx tsc --noEmit
npm run build
```

---

## Internationalisation

Add a new locale:
1. In [frontend/src/lib/i18n/messages.ts](frontend/src/lib/i18n/messages.ts):
   - Extend the `LOCALES` tuple (e.g. `["en", "pt", "es", "fr"]`).
   - Add `fr: "Français"` to `LOCALE_NAMES` and an emoji to `LOCALE_FLAGS`.
   - Add a full `const fr: Dict = { ... }` object with every key from `en`.
   - Register it: `export const messages = { en, pt, es, fr };`
2. Rebuild — the `LanguageToggle` picks it up automatically.

---

## Troubleshooting

**Method Not Allowed after code changes**
Restart the Python backend — FastAPI registers routes at startup.

**Backend shows offline in dashboard**
Backend isn't running or `NEXT_PUBLIC_API_URL` is wrong. Verify with `curl http://localhost:8000/api/health`.

**"The key is not registered" / `AuthKeyUnregisteredError`**
Delete `backend/session.session` and restart. Re-enter the SMS code.

**Google OAuth 403 `org_internal`**
OAuth consent screen is set to "Internal" but you're using a personal Gmail. Change to "External" in Google Cloud Console + add your Gmail as a test user.

**Signup SMS code never arrives**
Your API app is likely flagged by Telegram. Create a fresh `api_id`/`api_hash` at https://my.telegram.org.

**OpenAI 429 / insufficient_quota**
Add credit to the OpenAI key at https://platform.openai.com → Billing.

**Campaign returns 524 Bad Gateway**
Solved automatically — large AI campaigns now run in the background (returns `run_id`). If you still see 524, the running backend is stale; restart it.

**Cloudflare Tunnel URL changed after restart**
Quick tunnels rotate. For a stable URL, use a named Cloudflare tunnel tied to a free account, or deploy backend to Fly.io.

**Accounts show as "resting" on the workers column**
That's the internal cooldown after a PeerFlood event. Auto-resumes on its own (≤48h); no action needed.

**Engagement bot "not configured"**
Set `ENGAGEMENT_BOT_TOKEN` + `ENGAGEMENT_BOT_CHAT_ID` in `backend/.env`, restart, and make sure the bot is an admin in the destination group with "post messages" permission.

---

## Licence

Private project. All rights reserved.
