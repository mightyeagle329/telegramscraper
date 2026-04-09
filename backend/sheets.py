import os
import gspread
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from typing import Optional
from datetime import datetime

from config import GOOGLE_SHEET_URL, GOOGLE_CREDENTIALS_FILE

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

        # Update dashboard summary
        total = len(existing_ids) + len(new_rows)
        status = "Monitoring" if mark_new else "Scraped"
        self._update_dashboard(group_name, group_url, total, len(new_rows), status)

        return len(new_rows)

    def get_all_members(self, group_name: str) -> list[dict]:
        """Get all members from the sheet for a group."""
        worksheet = self._get_or_create_worksheet(group_name)
        records = worksheet.get_all_records()
        return records

    def get_sheet_stats(self) -> dict:
        """Get row counts for all worksheets."""
        worksheets = self.spreadsheet.worksheets()
        stats = {}
        for ws in worksheets:
            if ws.title == SUMMARY_SHEET:
                continue
            values = ws.get_all_values()
            stats[ws.title] = max(0, len(values) - 1)
        return stats


sheets_manager = GoogleSheetsManager()
