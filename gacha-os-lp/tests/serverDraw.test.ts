/**
 * 抽選（運営側で行う本番版）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を確かめる試験なのか
 * ═══════════════════════════════════════════════════════
 *
 *   件数の多い試験を並べることに意味はありません。
 *   「何を確かめたか」が言えないと、通っていても安心できません。
 *   実際、これまで253件の試験が全部通っていた状態で、
 *   抽選結果が予測できる問題と、連打で二重に引ける問題が残っていました。
 *
 *   だからこの試験は、次のことだけを確かめます。
 *
 *     1) 同じ鍵で何回届いても、引かれるのは1回だけ
 *     2) 同時にたくさん届いても、在庫より多く当たらない
 *     3) 同時にたくさん届いても、ポイントが二重に減らない
 *     4) 残数が負にならない
 *     5) ポイントだけ減って結果が無い、が起きない
 *     6) 結果だけ出てポイントが減っていない、が起きない
 *     7) 抽選が必ず監査ログに残り、鎖が壊れていない
 *     8) 同じ設定のガチャでも、出る順番が毎回変わる（種から作っていない）
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db, migrate, resetDbForTests } from "../lib/server/db";
import { drawOnceServer, DrawError } from "../lib/server/draw";
import { verifyAuditOfTenant } from "../lib/server/audit";
import { createTenant, createCustomer, createGacha } from "../lib/server/seed";

/**
 * ★試験が終わったら、必ず接続を閉じること。
 *
 *   閉じずに終わると、DBの部品が後片付けの最中に異常終了することがあります。
 *   そうなると、中の試験は全部「ok」なのに、
 *   まとめだけが「失敗」と表示されます。
 *   原因が試験の中身にあるように見えるので、いちばん時間を取られます。
 */
after(async () => {
  await resetDbForTests();
});

const n = (v: unknown) => Number(v ?? 0);

/** 会社・ガチャ・お客様を1組つくる */
async function setup(opts: {
  total: number;
  price?: number;
  points?: number;
  rtp?: number;
}) {
  await migrate();
  const price = opts.price ?? 500;
  const tenantId = await createTenant({
    code: `t${Math.random().toString(36).slice(2, 8)}`,
    name: "試験用の会社",
  });
  const userId = await createCustomer({
    tenantId,
    no: 1,
    name: "試験 太郎",
    points: opts.points ?? opts.total * price + 100_000,
  });
  const gachaId = await createGacha({
    tenantId,
    title: "試験用ガチャ",
    price,
    total: opts.total,
    designedRtp: opts.rtp ?? 95,
  });
  return { tenantId, userId, gachaId, price };
}

/** その会社のいまの状態を、確かめやすい形でまとめて取る */
async function snapshot(tenantId: string, gachaId: string, userId: string) {
  const c = db();
  const [draws, gacha, cust, ledger, stock, audits] = await Promise.all([
    c.execute({
      sql: `SELECT id, idempotency_key, prize_rank, point_spent, point_returned,
                   remaining_before, remaining_after
              FROM draws WHERE tenant_id = ?`,
      args: [tenantId],
    }),
    c.execute({
      sql: `SELECT left_count, status, revenue FROM gachas WHERE tenant_id = ? AND id = ?`,
      args: [tenantId, gachaId],
    }),
    c.execute({
      sql: `SELECT points, spent FROM customers WHERE tenant_id = ? AND id = ?`,
      args: [tenantId, userId],
    }),
    c.execute({
      sql: `SELECT kind, delta, ref FROM point_ledger WHERE tenant_id = ?`,
      args: [tenantId],
    }),
    c.execute({
      sql: `SELECT grade, total, drawn FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ?`,
      args: [tenantId, gachaId],
    }),
    c.execute({
      sql: `SELECT seq, action, idempotency_key FROM audit_events WHERE tenant_id = ? ORDER BY seq`,
      args: [tenantId],
    }),
  ]);
  return {
    draws: draws.rows as Record<string, unknown>[],
    left: n((gacha.rows[0] as Record<string, unknown>).left_count),
    status: String((gacha.rows[0] as Record<string, unknown>).status),
    revenue: n((gacha.rows[0] as Record<string, unknown>).revenue),
    points: n((cust.rows[0] as Record<string, unknown>).points),
    spent: n((cust.rows[0] as Record<string, unknown>).spent),
    ledger: ledger.rows as Record<string, unknown>[],
    stock: stock.rows as Record<string, unknown>[],
    audits: audits.rows as Record<string, unknown>[],
  };
}

