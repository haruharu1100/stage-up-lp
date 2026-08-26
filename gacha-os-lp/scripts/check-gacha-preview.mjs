/**
 * ガチャ管理の画面が「本当か」を、公開先（Preview）で確かめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具が答える問い
 * ═══════════════════════════════════════════════════════
 *
 *   ① 一覧の11列は、DBの中身と一致しているか
 *
 *      画面に数字が出ているだけでは、本物とは言えません。
 *      見本の数字でも、画面には同じように出ます。
 *      DBを直接数えて、1行ずつ突き合わせます。
 *
 *   ② 押したら、本当に変わるか
 *
 *      検証 → 公開 → 停止 → 再開 を、実際に順番に押します。
 *      押したあとDBを見て、状態が変わっていることを確かめます。
 *      変わらなければ、それは絵です。
 *
 *   ③ 断るべきものを、本当に断るか
 *
 *      検証していないガチャの公開・理由なしの公開・
 *      他社のガチャの操作・権限のない人の公開。
 *      画面でボタンを隠すのは親切であって、守りではありません。
 *      入口を直接たたいて、断られることを確かめます。
 *
 *   ④ 還元率が、還元率の画面とずれないか
 *
 *      同じガチャの還元率が、2つの画面で違って出たら、
 *      運営の方には、どちらが本当か確かめる方法がありません。
 *      2026-08-26、画面に 88.0％ と出ているのに、
 *      実際にお客様へ返っていたのは 18.23％ でした。
 *
 * ═══════════════════════════════════════════════════════
 * ★書き込みます。接続先に気をつけてください
 * ═══════════════════════════════════════════════════════
 *
 *   点検用のガチャを1本作り、公開し、止めて、再開します。
 *   ですので seed と同じ鍵をかけています。
 *   DATABASE_ENV が production なら、何もせず止まります。
 *
 * 使い方：
 *   npx tsx --env-file=.env.local scripts/check-gacha-preview.mjs <Preview URL>
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
const { createGacha } = await import(`${ROOT}/lib/server/seed.ts`);
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
  const r = await h.call(`/api/console/gachas${qs}`);
  if (r.status !== 200 || !r.json?.ok) {
    throw new Error(`一覧が読めません（${r.status}：${JSON.stringify(r.json).slice(0, 200)}）`);
  }
  return r.json;
}

async function act(h, action, gachaId, reason) {
  return h.call("/api/console/gachas/action", "POST", { action, gachaId, reason });
}

console.log(`\n公開先：${BASE}\n`);

const A_TID = await tenantIdOf("DEMO");
const B_TID = await tenantIdOf("KANSA");

const aBoss = new Hito("A社の管理者");
const bBoss = new Hito("B社の管理者");

/* ══════════════════════════════════════════════
   ① 一覧が、DBの中身と一致する
   ══════════════════════════════════════════════ */

group("① 一覧の数字が、DBの中身と1行ずつ一致する");

let aList = null;

await check("A社の管理者で入って、一覧を読める", async () => {
  const r = await aBoss.login("ADMIN", "DEMO", "boss@demo.example");
  must(r.status === 200 && r.json?.ok, `入れません（${r.status}）`);
  aList = await listOf(aBoss);
  return `${aList.total}本`;
});

await check("一覧の件数が、DBのA社のガチャ本数と一致する", async () => {
  const c = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM gachas WHERE tenant_id = ?",
    args: [A_TID],
  });
  eq(aList.total, Number(c.rows[0].n), "一覧の件数が、DBの本数と違います");
  return `どちらも ${aList.total}本`;
});

await check("価格・総口数・残口数・売上が、全行でDBと一致する", async () => {
  const rows = await db().execute({
    sql: `SELECT id, price, total, left_count, revenue, status FROM gachas WHERE tenant_id = ?`,
    args: [A_TID],
  });
  const byId = new Map(rows.rows.map((r) => [String(r.id), r]));

  for (const g of aList.gachas) {
    const d = byId.get(g.id);
    must(d, `一覧に出ている ${g.id} が、DBにありません`);
    eq(g.price, Number(d.price), `${g.title} の価格が違います`);
    eq(g.total, Number(d.total), `${g.title} の総口数が違います`);
    eq(g.leftCount, Number(d.left_count), `${g.title} の残口数が違います`);
    eq(g.status, String(d.status), `${g.title} の状態が違います`);
    /* ★売上は「見せてよい人」で読んでいるので、必ず数で来るはず */
    must(g.revenue !== null, `${g.title} の売上が null です（SUPER_ADMIN は見えるはず）`);
    eq(g.revenue, Number(d.revenue), `${g.title} の売上が違います`);
  }
  return `${aList.gachas.length}行すべて一致`;
});

