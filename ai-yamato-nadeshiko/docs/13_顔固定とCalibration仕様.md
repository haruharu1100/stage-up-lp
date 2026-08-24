# 設計13: 顔固定と Calibration 仕様

状態: **実行不可（待機中）**
実行条件: `X_HANDLE = CLEAR` になり、`npm run gate` が基準顔の生成を許可した後。

決定日: 2026-08-24（人間が決定）
この文書は**顔フェーズの拘束仕様**。ここに書かれた条件を満たさずに顔を本番運用へ回さない。

---

## 0. 最重要目標（これを見失わない）

> **目的は「数字が高い画像を作ること」ではない。**
> **第三者が連続した投稿を見たときに、毎回同じ Suzuho Awano だと自然に認識できること。**

機械判定はそのための**安全装置**であって、目的そのものではない。
**最終的な公開前確認には必ず人間を残す。**

---

## 1. 現在の閾値は「暫定値」である

`lib/character.ts` の `FACE_QA` にある次の数値は、**まだ正解として扱わない**。

```
類似度 0.80 / 髪 0.85 / 輪郭 0.85 / 目 0.85 / 鼻 0.85 / 口 0.85 / 肌 0.80 / 見た目年齢 25±4
```

### なぜ暫定なのか

**使用する測定方法によって 0.80 や 0.85 の意味がまったく変わるから。**
顔embeddingの種類が違えば、同一人物でも 0.5〜0.7 に収まることもあれば 0.9 を超えることもある。
測定方法を決めずに数字だけ先に決めると、**厳しすぎて全部落ちる**か
**緩すぎて別人が通る**かのどちらかになる。

### 原則

> **数値を先に正解と決めない。実データから閾値を決定する Calibration フェーズを必ず通す。**

---

## 2. 手順

### 2-1. 顔候補8枚を生成する

- この段階では**8枚すべてが候補**。
- **Character Identity をここで確定しない。**
- 人間が8枚を確認し、**基準顔1枚を選ぶ**。
- **機械による自動選択は禁止。**

### 2-2. 基準顔を選んでも、すぐ本番生成しない

先に **FACE CALIBRATION DATASET** を作る。

---

## 3. FACE CALIBRATION DATASET（最低3グループ）

### GROUP A — 同一人物として生成した画像（最低20〜30枚）

条件を必ず散らす。1条件だけで測ると、その条件でしか通用しない閾値になる。

- 正面 / 斜め
- 笑顔 / 無表情
- 屋外 / 室内
- 明るい場所 / 暗め
- 上半身 / 全身

### GROUP B — 明確な別人物（最低20〜30枚）

- 日本人女性・近い年齢など、**ある程度属性が似ている別人も含める**。
- **簡単すぎる別人だけにしない**（人種も年齢も違う人だけを並べても意味がない）。

### GROUP C — 難しい別人物（`HARD_NEGATIVE`）★非常に重要

見間違いやすい人物を意図的に用意する。

- 同じ髪色
- 同じ髪型
- 同年代
- 似た輪郭
- 似たメイク

**通常の別人だけで精度99%でも意味がない。** 崩れるのは必ず「似ている人」の側。

---

## 4. 実測して保存する項目

各画像について次を保存する。

```
identity_similarity
hair_similarity
face_shape_similarity
eye_similarity
nose_similarity
mouth_similarity
skin_tone_similarity
apparent_age
```

さらに正解ラベルを持たせる。

```
ground_truth = SAME_PERSON | DIFFERENT_PERSON | HARD_NEGATIVE
```

### 測定不能の扱い

**0にしない。**

```
NOT_MEASURABLE
```

として保存し、**本番判定では PASS 禁止**。
「測れなかった」を「問題なし」に丸めると、QAを通した意味が消える。

---

## 5. 閾値をデータから決める

各項目について、`SAME_PERSON` と `DIFFERENT_PERSON` / `HARD_NEGATIVE` の**分布を比較**する。

例（あくまで例。実測で置き換える）:

