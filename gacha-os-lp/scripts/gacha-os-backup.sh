#!/bin/bash
# ══════════════════════════════════════════════════════════
#  AI GACHA OS の保存ファイルを、毎日ひかえ（バックアップ）に取る
# ══════════════════════════════════════════════════════════
#  ★ここで扱うのは /var/gacha-os/ の中だけです。
#    既存のお店（キクソラ／ココホレ・ワン）には一切触りません。
#  ★取ったひかえは14日分だけ残し、古いものから消えます。
set -e

SRC=/var/gacha-os/data
DST=/var/gacha-os/backup
STAMP=$(date +%Y%m%d-%H%M)

mkdir -p "$DST"

# 書き込み途中の中途半端なファイルを写さないため、数秒だけ止めてから写す
docker stop gacha-os >/dev/null 2>&1 || true
cp -a "$SRC/gacha-os.db" "$DST/gacha-os-$STAMP.db"
docker start gacha-os >/dev/null 2>&1 || true

# 14日より古いひかえを消す
find "$DST" -name 'gacha-os-*.db' -mtime +14 -delete

echo "[backup] saved: gacha-os-$STAMP.db"
ls -1t "$DST" | head -3
