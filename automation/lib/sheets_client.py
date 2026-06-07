"""Google Sheets API ラッパー"""
import os
import json
from datetime import datetime


class SheetsClient:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run or os.getenv("DRY_RUN", "false").lower() == "true"
        self.sheet_id = os.getenv("SHEETS_ID", "")
        self.service_account_json = (
            os.getenv("SHEETS_SERVICE_ACCOUNT_JSON") or os.getenv("GA4_SERVICE_ACCOUNT_JSON", "")
        )
        self._configured = bool(self.sheet_id and self.service_account_json)
        self.service = None
        if self._configured and not self.dry_run:
            self._init_service()

    def _init_service(self):
        from googleapiclient.discovery import build
        from google.oauth2 import service_account
        info = json.loads(self.service_account_json)
        scopes = ["https://www.googleapis.com/auth/spreadsheets"]
        creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
        self.service = build("sheets", "v4", credentials=creds, cache_discovery=False)

    def is_ready(self) -> bool:
        return self._configured and not self.dry_run

    def append_rows(self, sheet_name: str, rows: list, header: list = None):
        """指定シートに行を追記。シートが存在しなければ作成し、ヘッダ書き込み"""
        if not self.is_ready():
            print(f"  [DRY] append {len(rows)} rows to '{sheet_name}'")
            return
        if not rows:
            return
        self._ensure_sheet(sheet_name, header or list(rows[0].keys()))
        values = [[str(r.get(k, "")) for k in (header or list(rows[0].keys()))] for r in rows]
        self.service.spreadsheets().values().append(
            spreadsheetId=self.sheet_id,
            range=f"'{sheet_name}'!A1",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": values},
        ).execute()

    def _ensure_sheet(self, sheet_name, header):
        meta = self.service.spreadsheets().get(spreadsheetId=self.sheet_id).execute()
        existing = {s["properties"]["title"] for s in meta.get("sheets", [])}
        if sheet_name not in existing:
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=self.sheet_id,
                body={"requests": [{"addSheet": {"properties": {"title": sheet_name}}}]},
            ).execute()
            # ヘッダ書き込み
            self.service.spreadsheets().values().update(
                spreadsheetId=self.sheet_id,
                range=f"'{sheet_name}'!A1",
                valueInputOption="USER_ENTERED",
                body={"values": [header]},
            ).execute()
