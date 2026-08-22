---
title: 20. Keepa公式API調査（READ ONLY Connector 検討）
category: EC・物販
status: 調査完了・実装未着手（1 ASINテストの実行可否は人の判断待ち）
priority: 高
path: ai-commerce-os/
tags: [spec, commerce, ai-os, keepa, connector]
updated: 2026-08-22
調査日: 2026-08-22
---

# 20. Keepa公式API調査（KEEPA_READ_ONLY Connector）

> [!important] この文書の位置づけ
> ご本人の方針変更「**Keepa手入力を最終形にしない**」を受けた調査。
> **実装はまだ1行も書いていない。** 報告9項目をまとめ、**1 ASINテストの手前で止めている。**

> [!danger] 手入力の位置づけを変更した
> Phase 3.9d で作った `/sellability`（人がKeepaを見て書き写す）は **`MANUAL_FALLBACK`** とする。
> 消さない。API接続後も、APIで取れない項目・API障害時・API契約が切れたときの退避路として残す。

---

## 0. 調査方法（どこまでが一次資料か）

| 出どころ | 到達方法 | 一次資料か |
|---|---|---|
| `https://keepa.com/api-docs/`（全28ページ） | 通常のHTTP取得。`robots.txt` は `/r/` `/ajax/` `/refererControlDisqus.html` のみ Disallow で、**`/api-docs/` は許可されている** | **一次** |
| Keepa API 利用規約（T&C, **Version of July 28, 2026**） | keepa.com は JavaScript で描画されるSPAのため、**ブラウザで実際に開いて本文を読んだ** | **一次** |
| Keepa 免責事項（`#!disclaimer`） | 同上 | **一次** |
| Keepa APIダッシュボード（契約状況） | 同上（ログイン済み画面） | **一次** |
| Amazon AUP 4.3 | `sellercentral.amazon.com/mws/static/policy?documentType=AUP&locale=en_US` | **一次** |

> [!note] 前回「keepa.com は403で読めない」と記録した件の訂正
> 403 になるのは**取得ツールの種類**による。通常のHTTP取得だと `/api-docs/` は **200 で読める**。
> **前回の「到達できなかった」という記録は、事実としては正しいが原因の推定が不十分だった。**
> 今回、公式ドキュメントと規約本文の**両方に到達できたので、UNKNOWN を実際の値で置き換える。**

---

## ① Keepa公式APIについて確認できた事実

### 1-1. 契約状況（いちばん大きい発見）

> [!success] **すでに契約済み。追加費用は発生しない。**

| 項目 | 実際の値 |
|---|---|
| プラン | Keepa API Access **20 tokens per minute** |
| 料金 | **49.00 EUR / 月** |
| 契約開始 | **2026年6月2日** |
| 次回請求 | 2026年9月2日 |
| 現在のトークン残 | 1,200（＝20×60。バケット満タン） |
| APIキー | 発行済み（ダッシュボードで非表示。**中身は見ていないし、どこにも書かない**） |

**つまり「Keepa APIを使うかどうか」は、新たにお金を払うかどうかの判断ではない。
すでに毎月49ユーロ払っている契約を、使うか遊ばせておくかの判断。**

### 1-2. 技術仕様（すべて公式ドキュメントの記載）

- ベースURL：`https://api.keepa.com/`
- 認証：全リクエストに `key` パラメータでAPIアクセスキーを付ける
- 通信：HTTPS・**gzip必須**・レスポンスは全部JSON・GETで全エンドポイント可
- **`domain=5` が `co.jp`**（対応11マーケットプレイス。1=com, 2=co.uk, 3=de, 4=fr, **5=co.jp**, 6=ca, 8=it, 9=es, 10=in, 11=com.mx, 12=com.br）
- 価格は**その通貨の最小単位の整数**。ドキュメント原文「*Prices are integers in the smallest currency unit of the respective Amazon locale (e.g. euro cents or yen).*」→ **日本は「円」がそのまま整数。100で割らない。**
- 商品リクエストは **1回で最大100 ASIN**、バッチは並列処理
- 「*If our last update is older than ~1 hour, it will be automatically refreshed*」＝1時間以内の鮮度は自動担保

### 1-3. トークン（課金の単位）

- トークンバケット方式。プランのレート **R tokens/分** で24時間365日たまり続ける
- バケット上限 = **R × 60**（当社は 20×60 = **1,200 トークン**が一度に使える最大）
- **未使用トークンは60分で消える**
- 月間の理論上限 = 20 × 60 × 24 × 31 = **892,800 トークン/月**

