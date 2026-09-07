/**
 * お店側を、本物のブラウザで、最初から最後まで1回だけ通す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これが要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   このシステムを「毎回こちらが設定してあげる受託品」ではなく
 *   「複数のお店に売れる商品」にできるかどうかは、
 *
 *       ★契約したお店が、自分だけで初期設定を終えて、
 *         自分だけで営業を開始できるか
 *
 *   の一点で決まります。
 *   ですので、ここでは何ひとつ下ごしらえをしません。
 *   空っぽの会社を1つ作って、あとは全部、画面から触ります。
 *
 *   ★makeTenantLaunchReady を、この道具から呼ばないこと。
 *     あれは試験用の値を一気に入れる裏口です。
 *     使った瞬間、この試験は「お店が自分で設定できるか」を
 *     何も確かめていないことになります。
 *
 *   通す順番（お店の方が実際にする順番）：
 *
 *       ① 店舗初期設定（12ステップ）
 *       ② 店舗情報が、お客様の画面に出る
 *       ③ 法定表示が、入力どおり全文出る
 *       ④ ポイント商品を作る／有効期限を決める
 *       ⑤ 商品の写真を登録する
 *       ⑥ ガチャを作る
 *       ⑦ 検証して、公開する
 *       ⑧ お客様がポイントを買う
 *       ⑨ お客様が引く
 *       ⑩ 売上を確認する
 *       ⑪ 当選を確認する
 *       ⑫ 注文を確認する
 *       ⑬ 発送する
 *
 * ═══════════════════════════════════════════════════════
 * ★法定表示に、こちらの文例を入れないこと
 * ═══════════════════════════════════════════════════════
 *
 *   特商法・規約・プライバシーの本文は、お店が書くものです。
 *   この道具が入れる文は、すべて「試験用」で始まる作り話です。
 *   本物のお店の表示として使えるものは、1文字も置きません。
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・使い捨ての会社を1つ作り、その中だけで動きます。
 *   ・メールは .example（誰も持てないドメイン）だけを使います。
 *   ・お支払いは mock だけ。実際の請求は起きません。
 *   ・発送も mock だけ。実際の荷物は動きません。
 *
 * ═══════════════════════════════════════════════════════
 * ★画面の幅は、広いほうで見ること
 * ═══════════════════════════════════════════════════════
 *
 *   管理画面の表は、狭い画面では隠れます（hidden md:block）。
 *   お店の方はパソコンで運営されるので、1280 で通します。
 *   お客様側だけは、スマホの幅でも見ます。
 *
 * 使い方：
 *   DATABASE_URL="file:./.data/e2e.db" DATABASE_ENV=development \
 *   npx tsx scripts/e2e-store.mjs http://localhost:3210
 */

import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");

if (!BASE || !/^https?:\/\//.test(BASE)) {
  console.error(
    "\n✗ 見に行く先のURLを指定してください。\n" +
      "  例： npx tsx scripts/e2e-store.mjs http://localhost:3210\n",
  );
  process.exit(1);
}

/* ── 安全装置 ─────────────────────────────────
     ★この3つを外さないこと。
       外した日に、本番のお客様のデータへ書き込みます。 */
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
  console.error(
    "\n✗ この道具は手元（http://localhost）専用です。\n" +
      "  ネット越しの環境へ向けるときは E2E_ALLOW_REMOTE=1 を付けてください。\n",
  );
  process.exit(1);
}

/* お店＝パソコン、お客様＝スマホ */
const MISE = { width: 1280, height: 900, label: "PC(1280)" };
const KYAKU = { width: 430, height: 932, label: "スマホ大(430)" };

/* ── Playwright は隣のプロジェクトから借りる ── */
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
const { setPassword } = await import(`${ROOT}/lib/server/auth.ts`);

const one = async (sql, args = []) => (await db().execute({ sql, args })).rows[0] ?? {};
const all = async (sql, args = []) => (await db().execute({ sql, args })).rows ?? [];
const n = (v) => Number(v ?? 0);

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
  console.log(`${pass ? "  ok " : "  NG "} ${String(no).padEnd(8)} ${title}`);
  if (detail) console.log(`          ${detail}`);
}

function H(title) {
  console.log(`\n══ ${title} ${"═".repeat(Math.max(0, 56 - title.length))}`);
}

const CONSOLE_LOG = [];
const BAD_HTTP = [];
/* 設計どおりの 403（もう一段の本人確認をお願いする合図） */
const STEPUP_403 = [];
/* 設計どおりの 409（わざと断っているところ）。
   例：確認していないガチャを公開しようとしたときの「まだ公開できません」。
   ★これを不具合として数えないこと。数えると、
     「断る作りがちゃんと効いている」という良い結果が、毎回赤字で出ます。 */
const WAZATO_409 = [];
const PAGE_ERR = [];
const MAYOI = [];

function watch(page, who) {
  page.on("console", (m) => {
    const t = m.type();
    if (t !== "error" && t !== "warning") return;
    CONSOLE_LOG.push({ who, type: t, text: m.text().slice(0, 400), url: page.url() });
  });
  page.on("pageerror", (e) =>
    PAGE_ERR.push({ who, kind: "pageerror", text: String(e).slice(0, 400), url: page.url() }),
  );
  page.on("requestfailed", (r) =>
    PAGE_ERR.push({
      who,
      kind: "requestfailed",
      text: `${r.method()} ${r.url()} : ${r.failure()?.errorText ?? "?"}`.slice(0, 400),
      url: page.url(),
    }),
  );
  page.on("response", (r) => {
    if (r.status() < 400) return;
    const rec = { who, status: r.status(), method: r.request().method(), url: r.url() };
    /* ★403 を、ぜんぶ「不具合」として数えないこと。
         お届け先の変更と発送の依頼では、
         「もう一度パスワードを入れてください」を 403 で伝える作りです。 */
    if (r.status() === 403 && /\/api\/customer\/(address|orders)/.test(r.url())) {
      STEPUP_403.push(rec);
      return;
    }
    /* ★409 のうち、わざと断っているところを不具合として数えないこと。
         「確認していないガチャは公開させない」は、守ってほしい動きです。 */
    if (r.status() === 409 && /\/api\/console\/gachas\/action/.test(r.url())) {
      WAZATO_409.push(rec);
      return;
    }
    BAD_HTTP.push(rec);
  });
  return page;
}

const yoso = (t) => /vercel\.live|_next-live\/feedback|__nextjs|hot-reloader|webpack/.test(t);
const sakiyomi = (t) => /_rsc=/.test(t) && /ERR_ABORTED/.test(t);

/* ══════════════════════════════════════════════
   画面まわりの小道具（お客様側E2Eと同じ考え方）
   ══════════════════════════════════════════════ */

async function oshiBotan(page) {
  return await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, a[href]")) {
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 28) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.2)
        continue;
      if (el.hasAttribute("disabled")) continue;
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      out.push(t.slice(0, 40));
    }
    return out;
  });
}

async function michi(page, gamen) {
  const b = await oshiBotan(page);
  if (b.length === 0) MAYOI.push({ gamen, url: page.url(), reason: "押せるものが1つも無い" });
  return b;
}

async function hamidashi(page) {
  return await page.evaluate(() => {
    const doc = document.documentElement;
    const w = doc.clientWidth;
    const scroll = doc.scrollWidth;
    const yoko = scroll > w + 1;
    const bad = [];
    if (yoko) {
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.closest("[aria-hidden='true']")) continue;
        if (r.right > w + 2) {
          const t = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
          bad.push(`${el.tagName.toLowerCase()}「${t}」 right=${Math.round(r.right)}（画面幅 ${w}）`);
        }
        if (bad.length >= 5) break;
      }
    }
    return { w, scroll, yoko, bad };
  });
}

function hamiT(no, title, h) {
  T(
    no,
    title,
    !h.yoko,
    h.yoko
      ? `横スクロールが出ている（中身 ${h.scroll}px ＞ 画面 ${h.w}px）：${h.bad.join(" / ")}`
      : `中身 ${h.scroll}px ／ 画面 ${h.w}px`,
  );
}

const moji = (page) => page.evaluate(() => document.body?.innerText ?? "");

async function machi(page, sel, ms = 15000) {
  try {
    await page.waitForSelector(sel, { timeout: ms, state: "visible" });
    return true;
  } catch {
    return false;
  }
}

async function machiAru(page, sel, ms = 15000) {
  try {
    await page.waitForSelector(sel, { timeout: ms, state: "attached" });
    return true;
  } catch {
    return false;
  }
}

