---
作成日: 2026-08-20
種別: 正式仕様
状態: 実装済（Googleスプレッドシート＝LIVE_READY。AliExpressは鍵待ち）
---

# 11. 仕入先LIVEデータ仕様（＝仕入先データの「受け取り口」）

> [!warning] 2026-08-20 追記：この文書の範囲を明確にする
> ここに書いてあるのは **「人が作った商品一覧を受け取る入口」** の話（Googleスプレッドシート／CSV／各社API）。
> **「安い商品を自分で見つけてくる」機能ではない。** それは別の層 → **[[12_仕入先自動探索仕様]]**
>
> | | 受け取り口（この文書） | 自動探索（[[12_仕入先自動探索仕様|12番]]） |
> |---|---|---|
> | 誰が商品を選ぶ | **人**（スプレッドシートに書く） | **システム** |
> | 実装 | `SupplierProvider` | `SupplierDiscoveryProvider` |
> | 状態 | `sheets` が **LIVE_READY** | **`LIVE_DISCOVERY_READY` は0件（鍵待ち）** |

> [!important] この仕様が存在する理由
> Amazon側（Keepa・手数料）は本番データになった。だが **仕入先が架空のままだと、利益計算は丸ごと嘘になる。**
> 「Amazon側＝本番／仕入先＝サンプルの架空値」という混ざり方が、いちばん危険。
> また、毎回20〜40商品のCSVを手作業で作る運用は続かない。**一度設定したら自動で取れる状態**にする必要があった。

---

## 1. 大原則（絶対に崩さない）

1. **非公式スクレイピングをしない。** 公式API／正式なデータフィード／提携API／CSV／Googleスプレッドシート／仕入先提供データだけを使う。
2. **「Adapterがある」「差込口がある」だけを完成扱いにしない。** 実際に本物のデータが取れるかで判定する。
3. **取れない項目は UNKNOWN のまま。推測で埋めない。**
4. **失敗を「0件」で黙って隠さない。** 接続に失敗したら必ず日本語のエラーを出して止まる。
5. **お金が動く処理は禁止のまま**：`AUTO_PURCHASE=false` / `AMAZON_AUTO_PUBLISH=false` / `AD_AUTO_OPTIMIZE=false` / `AUTO_REORDER=false` / `RESEARCH_AUTO_APPROVE=false`。

---

## 2. Providerごとの実態監査（2026-08-20 実施）

> [!warning] 監査前の状態＝**3つとも本物ではなかった**
> Alibaba / 1688 / AliExpress の3つは、実体は **同じ1つのクラス**が動いていただけだった。
> 中身は `Authorization: Bearer <APP_SECRET>` ＋ `method=product.search` ＋ `json.products` を読む実装で、
> **3社のどの公式仕様にも合致しない、こちらで作った架空の呼び方**だった。鍵を入れても動かない状態。

| Provider | 判定 | 理由 | 必要なもの |
|---|---|---|---|
| **Googleスプレッドシート** | **`LIVE_READY`** | 契約・審査・費用ゼロ。1回共有設定すれば以後は自動取得 | 共有URLを `.env` に入れるだけ |
| **CSV**（`data/supplier_listings.csv`） | `LIVE_READY` | ファイルを置けばその場で本物として読む | **毎回自分で置き直す手間がある** |
| **AliExpress** | `PARTIAL` →鍵が入れば `LIVE_READY` | 公式仕様どおりに実装し直し済み。鍵がまだ無い | 開発者登録＋Dropshipping申請（無料／目安2〜5営業日） |
| **Alibaba.com（ICBU）** | `PARTIAL` | 公式APIと必要項目は存在するが、セルフ登録できる区分が出品者向け。**バイヤー用権限は個別審査で、承認期間の公式記載なし** | 開発者登録→アプリ区分承認→Buyer系API権限の個別申請 |
| **1688** | **`UNAVAILABLE`** | 中国本土の実名認証済みAlipayが必須。商品検索APIはホワイトリスト＋GMV要件（月16万CNY 等）に紐づく。第三者の「API代理販売」は非公式のため**規約上使わない** | （当面使わない。代行業者の提供データをスプレッドシートで受け取る方が確実） |
| sample | `MOCK_ONLY` | 練習用。実在の商品でも価格でもない | — |

