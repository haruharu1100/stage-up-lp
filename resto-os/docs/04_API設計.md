# 04 API設計

対応：5 API設計

---

## 5-0. 共通ルール

### 形式
- すべて JSON。成功は `{ "ok": true, ... }`、失敗は `{ "ok": false, "error": "理由", "code": "..." }`。
- エラーコードは画面に日本語で出せるよう、意味のある名前にする
  （例 `COUPON_MIN_AMOUNT` → 「このクーポンは¥5,000以上でご利用いただけます」）。

### すべてのAPIが最初に通る3つの門

```js
export async function POST(req) {
  const ctx = await requireAuth(req);              // ① 誰か（tenant_id / store_id / role が確定）
  requireRole(ctx, ['owner','admin','manager']);   // ② その操作をしてよいか
  requireFeature(ctx, 'coupon');                   // ③ 契約プランに含まれるか
  // …以降、ctx 経由でしかDBに触れない（tenant_id が自動で付く）
}
```

- `ctx` を通さないDBアクセスは書けない構造にする。
- 権限チェックの呼び忘れを検出する自動テストを用意する（全APIを走査）。

### 認証
| 相手 | 方法 |
| --- | --- |
| 管理系（オーナー／管理者／店長） | セッションCookie（HttpOnly / Secure / SameSite=Lax） |
| 現場（スタッフ／厨房） | 店舗PINでセッション発行。端末に長期Cookie（店舗＋個人） |
| お客様 | 認証なし。`token`（卓の使い捨てトークン）で卓を特定 |

### レート制限
| 対象 | 上限 |
| --- | --- |
| お客様の注文送信 | 1卓 10秒に1回 |
| 店員呼び出し | 1卓 60秒に1回 |
| ログイン | 1IP 5回/15分（失敗時ロック） |
| AI系（おすすめ・AI店長） | 1店舗 60回/時 |

---

## 5-1. 認証・アカウント

| メソッド | パス | 内容 |
| --- | --- | --- |
| POST | `/api/auth/login` | メール＋パスワード。成功でセッション発行。失敗も監査ログに記録 |
| POST | `/api/auth/pin` | 店舗PINログイン（スタッフ／厨房） |
| POST | `/api/auth/logout` | セッション破棄 |
| GET | `/api/auth/me` | 自分の権限・所属店舗・利用可能機能を返す |
| POST | `/api/signup` | 無料体験の申込（tenant/company/store/オーナーを一括作成＋サンプル投入） |

---

## 5-2. お客様（認証なし・tokenで特定）

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/menu?token=…&locale=ja` | 商品一覧（カテゴリー・人気順位・売り切れ・オプション込み）。**原価は含めない** |
| GET | `/api/orders?token=…` | その卓の注文履歴と現在の合計 |
| POST | `/api/orders` | 注文送信（下記詳細） |
| POST | `/api/calls` | 店員呼び出し（kind：staff/water/oshibori/plate/checkout） |
| POST | `/api/recommend` | AIおすすめ（mode: reco / upsell） |
| POST | `/api/table/open` | 人数登録（着席） |

### POST /api/orders（最重要API）

リクエスト：
```json
{
  "token": "3f9a…",
  "client_order_id": "8b1c-…-a92f",
  "source": "qr",
  "lines": [
    { "item_id": 12, "qty": 2,
      "options": [ {"group":"サイズ","label":"大盛り"} ],
      "note": "わさび抜き", "via": "upsell" }
  ]
}
```

サーバー側の処理順：

1. `token` から卓とテナントを特定。**空席の卓なら拒否**（`TABLE_NOT_SEATED`）。
2. `client_order_id` が既に存在すれば、**新規登録せず1件目の結果をそのまま返す**（二重注文防止）。
3. 商品を1件ずつDBから引き直す。売り切れ・非公開なら拒否（`ITEM_SOLD_OUT`）。
4. **金額はサーバーで再計算**。クライアントから送られた価格は一切見ない。
   ```
   単価 = 商品price + 存在するオプションのpriceのみ加算
   数量 = 1〜99 に丸める
   ```
   存在しないオプションが送られてきたら無視（＝加算しない）。
5. `orders` 1件と `order_items` n件を**1つのトランザクションで**書く。途中で失敗したら全部取り消す。
6. 受理番号（`order.public_id`）を返す。**クライアントはこれを受け取って初めて「注文完了」を表示する。**

レスポンス：
```json
{ "ok": true, "order_id": "or_7kd2…", "accepted_at": "2026-08-17T11:20:03Z", "items": 3 }
```

失敗時はクライアントが3回まで自動再送。`client_order_id` は変えないので二重にならない。

---

## 5-3. 厨房（KDS）

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/kds?station=grill&since=…` | 未提供の明細を新しい順に。卓・注文ごとにまとめて返す |
| PATCH | `/api/kds/:itemId` | 状態変更 received→cooking→ready→served |
| PATCH | `/api/kds/bulk` | まとめて完成にする（同一注文の一括操作） |
| POST | `/api/menu/:id/soldout` | 厨房から売り切れ切替 |
| GET | `/api/kds/heartbeat` | **未達検知用**。サーバー時刻と最終注文IDを返す |

**未達検知の仕組み：** KDSは5秒ごとに `heartbeat` を叩き、
（a）20秒以上応答が無い、または（b）POS側の最新注文IDより自分が古い、
のいずれかで**全画面赤の警告＋音**を出します。「厨房に注文が届いていない」に店が気づけない状態を作りません。

---

