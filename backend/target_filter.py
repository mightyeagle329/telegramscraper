"""Heuristics to skip likely-undeliverable Telegram targets before enqueue.

These don't replace the sender's runtime error handling — `UserPrivacyRestricted`,
`UserIsBlocked`, etc. still get classified at send time. The point of this
pre-filter is to avoid wasting queue slots and "skipped" log entries on
accounts that almost certainly won't accept a DM:

  - **Bots**: per Telegram's rules, every bot username MUST end in ``bot``.
    This is the safest filter — a 100% guarantee, not a heuristic.
  - **Admin / official / support / channel-staff**: usernames or names
    containing these keywords are almost always restricted-DM accounts
    (their privacy is locked down because they get spammed all day).
  - **News / notify / alert / service**: same — automated or moderated
    feeds, not real users we can DM.

False-positive risk is non-zero (a real user named "Adminescu" would be
filtered out). The default is on; users who want maximum reach can disable
it per-campaign.
"""

import re
from typing import Optional

# Telegram bot usernames are REQUIRED by the platform to end in "bot"
# (case-insensitive). Anchored to end-of-string to avoid catching real users
# like "robotic_dancer".
_BOT_RE = re.compile(r"bot$", re.IGNORECASE)

# Words that strongly signal an admin / official / staff / service account.
# Custom boundary: only LETTERS count as inside-word, so `_`, `-`, digits,
# spaces, dots all act as separators. `admin_richsweeps`, `official-news`,
# `casino_alerts` all match. `newscaster` doesn't match `news` because
# of the trailing letter `c`.
_NON_USER_RE = re.compile(
    r"(?<![a-zA-Z])("
    r"admin|administrator|"
    r"support|helpdesk|"
    r"official|verified|"
    r"moderator|moderation|"
    r"staff|team|"
    r"helper|assistant|"
    r"notify|notification|"
    r"news|press|"
    r"alert|alerts|"
    r"service|services|"
    r"channel|broadcast"
    r")(?![a-zA-Z])",
    re.IGNORECASE,
)


def is_likely_non_user(target: dict) -> tuple[bool, Optional[str]]:
    """Return (should_skip, reason).

    Inspects a target dict (produced by the campaign-from-sheet pipeline)
    and decides whether to filter it from the campaign queue.
    """
    username = str(target.get("username") or "").strip()
    first_name = str(target.get("first_name") or "").strip()
    last_name = str(target.get("last_name") or "").strip()

    # 1) Telegram-required bot suffix — definitive.
    if username and _BOT_RE.search(username):
        return True, "username ends in 'bot' (Telegram bot account)"

    # 2) Admin/official/staff/etc. tokens in username.
    if username:
        m = _NON_USER_RE.search(username)
        if m:
            return True, f"username contains '{m.group(1).lower()}'"

    # 3) Same tokens in the display name.
    full_name = f"{first_name} {last_name}".strip()
    if full_name:
        m = _NON_USER_RE.search(full_name)
        if m:
            return True, f"name contains '{m.group(1).lower()}'"

    return False, None
