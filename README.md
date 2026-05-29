# STAGE UP — 問い合わせを増やす営業改善サービス LP

純粋なHTML + CSS + JavaScriptのみで構築された、1ページ完結のランディングページです。
**ビルド不要・依存関係なし**。GitHubにアップロード → Vercelで公開、で完了します。

## ファイル構成（合計7ファイル）

```
hp-auto-system/
├── index.html        ← LP本体（全セクションを含む）
├── style.css         ← デザイン（黒×金 / レスポンシブ）
├── script.js         ← アコーディオン・スクロール演出・Calendlyポップアップ
├── vercel.json       ← Vercelの最小設定
├── robots.txt
├── sitemap.xml
└── README.md
```

## あなたの作業：①GitHub と ②Vercel だけ

### ① GitHub

1. https://github.com/new で新規リポジトリを作成（任意の名前）
2. 「**uploading an existing file**」をクリック
3. 上記7ファイル全てをドラッグ&ドロップ
4. 「Commit changes」

### ② Vercel

1. https://vercel.com/new でGitHubログイン
2. 作成したリポジトリの「Import」をクリック
3. **Framework Preset**：そのまま「Other」または自動検出のまま
4. 「Deploy」をクリック → 30秒〜1分で完了

公開URL（例：`https://your-repo.vercel.app`）が発行されます。

## 公開後に書き換えるべき箇所

`index.html` と `script.js` 内の以下を実際の値に置換してください：

| 置換対象 | 場所 |
|---|---|
| `https://lin.ee/REPLACE_ME` | index.html（6箇所） … 公式LINEのURL |
| `https://calendly.com/your-account/30min` | script.js（CALENDLY_URL定数） |
| `050-0000-0000` | index.html, sitemap.xml … 代表電話番号 |
| `info@example.com` | index.html … 連絡用メール |
| `https://example.com` | sitemap.xml, robots.txt, JSON-LD … 本番URL |

書き換え後、GitHubに同じファイルを再アップロードすればVercelが自動再デプロイします。

## 機能

- ✅ ファーストビュー → 悩み → 未来 → 理由 → 実績 → サービス → 声 → 料金 → FAQ → CTA の10セクション
- ✅ LINE誘導：ヘッダー / ヒーロー / 料金 / CTA / 固定ボタン
- ✅ Calendly予約：ヒーロー / CTA / モバイル固定バー
- ✅ FAQアコーディオン（JS）
- ✅ モバイル下部固定3ボタンバー（電話 / LINE / Calendly）
- ✅ PC右下の円形LINEボタン
- ✅ スクロール出現アニメーション
- ✅ レスポンシブ（モバイルファースト）
- ✅ SEO：title / description / OGP / Twitter Card / JSON-LD（Organization / Service / FAQPage）
- ✅ アクセシビリティ：aria属性 / `prefers-reduced-motion` 対応

## ローカル確認（任意）

ファイルをダブルクリックしてブラウザで開くだけで確認できます。
（CalendlyのウィジェットはローカルでもCDN経由で動作します）
