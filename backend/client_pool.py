"""Per-account Telethon client pool (Phase 1 sender infrastructure).

Each of the 10 sender accounts keeps its own persistent Telethon client,
connected through its own residential proxy. Clients are lazily created
and cached; one asyncio lock per account prevents double-connect races.

This pool is intentionally separate from ``scraper.py``'s global scraping
client. Scraping and sending stay isolated at the connection level so
their ban signatures don't cross-contaminate — the scraping account
reads, the sender accounts message.

Proxy format in accounts.json (IPRoyal-compatible)::

    "proxy": {
        "type": "socks5",            # socks5 | socks4 | http
        "host": "geo.iproyal.com",
        "port": 12321,
        "username": "user-country-us-session-xxx",
        "password": "pass"
    }
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from telethon import TelegramClient
from telethon.errors import (
    AuthKeyError,
    AuthKeyUnregisteredError,
    PhoneNumberBannedError,
    UserDeactivatedBanError,
    UserDeactivatedError,
)

from accounts import (
    STATUS_BANNED,
    load_accounts,
    mark_error,
    save_accounts,
)
from config import TELEGRAM_API_HASH, TELEGRAM_API_ID

logger = logging.getLogger(__name__)

SUPPORTED_PROXY_TYPES = {"socks5", "socks4", "http"}

# Cached clients + per-account locks (lazily populated).
_clients: dict[str, TelegramClient] = {}
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(account_id: str) -> asyncio.Lock:
    if account_id not in _locks:
        _locks[account_id] = asyncio.Lock()
    return _locks[account_id]


def build_proxy_tuple(proxy: Optional[dict]):
    """Convert a stored proxy dict to Telethon 1.36's accepted tuple form.

    Telethon accepts ``(proxy_type, addr, port, rdns, username, password)``
    where proxy_type may be the string 'socks5' / 'socks4' / 'http'. We use
    ``rdns=True`` so DNS is resolved through the proxy (avoids leaking the
    bot host's real DNS — important for account-origin consistency).

    Returns ``None`` if no proxy is configured.
    """
    if not proxy:
        return None
    ptype = (proxy.get("type") or "socks5").lower()
    if ptype not in SUPPORTED_PROXY_TYPES:
        raise ValueError(
            f"Unsupported proxy type {ptype!r}. Use one of: {sorted(SUPPORTED_PROXY_TYPES)}"
        )
    host = proxy.get("host")
    port = proxy.get("port")
    if not host or not port:
        raise ValueError("Proxy config must include 'host' and 'port'")
    return (
        ptype,
        host,
        int(port),
        True,  # rdns: resolve DNS through the proxy
        proxy.get("username") or None,
        proxy.get("password") or None,
    )


def _resolve_credentials(account: dict) -> tuple[int, str]:
    """Pick api_id/api_hash for this account: per-account override, else .env."""
    api_id = account.get("api_id") or TELEGRAM_API_ID
    api_hash = account.get("api_hash") or TELEGRAM_API_HASH
    if not api_id or not api_hash:
        raise RuntimeError(
            f"[{account['id']}] missing api_id / api_hash. Set them in "
            f"accounts.json for this account or in backend/.env as "
            f"TELEGRAM_API_ID / TELEGRAM_API_HASH."
        )
    return int(api_id), api_hash


def build_client(account: dict) -> TelegramClient:
    """Instantiate a Telethon client for the account (not yet connected).

    Exposed so `add_account.py` can reuse the same construction logic during
    the interactive SMS sign-in flow (before the account has a session).
    """
    api_id, api_hash = _resolve_credentials(account)
    session_file = account["session_file"]
    session_dir = os.path.dirname(session_file)
    if session_dir:
        os.makedirs(session_dir, exist_ok=True)
    return TelegramClient(
        session_file,
        api_id,
        api_hash,
        proxy=build_proxy_tuple(account.get("proxy")),
    )


async def _disconnect_cached(account_id: str) -> None:
    client = _clients.pop(account_id, None)
    if client is not None:
        try:
            await client.disconnect()
        except Exception:
            pass


async def get_account_client(account: dict) -> TelegramClient:
    """Return a connected, authorized Telethon client for this account.

    - Creates + connects on first call, caches thereafter.
    - Reconnects transparently if the cached session went stale.
    - Raises ``RuntimeError`` if the session is not yet authorized
      (run ``python add_account.py`` first for that account).
    - Raises ``PhoneNumberBannedError`` / ``UserDeactivatedBanError`` for
      terminally-dead accounts; caller should flip status to 'banned'.
    """
    aid = account["id"]
    async with _lock_for(aid):
        existing = _clients.get(aid)
        if existing is not None and existing.is_connected():
            try:
                await existing.get_me()
                return existing
            except (AuthKeyUnregisteredError, AuthKeyError):
                logger.warning(f"[{aid}] session key expired; reconnecting")
                await _disconnect_cached(aid)

        client = build_client(account)
        await client.connect()

        if not await client.is_user_authorized():
            await client.disconnect()
            raise RuntimeError(
                f"[{aid}] session not authorized. Run "
                f"`python add_account.py` to sign this account in first."
            )

        _clients[aid] = client
        try:
            me = await client.get_me()
            logger.info(
                f"[{aid}] connected as {me.first_name!r} (phone={me.phone})"
            )
        except Exception as e:
            logger.warning(f"[{aid}] connected but get_me failed: {e}")
        return client


async def get_account_client_by_id(account_id: str) -> TelegramClient:
    """Convenience: load the account record from disk and connect."""
    accounts = load_accounts()
    acct = accounts.get(account_id)
    if acct is None:
        raise KeyError(f"Account {account_id!r} not found in accounts.json")
    return await get_account_client(acct)


async def disconnect_account(account_id: str) -> None:
    """Disconnect a single account's cached client (safe no-op if not cached)."""
    async with _lock_for(account_id):
        await _disconnect_cached(account_id)


async def disconnect_all() -> None:
    """Disconnect every cached sender client. Call on FastAPI shutdown."""
    for aid in list(_clients.keys()):
        async with _lock_for(aid):
            await _disconnect_cached(aid)


async def health_check(account: dict) -> dict:
    """Quick liveness probe for a single account.

    Writes updated ``health`` + error fields onto the account dict in place.
    Flips status to 'banned' on terminal errors. Caller is responsible for
    persisting with ``save_accounts()``.
    """
    aid = account["id"]
    result = {
        "connected": False,
        "last_check_at": datetime.now(timezone.utc).isoformat(),
        "restricted": False,
    }
    try:
        client = await get_account_client(account)
        me = await client.get_me()
        if me is None:
            raise RuntimeError("get_me() returned None")
        result["connected"] = True
    except (PhoneNumberBannedError, UserDeactivatedBanError, UserDeactivatedError) as e:
        account["status"] = STATUS_BANNED
        mark_error(account, f"{type(e).__name__}: {e}")
        await _disconnect_cached(aid)
    except Exception as e:
        logger.warning(f"[{aid}] health check failed: {type(e).__name__}: {e}")
        mark_error(account, f"{type(e).__name__}: {e}")
    account["health"] = result
    return result


async def health_check_all() -> dict[str, dict]:
    """Run health_check for every account, save updates, return results by id."""
    accounts = load_accounts()
    results: dict[str, dict] = {}
    for aid, acct in accounts.items():
        results[aid] = await health_check(acct)
        accounts[aid] = acct
    save_accounts(accounts)
    return results
