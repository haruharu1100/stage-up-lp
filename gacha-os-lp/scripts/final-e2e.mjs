/**
 * 最終販売判定：お客様1人ぶんの「通し」を、公開先で実測する。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具が答えるのは、たった1つの問いです
 * ═══════════════════════════════════════════════════════
 *
 *   「画面が動いた」ではなく、
 *   ★動いたあとの数字が、全部そろっているか。
 *
 *   引く前と引いたあとで、次の7つが1つでもずれていたら不合格です。
 *
 *       ① 保有ポイント        （customers.points）
 *       ② ポイント台帳の合計  （point_ledger の SUM）
 *       ③ ガチャの残り口数    （gachas.left_count）
 *       ④ 等級ごとの残り本数  （gacha_stock.drawn）
 *       ⑤ 抽選の記録          （draws が1行だけ増える）
 *       ⑥ 当たった現物        （prizes）
 *       ⑦ 監査ログ            （audit_events の seq が1つ進む）
 *
 *   ずれていても、画面はふつうに動きます。
 *   だから、機械で突き合わせないと、誰も気づけません。
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・専用の会社（tenant）を新しく1つ作り、その中だけで動きます。
 *     既にある会社・お客様のデータには、一切触れません。
 *   ・メールは .example（誰も持てないドメイン）だけを使います。
 *     ですから、実際のメールは1通も飛びません。
 *   ・実決済・実配送は、そもそもこの製品に繋がっていません。
 *
 * 使い方：
 *   npx tsx --env-file=.env.local scripts/final-e2e.mjs <公開先URL>
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makePreviewClient } from "./lib/preview-client.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");

if (!BASE || !/^https:\/\//.test(BASE)) {
  console.error("\n✗ 公開先のURLを指定してください。\n  例： npx tsx --env-file=.env.local scripts/final-e2e.mjs https://xxx.vercel.app\n");
  process.exit(1);
}

/* ── 安全装置 ───────────────────────────────── */
const DB_ENV = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (DB_ENV === "production") {
  console.error("\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n");
  process.exit(1);
}
if (!(process.env.DATABASE_URL ?? "").trim()) {
  console.error("\n✗ DATABASE_URL がありません（npx vercel env pull .env.local）。\n");
  process.exit(1);
}

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const seed = await import(`${ROOT}/lib/server/seed.ts`);
const { setPassword } = await import(`${ROOT}/lib/server/auth.ts`);

/* ══════════════════════════════════════════════
   記録の付け方
   ══════════════════════════════════════════════ */

const LOG = [];
let ok = 0;
let ng = 0;

/** 通信の記録（4xx/5xx の棚卸しに使う） */
const CALLS = [];

function T(no, title, pass, detail) {
  LOG.push({ no, title, pass, detail });
  if (pass) ok += 1;
  else ng += 1;
  console.log(`${pass ? "  ok " : "  NG "} ${String(no).padEnd(7)} ${title}`);
  if (detail) console.log(`         ${detail}`);
}

function H(title) {
  console.log(`\n══ ${title} ${"═".repeat(Math.max(0, 56 - title.length))}`);
}

/* ══════════════════════════════════════════════
   DBから「いまの数字」をそのまま読む
   ══════════════════════════════════════════════ */

const one = async (sql, args = []) => (await db().execute({ sql, args })).rows[0] ?? {};
const many = async (sql, args = []) => (await db().execute({ sql, args })).rows;
const n = (v) => Number(v ?? 0);

async function snapshot(tenantId, userId, gachaId) {
  const cu = await one(`SELECT points, spent FROM customers WHERE tenant_id = ? AND id = ?`, [tenantId, userId]);
  const led = await one(`SELECT COALESCE(SUM(delta),0) AS s, COUNT(*) AS c FROM point_ledger WHERE tenant_id = ? AND user_id = ?`, [tenantId, userId]);
  const g = await one(`SELECT left_count, status, revenue, paid_value FROM gachas WHERE tenant_id = ? AND id = ?`, [tenantId, gachaId]);
  const stock = await many(`SELECT grade, total, drawn FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ? ORDER BY grade`, [tenantId, gachaId]);
  const dr = await one(`SELECT COUNT(*) AS c FROM draws WHERE tenant_id = ? AND user_id = ? AND gacha_id = ?`, [tenantId, userId, gachaId]);
  const pz = await one(`SELECT COUNT(*) AS c FROM prizes WHERE tenant_id = ? AND user_id = ?`, [tenantId, userId]);
  const au = await one(`SELECT COALESCE(MAX(seq),0) AS s, COUNT(*) AS c FROM audit_events WHERE tenant_id = ?`, [tenantId]);

  return {
    points: n(cu.points),
    spent: n(cu.spent),
    ledgerSum: n(led.s),
    ledgerRows: n(led.c),
    left: n(g.left_count),
    status: String(g.status ?? ""),
    revenue: n(g.revenue),
    paidValue: n(g.paid_value),
    stock: Object.fromEntries(stock.map((r) => [String(r.grade), { total: n(r.total), drawn: n(r.drawn) }])),
    draws: n(dr.c),
    prizes: n(pz.c),
    auditSeq: n(au.s),
    auditRows: n(au.c),
  };
}

/* ══════════════════════════════════════════════
   下ごしらえ：専用の会社・専用の会員・専用のガチャ
   ══════════════════════════════════════════════ */

const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const PASSWORD = process.env.E2E_PASSWORD ?? `e2e-${STAMP}-Kakunin!`;

H("下ごしらえ（専用の会社を新しく作る。既存データには触れない）");

const tenantA = await seed.createTenant({ code: `E2EA${STAMP}`, name: "最終判定テスト社A（架空）" });
const tenantB = await seed.createTenant({ code: `E2EB${STAMP}`, name: "最終判定テスト社B（架空）" });
console.log(`  A社 code=E2EA${STAMP}`);
console.log(`  B社 code=E2EB${STAMP}`);

const EMAIL_A = `e2e-a-${STAMP}@final.example`;
const EMAIL_A2 = `e2e-a2-${STAMP}@final.example`;
const EMAIL_B = `e2e-b-${STAMP}@final.example`;

