/**
 * 管理画面の数字が「本当か」を、公開先（Preview）で確かめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具が答える3つの問い
 * ═══════════════════════════════════════════════════════
 *
 *   ① 押したら、数字が動くか
 *
 *      画面に数字が出ているだけでは、本物とは言えません。
 *      見本の数字でも、画面には同じように出るからです。
 *      見分ける方法は1つだけです。
 *
 *          実際に1回引いて、回数が1つ増えるかを見る。
 *
 *      増えなければ、それは絵です。
 *
 *   ② どの画面から見ても、同じ数字か
 *
 *      同じ「発送待ち」が、いま3か所に出ます。
 *      ダッシュボード ／ 今日やること ／ AIオペレーターの報告。
 *
 *      ここがずれると、いちばん悪い形になります。
 *      片方が「0件」、片方が「14件」。
 *      運営の方には、どちらが本当か確かめる方法がありません。
 *      そして、どちらも見なくなります。
 *
 *   ③ 見せてよい人にだけ、見えているか
 *
 *      売上と粗利は、その会社の経営がそのまま読める数字です。
 *      役割6種すべてで、出るはず・出ないはずを確かめます。
 *
 *      ★「権限が無い」を 0 と出していないかも、ここで見ます。
 *        0 と出た瞬間、その画面は「異常なし」と読まれます。
 *
 * ═══════════════════════════════════════════════════════
 * ★手元で通っても、ここで通るとはかぎりません
 * ═══════════════════════════════════════════════════════
 *
 *   2026-08-26、手元の検査が全部通っている状態で、
 *   公開先だけで起きる不具合が見つかりました。
 *   手元のDBはファイルなので、その道は通らないからです。
 *
 *   ですから、公開した場所そのものを相手に、
 *   実際にログインし、実際に押して、実際に数えます。
 *
 * ═══════════════════════════════════════════════════════
 * ★書き込みます。接続先に気をつけてください
 * ═══════════════════════════════════════════════════════
 *
 *   数字を動かすために、ガチャを引き、問い合わせを出します。
 *   ですので seed と同じ鍵をかけています。
 *   DATABASE_ENV が production なら、何もせず止まります。
 *
 * 使い方：
 *   npx tsx --env-file=.env.local scripts/check-summary-preview.mjs <Preview URL>
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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

   ★落ちたときに「何が返ってきたか」を必ず残すこと。
     ○×だけ並べても、受け取った人には直せません。
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

/** 集計を1回読む。読めなければ、その場で止める（0 で続けない） */
async function summaryOf(h) {
  const r = await h.call("/api/console/summary");
  if (r.status !== 200 || !r.json?.ok) {
    throw new Error(`集計が読めません（${r.status}：${JSON.stringify(r.json).slice(0, 200)}）`);
  }
  return r.json;
}

/** 「見えている」か。★null は見えていない。0 は見えていて0件 */
const mieru = (v) => v !== null && v !== undefined;

console.log(`\n公開先：${BASE}\n`);

/* ══════════════════════════════════════════════
   ① 役割6種：見せてよい数字だけが出ているか
   ══════════════════════════════════════════════ */

group("① 役割6種で、見せてよい数字だけが出る");

/**
 * 役割ごとの、出るはず・出ないはず。
 *
 * ★ここを実装から作らないこと。
 *   実装を読んで書いた表は、実装が間違っていても通ります。
 *   これは「こうあってほしい」を先に書いた表です。
 */
const YAKUWARI = [
  { mail: "etsuran@demo.example",  role: "VIEWER",      revenue: false, plays: true, support: true,  fraud: false },
  { mail: "support@demo.example",  role: "SUPPORT",     revenue: false, plays: true, support: true,  fraud: false },
  { mail: "unei@demo.example",     role: "OPERATOR",    revenue: true,  plays: true, support: true,  fraud: true },
  { mail: "keiri@demo.example",    role: "FINANCE",     revenue: true,  plays: true, support: false, fraud: false },
  { mail: "security@demo.example", role: "SECURITY",    revenue: false, plays: true, support: false, fraud: true },
  { mail: "boss@demo.example",     role: "SUPER_ADMIN", revenue: true,  plays: true, support: true,  fraud: true },
];

