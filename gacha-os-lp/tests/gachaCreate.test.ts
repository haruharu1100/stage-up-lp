/**
 * ガチャの新規作成（下書き登録）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が生まれた理由（2026-09-04 の実測）
 * ═══════════════════════════════════════════════════════
 *
 *   AIガチャ作成の「この案を下書きとして登録する」は、
 *   押すと緑色で「下書きに登録しました」と出ていました。
 *
 *   ですが、サーバーへは何も送っていませんでした。
 *   登録番号も、画面の中で `g_${201 + 本数}` と組み立てた
 *   ただの文字列でした。
 *
 *   つまり、画面だけが「保存できた」と言っていて、
 *   実際には1本も保存されていませんでした。
 *   お客様が画面を開き直すと、作ったガチャは消えていました。
 *
 *   ★この壊れ方は、画面を見ているかぎり絶対に気づけません。
 *     成功と書いてあるからです。
 *     だからここで、DBに本当に行があることまで確かめます。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守るもの
 * ═══════════════════════════════════════════════════════
 *
 *   ① 「登録した」と言ったら、DBに本当に行があること
 *   ② 作った直後は必ず DRAFT で、検証結果は空であること
 *      （作った時点で SAFE を入れると、検証を飛ばして公開できます）
 *   ③ 賞の在庫が、指定したとおりに1件ずつ入ること
 *   ④ 同じ名前は2本作れないこと（通信のやり直しで二重登録される）
 *   ⑤ 名前が空・数字がおかしい場合は、作らずに断ること
 *   ⑥ 監査ログに、誰が何を作ったかが残ること
 *   ⑦ 画面のソースに、IDを自分で組み立てる書き方が復活していないこと
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, resetDbForTests } from "../lib/server/db";
import { createTenant } from "../lib/server/seed";
import {
  GachaAdminError,
  createGachaDraft,
  gachaDetail,
  publishGacha,
} from "../lib/server/gachaAdmin";

after(async () => {
  await resetDbForTests();
});

const BY = { adminId: "adm_test", name: "試験の人", role: "SUPER_ADMIN" };

/** ふつうに通る、まともな中身 */
const SPEC = {
  name: "見本",
  price: 500,
  total: 1000,
  prizes: [
    { grade: "S", name: "S賞 特典", value: 61800, count: 1 },
    { grade: "A", name: "A賞 特典", value: 5500, count: 12 },
    { grade: "B", name: "B賞 特典", value: 2300, count: 40 },
    { grade: "C", name: "C賞 特典", value: 1000, count: 120 },
    { grade: "D", name: "D賞 特典", value: 163, count: 827 },
  ],
};

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
   ① 登録したら、DBに本当に行がある
   ══════════════════════════════════════════════ */

test("★「登録した」と言ったら、DBに本当に行があること", async () => {
  const t = await createTenant({ code: `NC${Date.now() % 100000}`, name: "新規作成社" });

  const r = await createGachaDraft({
    tenantId: t,
    title: "新しいガチャ",
    spec: { ...SPEC, name: "新しいガチャ" },
    by: BY,
  });

  assert.ok(r.gachaId.length > 0, "登録番号が返ってきていません");

  /* ★ここが本題。画面の言葉ではなく、DBを見る */
  const row = await db().execute({
    sql: `SELECT id, title, status, price, total, left_count, backtest_verdict
            FROM gachas WHERE tenant_id = ? AND id = ?`,
    args: [t, r.gachaId],
  });
  assert.equal(
    row.rows.length,
    1,
    "「登録しました」と返したのに、DBに1行もありません。画面だけが成功と言っています",
  );

  const g = row.rows[0] as Record<string, unknown>;
  assert.equal(String(g.title), "新しいガチャ", "名前が保存されていません");
  assert.equal(Number(g.price), 500, "料金が保存されていません");
  assert.equal(Number(g.total), 1000, "口数が保存されていません");
  assert.equal(
    Number(g.left_count),
    1000,
    "残り口数が総口数と一致していません。作った直後は1本も売れていません",
  );
});

/* ══════════════════════════════════════════════
   ② 作った直後は DRAFT で、検証結果は空
   ══════════════════════════════════════════════ */