### 実装のやり直し内容
- **AliExpress**：公式仕様に合わせて全面書き直し。
  - ゲートウェイ `https://api-sg.aliexpress.com/sync`
  - 署名＝`sign` 以外の全パラメータ（`method` 含む）をASCII昇順に並べ、`キー+値` を区切りなしで連結し **HMAC-SHA256 → 大文字16進**
  - `aliexpress.ds.text.search` は **access_token 不要**（APP_KEY と APP_SECRET だけで動く）
  - ※アフィリエイトAPIはMOQ・在庫が取れないため、仕入判断には使えない → 不採用
- **Alibaba / 1688**：**偽のリクエストを投げない**ため、接続せず「未接続」と正直に表示する `NotConnectedSupplierProvider` に置き換えた。

---

## 3. Googleスプレッドシート仕入先（今の本命）

- 実装：`lib/providers/supplier.ts` → `GoogleSheetsSupplierProvider`（名前 `sheets`）
- 3つの読み方に対応：
  1. **公開URL方式**（推奨）… `SUPPLIER_SHEET_URL` に共有URLを貼るだけ。APIキー不要・費用ゼロ・審査ゼロ
  2. **シートID方式** … `SUPPLIER_SHEET_ID`（＋タブ指定 `SUPPLIER_SHEET_GID`）
  3. **APIキー方式** … 非公開のまま読みたい時だけ `GOOGLE_SHEETS_API_KEY` ＋ `SUPPLIER_SHEET_RANGE`
- 60秒キャッシュあり（同じリサーチ中に何度も取りに行かない）
- **ログイン画面のHTMLが返ってきた場合は「共有設定ができていません」と日本語で止める**（HTMLをCSVとして誤読しない）
- 401 / 403 / 404 もそれぞれ日本語で理由を出す

### ユーザーがやること（1回だけ）
1. Googleスプレッドシートに仕入先の商品一覧を作る（1行目が見出し）
2. 右上「共有」→「リンクを知っている全員」→「**閲覧者**」
3. ブラウザのURLをそのまま `.env` の `SUPPLIER_SHEET_URL=` に貼る

→ 以後は **毎回自動で読む。CSVを手で置く作業は不要**。

---

## 4. 必ず持ち歩く18項目

`supplier_name` / `supplier_product_id` / `product_name` / `product_url` / `image_url` /
`price` / `currency` / `minimum_order_quantity` / `stock` / `brand` / `model_number` /
`jan` / `gtin` / `size` / `weight` / `color` / `shipping_cost` / `updated_at`

- 取れなかった項目は `unknownFields` に名前を記録し、**UNKNOWNのまま**扱う（推測で埋めない）
- `stock` は **0 と 不明 を厳密に区別する**（0＝在庫切れ／null＝分からない）
- `updated_at` が読めない時に **今日の日付で埋めない**

---

## 5. 仕入先データの品質区分（Amazon側の判定とは別物）

| 区分 | 意味 | Aランクにできるか |
|---|---|---|
| `LIVE` | 実在の仕入先から取得した本物。必須項目が全部そろっている | ○ |
| `ESTIMATED` | 本物のデータだが、画像・更新日時・MOQ・送料・在庫のどれかが取れていない | ○（ただし画面に「一部不足」と出す） |
| `UNKNOWN` | 仕入先名・商品名・URL・価格・通貨のどれかが欠けている | **×（Bへ降格）** |
| `MOCK` | サンプル（練習用）。実在の商品でも価格でもない | **×（Bへ降格）** |

- **画面に `SUPPLIER DATA: LIVE` と出せるのは、全件が LIVE の時だけ。**
- DBに保存する（`supplier_data_quality` / `supplier_quality_note` / `supplier_unknown_fields` / `supplier_stock` / `supplier_updated_at`）。
  **後から読み直す時に作り直してLIVEに格上げしない。**

