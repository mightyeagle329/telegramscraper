"""Interactive CLI to onboard a new Telegram sender account.

Run this once per Phase 1 account (10 times total for a full fleet)::

    cd backend
    source venv/bin/activate
    python add_account.py

You will be asked for:
  1. Phone number in E.164 (e.g. +441234567890)
  2. Optional friendly label
  3. Proxy config (IPRoyal residential sticky session — one unique session per account)
  4. Optional per-account api_id/api_hash (default: shared from .env)
  5. SMS verification code Telegram sends to the phone
  6. 2FA password (only if that account has cloud password enabled)

On success the record is written to ``accounts.json`` and the session file
lives at ``sessions/<account_id>.session``. The account starts in status
``warming`` with a daily DM limit of 0 — the warm-up scheduler advances it
over 21 days according to the client-approved curve.
"""

import asyncio
import getpass
import logging
import os
import sys
from typing import Optional

from telethon.errors import (
    FloodWaitError,
    PhoneNumberBannedError,
    PhoneNumberInvalidError,
    SessionPasswordNeededError,
)

from accounts import (
    daily_limit_for,
    load_accounts,
    new_account_record,
    next_account_id,
    save_accounts,
)
from client_pool import build_client
from config import TELEGRAM_API_HASH, TELEGRAM_API_ID

logging.basicConfig(level=logging.WARNING, format="%(message)s")


def _ask(prompt: str, default: str = "", required: bool = True) -> str:
    suffix = f" [{default}]" if default else ""
    while True:
        val = input(f"{prompt}{suffix}: ").strip()
        if not val and default:
            return default
        if val:
            return val
        if not required:
            return ""
        print("  Value is required.")


def _ask_int(prompt: str, default: Optional[int] = None) -> int:
    while True:
        raw = _ask(
            prompt,
            default=str(default) if default is not None else "",
            required=default is None,
        )
        try:
            return int(raw)
        except ValueError:
            print("  Please enter a whole number.")


def _ask_proxy() -> Optional[dict]:
    print()
    print("Proxy — IPRoyal residential sticky session recommended, unique session per account.")
    print("Press Enter on host to SKIP (not recommended for production accounts).")
    host = _ask("  Proxy host", required=False)
    if not host:
        print("  !! No proxy set. This account will use your server's real IP for Telegram traffic.")
        return None
    port = _ask_int("  Proxy port")
    ptype = _ask("  Proxy type (socks5/socks4/http)", default="socks5").lower()
    user = _ask("  Proxy username (blank if none)", required=False)
    password = ""
    if user:
        password = getpass.getpass("  Proxy password (hidden): ")
    return {
        "type": ptype,
        "host": host,
        "port": port,
        "username": user or None,
        "password": password or None,
    }


async def _sign_in(account: dict) -> None:
    """Run Telethon's SMS sign-in flow through the account's proxy.

    Raises RuntimeError with a friendly message on known failure modes.
    """
    client = build_client(account)
    await client.connect()

    try:
        if await client.is_user_authorized():
            print(
                f"  Session at {account['session_file']} is already authorized "
                f"— skipping SMS flow."
            )
            return

        def _code_cb() -> str:
            return input("  Enter the SMS code Telegram sent: ").strip()

        def _password_cb() -> str:
            return getpass.getpass(
                "  2FA cloud password (if this account has one, else press Enter): "
            )

        try:
            await client.start(
                phone=account["phone"],
                code_callback=_code_cb,
                password=_password_cb,
            )
        except PhoneNumberInvalidError:
            raise RuntimeError(
                f"Phone {account['phone']!r} is not a valid Telegram number."
            )
        except PhoneNumberBannedError:
            raise RuntimeError(
                f"Phone {account['phone']!r} is banned by Telegram. "
                f"Use a different number."
            )
        except SessionPasswordNeededError:
            pw = getpass.getpass("  2FA password required (hidden): ")
            await client.sign_in(password=pw)
        except FloodWaitError as e:
            raise RuntimeError(
                f"Telegram rate limit while signing in: wait {e.seconds}s. "
                f"Don't re-trigger sign-ins rapidly on the same phone."
            )

        me = await client.get_me()
        if me is None:
            raise RuntimeError("Sign-in reported success but get_me() returned None.")
        print(
            f"  Signed in as: {me.first_name!r} "
            f"(username=@{me.username or '-'}, phone={me.phone})"
        )
    finally:
        await client.disconnect()


