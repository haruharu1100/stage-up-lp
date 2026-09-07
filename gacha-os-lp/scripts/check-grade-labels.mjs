/**
 * 賞の「呼び名」を変えても、中身が1件も壊れないことを確かめる（020）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験がいるのか
 * ═══════════════════════════════════════════════════════
 *
 *   お店ごとに、賞の呼び名を変えられるようにしました。
 *
 *       S賞 → 特賞 ／ A賞 → 1等 ／ B賞 → 2等 …
 *
 *   ここで、いちばん怖い作り間違いは、たった1つです。
 *
 *   ★呼び名を変えたときに、中の記号（grade）まで書き換えてしまうこと。
 *
 *   これをやると、画面上は何も起きません。名前が変わるだけです。
 *   ですが、裏では次が同時に壊れます。
 *
 *       ・残り口数（gacha_stock は (tenant_id, gacha_id, grade) が主キー）
 *       ・当選履歴（prizes に grade が入っている）
 *       ・還元率（grade で「現物か、ポイントか」を見分けている）
 *
 *   壊れたことに気づくのは、たいてい何日か後です。
 *   「昨日まで残り3口だったのに、今日は在庫が2種類ある」という形で出ます。
 *   そのときには、もうお客様がその状態で引いています。
 *
 *   だから、名前を変える前と後で、
 *   ★中の数字が1文字も動いていないことを、機械で突き合わせます。
 *
 * ═══════════════════════════════════════════════════════
 * ★「見た目は変わる」ことも、同時に確かめること
 * ═══════════════════════════════════════════════════════
 *
 *   壊れないことだけを確かめると、
 *   「そもそも呼び名が反映されていない」実装でも通ってしまいます。
 *   ですので、次の3つで、新しい呼び名が出ることまで見ます。
 *
 *       ・売り場の一覧／ガチャ詳細
 *       ・獲得商品の一覧（過去に当たった分も）
 *       ・当選画面（引いた直後）
 *
 * ═══════════════════════════════════════════════════════
 * ★記録は書き換わらないこと
 * ═══════════════════════════════════════════════════════
 *
 *   画面は「いまの呼び名」に変わります。
 *   ですが、ポイント台帳の摘要と監査ログの要約は記録です。
 *   ★そのとき画面に何と出ていたかを、書いたまま残します。
 *   後から書き換わる記録は、記録として使えません。
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・使い捨ての会社を1つ作り、その中だけで動きます。
 *   ・ブラウザも、外の通信も使いません（サーバー側の関数だけ）。
 *
 * ═══════════════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════════════
 *
 *     DATABASE_ENV=development DATABASE_URL=file:/tmp/gos-grade.db \
 *       npx tsx scripts/check-grade-labels.mjs
 *
 *   1つでも通らなければ、終了コード 1 で落ちます。
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* ── 安全装置 ───────────────────────────────── */
const DB_ENV = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (DB_ENV === "production") {
  console.error(
    "\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n",
  );
  process.exit(1);
}

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const seed = await import(`${ROOT}/lib/server/seed.ts`);
const { drawOnceServer } = await import(`${ROOT}/lib/server/draw.ts`);
const { listShopGachas, shopGachaDetail } = await import(
  `${ROOT}/lib/server/shop.ts`
);
const { listCustomerPrizes } = await import(`${ROOT}/lib/server/prizes.ts`);
const { verifyAuditOfTenant } = await import(`${ROOT}/lib/server/audit.ts`);
const {
  getGradeLabels,
  saveGradeLabels,
  defaultGradeLabel,
  GradeLabelError,
  GRADE_KEYS,
  GRADE_LABEL_MAX,
} = await import(`${ROOT}/lib/server/gradeLabels.ts`);

/* ══════════════════════════════════════════════
   記録の付け方
   ══════════════════════════════════════════════ */

let ok = 0;
let ng = 0;

function T(no, title, pass, detail) {
  if (pass) ok += 1;
  else ng += 1;
  console.log(`${pass ? "  ok " : "  NG "} ${String(no).padEnd(7)} ${title}`);
  if (detail) console.log(`          ${detail}`);
}

function H(title) {
  console.log(`\n══ ${title} ${"═".repeat(Math.max(0, 54 - title.length))}`);
}

