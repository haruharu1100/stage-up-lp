/**
 * 「どのお店か」は、開いている住所からだけ決まっているか。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   お客様に「会社コード」を打たせるのをやめました。
 *   代わりに、開いている住所（shop-a.example.com など）から、
 *   サーバー側だけでお店を決めています。
 *
 *   便利になった代わりに、次の4つが必ず成り立っていないと、
 *   よそのお店の名簿・残高・獲得商品が見えてしまいます。
 *
 *     ① 住所からお店が決まること
 *     ② ブラウザから会社を指定できないこと
 *     ③ 住所を書き換えて、よそのお店へ入れないこと
 *     ④ 登録されていない住所は、はっきり断ること
 *
 *   この4つを、本物のサーバーに通信して確かめます。
 *
 * ═══════════════════════════════════════════════════════
 * ★住所の差し替え方
 * ═══════════════════════════════════════════════════════
 *
 *   手元では、いつも localhost です。別の住所で開いた状態は作れません。
 *   ですので、配信の裏側と同じやり方で差し替えます。
 *
 *       x-forwarded-host: shop-a.test.invalid
 *
 *   これは Vercel などが実際に使っている項目です。
 *   本物と同じ道を通るので、試験のためだけの抜け道にはなりません。
 *
 *   ★.invalid は、誰も持てないことが決まっている住所です。
 *     本物のお店の住所を、この試験に書かないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・使い捨ての会社を2つ作り、その中だけで動きます。
 *   ・メールは .example / .invalid だけを使います。
 *
 * 使い方：
 *   DATABASE_URL="file:./.data/e2e.db" DATABASE_ENV=development \
 *   npx tsx scripts/e2e-tenant-host.mjs http://localhost:3212
 */

import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");

if (!BASE || !/^https?:\/\//.test(BASE)) {
  console.error(
    "\n✗ 見に行く先のURLを指定してください。\n" +
      "  例： npx tsx scripts/e2e-tenant-host.mjs http://localhost:3212\n",
  );
  process.exit(1);
}

/* ── 安全装置。★外さないこと ───────────────── */
const DB_ENV = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (DB_ENV === "production") {
  console.error("\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n");
  process.exit(1);
}
if (!(process.env.DATABASE_URL ?? "").trim()) {
  console.error("\n✗ DATABASE_URL がありません。\n");
  process.exit(1);
}
if (/^https:\/\//.test(BASE) && !process.env.E2E_ALLOW_REMOTE) {
  console.error("\n✗ この道具は手元（http://localhost）専用です。\n");
  process.exit(1);
}

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const seed = await import(`${ROOT}/lib/server/seed.ts`);

const one = async (sql, args = []) => (await db().execute({ sql, args })).rows[0] ?? {};

/* ── 記録 ─────────────────────────────────── */
const kekka = [];
let ok = 0;
let ng = 0;
function T(no, name, pass, memo = "") {
  kekka.push({ no, name, pass: Boolean(pass), memo });
  if (pass) ok += 1;
  else ng += 1;
  console.log(`  ${pass ? "ok " : "NG "} ${no.padEnd(8)} ${name}`);
  if (memo) console.log(`          ${memo}`);
}
function H(t) {
  console.log(`\n══ ${t} ${"═".repeat(Math.max(0, 56 - t.length))}`);
}

/* ── 通信の道具 ────────────────────────────── */
async function hit(path, { host, method = "GET", body, cookie } = {}) {
  const headers = { "x-forwarded-host": host };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML のときは、そのまま文字で見ます */
  }
  return { status: res.status, text, json, res };
}

/** Set-Cookie から、送り返す形の1行を作る */
function cookiesFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

/* ══════════════════════════════════════════════
   下ごしらえ：お店を2つと、住所を2つ
   ══════════════════════════════════════════════ */
