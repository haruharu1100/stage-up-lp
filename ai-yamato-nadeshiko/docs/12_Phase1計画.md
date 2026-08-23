# 設計12: Phase 1 計画

Phase 0 = **PASSED**（2026-08-22）
状態: **着手可**

---

## 0. Phase 1 の考え方

**システムを大きくすることが目的ではない。**

```
Suzuho Awanoを固定する → Xで実測する → 承認された高単価案件を持つ → ERPM/RPMで比較する
```

**この4つで勝ちパターンが出てから、動画・自動化へ投資する。** 順番を入れ替えない。

### ★最優先KPI（2026-08-22 修正）

> ✕ 「Surfsharkを通す」
> ⭕ **「高単価Affiliate案件から承認される、媒体・プロフィール・申請方法の勝ちパターンを1つ作る」**

Surfsharkは**その最初の検証対象**。
**Surfsharkの承認可否だけで事業のGO/STOPを決めない。**
高単価候補を最低3カテゴリ（VPN / eSIM / Japan Travel）＋バックアップ3カテゴリ保持する。
→ `事業Vault/AI YAMATO NADESHIKO/02_AFFILIATE/申請学習.md`

**引き続き禁止**: 本番投稿 / 自動契約 / 有料契約 / 本番送客

---

## 0-2. Suzuho Awanoで最初に行うこと（この順番を守る）

| 順 | やること | 誰が |
|---|---|---|
| 1 | Suzuho Awano 正式名称確定 | **人間** |
| 2 | 実在人物・既存ブランドとの重複確認 | **人間** |
| 3 | Suzuho Awano Xアカウント作成 | **人間** |
| 4 | AI Virtual Creator であることを明記 | **人間**（文面はAIが用意済み） |
| 5 | Suzuho Awano 基準顔8枚生成 | AI（ローカル・課金ゼロ） |
| 6 | 人間が1枚承認 | **人間** |
| 7 | Brand Bible 固定 | AI |
| 8 | プロフィール完成 | **人間**（画像はAI） |
| 9 | **最低限の通常投稿を作成** | AI生成 → **人間承認** |
| 10 | Surfshark 申請 | **人間** |

> **9を飛ばして10へ行かない。**
> **ASP審査用に作った不自然なアカウントに見えないようにする。**
> **Affiliateリンクだけを投稿するアカウントにしない。**
> 申請前チェック13項目（`02_AFFILIATE/申請学習.md`）を全部満たしてから申請する。

---

## 0-3. 自動化は段階的に上げる（今は最初の形のみ）

**いま（Phase 1）**
```
AI生成 → Compliance Check → ★人間承認★ → 投稿 → 日次取得 → 分析 → 次回生成
```

**収益と安全性が確認できてから**
```
AI生成 → Compliance Check → 自動投稿
```

**この変更は人間が明示的に判断する。** 収益・安全性の確認前に上げない。

---

## 1. 8本の作業と、その依存関係

DEPENDENCY の番号は `事業Vault/00_SYSTEM/Phase0_合格判定.md` に対応。

| # | 作業 | 依存 | いま着手できるか |
|---|---|---|---|
| 1 | **Suzuho Awano Brand Bible** | なし（名称欄だけ空ける） | **⭕ 今すぐ** |
| 2 | **Reference Face 候補8枚** | 生成=なし / 選定=**人間** | **⭕ 生成は今すぐ**（ローカル・課金ゼロ） |
| 3 | **Offer DB** | なし | **⭕ 今すぐ** |
| 4 | **Offer Score / Survival Score** | 3 | **⭕ 3の直後** |
| 5 | **Analytics Snapshot** | 構造=なし / 実データ=**X Developer App** | **⭕ 構造は今すぐ** |
| 6 | **Compliance Engine** | なし | **⭕ 今すぐ** |
| 7 | **30日 Experiment Engine** | 構造=なし / 実行=**X Account** | **⭕ 構造は今すぐ** |
| 8 | **Obsidian 永続化** | なし | **⭕ 今すぐ** |

**8本中8本が、何らかの形で今すぐ着手できる。** 人間待ちで止まるのは「実行」の部分だけ。

### 実装の進み具合（2026-08-22 時点）