/* ══════════════════════════════════════════════
   1) 二重抽選の防止
   ══════════════════════════════════════════════ */

test("同じ鍵を1000回同時に送っても、引かれるのは1回だけ", async () => {
  const { tenantId, userId, gachaId, price } = await setup({ total: 100 });
  const before = (await snapshot(tenantId, gachaId, userId)).points;

  const key = "同じ購入操作の鍵";
  const results = await Promise.all(
    Array.from({ length: 1000 }, (_, i) =>
      drawOnceServer({
        tenantId,
        userId,
        gachaId,
        idempotencyKey: key,
        requestId: `req-${i}`,
      }),
    ),
  );

  const s = await snapshot(tenantId, gachaId, userId);

  assert.equal(s.draws.length, 1, "抽選の記録は1件だけであること");
  assert.equal(s.left, 99, "残り口数は1つだけ減ること");
  assert.equal(s.points, before - price + n(s.draws[0].point_returned));

  /* 1000件すべてが、同じ結果を受け取っていること */
  const ids = new Set(results.map((r) => r.drawId));
  assert.equal(ids.size, 1, "全員が同じ抽選IDを受け取ること");
  assert.equal(
    results.filter((r) => r.replayed).length,
    999,
    "2件目以降は『前回の結果を返した』であること",
  );

  /* 監査ログにも1件だけ */
  assert.equal(s.audits.filter((a) => a.action === "DRAW").length, 1);
});

test("鍵が違えば、ちゃんと別の抽選として成立する", async () => {
  const { tenantId, userId, gachaId } = await setup({ total: 100 });
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      drawOnceServer({
        tenantId,
        userId,
        gachaId,
        idempotencyKey: `k-${i}`,
        requestId: `r-${i}`,
      }),
    ),
  );
  const s = await snapshot(tenantId, gachaId, userId);
  assert.equal(s.draws.length, 10);
  assert.equal(s.left, 90);
});

/* ══════════════════════════════════════════════
   2) 同時抽選
   ══════════════════════════════════════════════ */

for (const count of [10, 50, 100, 500, 1000]) {
  test(`${count}件を同時に送っても、数字がひとつも壊れない`, async () => {
    const { tenantId, userId, gachaId, price } = await setup({
      total: count,
      points: count * 500 + 1_000_000,
    });
    const before = await snapshot(tenantId, gachaId, userId);

    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        drawOnceServer({
          tenantId,
          userId,
          gachaId,
          idempotencyKey: `key-${i}`,
          requestId: `req-${i}`,
        }),
      ),
    );

    const s = await snapshot(tenantId, gachaId, userId);

    /* ── 二重当選 0 ── 等級ごとに、箱に入っている本数を超えていないこと */
    for (const row of s.stock) {
      assert.ok(
        n(row.drawn) <= n(row.total),
        `${String(row.grade)}賞が箱の本数(${n(row.total)})より多く出ています: ${n(row.drawn)}`,
      );
    }

    /* ── 景品マイナス 0 ── */
    assert.ok(s.left >= 0, "残り口数が負になっていないこと");
    assert.equal(s.left, 0, "口数ぴったりで完売すること");
    assert.equal(s.status, "SOLD_OUT");

    /* ── 二重ポイント消費 0 ── */
    const spends = s.ledger.filter((e) => e.kind === "DRAW_SPEND");
    assert.equal(spends.length, count, "支払いの記録は抽選と同じ件数であること");
    assert.equal(s.spent, count * price);

    /* ── 結果無しでポイントだけ減る 0 ──
         支払いの記録には、必ず対応する抽選がある */
    const drawIds = new Set(s.draws.map((d) => String(d.id)));
    for (const e of spends) {
      assert.ok(drawIds.has(String(e.ref)), "支払いに対応する抽選が無い");
    }

    /* ── ポイント減らず結果だけ出る 0 ──
         抽選には、必ず対応する支払いがある */
    const spendRefs = new Set(spends.map((e) => String(e.ref)));
    for (const d of s.draws) {
      assert.ok(spendRefs.has(String(d.id)), "抽選に対応する支払いが無い");
    }

    /* ── 残高は台帳の合計と一致すること ──

         ★「始める前の残高＋増減」ではなく、「台帳の合計そのもの」と比べます。
           開始時の残高も台帳に1行入っているので、
           台帳を全部足した数が、そのまま今の残高になるはずです。
           これが崩れていたら、どこかで台帳を通さずに残高を書いています。 */
    const delta = s.ledger.reduce((a, e) => a + n(e.delta), 0);
    assert.equal(s.points, delta, "残高と台帳が合っていない");
    assert.equal(
      before.points,
      before.ledger.reduce((a, e) => a + n(e.delta), 0),
      "始める前から、残高と台帳がずれている",
    );

    /* ── 抽選は全部、監査ログに残っていること ── */
    assert.equal(
      s.audits.filter((a) => a.action === "DRAW").length,
      count,
      "監査ログに残っていない抽選がある",
    );

    /* ── 鎖が壊れていないこと ── */
    const v = await verifyAuditOfTenant(db(), tenantId);
    assert.equal(v.ok, true, "監査ログの鎖が壊れている");

    /* ── 抽選IDも鍵も、重複していないこと ── */
    assert.equal(new Set(s.draws.map((d) => String(d.id))).size, count);
    assert.equal(
      new Set(s.draws.map((d) => String(d.idempotency_key))).size,
      count,
    );
  });
}

