# Deployment guide

The app has three moving parts; each deploys to a different place.

| Part | Where | Why |
|---|---|---|
| **Next.js frontend** | **Vercel** | Free tier fits; built for Next.js; zero-config deploys from GitHub |
| **Python worker + FastAPI** | **Fly.io** (recommended) or Railway / Render / any VPS | Telethon keeps long-lived MTProto connections — Vercel serverless CAN'T host this (300s cold-start, no persistent disk) |
| **Postgres + Auth** | **Supabase** | Managed Postgres + Row-Level-Security + Auth out of the box |

Total cost: **$0–8/mo** on free / hobby tiers while you're under the limits, ~**$20–30/mo** at production volume.

---

## 0. Prerequisites

- A GitHub account (free)
- A Supabase account (free): https://supabase.com
- A Vercel account (free): https://vercel.com
- A Fly.io account (free; card required but $0 usage): https://fly.io
- Your project pushed to GitHub (public or private — both work)

One-time: install the Fly CLI on your machine so you can deploy the backend:
```bash
curl -L https://fly.io/install.sh | sh
flyctl auth signup   # or: flyctl auth login
```

---

## 1. Supabase (do this first — everything else points to it)

### Provision the project

1. Supabase → **New project** → give it a name (e.g. `telegram-outreach-prod`) and a strong DB password. Region: pick closest to your users.
2. Wait ~1–2 min for it to come up.

### Apply schema

1. **SQL Editor → New query**.
2. Paste the full contents of `supabase/migrations/00001_initial_schema.sql` → **Run**.
3. Paste `supabase/migrations/00002_user_settings.sql` if present → **Run**.
4. Expected: `Success. No rows returned`.

### Collect the keys

From **Settings → API**, copy these. You'll paste them into Vercel and Fly later:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

Never commit the service-role key anywhere.

### Configure auth URLs

**Authentication → URL configuration**:
- **Site URL**: your Vercel URL once you have it (placeholder for now: `https://example.com`)
- **Redirect URLs**: add `https://your-app.vercel.app/callback` AND `http://localhost:3000/callback` (for local dev against prod Supabase)

Come back here after step 3 to update with the real Vercel URL.

---

## 2. Backend on Fly.io (Python + Telethon)

Fly runs your Python FastAPI as a long-lived container with persistent storage for the Telethon session files.

### Why Fly.io and not Vercel?

- **Vercel serverless = 60s max** per request. Our background worker needs to run indefinitely.
- **Telethon holds long-lived MTProto TCP connections.** Serverless tears those down.
- **Session files must persist across deploys.** Vercel's filesystem is ephemeral; Fly gives us a persistent volume.

### Prepare the backend for deployment

The repo already ships [backend/Dockerfile](../backend/Dockerfile) — Fly reads it automatically.

### First deploy

```bash
cd backend
flyctl launch
```

Answer the prompts:
- App name: `telegram-outreach-api` (or whatever, needs to be globally unique)
- Region: pick close to your Supabase region
- Postgres: **No** (we use Supabase)
- Redis: **No**
- Deploy now: **No** (we still need to set env + volume)

Fly will generate `backend/fly.toml`. It may need small tweaks — the repo's pre-filled version handles these:
- Internal port 8000
- Force HTTPS
- Minimum 1 VM always running (Telethon connections stay up)
- 1 GB persistent volume mounted at `/data` for session files

### Create the persistent volume

```bash
flyctl volumes create telegram_data --size 1 --region <your-region>
```

(1 GB is plenty — Telethon sessions are KB-sized; 10 accounts ≈ a few MB total.)

### Set environment variables

```bash
flyctl secrets set \
  TELEGRAM_API_ID=1234567 \
  TELEGRAM_API_HASH=abc... \
  TELEGRAM_PHONE=+44... \
  GOOGLE_SHEET_URL=https://docs.google.com/spreadsheets/d/... \
  FRONTEND_URL=https://your-app.vercel.app \
  NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

For Google OAuth, you need to upload `credentials.json` and the already-authed `token.json`. Two ways:

**Option A (simplest):** base64 the files into secrets, decode at container start.
```bash
flyctl secrets set \
  GOOGLE_CREDENTIALS_B64="$(base64 -w 0 backend/credentials.json)" \
  GOOGLE_TOKEN_B64="$(base64 -w 0 backend/token.json)"