/** 主役。50,000pt 持たせる（500pt のガチャを100回ぶん） */
const userA = await seed.createCustomer({ tenantId: tenantA, no: 1, name: "最終 試験子（架空）", points: 50_000, email: EMAIL_A });
await setPassword({ tenantId: tenantA, subjectKind: "CUSTOMER", subjectId: userA, password: PASSWORD });

/** 同じ会社の別人（他人の景品を触れないことの確認用） */
const userA2 = await seed.createCustomer({ tenantId: tenantA, no: 2, name: "最終 別人（架空）", points: 5_000, email: EMAIL_A2 });
await setPassword({ tenantId: tenantA, subjectKind: "CUSTOMER", subjectId: userA2, password: PASSWORD });

/** ポイント不足の確認用（0pt） */
const userPoor = await seed.createCustomer({ tenantId: tenantA, no: 3, name: "最終 残高ゼロ（架空）", points: 0, email: `e2e-poor-${STAMP}@final.example` });
await setPassword({ tenantId: tenantA, subjectKind: "CUSTOMER", subjectId: userPoor, password: PASSWORD });

/** B社のお客様（会社をまたげないことの確認用） */
const userB = await seed.createCustomer({ tenantId: tenantB, no: 1, name: "他社 試験子（架空）", points: 5_000, email: EMAIL_B });
await setPassword({ tenantId: tenantB, subjectKind: "CUSTOMER", subjectId: userB, password: PASSWORD });

const gMain = await seed.createGacha({ tenantId: tenantA, title: "最終判定ガチャ", price: 500, total: 80, designedRtp: 92, status: "PUBLISHED" });
const gDraft = await seed.createGacha({ tenantId: tenantA, title: "下書きガチャ", price: 500, total: 40, designedRtp: 92, status: "DRAFT" });
const gPaused = await seed.createGacha({ tenantId: tenantA, title: "停止中ガチャ", price: 500, total: 40, designedRtp: 92, status: "PAUSED" });
const gSold = await seed.createGacha({ tenantId: tenantA, title: "完売ガチャ", price: 500, total: 20, designedRtp: 92, status: "PUBLISHED" });
const gRich = await seed.createGacha({ tenantId: tenantA, title: "高額ガチャ（残高不足の確認用）", price: 90_000, total: 20, designedRtp: 92, status: "PUBLISHED" });
const gB = await seed.createGacha({ tenantId: tenantB, title: "他社ガチャ", price: 500, total: 40, designedRtp: 92, status: "PUBLISHED" });

/* 完売ガチャを、本当に売り切れの状態にする */
await db().execute({ sql: `UPDATE gachas SET left_count = 0, status = 'SOLD_OUT' WHERE tenant_id = ? AND id = ?`, args: [tenantA, gSold] });
await db().execute({ sql: `UPDATE gacha_stock SET drawn = total WHERE tenant_id = ? AND gacha_id = ?`, args: [tenantA, gSold] });

console.log(`  会員（主役）  ${EMAIL_A}  50,000pt`);
console.log(`  ガチャ（主役）「最終判定ガチャ」 500pt × 80口`);

/* ══════════════════════════════════════════════
   ネット越しに触る人を作る
   ══════════════════════════════════════════════ */

const Hito = makePreviewClient({ base: BASE, password: PASSWORD, db });

/** 通信を全部記録するために、call をくるむ */
function wrap(h, who) {
  const orig = h.call.bind(h);
  h.call = async (path, method = "GET", body, extra) => {
    const t0 = Date.now();
    const r = await orig(path, method, body, extra);
    CALLS.push({ who, method, path, status: r.status, ms: Date.now() - t0, code: r.json?.code ?? null });
    return r;
  };
  return h;
}

const a = wrap(new Hito("会員A"), "会員A");
const a2 = wrap(new Hito("会員A2"), "会員A2");
const poor = wrap(new Hito("残高ゼロ"), "残高ゼロ");
const b = wrap(new Hito("他社会員"), "他社会員");
const guest = wrap(new Hito("未ログイン"), "未ログイン");

/* ══════════════════════════════════════════════
   ① 未ログインで、何も見えないこと
   ══════════════════════════════════════════════ */

H("① 未ログインでは、何も読めない・何もできない");

for (const [path, label] of [
  ["/api/customer/gachas", "ガチャ一覧"],
  [`/api/customer/gachas/${gMain}`, "ガチャ詳細"],
  ["/api/customer/points", "ポイント"],
  ["/api/customer/prizes", "獲得商品"],
  ["/api/customer/orders", "発送状況"],
]) {
  const r = await guest.call(path);
  T("1-" + label, `未ログインで ${label} を読めない`, r.status === 401, `status=${r.status} code=${r.json?.code ?? "-"}`);
}

{
  const r = await guest.call("/api/console/draw", "POST", { gachaId: gMain }, { "Idempotency-Key": `guest_${STAMP}_0001` });
  T("1-draw", "未ログインでは引けない", r.status === 401 && r.json?.code === "UNAUTHENTICATED", `status=${r.status} code=${r.json?.code ?? "-"}`);
}

{
  const r = await guest.call("/mypage/shop");
  const to = r.headers.get("location") ?? "";
  T("1-page", "未ログインで /mypage/shop はログイン画面へ送られる", r.status === 307 && to.includes("/login"), `status=${r.status} → ${to}`);
}

/* ══════════════════════════════════════════════
   ② ログイン → マイページ → 一覧 → 詳細
   ══════════════════════════════════════════════ */

H("② ログイン → マイページ → ガチャ一覧 → ガチャ詳細");

{
  const r = await a.login("CUSTOMER", `E2EA${STAMP}`, EMAIL_A);
  T("2-1", "テスト会員でログインできる", r.status === 200, `status=${r.status} code=${r.json?.code ?? "-"}`);
  if (r.status !== 200) {
    console.error("\n✗ ログインできないため、ここで止めます。\n");
    process.exit(1);
  }
}

{
  const r = await a.call("/api/auth/me");
  T("2-2", "自分が誰かを、サーバーが返す", r.status === 200 && r.json?.ok === true, `status=${r.status}`);
}