/** あとで使い回す（全権で読んだ集計） */
let zenken = null;

for (const y of YAKUWARI) {
  await check(`${y.role}：売上・回数・問い合わせ・不正の見え方`, async () => {
    const h = new Hito(y.role);
    const r = await h.login("ADMIN", "DEMO", y.mail);
    must(r.status === 200 && r.json?.ok, `ログインできません（${r.status}）`);

    const s = await summaryOf(h);
    if (y.role === "SUPER_ADMIN") zenken = s;

    eq(mieru(s.revenueToday), y.revenue, `${y.role} の本日売上の見え方が違います`);
    eq(mieru(s.revenueMonth), y.revenue, `${y.role} の今月売上の見え方が違います`);
    eq(mieru(s.grossProfitMonth), y.revenue, `${y.role} の粗利の見え方が違います`);
    eq(mieru(s.playsToday), y.plays, `${y.role} の引かれた回数の見え方が違います`);
    eq(mieru(s.supportOpen), y.support, `${y.role} の問い合わせ件数の見え方が違います`);
    eq(mieru(s.fraudHighRisk), y.fraud, `${y.role} の危ない会員の数の見え方が違います`);

    /* ★見えない数字が 0 で来ていないこと。
         0 で来ると、画面は「異常なし」と読みます */
    if (!y.revenue) {
      must(s.revenueToday === null, `${y.role} に売上が 0 として渡っています（null であるべき）`);
    }
    if (!y.fraud) {
      must(s.fraudHighRisk === null, `${y.role} に不正件数が 0 として渡っています（null であるべき）`);
    }

    return `売上=${y.revenue ? "見える" : "null"} 不正=${y.fraud ? "見える" : "null"}`;
  });
}

await check("ログインしていない人は、集計を1つも読めない", async () => {
  const h = new Hito("匿名");
  const r = await h.call("/api/console/summary");
  must(r.status === 401 || r.status === 403, `断られていません（${r.status}）`);
  return `${r.status} で断られた`;
});

/* ══════════════════════════════════════════════
   ② 会社が違えば、数字も違う（双方向）
   ══════════════════════════════════════════════ */

group("② 他社の数字が混ざらない（A社→B社／B社→A社）");

const aBoss = new Hito("A社の管理者");
const bBoss = new Hito("B社の管理者");

let aSum = null;
let bSum = null;

await check("A社・B社それぞれの管理者で入れる", async () => {
  const ra = await aBoss.login("ADMIN", "DEMO", "boss@demo.example");
  const rb = await bBoss.login("ADMIN", "KANSA", "b-boss@kansa.example");
  must(ra.status === 200 && ra.json?.ok, `A社に入れません（${ra.status}）`);
  must(rb.status === 200 && rb.json?.ok, `B社に入れません（${rb.status}）`);
  aSum = await summaryOf(aBoss);
  bSum = await summaryOf(bBoss);
  return "両社で集計を読めた";
});

await check("A社の集計が、DBで数えたA社の数と一致する", async () => {
  const t = await db().execute({ sql: "SELECT id FROM tenants WHERE code = ?", args: ["DEMO"] });
  const tid = String(t.rows[0].id);
  const c = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?", args: [tid],
  });
  eq(aSum.customersTotal, Number(c.rows[0].n), "A社の会員数が、DBの数と違います");
  return `会員 ${aSum.customersTotal}人`;
});

await check("B社の集計が、DBで数えたB社の数と一致する", async () => {
  const t = await db().execute({ sql: "SELECT id FROM tenants WHERE code = ?", args: ["KANSA"] });
  const tid = String(t.rows[0].id);
  const c = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?", args: [tid],
  });
  eq(bSum.customersTotal, Number(c.rows[0].n), "B社の会員数が、DBの数と違います");
  return `会員 ${bSum.customersTotal}人`;
});

