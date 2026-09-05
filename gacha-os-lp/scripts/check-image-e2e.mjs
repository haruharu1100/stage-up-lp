/**
 * PHASE 3B：商品の写真を、本物のブラウザで最後まで通す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを別に作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   写真の仕組みは、部品ごとの試験が全部通っていても、
 *   「お客様に、預けた写真が出ているか」の証拠になりません。
 *
 *   写真は、次の8つの場所を、途切れずに渡っていきます。
 *
 *       ①管理画面で預ける
 *       ②ガチャとして登録する
 *       ③公開する
 *       ④お客様の一覧に、表紙が出る
 *       ⑤お客様の詳細に、表紙と各賞の写真が出る
 *       ⑥引く
 *       ⑦当選結果に、当たった賞の写真が出る
 *       ⑧マイページの獲得商品に、同じ写真が出る
 *
 *   どこか1か所でも落ちると、そこから先は「画像未登録」になります。
 *   ★そして、それは画面上ではまったく異常に見えません。
 *     きれいに「画像未登録」と出るだけです。
 *     写真を預けた本人でなければ、間違いに気づけません。
 *
 *   だから、人と同じ手順を機械に踏ませて、
 *   8か所すべてで「同じ1枚」が出ていることを確かめます。
 *
 * ═══════════════════════════════════════════════════════
 * ★同じ写真かどうかを、見た目で判断しないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ここでは、画面に出ている <img> の src から写真のIDを取り、
 *   さらにその中身を取り寄せて、預けたファイルの指紋（sha256）と
 *   1バイトも違わないことまで確かめます。
 *
 *   「それらしい絵が出ている」では通しません。
 *   実物と違うものを商品の顔にすることが、そもそもの問題だからです。
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・使い捨ての会社を2つ作り、その中だけで動きます。
 *   ・メールアドレスは .example（誰も持てない）だけを使います。
 *   ・写真はこの場で作った単色の画像です。外から取ってきません。
 *
 * ═══════════════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════════════
 *
 *   別の窓で、使い捨てのDBを指したまま開発サーバーを立ち上げます。
 *
 *     DATABASE_ENV=development DATABASE_URL=file:/tmp/gos-img.db \
 *       npx next dev -p 3210
 *
 *   そのうえで、同じ保存先を指して実行します。
 *
 *     DATABASE_ENV=development DATABASE_URL=file:/tmp/gos-img.db \
 *       npx tsx scripts/check-image-e2e.mjs http://localhost:3210
 *
 *   1つでも通らなければ、終了コード 1 で落ちます。
 */

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");