{
  const r = await a.call("/mypage");
  T("2-3", "マイページが開く", r.status === 200 && r.text.includes("ガチャを引く"), `status=${r.status} / 「ガチャを引く」の文字=${r.text.includes("ガチャを引く")}`);
}

{
  const r = await a.call("/mypage/shop");
  T("2-4", "ガチャ一覧の画面が開く", r.status === 200, `status=${r.status}`);
}

let list = [];
{
  const r = await a.call("/api/customer/gachas");
  list = Array.isArray(r.json?.gachas) ? r.json.gachas : [];
  const ids = list.map((x) => x.id);
  T("2-5", "一覧に、公開中のガチャが出る", ids.includes(gMain), `${list.length}件：${list.map((x) => x.title).join(" / ")}`);
  T("2-6", "下書き・停止中・完売は、一覧に出ない",
    !ids.includes(gDraft) && !ids.includes(gPaused) && !ids.includes(gSold),
    `下書き=${ids.includes(gDraft)} 停止=${ids.includes(gPaused)} 完売=${ids.includes(gSold)}`);
  T("2-7", "他社のガチャは、一覧に出ない", !ids.includes(gB), `他社=${ids.includes(gB)}`);
}

let detail = null;
{
  const r = await a.call(`/api/customer/gachas/${gMain}`);
  detail = r.json?.gacha ?? null;
  T("2-8", "ガチャ詳細が読める", r.status === 200 && !!detail, `status=${r.status}`);
  const moji = JSON.stringify(detail ?? {});
  T("2-9", "詳細に、売上・払い出し・還元率が入っていない",
    !["revenue", "paidValue", "paid_value", "designedRtp", "designed_rtp", '"rtp"'].some((k) => moji.includes(k)),
    "通信の中身を見ても、その店の粗利は分からない");
  T("2-10", "賞の内訳（残り本数）が出ている", Array.isArray(detail?.prizes) && detail.prizes.length > 0, `${detail?.prizes?.length ?? 0}等級`);
}

{
  const r = await a.call(`/mypage/shop/${gMain}`);
  T("2-11", "ガチャ詳細の画面が開く", r.status === 200, `status=${r.status}`);
}

/* ══════════════════════════════════════════════
   ③ 1回引く（数字を全部突き合わせる）
   ══════════════════════════════════════════════ */

H("③ 1回引いて、前後の数字を全部突き合わせる");

const before = await snapshot(tenantA, userA, gMain);
console.log("  【引く前】");
console.log(`    保有ポイント  ${before.points.toLocaleString()}pt   （台帳の合計 ${before.ledgerSum.toLocaleString()}pt）`);
console.log(`    ガチャ残り    ${before.left}口 / 80口`);
console.log(`    景品の残り    ${Object.entries(before.stock).map(([g, s]) => `${g}:${s.total - s.drawn}`).join(" ")}`);
console.log(`    抽選の記録    ${before.draws}件   獲得商品 ${before.prizes}件   監査ログ seq=${before.auditSeq}`);

const KEY1 = `draw_${STAMP}_first_0001`;
let draw1 = null;
{
  const r = await a.call("/api/console/draw", "POST", { gachaId: gMain }, { "Idempotency-Key": KEY1 });
  draw1 = r.json?.result ?? null;
  T("3-1", "1回引ける", r.status === 200 && r.json?.ok === true && !!draw1, `status=${r.status} code=${r.json?.code ?? "-"}`);
  if (!draw1) {
    console.error("\n✗ 引けなかったため、ここで止めます。\n");
    process.exit(1);
  }
  console.log(`  【結果】${draw1.grade === "-" ? "はずれ" : draw1.grade + "賞"}「${draw1.prizeName}」 価値${draw1.prizeValue.toLocaleString()}円 / 現物のお届け=${draw1.needsShipping ? "あり" : "なし"} / 返ったポイント ${draw1.pointReturned}pt`);
}

const after = await snapshot(tenantA, userA, gMain);
console.log("  【引いた後】");
console.log(`    保有ポイント  ${after.points.toLocaleString()}pt   （台帳の合計 ${after.ledgerSum.toLocaleString()}pt）`);
console.log(`    ガチャ残り    ${after.left}口 / 80口`);
console.log(`    景品の残り    ${Object.entries(after.stock).map(([g, s]) => `${g}:${s.total - s.drawn}`).join(" ")}`);
console.log(`    抽選の記録    ${after.draws}件   獲得商品 ${after.prizes}件   監査ログ seq=${after.auditSeq}`);

const price = draw1.price;
const ret = draw1.pointReturned;

T("3-2", "保有ポイントが「引いた分だけ」減っている",
  after.points === before.points - price + ret,
  `${before.points} − ${price} + ${ret} = ${before.points - price + ret} ／ 実際 ${after.points}`);

T("3-3", "サーバーが返した残高と、DBの残高が一致する",
  draw1.pointAfter === after.points,
  `返り値 ${draw1.pointAfter} ／ DB ${after.points}`);

T("3-4", "台帳の合計と、保有ポイントが一致する",
  after.ledgerSum === after.points,
  `台帳 ${after.ledgerSum} ／ 残高 ${after.points}`);

T("3-5", "台帳に、今回ぶんの行が増えている",
  after.ledgerRows === before.ledgerRows + (ret > 0 ? 2 : 1),
  `${before.ledgerRows} → ${after.ledgerRows}（使った分${ret > 0 ? "＋返した分" : ""}）`);

T("3-6", "ガチャの残り口数が、ちょうど1つ減っている",
  after.left === before.left - 1 && draw1.remainingAfter === after.left,
  `${before.left} → ${after.left}（返り値 ${draw1.remainingAfter}）`);

{
  const g = draw1.grade;
  const okStock = g === "-"
    ? JSON.stringify(before.stock) === JSON.stringify(after.stock)
    : after.stock[g]?.drawn === before.stock[g]?.drawn + 1
      && Object.keys(after.stock).every((k) => k === g || after.stock[k].drawn === before.stock[k].drawn);
  T("3-7", "当たった等級だけ、残り本数が1本減っている", okStock,
    g === "-" ? "はずれなので、どの等級も減っていないこと" : `${g}賞 ${before.stock[g]?.total - before.stock[g]?.drawn}本 → ${after.stock[g]?.total - after.stock[g]?.drawn}本`);
}

