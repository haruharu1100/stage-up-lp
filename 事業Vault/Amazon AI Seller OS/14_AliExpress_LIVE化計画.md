# 14_AliExpress LIVE化計画（正式仕様）

作成日：2026-08-20
対象：amazon-ai-seller-factory（ポート3900）
上位文書：`00_仕様書_最上位.md` ／ 関連：`12_仕入先自動探索仕様.md`・`13_AliExpress申請手順.md`

> [!important] ★2026-08-20 追記：手順の実行部分は [[15_鍵待ちフェーズと投入直後テスト]] へ移りました
> この文書は**全体像と4段階ゲートの考え方**を持ちます。
> 「鍵が届いた日に、実際にどのコマンドを何の順番で叩くか」は 15 が正です。
> あわせて次の2点が**この文書の記載より厳しくなっています**（15 が優先）。
> - `LIVE_DISCOVERY_READY` の条件が **4段階 → 8条件**（＋実商品取得・購入URL・価格・Amazon照合）
> - VERIFIED の条件に **「HTTP 200 でも中身がエラーでないことの確認」** が追加

---

## 0. この文書がある理由

**存在しないAPIを実装してしまった事故**が起きた。
「API名を見つけた」「コードを書いた」「Adapterを作った」だけで完成扱いにしていたのが原因。

そこで、**4段階すべてを通過しないと完成扱いにしない**という決まりを作り、
それをコードとDBで強制した。この文書はその決まりと、いま何段階目にいるかの記録。

---

## 1. 4段階の関門（これがこのシステムの一番上のルール）

| 段階 | 名前 | 意味 | これが無いとどうなるか |
|---|---|---|---|
| 0 | UNVERIFIED | 何も確認していない | 使わない |
| 1 | DOCUMENTED | **公式ドキュメントで存在確認** | 公式資料のURLが無いものは DOCUMENTED にしない（自動で0段階へ降格） |
| 2 | AUTHORIZED | **実際に権限取得** | 権限が無いのに「取れるはず」と書かない |
| 3 | CONNECTED | **本物のAPIへの認証成功** | 署名が通ったことを実際に確認する |
| 4 | VERIFIED | **実商品を取得して内容を確認** | 実データを見るまで完成ではない |

**`LIVE_DISCOVERY_READY = true` は、4つ揃ったAPIが1つ以上ある時だけ。**

- 実装：`lib/providers/apiContractRegistry.ts`（テーブル `api_contract_registry`）
- 判定：`lib/providers/supplierDiscovery.ts` の `discoveryLiveReady()`
- 確認：`npm run api:registry`
- ★「鍵がある＝完成」ではない。以前は画面が鍵の有無だけで「自動探索できます」と表示していたが、
  これは規則違反だったため 2026-08-20 に4段階ゲート判定へ差し替えた。

---

## 2. いまの状態（2026-08-20 時点）

### 2-1. 5つのAPIの段階

| API名 | 段階 | 公式資料 | 備考 |
|---|---|---|---|
| `aliexpress.affiliate.product.query` | **DOCUMENTED（1）** | cid=21407 | ★アフィリエイト対象商品しか返らない（docId 1909） |
| `aliexpress.ds.text.search` | **DOCUMENTED（1）** | cid=21038 / docId 1695 | 購入ページURL（itemUrl）はここで取れる |
| `aliexpress.ds.product.get` | **DOCUMENTED（1）** | cid=21038 / docId 9256 | MOQ・在庫・重量・店舗名はここでしか取れない。**URLは返らない** |
| `aliexpress.ds.freight.query` | **DOCUMENTED（1）** | cid=21038 / docId 1579 | 送料は `shipping_fee_cent`（1/100単位） |
| `aliexpress.ds.image.searchV2` | **DOCUMENTED（1）** | cid=21038 / docId 1748 | 綴りは searchV2（大文字V）。similarity_score が返る |

**VERIFIED は 0件。したがって `LIVE_DISCOVERY_READY = false`。**
止まっている理由は「鍵（APP_KEY / APP_SECRET）がまだ無い」から。段階を飛ばせない決まりなので、正しく止まっている。

### 2-2. 申請条件の調査結果（公式で確認できたものだけ）

