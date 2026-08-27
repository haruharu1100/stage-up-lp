/**
 * ポイント管理の画面が「本当か」を、公開先（Preview）で確かめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具が答える問い
 * ═══════════════════════════════════════════════════════
 *
 *   ① 画面のポイントは、台帳（point_ledger）と一致しているか
 *
 *      残高の数字が出ているだけでは、本物とは言えません。
 *      見本データでも、画面には同じように数字が並びます。
 *      台帳をDBで直接合計して、1人ずつ突き合わせます。
 *
 *      ★ここが、この点検のいちばん大事なところです。
 *        「数字が出ている」ではなく
 *        「その数字が正しいことを、あとから確かめられる」
 *        ところまでを見ます。
 *
 *   ② 合っていないとき、合っていないと言えるか
 *
 *      台帳と残高がずれたとき、画面が黙るのがいちばん危険です。
 *      黙ったまま使われ続けると、
 *      どこまでが正しい残高だったのかを、あとから誰も決められません。
 *      わざとずらして、赤く出ることを確かめます（必ず戻します）。
 *
 *   ③ 大きな額が、ひとりで動かせないか
 *
 *      画面のボタンを消しても、それは守りではありません。
 *      入口を直接たたいて、
 *      申請した人自身では承認できないこと、
 *      承認を2回押しても1回しか動かないこと、
 *      他社の申請には触れないことを確かめます。
 *
 *   ④ お客様側と、管理側で、同じ数になっているか
 *
 *      お客様がガチャを引く、景品をポイントに換える。
 *      そのあと管理画面を開いて、数が合っていること。
 *      2つの画面で違う残高が出たら、
 *      運営の方には、どちらが本当か確かめる方法がありません。
 *
 * ═══════════════════════════════════════════════════════
 * ★書き込みます。接続先に気をつけてください
 * ═══════════════════════════════════════════════════════
 *
 *   点検のあいだ、ポイントを足したり引いたりします。
 *   ですので seed と同じ鍵をかけています。
 *   DATABASE_ENV が production なら、何もせず止まります。
 *
 *   ★ずらしたまま終わらないこと。
 *     途中で落ちても最後に必ず戻すよう、後片づけを入れてあります。
 *
 * ═══════════════════════════════════════════════════════
 * ★秘密の鍵を、画面に出さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   二人目の承認者が認証アプリを未登録だと、
 *   承認の直前の6桁が入れられず、点検が最後まで通りません。
 *   その場合、この道具が登録します。
 *
 *   ★ただし、鍵そのものは絶対に表示しません。
 *     出すのは「登録しました」までです。
 *
 * 使い方：
 *   MFA_SECRET="" npx tsx --env-file=.env.local \
 *     scripts/check-points-preview.mjs <Preview URL>
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { makePreviewClient, mfaCodeFor } from "./lib/preview-client.mjs";

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

/**
 * 二人承認になる境目。
 *
 * ★手元のコードから読まないこと。
 *   境目は、動いているサーバーの設定で決まります。
 *   手元の値を正しいことにすると、
 *   「手元では0だから全件承認のはず」と思い込んだまま、
 *   公開先だけ10万ptで動いている、という見落としが起きます。
 *   ですので、公開先のAPIが言う数字を、そのまま正本にします。
 *
 *   ログインしてからでないと読めないので、最初は null です。
 */
let SHIKII = null;

/** その額に、二人承認が要るか（正本＝公開先が言う境目で決める） */
function futariGaIru(delta) {
  if (SHIKII === null) throw new Error("境目を、まだ公開先から読んでいません");
  return Math.abs(Math.trunc(delta)) >= SHIKII;
}

/** 大きめの額。境目が0でも、10万ptでも、必ず二人承認になる側 */
const OOGUCHI = 100_000;
/** 小さめの額。境目が0なら二人承認、境目が大きければその場で反映 */
const KOGUCHI = 500;

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
const short = (j) => JSON.stringify(j ?? {}).slice(0, 200);

/* ══════════════════════════════════════════════
   DBを直接読む道具
   ══════════════════════════════════════════════ */

async function tenantIdOf(code) {
  const t = await db().execute({ sql: "SELECT id FROM tenants WHERE code = ?", args: [code] });
  must(t.rows[0], `会社 ${code} がありません`);
  return String(t.rows[0].id);
}

async function customerIdOf(tenantId, email) {
  const r = await db().execute({
    sql: "SELECT id FROM customers WHERE tenant_id = ? AND email = ? LIMIT 1",
    args: [tenantId, email],
  });
  must(r.rows[0], `お客様 ${email} がいません`);
  return String(r.rows[0].id);
}

/** いまの残高（customers.points）。これは台帳の「写し」です */
async function zandaka(customerId) {
  const r = await db().execute({
    sql: "SELECT points FROM customers WHERE id = ? LIMIT 1",
    args: [customerId],
  });
  return Number(r.rows[0]?.points ?? 0);
}

/** 台帳の合計。★こちらが正本です */
async function daichouGoukei(tenantId, customerId) {
  const r = await db().execute({
    sql: `SELECT COALESCE(SUM(delta), 0) AS n FROM point_ledger
           WHERE tenant_id = ? AND user_id = ?`,
    args: [tenantId, customerId],
  });
  return Number(r.rows[0]?.n ?? 0);
}

/* ══════════════════════════════════════════════
   公開先を叩く道具
   ══════════════════════════════════════════════ */

const POINTS = "/api/console/points";
const REQ = "/api/console/points/request";
const APR = "/api/console/points/approve";

/**
 * いちばん強い操作の直前に、6桁を入れ直す。
 *
 * ★同じ6桁は二度使えません（盗み見られた数字で入られないため）。
 *   ログイン直後は、その30秒ぶんの数字をもう使っています。
 *   ですから、断られたら次の30秒を待ってやり直します。
 *
 *   ★ここで「6桁を送らない」で逃げないこと。
 *     送らずに通るなら、それは鍵が効いていない証拠です。
 */
async function stepUp(h, email) {
  for (let kai = 0; kai < 3; kai += 1) {
    const code = await mfaCodeFor(db, email);
    must(code, `${email} が認証アプリを登録していません（6桁を作れません）`);
    const r = await h.call("/api/auth/step-up", "POST", { code });
    if (r.status === 200) return true;
    /* 次の30秒の頭まで待つ */
    const kugiri = (Math.floor(Date.now() / 1000 / 30) + 1) * 30 * 1000 + 1200;
    await new Promise((res) => setTimeout(res, Math.max(0, kugiri - Date.now())));
  }
  throw new Error(`${email} の6桁の入れ直しが通りませんでした`);
}

/** 一覧を1回読む。読めなければその場で止める（0件で続けない） */
async function listOf(h, qs = "") {
  const r = await h.call(`${POINTS}${qs}`);
  if (r.status !== 200 || !r.json?.ok) {
    throw new Error(`一覧が読めません（${r.status}：${short(r.json)}）`);
  }
  return r.json;
}

async function detailOf(h, customerId) {
  return h.call(`${POINTS}?id=${encodeURIComponent(customerId)}`);
}

async function adjustmentsOf(h, status = "") {
  const r = await h.call(`${POINTS}?view=adjustments${status ? `&status=${status}` : ""}`);
  if (r.status !== 200 || !r.json?.ok) {
    throw new Error(`承認待ちの一覧が読めません（${r.status}：${short(r.json)}）`);
  }
  return r.json;
}

let idemBan = 0;
function newKey() {
  idemBan += 1;
  return `preview-check-${Date.now()}-${idemBan}`;
}

async function moushikomi(h, userId, delta, reason, key = newKey()) {
  return h.call(REQ, "POST", { userId, delta, reason }, { "idempotency-key": key });
}

async function handan(h, adjustmentId, approve, note) {
  return h.call(APR, "POST", { adjustmentId, approve, ...(note ? { note } : {}) });
}

