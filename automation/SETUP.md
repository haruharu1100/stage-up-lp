# AI自動広告改善システム セットアップガイド

> 初心者向け・各APIキーの取得から GitHub Actions で自動運用開始までの手順

## 🎯 完成後のイメージ

毎朝7時に自動で：
1. Google広告 / GA4 / Clarity からデータ取得
2. Google Sheets に保存
3. Claude AI が分析・改善案を生成
4. メールで日次レポート送付

→ あなたはメールを5分見るだけで PDCA 回せます。

---

## ⏱ 全体所要時間

- **Phase A**：API キー取得（合計 90分・Google Ads は1週間待ち）
- **Phase B**：環境変数登録（10分）
- **Phase C**：動作確認 → 自動運用開始（10分）

---

## Phase A：APIキーの取得（90分）

### A-1. Anthropic Claude APIキー（5分）⭐ 最初にこれ

1. https://console.anthropic.com を開く
2. ログイン（メアド登録）
3. 左メニュー「**API Keys**」
4. 「**Create Key**」をクリック
5. 名前：`stage-up-lp-automation`
6. 表示されたキー（`sk-ant-api03-...`）を **メモ**

→ 課金設定（Billing）で **$20 入金**しておく（月の予算上限を$50に設定推奨）

### A-2. Google Ads 開発者トークン（30分申請 + 1週間待ち）

⚠️ **承認に数日〜1週間かかります**。最初に申請開始してください。

1. https://ads.google.com にログイン
2. 右上「**ツール ⚙️**」→「**APIセンター**」
3. 「**API トークンを申請**」
4. 必要事項を記入：
   - アカウントタイプ：**広告主**
   - 利用目的：`自社広告アカウントのレポート・分析自動化`
   - 開発者連絡先：あなたのメール
   - 使用予定の API：**Google Ads API**
5. 申請後、Google から審査の連絡（メール）が来る → 質問に答える

**取得できるもの**：
- 開発者トークン（`xxxxxxxxxxxxxxxxxxxxxx` 22文字）

### A-3. Google Cloud Project（OAuth）（20分）

Google Ads API には開発者トークンに加えて OAuth 認証が必要。

1. https://console.cloud.google.com にアクセス
2. プロジェクト作成：「**stage-up-lp-automation**」
3. 左メニュー「**APIとサービス**」→「**有効なAPI**」
4. 以下のAPIを有効化：
   - **Google Ads API**
   - **Google Analytics Data API**
   - **Google Sheets API**
5. 「**認証情報**」→「**+ 認証情報を作成**」→「**OAuth クライアントID**」
6. アプリケーション種類：**デスクトップ アプリ**
7. 名前：`stage-up-lp-automation`
8. 作成完了 → JSON ダウンロード

**取得できるもの**：
- `client_id`（`xxxxxxxxxxxx.apps.googleusercontent.com`）
- `client_secret`（`GOCSPX-...`）

### A-4. Google Ads Refresh Token（10分）

開発者トークン取得後に実施。

1. `https://developers.google.com/oauthplayground` にアクセス
2. 右上の歯車 ⚙️ →「**Use your own OAuth credentials**」にチェック
3. A-3 で取得した `client_id` と `client_secret` を入力
4. 左の「**Step 1**」で `https://www.googleapis.com/auth/adwords` を選択
5. 「**Authorize APIs**」→ Google アカウント認可
6. 「**Step 2**」→「**Exchange authorization code for tokens**」
7. 表示された `refresh_token`（`1//0eXX...`）を **メモ**

### A-5. GA4 サービスアカウント（15分）

1. https://console.cloud.google.com → プロジェクト選択
2. 「**APIとサービス**」→「**認証情報**」
3. 「**+ 認証情報を作成**」→「**サービスアカウント**」
4. 名前：`ga4-reader`
5. 役割：**閲覧者**（必要に応じて GA4 側で追加権限）
6. 作成後、そのサービスアカウントをクリック
7. タブ「**キー**」→「**鍵を追加**」→「**新しい鍵を作成**」→「**JSON**」
8. JSONファイルがダウンロードされる → 中身全体を **メモ**

#### GA4 側で権限付与

1. https://analytics.google.com → 通信比較ナビプロパティ
2. 「**管理** ⚙️」→「**プロパティのアクセス管理**」
3. 「**+ ユーザーを追加**」
4. メールアドレス：A-5 で作成したサービスアカウントのメール（`xxx@xxx.iam.gserviceaccount.com`）
5. 役割：**閲覧者**
6. 追加

### A-6. Microsoft Clarity APIトークン（5分）

1. https://clarity.microsoft.com にログイン
2. 通信比較ナビプロジェクトを選択
3. 「**設定**」（右上の歯車）→「**Data Export**」or「**API**」
4. 「**Generate New API token**」
5. トークン（`eyJhbGc...`）を **メモ**

