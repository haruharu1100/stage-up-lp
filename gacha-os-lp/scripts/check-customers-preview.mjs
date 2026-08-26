/**
 * 会員管理の画面が「本当か」を、公開先（Preview）で確かめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具が答える問い
 * ═══════════════════════════════════════════════════════
 *
 *   ① 一覧の数字は、DBの中身と一致しているか
 *
 *      画面に会員が並んでいるだけでは、本物とは言えません。
 *      見本データでも、画面には同じように並びます。
 *      DBを直接数えて、1行ずつ突き合わせます。
 *
 *   ② 見せてはいけないものが、混ざっていないか
 *
 *      住所そのもの、伏せていないメール、
 *      見る権限のない人への金額。
 *      画面で隠すのは親切であって、守りではありません。
 *      入口を直接たたいて、そもそも渡っていないことを確かめます。
 *
 *   ③ 止めたら、本当に止まるか
 *
 *      「止めました」と画面に出るだけなら、それは絵です。
 *      止めたお客様が、開いていた画面から追い出されること、
 *      そのあと新しく入り直せないこと、
 *      戻したら、また入れるようになることまで確かめます。
 *
 *   ④ 危険度が、ダッシュボードとずれないか
 *
 *      同じ「危険なお客様の数」が2つの画面で違って出たら、
 *      運営の方には、どちらが本当か確かめる方法がありません。
 *
 * ═══════════════════════════════════════════════════════
 * ★書き込みます。接続先に気をつけてください
 * ═══════════════════════════════════════════════════════
 *
 *   点検のあいだ、お客様を一時的に止めて、戻します。
 *   ですので seed と同じ鍵をかけています。
 *   DATABASE_ENV が production なら、何もせず止まります。
 *
 *   ★止めっぱなしで終わらないこと。
 *     途中で落ちても最後に必ず戻すよう、後片づけを入れてあります。
 *
 * 使い方：
 *   npx tsx --env-file=.env.local scripts/check-customers-preview.mjs <Preview URL>
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { makePreviewClient } from "./lib/preview-client.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
const PW = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";

if (!BASE || !/^https:\/\//.test(BASE)) {
  console.error(
    "\n✗ Preview の URL を渡してください（https:// で始まるもの）。\n" +
      "  ★localhost を渡さないこと。localhost で通っても、\n" +
      "    公開先で通る保証にはなりません。\n",
  );
  process.exit(1);
}

const dbEnv = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (dbEnv === "production") {
  console.error("\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n");
  process.exit(1);
}
if (!(process.env.DATABASE_URL ?? "").trim()) {
  console.error("\n✗ DATABASE_URL がありません（npx vercel env pull .env.local）。\n");
  process.exit(1);
}

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const Hito = makePreviewClient({ base: BASE, password: PW, db });

/* ══════════════════════════════════════════════
   結果の入れもの
   ══════════════════════════════════════════════ */
const kekka = [];
let ima = "（未分類）";

