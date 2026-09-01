#!/bin/bash
# ダブルクリックで、output内のあおい写真から「すぐ投稿できるパック」を作る
cd "$(dirname "$0")" || exit 1

echo "=============================================="
echo " あおい 投稿パック生成"
echo "=============================================="
echo "写真にキャプション・ハッシュタグ・誘導文をつけています..."

python3 make_post_pack.py
STATUS=$?

if [ $STATUS -eq 0 ]; then
  LATEST="$(ls -td post_packs/*/ 2>/dev/null | head -1)"
  echo ""
  echo "完了しました。パックフォルダを開きます。"
  [ -n "$LATEST" ] && open "$LATEST"
else
  echo ""
  echo "エラーが発生しました。"
fi
echo ""
echo "このウィンドウは閉じて大丈夫です。"
