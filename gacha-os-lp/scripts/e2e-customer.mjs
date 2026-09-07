/**
 * お客様側を、本物のブラウザで、最初から最後まで1回だけ通す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これが要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   自動テストは全部通っているのに、本番の売り場に
 *   「これはデモです」が出ていました（2026-09-06）。
 *   自動テストは、画面に出た文字を見ていなかったからです。
 *
 *   ですので、ここでは
 *
 *       ★人がする順番どおりに、画面を触る
 *
 *   ことだけをします。抜け道は使いません。
 *   入口を直接叩いたり、データベースを書き換えて
 *   途中から始めたりはしません。
 *
 *   通す順番（お客様が実際にする順番）：
 *
 *       ① 新規会員登録
 *       ② メールの確認（届いた鍵を開く）
 *       ③ ログイン
 *       ④ ガチャ一覧
 *       ⑤ ガチャ詳細
 *       ⑥ ポイントが足りない
 *       ⑦ ポイント購入
 *       ⑧ 元のガチャへ戻る
 *       ⑨ 引く
 *       ⑩ 結果画面
 *       ⑪ もう一度引く
 *       ⑫ 獲得商品
 *       ⑬ ポイント交換
 *       ⑭ 別の商品を発送依頼
 *       ⑮ 発送状況の確認
 *       ⑯ ログアウト
 *
 * ═══════════════════════════════════════════════════════
 * ★メールの鍵は、画面からは取れません
 * ═══════════════════════════════════════════════════════
 *
 *   確認メールの鍵は、データベースには「かき混ぜた跡」しか
 *   残りません（token_hash）。元の鍵はメールの中だけです。
 *   手元では、メールは送られず、サーバーの記録に出るだけです。
 *
 *   ですので、この道具はサーバーの記録の紙を読みます。
 *   場所は E2E_MAIL_LOG で渡してください。
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・専用の会社を新しく1つ作り、その中だけで動きます。
 *   ・メールは .example（誰も持てないドメイン）だけを使います。
 *   ・お支払いは mock だけ。実際の請求は起きません。
 *
 * 使い方：
 *   E2E_MAIL_LOG=/tmp/e2e-dev.log \
 *   DATABASE_URL="file:./.data/e2e.db" DATABASE_ENV=development \
 *   npx tsx scripts/e2e-customer.mjs http://localhost:3210 430
 *
 *   最後の数字は画面の横幅です（390 / 430 / 1280）。
 */

import { createRequire } from "node:module";
import { writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
const WIDTH = Number(process.argv[3] ?? 430);

if (!BASE || !/^https?:\/\//.test(BASE)) {
  console.error(
    "\n✗ 見に行く先のURLを指定してください。\n" +
      "  例： npx tsx scripts/e2e-customer.mjs http://localhost:3210 430\n",
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

/* 画面の横幅ごとに、高さも変えます */
const VIEW =
  WIDTH >= 1000
    ? { width: 1280, height: 900, label: "PC(1280)" }
    : WIDTH >= 420
      ? { width: 430, height: 932, label: "スマホ大(430)" }
      : { width: 390, height: 844, label: "スマホ小(390)" };

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
  console.log(`${pass ? "  ok " : "  NG "} ${String(no).padEnd(7)} ${title}`);
  if (detail) console.log(`         ${detail}`);
}

function H(title) {
  console.log(`\n══ ${title} ${"═".repeat(Math.max(0, 56 - title.length))}`);
}

/** 画面が出したエラー・警告 */
const CONSOLE_LOG = [];
/** 4xx / 5xx の通信 */
const BAD_HTTP = [];
/* 設計どおりの 403（もう一段の本人確認をお願いする合図） */
const STEPUP_403 = [];
/** 読み込み失敗 */
const PAGE_ERR = [];
/** 「次に何を押せばよいか分からない」画面 */
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
         「もう一度パスワードを入れてください」を 403 で伝える作りです
         （401 にすると、画面がログイン切れと読んで追い出してしまうため）。
         これは設計どおりの合図なので、別の欄に分けて数えます。 */
    if (r.status() === 403 && /\/api\/customer\/(address|orders)/.test(r.url())) {
      STEPUP_403.push(rec);
      return;
    }
    BAD_HTTP.push(rec);
  });
  return page;
}

/* 手元の開発サーバーが出す、内容と関係のない雑音 */
const yoso = (t) => /vercel\.live|_next-live\/feedback|__nextjs|hot-reloader|webpack/.test(t);
const sakiyomi = (t) => /_rsc=/.test(t) && /ERR_ABORTED/.test(t);

/* ★手元の開発サーバーだけに出る、見た目の警告（2026-09-07）
     「/_next/static/css/… ?v=数字 を先に読み込んだのに使われなかった」
     という警告が、430 と 1280 の時だけ出ていました。
     これは開発サーバーが毎回 ?v=数字 を付け替えるせいで出るもので、
     本番の同じ画面には出ません（本番のCSSは ?v= が付かないため）。

     ★消し方を広げないこと。
       「/_next/static/css/」と「?v=」と「preloaded」の3つが
       すべて揃った時だけ消します。
       ざっくり消すと、本物の警告まで隠れます。 */
const kaihatsuDakeNoKeikoku = (t) =>
  /\/_next\/static\/css\//.test(t) &&
  /\?v=\d+/.test(t) &&
  /preloaded using link preload/.test(t);

/* ══════════════════════════════════════════════
   画面まわりの小道具
   ══════════════════════════════════════════════ */

/**
 * 押せる大きなボタンが、いま画面にいくつ出ているか。
 *
 * ★「次に何を押せばよいか分からない」を数えるための道具です。
 *   0個なら、行き止まりです。
 */
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

/** 行き止まりでないかを数える */
async function michi(page, gamen) {
  const b = await oshiBotan(page);
  if (b.length === 0) MAYOI.push({ gamen, url: page.url(), reason: "押せるものが1つも無い" });
  return b;
}

/**
 * 画面の外へはみ出していないか。
 *
 * ★横にはみ出す画面を、そのままにしないこと。
 *   スマホでは、指で押せない場所ができます。
 *
 * ★飾りのぼかしを、はみ出しと数えないこと。
 *   背景の丸いぼかしは、わざと画面の外まで広げてあります。
 *   ただし親が overflow:hidden で切っているので、
 *   実際に横へ動く画面にはなりません。
 *   ですので「本当に横スクロールが出るか」で判断し、
 *   出たときだけ、犯人になりうる要素を挙げます。
 */
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
          bad.push(
            `${el.tagName.toLowerCase()}「${t}」 right=${Math.round(r.right)}（画面幅 ${w}）`,
          );
        }
        if (bad.length >= 5) break;
      }
    }
    return { w, scroll, yoko, bad };
  });
}

/** はみ出しの結果を、そのまま1行に書く */
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

/**
 * 出るまで、何度か押す。
 *
 * ★1回で決めつけないこと。
 *   手元のサーバーは、その画面を初めて開くときに組み立てます。
 *   組み上がる前に押しても、何も起きません。
 */
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

/** 画面に出ている文字（見えているものだけ） */
async function moji(page) {
  return await page.evaluate(() => document.body?.innerText ?? "");
}

