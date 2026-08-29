---
title: Phase 7 設計 — MULTI MARKET COMMERCE ENGINE（多仕入先 × 多販売先）
category: EC・物販
status: 設計・調査のみ完了（2026-08-29）。実装は0行。自動出品は開始していない
priority: 最高
path: 事業Vault/AI Commerce OS/
tags: [commerce, ai-os, phase7, multi-market, selling-connector, inventory-ledger, route-matrix]
updated: 2026-08-29
決定日: 2026-08-29
---

# Phase 7 設計 — MULTI MARKET COMMERCE ENGINE

> [!danger] この文書は最上位方針を変更する
> これまでの前提「**NETSEA → Amazon の1本を通す**」を廃止し、
> **多数の仕入先 × 多数の販売先を総当たりで比較し、最も利益が出るRouteをAIが毎日発見する**へ変更する。
> さらに **「人が仕入れた後、正式に自動出品できる販売先へは自動出品する」**を最終形に加える。
> [[00_設計書v1_最上位]] の §0.5 はこの文書に置き換わる（旧記述は削除せず残す＝ルール76）。

## 新しい最終形

```
多数の仕入市場
  ↓ 商品を自動探索
  ↓ 同一商品を市場横断照合
多数の販売市場と総当たり比較
  ↓ 利益・ROI・売却速度・リスク計算
最適Route決定 → BUY候補表示
  ↓ 【人が仕入れる】
在庫所有確認（OWNED_CONFIRMED）
  ↓ 販売先へ自動出品
価格・在庫自動管理 → 販売 → 実利益記録 → AIが学習
```

**目的は商品数でもConnector数でもAI精度でもない。実現純利益の最大化。**
ただし **規約違反／在庫無し出品／過剰仕入／データ捏造／判定基準の勝手な緩和は禁止**。

---

# 第1部：今回の調査で判明した「構想と規約の衝突」3点

**先にこれを書く。ここを設計に織り込まないと、作ってから全部やり直しになる。**

## 衝突① Amazon SP-API のデータは、AIの学習に使ってはいけない（明文）

> "You will not, and will not allow any third party to, use any of Our Materials or Solutions to directly or indirectly develop or improve large language or multimodal models, **machine learning models** or related technology."
> — Amazon Solution Provider Portal Agreement §6（August 2026）
> https://sellercentral.amazon.com/mws/static/agreement?locale=en_US ／確認日 2026-08-29

**「直接的にも間接的にも」**と書かれている。SP-APIで取ったデータを他のデータと混ぜて学習に流すのも間接利用にあたる。

さらに保持期間の制限もある。
> "Solution Provider must retain Information only for so long as, and to the extent, such retention is **strictly necessary** to fulfill the purposes for which the Information was collected..."
> — Data Protection Policy 1.7

## 衝突② SP-API開発者がKeepaを使うこと自体が、規約上あやしい

> "Do not **use**, offer or promote external (non-Amazon) data services that vend information or data retrieved from Amazon's websites."
> — Amazon Acceptable Use Policy 4.3

Keepaは「Amazonのサイトから取得したデータを販売する、Amazon外部のデータサービス」そのもの。
条文は "offer or promote"（提供・宣伝）だけでなく **"use"（使用）** を並べて禁止している。

> "Do not promote, publish or share insights about Amazon's business. **Do not use insights about Amazon's business for your own business purposes.**"
> — AUP 4.5

**ルール70（矛盾は厳しい方を採用）に従い、「SP-API開発者登録をした状態でKeepaを使うのは危険」という読み方を採用する。**

### → 設計判断：`KEEPA_ANALYSIS_PIPELINE` と `AMAZON_LISTING_PIPELINE` を完全分離する

| | KEEPA_ANALYSIS_PIPELINE | AMAZON_LISTING_PIPELINE |
|---|---|---|
| 目的 | **仕入前の需要分析だけ** | **仕入後の出品・在庫・注文だけ** |
| データ源 | Keepa API | Amazon SP-API |
| DB | 独立DB／独立テーブル群（接頭辞 `ka_`） | 独立DB／独立テーブル群（接頭辞 `al_`） |
| 結合キー | **持たせない**（ASINでのJOINを物理的に禁止） | 同左 |
| AI学習 | 可（Keepa側の規約に従う） | **不可（§6により禁止）** |
| 実装 | 別プロセス。共通ライブラリを跨がせない | 同左 |

**この分離は「あった方が良い」ではなく「必須」。**
`AMAZON_SPAPI_AI_LEARNING_ALLOWED = false` を定数として固定する。

> [!warning] それでも残る未解決点
> 分離しても AUP 4.3 の "Do not use" は解消しない。
> **SP-APIの開発者登録を実際に行う前に、Amazon Developer Support へ書面で照会する。** 照会前に登録しない。

## 衝突③ Yahoo!ショッピングは、APIで取った情報を保存してはいけない

> 「利用者は、ショッピング出店 API およびテスト環境 API の利用に伴い LINE ヤフーから提供を受ける情報について、**別途 LINE ヤフーが保管を指示する情報を除き、一切保持しないものとする。**」
> — Yahoo!ショッピング出店API 利用約款 第10条
> https://developer.yahoo.co.jp/webapi/shopping/api_contract.html ／確認日 2026-08-29

個人情報に限らず**すべての情報**が対象と読める。
**「取得 → 蓄積 → 分析 → 学習」型のパイプラインを、Yahoo!では組めない。**