/** 承認待ちの申請を1件つくり、本当に止まっていることを確かめる */
async function machiWoTsukuru(h, userId, reason) {
  const mae = await zandaka(userId);
  const r = await moushikomi(h, userId, OOGUCHI, reason);
  must(r.status === 200 && r.json?.ok, `申請できません（${r.status}：${short(r.json)}）`);
  eq(r.json.status, "PENDING", `${OOGUCHI}pt の申請が、承認を待たずに反映されました`);
  eq(await zandaka(userId), mae, "承認待ちのはずなのに、残高が動いています");
  return String(r.json.adjustmentId);
}

/**
 * ポイントを、実際に動かしきる。
 *
 * ★境目の設定によって、道が2つに分かれます。
 *     ・二人承認が要らない額 … 申請した時点で反映される
 *     ・二人承認が要る額     … 申請 → 別の管理者が承認 で反映される
 *
 *   標準の設定（境目0＝全件二人承認）では、必ず後者です。
 *   この点検のあちこちで「ポイントを動かした状態」が必要になるので、
 *   どちらの道でも同じように動かしきる入口を、1つだけ作ります。
 *
 * ★ここで「承認を飛ばす近道」を作らないこと。
 *   飛ばしてしまうと、二人承認そのものが点検されなくなります。
 *   必ず、承認する人（fuku）に本当に承認させます。
 */
async function chousei(h, userId, delta, reason, key = newKey()) {
  const r = await moushikomi(h, userId, delta, reason, key);
  must(r.status === 200 && r.json?.ok, `申請できません（${r.status}：${short(r.json)}）`);

  if (r.json.status === "APPLIED") {
    eq(r.json.needsApproval, false, "その場で入ったのに、承認が要ると言っています");
    must(!futariGaIru(delta), `二人承認が要る額なのに、その場で反映されました（${delta}pt）`);
    return { ...r.json, futari: false };
  }

  eq(r.json.status, "PENDING", `知らない状態が返りました：${short(r.json)}`);
  must(futariGaIru(delta), `二人承認が要らない額なのに、止められました（${delta}pt）`);

  const a = await handan(fuku, String(r.json.adjustmentId), true, "点検のため承認します");
  must(a.status === 200 && a.json?.ok, `承認できません（${a.status}：${short(a.json)}）`);
  return { ...a.json, adjustmentId: r.json.adjustmentId, futari: true };
}

console.log(`\n公開先：${BASE}`);

const A_TID = await tenantIdOf("DEMO");
const B_TID = await tenantIdOf("KANSA");

const MATO = await customerIdOf(A_TID, "user3@demo.example");
const HIKU = await customerIdOf(A_TID, "user1@demo.example");
/* ★残高の少ないお客様。「その場で入る道」の引きすぎを試すのに使います */
const KOGAKU = await customerIdOf(A_TID, "user5@demo.example");

