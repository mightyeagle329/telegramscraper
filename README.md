# Telegram Group Member Scraper

A tool to extract member data from Telegram groups and channels, export it to Google Sheets, and monitor for new users automatically. Includes a web dashboard for easy management.

## Features

- **Two scraping modes:**
  - **Scrape Members** — Extracts the full member list from supergroups
  - **Scrape Messages** — Extracts unique users from message history (works around Telegram's broadcast channel restrictions, auto-detects linked discussion groups)
- **Auto-export to Google Sheets** — One worksheet per group, plus a Dashboard summary tab
- **Deduplication** — Existing members are never re-exported; only new users are appended
- **New user monitoring** — Automatic periodic scans with new users marked as "NEW" in the sheet
- **Mode-aware monitoring** — Uses whichever scrape mode you last clicked for each group
- **Persistent state** — Groups and monitoring settings survive backend restarts
- **Resume monitoring on restart** — Monitors auto-restart when the backend comes back up
- **Web dashboard** — Dark-themed Next.js UI to manage everything
- **Rate-limit handling** — Automatic retries on Telegram `FloodWaitError`
- **Supports invite links** — `t.me/+...`, `t.me/joinchat/...`, `tg://join?invite=...`, and public URLs

## Architecture

```
telegram_bot/
├── backend/                  # Python FastAPI server
│   ├── main.py               # API endpoints + lifespan startup
│   ├── scraper.py            # Telethon scraping (members & messages)
│   ├── sheets.py             # Google Sheets export (OAuth2)
│   ├── monitor.py            # APScheduler background monitoring
│   ├── storage.py            # JSON persistence for groups
│   ├── models.py             # Pydantic request/response models
│   ├── config.py             # Environment variables
│   ├── requirements.txt
│   ├── .env.example
│   ├── credentials.json      # Google OAuth client (you provide)
│   ├── token.json            # Auto-generated after Google login
│   ├── session.session       # Auto-generated after Telegram login
│   └── groups.json           # Auto-generated persistent state
├── frontend/                 # Next.js 16 dashboard (React 19 + Tailwind)
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx      # Main dashboard
│       │   └── globals.css
│       ├── components/
│       │   ├── AddGroup.tsx         # Add group form
│       │   ├── GroupTable.tsx       # Groups list with scrape/monitor buttons
│       │   ├── MonitoringPanel.tsx  # Active monitor summary
│       │   └── StatusBar.tsx        # Backend connection indicator
│       └── lib/
│           ├── api.ts        # API client
│           └── types.ts      # TypeScript types
├── .gitignore
└── README.md
```

## Prerequisites

- **Python 3.10+** (3.12 recommended; 3.13 may have wheel issues on Windows)
- **Node.js 18+**
- A **Telegram account** with API credentials from https://my.telegram.org
- A **Google Cloud project** with OAuth client credentials
- A **Google Sheet** the account can access

## Setup

### Step 1: Telegram API Credentials

1. Go to https://my.telegram.org and log in
2. Click **"API development tools"**
3. Create an app (App title: anything, Short name: anything, Platform: Desktop, URL: leave blank)
4. Copy the **API ID** (a number) and **API Hash** (a hex string)

The Telegram account used must be a member of every group you want to scrape.

### Step 2: Google OAuth Credentials

This project uses OAuth2 (personal Google login), not a service account, to work around organizations that block service account key creation.

1. Go to https://console.cloud.google.com
2. Create a new project
3. **Enable APIs** (APIs & Services > Library):
   - Enable **Google Sheets API**
   - Enable **Google Drive API**
4. **Configure OAuth consent screen** (APIs & Services > OAuth consent screen):
   - Audience: **Internal** (or **External** if Internal is unavailable)
   - Fill in app name and support email, leave the rest as defaults
5. **Create OAuth Client** (APIs & Services > Credentials > + Create Credentials > OAuth client ID):
   - Application type: **Desktop app**
   - Name: anything
   - Click **Create**, then **Download JSON**
6. Save the downloaded file as `backend/credentials.json`

### Step 3: Backend

```bash
cd backend

# Create a virtual environment
python -m venv venv

# Activate it
source venv/bin/activate        # Linux/Mac
venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Create .env from the template
cp .env.example .env
```

Edit `backend/.env` with your values:

```env
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=abcdef0123456789abcdef0123456789
TELEGRAM_PHONE=+1234567890
GOOGLE_SHEET_URL=https://docs.google.com/spreadsheets/d/your_sheet_id/edit
GOOGLE_CREDENTIALS_FILE=credentials.json
MONITOR_INTERVAL=300
FRONTEND_URL=http://localhost:3000
```

Start the server:

```bash
python main.py
```

**First run only — two one-time steps:**

1. **Google login**: A browser window opens automatically. Sign in with the Google account that has access to your sheet and click **Allow**. This creates `token.json`.
2. **Telegram login**: The terminal prompts for a verification code. Telegram sends this code to the app of the phone number in `.env`. Enter the code in the terminal. This creates `session.session`.

Both are saved and will **not** be required on subsequent runs.

The backend runs on **http://localhost:8000**.

### Step 4: Frontend

```bash
cd frontend

# Install dependencies
npm install

# (Optional) custom backend URL
cp .env.local.example .env.local

# Start the dev server
npm run dev
```

The dashboard runs on **http://localhost:3000**.

## Usage

### Adding a group

1. Open http://localhost:3000
2. Paste a Telegram group URL into **"Add New Group"** and click **+ Add**
   - Public: `https://t.me/Richsweeps` or `@Richsweeps`
   - Invite link: `https://t.me/+XFGgPSo0m-Q0ZDZh` or `tg://join?invite=XFGgPSo0m-Q0ZDZh`
3. The group appears in the **Tracked Groups** table

### Scraping members

Two buttons are available for each group:

- **Scrape Members** (purple) — Gets the full member list. Works for **supergroups**. For broadcast channels, Telegram only exposes admins unless your account is an admin.
- **Scrape Messages** (blue) — Scans the last 5000 messages and extracts users who posted. Use this for **broadcast channels** where the member list is restricted. If the channel has a linked discussion group, it automatically scrapes that instead.

Both modes save to the same Google Sheet with identical columns. The "Scrape Messages" mode only saves **user data**, not message content.

### Monitoring for new users

1. Click **Scrape Members** or **Scrape Messages** at least once — this tells the monitor which mode to use
2. Click **Monitor** to start a background job that checks every 5 minutes
3. New users found are appended to the sheet and marked `NEW` in the last column
4. Click **Stop** to pause monitoring

The chosen mode is persisted, so monitoring uses the same method after a backend restart.

### Removing a group

Click the trash icon next to a group. This stops monitoring and removes the group from tracking. **Data already in Google Sheets is NOT deleted** — it stays for reference.

## Google Sheet Layout

Each group gets its own worksheet tab. A **Dashboard** summary tab is auto-created as the first tab:

### Dashboard Tab

| Group Name | Group URL | Total Members | New Members | Last Scraped | Status |
|------------|-----------|---------------|-------------|--------------|--------|
| Richsweeps | https://t.me/Richsweeps | 6664 | 12 | 2026-04-09 14:30 | Monitoring |
| Crypto Chat | https://t.me/+abc... | 800 | 0 | 2026-04-09 14:25 | Scraped |

### Per-Group Tabs

| User ID | Username | First Name | Last Name | Phone | Group | Scraped At | Is New |
|---------|----------|------------|-----------|-------|-------|------------|--------|
| 123456789 | johndoe | John | Doe | | Richsweeps | 2026-04-09T14:30:00 | NEW |

Phone numbers only appear if the user has made them publicly visible.

## API Reference

All endpoints are at `http://localhost:8000`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/groups` | Add group (body: `{"url": "..."}`) |
| GET | `/api/groups` | List all tracked groups |
| DELETE | `/api/groups/{id}` | Remove a group from tracking |
| POST | `/api/groups/{id}/scrape` | Scrape member list now |
| POST | `/api/groups/{id}/scrape-messages?message_limit=5000` | Scrape users from messages now |
| POST | `/api/groups/{id}/monitor/start?interval=300` | Start monitoring (uses last scrape mode) |
| POST | `/api/groups/{id}/monitor/stop` | Stop monitoring |
| GET | `/api/groups/{id}/monitor` | Get monitor status for a group |
| GET | `/api/monitoring` | Get all monitor statuses |
| GET | `/api/sheets/stats` | Row counts per worksheet |
| GET | `/api/sheets/{group_name}/members` | Fetch members from a specific sheet |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_API_ID` | Yes | From my.telegram.org |
| `TELEGRAM_API_HASH` | Yes | From my.telegram.org |
| `TELEGRAM_PHONE` | Yes | Phone number with country code (e.g. `+351...`) |
| `GOOGLE_SHEET_URL` | Yes | Full URL of the target Google Sheet |
| `GOOGLE_CREDENTIALS_FILE` | No | Path to OAuth client JSON (default: `credentials.json`) |
| `MONITOR_INTERVAL` | No | Seconds between monitor checks (default: `300`) |
| `FRONTEND_URL` | No | Frontend URL for CORS (default: `http://localhost:3000`) |

## How It Works

### Telegram login flow

When the backend starts, it initializes the Telethon client inside the FastAPI lifespan — **before** accepting any API requests. This prevents race conditions from data-center migrations that can otherwise break the session mid-request. If the saved session is broken (e.g. `AuthKeyUnregisteredError`), it automatically deletes `session.session` and re-runs the login flow.

### Persistence

Groups and their settings are stored in `backend/groups.json`. Every add, delete, scrape, and monitor start/stop writes to disk immediately. On startup, the file is loaded and any groups that were monitoring before shutdown automatically resume.

### Scraping modes

- **Member mode** uses Telethon's `iter_participants(aggressive=True)`, which combines multiple search strategies to fetch the maximum number of members Telegram will expose.
- **Message mode** uses `iter_messages` to scan the message history, extracting unique senders. For broadcast channels with a linked discussion group, it automatically detects the link via `GetFullChannelRequest` and scrapes the discussion group instead.

### Deduplication

Before appending, the sheet is read and existing User IDs are loaded into a set. Only users whose IDs are not already in the sheet are appended. This is why running scrape multiple times is safe — existing rows are never touched.

### Monitoring

Uses `APScheduler` with an asyncio scheduler. Each monitored group gets its own interval job. When the job runs, it calls the same scrape function with `mark_new=True`, so any genuinely new users are tagged in the sheet.

## Important Notes

### Broadcast channels vs supergroups

Telegram treats broadcast channels (one-way, like news) differently from supergroups:

- **Supergroups**: All members (up to ~10,000) are visible via the member list API.
- **Broadcast channels**: Only admins are exposed to non-admin accounts. To scrape all members, the account must be an admin.

For broadcast channels where you aren't admin, use **"Scrape Messages"** — it collects users who posted, which is usually better for outreach anyway (active users > silent lurkers).

### Rate limits

Telegram enforces strict rate limits. The scraper handles `FloodWaitError` by sleeping and retrying automatically. Best practices:

- Keep `MONITOR_INTERVAL` at **300 seconds or more**
- Very large groups (10k+) can take several minutes per full scrape
- Don't run multiple scrapes simultaneously on the same account

### Private groups

Invite links work, but the account must have joined the group first (the scraper will attempt to join using the invite link if possible).

## Troubleshooting

**"The key is not registered in the system" or `AuthKeyUnregisteredError`**
Delete `backend/session.session` and restart the backend. The login flow will run again.

**Pydantic / Rust compilation error on Windows**
Use Python 3.12 instead of 3.13, or run `pip install -r requirements.txt --only-binary :all:`

**Google login browser doesn't open**
Make sure you're running the backend on a machine with a browser. For headless servers, use OAuth redirect flow manually or pre-generate `token.json` on a desktop and copy it over.

**"Admin access required" error**
The group is a broadcast channel and your account isn't an admin. Use **"Scrape Messages"** instead.

**Frontend shows "Backend Offline"**
The backend is not running, or it's running on a different port. Verify with `curl http://localhost:8000/api/health`.

## File Reference

- **Ignored from git**: `backend/venv/`, `backend/__pycache__/`, `backend/session.session*`, `backend/token.json`, `backend/credentials.json`, `backend/groups.json`, `backend/.env`, `frontend/node_modules/`, `frontend/.next/`
