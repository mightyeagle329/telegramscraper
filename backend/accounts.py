"""Per-account storage for the multi-account sender (Phase 1).

Each of the 10 Phase 1 accounts has its own record here: phone, proxy config,
Telethon session file path, warm-up progress, daily counters, and health status.

The primary scraping account (legacy `session.session` at the backend root) is
intentionally NOT stored here — scraping and sending roles stay isolated so
Telegram's anti-spam scoring doesn't conflate the two behaviors.

Storage format mirrors storage.py: a single JSON file written on every change.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

ACCOUNTS_FILE = "accounts.json"
SESSIONS_DIR = "sessions"


# Approved warm-up ladder (client-signed-off 2026-04-13).
# (max_day_inclusive, daily_DM_limit)
# Days 1-7: zero outreach — only normal-usage actions (join groups, read, react).
# Days 8+: ramp DMs gradually from 3/day to steady-state 50/day by day ~22.
WARMUP_LADDER: list[tuple[int, int]] = [
    (7, 0),
    (9, 3),
    (11, 5),
    (13, 10),
    (15, 15),
    (17, 20),
    (19, 30),
    (21, 40),
]
STEADY_DAILY_LIMIT = 50

# Valid status values.
STATUS_WARMING = "warming"
STATUS_ACTIVE = "active"
STATUS_PAUSED = "paused"
STATUS_BANNED = "banned"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_accounts() -> dict[str, Any]:
    """Load the accounts registry from disk."""
    if not os.path.exists(ACCOUNTS_FILE):
        return {}
    try:
        with open(ACCOUNTS_FILE, "r") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Could not load accounts file: {e}")
        return {}


def save_accounts(accounts: dict[str, Any]) -> None:
    """Persist the accounts registry to disk."""
    try:
        with open(ACCOUNTS_FILE, "w") as f:
            json.dump(accounts, f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save accounts file: {e}")


def next_account_id(accounts: dict[str, Any]) -> str:
    """Allocate the next sequential id: acc_001, acc_002, ..."""
    existing = [
        int(k.split("_", 1)[1])
        for k in accounts
        if k.startswith("acc_") and k.split("_", 1)[1].isdigit()
    ]
    n = max(existing, default=0) + 1
    return f"acc_{n:03d}"


def new_account_record(
    account_id: str,
    phone: str,
    proxy: Optional[dict] = None,
    api_id: Optional[int] = None,
    api_hash: Optional[str] = None,
    label: str = "",
) -> dict[str, Any]:
    """Build a fresh account record with warm-up defaults.

    `api_id` / `api_hash` can be left None to fall back to the shared
    TELEGRAM_API_ID / TELEGRAM_API_HASH from .env (recommended default for a
    first deployment; override per-account only if reputation rotation becomes
    necessary).
    """
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    return {
        "id": account_id,
        "label": label or account_id,
        "phone": phone,
        "api_id": api_id,
        "api_hash": api_hash,
        "session_file": os.path.join(SESSIONS_DIR, f"{account_id}.session"),
        "proxy": proxy,
        "status": STATUS_WARMING,
        "warmup_started_at": _now_iso(),
        "daily_sent": 0,
        "daily_reset_at": None,
        "total_sent": 0,
        "last_send_at": None,
        "last_error": None,
        "last_error_at": None,
        "created_at": _now_iso(),
        "health": {
            "connected": False,
            "last_check_at": None,
            "restricted": False,
        },
    }


def daily_limit_for(warmup_started_at: Optional[str]) -> int:
    """Compute today's DM limit from warm-up progress (approved curve).

    Day 1 = the calendar day `warmup_started_at` landed on.
    """
    if not warmup_started_at:
        return 0
    try:
        start = datetime.fromisoformat(warmup_started_at)
    except ValueError:
        return 0
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    day = (datetime.now(timezone.utc) - start).days + 1
    for max_day, limit in WARMUP_LADDER:
        if day <= max_day:
            return limit
    return STEADY_DAILY_LIMIT


def reset_daily_counter_if_stale(account: dict[str, Any]) -> bool:
    """Zero `daily_sent` if we've crossed into a new UTC day. Returns True on reset."""
    now = datetime.now(timezone.utc)
    last = account.get("daily_reset_at")
    last_day = None
    if last:
        try:
            last_day = datetime.fromisoformat(last).date()
        except ValueError:
            pass
    if last_day != now.date():
        account["daily_sent"] = 0
        account["daily_reset_at"] = now.isoformat()
        return True
    return False


def can_send(account: dict[str, Any]) -> tuple[bool, str]:
    """Check whether an account is eligible to send a DM right now.

    Returns (ok, reason_if_not).
    """
    if account.get("status") in (STATUS_PAUSED, STATUS_BANNED):
        return False, f"account status is {account['status']}"
    reset_daily_counter_if_stale(account)
    limit = daily_limit_for(account.get("warmup_started_at"))
    if limit <= 0:
        return False, "still in warm-up (no DMs yet)"
    if account.get("daily_sent", 0) >= limit:
        return False, f"daily limit {limit} reached"
    return True, ""


def mark_send(account: dict[str, Any]) -> None:
    """Record that this account just sent a DM."""
    reset_daily_counter_if_stale(account)
    account["daily_sent"] = account.get("daily_sent", 0) + 1
    account["total_sent"] = account.get("total_sent", 0) + 1
    account["last_send_at"] = _now_iso()


def mark_error(account: dict[str, Any], error: str, pause: bool = False) -> None:
    """Record an error; optionally flip the account to `paused`."""
    account["last_error"] = error
    account["last_error_at"] = _now_iso()
    if pause:
        account["status"] = STATUS_PAUSED


def public_view(account: dict[str, Any]) -> dict[str, Any]:
    """Account dict returned by the API.

    This is a single-user / per-tenant dashboard, so the dashboard operator
    needs to see their own proxy credentials (to copy back into the wizard
    or to a provider console if they want to rotate). We include username
    and password here — the frontend keeps the password masked by default
    with an explicit reveal click.

    Still stripped: `api_hash` (not needed in the UI), session path.
    """
    proxy = account.get("proxy") or {}
    return {
        "id": account["id"],
        "label": account.get("label", account["id"]),
        "phone": account["phone"],
        "status": account.get("status"),
        "warmup_started_at": account.get("warmup_started_at"),
        "daily_limit": daily_limit_for(account.get("warmup_started_at")),
        "daily_sent": account.get("daily_sent", 0),
        "total_sent": account.get("total_sent", 0),
        "last_send_at": account.get("last_send_at"),
        "last_error": account.get("last_error"),
        "last_error_at": account.get("last_error_at"),
        "proxy_host": proxy.get("host"),
        "proxy_port": proxy.get("port"),
        "proxy_type": proxy.get("type"),
        "proxy_username": proxy.get("username"),
        "proxy_password": proxy.get("password"),
        "health": account.get("health", {}),
    }