```
SAME           0.61〜0.89
DIFFERENT      0.22〜0.58
HARD_NEGATIVE  0.41〜0.67
```

この場合、0.80 固定ではなく**誤判定が最も少なくなる位置**を調べて決める。

---

## 6. Accuracy だけで決めない

次をすべて計測する。

```
True Positive / False Positive / True Negative / False Negative
Precision / Recall / F1
False Accept Rate (FAR)
False Reject Rate (FRR)
```

### 特に重視するのは False Accept Rate

> **別人を同一人物として通してしまう方を強く警戒する。**
> 多少「同一人物を落とす」ことより、**別人物を Suzuho として公開する事故**の方が重大。

### HARD NEGATIVE は別表示する

```
HARD_NEGATIVE_FALSE_ACCEPT_RATE
```

を**単独で**表示する。全体のFARに混ぜて薄めない。

---

## 7. 判定は PASS / REVIEW / FAIL の3段階

**2段階にしない。**

| 判定 | 意味 |
|---|---|
| `PASS` | 十分余裕を持って一致 |
| `REVIEW` | ぎりぎり。人間確認へ回す |
| `FAIL` | 明確に基準未達 |

各項目が2つの閾値を持つ。

```
PASS_THRESHOLD
REVIEW_THRESHOLD
```

構造の例（**具体的な数値は Calibration 後に決める**）:

```
PASS   >= 0.82
REVIEW 0.75 〜 0.819
FAIL   <  0.75
```

---

## 8. 「ぎりぎりが複数」への対応

次のいずれかに当たったら**総合PASSを禁止**し、`HUMAN_REVIEW_REQUIRED` にする。

1. `REVIEW` 項目が **2つ以上**
2. **重要項目**（`identity` / `eyes` / `nose` / `mouth` / `face_shape`）のどれかが `REVIEW`

「2つ以上」という個数も**固定値にせず、Calibration 結果を見て調整できる**ようにする。

---

## 9. 重みを全部同じにしない

顔の同一人物判定において、**髪型と目鼻口の重要性は同じではない。**
髪型の変更はあり得る。しかし目・鼻・口・輪郭が全部変わったら別人。

### CORE IDENTITY（厳格）

- 顔embedding
- 目
- 鼻
- 口
- 輪郭

### PRESENTATION（相対的に緩い）

- 髪
- 肌
- 見た目年齢

> **CORE項目で重大な不一致があれば、髪や肌が合っていても PASS 禁止。**

---

## 10. 髪型は初期だけ固定する

最初の21投稿程度は髪型も厳しく固定してよい。
ただし将来に備えて `HAIR_MODE` を追加できる設計にする。

```
HAIR_MODE = LOCKED | CONTROLLED_VARIATION | FREE
初期値: LOCKED
```

---

## 11. 見た目年齢も Calibration する

`25 ± 4歳` も固定の正解ではない。
**評価器そのものがブレる。** 同一人物の生成30枚程度で、評価器が例えば 22〜30 に散るなら、
**その測定誤差を把握したうえで**許容幅を決める。

---

## 12. 単一評価器に依存しない

可能であれば、顔embedding単独ではなく別系統を組み合わせる。

```
FACE_EMBEDDING + LANDMARK_GEOMETRY + ATTRIBUTE_COMPARE
```

**ただし新しい依存関係を大量に増やさない。ローカル・無料を優先する。**

---

## 13. 自動判定結果の出し方（例）

```
Suzuho Identity Check

Identity      PASS
Eyes          PASS
Nose          PASS
Mouth         REVIEW
Face Shape    PASS
Hair          PASS
Skin          PASS
Age           PASS

Final:
HUMAN_REVIEW_REQUIRED

Reason:
Mouth similarity is near threshold.
```

---

## 14. 顔候補8枚の目的を混同しない

8枚は**「8人の別候補」ではなく、最終的に1人を選ぶための候補**。

> **基準顔決定後、残り7枚を自動的に `SAME_PERSON` の教師データとして扱わない。**
> 実際に別人物として生成されている可能性があるため。

