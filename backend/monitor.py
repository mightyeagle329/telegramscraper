import logging
from datetime import datetime
from typing import Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import MONITOR_INTERVAL
from scraper import scrape_group_members, scrape_group_from_messages

logger = logging.getLogger(__name__)

scheduler: Optional[AsyncIOScheduler] = None

# {group_url: {is_monitoring, mode, interval_seconds, last_check, ...}}
monitoring_state: dict = {}


def get_scheduler() -> AsyncIOScheduler:
    global scheduler
    if scheduler is None:
        scheduler = AsyncIOScheduler()
        scheduler.start()
    return scheduler


async def monitor_job(group_url: str, mode: str = "members"):
    """Periodic job: check for new users in a group.

    Args:
        group_url: The group URL
        mode: "members" to scrape the member list, "messages" to scan message
              history for new senders (use for broadcast channels)
    """
    try:
        logger.info(f"Monitoring check for {group_url} (mode={mode})")

        if mode == "messages":
            result = await scrape_group_from_messages(
                group_url, mark_new=True, message_limit=1000
            )
        else:
            result = await scrape_group_members(group_url, mark_new=True)

        monitoring_state[group_url].update(
            {
                "last_check": datetime.now().isoformat(),
                "new_members_since_last": result["new_members_added"],
                "total_scraped": result["total_members_found"],
                "group_name": result["group_name"],
            }
        )

        if result["new_members_added"] > 0:
            logger.info(
                f"+{result['new_members_added']} new users in {result['group_name']}"
            )

    except Exception as e:
        logger.error(f"Monitor error for {group_url}: {e}")
        if group_url in monitoring_state:
            monitoring_state[group_url]["last_error"] = str(e)


def start_monitoring(
    group_url: str,
    interval: int = MONITOR_INTERVAL,
    mode: str = "members",
) -> dict:
    """Start monitoring a group for new members/users.

    Args:
        group_url: The group URL
        interval: How often to check, in seconds
        mode: "members" (scrape member list) or "messages" (scan message senders)
    """
    sched = get_scheduler()
    job_id = f"monitor_{group_url}"

    existing = sched.get_job(job_id)
    if existing:
        existing.remove()

    sched.add_job(
        monitor_job,
        "interval",
        seconds=interval,
        args=[group_url, mode],
        id=job_id,
        replace_existing=True,
    )

    monitoring_state[group_url] = {
        "is_monitoring": True,
        "mode": mode,
        "interval_seconds": interval,
        "last_check": None,
        "new_members_since_last": 0,
        "started_at": datetime.now().isoformat(),
    }

    return monitoring_state[group_url]


def stop_monitoring(group_url: str) -> dict:
    """Stop monitoring a group."""
    sched = get_scheduler()
    job_id = f"monitor_{group_url}"

    existing = sched.get_job(job_id)
    if existing:
        existing.remove()

    if group_url in monitoring_state:
        monitoring_state[group_url]["is_monitoring"] = False
    else:
        monitoring_state[group_url] = {"is_monitoring": False}

    return monitoring_state[group_url]


def get_monitoring_status(group_url: str) -> dict:
    """Get monitoring status for a group."""
    if group_url not in monitoring_state:
        return {
            "is_monitoring": False,
            "mode": "members",
            "interval_seconds": MONITOR_INTERVAL,
            "last_check": None,
            "new_members_since_last": 0,
        }
    return monitoring_state[group_url]


def get_all_monitoring() -> dict:
    """Get all monitoring statuses."""
    return monitoring_state


def stop_all():
    """Stop all monitoring jobs and clear state."""
    global scheduler
    if scheduler:
        scheduler.shutdown(wait=False)
        scheduler = None
    monitoring_state.clear()
