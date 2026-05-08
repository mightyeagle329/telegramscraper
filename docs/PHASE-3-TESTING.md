# Outpilot Phase 3 — testing guide

This is the operator's how-to for the Phase 3 features just shipped.
Phase 3 has two functional tracks (A — funnel measurement, B — engagement
bot) plus deployment scaffolding. Everything works locally without
deployment; deployment is only required for 24/7 bot uptime.

---

## What's new in this phase

**Track A — Funnel measurement layer**

- New backend module: `group_tracker.py` watches one or more "owned"
  Telegram groups (e.g. TitanTreasure casino) and detects new joiners
  every 30 minutes. Each new joiner is cross-referenced with the last
  14 days of `sent_log.json` and attributed to the campaign / arm that
  DM'd them.
- New persistence: `tracked_groups.json` (config) + `joins.json`
  (event log).
- Analytics extended: `/analytics` page now shows **Joins** + **Join
  rate** alongside replies, plus a "Tracked groups" management panel
  and a "Source group scorecards" panel that tiers your candidate
  scrape-source groups T1 / T2 / T3 by quality.
- Per-campaign A/B stats now include `joined`, `join_rate`, and a
  `join_winner` so the campaigns page picks winners on the funnel KPI,
  not just reply rate.

**Track B — Engagement bot**

- New backend module: `engagement_bot.py`. Telegram Bot API
  integration via `python-telegram-bot`, a Google Sheet → Telegram
  posting pipeline, and an APScheduler tick every 5 minutes.
- New `/bot` dashboard page with queue, post history, manual "Post
  now" override, and "Run cycle now" button.
- Auto-creates the `Posts` tab in your configured Google Sheet on
  first run so you don't have to remember the column names.
- Built-in safety: max 6 posts per cycle, ≥3s between posts inside a
  cycle, RetryAfter handling, no duplicate posts on already-posted rows.

**Track C — Deployment scaffolding**

- Updated `backend/Dockerfile` covering the new state files.
- New `fly.toml` template at the repo root for Fly.io deployment.

---

## Setup before testing

### 1. Install new Python dependency

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt   # picks up python-telegram-bot 21.6
```

### 2. Configure the engagement bot (Track B)

a) **Register a Telegram bot.** Open `@BotFather` in Telegram, run
`/newbot`, follow prompts, copy the token.

b) **Add the bot to your group** (e.g. TitanTreasure) as an admin.
Grant it the **Post Messages** permission. If your group is a private
supergroup, ensure "All members are admins" is OFF or the bot is
specifically promoted.

c) **Find the group's chat_id.** Easiest: forward any message from the
group to `@userinfobot` — it'll reply with the chat_id (looks like
`-1001234567890` for supergroups).

d) **Create a Google Sheet** for the bot's content queue. **Use a
different spreadsheet than the scraper sheets** to keep concerns
clean. Share it with the same Google service account email your
scraper already uses (find it in `backend/credentials.json` →
`client_email`). Copy the spreadsheet ID from its URL.

e) **Set environment variables** in `backend/.env`:

```
ENGAGEMENT_BOT_TOKEN=123456:ABC-DEF...
ENGAGEMENT_BOT_CHAT_ID=-1001234567890
ENGAGEMENT_BOT_SHEET_ID=1AbCdEf...   # the spreadsheet ID
ENGAGEMENT_BOT_SHEET_TAB=Posts        # default; the bot creates this tab
```

f) **Restart the backend** so it picks up the new env + runs the
`Posts` tab auto-creation on first cycle.

### 3. Restart everything

```bash
# Backend
lsof -ti:8000 | xargs -r kill -9
cd backend && source venv/bin/activate && python main.py