await check("公開日時を、作った日で埋めていない", async () => {
  /* ★ここが埋まっていたら、それは「記録」ではなく「作り話」です。
       作った日と公開した日は、違います。 */
  const rows = await db().execute({
    sql: `SELECT id, title, created_at, published_at FROM gachas WHERE tenant_id = ?`,
    args: [A_TID],
  });
  let umeta = 0;
  for (const r of rows.rows) {
    if (r.published_at && String(r.published_at) === String(r.created_at)) umeta += 1;
  }
  eq(umeta, 0, "作った日を、そのまま公開日時として入れているガチャがあります");

  const fumei = aList.gachas.filter((g) => g.publishedAt === null && g.status !== "DRAFT").length;
  return `作った日で埋めたもの 0本 ／ 記録が無く「不明」と出るもの ${fumei}本`;
});

/* ══════════════════════════════════════════════
   ② 売上は、見せてよい人にだけ
   ══════════════════════════════════════════════ */

group("② 売上が、見せてよい人にだけ出る（0円に化けていない）");

const YAKUWARI = [
  { mail: "etsuran@demo.example", role: "VIEWER", revenue: false },
  { mail: "support@demo.example", role: "SUPPORT", revenue: false },
  { mail: "security@demo.example", role: "SECURITY", revenue: false },
  { mail: "unei@demo.example", role: "OPERATOR", revenue: true },
  { mail: "keiri@demo.example", role: "FINANCE", revenue: true },
  { mail: "boss@demo.example", role: "SUPER_ADMIN", revenue: true },
];

for (const y of YAKUWARI) {
  await check(`${y.role}：ガチャは見られる／売上は${y.revenue ? "見える" : "見えない"}`, async () => {
    const h = new Hito(y.role);
    const r = await h.login("ADMIN", "DEMO", y.mail);
    must(r.status === 200 && r.json?.ok, `入れません（${r.status}）`);

    const l = await listOf(h);
    /* ★6役割ぜんぶが、ガチャそのものは見られること */
    must(l.total > 0, `${y.role} が、ガチャを1本も見られません`);
    eq(l.canSeeRevenue, y.revenue, `${y.role} の canSeeRevenue が違います`);

    for (const g of l.gachas) {
      if (y.revenue) {
        must(g.revenue !== null, `${y.role} に売上が渡っていません`);
      } else {
        /* ★0 で来ていないこと。0 で来た瞬間、画面は「売れていない」と読みます */
        must(
          g.revenue === null,
          `${y.role} に売上が ${g.revenue} として渡っています（null であるべき）`,
        );
      }
    }
    return `${l.total}本見えて、売上は ${y.revenue ? "数字" : "null"}`;
  });
}

await check("ログインしていない人は、一覧を1件も読めない", async () => {
  const h = new Hito("匿名");
  const r = await h.call("/api/console/gachas");
  must(r.status === 401 || r.status === 403, `断られていません（${r.status}）`);
  return `${r.status} で断られた`;
});

/* ══════════════════════════════════════════════
   ③ 画面どうしで、数字がずれない
   ══════════════════════════════════════════════ */

group("③ 還元率・公開中の本数が、他の画面とずれない");

await check("3種類の還元率が、還元率の画面と1本ずつ一致する", async () => {
  const r = await aBoss.call("/api/console/rtp");
  must(r.status === 200 && r.json?.ok, `還元率が読めません（${r.status}）`);
  const byId = new Map((r.json.reports ?? []).map((x) => [x.gachaId, x]));

  const l = await listOf(aBoss);
  let kurabeta = 0;
  for (const g of l.gachas) {
    const rep = byId.get(g.id);
    if (!rep) continue;
    for (const kind of ["designed", "remaining", "actual"]) {
      eq(g[kind].known, rep[kind].known, `${g.title} の${kind}の「出せるかどうか」が違います`);
      if (g[kind].known) {
        eq(g[kind].percent, rep[kind].percent, `${g.title} の${kind}還元率が、還元率画面と違います`);
      }
    }
    kurabeta += 1;
  }
  must(kurabeta > 0, "比べられたガチャが1本もありません");
  return `${kurabeta}本すべて一致`;
});

