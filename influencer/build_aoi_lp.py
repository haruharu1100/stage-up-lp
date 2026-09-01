#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""あおいのLPを、検証済みデータから組み立てる。

方針
  ・リンクはすべて相対。フォルダごと独自ドメインへ移せる形にする。
  ・一人称の使用体験は1文字も書かない（あおいは実在しないため）。
  ・金額には必ず出典と確認日を付ける。
  ・書いてはいけない表現を、書き出す前に機械で検査して止める。

使い方
  python3 build_aoi_lp.py            … 作る
  python3 build_aoi_lp.py --検査だけ  … 表現の検査だけ
"""
import os
import re
import json
import html
import argparse
import datetime

ここ = os.path.dirname(os.path.abspath(__file__))
リポジトリ = os.path.dirname(ここ)
データ = os.path.join(リポジトリ, "affiliate", "data", "aoi_sim_compare.json")
出力先 = os.path.join(リポジトリ, "affiliate", "aoi")

# ★書いてはいけない表現。景表法（優良誤認・有利誤認）と、
#   AIキャラが使っていないものを「使った」と書く虚偽（FTC）を機械で止める。
禁止表現 = [
    # 断定・誇大
    "必ず安くなる", "絶対に安く", "絶対おすすめ", "絶対つながる", "必ず儲か",
    "日本一", "業界No.1", "業界ナンバーワン", "最速", "完全無制限",
    "最安値", "業界最安", "激安",
    # 一人称の使用体験（あおいは実在しないため書けない）
    "私が使った", "私は使って", "私が乗り換え", "乗り換えました", "使ってみました",
    "契約しました", "私のスマホ代", "月7000円浮い", "月5000円浮い",
    # 煽り
    "今だけ", "今すぐ申し込", "残りわずか", "急がないと", "このチャンスを逃す",
]


def 逃がす(s):
    return html.escape(str(s), quote=True)


def 表現を検査する(ページ名, 中身):
    """禁止表現が1つでもあれば、その場で止める。"""
    見つかった = [語 for 語 in 禁止表現 if 語 in 中身]
    if 見つかった:
        raise SystemExit(
            "\n【中止】%s に、書いてはいけない表現が入っています:\n  %s\n"
            "  景表法・FTCの問題になるため、書き出しませんでした。\n"
            % (ページ名, " / ".join(見つかった))
        )


雛形 = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="robots" content="index,follow">
<style>
:root{{--bg:#fdfbf7;--ink:#33302c;--sub:#7d7568;--line:#e7e0d4;--accent:#c98a5e;--soft:#fff}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;line-height:1.85;font-size:16px}}
.wrap{{max-width:760px;margin:0 auto;padding:0 18px}}
header{{padding:28px 0 18px;border-bottom:1px solid var(--line)}}
header .name{{font-size:19px;font-weight:700;letter-spacing:.04em}}
header .tag{{font-size:13px;color:var(--sub);margin-top:4px}}
h1{{font-size:25px;line-height:1.5;margin:30px 0 12px}}
h2{{font-size:20px;margin:38px 0 12px;padding-left:11px;border-left:4px solid var(--accent)}}
h3{{font-size:16px;margin:24px 0 8px}}
p{{margin:12px 0}}
.note{{background:#f4efe6;border:1px solid var(--line);border-radius:10px;padding:13px 15px;font-size:13.5px;color:var(--sub);margin:16px 0}}
.note strong{{color:var(--ink)}}
.card{{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:17px 18px;margin:14px 0}}
.card h3{{margin-top:0;display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}}
.price{{font-size:15px;color:var(--accent);font-weight:700;white-space:nowrap}}
dl{{margin:10px 0;font-size:14.5px}}
dt{{color:var(--sub);font-size:12.5px;margin-top:9px}}
dd{{margin:2px 0 0}}
ul{{margin:8px 0;padding-left:1.15em;font-size:14.5px}}
li{{margin:4px 0}}
.btn{{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;padding:13px;border-radius:9px;margin-top:14px;font-weight:700;font-size:15px}}
.btn.plain{{background:#fff;color:var(--accent);border:1.5px solid var(--accent)}}
.btn.none{{background:#f0ece3;color:var(--sub);border:1px solid var(--line);font-weight:400;font-size:13.5px}}
.src{{font-size:11.5px;color:var(--sub);margin-top:11px;word-break:break-all}}
.src a{{color:var(--sub)}}
.menu a{{display:block;background:var(--soft);border:1px solid var(--line);border-radius:11px;padding:15px 17px;margin:11px 0;text-decoration:none;color:var(--ink)}}
.menu .t{{font-weight:700;font-size:16px}}
.menu .d{{font-size:13.5px;color:var(--sub);margin-top:3px}}
table{{width:100%;border-collapse:collapse;font-size:13px;margin:14px 0;display:block;overflow-x:auto;white-space:nowrap}}
th,td{{border:1px solid var(--line);padding:8px 10px;text-align:left}}
th{{background:#f4efe6;font-weight:700}}
footer{{margin:46px 0 30px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--sub)}}
footer a{{color:var(--sub);margin-right:14px}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="name">あおいの通信費ノート</div>
  <div class="tag">ひとり暮らしの固定費を、条件から比べる</div>
</header>
{body}
<footer>
  <p>
    <a href="{root}/">トップ</a>
    <a href="{root}/about">あおいについて</a>
    <a href="{root}/disclosure">広告表示について</a>
    <a href="/affiliate/privacy.html">プライバシーポリシー</a>
  </p>
  <p>掲載内容は{checked}時点で各社公式サイトを確認したものです。
  料金・条件は変更される場合があります。申し込みの前に必ず各社公式サイトで最新の内容をご確認ください。</p>
  <p>※このサイトに登場する「あおい」はAIで作られたキャラクターで、実在しません。<br>
  ※このサイトにはアフィリエイト広告（プロモーション）が含まれます。</p>
</footer>
</div>
</body>
</html>
"""

