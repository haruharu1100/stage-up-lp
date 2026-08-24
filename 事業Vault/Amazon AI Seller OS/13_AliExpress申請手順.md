---
作成日: 2026-08-20
種別: 正式仕様（作業手順）
状態: ★ユーザー作業待ち。ここが終わるまで LIVE_DISCOVERY_READY は 0 のまま
---

# 13. AliExpress 申請手順（＝いま唯一のブロッカー）

> [!important] なぜこの1本に絞ったか
> Alibaba.com（ICBU）の公式APIには、**買い手が全カタログをキーワードで探すAPIが存在しない**ことが
> 2026-08-20 の監査で分かった（詳細 → [[12_仕入先自動探索仕様]] 第10節）。
> つまり「Amazonで売れている商品 → 中国で同じ物を安く探す」という**本命のやり方が成立しない**。
> AliExpress はそれが全部できる。だから本命を AliExpress に変更した。

---

## 0. 先に結論（何が手に入るか）

| 段階 | 必要なもの | 手に入る機能 | 目安 |
|---|---|---|---|
| **第1段階** | APP_KEY と APP_SECRET だけ | **キーワード検索・価格・画像・商品URL・販売実績** | 登録直後 |
| **第2段階** | ＋アクセストークン | **MOQ・在庫・実重量・実際の送料・公式の画像検索** | アプリ審査の後 |

- **第1段階だけでも「システムが自分で仕入先を探す」は本物になる。**
- ただし第1段階だけだと **MOQ・在庫・重量・送料は全部 UNKNOWN のまま**。
  この状態では「重要コストがUNKNOWNならAランク禁止」のルールにより、**Aランクは出ない**。
  それでよい。**嘘の利益を出すより、Aランク0件の方が正しい。**

---

## 1. どのページへ行くか

**https://openservice.aliexpress.com/**（AliExpress Open Platform）

※ Alibaba.com の開発者サイト（openapi.alibaba.com）とは**別サイト**。間違えやすいので注意。

---

## 2. どの種類の開発者登録をするか

1. 右上から **Sign Up / Register** → AliExpress のアカウントでログイン
   （買い物用の一般アカウントで構わない。中国法人である必要はない）
2. 開発者情報の入力
   - **個人（Individual）で申請できる。** 日本の個人事業主でも可
   - 会社名の欄は屋号でよい
3. メール認証を通す

---

## 3. どのApplication（アプリ）を作るか

「Console」→「**Create App**」

| 入力欄 | 何を選ぶ／書くか |
|---|---|
| App Name | 任意（例：`amazon-ai-seller-os`） |
| App Type | **Self-developed（自社利用）** |
| **Category** | **★ここが一番大事 → `Dropshipping`** |
| Callback URL | 使わないが必須なので `http://localhost:3900/callback` と入れておく |
| 用途の説明 | 「自社のAmazon販売のために、仕入候補の価格・在庫・送料を取得する」と正直に書く |

> [!warning] Categoryを `Affiliate` だけにしないこと
> Affiliate 区分だけだと **MOQ・在庫・重量・実送料が永久に取れない**。
> 「探せるけれど、利益がいくらか分からない」状態で止まる。

> [!danger] ★2026-08-20 追記：ここは一度きりの選択です（やり直せません）
> - **Affiliate と Dropshipping は、1つのアカウントで併用できません**（公式 docId 1935）。
> - **開発者の種別は、登録したあとから変更できません**（公式 docId 1868）。
>
> つまり、ここで `Affiliate` を選ぶと **Dropshipping へ移れません**。
> 仕入先探しが目的なので、**必ず `Dropshipping` を選んでください。**

---

## 4. どのAPI権限を申請するか

App作成後、「**API List / Apply for API**」で以下を申請する。

### 必須（これが無いと仕入判断ができない）

| API名 | 何のため |
|---|---|
| `aliexpress.ds.text.search` | キーワードで商品を探す |
| `aliexpress.ds.product.get` | **MOQ・在庫・実重量・卸の階段価格** |
| `aliexpress.ds.freight.query` | **日本向けの実際の送料**（着地原価が推定でなくなる） |

### 強く推奨（Amazon→中国の逆検索の精度が跳ね上がる）

| API名 | 何のため |
|---|---|
| `aliexpress.ds.image.searchV2` | **Amazonの商品画像で、同じ物を直接探す**（公式機能） |

### ★申請しません（2026-08-20 訂正）

| API名 | 以前の記載 | 実際 |
|---|---|---|
| `aliexpress.affiliate.product.query` | 「アクセストークン不要＝最速でLIVEにできる」 | **誤りでした** |

訂正の理由（公式で確認したこと）：

