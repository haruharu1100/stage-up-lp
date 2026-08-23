/**
 * 名前と顔の「状態管理」がちゃんと働くかを検査する。
 *
 * ここで守りたいのは3つだけ。
 *   1. 調べ終わっていない項目を「問題なし」に丸めない
 *   2. 名前が確定しても、顔まで自動で確定しない
 *   3. ブランドの面ではフルネーム必須、普通の本文では下の名前だけでもよい
 *
 * DBに触らないので単体で走る（npm test が自動で拾う）。
 */
import {
  CHARACTER_IDENTITY,
  NAME_POLICY,
  NAME_SURFACES,
  SURFACE_LABEL,
  REQUIRED_SCREENINGS,
  KNOWN_COLLISION_NAMES,
  POST_LOCK_STEPS,
  decideLock,
  displayName,
  isSelfIntroductionAt,
  publishGate,
  requiresFullName,
  type CharacterIdentity,
  type ScreeningItem,
} from "../lib/identity.js";
import { FACE_QA, qaFaceConsistency, qaImage } from "../lib/character.js";

let ng = 0;
const line = (ok: boolean, msg: string) => {
  if (!ok) ng++;
  console.log(`${ok ? "  OK  " : "  NG  "} ${msg}`);
};

const GIVEN = CHARACTER_IDENTITY.given_name;

// --- 台帳作りのヘルパ -------------------------------------------------------
const item = (
  id: string,
  status: ScreeningItem["status"],
  required = true,
): ScreeningItem => ({
  id,
  registry: id,
  status,
  checkedAt: status === "UNKNOWN" ? null : "2026-08-23",
  sourceUrl: status === "UNKNOWN" ? null : `https://example.test/${id}`,
  note: "",
  // ゲートはコード側の定義に合わせる。定義に無いIDは安全側（NAME_LOCK）へ倒す
  gate: REQUIRED_SCREENINGS.find((r) => r.id === id)?.gate ?? "NAME_LOCK",
  required,
});

// 名前の確定を止められるのは NAME_LOCK ゲートの必須項目だけ
const requiredIds = REQUIRED_SCREENINGS.filter((r) => r.gate === "NAME_LOCK" && r.required).map(
  (r) => r.id,
);
const allClear = () => requiredIds.map((id) => item(id, "CLEAR"));

// ---------------------------------------------------------------------------
console.log("=== 名前を確定してよいかの判断（台帳→状態） ===");
// ---------------------------------------------------------------------------
{
  const d = decideLock([]);
  line(!d.canLock && d.suggested === "PROVISIONAL", `台帳が空なら PROVISIONAL のまま（${d.suggested}）`);
  line(d.missing.length === requiredIds.length, `未記入を全部数える（${d.missing.length}件）`);
}
{
  const items = allClear();
  items[0] = item(requiredIds[0]!, "UNKNOWN");
  const d = decideLock(items);
  line(
    !d.canLock && d.suggested === "PROVISIONAL",
    "必須が1件でも UNKNOWN なら確定しない（検索で出なかった＝存在しない、にしない）",
  );
}
{
  const items = allClear();
  items[1] = item(requiredIds[1]!, "CONFLICT");
  const d = decideLock(items);
  line(
    !d.canLock && d.suggested === "REJECTED",
    "重大な衝突が1件でもあれば REJECTED（名前候補フェーズへ戻す）",
  );
}
{
  // 任意項目（ドメイン）が UNKNOWN でも、必須が揃っていれば止めない
  const items = [...allClear(), item("DOMAIN", "UNKNOWN", false)];
  const d = decideLock(items);
  line(d.canLock && d.suggested === "LOCKED", "必須が全部 CLEAR なら LOCKED にしてよい");
  line(d.conflicts.length === 0, "任意項目の UNKNOWN では止めない");
}
{
  const items = allClear();
  const d = decideLock(items);
  line(d.canLock, "決めるのは機械、実際に書き換えるのは人（decideLockは提案しか返さない）");
}

