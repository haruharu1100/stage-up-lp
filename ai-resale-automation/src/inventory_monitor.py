"""
inventory_monitor.py
==================================================================
在庫監視ファイル。

「前回の在庫」と「今回の在庫」を比べて、変化を教えてくれます。

  ・前回より在庫が減った商品   → 注意
  ・在庫が0になった商品        → 在庫切れ警告
  ・新しく追加された商品        → 新着

仕組み:
  実行するたびに、各商品の在庫数を data/output/inventory_snapshot.json
  に保存します。次回はそれと比較して差分を出します。

  将来的に「仕入れ先APIから在庫を取得して自動監視」へ拡張できるよう、
  入力(現在の在庫)と保存(スナップショット)を分けて作っています。
==================================================================
"""

import json
from pathlib import Path
from typing import Dict, List

import config
from src.models import Product


# スナップショットの保存場所
SNAPSHOT_FILE = config.OUTPUT_DIR / "inventory_snapshot.json"


def _load_previous() -> Dict[str, int]:
    """前回保存した在庫データ(管理番号→在庫数)を読み込む。"""
    if not SNAPSHOT_FILE.exists():
        return {}
    try:
        with SNAPSHOT_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_current(products: List[Product]) -> None:
    """今回の在庫データを保存する。"""
    data = {p.management_no: p.stock for p in products if p.management_no}
    SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with SNAPSHOT_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def check_inventory(products: List[Product]) -> List[str]:
    """
    在庫の変化をチェックして、メッセージのリストを返す。
    同時に、今回の在庫をスナップショットとして保存する。
    """
    previous = _load_previous()
    messages: List[str] = []

    for product in products:
        key = product.management_no
        if not key:
            continue

        now = product.stock
        before = previous.get(key)

        if before is None:
            messages.append(f"[新着] {key} {product.product_name}(在庫 {now})")
            continue

        if now <= 0 and before > 0:
            messages.append(
                f"[在庫切れ] {key} {product.product_name}(在庫 {before} → 0)"
            )
        elif now < before:
            messages.append(
                f"[在庫減少] {key} {product.product_name}(在庫 {before} → {now})"
            )
        elif now > before:
            messages.append(
                f"[在庫増加] {key} {product.product_name}(在庫 {before} → {now})"
            )

    # 今回分を保存(次回の比較用)
    _save_current(products)

    if not messages:
        messages.append("在庫の変化はありませんでした。")

    return messages