const rows = async (sql, args = []) => (await db().execute({ sql, args })).rows;

/* 突き合わせは、必ず「並び順まで決めてから」文字にすること。
   ★SELECT の戻り順に頼ると、順番が違うだけで落ちる試験になります。 */
const stamp = (list) => JSON.stringify(list);

/* ══════════════════════════════════════════════
   下ごしらえ
   ══════════════════════════════════════════════ */

const SUF = Date.now().toString(36);
const ACTOR = {
  kind: "ADMIN",
  id: "adm-grade-test",
  name: "試験用の担当者",
  role: "SUPER_ADMIN",
};

console.log("\n賞の呼び名：中身が壊れないことの確認\n");

const tenantId = await seed.createTenant({
  code: `grade-${SUF}`,
  name: `呼び名の試験店 ${SUF}`,
});
const userId = await seed.createCustomer({
  tenantId,
  no: 1,
  name: "試験のお客様",
  points: 200_000,
  email: `grade-${SUF}@test.example`,
});
const gachaId = await seed.createGacha({
  tenantId,
  title: "呼び名の試験ガチャ",
  price: 500,
  total: 300,
  designedRtp: 90,
  status: "PUBLISHED",
});

/* ══════════════════════════════════════════════
   ① 変える前：まず引いて、記録を作る
   ══════════════════════════════════════════════ */

H("① 変える前の状態を作る");

const maeDraws = [];
for (let i = 0; i < 40; i++) {
  maeDraws.push(
    await drawOnceServer({
      tenantId,
      userId,
      gachaId,
      idempotencyKey: `mae-${SUF}-${i}`,
      requestId: `req-mae-${SUF}-${i}`,
    }),
  );
}
T(
  "G-01",
  "変える前に40回引けた",
  maeDraws.length === 40 && maeDraws.every((d) => typeof d.grade === "string"),
  `出た等級：${maeDraws.map((d) => d.grade).join("")}`,
);

/**
 * 現物の賞（S / A / B）を、必ず1件ずつ用意しておく。
 *
 * ★引いた結果まかせにしないこと。
 *   上位賞は、40回引いても1度も出ないことがあります。
 *   出なかった日は、当選履歴を突き合わせる項目が
 *   「0件どうしで一致」となり、何も確かめずに通ってしまいます。
 *   ★試験が、運で通ったり通らなかったりしてはいけません。
 */
for (const g of ["S", "A", "B"]) {
  await seed.createPrize({
    tenantId,
    userId,
    gachaId,
    grade: g,
    name: `試験用の景品 ${g}`,
    value: 10_000,
  });
}

const maeLabels = await getGradeLabels(tenantId);
T(
  "G-02",
  "何も決めていない店では、既定の呼び名が返る（空欄にならない）",
  GRADE_KEYS.every((g) => maeLabels[g] === defaultGradeLabel(g)) &&
    maeLabels["-"] === defaultGradeLabel("-"),
  `S=${maeLabels.S} ／ D=${maeLabels.D} ／ はずれ=${maeLabels["-"]}`,
);

/* ここから先の突き合わせに使う「変える前の写し」 */
const maeStock = await rows(
  `SELECT grade, name, value, total, drawn, reserved
     FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ? ORDER BY grade`,
  [tenantId, gachaId],
);
const maePrizes = await rows(
  `SELECT id, grade, name, value, exchange_pt, status, won_at
     FROM prizes WHERE tenant_id = ? ORDER BY id`,
  [tenantId],
);
const maeLedger = await rows(
  `SELECT id, kind, delta, ref, memo
     FROM point_ledger WHERE tenant_id = ? ORDER BY id`,
  [tenantId],
);
const maeAudit = await rows(
  `SELECT seq, action, summary, hash FROM audit_events
     WHERE tenant_id = ? ORDER BY seq`,
  [tenantId],
);
const maeGacha = await rows(
  `SELECT left_count, revenue, paid_value FROM gachas
     WHERE tenant_id = ? AND id = ?`,
  [tenantId, gachaId],
);

const maeStockS = stamp(maeStock);
const maePrizesS = stamp(maePrizes);
const maeLedgerS = stamp(maeLedger);
const maeAuditS = stamp(maeAudit);
const maeGachaS = stamp(maeGacha);

