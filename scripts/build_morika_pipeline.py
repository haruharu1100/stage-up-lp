#!/usr/bin/env python3
"""
MORIKA新シート用 統合パイプライン
- /tmp/morika_all55.tsv (55社) を入力
- 業種推定 + 郵便番号付与（既存JSON+主要マッピング） + LP生成 + JSON出力
- data/morika_list.json として独立JSONで保存
- _proposals/m{法人番号末尾4桁}-{slug}.html にLP生成
- auth.js に slug追加
"""
import os, re, html as html_mod, json
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROP_DIR = f"{ROOT}/_proposals"
INPUT_TSV = "/tmp/morika_all55.tsv"
OUT_JSON  = f"{ROOT}/data/morika_list.json"
AUTH_JS   = f"{ROOT}/api/auth.js"
SALES_JSON = f"{ROOT}/data/sales_list.json"
TODAY = "2026-06-01"

# ============================================================
# 業種別カラーパレット（build_lps.py から流用）
# ============================================================
PALETTES = {
    "建設業": [
        {"bg":"#f5f1e8","paper":"#ffffff","ink":"#1a2a3e","muted":"#5a6678","primary":"#1a3a5c","accent":"#c4a06b","border":"#d8d0bf"},
        {"bg":"#f8f6ef","paper":"#ffffff","ink":"#1d2e25","muted":"#566357","primary":"#2d4a3e","accent":"#a89060","border":"#d4cfb8"},
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
    ],
    "広告・マーケティング": [
        {"bg":"#fffaf0","paper":"#ffffff","ink":"#1a1a2e","muted":"#4d4d66","primary":"#ec4899","accent":"#84cc16","border":"#f0e5d0"},
        {"bg":"#fef9f5","paper":"#ffffff","ink":"#1c1934","muted":"#544f6e","primary":"#7c3aed","accent":"#fb923c","border":"#ece4d8"},
    ],
    "士業・コンサルティング": [
        {"bg":"#f4f6f9","paper":"#ffffff","ink":"#13213a","muted":"#445268","primary":"#1e3a5c","accent":"#c19a40","border":"#d4d8e0"},
    ],
    "運送・物流": [
        {"bg":"#eef2f8","paper":"#ffffff","ink":"#0d2548","muted":"#3a4a68","primary":"#1d4f9c","accent":"#f5a623","border":"#ccd3e0"},
    ],
    "美容・サロン": [
        {"bg":"#fdf8f3","paper":"#ffffff","ink":"#2d2326","muted":"#6e5d62","primary":"#a06b78","accent":"#c89e6c","border":"#ead8cf"},
    ],
    "飲食業": [
        {"bg":"#fdf6ee","paper":"#ffffff","ink":"#2c1810","muted":"#6e4a3a","primary":"#8b3a1d","accent":"#d99a4c","border":"#ebd8c0"},
    ],
    "医療・福祉": [
        {"bg":"#f0f6f5","paper":"#ffffff","ink":"#0f2a2c","muted":"#3e5557","primary":"#2c7a7b","accent":"#7fc8d6","border":"#c8dadc"},
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
    ],
    "資産運用・金融": [
        {"bg":"#f0f1f5","paper":"#ffffff","ink":"#0d1830","muted":"#3a4258","primary":"#1a2540","accent":"#c5984a","border":"#cdd0db"},
    ],
    "総合サービス業": [
        {"bg":"#f4f6f9","paper":"#ffffff","ink":"#1a253c","muted":"#475064","primary":"#2c4a7c","accent":"#b89346","border":"#d0d6e0"},
    ],
    "汎用コーポレート": [
        {"bg":"#ffffff","paper":"#ffffff","ink":"#0f1c2e","muted":"#475068","primary":"#1d3a5c","accent":"#b89346","border":"#dde2e8"},
        {"bg":"#f8fafc","paper":"#ffffff","ink":"#1a1f2e","muted":"#4a5468","primary":"#2c3e5c","accent":"#6b89a8","border":"#d6dce4"},
        {"bg":"#f4f6f7","paper":"#ffffff","ink":"#1d242e","muted":"#4d5662","primary":"#384a5e","accent":"#7a9080","border":"#d0d6da"},
        {"bg":"#faf8f4","paper":"#ffffff","ink":"#231c1e","muted":"#5a4d52","primary":"#6e2a3a","accent":"#c0a060","border":"#e0d8cc"},
        {"bg":"#f6f7fa","paper":"#ffffff","ink":"#181c28","muted":"#454e64","primary":"#3a4a78","accent":"#6e8aaa","border":"#d2d6de"},
        {"bg":"#f5f5f0","paper":"#ffffff","ink":"#22241c","muted":"#52564a","primary":"#3a4030","accent":"#a08a4a","border":"#d8d6c8"},
    ],
}