/** 出るまで、何度か押す（手元のサーバーは、初めて開く画面をその場で組み立てます） */
async function press(page, sel, until, tries = 8) {
  for (let i = 0; i < tries; i += 1) {
    await page.locator(sel).first().click({ timeout: 5000 }).catch(() => {});
    try {
      await page.waitForSelector(until, { timeout: 2500, state: "visible" });
      return true;
    } catch {
      /* 空振り。もう一度押す */
    }
  }
  return false;
}

/**
 * 名前のついた入力欄に、値を入れる。
 *
 * ★見本の文字（placeholder）で欄を探さないこと。
 *   見本の文字は、お客様に伝わりやすくするために書き換わります。
 *   欄の「名前」（label）で探せば、書き換わっても壊れません。
 *
 * ★input を first() で取らないこと。
 *   ブランドカラーの欄には、色を選ぶ四角と、文字で書く欄の
 *   2つが入っています。先頭を取ると、色の四角に文字を入れようとします。
 */
async function ireru(page, label, value) {
  const box = page.locator(`label:has-text("${label}")`).first();
  if ((await box.count()) === 0) return false;
  const ta = box.locator("textarea");
  if ((await ta.count()) > 0) {
    await ta.first().fill(value);
    return true;
  }
  const inp = box.locator("input");
  if ((await inp.count()) === 0) return false;
  await inp.last().fill(value);
  return true;
}

/* ══════════════════════════════════════════════
   写真をその場で作る
   ══════════════════════════════════════════════

   ★外から画像を取ってこないこと。
     よそのサーバーの都合で落ちるようになりますし、
     権利のあるものを試験に混ぜないためでもあります。 */