| リクエスト | トークン費用 |
|---|---|
| 商品1件（基本） | **1** |
| `offers` を付ける | オファー1ページ（最大10件）につき **6**。※基本の1は加算されない。オファー0件でも成功時は5 |
| `buybox=1` | **+2** |
| `stock=1` | **+2** |
| `rating=1` | 最大 **+1** |
| `historical-variations=1` | 親ASINがある商品につき **+1** |
| `update=0`（強制最新化）で直近1時間以内に更新済み | **+1** |
| `update=-1` で当社DBに無い商品 | **0**（データも返らない） |
| 商品検索 | 結果1ページ（最大10件）につき **10** |
| Product Finder | ページ次第（別ページに記載） |
| Deals | 150件につき **5** |
| Best Sellers | 1リストにつき **50**（最大10万ASIN） |
| Seller情報 | 1セラーにつき **1** |
| `stats` `history` `days` `code-limit` `only-live-offers` `videos` `aplus` | **0（無料）** |

### 1-4. 規約（T&C, Version of July 28, 2026）— 原文で確認した重要条項

| 条 | 原文（抜粋） | 当社にとっての意味 |
|---|---|---|
| **2(2)** | "The services are provided solely for **the user's own business purposes**. **Reselling data for third-party purposes is only allowed with the Service Provider's prior written consent** (e.g., email)." | **自社の事業目的での商用利用は明確にOK。** 第三者へのデータ再販は書面同意が必要 |
| **2(4)** | "The Service Provider **does not guarantee the completeness** of the provided data. Additionally, **the accuracy of all data cannot be ensured. Users must perform a plausibility check** on the data obtained from Keepa.com." | **妥当性チェックは利用者の義務。** 当社のFail Closed設計はこの義務と一致する |
| **3(4)** | "The Service Provider's Price Data API is **available solely for business purposes**." | 事業者専用。個人事業主は該当 |
| **6.1(1)** | "**Resale of the data obtained from 'Keepa.com' is strictly prohibited**" | 生データの転売は禁止 |
| **11(1)** | "The user may **retrieve and display** the online contents ... **solely for their own business purposes** ... **This right of use is limited to the duration of the contractual relationship.**" | **契約が続いている間だけ使ってよい** |
| **11(2)** | "The user may **save** or print out contents ... **for their own business purposes**, with a non-exclusive and unlimited right of use" | **保存してよい** |
| **10** | 年間平均可用性 **98%** の保証（ただし §276(1) BGB の意味での保証ではない） | 落ちる前提で設計する |
| **20(1)** | ドイツ法・裁判管轄はKeepa所在地 | — |

事業者：**Keepa GmbH**（Berndorfer Str. 10, 95478 Kemnath, Germany／HRB 5942／代表 Julian Johann, Sascha Arthur）

### 1-5. サイトの自動操作は今も禁止（変わっていない）

免責事項（日本語版）原文：
> 「ボット、スクリプト、スクレイパー、クローラーなどを含む、**当サービスの自動化された利用は厳しく禁止**されています。」

**これは「keepa.com というウェブサイト」に対する禁止。
有料のREST APIは、Keepa自身が用意した正式な機械アクセス手段なので、この禁止とは別物。**
→ **サイトの自動巡回は今後も一切しない。触るのは `api.keepa.com` だけ。**

---

## ② 利用条件でまだ UNKNOWN な項目

**埋めない。推測しない。** 実装前に潰す必要がある順に並べる。

| # | 未確認の内容 | なぜ問題か | 潰し方 |
|---|---|---|---|
| **U1** | **11(1) の「modify, edit, translate, or reproduce してはいけない」と、当社の正規化・DB保存の線引き** | 当社はKeepaの数字を自社スキーマへ入れ直す。これが「modify」に当たるのか、11(2)の「save してよい」の範囲なのかが原文からは決まらない | **info@keepa.com へ英文で確認し、回答メールを保存する**（人がやる） |
| **U2** | **契約終了後に保存済みデータをどう扱うか** | 11(1)「利用権は契約期間中に限る」とあるが、**削除義務の明文が無い**。Amazon DPP のような「18か月以内に削除」に相当する定めが見当たらない | 同上。回答が来るまでは**契約終了時に削除する前提**で設計（厳しい側に倒す） |
| **U3** | **将来SaaSとして他社に売る場合、2(2)の「書面同意」が必要になる範囲** | セラーOS等へKeepa由来の数字を出すと「third-party purposes」になり得る | 事業として必要になった時点で書面同意を取る。**今は自社利用のみなので不要** |
| **U4** | **`monthlySold` の元データに関するAmazon側の制約** | Keepaは「Amazonの検索結果ページに出ている bought past month の値」と説明している。Keepa経由での利用が Amazon 側の何かに触れないかは、Amazon側の一次資料で確認できていない | 使う前に確認。**確認できないうちは `monthlySold` を判定に使わない** |
| **U5** | **日本の特定商取引・古物営業法の観点で、Amazon価格データを仕入判断に使うことの制約** | 該当する規制は見当たらないが、確認していない | 確認するまで「無い」と書かない |