await check("危険・注意の本数が、還元率の画面と一致する", async () => {
  const r = await aBoss.call("/api/console/rtp");
  const l = await listOf(aBoss);
  eq(l.dangerCount, r.json.dangerCount, "危険なガチャの本数が、還元率画面と違います");
  eq(l.warnCount, r.json.warnCount, "注意のガチャの本数が、還元率画面と違います");
  return `危険 ${l.dangerCount}本／注意 ${l.warnCount}本`;
});

await check("公開中の本数が、ダッシュボードの数字と一致する", async () => {
  const s = await aBoss.call("/api/console/summary");
  must(s.status === 200 && s.json?.ok, `集計が読めません（${s.status}）`);
  const l = await listOf(aBoss, "?status=PUBLISHED");
  eq(
    l.gachas.length,
    s.json.gachasPublished,
    "ダッシュボードの「公開中のガチャ」と、一覧の販売中の本数が違います",
  );
  return `どちらも ${l.gachas.length}本`;
});

/* ══════════════════════════════════════════════
   ④ 絞り込みが、サーバー側で効く
   ══════════════════════════════════════════════ */

group("④ 検索と絞り込みが、サーバー側で効く");

await check("状態でしぼると、その状態のものだけが返る", async () => {
  const l = await listOf(aBoss, "?status=PUBLISHED");
  for (const g of l.gachas) eq(g.status, "PUBLISHED", "販売中でないものが混ざっています");
  const c = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM gachas WHERE tenant_id = ? AND status = 'PUBLISHED'",
    args: [A_TID],
  });
  eq(l.gachas.length, Number(c.rows[0].n), "販売中の本数が、DBの数と違います");
  return `販売中 ${l.gachas.length}本`;
});