## 5-4. ホール・POS

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/tables` | 卓一覧（状態・人数・滞在時間・未会計金額・呼び出し有無） |
| GET | `/api/calls` | 未対応の呼び出し一覧 |
| PATCH | `/api/calls/:id` | 対応済みにする |
| GET | `/api/checkout?tableId=…` | 会計プレビュー（明細・小計・割引・合計・均等割り） |
| POST | `/api/checkout` | 会計確定（下記） |
| POST | `/api/checkout/:id/void` | 会計取消（**理由必須・店長以上**） |
| POST | `/api/checkout/:id/refund` | 返金（**理由必須・店長以上**） |
| PATCH | `/api/orders/:itemId/void` | 注文明細の取消（**理由必須**・スタッフは可だがログ記録） |
| POST | `/api/pos/close` | 日次締め（現金残高の入力・差異記録） |

### POST /api/checkout
1. その卓の `check_id IS NULL` かつ `status <> 'void'` の明細を集める。
2. **小計・割引・合計をサーバーで再計算**（クライアントの金額は使わない）。
3. クーポン検証（有効・期間内・最低金額）。満たさなければ理由付きで拒否。
4. トランザクションで：`checks` 追加 → 対象明細に `check_id` を刻む → 未対応の呼び出しを閉じる
   → 卓を空席に戻す → **QRトークンを再発行** → クーポン使用回数を+1 → 監査ログ記録。
5. レシート内容と均等割り金額を返す。

**二重会計の防止：** 手順1で `check_id IS NULL` を条件にしているため、
同時に2人が会計ボタンを押しても2件目は対象0件になり、`ALREADY_CLOSED` を返します。

---

## 5-5. 管理（店長以上）

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET/POST/PATCH | `/api/admin/menu` | 商品CRUD（価格変更・削除は監査ログ必須） |
| GET/POST/PATCH | `/api/admin/categories` | カテゴリー |
| GET/POST/PATCH | `/api/admin/tables` | 卓・QR。`/api/qr?token=…` でPNG生成 |
| GET/POST/PATCH | `/api/admin/coupons` | クーポン |
| GET/POST/PATCH | `/api/admin/staff` | スタッフ・権限・PIN再発行 |
| GET | `/api/admin/orders?view=history&q=…` | 注文履歴（取消含む） |
| GET | `/api/admin/logs?from=&to=&actor=&action=` | 操作ログ検索・CSV出力 |
| GET/PATCH | `/api/admin/settings` | 店舗設定 |
| GET | `/api/stats?date=…` | 売上サマリー・ランキング・時間帯・支払方法・AI経由売上 |
| GET | `/api/stats?manager=1` | AI店長コメント付き |
| GET/POST | `/api/admin/billing` | プラン確認・変更・請求書一覧 |

`/api/stats` は **role によって返す項目を変えます**。店長設定がOFFなら原価・粗利をレスポンスから外します。

---

## 5-6. AI関連

| パス | 内容 | キーが無いとき |
| --- | --- | --- |
| `POST /api/recommend` (mode=reco) | 人数・時間帯・注文済みから3品提案 | ルールベース（人気順＋カテゴリー補完）に自動フォールバック |
| `POST /api/recommend` (mode=upsell) | 「唐揚げと一緒にハイボールはいかがですか？」 | 店が設定した `pair_with` を使用。無ければ定番ペアのルール |
| `GET /api/stats?manager=1` | AI店長コメント | 数値ベースの定型コメント |
| `POST /api/translate` | 商品名・説明を英中韓へ | 翻訳せず日本語のまま表示 |

**AI共通の安全策**
- 返すIDは必ずDBの実在商品と突き合わせ、売り切れ・非公開を除外する（存在しない商品を勧めない）。
- プロンプトに「『必ず』『絶対』『最安』などの断定・誇大表現を使わない」「効能をうたわない」を必ず入れる。
- タイムアウト6秒。超えたらルールベースへ。**AIが落ちても店は営業できる。**
- 生成文は保存し、店が編集できる（AIの出力をそのまま客に出し続けない）。

---

## 5-7. 自社運用（社内のみ）

| パス | 内容 |
| --- | --- |
| `GET /api/ops/tenants` | 契約一覧・プラン・利用状況 |
| `GET /api/ops/health` | 各店舗の最終注文時刻・エラー件数（異常検知） |
| `POST /api/ops/impersonate` | サポート代理ログイン（**必ず監査ログに記録し、店側にも表示**） |
| `POST /api/webhooks/stripe` | 決済状態の受信（署名検証必須） |

---

## 5-8. エラーコード一覧（画面表示文つき）

| code | HTTP | 画面表示 |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | ログインし直してください |
| `FORBIDDEN` | 403 | この操作の権限がありません |
| `NOT_FOUND` | 404 | 見つかりません（**他テナントのデータも必ずこれ**） |
| `TABLE_NOT_SEATED` | 409 | この席は現在ご利用できません。店員をお呼びください |
| `ITEM_SOLD_OUT` | 409 | 申し訳ございません、売り切れになりました |
| `DUPLICATE_ORDER` | 200 | （エラー表示せず既存の注文結果を返す） |
| `ALREADY_CLOSED` | 409 | この会計はすでに完了しています |
| `COUPON_INVALID` | 400 | クーポンが見つかりません |
| `COUPON_MIN_AMOUNT` | 400 | このクーポンは¥5,000以上でご利用いただけます |
| `REASON_REQUIRED` | 400 | 理由の入力が必要です |
| `PLAN_REQUIRED` | 402 | この機能は上位プランでご利用いただけます |
| `RATE_LIMITED` | 429 | 少し時間をおいてお試しください |