T("3-8", "抽選の記録が、ちょうど1件だけ増えている",
  after.draws === before.draws + 1, `${before.draws} → ${after.draws}`);

T("3-9", "現物が当たったときだけ、獲得商品が1件増えている",
  after.prizes === before.prizes + (draw1.needsShipping ? 1 : 0),
  `${before.prizes} → ${after.prizes}（現物=${draw1.needsShipping}）`);

T("3-10", "監査ログの通し番号が、1つだけ進んでいる",
  after.auditSeq === before.auditSeq + 1 && draw1.auditSeq === after.auditSeq,
  `seq ${before.auditSeq} → ${after.auditSeq}（返り値 ${draw1.auditSeq}）`);

{
  const row = await one(`SELECT * FROM draws WHERE tenant_id = ? AND idempotency_key = ?`, [tenantA, KEY1]);
  T("3-11", "抽選の記録の中身が、返り値と1つずつ一致する",
    n(row.price) === draw1.price && n(row.point_before) === draw1.pointBefore && n(row.point_after) === draw1.pointAfter
      && String(row.prize_rank) === draw1.grade && n(row.remaining_after) === draw1.remainingAfter,
    `price=${n(row.price)} before=${n(row.point_before)} after=${n(row.point_after)} grade=${row.prize_rank} 残り=${n(row.remaining_after)}`);
  T("3-12", "乱数の出どころが記録されている（再現できる形で残す）",
    String(row.rng_source) === "node:crypto/randomInt" && String(row.rng_nonce ?? "").length > 0,
    `${row.rng_source} / nonce=${String(row.rng_nonce ?? "").slice(0, 12)}…`);
}

{
  const au = await one(`SELECT * FROM audit_events WHERE tenant_id = ? AND seq = ?`, [tenantA, after.auditSeq]);
  const data = JSON.parse(String(au.data ?? "{}"));
  T("3-13", "監査ログが、引いた本人・引いたガチャ・使ったポイントを記録している",
    String(au.action) === "DRAW" && String(au.actor_id) === userA && String(au.target) === gMain
      && n(data.point_spent) === price && n(data.point_after) === after.points,
    `${au.action} / ${au.actor_name} / ${au.summary}`);
  T("3-14", "監査ログに、改ざん検知のための鎖（hash）が付いている",
    String(au.hash ?? "").length >= 32 && String(au.prev_hash ?? "").length > 0,
    `hash=${String(au.hash).slice(0, 16)}…`);
}

{
  const r = await a.call("/api/customer/points");
  T("3-15", "お客様のポイント画面が、DBと同じ残高を返す",
    r.status === 200 && n(r.json?.balance) === after.points,
    `画面 ${r.json?.balance} ／ DB ${after.points}`);
}

{
  const r = await a.call(`/api/customer/gachas/${gMain}`);
  const d = r.json?.gacha;
  T("3-16", "ガチャ詳細の残り口数が、DBと同じ", n(d?.left) === after.left, `画面 ${d?.left} ／ DB ${after.left}`);
}

{
  const r = await a.call("/api/customer/prizes");
  const cnt = Array.isArray(r.json?.prizes) ? r.json.prizes.length : -1;
  T("3-17", "獲得商品の画面が、DBと同じ件数を返す", cnt === after.prizes, `画面 ${cnt}件 ／ DB ${after.prizes}件`);
}

/* ══════════════════════════════════════════════
   ④ 二重操作
   ══════════════════════════════════════════════ */

H("④ 二重操作（連打・やり直し・2タブ）");

{
  /* 4-1 同じ鍵で、もう一度送る＝通信のやり直し */
  const beforeD = await snapshot(tenantA, userA, gMain);
  const r = await a.call("/api/console/draw", "POST", { gachaId: gMain }, { "Idempotency-Key": KEY1 });
  const afterD = await snapshot(tenantA, userA, gMain);
  T("4-1", "同じ鍵で送り直しても、二重には引かれない（前回の結果を返す）",
    r.status === 200 && r.json?.result?.replayed === true && afterD.draws === beforeD.draws && afterD.points === beforeD.points,
    `replayed=${r.json?.result?.replayed} 抽選 ${beforeD.draws}→${afterD.draws} 残高 ${beforeD.points}→${afterD.points}`);
}

{
  /* 4-2 同じ鍵を6本、いっせいに投げる＝連打で通信が重なった状態 */
  const beforeD = await snapshot(tenantA, userA, gMain);
  const KEY2 = `draw_${STAMP}_rapid_0002`;
  const rs = await Promise.all(
    Array.from({ length: 6 }, () => a.call("/api/console/draw", "POST", { gachaId: gMain }, { "Idempotency-Key": KEY2 })),
  );
  const afterD = await snapshot(tenantA, userA, gMain);
  const codes = rs.map((r) => `${r.status}${r.json?.code ? "/" + r.json.code : ""}`).join(" ");
  T("4-2", "同じ鍵を6本同時に投げても、引かれるのは1回だけ",
    afterD.draws === beforeD.draws + 1 && afterD.left === beforeD.left - 1,
    `返事：${codes} ／ 抽選 ${beforeD.draws}→${afterD.draws} 残り ${beforeD.left}→${afterD.left}`);
}