# Frontend (separate terminal)
cd frontend && npm run dev
```

---

## Track A testing — Funnel measurement

### A.1 — Track your destination group

1. Go to `/analytics` in the dashboard.
2. Find the **"Tracked groups (funnel destination)"** panel.
3. Paste `https://t.me/titantreasurecasino` into the input → click
   **"Track this group"**. The backend resolves the group, scrapes its
   current member list as the baseline snapshot (this is the "we
   already know about everyone here" mark), and starts the recurring
   30-minute poll.
4. Initial response will show the group's name, member count, and a
   `last polled` timestamp.

### A.2 — Verify the tracker detects joins

Easiest way: have a friend (or one of your sender accounts) join the
group. Then:

- Wait 30 minutes for the next scheduled poll, OR
- Click **"Poll now"** on the group's row to force an immediate cycle.

The new joiner's user_id will be appended to `backend/joins.json`. If
that user was DM'd by one of your campaigns within the last 14 days,
the join is attributed (`source_campaign`, `source_arm`, `source_account`
are populated). If not, it's recorded as an unattributed/organic join.

### A.3 — Verify analytics surfaces joins

1. Pick the **14-day window** on `/analytics`.
2. Top stat row should now show two new cards: **Group joins** and
   **Join rate**.
3. The **Daily volume** chart now has 4 series — sent / replied /
   **joined** (yellow) / skipped.
4. The **Per account** table has new **Joins** + **Join %** columns.
5. The **Per campaign** table shows joins per arm and a **join winner**
   highlighted in yellow alongside the green reply winner.

### A.4 — Verify the source-group scorecards

1. On `/analytics`, scroll to **"Source group scorecards"**.
2. You should see one row per scraped Google Sheet tab.
3. Columns: Tier (T1/T2/T3), Members, Reachable %, Sent, Replies,
   Joins, Reply %, Join %.
4. **T1** = ≥40% reachable AND ≥3% join rate.
   **T2** = ≥20% reachable AND ≥1% join rate.
   **T3** = anything below.

This is the "which US gambling Telegram groups should we keep?"
answer. Drop T3 groups, double down on T1.

### A.5 — Verify per-campaign A/B winners now consider joins

1. Go to `/campaigns`.
2. Pick a campaign in the **A/B test results** dropdown.
3. The header line shows `total_sent · total_replied · total_joined`.
4. Each arm row has `Sent / Replied / Joined / Reply % / Join %`
   columns. The bar chart visualises **join rate** (the new KPI), and
   the winning arm is highlighted in **yellow** with "join winner"
   chip. If a different arm wins on reply rate, that's also shown in
   green.

---

## Track B testing — Engagement bot

### B.1 — Verify the bot is connected

1. Go to `/bot` in the dashboard.
2. The status card at the top should say **"Bot connected"** and show:
   - Bot username (e.g. `@TitanTreasureBot`)
   - chat_id you're posting to
   - Sheet ID + tab name

3. If it says **"Bot not configured"**, fix the missing env vars from
   step 2 above.

### B.2 — Add a post to the queue

Open your Google Sheet (the engagement-bot one). The `Posts` tab will
have these columns auto-created on first run:

| id | content | scheduled_at | type | image_url | chat_id | posted_at | status |

Add a row like:

| `test-1` | `Hey everyone, what's the biggest spin you've hit this week?` | `2026-05-06 19:30` | `engagement` | (leave blank) | (leave blank) | (leave blank) | (leave blank) |

`scheduled_at` accepts:
- `2026-05-06 19:30` (treated as UTC if no timezone)
- `2026-05-06 19:30 UTC`
- `2026-05-06T19:30:00+00:00` (full ISO with timezone)

`type` is free-form (e.g. `win`, `game`, `engagement`, `poll`) — the
bot doesn't validate it; it's for your reporting.

`image_url` (optional): if set, the bot sends a photo with `content`
as the caption. Otherwise it sends a text message.

### B.3 — Verify the post fires

Two ways:

**Manual (immediate test):** on the `/bot` page, click **"Post now"**
next to the queued row. The bot posts immediately, the Sheet's
`posted_at` and `status` columns are filled in, and the `Posted` panel
on the page updates.

**Scheduled:** wait until `scheduled_at` arrives. The next
`engagement_bot` cycle (every 5 minutes) will find the row, post it,
and mark it done. The `Posted` panel auto-refreshes every 30s.

### B.4 — Verify history is captured

`backend/bot_history.json` accumulates every successful post — the
`/bot` page reads it for the audit trail. Check:

```bash
cat backend/bot_history.json | jq '.[-3:]'
```

You should see the last 3 posts with their telegram_message_id.

### B.5 — Force a cycle on demand

- On `/bot`, click **"Run cycle now"** to trigger one immediate
  scheduler tick. Banner reports `posted / errors / considered`.

---

## Track C — Deployment readiness (no payment required to test)

The deployment scaffolding is in place but not active until you sign up
for Fly.io with the new email (you mentioned you'd handle that
separately). When ready:

```bash
# After signing up at fly.io
curl -L https://fly.io/install.sh | sh
fly auth login
fly launch --no-deploy --copy-config   # uses existing fly.toml
fly volumes create outpilot_state --region iad --size 3

# Set secrets — copy values from your backend/.env
fly secrets set TELEGRAM_API_ID=... TELEGRAM_API_HASH=... TELEGRAM_PHONE=+1...
fly secrets set OPENAI_API_KEY=sk-...
fly secrets set SCRAPER_PROXY_HOST=... SCRAPER_PROXY_PORT=... \
                SCRAPER_PROXY_USERNAME=... SCRAPER_PROXY_PASSWORD=...
fly secrets set ENGAGEMENT_BOT_TOKEN=... ENGAGEMENT_BOT_CHAT_ID=... \
                ENGAGEMENT_BOT_SHEET_ID=...
fly secrets set FRONTEND_URL=https://your-frontend.vercel.app
fly secrets set GOOGLE_CREDENTIALS_B64="$(base64 -w0 backend/credentials.json)"
fly secrets set GOOGLE_TOKEN_B64="$(base64 -w0 backend/token.json)"

# Deploy
fly deploy
```

Update Vercel's `NEXT_PUBLIC_API_URL` to the Fly.io URL (e.g.
`https://outpilot.fly.dev`) and trigger a redeploy.

