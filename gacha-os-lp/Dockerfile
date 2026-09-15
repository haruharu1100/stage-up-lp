# ══════════════════════════════════════════════════════════
#  AI GACHA OS を、自前のサーバーで動かすための入れ物
# ══════════════════════════════════════════════════════════
#
#  何のためのファイルか
#    Vercel ではなく、自分たちのサーバー（キクソラの機械）の中で
#    このアプリを動かすために、必要な物だけを1つに詰めます。
#
#  ★守っていること
#    ・既にその機械で動いているお店（キクソラ／ココホレ・ワン）には
#      一切触りません。別の入れ物・別のポートで動きます。
#    ・保存先は /data の中のファイル1つだけ。消せば元通りです。
#
#  ★このアプリは x86_64（AMD64）の機械で動きます。
#    @libsql/client が機械語の部品を持っているため、
#    必ず --platform linux/amd64 で作ってください。

# ────────────────────────────────────────────────
#  1段目：材料をそろえる
# ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# 本番用の依存だけでなく開発用も入れる（next build に要るため）
RUN npm ci --no-audit --no-fund

# ────────────────────────────────────────────────
#  2段目：組み立てる
# ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 必要な物だけをまとめた小さな出力を作る
ENV NEXT_STANDALONE=1
ENV NEXT_TELEMETRY_DISABLED=1
# ★本番としてのビルドではない、と明示する。
#   これで公開前チェックが「本番の保存先」を要求しません。
ENV DATABASE_ENV=preview

# ★計測タグ（GA4・Google広告）と事業者名は、組み立てる時にページの中へ焼き込まれます。
#   ここで渡さないと、公開したページから広告の計測が消えます。
#   これらは秘密ではありません（ページのソースに出る種類のものです）。
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_GA4_ID
ARG NEXT_PUBLIC_GOOGLE_ADS_ID
ARG NEXT_PUBLIC_GOOGLE_ADS_LABEL_DEMO
ARG NEXT_PUBLIC_GOOGLE_ADS_LABEL_CONTACT
ARG NEXT_PUBLIC_OPERATOR_NAME
ARG NEXT_PUBLIC_OPERATOR_CONTACT
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_GA4_ID=$NEXT_PUBLIC_GA4_ID
ENV NEXT_PUBLIC_GOOGLE_ADS_ID=$NEXT_PUBLIC_GOOGLE_ADS_ID
ENV NEXT_PUBLIC_GOOGLE_ADS_LABEL_DEMO=$NEXT_PUBLIC_GOOGLE_ADS_LABEL_DEMO
ENV NEXT_PUBLIC_GOOGLE_ADS_LABEL_CONTACT=$NEXT_PUBLIC_GOOGLE_ADS_LABEL_CONTACT
ENV NEXT_PUBLIC_OPERATOR_NAME=$NEXT_PUBLIC_OPERATOR_NAME
ENV NEXT_PUBLIC_OPERATOR_CONTACT=$NEXT_PUBLIC_OPERATOR_CONTACT

RUN npm run build

# ────────────────────────────────────────────────
#  3段目：動かす（ここだけが機械に載る）
# ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# root では動かさない
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p /data \
 && chown -R nextjs:nodejs /data

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 見本データ（架空の会社「DEMO」と架空の担当者・お客様）の初期ファイル。
# 実在のお名前・メールは1件も入っていません（すべて .example）。
COPY --chown=nextjs:nodejs .docker-seed/gacha-os.db /seed/gacha-os.db
COPY --chown=nextjs:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nextjs
VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