{
  /* 4-3 別々の鍵を2本、いっせいに投げる＝2つのタブから同時に押した状態 */
  const beforeD = await snapshot(tenantA, userA, gMain);
  const rs = await Promise.all([
    a.call("/api/console/draw", "POST", { gachaId: gMain }, { "Idempotency-Key": `draw_${STAMP}_tabA_0003` }),
    a.call("/api/console/draw", "POST", { gachaId: gMain }, { "Idempotency-Key": `draw_${STAMP}_tabB_0004` }),
  ]);
  const afterD = await snapshot(tenantA, userA, gMain);
  const hiita = afterD.draws - beforeD.draws;
  /* ★ここは「1回であること」を求めない。
       別々の鍵は「別々のご依頼」です。2回引かれるのが正しい動きです。
       確かめるのは、2回ぶんの数字がきちんと合っていること。 */
  T("4-3", "別の鍵（別タブ）は別のご依頼として扱われ、数字は最後まで合う",
    afterD.left === beforeD.left - hiita
      && afterD.ledgerSum === afterD.points
      && afterD.auditSeq === beforeD.auditSeq + hiita,
    `${hiita}回ぶん処理／残り ${beforeD.left}→${afterD.left}／台帳=残高 ${afterD.ledgerSum}=${afterD.points}／監査 ${beforeD.auditSeq}→${afterD.auditSeq}`);
  T("4-3b", "同じ鍵が2つの抽選に使い回されていない",
    n((await one(`SELECT COUNT(*) AS c FROM (SELECT idempotency_key FROM draws WHERE tenant_id = ? GROUP BY idempotency_key HAVING COUNT(*) > 1)`, [tenantA])).c) === 0,
    "draws は (会社, 鍵) で重複できない作りになっている");
}

{
  /* 4-4 鍵なし／合図なし */
  const r1 = await a.call("/api/console/draw", "POST", { gachaId: gMain });
  T("4-4", "二重実行を防ぐ鍵が無ければ、引けない",
    r1.status === 400 && r1.json?.code === "IDEMPOTENCY_KEY_REQUIRED", `status=${r1.status} code=${r1.json?.code}`);

  /* 合図（CSRF）を外して送る。cookie は付けたまま */
  const res = await fetch(`${BASE}/api/console/draw`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie(), "Idempotency-Key": `draw_${STAMP}_nocsrf_0005` },
    body: JSON.stringify({ gachaId: gMain }),
    redirect: "manual",
  });
  const j = await res.json().catch(() => ({}));
  CALLS.push({ who: "会員A", method: "POST", path: "/api/console/draw(合図なし)", status: res.status, ms: 0, code: j.code ?? null });
  T("4-5", "合図（CSRF）が無ければ、引けない",
    res.status === 403 && j.code === "CSRF_FAILED", `status=${res.status} code=${j.code}`);
}

/* ══════════════════════════════════════════════
   ⑤ 異常系
   ══════════════════════════════════════════════ */

H("⑤ 異常系（不足・完売・停止・非公開・他社・他人）");

{
  const r = await poor.login("CUSTOMER", `E2EA${STAMP}`, `e2e-poor-${STAMP}@final.example`);
  T("5-0", "残高ゼロの会員でログインできる", r.status === 200, `status=${r.status}`);
  const d = await poor.call("/api/console/draw", "POST", { gachaId: gRich }, { "Idempotency-Key": `draw_${STAMP}_poor_0006` });
  const p = await one(`SELECT points FROM customers WHERE tenant_id = ? AND id = ?`, [tenantA, userPoor]);
  T("5-1", "ポイントが足りなければ、引けない（減らない）",
    d.status === 402 && d.json?.code === "NOT_ENOUGH_POINTS" && n(p.points) === 0,
    `status=${d.status} code=${d.json?.code} 残高=${n(p.points)}`);
}

for (const [gid, label, expect, tag] of [
  [gSold, "完売したガチャ", ["SOLD_OUT", "NOT_PUBLISHED"], "sold"],
  [gPaused, "停止中のガチャ", ["NOT_PUBLISHED"], "paused"],
  [gDraft, "下書きのガチャ", ["NOT_PUBLISHED"], "draft"],
  [gB, "他社のガチャ", ["NO_GACHA"], "other"],
]) {
  const r = await a.call("/api/console/draw", "POST", { gachaId: gid }, { "Idempotency-Key": `draw_${STAMP}_${tag}_0007` });
  T("5-" + label, `${label}は引けない`, r.status >= 400 && expect.includes(r.json?.code), `status=${r.status} code=${r.json?.code}`);

  const d = await a.call(`/api/customer/gachas/${gid}`);
  T("5-" + label + "-詳細", `${label}は、URLを直に叩いても開けない`, d.status === 404, `status=${d.status} code=${d.json?.code}`);
}

{
  const r = await a.call("/api/console/draw", "POST", { gachaId: "gac_does_not_exist" }, { "Idempotency-Key": `draw_${STAMP}_ghost_0008` });
  T("5-ghost", "存在しないガチャIDでは引けない", r.status === 404 && r.json?.code === "NO_GACHA", `status=${r.status} code=${r.json?.code}`);
}

{
  /* 他社の会員が、A社のガチャを引こうとする */
  const lg = await b.login("CUSTOMER", `E2EB${STAMP}`, EMAIL_B);
  T("5-b0", "他社の会員でログインできる", lg.status === 200, `status=${lg.status}`);
  const r = await b.call("/api/console/draw", "POST", { gachaId: gMain }, { "Idempotency-Key": `draw_${STAMP}_cross_0009` });
  T("5-cross", "他社の会員は、こちらのガチャを引けない", r.status === 404 && r.json?.code === "NO_GACHA", `status=${r.status} code=${r.json?.code}`);
  const d = await b.call(`/api/customer/gachas/${gMain}`);
  T("5-cross2", "他社の会員は、こちらのガチャ詳細を読めない", d.status === 404, `status=${d.status}`);
}

{
  /* 会社コードを間違えたログイン */
  const x = wrap(new Hito("なりすまし"), "なりすまし");
  const r = await x.login("CUSTOMER", `E2EB${STAMP}`, EMAIL_A);
  T("5-mix", "A社の会員は、B社の会社コードではログインできない", r.status >= 400, `status=${r.status} code=${r.json?.code}`);
}

/* ══════════════════════════════════════════════
   ⑥ 景品を2つ用意する（発送用・交換用）
   ══════════════════════════════════════════════ */

H("⑥ 現物の景品を2つ引き当てるまで、実際に引き続ける");

let hikiKaisu = 3 + 2 + 1; /* ここまでに成立した抽選の回数（3-1, 4-2, 4-3×2 → あとで数え直す） */
{
  const cnt = await one(`SELECT COUNT(*) AS c FROM draws WHERE tenant_id = ? AND user_id = ?`, [tenantA, userA]);
  hikiKaisu = n(cnt.c);
}