// ---------------------------------------------------------------------------
console.log("\n=== 使用場所ごとの名前ルール ===");
// ---------------------------------------------------------------------------
{
  const strict = NAME_SURFACES.filter((s) => NAME_POLICY[s] === "BRAND_IDENTITY_STRICT");
  const natural = NAME_SURFACES.filter((s) => NAME_POLICY[s] === "CONTENT_NATURAL");
  line(strict.length === 16, `フルネーム必須の面が16箇所ある（現在${strict.length}）`);
  line(natural.length === 3, `下の名前だけでよい面が3箇所ある（現在${natural.length}）`);
  line(
    NAME_SURFACES.every((s) => (SURFACE_LABEL[s] ?? "").length > 0),
    "全ての面に日本語のラベルが付いている（人が読んで意味が分かる）",
  );

  const mustBeStrict = [
    "X_DISPLAY_NAME",
    "X_BIO_INTRO",
    "WEBSITE_TITLE",
    "WEBSITE_METADATA",
    "ABOUT_PAGE",
    "AFFILIATE_APPLICATION",
    "ASP_PROFILE",
    "MEDIA_KIT",
    "STRUCTURED_DATA",
    "OG_METADATA",
    "CHARACTER_BIBLE",
    "ANALYTICS_CHARACTER_NAME",
    "AFFILIATE_CAMPAIGN_NAME",
    "LEGAL_DISCLOSURE",
    "IMAGE_CHARACTER_ID",
    "AI_INTERNAL_IDENTITY",
  ] as const;
  for (const s of mustBeStrict) {
    line(requiresFullName(s), `${SURFACE_LABEL[s]} はフルネーム必須`);
  }
  for (const s of ["X_POST_BODY", "X_REPLY", "LP_BODY"] as const) {
    line(!requiresFullName(s), `${SURFACE_LABEL[s]} は下の名前だけでもよい`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 初めて自分を紹介している文かどうかの判定 ===");
// ---------------------------------------------------------------------------
{
  const intro = [
    `Hi, I'm ${GIVEN} 🌸`,
    `Hello! I am ${GIVEN}.`,
    `You can call me ${GIVEN}!`,
    `My name is ${GIVEN}.`,
    `This is ${GIVEN}.`,
  ];
  for (const t of intro) {
    const i = t.indexOf(GIVEN);
    line(isSelfIntroductionAt(t, i), `自己紹介と判定: "${t}"`);
  }
  const notIntro = [
    `${GIVEN} visited a shrine today.`,
    `Everyone asked ${GIVEN} about tea rooms.`,
  ];
  for (const t of notIntro) {
    const i = t.indexOf(GIVEN);
    line(!isSelfIntroductionAt(t, i), `自己紹介ではないと判定: "${t}"`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 名前と顔は別々に状態管理する ===");
// ---------------------------------------------------------------------------
const withState = (
  identity_status: CharacterIdentity["identity_status"],
  reference_face_status: CharacterIdentity["reference_face_status"],
): CharacterIdentity => ({ ...CHARACTER_IDENTITY, identity_status, reference_face_status });

{
  const g = publishGate(withState("PROVISIONAL", "NOT_GENERATED"));
  line(!g.ok && g.blockers.length === 2, `名前も顔も未確定なら公開不可（理由${g.blockers.length}件）`);
}
{
  // ★ここが要。名前が決まっても顔は自動で決まらない。この状態は「正常」
  const g = publishGate(withState("LOCKED", "PENDING_HUMAN_SELECTION"));
  line(!g.ok, "名前が確定しても、人が1枚選ぶまで公開しない");
  line(
    g.blockers.length === 1 && g.blockers[0]!.includes("基準顔"),
    "止まっている理由が「顔だけ」だと分かる",
  );
}
{
  const g = publishGate(withState("LOCKED", "LOCKED"));
  line(g.ok, "名前も顔も確定して初めて公開の前段階へ進める");
}
{
  const g = publishGate(withState("REJECTED", "LOCKED"));
  line(!g.ok && g.blockers[0]!.includes("REJECTED"), "REJECTED は顔が決まっていても公開不可");
}
{
  // 顔が要らない用途（申請書類など）は顔の判定を外せる
  const g = publishGate(withState("LOCKED", "NOT_GENERATED"), { requiresFace: false });
  line(g.ok, "顔を使わない用途では顔の状態で止めない");
}

// ---------------------------------------------------------------------------
console.log("\n=== 顔の一致は「測れていないもの」を合格にしない ===");
// ---------------------------------------------------------------------------
{
  const good = {
    faceSimilarity: 0.9,
    hairMatch: 0.9,
    faceShapeMatch: 0.9,
    eyesMatch: 0.9,
    noseMatch: 0.9,
    mouthMatch: 0.9,
    skinToneMatch: 0.9,
    estimatedAge: FACE_QA.baseAge,
  };
  line(qaFaceConsistency(good).ok, "7項目＋年齢がすべて基準内なら合格");

  const keys = [
    "faceSimilarity",
    "hairMatch",
    "faceShapeMatch",
    "eyesMatch",
    "noseMatch",
    "mouthMatch",
    "skinToneMatch",
    "estimatedAge",
  ] as const;
  for (const k of keys) {
    const r = qaFaceConsistency({ ...good, [k]: null });
    line(!r.ok, `${k} が未計測なら不合格（0として扱わない）`);
  }

  line(
    !qaFaceConsistency({ ...good, faceSimilarity: FACE_QA.minSimilarity - 0.01 }).ok,
    `類似度が ${FACE_QA.minSimilarity} 未満なら不合格`,
  );
  line(
    !qaFaceConsistency({ ...good, estimatedAge: FACE_QA.baseAge + FACE_QA.ageTolerance + 1 }).ok,
    `見た目年齢が ${FACE_QA.baseAge}±${FACE_QA.ageTolerance}歳 を外れたら不合格`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n=== 基準顔が確定した後は、顔一致QAを省略できない ===");
// ---------------------------------------------------------------------------
{
  const base = {
    faceSimilarity: 0.9,
    fingerCountOk: true,
    hasGarbledText: false,
    exposureWithinLimit: true,
    looksUnderageOrUncertain: false,
    resemblesRealPerson: false,
  };
  const consistency = {
    faceSimilarity: 0.9,
    hairMatch: 0.9,
    faceShapeMatch: 0.9,
    eyesMatch: 0.9,
    noseMatch: 0.9,
    mouthMatch: 0.9,
    skinToneMatch: 0.9,
    estimatedAge: FACE_QA.baseAge,
  };
  line(
    !qaImage({ ...base, referenceFaceStatus: "LOCKED" }).ok,
    "基準顔がLOCKEDなのに一致の数値が無ければ通さない",
  );
  line(
    qaImage({ ...base, referenceFaceStatus: "LOCKED", consistency }).ok,
    "一致の数値を渡せば通る",
  );
  line(
    !qaImage({ ...base, referenceFaceStatus: "LOCKED", consistency: { ...consistency, hairMatch: 0.5 } }).ok,
    "髪型が合っていなければ通さない（毎日違う人に見える状態を防ぐ）",
  );
}

// ---------------------------------------------------------------------------
console.log("\n=== 表示名と今の状態 ===");
// ---------------------------------------------------------------------------
{
  line(
    displayName().startsWith(CHARACTER_IDENTITY.full_name),
    `表示名はフルネームで始まる: "${displayName()}"`,
  );
  line(CHARACTER_IDENTITY.family_name.length > 0, `姓が入っている: "${CHARACTER_IDENTITY.family_name}"`);
  line(
    CHARACTER_IDENTITY.identity_status_reason.length > 0 &&
      CHARACTER_IDENTITY.reference_face_status_reason.length > 0,
    "今その状態にしている理由が書いてある（空でない）",
  );
  line(Array.isArray(KNOWN_COLLISION_NAMES), "衝突名の一覧が用意されている（人が書き足す）");
  // ★段階数そのものは固定しない。工程が増減するたびにテストが落ちるだけで、
  //   「手順が壊れていないか」は何も見ていないため。見るべきなのは連番と中身。
  line(POST_LOCK_STEPS.length > 0, `名前確定後の手順が定義されている（${POST_LOCK_STEPS.length}段階）`);
  line(
    POST_LOCK_STEPS.every((s, i) => s.step === i + 1 && s.label.length > 0),
    "手順に抜け番が無い",
  );
  // 顔を固定する工程は、必ず「人が1枚選ぶ」工程より後に来る。
  // ここが逆転すると機械が勝手に基準顔を確定できてしまう。
  const humanPick = POST_LOCK_STEPS.findIndex((s) => s.label.includes("人間が8枚から1枚を選ぶ"));
  const faceLock = POST_LOCK_STEPS.findIndex((s) => s.label.includes("Reference Face を固定"));
  line(
    humanPick >= 0 && faceLock > humanPick,
    "基準顔の固定は「人が1枚選ぶ」より後の工程になっている",
  );
}

console.log(
  `\n現在の状態: 名前=${CHARACTER_IDENTITY.identity_status} / 顔=${CHARACTER_IDENTITY.reference_face_status}` +
    `（${POST_LOCK_STEPS.filter((s) => s.done).length}/${POST_LOCK_STEPS.length} 完了）`,
);

console.log("");
if (ng > 0) {
  console.log(`❌ ${ng}件が不合格`);
  process.exit(1);
}
console.log("✅ すべて合格（名前の確定条件・使用場所別ルール・名前と顔の分離・顔一致QA）");