| # | 作業 | 実装 | 動かすコマンド | 残っているのは |
|---|---|---|---|---|
| 1 | Suzuho Awano Brand Bible | ✅ `lib/character.ts` | — | **正式名称の決定（人間）** |
| 2 | Reference Face 候補8枚 | ✅ `scripts/generate-faces.ts` | `npm run faces:prompts` | **8枚生成と1枚選定（人間・ローカル）** |
| 3 | Offer DB | ✅ `lib/offers.ts` | `npm run offers:import` | 43社中35社が一次情報の確認待ち |
| 4 | Offer / Survival Score | ✅ | `npm run offers:rank` | ERPMの実測値（Xの計測開始後） |
| 5 | Analytics Snapshot | ✅ `lib/metrics.ts` `lib/x.ts` | `npm run metrics:daily` | **X のアクセストークン** |
| 6 | Compliance Engine | ✅ `lib/compliance.ts` | `npm run check:compliance` | 法令9件の一次情報URL |
| 7 | 30日 Experiment Engine | ✅ `lib/planner.ts` | `npm run plan:slots` / `plan:week` | **X アカウント** |
| 8 | Obsidian 永続化 | ✅ `lib/obsidian.ts` | 各コマンドから自動 | — |

**加えて**: 申請学習（`lib/applications.ts` / `npm run apply:check` / `apply:record`）を実装済み。
13項目チェック・1社ずつの申請順・4分類の結果記録・「何を変えたら承認率が上がったか」の分析まで動く。
12属性の学習（`lib/attributes.ts` / `npm run learn:attributes`）も実装済みで、
最低本数に届くまでは全項目 `CONTINUE` を返し、勝ち負けを書かない。

受入テストは `npm test`（`scripts/test-*.ts` を全部走らせる。現在4本）。

### 本文の素材についての決めごと（`lib/content-bank.ts`）

つかみと長さを変えるために本文の行を入れ替えるので、**行は単体で読めなければならない。**

- `meaning` は「それ1行で主語が分かる」文にする。`It is called ...` のように前の行を受けてはいけない
- `feeling` `question` と自己開示の行は主語を持たないので、**主語を出す行（`scene` か `meaning`）を必ず1本残す**
- 案件投稿の `facts` は `First / Second / Third` と順番に意味があるため**並べ替えない**。
  つかみの差は先頭に1行足して作る（`AFFILIATE_OPENERS`）

これは `npm test` の `scripts/test-planner.ts` が本文を読んで機械で確かめる。

---

## 2. 各作業の中身

### 1. Suzuho Awano Brand Bible

**やること**: `事業Vault/01_CHARACTER/SUZUHO_AWANO_PROFILE.md` を、生成エンジンが直接読める形にコード側へ落とす。

- `lib/character.ts` — 外見・服装・撮影スタイル・禁止事項を定数化
- `character_suzuhoawano.json` — ComfyUI へ渡すプロンプト定義（`ai-influencer/` の形式を流用）
- **正式名称は `[NAME]` のままにする。** 決まったら1か所差し替えで全体に反映される構造にする
- ブランドカラー4色（`#26456E` / `#F5F0E6` / `#C1552E` / `#2B2B2B`）以外を使えなくする

**完了条件**: Bibleを1行変えると、生成される画像の条件が変わることを確認できる。

---

### 2. Reference Face 候補8枚

**やること**: ローカルの ComfyUI（`ai-influencer/`）で8枚生成し、QAを通し、人間へ提示する。

- RealVisXL V5.0 / 832×1216 / steps 30 / CFG 5.0 / dpmpp_2m karras
- **QAを通らないものは人間に見せる前に機械で落とす**: 指の本数・未成年に見えないか・露出・崩れた文字
- **追加費用ゼロ**（ローカル生成）

**完了条件**: QAを通った候補が人間の前に並ぶ。**選ぶのは人間**（`AUTO_CONTENT_PUBLISH=false`）。
選定後に `01_CHARACTER/FACE_REFERENCE.md` へ確定を記録する。

> **承認前に量産しない。** 基準顔が決まる前の量産は全部捨てる作業になる。

---

### 3. Offer DB

**やること**: `02_AFFILIATE/OFFERS.md`（43社）を DB へ取り込む。

- `networks` / `offers` テーブル（`docs/05_アーキテクチャとDB設計.md`）
- **`UNKNOWN` を `UNKNOWN` のまま保持する。** NULLや `false` に潰さない
- **`verified_at`（= `checked_at`）が無い行は使用不可**として扱う
- `approval_status` は全件 `NOT_APPLIED` から始まる

**完了条件**: 「日本在住で・SNSトラフィック可で・条件が一次情報で確認済み」の案件を機械で抽出できる。

---

### 4. Offer Score / Survival Score

**やること**: 案件を2軸で採点する。

