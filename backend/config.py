import os
from dotenv import load_dotenv

load_dotenv()

# Telegram
TELEGRAM_API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH", "")
TELEGRAM_PHONE = os.getenv("TELEGRAM_PHONE", "")

# Scraper proxy (optional). When set, the scraper account's Telethon
# connection routes through this proxy. Use a residential SOCKS5 in the
# same country as the scraper account's phone to avoid Telegram's
# anti-share-code protection (a login from an IP that doesn't match the
# account's usual country can be blocked even with a correct SMS code).
SCRAPER_PROXY_TYPE = os.getenv("SCRAPER_PROXY_TYPE", "")
SCRAPER_PROXY_HOST = os.getenv("SCRAPER_PROXY_HOST", "")
SCRAPER_PROXY_PORT = int(os.getenv("SCRAPER_PROXY_PORT", "0") or "0")
SCRAPER_PROXY_USERNAME = os.getenv("SCRAPER_PROXY_USERNAME", "")
SCRAPER_PROXY_PASSWORD = os.getenv("SCRAPER_PROXY_PASSWORD", "")

# Google Sheets
GOOGLE_SHEET_URL = os.getenv("GOOGLE_SHEET_URL", "")
GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")

# Monitoring
MONITOR_INTERVAL = int(os.getenv("MONITOR_INTERVAL", "300"))

# CORS
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# OpenAI (Phase 2C — AI-generated personalized openers).
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Phase 3 — Engagement bot (Telegram Bot API, distinct from MTProto/Telethon).
# Register a bot via @BotFather, copy the token, paste it here. Add the bot
# to your owned group as admin so it can post.
ENGAGEMENT_BOT_TOKEN = os.getenv("ENGAGEMENT_BOT_TOKEN", "")
# The default destination chat for posts. Either a public @channelname or a
# numeric chat_id (-100... for supergroups). Operator can override per-post
# via the Sheet's chat_id column if they want.
ENGAGEMENT_BOT_CHAT_ID = os.getenv("ENGAGEMENT_BOT_CHAT_ID", "")
# Google Sheet ID containing the engagement-bot content queue (separate
# spreadsheet from the scraper's member sheets — keeps concerns clean).
# Leave blank and the bot scheduler will refuse to run.
ENGAGEMENT_BOT_SHEET_ID = os.getenv("ENGAGEMENT_BOT_SHEET_ID", "")
# Tab name within the spreadsheet that holds the post queue.
ENGAGEMENT_BOT_SHEET_TAB = os.getenv("ENGAGEMENT_BOT_SHEET_TAB", "Posts")

# Phase 3 — Auto-respond to first reply.
# When a cold-DM recipient replies, the system fires ONE AI-generated
# response that pivots to the destination group invite. Fires only once
# per recipient; subsequent messages stay manual for the VA/operator.
AUTO_REPLY_ENABLED = os.getenv("AUTO_REPLY_ENABLED", "true").lower() in ("1", "true", "yes")
AUTO_REPLY_GROUP_URL = os.getenv("AUTO_REPLY_GROUP_URL", "https://t.me/titantreasurecasino")
AUTO_REPLY_STYLE = os.getenv(
    "AUTO_REPLY_STYLE",
    "Casual, friendly, brief. Acknowledge their reply naturally, then invite them "
    "to the community group. Don't be salesy — sound like a real member.",
)
# Used if the OpenAI call fails (timeout / quota / bad JSON). {url} is
# replaced with AUTO_REPLY_GROUP_URL at send time.
AUTO_REPLY_FALLBACK = os.getenv(
    "AUTO_REPLY_FALLBACK",
    "Thanks for replying! We run a community group — feel free to drop in: {url}",
)