await check("名前でしぼると、DBで数えた件数と一致する", async () => {
  const one = await db().execute({
    sql: "SELECT title FROM gachas WHERE tenant_id = ? ORDER BY created_at LIMIT 1",
    args: [A_TID],
  });
  must(one.rows[0], "ガチャが1本もありません");
  /* 名前の一部（前2文字）でさがす */
  const kake = String(one.rows[0].title).slice(0, 2);

  const c = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM gachas
           WHERE tenant_id = ? AND LOWER(title) LIKE ?`,
    args: [A_TID, `%${kake.toLowerCase()}%`],
  });
  const l = await listOf(aBoss, `?q=${encodeURIComponent(kake)}`);
  eq(l.gachas.length, Number(c.rows[0].n), `「${kake}」でしぼった件数が、DBの数と違います`);
  for (const g of l.gachas) {
    must(
      g.title.toLowerCase().includes(kake.toLowerCase()),
      `「${kake}」を含まない ${g.title} が混ざっています`,
    );
  }
  return `「${kake}」で ${l.gachas.length}本`;
});

await check("警告だけにしぼると、問題なしのものが混ざらない", async () => {
  const l = await listOf(aBoss, "?alert=1");
  for (const g of l.gachas) {
    must(
      g.worst.level === "DANGER" || g.worst.level === "WARN",
      `${g.title}（${g.worst.level}）が混ざっています`,
    );
  }
  return `${l.gachas.length}本`;
});

/* ══════════════════════════════════════════════
   ⑤ 他社のガチャは、見つからないし、動かせない
   ══════════════════════════════════════════════ */

group("⑤ 他社のガチャは、見つからないし、動かせない（双方向）");

await check("B社の管理者で入れる", async () => {
  const r = await bBoss.login("ADMIN", "KANSA", "b-boss@kansa.example");
  must(r.status === 200 && r.json?.ok, `入れません（${r.status}）`);
  return "入れた";
});

await check("A社の一覧に、B社のガチャが1本も混ざらない", async () => {
  const bIds = await db().execute({
    sql: "SELECT id FROM gachas WHERE tenant_id = ?",
    args: [B_TID],
  });
  const bSet = new Set(bIds.rows.map((r) => String(r.id)));
  const l = await listOf(aBoss);
  for (const g of l.gachas) {
    must(!bSet.has(g.id), `A社の一覧に、B社の ${g.title} が出ています`);
  }
  return `B社 ${bSet.size}本は、1本も出なかった`;
});

await check("B社の一覧に、A社のガチャが1本も混ざらない", async () => {
  const aIds = await db().execute({
    sql: "SELECT id FROM gachas WHERE tenant_id = ?",
    args: [A_TID],
  });
  const aSet = new Set(aIds.rows.map((r) => String(r.id)));
  const l = await listOf(bBoss);
  for (const g of l.gachas) {
    must(!aSet.has(g.id), `B社の一覧に、A社の ${g.title} が出ています`);
  }
  return `A社 ${aSet.size}本は、1本も出なかった`;
});

let aAnyGacha = null;

await check("B社の管理者が、A社のガチャの中身を開けない（404）", async () => {
  const one = await db().execute({
    sql: "SELECT id, title FROM gachas WHERE tenant_id = ? LIMIT 1",
    args: [A_TID],
  });
  aAnyGacha = one.rows[0];
  must(aAnyGacha, "A社のガチャがありません");

  const r = await bBoss.call(`/api/console/gachas?id=${encodeURIComponent(String(aAnyGacha.id))}`);
  eq(r.status, 404, "他社のガチャの中身が読めてしまいました");
  /* ★「他社のガチャです」と教えないこと。
       有る無しを答えるだけで、他社の中身が推測できます */
  const msg = String(r.json?.message ?? "");
  must(!msg.includes("他社") && !msg.includes("DEMO"), `断り文が、他社の存在を漏らしています：${msg}`);
  return "404、しかも理由を漏らしていない";
});

await check("B社の管理者が、A社のガチャを止められない（404）", async () => {
  const r = await act(bBoss, "pause", String(aAnyGacha.id), "他社からの操作の点検");
  eq(r.status, 404, "他社のガチャを操作できてしまいました");
  return "404 で断られた";
});

/* ══════════════════════════════════════════════
   ⑥ 検証 → 公開 → 停止 → 再開
   ══════════════════════════════════════════════ */

group("⑥ 検証・公開・停止・再開が、実際に効く");

/**
 * 前回の点検で作った、下書きのままのものを片づける。
 *
 * ★下書きで、1回も引かれていないものだけ消すこと。
 *   公開まで進んだものには監査ログが付いています。
 *   記録だけ残って対象が消えるのが、いちばん困ります。
 */
{
  const furui = await db().execute({
    sql: `SELECT g.id FROM gachas g
           WHERE g.tenant_id = ? AND g.status = 'DRAFT' AND g.title LIKE '点検用ガチャ %'
             AND NOT EXISTS (SELECT 1 FROM draws d WHERE d.gacha_id = g.id)
             AND NOT EXISTS (SELECT 1 FROM audit_events a
                              WHERE a.tenant_id = g.tenant_id AND a.target = 'gacha:' || g.id)`,
    args: [A_TID],
  });
  for (const r of furui.rows) {
    await db().execute({ sql: "DELETE FROM gacha_stock WHERE gacha_id = ?", args: [String(r.id)] });
    await db().execute({ sql: "DELETE FROM gachas WHERE id = ?", args: [String(r.id)] });
  }
  if (furui.rows.length > 0) {
    console.log(`  （前回の点検で残った下書き ${furui.rows.length}本を片づけました）`);
  }
}

/* 点検用に1本つくる。★既存のガチャで試さないこと。
   お客様が引いている最中のものを止めることになります */
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const TEST_TITLE = `点検用ガチャ ${stamp}`;
const TEST_ID = await createGacha({
  tenantId: A_TID,
  title: TEST_TITLE,
  price: 500,
  total: 200,
  designedRtp: 80,
  status: "DRAFT",
});

console.log(`  （点検用に1本つくりました：${TEST_TITLE}）`);

async function statusOf(gachaId) {
  const r = await db().execute({
    sql: "SELECT status, published_at, paused_at, pause_reason FROM gachas WHERE id = ?",
    args: [gachaId],
  });
  return r.rows[0];
}

/**
 * 監査ログの件数。
 *
 * ★表の名前を、記憶で書かないこと。
 *   2026-08-26、この関数を audit_log と書いて落ちました。
 *   本当の名前は audit_events です（lib/server/db.ts）。
 *   落ちたのは点検の道具の方なので、製品は無事でしたが、
 *   「動いているのに、だめと出る」は、いちばん人を疑わせます。
 */
async function auditCount(action) {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM audit_events
           WHERE tenant_id = ? AND action = ? AND target = ?`,
    args: [A_TID, action, `gacha:${TEST_ID}`],
  });
  return Number(r.rows[0].n);
}

