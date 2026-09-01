/**
 * デモ動画の文字が、どの画面幅でも読める大きさで出ているかを実測する。
 *
 * ★なぜ要るのか
 *   動画の中の文字は 1280×800 の絵に焼き込まれています。
 *   LPに置くと、その絵が画面幅に合わせて縮みます。
 *   つまり「動画の中で76pxの見出し」は、
 *   スマホでは20px前後まで小さくなります。
 *   パソコンだけで見て「読める」と判断すると、必ず外します。
 *
 * ★出すもの
 *   幅ごとの
 *     ・動画が実際に何px幅で出ているか
 *     ・縮小率
 *     ・大見出し（動画の中で76px）が画面上で何pxになるか
 *     ・小見出し（同32px）が何pxになるか
 *     ・見出しの折り返し（LP側の文字）と、はみ出しの有無
 *   と、その幅のスクリーンショット。
 *
 *   使い方： node scripts/check-video-widths.mjs
 */

import { chromium } from "../../blog-to-social/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "_verify", "video-widths");
const BASE = process.env.BASE || "http://127.0.0.1:3217";

/* 動画の中の文字の実寸（scripts/record-demo-video.mjs の CSS と合わせること） */
const IN_VIDEO = { 大見出し: 76, 小見出し: 32, 札: 21, 巨大数字: 150 };

/* 読める下限。これを割ったら文字を大きくするか、場面を作り直す */
const FLOOR = { 大見出し: 17, 小見出し: 8.5, 札: 5.5 };

const WIDTHS = [1440, 1280, 1024, 768, 430, 390];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let ng = 0;

for (const w of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() =>
    document.querySelector("#video")?.scrollIntoView({ block: "start" }),
  );
  await page.waitForTimeout(900);

  const m = await page.evaluate(() => {
    const v = document.querySelector("#video video");
    const h = document.querySelector("#video h2");
    const fig = document.querySelector("#video figcaption");
    const r = v.getBoundingClientRect();
    const doc = document.documentElement;
    return {
      vw: Math.round(r.width),
      vh: Math.round(r.height),
      hText: h.innerText.replace(/\n/g, "⏎"),
      hLines: Math.round(
        h.getBoundingClientRect().height /
          parseFloat(getComputedStyle(h).lineHeight),
      ),
      capLen: fig.innerText.length,
      overflow: doc.scrollWidth - doc.clientWidth,
    };
  });

  const scale = m.vw / 1280;
  const px = Object.fromEntries(
    Object.entries(IN_VIDEO).map(([k, v]) => [k, +(v * scale).toFixed(1)]),
  );

  const bad = Object.entries(FLOOR).filter(([k, f]) => px[k] < f);
  if (bad.length || m.overflow > 0) ng++;

  console.log(
    [
      `── ${w}px ──`,
      `  動画の表示幅 ${m.vw}×${m.vh}   縮小率 ${(scale * 100).toFixed(1)}%`,
      `  大見出し ${px.大見出し}px ／ 小見出し ${px.小見出し}px ／ 札 ${px.札}px ／ 巨大数字 ${px.巨大数字}px`,
      `  LP見出し ${m.hLines}行  「${m.hText}」`,
      `  横はみ出し ${m.overflow}px`,
      bad.length
        ? `  ★小さすぎ： ${bad.map(([k, f]) => `${k} ${px[k]} < ${f}`).join(" / ")}`
        : "  読める大きさ： OK",
    ].join("\n"),
  );

  await page
    .locator("#video")
    .screenshot({ path: path.join(OUT, `w${w}.png`) })
    .catch(() => {});
  await ctx.close();
}

await browser.close();
console.log(
  ng === 0
    ? "\n全幅 OK（文字切れ・小さすぎ 0件）"
    : `\n★ ${ng} 件の幅で問題あり`,
);
process.exit(ng === 0 ? 0 : 1);
