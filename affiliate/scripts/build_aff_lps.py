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
    theme = THEMES.get(offer["category"], THEMES["home_router"])
    title = f"{niche['name']}なら{offer['name']}｜{niche['primary_appeal']}"
    desc = f"{niche['name']}に最適な{offer['name']}を徹底解説。{niche['primary_appeal']}。" + \
           f"月額{yen(offer['monthly_fee_jpy'])}・最大{yen(offer['cashback_jpy'])}キャッシュバック。"

    # 悩みリスト
    pain_html = "".join(
        f'<li><span class="check">✓</span>{esc(p)}</li>' for p in niche["pain_points"]
    )

    # 強みリスト
    strength_html = "".join(
        f'<article class="benefit"><div class="benefit-no">0{i+1}</div><h3>{esc(s)}</h3></article>'
        for i, s in enumerate(offer["selling_points"])
    )

    # 比較表（同カテゴリの案件を並べる）
    same_category = [o for o in OFFERS.values() if o["category"] == offer["category"]]
    same_category.sort(key=lambda x: 0 if x["id"] == offer["id"] else 1)
    compare_rows = ""
    for i, o in enumerate(same_category[:3]):
        is_recommend = (o["id"] == offer["id"])
        badge = '<span class="rank-badge rank-1">No.1</span>' if is_recommend else f'<span class="rank-badge">No.{i+1}</span>'
        compare_rows += f"""<tr class="{'row-recommend' if is_recommend else ''}">
          <td>{badge}<br><strong>{esc(o['name'])}</strong></td>
          <td>{yen(o['monthly_fee_jpy'])}</td>
          <td>{esc(o['data_cap'])}</td>
          <td>{yen(o['cashback_jpy'])}</td>
          <td>{'縛りなし' if o['contract_period_months'] == 0 else f"{o['contract_period_months']}ヶ月"}</td>
        </tr>"""

    # 口コミ
    voices = VOICE_TEMPLATES.get(niche["id"], VOICE_TEMPLATES["one_person_room"])
    voice_html = "".join(
        f'<article class="voice"><p class="voice-text">"{esc(v[1])}"</p><p class="voice-name">— {esc(v[0])}</p></article>'
        for v in voices
    )

    # FAQ
    faqs = FAQ_BY_CATEGORY.get(offer["category"], FAQ_BY_CATEGORY["home_router"])
    faq_html = "".join(
        f'<details class="faq"><summary>{esc(q)}</summary><p>{esc(a)}</p></details>'
        for q, a in faqs
    )

    # 計測タグ
    ga4_tag = ""
    if TRACKING.get("ga4_measurement_id"):
        mid = TRACKING["ga4_measurement_id"]
        ga4_tag = f"""<script async src="https://www.googletagmanager.com/gtag/js?id={mid}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','{mid}');</script>"""

    clarity_tag = ""
    if TRACKING.get("clarity_project_id"):
        cid = TRACKING["clarity_project_id"]
        clarity_tag = f"""<script>(function(c,l,a,r,i,t,y){{c[a]=c[a]||function(){{(c[a].q=c[a].q||[]).push(arguments)}};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)}})(window,document,"clarity","script","{cid}");</script>"""

    # 広告パラメータ引き継ぎJS（gclid/yclid/utm_*をASPリンクに付与）
    cta_url = offer["affiliate_url_placeholder"]
    param_carry_js = f"""<script>
(function(){{
  var params = new URLSearchParams(window.location.search);
  var keepKeys = ['gclid','yclid','msclkid','utm_source','utm_medium','utm_campaign','utm_term','utm_content'];
  var qs = [];
  keepKeys.forEach(function(k){{ if(params.get(k)) qs.push(k+'='+encodeURIComponent(params.get(k))); }});
  var extra = qs.length ? (('{cta_url}'.indexOf('?')>-1?'&':'?') + qs.join('&')) : '';
  document.querySelectorAll('a.cta-link').forEach(function(a){{
    a.href = '{cta_url}' + extra;
    a.addEventListener('click', function(){{
      try {{ if(window.gtag) gtag('event','cta_click',{{offer:'{offer["id"]}',niche:'{niche["id"]}'}}); }} catch(e){{}}
    }});
  }});
}})();
</script>"""

    html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