**U1・U2 が閉じるまでは、Keepaの生データを長期保存する設計を確定させない。**

---

## ③ SP-APIとの併用判断（ご指示①の再検証）

**再検証した。結論は前回と変わらなかった。ただし出典を1本追加した。**

一次資料：`https://sellercentral.amazon.com/mws/static/policy?documentType=AUP&locale=en_US`

**適用範囲（原文）：**
> "The Acceptable Use Policy ("AUP") clarifies the appropriate use of the **Amazon Services API**. In addition to the Amazon Solution Provider Portal Agreement and the Data Protection Policy ("DPP"), **Solution Providers must comply with this AUP**."

**4.3（原文）：**
> "**Do not use, offer or promote external (non-Amazon) data services that vend information or data retrieved from Amazon's websites.**"

**したがって：**

```text
SP_API_KEEPA_COEXISTENCE = CONFIRMED_INCOMPATIBLE
  （ただし「SP-APIを使う場合に限る」）
```

- AUP が縛るのは **Solution Provider（Amazon Services API の利用者）**。
- **SP-API を使っていない当社は、いま AUP の適用対象ではない。** → Keepa利用に規約上の問題は無い。
- **SP-API を使い始めた瞬間に 4.3 が発動し、Keepa は「use」まで禁止される。**

> [!warning] 残る UNKNOWN（U6）
> AUP と同じ趣旨の条項が、**API を使わないただのセラー**を縛る「Amazon Services Business Solutions Agreement」側にも存在するかどうかは**確認できていない**。
> 見つからなかったが、「無い」とは書かない。**U6 として残す。**

**判断としては前回のまま：SP-API は見送り、Keepa を使う。SP-APIの調査結果（77点・Gate通過）は下げない。**

---

## ④ APIで実際に取得可能なデータ一覧（`/product` + `stats` + `offers`）

ご指示⑧のリストと突き合わせた。**◎＝そのままの項目がある／○＝取れるが加工が要る／×＝無い**

| ご指示の項目 | 可否 | 実際のフィールド | 追加トークン |
|---|:--:|---|---|
| `ASIN` | ◎ | `products[].asin` | 0 |
| （商品名） | ◎ | `title` | 0 |
| `CURRENT_PRICE` | ◎ | `stats.current[0]`=Amazon価格 / `[1]`=新品 / `[2]`=中古 | 0 |
| `BUY_BOX` | ◎ | `stats.buyBoxPrice` `buyBoxShipping` `buyBoxSellerId` `buyBoxIsFBA` `buyBoxIsAmazon` `buyBoxIsPrimeEligible` ほか | **+2**（`buybox=1`） |
| `RANK_CURRENT` | ◎ | `stats.current[3]`（SALES） | 0 |
| `RANK_HISTORY` | ◎ | `salesRanks`（カテゴリID別の履歴）／`csv[3]` | 0 |
| `RANK_DROPS` | ◎ | **`stats.salesRankDrops30 / 90 / 180 / 365`** | 0 |
| `OFFER_COUNT` | ◎ | `stats.totalOfferCount`（全コンディション合計） | 0 |
| `NEW_OFFER_COUNT` | ◎ | `stats.current[11]`（COUNT_NEW）／`csv[34]` COUNT_NEW_FBA・`csv[35]` COUNT_NEW_FBM | 0 |
| `USED_OFFER_COUNT` | ◎ | `stats.current[12]`（COUNT_USED） | 0 |
| `AMAZON_RETAIL_PRESENT` | ○ | 3つの材料を組み合わせる：`availabilityAmazon`（0=在庫あり／-1=Amazon出品なし ほか）・`stats.current[0]`（Amazon価格が-1なら不在）・`stats.buyBoxIsAmazon` | buyBox分 +2 |
| `PRICE_HISTORY` | ◎ | `csv`（価格種別ごとの二次元配列）。`days=90` で期間を絞れる | 0 |
| `DATA_AGE` | ◎ | `lastUpdate` `lastPriceChange` `lastBuyBoxUpdate` `lastSoldUpdate`（Keepa Time 分） | 0 |

**指示リストに無かったが取れるもの（重要）：**

