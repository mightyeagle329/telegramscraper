"""Safe per-account DM sender (Phase 1 core).

One asyncio worker per active account pulls targets from a persisted queue
and sends DMs through the account's proxied Telethon client. The worker
enforces every safety knob the proposal calls for:

  - **Random delays** between sends (jittered uniform in ``DELAY_RANGE_S``).
  - **Warm-up-aware daily limits** via ``accounts.can_send``. Day 1–7 = zero
    DMs (warm-up only); day 8 onward ramps 3 → 50/day per the approved curve.
  - **Unique message text per send** — each queue item carries a list of
    template variants; the worker picks one at random, renders placeholders
    like ``{first_name}`` from the target's scraped data, and appends a
    small random invisible suffix so no two sends ship byte-identical.
  - **Auto-pause on errors** via ``error_handler.classify``. PeerFloodError
    rests the account 48h. Long FloodWaits rest for the cooldown. Banned
    accounts get flipped to status='banned' and their worker is stopped.
  - **Optional send-delete** — if ``delete_after_s`` is set on a queue
    item, the sender deletes its own copy of the sent message after that
    delay (reduces report-based bans).

Queue is persisted to ``queue.json`` and sent records to ``sent_log.json``
so the state survives restarts. All state mutations go through asyncio
locks to keep concurrent workers from racing on accounts.json.
"""

import asyncio
import json
import logging
import os
import random
import string
from datetime import datetime, timezone
from typing import Any, Optional

from telethon.tl.types import InputPeerUser

from accounts import (
    STATUS_ACTIVE,
    STATUS_BANNED,
    STATUS_PAUSED,
    can_send,
    load_accounts,
    mark_error,
    mark_send,
    save_accounts,
)
from client_pool import (
    ProxyConnectionError,
    disconnect_account,
    get_account_client,
)
from error_handler import classify

logger = logging.getLogger(__name__)

QUEUE_FILE = "queue.json"
SENT_LOG_FILE = "sent_log.json"

# Random delay between sends — jittered so two workers don't sync up.
DELAY_RANGE_S = (45, 180)

# Cap on how often a single worker loop spins when idle (no items + no eligibility).
IDLE_SLEEP_S = 30

# Max sent-log entries kept on disk (older entries rotated out).
SENT_LOG_MAX = 10_000

# Locks shared across all sender operations to keep queue/accounts writes atomic.
_queue_lock = asyncio.Lock()
_accounts_lock = asyncio.Lock()
_sent_log_lock = asyncio.Lock()

# Active worker tasks, keyed by account_id.
_workers: dict[str, asyncio.Task] = {}
# Pause-until timestamps set by the error handler (account_id -> unix ts).
_pause_until: dict[str, float] = {}


# ---------- queue + sent-log persistence ----------


def _load_queue() -> dict[str, list[dict]]:
    if not os.path.exists(QUEUE_FILE):
        return {}
    try:
        with open(QUEUE_FILE, "r") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Could not load queue: {e}")
        return {}