function group(name) {
  ima = name;
  console.log(`\n━━ ${name}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    kekka.push({ group: ima, name, ok: true, detail: detail ?? "" });
    console.log(`  ✓ ${name}${detail ? `  … ${detail}` : ""}`);
    return true;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    kekka.push({ group: ima, name, ok: false, detail: why });
    console.log(`  ✗ ${name}`);
    for (const line of why.split("\n").slice(0, 6)) console.log(`      ${line}`);
    return false;
  }
}

function eq(a, b, why) {
  if (a !== b) throw new Error(`${why}\n  期待：${b}\n  実際：${a}`);
}
function must(joken, why) {
  if (!joken) throw new Error(why);
}

async function tenantIdOf(code) {
  const t = await db().execute({ sql: "SELECT id FROM tenants WHERE code = ?", args: [code] });
  must(t.rows[0], `会社 ${code} がありません`);
  return String(t.rows[0].id);
}

/** 一覧を1回読む。読めなければ、その場で止める（0件で続けない） */
async function listOf(h, qs = "") {
  const r = await h.call(`/api/console/customers${qs}`);
  if (r.status !== 200 || !r.json?.ok) {
    throw new Error(`一覧が読めません（${r.status}：${JSON.stringify(r.json).slice(0, 200)}）`);
  }
  return r.json;
}

async function detailOf(h, customerId) {
  return h.call(`/api/console/customers?id=${encodeURIComponent(customerId)}`);
}

async function act(h, action, customerId, reason) {
  return h.call("/api/console/customers/action", "POST", { action, customerId, reason });
}

console.log(`\n公開先：${BASE}\n`);

const A_TID = await tenantIdOf("DEMO");
const B_TID = await tenantIdOf("KANSA");

const aBoss = new Hito("A社の管理者");
const bBoss = new Hito("B社の管理者");

/* 点検で止めるお客様。★最後に必ず戻します */
const MATO_MAIL = "user5@demo.example";
let MATO_ID = null;

/* ══════════════════════════════════════════════
   ① 一覧が、DBの中身と一致する
   ══════════════════════════════════════════════ */

group("① 一覧の数字が、DBの中身と1行ずつ一致する");

let aList = null;

await check("A社の管理者で入って、一覧を読める", async () => {
  const r = await aBoss.login("ADMIN", "DEMO", "boss@demo.example");
  must(r.status === 200 && r.json?.ok, `入れません（${r.status}）`);
  aList = await listOf(aBoss);
  return `${aList.total}名`;
});

await check("一覧の件数が、DBのA社の会員数と一致する", async () => {
  const c = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?",
    args: [A_TID],
  });
  eq(aList.total, Number(c.rows[0].n), "一覧の件数が、DBの会員数と違います");
  eq(aList.counts.all, Number(c.rows[0].n), "「会員数（全体）」が、DBの会員数と違います");
  return `どちらも ${aList.total}名`;
});

await check("保有ポイント・使った金額・引いた回数が、全行でDBと一致する", async () => {
  const rows = await db().execute({
    sql: `SELECT c.id, c.points, c.spent, c.status,
                 (SELECT COUNT(*) FROM draws d
                   WHERE d.tenant_id = c.tenant_id AND d.user_id = c.id) AS plays
            FROM customers c WHERE c.tenant_id = ?`,
    args: [A_TID],
  });
  const byId = new Map(rows.rows.map((r) => [String(r.id), r]));

  for (const c of aList.customers) {
    const d = byId.get(c.id);
    must(d, `一覧に出ている ${c.displayId} が、DBにありません`);
    eq(c.points, Number(d.points), `${c.displayId} の保有ポイントが違います`);
    eq(c.plays, Number(d.plays), `${c.displayId} の引いた回数が違います`);
    eq(c.statusRaw, String(d.status), `${c.displayId} の状態が違います`);
    /* ★金額は「見せてよい人」で読んでいるので、必ず数で来るはず */
    must(c.spent !== null, `${c.displayId} の使った金額が null です（SUPER_ADMIN は見えるはず）`);
    eq(c.spent, Number(d.spent), `${c.displayId} の使った金額が違います`);
  }
  return `${aList.customers.length}行すべて一致`;
});

await check("状態の内訳（通常・停止中）が、DBの数と一致する", async () => {
  const r = await db().execute({
    sql: `SELECT
            SUM(CASE WHEN status = 'ACTIVE'    THEN 1 ELSE 0 END) AS a,
            SUM(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END) AS s
          FROM customers WHERE tenant_id = ?`,
    args: [A_TID],
  });
  eq(aList.counts.active, Number(r.rows[0].a ?? 0), "通常の人数が、DBと違います");
  eq(aList.counts.suspended, Number(r.rows[0].s ?? 0), "停止中の人数が、DBと違います");
  return `通常 ${aList.counts.active}名／停止中 ${aList.counts.suspended}名`;
});

await check("ポイントが履歴と合っていない人の数が、DBの数と一致する", async () => {
  /* ★この数が合わないと、「帳簿が合っていない」という
       いちばん重い知らせが、静かに消えます */
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM customers c
           WHERE c.tenant_id = ?
             AND c.points <> (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
                               WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id)`,
    args: [A_TID],
  });
  eq(aList.counts.mismatch, Number(r.rows[0].n), "食い違いの人数が、DBと違います");
  return `${aList.counts.mismatch}名`;
});

/* ══════════════════════════════════════════════
   ② 見せてはいけないものが、渡っていない
   ══════════════════════════════════════════════ */

group("② 住所・メール・金額が、渡してよい人にだけ渡っている");

await check("一覧では、メールが必ず伏せ字になっている", async () => {
  const nama = await db().execute({
    sql: "SELECT email FROM customers WHERE tenant_id = ? AND email IS NOT NULL",
    args: [A_TID],
  });
  const namaSet = new Set(nama.rows.map((r) => String(r.email)));
  for (const c of aList.customers) {
    if (c.emailMasked === null) continue;
    must(
      !namaSet.has(c.emailMasked),
      `${c.displayId} のメールが、伏せずにそのまま出ています`,
    );
    must(c.emailMasked.includes("*"), `${c.displayId} のメールが伏せ字になっていません`);
  }
  return `${aList.customers.length}行すべて伏せ字`;
});