| フィールド | 内容 | 重要度 |
|---|---|---|
| **`monthlySold`** | 「先月これが何回買われたか」。**Keepaの説明では推定ではなく、Amazonの検索結果に出る "bought past month" の実値**。ただし `100+` のような**区切り値**で、**大半のASINには値が無い** | **最高（ただしU4が閉じるまで判定に使わない）** |
| `monthlySoldHistory` | 上の履歴 | 高 |
| **`fbaFees`** | この商品のFBAピック＆パック料金（最小通貨単位の整数） | **高（手数料1/18件問題に効く）** |
| **`referralFeePercentage`** | Amazon販売手数料率（例：8） | **高（同上）** |
| `stats.avg30 / avg90 / avg180 / avg365` | 価格種別ごとの加重平均 | 高 |
| `stats.outOfStockPercentage30 / 90 / 180 / 365` | 品切れだった時間の割合 | 中 |
| `offerCountFBA` / `offerCountFBM` | 生きている新品オファーのFBA/FBM内訳 | 中（`offers` 必要） |
| `buyBoxStats` | セラーIDごとのBuy Box保持統計 | 中 |
| `eanList` `upcList` `partNumber` `model` `brand` `manufacturer` `color` `size` `packageQuantity` `numberOfItems` | **ASIN Matching の材料** | **最高** |
| `imagesCSV` | 画像URL（**実在するURL。組み立てではない**） | 中 |
| `salesRankReferenceHistory` | 順位の基準カテゴリ履歴 | 中 |

### ⚠️ 取れないもの（これが最大の落とし穴）

> [!danger] **商品ページのURLは返ってこない。**
> Product Object を全項目確認した。あるのは
> `urlSlug`（例：`Ring-Video-Doorbell-Satin-Nickel-2020-Release`）＝**スラッグ断片であってURLではない**、
> `brandStoreUrl`（原文：*"To get the full URL, **prepend the Amazon domain**"*）＝**パスだけ**、
> `imagesCSV`（画像の完全URL）だけ。
> **商品ページの完全なURLを返すフィールドは存在しない。**
>
> ASIN から `https://www.amazon.co.jp/dp/<ASIN>` を組み立てれば作れるが、
> **これは「AIがURLを作る」＝ルール55違反なのでやらない。**
> **SP-APIで判明したのと全く同じ制約が、Keepaにもある。**

**帰結：`/buy`（購入ページを開く）の導線は、Keepa単体でも作れない。**
Amazon側の購入ページURLだけは `HUMAN_ENTRY` のまま残る。

---

## ⑤ 現在の「売れるかテスト」のどの手入力項目を自動化できるか

| 現在の入力欄 | API化 | 根拠 |
|---|:--:|---|
| 期間（30 / 90 / 180日） | **完全自動** | `salesRankDrops30/90/180` が**当社の許可期間3種とちょうど一致する** |
| 売れ筋順位の下落回数 | **完全自動** | `stats.salesRankDrops{30,90,180}` |
| 現在の売れ筋順位 | **完全自動** | `stats.current[3]` |
| 出品者数（ライバル数） | **完全自動** | `stats.totalOfferCount` ／ 新品中古の内訳も可 |
| 平均価格 | **完全自動** | `stats.avg30 / avg90 / avg180` |
| 現在価格 | **完全自動** | `stats.current[…]` ／ Buy Box価格 |
| 商品名 | **完全自動** | `title` |
| 観測日時 | **完全自動** | `lastUpdate`（＋レスポンスの `timestamp`） |
| 商品ページURL | **自動化できない** | **上記のとおりURLフィールドが無い。ルール55により組み立てない** |
| どのASINを調べるか | **半自動** | JAN/EAN/UPCから `code` 検索は可能。ただし**⑦のASIN_MATCH_SCOREで人が確認するまで確定しない** |

> [!success] **手入力8項目のうち7項目が自動化できる。残る1つは商品ページURLだけ。**

**自動化しても変えないもの（ご指示⑨⑩）：**
- 4判定（`SELLS` / `CROWDED` / `DOES_NOT_SELL` / `UNKNOWN`）は**そのまま**
- 取り分は**ライバル数 +1** で割る
- **順位下落回数は `ESTIMATED_SALES_SIGNAL`。販売数ではない。画面には必ず「推定」と出す**
- 閾値 `SELLABILITY_THRESHOLDS` は**下げない**
- APIが埋められなかった項目は **`UNKNOWN`。0で埋めない**

---

## ⑥ REST API と MCP の使い分け

**Keepa公式ドキュメントが、当社の方針と同じことを明記していた。**

MCPページ原文：
> "Responses are **deliberately shaped for language models rather than for programs**; **if you are writing code against Keepa data, use the REST API directly.**"

