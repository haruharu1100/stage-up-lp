# SEO-000 ［施策の名前を1行で］

作成日：YYYY-MM-DD ／ 担当：Codex ／ 承認者：［人の名前］

## 何を変えるか（1施策1枚。まとめて書かない）
- 対象URL：
- 変えること：
- **変えないこと**：（例：料金そのもの、デザイン、他ページ）

## なぜ変えるか
- 顧客の質問：
- 観測した事実：（出典と取得日）
- 原因の仮説：

## 使ってよい事実
- `sources/claims.csv` の行ID：（例 BIZ-001）
- ここに無い数字・実績は本文に書かない。

## 合格条件（機械で検査する。ここを緩めて通すのは禁止）
下のブロックは `python3 tools/verify_task.py tasks/SEO-000.md` がそのまま読む。

```合格条件
url: https://example.com/pricing
status: 200
noindex: false
canonical_self: true
mobile_viewport: true
must_contain: ［必ず表示されていてほしい文言］
must_not_contain: ［残っていてはいけない文言］
link_ok: https://example.com/cases/sample
```

使えるキー：
- `url` … 検査するページ（複数書ける）
- `status` … 期待するHTTP応答（既定200）
- `noindex` … false なら「検索に出る設定であること」を確認
- `canonical_self` … true なら自分自身を正規URLに指していること
- `mobile_viewport` … true ならスマホ表示の設定があること
- `must_contain` / `must_not_contain` … 本文テキストに対する検査（複数書ける）
- `link_ok` … そのリンク先が実際に開けること（複数書ける）

## 戻し方
- 変更前の状態：（コミットIDやバックアップ先）
- 戻す手順：

## 実行記録（AIが埋める）
- 実行したコマンド：
- 結果：
- 未実行の検査と理由：
- 残課題：
