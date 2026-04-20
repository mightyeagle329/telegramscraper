"""Account warm-up worker.

Phase 1 accounts begin in status 'warming' with a 7-day zero-DM runway.
During that runway we simulate normal human activity so Telegram's anti-spam
model ingests a "real user" behavioral baseline before any cold outreach:

  - Join a small number of public groups/channels per day (configured list).
  - Read recent messages in those groups (a plain ``iter_messages`` pass is
    enough — it registers the account as actively consuming the feed).
  - Occasionally react to posts with harmless reactions.

After day 7 the daily-limit ladder in ``accounts.daily_limit_for`` opens up
and the sender worker begins pushing DMs; warm-up activity keeps running
in parallel to preserve the "normal user" signal during the ramp.

Warm-up groups are read from ``warmup_groups.json`` — a list of ``t.me``
links seeded by the operator (public, safe, low-controversy). If the file
is missing or empty, warm-up activity is skipped but the account still
ages through the ladder (time alone helps).
"""

import asyncio
import json
import logging
import os
import random
from datetime import datetime, timezone
from typing import Optional

from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    InviteHashExpiredError,
    UserAlreadyParticipantError,
)
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import (
    CheckChatInviteRequest,
    ImportChatInviteRequest,
    SendReactionRequest,
)
from telethon.tl.types import ReactionEmoji

from accounts import STATUS_BANNED, load_accounts, mark_error, save_accounts
from client_pool import get_account_client

logger = logging.getLogger(__name__)

WARMUP_GROUPS_FILE = "warmup_groups.json"

# How many groups each warming account tries to join per daily pass.
JOINS_PER_DAY = 3
# How many messages we scan per joined group to register a "read" signal.
READ_MESSAGES_PER_GROUP = 20
# Probability of dropping a reaction on any given read message.
REACTION_PROBABILITY = 0.08

# Harmless reaction palette.
SAFE_REACTIONS = ["👍", "❤️", "🔥", "👏", "😁"]

# One run per account per calendar day — tracked in memory so restarts don't
# re-run warm-up unnecessarily within the same day.
_last_run_day: dict[str, str] = {}


def _load_warmup_groups() -> list[str]:
    if not os.path.exists(WARMUP_GROUPS_FILE):
        return []
    try:
        with open(WARMUP_GROUPS_FILE, "r") as f:
            data = json.load(f)
            if isinstance(data, list):
                return [str(x).strip() for x in data if x]
            return []
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Could not load warmup groups: {e}")
        return []


def save_warmup_groups(urls: list[str]) -> None:
    with open(WARMUP_GROUPS_FILE, "w") as f:
        json.dump(urls, f, indent=2)


def _today_key() -> str:
    return datetime.now(timezone.utc).date().isoformat()


async def _join_one(client, url: str) -> Optional[object]:
    """Best-effort join of a public group / channel / invite link. Returns entity or None."""
    url = url.strip()
    try:
        if "+" in url or "joinchat" in url or "invite=" in url:
            # Invite link — extract the hash and import.
            import re

            m = re.search(r"(?:joinchat/|invite=|\+)([A-Za-z0-9_-]+)", url)
            if not m:
                return None
            invite_hash = m.group(1)
            try:
                res = await client(ImportChatInviteRequest(invite_hash))
                return res.chats[0] if getattr(res, "chats", None) else None
            except UserAlreadyParticipantError:
                check = await client(CheckChatInviteRequest(invite_hash))
                return getattr(check, "chat", None)
            except InviteHashExpiredError:
                logger.warning(f"warmup invite expired: {url}")
                return None
        else:
            # Public link or @username.
            m = __import__("re").search(r"t\.me/([A-Za-z0-9_]+)", url)
            username = m.group(1) if m else url.lstrip("@")
            entity = await client.get_entity(username)
            try:
                await client(JoinChannelRequest(entity))
            except UserAlreadyParticipantError:
                pass
            return entity
    except ChannelPrivateError:
        logger.warning(f"warmup group is private / inaccessible: {url}")
        return None
    except FloodWaitError as e:
        logger.warning(f"warmup join hit FloodWait {e.seconds}s — sleeping")
        await asyncio.sleep(e.seconds + 1)
        return None
    except Exception as e:
        logger.warning(f"warmup join failed for {url}: {type(e).__name__}: {e}")
        return None


async def _read_and_react(client, entity) -> int:
    """Scan recent messages in `entity` and occasionally react. Returns messages seen."""
    seen = 0
    try:
        async for msg in client.iter_messages(entity, limit=READ_MESSAGES_PER_GROUP):
            seen += 1
            if msg is None or msg.id is None:
                continue
            if random.random() < REACTION_PROBABILITY:
                emoji = random.choice(SAFE_REACTIONS)
                try:
                    await client(
                        SendReactionRequest(
                            peer=entity,
                            msg_id=msg.id,
                            reaction=[ReactionEmoji(emoticon=emoji)],
                        )
                    )
                    await asyncio.sleep(random.uniform(2, 6))
                except FloodWaitError as e:
                    await asyncio.sleep(e.seconds + 1)
                except Exception as e:
                    # Reaction failures are minor — log and move on.
                    logger.debug(
                        f"reaction failed on {getattr(entity, 'id', '?')}/{msg.id}: {e}"
                    )
    except FloodWaitError as e:
        logger.warning(f"warmup read hit FloodWait {e.seconds}s — sleeping")
        await asyncio.sleep(e.seconds + 1)
    except Exception as e:
        logger.warning(f"warmup read failed: {type(e).__name__}: {e}")
    return seen


async def run_warmup_for_account(account: dict) -> dict:
    """Run one day's worth of warm-up activity for this account.

    Idempotent-per-day: if we already ran today for this account, returns
    ``{'skipped': 'already_ran_today'}``.
    """
    aid = account["id"]
    today = _today_key()
    if _last_run_day.get(aid) == today:
        return {"account_id": aid, "skipped": "already_ran_today"}
    if account.get("status") == STATUS_BANNED:
        return {"account_id": aid, "skipped": "banned"}

    urls = _load_warmup_groups()
    if not urls:
        _last_run_day[aid] = today
        return {"account_id": aid, "skipped": "no_warmup_groups_configured"}

    try:
        client = await get_account_client(account)
    except Exception as e:
        await _record_error(aid, f"warmup_connect: {e}")
        return {"account_id": aid, "error": str(e)}

    picks = random.sample(urls, k=min(JOINS_PER_DAY, len(urls)))
    joined = 0
    read_total = 0
    for url in picks:
        entity = await _join_one(client, url)
        if entity is None:
            continue
        joined += 1
        # Spread joins + reads across minutes so the pattern isn't bursty.
        await asyncio.sleep(random.uniform(30, 120))
        read_total += await _read_and_react(client, entity)

    _last_run_day[aid] = today
    return {
        "account_id": aid,
        "groups_targeted": len(picks),
        "groups_joined": joined,
        "messages_read": read_total,
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }


async def _record_error(account_id: str, reason: str) -> None:
    accounts = load_accounts()
    acct = accounts.get(account_id)
    if acct is None:
        return
    mark_error(acct, reason)
    save_accounts(accounts)


async def run_warmup_all() -> list[dict]:
    """Run warm-up for every non-banned account (sequentially so they don't share a proxy burst)."""
    accounts = load_accounts()
    results = []
    for aid, acct in accounts.items():
        if acct.get("status") == STATUS_BANNED:
            continue
        res = await run_warmup_for_account(acct)
        results.append(res)
    return results