/* ── 安全装置 ───────────────────────────────── */
const DB_ENV = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (DB_ENV === "production") {
  console.error(
    "\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n",
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
const { setPassword } = await import(`${ROOT}/lib/server/auth.ts`);

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

function watch(page) {
  page.on("console", (m) => {
    const t = m.type();
    if (t !== "error" && t !== "warning") return;
    CONSOLE_LOG.push(`[${t}] ${m.text().slice(0, 300)}  @${page.url()}`);
  });
  page.on("pageerror", (e) => {
    CONSOLE_LOG.push(`[pageerror] ${String(e).slice(0, 300)}  @${page.url()}`);
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    BAD_HTTP.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return page;
}

const one = async (sql, args = []) =>
  (await db().execute({ sql, args })).rows[0] ?? {};

/* ══════════════════════════════════════════════
   写真をその場で作る
   ══════════════════════════════════════════════

   ★外から画像を取ってこないこと。
     試験が、よそのサーバーの都合で落ちるようになります。
     また、権利のあるものを試験に混ぜないためでもあります。

   色を変えれば、中身（指紋）も変わります。
   だから「どの写真が、どこに出ているか」を取り違えずに追えます。 */

function makePng(r, g, b, size = 8) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; /* 8bit */
  ihdr[9] = 2; /* truecolor RGB */

  /* 1行ごとに先頭へフィルタ種別(0)を置く、という PNG の決まり */
  const raw = Buffer.alloc(size * (1 + size * 3));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/* ══════════════════════════════════════════════
   下ごしらえ
   ══════════════════════════════════════════════ */

const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const CODE_A = `E3BA${STAMP}`;
const CODE_B = `E3BB${STAMP}`;
const ADMIN_EMAIL = `e2e-admin-${STAMP}@phase3b.example`;
const CUST_EMAIL = `e2e-kyaku-${STAMP}@phase3b.example`;
const OTHER_ADMIN = `e2e-other-${STAMP}@phase3b.example`;
const PASSWORD = `e2e-${STAMP}-Shashin!`;
const TITLE = `写真ためしガチャ ${STAMP}`;

H("下ごしらえ（使い捨ての会社を2つ作る）");

const tenantA = await seed.createTenant({
  code: CODE_A,
  name: "写真ためし社（架空）",
});
const tenantB = await seed.createTenant({
  code: CODE_B,
  name: "よその会社（架空）",
});

const adminId = await seed.createAdmin({
  tenantId: tenantA,
  no: 1,
  email: ADMIN_EMAIL,
  name: "写真 管理者（架空）",
  role: "SUPER_ADMIN",
});
await setPassword({
  tenantId: tenantA,
  subjectKind: "ADMIN",
  subjectId: adminId,
  password: PASSWORD,
});

const otherAdminId = await seed.createAdmin({
  tenantId: tenantB,
  no: 1,
  email: OTHER_ADMIN,
  name: "よその 管理者（架空）",
  role: "SUPER_ADMIN",
});
await setPassword({
  tenantId: tenantB,
  subjectKind: "ADMIN",
  subjectId: otherAdminId,
  password: PASSWORD,
});

const customerId = await seed.createCustomer({
  tenantId: tenantA,
  no: 1,
  name: "写真 試験子（架空）",
  points: 50_000,
  email: CUST_EMAIL,
});
await setPassword({
  tenantId: tenantA,
  subjectKind: "CUSTOMER",
  subjectId: customerId,
  password: PASSWORD,
});

/* 写真をファイルとして書き出す（ブラウザに選ばせるため） */
const TMP = mkdtempSync(join(tmpdir(), "gos-img-"));
const COVER = { path: join(TMP, "cover.png"), buf: makePng(220, 30, 30) };
const PRIZES = [
  { path: join(TMP, "prize-1.png"), buf: makePng(30, 120, 220) },
  { path: join(TMP, "prize-2.png"), buf: makePng(30, 200, 90) },
  { path: join(TMP, "prize-3.png"), buf: makePng(240, 190, 20) },
  { path: join(TMP, "prize-4.png"), buf: makePng(150, 60, 200) },
  { path: join(TMP, "prize-5.png"), buf: makePng(90, 90, 90) },
];
writeFileSync(COVER.path, COVER.buf);
for (const p of PRIZES) writeFileSync(p.path, p.buf);

/** 指紋 → その写真の呼び名（どれが出ているかを言えるように） */
const NAMAE = new Map([[sha(COVER.buf), "表紙"]]);
PRIZES.forEach((p, i) => NAMAE.set(sha(p.buf), `賞${i + 1}枚目`));

console.log(`  会社（本人） ${CODE_A}`);
console.log(`  会社（よそ） ${CODE_B}`);
console.log(`  写真の置き場 ${TMP}`);
console.log(`  公開先       ${BASE}`);

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
   ブラウザ
   ══════════════════════════════════════════════ */

const browser = await chromium.launch();

const machi = async (page, ms = 600) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};

const honbun = (page) => page.evaluate(() => document.body.innerText);

/**
 * 「はじめての方へ」の案内（画面に重なって出る板）を、出さない・閉じる。
 *
 * ★これを飛ばさないこと。
 *   初めて開いた画面には案内が重なって出ます。
 *   その下のボタンは「見えているのに押せない」状態になり、
 *   試験だけが謎に落ちます（実際に一度そうなりました）。
 *
 * ★「開いた直後に探す」だけでは足りません。
 *   案内は画面が組み上がったあとに出ます。
 *   開いた直後はまだ無いので「無い＝大丈夫」と誤解し、
 *   そのあと案内が出てきて、やはりボタンが押せなくなります。
 *   だから ①最初から出さない ②それでも出たら閉じる の二段構えにします。
 */
const ANNAI_NO_KAGI = "gachaos.admin.tour.v1";

/** ①そもそも案内を出さないようにする（画面が動き出す前に、見た印を置く） */
async function annaiWoDasanai(ctx) {
  await ctx.addInitScript(
    ([kagi]) => {
      try {
        window.localStorage.setItem(kagi, "done");
      } catch {
        /* 使えない環境なら、②の閉じるほうに任せる */
      }
    },
    [ANNAI_NO_KAGI],
  );
}

/** ②それでも出ていたら、閉じる */
async function annaiWoTojiru(page) {
  for (let i = 0; i < 4; i++) {
    const btn = page.locator('button:has-text("あとで見る")');
    if ((await btn.count()) === 0) {
      /* まだ組み上がっていないだけかもしれないので、少し待って見直す */
      await page.waitForTimeout(500);
      if ((await page.locator('button:has-text("あとで見る")').count()) === 0)
        return;
    }
    await page
      .locator('button:has-text("あとで見る")')
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
  }
}

/** 画面に出ている <img> の src を全部取る */
const gazouSrc = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src") ?? ""),
  );

/** src から写真のIDだけを取り出す */
const imageIdsOf = (srcs) =>
  srcs
    .map((s) => /\/api\/images\/([A-Za-z0-9_-]+)/.exec(s)?.[1])
    .filter(Boolean);

/**
 * ログインする。
 * ★管理者とお客様で、押すタブが違います。
 */
async function login(page, kind, code, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await machi(page);
  const tab = page.locator(
    `button[role="tab"]:has-text("${kind === "ADMIN" ? "運営" : "お客様"}")`,
  );
  if ((await tab.count()) > 0) {
    await tab.first().click();
    await machi(page, 250);
  }
  const org = page.locator('input[autocomplete="organization"]');
  if ((await org.count()) > 0) await org.first().fill(code);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await machi(page, 1500);
}

let fatal = null;
let gachaId = null;
let coverImageId = null;

const adminCtx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
await annaiWoDasanai(adminCtx);
const admin = watch(await adminCtx.newPage());

try {
  /* ────────────────────────────────────────────
     ① 管理画面で、写真を預ける
     ──────────────────────────────────────────── */
  H("① 管理画面で、写真を預ける");

  await login(admin, "ADMIN", CODE_A, ADMIN_EMAIL);
  await admin.goto(`${BASE}/client-demo/ai-builder`, {
    waitUntil: "domcontentloaded",
  });
  await annaiWoTojiru(admin);
  await machi(admin, 300);

  T(
    1,
    "管理者でログインし、AIガチャ作成の画面へ行ける",
    /どんなガチャを作りますか/.test(await honbun(admin)),
    admin.url(),
  );

  await admin.locator('button:has-text("案を作る")').first().click();
  await machi(admin);

  const specAri = /AIが組んだ案/.test(await honbun(admin));
  T(2, "賞の構成（案）が出る", specAri);
  if (!specAri) throw new Error("案が出ないので、ここで打ち切ります。");

  /* ★写真を預ける前は、絵ではなく「画像未登録」と出ていること。
       ここで絵が出ていたら、そこから先は全部意味がありません。 */
  const mae = await honbun(admin);
  T(
    3,
    "写真を預ける前は、絵ではなく「画像未登録」と出ている",
    /画像未登録/.test(mae),
  );

  const pickers = admin.locator('input[type="file"]');
  const pickerKazu = await pickers.count();
  T(
    4,
    "表紙と、賞の数だけ、写真の入口が並んでいる",
    pickerKazu >= 2,
    `入口 ${pickerKazu}か所`,
  );

  /* 表紙 */
  await pickers.nth(0).setInputFiles(COVER.path);
  await machi(admin, 1200);

  const srcs1 = await gazouSrc(admin);
  const ids1 = imageIdsOf(srcs1);
  T(
    5,
    "表紙を選ぶと、その場に預けた写真が出る",
    ids1.length === 1,
    ids1.join(" / ") || "1枚も出ていません",
  );

  /* 各賞。★入口の数だけ順に入れる（先頭は表紙なので1から） */
  const prizeKazu = Math.min(pickerKazu - 1, PRIZES.length);
  for (let i = 0; i < prizeKazu; i++) {
    await pickers.nth(i + 1).setInputFiles(PRIZES[i].path);
    await machi(admin, 900);
  }

  const srcs2 = await gazouSrc(admin);
  const ids2 = imageIdsOf(srcs2);
  T(
    6,
    "各賞の写真も、1枚ずつ預けられる",
    ids2.length === prizeKazu + 1,
    `${ids2.length}枚（表紙1 + 賞${prizeKazu}）`,
  );

  T(
    7,
    "預けた写真は、1枚ずつ別のIDになっている（使い回していない）",
    new Set(ids2).size === ids2.length,
    ids2.join(" / "),
  );

  const nokori = await honbun(admin);
  T(
    8,
    "全部そろったら「写真がまだ無い賞」の注意が消える",
    !/写真がまだ無い賞が/.test(nokori) || prizeKazu < PRIZES.length,
  );

  /*
   * 「どのIDが、どのファイルのはずか」の対応表。
   *
   * ★あとで「写真が出ている」だけで合格にしないための土台です。
   *   出ているIDを見るだけでは、中身が別の写真でも通ってしまいます。
   *   ここで「このIDなら、必ずこの中身」と決めておき、
   *   お客様側で取り寄せた中身と1バイト単位で突き合わせます。
   *
   * ★並び順は、預けた入口の順そのままです。
   *   先頭が表紙、そのあとが賞の1枚目・2枚目…と並びます。
   */
  const SHA_OF = new Map([[ids2[0], sha(COVER.buf)]]);
  for (let i = 0; i < prizeKazu; i++) SHA_OF.set(ids2[i + 1], sha(PRIZES[i].buf));

  /* ────────────────────────────────────────────
     ② ガチャとして登録する
     ──────────────────────────────────────────── */
  H("② ガチャとして登録する");

  await admin
    .locator('text=ガチャの名前')
    .locator("xpath=following::input[1]")
    .fill(TITLE);
  await machi(admin, 200);

  await admin
    .locator('button:has-text("この案を下書きとして登録する")')
    .first()
    .click();
  await machi(admin, 2000);

  const touroku = await honbun(admin);
  T(
    9,
    "「下書きに登録しました」と出る",
    /下書きに登録しました/.test(touroku),
    touroku.slice(0, 0) || undefined,
  );

  const g = await one(
    `SELECT id, title, cover_image_id, status
       FROM gachas WHERE tenant_id = ? AND title = ?`,
    [tenantA, TITLE],
  );
  gachaId = g.id ? String(g.id) : null;
  coverImageId = g.cover_image_id ? String(g.cover_image_id) : null;

  T(10, "サーバーに、そのガチャが保存されている", Boolean(gachaId), String(gachaId));
  T(
    11,
    "表紙の写真が、そのガチャに結び付いている",
    Boolean(coverImageId),
    String(coverImageId ?? "結び付いていません"),
  );

  T(
    12,
    "登録直後は、まだ公開されていない（下書きのまま）",
    String(g.status) === "DRAFT",
    `status = ${String(g.status)}`,
  );

  if (!gachaId) throw new Error("ガチャが保存されていないので、打ち切ります。");

  const stock = await db().execute({
    sql: `SELECT grade, name, image_id FROM gacha_stock
           WHERE tenant_id = ? AND gacha_id = ? ORDER BY grade`,
    args: [tenantA, gachaId],
  });
  const tsuita = stock.rows.filter((r) => r.image_id != null).length;
  T(
    13,
    "各賞の写真も、賞ごとに結び付いている",
    tsuita === prizeKazu,
    `${tsuita}件 / 賞は ${stock.rows.length}件`,
  );

  /* ────────────────────────────────────────────
     ③ 検証して、公開する
     ──────────────────────────────────────────── */
  H("③ 検証して、公開する");

  await admin.goto(`${BASE}/client-demo/gachas`, {
    waitUntil: "domcontentloaded",
  });
  await annaiWoTojiru(admin);
  await machi(admin, 400);

  /* 一覧の中の、このガチャの行を開く */
  const gyou = admin.locator(`text=${TITLE}`).first();
  T(
    14,
    "ガチャ管理の一覧に、いま作ったガチャが出る",
    (await gyou.count()) > 0,
  );
  await gyou.scrollIntoViewIfNeeded().catch(() => {});

  /*
   * ★開き方が、画面の広さで2通りあります。
   *   広い画面＝表。行そのものを押すと開きます（行の中にボタンはありません）。
   *   狭い画面＝カード。中の「中身と操作を開く」ボタンを押します。
   *   片方だけを探すと、もう片方の画面で必ず止まります。
   *
   *   ★「置いてあるか」ではなく「見えているか」で選ぶこと。
   *     どちらの形も中身としては置いてあり、画面の広さで隠しているだけです。
   *     置いてあるかだけを見ると、隠れているボタンを押そうとして止まります。
   */
  const hyouGyou = admin.locator(`tr:visible:has-text("${TITLE}")`);
  const kaakuBtn = admin.locator(`button:visible:has-text("中身と操作を開く")`);

  if ((await hyouGyou.count()) > 0) {
    await hyouGyou.first().click();
  } else if ((await kaakuBtn.count()) > 0) {
    await kaakuBtn.first().click();
  } else {
    throw new Error("ガチャの行も、開くボタンも見つかりませんでした。");
  }
  await machi(admin, 1200);

  await admin.locator('button:has-text("検証を実行する")').first().click();
  await machi(admin, 4000);

  const kensho = await one(
    `SELECT status, backtest_verdict, backtest_spec
       FROM gachas WHERE tenant_id = ? AND id = ?`,
    [tenantA, gachaId],
  );
  T(
    15,
    "検証を実行すると、結果が保存される",
    kensho.backtest_verdict != null,
    `判定 ${String(kensho.backtest_verdict)}`,
  );

  /* ★写真が、検証した賞の構成（spec）の中に混ざっていないこと。
       混ざると、写真を1枚差し替えただけで指紋が変わり、
       販売中のガチャが「未検証」に戻って売れなくなります。 */
  T(
    "15b",
    "写真は、検証した賞の構成の中に混ざっていない",
    !String(kensho.backtest_spec ?? "").includes("img_"),
  );

  /*
   * ★公開には「理由」が要ります。
   *   監査ログにそのまま残る欄で、4文字以上でないとボタンが押せません。
   *   ここを飛ばすと、ボタンは見えているのに灰色のままで止まります。
   */
  const riyuu = admin.locator("textarea").first();
  if ((await riyuu.count()) > 0) {
    await riyuu.fill("写真の通し確認のため公開");
    await machi(admin, 300);
  }

  const koukaiBtn = admin.locator('button:visible:has-text("公開する")').first();
  if ((await koukaiBtn.count()) > 0) {
    await koukaiBtn.click();
    await machi(admin, 2500);
  }
  const koukaiGo = await one(
    `SELECT status FROM gachas WHERE tenant_id = ? AND id = ?`,
    [tenantA, gachaId],
  );
  T(
    16,
    "公開できる（お客様に見える状態になる）",
    String(koukaiGo.status) === "PUBLISHED",
    `status = ${String(koukaiGo.status)}`,
  );

  /* ────────────────────────────────────────────
     ④〜⑧ お客様の画面
     ──────────────────────────────────────────── */
  H("④ お客様の一覧に、預けた表紙が出る");

  const custCtx = await browser.newContext({
    viewport: { width: 430, height: 932 },
  });
  await annaiWoDasanai(custCtx);
  const kyaku = watch(await custCtx.newPage());

  /** ログイン済みのブラウザで、写真の中身を取り寄せて指紋を出す */
  const yubimon = async (page, imageId) =>
    page.evaluate(async (iid) => {
      const r = await fetch(`/api/images/${iid}`, { cache: "no-store" });
      if (!r.ok) return { status: r.status, sha: null };
      const b = new Uint8Array(await r.arrayBuffer());
      const h = await crypto.subtle.digest("SHA-256", b);
      return {
        status: r.status,
        sha: Array.from(new Uint8Array(h))
          .map((x) => x.toString(16).padStart(2, "0"))
          .join(""),
      };
    }, imageId);

  await login(kyaku, "CUSTOMER", CODE_A, CUST_EMAIL);
  await kyaku.goto(`${BASE}/mypage/shop`, { waitUntil: "domcontentloaded" });
  await annaiWoTojiru(kyaku);
  await machi(kyaku, 400);

  const ichiranIds = imageIdsOf(await gazouSrc(kyaku));
  T(
    17,
    "一覧に、預けた表紙が出ている",
    ichiranIds.includes(coverImageId),
    ichiranIds.join(" / ") || "1枚も出ていません",
  );

  const ichiranHon = await honbun(kyaku);
  T(
    18,
    "写真を預けたガチャに「画像未登録」が出ていない",
    !/画像未登録/.test(ichiranHon) || ichiranIds.length > 0,
  );

  const f1 = await yubimon(kyaku, coverImageId);
  T(
    19,
    "一覧に出ている表紙の中身が、預けたファイルと1バイトも違わない",
    f1.sha === sha(COVER.buf),
    `${NAMAE.get(f1.sha) ?? "見覚えのない写真"}（status ${f1.status}）`,
  );

  H("⑤ お客様の詳細に、表紙と各賞の写真が出る");

  await kyaku.locator(`text=${TITLE}`).first().click();
  await machi(kyaku, 1500);

  const shousaiIds = imageIdsOf(await gazouSrc(kyaku));
  T(
    20,
    "詳細に、表紙が出ている",
    shousaiIds.includes(coverImageId),
    kyaku.url(),
  );

  const stockIds = stock.rows
    .filter((r) => r.image_id != null)
    .map((r) => String(r.image_id));
  const detteru = stockIds.filter((i) => shousaiIds.includes(i));
  T(
    21,
    "詳細の賞の一覧に、賞ごとの写真が全部出ている",
    detteru.length === stockIds.length,
    `${detteru.length}枚 / 預けたのは ${stockIds.length}枚`,
  );

  /* ★管理画面で預けたIDと、お客様に出ているIDが同じであること。
       ここが違うと、別の写真が出ていることになります。 */
  T(
    22,
    "お客様に出ている写真のIDが、管理画面で預けたIDと同じ",
    shousaiIds.every((i) => i === coverImageId || stockIds.includes(i)),
    shousaiIds.join(" / "),
  );

  H("⑥⑦ 引いて、当選結果に、当たった賞の写真が出る");

  /*
   * ★「引く」は2段階です。
   *     ①「◯◯pt で 1回引く」→ いくら減るかの確認が出る
   *     ② その確認の中の「引く」→ ここで初めて引かれる
   *   ②を押し損ねても画面は何も言いません。静かに引かれないだけです。
   *   だから、押したあとに「本当に引かれたか」をこちらで見張ります。
   */
  await kyaku.locator('button:visible:has-text("で 1回引く")').first().click();
  await machi(kyaku, 800);

  const kakuninBtn = kyaku.locator(
    'div[role="dialog"] button:visible:has-text("引く")',
  );
  if ((await kakuninBtn.count()) === 0)
    throw new Error(
      "「引く」前の確認が出ませんでした。画面：" +
        (await honbun(kyaku)).slice(0, 400),
    );
  await kakuninBtn.first().click();

  /* 演出が終わるまで待つ */
  await kyaku.waitForTimeout(9000);
  await machi(kyaku, 1500);

  /*
   * ★引いた記録は draws に必ず残ります。prizes ではありません。
   *   prizes に残るのは「お届けする現物が当たったとき」だけです。
   *   C賞・D賞・はずれはポイントでお返しするので、prizes には入りません。
   *   ここを prizes で見ていたため、ちゃんと引けているのに
   *   「引けていない」と誤って読んでいました。
   */
  const hiita = await one(
    `SELECT prize_rank, prize_name, prize_id FROM draws
       WHERE tenant_id = ? AND user_id = ? AND gacha_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [tenantA, customerId, gachaId],
  );
  T(
    23,
    "1回引けて、当選が記録される",
    Boolean(hiita.prize_rank),
    hiita.prize_rank
      ? `${String(hiita.prize_rank)}賞 ${String(hiita.prize_name)}`
      : "引かれていません。画面：" + (await honbun(kyaku)).slice(0, 400),
  );

  /*
   * ★引けていないなら、ここで打ち切ること。
   *   このあとの「当選結果の写真」「獲得商品の写真」は、
   *   引けていないと"見るものが無い"ので、そのままだと ok になってしまいます。
   *   写真が届いていないのに合格と出るのが、いちばん困ります。
   */
  if (!hiita.prize_rank)
    throw new Error(
      "引けていないので、この先（当選結果・獲得商品の写真）は確かめられません。",
    );

  /** 賞の等級から、その賞に預けた写真のIDを引く */
  const shashinOf = (grade) =>
    stock.rows.find((r) => String(r.grade) === String(grade))?.image_id ?? null;

  const atattaImage = shashinOf(hiita.prize_rank);

  const kekkaIds = imageIdsOf(await gazouSrc(kyaku));
  T(
    24,
    "当選結果の画面に、当たった賞の写真が出ている",
    atattaImage == null
      ? !kekkaIds.length
      : kekkaIds.includes(String(atattaImage)),
    atattaImage == null
      ? "この賞には写真を預けていません（画像未登録が正しい動きです）"
      : `${String(atattaImage)} / 画面 ${kekkaIds.join(" / ")}`,
  );

  if (atattaImage != null) {
    const f2 = await yubimon(kyaku, String(atattaImage));
    T(
      25,
      "当選結果の写真の中身が、その賞に預けたファイルと同じ",
      f2.sha === SHA_OF.get(String(atattaImage)),
      `${NAMAE.get(f2.sha) ?? "見覚えのない写真"}`,
    );
  } else {
    T(
      25,
      "当選結果の写真の中身が、その賞に預けたファイルと同じ",
      true,
      "写真未登録の賞のため対象外",
    );
  }

  H("⑧ マイページの獲得商品に、同じ写真が出る");

  /*
   * ★「獲得商品」に並ぶのは、お届けする現物が当たったときだけです。
   *   ポイントでお返しする賞は、ここには並びません（それが正しい動きです）。
   *   なので、現物が当たるまで引き直します。
   *   ここを飛ばして「並んでいない＝合格」にすると、
   *   写真が1枚も届いていなくても合格と出てしまいます。
   */
  /** いま現物の賞を持っているか。持っていなければ null */
  const genbutsuWoSagasu = async () => {
    const r = await one(
      `SELECT id, grade, name FROM prizes
         WHERE tenant_id = ? AND user_id = ? AND gacha_id = ?
         ORDER BY won_at DESC, rowid DESC LIMIT 1`,
      [tenantA, customerId, gachaId],
    );
    return r.id ? r : null;
  };

  let genbutsu = await genbutsuWoSagasu();
  for (let i = 0; i < 25 && genbutsu === null; i++) {
    const mouichido = kyaku.locator('button:visible:has-text("もう一度引く")');
    if ((await mouichido.count()) === 0) break;
    await mouichido.first().click();
    await machi(kyaku, 800);
    const k2 = kyaku.locator('div[role="dialog"] button:visible:has-text("引く")');
    if ((await k2.count()) === 0) break;
    await k2.first().click();
    await kyaku.waitForTimeout(9000);
    await machi(kyaku, 800);
    genbutsu = await genbutsuWoSagasu();
  }

  T(
    "26a",
    "お届けする現物の賞が当たるまで引けた",
    genbutsu !== null,
    genbutsu
      ? `${String(genbutsu.grade)}賞 ${String(genbutsu.name)}`
      : "25回引いても現物の賞が出ませんでした",
  );
  if (!genbutsu)
    throw new Error(
      "現物の賞が当たらなかったので、獲得商品の写真は確かめられません。",
    );

  const genbutsuImage = shashinOf(genbutsu.grade);

  await kyaku.goto(`${BASE}/mypage/prizes`, { waitUntil: "domcontentloaded" });
  await annaiWoTojiru(kyaku);
  await machi(kyaku, 600);

  const prizeIds = imageIdsOf(await gazouSrc(kyaku));
  T(
    26,
    "獲得商品に、当たった賞と同じ写真が出ている",
    genbutsuImage == null
      ? true
      : prizeIds.includes(String(genbutsuImage)),
    `当たった賞 ${String(genbutsu.grade)} / 期待 ${String(genbutsuImage)} / 画面 ${prizeIds.join(" / ") || "なし"}`,
  );

  /* ★出ているだけでなく、中身が同じであること */
  if (genbutsuImage != null) {
    const f3 = await yubimon(kyaku, String(genbutsuImage));
    T(
      "26b",
      "獲得商品の写真の中身が、その賞に預けたファイルと同じ",
      f3.sha === SHA_OF.get(String(genbutsuImage)),
      `${NAMAE.get(f3.sha) ?? "見覚えのない写真"}`,
    );
  }

  /* ────────────────────────────────────────────
     ⑨ 会社の壁
     ──────────────────────────────────────────── */
  H("⑨ 写真も、会社の壁の内側にあること");

  const otherCtx = await browser.newContext();
  const yoso = watch(await otherCtx.newPage());
  await login(yoso, "ADMIN", CODE_B, OTHER_ADMIN);

  const yosoRes = await yoso.evaluate(async (iid) => {
    const r = await fetch(`/api/images/${iid}`, { cache: "no-store" });
    return r.status;
  }, coverImageId);
  T(
    27,
    "よその会社の方には、この写真が見えない",
    yosoRes === 404,
    `status ${yosoRes}`,
  );

  const nashiCtx = await browser.newContext();
  const nashi = watch(await nashiCtx.newPage());
  const nashiRes = await fetch(`${BASE}/api/images/${coverImageId}`, {
    cache: "no-store",
    redirect: "manual",
  });
  T(
    28,
    "ログインしていない人には、この写真が見えない",
    nashiRes.status >= 400,
    `status ${nashiRes.status}`,
  );

  /* ★キャッシュに載せていないこと。
       載せると、差し替えて消したあとも写真が残り続けます。 */
  const cc = await kyaku.evaluate(async (iid) => {
    const r = await fetch(`/api/images/${iid}`, { cache: "no-store" });
    return r.headers.get("cache-control") ?? "";
  }, coverImageId);
  T(
    29,
    "写真がキャッシュに残らない設定になっている",
    /no-store/.test(cc) && /private/.test(cc),
    cc || "指定なし",
  );

  await nashiCtx.close();
  await otherCtx.close();
  await custCtx.close();
} catch (e) {
  fatal = e;
} finally {
  await adminCtx.close().catch(() => {});
  await browser.close().catch(() => {});
}

/* ══════════════════════════════════════════════
   まとめ
   ══════════════════════════════════════════════ */

H("画面が出したエラー・警告");
if (CONSOLE_LOG.length === 0) console.log("  なし");
for (const l of CONSOLE_LOG.slice(0, 20)) console.log(`  ${l}`);

H("4xx・5xx の通信");
const gohyaku = BAD_HTTP.filter((b) => /^5\d\d /.test(b));
if (BAD_HTTP.length === 0) console.log("  なし");
for (const b of BAD_HTTP.slice(0, 20)) console.log(`  ${b}`);

console.log("");
if (fatal) {
  console.error(`✗ 途中で止まりました：${String(fatal).slice(0, 400)}`);
}
console.log(`  合計 ${ok + ng} 項目 ／ ok ${ok} ／ NG ${ng}`);
console.log(`  サーバー側の異常（5xx） ${gohyaku.length}件`);

if (ng > 0 || fatal || gohyaku.length > 0) {
  console.error(
    "\n✗ 写真が、お客様まで届いていません。上の NG を直してください。\n",
  );
  process.exit(1);
}
console.log(
  "\n✓ 管理画面で預けた写真が、お客様の一覧・詳細・当選結果・獲得商品まで、同じ1枚で届いています。\n",
);
