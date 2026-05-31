"""
config.py
==================================================================
システム全体の設定をまとめるファイル。

.env ファイルから値を読み込み、プログラムの各所で使える形にします。
初心者の方は基本的にここを直接いじる必要はありません。
設定を変えたいときは .env ファイルを編集してください。
==================================================================
"""

import os
from pathlib import Path

# .env を読み込む(python-dotenvが無くてもエラーで止まらないようにする)
try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    # python-dotenv が未インストールでも、OSの環境変数だけで動かせるようにする
    pass


# ------------------------------------------------------------------
# よく使うフォルダのパス
# ------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = DATA_DIR / "output"
SAMPLE_INPUT_CSV = DATA_DIR / "sample_input.csv"

# 出力フォルダが無ければ作る
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ------------------------------------------------------------------
# 小さな便利関数:環境変数を読みやすく取り出す
# ------------------------------------------------------------------
def _get_str(key: str, default: str = "") -> str:
    value = os.getenv(key)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def _get_int(key: str, default: int) -> int:
    raw = _get_str(key, "")
    if raw == "":
        return default
    try:
        return int(float(raw))
    except ValueError:
        return default


def _get_bool(key: str, default: bool) -> bool:
    raw = _get_str(key, "").lower()
    if raw == "":
        return default
    return raw in ("1", "true", "yes", "on", "はい")


# ------------------------------------------------------------------
# Claude API 設定
# ------------------------------------------------------------------
ANTHROPIC_API_KEY = _get_str("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = _get_str("CLAUDE_MODEL", "claude-sonnet-4-6")

# AIを使わずテンプレ文章で動かすモード
USE_AI_OFFLINE_MODE = _get_bool("USE_AI_OFFLINE_MODE", False)

# AI文章を生成する対象の判定(カンマ区切り)
AI_TARGET_JUDGMENTS = [
    s.strip()
    for s in _get_str("AI_TARGET_JUDGMENTS", "出品候補,要確認").split(",")
    if s.strip()
]


# ------------------------------------------------------------------
# 利益・判定のしきい値
# ------------------------------------------------------------------
MIN_PROFIT_RATE = _get_int("MIN_PROFIT_RATE", 25)      # 利益率の下限(%)
MIN_MONTHLY_SALES = _get_int("MIN_MONTHLY_SALES", 1)   # 過去1ヶ月販売数の下限(個)
MIN_STOCK = _get_int("MIN_STOCK", 1)                   # 在庫数の下限(個)


# ------------------------------------------------------------------
# Googleスプレッドシート連携設定(任意)
# ------------------------------------------------------------------
GOOGLE_SERVICE_ACCOUNT_FILE = _get_str(
    "GOOGLE_SERVICE_ACCOUNT_FILE", "credentials/service_account.json"
)
GOOGLE_SPREADSHEET_ID = _get_str("GOOGLE_SPREADSHEET_ID", "")
GOOGLE_WORKSHEET_NAME = _get_str("GOOGLE_WORKSHEET_NAME", "出品候補")


# ------------------------------------------------------------------
# 禁止商品リスクの判定に使うキーワード
# ------------------------------------------------------------------
# 商品名や型番にこれらの言葉が含まれていたら「禁止商品リスクあり」と判定します。
# 各販売サイトの最新規約に合わせて自由に追加・削除してください。
# (あくまで簡易チェックです。最終判断は必ず人間が行ってください)
PROHIBITED_KEYWORDS = [
    # 医薬品・健康
    "医薬品", "処方薬", "睡眠薬", "向精神薬", "コンタクトレンズ", "サプリ",
    # 武器・危険物
    "銃", "拳銃", "ナイフ", "刀", "火薬", "花火", "スタンガン", "催涙",
    # 酒・たばこ
    "酒", "ウイスキー", "ワイン", "たばこ", "タバコ", "電子タバコ", "リキッド",
    # 偽ブランド・知的財産
    "コピー品", "偽物", "レプリカ", "海賊版",
    # 食品(賞味期限・許可が必要なもの)
    "生もの", "冷凍食品", "手作り食品",
    # その他リスク
    "チケット", "金券", "商品券", "現金", "リチウム電池単体",
]
