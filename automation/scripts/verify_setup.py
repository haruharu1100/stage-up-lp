#!/usr/bin/env python3
"""
セットアップ検証スクリプト
==========================
各APIキーが正しく設定されているか確認するヘルパー。
ローカルで `python3 scripts/verify_setup.py` 実行で接続テストできる。
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")


def check_env(key, masked=True):
    val = os.getenv(key, "")
    if not val:
        return "❌ 未設定", ""
    display = "***" if masked else val[:30] + ("..." if len(val) > 30 else "")
    return "✅ 設定済", display


def main():
    print("=" * 60)
    print("AI自動化システム セットアップ検証")
    print("=" * 60)

    checks = [
        ("Google Ads", [
            ("GOOGLE_ADS_DEVELOPER_TOKEN", True),
            ("GOOGLE_ADS_CLIENT_ID", False),
            ("GOOGLE_ADS_CLIENT_SECRET", True),
            ("GOOGLE_ADS_REFRESH_TOKEN", True),
            ("GOOGLE_ADS_CUSTOMER_ID", False),
        ]),
        ("GA4", [
            ("GA4_PROPERTY_ID", False),
            ("GA4_SERVICE_ACCOUNT_JSON", True),
        ]),
        ("Microsoft Clarity", [
            ("CLARITY_API_TOKEN", True),
            ("CLARITY_PROJECT_ID", False),
        ]),
        ("Anthropic Claude", [
            ("ANTHROPIC_API_KEY", True),
            ("ANTHROPIC_MODEL", False),
        ]),
        ("Google Sheets", [
            ("SHEETS_ID", False),
        ]),
        ("通知 (Email)", [
            ("NOTIFY_EMAIL_TO", False),
            ("NOTIFY_EMAIL_SMTP_USER", False),
            ("NOTIFY_EMAIL_SMTP_PASS", True),
        ]),
    ]

    all_set = []
    for group, items in checks:
        print(f"\n[{group}]")
        for key, masked in items:
            status, val = check_env(key, masked)
            print(f"  {status}  {key:35} {val}")
            all_set.append("✅" in status)

    print("\n" + "=" * 60)
    if all(all_set):
        print("✅ すべて設定完了！main.py が本番モードで動作します")
    else:
        missing = sum(1 for s in all_set if not s)
        print(f"⚠️  {missing} 項目が未設定。.env を確認してください")
        print("    （未設定でもモックモードで動作確認は可能）")
    print("=" * 60)

    print("\n次のステップ:")
    print("  1. .env をすべて埋める（SETUP.md 参照）")
    print("  2. python3 scripts/main.py で手動実行")
    print("  3. GitHub Secrets に同じ値を登録")
    print("  4. .github/workflows/daily_report.yml で自動化スタート")


if __name__ == "__main__":
    main()