await check("作ったばかりのガチャは、一覧に「検証がまだ」と出る", async () => {
  const l = await listOf(aBoss, `?q=${encodeURIComponent(stamp)}`);
  eq(l.gachas.length, 1, "作ったガチャが、一覧に出てきません");
  const g = l.gachas[0];
  eq(g.backtest.ran, false, "検証していないのに、検証済みと出ています");
  eq(g.status, "DRAFT", "状態が下書きになっていません");
  return `${g.title}：${g.backtest.message}`;
});

await check("検証していないガチャは、公開できない（409）", async () => {
  const r = await act(aBoss, "publish", TEST_ID, "検証していないのに公開できるかの点検");
  eq(r.status, 409, `断られ方が違います（${r.status}）`);
  eq(r.json?.code, "NOT_VERIFIED", `理由が違います（${r.json?.code}）`);
  const st = await statusOf(TEST_ID);
  eq(String(st.status), "DRAFT", "断られたのに、状態が変わっています");
  return "409 NOT_VERIFIED、状態は下書きのまま";
});

await check("理由を書かない公開は、断られる（400）", async () => {
  const r = await act(aBoss, "publish", TEST_ID, "");
  eq(r.status, 400, `断られ方が違います（${r.status}）`);
  eq(r.json?.code, "NO_REASON", `理由が違います（${r.json?.code}）`);
  return "400 NO_REASON";
});

let hanketsu = null;

await check("検証を実行すると、判定が出て、監査ログに残る", async () => {
  const mae = await auditCount("BACKTEST_RUN");
  const r = await act(aBoss, "verify", TEST_ID);
  must(r.status === 200 && r.json?.ok, `検証できません（${r.status}：${JSON.stringify(r.json).slice(0, 200)}）`);
  hanketsu = r.json.result.verdict;
  must(["SAFE", "CAUTION", "DANGER"].includes(hanketsu), `判定が変です（${hanketsu}）`);
  eq(await auditCount("BACKTEST_RUN"), mae + 1, "検証したのに、監査ログに残っていません");
  return `判定 ${hanketsu} ／ 使える判定か：${r.json.result.usable ? "はい" : "いいえ"}`;
});

await check("検証すると、一覧の表示も「検証済み」に変わる", async () => {
  const l = await listOf(aBoss, `?q=${encodeURIComponent(stamp)}`);
  const g = l.gachas[0];
  eq(g.backtest.ran, true, "検証したのに、一覧が「検証がまだ」のままです");
  eq(g.backtest.verdict, hanketsu, "一覧に出ている判定が、検証の結果と違います");
  eq(g.backtest.current, true, "いまの構成と、検証した構成が違うことになっています");
  return `一覧にも 検証 ${hanketsu} と出た`;
});

/* ★判定が DANGER のときは、公開できないのが正しい動きです。
     そこで止めて、以降の公開・停止・再開は飛ばします */
const susumeru = hanketsu !== "DANGER";