test("★作った直後は必ず DRAFT で、検証結果は空であること", async () => {
  const t = await createTenant({ code: `ND${Date.now() % 100000}`, name: "下書き社" });

  const r = await createGachaDraft({
    tenantId: t, title: "下書きのまま", spec: { ...SPEC, name: "下書きのまま" }, by: BY,
  });

  const row = await db().execute({
    sql: `SELECT status, backtest_verdict, backtest_at, published_at
            FROM gachas WHERE id = ?`,
    args: [r.gachaId],
  });
  const g = row.rows[0] as Record<string, unknown>;

  assert.equal(
    String(g.status),
    "DRAFT",
    "作った直後に公開されています。作成と公開は必ず別の操作にすること",
  );
  assert.equal(
    g.backtest_verdict ?? null,
    null,
    "作っただけで検証結果が入っています。これを入れると、検証を飛ばして公開できてしまいます",
  );
  assert.equal(g.backtest_at ?? null, null, "検証していないのに検証日時が入っています");
  assert.equal(g.published_at ?? null, null, "作っただけで公開日時が入っています");

  /* ★念のため、この状態で公開しようとしたら断られること */
  const code = await codeOf(() =>
    publishGacha({ tenantId: t, gachaId: r.gachaId, reason: "作ったばかりですが出したい", by: BY }),
  );
  assert.equal(
    code,
    "NOT_VERIFIED",
    "作った直後のガチャが、検証なしで公開できてしまいました",
  );
});

/* ══════════════════════════════════════════════
   ③ 賞の在庫が、指定どおりに入る
   ══════════════════════════════════════════════ */

test("★賞の在庫が、指定したとおりに1件ずつ入ること", async () => {
  const t = await createTenant({ code: `NE${Date.now() % 100000}`, name: "在庫社" });

  const r = await createGachaDraft({
    tenantId: t, title: "在庫つき", spec: { ...SPEC, name: "在庫つき" }, by: BY,
  });

  const d = await gachaDetail(t, r.gachaId, "SUPER_ADMIN");
  assert.ok(d, "作ったガチャの中身が読めません");

  assert.equal(
    d!.stock.length,
    SPEC.prizes.length,
    `賞の種類が ${SPEC.prizes.length} 件のはずが ${d!.stock.length} 件です`,
  );

  const zaiko = d!.stock;
  for (const p of SPEC.prizes) {
    const s = zaiko.find((x) => x.grade === p.grade);
    if (!s) {
      assert.fail(`${p.grade}賞 が在庫に入っていません`);
      return;
    }
    assert.equal(s.total, p.count, `${p.grade}賞 の本数が違います`);
    assert.equal(s.value, p.value, `${p.grade}賞 の金額が違います`);
    assert.equal(s.drawn, 0, `${p.grade}賞 が、作った直後なのに引かれたことになっています`);
    assert.equal(s.left, p.count, `${p.grade}賞 の残り本数が違います`);
  }

  /* 本数の合計が、総口数と合っていること */
  const goukei = d!.stock.reduce((n, x) => n + x.total, 0);
  assert.equal(goukei, SPEC.total, "賞の本数の合計が、総口数と合っていません");
});

/* ══════════════════════════════════════════════
   ④ 同じ名前は2本作れない
   ══════════════════════════════════════════════ */

test("★同じ名前のガチャは、2本作れないこと", async () => {
  const t = await createTenant({ code: `NF${Date.now() % 100000}`, name: "重複社" });

  await createGachaDraft({
    tenantId: t, title: "同じ名前", spec: { ...SPEC, name: "同じ名前" }, by: BY,
  });

  const code = await codeOf(() =>
    createGachaDraft({
      tenantId: t, title: "同じ名前", spec: { ...SPEC, name: "同じ名前" }, by: BY,
    }),
  );
  assert.equal(
    code,
    "DUP_TITLE",
    "同じ名前で2本目が作れてしまいました。通信のやり直しで二重に登録されます",
  );

  /* 前後に空白が付いただけ・大文字小文字違いも、同じ名前として断ること */
  const code2 = await codeOf(() =>
    createGachaDraft({
      tenantId: t, title: "  同じ名前  ", spec: { ...SPEC, name: "同じ名前" }, by: BY,
    }),
  );
  assert.equal(code2, "DUP_TITLE", "前後に空白を足すと、同じ名前で2本作れてしまいます");

  const n = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM gachas WHERE tenant_id = ?`,
    args: [t],
  });
  assert.equal(
    Number((n.rows[0] as Record<string, unknown>).n),
    1,
    "断ったはずなのに、DBには2本以上あります",
  );
});

test("★別の会社なら、同じ名前でも作れること", async () => {
  const a = await createTenant({ code: `NG${Date.now() % 100000}`, name: "A社" });
  const b = await createTenant({ code: `NH${Date.now() % 100000}`, name: "B社" });

  await createGachaDraft({ tenantId: a, title: "定番ガチャ", spec: { ...SPEC, name: "定番ガチャ" }, by: BY });
  const r = await createGachaDraft({ tenantId: b, title: "定番ガチャ", spec: { ...SPEC, name: "定番ガチャ" }, by: BY });

  assert.ok(
    r.gachaId.length > 0,
    "別の会社なのに、名前が同じというだけで作れませんでした",
  );
});

/* ══════════════════════════════════════════════
   ⑤ おかしい中身は、作らずに断る
   ══════════════════════════════════════════════ */

test("★名前が空・数字がおかしいときは、作らずに断ること", async () => {
  const t = await createTenant({ code: `NI${Date.now() % 100000}`, name: "検査社" });

  assert.equal(
    await codeOf(() => createGachaDraft({ tenantId: t, title: "   ", spec: SPEC, by: BY })),
    "NO_TITLE",
    "名前が空でも作れてしまいました",
  );

  assert.equal(
    await codeOf(() =>
      createGachaDraft({ tenantId: t, title: "あ".repeat(61), spec: SPEC, by: BY }),
    ),
    "NO_TITLE",
    "名前が長すぎても作れてしまいました",
  );

  assert.equal(
    await codeOf(() =>
      createGachaDraft({
        tenantId: t, title: "賞が空",
        spec: { ...SPEC, name: "賞が空", prizes: [] }, by: BY,
      }),
    ),
    "BAD_SPEC",
    "賞が1件も無いのに作れてしまいました",
  );

  /* 同じ記号の賞が2つある */
  assert.equal(
    await codeOf(() =>
      createGachaDraft({
        tenantId: t, title: "記号がだぶる",
        spec: {
          ...SPEC, name: "記号がだぶる",
          prizes: [
            { grade: "S", name: "S1", value: 100, count: 500 },
            { grade: "S", name: "S2", value: 100, count: 500 },
          ],
        }, by: BY,
      }),
    ),
    "BAD_SPEC",
    "同じ記号の賞が2つあるのに作れてしまいました",
  );

  /* 断ったあと、1本も残っていないこと */
  const n = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM gachas WHERE tenant_id = ?`,
    args: [t],
  });
  assert.equal(
    Number((n.rows[0] as Record<string, unknown>).n),
    0,
    "断ったはずなのに、DBに行が作られています。途中まで書いて止めています",
  );
});