### → 設計判断：`DATA_RETENTION_POLICY` を市場ごとに持つ

| 市場 | 保持可否 | 学習利用 | 根拠 |
|---|---|---|---|
| Amazon SP-API | 必要最小限のみ | **禁止** | Agreement §6 / DPP 1.7 |
| Keepa | 可 | 可 | Keepa規約（[[20_Keepa公式API調査]]） |
| Yahoo!ショッピング | **原則保持不可** | **事実上不可** | 出店API約款 第10条 |
| eBay | **30日以内に削除の可能性** | **禁止の可能性** | API License Agreement（**原文未到達＝厳しい方を採用**） |
| メルカリShops | UNKNOWN | UNKNOWN | 記載を発見できず |
| 楽天RMS | UNKNOWN | UNKNOWN | 仕様書がログイン必須で到達できず |
| NETSEA | **契約終了時に派生データまで廃棄義務** | UNKNOWN | API規約 第10条 |
| 自社EC（Shopify） | 自社データ | 制限を受けにくい（未確認） | — |

**`RETENTION_UNKNOWN` の市場は、保持期間0日として設計する（Fail Closed）。**

---

# 第2部：MULTI SELLING MARKET DISCOVERY（販売先6市場の調査）

**すべて公式一次資料のみ。会員登録・ログイン・申込・問い合わせ・スクレイピングは一切していない。確認日 2026-08-29。**

## 2-1. 一覧（12項目）

| 項目 | Amazon | Yahoo!ショッピング | メルカリShops | eBay | 楽天市場 | ヤフオク! | 自社EC(Shopify) |
|---|---|---|---|---|---|---|---|
| 当社が販売できるか | YES | **YES（条件付）** | YES | YES | YES | YES | YES |
| 法人条件 | UNKNOWN | 登記簿謄本等。**既存EC実績3ヵ月以上が必要** | **登記簿住所の外観写真（Exif位置情報付き）必須** | 法人選択可・UBO情報必須 | 審査あり | Yahoo!ショッピング同時契約必須 | UNKNOWN |
| **自動出品API** | **YES** `putListingsItem` | **YES** 商品登録API | **YES** `createProduct` | UNKNOWN（原文未到達） | UNKNOWN | **無い（実質NO）** | **YES** `productCreate` |
| 価格更新API | **YES** `patchListingsItem` | **YES** | **YES** `updateProduct(s)` | UNKNOWN | UNKNOWN | UNKNOWN | **YES** |
| 在庫更新API | **YES** | **YES** `setStock` | **YES** | UNKNOWN | UNKNOWN | UNKNOWN | **YES** `inventoryAdjustQuantities` |
| 注文取得API | **YES** Orders API v0 | **YES**（要利用申請） | **YES** ＋Webhook | UNKNOWN | UNKNOWN | UNKNOWN | **YES** |
| 出品停止・終了API | **YES** `deleteListingsItem` | UNKNOWN | **PARTIAL**（削除はあるが一時停止が不明） | UNKNOWN | UNKNOWN | UNKNOWN | **YES** |
| 手数料 | 月4,900円＋販売手数料8.4〜15.4% | **初期0・月額0・ロイヤリティ0**。ただしポイント1%＋キャンペーン1.5%＋アフィリ2〜4%＋その30%が必須 | **無料。販売手数料10%**・振込200円 | 月250品まで出品無料、落札13.25%＋$0.40、**海外決済手数料1.35%** | **初期6万円**＋月2.5〜13万円＋システム利用料2.0〜7.0% | 月額0円（落札料率は未確認） | 月3,650〜44,000円＋カード3.25〜3.55% |
| 出品制限カテゴリ | UNKNOWN（到達できず） | 詳細列挙あり | たばこ・医薬品・チケット等 | **新規は月間出品枠制限あり** | 第18条2項で包括禁止 | 列挙あり | UNKNOWN |
| **画像の使用条件** | UNKNOWN（到達できず） | UNKNOWN | UNKNOWN（**許可の明文なし**） | UNKNOWN | **第9条2項で4点の許諾を事前取得しろと明記** | UNKNOWN | UNKNOWN |
| データ保持制約 | **必要最小限のみ** | **一切保持不可** | UNKNOWN | **30日以内削除の可能性** | UNKNOWN | UNKNOWN | 自社データ |
| **AI学習利用** | **明文禁止** | UNKNOWN（保持不可のため事実上不可） | UNKNOWN | **禁止の可能性** | UNKNOWN | UNKNOWN | UNKNOWN |
| **総合可否** | **FULL_AUTO_OK** | **FULL_AUTO_OK** | **PARTIAL** | **UNKNOWN** | **UNKNOWN** | **MANUAL_ONLY** | **FULL_AUTO_OK** |

## 2-2. 市場ごとの要点と最大の問題

### Amazon.co.jp（SP-API）— FULL_AUTO_OK
出品・価格・在庫・注文・削除がすべて公式APIで揃う。**技術的には文句なし。**
**最大の問題は技術ではなく規約**（第1部の衝突①②）。
→ 次に人が確認：セラーセントラルにログインし、日本語版 Agreement §6 相当の正文を確認する。

### Yahoo!ショッピング — FULL_AUTO_OK
> 「商品データの登録・更新を行います」（商品登録API `editItem`）／在庫更新API `setStock`／注文検索API `orderList`
仕様が**全面公開**されており、出店の初期費用・月額・ロイヤリティが**すべて0円**。**自動出品の最有力候補。**
ただし出店条件に「**既存事業（EC or 実店舗）を原則3ヵ月以上運営**」がある。
**最大の問題は第10条の「一切保持しない」。** 受注処理に必要な一時保持まで含むのか要照会。
→ 次に人が確認：LINEヤフーに第10条の解釈を書面照会。

