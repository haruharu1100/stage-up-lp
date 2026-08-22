# AI BUSINESS OS

海外のAIビジネスを見つけ、日本で売れるかを数字で確かめ、商品にして、売れたかどうかを記録し、次の判断に活かすためのシステム。
**記事を量産する道具ではなく、利益を出せるAI事業を選ぶための道具。**

- 画面: http://localhost:3930
- データ: `data/business.db`（libsql / ローカルファイル）
- 長期記憶: `../事業Vault/AI_BUSINESS_OS/`（Obsidian）

## 使う順番

```
npm install
npm run init        # データベースを作る（最初の1回だけ）
npm run collect     # 海外からAIビジネス案件を集める
npm run evaluate    # 日本市場を見て100点満点で採点する
npm run backtest    # 市場の伸びと販売シミュレーションを回す
npm run productize -- idea_xxxx   # 商品階層と原稿を作る
npm run report      # 今の数字をまとめて表示
npm run obsidian    # Obsidianへ書き戻す（作業終わりに必ず）
npm run dev         # 画面を開く
npm run test        # 受入テスト（46件）
```

## 安全設計（絶対に変えないこと）

外部への副作用は**二重ロック**でふさいでいる。

1. 環境変数がすべて false: `AUTO_PUBLISH` / `AUTO_CALL` / `AUTO_EMAIL` / `AUTO_DM` / `AUTO_CHARGE`
2. そもそも実装が存在しない: `MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED = false`

投稿・架電・メール送信・課金のコードは1行も書かれていない。原稿は作るが、公開は人が手でやる。
`npm run test` がメール送信・架電・課金・X投稿ライブラリの不在を毎回チェックしている。

## データを正直に扱う仕組み

- 取れなかったデータを 0 として扱わない。`DATA_AVAILABLE` / `NO_DATA` / `API_ERROR` / `BLOCKED` / `RATE_LIMIT` / `AUTH_ERROR` / `PARSE_ERROR` に分けて記録する。
- 母数が30件未満のときは率を計算せず `INSUFFICIENT_DATA` を返す。
- 採点は根拠の強さを `EVIDENCE` / `HUMAN` / `HEURISTIC` / `NONE` に分け、強い根拠が配点の50%に満たない案件は点数が高くても **判定不能** にする。
- バックテストで言及数が5件未満のときは伸び・減りを判定しない。
- 金額はすべて円の整数、日時はすべてISO8601。未計測の列はNULLのまま（0で埋めない）。

## 情報源

スクレイピングは一切しない。認証不要の公式APIと手入力CSVだけ。

- 接続済み: Hacker News（Algolia公式検索API）、GitHub（REST検索API）、手入力CSV
- 未接続（12件）: Product Hunt / Reddit / X / Y Combinator / Indie Hackers / AppSumo / Gumroad / Lemon Squeezy / Whop / Substack / Crunchbase / arXiv
  - 未接続は「0件」ではなく「未接続」として `lib/sources/registry.ts` に理由つきで残してある。

## 人が手で埋めるファイル

システムが勝手に決めない部分。ここが空だと案件は**判定不能**のままになる（それが正しい動作）。

| ファイル | 中身 |
| --- | --- |
| `data/japan-checks.csv` | 日本語で検索した結果のヒット数（配点15点。最大の項目） |
| `data/idea-ratings.csv` | 顧客の痛み・営業のしやすさなど、人の判断で0〜5点 |
| `data/manual-ideas.csv` | APIで拾えなかった案件を手で追加する |

## 100点の内訳

海外成長性10 / 日本未普及度15 / 市場規模10 / 顧客の痛み10 / 継続課金10 / 粗利益10 / 開発容易性5 / 営業容易性10 / 差別化10 / 自動化可能性10

85点以上=S / 75〜84=A / 65〜74=B / 50〜64=C / 49以下=却下。**原則Aランク以上だけを事業化候補にする。**

## Obsidianへの保存

`npm run obsidian` で `../事業Vault/AI_BUSINESS_OS/` の12フォルダへ書き戻す。
`manual: true` と書かれたファイルは絶対に上書きしない（人が書いたメモを守るため）。
`../事業Vault/20_KNOWLEDGE/claims.jsonl` へは作業ログとして1行追記する。

## 表現の規制

`lib/compliance.ts` が原稿を自動チェックする。
「必ず儲かる」「絶対」などの断定、二重価格、「残り◯名限定」といった煽りは**公開不可**として弾く。
電話・メール配信・個人情報・医療・投資に触れる文言は「要専門家確認」として印をつける。