明示ブロック = """<div class="note">
<strong>はじめにお読みください</strong><br>
・このサイトの「あおい」は<strong>AIで作られたキャラクター</strong>で、実在しません。実際に契約した体験談は書いていません。<br>
・このページには<strong>アフィリエイト広告（プロモーション）が含まれます</strong>。<br>
・掲載している金額はすべて<strong>税込・通常価格</strong>です。期間限定の割引は通常価格と分けて書いています。
</div>"""


def 入口ページ(データ本体, root):
    checked = データ本体["checked_at"]
    body = f"""
<h1>スマホ代を見直したい人のための、<br>条件から選ぶ比較ノート</h1>
<p>「安いのはどれ？」だけで選ぶと、通話料や初期費用であとから差がつくことがあります。
このサイトは、各社の公式サイトで確認した数字を並べて、<strong>条件から選べる</strong>ようにまとめたものです。</p>
{明示ブロック}
<h2>何を見直したいですか</h2>
<div class="menu">
  <a href="{root}/sim">
    <div class="t">スマホ代を下げたい</div>
    <div class="d">格安SIM・キャリア8社を、月額・容量・通話・初期費用で比べる</div>
  </a>
</div>
<div class="note">
光回線・ポケットWiFiの比較ページは準備中です。できていないものを「あります」とは書きません。
</div>

<h2>このサイトの決まりごと</h2>
<ul>
<li>金額は<strong>必ず出典（各社公式ページ）と確認日</strong>を付けて載せます。</li>
<li>デメリットも必ず書きます。良いところだけは載せません。</li>
<li>期間限定の割引を「通常価格」として書きません。</li>
<li>あおいは実在しないので、「使ってよかった」という書き方はしません。</li>
</ul>
<p style="font-size:13.5px;color:var(--sub)">最終確認日：{checked}</p>
"""
    return body