/* ══════════════════════════════════════════════
   ⑥ 監査ログに残る
   ══════════════════════════════════════════════ */

test("★誰が何を作ったかが、監査ログに残ること", async () => {
  const t = await createTenant({ code: `NJ${Date.now() % 100000}`, name: "記録社" });

  const r = await createGachaDraft({
    tenantId: t, title: "記録される", spec: { ...SPEC, name: "記録される" }, by: BY,
  });

  const a = await db().execute({
    sql: `SELECT action, summary, after_text FROM audit_events
           WHERE tenant_id = ? AND target = ?`,
    args: [t, `gacha:${r.gachaId}`],
  });
  assert.equal(a.rows.length, 1, "作った記録が監査ログに残っていません");

  const row = a.rows[0] as Record<string, unknown>;
  assert.equal(String(row.action), "GACHA_CREATE", "記録の種類が違います");
  assert.equal(
    String(row.after_text),
    "DRAFT",
    "監査ログの状態が DRAFT になっていません",
  );
  assert.ok(
    String(row.summary).includes("記録される"),
    "監査ログに、どのガチャのことか書かれていません",
  );
  assert.ok(
    String(row.summary).includes("未検証"),
    "監査ログに「まだ検証していない」ことが書かれていません",
  );
});

/* ══════════════════════════════════════════════
   ⑦ 画面のソースに、昔の書き方が復活していないこと
   ══════════════════════════════════════════════ */

test("★AIガチャ作成の画面が、登録番号を自分で組み立てていないこと", () => {
  const src = readFileSync(
    join(process.cwd(), "components/console/screens/Builder.tsx"),
    "utf8",
  );

  /* 昔の書き方： `g_${201 + before}` のように、画面の中でIDを作っていた */
  assert.equal(
    /g_\$\{/.test(src),
    false,
    "画面の中で登録番号を組み立てています。IDはサーバーが返したものだけを使うこと",
  );

  assert.ok(
    src.includes("createGachaDraft"),
    "画面がサーバーへ登録を送っていません。押しても保存されません",
  );

  /* 送る前に「登録しました」と書いていないこと＝サーバーの返事を待つこと */
  assert.ok(
    src.includes("setSavedId(r.gachaId)"),
    "サーバーが返した登録番号を使っていません",
  );
});

test("★お客様画面の確認が、見本データを見ていないこと", () => {
  const raw = readFileSync(
    join(process.cwd(), "components/console/screens/PreviewScreen.tsx"),
    "utf8",
  );
  /* ★説明文（コメント）には、昔の書き方がなぜ駄目だったかを書いてあります。
       そこを数えないように、コメントを取り除いてから調べること。 */
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  /* 昔の書き方：見本データ（s.gachas）と、その場で作る賞の内容（poolOf） */
  assert.equal(
    src.includes("s.gachas"),
    false,
    "お客様画面の確認が、見本データのガチャを見ています。公開前の下見になりません",
  );
  assert.equal(
    src.includes("poolOf"),
    false,
    "賞の内容を計算式で作っています。本物の在庫と関係のない数字が出ます",
  );

  assert.ok(
    src.includes("useGachaList") && src.includes("useGachaDetail"),
    "お客様画面の確認が、保存されている本物のガチャを読んでいません",
  );
});
