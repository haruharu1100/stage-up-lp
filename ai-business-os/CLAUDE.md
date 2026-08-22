# CLAUDE.md — ai-business-os

作業前に必ず `README.md` を読むこと。

## このプロジェクトで絶対に守ること

1. **外部副作用のコードを書かない。** 投稿・架電・メール送信・DM・課金の実装は存在しない。追加もしない。
   `lib/env.ts` の `MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED = false` と `AUTO_*` フラグは false のまま。
   `scripts/test-core.ts` が nodemailer / twilio / stripe / X API / cheerio・puppeteer・playwright の不在を検査している。この検査を緩めない。
2. **スクレイピングしない。** 認証不要の公式APIと手入力CSVだけ。
3. **取れなかったデータを0にしない。** 必ず `DataStatus` で理由を分けて記録する。
4. **数字はコードで計算する。** LLMに金額・点数・分類を計算させない。
5. **根拠がないなら判定不能を返す。** 母数30件未満で率を出さない。強い根拠が配点の50%未満なら grade は `INSUFFICIENT_DATA`。
6. **バックテスト結果なしに「売れる」「儲かる」「伸びる」と書かない。**
7. 法律判断が要る内容は「要専門家確認」として出す。断定しない。

## 変更したら必ず

```
npm run test        # 46件。1件でも落ちたら直すまで進めない
npm run obsidian    # CURRENT_STATE / NEXT_ACTIONS / CHANGELOG を更新
```

## 判定不能が多いのは異常ではない

`data/japan-checks.csv` と `data/idea-ratings.csv` が空だと全案件が判定不能になる。
これは設計通り。人が調べて埋めるまで、システムは勝手に良し悪しを決めない。