1. **アクセストークンは必要です。** 公式FAQ（docId 1957「Get the authorization (oauth)」／
   docId 1936「Generate access_token for call API」）により、アフィリエイト系も
   access_token を取って呼ぶ前提です。「鍵だけで動く」は成り立ちません。
2. **アフィリエイト対象の商品しか返りません**（docId 1909）。仕入先探しには範囲が狭すぎます。
3. **そもそも Dropshipping と併用できません**（docId 1935）。上のとおり Dropshipping を選ぶので、
   この枠は申請できません。

→ コード側でも「トークン不要」という記載を6箇所すべて訂正済みです。

---

## 5. 何というKey / Secretが発行されるか

App の詳細画面に表示される。

| 画面上の名前 | 中身 |
|---|---|
| **App Key**（AppKey / Client ID） | 数字だけの文字列（例：`5xxxxx`） |
| **App Secret**（Secret / Client Secret） | 英数字の長い文字列 |

アクセストークンは別。App承認後に「Authorization」からバイヤー自身のアカウントを認可すると
`access_token`（有効期限90日）と `refresh_token`（180日）が出る。

---

## 6. `.env` のどの名前に入れるか

`amazon-ai-seller-factory/.env` に、そのまま貼るだけ。

```
# --- 第1段階（これだけで探索が本物になる）---
ALIEXPRESS_APP_KEY=（App Key をここに）
ALIEXPRESS_APP_SECRET=（App Secret をここに）

# --- 第2段階（MOQ・在庫・送料・画像検索が使えるようになる）---
ALIEXPRESS_ACCESS_TOKEN=（access_token をここに）
ALIEXPRESS_REFRESH_TOKEN=（refresh_token をここに）
```

入れたあと、次のコマンドで**本当に取れたか**を確認する。

```
npm run aliexpress:live      … ★鍵が入ったらまずこれ1本。STEP1（認証確認だけ）から順に自動で進む
npm run aliexpress:plan      … 何をする予定かの確認だけ（外部APIを1回も叩かない）
npm run discovery:verify     … 配線と安全弁の確認（外部APIを1回も叩かない）
npm run discover:supplier    … いま何が使えるかを日本語で表示
npm run api:registry         … 5つのAPIが今どの段階か（VERIFIEDになったか）
npm run aliexpress:audit     … 危険な値（-1・0円・偽URL等）をはじけているか
npm run discovery:kpi        … KPI10項目の成績表
```

> [!important] 鍵を入れても「完成」ではありません
> 4段階（DOCUMENTED → AUTHORIZED → CONNECTED → **VERIFIED＝実商品を取得して中身を確認**）に加えて、
> **実商品取得・購入URL確認・価格取得・Amazon照合成功**の**計8条件**が揃うまで
> `LIVE_DISCOVERY_READY` は false のままです。
> 鍵を入れたら、いきなり100件ではなく **認証 → 1件 → 5件 → 20件** の順で増やしてください。
> 手順の詳細は **[[15_鍵待ちフェーズと投入直後テスト]]**（実行手順の正）と `14_AliExpress_LIVE化計画.md`（全体像）。

---

## 7. 申請時に気をつけること

1. **用途を正直に書く。** 「自社のAmazon販売の仕入判断に使う」でよい。
   審査に通りやすくするための嘘は書かない。
2. **Affiliate枠を選ばない。**（★2026-08-20 訂正：以前「トークン不要で楽」と書いていたのは誤り）
   - トークンは必要です（docId 1957・1936）。
   - Dropshipping と併用できません（docId 1935）。種別は後から変えられません（docId 1868）。
   - Affiliate は本来「販促」のための枠であり、販促実績ゼロのまま大量に照会し続ければ
     アカウント停止の可能性が残ります。
   （規約に「仕入判断に使ってはいけない」という明示の禁止条項は確認できなかったが、**確認できなかった＝許可された、ではない**）
3. **審査期間の公式記載は無い。** 「2〜5営業日」は各所の体験談であって公式の約束ではない。

---

## 8. これが終わると何が変わるか

| いま | 鍵が入った後 |
|---|---|
| `LIVE_DISCOVERY_READY` = **0件** | AliExpress が **1件** |
| システムは自分で商品を探せない | **Amazonで売れている商品 → 中国で同じ物を探す** が動く |
| 利益計算は仕入先データ待ち | 商品単価・MOQ・実送料まで入った**着地原価**が出る |
| Aランクは0件 | 条件を満たせばAランクが出る（出ないこともある。それでよい） |

---

## 関連
- [[12_仕入先自動探索仕様]] ← 監査の全結果はこちら
- [[11_仕入先LIVEデータ仕様]]（受け取り口。この文書とは別の層）
- [[04_契約すべきAPIと優先順位]]
- [[09_機能追加凍結と本番20商品検証]] ← ★発効中
