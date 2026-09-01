#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
あおいLoRA の「学習用の顔」を作る（insightface を一切使わない）

■ なぜこれが要るのか
  いまの写真は IPAdapter FaceID で顔を転写している。FaceID は中で
  InsightFace（buffalo_l）を呼ぶが、InsightFace は公式に
  「全モデルは非商用の研究目的のみ」と書かれている。
  アフィリエイト広告＝商用なので、このままでは使えない。

  そこで「あおい専用のLoRA」を作って顔を固定する方式に替える。
  LoRAができれば、以後の生成に insightface は要らなくなる。

■ ここで作るもの
  LoRA を学習させるための「同じ顔の画像 20枚前後」。
  （枚数は多ければ良いものではない。20枚前後で質を揃えるのが定石）
  ★この画像を作る工程にも insightface を混ぜてはいけない。
    混ぜると「非商用モデルで作った素材で学習したLoRA」になってしまい、
    せっかく差し替えた意味が無くなる。

■ どうやって同じ顔を揃えるか（2段構え）
  1段目: character.json の seed と顔の指示文だけで基準顔を1枚作る。
         ここは KSampler だけなので insightface は関与しない。
         ★あおいの顔は seed 778899123 に保存されているので、
           何度でもまったく同じ顔を作り直せる。
  2段目: その1枚を img2img で描き直して、角度・表情・光・服・背景を変える。
         変化の強さ（denoise）は 0.35/0.45/0.55 の3段階を混ぜる。
         弱いと顔は保てるが服や背景も変わらず、強いとその逆になるため。
         ここも insightface は関与しない。

使い方:
    python3 学習用の顔を作る.py --下見     # 何を作るか見るだけ（生成しない）
    python3 学習用の顔を作る.py            # 基準顔＋21枚を作る
    python3 学習用の顔を作る.py --枚数 20
    python3 学習用の顔を作る.py --基準顔だけ
