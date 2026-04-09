import os
from dotenv import load_dotenv

load_dotenv()

# Telegram
TELEGRAM_API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH", "")
TELEGRAM_PHONE = os.getenv("TELEGRAM_PHONE", "")

# Google Sheets
GOOGLE_SHEET_URL = os.getenv("GOOGLE_SHEET_URL", "")
GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")

# Monitoring
MONITOR_INTERVAL = int(os.getenv("MONITOR_INTERVAL", "300"))

# CORS
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