let prizeIds = [];
let extraDraws = 0;
for (let i = 0; i < 120; i++) {
  const cur = await many(`SELECT id, value, status FROM prizes WHERE tenant_id = ? AND user_id = ? AND status = 'UNCHOSEN' ORDER BY value ASC`, [tenantA, userA]);
  if (cur.length >= 2) {
    prizeIds = cur.map((r) => String(r.id));
    break;
  }
  const r = await a.call("/api/console/draw", "POST", { gachaId: gMain }, { "Idempotency-Key": `draw_${STAMP}_fill_${String(i).padStart(4, "0")}` });
  if (r.status !== 200) {
    T("6-0", "景品を集めるための抽選が途中で止まった", false, `status=${r.status} code=${r.json?.code}`);
    break;
  }
  extraDraws += 1;
}

{
  const cnt = await one(`SELECT COUNT(*) AS c FROM draws WHERE tenant_id = ? AND user_id = ?`, [tenantA, userA]);
  hikiKaisu = n(cnt.c);
}
T("6-1", "現物の景品を2つ、実際の抽選で引き当てた", prizeIds.length >= 2,
  `合計 ${hikiKaisu}回引いて、現物 ${prizeIds.length}件（うち追加 ${extraDraws}回）`);

{
  /* 全部の抽選が終わったあとでも、台帳と残高が合っているか */
  const s = await snapshot(tenantA, userA, gMain);
  const drawnSum = Object.values(s.stock).reduce((t, x) => t + x.drawn, 0);
  const hazure = await one(`SELECT COUNT(*) AS c FROM draws WHERE tenant_id = ? AND gacha_id = ? AND prize_rank = '-'`, [tenantA, gMain]);
  const zenbu = await one(`SELECT COUNT(*) AS c FROM draws WHERE tenant_id = ? AND gacha_id = ?`, [tenantA, gMain]);
  T("6-2", `${hikiKaisu}回引いたあとでも、台帳の合計と残高が一致する`, s.ledgerSum === s.points, `台帳 ${s.ledgerSum} ／ 残高 ${s.points}`);
  T("6-3", "引いた回数と、減った口数が一致する", 80 - s.left === n(zenbu.c), `減った口数 ${80 - s.left} ／ 抽選 ${n(zenbu.c)}回`);
  T("6-4", "出した景品の本数と、抽選の回数が合う（はずれを除く）",
    drawnSum === n(zenbu.c) - n(hazure.c), `景品 ${drawnSum}本 ／ 当たり ${n(zenbu.c) - n(hazure.c)}回`);
}

/* ══════════════════════════════════════════════
   ⑦ ポイント交換（A）と 発送依頼（B）
   ══════════════════════════════════════════════ */

H("⑦ 景品A＝ポイント交換／景品B＝発送依頼");

const prizeExchange = prizeIds[0];
const prizeShip = prizeIds[1];

{
  const p = await one(`SELECT value, exchange_pt, name, grade FROM prizes WHERE id = ?`, [prizeExchange]);
  const s0 = await snapshot(tenantA, userA, gMain);
  const r = await a.call("/api/customer/prizes/exchange", "POST", { prizeIds: [prizeExchange] });
  const s1 = await snapshot(tenantA, userA, gMain);
  const row = await one(`SELECT status FROM prizes WHERE id = ?`, [prizeExchange]);
  T("7-1", "景品Aをポイントに交換できる", r.status === 200 && r.json?.ok === true, `status=${r.status} code=${r.json?.code ?? "-"}`);
  T("7-2", "交換したぶん、ポイントがちょうど増えている",
    s1.points === s0.points + n(p.exchange_pt), `${s0.points} + ${n(p.exchange_pt)} = ${s0.points + n(p.exchange_pt)} ／ 実際 ${s1.points}`);
  T("7-3", "交換後も、台帳の合計と残高が一致する", s1.ledgerSum === s1.points, `台帳 ${s1.ledgerSum} ／ 残高 ${s1.points}`);
  T("7-4", "その景品の状態が「交換済み」に変わっている", String(row.status) === "EXCHANGED", `status=${row.status}`);
  T("7-5", "交換が監査ログに残っている", s1.auditSeq > s0.auditSeq, `seq ${s0.auditSeq} → ${s1.auditSeq}`);

  /* 二重交換 */
  const s2 = await snapshot(tenantA, userA, gMain);
  const again = await a.call("/api/customer/prizes/exchange", "POST", { prizeIds: [prizeExchange] });
  const s3 = await snapshot(tenantA, userA, gMain);
  T("7-6", "同じ景品を、二度は交換できない",
    again.status >= 400 && s3.points === s2.points,
    `status=${again.status} code=${again.json?.code} 残高 ${s2.points}→${s3.points}`);
}

