# AFTER スクリーンショット一覧（2026-08-21）

撮影条件

- 本番ビルド（`npm run build` → `next start -p 3210`）を実際に開いて撮影
- PC = 1440 × 900 / スマホ = 390 × 844（iPhone 相当・Retina 2倍）
- スクロール演出が終わるのを待ってから撮影。動き続けるものだけ停止
- 撮影中のブラウザのエラー：**0件**
- 背景色 `rgb(255,255,255)` を確認済み（古いサーバーを撮っていないことの証明）

## ページの長さ

| | 作り直す前 | 前回 | 今回 |
|---|---|---|---|
| スマホ 390px | 98,229px | 63,860px | 64,888px |
| PC 1440px | 59,812px | 48,665px | 48,418px |

スマホが前回より 1,000px ほど増えているのは、次の2つを **意図して** 足したためです。

1. 日本語の折り返しを「文節単位」に変更した（`word-break: auto-phrase`）。
   「目／標還元率」「管理／画面」のような割れ方はなくなりましたが、
   1行に入る文字数が減るぶん、行数が増えます。読みやすさを優先しました。
2. 新しく大きなセクションを3つ追加した
   （SECTION 01 ガチャ生成 5,184px ／ SECTION 02 お客様の画面 4,536px ／
   SECTION 03 役割分担 5,164px ＝ 合計 約14,900px）。

そのうえで、重複していたセクションを5つ削除し、
DATA FLOW・役割の箇条書き・RUSH の2枚組・時間削減の見出しを畳んでいます。
差し引きで「長さはほぼ同じまま、中身が増えた」状態です。

## 一覧（13カット × PC / スマホ）

| No | 見せ場 | PC | スマホ |
|---|---|---|---|
| 01 | ファーストビュー | [pc-01-hero.png](pc-01-hero.png) | [sp-01-hero.png](sp-01-hero.png) |
| 02 | AIへの指示（自然な言葉で伝える） | [pc-02-instruct.png](pc-02-instruct.png) | [sp-02-instruct.png](sp-02-instruct.png) |
| 03 | AIが作る（賞構成が組み上がる） | [pc-03-generate.png](pc-03-generate.png) | [sp-03-generate.png](sp-03-generate.png) |
| 04 | 承認する（APPROVE → PUBLISH） | [pc-04-approve.png](pc-04-approve.png) | [sp-04-approve.png](sp-04-approve.png) |
| 05 | お客様の画面でガチャを引く | [pc-05-customer-gacha.png](pc-05-customer-gacha.png) | [sp-05-customer-gacha.png](sp-05-customer-gacha.png) |
| 06 | 6ステップの役割分担（人 / AI） | [pc-06-roles.png](pc-06-roles.png) | [sp-06-roles.png](sp-06-roles.png) |
| 07 | 公開前バックテスト | [pc-07-backtest.png](pc-07-backtest.png) | [sp-07-backtest.png](sp-07-backtest.png) |
| 08 | 販売中の監視（実還元率） | [pc-08-monitoring.png](pc-08-monitoring.png) | [sp-08-monitoring.png](sp-08-monitoring.png) |
| 09 | 発送 | [pc-09-shipping.png](pc-09-shipping.png) | [sp-09-shipping.png](sp-09-shipping.png) |
| 10 | AIの問い合わせ対応 | [pc-10-ai-support.png](pc-10-ai-support.png) | [sp-10-ai-support.png](sp-10-ai-support.png) |
| 11 | 料金 | [pc-11-pricing.png](pc-11-pricing.png) | [sp-11-pricing.png](sp-11-pricing.png) |
| 12 | FAQ（Q01 / A01 形式） | [pc-12-faq.png](pc-12-faq.png) | [sp-12-faq.png](sp-12-faq.png) |
| 13 | 最終CTA | [pc-13-final-cta.png](pc-13-final-cta.png) | [sp-13-final-cta.png](sp-13-final-cta.png) |

作り直す前の状態は `../before/` にあります。

## 5秒テストの結果

初めて見た人が5秒で分かるか、実際の画面で確認した結果です。

| 質問 | 答えている場所 | 判定 |
|---|---|---|
| これは何の商品か | ファーストビュー「オンラインガチャ運営を、仕入れ以外ほぼ自動化。」＋「オンラインガチャ / オリパ 事業者向け」 | OK |
| 自分は何をするのか | SECTION 03「運営の流れは6つ。全部をあなたがやる必要はありません。」＋ 各ステップの HUMAN / AI 表示 | OK |
| AIは何をしてくれるのか | SECTION 01「ガチャの作り方が分からなくても大丈夫。」＋ AI ステップ4つ | OK |
| お客様にはどう見えるのか | SECTION 02「管理が簡単でも、お客様が楽しめなければ意味がありません。」 | OK |
| なぜ運営が簡単になるのか | SECTION 03「人が判断するのは、「確認」と「実物の対応」が中心。」＋ TIME SAVED | OK |

## 折り返しの監査

1440 / 1280 / 1024 / 768 / 430 / 390 / 375px の7段階で、
文字が語の途中で折れていないかを1文字ずつ測って確認しています。

- 375px の指摘：32件 → **25件**
- 残った25件はすべて、スペース・「・」・別々の行に積んだ文字での折り返し
  （日本語として正しい切れ目）

## 撮り直すとき

```
npm run build && npx next start -p 3210     # 本番と同じ状態で立ち上げる
node /tmp/gos-after.mjs                      # 13カットを撮る（PC / スマホは切り替え）
```

撮る前に、3210番ポートに古いサーバーが残っていないか必ず確認すること。
`next start` は起動後に `next-server` へ名前が変わるため、
`pkill -f "next start"` では止まりません。
`lsof -nP -iTCP:3210 -sTCP:LISTEN -t` で番号を調べて止めること。