await check("一覧にも詳細にも、住所そのものが入っていない", async () => {
  /* ★住所は発送管理で見るものです。
       会員管理は「誰か」を見る画面なので、ここには要りません。
       要らないものを渡さないのが、いちばん確実な守りです */
  const juusho = await db().execute({
    sql: "SELECT id, address FROM customers WHERE tenant_id = ? AND address IS NOT NULL AND address <> ''",
    args: [A_TID],
  });
  must(juusho.rows.length > 0, "住所が入っている会員が1人もいません（点検になりません）");

  const listText = JSON.stringify(aList);
  for (const r of juusho.rows) {
    must(
      !listText.includes(String(r.address)),
      "一覧の中に、住所そのものが入っています",
    );
  }

  const one = String(juusho.rows[0].id);
  const d = await detailOf(aBoss, one);
  must(d.status === 200 && d.json?.ok, `詳細が読めません（${d.status}）`);
  const detailText = JSON.stringify(d.json);
  must(
    !detailText.includes(String(juusho.rows[0].address)),
    "詳細の中に、住所そのものが入っています",
  );
  must(d.json.customer.hasAddress === true, "お届け先があるのに、無いことになっています");
  return `住所のある ${juusho.rows.length}名ぶん、どこにも出ていない`;
});

const YAKUWARI = [
  { mail: "etsuran@demo.example", role: "VIEWER", money: false, suspend: false },
  { mail: "support@demo.example", role: "SUPPORT", money: false, suspend: false },
  { mail: "security@demo.example", role: "SECURITY", money: false, suspend: true },
  { mail: "unei@demo.example", role: "OPERATOR", money: true, suspend: false },
  { mail: "keiri@demo.example", role: "FINANCE", money: true, suspend: false },
  { mail: "boss@demo.example", role: "SUPER_ADMIN", money: true, suspend: true },
];

const hitoByRole = new Map();

for (const y of YAKUWARI) {
  await check(
    `${y.role}：会員は見られる／金額は${y.money ? "見える" : "見えない"}／停止は${y.suspend ? "できる" : "できない"}`,
    async () => {
      const h = new Hito(y.role);
      const r = await h.login("ADMIN", "DEMO", y.mail);
      must(r.status === 200 && r.json?.ok, `入れません（${r.status}）`);
      hitoByRole.set(y.role, h);

      const l = await listOf(h);
      /* ★6役割ぜんぶが、会員そのものは見られること */
      must(l.total > 0, `${y.role} が、会員を1人も見られません`);
      eq(l.canSeeMoney, y.money, `${y.role} の canSeeMoney が違います`);
      eq(l.canSuspend, y.suspend, `${y.role} の canSuspend が違います`);

      for (const c of l.customers) {
        if (y.money) {
          must(c.spent !== null, `${y.role} に金額が渡っていません`);
        } else {
          /* ★0 で来ていないこと。0 で来た瞬間、画面は「1円も使っていない」と読みます */
          must(
            c.spent === null,
            `${y.role} に金額が ${c.spent} として渡っています（null であるべき）`,
          );
        }
      }
      return `${l.total}名見えて、金額は ${y.money ? "数字" : "null"}`;
    },
  );
}

await check("金額を見られない人には、詳細でも金額を渡していない", async () => {
  const h = hitoByRole.get("SUPPORT");
  must(h, "SUPPORT で入れていません");
  const one = aList.customers[0];
  const d = await detailOf(h, one.id);
  must(d.status === 200 && d.json?.ok, `詳細が読めません（${d.status}）`);
  eq(d.json.customer.spent, null, "金額を見られない人に、詳細で金額が渡っています");
  for (const o of d.json.customer.orders ?? []) {
    eq(o.total, null, "金額を見られない人に、注文の合計が渡っています");
  }
  return "一覧も詳細も null";
});

await check("ログインしていない人は、一覧を1件も読めない", async () => {
  const h = new Hito("匿名");
  const r = await h.call("/api/console/customers");
  must(r.status === 401 || r.status === 403, `断られていません（${r.status}）`);
  return `${r.status} で断られた`;
});

/* ══════════════════════════════════════════════
   ③ 危険度が、ダッシュボードとずれない
   ══════════════════════════════════════════════ */

group("③ 危険度・会員数が、ダッシュボードとずれない");

await check("会員数が、ダッシュボードの数字と一致する", async () => {
  const s = await aBoss.call("/api/console/summary");
  must(s.status === 200 && s.json?.ok, `集計が読めません（${s.status}）`);
  eq(
    aList.counts.all,
    s.json.customersTotal,
    "ダッシュボードの「会員数」と、会員管理の全体人数が違います",
  );
  return `どちらも ${aList.counts.all}名`;
});

await check("危険度の高い人の数が、ダッシュボードの数字と一致する", async () => {
  const s = await aBoss.call("/api/console/summary");
  /* ★null（見せられない）と 0（本当に0人）を混ぜないこと */
  must(s.json.fraudHighRisk !== null, "管理者なのに、高リスク人数が見られません");
  eq(
    aList.counts.highRisk,
    s.json.fraudHighRisk,
    "ダッシュボードの「高リスク会員」と、会員管理の危険度（高）の人数が違います",
  );
  return `どちらも ${aList.counts.highRisk}名`;
});

