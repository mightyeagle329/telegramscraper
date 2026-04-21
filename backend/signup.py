"""Stateful web-based signup flow for new sender accounts.

Telegram's SMS sign-in is multi-step: connect → send code → enter code →
(optional) enter 2FA cloud password. Each step has to re-use the SAME
Telethon client instance — the auth state isn't transferable — so we keep
connected clients in memory, keyed by a short-lived ``signup_token``.

Pending signups are reaped after ``PENDING_TTL_S`` seconds so a user who
abandons the flow mid-way doesn't leak a TelegramClient + session file.

This module is the backing store for the Accounts dashboard's "Add
Account" wizard. The CLI ``add_account.py`` still works in parallel for
scripting / headless setups; they don't share state.
"""

import asyncio
import logging
import os
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from telethon import TelegramClient
from telethon.errors import (
    FloodWaitError,
    PasswordHashInvalidError,
    PhoneCodeEmptyError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberBannedError,
    PhoneNumberInvalidError,
    SessionPasswordNeededError,
)

from accounts import (
    load_accounts,
    new_account_record,
    next_account_id,
    public_view,
    save_accounts,
)
from client_pool import build_client

logger = logging.getLogger(__name__)

PENDING_TTL_S = 300  # 5 minutes


@dataclass
class _Pending:
    token: str
    phone: str
    label: str
    proxy: Optional[dict]
    api_id: Optional[int]
    api_hash: Optional[str]
    client: TelegramClient
    phone_code_hash: str
    session_file: str
    state: str = "awaiting_code"
    created_at: float = field(
        default_factory=lambda: datetime.now(timezone.utc).timestamp()
    )


_pending: dict[str, _Pending] = {}
_lock = asyncio.Lock()


def _now() -> float:
    return datetime.now(timezone.utc).timestamp()


def _delete_session_files(path: str) -> None:
    for p in (path, path + "-journal"):
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


async def _disconnect(pending: _Pending) -> None:
    try:
        await pending.client.disconnect()
    except Exception:
        pass


async def _drop(token: str, delete_session: bool = True) -> None:
    """Remove a pending slot, disconnect, optionally delete the session file."""
    pending = _pending.pop(token, None)
    if pending is None:
        return
    await _disconnect(pending)
    if delete_session:
        _delete_session_files(pending.session_file)


async def reap_expired() -> int:
    """Drop pending signups older than ``PENDING_TTL_S``. Returns the count."""
    now = _now()
    async with _lock:
        stale = [t for t, p in _pending.items() if now - p.created_at > PENDING_TTL_S]
    for t in stale:
        await _drop(t)
        logger.info(f"Reaped abandoned signup {t[:8]}…")
    return len(stale)


async def start_signup(
    phone: str,
    label: str,
    proxy: Optional[dict],
    api_id: Optional[int],
    api_hash: Optional[str],
) -> dict:
    """Kick off a new signup: validate, connect via proxy, request SMS code."""
    if not phone or not phone.startswith("+"):
        raise ValueError("Phone must be in E.164 format (e.g. +441234567890).")

    # Duplicate-phone guard — the dashboard mirrors the CLI's rule.
    accounts = load_accounts()
    for aid, acct in accounts.items():
        if acct.get("phone") == phone:
            raise ValueError(
                f"Phone {phone} is already registered as {aid} "
                f"(status={acct.get('status')}). Remove it first if you want to replace it."
            )

    token = secrets.token_urlsafe(24)
    session_file = os.path.join("sessions", f"pending_{token[:12]}.session")
    os.makedirs("sessions", exist_ok=True)

    # Build a minimal record shape build_client understands.
    temp_record = {
        "id": f"pending_{token[:12]}",
        "phone": phone,
        "session_file": session_file,
        "proxy": proxy,
        "api_id": api_id,
        "api_hash": api_hash,
    }

    try:
        client = build_client(temp_record)
    except ValueError as e:
        raise ValueError(str(e))

    try:
        await client.connect()
    except Exception as e:
        await _cleanup_client_and_file(client, session_file)
        raise ValueError(f"Could not connect to Telegram through the proxy: {e}")

    try:
        result = await client.send_code_request(phone)
    except FloodWaitError as e:
        await _cleanup_client_and_file(client, session_file)
        raise ValueError(
            f"Telegram rate limit — wait {e.seconds}s before retrying this phone."
        )
    except PhoneNumberInvalidError:
        await _cleanup_client_and_file(client, session_file)
        raise ValueError(f"Phone {phone!r} is not a valid Telegram number.")
    except PhoneNumberBannedError:
        await _cleanup_client_and_file(client, session_file)
        raise ValueError(f"Phone {phone!r} is banned by Telegram. Use a different number.")
    except Exception as e:
        await _cleanup_client_and_file(client, session_file)
        raise ValueError(f"send_code_request failed: {type(e).__name__}: {e}")

    pending = _Pending(
        token=token,
        phone=phone,
        label=label or "",
        proxy=proxy,
        api_id=api_id,
        api_hash=api_hash,
        client=client,
        phone_code_hash=result.phone_code_hash,
        session_file=session_file,
    )
    async with _lock:
        _pending[token] = pending

    logger.info(f"Signup started for {phone} (token={token[:8]}…)")
    return {
        "signup_token": token,
        "state": pending.state,
        "expires_in_s": PENDING_TTL_S,
    }


