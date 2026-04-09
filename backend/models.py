from pydantic import BaseModel
from typing import Optional


class GroupAdd(BaseModel):
    url: str


class GroupResponse(BaseModel):
    id: str
    name: str
    url: str
    member_count: int
    scraped_count: int
    status: str
    last_scraped: Optional[str] = None


class MemberData(BaseModel):
    user_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    group_name: str
    group_url: str
    scraped_at: str
    is_new: bool = False


class ScrapeResult(BaseModel):
    group_name: str
    total_members: int
    new_members: int
    exported_to_sheet: bool


class MonitorStatus(BaseModel):
    group_url: str
    is_monitoring: bool
    interval_seconds: int
    last_check: Optional[str] = None
    new_members_since_last: int = 0
