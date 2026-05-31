"""
main.py
==================================================================
AI物販自動化システム メインプログラム。

このファイルを実行すると、次の流れで処理します。

  1. 仕入れ先データのCSVを読み込む
  2. 利益(粗利益・利益率)を計算する
  3. 出品判定をする(出品候補/利益不足/需要不足/在庫切れ/要確認/除外)
  4. 出品候補・要確認の商品に、AIで出品文章を作る
  5. 在庫の変化をチェックする
  6. 結果をCSVに出力する
  7. (設定があれば)Googleスプレッドシートに書き込む

【基本の使い方】
  python main.py
      → data/sample_input.csv を読み込んで処理します。

  python main.py --input 自分のファイル.csv
      → 好きなCSVを指定できます。

  python main.py --no-ai
      → AI文章生成をスキップ(判定だけ高速に確認したいとき)。

  python main.py --only-candidates
      → 出力を「出品候補」「要確認」だけに絞ります。
==================================================================
"""

import argparse
import sys
from datetime import datetime

import config
from src.csv_reader import read_products
from src.csv_writer import write_products
from src.profit_calculator import apply_profit
from src.product_judge import judge
from src.ai_generator import generate_for_product
from src.inventory_monitor import check_inventory
from src import sheets_client


def parse_args():
    parser = argparse.ArgumentParser(
        description="AI物販自動化システム(出品候補作成ツール)"
    )
    parser.add_argument(
        "--input",
        "-i",
        default=str(config.SAMPLE_INPUT_CSV),
        help="読み込むCSVファイルのパス(省略時はサンプルを使用)",
    )
    parser.add_argument(
        "--output",
        "-o",
        default="",
        help="出力CSVファイルのパス(省略時は data/output に自動命名)",
    )
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="AI文章の生成をスキップする",
    )
    parser.add_argument(
        "--only-candidates",
        action="store_true",
        help="出力を「出品候補」「要確認」だけに絞る",
    )
    parser.add_argument(
        "--no-sheets",
        action="store_true",
        help="Googleスプレッドシートへの書き込みをしない",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    today = datetime.now().strftime("%Y-%m-%d")

    print("=" * 60)
    print(" AI物販自動化システム(出品候補作成ツール)")
    print("=" * 60)

    # --- 1. CSV読み込み ---
    print(f"\n[1/6] CSVを読み込みます: {args.input}")
    try:
        products = read_products(args.input)
    except FileNotFoundError as e:
        print(f"\n[エラー] {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n[エラー] CSVの読み込みに失敗しました: {e}")
        sys.exit(1)

    if not products:
        print("[エラー] 商品データが0件でした。CSVの中身を確認してください。")
        sys.exit(1)
    print(f"      → {len(products)} 件の商品を読み込みました。")

    # --- 2. 利益計算 & 3. 判定 ---
    print("\n[2/6] 利益を計算します。")
    print("[3/6] 出品判定をします。")
    for product in products:
        product.acquired_date = today
        apply_profit(product)   # 粗利益・利益率
        judge(product)          # 禁止リスク・出品判定

    # 判定の件数を集計して表示
    counts = {}
    for p in products:
        counts[p.judgment] = counts.get(p.judgment, 0) + 1
    print("      判定結果の内訳:")
    for label, num in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"        {label}: {num} 件")

    # --- 4. AI文章生成 ---
    if args.no_ai:
        print("\n[4/6] AI文章生成: スキップしました(--no-ai)")
    else:
        targets = [p for p in products if p.judgment in config.AI_TARGET_JUDGMENTS]
        mode = "オフライン(テンプレート)" if (
            config.USE_AI_OFFLINE_MODE or not config.ANTHROPIC_API_KEY
        ) else f"Claude API({config.CLAUDE_MODEL})"
        print(f"\n[4/6] AI文章を生成します。対象 {len(targets)} 件 / モード: {mode}")
        for idx, product in enumerate(targets, start=1):
            print(f"      ({idx}/{len(targets)}) {product.product_name}")
            generate_for_product(product)

    # --- 5. 在庫監視 ---
    print("\n[5/6] 在庫の変化をチェックします。")
    for msg in check_inventory(products):
        print(f"      {msg}")

    # --- 出力対象を絞る(任意)---
    output_products = products
    if args.only_candidates:
        output_products = [
            p for p in products if p.judgment in ("出品候補", "要確認")
        ]
        print(f"\n      出力対象を {len(output_products)} 件に絞りました(出品候補・要確認)。")

    # --- 6. CSV出力 ---
    if args.output:
        out_path = args.output
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = config.OUTPUT_DIR / f"listing_candidates_{stamp}.csv"

    print("\n[6/6] 結果をCSVに出力します。")
    saved = write_products(output_products, out_path)
    print(f"      → 出力しました: {saved}")

    # --- (任意)Googleスプレッドシートへ書き込み ---
    if not args.no_sheets:
        print("\n[+] Googleスプレッドシートへの書き込みを試みます。")
        sheets_client.write_products(output_products)

    print("\n" + "=" * 60)
    print(" 完了しました!")
    print(" 出力CSVを開いて内容を確認し、X列「出品OKチェック」を付けてから")
    print(" 各販売サイトの規約を確認のうえ、手動で出品してください。")
    print("=" * 60)


if __name__ == "__main__":
    main()
