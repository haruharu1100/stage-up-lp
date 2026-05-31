#!/usr/bin/env python3
"""
LP一括再生成（業種別×カラーバリエーション×レイアウト3パターン）

戦略:
  - 業種別カラーパレット（合計32種類）
  - レイアウト3パターン（hero-split / hero-center / hero-fullbg）
  - 業種別ヒーローコピー & 事業説明
  - 管理番号 seed で決定論的に組み合わせを割り当て
  → 全132社で被りなしのLPを生成

出力: _proposals/{slug}.html  (既存ファイルを上書き)
"""
import os, re, html as html_mod, json
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROP_DIR = f"{ROOT}/_proposals"
DATA_JSON = f"{ROOT}/data/sales_list.json"

# ============================================================
# 業種別カラーパレット
# ============================================================
PALETTES = {
    "建設業": [
        {"bg":"#f5f1e8","paper":"#ffffff","ink":"#1a2a3e","muted":"#5a6678","primary":"#1a3a5c","accent":"#c4a06b","border":"#d8d0bf"},
        {"bg":"#f8f6ef","paper":"#ffffff","ink":"#1d2e25","muted":"#566357","primary":"#2d4a3e","accent":"#a89060","border":"#d4cfb8"},
        {"bg":"#eef2f5","paper":"#ffffff","ink":"#1c2d3f","muted":"#4a5868","primary":"#2c4a6b","accent":"#b4843d","border":"#c8d1da"},
    ],
    "電気工事業": [
        {"bg":"#f0f4fa","paper":"#ffffff","ink":"#0f1e3c","muted":"#3a4a66","primary":"#1850a5","accent":"#f0b400","border":"#cdd6e6"},
    ],
    "リフォーム業": [
        {"bg":"#f9f4ec","paper":"#ffffff","ink":"#3d2a18","muted":"#6e5a45","primary":"#7d4e2c","accent":"#c89a5a","border":"#e0d3bf"},
    ],
    "不動産業": [
        {"bg":"#f8f7f3","paper":"#ffffff","ink":"#1c1f2e","muted":"#4a5063","primary":"#1f2640","accent":"#b89346","border":"#dad8d0"},
        {"bg":"#f4f5f9","paper":"#ffffff","ink":"#1a2440","muted":"#4d5468","primary":"#293963","accent":"#d4a346","border":"#d4d6e0"},
    ],
    "IT・システム開発": [
        {"bg":"#f6f9fc","paper":"#ffffff","ink":"#0f1729","muted":"#465070","primary":"#1f5dd1","accent":"#00b8d4","border":"#d0d9e8"},
        {"bg":"#fafbfc","paper":"#ffffff","ink":"#101828","muted":"#475467","primary":"#5b21b6","accent":"#22d3ee","border":"#d6dae0"},
        {"bg":"#0f172a","paper":"#1e293b","ink":"#e2e8f0","muted":"#94a3b8","primary":"#38bdf8","accent":"#fbbf24","border":"#334155"},
    ],
    "広告・マーケティング": [
        {"bg":"#fffaf0","paper":"#ffffff","ink":"#1a1a2e","muted":"#4d4d66","primary":"#ec4899","accent":"#84cc16","border":"#f0e5d0"},
        {"bg":"#fef9f5","paper":"#ffffff","ink":"#1c1934","muted":"#544f6e","primary":"#7c3aed","accent":"#fb923c","border":"#ece4d8"},
    ],
    "士業・コンサルティング": [
        {"bg":"#f4f6f9","paper":"#ffffff","ink":"#13213a","muted":"#445268","primary":"#1e3a5c","accent":"#c19a40","border":"#d4d8e0"},
        {"bg":"#f7f7f5","paper":"#ffffff","ink":"#1a1d2c","muted":"#4a4d60","primary":"#252e44","accent":"#a37d3a","border":"#dad9d3"},
    ],
    "運送・物流": [
        {"bg":"#eef2f8","paper":"#ffffff","ink":"#0d2548","muted":"#3a4a68","primary":"#1d4f9c","accent":"#f5a623","border":"#ccd3e0"},
    ],
    "美容・サロン": [
        {"bg":"#fdf8f3","paper":"#ffffff","ink":"#2d2326","muted":"#6e5d62","primary":"#a06b78","accent":"#c89e6c","border":"#ead8cf"},
        {"bg":"#faf6f3","paper":"#ffffff","ink":"#2a1f24","muted":"#6a5a60","primary":"#8b5e6a","accent":"#d4b594","border":"#e7d8d0"},
    ],
    "飲食業": [
        {"bg":"#fdf6ee","paper":"#ffffff","ink":"#2c1810","muted":"#6e4a3a","primary":"#8b3a1d","accent":"#d99a4c","border":"#ebd8c0"},
    ],
    "医療・福祉": [
        {"bg":"#f0f6f5","paper":"#ffffff","ink":"#0f2a2c","muted":"#3e5557","primary":"#2c7a7b","accent":"#7fc8d6","border":"#c8dadc"},
        {"bg":"#f4f7fb","paper":"#ffffff","ink":"#102236","muted":"#3e5068","primary":"#3a6fa1","accent":"#7ec0d4","border":"#cdd8e0"},
    ],
    "教育・スクール": [
        {"bg":"#fdfaf4","paper":"#ffffff","ink":"#1c2536","muted":"#465268","primary":"#1d5fa8","accent":"#f59e0b","border":"#ebe4d6"},
    ],
    "小売・EC": [
        {"bg":"#fafafa","paper":"#ffffff","ink":"#1a1a1a","muted":"#525252","primary":"#171717","accent":"#dc2626","border":"#d4d4d4"},
    ],
    "製造業": [
        {"bg":"#eef0f3","paper":"#ffffff","ink":"#1a232e","muted":"#475060","primary":"#374a63","accent":"#6e90b8","border":"#c8cdd5"},
    ],
    "卸売・商社": [
        {"bg":"#f3f1ec","paper":"#ffffff","ink":"#15273f","muted":"#445268","primary":"#1d3354","accent":"#c5995f","border":"#d8d4c8"},
        {"bg":"#f6f4ef","paper":"#ffffff","ink":"#1c2330","muted":"#475060","primary":"#1d2a44","accent":"#b0884a","border":"#dad6cb"},
    ],
    "薬局・ヘルスケア": [
        {"bg":"#f0f6ee","paper":"#ffffff","ink":"#1a2d1a","muted":"#4a5a4a","primary":"#3a7a3a","accent":"#a8d28a","border":"#d0dec5"},
    ],
    "資産運用・金融": [
        {"bg":"#f0f1f5","paper":"#ffffff","ink":"#0d1830","muted":"#3a4258","primary":"#1a2540","accent":"#c5984a","border":"#cdd0db"},
        {"bg":"#10182a","paper":"#1c2540","ink":"#e4e8f0","muted":"#9aa3b8","primary":"#c5984a","accent":"#e2c87a","border":"#2c3552"},
    ],
    "持株会社": [
        {"bg":"#181a23","paper":"#22242e","ink":"#e8eaf0","muted":"#9ca0b0","primary":"#d4af6a","accent":"#f0d490","border":"#3a3d4a"},
        {"bg":"#f4f4f5","paper":"#ffffff","ink":"#18181b","muted":"#52525b","primary":"#1c1c1f","accent":"#a1853a","border":"#d4d4d8"},
    ],
    "総合サービス業": [
        {"bg":"#f4f6f9","paper":"#ffffff","ink":"#1a253c","muted":"#475064","primary":"#2c4a7c","accent":"#b89346","border":"#d0d6e0"},
        {"bg":"#f7f6f3","paper":"#ffffff","ink":"#1c2233","muted":"#475068","primary":"#324663","accent":"#a08a4a","border":"#d8d4c8"},
    ],
    "汎用コーポレート": [
        {"bg":"#ffffff","paper":"#ffffff","ink":"#0f1c2e","muted":"#475068","primary":"#1d3a5c","accent":"#b89346","border":"#dde2e8"},
        {"bg":"#f8fafc","paper":"#ffffff","ink":"#1a1f2e","muted":"#4a5468","primary":"#2c3e5c","accent":"#6b89a8","border":"#d6dce4"},
        {"bg":"#f4f6f7","paper":"#ffffff","ink":"#1d242e","muted":"#4d5662","primary":"#384a5e","accent":"#7a9080","border":"#d0d6da"},
        {"bg":"#faf8f4","paper":"#ffffff","ink":"#231c1e","muted":"#5a4d52","primary":"#6e2a3a","accent":"#c0a060","border":"#e0d8cc"},
        {"bg":"#f6f7fa","paper":"#ffffff","ink":"#181c28","muted":"#454e64","primary":"#3a4a78","accent":"#6e8aaa","border":"#d2d6de"},
        {"bg":"#f5f5f0","paper":"#ffffff","ink":"#22241c","muted":"#52564a","primary":"#3a4030","accent":"#a08a4a","border":"#d8d6c8"},
        {"bg":"#fafbf6","paper":"#ffffff","ink":"#1e2418","muted":"#4d5544","primary":"#3a5132","accent":"#88a878","border":"#d8dcc8"},
        {"bg":"#fbfaf7","paper":"#ffffff","ink":"#2a1d2c","muted":"#5a4a5a","primary":"#6b3e6a","accent":"#c8a880","border":"#e0d8d8"},
    ],
}

