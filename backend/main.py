import logging
import random
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import accounts as accounts_mod
import ai_engagement_writer
import ai_openers
import analytics
import client_pool
import engagement_bot
import group_tracker
import reply_watcher
import scorecards
import sender
import signup as signup_mod
import target_filter
import warmup
from config import FRONTEND_URL
from models import (
    AccountUpdate,
    CampaignFromSheetRequest,
    DistributeRequest,
    EnqueueRequest,
    GroupAdd,
    SignupCodeRequest,
    SignupPasswordRequest,
    SignupStartRequest,
    WarmupGroupsRequest,
)
from monitor import (
    get_all_monitoring,
    get_monitoring_status,
    get_scheduler,
    start_monitoring,
    stop_all,
    stop_monitoring,
)
from scraper import (
    disconnect,
    get_group_info,
    init_client,
    scrape_group_from_messages,
    scrape_group_members,
)
from sheets import sheets_manager
from storage import load_groups, save_groups

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Persistent store of added groups (loaded on startup, saved on every change)
groups_store: dict = {}

# Periodic job IDs (registered on the shared APScheduler).
JOB_HEALTH_CHECK = "phase1_health_check_all"
JOB_WARMUP_DAILY = "phase1_warmup_daily"
JOB_SIGNUP_REAPER = "phase1_signup_reaper"
JOB_GROUP_TRACKER = "phase3_group_tracker_poll_all"
JOB_ENGAGEMENT_BOT = "phase3_engagement_bot_cycle"
JOB_AI_WRITER = "phase3_ai_engagement_writer_cycle"

HEALTH_CHECK_INTERVAL_S = 30 * 60  # every 30 minutes
WARMUP_INTERVAL_S = 24 * 3600  # once per day
SIGNUP_REAPER_INTERVAL_S = 60  # reap abandoned signups every minute
GROUP_TRACKER_INTERVAL_S = 30 * 60  # poll tracked groups every 30 minutes
ENGAGEMENT_BOT_INTERVAL_S = 5 * 60  # check the engagement-bot queue every 5 minutes
AI_WRITER_INTERVAL_S = 12 * 3600  # generate fresh engagement content every 12 hours


def _persist():
    """Save groups to disk."""
    save_groups(groups_store)


async def _health_check_job() -> None:
    try:
        await client_pool.health_check_all()
    except Exception as e:
        logger.error(f"scheduled health check failed: {e}")


async def _warmup_job() -> None:
    try:
        await warmup.run_warmup_all()
    except Exception as e:
        logger.error(f"scheduled warmup run failed: {e}")


async def _group_tracker_job() -> None:
    """Phase 3 — periodic poll across every tracked owned-group, detecting
    new joiners and attributing them to the campaign that DM'd them."""
    try:
        results = await group_tracker.poll_all()
        joined_total = sum(r.get("joined", 0) for r in results)
        if joined_total:
            logger.info(f"group-tracker cycle: {joined_total} new join(s) across all tracked groups")
    except Exception as e:
        logger.error(f"scheduled group-tracker poll failed: {e}")


async def _engagement_bot_job() -> None:
    """Phase 3 — engagement-bot scheduler tick. Reads the content sheet,
    posts every due row up to MAX_POSTS_PER_CYCLE, marks them done."""
    try:
        if not engagement_bot.is_configured():
            return  # operator hasn't set up the bot yet — silent skip
        result = await engagement_bot.run_cycle()
        if result.get("posted"):
            logger.info(f"engagement-bot cycle: {result}")
    except Exception as e:
        logger.error(f"engagement-bot cycle failed: {type(e).__name__}: {e}")


