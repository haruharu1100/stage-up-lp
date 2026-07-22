# Reseller Radar

仕入れ先（ECサイトのセールページ等）のURLを登録すると毎日自動で巡回し、抽出した商品を Amazon 価格（Keepa API）と比較して、利益条件を満たす商品をアプリ内＋メールで通知するセルフホスト型システムです。

スタック: Next.js 14（App Router）/ better-sqlite3 / cheerio / node-cron / nodemailer

## セットアップ

```bash
cd reseller-radar
npm install
npm run build
npm run start      # 本番起動（既定 http://localhost:3000）
# 開発時は npm run dev
```

初回起動時に `data/app.db` が自動生成され、仕入れ先プリセット7件が投入されます。

## 使い方

1. **設定** 画面で Keepa APIキーを登録（Amazon照合に必須）。必要ならメール通知(SMTP)・手数料・巡回時刻も設定。
2. **仕入れ先** 画面でプリセットを確認・編集、または独自の仕入れ先を追加。CSSセレクタは空欄にすると自動検出モードで動きます。
3. **巡回タスク** 画面でタスク名・仕入れ先・監視URL・利益条件を登録。
4. **今すぐ巡回** を押すか、cronで自動巡回。利益条件を満たした商品が **通知** 画面とメールに届きます。

## Keepa APIキー

- 取得先: https://keepa.com/#!api （有料）
- 本システムは domain=5（Amazon.co.jp）で照合します。
- **Keepaのトークンは JAN 1件あたり約1トークン消費**します。巡回対象の商品数は絞ってください。各照合の間に1.1秒の待機を入れてトークンを節約しています。

## 自動巡回（cron）の常駐

Webサーバーとcronデーモンは別プロセスです。pm2 で常駐させる例:

```bash
npm install -g pm2

# Webサーバー
pm2 start npm --name reseller-web -- run start

# cronデーモン（設定の「巡回時刻」に毎日1回 runAllTasks を実行）
pm2 start npm --name reseller-cron -- run cron

pm2 save
pm2 startup   # OS起動時の自動立ち上げ
```

巡回時刻を変更したら cron プロセスを再起動してください（`pm2 restart reseller-cron`）。

## Vercel など サーバーレスに載せる場合

- SQLite（better-sqlite3）はファイル書き込み前提のため、Vercel ではそのまま動きません。**DBを Turso / LibSQL などに差し替え**てください。
- 自動巡回は node-cron の代わりに **Vercel Cron** から `/api/crawl` を叩く構成にします。

## JavaScript描画が必要なサイト

fetch + cheerio は静的HTMLを取得します。商品がJSで後から描画されるサイト（SPA等）では抽出できません。その場合は `lib/crawler.js` の `fetch` 部分を **Playwright** に差し替えてレンダリング後のHTMLを取得してください。

## 運用上の注意

- **各サイトの利用規約・robots.txt を必ず確認**してください。
- 巡回頻度は **1日1回程度の常識的な範囲** にとどめ、サーバーに負荷をかけないでください。
- 本システムは個人の情報収集を補助するツールです。取得したデータの利用は自己責任で行ってください。

## ディレクトリ構成

```
reseller-radar/
├ app/            # 画面（通知/巡回タスク/仕入れ先/設定）とAPI
├ lib/            # db / amazon(Keepa) / notify(メール) / crawler
├ scripts/cron.mjs
└ data/app.db     # 自動生成（gitignore）
```