def _save_queue(queue: dict[str, list[dict]]) -> None:
    try:
        with open(QUEUE_FILE, "w") as f:
            json.dump(queue, f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save queue: {e}")


def _load_sent_log() -> list[dict]:
    if not os.path.exists(SENT_LOG_FILE):
        return []
    try:
        with open(SENT_LOG_FILE, "r") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (json.JSONDecodeError, IOError):
        return []


def _save_sent_log(entries: list[dict]) -> None:
    try:
        with open(SENT_LOG_FILE, "w") as f:
            json.dump(entries[-SENT_LOG_MAX:], f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save sent log: {e}")


async def _append_sent_log(entry: dict) -> None:
    async with _sent_log_lock:
        log = _load_sent_log()
        log.append(entry)
        _save_sent_log(log)


# ---------- public enqueue / queue API ----------


async def enqueue(
    account_id: str,
    targets: list[dict],
    templates: list[str],
    delete_after_s: Optional[int] = None,
    campaign: str = "",
) -> int:
    """Add DM tasks to an account's queue.

    ``targets`` is a list of scraped-member dicts (must include ``user_id``;
    ``username``/``first_name``/``last_name`` used for template rendering).

    ``templates`` is a list of message-body variants; the worker picks one
    at random per send so no two consecutive sends share identical text.

    Returns the number of items successfully enqueued.
    """
    if not templates:
        raise ValueError("At least one message template is required")
    if not targets:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    items = [
        {
            "target_user_id": int(t["user_id"]),
            "target_username": t.get("username") or "",
            "target_first_name": t.get("first_name") or "",
            "target_last_name": t.get("last_name") or "",
            "templates": templates,
            "delete_after_s": delete_after_s,
            "campaign": campaign,
            "enqueued_at": now,
            "attempts": 0,
        }
        for t in targets
        if t.get("user_id")
    ]
    async with _queue_lock:
        queue = _load_queue()
        queue.setdefault(account_id, []).extend(items)
        _save_queue(queue)
    logger.info(f"[{account_id}] enqueued {len(items)} targets (campaign={campaign!r})")
    return len(items)


async def distribute_round_robin(
    targets: list[dict],
    account_ids: list[str],
    templates: list[str],
    delete_after_s: Optional[int] = None,
    campaign: str = "",
) -> dict[str, int]:
    """Split targets across a list of accounts round-robin. Returns count per account."""
    if not account_ids:
        raise ValueError("account_ids must not be empty")
    buckets: dict[str, list[dict]] = {aid: [] for aid in account_ids}
    for i, t in enumerate(targets):
        buckets[account_ids[i % len(account_ids)]].append(t)
    counts: dict[str, int] = {}
    for aid, subset in buckets.items():
        counts[aid] = await enqueue(aid, subset, templates, delete_after_s, campaign)
    return counts


async def queue_snapshot() -> dict[str, Any]:
    """Return queue lengths per account + a preview of the next items."""
    async with _queue_lock:
        q = _load_queue()
    return {
        aid: {
            "pending": len(items),
            "next_targets": [
                {"user_id": it["target_user_id"], "username": it["target_username"]}
                for it in items[:5]
            ],
        }
        for aid, items in q.items()
    }


async def clear_queue(account_id: Optional[str] = None) -> int:
    """Remove all pending items from one account's queue, or all queues."""
    async with _queue_lock:
        q = _load_queue()
        if account_id is None:
            removed = sum(len(v) for v in q.values())
            q = {}
        else:
            removed = len(q.get(account_id, []))
            q.pop(account_id, None)
        _save_queue(q)
    return removed


async def sent_log_tail(limit: int = 50, account_id: Optional[str] = None) -> list[dict]:
    """Return the most recent sent-log entries, optionally filtered by account."""
    async with _sent_log_lock:
        log = _load_sent_log()
    if account_id is not None:
        log = [e for e in log if e.get("account_id") == account_id]
    return log[-limit:]


# ---------- message rendering ----------


def _render_template(template: str, target: dict) -> str:
    """Fill ``{first_name}`` / ``{last_name}`` / ``{username}`` placeholders.

    Missing fields render as empty string (safe for 'Hi {first_name}!').
    """
    safe = {
        "first_name": target.get("target_first_name", "") or "",
        "last_name": target.get("target_last_name", "") or "",
        "username": target.get("target_username", "") or "",
    }
    try:
        return template.format(**safe)
    except (KeyError, IndexError):
        # Unknown placeholder — return template as-is rather than crashing the worker.
        return template


def _invisible_suffix() -> str:
    """A 1–3 char random invisible suffix so no two sends ship byte-identical.

    Uses zero-width joiners / spaces that Telegram preserves in message body.
    """
    pool = ["\u200b", "\u200c", "\u200d", "\u2060"]  # ZWSP, ZWNJ, ZWJ, WJ
    return "".join(random.choice(pool) for _ in range(random.randint(1, 3)))


def _pick_message(item: dict) -> str:
    template = random.choice(item["templates"])
    body = _render_template(template, item)
    return body + _invisible_suffix()


# ---------- worker loop ----------


async def _atomic_mark_send(account_id: str) -> None:
    async with _accounts_lock:
        accounts = load_accounts()
        if account_id in accounts:
            mark_send(accounts[account_id])
            save_accounts(accounts)


async def _atomic_mark_error(
    account_id: str, reason: str, ban: bool = False, pause_s: int = 0
) -> None:
    async with _accounts_lock:
        accounts = load_accounts()
        acct = accounts.get(account_id)
        if acct is None:
            return
        mark_error(acct, reason)
        if ban:
            acct["status"] = STATUS_BANNED
        elif pause_s > 0:
            acct["status"] = STATUS_PAUSED
        save_accounts(accounts)
    if pause_s > 0:
        _pause_until[account_id] = (
            datetime.now(timezone.utc).timestamp() + pause_s
        )


async def _get_account_snapshot(account_id: str) -> Optional[dict]:
    async with _accounts_lock:
        accounts = load_accounts()
        return accounts.get(account_id)


async def _pop_next_item(account_id: str) -> Optional[dict]:
    async with _queue_lock:
        q = _load_queue()
        items = q.get(account_id, [])
        if not items:
            return None
        item = items.pop(0)
        q[account_id] = items
        _save_queue(q)
        return item


async def _requeue_item(account_id: str, item: dict) -> None:
    async with _queue_lock:
        q = _load_queue()
        q.setdefault(account_id, []).insert(0, item)
        _save_queue(q)


async def _send_one(account_id: str, item: dict) -> dict:
    """Send one DM. Returns a sent-log entry."""
    account = await _get_account_snapshot(account_id)
    if account is None:
        return {
            "account_id": account_id,
            "target_user_id": item["target_user_id"],
            "status": "error",
            "reason": "account record vanished",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    message = _pick_message(item)
    try:
        client = await get_account_client(account)
    except ProxyConnectionError as e:
        # Transient proxy blip (expired sticky session, cellular hiccup, etc.).
        # The Telegram account is fine — requeue this target at the head of
        # the queue and let the next cycle retry. Don't pause the account.
        logger.info(f"{e}; keeping target in queue for retry")
        await _atomic_mark_error(account_id, str(e))
        await _requeue_item(account_id, item)
        return {
            "account_id": account_id,
            "target_user_id": item["target_user_id"],
            "target_username": item.get("target_username", ""),
            "campaign": item.get("campaign", ""),
            "status": "error",
            "reason": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        await _atomic_mark_error(account_id, f"client_connect: {e}")
        # Unknown connect error — requeue + rethrow so the worker logs it.
        await _requeue_item(account_id, item)
        raise

    try:
        peer = InputPeerUser(item["target_user_id"], 0)
        sent = await client.send_message(peer, message)
    except BaseException as e:
        outcome = classify(e)
        await _atomic_mark_error(
            account_id,
            outcome.reason,
            ban=outcome.ban_account,
            pause_s=outcome.pause_account_s,
        )
        if outcome.retry_same_target_s:
            logger.info(
                f"[{account_id}] short FloodWait — sleeping "
                f"{outcome.retry_same_target_s}s then retrying same target"
            )
            await asyncio.sleep(outcome.retry_same_target_s)
            await _requeue_item(account_id, item)
        return {
            "account_id": account_id,
            "target_user_id": item["target_user_id"],
            "target_username": item["target_username"],
            "campaign": item.get("campaign", ""),
            "status": "skipped" if outcome.skip_target else "paused",
            "reason": outcome.reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    await _atomic_mark_send(account_id)

    # Optional send-delete tactic: delete our copy of the sent message after N seconds.
    delete_after = item.get("delete_after_s")
    if delete_after and delete_after > 0:
        asyncio.create_task(_delete_later(client, peer, sent.id, delete_after))

    return {
        "account_id": account_id,
        "target_user_id": item["target_user_id"],
        "target_username": item["target_username"],
        "campaign": item.get("campaign", ""),
        "message_id": sent.id,
        "status": "sent",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def _delete_later(client, peer, message_id: int, delay_s: int) -> None:
    try:
        await asyncio.sleep(delay_s)
        await client.delete_messages(peer, [message_id])
    except Exception as e:
        logger.warning(f"delete-after-send failed (msg={message_id}): {e}")


async def _worker_loop(account_id: str) -> None:
    """Main loop for one account's sender worker.

    Designed to NEVER crash on transient errors. Proxy blips, unknown
    Telethon edge cases, and per-iteration exceptions are all caught and
    logged; the loop keeps spinning. Only `asyncio.CancelledError`
    (explicit stop) or account-gone / account-banned conditions exit.
    """
    logger.info(f"[{account_id}] sender worker started")
    consecutive_errors = 0
    try:
        while True:
            try:
                # Honour pause-until if the error handler set one.
                now = datetime.now(timezone.utc).timestamp()
                pause_ts = _pause_until.get(account_id, 0)
                if pause_ts > now:
                    sleep_for = min(pause_ts - now, 300)
                    logger.info(
                        f"[{account_id}] paused for {int(pause_ts - now)}s more; sleeping"
                    )
                    await asyncio.sleep(sleep_for)
                    continue

                account = await _get_account_snapshot(account_id)
                if account is None:
                    logger.warning(
                        f"[{account_id}] account record gone — stopping worker"
                    )
                    return
                if account.get("status") == STATUS_BANNED:
                    logger.warning(f"[{account_id}] banned — stopping worker")
                    return

                ok, _reason = can_send(account)
                if not ok:
                    # Warming / daily cap / paused — just wait and re-check.
                    await asyncio.sleep(IDLE_SLEEP_S)
                    continue

                item = await _pop_next_item(account_id)
                if item is None:
                    await asyncio.sleep(IDLE_SLEEP_S)
                    continue

                entry = await _send_one(account_id, item)
                await _append_sent_log(entry)
                consecutive_errors = 0  # success (or orderly skip) — reset

                if entry["status"] == "sent":
                    delay = random.uniform(*DELAY_RANGE_S)
                    logger.info(
                        f"[{account_id}] sent -> {entry['target_user_id']}, "
                        f"sleeping {delay:.1f}s"
                    )
                    await asyncio.sleep(delay)
                # skipped / paused / error → no extra delay; the loop's
                # top-of-iteration gates handle rate-limits.

            except asyncio.CancelledError:
                raise

            except ProxyConnectionError as e:
                # Already logged + handled in _send_one; just back off a bit
                # longer than IDLE_SLEEP_S so we don't hammer a dead proxy.
                consecutive_errors += 1
                backoff = min(IDLE_SLEEP_S * (1 + consecutive_errors), 300)
                logger.info(
                    f"[{account_id}] proxy unreachable "
                    f"(consecutive={consecutive_errors}); backing off {backoff}s"
                )
                await asyncio.sleep(backoff)

            except Exception as e:
                # Unknown error during an iteration. Log the full traceback
                # but KEEP THE WORKER ALIVE — the most common root cause is
                # a transient network issue and the next iteration will be
                # fine. If it's a real bug, the logs will show repeats and
                # we can investigate.
                consecutive_errors += 1
                logger.exception(
                    f"[{account_id}] iteration error "
                    f"(consecutive={consecutive_errors}): {e}"
                )
                await asyncio.sleep(IDLE_SLEEP_S)

    except asyncio.CancelledError:
        logger.info(f"[{account_id}] sender worker cancelled")
        raise
    except Exception as e:
        # This catch is a last-resort: we shouldn't reach it because the
        # inner try/except already handles everything. If we do, log and
        # exit — the dashboard will show the worker as stopped.
        logger.exception(f"[{account_id}] sender worker exited unexpectedly: {e}")


# ---------- worker lifecycle ----------


def start_worker(account_id: str) -> bool:
    """Start a background sender worker for this account. Idempotent."""
    existing = _workers.get(account_id)
    if existing is not None and not existing.done():
        return False
    task = asyncio.create_task(_worker_loop(account_id), name=f"sender:{account_id}")
    _workers[account_id] = task
    return True


async def stop_worker(account_id: str, disconnect: bool = False) -> bool:
    """Cancel the background sender worker for this account."""
    task = _workers.pop(account_id, None)
    if task is None or task.done():
        return False
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass
    if disconnect:
        await disconnect_account(account_id)
    return True


def worker_status() -> dict[str, str]:
    out: dict[str, str] = {}
    for aid, task in _workers.items():
        if task.done():
            out[aid] = "stopped"
        elif _pause_until.get(aid, 0) > datetime.now(timezone.utc).timestamp():
            out[aid] = "paused"
        else:
            out[aid] = "running"
    return out


async def start_all_eligible() -> list[str]:
    """Start workers for every account that is not banned. Returns started ids."""
    started = []
    accounts = load_accounts()
    for aid, acct in accounts.items():
        if acct.get("status") == STATUS_BANNED:
            continue
        if start_worker(aid):
            started.append(aid)
    return started


async def stop_all() -> list[str]:
    stopped = []
    for aid in list(_workers.keys()):
        if await stop_worker(aid):
            stopped.append(aid)
    return stopped


def resume_account(account_id: str) -> bool:
    """Clear any pause-until gate for this account so its worker resumes sending.

    Does NOT change account status in accounts.json — caller should do that
    if they want to flip 'paused' back to 'active'.
    """
    return _pause_until.pop(account_id, None) is not None
