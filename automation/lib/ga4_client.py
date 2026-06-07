"""GA4 Data API ラッパー"""
import os
import json
from datetime import date, timedelta


class GA4Client:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run or os.getenv("DRY_RUN", "false").lower() == "true"
        self.property_id = os.getenv("GA4_PROPERTY_ID", "")
        self.service_account_json = os.getenv("GA4_SERVICE_ACCOUNT_JSON", "")
        self._configured = bool(self.property_id and self.service_account_json)
        self.client = None
        if self._configured and not self.dry_run:
            self._init_client()

    def _init_client(self):
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.oauth2 import service_account
        info = json.loads(self.service_account_json)
        creds = service_account.Credentials.from_service_account_info(info)
        self.client = BetaAnalyticsDataClient(credentials=creds)

    def is_ready(self) -> bool:
        return self._configured and not self.dry_run

    def fetch_lp_performance(self, lookback_days: int = 7):
        if not self.is_ready():
            return self._mock_lp_performance(lookback_days)
        from google.analytics.data_v1beta.types import (
            DateRange, Dimension, Metric, RunReportRequest, FilterExpression, Filter
        )
        req = RunReportRequest(
            property=f"properties/{self.property_id}",
            date_ranges=[DateRange(start_date=f"{lookback_days}daysAgo", end_date="yesterday")],
            dimensions=[
                Dimension(name="date"),
                Dimension(name="pagePath"),
                Dimension(name="sessionDefaultChannelGroup"),
            ],
            metrics=[
                Metric(name="sessions"),
                Metric(name="activeUsers"),
                Metric(name="averageSessionDuration"),
                Metric(name="bounceRate"),
                Metric(name="engagementRate"),
                Metric(name="screenPageViews"),
                Metric(name="eventCount"),
            ],
            dimension_filter=FilterExpression(
                filter=Filter(
                    field_name="pagePath",
                    string_filter=Filter.StringFilter(value="/a/", match_type=Filter.StringFilter.MatchType.CONTAINS),
                )
            ),
        )
        resp = self.client.run_report(req)
        rows = []
        for row in resp.rows:
            d = {dim.name: val.value for dim, val in zip(resp.dimension_headers, row.dimension_values)}
            m = {met.name: val.value for met, val in zip(resp.metric_headers, row.metric_values)}
            rows.append({
                "date": d.get("date"),
                "lp_path": d.get("pagePath"),
                "source_channel": d.get("sessionDefaultChannelGroup"),
                "sessions": int(m.get("sessions", 0)),
                "users": int(m.get("activeUsers", 0)),
                "avg_engagement_time_sec": float(m.get("averageSessionDuration", 0)),
                "bounce_rate": float(m.get("bounceRate", 0)),
                "engagement_rate": float(m.get("engagementRate", 0)),
                "page_views": int(m.get("screenPageViews", 0)),
                "event_count": int(m.get("eventCount", 0)),
            })
        return rows

    def fetch_cta_click_events(self, lookback_days: int = 7):
        if not self.is_ready():
            return self._mock_cta_clicks(lookback_days)
        from google.analytics.data_v1beta.types import (
            DateRange, Dimension, Metric, RunReportRequest, FilterExpression, Filter
        )
        req = RunReportRequest(
            property=f"properties/{self.property_id}",
            date_ranges=[DateRange(start_date=f"{lookback_days}daysAgo", end_date="yesterday")],
            dimensions=[Dimension(name="date"), Dimension(name="pagePath")],
            metrics=[Metric(name="eventCount")],
            dimension_filter=FilterExpression(
                filter=Filter(
                    field_name="eventName",
                    string_filter=Filter.StringFilter(value="cta_click", match_type=Filter.StringFilter.MatchType.EXACT),
                )
            ),
        )
        resp = self.client.run_report(req)
        return [
            {
                "date": row.dimension_values[0].value,
                "lp_path": row.dimension_values[1].value,
                "cta_clicks": int(row.metric_values[0].value),
            }
            for row in resp.rows
        ]

    # ---------- Mock ----------
    def _mock_lp_performance(self, lookback_days):
        today = date.today()
        return [{
            "date": str(today - timedelta(days=1)),
            "lp_path": "/a/one_person_room-softbank-air",
            "source_channel": "Paid Search",
            "sessions": 12, "users": 11,
            "avg_engagement_time_sec": 38.5,
            "bounce_rate": 0.62, "engagement_rate": 0.38,
            "page_views": 14, "event_count": 84,
        }]

    def _mock_cta_clicks(self, lookback_days):
        return [{
            "date": str(date.today() - timedelta(days=1)),
            "lp_path": "/a/one_person_room-softbank-air",
            "cta_clicks": 4,
        }]
