"""Performance analytics — aggregations over sent_log + replies + accounts.

One pure function, ``compute_summary(days)``, walks the JSON state files
once and returns every roll-up the dashboard needs in one shot:

  - Totals (sent / replied / reply rate / unique targets / skipped / errored).
  - Daily volume series (one bucket per day for the last N days).
  - Per-account stats (sends, replies, reply rate, status).
  - Per-campaign stats (with arm-level breakdown for A/B campaigns).
  - Skip-reason histogram (so the user can see WHY sends fail).

All input is filtered to the trailing ``days``-day window so a
long-running install doesn't surface ancient noise. Reply attribution
joins on ``(account_id, target_user_id)`` against successful primary
sends — the same logic the per-arm stats endpoint uses.

This module is intentionally pure (no side effects, no globals) so it's
trivial to unit-test and cache later if it ever gets slow.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from accounts import load_accounts, public_view
from reply_watcher import _load_replies
from sender import _load_sent_log


def _parse_iso(s: object) -> Optional[datetime]:
    if not isinstance(s, str) or not s:
        return None
    try:
        # fromisoformat handles "...+00:00" (our writer) but not "Z" suffix.
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _date_key(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).date().isoformat()


def compute_summary(days: int = 14) -> dict:
    """Return one shot of every metric the analytics page needs.

    `days` is the trailing window for daily volume + totals. Per-account
    and per-campaign tables also restrict to this window so the metrics
    move when the user picks a smaller range.
    """
    days = max(1, min(int(days), 90))  # clamp to keep file scans bounded
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    cutoff_date = (now - timedelta(days=days - 1)).date()  # inclusive start

    sent_log = _load_sent_log()
    replies = _load_replies()
    accounts = load_accounts()

    # --- pre-walk + filter sent_log ---
    in_window: list[dict] = []
    for e in sent_log:
        dt = _parse_iso(e.get("timestamp"))
        if dt is None or dt < cutoff:
            continue
        in_window.append(e)

    # --- totals ---
    sent = sum(1 for e in in_window if e.get("status") == "sent")
    skipped = sum(1 for e in in_window if e.get("status") == "skipped")
    errored = sum(1 for e in in_window if e.get("status") == "error")
    paused = sum(1 for e in in_window if e.get("status") == "paused")

    # Unique reach = distinct target_user_ids we successfully DM'd in window.
    unique_targets: set[int] = set()
    # Map (account_id, target_user_id) -> True for primary sends, used to
    # attribute replies to the same campaign / account that opened the convo.
    primary_sends: set[tuple[str, int]] = set()
    for e in in_window:
        if e.get("status") != "sent":
            continue
        try:
            uid = int(e.get("target_user_id") or 0)
        except (TypeError, ValueError):
            continue
        if not uid:
            continue
        unique_targets.add(uid)
        if e.get("kind", "primary") == "primary":
            aid = e.get("account_id") or ""
            if aid:
                primary_sends.add((aid, uid))

    # --- replies (also filtered to window for "replied in window" semantics) ---
    repliers_in_window: set[tuple[str, int]] = set()
    for r in replies:
        dt = _parse_iso(r.get("received_at"))
        if dt is None or dt < cutoff:
            continue
        try:
            uid = int(r.get("sender_user_id") or 0)
        except (TypeError, ValueError):
            continue
        aid = r.get("account_id") or ""
        if not uid or not aid:
            continue
        if (aid, uid) in primary_sends:
            repliers_in_window.add((aid, uid))

    replied = len(repliers_in_window)
    reply_rate = (replied / sent) if sent > 0 else 0.0

    # --- daily volume ---
    daily_map: dict[str, dict[str, int]] = defaultdict(
        lambda: {"sent": 0, "skipped": 0, "errored": 0, "replied": 0}
    )
    # Seed every day in window so the chart has zero-buckets for empty days.
    for i in range(days):
        d = (cutoff_date + timedelta(days=i)).isoformat()
        daily_map[d]  # touch to materialize
    for e in in_window:
        dt = _parse_iso(e.get("timestamp"))
        if dt is None:
            continue
        bucket = daily_map[_date_key(dt)]
        status = e.get("status")
        if status == "sent":
            bucket["sent"] += 1
        elif status == "skipped":
            bucket["skipped"] += 1
        elif status == "error":
            bucket["errored"] += 1
    # Replies on their own date (independent of when the primary went out).
    for r in replies:
        dt = _parse_iso(r.get("received_at"))
        if dt is None or dt < cutoff:
            continue
        try:
            uid = int(r.get("sender_user_id") or 0)
        except (TypeError, ValueError):
            continue
        aid = r.get("account_id") or ""
        if (aid, uid) not in primary_sends:
            continue
        daily_map[_date_key(dt)]["replied"] += 1

    daily_volume = [
        {"date": d, **daily_map[d]}
        for d in sorted(daily_map.keys())
    ]

    # --- per-account ---
    per_account_send: dict[str, int] = defaultdict(int)
    per_account_skip: dict[str, int] = defaultdict(int)
    per_account_replies: dict[str, set[int]] = defaultdict(set)
    for e in in_window:
        aid = e.get("account_id") or ""
        if not aid:
            continue
        if e.get("status") == "sent":
            per_account_send[aid] += 1
        elif e.get("status") == "skipped":
            per_account_skip[aid] += 1
    for aid, uid in repliers_in_window:
        per_account_replies[aid].add(uid)

    per_account: list[dict] = []
    # Surface every known account, including ones with zero activity in the
    # window — makes the dashboard feel "complete" instead of hiding idle
    # senders. Use public_view to avoid leaking creds.
    for aid, acct in accounts.items():
        view = public_view(acct)
        sent_n = per_account_send.get(aid, 0)
        replied_n = len(per_account_replies.get(aid, set()))
        per_account.append(
            {
                "account_id": aid,
                "label": view.get("label") or aid,
                "status": view.get("status"),
                "daily_sent": view.get("daily_sent", 0),
                "daily_limit": view.get("daily_limit", 0),
                "sent_in_window": sent_n,
                "skipped_in_window": per_account_skip.get(aid, 0),
                "replied_in_window": replied_n,
                "reply_rate": round((replied_n / sent_n) if sent_n else 0.0, 4),
            }
        )
    per_account.sort(key=lambda r: (-r["sent_in_window"], r["account_id"]))

    # --- per-campaign (with arm breakdown) ---
    # Map: campaign -> {"arms": {arm_name -> {"sent": n, "replied": set(uids)}}}
    by_campaign: dict[str, dict[str, dict]] = defaultdict(
        lambda: {"arms": defaultdict(lambda: {"sent": 0, "replied": set()})}
    )
    for e in in_window:
        if e.get("status") != "sent":
            continue
        if e.get("kind", "primary") != "primary":
            continue
        c = e.get("campaign") or ""
        if not c:
            continue
        arm = e.get("arm", "A") or "A"
        by_campaign[c]["arms"][arm]["sent"] += 1

    for r in replies:
        dt = _parse_iso(r.get("received_at"))
        if dt is None or dt < cutoff:
            continue
        try:
            uid = int(r.get("sender_user_id") or 0)
        except (TypeError, ValueError):
            continue
        aid = r.get("account_id") or ""
        if not uid or not aid:
            continue
        # Find which (campaign, arm) this replier was opened by — walk the
        # in-window primary sends. O(N) per reply but reply volume is small.
        for e in in_window:
            if (
                e.get("status") == "sent"
                and e.get("kind", "primary") == "primary"
                and e.get("account_id") == aid
                and int(e.get("target_user_id") or 0) == uid
            ):
                c = e.get("campaign") or ""
                arm = e.get("arm", "A") or "A"
                if c:
                    by_campaign[c]["arms"][arm]["replied"].add(uid)
                break

    per_campaign: list[dict] = []
    for c, payload in by_campaign.items():
        arms = payload["arms"]
        arm_rows = []
        best_rate = -1.0
        winner: Optional[str] = None
        tie = False
        c_sent = 0
        c_replied = 0
        for arm_name in sorted(arms.keys()):
            s = arms[arm_name]["sent"]
            r_n = len(arms[arm_name]["replied"])
            rate = (r_n / s) if s else 0.0
            arm_rows.append(
                {
                    "name": arm_name,
                    "sent": s,
                    "replied": r_n,
                    "reply_rate": round(rate, 4),
                }
            )
            c_sent += s
            c_replied += r_n
            if s > 0:
                if rate > best_rate:
                    best_rate = rate
                    winner = arm_name
                    tie = False
                elif rate == best_rate:
                    tie = True
        per_campaign.append(
            {
                "campaign": c,
                "sent": c_sent,
                "replied": c_replied,
                "reply_rate": round((c_replied / c_sent) if c_sent else 0.0, 4),
                "arms": arm_rows,
                "winner": (
                    None if (tie or winner is None or best_rate <= 0) else winner
                ),
            }
        )
    per_campaign.sort(key=lambda r: (-r["sent"], r["campaign"]))

    # --- skip reasons histogram ---
    reason_counts: dict[str, int] = defaultdict(int)
    for e in in_window:
        if e.get("status") not in ("skipped", "error"):
            continue
        reason = (e.get("reason") or "(no reason)").strip()
        # Truncate very long reasons (full proxy stack traces etc.) so the
        # frontend can render them in a single row.
        if len(reason) > 80:
            reason = reason[:77] + "…"
        reason_counts[reason] += 1
    skip_reasons = [
        {"reason": k, "count": v}
        for k, v in sorted(
            reason_counts.items(), key=lambda kv: -kv[1]
        )
    ]

    return {
        "days": days,
        "totals": {
            "sent": sent,
            "skipped": skipped,
            "errored": errored,
            "paused": paused,
            "replied": replied,
            "reply_rate": round(reply_rate, 4),
            "unique_targets": len(unique_targets),
        },
        "daily_volume": daily_volume,
        "per_account": per_account,
        "per_campaign": per_campaign,
        "skip_reasons": skip_reasons[:15],  # top 15 — the long tail isn't useful
    }
