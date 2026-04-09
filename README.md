# Telegram Group Member Scraper

A tool to extract member usernames from Telegram groups and export them to Google Sheets, with a web dashboard for management and automatic monitoring for new members.

## Features

- Scrape member data (user ID, username, first/last name, phone if public) from any Telegram group
- Supports public groups (`t.me/groupname`) and invite links (`tg://join?invite=...`, `t.me/+...`)
- Exports data to Google Sheets (one worksheet per group, auto-created)
- Deduplication: only new members are added, never re-exports existing ones
- New member monitoring: automatically checks groups on a schedule and appends only new joins (marked as "NEW")
- Web dashboard to add groups, trigger scrapes, start/stop monitoring, and view status
- Handles Telegram rate limits automatically

## Project Structure

```
telegram_bot/
├── backend/                  # Python API server
│   ├── main.py               # FastAPI endpoints
│   ├── scraper.py            # Telegram scraping (Telethon)
│   ├── sheets.py             # Google Sheets export (OAuth2)
│   ├── monitor.py            # Background new-member monitoring
│   ├── models.py             # Pydantic data models
│   ├── config.py             # Environment config
│   ├── requirements.txt
│   ├── .env                  # Your credentials (git-ignored)
│   ├── .env.example
│   ├── credentials.json      # Google OAuth client secret (git-ignored)
│   └── token.json            # Auto-generated after Google login (git-ignored)
├── frontend/                 # Next.js dashboard
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx      # Main dashboard
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── AddGroup.tsx       # Add group form
│   │   │   ├── GroupTable.tsx     # Groups list with actions
│   │   │   ├── MonitoringPanel.tsx # Active monitoring display
│   │   │   └── StatusBar.tsx      # Backend connection status
│   │   └── lib/
│   │       ├── api.ts        # API client
│   │       └── types.ts      # TypeScript types
│   ├── .env.local.example
│   └── package.json
├── .gitignore
└── README.md
```

## Prerequisites

- Python 3.10+
- Node.js 18+
- A Telegram account (API credentials from https://my.telegram.org)
- A Google Cloud project with Sheets API enabled
- A Google Sheet shared with you

## Setup

### Step 1: Telegram API Credentials

1. Go to https://my.telegram.org and log in
2. Click "API development tools"
3. Create an app (any name, select Desktop)
4. Note your **API ID** and **API Hash**

The Telegram account used must be a member of the groups you want to scrape.

### Step 2: Google Sheets (OAuth2)

Since service account key creation may be disabled by your organization, this project uses OAuth2 (personal Google login):

1. Go to https://console.cloud.google.com
2. Create a new project
3. Enable **Google Sheets API** (APIs & Services > Library > search "Google Sheets API" > Enable)
4. Enable **Google Drive API** (same steps)
5. Configure **OAuth consent screen** (APIs & Services > OAuth consent screen):
   - Select Internal (or External if Internal unavailable)
   - Fill in app name and email, skip the rest
6. Create **OAuth Client ID** (APIs & Services > Credentials > + Create Credentials > OAuth client ID):
   - Application type: **Desktop app**
   - Download the JSON file
   - Save it as `backend/credentials.json`

### Step 3: Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate        # Linux/Mac
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your values:
#   TELEGRAM_API_ID=your_api_id
#   TELEGRAM_API_HASH=your_api_hash
#   TELEGRAM_PHONE=+1234567890
#   GOOGLE_SHEET_URL=https://docs.google.com/spreadsheets/d/your_sheet_id/edit

# Start the server
python main.py
```

**First run only:**
- A browser window opens for Google login. Sign in with the account that has access to the Google Sheet. Click "Allow".
- The terminal prompts for a Telegram login code. This code is sent to the Telegram app of the phone number in `.env`. Enter it in the terminal.

Both authentications are saved (`token.json` and `session` file) so you won't need to do this again.

The backend runs on **http://localhost:8000**.

### Step 4: Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure (optional, defaults to localhost:8000)
cp .env.local.example .env.local

# Start development server
npm run dev
```

The dashboard runs on **http://localhost:3000**.

## Usage

1. Open http://localhost:3000
2. Paste a Telegram group URL (e.g. `https://t.me/Richsweeps`) and click **+ Add**
3. Click **Scrape** to extract all current members to Google Sheets
4. Click **Monitor** to start automatic new-member detection (checks every 5 minutes)
5. New members are appended to the sheet and marked as "NEW" in the last column

### Google Sheet Output

Each group gets its own worksheet tab with these columns:

| User ID | Username | First Name | Last Name | Phone | Scraped At | Is New |
|---------|----------|------------|-----------|-------|------------|--------|
| 123456 | @johndoe | John | Doe | | 2026-04-09T... | NEW |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/groups` | Add a group (body: `{"url": "..."}`) |
| GET | `/api/groups` | List all tracked groups |
| DELETE | `/api/groups/{id}` | Remove a group |
| POST | `/api/groups/{id}/scrape` | Scrape members now |
| POST | `/api/groups/{id}/monitor/start?interval=300` | Start monitoring |
| POST | `/api/groups/{id}/monitor/stop` | Stop monitoring |
| GET | `/api/groups/{id}/monitor` | Get monitor status |
| GET | `/api/monitoring` | All active monitors |
| GET | `/api/sheets/stats` | Sheet row counts |
| GET | `/api/sheets/{group_name}/members` | Get members from sheet |

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

## Important Notes

- **Rate limits**: Telegram limits how fast you can fetch members. The scraper handles `FloodWaitError` automatically by waiting and retrying.
- **Large groups** (10k+ members) may take several minutes to scrape fully.
- **Private groups**: The Telegram account must be a member to scrape.
- **Admin access**: Some groups require admin privileges to view the member list.
- **Monitoring interval**: Keep at 300+ seconds to avoid hitting Telegram rate limits.
- **No duplicates**: The system checks user IDs against existing sheet data before appending.