test("在庫より多く同時に送っても、在庫の数までしか成立しない（残りは失敗し、ポイントも減らない）", async () => {
  const total = 50;
  const { tenantId, userId, gachaId, price } = await setup({
    total,
    points: 200 * 500 + 100_000,
  });
  const before = await snapshot(tenantId, gachaId, userId);

  const settled = await Promise.allSettled(
    Array.from({ length: 200 }, (_, i) =>
      drawOnceServer({
        tenantId,
        userId,
        gachaId,
        idempotencyKey: `over-${i}`,
        requestId: `req-${i}`,
      }),
    ),
  );

  const ok = settled.filter((r) => r.status === "fulfilled");
  const ng = settled.filter((r) => r.status === "rejected");

  assert.equal(ok.length, total, "成立するのは在庫の数ぴったりであること");
  assert.equal(ng.length, 200 - total);
  for (const r of ng) {
    const e = (r as PromiseRejectedResult).reason;
    assert.ok(e instanceof DrawError, "想定外の落ち方をしている");
    assert.equal(e.code, "SOLD_OUT");
  }

  const s = await snapshot(tenantId, gachaId, userId);
  assert.equal(s.left, 0);
  assert.equal(s.draws.length, total);
  assert.equal(s.spent, total * price, "失敗した分でポイントが減っていないこと");
  const delta = s.ledger.reduce((a, e) => a + n(e.delta), 0);
  assert.equal(s.points, delta, "残高と台帳が合っていない");
  assert.equal(
    before.points,
    before.ledger.reduce((a, e) => a + n(e.delta), 0),
    "始める前から、残高と台帳がずれている",
  );
});

test("残高が足りないときは、1ポイントも減らないし記録も残らない", async () => {
  const { tenantId, userId, gachaId } = await setup({ total: 100, points: 100 });
  await assert.rejects(
    () =>
      drawOnceServer({
        tenantId,
        userId,
        gachaId,
        idempotencyKey: "poor-1",
        requestId: "r1",
      }),
    (e: unknown) => e instanceof DrawError && e.code === "NOT_ENOUGH_POINTS",
  );
  const s = await snapshot(tenantId, gachaId, userId);
  assert.equal(s.points, 100);
  assert.equal(s.draws.length, 0);
  assert.equal(s.left, 100);
  /* ★「台帳が空」ではなく「増減が1行も足されていない」を見ます。
       開始時の残高の行は、最初からあります。
       これを空だと決めつけると、開始残高を台帳に残す作りに変えた瞬間、
       試験だけが落ちて、中身は何も壊れていない、という誤報になります。 */
  assert.equal(
    s.ledger.filter((e) => String(e.kind) !== "OPENING").length,
    0,
    "断られたのに、ポイントの動きが記録されています",
  );
  assert.equal(s.audits.length, 0);
});

/* ══════════════════════════════════════════════
   3) 乱数
   ══════════════════════════════════════════════ */

