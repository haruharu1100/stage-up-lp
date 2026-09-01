#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""任意のキャラ設定ファイル(character_*.json)から、同じ顔の写真を量産する。

あおい用の generate.py を一般化したもの。--char で設定ファイルを指定する。
新キャラで初回は基準顔(ref_image)がまだ無いので、
  第1段階: テキストだけで正面の基準顔を1枚作り、ComfyUI/input に基準顔として置く
  第2段階: その基準顔を IPAdapter FaceID で全カットに転写して量産
を自動で行う。既に基準顔があれば第1段階は省略する。
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
COMFY_INPUT = os.path.join(HERE, "ComfyUI", "input")
CHECKPOINT = "RealVisXL_V5.0.safetensors"

WIDTH = 832
HEIGHT = 1216
STEPS = 30
CFG = 5.0
SAMPLER = "dpmpp_2m"
SCHEDULER = "karras"
FACE_WEIGHT = 0.9
FACEIDV2_WEIGHT = 1.4

# 基準顔を作る時の構図（正面・顔がはっきり見える）
REF_SCENE = ("head and shoulders portrait, looking at camera, front view, "
             "neutral background, soft studio lighting")


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


def wf_plain(positive, negative, seed, prefix):
    """IPAdapterなし（基準顔づくり用）。"""
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


def wf_faceid(positive, negative, seed, ref_image, prefix):
    """IPAdapter FaceID で基準顔を転写（量産用）。"""
    return {
        "4": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": CHECKPOINT}},
        "10": {"class_type": "LoadImage",
               "inputs": {"image": ref_image}},
        "11": {"class_type": "IPAdapterUnifiedLoaderFaceID",
               "inputs": {"model": ["4", 0], "preset": "FACEID PLUS V2",
                          "lora_strength": 0.6, "provider": "CPU"}},
        "12": {"class_type": "IPAdapterFaceID",
               "inputs": {"model": ["11", 0], "ipadapter": ["11", 1],
                          "image": ["10", 0], "weight": FACE_WEIGHT,
                          "weight_faceidv2": FACEIDV2_WEIGHT,
                          "weight_type": "linear", "combine_embeds": "concat",
                          "start_at": 0.0, "end_at": 1.0,
                          "embeds_scaling": "V only"}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode",
              "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode",
              "inputs": {"text": negative, "clip": ["4", 1]}},
        "3": {"class_type": "KSampler",
              "inputs": {"seed": seed, "steps": STEPS, "cfg": CFG,
                         "sampler_name": SAMPLER, "scheduler": SCHEDULER,
                         "denoise": 1.0, "model": ["12", 0],
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


def first_path(images):
    img = images[0]
    return os.path.join(COMFY_OUT, img.get("subfolder", ""), img["filename"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", default=os.path.join(HERE, "character.json"),
                    help="キャラ設定ファイル")
    ap.add_argument("--rebuild-ref", action="store_true",
                    help="基準顔がすでにあっても作り直す")
    args = ap.parse_args()

    with open(args.char, encoding="utf-8") as f:
        char = json.load(f)

    ref_image = char.get("ref_image", "aoi_ref.png")
    prefix = char.get("out_prefix", "aoi")
    out_dir = os.path.join(HERE, char.get("out_dir", "output"))
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(COMFY_INPUT, exist_ok=True)

    if not wait_server():
        print("エラー: サーバーが起動しませんでした。")
        sys.exit(1)

    client_id = str(uuid.uuid4())
    seed = int(char["seed"])
    name = char.get("name_ja", char["name"])

    # 第1段階: 基準顔づくり
    ref_full = os.path.join(COMFY_INPUT, ref_image)
    if args.rebuild_ref or not os.path.exists(ref_full):
        print("「%s」の基準顔を作っています..." % name)
        positive = "%s, %s, %s" % (char["base_face"], REF_SCENE, char["quality"])
        wf = wf_plain(positive, char["negative"], seed, prefix + "_ref")
        pid = queue_prompt(wf, client_id)
        images = wait_result(pid)
        if not images:
            print("基準顔の生成に失敗しました。")
            sys.exit(1)
        src = first_path(images)
        shutil.copyfile(src, ref_full)
        shutil.copyfile(src, os.path.join(out_dir, ref_image))
        print("基準顔を作成しました: %s" % ref_image)

    # 第2段階: 同じ顔で量産
    scenes = char["scenes"]
    total = len(scenes)
    print("キャラ「%s」を %d 枚生成します。" % (name, total))
    made = 0
    for i, scene in enumerate(scenes, 1):
        positive = "%s, %s, %s" % (char["base_face"], scene, char["quality"])
        wf = wf_faceid(positive, char["negative"], seed + i, ref_image, prefix)
        print("[%d/%d] 生成中: %s" % (i, total, scene[:40]))
        try:
            pid = queue_prompt(wf, client_id)
        except urllib.error.HTTPError as e:
            print("  キュー投入エラー:", e.read().decode("utf-8", "ignore")[:300])
            continue
        images = wait_result(pid)
        if not images:
            print("  生成に失敗しました。")
            continue
        src = first_path(images)
        dst = os.path.join(out_dir, "%s_%02d.png" % (prefix, i))
        if os.path.exists(src):
            shutil.copyfile(src, dst)
            made += 1
            print("  保存:", os.path.basename(dst))

    print("\n完成: %d 枚を %s フォルダに保存しました。"
          % (made, char.get("out_dir", "output")))


if __name__ == "__main__":
    main()
