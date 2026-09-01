#!/bin/bash
# ダブルクリックで、output内のあおい写真を縦型リール動画にする
cd "$(dirname "$0")" || exit 1

echo "=============================================="
echo " あおい リール動画 生成"
echo "=============================================="
echo "写真にゆっくりズームとフック文字をつけて動画にしています..."

PY="ComfyUI/venv/bin/python3"
[ -x "$PY" ] || PY="python3"
"$PY" make_reel.py
STATUS=$?

if [ $STATUS -eq 0 ]; then
  LATEST="$(ls -td reels/*/ 2>/dev/null | head -1)"
  echo ""
  echo "完了しました。動画フォルダを開きます。"
  [ -n "$LATEST" ] && open "$LATEST"
else
  echo ""
  echo "エラーが発生しました。"
fi
echo ""
echo "このウィンドウは閉じて大丈夫です。"
