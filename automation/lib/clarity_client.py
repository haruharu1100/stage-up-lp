"""Microsoft Clarity Data Export API ラッパー"""
import os
import requests
from datetime import date, timedelta


class ClarityClient:
    BASE_URL = "https://www.clarity.ms/export-data/api/v1/project-live-insights"

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run or os.getenv("DRY_RUN", "false").lower() == "true"
        self.token = os.getenv("CLARITY_API_TOKEN", "")
        self.project_id = os.getenv("CLARITY_PROJECT_ID", "x283fyep35")
        self._configured = bool(self.token)

    def is_ready(self) -> bool:
        return self._configured and not self.dry_run

    def fetch_insights(self, num_of_days: int = 3, dimensions: list = None):
        if not self.is_ready():
            return self._mock_insights(num_of_days)
        params = {"numOfDays": num_of_days}
        if dimensions:
            for i, dim in enumerate(dimensions[:3], 1):
                params[f"dimension{i}"] = dim
        headers = {"Authorization": f"Bearer {self.token}"}
        try:
            r = requests.get(self.BASE_URL, headers=headers, params=params, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"  ⚠️  Clarity API error: {e}")
            return self._mock_insights(num_of_days)

    def fetch_lp_metrics(self, lookback_days: int = 3):
        """LP別の指標を整形して返す"""
        raw = self.fetch_insights(num_of_days=lookback_days, dimensions=["URL"])
        rows = []
        for metric_group in raw if isinstance(raw, list) else []:
            metric_name = metric_group.get("metricName", "")
            for info in metric_group.get("information", []):
                rows.append({
                    "metric": metric_name,
                    "url": info.get("Url") or info.get("url", ""),
                    "value": info.get("value") or info.get("Value", 0),
                })
        return rows

    def _mock_insights(self, lookback_days):
        return [
            {
                "metricName": "Sessions",
                "information": [{"Url": "/a/one_person_room-softbank-air", "value": 12}],
            },
            {
                "metricName": "RageClicks",
                "information": [{"Url": "/a/one_person_room-softbank-air", "value": 1}],
            },
            {
                "metricName": "DeadClicks",
                "information": [{"Url": "/a/one_person_room-softbank-air", "value": 0}],
            },
            {
                "metricName": "QuickBacks",
                "information": [{"Url": "/a/one_person_room-softbank-air", "value": 3}],
            },
        ]