HERO_COPIES = {
    "建設業":         ("地域とともに、確かな建築を。", "施工実績と信頼を、次の現場へ。"),
    "電気工事業":     ("電気の安全と品質を、地域から。",),
    "リフォーム業":   ("住まいを、暮らしに合わせて。",),
    "不動産業":       ("資産を、確かなパートナーへ。", "住まい選びに、信頼の選択を。"),
    "IT・システム開発": ("テクノロジーで、ビジネスを前へ。", "システムが、価値を生み出す。"),
    "広告・マーケティング": ("伝わるブランドを、形にする。", "戦略から実行まで、伴走するパートナー。"),
    "士業・コンサルティング": ("専門知見で、経営を支える。",),
    "運送・物流":     ("確かな物流で、事業を支える。",),
    "美容・サロン":   ("わたしらしさを、もっと美しく。",),
    "飲食業":         ("こだわりの一皿を、心を込めて。",),
    "医療・福祉":     ("地域に寄り添う、安心のサポート。",),
    "教育・スクール": ("学びが、未来をつくる。",),
    "小売・EC":       ("選ばれる商品を、あなたへ。",),
    "製造業":         ("ものづくりで、産業を支える。",),
    "卸売・商社":     ("商流を、確かに、誠実に。",),
    "資産運用・金融": ("資産形成を、信頼とともに。",),
    "総合サービス業": ("幅広い領域で、お客様を支える。",),
    "汎用コーポレート": ("信頼を、事業の力に。", "お客様とともに、価値を創る。", "誠実な事業で、社会に貢献する。", "確かな仕事で、信頼を積み重ねる。"),
}
BUSINESS_DESCRIPTIONS = {
    "建設業": "新築・改修・公共/民間案件まで、地域に根ざした施工で確かな実績を積み重ねてまいります。",
    "電気工事業": "電気設備の新設・改修・保守を中心に、法人案件から個人邸宅まで幅広く対応いたします。",
    "リフォーム業": "住まいの悩みに寄り添い、お客様一人ひとりに最適なリフォームをご提案いたします。",
    "不動産業": "売買・賃貸・管理まで、不動産に関するあらゆるご相談に総合的にお応えいたします。",
    "IT・システム開発": "業務システム開発から、Webサービス・SaaS構築、技術コンサルティングまで幅広く対応しております。",
    "広告・マーケティング": "戦略立案から制作・運用まで、クライアントのブランド価値向上を一貫してサポートいたします。",
    "士業・コンサルティング": "専門領域の深い知見をもとに、経営課題の解決と継続的な成長をご支援いたします。",
    "運送・物流": "対応エリアと取扱貨物の幅で、新規荷主・元請各社様の物流ニーズにお応えいたします。",
    "美容・サロン": "お客様一人ひとりに寄り添い、上質で心地よいひとときをご提供いたします。",
    "飲食業": "素材と調理にこだわり、おいしさとくつろぎの時間をお届けいたします。",
    "医療・福祉": "地域の皆様とそのご家族に、安心して相談いただけるサービスをご提供いたします。",
    "教育・スクール": "受講者一人ひとりの成長に向き合い、確かな指導と学びの場をご提供いたします。",
    "小売・EC": "厳選した商品ラインナップで、お客様の暮らしを豊かに彩るお手伝いをいたします。",
    "製造業": "確かな技術力と対応力で、新規・継続のお取引先に高品質な製品をお届けいたします。",
    "卸売・商社": "商取引の信頼性とスピードで、お取引先企業様の事業活動をしっかり支えてまいります。",
    "資産運用・金融": "お客様の資産形成と運用を、長期的な視点と確かな知見でサポートいたします。",
    "総合サービス業": "幅広いサービス領域で、お客様の課題に対する最適解をご提供いたします。",
    "汎用コーポレート": "お客様との信頼関係を第一に、誠実な事業活動と継続的な成長を目指してまいります。",
}
SERVICES = {
    "建設業": [("施工管理","新築・改修を問わず、品質と工程を一貫管理いたします。"),("公共・民間案件","規模を問わず安全第一で対応いたします。"),("アフターサポート","引き渡し後の保守・点検まで対応いたします。")],
    "電気工事業": [("電気設備工事","新設・改修工事に幅広く対応いたします。"),("保守メンテナンス","定期点検から緊急対応まで承ります。"),("商業施設対応","店舗・オフィスの電気設備にも対応いたします。")],
    "リフォーム業": [("住宅リフォーム","水回り・内装・外装まで幅広く対応いたします。"),("無料現地調査","お見積もりは無料で承っております。"),("アフターサポート","施工後の保守も丁寧に対応いたします。")],
    "不動産業": [("売買仲介","お客様の資産を最適な条件でお繋ぎいたします。"),("賃貸仲介・管理","オーナー様・入居者様双方に寄り添います。"),("資産コンサル","資産活用のご相談も承っております。")],
    "IT・システム開発": [("受託開発","Webシステム・業務アプリの設計開発を承ります。"),("技術コンサル","技術選定・アーキテクチャ設計をご支援いたします。"),("運用保守","継続的な改善・運用までフルサポートいたします。")],
    "広告・マーケティング": [("広告戦略立案","事業フェーズに合わせた最適な戦略をご提案いたします。"),("クリエイティブ制作","ブランドに合わせた表現設計を行います。"),("運用・効果測定","継続的な改善で成果に直結させます。")],
    "士業・コンサルティング": [("初回相談","お客様の課題を丁寧にヒアリングいたします。"),("継続支援","顧問契約による継続的なサポートを行います。"),("セミナー・研修","業界知見の共有も実施しております。")],
    "運送・物流": [("定期便","安定的な定期輸送に対応いたします。"),("スポット便","急ぎのご依頼にも柔軟に対応いたします。"),("倉庫・配送連携","保管から配送まで一気通貫で対応可能です。")],
    "美容・サロン": [("施術メニュー","一人ひとりに合わせた施術をご提供いたします。"),("ご予約・お問い合わせ","オンライン予約にも対応しております。"),("カウンセリング","初めての方も安心してご相談いただけます。")],
    "飲食業": [("ランチ・ディナー","素材を活かしたお料理をご提供いたします。"),("ご予約・コース","各種ご宴会・コースもご用意しております。"),("テイクアウト","お持ち帰り・デリバリーにも対応いたします。")],
    "医療・福祉": [("サービスのご案内","対象者・サービス内容をご説明いたします。"),("ご相談窓口","ご家族からのご相談にも丁寧にお応えいたします。"),("地域連携","地域医療・福祉機関と連携しております。")],
    "教育・スクール": [("コース案内","目的別の各種コースをご用意しております。"),("無料体験","まずは体験授業にお越しください。"),("実績紹介","受講者の声・合格実績を公開しております。")],
    "小売・EC": [("商品ラインナップ","厳選した商品をご提供いたします。"),("実店舗・EC","オンライン・オフライン双方で展開しております。"),("お問い合わせ","商品に関するご相談を承ります。")],
    "製造業": [("製品ラインナップ","取扱製品の詳細をご紹介いたします。"),("加工技術","対応規模・技術力をご紹介いたします。"),("お取引のご相談","新規お取引のご相談を承ります。")],
    "卸売・商社": [("取扱商品","幅広いカテゴリーで対応いたします。"),("取引体制","安定供給体制を構築しております。"),("お取引のご相談","新規お取引のご相談を承ります。")],
    "資産運用・金融": [("資産運用サポート","お客様に合わせた運用をご提案いたします。"),("ライフプラン相談","長期的な視点でのご相談にお応えいたします。"),("セミナー","資産形成に役立つ情報を発信しております。")],
    "総合サービス業": [("提供サービス","幅広い領域でサービスを展開しております。"),("対応エリア","柔軟な対応エリアでサービス提供いたします。"),("ご相談","業務範囲に関するご相談を承ります。")],
    "汎用コーポレート": [("事業のご案内","当社事業の詳細をご紹介いたします。"),("お客様サポート","継続的なサポートを行っております。"),("お問い合わせ","お気軽にご相談ください。")],
}