### メルカリShops — PARTIAL
GraphQL APIが完備（`createProduct` / `updateProducts` / 在庫増減 / `orderTransactions` / Webhook / `deleteProduct`）。一括登録の件数上限もない。
**最大の問題**：リクエストヘッダに必須の `API_CLIENT_NAME` が「**契約時にメルカリが発行**」される値であること。
> 「現在はあらかじめソウゾウとパートナー契約を結んだショップ様のみ利用可能です。」（メルカリ公式技術ブログ）
※管理画面からトークンを自己発行できるというヘルプ記述と矛盾する。**厳しい方＝契約必須を採用。**
**無在庫は明文禁止**（「メルカリShopsおよびm departmentでは『手元にないもの』の販売を禁止しています」）→ 当社の「仕入れてから出品」方針とは合致する。
→ 次に人が確認：ソウゾウに `API_CLIENT_NAME` の発行条件を照会。

### eBay — UNKNOWN（実務上PARTIAL）
`developer.ebay.com` へ**到達できなかった**（403／タイムアウト計7回）ため、API原文を確認していない。
確認できた事実は3つ、いずれも重い：
1. **eBay International Shipping は米国・カナダのセラー限定。** 「商品は米国内に物理的にあり」が条件。**日本在庫の当社は対象外。** 国際配送は自社手配になる。
2. **新規アカウントには月間出品枠と、初出品カテゴリの制限がある。** 一括出品APIを叩いても枠超過分は通らない。
3. **eBayデータのAI学習禁止条項と30日削除条項が存在する可能性が高い。**
→ 次に人が確認：ブラウザで API License Agreement の現行原文を確認。

### 楽天市場 — UNKNOWN
RMS WEB SERVICE の仕様書が**ログイン必須**で、公開資料からAPIの存在を確認できなかった。「無い」ではなく「読めなかった」。
**画像の条件が最も厳しい。** 第9条2項は、第三者著作物を載せる際に**4種類の許諾を事前取得せよ**と定める。仕入先の「使っていいよ」だけでは足りない。
初期6万円＋月額2.5〜13万円＋システム利用料。**固定費が突出して高い。**
→ 次に人が確認：出店前にECコンサル経由でRMS API仕様書とその利用規約を書面入手。

### ヤフオク! — MANUAL_ONLY
オークションWeb APIは提供終了済み（2017年告知 → 2020年1月終了 → 「2022年5月8日をもって終了」）。
現在の出品はGUIツール「ストアクリエイターPro」経由と読める。**代替出品APIの公式告知は見つからなかった。**
→ 次に人が確認：併売プラン規約を読み、Yahoo!ショッピングAPIで登録した商品がヤフオク!に自動反映されるか。**反映されるなら PARTIAL に格上げできる。**

### 自社EC（Shopify）— FULL_AUTO_OK
Admin API（GraphQL）で出品・価格・在庫・注文・公開停止のすべてが揃う。審査待ちもモール規約の縛りもない。
**取得データは自社の受発注データであり、他社モールのようなAI学習禁止条項の直撃を受けにくい**（※明文未確認のため断定はしない）。
**最大の問題は集客がゼロ**であること。売り場を自分で作る以上、流入をどこから引くかが別問題として残る。

### SNKRDUNK — 候補から外す
> 利用条件「実態のある国内拠点を有する法人様＆個人事業主様」「**年商: 1億円以上(目安)**」「スニダンにて月間200万円以上の購入が可能な方」
入口要件が当社の現状と乖離。出品APIの公式資料にも到達できず。
（既知の通り利用規約 第7条1項13号でクローリング・スクレイピングは明文禁止。今回も公式告知2ページを見たのみ。）

## 2-3. 販売先の実装優先順（結論）

| 順位 | 販売先 | 状態 | 理由 |
|---|---|---|---|
| **1** | **Yahoo!ショッピング** | FULL_AUTO_OK | **固定費0円**・API全面公開・集客あり。第10条の保持制限だけが論点 |
| **2** | **自社EC（Shopify）** | FULL_AUTO_OK | 規約の壁がなく、**自動出品の型を最初に作る場所**として最短。集客はゼロ |
| **3** | **Amazon** | FULL_AUTO_OK（技術）／要照会（規約） | 需要が最大。ただしKeepaとの併用可否の照会が終わるまで**SP-API開発者登録をしない** |
| **4** | **メルカリShops** | PARTIAL | 契約交渉が前提。手数料10%のみで固定費0は魅力 |
| 5 | eBay | UNKNOWN | 原文未確認＋日本セラーの配送制約＋出品枠制限。**AI連携は保留** |
| 6 | 楽天市場 | UNKNOWN | 固定費が最も高く、画像許諾が最も厳しい |
| 7 | ヤフオク! | MANUAL_ONLY | 出品APIが無い。`LISTING_MANUAL_REQUIRED` |
| — | SNKRDUNK | 対象外 | 年商1億円以上が目安 |

> [!important] 最初の SELLING_CONNECTOR は Amazon ではなく **Yahoo!ショッピング** を推す
> 理由：①固定費0円で失敗コストが小さい ②API仕様が完全公開で照会待ちがない ③Amazonは規約照会が終わるまで着手できない。
> **ただし実装は今回しない。** これは「次に作るならここ」という設計上の結論。

