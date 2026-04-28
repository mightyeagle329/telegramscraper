"""Classify Telethon errors for the Phase 1 sender.

A single place that turns a raised Telethon exception into an outcome the
sender knows how to act on. Centralising this lets the sender stay focused
on the happy path and means we can tune thresholds (e.g. flood-wait cutoff)
in one file.

Outcome fields:

  skip_target         — skip this specific recipient, don't blame the account
  pause_account_s     — pause the sending account for N seconds (0 = don't pause)
  ban_account         — flip the account status to 'banned' (terminal)
  retry_same_target_s — sleep N seconds then try the same target again
"""

import logging
from dataclasses import dataclass
from typing import Optional

from telethon.errors import (
    ChatWriteForbiddenError,
    FloodWaitError,
    InputUserDeactivatedError,
    PeerFloodError,
    PeerIdInvalidError,
    PhoneNumberBannedError,
    UserDeactivatedBanError,
    UserDeactivatedError,
    UserIsBlockedError,
    UserPrivacyRestrictedError,
)

logger = logging.getLogger(__name__)

# A FloodWait shorter than this is a transient throttle — sleep and retry same target.
# A FloodWait longer than this is a sign Telegram is seriously suspicious — pause the
# whole account for that duration so we don't accumulate more strikes.
FLOOD_WAIT_RETRY_MAX_S = 60

# When PeerFlood hits, rest the account this long before retrying ANY send from it.
PEER_FLOOD_PAUSE_S = 48 * 3600  # 48 hours


@dataclass
class SendOutcome:
    """How the sender should react to an exception from send_message."""

    skip_target: bool = False
    pause_account_s: int = 0
    ban_account: bool = False
    retry_same_target_s: int = 0
    reason: str = ""


def classify(exc: BaseException) -> SendOutcome:
    """Turn a Telethon exception into an action plan."""
    # Terminal account failures — number is dead, don't try to resurrect.
    if isinstance(exc, (PhoneNumberBannedError, UserDeactivatedBanError, UserDeactivatedError)):
        return SendOutcome(
            ban_account=True,
            reason=f"{type(exc).__name__}: account terminated by Telegram",
        )

    # Peer flood = "you've been spamming strangers" — the #1 signal Telegram bans for.
    # Pause this account for 48h and stop burning through more targets with it.
    if isinstance(exc, PeerFloodError):
        return SendOutcome(
            pause_account_s=PEER_FLOOD_PAUSE_S,
            reason="PeerFloodError — TG flagged account for bulk cold outreach; resting 48h",
        )

    # FloodWait: Telegram tells us exactly how long to wait.
    if isinstance(exc, FloodWaitError):
        seconds = int(getattr(exc, "seconds", 0))
        if seconds <= FLOOD_WAIT_RETRY_MAX_S:
            return SendOutcome(
                retry_same_target_s=seconds + 1,
                reason=f"FloodWait {seconds}s — short, will sleep and retry same target",
            )
        return SendOutcome(
            pause_account_s=seconds + 1,
            reason=f"FloodWait {seconds}s — long, pausing account",
        )

    # Target-specific refusals — skip the recipient, account is fine.
    if isinstance(exc, UserPrivacyRestrictedError):
        return SendOutcome(
            skip_target=True,
            reason="UserPrivacyRestricted — recipient blocks DMs from non-contacts",
        )
    if isinstance(exc, UserIsBlockedError):
        return SendOutcome(
            skip_target=True,
            reason="UserIsBlocked — recipient blocked the sender account",
        )
    if isinstance(exc, InputUserDeactivatedError):
        return SendOutcome(
            skip_target=True,
            reason="InputUserDeactivated — recipient's account is deleted",
        )
    if isinstance(exc, ChatWriteForbiddenError):
        return SendOutcome(
            skip_target=True,
            reason="ChatWriteForbidden — sender can't write to this peer",
        )
    if isinstance(exc, PeerIdInvalidError):
        # Recipient has no public @username and the sender account hasn't
        # cached the user's access_hash. Without one of those, Telegram
        # refuses to route the DM. Not the account's fault — just an
        # unreachable target for cold outreach.
        return SendOutcome(
            skip_target=True,
            reason="PeerIdInvalid — recipient has no @username; cold DM not possible",
        )

    # Unknown: skip the target and record the error, don't pause the account blindly.
    return SendOutcome(
        skip_target=True,
        reason=f"{type(exc).__name__}: {exc}",
    )


def should_pause_account(outcome: SendOutcome) -> Optional[int]:
    """Convenience: return the pause-seconds if we should pause this account."""
    return outcome.pause_account_s or None
