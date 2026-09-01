#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""あおいの「数字の比較」を、縦型9:16の動く動画にする。

なぜ作り直したか
  これまでの make_reel.py は「写真をゆっくり拡大するだけ」で、
  検証済み原則の『宣伝動画は静止画＋簡易描画では不可・動く高品質が必要』
  に反していた。止まっている絵はスワイプで飛ばされる。

この道具が作るもの
  ・音声（VOICEVOX）を先に作り、その長さに合わせて映像を組む
    （映像に合わせて喋らせると、必ずどこかで間が合わなくなるため）
  ・写真が大きい状態から小さく移動し、そこへ1社ずつカードが飛び込む
  ・順位・金額はスケールと位置が動く。数字は最後まで出したまま残す
  ・出典・確認日・AI明示・広告明示は常に画面内に置く（法令上、消せない）

書く数字はどこから来るか
  affiliate/data/aoi_sim_compare.json だけ。★手で打ち込まない。

使い方
  python3 比較リールを作る.py --一覧      … 作れる型を見る
  python3 比較リールを作る.py --型 月額    … 1本作る
  python3 比較リールを作る.py             … 全部の型を作る
  python3 比較リールを作る.py --音声なし   … 声を使わずに作る（確認用）
"""
import os
import re
import io
import sys
import json
import math
import wave
import shutil
import argparse
import subprocess
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageFont, ImageFilter

from isolation_guard import 素材フォルダを検査する, 画像が健全側のものか確かめる
import link_builder as 誘導
import 投稿画像を作る as 型元

ここ = os.path.dirname(os.path.abspath(__file__))
リポジトリ = os.path.dirname(ここ)
データ = os.path.join(リポジトリ, "affiliate", "data", "aoi_sim_compare.json")
人物設定 = os.path.join(ここ, "persona.json")
写真フォルダ = os.path.join(ここ, "output")
出力先 = os.path.join(ここ, "reels")

W, H = 1080, 1920
FPS = 30

# ★安全枠（セーフエリア）
#   Instagramリール・TikTokは、画面の下と右をアプリのボタンや説明文が覆う。
#   出典・AI明示・広告明示がそこに入ると「表示していない」のと同じになるため、
#   中身は必ずこの枠の内側に置く。
安全上 = 240        # これより上はアプリの表示に食われることがある
安全下 = 1470       # これより下は説明文・音源名・ボタンに隠れる
注記上 = 1310       # 出典・AI明示・広告明示を置く高さ（安全枠の内側）
表の下 = 注記上 - 40  # カードはここまで
左端 = 90
右端 = W - 150      # 右のボタン列（いいね・コメント）に数字が重ならない位置
中央 = (左端 + 右端) // 2

書体 = "/System/Library/Fonts/ヒラギノ角ゴシック W%d.ttc"

背景 = (253, 251, 247)
文字 = (51, 48, 44)
薄字 = (125, 117, 104)
差し色 = (201, 138, 94)
枠線 = (231, 224, 212)
白 = (255, 255, 255)

# 声。VOICEVOX の利用にはキャラクター名の表示（クレジット）が必要なので、
# 動画の最後と投稿文の両方に必ず出す。
声のURL = "http://127.0.0.1:50021"
声のID = 8
声の名前 = "春日部つむぎ"

# 会社名は英字のままだと読み上げが崩れるので、読みだけ差し替える。
# ★表示は英字のまま。読みを変えるだけで、数字や社名そのものは変えない。
読み = {
    "povo 2.0": "ポヴォ",
    "IIJmio": "アイアイジェイミオ",
    "LIBMO（リブモ）": "リブモ",
    "LINEMO": "ラインモ",
    "ahamo": "アハモ",
    "mineo（マイネオ）": "マイネオ",
    "楽天モバイル": "楽天モバイル",
    "ワイモバイル": "ワイモバイル",
}


# ────────────────────────────── 文字まわり

def 字(太さ, 大きさ):
    return ImageFont.truetype(書体 % 太さ, 大きさ)


def 幅(d, s, f):
    l, t, r, b = d.textbbox((0, 0), s, font=f)
    return r - l


def 収める(d, s, 太さ, 大きさ, 上限):
    f = 字(太さ, 大きさ)
    while 大きさ > 16 and 幅(d, s, f) > 上限:
        大きさ -= 2
        f = 字(太さ, 大きさ)
    return f


def なめらか(t):
    """0→1を、最初速く最後ゆっくりに。機械的な等速は安っぽく見える。"""
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def はねる(t):
    """0→1を、少し行き過ぎてから戻る動き。数字が出る瞬間に使う。"""
    t = max(0.0, min(1.0, t))
    return 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2


# ────────────────────────────── 読み上げ文

def 値の読み(値):
    """『22円/30秒』→『30秒あたり22円』、『850円〜3,900円』→『850円から』。"""
    v = 値.strip()
    if "/" in v or "／" in v:
        前後 = [x.strip() for x in re.split(r"[／/]", v, maxsplit=1)]
        # 『22円/30秒』のように後ろが単位だけのときだけ「30秒あたり22円」と読む。
        # 『Aプラン 1,210円 / Bプラン 550円』は別プランの併記なので、
        # つなげて読むと意味が壊れる。先頭だけ読む。
        if re.fullmatch(r"\d+\s*(秒|分)", 前後[1]):
            結果 = "%sあたり%s" % (前後[1], 前後[0])
        else:
            結果 = 前後[0]
    elif "〜" in v:
        結果 = v.split("〜")[0].strip() + "から"
    else:
        結果 = v
    # ★どの分かれ道を通っても、記号はそのまま読ませない（無音になる）。
    return 結果.replace("＋", "プラス").replace("+", "プラス")


def 台本を作る(型名, 中身, checked):
    """喋る文。★体験のふり（使った・乗り換えた）は書かない。"""
    y, m, d = (int(x) for x in checked.split("-"))
    行 = 中身["行"]
    # ★冒頭で長く説明しない。最初の3秒で1位が出てこない動画は飛ばされる。
    導入 = "%d月%d日時点の公式料金です。" % (m, d)
    if 中身.get("上位だけ"):
        導入 += "安い順に3社。"      # ★全社ではないことを声でも言う
    台本 = [
        ("フック", 中身["読み上げ見出し"]),
        ("導入", 導入),
    ]
    # 順位は画面の丸数字で分かるので、声では読まない（そのぶん速く進む）。
    for i, (社, 値) in enumerate(行, 1):
        台本.append(("社%d" % i, "%s、%s。" % (読み.get(社, 社), 値の読み(値))))
    台本.append(("締め", "くわしい条件はプロフィールのリンクに。"
                     "あおいはAIキャラクター、アフィリエイト広告を含みます。"))
    return 台本


# ────────────────────────────── 音声

def 喋らせる(文):
    q = urllib.request.Request(
        "%s/audio_query?text=%s&speaker=%d"
        % (声のURL, urllib.parse.quote(文), 声のID), method="POST")
    with urllib.request.urlopen(q, timeout=60) as r:
        設定 = json.load(r)
    設定["speedScale"] = 1.28      # 少し速いほうが最後まで見てもらえる
    設定["prePhonemeLength"] = 0.02
    設定["postPhonemeLength"] = 0.08
    s = urllib.request.Request(
        "%s/synthesis?speaker=%d" % (声のURL, 声のID),
        data=json.dumps(設定).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(s, timeout=120) as r:
        return r.read()


def 音声をつなぐ(音の一覧, 間, 保存先):
    """wavを、指定した間（秒）を空けて1本につなぐ。長さも返す。"""
    元 = [wave.open(io.BytesIO(b), "rb") for b in 音の一覧]
    ch, 幅b, rate = 元[0].getnchannels(), 元[0].getsampwidth(), 元[0].getframerate()
    出 = wave.open(保存先, "wb")
    出.setnchannels(ch)
    出.setsampwidth(幅b)
    出.setframerate(rate)
    区切り = []
    今 = 0.0
    for w, あき in zip(元, 間):
        中身 = w.readframes(w.getnframes())
        長さ = w.getnframes() / rate
        出.writeframes(中身)
        無音 = b"\x00" * int(rate * あき) * ch * 幅b
        出.writeframes(無音)
        区切り.append((今, 今 + 長さ + あき))
        今 += 長さ + あき
    出.close()
    return 区切り, 今


# ────────────────────────────── 絵

def 丸角(img, r):
    面 = Image.new("L", img.size, 0)
    ImageDraw.Draw(面).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1],
                                        radius=r, fill=255)
    out = img.convert("RGBA")
    out.putalpha(面)
    return out


def 写真を読む(番号=1):
    安全 = 素材フォルダを検査する(写真フォルダ, "比較リールづくり")
    候補 = sorted(f for f in os.listdir(安全)
                if f.startswith("aoi_") and f.endswith(".png"))
    if not 候補:
        return None
    選ぶ = 候補[(番号 - 1) % len(候補)]
    パス = os.path.join(安全, 選ぶ)
    画像が健全側のものか確かめる([パス], "比較リールづくり")
    return Image.open(パス).convert("RGB")


def 埋める(img, w, h):
    iw, ih = img.size
    倍 = max(w / iw, h / ih)
    nw, nh = int(iw * 倍 + 0.5), int(ih * 倍 + 0.5)
    img = img.resize((nw, nh), Image.LANCZOS)
    x = (nw - w) // 2
    y = int((nh - h) * 0.35)      # 顔が切れないよう、やや上寄りで切る
    return img.crop((x, y, x + w, y + h))


class 描き手:
    """1コマぶんの絵を作る。時間 t（秒）を渡すと画像が返る。"""

    def __init__(self, 中身, checked, 写真, 区切り, 全長):
        self.中身 = 中身
        self.checked = checked
        self.区切り 	= 区切り
        self.全長 = 全長
        self.行 = 中身["行"]

        # 写真は「大きい状態」と「小さい状態」を先に作っておく（毎コマ作ると遅い）
        self.大写真 = 丸角(埋める(写真, 780, 780), 56) if 写真 else None
        self.小写真 = 丸角(埋める(写真, 200, 200), 100) if 写真 else None

        仮 = ImageDraw.Draw(Image.new("RGB", (10, 10)))
        self.f見出し = 収める(仮, 中身["見出し"], 7, 92, 右端 - 左端)
        self.f副題 = 収める(仮, 中身["副題"], 4, 40, 右端 - 左端)
        # 本編で見出しの下に小さく置くときの大きさ（右にはみ出さないように）
        self.f小副題 = 収める(仮, 中身["副題"], 4, 32, 右端 - 330)
        self.f帯 = 字(5, 34)
        self.f順 = 字(7, 44)
        self.f注 = 字(3, 30)

        # カードの高さは「行数」から決める。★安全枠からはみ出させない。
        self.カード上 = 560
        使える = 表の下 - self.カード上
        n = len(self.行)
        self.あき = 20
        self.高 = max(120, min(230, (使える - self.あき * (n - 1)) // n))

        社幅 = 400
        self.値の行 = [型元.値を分ける(v) for _, v in self.行]
        self.f社 = 字(6, min(収める(仮, s, 6, 54, 社幅).size for s, _ in self.行))
        最多 = max(len(組) for 組 in self.値の行)

        # ★会社名と数字を横に並べるか、上下に分けるかを、実際の幅で決める。
        #   横に並べたまま入りきらないと、文字どうしが重なって読めなくなる。
        横の値幅 = (右端 - 左端) - 170 - 社幅 - 40
        横の値大 = min(収める(仮, s, 7, 68, 横の値幅).size
                   for 組 in self.値の行 for s in 組)
        入りきる = all(幅(仮, s, 字(7, 横の値大)) <= 横の値幅
                    for 組 in self.値の行 for s in 組)
        self.縦積み = (最多 > 1) or (not 入りきる) or (横の値大 < 30)

        if self.縦積み:
            # 会社名が上、数字が下。カードの幅をまるごと数字に使える。
            値幅 = (右端 - 左端) - 170 - 40
            余り = self.高 - 30 - int(self.f社.size * 1.25)
        else:
            値幅 = 横の値幅
            余り 	= self.高 - 30
        値大 = min(収める(仮, s, 7, 68, 値幅).size
                 for 組 in self.値の行 for s in 組)
        self.f値 = 字(7, max(20, min(値大, int(余り / (1.3 * 最多)))))

    # ---- どの場面か

    def 場面(self, t):
        for i, (始, 終) in enumerate(self.区切り):
            if t < 終:
                return i, (t - 始)
        return len(self.区切り) - 1, t - self.区切り[-1][0]

    def 進み(self, i, t):
        """区切り i が始まってからの経過秒。"""
        return t - self.区切り[i][0]

    # ---- 部品

    def 写真を置く(self, 台, t):
        if not self.大写真:
            return
        導入終 = self.区切り[1][1]
        締め始 = self.区切り[-1][0]

        if t < 導入終:
            p = なめらか(min(1.0, t / 0.7))
            大きさ = int(780 * (0.86 + 0.14 * p))
            x = 中央 - 大きさ // 2
            y = int(320 - 30 * p)
            絵 = self.大写真.resize((大きさ, 大きさ), Image.LANCZOS)
            台.alpha_composite(絵, (x, y))
            return

        if t >= 締め始:
            p = なめらか(min(1.0, (t - 締め始) / 0.6))
            大きさ = int(200 + 400 * p)
            x = int(中央 - 大きさ / 2)
            y = int(230 + (330 - 230) * p)
            絵 = self.大写真.resize((大きさ, 大きさ), Image.LANCZOS)
            台.alpha_composite(絵, (x, y))
            return

        # 大 → 小へ移動する途中
        p = なめらか(min(1.0, (t - 導入終) / 0.55))
        大きさ = int(780 + (200 - 780) * p)
        x = int((中央 - 390) + (左端 - (中央 - 390)) * p)
        y = int(290 + (230 - 290) * p)
        元 = self.大写真 if 大きさ > 320 else self.小写真
        台.alpha_composite(元.resize((大きさ, 大きさ), Image.LANCZOS), (x, y))

    def 見出しを置く(self, d, 台, t):
        導入終 = self.区切り[1][1]
        if t < 導入終:
            p = はねる(min(1.0, t / 0.5))
            大きさ = max(10, int(self.f見出し.size * (0.6 + 0.4 * p)))
            f = 字(7, 大きさ)
            s = self.中身["見出し"]
            d.text((中央 - 幅(d, s, f) / 2, 1120 + (1 - p) * 40), s, font=f, fill=文字)
            f2 = self.f副題
            透 = int(255 * なめらか(max(0.0, (t - 0.45) / 0.5)))
            d.text((中央 - 幅(d, self.中身["副題"], f2) / 2, 1120 + 大きさ * 1.35),
                   self.中身["副題"], font=f2, fill=薄字 + (透,))
            return

        # 本編：左上に小さく残す
        p = なめらか(min(1.0, (t - 導入終) / 0.55))
        f = 字(7, int(self.f見出し.size * (1 - 0.42 * p)))
        x = (中央 - 幅(d, self.中身["見出し"], f) / 2) * (1 - p) + 330 * p
        y = 1120 + (250 - 1120) * p
        d.text((x, y), self.中身["見出し"], font=f, fill=文字)
        # ★副題は見出しが小さくなりきってから出す（重なって読めなくなるため）
        if p > 0.92:
            透2 = int(255 * min(1.0, (p - 0.92) / 0.08))
            d.text((330, 250 + f.size * 1.3), self.中身["副題"],
                   font=self.f小副題, fill=薄字 + (透2,))

    def カードを置く(self, d, t):
        頭 = 2                      # 区切りの何番目から会社が始まるか
        上 = self.カード上
        高 = self.高
        あき = self.あき
        for i, ((社, _), 値組) in enumerate(zip(self.行, self.値の行)):
            始 = self.区切り[頭 + i][0]
            if t < 始:
                continue
            経過 = t - 始
            p = なめらか(min(1.0, 経過 / 0.45))
            y = 上 + (高 + あき) * i
            ずれ = int((1 - p) * 260)
            透 = int(255 * p)
            if 透 <= 0:
                continue

            箱 = [左端 + ずれ, y, 右端 + ずれ, y + 高]
            d.rounded_rectangle(箱, radius=34,
                                fill=白 + (透,), outline=枠線 + (透,), width=3)
            中 = y + 高 // 2

            r = min(40, 高 // 4)
            cx = 左端 + ずれ + 88
            d.ellipse([cx - r, 中 - r, cx + r, 中 + r],
                      fill=(差し色 if i == 0 else (240, 236, 227)) + (透,))
            n = str(i + 1)
            d.text((cx - 幅(d, n, self.f順) / 2, 中 - self.f順.size * 0.62), n,
                   font=self.f順, fill=(白 if i == 0 else 薄字) + (透,))

            # 縦積みのときは会社名を上半分、横並びのときは真ん中に置く
            社の高 = ((y + 高 * 0.30 - self.f社.size * 0.62) if self.縦積み
                   else (中 - self.f社.size * 0.62))
            d.text((左端 + ずれ + 160, 社の高), 社, font=self.f社, fill=文字 + (透,))

            # 数字は少し遅れて、はねながら出す
            q = はねる(min(1.0, max(0.0, (経過 - 0.18) / 0.5)))
            透2 = int(255 * min(1.0, max(0.0, (経過 - 0.18) / 0.35)))
            f = 字(7, max(10, int(self.f値.size * (0.75 + 0.25 * q))))
            行間 = int(f.size * 1.3)
            軸 = (y + 高 * 0.68) if self.縦積み else 中
            上端 = 軸 - f.size * 0.62 - 行間 * (len(値組) - 1) / 2
            for j, 文 in enumerate(値組):
                w = 幅(d, 文, f)
                d.text((右端 + ずれ - 40 - w, 上端 + 行間 * j), 文,
                       font=f, fill=差し色 + (透2,))

    def 締めを置く(self, d, t):
        始 = self.区切り[-1][0]
        if t < 始:
            return
        p = なめらか(min(1.0, (t - 始) / 0.5))
        d.rectangle([0, 0, W, H], fill=背景 + (int(255 * p),))

    def 締めの文字(self, d, t):
        始 = self.区切り[-1][0]
        if t < 始 + 0.35:
            return
        p = なめらか(min(1.0, (t - 始 - 0.35) / 0.5))
        透 = int(255 * p)
        f = 字(7, 62)
        s1 = "くわしい条件は"
        s2 = "プロフィールのリンクから"
        d.text((中央 - 幅(d, s1, f) / 2, 1010 + (1 - p) * 30), s1,
               font=f, fill=文字 + (透,))
        d.text((中央 - 幅(d, s2, f) / 2, 1010 + f.size * 1.3 + (1 - p) * 30), s2,
               font=f, fill=差し色 + (透,))

    def 帯と注記(self, d, t):
        # 上の帯（誰が言っているか）
        d.text((左端, 130), "あおいの通信費ノート", font=self.f帯, fill=差し色)

        # 進み具合のバー。あと少しで終わると分かると、最後まで見てもらえる。
        w = int((右端 - 左端) * min(1.0, t / self.全長))
        d.rounded_rectangle([左端, 190, 右端, 198], radius=4, fill=枠線)
        if w > 8:
            d.rounded_rectangle([左端, 190, 左端 + w, 198], radius=4, fill=差し色)

        # ★出典・確認日・AI明示・広告明示は最初から最後まで出したままにする。
        #   途中だけ出す作りにすると、切り抜き・停止表示で消えてしまうため。
        # ★画面のいちばん下ではなく安全枠の内側に置く。
        #   リールは下側をアプリの説明文とボタンが覆うので、下に置くと隠れてしまう。
        y = 注記上
        d.text((左端, y), "各社公式サイトで %s 確認／税込・通常価格" % self.checked,
               font=self.f注, fill=薄字)
        d.text((左端, y + 44),
               "あおいはAIで作られたキャラクターです／アフィリエイト広告を含みます",
               font=self.f注, fill=薄字)
        d.text((左端, y + 88), "音声: VOICEVOX:%s" % 声の名前,
               font=字(3, 26), fill=薄字)

    # ---- 1コマ

    def コマ(self, t):
        台 = Image.new("RGBA", (W, H), 背景 + (255,))
        d = ImageDraw.Draw(台, "RGBA")
        self.帯と注記(d, t)
        self.カードを置く(d, t)
        self.写真を置く(台, t)
        d = ImageDraw.Draw(台, "RGBA")
        self.見出しを置く(d, 台, t)
        self.締めを置く(d, t)
        self.写真を置く(台, t) if t >= self.区切り[-1][0] else None
        d = ImageDraw.Draw(台, "RGBA")
        self.締めの文字(d, t)
        if t >= self.区切り[-1][0]:
            self.帯と注記(d, t)
        return 台.convert("RGB")


# ────────────────────────────── 組み立て

def 一本作る(型名, 中身, checked, 写真番号, 音を使う, 保存先):
    台本 = 台本を作る(型名, 中身, checked)

    音の一覧, 間 = [], []
    if 音を使う:
        for 名, 文 in 台本:
            音の一覧.append(喋らせる(文))
            間.append(0.45 if 名 == "フック" else (0.12 if 名.startswith("社") else 0.25))
        音パス = os.path.join(保存先, "_%s.wav" % 型名)
        区切り, 全長 = 音声をつなぐ(音の一覧, 間, 音パス)
        全長 += 1.1                      # 締めの余韻
        区切り[-1] = (区切り[-1][0], 全長)
    else:
        音パス = None
        長さ = {"フック": 2.2, "導入": 2.6}
        区切り, 今 = [], 0.0
        for 名, 文 in 台本:
            d = 長さ.get(名, 3.4 if 名 == "締め" else 2.0)
            区切り.append((今, 今 + d))
            今 += d
        全長 = 今

    写真 = 写真を読む(写真番号)
    描く = 描き手(中身, checked, 写真, 区切り, 全長)

    総コマ = int(全長 * FPS)
    出力 = os.path.join(保存先, "aoi_%s_reel.mp4" % 型名)
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H),
           "-framerate", str(FPS), "-i", "-"]
    if 音パス:
        cmd += ["-i", 音パス]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "19",
            "-pix_fmt", "yuv420p", "-r", str(FPS), "-movflags", "+faststart"]
    if 音パス:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
    cmd += [出力]

    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in range(総コマ):
        p.stdin.write(描く.コマ(f / FPS).tobytes())
        if f % 90 == 0:
            print("    %d%%" % int(100 * f / 総コマ), end="\r", flush=True)
    p.stdin.close()
    p.wait()
    if 音パス and os.path.exists(音パス):
        os.remove(音パス)
    return 出力 if p.returncode == 0 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--型", default="", help="月額 / 通話料 / 初期費用 / かけ放題")
    ap.add_argument("--一覧", action="store_true")
    ap.add_argument("--音声なし", action="store_true", help="声を使わずに作る")
    args = ap.parse_args()

    本体 = json.load(open(データ, encoding="utf-8"))
    checked = 本体["checked_at"]
    型 = 型元.型を作る(本体)

    # 読み上げ用の見出し（画面の見出しは短く、声はもう少し自然に）
    読み上げ = {
        "月額": "スマホ代、会社でこんなに違います。",
        "通話料": "通話料は、会社で2倍ちがいます。",
        "初期費用": "契約するとき、いくらかかると思いますか。",
        "かけ放題": "通話オプション、月にいくらか知っていますか。",
    }
    for k in 型:
        型[k]["読み上げ見出し"] = 読み上げ.get(k, 型[k]["見出し"])
        # ★値が長い型は上位3社だけにする。
        #   5社ぜんぶ載せると1枚あたりが薄くなり、スマホでは数字が読めない。
        #   （消したのではなく「上位3社」と画面と声の両方で言う）
        if any(len(型元.値を分ける(v)) > 1 for _, v in 型[k]["行"]):
            型[k]["行"] = 型[k]["行"][:3]
            型[k]["上位だけ"] = True
            型[k]["副題"] = 型[k]["副題"] + "／安い順に3社"

    if args.一覧:
        print("\n作れる動画:")
        for k, v in 型.items():
            print("  %-6s %s（%d社・約%d秒）" % (k, v["見出し"], len(v["行"]),
                                        8 + len(v["行"]) * 3))
        print()
        return 0

    if args.型 and args.型 not in 型:
        raise SystemExit("そんな型はありません。使える型: %s" % "、".join(型))
    対象 = {args.型: 型[args.型]} if args.型 else 型

    if not args.音声なし:
        try:
            urllib.request.urlopen(声のURL + "/version", timeout=3).read()
        except Exception:
            raise SystemExit(
                "\n【中止】VOICEVOX が動いていません。\n"
                "  アプリ VOICEVOX を起動してから、もう一度実行してください。\n"
                "  声なしで作りたい場合は --音声なし を付けてください。\n")

    os.makedirs(出力先, exist_ok=True)
    作った = []
    for i, (名, 中身) in enumerate(対象.items(), 1):
        print("\n[%d/%d] %s の動画を作ります..." % (i, len(対象), 名))
        パス = 一本作る(名, 中身, checked, i, not args.音声なし, 出力先)
        if パス:
            作った.append(パス)
            print("    完成: %s" % os.path.basename(パス))
        else:
            print("    作れませんでした。")

    print("\n%d 本できました（%s）" % (len(作った), 出力先))
    print("数字は比較データ（各社公式・%s確認）からそのまま取っています。" % checked)
    print("画面には出典・確認日・AI明示・広告明示が最初から最後まで出ています。\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