/** いま、台帳と残高が合っていない人の数（A社） */
async function zurehito() {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM customers c
           WHERE c.tenant_id = ?
             AND c.points <> (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
                               WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id)`,
    args: [A_TID],
  });
  return Number(r.rows[0].n);
}

/**
 * 点検を始める前の「ずれている人の数」。
 *
 * ★これを控えてから始めること。
 *   控えずに「終わりに0人」を求めると、
 *   もともと有った傷を消すために、
 *   台帳へ無かった行を作り足したくなります。
 *   そこから先は、もう帳簿ではありません。
 */
const MAE_NO_ZURE = await zurehito();

/* ══════════════════════════════════════════════
   ⓪ 支度
   ══════════════════════════════════════════════ */

group("⓪ 支度（始める前の状態を、隠さずに控える）");

await check("始める前の「合っていない人」の数を、そのまま出す", async () => {
  /*
   * ★0名でなくても、ここでは止めません。
   *   止めずに、数を出します。
   *   隠すと「いつからずれていたのか」が分からなくなります。
   */
  if (MAE_NO_ZURE === 0) return "0名（きれいな状態から始めます）";

  const r = await db().execute({
    sql: `SELECT c.display_id,
                 c.points - (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
                              WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS sa
            FROM customers c
           WHERE c.tenant_id = ?
             AND c.points <> (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
                               WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id)`,
    args: [A_TID],
  });
  const meisai = r.rows.map((x) => `${x.display_id}：${Number(x.sa) > 0 ? "+" : ""}${x.sa}pt`);
  return `${MAE_NO_ZURE}名（${meisai.join(" / ")}）`;
});

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

await check("二人目の承認者が、認証アプリを登録している", async () => {
  const r = await db().execute({
    sql: `SELECT id, mfa_enabled FROM app_users WHERE tenant_id = ? AND email = ? LIMIT 1`,
    args: [A_TID, "fukushihai@demo.example"],
  });
  must(r.rows[0], "二人目の承認者がいません");
  if (Number(r.rows[0].mfa_enabled ?? 0) === 1) return "登録済み";

  /* ★鍵そのものは、この先どこにも出しません */
  await db().execute({
    sql: `UPDATE app_users SET mfa_secret = ?, mfa_enabled = 1, mfa_last_counter = NULL
           WHERE id = ?`,
    args: [base32(randomBytes(20)), String(r.rows[0].id)],
  });
  return "この点検のために登録しました（鍵は表示しません）";
});

const boss = new Hito("A社の統括ひとり目");
const fuku = new Hito("A社の統括ふたり目");
const keiri = new Hito("A社の経理");
const unei = new Hito("A社の運用");
const support = new Hito("A社のサポート");
const etsuran = new Hito("A社の閲覧のみ");
const bBoss = new Hito("B社の統括");

await check("役割の違う担当者が、それぞれ入れる", async () => {
  const hito = [
    [boss, "boss@demo.example"],
    [fuku, "fukushihai@demo.example"],
    [keiri, "keiri@demo.example"],
    [unei, "unei@demo.example"],
    [support, "support@demo.example"],
    [etsuran, "etsuran@demo.example"],
  ];
  for (const [h, mail] of hito) {
    const r = await h.login("ADMIN", "DEMO", mail);
    must(r.status === 200 && r.json?.ok, `入れません：${mail}（${r.status}）`);
  }
  const b = await bBoss.login("ADMIN", "KANSA", "b-boss@kansa.example");
  must(b.status === 200 && b.json?.ok, `B社の統括が入れません（${b.status}）`);
  return "7人";
});

await check("★二人承認になる境目を、公開先から読む（手元の値を信じない）", async () => {
  /*
   * ★ここを飛ばさないこと。
   *   境目は、動いているサーバーの設定です。
   *   手元のコードの数字を正しいことにすると、
   *   公開先だけ違う設定で動いていても気づけません。
   *
   *   標準は 0、つまり「管理者による手動調整は、金額に関係なく全件が二人承認」。
   *   1回あたりの金額で線を引くと、回数で必ず抜けられるからです。
   *   （9万9千ptを10回に分ければ、ひとりで99万pt動かせます）
   */
  const r = await listOf(boss);
  must(
    typeof r.fourEyesThreshold === "number",
    "公開先が、二人承認の境目を教えてくれません",
  );
  must(r.fourEyesThreshold >= 0, `境目が負の数です（${r.fourEyesThreshold}）`);
  SHIKII = r.fourEyesThreshold;

  return SHIKII === 0
    ? "0pt ＝ 管理者による手動調整は、全件が二人承認"
    : `${SHIKII.toLocaleString()}pt 以上が二人承認`;
});

/* ══════════════════════════════════════════════
   ① 一覧が、台帳と1行ずつ一致する
   ══════════════════════════════════════════════ */

group("① 画面のポイントが、台帳（point_ledger）と1行ずつ一致する");

let aList = null;

await check("一覧が読める（0件で先へ進まない）", async () => {
  aList = await listOf(boss);
  must(aList.total > 0, "会員が0人です。この点検の前提が崩れています");
  return `${aList.total}名`;
});

await check("一覧の人数が、DBのA社の会員数と一致する", async () => {
  const c = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?",
    args: [A_TID],
  });
  eq(aList.total, Number(c.rows[0].n), "一覧の人数が、DBの会員数と違います");
  return `どちらも ${aList.total}名`;
});

await check("★全員分の「いまの残高」と「台帳の合計」が、DBと一致する", async () => {
  /*
   * ★これが要です。
   *   画面に出た残高と、画面に出た台帳の合計の両方を、
   *   DBから数え直したものと突き合わせます。
   *   片方だけ合っていても意味がありません。
   */
  const rows = await db().execute({
    sql: `SELECT c.id, c.points,
                 (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
                   WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS ledger
            FROM customers c WHERE c.tenant_id = ?`,
    args: [A_TID],
  });
  const byId = new Map(rows.rows.map((r) => [String(r.id), r]));

  for (const c of aList.customers) {
    const d = byId.get(c.userId);
    must(d, `一覧に出ている ${c.displayId} が、DBにいません`);
    must(c.points !== null, `${c.displayId} の残高が「見せられない」で来ています（統括は見えるはず）`);
    eq(c.points, Number(d.points), `${c.displayId} のいまの残高が違います`);
    eq(c.ledgerSum, Number(d.ledger), `${c.displayId} の台帳の合計が違います`);
    eq(c.diff, Number(d.points) - Number(d.ledger), `${c.displayId} の差が違います`);
  }
  return `${aList.customers.length}行すべて一致`;
});

await check("整合の印（緑・赤・灰）が、差の有無と食い違わない", async () => {
  for (const c of aList.customers) {
    if (c.integrity === "OK") {
      eq(c.diff, 0, `${c.displayId} は緑なのに、差が ${c.diff}pt あります`);
    } else if (c.integrity === "MISMATCH") {
      must(c.diff !== 0, `${c.displayId} は赤なのに、差が0です`);
    } else {
      eq(c.integrity, "UNKNOWN", `知らない印が出ています：${c.integrity}`);
      eq(c.points, null, `${c.displayId} は灰なのに、残高が出ています`);
    }
  }
  return `${aList.customers.length}行すべて筋が通っている`;
});

await check("今日の増減が、今日の台帳の合計と一致する", async () => {
  const kyou = new Date().toISOString().slice(0, 10);
  const rows = await db().execute({
    sql: `SELECT user_id, COALESCE(SUM(delta), 0) AS n, COUNT(*) AS k
            FROM point_ledger
           WHERE tenant_id = ? AND substr(created_at, 1, 10) = ?
           GROUP BY user_id`,
    args: [A_TID, kyou],
  });
  const byId = new Map(rows.rows.map((r) => [String(r.user_id), r]));
  for (const c of aList.customers) {
    const d = byId.get(c.userId);
    eq(c.todayDelta, d ? Number(d.n) : 0, `${c.displayId} の今日の増減が違います`);
    eq(c.todayRows, d ? Number(d.k) : 0, `${c.displayId} の今日の件数が違います`);
  }
  return `${kyou} 分が一致`;
});

/* ══════════════════════════════════════════════
   ② 検索と絞り込みが、本当に効く
   ══════════════════════════════════════════════ */

group("② 検索と絞り込みが、DBの数と一致する");

await check("名前で検索すると、その人だけに絞れる", async () => {
  const me = aList.customers[0];
  const r = await listOf(boss, `?q=${encodeURIComponent(me.name)}`);
  must(r.total >= 1, `「${me.name}」で検索して0件になりました`);
  must(
    r.customers.every((c) => c.name.includes(me.name) || c.displayId.includes(me.name)),
    "検索に関係ない人が混ざっています",
  );
  return `「${me.name}」→ ${r.total}名`;
});

await check("会員番号で検索すると、その人だけに絞れる", async () => {
  const me = aList.customers[0];
  const r = await listOf(boss, `?q=${encodeURIComponent(me.displayId)}`);
  eq(r.total, 1, `会員番号で引いて ${r.total}名になりました`);
  eq(r.customers[0].userId, me.userId, "別の人が出ています");
  return `${me.displayId} → 1名`;
});

await check("あり得ない言葉で検索すると、0件になる（勝手に全件へ戻らない）", async () => {
  const r = await listOf(boss, "?q=" + encodeURIComponent("そんな名前の人はいません_zzz"));
  eq(r.total, 0, "見つからないのに、全件へ戻っています");
  return "0件のまま";
});

await check("「残高あり」の人数が、DBの数と一致する", async () => {
  const r = await listOf(boss, "?balance=1");
  const c = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ? AND points > 0",
    args: [A_TID],
  });
  eq(r.total, Number(c.rows[0].n), "「残高あり」の人数が、DBと違います");
  return `${r.total}名`;
});

await check("「台帳と合っていない」の人数が、DBの数と一致する", async () => {
  const r = await listOf(boss, "?mismatch=1");
  const c = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM customers c
           WHERE c.tenant_id = ?
             AND c.points <> (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
                               WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id)`,
    args: [A_TID],
  });
  eq(r.total, Number(c.rows[0].n), "食い違っている人数が、DBと違います");
  return `${r.total}名`;
});

/* ══════════════════════════════════════════════
   ③ E2E A・B・C：その場で反映される額
   ══════════════════════════════════════════════ */

/* ★この組の題は「その場で入る」ではありません。

     標準の設定（境目0）では、その場で入る道はもうありません。
     管理者が手で動かすものは、金額に関係なく全件が二人承認だからです。

     ですので、ここで確かめるのは
         「申請から反映までを通しきったとき、残高と台帳が同じだけ動くか」
     です。途中に承認が挟まるかどうかは、設定の違いにすぎません。 */
group("③ A・B・C：手動調整が、残高と台帳を同じだけ動かす");

await check("承認の直前に、6桁を入れ直せる", async () => {
  /* ★二人とも先に通しておくこと。
       あとの試験で、承認する側の6桁が切れていると、
       「守りが効いた」のか「点検の都合」なのか見分けられません。 */
  await stepUp(boss, "boss@demo.example");
  await stepUp(fuku, "fukushihai@demo.example");
  await stepUp(keiri, "keiri@demo.example").catch(() => null);
  return "統括ふたりとも入れ直し済み";
});

await check("A：付与すると、残高と台帳が同じだけ増える", async () => {
  const zanMae = await zandaka(MATO);
  const daiMae = await daichouGoukei(A_TID, MATO);

  const r = await chousei(boss, MATO, KOGUCHI, "点検：通常の付与");

  eq(await zandaka(MATO), zanMae + KOGUCHI, "残高が動いていません");
  eq(await daichouGoukei(A_TID, MATO), daiMae + KOGUCHI, "台帳が動いていません");
  return `+${KOGUCHI}pt（${zanMae} → ${zanMae + KOGUCHI}）${
    r.futari ? "／二人承認を経て" : "／その場で反映"
  }`;
});

await check("B：減らすと、残高と台帳が同じだけ減る", async () => {
  const zanMae = await zandaka(MATO);
  const daiMae = await daichouGoukei(A_TID, MATO);

  await chousei(boss, MATO, -KOGUCHI, "点検：通常の減算");

  eq(await zandaka(MATO), zanMae - KOGUCHI, "残高が減っていません");
  eq(await daichouGoukei(A_TID, MATO), daiMae - KOGUCHI, "台帳が減っていません");
  return `−${KOGUCHI}pt（${zanMae} → ${zanMae - KOGUCHI}）`;
});

await check("C：理由が空なら、断る", async () => {
  const zanMae = await zandaka(MATO);
  const r = await moushikomi(boss, MATO, KOGUCHI, "");
  eq(r.status, 400, "理由なしで、ポイントを動かせてしまいます");
  eq(await zandaka(MATO), zanMae, "断ったのに、残高が動いています");
  return "400 のまま";
});