async def _ai_writer_job() -> None:
    """Phase 3 — AI engagement writer tick. Auto-generates a batch of
    posts and appends them to the bot's content sheet on schedule. The
    engagement_bot job picks them up and publishes."""
    try:
        if not ai_engagement_writer.is_enabled():
            return  # operator hasn't enabled AI auto-writing — silent skip
        result = await ai_engagement_writer.run_cycle()
        if result.get("appended"):
            logger.info(f"ai-writer cycle: {result}")
    except Exception as e:
        logger.error(f"ai-writer cycle failed: {type(e).__name__}: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load persisted groups
    global groups_store
    groups_store = load_groups()
    logger.info(f"Loaded {len(groups_store)} groups from storage")

    # Connect to Google Sheets
    try:
        sheets_manager.connect()
        logger.info("Connected to Google Sheets")
    except Exception as e:
        logger.warning(f"Could not connect to Google Sheets: {e}")

    # Log in to Telegram (this may prompt for a code in terminal)
    try:
        await init_client()
        logger.info("Telegram client ready")
    except Exception as e:
        logger.error(f"Telegram client init failed: {e}")

    # Resume monitoring for groups that were monitoring before restart
    for group_id, group in groups_store.items():
        if group.get("status") == "monitoring":
            try:
                mode = group.get("scrape_mode", "members")
                start_monitoring(group["url"], mode=mode)
                logger.info(
                    f"Resumed monitoring for {group['name']} (mode={mode})"
                )
            except Exception as e:
                logger.error(f"Could not resume monitoring for {group['name']}: {e}")
                groups_store[group_id]["status"] = "active"
    _persist()

    # Phase 1: resume sender workers for every non-banned account.
    try:
        started = await sender.start_all_eligible()
        if started:
            logger.info(f"Phase 1: started sender workers for {started}")
    except Exception as e:
        logger.error(f"Could not start sender workers: {e}")

    # Phase 2: register live reply-detection handlers on every account.
    try:
        results = await reply_watcher.install_for_all_accounts()
        installed = [aid for aid, ok in results.items() if ok]
        if installed:
            logger.info(f"Phase 2: reply handlers installed for {installed}")
    except Exception as e:
        logger.error(f"Could not install reply handlers: {e}")

    # Phase 1: register scheduled jobs (health check every 30 min, warmup daily).
    try:
        sched = get_scheduler()
        sched.add_job(
            _health_check_job,
            "interval",
            seconds=HEALTH_CHECK_INTERVAL_S,
            id=JOB_HEALTH_CHECK,
            replace_existing=True,
        )
        sched.add_job(
            _warmup_job,
            "interval",
            seconds=WARMUP_INTERVAL_S,
            id=JOB_WARMUP_DAILY,
            replace_existing=True,
        )
        sched.add_job(
            signup_mod.reap_expired,
            "interval",
            seconds=SIGNUP_REAPER_INTERVAL_S,
            id=JOB_SIGNUP_REAPER,
            replace_existing=True,
        )
        sched.add_job(
            _group_tracker_job,
            "interval",
            seconds=GROUP_TRACKER_INTERVAL_S,
            id=JOB_GROUP_TRACKER,
            replace_existing=True,
        )
        sched.add_job(
            _engagement_bot_job,
            "interval",
            seconds=ENGAGEMENT_BOT_INTERVAL_S,
            id=JOB_ENGAGEMENT_BOT,
            replace_existing=True,
        )
        sched.add_job(
            _ai_writer_job,
            "interval",
            seconds=AI_WRITER_INTERVAL_S,
            id=JOB_AI_WRITER,
            replace_existing=True,
        )
        logger.info(
            "Scheduled jobs ready (health-check, warmup, signup-reaper, "
            "group-tracker, engagement-bot, ai-writer)"
        )
    except Exception as e:
        logger.error(f"Could not register Phase 1 scheduled jobs: {e}")

    yield

    # Shutdown: stop Phase 1 workers + disconnect all sender clients, then
    # stop monitors and disconnect the scraping client.
    try:
        await sender.stop_all()
    except Exception as e:
        logger.warning(f"sender.stop_all failed: {e}")
    try:
        await client_pool.disconnect_all()
    except Exception as e:
        logger.warning(f"client_pool.disconnect_all failed: {e}")
    stop_all()
    await disconnect()
    _persist()
    logger.info("Shutdown complete")


app = FastAPI(title="Telegram Outreach Automation", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# =========================================================================
# Groups (Phase 0 — unchanged).
# =========================================================================


@app.post("/api/groups")
async def add_group(group: GroupAdd):
    """Add a new group to track."""
    try:
        info = await get_group_info(group.url)
        existing = groups_store.get(info["id"], {})
        groups_store[info["id"]] = {
            **info,
            "scraped_count": existing.get("scraped_count", 0),
            "status": existing.get("status", "active"),
            "last_scraped": existing.get("last_scraped"),
            "scrape_mode": existing.get("scrape_mode", "members"),
        }
        _persist()
        return groups_store[info["id"]]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error adding group: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/groups")
async def list_groups():
    return list(groups_store.values())


@app.delete("/api/groups/{group_id}")
async def remove_group(group_id: str):
    if group_id in groups_store:
        group = groups_store[group_id]
        stop_monitoring(group["url"])
        del groups_store[group_id]
        _persist()
        return {"status": "removed"}
    raise HTTPException(status_code=404, detail="Group not found")


@app.post("/api/groups/{group_id}/scrape")
async def scrape_group(group_id: str):
    if group_id not in groups_store:
        raise HTTPException(status_code=404, detail="Group not found")
    group = groups_store[group_id]
    try:
        result = await scrape_group_members(group["url"])
        groups_store[group_id].update(
            {
                "scraped_count": result["total_members_found"],
                "last_scraped": result["scraped_at"],
                "scrape_mode": "members",
            }
        )
        _persist()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error scraping group: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/groups/{group_id}/scrape-messages")
async def scrape_group_messages(group_id: str, message_limit: int = 5000):
    if group_id not in groups_store:
        raise HTTPException(status_code=404, detail="Group not found")
    group = groups_store[group_id]
    try:
        result = await scrape_group_from_messages(
            group["url"], message_limit=message_limit
        )
        groups_store[group_id].update(
            {
                "scraped_count": result["total_members_found"],
                "last_scraped": result["scraped_at"],
                "scrape_mode": "messages",
            }
        )
        _persist()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error scraping group messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/groups/{group_id}/monitor/start")
async def start_group_monitor(group_id: str, interval: int = 300):
    if group_id not in groups_store:
        raise HTTPException(status_code=404, detail="Group not found")
    group = groups_store[group_id]
    mode = group.get("scrape_mode", "members")
    status = start_monitoring(group["url"], interval, mode=mode)
    groups_store[group_id]["status"] = "monitoring"
    _persist()
    return status


@app.post("/api/groups/{group_id}/monitor/stop")
async def stop_group_monitor(group_id: str):
    if group_id not in groups_store:
        raise HTTPException(status_code=404, detail="Group not found")
    group = groups_store[group_id]
    status = stop_monitoring(group["url"])
    groups_store[group_id]["status"] = "active"
    _persist()
    return status


@app.get("/api/groups/{group_id}/monitor")
async def get_group_monitor_status(group_id: str):
    if group_id not in groups_store:
        raise HTTPException(status_code=404, detail="Group not found")
    group = groups_store[group_id]
    return get_monitoring_status(group["url"])


@app.get("/api/monitoring")
async def get_all_monitoring_status():
    return get_all_monitoring()


# =========================================================================
# Phase 3 — Funnel: tracked groups (the destination, e.g. TitanTreasure).
# Distinct from /api/groups which is the SCRAPE-SOURCE list.
# =========================================================================


@app.get("/api/tracked-groups")
async def tracked_groups_list():
    """List every owned-group under join-tracking."""
    return group_tracker.list_tracked_groups()


@app.post("/api/tracked-groups")
async def tracked_groups_add(body: dict):
    """Add a Telegram group to the funnel tracker.

    Body: { url: str, interval_s?: int }. The first scrape happens
    inline (so the operator gets immediate feedback) and the recurring
    poll runs on the lifespan scheduler.
    """
    url = (body or {}).get("url")
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    interval_s = int((body or {}).get("interval_s") or 0) or group_tracker.DEFAULT_POLL_INTERVAL_S
    try:
        return await group_tracker.add_tracked_group(url, interval_s=interval_s)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/tracked-groups/{group_id}")
async def tracked_groups_remove(group_id: str):
    ok = await group_tracker.remove_tracked_group(group_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tracked group not found")
    return {"removed": True}


@app.post("/api/tracked-groups/{group_id}/poll")
async def tracked_groups_poll(group_id: str):
    """Force an immediate poll cycle for one tracked group (no waiting for the scheduler)."""
    return await group_tracker.poll_group(group_id)


@app.post("/api/tracked-groups/poll-all")
async def tracked_groups_poll_all():
    """Force-poll every tracked group right now."""
    return {"results": await group_tracker.poll_all()}


@app.get("/api/joins")
async def joins_list(limit: int = 100, group_id: Optional[int] = None, campaign: Optional[str] = None):
    """Recent join events (attributed + organic), newest at the end."""
    return group_tracker.list_recent_joins(limit=limit, group_id=group_id, campaign=campaign)


@app.get("/api/groups/scorecards")
async def groups_scorecards():
    """Phase 3 funnel — tier candidate scrape-source groups by quality.

    For each scraped Google Sheet tab (each is one source group), returns
    member count, reachable @username %, sent/replied/joined counts, and
    a T1/T2/T3 tier so the operator can decide which groups to keep
    scraping vs drop.
    """
    return scorecards.compute_scorecards()


# =========================================================================
# Phase 3 — Engagement bot (Google Sheet → Telegram broadcast scheduler).
# =========================================================================


@app.get("/api/bot/status")
async def bot_status():
    """Health view of the engagement bot — token, chat, sheet reachability."""
    return await engagement_bot.get_bot_status()


@app.get("/api/bot/queue")
async def bot_queue():
    """Full sheet contents — queued + posted + errored rows.

    Frontend uses this to render the bot dashboard's queue and history.
    """
    return engagement_bot.list_queue()


@app.get("/api/bot/history")
async def bot_history(limit: int = 50):
    """Local audit log of every successful post from this backend."""
    return engagement_bot.list_history(limit=limit)


@app.post("/api/bot/post-now/{row_idx}")
async def bot_post_now(row_idx: int):
    """Force-post a specific sheet row immediately (manual override)."""
    return await engagement_bot.post_now(row_idx)


@app.post("/api/bot/run-cycle")
async def bot_run_cycle():
    """Run one scheduler tick on demand. Same code the lifespan job runs."""
    if not engagement_bot.is_configured():
        raise HTTPException(
            status_code=400,
            detail="Engagement bot is not configured (see /api/bot/status for missing fields).",
        )
    return await engagement_bot.run_cycle()


@app.get("/api/bot/writer/config")
async def bot_writer_config_get():
    """AI engagement-writer config — auto-generates posts for the bot
    when enabled. Operator tunes content mix, batch size, active hours,
    brand voice."""
    return ai_engagement_writer.load_config()


@app.put("/api/bot/writer/config")
async def bot_writer_config_put(body: dict):
    """Update the AI writer config. Body merges into the existing config —
    omitted keys keep their current values."""
    current = ai_engagement_writer.load_config()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    current.update(body)
    ai_engagement_writer.save_config(current)
    return current


@app.post("/api/bot/writer/preview")
async def bot_writer_preview():
    """Generate a sample batch and RETURN it without writing to the sheet.
    Lets the operator see what the AI would post before turning it on."""
    return await ai_engagement_writer.preview()


@app.post("/api/bot/writer/run-now")
async def bot_writer_run_now():
    """Force-run a generation cycle now AND append to the sheet, even if
    `enabled=False`. Useful for filling the queue immediately after first
    setup or whenever the queue runs dry."""
    return await ai_engagement_writer.run_cycle(force=True)


# ---- Phase 3 VA workflow — compose / bulk / edit / delete / approve ----


@app.post("/api/bot/post")
async def bot_post_add(body: dict):
    """Append one new post to the bot queue.

    Body: { content, scheduled_at, type?, image_url?, status? }
    """
    if not engagement_bot.is_configured():
        raise HTTPException(status_code=400, detail="Engagement bot is not configured")
    try:
        return engagement_bot.add_post(
            content=str((body or {}).get("content") or ""),
            scheduled_at=str((body or {}).get("scheduled_at") or ""),
            post_type=str((body or {}).get("type") or "win"),
            image_url=str((body or {}).get("image_url") or ""),
            chat_id=str((body or {}).get("chat_id") or ""),
            status=str((body or {}).get("status") or ""),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/bot/posts/bulk")
async def bot_posts_bulk(body: dict):
    """Append many posts at once, time-distributed across the active window.

    Body: {
        items: [{ content: str, type?: str, image_url?: str }, ...],
        spread_days?: int = 1,
        posts_per_day?: int,           // overrides automatic per-day count
        pending_review?: bool = false  // mark every row as pending VA approval
    }
    """
    if not engagement_bot.is_configured():
        raise HTTPException(status_code=400, detail="Engagement bot is not configured")
    items = (body or {}).get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="items must be a non-empty list")
    try:
        added = engagement_bot.bulk_add_posts(
            items=items,
            spread_days=int((body or {}).get("spread_days") or 1),
            posts_per_day=(body or {}).get("posts_per_day"),
            pending_review=bool((body or {}).get("pending_review", False)),
        )
        return {"added": len(added), "rows": added}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/bot/post/{row_idx}")
async def bot_post_update(row_idx: int, body: dict):
    """Update one or more fields on a queued post (content / scheduled_at / type / image_url / status)."""
    if not engagement_bot.is_configured():
        raise HTTPException(status_code=400, detail="Engagement bot is not configured")
    try:
        return engagement_bot.update_post(row_idx, body or {})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/bot/post/{row_idx}")
async def bot_post_delete(row_idx: int):
    """Delete a queued post by sheet row number."""
    if not engagement_bot.is_configured():
        raise HTTPException(status_code=400, detail="Engagement bot is not configured")
    try:
        ok = engagement_bot.delete_post(row_idx)
        return {"deleted": bool(ok)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/bot/post/{row_idx}/approve")
async def bot_post_approve(row_idx: int):
    """Approve a pending-review post so the next publish cycle picks it up."""
    if not engagement_bot.is_configured():
        raise HTTPException(status_code=400, detail="Engagement bot is not configured")
    try:
        return engagement_bot.approve_post(row_idx)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/sheets/stats")
async def get_sheets_stats():
    try:
        return sheets_manager.get_sheet_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sheets/{group_name}/members")
async def get_sheet_members(group_name: str):
    try:
        members = sheets_manager.get_all_members(group_name)
        return {"group_name": group_name, "members": members, "count": len(members)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================================
# Phase 1: Accounts.
# =========================================================================


@app.post("/api/accounts/signup/start")
async def accounts_signup_start(req: SignupStartRequest):
    """Step 1/3 — kick off a new signup: validate, connect via proxy, request SMS code."""
    try:
        return await signup_mod.start_signup(
            phone=req.phone,
            label=req.label or "",
            proxy=req.proxy.model_dump() if req.proxy else None,
            api_id=req.api_id,
            api_hash=req.api_hash,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/accounts/signup/verify")
async def accounts_signup_verify(req: SignupCodeRequest):
    """Step 2/3 — submit SMS code. May return needs_password=True for 2FA."""
    try:
        return await signup_mod.submit_code(req.signup_token, req.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/accounts/signup/password")
async def accounts_signup_password(req: SignupPasswordRequest):
    """Step 3/3 — submit 2FA cloud password if step 2 required it."""
    try:
        return await signup_mod.submit_password(req.signup_token, req.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/accounts/signup/{signup_token}")
async def accounts_signup_abandon(signup_token: str):
    """Cancel a pending signup (e.g. user closed the wizard)."""
    return {"abandoned": await signup_mod.abandon(signup_token)}


@app.get("/api/accounts/signup/pending")
async def accounts_signup_pending():
    """Redacted list of in-flight signups (debug aid)."""
    return signup_mod.list_pending()


@app.get("/api/accounts")
async def list_accounts():
    """Return redacted view of every sender account (no credentials)."""
    data = accounts_mod.load_accounts()
    return [accounts_mod.public_view(acct) for acct in data.values()]


@app.get("/api/accounts/{account_id}")
async def get_account(account_id: str):
    data = accounts_mod.load_accounts()
    if account_id not in data:
        raise HTTPException(status_code=404, detail="Account not found")
    return accounts_mod.public_view(data[account_id])


@app.patch("/api/accounts/{account_id}")
async def update_account(account_id: str, req: AccountUpdate):
    """Update editable fields on an account (friendly label for now).

    Only `label` is user-editable — everything else (phone, proxy, api creds,
    warm-up timeline) is set at signup or derived and should NOT be mutable
    from the dashboard. Add more patchable fields here if/when needed.
    """
    data = accounts_mod.load_accounts()
    if account_id not in data:
        raise HTTPException(status_code=404, detail="Account not found")

    if req.label is not None:
        new_label = req.label.strip()
        if len(new_label) > 80:
            raise HTTPException(
                status_code=400,
                detail="Label too long (max 80 characters)",
            )
        # Empty label falls back to the account id so the UI never shows blank.
        data[account_id]["label"] = new_label or account_id

    if req.dismiss_error:
        accounts_mod.clear_error(data[account_id])

    accounts_mod.save_accounts(data)
    return accounts_mod.public_view(data[account_id])


@app.post("/api/accounts/{account_id}/pause")
async def pause_account(account_id: str):
    """Flip an account to 'paused' status and stop its sender worker."""
    data = accounts_mod.load_accounts()
    if account_id not in data:
        raise HTTPException(status_code=404, detail="Account not found")
    data[account_id]["status"] = accounts_mod.STATUS_PAUSED
    accounts_mod.save_accounts(data)
    await sender.stop_worker(account_id)
    return accounts_mod.public_view(data[account_id])


@app.post("/api/accounts/{account_id}/resume")
async def resume_account(account_id: str):
    """Flip a paused account back to 'active' and restart its sender worker."""
    data = accounts_mod.load_accounts()
    if account_id not in data:
        raise HTTPException(status_code=404, detail="Account not found")
    if data[account_id].get("status") == accounts_mod.STATUS_BANNED:
        raise HTTPException(
            status_code=400, detail="Account is banned; cannot resume"
        )
    data[account_id]["status"] = accounts_mod.STATUS_ACTIVE
    accounts_mod.save_accounts(data)
    sender.resume_account(account_id)
    sender.start_worker(account_id)
    return accounts_mod.public_view(data[account_id])


@app.post("/api/accounts/{account_id}/health-check")
async def health_check_account(account_id: str):
    data = accounts_mod.load_accounts()
    if account_id not in data:
        raise HTTPException(status_code=404, detail="Account not found")
    result = await client_pool.health_check(data[account_id])
    accounts_mod.save_accounts(data)
    return result


@app.post("/api/accounts/health-check-all")
async def health_check_all_accounts():
    return await client_pool.health_check_all()


@app.delete("/api/accounts/{account_id}")
async def remove_account(account_id: str):
    """Permanently remove an account + its session file.

    Stops its worker, disconnects its client, deletes the session file, then
    drops the record from accounts.json.
    """
    data = accounts_mod.load_accounts()
    if account_id not in data:
        raise HTTPException(status_code=404, detail="Account not found")
    await sender.stop_worker(account_id, disconnect=True)

    import os

    session_file = data[account_id].get("session_file")
    for p in (session_file, (session_file or "") + "-journal"):
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass
    del data[account_id]
    accounts_mod.save_accounts(data)
    return {"status": "removed", "account_id": account_id}


# =========================================================================
# Phase 1: Sender (queue + workers).
# =========================================================================


@app.post("/api/sender/enqueue")
async def sender_enqueue(req: EnqueueRequest):
    data = accounts_mod.load_accounts()
    if req.account_id not in data:
        raise HTTPException(status_code=404, detail="Account not found")
    added = await sender.enqueue(
        account_id=req.account_id,
        targets=[t.model_dump() for t in req.targets],
        templates=req.templates,
        delete_after_s=req.delete_after_s,
        campaign=req.campaign,
        follow_up_after_days=req.follow_up_after_days,
        follow_up_templates=req.follow_up_templates,
    )
    return {"account_id": req.account_id, "enqueued": added}


@app.post("/api/sender/distribute")
async def sender_distribute(req: DistributeRequest):
    data = accounts_mod.load_accounts()
    for aid in req.account_ids:
        if aid not in data:
            raise HTTPException(status_code=404, detail=f"Account not found: {aid}")
    counts = await sender.distribute_round_robin(
        targets=[t.model_dump() for t in req.targets],
        account_ids=req.account_ids,
        templates=req.templates,
        delete_after_s=req.delete_after_s,
        campaign=req.campaign,
        follow_up_after_days=req.follow_up_after_days,
        follow_up_templates=req.follow_up_templates,
    )
    return {"enqueued": counts}


@app.get("/api/replies")
async def list_replies(limit: int = 50, account_id: Optional[str] = None):
    """Recent replies received on any sender account.

    The reply_watcher records every incoming message from a previously-DM'd
    user into ``replies.json``. This endpoint returns the tail of that file.
    """
    return reply_watcher.list_recent_replies(limit=limit, account_id=account_id)


@app.get("/api/sender/queue")
async def sender_queue():
    return await sender.queue_snapshot()


@app.delete("/api/sender/queue/{account_id}")
async def sender_queue_clear_one(account_id: str):
    return {"removed": await sender.clear_queue(account_id)}


@app.delete("/api/sender/queue")
async def sender_queue_clear_all():
    return {"removed": await sender.clear_queue(None)}


@app.get("/api/sender/sent-log")
async def sender_sent_log(limit: int = 50, account_id: str | None = None):
    return await sender.sent_log_tail(limit=limit, account_id=account_id)


@app.post("/api/sender/workers/{account_id}/start")
async def sender_worker_start(account_id: str):
    data = accounts_mod.load_accounts()
    if account_id not in data:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"started": sender.start_worker(account_id)}


@app.post("/api/sender/workers/{account_id}/stop")
async def sender_worker_stop(account_id: str):
    return {"stopped": await sender.stop_worker(account_id)}


@app.post("/api/sender/workers/start-all")
async def sender_workers_start_all():
    return {"started": await sender.start_all_eligible()}


@app.post("/api/sender/workers/stop-all")
async def sender_workers_stop_all():
    return {"stopped": await sender.stop_all()}


@app.get("/api/sender/workers")
async def sender_workers_status():
    return sender.worker_status()


# =========================================================================
# Phase 1: Warm-up.
# =========================================================================


@app.get("/api/warmup/groups")
async def warmup_groups_get():
    return {"urls": warmup._load_warmup_groups()}


@app.put("/api/warmup/groups")
async def warmup_groups_put(req: WarmupGroupsRequest):
    warmup.save_warmup_groups(req.urls)
    return {"urls": req.urls}


@app.post("/api/warmup/run/{account_id}")
async def warmup_run_one(account_id: str):
    data = accounts_mod.load_accounts()
    if account_id not in data:
        raise HTTPException(status_code=404, detail="Account not found")
    return await warmup.run_warmup_for_account(data[account_id])


@app.post("/api/warmup/run-all")
async def warmup_run_all():
    return {"results": await warmup.run_warmup_all()}


# =========================================================================
# Phase 1: Campaign helpers (sheet -> queue).
# =========================================================================


def _sheet_rows_to_targets(
    rows: list[dict],
    limit: int | None,
    shuffle: bool = True,
    filter_bots: bool = True,
) -> tuple[list[dict], int]:
    """Normalize gspread rows into sender targets.

    Returns ``(targets, filtered_count)``.

    Pipeline:
      1. Parse rows → target dicts (drops anything without a numeric user_id).
      2. Optionally drop likely-non-users (bots, admins, official accounts,
         etc.) via ``target_filter.is_likely_non_user``.
      3. Optionally shuffle (default on) so a small `limit` doesn't always
         hit the top-of-sheet contacts (heavy posters / admins).
      4. Apply the limit.

    Filter is applied BEFORE shuffle/limit so the limit counts only against
    real users, not against the noise.
    """
    targets: list[dict] = []
    for r in rows:
        uid = r.get("User ID") or r.get("user_id")
        if not uid:
            continue
        try:
            uid_int = int(uid)
        except (TypeError, ValueError):
            continue
        # gspread returns numeric-looking cells as int/float — coerce every
        # text field to str so downstream code can safely call .strip() etc.
        # (e.g. someone whose first_name is "123" arrives as int 123).
        def _txt(*candidates: object) -> str:
            for c in candidates:
                if c is None or c == "":
                    continue
                return str(c)
            return ""

        targets.append(
            {
                "user_id": uid_int,
                "username": _txt(r.get("Username"), r.get("username")),
                "first_name": _txt(r.get("First Name"), r.get("first_name")),
                "last_name": _txt(r.get("Last Name"), r.get("last_name")),
            }
        )

    filtered_count = 0
    if filter_bots:
        kept: list[dict] = []
        for t in targets:
            skip, _reason = target_filter.is_likely_non_user(t)
            if skip:
                filtered_count += 1
            else:
                kept.append(t)
        targets = kept

    if shuffle:
        random.shuffle(targets)

    if limit:
        targets = targets[:limit]

    return targets, filtered_count


@app.post("/api/campaigns/enqueue-from-sheet")
async def campaign_enqueue_from_sheet(req: CampaignFromSheetRequest):
    """Pull members from a Google Sheet tab and distribute DM tasks round-robin.

    Two request shapes are supported:

    - **Single arm (legacy)**: pass `templates` + optional `follow_up_*`
      fields directly; the body runs as one arm named "A".
    - **Multi-arm A/B test**: pass `arms=[{name, primary_templates,
      follow_up_after_days?, follow_up_templates?}, ...]`. Targets are
      split round-robin across (account, arm) pairs and each arm's name
      is stamped on every send / reply for the stats endpoint.
    """
    data = accounts_mod.load_accounts()
    for aid in req.account_ids:
        if aid not in data:
            raise HTTPException(status_code=404, detail=f"Account not found: {aid}")

    # Resolve arms: prefer explicit `arms`, fall back to the legacy
    # single-arm body so older frontends keep working.
    if req.arms:
        arms = [a.model_dump() for a in req.arms]
    elif req.templates:
        arms = [
            {
                "name": "A",
                "primary_templates": req.templates,
                "follow_up_after_days": req.follow_up_after_days,
                "follow_up_templates": req.follow_up_templates,
            }
        ]
    else:
        raise HTTPException(
            status_code=400,
            detail="Either `arms` or `templates` is required",
        )

    # Validate every arm has a primary message (templates OR AI). Validate
    # follow-up too if it was requested. Any AI mode requires the key.
    for a in arms:
        has_p_templates = bool(a.get("primary_templates"))
        has_p_ai = bool((a.get("ai_style") or "").strip())
        if not has_p_templates and not has_p_ai:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Arm {a.get('name')!r} needs either primary_templates "
                    f"or ai_style"
                ),
            )
        follow_days = a.get("follow_up_after_days")
        wants_followup = bool(follow_days and int(follow_days) > 0)
        has_f_templates = bool(a.get("follow_up_templates"))
        has_f_ai = bool((a.get("follow_up_ai_style") or "").strip())
        if wants_followup and not has_f_templates and not has_f_ai:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Arm {a.get('name')!r} has follow_up_after_days set but "
                    f"no follow_up_templates or follow_up_ai_style"
                ),
            )
        if (has_p_ai or (wants_followup and has_f_ai)) and not ai_openers.is_configured():
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Arm {a.get('name')!r} uses AI mode but OPENAI_API_KEY "
                    f"is not set on the backend (add it to backend/.env)"
                ),
            )

    try:
        rows = sheets_manager.get_all_members(req.sheet_group_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sheet read failed: {e}")
    targets, filtered_out = _sheet_rows_to_targets(
        rows,
        req.limit,
        shuffle=req.shuffle,
        filter_bots=req.filter_bots,
    )

    # Drop targets without a public @username. Cold DMs to user_id-only
    # peers always fail with PeerIdInvalidError — filtering up front saves
    # AI opener cost and queue churn.
    no_username_out = 0
    if req.require_username and targets:
        before = len(targets)
        targets = [t for t in targets if (t.get("username") or "").strip()]
        no_username_out = before - len(targets)

    # Global dedupe — drop anyone we've already DM'd from any account.
    # Done AFTER sheet parsing + bot filter + username filter but BEFORE
    # distribution so the `enqueued` counts reflect only fresh contacts.
    deduped_out = 0
    if req.dedupe_already_contacted and targets:
        already = sender.get_contacted_user_ids()
        if already:
            before = len(targets)
            targets = [t for t in targets if int(t["user_id"]) not in already]
            deduped_out = before - len(targets)

    if not targets:
        return {
            "enqueued": {aid: {a["name"]: 0 for a in arms} for aid in req.account_ids},
            "targets_found": 0,
            "filtered_out": filtered_out,
            "no_username_out": no_username_out,
            "deduped_out": deduped_out,
            "arms": [a["name"] for a in arms],
        }
    try:
        counts = await sender.distribute_arms_round_robin(
            targets=targets,
            account_ids=req.account_ids,
            arms=arms,
            delete_after_s=req.delete_after_s,
            campaign=req.campaign or req.sheet_group_name,
            group_name=req.sheet_group_name,
        )
    except ai_openers.AIOpenerError as e:
        # Fail the whole launch if any AI generation fails. Don't ship a
        # half-personalized batch — the user would get a confusing
        # campaign with some custom and some default copy.
        raise HTTPException(
            status_code=502,
            detail=f"AI opener generation failed: {e}",
        )
    return {
        "enqueued": counts,
        "targets_found": len(targets),
        "filtered_out": filtered_out,
        "no_username_out": no_username_out,
        "deduped_out": deduped_out,
        "arms": [a["name"] for a in arms],
    }


@app.get("/api/campaigns/ai/status")
async def campaigns_ai_status():
    """Whether AI-mode arms are usable on this backend.

    Frontend uses this to grey out the AI toggle on the arm card and
    explain why if the key isn't set.
    """
    from config import OPENAI_MODEL

    return {
        "configured": ai_openers.is_configured(),
        "model": OPENAI_MODEL,
    }


@app.get("/api/analytics/summary")
async def analytics_summary(days: int = 14):
    """One-shot performance roll-up for the /analytics page.

    Aggregates sent_log + replies + accounts over the last `days` days and
    returns totals, a daily volume series, per-account + per-campaign
    breakdowns, and a skip-reasons histogram.
    """
    return analytics.compute_summary(days=days)


@app.get("/api/campaigns/{campaign_name}/stats")
async def campaign_stats(campaign_name: str):
    """Per-arm reply rate for one campaign (A/B winner reporting).

    Returns sent / replied / reply_rate per arm and a `winner` (the arm
    with the highest reply rate, or `null` on a tie / no data yet).
    """
    return await sender.campaign_arm_stats(campaign_name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
