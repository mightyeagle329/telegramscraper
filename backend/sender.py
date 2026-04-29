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
from datetime import datetime, timedelta, timezone
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

# Smaller random delay after a SKIPPED send (recipient privacy-restricted,
# blocked us, deactivated, etc.). Skips don't penalise the account, but a
# burst of failed connect-attempts in a few seconds still looks more bot-
# like than human. 10-30s slows that burst without costing throughput
# (skipped sends don't count against the daily quota).
SKIP_DELAY_RANGE_S = (10, 30)

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
    follow_up_after_days: Optional[int] = None,
    follow_up_templates: Optional[list[str]] = None,
    arm: str = "A",
) -> int:
    """Add DM tasks to an account's queue.

    Each target produces a single ``primary`` queue item, scheduled to send
    immediately (``scheduled_at`` = now). When the primary is sent, the
    sender auto-enqueues a ``followup`` item scheduled for ``now +
    follow_up_after_days`` if `follow_up_after_days` was set on the
    primary's campaign config. The follow-up is cancelled if the recipient
    replies in the meantime (handled by reply_watcher).

    `arm` is a free-form label identifying which A/B test arm this batch
    belongs to. Defaults to "A" for single-arm (non-A/B) campaigns. Each
    queue item carries its arm forward into the sent_log so the stats
    endpoint can compute per-arm reply rates.

    Returns the number of primary items enqueued.
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
            "arm": arm,
            "kind": "primary",
            # Items become eligible to send when scheduled_at <= now (UTC).
            "scheduled_at": now,
            # Carry the follow-up config on the primary item so the worker
            # knows whether/when to schedule a follow-up after a successful send.
            "follow_up_after_days": follow_up_after_days,
            "follow_up_templates": follow_up_templates or [],
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
    logger.info(
        f"[{account_id}] enqueued {len(items)} targets "
        f"(campaign={campaign!r}, arm={arm!r})"
    )
    return len(items)


async def distribute_round_robin(
    targets: list[dict],
    account_ids: list[str],
    templates: list[str],
    delete_after_s: Optional[int] = None,
    campaign: str = "",
    follow_up_after_days: Optional[int] = None,
    follow_up_templates: Optional[list[str]] = None,
) -> dict[str, int]:
    """Split targets across a list of accounts round-robin. Returns count per account."""
    if not account_ids:
        raise ValueError("account_ids must not be empty")
    buckets: dict[str, list[dict]] = {aid: [] for aid in account_ids}
    for i, t in enumerate(targets):
        buckets[account_ids[i % len(account_ids)]].append(t)
    counts: dict[str, int] = {}
    for aid, subset in buckets.items():
        counts[aid] = await enqueue(
            aid,
            subset,
            templates,
            delete_after_s,
            campaign,
            follow_up_after_days=follow_up_after_days,
            follow_up_templates=follow_up_templates,
        )
    return counts


async def distribute_arms_round_robin(
    targets: list[dict],
    account_ids: list[str],
    arms: list[dict],
    delete_after_s: Optional[int] = None,
    campaign: str = "",
    group_name: str = "",
) -> dict[str, dict[str, int]]:
    """Split targets across BOTH accounts and arms round-robin.

    Each `arm` dict carries its own message strategy:
        {
            "name": "A",
            "primary_templates": ["..."],         # template mode
            "ai_style": "Friendly, casual...",    # OR AI mode (mutually exclusive)
            "follow_up_after_days": 3,            # optional
            "follow_up_templates": ["..."],       # optional
        }

    Target i is assigned to account ``account_ids[i % len(account_ids)]``
    and arm ``arms[i % len(arms)]`` — so with N accounts and M arms, the
    work is spread evenly across all N×M (account, arm) pairs and each
    arm sees roughly the same target count, regardless of N or M.

    For arms in **AI mode** (``ai_style`` set), we pre-generate one
    custom opener per target via OpenAI BEFORE enqueueing. Each target's
    queue item gets ``templates: [<that target's opener>]``, so the
    worker hot path stays template-driven and unchanged. ``group_name``
    is passed through to the AI as conversation context.

    Returns ``{account_id: {arm_name: enqueued_count}}``.
    """
    if not account_ids:
        raise ValueError("account_ids must not be empty")
    if not arms:
        raise ValueError("arms must not be empty")

    # Bucket targets by (account_id, arm_index).
    buckets: dict[tuple[str, int], list[dict]] = {
        (aid, ai): [] for aid in account_ids for ai in range(len(arms))
    }
    for i, t in enumerate(targets):
        aid = account_ids[i % len(account_ids)]
        ai = i % len(arms)
        buckets[(aid, ai)].append(t)

    # AI mode: pre-generate openers per (arm_index → list[opener]) so each
    # target gets a unique line. We do this once per arm across ALL its
    # buckets so a target's opener doesn't depend on which account drew it.
    # Map: arm_index -> {target_user_id -> opener_text}
    ai_opener_by_arm: dict[int, dict[int, str]] = {}
    for ai, arm in enumerate(arms):
        style = (arm.get("ai_style") or "").strip()
        if not style:
            continue
        # Collect every target across all account buckets for this arm.
        arm_targets: list[dict] = []
        for aid in account_ids:
            arm_targets.extend(buckets[(aid, ai)])
        if not arm_targets:
            continue
        from ai_openers import generate_openers_for_targets

        openers = await generate_openers_for_targets(
            arm_targets, group_name=group_name, style=style
        )
        # Index by user_id for O(1) lookup when we re-walk the buckets.
        ai_opener_by_arm[ai] = {
            int(t["user_id"]): openers[i]
            for i, t in enumerate(arm_targets)
            if t.get("user_id")
        }

    counts: dict[str, dict[str, int]] = {aid: {} for aid in account_ids}
    for (aid, ai), subset in buckets.items():
        arm = arms[ai]
        arm_name = arm.get("name") or chr(ord("A") + ai)
        if not subset:
            counts[aid][arm_name] = 0
            continue

        if ai in ai_opener_by_arm:
            # AI mode — enqueue each target individually with its custom
            # opener as the (only) template. We can't batch because each
            # target gets different copy.
            opener_map = ai_opener_by_arm[ai]
            total = 0
            for t in subset:
                uid = t.get("user_id")
                if not uid:
                    continue
                opener = opener_map.get(int(uid))
                if not opener:
                    continue
                total += await enqueue(
                    aid,
                    [t],
                    [opener],
                    delete_after_s,
                    campaign,
                    follow_up_after_days=arm.get("follow_up_after_days"),
                    follow_up_templates=arm.get("follow_up_templates") or [],
                    arm=arm_name,
                )
            counts[aid][arm_name] = total
        else:
            # Template mode — single enqueue call with the shared template list.
            primary_templates = arm.get("primary_templates") or []
            if not primary_templates:
                counts[aid][arm_name] = 0
                continue
            counts[aid][arm_name] = await enqueue(
                aid,
                subset,
                primary_templates,
                delete_after_s,
                campaign,
                follow_up_after_days=arm.get("follow_up_after_days"),
                follow_up_templates=arm.get("follow_up_templates") or [],
                arm=arm_name,
            )
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


async def campaign_arm_stats(campaign: str) -> dict:
    """Compute per-arm send + reply counts for one campaign.

    Joins ``sent_log.json`` (filtered to status='sent', kind='primary') with
    ``replies.json`` on (account_id, target_user_id). A reply only counts if
    we actually reached the target with a primary DM under this campaign +
    arm — followup replies pile on the primary they answered.

    Returns a dict shaped:
        {
            "campaign": "...",
            "arms": [
                {"name": "A", "sent": 50, "replied": 4, "reply_rate": 0.08},
                {"name": "B", "sent": 50, "replied": 7, "reply_rate": 0.14},
            ],
            "winner": "B" | null,        # arm with highest rate (None if tie / no data)
            "total_sent": 100,
            "total_replied": 11,
        }
    """
    from reply_watcher import _load_replies  # local import — avoid module cycle

    async with _sent_log_lock:
        log = _load_sent_log()

    # (account_id, target_user_id) -> arm name. Keep only primary sends so
    # a reply is attributed to the arm that actually opened the conversation.
    primary_arm: dict[tuple[str, int], str] = {}
    arm_sent: dict[str, int] = {}
    for e in log:
        if e.get("campaign") != campaign:
            continue
        if e.get("status") != "sent":
            continue
        if e.get("kind", "primary") != "primary":
            continue
        arm = e.get("arm", "A") or "A"
        try:
            uid = int(e.get("target_user_id") or 0)
        except (TypeError, ValueError):
            continue
        aid = e.get("account_id") or ""
        if not uid or not aid:
            continue
        # First primary send wins if a target somehow got DM'd twice.
        primary_arm.setdefault((aid, uid), arm)
        arm_sent[arm] = arm_sent.get(arm, 0) + 1

    arm_replied: dict[str, set[int]] = {}
    if primary_arm:
        replies = _load_replies()
        for r in replies:
            aid = r.get("account_id") or ""
            try:
                uid = int(r.get("sender_user_id") or 0)
            except (TypeError, ValueError):
                continue
            if not uid or not aid:
                continue
            arm = primary_arm.get((aid, uid))
            if arm is None:
                continue
            # Dedupe: one reply-er counted once per arm even if they sent N msgs.
            arm_replied.setdefault(arm, set()).add(uid)

    arm_names = sorted(arm_sent.keys())
    arms_out: list[dict] = []
    best_rate = -1.0
    best_arm: Optional[str] = None
    tie = False
    for name in arm_names:
        sent = arm_sent.get(name, 0)
        replied = len(arm_replied.get(name, set()))
        rate = (replied / sent) if sent > 0 else 0.0
        arms_out.append(
            {
                "name": name,
                "sent": sent,
                "replied": replied,
                "reply_rate": round(rate, 4),
            }
        )
        if sent > 0:
            if rate > best_rate:
                best_rate = rate
                best_arm = name
                tie = False
            elif rate == best_rate:
                tie = True

    return {
        "campaign": campaign,
        "arms": arms_out,
        "winner": None if (tie or best_arm is None or best_rate <= 0) else best_arm,
        "total_sent": sum(arm_sent.values()),
        "total_replied": sum(len(v) for v in arm_replied.values()),
    }


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
    """Return the next item whose ``scheduled_at`` is in the past.

    Items with ``scheduled_at`` in the future (e.g. follow-ups waiting their
    delay) stay in the queue. We scan from the front and pop the first
    eligible one — preserves FIFO ordering among ready items.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    async with _queue_lock:
        q = _load_queue()
        items = q.get(account_id, [])
        if not items:
            return None
        for idx, it in enumerate(items):
            sched = it.get("scheduled_at") or it.get("enqueued_at") or now_iso
            if sched <= now_iso:
                # Eligible — pop it.
                popped = items.pop(idx)
                q[account_id] = items
                _save_queue(q)
                return popped
        # Nothing ready yet (everything is a future-scheduled follow-up).
        return None


async def _requeue_item(account_id: str, item: dict) -> None:
    async with _queue_lock:
        q = _load_queue()
        q.setdefault(account_id, []).insert(0, item)
        _save_queue(q)


async def _enqueue_followup(account_id: str, primary_item: dict) -> None:
    """Schedule a follow-up DM for the same target N days from now.

    Called from ``_send_one`` after a primary send succeeds AND the
    primary's campaign config asked for a follow-up. The follow-up uses
    the campaign's ``follow_up_templates`` (a separate template set so
    the user can write different copy), and shares the same target name
    fields for placeholder rendering.
    """
    days = primary_item.get("follow_up_after_days")
    templates = primary_item.get("follow_up_templates") or []
    if not days or days <= 0 or not templates:
        return
    fire_at = (
        datetime.now(timezone.utc) + timedelta(days=int(days))
    ).isoformat()
    item = {
        "target_user_id": primary_item["target_user_id"],
        "target_username": primary_item.get("target_username", ""),
        "target_first_name": primary_item.get("target_first_name", ""),
        "target_last_name": primary_item.get("target_last_name", ""),
        "templates": templates,
        "delete_after_s": primary_item.get("delete_after_s"),
        "campaign": primary_item.get("campaign", ""),
        "arm": primary_item.get("arm", "A"),
        "kind": "followup",
        "scheduled_at": fire_at,
        # Follow-ups don't trigger another follow-up.
        "follow_up_after_days": None,
        "follow_up_templates": [],
        "enqueued_at": datetime.now(timezone.utc).isoformat(),
        "attempts": 0,
    }
    async with _queue_lock:
        q = _load_queue()
        q.setdefault(account_id, []).append(item)
        _save_queue(q)
    logger.info(
        f"[{account_id}] scheduled follow-up to "
        f"{item['target_user_id']} for {fire_at}"
    )


async def _send_one(account_id: str, item: dict) -> dict:
    """Send one DM. Returns a sent-log entry."""
    account = await _get_account_snapshot(account_id)
    if account is None:
        return {
            "account_id": account_id,
            "target_user_id": item["target_user_id"],
            "campaign": item.get("campaign", ""),
            "arm": item.get("arm", "A"),
            "status": "error",
            "reason": "account record vanished",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # Defence in depth: if this is a follow-up but the recipient already
    # replied (e.g. while the backend was offline and the live handler
    # missed it), don't nudge them. Skip cleanly.
    if item.get("kind") == "followup":
        try:
            from reply_watcher import reply_count_for

            if reply_count_for(account_id, int(item["target_user_id"])) > 0:
                return {
                    "account_id": account_id,
                    "target_user_id": item["target_user_id"],
                    "target_username": item.get("target_username", ""),
                    "campaign": item.get("campaign", ""),
                    "arm": item.get("arm", "A"),
                    "kind": "followup",
                    "status": "skipped",
                    "reason": "recipient already replied — follow-up cancelled",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
        except Exception:
            pass  # don't block the send on a check failure

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
            "arm": item.get("arm", "A"),
            "status": "error",
            "reason": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        await _atomic_mark_error(account_id, f"client_connect: {e}")
        # Unknown connect error — requeue + rethrow so the worker logs it.
        await _requeue_item(account_id, item)
        raise

    # Resolve peer. Telegram needs the recipient's `access_hash` to route a
    # DM to a stranger; the user_id alone returns PeerIdInvalidError. The
    # @username path bypasses this — Telethon resolves the username server-
    # side. For users without a public username we fall back to the cache
    # (only works if this client has seen the user before, which sender
    # accounts haven't), and the API call will skip cleanly if it can't.
    username = (item.get("target_username") or "").strip()
    if username:
        target = username if username.startswith("@") else f"@{username}"
        peer = target  # type: ignore[assignment]
    else:
        peer = InputPeerUser(item["target_user_id"], 0)

    try:
        sent = await client.send_message(peer, message)
    except BaseException as e:
        outcome = classify(e)
        # Only write to the account's last_error when the ACCOUNT itself is
        # affected (paused / banned). Target-specific skips (privacy
        # restricted, peer-id invalid, blocked, deactivated, etc.) belong
        # in sent_log.json — not on the per-account row, where they make
        # a healthy account look broken.
        if outcome.ban_account or outcome.pause_account_s:
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
            "arm": item.get("arm", "A"),
            "status": "skipped" if outcome.skip_target else "paused",
            "reason": outcome.reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    await _atomic_mark_send(account_id)

    # Optional send-delete tactic: delete our copy of the sent message after N seconds.
    delete_after = item.get("delete_after_s")
    if delete_after and delete_after > 0:
        asyncio.create_task(_delete_later(client, peer, sent.id, delete_after))

    # Schedule a follow-up for this target if the campaign config asked for one.
    # Only primary items spawn follow-ups (the followup item itself has
    # follow_up_after_days=None / templates=[], so this is a no-op there).
    if item.get("kind", "primary") == "primary":
        await _enqueue_followup(account_id, item)

    return {
        "account_id": account_id,
        "target_user_id": item["target_user_id"],
        "target_username": item["target_username"],
        "campaign": item.get("campaign", ""),
        "arm": item.get("arm", "A"),
        "kind": item.get("kind", "primary"),
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
                elif entry["status"] == "skipped":
                    # Smaller delay after privacy-restricted / blocked /
                    # deactivated targets, so the worker doesn't burst
                    # through a queue of unreachable users in a few seconds.
                    delay = random.uniform(*SKIP_DELAY_RANGE_S)
                    logger.info(
                        f"[{account_id}] skipped -> {entry['target_user_id']}, "
                        f"sleeping {delay:.1f}s"
                    )
                    await asyncio.sleep(delay)
                # paused / error → no extra delay here; the loop's
                # top-of-iteration gates handle rate-limits + the error
                # handler may have already set _pause_until.

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
