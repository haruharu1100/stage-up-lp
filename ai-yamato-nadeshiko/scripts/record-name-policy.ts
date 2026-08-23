/**
 * 今回の「名前の扱い方」の判断を、恒久ルールとして事業Vaultへ残す。
 *
 * ★なぜ残すか
 *   これは実装の都合ではなく、方針の判断。
 *   残しておかないと、次に触る人（または次のAI）が
 *   「フルネームを強制した方が安全では」と考えて元に戻してしまう。
 *
 * 実行: npx tsx scripts/record-name-policy.ts
 * 追記のみ。既存の記述は書き換えない（lib/obsidian.ts が検査して止める）。
 */
import { appendLearning } from "../lib/obsidian.js";
import {
  CHARACTER_IDENTITY,
  NAME_POLICY,
  NAME_SURFACES,
  SURFACE_LABEL,
  type NameSurface,
} from "../lib/identity.js";
import { FACE_QA } from "../lib/character.js";

const strict = NAME_SURFACES.filter((s) => NAME_POLICY[s] === "BRAND_IDENTITY_STRICT");
const natural = NAME_SURFACES.filter((s) => NAME_POLICY[s] === "CONTENT_NATURAL");
const label = (s: NameSurface) => SURFACE_LABEL[s];

const files: string[] = [];

// --- 1. 名前の書き方を「場所で決める」という判断 ----------------------------
files.push(
  appendLearning({
    kind: "DECISION",
    title: "キャラクター名は使用場所で判定を変える（全面フルネーム強制はしない）",
    body: [
      "## 判断",
      "",
      "検索固有性のためフルネームをブランドIdentityとして固定する。",
      "ただし通常会話まで機械的にフルネームを強制するとコンテンツが不自然になるため、",
      "「どこに書かれるか」で判定を変える。",
      "",
      "## 理由",
      "",
      "- 下の名前だけでは固有名にならない。同名の人物・ブランドに埋もれ、検索で本人へ辿り着けない。",
      "- 一方で本文まで強制すると `Hi, I'm <フルネーム>.` のような英文しか書けず、Xでの反応が落ちる。",
      "- 固有性が必要なのは「外から検索・照合される面」であって、本人が喋っている本文ではない。",
      "",
      "## 具体的な線引き",
      "",
      `### 必ずフルネーム（BRAND_IDENTITY_STRICT）${strict.length}箇所`,
      "",
      ...strict.map((s) => `- ${label(s)}`),
      "",
      `### 下の名前だけでもよい（CONTENT_NATURAL）${natural.length}箇所`,
      "",
      ...natural.map((s) => `- ${label(s)}`),
      "",
      "## 判定の段階（3段階にした）",
      "",
      "1. ブランドの面で下の名前だけ → FAIL（承認画面に出さない）",
      "2. 通常の本文で、初出の自己紹介なのにフルネームが1度も無い → WARN（止めないが記録する）",
      "3. 通常の本文でのそれ以外の使用 → PASS",
      "",
      "WARN を新設したのは、規約違反と「もっと良く書ける」を混ぜないため。",
      "WARN は承認を止めない。",
      "",
      "## 別に設けたチェック",
      "",
      "- NAME_COLLISION: 正式Identity以外の姓・別名に化けたら場所を問わず即BLOCK。",
      "  短縮形の話（NAME_SHORT_FORM）とは別の問題なので分けた。",
      "- IDENTITY_LOCK: 名前が PROVISIONAL のままの本番公開を止める。",
      "  下書き作成は止めない（WARN のみ）。",
      "",
      "## 実装場所",
      "",
      "- `ai-yamato-nadeshiko/lib/identity.ts`（Character Identity Object と使用場所の表）",
      "- `ai-yamato-nadeshiko/lib/compliance.ts`（3つのチェック）",
      "- `ai-yamato-nadeshiko/scripts/test-identity.ts` / `test-compliance.ts`（検査）",
    ].join("\n"),
  }),
);

