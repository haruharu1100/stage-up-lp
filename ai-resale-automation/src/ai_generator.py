"""
ai_generator.py
==================================================================
Claude API を使って、出品用の文章を自動生成するファイル。

生成する内容:
  ・SEO向け商品タイトル   → ai_title    (U列)
  ・商品説明文            → ai_description(V列)
  ・検索キーワード        → ai_keywords  (説明文/注意事項に活用)
  ・注意事項             → notes        (W列)
  ・短い商品紹介文        → ai_short_intro(説明文の冒頭に活用)

ポイント:
  ・APIキーが無い / オフラインモードのときは、APIを呼ばずに
    テンプレート文章を作るので、無料で動作確認ができます。
  ・Claudeへの指示(system)は毎回同じなので「プロンプトキャッシュ」を
    有効にして、API料金を節約しています。
==================================================================
"""

import json
from typing import Optional

import config
from src.models import Product


# ------------------------------------------------------------------
# Claudeへの共通指示(system)。毎回同じ内容なのでキャッシュ対象にします。
# ------------------------------------------------------------------
SYSTEM_PROMPT = """あなたは日本のネット物販(EC)に詳しいプロの出品ライターです。
与えられた商品情報をもとに、購入されやすい出品ページの文章を作成します。

【守ること】
- 日本語で書く。
- 誇大広告・断定的な効果効能・虚偽の表現は使わない。
- 在庫情報や価格は文章に直接書かない(変動するため)。
- 商品名・型番・JANと矛盾しない内容にする。
- 健康/医薬/ブランド品など規約に触れそうな場合は注意事項で必ず触れる。

【必ず次のJSON形式だけを返す(前後に説明文やコードブロックは付けない)】
{
  "title": "SEOを意識した60文字以内の商品タイトル",
  "short_intro": "40文字程度の短いキャッチコピー",
  "description": "300〜500文字程度の商品説明文(改行可)",
  "keywords": ["検索キーワード", "を", "5〜10個"],
  "notes": "出品者・購入者向けの注意事項(規約・保証・状態など)"
}
"""


def _build_user_prompt(product: Product) -> str:
    """1商品分の情報を、Claudeへの依頼文(user)にまとめる。"""
    return (
        "次の商品の出品文章を作成してください。\n\n"
        f"商品名: {product.product_name}\n"
        f"型番: {product.model_no}\n"
        f"JANコード: {product.jan_code}\n"
        f"販売先: {product.sales_channel}\n"
        f"カテゴリの参考(仕入れ先): {product.supplier}\n"
        f"禁止商品リスク判定: {product.prohibited_risk}\n"
    )


# ------------------------------------------------------------------
# オフライン(テンプレート)生成:APIを使わない場合
# ------------------------------------------------------------------
def _generate_offline(product: Product) -> dict:
    name = product.product_name or "商品"
    model = f"【型番:{product.model_no}】" if product.model_no else ""
    notes = "中古/新品の状態は商品により異なります。購入前に商品説明をご確認ください。"
    if product.prohibited_risk == "あり":
        notes = (
            "【要確認】この商品は出品規約に触れる可能性があります。"
            "出品前に各販売サイトの最新の禁止商品ルールを必ず確認してください。"
        )
    return {
        "title": f"{name}{model} 送料無料 即日発送"[:60],
        "short_intro": f"{name}を探している方におすすめ!",
        "description": (
            f"{name} のご案内です。\n\n"
            f"{model}\n"
            "気になる方はこの機会にぜひご検討ください。\n"
            "ご不明点はお気軽にお問い合わせください。\n\n"
            "※この説明文はテンプレートで自動生成されています。"
            "出品前に内容をご確認・編集してください。"
        ),
        "keywords": [name, product.model_no, product.jan_code, "送料無料", "即日発送"],
        "notes": notes,
    }


# ------------------------------------------------------------------
# Claude API クライアント(1回だけ作って使い回す)
# ------------------------------------------------------------------
_client = None


def _get_client():
    """Anthropicクライアントを用意する。失敗したら None を返す。"""
    global _client
    if _client is not None:
        return _client
    try:
        from anthropic import Anthropic
    except ImportError:
        return None
    if not config.ANTHROPIC_API_KEY:
        return None
    _client = Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


def _parse_json(text: str) -> Optional[dict]:
    """Claudeの返事からJSON部分を取り出して辞書にする。"""
    text = (text or "").strip()
    # 念のためコードブロック記号を取り除く
    if text.startswith("```"):
        text = text.strip("`")
        # ```json などの言語名を除去
        if "\n" in text:
            text = text.split("\n", 1)[1]
    # 最初の { から最後の } までを取り出す
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def _generate_online(product: Product) -> dict:
    """Claude APIを呼んで文章を生成する。失敗時はオフライン生成にフォールバック。"""
    client = _get_client()
    if client is None:
        return _generate_offline(product)

    try:
        message = client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=1500,
            # systemは毎回同じなのでキャッシュして料金を節約
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {"role": "user", "content": _build_user_prompt(product)}
            ],
        )
        # 返ってきたテキストをつなげる
        text = "".join(
            block.text for block in message.content if getattr(block, "type", "") == "text"
        )
        data = _parse_json(text)
        if data is None:
            # JSONとして読めなかった場合はテンプレにフォールバック
            return _generate_offline(product)
        return data
    except Exception as e:
        # API側のエラー(残高不足・通信エラー等)でも処理を止めない
        print(f"  [警告] AI生成に失敗したためテンプレートを使用します: {e}")
        return _generate_offline(product)


def generate_for_product(product: Product) -> Product:
    """
    1商品に対してAI文章を生成し、Productにセットして返す。
    """
    if config.USE_AI_OFFLINE_MODE:
        data = _generate_offline(product)
    else:
        data = _generate_online(product)

    # キーワードはリストでも文字列でも受け取れるようにする
    keywords = data.get("keywords", "")
    if isinstance(keywords, list):
        keywords = ", ".join(str(k) for k in keywords if k)

    product.ai_title = str(data.get("title", "")).strip()
    product.ai_short_intro = str(data.get("short_intro", "")).strip()
    product.ai_description = str(data.get("description", "")).strip()
    product.ai_keywords = str(keywords).strip()
    product.notes = str(data.get("notes", "")).strip()

    # 説明文の中に短い紹介文・検索キーワードもまとめて入れておく
    extra = []
    if product.ai_short_intro:
        extra.append(product.ai_short_intro)
    if product.ai_description:
        extra.append(product.ai_description)
    if product.ai_keywords:
        extra.append(f"【検索キーワード】{product.ai_keywords}")
    product.ai_description = "\n\n".join(extra)

    return product