The Cloudflare quick-tunnel setup keeps working too — Fly is the
upgrade path, not a hard requirement.

---

## What to verify all-up

A "Phase 3 is working" checklist:

- [ ] Backend boots cleanly; logs show "Scheduled jobs ready
      (health-check, warmup, signup-reaper, group-tracker,
      engagement-bot)".
- [ ] `/analytics` page loads, shows Tracked Groups panel + Source
      group scorecards, daily chart has 4 series.
- [ ] `/bot` page loads, status card is green ("Bot connected").
- [ ] Add `t.me/titantreasurecasino` as a tracked group → poll-now
      returns `total_members > 0`.
- [ ] Add a row to the bot's Google Sheet → click Post now →
      message appears in the TitanTreasure group within seconds.
- [ ] Sheet `posted_at` + `status` columns auto-fill after posting.
- [ ] After someone DM'd by a campaign joins TitanTreasure → next
      poll cycle records the join in `joins.json` with
      `source_campaign` populated.

---

## Troubleshooting

**"Bot not configured" on /bot.** Re-check `backend/.env` has all
three: `ENGAGEMENT_BOT_TOKEN`, `ENGAGEMENT_BOT_CHAT_ID`,
`ENGAGEMENT_BOT_SHEET_ID`. Restart backend.

**"403 Forbidden" or "Bot was blocked" on post.** The bot isn't an
admin in the group, or doesn't have post-message permission. Re-add
it.

**"Failed to read engagement bot sheet".** The Google service account
doesn't have edit access to the spreadsheet. Share the sheet with the
service account email (in `backend/credentials.json` →
`client_email`).

**"Could not save tracked_groups.json"** or similar IO error in logs.
The backend's working directory isn't writable. Ensure you're running
from `backend/` (not from the repo root).

**Joins not attributed despite real DM.** Check `backend/sent_log.json`
— the entry must have `status="sent"`, `kind="primary"`, the same
`account_id`, and a `target_user_id` matching the joiner's user_id.
The 14-day attribution window means anything older won't credit.

**Bot post-cycle didn't fire on time.** APScheduler runs every 5
minutes. Click "Run cycle now" on `/bot` to bypass the schedule.

---

## VA workflow — daily content posting

The VA's role is to keep the destination group looking active by posting
wins (supplied by the client) and keeping a steady drip of engagement
content throughout the day. They work primarily through `/bot` in
Outpilot — no Google Sheet editing required (though it's still allowed
for power users).

### What the VA sees on `/bot`

In order, top to bottom:

1. **Status card** — confirms the bot is connected.
2. **Quick stats** — Pending review · Scheduled · Posted (today).
3. **Compose a single post** — fast form to schedule one post.
4. **Bulk import wins** — paste many posts at once, spread across N days.
5. **Pending review** — only appears when AI has queued posts awaiting
   approval.
6. **Scheduled queue** — approved/composed posts waiting to publish.
7. **Posted** — recent history.
8. **AI engagement writer (advanced)** — config the operator usually
   sets once.

### The two main daily flows

#### Flow A — client just sent the day's wins (most common)