await check("危険度は、未処理の不正の手がかりだけから作られている", async () => {
  const r = await db().execute({
    sql: `SELECT COUNT(DISTINCT user_id) AS n FROM fraud_flags
           WHERE tenant_id = ? AND status = 'OPEN' AND severity = 'HIGH'`,
    args: [A_TID],
  });
  eq(aList.counts.highRisk, Number(r.rows[0].n), "危険度（高）の人数が、DBの未処理の手がかりと違います");
  return `未処理の手がかり（高）を持つ人 ${aList.counts.highRisk}名`;
});

await check("ポイントの食い違いを、危険度に混ぜていない", async () => {
  /* ★混ぜると、「帳簿のずれ」と「不正の疑い」が
       同じ言葉になり、どちらを先に見るか決められません */
  const chigau = aList.customers.filter((c) => c.ledgerMismatch);
  for (const c of chigau) {
    if (c.riskOpenCount === 0) {
      eq(c.risk, "NONE", `${c.displayId}：食い違いだけで、危険度が付いています`);
    }
  }
  return `食い違い ${chigau.length}名を確かめた`;
});

/* ══════════════════════════════════════════════
   ④ 検索と絞り込みが、サーバー側で効く
   ══════════════════════════════════════════════ */

group("④ 検索と絞り込みが、サーバー側で効く");

await check("会員番号でさがすと、その人だけが返る", async () => {
  const one = aList.customers[0];
  const l = await listOf(aBoss, `?q=${encodeURIComponent(one.displayId)}`);
  eq(l.customers.length, 1, `${one.displayId} でさがして、1名になりません`);
  eq(l.customers[0].id, one.id, "違う会員が返ってきました");
  return `${one.displayId} で1名`;
});