test("同じ設定のガチャを2本作っても、出る順番は同じにならない", async () => {
  const seqs: string[] = [];

  for (let t = 0; t < 2; t++) {
    const { tenantId, userId, gachaId } = await setup({
      total: 200,
      points: 200 * 500 + 100_000,
    });
    for (let i = 0; i < 60; i++) {
      await drawOnceServer({
        tenantId,
        userId,
        gachaId,
        idempotencyKey: `s${t}-${i}`,
        requestId: `s${t}-${i}`,
      });
    }
    const s = await snapshot(tenantId, gachaId, userId);
    seqs.push(s.draws.map((d) => String(d.prize_rank)).join(""));
  }

  /* ★ここが「予測できない」の入口。
     以前は、ガチャIDと抽選回数から種を作っていたので、
     設定が同じなら並びも同じになりました。つまり外から計算できました。 */
  assert.notEqual(
    seqs[0],
    seqs[1],
    "同じ設定で同じ並びが出ている＝種から作られている疑いがある",
  );
});

test("抽選の記録に、予測材料になる種が保存されていない", async () => {
  const { tenantId, userId, gachaId } = await setup({ total: 10 });
  await drawOnceServer({
    tenantId,
    userId,
    gachaId,
    idempotencyKey: "seedcheck",
    requestId: "r",
  });
  const cols = await db().execute("PRAGMA table_info(draws)");
  const names = cols.rows.map((r) => String((r as Record<string, unknown>).name));
  assert.ok(!names.includes("seed"), "種を保存する欄が残っている");
  const row = await db().execute({
    sql: `SELECT rng_source FROM draws WHERE tenant_id = ?`,
    args: [tenantId],
  });
  assert.equal(
    String((row.rows[0] as Record<string, unknown>).rng_source),
    "node:crypto/randomInt",
  );
});

/* ══════════════════════════════════════════════
   4) 監査ログ
   ══════════════════════════════════════════════ */

test("抽選の記録を1文字でも書き換えると、監査ログが壊れていると分かる", async () => {
  const { tenantId, userId, gachaId } = await setup({ total: 10 });
  for (let i = 0; i < 5; i++) {
    await drawOnceServer({
      tenantId,
      userId,
      gachaId,
      idempotencyKey: `a-${i}`,
      requestId: `a-${i}`,
    });
  }

  const okBefore = await verifyAuditOfTenant(db(), tenantId);
  assert.equal(okBefore.ok, true);

  /* 3件目の中身（data）にある当選金額だけを、こっそり書き換えてみる */
  const target = await db().execute({
    sql: `SELECT data FROM audit_events WHERE tenant_id = ? AND seq = 3`,
    args: [tenantId],
  });
  const data = JSON.parse(
    String((target.rows[0] as Record<string, unknown>).data),
  ) as Record<string, unknown>;
  data.prize_value = 999_999;
  await db().execute({
    sql: `UPDATE audit_events SET data = ? WHERE tenant_id = ? AND seq = 3`,
    args: [JSON.stringify(data), tenantId],
  });

  const after = await verifyAuditOfTenant(db(), tenantId);
  assert.equal(after.ok, false);
  if (!after.ok) {
    assert.equal(after.brokenAt, 3);
    assert.equal(after.why, "HASH_MISMATCH");
  }
});

test("抽選の監査ログに、決めた項目が全部そろっている", async () => {
  const { tenantId, userId, gachaId } = await setup({ total: 10 });
  const r = await drawOnceServer({
    tenantId,
    userId,
    gachaId,
    idempotencyKey: "full-1",
    requestId: "req-full-1",
  });

  const row = await db().execute({
    sql: `SELECT data, request_id, idempotency_key, server_version, action
            FROM audit_events WHERE tenant_id = ? AND seq = 1`,
    args: [tenantId],
  });
  const e = row.rows[0] as Record<string, unknown>;
  assert.equal(String(e.action), "DRAW");
  const data = JSON.parse(String(e.data)) as Record<string, unknown>;

  for (const k of [
    "draw_id",
    "tenant_id",
    "user_id",
    "gacha_id",
    "request_id",
    "idempotency_key",
    "play_count",
    "point_before",
    "point_spent",
    "point_after",
    "prize_id",
    "prize_rank",
    "remaining_before",
    "remaining_after",
    "timestamp",
    "server_version",
  ]) {
    assert.ok(k in data, `監査ログに ${k} が入っていない`);
  }
  assert.equal(data.draw_id, r.drawId);
  assert.equal(data.point_after, r.pointAfter);
  assert.equal(data.remaining_after, r.remainingAfter);
});
