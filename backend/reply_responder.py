"""Auto-respond to first reply from a cold-DM'd contact.

When a recipient replies to one of our cold outreach DMs, this module:

  1. Classifies the reply sentiment in the same GPT call that drafts a
     response (cheap — single round-trip).
  2. If sentiment is positive or neutral, drafts a short, casual response
     that naturally pivots to the destination group invite link.
  3. Sends it from the **same sender account** that received the reply
     (so the conversation thread stays coherent in the recipient's
     Telegram client).
  4. Records the auto-response so we never fire twice for the same
     recipient — subsequent messages from them stay manual for the VA
     to handle in the dashboard.

Why one-shot per recipient: the FIRST reply is the conversion moment.
After it, the recipient is in conversation — auto-replying to every
message would feel obviously bot-like and would also burn the lead.
The human (or VA) handles ongoing conversation in Telegram.

Safety:

  - We add a 30-90s random delay before sending the auto-reply so the
    pattern looks human, not a millisecond-bot.
  - Banned accounts skip auto-reply entirely (they can't send anyway).
  - Accounts in flood-recovery still auto-reply (a 1:1 response to an
    engaged user is much safer than cold outreach, and skipping it
    means losing the conversion).
  - On any AI / network / Telethon failure, fall back to a configured
    template message containing the group link. Never silently drop a
    conversion opportunity.
"""

import asyncio
import json
import logging
import os
import random
import re
from datetime import datetime, timezone
from typing import Optional

from openai import AsyncOpenAI

from accounts import STATUS_BANNED, load_accounts
from config import (
    AUTO_REPLY_ENABLED,
    AUTO_REPLY_FALLBACK,
    AUTO_REPLY_GROUP_URL,
    AUTO_REPLY_STYLE,
    OPENAI_API_KEY,
    OPENAI_MODEL,
)

logger = logging.getLogger(__name__)

AUTO_RESPONSES_FILE = "auto_responses.json"

# Random delay before firing the auto-reply so we don't ship a
# millisecond-perfect bot response. 30-90s feels like "person saw the
# notification and replied" without being so slow the lead goes cold.
DELAY_RANGE_S = (30, 90)

# Cap on retained auto-response records on disk.
HISTORY_MAX = 5_000

_lock = asyncio.Lock()


# ---------- persistence ----------


def _load_history() -> list[dict]:
    if not os.path.exists(AUTO_RESPONSES_FILE):
        return []
    try:
        with open(AUTO_RESPONSES_FILE, "r") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, IOError):
        return []


def _save_history(rows: list[dict]) -> None:
    try:
        with open(AUTO_RESPONSES_FILE, "w") as f:
            json.dump(rows[-HISTORY_MAX:], f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save auto_responses.json: {e}")


def has_auto_responded(account_id: str, sender_user_id: int) -> bool:
    """True if we've already auto-responded to this recipient on this account."""
    sender_user_id = int(sender_user_id or 0)
    for r in _load_history():
        if (
            r.get("account_id") == account_id
            and int(r.get("recipient_user_id") or 0) == sender_user_id
        ):
            return True
    return False


async def _record(entry: dict) -> None:
    async with _lock:
        rows = _load_history()
        rows.append(entry)
        _save_history(rows)


def list_recent(limit: int = 50, account_id: Optional[str] = None) -> list[dict]:
    rows = _load_history()
    if account_id is not None:
        rows = [r for r in rows if r.get("account_id") == account_id]
    return rows[-limit:]


# ---------- AI drafting + sentiment classification ----------


_client: Optional[AsyncOpenAI] = None


def _get_client() -> AsyncOpenAI:
    global _client
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not set")
    if _client is None:
        _client = AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=30)
    return _client


