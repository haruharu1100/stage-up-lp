/**
 * 「説明なしで使えるか」を、押した回数で数える。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これが要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   「使いやすくしました」は、いくらでも言えます。
 *   言えてしまうから、誰も直しません。
 *
 *   ですので、ここでは言葉を使いません。
 *   ログインしたあと、
 *
 *       ・ガチャを引くまでに、何回押したか
 *       ・ポイントを買うまでに、何回押したか
 *       ・当たった商品を見るまでに、何回押したか
 *
 *   を、本物のブラウザで数えます。
 *
 *   合格の線は「3回以内」です。
 *   これは、はじめて触る方が迷わずに着ける回数として決めました。
 *
 * ═══════════════════════════════════════════════════════
 * ★数え方の決まり（ここを緩めないこと）
 * ═══════════════════════════════════════════════════════
 *
 *   ・住所（URL）を直接打つのは、0回では数えません。反則です。
 *     お客様は住所を知りません。画面にあるものしか押せません。
 *   ・「押した回数」には、確認のダイアログで押す分も含めます。
 *     ただし数えるのは「その入口に着くまで」です。
 *     引く前の最終確認は、着いた後の話なので含みません。
 *   ・見つからなければ、そこで失敗にします。
 *     「たぶんこの辺にある」で通さないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・専用の会社を新しく1つ作り、その中だけで動きます。
 *   ・メールは .example（誰も持てないドメイン）だけを使います。
 *
 * 使い方：
 *   DATABASE_URL="file:./.data/e2e-d1.db" DATABASE_ENV=development \
 *     npx tsx scripts/e2e-taps.mjs http://127.0.0.1:3212
 */

import { existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ══════════════════════════════════════════════
   入口の安全確認
   ══════════════════════════════════════════════ */

const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error("\n✗ 見に行く先を指定してください（例： http://127.0.0.1:3212 ）\n");
  process.exit(1);
}
if (process.env.DATABASE_ENV === "production") {
  console.error("\n✗ 本番のデータベースには向けられません。\n");
  process.exit(1);
}
if (BASE.startsWith("https://") && !process.env.E2E_ALLOW_REMOTE) {
  console.error("\n✗ 外のサーバーへは、E2E_ALLOW_REMOTE を付けたときだけです。\n");
  process.exit(1);
}

/** 合格の線。★あとから緩めないこと */
const KAGIRI = 3;

const PW_DIR =
  process.env.PLAYWRIGHT_DIR ||
  join(ROOT, "..", "blog-to-social", "node_modules", "playwright");
if (!existsSync(PW_DIR)) {
  console.error(`\n✗ playwright が見つかりません: ${PW_DIR}\n`);
  process.exit(1);
}
const require_ = createRequire(import.meta.url);
const pwMod = await import(pathToFileURL(require_.resolve(join(PW_DIR, "index.js"))).href);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const seed = await import(`${ROOT}/lib/server/seed.ts`);
const auth = await import(`${ROOT}/lib/server/auth.ts`);

/* ══════════════════════════════════════════════
   記録の付け方
   ══════════════════════════════════════════════ */

const LOG = [];
let ok = 0;
let ng = 0;

function T(no, title, pass, detail) {
  LOG.push({ no, title, pass, detail: detail ?? "" });
  if (pass) ok += 1;
  else ng += 1;
  console.log(`${pass ? "  ok " : "  NG "} ${String(no).padEnd(7)} ${title}`);
  if (detail) console.log(`         ${detail}`);
}

/* ══════════════════════════════════════════════
   下ごしらえ
   ══════════════════════════════════════════════ */

const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const CODE = `TAP${STAMP.slice(-6)}`;
const EMAIL = `tap-${STAMP}@example.invalid`;
const EMAIL0 = `tap0-${STAMP}@example.invalid`;
const PASS = "TapTest-9x2Qv";
const NEDAN = 500;

