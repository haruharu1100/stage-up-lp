#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""あおいの「全身」写真を生成する（顔は固定したまま、頭から足先まで写す構図）。

通常の generate.py は顔アップ中心。こちらは全身が入る構図に作り替えたもの。
出力は output_fullbody/aoi_fb_XX.png に保存（顔アップ版を上書きしない）。
"""
import json
import os
import sys
import time
import uuid
import shutil
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = "http://127.0.0.1:8188"
CHAR_PATH = os.path.join(HERE, "character.json")
OUT_DIR = os.path.join(HERE, "output_fullbody")
COMFY_OUT = os.path.join(HERE, "ComfyUI", "output")
CHECKPOINT = "RealVisXL_V5.0.safetensors"
REF_IMAGE = "aoi_ref.png"

WIDTH = 832
HEIGHT = 1216
STEPS = 30
CFG = 5.0
SAMPLER = "dpmpp_2m"
SCHEDULER = "karras"
FACE_WEIGHT = 0.9
FACEIDV2_WEIGHT = 1.4

# 全身が入るようにするための構図ワード（先頭に強めに置く）
FRAMING = ("full body shot, full length portrait, head to toe, entire body visible, "
           "standing pose, showing legs and shoes, wide shot, full figure")
# 顔アップ用レンズ表現を避けたい時用の品質（85mm portrait lens を使わない）
QUALITY_FB = ("RAW photo, photorealistic, ultra detailed skin texture, natural skin pores, "
              "35mm lens, full body framing, soft natural lighting, sharp focus, "
              "high detail, realistic proportions, detailed hands")

# 全身向けの立ちポーズ・シーン
SCENES_FB = [
    "white knit sweater and beige skirt, standing in a cozy cafe, warm afternoon light",
    "denim jacket over white tee and jeans, standing on a city street, soft bokeh background",
    "light blue summer dress, standing on a seaside promenade, bright sunny day",
    "cream blouse and wide pants, standing in a modern bright apartment, large window",
    "beige cardigan and long skirt, standing in a park with green trees, gentle daylight",
    "floral blouse and white pants, standing in a botanical greenhouse, soft natural light",
    "light grey hoodie and denim, standing under cherry blossoms, spring afternoon",
    "navy dress, standing in a library aisle with bookshelves, warm indoor light",
]


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


def build_workflow(positive, negative, seed):
    return {
        "4": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": CHECKPOINT}},
        "10": {"class_type": "LoadImage",
               "inputs": {"image": REF_IMAGE}},
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
              "inputs": {"images": ["8", 0], "filename_prefix": "aoi_fb"}},
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
    with open(CHAR_PATH, encoding="utf-8") as f:
        char = json.load(f)
    os.makedirs(OUT_DIR, exist_ok=True)
    if not wait_server():
        print("エラー: サーバーが起動しませんでした。")
        sys.exit(1)

    # 「全身が切れる」ことを避ける否定語を足す
    negative = char["negative"] + ", cropped, close-up, headshot, out of frame, cut off legs"

    client_id = str(uuid.uuid4())
    seed = int(char["seed"])
    total = len(SCENES_FB)
    print("あおいの全身写真を %d 枚生成します。" % total)

    made = 0
    for i, scene in enumerate(SCENES_FB, 1):
        positive = "%s, %s, %s, %s" % (FRAMING, char["base_face"], scene, QUALITY_FB)
        wf = build_workflow(positive, negative, seed + 100 + i)
        print("[%d/%d] 生成中: %s" % (i, total, scene[:42]))
        try:
            pid = queue_prompt(wf, client_id)
        except urllib.error.HTTPError as e:
            print("  キュー投入エラー:", e.read().decode("utf-8", "ignore")[:300])
            continue
        images = wait_result(pid)
        if not images:
            print("  生成に失敗しました。")
            continue
        for img in images:
            src = os.path.join(COMFY_OUT, img.get("subfolder", ""), img["filename"])
            dst = os.path.join(OUT_DIR, "aoi_fb_%02d.png" % i)
            if os.path.exists(src):
                shutil.copyfile(src, dst)
                made += 1
                print("  保存:", os.path.basename(dst))

    print("\n完成: %d 枚を output_fullbody フォルダに保存しました。" % made)


if __name__ == "__main__":
    main()