async def submit_code(token: str, code: str) -> dict:
    """Submit the SMS code. May require a 2FA password next."""
    pending = _pending.get(token)
    if pending is None:
        raise ValueError("Signup session not found or expired. Please start over.")

    try:
        await pending.client.sign_in(
            phone=pending.phone,
            code=code,
            phone_code_hash=pending.phone_code_hash,
        )
    except SessionPasswordNeededError:
        pending.state = "awaiting_password"
        return {"state": pending.state, "needs_password": True}
    except (PhoneCodeInvalidError, PhoneCodeEmptyError):
        raise ValueError("That SMS code is incorrect. Try again.")
    except PhoneCodeExpiredError:
        await _drop(token)
        raise ValueError("The SMS code expired. Please start signup again.")
    except FloodWaitError as e:
        await _drop(token)
        raise ValueError(f"Telegram rate limit — wait {e.seconds}s before retrying.")
    except Exception as e:
        await _drop(token)
        raise ValueError(f"sign_in failed: {type(e).__name__}: {e}")

    return await _finalize(pending)


async def submit_password(token: str, password: str) -> dict:
    """Submit the 2FA cloud password to complete signup."""
    pending = _pending.get(token)
    if pending is None:
        raise ValueError("Signup session not found or expired. Please start over.")
    if pending.state != "awaiting_password":
        raise ValueError("This signup is not waiting for a 2FA password.")

    try:
        await pending.client.sign_in(password=password)
    except PasswordHashInvalidError:
        raise ValueError("2FA password is incorrect. Try again.")
    except Exception as e:
        await _drop(token)
        raise ValueError(f"2FA sign_in failed: {type(e).__name__}: {e}")

    return await _finalize(pending)


async def _finalize(pending: _Pending) -> dict:
    """Persist the signed-in account and clean up the pending slot."""
    try:
        me = await pending.client.get_me()
        if me is None:
            raise RuntimeError("get_me() returned None after sign-in")
    except Exception as e:
        await _drop(pending.token)
        raise ValueError(f"Finalization failed: {e}")

    # Disconnect before renaming — Telethon sqlite session must not be open.
    await _disconnect(pending)

    async with _lock:
        accounts = load_accounts()
        aid = next_account_id(accounts)

        # Move the pending session file into its permanent home.
        target_session = os.path.join("sessions", f"{aid}.session")
        for ext in ("", "-journal"):
            src = pending.session_file + ext
            dst = target_session + ext
            if os.path.exists(src):
                try:
                    os.rename(src, dst)
                except OSError as e:
                    logger.warning(f"Could not rename {src} -> {dst}: {e}")

        record = new_account_record(
            account_id=aid,
            phone=pending.phone,
            proxy=pending.proxy,
            api_id=pending.api_id,
            api_hash=pending.api_hash,
            label=pending.label,
        )
        accounts[aid] = record
        save_accounts(accounts)

        _pending.pop(pending.token, None)

    # Auto-start the sender worker for this new account so the operator
    # doesn't have to click "Start all workers" after every signup. The
    # worker will idle during warm-up (can_send returns False until day 8)
    # but this guarantees it's ready the moment the daily limit opens.
    try:
        import sender  # local import to avoid a cycle at module load time

        sender.start_worker(aid)
    except Exception as e:
        logger.warning(f"[{aid}] could not auto-start sender worker: {e}")

    logger.info(f"[{aid}] signup complete ({pending.phone})")
    return {"state": "completed", "account": public_view(record)}


async def abandon(token: str) -> bool:
    """Cancel a pending signup (user closed the wizard, etc.)."""
    if token not in _pending:
        return False
    await _drop(token)
    return True


def list_pending() -> list[dict]:
    """Return a redacted snapshot of in-flight signups (debug view)."""
    now = _now()
    return [
        {
            "signup_token_prefix": p.token[:8] + "…",
            "phone": p.phone,
            "label": p.label,
            "state": p.state,
            "age_s": int(now - p.created_at),
        }
        for p in _pending.values()
    ]


async def _cleanup_client_and_file(client: TelegramClient, session_file: str) -> None:
    try:
        await client.disconnect()
    except Exception:
        pass
    _delete_session_files(session_file)
