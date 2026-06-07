# 通信比較ナビ AI自動広告改善システム

> 毎日 GitHub Actions が広告データを取得 → Claude AI が分析 → メールで改善案を通知

## 📚 ドキュメント

- **[SETUP.md](./SETUP.md)** — 初期設定ガイド（初心者向け）
- **[SPECIFICATION.md](./SPECIFICATION.md)** — 開発者向け詳細仕様

## 🚀 クイックスタート

```bash
# 1. 依存パッケージ
cd automation
pip3 install -r requirements.txt

# 2. 環境変数（.env）
cp .env.example .env
# .env を編集

# 3. 設定検証
python3 scripts/verify_setup.py

# 4. 手動実行
python3 scripts/main.py
```

## 🗂 ディレクトリ構成

```
automation/
├── README.md              # このファイル
├── SETUP.md               # 初期設定手順
├── SPECIFICATION.md       # 詳細仕様
├── requirements.txt
├── .env.example
├── scripts/
│   ├── main.py            # メインエントリ
│   ├── verify_setup.py    # 設定検証
│   └── notify.py          # メール通知
├── lib/
│   ├── google_ads_client.py
│   ├── ga4_client.py
│   ├── clarity_client.py
│   ├── sheets_client.py
│   └── claude_client.py
├── config/
│   ├── thresholds.yml     # 判定閾値
│   └── prompts/
│       └── summary.md     # Claude プロンプト
└── reports/               # 日次レポート出力先

../.github/workflows/
└── daily_report.yml       # 毎日 JST 7:00 実行
```

## 🔄 動作フロー

```
[毎日 JST 7:00 GitHub Actions]
    ↓
[ETL: Google Ads / GA4 / Clarity からデータ取得]
    ↓
[Google Sheets に保存]
    ↓
[Claude API で分析・改善案生成]
    ↓
[メールで日次レポート送付]
    ↓
[人間が確認 → Google広告画面で改善反映]
```

## 💰 月額コスト目安

| 項目 | 月額 |
|---|---|
| GitHub Actions | 無料（2,000分/月内）|
| Google APIs | 無料 |
| Claude API | ¥3,000-7,500 |
| **合計** | **¥3,000-7,500** |

広告費 30-100万 に対して 1% 未満。完全黒字。

## 🛡 モックモード

APIキー未設定でも `DRY_RUN=true` でモックデータで動作確認できます。

```bash
DRY_RUN=true python3 scripts/main.py
```

## 🤖 拡張ポイント

Phase 1 (現在): 分析・改善案の生成
Phase 2 (将来): 高信頼度の提案を自動実行（例: 100クリックでCV0のKWを自動停止）
Phase 3 (将来): A/B テストの自動セットアップ

詳細は SPECIFICATION.md 参照。

---

© 2026 通信比較ナビ