console.log(`\n${"═".repeat(64)}`);
console.log("  押した回数で数える（お客様側）");
console.log(`  見に行く先： ${BASE}`);
console.log(`  合格の線　： ${KAGIRI}回以内`);
console.log(`${"═".repeat(64)}\n`);

const tenantId = await seed.createTenant({ code: CODE, name: `タップ数確認 ${STAMP}` });
await seed.makeTenantLaunchReady(tenantId);

const HOST = new URL(BASE).host.toLowerCase();
await db().execute({
  sql: `INSERT INTO tenant_domains (host, tenant_id, note, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          tenant_id  = excluded.tenant_id,
          note       = excluded.note,
          created_at = excluded.created_at`,
  args: [HOST, tenantId, `タップ数確認 ${STAMP}`, new Date().toISOString()],
});

await seed.createGacha({
  tenantId,
  title: `タップ数確認ガチャ ${STAMP}`,
  price: NEDAN,
  total: 40,
  designedRtp: 80,
  status: "PUBLISHED",
});

/* ★お客様は「引ける状態」で始めます。
     ここで見たいのは登録の道のりではなく、
     ふだん使いの道のりだからです。 */
const customerId = await seed.createCustomer({
  tenantId,
  no: 1,
  name: "架空 太郎",
  points: NEDAN * 4,
  email: EMAIL,
});
await auth.setPassword({
  tenantId,
  subjectKind: "CUSTOMER",
  subjectId: customerId,
  password: PASS,
});

/* ★もう一人、はじめから0ptのお客様。
     「引きたいのにポイントが足りない」場面を作るためです。 */
const customer0Id = await seed.createCustomer({
  tenantId,
  no: 2,
  name: "架空 花子",
  points: 0,
  email: EMAIL0,
});
await auth.setPassword({
  tenantId,
  subjectKind: "CUSTOMER",
  subjectId: customer0Id,
  password: PASS,
});

/* ══════════════════════════════════════════════
   ブラウザ
   ══════════════════════════════════════════════ */

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
const page = await ctx.newPage();
page.setDefaultTimeout(20000);

/** 押した回数と、押したものの名前 */
let taps = 0;
let michi = [];

function hajimeru() {
  taps = 0;
  michi = [];
}

/**
 * 画面に見えているものを1つ押す。
 *
 * ★見えているものだけを押すこと。
 *   画面の外にあるボタンは、お客様には無いのと同じです。
 */
async function osu(namae, sagashi) {
  const el = page.locator(sagashi).filter({ visible: true }).first();
  const kazu = await el.count();
  if (kazu === 0) return false;
  await el.click();
  taps += 1;
  michi.push(namae);
  await page.waitForLoadState("networkidle").catch(() => {});
  return true;
}

/**
 * いま、その入口が画面に見えているか。
 *
 * ★「押した直後に0件だった」を「無い」と決めつけないこと。
 *   画面の中身はあとから読み込まれます。少し待ってから数えます。
 */
async function mieru(sagashi, matsu = 6000) {
  return page
    .locator(sagashi)
    .first()
    .waitFor({ state: "visible", timeout: matsu })
    .then(() => true, () => false);
}

/** その場所に着くまで、少しだけ待つ */
async function tsuku(hantei, matsu = 6000) {
  const owari = Date.now() + matsu;
  for (;;) {
    if (hantei(new URL(page.url()).pathname)) return true;
    if (Date.now() >= owari) return false;
    await page.waitForTimeout(200);
  }
}

/**
 * 目的地に着くまで、見えているものを順に押していく。
 *
 * ★「入口の文字が画面にある」では合格にしないこと。
 *   本当に押せるもの（引くボタン・買う商品）が出るまで進めます。
 *   文字だけ見て合格にすると、押しても何も起きない画面が通ります。
 */