T(
  "G-03",
  "変える前に、在庫・当選履歴・台帳・監査ログがそろっている",
  maeStock.length === 5 &&
    maePrizes.length >= 3 &&
    ["S", "A", "B"].every((g) =>
      maePrizes.some((p) => String(p.grade) === g),
    ) &&
    maeLedger.length > 0 &&
    maeAudit.length > 0,
  `在庫${maeStock.length}行 ／ 当選履歴${maePrizes.length}件（記号 ${[...new Set(maePrizes.map((p) => p.grade))].join(",")}） ／ 台帳${maeLedger.length}行 ／ 監査${maeAudit.length}件`,
);

/* ══════════════════════════════════════════════
   ② 呼び名を、5つとも変える
   ══════════════════════════════════════════════ */

H("② 呼び名を変える");

const ATARASHII = {
  S: "特賞",
  A: "1等",
  B: "2等",
  C: "3等",
  D: "参加賞",
};

const atoLabels = await saveGradeLabels({
  tenantId,
  labels: ATARASHII,
  actor: ACTOR,
  requestId: `req-save-${SUF}`,
});

T(
  "G-04",
  "5つとも、新しい呼び名で読み出せる",
  GRADE_KEYS.every((g) => atoLabels[g] === ATARASHII[g]),
  GRADE_KEYS.map((g) => `${g}=${atoLabels[g]}`).join(" / "),
);

/* ══════════════════════════════════════════════
   ③ ★中身が1文字も動いていないこと
   ══════════════════════════════════════════════ */

H("③ 中身が動いていないこと（ここが本題）");

const atoStock = await rows(
  `SELECT grade, name, value, total, drawn, reserved
     FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ? ORDER BY grade`,
  [tenantId, gachaId],
);
T(
  "G-05",
  "残り口数（gacha_stock）が、1行も変わっていない",
  stamp(atoStock) === maeStockS,
  `記号：${atoStock.map((r) => r.grade).join(",")}`,
);

T(
  "G-06",
  "在庫の記号（grade）が S/A/B/C/D のまま（★呼び名で置き換えていない）",
  stamp(atoStock.map((r) => String(r.grade))) ===
    stamp(["A", "B", "C", "D", "S"]),
  `いまの記号：${atoStock.map((r) => r.grade).join(",")}`,
);

const atoPrizes = await rows(
  `SELECT id, grade, name, value, exchange_pt, status, won_at
     FROM prizes WHERE tenant_id = ? ORDER BY id`,
  [tenantId],
);
T(
  "G-07",
  "当選履歴（prizes）が、1件も変わっていない",
  stamp(atoPrizes) === maePrizesS,
  `${atoPrizes.length}件`,
);

T(
  "G-08",
  "当選履歴の記号（grade）に、呼び名が混ざっていない",
  atoPrizes.every((r) => GRADE_KEYS.includes(String(r.grade))),
  `使われている記号：${[...new Set(atoPrizes.map((r) => r.grade))].join(",")}`,
);

const atoLedger = await rows(
  `SELECT id, kind, delta, ref, memo
     FROM point_ledger WHERE tenant_id = ? ORDER BY id`,
  [tenantId],
);
T(
  "G-09",
  "ポイント台帳が、1行も書き換わっていない（★記録は書き換えない）",
  stamp(atoLedger) === maeLedgerS,
  `${atoLedger.length}行`,
);

const atoAuditAll = await rows(
  `SELECT seq, action, summary, hash FROM audit_events
     WHERE tenant_id = ? ORDER BY seq`,
  [tenantId],
);
const atoAuditMae = atoAuditAll.slice(0, maeAudit.length);
T(
  "G-10",
  "前からある監査ログが、1件も書き換わっていない",
  stamp(atoAuditMae) === maeAuditS,
  `前${maeAudit.length}件 ／ いま${atoAuditAll.length}件`,
);

const atoGacha = await rows(
  `SELECT left_count, revenue, paid_value FROM gachas
     WHERE tenant_id = ? AND id = ?`,
  [tenantId, gachaId],
);
T(
  "G-11",
  "ガチャ本体（残口・売上・払出）が変わっていない",
  stamp(atoGacha) === maeGachaS,
  `残り${atoGacha[0]?.left_count}口`,
);

