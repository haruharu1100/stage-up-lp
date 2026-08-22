# 検証（実測ベースへの移行）の計算式

このシステムは「158件見つけた」ことを成果として扱わない。
**実際に売ってみた件数が何件あるか**だけを成果として扱う。

ここに書いた式は `lib/economics/actuals.ts` / `lib/validation/*` の実装と一致している。
数式を変えるときは、必ずこのファイルも同時に変える。

---

## 1. 実績CSV（唯一の実測の入口）

`data/sales-actuals.csv`。列名で読むので、列の順番が変わっても壊れない。

```
date, idea_id, vertical, channel, campaign_id, leads, reachable_leads, calls, emails,
replies, positive_replies, demo_requests, meetings, contracts, revenue, direct_cost,
sales_time_minutes
```

- 空欄は **0ではなく「未記入」** として扱う（`null`）。0にすると「やって駄目だった」と区別できない。
- 個人情報（会社名・担当者名・電話番号・メールアドレス）はこのファイルに書かない。
- APIキーなどの秘密情報は `.env` だけ。CSV・JSON・ログ・Obsidianには書かない。

### 自動計算される指標

`reach = reachable_leads > 0 ? reachable_leads : leads`（届いた件数が未記入なら接触件数で代用）

| 指標 | 式 |
| --- | --- |
| Reply Rate | replies ÷ reach |
| Positive Reply Rate | positive_replies ÷ reach |
| Demo Rate | demo_requests ÷ leads |
| Meeting Rate | meetings ÷ leads |
| **Close Rate** | **contracts ÷ leads**（リード基準。3契約 / 80リード = 3.8%） |
| Revenue Per Lead | revenue ÷ leads |
| Total Cost | direct_cost +（sales_time_minutes ÷ 60）× 2,500円 |
| Cost Per Lead / Reply / Demo | Total Cost ÷ 各件数 |
| CAC | Total Cost ÷ contracts |
| ROAS | revenue ÷ Total Cost |
| Sales Time Per Contract | sales_time_minutes ÷ contracts |

分母が0の指標は **0ではなく `null`**。

段階ごとの率（モンテカルロ用）は別に持つ：`replies ÷ reach` → `demo_requests ÷ replies` → `contracts ÷ demo_requests`。
リード基準のClose Rateと混ぜない。

---

## 2. 仮定（ASSUMPTION）と実測（MEASURED）を混ぜない

すべての数字が `source_type` / `sample_size` / `confidence` を持つ。

- `source_type`: `ASSUMPTION`（仮定）/ `MEASURED`（実測）
- `sample_size`: その数字の母数（リード件数）
- `confidence`: `n ÷ (n + 100)`（上限 0.95）。0件なら 0。

画面では仮定と実測を**別の列**に出す。実測が無い欄は「実測なし」と書き、0で埋めない。

---

## 3. 少数データへの過学習を禁止する

実測3件で契約1件が出ても、それは33%ではない。以下の2段構えで反映する。

1. **幅を広げる**：件数が少ないほど信頼区間を広く取る

   | データ量 | 件数 | 幅の倍率 |
   | --- | --- | --- |
   | NO_DATA | 0 | ×2.0 |
   | LOW_DATA | 1〜29 | ×1.6 |
   | MEDIUM_DATA | 30〜99 | ×1.25 |
   | HIGH_DATA | 100〜 | ×1.0 |

2. **仮定側へ引き戻す（縮小推定）**：重み = n ÷ (n + 30)。
   30件で仮定と実測が半々。件数が増えるほど実測中心になる。

信頼区間そのものは正規近似：`p ± 1.96 × √(p(1−p)/n)`。

---

## 4. 次に何件テストすべきか

**段階方式（Sequential Testing）: 50 → 100 → 200 → 500**

- 今いる段 = leads 以上で最小の段。次の段 = その次。
- 段の途中で結論を出さない。段を増やす理由は「もっと売りたいから」ではなく
  「今の件数では判断できないから」に限る。
- 例：80件やった時点 → 今の段は100 → 次の目標は200件（**あと120件**）。

**統計的に必要な件数（参考値）**

```
n = 1.96² × (1 − p) ÷ (p × 相対誤差²)     相対誤差 = 0.5（±50%）
```

契約率が低いほど必要件数は跳ね上がる（1%を語るには約1,900件）。
この数字は併記するだけで、**いきなりそこまで件数を増やさない**。

---

## 5. 合否・撤退・拡大の条件（2026-08-22 に凍結）

先に決めて、**結果を見てから緩めない**。変えるときは日付と理由を `09_LEARNINGS/DECISIONS.md` に残す。

- テスト規模：1案件 50〜100件、最大3案件（合計150〜300件）

**合格（PASS）** — 100件やって、次の3つを**全部**満たす
- 前向きな返信 ≥ 8%
- 商談 ≥ 4%
- 契約 ≥ 1%

**不合格（FAIL）**
- 前向きな返信 < 2%
- または100件以上やって契約0件

**撤退（Kill）**
- 200件やって、前向きな返信 < 2% かつ デモ申込0件 → `REJECT`
- 100件やって前向きな返信が1件も無い → `STOP_EARLY`（途中終了）

**拡大（Scale）** — 次の3つを**全部**満たしたときだけ `SCALE_CANDIDATE`
- LTV ÷ CAC ≥ 3
- 12ヶ月で黒字になる確率 ≥ 70%
- 有料顧客 ≥ 2件

### 判定の順番（固定）

`NOT_TESTED` → 撤退 → 途中終了 → 拡大 → 合格 → 契約0件の扱い → `CONTINUE`

良い結果を先に見ると、悪い実績があっても合格が付いてしまう。必ず悪い側から見る。

---

## 6. note込みの実質CAC（CONTENT CAC）

X・noteで集客した場合、集客費の一部はnoteの売上で回収できる。

```
noteの手取り = note売上 × (1 − 手数料15%)
実質CAC     = (コンテンツ制作費 − noteの手取り) ÷ 契約数
```

例：制作費50,000円 / noteの手取り30,000円 / 契約2件 → (50,000 − 30,000) ÷ 2 = **10,000円**

**実質CACがマイナスでもエラーにしない。** `PROFITABLE_ACQUISITION`（集めながら先に利益が出ている）として表示する。
契約0件のときは0円ではなく「計算しない」（`null`）。

---

## 7. 検証パイプライン（画面の7段）

| 段 | 数え方 |
| --- | --- |
| DISCOVERED 発掘した | ideas の件数 |
| RESEARCHED 日本市場を調べた | japan_assessments で判定が付いたもの（UNKNOWN は数えない） |
| BACKTESTED 採算を試算した | sales_backtests の件数 |
| VALIDATION_READY 売ってみる候補 | 順位を付けられた案件（材料不足の除外分は数えない） |
| TESTING 実際に売ってみている | 実績CSVで leads > 0 の案件 |
| PAID_CUSTOMER お金を払った顧客がいる | 実績CSVで contracts > 0 の案件 |
| SCALE 拡大候補 | 判定が SCALE_CANDIDATE の案件 |

上4段は仮定、下3段が実測。**上の数字が増えても成果ではない。**

---

## 8. 作る順番

MANUAL MVP（手作業で納品） → SEMI AUTOMATED MVP（一部自動） → FULL SaaS

**先に作ってから売らない。** 有料顧客が1件も居ない状態でSaaSを作らない。
