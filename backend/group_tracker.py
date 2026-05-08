"""Group-join tracker — Phase 3 funnel layer.

Watches one or more Telegram groups that *we own* (the funnel destination,
e.g. TitanTreasure casino) and detects new members as they join. Each new
joiner is cross-referenced against the sender's `sent_log.json`: if we
DM'd that user from any account in the last N days, the join is
attributed to the originating campaign + arm.

Persistence:
  - ``tracked_groups.json`` — list of groups under tracking with their
    last-known member snapshot.
  - ``joins.json`` — append-only log of join events (user_id, group_id,
    joined_at, source_account, source_campaign, source_arm). Used by
    the analytics layer to compute *join rate per arm* — the new KPI.

The poll interval defaults to 30 minutes; new joiners landing between
polls are detected on the next cycle. The tracker uses the existing
scraper Telethon client (we already own that connection + proxy) and
calls ``iter_participants`` via the same path the scraper uses for ad-hoc
scrapes — so no new auth surface, no new ban-risk vectors.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from scraper import get_client, resolve_group

logger = logging.getLogger(__name__)

TRACKED_GROUPS_FILE = "tracked_groups.json"
JOINS_FILE = "joins.json"

# Seconds between scrape cycles per group. 30 minutes is a balance
# between freshness and Telegram rate-limit headroom — at 10 owned
# groups and 1500 members each, this stays well under FloodWait limits.
DEFAULT_POLL_INTERVAL_S = 30 * 60

# How far back to look in sent_log when attributing a join to a campaign.
# 14 days catches most legitimate funnel conversions; longer windows
# attribute too aggressively to old campaigns.
ATTRIBUTION_WINDOW_DAYS = 14

# Cap on retained join events per group to keep joins.json small.
JOINS_MAX_PER_GROUP = 5_000

_state_lock = asyncio.Lock()
_joins_lock = asyncio.Lock()


# ---------- file persistence ----------


def _load_tracked() -> dict[str, dict]:
    """Load tracked-groups state.

    Shape:
        {
          "<group_id>": {
            "group_id": int,
            "url": str,
            "name": str,
            "last_polled_at": iso_str | None,
            "last_member_ids": [int, ...],   # snapshot of last poll
            "interval_s": int,
          },
          ...
        }
    """
    if not os.path.exists(TRACKED_GROUPS_FILE):
        return {}
    try:
        with open(TRACKED_GROUPS_FILE, "r") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, IOError):
        return {}


def _save_tracked(data: dict[str, dict]) -> None:
    try:
        with open(TRACKED_GROUPS_FILE, "w") as f:
            json.dump(data, f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save tracked_groups.json: {e}")


def _load_joins() -> list[dict]:
    if not os.path.exists(JOINS_FILE):
        return []
    try:
        with open(JOINS_FILE, "r") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, IOError):
        return []


def _save_joins(rows: list[dict]) -> None:
    try:
        with open(JOINS_FILE, "w") as f:
            json.dump(rows, f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save joins.json: {e}")


# ---------- public config API (for the operator) ----------


async def add_tracked_group(url: str, interval_s: int = DEFAULT_POLL_INTERVAL_S) -> dict:
    """Add a group to the tracker.

    Resolves the group via the existing scraper client, records its
    initial member snapshot (so the FIRST poll doesn't fire a thousand
    "new join" events for existing members), and returns the public view.
    """
    tc = await get_client()
    entity = await resolve_group(url)
    group_id = str(entity.id)
    name = getattr(entity, "title", str(entity.id))

    # Snapshot current members so the first delta-poll only flags real
    # new joiners. This is the "we already know about everyone here" mark.
    initial_ids = await _enumerate_member_ids(tc, entity)

    async with _state_lock:
        tracked = _load_tracked()
        existing = tracked.get(group_id, {})
        tracked[group_id] = {
            "group_id": int(entity.id),
            "url": url,
            "name": name,
            "last_polled_at": datetime.now(timezone.utc).isoformat(),
            "last_member_ids": initial_ids,
            "interval_s": int(interval_s) if interval_s > 0 else DEFAULT_POLL_INTERVAL_S,
            "added_at": existing.get("added_at") or datetime.now(timezone.utc).isoformat(),
        }
        _save_tracked(tracked)
    logger.info(f"Tracking group {name!r} ({group_id}) with {len(initial_ids)} starting members")
    return _public_view(tracked[group_id])


async def remove_tracked_group(group_id: str) -> bool:
    async with _state_lock:
        tracked = _load_tracked()
        if group_id not in tracked:
            return False
        tracked.pop(group_id)
        _save_tracked(tracked)
    return True


def list_tracked_groups() -> list[dict]:
    """Return public view of every tracked group."""
    return [_public_view(g) for g in _load_tracked().values()]


def _public_view(g: dict) -> dict:
    """Redact the bulky member-id snapshot for API responses."""
    return {
        "group_id": g.get("group_id"),
        "url": g.get("url"),
        "name": g.get("name"),
        "last_polled_at": g.get("last_polled_at"),
        "interval_s": g.get("interval_s"),
        "added_at": g.get("added_at"),
        "members_known": len(g.get("last_member_ids") or []),
    }


# ---------- the actual tracker ----------


async def _enumerate_member_ids(tc, entity) -> list[int]:
    """Pull every visible participant id for an entity.

    Reuses the same Telethon iter_participants flow the scraper uses, but
    only collects ids — we don't need full user records here, just a
    set diff against the prior snapshot.
    """
    ids: list[int] = []
    seen: set[int] = set()
    try:
        async for user in tc.iter_participants(entity, aggressive=True):
            if user.id in seen:
                continue
            seen.add(user.id)
            ids.append(int(user.id))
    except Exception as e:
        # Don't crash the scheduler over one transient failure — log + skip
        # this cycle. Next cycle will retry.
        logger.warning(f"iter_participants failed: {type(e).__name__}: {e}")
        raise
    return ids


def _attribute_join(user_id: int) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Find the most recent ATTRIBUTION_WINDOW_DAYS sent_log entry where
    this user was the target. Returns (account_id, campaign, arm) or all
    None if no match — meaning this joiner came from elsewhere (organic,
    paid ads, word of mouth) and isn't credited to any of our campaigns.
    """
    from sender import _load_sent_log

    log = _load_sent_log()
    cutoff = datetime.now(timezone.utc) - timedelta(days=ATTRIBUTION_WINDOW_DAYS)

    # Walk backwards (most recent first) so we attribute to the LATEST
    # primary send the user got, not the first one — usually the right
    # call for re-engagement campaigns.
    for entry in reversed(log):
        if entry.get("status") != "sent":
            continue
        if entry.get("kind", "primary") != "primary":
            continue
        try:
            target_uid = int(entry.get("target_user_id") or 0)
        except (TypeError, ValueError):
            continue
        if target_uid != user_id:
            continue
        ts = entry.get("timestamp")
        if isinstance(ts, str):
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if dt < cutoff:
                    return None, None, None  # too old to attribute
            except ValueError:
                pass
        return (
            entry.get("account_id"),
            entry.get("campaign") or None,
            entry.get("arm") or "A",
        )
    return None, None, None


