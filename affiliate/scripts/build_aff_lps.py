#!/usr/bin/env python3
"""
通信ジャンル アフィリエイトLP 一括生成
============================================

戦略:
  - niches.json × offers.json の組合せでニッチ特化LPを大量生成
  - 1ニッチに対し preferred_offers の各案件で個別LP作成
  - スマホファースト、CTA連発、景表法配慮、計測タグ埋込

出力: affiliate/lp/{niche_id}-{offer_id}.html
URL設計（Vercel）: /a/{niche_id}-{offer_id}

CV計測 / 広告計測の前提:
  - 広告流入時の gclid/yclid/utm_* をクエリでLPに引き渡す
  - LP内CTAクリック時にそれを ASP リンクに引き継ぎ（GET追記）
  - GA4 / Microsoft Clarity / ASP計測タグはconfig.jsonから読込

実行:
  python3 affiliate/scripts/build_aff_lps.py
"""
import os, json, html as html_mod
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AFF_DIR = f"{ROOT}/affiliate"
OFFERS_JSON = f"{AFF_DIR}/data/offers.json"
NICHES_JSON = f"{AFF_DIR}/data/niches.json"
CONFIG_JSON = f"{AFF_DIR}/data/tracking_config.json"
OUT_DIR = f"{AFF_DIR}/lp"

# ============================================================
# データ読込
# ============================================================
with open(OFFERS_JSON, encoding="utf-8") as f:
    offers_data = json.load(f)
with open(NICHES_JSON, encoding="utf-8") as f:
    niches_data = json.load(f)

OFFERS = {o["id"]: o for o in offers_data["offers"]}
NICHES = {n["id"]: n for n in niches_data["niches"]}

# tracking_config.json は未作成の場合デフォルト
try:
    with open(CONFIG_JSON, encoding="utf-8") as f:
        TRACKING = json.load(f)
except FileNotFoundError:
    TRACKING = {
        "ga4_measurement_id": "",
        "clarity_project_id": "",
        "asp_conversion_tags": {}
    }

# ============================================================
# カラーテーマ（カテゴリ別）
# ============================================================
THEMES = {
    "home_router": {
        "primary": "#0066cc", "accent": "#ff7a00", "bg": "#f7faff", "ink": "#0f1830"
    },
    "pocket_wifi": {
        "primary": "#1850a5", "accent": "#f0b400", "bg": "#f4f7fc", "ink": "#0d1830"
    },
    "fiber": {
        "primary": "#c8102e", "accent": "#003a70", "bg": "#fdf6f7", "ink": "#1a0d14"
    },
    "mvno": {
        "primary": "#bf0000", "accent": "#ffb700", "bg": "#fffaf6", "ink": "#1a0a0a"
    }
}

# ============================================================
# 各種ヘルパー
# ============================================================
def yen(v):
    return f"{v:,}円" if v else "0円"

def esc(s):
    return html_mod.escape(str(s)) if s is not None else ""

def cashback_block(offer):
    if not offer.get("cashback_jpy"):
        return ""
    return f"""<div class="cashback-callout">
      <span class="cb-label">代理店経由特典</span>
      <span class="cb-amount">最大 {yen(offer['cashback_jpy'])} キャッシュバック</span>
      <span class="cb-cond">※{esc(offer['cashback_condition'])}</span>
    </div>"""

# ============================================================
# 口コミ生成（ニッチ×案件で出し分け）
# ============================================================
VOICE_TEMPLATES = {
    "one_person_room": [
        ("Aさん（22歳・社会人1年目）", "新卒で一人暮らし始めて、引っ越し当日に注文したら3日で届きました。コンセント挿すだけで使えて感動。スマホのギガを気にせずYouTube見れるのが嬉しいです。"),
        ("Tさん（24歳・営業職）", "学生時代から実家ぐらしだったので工事とか全くわからず…。これは届いて挿すだけだったので楽でした。月5,000円弱なら全然アリ。"),
        ("Yさん（27歳・在宅多め）", "家でリモートワークもするけどZoomも問題なし。引っ越したらまた持っていけるのも気に入ってます。"),
    ],
    "rental_no_construction": [
        ("Sさん（32歳・賃貸マンション）", "大家さんに工事の話をするのが本当に気まずくて避けてました。これなら何も手続きいらないので即決。届いた日から使えました。"),
        ("Mさん（29歳・アパート住み）", "管理会社に光NGと言われて困ってたところでこれ知りました。原状回復も考えなくていいから本当に楽です。"),
        ("Hさん（35歳・転勤族）", "賃貸を転々とするので、毎回工事してたら大変。コンセント挿すだけで使えるのは本当にありがたい。"),
    ],
    "remote_worker": [
        ("Kさん（38歳・IT職）", "前のADSLからの乗換ですが、Web会議が落ちることが激減。VPN接続も安定しています。"),
        ("Iさん（42歳・コンサル）", "Zoom中に画面共有しても固まらない。仕事道具なので回線品質は妥協できないところでした。"),
        ("Nさん（45歳・経理）", "経費精算ソフトもストレスなく動くし、月末の混雑時間帯でも安定してます。"),
    ],
    "elderly_simple": [
        ("Yさん（68歳・年金生活）", "息子に勧められて契約しました。コンセントに挿すだけで本当にすぐ使えたのにはびっくり。孫の顔をビデオ通話で見られて嬉しいです。"),
        ("Oさん（72歳）", "業者さんを家に上げるのが嫌でWiFiを諦めていましたが、これは宅配便で届いて自分で設置できました。"),
        ("Tさん（54歳・実家暮らしの母用に契約）", "実家の母にプレゼントしました。電話サポートがあるので、わからないことは聞けて助かっています。"),
    ],
    "business_traveler": [
        ("Iさん（39歳・全国出張営業）", "ホテルWiFiが遅くて困ることが多かったので導入。新幹線でも安定して使えて重宝してます。"),
        ("Mさん（41歳・フリーランス）", "カフェ作業が多いんですが、自分のWiFiがあるだけでセキュリティ面も安心。バッテリーも丸一日もちます。"),
        ("Sさん（33歳・出張多め）", "出張先のホテルでZoom会議があるとき、ホテルWiFiは怖いのでこれを使ってます。"),
    ],
    "price_sensitive": [
        ("Aさん（28歳）", "前は月9,000円超えてましたが、乗り換えで半額以下になりました。手続きはオンラインで30分くらいで終了。"),
        ("Kさん（35歳・主婦）", "家族で乗り換えて、トータル月20,000円以上下がりました。浮いたお金で家族旅行に行けそうです。"),
        ("Tさん（24歳）", "ポイント還元込みで実質さらに安くなった印象。電波も普段使いなら全然問題なし。"),
    ],
    "gamer": [
        ("Rさん（24歳・FPSプレイヤー）", "前のマンションタイプの光から乗り換えて、Pingが30→15に。Apexで競技シーンに復帰できました。"),
        ("Kさん（28歳・配信者）", "配信中に回線が落ちることがほぼゼロになりました。視聴者にも『画質良くなった』と好評です。"),
        ("Sさん（19歳・大学生）", "ダウンロードが爆速で、新作ゲームのインストールが体感半分以下。夜の時間帯も安定してます。"),
    ],
    "family_discount": [
        ("Mさん（42歳・3児の父）", "家族5人分のスマホ代がトータル月18,000円下がりました。子供のギガ不足の悩みもなくなった。"),
        ("Iさん（38歳）", "光回線とスマホをセットにしたら永年割引で、年間4万円以上の節約に。"),
        ("Tさん（45歳・夫婦＋大学生）", "ショップに行かなくてもオンラインで家族まとめて手続きできて拍子抜けするくらい楽でした。"),
    ],
    "kids_smartphone": [
        ("Hさん（44歳・娘が中1）", "月990円のプランで子供のスマホデビュー。容量制限と無料フィルタリングで安心。"),
        ("Nさん（48歳・息子が高1）", "前は大手キャリアで月6,000円弱でしたが、乗換で1,500円程度に。年間5万円浮きました。"),
        ("Yさん（41歳・娘が中3）", "親のスマホと同じキャリアにすると家族割でさらに安くなったので、家族でまとめて切替えました。"),
    ],
    "moving_fiber": [
        ("Tさん（35歳・新築戸建て）", "引越しの2ヶ月前から動いて、入居当日に開通できました。工事費も実質無料で助かりました。"),
        ("Aさん（39歳・分譲マンション）", "管理会社経由で配線方式を確認してから契約。スムーズに開通して快適です。"),
        ("Mさん（41歳・転勤族）", "全国どこでも対応してくれて、移転手続きもオンラインで完結。長く付き合えそうです。"),
    ],
    "student_new": [
        ("Yさん（18歳・新大学生）", "生協のプランより月2,000円以上安くなって、親も納得してくれました。卒業時の解約金もないので安心。"),
        ("Sさん（19歳・親が契約）", "息子の進学に合わせて契約。本人がスマホで設定できて、上京初日からネット使えて感謝されました。"),
        ("Tさん（20歳・大学2年）", "大学生協の契約は2年縛りで嫌だったので乗り換え。月額もポイント還元込みで実質さらに安いです。"),
    ],
    "moving_urgent": [
        ("Kさん（32歳・転勤）", "急な辞令で引越し決定→3日後にWiFiが届いて間に合いました。光回線の工事を待っていたら仕事に影響していたと思います。"),
        ("Mさん（28歳）", "店舗で即日受取できたので、引越し当日からネット使えました。テザリングだとバッテリーがすぐ切れていたので本当に助かった。"),
        ("Iさん（35歳・出張族）", "申込から30分で発送手続き完了。翌日午前中に到着して、その日のWeb会議に間に合いました。"),
    ],
    "couple_pair": [
        ("Aさん（27歳・同棲中）", "彼とテレワーク同時に使っても回線が落ちなくなって、夜のNetflix鑑賞も快適です。"),
        ("Hさん（30歳・新婚）", "光回線とスマホをセットにしたら、2人分のスマホ代も含めて月12,000円下がりました。"),
        ("Sさん（24歳・カップル）", "縛りなしプランを選んだので、引越しのタイミングでも気楽。2人で使ってもストレスなしです。"),
    ],
    "video_streaming": [
        ("Hさん（29歳・Netflix廃人）", "4K動画も止まらなくなって、深夜の混雑時間帯でも快適に視聴できてます。"),
        ("Tさん（35歳・YouTube視聴）", "月の動画視聴時間が100時間超えますが、データ容量を気にせず使えるのが本当に楽。"),
        ("Mさん（31歳・複数サブスク）", "Netflix・アマプラ・Disney+を家族で同時視聴しても全く問題なし。回線を変えて正解でした。"),
    ],
    "corporate_small": [
        ("Iさん（45歳・建設業経営）", "事務所5名分のWeb会議が同時に使えるようになって、業務効率が上がりました。法人契約で経費処理もスムーズ。"),
        ("Mさん（38歳・税理士事務所）", "クラウド会計を使うので回線品質が重要でした。乗換後はストレスゼロです。"),
        ("Kさん（42歳・個人事業主）", "領収書発行もしっかり対応してくれて、経費計上が楽になりました。"),
    ],
    "freelancer": [
        ("Tさん（32歳・Webデザイナー）", "クライアント先のWeb会議で落ちる心配がなくなった。バッテリーも丸一日持つので外出時も安心。"),
        ("Nさん（35歳・エンジニア）", "コワーキング・カフェ・自宅とどこでも使えて、自分専用なのでセキュリティ面も安心。経費にも計上できます。"),
        ("Sさん（28歳・ライター）", "大容量データのアップロードも安定。前のテザリング地獄から解放されました。"),
    ],
    "mnp_from_au": [
        ("Kさん（41歳・元au）", "20年使ったauから乗換。au PAYやセット割は残せて、月のスマホ代だけ4,000円安くなりました。"),
        ("Mさん（35歳）", "MNP予約番号の取得が思ったより簡単。電波品質も変わらないので何で早く乗り換えなかったのかと。"),
        ("Tさん（28歳）", "auの2年縛り終わるタイミングで乗換。違約金もなく、新規入会特典で初期費用ゼロでした。"),
    ],
    "mnp_from_docomo": [
        ("Sさん（48歳・元docomo 20年）", "ahamoに変えて月料金が半額に。ドコモ回線品質はそのままなので不便ゼロです。"),
        ("Hさん（39歳）", "dポイント還元も継続できて、家族割の対象外にはなったけど結果トータル月8,000円節約できました。"),
        ("Aさん（31歳）", "オンライン手続きは不安でしたが、画面の指示通りに進めれば30分で完了。シンプルでした。"),
    ],
    "mnp_from_softbank": [
        ("Iさん（37歳・元SoftBank）", "ワイモバイルに変えたら月の支払いが3分の1に。PayPay還元もそのままで体感的な不便は全くなし。"),
        ("Kさん（44歳）", "おうち割光セットだけ気になっていましたが、ソフトバンク光のままで対応してもらえました。"),
        ("Yさん（29歳）", "LINEMOのミニプランで月990円。SNS・LINEメインの自分には十分でした。"),
    ],
    "second_line": [
        ("Mさん（33歳・会社員）", "メイン回線が大規模通信障害で使えなかった日、副回線のおかげで業務継続できました。月0円なので保険として完璧。"),
        ("Tさん（27歳）", "仕事用とプライベート用で分けたかったので、サブ回線として導入。番号も別で精神的にも区切りができました。"),
        ("Iさん（41歳・防災意識高め）", "災害時のリスク分散として副回線を契約。基本料金がほぼかからないのが決め手でした。"),
    ],
}