const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const SAI = Math.random().toString(36).slice(2, 5).toUpperCase();
const CODE_A = `THA${STAMP.slice(4)}${SAI}`.slice(0, 16);
const CODE_B = `THB${STAMP.slice(4)}${SAI}`.slice(0, 16);
const HOST_A = `shop-a-${SAI.toLowerCase()}.test.invalid`;
const HOST_B = `shop-b-${SAI.toLowerCase()}.test.invalid`;
const HOST_NASHI = `dokonimo-nai-${SAI.toLowerCase()}.test.invalid`;
const PASSWORD = `th-${STAMP}-Kakunin!`;
const MAIL_A = `th-a-${STAMP}-${SAI.toLowerCase()}@shop.example`;
const MAIL_B = `th-b-${STAMP}-${SAI.toLowerCase()}@shop.example`;

console.log(`\n${"═".repeat(64)}`);
console.log("  住所（ドメイン）でお店が決まっているかの確認");
console.log(`  見に行く先： ${BASE}`);
console.log(`  A店の住所 ： ${HOST_A}`);
console.log(`  B店の住所 ： ${HOST_B}`);
console.log(`  未登録　　： ${HOST_NASHI}`);
console.log(`${"═".repeat(64)}`);

H("下ごしらえ（お店を2つ・住所を2つ）");

const tenantA = await seed.createTenant({ code: CODE_A, name: `住所確認A ${STAMP}` });
const tenantB = await seed.createTenant({ code: CODE_B, name: `住所確認B ${STAMP}` });

for (const [host, tid] of [
  [HOST_A, tenantA],
  [HOST_B, tenantB],
]) {
  await db().execute({
    sql: `INSERT INTO tenant_domains (host, tenant_id, note, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(host) DO UPDATE SET
            tenant_id  = excluded.tenant_id,
            note       = excluded.note,
            created_at = excluded.created_at`,
    args: [host, tid, `住所確認 ${STAMP}`, new Date().toISOString()],
  });
}

/* 登録の回数制限は、使い捨てのデータベースなので跡だけ消します */
await db().execute({ sql: `DELETE FROM login_attempts WHERE reason LIKE 'SIGNUP%'`, args: [] });

T("H-00", "お店2つと、住所2つを用意した", true, `${HOST_A}→A ／ ${HOST_B}→B`);

let cookieA = "";