def 比較ページ(データ本体, root):
    items = sorted(データ本体["items"], key=lambda x: x["monthly_min_jpy"])
    checked = データ本体["checked_at"]

    表 = ["<table><tr><th>会社</th><th>月額（税込）</th><th>データ容量</th><th>初期費用</th><th>通話料</th><th>かけ放題</th></tr>"]
    for o in items:
        表.append(
            "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % (
                逃がす(o["name"]), 逃がす(o["monthly_display"]), 逃がす(o["data_display"]),
                逃がす(o["initial_fee_display"]), 逃がす(o["call_standard"]),
                逃がす(o["call_unlimited"] or "―"),
            ))
    表.append("</table>")

    カード = []
    for o in items:
        if o["link_type"] == "affiliate":
            ボタン = '<a class="btn" href="%s" target="_blank" rel="nofollow sponsored noopener">%s の公式サイトを見る<span style="font-size:11px;font-weight:400"> （広告）</span></a>' % (逃がす(o["link_url"]), 逃がす(o["name"]))
        elif o["link_type"] == "official":
            ボタン = '<a class="btn plain" href="%s" target="_blank" rel="noopener">%s の公式サイトを見る</a>' % (逃がす(o["link_url"]), 逃がす(o["name"]))
        else:
            ボタン = '<a class="btn none" href="%s" target="_blank" rel="noopener">%s の公式サイトを見る（当サイトに広告リンクはありません）</a>' % (逃がす(o["link_url"]), 逃がす(o["name"]))

        キャンペーン = ""
        if o.get("campaign"):
            キャンペーン = '<dt>キャンペーン（通常価格ではありません）</dt><dd>%s</dd>' % 逃がす(o["campaign"])

        カード.append(f"""<div class="card">
<h3><span>{逃がす(o['name'])}</span><span class="price">{逃がす(o['monthly_display'])}</span></h3>
<dl>
<dt>プラン</dt><dd>{逃がす(o['plan_name'])}</dd>
<dt>月額の内訳</dt><dd>{逃がす(o['monthly_note'])}</dd>
<dt>データ容量</dt><dd>{逃がす(o['data_display'])}</dd>
<dt>初期費用</dt><dd>{逃がす(o['initial_fee_display'])}（{逃がす(o['initial_fee_note'])}）</dd>
<dt>通話料</dt><dd>{逃がす(o['call_standard'])} ／ {逃がす(o['call_note'])}</dd>
<dt>かけ放題</dt><dd>{逃がす(o['call_unlimited'] or '―')}</dd>
<dt>専用アプリ</dt><dd>{逃がす(o['call_app_required'])}</dd>
{キャンペーン}
</dl>
<h4 style="font-size:14px;margin:14px 0 2px">よいところ</h4>
<ul>{''.join('<li>%s</li>' % 逃がす(m) for m in o['merits'])}</ul>
<h4 style="font-size:14px;margin:14px 0 2px">気をつけたいところ</h4>
<ul>{''.join('<li>%s</li>' % 逃がす(m) for m in o['demerits'])}</ul>
<p style="font-size:14px;margin-top:12px"><strong>向いていそうな人：</strong>{逃がす(o['fit'])}</p>
{ボタン}
<div class="src">出典：<a href="{逃がす(o['monthly_source'])}" target="_blank" rel="noopener nofollow">料金</a>／<a href="{逃がす(o['call_source'])}" target="_blank" rel="noopener nofollow">通話</a>（いずれも公式・{逃がす(o['checked_at'])}確認）</div>
</div>""")

    # 条件から選ぶ
    安い順 = sorted(items, key=lambda x: x["monthly_min_jpy"])[:3]
    通話安い = sorted(items, key=lambda x: int(re.sub(r"\D", "", x["call_standard"]) or 999))[:2]
    初期0 = [o for o in items if o["initial_fee_display"] == "0円"]

    body = f"""
<h1>格安SIM・キャリア8社を、条件から比べる</h1>
<p>月額の安さだけで選ぶと、初期費用や通話料であとから差がつきます。
下の表は{checked}時点で各社公式サイトを1件ずつ確認した数字です。</p>
{明示ブロック}

<h2>ひと目で比べる</h2>
{''.join(表)}
<p style="font-size:12.5px;color:var(--sub)">※横にスクロールできます。金額はすべて税込・通常価格。</p>

<h2>条件から選ぶ</h2>
<div class="card">
<dl>
<dt>とにかく月額を下げたい</dt><dd>{逃がす(' → '.join('%s（%s）' % (o['name'], o['monthly_display']) for o in 安い順))}</dd>
<dt>かけ放題を付けずに通話料を抑えたい</dt><dd>{逃がす(' → '.join('%s（%s）' % (o['name'], o['call_standard']) for o in 通話安い))}</dd>
<dt>初期費用を0円にしたい</dt><dd>{逃がす('、'.join(o['name'] for o in 初期0))}</dd>
<dt>短い電話をよくかける</dt><dd>ahamo（5分以内の通話が最初からプランに含まれています）</dd>
<dt>長電話をする</dt><dd>mineo（時間無制限のかけ放題が1,210円）</dd>
</dl>
</div>

<h2>1社ずつ見る</h2>
<p style="font-size:14px;color:var(--sub)">月額の下限が安い順に並べています。</p>
{''.join(カード)}

<h2>選ぶ前に見ておきたいこと</h2>
<div class="card">
<h3 style="margin-top:0">初期費用は月額に隠れて見えにくい</h3>
<p style="font-size:14.5px">事務手数料が0円のところと3,850円のところがあります。さらにmineo・IIJmio・LIBMOは、事務手数料とは別に<strong>SIMの発行料（433円前後）</strong>がかかります。1年使う前提なら、初期費用3,733円は月あたり約311円に相当します。</p>
</div>
<div class="card">
<h3 style="margin-top:0">通話料は会社によって2倍ちがう</h3>
<p style="font-size:14.5px">30秒あたり22円のところが多い中で、IIJmioは11円です。かけ放題を付けない前提なら、ここは月額と同じくらい効いてきます。</p>
</div>
<div class="card">
<h3 style="margin-top:0">キャッシュバックは「受け取り条件」を見る</h3>
<p style="font-size:14.5px">金額が大きく見えても、端末の購入が条件だったり、現金ではなくポイントでの還元だったりします。受け取れる時期と条件を、必ず各社公式サイトで確認してください。</p>
</div>

<p style="font-size:13.5px;color:var(--sub);margin-top:28px">最終確認日：{checked}／出典はすべて各社公式サイトです。比較サイト・まとめ記事は出典にしていません。</p>
"""
    return body