# ============================================================
# FAQ生成（カテゴリ別）
# ============================================================
FAQ_BY_CATEGORY = {
    "home_router": [
        ("Q. 工事は本当に不要ですか？", "はい、コンセントに挿してWiFi設定をするだけで使い始められます。回線工事の予約や立ち合いは不要です。"),
        ("Q. 申込からどれくらいで届きますか？", "在庫がある場合、最短で翌日〜3営業日程度で発送されるケースが多いです。エリアや配送状況により異なります。"),
        ("Q. 解約金はかかりますか？", "契約期間や解約タイミングにより異なります。契約縛りなしのプランも提供されています。詳細は申込前に必ず公式ページでご確認ください。"),
        ("Q. 速度は光回線と比べてどうですか？", "建物・エリア・時間帯により変動します。重い動画編集や大容量ダウンロードを頻繁に行う方は、光回線も比較検討されることをおすすめします。"),
        ("Q. キャッシュバックはいつ受け取れますか？", "案件により異なります。本ページ記載の受取時期・手続き方法を必ずご確認ください。期限内の手続きを忘れると受取できません。"),
    ],
    "pocket_wifi": [
        ("Q. 持ち運びはできますか？", "はい、バッテリー内蔵のモバイルタイプの場合、外出先でも使用できます。"),
        ("Q. データは本当に無制限ですか？", "プランにより制限内容が異なります。混雑時間帯の速度制限や、3日間の通信量目安が設定されている場合があります。詳細は公式ページをご確認ください。"),
        ("Q. 海外でも使えますか？", "国内専用の機種が多いです。海外利用は別途海外用WiFiレンタル等をご検討ください。"),
        ("Q. 申込からどれくらいで届きますか？", "最短即日〜数日で発送されます。"),
        ("Q. キャッシュバックの受取方法は？", "案件により異なります。多くの場合、契約から数ヶ月後にメール案内が届き、期日内に手続きが必要です。"),
    ],
    "fiber": [
        ("Q. 工事はどのくらいかかりますか？", "戸建てで2〜4週間、マンションで1〜3週間が目安です。繁忙期はさらに時間がかかる場合があります。"),
        ("Q. 賃貸でも契約できますか？", "建物の配線方式や管理会社の許可により異なります。事前にオーナー・管理会社にご確認ください。"),
        ("Q. 引っ越し時はどうなりますか？", "移転手続きで継続利用が可能です。手数料や工事費が発生する場合があります。"),
        ("Q. プロバイダはどう選べばいいですか？", "速度・料金・特典が異なります。本ページ記載のおすすめプロバイダを参考にしてください。"),
        ("Q. 解約金はいくらですか？", "契約期間・解約タイミングにより異なります。詳細は公式ページでご確認ください。"),
    ],
    "mvno": [
        ("Q. 今使っている電話番号はそのまま使えますか？", "MNP予約番号を取得すれば、番号そのままで乗り換え可能です。"),
        ("Q. 通信速度はどうですか？", "時間帯・エリアにより変動します。お昼や夕方の混雑時は速度が低下する場合があります。"),
        ("Q. iPhoneでも使えますか？", "SIMロック解除済みのiPhoneであれば多くの場合利用可能です。事前に対応機種をご確認ください。"),
        ("Q. 乗換手続きにどれくらいかかりますか？", "オンラインで30分〜1時間程度で完了するケースが多いです。"),
        ("Q. キャンペーンの適用条件は？", "新規契約・他社からの乗換など条件があります。公式ページで詳細をご確認ください。"),
    ],
}

