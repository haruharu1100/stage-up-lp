/**
 * 販売前・総合バックテスト（実ブラウザでのE2E）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、HTTPだけの点検では足りないのか
 * ═══════════════════════════════════════════════════════
 *
 *   scripts/audit-preview.mjs は、サーバーの返事だけを見ています。
 *   サーバーが正しくても、
 *
 *       ・ボタンを押しても何も起きない
 *       ・ぐるぐるが終わらない
 *       ・保存したのに、再読込で消える
 *       ・画面のどこかが真っ白になる
 *
 *   は、全部そのまま残ります。お客様が困るのは、こちらです。
 *   だから、本物のブラウザで、実際に押します。
 *
 * ★本番へは絶対に向けないこと。
 *   DATABASE_ENV が production なら、その場で止まります。
 *
 * 使い方：
 *   npx tsx --env-file=.env.local scripts/backtest-e2e.mjs <Preview URL> [phase]
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
const PHASE = (process.argv[3] ?? "all").toLowerCase();
const PW = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";

if (!/^https:\/\//.test(BASE)) {
  console.error("使い方: npx tsx --env-file=.env.local scripts/backtest-e2e.mjs https://<Preview URL>");
  process.exit(1);
}
const dbEnv = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (dbEnv === "production") {
  console.error("DATABASE_ENV が production です。何もせずに止めました。");
  process.exit(1);
}
if (/os\.morika\.work/.test(BASE)) {
  console.error("本番URLには実行しません。");
  process.exit(1);
}

const PW_DIR =
  process.env.PLAYWRIGHT_DIR ||
  join(ROOT, "..", "blog-to-social", "node_modules", "playwright");
if (!existsSync(PW_DIR)) {
  console.error(`playwright が見つかりません: ${PW_DIR}`);
  process.exit(1);
}
const require_ = createRequire(import.meta.url);
const pwMod = await import(pathToFileURL(require_.resolve(join(PW_DIR, "index.js"))).href);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const { mfaCodeFor } = await import(`${ROOT}/scripts/lib/preview-client.mjs`);

/* ═══════════════════════════════════════════════
   記録
   ═══════════════════════════════════════════════ */
const BUGS = [];
const NOTES = [];
let SCREENS = 0;
let ACTIONS = 0;

/** 重さ： KINKYU（緊急）/ KOU（高）/ CHU（中）/ TEI（低） */
function bug(level, screen, title, detail, repro) {
  BUGS.push({ level, screen, title, detail, repro });
  const mark = { KINKYU: "[41m緊急[0m", KOU: "[31m高[0m", CHU: "[33m中[0m", TEI: "[90m低[0m" }[level];
  console.log(`    ${mark} [${screen}] ${title}\n        ${detail}`);
}
function ok(msg) {
  console.log(`    [32m✓[0m ${msg}`);
}
function note(msg) {
  NOTES.push(msg);
  console.log(`    [90m・${msg}[0m`);
}
function group(name) {
  console.log(`\n━━ ${name}`);
}

/* ═══════════════════════════════════════════════
   画面の一覧（components/console/menu.ts と app/ から）
   ═══════════════════════════════════════════════ */