# ============================================================
# 業種別コピー
# ============================================================
HERO_COPIES = {
    "建設業":         ("地域とともに、確かな建築を。", "施工実績と信頼を、次の現場へ。", "現場の品質が、信頼の証になる。"),
    "電気工事業":     ("電気の安全と品質を、地域から。", "現場対応力で、暮らしを支える。"),
    "リフォーム業":   ("住まいを、暮らしに合わせて。", "リフォームで、毎日に新しさを。"),
    "不動産業":       ("資産を、確かなパートナーへ。", "住まい選びに、信頼の選択を。"),
    "IT・システム開発": ("テクノロジーで、ビジネスを前へ。", "システムが、価値を生み出す。", "課題を、ソフトウェアで解決する。"),
    "広告・マーケティング": ("伝わるブランドを、形にする。", "戦略から実行まで、伴走するパートナー。"),
    "士業・コンサルティング": ("専門知見で、経営を支える。", "課題に寄り添い、解決へ導く。"),
    "運送・物流":     ("確かな物流で、事業を支える。", "対応力とスピードで信頼に応える。"),
    "美容・サロン":   ("わたしらしさを、もっと美しく。", "上質なひとときを、あなたへ。"),
    "飲食業":         ("こだわりの一皿を、心を込めて。", "おいしさと、くつろぎの時間を。"),
    "医療・福祉":     ("地域に寄り添う、安心のサポート。", "暮らしの傍らに、確かなケアを。"),
    "教育・スクール": ("学びが、未来をつくる。", "成長を、ともに支える場所。"),
    "小売・EC":       ("選ばれる商品を、あなたへ。", "暮らしを彩る、ひと品を。"),
    "製造業":         ("ものづくりで、産業を支える。", "確かな技術で、価値を形に。"),
    "卸売・商社":     ("商流を、確かに、誠実に。", "信頼の取引で、ビジネスをつなぐ。"),
    "薬局・ヘルスケア": ("健康を、地域とともに。", "暮らしの傍らに、ヘルスケアを。"),
    "資産運用・金融": ("資産形成を、信頼とともに。", "未来を見据えた、資産マネジメント。"),
    "持株会社":       ("グループ価値を、社会へ。", "事業ポートフォリオで、未来を拓く。"),
    "総合サービス業": ("幅広い領域で、お客様を支える。", "課題に応じた、最適なサービスを。"),
    "汎用コーポレート": ("信頼を、事業の力に。", "お客様とともに、価値を創る。", "誠実な事業で、社会に貢献する。", "確かな仕事で、信頼を積み重ねる。"),
}