# ============================================================
# HTML生成
# ============================================================
def gen_lp(niche, offer):
    # ===========================================================
    # 計算 & ヘルパーデータ
    # ===========================================================
    monthly = offer.get('monthly_fee_jpy', 0) or 0
    initial_fee = offer.get('initial_fee_jpy', 0) or 0
    cb = offer.get('cashback_jpy', 0) or 0
    total_24mo = monthly * 24
    effective_total = max(0, total_24mo + initial_fee - cb)
    effective_monthly = effective_total // 24 if cb else monthly
    has_cb = cb > 0

    # ----- カテゴリ別ブランド・サブカテゴリ -----
    cat_brands = {
        'home_router': ('Room WiFi Review', 'R'),
        'pocket_wifi': ('Pocket WiFi Lab', 'P'),
        'fiber':       ('Fiber Plan Guide', 'F'),
        'mvno':        ('Mobile Plan Compare', 'M'),
    }
    brand_name, brand_initial = cat_brands.get(offer['category'], cat_brands['home_router'])

    # ----- ヒーロー背景画像 -----
    hero_bg_urls = {
        'home_router': 'https://images.unsplash.com/photo-1522444195799-478538b28823?auto=format&fit=crop&w=1920&q=80',
        'pocket_wifi': 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1920&q=80',
        'fiber':       'https://images.unsplash.com/photo-1606001345859-fd9b0f8fc1f5?auto=format&fit=crop&w=1920&q=80',
        'mvno':        'https://images.unsplash.com/photo-1556656793-08538906a9f8?auto=format&fit=crop&w=1920&q=80',
    }
    hero_bg = hero_bg_urls.get(offer['category'], hero_bg_urls['home_router'])

    hero_eyebrows = {
        'home_router': '工事を待たずに、部屋のネットを整える',
        'pocket_wifi': '持ち運べる、自分専用のWiFi',
        'fiber':       '速度と安定。長く使う回線の選び方',
        'mvno':        '通信費の見直し、その第一歩',
    }
    hero_eyebrow = hero_eyebrows.get(offer['category'], hero_eyebrows['home_router'])

    # ----- ニッチ別フック（hero h1 用） -----
    niche_hooks = {
        'one_person_room':         ('ひとり暮らしのWiFi選びに', 'という現実解。'),
        'rental_no_construction':  ('賃貸でWiFiを始めるなら', 'という選択肢。'),
        'remote_worker':           ('在宅の通信品質を考えるなら', 'という基準。'),
        'elderly_simple':          ('親世代へのWiFi選びに', 'という安心。'),
        'business_traveler':       ('出張族の通信手段に', 'という現実解。'),
        'price_sensitive':         ('通信費を見直すなら', 'という選択肢。'),
        'gamer':                   ('ゲーマーの回線選びに', 'という基準。'),
        'family_discount':         ('家族の通信費まとめ替えに', 'という選択肢。'),
        'kids_smartphone':         ('子供のスマホ選びに', 'という選択肢。'),
        'moving_fiber':            ('引越し・新居の回線選びに', 'という基準。'),
        'student_new':             ('新大学生のWiFi選びに', 'という現実解。'),
        'moving_urgent':           ('急ぎのネット環境に', 'という現実解。'),
        'couple_pair':             ('ふたり暮らしの回線選びに', 'という選択肢。'),
        'video_streaming':         ('動画視聴の快適さに', 'という基準。'),
        'corporate_small':         ('法人の事務所WiFiに', 'という選択肢。'),
        'freelancer':              ('フリーランスの通信手段に', 'という選択肢。'),
        'mnp_from_au':             ('au乗換の選択肢として', 'という現実解。'),
        'mnp_from_docomo':         ('ドコモ乗換の選択肢として', 'という現実解。'),
        'mnp_from_softbank':       ('ソフトバンク乗換の選択肢として', 'という現実解。'),
        'second_line':             ('副回線・予備の通信手段に', 'という選択肢。'),
    }
    hook_pre, hook_post = niche_hooks.get(niche['id'], ('通信プラン選びに', 'という選択肢。'))

    # ----- カテゴリ別ユーザーシーン（3つ） -----
    user_scenes = {
        'home_router': [
            ('Scene 01', '新生活・ワンルームに', '引っ越し直後、開通工事を待たずにネット環境を整えたい新生活シーンに。',
             'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=720&q=70'),
            ('Scene 02', '在宅勤務のサブ回線に', '光回線のメンテナンス時でも通信が途切れない、冗長構成として。',
             'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=720&q=70'),
            ('Scene 03', '仮住まい・短期利用に', '契約期間の縛りなしプランで身軽に利用したい短期居住シーンに。',
             'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=720&q=70'),
        ],
        'pocket_wifi': [
            ('Scene 01', '出張・外回りの通信に', 'ホテル・カフェ・移動中でも自分専用回線でセキュアに作業できます。',
             'https://images.unsplash.com/photo-1473163928189-364b2c4e1135?auto=format&fit=crop&w=720&q=70'),
            ('Scene 02', '在宅と外出の兼用に', '1台で自宅・外出先の両方をカバー。身軽に動きたい働き方に。',
             'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=720&q=70'),
            ('Scene 03', '災害時の備えに', 'メイン回線が落ちた時の通信手段として、リスク分散の備えに。',
             'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=720&q=70'),
        ],
        'fiber': [
            ('Scene 01', '在宅ワークの主回線に', 'Web会議・VPN・クラウド業務を支える安定回線として。',
             'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=720&q=70'),
            ('Scene 02', 'ゲーマー・配信者の環境に', 'Ping値・上り速度を重視するオンラインゲーム・配信環境に。',
             'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=720&q=70'),
            ('Scene 03', '家族みんなの主回線に', '同時利用が多い家庭でも、安定して高速通信を共有できます。',
             'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=720&q=70'),
        ],
        'mvno': [
            ('Scene 01', '通信費を見直したい人に', '月のスマホ代を抑えつつ、必要十分なデータ容量を確保できます。',
             'https://images.unsplash.com/photo-1556656793-08538906a9f8?auto=format&fit=crop&w=720&q=70'),
            ('Scene 02', '副回線・予備として', 'メイン回線とは別の番号・通信手段として、リスク分散に。',
             'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=720&q=70'),
            ('Scene 03', '中高生・シニアの初スマホに', '使い方を抑えつつ、安心して持たせられる料金体系。',
             'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=720&q=70'),
        ],
    }
    scenes = user_scenes.get(offer['category'], user_scenes['home_router'])

    # ----- Editorial Score 計算 -----
    score = 4.5
    if offer.get('contract_period_months', 0) == 0:
        score += 0.2
    if cb >= 40000:   score += 0.2
    elif cb >= 20000: score += 0.1
    elif cb >= 10000: score += 0.05
    if monthly and monthly <= 3000: score += 0.1
    if monthly and monthly <= 1500: score += 0.05
    score = round(min(score, 4.9), 1)
    score_str = f"{score:.1f}"
    # 5段階の星HTML（半分対応）
    full = int(score)
    half = (score - full) >= 0.5
    stars_html = ""
    star_path = '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>'
    for i in range(5):
        if i < full:
            stars_html += f'<svg viewBox="0 0 24 24">{star_path}</svg>'
        elif i == full and half:
            stars_html += f'<svg viewBox="0 0 24 24" class="half">{star_path}</svg>'
        else:
            stars_html += f'<svg viewBox="0 0 24 24" style="fill:#dce3ed">{star_path}</svg>'

    # 3軸内訳（手軽さ/料金/柔軟性）
    score_setup = 5.0 if offer.get('contract_period_months', 0) == 0 else 4.5
    score_price = 5.0 if monthly <= 3000 else (4.7 if monthly <= 5000 else 4.3)
    score_flex  = 4.8 if offer.get('contract_period_months', 0) == 0 else 4.0
    score_breakdown = f"<strong>手軽さ</strong> {score_setup:.1f} / <strong>料金</strong> {score_price:.1f} / <strong>柔軟性</strong> {score_flex:.1f}"

    # ----- 同カテゴリ比較表（3案件） -----
    same_cat = [o for o in OFFERS.values() if o['category'] == offer['category']]
    same_cat.sort(key=lambda x: 0 if x['id'] == offer['id'] else 1)
    compare_rows = ""
    fit_phrases = {
        'home_router': ['工事なしで自宅WiFiを整えたい人','据置で安定した通信が必要な人','賃貸でも気軽に始めたい人'],
        'pocket_wifi': ['持ち運びを重視する人','出張・外回りが多い人','屋内外で兼用したい人'],
        'fiber':       ['長期利用で安定回線を求める人','ゲーム・動画など重い用途が多い人','家族で同時利用する世帯'],
        'mvno':        ['通信費を抑えたい人','サブ回線として持ちたい人','スマホ料金を見直したい人'],
    }
    fits = fit_phrases.get(offer['category'], fit_phrases['home_router'])
    for i, o in enumerate(same_cat[:3]):
        is_recommend = (o['id'] == offer['id'])
        cb_text = f'<span class="cb">最大{yen(o["cashback_jpy"])}</span>' if o.get('cashback_jpy') else '<span style="color:var(--muted)">─</span>'
        badge = '<span class="svc-badge">本ページ推奨</span>' if is_recommend else ''
        row_class = ' class="recommended"' if is_recommend else ''
        fit_text = fits[i] if i < len(fits) else fits[0]
        compare_rows += f'<tr{row_class}><td><div class="svc">{esc(o["name"])}{badge}</div></td><td><div class="price">{yen(o["monthly_fee_jpy"])}</div></td><td>{esc(o["data_cap"])}</td><td>{cb_text}</td><td class="fit">{esc(fit_text)}</td></tr>'

    # ----- 特徴3カード（offer.selling_points + SVGアイコン） -----
    feat_icons = [
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 7h11M9 12h11M9 17h11M4 7h.01M4 12h.01M4 17h.01" stroke-linecap="round"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18" stroke-linecap="round"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 12V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10h10M7 14h6" stroke-linecap="round"/><path d="M19 17v4M17 19h4" stroke-linecap="round"/></svg>',
    ]
    feat_kickers = ['01 / Setup', '02 / Data', '03 / Campaign']
    feat_html = ''
    for i, sp in enumerate(offer.get('selling_points', [])[:3]):
        icon = feat_icons[i % len(feat_icons)]
        kicker = feat_kickers[i % len(feat_kickers)]
        feat_html += f'<article class="fcard"><p class="fcard-no">{kicker}</p><div class="fcard-icon">{icon}</div><h3>{esc(sp)}</h3><p>{esc(niche["pain_points"][i] if i < len(niche.get("pain_points", [])) else "ご利用シーンに合わせた選択ができます。")}</p></article>'

    # ----- FAQ -----
    faqs = FAQ_BY_CATEGORY.get(offer['category'], FAQ_BY_CATEGORY['home_router'])[:4]
    faq_html = ''
    for q, a in faqs:
        faq_html += f'<details class="faq"><summary>{esc(q.replace("Q. ", ""))}</summary><div class="faq-body">{esc(a)}</div></details>'

    # ----- カテゴリ別 結論本文 -----
    conclusion_body = {
        'home_router': '電源を入れるだけで使い始められる据置型WiFiとして、工事不要・縛りなし・データ無制限という軸で「待てない」を解消する選択肢になります。',
        'pocket_wifi': '持ち運べる自分専用回線として、外出先のセキュリティと安定性を両立。サブ回線・出張時の通信手段としての選び方がポイントです。',
        'fiber':       '長く使う主回線として、速度・安定性・セット割の3軸で実質負担を見極めるのが選び方の基本になります。',
        'mvno':        '月の通信費を見直す際の選択肢として、データ容量・通話品質・サポート体制のバランスで比較するのが定石です。',
    }.get(offer['category'], '')

    # ----- 計測タグ -----
    ga4_id = TRACKING.get("ga4_measurement_id", "")
    aw_id = TRACKING.get("google_ads_conversion_id", "")
    ga4_tag = ""
    if ga4_id and aw_id:
        ga4_tag = f"""<!-- Google tag (gtag.js) - GA4 + Google Ads 統合 -->
<script async src="https://www.googletagmanager.com/gtag/js?id={ga4_id}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','{ga4_id}');gtag('config','{aw_id}');</script>"""
    elif ga4_id:
        ga4_tag = f"""<script async src="https://www.googletagmanager.com/gtag/js?id={ga4_id}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','{ga4_id}');</script>"""
    elif aw_id:
        ga4_tag = f"""<script async src="https://www.googletagmanager.com/gtag/js?id={aw_id}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','{aw_id}');</script>"""

    clarity_tag = ""
    if TRACKING.get("clarity_project_id"):
        cid = TRACKING["clarity_project_id"]
        clarity_tag = f"""<script type="text/javascript">(function(c,l,a,r,i,t,y){{c[a]=c[a]||function(){{(c[a].q=c[a].q||[]).push(arguments)}};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);}})(window,document,"clarity","script","{cid}");</script>"""

    # ----- CTA URL + tracking JS -----
    cta_url = offer.get('affiliate_url_placeholder', '#')
    cv_label = TRACKING.get('google_ads_conversion_label', '')
    cv_value = TRACKING.get('google_ads_conversion_value_jpy', 10000)
    cv_send_to = f"{aw_id}/{cv_label}" if (aw_id and cv_label) else ""

    # beacon transport で離脱前に確実に送信
    if cv_send_to:
        cta_event_js = f"""window.gtag("event","cta_click",{{offer:"{offer['id']}",niche:"{niche['id']}",page_variant:"premium",transport_type:"beacon"}});
          window.gtag("event","conversion",{{"send_to":"{cv_send_to}","value":{cv_value}.0,"currency":"JPY",transport_type:"beacon"}});"""
    else:
        cta_event_js = f"""window.gtag("event","cta_click",{{offer:"{offer['id']}",niche:"{niche['id']}",page_variant:"premium",transport_type:"beacon"}});"""

    # CTAクリック処理：preventDefault → gtag送信 → 短い遅延後にナビゲート（送信ロスを防ぐ）
    param_carry_js = f"""<script>
(function () {{
  var baseUrl = {repr(cta_url)};
  var params = new URLSearchParams(window.location.search);
  var keepKeys = ["gclid","yclid","msclkid","utm_source","utm_medium","utm_campaign","utm_term","utm_content"];
  var carried = [];
  keepKeys.forEach(function (k) {{ var v = params.get(k); if (v) carried.push(k + "=" + encodeURIComponent(v)); }});
  var sep = baseUrl.indexOf("?") > -1 ? "&" : "?";
  var destination = baseUrl + (carried.length ? sep + carried.join("&") : "");
  document.querySelectorAll("a.cta-link").forEach(function (link) {{
    link.href = destination;
    link.addEventListener("click", function (e) {{
      var navigated = false;
      var go = function () {{ if (navigated) return; navigated = true; window.location.href = destination; }};
      try {{
        if (window.gtag) {{
          e.preventDefault();
          {cta_event_js}
          // 念のため 350ms 後にナビゲート（gtag の送信猶予を確保）
          setTimeout(go, 350);
        }}
      }} catch (err) {{ go(); }}
    }});
  }});
}})();
</script>"""

    # ----- カテゴリ別CTAテキスト（コンバージョン最適化） -----
    _cat = offer.get('category', 'home_router')
    _is_contract_free = offer.get('contract_period_months', 0) == 0
    _contract_label = '縛りなし' if _is_contract_free else f"{offer['contract_period_months']}ヶ月契約"

    CTA_HERO   = {
        'home_router':  '今すぐ申し込む（工事不要・最短翌日）',
        'pocket_wifi':  '今すぐ申し込む（最短翌日発送）',
        'fiber':        '公式サイトで工事日を確認する',
        'mvno':         '今すぐSIMを申し込む（最短翌日発送）',
        'electricity':  '無料で切り替え申し込む（5分で完了）',
        'gas':          '無料でガス会社を比較する',
        'credit_card':  '今すぐ無料で申し込む',
    }.get(_cat, '公式サイトで申し込む')

    CTA_MID    = {
        'home_router':  '公式サイトで在庫・キャンペーンを確認する',
        'pocket_wifi':  '公式サイトでキャンペーンを確認する',
        'fiber':        '公式サイトで対応エリア・工事日を確認する',
        'mvno':         '公式サイトで料金・プランを確認する',
        'electricity':  '公式サイトで料金シミュレーションを確認する',
        'gas':          '無料でガス料金を比較する',
        'credit_card':  '公式サイトで入会特典を確認する',
    }.get(_cat, '公式サイトで確認する')

    CTA_FINAL  = {
        'home_router':  f'{esc(offer["name"])} に申し込む（公式サイト）',
        'pocket_wifi':  f'{esc(offer["name"])} に申し込む（公式サイト）',
        'fiber':        f'{esc(offer["name"])} の工事日を確認・申し込む',
        'mvno':         f'{esc(offer["name"])} のSIMを申し込む（公式）',
        'electricity':  f'{esc(offer["name"])} に無料で切り替え申し込む',
        'gas':          f'{esc(offer["name"])} で無料比較する',
        'credit_card':  f'{esc(offer["name"])} に無料で申し込む',
    }.get(_cat, f'{esc(offer["name"])} 公式サイトへ')

    CTA_STICKY = {
        'home_router':  f'申し込む（月額{yen(monthly)}〜）→',
        'pocket_wifi':  f'申し込む（月額{yen(monthly)}〜）→',
        'fiber':        f'対応エリアを確認・申し込む →',
        'mvno':         f'申し込む（月額{yen(monthly)}〜）→',
        'electricity':  '無料で切り替え申し込む →',
        'gas':          '無料でガス代を比較する →',
        'credit_card':  '無料で申し込む →',
    }.get(_cat, '公式サイトで申し込む →')

    # ----- CTAボタン前の安心バッジ -----
    _badges = []
    if _is_contract_free:
        _badges.append('縛り・解約金なし')
    if offer.get('initial_fee_jpy', 99999) == 0:
        _badges.append('初期費用0円')
    _badges.append('申込はオンライン完結')
    if _cat in ('home_router', 'pocket_wifi', 'mvno'):
        _badges.append('個人情報は公式サイトに直接入力')
    if _cat == 'fiber':
        _badges.append('工事日は後から調整可能')
    if _cat in ('electricity', 'gas'):
        _badges.append('現在の電力会社への連絡不要')

    trust_badges_html = '<div class="trust-badges">' + ''.join(
        f'<span class="tbadge">✓ {b}</span>' for b in _badges
    ) + '</div>'

    # ----- title/desc -----
    # 検索KWを title/desc に含めて品質スコアと SEO 両方を強化
    primary_kw = niche.get('search_keywords', [niche['name']])[0]
    cb_phrase = f"最大{cb:,}円キャッシュバック・" if has_cb else ""
    title = f"【{esc(primary_kw)}】{esc(offer['name'])} の料金・実質月額・キャンペーン徹底比較 - {brand_name}"
    desc  = f"【{esc(primary_kw)}】の決定版。{esc(offer['name'])}を、{cb_phrase}月額{yen(monthly)}・実質月額・データ容量{esc(offer.get('data_cap',''))}の観点から徹底比較。2026年時点の最新情報。"

    # ----- ヒーロー第3カード（特典 or サブ訴求） -----
    if has_cb:
        third_card = f'<div class="hcard"><div class="hcard-l">Campaign</div><div class="hcard-v">最大 {cb:,}<small style="font-size:13px">円</small></div><div class="hcard-n">代理店経由特典</div></div>'
    else:
        speed_v = f"{offer['speed_max_mbps']}" if offer.get('speed_max_mbps') else '高速'
        contract_label = '縛りなし' if offer.get('contract_period_months', 0) == 0 else f"{offer['contract_period_months']}ヶ月"
        if offer.get('speed_max_mbps'):
            third_card = f'<div class="hcard"><div class="hcard-l">Speed</div><div class="hcard-v">{speed_v}<small style="font-size:13px">Mbps</small></div><div class="hcard-n">最大通信速度</div></div>'
        else:
            third_card = f'<div class="hcard"><div class="hcard-l">Contract</div><div class="hcard-v">{contract_label}</div><div class="hcard-n">契約期間</div></div>'

    # ----- ヒーローCB訴求 -----
    hero_cb_html = ''
    if has_cb:
        hero_cb_html = f'<div class="hero-cb"><span class="hero-cb-label">代理店経由特典</span><span class="hero-cb-amount">最大 {cb:,}<small>円</small></span><span class="hero-cb-sub">キャッシュバック</span></div>'

    # ----- スペックリスト -----
    spec_rows = f"""<li><dt>月額料金</dt><dd class="feat-strong">{yen(monthly)}</dd></li>
        <li><dt>初期費用</dt><dd>{yen(initial_fee)}</dd></li>
        <li><dt>契約期間</dt><dd>{'縛りなし' if offer.get('contract_period_months', 0) == 0 else f"{offer['contract_period_months']}ヶ月"}</dd></li>
        <li><dt>データ容量</dt><dd>{esc(offer.get('data_cap', ''))}</dd></li>"""
    if offer.get('speed_max_mbps'):
        spec_rows += f'<li><dt>最大通信速度</dt><dd>下り {offer["speed_max_mbps"]} Mbps</dd></li>'
    spec_rows += f'<li><dt>対応エリア</dt><dd style="font-size:12px">{esc(offer.get("area_coverage", ""))}</dd></li>'

    # ----- キャッシュバック枠 -----
    cb_card_html = ''
    if has_cb:
        cb_card_html = f"""<div class="cb-card">
        <span class="cb-tag">代理店経由特典</span>
        <div><div class="cb-amount">{cb:,}<span style="font-size:24px">円</span><small>最大キャッシュバック</small></div></div>
        <p class="cb-note">※ {esc(offer.get('cashback_condition', '所定の手続きが必要です'))}受取手続きを忘れた場合は無効となるため、申込後の案内メールは保管しておくことをおすすめします。</p>
      </div>"""

    # ----- シミュレーション -----
    sim_html = ''
    if has_cb:
        sim_html = f"""<div class="sim-wrap">
      <p class="sim-label">実質月額シミュレーション（24ヶ月利用前提）</p>
      <div class="sim-rows">
        <div class="sim-row"><span>月額料金 {yen(monthly)} × 24ヶ月</span><strong>{total_24mo:,}円</strong></div>
        <div class="sim-row"><span>初期費用</span><strong>{yen(initial_fee)}</strong></div>
        <div class="sim-row discount"><span>キャッシュバック（代理店経由特典）</span><strong>−{cb:,}円</strong></div>
      </div>
      <div class="sim-final">
        <span class="sim-final-label">実質月額（24ヶ月平均）</span>
        <span class="sim-final-value">{effective_monthly:,}<small>円</small></span>
      </div>
      <p class="sim-disclaimer">※ 2026年時点の代理店特典条件に基づく試算です。条件達成時の目安であり、実際の請求額・キャッシュバック適用額は申込時の最新条件・適用可否によって異なります。最新条件は公式サイトでご確認ください。</p>
    </div>"""

    # ----- price-grid（spec + cb_card or spec single） -----
    if has_cb:
        price_grid = f'<div class="price-grid"><div class="spec-card"><div class="spec-card-head"><p class="spec-name">{esc(offer["name"])}</p><p class="spec-title">{esc(offer.get("subcategory", ""))}</p></div><ul class="spec-list">{spec_rows}</ul></div>{cb_card_html}</div>'
    else:
        price_grid = f'<div class="spec-card" style="max-width:680px;margin:48px auto 0"><div class="spec-card-head"><p class="spec-name">{esc(offer["name"])}</p><p class="spec-title">{esc(offer.get("subcategory", ""))}</p></div><ul class="spec-list">{spec_rows}</ul></div>'

    # ----- 申込ステップ（カテゴリ別最終ステップ） -----
    step3_texts = {
        'home_router': ('端末が届いたら接続', '最短翌日〜数営業日で端末が到着。電源コンセントに挿し、スマホ・PCのWiFi設定を行えば利用開始です。'),
        'pocket_wifi': ('端末が届いたら持ち運び開始', '最短翌日〜数営業日で端末が到着。電源を入れて初回設定を行えば、外出先でも自宅でも利用開始です。'),
        'fiber':       ('開通工事を経て利用開始', '工事日の調整・開通工事を経て、ご自宅まで光回線が引き込まれます。Wi-Fiルーター接続で利用開始です。'),
        'mvno':        ('SIMが届いたら開通手続き', 'SIMカード（またはeSIM）が到着次第、利用機器に挿入・初期設定を行えば開通します。'),
    }
    step3_h, step3_d = step3_texts.get(offer['category'], step3_texts['home_router'])
    steps_section_html = f"""<div class="steps-grid">
      <article class="step"><p class="step-no">Step 01</p><h3>公式サイトで申込</h3><p>本ページのボタンから公式サイトへ移動し、ご利用予定の住所・条件を確認のうえ申込ページに進みます。</p></article>
      <article class="step"><p class="step-no">Step 02</p><h3>必要事項を入力</h3><p>氏名・住所・支払い情報を入力し、申込手続きを完了します。所要時間は約5〜10分の目安です。</p></article>
      <article class="step"><p class="step-no">Step 03</p><h3>{esc(step3_h)}</h3><p>{esc(step3_d)}</p></article>
    </div>"""

    # ----- ユーザーシーンHTML -----
    scenes_html = ''
    for s in scenes:
        scenes_html += f'<article class="scene"><div class="scene-img" style="background-image:url(\'{s[3]}\')"></div><div class="scene-body"><p class="scene-tag">{s[0]}</p><h3>{esc(s[1])}</h3><p>{esc(s[2])}</p></div></article>'

    # ----- キャンペーンセクション -----
    campaign_html = ''
    if has_cb:
        campaign_html = f"""<section class="campaign">
  <div class="container campaign-inner">
    <p class="campaign-kicker">Campaign</p>
    <h2>最大 <span class="amount">{cb:,}円</span> キャッシュバック<br/>{esc(niche['name'])}向けの代理店経由特典。</h2>
    <p class="campaign-lead">2026年時点の代理店独自特典です。受取条件・申請手続きは公式サイトで最新情報をご確認ください。</p>
    {trust_badges_html}
    <a href="#" class="cta-link btn btn-primary">{CTA_MID}</a>
  </div>
</section>"""

    # ===========================================================
    # HTML本体
    # ===========================================================
    html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