SYSTEM_PROMPT = """You're responding on behalf of a sender to a stranger who just replied to a cold Telegram DM.

# Inputs you receive
- The original cold DM the sender wrote.
- The recipient's reply.
- The destination Telegram group URL the sender runs.
- Optional style notes from the sender.

# Your job — strict JSON output
Decide whether this reply is conversion-friendly, then either draft a response or signal SKIP.

Output ONLY a valid JSON object with this exact shape, no markdown fences, no commentary:

{"sentiment": "positive" | "neutral" | "negative", "response": "<the response message body, or empty string when skipping>"}

# Rules

## Sentiment
- "positive"  = the recipient seems interested, friendly, or curious.
- "neutral"   = generic acknowledgment ("ok", "hi", "what's up", a question back).
- "negative"  = annoyed, hostile, dismissive, asking to stop, complaint.

## Response
- If sentiment is "positive" or "neutral": write a SHORT (1-2 sentence) casual response that briefly acknowledges what they said and naturally pivots to inviting them to the destination group. Include the group URL verbatim. No salesy language, no "click here", no urgency. Sound like a real community member, not a marketer.
- If sentiment is "negative": set response to "" (empty string). We will skip sending.

## Voice
- Match the sender's style notes when given.
- Casual, lowercase OR sentence-case (vary naturally). No emoji unless style notes ask.
- Never invent personal details.

Output the JSON object only."""


def _build_user_prompt(
    original_dm: str,
    reply_text: str,
    group_url: str,
    style: str,
) -> str:
    return (
        f"Original cold DM the sender sent:\n{original_dm or '(unknown)'}\n\n"
        f"Recipient's reply:\n{reply_text}\n\n"
        f"Destination group URL: {group_url}\n\n"
        f"Style notes from the sender:\n{style or '(none)'}\n\n"
        f"Output the JSON object now."
    )


def _validate_response(text: str, group_url: str) -> Optional[str]:
    """Return None if the response is shippable; a reason string if not."""
    if not text or len(text.strip()) < 5:
        return "too short"
    if len(text) > 500:
        return "too long"
    if group_url and group_url not in text:
        return "missing group url"
    # Block the same urgency + guarantee patterns as the cold opener layer.
    blockers = [
        (r"\bact\s+now\b|\bhurry\s+up\b|\blast\s+chance\b", "urgency"),
        (r"\bguaranteed\s+win\b|100%\s+win", "guarantee"),
        (r"\{\w+\}", "placeholder leak"),
    ]
    for pat, label in blockers:
        if re.search(pat, text, re.I):
            return f"blocked: {label}"
    return None


def _strip_json_fences(raw: str) -> str:
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned


async def _draft_response(
    original_dm: str,
    reply_text: str,
    group_url: str,
    style: str,
) -> tuple[str, str]:
    """Return (sentiment, response_text). Empty response_text = skip."""
    client = _get_client()
    user_prompt = _build_user_prompt(original_dm, reply_text, group_url, style)
    resp = await client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=200,
        temperature=0.7,
        response_format={"type": "json_object"} if "gpt-4" in OPENAI_MODEL else None,
    )
    raw = resp.choices[0].message.content or ""
    try:
        parsed = json.loads(_strip_json_fences(raw))
    except json.JSONDecodeError:
        logger.warning(f"auto-reply: GPT returned non-JSON output: {raw!r}")
        return "neutral", ""
    sentiment = str(parsed.get("sentiment") or "neutral").lower()
    response = str(parsed.get("response") or "").strip()
    # Strip surrounding quotes the model sometimes adds.
    while (response.startswith('"') and response.endswith('"')) or (
        response.startswith("'") and response.endswith("'")
    ):
        response = response[1:-1].strip()
    return sentiment, response


def _fallback_response(group_url: str) -> str:
    """Used when AI generation fails (timeout, quota, bad JSON, etc.).
    Static message that still captures the conversion."""
    template = AUTO_REPLY_FALLBACK.strip() or (
        "Thanks for the reply! We run a community here — feel free to drop in: {url}"
    )
    return template.replace("{url}", group_url or "").strip()


# ---------- sending via Telethon ----------


def _find_original_dm(account_id: str, recipient_user_id: int) -> str:
    """Look up our cold DM text from sent_log so we can give GPT context."""
    from sender import _load_sent_log

    recipient_user_id = int(recipient_user_id or 0)
    for entry in reversed(_load_sent_log()):
        if (
            entry.get("account_id") == account_id
            and entry.get("status") == "sent"
            and int(entry.get("target_user_id") or 0) == recipient_user_id
        ):
            # We don't actually store the rendered message text in sent_log,
            # only the queue's template list. The campaign name is the best
            # cheap proxy for context. Good enough for GPT to draft from.
            return f"(campaign: {entry.get('campaign') or 'unknown'})"
    return ""


