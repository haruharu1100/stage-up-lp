"""
csv_writer.py
==================================================================
判定・AI生成が終わった商品リストを、CSVファイルに書き出します。

  - 出力はスプレッドシートの A〜Z 列と同じ並びです。
  - 文字コードは utf-8-sig なのでExcelで開いても文字化けしません。
  - Googleスプレッドシートにもそのまま貼り付け/インポートできます。
==================================================================
"""

import csv
from pathlib import Path
from typing import List

from src.models import Product, COLUMNS


def write_products(products: List[Product], output_path) -> Path:
    """
    ProductのリストをCSVに書き出す。

    引数:
        products:    書き出す商品のリスト
        output_path: 出力先のCSVファイルパス
    返り値:
        書き出したファイルのパス
    """
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(COLUMNS)  # ヘッダー(A〜Z)
        for product in products:
            writer.writerow(product.to_row())

    return path