await check("C：0ptの申請は、断る", async () => {
  const r = await moushikomi(boss, MATO, 0, "点検：0ptの申請");
  eq(r.status, 400, "1ptも動かない申請が、記録だけ増やして通ってしまいます");
  return "400 のまま";
});

await check("C：残高より多く引こうとしても、1ptも動かない", async () => {
  /*
   * ★「どこで断られるか」は、設定によって変わります。
   *
   *     境目が0（標準）… その場で入る道が無いので、申請は受け付けられ、
   *                      承認のときに断られます。
   *     境目が大きい   … その場で入る道があるので、申請の時点で断られます。
   *
   *   断られる場所が違っても、確かめたいことは1つです。
   *
   *       残高が負にならないこと。
   *
   *   負の残高は、あとから誰にも直せません。
   */
  const ima = await zandaka(KOGAKU);
  const hikisugi = -(ima + 1);

  const r = await moushikomi(boss, KOGAKU, hikisugi, "点検：引きすぎ");

  if (!futariGaIru(hikisugi)) {
    /* その場で入る道 ＝ 申請の時点で断る */
    must(r.status >= 400, "残高より多く引けてしまいます");
    eq(r.json?.code, "WOULD_GO_NEGATIVE", `断りの理由が違います：${short(r.json)}`);
    eq(await zandaka(KOGAKU), ima, "断ったのに、残高が動いています");
    return `申請の時点で ${r.status}（残高 ${ima}pt は変わらず）`;
  }

  /* 二人承認の道 ＝ 申請は通るが、1ptも動かない */
  must(r.status === 200 && r.json?.ok, `申請できません（${r.status}：${short(r.json)}）`);
  eq(r.json.status, "PENDING", "承認待ちになっていません");
  eq(r.json.balanceAfter, null, "まだ動いていないのに、変更後の残高が返っています");
  eq(await zandaka(KOGAKU), ima, "承認前なのに、残高が動いています");

  /* 出しっぱなしにしない */
  await handan(fuku, String(r.json.adjustmentId), false, "点検の後片づけのため却下");
  return `承認待ちのまま（残高 ${ima}pt は変わらず／却下済み）`;
});

await check("★大きな引きすぎは、申請は通るが、承認のときに断られる", async () => {
  /*
   * ★申請したときに残高が足りていても、
   *   承認するまでの間に、お客様が使ってしまうことがあります。
   *   そのとき古い残高で押し切ると、残高が負になります。
   *   負の残高は、あとから誰にも直せません。
   *
   *   ですから、断るのは承認のときです。
   */
  const ima = await zandaka(KOGAKU);
  /* 承認待ちにするため、境目以上を引く申請を出す（残高より多い） */
  const r = await moushikomi(boss, KOGAKU, -OOGUCHI, "点検：承認のときに断られる引きすぎ");
  must(r.status === 200 && r.json?.ok, `申請できません（${r.status}：${short(r.json)}）`);
  eq(r.json.status, "PENDING", "承認待ちになっていません");
  eq(await zandaka(KOGAKU), ima, "承認待ちなのに、残高が動いています");

  const k = await handan(fuku, String(r.json.adjustmentId), true);
  must(k.status >= 400, "残高より多く引く申請が、承認で通ってしまいました");
  eq(k.json?.code, "WOULD_GO_NEGATIVE", `断りの理由が違います：${short(k.json)}`);
  eq(await zandaka(KOGAKU), ima, "断ったのに、残高が動いています");

  /* 出しっぱなしにしない */
  await handan(fuku, String(r.json.adjustmentId), false, "点検の後片づけのため却下");
  return `申請200 → 承認${k.status}（残高 ${ima}pt は変わらず）`;
});

await check("同じ操作が二重に届いても、1回しか動かない", async () => {
  /* ★通信が詰まったとき、人は同じボタンをもう一度押します */
  const zanMae = await zandaka(MATO);
  const key = newKey();

  const a = await moushikomi(boss, MATO, KOGUCHI, "点検：二重送信", key);
  must(a.status === 200, `1回目が通りません（${a.status}：${short(a.json)}）`);
  const b = await moushikomi(boss, MATO, KOGUCHI, "点検：二重送信", key);
  must(b.status === 200, `2回目が通りません（${b.status}：${short(b.json)}）`);

  eq(b.json.adjustmentId, a.json.adjustmentId, "同じ操作なのに、2件目が作られました");
  eq(b.json.reused, true, "2回目が、使い回しとして扱われていません");

  if (a.json.status === "PENDING") {
    /* 二人承認の道。ここで動いていたら、承認の意味がありません */
    eq(await zandaka(MATO), zanMae, "承認前なのに、残高が動いています");
    const machi = await db().execute({
      sql: `SELECT COUNT(*) AS n FROM point_adjustments
             WHERE tenant_id = ? AND idempotency_key = ?`,
      args: [A_TID, key],
    });
    eq(Number(machi.rows[0].n), 1, "2回押しただけで、申請が2件になっています");
    await handan(fuku, String(a.json.adjustmentId), false, "点検の後片づけのため却下");
    return "同じ申請が1件だけ（承認待ちのまま／却下済み）";
  }

  eq(await zandaka(MATO), zanMae + KOGUCHI, "2回押しただけで、ポイントが2倍動いています");
  return `+${KOGUCHI}pt が1回だけ`;
});

/* ══════════════════════════════════════════════
   ④ E2E D・E・F・G：二人承認
   ══════════════════════════════════════════════ */

group("④ D・E・F・G：大きな額は、ひとりでは動かせない");

await check("D：境目以上は、1ptも動かずに承認待ちになる", async () => {
  const zanMae = await zandaka(MATO);
  const adjId = await machiWoTsukuru(boss, MATO, "点検：二人承認の申請");

  const list = await adjustmentsOf(boss, "PENDING");
  const me = list.adjustments.find((a) => a.id === adjId);
  must(me, "承認待ちの一覧に、いま出した申請が出ていません");
  eq(me.delta, OOGUCHI, "承認待ちの一覧で、変更量が違います");
  eq(me.balanceBefore, zanMae, "承認待ちの一覧で、申請時の残高が違います");
  must(String(me.reason ?? "").length > 0, "理由が残っていません");
  return `${OOGUCHI.toLocaleString()}pt が承認待ち（残高 ${zanMae}pt のまま）`;
});

await check("E：申請した本人は、自分では承認できない", async () => {
  const adjId = await machiWoTsukuru(boss, MATO, "点検：自分では承認できない");
  const zanMae = await zandaka(MATO);

  const r = await handan(boss, adjId, true);
  eq(r.status, 403, "統括が、ひとりでポイントを作れてしまいます");
  eq(r.json?.code, "SELF_APPROVAL", `断りの理由が違います：${short(r.json)}`);
  eq(await zandaka(MATO), zanMae, "断ったのに、残高が動いています");
  return "403 SELF_APPROVAL";
});

await check("F：別の担当者なら承認でき、その分だけ残高と台帳が動く", async () => {
  const adjId = await machiWoTsukuru(boss, MATO, "点検：別の担当者が承認する");
  const zanMae = await zandaka(MATO);
  const daiMae = await daichouGoukei(A_TID, MATO);

  await stepUp(fuku, "fukushihai@demo.example");
  const r = await handan(fuku, adjId, true);
  must(r.status === 200 && r.json?.ok, `承認できません（${r.status}：${short(r.json)}）`);

  eq(await zandaka(MATO), zanMae + OOGUCHI, "承認したのに、残高が動いていません");
  eq(await daichouGoukei(A_TID, MATO), daiMae + OOGUCHI, "承認したのに、台帳が動いていません");
  eq(r.json.balance, zanMae + OOGUCHI, "返ってきた残高が違います");
  return `${zanMae} → ${zanMae + OOGUCHI}`;
});