| スコア | 何を測るか | 主な要素 |
|---|---|---|
| **Offer Score** | **儲かるか** | 平均報酬・想定CVR・Cookie期間・最低支払額・入金経路の確実性 |
| **Survival Score** | **続くか** | 条件の一次情報確認度・SNS可否の明示度・AI可否の回答有無・プログラム継続性・W-8BEN等の事務障壁 |

**Offer Score だけで選ばない。** 高報酬でも `Survival Score` が低ければ、
**承認後に条件変更・報酬没収・プログラム終了で消える**。43社調査でその例（ZenPop 404・Japan Crate 消滅可能性）が実際に出ている。

- 採点結果は `offer_scores` に**凍結して積む**（上書き禁止）
- **成約20件未満の案件について「この案件はダメ」と書けない**（最低サンプル）

**完了条件**: 申請順（現行: Surfshark → Sakura Mobile → ICHIGO → Viator → Airalo → JapanesePod101）を
機械が再現でき、順位が変わったときに**理由を説明できる**。

---

### 5. Analytics Snapshot

**やること**: `docs/11_計測設計.md` を実装する。

- `post_metrics` を**スナップショット方式**で積む（上書き禁止）
- **`fetched_ok=0` を集計から外す**（未取得と0を区別）
- **投稿後30日以内の全投稿を毎日1回読む**日次バッチ
- **投稿27日目以降に未取得があれば人間へ通知**（残り3日の猶予）

**X Developer App が無い間**: モックデータでバッチを流し、**通知が正しく飛ぶことまで確認する。**

**完了条件**: 「30日目の取り逃し」が起きたときに、**必ず人間に届く**ことを実データ無しで検証できている。

---

### 6. Compliance Engine

**やること**: 承認画面に出す前の機械チェック。

新規4チェック:

| コード | 落とす条件 |
|---|---|
| `FAKE_EXPERIENCE` | `I used` `I tried` `I bought` `I love using` `This worked for me` `When I traveled` `My experience was` 等、Suzuho Awano自身の現実の使用・購入・旅行経験の主張 |
| `UNSUBSTANTIATED_CLAIM` | 事実主張に `claims` 行が無い、または `source_url` / `checked_at` が空 |
| `AFFILIATE_DISCLOSURE_MISSING` | アフィリリンクを含むのに開示が無い／リンクより後ろ |
| `OUTDATED_SOURCE` | 参照元の `expires_at` 超過（価格30日 / 規約・法令90日） |

既存10チェック（成人向け・年齢感・AI開示・短縮URL・類似連投・自動化・景表法・実在人物・ASP規約・EXP群一致）と合わせて**14項目**。

- **法令の判定は `laws` テーブルを必ず経由する。** 条文・日付をコードに直接書かない
- `laws.checked_at` が90日超なら**判定を止めて人間へ通知**（推測で進めない）
- `compliance_checks` は上書き禁止

**完了条件**: 意図的に違反した文面を14種類入れて、**全部 FAIL で止まる**ことを確認できる。

---

### 7. 30日 Experiment Engine

**やること**: `03_X/30日検証設計.md` と `06_EXPERIMENTS/EXP-001_リンク配置.md` を回す仕組み。

> ### ★2026-08-22 変更：90投稿を先に全部完成させない（ローリング方式）
>
> **理由**: 最初の7〜14日で「浴衣より着物」「京都より日常」「写真より質問投稿」のような差が出る可能性がある。
> 90本を先に確定させると、**その実測を反映する先が無くなる**。学習ループを持っているのに使えない構造になる。
>
> | 先に固定してよいもの（＝比較の枠組み） | 7日ずつしか確定させないもの（＝中身） |
> |---|---|
> | 90枠の日付・時刻・曜日 | 投稿本文 |
> | EXP-001 の A/B 割当（**15対15**） | 画像・トピック・服装・背景 |
> | 10カテゴリの配分 | フック・CTA |
>
> ```
> Day 1-7  → 21投稿を生成 → 投稿 → 分析
> Day 8-14 → 分析結果を反映して次の21投稿を生成 → 投稿 → 分析
> 以後ローリング（常に最新実績から作る）
> ```
>
> **A/B配分（15対15）だけは途中で変えない。** ここを動かすと比較が壊れる。

