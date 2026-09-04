/**
 * 「タグが読み込まれる前に起きた成果」が消えないことの試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験が要るのか（実際に起きた事故）
 * ═══════════════════════════════════════════════════════
 *
 *   本番のデモ画面で、成果が1件も送られていませんでした。
 *
 *   理由は、順番です。
 *     ・計測タグは「画面が動き出したあと」に読み込まれる
 *     ・デモ画面は「開いた瞬間」に成果を送る
 *   送るほうが先に来るので、送り先がまだ存在しません。
 *
 *   ★このとき、エラーは1つも出ません。
 *     画面はいつもどおり動きます。デモも普通に触れます。
 *     広告の管理画面に「0件」と出るだけです。
 *     そして「0件」を見た人は、効いていた広告を止めます。
 *
 *   ですので、ここは「送れなかったら、ためておいて、
 *   読み込みが終わってから送り直す」ようにしてあります。
 *   その仕組みが生きているかを、毎回ここで確かめます。
 */

/* ★import より先に設定すること。
     config/ads.ts は、読み込まれた瞬間に環境変数を読みます。 */
process.env.NEXT_PUBLIC_GA4_ID = "G-TESTONLY";
process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "AW-TESTONLY";
process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_CONTACT = "LABEL_CONTACT_TEST";
process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_DEMO = "LABEL_DEMO_TEST";
process.env.NEXT_PUBLIC_META_PIXEL_ID = "";
process.env.NEXT_PUBLIC_X_PIXEL_ID = "";

import test from "node:test";
import assert from "node:assert/strict";

/** ブラウザの代わり（まだ計測タグは1つも読み込まれていない状態） */
const sent: unknown[][] = [];

function installWindow() {
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener() {
      /* 「読み込み完了」の合図は、この試験では鳴らさない。
         タイマーだけで拾えることを確かめたいため。 */
    },
    location: { search: "", href: "https://example.test/demo" },
  };
}

/** 計測タグが「あとから」読み込まれた状態にする */
function loadGtag() {
  (globalThis as unknown as { window: Record<string, unknown> }).window.gtag = (
    ...args: unknown[]
  ) => {
    sent.push(args);
  };
}

/** 計測タグが「まだ無い」状態に戻す */
function unloadGtag() {
  delete (globalThis as unknown as { window: Record<string, unknown> }).window
    .gtag;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

installWindow();

/* ★ここで初めて読み込むこと（上の環境変数と window を用意したあと）。
     ふつうの import で書くと、ファイルの先頭に巻き上げられて、
     環境変数を設定する前に読み込まれてしまいます。 */
const { track, EV } = require("../lib/track") as typeof import("../lib/track");

test("タグ読み込み前のデモ開始が、あとから必ず届く（本番で消えていた事故）", async () => {
  /* まだタグが無い状態で、デモ画面が開かれた */
  track(EV.demoStart, { presentation: false });

  assert.equal(
    sent.length,
    0,
    "タグが無いのに送れてしまっています。試験の前提が壊れています。",
  );

  /* ここで、ようやくタグが読み込まれた */
  loadGtag();
  await sleep(600);

  const names = sent.map((a) => `${a[0]}:${a[1]}`);
  assert.ok(
    names.includes("event:demo_start"),
    "デモ開始が消えました。タグ読み込み前の出来事が捨てられています。" +
      ` 実際に送られたもの: ${JSON.stringify(names)}`,
  );

  /* ★本題はここ。広告側に「成果」として届いているか。 */
  const conv = sent.find((a) => a[0] === "event" && a[1] === "conversion");
  assert.ok(conv, "広告側への成果が送られていません。広告は何も学習できません。");
  assert.deepEqual((conv as unknown[])[2], {
    send_to: "AW-TESTONLY/LABEL_DEMO_TEST",
  });
});

test("ためた分は、起きた順番どおりに送られる", async () => {
  sent.length = 0;
  unloadGtag();

  track(EV.pricingView);
  track(EV.ctaClick);

  assert.equal(sent.length, 0);

  loadGtag();
  await sleep(600);

  const names = sent.map((a) => a[1]);
  assert.deepEqual(
    names,
    ["pricing_view", "cta_click"],
    "順番が入れ替わっています。あとから見たときに、行動の流れが読めなくなります。",
  );
});

test("タグが来ないまま溜め続けない（ためられる数に上限がある）", async () => {
  sent.length = 0;
  unloadGtag();

  /* 上限は50件。それを超えて押された分は捨てる。
     ★捨てないと、タグを入れていない環境で永久に増え続けます。 */
  for (let i = 0; i < 80; i += 1) track(EV.shockUse, { i });

  loadGtag();
  await sleep(600);

  assert.equal(
    sent.length,
    50,
    `ためられる数の上限が効いていません（${sent.length}件）。`,
  );
});

test("タグが読み込み済みなら、待たずにその場で送る", async () => {
  sent.length = 0;
  loadGtag();

  track(EV.contactSubmit);

  const names = sent.map((a) => `${a[0]}:${a[1]}`);
  assert.ok(
    names.includes("event:contact_submit"),
    "読み込み済みなのに、その場で送られていません。",
  );

  const conv = sent.find((a) => a[0] === "event" && a[1] === "conversion");
  assert.ok(conv, "相談完了が広告側へ届いていません。");
  assert.deepEqual((conv as unknown[])[2], {
    send_to: "AW-TESTONLY/LABEL_CONTACT_TEST",
  });
});

test("同じ成果は、広告側へ2回送らない（二度押しで単価が半分に見える事故）", async () => {
  sent.length = 0;

  track(EV.contactSubmit);

  const convs = sent.filter((a) => a[0] === "event" && a[1] === "conversion");
  assert.equal(
    convs.length,
    0,
    "同じ成果を2回送っています。広告の単価が実際の半分に見え、損をします。",
  );
});
