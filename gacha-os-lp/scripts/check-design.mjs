/**
 * DESIGN QA — 一度指摘された見た目の問題が、もう一度出ていないかを機械で確かめる。
 *
 * ★これは何のためにあるか
 *   「ビルドが通った」は、見た目が正しいことを何も保証しません。
 *   実機のスクリーンショットで指摘された7つの問題は、どれもビルドを通ります。
 *   同じ指摘を二度受けないために、その7つを毎回ここで測ります。
 *
 * ★測る7項目（docs/visual-regression-checklist.md と同じ番号）
 *   1 日本語が語の途中で折り返されていない
 *   2 カードの中に、意味のない大きな空白が無い
 *   3 大きく見せる数字が、等幅の数字で組まれている
 *   4 ボタンの文字が2行に割れていない
 *   5 スマホ下部の固定バーに、本文が隠れていない
 *   6 お客様画面が「まだガチャがありません」で止まっていない
 *   7 横スクロールが出ていない／列が細く潰れていない
 *   ＋ コンソールエラーが0件
 *
 * ★使い方
 *   npm run build && npm start   （別の窓で立ち上げておく）
 *   node scripts/check-design.mjs [URL]
 *
 * ★Playwright はこのプロジェクトの依存に入れていません。
 *   LP本体のビルドを重くしないためです。隣の blog-to-social から借ります。
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIBLING = path.join(HERE, "..", "..", "blog-to-social", "node_modules");

let chromium;
try {
  const req = createRequire(path.join(SIBLING, "index.js"));
  ({ chromium } = req("playwright"));
} catch {
  console.error(
    [
      "",
      "Playwright が見つかりません。見た目の検査はできません。",
      "",
      "  隣の blog-to-social で一度だけ用意してください：",
      "    cd ../blog-to-social && npm install playwright && npx playwright install chromium",
      "",
      "  （このプロジェクト自体には入れていません。LPのビルドを重くしないためです）",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

const URL = process.argv[2] || process.env.DESIGN_URL || "http://localhost:3217/";
const WIDTHS = [375, 390, 430, 768, 1024, 1280, 1440];

/** 語の途中で割れてはいけない言葉。増やすときはここに足す */
const PROTECTED = [
  "オンラインガチャ",
  "管理画面",
  "実還元率",
  "還元率",
  "市場価格",
  "バックテスト",
  "確認する",
  "承認する",
  "販売停止",
  "ラストワン賞",
  "発送依頼",
  "AI GACHA OS",
  "49,800円",
  "94.8%",
  "119.0%",
];

const problems = [];
const note = (n, width, text) =>
  problems.push({ n, width, text });

const browser = await chromium.launch();
const ctx = await browser.newContext();

/*
  本番と同じヘッダには upgrade-insecure-requests が入っている。
  そのまま localhost を測ると CSS が1つも当たらず、結果が全部うそになる
  （実際に一度なった）。検査のあいだだけ外す。
*/
await ctx.route("**/*", async (route) => {
  try {
    const res = await route.fetch();
    const headers = { ...res.headers() };
    delete headers["content-security-policy"];
    delete headers["strict-transport-security"];
    await route.fulfill({ response: res, headers });
  } catch {
    await route.continue().catch(() => {});
  }
});