await check("お名前の一部でさがすと、DBで数えた件数と一致する", async () => {
  const one = await db().execute({
    sql: "SELECT name FROM customers WHERE tenant_id = ? ORDER BY created_at LIMIT 1",
    args: [A_TID],
  });
  must(one.rows[0], "会員が1人もいません");
  const kake = String(one.rows[0].name).slice(0, 2);

  const c = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM customers
           WHERE tenant_id = ? AND LOWER(name) LIKE ?`,
    args: [A_TID, `%${kake.toLowerCase()}%`],
  });
  const l = await listOf(aBoss, `?q=${encodeURIComponent(kake)}`);
  must(
    l.customers.length >= Number(c.rows[0].n),
    `「${kake}」でしぼった件数が、お名前で数えた数より少ないです`,
  );
  return `「${kake}」で ${l.customers.length}名`;
});

await check("しぼり込んでも、会員数（全体）は減らない", async () => {
  /* ★ここが減ると、さがしている最中に
       「会員が消えた」と読めてしまいます */
  const l = await listOf(aBoss, "?status=SUSPENDED");
  eq(l.counts.all, aList.counts.all, "しぼり込んだら、会員数（全体）まで減りました");
  return `しぼり込み後も 全体 ${l.counts.all}名`;
});

await check("状態でしぼると、その状態の人だけが返る", async () => {
  const l = await listOf(aBoss, "?status=ACTIVE");
  for (const c of l.customers) eq(c.status, "ACTIVE", "通常でない人が混ざっています");
  eq(l.customers.length, aList.counts.active, "通常の人数が、内訳と違います");
  return `通常 ${l.customers.length}名`;
});

await check("危険度でしぼると、その危険度の人だけが返る", async () => {
  const l = await listOf(aBoss, "?risk=HIGH");
  for (const c of l.customers) eq(c.risk, "HIGH", "危険度が高くない人が混ざっています");
  eq(l.customers.length, aList.counts.highRisk, "危険度（高）の人数が、内訳と違います");
  /* ★0名でも、それは失敗ではありません。
       いまの仕組みは不正の手がかりを自動では作らないので、
       手がかりが1件も無ければ 0名が正しい答えです */
  return l.customers.length === 0
    ? "0名（不正の手がかりが1件も無いため。これは正しい）"
    : `${l.customers.length}名`;
});

await check("食い違いだけにしぼると、合っている人が混ざらない", async () => {
  const l = await listOf(aBoss, "?mismatch=1");
  for (const c of l.customers) {
    must(c.ledgerMismatch, `${c.displayId} は合っているのに、混ざっています`);
  }
  eq(l.customers.length, aList.counts.mismatch, "食い違いの人数が、内訳と違います");
  return `${l.customers.length}名`;
});

/* ══════════════════════════════════════════════
   ⑤ 詳細が、9つの中身をそろえて返す
   ══════════════════════════════════════════════ */

group("⑤ 会員の詳細が、9つの中身をそろえて返す");

await check("詳細に、9つの中身がすべて入っている", async () => {
  const one = aList.customers[0];
  const d = await detailOf(aBoss, one.id);
  must(d.status === 200 && d.json?.ok, `詳細が読めません（${d.status}）`);
  const c = d.json.customer;

  /* ①会員情報 ②ポイント ③引いた記録 ④獲得景品 ⑤注文
     ⑥発送 ⑦問い合わせ ⑧危険度の手がかり ⑨ログイン履歴 */
  for (const k of ["draws", "prizes", "orders", "shipments", "tickets", "ledger", "flags", "logins"]) {
    must(Array.isArray(c[k]), `${k} が配列で来ていません`);
  }
  must(typeof c.name === "string" && c.name !== "", "お名前が入っていません");
  must(typeof c.points === "number", "保有ポイントが数で来ていません");
  must(typeof c.limit === "number" && c.limit > 0, "一度に読む上限が来ていません");
  must(typeof c.loginsKnown === "boolean", "ログイン履歴を引けたかどうかが来ていません");
  return `9つそろい・一度に読む上限 ${c.limit}件`;
});

await check("詳細では、開いた1人ぶんだけメールが全部見える", async () => {
  const target = aList.customers.find((c) => c.emailMasked !== null);
  must(target, "メールのある会員がいません");
  const d = await detailOf(aBoss, target.id);
  const c = d.json.customer;
  must(c.email !== null && c.email.includes("@"), "詳細でメールが読めません");
  must(!c.email.includes("*"), "詳細のメールが伏せ字のままです");
  return "詳細だけ全部・一覧は伏せ字";
});

await check("メールが無い会員のログイン記録を、0件と言い切らない", async () => {
  const nashi = await db().execute({
    sql: "SELECT id FROM customers WHERE tenant_id = ? AND (email IS NULL OR email = '') LIMIT 1",
    args: [A_TID],
  });
  if (!nashi.rows[0]) return "メールの無い会員がいないため、この点検は該当なし";
  const d = await detailOf(aBoss, String(nashi.rows[0].id));
  eq(d.json.customer.loginsKnown, false, "メールが無いのに、ログイン記録を引けたことになっています");
  return "「引けない」と正しく答えている（0件とは言っていない）";
});

/* ══════════════════════════════════════════════
   ⑥ 他社の会員は、見つからないし、動かせない
   ══════════════════════════════════════════════ */

group("⑥ 他社の会員は、見つからないし、動かせない（双方向）");

await check("B社の管理者で入れる", async () => {
  const r = await bBoss.login("ADMIN", "KANSA", "b-boss@kansa.example");
  must(r.status === 200 && r.json?.ok, `入れません（${r.status}）`);
  return "入れた";
});

await check("A社の一覧に、B社の会員が1人も混ざらない", async () => {
  const bIds = await db().execute({
    sql: "SELECT id FROM customers WHERE tenant_id = ?",
    args: [B_TID],
  });
  const bSet = new Set(bIds.rows.map((r) => String(r.id)));
  for (const c of aList.customers) {
    must(!bSet.has(c.id), `A社の一覧に、B社の ${c.displayId} が出ています`);
  }
  return `B社 ${bSet.size}名は、1人も出なかった`;
});

await check("B社の一覧に、A社の会員が1人も混ざらない", async () => {
  const aIds = await db().execute({
    sql: "SELECT id FROM customers WHERE tenant_id = ?",
    args: [A_TID],
  });
  const aSet = new Set(aIds.rows.map((r) => String(r.id)));
  const l = await listOf(bBoss);
  for (const c of l.customers) {
    must(!aSet.has(c.id), `B社の一覧に、A社の ${c.displayId} が出ています`);
  }
  return `A社 ${aSet.size}名は、1人も出なかった`;
});

let aAnyCustomer = null;

await check("B社の管理者が、A社の会員の中身を開けない（404）", async () => {
  aAnyCustomer = aList.customers[0];
  const r = await detailOf(bBoss, aAnyCustomer.id);
  eq(r.status, 404, "他社の会員の中身が読めてしまいました");
  /* ★「他社の会員です」と教えないこと。
       有る無しを答えるだけで、他社の中身が推測できます */
  const msg = String(r.json?.message ?? "");
  must(!msg.includes("他社") && !msg.includes("DEMO"), `断り文が、他社の存在を漏らしています：${msg}`);
  return "404、しかも理由を漏らしていない";
});

await check("B社の管理者が、A社の会員を止められない（404）", async () => {
  const r = await act(bBoss, "suspend", aAnyCustomer.id, "他社からの操作の点検");
  eq(r.status, 404, "他社の会員を止められてしまいました");

  const st = await db().execute({
    sql: "SELECT status FROM customers WHERE id = ?",
    args: [aAnyCustomer.id],
  });
  must(String(st.rows[0].status) !== "SUSPENDED", "断られたのに、止まっています");
  return "404 で断られ、状態も変わっていない";
});

/* ══════════════════════════════════════════════
   ⑦ 止めたら、本当に止まる
   ══════════════════════════════════════════════ */

group("⑦ 止めたら本当に止まり、戻したら本当に戻る");

async function statusOf(customerId) {
  const r = await db().execute({
    sql: "SELECT status FROM customers WHERE id = ?",
    args: [customerId],
  });
  return String(r.rows[0]?.status ?? "");
}

async function auditCount(action) {
  const r = await db().execute({
    /* ★表の名前は audit_events です（audit_log ではありません） */
    sql: `SELECT COUNT(*) AS n FROM audit_events
           WHERE tenant_id = ? AND action = ? AND target = ?`,
    args: [A_TID, action, `customer:${MATO_ID}`],
  });
  return Number(r.rows[0].n);
}

const okyaku = new Hito("止められるお客様");

await check("点検の対象になるお客様が、いまは普通に入れる", async () => {
  const row = await db().execute({
    sql: "SELECT id, display_id, status FROM customers WHERE tenant_id = ? AND email = ? LIMIT 1",
    args: [A_TID, MATO_MAIL],
  });
  must(row.rows[0], `${MATO_MAIL} が見つかりません`);
  MATO_ID = String(row.rows[0].id);

  /* 前回の点検が途中で落ちていたら、まず戻す */
  if (String(row.rows[0].status) === "SUSPENDED") {
    await act(aBoss, "resume", MATO_ID, "前回の点検が途中で終わっていたため戻す");
  }

  const r = await okyaku.login("CUSTOMER", "DEMO", MATO_MAIL);
  must(r.status === 200 && r.json?.ok, `お客様が入れません（${r.status}）`);

  const p = await okyaku.call("/api/customer/points");
  must(p.status === 200, `入ったのに、自分の画面が読めません（${p.status}）`);
  return `${row.rows[0].display_id} は、いま入れている`;
});

await check("理由を書かない停止は、断られる（400）", async () => {
  const r = await act(aBoss, "suspend", MATO_ID, "");
  eq(r.status, 400, `断られ方が違います（${r.status}）`);
  eq(r.json?.code, "NO_REASON", `理由が違います（${r.json?.code}）`);
  eq(await statusOf(MATO_ID), "ACTIVE", "断られたのに、止まっています");
  return "400 NO_REASON、状態も変わらない";
});

await check("止める権限のない役割は、止められない（403）", async () => {
  const dame = [];
  for (const role of ["VIEWER", "SUPPORT", "OPERATOR", "FINANCE"]) {
    const h = hitoByRole.get(role);
    must(h, `${role} で入れていません`);
    const r = await act(h, "suspend", MATO_ID, "権限のない人が止められるかの点検");
    if (r.status !== 403) dame.push(`${role} が ${r.status} で通ってしまいました`);
  }
  must(dame.length === 0, dame.join("\n"));
  eq(await statusOf(MATO_ID), "ACTIVE", "断られたのに、止まっています");
  return "4役割すべて 403、状態も変わっていない";
});

let auditMae = 0;

await check("理由をつけて止めると、状態と監査ログが変わる", async () => {
  auditMae = await auditCount("CUSTOMER_SUSPEND");

  const r = await act(aBoss, "suspend", MATO_ID, "点検のため一時的に停止します");
  must(r.status === 200 && r.json?.ok, `止められません（${r.status}：${JSON.stringify(r.json).slice(0, 200)}）`);
  eq(await statusOf(MATO_ID), "SUSPENDED", "止めたのに、状態が変わっていません");
  eq(await auditCount("CUSTOMER_SUSPEND"), auditMae + 1, "止めたのに、監査ログに残っていません");

  const log = await db().execute({
    sql: `SELECT reason, before_text, after_text FROM audit_events
           WHERE tenant_id = ? AND action = 'CUSTOMER_SUSPEND' AND target = ?
           ORDER BY seq DESC LIMIT 1`,
    args: [A_TID, `customer:${MATO_ID}`],
  });
  eq(String(log.rows[0].reason), "点検のため一時的に停止します", "止めた理由が残っていません");
  eq(String(log.rows[0].before_text), "利用中", "止める前の状態が残っていません");
  eq(String(log.rows[0].after_text), "停止中", "止めたあとの状態が残っていません");
  return "状態 ACTIVE→SUSPENDED、理由も前後も残った";
});

await check("止めたお客様は、開いていた画面からも追い出される", async () => {
  /* ★ここが本番です。
       「止めました」と出るだけで、開いている画面が動き続けるなら、
       止めたことになりません */
  const p = await okyaku.call("/api/customer/points");
  must(p.status === 401 || p.status === 403, `追い出されていません（${p.status}）`);

  const nokori = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM sessions WHERE tenant_id = ? AND subject_id = ?`,
    args: [A_TID, MATO_ID],
  });
  eq(Number(nokori.rows[0].n), 0, "止めたのに、開いたままの画面が残っています");
  return `${p.status} で追い出され、残っている画面も0`;
});

