# AURA — X運用ツール

1人のオペレーターが複数のXアカウントを「丁寧に」運用するための時短ツール。
無人でフォロワーを増やす自動化装置ではない（自動フォロー・無差別いいね・自動DMは実装しない）。

## 構成

**1コードベース × 3独立デプロイ**（事業売却を見据えブランドごとに完全独立）。
差分は `config/brand.ts` と環境変数（`NEXT_PUBLIC_BRAND`）のみ。

| 号機 | 対象 | NEXT_PUBLIC_BRAND |
|---|---|---|
| aura-gacha | オンラインガチャ | `gacha` |
| aura-sneaker | スニーカー限定ガチャ | `sneaker` |
| aura-hub | 何でも話しておけ | `hub` |

## 技術スタック

Next.js 15 (App Router) / TypeScript / Tailwind CSS / Supabase / Vercel / X API v2 / Anthropic API。

## 開発

```bash
npm install
npm run dev        # http://localhost:3000
```

`.env.example` を `.env.local` にコピー。**`AURA_MODE=test` の間は外部に一切出ない**（P2まで test 固定）。

号機を切り替えるには `NEXT_PUBLIC_BRAND` を変更:

```bash
NEXT_PUBLIC_BRAND=sneaker npm run dev
```

## 実装状況

- [x] **P0** リポジトリ雛形・Supabaseスキーマ・`config/brand.ts`・デザイントークン・ホーム画面（モック）
- [ ] P1 X OAuth接続
- [ ] P2 投稿機能＋ガード
- [ ] P3 受信リプ
- [ ] P4 リプ周り（本命）
- [ ] P5 分析
- [ ] P6 LINE連携
- [ ] P7 2・3号機デプロイ

## DB

`supabase/migrations/0001_init.sql` にスキーマ一式（全テーブルRLS有効）。
外付けドライブ上のためDockerローカルは使わず、クラウドのSupabaseを直接参照する。