---

# 第3部：仕入先3社のデータ取得方法（調査結果）

## 3-1. 一覧

| 項目 | NETSEA | グッズステーション | 国分ネット卸 |
|---|---|---|---|
| 公式API | **YES**（5本・Bearer・トークン180日） | **UNKNOWN**（記載に到達できず） | **UNKNOWN**（記載に到達できず） |
| CSV/Excel | **YES**（zip・CSV＋画像・A〜AI列） | UNKNOWN | UNKNOWN |
| 外部連携（ネクストエンジン等） | UNKNOWN | UNKNOWN | UNKNOWN |
| **JAN/EAN/GTIN** | **YES** `jan_code`／CSV I列。※サプライヤー未登録なら空欄 | 画面上は1商品ずつ見える（例：4580758560767）が**一括取得の正規手段なし** | **会員登録前には確認できない** |
| 型番・メーカー名 | **NO（重大）**。メーカー名の項目が存在しない | 型番は自社管理番号のみ（例 Gs-482-1665） | 確認できず |
| 商品名 | YES | YES | 確認できず |
| 仕入価格 | **YES** `price`（卸価格・税抜）＋`reference_price`（上代） | **会員登録前には一切見えない**（「価格はホームページ上に掲載しておりません」） | 確認できず |
| 在庫数 | **NO**。`sold_out_flag`（Y/N）の有無フラグのみ。`/items/stock` も数量を返さない | UNKNOWN | UNKNOWN |
| 送料 | **YES** `/tariffs` で**都道府県別**・`gradual_border_price`＝送料割安ライン | **全国一律 送料無料**（離島/沖縄除く） | **YES**（公開）6エリア×3段階。**送料無料ラインは無い**（原文：「購入金額により送料無料の設定はございません。」） |
| 画像URL | YES（最大10枚） | YES（一括取得の正規手段なし） | 確認できず |
| **画像の利用許諾** | **条件付YES** `image_copy_flag`（Y/N）。ただしAPI規約第8条2項が「加工には事前の書面承諾」を要求し**CSV説明と食い違う → 厳しい側を採用** | **UNKNOWN（明文なし）** | **UNKNOWN（規約に知財条項が1つも無い）** |
| MOQ | `set_num`（販売ロット）は取れる。**最低発注金額は自由文の中にしか無い** | **一般会員は50個から**（プラチナ会員は20個） | **1ケース・1ボール単位**。1注文は税込30万円・50アイテムまで |
| 継続仕入 | 部分。**再入荷予定のフィールドは無い** | UNKNOWN寄り（規約が欠品・仕様変動を全面免責） | 比較的YES（定番食品16,000点以上・翌日出荷） |
| データ保持 | **YES（廃棄義務）**。第10条「情報を加工したもの・情報を利用して得たもの」まで返還・廃棄 | UNKNOWN | UNKNOWN。※3ヵ月未利用でアカウント削除 |
| 自動取得 | **YES（APIが公式手段）**。robots.txt は `/api/` を Disallow＝**サイト側スクレイピングは不可** | **UNKNOWN**（包括禁止条項あり） | **UNKNOWN**（禁止条項の条文自体が存在しない） |
| **総合** | **API_OK** | **手作業のみ** | **手作業のみ**（※後述の別ルートあり） |

## 3-2. 前回（37番）の結論を一部修正する

> [!warning] SUPERSEDE：グッズステーションは「買えるが、自動発見には使えない」
> 37番で **A判定＝Entry Gate通過**としたのは正しい（Amazonを名指しで許可している点は変わらない）。
> しかし今回、**商品データを機械で取得する正規手段が確認できなかった**。
> - 仕入価格が会員登録前に一切見えない → AIが利益計算を組めない
> - JANは1商品ずつしか見えず、一括取得の正規手段なし → **自動突合ができない**
> - 一般会員のロットが50個固定 → 1商品あたりの資金拘束と在庫リスクが大きい
>
> **→ グッズステーションは `PURCHASABLE_SUPPLIER` ではあるが `AUTO_DISCOVERY_CAPABLE = false`。**
> **人が目で選んで買う仕入先**としては有効。**AIの自動探索の対象にはできない。**
> 37番の記述は削除しない（ルール76）。判定だけをここで上書きする。

> [!success] 今回いちばん価値のある発見：国分ネット卸は NETSEA に出展している
> **「問屋 国分ネット卸」（運営：国分首都圏株式会社、NETSEA上の supplier_id 903497）がサプライヤーとして出展している。**
> つまり **国分の商品を、NETSEA API 経由で `jan_code` 付きで取得できる可能性がある。**
> 別々に2本のConnectorを作る必要がなく、**NETSEA 1本の仕組みに国分が丸ごと乗る。**
> ※未検証。**取引申請を出して承認されるかが前提。**

## 3-3. 仕入先の実装優先順（結論）

| 順位 | 仕入先 | 自動探索に使えるか | 理由 |
|---|---|---|---|
| **1** | **NETSEA** | **使える** | 唯一、API/CSV両方でJAN・卸価格・画像・都道府県別送料まで機械取得できる |
| **2** | **国分ネット卸（NETSEA経由）** | **使える可能性** | NETSEAに出展しているため1位の仕組みにそのまま乗る。取引申請の承認が前提 |
| 3 | グッズステーション | **使えない** | 価格が登録前に見えず、JANの一括取得手段がなく、ロット50個固定 |