const consoleErrors = [];
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 90_000 });

  const styled = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)",
  );
  if (!styled) {
    console.error("CSSが当たっていません。計測は無効です。");
    process.exit(2);
  }

  // 遅れて出てくる部分も含めて描かせる
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700);

  const found = await page.evaluate((words) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
    };
    const label = (el) =>
      (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 44);

    /* 1 語の途中改行 —— 文字の並びが2行にまたがっていないか */
    const wrapped = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.nodeValue || "";
      if (!t.trim()) continue;
      const parent = n.parentElement;
      if (!parent || !visible(parent)) continue;
      for (const w of words) {
        let from = 0;
        for (;;) {
          const i = t.indexOf(w, from);
          if (i < 0) break;
          from = i + 1;
          const range = document.createRange();
          range.setStart(n, i);
          range.setEnd(n, i + w.length);
          const tops = new Set(
            [...range.getClientRects()].map((r) => Math.round(r.top)),
          );
          if (tops.size > 1) wrapped.push({ w, ctx: label(parent) });
        }
      }
    }

    /* 3 大きく見せる数字が等幅か */
    const badNums = [];
    for (const el of document.querySelectorAll(".num-lead, .num")) {
      if (!visible(el)) continue;
      const s = getComputedStyle(el);
      const tabular =
        s.fontVariantNumeric.includes("tabular-nums") ||
        s.fontFeatureSettings.includes("tnum");
      if (!tabular) badNums.push(label(el));
    }

    /* 4 ボタンの文字が2行に割れていないか（本物のボタンだけ） */
    const brokenCta = [];
    for (const el of document.querySelectorAll(
      "a[class*='btn-'], button[class*='btn-']",
    )) {
      if (!visible(el)) continue;
      const inner = el.querySelector("span") || el;
      const tops = new Set(
        [...inner.getClientRects()].map((r) => Math.round(r.top)),
      );
      if (tops.size > 1) brokenCta.push(label(el));
    }

    /* 5 固定バーに隠れている本文 */
    const bar = document.querySelector("[data-mobile-cta]");
    const hidden = [];
    if (bar && visible(bar)) {
      const top = bar.getBoundingClientRect().top;
      window.scrollTo(0, document.body.scrollHeight);
      for (const el of document.querySelectorAll("main p, main h2, main h3, main li")) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > top + 4) hidden.push(label(el));
      }
      window.scrollTo(0, 0);
    }

    /* 6 お客様画面が空のまま止まっていないか */
    const customer = document.querySelector("#customer");
    const emptyCustomer =
      !!customer && /まだガチャがありません/.test(customer.textContent || "");

    /*
      文字が実際にどこからどこまで描かれているかを測る。
      ★<p> や <span> の箱を測ってはいけない。
        カードの中には「タグに包まれていない、生の文章」が普通にある。
        箱だけ数えると、その文章が無いことになり、
        「右に200px空いている」という嘘の報告が大量に出る（実際に一度出した）。
    */
    const textEdges = (el) => {
      let left = Infinity;
      let right = -Infinity;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        if (!t.nodeValue.trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(t);
        for (const rect of rg.getClientRects()) {
          if (rect.width < 1) continue;
          left = Math.min(left, rect.left);
          right = Math.max(right, rect.right);
        }
      }
      return { left, right };
    };

    /*
      文字だけでなく「絵」も中身として数える版。空白の判定に使う。
      お客様画面のガチャの絵は写真ではなく、色を塗った四角の重ね合わせでできている。
      文字だけ数えると「カードの右が100px空いている」と誤って報告する。
    */
    const contentRight = (el) => {
      let right = textEdges(el).right;
      for (const c of el.querySelectorAll("*")) {
        if (!visible(c)) continue;
        const s = getComputedStyle(c);
        if (s.position === "absolute" || s.position === "fixed") continue;
        const painted =
          s.backgroundImage !== "none" ||
          (s.backgroundColor !== "rgba(0, 0, 0, 0)" &&
            s.backgroundColor !== "transparent") ||
          parseFloat(s.borderTopWidth) > 0 ||
          ["IMG", "SVG", "CANVAS"].includes(c.tagName);
        if (!painted) continue;
        right = Math.max(right, c.getBoundingClientRect().right);
      }
      return right;
    };

    /* 7 横スクロールと、枠から文字がはみ出している場所 */
    const hscroll =
      document.documentElement.scrollWidth > window.innerWidth + 1;
    const thin = [];
    for (const g of document.querySelectorAll(".grid")) {
      if (!visible(g)) continue;
      const cols = getComputedStyle(g).gridTemplateColumns.split(" ").length;
      if (cols < 2) continue;
      for (const cell of g.children) {
        if (!visible(cell)) continue;
        const cs = getComputedStyle(cell);
        if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
        const r = cell.getBoundingClientRect();
        const padL = parseFloat(cs.paddingLeft);
        const padR = parseFloat(cs.paddingRight);
        const inner = {
          left: r.left + padL + parseFloat(cs.borderLeftWidth),
          right: r.right - padR - parseFloat(cs.borderRightWidth),
        };
        const e = textEdges(cell);
        if (e.right === -Infinity) continue;
        /*
          ★どこまでを「はみ出し」と呼ぶか。
            余白（padding）は、文字を線から離しておくための場所です。
            日本語では行末の「）」「。」「%」が数pxだけ余白側へ出るのが正しい組み方
            （ぶら下げ）で、これは不具合ではありません。
            そこで「余白の半分までなら見逃す」ことにしました。
            ★2px や 6px の決め打ちに戻さないこと。
              その厳しさだと、正しく組めている場所まで毎回23件ほど不合格になり、
              本当のはみ出し（枠から80px出て読めない）が埋もれます。実際に埋もれました。
        */
        const slackR = Math.max(6, padR * 0.5);
        const slackL = Math.max(6, padL * 0.5);
        if (e.right > inner.right + slackR || e.left < inner.left - slackL) {
          thin.push(
            `幅${Math.round(r.width)}pxの枠から文字がはみ出す（${label(cell)}）`,
          );
        }
      }
    }

    /*
      2 カードの中の、意味のない右あき

      ★スマホ幅（500px以下）だけを見ること。
        指摘されたのは「スマホなのに、カードの右半分がずっと空いている」でした。
        原因は、パソコン用の列がスマホにも残っていて、
        中身が入らない場所を場所だけ取っていたことです。

        パソコン幅で同じ物差しを当ててはいけません。
        横に広いカードに、箇条書きのような短い行が並ぶのは正しい形です。
        （実際に当てたところ、「・想定売上と想定原価」のような正しい箇条書きが
          20件も不合格になり、本当の問題が埋もれました）
    */
    const dead = [];
    const vw = window.innerWidth;
    for (const el of vw > 500 ? [] : document.querySelectorAll(
      "[class*='rounded-2xl'], [class*='rounded-3xl']",
    )) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 200) continue;
      // 文字が少ない札やバッジは、右が空いていて当たり前
      if ((el.textContent || "").trim().length < 24) continue;
      const cs = getComputedStyle(el);
      const innerRight = r.right - parseFloat(cs.paddingRight);
      /*
        ★textEdges ではなく contentRight で測ること。
          カードの中身は文字だけではありません。お客様画面のガチャの絵は
          写真ではなく、色を塗った四角の重ね合わせでできています。
          文字だけ数えると「右が100px空いている」という嘘の報告が出ます（実際に出しました）。
      */
      const right = contentRight(el);
      if (right === -Infinity) continue;
      const gap = innerRight - right;
      if (gap > 80 && gap / r.width > 0.3) {
        dead.push(`${Math.round(gap)}px ${label(el)}`);
      }
    }

    return { wrapped, badNums, brokenCta, hidden, emptyCustomer, hscroll, thin, dead };
  }, PROTECTED);

  for (const x of found.wrapped) note(1, width, `「${x.w}」が途中で折れた（${x.ctx}）`);
  for (const x of found.dead) note(2, width, `カード内の大きな空白 ${x}`);
  for (const x of found.badNums) note(3, width, `数字が等幅で組まれていない（${x}）`);
  for (const x of found.brokenCta) note(4, width, `ボタンの文字が2行（${x}）`);
  for (const x of found.hidden) note(5, width, `固定バーに隠れた本文（${x}）`);
  if (found.emptyCustomer) note(6, width, "お客様画面が「まだガチャがありません」のまま");
  if (found.hscroll) note(7, width, "横スクロールが出ている");
  for (const x of found.thin) note(7, width, x);
}

