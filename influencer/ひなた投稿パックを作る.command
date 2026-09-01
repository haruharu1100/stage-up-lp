#!/bin/bash
# ダブルクリックで、output_hinata内のひなた写真から「すぐ投稿できるパック」を作る
# 誘導先はアプリ「トークレン」（persona_hinata.json）
cd "$(dirname "$0")" || exit 1

echo "=============================================="
echo " ひなた 投稿パック生成（→トークレンへ誘導）"
echo "=============================================="
echo "写真にキャプション・ハッシュタグ・アプリ案内文をつけています..."

python3 make_post_pack.py \
  --persona persona_hinata.json \
  --char character_hinata.json \
  --photo-dir output_hinata \
  --prefix hinata
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