if (!susumeru) {
  await check("判定が「危険」のガチャは、検証済みでも公開できない（409）", async () => {
    const r = await act(aBoss, "publish", TEST_ID, "危険なのに公開できるかの点検");
    eq(r.status, 409, `断られ方が違います（${r.status}）`);
    eq(r.json?.code, "VERDICT_DANGER", `理由が違います（${r.json?.code}）`);
    return "409 VERDICT_DANGER";
  });
} else {
  await check("検証を通したガチャは、理由をつければ公開できる", async () => {
    const mae = await auditCount("GACHA_PUBLISH");
    const r = await act(aBoss, "publish", TEST_ID, `検証${hanketsu}のため公開（点検）`);
    must(r.status === 200 && r.json?.ok, `公開できません（${r.status}：${JSON.stringify(r.json).slice(0, 200)}）`);
    const st = await statusOf(TEST_ID);
    eq(String(st.status), "PUBLISHED", "公開したのに、状態が変わっていません");
    must(st.published_at, "公開したのに、公開日時が記録されていません");
    eq(await auditCount("GACHA_PUBLISH"), mae + 1, "公開したのに、監査ログに残っていません");
    return `状態 DRAFT→PUBLISHED ／ 公開日時 ${String(st.published_at).slice(0, 19)}`;
  });

  let hatsukoukai = null;

  await check("公開すると、一覧の状態と公開日時も変わる", async () => {
    const l = await listOf(aBoss, `?q=${encodeURIComponent(stamp)}`);
    const g = l.gachas[0];
    eq(g.status, "PUBLISHED", "一覧の状態が変わっていません");
    must(g.publishedAt, "一覧に公開日時が出ていません");
    hatsukoukai = g.publishedAt;
    return `一覧にも 販売中 ${String(g.publishedAt).slice(0, 19)}`;
  });

  await check("販売を止めると、理由つきで止まる", async () => {
    const mae = await auditCount("GACHA_PAUSE");
    const r = await act(aBoss, "pause", TEST_ID, "点検のため一時停止");
    must(r.status === 200 && r.json?.ok, `止められません（${r.status}：${JSON.stringify(r.json).slice(0, 200)}）`);
    const st = await statusOf(TEST_ID);
    eq(String(st.status), "PAUSED", "止めたのに、状態が変わっていません");
    eq(String(st.pause_reason), "点検のため一時停止", "止めた理由が残っていません");
    eq(await auditCount("GACHA_PAUSE"), mae + 1, "止めたのに、監査ログに残っていません");
    return "状態 PUBLISHED→PAUSED、理由も残った";
  });

  await check("販売を再開できる", async () => {
    const mae = await auditCount("GACHA_RESUME");
    const r = await act(aBoss, "resume", TEST_ID, "点検が終わったため再開");
    must(r.status === 200 && r.json?.ok, `再開できません（${r.status}：${JSON.stringify(r.json).slice(0, 200)}）`);
    const st = await statusOf(TEST_ID);
    eq(String(st.status), "PUBLISHED", "再開したのに、状態が変わっていません");
    eq(st.paused_at, null, "再開したのに、停止日時が残っています");
    eq(await auditCount("GACHA_RESUME"), mae + 1, "再開したのに、監査ログに残っていません");
    return "状態 PAUSED→PUBLISHED";
  });

  await check("止めて再開しても、はじめて公開した日時は上書きされない", async () => {
    /* ★ここが上書きされると、「いつから売っていたか」が消えます。
         返金や問い合わせで、いちばん最初に聞かれるのがそこです */
    const l = await listOf(aBoss, `?q=${encodeURIComponent(stamp)}`);
    eq(l.gachas[0].publishedAt, hatsukoukai, "再開で、公開日時が上書きされています");
    return `${String(hatsukoukai).slice(0, 19)} のまま`;
  });

  await check("すでに販売中のものを、もう一度公開しようとすると断られる（409）", async () => {
    const r = await act(aBoss, "publish", TEST_ID, "二重に公開できるかの点検");
    eq(r.status, 409, `断られ方が違います（${r.status}）`);
    eq(r.json?.code, "BAD_STATUS", `理由が違います（${r.json?.code}）`);
    return "409 BAD_STATUS";
  });
}

/* ══════════════════════════════════════════════
   ⑦ 権限のない人は、公開できない
   ══════════════════════════════════════════════ */

group("⑦ 公開の権限がない人は、公開も停止もできない");

