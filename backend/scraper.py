import asyncio
import os
import re
import logging
from datetime import datetime
from typing import Optional
from telethon import TelegramClient
from telethon.tl.functions.messages import CheckChatInviteRequest
from telethon.errors import (
    FloodWaitError,
    ChatAdminRequiredError,
    ChannelPrivateError,
    InviteHashExpiredError,
    AuthKeyUnregisteredError,
    AuthKeyError,
)

from config import TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE
from sheets import sheets_manager

logger = logging.getLogger(__name__)

SESSION_NAME = "session"
client: Optional[TelegramClient] = None
_client_lock = asyncio.Lock()


async def init_client() -> TelegramClient:
    """Initialize and log in the Telegram client at startup.

    This must be called BEFORE any API requests come in, because the
    Telethon login flow may require interactive code input in the terminal
    and may trigger a data center migration.
    """
    global client

    async with _client_lock:
        if client is not None and client.is_connected():
            try:
                me = await client.get_me()
                if me is not None:
                    return client
            except (AuthKeyUnregisteredError, AuthKeyError):
                logger.warning("Session invalid, will recreate")
                await _force_disconnect()

        client = TelegramClient(SESSION_NAME, TELEGRAM_API_ID, TELEGRAM_API_HASH)
        try:
            await client.start(phone=TELEGRAM_PHONE)
            me = await client.get_me()
            logger.info(f"Telegram client logged in as: {me.first_name}")
        except (AuthKeyUnregisteredError, AuthKeyError) as e:
            logger.error(f"Session broken: {e}. Deleting session file and retrying.")
            await _force_disconnect()
            _delete_session_files()

            client = TelegramClient(SESSION_NAME, TELEGRAM_API_ID, TELEGRAM_API_HASH)
            await client.start(phone=TELEGRAM_PHONE)
            me = await client.get_me()
            logger.info(f"Telegram client logged in as: {me.first_name}")

        return client


async def _force_disconnect():
    """Disconnect the current client if any."""
    global client
    if client is not None:
        try:
            await client.disconnect()
        except Exception:
            pass
        client = None


def _delete_session_files():
    """Delete Telethon session files to force a fresh login."""
    for ext in (".session", ".session-journal"):
        path = f"{SESSION_NAME}{ext}"
        if os.path.exists(path):
            try:
                os.remove(path)
                logger.info(f"Deleted stale session file: {path}")
            except Exception as e:
                logger.warning(f"Could not delete {path}: {e}")


async def get_client() -> TelegramClient:
    """Return the active Telegram client (must be initialized first)."""
    global client
    if client is None or not client.is_connected():
        return await init_client()
    return client


def parse_group_url(url: str) -> dict:
    """Parse a Telegram group URL to extract the identifier.

    Supports:
      - tg://join?invite=HASH
      - t.me/+HASH
      - t.me/joinchat/HASH
      - t.me/username
      - @username
    """
    url = url.strip()

    invite_match = re.search(r"tg://join\?invite=([a-zA-Z0-9_-]+)", url)
    if invite_match:
        return {"type": "invite", "hash": invite_match.group(1)}

    plus_match = re.search(r"t\.me/\+([a-zA-Z0-9_-]+)", url)
    if plus_match:
        return {"type": "invite", "hash": plus_match.group(1)}

    joinchat_match = re.search(r"t\.me/joinchat/([a-zA-Z0-9_-]+)", url)
    if joinchat_match:
        return {"type": "invite", "hash": joinchat_match.group(1)}

    public_match = re.search(r"t\.me/([a-zA-Z0-9_]+)", url)
    if public_match:
        return {"type": "public", "username": public_match.group(1)}

    if re.match(r"^@?[a-zA-Z0-9_]+$", url):
        return {"type": "public", "username": url.lstrip("@")}

    raise ValueError(f"Could not parse Telegram URL: {url}")


async def resolve_group(url: str):
    """Resolve a group URL to a Telegram entity."""
    tc = await get_client()
    parsed = parse_group_url(url)

    if parsed["type"] == "invite":
        try:
            result = await tc(CheckChatInviteRequest(hash=parsed["hash"]))
            if hasattr(result, "chat"):
                return result.chat
            else:
                from telethon.tl.functions.messages import ImportChatInviteRequest

                updates = await tc(ImportChatInviteRequest(hash=parsed["hash"]))
                return updates.chats[0]
        except InviteHashExpiredError:
            raise ValueError("Invite link has expired")
    else:
        entity = await tc.get_entity(parsed["username"])
        return entity


async def scrape_group_members(url: str, mark_new: bool = False) -> dict:
    """Scrape all members from a group and export to Google Sheets.

    Uses Telethon's iter_participants which handles pagination, rate limits,
    and works with both supergroups and channels (where allowed).

    Note: For broadcast channels, Telegram only exposes admins to non-admin
    users. To get full member lists from a broadcast channel, the account
    must be an admin of that channel.
    """
    tc = await get_client()
    entity = await resolve_group(url)

    group_name = getattr(entity, "title", str(entity.id))
    group_id = entity.id

    is_broadcast = getattr(entity, "broadcast", False)
    is_megagroup = getattr(entity, "megagroup", False)
    total_count = getattr(entity, "participants_count", 0) or 0

    logger.info(
        f"Scraping '{group_name}' (broadcast={is_broadcast}, "
        f"megagroup={is_megagroup}, total={total_count})"
    )

    members = []
    seen_ids = set()

    try:
        # iter_participants handles pagination and rate limits automatically
        async for user in tc.iter_participants(entity, aggressive=True):
            if user.id in seen_ids:
                continue
            seen_ids.add(user.id)
            members.append(
                {
                    "user_id": user.id,
                    "username": user.username or "",
                    "first_name": user.first_name or "",
                    "last_name": user.last_name or "",
                    "phone": getattr(user, "phone", "") or "",
                }
            )
    except FloodWaitError as e:
        logger.warning(f"FloodWait during scrape: {e.seconds}s")
        await asyncio.sleep(e.seconds + 1)
    except ChatAdminRequiredError:
        raise ValueError(
            f"Admin access required to scrape members from '{group_name}'. "
            f"This is likely a broadcast channel - only admins can access the "
            f"full member list."
        )
    except ChannelPrivateError:
        raise ValueError(f"Cannot access private channel '{group_name}'")

    logger.info(
        f"Scraped {len(members)} members from '{group_name}' "
        f"(total in group: {total_count})"
    )

    # Warn if we got significantly fewer than expected (broadcast channel case)
    if is_broadcast and total_count > 0 and len(members) < total_count * 0.1:
        logger.warning(
            f"Only got {len(members)}/{total_count} members from broadcast "
            f"channel '{group_name}'. Telegram restricts member visibility "
            f"to admins only for broadcast channels."
        )

    new_count = sheets_manager.append_members(
        group_name, url, members, mark_new=mark_new
    )

    return {
        "group_name": group_name,
        "group_id": group_id,
        "group_url": url,
        "total_members_found": len(members),
        "new_members_added": new_count,
        "exported_to_sheet": True,
        "scraped_at": datetime.now().isoformat(),
    }


async def get_group_info(url: str) -> dict:
    """Get basic info about a group without scraping members."""
    entity = await resolve_group(url)

    return {
        "id": str(entity.id),
        "name": getattr(entity, "title", str(entity.id)),
        "url": url,
        "member_count": getattr(entity, "participants_count", 0) or 0,
    }


async def disconnect():
    """Disconnect the Telegram client on shutdown."""
    await _force_disconnect()