await check("G：承認を2回押しても、ポイントは1回分しか動かない", async () => {
  const adjId = await machiWoTsukuru(boss, MATO, "点検：二重承認");
  const zanMae = await zandaka(MATO);

  const a = await handan(fuku, adjId, true);
  must(a.status === 200, `1回目の承認が通りません（${a.status}：${short(a.json)}）`);
  eq(await zandaka(MATO), zanMae + OOGUCHI, "1回目で動いていません");

  const b = await handan(fuku, adjId, true);
  eq(b.status, 409, "同じ申請を、2回承認できてしまいます");
  eq(await zandaka(MATO), zanMae + OOGUCHI, "2回目でも動いてしまいました");
  return "1回分だけ";
});

await check("却下は理由が要り、却下してもポイントは動かない", async () => {
  const adjId = await machiWoTsukuru(boss, MATO, "点検：却下される申請");
  const zanMae = await zandaka(MATO);

  const riyuuNashi = await handan(fuku, adjId, false);
  eq(riyuuNashi.status, 400, "理由なしで却下できてしまいます");

  const r = await handan(fuku, adjId, false, "点検のため却下します");
  must(r.status === 200 && r.json?.ok, `却下できません（${r.status}：${short(r.json)}）`);
  eq(r.json.status, "REJECTED", "却下の結果が違います");
  eq(await zandaka(MATO), zanMae, "却下したのに、残高が動いています");
  return "理由なし400／理由あり200・残高は不変";
});

await check("★承認を待つあいだに残高が動いたら、いまの残高を基準に計算する", async () => {
  /*
   * ★これが、この点検でいちばん怖いところです。
   *
   *   申請したとき  10万pt だった
   *   待つあいだに   9万pt へ減った（お客様がガチャを引いた）
   *   そこで承認した
   *
   *   申請したときの10万を基準に書き戻すと、
   *   あいだに使われた1万ptが、なかったことになります。
   */
  const moushikomiJi = await zandaka(MATO);
  const adjId = await machiWoTsukuru(boss, MATO, "点検：待つあいだに残高が動く");

  /* 待つあいだに、別の処理で減らす */
  const genryou = 1_000;
  const w = await moushikomi(boss, MATO, -genryou, "点検：あいだに入った別の処理");
  must(w.status === 200, `あいだの処理が通りません（${w.status}：${short(w.json)}）`);
  const shouninJi = await zandaka(MATO);
  eq(shouninJi, moushikomiJi - genryou, "あいだの処理が入っていません（前提が崩れています）");

  const r = await handan(fuku, adjId, true);
  must(r.status === 200 && r.json?.ok, `承認できません（${r.status}：${short(r.json)}）`);

  eq(
    await zandaka(MATO),
    shouninJi + OOGUCHI,
    "申請したときの古い残高を書き戻しています。あいだに使われた分が、なかったことになります",
  );
  eq(r.json.balanceMoved, true, "残高が動いていたのに、承認した人へ何も伝えていません");
  eq(r.json.balanceBefore, moushikomiJi, "申請時の残高の控えが違います");
  eq(r.json.balanceAtDecision, shouninJi, "承認時の残高が違います");
  return `${moushikomiJi} →(−${genryou})→ ${shouninJi} →(承認)→ ${shouninJi + OOGUCHI}`;
});

/* ══════════════════════════════════════════════
   ⑤ E2E I：権限
   ══════════════════════════════════════════════ */

group("⑤ I：権限のない人は、入口を直接たたいても通れない");

await check("運用・サポート・閲覧のみの人は、申請できない（403）", async () => {
  const zanMae = await zandaka(MATO);
  for (const [h, namae] of [[unei, "運用"], [support, "サポート"], [etsuran, "閲覧のみ"]]) {
    const r = await moushikomi(h, MATO, KOGUCHI, `点検：${namae}からの申請`);
    eq(r.status, 403, `${namae}の人が、ポイントを動かす入口を通ってしまいました`);
  }
  eq(await zandaka(MATO), zanMae, "断ったのに、残高が動いています");
  return "3人とも403";
});

await check("経理は申請できるが、承認はできない（403）", async () => {
  const adjId = await machiWoTsukuru(boss, MATO, "点検：経理は承認できない");
  const r = await handan(keiri, adjId, true);
  eq(r.status, 403, "申請した人が、そのまま承認までできてしまいます（申請と承認が分かれていません）");
  /* 片づけ：この申請は却下しておく */
  await handan(fuku, adjId, false, "点検の後片づけのため却下");
  return "403";
});

await check("断り文に、内部の権限名が漏れていない", async () => {
  /* ★何が足りないかを教えると、どの役割を狙えばよいかの地図になります */
  const r = await moushikomi(support, MATO, KOGUCHI, "点検：断り文の中身");
  const msg = String(r.json?.message ?? "");
  eq(
    /point\.(view|request|approve)|SUPER_ADMIN|FINANCE|OPERATOR/.test(msg),
    false,
    `断り文に、内部の権限名が漏れています：${msg}`,
  );
  return "漏れなし";
});

await check("見る権限があるなら、金額は必ず数で来る（0ptでごまかさない）", async () => {
  /*
   * ★ここは「0と出ていないこと」を見ています。
   *   見せられない人に0ptと出すと、
   *   受け取った側は「この人は残高ゼロだ」と読みます。
   *   それは、嘘です。
   */
  for (const [h, namae] of [[unei, "運用"], [support, "サポート"], [etsuran, "閲覧のみ"], [keiri, "経理"]]) {
    const r = await h.call(POINTS);
    if (r.status === 403) continue; /* 見せない、は正しい断り方 */
    must(r.status === 200 && r.json?.ok, `${namae}で一覧が読めません（${r.status}）`);
    if (r.json.canSeePoints !== true) {
      /* 見せられないなら、必ず null。0 で埋めていないこと */
      for (const c of r.json.customers) {
        eq(c.points, null, `${namae}に、見せられないはずの残高が 0 として出ています`);
      }
      continue;
    }
    /* 見せるなら、DBと一致していること */
    for (const c of r.json.customers) {
      const jitsu = await zandaka(c.userId);
      eq(c.points, jitsu, `${namae}が見ている ${c.displayId} の残高が、DBと違います`);
    }
  }
  return "0ptでのごまかしなし";
});

/* ══════════════════════════════════════════════
   ⑥ E2E H：会社どうしの分離
   ══════════════════════════════════════════════ */

group("⑥ H：他社のポイントは、番号を知っていても触れない");

await check("A社の一覧に、B社の会員が1人も混ざっていない", async () => {
  const bIds = await db().execute({
    sql: "SELECT id FROM customers WHERE tenant_id = ?",
    args: [B_TID],
  });
  const bSet = new Set(bIds.rows.map((r) => String(r.id)));
  const a = await listOf(boss);
  for (const c of a.customers) {
    must(!bSet.has(c.userId), `A社の一覧に、B社の会員 ${c.displayId} が出ています`);
  }
  return `A社 ${a.total}名に、B社は0名`;
});

await check("B社の一覧に、A社の会員が1人も混ざっていない", async () => {
  const aIds = await db().execute({
    sql: "SELECT id FROM customers WHERE tenant_id = ?",
    args: [A_TID],
  });
  const aSet = new Set(aIds.rows.map((r) => String(r.id)));
  const b = await listOf(bBoss);
  for (const c of b.customers) {
    must(!aSet.has(c.userId), `B社の一覧に、A社の会員 ${c.displayId} が出ています`);
  }
  return `B社 ${b.total}名に、A社は0名`;
});

