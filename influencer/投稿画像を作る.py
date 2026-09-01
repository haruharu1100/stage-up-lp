#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""X・Instagram に出す「数字が入った画像」を作る。

なぜ必要か
  ・文字だけの投稿はほとんど伸びない（実績として確認済み。ゴロゴロ／
    キクソラの運用でも「投稿は必ず画像付き」を守っている）。
  ・あおいの写真は枚数に限りがあるが、比較の数字は毎日ちがう切り口で出せる。
    写真が無い日でも投稿を止めない、という目的の道具。

書く数字はどこから来るか
  affiliate/data/aoi_sim_compare.json（各社公式サイトで確認したもの）だけ。
  ★手で数字を打ち込まない。打ち込むと出典の無い数字が世に出るため。

使い方
  python3 投稿画像を作る.py --一覧          … 作れる型を見る
  python3 投稿画像を作る.py                 … 全部の型をXとInstagram用で作る
  python3 投稿画像を作る.py --型 通話料      … 1つだけ作る
"""
import os
import re
import sys
import json
import argparse

from PIL import Image, ImageDraw, ImageFont

import link_builder as 誘導

ここ = os.path.dirname(os.path.abspath(__file__))
リポジトリ = os.path.dirname(ここ)
データ = os.path.join(リポジトリ, "affiliate", "data", "aoi_sim_compare.json")
人物設定 = os.path.join(ここ, "persona.json")
出力先 = os.path.join(ここ, "post_images")

# 写真の投稿（post_001〜post_030）と番号がぶつからないよう、
# 比較画像は 101番台を使う。あとで成果を見るときに混ざらない。
比較投稿の開始番号 = 101

# 媒体ごとの絵の大きさ
サイズ = {
    "x": (1600, 900),          # Xのタイムラインで切れにくい比率
    "instagram": (1080, 1350),  # Instagramのフィードで一番大きく出る比率
}

書体 = "/System/Library/Fonts/ヒラギノ角ゴシック W%d.ttc"

# LPと同じ色。別々にすると「別のサイト」に見えて信用が落ちる。
背景 = (253, 251, 247)
文字 = (51, 48, 44)
薄字 = (125, 117, 104)
差し色 = (201, 138, 94)
枠線 = (231, 224, 212)
白 = (255, 255, 255)


def 字(太さ, 大きさ):
    return ImageFont.truetype(書体 % 太さ, 大きさ)


def 幅(描画, s, f):
    l, t, r, b = 描画.textbbox((0, 0), s, font=f)
    return r - l


def 収める(描画, s, 太さ, 大きさ, 上限幅):
    """文字が枠から出るくらい長いときは、収まるまで少しずつ小さくする。
    ★はみ出したまま出すと、数字が切れて読めない画像がSNSに出てしまう。"""
    f = 字(太さ, 大きさ)
    while 大きさ > 12 and 幅(描画, s, f) > 上限幅:
        大きさ -= 2
        f = 字(太さ, 大きさ)
    return f


def 円(s):
    """'22円/30秒' → 22。'15分かけ放題 1,100円' → 1100。

    ★先頭の数字ではなく『円が付いた数字』を拾う。先頭を拾うと
      「15分」を金額と誤解して、安い順の並びが嘘になるため。
    """
    m = re.search(r"(\d[\d,]*)\s*円", s or "") or re.search(r"(\d[\d,]*)", s or "")
    return int(m.group(1).replace(",", "")) if m else 10 ** 9


def 値を分ける(値):
    """『Aプラン 1,980円／Bプラン 880円』のように長い値を最大2行に分ける。
    ★勝手に短く切り落とさない。条件を落とすと有利誤認になるため、
      小さくしてでも全部を画像に載せる。"""
    値 = (値 or "").strip()
    区切り = [x.strip() for x in re.split(r"[／/]", 値) if x.strip()]
    if len(区切り) <= 1:
        return [値]
    if len(区切り) == 2:
        return 区切り
    半分 = (len(区切り) + 1) // 2
    return ["／".join(区切り[:半分]), "／".join(区切り[半分:])]


def 短く(値):
    """Xは字数が厳しいので短くする。
    ★条件を落とす方向には削らない。『850円〜3,900円』→『850円〜』は
      下限を示す表記なので可。数字そのものは書き換えない。"""
    v = 値を分ける(値)[0].strip()
    if "〜" in v:
        v = v.split("〜")[0].strip() + "〜"
    return v


def 短い社名(社):
    return re.sub(r"（.*?）", "", 社).strip()


def X字数(s):
    """Xの数え方。全角は2文字ぶん。URLは長さに関係なく23文字で数える。"""
    s = re.sub(r"https?://\S+", "x" * 23, s)
    return sum(1 if ord(c) < 0x1100 else 2 for c in s)


def 文を作る(中身, 媒体, checked, 土台URL, 番号, 設定):
    """画像に添える投稿文。★AIが書くのではなく、画像と同じ数字から組み立てる。
    体験のふり（使った・乗り換えた）は一切書かない。"""
    ラベル = 中身.get("ラベル", "通信費の見直しまとめ")
    媒体設定 = 設定["媒体"][媒体]
    投稿ID = 誘導.投稿IDを作る(番号, 設定)
    URL = 誘導.計測用URLを作る(
        土台URL, 媒体, 投稿ID if 媒体設定["本文にURLを置ける"] else "bio", None, 設定)
    CTA = 誘導.CTA文を作る(媒体, ラベル, URL, 設定)
    明示 = 設定["広告投稿"]

    if 媒体 == "x":
        行 = ["%d %s %s" % (i, 短い社名(s), 短く(v))
             for i, (s, v) in enumerate(中身["行"][:3], 1)]
        while 行:
            本文 = "\n".join(
                [中身["見出し"], ""] + 行 +
                ["", "各社公式で%s確認（税込）" % checked,
                 "※あおいはAIで作られたキャラクターです／アフィリエイト広告を含みます",
                 "", CTA])
            if X字数(本文) <= 280:
                return 本文
            行 = 行[:-1]          # 入らなければ下の行から落とす
        return 本文

    行 = ["%d位 %s %s" % (i, s, v) for i, (s, v) in enumerate(中身["行"], 1)]
    return "\n".join(
        [中身["見出し"], 中身["副題"], ""] + 行 +
        ["", 中身["ひとこと"],
         "各社公式サイトで %s 確認（税込・通常価格）" % checked,
         明示["AI明示文"], 明示["明示文"],
         "", CTA, "",
         "#節約 #格安SIM #通信費を見直す #スマホ代 #ひとり暮らし"])


def 型を作る(本体):
    items = 本体["items"]
    return {
        "月額": {
            "見出し": "月額がいちばん安いのは",
            "副題": "スマホ代・8社の下限（税込・通常価格）",
            "行": [(o["name"], o["monthly_display"]) for o in
                  sorted(items, key=lambda x: x["monthly_min_jpy"])[:5]],
            "ひとこと": "※使うデータ量で変わります。詳しい条件はLPに",
        },
        "通話料": {
            "見出し": "通話料は会社で2倍ちがう",
            "副題": "かけ放題を付けない場合の30秒あたり（税込）",
            "行": [(o["name"], o["call_standard"]) for o in
                  sorted(items, key=lambda x: 円(x["call_standard"]))[:5]],
            "ひとこと": "※専用アプリが必要な会社があります",
        },
        "初期費用": {
            "見出し": "契約時にかかるお金",
            "副題": "事務手数料＋SIM発行料（税込）",
            "行": [(o["name"], o["initial_fee_display"]) for o in
                  sorted(items, key=lambda x: 円(x["initial_fee_display"]))[:5]],
            # ★画像に出していない金額（合計額など）をひとことで足さない。
            #   出典のない数字に見えるため。
            "ひとこと": "※SIM発行料は会社ごとに違います。詳しい条件はLPに",
        },
        "かけ放題": {
            # ★「無制限」「長電話」と書かない。データには15分・5分などの
            #   条件付きも入っており、無制限と書くと事実と違い有利誤認になる。
            "見出し": "通話オプションは月いくら",
            "副題": "通話し放題オプションの月額（税込）",
            "行": [(o["name"], o["call_unlimited"]) for o in
                  sorted([o for o in items if o.get("call_unlimited")],
                         key=lambda x: 円(x["call_unlimited"]))][:5],
            "ひとこと": "※対象の通話に条件がある場合があります",
        },
    }


def 描く(型名, 中身, 媒体, checked):
    W, H = サイズ[媒体]
    余白 = int(W * 0.075)
    img = Image.new("RGB", (W, H), 背景)
    d = ImageDraw.Draw(img)

    縦 = int(H * 0.07)

    # 上の帯（誰が言っているか）
    f小 = 字(5, int(W * 0.021))
    d.text((余白, 縦), "あおいの通信費ノート", font=f小, fill=差し色)
    縦 += int(H * 0.045)

    # 見出し
    f大 = 字(7, int(W * 0.058))
    for 行 in [中身["見出し"]]:
        d.text((余白, 縦), 行, font=f大, fill=文字)
        縦 += int(f大.size * 1.35)

    f副 = 字(4, int(W * 0.024))
    d.text((余白, 縦), 中身["副題"], font=f副, fill=薄字)
    縦 += int(H * 0.055)

    # 表（1行＝1社）
    行 = list(中身["行"])
    値の行 = [値を分ける(v) for _, v in 行]

    # 値が長い型（かけ放題など）は、横に並べると字が小さくなりすぎて
    # スマホで読めない。その場合だけ「会社名の下に値」を置く形にし、
    # 載せる社数を3社に減らして1社あたりを大きく見せる。
    縦積み = max(len(s) for 組 in 値の行 for s in 組) > 16
    if 縦積み:
        行, 値の行 = 行[:3], 値の行[:3]

    # 縦積みは3社しか載せないので、その分1社を大きく取る。
    表高 = H * ((0.62 if 縦積み else 0.50) if 媒体 == "instagram"
              else (0.60 if 縦積み else 0.44))
    行高 = int(表高 / max(len(行), 1))
    箱高 = 行高 - int(行高 * 0.18)
    f順 = 字(7, int(W * 0.026))

    社幅 = W - 余白 * 2 - int(W * 0.085) - int(W * 0.04) if 縦積み else int(W * 0.30)
    値幅 = (W - 余白 * 2 - int(W * 0.06) if 縦積み
           else W - 余白 * 2 - int(W * 0.085) - 社幅 - int(W * 0.04))
    社大 = min(収める(d, s, 6, int(W * (0.027 if 縦積み else 0.032)), 社幅).size
              for s, _ in 行)
    値大 = min(収める(d, s, 7, int(W * 0.038), 値幅).size
              for 組 in 値の行 for s in 組)

    # 箱からはみ出さないよう、高さの側からも上限をかける。
    最多行 = max(len(組) for 組 in 値の行)
    余り = 箱高 - (int(社大 * 1.3) if 縦積み else 0)
    値大 = max(12, min(値大, int(余り / (1.3 * 最多行))))

    f社 = 字(6, 社大)
    f値 = 字(7, 値大)
    for i, ((社, _), 値組) in enumerate(zip(行, 値の行), 1):
        y = 縦
        d.rounded_rectangle([余白, y, W - 余白, y + 箱高],
                            radius=int(W * 0.012), fill=白, outline=枠線, width=2)
        中 = y + 箱高 // 2

        # 順位の丸
        r = int(W * 0.019)
        cx = 余白 + int(W * 0.045)
        丸中 = y + int(社大 * 0.9) if 縦積み else 中
        d.ellipse([cx - r, 丸中 - r, cx + r, 丸中 + r],
                  fill=差し色 if i == 1 else (240, 236, 227))
        n = str(i)
        d.text((cx - 幅(d, n, f順) / 2, 丸中 - f順.size * 0.62), n, font=f順,
               fill=白 if i == 1 else 薄字)

        行間 = int(f値.size * 1.3)
        値高 = 行間 * (len(値組) - 1) + f値.size
        if 縦積み:
            d.text((余白 + int(W * 0.085), 丸中 - f社.size * 0.62), 社,
                   font=f社, fill=文字)
            上端 = 丸中 + int(社大 * 0.85)
            上 = 上端 + max(0, (y + 箱高 - int(箱高 * 0.08) - 上端 - 値高) / 2)
            左 = 余白 + int(W * 0.03)
            for j, 文 in enumerate(値組):
                d.text((左, 上 + 行間 * j), 文, font=f値, fill=差し色)
        else:
            d.text((余白 + int(W * 0.085), 中 - f社.size * 0.62), 社,
                   font=f社, fill=文字)
            上 = 中 - f値.size * 0.62 - 行間 * (len(値組) - 1) / 2
            for j, 文 in enumerate(値組):
                w = 幅(d, 文, f値)
                d.text((W - 余白 - int(W * 0.03) - w, 上 + 行間 * j), 文,
                       font=f値, fill=差し色)
        縦 += 行高

    # 下の注記。★出典と確認日は必ず画像の中に入れる。
    # 3行ぶんの高さを先に確保する。足りないと最後の「AI明示・広告明示」が切れて、
    # 表示上ステマになってしまうため、ここは必ず画像の中に収める。
    f注 = 字(3, int(W * 0.019))
    縦 = H - int(f注.size * 4.6) - int(H * 0.02)
    d.text((余白, 縦), 中身["ひとこと"], font=f注, fill=薄字)
    d.text((余白, 縦 + int(f注.size * 1.5)),
           "各社公式サイトで %s 確認／税込・通常価格" % checked, font=f注, fill=薄字)
    d.text((余白, 縦 + int(f注.size * 3.0)),
           "あおいはAIキャラクターです／アフィリエイト広告を含みます", font=f注, fill=薄字)

    os.makedirs(出力先, exist_ok=True)
    パス = os.path.join(出力先, "aoi_%s_%s.png" % (型名, 媒体))
    img.save(パス)
    return パス


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--型", default="", help="1つだけ作る（月額 / 通話料 / 初期費用 / かけ放題）")
    ap.add_argument("--一覧", action="store_true")
    ap.add_argument("--文なし", action="store_true", help="画像だけ作る（投稿文を作らない）")
    args = ap.parse_args()

    本体 = json.load(open(データ, encoding="utf-8"))
    checked = 本体["checked_at"]
    型 = 型を作る(本体)

    if args.一覧:
        print("\n作れる型:")
        for k, v in 型.items():
            print("  %-6s %s" % (k, v["見出し"]))
            for 社, 値 in v["行"]:
                print("           %-14s %s" % (社, 値))
        print()
        return 0

    if args.型 and args.型 not in 型:
        raise SystemExit("そんな型はありません。使える型: %s" % "、".join(型))
    対象 = {args.型: 型[args.型]} if args.型 else 型

    設定 = 誘導.設定を読む()
    土台URL = ""
    if not args.文なし:
        # ★誘導先が無いまま投稿文を作らない。仮URLは作らない。
        人物 = json.load(open(人物設定, encoding="utf-8"))
        土台URL = 誘導.誘導先URLを取り出す(人物)

    作った = []
    for 名, 中身 in 対象.items():
        番号 = 比較投稿の開始番号 + list(型).index(名)
        for 媒体 in サイズ:
            作った.append(描く(名, 中身, 媒体, checked))
            if args.文なし:
                continue
            文 = 文を作る(中身, 媒体, checked, 土台URL, 番号, 設定)
            文パス = os.path.join(出力先, "aoi_%s_%s.txt" % (名, 媒体))
            with open(文パス, "w", encoding="utf-8") as f:
                f.write(文 + "\n")
            作った.append(文パス)

    print("\n%d 個作りました（%s）" % (len(作った), 出力先))
    for p in 作った:
        print("  " + os.path.basename(p))
    print("\n数字は比較データ（各社公式・%s確認）からそのまま取っています。" % checked)
    print("画像の中に出典・確認日・AI明示・広告明示が入っています。")
    if not args.文なし:
        print("投稿文（.txt）はそのまま貼れます。Xは本文にリンク、"
              "Instagramはプロフィールのリンクへ誘導する形になっています。\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