def 説明ページ(root):
    return """
<h1>「あおい」について</h1>
<div class="note">
<strong>あおいは、AIで作られたキャラクターです。実在しません。</strong>
</div>
<p>このサイトとSNSに登場する「あおい」は、画像生成AIで作られた架空の人物です。
モデルになった実在の人物はいません。</p>

<h2>だから、書かないことがあります</h2>
<p>あおいは実在しないので、実際にスマホを契約したり、乗り換えたりすることができません。
そのため、このサイトでは次のようなことは書きません。</p>
<ul>
<li>「使ってみてよかった」といった、使用した体験の話</li>
<li>「乗り換えて月◯円安くなった」といった、確かめられない金額の話</li>
</ul>
<p>代わりに、各社の公式サイトで確認できる事実だけを並べて、比べられる形にしています。
数字にはすべて出典と確認日を付けています。</p>

<h2>なぜAIキャラであることを書くのか</h2>
<p>読む人が「実在の人の体験談だ」と思ったまま判断してしまうと、それは誤解のもとになるからです。
隠すほうが数字は伸びるかもしれませんが、隠さない方針にしています。</p>
"""


def 広告表示ページ(root):
    return """
<h1>広告表示について</h1>
<div class="note">
<strong>このサイトにはアフィリエイト広告（プロモーション）が含まれます。</strong>
</div>
<p>当サイトの一部のリンクは広告（アフィリエイトリンク）です。
そのリンクを経由して申し込みがあった場合、当サイトの運営者が広告主から報酬を受け取ることがあります。</p>

<h2>広告のリンクは見分けられるようにしています</h2>
<ul>
<li>広告のリンクのボタンには<strong>「（広告）」と表示</strong>しています。</li>
<li>広告ではない、公式サイトへの通常のリンクは、色の違うボタンにしています。</li>
<li>当サイトに広告リンクがない会社は、その旨をボタンに書いています。</li>
</ul>

<h2>順番は報酬で決めていません</h2>
<p>比較表と一覧の並び順は<strong>月額の下限が安い順</strong>で、報酬の金額とは関係ありません。
報酬が発生しない会社も同じ基準で載せています。</p>

<h2>金額について</h2>
<p>掲載している金額は、記載の確認日時点で各社公式サイトに掲載されていた税込・通常価格です。
期間限定の割引やキャンペーンは、通常価格とは分けて記載しています。</p>
<p>料金や条件は変更されることがあります。<strong>申し込みの前に、必ず各社の公式サイトで最新の内容をご確認ください。</strong>
当サイトの情報にもとづく判断について、運営者は責任を負いかねます。</p>
"""