## 3-4. NETSEA に残る2つの致命的な穴

1. **メーカー名・メーカー型番のフィールドが存在しない。**
   あるのは `product_id`（サプライヤーの管理番号）だけ。**JANが空の商品は、Amazonと突合する手段がゼロになる。**
   → `MATCH_KEY_MISSING` として明示的に脱落させ、推測で埋めない。
2. **在庫数量が取れない。** `sold_out_flag` の Y/N だけ。
   → **`AVAILABLE_QUANTITY = UNKNOWN` のまま扱う。「在庫あり」を「十分にある」と読み替えない。**
   → 推奨仕入数（`HOW_MANY_TO_BUY`）は、仕入先在庫を根拠に増やしてはいけない。

→ 次に人が確認：SynaBizへ1件だけ書面照会「API利用申請に審査・費用はあるか。第8条2項の『加工』に、自社DBへの保存と利益スコア計算は含まれるか」。

---

# 第4部：BUY × SELL ROUTE MATRIX（設計）

## 4-1. Routeの定義

**Route ＝ 1つの商品について「どこで買って、どこで売るか」の1通り。**

```
ROUTE = { product_id, supplier_id, sell_market_id }
```

仕入先3・販売先4なら、1商品あたり最大12Routeが生まれる。
**一番上だけを残さない。候補Routeも全部保存する。**（ユーザー指示 §13）

## 4-2. 商品1件の表示イメージ

```
商品A（JAN 4580758560767）

① グッズステーション → Amazon        保守純利益 2,100円  ROI 50%  30日回転 高
② NETSEA           → Amazon        保守純利益 1,800円  ROI 43%  30日回転 高
③ NETSEA           → Yahoo!         保守純利益 1,500円  ROI 36%  30日回転 中
④ グッズステーション → eBay          保守純利益 2,600円  ROI 62%  30日回転 低
```

**④が利益は最大でも、③や②が選ばれることがある。** 理由は次の §4-4。

## 4-3. `ROUTE_EXPECTED_VALUE`（最重要スコア）

```
ROUTE_EXPECTED_VALUE
  = 保守純利益
  × 売却確率
  × 資金回転係数
  × MATCH_CONFIDENCE
  × DATA_CONFIDENCE
  × RISK_ADJUSTMENT
```

| 因子 | 中身 | 0にする条件（Fail Closed） |
|---|---|---|
| 保守純利益 | 既存の4段階利益のうち**最も保守的な値**（[[28_Phase4設計_Supplier to Amazon Route Validation]]） | 費用に1つでも `UNKNOWN` があれば**そのRouteは判定しない** |
| 売却確率 | 30日以内に売れる推定確率 | 需要データが無ければ **null**（0%ではない。ルール116） |
| 資金回転係数 | 30日 ÷ 予想売却日数 | 売却日数が推定できなければ **null** |
| `MATCH_CONFIDENCE` | 仕入商品とAmazon商品が同一である確信度 | **JANが無ければ `REJECTED`。型番一致だけでBUYに進めない** |
| `DATA_CONFIDENCE` | 価格・手数料・送料の鮮度と出所 | `ESTIMATED` が主要費目にあれば減点、`UNKNOWN` があれば0 |
| `RISK_ADJUSTMENT` | 規約リスク・価格変動・Amazon本体参入・返品率 | `MARKETPLACE_POLICY_ALLOWED = false` なら**0（＝Route消滅）** |

**掛け算にしてあるのは、1つでも0なら全体が0になるようにするため。**

## 4-4. なぜ「利益最大」を選ばないか（ユーザー指示 §9 の定式化）

```
eBay   ：利益 15,000円 / 売却予測 70日 → 30日換算 6,428円
Amazon ：利益  9,000円 / 売却予測  8日 → 30日換算 33,750円
```
**同じ資金を30日運用したとき、Amazonの方が5倍以上の利益を生む。**

## 4-5. `EXPECTED_PROFIT_PER_30D`（重要KPI）

```
EXPECTED_PROFIT_PER_30D = 保守純利益 × (30 ÷ 予想売却日数) × 売却確率
```
**1個あたりの利益ではなく、「資金を30日回したらいくら作れるか」で並べる。**
※ [[29_Phase5設計_AUTO_RESEARCH_ORCHESTRATOR]] で導入済みの概念を、Route単位へ拡張する。

## 4-6. `HOW_MANY_TO_BUY`（推奨仕入数）

判断材料：需要／Seller数／Amazon在庫／**仕入先在庫**／30日売却予測／現金残高／カテゴリ集中／商品集中／価格変動。

> [!danger] 制約：NETSEAは在庫数量が取れない
> `AVAILABLE_QUANTITY = UNKNOWN` のため、**仕入先在庫を根拠に推奨数を増やしてはいけない。**
> 上限は「30日売却予測」と「現金残高」と「集中度」だけで決める。

**AIは「推奨 3個」と提案するだけ。数量は購入画面で人が決める。自動発注はしない。**（ユーザー指示 §15）

## 4-7. 毎朝の「今日の仕入候補」表示

```
1位 商品A
  仕入      グッズステーション  4,200円
  販売      Amazon            7,980円
  保守純利益 1,640円
  保守ROI    39%
  30日回転   高
  仕入先在庫 UNKNOWN（NETSEAは数量を返さない）
  おすすめ仕入数 5個
  予想30日利益 8,200円
  [購入ページを開く]
```

