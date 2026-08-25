---
title: Phase 6 設計・実装記録 — FIRST SUPPLIER CONNECTOR
category: EC・物販
status: 実装済（2026-08-26）。ただし2市場とも LEGAL_USAGE_GATE = BLOCKED のため、外部への通信は1回も行っていない
priority: 最高
path: ai-commerce-os/lib/phase6/
tags: [spec, commerce, ai-os, phase6, connector, legal-gate, yahoo, ebay]
updated: 2026-08-26
決定日: 2026-08-26
---

# Phase 6 — FIRST SUPPLIER CONNECTOR（最初の仕入側Connector）

> [!danger] この文書の結論を先に書く
> **技術は出来た。許可が取れていない。だから1回も繋いでいない。**
> Yahoo!ショッピングの口（商品検索API v3）は現役で、JANで検索でき、商品ページURLも返ってくる。
> しかし「**事業者としての商用利用が認められているか**」が公式資料から読み取れなかった。
> よって `LEGAL_USAGE_GATE = BLOCKED`、`YAHOO_SHOPPING_LIVE_FETCH_IMPLEMENTED = false`。
> 第2候補の eBay も同じ門にかけて **BLOCKED**。しかも eBay は
> **日本のマーケットプレイスが無い**うえ、**取得データをAIの学習へ入れることを条文が名指しで禁じている**。
>
> **次の一手は「人がYahoo!へ商用利用の可否を問い合わせる」こと。AIは外部へ連絡しない。**

---

## 0. なぜ Phase 6 が要るのか

[[29_Phase5設計_AUTO_RESEARCH_ORCHESTRATOR]] で、AIが毎朝Amazon側を調べて
「利益が出そうな候補」を並べるところまでは動いた。
しかしそこで **47件が `SUPPLIER_SEARCH_PENDING`（仕入先を探す番待ち）のまま止まった**。
理由は1つだけ ——

> **仕入側（買う場所）の正式なConnectorが0件だから。**

売る側（Amazon＝Keepa）は繋がっている。買う側が無い。
だから「どこでいくらで買えるか」が永久に埋まらず、利益計算まで進めない。

**Phase 6 の目的＝仕入側の口を1つ、正式に開けること。**

---

## 1. 最初に決めたこと（設計の背骨）

### 1.1 順番を逆にした

普通なら「実装 → 動かす → 規約を確認」となる。今回は逆にした。

> **規約の確認 → 門（Gate）を作る → 門が開いた市場だけ実装。**

理由：**先に繋いでしまうと、後から「駄目でした」と言われても取り消せない**から。
1回でも取得したデータは、消しても「取得した事実」は消えない。

### 1.2 Fail Closed（分からないなら閉じる）

| 状態 | 扱い |
|---|---|
| YES | 使ってよい |
| NO | 使えない |
| **UNKNOWN** | **使えない**（YES扱いにしない） |
| 登録の無い市場 | **使えない**（黙って通さない） |

**「禁止と書かれていない」を、やってよい根拠にしない。**（ルール58）
これはコードにも定数として残してある（`LEGAL_GATE_UNKNOWN_IS_NOT_YES = true`）。

### 1.3 根拠の無いYESは、YESと数えない

判定にはすべて **一次資料の原文引用 ＋ 出典URL ＋ 確認日** を持たせた。
引用が1つも無い項目は、たとえ `value: 'YES'` と書いてあっても
`effectiveValue()` が **UNKNOWN へ落とす**（ルール146）。

→ **「たぶん大丈夫」という気分でコードにYESと書く道を、仕組みで塞いだ。**

---

## 2. Yahoo!ショッピング 10項目の判定表（確認日 2026-08-26）