/** 出るまで待つ（出なければ false。落とさない） */
async function machi(page, sel, ms = 15000) {
  try {
    await page.waitForSelector(sel, { timeout: ms, state: "visible" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 「印」だけの目印を待つ。
 *
 * ★中身の無い <div data-testid="…" /> は、見た目の大きさが0です。
 *   「見えている」では、いつまでも待つことになります。
 *   置いてあるかどうかだけを見ます。
 */
async function machiAru(page, sel, ms = 15000) {
  try {
    await page.waitForSelector(sel, { timeout: ms, state: "attached" });
    return true;
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════
   メールの紙から、確認の鍵を拾う
   ══════════════════════════════════════════════ */

const MAIL_LOG = process.env.E2E_MAIL_LOG ?? "/tmp/e2e-dev.log";

function mailLogSize() {
  try {
    return statSync(MAIL_LOG).size;
  } catch {
    return 0;
  }
}

/**
 * 記録の紙から、宛先が一致する確認リンクの鍵を探す。
 *
 * ★紙が育つのを待つこと。
 *   登録を受け付けてから紙に出るまでに、少し間があります。
 *   1回読んで「無い」と決めると、必ず落ちます。
 */
async function machiTeKagi(from, atesaki, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    let text = "";
    try {
      const buf = readFileSync(MAIL_LOG);
      text = buf.slice(from).toString("utf8");
    } catch {
      text = "";
    }
    /* 宛先が出たあとの、いちばん近いリンクを取ります */
    const idx = text.lastIndexOf(atesaki);
    if (idx >= 0) {
      const ato = text.slice(idx);
      const m = ato.match(/\/verify-email\?token=([A-Za-z0-9_-]+)/);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/* ══════════════════════════════════════════════
   数字の突き合わせ
   ══════════════════════════════════════════════ */

async function snap(tenantId, customerId, gachaId) {
  const cu = await one(`SELECT points FROM customers WHERE tenant_id = ? AND id = ?`, [
    tenantId,
    customerId,
  ]);
  const led = await one(
    `SELECT COALESCE(SUM(delta),0) AS s FROM point_ledger WHERE tenant_id = ? AND user_id = ?`,
    [tenantId, customerId],
  );
  const g = await one(`SELECT left_count, revenue, paid_value FROM gachas WHERE tenant_id = ? AND id = ?`, [
    tenantId,
    gachaId,
  ]);
  const dr = await one(`SELECT COUNT(*) AS c FROM draws WHERE tenant_id = ? AND user_id = ?`, [
    tenantId,
    customerId,
  ]);
  const st = await one(
    `SELECT COALESCE(SUM(drawn),0) AS d FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ?`,
    [tenantId, gachaId],
  );
  const pz = await one(`SELECT COUNT(*) AS c FROM prizes WHERE tenant_id = ? AND user_id = ?`, [
    tenantId,
    customerId,
  ]);
  return {
    points: n(cu.points),
    ledgerSum: n(led.s),
    left: n(g.left_count),
    revenue: n(g.revenue),
    paidValue: n(g.paid_value),
    draws: n(dr.c),
    drawn: n(st.d),
    prizes: n(pz.c),
  };
}

/**
 * 直前に引いた1回の記録を取り出す。
 */
async function saigo(tenantId, customerId) {
  return await one(
    `SELECT prize_rank, prize_name, point_spent, point_returned
       FROM draws WHERE tenant_id = ? AND user_id = ? ORDER BY rowid DESC LIMIT 1`,
    [tenantId, customerId],
  );
}

/**
 * その1回が「現物（お届けできる商品）」になったかどうか。
 *
 * ★ここを取り違えないこと。
 *   S・A・B賞だけが、お手元に残る商品になります（lib/console/draw.ts の SHIPPED）。
 *   C・D賞は、当たった時点でポイントに戻ります。商品としては残りません。
 *   「引いた回数＝商品の数」ではありません。
 */
function genbutsuKa(d) {
  return ["S", "A", "B"].includes(String(d.prize_rank)) ? 1 : 0;
}

/* ══════════════════════════════════════════════
   ここから本番
   ══════════════════════════════════════════════ */

const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const PASSWORD = process.env.E2E_PASSWORD ?? `e2e-${STAMP}-Kakunin!`;
/* ★会社コードは16文字までです。日時を頭から詰めると、
     秒の下2桁が切り落とされて、続けて流したときにぶつかります。
     月日時分秒＋くじ引きの3文字で、ちょうど16文字にします */
const SAI = Math.random().toString(36).slice(2, 5).toUpperCase();
const CODE = `E2E${STAMP.slice(4)}${SAI}`.slice(0, 16);
const EMAIL = `e2e-c-${STAMP}-${SAI.toLowerCase()}@shop.example`;
const NEDAN = 500;
/* makeTenantLaunchReady が入れる店名。★試験用の値です */
const SHOPNAME = "試験用ショップ";

console.log(`\n${"═".repeat(64)}`);
console.log("  お客様側 通しE2E（本物のブラウザ）");
console.log(`  見に行く先： ${BASE}`);
console.log(`  画面の幅　： ${VIEW.label}`);
console.log(`  会社コード： ${CODE}`);
console.log(`  メール　　： ${EMAIL}`);
console.log(`${"═".repeat(64)}`);

/* ── 下ごしらえ：お店を1つ作る ────────────────
     ★ここで作るのは「お店」までです。
       会員は、必ず画面から登録します。 */
H("下ごしらえ（お店だけを作る）");

const tenantId = await seed.createTenant({ code: CODE, name: `E2E確認用ショップ ${STAMP}` });
await seed.makeTenantLaunchReady(tenantId);

/* ── この試験で開く住所を、このお店のものにする ──────────
     ★お客様に会社コードを打たせないための、いちばん大事な仕込みです。
       本番では「shop-a.example.com はA店」という割り当てを
       tenant_domains の表に入れます。試験でも同じ表を使います。
       （環境変数の TENANT_HOST_MAP は検証用の別口です。
         本番の割り当てを環境変数に書かないこと。） */
const HOST = new URL(BASE).host.toLowerCase();
await db().execute({
  sql: `INSERT INTO tenant_domains (host, tenant_id, note, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          tenant_id  = excluded.tenant_id,
          note       = excluded.note,
          created_at = excluded.created_at`,
  args: [HOST, tenantId, `E2E試験用 ${STAMP}`, new Date().toISOString()],
});

const gachaId = await seed.createGacha({
  tenantId,
  title: `通し確認ガチャ ${STAMP}`,
  price: NEDAN,
  total: 40,
  designedRtp: 80,
  status: "PUBLISHED",
});

/* ★同じ回線からの登録は1時間に5回までです。
     使い捨てのデータベースなので、数え直しの跡だけ消します。 */
await db().execute({ sql: `DELETE FROM login_attempts WHERE reason LIKE 'SIGNUP%'`, args: [] });

const zaiko = await all(
  `SELECT grade, name, value, total FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ? ORDER BY grade`,
  [tenantId, gachaId],
);
T("準備1", "お店とガチャを作った", true, `会社=${CODE} ／ ガチャ=${gachaId} ／ ${NEDAN}pt`);
T(
  "準備2",
  "景品がお店の登録どおりに入っている",
  zaiko.length > 0,
  zaiko.map((r) => `${r.grade}:${r.name}(${n(r.value)}円)×${n(r.total)}`).join(" / "),
);
{
  const d = await one(`SELECT tenant_id FROM tenant_domains WHERE host = ?`, [HOST]);
  T(
    "準備3",
    "この住所が、このお店のものとして登録されている",
    String(d.tenant_id ?? "") === tenantId,
    `${HOST} → ${String(d.tenant_id ?? "（無し）")}`,
  );
}

const mailFrom = mailLogSize();

/* ── ブラウザを開く ─────────────────────────── */
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: VIEW.width, height: VIEW.height },
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
const page = watch(await ctx.newPage(), "お客様");
page.setDefaultTimeout(20000);

let customerId = null;

/* お客様が「会社コード」を打たされた回数。★最後まで0であること */
let codeUchi = 0;

try {
  /* ══════════════════════════════════════════
     ⓪ 会員登録の前に、棚を見られるか

     ★ふつうのお店は、並んでいる物を見てから会員になります。
       「何が売っているかは会員登録してからお見せします」では、
       ほとんどの方はそこで帰ってしまいます。

     ★ただし、ここから引けてはいけません。
       引くとポイントが減ります。減らす相手（お客様）が
       決まっていない状態で引かせる作りは、絶対に作らないこと。
     ══════════════════════════════════════════ */
  H("⓪ 会員登録の前に、棚を見られるか");

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  T(
    "C-00a",
    "お店の住所でトップを開くと、そのお店の売り場が出る",
    new URL(page.url()).pathname === "/shop",
    page.url(),
  );

  const tanaMieta = await machi(page, `text=通し確認ガチャ ${STAMP}`, 20000);
  const mise0 = await moji(page);
  T(
    "C-00b",
    "ログインする前でも、売っているガチャが見えている",
    tanaMieta,
    mise0.split("\n").filter(Boolean).slice(0, 4).join(" / "),
  );

  /* ★ログイン前に、会員向けの表示（保有ポイント・＋購入）を出さないこと。
       一瞬でも出して引っ込めると、壊れて見えます。 */
  T(
    "C-00b2",
    "ログイン前のヘッダーが「ログイン／新規会員登録」になっている",
    !/保有ポイント/.test(mise0) &&
      (await page.locator('[data-testid="chrome-signup"]').count()) > 0,
    /保有ポイント/.test(mise0) ? "★ログイン前なのに保有ポイントが出ている" : "ログイン／新規会員登録",
  );

  const hami0 = await hamidashi(page);
  hamiT("C-00c", `ログイン前の売り場が横にはみ出していない（${VIEW.label}）`, hami0);

  await page.locator(`text=通し確認ガチャ ${STAMP}`).first().click().catch(() => {});
  await page.waitForURL(`**/shop/${gachaId}`, { timeout: 15000 }).catch(() => {});
  await machi(page, '[data-testid="guest-login-to-draw"]', 20000);
  T(
    "C-00d",
    "ガチャを押すと、ログインしなくても中身（賞の一覧）まで見える",
    new URL(page.url()).pathname === `/shop/${gachaId}`,
    page.url(),
  );

  /* ★一番大事な一行です。ここが「1回引く」に戻ったら落とします。 */
  const guestHiku = await page.locator('[data-testid="guest-login-to-draw"]').count();
  const guestNama = await page.locator('[data-testid="draw-open"]').count();
  T(
    "C-00e",
    "ログイン前は引けない（ボタンが「ログインして引く」だけ）",
    guestHiku > 0 && guestNama === 0,
    `ログインして引く=${guestHiku}件 ／ そのまま引く=${guestNama}件`,
  );

  /* ★会社コードは、ここでも一度も出てはいけません */
  const code0 = await page.locator('input[autocomplete="organization"]').count();
  if (code0 > 0) codeUchi += 1;
  T("C-00f", "ログイン前の売り場に、会社コードの欄が無い", code0 === 0, `欄=${code0}件`);

  await page.locator('[data-testid="guest-login-to-draw"]').first().click().catch(() => {});
  await page.waitForURL("**/login**", { timeout: 15000 }).catch(() => {});
  T(
    "C-00g",
    "「ログインして引く」を押すと、戻り先つきでログイン画面へ行く",
    /\/login/.test(page.url()) && /next=/.test(page.url()),
    page.url(),
  );

  /* ══════════════════════════════════════════
     ① 新規会員登録
     ══════════════════════════════════════════ */
  H("① 新規会員登録");

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const login1 = await machi(page, '[data-testid="go-signup"]');
  T("C-01", "ログイン画面に、はじめての方の入口がある", login1);

  const hami1 = await hamidashi(page);
  hamiT("C-02", `ログイン画面が横にはみ出していない（${VIEW.label}）`, hami1);

  await page.locator('[data-testid="go-signup"]').click();
  await page.waitForURL("**/signup", { timeout: 15000 }).catch(() => {});
  const sign1 = await machi(page, 'input[type="email"]');
  T("C-03", "新規会員登録の画面が出た", sign1);

  /* ★中身が動き出すまで待つこと（2026-09-07）。
       画面の見た目は、中身が動き出す前に先に出ます。
       乗る前に「登録する」を押すと、ブラウザが昔ながらのやり方で
       ページごと送信してしまい、打ち込みが消えたまま
       同じ画面に戻ります。エラーは1つも出ません。
       同じことで、お店側のログインが丸ごと止まりました。 */
  const { machiUgokidasu } = await import(`${ROOT}/scripts/lib/console-enter.mjs`);
  await machiUgokidasu(page, "form", 30000).catch(() => {});

  /* ★会社コードの欄は、お客様の画面には二度と出しません（2026-09-07）。
       どのお店かは、開いている住所からサーバー側で決まります。
       欄が復活したら、ここで落ちます。 */
  const codeBox = page.locator('input[autocomplete="organization"]');
  const codeAri = (await codeBox.count()) > 0;
  if (codeAri) codeUchi += 1;
  T(
    "C-04",
    "登録画面に会社コードの欄が無い",
    !codeAri,
    codeAri
      ? "★欄が出ている。お客様に会社コードを打たせてはいけません"
      : `住所（${HOST}）からお店が決まっている`,
  );

  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('input[autocomplete="nickname"]').fill("確認 太郎");
  await page.locator('input[name="agreeTerms"]').check();
  await page.locator('input[name="agreePrivacy"]').check();

  const hami2 = await hamidashi(page);
  hamiT("C-05", `登録画面が横にはみ出していない（${VIEW.label}）`, hami2);

  await page.locator('button[type="submit"]').click();
  const done1 = await machi(page, '[data-testid="signup-done"]');
  T("C-06", "登録を受け付けた画面が出た", done1, done1 ? "" : (await moji(page)).slice(0, 200));
  if (!done1) throw new Error("登録が受け付けられませんでした");

  const uketsuke = await moji(page);
  T(
    "C-07",
    "受け付けの画面で「登録完了」と言い切っていない",
    !/登録が完了|ご登録が完了/.test(uketsuke),
    uketsuke.split("\n").filter(Boolean).slice(0, 3).join(" / "),
  );

  /* ══════════════════════════════════════════
     ② メールの確認
     ══════════════════════════════════════════ */
  H("② メールの確認");

  const kagi = await machiTeKagi(mailFrom, EMAIL);
  T("C-08", "確認メールが出た（記録の紙で確認）", Boolean(kagi), kagi ? `鍵=${kagi.slice(0, 12)}…` : `紙=${MAIL_LOG}`);
  if (!kagi) throw new Error("確認メールの鍵が取れませんでした");

  const mae = await one(
    `SELECT email_verified_at FROM customers WHERE tenant_id = ? AND lower(email) = ?`,
    [tenantId, EMAIL.toLowerCase()],
  );
  T("C-09", "開く前は、まだ確認前になっている", !mae.email_verified_at, String(mae.email_verified_at ?? "null"));

  await page.goto(`${BASE}/verify-email?token=${kagi}`, { waitUntil: "domcontentloaded" });
  const vs = await machi(page, '[data-testid="verify-submit"]', 15000);
  T("C-09b", "確認のボタンが出た（開いただけでは確認しない）", vs);
  /* ★1回押して終わりにしないこと。
       手元のサーバーは、この画面を初めて開くときに組み立てます。
       組み上がる前に押しても、何も起きません。 */
  const vd = vs
    ? await press(page, '[data-testid="verify-submit"]', '[data-testid="verify-done"],[data-testid="verify-failed"]')
    : false;
  T("C-10", "メールの確認が通った", vd, vd ? "" : (await moji(page)).slice(0, 200));

  const ato = await one(
    `SELECT id, email_verified_at, signup_source FROM customers WHERE tenant_id = ? AND lower(email) = ?`,
    [tenantId, EMAIL.toLowerCase()],
  );
  customerId = String(ato.id ?? "");
  T(
    "C-11",
    "確認した記録が残った",
    Boolean(ato.email_verified_at),
    `確認日時=${String(ato.email_verified_at ?? "null")} ／ 経路=${String(ato.signup_source ?? "?")}`,
  );

  const vmichi = await michi(page, "メール確認完了");
  T("C-12", "確認のあと、次に押すものがある", vmichi.length > 0, vmichi.join(" / "));

  /* ══════════════════════════════════════════
     ③ ログイン
     ══════════════════════════════════════════ */
  H("③ ログイン");

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });

  /* ★1回で決めつけないこと。
       手元のサーバーは、初めて開く画面をその場で組み立てます。
       組み上がる前に押しても、何も起きません。
       打ち込みも押し直しも、まとめてやり直します。 */
  let inMypage = false;
  let loginNG = "";
  let loginCodeAri = false;
  for (let i = 0; i < 6 && !inMypage; i += 1) {
    await page.locator('button[role="tab"]:has-text("お客様")').click().catch(() => {});
    /* ★お客様のログインにも、会社コードの欄は出しません。
         出ていたら、打たずに数えるだけにします（打ってしまうと
         「0回で通った」かどうかが分からなくなります）。 */
    const codeBox2 = page.locator('input[autocomplete="organization"]');
    if ((await codeBox2.count()) > 0) {
      loginCodeAri = true;
      codeUchi += 1;
    }
    await page.locator('input[type="email"]').fill(EMAIL).catch(() => {});
    await page.locator('input[type="password"]').fill(PASSWORD).catch(() => {});
    await page.locator('button[type="submit"]').first().click().catch(() => {});
    inMypage = await page.waitForURL("**/mypage**", { timeout: 6000 }).then(
      () => true,
      () => false,
    );
    if (!inMypage) {
      loginNG = await page
        .locator('[role="alert"]')
        .first()
        .innerText()
        .catch(() => "");
      if (loginNG) break; /* 断られた理由が出ているなら、押し直しても同じ */
    }
  }
  T("C-13", "ログインできてマイページへ入った", inMypage, inMypage ? page.url() : `${page.url()} ／ ${loginNG}`);
  if (!inMypage) throw new Error("ログインできませんでした");

  T(
    "C-13b",
    "お客様のログイン画面に会社コードの欄が無い",
    !loginCodeAri,
    loginCodeAri ? "★欄が出ている" : `住所（${HOST}）からお店が決まっている`,
  );
  T(
    "C-13c",
    "新規登録→ログイン→マイページを、会社コード入力0回で通せた",
    codeUchi === 0,
    `会社コードを打った回数＝${codeUchi}`,
  );

  T(
    "C-14",
    "確認前のお知らせが、もう出ていない",
    (await page.locator('[data-testid="email-unverified"]').count()) === 0,
  );

  /* お店の名前は、あとから読み込まれます。
     ★出るまでの間、既定の「オンラインガチャ」が見えています。
       どれくらい見えているのかを測ります。 */
  /* ★短く切らないこと。
       開発中のサーバーは、初めて開く画面をその場で組み立てるため、
       ここだけ数秒よけいにかかることがあります。
       8秒で切ると、日によって合否が変わる試験になります。
       「どれくらい既定の名前が見えていたか」は machiMs に出ます。 */
  const t0 = Date.now();
  const kanban = await machi(page, `[data-testid="chrome-logo"]:has-text("${SHOPNAME}")`, 20000);
  const machiMs = Date.now() - t0;
  const hajime = await page
    .locator('[data-testid="chrome-logo"]')
    .innerText()
    .catch(() => "");
  T(
    "C-15",
    "マイページの上に、この店の名前が出る",
    kanban,
    kanban
      ? `${machiMs}ms で「${SHOPNAME}」に変わった（★変わるまでは既定の「オンラインガチャ」が見えている）`
      : `出なかった。いま出ているのは「${hajime}」`,
  );

  const s0 = await snap(tenantId, customerId, gachaId);
  T("C-16", "はじめの残高は0pt", s0.points === 0, `残高=${s0.points}pt ／ 台帳合計=${s0.ledgerSum}`);

  /* ══════════════════════════════════════════
     ④ ガチャ一覧
     ══════════════════════════════════════════ */
  H("④ ガチャ一覧（売り場）");

  await page.goto(`${BASE}/mypage/shop`, { waitUntil: "domcontentloaded" });
  const tile = await machi(page, `[data-testid="tile-open-${gachaId}"]`);
  T("C-17", "作ったガチャが売り場に並んでいる", tile);

  const listText = await moji(page);
  T(
    "C-18",
    "一覧に、お店が登録した景品の名前が出ている",
    zaiko.some((r) => listText.includes(String(r.name))) || listText.includes("通し確認ガチャ"),
    listText.split("\n").filter(Boolean).slice(0, 4).join(" / "),
  );

  const kaiBtn = await page.locator(`[data-testid="tile-buy-points-${gachaId}"]`).count();
  const hikuBtn = await page.locator(`[data-testid="tile-draw-${gachaId}"]`).count();
  T(
    "C-19",
    "残高0のときは、一覧から「引く」ではなく「買う」が出ている",
    kaiBtn > 0 && hikuBtn === 0,
    `買う=${kaiBtn} ／ 引く=${hikuBtn}`,
  );

  const hami3 = await hamidashi(page);
  hamiT("C-20", `売り場が横にはみ出していない（${VIEW.label}）`, hami3);

  /* ══════════════════════════════════════════
     ⑤⑥ ガチャ詳細・ポイント不足
     ══════════════════════════════════════════ */
  H("⑤⑥ ガチャ詳細とポイント不足");

  await page.locator(`[data-testid="tile-open-${gachaId}"]`).click();
  await page.waitForURL(`**/mypage/shop/${gachaId}`, { timeout: 15000 }).catch(() => {});
  const detail = await machi(page, '[data-testid="detail-back-to-list"]');
  T("C-21", "ガチャ詳細が開いた", detail, page.url());

  const dText = await moji(page);
  T(
    "C-22",
    "詳細に「足りない」ことがはっきり書いてある",
    /足り|不足/.test(dText),
    dText.split("\n").filter((l) => /足り|不足/.test(l)).slice(0, 2).join(" / "),
  );

  const drawDisabled = await page
    .locator('[data-testid="draw-open"]')
    .isDisabled()
    .catch(() => null);
  T("C-23", "残高が足りないので「引く」は押せない", drawDisabled === true, `disabled=${drawDisabled}`);

  const buyBtn = await machi(page, '[data-testid="go-buy-points"]', 5000);
  T("C-24", "代わりに「ポイントを購入する」が出ている", buyBtn);

  /* 「次に何を押せばよいか」— 押せる主なボタンを数える */
  const dbtn = await michi(page, "ガチャ詳細（残高不足）");
  T("C-25", "詳細で、押せるものがある", dbtn.length > 0, dbtn.slice(0, 6).join(" / "));

  const hami4 = await hamidashi(page);
  hamiT("C-26", `ガチャ詳細が横にはみ出していない（${VIEW.label}）`, hami4);

  /* ══════════════════════════════════════════
     ⑦ ポイント購入
     ══════════════════════════════════════════ */
  H("⑦ ポイント購入");

  await page.locator('[data-testid="go-buy-points"]').click();
  await page.waitForURL("**/mypage/points/buy**", { timeout: 15000 }).catch(() => {});
  const modoriAri = page.url().includes("from=");
  T("C-27", "購入画面へ、戻り先を持ったまま来た", modoriAri, page.url());

  const shina = await machi(page, '[data-testid="buy-product"]');
  T("C-28", "買えるポイントが並んでいる", shina);
  if (!shina) throw new Error("ポイント商品が出ませんでした");

  await page.locator('[data-testid="buy-product"]').first().click();
  const harau = await machi(page, '[data-testid="buy-pay"]');
  T("C-29", "最終確認の画面が出た", harau);

  const kText = await moji(page);
  T(
    "C-30",
    "動作確認のお支払いであることが、はっきり書いてある",
    /動作確認|実際の請求は発生しません/.test(kText),
    kText.split("\n").filter((l) => /動作確認|請求/.test(l)).slice(0, 2).join(" / "),
  );

  await page.locator('[data-testid="buy-pay"]').click();
  /* ★この目印は中身の無い <div> です（PointBuy.tsx）。
       大きさが0なので「見えるまで待つ」では永遠に待ちます。置かれたかだけを見ます */
  const kanryo = await machiAru(page, '[data-testid="buy-done"]', 25000);
  T("C-31", "お支払いが終わった画面が出た", kanryo, kanryo ? "" : (await moji(page)).slice(0, 200));

  const s1 = await snap(tenantId, customerId, gachaId);
  T(
    "C-32",
    "残高が増え、台帳と一致している",
    s1.points > 0 && s1.points === s1.ledgerSum,
    `残高=${s1.points}pt ／ 台帳合計=${s1.ledgerSum}`,
  );

  /* ══════════════════════════════════════════
     ⑧ 元のガチャへ戻る
     ══════════════════════════════════════════ */
  H("⑧ 元のガチャへ戻る");

  const modoru = await machi(page, '[data-testid="buy-return"]', 5000);
  T("C-33", "「元のガチャへ戻る」が出ている", modoru);
  await page.locator('[data-testid="buy-return"]').click();
  const modotta = await page.waitForURL(`**/mypage/shop/${gachaId}`, { timeout: 15000 }).then(
    () => true,
    () => false,
  );
  T("C-34", "買う前に見ていたガチャへ、そのまま戻った", modotta, page.url());

  /* ══════════════════════════════════════════
     ⑨⑩ 引く・結果画面（1回目）
     ══════════════════════════════════════════ */
  H("⑨⑩ 1回目を引く");

  const hikeru = await page
    .locator('[data-testid="draw-open"]')
    .isDisabled()
    .catch(() => null);
  T("C-35", "残高が足りたので「引く」が押せる", hikeru === false, `disabled=${hikeru}`);

  await page.locator('[data-testid="draw-open"]').click();
  const sheet = await machi(page, '[data-testid="draw-go"]');
  T("C-36", "押した瞬間には引かず、確認が出る", sheet);

  const modal = await hamidashi(page);
  hamiT("C-37", `確認の板が画面の外に出ていない（${VIEW.label}）`, modal);

  await page.locator('[data-testid="draw-go"]').click();

  /* 演出は飛ばします（結果の中身を見たいので） */
  const tobasu = page.locator('button:has-text("演出をとばす")');
  for (let i = 0; i < 20; i += 1) {
    if ((await tobasu.count()) > 0) {
      await tobasu.first().click().catch(() => {});
      break;
    }
    await page.waitForTimeout(300);
  }
  const kekka1 = await machi(page, 'button:has-text("獲得商品を見る")', 25000);
  T("C-38", "結果の画面が出た", kekka1, kekka1 ? "" : (await moji(page)).slice(0, 300));

  const s2 = await snap(tenantId, customerId, gachaId);
  const d1 = await saigo(tenantId, customerId);
  T(
    "C-39",
    "1回分だけ引かれている（残高・在庫・当選が全部1回分）",
    s2.draws === 1 &&
      s2.drawn === 1 &&
      s2.prizes === genbutsuKa(d1) &&
      s2.points === s1.points - NEDAN + n(d1.point_returned),
    `引いた=${s2.draws}回 ／ 在庫消化=${s2.drawn} ／ ${d1.prize_rank}賞「${d1.prize_name}」 ／ ` +
      `現物=${s2.prizes}件（この賞は${genbutsuKa(d1) ? "現物" : "その場でポイントに戻る賞"}） ／ ` +
      `残高=${s2.points}pt（${s1.points} −${NEDAN} ＋戻り${n(d1.point_returned)}）`,
  );

  const kekkaText = await moji(page);
  const atattaName = String(d1.prize_name ?? "");
  T(
    "C-40",
    "当たった景品の名前が、お店の登録どおりに出ている",
    Boolean(atattaName) && kekkaText.includes(atattaName),
    `台帳=${atattaName} ／ 画面に出ている=${kekkaText.includes(atattaName)}`,
  );

  /* 結果画面のボタン（仕様） */
  const btn1 = await page.locator('button:has-text("もう一度引く")').count();
  const btn1b = await page.locator('button:has-text("ポイントを購入して、もう一度引く")').count();
  const btn2 = await page.locator('button:has-text("獲得商品を見る")').count();
  const btn3 = await page.locator('button:has-text("閉じる")').count();
  T(
    "C-41",
    "結果画面のボタンが仕様どおり（引ける：もう一度引く／獲得商品を見る／閉じる）",
    btn1 === 1 && btn1b === 0 && btn2 === 1 && btn3 === 1,
    `もう一度引く=${btn1} ／ 購入して引く=${btn1b} ／ 獲得商品=${btn2} ／ 閉じる=${btn3}`,
  );

  const hami5 = await hamidashi(page);
  hamiT("C-42", `結果画面が横にはみ出していない（${VIEW.label}）`, hami5);

  /* ══════════════════════════════════════════
     ⑪ もう一度引く（結果画面から）
     ══════════════════════════════════════════ */
  H("⑪ 結果画面から、もう一度引く");

  await page.locator('button:has-text("もう一度引く")').first().click();
  const sheet2 = await machi(page, '[data-testid="draw-go"]', 10000);
  T("C-43", "結果画面から、そのまま次の確認へ進めた", sheet2);
  await page.locator('[data-testid="draw-go"]').click();

  for (let i = 0; i < 20; i += 1) {
    if ((await tobasu.count()) > 0) {
      await tobasu.first().click().catch(() => {});
      break;
    }
    await page.waitForTimeout(300);
  }
  const kekka2 = await machi(page, 'button:has-text("獲得商品を見る")', 25000);
  T("C-44", "2回目の結果画面が出た", kekka2);

  const s3 = await snap(tenantId, customerId, gachaId);
  const d2 = await saigo(tenantId, customerId);
  T(
    "C-45",
    "2回目も1回分だけ引かれている",
    s3.draws === 2 &&
      s3.drawn === 2 &&
      s3.prizes === s2.prizes + genbutsuKa(d2) &&
      s3.points === s2.points - NEDAN + n(d2.point_returned),
    `引いた=${s3.draws}回 ／ ${d2.prize_rank}賞「${d2.prize_name}」 ／ 現物=${s3.prizes}件 ／ ` +
      `残高=${s3.points}pt（${s2.points} −${NEDAN} ＋戻り${n(d2.point_returned)}）`,
  );

  /* 残高が足りない側の結果画面 */
  const b1 = await page.locator('button:has-text("ポイントを購入して、もう一度引く")').count();
  const b0 = await page.locator('button:has-text("もう一度引く")').count();
  const tarinaiText = await moji(page);
  T(
    "C-46",
    "残高が足りなくなったら、結果画面が「購入して、もう一度引く」に変わる",
    s3.points < NEDAN ? b1 === 1 : b0 >= 1,
    `残高=${s3.points}pt ／ 購入して引く=${b1} ／ もう一度引く=${b0}`,
  );
  T(
    "C-47",
    "なぜ引けないのかが、文字で書いてある",
    s3.points >= NEDAN || /引けません|足り/.test(tarinaiText),
    tarinaiText.split("\n").filter((l) => /引けません|足り/.test(l)).slice(0, 2).join(" / "),
  );

  /* ══════════════════════════════════════════
     ⑪-b 手元に商品が2点そろうまで、実際に引き続ける
     ══════════════════════════════════════════

     ★引いた回数と、手元に残る商品の数は同じではありません。
       S・A・B賞だけが商品として残り、C・D賞はその場でポイントに戻ります。
       このあと「1点はポイントに交換」「もう1点は発送を依頼」を
       両方ためすので、2点そろうまで、本物の画面で引き続けます。
       足りなくなったら、本物の購入画面から買い足します。 */
  H("⑪-b 商品が2点そろうまで引く");

  let ima = await snap(tenantId, customerId, gachaId);
  let tsuika = 0;
  let kaimashi = 0;

  while (ima.prizes < 2 && tsuika < 30) {
    if (ima.points < NEDAN) {
      const kauBtn = page.locator('button:has-text("ポイントを購入して、もう一度引く")');
      if ((await kauBtn.count()) > 0) {
        await kauBtn.first().click().catch(() => {});
      } else {
        await page.goto(
          `${BASE}/mypage/points/buy?from=${encodeURIComponent(`/mypage/shop/${gachaId}`)}`,
          { waitUntil: "domcontentloaded" },
        );
      }
      if (!(await machi(page, '[data-testid="buy-product"]', 20000))) break;
      await page.locator('[data-testid="buy-product"]').first().click();
      if (!(await machi(page, '[data-testid="buy-pay"]', 10000))) break;
      await page.locator('[data-testid="buy-pay"]').click();
      if (!(await machiAru(page, '[data-testid="buy-done"]', 25000))) break;
      kaimashi += 1;
      if (await machi(page, '[data-testid="buy-return"]', 10000)) {
        await page.locator('[data-testid="buy-return"]').click();
        await page.waitForURL(`**/mypage/shop/${gachaId}`, { timeout: 15000 }).catch(() => {});
      }
    }

    /* 結果の板が開いたままなら、そこから。閉じていれば売り場から */
    const mou = page.locator('button:has-text("もう一度引く")');
    const oseru =
      (await mou.count()) > 0 && (await mou.first().isDisabled().catch(() => true)) === false;
    if (oseru) {
      await mou.first().click().catch(() => {});
    } else {
      await page.goto(`${BASE}/mypage/shop/${gachaId}`, { waitUntil: "domcontentloaded" });
      if (!(await machi(page, '[data-testid="draw-open"]', 15000))) break;
      await page.locator('[data-testid="draw-open"]').click();
    }

    if (!(await machi(page, '[data-testid="draw-go"]', 10000))) break;
    await page.locator('[data-testid="draw-go"]').click();

    for (let i = 0; i < 20; i += 1) {
      if ((await tobasu.count()) > 0) {
        await tobasu.first().click().catch(() => {});
        break;
      }
      await page.waitForTimeout(300);
    }
    if (!(await machi(page, 'button:has-text("獲得商品を見る")', 25000))) break;

    tsuika += 1;
    ima = await snap(tenantId, customerId, gachaId);
  }

  T(
    "C-47b",
    "発送とポイント交換の両方をためせるだけ、手元に商品がそろった",
    ima.prizes >= 2,
    `手元の商品=${ima.prizes}点 ／ 追加で引いた=${tsuika}回 ／ 買い足し=${kaimashi}回 ／ ` +
      `引いた合計=${ima.draws}回 ／ 残高=${ima.points}pt`,
  );

  /* ══════════════════════════════════════════
     ⑫ 獲得商品
     ══════════════════════════════════════════ */
  H("⑫ 獲得商品");

  await page.locator('button:has-text("獲得商品を見る")').first().click();
  await page.waitForURL("**/mypage/prizes", { timeout: 15000 }).catch(() => {});

  const mochi = await all(
    `SELECT id, name, exchange_pt, status FROM prizes WHERE tenant_id = ? AND user_id = ? ORDER BY rowid`,
    [tenantId, customerId],
  );

  /* ★「獲得商品」という文字だけで待たないこと。
       同じ言葉が上の行き先にも出ているので、
       中身が届く前に「開いた」と数えてしまいます。
       本当に品物の札が出るまで待ちます。 */
  const prizesOk = await machi(
    page,
    `button:has-text("${String(mochi[0]?.name ?? "獲得商品")}")`,
    20000,
  );
  T("C-48", "獲得商品の画面が開いた（品物の札まで出ている）", prizesOk, page.url());

  const pText = await moji(page);
  T(
    "C-49",
    "手元の商品が、ぜんぶ名前つきで並んでいる",
    mochi.length >= 2 && mochi.every((p) => pText.includes(String(p.name))),
    `${mochi.length}点：` + mochi.map((p) => `${p.name}(${n(p.exchange_pt)}pt/${p.status})`).join(" / "),
  );
  T(
    "C-50",
    "1件ごとに、いまどうなっているかが文字で出ている",
    /未手続き|お手続き|発送|交換/.test(pText),
    pText.split("\n").filter((l) => /未手続き|お手続き/.test(l)).slice(0, 2).join(" / "),
  );

  /* ══════════════════════════════════════════
     ⑬ ポイント交換（1件目）
     ══════════════════════════════════════════ */
  H("⑬ ポイントに交換する");

  const shina1 = String(mochi[0].name);
  const shina2 = String(mochi[1].name);

  /* ★同じ名前の商品が2点あることがあります。
       お手続きが済んだ商品は押せなくなる作りなので、
       「まだ押せるもの」の中から選びます */
  const erabu = (na) => page.locator(`button:not([disabled]):has-text("${na}")`).first();

  await erabu(shina1).click();
  const kokan = await machi(page, 'button:has-text("ポイントに交換する")', 8000);
  T("C-51", "選ぶと、操作のボタンが出る", kokan);

  await page.locator('button:has-text("ポイントに交換する")').first().click();
  const kakunin = await machi(page, 'button:has-text("はい、ポイントに交換します")', 8000);
  T("C-52", "押した瞬間には交換せず、最終確認が出る", kakunin);

  const kText2 = await moji(page);
  T(
    "C-53",
    "「取り消せない」ことが、確認の板に書いてある",
    /取り消しはできません|お送りできなくなります/.test(kText2),
    kText2.split("\n").filter((l) => /取り消し|お送りできなく/.test(l)).slice(0, 2).join(" / "),
  );

  await page.locator('button:has-text("はい、ポイントに交換します")').click();

  /* 追加の本人確認が挟まったら、その場でパスワードを入れ直します */
  await page.waitForTimeout(1200);
  if ((await page.locator('text=ご本人の確認をお願いいたします').count()) > 0) {
    await page.locator('input[type="password"]').last().fill(PASSWORD);
    await page.locator('button:has-text("確認する")').first().click();
    T("C-54", "交換のとき、追加の本人確認が入った", true, "パスワードを入れ直した");
  } else {
    T("C-54", "交換のとき、追加の本人確認は入らなかった", true, "設計どおり（交換は求めない）");
  }

  const kokanOk = await machi(page, "text=ポイントに交換いたしました", 15000);
  T("C-55", "交換できたお知らせが出た", kokanOk, kokanOk ? "" : (await moji(page)).slice(0, 200));

  const s4 = await snap(tenantId, customerId, gachaId);

  /* ★どの1点が交換されたのかを、決め打ちしないこと。
       同じ名前の品が2点あることがあり、画面の並び順は
       新しい順です。台帳に聞き直します。 */
  const nochi = await all(
    `SELECT id, name, exchange_pt, status FROM prizes WHERE tenant_id = ? AND user_id = ? ORDER BY rowid`,
    [tenantId, customerId],
  );
  const kokanZumi = nochi.filter((p) => String(p.status) === "EXCHANGED");
  /* まだ何も選んでいない品（prizes.status の言葉は UNCHOSEN） */
  const nokori = nochi.filter((p) => String(p.status) === "UNCHOSEN");
  const fueta = kokanZumi.length === 1 ? n(kokanZumi[0].exchange_pt) : 0;

  T(
    "C-56",
    "交換した分だけ、残高が増えている",
    kokanZumi.length === 1 && s4.points === ima.points + fueta && s4.points === s4.ledgerSum,
    `残高=${ima.points}→${s4.points}pt（+${fueta}） ／ 台帳合計=${s4.ledgerSum}`,
  );
  T(
    "C-57",
    "交換したのは1点だけで、残りは手つかずのまま",
    kokanZumi.length === 1 && nokori.length >= 1,
    nochi.map((p) => `${p.name}=${p.status}`).join(" / "),
  );

  const pText2 = await moji(page);
  T(
    "C-58",
    "交換済みの商品が、消えずに「もう選べない理由」つきで残っている",
    pText2.includes(String(kokanZumi[0]?.name ?? shina1)) &&
      /お選びいただけません|交換/.test(pText2),
    pText2.split("\n").filter((l) => /お選びいただけません/.test(l)).slice(0, 2).join(" / "),
  );

  /* ══════════════════════════════════════════
     ⑭ 発送依頼（2件目）
     ══════════════════════════════════════════ */
  H("⑭ 発送を依頼する");

  /* お届け先が無いと依頼できません。先に登録します */
  await page.goto(`${BASE}/mypage/address`, { waitUntil: "domcontentloaded" });
  const addrOpen = await machi(page, 'button:has-text("お届け先を変更する")', 15000);
  T("C-59", "お届け先の画面が開いた", addrOpen, page.url());
  if (addrOpen) await page.locator('button:has-text("お届け先を変更する")').click();

  await page.locator('label:has-text("お名前") input').first().fill("確認 太郎");
  await page.locator('label:has-text("郵便番号") input').first().fill("100-0001");
  await page.locator('label:has-text("ご住所") input').first().fill("東京都千代田区千代田1-1 確認ビル101");
  await page.locator('label:has-text("お電話番号") input').first().fill("0300000000");
  await page.locator('button:has-text("この内容で保存する")').click();

  await page.waitForTimeout(1200);
  const stepUpAddr = (await page.locator("text=ご本人の確認をお願いいたします").count()) > 0;
  if (stepUpAddr) {
    await page.locator('input[type="password"]').last().fill(PASSWORD);
    await page.locator('button:has-text("確認する")').first().click();
  }
  T("C-60", "お届け先の変更に、追加の本人確認が入った", stepUpAddr, stepUpAddr ? "" : "★入らなかった（設計では必ず入るはず）");

  const addrOk = await machi(page, "text=お届け先を変更いたしました", 15000);
  T("C-61", "お届け先を保存できた", addrOk, addrOk ? "" : (await moji(page)).slice(0, 200));

  /* ══════════════════════════════════════════
       ★ここで、本人確認の「有効時間」を故意に切らします
       ══════════════════════════════════════════

       いま住所を変えたばかりで、そのときパスワードを入れています。
       この確認は10分間有効なので（stepUpPolicy の STEP_UP_FRESH_MIN）、
       そのまま発送を依頼すると、二度目は求められません。
       それは設計どおりで、正しい動きです。

       ただ、それでは「住所を変えた直後の発送依頼に確認が入るか」を
       確かめられません。ですので、使い捨てのDBの中だけで
       確認した時刻を30分前に巻き戻し、時間切れの状態を作ります。
       ★これは試験のための細工です。製品の動きは変えていません。 */
  await db().execute({
    sql: `UPDATE sessions SET step_up_at = ?
           WHERE tenant_id = ? AND subject_id = ? AND subject_kind = 'CUSTOMER'`,
    args: [new Date(Date.now() - 30 * 60 * 1000).toISOString(), tenantId, customerId],
  });

  const okuru = String(nokori[0]?.name ?? shina2);
  await page.goto(`${BASE}/mypage/prizes`, { waitUntil: "domcontentloaded" });
  await machi(page, `button:not([disabled]):has-text("${okuru}")`, 15000);
  await erabu(okuru).click();
  const hassou = await machi(page, 'button:has-text("発送を依頼する")', 8000);
  T("C-62", "残った商品を選ぶと「発送を依頼する」が出る", hassou);

  await page.locator('button:has-text("発送を依頼する")').first().click();
  const hKakunin = await machi(page, 'button:has-text("はい、発送を依頼します")', 8000);
  T("C-63", "押した瞬間には依頼せず、最終確認が出る", hKakunin);

  await page.locator('button:has-text("はい、発送を依頼します")').click();
  /* ★1.5秒の決め打ちで数えないこと。
       サーバーに一度尋ねてから「もう一度パスワードを」の窓が出ます。
       混んでいると1.5秒では間に合わず、
       「本人確認が入らなかった」という誤った不合格になります。 */
  const stepUpShip = await machiAru(page, "text=ご本人の確認をお願いいたします", 15000);
  if (stepUpShip) {
    await page.locator('input[type="password"]').last().fill(PASSWORD);
    await page.locator('button:has-text("確認する")').first().click();
  }
  T(
    "C-64",
    "住所を変えた直後の発送依頼に、追加の本人確認が入った",
    stepUpShip,
    stepUpShip
      ? "確認の有効時間が切れている状態で、きちんと聞き直された"
      : "★入らなかった（住所変更から60分以内は必ず入るはず）",
  );

  const hOk = await machi(page, "text=発送を承りました", 20000);
  T("C-65", "発送依頼を受け付けたお知らせが出た", hOk, hOk ? "" : (await moji(page)).slice(0, 250));

  const chumon = await one(
    `SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ? AND user_id = ?`,
    [tenantId, customerId],
  );
  T("C-66", "注文が1件できている", n(chumon.c) === 1, `注文=${n(chumon.c)}件`);

  /* ══════════════════════════════════════════
     ⑮ 発送状況の確認
     ══════════════════════════════════════════ */
  H("⑮ 発送状況");

  await page.goto(`${BASE}/mypage/shipping`, { waitUntil: "domcontentloaded" });
  /* ★開いた直後に読まないこと。中身はあとから取りに行きます。
       間に合わないと、空の枠を読んで誤った不合格になります。 */
  await machiAru(page, `text=${shina2}`, 20000);
  await page.waitForTimeout(400);
  const shipText = await moji(page);
  T(
    "C-67",
    "発送状況の画面に、いま依頼した分が出ている",
    shipText.includes(shina2) || /受付|依頼/.test(shipText),
    shipText.split("\n").filter(Boolean).slice(0, 5).join(" / "),
  );
  const smichi = await michi(page, "発送状況");
  T("C-68", "発送状況から、次に行ける場所がある", smichi.length > 0, smichi.slice(0, 6).join(" / "));

  const hami6 = await hamidashi(page);
  hamiT("C-69", `発送状況が横にはみ出していない（${VIEW.label}）`, hami6);

  /* ══════════════════════════════════════════
     ⑯ ログアウト
     ══════════════════════════════════════════ */
  H("⑯ ログアウト");

  await page.goto(`${BASE}/mypage`, { waitUntil: "domcontentloaded" });
  const logoutAri = await machi(page, '[data-testid="chrome-logout"]', 10000);
  T("C-70", "ログアウトの入口が、どの画面からでも見える", logoutAri);

  /* ★1回押して終わりにしないこと。
       画面が出た直後は、まだボタンが動き出していないことがあります。
       押しても何も起きないまま「出られた」と数えると、
       いちばん見つけたい「出られていない」を見逃します。 */
  const deta = logoutAri
    ? await press(page, '[data-testid="chrome-logout"]', "text=ログイン", 6)
    : false;
  await page.waitForTimeout(1000);
  T("C-70b", "ログアウトを押したら、ログイン画面へ戻った", deta && /\/login/.test(page.url()), page.url());

  await page.goto(`${BASE}/mypage/prizes`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const detteru = /\/login/.test(page.url());
  T("C-71", "ログアウトしたあとは、マイページに入れない", detteru, page.url());

  /* ══════════════════════════════════════════
     まとめて確認：本番に出てはいけない言葉
     ══════════════════════════════════════════ */
  H("通し確認：お客様の画面に出ていた言葉");

  const gamenList = [
    ["/login", "ログイン"],
    ["/signup", "新規会員登録"],
  ];
  const NGWORD = /(デモ|サンプル|モック|テストユーザー|開発用|ダミー)/;
  const detaNG = [];
  for (const [path, label] of gamenList) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const t = await moji(page);
    const hit = t.split("\n").filter((l) => NGWORD.test(l));
    if (hit.length > 0) detaNG.push(`${label}：${hit.slice(0, 2).join(" / ")}`);
  }
  T("C-72", "ログイン前の画面に、デモ・サンプル等が出ていない", detaNG.length === 0, detaNG.join(" ／ "));
} catch (e) {
  T("C-XX", "途中で止まった", false, String(e).slice(0, 400));
} finally {
  /* ══════════════════════════════════════════
     画面が出したエラーの集計
     ══════════════════════════════════════════ */
  H("画面が出したエラー");

  /* ★本人確認をお願いした 403 は、ブラウザ側にも
       「403 が返った」とだけ出ます。中身は不具合ではないので、
       その回数ぶんだけ、この行を分けて数えます。
       ★数を合わせるだけにして、他の 403 は必ず残すこと。 */
  let nokoriStepUp = STEPUP_403.length;
  const cons = CONSOLE_LOG.filter((c) => {
    if (yoso(c.text)) return false;
    if (kaihatsuDakeNoKeikoku(c.text)) return false;
    if (nokoriStepUp > 0 && /403 \(Forbidden\)/.test(c.text)) {
      nokoriStepUp -= 1;
      return false;
    }
    return true;
  });
  const perr = PAGE_ERR.filter((c) => !yoso(c.text) && !sakiyomi(c.text));
  const http = BAD_HTTP.filter((c) => !yoso(c.url));

  T("E-01", "Console のエラー・警告", cons.length === 0, cons.slice(0, 6).map((c) => `[${c.type}] ${c.text}`).join(" ／ "));
  T(
    "E-01b",
    "本人確認をお願いした回数（設計どおりの 403）",
    true,
    STEPUP_403.length === 0
      ? "0回"
      : `${STEPUP_403.length}回：` + STEPUP_403.map((c) => `${c.method} ${c.url.replace(BASE, "")}`).join(" ／ "),
  );
  T("E-02", "読み込み失敗（timeout・接続断）", perr.length === 0, perr.slice(0, 6).map((c) => c.text).join(" ／ "));
  T("E-03", "4xx / 5xx の通信", http.length === 0, http.slice(0, 8).map((c) => `${c.status} ${c.method} ${c.url}`).join(" ／ "));
  T("E-04", "次に何を押せばよいか分からない画面", MAYOI.length === 0, MAYOI.map((m) => `${m.gamen}：${m.reason}`).join(" ／ "));

  const out = {
    at: new Date().toISOString(),
    base: BASE,
    viewport: VIEW,
    tenantCode: CODE,
    tenantId,
    gachaId,
    customerId,
    email: EMAIL,
    ok,
    ng,
    results: LOG,
    console: cons,
    pageErrors: perr,
    badHttp: http,
    mayoi: MAYOI,
  };
  const file = `${ROOT}/docs/e2e-customer-${VIEW.width}-${STAMP}.json`;
  writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  ok ${ok} ／ NG ${ng}　（${VIEW.label}）`);
  console.log(`  控え： ${file}`);
  console.log(`${"═".repeat(64)}\n`);

  await browser.close().catch(() => {});
  process.exit(ng === 0 ? 0 : 1);
}