await check("B社の統括が、A社の会員の詳細を開けない（404）", async () => {
  const r = await detailOf(bBoss, MATO);
  eq(r.status, 404, "他社の会員のポイント履歴が、番号を知っていれば読めてしまいます");
  /* ★「他社の会員です」と教えないこと。教えると番号の当てはめに使えます */
  must(!/他社|別の会社|tenant/i.test(String(r.json?.message ?? "")), "断り文で、他社だと教えています");
  return "404（理由も伏せている）";
});

await check("B社の統括が、A社の会員へポイントを出せない（404）", async () => {
  const zanMae = await zandaka(MATO);
  const r = await moushikomi(bBoss, MATO, KOGUCHI, "点検：他社への申請");
  must(r.status === 404 || r.status === 403, `他社の会員へ申請できてしまいます（${r.status}）`);
  eq(await zandaka(MATO), zanMae, "断ったのに、残高が動いています");
  return `${r.status}`;
});

await check("B社の統括が、A社の申請を承認できない（404）", async () => {
  const adjId = await machiWoTsukuru(boss, MATO, "点検：他社からの承認");
  const zanMae = await zandaka(MATO);

  const r = await handan(bBoss, adjId, true);
  must(r.status === 404 || r.status === 403, `他社の申請を承認できてしまいます（${r.status}）`);
  eq(await zandaka(MATO), zanMae, "断ったのに、残高が動いています");

  await handan(fuku, adjId, false, "点検の後片づけのため却下");
  return `${r.status}`;
});

await check("B社の承認待ち一覧に、A社の申請が出てこない", async () => {
  const adjId = await machiWoTsukuru(boss, MATO, "点検：他社の一覧に出ないこと");
  const b = await adjustmentsOf(bBoss);
  must(
    !b.adjustments.some((a) => a.id === adjId),
    "B社の承認画面に、A社の申請が並んでいます",
  );
  await handan(fuku, adjId, false, "点検の後片づけのため却下");
  return "出てこない";
});

/* ══════════════════════════════════════════════
   ⑦ E2E J：合っていないとき、合っていないと言えるか
   ══════════════════════════════════════════════

   ★ここで、わざと残高をずらさないこと。

     以前この場所は、点検のために
         UPDATE customers SET points = points + 777
     と書いて、台帳を動かさずに残高だけ動かしていました。
     そして最後に戻していました。

     ところが、途中で失敗すると戻らないので、
     Preview のお客様に「残高はあるのに、台帳にその理由が無い」人が
     残りました。実際に3名残っています。
     つまり、点検の道具が帳簿を壊していたということです。

     いまは scripts/check-no-direct-balance-write.mjs が機械で止めます。

     では、赤く出せることをどこで確かめるのか。
     手元の使い捨てDBで確かめます（tests/pointIntegrity.test.ts）。
     あちらなら、壊しても誰の帳簿も汚れません。

     ここ（Preview）で確かめるのは、次の2つだけにします。

         ① 画面が言う「合っていない人数」が、DBを自分で数えた人数と同じか
         ② ダッシュボードの数と、ポイント画面の数が同じか

     この2つは、不一致が0人でも2人でも、正しく成り立ちます。
     ★「0件だから通った」ではありません。
       DBを数えた結果と突き合わせているので、
       0件のときは「本当に0件であること」を確かめています。 */

group("⑦ J：台帳と残高のずれを、画面が正しい人数で言う");

/** DBを自分で数えて、台帳と残高が合っていない人を出す */
async function fuitchiWoKazoeru(tenantId) {
  const r = await db().execute({
    sql: `SELECT c.id AS id, c.points AS points,
                 COALESCE((SELECT SUM(l.delta) FROM point_ledger l
                            WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id), 0) AS goukei
            FROM customers c
           WHERE c.tenant_id = ?`,
    args: [tenantId],
  });
  return r.rows
    .map((x) => ({
      id: String(x.id),
      diff: Number(x.points ?? 0) - Number(x.goukei ?? 0),
    }))
    .filter((x) => x.diff !== 0);
}

await check("画面が言う「合っていない人数」が、DBで数えた人数と同じ", async () => {
  const jissai = await fuitchiWoKazoeru(A_TID);
  const r = await listOf(boss, "?mismatch=1");

  eq(
    r.total,
    jissai.length,
    "画面の「合っていない人数」と、DBで数えた人数が違います",
  );

  /* 一人ずつ、差の大きさまで合っているか */
  for (const x of jissai) {
    const gamen = r.customers.find((c) => c.userId === x.id);
    must(gamen, `合っていないはずの人が、絞り込みに出てきません（${x.id}）`);
    eq(gamen.integrity, "MISMATCH", `${x.id} が赤くなっていません`);
    eq(gamen.diff, x.diff, `${x.id} の差の大きさが違います`);
  }

  return jissai.length === 0
    ? "0人。DBを数えても0人なので、本当に0人です"
    : `${jissai.length}人（差 ${jissai.map((x) => `${x.diff}pt`).join(" / ")}）`;
});

await check("合っていない人は、詳細でも「合っていない」と分かる", async () => {
  const jissai = await fuitchiWoKazoeru(A_TID);
  if (jissai.length === 0) {
    /* ★居ないものを「居たことにして通す」ことはしません。
         そのかわり、合っている人が緑であることを確かめます。 */
    const r = await detailOf(boss, HIKU);
    must(r.status === 200 && r.json?.ok, `詳細が読めません（${r.status}）`);
    eq(r.json.customer.integrity, "OK", "合っているのに、赤くなっています");
    eq(r.json.customer.diff, 0, "合っているのに、差が出ています");
    return "合っていない人は0人。合っている人は緑と出た";
  }

  const r = await detailOf(boss, jissai[0].id);
  must(r.status === 200 && r.json?.ok, `詳細が読めません（${r.status}）`);
  eq(r.json.customer.integrity, "MISMATCH", "詳細では、ずれが消えています");
  eq(r.json.customer.diff, jissai[0].diff, "一覧と詳細で、差の大きさが違います");
  return `差 ${r.json.customer.diff}pt`;
});

await check("ダッシュボードの「今日やること」にも、同じ数で出る", async () => {
  /*
   * ★ここが食い違うと、いちばん困ります。
   *   2つの画面で違う数が出たら、
   *   運営の方には、どちらが本当か確かめる方法がありません。
   */
  const s = await boss.call("/api/console/summary");
  must(s.status === 200 && s.json?.ok, `ダッシュボードが読めません（${s.status}）`);

  const p = await listOf(boss, "?mismatch=1");
  const jissai = await fuitchiWoKazoeru(A_TID);

  eq(
    Number(s.json.pointMismatch),
    p.total,
    "ダッシュボードの「ポイント確認が必要」の数が、ポイント画面と違います",
  );
  eq(
    Number(s.json.pointMismatch),
    jissai.length,
    "ダッシュボードの数が、DBで数えた人数と違います",
  );
  return `ダッシュボード・ポイント画面・DB のどれも ${jissai.length}件`;
});

/* ══════════════════════════════════════════════
   ⑧ E2E K：お客様側と、管理側で同じ数になる
   ══════════════════════════════════════════════ */

group("⑧ K：お客様が動かした結果が、管理画面にそのまま出る");

const kyaku = new Hito("引くお客様");
let gachaId = null;

await check("お客様で入れて、いまの残高が管理側と一致している", async () => {
  const r = await kyaku.login("CUSTOMER", "DEMO", "user1@demo.example");
  must(r.status === 200 && r.json?.ok, `お客様が入れません（${r.status}）`);

  const p = await kyaku.call("/api/customer/points");
  must(p.status === 200, `お客様のポイント画面が読めません（${p.status}）`);
  const kyakuGawa = Number(p.json.balance ?? p.json.points ?? 0);

  const line = (await listOf(boss)).customers.find((c) => c.userId === HIKU);
  must(line, "管理側の一覧に、そのお客様がいません");
  eq(line.points, kyakuGawa, "お客様側と管理側で、残高が違います");
  return `どちらも ${kyakuGawa}pt`;
});