// --- 2. 名前を文字列ではなくオブジェクトで持つ判断 --------------------------
files.push(
  appendLearning({
    kind: "DECISION",
    title: "キャラクター名は文字列で持ち回さず Character Identity Object にする",
    body: [
      "## 判断",
      "",
      "名前を1本の文字列として渡さない。正式名・下の名前・姓・状態を別のフィールドに分けて渡す。",
      "",
      "## 理由",
      "",
      "文字列で渡すと、受け取った側が勝手に分割したり、",
      "生成AIが姓を別の語に書き換えても誰も気付けない。",
      "フィールドが分かれていれば「姓が変わった」を機械で検出できる。",
      "",
      "## 状態は2つに分ける",
      "",
      `- identity_status（名前）: PROVISIONAL / LOCKED / REJECTED　… 現在 ${CHARACTER_IDENTITY.identity_status}`,
      `- reference_face_status（基準顔）: NOT_GENERATED / PENDING_HUMAN_SELECTION / LOCKED　… 現在 ${CHARACTER_IDENTITY.reference_face_status}`,
      "",
      "名前が確定しても顔まで自動で確定しない。",
      "`identity_status=LOCKED` かつ `reference_face_status=PENDING_HUMAN_SELECTION` は正常な状態として扱う。",
      "",
      "## 確定は人が行う",
      "",
      "商標調査台帳（`data/identity-screening.csv`）が揃っているかは `npm run identity:check` が判定するが、",
      "`identity_status` を書き換えるのは人。機械が自分で「確定」にできると、",
      "調べ終わっていないのに前へ進んでしまう。",
      "",
      "機械検索で確認できなかった項目は UNKNOWN のまま保存する。「問題なし」として扱わない。",
      "確認日か出典が空の CLEAR も UNKNOWN へ戻す。",
    ].join("\n"),
  }),
);

// --- 3. 顔の再現性を機械QAの対象にする判断 ----------------------------------
files.push(
  appendLearning({
    kind: "DECISION",
    title: "基準顔の確定後は、顔の再現性を機械QAで落とす（未計測は不合格）",
    body: [
      "## 判断",
      "",
      "基準顔が LOCKED になった後、生成画像は次の数値をすべて実測して渡す。",
      "1つでも欠けていれば不合格にする。",
      "",
      `- 基準顔との類似度   ${FACE_QA.minSimilarity} 以上`,
      `- 髪の一致          ${FACE_QA.minHairMatch} 以上`,
      `- 顔の形の一致      ${FACE_QA.minFaceShapeMatch} 以上`,
      `- 目の一致          ${FACE_QA.minEyesMatch} 以上`,
      `- 鼻の一致          ${FACE_QA.minNoseMatch} 以上`,
      `- 口の一致          ${FACE_QA.minMouthMatch} 以上`,
      `- 肌の色みの一致    ${FACE_QA.minSkinToneMatch} 以上`,
      `- 見た目年齢        ${FACE_QA.baseAge}歳 ± ${FACE_QA.ageTolerance}歳`,
      "",
      "## 理由",
      "",
      "同一人物率が低いと、X上では「毎日違うAI女性を投稿するアカウント」に見える。",
      "その状態ではフォローされず、アフィリエイト以前に人格が成立しない。",
      "名前の固有性より、こちらの方が影響が大きい。",
      "",
      "## 未計測を0にしない",
      "",
      "測れなかった項目は「合格」にしない。null は不合格として扱う。",
      "「測れなかった」を「問題なし」に丸めると、QAを通した意味が無くなる。",
      "",
      "## 順番",
      "",
      "名前が LOCKED になるまで基準顔の候補を生成しない。",
      "基準顔は一度選ぶと全投稿がそれに縛られるため、名前の作り直しが起きると全部捨てることになる。",
      "8枚の候補から人が1枚を選ぶまで reference_face_status を LOCKED にしない。",
    ].join("\n"),
  }),
);

console.log("事業Vaultへ恒久ルールを追記しました（追記のみ・既存は書き換えていません）:");
for (const f of [...new Set(files)]) console.log(`  ${f}`);
console.log("");
console.log(`  記録した判断: 3件（名前の使用場所別ルール / Identity Object と状態分離 / 顔の再現性QA）`);