await check("A社の会員数とB社の会員数が、同じ値になっていない", async () => {
  /* ★同じ数だと「分離できている」とは言い切れません。
       たまたま同数のこともあるので、上の2つ（DB実測との一致）が本命です。
       これは、集計が会社を無視して全部数えていないかの、目安です */
  must(
    aSum.customersTotal !== bSum.customersTotal,
    `A社もB社も ${aSum.customersTotal}人 です。会社を見ずに全部数えている疑いがあります`,
  );
  return `A社 ${aSum.customersTotal}人 ／ B社 ${bSum.customersTotal}人`;
});

/* ══════════════════════════════════════════════
   ③ 押したら、数字が動く
   ══════════════════════════════════════════════ */

group("③ 実際に操作すると、集計の数字が動く");

/** いま公開されていて、引けるガチャを1本さがす */
async function hikeruGacha(tenantCode) {
  const t = await db().execute({ sql: "SELECT id FROM tenants WHERE code = ?", args: [tenantCode] });
  const tid = String(t.rows[0].id);
  const g = await db().execute({
    sql: `SELECT id, title, price, left_count FROM gachas
           WHERE tenant_id = ? AND status = 'PUBLISHED' AND left_count > 0
           ORDER BY price ASC LIMIT 1`,
    args: [tid],
  });
  if (!g.rows[0]) throw new Error("引けるガチャ（公開中・残りあり）が1本もありません");
  return g.rows[0];
}

await check("ガチャを1回引くと、引かれた回数が1つ増える／売上が値段ぶん増える", async () => {
  const g = await hikeruGacha("DEMO");

  const mae = await summaryOf(aBoss);

  const kyaku = new Hito("引く人");
  const rl = await kyaku.login("CUSTOMER", "DEMO", "user1@demo.example");
  must(rl.status === 200 && rl.json?.ok, `お客様が入れません（${rl.status}）`);

  const r = await kyaku.call("/api/console/draw", "POST", { gachaId: String(g.id) }, {
    "Idempotency-Key": `sumcheck-${randomUUID()}`,
  });
  must(r.status === 200 && r.json?.ok, `引けません（${r.status}：${JSON.stringify(r.json).slice(0, 160)}）`);

  const ato = await summaryOf(aBoss);

  eq(ato.playsToday, mae.playsToday + 1, "引いたのに、引かれた回数が増えていません");
  eq(
    ato.revenueToday,
    mae.revenueToday + Number(g.price),
    "引いたのに、本日の売上が値段ぶん増えていません",
  );
  return `回数 ${mae.playsToday}→${ato.playsToday} ／ 売上 ${mae.revenueToday}→${ato.revenueToday}円`;
});

await check("問い合わせを1件出すと、終わっていない件数が1つ増える", async () => {
  const mae = await summaryOf(aBoss);

  const kyaku = new Hito("問い合わせる人");
  const rl = await kyaku.login("CUSTOMER", "DEMO", "user2@demo.example");
  must(rl.status === 200 && rl.json?.ok, `お客様が入れません（${rl.status}）`);

  const r = await kyaku.call("/api/customer/support", "POST", {
    subject: `集計の点検 ${new Date().toISOString()}`,
    body: "これは数字が動くかを確かめるための、点検用の問い合わせです。",
  });
  must(r.status === 200 && r.json?.ok, `出せません（${r.status}：${JSON.stringify(r.json).slice(0, 160)}）`);

  const ato = await summaryOf(aBoss);
  eq(ato.supportOpen, mae.supportOpen + 1, "問い合わせを出したのに、件数が増えていません");
  return `問い合わせ ${mae.supportOpen}→${ato.supportOpen}件`;
});

