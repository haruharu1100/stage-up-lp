"""
csv_reader.py
==================================================================
仕入れ先データのCSVファイルを読み込み、Productのリストに変換します。

入力CSVに必要な列(ヘッダー名):
  管理番号, 商品名, JANコード, 型番, 仕入れ先, 仕入れURL,
  仕入れ価格, 在庫数, 販売先, 販売価格, 販売手数料, 送料,
  その他費用, 過去1ヶ月販売数, 競合数, 禁止商品リスク

※ 列の順番は自由です(ヘッダー名で対応づけます)。
※ 余計な列があっても無視します。
※ 数値が空欄のときは 0 として扱います。
==================================================================
"""

import csv
from pathlib import Path
from typing import List

from src.models import Product


# 入力CSVのヘッダー名 → Productの属性名
_FIELD_MAP = {
    "管理番号": "management_no",
    "商品名": "product_name",
    "JANコード": "jan_code",
    "型番": "model_no",
    "仕入れ先": "supplier",
    "仕入れURL": "supplier_url",
    "仕入れ価格": "cost_price",
    "在庫数": "stock",
    "販売先": "sales_channel",
    "販売価格": "sell_price",
    "販売手数料": "sales_fee",
    "送料": "shipping",
    "その他費用": "other_cost",
    "過去1ヶ月販売数": "monthly_sales",
    "競合数": "competitors",
    "禁止商品リスク": "prohibited_risk_input",
}

# 数値として読み込む項目
_FLOAT_FIELDS = {"cost_price", "sell_price", "sales_fee", "shipping", "other_cost"}
_INT_FIELDS = {"stock", "monthly_sales", "competitors"}


def _to_float(value: str) -> float:
    """文字列を数値(小数)に変換。カンマや空欄にも対応。"""
    if value is None:
        return 0.0
    text = str(value).replace(",", "").replace("円", "").strip()
    if text == "":
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _to_int(value: str) -> int:
    """文字列を整数に変換。"""
    return int(_to_float(value))


def read_products(csv_path) -> List[Product]:
    """
    CSVファイルを読み込み、Productのリストを返す。

    引数:
        csv_path: 読み込むCSVファイルのパス
    """
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(
            f"CSVファイルが見つかりません: {path}\n"
            f"パスが正しいか、ファイルが存在するか確認してください。"
        )

    products: List[Product] = []

    # utf-8-sig にすることでExcel保存のCSV(BOM付き)も文字化けせず読めます
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        if reader.fieldnames is None:
            raise ValueError("CSVが空、またはヘッダー行がありません。")

        # 列名の前後の空白を取り除いておく
        clean_headers = {h: (h.strip() if h else h) for h in reader.fieldnames}

        for line_no, row in enumerate(reader, start=2):
            product = Product()
            for raw_header, value in row.items():
                header = clean_headers.get(raw_header, raw_header)
                attr = _FIELD_MAP.get(header)
                if attr is None:
                    continue  # 対応しない列は無視

                if attr in _FLOAT_FIELDS:
                    setattr(product, attr, _to_float(value))
                elif attr in _INT_FIELDS:
                    setattr(product, attr, _to_int(value))
                else:
                    setattr(product, attr, (value or "").strip())

            # 管理番号も商品名も空の行(空行)はスキップ
            if not product.management_no and not product.product_name:
                continue

            products.append(product)

    return products