try {
  /* ══════════════════════════════════════════
     ① 住所からお店が決まる
     ══════════════════════════════════════════ */
  H("① 住所からお店が決まる");

  const s1 = await hit("/api/auth/signup", {
    host: HOST_A,
    method: "POST",
    body: {
      email: MAIL_A,
      password: PASSWORD,
      name: "住所 太郎",
      agreeTerms: true,
      agreePrivacy: true,
    },
  });
  T("H-01", "A店の住所で登録できた（会社コードは1文字も送っていない）", s1.status === 200, `HTTP ${s1.status}`);

  const cA = await one(
    `SELECT tenant_id FROM customers WHERE lower(email) = ?`,
    [MAIL_A.toLowerCase()],
  );
  T(
    "H-02",
    "登録された会員は、A店の名簿に入っている",
    String(cA.tenant_id ?? "") === tenantA,
    `tenant_id=${String(cA.tenant_id ?? "（無し）")} ／ A=${tenantA}`,
  );

  /* ══════════════════════════════════════════
     ② ブラウザから会社を指定できない
     ══════════════════════════════════════════ */
  H("② ブラウザから会社を指定できない");

  const s2 = await hit("/api/auth/signup", {
    host: HOST_A,
    method: "POST",
    body: {
      email: MAIL_B,
      password: PASSWORD,
      name: "住所 次郎",
      agreeTerms: true,
      agreePrivacy: true,
      /* ★これは「攻撃側の書き換え」を真似たものです。
           本文に会社コードを書いても、無視されなければいけません。 */
      tenantCode: CODE_B,
      tenantId: tenantB,
    },
  });
  T("H-03", "本文に他店の会社コードを混ぜても、登録は通る", s2.status === 200, `HTTP ${s2.status}`);

  const cB = await one(
    `SELECT tenant_id FROM customers WHERE lower(email) = ?`,
    [MAIL_B.toLowerCase()],
  );
  T(
    "H-04",
    "混ぜた会社コードは無視され、A店の名簿に入っている",
    String(cB.tenant_id ?? "") === tenantA,
    `tenant_id=${String(cB.tenant_id ?? "（無し）")} ／ A=${tenantA} ／ B=${tenantB}`,
  );

  const bKazu = await one(
    `SELECT COUNT(*) AS c FROM customers WHERE tenant_id = ?`,
    [tenantB],
  );
  T("H-05", "B店の名簿は、1人も増えていない", Number(bKazu.c ?? 0) === 0, `B店の会員=${Number(bKazu.c ?? 0)}人`);

  /* ══════════════════════════════════════════
     ③ 登録されていない住所は、はっきり断る
     ══════════════════════════════════════════ */
  H("③ 登録されていない住所は、はっきり断る");

  const s3 = await hit("/api/auth/signup", {
    host: HOST_NASHI,
    method: "POST",
    body: {
      email: `th-x-${STAMP}@shop.example`,
      password: PASSWORD,
      name: "住所 三郎",
      agreeTerms: true,
      agreePrivacy: true,
    },
  });
  T(
    "H-06",
    "未登録の住所からの登録は、断られる",
    s3.status === 400 && s3.json?.code === "NO_TENANT",
    `HTTP ${s3.status} ／ ${String(s3.json?.code ?? "")}`,
  );

  const g1 = await hit("/signup", { host: HOST_NASHI });
  T(
    "H-07",
    "未登録の住所では、登録の入口そのものを出さない",
    g1.status === 200 && /まだお店をご利用いただけません/.test(g1.text),
    g1.status === 200
      ? /まだお店をご利用いただけません/.test(g1.text)
        ? "お断りの画面が出た"
        : "★登録の画面が出てしまっている"
      : `HTTP ${g1.status}`,
  );

  T(
    "H-08",
    "お断りの画面に、こちらの仕組みの言葉が出ていない",
    !/tenant_domains|tenant_id|DEFAULT_TENANT_CODE/.test(g1.text),
    "tenant_domains 等が本文に出ていない",
  );

  const nashiKazu = await one(
    `SELECT COUNT(*) AS c FROM customers WHERE lower(email) = ?`,
    [`th-x-${STAMP}@shop.example`],
  );
  T("H-09", "断られた登録は、どのお店にも入っていない", Number(nashiKazu.c ?? 0) === 0, `会員=${Number(nashiKazu.c ?? 0)}人`);

  /* ══════════════════════════════════════════
     ④ 住所を書き換えて、よそのお店へ入れない
     ══════════════════════════════════════════ */
  H("④ 住所を書き換えて、よそのお店へ入れない");

  /* メールの確認を通していないと入れない入口があるので、
     ここは「住所の食い違い」だけを見ます。先に確認済みにします */
  await db().execute({
    sql: `UPDATE customers SET email_verified_at = ? WHERE tenant_id = ? AND lower(email) = ?`,
    args: [new Date().toISOString(), tenantA, MAIL_A.toLowerCase()],
  });

  const l1 = await hit("/api/auth/login", {
    host: HOST_A,
    method: "POST",
    body: { kind: "CUSTOMER", email: MAIL_A, password: PASSWORD },
  });
  cookieA = cookiesFrom(l1.res);
  T("H-10", "A店の住所で、A店の会員がログインできた", l1.status === 200 && cookieA !== "", `HTTP ${l1.status}`);

  const m1 = await hit("/api/customer/points", { host: HOST_A, cookie: cookieA });
  T("H-11", "A店の住所では、自分の情報が読める", m1.status === 200, `HTTP ${m1.status}`);

  const m2 = await hit("/api/customer/points", { host: HOST_B, cookie: cookieA });
  T(
    "H-12",
    "同じ合言葉でも、B店の住所からは断られる（入口）",
    m2.status === 403 && m2.json?.code === "TENANT_HOST_MISMATCH",
    `HTTP ${m2.status} ／ ${String(m2.json?.code ?? "")}`,
  );

  const m3 = await hit("/api/customer/prizes", { host: HOST_B, cookie: cookieA });
  T(
    "H-13",
    "獲得商品の入口も、B店の住所からは断られる",
    m3.status === 403 && m3.json?.code === "TENANT_HOST_MISMATCH",
    `HTTP ${m3.status} ／ ${String(m3.json?.code ?? "")}`,
  );

  const p1 = await hit("/mypage", { host: HOST_B, cookie: cookieA });
  const tobisaki = p1.res.headers.get("location") ?? "";
  T(
    "H-14",
    "B店の住所でマイページを開くと、ログイン画面へ戻される（画面）",
    (p1.status === 307 || p1.status === 302) && /\/login/.test(tobisaki),
    `HTTP ${p1.status} ／ 行き先=${tobisaki || "（無し）"}`,
  );

  const p2 = await hit("/mypage", { host: HOST_A, cookie: cookieA });
  T(
    "H-15",
    "A店の住所なら、マイページはそのまま開く",
    p2.status === 200,
    `HTTP ${p2.status}`,
  );

  const l2 = await hit("/api/auth/login", {
    host: HOST_B,
    method: "POST",
    body: { kind: "CUSTOMER", email: MAIL_A, password: PASSWORD },
  });
  T(
    "H-16",
    "B店の住所では、A店の会員はログインできない",
    l2.status !== 200,
    `HTTP ${l2.status} ／ ${String(l2.json?.code ?? "")}`,
  );

  const l3 = await hit("/api/auth/login", {
    host: HOST_B,
    method: "POST",
    body: {
      kind: "CUSTOMER",
      email: MAIL_A,
      password: PASSWORD,
      /* ★本文で会社を指し直せてはいけません */
      tenantCode: CODE_A,
    },
  });
  T(
    "H-17",
    "本文に会社コードを添えても、B店の住所からは入れない",
    l3.status !== 200,
    `HTTP ${l3.status} ／ ${String(l3.json?.code ?? "")}`,
  );

  /* ══════════════════════════════════════════
     ⑤ 止まっているお店の住所は開かない
     ══════════════════════════════════════════ */
  H("⑤ 止まっているお店の住所は開かない");

  await db().execute({
    sql: `UPDATE tenants SET status = 'SUSPENDED' WHERE id = ?`,
    args: [tenantB],
  });
  const s5 = await hit("/api/auth/signup", {
    host: HOST_B,
    method: "POST",
    body: {
      email: `th-s-${STAMP}@shop.example`,
      password: PASSWORD,
      name: "住所 四郎",
      agreeTerms: true,
      agreePrivacy: true,
    },
  });
  T(
    "H-18",
    "解約・停止したお店の住所では、登録できない",
    s5.status === 400 && s5.json?.code === "NO_TENANT",
    `HTTP ${s5.status} ／ ${String(s5.json?.code ?? "")}`,
  );
  await db().execute({
    sql: `UPDATE tenants SET status = 'ACTIVE' WHERE id = ?`,
    args: [tenantB],
  });

  /* ══════════════════════════════════════════
     ⑥ ログインしなくても見える売り場（/shop）

     ★見えるようにした代わりに、次の3つが必ず要ります。
       ・見えるのは、その住所のお店の棚だけ
       ・よそのお店のガチャIDを直に叩いても開かない
       ・見えても「引けない」（引くとポイントが減るため）
     ══════════════════════════════════════════ */
  H("⑥ ログインしなくても見える売り場");

  const gachaA = await seed.createGacha({
    tenantId: tenantA,
    title: `住所確認A用 ${STAMP}`,
    price: 500,
    total: 20,
    /* ★還元率は「％」で渡すこと。0.8 と書くと 0.8％の意味になります */
    designedRtp: 80,
    status: "PUBLISHED",
  });
  const gachaB = await seed.createGacha({
    tenantId: tenantB,
    title: `住所確認B用 ${STAMP}`,
    price: 500,
    total: 20,
    /* ★還元率は「％」で渡すこと。0.8 と書くと 0.8％の意味になります */
    designedRtp: 80,
    status: "PUBLISHED",
  });

  const sh1 = await hit("/api/shop/gachas", { host: HOST_A });
  const naraA = Array.isArray(sh1.json?.gachas) ? sh1.json.gachas : [];
  T(
    "H-19",
    "A店の住所では、ログインしなくてもA店の棚が読める",
    sh1.status === 200 && naraA.some((g) => g.id === gachaA),
    `HTTP ${sh1.status} ／ ${naraA.length}本`,
  );
  T(
    "H-20",
    "A店の棚に、B店のガチャが1本も混ざっていない",
    !naraA.some((g) => g.id === gachaB),
    `${naraA.length}本のうち、B店のものは ${naraA.filter((g) => g.id === gachaB).length}本`,
  );

  const sh2 = await hit(`/api/shop/gachas/${encodeURIComponent(gachaB)}`, { host: HOST_A });
  T(
    "H-21",
    "A店の住所でB店のガチャIDを直に叩いても、見つからない",
    sh2.status === 404,
    `HTTP ${sh2.status} ／ ${String(sh2.json?.code ?? "")}`,
  );
  T(
    "H-22",
    "そのお断りに、B店の題名が入っていない",
    !sh2.text.includes(`住所確認B用 ${STAMP}`),
    "断り文に、よそのお店の中身を書かないこと",
  );

  const sh3 = await hit(`/api/shop/gachas/${encodeURIComponent(gachaA)}`, { host: HOST_A });
  T(
    "H-23",
    "A店の住所でA店のガチャは、そのまま読める",
    sh3.status === 200 && sh3.json?.gacha?.id === gachaA,
    `HTTP ${sh3.status}`,
  );

  const sh4 = await hit("/api/shop/gachas", { host: HOST_NASHI });
  T(
    "H-24",
    "登録されていない住所では、棚を1本も返さない",
    sh4.status === 404 && sh4.json?.code === "NO_TENANT",
    `HTTP ${sh4.status} ／ ${String(sh4.json?.code ?? "")}`,
  );

  const sh5 = await hit("/shop", { host: HOST_NASHI });
  T(
    "H-25",
    "登録されていない住所の売り場は、はっきりお断りする（画面）",
    sh5.status === 200 && sh5.text.includes("このアドレスでは、まだお店をご利用いただけません"),
    `HTTP ${sh5.status}`,
  );
  T(
    "H-26",
    "そのお断りに、中の事情（表や設定の名前）が出ていない",
    !/tenant_domains|TENANT_HOST_MAP|DEFAULT_TENANT_CODE/.test(sh5.text),
    "お客様に、こちらの仕組みの名前を見せないこと",
  );

  const sh6 = await hit("/", { host: HOST_A });
  const ikisaki = sh6.res.headers.get("location") ?? "";
  T(
    "H-27",
    "お店の住所でトップを開くと、そのお店の売り場へ行く",
    (sh6.status === 307 || sh6.status === 302) && /\/shop$/.test(ikisaki),
    `HTTP ${sh6.status} ／ 行き先=${ikisaki || "（無し）"}`,
  );

  const sh7 = await hit("/", { host: HOST_NASHI });
  T(
    "H-28",
    "どのお店でもない住所のトップは、これまで通りこちらのご案内を出す",
    sh7.status === 200,
    `HTTP ${sh7.status}`,
  );

  /* ★ここが一番大事です。
       棚が見えるようになっても、引けてはいけません。
       引くとポイントが減ります。減らす相手が決まっていないからです。 */
  const sh8 = await hit("/api/console/draw", {
    host: HOST_A,
    method: "POST",
    body: { gachaId: gachaA, count: 1 },
  });
  T(
    "H-29",
    "ログインしていない人は、棚が見えても引けない",
    sh8.status === 401 || sh8.status === 403,
    `HTTP ${sh8.status} ／ ${String(sh8.json?.code ?? "")}`,
  );
} catch (e) {
  T("H-99", "途中で止まってしまった", false, String(e?.message ?? e));
}

/* ── まとめ ───────────────────────────────── */
console.log(`\n${"═".repeat(64)}`);
console.log(`  ok ${ok} ／ NG ${ng}`);
const out = `${ROOT}/docs/e2e-tenant-host-${STAMP}.json`;
writeFileSync(
  out,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      base: BASE,
      hostA: HOST_A,
      hostB: HOST_B,
      hostNashi: HOST_NASHI,
      tenantA,
      tenantB,
      ok,
      ng,
      items: kekka,
    },
    null,
    2,
  ),
  "utf8",
);
console.log(`  控え： ${out}`);
console.log(`${"═".repeat(64)}\n`);

process.exit(ng === 0 ? 0 : 1);
