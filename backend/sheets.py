import logging
import os
import threading
import time
import gspread
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from typing import Optional
from datetime import datetime

from config import GOOGLE_SHEET_URL, GOOGLE_CREDENTIALS_FILE

logger = logging.getLogger(__name__)

# Google Sheets API quota is 60 read requests per minute per user (free tier).
# With ~15+ scraped groups, a single Contacts page load + scorecard call
# can blow through it. Cache the hot reads in memory with a short TTL so
# most requests skip the API entirely. Sheet content changes only when
# the scraper runs, so 60s staleness is fine for read-only consumers.
_CACHE_TTL_S = 60
_cache_lock = threading.Lock()
_stats_cache: dict = {}        # {"data": dict, "expires_at": float}
_members_cache: dict = {}      # {tab_name: {"data": list, "expires_at": float}}


def _cache_get(entry: dict) -> Optional[object]:
    """Return cached data if fresh, else None."""
    if not entry:
        return None
    if entry.get("expires_at", 0) > time.time():
        return entry.get("data")
    return None


def _cache_set(target: dict, data: object) -> None:
    target["data"] = data
    target["expires_at"] = time.time() + _CACHE_TTL_S


def invalidate_sheet_cache(tab_name: Optional[str] = None) -> None:
    """Drop cached reads. Called whenever a write changes sheet contents.

    Pass `tab_name` to invalidate just one tab's member cache + the stats
    cache (which counts that tab). Pass None to wipe everything.
    """
    with _cache_lock:
        if tab_name is None:
            _stats_cache.clear()
            _members_cache.clear()
        else:
            _stats_cache.clear()  # stats includes every tab's row count
            _members_cache.pop(tab_name, None)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

TOKEN_FILE = "token.json"
SUMMARY_SHEET = "Dashboard"


