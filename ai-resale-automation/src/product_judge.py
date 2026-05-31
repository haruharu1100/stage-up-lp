"""
product_judge.py
==================================================================
商品の「出品判定」を行うファイル。

【判定ルール(上から順にチェックします)】
  1. 赤字(粗利益がマイナス)              → 除外
  2. 在庫が足りない(在庫 < 下限)          → 在庫切れ
  3. 販売実績が無い(販売数 < 下限)        → 需要不足
  4. 利益率が低い(利益率 < 下限)          → 利益不足
  5. 禁止商品リスクあり                     → 要確認
  6. 上のどれにも当てはまらない             → 出品候補

「禁止商品リスク」は次のどちらかで「あり」と判定します。
  - 入力CSVの「禁止商品リスク」列に「あり」等が入っている
  - 商品名・型番に config.PROHIBITED_KEYWORDS の言葉が含まれている
==================================================================
"""

import config
from src.models import Product


# 判定結果のラベル(文字列)
JUDGE_EXCLUDE = "除外"          # 赤字
JUDGE_OUT_OF_STOCK = "在庫切れ"
JUDGE_NO_DEMAND = "需要不足"
JUDGE_LOW_PROFIT = "利益不足"
JUDGE_NEEDS_CHECK = "要確認"    # 禁止商品リスクあり
JUDGE_CANDIDATE = "出品候補"

# 禁止リスクの表記ゆれを吸収する(これらが入力にあれば「あり」とみなす)
_RISK_YES_WORDS = ("あり", "有", "yes", "true", "1", "○", "要確認", "注意")


def check_prohibited_risk(product: Product) -> str:
    """
    禁止商品リスクを判定して "あり" / "なし" を返す。
    """
    # 1) 入力CSVで明示的に指定されている場合
    raw = (product.prohibited_risk_input or "").strip().lower()
    if raw in [w.lower() for w in _RISK_YES_WORDS]:
        return "あり"

    # 2) 商品名・型番にキーワードが含まれる場合
    target_text = f"{product.product_name} {product.model_no}"
    for keyword in config.PROHIBITED_KEYWORDS:
        if keyword and keyword in target_text:
            return "あり"

    return "なし"


def judge(product: Product) -> Product:
    """
    Product に「禁止商品リスク」「出品判定」をセットして返す。

    ※ この関数を呼ぶ前に profit_calculator.apply_profit() で
       粗利益・利益率を計算しておいてください。
    """
    # まず禁止リスクを確定させる
    product.prohibited_risk = check_prohibited_risk(product)

    # --- 判定ルールを上から順にチェック ---
    if product.gross_profit < 0:
        product.judgment = JUDGE_EXCLUDE
    elif product.stock < config.MIN_STOCK:
        product.judgment = JUDGE_OUT_OF_STOCK
    elif product.monthly_sales < config.MIN_MONTHLY_SALES:
        product.judgment = JUDGE_NO_DEMAND
    elif product.profit_rate < config.MIN_PROFIT_RATE:
        product.judgment = JUDGE_LOW_PROFIT
    elif product.prohibited_risk == "あり":
        product.judgment = JUDGE_NEEDS_CHECK
    else:
        product.judgment = JUDGE_CANDIDATE

    # ステータスの初期値(人間の作業用)
    product.status = "未確認"

    return product