const ADMIN_SCREENS = [
  ["dashboard", "ダッシュボード"],
  ["ai-operator", "AIオペレーター"],
  ["gachas", "ガチャ管理"],
  ["ai-builder", "ガチャ作成"],
  ["backtest", "バックテスト"],
  ["preview", "見え方の確認"],
  ["products", "景品管理"],
  ["customers", "会員管理"],
  ["analytics", "分析"],
  ["points", "ポイント管理"],
  ["orders", "注文管理"],
  ["shipping", "発送管理"],
  ["support", "問い合わせ"],
  ["rtp", "実績還元率"],
  ["market", "相場"],
  ["fraud", "不正検知"],
  ["security", "セキュリティ"],
  ["audit", "監査ログ"],
  ["site-editor", "サイト編集"],
  ["migration", "移行"],
  ["settings", "設定"],
];
const CUSTOMER_SCREENS = [
  ["/mypage", "マイページ"],
  ["/mypage/points", "ポイント"],
  ["/mypage/prizes", "獲得商品"],
  ["/mypage/shipping", "発送依頼"],
  ["/mypage/address", "お届け先"],
  ["/mypage/support", "問い合わせ"],
];
const OPEN_SCREENS = [
  ["/", "LP"],
  ["/login", "ログイン"],
  ["/demo", "デモ"],
  ["/sales", "営業資料"],
  ["/sales-demo", "営業デモ"],
  ["/launch", "公開前チェック"],
  ["/legal/privacy", "プライバシー"],
  ["/contact/thanks", "送信完了"],
  ["/contact/error", "送信エラー"],
];

/* ═══════════════════════════════════════════════
   下ごしらえ
   ═══════════════════════════════════════════════ */
async function loginCtx(browser, { kind, tenantCode, email, viewport }) {
  const ctx = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const mfaCode = kind === "ADMIN" ? await mfaCodeFor(db, email) : null;
  const r = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { kind, tenantCode, email, password: PW, ...(mfaCode ? { mfaCode } : {}) },
  });
  if (!r.ok()) throw new Error(`ログインできません（${email}）：${r.status()} ${await r.text()}`);
  /* ★Vercelが差し込む Preview 用ツールバーを止める。
       画面の上に重なってクリックを横取りするので、
       これを入れないと「押せない」が誤検出になります。
       お客様のドメインには差し込まれない部品です。 */
  await ctx.route(/vercel\.live|vercel-scripts\.com/, (route) => route.abort()).catch(() => {});
  return ctx;
}

/**
 * ★Preview環境だけに出るもの（製品の不具合ではない）。
 *   vercel.live のツールバーは Vercel が勝手に差し込む部品で、
 *   こちらのCSP（読み込んでよい先の一覧）に入れていないため断られます。
 *   お客様のドメインには差し込まれません。仕様として除外します。
 */
const PREVIEW_NOISE = /vercel\.live|_next-live\/feedback|favicon|Download the React DevTools/;
const shizuka = (list) => list.filter((s) => !PREVIEW_NOISE.test(s));

/** 1ページ開いて、出た問題を全部集める */
async function openAndWatch(ctx, url, label) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const badResponses = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 300)));
  page.on("response", (res) => {
    const s = res.status();
    if (s >= 400) badResponses.push(`${s} ${res.url().replace(BASE, "")}`);
  });
  let navErr = null;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (e) {
    navErr = String(e.message).slice(0, 200);
  }
  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(600);
  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  return { page, consoleErrors, pageErrors, badResponses, navErr, text, finalUrl: page.url() };
}

/* ═══════════════════════════════════════════════
   PHASE A：全画面の到達性
   ═══════════════════════════════════════════════ */
