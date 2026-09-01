#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ASPで発行された広告リンクを、LPに登録する。

なぜこの道具があるか
  提携が通るたびにJSONを手で開いて書き換えると、貼り間違い・貼り忘れが起きる。
  貼る場所を1か所にして、貼ったらその場でLPを作り直すところまで一気にやる。

使い方
  python3 広告リンクを登録する.py --一覧
      … いまどの会社が広告リンク付きで、どこが公式リンクのままかを見る

  python3 広告リンクを登録する.py ahamo "https://（ASPで発行されたURL）"
      … ahamo に広告リンクを登録し、LPを作り直す

  python3 広告リンクを登録する.py ahamo --戻す
      … 広告リンクを外して、公式サイトへの普通のリンクに戻す

安全のため、次の場合はその場で止まります。
  ・http/https でないもの
  ・各社の公式ドメインそのもの（＝ASPを通っていない＝報酬が出ない）
  ・すでに別の会社に登録済みのURLと同じもの（貼り間違い）
"""
import os
import re
import sys
import json
import shutil
import argparse
import subprocess
import urllib.parse

ここ = os.path.dirname(os.path.abspath(__file__))
リポジトリ = os.path.dirname(ここ)
データ = os.path.join(リポジトリ, "affiliate", "data", "aoi_sim_compare.json")

# 「これは公式サイトのURLであってASPのURLではない」と判定するための一覧。
# ここに一致したら報酬が発生しないので、登録させない。
公式ドメイン = {
    "rakuten-mobile": ["network.mobile.rakuten.co.jp", "mobile.rakuten.co.jp"],
    "linemo": ["linemo.jp"],
    "ahamo": ["ahamo.com"],
    "ymobile": ["ymobile.jp"],
    "mineo": ["mineo.jp"],
    "iijmio": ["iijmio.jp"],
    "libmo": ["libmo.jp"],
    "povo": ["povo.jp"],
}


def 読む():
    return json.load(open(データ, encoding="utf-8"))


def 書く(本体):
    shutil.copyfile(データ, データ + ".bak")   # 直前の状態を1つだけ残す
    with open(データ, "w", encoding="utf-8") as f:
        json.dump(本体, f, ensure_ascii=False, indent=2)
        f.write("\n")


def 一覧を出す(本体):
    print("\n══════ いまの広告リンクの状態 ══════\n")
    広告 = 0
    for o in 本体["items"]:
        しるし = {"affiliate": "★広告リンクあり（報酬が出ます）",
                "official": "　公式リンクのまま（報酬は出ません）",
                "none": "　提携先が無いので公式リンクのまま"}[o["link_type"]]
        if o["link_type"] == "affiliate":
            広告 += 1
        print("  %-14s %-12s %s" % (o["id"], o["name"], しるし))
    print("\n  8社中 %d 社が報酬対象です。" % 広告)
    まだ = [o["id"] for o in 本体["items"] if o["link_type"] == "official"]
    if まだ:
        print("  提携が通ったら登録できる会社: %s\n" % "、".join(まだ))


def URLを検査する(会社ID, url, 本体):
    url = (url or "").strip()
    if not re.match(r"^https?://", url):
        raise SystemExit("\n【中止】http:// か https:// で始まるURLを入れてください。\n")

    ホスト = (urllib.parse.urlparse(url).hostname or "").lower()
    for 公式 in 公式ドメイン.get(会社ID, []):
        if ホスト == 公式 or ホスト.endswith("." + 公式):
            raise SystemExit(
                "\n【中止】これは %s の公式サイトのURLです（%s）。\n"
                "  ASPの管理画面で発行された広告用のURLを貼ってください。\n"
                "  公式URLのままだと、申し込みがあっても報酬になりません。\n" % (会社ID, ホスト))

    for o in 本体["items"]:
        if o["id"] != 会社ID and o["link_type"] == "affiliate" and o["link_url"] == url:
            raise SystemExit(
                "\n【中止】そのURLは、すでに %s に登録されています。\n"
                "  会社を取り違えていないか確認してください。\n" % o["name"])
    return url


def LPを作り直す():
    print("\nLPを作り直します...")
    r = subprocess.run([sys.executable, os.path.join(ここ, "build_aoi_lp.py")])
    return r.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("会社", nargs="?", help="ahamo / linemo / ymobile / mineo / iijmio / libmo など")
    ap.add_argument("URL", nargs="?", help="ASPで発行された広告用URL")
    ap.add_argument("--一覧", action="store_true", help="いまの状態を見るだけ")
    ap.add_argument("--戻す", action="store_true", help="公式リンクに戻す")
    ap.add_argument("--ASP", default="", help="どのASP経由か（例: ドコモアフィリエイト）")
    args = ap.parse_args()

    本体 = 読む()

    if args.一覧 or not args.会社:
        一覧を出す(本体)
        if not args.会社:
            print("  登録するとき: python3 広告リンクを登録する.py ahamo \"（ASPのURL）\"\n")
        return 0

    対象 = next((o for o in 本体["items"] if o["id"] == args.会社), None)
    if 対象 is None:
        raise SystemExit("\n【中止】そんな会社はありません: %s\n  使える名前: %s\n"
                         % (args.会社, "、".join(o["id"] for o in 本体["items"])))

    if args.戻す:
        公式 = 公式ドメイン.get(args.会社, [""])[0]
        対象["link_url"] = "https://%s/" % 公式
        対象["link_type"] = "official"
        対象.pop("asp", None)
        書く(本体)
        print("\n%s を公式リンクに戻しました。" % 対象["name"])
        return LPを作り直す()

    if not args.URL:
        raise SystemExit("\n【中止】URLを入れてください。\n")

    url = URLを検査する(args.会社, args.URL, 本体)
    前 = 対象["link_type"]
    対象["link_url"] = url
    対象["link_type"] = "affiliate"
    if args.ASP:
        対象["asp"] = args.ASP
    書く(本体)

    print("\n══════ 登録しました ══════")
    print("  会社  : %s" % 対象["name"])
    print("  変更  : %s → affiliate（広告リンク）" % 前)
    print("  URL   : %s" % url[:90])
    print("  ボタンには自動で「（広告）」と表示され、rel=\"sponsored\" が付きます。")

    戻り = LPを作り直す()
    if 戻り == 0:
        一覧を出す(読む())
        print("  このあと公開するには:")
        print('    cd "%s" && git add affiliate/aoi affiliate/data/aoi_sim_compare.json && git commit -m "あおいLP: %s の広告リンクを登録" && git push origin HEAD:main\n'
              % (リポジトリ, 対象["name"]))
    return 戻り


if __name__ == "__main__":
    sys.exit(main())
