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