- **90「枠」**（日付・時刻・A/B・カテゴリ配分）を先に生成する
- **本文の生成は21投稿ずつ**（`npm run plan:week -- --week 1`）
- **EXP-001 の A/B を投稿日ごとに交互**に割り当て、**15対15を維持**する
- **`min_sample_size` 未満は `CONTINUE` 以外を書けない**制約をDBレベルで持つ
- 類似度0.9以上の重複を弾く（`aura/lib/guard.ts` を流用）
- 投稿ごとの**API実費を1行ずつ記録**（月末按分にしない）

**完了条件**: 90枠が出力され**配分・曜日・時刻がA/Bで揃っている**こと、
かつ **7日分だけ本文が確定し、8日目以降が未確定のまま待てる**ことを機械で検証できる。

---

### 9. 投稿属性の学習（何が効いたかを残す）

**やること**: 投稿1件を12属性に分解して保存し、伸びた「原因の候補」を出せるようにする。

`CHARACTER` / `HOOK` / `TOPIC` / `OUTFIT` / `BACKGROUND` / `ENGLISH_STYLE` /
`POST_LENGTH` / `CTA` / `TIME` / `GEO` / `AFFILIATE` / `RPM`

- **「この投稿が伸びた」で終わらせない。「何が伸びる原因だった可能性が高いか」を記録する**
- 属性ごとの最低サンプル未満では**寄与を断定しない**（`CONTINUE`）
- **1回に複数属性を同時に変えない**（何が効いたか分からなくなる）

**完了条件**: 21投稿分の実績を入れると、属性別のRPM差と**サンプル数の警告**が同時に出る。

---

### 10. 申請学習（Affiliate Approval Learning）

**やること**: 申請を実験として扱い、17項目を保存して「何を変えたら承認率が上がったか」を出す。

- `affiliate_applications` テーブル（17項目・上書き禁止）
- 結果は `PASS` / `REJECT` / `MORE_INFORMATION_REQUIRED` / `NO_RESPONSE` の4分類
- **1社ずつ申請。同日に複数ASPへ一括申請しない**
- 拒否理由をVaultへ保存 → プロフィール・媒体・申請文を修正 → 2社目へ
- **申請前チェック13項目**を全部満たすまで申請不可（機械で検査する）

**完了条件**: 13項目チェックが1つでも欠けると `NOT_READY` を返して申請文を出力しない。

→ 詳細: `事業Vault/AI YAMATO NADESHIKO/02_AFFILIATE/申請学習.md`

---

### 8. Obsidian 永続化

**やること**: `事業Vault/AI YAMATO NADESHIKO/` を唯一の正として読み書きする。

- **AIが自動で書き換えてよいのは数値の追記だけ。** ルール文・判断文の変更は人間の承認を要する
- `FACT` / `HYPOTHESIS` / `ASSUMPTION` / `EXPERIMENT` / `DECISION` の分類と `checked_at` を必ず付ける
- **法令は `00_SYSTEM/法令台帳.md` へ**（`LAW_VERSION` / `SOURCE_URL` / `CHECKED_AT` / `EFFECTIVE_DATE` / `TRANSITION_DATE`）
- 失敗・外れた仮説を `07_KNOWLEDGE/LEARNINGS.md` へ。**消さない**

**完了条件**: AIが書いた行と人間が書いた行が区別でき、**古い法令情報が自動で期限切れになる**。

---

## 3. Phase 1 合格条件（この5つが揃ったら PASS）

| # | 条件 | 満たしたと言える状態 |
|---|---|---|
| 1 | **Suzuho Awano の Identity 固定** | 名前・基準顔1枚・Brand Bible・プロフィール文が確定し、1か所変えると全体に反映される |
| 2 | **X運用開始可能** | アカウント＋Developer App があり、承認済みの下書きを投稿できる状態 |
| 3 | **データの日次保存が動作** | 30日以内の全投稿を毎日読み、27日目の取り逃しが人間へ通知される |
| 4 | **Surfsharkへの適切な申請準備完了** | 13項目チェックが全てPASSし、申請文と17項目の保存先が用意されている |
| 5 | **7日単位で投稿内容を改善できる学習ループ完成** | 21投稿の実績→属性別分析→次の21投稿の生成、が1周する |

**前提として守り続けること**: 本番投稿・本番送客・有料契約・自動契約を一度も行っていない。

---

## 4. Phase 1 完了報告の形式

報告は次の4項目**だけ**にする。長い経過説明を書かない。

| 見出し | 中身 |
|---|---|
| **完成** | 動く状態になったもの |
| **人間作業** | 人がやらないと進まないもの |
| **外部待ち** | ASP・相手側の返答待ちのもの |
| **次にやる1つ** | **1つだけ**書く |