await check("止めたお客様は、入り直すこともできない", async () => {
  const h = new Hito("止められたお客様");
  const r = await h.login("CUSTOMER", "DEMO", MATO_MAIL);
  must(r.status !== 200 || !r.json?.ok, "止めたはずのお客様が、入り直せてしまいました");
  return `${r.status} で入れない`;
});

await check("一覧でも、その人が停止中になっている", async () => {
  const l = await listOf(aBoss, `?q=${encodeURIComponent(MATO_MAIL.split("@")[0])}`);
  const c = l.customers.find((x) => x.id === MATO_ID);
  must(c, "止めた会員が、一覧から消えました");
  eq(c.status, "SUSPENDED", "一覧の状態が変わっていません");
  eq(l.counts.suspended, aList.counts.suspended + 1, "停止中の人数が増えていません");
  return `停止中 ${aList.counts.suspended}→${l.counts.suspended}名`;
});

await check("停止でしぼると、その人が出てくる", async () => {
  const l = await listOf(aBoss, "?status=SUSPENDED");
  must(l.customers.some((x) => x.id === MATO_ID), "停止でしぼったのに、出てきません");
  return `停止中 ${l.customers.length}名の中にいる`;
});

await check("すでに止まっている人を、黙ってもう一度止めない（409）", async () => {
  const mae = await auditCount("CUSTOMER_SUSPEND");
  const r = await act(aBoss, "suspend", MATO_ID, "二重に止められるかの点検");
  eq(r.status, 409, `断られ方が違います（${r.status}）`);
  eq(r.json?.code, "SAME_VALUE", `理由が違います（${r.json?.code}）`);
  /* ★同じ記録が2行並ぶと、2回止めたと読み違えられます */
  eq(await auditCount("CUSTOMER_SUSPEND"), mae, "断られたのに、監査ログが増えています");
  return "409 SAME_VALUE、記録も増えていない";
});