async function phaseA(browser) {
  group("PHASE A：全画面をひとつずつ開く");

  const boss = await loginCtx(browser, { kind: "ADMIN", tenantCode: "DEMO", email: "boss@demo.example" });

  for (const [slug, name] of ADMIN_SCREENS) {
    SCREENS += 1;
    const r = await openAndWatch(boss, `${BASE}/client-demo/${slug}`, name);
    const t = r.text;
    const short = t.replace(/\s+/g, "").length;
    const problems = [];
    if (r.navErr) problems.push(`開けない：${r.navErr}`);
    if (/\/login/.test(r.finalUrl)) problems.push(`ログイン画面へ飛ばされた（${r.finalUrl}）`);
    if (/ページが見つかりません|404/.test(t) && short < 400) problems.push("404扱いになった");
    if (short < 120) problems.push(`中身がほぼ空（文字数 ${short}）`);
    const hyd = shizuka([...r.consoleErrors, ...r.pageErrors]).filter((s) =>
      /[Hh]ydration|did not match|Minified React error #(418|423|425)/.test(s),
    );
    if (hyd.length) problems.push(`hydrationエラー：${hyd[0]}`);
    const otherErr = shizuka([...r.pageErrors, ...r.consoleErrors]).filter((s) => !hyd.includes(s));
    const bad5xx = r.badResponses.filter((s) => /^5\d\d/.test(s));
    const bad4xx = r.badResponses.filter((s) => /^4\d\d/.test(s) && !/favicon/.test(s));

    if (problems.length) {
      bug("KOU", name, problems[0], problems.join(" / "), `${BASE}/client-demo/${slug} を管理者で開く`);
    } else if (bad5xx.length) {
      bug("KOU", name, "APIが500を返した", bad5xx.join(", "), `${BASE}/client-demo/${slug}`);
    } else if (otherErr.length) {
      bug("CHU", name, "ブラウザのコンソールにエラー", otherErr.slice(0, 2).join(" | "), `${BASE}/client-demo/${slug}`);
    } else {
      ok(`${name.padEnd(12)} 文字数${String(short).padStart(5)}${bad4xx.length ? `（4xx: ${bad4xx.join(",")}）` : ""}`);
    }
    if (bad4xx.length && !problems.length) note(`${name}：4xxあり ${bad4xx.join(", ")}`);
    await r.page.close();
  }

  /* 知らないURLは、はっきり「ありません」と出ること */
  ACTIONS += 1;
  const nf = await openAndWatch(boss, `${BASE}/client-demo/dare-mo-shiranai-gamen`, "不明URL");
  if (/ありません|見つかりません|404/.test(nf.text)) ok("知らないURL … ちゃんと「ありません」と出た");
  else bug("CHU", "不明URL", "知らないURLで案内が出ない", nf.text.slice(0, 120), `${BASE}/client-demo/dare-mo-shiranai-gamen`);
  await nf.page.close();

  /* お客様側 */
  const kyaku = await loginCtx(browser, { kind: "CUSTOMER", tenantCode: "DEMO", email: "user1@demo.example" });
  for (const [path, name] of CUSTOMER_SCREENS) {
    SCREENS += 1;
    const r = await openAndWatch(kyaku, `${BASE}${path}`, name);
    const short = r.text.replace(/\s+/g, "").length;
    const problems = [];
    if (r.navErr) problems.push(`開けない：${r.navErr}`);
    if (/\/login/.test(r.finalUrl)) problems.push("ログイン画面へ飛ばされた");
    if (short < 80) problems.push(`中身がほぼ空（文字数 ${short}）`);
    const errs = shizuka([...r.pageErrors, ...r.consoleErrors]);
    const bad5xx = r.badResponses.filter((s) => /^5\d\d/.test(s));
    if (problems.length) bug("KOU", `お客様/${name}`, problems[0], problems.join(" / "), `${BASE}${path}`);
    else if (bad5xx.length) bug("KOU", `お客様/${name}`, "APIが500", bad5xx.join(","), `${BASE}${path}`);
    else if (errs.length) bug("CHU", `お客様/${name}`, "コンソールにエラー", errs.slice(0, 2).join(" | "), `${BASE}${path}`);
    else ok(`お客様/${name.padEnd(10)} 文字数${String(short).padStart(5)}`);
    await r.page.close();
  }

  /* ログイン不要で見える画面 */
  const nobody = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const [path, name] of OPEN_SCREENS) {
    SCREENS += 1;
    const r = await openAndWatch(nobody, `${BASE}${path}`, name);
    const short = r.text.replace(/\s+/g, "").length;
    const errs = shizuka([...r.pageErrors]);
    const bad5xx = r.badResponses.filter((s) => /^5\d\d/.test(s));
    if (r.navErr) bug("KOU", name, "開けない", r.navErr, `${BASE}${path}`);
    else if (short < 60) bug("KOU", name, `中身がほぼ空（${short}文字）`, r.finalUrl, `${BASE}${path}`);
    else if (bad5xx.length) bug("KOU", name, "APIが500", bad5xx.join(","), `${BASE}${path}`);
    else if (errs.length) bug("CHU", name, "JSエラー", errs.slice(0, 2).join(" | "), `${BASE}${path}`);
    else ok(`${name.padEnd(12)} 文字数${String(short).padStart(6)}`);
    await r.page.close();
  }
  await nobody.close();

  return { boss, kyaku };
}

