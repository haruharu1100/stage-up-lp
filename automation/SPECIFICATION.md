# AI自動広告改善システム 開発者向け仕様書

> 通信ジャンル アフィリエイト LP 運用の AI 自動化システム

## 1. システム概要

### 1.1 目的
- Google広告・GA4・Microsoft Clarity・A8.net のデータを日次で自動取得
- Claude API による分析・改善案生成
- 人間の承認を経た上で広告改善を反映（将来的に一部自動化）

### 1.2 構成スタック

| レイヤ | 採用技術 |
|---|---|
| オーケストレーション | GitHub Actions（cron schedule）|
| 実装言語 | Python 3.11+ |
| データウェアハウス | Google Sheets |
| AI分析 | Anthropic Claude API（メイン）/ OpenAI GPT API（補助）|
| データソース | Google Ads API v15 / GA4 Data API / Clarity Data Export API / A8メール解析 |
| 通知 | メール（SMTP）/ Slack Webhook（オプション）|
| シークレット管理 | GitHub Secrets |

### 1.3 リポジトリ構成

```
hp-auto-system/
├── affiliate/                # 既存LP生成基盤
└── automation/               # 本仕様書の対象
    ├── SPECIFICATION.md      # このファイル
    ├── scripts/
    │   ├── fetch_ads.py      # Google広告データ取得
    │   ├── fetch_ga4.py      # GA4データ取得
    │   ├── fetch_clarity.py  # Clarityデータ取得
    │   ├── parse_a8_email.py # A8報酬メール解析
    │   ├── etl.py            # 統合ETL
    │   ├── analyze.py        # Claude分析
    │   ├── notify.py         # 通知送信
    │   └── main.py           # エントリポイント
    ├── config/
    │   ├── thresholds.yml    # 判定閾値
    │   └── prompts/
    │       ├── kw_analysis.md
    │       ├── ad_copy_gen.md
    │       └── lp_improve.md
    ├── lib/
    │   ├── google_ads_client.py
    │   ├── ga4_client.py
    │   ├── clarity_client.py
    │   ├── sheets_client.py
    │   └── claude_client.py
    ├── reports/              # 日次レポート保存先
    ├── requirements.txt
    └── .github/workflows/
        └── daily_report.yml
```

## 2. データソース仕様

### 2.1 Google Ads API

- **APIバージョン**: v15
- **必要な認証情報**:
  - Developer Token（Google広告マネージャアカウント経由で取得）
  - OAuth 2.0 Client ID / Secret
  - Refresh Token
  - Customer ID（660-005-6599）
- **取得クエリ例（GAQL）**:
  ```sql
  SELECT
    campaign.id, campaign.name,
    ad_group.id, ad_group.name,
    ad_group_criterion.keyword.text,
    ad_group_criterion.keyword.match_type,
    metrics.impressions, metrics.clicks, metrics.ctr,
    metrics.cost_micros, metrics.average_cpc,
    metrics.conversions, metrics.conversions_value,
    metrics.cost_per_conversion
  FROM keyword_view
  WHERE segments.date DURING LAST_7_DAYS
    AND campaign.status = 'ENABLED'
  ```

### 2.2 GA4 Data API

- **APIバージョン**: v1beta
- **プロパティID**: 526526283（通信比較ナビ stream配下のproperty）
- **取得Dimensions**: pagePath, source, sessionDefaultChannelGroup
- **取得Metrics**: sessions, activeUsers, averageSessionDuration, bounceRate, engagementRate, screenPageViews, eventCount
- **Custom Event**: cta_click（CTA クリック計測用）

### 2.3 Microsoft Clarity Data Export API

- **エンドポイント**: `https://www.clarity.ms/export-data/api/v1/project-live-insights`
- **認証**: Bearer Token（Clarity管理画面で発行）
- **取得項目**:
  - Sessions, Pages per session
  - Dead clicks, Rage clicks
  - Excessive scrolling, Quick backs
  - Top URLs

### 2.4 A8.net

- 公式API なし
- **取得方法**: A8からの確定報酬通知メールを Gmail で受信 → Gmail API で取得 → 正規表現でパース
- **代替案**: 週次で管理画面から CSV エクスポート → 手動アップロード