| | REST API | 公式MCP Server |
|---|---|---|
| 接続先 | `https://api.keepa.com/` | `https://keepa.com/mcp`（Streamable HTTP・ホスト型） |
| 認証 | `key` パラメータ | `Authorization: Bearer <APIキー>` |
| トークン | 同じプランを消費 | **同じプランを消費**（同じ財布） |
| 応答の形 | プログラム向けJSON | **言語モデル向けに整形されている** |
| 再現性・監査・DB保存・テスト | ○ | △ |

**決定（ご指示21のとおり）：**

```text
本番の自動処理  = REST API Connector（KEEPA_READ_ONLY）
人との調査・対話 = 公式MCP（任意・後回し）
```

**MCPを入れる場合の注意：** APIキーは Codex CLI 方式（`--bearer-token-env-var`）か VS Code 方式（プロンプト入力）を使い、**設定ファイルに直接書かない・コミットしない**。Keepa自身も
> "Your API key is a secret. Client configurations that embed it ... must not be committed to shared repositories"
と明記している。**当社のSecrets管理ルールと一致。**

---

## ⑦ Token消費設計（Keepa API Cost Monitor）

### 7-1. 手持ちの予算

| | 値 |
|---|---|
| レート | 20 トークン/分 |
| 1回に使える最大（バケット上限） | **1,200 トークン** |
| 1日あたり | 28,800 トークン |
| 31日あたり | **892,800 トークン** |
| 月額 | 49.00 EUR（**すでに支払い済み**） |

### 7-2. 1商品あたりの想定コスト（当社の使い方）

| 使い方 | 内訳 | 合計 |
|---|---|---|
| **軽い売れ行き判定**（`stats` のみ） | 基本1 | **1トークン** |
| **判定＋Buy Box＋Amazon本体** | 基本1 ＋ buybox 2 | **3トークン** |
| **競合を細かく見る**（`offers=20`） | オファー2ページ×6 ＋ buybox 2 | **約14トークン** |

**目安：1商品3トークンなら、月に約29万商品ぶん。当社の規模ではトークンは足りる。
足りなくなるとしたら `offers` の付けすぎ。**

### 7-3. 監視する項目（すべてレスポンスに入っている）

`refillRate` / `refillIn` / `tokensLeft` / `tokensConsumed` / `tokenFlowReduction` / `processingTimeInMs`

### 7-4. `Keepa API Cost Monitor` に出す6項目（ご指示⑤）

| 表示 | 出し方 |
|---|---|
| 本日消費トークン | `tokensConsumed` の当日合計（**実測。推定しない**） |
| 今月推定消費 | 当月合計（**「推定」と明記**） |
| 残りトークン | 直近レスポンスの `tokensLeft`（**取得時刻も併記**） |
| 1商品平均トークン | 当月合計 ÷ 当月の取得商品点数（**件数ではなく商品点数**） |
| 分析商品数 | 重複を除いたASIN数 |
| 推定APIコスト | 月額49 EUR ÷ 月間トークン上限 × 消費トークン。**「按分した参考値であって請求額ではない」と明記し、利益計算・判定には一切入れない**（振込手数料と同じ扱い＝ルール準拠） |

### 7-5. 使いすぎを止める仕組み（実装時に必ず入れる）

- 1日のトークン上限を設定値で持ち、**超えたら止まる**（Fail Closed）
- `tokensLeft` が閾値未満なら**次のリクエストを出さない**
- **`offers` は既定OFF**（明示的に必要な商品だけ）
- 同一ASINの再取得は**最短間隔を設ける**（`update` パラメータで無駄な更新課金を避ける）
- **未使用トークンは60分で消えるので「貯めておく」設計にしない**

---

## ⑧ Keepa Connector 実装計画（KEEPA_READ_ONLY）

> [!danger] まだ着手しない。ご本人の「進めてよい」が出てから。

### 8-1. 名前と範囲

```text
Connector名 : KEEPA_READ_ONLY
状態        : NOT_CONNECTED（既定）
できること  : Amazonの商品データを読むだけ
できないこと: Amazon購入 / Amazon出品 / Amazon注文 / Keepa設定変更 / 自動決済
```

**これらは「フラグOFF」ではなく、既存の方針どおり**コードごと作らない**。**

### 8-2. 段階（ご指示㉒の順序を厳守）

| 段階 | 内容 | 通過条件 |
|---|---|---|
| **S0** | APIキーを `.env` に設定（**人がやる**。gitにもObsidianにも書かない） | `.gitignore` 済みを確認 |
| **S1** | **1 ASIN だけ取得して必ず停止** | 13項目を確認・記録 |
| **S2** | ChatGPT等での外部監査＋人の承認 | **人が「進んでよい」と言う** |
| **S3** | 5 ASIN | データ正確性・トークン・商品一致・判定・DB保存・重複・異常値の7点検 |
| **S4** | 20 ASIN | 同上 |
| **S5** | 100 ASIN | 同上 |

