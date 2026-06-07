"""
Google Ads API ラッパー
==========================
最低限の機能のみ実装:
  - キャンペーン日次パフォーマンス
  - 広告グループ日次パフォーマンス
  - キーワード日次パフォーマンス
  - 広告日次パフォーマンス
  - 検索語句レポート

開発者トークン未取得の場合はモックモードで動作。
"""
import os
import json
from datetime import date, timedelta


class GoogleAdsClient:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run or os.getenv("DRY_RUN", "false").lower() == "true"
        self.developer_token = os.getenv("GOOGLE_ADS_DEVELOPER_TOKEN", "")
        self.client_id = os.getenv("GOOGLE_ADS_CLIENT_ID", "")
        self.client_secret = os.getenv("GOOGLE_ADS_CLIENT_SECRET", "")
        self.refresh_token = os.getenv("GOOGLE_ADS_REFRESH_TOKEN", "")
        self.customer_id = os.getenv("GOOGLE_ADS_CUSTOMER_ID", "660-005-6599").replace("-", "")
        self.login_customer_id = os.getenv("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "").replace("-", "")
        self.client = None
        self._configured = bool(self.developer_token and self.refresh_token)
        if self._configured and not self.dry_run:
            self._init_client()

    def _init_client(self):
        from google.ads.googleads.client import GoogleAdsClient as _GAC
        config = {
            "developer_token": self.developer_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh_token,
            "use_proto_plus": True,
        }
        if self.login_customer_id:
            config["login_customer_id"] = self.login_customer_id
        self.client = _GAC.load_from_dict(config)

    def is_ready(self) -> bool:
        return self._configured and not self.dry_run

    def fetch_keyword_performance(self, lookback_days: int = 7):
        """キーワード別パフォーマンスを取得"""
        if not self.is_ready():
            return self._mock_keyword_performance(lookback_days)
        gaql = f"""
            SELECT
              segments.date,
              campaign.id, campaign.name,
              ad_group.id, ad_group.name,
              ad_group_criterion.keyword.text,
              ad_group_criterion.keyword.match_type,
              metrics.impressions, metrics.clicks, metrics.ctr,
              metrics.cost_micros, metrics.average_cpc,
              metrics.conversions, metrics.conversions_value,
              metrics.cost_per_conversion
            FROM keyword_view
            WHERE segments.date DURING LAST_{lookback_days}_DAYS
              AND campaign.status = 'ENABLED'
            ORDER BY metrics.cost_micros DESC
        """
        service = self.client.get_service("GoogleAdsService")
        rows = []
        stream = service.search_stream(customer_id=self.customer_id, query=gaql)
        for batch in stream:
            for r in batch.results:
                rows.append({
                    "date": str(r.segments.date),
                    "campaign_id": r.campaign.id,
                    "campaign_name": r.campaign.name,
                    "ad_group_id": r.ad_group.id,
                    "ad_group_name": r.ad_group.name,
                    "keyword": r.ad_group_criterion.keyword.text,
                    "match_type": str(r.ad_group_criterion.keyword.match_type),
                    "impressions": r.metrics.impressions,
                    "clicks": r.metrics.clicks,
                    "ctr": r.metrics.ctr,
                    "avg_cpc_jpy": r.metrics.average_cpc / 1_000_000,
                    "cost_jpy": r.metrics.cost_micros / 1_000_000,
                    "conversions": r.metrics.conversions,
                    "conversion_value_jpy": r.metrics.conversions_value,
                    "cpa_jpy": r.metrics.cost_per_conversion / 1_000_000 if r.metrics.cost_per_conversion else 0,
                })
        return rows

    def fetch_ad_performance(self, lookback_days: int = 7):
        if not self.is_ready():
            return self._mock_ad_performance(lookback_days)
        gaql = f"""
            SELECT
              segments.date,
              campaign.id, ad_group.id,
              ad_group_ad.ad.id,
              ad_group_ad.ad.type,
              ad_group_ad.ad.final_urls,
              metrics.impressions, metrics.clicks, metrics.ctr,
              metrics.cost_micros, metrics.conversions
            FROM ad_group_ad
            WHERE segments.date DURING LAST_{lookback_days}_DAYS
              AND ad_group_ad.status = 'ENABLED'
        """
        service = self.client.get_service("GoogleAdsService")
        rows = []
        stream = service.search_stream(customer_id=self.customer_id, query=gaql)
        for batch in stream:
            for r in batch.results:
                rows.append({
                    "date": str(r.segments.date),
                    "campaign_id": r.campaign.id,
                    "ad_group_id": r.ad_group.id,
                    "ad_id": r.ad_group_ad.ad.id,
                    "ad_type": str(r.ad_group_ad.ad.type),
                    "final_urls": list(r.ad_group_ad.ad.final_urls),
                    "impressions": r.metrics.impressions,
                    "clicks": r.metrics.clicks,
                    "ctr": r.metrics.ctr,
                    "cost_jpy": r.metrics.cost_micros / 1_000_000,
                    "conversions": r.metrics.conversions,
                })
        return rows

    def fetch_search_terms(self, lookback_days: int = 7):
        if not self.is_ready():
            return self._mock_search_terms(lookback_days)
        gaql = f"""
            SELECT
              segments.date,
              search_term_view.search_term,
              ad_group.id,
              metrics.impressions, metrics.clicks,
              metrics.cost_micros, metrics.conversions
            FROM search_term_view
            WHERE segments.date DURING LAST_{lookback_days}_DAYS
            ORDER BY metrics.clicks DESC
            LIMIT 200
        """
        service = self.client.get_service("GoogleAdsService")
        rows = []
        stream = service.search_stream(customer_id=self.customer_id, query=gaql)
        for batch in stream:
            for r in batch.results:
                rows.append({
                    "date": str(r.segments.date),
                    "search_term": r.search_term_view.search_term,
                    "ad_group_id": r.ad_group.id,
                    "impressions": r.metrics.impressions,
                    "clicks": r.metrics.clicks,
                    "cost_jpy": r.metrics.cost_micros / 1_000_000,
                    "conversions": r.metrics.conversions,
                })
        return rows

    # ---------- Mock data for development ----------
    def _mock_keyword_performance(self, lookback_days):
        today = date.today()
        return [
            {
                "date": str(today - timedelta(days=1)),
                "campaign_id": 1, "campaign_name": "通信比較ナビ｜一人暮らし",
                "ad_group_id": 1, "ad_group_name": "広告グループ 1",
                "keyword": kw, "match_type": "PHRASE",
                "impressions": imp, "clicks": clk,
                "ctr": clk / imp if imp else 0,
                "avg_cpc_jpy": cpc, "cost_jpy": clk * cpc,
                "conversions": cv,
                "conversion_value_jpy": cv * 10000,
                "cpa_jpy": (clk * cpc) / cv if cv else 0,
            }
            for kw, imp, clk, cpc, cv in [
                ("\"一人暮らし WiFi おすすめ\"", 30, 6, 220, 1),
                ("\"一人暮らし ホームルーター\"", 18, 5, 200, 0),
                ("\"引っ越し ネット 即日\"", 8, 1, 250, 0),
                ("\"工事不要 WiFi 1人\"", 0, 0, 0, 0),
            ]
        ]

    def _mock_ad_performance(self, lookback_days):
        return [{
            "date": str(date.today() - timedelta(days=1)),
            "campaign_id": 1, "ad_group_id": 1, "ad_id": 1001,
            "ad_type": "RESPONSIVE_SEARCH_AD",
            "final_urls": ["https://stage-up-lp.vercel.app/a/one_person_room-softbank-air"],
            "impressions": 54, "clicks": 13, "ctr": 0.24, "cost_jpy": 2301, "conversions": 0,
        }]

    def _mock_search_terms(self, lookback_days):
        return [
            {"date": str(date.today() - timedelta(days=1)), "search_term": st,
             "ad_group_id": 1, "impressions": imp, "clicks": clk, "cost_jpy": clk * 200, "conversions": cv}
            for st, imp, clk, cv in [
                ("一人暮らし wifi おすすめ ランキング", 10, 3, 1),
                ("ワンルーム ネット 工事 不要", 6, 2, 0),
                ("ホームルーター 賃貸 即日", 4, 1, 0),
            ]
        ]
