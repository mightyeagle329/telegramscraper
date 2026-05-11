"""Detect replies to our outbound DMs.

For every active sender account we register a Telethon ``NewMessage(incoming=True)``
handler. When a message arrives from a user we previously DM'd, we:

  1. Append a record to ``replies.json`` (audit trail + UI feed).
  2. Cancel any pending follow-up queue items targeting that user from the
     same account, so we don't keep nudging someone who already replied.

Handlers are registered ONCE per account at startup (and again whenever
the account's worker comes online via ``register_handler_for_account``).
Telethon keeps the handler attached across reconnects.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from telethon.events import NewMessage

from accounts import STATUS_BANNED, load_accounts
from client_pool import ProxyConnectionError, get_account_client

logger = logging.getLogger(__name__)

REPLIES_FILE = "replies.json"
SENT_LOG_FILE = "sent_log.json"
QUEUE_FILE = "queue.json"

REPLIES_MAX = 5_000  # rotate the audit log

_replies_lock = asyncio.Lock()
_queue_lock = asyncio.Lock()
# Track which accounts already have a handler installed so we don't double-register.
_installed: set[str] = set()


# ---------- replies.json ----------


def _load_replies() -> list[dict]:
    if not os.path.exists(REPLIES_FILE):
        return []
    try:
        with open(REPLIES_FILE, "r") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (json.JSONDecodeError, IOError):
        return []


def _save_replies(rows: list[dict]) -> None:
    try:
        with open(REPLIES_FILE, "w") as f:
            json.dump(rows[-REPLIES_MAX:], f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save replies.json: {e}")


async def _append_reply(reply: dict) -> None:
    async with _replies_lock:
        rows = _load_replies()
        rows.append(reply)
        _save_replies(rows)


# ---------- "did this account DM that user?" lookup ----------


def _has_dmd(account_id: str, sender_user_id: int) -> bool:
    """Quick check — was this user a target of a previous DM from this account?

    Reads ``sent_log.json``. The log is capped at SENT_LOG_MAX (10k) entries,
    so we only see "recently DM'd" — adequate for reply detection since
    most replies arrive within hours/days of the original send.
    """
    if not os.path.exists(SENT_LOG_FILE):
        return False
    try:
        with open(SENT_LOG_FILE, "r") as f:
            log = json.load(f)
    except (json.JSONDecodeError, IOError):
        return False
    if not isinstance(log, list):
        return False
    for entry in log:
        if (
            entry.get("account_id") == account_id
            and entry.get("status") == "sent"
            and int(entry.get("target_user_id") or 0) == sender_user_id
        ):
            return True
    return False


# ---------- cancel pending follow-ups when a reply lands ----------


async def _cancel_followups(account_id: str, sender_user_id: int) -> int:
    """Remove any pending follow-up items in the queue targeting this user.

    Doesn't touch primary items (those go out on first contact regardless).
    Returns the number of items cancelled.
    """
    async with _queue_lock:
        if not os.path.exists(QUEUE_FILE):
            return 0
        try:
            with open(QUEUE_FILE, "r") as f:
                queue = json.load(f)
        except (json.JSONDecodeError, IOError):
            return 0

        items = queue.get(account_id, [])
        before = len(items)
        kept = [
            it
            for it in items
            if not (
                it.get("kind") == "followup"
                and int(it.get("target_user_id") or 0) == sender_user_id
            )
        ]
        cancelled = before - len(kept)
        if cancelled > 0:
            queue[account_id] = kept
            try:
                with open(QUEUE_FILE, "w") as f:
                    json.dump(queue, f, indent=2, default=str)
            except IOError as e:
                logger.error(f"Could not save queue.json after cancel: {e}")
        return cancelled


# ---------- per-account handler registration ----------


def register_handler_for_account(account_id: str, client) -> bool:
    """Attach the NewMessage handler to a Telethon client. Idempotent."""
    if account_id in _installed:
        return False

    @client.on(NewMessage(incoming=True))
    async def on_message(event):
        try:
            sender_id = event.sender_id
            if not sender_id or sender_id == 0:
                return
            # Only count messages from users we DM'd from THIS account.
            if not _has_dmd(account_id, sender_id):
                return

            sender = event.message.sender
            text = event.message.message or ""
            reply = {
                "account_id": account_id,
                "sender_user_id": sender_id,
                "sender_username": getattr(sender, "username", None),
                "sender_first_name": getattr(sender, "first_name", None),
                "message_id": event.message.id,
                "text": text[:500],  # cap to keep replies.json small
                "received_at": datetime.now(timezone.utc).isoformat(),
            }
            await _append_reply(reply)
            cancelled = await _cancel_followups(account_id, sender_id)
            logger.info(
                f"[{account_id}] reply from {sender_id}"
                + (f", cancelled {cancelled} follow-up(s)" if cancelled else "")
            )
            # Phase 3 — fire-and-forget auto-response. Background task so
            # the reply handler returns immediately (auto-respond runs a
            # 30-90s human-like delay + GPT call before sending).
            try:
                import asyncio as _asyncio
                from reply_responder import maybe_auto_respond

                _asyncio.create_task(
                    maybe_auto_respond(
                        account_id=account_id,
                        sender_user_id=sender_id,
                        sender_username=getattr(sender, "username", None),
                        reply_text=text,
                    )
                )
            except Exception as e:
                logger.warning(f"[{account_id}] could not schedule auto-respond: {e}")
        except Exception as e:
            # Never let handler errors crash the Telethon update loop.
            logger.warning(
                f"[{account_id}] reply handler error: {type(e).__name__}: {e}"
            )

    _installed.add(account_id)
    logger.info(f"[{account_id}] reply handler installed")
    return True


async def install_for_all_accounts() -> dict[str, bool]:
    """Register handlers for every non-banned account. Called from main.py
    lifespan startup. Returns ``{account_id: installed?}``."""
    accounts = load_accounts()
    out: dict[str, bool] = {}
    for aid, acct in accounts.items():
        if acct.get("status") == STATUS_BANNED:
            out[aid] = False
            continue
        try:
            client = await get_account_client(acct)
            out[aid] = register_handler_for_account(aid, client)
        except ProxyConnectionError as e:
            logger.info(f"[{aid}] reply handler deferred ({e})")
            out[aid] = False
        except Exception as e:
            logger.warning(
                f"[{aid}] reply handler install failed: {type(e).__name__}: {e}"
            )
            out[aid] = False
    return out


# ---------- API helpers ----------


def list_recent_replies(limit: int = 50, account_id: Optional[str] = None) -> list[dict]:
    rows = _load_replies()
    if account_id is not None:
        rows = [r for r in rows if r.get("account_id") == account_id]
    return rows[-limit:]


def reply_count_for(account_id: str, target_user_id: int) -> int:
    """Has this target ever replied on this account? Used by sender to skip
    a follow-up that's about to be sent in case the reply was missed by the
    handler (defence in depth)."""
    rows = _load_replies()
    return sum(
        1
        for r in rows
        if r.get("account_id") == account_id
        and int(r.get("sender_user_id") or 0) == target_user_id
    )