**各段階で問題が1つでも出たら止まる。**
（※ Amazon AI Seller OS で確立した「1件だけ取って止まる」運用と同じ形。あちらで実際に読み違いが起きたため。）

### 8-3. S1（1 ASINテスト）で必ず確認する13項目（ご指示④）

| # | 確認項目 | どこを見るか |
|---|---|---|
| 1 | API接続成功 | HTTP 200・JSONが返る |
| 2 | token消費 | `tokensConsumed` / `tokensLeft` / `refillRate` |
| 3 | ASIN | `products[0].asin` が要求と一致 |
| 4 | 商品名 | `title` |
| 5 | **Amazon.co.jpの商品か** | `domainId === 5` を**必ず検証**（違ったら止める） |
| 6 | 現在価格 | `stats.current[…]`。**円がそのまま整数か実物で確認** |
| 7 | 価格履歴 | `csv` が返るか・Keepa Time の変換が合っているか |
| 8 | ランキング関連 | `stats.current[3]` / `salesRankDrops30/90/180` / `salesRanks` |
| 9 | オファー情報 | `totalOfferCount` / `current[11]` / `current[12]` |
| 10 | Buy Box関連 | `buyBoxPrice` / `buyBoxIsAmazon` / `buyBoxIsFBA`（`buybox=1` 使用時） |
| 11 | 取得日時 | `lastUpdate` / レスポンス `timestamp` |
| 12 | 生データ保存方法 | 生JSONをそのまま1行保存（追記専用・上書きしない） |
| 13 | 正規化結果 | 正規化後の値と生JSONを**並べて見比べられる形**で保存 |

**取得できたフィールドだけ報告する。取れなかったものは `UNKNOWN` と書き、0や空文字で埋めない。**

### 8-4. 無駄打ちを防ぐ順序（ご指示⑥）

```text
仕入商品候補
  ↓ ① JAN / 型番 / ASIN候補があるか（無ければここで落とす）
  ↓ ② 安いローカルフィルター（DB内で完結・API不要）
  ↓ ③ Amazonで売る可能性があるか（カテゴリ・価格帯・状態）
  ↓ ④ ここで初めて Keepa API を呼ぶ
```

**AI Commerce OS の全商品をKeepaへ投げない。** 呼ぶ前に「なぜこの商品を呼ぶのか」を記録する。

### 8-5. ASIN Matching（ご指示⑦・いちばん危険な所）

**「ASINが見つかった＝同一商品」にしない。** `ASIN_MATCH_SCORE` を作る。

| 材料 | 取得元 | 重み |
|---|---|---|
| JAN / EAN 一致 | `eanList` | 最重 |
| UPC 一致 | `upcList` | 最重 |
| 型番一致 | `partNumber` / `model` | 重 |
| ブランド一致 | `brand` / `manufacturer` | 中 |
| 商品名一致 | `title` | 中 |
| 容量・サイズ | `size` / `packageDimensions` | 中 |
| 色 | `color` | 中 |
| セット個数 | `packageQuantity` / `numberOfItems` | **重（セット品の取り違えが最も多い）** |

- **1つのJANに複数ASINがぶら下がる**（公式記載：*"Multiple ASINs can have the same product code"*）→ **必ず複数候補を保持し、1つに決め打ちしない**
- スコアが基準未満は **`UNCERTAIN`。既存ルールどおり「たぶん合っている」を作らない**
- 誤一致は**1件でも重大扱い**（Phase 3.8で決めた通り）
- **人の確認結果で機械の判定を上書きしない**（別テーブルに持つ）

### 8-6. 7日・30日・90日（ご指示⑪）と Trend（⑫）

> [!warning] **7日だけは、そのままの項目が無い。**
> 公式にあるのは `salesRankDrops` **30 / 90 / 180 / 365** の4つだけ。
> ドキュメント原文：*"The fixed-window fields (... salesRankDrops30…365) are **independent of the chosen interval**."*
> **`stats` の期間指定を7日にしても、下落回数は7日にならない。**
>
> 7日を出すなら `salesRanks` の生履歴から**当社が自分で数える**しかない。
> それは **Keepaが提供した値ではなく当社の計算値**なので、
> **`SELLABILITY_7D` は出どころを `SELF_COMPUTED` として明確に分け、Keepa提供値と混ぜない。**
> 計算方法が固まるまでは **`SELLABILITY_7D = UNKNOWN` のままにする。**