---

## 6. 追加した安全弁（Research Score・A/B/C/Dの基準そのものは変更していない）

> [!note] 機能凍結ルールとの関係
> [[09_機能追加凍結と本番20商品検証]]の「Research Score の基準変更禁止／A・B・C・Dの判定基準変更禁止」は守っている。
> 追加したのは **Aランクにしないための降格ガード**だけ（点数の付け方・しきい値は一切いじっていない）。

1. **商品URLが無い商品はAランクにしない。**
   「この商品を実際にどこから買えるか」が分からないものを仕入候補の最上位にしない。
2. **仕入先がサンプル（MOCK）ならAランクにしない。**
3. **仕入先データがUNKNOWN（必須項目が欠けている）ならAランクにしない。**
4. **仕入先の商品画像が1枚も無い場合、MATCH SCOREで「高信頼の同一商品」と自動判定しない。**
   （除外はしない。人が確認すれば通せる帯に留めるだけ）

---

## 7. Supplier LIVE監査（Keepa本番20商品テストの前に必ず通す関門）

- コマンド：`npm run supplier:audit`（`npm run supplier:audit -- 40` で件数指定）
- API：`POST /api/supplier/audit`
- **利益判定は一切しない。Amazon検索もKeepaも呼ばない。お金も動かない。**

### 見る7項目
1. 仕入先商品が本当に取れたか
2. **商品URLが実際に開けるか**（HEAD→ダメならGETで確認。中身は読まない）
3. 価格が入っているか（桁がおかしくないか）
4. 通貨が正しいか
5. 画像URLが実際に開けるか
6. 最小ロット（MOQ）が入っているか
7. 更新日時が入っているか

### 合格条件（甘くしない）
- 1件以上取れている
- **サンプル（MOCK）が1件も混ざっていない**
- 価格と通貨が**全件**正しい
- **商品URLが実際に開けた割合が7割以上**

→ 合格して初めて `npm run prelive` → Keepa本番20商品テストへ進む。

---

## 8. 動作確認の結果（2026-08-20）

- `npx tsc --noEmit` エラー0／`npm run build` 成功
- スプレッドシートに見立てたCSVをHTTPで配信して実走：
  - `sheets` プロバイダが `LIVE_READY` / 使用中と表示された
  - 18項目のうち14〜16項目を取得、残りは `stock / brand / jan / updated_at` として **UNKNOWNのまま**記録（推測で埋めていない）
  - 品質は `ESTIMATED` と判定された（更新日時と在庫数が無いため）
  - **商品URLが `example.com`（存在しない）だったので監査は正しく「不合格」を出した** → 監査が形だけになっていないことを確認
- Keepa本番と組み合わせたパイプライン実走で、`supplier_data_quality` などがDBに正しく保存されることを確認（確認用の実行結果はその場で削除済み）

---

## 9. 現在の残ブロッカー

| # | 内容 | 誰がやるか |
|---|---|---|
| 1 | **Googleスプレッドシートを作って共有URLを `.env` に入れる** | ユーザー（10分ほど） |
| 2 | （任意）AliExpress開発者登録→Dropshipping申請→鍵を入れる | ユーザー（審査 目安2〜5営業日） |
| 3 | 上記が入ったら `npm run supplier:audit` を通す | AI |
| 4 | 合格後に `npm run prelive` → Keepa本番20商品テスト | AI＋ユーザー確認 |

**AlibabaのBuyer権限と1688は、当面は待たない。** 代行業者・問屋からの提供データをスプレッドシートで受け取る方が早くて確実。

---

## 関連
- [[00_仕様書_最上位]]
- [[06_リサーチツール仕様]]
- [[09_機能追加凍結と本番20商品検証]] ← ★発効中
- [[10_Amazon手数料Provider仕様]]
- [[04_契約すべきAPIと優先順位]]
- [[12_仕入先自動探索仕様]] ← 自分で探しに行く層（この文書とは別）
- [[13_AliExpress申請手順]] ← ★いま唯一のブロッカー