| 項目 | 結果 |
|---|---|
| Individual（個人）申請 | **可能** |
| 日本からの登録 | **UNKNOWN**（公式で断定できる記載を見つけられなかった） |
| Dropshippingカテゴリの現存 | **あり**（cid=21038） |
| Affiliate と Dropshipping の併用 | **不可**（docId 1935）。**1アカウントでどちらか一方だけ** |
| 開発者種別の後からの変更 | **不可**（docId 1868）。登録時に決めたら変えられない |
| APP_KEY / APP_SECRET | 登録後に発行される |
| ACCESS_TOKEN | **必要**。★アフィリエイト系も必要（docId 1957・1936） |
| 審査 | あり |
| 料金 | 公式表記は「temporarily free（当面無料）」＝将来変わる可能性あり |
| 呼び出し上限 | ds.product.get＝500回/秒、ds.freight.query＝350回/秒、text.search・image.searchV2＝**UNKNOWN** |

#### ★重要な訂正（2026-08-20）
以前この仕様には「`aliexpress.affiliate.product.query` はアクセストークン不要」と書いていた。**これは誤り**。
公式FAQ（docId 1957「Get the authorization (oauth)」／docId 1936「Generate access_token for call API」）により、
アフィリエイト系も access_token を取って呼ぶ前提へ改めた。
コード側6箇所（レジストリ・API一覧コメント・probe・prelive-check・verify-discovery・Provider本体）を訂正済み。

#### ★申請前に決めなければいけないこと
**Affiliate と Dropshipping は併用できず、後から変更もできない。**
仕入先探しが目的なので、**Dropshipping（DS）を選ぶ**のが筋。
理由：MOQ・在庫・重量・店舗名・実送料・画像検索は DS 側にしかなく、
Affiliate 側は「アフィリエイト対象商品しか返らない」ため仕入先探しには狭すぎる。

---

## 3. Aランクの条件（変更禁止）

App Key / Secret だけで商品が探せるようになっても、
**送料・MOQ・重量・重要コストが UNKNOWN なら A ランクにしない。B または要確認にする。**

さらに 2026-08-20 に追加：

**購入ページURL（PURCHASE_URL）が取れない商品も A ランクにしない。**

- 必須項目の定義：`lib/types.ts` の `SUPPLIER_CRITICAL_FIELDS`（`product_url` を含む）
- 強制：`lib/providers/supplierCommon.ts`
- **URLは推測で作らない。** 4つの仕入先すべてで、返ってきたURLをドメイン制限の関門に通してから使う
  （`lib/providers/aliexpressValues.ts` の `acceptPurchaseUrl` / `acceptUrlOnHosts`）。
  AliExpress以外のドメイン・`javascript:` などは全部はじく。
- 画面：`/research` に「仕入先を見る（購入ページを開く）」ボタン。
  URLが無い商品はボタンを出さず、「取れていません。推測でURLは作りません。この商品はAランクにしません」と表示する。

---

## 4. 失敗を「0件」で隠さない

以前、**逆方向の探索が壊れているのに画面には「0件」とだけ出ていた事故**があった。
二度と起こさないため、呼び出し結果を7種類に分けて必ず記録する。

| コード | 日本語 | 失敗か |
|---|---|---|
| `OK` | 取れました | いいえ |
| `0_RESULTS` | 正常に動いたが該当なし | **いいえ** |
| `NO_MATCH` | 探したが同じ商品が無かった | いいえ |
| `API_ERROR` | APIがエラーを返した | **はい** |
| `AUTH_ERROR` | 認証に失敗した（401/403） | **はい** |
| `PARSE_ERROR` | 応答が読めなかった | **はい** |
| `RATE_LIMIT` | 呼びすぎ（429） | **はい** |
| `NO_PERMISSION` | 権限が無い | **はい** |

- 実装：`lib/research/discoveryOutcome.ts`
- 記録場所：`AliExpressClient.call`（HTTPの番号を例外に貼る `discoveryError`）→ `lib/research/discoveryRun.ts` の全呼び出し口
- 画面：`/research` の「直近7日の探索結果（0件と失敗を分けて表示）」。
  1回も呼んでいない時は「まだ実行していない」と書く（0件とは書かない）。

---

## 5. API異常値の関門（Keepaの事故を横展開）