# ============================================================
# 業種別 長文DM パーツ
# ============================================================
INDUSTRY_LONG = {
    "建設業": ("地域に根ざした建設・施工の事業","建設業界では、地域のお客様や元請業者がスマートフォンで施工会社を比較するケースが増えており、施工内容・対応工種・地域実績が分かりやすく伝わるページがあるかどうかで、問い合わせ数や紹介経由案件の質に差が出やすくなっています。新規法人だからこそ、最初の現場・最初の取引先から「ちゃんとした会社だ」と感じてもらえる入口を整えておくことが重要です。","建設業のLPでは、施工事例・対応工種・対応エリア・問い合わせ導線を分かりやすく整える構成にしています。"),
    "電気工事業": ("電気工事の事業","電気工事は緊急対応・定期メンテ・新築/改修と相談入口が多岐にわたるため、対応工事種別や対応エリア、対応スピードがWeb上で見えるかどうかで、法人案件や元請からの引き合いに差が出やすくなっています。","電気工事業のLPでは、工種別の対応実績・対応エリア・対応スピードを明示する構成にしています。"),
    "リフォーム業": ("リフォームの事業","リフォーム業界はお客様の相見積もりが当たり前で、Web上で「安心して相談できそうかどうか」が一瞬で判断されます。施工Before/After・お客様の声・対応エリアが伝わらないと、見積もり段階で選ばれず終わる機会損失が起きやすい業界です。","リフォーム業のLPでは、施工事例・無料相談・見学会の導線を整理する構成にしています。"),
    "不動産業": ("不動産関連の事業","不動産業界では、信頼感と相談しやすさが問い合わせの分かれ目になります。スマートフォンで見た時に取扱物件・対応エリア・相談窓口が分かりやすいページがあるかどうかだけで、来店予約や査定依頼への心理的ハードルが大きく変わります。","不動産業のLPでは、取扱物件・対応エリア・売買/賃貸/管理それぞれのサポート体制を整理する構成にしています。"),
    "IT・システム開発": ("IT・テクノロジー領域の事業","IT・システム系の事業は提供サービスが専門的になりやすく、初めて見た方にも強みや相談内容が伝わるページを持つことが、問い合わせや商談化率に直結します。新規法人だからこそ、最初の案件・最初の継続契約を勝ち取るために、サービス内容と実績が一目で伝わる入口を最初に整えておく価値があります。","IT・システム系のLPでは、提供サービスの強み・導入事例・対応技術を構造的に伝える構成にしています。"),
    "広告・マーケティング": ("広告・マーケティング領域の事業","クライアントの広告・販促を支える業界だからこそ、貴社自身のブランディング発信が「任せたい」と感じてもらえる第一印象になります。実績・対応領域・チーム体制が伝わらないと、競合代理店と並んだ際に選ばれにくくなります。","広告・マーケティング系のLPでは、実績・対応領域・チーム体制を整理する構成にしています。"),
    "士業・コンサルティング": ("コンサル・士業領域の事業","専門性の高い領域では、初回相談の心理的ハードルが商談化率を大きく左右します。提供領域・対応業種・支援実績・料金感が一見で分かるページがないと、紹介経由以外のチャネルから新規問い合わせが入ってこない状態が続きがちです。","士業・コンサル系のLPでは、提供領域・対応業種・初回相談導線を整える構成にしています。"),
    "運送・物流": ("運送・物流の事業","運送・物流業界では、対応エリア・取扱貨物・車輌体制が見える状態になっているかどうかで、新規荷主や元請からの相談入口の数が変わります。","運送・物流のLPでは、対応エリア・取扱貨物・車輌体制を整理する構成にしています。"),
    "美容・サロン": ("美容・サロン事業","美容・サロン業界では、店舗の雰囲気・施術メニュー・スタッフの世界観が伝わるかどうかが、新規来店・予約に直結します。スマートフォンで見たときに予約導線が分かりにくいと、SNS経由のお客様もそのまま離脱してしまう機会損失が起きやすい業界です。","美容・サロン系のLPでは、店舗の世界観・施術メニュー・予約導線・SNS連携を整える構成にしています。"),
    "飲食業": ("飲食事業","飲食業界では、メニュー・店舗情報・予約導線が整っていないだけで、グルメサイト依存が高まり手数料負担が増えがちです。スマートフォンで店舗名検索された際に、自店経由で予約・問い合わせができる導線がないと、機会損失と利益率低下が同時に起きます。","飲食業のLPでは、メニュー・店舗情報・予約導線・テイクアウト案内を整理する構成にしています。"),
    "医療・福祉": ("医療・福祉領域の事業","医療・福祉領域では、地域の方やご家族が安心して相談できる入口があるかどうかで、初回相談の数が大きく変わります。サービス内容・対象者・問い合わせ窓口が分かりにくいと、必要としている方に届かないまま機会損失が起きてしまいます。","医療・福祉のLPでは、サービス内容・対象者・問い合わせ窓口を丁寧に整える構成にしています。"),
    "教育・スクール": ("教育・スクール事業","教育・スクール業界では、保護者や受講者がWeb上でじっくり比較してから問い合わせる傾向が強く、コース紹介・実績・体験申込導線がないだけで、月次の体験申込数に大きな差が出ます。","教育・スクール系のLPでは、コース紹介・指導実績・体験予約フォームを整える構成にしています。"),
    "小売・EC": ("小売・販売事業","小売・販売業界では、商品ラインナップ・店舗情報・購入導線が整っているかどうかで、来店と問い合わせの両方に差が出ます。","小売・販売事業のLPでは、商品ラインナップ・店舗情報・購入導線を整える構成にしています。"),
    "製造業": ("製造業の事業","製造業では、取扱製品・加工技術・対応規模が伝わらないと、商社経由の取引に依存する状態が続きがちです。エンドユーザーや海外バイヤーからの直接問い合わせを取るには、技術力と対応範囲が一見で分かるWeb上の入口が欠かせません。","製造業のLPでは、取扱製品・加工技術・対応規模を整える構成にしています。"),
    "卸売・商社": ("商社・卸売事業","商社・卸売業界では、取扱商品・取引実績・取引体制が見える状態になっているかどうかで、商談前の信用形成に差が出ます。Web上の情報が薄いと、新規取引先からの引き合いが入りにくい状態が続きがちです。","卸売・商社のLPでは、取扱商品・取引実績・取引体制を整理する構成にしています。"),
    "資産運用・金融": ("資産マネジメント・金融関連の事業","資産運用・金融領域では、新規顧客が面談前にWeb上でじっくり情報収集する傾向が強く、提供サービス・対応領域・運用方針が見えないと比較段階で選ばれにくくなります。","資産運用・金融のLPでは、提供サービス・対応領域・運用方針を整理する構成にしています。"),
    "総合サービス業": ("幅広いサービス事業","総合サービス業では、対応領域の広さがかえって「何をやっている会社か分からない」と捉えられ、機会損失に繋がるケースが少なくありません。","総合サービス業のLPでは、提供領域・実績・対応エリアを構造化する構成にしています。"),
    "汎用コーポレート": ("事業内容","新規法人様の場合、会社名で検索された際に、事業内容や相談窓口が分かるページがあるだけでも、取引先や見込み客からの信頼感が大きく変わります。会社情報の見える化が遅れると、せっかくの取引機会や採用機会を逃してしまう状態が続きがちです。","汎用コーポレート型のLPでは、事業内容・強み・対応エリアを整える構成にしています。"),
}