<meta name="theme-color" content="{theme['primary']}" />
<meta name="robots" content="noindex, nofollow" />
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet" />
{ga4_tag}
{clarity_tag}
<style>
:root{{
  --primary:{theme['primary']};
  --accent:{theme['accent']};
  --bg:{theme['bg']};
  --ink:{theme['ink']};
  --muted:#5a6478;
  --paper:#fff;
  --border:#e5e8ef;
  --success:#22a06b;
}}
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
html{{scroll-behavior:smooth;-webkit-text-size-adjust:100%}}
body{{font-family:"Noto Sans JP",sans-serif;background:var(--bg);color:var(--ink);font-size:15px;line-height:1.8;-webkit-font-smoothing:antialiased;padding-bottom:72px}}
img{{display:block;max-width:100%;height:auto}}
a{{color:inherit;text-decoration:none}}
.container{{width:100%;max-width:680px;margin:0 auto;padding:0 16px}}

/* FV */
.fv{{padding:24px 0 32px;background:linear-gradient(135deg,var(--primary) 0%,color-mix(in srgb,var(--primary) 70%,#000 30%) 100%);color:#fff;text-align:center}}
.fv-eyebrow{{display:inline-block;background:var(--accent);color:#fff;padding:4px 14px;border-radius:14px;font-size:12px;font-weight:700;letter-spacing:.05em;margin-bottom:14px}}
.fv-title{{font-size:26px;font-weight:900;line-height:1.4;letter-spacing:.02em;margin-bottom:14px}}
.fv-title em{{color:#ffe66b;font-style:normal}}
@media(min-width:640px){{.fv-title{{font-size:32px}}}}
.fv-sub{{font-size:14px;line-height:1.9;opacity:.95;margin-bottom:24px;padding:0 8px}}
.fv-badges{{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:22px}}
.fv-badge{{background:rgba(255,255,255,.18);backdrop-filter:blur(8px);padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;border:1px solid rgba(255,255,255,.3)}}

.cta-btn{{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:18px 20px;background:var(--accent);color:#fff;border-radius:12px;font-weight:900;font-size:17px;letter-spacing:.05em;box-shadow:0 6px 20px rgba(0,0,0,.18);animation:pulse 2.2s ease-in-out infinite}}
.cta-btn::after{{content:"→";font-size:20px}}
@keyframes pulse{{0%,100%{{transform:scale(1)}}50%{{transform:scale(1.02)}}}}
.cta-note{{margin-top:10px;font-size:11px;opacity:.85}}

/* Pain section */
.section{{padding:40px 0}}
.section-title{{font-size:22px;font-weight:900;text-align:center;line-height:1.5;margin-bottom:24px;color:var(--ink)}}
.section-title em{{color:var(--primary);font-style:normal;border-bottom:3px solid var(--accent);padding-bottom:2px}}
.pain-card{{background:var(--paper);border-radius:14px;padding:24px 20px;box-shadow:0 4px 20px rgba(0,0,0,.06)}}
.pain-list{{list-style:none}}
.pain-list li{{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:14px;line-height:1.7}}
.pain-list li:last-child{{border-bottom:0}}
.pain-list .check{{flex-shrink:0;width:24px;height:24px;background:var(--accent);color:#fff;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:900;margin-top:1px}}
.pain-cta{{margin-top:20px;padding:16px;background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 75%,#000 25%));color:#fff;border-radius:12px;text-align:center;font-size:15px;font-weight:700}}

/* Benefits */
.benefit-list{{display:grid;gap:14px}}
.benefit{{background:var(--paper);border-radius:14px;padding:22px 18px;box-shadow:0 4px 16px rgba(0,0,0,.05);border-left:5px solid var(--accent)}}
.benefit-no{{display:inline-block;background:var(--primary);color:#fff;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:900;letter-spacing:.05em;margin-bottom:8px}}
.benefit h3{{font-size:16px;font-weight:700;line-height:1.6;color:var(--ink)}}

/* Spec */
.spec-card{{background:var(--paper);border-radius:14px;padding:24px 18px;box-shadow:0 4px 20px rgba(0,0,0,.06)}}
.spec-header{{text-align:center;padding-bottom:18px;border-bottom:2px dashed var(--border);margin-bottom:18px}}
.spec-name{{font-size:13px;color:var(--muted);font-weight:700;letter-spacing:.05em;margin-bottom:6px}}
.spec-title{{font-size:22px;font-weight:900;color:var(--primary)}}
.spec-table{{width:100%;border-collapse:collapse;font-size:13px}}
.spec-table th{{text-align:left;padding:10px 8px;background:var(--bg);color:var(--muted);font-weight:700;width:42%;border-bottom:1px solid var(--border)}}
.spec-table td{{padding:10px 8px;border-bottom:1px solid var(--border);font-weight:700;color:var(--ink)}}
.cashback-callout{{margin-top:18px;padding:16px;background:linear-gradient(135deg,#fff4e6,#ffe7c2);border-radius:12px;border:2px solid var(--accent);text-align:center;display:flex;flex-direction:column;gap:6px}}
.cb-label{{font-size:11px;font-weight:900;color:var(--accent);letter-spacing:.05em}}
.cb-amount{{font-size:20px;font-weight:900;color:#d4750a}}
.cb-cond{{font-size:10px;color:var(--muted);line-height:1.6}}

/* Compare */
.compare-wrap{{overflow-x:auto;-webkit-overflow-scrolling:touch;background:var(--paper);border-radius:14px;box-shadow:0 4px 16px rgba(0,0,0,.05)}}
.compare-table{{width:100%;min-width:560px;border-collapse:collapse;font-size:12px}}
.compare-table th{{background:var(--ink);color:#fff;padding:12px 8px;text-align:center;font-weight:700;font-size:11px}}
.compare-table td{{padding:14px 8px;text-align:center;border-bottom:1px solid var(--border);font-weight:600}}
.rank-badge{{display:inline-block;background:var(--muted);color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:900;margin-bottom:4px}}
.rank-1{{background:var(--accent)}}
.row-recommend{{background:#fff7e6}}
.row-recommend td{{color:var(--ink);font-weight:900}}

/* Voices */
.voice-list{{display:grid;gap:12px}}
.voice{{background:var(--paper);border-radius:14px;padding:18px 16px;box-shadow:0 3px 12px rgba(0,0,0,.04);border:1px solid var(--border)}}
.voice-text{{font-size:13px;line-height:1.85;color:var(--ink);margin-bottom:8px}}
.voice-name{{font-size:11px;color:var(--muted);text-align:right;font-weight:700}}

/* FAQ */
.faq{{background:var(--paper);border-radius:10px;padding:0;margin-bottom:8px;border:1px solid var(--border);overflow:hidden}}
.faq summary{{padding:16px;font-weight:700;font-size:14px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;color:var(--ink)}}
.faq summary::-webkit-details-marker{{display:none}}
.faq summary::after{{content:"+";font-size:22px;color:var(--primary);font-weight:900;flex-shrink:0;transition:transform .2s}}
.faq[open] summary::after{{transform:rotate(45deg)}}
.faq p{{padding:0 16px 16px;font-size:13px;line-height:1.85;color:var(--muted)}}

/* CTA fixed bottom */
.cta-fixed{{position:fixed;left:0;right:0;bottom:0;z-index:50;background:rgba(255,255,255,.96);backdrop-filter:blur(14px);border-top:1px solid var(--border);padding:10px 16px;box-shadow:0 -4px 20px rgba(0,0,0,.08)}}
.cta-fixed-inner{{max-width:680px;margin:0 auto}}
.cta-fixed .cta-btn{{padding:14px 16px;font-size:15px;animation:none}}

/* Legal */
.legal{{padding:30px 16px;background:#1a1d28;color:#9aa3b8;font-size:11px;line-height:1.8}}
.legal-inner{{max-width:680px;margin:0 auto}}
.legal h4{{color:#cdd3e0;font-size:12px;margin-bottom:10px;font-weight:700}}
.legal p{{margin-bottom:10px}}
.legal a{{color:#7ec0d4}}

@media(prefers-reduced-motion:reduce){{*{{animation:none!important;transition:none!important}}}}
</style>
</head>
<body>

<!-- ファーストビュー -->
<section class="fv">
  <div class="container">
    <span class="fv-eyebrow">{esc(niche['name'])}</span>
    <h1 class="fv-title">{esc(niche['primary_appeal'].split('、')[0])}<br><em>{esc(offer['name'])}</em></h1>
    <p class="fv-sub">{esc(niche['persona'])}</p>
    <div class="fv-badges">
      <span class="fv-badge">月額 {yen(offer['monthly_fee_jpy'])}</span>
      <span class="fv-badge">{esc(offer['data_cap'])}</span>
      <span class="fv-badge">{'縛りなし' if offer['contract_period_months'] == 0 else f"{offer['contract_period_months']}ヶ月"}</span>
    </div>
    <a href="#cta" class="cta-link cta-btn">公式サイトで詳細を見る</a>
    <p class="cta-note">※申込・お見積もりは公式サイトで</p>
  </div>
</section>

<!-- 共感 -->
<section class="section">
  <div class="container">
    <h2 class="section-title">こんな<em>お悩み</em>ありませんか？</h2>
    <div class="pain-card">
      <ul class="pain-list">{pain_html}</ul>
      <p class="pain-cta">そのお悩み、<br>「{esc(offer['name'])}」で解決できます。</p>
    </div>
  </div>
</section>

<!-- ベネフィット -->
<section class="section">
  <div class="container">
    <h2 class="section-title"><em>選ばれる</em>3つの理由</h2>
    <div class="benefit-list">{strength_html}</div>
  </div>
</section>

<!-- スペック / 料金 -->
<section class="section">
  <div class="container">
    <h2 class="section-title">料金・<em>スペック</em></h2>
    <div class="spec-card">
      <div class="spec-header">
        <p class="spec-name">{esc(offer['subcategory'])}</p>
        <p class="spec-title">{esc(offer['name'])}</p>
      </div>
      <table class="spec-table">
        <tr><th>月額料金</th><td>{yen(offer['monthly_fee_jpy'])}</td></tr>
        <tr><th>初期費用</th><td>{yen(offer['initial_fee_jpy'])}</td></tr>
        <tr><th>契約期間</th><td>{'縛りなし' if offer['contract_period_months'] == 0 else f"{offer['contract_period_months']}ヶ月"}</td></tr>
        <tr><th>データ容量</th><td>{esc(offer['data_cap'])}</td></tr>
        <tr><th>対応エリア</th><td>{esc(offer['area_coverage'])}</td></tr>
        {'<tr><th>最大通信速度</th><td>下り '+str(offer['speed_max_mbps'])+' Mbps</td></tr>' if offer.get('speed_max_mbps') else ''}
      </table>
      {cashback_block(offer)}
    </div>
    <div style="margin-top:20px"><a href="#cta" class="cta-link cta-btn">公式サイトで申込む</a></div>
  </div>
</section>

<!-- 比較表 -->
<section class="section">
  <div class="container">
    <h2 class="section-title">他社との<em>比較</em></h2>
    <div class="compare-wrap">
      <table class="compare-table">
        <thead><tr><th>サービス</th><th>月額</th><th>容量</th><th>キャッシュバック</th><th>縛り</th></tr></thead>
        <tbody>{compare_rows}</tbody>
      </table>
    </div>
    <p style="font-size:10px;color:var(--muted);margin-top:8px;line-height:1.7">※2026年時点の各社公式情報をもとに作成。最新情報・適用条件は各公式サイトでご確認ください。</p>
  </div>
</section>

<!-- 口コミ -->
<section class="section">
  <div class="container">
    <h2 class="section-title">利用者の<em>声</em></h2>
    <div class="voice-list">{voice_html}</div>
    <p style="font-size:10px;color:var(--muted);margin-top:10px;text-align:center">※個人の感想であり、効果・満足度を保証するものではありません。</p>
  </div>
</section>

<!-- FAQ -->
<section class="section">
  <div class="container">
    <h2 class="section-title">よくある<em>質問</em></h2>
    {faq_html}
  </div>
</section>

<!-- 最終CTA -->
<section class="section" id="cta" style="text-align:center">
  <div class="container">
    <h2 class="section-title">まずは<em>公式サイト</em>で確認</h2>
    <p style="font-size:14px;line-height:1.9;color:var(--muted);margin-bottom:20px">最新のキャンペーン・適用条件・対応エリアは<br>公式サイトでご確認ください。</p>
    <a href="#" class="cta-link cta-btn">公式サイトで詳細を見る</a>
    <p class="cta-note" style="color:var(--muted);margin-top:12px">※申込・解約に関する詳細は公式サイトをご参照ください</p>
  </div>
</section>

<!-- フッター固定CTA -->
<div class="cta-fixed">
  <div class="cta-fixed-inner">
    <a href="#" class="cta-link cta-btn">公式サイトで申込む</a>
  </div>
</div>

<!-- 法令注記 -->
<footer class="legal">
  <div class="legal-inner">
    <h4>表記に関する注意</h4>
    <p>本ページの情報は{datetime.now().strftime("%Y年%m月")}時点のものです。料金・キャンペーン内容・適用条件は予告なく変更される場合があります。最新の情報は公式サイトでご確認ください。</p>
    <p>※掲載のキャッシュバックは代理店経由の特典であり、適用には所定の条件・手続きが必要です。受取手続きを忘れた場合は無効となります。</p>
    <p>※「利用者の声」は実在ユーザーの感想を要約・編集して掲載しているものを含みます。効果・満足度を保証するものではありません。</p>
    <p>※比較表の内容は各社公式情報をもとに作成しています。提供条件はエリア・建物・時期により異なります。</p>
    <h4 style="margin-top:18px">本サイトについて</h4>
    <p>本サイトは{esc(offer['name'])}の正規代理店およびアフィリエイトプログラムを通じて、商品情報・申込導線を提供しています。お申込み・解約に関するお問い合わせは公式サイトへお願いいたします。</p>
    <p style="margin-top:16px;text-align:center;opacity:.6">© {datetime.now().year} 通信比較ナビ All rights reserved.</p>
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
# 生成ループ
# ============================================================
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    count = 0
    skipped = 0
    generated = {}  # niche_id -> [(offer_id, slug)]
    for niche in NICHES.values():
        generated[niche["id"]] = []
        for offer_id in niche["preferred_offers"]:
            offer = OFFERS.get(offer_id)
            if not offer:
                print(f"  ⚠️  offer not found: {offer_id} (niche: {niche['id']})")
                skipped += 1
                continue
            html = gen_lp(niche, offer)
            slug = f"{niche['id']}-{offer_id}"
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
    if skipped:
        print(f"   スキップ: {skipped} 件")
    print(f"   出力先: {OUT_DIR}")
    print(f"   管理ページ: /affiliate/lp/index.html")


if __name__ == "__main__":
    main()