function makePng(r, g, b, size = 8) {
  const crcTable = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
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
  ihdr[8] = 8;
  ihdr[9] = 2;
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

/* ══════════════════════════════════════════════
   数字の突き合わせ
   ══════════════════════════════════════════════ */

async function snap(tenantId, customerId, gachaId) {
  const cu = await one(`SELECT points FROM customers WHERE tenant_id = ? AND id = ?`, [
    tenantId,
    customerId,
  ]);
  const g = await one(
    `SELECT left_count, revenue, paid_value FROM gachas WHERE tenant_id = ? AND id = ?`,
    [tenantId, gachaId],
  );
  const dr = await one(`SELECT COUNT(*) AS c FROM draws WHERE tenant_id = ? AND user_id = ?`, [
    tenantId,
    customerId,
  ]);
  const pz = await one(`SELECT COUNT(*) AS c FROM prizes WHERE tenant_id = ? AND user_id = ?`, [
    tenantId,
    customerId,
  ]);
  return {
    points: n(cu.points),
    left: n(g.left_count),
    revenue: n(g.revenue),
    paidValue: n(g.paid_value),
    draws: n(dr.c),
    prizes: n(pz.c),
  };
}

/* ══════════════════════════════════════════════
   ここから本番
   ══════════════════════════════════════════════ */

const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const SAI = Math.random().toString(36).slice(2, 5).toUpperCase();
/* ★会社コードは16文字まで。日時＋くじ引きの3文字でちょうど収めます */
const CODE = `S2E${STAMP.slice(4)}${SAI}`.slice(0, 16);
const PASSWORD = process.env.E2E_PASSWORD ?? `e2e-${STAMP}-Kaiten!`;
const ADMIN_EMAIL = `e2e-mise-${STAMP}-${SAI.toLowerCase()}@shop.example`;
const CUST_EMAIL = `e2e-kyaku-${STAMP}-${SAI.toLowerCase()}@shop.example`;

const SHOPNAME = `試験用ガチャ商店 ${SAI}`;
const NEDAN = 500;
const KUCHI = 40;
const GACHA_TITLE = `試験用ガチャ ${STAMP}`;
const SHOP_MAIL = `support-${SAI.toLowerCase()}@shop.example`;

/* ★ここに書く文は、すべて「試験用」で始まる作り話です。
     本物のお店の法定表示として使えるものは、1文字も置きません。 */
const TERMS =
  "試験用の利用規約（作り話）\n" +
  "第1条 これは動作確認のための文章です。実際の取り決めではありません。\n" +
  `第2条 この文が本番のお店に出ていた場合、設定が終わっていません（${STAMP}）。`;
const PRIVACY =
  "試験用のプライバシーポリシー（作り話）\n" +
  "第1条 これは動作確認のための文章です。実際の取り扱いではありません。\n" +
  `第2条 この文が本番のお店に出ていた場合、設定が終わっていません（${STAMP}）。`;

/** ①店舗初期設定で、画面から打ち込む内容 */
const NYURYOKU = [
  { no: 1, title: "店舗名", fields: [["店舗名", SHOPNAME]] },
  { no: 2, title: "ロゴ", logo: true },
  { no: 3, title: "ブランドカラー", fields: [["ブランドカラー", "#1d4ed8"]] },
  {
    no: 4,
    title: "運営法人",
    fields: [
      ["運営法人名（販売業者）", "試験用ガチャ商店（架空・実在しません）"],
      ["法人名のふりがな", "しけんようがちゃしょうてん"],
      ["代表者名", "試験 太郎（架空）"],
    ],
  },
  {
    no: 5,
    title: "所在地",
    fields: [
      ["郵便番号", "100-0001"],
      ["所在地", "東京都千代田区千代田1-1 試験用ビル101（架空）"],
    ],
  },
  {
    no: 6,
    title: "問い合わせ",
    fields: [
      ["電話番号", "03-0000-0000"],
      ["問い合わせメールアドレス", SHOP_MAIL],
      ["問い合わせ受付時間", "試験用：平日 10:00〜18:00（土日祝を除く）"],
      ["問い合わせについての補足", "試験用：お返事まで2営業日ほどいただきます。"],
    ],
  },
  {
    no: 7,
    title: "特定商取引法に基づく表記",
    fields: [
      ["販売価格について", "試験用：各ガチャの画面に表示している金額です。"],
      ["商品代金以外に必要な料金（送料など）", "試験用：送料は当店が負担します。"],
      ["支払方法", "試験用：クレジットカード"],
      ["支払時期", "試験用：ご注文時に決済されます。"],
      ["商品の引渡時期", "試験用：発送のご依頼から5営業日以内に発送します。"],
      ["返品・交換について", "試験用：商品の性質上、お客様都合の返品はお受けできません。"],
      ["古物商許可番号", "試験用-0000000000000"],
    ],
  },
  { no: 8, title: "利用規約", fields: [["利用規約", TERMS]] },
  { no: 9, title: "プライバシーポリシー", fields: [["プライバシーポリシー", PRIVACY]] },
];

console.log(`\n${"═".repeat(64)}`);
console.log("  お店側 通しE2E（本物のブラウザ）");
console.log(`  見に行く先： ${BASE}`);
console.log(`  お店の画面： ${MISE.label}　お客様の画面： ${KYAKU.label}`);
console.log(`  会社コード： ${CODE}`);
console.log(`${"═".repeat(64)}`);

/* ── 下ごしらえ：からっぽの会社と、担当者と、会員 ──
     ★設定は1つも入れません。全部、画面から入れます。 */
H("下ごしらえ（からっぽの会社・担当者・会員だけ）");

const tenantId = await seed.createTenant({ code: CODE, name: `E2E店舗確認用 ${STAMP}` });

/* ── この試験で開く住所を、このお店のものにする ──────────
     ★お店側の試験でも、必ず入れ直すこと。
       同じ手元のデータベースでお客様側の試験を先に流していると、
       この住所は前の会社に割り当てられたままです。
       そのままだと、住所と合言葉が食い違って、
       担当者が自分の管理画面に入れません（これは正しい動きです）。 */
const HOST = new URL(BASE).host.toLowerCase();
await db().execute({
  sql: `INSERT INTO tenant_domains (host, tenant_id, note, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          tenant_id  = excluded.tenant_id,
          note       = excluded.note,
          created_at = excluded.created_at`,
  args: [HOST, tenantId, `E2E店舗試験用 ${STAMP}`, new Date().toISOString()],
});

const adminId = await seed.createAdmin({
  tenantId,
  no: 1,
  email: ADMIN_EMAIL,
  name: "試験 店長（架空）",
  role: "SUPER_ADMIN",
});
await setPassword({ tenantId, subjectKind: "ADMIN", subjectId: adminId, password: PASSWORD });

const customerId = await seed.createCustomer({
  tenantId,
  no: 1,
  name: "試験 花子（架空）",
  points: 0,
  email: CUST_EMAIL,
});
await setPassword({ tenantId, subjectKind: "CUSTOMER", subjectId: customerId, password: PASSWORD });

const karappo = await one(
  `SELECT COUNT(*) AS c FROM tenant_settings WHERE tenant_id = ?`,
  [tenantId],
);
T("S-00", "設定が1つも入っていない、からっぽの会社から始める", n(karappo.c) === 0, `tenant_settings=${n(karappo.c)}件`);

/* 写真をファイルにする */
const TMP = mkdtempSync(join(tmpdir(), "gos-store-"));
const LOGO = join(TMP, "logo.png");
const COVER = join(TMP, "cover.png");
const SHASHIN = [
  join(TMP, "p1.png"),
  join(TMP, "p2.png"),
  join(TMP, "p3.png"),
  join(TMP, "p4.png"),
  join(TMP, "p5.png"),
];
writeFileSync(LOGO, makePng(20, 40, 200));
writeFileSync(COVER, makePng(220, 30, 30));
[
  [30, 120, 220],
  [30, 200, 90],
  [240, 190, 20],
  [150, 60, 200],
  [90, 90, 90],
].forEach(([r, g, b], i) => writeFileSync(SHASHIN[i], makePng(r, g, b)));

/* ── ブラウザ ──────────────────────────────── */
const browser = await chromium.launch({ headless: true });

const miseCtx = await browser.newContext({
  viewport: { width: MISE.width, height: MISE.height },
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
/* ★はじめての方への案内を、先に「見たこと」にしておく。
     案内は画面の手前に出るので、出たままだと何も押せません。 */
await miseCtx.addInitScript(() => {
  try {
    window.localStorage.setItem("gachaos.admin.tour.v1", "done");
  } catch {
    /* 保存が使えない環境。そのときは案内も出ません */
  }
});
const mise = watch(await miseCtx.newPage(), "お店");
mise.setDefaultTimeout(20000);

const kyakuCtx = await browser.newContext({
  viewport: { width: KYAKU.width, height: KYAKU.height },
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
const kyaku = watch(await kyakuCtx.newPage(), "お客様");
kyaku.setDefaultTimeout(20000);

/** 管理画面の画面へ行く（URLは kebab-case） */
async function gamen(slug) {
  await mise.goto(`${BASE}/client-demo/${slug}`, { waitUntil: "domcontentloaded" });
  await mise.waitForTimeout(900);
}

let gachaId = null;
let orderId = null;

try {
  /* ══════════════════════════════════════════
     ① 店舗初期設定
     ══════════════════════════════════════════ */
  H("① 店舗初期設定");

  /* 本物のログイン（練習用の「デモ管理者としてログイン」は使いません） */
  const { enterConsole } = await import(`${ROOT}/scripts/lib/console-enter.mjs`);
  let hairi = "";
  try {
    hairi = await enterConsole(mise, `${BASE}/login`, {
      tenantCode: CODE,
      email: ADMIN_EMAIL,
      password: PASSWORD,
    });
  } catch (e) {
    hairi = `NG:${String(e).slice(0, 150)}`;
  }
  T("S-01", "お店の担当者が、本物のログインで管理画面に入れた", hairi === "login", hairi);
  if (hairi !== "login") throw new Error("管理画面に入れませんでした");

  await gamen("store-setup");
  const setup1 = await machi(mise, 'button:has-text("保存して次へ →")', 20000);
  T("S-02", "開店準備（初期設定）の画面が開いた", setup1, mise.url());

  const mae = await moji(mise);
  const maePct = /公開準備 (\d+)\/(\d+) 完了/.exec(mae);
  T(
    "S-03",
    "設定前は「まだ販売開始できません」と、はっきり出ている",
    /まだ販売開始できません/.test(mae),
    maePct ? `公開準備 ${maePct[1]}/${maePct[2]} 完了` : mae.split("\n").filter(Boolean).slice(0, 3).join(" / "),
  );
  T(
    "S-04",
    "何が足りないのかが、1つずつ文字で書いてある",
    /店舗設定で、お客様に見せる店舗名を入力してください/.test(mae),
    mae.split("\n").filter((l) => /未入力です|未設定です|ありません/.test(l)).slice(0, 3).join(" / "),
  );

  const hamiSetup = await hamidashi(mise);
  hamiT("S-05", `初期設定の画面が横にはみ出していない（${MISE.label}）`, hamiSetup);

  /* STEP 1〜9 を、画面から順に入れていく */
  for (const step of NYURYOKU) {
    /* その段へ行く（番号の札を押す） */
    const fuda = mise.locator(`button[title="${step.title}"]`).first();
    if ((await fuda.count()) > 0) await fuda.click().catch(() => {});
    await mise.waitForTimeout(400);

    if (step.logo === true) {
      const picker = mise.locator('input[type="file"]').first();
      const ari = (await picker.count()) > 0;
      if (ari) await picker.setInputFiles(LOGO);
      const noseta = ari ? await machi(mise, "text=ロゴを設定しました。", 20000) : false;
      T(`S-06-${step.no}`, `STEP ${step.no}「${step.title}」を画面から設定できた`, noseta);
      await mise.locator('button:has-text("保存して次へ →")').first().click().catch(() => {});
      await mise.waitForTimeout(900);
      continue;
    }

    let ireta = true;
    const kaita = [];
    const kakenai = [];
    for (const [label, value] of step.fields) {
      const done = await ireru(mise, label, value);
      if (!done) {
        ireta = false;
        kakenai.push(label);
      } else kaita.push(label);
    }
    if (!ireta) {
      const fuda2 = await mise
        .locator("label")
        .allInnerTexts()
        .catch(() => []);
      console.log(
        `      〔調べ〕STEP ${step.no} に出ている欄：` +
          (fuda2.map((t) => t.split("\n")[0]).join(" | ") || "（1つも無い）"),
      );
    }

    await mise.locator('button:has-text("保存して次へ →")').first().click().catch(() => {});
    /* ★「押せた」で済ませないこと。
         保存できたと画面が言うまで待ちます。 */
    const hozon = await machi(
      mise,
      `p[role="status"]:has-text("STEP ${step.no}")`,
      20000,
    );
    const shikkai = await mise
      .locator('p[role="alert"]')
      .first()
      .innerText()
      .catch(() => "");
    T(
      `S-06-${step.no}`,
      `STEP ${step.no}「${step.title}」を画面から入力して保存できた`,
      ireta && hozon,
      hozon
        ? `入力：${kaita.join("／")}`
        : `★保存できていない：${shikkai || "（画面に理由が出ていない）"}` +
          `／今いる段=${((await moji(mise)).match(/STEP\s*\d+\s*\/\s*\d+.*/) ?? ["不明"])[0].slice(0, 40)}` +
          `／書けた=${kaita.join("・") || "なし"}／書けなかった=${kakenai.join("・") || "なし"}`,
    );
    await mise.waitForTimeout(400);
  }

  /* サーバーに、打った内容がそのまま入っているか */
  const setRow = await one(
    `SELECT * FROM tenant_settings WHERE tenant_id = ?`,
    [tenantId],
  );
  const hairimasu = (v) => String(v ?? "").trim() !== "";
  const kara = Object.entries(setRow)
    .filter(([k]) => !/^(tenant_id|updated_at|updated_by|created_at)$/.test(k))
    .filter(([, v]) => !hairimasu(v))
    .map(([k]) => k);
  T(
    "S-07",
    "打ち込んだ内容が、サーバーに保存されている",
    hairimasu(setRow.shop_name) && hairimasu(setRow.terms_text) && hairimasu(setRow.privacy_text),
    `店舗名=${String(setRow.shop_name ?? "（空）")} ／ 空のままの欄=${kara.length === 0 ? "なし" : kara.join(",")}`,
  );

  /* ══════════════════════════════════════════
     ④ ポイント商品と、ポイントの有効期限
     ══════════════════════════════════════════ */
  H("④ ポイント商品を作る／有効期限を決める");

  await gamen("point-sale");
  const psOpen = await machi(mise, 'button:has-text("商品を追加する")', 20000);
  T("S-08", "ポイント販売の画面が開いた", psOpen, mise.url());

  const maeKara = await moji(mise);
  T(
    "S-09",
    "1つも無いときは、次に何をすればよいかが書いてある",
    /商品を追加する/.test(maeKara),
    maeKara.split("\n").filter((l) => /追加/.test(l)).slice(0, 2).join(" / "),
  );

  await press(mise, 'button:has-text("商品を追加する")', 'label:has-text("販売金額（円）")');
  await ireru(mise, "商品名", "試験用 1,000円ぶん");
  await ireru(mise, "販売金額（円）", "1000");
  await ireru(mise, "付与ポイント", "1000");
  await ireru(mise, "おまけポイント", "0");
  await mise.locator('button:has-text("保存する")').first().click();
  await mise.waitForTimeout(1800);

  const shohin = await all(
    `SELECT name, price_yen, points, bonus_points, status FROM point_products WHERE tenant_id = ?`,
    [tenantId],
  );
  T(
    "S-10",
    "ポイント商品を、お店が画面から作れた",
    shohin.length === 1 && n(shohin[0].price_yen) === 1000 && n(shohin[0].points) === 1000,
    shohin.map((r) => `${r.name}：${n(r.price_yen)}円→${n(r.points)}pt（+${n(r.bonus_points)}）`).join(" / ") ||
      "★1つも作れていない",
  );

  await gamen("settings");
  const seisaku = await machi(mise, 'input[name="expiry-mode"]', 20000);
  T("S-11", "ポイントの有効期限を決める場所が、設定の中にある", seisaku);

  /* ★「有効期限なし」も、お店が選んだ1つの決まりです。
       こちらが既定値として入れることはしません。画面から選びます。 */
  await mise.locator('input[name="expiry-mode"]').first().check().catch(() => {});
  const senmonka = mise.locator('input[type="checkbox"]').filter({ has: mise.locator("xpath=.") });
  await mise
    .locator('label:has-text("この内容について、専門家（弁護士・行政書士など）に確認しました") input[type="checkbox"]')
    .first()
    .check()
    .catch(() => {});
  await mise.locator('button:has-text("この内容で保存する")').first().click();
  const seisakuOk = await machi(mise, "text=で保存しました。", 20000);
  T("S-12", "有効期限の決まりを、お店が画面から保存できた", seisakuOk);

  const pol = await one(
    `SELECT expiry_mode, expiry_value, confirmed_at FROM tenant_point_policy WHERE tenant_id = ?`,
    [tenantId],
  );
  T(
    "S-13",
    "有効期限が「決めた」状態で残っている（専門家の確認の記録つき）",
    String(pol.expiry_mode ?? "") !== "" && pol.confirmed_at != null,
    `決め方=${String(pol.expiry_mode ?? "未設定")} ／ 確認の記録=${String(pol.confirmed_at ?? "なし")}`,
  );

  /* ══════════════════════════════════════════
     ⑤⑥ 商品の写真を登録して、ガチャを作る
     ══════════════════════════════════════════ */
  H("⑤⑥ 商品の写真を登録して、ガチャを作る");

  await gamen("ai-builder");
  const bOpen = await machi(mise, 'button:has-text("案を作る")', 20000);
  T("S-14", "ガチャを作る画面が開いた", bOpen, mise.url());

  await ireru(mise, "条件", "試験用：500円・40口で、S賞を強めに。");
  await ireru(mise, "1回の値段", String(NEDAN));
  await ireru(mise, "口数", String(KUCHI));
  await mise.locator('button:has-text("案を作る")').first().click();
  const an = await machi(mise, "text=AIが組んだ案", 25000);
  T("S-15", "賞の構成（案）が出た", an);
  if (!an) throw new Error("ガチャの案が出ませんでした");

  const maeGazo = await moji(mise);
  T(
    "S-16",
    "写真を預ける前は、絵ではなく「画像未登録」と出ている",
    /画像未登録/.test(maeGazo),
  );

  const pickers = mise.locator('input[type="file"]');
  const pickerKazu = await pickers.count();
  await pickers.nth(0).setInputFiles(COVER);
  await mise.waitForTimeout(1500);
  const shoKazu = Math.min(pickerKazu - 1, SHASHIN.length);
  for (let i = 0; i < shoKazu; i += 1) {
    await pickers.nth(i + 1).setInputFiles(SHASHIN[i]);
    await mise.waitForTimeout(1100);
  }
  const gazoIds = await mise.evaluate(() =>
    Array.from(document.querySelectorAll("img"))
      .map((i) => /\/api\/images\/([A-Za-z0-9_-]+)/.exec(i.getAttribute("src") ?? "")?.[1])
      .filter(Boolean),
  );
  T(
    "S-17",
    "表紙と各賞の写真を、お店が画面から登録できた",
    gazoIds.length >= shoKazu + 1 && new Set(gazoIds).size === gazoIds.length,
    `${gazoIds.length}枚（表紙1＋賞${shoKazu}）／ 使い回し=${new Set(gazoIds).size === gazoIds.length ? "なし" : "★あり"}`,
  );

  await ireru(mise, "ガチャの名前", GACHA_TITLE);
  await mise.locator('button:has-text("この案を下書きとして登録する")').first().click();
  const toroku = await machi(mise, "text=下書きに登録しました", 25000);
  T("S-18", "ガチャを下書きとして登録できた", toroku);

  const g0 = await one(
    `SELECT id, status, price, total, cover_image_id FROM gachas WHERE tenant_id = ? AND title = ?`,
    [tenantId, GACHA_TITLE],
  );
  gachaId = g0.id ? String(g0.id) : null;
  T(
    "S-19",
    "登録した直後は、まだ公開されていない（下書きのまま）",
    Boolean(gachaId) && String(g0.status) === "DRAFT",
    `番号=${String(gachaId)} ／ 状態=${String(g0.status)} ／ ${n(g0.price)}pt × ${n(g0.total)}口`,
  );
  if (!gachaId) throw new Error("ガチャが登録できませんでした");

  const zaiko = await all(
    `SELECT grade, name, value, total, image_id FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ? ORDER BY grade`,
    [tenantId, gachaId],
  );
  T(
    "S-20",
    "賞ごとに、写真が結び付いている",
    zaiko.filter((r) => r.image_id != null).length >= shoKazu,
    zaiko.map((r) => `${r.grade}:${r.name}×${n(r.total)}${r.image_id ? "（写真あり）" : "（写真なし）"}`).join(" / "),
  );

  /* ══════════════════════════════════════════
     ⑦ 検証して、公開する
     ══════════════════════════════════════════ */
  H("⑦ 検証して、公開する");

  await gamen("gachas");
  const ichiran = await machi(mise, `text=${GACHA_TITLE}`, 20000);
  T("S-21", "ガチャ管理の一覧に、いま作ったガチャが出ている", ichiran);

  const gyou = mise.locator(`tr:visible:has-text("${GACHA_TITLE}")`);
  const kaku = mise.locator('button:visible:has-text("中身と操作を開く")');
  if ((await gyou.count()) > 0) await gyou.first().click();
  else if ((await kaku.count()) > 0) await kaku.first().click();
  await mise.waitForTimeout(1200);

  /* ★検証していないのに公開できてしまわないこと。
       検証していないガチャを売り場に出せたら、
       還元率がいくつなのか誰も知らないまま売ることになります。 */
  const riyuu = mise.locator("textarea").first();
  if ((await riyuu.count()) > 0) await riyuu.fill("試験用：通し確認のため公開");
  await mise.waitForTimeout(300);
  await mise.locator('button:visible:has-text("公開する")').first().click().catch(() => {});
  await mise.waitForTimeout(2500);
  const kensho0 = await one(`SELECT status FROM gachas WHERE tenant_id = ? AND id = ?`, [
    tenantId,
    gachaId,
  ]);
  const kotowari = await moji(mise);
  T(
    "S-22",
    "検証していないガチャは、公開しようとしても断られる",
    String(kensho0.status) !== "PUBLISHED",
    `状態=${String(kensho0.status)} ／ ` +
      (kotowari.split("\n").filter((l) => /検証|公開できません/.test(l)).slice(0, 2).join(" / ") ||
        "（断りの理由が画面に出ていない）"),
  );

  await mise.locator('button:has-text("検証を実行する")').first().click().catch(() => {});
  await mise.waitForTimeout(5000);
  const kensho = await one(
    `SELECT backtest_verdict, backtest_spec FROM gachas WHERE tenant_id = ? AND id = ?`,
    [tenantId, gachaId],
  );
  T(
    "S-23",
    "検証を実行すると、結果が残る",
    kensho.backtest_verdict != null,
    `判定=${String(kensho.backtest_verdict)}`,
  );

  /* 理由が短いうちは押せないこと */
  const riyuu2 = mise.locator("textarea").first();
  if ((await riyuu2.count()) > 0) {
    await riyuu2.fill("短");
    await mise.waitForTimeout(400);
  }
  const oseruka = await mise
    .locator('button:visible:has-text("公開する")')
    .first()
    .isDisabled()
    .catch(() => null);
  T(
    "S-24",
    "公開の理由が短いうちは、公開のボタンを押せない",
    oseruka === true,
    oseruka === null ? "★ボタンが見つからない" : `押せる状態か=${oseruka ? "押せない（正しい）" : "★押せてしまう"}`,
  );

  if ((await riyuu2.count()) > 0) await riyuu2.fill("試験用：検証が済んだため公開します");
  await mise.waitForTimeout(400);
  await mise.locator('button:visible:has-text("公開する")').first().click().catch(() => {});
  await mise.waitForTimeout(3000);
  const koukai = await one(`SELECT status FROM gachas WHERE tenant_id = ? AND id = ?`, [
    tenantId,
    gachaId,
  ]);
  T(
    "S-25",
    "検証のあとは、お店が自分で公開できた",
    String(koukai.status) === "PUBLISHED",
    `状態=${String(koukai.status)}`,
  );

  await gamen("store-setup");
  await mise.waitForTimeout(1500);
  const ato = await moji(mise);
  const atoPct = /(\d+)\/(\d+)\s*完了/.exec(ato);
  T(
    "S-26",
    "ぜんぶそろって「販売開始できます」に変わった",
    /販売開始できます/.test(ato) && !/まだ販売開始できません/.test(ato),
    atoPct ? `公開準備 ${atoPct[1]}/${atoPct[2]} 完了` : ato.split("\n").filter(Boolean).slice(0, 4).join(" / "),
  );

  /* ══════════════════════════════════════════
     ①-2 「お客様側で確認」

     ★これが無いと、お店の方はご自分の売り場を見られません。
       管理画面から押しても、お客様用のログイン画面に飛ばされて、
       自分の店の棚を見るために自分の店の会員登録が要る、
       という状態になっていました。

     ★行き先は必ず「/」で始まる相対の住所にすること。
       いま開いている住所のまま移動するので、
       よそのお店のページが開くことがありません。
     ══════════════════════════════════════════ */
  H("①-2 管理画面から、お客様に見えているページを開けるか");

  const KITAI = [
    "お客様のトップ",
    "ガチャ一覧",
    "ガチャ詳細",
    "会社情報",
    "特定商取引法に基づく表記",
    "利用規約",
    "プライバシーポリシー",
    "よくあるご質問",
    "お問い合わせ",
  ];
  /* ★「ガチャ詳細」だけは、いま公開中のガチャを1本読んでから出ます。
       読み終わる前に数えると、まだ入口になっていません。 */
  await mise
    .locator('a[target="_blank"]:has-text("ガチャ詳細")')
    .first()
    .waitFor({ state: "attached", timeout: 20000 })
    .catch(() => {});
  const nakami = await mise
    .locator('a[target="_blank"]')
    .evaluateAll((els) =>
      els.map((e) => ({ text: e.textContent ?? "", href: e.getAttribute("href") ?? "" })),
    );
  const ari = KITAI.filter((k) => nakami.some((n) => n.text.includes(k)));
  T(
    "S-26a",
    "「お客様側で確認」に、お客様の9ページぶんの入口がそろっている",
    ari.length === KITAI.length,
    ari.length === KITAI.length
      ? `${ari.length}件`
      : `足りない： ${KITAI.filter((k) => !ari.includes(k)).join(" / ")}`,
  );

  /* ★よそのお店へ飛ばない、をここで機械的に止めます */
  const soto = nakami
    .filter((n) => KITAI.some((k) => n.text.includes(k)))
    .filter((n) => !n.href.startsWith("/"));
  T(
    "S-26b",
    "その入口が、ほかのお店（外の住所）を向いていない",
    soto.length === 0,
    soto.length === 0 ? "すべて相対の住所（＝いまのお店のまま）" : soto.map((n) => n.href).join(" / "),
  );

  /* 実際に押して、別のタブで開くところまで見ます */
  const [tabIchiran] = await Promise.all([
    miseCtx.waitForEvent("page", { timeout: 15000 }),
    mise.locator('a[target="_blank"]:has-text("ガチャ一覧")').first().click(),
  ]);
  watch(tabIchiran, "お客様（別タブ）");
  await tabIchiran.waitForLoadState("domcontentloaded");
  /* ★決まった秒数だけ待つのはやめること。
       売り場の中身は、あとから読み込まれて出てきます。
       秒数で待つと、その日の機械の速さで結果が変わります。
       「棚に自分の店のガチャが並んだこと」そのものを待ちます。 */
  await tabIchiran
    .locator(`text=${GACHA_TITLE}`)
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  const ichiranMoji = await moji(tabIchiran);
  T(
    "S-26c",
    "「ガチャ一覧」を押すと、別のタブでこのお店の売り場が開いた",
    new URL(tabIchiran.url()).pathname === "/shop" && ichiranMoji.includes(GACHA_TITLE),
    `${tabIchiran.url()} ／ ${ichiranMoji.includes(GACHA_TITLE) ? "自店のガチャあり" : "★自店のガチャが出ていない"}`,
  );
  T(
    "S-26d",
    "その売り場は、ログインしていなくても中身が見えている",
    !/\/login/.test(tabIchiran.url()) && ichiranMoji.includes(GACHA_TITLE),
    ichiranMoji.split("\n").filter(Boolean).slice(0, 4).join(" / "),
  );

  const [tabShousai] = await Promise.all([
    miseCtx.waitForEvent("page", { timeout: 15000 }),
    mise.locator('a[target="_blank"]:has-text("ガチャ詳細")').first().click(),
  ]);
  watch(tabShousai, "お客様（別タブ）");
  await tabShousai.waitForLoadState("domcontentloaded");
  /* ★理由は「ガチャ一覧」と同じです。
       ここは「ログインして引く」が出るまで待ちます。
       このボタンが出た時点で、中身の読み込みが終わっています。 */
  await tabShousai
    .locator('[data-testid="guest-login-to-draw"]')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  const shousaiMoji = await moji(tabShousai);
  T(
    "S-26e",
    "「ガチャ詳細」を押すと、そのガチャの中身が開いた",
    /^\/shop\//.test(new URL(tabShousai.url()).pathname) && shousaiMoji.includes(GACHA_TITLE),
    tabShousai.url(),
  );
  /* ★ここから引けてはいけません。引くとポイントが減ります。
       減らす相手（お客様）が決まっていないからです。 */
  const botanLogin = await tabShousai.locator('button:has-text("ログインして引く")').count();
  const botanHiku = await tabShousai.locator('button:has-text("1回引く")').count();
  T(
    "S-26f",
    "ログインしていない売り場からは引けない（「ログインして引く」だけ）",
    botanLogin > 0 && botanHiku === 0,
    `ログインして引く=${botanLogin}件 ／ 1回引く=${botanHiku}件`,
  );
  await tabIchiran.close();
  await tabShousai.close();

  /* ══════════════════════════════════════════
     ② 店舗情報／③ 法定表示（お客様の目で見る）
     ══════════════════════════════════════════ */
  H("②③ 店舗情報と法定表示が、お客様の画面に出る");

  /* お客様としてログイン */
  let inMypage = false;
  await kyaku.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 6 && !inMypage; i += 1) {
    await kyaku.locator('button[role="tab"]:has-text("お客様")').click().catch(() => {});
    const org = kyaku.locator('input[autocomplete="organization"]');
    if ((await org.count()) > 0) await org.fill(CODE).catch(() => {});
    await kyaku.locator('input[type="email"]').fill(CUST_EMAIL).catch(() => {});
    await kyaku.locator('input[type="password"]').fill(PASSWORD).catch(() => {});
    await kyaku.locator('button[type="submit"]').first().click().catch(() => {});
    inMypage = await kyaku.waitForURL("**/mypage**", { timeout: 6000 }).then(
      () => true,
      () => false,
    );
  }
  T("S-27", "お客様がログインできた", inMypage, kyaku.url());
  if (!inMypage) throw new Error("お客様がログインできませんでした");

  const kanban = await machi(kyaku, `[data-testid="chrome-logo"]:has-text("${SHOPNAME}")`, 10000);
  T("S-28", "お店が決めた店舗名が、お客様の画面の看板に出ている", kanban, SHOPNAME);

  await kyaku.goto(`${BASE}/store/company`, { waitUntil: "domcontentloaded" });
  await kyaku.waitForTimeout(1000);
  const company = await moji(kyaku);
  T(
    "S-29",
    "会社情報に、お店が入力したとおりの内容が出ている",
    company.includes("試験用ガチャ商店（架空・実在しません）") &&
      company.includes("試験 太郎（架空）") &&
      company.includes("東京都千代田区千代田1-1 試験用ビル101（架空）") &&
      company.includes("03-0000-0000"),
    company.split("\n").filter(Boolean).slice(0, 8).join(" / "),
  );
  T(
    "S-30",
    "会社情報に「未設定」が残っていない",
    !/未設定/.test(company) && !/表示できません/.test(company),
    company.split("\n").filter((l) => /未設定|表示できません/.test(l)).join(" / ") || "残っていない",
  );

  await kyaku.goto(`${BASE}/store/legal`, { waitUntil: "domcontentloaded" });
  await kyaku.waitForTimeout(800);
  const legal = await moji(kyaku);
  const legalHitsuyou = [
    "試験用：各ガチャの画面に表示している金額です。",
    "試験用：送料は当店が負担します。",
    "試験用：クレジットカード",
    "試験用：ご注文時に決済されます。",
    "試験用：発送のご依頼から5営業日以内に発送します。",
    "試験用：商品の性質上、お客様都合の返品はお受けできません。",
  ];
  const kaketeru = legalHitsuyou.filter((s) => !legal.includes(s));
  T(
    "S-31",
    "特定商取引法に基づく表記が、入力どおり全部出ている",
    kaketeru.length === 0,
    kaketeru.length === 0 ? `${legalHitsuyou.length}項目すべて一致` : `★出ていない：${kaketeru.join(" / ")}`,
  );

  await kyaku.goto(`${BASE}/store/terms`, { waitUntil: "domcontentloaded" });
  await kyaku.waitForTimeout(800);
  const terms = await moji(kyaku);
  await kyaku.goto(`${BASE}/store/privacy`, { waitUntil: "domcontentloaded" });
  await kyaku.waitForTimeout(800);
  const privacy = await moji(kyaku);
  T(
    "S-32",
    "利用規約とプライバシーポリシーが、書いた全文そのまま出ている",
    TERMS.split("\n").every((l) => terms.includes(l)) &&
      PRIVACY.split("\n").every((l) => privacy.includes(l)),
    `規約=${terms.length}文字 ／ プライバシー=${privacy.length}文字`,
  );

  /* ★こちらが用意した文例が混ざっていないこと。
       混ざると、お店の法的表示として、こちらの作った文が世に出ます。 */
  const konzatsu = [terms, privacy, legal, company].some((t) =>
    /当社は、お客様の個人情報を|本規約は、当社が提供する/.test(t),
  );
  T(
    "S-33",
    "こちらが用意した文例が、お店の法定表示に混ざっていない",
    !konzatsu,
    konzatsu ? "★混ざっている" : "お店が書いた文だけ",
  );

  const hamiLegal = await hamidashi(kyaku);
  hamiT("S-34", `法定表示のページが横にはみ出していない（${KYAKU.label}）`, hamiLegal);

  /* ══════════════════════════════════════════
     ⑧ お客様がポイントを買う
     ══════════════════════════════════════════ */
  H("⑧ お客様がポイントを買う");

  await kyaku.goto(`${BASE}/mypage/shop`, { waitUntil: "domcontentloaded" });
  const uriba = await machi(kyaku, `[data-testid="tile-open-${gachaId}"]`, 20000);
  T("S-35", "お店が公開したガチャが、お客様の売り場に出ている", uriba, GACHA_TITLE);

  const uribaText = await moji(kyaku);
  T(
    "S-36",
    "売り場に、お店が付けた名前がそのまま出ている",
    uribaText.includes(GACHA_TITLE),
    uribaText.split("\n").filter(Boolean).slice(0, 4).join(" / "),
  );

  const s0 = await snap(tenantId, customerId, gachaId);
  await kyaku.goto(`${BASE}/mypage/points/buy?from=${encodeURIComponent(`/mypage/shop/${gachaId}`)}`, {
    waitUntil: "domcontentloaded",
  });
  const kaeru = await machi(kyaku, '[data-testid="buy-product"]', 20000);
  T(
    "S-37",
    "お店が作ったポイント商品が、お客様の購入画面に出ている",
    kaeru && (await moji(kyaku)).includes("試験用 1,000円ぶん"),
  );

  await kyaku.locator('[data-testid="buy-product"]').first().click();
  await machi(kyaku, '[data-testid="buy-pay"]', 15000);
  await kyaku.locator('[data-testid="buy-pay"]').click();
  const kaeta = await machiAru(kyaku, '[data-testid="buy-done"]', 30000);
  const s1 = await snap(tenantId, customerId, gachaId);
  T(
    "S-38",
    "お客様がポイントを買えて、残高が増えた",
    kaeta && s1.points === s0.points + 1000,
    `残高 ${s0.points}pt → ${s1.points}pt`,
  );

  if (await machi(kyaku, '[data-testid="buy-return"]', 10000)) {
    await kyaku.locator('[data-testid="buy-return"]').click();
    await kyaku.waitForURL(`**/mypage/shop/${gachaId}`, { timeout: 15000 }).catch(() => {});
  }

  /* ══════════════════════════════════════════
     ⑨ お客様が引く（手元に商品が1点残るまで）
     ══════════════════════════════════════════ */
  H("⑨ お客様が引く");

  const tobasu = kyaku.locator('button:has-text("演出をとばす")');
  let ima = await snap(tenantId, customerId, gachaId);
  let hiita = 0;
  let kaimashi = 0;

  while (ima.prizes < 1 && hiita < 25) {
    if (ima.points < NEDAN) {
      const kauBtn = kyaku.locator('button:has-text("ポイントを購入して、もう一度引く")');
      if ((await kauBtn.count()) > 0) await kauBtn.first().click().catch(() => {});
      else
        await kyaku.goto(
          `${BASE}/mypage/points/buy?from=${encodeURIComponent(`/mypage/shop/${gachaId}`)}`,
          { waitUntil: "domcontentloaded" },
        );
      if (!(await machi(kyaku, '[data-testid="buy-product"]', 20000))) break;
      await kyaku.locator('[data-testid="buy-product"]').first().click();
      if (!(await machi(kyaku, '[data-testid="buy-pay"]', 10000))) break;
      await kyaku.locator('[data-testid="buy-pay"]').click();
      if (!(await machiAru(kyaku, '[data-testid="buy-done"]', 30000))) break;
      kaimashi += 1;
      if (await machi(kyaku, '[data-testid="buy-return"]', 10000)) {
        await kyaku.locator('[data-testid="buy-return"]').click();
        await kyaku.waitForURL(`**/mypage/shop/${gachaId}`, { timeout: 15000 }).catch(() => {});
      }
    }

    const mou = kyaku.locator('button:has-text("もう一度引く")');
    const oseru =
      (await mou.count()) > 0 && (await mou.first().isDisabled().catch(() => true)) === false;
    if (oseru) {
      await mou.first().click().catch(() => {});
    } else {
      await kyaku.goto(`${BASE}/mypage/shop/${gachaId}`, { waitUntil: "domcontentloaded" });
      if (!(await machi(kyaku, '[data-testid="draw-open"]', 20000))) break;
      await kyaku.locator('[data-testid="draw-open"]').click();
    }
    if (!(await machi(kyaku, '[data-testid="draw-go"]', 12000))) break;
    await kyaku.locator('[data-testid="draw-go"]').click();

    for (let i = 0; i < 20; i += 1) {
      if ((await tobasu.count()) > 0) {
        await tobasu.first().click().catch(() => {});
        break;
      }
      await kyaku.waitForTimeout(300);
    }
    if (!(await machi(kyaku, 'button:has-text("獲得商品を見る")', 30000))) break;

    hiita += 1;
    ima = await snap(tenantId, customerId, gachaId);
  }

  T(
    "S-39",
    "お客様が、公開されたガチャを実際に引けた",
    ima.draws > 0,
    `引いた=${ima.draws}回 ／ 買い足し=${kaimashi}回 ／ 残高=${ima.points}pt`,
  );
  T(
    "S-40",
    "発送までためせるだけ、手元に商品が残った",
    ima.prizes >= 1,
    `手元の商品=${ima.prizes}点`,
  );
  if (ima.prizes < 1) throw new Error("手元に商品が残らなかったので、発送までためせません");

  /* お店が登録した景品名で当たっているか */
  const dList = await all(
    `SELECT prize_rank, prize_name FROM draws WHERE tenant_id = ? AND user_id = ?`,
    [tenantId, customerId],
  );
  const zaikoMap = new Map(zaiko.map((r) => [String(r.grade), String(r.name)]));
  const chigau = dList.filter((d) => zaikoMap.get(String(d.prize_rank)) !== String(d.prize_name));
  T(
    "S-41",
    "当たった景品の名前が、お店が登録したとおりになっている",
    chigau.length === 0,
    chigau.length === 0
      ? dList.map((d) => `${d.prize_rank}:${d.prize_name}`).join(" / ")
      : `★違うもの：${chigau.map((d) => `${d.prize_rank}:${d.prize_name}`).join(" / ")}`,
  );

  /* ══════════════════════════════════════════
     ⑩ お店が売上を確認する
     ══════════════════════════════════════════ */
  H("⑩ 売上を確認する");

  const uriage = await one(
    `SELECT revenue, paid_value, left_count FROM gachas WHERE tenant_id = ? AND id = ?`,
    [tenantId, gachaId],
  );
  T(
    "S-42",
    "引かれたぶんだけ、売上と残り口数が動いている",
    n(uriage.revenue) === ima.draws * NEDAN && n(uriage.left_count) === KUCHI - ima.draws,
    `売上=${n(uriage.revenue)}pt（${ima.draws}回×${NEDAN}pt）／ 残り=${n(uriage.left_count)}口（${KUCHI}−${ima.draws}）`,
  );

  await gamen("gachas");
  const gText = await moji(mise);
  T(
    "S-43",
    "ガチャ管理の一覧で、お店が売上を見られる",
    gText.includes(GACHA_TITLE) && /売上/.test(gText),
    gText.split("\n").filter((l) => l.includes(GACHA_TITLE)).slice(0, 1).join(" / "),
  );

  await gamen("rtp");
  await mise.waitForTimeout(1500);
  const rText = await moji(mise);
  T(
    "S-44",
    "実績還元率の画面が開き、いまの状態が文字で分かる",
    /実績還元率/.test(rText) && rText.length > 200,
    rText.split("\n").filter(Boolean).slice(0, 4).join(" / "),
  );
  const rMichi = await michi(mise, "実績還元率");
  T("S-45", "実績還元率の画面から、次に行ける場所がある", rMichi.length > 0, rMichi.slice(0, 5).join(" / "));

  /* ══════════════════════════════════════════
     ⑪ お店が当選を確認する
     ══════════════════════════════════════════ */
  H("⑪ 当選を確認する");

  await gamen("customers");
  const cOpen = await machi(mise, "text=試験 花子（架空）", 20000);
  T("S-46", "会員管理に、そのお客様が出ている", cOpen);

  const cGyou = mise.locator('tr:visible:has-text("試験 花子（架空）")');
  if ((await cGyou.count()) > 0) await cGyou.first().click().catch(() => {});
  else await mise.locator('button:visible:has-text("試験 花子（架空）")').first().click().catch(() => {});
  await mise.waitForTimeout(2000);

  const cText = await moji(mise);
  const kachi = await all(
    `SELECT name, grade, status FROM prizes WHERE tenant_id = ? AND user_id = ? ORDER BY rowid`,
    [tenantId, customerId],
  );
  T(
    "S-47",
    "お店の画面で、そのお客様が何を引いて何を当てたかが分かる",
    /引いた記録/.test(cText) && /獲得した景品/.test(cText),
    `引いた記録=${/引いた記録/.test(cText) ? "あり" : "★なし"} ／ 獲得した景品=${/獲得した景品/.test(cText) ? "あり" : "★なし"}`,
  );
  T(
    "S-48",
    "当たった商品の名前が、お店の画面にも出ている",
    kachi.every((p) => cText.includes(String(p.name))),
    kachi.map((p) => `${p.grade}:${p.name}(${p.status})`).join(" / "),
  );

  /* ══════════════════════════════════════════
     お客様が発送を依頼する（⑫の材料）
     ══════════════════════════════════════════ */
  H("お客様が発送を依頼する");

  await kyaku.goto(`${BASE}/mypage/address`, { waitUntil: "domcontentloaded" });
  const addrOpen = await machi(kyaku, 'button:has-text("お届け先を変更する")', 20000);
  T("S-49", "お届け先の画面が開いた", addrOpen);
  if (addrOpen) await kyaku.locator('button:has-text("お届け先を変更する")').click();

  await kyaku.locator('label:has-text("お名前") input').first().fill("試験 花子");
  await kyaku.locator('label:has-text("郵便番号") input').first().fill("100-0002");
  await kyaku
    .locator('label:has-text("ご住所") input')
    .first()
    .fill("東京都千代田区皇居外苑1-1 試験用ハイツ202");
  await kyaku.locator('label:has-text("お電話番号") input').first().fill("0300000001");
  await kyaku.locator('button:has-text("この内容で保存する")').click();
  await kyaku.waitForTimeout(1500);
  if ((await kyaku.locator("text=ご本人の確認をお願いいたします").count()) > 0) {
    await kyaku.locator('input[type="password"]').last().fill(PASSWORD);
    await kyaku.locator('button:has-text("確認する")').first().click();
  }
  const addrOk = await machi(kyaku, "text=お届け先を変更いたしました", 20000);
  T("S-50", "お届け先を保存できた", addrOk);

  const okuru = String(kachi[0].name);
  await kyaku.goto(`${BASE}/mypage/prizes`, { waitUntil: "domcontentloaded" });
  await machi(kyaku, `button:not([disabled]):has-text("${okuru}")`, 20000);
  await kyaku.locator(`button:not([disabled]):has-text("${okuru}")`).first().click();
  await machi(kyaku, 'button:has-text("発送を依頼する")', 10000);
  await kyaku.locator('button:has-text("発送を依頼する")').first().click();
  await machi(kyaku, 'button:has-text("はい、発送を依頼します")', 10000);
  await kyaku.locator('button:has-text("はい、発送を依頼します")').click();
  await kyaku.waitForTimeout(1500);
  if ((await kyaku.locator("text=ご本人の確認をお願いいたします").count()) > 0) {
    await kyaku.locator('input[type="password"]').last().fill(PASSWORD);
    await kyaku.locator('button:has-text("確認する")').first().click();
  }
  const hOk = await machi(kyaku, "text=発送を承りました", 25000);
  const chumon = await one(
    `SELECT id FROM orders WHERE tenant_id = ? AND user_id = ? ORDER BY rowid DESC LIMIT 1`,
    [tenantId, customerId],
  );
  orderId = chumon.id ? String(chumon.id) : null;
  T("S-51", "お客様が発送を依頼でき、注文が1件できた", hOk && Boolean(orderId), `注文=${String(orderId)}`);
  if (!orderId) throw new Error("注文ができませんでした");

  /* ══════════════════════════════════════════
     ⑫ お店が注文を確認する
     ══════════════════════════════════════════ */
  H("⑫ 注文を確認する");

  await gamen("orders");
  const oOpen = await machi(mise, "text=試験 花子", 20000);
  T("S-52", "発送依頼（注文）の画面に、いまの依頼が出ている", oOpen, mise.url());

  const oGyou = mise.locator('tr:visible:has-text("試験 花子")');
  if ((await oGyou.count()) > 0) await oGyou.first().click().catch(() => {});
  /* ★決まった秒数で待たないこと。中身が出たことそのものを待ちます。
       秒数待ちにすると、その日の機械の速さで結果が変わり、
       直っているのに落ちる／壊れているのに通る、が起きます。 */
  await mise
    .locator("text=東京都千代田区皇居外苑1-1 試験用ハイツ202")
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  const oText = await moji(mise);
  T(
    "S-53",
    "注文の中に、届け先と品物がそろって出ている",
    oText.includes("東京都千代田区皇居外苑1-1 試験用ハイツ202") && oText.includes(okuru),
    oText.split("\n").filter(Boolean).slice(0, 6).join(" / "),
  );
  T(
    "S-54",
    "注文から、そのまま発送を作りに行ける",
    (await mise.locator('button:has-text("発送を作る")').count()) > 0,
  );

  /* ══════════════════════════════════════════
     ⑬ お店が発送する
     ══════════════════════════════════════════ */
  H("⑬ 発送する");

  await mise.goto(`${BASE}/client-demo/shipping?order=${orderId}`, {
    waitUntil: "domcontentloaded",
  });

  const item = await one(
    `SELECT id FROM order_items WHERE tenant_id = ? AND order_id = ? ORDER BY rowid LIMIT 1`,
    [tenantId, orderId],
  );
  const itemId = item.id ? String(item.id) : null;
  const check = itemId ? mise.locator(`#pick-${itemId}`) : null;
  /* ★品物の一覧はあとから読み込まれます。
       秒数で待たず、「その品物の行が出たこと」を待ちます。 */
  if (check !== null) {
    await check.first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
  }
  const checkAri = check !== null && (await check.count()) > 0;
  T("S-55", "発送を作る画面が、その注文の品物を並べて開いた", checkAri, `品物=${String(itemId)}`);
  if (!checkAri) throw new Error("発送を作る画面が開きませんでした");

  await check.check().catch(() => {});
  await mise.waitForTimeout(400);
  await mise.locator('button:has-text("この1点で発送を作る")').first().click().catch(() => {});
  await mise.waitForTimeout(2500);

  const sh0 = await one(
    `SELECT id, shipment_status AS status, carrier, tracking_number AS tracking_no
       FROM shipments WHERE tenant_id = ? ORDER BY rowid DESC LIMIT 1`,
    [tenantId],
  );
  T(
    "S-56",
    "発送を1件作れた",
    Boolean(sh0.id),
    `発送=${String(sh0.id)} ／ 状態=${String(sh0.status)}`,
  );

  await press(mise, 'button:has-text("準備をはじめる")', 'button:has-text("箱づめ完了（発送待ちへ）")');
  await mise.waitForTimeout(1200);
  await press(mise, 'button:has-text("箱づめ完了（発送待ちへ）")', 'button:has-text("発送を確定する（出荷）")');
  await mise.waitForTimeout(1200);
  const sh1 = await one(`SELECT shipment_status AS status FROM shipments WHERE tenant_id = ? AND id = ?`, [
    tenantId,
    sh0.id,
  ]);
  T(
    "S-57",
    "準備中→箱づめ完了と、順に進められた",
    String(sh1.status) === "READY",
    `状態=${String(sh1.status)}`,
  );

  /* ★追跡番号が無いまま出荷できないこと。
       出荷したのに追えない荷物は、お客様には「消えた」のと同じです。 */
  const shukkaMae = await mise
    .locator('button:visible:has-text("発送を確定する（出荷）")')
    .first()
    .isDisabled()
    .catch(() => null);
  T(
    "S-58",
    "追跡番号を入れないうちは、出荷を確定できない",
    shukkaMae === true,
    shukkaMae === null ? "★ボタンが見つからない" : shukkaMae ? "押せない（正しい）" : "★押せてしまう",
  );

  const carrier = mise.locator('label:has-text("配送会社") select').first();
  if ((await carrier.count()) > 0) await carrier.selectOption({ label: "ヤマト運輸" }).catch(() => {});
  await ireru(mise, "追跡番号", "0000-0000-0000");
  await mise.locator('button:has-text("追跡番号を登録する")').first().click().catch(() => {});
  await mise.waitForTimeout(2000);
  const sh2 = await one(
    `SELECT shipment_status AS status, carrier, tracking_number AS tracking_no
       FROM shipments WHERE tenant_id = ? AND id = ?`,
    [tenantId, sh0.id],
  );
  T(
    "S-59",
    "配送会社と追跡番号を登録できた",
    String(sh2.carrier ?? "") !== "" && String(sh2.tracking_no ?? "") !== "",
    `${String(sh2.carrier)} ／ ${String(sh2.tracking_no)}`,
  );

  await mise.locator('button:visible:has-text("発送を確定する（出荷）")').first().click().catch(() => {});
  await mise.waitForTimeout(2500);
  const sh3 = await one(`SELECT shipment_status AS status, shipped_at FROM shipments WHERE tenant_id = ? AND id = ?`, [
    tenantId,
    sh0.id,
  ]);
  T(
    "S-60",
    "お店が出荷を確定できた",
    String(sh3.status) === "SHIPPED",
    `状態=${String(sh3.status)} ／ 出荷日時=${String(sh3.shipped_at ?? "なし")}`,
  );

  /* ★prizes.status の文字を、そのまま合否にしないこと。
       あの列は「お客様が何を頼んだか」を持つだけで、
       いま荷物がどこまで進んだかは発送のほうが正本です。
       （SHIP_REQUESTED のまま止まっているのは正しい作りです）
       見るべきは、お客様の獲得商品の画面に何と書いてあるか、です。 */
  await kyaku.goto(`${BASE}/mypage/prizes`, { waitUntil: "domcontentloaded" });
  await kyaku.waitForTimeout(1800);
  const kPrize = await moji(kyaku);
  const susunda = /発送中|発送済み|お届け/.test(kPrize);
  T(
    "S-61",
    "お客様の獲得商品にも、荷物が進んだことが文字で出ている",
    susunda,
    susunda
      ? (kPrize.match(/発送中|発送済み|お届けが完了しました。|発送しました。[^\n]*/g) ?? []).slice(0, 3).join(" ／ ")
      : "★「発送依頼済み」のまま止まっている",
  );

  await kyaku.goto(`${BASE}/mypage/shipping`, { waitUntil: "domcontentloaded" });
  await kyaku.waitForTimeout(1500);
  const kShip = await moji(kyaku);
  T(
    "S-62",
    "お客様の画面に、発送済みと追跡番号が出ている",
    /発送/.test(kShip) && kShip.includes("0000-0000-0000"),
    kShip.split("\n").filter(Boolean).slice(0, 6).join(" / "),
  );

  const hamiShip = await hamidashi(kyaku);
  hamiT("S-63", `お客様の発送状況が横にはみ出していない（${KYAKU.label}）`, hamiShip);

  /* ══════════════════════════════════════════
     まとめて確認：お店の画面に、行き止まりが無いか
     ══════════════════════════════════════════ */
  H("通し確認：お店の画面に行き止まりが無いか");

  const MISE_GAMEN = [
    ["store-setup", "開店準備"],
    ["point-sale", "ポイント販売"],
    ["ai-builder", "AIガチャ作成"],
    ["gachas", "ガチャ管理"],
    ["rtp", "実績還元率"],
    ["customers", "会員管理"],
    ["orders", "発送依頼"],
    ["shipping", "発送管理"],
    ["settings", "設定"],
  ];
  const hamiNG = [];
  for (const [slug, label] of MISE_GAMEN) {
    await gamen(slug);
    await michi(mise, label);
    const h = await hamidashi(mise);
    if (h.yoko) hamiNG.push(`${label}：${h.scroll}px＞${h.w}px`);
  }
  T("S-64", "お店の9画面すべてに、押せるものがある", MAYOI.length === 0, MAYOI.map((m) => m.gamen).join(" / "));
  T("S-65", `お店の9画面すべてが横にはみ出していない（${MISE.label}）`, hamiNG.length === 0, hamiNG.join(" / "));
} catch (e) {
  T("S-XX", "途中で止まった", false, String(e).slice(0, 400));
} finally {
  H("画面が出したエラー");

  let nokoriStepUp = STEPUP_403.length;
  let nokoriWazato = WAZATO_409.length;
  const cons = CONSOLE_LOG.filter((c) => {
    if (yoso(c.text)) return false;
    if (nokoriStepUp > 0 && /403 \(Forbidden\)/.test(c.text)) {
      nokoriStepUp -= 1;
      return false;
    }
    /* わざと断ったぶんは、ブラウザの記録の側でも差し引きます */
    if (nokoriWazato > 0 && /409 \(Conflict\)/.test(c.text)) {
      nokoriWazato -= 1;
      return false;
    }
    return true;
  });
  const perr = PAGE_ERR.filter((c) => !yoso(c.text) && !sakiyomi(c.text));
  const http = BAD_HTTP.filter((c) => !yoso(c.url));

  T("E-01", "Console のエラー・警告", cons.length === 0, cons.slice(0, 6).map((c) => `[${c.who}/${c.type}] ${c.text}`).join(" ／ "));
  T(
    "E-01b",
    "本人確認をお願いした回数（設計どおりの 403）",
    true,
    STEPUP_403.length === 0
      ? "0回"
      : `${STEPUP_403.length}回：` + STEPUP_403.map((c) => `${c.method} ${c.url.replace(BASE, "")}`).join(" ／ "),
  );
  T(
    "E-01c",
    "わざと断った回数（設計どおりの 409）",
    true,
    WAZATO_409.length === 0
      ? "0回"
      : `${WAZATO_409.length}回：` + WAZATO_409.map((c) => `${c.method} ${c.url.replace(BASE, "")}`).join(" ／ "),
  );
  T("E-02", "読み込み失敗（timeout・接続断）", perr.length === 0, perr.slice(0, 6).map((c) => `[${c.who}] ${c.text}`).join(" ／ "));
  T("E-03", "4xx / 5xx の通信", http.length === 0, http.slice(0, 8).map((c) => `${c.status} ${c.method} ${c.url}`).join(" ／ "));
  T("E-04", "次に何を押せばよいか分からない画面", MAYOI.length === 0, MAYOI.map((m) => `${m.gamen}：${m.reason}`).join(" ／ "));

  const out = {
    at: new Date().toISOString(),
    base: BASE,
    mise: MISE,
    kyaku: KYAKU,
    tenantCode: CODE,
    tenantId,
    gachaId,
    orderId,
    adminEmail: ADMIN_EMAIL,
    customerEmail: CUST_EMAIL,
    ok,
    ng,
    results: LOG,
    console: cons,
    pageErrors: perr,
    badHttp: http,
    stepUp403: STEPUP_403,
    wazato409: WAZATO_409,
    mayoi: MAYOI,
  };
  const file = `${ROOT}/docs/e2e-store-${STAMP}.json`;
  writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  ok ${ok} ／ NG ${ng}`);
  console.log(`  控え： ${file}`);
  console.log(`${"═".repeat(64)}\n`);

  await browser.close().catch(() => {});
  process.exit(ng === 0 ? 0 : 1);
}