出典：
- `A` = [商品検索API v3 公式ページ](https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html)
- `B` = [Yahoo!デベロッパーネットワーク ガイドラインFAQ](https://support.yahoo-net.jp/PccDeveloper/s/article/H000011080)
- `C` = [クレジット表示について](https://developer.yahoo.co.jp/attribution/)
- `D` = [LINEヤフー サービス利用規約](https://www.lycorp.co.jp/ja/company/terms/)

| # | 項目 | 種類 | 判定 | 一次資料の原文（抜粋） | 出典 |
|---|---|---|---|---|---|
| 1 | 公式の口が今あるか | PRECONDITION | **YES** | `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch` | A |
| 2 | 事業者としての商用利用 | PERMISSION | **UNKNOWN** | 「利用者自身の便宜をはかる非商用目的のみに使用することが認められています」／「このガイドラインは商用サイトや企業による利用をすべて禁じるものではありません」 | B |
| 3 | 社内の仕入調査に使ってよいか | PERMISSION | **UNKNOWN** | 「当社サービスやそれらを構成するデータを、その提供目的を超えて利用することができません」 | D |
| 4 | 他社（Amazon）価格との突き合わせ | PERMISSION | **UNKNOWN** | 同上（許す記述も禁じる記述も見つからない） | D |
| 5 | 自社DBへの保存 | PERMISSION | **UNKNOWN** | 同上（保存期間・可否を定めたページが見当たらない） | D |
| 6 | プログラムからの自動取得 | PERMISSION | **UNKNOWN** | 「短い時間の間に同一URLに大量にアクセスを行った場合、一定時間利用できなくなることもございます。（1クエリー/秒）」 | A |
| 7 | 商品ページURLの保存・表示 | PERMISSION | **UNKNOWN** | 「hits/url … 商品ページURL」（＝口が正式に返す） | A |
| 8 | アフィリエイト連携 | FACT | **YES（任意）** | 「affiliate_type … 任意 / affiliate_id … 任意」 | A |
| 9 | クレジット表示の義務 | OBLIGATION | **YES（義務）** | 「Yahoo!デベロッパーネットワークの提供するAPIを利用するすべてのサイトやアプリケーションには、クレジットを表示する必要があります」 | C |
| 10 | 叩いてよい間隔 | FACT | **YES（1クエリー/秒）** | 同 #6 | A |

### 判定結果

```
LEGAL_USAGE_GATE = BLOCKED
不明 6件 ／ 禁止 0件 ／ 未実装の義務 0件
```

> [!warning] 一番の詰まりは #2
> 同じFAQ記事の中に「**非商用目的のみ**」と「**商用をすべて禁じるものではない**」が
> **並んで書かれている**。当社の用途（事業者が仕入判断に使う）がどちらに入るのか、
> 公式の文だけでは決まらない。
> → **これは読めば分かる問題ではなく、問い合わせないと決まらない問題。**

### #6 について（読める、を根拠にしない）

「1クエリー/秒」という上限が書いてある以上、プログラムから呼ぶことは前提だと**読める**。
しかし **「プログラムから取得してよい」と書いた文は無い**。
一方でLINEヤフーの規約には「BOT、チートツール、その他の技術的手段を利用して当社サービスを不正に操作する行為」の禁止がある。
→ **読めるを根拠にしない。UNKNOWN のまま置いた。**

### #9 について（書かれていない側へ甘くしない）

クレジット表示の義務は「すべてのサイトやアプリケーション」と書かれているが、
**社内の非公開画面については何も書かれていない**。
→ 書かれていないからといって省かず、**社内画面にも表示する実装**にした。

```
表示文言：Webサービス by Yahoo! JAPAN
リンク先：https://developer.yahoo.co.jp/sitemap/
```

---

## 3. Rate Limit の3つの数字が食い違った件（ルール70・76）

過去の調査記録（[[19_Connector再調査_市場別スコア]]）には、こう残っていた。

| 数字 | 今回2026-08-26に確認できたか |
|---|---|
| **1クエリー/秒**（＝1分60回） | ✅ v3公式ページに明記されている |
| 1分あたり30回 | ❌ **今回のv3ページには見当たらなかった** |
| 1日あたり50,000回 | ❌ **今回のv3ページには見当たらなかった** |

### どうしたか

**消さない。3つとも持ったまま、一番厳しい値で設計する。**

```
1分60回 ／ 1分30回 ／ 1日50,000回（＝1分34回相当）
→ 最小値 = 1分30回
→ 最短間隔 = 2,000ミリ秒（2秒に1回）
```

過去の記録が間違いだったのか、ページから消えたのか、当時と別のページを見ていたのかは**分からない**。
分からないので **消さずに「未確認」の印（`confirmedAt: null`）を付けて残した**。
そして**一番厳しい数字を採用**した。厳しすぎて損することはあっても、事故は起きない。

---

## 4. eBay Browse API（第2候補）— 10項目の判定表（確認日 2026-08-26）

出典：
- `E` = [Browse API 概要](https://developer.ebay.com/develop/api/buy/browse_api)
- `F` = [item_summary/search リファレンス](https://developer.ebay.com/develop/api/buy/browse_api/item_summary/search)
- `G` = [Buy API Requirements](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html)
- `H` = [API License Agreement](https://developer.ebay.com/join/api-license-agreement)
- `I` = [API Call Limits](https://developer.ebay.com/develop/get-started/api-call-limits)

| # | 項目 | 種類 | 判定 | 原文（英語のまま／抜粋） | 出典 |
|---|---|---|---|---|---|
| 1 | 公式の口が今あるか | PRECONDITION | **YES** | "The Browse API lets shoppers search eBay listings by keyword, category, GTIN, product, charity, compatibility criteria, or image" | E |
| 2 | 事業者としての商用利用 | PERMISSION | **UNKNOWN** | "The use of eBay's Buy APIs in production is intended for eBay partners only." ／ "There is no guarantee that your application for production use of the APIs will be approved." | G |
| 3 | 社内の仕入調査 | PERMISSION | **UNKNOWN** | "...solely for the purpose of facilitating your own or Your Users' use of eBay Services" | H |
| 4 | 他社価格との突き合わせ | PERMISSION | **🚫 NO** | "You must have eBay's express prior written permission to use or display eBay Content in any way that enables derivation of ... Average selling price or gross merchandise sold for any eBay category" | H |
| 5 | 自社DBへの保存 | PERMISSION | **UNKNOWN** | "Making limited intermediate copies ... All intermediate copies must be deleted when they are no longer required" ／ 表示は6時間以内の鮮度が必要 | H |
| 6 | プログラムからの自動取得 | PERMISSION | **YES** | "All methods in the Browse API require an Application access token, which is obtained using the client credentials grant flow." | E |
| 7 | 商品ページURLの保存・表示 | PERMISSION | **UNKNOWN** | "eBay Content in a Public Display may not be co-mingled or combined with non-eBay Content." | H |
| 8 | アフィリエイト連携 | FACT | **UNKNOWN** | "sign up for an eBay Partner Network (EPN) account" ／ "If you are part of the eBay Partner Network you must pass in ... affiliateCampaignId" | G / F |
| 9 | クレジット表示の義務 | OBLIGATION | **UNKNOWN** | "Show the eBay logo / In Footer: Links to eBay User Agreement"（ゲスト決済パートナー向けの章のみ） | G |
| 10 | 叩いてよい間隔 | FACT | **YES（1日5,000回）** | "Browse API — All methods except getItems: 5000 API calls per day" | I |

### 判定結果

```
LEGAL_USAGE_GATE = BLOCKED
不明 6件 ／ 禁止 1件 ／ 未実装の義務 1件
最短間隔 = 17,280ミリ秒（約17秒に1回）
```

> [!danger] eBay は「不明」以前に、条文が当社の設計を名指しで禁じている
> 仮に本番の許可が下りても、**設計を変えないかぎり守れない条項が3つある。**

#### ① 取得データをAIの学習へ入れてはならない

> "Use eBay Content ... to train algorithms, conduct machine learning, develop synthetic data sets, train large learning models, and/or train artificial intelligence systems."（RESTRICTED ACTIVITIES）

当社の **Phase 3（SHADOW学習＝答え合わせでスコアを動かす）へ1件でも流し込むと違反**になる。
→ コードに `EBAY_CONTENT_MAY_ENTER_AI_LEARNING = false` として固定した。
**eBayのデータは「人が読む材料」までに留め、学習の輪へ入れる道を最初から作らない。**

#### ② eBay以外のデータと同じ画面で混ぜてはならない

> "all eBay Content in a Public Display must be visually isolated from third-party listings or other non-eBay information"

当社の画面は「Amazonの売値」と「仕入値」を**1行に並べる**作り。**構造そのものが抵触する恐れ**がある。
社内の非公開画面が Public Display に当たるかは不明なので、厳しい側で扱う。
→ `EBAY_CONTENT_MAY_BE_MIXED_WITH_OTHER_VENUES = false`

#### ③ 日本のマーケットプレイスが無い

対応16か国に **`EBAY_JP` は存在しない**。
仕入は海外の出品者から「日本へ送れる商品」を探す形になり、**国際送料・関税が必ず乗る**。
→ `EBAY_JAPAN_MARKETPLACE_EXISTS = false`。§19（国をまたぐ仕入は費用がそろわないとBUYにしない）が**全件に当たる**。

#### 補足：トークン発行の上限は「別枠」

`Application access token 1,000 requests/day` は**合鍵を作る回数**であって、
**商品を探す回数ではない**。混ぜると設計を誤るので、レート表には入れず別の定数にした
（合鍵は2時間有効なので、使い回せば1日十数回で足りる）。
また **1秒あたりの上限は公表されていない**。分からないものを「無い」と書かない（ルール97）。

---

## 5. 実装した7ファイル（合計2,937行）

すべて **依存ゼロ**（何もimportしない＝画面にそのまま載る／ルール37）。
通信コードは1行も無い。

| ファイル | 行数 | 役割 |
|---|---:|---|
| `lib/phase6/legalgate.ts` | 878 | **利用可否の門。** 10項目×2市場、原文引用つき。ここが `BLOCKED` を返す限り何も起きない |
| `lib/phase6/yahoo.ts` | 453 | Yahoo!の答えの**読み取り係**（固定サンプルのみ）。通信しない |
| `lib/phase6/match.ts` | 341 | **同じ商品か**の判定（数量・セット・色・サイズ・世代の5軸） |
| `lib/phase6/rank.ts` | 336 | 仕入候補の**順位付け**（安いだけで決めない） |
| `lib/phase6/queue.ts` | 330 | 47件の**番待ち管理**と段階Gate（1→5→10件） |
| `lib/phase6/route.ts` | 314 | Phase 4の利益エンジンへ**配線**し BUY/WATCH/SKIP を出す |
| `lib/phase6/funnel.ts` | 285 | **ファネル6段・脱落理由9分類・KPI5つ** |

### 5.1 安全装置（フラグではなく「コードが無い」）

```
YAHOO_SHOPPING_LIVE_FETCH_IMPLEMENTED = false   本番の取得コードが存在しない
EBAY_BROWSE_LIVE_FETCH_IMPLEMENTED    = false   同上
AUTO_SUPPLIER_RESEARCH                = false   自動検索は解禁していない
AUTO_PURCHASE_IMPLEMENTED             = false   実購入はコードごと無い
AUTO_ORDER_API_IMPLEMENTED            = false   発注APIもコードごと無い
SCRAPING_IMPLEMENTED                  = false   無許可収集は選択肢として存在しない
CONTACT_VENUE_BY_AI_ALLOWED           = false   AIは外部へ連絡しない
```

`canFetchLive()` は **門・実装・全体スイッチの3つがそろって初めて true** を返す。
今はどれも成立しないので、**3つとも理由を並べて false** を返す。

### 5.2 同じ商品かの判定（match.ts）

5つの軸を **SAME / DIFFERENT / UNKNOWN** で見る：数量・セット・色・サイズ・世代。

- `AI_ONLY_MATCH_ALLOWED = false` … **AIの「たぶん同じ」だけでは通さない**
- `IMAGE_ONLY_MATCH_ALLOWED = false` … **画像が似ているだけでも通さない**
- `SUSPICIOUSLY_CHEAP_RATIO = 0.3` … **相場の3割を切る値段は「安い」ではなく「別物を疑う」**

判定は HIGH_CONFIDENCE / REVIEW_REQUIRED / REJECTED の3つ。
**候補が複数あって1件に決められないときは、勝手に決めずに落とす**（`MULTIPLE_MATCH_UNRESOLVED`）。

### 5.3 順位付け（rank.ts）

`CHEAPEST_ONLY_DECISION_ALLOWED = false` — **一番安い店を自動で選ぶことを禁じた。**
安い理由が「傷あり」「並行輸入」「送料別」であることが多いため。
`KEEP_ALL_CANDIDATES = true` — **落とした候補も全部残す**（後から見直せるように）。

### 5.4 段階Gate（queue.ts）

**47件へ一気に当てない。**

```
1件 → （人が結果を見て合格）→ 5件 → （人が見て合格）→ 10件
PHASE6_MAX_PRODUCTS = 10
LIVE_SUPPLIER_CONNECTOR_MAX = 1   （同時に繋ぐ仕入先は1つまで）
```

### 5.5 ファネルと脱落理由（funnel.ts）

**6段（段が進むほど数は必ず減る。増えていたら数え方が壊れているので止める）**

```
Amazonで調べた商品 → 仕入候補が見つかった → 同じ商品と確認できた
→ 利益を計算できた → 利益が出る → 買ってよい
```

**脱落理由9分類**

| 理由 | 見張りへ回す？ |
|---|---|
| 仕入先に1件も無かった | — |
| 別の商品だった | — |
| 候補が複数あって1件に決められない | — |
| 在庫が無い | ✅ 回す |
| 送料が分からない | — |
| Amazonの手数料が分からない | — |
| 利益が出ない | ✅ 回す |
| 利益率が低すぎる | ✅ 回す |
| データが古い | — |

> **「落ちた」＝「失敗」ではない。** 値段が下がれば買える商品は、見張り（WATCHING）へ回す。

**KPI5つ**：仕入先が見つかった割合／利益が出た割合／買ってよいと判断できた割合／
100件調べたときの見込み利益／買える1件を見つけるためにかかった費用。

> **分母が0のときは 0% ではなく「出せない（null）」**（ルール116）。
> 0%と書くと「やったけど駄目だった」に見えるが、実際は「まだやっていない」だから。

### 5.6 利益計算は新しく作らない（route.ts）

Phase 4 の `judgeBuyDecision` / `calcRouteProfit` を**そのまま使う**。
**Phase 6 で利益の計算式を1つも増やしていない。**（式が2つあると、どちらが正しいか分からなくなる）

- `POINTS_ADDED_TO_PROFIT = false` … **ポイントは現金として利益に足さない**（別枠で表示するだけ）
- `checkCrossBorderCosts()` … 国をまたぐ仕入は、国際送料・関税・為替などが**そろわないとBUYにしない**
- `PURCHASE_IS_HUMAN_ONLY = true` … 買うのは人。AIは候補を出すだけ

---

## 6. 実装中に見つかった失敗3件（残す）

> [!note] なぜ失敗を書き残すか
> 3件とも「動いているように見えて、静かに間違った数字を出す」型だった。
> テストが無ければ気づけなかった。**同じ型を次も踏むので、型ごと残す。**

### 失敗① 「条件付き送料無料」を 0円 として読んでいた

Yahoo!の答えには `shipping.code = 1（送料無料）/ 2（条件付き送料無料）` がある。
実装が「名前に**無料**が入っていれば0円」としていたため、
**「5,000円以上で送料無料」も0円**として読み込んでいた。

→ **1個だけ買うときに無料になるとは限らない。0円と書いた瞬間、利益を送料ぶん多く見積もる。**
「条件」「以上」「一部」「地域」「除く」「まで」が入っていたら **金額を作らず「不明」に倒す**よう直した。

### 失敗② ポイントの金額が、値があるのに毎回0（null）になっていた

入れ子の道順を辿る関数に `['point', 'amount']` と渡していた。
これは「point の中の amount」を探しに行く指定だが、実際の答えは `point` 自体が金額だった。
**存在しない道を探しに行っていたので、値があるのに毎回 null。**

→ 「候補の並び」と「入れ子の道順」を取り違えた典型（ルール97）。
`point` / `amount` / `premiumAmount` を**順に試す**形へ直した。

### 失敗③ テストの側が間違っていた（依存ゼロ判定）

「このファイルは何もimportしていないか」を調べるテストが、
**`import type`（型だけの読み込み）まで数えていた**。
型は組み立てた瞬間に消えるので、画面には何も載らない＝依存ゼロは保たれている。

→ **テストが事実を読み違えていた**ので、テスト側を直した（ルール64）。
ただし**「なぜ直したか」をコードに書き残した**。安全装置を黙って外す形にしないため。

---

## 7. テスト結果

```
npm run test:phase6   →  414項目 / 失敗0
受け入れテスト19本    →  全部通過（合計3,324項目 / 失敗0）
npx tsc --noEmit      →  エラー0
npm run build         →  成功（19ルート）
```

**外部への通信は 0回。** テストは全部、手元の固定サンプルで動く。

---

## 8. 人がやる残作業（AIは手を出さない）

> [!important] AIは外部へ連絡しない（`CONTACT_VENUE_BY_AI_ALLOWED = false`）
> 以下は**必ず人が送る**。AIが勝手に問い合わせフォームを埋めることはしない。

### ★最優先：Yahoo!への問い合わせ（これが通れば Phase 6 は動き出す）

| 項目 | 内容 |
|---|---|
| 聞くこと | 事業者が**自社の仕入判断のため**に商品検索API v3 を使ってよいか |
| なぜ聞くか | 同じFAQに「非商用目的のみ」と「商用をすべて禁じるものではない」が併記されており、公式の文だけでは決まらない |
| どこへ | [ガイドラインFAQ](https://support.yahoo-net.jp/PccDeveloper/s/article/H000011080)（法人の商用希望は各APIの問い合わせ窓口へ相談、と案内されている） |
| 一緒に聞くと良いこと | ① 取得データを自社DBに保存してよいか ② Amazonの価格と突き合わせてよいか ③ 社内の非公開画面でもクレジット表示が要るか |

### eBay側（4件・ただし優先度は低い）

1. Browse APIだけを本番で使う場合に、パートナー承認とEPN加入が要るか（書面で）
2. 「eBayで買ってAmazonで売る」が seller arbitrage の禁止に当たるか
3. 社内の非公開画面が Public Display に当たるか（Amazonの数字と並べてよいか）
4. 相場の平均を出す使い方について、書面の事前許可を申請する

> **eBayは①日本の市場が無い ②AI学習へ入れられない ③他社データと混ぜられない の3点で、
> 当社の設計と根本的に相性が悪い。Yahoo!が通らなかった場合の代替として置くに留める。**

---

## 9. 今この仕組みで出来ること／もっと良くなる点

### 出来ること（強み）

1. **規約違反が構造的に起きない。** 門が閉じている限り、うっかり実行しても通信は起きない。フラグを1つ書き換えれば動いてしまう作りにしていない（**取得コードそのものが無い**）。
2. **判断の根拠がすべて残っている。** 10項目×2市場、原文引用・出典URL・確認日つき。後から「なぜ止めたのか」を人が検証できる。
3. **許可さえ下りれば、その日から動く。** 読み取り・突き合わせ・順位付け・利益計算・BUY判定まで全部出来ていて、414項目のテストが通っている。足りないのは通信の1本だけ。
4. **危ない自動化が1つも入っていない。** 自動購入・自動発注・スクレイピング・AIからの外部連絡、すべてコードごと不在。

### もっと良くなる点（次にやると効く順）

1. **【最優先】Yahoo!へ問い合わせる。** ここが `YES` になれば `UNKNOWN` 6件のうち複数が同時に解ける。**Phase 6 の全体が1通のメールで止まっている。**
2. **国内の第3候補を洗い直す。** eBayが構造的に相性悪いと分かったので、楽天市場API・ヨドバシ等、**国内かつAI学習の禁止条項が無い**市場を優先で再評価する。国内なら国際送料・関税の問題も消える。
3. **Rate Limit の3数字を実測で決着させる。** 許可が下りた後、1件テストの段階で実際の上限を測って記録に残す（今は一番厳しい値で仮置き）。
4. **クレジット表示を画面に先に入れておく。** Yahoo!側は義務が確定している唯一の項目。許可が下りてから慌てず、今のうちに `/research` へ入れておける。

---

## 10. 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-08-26 | Phase 6 実装。LEGAL_USAGE_GATE（10項目×4種別）を新設。Yahoo!ショッピングを登録 → BLOCKED（不明6件）。eBay Browse APIを第2市場として登録 → BLOCKED（不明6・禁止1・未実装義務1）。受け入れテスト19本目（414項目）を追加し全通過。**外部への通信は0回。** |

---

## 関連

- [[00_設計書v1_最上位]] — §0.5 主経路、§19 国をまたぐ仕入、§24〜§27 ファネル/KPI、§29 自動リサーチ、§30 実購入
- [[29_Phase5設計_AUTO_RESEARCH_ORCHESTRATOR]] — 47件が止まった経緯
- [[28_Phase4設計_Supplier to Amazon Route Validation]] — 利益エンジン（Phase 6はこれを再利用）
- [[19_Connector再調査_市場別スコア]] — Rate Limit の食い違いの出どころ
- [[17_市場別_正規データ取得調査]] — 市場ごとの最初の調査
- [[04_ロードマップ]]