# ============================================================
# 業種推定
# ============================================================
def classify_industry(name, slug=""):
    n = name + " " + slug.lower()
    rules = [
        ("電気工事業",  r"電気工事|denki|電気"),
        ("リフォーム業", r"リフォーム|aireform|reform"),
        ("建設業",      r"建設|工務店|工事|construction|kensetsu|建築|isoda|造園"),
        ("不動産業",    r"不動産|estate|エステート|住宅|住生活|home(?!page)|ビル株式会社|遺産相続"),
        ("飲食業",      r"dining|食堂|レストラン|cafe|キッチン|cuisine|kitchen|アラキッチ"),
        ("医療・福祉",  r"メディカル|medical|介護|ケア(?!ホールディング)|福祉|nursing|care"),
        ("教育・スクール", r"学習塾|塾|スクール|school|教育|アカデミー|academy|学院|edental"),
        ("製造業",      r"製作所|工業|industry|industrial|manufacturing|ファクトリー|factory|kogyo|シール|印刷舗|新聞舗"),
        ("運送・物流",  r"運送|物流|logistics|trucking|配送|delivery|trans"),
        ("広告・マーケティング", r"広告|marketing|アド|adsapo|advert|posuten|ポスティング|postcom|ad-|adcues|adaxis|マーケティング|design|デザイン|写真|photo|印刷"),
        ("IT・システム開発", r"\bits\b|tech|technology|systems?|ynsystems|ymsys|ソフト|software|IT|データ|saas|アプリ|labs?(?!oratory)|maholab|wasabilab|remix|ファインテック|ai\b|ignite|innovate|inobeed|easter|e-style"),
        ("美容・サロン",  r"美容|サロン|salon|beauty|lumina|ルミナ|cosme|エステ|alba"),
        ("卸売・商社",  r"商事|商会|trading|trade|商社|shoji|商店|一籠商事"),
        ("資産運用・金融", r"asset|アセット|アセツト|investment|capital|fund|金融|ファンド|holdings|キャピタル|capital"),
        ("士業・コンサルティング", r"社会保険労務士|労務|税理士|会計|司法書士|行政書士|弁護士|consult|コンサル|advisory|遺産相続|partners"),
        ("小売・EC",    r"小売|販売|retail|store|EC|通販|ショップ|shop"),
        ("総合サービス業", r"総合|general|service|ジャパン|japan(?!.*商工)|130holdingcompany"),
    ]
    for cat, pat in rules:
        if re.search(pat, n, re.IGNORECASE):
            return cat
    return "汎用コーポレート"

# ============================================================
# 既存JSONから町名→郵便番号マッピング構築
# ============================================================
def build_zip_map():
    """既存sales_list.jsonから、町名（市区＋大字）→郵便番号のマッピング"""
    zmap = {}
    try:
        with open(SALES_JSON, encoding="utf-8") as f:
            j = json.load(f)
        for r in j["records"]:
            addr = r["row"][4]
            if not addr or not addr.startswith("〒"): continue
            m = re.match(r"〒(\d{3}-\d{4})\s*(.+)", addr)
            if not m: continue
            zip_code = m.group(1)
            rest = m.group(2)
            # 「大阪府〇〇区△△町X-Y-Z」を「△△町」まで切り出し
            m2 = re.search(r"大阪府([^\s\d０-９]+?)([^\s\d０-９]+?)[\d０-９]", rest)
            if m2:
                key = m2.group(1) + m2.group(2)
                zmap[key] = zip_code
    except Exception as e:
        print(f"⚠️ zip_map構築失敗: {e}")
    return zmap

# 大阪府主要市区→郵便番号3桁マッピング（fallback）
ZIP_PREFIX = {
    "大阪市北区": "530", "大阪市中央区": "541", "大阪市西区": "550",
    "大阪市東淀川区": "533", "大阪市東住吉区": "546", "大阪市淀川区": "532",
    "大阪市平野区": "547", "大阪市西成区": "557", "大阪市生野区": "544",
    "大阪市住吉区": "558", "大阪市城東区": "536", "大阪市港区": "552",
    "大阪市西淀川区": "555", "大阪市天王寺区": "543", "大阪市東成区": "537",
    "大阪市阿倍野区": "545", "大阪市旭区": "535", "大阪市鶴見区": "538",
    "大阪市浪速区": "556", "大阪市住之江区": "559", "大阪市都島区": "534",
    "大阪市福島区": "553", "大阪市此花区": "554", "大阪市大正区": "551",
    "堺市堺区": "590", "堺市西区": "593", "堺市東区": "599", "堺市南区": "590",
    "堺市北区": "591", "堺市中区": "599", "堺市美原区": "587",
    "吹田市": "564", "豊中市": "560", "寝屋川市": "572", "茨木市": "567",
    "八尾市": "581", "東大阪市": "577", "高槻市": "569", "枚方市": "573",
    "箕面市": "562", "池田市": "563", "摂津市": "566", "守口市": "570",
    "門真市": "571", "大阪狭山市": "589", "富田林市": "584", "松原市": "580",
    "羽曳野市": "583", "和泉市": "594", "阪南市": "599", "泉南市": "590",
    "泉佐野市": "598", "岸和田市": "596", "交野市": "576", "三島郡": "618",
}

def add_zip(addr, zmap):
    """住所に郵便番号を付与（厳密版）

    重要ルール（ユーザー指示 2026-06-02）:
    - AI推測の郵便番号を絶対に入れない
    - 「市区町村だけで近い番号」も禁止
    - 確実に分かっている町名→郵便番号マッピング（zmap）にヒットした場合のみ付与
    - それ以外は郵便番号を付けず、住所そのものを返す（後工程で日本郵便公式検索を実施する前提）
    """
    if not addr: return addr
    if addr.startswith("〒"):
        # 既に "〒NNN-0000 ..." のような推測値が付いている場合は外してプレーンな住所に戻す
        m = re.match(r"〒(\d{3})-(\d{4})\s*(.+)$", addr)
        if m and m.group(2) == "0000":
            return m.group(3)
        return addr  # 正規の郵便番号（下4桁が0でない）はそのまま
    # 既存JSONの町名マッピング（過去に日本郵便で確認済みの実値）にヒットした場合のみ付与
    m = re.search(r"大阪府([^\s\d０-９]+?)([^\s\d０-９]+?)[\d０-９]", addr)
    if m:
        key = m.group(1) + m.group(2)
        if key in zmap:
            zip_code = zmap[key]
            # zmap の値は "NNN-NNNN" 形式（build_zip_map参照）。下4桁が0000のものは推測値として除外
            if isinstance(zip_code, str) and re.match(r"^\d{3}-\d{4}$", zip_code) and not zip_code.endswith("-0000"):
                return f"〒{zip_code} {addr}"
    # 推測禁止：郵便番号が確認できない場合は付けずに住所のみ返す
    return addr

# ============================================================
# DM長文生成
# ============================================================
def extract_region(addr):
    if not addr: return "大阪"
    a = re.sub(r"^〒\d{3}-\d{4}\s*", "", addr)
    m = re.search(r"大阪市([^\s\d０-９]+?区)", a)
    if m: return "大阪市" + m.group(1)
    m = re.search(r"堺市([^\s\d０-９]+?区)", a)
    if m: return "堺市" + m.group(1)
    m = re.search(r"大阪府([^\s\d０-９]+?市)", a)
    if m: return m.group(1)
    return "大阪府"

# ============================================================
# DM文章 v8 — 短文・QRコード前提・LP優先（2026-06-02ルール変更）
# ============================================================
# ルール:
# - 長文説明を廃止し、600〜850文字程度に
# - 冒頭で「貴社専用LPを作成した」と結論
# - QRコード前提（同封QRから読み取り誘導）
# - 業種別1文を入れ替え
# - 初期5万円・月額1万円〜の料金訴求
# - 公式LINEへの相談誘導で締め