---

# 第5部：GLOBAL INVENTORY LEDGER（設計）— 二重販売防止

> [!danger] これは事故防止の中心。ここが甘いと、売れない在庫を売ってしまう
> 同じ在庫1個を Amazon・メルカリ・eBay に同時出品できる場合、
> **1市場で売れた瞬間に、他市場の在庫を0にして出品を止めなければならない。**

## 5-1. 在庫状態（7段階）

```
NOT_PURCHASED → ORDERED → IN_TRANSIT → RECEIVED → OWNED_CONFIRMED → LISTED → SOLD
```

| 状態 | 意味 | 誰が変える |
|---|---|---|
| `NOT_PURCHASED` | まだ買っていない | 初期値 |
| `ORDERED` | 人が発注した | **人が「購入した」を押す** |
| `IN_TRANSIT` | 発送された | 人／将来はSupplier API |
| `RECEIVED` | 手元に届いた | **人が「商品到着確認」を押す** |
| `OWNED_CONFIRMED` | **実物を所有していると確定** | 人（到着確認と同時） |
| `LISTED` | 出品中 | 自動出品Gate通過後にシステム |
| `SOLD` | 売れた | 注文取得APIまたは人 |

**`OWNED_CONFIRMED` になるまで自動出品は禁止。例外なし。**

## 5-2. 購入時に保存する項目（ユーザー指示 §6）

人が管理画面で「購入した」を押したとき：
`実仕入価格` / `数量` / `購入日時` / `仕入先` / `注文番号`

**この5つが揃わないと `ORDERED` にしない。**（後で実利益の答え合わせができなくなるため）

## 5-3. 在庫台帳の単位

```
GLOBAL_INVENTORY_LEDGER
  inventory_id        （実物1ロットに1つ）
  product_id
  supplier_id
  actual_buy_price    （1個あたり実仕入価格）
  qty_total           （買った数）
  qty_available       （まだ売れる数）
  qty_reserved        （注文が入って確保中）
  qty_sold            （売れた数）
  state               （上の7段階）
```

**不変条件（コードで必ず検査する）：**
```
qty_total = qty_available + qty_reserved + qty_sold
```
**この式が崩れたら、全市場の出品を即座に止める。**

## 5-4. 出品は「在庫の写し」であって在庫ではない

```
LISTING
  listing_id
  inventory_id   ← 必ず在庫台帳を指す
  sell_market    （AMAZON / YAHOO / MERCARI / EBAY / OWN_EC）
  listed_qty     （その市場に見せている数）
  state          （ACTIVE / PAUSED / CLOSED）
```

**各市場の `listed_qty` を足しても `qty_total` を超えてよい**（同じ1個を複数市場に見せるため）。
**超えてよいのは「見せ方」だけで、`qty_available` は常に1つ。**

## 5-5. Oversell防止（ユーザー指示 §24 の実装ルール）

```
実在庫 1個
  Amazon  に 1 出品
  メルカリ に 1 出品
  eBay    に 1 出品
      ↓
  Amazonで1個売れた
      ↓
  qty_available: 1 → 0
      ↓
  【即座に】メルカリ・eBayの listed_qty を 0 にし、出品を PAUSED にする
```

**`qty_available` が変わったら、その在庫を参照している全Listingを必ず同期する。**
同期に失敗した市場があれば、**その市場の出品を止める（減らす方向にしか失敗させない）。**

## 5-6. 在庫予約（ユーザー指示 §23）

```
注文が入る → qty_available -1、qty_reserved +1（同時に）
  ↓ 発送完了
qty_reserved -1、qty_sold +1
  ↓ キャンセル
qty_reserved -1、qty_available +1
```

**予約は注文検知と同じトランザクションで行う。** 別処理にすると、その隙間で二重販売が起きる。

## 5-7. 多市場同時出品を「最初はやらない」という判断

> [!warning] 設計はするが、最初は `MULTI_LISTING_ENABLED = false`
> 二重販売は、返金・評価毀損・アカウント停止に直結する事故。
> **注文検知が数分〜数十分遅れる市場がある以上、完全には防げない。**
> したがって最初は **1在庫＝1市場のみ出品**とし、
> 実績で注文検知の遅延が測れてから多市場同時出品を解禁する。
> **これは「利益より安全を優先」ではなく、「事故1件の損失が多市場出品の増益を上回る」という利益判断。**

## 5-8. `ORDER_ROUTER`

売れたら1箇所に集約する：`市場` / `商品` / `数量` / `販売価格` / `手数料` / `発送状態`
発送は当面すべて人。将来 Amazon FBA・倉庫・3PL との接続を検討する（今回は設計しない）。

---

# 第6部：自動出品Gate（設計）

## 6-1. `AUTO_LISTING_ELIGIBLE`（8条件・全部YESのときだけ自動出品）

| # | 条件 | 内容 | NGのとき |
|---|---|---|---|
| 1 | `OWNED_CONFIRMED` | 実物を所有していると確定している | 出品しない |
| 2 | `PRODUCT_MATCH_CONFIRMED` | 仕入商品とAmazon等の商品が同一と確定（**JAN必須**） | 出品しない |
| 3 | `SELLING_CONNECTOR_AVAILABLE` | その市場に正式な出品APIがある | `LISTING_MANUAL_REQUIRED` へ |
| 4 | `MARKETPLACE_POLICY_ALLOWED` | その市場での販売が規約上許されている | 出品しない |
| 5 | `CATEGORY_ALLOWED` | 出品許可が要るカテゴリなら取得済み | 出品しない |
| 6 | `LISTING_DATA_COMPLETE` | タイトル・カテゴリ・価格・数量・状態が揃っている | 出品しない |
| 7 | `PRICE_VALID` | `MIN_SELL_PRICE` 以上である | 出品しない |
| 8 | `INVENTORY > 0` | `qty_available` が1以上 | 出品しない |

