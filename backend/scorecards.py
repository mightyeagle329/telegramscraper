"""Group scorecards — Phase 3 funnel.

For each scraped source group (the candidates we DM members of), compute
a tiering scorecard:

  - **members**: total scraped contacts
  - **reachable_pct**: fraction of contacts with a public @username (the
    only ones we can cold-DM; below ~10% the group is a bot farm)
  - **sent**: how many of this group's contacts have we DM'd in any campaign
  - **replied**: how many of those replied
  - **reply_rate**: replied / sent
  - **joined**: how many DM'd contacts joined any TRACKED group (funnel
    conversion — joins.json attribution)
  - **join_rate**: joined / sent
  - **tier**: T1/T2/T3 derived from reachable_pct + join_rate

This is the data layer for the campaigns-page "which source groups are
worth scraping?" question. Tiering thresholds are conservative defaults
the operator can tune; the raw numbers are what matters.
"""

from typing import Optional

from group_tracker import _load_joins
from reply_watcher import _load_replies
from sender import _load_sent_log
from sheets import sheets_manager


# Tiering thresholds — calibrated for a casino/sports vertical, adjust to taste.
TIER_REACHABLE_T1 = 0.40   # >40% of members have @username = real audience
TIER_REACHABLE_T2 = 0.20
TIER_JOIN_RATE_T1 = 0.03   # >3% join rate from a campaign sample
TIER_JOIN_RATE_T2 = 0.01


def _classify(reachable_pct: float, join_rate: float) -> str:
    """Tier rule: must clear BOTH a reachable + join threshold for the tier."""
    if reachable_pct >= TIER_REACHABLE_T1 and join_rate >= TIER_JOIN_RATE_T1:
        return "T1"
    if reachable_pct >= TIER_REACHABLE_T2 and join_rate >= TIER_JOIN_RATE_T2:
        return "T2"
    return "T3"


def compute_scorecards() -> list[dict]:
    """Build a scorecard row for every scraped Google Sheet tab.

    Walks the sheet manager once, then walks sent_log + replies + joins
    once each (per group, in-memory filters), so this is O(N+M+J+R) where
    those are the four file sizes. Cheap enough to compute on demand.
    """
    sheet_stats = sheets_manager.get_sheet_stats()  # {tab_name: count}

    sent_log = _load_sent_log()
    replies = _load_replies()
    joins = _load_joins()

    # Pre-build a (account, target_uid) → primary-send map keyed by campaign.
    # We use this to attribute replies/joins to the source group via campaign.
    # In the typical flow, campaign name == sheet/group name (the campaigns
    # endpoint defaults to that), so we can pivot from the sheet tab.

    # group → set of (account, uid) sent
    send_by_group: dict[str, set[tuple[str, int]]] = {}
    for e in sent_log:
        if e.get("status") != "sent":
            continue
        if e.get("kind", "primary") != "primary":
            continue
        c = e.get("campaign") or ""
        if not c:
            continue
        try:
            uid = int(e.get("target_user_id") or 0)
        except (TypeError, ValueError):
            continue
        aid = e.get("account_id") or ""
        if not uid or not aid:
            continue
        send_by_group.setdefault(c, set()).add((aid, uid))

    # group → set of replier uids (matched against the send map)
    reply_by_group: dict[str, set[int]] = {}
    for r in replies:
        try:
            uid = int(r.get("sender_user_id") or 0)
        except (TypeError, ValueError):
            continue
        aid = r.get("account_id") or ""
        if not uid or not aid:
            continue
        for c, sends in send_by_group.items():
            if (aid, uid) in sends:
                reply_by_group.setdefault(c, set()).add(uid)

    # group → set of joiner uids (attributed via source_campaign)
    join_by_group: dict[str, set[int]] = {}
    for j in joins:
        if not j.get("attributed"):
            continue
        c = j.get("source_campaign") or ""
        if not c:
            continue
        try:
            uid = int(j.get("user_id") or 0)
        except (TypeError, ValueError):
            continue
        if uid:
            join_by_group.setdefault(c, set()).add(uid)

    scorecards: list[dict] = []
    for tab_name, total_members in sheet_stats.items():
        # Sample the sheet once to compute reachable_pct cheaply (we don't
        # actually need full member records — just a count of those with
        # a non-empty Username column).
        try:
            rows = sheets_manager.get_all_members(tab_name)
        except Exception:
            rows = []
        if rows:
            with_username = sum(
                1
                for r in rows
                if str(r.get("Username") or r.get("username") or "").strip()
            )
            reachable_pct = with_username / len(rows) if rows else 0.0
        else:
            reachable_pct = 0.0

        # Match the sheet tab to the campaign(s) — typically 1:1 by name,
        # but a sheet can be reused across renamed campaigns. We aggregate
        # ALL campaigns whose name == tab name OR whose name starts with
        # tab name (so "RichSweeps Casino" picks up "RichSweeps Casino —
        # Test 2" too).
        matching: list[str] = [
            c for c in send_by_group.keys() if c == tab_name or c.startswith(tab_name)
        ]
        sent = sum(len(send_by_group.get(c, set())) for c in matching)
        replied_uids: set[int] = set()
        joined_uids: set[int] = set()
        for c in matching:
            replied_uids |= reply_by_group.get(c, set())
            joined_uids |= join_by_group.get(c, set())
        replied = len(replied_uids)
        joined = len(joined_uids)
        reply_rate = (replied / sent) if sent > 0 else 0.0
        join_rate = (joined / sent) if sent > 0 else 0.0

        scorecards.append(
            {
                "name": tab_name,
                "members": int(total_members or 0),
                "reachable_pct": round(reachable_pct, 4),
                "sent": sent,
                "replied": replied,
                "joined": joined,
                "reply_rate": round(reply_rate, 4),
                "join_rate": round(join_rate, 4),
                "tier": _classify(reachable_pct, join_rate),
                "campaigns": matching,
            }
        )

    # Default order: T1 first (best), then by joined desc, then by sent.
    tier_order = {"T1": 0, "T2": 1, "T3": 2}
    scorecards.sort(
        key=lambda r: (tier_order.get(r["tier"], 99), -r["joined"], -r["sent"], r["name"])
    )
    return scorecards
