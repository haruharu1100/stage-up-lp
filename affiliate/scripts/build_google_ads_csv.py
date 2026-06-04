#!/usr/bin/env python3
"""
Google広告 一括入稿用 CSV / シート生成
=========================================

入力: affiliate/data/ad_copy.json (見出し・説明文テンプレ)
      affiliate/data/niches.json (LP URL生成のため)

出力:
  affiliate/data/google_ads_import.csv      # Google広告 Editor 互換CSV
  affiliate/data/google_ads_brief.md         # 人間が読んで Google広告UIに貼り付ける用ブリーフ

使い方:
  1. このスクリプト実行
  2. Google広告エディタ (https://ads.google.com/aw/tools/editor) でCSVインポート
     または、google_ads_brief.md を見ながら手動入稿

ベース URL は環境変数 BASE_URL で上書き可能。
"""
import os, json, csv

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AFF_DIR = f"{ROOT}/affiliate"
AD_COPY_JSON = f"{AFF_DIR}/data/ad_copy.json"
NICHES_JSON = f"{AFF_DIR}/data/niches.json"
OFFERS_JSON = f"{AFF_DIR}/data/offers.json"

BASE_URL = os.environ.get("BASE_URL", "https://stage-up-lp.vercel.app")

with open(AD_COPY_JSON, encoding="utf-8") as f:
    ad_copy = json.load(f)
with open(NICHES_JSON, encoding="utf-8") as f:
    niches_data = json.load(f)
with open(OFFERS_JSON, encoding="utf-8") as f:
    offers_data = json.load(f)

NICHES = {n["id"]: n for n in niches_data["niches"]}
OFFERS = {o["id"]: o for o in offers_data["offers"]}


# ============================================================
# 各広告グループのfinal URLを決定（ニッチの最優先オファー）
# ============================================================
def get_lp_url(niche_id):
    niche = NICHES[niche_id]
    top_offer = niche["preferred_offers"][0]
    return f"{BASE_URL}/a/{niche_id}-{top_offer}"


# ============================================================
# Google広告 Editor CSV 出力（レスポンシブ検索広告 + キーワード）
# ============================================================
def build_csv():
    csv_path = f"{AFF_DIR}/data/google_ads_import.csv"
    rows = []

    # ヘッダー：Google広告エディタの標準フォーマット
    # 最大 見出し15個、説明文4個、URL、パス
    header = [
        "Campaign",
        "Campaign Type",
        "Budget",
        "Ad Group",
        "Final URL",
        "Path 1",
        "Path 2",
        "Headline 1", "Headline 2", "Headline 3", "Headline 4", "Headline 5",
        "Headline 6", "Headline 7", "Headline 8", "Headline 9", "Headline 10",
        "Headline 11", "Headline 12", "Headline 13", "Headline 14", "Headline 15",
        "Description 1", "Description 2", "Description 3", "Description 4",
        "Keywords (phrase)",
        "Keywords (broad)",
        "Negative Keywords",
        "Status",
    ]
    rows.append(header)

    for niche_id, ad_group_data in ad_copy["ad_groups"].items():
        if niche_id not in NICHES:
            continue
        niche = NICHES[niche_id]
        url = get_lp_url(niche_id)

        # 見出し15個・説明文4個に揃える（足りない場合は空欄、多い場合は切り捨て）
        headlines = ad_group_data.get("headlines", [])
        headlines = (headlines + [""] * 15)[:15]
        descriptions = ad_group_data.get("descriptions", [])
        descriptions = (descriptions + [""] * 4)[:4]

        keywords = ad_group_data.get("target_keywords", [])
        negative_keywords = ad_group_data.get("negative_keywords", [])

        row = [
            "通信ジャンル｜検索広告",  # キャンペーン名統一
            "Search",
            "1500",  # 1日あたりの予算（円）。後でUIで調整
            f"{niche['name']}",  # 広告グループ名
            url,
            "比較",  # Path 1
            niche_id.replace("_", "-")[:15],  # Path 2 (英数字15字以内)
            *headlines,
            *descriptions,
            " ; ".join(f'"{kw}"' for kw in keywords),  # フレーズ一致
            " ; ".join(kw for kw in keywords),  # 部分一致
            " ; ".join(f"-{nk}" for nk in negative_keywords),  # 除外
            "Enabled",
        ]
        rows.append(row)

    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerows(rows)

    return csv_path, len(rows) - 1


# ============================================================
# 人間が読む用ブリーフ（手動入稿時のコピペ用）
# ============================================================
def build_brief():
    brief_path = f"{AFF_DIR}/data/google_ads_brief.md"
    lines = [
        "# Google広告 検索広告 入稿ブリーフ",
        "",
        "Google広告管理画面で1広告グループずつ作成する際の参照ドキュメント。",
        "",
        f"- ベースURL: {BASE_URL}",
        f"- キャンペーン名（共通）: 通信ジャンル｜検索広告",
        f"- 推奨設定: 検索ネットワーク / 日本全国 / 日本語 / 入札戦略「クリック数の最大化」",
        f"- 初期日予算: ¥1,500/日/広告グループ（勝ち見えたら3倍に）",
        "",
        "---",
        "",
    ]

    for niche_id, ad_group_data in ad_copy["ad_groups"].items():
        if niche_id not in NICHES:
            continue
        niche = NICHES[niche_id]
        url = get_lp_url(niche_id)
        top_offer = OFFERS[niche["preferred_offers"][0]]

        lines.extend([
            f"## 📦 広告グループ：{niche['name']}",
            "",
            f"- **遷移先LP**: {url}",
            f"- **推奨オファー**: {top_offer['name']}（{top_offer['asp']}・報酬{top_offer['reward_jpy']:,}円）",
            f"- **ペルソナ**: {niche['persona']}",
            f"- **主訴求**: {niche['primary_appeal']}",
            "",
            "### 🔑 キーワード（フレーズ一致推奨）",
            "",
        ])
        for kw in ad_group_data.get("target_keywords", []):
            lines.append(f"- `\"{kw}\"`")
        lines.append("")

        if ad_group_data.get("negative_keywords"):
            lines.append("### 🚫 除外キーワード")
            lines.append("")
            for nk in ad_group_data.get("negative_keywords", []):
                lines.append(f"- `-{nk}`")
            lines.append("")

        lines.append("### 📝 見出し（最大15個 / レスポンシブ検索広告）")
        lines.append("")
        for i, h in enumerate(ad_group_data.get("headlines", []), 1):
            lines.append(f"{i}. {h} ({len(h)}字)")
        lines.append("")

        lines.append("### 📝 説明文（最大4個 / 各90字以内）")
        lines.append("")
        for i, d in enumerate(ad_group_data.get("descriptions", []), 1):
            lines.append(f"{i}. {d} ({len(d)}字)")
        lines.append("")

        lines.append("### 🔗 サイトリンク（広告アセット）")
        lines.append("")
        for sl in ad_group_data.get("site_links", []):
            lines.append(f"- {sl['text']} → {url}{sl['anchor']}")
        lines.append("")

        lines.append("---")
        lines.append("")

    with open(brief_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    return brief_path, len([k for k in ad_copy["ad_groups"] if k in NICHES])


# ============================================================
# Main
# ============================================================
def main():
    csv_path, csv_count = build_csv()
    brief_path, brief_count = build_brief()
    print(f"✅ Google広告 CSV生成完了: {csv_path}")
    print(f"   広告グループ数: {csv_count}")
    print(f"✅ 入稿ブリーフ生成完了: {brief_path}")
    print(f"   広告グループ数: {brief_count}")


if __name__ == "__main__":
    main()