1. Client texts the VA the day's wins (a list of 5-15 lines).
2. VA opens `/bot` → scrolls to **Bulk import wins**.
3. Pastes all wins into the textarea (one per line).
4. Picks **Spread over: 1 day** (or 2 if it's a slower volume day).
5. Leaves "Posts per day" blank (auto-distributes).
6. Leaves "Import as pending review" UNCHECKED — these came from the
   client, no review needed.
7. Clicks **Import N posts**.
8. The posts land in the **Scheduled queue**, distributed across the
   active window. Done — the bot will publish them on schedule.

**Time cost: ~2 minutes per batch.**

#### Flow B — the AI wrote a batch overnight, VA reviews

1. VA opens `/bot`. The **Pending review** section is visible at the
   top with N AI-generated posts.
2. For each one, the VA reads it and clicks one of:
   - **Approve** → the post moves to the scheduled queue and will
     publish at its scheduled time.
   - **Edit** → fix typos / tweak wording / save → then approve.
   - **Reject** → deletes the row entirely.
3. After clearing the review queue, VA can also use **Compose** to
   add a one-off post if the client sent a hot win mid-day.

**Time cost: ~5 minutes per batch of 6 AI posts.**

### How the operator should set up the AI writer (one-time)

This makes the pending-review queue auto-fill so the VA has work to do
even when the client is slow to send wins.

1. Open `/bot` → scroll to **AI engagement writer (advanced)**.
2. Edit the **Brand context** to match the actual product (already
   pre-set for TitanTreasure).
3. Tune the **content mix** — how many wins vs game announcements vs
   engagement questions vs polls per batch. The VA can override
   anything they don't like.
4. Set **active hours (UTC)** to match your audience's awake time
   (US: start 14, end 04 = 10am-midnight EST).
5. Enable the toggle.
6. Click **Generate + queue for review** to fill the queue immediately
   for the rest of today.
7. The scheduler runs every 12 hours from then on.

The pending-review gate means **nothing AI-generated ever publishes
without a human approving it first** — so there's zero risk of bad
copy slipping out.

### Sample VA SOP — share with the VA on Day 1

Here's the one-page daily SOP for the VA. Copy / paste into a Notion
doc or Google Doc and share with them:

> **Outpilot — Daily VA SOP**
>
> **Login**: ${OUTPILOT_URL}/login (operator gives you the email + password)
>
> **What you own**: keeping the TitanTreasure Telegram group looking
> active throughout US daytime hours.
>
> **Your daily checklist**:
>
> 1. **9-10 AM ET (start of shift)** — open `/bot`. Clear the **Pending
>    review** section: read each AI post, approve good ones, edit OK
>    ones, reject anything that sounds robotic, off-brand, or makes
>    promises it shouldn't.
> 2. **Throughout the day** — when the client sends new wins, paste
>    them into the **Bulk import** form, spread over today + tomorrow,
>    click Import. Done.
> 3. **End of shift (~10 PM ET)** — quick check on the **Scheduled
>    queue**: confirm there's content lined up for overnight + tomorrow
>    morning. If queue is short, run **AI writer → Generate + queue for
>    review** so tomorrow's batch is ready when you log in.
>
> **What to flag back to the operator**:
>
> - Any post that gets unusual replies in the group — copy/paste a
>   screenshot.
> - The bot showing as "not connected" in the status card.
> - Anyone DMing the group with a competitor offer (note the username,
>   the operator can ban).
>
> **Forbidden** — never post:
> - External URLs (only Telegram-internal links allowed).
> - Real player names (use fictitious handles like @LuckyMike,
>   @PlayerXYZ).
> - Specific dollar amounts the client didn't approve.
> - Anything mentioning real competitors (DraftKings, FanDuel etc).

### Troubleshooting (VA-specific)

**"Nothing posts when I import."** Check that the bot status card is
green ("Bot connected"). If it's yellow ("Bot not configured"), the
operator needs to fix env vars — flag it.

**"The post times look wrong."** Posts use UTC internally but display
in your local timezone. Double-check the Active hours config (UTC) —
they should map to your audience's daytime.

**"The pending-review section shows 50 posts and never shrinks."**
That's a backlog. Either approve faster, or have the operator turn the
AI writer Off until you catch up. The AI writer respects your queue —
it doesn't generate more if the previous batch is still pending.

**"I accidentally approved a bad post."** Open the **Scheduled queue**,
find the row, click **Edit** to fix it (or **Delete** to remove it
entirely). As long as it hasn't already posted (no `posted_at` time
yet), you can still change it.

---

*Phase 3 delivered May 2026. Maintained by Santiago Garcia.*