async function sagasu(tsuita, tegakari) {
  for (let i = 0; i <= KAGIRI; i += 1) {
    if (await tsuita()) return true;
    let oseta = false;
    for (const [namae, sagashi] of tegakari) {
      if (await osu(namae, sagashi)) {
        oseta = true;
        break;
      }
    }
    if (!oseta) return false; /* 押せるものが無い＝そこで行き止まり */
  }
  return await tsuita();
}

/* ── 目的地（本当に押せるもの／本当に着いた場所） ── */
const 引ける = () => mieru('[data-testid^="tile-draw-"]');
const 買える = () => mieru('[data-testid="buy-product"]');
const 獲得商品に居る = () => tsuku((p) => p.startsWith("/mypage/prizes"));

/* ── 売り場へ戻る入口（どの画面にも常にあること） ── */
const 売り場へ = '[data-testid="chrome-nav-shop"], [data-testid="chrome-nav-shop-guest"]';

let rc = 0;

try {
  /* ── ログインする（ここは数えません。入口だからです） ── */
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });

  /* ★1回で決めつけないこと。
       手元のサーバーは、初めて開く画面をその場で組み立てます。
       組み上がる前に押しても、何も起きません。
     ★ログイン画面は最初「運営の方」が選ばれています。
       お客様として入るので、毎回「お客様」に切り替えてから打ちます。 */
  let haireta = false;
  let kotowari = "";
  for (let i = 0; i < 6 && !haireta; i += 1) {
    await page.locator('button[role="tab"]:has-text("お客様")').click().catch(() => {});
    await page.locator('input[type="email"]').fill(EMAIL).catch(() => {});
    await page.locator('input[type="password"]').fill(PASS).catch(() => {});
    await page.locator('button[type="submit"]').first().click().catch(() => {});
    haireta = await page.waitForURL("**/mypage**", { timeout: 8000 }).then(
      () => true,
      () => false,
    );
    if (!haireta) {
      kotowari = await page.locator('[role="alert"]').first().innerText().catch(() => "");
      if (kotowari) break; /* 断られた理由が出ているなら、押し直しても同じ */
    }
  }
  await page.waitForLoadState("networkidle").catch(() => {});

  T("T-01", "ログインできて、お客様の画面に入った", haireta, haireta ? `着いた先： ${new URL(page.url()).pathname}` : `${page.url()} ／ ${kotowari}`);
  if (!haireta) throw new Error("ログインできていません");

  const landing = page.url();

  /* ══ ① 引くまで ══════════════════════════
       目的地は「引く」という文字ではありません。
       実際に引けるボタンが出ている状態です。 */
  hajimeru();
  const hikeru = await sagasu(引ける, [
    ["ガチャ一覧", 売り場へ],
    ["ガチャを選ぶ", '[data-testid^="tile-open-"]'],
  ]);
  T(
    "T-02",
    `ログイン直後から、実際に引けるボタンに着くまで ${taps}回`,
    hikeru && taps <= KAGIRI,
    hikeru ? `道のり： ${michi.join(" → ") || "（そのまま画面にある）"}` : "★引けるボタンに着けませんでした",
  );

  /* ══ ② ポイント購入まで ══════════════════
       目的地は、買える金額の商品が並んでいる画面です。 */
  await page.goto(landing, { waitUntil: "networkidle" });
  hajimeru();
  const kaeru = await sagasu(買える, [
    ["＋購入（上のバー）", '[data-testid="chrome-buy-points"]'],
    ["保有ポイント（上のバー）", '[data-testid="chrome-balance"]'],
    ["ポイント購入", 'button:has-text("ポイント購入"), a:has-text("ポイント購入"), button:has-text("ポイントを購入"), a:has-text("ポイントを購入")'],
  ]);
  T(
    "T-03",
    `ログイン直後から、ポイントを買う画面に着くまで ${taps}回`,
    kaeru && taps <= KAGIRI,
    kaeru ? `道のり： ${michi.join(" → ") || "（そのまま画面にある）"}` : "★ポイントを買う画面に着けませんでした",
  );

  /* ══ ③ 獲得商品まで ══════════════════════ */
  await page.goto(landing, { waitUntil: "networkidle" });
  hajimeru();
  const mieta = await sagasu(獲得商品に居る, [
    ["獲得商品", '[data-testid="chrome-nav-prizes"]'],
    ["獲得商品（文字）", 'button:has-text("獲得商品"), a:has-text("獲得商品")'],
  ]);
  T(
    "T-04",
    `ログイン直後から「獲得商品」に着くまで ${taps}回`,
    mieta && taps <= KAGIRI,
    mieta ? `道のり： ${michi.join(" → ") || "（そのまま画面にある）"}` : "★「獲得商品」に着けませんでした",
  );

  /* ══ ④ どの画面からでも、売り場へ1回で戻れるか ══ */
  for (const [namae, michi2] of [
    ["獲得商品", "/mypage/prizes"],
    ["ポイント", "/mypage/points"],
    ["発送状況", "/mypage/shipping"],
    ["お問い合わせ", "/mypage/support"],
  ]) {
    await page.goto(`${BASE}${michi2}`, { waitUntil: "networkidle" });
    hajimeru();
    const modoreta = await osu("ガチャ一覧", 売り場へ);
    const tsuita = modoreta && (await 引ける());
    T(
      "T-05",
      `${namae}の画面から、売り場へ1回で戻れる`,
      tsuita,
      tsuita ? "" : `★${michi2} から1回で売り場に戻れません（戻れた=${modoreta}）`,
    );
  }

  /* ══ ⑤ ポイントが足りないときに、その場で買いに行けるか ══
       ここで探し直しになる店は、いちばん売上を落とします。
     ★残高を直接書き換えないこと（台帳と合わなくなります）。
       はじめから0ptの別のお客様で入り直します。 */
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  let haireta2 = false;
  for (let i = 0; i < 6 && !haireta2; i += 1) {
    await page.locator('button[role="tab"]:has-text("お客様")').click().catch(() => {});
    await page.locator('input[type="email"]').fill(EMAIL0).catch(() => {});
    await page.locator('input[type="password"]').fill(PASS).catch(() => {});
    await page.locator('button[type="submit"]').first().click().catch(() => {});
    haireta2 = await page.waitForURL("**/mypage**", { timeout: 8000 }).then(() => true, () => false);
  }
  if (!haireta2) throw new Error("0ptのお客様でログインできませんでした");

  await page.goto(`${BASE}/mypage/shop`, { waitUntil: "networkidle" });
  hajimeru();
  const tarinai = await sagasu(買える, [
    ["ポイントを買う（タイルの中）", '[data-testid^="tile-buy-points-"]'],
    ["＋購入（上のバー）", '[data-testid="chrome-buy-points"]'],
  ]);
  T(
    "T-06",
    `ポイント不足のガチャから、買う画面に着くまで ${taps}回`,
    tarinai && taps <= KAGIRI,
    tarinai ? `道のり： ${michi.join(" → ")}` : "★足りないと言われた場所から、買いに行けませんでした",
  );
} catch (e) {
  T("T-XX", "途中で止まった", false, String(e).slice(0, 300));
  rc = 1;
} finally {
  await browser.close().catch(() => {});
}

/* ══════════════════════════════════════════════
   まとめ
   ══════════════════════════════════════════════ */

console.log(`\n${"═".repeat(64)}`);
console.log(`  ok ${ok} ／ NG ${ng}`);
const dest = join(ROOT, "docs", `e2e-taps-${STAMP}.json`);
writeFileSync(dest, JSON.stringify({ base: BASE, kagiri: KAGIRI, ok, ng, log: LOG }, null, 2));
console.log(`  控え： ${dest}`);
console.log(`${"═".repeat(64)}\n`);

process.exit(ng > 0 ? 1 : rc);