INDUSTRY_DM_LINES = {
    # 建設・工務店・リフォーム系
    "建設業":         "施工事例や対応エリアが見やすいページがあることで、地域のお客様からの現地調査依頼につながりやすくなります。",
    "電気工事業":     "施工事例や対応エリアが見やすいページがあることで、地域のお客様からの現地調査依頼につながりやすくなります。",
    "リフォーム業":   "施工事例や対応エリアが見やすいページがあることで、地域のお客様からの現地調査依頼につながりやすくなります。",
    # 不動産・資産管理系
    "不動産業":       "不動産や資産に関わるサービスでは、第一印象の信頼感と相談導線が特に重要になります。",
    "資産運用・金融": "不動産や資産に関わるサービスでは、第一印象の信頼感と相談導線が特に重要になります。",
    # 飲食・店舗系
    "飲食業":         "店舗の雰囲気やこだわりがスマホで伝わることで、来店前の安心感につながります。",
    "小売・EC":       "店舗の雰囲気やこだわりがスマホで伝わることで、来店前の安心感につながります。",
    # 美容・サロン
    "美容・サロン":   "雰囲気やメニュー、予約導線がスマホで分かりやすいだけで、来店前の印象が大きく変わります。",
    # IT・クリエイティブ
    "IT・システム開発":     "サービス内容や強みが整理されたページがあることで、法人向けの信頼感や相談しやすさが伝わりやすくなります。",
    "広告・マーケティング": "サービス内容や強みが整理されたページがあることで、法人向けの信頼感や相談しやすさが伝わりやすくなります。",
    # 士業・コンサル
    "士業・コンサルティング": "専門性や相談しやすさが伝わるページがあることで、初回相談への心理的ハードルを下げやすくなります。",
}
# fallback: 汎用コーポレート
_DM_LINE_DEFAULT = "会社情報や事業内容が整理されたページは、取引先・見込み客・採用候補者に対する名刺代わりになります。"

def build_dm_morika(name, addr, url, industry, hp_yn="無", mobile="未対応"):
    """新ルール（2026-06-02〜）: 600〜850字、QRコード前提、LP優先の短文DM"""
    industry_line = INDUSTRY_DM_LINES.get(industry, _DM_LINE_DEFAULT)
    return (
        f"{name} 御中\n\n"
        f"突然のご連絡失礼いたします。\n株式会社MORIKAと申します。\n\n"
        f"今回、勝手ながら貴社専用のホームページサンプルを作成いたしました。\n\n"
        f"会社名で検索された際に、\n"
        f"「どのような会社か分かる」\n"
        f"「信頼できそう」\n"
        f"「問い合わせしやすい」\n"
        f"と感じてもらえる状態をイメージし、実際の公開ページに近い形で構成しております。\n\n"
        f"貴社専用LP：\n{url}\n\n"
        f"同封のQRコードからも、スマートフォンでご確認いただけます。\n"
        f"閲覧には以下をご利用ください。\n\n"
        f"ID：sample\nPW：sample1234\n\n"
        f"{industry_line}\n\n"
        f"今回のLPは、会社概要・事業内容・強み・問い合わせ導線が伝わるように作成しております。\n"
        f"現時点でホームページがない場合はもちろん、既にホームページをお持ちの場合でも、営業用・広告用・名刺代わりのページとして活用いただけます。\n\n"
        f"ご興味ございましたら、公式LINEよりお気軽にご相談ください。\n"
        f"現在、新規法人様限定で、初回相談・改善提案は無料で対応しております。\n\n"
        f"また、同封のサンプルLPをベースに制作する場合、初期制作費を通常10万円のところ、5万円でご案内可能です。\n"
        f"月額管理費は1万円〜で、ページ保守・簡易修正・相談対応まで含めてご案内できます。\n\n"
        f"公式LINE：\nhttps://line.me/R/ti/p/@015vzsdb\n\n"
        f"ご確認だけでも問題ございません。\n"
        f"貴社の事業拡大・問い合わせ改善の一助になれましたら幸いです。"
    )

# ============================================================
# slug 生成 (英字化)
# ============================================================
def make_slug(idx, name, hojin):
    # 既存名から英字スラグ抽出
    # 簡易: ASCII英字部分があればそれを採用、なければ管理番号のみ
    base = re.sub(r"^(株式会社|有限会社|合同会社|合名会社|有限責任事業組合)", "", name)
    base = re.sub(r"(株式会社|合同会社)$", "", base)
    en = re.findall(r"[A-Za-z][A-Za-z0-9\-]*", base)
    if en:
        slug = "-".join(en).lower()[:25]
    else:
        # ローマ字化簡易 (主要のみ)
        roman_map = {
            "アマノキャピタル":"amano-capital","アラキッチ":"arakichi","アロイ":"aloy",
            "アンクラージュ":"encourage","アンクルーズ":"uncruise","アントレース":"antrace",
            "アリエンド":"ariendo","有澤造園土木":"arisawa-zoen","アルグロウ":"argrow",
            "歩人運輸":"ayuto","アルバフローズ":"alba-flowers","アンドモア":"andmore",
            "イーグルレイズ":"eagle-raise","イーストノウ":"eastnow","イーロタックル":"erotackle",
            "池田自動車":"ikeda-auto","遺産相続対策大阪パートナー":"isan-osaka",
            "石田ビル":"ishida-bldg","衣心":"ikoro","頂":"itadaki",
            "一期一葉":"ichigo-ichiyo","壱原":"ichihara","一了":"ichiryo",
            "一興":"ichikou","一成":"issei","いとう写真":"ito-photo",
            "イノビード":"inobeed","イベント革命軍":"event-revolution","いむ":"imu",
            "安心":"anshin","アメリカのマーケティング":"american-mkt",
        }
        for k, v in roman_map.items():
            if k in name:
                slug = v
                break
        else:
            slug = f"co-{hojin[-6:]}"
    # 数字prefix
    return f"m{idx:03d}-{slug}"

# ============================================================
# 入力読込
# ============================================================
companies = []
with open(INPUT_TSV, encoding="utf-8") as f:
    for line in f:
        line = line.rstrip("\n")
        if not line: continue
        parts = line.split("\t")
        if len(parts) < 4: continue
        hojin, name, addr, established = parts[0], parts[1], parts[2], parts[3]
        companies.append({"hojin": hojin, "name": name, "addr": addr, "established": established})

print(f"入力55社を処理開始")
zmap = build_zip_map()
print(f"既存JSONから町名→郵便番号マッピング {len(zmap)} 件")

# ============================================================
# 業種・住所処理 + slug 割当
# ============================================================
for i, c in enumerate(companies, start=1):
    c["mgmt_no"] = 200 + i  # 管理番号 201〜255
    c["slug"] = make_slug(c["mgmt_no"], c["name"], c["hojin"])
    c["industry"] = classify_industry(c["name"], c["slug"])
    c["addr_z"] = add_zip(c["addr"], zmap)
    c["url"] = f"https://stage-up-lp.vercel.app/{c['slug']}"

# 集計
from collections import Counter
print(f"\n業種内訳:")
for ind, cnt in Counter(c["industry"] for c in companies).most_common():
    print(f"  {ind}: {cnt}")

