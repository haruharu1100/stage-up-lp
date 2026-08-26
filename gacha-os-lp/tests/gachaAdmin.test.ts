/**
 * ガチャ管理（一覧・詳細・検証・公開・停止・再開）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   ① 検証していないガチャは、公開できない
 *      「危ないかもしれないが、とりあえず出す」を、
 *      人の注意力ではなく、仕組みで止めます。
 *
 *   ② 検証したあとに構成を変えたら、その判定はもう使えない
 *      賞の本数や値段を変えたあとの「安全」は、
 *      いまのガチャについて何も言っていません。
 *
 *   ③ 「まだ検証していない」を「安全」と読ませない
 *      null を SAFE に丸めた瞬間、この仕組みは意味を失います。
 *
 *   ④ 売上は、見せてよい人にだけ入る（見せられない人は null。0 にしない）
 *
 *   ⑤ 公開日時は、はじめて公開したときだけ書く
 *      止めて再開するたびに上書きすると、
 *      「いつから売っていたか」が消えます。
 *      返金や問い合わせで、いちばん最初に聞かれるのがそこです。
 *
 *   ⑥ 他社のガチャは、IDを知っていても見つからない・動かせない
 *
 *   ⑦ 全部の操作が、理由つきで監査ログに残る
 *
 *   ⑧ 還元率をこのファイルで計算し直さない
 *      rtpMonitor が出した数字と、一覧に出る数字が同じであること。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
/* ★画面のソースを、そのまま読んで確かめるために使う */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, resetDbForTests, migrate } from "../lib/server/db";
import { createTenant, createGacha } from "../lib/server/seed";
import {
  GachaAdminError,
  gachaDetail,
  gachaList,
  pauseGacha,
  publishGacha,
  resumeGacha,
  verifyGacha,
} from "../lib/server/gachaAdmin";
import { rtpReport } from "../lib/server/rtpMonitor";

after(async () => {
  await resetDbForTests();
});

const BY = { adminId: "adm_test", name: "試験の人", role: "SUPER_ADMIN" };

