import asyncio
import os
import re
import logging
from datetime import datetime
from typing import Optional
from telethon import TelegramClient
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import CheckChatInviteRequest
from telethon.errors import (
    FloodWaitError,
    ChatAdminRequiredError,
    ChannelPrivateError,
    InviteHashExpiredError,
    AuthKeyUnregisteredError,
    AuthKeyError,
)

from config import (
    SCRAPER_PROXY_HOST,
    SCRAPER_PROXY_PASSWORD,
    SCRAPER_PROXY_PORT,
    SCRAPER_PROXY_TYPE,
    SCRAPER_PROXY_USERNAME,
    TELEGRAM_API_ID,
    TELEGRAM_API_HASH,
    TELEGRAM_PHONE,
)
from sheets import sheets_manager

logger = logging.getLogger(__name__)

SESSION_NAME = "session"
client: Optional[TelegramClient] = None
_client_lock = asyncio.Lock()


def _scraper_proxy_tuple():
    """Build the Telethon proxy tuple from SCRAPER_PROXY_* env vars.

    Returns None if no proxy is configured (scraper falls back to direct
    connection — works but loses the geo-match benefit and may trigger
    Telegram's anti-share-code protection on re-auth).
    """
    if not (SCRAPER_PROXY_HOST and SCRAPER_PROXY_PORT):
        return None
    ptype = (SCRAPER_PROXY_TYPE or "socks5").lower()
    return (
        ptype,
        SCRAPER_PROXY_HOST,
        SCRAPER_PROXY_PORT,
        True,  # rdns through the proxy — no DNS leaks
        SCRAPER_PROXY_USERNAME or None,
        SCRAPER_PROXY_PASSWORD or None,
    )


def _new_telethon_client() -> TelegramClient:
    """Build a fresh TelegramClient for the scraper, with proxy if configured."""
    proxy = _scraper_proxy_tuple()
    if proxy:
        logger.info(
            f"Scraper routing through proxy {proxy[0]}://{proxy[1]}:{proxy[2]}"
        )
    return TelegramClient(
        SESSION_NAME, TELEGRAM_API_ID, TELEGRAM_API_HASH, proxy=proxy
    )


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

        client = _new_telethon_client()
        try:
            await client.start(phone=TELEGRAM_PHONE)
            me = await client.get_me()
            logger.info(f"Telegram client logged in as: {me.first_name}")
        except (AuthKeyUnregisteredError, AuthKeyError) as e:
            logger.error(f"Session broken: {e}. Deleting session file and retrying.")
            await _force_disconnect()
            _delete_session_files()

            client = _new_telethon_client()
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


async def scrape_group_from_messages(
    url: str, mark_new: bool = False, message_limit: int = 5000
) -> dict:
    """Scrape unique users from a group's message history.

    This is a workaround for broadcast channels where the member list is
    restricted. For channels with a linked discussion group, this will
    automatically scrape the discussion group instead.

    Args:
        url: Telegram group URL or invite link
        mark_new: Mark newly added members as "NEW"
        message_limit: Maximum number of messages to scan (default: 5000)

    Returns:
        Dict with scrape results
    """
    tc = await get_client()
    entity = await resolve_group(url)

    group_name = getattr(entity, "title", str(entity.id))
    group_id = entity.id
    is_broadcast = getattr(entity, "broadcast", False)

    # For broadcast channels, try to find a linked discussion group
    target_entity = entity
    target_name = group_name

    if is_broadcast:
        try:
            full = await tc(GetFullChannelRequest(channel=entity))
            linked_chat_id = getattr(full.full_chat, "linked_chat_id", None)
            if linked_chat_id:
                for chat in full.chats:
                    if chat.id == linked_chat_id:
                        target_entity = chat
                        target_name = getattr(chat, "title", group_name)
                        logger.info(
                            f"Using linked discussion group '{target_name}' "
                            f"instead of broadcast channel '{group_name}'"
                        )
                        break
        except Exception as e:
            logger.warning(f"Could not check for linked discussion group: {e}")

    logger.info(
        f"Scraping users from messages in '{target_name}' "
        f"(up to {message_limit} messages)"
    )

    members = []
    seen_ids = set()
    scanned = 0

    try:
        async for message in tc.iter_messages(target_entity, limit=message_limit):
            scanned += 1
            sender = message.sender
            if sender is None or getattr(sender, "bot", False):
                continue
            # Only include users (not channels/chats posting on behalf)
            if not hasattr(sender, "id") or sender.id in seen_ids:
                continue
            # Skip if sender is not a user
            if sender.__class__.__name__ != "User":
                continue

            seen_ids.add(sender.id)
            members.append(
                {
                    "user_id": sender.id,
                    "username": sender.username or "",
                    "first_name": sender.first_name or "",
                    "last_name": sender.last_name or "",
                    "phone": getattr(sender, "phone", "") or "",
                }
            )
    except FloodWaitError as e:
        logger.warning(f"FloodWait during message scrape: {e.seconds}s")
        await asyncio.sleep(e.seconds + 1)
    except ChannelPrivateError:
        raise ValueError(f"Cannot access '{target_name}' (private)")

    logger.info(
        f"Scanned {scanned} messages in '{target_name}', "
        f"found {len(members)} unique users"
    )

    # Save to sheet under the ORIGINAL group name (not the linked discussion)
    new_count = sheets_manager.append_members(
        group_name, url, members, mark_new=mark_new
    )

    return {
        "group_name": group_name,
        "group_id": group_id,
        "group_url": url,
        "source": "messages",
        "source_group": target_name,
        "messages_scanned": scanned,
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
