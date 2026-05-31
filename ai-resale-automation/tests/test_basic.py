"""
test_basic.py
==================================================================
かんたんな動作確認テスト。

実行方法(プロジェクトのルートフォルダで):
    python -m pytest -q
    （pytestが無くても python tests/test_basic.py で動きます)

確認内容:
  ・利益計算が正しいか
  ・出品判定が正しいか
  ・サンプルCSVが読み込めるか
==================================================================
"""

import os
import sys

# プロジェクトルートを import パスに追加
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from src.models import Product
from src.profit_calculator import calc_gross_profit, calc_profit_rate, apply_profit
from src.product_judge import judge
from src.csv_reader import read_products


def test_gross_profit():
    # 4500 - 2000 - 450 - 300 - 50 = 1700
    assert calc_gross_profit(4500, 2000, 450, 300, 50) == 1700


def test_profit_rate():
    # 1700 / 4500 * 100 = 37.7...%
    rate = calc_profit_rate(1700, 4500)
    assert 37.0 < rate < 38.0


def test_profit_rate_zero_price():
    # 販売価格0でもエラーにならず 0 を返す
    assert calc_profit_rate(100, 0) == 0.0


def test_judge_candidate():
    p = Product(
        management_no="T1", product_name="テスト商品",
        cost_price=2000, sell_price=4500, sales_fee=450,
        shipping=300, other_cost=50, stock=10, monthly_sales=5,
    )
    apply_profit(p)
    judge(p)
    assert p.judgment == "出品候補"


def test_judge_low_profit():
    p = Product(
        management_no="T2", product_name="薄利商品",
        cost_price=4000, sell_price=4500, sales_fee=450,
        shipping=300, other_cost=50, stock=10, monthly_sales=5,
    )
    apply_profit(p)
    judge(p)
    # 粗利 = 4500-4000-450-300-50 = -300 → 赤字 → 除外
    assert p.judgment == "除外"


def test_judge_out_of_stock():
    p = Product(
        management_no="T3", product_name="在庫なし商品",
        cost_price=1000, sell_price=3000, sales_fee=300,
        shipping=200, other_cost=0, stock=0, monthly_sales=5,
    )
    apply_profit(p)
    judge(p)
    assert p.judgment == "在庫切れ"


def test_judge_no_demand():
    p = Product(
        management_no="T4", product_name="売れてない商品",
        cost_price=1000, sell_price=3000, sales_fee=300,
        shipping=200, other_cost=0, stock=10, monthly_sales=0,
    )
    apply_profit(p)
    judge(p)
    assert p.judgment == "需要不足"


def test_judge_prohibited():
    p = Product(
        management_no="T5", product_name="ブランド風 レプリカ 腕時計",
        cost_price=1000, sell_price=5000, sales_fee=500,
        shipping=300, other_cost=50, stock=10, monthly_sales=4,
    )
    apply_profit(p)
    judge(p)
    assert p.prohibited_risk == "あり"
    assert p.judgment == "要確認"


def test_read_sample_csv():
    products = read_products(config.SAMPLE_INPUT_CSV)
    assert len(products) == 10
    assert products[0].management_no == "A001"


# pytestが無くても直接実行できるようにする
if __name__ == "__main__":
    funcs = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in funcs:
        try:
            fn()
            print(f"  OK  {fn.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  NG  {fn.__name__}  {e}")
        except Exception as e:
            print(f"  ERR {fn.__name__}  {e}")
    print(f"\n{passed}/{len(funcs)} 件のテストに合格しました。")