await check("止めた記録が、担当者の停止と同じ名前で残っていない", async () => {
  /* ★担当者を止めても、管理画面に入れなくなるだけです。
       お客様を止めると、ガチャも発送依頼もできなくなります。
       重さの違うものを、同じ名前で数えないこと */
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM audit_events
           WHERE tenant_id = ? AND action = 'USER_SUSPEND' AND target LIKE 'customer:%'`,
    args: [A_TID],
  });
  eq(Number(r.rows[0].n), 0, "お客様の停止が、担当者の停止（USER_SUSPEND）として残っています");
  return "CUSTOMER_SUSPEND と USER_SUSPEND が分かれている";
});

await check("止めていない人の解除は、断られる（409）", async () => {
  const hoka = aList.customers.find((c) => c.id !== MATO_ID && c.status === "ACTIVE");
  must(hoka, "止まっていない会員が他にいません");
  const r = await act(aBoss, "resume", hoka.id, "止まっていない人を戻せるかの点検");
  eq(r.status, 409, `断られ方が違います（${r.status}）`);
  eq(r.json?.code, "SAME_VALUE", `理由が違います（${r.json?.code}）`);
  return "409 SAME_VALUE";
});

await check("停止を解除すると、状態が戻り、監査ログにも残る", async () => {
  const r = await act(aBoss, "resume", MATO_ID, "点検が終わったため停止を解除します");
  must(r.status === 200 && r.json?.ok, `戻せません（${r.status}：${JSON.stringify(r.json).slice(0, 200)}）`);
  eq(await statusOf(MATO_ID), "ACTIVE", "戻したのに、状態が変わっていません");
  eq(await auditCount("CUSTOMER_SUSPEND"), auditMae + 2, "戻したのに、監査ログに残っていません");

  const log = await db().execute({
    sql: `SELECT before_text, after_text FROM audit_events
           WHERE tenant_id = ? AND action = 'CUSTOMER_SUSPEND' AND target = ?
           ORDER BY seq DESC LIMIT 1`,
    args: [A_TID, `customer:${MATO_ID}`],
  });
  eq(String(log.rows[0].before_text), "停止中", "戻す前の状態が残っていません");
  eq(String(log.rows[0].after_text), "利用中", "戻したあとの状態が残っていません");
  return "状態 SUSPENDED→ACTIVE、記録も残った";
});

await check("戻したお客様は、また入れるようになる", async () => {
  const h = new Hito("戻ったお客様");
  const r = await h.login("CUSTOMER", "DEMO", MATO_MAIL);
  must(r.status === 200 && r.json?.ok, `戻したのに、入れません（${r.status}）`);
  const p = await h.call("/api/customer/points");
  must(p.status === 200, `入れたのに、自分の画面が読めません（${p.status}）`);
  return "入れて、自分の画面も読める";
});

await check("セキュリティ担当も、止めて戻せる", async () => {
  const h = hitoByRole.get("SECURITY");
  must(h, "SECURITY で入れていません");
  const r1 = await act(h, "suspend", MATO_ID, "セキュリティ担当が止められるかの点検");
  must(r1.status === 200 && r1.json?.ok, `セキュリティ担当が止められません（${r1.status}）`);
  const r2 = await act(h, "resume", MATO_ID, "点検が終わったため戻す");
  must(r2.status === 200 && r2.json?.ok, `セキュリティ担当が戻せません（${r2.status}）`);
  eq(await statusOf(MATO_ID), "ACTIVE", "戻し切れていません");
  return "止めて戻せた";
});

/* ══════════════════════════════════════════════
   ⑧ 操作すると、数字が動く
   ══════════════════════════════════════════════ */

group("⑧ 実際に1回引くと、会員管理の数字が動く");

await check("お客様が1回引くと、その人の引いた回数と保有ポイントが動く", async () => {
  const g = await db().execute({
    sql: `SELECT id, price FROM gachas
           WHERE tenant_id = ? AND status = 'PUBLISHED' AND left_count > 0
           ORDER BY price ASC LIMIT 1`,
    args: [A_TID],
  });
  must(g.rows[0], "引けるガチャ（公開中・残りあり）が1本もありません");

  const kyaku = new Hito("引く人");
  const rl = await kyaku.login("CUSTOMER", "DEMO", "user1@demo.example");
  must(rl.status === 200 && rl.json?.ok, `お客様が入れません（${rl.status}）`);

  const me = await db().execute({
    sql: "SELECT id FROM customers WHERE tenant_id = ? AND email = ? LIMIT 1",
    args: [A_TID, "user1@demo.example"],
  });
  const myId = String(me.rows[0].id);

  const mae = (await listOf(aBoss)).customers.find((x) => x.id === myId);
  must(mae, "引く前の一覧に、その会員が出ていません");

  const { randomUUID } = await import("node:crypto");
  const r = await kyaku.call("/api/console/draw", "POST", { gachaId: String(g.rows[0].id) }, {
    "Idempotency-Key": `custcheck-${randomUUID()}`,
  });
  must(r.status === 200 && r.json?.ok, `引けません（${r.status}：${JSON.stringify(r.json).slice(0, 160)}）`);

  const ato = (await listOf(aBoss)).customers.find((x) => x.id === myId);
  eq(ato.plays, mae.plays + 1, "引いたのに、引いた回数が増えていません");
  must(ato.points !== mae.points, "引いたのに、保有ポイントが変わっていません");
  return `引いた回数 ${mae.plays}→${ato.plays} ／ 保有 ${mae.points}→${ato.points}pt`;
});

await check("引いた記録が、その人の詳細にも出てくる", async () => {
  const me = await db().execute({
    sql: "SELECT id FROM customers WHERE tenant_id = ? AND email = ? LIMIT 1",
    args: [A_TID, "user1@demo.example"],
  });
  const d = await detailOf(aBoss, String(me.rows[0].id));
  must(d.status === 200 && d.json?.ok, `詳細が読めません（${d.status}）`);
  must(d.json.customer.draws.length > 0, "引いたのに、詳細に記録が出ていません");
  const ichiban = d.json.customer.draws[0];
  must(ichiban.at, "引いた日時が残っていません");
  return `新しい順で ${d.json.customer.draws.length}件・最新は ${String(ichiban.at).slice(0, 19)}`;
});

await check("一覧を2回続けて読んでも、同じ数が返る（古い答えを返していない）", async () => {
  const a = await listOf(aBoss);
  const b = await listOf(aBoss);
  eq(a.total, b.total, "同じことを2回聞いて、人数が違いました");
  for (let i = 0; i < a.customers.length; i += 1) {
    eq(a.customers[i].points, b.customers[i].points, "同じことを2回聞いて、保有ポイントが違いました");
  }
  return "2回とも同じ";
});

/* ══════════════════════════════════════════════
   ⑨ 後片づけ
   ══════════════════════════════════════════════ */

group("⑨ 後片づけ");

await check("点検で止めたお客様が、戻っている", async () => {
  if (!MATO_ID) return "止めた人がいないため、片づけるものなし";
  const now = await statusOf(MATO_ID);
  if (now === "SUSPENDED") {
    const r = await act(aBoss, "resume", MATO_ID, "点検が終わったため戻す（後片づけ）");
    must(r.status === 200 && r.json?.ok, `戻せません（${r.status}）`);
  }
  eq(await statusOf(MATO_ID), "ACTIVE", "★止めっぱなしで終わっています。手で戻してください");
  return "ACTIVE に戻っている";
});

/* ══════════════════════════════════════════════
   まとめ
   ══════════════════════════════════════════════ */

const ng = kekka.filter((k) => !k.ok);
console.log(
  `\n━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `  合計 ${kekka.length}項目 ／ 通った ${kekka.length - ng.length} ／ だめ ${ng.length}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
);

if (ng.length > 0) {
  console.log("\n通らなかったもの：");
  for (const k of ng) console.log(`  ✗ [${k.group}] ${k.name}\n      ${k.detail.split("\n")[0]}`);
  process.exit(1);
}

console.log("\n✓ 会員管理は、公開先で実際に動き、他の画面ともずれていません。\n");
