#!/bin/bash
# ダブルクリックで 新キャラ「ひなた」の写真を量産する
cd "$(dirname "$0")" || exit 1

export PYTORCH_ENABLE_MPS_FALLBACK=1
PY="./ComfyUI/venv/bin/python"

echo "=============================================="
echo " 新キャラ「ひなた」 写真量産ツール"
echo "=============================================="
echo "画像エンジン(ComfyUI)を起動します..."

# ComfyUIサーバーを背景で起動
"$PY" ComfyUI/main.py --port 8188 --output-directory "./ComfyUI/output" > comfyui.log 2>&1 &
SERVER_PID=$!

# 生成スクリプトを実行（中でサーバー起動を待つ）
"$PY" generate_char.py --char character_hinata.json
STATUS=$?

# サーバーを停止
kill "$SERVER_PID" 2>/dev/null

if [ $STATUS -eq 0 ]; then
  echo ""
  echo "完了しました。output_hinata フォルダを開きます。"
  open ./output_hinata
else
  echo ""
  echo "エラーが発生しました。comfyui.log を確認してください。"
fi

echo ""
echo "このウィンドウは閉じて大丈夫です。"