**1つでもNOなら自動出品しない。UNKNOWNはNOとして扱う。**

## 6-2. 市場ごとの4つの許可（ユーザー指示 §33）

**「APIがある＝全部できる」ではない。** 機能ごとに個別判定する。

| 市場 | `AUTO_LISTING_ALLOWED` | `AUTO_PRICE_UPDATE_ALLOWED` | `AUTO_STOCK_UPDATE_ALLOWED` | `ORDER_FETCH_ALLOWED` |
|---|---|---|---|---|
| Amazon | YES（技術）／**要規約照会** | YES | YES | YES |
| Yahoo!ショッピング | **YES** | **YES** | **YES** | YES（**要利用申請**） |
| メルカリShops | **要契約**（`API_CLIENT_NAME`） | 要契約 | 要契約 | 要契約 |
| eBay | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| 楽天市場 | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| ヤフオク! | **NO** | UNKNOWN | UNKNOWN | UNKNOWN |
| 自社EC | **YES** | **YES** | **YES** | **YES** |

## 6-3. 出品内容の生成ルール

AIが生成するのは：`商品タイトル` `商品説明` `カテゴリ` `SKU` `JAN` `ASIN等` `価格` `数量` `状態` `画像` `配送条件`

> [!danger] 捏造禁止（ユーザー指示 §18）
> **仕様・ブランド・サイズ・数量・状態を、AIが勝手に補完してはいけない。**
> Supplierデータまたは正式な商品情報に無ければ **`UNKNOWN`** とし、
> `LISTING_DATA_COMPLETE = false` として**出品を止める。**
> 「たぶんこのサイズだろう」で埋めない。

## 6-4. 画像（ユーザー指示 §19）

**「仕入先の画像だから自由に使える」とは絶対に判断しない。**

| 仕入先 | 画像利用の根拠 | 判定 |
|---|---|---|
| NETSEA | `image_copy_flag`（Y/N）がある。CSV説明は「モール出品用に加工して利用」を認めるが、**API規約第8条2項は加工に書面承諾を要求** | **矛盾 → 厳しい側を採用。書面承諾を得るまで `IMAGE_USE_ALLOWED = false`** |
| グッズステーション | **明文なし** | `UNKNOWN` → 使わない |
| 国分ネット卸 | **規約に知財条項が1つも無い** | `UNKNOWN` → 使わない |

**販売先側の条件も別途かかる。** 特に楽天は第9条2項で**4種類の許諾の事前取得**を要求している。
→ **`IMAGE_USE_ALLOWED` は「仕入先側」と「販売先側」の両方がYESのときだけYES。**

## 6-5. 価格（ユーザー指示 §20・§21）

販売先ごとに3本持つ：
```
MIN_SELL_PRICE     = 総費用 + 必要最低利益   ← これを下回る自動値下げは禁止
TARGET_SELL_PRICE  = 相場と回転から決める狙い値
MAX_SELL_PRICE     = 上限（誤登録防止）
```

**`AUTO_REPRICE = false` で開始する。** 最初は「値下げしませんか」と提案するだけ。人が承認する。

## 6-6. 自動出品できない市場

`LISTING_MANUAL_REQUIRED` とし、それでも **AIがタイトル・説明・価格・写真・カテゴリを準備して、人が貼るだけの状態にする。**（ヤフオク!が該当）

---

# 第7部：学習（ユーザー指示 §27〜§31）

## 7-1. 答え合わせ

| | 予測 | 実績 |
|---|---|---|
| 利益 | 2,100円 | 1,680円 |
| 販売日数 | 7日 | 12日 |

実績として保存する項目：`実売価格` `実販売手数料` `実送料` `販売日数` `返品` `実純利益`

**既存のSHADOW学習（Phase 3・[[11_Phase3実装記録]]）の原則をそのまま適用する：**
- 判断は凍結し**上書きしない**
- **成約データが無ければ勝敗を決めない**
- **5件未満でスコアを動かさない**

## 7-2. Route学習の単位

```
SUPPLIER × PRODUCT_CATEGORY × SELL_MARKET
```
例：
```
NETSEA → Amazon  / 家電   平均利益率 18%
NETSEA → メルカリ / 家電   平均利益率  9%
```

## 7-3. 負け商品の分類（8種）

`価格暴落` / `競合増` / `送料増` / `需要不足` / `Amazon本体参入` / `商品一致ミス` / `返品` / `長期在庫`

**「なんとなく負けた」を許さない。分類できないものは `LOSS_REASON_UNKNOWN` として別に数える。**

## 7-4. 探索と活用の配分

将来的に **既存80% / 新規探索20%** を検討する。
**儲かった市場に寄せきると、市場が変わったときに全滅する。探索枠は必ず残す。**

---

# 第8部：KPI と経営画面

## 8-1. 事業の本当のKPI（10本）