"""
import os
import sys
import json
import time
import uuid
import shutil
import argparse

import generate as 元
import isolation_guard as 隔離

ここ = os.path.dirname(os.path.abspath(__file__))
学習用 = os.path.join(ここ, "lora_dataset")
基準顔ファイル = "aoi_base_for_lora.png"   # ComfyUI/input/ に置く名前

# ComfyUI の input フォルダ（img2img の読み込み元）
COMFY_IN = os.path.join(ここ, "ComfyUI", "input")

# 学習用は正方形のほうが扱いやすい（SDXLの標準は1024）
辺 = 1024

# ★img2img の「変化の強さ」（denoise）。ここに悩ましい板挟みがある。
#   低くする → 顔は変わらない。でも服・背景も元のまま変わらない。
#   高くする → 服・背景は変わる。でも顔まで変わって別人になりうる。
#   どちらか一方に決め打ちできないので、3段階を混ぜて作る。
#   出来上がりのファイル名に強さを入れておくので、
#   「どれが顔を保てたか」を目で見て選べる。
変化の強さ一覧 = [0.35, 0.45, 0.55]

# ══════════════════════════════════════════ 学習用の「変化」
#
# LoRA は「同じ人が、いろんな角度・表情・光で写っている」ほど
# よく覚える。逆に全部同じ構図だと、その構図ごと覚えてしまう。
#
# ★服と背景は「わざとバラす」。ここが分かりにくいので理由を書く。
#   LoRAは「毎回おなじもの」を人物の特徴だと思って一緒に覚えてしまう。
#   30枚すべて白いセーター・同じ部屋だと、あおいの顔だけでなく
#   「白いセーターと同じ部屋」まで焼き付き、あとから服や場所を
#   変えられないLoRAになる。だから服・背景は毎回変える。
#   （逆に、変えてはいけないのは顔だけ）
#
# ★露出・下着・水着などの語は1つも入れない（健全側の事業のため）。

変化の型 = [
    ("正面・微笑み",       "front view, looking at camera, soft gentle smile"),
    ("正面・真顔",         "front view, looking at camera, neutral calm expression"),
    ("正面・笑顔",         "front view, looking at camera, bright natural smile"),
    ("やや右向き",         "head turned slightly to the right, looking at camera"),
    ("やや左向き",         "head turned slightly to the left, looking at camera"),
    ("横顔ぎみ・右",       "three-quarter view from the right, calm expression"),
    ("横顔ぎみ・左",       "three-quarter view from the left, calm expression"),
    ("少し見上げる",       "chin slightly raised, looking at camera"),
    ("少し見下ろす",       "chin slightly lowered, looking at camera, thoughtful"),
    ("目線を外す",         "looking away from camera, soft expression"),
    ("柔らかい自然光",     "soft natural window light, even lighting on face"),
    ("曇りの日の光",       "overcast diffused daylight, flat soft lighting"),
    ("夕方の光",           "warm late afternoon light, gentle shadows on face"),
    ("室内の明かり",       "warm indoor lighting, soft shadows"),
    ("明るい屋外",         "bright outdoor daylight, clear detail on face"),
    ("口を少し開けて",     "lips slightly parted, relaxed natural expression"),
    ("目を細めて笑う",     "eyes slightly narrowed, warm laughing expression"),
    ("落ち着いた表情",     "composed serene expression, relaxed mouth"),
    ("髪を耳にかけた",     "hair tucked behind one ear, face clearly visible"),
    ("前髪が少し乱れた",   "slightly tousled bangs, natural everyday look"),
]

# 顔をしっかり覚えさせるため、寄り方も変える
寄り方 = [
    ("顔のアップ",   "close-up portrait of her face, head and shoulders"),
    ("胸から上",     "portrait, head and upper chest visible"),
    ("上半身",       "upper body portrait, waist-up"),
]

# ★服。毎回変える（変えないと服まで顔の一部として覚えてしまう）。
#   ふだん着だけ。肌の露出を示す語は入れない。
服 = [
    "wearing a white knit sweater",
    "wearing a light blue denim shirt",
    "wearing a beige cardigan over a white tee",
    "wearing a grey hoodie",
    "wearing a navy blouse",
    "wearing a black turtleneck",
    "wearing a checked flannel shirt",
    "wearing a simple olive jacket",
]

# ★背景。これも毎回変える。
背景 = [
    "plain light grey studio background",
    "in a bright cafe, blurred background",
    "in a room by a window, soft blurred interior",
    "outdoors on a quiet street, blurred background",
    "in a park with green trees blurred behind",
    "plain white wall background",
    "in a bookshop, blurred shelves behind",
    "outdoors at dusk, blurred city lights behind",
]


def 顔を読む():
    if not os.path.exists(元.CHAR_PATH):
        sys.exit("character.json が見つかりません: %s" % 元.CHAR_PATH)
    return json.load(open(元.CHAR_PATH, encoding="utf-8"))


def insightfaceが混ざっていないか確かめる(wf):
    """★歯止め。作業手順に非商用モデルが1つでも入っていたら止める。

    ここを通さずに画像を作ると、LoRAへ替える意味が無くなる。"""
    危ない = ("faceid", "insightface", "instantid", "pulid", "arcface",
            "antelope", "buffalo")
    for 番号, 節 in wf.items():
        名 = str(節.get("class_type", "")).lower()
        if any(w in 名 for w in 危ない):
            sys.exit(
                "★止めました。作業手順に『%s』が入っています。\n"
                "  これは非商用のモデルを呼ぶ部品です。\n"
                "  LoRA用の画像にこれが混ざると、商用に使えないLoRAに\n"
                "  なってしまうため、生成しません。" % 節.get("class_type"))
    return wf


def 基準顔の手順(顔):
    """1段目。seed と顔の指示文だけで作る。insightface は関与しない。"""
    positive = "%s, %s, %s" % (
        顔["base_face"], 変化の型[0][1] + ", " + 寄り方[0][1], 顔["quality"])
    wf = {
        "4": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": 元.CHECKPOINT}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": 辺, "height": 辺, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode",
              "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode",
              "inputs": {"text": 顔["negative"], "clip": ["4", 1]}},
        "3": {"class_type": "KSampler",
              "inputs": {"seed": int(顔["seed"]), "steps": 元.STEPS,
                         "cfg": 元.CFG, "sampler_name": 元.SAMPLER,
                         "scheduler": 元.SCHEDULER, "denoise": 1.0,
                         "model": ["4", 0], "positive": ["6", 0],
                         "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode",
              "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": "aoi_base"}},
    }
    return insightfaceが混ざっていないか確かめる(wf)


def 変化の手順(顔, 説明, seed, 強さ):
    """2段目。基準顔を少しだけ描き直す。insightface は関与しない。"""
    positive = "%s, %s, %s" % (顔["base_face"], 説明, 顔["quality"])
    wf = {
        "4": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": 元.CHECKPOINT}},
        "10": {"class_type": "LoadImage",
               "inputs": {"image": 基準顔ファイル}},
        "11": {"class_type": "VAEEncode",
               "inputs": {"pixels": ["10", 0], "vae": ["4", 2]}},
        "6": {"class_type": "CLIPTextEncode",
              "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode",
              "inputs": {"text": 顔["negative"], "clip": ["4", 1]}},
        "3": {"class_type": "KSampler",
              "inputs": {"seed": seed, "steps": 元.STEPS, "cfg": 元.CFG,
                         "sampler_name": 元.SAMPLER,
                         "scheduler": 元.SCHEDULER,
                         "denoise": 強さ,
                         "model": ["4", 0], "positive": ["6", 0],
                         "negative": ["7", 0], "latent_image": ["11", 0]}},
        "8": {"class_type": "VAEDecode",
              "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": "aoi_lora"}},
    }
    return insightfaceが混ざっていないか確かめる(wf)


def 組み合わせを作る(枚数):
    """変化の型 × 寄り方 × 服 × 背景 を混ぜて、指定枚数ぶんの指示を作る。

    ★服と背景は、わざと毎回ちがう組み合わせにする。
      同じものが続くと、それを人物の特徴として覚えてしまうため。
      ずらす数（7と5）は、枚数と割り切れないように選んでいる。"""
    組 = []
    for i in range(枚数):
        名, 説明 = 変化の型[i % len(変化の型)]
        寄り名, 寄り = 寄り方[(i // len(変化の型)) % len(寄り方)]
        着 = 服[(i * 7) % len(服)]
        景 = 背景[(i * 5) % len(背景)]
        組.append(("%s／%s" % (名, 寄り名),
                  "%s, %s, %s, %s" % (説明, 寄り, 着, 景)))
    return 組


def 一枚作る(wf, 保存先, client_id):
    pid = 元.queue_prompt(wf, client_id)["prompt_id"]
    画像 = 元.wait_result(pid, max_wait=1800)
    if not 画像:
        return False
    img = 画像[0]
    src = os.path.join(元.COMFY_OUT, img.get("subfolder", ""), img["filename"])
    if not os.path.exists(src):
        return False
    shutil.copy(src, 保存先)
    return True


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--枚数", type=int, default=21)
    p.add_argument("--下見", action="store_true")
    p.add_argument("--基準顔だけ", action="store_true")
    args = p.parse_args()

    顔 = 顔を読む()
    組 = 組み合わせを作る(args.枚数)

    print("■ あおいLoRA の学習用画像を作ります")
    print("  顔の種（seed）: %s ← ここが同じなので毎回おなじ顔になります"
          % 顔["seed"])
    print("  大きさ: %d×%d ／ 変化の強さ: %s（3段階を混ぜます）"
          % (辺, 辺, "・".join(str(x) for x in 変化の強さ一覧)))
    print("  ★insightface（非商用）は1か所も通しません")
    print()
    print("  作る内訳（%d枚）:" % len(組))
    for i, (名, _) in enumerate(組, 1):
        print("    %2d. %s" % (i, 名))

    if args.下見:
        print("\n下見だけなので、ここで終わります（画像は作っていません）。")
        return

    # 健全側の中だけで作業していることを確かめる
    os.makedirs(学習用, exist_ok=True)
    隔離.素材フォルダを検査する(学習用, "LoRAの学習用画像づくり")

    if not 元.wait_server():
        sys.exit("\n★ComfyUI が起動していません。先に立ち上げてください。")

    client_id = str(uuid.uuid4())

    # ── 1段目: 基準顔
    print("\n[1/2] 基準顔を作ります（seed %s）…" % 顔["seed"])
    基準先 = os.path.join(学習用, "aoi_base.png")
    if not 一枚作る(基準顔の手順(顔), 基準先, client_id):
        sys.exit("★基準顔が作れませんでした。ComfyUI の画面を確認してください。")
    os.makedirs(COMFY_IN, exist_ok=True)
    shutil.copy(基準先, os.path.join(COMFY_IN, 基準顔ファイル))
    print("      できました: %s" % 基準先)

    if args.基準顔だけ:
        print("\n基準顔だけ作りました。顔を見て良ければ、枚数を指定して本番へ。")
        return

    # ── 2段目: 変化をつけた学習用
    print("\n[2/2] そこから %d枚 作ります…" % len(組))
    できた = 0
    for i, (名, 説明) in enumerate(組, 1):
        強さ = 変化の強さ一覧[i % len(変化の強さ一覧)]
        先 = os.path.join(学習用, "aoi_lora_%02d_d%02d.png"
                        % (i, int(強さ * 100)))
        if 一枚作る(変化の手順(顔, 説明, int(顔["seed"]) + i * 17, 強さ),
                 先, client_id):
            できた += 1
            print("  %2d/%d %s（強さ %.2f）" % (i, len(組), 名, 強さ))
        else:
            print("  %2d/%d %s ← 作れませんでした" % (i, len(組), 名))

    # 出来上がった画像も、健全側のものか1枚ずつ確かめる（二重の歯止め）
    画像一覧 = [os.path.join(学習用, f) for f in sorted(os.listdir(学習用))
             if f.endswith(".png")]
    隔離.画像が健全側のものか確かめる(画像一覧, "LoRAの学習用画像")

    print("\n%d枚できました: %s" % (できた, 学習用))
    print("\n次にやること:")
    print("  1. %s を開いて、全部おなじ顔に見えるか確かめる" % os.path.basename(学習用))
    print("     ★別人が混ざっていたらその1枚を消す（LoRAが顔を覚えられなくなるため）")
    print("  2. ファイル名の末尾が『変化の強さ』です。")
    print("     顔が保てている強さが分かったら、その強さだけで作り直せます。")
    print("     （強いほど服や背景は変わりますが、顔が別人になりやすい）")
    print("  3. 揃っていたら、この30枚で LoRA を学習させる")


if __name__ == "__main__":
    main()