```text
SELLABILITY_30D  … salesRankDrops30   （Keepa提供値）
SELLABILITY_90D  … salesRankDrops90   （Keepa提供値）
SELLABILITY_180D … salesRankDrops180  （Keepa提供値）
SELLABILITY_7D   … 生履歴から自社計算（SELF_COMPUTED）。当面 UNKNOWN
```

**Trend 判定（`ACCELERATING` / `STABLE` / `DECELERATING` / `VOLATILE` / `INSUFFICIENT_DATA`）**
は、まず 30日 と 90日 の**1日あたり下落回数の比**で判定する。
7日が無いうちは `ACCELERATING` の感度が鈍いので、**そのことを画面に明記する**。
**材料が足りなければ `INSUFFICIENT_DATA`。無理に4分類へ寄せない。**

### 8-7. Competition Score（ご指示⑬）

`seller count` だけで作らない。取得可能な材料：

| 材料 | フィールド |
|---|---|
| 新品出品数 | `stats.current[11]` COUNT_NEW |
| 中古出品数 | `stats.current[12]` COUNT_USED |
| FBA / FBM 内訳 | `offerCountFBA` / `offerCountFBM` / `csv[34]` / `csv[35]` |
| Buy Box保持者 | `buyBoxSellerId` / `buyBoxSellerIdHistory` / `buyBoxStats`（セラー別の保持統計） |
| Amazon本体 | `buyBoxIsAmazon` / `availabilityAmazon` / `stats.current[0]` |
| 価格競争 | `csv[1]`（新品価格履歴）の変動の大きさ |
| seller数の変化 | `csv[11]` `csv[12]` の履歴 |

**取れなかった材料は0点で埋めず、`COMPETITION_SCORE` 自体を `UNKNOWN` にする**（UNKNOWNに加点しない既存ルール）。

### 8-8. Amazon本体（ご指示⑭）

`AMAZON_RETAIL_PRESENT` を**独立したリスク要素**として保存する。
Competition Score に溶かし込まない（溶かすと「Amazon本体がいる」という一番重い事実が薄まる）。

### 8-9. KeepaだけでBUY判定しない（ご指示⑮）

```text
BUY = SELLABILITY（Keepa）
    + PROFITABILITY（仕入値・手数料・送料）
    + MATCH CONFIDENCE（ASIN_MATCH_SCORE）
    + FEE CONFIDENCE（実額確認済みか）
    + DATA CONFIDENCE（一番弱い項目が上限を決める）
    + RISK（Amazon本体・価格変動・在庫切れ率）
```

**既存の「一番弱い項目が判定上限を決める」構造をそのまま使う。**
Keepaが立派な数字を返しても、手数料が概算なら STRONG BUY には届かない。

### 8-10. 実装物の一覧（着手時）

| 種類 | 中身 |
|---|---|
| Secrets | `KEEPA_API_KEY`（`.env`。**コード・git・Obsidianに書かない**） |
| 設定 | `KEEPA_DOMAIN=5` 固定 / 日次トークン上限 / `offers` 既定OFF |
| ライブラリ | `lib/keepa/client.ts`（HTTP・gzip・リトライ・トークン記録）／`lib/keepa/normalize.ts`（Keepa Time変換・価格・-1/-2の扱い）／`lib/keepa/match.ts`（ASIN_MATCH_SCORE） |
| DB | `keepa_raw_responses`（生JSON・追記専用）／`keepa_products`（正規化）／`keepa_token_usage`（トークン実測）／`asin_match_candidates` |
| 冪等性 | `UNIQUE(asin, domain_id, last_update)` ＋ `INSERT OR IGNORE` |
| 画面 | `/keepa`（Cost Monitor）／`/sellability` に「出どころ：API／手入力」列を追加 |
| スクリプト | `npm run keepa:one -- --asin=<ASIN>`（**1件取って必ず止まる**） |
| 受け入れテスト | `test:phase3-10`（購入・出品系の関数が無いこと／URL組み立て関数が増えていないこと／UNKNOWNを0で埋めていないこと／トークン上限で止まること／4判定が変わっていないこと ほか） |

---

## ⑨ 1 ASINテストを実行してよい状態か

> [!danger] **いいえ。まだ実行できません。あと3つ足りません。**

| # | 足りないもの | 誰がやるか |
|---|---|---|
| **B1** | **`.env` に `KEEPA_API_KEY` が設定されていない** | **ご本人**。ダッシュボードでキーをコピーし `.env` に貼る。**AIはキーを見ない・扱わない** |
| **B2** | **Connectorのコードが1行も無い** | AI（ご本人の「進めてよい」の後） |
| **B3** | **U1（正規化・保存の線引き）とU2（契約終了後の扱い）が未確認** | **ご本人**が info@keepa.com へ確認。※S1の1件取得だけなら影響は小さいが、**長期保存の設計を確定させる前には必須** |