### A-7. Google Sheets を作成（5分）

1. https://sheets.google.com で新規スプレッドシート作成
2. 名前：`通信比較ナビ 日次データ`
3. URL の中の長い文字列（`/d/{ここ}/edit`）が **シートID**。メモする
4. **A-5 のサービスアカウントメール** を「**共有**」で**編集者**として追加

---

## Phase B：環境変数の登録（10分）

### B-1. ローカル `.env` ファイル作成

```bash
cd automation
cp .env.example .env
```

`.env` をテキストエディタで開き、Phase A で取得した値を埋める：

```ini
GOOGLE_ADS_DEVELOPER_TOKEN=xxxxxxxxxxxxxxxxxxxxxx
GOOGLE_ADS_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_ADS_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
GOOGLE_ADS_REFRESH_TOKEN=1//0eXX-XXXX
GOOGLE_ADS_CUSTOMER_ID=660-005-6599

GA4_PROPERTY_ID=526526283
GA4_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...",全文}

CLARITY_API_TOKEN=eyJhbGc...
CLARITY_PROJECT_ID=x283fyep35

ANTHROPIC_API_KEY=sk-ant-api03-...

SHEETS_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxx

NOTIFY_EMAIL_TO=hatunemikudaisuki@gmail.com
NOTIFY_EMAIL_SMTP_USER=hatunemikudaisuki@gmail.com
NOTIFY_EMAIL_SMTP_PASS={Gmailアプリパスワード}

DRY_RUN=false
```

### B-2. Gmail アプリパスワード（メール通知用）

通常のGmailパスワードは使えません。専用パスワード必要：

1. https://myaccount.google.com/security
2. 「**2段階認証プロセス**」が有効か確認（無効なら有効化）
3. 「**アプリ パスワード**」をクリック
4. アプリを選択：**メール**、端末：**Mac**
5. 16文字のパスワードが表示される → `.env` の `NOTIFY_EMAIL_SMTP_PASS` に貼り付け

### B-3. ローカル動作確認

```bash
cd automation
pip3 install -r requirements.txt
python3 scripts/verify_setup.py
```

→ すべて ✅ になればOK。次へ。

```bash
python3 scripts/main.py
```

→ エラーなく動作し、メールが届けば成功。

### B-4. GitHub Secrets に登録

1. GitHub リポジトリ https://github.com/haruharu1100/stage-up-lp を開く
2. 「**Settings**」→「**Secrets and variables**」→「**Actions**」
3. 「**New repository secret**」で `.env` と同じ名前で1つずつ登録：

| Name | Value |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | .env の値 |
| `GOOGLE_ADS_CLIENT_ID` | 同上 |
| ... | （全15項目） |

→ 全部登録するまで時間かかります。慎重に。

---

## Phase C：自動運用開始（10分）

### C-1. 手動実行で動作確認

1. GitHub リポジトリの「**Actions**」タブ
2. 左メニューに「**Daily AI Ad Report**」があるはず
3. 右上「**Run workflow**」→ ブランチ `main` 選択 → 実行
4. 30秒待って結果を見る → エラーなければ成功

### C-2. メール届いたか確認

`hatunemikudaisuki@gmail.com` に「📊 通信比較ナビ 日次レポート」が届いていれば完成 ✅

### C-3. 毎日自動実行

`.github/workflows/daily_report.yml` の `cron: '0 22 * * *'` で **毎日 JST 7:00 自動実行**されます。

何も操作しなくても、明日朝7時にメールが届きます。

---

## 🆘 トラブルシューティング

### Q. Google Ads 開発者トークンが承認されない

A. 申請から 3-7 日かかります。利用目的を「自社広告アカウントのレポート分析」と明記すれば通りやすいです。

### Q. ローカルで動くが GitHub Actions で失敗

A. Secrets の名前が `.env` の変数名と完全に一致しているか確認。スペース・改行に注意。
   特に `GA4_SERVICE_ACCOUNT_JSON` は **JSON全体を1行で**貼り付ける必要があります。

### Q. メールが届かない

A. Gmail のアプリパスワードが正しいか確認。`NOTIFY_EMAIL_TO` がスパムフォルダに入っていないか確認。

### Q. 何件くらいの広告KW で動くの？

A. 100KW までなら 30秒で完了。Claude API 月コストは ¥3,000-7,500 程度。

---

## 📞 サポート

セットアップで詰まったら、ChatGPT または Claude にこの SETUP.md を貼り付けて
「ここで詰まった」と聞けば、AI が個別アドバイスしてくれます。

すべて完了したら、毎日のレポートをチェックして PDCA を回しましょう。
