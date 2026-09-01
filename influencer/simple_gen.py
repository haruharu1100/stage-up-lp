#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
かんたん画像作成ページ（ComfyUI標準機能のみ使用）
  ・ブラウザで「文章を入れて［作る］を押すだけ」で1枚生成する超シンプルUI。
  ・裏で 127.0.0.1:8188 のComfyUI(SDXL)へ投げる。ノード画面を触る必要なし。
  ・プロンプト(指示文)は利用者が自分で入力する（ここには例文を入れない）。
起動: python3 simple_gen.py  → http://127.0.0.1:8500 を自動で開く
"""
import json
import os
import random
import time
import uuid
import webbrowser
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COMFY = "http://127.0.0.1:8188"
PORT = 8500

# 利用可能なモデル（左が画面の表示名 / 右が実ファイル）
MODELS = {
    "リアル系(アダルト) lustify": "lustifySDXLNSFW_endgame.safetensors",
    "リアル系 RealVisXL": "RealVisXL_V5.0.safetensors",
    "イラスト系 animagine": "animagine-xl-4.0.safetensors",
}
DEFAULT_MODEL = "リアル系(アダルト) lustify"

# 未成年に見える描写を避けるための安全ネガティブ（法令順守のため固定で付与）
SAFE_NEGATIVE = (
    "lowres, worst quality, low quality, bad anatomy, bad hands, missing fingers, "
    "extra fingers, text, watermark, signature, blurry, deformed, "
    "child, kid, children, loli, shota, underage, teen, schoolgirl, baby face"
)

WIDTH, HEIGHT = 832, 1216
STEPS, CFG = 28, 5.0

# 顔つぶれ対策の高精細仕上げ（2パス / hires-fix）
# 1パス目で下絵→拡大→2パス目で描き直すと、顔が大きくなり細部が復活する。
# ※このMacの速度に合わせ、拡大率とステップ数を控えめにして待ち時間を抑えている。
HIRES_SCALE = 1.3          # 何倍に拡大するか（大きいほど高精細だが遅い）
HIRES_STEPS = 14           # 仕上げパスのステップ数
HIRES_DENOISE = 0.42       # 仕上げの描き直し強度（顔の作り直し具合）


def comfy_post(path, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(COMFY + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def comfy_get(path):
    with urllib.request.urlopen(COMFY + path, timeout=15) as r:
        return json.loads(r.read())


def build_workflow(positive, ckpt, seed):
    return {
        "4": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": ckpt}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode",
              "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode",
              "inputs": {"text": SAFE_NEGATIVE, "clip": ["4", 1]}},
        # 1パス目：下絵を作る
        "3": {"class_type": "KSampler",
              "inputs": {"seed": seed, "steps": STEPS, "cfg": CFG,
                         "sampler_name": "dpmpp_2m", "scheduler": "karras",
                         "denoise": 1.0, "model": ["4", 0],
                         "positive": ["6", 0], "negative": ["7", 0],
                         "latent_image": ["5", 0]}},
        # 拡大：顔を大きくして描き直せるようにする
        "10": {"class_type": "LatentUpscaleBy",
               "inputs": {"samples": ["3", 0], "upscale_method": "nearest-exact",
                          "scale_by": HIRES_SCALE}},
        # 2パス目：拡大した絵を仕上げる（顔の細部が復活する）
        "11": {"class_type": "KSampler",
               "inputs": {"seed": seed, "steps": HIRES_STEPS, "cfg": CFG,
                          "sampler_name": "dpmpp_2m", "scheduler": "karras",
                          "denoise": HIRES_DENOISE, "model": ["4", 0],
                          "positive": ["6", 0], "negative": ["7", 0],
                          "latent_image": ["10", 0]}},
        "8": {"class_type": "VAEDecode",
              "inputs": {"samples": ["11", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": "simple"}},
    }


def generate(positive, model_label):
    ckpt = MODELS.get(model_label, MODELS[DEFAULT_MODEL])
    seed = random.randint(1, 2**31 - 1)
    wf = build_workflow(positive, ckpt, seed)
    pid = comfy_post("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})["prompt_id"]
    t0 = time.time()
    while time.time() - t0 < 900:
        try:
            hist = comfy_get("/history/" + pid)
        except Exception:
            time.sleep(2)
            continue
        if pid in hist:
            for node in hist[pid].get("outputs", {}).values():
                if "images" in node:
                    img = node["images"][0]
                    return (COMFY + "/view?filename=%s&subfolder=%s&type=%s"
                            % (urllib.parse.quote(img["filename"]),
                               urllib.parse.quote(img.get("subfolder", "")),
                               img.get("type", "output")))
        time.sleep(2)
    return None


import urllib.parse  # noqa: E402

PAGE = """<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>かんたん画像作成</title>
<style>
 body{font-family:-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#faf7f8;color:#222}
 h1{font-size:20px}
 textarea{width:100%;height:130px;font-size:16px;padding:12px;border:1px solid #ccc;border-radius:10px;box-sizing:border-box}
 select,button{font-size:16px;padding:10px 14px;border-radius:10px;border:1px solid #ccc}
 button{background:#e0116b;color:#fff;border:none;font-weight:bold;cursor:pointer}
 button:disabled{opacity:.5}
 .row{display:flex;gap:10px;align-items:center;margin:12px 0;flex-wrap:wrap}
 .note{font-size:12px;color:#777;line-height:1.7;background:#fff;border:1px solid #eee;border-radius:10px;padding:12px;margin-top:16px}
 #out{margin-top:18px;text-align:center}
 #out img{max-width:100%;border-radius:12px;box-shadow:0 2px 14px rgba(0,0,0,.15)}
 #status{margin-top:10px;color:#e0116b;font-weight:bold;min-height:22px}
</style></head><body>
<h1>かんたん画像作成</h1>
<p style="font-size:14px;color:#555">下の欄に「どんな画像にしたいか」を英語で書いて、［作る］を押してください。</p>
<textarea id="prompt" placeholder="ここに指示文（英語）を入力"></textarea>
<div class="row">
 <label>モデル：</label>
 <select id="model">__OPTIONS__</select>
 <button id="go" onclick="run()">作る</button>
</div>
<div id="status"></div>
<div id="out"></div>
<div class="note">
 ・高画質仕上げ（顔つぶれ防止の2段階生成）のため、1枚あたり<b>5〜7分</b>ほどかかります。そのままお待ちください。<br>
 ・出来た画像は ai-influencer/ComfyUI/output フォルダにも自動保存されます。<br>
 ・<b>販売前に必ずモザイク処理が必要です</b>（日本では無修正は違法）。モザイクは別ツールで一括処理します。<br>
 ・未成年に見える画像は法律・規約で禁止です。大人だけを作ってください（安全設定を内部で付けています）。
</div>
<script>
function run(){
 var p=document.getElementById('prompt').value.trim();
 if(!p){alert('指示文を入力してください');return;}
 var m=document.getElementById('model').value;
 var btn=document.getElementById('go'); btn.disabled=true;
 document.getElementById('status').textContent='作成中… 数分かかります';
 document.getElementById('out').innerHTML='';
 fetch('/gen',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({prompt:p,model:m})})
 .then(r=>r.json()).then(d=>{
   btn.disabled=false;
   if(d.url){document.getElementById('status').textContent='完成しました';
     document.getElementById('out').innerHTML='<img src="'+d.url+'">';}
   else{document.getElementById('status').textContent='失敗しました。もう一度お試しください。';}
 }).catch(e=>{btn.disabled=false;
   document.getElementById('status').textContent='エラー: '+e;});
}
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/index"):
            opts = "".join('<option>%s</option>' % k for k in MODELS)
            html = PAGE.replace("__OPTIONS__", opts).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/gen":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        try:
            url = generate(body.get("prompt", ""), body.get("model", DEFAULT_MODEL))
        except urllib.error.HTTPError as e:
            print("生成エラー:", e.read().decode("utf-8", "ignore")[:300])
            url = None
        except Exception as e:
            print("生成エラー:", e)
            url = None
        out = json.dumps({"url": url}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)


def main():
    # ComfyUIが起きているか確認
    try:
        comfy_get("/system_stats")
    except Exception:
        print("ComfyUI(127.0.0.1:8188)が起動していません。先に画像エンジンを起動してください。")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = "http://127.0.0.1:%d" % PORT
    print("かんたん画像作成ページ:", url)
    try:
        webbrowser.open(url)
    except Exception:
        pass
    srv.serve_forever()


if __name__ == "__main__":
    main()