## 3. データスキーマ（Google Sheets）

### 3.1 `config` シート

| key | value | description |
|---|---|---|
| stop_cv_rate_threshold | 0.005 | CV率これ未満は停止候補 |
| stop_clicks_threshold | 100 | 判定に必要な最低クリック数 |
| boost_roas_threshold | 200 | ROAS これ以上で強化候補 |
| boost_cv_rate_threshold | 0.02 | CV率これ以上で強化候補 |
| review_lookback_days | 7 | 分析期間（日） |
| ad_ctr_threshold | 0.05 | 広告CTR最低基準 |
| lp_bounce_threshold | 0.70 | LP直帰率上限 |
| lp_cta_click_rate_threshold | 0.03 | LP内CTAクリック率最低基準 |

### 3.2 `kw_daily` シート

カラム: `date, customer_id, campaign_id, campaign_name, ad_group_id, ad_group_name, keyword, match_type, impressions, clicks, ctr, avg_cpc_jpy, cost_jpy, conversions, cv_rate, cpa_jpy, conversion_value_jpy, roas, quality_score, final_url, status`

### 3.3 `ad_daily` シート

カラム: `date, campaign_id, ad_group_id, ad_id, ad_type, headlines_json, descriptions_json, final_url, impressions, clicks, ctr, cost_jpy, conversions, cv_rate, cpa_jpy`

### 3.4 `lp_daily` シート

カラム: `date, lp_path, sessions, users, avg_engagement_time_sec, bounce_rate, engagement_rate, page_views, cta_clicks, cta_click_rate, source_channel`

### 3.5 `clarity_daily` シート

カラム: `date, lp_path, sessions, rage_clicks, dead_clicks, excessive_scroll, quick_back_rate, avg_scroll_depth`

### 3.6 `a8_conv` シート

カラム: `received_at, action_at, offer_id, offer_name, status, reward_jpy, gclid_estimated, source_lp_estimated, raw_email_id`

### 3.7 `stitched` シート（結合データ）

カラム: `date, keyword, lp_path, offer_id, ad_cost_jpy, cv_count_ads, cv_count_a8_confirmed, reward_jpy_estimated, roas, profit_jpy, status`

### 3.8 `insights` シート

カラム: `created_at, date_target, category, target_type, target_id, target_label, recommendation, reasoning, confidence, action_required, approved_by, applied_at, result_note`

### 3.9 `action_log` シート

カラム: `timestamp, actor, action_type, target_type, target_id, before_value, after_value, reason, insight_id, status`

## 4. AI分析判定ロジック

### 4.1 KW判定

```python
def classify_keyword(kw_metrics, config):
    """KWを 'STOP' / 'BOOST' / 'MAINTAIN' / 'INSUFFICIENT_DATA' に分類"""
    if kw_metrics['impressions'] >= 1000 and kw_metrics['clicks'] == 0:
        return 'STOP', '表示されてもクリックなし'
    
    if kw_metrics['clicks'] >= config['stop_clicks_threshold']:
        if kw_metrics['cv_rate'] < config['stop_cv_rate_threshold']:
            return 'STOP', f"CV率{kw_metrics['cv_rate']:.2%}（基準未満）"
        if kw_metrics['cpa_jpy'] > kw_metrics['expected_reward'] * 0.8:
            return 'STOP', f"CPA¥{kw_metrics['cpa_jpy']}が報酬の80%超過"
    
    if (kw_metrics['cv_rate'] >= config['boost_cv_rate_threshold'] and
        kw_metrics['roas'] >= config['boost_roas_threshold']):
        return 'BOOST', f"CV率{kw_metrics['cv_rate']:.2%}、ROAS{kw_metrics['roas']:.0f}%"
    
    if kw_metrics['impressions'] < 100:
        return 'INSUFFICIENT_DATA', '判定に必要な表示回数不足'
    
    return 'MAINTAIN', '基準内・継続観察'
```

### 4.2 広告文判定

```python
def classify_ad(ad_metrics, config):
    if ad_metrics['impressions'] >= 1000 and ad_metrics['ctr'] < config['ad_ctr_threshold']:
        return 'REPLACE', f"CTR {ad_metrics['ctr']:.2%}（基準未満）→ 広告文改善"
    
    if ad_metrics['clicks'] >= 50 and ad_metrics['cv_rate'] < 0.01:
        return 'INVESTIGATE', '集客はあるがLP着地後CV出ず → 広告文とLPの不一致疑い'
    
    return 'MAINTAIN'
```