BUSINESS_DESCRIPTIONS = {
    "建設業":         "新築・改修・公共/民間案件まで、地域に根ざした施工で確かな実績を積み重ねてまいります。",
    "電気工事業":     "電気設備の新設・改修・保守を中心に、法人案件から個人邸宅まで幅広く対応いたします。",
    "リフォーム業":   "住まいの悩みに寄り添い、お客様一人ひとりに最適なリフォームをご提案いたします。",
    "不動産業":       "売買・賃貸・管理まで、不動産に関するあらゆるご相談に総合的にお応えいたします。",
    "IT・システム開発": "業務システム開発から、Webサービス・SaaS構築、技術コンサルティングまで幅広く対応しております。",
    "広告・マーケティング": "戦略立案から制作・運用まで、クライアントのブランド価値向上を一貫してサポートいたします。",
    "士業・コンサルティング": "専門領域の深い知見をもとに、経営課題の解決と継続的な成長をご支援いたします。",
    "運送・物流":     "対応エリアと取扱貨物の幅で、新規荷主・元請各社様の物流ニーズにお応えいたします。",
    "美容・サロン":   "お客様一人ひとりに寄り添い、上質で心地よいひとときをご提供いたします。",
    "飲食業":         "素材と調理にこだわり、おいしさとくつろぎの時間をお届けいたします。",
    "医療・福祉":     "地域の皆様とそのご家族に、安心して相談いただけるサービスをご提供いたします。",
    "教育・スクール": "受講者一人ひとりの成長に向き合い、確かな指導と学びの場をご提供いたします。",
    "小売・EC":       "厳選した商品ラインナップで、お客様の暮らしを豊かに彩るお手伝いをいたします。",
    "製造業":         "確かな技術力と対応力で、新規・継続のお取引先に高品質な製品をお届けいたします。",
    "卸売・商社":     "商取引の信頼性とスピードで、お取引先企業様の事業活動をしっかり支えてまいります。",
    "薬局・ヘルスケア": "地域の皆様の健康を、薬剤師による丁寧なサービスでサポートいたします。",
    "資産運用・金融": "お客様の資産形成と運用を、長期的な視点と確かな知見でサポートいたします。",
    "持株会社":       "傘下グループ各社の事業価値を最大化し、社会への貢献を継続してまいります。",
    "総合サービス業": "幅広いサービス領域で、お客様の課題に対する最適解をご提供いたします。",
    "汎用コーポレート": "お客様との信頼関係を第一に、誠実な事業活動と継続的な成長を目指してまいります。",
}

