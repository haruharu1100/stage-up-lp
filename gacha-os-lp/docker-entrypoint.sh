#!/bin/sh
# 起動のしかた。
#
#   保存先（/data/gacha-os.db）がまだ無いときだけ、
#   見本データの入った初期ファイルを1回だけ置きます。
#
#   ★すでにある場合は、絶対に上書きしません。
#     上書きすると、見ていただいた操作の跡が毎回消えます。
set -e

if [ ! -f /data/gacha-os.db ]; then
  echo "[起動] 保存先が無いので、見本データを置きます。"
  cp /seed/gacha-os.db /data/gacha-os.db
else
  echo "[起動] 保存先はすでにあります。そのまま使います。"
fi

exec node server.js
