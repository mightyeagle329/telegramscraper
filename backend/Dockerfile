# syntax=docker/dockerfile:1
#
# Python worker + FastAPI. Designed for Fly.io but works on any
# container host (Railway, Render, DigitalOcean droplet, bare Docker).
#
# Persistent state lives under /data (mounted volume on Fly):
#   - /data/session.session           scraper account Telethon session
#   - /data/sessions/acc_*.session    Phase 1 sender sessions
#   - /data/accounts.json             account registry
#   - /data/queue.json                send queue
#   - /data/sent_log.json             send audit log
#   - /data/groups.json               scraped source groups
#   - /data/warmup_groups.json        warm-up group list
#   - /data/replies.json              Phase 2A reply audit log
#   - /data/contacted.json            Phase 2 global dedup set
#   - /data/tracked_groups.json       Phase 3 funnel destinations
#   - /data/joins.json                Phase 3 join events
#   - /data/bot_history.json          Phase 3 engagement-bot post audit log

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps: build tools for Telethon crypto acceleration.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

# Entrypoint that:
#   1. Creates /data subdirs
#   2. Decodes GOOGLE_CREDENTIALS_B64 / GOOGLE_TOKEN_B64 to disk if set
#   3. Symlinks the Python worker's expected files to /data
#   4. Execs main.py
RUN printf '#!/usr/bin/env bash\n\
set -euo pipefail\n\
mkdir -p /data /data/sessions\n\
# Write Google OAuth files from base64 env vars if provided (Fly secrets pattern).\n\
if [ -n "${GOOGLE_CREDENTIALS_B64:-}" ]; then\n\
  echo "$GOOGLE_CREDENTIALS_B64" | base64 -d > /data/credentials.json\n\
fi\n\
if [ -n "${GOOGLE_TOKEN_B64:-}" ]; then\n\
  echo "$GOOGLE_TOKEN_B64" | base64 -d > /data/token.json\n\
fi\n\
# Symlink persistent paths into the app dir so the existing Python code\n\
# (which uses relative paths) finds them without any code changes.\n\
for f in session.session session.session-journal accounts.json queue.json sent_log.json groups.json warmup_groups.json replies.json contacted.json tracked_groups.json joins.json bot_history.json credentials.json token.json; do\n\
  [ -e "/data/$f" ] && ln -sf "/data/$f" "/app/$f" || true\n\
done\n\
ln -sfn /data/sessions /app/sessions\n\
exec python main.py\n\
' > /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 8000

CMD ["/entrypoint.sh"]