### 4.3 LP判定

```python
def classify_lp(lp_metrics, clarity_metrics, config):
    issues = []
    
    if lp_metrics['bounce_rate'] > config['lp_bounce_threshold']:
        issues.append('直帰率高 → FV改善要')
    
    if lp_metrics['cta_click_rate'] < config['lp_cta_click_rate_threshold']:
        issues.append('CTA クリック率低 → CTA改善要')
    
    if clarity_metrics['rage_clicks_per_session'] >= 1:
        issues.append('Rage click 多発 → UI問題（要素見極め）')
    
    if clarity_metrics['quick_back_rate'] > 0.3:
        issues.append('Quick back 多 → 広告文と LP内容の不一致')
    
    if lp_metrics['avg_engagement_time_sec'] < 15:
        issues.append('滞在時間短 → コンテンツ魅力不足')
    
    return issues
```

## 5. Claude API プロンプト仕様

### 5.1 日次サマリー生成プロンプト

```
あなたは通信ジャンル アフィリエイト運用のプロアナリストです。
以下の昨日のデータを分析し、運用者向けに3-5行のサマリーを作成してください。

## データ
[KW別パフォーマンスCSV]
[LP別パフォーマンスCSV]
[A8確定報酬CSV]

## 出力フォーマット
{
  "summary": "...",
  "top_wins": [...],
  "top_concerns": [...],
  "urgent_actions": [...]
}
```

### 5.2 KW改善案生成プロンプト

```
過去7日間の KW パフォーマンスから、以下を提案してください：
1. 即時停止すべき KW（理由付き）
2. 入札強化すべき KW（理由付き）
3. 新規追加候補 KW（検索語句レポートから抽出）

各提案には confidence (0-1) を付与してください。
```

### 5.3 広告文生成プロンプト

```
以下のニッチ・案件向けに、Google検索広告（レスポンシブ検索広告）の
新規広告文を生成してください。

ニッチ: {niche_name}
ペルソナ: {persona}
案件: {offer_name}
訴求ポイント: {selling_points}

要件:
- 見出し15個（各30字以内）
- 説明文4個（各90字以内）
- 景表法NG表現禁止: 最安/業界一/絶対/100%/完全/必ず

3バリエーション（強訴求/中訴求/弱訴求）を生成してください。
JSONフォーマットで出力。
```

### 5.4 LP改善案生成プロンプト

```
以下のLP（HTMLテキスト抽出）と、Clarity/GA4の行動データから、
LP改善ポイントを5つ以内で具体的に提案してください。

## LP HTML
{lp_text}

## 行動データ
- 直帰率: {bounce_rate}%
- 平均滞在: {avg_engagement_time}秒
- CTAクリック率: {cta_click_rate}%
- Rage clicks: {rage_clicks_per_session}/session

## 出力
各改善案について:
- 修正対象セクション
- 現状の問題
- 改善案（具体的なHTML/コピー案）
- 期待効果
- 実装難易度（low/mid/high）
```

## 6. GitHub Actions ワークフロー

### 6.1 ファイル: `.github/workflows/daily_report.yml`