<meta name="theme-color" content="#063a7a" />
<meta name="robots" content="noindex, nofollow" />
<title>{title}</title>
<meta name="description" content="{desc}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700;800&family=Noto+Serif+JP:wght@500;600;700&display=swap" rel="stylesheet" />
{ga4_tag}
{clarity_tag}
<style>
:root{{
  --ink:#101827; --ink-soft:#263349; --muted:#68748a;
  --paper:#ffffff; --paper-soft:#f6f8fb; --paper-warm:#fbfaf6;
  --line:#dce3ed; --line-soft:#eef2f7;
  --blue:#0b6fd3; --blue-deep:#063a7a; --blue-darker:#04284f;
  --cyan:#22d3ee; --cyan-soft:#e0f7fa;
  --amber:#f4b740; --amber-soft:#fdf3d5; --amber-deep:#a87208;
  --green:#19a974; --green-soft:#dcfae8; --rose:#d84b5b;
  --radius:8px; --radius-lg:12px;
  --shadow-xs:0 1px 2px rgba(15,30,60,.04);
  --shadow-sm:0 4px 12px rgba(15,30,60,.06);
  --shadow-md:0 8px 24px rgba(15,30,60,.08);
  --shadow-lg:0 20px 50px rgba(15,30,60,.12);
}}
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
html{{scroll-behavior:smooth;-webkit-text-size-adjust:100%}}
body{{font-family:"Noto Sans JP",-apple-system,BlinkMacSystemFont,sans-serif;background:var(--paper);color:var(--ink);font-size:16px;line-height:1.85;letter-spacing:0;-webkit-font-smoothing:antialiased;overflow-x:hidden}}
img{{display:block;max-width:100%;height:auto}}
a{{color:inherit;text-decoration:none;transition:color .2s,opacity .2s}}
.container{{width:100%;max-width:1120px;margin:0 auto;padding:0 24px}}
@media(max-width:639px){{.container{{padding:0 20px}}}}

