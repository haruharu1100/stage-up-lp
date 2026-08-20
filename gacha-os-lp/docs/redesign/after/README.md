# AFTER スクリーンショット一覧（2026-08-20）

撮影条件

- 本番ビルド（`npm run build` → `next start -p 3210`）を実際に開いて撮影
- PC = 1440 × 900 / スマホ = 390 × 844（iPhone 相当・Retina 2倍）
- スクロール演出が終わるのを待ってから撮影。動き続けるものだけ停止
- 撮影中のブラウザのエラー：**0件**

ページの長さ（短縮後）

| | 短縮前 | 短縮後 | 変化 |
|---|---|---|---|
| スマホ 390px | 98,229px | 63,860px | **−35%** |
| PC 1440px | 59,812px | 48,665px | −19% |

## 一覧

| No | 見せ場 | PC | スマホ |
|---|---|---|---|
| 01 | ファーストビュー | [pc-01-hero.png](pc-01-hero.png) | [sp-01-hero.png](sp-01-hero.png) |
| 02 | 3D → 本物の管理画面 | [pc-02-realscreen.png](pc-02-realscreen.png) | [sp-02-realscreen.png](sp-02-realscreen.png) |
| 03 | 30秒デモ動画 | [pc-03-video.png](pc-03-video.png) | [sp-03-video.png](sp-03-video.png) |
| 04 | 6ステップ | [pc-04-sixsteps.png](pc-04-sixsteps.png) | [sp-04-sixsteps.png](sp-04-sixsteps.png) |
| 05 | 人とAIの役割分担 | [pc-05-role.png](pc-05-role.png) | [sp-05-role.png](sp-05-role.png) |
| 06 | AIガチャ生成 | [pc-06-builder.png](pc-06-builder.png) | [sp-06-builder.png](sp-06-builder.png) |
| 07 | 実還元率モニタ | [pc-07-rtp.png](pc-07-rtp.png) | [sp-07-rtp.png](sp-07-rtp.png) |
| 08 | 市場価格 → AI ALERT → 停止 | [pc-08-price.png](pc-08-price.png) | [sp-08-price.png](sp-08-price.png) |
| 09 | 公開前バックテスト | [pc-09-backtest.png](pc-09-backtest.png) | [sp-09-backtest.png](sp-09-backtest.png) |
| 10 | 発送管理 | [pc-10-shipping.png](pc-10-shipping.png) | [sp-10-shipping.png](sp-10-shipping.png) |
| 11 | AI OPERATOR | [pc-11-support.png](pc-11-support.png) | [sp-11-support.png](sp-11-support.png) |
| 12 | 信号機 / UNKNOWN | [pc-12-signals.png](pc-12-signals.png) | [sp-12-signals.png](sp-12-signals.png) |
| 13 | 導入効果の試算 | [pc-13-roi.png](pc-13-roi.png) | [sp-13-roi.png](sp-13-roi.png) |
| 14 | 料金 | [pc-14-pricing.png](pc-14-pricing.png) | [sp-14-pricing.png](sp-14-pricing.png) |
| 15 | 最終CTA | [pc-15-contact.png](pc-15-contact.png) | [sp-15-contact.png](sp-15-contact.png) |
| 16 | フッター（販売事業者） | [pc-16-footer.png](pc-16-footer.png) | [sp-16-footer.png](sp-16-footer.png) |
| 17 | 個人情報の取り扱い | [pc-17-privacy.png](pc-17-privacy.png) | [sp-17-privacy.png](sp-17-privacy.png) |

短縮前の状態は `../before/` にあります。

## 撮り直すとき

```
npx next build && npx next start -p 3210     # 本番と同じ状態で立ち上げる
node /tmp/gos-shots.mjs                       # PC・スマホをまとめて撮る
```

撮る前に、3210番ポートに古いサーバーが残っていないか必ず確認すること
（古いサーバーが残っていると、見た目が崩れた画面を撮ってしまう）。