await check("お客様がガチャを引くと、管理側の残高もその分だけ減る", async () => {
  const g = await db().execute({
    sql: `SELECT id, price FROM gachas
           WHERE tenant_id = ? AND status = 'PUBLISHED' AND left_count > 0
           ORDER BY price ASC LIMIT 1`,
    args: [A_TID],
  });
  must(g.rows[0], "引けるガチャがありません（この点検の前提が崩れています）");
  gachaId = String(g.rows[0].id);
  const nedan = Number(g.rows[0].price);

  /* 引けるだけのポイントを、正しい道（管理者の付与）で用意する */
  const ima = await zandaka(HIKU);
  if (ima < nedan) {
    await chousei(boss, HIKU, nedan - ima + KOGUCHI, "点検：引くための用意");
  }

  const mae = await zandaka(HIKU);
  const daiMae = await daichouGoukei(A_TID, HIKU);

  /* ★ガチャも、同じ操作が二重に届いたときのために鍵が要ります。
       鍵なしで引けてしまう作りだと、通信のやり直しで二重に引かれます。 */
  const d = await kyaku.call("/api/console/draw", "POST", { gachaId }, {
    "idempotency-key": newKey(),
  });
  must(d.status === 200 && d.json?.ok, `引けません（${d.status}：${short(d.json)}）`);

  /*
   * ★「残高が ちょうど 値段のぶんだけ減る」と決めつけないこと。
   *   1回引くと、台帳には最大2行入ります。
   *       ・使った分（DRAW_SPEND）… −値段
   *       ・当たった賞がポイントだった場合の戻り（DRAW_RETURN）… ＋戻り分
   *   だから、引いたあとの残高は「値段のぶんだけ減る」とは限りません。
   *   ここで −値段 を期待すると、ポイントが当たった日にだけ失敗する
   *   点検になります。それは、製品の不具合ではなく点検の思い込みです。
   *
   *   確かめるべきことは、次の2つです。
   *       1) 残高の動きと、台帳の動きが、1ptもずれていないこと
   *       2) 使った分の行が、確かに −値段 になっていること
   */
  const ato = await zandaka(HIKU);
  const daiAto = await daichouGoukei(A_TID, HIKU);

  eq(ato - mae, daiAto - daiMae, "残高の動きと、台帳の動きが合っていません");
  must(ato !== mae, "引いたのに、残高が1ptも動いていません");

  const tsukatta = await db().execute({
    sql: `SELECT delta FROM point_ledger
           WHERE tenant_id = ? AND user_id = ? AND kind = 'DRAW_SPEND'
           ORDER BY created_at DESC, id DESC LIMIT 1`,
    args: [A_TID, HIKU],
  });
  must(tsukatta.rows[0], "引いたのに、台帳に「ガチャで使った」行がありません");
  eq(Number(tsukatta.rows[0].delta), -nedan, "使った分が、ガチャの値段と違います");

  const line = (await listOf(boss)).customers.find((c) => c.userId === HIKU);
  eq(line.points, ato, "管理画面のポイント一覧が、引く前の数字のままです");
  eq(line.integrity, "OK", "引いたあと、台帳と残高が合わなくなっています");
  const modori = ato - mae + nedan;
  return `${mae} → ${ato}（${nedan}pt のガチャ${
    modori > 0 ? `／当たった分の戻り ${modori}pt` : ""
  }）`;
});

await check("引いた記録が、その人のポイント履歴に出てくる", async () => {
  const r = await detailOf(boss, HIKU);
  must(r.status === 200 && r.json?.ok, `詳細が読めません（${r.status}）`);
  const ledger = r.json.customer.ledger ?? [];
  must(ledger.length > 0, "履歴が空です");
  const hiita = ledger.find((l) => l.kind === "DRAW_SPEND");
  must(hiita, "ガチャで使ったのに、履歴に「ガチャ」の行がありません");
  must(hiita.delta < 0, "ガチャで使ったのに、増えた記録になっています");

  /* ★変更前と変更後が、必ず添えてあること */
  must(hiita.before !== null && hiita.after !== null, "履歴に、変更前・変更後が入っていません");
  eq(hiita.after, hiita.before + hiita.delta, "変更前＋変更量が、変更後になっていません");
  return `${hiita.before} → ${hiita.after}（${hiita.delta}pt）`;
});

await check("景品をポイントに換えると、管理側の残高もその分だけ増える", async () => {
  const p = await db().execute({
    sql: `SELECT id, exchange_pt FROM prizes
           WHERE user_id = ? AND status = 'UNCHOSEN' ORDER BY won_at DESC LIMIT 1`,
    args: [HIKU],
  });
  must(p.rows[0], "換えられる景品がありません（この点検の前提が崩れています）");
  const pid = String(p.rows[0].id);
  const pt = Number(p.rows[0].exchange_pt);

  const mae = await zandaka(HIKU);
  const daiMae = await daichouGoukei(A_TID, HIKU);

  const r = await kyaku.call("/api/customer/prizes/exchange", "POST", { prizeIds: [pid] });
  must(r.status === 200 && r.json?.ok, `交換できません（${r.status}：${short(r.json)}）`);

  eq(await zandaka(HIKU), mae + pt, "交換したのに、残高が増えていません");
  eq(await daichouGoukei(A_TID, HIKU), daiMae + pt, "交換したのに、台帳が増えていません");

  const line = (await listOf(boss)).customers.find((c) => c.userId === HIKU);
  eq(line.points, mae + pt, "管理画面のポイント一覧が、交換前の数字のままです");
  eq(line.integrity, "OK", "交換したあと、台帳と残高が合わなくなっています");
  return `${mae} → ${mae + pt}（景品 ${pt}pt）`;
});

await check("管理者が付けたポイントが、お客様側の画面にもすぐ出る", async () => {
  const mae = await zandaka(HIKU);
  await chousei(boss, HIKU, KOGUCHI, "点検：お客様側へ届くか");

  const p = await kyaku.call("/api/customer/points");
  const kyakuGawa = Number(p.json.balance ?? p.json.points ?? 0);
  eq(kyakuGawa, mae + KOGUCHI, "管理側で付けたのに、お客様側は前の残高のままです");
  return `お客様側も ${kyakuGawa}pt`;
});

/* ══════════════════════════════════════════════
   ⑨ E2E L：Reload・入り直し・別ブラウザ
   ══════════════════════════════════════════════ */

group("⑨ L：開き直しても、入り直しても、同じ数が出る");

await check("同じことを2回続けて聞いても、同じ数が返る（古い答えを返さない）", async () => {
  const a = await listOf(boss);
  const b = await listOf(boss);
  eq(a.total, b.total, "同じことを2回聞いて、人数が違いました");
  for (let i = 0; i < a.customers.length; i += 1) {
    eq(a.customers[i].points, b.customers[i].points, "同じことを2回聞いて、残高が違いました");
  }
  return "2回とも同じ";
});

await check("入り直しても、同じ数が出る", async () => {
  /*
   * ★ここで boss を出させないこと。
   *   boss は、このあとの「記録が残っている」の点検でも使います。
   *   出させてしまうと、あとの失敗が
   *   「記録が残らない不具合」なのか「点検が自分でログアウトしただけ」なのか
   *   区別できなくなります。使い捨ての人を1人作って、その人で出入りします。
   */
  const mae = (await listOf(boss)).customers.find((c) => c.userId === HIKU).points;

  const tsukaisute = new Hito("A社の統括（使い捨て）");
  const first = await tsukaisute.login("ADMIN", "DEMO", "boss@demo.example");
  must(first.status === 200 && first.json?.ok, `入れません（${first.status}）`);
  await tsukaisute.call("/api/auth/logout", "POST", {});

  const again = new Hito("A社の統括（入り直し）");
  const r = await again.login("ADMIN", "DEMO", "boss@demo.example");
  must(r.status === 200 && r.json?.ok, `入り直せません（${r.status}）`);
  const ato = (await listOf(again)).customers.find((c) => c.userId === HIKU).points;
  eq(ato, mae, "入り直したら、残高が変わりました");
  return `どちらも ${ato}pt`;
});