const kensho = await verifyAuditOfTenant(db(), tenantId);
T(
  "G-12",
  "監査ログの鎖が、最初の1件から数え直しても切れていない",
  kensho.ok === true,
  kensho.ok ? `${kensho.checked}件を検算` : `${kensho.why} / ${kensho.detail}`,
);

/* ══════════════════════════════════════════════
   ④ 変えたことが、記録に残っていること
   ══════════════════════════════════════════════ */

H("④ 変えたことが記録に残っている");

const kiroku = await rows(
  `SELECT action, target, summary, before_text, after_text, data
     FROM audit_events WHERE tenant_id = ? AND action = 'GRADE_LABEL_UPDATE'
     ORDER BY seq`,
  [tenantId],
);
T(
  "G-13",
  "呼び名を変えた記録（GRADE_LABEL_UPDATE）が残っている",
  kiroku.length === 1,
  `${kiroku.length}件`,
);

const k0 = kiroku[0] ?? {};
T(
  "G-14",
  "記録に、変える前と後の両方が残っている",
  String(k0.before_text ?? "").includes("S=S賞") &&
    String(k0.after_text ?? "").includes("S=特賞"),
  `前：${String(k0.before_text ?? "").slice(0, 60)} → 後：${String(k0.after_text ?? "").slice(0, 60)}`,
);

let dataOk = false;
try {
  const d = JSON.parse(String(k0.data ?? "{}"));
  const arr = d?.changed ?? d?.data?.changed ?? [];
  dataOk =
    Array.isArray(arr) &&
    arr.length === 5 &&
    arr.every((x) => GRADE_KEYS.includes(String(x.grade)));
} catch {
  dataOk = false;
}
T(
  "G-15",
  "記録に、記号（S/A/B/C/D）も一緒に残っている（★呼び名だけにしない）",
  dataOk,
  String(k0.data ?? "").slice(0, 120),
);

/* ══════════════════════════════════════════════
   ⑤ 見た目には、ちゃんと反映されていること
   ══════════════════════════════════════════════ */

H("⑤ 新しい呼び名が、お客様の画面に出ている");

const uriba = await listShopGachas(tenantId);
const kono = uriba.find((x) => x.id === gachaId);
T(
  "G-16",
  "売り場の一覧に、新しい呼び名が出ている",
  !!kono?.top && kono.top.gradeLabel === ATARASHII[kono.top.grade],
  `上位賞：${kono?.top?.gradeLabel ?? "（なし）"}（記号 ${kono?.top?.grade ?? "-"}）`,
);

const shosai = await shopGachaDetail(tenantId, gachaId);
T(
  "G-17",
  "ガチャ詳細の賞の表が、5つとも新しい呼び名になっている",
  !!shosai &&
    shosai.prizes.length === 5 &&
    shosai.prizes.every((p) => p.gradeLabel === ATARASHII[p.grade]),
  (shosai?.prizes ?? []).map((p) => `${p.grade}→${p.gradeLabel}`).join(" / "),
);

const kakutoku = await listCustomerPrizes(tenantId, userId);
T(
  "G-18",
  "過去に当たった商品の一覧も、新しい呼び名で出ている（S/A/B の3つとも）",
  kakutoku.length >= 3 &&
    ["S", "A", "B"].every((g) => kakutoku.some((p) => p.grade === g)) &&
    kakutoku.every((p) => p.gradeLabel === ATARASHII[p.grade]),
  kakutoku.map((p) => `${p.grade}→${p.gradeLabel}`).join(" / "),
);

T(
  "G-19",
  "記号（grade）は、画面用の型でも S/A/B のまま",
  kakutoku.every((p) => GRADE_KEYS.includes(String(p.grade))),
  `使われている記号：${[...new Set(kakutoku.map((p) => p.grade))].join(",")}`,
);

/* ══════════════════════════════════════════════
   ⑥ 変えたあとも、ふつうに引けること
   ══════════════════════════════════════════════ */

H("⑥ 変えたあとも、これまでどおり引ける");