await check("会員を1人ふやすと、会員数が1人ふえる", async () => {
  const mae = await summaryOf(aBoss);

  /* ★画面から会員を作る入口が、まだありません。
       ですので、ここだけDBに直接入れます。
       入口ができたら、必ずそちらへ差し替えること。
       「DBに入れたら増えた」は、「画面から作れる」の証明ではありません。 */
  const t = await db().execute({ sql: "SELECT id FROM tenants WHERE code = ?", args: ["DEMO"] });
  const tid = String(t.rows[0].id);
  /* ★会員の行を、自分で組み立てないこと。
       残高を持たせて作ると、その残高が台帳のどこにも無い人ができます。
       lib/server/seed.ts の createCustomer は、
       開始時の残高も同時に台帳へ入れてくれます。 */
  const { createCustomer } = await import(`${ROOT}/lib/server/seed.ts`);
  await createCustomer({
    tenantId: tid,
    no: Date.now() % 1000000,
    name: "点検用の会員",
    points: 0,
    email: `sumcheck-${Date.now()}@demo.example`,
  });

  const ato = await summaryOf(aBoss);
  eq(ato.customersTotal, mae.customersTotal + 1, "会員を足したのに、会員数が増えていません");
  return `会員 ${mae.customersTotal}→${ato.customersTotal}人`;
});

/* ══════════════════════════════════════════════
   ④ どの画面から見ても、同じ数字か
   ══════════════════════════════════════════════ */

group("④ 発送・還元率・問い合わせが、画面ごとにずれない");

await check("発送待ちの件数が、発送画面の一覧と一致する", async () => {
  const s = await summaryOf(aBoss);
  const r = await aBoss.call("/api/console/shipments?limit=1");
  must(r.status === 200 && r.json?.ok, `発送一覧が読めません（${r.status}）`);

  /* ★返ってきた行数から数え直さないこと。
       上限（limit）で切られていたら、必ず少なく出ます。
       発送画面が自分で数えた「残りの仕事の数」＝ todo と比べます */
  must(
    typeof r.json.todo === "number",
    "発送画面が、残りの仕事の数（todo）を返していません",
  );
  eq(
    s.unshippedShipments,
    r.json.todo,
    "ダッシュボードの発送待ちと、発送画面の件数が違います。どちらかが壊れています",
  );
  return `どちらも ${r.json.todo}件`;
});

await check("還元率の警告の数が、還元率画面と一致する", async () => {
  const s = await summaryOf(aBoss);
  const r = await aBoss.call("/api/console/rtp");
  must(r.status === 200 && r.json?.ok, `還元率が読めません（${r.status}）`);

  /* ★還元率画面も、自分で数えた数を返してくれています。
       ここで reports を数え直すと、数え方が2通りになります */
  must(typeof r.json.dangerCount === "number", "還元率画面が危険の数を返していません");
  eq(s.rtpDangerCount, r.json.dangerCount, "危険なガチャの数が、還元率画面と違います");
  eq(s.rtpWarnCount, r.json.warnCount, "注意のガチャの数が、還元率画面と違います");

  /* ダッシュボードとAIオペレーターは rtpAlerts を並べます。
     その本数も、危険＋注意と合っていること */
  const alerts = s.rtpAlerts ?? [];
  eq(
    alerts.length,
    r.json.dangerCount + r.json.warnCount,
    "画面に並ぶ警告の数が、危険＋注意の数と合っていません",
  );
  return `危険 ${r.json.dangerCount}本／注意 ${r.json.warnCount}本`;
});

await check("集計を2回続けて読んでも、同じ数が返る（古い答えを返していない）", async () => {
  /* ★ここが崩れると、いちばん質の悪い不具合になります。
       「押しても変わらない」ように見えるのに、
       しばらくすると変わる。誰も再現できません */
  const a = await summaryOf(aBoss);
  const b = await summaryOf(aBoss);
  eq(a.customersTotal, b.customersTotal, "同じことを2回聞いて、会員数が違いました");
  eq(a.unshippedShipments, b.unshippedShipments, "同じことを2回聞いて、発送待ちが違いました");
  return "2回とも同じ";
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

console.log("\n✓ 管理画面の数字は、公開先で実際に動き、画面どうしでも一致しました。\n");
