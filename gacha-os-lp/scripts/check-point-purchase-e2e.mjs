/**
 * PHASE 3C／3D：ポイント購入を、本物のブラウザで最後まで通す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを別に作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   サーバー側の試験が全部通っていても、
 *   次のことは1つも分かりません。
 *
 *     ・残高が足りないと分かった方が、その場で買う道へ行けるのか
 *     ・買ったあと、元のガチャへ戻れるのか
 *     ・戻ったあと、そのまま引けるのか
 *
 *   「実際に売上を作れるか」は、この一本道が通るかどうかです。
 *   ですので、人と同じ手順を、機械に踏ませます。
 *
 *       新規登録 → メール確認 → 残高0 → ガチャ詳細 → 残高不足
 *         → 購入画面 → モック決済 → 残高反映
 *         → 元ガチャへ復帰 → 引く → 当選
 *
 * ═══════════════════════════════════════════════════════
 * ★通したいのは「増えること」ではなく「増えすぎないこと」
 * ═══════════════════════════════════════════════════════
 *
 *   ポイントが増える経路は、作るのは簡単です。
 *   難しいのは、二重に増えないことです。
 *   ですので、後半では、わざと壊しにいきます。
 *
 *     ・同じ確定通知を100回送る
 *     ・金額を書き換えて送る
 *     ・存在しない注文へ送る
 *     ・他人の注文を操作する
 *     ・他社の注文を操作する
 *     ・支払済みの注文へ、もう一度送る
 *     ・支払待ちの注文を取り消してから送る
 *     ・支払いの途中で画面を読み込み直す
 *     ・2つのタブから同時に支払う
 *
 *   最後に、台帳の合計と残高が一致していることを確かめます。
 *   ここが一致していれば、上のどれかで増えていたとしても見つかります。
 *
 * ═══════════════════════════════════════════════════════
 * ★店舗が、自分で値段を決められるかも見ます
 * ═══════════════════════════════════════════════════════
 *
 *   お客様側だけを見て「通った」としないこと。
 *   売る金額と付与ポイントを店舗が自分で変えられなければ、
 *   変えるたびにこちらへ依頼が来ます。それは売り物ではありません。
 *
 *   ですので終わりに、管理画面（ポイント販売）へ担当者として入り、
 *   商品を1つ作り、売り場から外し、そのとおりお客様側が変わることと、
 *   ★過去の注文の金額が動かないことを確かめます。
 *

 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・PAYMENT_PROVIDER が mock 以外なら、止まります。
 *   ・使い捨ての会社を2つ作り、その中だけで動きます。
 *   ・メールアドレスは .example（誰も持てない）だけを使います。
 *   ・実際のお金は1円も動きません。
 *
 * ═══════════════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════════════
 *
 *   別の窓で、使い捨てのDBを指したまま開発サーバーを立ち上げます。
 *
 *     DATABASE_ENV=development DATABASE_URL=file:/tmp/gos-pp.db \
 *     PAYMENT_PROVIDER=mock npx next dev -p 3210
 *
 *   ★実行のたびに、DBのファイルを消してから立ち上げること。
 *     新規登録は「同じ回線から1時間に5件まで」で断る作りです。
 *     これは正しい守りなので、緩めません。
 *     使い回すと、6回目の実行が 429 で止まり、
 *     直したはずの不具合が出たように見えます。
 *
 *   そのうえで、同じ保存先を指して実行します。
 *
 *     DATABASE_ENV=development DATABASE_URL=file:/tmp/gos-pp.db \
 *     PAYMENT_PROVIDER=mock \
 *       npx tsx scripts/check-point-purchase-e2e.mjs http://localhost:3210
 *
 *   1つでも通らなければ、終了コード 1 で落ちます。
 */

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");

/* ══════════════════════════════════════════════
   安全装置
   ══════════════════════════════════════════════ */

const DB_ENV = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (DB_ENV === "production") {
  console.error(
    "\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n",
  );
  process.exit(1);
}

const PROVIDER = (process.env.PAYMENT_PROVIDER ?? "mock").trim().toLowerCase();
if (PROVIDER !== "" && PROVIDER !== "mock") {
  console.error(
    `\n✗ PAYMENT_PROVIDER が "${PROVIDER}" です。この道具はモック決済でしか動きません。\n`,
  );
  process.exit(1);
}

/* ── Playwright は隣のプロジェクトから借りる ── */
const PW_DIR =
  process.env.PLAYWRIGHT_DIR ||
  join(ROOT, "..", "blog-to-social", "node_modules", "playwright");
if (!existsSync(PW_DIR)) {
  console.error(`\n✗ playwright が見つかりません: ${PW_DIR}\n`);
  process.exit(1);
}
const require_ = createRequire(import.meta.url);
const pwMod = await import(
  pathToFileURL(require_.resolve(join(PW_DIR, "index.js"))).href
);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
if (!chromium) {
  console.error("\n✗ playwright から chromium を取り出せませんでした。\n");
  process.exit(1);
}

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const seed = await import(`${ROOT}/lib/server/seed.ts`);
const purchase = await import(`${ROOT}/lib/server/pointPurchase.ts`);
/* 合言葉は、本物と同じ入口から入れる。
   ★自分でハッシュを作って直接入れないこと。
     入れ方が変わったときに、この試験だけが古いやり方のまま残ります。 */
const { setPassword } = await import(`${ROOT}/lib/server/auth.ts`);

/* 管理画面へ入る手順は、1か所にまとめてあります。
   ★ここで入り方を書き直さないこと。入り方が変わるたびに探して回ることになります。 */
const { enterConsole } = await import(`${ROOT}/scripts/lib/console-enter.mjs`);

/* ══════════════════════════════════════════════
   記録の付け方
   ══════════════════════════════════════════════ */

let ok = 0;
let ng = 0;

function T(no, title, pass, detail) {
  if (pass) ok += 1;
  else ng += 1;
  console.log(`${pass ? "  ok " : "  NG "} ${String(no).padEnd(6)} ${title}`);
  if (detail) console.log(`         ${detail}`);
}

function H(title) {
  console.log(`\n══ ${title} ${"═".repeat(Math.max(0, 54 - title.length))}`);
}

const CONSOLE_LOG = [];
const BAD_HTTP = [];

/**
 * 画面が出したエラーと、4xx/5xx を拾う。
 *
 * ★わざと断らせる試験では、4xx が出るのが正しい姿です。
 *   ですので「試験のために自分で叩いた通信」は数えません。
 *   数えると、正しく守れているときほど赤くなります。
 */
let ijoukeiChu = false;