```yaml
name: Daily AI Ad Report

on:
  schedule:
    - cron: '0 22 * * *'  # 毎日 UTC 22:00 = JST 7:00
  workflow_dispatch:       # 手動実行も可能

jobs:
  fetch-and-analyze:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
      
      - name: Install dependencies
        run: pip install -r automation/requirements.txt
      
      - name: Run ETL
        env:
          GOOGLE_ADS_DEVELOPER_TOKEN: ${{ secrets.GOOGLE_ADS_DEVELOPER_TOKEN }}
          GOOGLE_ADS_CLIENT_ID: ${{ secrets.GOOGLE_ADS_CLIENT_ID }}
          GOOGLE_ADS_CLIENT_SECRET: ${{ secrets.GOOGLE_ADS_CLIENT_SECRET }}
          GOOGLE_ADS_REFRESH_TOKEN: ${{ secrets.GOOGLE_ADS_REFRESH_TOKEN }}
          GOOGLE_ADS_CUSTOMER_ID: ${{ secrets.GOOGLE_ADS_CUSTOMER_ID }}
          GA4_PROPERTY_ID: ${{ secrets.GA4_PROPERTY_ID }}
          GA4_SERVICE_ACCOUNT_JSON: ${{ secrets.GA4_SERVICE_ACCOUNT_JSON }}
          CLARITY_API_TOKEN: ${{ secrets.CLARITY_API_TOKEN }}
          CLARITY_PROJECT_ID: ${{ secrets.CLARITY_PROJECT_ID }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SHEETS_ID: ${{ secrets.SHEETS_ID }}
          SHEETS_SERVICE_ACCOUNT_JSON: ${{ secrets.SHEETS_SERVICE_ACCOUNT_JSON }}
          GMAIL_TOKEN_JSON: ${{ secrets.GMAIL_TOKEN_JSON }}
          NOTIFY_EMAIL: ${{ secrets.NOTIFY_EMAIL }}
          NOTIFY_EMAIL_SMTP_USER: ${{ secrets.NOTIFY_EMAIL_SMTP_USER }}
          NOTIFY_EMAIL_SMTP_PASS: ${{ secrets.NOTIFY_EMAIL_SMTP_PASS }}
        run: python automation/scripts/main.py
      
      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: daily-report-${{ github.run_id }}
          path: automation/reports/
          retention-days: 30
```

## 7. 必要なシークレット（GitHub Secrets）

| Secret Key | 取得方法 |
|---|---|
| GOOGLE_ADS_DEVELOPER_TOKEN | Google広告 → ツール → API センター |
| GOOGLE_ADS_CLIENT_ID/SECRET | Google Cloud Console → OAuth クライアントID |
| GOOGLE_ADS_REFRESH_TOKEN | OAuth フロー実行（初回のみ）|
| GOOGLE_ADS_CUSTOMER_ID | 660-005-6599 |
| GA4_PROPERTY_ID | GA4管理 → プロパティ詳細 |
| GA4_SERVICE_ACCOUNT_JSON | Google Cloud Console → サービスアカウント鍵 |
| CLARITY_API_TOKEN | Clarity管理画面 → 設定 → API |
| CLARITY_PROJECT_ID | x283fyep35 |
| ANTHROPIC_API_KEY | console.anthropic.com |
| SHEETS_ID | スプレッドシートURLから抽出 |
| SHEETS_SERVICE_ACCOUNT_JSON | GA4と同じサービスアカウント可 |
| GMAIL_TOKEN_JSON | Gmail OAuth フロー実行 |
| NOTIFY_EMAIL | 通知先メアド |
| NOTIFY_EMAIL_SMTP_USER/PASS | Gmailアプリパスワード等 |

## 8. main.py の処理フロー

```python
def main():
    # 1. データ取得
    ads_data = fetch_ads.run(lookback_days=7)
    ga4_data = fetch_ga4.run(lookback_days=7)
    clarity_data = fetch_clarity.run(lookback_days=7)
    a8_data = parse_a8_email.run(lookback_days=14)
    
    # 2. データ統合
    stitched = etl.stitch(ads_data, ga4_data, clarity_data, a8_data)
    
    # 3. スプレッドシート書込
    sheets_client.append('kw_daily', ads_data['keywords'])
    sheets_client.append('ad_daily', ads_data['ads'])
    sheets_client.append('lp_daily', ga4_data['lps'])
    sheets_client.append('clarity_daily', clarity_data)
    sheets_client.append('a8_conv', a8_data)
    sheets_client.append('stitched', stitched)
    
    # 4. ルールベース判定
    kw_classifications = classify_keywords(stitched)
    ad_classifications = classify_ads(ads_data['ads'])
    lp_classifications = classify_lps(ga4_data['lps'], clarity_data)
    
    # 5. Claude API で改善案生成
    summary = claude_client.generate_summary(stitched)
    kw_recommendations = claude_client.recommend_kw_changes(
        kw_classifications, stitched
    )
    ad_copy_suggestions = claude_client.generate_ad_copies(
        ad_classifications, lp_classifications
    )
    lp_improvements = claude_client.suggest_lp_improvements(
        lp_classifications, clarity_data
    )
    
    # 6. インサイトをスプレッドシートに保存
    insights = []
    insights.extend([{'category': 'KW_stop', ...} for kw in kw_recommendations['stop']])
    insights.extend([{'category': 'KW_boost', ...} for kw in kw_recommendations['boost']])
    insights.extend([{'category': 'ad_improve', ...} for s in ad_copy_suggestions])
    insights.extend([{'category': 'LP_improve', ...} for l in lp_improvements])
    sheets_client.append('insights', insights)
    
    # 7. 通知送信
    notify.send_daily_report(summary, insights, recipients=[NOTIFY_EMAIL])
```

