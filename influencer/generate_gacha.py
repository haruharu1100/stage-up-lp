#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ガチャ用アニメキャラを、同じ子のまま量産する（アニメ専用モデルを使用）。

実写用の generate.py / generate_char.py とは別物。アニメ専用モデル
(animagine-xl-4.0) を使い、タグで指定したキャラを固定シードで量産する。
同じキャラを保つため、キャラ・衣装タグは全カット共通にし、ポーズ/表情/背景だけ
カードごとに変える。出力は output_gacha/gacha_XX.png。
"""
import json
import os
import sys
import time
import uuid
import shutil
import argparse
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = "http://127.0.0.1:8188"
COMFY_OUT = os.path.join(HERE, "ComfyUI", "output")
CHECKPOINT = "animagine-xl-4.0.safetensors"

WIDTH = 832
HEIGHT = 1216
STEPS = 30
CFG = 6.0
SAMPLER = "euler_ancestral"
SCHEDULER = "normal"


def http_get(path):
    with urllib.request.urlopen(SERVER + path, timeout=10) as r:
        return json.loads(r.read())


def http_post(path, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(SERVER + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def wait_server(max_wait=180):
    print("ComfyUIサーバーの起動を待っています...")
    t0 = time.time()
    while time.time() - t0 < max_wait:
        try:
            http_get("/system_stats")
            print("サーバー起動を確認しました。")
            return True
        except Exception:
            time.sleep(2)
    return False


def build_workflow(positive, negative, seed, prefix):
    return {
        "4": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": CHECKPOINT}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode",
              "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode",
              "inputs": {"text": negative, "clip": ["4", 1]}},
        "3": {"class_type": "KSampler",
              "inputs": {"seed": seed, "steps": STEPS, "cfg": CFG,
                         "sampler_name": SAMPLER, "scheduler": SCHEDULER,
                         "denoise": 1.0, "model": ["4", 0],
                         "positive": ["6", 0], "negative": ["7", 0],
                         "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode",
              "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def queue_prompt(workflow, client_id):
    res = http_post("/prompt", {"prompt": workflow, "client_id": client_id})
    return res["prompt_id"]


def wait_result(prompt_id, max_wait=600):
    t0 = time.time()
    while time.time() - t0 < max_wait:
        try:
            hist = http_get("/history/" + prompt_id)
        except Exception:
            time.sleep(2)
            continue
        if prompt_id in hist:
            outputs = hist[prompt_id].get("outputs", {})
            for node in outputs.values():
                if "images" in node:
                    return node["images"]
        time.sleep(2)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", default=os.path.join(HERE, "character_gacha.json"))
    args = ap.parse_args()

    with open(args.char, encoding="utf-8") as f:
        char = json.load(f)

    prefix = char.get("out_prefix", "gacha")
    out_dir = os.path.join(HERE, char.get("out_dir", "output_gacha"))
    os.makedirs(out_dir, exist_ok=True)

    if not wait_server():
        print("エラー: サーバーが起動しませんでした。")
        sys.exit(1)

    client_id = str(uuid.uuid4())
    seed = int(char["seed"])
    name = char.get("name_ja", char["name"])
    base = "%s, %s" % (char["base_tags"], char["outfit"])
    cards = char["cards"]
    total = len(cards)
    print("ガチャキャラ「%s」を %d 枚生成します。" % (name, total))

    made = 0
    for i, card in enumerate(cards, 1):
        positive = "%s, %s, %s" % (base, card, char["quality"])
        wf = build_workflow(positive, char["negative"], seed + i, prefix)
        print("[%d/%d] 生成中: %s" % (i, total, card[:40]))
        try:
            pid = queue_prompt(wf, client_id)
        except urllib.error.HTTPError as e:
            print("  キュー投入エラー:", e.read().decode("utf-8", "ignore")[:300])
            continue
        images = wait_result(pid)
        if not images:
            print("  生成に失敗しました。")
            continue
        img = images[0]
        src = os.path.join(COMFY_OUT, img.get("subfolder", ""), img["filename"])
        dst = os.path.join(out_dir, "%s_%02d.png" % (prefix, i))
        if os.path.exists(src):
            shutil.copyfile(src, dst)
            made += 1
            print("  保存:", os.path.basename(dst))

    print("\n完成: %d 枚を %s フォルダに保存しました。"
          % (made, char.get("out_dir", "output_gacha")))


if __name__ == "__main__":
    main()