def _cleanup_session_files(session_file: str) -> None:
    for path in (session_file, session_file + "-journal"):
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


async def main() -> int:
    print("=" * 60)
    print("  Add Telegram sender account")
    print("=" * 60)

    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH:
        print("ERROR: TELEGRAM_API_ID / TELEGRAM_API_HASH not set in backend/.env.")
        print("Either set them there (recommended — shared across all 10 accounts),")
        print("or supply per-account credentials below.")
        return 1

    accounts = load_accounts()

    phone = _ask("Phone number (E.164, e.g. +441234567890)")
    if not phone.startswith("+"):
        print(f"  Warning: {phone!r} does not start with '+'. Telegram expects E.164 format.")
        if _ask("  Continue anyway? (y/n)", default="n").lower() != "y":
            return 1

    # Duplicate-phone guard.
    for existing_id, existing in list(accounts.items()):
        if existing.get("phone") == phone:
            print(
                f"\nPhone {phone} is already registered as {existing_id} "
                f"(status={existing.get('status')})."
            )
            choice = _ask(
                "Replace? This deletes the existing session file. (y/n)",
                default="n",
            )
            if choice.lower() != "y":
                print("  Cancelled.")
                return 1
            _cleanup_session_files(existing.get("session_file", ""))
            del accounts[existing_id]
            print(f"  Removed {existing_id}; re-registering under a new id.")
            break

    label = _ask("Label (friendly name, blank for default)", required=False)
    proxy = _ask_proxy()

    print()
    print("API credentials — leave blank to use shared TELEGRAM_API_ID/HASH from .env (recommended).")
    api_id_raw = _ask("  Per-account api_id", required=False)
    api_hash = _ask("  Per-account api_hash", required=False)
    api_id: Optional[int] = None
    if api_id_raw:
        try:
            api_id = int(api_id_raw)
        except ValueError:
            print(f"  Invalid api_id {api_id_raw!r}. Aborting.")
            return 1
    if not api_id:
        api_hash = ""  # enforce "both or neither"

    aid = next_account_id(accounts)
    record = new_account_record(
        account_id=aid,
        phone=phone,
        proxy=proxy,
        api_id=api_id,
        api_hash=api_hash or None,
        label=label,
    )

    print()
    target = (
        f"{proxy['host']}:{proxy['port']} ({proxy['type']})" if proxy else "direct (no proxy)"
    )
    print(f"Signing in account {aid} ({phone}) via {target}...")
    try:
        await _sign_in(record)
    except Exception as e:
        print(f"\nSign-in FAILED: {e}")
        _cleanup_session_files(record["session_file"])
        return 1

    accounts[aid] = record
    save_accounts(accounts)

    todays_limit = daily_limit_for(record["warmup_started_at"])
    print()
    print("=" * 60)
    print(f"  SUCCESS — account {aid} registered")
    print("=" * 60)
    print(f"  Phone:        {phone}")
    print(f"  Label:        {record['label']}")
    print(f"  Session file: {record['session_file']}")
    print(f"  Proxy:        {target}")
    print(f"  Status:       {record['status']}  (warm-up begins now)")
    print(f"  Day 1 limit:  {todays_limit} DMs  (warm-up: 0 outreach days 1–7,")
    print(f"                 then 3 → 50/day over days 8–22)")
    print()
    print("  Run this script again to onboard the next account.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.")
        sys.exit(130)