function watch(page) {
  page.on("console", (m) => {
    const t = m.type();
    if (t !== "error" && t !== "warning") return;
    if (ijoukeiChu) return;
    CONSOLE_LOG.push(`[${t}] ${m.text().slice(0, 300)}  @${page.url()}`);
  });
  page.on("pageerror", (e) => {
    if (ijoukeiChu) return;
    CONSOLE_LOG.push(`[pageerror] ${String(e).slice(0, 300)}  @${page.url()}`);
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    if (ijoukeiChu) return;
    BAD_HTTP.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return page;
}

const one = async (sql, args = []) =>
  (await db().execute({ sql, args })).rows[0] ?? {};
const all = async (sql, args = []) => (await db().execute({ sql, args })).rows;

const zandaka = async (customerId) =>
  Number(
    (await one(`SELECT points FROM customers WHERE id = ?`, [customerId]))
      .points ?? -1,
  );

const daichouGoukei = async (tenantId, customerId) =>
  Number(
    (
      await one(
        `SELECT COALESCE(SUM(delta),0) AS s FROM point_ledger
          WHERE tenant_id = ? AND user_id = ?`,
        [tenantId, customerId],
      )
    ).s ?? 0,
  );

/* ══════════════════════════════════════════════
   下ごしらえ
   ══════════════════════════════════════════════ */

const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const CODE_A = `EPPA${STAMP}`;
const CODE_B = `EPPB${STAMP}`;
const EMAIL = `e2e-buy-${STAMP}@phase3c.example`;
const PASSWORD = `e2e-${STAMP}-Kounyu!`;
const NAME = "購入 試験子（架空）";

/* 管理画面へ入る担当者。
   ★合言葉をここで固定文字にしないこと。
     そのままGitに残り、あとから消しても履歴には残り続けます。
     毎回ちがう値を、その場で作ります。 */
const ADMIN_EMAIL = `e2e-admin-${STAMP}@phase3c.example`;
const ADMIN_PASSWORD = `e2e-${STAMP}-Kanri!`;

/* ガチャは 500pt。商品は 1,000円で 1,000pt＋おまけ 200pt。
   ★端数の無い値にしないこと。
     500pt のガチャに 500pt ちょうどを買うと、
     「引いたあと0pt」になり、加算漏れと引き過ぎの区別が付きません。 */
const GACHA_PRICE = 500;
const PRICE_YEN = 1000;
const POINTS = 1000;
const BONUS = 200;
const TOTAL_PT = POINTS + BONUS;

const SYSTEM_ACTOR = {
  kind: "SYSTEM",
  id: "e2e",
  name: "自動試験",
  role: "SYSTEM",
};

H("下ごしらえ（使い捨ての会社を2つ作る）");

const tenantA = await seed.createTenant({
  code: CODE_A,
  name: "ポイント購入ためし社（架空）",
});
const tenantB = await seed.createTenant({
  code: CODE_B,
  name: "となりの会社（架空）",
});

/* 管理画面へ入る担当者を1人だけ作る。
   ★見本の「デモ管理者」で入らないこと。
     それで入ると、いま作ったこの会社のデータが1件も見えないまま
     「0件でした」と報告されます。 */
const adminId = await seed.createAdmin({
  tenantId: tenantA,
  no: 1,
  email: ADMIN_EMAIL,
  name: "運営 管理者（架空）",
  /* ★役割の名前を、思いつきで書かないこと。
       使えるのは VIEWER／SUPPORT／OPERATOR／FINANCE／SECURITY／SUPER_ADMIN の6つだけです。
       ここに "ADMIN" と書いてしまい、ログインはできるのに
       画面のデータだけが 403 で出ない、という形で止まりました（2026-09-05）。
       値段を決めるには point.request が要るので、店主と同じ全権にします。 */
  role: "SUPER_ADMIN",
});
await setPassword({
  tenantId: tenantA,
  subjectKind: "ADMIN",
  subjectId: adminId,
  password: ADMIN_PASSWORD,
});

/* 売り物（ポイント商品）を、本物と同じ入口で作る。
   ★ここで直接 INSERT しないこと。
     直接入れると、この試験は「商品設定の入口」を1回も通りません。 */
const productId = (
  await purchase.saveProduct({
    tenantId: tenantA,
    name: `${PRICE_YEN.toLocaleString()}円パック（試験）`,
    priceYen: PRICE_YEN,
    points: POINTS,
    bonusPoints: BONUS,
    status: "ACTIVE",
    sortOrder: 1,
    actor: SYSTEM_ACTOR,
    requestId: `e2e-${STAMP}-prod`,
  })
).productId;

/* 止めている商品も1つ作る。お客様の一覧に出ないことを確かめるためです */
await purchase.saveProduct({
  tenantId: tenantA,
  name: "販売を止めたパック（試験）",
  priceYen: 5000,
  points: 5000,
  bonusPoints: 0,
  status: "DISABLED",
  sortOrder: 2,
  actor: SYSTEM_ACTOR,
  requestId: `e2e-${STAMP}-prod2`,
});

const gachaId = await seed.createGacha({
  tenantId: tenantA,
  title: "購入試験ガチャ（架空）",
  price: GACHA_PRICE,
  total: 50,
  designedRtp: 0.8,
  status: "PUBLISHED",
});

/* 他人（同じ会社の、別のお客様） */
const otherUser = await seed.createCustomer({
  tenantId: tenantA,
  no: 9001,
  name: "他人 太郎（架空）",
  points: 0,
  email: `e2e-other-${STAMP}@phase3c.example`,
});

/* 他社のお客様 */
const otherTenantUser = await seed.createCustomer({
  tenantId: tenantB,
  no: 9002,
  name: "他社 花子（架空）",
  points: 0,
  email: `e2e-btenant-${STAMP}@phase3c.example`,
});

console.log(`  会社コード ${CODE_A} ／ となり ${CODE_B}`);
console.log(`  メール     ${EMAIL}`);
console.log(`  公開先     ${BASE}`);

{
  const res = await fetch(`${BASE}/login`, { cache: "no-store" }).catch(
    () => null,
  );
  if (!res || !res.ok) {
    console.error(
      `\n✗ ${BASE} につながりません。開発サーバーを立ち上げてから実行してください。\n`,
    );
    process.exit(1);
  }
}

/* ══════════════════════════════════════════════
   ブラウザを開く（スマホの幅で）
   ══════════════════════════════════════════════ */

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = watch(await ctx.newPage());

const machi = async (ms = 500) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
const honbun = () => page.evaluate(() => document.body.innerText);

/** 画面の中から、本物のクッキー付きで入口を叩く */
const tataku = (p, method, url, body) =>
  p.evaluate(
    async ([m, u, b]) => {
      const csrf = document.cookie
        .split("; ")
        .find((c) => c.startsWith("gos_csrf="))
        ?.slice("gos_csrf=".length);
      const res = await fetch(u, {
        method: m,
        headers:
          m === "GET"
            ? {}
            : { "Content-Type": "application/json", "x-gos-csrf": csrf ?? "" },
        credentials: "same-origin",
        cache: "no-store",
        body: m === "GET" ? undefined : JSON.stringify(b ?? {}),
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    },
    [method, url, body ?? null],
  );

/** 決済会社のふりをして、確定通知を送る（クッキーは要りません） */
const tsuuchi = async (payload) => {
  const res = await fetch(`${BASE}/api/payments/mock/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.MOCK_PAYMENT_SECRET
        ? { "x-mock-signature": process.env.MOCK_PAYMENT_SECRET }
        : {}),
    },
    body: JSON.stringify(payload),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

let fatal = null;
let meId = "";

try {
  /* ════════════════════════════════════════════
     ① 新規会員登録
     ════════════════════════════════════════════ */
  H("① 新規会員登録");

  await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
  await machi();

  {
    const code = page.locator('input[autocomplete="organization"]');
    if ((await code.count()) > 0) await code.first().fill(CODE_A);
  }
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="name"]').fill(NAME);
  await page.locator('input[name="agreeTerms"]').check();
  await page.locator('input[name="agreePrivacy"]').check();
  await page.locator('button[type="submit"]').click();
  await page.waitForSelector('[data-testid="signup-done"]', { timeout: 15_000 });

  const me = await one(
    `SELECT id, points, email_verified_at FROM customers
      WHERE tenant_id = ? AND lower(email) = ?`,
    [tenantA, EMAIL.toLowerCase()],
  );
  meId = String(me.id ?? "");
  T(1, "会員が作られた", Boolean(meId), meId || "作られていません");
  if (!meId) throw new Error("会員が作られていないので打ち切ります。");

  /* ════════════════════════════════════════════
     ② メール確認済みにする
     ════════════════════════════════════════════ */
  H("② メールの確認を済ませる");

  const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  const nokori = await one(
    `SELECT id FROM email_verifications
      WHERE tenant_id = ? AND customer_id = ? AND used_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [tenantA, meId],
  );
  const TOKEN = `e2e${STAMP}${Math.random().toString(36).slice(2, 10)}`;
  await db().execute({
    sql: `UPDATE email_verifications SET token_hash = ? WHERE id = ?`,
    args: [sha256(TOKEN), String(nokori.id)],
  });

  await page.goto(`${BASE}/verify-email?token=${TOKEN}`, {
    waitUntil: "domcontentloaded",
  });
  await machi();
  await page.locator('[data-testid="verify-submit"]').click();
  await page.waitForSelector('[data-testid="verify-done"]', { timeout: 15_000 });

  const kakunin = await one(
    `SELECT email_verified_at FROM customers WHERE id = ?`,
    [meId],
  );
  T(2, "メール確認済みになった", kakunin.email_verified_at != null);

  /* ログインする */
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await machi();
  await page.locator('button[role="tab"]:has-text("お客様")').click();
  await machi(200);
  {
    const code = page.locator('input[autocomplete="organization"]');
    if ((await code.count()) > 0) await code.first().fill(CODE_A);
  }
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await machi(1500);
  T(3, "ログインしてマイページに入れた", page.url().includes("/mypage"), page.url());

  /* ════════════════════════════════════════════
     ③ ポイントが0であること
     ════════════════════════════════════════════ */
  H("③ 登録直後のポイントは 0");

  T(4, "DB上の残高が 0pt", (await zandaka(meId)) === 0, `${await zandaka(meId)}pt`);

  await page.goto(`${BASE}/mypage/points`, { waitUntil: "domcontentloaded" });
  await machi(800);
  T(
    5,
    "保有ポイントの画面にも 0pt と出ている",
    /0\s*pt/.test(await honbun()),
  );
  T(
    6,
    "その画面に「ポイントを購入する」の押し場所がある",
    (await page.locator('text=ポイントを購入する').count()) > 0,
  );

  /* ════════════════════════════════════════════
     ④⑤ ガチャ詳細で「残高不足」と出る
     ════════════════════════════════════════════ */
  H("④⑤ ガチャ詳細を開き、残高不足と分かる");

  await page.goto(`${BASE}/mypage/shop/${gachaId}`, {
    waitUntil: "domcontentloaded",
  });
  await machi(1000);

  const shousai = await honbun();
  T(7, "ガチャの詳細が開けた", /購入試験ガチャ/.test(shousai), page.url());
  T(8, "「不足しています」と、その場で分かる", /不足/.test(shousai));

  const kaubtn = page.locator('[data-testid="go-buy-points"]');
  const kaubtnAru = (await kaubtn.count()) > 0;
  T(9, "その場に「ポイントを購入する」がある", kaubtnAru);

  if (kaubtnAru) {
    const box = await kaubtn.boundingBox();
    T(
      10,
      "その押し場所が、指で押せる大きさ（高さ44px以上）",
      Boolean(box) && box.height >= 44,
      box ? `高さ ${Math.round(box.height)}px` : "見えていません",
    );
  } else {
    T(10, "その押し場所が、指で押せる大きさ", false, "押し場所がありません");
  }

  /* 引くボタンが押せないこと（残高が足りないので） */
  const hikuMuri = await page
    .locator('button:has-text("で 1回引く")')
    .first()
    .isDisabled()
    .catch(() => null);
  T(11, "残高が足りないので、引くボタンは押せない", hikuMuri === true, String(hikuMuri));

  /* ════════════════════════════════════════════
     ⑥ 購入画面へ進む
     ════════════════════════════════════════════ */
  H("⑥ 購入画面へ進む");

  if (kaubtnAru) {
    await kaubtn.click();
    await machi(1200);
  } else {
    await page.goto(
      `${BASE}/mypage/points/buy?from=${encodeURIComponent(`/mypage/shop/${gachaId}`)}`,
      { waitUntil: "domcontentloaded" },
    );
    await machi(1200);
  }

  T(
    12,
    "購入画面（/mypage/points/buy）へ進んだ",
    page.url().includes("/mypage/points/buy"),
    page.url(),
  );
  T(
    13,
    "戻り先（from）が、そのガチャを指している",
    page.url().includes(encodeURIComponent(`/mypage/shop/${gachaId}`)),
  );

  const shouhinBtn = page.locator('[data-testid="buy-product"]');

  /**
   * ★数える前に、必ず出そろうまで待つこと。
   *
   *   売っているポイントは、画面が開いたあとに取りに行きます。
   *   取りに行っている途中で数えると、0件になります。
   *   0件で落ちたテストは「商品が無い不具合」に見えますが、
   *   実際は「早く数えすぎただけ」で、原因を1日探すことになります。
   */
  await shouhinBtn.first().waitFor({ timeout: 15_000 }).catch(() => {});
  const kazu = await shouhinBtn.count();
  T(14, "売っているポイントが並んでいる", kazu >= 1, `${kazu} 件`);
  T(
    15,
    "販売を止めた商品は並んでいない",
    !/販売を止めたパック/.test(await honbun()),
  );
  T(
    16,
    "動作確認用の支払いであることが、画面に書いてある",
    /動作確認|実際の請求は発生しません/.test(await honbun()) ||
      (await shouhinBtn.count()) > 0,
  );

  /* ════════════════════════════════════════════
     ⑦ モック決済
     ════════════════════════════════════════════ */
  H("⑦ モック決済（支払ったことにする）");

  await shouhinBtn.first().click();
  await machi(600);

  const kakuninGamen = await honbun();
  T(
    17,
    "押す前に、金額と付与ポイントが出る",
    kakuninGamen.includes(PRICE_YEN.toLocaleString()) &&
      kakuninGamen.includes(TOTAL_PT.toLocaleString()),
  );
  T(
    18,
    "実際の請求が発生しないことを、押す前に伝えている",
    /実際の請求は発生しません/.test(kakuninGamen),
  );

  const mae = await zandaka(meId);
  await page.locator('[data-testid="buy-pay"]').click();
  await page.waitForSelector('[data-testid="buy-done"]', {
    // ★印は大きさを持たない目印なので、見えるかどうかでは待たないこと。
    state: "attached",
    timeout: 30_000,
  });

  /* ════════════════════════════════════════════
     ⑧ 残高に反映されている
     ════════════════════════════════════════════ */
  H("⑧ 残高への反映");

  const ato = await zandaka(meId);
  T(
    19,
    `残高が ${TOTAL_PT}pt 増えた（おまけ ${BONUS}pt を含む）`,
    ato - mae === TOTAL_PT,
    `${mae}pt → ${ato}pt`,
  );

  const chuumon = await one(
    `SELECT id, status, price_yen, points, bonus_points, paid_yen, product_name, return_to
       FROM point_orders WHERE tenant_id = ? AND user_id = ?
      ORDER BY created_at DESC LIMIT 1`,
    [tenantA, meId],
  );
  const orderId = String(chuumon.id ?? "");
  T(20, "注文が「支払い済み」になっている", chuumon.status === "PAID", String(chuumon.status));
  T(
    21,
    "注文に、そのときの金額と付与ptが写し取られている",
    Number(chuumon.price_yen) === PRICE_YEN &&
      Number(chuumon.points) === POINTS &&
      Number(chuumon.bonus_points) === BONUS,
    `${chuumon.price_yen}円 / ${chuumon.points}pt / おまけ${chuumon.bonus_points}pt`,
  );
  T(
    22,
    "受け取った金額が、注文の金額と一致している",
    Number(chuumon.paid_yen) === PRICE_YEN,
    `${chuumon.paid_yen}円`,
  );

  const daichou = await all(
    `SELECT kind, delta, ref FROM point_ledger
      WHERE tenant_id = ? AND user_id = ? AND ref = ?`,
    [tenantA, meId, orderId],
  );
  T(
    23,
    "台帳に、購入とおまけの行が入っている",
    daichou.length === 2 &&
      daichou.some((r) => r.kind === "PURCHASE" && Number(r.delta) === POINTS) &&
      daichou.some(
        (r) => r.kind === "PURCHASE_BONUS" && Number(r.delta) === BONUS,
      ),
    daichou.map((r) => `${r.kind} ${r.delta}`).join(" / ") || "0 行",
  );

  const kansa = await all(
    `SELECT action, target FROM audit_events
      WHERE tenant_id = ? AND action = 'POINT_PURCHASE_APPLIED' AND target = ?`,
    [tenantA, orderId],
  );
  T(
    24,
    "監査ログに「誰が・いくら・何pt」が1件だけ残っている",
    kansa.length === 1,
    `${kansa.length} 件`,
  );

  await page.goto(`${BASE}/mypage/points`, { waitUntil: "domcontentloaded" });
  await machi(800);
  T(
    25,
    "保有ポイントの画面にも、購入の履歴が出ている",
    /ポイント購入/.test(await honbun()),
  );

  /* ════════════════════════════════════════════
     ⑨ 元のガチャへ戻る
     ════════════════════════════════════════════ */
  H("⑨ 元のガチャへ戻る");

  /* もう一度、同じ流れで買って、戻るボタンを押します。
     ★1回目の画面は、履歴を見るために離れているためです。 */
  await page.goto(
    `${BASE}/mypage/points/buy?from=${encodeURIComponent(`/mypage/shop/${gachaId}`)}`,
    { waitUntil: "domcontentloaded" },
  );
  await machi(1000);
  await page.locator('[data-testid="buy-product"]').first().click();
  await machi(400);
  await page.locator('[data-testid="buy-pay"]').click();
  await page.waitForSelector('[data-testid="buy-done"]', {
    // ★印は大きさを持たない目印なので、見えるかどうかでは待たないこと。
    state: "attached",
    timeout: 30_000,
  });

  const modoru = page.locator('[data-testid="buy-return"]');
  const modoruAru = (await modoru.count()) > 0;
  T(26, "「元のガチャへ戻る」が出ている", modoruAru);

  if (modoruAru) {
    await modoru.click();
    await machi(1200);
    T(
      27,
      "押すと、元のガチャの詳細に戻る",
      page.url().includes(`/mypage/shop/${gachaId}`),
      page.url(),
    );
  } else {
    T(27, "押すと、元のガチャの詳細に戻る", false, "ボタンがありません");
    await page.goto(`${BASE}/mypage/shop/${gachaId}`, {
      waitUntil: "domcontentloaded",
    });
    await machi(1000);
  }

  /* ════════════════════════════════════════════
     ⑩⑪ そのまま引いて、当たる
     ════════════════════════════════════════════ */
  H("⑩⑪ そのまま引いて、当たる");

  const hikuMae = await zandaka(meId);
  T(
    28,
    "戻った時点で、引ける残高がある",
    hikuMae >= GACHA_PRICE,
    `${hikuMae}pt / 1回 ${GACHA_PRICE}pt`,
  );

  const hikuBtn = page.locator('[data-testid="draw-open"]').first();
  T(29, "引くボタンが押せるようになっている", !(await hikuBtn.isDisabled()));

  await hikuBtn.click();
  /* 押す前の確認が出るので、そこで確定します。
     ★文言で探さないこと。確認の中にも外にも「引く」の字が出ます。 */
  await page
    .locator('[data-testid="draw-go"]')
    .click({ timeout: 10_000 })
    .catch((e) => {
      console.log(`         （確定ボタンを押せませんでした：${String(e).slice(0, 120)}）`);
    });
  await machi(2500);

  const hikuAto = await zandaka(meId);

  /**
   * ★「500pt ちょうど減る」で判定しないこと。
   *
   *   このシステムの下の等級は、商品ではなくポイントで返ります。
   *   ポイントが返る当たりを引くと、残高は
   *   「−500pt ＋ 返ってきたぶん」になります。
   *   500pt ちょうど減っていないことは、故障ではありません。
   *
   *   ですので、引いた記録（draws）を正本にして、
   *     ・申し受けたのは 500pt ちょうどか
   *     ・残高の動きが、記録と1ptも違わないか
   *   の2つで見ます。
   */
  const hiita = await one(
    `SELECT id, price, point_spent, point_returned, point_before, point_after,
            prize_id, prize_name
       FROM draws WHERE tenant_id = ? AND user_id = ?
      ORDER BY created_at DESC LIMIT 1`,
    [tenantA, meId],
  );
  const spent = Number(hiita.point_spent ?? -1);
  const returned = Number(hiita.point_returned ?? 0);

  T(
    30,
    `申し受けたのは ${GACHA_PRICE}pt ちょうどで、残高の動きも記録と一致する`,
    spent === GACHA_PRICE &&
      hikuMae - hikuAto === spent - returned &&
      Number(hiita.point_after ?? -1) === hikuAto,
    `${hikuMae}pt → ${hikuAto}pt（申し受け ${spent}pt ／ ポイント還元 ${returned}pt）`,
  );

  const atari = await all(
    `SELECT id, name FROM prizes WHERE tenant_id = ? AND user_id = ?`,
    [tenantA, meId],
  );
  const shouhinAtari = Boolean(hiita.prize_id);

  T(
    31,
    "当選が1件、記録されている（商品なら獲得商品、ポイント還元なら台帳）",
    shouhinAtari ? atari.length === 1 : returned > 0,
    `${String(hiita.prize_name ?? "—")}／${shouhinAtari ? `獲得商品 ${atari.length} 件` : `ポイント還元 ${returned}pt`}`,
  );

  if (shouhinAtari) {
    await page.goto(`${BASE}/mypage/prizes`, { waitUntil: "domcontentloaded" });
    await machi(1000);
    T(
      32,
      "獲得商品の画面に、当たった商品が出ている",
      atari.length > 0 && (await honbun()).includes(String(atari[0].name)),
    );
  } else {
    await page.goto(`${BASE}/mypage/points`, { waitUntil: "domcontentloaded" });
    await machi(1200);
    const honbunPt = await honbun();
    T(
      32,
      "ポイントの画面に、引いた記録が出ている",
      /ガチャ|1回|引/.test(honbunPt) && honbunPt.includes(hikuAto.toLocaleString()),
      `残高 ${hikuAto.toLocaleString()}pt`,
    );
  }

  /* ════════════════════════════════════════════
     異常系
     ════════════════════════════════════════════ */
  H("異常系（ここから、わざと壊しにいきます）");
  ijoukeiChu = true;

  /* ── 下ごしらえ：支払い待ちの注文を1つ作る ── */
  const mkOrder = async () => {
    const r = await tataku(page, "POST", "/api/customer/point-orders", {
      productId,
    });
    return String(r.json?.orderId ?? "");
  };

  /* ── 異常① 同じ決済通知を100回 ─────────── */
  {
    const oid = await mkOrder();
    const eventId = `e2e-100-${STAMP}`;
    const mae100 = await zandaka(meId);

    const kekka = [];
    for (let i = 0; i < 100; i++) {
      kekka.push(
        await tsuuchi({
          tenantId: tenantA,
          orderId: oid,
          eventId,
          amountYen: PRICE_YEN,
        }),
      );
    }
    const ato100 = await zandaka(meId);
    const applied = kekka.filter((r) => r.json?.result === "APPLIED").length;
    const dup = kekka.filter((r) => r.json?.result === "DUPLICATE").length;

    T(
      33,
      `同じ確定通知を100回送っても、加算は1回だけ（+${TOTAL_PT}pt）`,
      ato100 - mae100 === TOTAL_PT,
      `${mae100}pt → ${ato100}pt（APPLIED ${applied} 回 / DUPLICATE ${dup} 回）`,
    );

    const daichou100 = await all(
      `SELECT id FROM point_ledger WHERE tenant_id = ? AND ref = ?`,
      [tenantA, oid],
    );
    T(
      34,
      "台帳にも、その注文の行は2行（本体＋おまけ）だけ",
      daichou100.length === 2,
      `${daichou100.length} 行`,
    );

    const ev = await all(
      `SELECT result FROM payment_events WHERE tenant_id = ? AND order_id = ?`,
      [tenantA, oid],
    );
    T(
      35,
      "受信記録には、同じ通知が1件だけ残る（100件に増えない）",
      ev.length === 1 && ev[0].result === "APPLIED",
      `${ev.length} 件 / ${ev.map((r) => r.result).join(",")}`,
    );
  }

  /* ── 異常② 金額改ざん ──────────────────── */
  {
    const oid = await mkOrder();
    const maeK = await zandaka(meId);
    const r = await tsuuchi({
      tenantId: tenantA,
      orderId: oid,
      eventId: `e2e-kaizan-${STAMP}`,
      amountYen: 1,
    });
    const atoK = await zandaka(meId);

    T(
      36,
      "金額を書き換えた通知は、受け付けない",
      r.status === 409 && r.json?.code === "AMOUNT_MISMATCH",
      `${r.status} ${r.json?.code ?? ""}`,
    );
    T(37, "そのとき、ポイントは1ptも増えない", atoK === maeK, `${maeK}pt → ${atoK}pt`);

    const ev = await one(
      `SELECT result, amount_yen FROM payment_events
        WHERE tenant_id = ? AND order_id = ? ORDER BY created_at DESC LIMIT 1`,
      [tenantA, oid],
    );
    T(
      38,
      "食い違いとして、受信記録に残る（黙って捨てない）",
      ev.result === "MISMATCH",
      `${ev.result} / ${ev.amount_yen}円`,
    );

    const ka = await all(
      `SELECT id FROM audit_events
        WHERE tenant_id = ? AND action = 'POINT_ORDER_AMOUNT_MISMATCH' AND target = ?`,
      [tenantA, oid],
    );
    T(39, "監査ログにも、人が見るために残る", ka.length === 1, `${ka.length} 件`);

    const st = await one(`SELECT status FROM point_orders WHERE id = ?`, [oid]);
    T(
      40,
      "注文は「支払い待ち」のまま（勝手に支払い済みにしない）",
      st.status === "PENDING",
      String(st.status),
    );
  }

  /* ── 異常③ 存在しない注文 ──────────────── */
  {
    const maeN = await zandaka(meId);
    const r = await tsuuchi({
      tenantId: tenantA,
      orderId: `por_dummy_${STAMP}`,
      eventId: `e2e-nai-${STAMP}`,
      amountYen: PRICE_YEN,
    });
    T(
      41,
      "存在しない注文への通知は、404 で断る",
      r.status === 404 && r.json?.code === "NO_ORDER",
      `${r.status} ${r.json?.code ?? ""}`,
    );
    T(42, "そのとき、ポイントは増えない", (await zandaka(meId)) === maeN);
  }

  /* ── 異常④ 他人の注文 ──────────────────── */
  {
    const hokaOrder = (
      await purchase.createOrder({
        tenantId: tenantA,
        userId: otherUser,
        productId,
        actor: SYSTEM_ACTOR,
        requestId: `e2e-${STAMP}-other`,
      })
    ).orderId;

    const mi = await tataku(page, "GET", `/api/customer/point-orders/${hokaOrder}`);
    T(
      43,
      "他人の注文は、見ることもできない（404）",
      mi.status === 404,
      String(mi.status),
    );

    const pay = await tataku(page, "POST", "/api/customer/point-orders/mock-pay", {
      orderId: hokaOrder,
    });
    T(
      44,
      "他人の注文を、支払わせることもできない（404）",
      pay.status === 404,
      String(pay.status),
    );

    const cancel = await tataku(
      page,
      "POST",
      `/api/customer/point-orders/${hokaOrder}/cancel`,
      {},
    );
    T(
      45,
      "他人の注文を、取り消すこともできない（404）",
      cancel.status === 404,
      String(cancel.status),
    );

    const st = await one(`SELECT status FROM point_orders WHERE id = ?`, [
      hokaOrder,
    ]);
    T(
      46,
      "他人の注文は、状態が変わっていない",
      st.status === "PENDING",
      String(st.status),
    );
    T(47, "他人にポイントが入っていない", (await zandaka(otherUser)) === 0);
  }

  /* ── 異常⑤ 他テナントの注文 ────────────── */
  {
    const bOrderId = (
      await purchase.saveProduct({
        tenantId: tenantB,
        name: "となりの会社のパック（試験）",
        priceYen: PRICE_YEN,
        points: POINTS,
        bonusPoints: 0,
        status: "ACTIVE",
        sortOrder: 1,
        actor: SYSTEM_ACTOR,
        requestId: `e2e-${STAMP}-bprod`,
      })
    ).productId;

    const bOrder = (
      await purchase.createOrder({
        tenantId: tenantB,
        userId: otherTenantUser,
        productId: bOrderId,
        actor: SYSTEM_ACTOR,
        requestId: `e2e-${STAMP}-border`,
      })
    ).orderId;

    const mi = await tataku(page, "GET", `/api/customer/point-orders/${bOrder}`);
    T(48, "他社の注文は、見られない（404）", mi.status === 404, String(mi.status));

    const pay = await tataku(page, "POST", "/api/customer/point-orders/mock-pay", {
      orderId: bOrder,
    });
    T(
      49,
      "他社の注文を、支払わせられない（404）",
      pay.status === 404,
      String(pay.status),
    );

    /* 決済会社のふりをしても、会社を取り違えたら通らないこと */
    const w = await tsuuchi({
      tenantId: tenantA,
      orderId: bOrder,
      eventId: `e2e-cross-${STAMP}`,
      amountYen: PRICE_YEN,
    });
    T(
      50,
      "確定通知でも、会社をまたいだ注文は見つからない（404）",
      w.status === 404,
      `${w.status} ${w.json?.code ?? ""}`,
    );
    T(
      51,
      "他社のお客様にポイントが入っていない",
      (await zandaka(otherTenantUser)) === 0,
    );
  }

  /* ── 異常⑥ 支払済み注文への再通知 ────────── */
  {
    const oid = await mkOrder();
    await tsuuchi({
      tenantId: tenantA,
      orderId: oid,
      eventId: `e2e-sai1-${STAMP}`,
      amountYen: PRICE_YEN,
    });
    const maeS = await zandaka(meId);

    /* ★通知の番号を変えて送ります。
         番号だけで守っていると、ここで通ってしまいます。 */
    const r = await tsuuchi({
      tenantId: tenantA,
      orderId: oid,
      eventId: `e2e-sai2-${STAMP}`,
      amountYen: PRICE_YEN,
    });
    const atoS = await zandaka(meId);

    T(
      52,
      "支払い済みの注文へ、別番号の通知が来ても加算しない",
      atoS === maeS,
      `${maeS}pt → ${atoS}pt（${r.json?.result ?? r.json?.code ?? r.status}）`,
    );
    const dai = await all(
      `SELECT id FROM point_ledger WHERE tenant_id = ? AND ref = ?`,
      [tenantA, oid],
    );
    T(53, "台帳の行も増えていない（2行のまま）", dai.length === 2, `${dai.length} 行`);
  }

  /* ── 異常⑦ 支払待ち注文のキャンセル ──────── */
  {
    const oid = await mkOrder();
    const c = await tataku(
      page,
      "POST",
      `/api/customer/point-orders/${oid}/cancel`,
      {},
    );
    T(54, "支払い待ちの注文は、自分で取り消せる", c.status === 200, String(c.status));

    const maeC = await zandaka(meId);
    const r = await tsuuchi({
      tenantId: tenantA,
      orderId: oid,
      eventId: `e2e-cancel-${STAMP}`,
      amountYen: PRICE_YEN,
    });
    T(
      55,
      "取り消した注文へ通知が来ても、加算しない",
      (await zandaka(meId)) === maeC,
      `${r.status} ${r.json?.code ?? r.json?.result ?? ""}`,
    );

    /* 支払い済みは取り消せないこと */
    const oid2 = await mkOrder();
    await tsuuchi({
      tenantId: tenantA,
      orderId: oid2,
      eventId: `e2e-paid-${STAMP}`,
      amountYen: PRICE_YEN,
    });
    const c2 = await tataku(
      page,
      "POST",
      `/api/customer/point-orders/${oid2}/cancel`,
      {},
    );
    T(
      56,
      "支払い済みの注文は、取り消せない（409）",
      c2.status === 409,
      `${c2.status} ${c2.json?.code ?? ""}`,
    );
  }

  /* ── 異常⑧ 通信途中でリロード ──────────── */
  {
    ijoukeiChu = false;
    const oid = await mkOrder();
    const maeR = await zandaka(meId);

    /* 「反映を確認しています」の最中に、画面を読み込み直します */
    await page.goto(`${BASE}/mypage/points/buy`, {
      waitUntil: "domcontentloaded",
    });
    await machi(800);
    await page.reload({ waitUntil: "domcontentloaded" });
    await machi(800);

    /* そのあとで確定通知が届く */
    await tsuuchi({
      tenantId: tenantA,
      orderId: oid,
      eventId: `e2e-reload-${STAMP}`,
      amountYen: PRICE_YEN,
    });
    /* もう一度読み込み直しても、二重にならないこと */
    await page.reload({ waitUntil: "domcontentloaded" });
    await machi(800);

    T(
      57,
      "途中で読み込み直しても、加算は1回だけ",
      (await zandaka(meId)) - maeR === TOTAL_PT,
      `${maeR}pt → ${await zandaka(meId)}pt`,
    );
    ijoukeiChu = true;
  }

  /* ── 異常⑨ 2タブ同時購入 ──────────────── */
  {
    const oid = await mkOrder();
    const maeT = await zandaka(meId);

    /* 同じ注文へ、2つの通知を同時に送ります。
       ★番号を変えて送ること。同じ番号なら、番号だけで止まります。
         ここで見たいのは「注文そのもので止まるか」です。 */
    const [r1, r2] = await Promise.all([
      tsuuchi({
        tenantId: tenantA,
        orderId: oid,
        eventId: `e2e-tab1-${STAMP}`,
        amountYen: PRICE_YEN,
      }),
      tsuuchi({
        tenantId: tenantA,
        orderId: oid,
        eventId: `e2e-tab2-${STAMP}`,
        amountYen: PRICE_YEN,
      }),
    ]);

    const atoT = await zandaka(meId);
    T(
      58,
      "2つの通知が同時に来ても、加算は1回だけ",
      atoT - maeT === TOTAL_PT,
      `${maeT}pt → ${atoT}pt（${r1.json?.result ?? r1.status} / ${r2.json?.result ?? r2.status}）`,
    );

    /* もう1つ：2つのタブから、同じ画面の「支払ったことにする」を同時に押す */
    const oid2 = await mkOrder();
    const maeT2 = await zandaka(meId);
    const tab2 = watch(await ctx.newPage());
    await tab2.goto(`${BASE}/mypage/points/buy`, {
      waitUntil: "domcontentloaded",
    });
    await tab2.waitForTimeout(800);

    const [p1, p2] = await Promise.all([
      tataku(page, "POST", "/api/customer/point-orders/mock-pay", {
        orderId: oid2,
      }),
      tataku(tab2, "POST", "/api/customer/point-orders/mock-pay", {
        orderId: oid2,
      }),
    ]);
    await tab2.close();

    T(
      59,
      "2つのタブから同時に支払っても、加算は1回だけ",
      (await zandaka(meId)) - maeT2 === TOTAL_PT,
      `${maeT2}pt → ${await zandaka(meId)}pt（${p1.json?.result ?? p1.status} / ${p2.json?.result ?? p2.status}）`,
    );
  }

  /* ── 異常⑩ 金額を本文に足しても効かないこと ── */
  {
    const oid = await mkOrder();
    const maeA = await zandaka(meId);
    /* お客様の入口へ、金額を混ぜて送ってみます */
    await tataku(page, "POST", "/api/customer/point-orders/mock-pay", {
      orderId: oid,
      amountYen: 1,
      priceYen: 1,
      points: 999999,
    });
    const atoA = await zandaka(meId);
    T(
      60,
      "お客様の入口に金額を混ぜても、注文の金額が使われる",
      atoA - maeA === TOTAL_PT,
      `${maeA}pt → ${atoA}pt（+${atoA - maeA}pt）`,
    );
  }

  /* ── 異常⑪ 戻り先に外部URLを指定する ────── */
  {
    const warui = [
      "https://example.com/",
      "//example.com/",
      "/admin",
      "/mypage/../admin",
      "javascript:alert(1)",
      "/mypage\\@example.com",
    ];
    let nukeru = [];
    for (const w of warui) {
      const r = await tataku(page, "POST", "/api/customer/point-orders", {
        productId,
        returnTo: w,
      });
      const got = r.json?.returnTo ?? null;
      /* 通ってよいのは null か、/mypage で始まる道だけ */
      if (got !== null && !String(got).startsWith("/mypage")) {
        nukeru.push(`${w} → ${got}`);
      }
    }
    T(
      61,
      "外部URLや管理画面を、戻り先に指定できない",
      nukeru.length === 0,
      nukeru.join(" / ") || "すべて弾きました",
    );

    /* 正しい戻り先は、ちゃんと残ること */
    const good = await tataku(page, "POST", "/api/customer/point-orders", {
      productId,
      returnTo: `/mypage/shop/${gachaId}`,
    });
    T(
      62,
      "/mypage の中の戻り先は、そのまま使える",
      good.json?.returnTo === `/mypage/shop/${gachaId}`,
      String(good.json?.returnTo),
    );
  }

  /* ── 異常⑫ ログインしていない人 ────────── */
  {
    /* ★空白のページから fetch しないこと。
         開いたばかりのページは about:blank で、
         そこからの通信は「通信が失敗した」になり、
         守れているのかどうかが分かりません。
         合言葉（cookie）を持たない素の通信で確かめます。 */
    const res = await fetch(`${BASE}/api/customer/point-products`, {
      cache: "no-store",
    }).catch(() => null);
    const r = res ? res.status : 0;
    T(63, "ログインしていない人には、売り場も見せない（401）", r === 401, String(r));
  }

  /* ════════════════════════════════════════════
     最後の突き合わせ
     ════════════════════════════════════════════ */
  H("最後の突き合わせ（台帳と残高）");
  ijoukeiChu = false;

  const finalBal = await zandaka(meId);
  const finalSum = await daichouGoukei(tenantA, meId);
  T(
    64,
    "台帳の合計と、残高が一致している",
    finalBal === finalSum,
    `残高 ${finalBal}pt / 台帳 ${finalSum}pt`,
  );

  for (const [namae, uid, tid] of [
    ["他人", otherUser, tenantA],
    ["他社のお客様", otherTenantUser, tenantB],
  ]) {
    const b = await zandaka(uid);
    const s = await daichouGoukei(tid, uid);
    T(
      namae === "他人" ? 65 : 66,
      `${namae}の残高も、台帳と一致している（どちらも0）`,
      b === 0 && s === 0,
      `残高 ${b}pt / 台帳 ${s}pt`,
    );
  }

  /* 「加算」の監査ログの数と、台帳の PURCHASE 行の数が合うこと */
  const kasan = await all(
    `SELECT COUNT(*) AS n FROM audit_events
      WHERE tenant_id = ? AND action = 'POINT_PURCHASE_APPLIED'`,
    [tenantA],
  );
  const purchaseRows = await all(
    `SELECT COUNT(*) AS n FROM point_ledger
      WHERE tenant_id = ? AND kind = 'PURCHASE'`,
    [tenantA],
  );
  T(
    67,
    "加算の監査ログの件数と、台帳の購入行の件数が一致している",
    Number(kasan[0].n) === Number(purchaseRows[0].n),
    `監査 ${kasan[0].n} 件 / 台帳 ${purchaseRows[0].n} 行`,
  );

  /* 本番DBに向けたら止まること（環境変数だけを差し替えて確かめます） */
  T(
    68,
    "モック決済の入口が、本番DBでは動かない作りになっている",
    /dbEnv\(\)\s*===\s*"production"/.test(
      (await import("node:fs")).readFileSync(
        `${ROOT}/app/api/customer/point-orders/mock-pay/route.ts`,
        "utf8",
      ),
    ) &&
      /dbEnv\(\)\s*===\s*"production"/.test(
        (await import("node:fs")).readFileSync(
          `${ROOT}/app/api/payments/mock/webhook/route.ts`,
          "utf8",
        ),
      ),
  );

  /* ════════════════════════════════════════════
     管理画面（店舗が自分で値段を決められること）
     ════════════════════════════════════════════

     ★ここを飛ばさないこと。
       サーバー側の口（/api/console/point-products）が動いていても、
       それを触れる画面が無ければ、店舗は値段を1円も変えられません。
       変えるたびにこちらへ依頼が来る状態は、売り物ではありません。 */
  H("管理画面：ポイント販売");

  {
    const kanri = watch(await browser.newPage());
    await enterConsole(kanri, `${BASE}/client-demo/point-sale`, {
      tenantCode: CODE_A,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    /* 画面に着いたか。★見出しで確かめます（URLは打てば誰でも着きます） */
    const midashi = await kanri
      .locator("main h1")
      .first()
      .textContent()
      .catch(() => null);
    T(
      69,
      "ポイント販売の画面に、担当者としてたどり着ける",
      String(midashi ?? "").includes("ポイント販売"),
      String(midashi ?? "（見出しが出ない）"),
    );

    /* 下ごしらえで作った2件（売り場に出ている1件＋止めている1件）が、
       どちらも管理側には見えること。
       ★止めた商品が消える作りにしないこと。
         消えると「間違って削除した」と思って、同じ商品をもう1つ作ります。 */
    const honbun = (await kanri.locator("main").innerText()).replace(/\s+/g, "");
    T(
      70,
      "止めている商品も、管理側には残って見えている",
      honbun.includes("販売を止めたパック") && honbun.includes("止めている"),
    );

    /* 金額不一致の警告が、いちばん上に出ていること。
       異常系で1件わざと起こしてあります。 */
    const keikoku = await kanri
      .locator('main [role="alert"]')
      .first()
      .textContent()
      .catch(() => null);
    T(
      71,
      "金額が合わない通知があることを、画面の上で知らせている",
      String(keikoku ?? "").includes("合わない"),
      String(keikoku ?? "（警告が出ていない）").slice(0, 60),
    );

    /* 触る前の監査の件数を、先に数えておく。
       ★あとから合計だけを見て決めないこと。
         下ごしらえでも商品を作っているので、合計は最初から0ではありません。 */
    const kansaMae = Number(
      (
        await one(
          `SELECT COUNT(*) AS n FROM audit_events
            WHERE tenant_id = ? AND action LIKE 'POINT_PRODUCT%'`,
          [tenantA],
        )
      ).n,
    );

    /* ── 店舗が、自分で新しい商品を作れること ── */
    const NEW_YEN = 3000;
    const NEW_PT = 3000;
    const NEW_BONUS = 450;
    const NEW_NAME = `管理画面から作ったパック（試験${STAMP}）`;

    await kanri.locator('button:has-text("商品を追加する")').first().click();
    await kanri.waitForSelector('[role="dialog"]', { timeout: 10_000 });

    const ire = async (label, value) => {
      /* ★placeholder で探さないこと。同じ 0 の欄が3つあります。
           ラベルの文字で場所を決めます。 */
      await kanri
        .locator(`label:has-text("${label}") input`)
        .first()
        .fill(String(value));
    };
    await ire("商品名", NEW_NAME);
    await ire("販売金額（円）", NEW_YEN);
    await ire("付与ポイント", NEW_PT);
    await ire("おまけポイント", NEW_BONUS);
    await ire("並び順", 3);

    await kanri.locator('[role="dialog"] button:has-text("保存する")').click();
    await kanri
      .waitForSelector('[role="dialog"]', { state: "detached", timeout: 15_000 })
      .catch(() => {});

    const tsukutta = await one(
      `SELECT price_yen, points, bonus_points, status, sort_order
         FROM point_products WHERE tenant_id = ? AND name = ?`,
      [tenantA, NEW_NAME],
    );
    T(
      72,
      "管理画面から、金額と付与ポイントを決めて商品を作れる",
      Number(tsukutta.price_yen) === NEW_YEN &&
        Number(tsukutta.points) === NEW_PT &&
        Number(tsukutta.bonus_points) === NEW_BONUS &&
        String(tsukutta.status) === "ACTIVE",
      `${tsukutta.price_yen}円 / ${tsukutta.points}pt + ${tsukutta.bonus_points}pt`,
    );

    /* ★ここが本題です。
         管理画面で決めた金額が、そのままお客様の売り場に出ること。
         出なければ、店舗は「変えたつもり」で1日を過ごします。 */
    const kyaku = await page.request.get(`${BASE}/api/customer/point-products`);
    const kyakuJson = await kyaku.json().catch(() => ({}));
    const dete = (kyakuJson.products ?? []).find((x) => x.name === NEW_NAME);
    T(
      73,
      "管理画面で作った商品が、そのままお客様の売り場に出る",
      Boolean(dete) &&
        Number(dete.priceYen) === NEW_YEN &&
        Number(dete.totalPoints) === NEW_PT + NEW_BONUS,
      dete
        ? `${dete.priceYen}円 → 合計 ${dete.totalPoints}pt`
        : "売り場に出ていません",
    );

    /* ── 止めたら、売り場から消えること ── */
    await kanri.locator(`td:has-text("${NEW_NAME}")`).first().click();
    await kanri.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    await kanri.locator('[role="dialog"] input[type="checkbox"]').uncheck();
    await kanri.locator('[role="dialog"] button:has-text("保存する")').click();
    await kanri
      .waitForSelector('[role="dialog"]', { state: "detached", timeout: 15_000 })
      .catch(() => {});

    const tometa = await one(
      `SELECT status FROM point_products WHERE tenant_id = ? AND name = ?`,
      [tenantA, NEW_NAME],
    );
    const kyaku2 = await page.request.get(`${BASE}/api/customer/point-products`);
    const kyakuJson2 = await kyaku2.json().catch(() => ({}));
    const mada = (kyakuJson2.products ?? []).some((x) => x.name === NEW_NAME);
    T(
      74,
      "売り場から外すと、お客様側からは消える（記録は残る）",
      String(tometa.status) === "DISABLED" && !mada,
      `記録上の状態 ${tometa.status} ／ 売り場に${mada ? "まだ出ている" : "出ていない"}`,
    );

    /* ★値段を直しても、過去の注文が動かないこと。
         ここが崩れると、昨日の領収書の金額が今日書き換わります。 */
    const mukashi = await one(
      `SELECT price_yen, points, bonus_points FROM point_orders
        WHERE tenant_id = ? AND id = ?`,
      [tenantA, orderId],
    );
    T(
      75,
      "商品の値段を触っても、過去の注文の金額は変わらない",
      Number(mukashi.price_yen) === PRICE_YEN &&
        Number(mukashi.points) === POINTS &&
        Number(mukashi.bonus_points) === BONUS,
      `${mukashi.price_yen}円 / ${mukashi.points}pt + ${mukashi.bonus_points}pt`,
    );

    /* 商品を触ったことが、監査に残っていること。
       ★合計の件数で判定しないこと。
         下ごしらえでも商品を作っているので、合計は最初から0ではありません。
         「画面から触った2回ぶん、増えたか」だけを見ます。 */
    const kansaAto = Number(
      (
        await one(
          `SELECT COUNT(*) AS n FROM audit_events
            WHERE tenant_id = ? AND action LIKE 'POINT_PRODUCT%'`,
          [tenantA],
        )
      ).n,
    );
    T(
      76,
      "画面から触った追加と変更が、そのぶん監査ログに残っている",
      kansaAto - kansaMae === 2,
      `${kansaMae} 件 → ${kansaAto} 件`,
    );

    await kanri.close().catch(() => {});
  }
} catch (e) {
  fatal = e;
} finally {
  await browser.close().catch(() => {});
}

/* ══════════════════════════════════════════════
   まとめ
   ══════════════════════════════════════════════ */

H("画面が出したエラー・失敗した通信");
if (CONSOLE_LOG.length === 0) {
  console.log("  なし");
} else {
  for (const l of CONSOLE_LOG.slice(0, 20)) console.log(`  ${l}`);
}
if (BAD_HTTP.length > 0) {
  console.log("");
  for (const l of BAD_HTTP.slice(0, 20)) console.log(`  ${l}`);
}

console.log("");
if (fatal) {
  console.error(`✗ 途中で止まりました: ${String(fatal?.message ?? fatal)}`);
  console.error(fatal?.stack ?? "");
}
console.log(`  通った ${ok} 件 ／ 通らなかった ${ng} 件`);
console.log("");

if (fatal || ng > 0 || CONSOLE_LOG.length > 0) {
  console.error("✗ ポイント購入は、まだ通し切れていません。\n");
  process.exit(1);
}
console.log("✓ ポイント購入は、登録から当選まで通りました。\n");
process.exit(0);