def 書き出す(パス, title, desc, body, root, checked):
    中身 = 雛形.format(title=逃がす(title), desc=逃がす(desc), body=body, root=root, checked=checked)
    表現を検査する(パス, 中身)
    os.makedirs(os.path.dirname(パス), exist_ok=True)
    with open(パス, "w", encoding="utf-8") as f:
        f.write(中身)
    return len(中身)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--検査だけ", action="store_true")
    args = ap.parse_args()

    本体 = json.load(open(データ, encoding="utf-8"))
    checked = 本体["checked_at"]
    root = "/aoi"

    ページ群 = [
        (os.path.join(出力先, "index.html"),
         "あおいの通信費ノート｜スマホ代を条件から比べる",
         "格安SIM・キャリア8社を、月額・データ容量・通話料・初期費用で比較。各社公式サイトで確認した数字に出典と確認日を付けています。",
         入口ページ(本体, root)),
        (os.path.join(出力先, "sim", "index.html"),
         "格安SIM・キャリア8社の比較｜月額・通話・初期費用",
         "楽天モバイル・LINEMO・ahamo・ワイモバイル・mineo・IIJmio・LIBMO・povoを、月額と通話料と初期費用で比較。デメリットも記載。",
         比較ページ(本体, root)),
        (os.path.join(出力先, "about", "index.html"),
         "「あおい」について｜AIで作られたキャラクターです",
         "当サイトに登場する「あおい」はAIで作られた架空のキャラクターです。実在しないため、使用体験は掲載していません。",
         説明ページ(root)),
        (os.path.join(出力先, "disclosure", "index.html"),
         "広告表示について｜アフィリエイト広告を含みます",
         "当サイトにはアフィリエイト広告が含まれます。広告リンクの見分け方と、並び順の基準について。",
         広告表示ページ(root)),
    ]

    if args.検査だけ:
        for パス, t, d, b in ページ群:
            表現を検査する(os.path.basename(os.path.dirname(パス)) or "index",
                      雛形.format(title=t, desc=d, body=b, root=root, checked=checked))
        print("表現の検査: 問題なし（%d ページ）" % len(ページ群))
        return

    合計 = 0
    for パス, t, d, b in ページ群:
        大きさ = 書き出す(パス, t, d, b, root, checked)
        合計 += 大きさ
        print("  %s  (%.1f KB)" % (パス.replace(リポジトリ + "/", ""), 大きさ / 1024))
    print("\nLPを %d ページ作りました（合計 %.1f KB）。" % (len(ページ群), 合計 / 1024))
    print("広告リンク: %d 件 / 公式リンク: %d 件 / リンク無し: %d 件" % (
        sum(1 for o in 本体["items"] if o["link_type"] == "affiliate"),
        sum(1 for o in 本体["items"] if o["link_type"] == "official"),
        sum(1 for o in 本体["items"] if o["link_type"] == "none"),
    ))


if __name__ == "__main__":
    main()