# ============================================================
# LP生成（build_lps.py のテンプレート流用）
# ============================================================
def assign_design(no, industry):
    palettes = PALETTES.get(industry, PALETTES["汎用コーポレート"])
    palette = palettes[no % len(palettes)]
    layouts = ["split", "center", "fullbg"]
    layout = layouts[(no // len(palettes)) % len(layouts)]
    copies = HERO_COPIES.get(industry, HERO_COPIES["汎用コーポレート"])
    copy = copies[no % len(copies)]
    return palette, layout, copy

HERO_IMGS = {
    "建設業":"https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1400&q=70",
    "電気工事業":"https://images.unsplash.com/photo-1581094288338-2314dddb7ece?auto=format&fit=crop&w=1400&q=70",
    "リフォーム業":"https://images.unsplash.com/photo-1503387837-b154d5074bd2?auto=format&fit=crop&w=1400&q=70",
    "不動産業":"https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1400&q=70",
    "IT・システム開発":"https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=70",
    "広告・マーケティング":"https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1400&q=70",
    "士業・コンサルティング":"https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1400&q=70",
    "運送・物流":"https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=1400&q=70",
    "美容・サロン":"https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1400&q=70",
    "飲食業":"https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1400&q=70",
    "医療・福祉":"https://images.unsplash.com/photo-1581595220892-b0739db3ba8c?auto=format&fit=crop&w=1400&q=70",
    "教育・スクール":"https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1400&q=70",
    "小売・EC":"https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1400&q=70",
    "製造業":"https://images.unsplash.com/photo-1530124566582-a618bc2615dc?auto=format&fit=crop&w=1400&q=70",
    "卸売・商社":"https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1400&q=70",
    "資産運用・金融":"https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1400&q=70",
    "総合サービス業":"https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1400&q=70",
    "汎用コーポレート":"https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1400&q=70",
}

def gen_lp_html(c):
    name = c["name"]; addr = c["addr_z"]; industry = c["industry"]
    url = c["url"]; mgmt_no = c["mgmt_no"]
    pal, layout, hero_copy = assign_design(mgmt_no, industry)
    region = extract_region(addr)
    biz_desc = BUSINESS_DESCRIPTIONS.get(industry, BUSINESS_DESCRIPTIONS["汎用コーポレート"])
    services = SERVICES.get(industry, SERVICES["汎用コーポレート"])
    mark = (re.search(r'[A-Za-z]', name) or [None])[0]
    if mark: mark = mark.group(0).upper() if hasattr(mark, "group") else mark.upper()
    else: mark = name[0]
    hero_img = HERO_IMGS.get(industry, HERO_IMGS["汎用コーポレート"])

    if layout == "split":
        hero = f'''<section class="hero hero-split"><div class="container"><div class="hero-grid"><div><p class="hero-eyebrow">— {industry} —</p><h1 class="hero-title">{hero_copy}</h1><p class="hero-sub">{biz_desc}</p><div class="hero-cta"><a href="#contact" class="btn btn-primary">お問い合わせはこちら</a><a href="#biz" class="btn btn-ghost">事業内容を見る</a></div></div><div class="hero-visual"><img src="{hero_img}" alt="" loading="lazy"/></div></div></div></section>'''
    elif layout == "center":
        hero = f'''<section class="hero hero-center"><div class="container hero-center-inner"><p class="hero-eyebrow">— {industry} —</p><h1 class="hero-title">{hero_copy}</h1><p class="hero-sub">{biz_desc}</p><div class="hero-cta"><a href="#contact" class="btn btn-primary">お問い合わせはこちら</a><a href="#biz" class="btn btn-ghost">事業内容を見る</a></div></div><div class="hero-strip"><img src="{hero_img}" alt="" loading="lazy"/></div></section>'''
    else:
        hero = f'''<section class="hero hero-fullbg" style="background-image:linear-gradient(135deg,rgba(0,0,0,.55),rgba(0,0,0,.3)),url('{hero_img}');"><div class="container hero-fullbg-inner"><p class="hero-eyebrow hero-eyebrow-light">— {industry} —</p><h1 class="hero-title hero-title-light">{hero_copy}</h1><p class="hero-sub hero-sub-light">{biz_desc}</p><div class="hero-cta"><a href="#contact" class="btn btn-primary">お問い合わせはこちら</a><a href="#biz" class="btn btn-ghost btn-ghost-light">事業内容を見る</a></div></div></section>'''

    biz_items = "".join(f'<article class="biz-card"><span class="biz-no">— {i+1:02d} —</span><h3 class="biz-h">{s[0]}</h3><p class="biz-d">{s[1]}</p></article>' for i, s in enumerate(services))

    return f'''<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5"/>
<meta name="theme-color" content="{pal['primary']}"/><meta name="robots" content="noindex,nofollow"/>
<title>{name}｜{hero_copy}</title><meta name="description" content="{name}は{biz_desc}"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Noto+Serif+JP:wght@500;600&display=swap" rel="stylesheet"/>
<style>
:root{{--bg:{pal['bg']};--paper:{pal['paper']};--ink:{pal['ink']};--muted:{pal['muted']};--primary:{pal['primary']};--accent:{pal['accent']};--border:{pal['border']}}}
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
html{{scroll-behavior:smooth;scroll-padding-top:80px;-webkit-text-size-adjust:100%}}
body{{font-family:"Noto Sans JP",sans-serif;background:var(--bg);color:var(--muted);font-size:15px;line-height:1.95;-webkit-font-smoothing:antialiased;padding-top:30px}}
img{{display:block;max-width:100%;height:auto}}a{{color:inherit;text-decoration:none}}button{{font:inherit;color:inherit;background:none;border:0;cursor:pointer}}ul,ol{{list-style:none}}
.container{{width:100%;max-width:1180px;margin:0 auto;padding:0 24px}}
@media(min-width:768px){{.container{{padding:0 40px}}}}
.sample-bar{{position:fixed;top:0;left:0;right:0;z-index:60;background:var(--ink);color:#fff;padding:7px 16px;text-align:center;font-size:11px;letter-spacing:.1em;opacity:.92}}
.site-header{{position:fixed;top:30px;left:0;right:0;z-index:50;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:border-color .3s}}
.site-header.is-scrolled{{border-bottom-color:var(--border)}}
.header-inner{{display:flex;align-items:center;justify-content:space-between;gap:16px;height:70px}}
.brand{{display:flex;align-items:center;gap:12px}}.brand-mark{{width:42px;height:42px;display:grid;place-items:center;background:var(--primary);color:#fff;font-family:"Noto Serif JP",serif;font-weight:600;font-size:18px;border-radius:6px}}
.brand-name{{font-family:"Noto Serif JP",serif;font-weight:600;color:var(--ink);font-size:16px;letter-spacing:.05em}}
.btn{{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 28px;border-radius:6px;font-weight:600;font-size:14px;letter-spacing:.08em;transition:transform .15s,opacity .15s}}
.btn-primary{{background:var(--primary);color:#fff}}.btn-primary:hover{{transform:translateY(-1px);opacity:.92}}
.btn-ghost{{background:transparent;color:var(--ink);border:1px solid var(--ink)}}.btn-ghost:hover{{background:var(--ink);color:var(--paper)}}
.btn-ghost-light{{color:#fff;border-color:#fff}}.btn-ghost-light:hover{{background:#fff;color:var(--ink)}}
.btn-h-primary{{padding:11px 22px;background:var(--primary);color:#fff;font-size:13px;font-weight:600;letter-spacing:.05em;border-radius:6px;display:inline-flex;align-items:center;gap:8px}}
.hero{{padding:130px 0 80px;position:relative;overflow:hidden}}
@media(min-width:768px){{.hero{{padding:170px 0 110px}}}}
.hero-eyebrow{{display:inline-flex;align-items:center;gap:12px;font-family:"Noto Serif JP",serif;font-size:13px;color:var(--primary);letter-spacing:.25em;margin-bottom:24px}}
.hero-eyebrow::before{{content:"";display:inline-block;width:28px;height:1px;background:var(--accent)}}
.hero-eyebrow-light{{color:#fff}}.hero-eyebrow-light::before{{background:#fff}}
.hero-title{{font-family:"Noto Serif JP",serif;font-weight:600;color:var(--ink);font-size:34px;line-height:1.45;letter-spacing:.05em}}
@media(min-width:640px){{.hero-title{{font-size:44px}}}}@media(min-width:1024px){{.hero-title{{font-size:54px}}}}
.hero-title-light{{color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.3)}}
.hero-sub{{margin-top:28px;color:var(--muted);font-size:15px;line-height:2.05;max-width:560px}}
.hero-sub-light{{color:rgba(255,255,255,.92)}}
.hero-cta{{margin-top:36px;display:flex;flex-wrap:wrap;gap:14px}}
.hero-split .hero-grid{{display:grid;gap:48px;align-items:center}}
@media(min-width:980px){{.hero-split .hero-grid{{grid-template-columns:1.1fr 1fr;gap:80px}}}}
.hero-split .hero-visual{{aspect-ratio:5/4;overflow:hidden;border-radius:8px;background:var(--border)}}
.hero-split .hero-visual img{{width:100%;height:100%;object-fit:cover}}
.hero-center .hero-center-inner{{max-width:780px;margin:0 auto;text-align:center}}
.hero-center .hero-eyebrow{{justify-content:center}}.hero-center .hero-sub{{margin-left:auto;margin-right:auto}}.hero-center .hero-cta{{justify-content:center}}
.hero-center .hero-strip{{margin-top:60px;aspect-ratio:21/9;overflow:hidden}}
.hero-center .hero-strip img{{width:100%;height:100%;object-fit:cover}}
.hero-fullbg{{padding:170px 0 130px;background-size:cover;background-position:center}}
.hero-fullbg .hero-fullbg-inner{{max-width:720px}}
.section{{padding:90px 0}}@media(min-width:768px){{.section{{padding:120px 0}}}}
.section-soft{{background:color-mix(in srgb,var(--bg) 92%,var(--ink) 8%)}}
.s-eyebrow{{display:inline-flex;align-items:center;gap:12px;font-family:"Noto Serif JP",serif;font-size:13px;color:var(--primary);letter-spacing:.25em;margin-bottom:20px}}
.s-eyebrow::before{{content:"";display:inline-block;width:28px;height:1px;background:var(--accent)}}
.s-title{{font-family:"Noto Serif JP",serif;font-weight:600;color:var(--ink);font-size:30px;line-height:1.5;letter-spacing:.05em}}
@media(min-width:768px){{.s-title{{font-size:40px}}}}
.s-lead{{margin-top:22px;color:var(--muted);font-size:15px;line-height:2.1;max-width:720px}}
.biz-grid{{margin-top:56px;display:grid;gap:22px}}
@media(min-width:768px){{.biz-grid{{grid-template-columns:repeat(3,1fr)}}}}
.biz-card{{padding:36px 30px;background:var(--paper);border:1px solid var(--border);border-radius:8px;transition:transform .2s,box-shadow .2s}}
.biz-card:hover{{transform:translateY(-3px);box-shadow:0 20px 40px -20px rgba(0,0,0,.15)}}
.biz-no{{font-family:"Noto Serif JP",serif;font-size:13px;color:var(--accent);letter-spacing:.2em;font-weight:600}}
.biz-h{{margin-top:12px;font-family:"Noto Serif JP",serif;font-size:20px;color:var(--ink);font-weight:600;line-height:1.5}}
.biz-d{{margin-top:14px;font-size:14px;color:var(--muted);line-height:2}}
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
.sample-mark{{margin:36px auto 0;max-width:720px;padding:16px 24px;border:1px dashed var(--border);background:var(--paper);text-align:center;font-size:11px;color:var(--muted);border-radius:6px}}
.site-footer{{background:var(--ink);color:rgba(255,255,255,.7);padding:64px 0 28px}}
.footer-inner{{display:grid;gap:36px}}@media(min-width:768px){{.footer-inner{{grid-template-columns:1.5fr 1fr 1fr}}}}
.footer-name{{color:#fff;font-family:"Noto Serif JP",serif;font-weight:600;font-size:17px}}
.footer-lead{{margin-top:14px;font-size:13px;line-height:1.95;color:rgba(255,255,255,.65)}}
.footer-h{{font-family:"Noto Serif JP",serif;color:rgba(255,255,255,.85);font-size:13px;letter-spacing:.2em;margin-bottom:14px;font-weight:600}}
.footer-list li{{margin-bottom:9px;font-size:13px;color:rgba(255,255,255,.65)}}
.footer-bottom{{margin-top:48px;padding-top:22px;border-top:1px solid rgba(255,255,255,.12);font-size:11px;color:rgba(255,255,255,.45);text-align:center}}
</style></head><body>
<div class="sample-bar">※ご提案用サンプルページ｜本ページは公開されておりません</div>
<header class="site-header" id="header"><div class="container header-inner"><a href="#top" class="brand"><span class="brand-mark">{mark}</span><span class="brand-name">{name}</span></a><a href="#contact" class="btn-h-primary">お問い合わせ</a></div></header>
<main id="top">{hero}
<section id="biz" class="section"><div class="container"><p class="s-eyebrow">— Our Business —</p><h2 class="s-title">事業<br/>内容</h2><p class="s-lead">{biz_desc}</p><div class="biz-grid">{biz_items}</div></div></section>
<section id="reason" class="section section-soft"><div class="container"><p class="s-eyebrow">— Why Chosen —</p><h2 class="s-title">お客様に選ばれる<br/>3つの理由</h2>
<div style="margin-top:56px;display:grid;gap:0;border-top:1px solid var(--border)">
<article style="padding:30px 0;border-bottom:1px solid var(--border);display:grid;gap:16px;grid-template-columns:160px 1fr;align-items:start"><p style="font-family:Noto Serif JP,serif;font-size:13px;color:var(--accent);letter-spacing:.2em;font-weight:600">Reason<span style="display:block;font-size:30px;color:var(--ink);margin-top:6px;font-weight:600">01</span></p><div><h3 style="font-family:Noto Serif JP,serif;font-size:19px;color:var(--ink);font-weight:600;line-height:1.5">{region}を中心に積み重ねる信頼</h3><p style="margin-top:14px;color:var(--muted);font-size:14px;line-height:2.05">{region}でのお客様一件一件と向き合い、丁寧なご対応で築いてきた信頼関係を、これからも大切にしてまいります。</p></div></article>
<article style="padding:30px 0;border-bottom:1px solid var(--border);display:grid;gap:16px;grid-template-columns:160px 1fr;align-items:start"><p style="font-family:Noto Serif JP,serif;font-size:13px;color:var(--accent);letter-spacing:.2em;font-weight:600">Reason<span style="display:block;font-size:30px;color:var(--ink);margin-top:6px;font-weight:600">02</span></p><div><h3 style="font-family:Noto Serif JP,serif;font-size:19px;color:var(--ink);font-weight:600;line-height:1.5">お客様一人ひとりに寄り添う対応</h3><p style="margin-top:14px;color:var(--muted);font-size:14px;line-height:2.05">画一的な対応ではなく、お客様の状況やご要望に応じた、きめ細やかなご対応を心がけております。</p></div></article>
<article style="padding:30px 0;border-bottom:1px solid var(--border);display:grid;gap:16px;grid-template-columns:160px 1fr;align-items:start"><p style="font-family:Noto Serif JP,serif;font-size:13px;color:var(--accent);letter-spacing:.2em;font-weight:600">Reason<span style="display:block;font-size:30px;color:var(--ink);margin-top:6px;font-weight:600">03</span></p><div><h3 style="font-family:Noto Serif JP,serif;font-size:19px;color:var(--ink);font-weight:600;line-height:1.5">継続的なお取引が可能な体制</h3><p style="margin-top:14px;color:var(--muted);font-size:14px;line-height:2.05">一度のお取引で終わらず、お客様の事業や暮らしに長く寄り添える、信頼できるパートナーであることを目指しています。</p></div></article>
</div></div></section>
<section id="contact" class="contact"><div class="container"><div style="text-align:center"><p class="s-eyebrow" style="justify-content:center">— Contact —</p><h2 class="s-title">お気軽にお問い合わせください</h2><p class="s-lead" style="margin:22px auto 0">ご相談・お見積もりは無料です。お電話・お問い合わせフォームよりお気軽にどうぞ。</p></div>
<div class="contact-cards"><div class="ccard"><p class="ccard-l">TEL</p><p class="ccard-v">XXX-XXXX-XXXX</p><p class="ccard-n">受付 9:00-18:00<br/>（土日祝休）</p></div><div class="ccard"><p class="ccard-l">MAIL</p><p class="ccard-v">info@example.com</p><p class="ccard-n">24時間 受付<br/>返信は営業日</p></div><div class="ccard"><p class="ccard-l">FORM</p><p class="ccard-v">お問い合わせ<br/>はこちら</p><p class="ccard-n">フォーム送信<br/>24時間 受付</p></div></div>
<div class="contact-buttons"><a href="#" class="btn btn-primary">お問い合わせはこちら</a></div>
<div class="sample-mark">※本ページはご提案用サンプルとして作成しております。掲載情報は仮の内容を含みます。</div></div></section></main>
<footer class="site-footer"><div class="container footer-inner"><div><p class="footer-name">{name}</p><p class="footer-lead">{biz_desc}</p></div><div><p class="footer-h">— Menu —</p><ul class="footer-list"><li><a href="#biz">事業内容</a></li><li><a href="#contact">お問い合わせ</a></li></ul></div><div><p class="footer-h">— Company —</p><ul class="footer-list"><li>所在地：{addr}</li><li>TEL：XXX-XXXX-XXXX</li><li>MAIL：info@example.com</li></ul></div></div>
<div class="footer-bottom">© {datetime.now().year} {name} All rights reserved.&nbsp;｜&nbsp;※本ページはご提案用サンプルとして作成しております。掲載情報は仮の内容を含みます。</div></footer>
<script>var h=document.getElementById("header");window.addEventListener("scroll",function(){{if(window.scrollY>20)h.classList.add("is-scrolled");else h.classList.remove("is-scrolled")}},{{passive:true}});</script>
</body></html>'''

# LP 書き出し
for c in companies:
    path = f"{PROP_DIR}/{c['slug']}.html"
    with open(path, "w", encoding="utf-8") as f:
        f.write(gen_lp_html(c))
print(f"\n✅ LP生成完了: {len(companies)} 件")

# ============================================================
# auth.js に slug追加
# ============================================================
with open(AUTH_JS, encoding="utf-8") as f:
    auth_src = f.read()
new_entries = []
for c in companies:
    if f'"{c["slug"]}"' not in auth_src:
        new_entries.append(f'  "{c["slug"]}":'.ljust(40) + f' SAMPLE_AUTH,  // {c["name"]} / {c["industry"]}')
if new_entries:
    insert_block = "\n  // ─── MORIKA新シート 55社追加 ───\n" + "\n".join(new_entries) + "\n"
    # 「LP作成しない」コメントの直前に挿入
    marker = "  // ─── LP作成しない"
    if marker in auth_src:
        new_auth = auth_src.replace(marker, insert_block + "\n" + marker)
    else:
        new_auth = auth_src.replace("};", insert_block + "};", 1)
    with open(AUTH_JS, "w", encoding="utf-8") as f:
        f.write(new_auth)
    print(f"✅ auth.js に {len(new_entries)} slug追加")
else:
    print(f"⚠️ auth.js は既に最新")

# ============================================================
# data/morika_list.json 出力
# ============================================================
records = []
for c in companies:
    # new_row (10要素・K列はApps Script側で注入)
    new_row = [
        c["mgmt_no"], c["name"], c["addr_z"], "", "無", c["industry"],
        "", "", "", c["url"],
    ]
    dm_morika = build_dm_morika(c["name"], c["addr_z"], c["url"], c["industry"])
    records.append({
        "no": c["mgmt_no"],
        "hojin": c["hojin"],
        "name": c["name"],
        "row": new_row,
        "dm_morika": dm_morika,
        "established": c["established"],
    })

HEADERS_NEW = [
    '管理番号','会社名','住所','HP URL','LINE有無','業種予測',
    'DM送付','面談状況','備考','LP URL','DM文章'
]
WIDTHS_NEW = [60,240,300,200,70,140,80,80,240,280,420]

out = {
    "schema_version": "morika-1.0",
    "generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
    "date": TODAY,
    "sender_name_new": "株式会社MORIKA",
    "new_sheet_gid": 2079338722,
    "headers_new": HEADERS_NEW,
    "num_cols_new": 11,
    "column_widths_new": WIDTHS_NEW,
    "row_height_px": 21,
    "count": len(records),
    "records": records,
}
with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print(f"✅ JSON出力: {OUT_JSON} ({os.path.getsize(OUT_JSON):,} bytes)")
print(f"   レコード数: {len(records)}")
print(f"   DM長文 平均: {sum(len(r['dm_morika']) for r in records)//len(records)}字")
print(f"   全社 MORIKA含有: {sum(1 for r in records if '株式会社MORIKA' in r['dm_morika'])}/{len(records)}")
print(f"   全社 LP URL含有: {sum(1 for r in records if r['row'][9].startswith('https://'))}/{len(records)}")
