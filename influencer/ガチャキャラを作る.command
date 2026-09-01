#!/bin/bash
# ダブルクリックで ガチャ用アニメキャラ（セレネ）を量産する
cd "$(dirname "$0")" || exit 1

export PYTORCH_ENABLE_MPS_FALLBACK=1
PY="./ComfyUI/venv/bin/python"

echo "=============================================="
echo " ガチャキャラ（アニメ）量産ツール"
echo "=============================================="
echo "画像エンジン(ComfyUI)を起動します..."

"$PY" ComfyUI/main.py --port 8188 --output-directory "./ComfyUI/output" > comfyui.log 2>&1 &
SERVER_PID=$!

"$PY" generate_gacha.py --char character_gacha.json
STATUS=$?

kill "$SERVER_PID" 2>/dev/null

if [ $STATUS -eq 0 ]; then
  echo ""
  echo "完了しました。output_gacha フォルダを開きます。"
  open ./output_gacha
else
  echo ""
  echo "エラーが発生しました。comfyui.log を確認してください。"
fi

echo ""
echo "このウィンドウは閉じて大丈夫です。"