# ============================================================
# 業種別: 事業内容 3項目
# ============================================================
SERVICES = {
    "建設業": [
        ("施工管理","新築・改修を問わず、品質と工程を一貫管理いたします。"),
        ("公共・民間案件","規模を問わず安全第一で対応いたします。"),
        ("アフターサポート","引き渡し後の保守・点検まで対応いたします。"),
    ],
    "電気工事業": [
        ("電気設備工事","新設・改修工事に幅広く対応いたします。"),
        ("保守メンテナンス","定期点検から緊急対応まで承ります。"),
        ("商業施設対応","店舗・オフィスの電気設備にも対応いたします。"),
    ],
    "リフォーム業": [
        ("住宅リフォーム","水回り・内装・外装まで幅広く対応いたします。"),
        ("無料現地調査","お見積もりは無料で承っております。"),
        ("アフターサポート","施工後の保守も丁寧に対応いたします。"),
    ],
    "不動産業": [
        ("売買仲介","お客様の資産を最適な条件でお繋ぎいたします。"),
        ("賃貸仲介・管理","オーナー様・入居者様双方に寄り添います。"),
        ("資産コンサル","資産活用のご相談も承っております。"),
    ],
    "IT・システム開発": [
        ("受託開発","Webシステム・業務アプリの設計開発を承ります。"),
        ("技術コンサル","技術選定・アーキテクチャ設計をご支援いたします。"),
        ("運用保守","継続的な改善・運用までフルサポートいたします。"),
    ],
    "広告・マーケティング": [
        ("広告戦略立案","事業フェーズに合わせた最適な戦略をご提案いたします。"),
        ("クリエイティブ制作","ブランドに合わせた表現設計を行います。"),
        ("運用・効果測定","継続的な改善で成果に直結させます。"),
    ],
    "士業・コンサルティング": [
        ("初回相談","お客様の課題を丁寧にヒアリングいたします。"),
        ("継続支援","顧問契約による継続的なサポートを行います。"),
        ("セミナー・研修","業界知見の共有も実施しております。"),
    ],
    "運送・物流": [
        ("定期便","安定的な定期輸送に対応いたします。"),
        ("スポット便","急ぎのご依頼にも柔軟に対応いたします。"),
        ("倉庫・配送連携","保管から配送まで一気通貫で対応可能です。"),
    ],
    "美容・サロン": [
        ("施術メニュー","一人ひとりに合わせた施術をご提供いたします。"),
        ("ご予約・お問い合わせ","オンライン予約にも対応しております。"),
        ("カウンセリング","初めての方も安心してご相談いただけます。"),
    ],
    "飲食業": [
        ("ランチ・ディナー","素材を活かしたお料理をご提供いたします。"),
        ("ご予約・コース","各種ご宴会・コースもご用意しております。"),
        ("テイクアウト","お持ち帰り・デリバリーにも対応いたします。"),
    ],
    "医療・福祉": [
        ("サービスのご案内","対象者・サービス内容をご説明いたします。"),
        ("ご相談窓口","ご家族からのご相談にも丁寧にお応えいたします。"),
        ("地域連携","地域医療・福祉機関と連携しております。"),
    ],
    "教育・スクール": [
        ("コース案内","目的別の各種コースをご用意しております。"),
        ("無料体験","まずは体験授業にお越しください。"),
        ("実績紹介","受講者の声・合格実績を公開しております。"),
    ],
    "小売・EC": [
        ("商品ラインナップ","厳選した商品をご提供いたします。"),
        ("実店舗・EC","オンライン・オフライン双方で展開しております。"),
        ("お問い合わせ","商品に関するご相談を承ります。"),
    ],
    "製造業": [
        ("製品ラインナップ","取扱製品の詳細をご紹介いたします。"),
        ("加工技術","対応規模・技術力をご紹介いたします。"),
        ("お取引のご相談","新規お取引のご相談を承ります。"),
    ],
    "卸売・商社": [
        ("取扱商品","幅広いカテゴリーで対応いたします。"),
        ("取引体制","安定供給体制を構築しております。"),
        ("お取引のご相談","新規お取引のご相談を承ります。"),
    ],
    "薬局・ヘルスケア": [
        ("処方箋受付","各種保険調剤に対応いたします。"),
        ("健康相談","薬剤師による相談を承ります。"),
        ("在宅対応","訪問薬剤管理にも対応しております。"),
    ],
    "資産運用・金融": [
        ("資産運用サポート","お客様に合わせた運用をご提案いたします。"),
        ("ライフプラン相談","長期的な視点でのご相談にお応えいたします。"),
        ("セミナー","資産形成に役立つ情報を発信しております。"),
    ],
    "持株会社": [
        ("グループ事業","傘下各社の事業をご紹介いたします。"),
        ("グループ統合","戦略・経営資源の最適配分を行います。"),
        ("IR・採用","投資家・採用候補者向け情報を発信いたします。"),
    ],
    "総合サービス業": [
        ("提供サービス","幅広い領域でサービスを展開しております。"),
        ("対応エリア","柔軟な対応エリアでサービス提供いたします。"),
        ("ご相談","業務範囲に関するご相談を承ります。"),
    ],
    "汎用コーポレート": [
        ("事業のご案内","当社事業の詳細をご紹介いたします。"),
        ("お客様サポート","継続的なサポートを行っております。"),
        ("お問い合わせ","お気軽にご相談ください。"),
    ],
}

# ============================================================
# データ読込（既存JSONから）
# ============================================================
with open(DATA_JSON, encoding="utf-8") as f:
    sales_data = json.load(f)

# slug -> {name, addr, industry}
SLUG_INFO = {}
for r in sales_data["records"]:
    no = r["no"]
    url = r["row"][15]
    if not url.startswith("https://"): continue
    slug = url.split("/")[-1]
    SLUG_INFO[slug] = {
        "no": no,
        "name": r["row"][2],
        "addr": r["row"][4] or "大阪府",
        "industry": r["row"][10],
    }

print(f"対象LP数: {len(SLUG_INFO)} 件")

