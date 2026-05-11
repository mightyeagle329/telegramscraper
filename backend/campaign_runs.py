"""Campaign-run tracker — async / chunked launches for large campaigns.

Why this exists: cold-DM campaigns in AI mode generate one OpenAI opener
per target before enqueuing. With 1500 targets and ~5s per call across 8
parallel workers, the full prep takes 10-15 minutes — far over
Cloudflare's 100s edge timeout. The result: a 524 error in the browser
while the backend keeps churning.

Fix: the campaign endpoint returns IMMEDIATELY with a `run_id`. The
distribute step is split into chunks (50 targets at a time) and runs in
the background. Each chunk's openers are generated AND enqueued before
the next chunk starts — so the sender workers begin sending within ~30s
of launch instead of waiting 15 minutes for the full batch.

State lives in `campaign_runs.json`:

    {
      "<run_id>": {
        "campaign": "RichSweeps Casino",
        "status": "running" | "completed" | "failed",
        "started_at": iso, "completed_at": iso | null,
        "targets_total": 1500, "targets_processed": 350,
        "enqueued": {"acc_001": {"A": 175}, "acc_002": {"A": 175}},
        "arms": ["A"],
        "error": null | "..."
      }, ...
    }

The frontend polls `/api/campaigns/runs/{run_id}` to show live progress;
the user sees DMs arriving in the queue + sent-log within seconds even
though the full enqueue takes minutes.
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

RUNS_FILE = "campaign_runs.json"
RUNS_MAX = 100  # keep the last 100 runs on disk — rotates oldest out

# Target chunk size for AI campaigns. ~50 targets at 8 parallel OpenAI
# calls finishes in 30-60s; small enough that the sender starts firing
# real DMs while the rest of the batch is still being generated, big
# enough that there's no overhead-per-chunk thrash.
DEFAULT_CHUNK_SIZE = 50

_runs_lock = asyncio.Lock()


def _load_runs() -> dict:
    if not os.path.exists(RUNS_FILE):
        return {}
    try:
        with open(RUNS_FILE, "r") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, IOError):
        return {}


def _save_runs(runs: dict) -> None:
    # Keep only the most-recent RUNS_MAX runs sorted by started_at.
    ordered = sorted(
        runs.items(),
        key=lambda kv: kv[1].get("started_at") or "",
        reverse=True,
    )[:RUNS_MAX]
    out = dict(ordered)
    try:
        with open(RUNS_FILE, "w") as f:
            json.dump(out, f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save campaign_runs.json: {e}")


def new_run_id() -> str:
    return uuid.uuid4().hex


async def create_run(
    run_id: str,
    campaign: str,
    targets_total: int,
    arms: list[str],
    account_ids: list[str],
) -> dict:
    async with _runs_lock:
        runs = _load_runs()
        runs[run_id] = {
            "run_id": run_id,
            "campaign": campaign,
            "status": "running",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
            "targets_total": targets_total,
            "targets_processed": 0,
            "enqueued": {aid: {a: 0 for a in arms} for aid in account_ids},
            "arms": arms,
            "account_ids": account_ids,
            "error": None,
        }
        _save_runs(runs)
        return runs[run_id]


async def update_run(run_id: str, **patch) -> Optional[dict]:
    """Merge `patch` into the run record. `enqueued` is special-cased to
    accumulate per-arm-per-account counts across chunks."""
    async with _runs_lock:
        runs = _load_runs()
        if run_id not in runs:
            return None
        run = runs[run_id]
        # Accumulate enqueued counts so each chunk adds to the running total
        # instead of overwriting it.
        if "enqueued" in patch:
            for aid, arm_counts in (patch.pop("enqueued") or {}).items():
                bucket = run["enqueued"].setdefault(aid, {})
                for arm, n in arm_counts.items():
                    bucket[arm] = bucket.get(arm, 0) + int(n)
        run.update(patch)
        runs[run_id] = run
        _save_runs(runs)
        return run


def get_run(run_id: str) -> Optional[dict]:
    return _load_runs().get(run_id)


def list_runs(limit: int = 30) -> list[dict]:
    runs = _load_runs()
    ordered = sorted(
        runs.values(),
        key=lambda r: r.get("started_at") or "",
        reverse=True,
    )
    return ordered[:limit]


# ---------- the background-chunked runner ----------


async def run_chunked_distribute(
    run_id: str,
    targets: list[dict],
    account_ids: list[str],
    arms: list[dict],
    delete_after_s: Optional[int],
    campaign: str,
    group_name: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> None:
    """Process the campaign in chunks. Called from FastAPI's
    BackgroundTasks via `asyncio.create_task` so it runs after the
    response returns to the browser.

    Catches every exception locally — the background task has no caller
    to bubble errors to, so we persist the error on the run record and
    return cleanly.
    """
    from sender import distribute_arms_round_robin  # avoid module cycle

    try:
        total = len(targets)
        for start in range(0, total, chunk_size):
            chunk = targets[start : start + chunk_size]
            try:
                counts = await distribute_arms_round_robin(
                    targets=chunk,
                    account_ids=account_ids,
                    arms=arms,
                    delete_after_s=delete_after_s,
                    campaign=campaign,
                    group_name=group_name,
                )
                await update_run(
                    run_id,
                    targets_processed=start + len(chunk),
                    enqueued=counts,
                )
            except Exception as e:
                logger.exception(
                    f"campaign run {run_id}: chunk {start}-{start + len(chunk)} failed: {e}"
                )
                await update_run(
                    run_id,
                    status="failed",
                    completed_at=datetime.now(timezone.utc).isoformat(),
                    error=f"{type(e).__name__}: {e}",
                )
                return
        await update_run(
            run_id,
            status="completed",
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
        logger.info(
            f"campaign run {run_id}: completed — {total} targets enqueued across "
            f"{len(account_ids)} account(s) × {len(arms)} arm(s)"
        )
    except Exception as e:
        # Top-level safety: never let an exception escape a background task.
        logger.exception(f"campaign run {run_id}: top-level failure: {e}")
        await update_run(
            run_id,
            status="failed",
            completed_at=datetime.now(timezone.utc).isoformat(),
            error=f"{type(e).__name__}: {e}",
        )