```
The Dockerfile decodes these to disk on boot.

**Option B:** SFTP the files into `/data/` via `fly ssh sftp shell` after first deploy.

### For your scraper account's Telethon session

This is the ONE session that needs the interactive SMS login. Easiest:

1. Finish your local setup so `backend/session.session` exists locally.
2. Upload it to Fly's persistent volume:
   ```bash
   flyctl ssh sftp shell
   # inside the sftp shell:
   put backend/session.session /data/session.session
   exit
   ```
3. Set `SESSION_PATH=/data/session.session` in secrets.

(The Dockerfile's default is `/data/session.session`, so just set the secret.)

### Deploy

```bash
flyctl deploy
```

Fly builds the container, pushes to their registry, starts a VM, and returns a URL like `https://telegram-outreach-api.fly.dev`. Copy that URL — Vercel needs it.

### Verify

```bash
curl https://telegram-outreach-api.fly.dev/api/health
# → {"status":"ok"}
```

Logs live: `flyctl logs`.

---

## 3. Frontend on Vercel

### Push the repo to GitHub

```bash
cd /home/fencer/Documents/telegram_bot
git remote add origin git@github.com:<your-gh-username>/telegram-outreach.git
git push -u origin main
```

### Import into Vercel

1. https://vercel.com/new → **Import Git Repository** → pick your repo.
2. **Framework Preset**: Next.js (auto-detected).
3. **Root Directory**: `frontend` (important — the Next.js app isn't at repo root).
4. Keep default build settings.
5. **Environment variables** — add these:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase → API |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → API (server-only) |
| `NEXT_PUBLIC_API_URL` | `https://telegram-outreach-api.fly.dev` (your Fly URL) |

6. **Deploy**.

Vercel builds, uploads, gives you a URL like `https://telegram-outreach.vercel.app`.

### Back to Supabase

Once you have the Vercel URL:
1. Supabase → **Authentication → URL configuration** → update **Site URL** and **Redirect URLs** with the real Vercel domain.

### Update the backend to allow the Vercel origin

```bash
flyctl secrets set FRONTEND_URL=https://telegram-outreach.vercel.app
```
Fly will redeploy the backend automatically.

---

## 4. Custom domain (optional)

If you have one:

1. **Vercel → Settings → Domains** → add your domain → update DNS per their instructions.
2. **Supabase → Auth → URL configuration** → update Site URL + Redirect URLs.
3. **Fly → FRONTEND_URL** secret → update.

---

## 5. Ongoing

- **Every push to main** auto-deploys Vercel. Fly deploys on `flyctl deploy`.
- **Supabase schema changes** — apply via SQL Editor, or set up the Supabase CLI for local migrations later.
- **Monitoring** — Vercel dashboard for frontend traffic, Fly's dashboard for backend CPU/memory, Supabase for DB query stats.

## Cost estimate

| Service | Free tier | Paid tier needed when |
|---|---|---|
| Vercel | 100 GB bandwidth/mo | > ~100k monthly visits |
| Fly.io | 1 shared-cpu-1x VM free ($0 if stays in allowance) | > 2 accounts sending heavily |
| Supabase | 500 MB DB, 50k MAU | > 50k signed-up users |

For a single-client project (Gonçalo), you'll likely stay on free tiers for months.

---

## Troubleshooting

**Vercel build fails with "Cannot find Next.js"**
Wrong root directory. Set **Root Directory = `frontend`**.

**Fly deploy fails at `flyctl launch`**
Make sure you're in `backend/`. Fly looks for `Dockerfile` in the cwd.

**Backend `/api/health` returns 502**
Worker crashed or never started. Check `flyctl logs` — most common causes:
- Missing env vars (TELEGRAM_API_ID/HASH, Supabase keys)
- `session.session` didn't upload — signature is `AuthKeyUnregisteredError`
- Google `token.json` expired — re-authorize locally and re-upload

**Frontend shows "Backend Offline"**
`NEXT_PUBLIC_API_URL` in Vercel is wrong or not set. Should point to your Fly URL with `https://`.

**"Auth callback failed" after email confirmation**
Supabase redirect URLs not updated with the Vercel domain. Add `https://<app>.vercel.app/callback` to the allowed list.

**CORS error from dashboard → backend**
`FRONTEND_URL` secret on Fly doesn't match the Vercel URL. Set it, Fly redeploys, retry.