{
  /* 発送依頼の前に、お届け先を入れる（本人確認つき） */
  const noAddr = await a.call("/api/customer/orders", "POST", { prizeIds: [prizeShip] });
  T("7-7", "お届け先が無ければ、発送依頼はできない",
    noAddr.status >= 400 && ["NO_ADDRESS", "STEP_UP_REQUIRED"].includes(noAddr.json?.code),
    `status=${noAddr.status} code=${noAddr.json?.code}`);

  const g0 = await a.call("/api/customer/address");
  const needStepUp = g0.json?.stepUp?.need === true;
  if (needStepUp) {
    const su = await a.call("/api/customer/step-up", "POST", { password: PASSWORD });
    T("7-8", "お届け先を変えるとき、本人確認（パスワード再入力）を通る", su.status === 200, `status=${su.status} code=${su.json?.code ?? "-"}`);
  } else {
    T("7-8", "お届け先を変えるときの本人確認の設定状態を確認した", true, `いまは求めない設定（stepUp.need=false）`);
  }

  const put = await a.call("/api/customer/address", "PUT", {
    name: "最終 試験子（架空）",
    zip: "100-0001",
    addr: "東京都千代田区千代田1-1（架空の住所）",
    tel: "03-0000-0000",
  });
  T("7-9", "お届け先を登録できる", put.status === 200, `status=${put.status} code=${put.json?.code ?? "-"}`);

  const s0 = await snapshot(tenantA, userA, gMain);
  let order = await a.call("/api/customer/orders", "POST", { prizeIds: [prizeShip] });
  if (order.status === 403 && order.json?.code === "STEP_UP_REQUIRED") {
    /* 住所を変えた直後なので、もう一度だけ本人確認を通る（正しい動き） */
    const su = await a.call("/api/customer/step-up", "POST", { password: PASSWORD });
    T("7-10", "住所を変えた直後の発送依頼は、もう一度の本人確認を求める（正しい）", su.status === 200, `再確認 status=${su.status}`);
    order = await a.call("/api/customer/orders", "POST", { prizeIds: [prizeShip] });
  } else {
    T("7-10", "発送依頼の本人確認の求め方を確認した", true, `1回目で通った（code=${order.json?.code ?? "-"}）`);
  }

  const s1 = await snapshot(tenantA, userA, gMain);
  const row = await one(`SELECT status FROM prizes WHERE id = ?`, [prizeShip]);
  T("7-11", "景品Bの発送を依頼できる", order.status === 200 && order.json?.ok === true, `status=${order.status} code=${order.json?.code ?? "-"}`);
  T("7-12", "その景品の状態が「発送依頼済み」に変わっている", String(row.status) === "SHIP_REQUESTED", `status=${row.status}`);
  T("7-13", "発送依頼では、ポイントは1ptも動かない", s1.points === s0.points, `${s0.points} → ${s1.points}`);
  T("7-14", "発送依頼が監査ログに残っている", s1.auditSeq > s0.auditSeq, `seq ${s0.auditSeq} → ${s1.auditSeq}`);

  const ordersRow = await one(`SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ? AND user_id = ?`, [tenantA, userA]);
  T("7-15", "注文が1件だけ立っている", n(ordersRow.c) === 1, `${n(ordersRow.c)}件`);

  /* 二重の発送依頼 */
  const again = await a.call("/api/customer/orders", "POST", { prizeIds: [prizeShip] });
  const ordersRow2 = await one(`SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ? AND user_id = ?`, [tenantA, userA]);
  T("7-16", "同じ景品を、二度は発送依頼できない",
    again.status >= 400 && n(ordersRow2.c) === 1, `status=${again.status} code=${again.json?.code} 注文 ${n(ordersRow2.c)}件`);

  /* 発送依頼済みの景品を、ポイント交換もできないこと */
  const ex = await a.call("/api/customer/prizes/exchange", "POST", { prizeIds: [prizeShip] });
  T("7-17", "発送依頼した景品は、ポイント交換もできない", ex.status >= 400, `status=${ex.status} code=${ex.json?.code}`);

  const view = await a.call("/api/customer/orders");
  T("7-18", "お客様の発送状況の画面に、その注文が出る",
    view.status === 200 && Array.isArray(view.json?.orders) && view.json.orders.length === 1,
    `${view.json?.orders?.length ?? "-"}件`);
}

/* ══════════════════════════════════════════════
   ⑧ 他人の景品を触れないこと
   ══════════════════════════════════════════════ */

H("⑧ 他人の景品・他社の景品に、手が届かないこと");

{
  const lg = await a2.login("CUSTOMER", `E2EA${STAMP}`, EMAIL_A2);
  T("8-0", "同じ会社の別の会員でログインできる", lg.status === 200, `status=${lg.status}`);

  const nokori = await many(`SELECT id FROM prizes WHERE tenant_id = ? AND user_id = ? AND status = 'UNCHOSEN'`, [tenantA, userA]);
  const target = nokori[0] ? String(nokori[0].id) : prizeShip;

  const ex = await a2.call("/api/customer/prizes/exchange", "POST", { prizeIds: [target] });
  T("8-1", "他人の景品を、ポイントに交換できない", ex.status >= 400, `status=${ex.status} code=${ex.json?.code}`);

  /* ★この人にも、先にお届け先を入れておくこと。
       住所が無いまま試すと「お届け先が無い」で断られてしまい、
       断った理由が「他人のものだから」なのか
       「住所が無いから」なのか、区別がつきません。
       住所を入れて、それでも断られることを確かめます。 */
  {
    const g = await a2.call("/api/customer/address");
    if (g.json?.stepUp?.need === true) {
      await a2.call("/api/customer/step-up", "POST", { password: PASSWORD });
    }
    const put = await a2.call("/api/customer/address", "PUT", {
      name: "最終 別人（架空）",
      zip: "100-0002",
      addr: "東京都千代田区千代田1-2（架空の住所）",
      tel: "03-0000-0001",
    });
    T("8-1b", "他人の景品を試す人にも、お届け先を登録できた（断る理由をはっきりさせるため）",
      put.status === 200, `status=${put.status} code=${put.json?.code ?? "-"}`);
  }

  let od = await a2.call("/api/customer/orders", "POST", { prizeIds: [target] });
  if (od.status === 403 && od.json?.code === "STEP_UP_REQUIRED") {
    await a2.call("/api/customer/step-up", "POST", { password: PASSWORD });
    od = await a2.call("/api/customer/orders", "POST", { prizeIds: [target] });
  }
  T("8-2", "他人の景品の発送を依頼できない（お届け先があっても断られる）",
    od.status >= 400 && od.json?.code === "NO_PRIZE",
    `status=${od.status} code=${od.json?.code}`);

  const mine = await a2.call("/api/customer/prizes");
  T("8-3", "別の会員の画面には、他人の景品が1件も出ない",
    mine.status === 200 && Array.isArray(mine.json?.prizes) && mine.json.prizes.length === 0,
    `${mine.json?.prizes?.length ?? "-"}件`);

  const ex2 = await b.call("/api/customer/prizes/exchange", "POST", { prizeIds: [target] });
  T("8-4", "他社の会員は、こちらの景品に触れない", ex2.status >= 400, `status=${ex2.status} code=${ex2.json?.code}`);

  const pt = await one(`SELECT points FROM customers WHERE tenant_id = ? AND id = ?`, [tenantA, userA2]);
  T("8-5", "他人の景品を触ろうとしても、自分のポイントは1ptも動かない", n(pt.points) === 5_000, `${n(pt.points)}pt`);
}

