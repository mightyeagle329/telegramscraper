import asyncio
import re
from datetime import datetime
from typing import Optional
from telethon import TelegramClient
from telethon.tl.functions.channels import GetParticipantsRequest
from telethon.tl.functions.messages import CheckChatInviteRequest
from telethon.tl.types import ChannelParticipantsSearch
from telethon.errors import (
    FloodWaitError,
    ChatAdminRequiredError,
    ChannelPrivateError,
    InviteHashExpiredError,
)

from config import TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE
from sheets import sheets_manager

client: Optional[TelegramClient] = None


async def get_client() -> TelegramClient:
    """Get or create the Telegram client. On first run, prompts for login code."""
    global client
    if client is None or not client.is_connected():
        client = TelegramClient("session", TELEGRAM_API_ID, TELEGRAM_API_HASH)
        await client.start(phone=TELEGRAM_PHONE)
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

    # Invite links
    invite_match = re.search(r"tg://join\?invite=([a-zA-Z0-9_-]+)", url)
    if invite_match:
        return {"type": "invite", "hash": invite_match.group(1)}

    plus_match = re.search(r"t\.me/\+([a-zA-Z0-9_-]+)", url)
    if plus_match:
        return {"type": "invite", "hash": plus_match.group(1)}

    joinchat_match = re.search(r"t\.me/joinchat/([a-zA-Z0-9_-]+)", url)
    if joinchat_match:
        return {"type": "invite", "hash": joinchat_match.group(1)}

    # Public group
    public_match = re.search(r"t\.me/([a-zA-Z0-9_]+)", url)
    if public_match:
        return {"type": "public", "username": public_match.group(1)}

    # Raw username
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

    Args:
        url: Telegram group URL or invite link
        mark_new: If True, marks newly added members as "NEW" in the sheet

    Returns:
        Dict with scrape results (total found, new added, etc.)
    """
    tc = await get_client()
    entity = await resolve_group(url)

    group_name = getattr(entity, "title", str(entity.id))
    group_id = entity.id

    members = []
    offset = 0
    limit = 200

    while True:
        try:
            participants = await tc(
                GetParticipantsRequest(
                    channel=entity,
                    filter=ChannelParticipantsSearch(""),
                    offset=offset,
                    limit=limit,
                    hash=0,
                )
            )

            if not participants.users:
                break

            for user in participants.users:
                members.append(
                    {
                        "user_id": user.id,
                        "username": user.username or "",
                        "first_name": user.first_name or "",
                        "last_name": user.last_name or "",
                        "phone": getattr(user, "phone", "") or "",
                    }
                )

            offset += len(participants.users)

            if len(participants.users) < limit:
                break

            # Respect Telegram rate limits
            await asyncio.sleep(1)

        except FloodWaitError as e:
            await asyncio.sleep(e.seconds + 1)
        except ChatAdminRequiredError:
            raise ValueError(
                f"Admin access required to scrape members from '{group_name}'"
            )
        except ChannelPrivateError:
            raise ValueError(f"Cannot access private channel '{group_name}'")

    # Export to Google Sheets
    new_count = sheets_manager.append_members(group_name, members, mark_new=mark_new)

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
    """Disconnect the Telegram client."""
    global client
    if client and client.is_connected():
        await client.disconnect()
        client = None