## 9. テスト・検証手順

### 9.1 ローカルテスト

```bash
cd automation
cp .env.example .env
# .env に各種シークレットを記入

python scripts/main.py --dry-run  # 書込なしモード
```

### 9.2 GitHub Actions 手動実行

```
Actions タブ → Daily AI Ad Report → Run workflow
```

### 9.3 検証ポイント

- [ ] 各シートに正しいフォーマットで書込されているか
- [ ] Claude のレスポンスが期待した JSON 構造か
- [ ] 通知メールに人間が読める形式で届くか
- [ ] エラー時に Slack/メールにアラートが届くか
- [ ] スプレッドシートのデータ重複・欠損がないか

## 10. 将来の自動反映機能（Phase 3）

### 10.1 自動実行する判定

以下は人間承認なしで自動実行可能（インサイトの confidence ≥ 0.9 の場合）：
- 「100クリックでCV0」かつ「7日連続」のKW自動停止
- 検索ボリューム少警告KWの自動削除
- 検索語句レポートからの自動除外KW追加（無関係語）

### 10.2 半自動（人間確認後ワンクリック実行）

- 新規広告文の追加（自動生成済みのもの）
- 入札強化（予算アップ）
- 新規LP（自動生成済みのもの）の Google広告URL差替え

### 10.3 完全手動維持

- 新規キャンペーン作成
- 予算大幅増減（±50%以上）
- 案件追加・削除

## 11. コスト見積もり

| 項目 | 月額コスト |
|---|---|
| GitHub Actions | 無料（2,000分/月内）|
| Google Ads API | 無料 |
| GA4 API | 無料 |
| Clarity API | 無料 |
| Google Sheets API | 無料 |
| Anthropic Claude API | 約 $20-50（日次分析×30日）|
| OpenAI（補助） | 約 $0-20 |
| **合計** | **約 ¥3,000-10,000/月** |

広告費（月30-100万）に対して圧倒的に安価。ROI は確実に黒字。

## 12. 開発体制と工数見積もり

### 12.1 必要スキル
- Python 中級
- Google API 系の認証フロー理解
- 基本的な統計の理解
- Anthropic Claude API の利用経験（あれば良し）

### 12.2 工数見積もり
- Phase 1 MVP: **約30-50時間**
- Phase 2 拡張: 追加20時間
- Phase 3 自動化: 追加30時間

外部開発者に依頼する場合の想定: **30-60万円（Phase 1 MVP分）**

---

## 補足: なぜ n8n より GitHub Actions か

| 比較項目 | n8n | GitHub Actions |
|---|---|---|
| 月額コスト | 自己ホスト無料／クラウド$24〜 | 無料（2,000分/月）|
| 学習曲線 | GUI で楽 | Python知識が前提 |
| バージョン管理 | エクスポート可だが面倒 | Git ネイティブ |
| エラー時のデバッグ | GUI で楽 | ログ追跡 |
| 拡張性 | プラグイン頼み | 任意のPython パッケージ |
| 既存リポジトリとの統合 | 別運用 | 同一リポジトリで完結 |
| LP自動更新との連携 | Webhook 介す | コミットだけで連携 |
| 障害復旧 | サーバ再起動等 | リトライ機能あり |

**本プロジェクトは既存リポジトリにPython基盤・GitHub連携・Vercel自動デプロイがある**ため、
GitHub Actions に統一する方が運用負荷が低く、機能拡張も柔軟。

---

© 2026 通信比較ナビ All rights reserved.
