# STAGE UP LP

問い合わせ改善・営業改善サービスのLPプロジェクト。

---

## ⚠️ プロジェクト重要ルール（厳守）

### 🔒 ルール1：トップページ `/` は常に公開（Basic認証なし）
- `index.html` は**公式営業LP**。「STAGE UP」を売るLPです。

### 🎯 ルール2：トップページの目的
- 自社サービス紹介 / LINE誘導 / Calendly予約導線

### 🔐 ルール3：Basic認証は「企業別 提案LP」と「/admin」だけ

### 🗂 ルール4：企業別LPは `_proposals/` に分離

### ❌ ルール5：トップページの上書き禁止

### 🪜 ルール6：トップを更新するときはこのHTMLをベースに差分編集

### 🏢 ルール7：企業別LPは「その会社の公式ホームページ」風
- STAGE UP の営業提案書ではなく、**その会社が運営している公式サイト**として作成
- 料金・SEO・MEO・LP制作・営業改善 等の STAGE UP サービス文言は禁止
- 連絡先はすべてダミー（`XXX-XXXX-XXXX` / `info@example.com` / `〇〇県〇〇市〇〇町〇-〇-〇` / `お問い合わせはこちら`）
- LP 内に明示：`※本ページはご提案用サンプルとして作成しております。掲載情報は仮の内容を含みます。`

### 🚫 ルール8：業種不明の会社は LP を作成しない
- 会社名だけで業種が判断できない会社は、**推測でLPを作らない**
- スプレッドシートで「業種予測：不明 / 営業優先度：高（？） / LP URL：空欄」管理
- 業種判明後にLP作成 → `ACCOUNTS` 追加 → HTML アップロード

---

## 🌐 URL 設計

| URL | 認証 | 内容 | 状態 |
|---|---|---|---|
| `/` | 🟢 認証なし | 公式サービスLP | ✅ 公開中 |
| `/admin` | 🔐 `admin` / `stageup-master-2025` | 営業LP一覧（管理画面） | ✅ 公開中 |
| `/1-aireform` | 🔐 `sample` / `sample1234` | 株式会社AIリフォーム様（リフォーム会社） | ✅ 制作済み |
| `/4-its` | 🔐 `sample` / `sample1234` | ITS株式会社様（IT会社・推定） | ✅ 制作済み |
| `/5-aokikensetsu` | 🔐 `sample` / `sample1234` | 青木建設様（工務店） | ✅ 制作済み |
| ~~`/3-aikou`~~ | — | 愛光合同会社様 | ❌ 業種不明・保留 |
| ~~`/9-kumon`~~ | — | 株式会社公文様 | ❌ 業種不明・保留 |

**企業別LP共通資格** `sample` / `sample1234`（全ての企業別LPで統一）
**マスター資格** `admin` / `stageup-master-2025` は**全ページにアクセス可能**（運営者用）

---

## 📁 ファイル構成

```
stage-up-lp/
├── index.html              ← 🟢 公開トップ（STAGE UP営業LP）
├── style.css               ← 共通デザイン
├── script.js               ← 共通JS
├── vercel.json             ← ルーティング設定
├── package.json
├── robots.txt / sitemap.xml
├── api/
│   └── auth.js             ← 🔐 Basic認証ゲート
└── _proposals/             ← 🔐 認証経由でのみ配信
    ├── admin.html          ← /admin (営業LP一覧)
    ├── 1-aireform.html     ← /1-aireform (リフォーム会社)
    ├── 4-its.html          ← /4-its (IT会社)
    └── 5-aokikensetsu.html ← /5-aokikensetsu (工務店)
```

業種不明の会社は HTML ファイル自体作成しません（スプレッドシート管理のみ）。

---

## 🆕 新しい企業ページの追加手順

### 業種が判明している場合
1. `_proposals/<slug>.html` を作成（業種に合わせた公式サイト風）
2. `api/auth.js` の `ACCOUNTS` に資格情報を追加
3. `_proposals/admin.html` にカードを追加
4. push → 自動デプロイ

### 業種が不明な場合
- LP は作成しない
- スプレッドシートに記載：
  - 業種予測：**不明**
  - 営業優先度：**高（？）**
  - LP URL：**空欄**
  - 備考：業種不明のためLP作成保留

---

## ✏️ トップページを更新する場合

- `index.html` を直接編集（差分のみ）
- `_proposals/` や `api/auth.js` には触れる必要なし

---

## 📝 連絡先（公開トップに表示）

| 種別 | 値 |
|---|---|
| 公式LINE | `https://line.me/R/ti/p/@015vzsdb` |
| Calendly | `https://calendly.com/hatunemikudaisuki/30min` |
| 電話 | `070-3340-3552` |

**※ 企業別LPには使用しません**。企業別LPはすべてダミー連絡先で統一。

---

## 🚀 デプロイ

GitHub（リポジトリ `stage-up-lp`）に push するだけで Vercel が自動デプロイします。