Keepaで実際に起きた事故：**`-1` が「取れなかった」の意味なのに、`|| 0` では truthy で素通りし、
マイナスの寸法がFBA手数料計算に流れていた。**

同じことがAliExpressでも起きる前提で、危険な値を全部はじく関門を作った。

対象：`-1` / `null` / 空文字 / 特殊コード / 存在しない価格 / 0円 / 異常な通貨 / 異常MOQ / 異常重量 / 偽URL / 文字列の "null"

- 実装：`lib/providers/aliexpressValues.ts`
- 検査：**`npm run aliexpress:audit`** → 危険な値23件を試して23件すべてはじくことを確認済み
- 保存済みの本物の応答も同じ関門に通す（現在0件＝まだ1回も呼んでいない、という意味）

---

## 6. Discovery KPI 10項目

**「探索1回でいくら使い、利益商品が何件出たのか」を必ず後から言えるようにする。**

| # | 項目 | DB列 |
|---|---|---|
| ① | Amazon候補件数 | `amazon_checked` |
| ② | 仕入先（AliExpress）検索件数 | `supplier_searched` |
| ③ | 一致候補数 | `match_candidates` |
| ④ | MATCH_SCORE 90以上 | `high_match` |
| ⑤ | 利益条件突破 | `profit_passed` |
| ⑥ | Aランク | `grade_a` |
| ⑦ | **Keepa消費トークン** | `keepa_tokens_used` |
| ⑧ | AliExpress API使用回数 | `supplier_api_calls` |
| ⑨ | OpenAI使用回数 | `openai_calls` |
| ⑩ | DISCOVERY_COST_PER_WINNER | `cost_per_winner_jpy` |

- 実装：`lib/research/discoveryKpi.ts` ／ 保存：`lib/research/pipeline.ts` の `saveRun`
- 確認：**`npm run discovery:kpi`** ／ 画面：`/research` の「DISCOVERY KPI（10項目）」

### ★KPIで守っている3つの約束

1. **⑦は「呼び出し回数」ではない。**
   1回の呼び出しでも、取る商品数やオプションで消費トークンが変わる。
   Keepaの応答に入っている `tokensConsumed` を素直に足す（`lib/providers/keepaTokens.ts`）。
   応答に入っていなければ **`null`（＝不明）**。0とは書かない。
   - 実測例（2026-08-20）：Keepa呼び出し7回で **70トークン**。回数と数字が全く違うことが確認できた。

2. **④は③の言い換えではない。**
   以前 `high_match` に「除外されなかった件数（＝③）」を入れていたが、これは嘘になるため、
   MATCH_SCOREの点数そのものを見て90点以上を別に数えるよう修正した。

3. **⑩は利益商品が0件なら出さない。** 0で割った数字も「とりあえずの目安」も出さない。

### ★DB列に DEFAULT 0 を付けない理由
`DEFAULT 0` を付けると、列ができる前に走った古い実行にも 0 が入り、
**「本当に0件だった」と「まだ数えていなかった」が見分けられなくなる。**
そのため②③⑦⑧⑩は DEFAULT なし（NULL可）にしてある。
一度 DEFAULT 0 で作ってしまったぶんは、`lib/db/client.ts` の `repairKpiZeros()` で
列作成日より前の実行に限り NULL へ戻す（2026-08-20 の一度きりの手直し）。

---

## 7. Amazon→AliExpress の逆検索を主軸にする

順番：

1. Keepa で Amazon の売れ筋を取る
2. **推定月販10個以上**に絞る
3. 競合・価格・Amazon本体で絞る
4. 画像・特徴を取る
5. AliExpress を検索する
6. 同一商品候補を出す
7. MATCH SCORE で判定する
8. 仕入原価を出す
9. 利益を出す

### 種（seed）にする商品の優先順位
推定月販10以上／価格安定（30日平均と90日平均の差20%以内）／Amazon本体が強くない／
出品者15人以下／小型軽量／規制リスク低／ブランド・IPリスク低／画像が明確

### ★守っていること
- **AliExpress側の販売数は、Amazon需要判定の代用にしない。** 需要判定はKeepa（LIVE）だけ。
- 画像検索は**公式APIがVERIFIEDできた場合のみ**使う。非公式画像検索APIは使わない。
- 既存のAmazon手数料Provider・利益計算は**変更しない**。

