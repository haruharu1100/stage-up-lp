"""
profit_calculator.py
==================================================================
利益計算を行うファイル。

  粗利益 = 販売価格 - 仕入れ価格 - 販売手数料 - 送料 - その他費用
  利益率 = 粗利益 ÷ 販売価格 × 100
==================================================================
"""

from src.models import Product


def calc_gross_profit(
    sell_price: float,
    cost_price: float,
    sales_fee: float,
    shipping: float,
    other_cost: float,
) -> float:
    """粗利益を計算して返す。"""
    return sell_price - cost_price - sales_fee - shipping - other_cost


def calc_profit_rate(gross_profit: float, sell_price: float) -> float:
    """
    利益率(%)を計算して返す。

    販売価格が0以下のときは計算できないので 0.0 を返します。
    """
    if sell_price <= 0:
        return 0.0
    return gross_profit / sell_price * 100.0


def apply_profit(product: Product) -> Product:
    """
    Product に粗利益・利益率をセットして返す。

    main.py から1件ずつ呼び出して使います。
    """
    product.gross_profit = calc_gross_profit(
        sell_price=product.sell_price,
        cost_price=product.cost_price,
        sales_fee=product.sales_fee,
        shipping=product.shipping,
        other_cost=product.other_cost,
    )
    product.profit_rate = calc_profit_rate(
        gross_profit=product.gross_profit,
        sell_price=product.sell_price,
    )
    return product
