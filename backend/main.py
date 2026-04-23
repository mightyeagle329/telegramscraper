import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import accounts as accounts_mod
import client_pool
import sender
import signup as signup_mod
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

HEALTH_CHECK_INTERVAL_S = 30 * 60  # every 30 minutes
WARMUP_INTERVAL_S = 24 * 3600  # once per day
SIGNUP_REAPER_INTERVAL_S = 60  # reap abandoned signups every minute


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
        logger.info("Phase 1: scheduled health-check + warmup + signup-reaper jobs")
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
    )
    return {"enqueued": counts}


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


def _sheet_rows_to_targets(rows: list[dict], limit: int | None) -> list[dict]:
    """Normalize gspread get_all_records() rows into sender's target shape."""
    targets = []
    for r in rows:
        uid = r.get("User ID") or r.get("user_id")
        if not uid:
            continue
        try:
            uid_int = int(uid)
        except (TypeError, ValueError):
            continue
        targets.append(
            {
                "user_id": uid_int,
                "username": r.get("Username") or r.get("username") or "",
                "first_name": r.get("First Name") or r.get("first_name") or "",
                "last_name": r.get("Last Name") or r.get("last_name") or "",
            }
        )
        if limit and len(targets) >= limit:
            break
    return targets


@app.post("/api/campaigns/enqueue-from-sheet")
async def campaign_enqueue_from_sheet(req: CampaignFromSheetRequest):
    """Pull members from a Google Sheet tab and distribute DM tasks round-robin."""
    data = accounts_mod.load_accounts()
    for aid in req.account_ids:
        if aid not in data:
            raise HTTPException(status_code=404, detail=f"Account not found: {aid}")
    try:
        rows = sheets_manager.get_all_members(req.sheet_group_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sheet read failed: {e}")
    targets = _sheet_rows_to_targets(rows, req.limit)
    if not targets:
        return {"enqueued": {aid: 0 for aid in req.account_ids}, "targets_found": 0}
    counts = await sender.distribute_round_robin(
        targets=targets,
        account_ids=req.account_ids,
        templates=req.templates,
        delete_after_s=req.delete_after_s,
        campaign=req.campaign or req.sheet_group_name,
    )
    return {"enqueued": counts, "targets_found": len(targets)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