await page.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();

/* ── 結果 ── */
const TITLES = {
  1: "日本語の途中改行",
  2: "意味のない空白",
  3: "数字の見にくさ",
  4: "ボタンの途中改行",
  5: "固定バーに隠れた本文",
  6: "お客様画面の空表示",
  7: "はみ出し・列の潰れ",
};

console.log(`\nDESIGN QA  ${URL}`);
console.log(`検査した画面幅: ${WIDTHS.join(" / ")}px\n`);

let ng = 0;
for (const n of [1, 2, 3, 4, 5, 6, 7]) {
  const hits = problems.filter((p) => p.n === n);
  if (hits.length === 0) {
    console.log(`  OK  ${n}. ${TITLES[n]}  0件`);
    continue;
  }
  ng += 1;
  console.log(`  NG  ${n}. ${TITLES[n]}  ${hits.length}件`);
  for (const h of hits.slice(0, 6)) console.log(`        ${h.width}px  ${h.text}`);
  if (hits.length > 6) console.log(`        …ほか ${hits.length - 6}件`);
}

if (consoleErrors.length === 0) {
  console.log("  OK  コンソールエラー  0件");
} else {
  ng += 1;
  console.log(`  NG  コンソールエラー  ${consoleErrors.length}件`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`        ${e}`);
}

console.log("");
if (ng > 0) {
  console.log(`${ng}種類の問題が残っています。直してからもう一度実行してください。\n`);
  process.exit(1);
}
console.log("見た目の検査はすべて通りました。\n");