| KPI | 意味 |
|---|---|
| `NET_PROFIT` | 実現純利益（**最上位**） |
| `EXPECTED_30D_PROFIT` | 30日で作れる見込み利益 |
| `CAPITAL_TURNOVER` | 資金回転率 |
| `PROFIT_PER_1000_RESEARCHED` | 1000件調べていくら儲かったか |
| `BUY_OPPORTUNITY_RATE` | 調査件数のうちBUYになった割合 |
| `SELL_THROUGH_RATE` | 仕入れたもののうち売れた割合 |
| `DAYS_TO_SELL` | 売れるまでの日数 |
| `INVENTORY_AGE` | 在庫の滞留日数 |
| `REALIZED_ROI` | 実現ROI |
| `API_COST_PER_PROFIT` | 利益1円あたりのAPI費用 |

**分母が0のときは 0% ではなく `null`（ルール116）。**

## 8-2. 経営ダッシュボード（最終形）

```
今日調査した商品  82,401
利益Route         348
BUY                42
STRONG BUY          9
必要資金       1,240,000円
予想30日利益     286,000円
所有在庫          163個
自動出品   Amazon 87 / eBay 21
売上              X円
実純利益          X円
```

**すべて実データが無ければ `null` を表示する。0と書かない。**

---

# 第9部：今回やったこと・やっていないこと

## やったこと（調査・設計のみ）
1. MULTI SELLING MARKET DISCOVERY（販売先7チャネルを一次資料で調査）
2. 主要販売先の正式API・自動出品可否（12項目 × 7チャネル）
3. 仕入先3社のデータ取得方法（15項目 × 3社）
4. BUY×SELL Route Matrix 設計（`ROUTE_EXPECTED_VALUE`・`EXPECTED_PROFIT_PER_30D`・`HOW_MANY_TO_BUY`）
5. GLOBAL_INVENTORY_LEDGER 設計（7状態・不変条件・予約・Oversell防止）
6. 自動出品Gate 設計（8条件・市場別4許可・捏造禁止・画像・価格）

## やっていないこと（明記）
- **コードは1行も書いていない。** `NEW_FEATURE_DEVELOPMENT_PAUSED = true` は継続
- **自動出品は開始していない**
- Connector実装（仕入側・販売側とも0件）
- 会員登録・ログイン・申込・**問い合わせ送信**
- スクレイピング（`SCRAPING_IMPLEMENTED = false` 継続）
- 商品データ・価格データの取得（NETSEA APIも1回も叩いていない）
- **SP-API の開発者登録**（AUP 4.3 の照会が終わるまで行わない）
- 中古（2026-08-28 ユーザー確定で対象外）

## 到達できなかったページ（正直な申告・ルール97）
- `developer.ebay.com` 全般（403／タイムアウト計7回）— API License Agreement の原文
- 楽天 RMS WEB SERVICE API仕様書（ログイン必須）
- Amazon.co.jp 出品許可カテゴリ一覧・画像要件（JavaScript必須で開けず）
- ヤフオク! 落札システム利用料率
- Yahoo!デベロッパーネットワーク総合ガイドラインの禁止事項全文／LINEヤフー共通利用規約 第2章
- au PAY マーケット 公式API仕様書（`developer.wowma.jp` 名前解決不可）
- スニダン「かんたんショップ」（接続拒否）
- グッズステーション：会員ページ・パンフレットPDF
- 国分ネット卸：商品詳細ページ全般（ログイン後のみ）
- NETSEA API設定画面（ログイン必須。レート制限が載っている可能性）

**物販ブログ等の二次情報は根拠に採用していない。**

---

# 第10部：次に人が決める・確認すること（優先順）

| # | 相手 | 聞くこと | なぜ最優先か |
|---|---|---|---|
| 1 | **Amazon Developer Support** | AUP 4.3 の "Do not use external data services" は、SP-API開発者がKeepaを併用することを禁じているか | **これがNOなら、需要分析の土台（Keepa）か出品自動化（SP-API）のどちらかを捨てることになる。設計の根幹** |
| 2 | **SynaBiz（NETSEA）** | ①API利用申請に審査・費用はあるか ②第8条2項の「加工」に自社DBへの保存と利益計算は含まれるか | **唯一の自動化可能な仕入先。ここが開かないと何も動かない** |
| 3 | **NETSEA上で** | 「問屋 国分ネット卸」（supplier_id 903497）へ取引申請を出して承認されるか | 承認されれば**仕入ルートが2本に増える**（別Connector不要） |
| 4 | **LINEヤフー** | 出店API約款 第10条の「一切保持しない」は受注処理に必要な一時保持も含むか | **最有力の販売先。ここの解釈で自動化設計が変わる** |
| 5 | 人が目視 | eBay API License Agreement の現行原文（AI学習禁止・30日削除） | eBayをRouteに含めてよいかの前提 |
| 6 | ソウゾウ（メルカリShops） | 自社開発システムで `API_CLIENT_NAME` の発行を受けられるか | 手数料10%・固定費0で魅力的だが契約が壁 |
| 7 | グッズステーション | 会員向けにCSVダウンロードまたはAPIの提供はあるか | **YESなら自動探索の対象に復帰できる** |
| 8 | 本人判断 | Yahoo!ショッピング出店の条件「既存EC事業3ヵ月以上」を満たせるか | 販売先1位候補の入口条件 |

**1〜8はすべて人が行う。AIは連絡しない**（`CONTACT_VENUE_BY_AI_ALLOWED = false`）。

---

**確認日：2026-08-29／本文書の `YES` はすべて第2部・第3部の原文引用とURLに紐づく。原文の無い `YES` は書いていない。**
