#!/bin/bash
# ダブルクリックで「かんたん画像作成ページ」を開く。
#   1) 画像エンジン(ComfyUI)が止まっていれば起動
#   2) かんたん作成ページ(127.0.0.1:8500)を起動してブラウザで開く
cd "$(dirname "$0")" || exit 1
export PYTORCH_ENABLE_MPS_FALLBACK=1
PY="./ComfyUI/venv/bin/python"
[ -x "$PY" ] || PY="python3"

echo "画像エンジンの状態を確認しています..."
if ! curl -s -m 3 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
  echo "画像エンジン(ComfyUI)を起動します..."
  "$PY" ComfyUI/main.py --port 8188 --output-directory "./ComfyUI/output" > comfyui.log 2>&1 &
  # 起動待ち（最大3分）
  for i in $(seq 1 90); do
    curl -s -m 3 http://127.0.0.1:8188/system_stats >/dev/null 2>&1 && break
    sleep 2
  done
fi

echo "かんたん画像作成ページを開きます..."
"$PY" simple_gen.py