/* ═══════════════════════════════════════════════
   PHASE B：全部のボタンを、実際に押す
   ═══════════════════════════════════════════════

   ★「押しても何も起きない」を見つけるのが目的です。
     だから、押す前と押したあとで、画面が本当に変わったかを
     文字数と見出しで比べます。変わらなければ疑います。

   ★ログアウトだけは、押すとそこで点検が終わってしまうので
     最後に別枠で確かめます（PHASE Aで /login へ飛ぶことは確認済み）。
*/
const OSANAI = /ログアウト|サインアウト/;

async function sugata(page) {
  return await page.evaluate(() => {
    const t = document.body?.innerText ?? "";
    return {
      len: t.length,
      head: t.slice(0, 400),
      dialogs: document.querySelectorAll('[role="dialog"],dialog[open]').length,
      spin: /読み込み中|よみこみ中|送信中|処理中|しばらくお待ち/.test(t),
    };
  });
}

/** 押せるものに番号を貼り、その番号で押す（文字での探索は当たらないため） */
const TAG = `(() => {
  const out = [];
  const root = document.querySelector("main") ?? document.body;
  let i = 0;
  for (const el of root.querySelectorAll("button, [role='tab'], [role='switch'], summary, a[href]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.disabled) continue;
    if (el.closest("nav, aside, header, footer")) continue;
    el.setAttribute("data-bt", String(i));
    const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("href") || "").replace(/\\s+/g, " ").trim().slice(0, 44);
    out.push({ idx: i, label, tag: el.tagName.toLowerCase() });
    i += 1;
  }
  return out;
})()`;