const atoDraws = [];
for (let i = 0; i < 20; i++) {
  atoDraws.push(
    await drawOnceServer({
      tenantId,
      userId,
      gachaId,
      idempotencyKey: `ato-${SUF}-${i}`,
      requestId: `req-ato-${SUF}-${i}`,
    }),
  );
}
T(
  "G-20",
  "呼び名を変えたあとも、20回引けた",
  atoDraws.length === 20 && atoDraws.every((d) => GRADE_KEYS.includes(d.grade) || d.grade === "-"),
  `出た等級：${atoDraws.map((d) => d.grade).join("")}`,
);

const nokori = await rows(
  `SELECT SUM(drawn) AS d FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ?`,
  [tenantId, gachaId],
);
T(
  "G-21",
  "引いた回数の合計が、在庫側でも 60 になっている（★別の行に分かれていない）",
  Number(nokori[0]?.d ?? 0) === 60,
  `いまの合計：${nokori[0]?.d}`,
);

const arataLedger = await rows(
  `SELECT memo FROM point_ledger WHERE tenant_id = ? ORDER BY id DESC LIMIT 25`,
  [tenantId],
);
const atarashiiMemo = arataLedger.some(
  (r) =>
    String(r.memo ?? "").includes("特賞") ||
    String(r.memo ?? "").includes("1等") ||
    String(r.memo ?? "").includes("2等") ||
    String(r.memo ?? "").includes("3等") ||
    String(r.memo ?? "").includes("参加賞"),
);
const furuiMemoNokori = maeLedger.some((r) =>
  /[SABCD]賞/.test(String(r.memo ?? "")),
);
T(
  "G-22",
  "変えたあとの台帳の摘要は、新しい呼び名で書かれている",
  atarashiiMemo,
  arataLedger
    .slice(0, 3)
    .map((r) => r.memo)
    .join(" / "),
);
T(
  "G-23",
  "変える前の台帳の摘要は、そのとき出ていた呼び名のまま残っている",
  furuiMemoNokori,
  "★記録は後から書き換えない",
);

const arataAudit = await rows(
  `SELECT summary FROM audit_events WHERE tenant_id = ? AND action = 'DRAW'
     ORDER BY seq DESC LIMIT 20`,
  [tenantId],
);
T(
  "G-24",
  "変えたあとの監査ログに、呼び名と記号の両方が残っている",
  arataAudit.some((r) => /（[SABCD]）/.test(String(r.summary ?? ""))),
  String(arataAudit[0]?.summary ?? "").slice(0, 80),
);

const kensho2 = await verifyAuditOfTenant(db(), tenantId);
T(
  "G-25",
  "引いたあとも、監査ログの鎖が切れていない",
  kensho2.ok === true,
  kensho2.ok ? `${kensho2.checked}件を検算` : `${kensho2.why}`,
);

/* ══════════════════════════════════════════════
   ⑦ 入れてはいけないものが、入らないこと
   ══════════════════════════════════════════════ */

H("⑦ 入れてはいけないものは、入らない");

let dup = null;
try {
  await saveGradeLabels({
    tenantId,
    labels: { A: "特賞" } /* S賞がすでに「特賞」 */,
    actor: ACTOR,
    requestId: `req-dup-${SUF}`,
  });
} catch (e) {
  dup = e;
}
T(
  "G-26",
  "同じ呼び名を2つの賞に付けようとすると、はねられる（優良誤認の防止）",
  dup instanceof GradeLabelError && dup.code === "DUPLICATE",
  dup ? dup.message : "（はねられなかった）",
);

let tooLong = null;
try {
  await saveGradeLabels({
    tenantId,
    labels: { A: "あ".repeat(GRADE_LABEL_MAX + 1) },
    actor: ACTOR,
    requestId: `req-long-${SUF}`,
  });
} catch (e) {
  tooLong = e;
}
T(
  "G-27",
  `${GRADE_LABEL_MAX} 文字を超える呼び名は、はねられる`,
  tooLong instanceof GradeLabelError && tooLong.code === "TOO_LONG",
  tooLong ? tooLong.message : "（はねられなかった）",
);

