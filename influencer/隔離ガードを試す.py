"""
隔離ガードが本当に効くかを、わざと破って確かめる。

歯止めは「入れた」だけでは信用できない。実際に成人向けフォルダを
指定してみて、止まることを目で確認するために置いてある。

使い方: python3 隔離ガードを試す.py
"""

import os

from isolation_guard import (隔離違反, 素材フォルダを検査する,
                            画像が健全側のものか確かめる)

HERE = os.path.dirname(os.path.abspath(__file__))

# (説明, 渡すパス, 止まるべきか)
試すこと = [
    ("成人向け写真集フォルダを直接指定",
     "../ai-influencer/output_photobook", True),
    ("写真集の中の1冊を指定",
     "../ai-influencer/output_photobook/20260817_214233", True),
    ("FANZA提出パックを指定",
     "../ai-influencer/output_photobook/20260817_214233/_pack", True),
    ("モザイク済みフォルダらしき名前",
     os.path.join(HERE, "censored"), True),
    ("成人向け工房フォルダそのもの",
     "../ai-influencer", True),
    ("健全側の外（デスクトップ等）",
     "~/Desktop", True),
    ("上位へ登ってから戻る書き方",
     os.path.join(HERE, "..", "ai-influencer", "output_photobook"), True),
    ("★正しい使い方：あおいの写真フォルダ",
     os.path.join(HERE, "output"), False),
    ("★正しい使い方：ひなたの写真フォルダ",
     os.path.join(HERE, "output_hinata"), False),
]


def main():
    print("\n══════ 隔離ガードの確認（わざと破ってみる） ══════\n")
    合格 = 0
    for 説明, パス, 止まるべき in 試すこと:
        try:
            素材フォルダを検査する(パス, "確認")
            止まった = False
        except 隔離違反:
            止まった = True

        よい = (止まった == 止まるべき)
        合格 += 1 if よい else 0
        print("  [%s] %s" % ("合格" if よい else "★不合格", 説明))
        print("         → %s（期待: %s）"
              % ("止まった" if 止まった else "通した",
                 "止まる" if 止まるべき else "通す"))

    # 二重の歯止め：フォルダを通しても、1枚ずつの検査で外の画像を弾けるか
    print("\n  ── 二重の歯止め（画像1枚ずつの検査） ──")
    外の画像 = ["../ai-influencer/output_photobook/20260817_214233/001.png"]
    try:
        画像が健全側のものか確かめる(外の画像, "確認")
        止まった = False
    except 隔離違反:
        止まった = True
    よい = 止まった
    合格 += 1 if よい else 0
    print("  [%s] 成人向けの画像ファイルを1枚だけ紛れ込ませる → %s"
          % ("合格" if よい else "★不合格", "止まった" if 止まった else "通した"))

    総数 = len(試すこと) + 1
    print("\n  結果: %d/%d 合格\n" % (合格, 総数))
    if 合格 != 総数:
        raise SystemExit("★歯止めが効いていない箇所がある。直すまで投稿に使わないこと。")
    print("  ★成人向け素材は、どの経路からも健全な投稿へ入れられない。\n")


if __name__ == "__main__":
    main()