# ============================================================
# 決定論的に design を割当
# ============================================================
def assign_design(no, industry):
    palettes = PALETTES.get(industry, PALETTES["汎用コーポレート"])
    palette = palettes[no % len(palettes)]
    layouts = ["split", "center", "fullbg"]
    layout = layouts[(no // len(palettes)) % len(layouts)]
    copies = HERO_COPIES.get(industry, HERO_COPIES["汎用コーポレート"])
    copy = copies[no % len(copies)]
    return palette, layout, copy

# ============================================================
# 業種別エリア表記
# ============================================================
def extract_short_region(addr):
    if not addr: return "地域"
    a = re.sub(r"^〒\d{3}-\d{4}\s*", "", addr)
    m = re.search(r"大阪市([^\s\d０-９]+?区)", a)
    if m: return m.group(0)
    m = re.search(r"堺市([^\s\d０-９]+?区)", a)
    if m: return m.group(0)
    m = re.search(r"大阪府([^\s\d０-９]+?[市町村])", a)
    if m: return m.group(1)
    m = re.search(r"奈良県([^\s\d０-９]+?[市町])", a)
    if m: return m.group(1)
    return "地域"

# ============================================================
# HTML 生成
# ============================================================
def gen_html(slug, info):
    no = info["no"]
    name = info["name"]
    addr = info["addr"]
    industry = info["industry"]
    pal, layout, hero_copy = assign_design(no, industry)
    region = extract_short_region(addr)
    biz_desc = BUSINESS_DESCRIPTIONS.get(industry, BUSINESS_DESCRIPTIONS["汎用コーポレート"])
    services = SERVICES.get(industry, SERVICES["汎用コーポレート"])

    # マーク
    mark = name[0] if name else "L"
    # 英字社名で頭文字英大文字に
    en_match = re.search(r'[A-Za-z]', name)
    if en_match:
        mark = en_match.group(0).upper()

    # ダーク背景判定
    is_dark = pal.get("bg","")[1:2] in "0123" or pal.get("ink","").startswith("#e")

    # ヒーロー画像 (Unsplash 業種別)
    hero_imgs = {
        "建設業":         "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1400&q=70",
        "電気工事業":     "https://images.unsplash.com/photo-1581094288338-2314dddb7ece?auto=format&fit=crop&w=1400&q=70",
        "リフォーム業":   "https://images.unsplash.com/photo-1503387837-b154d5074bd2?auto=format&fit=crop&w=1400&q=70",
        "不動産業":       "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1400&q=70",
        "IT・システム開発":"https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=70",
        "広告・マーケティング":"https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1400&q=70",
        "士業・コンサルティング":"https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1400&q=70",
        "運送・物流":     "https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=1400&q=70",
        "美容・サロン":   "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1400&q=70",
        "飲食業":         "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1400&q=70",
        "医療・福祉":     "https://images.unsplash.com/photo-1581595220892-b0739db3ba8c?auto=format&fit=crop&w=1400&q=70",
        "教育・スクール": "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1400&q=70",
        "小売・EC":       "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1400&q=70",
        "製造業":         "https://images.unsplash.com/photo-1530124566582-a618bc2615dc?auto=format&fit=crop&w=1400&q=70",
        "卸売・商社":     "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1400&q=70",
        "薬局・ヘルスケア":"https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1400&q=70",
        "資産運用・金融": "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1400&q=70",
        "持株会社":       "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1400&q=70",
        "総合サービス業": "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1400&q=70",
        "汎用コーポレート":"https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1400&q=70",
    }
    hero_img = hero_imgs.get(industry, hero_imgs["汎用コーポレート"])
    # 管理番号でローテーション
    rotation_imgs = list(hero_imgs.values())
    hero_img2 = rotation_imgs[(no * 7) % len(rotation_imgs)] if industry == "汎用コーポレート" else hero_img

    # ヒーロー Layout HTML
    if layout == "split":
        hero_html = f'''
<section class="hero hero-split">
  <div class="container">
    <div class="hero-grid">
      <div class="hero-text">
        <p class="hero-eyebrow">— {industry} —</p>
        <h1 class="hero-title">{hero_copy}</h1>
        <p class="hero-sub">{biz_desc}</p>
        <div class="hero-cta">
          <a href="#contact" class="btn btn-primary">お問い合わせはこちら</a>
          <a href="#biz" class="btn btn-ghost">事業内容を見る</a>
        </div>
      </div>
      <div class="hero-visual"><img src="{hero_img2}" alt="" loading="lazy"/></div>
    </div>
  </div>
</section>'''
    elif layout == "center":
        hero_html = f'''
<section class="hero hero-center">
  <div class="container hero-center-inner">
    <p class="hero-eyebrow">— {industry} —</p>
    <h1 class="hero-title">{hero_copy}</h1>
    <p class="hero-sub">{biz_desc}</p>
    <div class="hero-cta">
      <a href="#contact" class="btn btn-primary">お問い合わせはこちら</a>
      <a href="#biz" class="btn btn-ghost">事業内容を見る</a>
    </div>
  </div>
  <div class="hero-strip"><img src="{hero_img2}" alt="" loading="lazy"/></div>
</section>'''
    else:  # fullbg
        hero_html = f'''
<section class="hero hero-fullbg" style="background-image:linear-gradient(135deg, rgba(0,0,0,.55), rgba(0,0,0,.3)), url('{hero_img2}');">
  <div class="container hero-fullbg-inner">
    <p class="hero-eyebrow hero-eyebrow-light">— {industry} —</p>
    <h1 class="hero-title hero-title-light">{hero_copy}</h1>
    <p class="hero-sub hero-sub-light">{biz_desc}</p>
    <div class="hero-cta">
      <a href="#contact" class="btn btn-primary">お問い合わせはこちら</a>
      <a href="#biz" class="btn btn-ghost btn-ghost-light">事業内容を見る</a>
    </div>
  </div>
</section>'''

    # サービス3項目HTML
    biz_items = "".join(
        f'''<article class="biz-card"><span class="biz-no">— {i+1:02d} —</span><h3 class="biz-h">{s[0]}</h3><p class="biz-d">{s[1]}</p></article>'''
        for i, s in enumerate(services)
    )

    html = f'''<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
<meta name="theme-color" content="{pal['primary']}" />
<meta name="robots" content="noindex, nofollow" />
<title>{name}｜{hero_copy}</title>
<meta name="description" content="{name}は{biz_desc}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Noto+Serif+JP:wght@500;600&display=swap" rel="stylesheet" />
<style>
:root{{
  --bg: {pal['bg']};
  --paper: {pal['paper']};
  --ink: {pal['ink']};
  --muted: {pal['muted']};
  --primary: {pal['primary']};
  --accent: {pal['accent']};
  --border: {pal['border']};
}}
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
html{{scroll-behavior:smooth;scroll-padding-top:80px;-webkit-text-size-adjust:100%}}
body{{font-family:"Noto Sans JP",sans-serif;background:var(--bg);color:var(--muted);font-size:15px;line-height:1.95;-webkit-font-smoothing:antialiased}}
img{{display:block;max-width:100%;height:auto}}
a{{color:inherit;text-decoration:none;transition:color .2s,opacity .2s}}
button{{font:inherit;color:inherit;background:none;border:0;cursor:pointer}}
ul,ol{{list-style:none}}
.container{{width:100%;max-width:1180px;margin:0 auto;padding:0 24px}}
@media(min-width:768px){{.container{{padding:0 40px}}}}
.sample-bar{{position:fixed;top:0;left:0;right:0;z-index:60;background:var(--ink);color:#fff;padding:7px 16px;text-align:center;font-size:11px;letter-spacing:.1em;opacity:.92}}
body{{padding-top:30px}}

/* Header */
.site-header{{position:fixed;top:30px;left:0;right:0;z-index:50;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:border-color .3s}}
.site-header.is-scrolled{{border-bottom-color:var(--border)}}
.header-inner{{display:flex;align-items:center;justify-content:space-between;gap:16px;height:70px}}
.brand{{display:flex;align-items:center;gap:12px}}
.brand-mark{{width:42px;height:42px;display:grid;place-items:center;background:var(--primary);color:#fff;font-family:"Noto Serif JP",serif;font-weight:600;font-size:18px;border-radius:6px}}
.brand-name{{font-family:"Noto Serif JP",serif;font-weight:600;color:var(--ink);font-size:16px;letter-spacing:.05em}}
.nav-desktop{{display:none;gap:30px}}
.nav-desktop a{{font-size:13px;color:var(--muted);font-weight:500;letter-spacing:.04em}}
.nav-desktop a:hover{{color:var(--primary)}}
@media(min-width:1024px){{.nav-desktop{{display:flex}}}}
.btn{{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 28px;border-radius:6px;font-weight:600;font-size:14px;letter-spacing:.08em;transition:transform .15s,opacity .15s}}
.btn-primary{{background:var(--primary);color:#fff}}
.btn-primary:hover{{transform:translateY(-1px);opacity:.92}}
.btn-ghost{{background:transparent;color:var(--ink);border:1px solid var(--ink)}}
.btn-ghost:hover{{background:var(--ink);color:var(--paper)}}
.btn-ghost-light{{color:#fff;border-color:#fff}}
.btn-ghost-light:hover{{background:#fff;color:var(--ink)}}
.btn-h-primary{{padding:11px 22px;background:var(--primary);color:#fff;font-size:13px;font-weight:600;letter-spacing:.05em;border-radius:6px;display:inline-flex;align-items:center;gap:8px}}
.btn-h-primary:hover{{opacity:.9}}

/* Hero */
.hero{{padding:130px 0 80px;background:linear-gradient(180deg,var(--bg) 0%,color-mix(in srgb,var(--bg) 85%,var(--primary) 15%) 100%);position:relative;overflow:hidden}}
@media(min-width:768px){{.hero{{padding:170px 0 110px}}}}
.hero-eyebrow{{display:inline-flex;align-items:center;gap:12px;font-family:"Noto Serif JP",serif;font-size:13px;color:var(--primary);letter-spacing:.25em;margin-bottom:24px}}
.hero-eyebrow::before{{content:"";display:inline-block;width:28px;height:1px;background:var(--accent)}}
.hero-eyebrow-light{{color:#fff}}
.hero-eyebrow-light::before{{background:#fff}}
.hero-title{{font-family:"Noto Serif JP",serif;font-weight:600;color:var(--ink);font-size:34px;line-height:1.45;letter-spacing:.05em}}
@media(min-width:640px){{.hero-title{{font-size:44px}}}}
@media(min-width:1024px){{.hero-title{{font-size:54px}}}}
.hero-title-light{{color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.3)}}
.hero-sub{{margin-top:28px;color:var(--muted);font-size:15px;line-height:2.05;max-width:560px}}
.hero-sub-light{{color:rgba(255,255,255,.92)}}
.hero-cta{{margin-top:36px;display:flex;flex-wrap:wrap;gap:14px}}

/* Hero variations */
.hero-split .hero-grid{{display:grid;gap:48px;align-items:center}}
@media(min-width:980px){{.hero-split .hero-grid{{grid-template-columns:1.1fr 1fr;gap:80px}}}}
.hero-split .hero-visual{{aspect-ratio:5/4;overflow:hidden;border-radius:8px;background:var(--border)}}
.hero-split .hero-visual img{{width:100%;height:100%;object-fit:cover}}

.hero-center .hero-center-inner{{max-width:780px;margin:0 auto;text-align:center}}
.hero-center .hero-eyebrow{{justify-content:center}}
.hero-center .hero-sub{{margin-left:auto;margin-right:auto}}
.hero-center .hero-cta{{justify-content:center}}
.hero-center .hero-strip{{margin-top:60px;aspect-ratio:21/9;overflow:hidden}}
.hero-center .hero-strip img{{width:100%;height:100%;object-fit:cover}}

.hero-fullbg{{padding:170px 0 130px;background-size:cover;background-position:center}}
.hero-fullbg .hero-fullbg-inner{{max-width:720px}}

/* Section */
.section{{padding:90px 0}}
@media(min-width:768px){{.section{{padding:120px 0}}}}
.section-soft{{background:color-mix(in srgb,var(--bg) 92%,var(--ink) 8%)}}
.section-primary{{background:var(--primary);color:#fff}}
.s-eyebrow{{display:inline-flex;align-items:center;gap:12px;font-family:"Noto Serif JP",serif;font-size:13px;color:var(--primary);letter-spacing:.25em;margin-bottom:20px}}
.s-eyebrow::before{{content:"";display:inline-block;width:28px;height:1px;background:var(--accent)}}
.section-primary .s-eyebrow{{color:#fff}}
.section-primary .s-eyebrow::before{{background:#fff}}
.s-title{{font-family:"Noto Serif JP",serif;font-weight:600;color:var(--ink);font-size:30px;line-height:1.5;letter-spacing:.05em}}
@media(min-width:768px){{.s-title{{font-size:40px}}}}
.section-primary .s-title{{color:#fff}}
.s-lead{{margin-top:22px;color:var(--muted);font-size:15px;line-height:2.1;max-width:720px}}
.section-primary .s-lead{{color:rgba(255,255,255,.85)}}

/* Business cards */
.biz-grid{{margin-top:56px;display:grid;gap:22px}}
@media(min-width:768px){{.biz-grid{{grid-template-columns:repeat(3,1fr)}}}}
.biz-card{{padding:36px 30px;background:var(--paper);border:1px solid var(--border);border-radius:8px;transition:transform .2s,box-shadow .2s}}
.biz-card:hover{{transform:translateY(-3px);box-shadow:0 20px 40px -20px rgba(0,0,0,.15)}}
.biz-no{{font-family:"Noto Serif JP",serif;font-size:13px;color:var(--accent);letter-spacing:.2em;font-weight:600}}
.biz-h{{margin-top:12px;font-family:"Noto Serif JP",serif;font-size:20px;color:var(--ink);font-weight:600;line-height:1.5}}
.biz-d{{margin-top:14px;font-size:14px;color:var(--muted);line-height:2}}

/* Reasons */
.reason-list{{margin-top:56px;display:grid;gap:0;border-top:1px solid var(--border)}}
.reason{{padding:30px 0;border-bottom:1px solid var(--border);display:grid;gap:16px}}
@media(min-width:768px){{.reason{{grid-template-columns:160px 1fr;gap:40px;align-items:start}}}}
.reason-no{{font-family:"Noto Serif JP",serif;font-size:13px;color:var(--accent);letter-spacing:.2em;font-weight:600}}
.reason-no span{{display:block;font-size:30px;color:var(--ink);margin-top:6px;font-weight:600}}
.reason-h{{font-family:"Noto Serif JP",serif;font-size:19px;color:var(--ink);font-weight:600;line-height:1.5}}
.reason-d{{margin-top:14px;color:var(--muted);font-size:14px;line-height:2.05}}

/* Contact */
.contact{{padding:100px 0 120px;background:color-mix(in srgb,var(--bg) 92%,var(--primary) 8%)}}
.contact-cards{{margin-top:50px;display:grid;gap:0;background:var(--paper);border:1px solid var(--border);border-radius:8px;overflow:hidden}}
@media(min-width:768px){{.contact-cards{{grid-template-columns:repeat(3,1fr)}}}}
.ccard{{padding:36px 30px;text-align:center;border-bottom:1px solid var(--border)}}
@media(min-width:768px){{.ccard{{border-bottom:0;border-right:1px solid var(--border)}}.ccard:last-child{{border-right:0}}}}
.ccard-l{{font-family:"Noto Serif JP",serif;font-size:13px;color:var(--accent);letter-spacing:.25em;font-weight:600}}
.ccard-v{{margin-top:14px;font-family:"Noto Serif JP",serif;font-size:20px;color:var(--ink);line-height:1.4;font-weight:600}}
.ccard-n{{margin-top:10px;font-size:12px;color:var(--muted);line-height:1.7}}
.contact-buttons{{margin-top:40px;display:flex;flex-direction:column;gap:14px}}
@media(min-width:768px){{.contact-buttons{{flex-direction:row;justify-content:center}}}}
.btn-line{{background:#06c755;color:#fff;padding:18px 38px;border-radius:6px;font-weight:600;font-size:14px;letter-spacing:.1em;display:inline-flex;align-items:center;gap:10px}}

/* Sample mark */
.sample-mark{{margin:36px auto 0;max-width:720px;padding:16px 24px;border:1px dashed var(--border);background:var(--paper);text-align:center;font-size:11px;color:var(--muted);border-radius:6px}}

/* Footer */
.site-footer{{background:var(--ink);color:rgba(255,255,255,.7);padding:64px 0 28px}}
.footer-inner{{display:grid;gap:36px}}
@media(min-width:768px){{.footer-inner{{grid-template-columns:1.5fr 1fr 1fr}}}}
.footer-name{{color:#fff;font-family:"Noto Serif JP",serif;font-weight:600;font-size:17px}}
.footer-lead{{margin-top:14px;font-size:13px;line-height:1.95;color:rgba(255,255,255,.65)}}
.footer-h{{font-family:"Noto Serif JP",serif;color:rgba(255,255,255,.85);font-size:13px;letter-spacing:.2em;margin-bottom:14px;font-weight:600}}
.footer-list li{{margin-bottom:9px;font-size:13px;color:rgba(255,255,255,.65)}}
.footer-bottom{{margin-top:48px;padding-top:22px;border-top:1px solid rgba(255,255,255,.12);font-size:11px;color:rgba(255,255,255,.45);text-align:center}}

@media(prefers-reduced-motion:reduce){{*{{animation:none!important;transition:none!important}}}}
</style>
</head>
<body>

<div class="sample-bar">※ご提案用サンプルページ｜本ページは公開されておりません</div>

<header class="site-header" id="header">
  <div class="container header-inner">
    <a href="#top" class="brand">
      <span class="brand-mark">{mark}</span>
      <span class="brand-name">{name}</span>
    </a>
    <nav class="nav-desktop">
      <a href="#biz">事業内容</a>
      <a href="#reason">選ばれる理由</a>
      <a href="#contact">お問い合わせ</a>
    </nav>
    <a href="#contact" class="btn-h-primary">お問い合わせ</a>
  </div>
</header>

<main id="top">

{hero_html}

<section id="biz" class="section">
  <div class="container">
    <p class="s-eyebrow">— Our Business —</p>
    <h2 class="s-title">事業<br/>内容</h2>
    <p class="s-lead">{biz_desc}</p>
    <div class="biz-grid">{biz_items}</div>
  </div>
</section>

<section id="reason" class="section section-soft">
  <div class="container">
    <p class="s-eyebrow">— Why Chosen —</p>
    <h2 class="s-title">お客様に選ばれる<br/>3つの理由</h2>
    <div class="reason-list">
      <article class="reason">
        <p class="reason-no">Reason<span>01</span></p>
        <div>
          <h3 class="reason-h">{region}を中心に積み重ねてきた信頼</h3>
          <p class="reason-d">{region}でのお客様一件一件と向き合い、丁寧なご対応で築いてきた信頼関係を、これからも大切にしてまいります。</p>
        </div>
      </article>
      <article class="reason">
        <p class="reason-no">Reason<span>02</span></p>
        <div>
          <h3 class="reason-h">お客様一人ひとりに寄り添うご対応</h3>
          <p class="reason-d">画一的な対応ではなく、お客様の状況やご要望に応じた、きめ細やかなご対応を心がけております。</p>
        </div>
      </article>
      <article class="reason">
        <p class="reason-no">Reason<span>03</span></p>
        <div>
          <h3 class="reason-h">継続的なお取引が可能な体制</h3>
          <p class="reason-d">一度のお取引で終わらず、お客様の事業や暮らしに長く寄り添える、信頼できるパートナーであることを目指しています。</p>
        </div>
      </article>
    </div>
  </div>
</section>

<section id="contact" class="contact">
  <div class="container">
    <div style="text-align:center">
      <p class="s-eyebrow" style="justify-content:center">— Contact —</p>
      <h2 class="s-title">お気軽に<br/>お問い合わせください</h2>
      <p class="s-lead" style="margin:22px auto 0">ご相談・お見積もりは無料です。お電話・お問い合わせフォームよりお気軽にどうぞ。</p>
    </div>
    <div class="contact-cards">
      <div class="ccard"><p class="ccard-l">TEL</p><p class="ccard-v">XXX-XXXX-XXXX</p><p class="ccard-n">受付 9:00-18:00<br/>（土日祝休）</p></div>
      <div class="ccard"><p class="ccard-l">MAIL</p><p class="ccard-v">info@example.com</p><p class="ccard-n">24時間 受付<br/>返信は営業日</p></div>
      <div class="ccard"><p class="ccard-l">FORM</p><p class="ccard-v">お問い合わせ<br/>はこちら</p><p class="ccard-n">フォーム送信<br/>24時間 受付</p></div>
    </div>
    <div class="contact-buttons">
      <a href="#" class="btn btn-primary">お問い合わせはこちら</a>
    </div>
    <div class="sample-mark">※本ページはご提案用サンプルとして作成しております。掲載情報は仮の内容を含みます。</div>
  </div>
</section>

</main>

<footer class="site-footer">
  <div class="container footer-inner">
    <div>
      <p class="footer-name">{name}</p>
      <p class="footer-lead">{biz_desc}</p>
    </div>
    <div>
      <p class="footer-h">— Menu —</p>
      <ul class="footer-list">
        <li><a href="#biz">事業内容</a></li>
        <li><a href="#reason">選ばれる理由</a></li>
        <li><a href="#contact">お問い合わせ</a></li>
      </ul>
    </div>
    <div>
      <p class="footer-h">— Company —</p>
      <ul class="footer-list">
        <li>所在地：{addr}</li>
        <li>TEL：XXX-XXXX-XXXX</li>
        <li>MAIL：info@example.com</li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    © {datetime.now().year} {name} All rights reserved.&nbsp;｜&nbsp;
    ※本ページはご提案用サンプルとして作成しております。掲載情報は仮の内容を含みます。
  </div>
</footer>

<script>
var h=document.getElementById("header");
window.addEventListener("scroll",function(){{
  if(window.scrollY>20) h.classList.add("is-scrolled");
  else h.classList.remove("is-scrolled");
}},{{passive:true}});
</script>
</body>
</html>
'''
    return html

# ============================================================
# 生成
# ============================================================
count = 0
combos = set()
for slug, info in SLUG_INFO.items():
    html = gen_html(slug, info)
    path = f"{PROP_DIR}/{slug}.html"
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    pal, layout, copy = assign_design(info["no"], info["industry"])
    combos.add((info["industry"], pal["primary"], layout, copy))
    count += 1

print(f"✅ 再生成完了: {count} 件")
print(f"   ユニーク組合せ (業種×色×構成×コピー): {len(combos)}")
print(f"   出力先: {PROP_DIR}/{{slug}}.html")