/** そのテナントで、監査ログの件数を種類ごとに数える */
async function auditCount(tenantId: string, action: string) {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id = ? AND action = ?`,
    args: [tenantId, action],
  });
  return Number((r.rows[0] as Record<string, unknown>).n ?? 0);
}

/** 投げられた失敗の code を取り出す */
async function codeOf(f: () => Promise<unknown>): Promise<string> {
  try {
    await f();
  } catch (e) {
    if (e instanceof GachaAdminError) return e.code;
    return `別の失敗：${(e as Error).message}`;
  }
  return "（失敗しませんでした）";
}

/* ══════════════════════════════════════════════
   ① 検証していないガチャは公開できない
   ══════════════════════════════════════════════ */

test("★検証していないガチャは、公開できない", async () => {
  const t = await createTenant({ code: `GA${Date.now() % 100000}`, name: "ガチャ社" });
  const g = await createGacha({
    tenantId: t, title: "未検証ガチャ", price: 500, total: 300,
    designedRtp: 90, status: "DRAFT",
  });

  const code = await codeOf(() =>
    publishGacha({ tenantId: t, gachaId: g, reason: "売りたいから", by: BY }),
  );
  assert.equal(
    code,
    "NOT_VERIFIED",
    "検証していないのに公開できてしまいました。ここは仕組みで止める場所です",
  );

  /* 状態が変わっていないこと。断ったのに書き換わっていたら、断った意味がない */
  const r = await db().execute({
    sql: `SELECT status, published_at FROM gachas WHERE id = ?`,
    args: [g],
  });
  const row = r.rows[0] as Record<string, unknown>;
  assert.equal(String(row.status), "DRAFT", "断ったのに状態が変わっています");
  assert.equal(row.published_at ?? null, null, "断ったのに公開日時が入っています");
});

test("★検証してから公開すると、通る", async () => {
  const t = await createTenant({ code: `GB${Date.now() % 100000}`, name: "ガチャ社B" });
  const g = await createGacha({
    tenantId: t, title: "検証済みガチャ", price: 500, total: 300,
    designedRtp: 90, status: "DRAFT",
  });

  const v = await verifyGacha({ tenantId: t, gachaId: g, by: BY });
  assert.ok(
    v.verdict === "SAFE" || v.verdict === "CAUTION" || v.verdict === "DANGER",
    "検証の判定が3種類のどれでもありません",
  );
  assert.equal(v.engine.length > 0, true, "どの道具で検証したかが残っていません");

  if (v.verdict === "DANGER") {
    /* この構成では公開できないのが正しい。そのことを確かめて終える */
    const code = await codeOf(() =>
      publishGacha({ tenantId: t, gachaId: g, reason: "販売開始のため", by: BY }),
    );
    assert.equal(code, "VERDICT_DANGER", "危険なのに公開できてしまいました");
    return;
  }

  const p = await publishGacha({
    tenantId: t, gachaId: g, reason: "販売開始のため", by: BY,
  });
  assert.equal(p.after, "PUBLISHED");

  const r = await db().execute({
    sql: `SELECT status, published_at FROM gachas WHERE id = ?`,
    args: [g],
  });
  const row = r.rows[0] as Record<string, unknown>;
  assert.equal(String(row.status), "PUBLISHED");
  assert.ok(row.published_at, "公開したのに、公開日時が残っていません");
});

/* ══════════════════════════════════════════════
   ② 構成を変えたら、前の判定は使えない
   ══════════════════════════════════════════════ */

test("★検証したあとに賞の構成を変えると、その判定は使えなくなる", async () => {
  const t = await createTenant({ code: `GC${Date.now() % 100000}`, name: "ガチャ社C" });
  const g = await createGacha({
    tenantId: t, title: "構成を変えるガチャ", price: 500, total: 300,
    designedRtp: 90, status: "DRAFT",
  });

  await verifyGacha({ tenantId: t, gachaId: g, by: BY });

  /* 賞の値段を上げる＝還元率が変わる。前の判定は、この構成の話ではない */
  await db().execute({
    sql: `UPDATE gacha_stock SET value = value * 3 WHERE tenant_id = ? AND gacha_id = ?`,
    args: [t, g],
  });

  const { rows } = await gachaList(t, "SUPER_ADMIN");
  const me = rows.find((x) => x.id === g)!;
  assert.equal(
    me.backtest.ran,
    false,
    "構成を変えたのに、前の判定がそのまま残っています",
  );
  if (!me.backtest.ran) {
    assert.equal(me.backtest.reason, "SPEC_CHANGED");
  }

  const code = await codeOf(() =>
    publishGacha({ tenantId: t, gachaId: g, reason: "販売開始のため", by: BY }),
  );
  assert.equal(
    code,
    "SPEC_CHANGED",
    "構成を変えたあとなのに、古い判定で公開できてしまいました",
  );
});

/* ══════════════════════════════════════════════
   ③ 「まだ検証していない」を「安全」と読ませない
   ══════════════════════════════════════════════ */

test("★まだ検証していないガチャの判定は、SAFE ではなく「していない」と返る", async () => {
  const t = await createTenant({ code: `GD${Date.now() % 100000}`, name: "ガチャ社D" });
  await createGacha({
    tenantId: t, title: "手つかずガチャ", price: 300, total: 100,
    designedRtp: 85, status: "DRAFT",
  });

  const { rows } = await gachaList(t, "SUPER_ADMIN");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].backtest.ran, false, "検証していないのに、判定が入っています");
  if (!rows[0].backtest.ran) {
    assert.equal(rows[0].backtest.reason, "NEVER");
    assert.ok(
      rows[0].backtest.message.length > 0,
      "なぜ公開できないのかが、日本語で書かれていません",
    );
  }
});

test("★景品が1本も無いガチャは、検証そのものを断る（計算上は必ず安全に見えるため）", async () => {
  const t = await createTenant({ code: `GE${Date.now() % 100000}`, name: "ガチャ社E" });
  const g = await createGacha({
    tenantId: t, title: "空っぽガチャ", price: 300, total: 100,
    designedRtp: 85, status: "DRAFT",
  });
  await db().execute({
    sql: `DELETE FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ?`,
    args: [t, g],
  });

  const code = await codeOf(() => verifyGacha({ tenantId: t, gachaId: g, by: BY }));
  assert.equal(
    code,
    "NO_SPEC",
    "景品が0本でも検証が通ってしまいました。売上がそのまま粗利になるので、必ず『安全』に見えます",
  );
});

/* ══════════════════════════════════════════════
   ④ 売上は、見せてよい人にだけ
   ══════════════════════════════════════════════ */

test("★閲覧のみの担当者に、ガチャの売上を見せない（0 ではなく null）", async () => {
  const t = await createTenant({ code: `GF${Date.now() % 100000}`, name: "ガチャ社F" });
  const g = await createGacha({
    tenantId: t, title: "売れているガチャ", price: 500, total: 300, designedRtp: 90,
  });
  await db().execute({
    sql: `UPDATE gachas SET revenue = 123456 WHERE id = ?`,
    args: [g],
  });

  const viewer = await gachaList(t, "VIEWER");
  assert.equal(viewer.canSeeRevenue, false);
  assert.equal(
    viewer.rows[0].revenue,
    null,
    "閲覧のみの担当者に売上が見えています",
  );
  /* ★ここが肝心。null であって 0 ではないこと。
       0 だと画面は「1円も売れていない」と読みます */
  assert.notEqual(viewer.rows[0].revenue, 0, "見せられない売上を 0 で返しています");

  const finance = await gachaList(t, "FINANCE");
  assert.equal(finance.canSeeRevenue, true);
  assert.equal(finance.rows[0].revenue, 123456, "経理に売上が見えていません");

  /* 売上が見えなくても、ガチャそのものは見えること */
  assert.equal(viewer.rows[0].title, "売れているガチャ");
  assert.equal(viewer.rows[0].leftCount, 300);
});

/* ══════════════════════════════════════════════
   ⑤ 公開日時は、はじめて公開したときだけ
   ══════════════════════════════════════════════ */

test("★止めて再開しても、はじめて公開した日時が上書きされない", async () => {
  const t = await createTenant({ code: `GG${Date.now() % 100000}`, name: "ガチャ社G" });
  const g = await createGacha({
    tenantId: t, title: "止めて戻すガチャ", price: 500, total: 300,
    designedRtp: 90, status: "DRAFT",
  });

  const v = await verifyGacha({ tenantId: t, gachaId: g, by: BY });
  if (v.verdict === "DANGER") return; /* この構成では公開できない。それが正しい */

  await publishGacha({ tenantId: t, gachaId: g, reason: "販売開始のため", by: BY });
  const ichi = await db().execute({
    sql: `SELECT published_at FROM gachas WHERE id = ?`,
    args: [g],
  });
  const hajime = String((ichi.rows[0] as Record<string, unknown>).published_at);

  await pauseGacha({
    tenantId: t, gachaId: g, reason: "還元率を確かめるため一時停止", by: BY,
  });
  const tomatta = await db().execute({
    sql: `SELECT status, paused_at, pause_reason FROM gachas WHERE id = ?`,
    args: [g],
  });
  const tr = tomatta.rows[0] as Record<string, unknown>;
  assert.equal(String(tr.status), "PAUSED");
  assert.ok(tr.paused_at, "止めたのに、止めた時刻が残っていません");
  assert.equal(
    String(tr.pause_reason),
    "還元率を確かめるため一時停止",
    "止めた理由が残っていません。あとから読む人が、いちばん知りたいところです",
  );

  await resumeGacha({ tenantId: t, gachaId: g, reason: "確認が終わったため再開", by: BY });
  const ni = await db().execute({
    sql: `SELECT status, published_at, paused_at, pause_reason FROM gachas WHERE id = ?`,
    args: [g],
  });
  const nr = ni.rows[0] as Record<string, unknown>;
  assert.equal(String(nr.status), "PUBLISHED");
  assert.equal(
    String(nr.published_at),
    hajime,
    "再開で公開日時が上書きされました。いつから売っていたかが消えます",
  );
  assert.equal(nr.paused_at ?? null, null, "再開したのに、止めた時刻が残っています");
  assert.equal(nr.pause_reason ?? null, null, "再開したのに、止めた理由が残っています");
});

test("★古いガチャの公開日時を、作った日で埋めない（不明は不明のまま）", async () => {
  const t = await createTenant({ code: `GH${Date.now() % 100000}`, name: "ガチャ社H" });
  /* 移行より前からある「販売中だが公開日時を知らない」ガチャ */
  await createGacha({
    tenantId: t, title: "昔からあるガチャ", price: 500, total: 300,
    designedRtp: 90, status: "PUBLISHED",
  });

  const { rows } = await gachaList(t, "SUPER_ADMIN");
  assert.equal(
    rows[0].publishedAt,
    null,
    "分からない公開日時が、作った日で埋められています。それは記録ではなく作り話です",
  );
});

/* ══════════════════════════════════════════════
   ⑥ 他社のガチャ
   ══════════════════════════════════════════════ */

test("★他社のガチャは、IDを知っていても見つからない・動かせない", async () => {
  const a = await createTenant({ code: `GIA${Date.now() % 10000}`, name: "A社" });
  const b = await createTenant({ code: `GIB${Date.now() % 10000}`, name: "B社" });
  const ga = await createGacha({
    tenantId: a, title: "A社のガチャ", price: 500, total: 300, designedRtp: 90,
  });

  /* 一覧に出ないこと */
  const bList = await gachaList(b, "SUPER_ADMIN");
  assert.equal(bList.rows.length, 0, "B社の一覧に、A社のガチャが出ています");

  /* 詳細も見られないこと */
  assert.equal(
    await gachaDetail(b, ga, "SUPER_ADMIN"),
    null,
    "B社から、A社のガチャの中身が見えています",
  );

  /* 動かせないこと。★「他社のものです」ではなく「見つかりません」で断ること */
  assert.equal(
    await codeOf(() => pauseGacha({ tenantId: b, gachaId: ga, reason: "止めたい", by: BY })),
    "NOT_FOUND",
  );
  assert.equal(
    await codeOf(() => verifyGacha({ tenantId: b, gachaId: ga, by: BY })),
    "NOT_FOUND",
  );

  /* A社のガチャが、実際に無事であること */
  const r = await db().execute({ sql: `SELECT status FROM gachas WHERE id = ?`, args: [ga] });
  assert.equal(String((r.rows[0] as Record<string, unknown>).status), "PUBLISHED");
});

/* ══════════════════════════════════════════════
   ⑦ 理由と監査ログ
   ══════════════════════════════════════════════ */

test("★理由が短すぎると、公開も停止も再開もできない", async () => {
  const t = await createTenant({ code: `GJ${Date.now() % 100000}`, name: "ガチャ社J" });
  const g = await createGacha({
    tenantId: t, title: "理由のいるガチャ", price: 500, total: 300,
    designedRtp: 90, status: "PUBLISHED",
  });

  assert.equal(
    await codeOf(() => pauseGacha({ tenantId: t, gachaId: g, reason: "", by: BY })),
    "NO_REASON",
  );
  assert.equal(
    await codeOf(() => pauseGacha({ tenantId: t, gachaId: g, reason: "  あ  ", by: BY })),
    "NO_REASON",
    "空白を詰めたら短くなる理由が、通ってしまいました",
  );

  /* ★理由を断ったなら、状態が変わっていないこと */
  const r = await db().execute({ sql: `SELECT status FROM gachas WHERE id = ?`, args: [g] });
  assert.equal(String((r.rows[0] as Record<string, unknown>).status), "PUBLISHED");
});

test("★検証・公開・停止・再開が、すべて理由つきで監査ログに残る", async () => {
  const t = await createTenant({ code: `GK${Date.now() % 100000}`, name: "ガチャ社K" });
  const g = await createGacha({
    tenantId: t, title: "記録の残るガチャ", price: 500, total: 300,
    designedRtp: 90, status: "DRAFT",
  });

  const v = await verifyGacha({ tenantId: t, gachaId: g, by: BY });
  assert.equal(await auditCount(t, "BACKTEST_RUN"), 1, "検証が記録に残っていません");
  if (v.verdict === "DANGER") return;

  await publishGacha({ tenantId: t, gachaId: g, reason: "販売開始のため", by: BY });
  await pauseGacha({ tenantId: t, gachaId: g, reason: "在庫の入れ替えのため", by: BY });
  await resumeGacha({ tenantId: t, gachaId: g, reason: "入れ替えが済んだため", by: BY });

  assert.equal(await auditCount(t, "GACHA_PUBLISH"), 1);
  assert.equal(await auditCount(t, "GACHA_PAUSE"), 1);
  assert.equal(
    await auditCount(t, "GACHA_RESUME"),
    1,
    "再開が、公開と同じ名前で記録されています。止めた事実が読み落とされます",
  );

  /* 理由が本当に残っているか */
  const r = await db().execute({
    sql: `SELECT action, reason FROM audit_events
           WHERE tenant_id = ? AND action IN ('GACHA_PUBLISH','GACHA_PAUSE','GACHA_RESUME')
           ORDER BY seq ASC`,
    args: [t],
  });
  for (const row of r.rows as Record<string, unknown>[]) {
    assert.ok(
      String(row.reason ?? "").length >= 4,
      `${String(row.action)} の記録に理由が入っていません`,
    );
  }
});

/* ══════════════════════════════════════════════
   ⑧ 還元率を、画面のために数え直さない
   ══════════════════════════════════════════════ */

test("★一覧に出る還元率が、還元率モニターの数字と1つも違わない", async () => {
  const t = await createTenant({ code: `GL${Date.now() % 100000}`, name: "ガチャ社L" });
  const g = await createGacha({
    tenantId: t, title: "突き合わせるガチャ", price: 500, total: 300, designedRtp: 90,
  });

  const { rows } = await gachaList(t, "SUPER_ADMIN");
  const rep = (await rtpReport({ tenantId: t, gachaId: g }))!;

  assert.deepEqual(rows[0].designed, rep.designed, "設計還元率がずれています");
  assert.deepEqual(rows[0].remaining, rep.remaining, "残数還元率がずれています");
  assert.deepEqual(rows[0].actual, rep.actual, "実績還元率がずれています");
  assert.equal(rows[0].plays, rep.plays, "回数がずれています");
  assert.deepEqual(rows[0].worst, rep.worst, "警告がずれています");
});

/* ══════════════════════════════════════════════
   ⑨ 検索・絞り込み
   ══════════════════════════════════════════════ */

test("★検索と状態の絞り込みが、DBの側で効く", async () => {
  const t = await createTenant({ code: `GM${Date.now() % 100000}`, name: "ガチャ社M" });
  await createGacha({
    tenantId: t, title: "ポケモン夏まつり", price: 500, total: 300,
    designedRtp: 90, status: "PUBLISHED",
  });
  await createGacha({
    tenantId: t, title: "ワンピース秋の陣", price: 500, total: 300,
    designedRtp: 90, status: "PAUSED",
  });
  await createGacha({
    tenantId: t, title: "ポケモン冬まつり", price: 500, total: 300,
    designedRtp: 90, status: "DRAFT",
  });

  const zenbu = await gachaList(t, "SUPER_ADMIN");
  assert.equal(zenbu.total, 3);

  const poke = await gachaList(t, "SUPER_ADMIN", { q: "ポケモン" });
  assert.equal(poke.total, 2, "名前での検索が効いていません");

  const tomatta = await gachaList(t, "SUPER_ADMIN", { status: "PAUSED" });
  assert.equal(tomatta.total, 1, "状態での絞り込みが効いていません");
  assert.equal(tomatta.rows[0].title, "ワンピース秋の陣");

  const nashi = await gachaList(t, "SUPER_ADMIN", { q: "存在しない名前" });
  assert.equal(nashi.total, 0, "見つからないときは0件です");
  assert.equal(nashi.rows.length, 0);
});

/* ══════════════════════════════════════════════
   ⑩ 状態のつじつま
   ══════════════════════════════════════════════ */

test("★販売していないガチャは止められない／完売したガチャは公開しなおせない", async () => {
  const t = await createTenant({ code: `GN${Date.now() % 100000}`, name: "ガチャ社N" });
  const shita = await createGacha({
    tenantId: t, title: "下書きガチャ", price: 500, total: 300,
    designedRtp: 90, status: "DRAFT",
  });
  const kanbai = await createGacha({
    tenantId: t, title: "完売ガチャ", price: 500, total: 300,
    designedRtp: 90, status: "SOLD_OUT",
  });

  assert.equal(
    await codeOf(() => pauseGacha({ tenantId: t, gachaId: shita, reason: "止めたいから", by: BY })),
    "BAD_STATUS",
  );
  assert.equal(
    await codeOf(() => resumeGacha({ tenantId: t, gachaId: shita, reason: "再開したいから", by: BY })),
    "BAD_STATUS",
  );
  assert.equal(
    await codeOf(() => publishGacha({ tenantId: t, gachaId: kanbai, reason: "また売りたいから", by: BY })),
    "BAD_STATUS",
    "完売したガチャを公開しなおせてしまいました。景品はもう箱にありません",
  );
});

/* ══════════════════════════════════════════════
   ⑪ 空のとき
   ══════════════════════════════════════════════ */

test("★ガチャが1本も無い会社は、0件が返る（それらしい見本で埋めない）", async () => {
  await migrate();
  const t = await createTenant({ code: `GO${Date.now() % 100000}`, name: "はじめたばかり社" });
  const r = await gachaList(t, "SUPER_ADMIN");
  assert.equal(r.total, 0);
  assert.equal(r.rows.length, 0);
});

/* ══════════════════════════════════════════════
   ⑫ 画面が、見本ではなくサーバーを見ているか

   ★ここを人の目に任せないこと。
     「本物につないだ」と書いてあっても、
     画面の中に見本の配列が1行残っていれば、
     見えているのはその見本です。
     しかも見た目は本物と区別が付きません。
   ══════════════════════════════════════════════ */

test("★ガチャ管理の画面が、見本データ（s.gachas）を読んでいない", () => {
  const src = readFileSync(
    join(__dirname, "..", "components/console/screens/GachaList.tsx"),
    "utf8",
  );

  assert.ok(
    !/\bs\.gachas\b/.test(src),
    "ガチャ管理の画面が、まだ見本の配列（s.gachas）を読んでいます。" +
      "見本は lib/console/state.ts の DEMO_GACHAS で、DBとは一切つながっていません。",
  );

  assert.ok(
    src.includes("useGachaList"),
    "ガチャ管理の画面が、サーバー（/api/console/gachas）を読んでいません。",
  );

  /* ★操作を、画面の中の控えに対して行わないこと。
       reducer を呼ぶと、画面の中の配列だけが書き換わります。
       見た目は「公開できた」ように見えて、DBは何も変わっていません。 */
  for (const dame of ["PUBLISH_GACHA", "PAUSE_GACHA", "RUN_BACKTEST"]) {
    assert.ok(
      !src.includes(dame),
      `ガチャ管理の画面が、${dame} で画面の中の控えを書き換えています。` +
        "この操作はDBに届きません。/api/console/gachas/action を呼んでください。",
    );
  }
});

test("★売上が見せられないとき、画面が 0円 と書いていない", () => {
  const src = readFileSync(
    join(__dirname, "..", "components/console/screens/GachaList.tsx"),
    "utf8",
  );

  /* ★null を数に変える書き方を、画面に持ち込まないこと。
       Number(null) も (x ?? 0) も、答えは 0 です。
       その1行で「見せられません」が「1円も売れていない」に化けます。 */
  assert.ok(
    !/revenue\s*\?\?\s*0/.test(src),
    "売上の null を 0 に変えています。0円は「売れていない」という意味になります。",
  );
  assert.ok(
    src.includes("見せられません"),
    "売上を見せられない人に、その旨を伝える文言がありません。",
  );
});
