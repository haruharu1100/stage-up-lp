# SEO・AIO 集客OS

自社サイトの集客を「勘」ではなく「見て・直して・確かめる」で回すための道具箱。

考え方の正本は Obsidian の
`事業Vault/🔍 SEO・AIO集客プレイブック（Astra調査×Codex実装）.md`。
このフォルダは、そこに書いた手順のうち **機械にやらせる部分** を実装したもの。

- 調べる・考える … 人＋AI（プレイブック側）
- 決める … 人（承認）
- 直す・確かめる … この道具（毎回同じ基準で機械が判定する）

## 使うのに必要なもの

Python3 だけ。インストールするものは **何もない**（標準ライブラリのみで書いてある）。
半年後に別のPCで動かしても壊れないようにするため、意図的に依存を持たせていない。

## 4つの道具

すべて `seo-aio-os/` の中で実行する。

### 1. ページ検査 — 自社ページの作りの不備を洗い出す

```
python3 tools/audit_pages.py review-blog                 # sitemapから最大30ページ
python3 tools/audit_pages.py review-blog --limit 100
python3 tools/audit_pages.py review-blog --urls /price /contact
```

タイトル・説明文・正規URL・noindex・見出し・本文量・スマホ設定・CTAリンク・
画像のalt・構造化データと画面の食い違い、を1ページずつ見る。
結果は `artifacts/<日付>/audit_<サイト>.csv`（生データ）と `.md`（読む用）。

### 2. 検索データの分析 — どこで止まっているかを出す

Search Console と GA4 の管理画面から［エクスポート］したCSVを渡す（APIの鍵は不要）。

```
python3 tools/analyze_search.py --site review-blog --gsc-queries クエリ.csv
python3 tools/analyze_search.py --site review-blog --gsc-pages ページ.csv --ga4 チャネル.csv
```

出るもの：順位帯ごとの自社CTR中央値／表示は多いのにクリックが少ない語／
あと一歩（11〜20位）／自社名の検索とそれ以外／GA4のチャネル内訳。

### 3. 公開前チェック — 出してはいけない文章を止める

```
python3 tools/check_claims.py 記事.md
python3 tools/check_claims.py ../affiliate/lp
```

止めるのは3つだけ。
①景品表示法に触れる言い方（断定・誇大・最上級・二重価格・煽り）
②`sources/claims.csv` に無い数字や実績
③使っていない商品を「使った」と書く体験談のふり

### 4. 合格条件チェック — 直した結果を本物のページで確かめる

```
python3 tools/verify_task.py tasks/SEO-001.md
```

施策票に先に書いておいた「合格条件」を、公開中のページで実際に検査する。
1つでも満たしていなければ不合格（終了コード1）。

## 進め方（1施策ずつ）

1. `tools/audit_pages.py` と `tools/analyze_search.py` で事実を出す
2. 直す候補を `strategy/seo-aio.md` に仮説つきで並べる
3. **1件だけ** `tasks/SEO-xxx.md` を作る（`tasks/TEMPLATE.md` をコピー）。
   このとき **合格条件を先に書く**
4. 直す → 公開 → `tools/verify_task.py` で合格を確認
5. 数字は `measurement/metrics.md` の定義どおりに数える

## 絶対に守ること

- **他社サイトを巡回しない。** `config/sites.json` の `own_domains` に無いドメインは、
  道具の側が取得を拒否して止まる。この安全装置は外さない。
- **合格させるために合格条件やチェックを消さない。** 落ちたらページのほうを直す。
  条件が間違っていた時だけ、理由を書いて条件を直す。
- **手元に無い数字を作らない。** 検索ボリューム・難易度・「何件増える」の予測は出さない。
  分からないものは「不明」と書く。
- 数字や実績を本文に書くときは、必ず `sources/claims.csv` に
  「主張・根拠・出典・確認日・使用可否」を登録してから。

AIに作業させるときのルールは `AGENTS.md` に書いてある。

## 自己テスト

```
python3 tests/run_tests.py
```

127.0.0.1 に検査用の偽サイトを立てて、道具が「正しく通す／正しく落とす」かを確かめる。
本物のサイトにはつながないので、ネットが無くても実行できる。
**道具を触ったら必ず実行する。** 落ちたまま公開しない。

## フォルダの中身

| 場所 | 何が入っているか |
|---|---|
| `config/sites.json` | 検査する自社サイトの定義（安全装置の `own_domains` もここ） |
| `context/business.md` | 誰に何を売るか。施策の取捨選択はここに照らして決める |
| `strategy/seo-aio.md` | 施策台帳（未着手→実装済→検証済→承認済→公開済→成果観測済） |
| `measurement/metrics.md` | 数え方の定義。流入と有効な問い合わせを混ぜない |
| `sources/claims.csv` | 本文に書いてよい事実の台帳（出典と確認日つき） |
| `tasks/` | 1施策1枚の施策票。`TEMPLATE.md` をコピーして使う |
| `tools/` | 4つの道具 |
| `tests/` | 自己テスト |
| `artifacts/` | 検査の出力（gitに入れない。毎回作り直せる） |
