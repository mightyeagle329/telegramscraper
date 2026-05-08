"""Phase 3 engagement bot — sheet-driven Telegram broadcasts.

Reads a Google Sheet your VA edits and posts each row to the configured
Telegram chat at its scheduled time. Uses the Telegram **Bot API** via
``python-telegram-bot`` — a separate surface from the user-account
MTProto used elsewhere in this repo, so the bot can post freely without
counting against any sender account's daily limit.

Sheet schema (the operator + VA fill these columns):

    | id  | content                            | scheduled_at         | type | image_url           |
    |-----|------------------------------------|----------------------|------|---------------------|
    | A1  | "🎰 Player @mike won $500 …"       | 2026-05-06 19:30 UTC | win  | https://…/spin.png  |
    | A2  | "Tournament starts in 1 hour"     | 2026-05-06 20:00 UTC | game |                     |
    | A3  | "Anyone playing tonight?"          | 2026-05-06 21:30 UTC | poll |                     |

Posted rows are marked with two columns the bot writes back:
``posted_at`` (ISO timestamp) and ``status`` ("posted" | "error: …").
The bot only ever picks up rows with empty `posted_at` AND a
`scheduled_at` <= now.

A local `bot_history.json` mirrors what was posted (id, content, time,
chat_id, telegram_message_id) so the dashboard has a fast queryable
audit trail without re-reading the sheet for every page load.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from telegram import Bot
from telegram.error import RetryAfter, TelegramError

from config import (
    ENGAGEMENT_BOT_CHAT_ID,
    ENGAGEMENT_BOT_SHEET_ID,
    ENGAGEMENT_BOT_SHEET_TAB,
    ENGAGEMENT_BOT_TOKEN,
)
from sheets import sheets_manager

logger = logging.getLogger(__name__)

# Local audit log of every successful post. Cap retention so the file
# doesn't grow unbounded across months of running.
HISTORY_FILE = "bot_history.json"
HISTORY_MAX = 5_000

# Posts within this many minutes of the cycle's "now" are eligible. Wider
# windows let the bot recover gracefully if the scheduler missed a tick
# (e.g. backend restart) — it'll catch up rather than skip.
DUE_LOOKBEHIND_MINUTES = 60

# Hard cap on posts per cycle so a stuffed sheet can't burst-publish 50
# messages in a row and look spammy.
MAX_POSTS_PER_CYCLE = 6

# Sleep between posts inside one cycle so we don't hit Telegram's
# bot-api rate limits (30 msg/sec global, ~1/sec per chat).
INTRA_CYCLE_DELAY_S = 3

_history_lock = asyncio.Lock()


# ---------- bot connectivity ----------


def is_configured() -> bool:
    """Cheap readiness check used by the API + lifespan.

    The bot needs a token + chat_id always. For the sheet, EITHER
    ENGAGEMENT_BOT_SHEET_ID is set (separate spreadsheet) OR the
    scraper's main spreadsheet is connected (we reuse it and just
    add a dedicated tab).
    """
    if not (ENGAGEMENT_BOT_TOKEN and ENGAGEMENT_BOT_CHAT_ID):
        return False
    if ENGAGEMENT_BOT_SHEET_ID:
        return True
    # Fall back to the main scraper spreadsheet if it's already open.
    return sheets_manager.spreadsheet is not None


_bot_instance: Optional[Bot] = None


def _bot() -> Bot:
    global _bot_instance
    if not ENGAGEMENT_BOT_TOKEN:
        raise RuntimeError(
            "ENGAGEMENT_BOT_TOKEN is not set. Register a bot via @BotFather, "
            "copy the token, and set ENGAGEMENT_BOT_TOKEN in backend/.env."
        )
    if _bot_instance is None:
        _bot_instance = Bot(token=ENGAGEMENT_BOT_TOKEN)
    return _bot_instance


async def get_bot_status() -> dict:
    """Return a quick health view for the dashboard."""
    if not is_configured():
        missing = []
        if not ENGAGEMENT_BOT_TOKEN:
            missing.append("ENGAGEMENT_BOT_TOKEN")
        if not ENGAGEMENT_BOT_CHAT_ID:
            missing.append("ENGAGEMENT_BOT_CHAT_ID")
        if not ENGAGEMENT_BOT_SHEET_ID and sheets_manager.spreadsheet is None:
            missing.append("ENGAGEMENT_BOT_SHEET_ID (or connect main Google Sheet)")
        return {
            "configured": False,
            "missing": missing,
            "tab": ENGAGEMENT_BOT_SHEET_TAB,
        }
    sheet_id = ENGAGEMENT_BOT_SHEET_ID or "(reusing main scraper sheet)"
    try:
        info = await _bot().get_me()
        return {
            "configured": True,
            "bot_username": info.username,
            "bot_name": info.full_name,
            "chat_id": ENGAGEMENT_BOT_CHAT_ID,
            "sheet_id": sheet_id,
            "tab": ENGAGEMENT_BOT_SHEET_TAB,
        }
    except Exception as e:
        return {
            "configured": True,
            "error": f"{type(e).__name__}: {e}",
            "chat_id": ENGAGEMENT_BOT_CHAT_ID,
            "sheet_id": sheet_id,
            "tab": ENGAGEMENT_BOT_SHEET_TAB,
        }


# ---------- sheet integration ----------


def _get_sheet():
    """Open the engagement-bot spreadsheet's posts tab.

    Reuses the existing gspread auth from sheets_manager. If
    ENGAGEMENT_BOT_SHEET_ID is set we open that workbook by key
    (separate spreadsheet flow). Otherwise we reuse the scraper's
    main spreadsheet (same workbook, dedicated tab) — the simpler
    setup for operators who want to keep everything in one place.
    """
    if sheets_manager.client is None:
        sheets_manager.connect()
    if ENGAGEMENT_BOT_SHEET_ID:
        sheet = sheets_manager.client.open_by_key(ENGAGEMENT_BOT_SHEET_ID)
    else:
        if sheets_manager.spreadsheet is None:
            raise RuntimeError(
                "Main scraper spreadsheet is not connected and "
                "ENGAGEMENT_BOT_SHEET_ID is not set."
            )
        sheet = sheets_manager.spreadsheet
    try:
        ws = sheet.worksheet(ENGAGEMENT_BOT_SHEET_TAB)
    except Exception:
        # Auto-create the tab + header on first run so the operator
        # doesn't have to remember the column names.
        ws = sheet.add_worksheet(title=ENGAGEMENT_BOT_SHEET_TAB, rows=200, cols=8)
        ws.append_row(
            [
                "id",
                "content",
                "scheduled_at",
                "type",
                "image_url",
                "chat_id",
                "posted_at",
                "status",
            ]
        )
    return ws


def _parse_when(raw: str) -> Optional[datetime]:
    if not raw:
        return None
    raw = str(raw).strip()
    # Accept "2026-05-06 19:30 UTC" / "2026-05-06T19:30:00+00:00" / iso variants.
    raw = raw.replace("Z", "+00:00").replace(" UTC", "+00:00")
    # If user wrote "2026-05-06 19:30", treat as UTC (no tz).
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def list_queue() -> list[dict]:
    """Pull the entire current sheet contents (queued + posted + errored)
    so the dashboard can show what's coming up + what's been done."""
    if not is_configured():
        return []
    try:
        ws = _get_sheet()
        rows = ws.get_all_records()
    except Exception as e:
        logger.error(f"Could not read engagement bot sheet: {e}")
        return []
    out = []
    for i, r in enumerate(rows, start=2):  # row 1 is header
        out.append(
            {
                "row": i,
                "id": str(r.get("id") or "").strip(),
                "content": str(r.get("content") or ""),
                "scheduled_at": str(r.get("scheduled_at") or "").strip(),
                "type": str(r.get("type") or "").strip(),
                "image_url": str(r.get("image_url") or "").strip(),
                "chat_id": str(r.get("chat_id") or "").strip(),
                "posted_at": str(r.get("posted_at") or "").strip(),
                "status": str(r.get("status") or "").strip(),
            }
        )
    return out


def _column_index(header_row: list[str], name: str) -> int:
    """1-indexed column number for a header name; 0 if not found."""
    for i, h in enumerate(header_row, start=1):
        if str(h).strip().lower() == name.strip().lower():
            return i
    return 0


# Status sentinel used by the AI writer to drop posts into a "pending VA
# review" state. The posting cycle skips these — only manual approval
# (clear status) or explicit "approved" lets them publish. Empty status
# also publishes (legacy behaviour for human-edited rows).
PENDING_REVIEW_STATUS = "pending_review"
APPROVED_STATUS = "approved"


def _publishable_status(status: str) -> bool:
    """True if a row's status allows the bot to publish it.

    Empty (untouched human rows + legacy AI rows) and 'approved' are
    publishable. 'pending_review' explicitly is NOT — that row needs VA
    approval first. Anything else (a post-result string, an error
    string) means already handled — skip.
    """
    s = (status or "").strip().lower()
    return s == "" or s == APPROVED_STATUS


# ---------- post CRUD (used by the dashboard's compose/bulk/edit/delete) ----------


def _next_post_id(prefix: str = "post") -> str:
    """Generate a sortable, unique-ish row id for new posts."""
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')}"


def add_post(
    content: str,
    scheduled_at: str,
    post_type: str = "win",
    image_url: str = "",
    chat_id: str = "",
    status: str = "",
) -> dict:
    """Append a single new post row to the sheet.

    Returns the row dict (including the auto-assigned `id` and 1-indexed
    `row` number) so the caller can show "added at row N" feedback.
    Raises RuntimeError on sheet failure.
    """
    if not is_configured():
        raise RuntimeError("Engagement bot is not configured")
    if not (content or "").strip():
        raise ValueError("content is required")
    parsed = _parse_when(scheduled_at)
    if parsed is None:
        raise ValueError(f"could not parse scheduled_at: {scheduled_at!r}")
    ws = _get_sheet()
    post_id = _next_post_id("post")
    ws.append_row(
        [
            post_id,
            content,
            parsed.replace(microsecond=0).isoformat(),
            (post_type or "").strip().lower() or "win",
            image_url or "",
            chat_id or "",
            "",                  # posted_at — bot fills on publish
            status or "",        # default empty = publishable on schedule
        ]
    )
    # gspread doesn't return the appended row index — count rows.
    row_idx = len(ws.get_all_values())
    return {
        "row": row_idx,
        "id": post_id,
        "content": content,
        "scheduled_at": parsed.replace(microsecond=0).isoformat(),
        "type": (post_type or "win"),
        "image_url": image_url,
        "chat_id": chat_id,
        "posted_at": "",
        "status": status or "",
    }


def update_post(row_idx: int, patch: dict) -> dict:
    """Update one or more fields on a row. Returns the updated row.

    Refuses to update rows that have already been posted (`posted_at` set).
    """
    if not is_configured():
        raise RuntimeError("Engagement bot is not configured")
    ws = _get_sheet()
    header = ws.row_values(1)
    rows = ws.get_all_values()
    if row_idx < 2 or row_idx > len(rows):
        raise ValueError(f"row {row_idx} out of range")
    current = dict(zip(header, rows[row_idx - 1]))
    if (current.get("posted_at") or "").strip():
        raise ValueError("row has already been posted; cannot update")

    if "content" in patch:
        c = ws.cell(row_idx, _column_index(header, "content"))
        if c.col:
            ws.update_cell(row_idx, c.col, str(patch["content"] or ""))
    if "scheduled_at" in patch:
        parsed = _parse_when(str(patch["scheduled_at"] or ""))
        if parsed is None:
            raise ValueError(f"could not parse scheduled_at: {patch['scheduled_at']!r}")
        col = _column_index(header, "scheduled_at")
        if col:
            ws.update_cell(row_idx, col, parsed.replace(microsecond=0).isoformat())
    if "type" in patch:
        col = _column_index(header, "type")
        if col:
            ws.update_cell(row_idx, col, str(patch["type"] or "").strip().lower() or "win")
    if "image_url" in patch:
        col = _column_index(header, "image_url")
        if col:
            ws.update_cell(row_idx, col, str(patch["image_url"] or ""))
    if "status" in patch:
        col = _column_index(header, "status")
        if col:
            ws.update_cell(row_idx, col, str(patch["status"] or ""))

    # Re-read so the response is the canonical state.
    rows = ws.get_all_values()
    fresh = dict(zip(header, rows[row_idx - 1]))
    return {
        "row": row_idx,
        "id": fresh.get("id", ""),
        "content": fresh.get("content", ""),
        "scheduled_at": fresh.get("scheduled_at", ""),
        "type": fresh.get("type", ""),
        "image_url": fresh.get("image_url", ""),
        "chat_id": fresh.get("chat_id", ""),
        "posted_at": fresh.get("posted_at", ""),
        "status": fresh.get("status", ""),
    }


def delete_post(row_idx: int) -> bool:
    """Delete a row by its 1-indexed sheet row number. Returns True on success."""
    if not is_configured():
        raise RuntimeError("Engagement bot is not configured")
    ws = _get_sheet()
    if row_idx < 2:
        raise ValueError(f"row {row_idx} is the header — refusing to delete")
    try:
        ws.delete_rows(row_idx)
        return True
    except Exception as e:
        logger.warning(f"delete_post({row_idx}) failed: {e}")
        return False


def approve_post(row_idx: int) -> dict:
    """Mark a row's status as 'approved' so the next publish cycle picks it up.

    Used by the VA dashboard to greenlight an AI-generated row. Equivalent
    to clearing the status field — both are publishable — but storing
    'approved' explicitly lets us audit what the VA reviewed vs what was
    auto-published.
    """
    return update_post(row_idx, {"status": APPROVED_STATUS})


def bulk_add_posts(
    items: list[dict],
    spread_days: int = 1,
    posts_per_day: Optional[int] = None,
    start_at: Optional[datetime] = None,
    pending_review: bool = False,
) -> list[dict]:
    """Append many posts at once, time-distributed across the active window.

    `items` is a list of dicts each with at least `content` and optional
    `type` / `image_url`. Times get auto-assigned by spreading evenly
    across the writer's configured active window over `spread_days` days.

    `pending_review=True` marks every appended row as pending VA review —
    useful when the operator imports a batch they want to QA before
    going live.
    """
    if not is_configured():
        raise RuntimeError("Engagement bot is not configured")
    if not items:
        return []
    # Reuse the AI writer's schedule helper so the same active-window /
    # jitter logic applies to bulk imports.
    from ai_engagement_writer import _pick_schedule_times, load_config as load_writer_cfg

    cfg = load_writer_cfg()
    spread_days = max(1, int(spread_days))
    n = len(items)
    if posts_per_day:
        per_day = int(posts_per_day)
    else:
        per_day = max(1, (n + spread_days - 1) // spread_days)

    schedule: list[datetime] = []
    base_now = start_at or datetime.now(timezone.utc)
    cursor = 0
    for d in range(spread_days):
        if cursor >= n:
            break
        # Slot up to per_day items in this day's window.
        day_count = min(per_day, n - cursor)
        # Compute that day's start by offsetting the writer cfg by d days.
        # _pick_schedule_times always schedules in the FUTURE relative to
        # "now", so we manually shift.
        shifted_cfg = dict(cfg)
        # _pick_schedule_times derives the window from cfg + datetime.now;
        # by adjusting our perspective, we let it return tomorrow / day-after etc.
        times_today = _pick_schedule_times(day_count, shifted_cfg)
        # Push each time forward by d days from today.
        offset = timedelta(days=d)
        for t in times_today:
            schedule.append(t + offset)
        cursor += day_count

    out: list[dict] = []
    status = PENDING_REVIEW_STATUS if pending_review else ""
    for i, item in enumerate(items[: len(schedule)]):
        sched = schedule[i]
        try:
            row = add_post(
                content=str(item.get("content") or ""),
                scheduled_at=sched.replace(microsecond=0).isoformat(),
                post_type=str(item.get("type") or "win"),
                image_url=str(item.get("image_url") or ""),
                chat_id=str(item.get("chat_id") or ""),
                status=status,
            )
            out.append(row)
        except Exception as e:
            logger.warning(f"bulk_add_posts: skipped item {i} ({e})")
    return out


async def _mark_row(row_idx: int, posted_at: str, status: str) -> None:
    """Write back the posted_at + status for one row."""
    try:
        ws = _get_sheet()
        header = ws.row_values(1)
        c_posted = _column_index(header, "posted_at")
        c_status = _column_index(header, "status")
        if c_posted:
            ws.update_cell(row_idx, c_posted, posted_at)
        if c_status:
            ws.update_cell(row_idx, c_status, status)
    except Exception as e:
        # Don't crash the cycle if the writeback fails — log and move on.
        # We still recorded the post in bot_history.json.
        logger.warning(
            f"engagement bot: row {row_idx} writeback failed: {type(e).__name__}: {e}"
        )


# ---------- history persistence ----------


def _load_history() -> list[dict]:
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, "r") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, IOError):
        return []


def _save_history(rows: list[dict]) -> None:
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump(rows[-HISTORY_MAX:], f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save bot_history.json: {e}")


async def _record_history(entry: dict) -> None:
    async with _history_lock:
        rows = _load_history()
        rows.append(entry)
        _save_history(rows)


def list_history(limit: int = 50) -> list[dict]:
    return _load_history()[-limit:]


# ---------- posting ----------


async def _post_one(row: dict) -> tuple[bool, str, Optional[int]]:
    """Send a single sheet row to Telegram. Returns (ok, status, message_id)."""
    chat_id = row.get("chat_id") or ENGAGEMENT_BOT_CHAT_ID
    text = row.get("content") or ""
    image_url = (row.get("image_url") or "").strip()
    if not text.strip() and not image_url:
        return False, "empty post — neither content nor image_url", None
    try:
        bot = _bot()
        if image_url:
            msg = await bot.send_photo(
                chat_id=chat_id,
                photo=image_url,
                caption=text or None,
            )
        else:
            msg = await bot.send_message(chat_id=chat_id, text=text)
        return True, "posted", msg.message_id
    except RetryAfter as e:
        # Telegram is asking us to back off. Surface the wait time so the
        # next cycle can retry — don't treat as a hard error.
        return False, f"RetryAfter: wait {int(e.retry_after)}s", None
    except TelegramError as e:
        return False, f"{type(e).__name__}: {e}", None
    except Exception as e:
        return False, f"{type(e).__name__}: {e}", None


async def post_now(row_idx: int) -> dict:
    """Force-post a specific sheet row immediately, regardless of scheduled_at.

    Used by the dashboard's "Post now" override. Still respects the
    posted_at gate — if the row already has a posted_at, refuses to
    re-post (avoids accidental duplicates).
    """
    if not is_configured():
        return {"ok": False, "error": "engagement bot not configured"}
    rows = list_queue()
    target = next((r for r in rows if r["row"] == row_idx), None)
    if target is None:
        return {"ok": False, "error": f"row {row_idx} not found"}
    if target.get("posted_at"):
        return {"ok": False, "error": "already posted"}
    ok, status, msg_id = await _post_one(target)
    posted_at = datetime.now(timezone.utc).isoformat() if ok else ""
    final_status = status if ok else f"error: {status}"
    await _mark_row(row_idx, posted_at, final_status)
    if ok:
        await _record_history(
            {
                "id": target.get("id"),
                "row": row_idx,
                "content": target.get("content"),
                "type": target.get("type"),
                "chat_id": target.get("chat_id") or ENGAGEMENT_BOT_CHAT_ID,
                "telegram_message_id": msg_id,
                "posted_at": posted_at,
                "manual": True,
            }
        )
    return {"ok": ok, "status": final_status, "row": row_idx, "message_id": msg_id}


async def run_cycle() -> dict:
    """Scheduler tick. Pulls every due row and posts up to MAX_POSTS_PER_CYCLE."""
    if not is_configured():
        return {"posted": 0, "skipped": 0, "skipped_reason": "not configured"}

    rows = list_queue()
    now = datetime.now(timezone.utc)
    due: list[dict] = []
    for r in rows:
        if r.get("posted_at"):
            continue  # already done
        # Phase 3 VA workflow: AI-generated rows land as pending_review and
        # only become publishable once the VA approves. Anything not in the
        # publishable set (empty or "approved") gets skipped this cycle.
        if not _publishable_status(r.get("status", "")):
            continue
        sched = _parse_when(r.get("scheduled_at"))
        if sched is None:
            continue  # no schedule = skip; operator must fill in
        if sched > now:
            continue  # not yet
        # Lookbehind: if scheduled_at is in the past but within N minutes,
        # we still post (catches up from missed ticks). Older than that —
        # skip; the operator should remove or reschedule.
        if (now - sched).total_seconds() > DUE_LOOKBEHIND_MINUTES * 60:
            await _mark_row(
                r["row"],
                "",
                f"skipped: scheduled_at older than {DUE_LOOKBEHIND_MINUTES}m",
            )
            continue
        due.append(r)

    due = due[:MAX_POSTS_PER_CYCLE]
    posted = 0
    errors = 0
    for r in due:
        ok, status, msg_id = await _post_one(r)
        posted_at = datetime.now(timezone.utc).isoformat() if ok else ""
        await _mark_row(r["row"], posted_at, status if ok else f"error: {status}")
        if ok:
            posted += 1
            await _record_history(
                {
                    "id": r.get("id"),
                    "row": r["row"],
                    "content": r.get("content"),
                    "type": r.get("type"),
                    "chat_id": r.get("chat_id") or ENGAGEMENT_BOT_CHAT_ID,
                    "telegram_message_id": msg_id,
                    "posted_at": posted_at,
                    "manual": False,
                }
            )
        else:
            errors += 1
        await asyncio.sleep(INTRA_CYCLE_DELAY_S)
    return {"posted": posted, "errors": errors, "considered": len(due)}