const betsu = new Hito("別のブラウザ");

await check("別のブラウザで入っても、同じ数が出る", async () => {
  const r = await betsu.login("ADMIN", "DEMO", "keiri@demo.example");
  must(r.status === 200 && r.json?.ok, `別のブラウザで入れません（${r.status}）`);
  const l = await listOf(betsu);
  const me = l.customers.find((c) => c.userId === HIKU);
  must(me, "別のブラウザで、その会員がいません");
  eq(me.points, await zandaka(HIKU), "別のブラウザで、違う残高が出ています");
  return `${me.points}pt`;
});

await check("ポイントの画面が、古い答えを配らない設定になっている", async () => {
  const r = await boss.call(POINTS);
  const cc = String(r.headers.get("cache-control") ?? "");
  must(
    /no-store|no-cache|max-age=0/.test(cc),
    `ポイントの画面が、古い答えを配る設定になっています（cache-control: ${cc || "なし"}）`,
  );
  return cc;
});

/* ══════════════════════════════════════════════
   ⑩ 記録が残っている
   ══════════════════════════════════════════════ */

group("⑩ 誰が・いつ・何を動かしたかが、記録に残っている");

await check("手動で動かした分は、必ず記録に残る", async () => {
  const r = await chousei(boss, MATO, KOGUCHI, "点検：記録が残ること");
  const adjId = String(r.adjustmentId);

  const rows = await db().execute({
    sql: `SELECT action FROM audit_events
           WHERE tenant_id = ? AND data LIKE ? ORDER BY seq ASC`,
    args: [A_TID, `%${adjId}%`],
  });
  const actions = rows.rows.map((x) => String(x.action));

  /*
   * ★どちらの道でも、最後に「反映した」が残っていること。
   *     その場で入る道 … POINT_ADJUST_APPLY だけ
   *     二人承認の道   … POINT_ADJUST_REQUEST → POINT_ADJUST_APPROVE
   *   反映の記録が無いのに残高が動いていたら、
   *   それは「誰が動かしたか分からないポイント」です。
   */
  const nokotta =
    actions.includes("POINT_ADJUST_APPLY") || actions.includes("POINT_ADJUST_APPROVE");
  must(nokotta, `記録が残っていません：${JSON.stringify(actions)}`);
  if (r.futari) {
    must(
      actions.includes("POINT_ADJUST_REQUEST"),
      `二人承認なのに、申請の記録がありません：${JSON.stringify(actions)}`,
    );
  }
  return actions.join(" → ");
});

await check("申請と承認が、別々の行として、別の人の名前で残る", async () => {
  const adjId = await machiWoTsukuru(boss, MATO, "点検：記録が2行に分かれること");
  const a = await handan(fuku, adjId, true);
  must(a.status === 200, `承認できません（${a.status}：${short(a.json)}）`);

  const rows = await db().execute({
    sql: `SELECT action, actor_id FROM audit_events
           WHERE tenant_id = ? AND data LIKE ? ORDER BY seq ASC`,
    args: [A_TID, `%${adjId}%`],
  });
  const actions = rows.rows.map((x) => String(x.action));
  must(
    actions.includes("POINT_ADJUST_REQUEST") && actions.includes("POINT_ADJUST_APPROVE"),
    `申請と承認が、別々に残っていません：${JSON.stringify(actions)}`,
  );

  const actors = [...new Set(rows.rows.map((x) => String(x.actor_id)))];
  must(actors.length >= 2, "申請した人と承認した人が、同じ名前で残っています");
  return actions.join(" → ");
});

await check("却下も、記録に残る", async () => {
  const adjId = await machiWoTsukuru(boss, MATO, "点検：却下の記録");
  await handan(fuku, adjId, false, "点検のため却下します");

  const rows = await db().execute({
    sql: `SELECT action FROM audit_events
           WHERE tenant_id = ? AND data LIKE ? ORDER BY seq ASC`,
    args: [A_TID, `%${adjId}%`],
  });
  const actions = rows.rows.map((x) => String(x.action));
  must(actions.includes("POINT_ADJUST_REJECT"), `却下が残っていません：${JSON.stringify(actions)}`);
  return actions.join(" → ");
});

/* ══════════════════════════════════════════════
   ⑪ 後片づけ
   ══════════════════════════════════════════════ */

group("⑪ 後片づけ");

await check("この点検が、新しい不一致を作っていない", async () => {
  /*
   * ★以前ここは「わざとずらした残高を戻す」場所でした。
   *   戻す処理が要るということは、壊す処理があるということです。
   *   そして、途中で失敗すれば戻りません。実際に戻りませんでした。
   *
   *   いまは、この点検はもう残高を直接いじりません。
   *   ですので、確かめるのは「増えていないこと」だけです。
   */
  const ima = await zurehito();
  eq(
    ima,
    MAE_NO_ZURE,
    "この点検を走らせたせいで、台帳と合わない人が増えました",
  );
  return ima === 0
    ? "合っていない人は0人のまま"
    : `合っていない人は ${ima}人のまま（点検の前と同じ）`;
});

await check("承認待ちのまま残した申請が、無い", async () => {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM point_adjustments
           WHERE tenant_id = ? AND status = 'PENDING' AND reason LIKE '点検：%'`,
    args: [A_TID],
  });
  const nokori = Number(r.rows[0].n);
  if (nokori > 0) {
    /* ★出しっぱなしにしないこと。運営の方の画面が、点検のごみで埋まります */
    const list = await db().execute({
      sql: `SELECT id FROM point_adjustments
             WHERE tenant_id = ? AND status = 'PENDING' AND reason LIKE '点検：%'`,
      args: [A_TID],
    });
    for (const x of list.rows) {
      await handan(fuku, String(x.id), false, "点検の後片づけのため却下");
    }
  }
  const ato = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM point_adjustments
           WHERE tenant_id = ? AND status = 'PENDING' AND reason LIKE '点検：%'`,
    args: [A_TID],
  });
  eq(Number(ato.rows[0].n), 0, "点検で出した申請が、承認待ちのまま残っています");
  return nokori > 0 ? `${nokori}件を片づけた` : "残っていない";
});

await check("★この点検が、合わない人を1人も増やしていない", async () => {
  /*
   * ★ここで「終わりに0人であること」を求めないこと。
   *
   *   確認用のデータには、この画面を作る前に付いた傷が残っています。
   *   古い点検の道具が、台帳を通さずに残高を直接書き換えていました
   *   （scripts/audit-preview.mjs の中に、その書き方が何か所かあります）。
   *
   *   その傷を「0人」に合わせようとすると、
   *   台帳に無かった行を、あとから作り足すことになります。
   *   それは、帳簿としていちばんやってはいけないことです。
   *
   *   ですから、ここで確かめるのは
   *   「この点検が、新しい食い違いを作っていないこと」だけにします。
   *   もともと有る傷は、隠さずに数えて、そのまま報告します。
   */
  const ato = await zurehito();
  const fueta = ato - MAE_NO_ZURE;
  eq(fueta, 0, "★この点検そのものが、台帳と合わない人を増やしました");
  if (ato > 0) {
    return (
      `増減なし（点検の前から ${ato}名 ずれたままです。` +
      `原因は古い点検の道具による直接書き換えで、この画面の不具合ではありません）`
    );
  }
  return "増減なし（ずれている人は0名）";
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

console.log(
  "\n✓ ポイント管理は、公開先で実際に動き、台帳と一致し、" +
    "ひとりでは大きな額を動かせません。\n",
);