/* ══════════════════════════════════════════════
   ⑨ 管理側にも、同じ数字で反映されていること
   ══════════════════════════════════════════════ */

H("⑨ 管理画面に、同じ数字で反映されていること");

{
  const admin = wrap(new Hito("管理者"), "管理者");
  const uid = await seed.createAdmin({ tenantId: tenantA, no: 1, email: `e2e-admin-${STAMP}@final.example`, name: "最終 管理者（架空）", role: "SUPER_ADMIN" });
  await setPassword({ tenantId: tenantA, subjectKind: "ADMIN", subjectId: uid, password: PASSWORD });

  const lg = await admin.login("ADMIN", `E2EA${STAMP}`, `e2e-admin-${STAMP}@final.example`);
  T("9-0", "管理者でログインできる", lg.status === 200, `status=${lg.status} code=${lg.json?.code ?? "-"}`);

  const s = await snapshot(tenantA, userA, gMain);

  const cs = await admin.call("/api/console/customers");
  const me = (cs.json?.customers ?? []).find((c) => c.id === userA);
  T("9-1", "管理画面の会員一覧に、テスト会員が出る", !!me, me ? `${me.name}` : "見つからない");
  T("9-2", "管理画面の残高が、お客様側と同じ",
    me ? n(me.points) === s.points : false, `管理 ${me?.points} ／ DB ${s.points}`);

  const gs = await admin.call("/api/console/gachas");
  const gg = (gs.json?.gachas ?? []).find((x) => x.id === gMain);
  T("9-3", "管理画面のガチャ残り口数が、お客様側と同じ",
    gg ? n(gg.left ?? gg.leftCount ?? gg.left_count) === s.left : false,
    `管理 ${gg?.left ?? gg?.leftCount ?? gg?.left_count} ／ DB ${s.left}`);

  const od = await admin.call("/api/console/orders");
  const mineOrders = (od.json?.orders ?? []).filter((o) => o.userId === userA || o.user_id === userA);
  T("9-4", "管理画面の注文一覧に、お客様の発送依頼が出る", mineOrders.length === 1, `${mineOrders.length}件`);

  const au = await admin.call("/api/console/audit");
  const rows = au.json?.events ?? au.json?.rows ?? au.json?.audit ?? [];
  T("9-5", "管理画面の監査ログに、抽選の記録が出る",
    Array.isArray(rows) && rows.some((r) => String(r.action) === "DRAW"), `${Array.isArray(rows) ? rows.length : "-"}件`);

  const vr = await admin.call("/api/console/audit/verify");
  T("9-6", "監査ログの鎖が、途中で切れていない（改ざんされていない）",
    vr.status === 200 && (vr.json?.ok === true) && (vr.json?.broken ?? 0) === 0,
    `status=${vr.status} broken=${vr.json?.broken ?? "-"}`);

  const rtp = await admin.call("/api/console/rtp");
  T("9-7", "管理画面の還元率が読める（お客様側には出さない数字）", rtp.status === 200, `status=${rtp.status}`);
}

/* ══════════════════════════════════════════════
   まとめ
   ══════════════════════════════════════════════ */

H("通信の棚卸し（4xx・5xx）");

const bad = CALLS.filter((c) => c.status >= 500);
const four = CALLS.filter((c) => c.status >= 400 && c.status < 500);
console.log(`  通信 合計 ${CALLS.length}回`);
console.log(`  5xx（サーバー側の異常）      ${bad.length}件`);
for (const c of bad) console.log(`      ${c.status} ${c.method} ${c.path} (${c.who})`);
console.log(`  4xx（断った・想定内の拒否）  ${four.length}件`);
const byCode = {};
for (const c of four) byCode[`${c.status}/${c.code ?? "-"}`] = (byCode[`${c.status}/${c.code ?? "-"}`] ?? 0) + 1;
for (const [k, v] of Object.entries(byCode)) console.log(`      ${k} × ${v}`);
/* ── 待ち時間 ───────────────────────────────
   ★ここを「速さの好み」だと思わないこと。
     ガチャは1回で終わりません。3秒かかるなら、10回引く方は30秒待ちます。
     待たされる画面は、途中でやめられます。売上に直結します。 */
const chuuou = (xs) => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const drawMs = CALLS.filter((c) => c.path === "/api/console/draw" && c.status === 200).map((c) => c.ms);
const readMs = CALLS.filter((c) => c.method === "GET" && c.path.startsWith("/api/")).map((c) => c.ms);
console.log(`  1回引くのにかかる時間  中央値 ${chuuou(drawMs)}ms（最長 ${Math.max(0, ...drawMs)}ms・${drawMs.length}回）`);
console.log(`  読み取りにかかる時間    中央値 ${chuuou(readMs)}ms`);
const osoi = CALLS.filter((c) => c.ms > 5000);

T("E-1", "サーバー側の異常（5xx）が0件である", bad.length === 0, `${bad.length}件`);
T("E-2", "5秒を超えた通信が0件である", osoi.length === 0, `${osoi.length}件（最長 ${Math.max(0, ...CALLS.map((c) => c.ms))}ms）`);
T("E-3", "1回引くのに1.5秒以上かからない", chuuou(drawMs) < 1500,
  `中央値 ${chuuou(drawMs)}ms ／ 10連なら単純計算で ${(chuuou(drawMs) * 10 / 1000).toFixed(1)}秒`);

H("結果");

console.log(`\n  合格 ${ok} 件 ／ 不合格 ${ng} 件\n`);
if (ng > 0) {
  console.log("  ★不合格の項目");
  for (const l of LOG.filter((x) => !x.pass)) console.log(`     ${l.no}  ${l.title}\n        ${l.detail ?? ""}`);
  console.log("");
}

const OUT = join(ROOT, "docs", `final-e2e-${STAMP}.json`);
writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(),
  base: BASE,
  dbEnv: DB_ENV,
  tenantA, tenantB, userA, gMain,
  drawsTotal: hikiKaisu,
  first: { key: KEY1, before, after, result: draw1 },
  results: LOG,
  calls: CALLS,
}, null, 2));
console.log(`  記録： ${OUT}\n`);

process.exit(ng > 0 ? 1 : 0);