async def _record_joins(group_id: str, group_name: str, new_user_ids: list[int]) -> int:
    """Append join events for the new joiners and return the count
    actually recorded (after attribution)."""
    if not new_user_ids:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for uid in new_user_ids:
        account, campaign, arm = _attribute_join(uid)
        rows.append(
            {
                "user_id": int(uid),
                "group_id": int(group_id),
                "group_name": group_name,
                "joined_at": now,
                "source_account": account,
                "source_campaign": campaign,
                "source_arm": arm,
                "attributed": account is not None,
            }
        )
    async with _joins_lock:
        existing = _load_joins()
        existing.extend(rows)
        # Cap retention so the file doesn't grow unbounded for large
        # always-on tracking. Keep only the most-recent slice.
        if len(existing) > JOINS_MAX_PER_GROUP * max(1, len(_load_tracked())):
            existing = existing[-(JOINS_MAX_PER_GROUP * len(_load_tracked())) :]
        _save_joins(existing)
    return len(rows)


async def poll_group(group_id: str) -> dict:
    """Run one polling cycle for a single tracked group.

    Compares the current member set against the last snapshot, records
    new-joiner events, updates the snapshot. Returns a small summary.
    """
    tracked = _load_tracked()
    state = tracked.get(group_id)
    if state is None:
        return {"group_id": group_id, "error": "not tracked"}

    tc = await get_client()
    try:
        entity = await resolve_group(state["url"])
        current_ids = await _enumerate_member_ids(tc, entity)
    except Exception as e:
        logger.warning(f"poll_group({group_id}) failed: {type(e).__name__}: {e}")
        return {"group_id": group_id, "error": str(e)}

    prior = set(state.get("last_member_ids") or [])
    current_set = set(current_ids)
    new_joiners = list(current_set - prior)
    left = list(prior - current_set)
    recorded = await _record_joins(group_id, state.get("name", ""), new_joiners)

    async with _state_lock:
        tracked = _load_tracked()
        if group_id in tracked:
            tracked[group_id]["last_member_ids"] = current_ids
            tracked[group_id]["last_polled_at"] = datetime.now(timezone.utc).isoformat()
            _save_tracked(tracked)

    logger.info(
        f"[group-tracker] {state.get('name', group_id)} polled: "
        f"+{len(new_joiners)} joins / -{len(left)} left / {len(current_ids)} total"
    )
    return {
        "group_id": int(group_id),
        "name": state.get("name"),
        "joined": len(new_joiners),
        "left": len(left),
        "total_members": len(current_ids),
        "recorded": recorded,
    }


async def poll_all() -> list[dict]:
    """Poll every tracked group sequentially. Returns per-group summaries."""
    tracked = _load_tracked()
    out = []
    for group_id in list(tracked.keys()):
        res = await poll_group(group_id)
        out.append(res)
        # Small breath between groups so we don't burst Telethon at the start.
        await asyncio.sleep(2)
    return out


# ---------- API for the analytics layer ----------


def list_recent_joins(
    limit: int = 100,
    group_id: Optional[int] = None,
    campaign: Optional[str] = None,
) -> list[dict]:
    rows = _load_joins()
    if group_id is not None:
        rows = [r for r in rows if int(r.get("group_id") or 0) == int(group_id)]
    if campaign is not None:
        rows = [r for r in rows if r.get("source_campaign") == campaign]
    return rows[-limit:]


def joins_for_campaign(campaign: str) -> list[dict]:
    """Every join attributed to a given campaign across all tracked groups."""
    return [r for r in _load_joins() if r.get("source_campaign") == campaign]


def joins_for_arm(campaign: str, arm: str) -> list[dict]:
    """Every join attributed to a (campaign, arm) pair."""
    return [
        r
        for r in _load_joins()
        if r.get("source_campaign") == campaign and (r.get("source_arm") or "A") == arm
    ]