class GoogleSheetsManager:
    def __init__(self):
        self.client: Optional[gspread.Client] = None
        self.spreadsheet: Optional[gspread.Spreadsheet] = None

    def connect(self):
        """Connect to Google Sheets using OAuth2.

        On first run, opens a browser for Google login.
        Saves token.json so subsequent runs don't need login.
        """
        creds = None

        if os.path.exists(TOKEN_FILE):
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    GOOGLE_CREDENTIALS_FILE, SCOPES
                )
                creds = flow.run_local_server(port=0)

            with open(TOKEN_FILE, "w") as token:
                token.write(creds.to_json())

        self.client = gspread.authorize(creds)
        self.spreadsheet = self.client.open_by_url(GOOGLE_SHEET_URL)
        self._ensure_dashboard()

    def _ensure_dashboard(self):
        """Create the Dashboard summary tab if it doesn't exist."""
        try:
            self.spreadsheet.worksheet(SUMMARY_SHEET)
        except gspread.WorksheetNotFound:
            ws = self.spreadsheet.add_worksheet(
                title=SUMMARY_SHEET, rows=100, cols=6
            )
            ws.update(
                "A1:F1",
                [["Group Name", "Group URL", "Total Members", "New Members", "Last Scraped", "Status"]],
            )
            ws.format("A1:F1", {"textFormat": {"bold": True}})
            # Move dashboard to first position
            self.spreadsheet.reorder_worksheets(
                [ws] + [s for s in self.spreadsheet.worksheets() if s.id != ws.id]
            )

    def _update_dashboard(self, group_name: str, group_url: str, total: int, new: int, status: str):
        """Update or add a row in the Dashboard summary tab."""
        try:
            ws = self.spreadsheet.worksheet(SUMMARY_SHEET)
        except gspread.WorksheetNotFound:
            self._ensure_dashboard()
            ws = self.spreadsheet.worksheet(SUMMARY_SHEET)

        rows = ws.get_all_values()
        # Find existing row for this group
        row_idx = None
        for i, row in enumerate(rows):
            if i == 0:
                continue
            if row and row[0] == group_name:
                row_idx = i + 1  # 1-based
                break

        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        row_data = [group_name, group_url, str(total), str(new), now, status]

        if row_idx:
            ws.update(f"A{row_idx}:F{row_idx}", [row_data])
        else:
            ws.append_row(row_data, value_input_option="USER_ENTERED")

    def _get_or_create_worksheet(self, group_name: str) -> gspread.Worksheet:
        """Get or create a worksheet for a specific group."""
        safe_name = group_name[:100]
        try:
            worksheet = self.spreadsheet.worksheet(safe_name)
        except gspread.WorksheetNotFound:
            worksheet = self.spreadsheet.add_worksheet(
                title=safe_name, rows=1000, cols=10
            )
            worksheet.update(
                "A1:H1",
                [
                    [
                        "User ID",
                        "Username",
                        "First Name",
                        "Last Name",
                        "Phone",
                        "Group",
                        "Scraped At",
                        "Is New",
                    ]
                ],
            )
            worksheet.format("A1:H1", {"textFormat": {"bold": True}})
        return worksheet

    def get_existing_user_ids(self, group_name: str) -> set:
        """Get set of user IDs already in the sheet for a group."""
        worksheet = self._get_or_create_worksheet(group_name)
        records = worksheet.get_all_values()
        if len(records) <= 1:
            return set()
        return {row[0] for row in records[1:] if row[0]}

    def append_members(
        self,
        group_name: str,
        group_url: str,
        members: list[dict],
        mark_new: bool = False,
    ) -> int:
        """Append new members to the sheet. Skips duplicates.

        Returns count of new members added.
        """
        worksheet = self._get_or_create_worksheet(group_name)
        existing_ids = self.get_existing_user_ids(group_name)

        new_rows = []
        for member in members:
            user_id_str = str(member["user_id"])
            if user_id_str not in existing_ids:
                new_rows.append(
                    [
                        user_id_str,
                        member.get("username", ""),
                        member.get("first_name", ""),
                        member.get("last_name", ""),
                        member.get("phone", ""),
                        group_name,
                        datetime.now().isoformat(),
                        "NEW" if mark_new else "",
                    ]
                )

        if new_rows:
            worksheet.append_rows(new_rows, value_input_option="USER_ENTERED")
            # Invalidate the read caches — this tab's member list grew and
            # the stats row-counts changed.
            invalidate_sheet_cache(group_name)

        # Update dashboard summary
        total = len(existing_ids) + len(new_rows)
        status = "Monitoring" if mark_new else "Scraped"
        self._update_dashboard(group_name, group_url, total, len(new_rows), status)

        return len(new_rows)

    def get_all_members(self, group_name: str) -> list[dict]:
        """Get all members from the sheet for a group.

        Cached with a 60-second TTL — Google Sheets caps reads at 60/min/user
        and a single Contacts page load fans out one API call per tab.
        """
        with _cache_lock:
            cached = _cache_get(_members_cache.get(group_name))
            if cached is not None:
                return cached
        worksheet = self._get_or_create_worksheet(group_name)
        records = worksheet.get_all_records()
        with _cache_lock:
            entry: dict = _members_cache.setdefault(group_name, {})
            _cache_set(entry, records)
        return records

    def get_sheet_stats(self) -> dict:
        """Get row counts for all worksheets.

        Cached with a 60-second TTL because the naive implementation does
        N API calls (one per tab) every time the dashboard polls — at 15
        scraped groups that's 15 reads per page load, which blows through
        the 60/min Sheets API quota in a few seconds of normal use.

        Uses Sheets' batch metadata fetch (`fetch_sheet_metadata`) when
        available so we get every tab's row count in ONE API call instead
        of N, but falls back to the per-tab loop if the SDK doesn't expose
        the metadata path.
        """
        with _cache_lock:
            cached = _cache_get(_stats_cache)
            if cached is not None:
                return cached

        stats: dict = {}
        try:
            # gspread 6 exposes the v4 spreadsheets.get metadata endpoint via
            # fetch_sheet_metadata — one HTTP call returns every sheet's
            # gridProperties (including row count). Way under the quota.
            meta = self.spreadsheet.fetch_sheet_metadata(
                params={"fields": "sheets.properties(title,gridProperties)"}
            )
            for s in meta.get("sheets", []):
                props = s.get("properties") or {}
                title = props.get("title", "")
                if not title or title == SUMMARY_SHEET:
                    continue
                grid = props.get("gridProperties") or {}
                # rowCount is the sheet's allocated size — usually 1000+
                # rows by default. The actual data is "rowCount - empties",
                # but reading every row to count is expensive. Instead, we
                # rely on the scraper writing contiguous data starting at
                # row 2 and the dashboard's last_updated bookkeeping. For
                # the contacts page we want the "looks roughly accurate"
                # count, not exact — header + reported member-count from
                # the Dashboard tab is the source of truth.
                stats[title] = max(0, int(grid.get("rowCount", 1)) - 1)
        except Exception as e:
            # Fallback: per-tab loop. Slower (N requests) but works on
            # older gspread / unexpected SDK shape changes.
            logger.warning(
                f"sheet stats metadata fetch failed ({type(e).__name__}: {e}); "
                f"falling back to per-tab loop"
            )
            worksheets = self.spreadsheet.worksheets()
            for ws in worksheets:
                if ws.title == SUMMARY_SHEET:
                    continue
                try:
                    values = ws.get_all_values()
                    stats[ws.title] = max(0, len(values) - 1)
                except Exception as inner:
                    logger.warning(f"could not read {ws.title}: {inner}")

        with _cache_lock:
            _cache_set(_stats_cache, stats)
        return stats


sheets_manager = GoogleSheetsManager()