.top-strip{{background:var(--ink);color:rgba(255,255,255,.78);font-size:11px;letter-spacing:.04em;padding:9px 16px;text-align:center;font-weight:500}}
.top-strip .dot{{display:inline-block;width:4px;height:4px;background:var(--cyan);border-radius:50%;vertical-align:middle;margin-right:8px}}
.top-strip .sep{{opacity:.4;margin:0 14px}}

.site-header{{background:rgba(255,255,255,.96);backdrop-filter:saturate(140%) blur(14px);-webkit-backdrop-filter:saturate(140%) blur(14px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:50}}
.header-inner{{display:flex;align-items:center;justify-content:space-between;height:68px;gap:20px}}
.brand{{display:flex;align-items:center;gap:12px}}
.brand-mark{{width:34px;height:34px;background:var(--blue-deep);color:#fff;border-radius:8px;display:grid;place-items:center;font-family:"Noto Serif JP",serif;font-weight:700;font-size:18px}}
.brand-text{{font-family:"Noto Serif JP",serif;font-weight:600;font-size:15px;color:var(--ink);letter-spacing:.02em}}
.brand-text small{{display:block;font-family:"Noto Sans JP",sans-serif;font-size:9px;color:var(--muted);font-weight:500;letter-spacing:.18em;text-transform:uppercase;margin-top:2px}}
.nav{{display:none;gap:32px}}
.nav a{{font-size:13px;color:var(--ink-soft);font-weight:500;letter-spacing:.02em;position:relative;padding:4px 0}}
.nav a:hover{{color:var(--blue-deep)}}
.nav a::after{{content:"";position:absolute;left:0;right:0;bottom:-2px;height:1px;background:var(--blue-deep);transform:scaleX(0);transition:transform .2s}}
.nav a:hover::after{{transform:scaleX(1)}}
.header-cta{{background:var(--ink);color:#fff;font-size:12px;font-weight:600;padding:11px 20px;border-radius:8px;letter-spacing:.04em;transition:background .2s}}
.header-cta:hover{{background:var(--blue-deep)}}
@media(min-width:900px){{.nav{{display:flex}}}}
@media(max-width:540px){{.brand-text small{{display:none}}.header-cta{{padding:10px 14px;font-size:11px}}}}

.hero{{position:relative;background:var(--ink);color:#fff;overflow:hidden;isolation:isolate}}
.hero-bg{{position:absolute;inset:0;z-index:0;background-image:linear-gradient(105deg,rgba(4,40,79,.92) 0%,rgba(4,40,79,.72) 38%,rgba(4,40,79,.45) 60%,rgba(4,40,79,.30) 100%),url("{hero_bg}");background-size:cover;background-position:center right}}
.hero-bg::after{{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 80% 30%,rgba(34,211,238,.18) 0%,transparent 50%)}}
.hero-inner{{position:relative;z-index:1;padding:88px 0 96px}}
.hero-eyebrow{{display:inline-flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.22em;font-weight:600;text-transform:uppercase;color:var(--cyan);margin-bottom:24px}}
.hero-eyebrow::before{{content:"";display:inline-block;width:28px;height:1px;background:var(--cyan)}}
.hero-h1{{font-family:"Noto Serif JP",serif;font-weight:600;font-size:clamp(28px,5vw,46px);line-height:1.45;letter-spacing:.01em;color:#fff;max-width:680px;margin-bottom:24px}}
.hero-h1 .accent{{color:var(--cyan);font-weight:700;display:inline-block;padding:0 2px}}
.hero-lead{{font-size:clamp(14px,1.4vw,16px);line-height:2;color:rgba(255,255,255,.85);max-width:560px;margin-bottom:28px;font-weight:400}}
.hero-cb{{display:inline-flex;flex-direction:column;align-items:flex-start;background:rgba(255,255,255,.06);backdrop-filter:blur(10px);border:1px solid rgba(244,183,64,.45);border-radius:10px;padding:18px 28px;margin-bottom:32px}}
.hero-cb-label{{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--amber);font-weight:700;margin-bottom:6px}}
.hero-cb-amount{{font-family:"Noto Serif JP",serif;font-size:36px;font-weight:600;color:var(--amber);line-height:1.1;letter-spacing:-.01em}}
.hero-cb-amount small{{font-size:18px;margin-left:3px}}
.hero-cb-sub{{font-size:12px;color:rgba(255,255,255,.78);margin-top:4px}}
.hero-actions{{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:44px}}
.btn{{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:16px 28px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:.04em;transition:transform .15s,background .2s,opacity .2s,border-color .2s}}
.btn-primary{{background:var(--amber);color:var(--ink);box-shadow:0 8px 24px rgba(244,183,64,.28)}}
.btn-primary:hover{{transform:translateY(-1px);background:#f0b53b}}
.btn-ghost{{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}}
.btn-ghost:hover{{border-color:#fff;background:rgba(255,255,255,.06)}}
.btn::after{{content:"→";font-size:15px;font-weight:400;opacity:.9}}
.hero-cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:640px}}
@media(max-width:640px){{.hero-cards{{grid-template-columns:1fr}}}}
.hcard{{background:rgba(255,255,255,.06);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:18px 18px}}
.hcard-l{{font-size:10px;color:var(--cyan);font-weight:600;letter-spacing:.16em;text-transform:uppercase;margin-bottom:6px}}
.hcard-v{{font-family:"Noto Serif JP",serif;font-size:22px;font-weight:600;color:#fff;line-height:1.2;letter-spacing:.01em}}
.hcard-n{{font-size:11px;color:rgba(255,255,255,.65);margin-top:4px;font-weight:400}}

.section{{padding:96px 0}}
@media(max-width:768px){{.section{{padding:64px 0}}}}
.kicker{{display:inline-flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.22em;font-weight:600;text-transform:uppercase;color:var(--blue);margin-bottom:18px}}
.kicker::before{{content:"";display:inline-block;width:28px;height:1px;background:var(--blue)}}
.h-section{{font-family:"Noto Serif JP",serif;font-weight:600;font-size:clamp(22px,3.2vw,32px);line-height:1.55;letter-spacing:.02em;color:var(--ink);max-width:760px}}
.h-section + .lead{{margin-top:18px;color:var(--ink-soft);font-size:15px;line-height:2.05;max-width:700px}}

.conclusion{{background:var(--paper-soft);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}}
.concl-grid{{display:grid;grid-template-columns:1.4fr 1fr;gap:48px;align-items:center}}
@media(max-width:880px){{.concl-grid{{grid-template-columns:1fr;gap:36px}}}}
.concl-score-card{{background:#fff;border:1px solid var(--line);border-radius:12px;padding:36px;box-shadow:var(--shadow-sm)}}
.concl-score-label{{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:14px}}
.concl-score-num{{display:flex;align-items:baseline;gap:8px;margin-bottom:18px}}
.concl-score-num .big{{font-family:"Noto Serif JP",serif;font-size:64px;font-weight:600;color:var(--ink);line-height:1;letter-spacing:-.01em}}
.concl-score-num .small{{font-size:18px;color:var(--muted);font-weight:500}}
.concl-stars{{display:flex;gap:3px;margin-bottom:14px}}
.concl-stars svg{{width:18px;height:18px;fill:var(--amber)}}
.concl-stars svg.half{{fill:url(#half)}}
.concl-meta{{font-size:12px;color:var(--muted);line-height:1.85}}
.concl-meta strong{{color:var(--ink-soft);font-weight:600}}

.feat-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:48px}}
@media(max-width:880px){{.feat-grid{{grid-template-columns:1fr;gap:18px}}}}
.fcard{{background:#fff;border:1px solid var(--line);border-radius:8px;padding:32px 28px;position:relative;transition:transform .2s,box-shadow .2s,border-color .2s}}
.fcard:hover{{transform:translateY(-2px);box-shadow:var(--shadow-md);border-color:var(--line-soft)}}
.fcard-no{{font-family:"Noto Serif JP",serif;font-size:13px;font-weight:600;color:var(--blue);letter-spacing:.08em;margin-bottom:14px}}
.fcard-icon{{width:44px;height:44px;border-radius:8px;background:var(--cyan-soft);color:var(--blue-deep);display:grid;place-items:center;margin-bottom:18px}}
.fcard-icon svg{{width:22px;height:22px;stroke-width:1.6}}
.fcard h3{{font-family:"Noto Serif JP",serif;font-size:18px;font-weight:600;color:var(--ink);margin-bottom:10px;line-height:1.55;letter-spacing:.01em}}
.fcard p{{font-size:13px;line-height:1.95;color:var(--ink-soft)}}

.pricing{{background:var(--paper-warm)}}
.price-grid{{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:48px}}
@media(max-width:900px){{.price-grid{{grid-template-columns:1fr;gap:20px}}}}
.spec-card{{background:#fff;border:1px solid var(--line);border-radius:12px;padding:36px;box-shadow:var(--shadow-sm)}}
.spec-card-head{{padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:24px}}
.spec-name{{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:8px}}
.spec-title{{font-family:"Noto Serif JP",serif;font-size:24px;font-weight:600;color:var(--ink);line-height:1.3}}
.spec-list{{list-style:none}}
.spec-list li{{display:flex;justify-content:space-between;align-items:baseline;padding:14px 0;border-bottom:1px solid var(--line-soft);gap:16px}}
.spec-list li:last-child{{border-bottom:0}}
.spec-list dt{{font-size:13px;color:var(--muted);font-weight:500;flex-shrink:0}}
.spec-list dd{{font-size:14px;color:var(--ink);font-weight:600;text-align:right}}
.spec-list .feat-strong{{color:var(--blue-deep);font-weight:700}}
.cb-card{{background:linear-gradient(135deg,#fef9eb 0%,#fdf3d5 100%);border:1px solid var(--amber);border-radius:12px;padding:32px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:var(--shadow-sm)}}
.cb-tag{{display:inline-block;background:var(--amber);color:var(--amber-deep);font-size:10px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;padding:4px 12px;border-radius:4px;align-self:flex-start;margin-bottom:18px}}
.cb-amount{{font-family:"Noto Serif JP",serif;font-weight:600;font-size:clamp(36px,4vw,46px);line-height:1.1;color:var(--ink);letter-spacing:-.01em}}
.cb-amount small{{display:block;font-size:14px;color:var(--ink-soft);margin-top:6px;font-weight:500;font-family:"Noto Sans JP",sans-serif;letter-spacing:.02em}}
.cb-note{{margin-top:24px;font-size:12px;line-height:1.85;color:var(--ink-soft);padding-top:18px;border-top:1px solid rgba(244,183,64,.5)}}

.sim-wrap{{margin-top:32px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:36px;box-shadow:var(--shadow-sm)}}
.sim-label{{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:18px}}
.sim-rows{{display:grid;gap:0;margin-bottom:24px}}
.sim-row{{display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px dashed var(--line);font-size:14px}}
.sim-row:last-of-type{{border-bottom:0;padding-bottom:0}}
.sim-row span{{color:var(--ink-soft)}}
.sim-row strong{{color:var(--ink);font-weight:600}}
.sim-row.discount strong{{color:var(--green)}}
.sim-final{{background:var(--paper-soft);border-radius:8px;padding:24px 28px;display:flex;justify-content:space-between;align-items:baseline;border-left:4px solid var(--green)}}
.sim-final-label{{font-size:13px;color:var(--ink-soft);font-weight:600}}
.sim-final-value{{font-family:"Noto Serif JP",serif;font-size:36px;font-weight:600;color:var(--ink);line-height:1;letter-spacing:-.01em}}
.sim-final-value small{{font-size:16px;margin-left:4px;font-weight:500}}
.sim-disclaimer{{margin-top:18px;font-size:11px;color:var(--muted);line-height:1.85}}

.steps-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:48px;position:relative}}
@media(max-width:880px){{.steps-grid{{grid-template-columns:1fr;gap:16px}}}}
.step{{background:#fff;border:1px solid var(--line);border-radius:8px;padding:32px 28px;position:relative}}
.step-no{{font-family:"Noto Serif JP",serif;font-size:12px;letter-spacing:.18em;font-weight:600;color:var(--blue);margin-bottom:12px}}
.step-no::after{{content:"";display:block;width:24px;height:1px;background:var(--blue);margin-top:8px}}
.step h3{{font-family:"Noto Serif JP",serif;font-size:17px;font-weight:600;color:var(--ink);margin-bottom:10px;line-height:1.5}}
.step p{{font-size:13px;line-height:1.85;color:var(--ink-soft)}}

.compare-wrap{{margin-top:48px;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow-sm)}}
.compare-scroll{{overflow-x:auto;-webkit-overflow-scrolling:touch}}
.compare-table{{width:100%;min-width:760px;border-collapse:collapse;font-size:13px}}
.compare-table thead{{background:var(--ink-soft)}}
.compare-table th{{padding:18px 16px;text-align:left;color:#fff;font-weight:600;font-size:11px;letter-spacing:.12em;text-transform:uppercase}}
.compare-table td{{padding:22px 16px;border-bottom:1px solid var(--line-soft);vertical-align:top;line-height:1.7}}
.compare-table tbody tr:last-child td{{border-bottom:0}}
.compare-table tbody tr.recommended{{background:var(--paper-warm)}}
.compare-table .svc{{font-family:"Noto Serif JP",serif;font-size:15px;font-weight:600;color:var(--ink);margin-bottom:4px}}
.compare-table .svc-badge{{display:inline-block;background:var(--blue-deep);color:#fff;font-size:9px;padding:2px 8px;border-radius:4px;letter-spacing:.1em;margin-left:6px;vertical-align:1px;font-weight:600}}
.compare-table .price{{font-family:"Noto Serif JP",serif;font-size:16px;color:var(--ink);font-weight:600}}
.compare-table .cb{{color:var(--amber-deep);font-weight:600}}
.compare-table .fit{{font-size:12px;color:var(--ink-soft);line-height:1.7}}
.compare-note{{padding:16px 24px;background:var(--paper-soft);font-size:11px;color:var(--muted);line-height:1.85;border-top:1px solid var(--line)}}

.scenes-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:48px}}
@media(max-width:880px){{.scenes-grid{{grid-template-columns:1fr;gap:18px}}}}
.scene{{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;transition:transform .2s,box-shadow .2s;display:flex;flex-direction:column}}
.scene:hover{{transform:translateY(-2px);box-shadow:var(--shadow-md)}}
.scene-img{{aspect-ratio:5/3;background:var(--paper-soft) center/cover;border-bottom:1px solid var(--line);position:relative}}
.scene-img::after{{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 60%,rgba(16,24,39,.04) 100%)}}
.scene-body{{padding:24px 22px}}
.scene-tag{{font-size:10px;letter-spacing:.18em;font-weight:600;color:var(--blue);text-transform:uppercase;margin-bottom:10px}}
.scene h3{{font-family:"Noto Serif JP",serif;font-size:16px;font-weight:600;color:var(--ink);margin-bottom:8px;line-height:1.55}}
.scene p{{font-size:12px;line-height:1.85;color:var(--ink-soft)}}

.campaign{{background:linear-gradient(120deg,var(--blue-darker) 0%,var(--blue-deep) 60%,var(--blue) 100%);color:#fff;padding:80px 0;text-align:center;position:relative;overflow:hidden}}
.campaign::before{{content:"";position:absolute;top:-50%;right:-10%;width:60%;height:200%;background:radial-gradient(circle,rgba(34,211,238,.16) 0%,transparent 60%)}}
.campaign-inner{{position:relative;z-index:1}}
.campaign-kicker{{display:inline-flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--cyan);font-weight:600;margin-bottom:18px}}
.campaign-kicker::before{{content:"";display:inline-block;width:28px;height:1px;background:var(--cyan)}}
.campaign h2{{font-family:"Noto Serif JP",serif;font-size:clamp(24px,3.4vw,36px);font-weight:600;line-height:1.5;margin-bottom:20px;letter-spacing:.01em}}
.campaign h2 .amount{{color:var(--amber);font-weight:700}}
.campaign-lead{{font-size:14px;color:rgba(255,255,255,.78);max-width:560px;margin:0 auto 32px;line-height:2}}

.faq-list{{margin-top:48px;display:grid;gap:12px;max-width:840px}}
.faq{{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;transition:border-color .2s,box-shadow .2s}}
.faq[open]{{border-color:var(--blue);box-shadow:var(--shadow-sm)}}
.faq summary{{padding:22px 28px;font-family:"Noto Serif JP",serif;font-size:15px;font-weight:600;color:var(--ink);cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px;letter-spacing:.01em}}
.faq summary::-webkit-details-marker{{display:none}}
.faq summary::after{{content:"+";font-size:22px;font-weight:400;color:var(--blue);flex-shrink:0;transition:transform .2s;line-height:1}}
.faq[open] summary::after{{transform:rotate(45deg)}}
.faq-body{{padding:0 28px 24px;font-size:13px;line-height:2;color:var(--ink-soft)}}

.final-cta{{background:var(--paper-soft);padding:96px 0;text-align:center;border-top:1px solid var(--line)}}
.final-cta .kicker{{justify-content:center;color:var(--blue-deep)}}
.final-cta .kicker::before{{background:var(--blue-deep)}}
.final-cta h2{{font-family:"Noto Serif JP",serif;font-size:clamp(22px,3vw,32px);font-weight:600;line-height:1.55;color:var(--ink);max-width:660px;margin:0 auto 22px;letter-spacing:.02em}}
.final-cta p{{font-size:13px;color:var(--ink-soft);max-width:520px;margin:0 auto 36px;line-height:2}}
.final-cta .btn{{padding:18px 36px;font-size:15px}}
.final-note{{margin-top:18px;font-size:11px;color:var(--muted)}}

.trust-badges{{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:16px auto 20px;max-width:640px}}
.tbadge{{font-size:11px;font-weight:600;color:var(--green);background:var(--green-soft);border:1px solid rgba(25,169,116,.25);border-radius:100px;padding:5px 12px;letter-spacing:.02em;white-space:nowrap}}
@media(max-width:540px){{.tbadge{{font-size:10px;padding:4px 10px}}}}

.sticky-cta{{position:fixed;left:0;right:0;bottom:0;background:rgba(255,255,255,.97);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);padding:12px 16px;z-index:60;box-shadow:0 -8px 20px rgba(15,30,60,.08)}}
.sticky-cta .btn{{width:100%;padding:14px;font-size:13px}}
@media(min-width:768px){{.sticky-cta{{display:none}}}}
@media(max-width:767px){{body{{padding-bottom:80px}}}}

.site-footer{{background:var(--ink);color:rgba(255,255,255,.66);padding:56px 0 28px;font-size:12px;line-height:2}}
.footer-inner{{display:grid;gap:32px;grid-template-columns:1.4fr 1fr}}
@media(max-width:760px){{.footer-inner{{grid-template-columns:1fr;gap:28px}}}}
.footer-brand{{display:flex;align-items:center;gap:12px;margin-bottom:18px}}
.footer-brand .brand-mark{{background:#fff;color:var(--blue-deep)}}
.footer-brand .brand-text{{color:#fff}}
.footer-brand .brand-text small{{color:rgba(255,255,255,.55)}}
.footer-disclaimer h4{{font-family:"Noto Serif JP",serif;color:#fff;font-size:13px;font-weight:600;margin-bottom:14px;letter-spacing:.04em}}
.footer-disclaimer p{{margin-bottom:10px;font-size:11px;line-height:1.95;color:rgba(255,255,255,.55)}}
.footer-links{{display:grid;gap:8px;font-size:12px}}
.footer-links a{{color:rgba(255,255,255,.66)}}
.footer-links a:hover{{color:#fff}}
.footer-bottom{{margin-top:40px;padding-top:24px;border-top:1px solid rgba(255,255,255,.1);font-size:10px;text-align:center;color:rgba(255,255,255,.4)}}

@media(prefers-reduced-motion:reduce){{*{{animation:none!important;transition:none!important}}html{{scroll-behavior:auto}}}}
</style>
</head>
<body>

<div class="top-strip"><span><span class="dot"></span>{datetime.now().strftime("%Y年%-m月")} 更新</span><span class="sep">/</span><span>{esc(niche['name'])}特集</span></div>

<header class="site-header">
  <div class="container header-inner">
    <a href="#" class="brand"><span class="brand-mark">{brand_initial}</span><span class="brand-text">{brand_name}<small>Editorial Comparison Media</small></span></a>
    <nav class="nav"><a href="#features">特徴</a><a href="#pricing">料金</a><a href="#compare">比較</a></nav>
    <a href="#" class="cta-link header-cta">公式で申し込む</a>
  </div>
</header>

<section class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="container hero-inner">
    <p class="hero-eyebrow">{hero_eyebrow}</p>
    <h1 class="hero-h1">{hook_pre}<br/><span class="accent">{esc(offer['name'])}</span><br/>{hook_post}</h1>
    <p class="hero-lead">{esc(niche['persona'])}</p>
    {hero_cb_html}
    <div class="hero-actions">
      <a href="#" class="cta-link btn btn-primary">{CTA_HERO}</a>
      <a href="#pricing" class="btn btn-ghost">料金を見る</a>
    </div>
    {trust_badges_html}
    <div class="hero-cards">
      <div class="hcard"><div class="hcard-l">Monthly</div><div class="hcard-v">{monthly:,}<small style="font-size:13px">円</small></div><div class="hcard-n">月額料金</div></div>
      <div class="hcard"><div class="hcard-l">Data</div><div class="hcard-v">{esc(offer.get('data_cap', '─'))}</div><div class="hcard-n">データ容量</div></div>
      {third_card}
    </div>
  </div>
</section>

<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="half" x1="0" x2="1" y1="0" y2="0"><stop offset="50%" stop-color="#f4b740"/><stop offset="50%" stop-color="#dce3ed"/></linearGradient></defs></svg>

<section class="section conclusion">
  <div class="container">
    <p class="kicker">結論</p>
    <h2 class="h-section">【{esc(primary_kw)}】なら、<br/>最初に比較したい候補です。</h2>
    <p class="lead">{esc(niche['primary_appeal'])}を重視する方に向いた選択肢です。本ページでは料金・実質負担・条件・他社比較を整理しています。</p>
    <div class="concl-grid" style="margin-top:48px">
      <div>
        <p style="font-size:13px;color:var(--ink-soft);line-height:2;margin-bottom:18px">
          {esc(niche['persona'])}
          {esc(conclusion_body)}
        </p>
        <p style="font-size:13px;color:var(--ink-soft);line-height:2">
          一方で、エリア・建物・利用状況によって体感は変動します。本ページでは特典を踏まえた実質月額シミュレーション、同カテゴリ他社との比較、向き不向きの整理まで一通り確認できるようにしています。
        </p>
      </div>
      <div class="concl-score-card">
        <p class="concl-score-label">Editorial Score</p>
        <div class="concl-score-num"><span class="big">{score_str}</span><span class="small">/ 5.0</span></div>
        <div class="concl-stars" aria-label="評価 {score_str} / 5.0">{stars_html}</div>
        <p class="concl-meta">{score_breakdown}<br/>※ 当ページ独自の評価。提供条件・満足度を保証するものではありません。</p>
      </div>
    </div>
  </div>
</section>

<section id="features" class="section">
  <div class="container">
    <p class="kicker">Why It Works</p>
    <h2 class="h-section">【{esc(primary_kw)}】に選ばれる<br/>3つの理由。</h2>
    <p class="lead">{esc(niche['primary_appeal'])}を実現するための、3つのポイントを整理しました。</p>
    <div class="feat-grid">{feat_html}</div>
  </div>
</section>

<section id="pricing" class="section pricing">
  <div class="container">
    <p class="kicker">Price Simulation</p>
    <h2 class="h-section">料金は、月額だけでなく<br/>実質負担で見る。</h2>
    <p class="lead">表示の月額料金と、特典適用後の実質月額には差が出ます。本ページでは2026年時点の条件を元に、24ヶ月利用前提でシミュレーションしています。</p>
    {price_grid}
    {sim_html}
    <div style="margin-top:32px;text-align:center">
      {trust_badges_html}
      <a href="#" class="cta-link btn btn-primary">{CTA_MID}</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <p class="kicker">Start Flow</p>
    <h2 class="h-section">申し込みから利用開始まで。</h2>
    <p class="lead">オンライン完結。申込後の流れを3ステップで整理しています。</p>
    {steps_section_html}
  </div>
</section>

<section id="compare" class="section" style="background:var(--paper-soft);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="container">
    <p class="kicker">Comparison</p>
    <h2 class="h-section">同カテゴリの主要サービスと比較。</h2>
    <p class="lead">月額・データ容量・キャンペーン・向き不向きの観点で、同カテゴリ主要サービスを並べています。</p>
    <div class="compare-wrap">
      <div class="compare-scroll">
        <table class="compare-table">
          <thead><tr><th>サービス</th><th>月額</th><th>データ容量</th><th>キャンペーン</th><th>こんな人に</th></tr></thead>
          <tbody>{compare_rows}</tbody>
        </table>
      </div>
      <p class="compare-note">※ 2026年時点の各社公式情報・代理店特典を整理して作成。最新条件・適用可否は各公式サイトでご確認ください。</p>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <p class="kicker">User Scene</p>
    <h2 class="h-section">こんな生活シーンに合います。</h2>
    <p class="lead">{esc(offer['name'])}の特徴は、こんな状況の方に向いています。</p>
    <div class="scenes-grid">{scenes_html}</div>
  </div>
</section>

{campaign_html}

<section class="section">
  <div class="container">
    <p class="kicker">FAQ</p>
    <h2 class="h-section">申し込み前のよくある質問。</h2>
    <div class="faq-list">{faq_html}</div>
  </div>
</section>

<section class="final-cta">
  <div class="container">
    <p class="kicker">Final Check</p>
    <h2>迷ったら、まず公式サイトで<br/>料金・条件を確認してください。</h2>
    <p>料金・キャンペーン内容・適用条件・対応エリアは公式サイトで最新情報をご確認ください。<br/>申込手続きはオンラインで完結、最短5〜10分で完了します。</p>
    {trust_badges_html}
    <a href="#" class="cta-link btn btn-primary">{CTA_FINAL}</a>
    <p class="final-note">※ 申込・解約・サポートに関するお問い合わせは公式サイトをご参照ください。当サイトはアフィリエイトリンクを含みます。</p>
  </div>
</section>

<div class="sticky-cta">
  <a href="#" class="cta-link btn btn-primary">{CTA_STICKY}</a>
</div>

<footer class="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div>
        <div class="footer-brand"><span class="brand-mark">{brand_initial}</span><span class="brand-text">{brand_name}<small>Editorial Comparison Media</small></span></div>
        <div class="footer-disclaimer">
          <h4>表記に関する注意事項</h4>
          <p>本ページの情報は{datetime.now().strftime("%Y年%-m月")}時点のものです。料金・キャンペーン内容・適用条件・対応エリアは予告なく変更される場合があります。最新の情報は公式サイトでご確認ください。</p>
          <p>※ 掲載のキャッシュバックは代理店経由の特典であり、適用には所定の条件・手続きが必要です。受取手続きを忘れた場合は無効となります。</p>
          <p>※ 通信品質・速度・満足度を保証するものではありません。建物・エリア・時間帯により実測値は変動します。</p>
          <p>※「実質月額シミュレーション」は条件達成時の試算であり、実際の請求額・キャッシュバック適用額とは異なる場合があります。</p>
          <p>※ 本サイトは {esc(offer['name'])} のアフィリエイトプログラムを通じて、商品情報・申込導線を提供しています。お申込み・解約に関するお問い合わせは公式サイトへお願いいたします。</p>
        </div>
      </div>
      <div>
        <h4 style="font-family:'Noto Serif JP',serif;color:#fff;font-size:13px;font-weight:600;margin-bottom:14px;letter-spacing:.04em">サイト情報</h4>
        <div class="footer-links">
          <a href="/affiliate/privacy.html">プライバシーポリシー</a>
          <a href="/affiliate/legal.html">運営者情報・特商法表記</a>
          <a href="/affiliate/">通信比較ナビ トップ</a>
        </div>
      </div>
    </div>
    <div class="footer-bottom">© {datetime.now().year} {brand_name} / 通信比較ナビ. All rights reserved.</div>
  </div>
</footer>

{param_carry_js}

</body>
</html>"""
    return html




# ============================================================
# 管理用インデックスページ生成
# ============================================================
def gen_index(generated_lps):
    """全LPの一覧を表示する管理ページ（noindex）。広告誘導用ではなく内部管理用。"""
    rows = []
    for niche_id, items in sorted(generated_lps.items()):
        niche = NICHES[niche_id]
        for offer_id, slug in items:
            offer = OFFERS[offer_id]
            rows.append(f"""<tr>
              <td><span class="ntag">{esc(niche['name'])}</span></td>
              <td><strong>{esc(offer['name'])}</strong><br><small>{esc(offer['category'])}</small></td>
              <td>{yen(offer['reward_jpy'])}</td>
              <td>{esc(offer['asp'])}</td>
              <td><a href="/a/{slug}" target="_blank" class="pv">プレビュー →</a></td>
            </tr>""")

    niche_summary = []
    for niche_id, items in sorted(generated_lps.items()):
        niche = NICHES[niche_id]
        niche_summary.append(f"""<div class="ncard">
          <h3>{esc(niche['name'])}</h3>
          <p class="np">{esc(niche['persona'])}</p>
          <div class="nkw">{' / '.join(esc(k) for k in niche['search_keywords'][:3])}</div>
          <div class="ncnt">{len(items)}本のLP</div>
        </div>""")

    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>アフィリLP管理 - 通信ジャンル</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;background:#f6f7fb;color:#1a1d28;font-size:14px;line-height:1.7;padding:24px}}
.wrap{{max-width:1200px;margin:0 auto}}
h1{{font-size:24px;font-weight:900;margin-bottom:4px}}
.sub{{color:#6a7180;font-size:13px;margin-bottom:30px}}
h2{{font-size:18px;font-weight:900;margin:30px 0 14px;padding-bottom:8px;border-bottom:2px solid #1a1d28}}
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:30px}}
.stat{{background:#fff;padding:18px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.05)}}
.stat-l{{font-size:11px;color:#6a7180;font-weight:700;letter-spacing:.05em}}
.stat-v{{font-size:28px;font-weight:900;color:#1a1d28;margin-top:4px}}
.ngrid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:30px}}
.ncard{{background:#fff;padding:18px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.05);border-left:4px solid #0066cc}}
.ncard h3{{font-size:15px;font-weight:900;margin-bottom:8px}}
.np{{font-size:12px;color:#6a7180;line-height:1.6;margin-bottom:10px}}
.nkw{{font-size:11px;color:#0066cc;font-weight:700;margin-bottom:8px}}
.ncnt{{font-size:11px;color:#888;font-weight:700}}
table{{width:100%;background:#fff;border-radius:10px;border-collapse:collapse;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05)}}
th{{background:#1a1d28;color:#fff;padding:12px 14px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.05em}}
td{{padding:14px;border-bottom:1px solid #eef0f4;font-size:13px}}
td small{{color:#6a7180;font-size:11px}}
.ntag{{display:inline-block;background:#eff5ff;color:#0066cc;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700}}
.pv{{color:#0066cc;font-weight:700;font-size:12px}}
.pv:hover{{text-decoration:underline}}
.legend{{background:#fff7e6;border-left:4px solid #ff7a00;padding:14px;border-radius:8px;font-size:12px;margin-bottom:24px;line-height:1.8}}
</style>
</head>
<body>
<div class="wrap">
  <h1>通信アフィリLP 管理ダッシュボード</h1>
  <p class="sub">最終更新: {datetime.now().strftime("%Y-%m-%d %H:%M")} / 内部管理用ページ（noindex）</p>

  <div class="legend">
    <strong>📌 公開URL形式：</strong> <code>https://your-domain.vercel.app/a/{{niche_id}}-{{offer_id}}</code><br>
    広告誘導先として使用。各LPは noindex 設定済み（SEO流入なし、広告流入のみ）。
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-l">総LP数</div><div class="stat-v">{sum(len(v) for v in generated_lps.values())}</div></div>
    <div class="stat"><div class="stat-l">ニッチ数</div><div class="stat-v">{len(generated_lps)}</div></div>
    <div class="stat"><div class="stat-l">案件数</div><div class="stat-v">{len(OFFERS)}</div></div>
    <div class="stat"><div class="stat-l">平均報酬</div><div class="stat-v">{sum(o['reward_jpy'] for o in OFFERS.values())//len(OFFERS):,}円</div></div>
  </div>

  <h2>ニッチ別カバレッジ</h2>
  <div class="ngrid">{"".join(niche_summary)}</div>

  <h2>全LP一覧</h2>
  <table>
    <thead><tr><th>ニッチ</th><th>案件</th><th>報酬</th><th>ASP</th><th>プレビュー</th></tr></thead>
    <tbody>{"".join(rows)}</tbody>
  </table>
</div>
</body>
</html>"""


# ============================================================
# 静的オーバーライドスラグ（手作り版 - 自動生成で上書きしない）
# ============================================================
STATIC_OVERRIDE_SLUGS = set()  # 必要な時に手作りスラグをここに追加


# ============================================================
# 生成ループ
# ============================================================
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    count = 0
    skipped = 0
    overridden = 0
    generated = {}  # niche_id -> [(offer_id, slug)]
    for niche in NICHES.values():
        generated[niche["id"]] = []
        for offer_id in niche["preferred_offers"]:
            offer = OFFERS.get(offer_id)
            if not offer:
                print(f"  ⚠️  offer not found: {offer_id} (niche: {niche['id']})")
                skipped += 1
                continue
            # active: false の案件はスキップ（リンク未設定・掲載停止）
            if offer.get("active") is False:
                print(f"  ⏭  {offer_id} (inactive - skipped)")
                skipped += 1
                continue
            slug = f"{niche['id']}-{offer_id}"

            # 静的オーバーライドがある場合はスキップ（手作りLPを保護）
            if slug in STATIC_OVERRIDE_SLUGS:
                print(f"  ⏩ {slug}.html (static override - skipped)")
                generated[niche["id"]].append((offer_id, slug))
                overridden += 1
                continue

            html = gen_lp(niche, offer)
            filename = f"{slug}.html"
            with open(f"{OUT_DIR}/{filename}", "w", encoding="utf-8") as f:
                f.write(html)
            generated[niche["id"]].append((offer_id, slug))
            count += 1
            print(f"  ✓ {filename}")

    # 管理インデックス生成
    with open(f"{OUT_DIR}/index.html", "w", encoding="utf-8") as f:
        f.write(gen_index(generated))
    print(f"  ✓ index.html (管理ダッシュボード)")

    print(f"\n✅ 生成完了: {count} 本のLP")
    if overridden:
        print(f"   静的オーバーライド保護: {overridden} 件")
    if skipped:
        print(f"   スキップ: {skipped} 件")
    print(f"   出力先: {OUT_DIR}")
    print(f"   管理ページ: /affiliate/lp/index.html")


if __name__ == "__main__":
    main()