**B1 と B2 がそろえば S1（1 ASIN）は実行できる。B3 は S3（5件）へ進む前までに。**

---

## 10. 将来（今は実装しない）

| ご指示 | 内容 | 状態 |
|---|---|---|
| ⑰ | **Product Finder**（`/query`）で Amazon側から「売れている・競合少ない・価格安定・Amazon本体なし」を逆探索 → その ASIN を仕入先で探す | **将来。逆方向の探索路として有望** |
| ⑱ | 双方向探索への統合（KOMEHYO→Amazon / BOOKOFF→Amazon / MERCARI→Amazon ＋ Amazon相場→仕入先探索） | 将来 |
| ⑲ | **Deals**（`/deal`・5トークン/150件）で Amazon側の価格急落を検知し、Amazon仕入→他市場販売のRouteを探す | 将来。**今は実装不要（ご指示どおり）** |
| ⑳ | **Best Sellers**（`/bestsellers`・50トークン/リスト・最大10万ASIN）から需要の強い商品を逆算 | 将来。**1リスト50トークンと高いので無計画に叩かない** |

**⑰⑲⑳ はすべて「Amazon → 仕入先」の逆方向。
既存の Multi-Venue Engine は市場を仕入先/販売先に固定していないので、構造上は素直に載る。**

---

## 11. この調査で分かった、いちばん大事なこと

1. **すでに毎月49ユーロ払っている。** 使わない方が損。新規の費用判断ではない。
2. **規約上、自社の事業目的での利用・保存は明確にOK**（T&C 2(2)・11(1)(2)）。
3. **SP-APIとの併用不可は再確認しても変わらなかった。** ただし縛られるのはSP-APIを使う側だけ。
4. **手入力8項目のうち7項目は自動化できる。**
5. **商品ページURLだけは、Keepaでも取れない。** SP-APIと同じ壁。**AIが組み立てない。**
6. **7日の下落回数という項目は存在しない。** 出すなら自社計算＝出どころを分ける。
7. **`monthlySold` は「推定ではない実測」だが、大半のASINに値が無い**うえ Amazon側の制約が未確認（U4）。**すぐには使わない。**
8. **`fbaFees` と `referralFeePercentage` が取れる。** 長らく詰まっていた「手数料の実額確認1/18件」に効く可能性がある。

---

## 12. 追加するルール（実装時に `CLAUDE.md` へ入れる）

| # | ルール |
|---|---|
| 84 | **手入力の `/sellability` は消さない。`MANUAL_FALLBACK` として残す。** API障害時・API未対応項目・契約切れ時の退避路 |
| 85 | **Keepaで触ってよいのは `api.keepa.com` だけ。** keepa.com のサイト自動巡回は免責事項で明確に禁止 |
| 86 | **`KEEPA_API_KEY` はコード・git・Obsidianに書かない。** Secretsのみ |
| 87 | **`salesRankDrops` は `ESTIMATED_SALES_SIGNAL`。販売数ではない。画面に必ず「推定」** |
| 88 | **`SELLABILITY_7D` は Keepa提供値ではなく自社計算。`SELF_COMPUTED` として分け、確立するまで `UNKNOWN`** |
| 89 | **KeepaもURLを返さない。ASINからURLを組み立てない**（ルール55の再確認） |
| 90 | **段階は 1 → 5 → 20 → 100 ASIN。各段階で7点検。1つでも問題が出たら止まる** |
| 91 | **`offers` は既定OFF。** トークン消費が6倍以上になる |
| 92 | **推定APIコストは参考表示のみ。判定・利益計算に入れない**（振込手数料と同じ） |
| 93 | **ASINが見つかっただけでは同一商品にしない。`ASIN_MATCH_SCORE` と人の確認を通す。1JANに複数ASINがある前提で複数候補を保持** |
| 94 | **`monthlySold` は U4 が閉じるまで判定に使わない** |

---

## 13. 出典（すべて一次資料）

- Keepa API ドキュメント：`https://keepa.com/api-docs/`（Overview / Plans & Tokens / Product Request / Product Object / Statistics Object / MCP Server ほか）
- Keepa API 利用規約：keepa.com API画面内「Terms and Conditions」（**Version of July 28, 2026**）
- Keepa 免責事項・プライバシー：`https://keepa.com/#!disclaimer`
- Keepa APIダッシュボード：`https://keepa.com/#!api`（契約内容・トークンレート）
- Amazon Acceptable Use Policy：`https://sellercentral.amazon.com/mws/static/policy?documentType=AUP&locale=en_US`（適用範囲・4.3）

**確認日：2026-08-22**