**人間が確認済みの画像だけ**を `GROUND_TRUTH_SAME` に登録する。

---

## 15. Character ID

基準顔を決定した時点で固有IDを発行し、**以後すべての画像に付与**する。

```
CHARACTER_ID = SUZUHO_AWANO_V1
```

### 顔を変更する場合

**同じ Character ID を上書きしない。**

```
SUZUHO_AWANO_V2
```

にする。**V1の投稿・評価・テスト結果は残す**（消すと、なぜ変えたかの答え合わせができなくなる）。

---

## 16. 公開前 Gate（全部必要）

```
NAME_CONFIRMED
X_HANDLE_CONFIRMED
BASE_FACE_CONFIRMED
FACE_MEASUREMENT_AVAILABLE
IDENTITY_CHECK_PASS
HUMAN_REVIEW_COMPLETE
```

### 画像と文章は別Gate

**画像PASSと文章PASSを混ぜない。**
画像が PASS でも、投稿文章に問題があれば公開不可。

---

## 17. Calibration を回帰テスト化する

最低限、次を固定テストにする。

| テスト | 入力 | 期待 |
|---|---|---|
| TEST A | 同一人物の正面 | `PASS` |
| TEST B | 同一人物の斜め | `PASS` または `REVIEW` |
| TEST C | 同一人物の笑顔 | `PASS` または `REVIEW` |
| TEST D | 明確な別人 | `FAIL` |
| TEST E | 似ている別人 | `FAIL` |
| TEST F | 測定不能 | `FAIL` |
| TEST G | 複数項目ぎりぎり | `REVIEW` |

---

## 18. 閾値を変更するときのルール

**「なんとなく 0.80 → 0.75」は禁止。**

変更する場合は必ず次をObsidianへ保存する。

```
Before / After / 理由
Calibration dataset
FAR / FRR / F1 / Hard Negative FAR
```

---

## 19. Obsidianへ保存する内容

```
基準顔決定日
Character ID
使用測定方式
Calibration dataset件数
各項目の閾値
PASS/REVIEW/FAIL条件
FAR
FRR
Hard Negative FAR
既知の弱点
人間確認ルール
```

**「既知の弱点」を空にしない。** 弱点が無いのではなく、見つけていないだけの状態を隠さない。

---

## 20. 完了報告（顔フェーズ実施後）

X ID確認後に顔フェーズを実施したら、次の17項目を報告する。

1. X Handle
2. 顔候補8枚生成結果
3. 人間が選んだ基準顔
4. Character ID
5. 使用した測定方式
6. Calibration dataset件数
7. SAME分布
8. DIFFERENT分布
9. HARD NEGATIVE分布
10. 各閾値
11. FAR
12. FRR
13. Hard Negative FAR
14. REVIEW条件
15. 回帰テスト結果
16. Obsidian保存
17. Git hash

> **その時点ではまだ第1週21投稿を作成しない。**
> 顔固定の監査を受け、**承認後に**21投稿へ進む。

---

## 21. この仕様と既存コードの関係

| 既存 | 位置づけ |
|---|---|
| `lib/character.ts` の `FACE_QA` | **暫定値。** Calibration 後に置き換える。現状は2段階（PASS/FAIL）なので3段階へ拡張が必要 |
| `lib/face-scoring.ts` | **別物。** 8枚から1枚を人間が選ぶための採点表であり、同一人物判定ではない |
| `lib/phases.ts` の `BUILD_FACE_MATCHER` | この仕様の実装がここに入る。回帰テストが通るまで `faceMatcherReady` を true にしない |

---

## 22. 未解決（実装前に決めること）

- **測定方式の選定**（ローカル・無料・依存を増やしすぎない範囲で）
- **HARD_NEGATIVE 画像の入手方法**
  実在人物の写真を使うのは避ける。生成した別キャラで作るのが現実的
- **GROUP B / C を何枚まで増やすと FAR が安定するか**（少数だと偶然で決まる）