async def _send_via_account(account_id: str, recipient_user_id: int, text: str) -> Optional[int]:
    """Send `text` from `account_id`'s Telethon client to the recipient.

    Returns the Telegram message_id on success, None on failure. The
    Telethon client is the same one the reply_watcher's NewMessage
    handler is registered on — so it's already connected and ready.
    """
    from client_pool import get_account_client

    accounts = load_accounts()
    acct = accounts.get(account_id)
    if acct is None:
        logger.warning(f"auto-reply: account {account_id} not found")
        return None
    if acct.get("status") == STATUS_BANNED:
        logger.info(f"auto-reply: account {account_id} is banned, skipping")
        return None
    try:
        client = await get_account_client(acct)
        msg = await client.send_message(int(recipient_user_id), text)
        return int(msg.id) if msg is not None else None
    except Exception as e:
        logger.warning(
            f"auto-reply: send via {account_id} -> {recipient_user_id} failed: "
            f"{type(e).__name__}: {e}"
        )
        return None


# ---------- top-level entry point used by reply_watcher ----------


async def maybe_auto_respond(
    account_id: str,
    sender_user_id: int,
    sender_username: Optional[str],
    reply_text: str,
) -> None:
    """Called from reply_watcher.on_message after a reply lands.

    Idempotent + safe to await as a background task — never raises.
    """
    try:
        if not AUTO_REPLY_ENABLED:
            return
        if not AUTO_REPLY_GROUP_URL:
            logger.warning("auto-reply enabled but AUTO_REPLY_GROUP_URL is empty")
            return
        if has_auto_responded(account_id, sender_user_id):
            # Already replied once — subsequent messages stay manual.
            return

        # Human-like delay before responding.
        delay = random.uniform(*DELAY_RANGE_S)
        logger.info(
            f"auto-reply: {account_id} -> {sender_user_id} scheduled in {delay:.0f}s"
        )
        await asyncio.sleep(delay)

        # Defence in depth: someone else may have manually responded in
        # those 30-90s and recorded it, so re-check.
        if has_auto_responded(account_id, sender_user_id):
            return

        original = _find_original_dm(account_id, sender_user_id)
        sentiment = "neutral"
        response = ""
        if OPENAI_API_KEY:
            try:
                sentiment, response = await _draft_response(
                    original_dm=original,
                    reply_text=reply_text or "",
                    group_url=AUTO_REPLY_GROUP_URL,
                    style=AUTO_REPLY_STYLE,
                )
            except Exception as e:
                logger.warning(f"auto-reply: GPT draft failed, using fallback: {e}")
                response = _fallback_response(AUTO_REPLY_GROUP_URL)
        else:
            response = _fallback_response(AUTO_REPLY_GROUP_URL)

        if sentiment == "negative":
            logger.info(
                f"auto-reply: {account_id} -> {sender_user_id} skipped (negative sentiment)"
            )
            await _record(
                {
                    "account_id": account_id,
                    "recipient_user_id": int(sender_user_id),
                    "recipient_username": sender_username,
                    "sentiment": sentiment,
                    "skipped": True,
                    "skip_reason": "negative sentiment",
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            return

        # Validate; fall back to template if the AI output trips the filters.
        reason = _validate_response(response, AUTO_REPLY_GROUP_URL)
        if reason is not None:
            logger.info(
                f"auto-reply: AI response rejected ({reason}), using fallback"
            )
            response = _fallback_response(AUTO_REPLY_GROUP_URL)
            reason = _validate_response(response, AUTO_REPLY_GROUP_URL)
            if reason is not None:
                logger.warning(
                    f"auto-reply: fallback ALSO failed validation ({reason}), skipping"
                )
                await _record(
                    {
                        "account_id": account_id,
                        "recipient_user_id": int(sender_user_id),
                        "recipient_username": sender_username,
                        "sentiment": sentiment,
                        "skipped": True,
                        "skip_reason": f"validation: {reason}",
                        "recorded_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                return

        message_id = await _send_via_account(account_id, int(sender_user_id), response)
        await _record(
            {
                "account_id": account_id,
                "recipient_user_id": int(sender_user_id),
                "recipient_username": sender_username,
                "sentiment": sentiment,
                "response": response,
                "message_id": message_id,
                "skipped": message_id is None,
                "skip_reason": "send failed" if message_id is None else None,
                "recorded_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        if message_id:
            logger.info(
                f"auto-reply: {account_id} -> {sender_user_id} sent (msg {message_id})"
            )
    except Exception as e:
        # Never let an auto-reply failure crash the reply handler.
        logger.exception(f"auto-reply: top-level failure: {e}")


# ---------- backfill ----------


async def _delayed_auto_respond(
    account_id: str,
    sender_user_id: int,
    sender_username: Optional[str],
    reply_text: str,
    initial_delay: float,
) -> None:
    """Wrapper that adds an INITIAL delay before running maybe_auto_respond.
    Used by the backfill to stagger sends across an account's pile of
    old replies so we don't burst Telegram with 20 messages in 30s."""
    try:
        await asyncio.sleep(initial_delay)
        await maybe_auto_respond(
            account_id=account_id,
            sender_user_id=sender_user_id,
            sender_username=sender_username,
            reply_text=reply_text,
        )
    except Exception as e:
        logger.warning(f"backfill auto-respond failed: {e}")


async def backfill_auto_responses(since_hours: int = 168) -> dict:
    """Find every reply in the last `since_hours` hours that we haven't
    auto-responded to yet, then schedule auto-responses for each — staggered
    per account so a single account doesn't burst 20 messages in 30 seconds.

    Returns a summary: how many were queued, per account.

    Spreading strategy:
      - Group queued items by account_id.
      - Within each account, item N fires after N × (90-180s) on top of
        its own internal 30-90s delay from maybe_auto_respond.
      - All accounts fire in parallel.

    So if acc_001 has 5 backfill items, the last one goes out ~5 × 135s
    + 60s = ~12 minutes after the backfill is triggered. The recipient
    side just sees one organic-feeling message per conversation.
    """
    from collections import defaultdict
    from datetime import timedelta
    from reply_watcher import _load_replies

    cutoff = datetime.now(timezone.utc) - timedelta(hours=int(since_hours))
    replies = _load_replies()
    # Dedupe: if a recipient sent us 5 messages, we only want ONE backfill
    # auto-response, not 5. Pick the earliest message we'd reply to.
    seen: set[tuple[str, int]] = set()
    by_account: dict[str, list[dict]] = defaultdict(list)
    for r in replies:
        received_raw = r.get("received_at")
        if not isinstance(received_raw, str):
            continue
        try:
            received = datetime.fromisoformat(received_raw.replace("Z", "+00:00"))
            if received.tzinfo is None:
                received = received.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if received < cutoff:
            continue
        try:
            sender_user_id = int(r.get("sender_user_id") or 0)
        except (TypeError, ValueError):
            continue
        account_id = str(r.get("account_id") or "")
        if not account_id or not sender_user_id:
            continue
        key = (account_id, sender_user_id)
        if key in seen:
            continue
        if has_auto_responded(account_id, sender_user_id):
            continue
        seen.add(key)
        by_account[account_id].append(r)

    queued = 0
    for account_id, items in by_account.items():
        for i, r in enumerate(items):
            # First item per account: 30-90s (matches normal path).
            # Each subsequent item: +90-180s on top of the previous.
            stagger = i * random.uniform(90, 180)
            asyncio.create_task(
                _delayed_auto_respond(
                    account_id=account_id,
                    sender_user_id=int(r["sender_user_id"]),
                    sender_username=r.get("sender_username"),
                    reply_text=str(r.get("text") or ""),
                    initial_delay=stagger,
                )
            )
            queued += 1

    logger.info(
        f"auto-reply backfill: queued {queued} responses across "
        f"{len(by_account)} accounts (since_hours={since_hours})"
    )
    return {
        "queued": queued,
        "accounts": len(by_account),
        "per_account": {aid: len(items) for aid, items in by_account.items()},
        "since_hours": since_hours,
    }
