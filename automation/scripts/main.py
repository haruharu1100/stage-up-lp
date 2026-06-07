#!/usr/bin/env python3
"""
AI自動広告改善システム メインエントリポイント
==================================================

毎日 GitHub Actions から呼ばれて以下を実行:
  1. Google広告 / GA4 / Clarity からデータ取得
  2. Google Sheets に保存
  3. Claude API で分析・改善案生成
  4. メール通知

ローカル実行:
  cd automation && python3 scripts/main.py
"""
import os
import sys
import json
from pathlib import Path
from datetime import datetime

# パスを通す
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
import yaml

# .env 読込（ローカル開発用）
load_dotenv(ROOT / ".env")

from lib.google_ads_client import GoogleAdsClient
from lib.ga4_client import GA4Client
from lib.clarity_client import ClarityClient
from lib.sheets_client import SheetsClient
from lib.claude_client import ClaudeClient

REPORTS_DIR = ROOT / "reports"
CONFIG_DIR = ROOT / "config"


def load_thresholds():
    with open(CONFIG_DIR / "thresholds.yml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_prompt(name: str) -> str:
    with open(CONFIG_DIR / "prompts" / f"{name}.md", encoding="utf-8") as f:
        return f.read()


def run_etl(lookback_days: int):
    """各APIからデータ取得"""
    print(f"\n[ETL] Lookback: {lookback_days} days")

    ads = GoogleAdsClient()
    ga4 = GA4Client()
    clarity = ClarityClient()

    print(f"  Google Ads: {'READY' if ads.is_ready() else 'MOCK MODE'}")
    print(f"  GA4:        {'READY' if ga4.is_ready() else 'MOCK MODE'}")
    print(f"  Clarity:    {'READY' if clarity.is_ready() else 'MOCK MODE'}")

    keywords = ads.fetch_keyword_performance(lookback_days)
    ad_perf = ads.fetch_ad_performance(lookback_days)
    search_terms = ads.fetch_search_terms(lookback_days)
    lp_perf = ga4.fetch_lp_performance(lookback_days)
    cta_clicks = ga4.fetch_cta_click_events(lookback_days)
    clarity_metrics = clarity.fetch_lp_metrics(min(lookback_days, 3))

    print(f"  ✓ keywords:      {len(keywords)}")
    print(f"  ✓ ads:           {len(ad_perf)}")
    print(f"  ✓ search_terms:  {len(search_terms)}")
    print(f"  ✓ lp_perf:       {len(lp_perf)}")
    print(f"  ✓ cta_clicks:    {len(cta_clicks)}")
    print(f"  ✓ clarity:       {len(clarity_metrics)}")

    return {
        "keywords": keywords,
        "ads": ad_perf,
        "search_terms": search_terms,
        "lp_perf": lp_perf,
        "cta_clicks": cta_clicks,
        "clarity": clarity_metrics,
    }


def save_to_sheets(data: dict):
    """Google Sheets に保存"""
    print("\n[Sheets] Saving...")
    sheets = SheetsClient()
    if not sheets.is_ready():
        print("  → DRY RUN (no SHEETS_ID configured)")
        return

    sheets.append_rows("kw_daily", data["keywords"])
    sheets.append_rows("ad_daily", data["ads"])
    sheets.append_rows("search_terms", data["search_terms"])
    sheets.append_rows("lp_daily", data["lp_perf"])
    sheets.append_rows("cta_clicks", data["cta_clicks"])
    sheets.append_rows("clarity_daily", data["clarity"])
    print("  ✓ saved")


def run_analysis(data: dict, thresholds: dict):
    """Claude API で分析・改善案生成"""
    print("\n[Claude] Analyzing...")
    claude = ClaudeClient()
    print(f"  Claude: {'READY' if claude.is_ready() else 'MOCK MODE'}")

    template = load_prompt("summary")
    prompt = (
        template
        .replace("{{KEYWORDS_JSON}}", json.dumps(data["keywords"], ensure_ascii=False, default=str)[:8000])
        .replace("{{ADS_JSON}}", json.dumps(data["ads"], ensure_ascii=False, default=str)[:4000])
        .replace("{{SEARCH_TERMS_JSON}}", json.dumps(data["search_terms"], ensure_ascii=False, default=str)[:6000])
        .replace("{{LP_JSON}}", json.dumps(data["lp_perf"], ensure_ascii=False, default=str)[:6000])
        .replace("{{CTA_CLICKS_JSON}}", json.dumps(data["cta_clicks"], ensure_ascii=False, default=str)[:2000])
        .replace("{{CLARITY_JSON}}", json.dumps(data["clarity"], ensure_ascii=False, default=str)[:4000])
        .replace("{{THRESHOLDS_JSON}}", json.dumps(thresholds, ensure_ascii=False))
    )

    insights = claude.analyze_json(prompt, max_tokens=4096)
    print(f"  ✓ insights generated")

    # ファイル保存
    REPORTS_DIR.mkdir(exist_ok=True)
    out = REPORTS_DIR / f"insights-{datetime.now():%Y%m%d-%H%M%S}.json"
    out.write_text(json.dumps(insights, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  → {out}")

    # 同時に Sheets の insights タブにも記録（簡易）
    sheets = SheetsClient()
    if sheets.is_ready():
        rows = []
        today = datetime.now().strftime("%Y-%m-%d")
        for cat in ["kw_stop", "kw_boost", "ad_improve", "lp_improve", "urgent_actions"]:
            for item in insights.get(cat, []) or []:
                rows.append({
                    "created_at": today,
                    "category": cat,
                    "data_json": json.dumps(item, ensure_ascii=False),
                })
        if rows:
            sheets.append_rows("insights", rows)

    return insights


def send_notification(insights: dict):
    """メール通知"""
    print("\n[Notify] Sending...")
    from scripts.notify import send_daily_report
    try:
        send_daily_report(insights)
        print("  ✓ sent")
    except Exception as e:
        print(f"  ⚠️  notification error: {e}")


def main():
    print(f"\n{'='*60}")
    print(f"AI自動広告改善システム 開始: {datetime.now()}")
    print(f"{'='*60}")

    thresholds = load_thresholds()
    lookback = thresholds.get("analysis", {}).get("lookback_days", 7)

    data = run_etl(lookback)
    save_to_sheets(data)
    insights = run_analysis(data, thresholds)
    send_notification(insights)

    print(f"\n{'='*60}")
    print(f"完了: {datetime.now()}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