for (const y of [
  { mail: "etsuran@demo.example", role: "VIEWER" },
  { mail: "support@demo.example", role: "SUPPORT" },
  { mail: "keiri@demo.example", role: "FINANCE" },
]) {
  await check(`${y.role} は、ガチャを止められない（403）`, async () => {
    const h = new Hito(y.role);
    const r0 = await h.login("ADMIN", "DEMO", y.mail);
    must(r0.status === 200 && r0.json?.ok, `入れません（${r0.status}）`);

    const r = await act(h, "pause", TEST_ID, "権限のない人が止められるかの点検");
    eq(r.status, 403, `断られ方が違います（${r.status}）`);

    /* ★断られたあとで、状態が変わっていないこと */
    const st = await statusOf(TEST_ID);
    must(
      String(st.status) === "PUBLISHED" || String(st.status) === "DRAFT",
      `断られたのに、状態が ${st.status} に変わっています`,
    );
    return "403 で断られ、状態も変わっていない";
  });
}

await check("VIEWER でも、検証は実行できない（gacha.edit が要る）", async () => {
  const h = new Hito("VIEWER");
  await h.login("ADMIN", "DEMO", "etsuran@demo.example");
  const r = await act(h, "verify", TEST_ID);
  eq(r.status, 403, `断られ方が違います（${r.status}）`);
  return "403 で断られた";
});

/* ══════════════════════════════════════════════
   ⑧ 引いたら、一覧の数字が動く
   ══════════════════════════════════════════════ */

group("⑧ 実際に1回引くと、一覧の残口数と売上が動く");

await check("1回引くと、残口数が1つ減り、売上が値段ぶん増える", async () => {
  const g = await db().execute({
    sql: `SELECT id, title, price FROM gachas
           WHERE tenant_id = ? AND status = 'PUBLISHED' AND left_count > 0
           ORDER BY price ASC LIMIT 1`,
    args: [A_TID],
  });
  must(g.rows[0], "引けるガチャ（公開中・残りあり）が1本もありません");
  const target = String(g.rows[0].id);
  const nedan = Number(g.rows[0].price);

  const mae = (await listOf(aBoss)).gachas.find((x) => x.id === target);
  must(mae, "引く前の一覧に、そのガチャが出ていません");

  const kyaku = new Hito("引く人");
  const rl = await kyaku.login("CUSTOMER", "DEMO", "user1@demo.example");
  must(rl.status === 200 && rl.json?.ok, `お客様が入れません（${rl.status}）`);

  const { randomUUID } = await import("node:crypto");
  const r = await kyaku.call("/api/console/draw", "POST", { gachaId: target }, {
    "Idempotency-Key": `gachacheck-${randomUUID()}`,
  });
  must(r.status === 200 && r.json?.ok, `引けません（${r.status}：${JSON.stringify(r.json).slice(0, 160)}）`);

  const ato = (await listOf(aBoss)).gachas.find((x) => x.id === target);
  eq(ato.leftCount, mae.leftCount - 1, "引いたのに、残口数が減っていません");
  eq(ato.revenue, mae.revenue + nedan, "引いたのに、売上が値段ぶん増えていません");
  return `残 ${mae.leftCount}→${ato.leftCount} ／ 売上 ${mae.revenue}→${ato.revenue}円`;
});

await check("一覧を2回続けて読んでも、同じ数が返る（古い答えを返していない）", async () => {
  const a = await listOf(aBoss);
  const b = await listOf(aBoss);
  eq(a.total, b.total, "同じことを2回聞いて、本数が違いました");
  for (let i = 0; i < a.gachas.length; i += 1) {
    eq(a.gachas[i].leftCount, b.gachas[i].leftCount, "同じことを2回聞いて、残口数が違いました");
  }
  return "2回とも同じ";
});

/* ══════════════════════════════════════════════
   後片づけ
   ══════════════════════════════════════════════ */

group("⑨ 後片づけ");

await check("点検用に作ったガチャを、止めておく", async () => {
  const st = await statusOf(TEST_ID);
  if (String(st.status) !== "PUBLISHED") return `もともと ${st.status} なので、そのまま`;
  const r = await act(aBoss, "pause", TEST_ID, "点検が終わったため停止（後片づけ）");
  must(r.status === 200 && r.json?.ok, `止められません（${r.status}）`);
  /* ★消さないこと。監査ログだけ残って、対象が消えるのがいちばん困ります */
  return "止めた（記録を残すため、消しません）";
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

console.log("\n✓ ガチャ管理は、公開先で実際に動き、他の画面ともずれていません。\n");