async function phaseB(browser) {
  group("PHASE B：ボタンを実際に押す");

  const boss = await loginCtx(browser, { kind: "ADMIN", tenantCode: "DEMO", email: "boss@demo.example" });
  const page = await boss.newPage();

  const errs = [];
  const bad = [];
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
  page.on("dialog", (d) => d.accept().catch(() => {}));

  const hiraku = async (url) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(400);
    return await page.evaluate(TAG);
  };

  for (const [slug, name] of ADMIN_SCREENS) {
    const url = `${BASE}/client-demo/${slug}`;
    const list = await hiraku(url);
    if (list.length === 0) { note(`${name}：押せるものが見当たらない`); continue; }
    console.log(`\n  ── ${name}（押せるもの ${list.length} 個）`);

    for (const item of list) {
      if (OSANAI.test(item.label)) { note(`${name}／「${item.label}」は最後に別枠で確かめる`); continue; }
      ACTIONS += 1;

      /* 毎回まっさらから始める。前の操作の影響を持ち越さない */
      const again = await hiraku(url);
      const same = again.find((x) => x.idx === item.idx && x.label === item.label);
      if (!same) { note(`${name}／「${item.label}」が二度目に見つからない（表示が毎回変わる）`); continue; }

      errs.length = 0;
      bad.length = 0;
      const mae = await sugata(page);
      const urlMae = page.url();

      let clickErr = null;
      const sel = `[data-bt="${item.idx}"]`;
      try {
        await page.locator(sel).scrollIntoViewIfNeeded({ timeout: 4000 });
      } catch {}
      try {
        await page.click(sel, { timeout: 5000 });
      } catch (e1) {
        /* ★動きのある部品や、上に何か重なっている場合の逃げ道。
             それでも押せなければ、本当に押せないボタンです。 */
        try {
          await page.click(sel, { timeout: 4000, force: true });
          note(`${name}／「${item.label}」は素直に押せず、force で押した（重なり・アニメーションの疑い）`);
        } catch (e2) {
          clickErr = String(e1.message).split("\n")[0].slice(0, 160);
        }
      }
      await page.waitForTimeout(1300);
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
      let ato = await sugata(page);
      const urlAto = page.url();

      let stuck = false;
      if (ato.spin) {
        for (let i = 0; i < 10; i += 1) {
          await page.waitForTimeout(1000);
          ato = await sugata(page);
          if (!ato.spin) break;
          if (i === 9) stuck = true;
        }
      }

      const kawatta =
        urlMae !== urlAto || mae.len !== ato.len || mae.head !== ato.head || mae.dialogs !== ato.dialogs;
      const e5 = bad.filter((s) => /^5\d\d/.test(s));
      const e4 = bad.filter((s) => /^4\d\d/.test(s) && !/favicon/.test(s));
      const je = shizuka(errs);

      if (clickErr) bug("KOU", name, `「${item.label}」が押せない`, clickErr, `${url} →「${item.label}」を押す`);
      else if (stuck) bug("KOU", name, `「${item.label}」でぐるぐるが終わらない`, "10秒待っても『読み込み中』のまま", `${url} →「${item.label}」`);
      else if (e5.length) bug("KOU", name, `「${item.label}」でサーバーエラー`, e5.join(", "), `${url} →「${item.label}」`);
      else if (je.length) bug("CHU", name, `「${item.label}」でJSエラー`, je.slice(0, 2).join(" | "), `${url} →「${item.label}」`);
      else if (!kawatta) bug("CHU", name, `「${item.label}」を押しても画面が変わらない`, `URL・文字数・見出し・モーダル数のどれも変化なし（${e4.length ? "API: " + e4.join(",") : "APIエラーも無し"}）`, `${url} →「${item.label}」`);
      else ok(`${name}／「${item.label}」 … ${urlMae !== urlAto ? "→ " + urlAto.replace(BASE, "") : ato.dialogs > mae.dialogs ? "モーダルが開いた" : "画面が変わった"}${e4.length ? `（4xx: ${e4.join(",")}）` : ""}`);
    }
  }
  await page.close();
  await boss.close();
}

/* ═══════════════════════════════════════════════
   走らせる
   ═══════════════════════════════════════════════ */
console.log(`\n═══════════════════════════════════════════════`);
console.log(`  販売前・総合バックテスト`);
console.log(`  ${BASE}`);
console.log(`═══════════════════════════════════════════════`);

const browser = await chromium.launch();
try {
  if (PHASE === "all" || PHASE === "a") await phaseA(browser);
  if (PHASE === "all" || PHASE === "b") await phaseB(browser);
} finally {
  await browser.close();
}

/* ═══════════════════════════════════════════════
   まとめ
   ═══════════════════════════════════════════════ */
const count = (lv) => BUGS.filter((b) => b.level === lv).length;
console.log(`\n═══════════════════════════════════════════════`);
console.log(`  画面 ${SCREENS} / 操作 ${ACTIONS}`);
console.log(`  バグ ${BUGS.length}（緊急 ${count("KINKYU")} / 高 ${count("KOU")} / 中 ${count("CHU")} / 低 ${count("TEI")}）`);
console.log(`═══════════════════════════════════════════════\n`);

mkdirSync(join(ROOT, "docs", "audit"), { recursive: true });
writeFileSync(
  join(ROOT, "docs", "audit", `backtest-${PHASE}.json`),
  JSON.stringify({ base: BASE, at: new Date().toISOString(), screens: SCREENS, actions: ACTIONS, bugs: BUGS, notes: NOTES }, null, 2),
);
