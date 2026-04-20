# Supabase setup

The Next.js frontend now uses Supabase for auth + multi-tenant data storage. The Python backend still exists for Telegram operations (scraping, sending, warm-up). Over subsequent sessions we'll migrate state from local JSON files into Supabase tables and phase out the JSON files.

This doc covers the one-time Supabase provisioning.

## 1. Create a Supabase project

1. Go to https://supabase.com and sign in (free tier is fine for development).
2. **New project** → choose a name (e.g. `telegram-outreach-dev`), a strong database password, and a region close to you.
3. Wait 1–2 minutes for the project to provision.

## 2. Copy your project's API keys

Inside the new project:

1. **Settings** → **API**.
2. Copy three values into `frontend/.env.local` (create it from `.env.local.example` if needed):

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

⚠️ **Never commit the service-role key.** It bypasses Row-Level Security. It stays server-side only.

## 3. Apply the initial schema

1. In your Supabase project: **SQL Editor** → **New query**.
2. Open `supabase/migrations/00001_initial_schema.sql` in your editor.
3. Paste the whole file contents into the SQL Editor and click **Run**.
4. You should see `Success. No rows returned`. This creates:
   - 10 tables (profiles, telegram_accounts, group_sources, contacts, campaigns, ...)
   - 4 enums (account_status, campaign_status, queue_item_status, send_log_status)
   - RLS policies so every user only sees their own data
   - Triggers for `updated_at` bumping and auto-profile creation on signup

## 4. Configure auth

1. **Authentication** → **Providers** → ensure **Email** is enabled (default).
2. **Authentication** → **URL configuration**:
   - **Site URL**: `http://localhost:3000`
   - **Redirect URLs**: add `http://localhost:3000/callback` (for email confirmation) and eventually your production URL.
3. *(Optional)* Disable email confirmation while developing: **Authentication → Providers → Email** → uncheck *Confirm email*. Makes `npm run dev` smoother; turn it back on before production.

## 5. Verify the frontend

```bash
cd frontend
npm run dev
# open http://localhost:3000
```

- Visit **/** → landing page with **Log in** / **Sign up** in the header.
- Click **Sign up**, create an account with any email + password ≥ 8 characters.
- If email confirmation is enabled, check inbox and click the link; otherwise you'll land on `/dashboard` immediately.
- `/dashboard` shows the overview (fleet counts + recent sends). Stats will be zero until you onboard Telegram accounts and start campaigns.
- `/groups`, `/accounts`, `/campaigns` all work and call the Python backend on port 8000.

Signed-out access to `/dashboard/*` redirects to `/login?next=...`; signed-in access to `/login` redirects to `/dashboard`.

## 6. Next steps

Phase-2 work not yet done:

- **Python backend ↔ Supabase sync**: the Python `accounts.json`, `queue.json`, and `sent_log.json` files are still the source of truth for the worker. Next session we'll wire them to Supabase so campaigns/accounts created in the dashboard appear in the Python worker, and vice versa.
- **User scoping in Python**: the Python API currently returns all data globally. We'll add `user_id` filtering using the Supabase JWT once the sync lands.
- **Production deploy**: Vercel for the Next.js app, a small VPS or Fly.io/Railway for the Python worker + Telethon sessions (Vercel serverless can't hold long-lived Telethon connections).

## Troubleshooting

**"Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"**
Restart `npm run dev` after editing `.env.local`. Next.js only reads env vars at server boot.

**Signup succeeds but the user isn't in `profiles`**
Check the `handle_new_user` trigger: `SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created'`. If missing, re-run the migration.

**Login redirects in a loop**
Clear site cookies and try again. Usually an old Supabase cookie from another project. In dev tools: **Application → Cookies → http://localhost:3000 → clear all**.

**RLS blocks a query you expected to work**
Use the service-role client (`createAdminClient()` from `src/lib/supabase/admin.ts`) in server routes that legitimately need to bypass RLS. Never expose that client to browser code.
