#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""あおいの写真を、既存を壊さずに足す。

なぜ別スクリプトにするか
  generate.py は 1番から順に aoi_01.png ... と書くので、そのまま流すと
  すでにある15枚を上書きしてしまう。足すだけの動きは別にしておく。

やること
  character_aoi_extra.json の場面を、character.json と同じ顔・同じ seed で
  生成し、aoi_16.png から順に保存する。すでにある番号は飛ばす。

使い方
  python3 写真を増やす.py --確認   … 何を作るか見るだけ（生成しない）
  python3 写真を増やす.py          … 実際に作る
  python3 写真を増やす.py --枚数 5 … 先に5枚だけ試す
"""
import os
import sys
import json
import uuid
import shutil
import argparse
import urllib.error

import generate as 元

ここ = os.path.dirname(os.path.abspath(__file__))
追加設定 = os.path.join(ここ, "character_aoi_extra.json")

# 健全側のキャラなので、ここに挙げた言葉が場面に入っていたら作らない。
# ★成人向け側とは完全に別事業。1枚でも混ざるとSNSと広告提携が止まる。
書いてはいけない言葉 = (
    "nude", "naked", "lingerie", "underwear", "bikini", "swimsuit", "topless",
    "cleavage", "seductive", "sexy", "erotic", "bath", "shower", "bedroom lying",
)


def 場面を検査する(場面の一覧):
    悪いもの = []
    for i, s in enumerate(場面の一覧, 1):
        小文字 = s.lower()
        当たり = [w for w in 書いてはいけない言葉 if w in 小文字]
        if 当たり:
            悪いもの.append((i, s, 当たり))
    if 悪いもの:
        print("\n【中止】健全側に置けない場面が入っています:")
        for i, s, w in 悪いもの:
            print("  %d番目: %s  ← %s" % (i, s[:60], " / ".join(w)))
        raise SystemExit(1)


def 空いている番号(開始, 必要数):
    """すでにある写真は絶対に上書きしない。空いている番号だけを返す。"""
    番号 = []
    n = 開始
    while len(番号) < 必要数:
        if not os.path.exists(os.path.join(元.OUT_DIR, "aoi_%02d.png" % n)):
            番号.append(n)
        n += 1
        if n > 999:
            break
    return 番号


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--確認", action="store_true", help="作らずに内容だけ見る")
    ap.add_argument("--枚数", type=int, default=0, help="先に何枚だけ作るか")
    args = ap.parse_args()

    本体 = json.load(open(追加設定, encoding="utf-8"))
    顔 = json.load(open(元.CHAR_PATH, encoding="utf-8"))
    場面 = 本体["scenes"]
    if args.枚数 > 0:
        場面 = 場面[: args.枚数]

    場面を検査する(場面)

    番号 = 空いている番号(int(本体.get("_開始番号", 16)), len(場面))
    既存 = len([f for f in os.listdir(元.OUT_DIR) if f.startswith("aoi_") and f.endswith(".png")])

    print("\n══════ あおいの写真を足す ══════")
    print("  いまある写真: %d 枚" % 既存)
    print("  これから足す: %d 枚（aoi_%02d 〜 aoi_%02d）" % (len(番号), 番号[0], 番号[-1]))
    print("  顔は character.json と同じ設定・同じ seed を使うので同一人物になります。")
    print("  ★既存の写真は1枚も上書きしません。\n")
    for n, s in zip(番号, 場面):
        print("   aoi_%02d  %s" % (n, s[:70]))

    if args.確認:
        print("\n（--確認 を外すと実際に作ります）\n")
        return 0

    if not 元.wait_server():
        print("\n【中止】ComfyUI が動いていません。先に画像エンジンを起動してください。\n")
        return 1

    client_id = str(uuid.uuid4())
    seed = int(顔["seed"])
    作れた = 0
    for 順, (n, s) in enumerate(zip(番号, 場面), 1):
        positive = "%s, %s, %s" % (顔["base_face"], s, 顔["quality"])
        wf = 元.build_workflow(positive, 顔["negative"], seed + n)
        print("[%d/%d] aoi_%02d を生成中..." % (順, len(番号), n))
        try:
            pid = 元.queue_prompt(wf, client_id)
        except urllib.error.HTTPError as e:
            print("   投入エラー:", e.read().decode("utf-8", "ignore")[:200])
            continue
        # ★画像エンジンは成人向け側の生成と共用しているため、順番待ちで
        #   1枚に15分以上かかることがある。短く切ると「失敗」に見えてしまう。
        画像 = 元.wait_result(pid, max_wait=7200)
        if not 画像:
            print("   生成できませんでした。")
            continue
        for img in 画像:
            src = os.path.join(元.COMFY_OUT, img.get("subfolder", ""), img["filename"])
            dst = os.path.join(元.OUT_DIR, "aoi_%02d.png" % n)
            if os.path.exists(src) and not os.path.exists(dst):
                shutil.copyfile(src, dst)
                作れた += 1
                print("   保存: aoi_%02d.png" % n)

    合計 = len([f for f in os.listdir(元.OUT_DIR) if f.startswith("aoi_") and f.endswith(".png")])
    print("\n%d 枚を足しました。いま合計 %d 枚です。" % (作れた, 合計))
    if 合計 < 30:
        print("30日運用にはあと %d 枚必要です。" % (30 - 合計))
    return 0


if __name__ == "__main__":
    sys.exit(main())
