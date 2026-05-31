"""
models.py
==================================================================
商品1件分のデータを表す「Product(プロダクト)」を定義します。

スプレッドシートの A〜Z 列とプログラムの項目を1対1で対応させています。

  A：取得日            acquired_date
  B：管理番号          management_no
  C：商品名            product_name
  D：JANコード         jan_code
  E：型番              model_no
  F：仕入れ先          supplier
  G：仕入れURL         supplier_url
  H：仕入れ価格        cost_price
  I：在庫数            stock
  J：販売先            sales_channel
  K：販売価格          sell_price
  L：販売手数料        sales_fee
  M：送料              shipping
  N：その他費用        other_cost
  O：粗利益            gross_profit   ← 計算で求める
  P：利益率            profit_rate    ← 計算で求める
  Q：過去1ヶ月販売数   monthly_sales
  R：競合数            competitors
  S：禁止商品リスク    prohibited_risk
  T：出品判定          judgment       ← 判定で求める
  U：AIタイトル        ai_title       ← AIが生成
  V：AI説明文          ai_description ← AIが生成
  W：注意事項          notes          ← AIが生成
  X：出品OKチェック    ok_check
  Y：ステータス        status
  Z：備考              remarks
==================================================================
"""

from dataclasses import dataclass, field


# スプレッドシート/CSVのヘッダー(A〜Z)。出力順もこの通りになります。
COLUMNS = [
    "取得日",            # A
    "管理番号",          # B
    "商品名",            # C
    "JANコード",         # D
    "型番",              # E
    "仕入れ先",          # F
    "仕入れURL",         # G
    "仕入れ価格",        # H
    "在庫数",            # I
    "販売先",            # J
    "販売価格",          # K
    "販売手数料",        # L
    "送料",              # M
    "その他費用",        # N
    "粗利益",            # O
    "利益率",            # P
    "過去1ヶ月販売数",   # Q
    "競合数",            # R
    "禁止商品リスク",    # S
    "出品判定",          # T
    "AIタイトル",        # U
    "AI説明文",          # V
    "注意事項",          # W
    "出品OKチェック",    # X
    "ステータス",        # Y
    "備考",              # Z
]


@dataclass
class Product:
    """商品1件分のデータ。"""

    # --- 入力(仕入れ先データ由来)---
    management_no: str = ""       # B 管理番号
    product_name: str = ""        # C 商品名
    jan_code: str = ""            # D JANコード
    model_no: str = ""            # E 型番
    supplier: str = ""            # F 仕入れ先
    supplier_url: str = ""        # G 仕入れURL
    cost_price: float = 0.0       # H 仕入れ価格
    stock: int = 0                # I 在庫数
    sales_channel: str = ""       # J 販売先
    sell_price: float = 0.0       # K 販売価格
    sales_fee: float = 0.0        # L 販売手数料
    shipping: float = 0.0         # M 送料
    other_cost: float = 0.0       # N その他費用
    monthly_sales: int = 0        # Q 過去1ヶ月販売数
    competitors: int = 0          # R 競合数
    prohibited_risk_input: str = ""  # S 入力で指定された禁止リスク("あり"等)

    # --- 計算・判定・生成で埋まる項目 ---
    acquired_date: str = ""       # A 取得日
    gross_profit: float = 0.0     # O 粗利益
    profit_rate: float = 0.0      # P 利益率
    prohibited_risk: str = ""     # S 最終的な禁止商品リスク
    judgment: str = ""            # T 出品判定
    ai_title: str = ""            # U AIタイトル
    ai_description: str = ""      # V AI説明文
    notes: str = ""               # W 注意事項
    ok_check: str = ""            # X 出品OKチェック
    status: str = ""              # Y ステータス
    remarks: str = ""             # Z 備考

    # AIが生成する追加情報(説明文や注意事項の中で利用)
    ai_keywords: str = field(default="", repr=False)   # 検索キーワード
    ai_short_intro: str = field(default="", repr=False)  # 短い紹介文

    def to_row(self) -> list:
        """スプレッドシート/CSVの1行(A〜Zの順)に変換する。"""
        return [
            self.acquired_date,                 # A
            self.management_no,                 # B
            self.product_name,                  # C
            self.jan_code,                      # D
            self.model_no,                      # E
            self.supplier,                      # F
            self.supplier_url,                  # G
            self._num(self.cost_price),         # H
            self.stock,                         # I
            self.sales_channel,                 # J
            self._num(self.sell_price),         # K
            self._num(self.sales_fee),          # L
            self._num(self.shipping),           # M
            self._num(self.other_cost),         # N
            self._num(self.gross_profit),       # O
            f"{self.profit_rate:.1f}",          # P 利益率(小数1桁)
            self.monthly_sales,                 # Q
            self.competitors,                   # R
            self.prohibited_risk,               # S
            self.judgment,                      # T
            self.ai_title,                      # U
            self.ai_description,                # V
            self.notes,                         # W
            self.ok_check,                      # X
            self.status,                        # Y
            self.remarks,                       # Z
        ]

    @staticmethod
    def _num(value: float):
        """数値を見やすく整形(整数なら小数点を付けない)。"""
        try:
            f = float(value)
        except (TypeError, ValueError):
            return value
        if f == int(f):
            return int(f)
        return round(f, 2)