---

## 8. 段階的に増やす（いきなり大量取得しない）

鍵が入ったら **1件 → 5件 → 20件** の順。いきなり100商品検索しない。

**最初の1件で確認する項目**：商品名／商品ID／価格／通貨／画像／商品URL／店舗名／カテゴリ
レスポンス原文も、個人情報・秘密情報を除いて監査用に保存する。

Access Token 取得後に測るもの：MOQ／在庫／重量／日本向け送料／商品詳細／画像検索。
**取れなければ UNKNOWN。公式仕様上返らないデータを推定して ACTUAL 扱いしない。**

---

## 9. 完成条件（10個そろって初めて LIVE_DISCOVERY_READY = true）

| # | 条件 | 現状 |
|---|---|---|
| 1 | 公式API存在確認 | **済（5件）** |
| 2 | 権限取得 | 未（鍵待ち） |
| 3 | 認証成功 | 未 |
| 4 | 実商品1件取得 | 未 |
| 5 | 実商品20件取得 | 未 |
| 6 | Amazon→AliExpress検索 | 仕組みは実装済／実データ未 |
| 7 | 商品画像・属性比較 | 仕組みは実装済／実データ未 |
| 8 | MATCH SCORE | 仕組みは実装済／実データ未 |
| 9 | PURCHASE_URL | 仕組みは実装済（推測禁止・ボタン設置済）／実データ未 |
| 10 | Keepa＋利益計算 | **済（Keepaは本番稼働中）** |

**1と10だけ完了。2〜9は「鍵が無い」の一点で止まっている。**

---

## 10. 検証コマンド一覧

| コマンド | 何を見るか |
|---|---|
| `npm run api:registry` | 5つのAPIが今どの段階か・何が足りないか |
| `npm run aliexpress:audit` | 危険な値をちゃんとはじけるか（鍵が無くても動く） |
| `npm run discovery:verify` | 安全ルール・鍵なし時の表示・逆検索の条件 |
| `npm run discovery:kpi` | KPI10項目の保存先と直近の実行の成績表 |
| `npm run prelive` | 本番前の鍵チェック |

### 2026-08-20 の検証結果
- `npx tsc --noEmit` … エラー0
- `npx tsc -p tsconfig.verify.json` … エラー0
- `npm run build` … 成功
- `npm run api:registry` … DOCUMENTED 5件・VERIFIED 0件・LIVE_DISCOVERY_READY=false
- `npm run aliexpress:audit` … 危険な値23件中23件をはじいた
- `npm run discovery:verify` … すべて想定どおり（外部APIは1回も使わず）
- `npm run discovery:kpi` … 10項目すべてが実測値で保存されることを確認（⑦=70トークン）

---

## 11. 安全装置（変更禁止）

以下は false のまま：
`AUTO_PURCHASE` / `AMAZON_AUTO_PUBLISH` / `AD_AUTO_OPTIMIZE` / `AUTO_REORDER` / `RESEARCH_AUTO_APPROVE`
`YAHOO_SHOPPING_COMMERCIAL_ACK` / `COMMERCIAL_USE_APPROVED`

やらないこと：
- 非公式な認証回避・規約違反スクレイピング
- 非公式画像検索API
- 1688の正規アクセス条件を無理に突破すること
- 取れなかったデータを推測して確定値のように扱うこと

機能凍結：Amazon側・広告・商品画像生成・商品ページ・販売学習は触らない。
AliExpress LIVE Discovery だけに集中する。

Research Score や A/B/C/D の基準変更は、**20商品の結果をChatGPTで確認してから**行う。

---

## 12. 次にやること（順番どおり）

1. AliExpress Open Platform に **Dropshipping（DS）** で登録する（`13_AliExpress申請手順.md`）
   - ★Affiliate と併用できず、後から変更もできない。DSを選ぶ
2. 審査を通し、APP_KEY / APP_SECRET / ACCESS_TOKEN を `.env` に入れる
3. `npm run aliexpress:probe` で 1件だけ取る → 8項目を目で確認
4. 5件 → 20件と増やす
5. `npm run api:registry` で VERIFIED になることを確認
6. 20商品の利益テストを回し、結果をChatGPTへ渡す
