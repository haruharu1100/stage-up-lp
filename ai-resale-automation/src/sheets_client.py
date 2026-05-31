"""
sheets_client.py
==================================================================
Googleスプレッドシートへ結果を書き込むファイル(任意機能)。

この機能は「使いたい人だけ」使えばOKです。
使わない場合は、CSV出力だけで完結します。

事前準備(READMEの「スプレッドシート連携」を参照):
  1. Google CloudでサービスアカウントのJSON鍵を作成
  2. .env に GOOGLE_SERVICE_ACCOUNT_FILE と GOOGLE_SPREADSHEET_ID を設定
  3. 対象スプレッドシートを、サービスアカウントのメールアドレスに共有
==================================================================
"""

from pathlib import Path
from typing import List

import config
from src.models import Product, COLUMNS


def is_configured() -> bool:
    """スプレッドシート連携に必要な設定がそろっているか確認する。"""
    if not config.GOOGLE_SPREADSHEET_ID:
        return False
    if not Path(config.GOOGLE_SERVICE_ACCOUNT_FILE).exists():
        return False
    return True


def write_products(products: List[Product]) -> bool:
    """
    Productのリストをスプレッドシートに書き込む。

    返り値:
        成功したら True、設定不足やエラーなら False
    """
    if not is_configured():
        print(
            "  [情報] スプレッドシート連携は未設定のためスキップします。\n"
            "         (使う場合は .env の GOOGLE_ 設定とサービスアカウントを用意してください)"
        )
        return False

    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print(
            "  [警告] gspread / google-auth が未インストールです。\n"
            "         pip install gspread google-auth を実行してください。"
        )
        return False

    try:
        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ]
        creds = Credentials.from_service_account_file(
            config.GOOGLE_SERVICE_ACCOUNT_FILE, scopes=scopes
        )
        client = gspread.authorize(creds)
        spreadsheet = client.open_by_key(config.GOOGLE_SPREADSHEET_ID)

        # 対象シートを取得(無ければ作成)
        try:
            worksheet = spreadsheet.worksheet(config.GOOGLE_WORKSHEET_NAME)
        except gspread.WorksheetNotFound:
            worksheet = spreadsheet.add_worksheet(
                title=config.GOOGLE_WORKSHEET_NAME, rows=1000, cols=len(COLUMNS)
            )

        # 既存内容をクリアして、ヘッダー+データを書き込む
        worksheet.clear()
        rows = [COLUMNS] + [p.to_row() for p in products]
        worksheet.update(values=rows, range_name="A1")

        print(
            f"  [成功] スプレッドシートに {len(products)} 件書き込みました "
            f"(シート: {config.GOOGLE_WORKSHEET_NAME})"
        )
        return True

    except Exception as e:
        print(f"  [警告] スプレッドシート書き込みに失敗しました: {e}")
        return False