const shiranai = await saveGradeLabels({
  tenantId,
  labels: { Z: "幻の賞", "": "空の記号", "-": "はずれの呼び名" },
  actor: ACTOR,
  requestId: `req-unknown-${SUF}`,
});
const stockKazu = await rows(
  `SELECT COUNT(*) AS c FROM tenant_grade_labels WHERE tenant_id = ?`,
  [tenantId],
);
T(
  "G-28",
  "知らない記号（Z など）を送っても、新しい等級は作られない",
  Number(stockKazu[0]?.c ?? 0) === 5 && shiranai.Z === undefined,
  `保存されている呼び名：${stockKazu[0]?.c}件`,
);

/* はねられたあと、値が中途半端に残っていないこと */
const hane = await getGradeLabels(tenantId);
T(
  "G-29",
  "はねられたときに、途中まで保存されていない",
  GRADE_KEYS.every((g) => hane[g] === ATARASHII[g]),
  GRADE_KEYS.map((g) => `${g}=${hane[g]}`).join(" / "),
);

/* ══════════════════════════════════════════════
   ⑧ 既定に戻せること
   ══════════════════════════════════════════════ */

H("⑧ 既定の呼び名へ戻せる");

const modoshi = await saveGradeLabels({
  tenantId,
  labels: { S: "", A: "", B: "", C: "", D: "" },
  actor: ACTOR,
  requestId: `req-reset-${SUF}`,
});
T(
  "G-30",
  "空欄で保存すると、既定の呼び名（S賞など）に戻る",
  GRADE_KEYS.every((g) => modoshi[g] === defaultGradeLabel(g)),
  GRADE_KEYS.map((g) => `${g}=${modoshi[g]}`).join(" / "),
);

const nokoriGyo = await rows(
  `SELECT COUNT(*) AS c FROM tenant_grade_labels WHERE tenant_id = ?`,
  [tenantId],
);
T(
  "G-31",
  "既定に戻したときは、空文字を保存せず、行ごと消えている",
  Number(nokoriGyo[0]?.c ?? 0) === 0,
  `残っている行：${nokoriGyo[0]?.c}件`,
);

const saigoStock = await rows(
  `SELECT grade, name, value, total, drawn, reserved
     FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ? ORDER BY grade`,
  [tenantId, gachaId],
);
T(
  "G-32",
  "戻したあとも、在庫の記号は S/A/B/C/D のまま",
  stamp(saigoStock.map((r) => String(r.grade))) ===
    stamp(["A", "B", "C", "D", "S"]),
  `いまの記号：${saigoStock.map((r) => r.grade).join(",")}`,
);

const kensho3 = await verifyAuditOfTenant(db(), tenantId);
T(
  "G-33",
  "最後まで、監査ログの鎖が切れていない",
  kensho3.ok === true,
  kensho3.ok ? `${kensho3.checked}件を検算` : `${kensho3.why}`,
);

/* ══════════════════════════════════════════════
   ⑨ よその店に影響しないこと
   ══════════════════════════════════════════════ */

H("⑨ よその店には影響しない");

const tenantB = await seed.createTenant({
  code: `gradeb-${SUF}`,
  name: `となりの店 ${SUF}`,
});
await saveGradeLabels({
  tenantId,
  labels: { S: "PSA10賞" },
  actor: ACTOR,
  requestId: `req-a-only-${SUF}`,
});
const bLabels = await getGradeLabels(tenantB);
T(
  "G-34",
  "こちらの店で呼び名を変えても、となりの店は既定のまま",
  GRADE_KEYS.every((g) => bLabels[g] === defaultGradeLabel(g)),
  `となりの店 S=${bLabels.S}`,
);

const aLabels = await getGradeLabels(tenantId);
T(
  "G-35",
  "こちらの店には、変えた呼び名が残っている",
  aLabels.S === "PSA10賞" && aLabels.A === defaultGradeLabel("A"),
  `S=${aLabels.S} ／ A=${aLabels.A}`,
);

/* ══════════════════════════════════════════════
   まとめ
   ══════════════════════════════════════════════ */

console.log(`\n${"═".repeat(60)}`);
console.log(`  ok ${ok} 件 ／ NG ${ng} 件`);
console.log(`${"═".repeat(60)}\n`);

if (ng > 0) {
  console.error("✗ 通らなかった項目があります。\n");
  process.exit(1);
}
console.log("✓ 呼び名を変えても、抽選・残数・当選履歴・記録は壊れません。\n");
process.exit(0);
