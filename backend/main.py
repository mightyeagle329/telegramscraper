import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config import FRONTEND_URL
from models import GroupAdd
from scraper import scrape_group_members, get_group_info, disconnect
from sheets import sheets_manager
from monitor import (
    start_monitoring,
    stop_monitoring,
    get_monitoring_status,
    get_all_monitoring,
    stop_all,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to Google Sheets
    try:
        sheets_manager.connect()
        logger.info("Connected to Google Sheets")
    except Exception as e:
        logger.warning(f"Could not connect to Google Sheets: {e}")

    yield

    # Shutdown: stop monitors and disconnect Telegram
    stop_all()
    await disconnect()
    logger.info("Shutdown complete")


app = FastAPI(title="Telegram Group Scraper", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store of added groups
groups_store: dict = {}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/groups")
async def add_group(group: GroupAdd):
    """Add a new group to track."""
    try:
        info = await get_group_info(group.url)
        groups_store[info["id"]] = {
            **info,
            "scraped_count": 0,
            "status": "active",
            "last_scraped": None,
        }
        return groups_store[info["id"]]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error adding group: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/groups")
async def list_groups():
    """List all tracked groups."""
    return list(groups_store.values())


@app.delete("/api/groups/{group_id}")
async def remove_group(group_id: str):
    """Remove a group from tracking."""
    if group_id in groups_store:
        group = groups_store[group_id]
        stop_monitoring(group["url"])
        del groups_store[group_id]
        return {"status": "removed"}
    raise HTTPException(status_code=404, detail="Group not found")


@app.post("/api/groups/{group_id}/scrape")
async def scrape_group(group_id: str):
    """Scrape members from a group and export to Google Sheets."""
    if group_id not in groups_store:
        raise HTTPException(status_code=404, detail="Group not found")

    group = groups_store[group_id]
    try:
        result = await scrape_group_members(group["url"])
        groups_store[group_id].update(
            {
                "scraped_count": result["total_members_found"],
                "last_scraped": result["scraped_at"],
                "status": groups_store[group_id]["status"],
            }
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error scraping group: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/groups/{group_id}/monitor/start")
async def start_group_monitor(group_id: str, interval: int = 300):
    """Start monitoring a group for new members."""
    if group_id not in groups_store:
        raise HTTPException(status_code=404, detail="Group not found")

    group = groups_store[group_id]
    status = start_monitoring(group["url"], interval)
    groups_store[group_id]["status"] = "monitoring"
    return status


@app.post("/api/groups/{group_id}/monitor/stop")
async def stop_group_monitor(group_id: str):
    """Stop monitoring a group."""
    if group_id not in groups_store:
        raise HTTPException(status_code=404, detail="Group not found")

    group = groups_store[group_id]
    status = stop_monitoring(group["url"])
    groups_store[group_id]["status"] = "active"
    return status


@app.get("/api/groups/{group_id}/monitor")
async def get_group_monitor_status(group_id: str):
    """Get monitoring status for a group."""
    if group_id not in groups_store:
        raise HTTPException(status_code=404, detail="Group not found")

    group = groups_store[group_id]
    return get_monitoring_status(group["url"])


@app.get("/api/monitoring")
async def get_all_monitoring_status():
    """Get all monitoring statuses."""
    return get_all_monitoring()


@app.get("/api/sheets/stats")
async def get_sheets_stats():
    """Get Google Sheets statistics."""
    try:
        return sheets_manager.get_sheet_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sheets/{group_name}/members")
async def get_sheet_members(group_name: str):
    """Get members from a specific sheet."""
    try:
        members = sheets_manager.get_all_members(group_name)
        return {"group_name": group_name, "members": members, "count": len(members)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
