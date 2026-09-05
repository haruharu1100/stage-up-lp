/**
 * 決済会社の側で、お金が引き戻されたとき（強制取消）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを機械に見張らせるのか
 * ═══════════════════════════════════════════════════════
 *
 *   お金が引き戻される事故は、めったに起きません。
 *   めったに起きないので、人の目では確かめられません。
 *   起きたときには本番で、しかも初めて動きます。
 *
 *   そして、この処理の壊れ方は、どれも静かです。
 *
 *     ・過去の台帳を書き換えてしまう
 *       → 帳尻は合います。合ってしまうから、誰も気づきません。
 *         気づくのは、カード会社に事情を説明する場面です。
 *         そのとき、説明する材料が消えています。
 *
 *     ・残高がマイナスになる
 *       → 画面のどこも想定していません。
 *         「-800pt なのに引ける」のような壊れ方をします。
 *
 *     ・取り戻せなかった額を 0 で埋めてしまう
 *       → 被害額そのものが帳簿から消えます。
 *         いくら取りはぐれたのかを、誰も答えられなくなります。
 *
 *     ・同じ取消通知が2回来て、2回引いてしまう
 *       → 決済会社の再送は、ふつうに起きます。
 *
 *   ★どれも「エラーが出ない壊れ方」です。
 *     だから、人の確認ではなく、ここで機械に固定します。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { db, migrate, resetDbForTests } from "../lib/server/db";
import { createTenant, createCustomer, createGacha } from "../lib/server/seed";
import { verifyAuditOfTenant } from "../lib/server/audit";
import { drawOnceServer } from "../lib/server/draw";
import {
  createOrder,
  confirmPayment,
  saveProduct,
  PurchaseError,
} from "../lib/server/pointPurchase";
import {
  applyForcedReversal,
  listReversals,
  reversalSummary,
  clearReviewFlag,
} from "../lib/server/paymentReversal";
import type { Actor } from "../lib/server/orders";

after(async () => {
  await resetDbForTests();
});

const ADMIN: Actor = {
  kind: "ADMIN",
  id: "adm_test",
  name: "試験の管理者",
  role: "SUPER_ADMIN",
};

const KESSAI: Actor = {
  kind: "SYSTEM",
  id: "payment",
  name: "決済（mock）",
  role: "SYSTEM",
};

let n = 0;

/**
 * 1件ぶんの下ごしらえ。
 *
 * 会員を作り、1,000円ぶん（1,000pt）を実際に買って、入金確定まで通します。
 * ★残高を直接書き込まないこと。台帳を通した本物の残高でないと、
 *   この試験そのものが、確かめたい壊れ方を見逃します。
 */
async function shitagoshirae(opts?: { bonus?: number }) {
  await migrate();
  n += 1;
  const tenantId = await createTenant({
    code: `rev${n}${Math.random().toString(36).slice(2, 6)}`,
    name: `強制取消の試験${n}`,
  });
  const userId = await createCustomer({
    tenantId,
    no: 1,
    name: `試験のお客様${n}`,
    points: 0,
    email: `rev${n}@example.invalid`,
  });

  const { productId } = await saveProduct({
    tenantId,
    name: "1,000円のポイント",
    priceYen: 1000,
    points: 1000,
    bonusPoints: opts?.bonus ?? 0,
    status: "ACTIVE",
    sortOrder: 1,
    actor: ADMIN,
    requestId: `req_prod_${n}`,
  });

  const order = await createOrder({
    tenantId,
    userId,
    productId,
    actor: ADMIN,
    requestId: `req_order_${n}`,
  });

  const paid = await confirmPayment({
    tenantId,
    provider: "mock",
    eventId: `evt_pay_${n}`,
    orderId: order.orderId,
    amountYen: 1000,
    requestId: `req_pay_${n}`,
    actor: KESSAI,
  });

  return { tenantId, userId, productId, order, paid };
}

/** いまの残高 */
async function zandaka(tenantId: string, userId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT points FROM customers WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, userId],
  });
  return Number((r.rows[0] as Record<string, unknown>)?.points ?? 0);
}

/** その注文についている台帳の行を、古い順で全部 */
async function daichou(tenantId: string, ref: string) {
  const r = await db().execute({
    sql: `SELECT id, kind, delta, memo, ref, created_at FROM point_ledger
           WHERE tenant_id = ? AND ref = ? ORDER BY created_at ASC, id ASC`,
    args: [tenantId, ref],
  });
  return r.rows.map((raw) => {
    const x = raw as Record<string, unknown>;
    return {
      id: String(x.id ?? ""),
      kind: String(x.kind ?? ""),
      delta: Number(x.delta ?? 0),
    };
  });
}

/** 監査ログに、その種類の行がいくつあるか */
async function kansaKazu(tenantId: string, action: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS c FROM audit_events
           WHERE tenant_id = ? AND action = ?`,
    args: [tenantId, action],
  });
  return Number((r.rows[0] as Record<string, unknown>).c ?? 0);
}

/* ══════════════════════════════════════════════
   ① 過去の台帳を書き換えない（いちばん大事な決まり）
   ══════════════════════════════════════════════ */

test("強制取消をしても、最初に付けた台帳の行は、消えも変わりもしない", async () => {
  const { tenantId, userId, order } = await shitagoshirae();

  const mae = await daichou(tenantId, order.orderId);
  assert.equal(mae.length, 1, "買った直後は、付与の行が1本だけのはず");
  assert.equal(mae[0].kind, "PURCHASE");
  assert.equal(mae[0].delta, 1000);

  await applyForcedReversal({
    tenantId,
    provider: "mock",
    eventId: "evt_cb_1",
    orderId: order.orderId,
    reason: "CHARGEBACK",
    amountYen: 1000,
    requestId: "req_cb_1",
    actor: KESSAI,
  });

  const ato = await daichou(tenantId, order.orderId);

  /* ★ここが本丸。
       付与の行が「そのまま」残っていること。
       金額を 0 に直したり、行ごと消したりしていないこと。 */
  const fuyo = ato.find((x) => x.kind === "PURCHASE");
  assert.ok(fuyo, "付与の行が消えている（＝過去を書き換えた）");
  assert.equal(fuyo.id, mae[0].id, "付与の行のIDが変わっている");
  assert.equal(fuyo.delta, 1000, "付与の行の金額が書き換えられている");

  /* 代わりに、新しい行が1本増えていること */
  assert.equal(ato.length, 2, "行が増えていない（＝逆仕訳を足していない）");
  const gyaku = ato.find((x) => x.kind === "PURCHASE_REVERSAL");
  assert.ok(gyaku, "逆仕訳の行が無い");
  assert.equal(gyaku.delta, -1000, "逆仕訳の金額が合っていない");

  /* 足し引きすると 0 になること（残高と一致する） */
  const gokei = ato.reduce((s, x) => s + x.delta, 0);
  assert.equal(gokei, 0);
  assert.equal(await zandaka(tenantId, userId), 0);
});

/* ══════════════════════════════════════════════
   ② ボーナスも含めて引き戻す
   ══════════════════════════════════════════════ */

test("おまけポイントも含めて引き戻す（お金は全額戻っているのに、おまけだけ残さない）", async () => {
  const { tenantId, userId, order } = await shitagoshirae({ bonus: 200 });

  assert.equal(await zandaka(tenantId, userId), 1200);

  const out = await applyForcedReversal({
    tenantId,
    provider: "mock",
    eventId: "evt_cb_bonus",
    orderId: order.orderId,
    reason: "CHARGEBACK",
    amountYen: 1000,
    requestId: "req_cb_bonus",
    actor: KESSAI,
  });

  assert.equal(out.result, "APPLIED");
  assert.equal(out.pointsToReverse, 1200);
  assert.equal(out.pointsReversed, 1200);
  assert.equal(out.unrecoveredPoints, 0);
  assert.equal(await zandaka(tenantId, userId), 0);
});

/* ══════════════════════════════════════════════
   ③ 使い切られていたとき（残高が足りない）
   ══════════════════════════════════════════════ */

test("ポイントを使ったあとの取消：残高はマイナスにならず、引けなかった額が残る", async () => {
  const { tenantId, userId, order } = await shitagoshirae();

  /* お客様に、実際にガチャを引いて使っていただく。
     ★残高を直接書き換えて「使ったことにする」をしないこと。
       それでは、本番で起きる形と違うものを試験することになります。 */
  const gachaId = await createGacha({
    tenantId,
    title: "試験用のガチャ",
    price: 500,
    total: 100,
    designedRtp: 90,
    status: "PUBLISHED",
  });

  for (let i = 0; i < 20; i++) {
    if ((await zandaka(tenantId, userId)) < 500) break;
    await drawOnceServer({
      tenantId,
      userId,
      gachaId,
      idempotencyKey: `idem_${i}`,
      requestId: `req_draw_${i}`,
    });
  }

  const nokori = await zandaka(tenantId, userId);
  assert.ok(nokori < 1000, `使ったのに残高が減っていない（${nokori}pt）`);

  const out = await applyForcedReversal({
    tenantId,
    provider: "mock",
    eventId: "evt_cb_short",
    orderId: order.orderId,
    reason: "CHARGEBACK",
    amountYen: 1000,
    requestId: "req_cb_short",
    actor: KESSAI,
  });

  assert.equal(out.result, "APPLIED");
  assert.equal(out.pointsToReverse, 1000);

  /* 引けるだけ引く。それ以上は引かない */
  assert.equal(out.pointsReversed, nokori);
  assert.equal(out.unrecoveredPoints, 1000 - nokori);

  /* ★残高をマイナスにしないこと */
  const ato = await zandaka(tenantId, userId);
  assert.equal(ato, 0);
  assert.ok(ato >= 0, "残高がマイナスになっている");

  /* ★取りはぐれた額を 0 で埋めないこと */
  assert.ok(
    out.unrecoveredPoints > 0,
    "使ったはずなのに、引けなかった額が 0 になっている",
  );
  assert.ok(
    out.unrecoveredAmount > 0,
    "引けなかったポイントがあるのに、被害額が 0 円になっている",
  );

  /* 切り上げていること（少なめに見積もらない） */
  const kitai = Math.ceil((1000 * out.unrecoveredPoints) / 1000);
  assert.equal(out.unrecoveredAmount, kitai);

  /* 被害額だけを、あとから単独で数えられること */
  const sum = await reversalSummary(tenantId);
  assert.equal(sum.count, 1);
  assert.equal(sum.amountYen, 1000);
  assert.equal(sum.unrecoveredAmount, out.unrecoveredAmount);

  /* 引けなかったときだけ出る、専用の監査ログ */
  assert.equal(await kansaKazu(tenantId, "POINT_REVERSAL_UNRECOVERED"), 1);
});

test("全部使い切っていても、残高はマイナスにならない（引けたのは0pt）", async () => {
  const { tenantId, userId, order } = await shitagoshirae();

  const gachaId = await createGacha({
    tenantId,
    title: "使い切る試験のガチャ",
    price: 100,
    total: 200,
    designedRtp: 90,
    status: "PUBLISHED",
  });

  for (let i = 0; i < 200; i++) {
    if ((await zandaka(tenantId, userId)) < 100) break;
    await drawOnceServer({
      tenantId,
      userId,
      gachaId,
      idempotencyKey: `idem_z_${i}`,
      requestId: `req_draw_z_${i}`,
    });
  }

  const nokori = await zandaka(tenantId, userId);

  const out = await applyForcedReversal({
    tenantId,
    provider: "mock",
    eventId: "evt_cb_zero",
    orderId: order.orderId,
    reason: "FORCED_REFUND",
    amountYen: 1000,
    requestId: "req_cb_zero",
    actor: KESSAI,
  });

  assert.equal(out.result, "APPLIED");
  assert.equal(out.pointsReversed, nokori);
  assert.ok((await zandaka(tenantId, userId)) >= 0, "残高がマイナス");
  assert.equal(out.unrecoveredPoints, 1000 - nokori);
});

/* ══════════════════════════════════════════════
   ④ 同じ取消通知が2回来ても、2回引かない
   ══════════════════════════════════════════════ */

test("同じ取消通知が2回届いても、2回は引かない（2回目は DUPLICATE）", async () => {
  const { tenantId, userId, order } = await shitagoshirae();

  const a = await applyForcedReversal({
    tenantId,
    provider: "mock",
    eventId: "evt_same",
    orderId: order.orderId,
    reason: "CHARGEBACK",
    amountYen: 1000,
    requestId: "req_same_1",
    actor: KESSAI,
  });
  assert.equal(a.result, "APPLIED");
  assert.equal(await zandaka(tenantId, userId), 0);

  const b = await applyForcedReversal({
    tenantId,
    provider: "mock",
    eventId: "evt_same",
    orderId: order.orderId,
    reason: "CHARGEBACK",
    amountYen: 1000,
    requestId: "req_same_2",
    actor: KESSAI,
  });

  /* ★2回目を「成功」にしないこと。
       呼んだ側が「2回引いたのか」を疑えなくなります。 */
  assert.equal(b.result, "DUPLICATE");
  assert.equal(b.reversalId, a.reversalId);
  assert.equal(b.pointsReversed, a.pointsReversed);

  /* 残高も台帳も、1回ぶんのまま */
  assert.equal(await zandaka(tenantId, userId), 0);
  const rows = await daichou(tenantId, order.orderId);
  assert.equal(rows.filter((x) => x.kind === "PURCHASE_REVERSAL").length, 1);
  assert.equal((await listReversals(tenantId)).length, 1);
});

/* ══════════════════════════════════════════════
   ⑤ 受け付けてはいけないもの
   ══════════════════════════════════════════════ */

test("入金確定していない注文は、取り消せない（付けてもいないポイントを引かない）", async () => {
  await migrate();
  n += 1;
  const tenantId = await createTenant({
    code: `revx${n}${Math.random().toString(36).slice(2, 6)}`,
    name: `未入金の試験${n}`,
  });
  const userId = await createCustomer({
    tenantId,
    no: 1,
    name: "未入金のお客様",
    points: 0,
    email: `revx${n}@example.invalid`,
  });
  const { productId } = await saveProduct({
    tenantId,
    name: "1,000円のポイント",
    priceYen: 1000,
    points: 1000,
    bonusPoints: 0,
    status: "ACTIVE",
    sortOrder: 1,
    actor: ADMIN,
    requestId: `req_prod_x_${n}`,
  });
  /* 注文だけ作って、入金確定はしない */
  const order = await createOrder({
    tenantId,
    userId,
    productId,
    actor: ADMIN,
    requestId: `req_order_x_${n}`,
  });

  await assert.rejects(
    () =>
      applyForcedReversal({
        tenantId,
        provider: "mock",
        eventId: "evt_notpaid",
        orderId: order.orderId,
        reason: "CHARGEBACK",
        amountYen: 1000,
        requestId: "req_notpaid",
        actor: KESSAI,
      }),
    (e: unknown) =>
      e instanceof PurchaseError && e.code === "ORDER_NOT_PAID",
  );

  assert.equal(await zandaka(tenantId, userId), 0);
});

test("入金の通知と同じ番号の取消は、機械が黙って処理しない", async () => {
  const { tenantId, order } = await shitagoshirae();

  await assert.rejects(
    () =>
      applyForcedReversal({
        tenantId,
        provider: "mock",
        /* 下ごしらえの入金で使った番号と、わざと同じにする */
        eventId: `evt_pay_${n}`,
        orderId: order.orderId,
        reason: "CHARGEBACK",
        amountYen: 1000,
        requestId: "req_clash",
        actor: KESSAI,
      }),
    (e: unknown) =>
      e instanceof PurchaseError && e.code === "EVENT_ID_CLASH",
  );
});

test("他社の注文は、IDを直に指定しても取り消せない", async () => {
  const a = await shitagoshirae();
  const b = await shitagoshirae();

  await assert.rejects(
    () =>
      applyForcedReversal({
        /* B社のふりをして、A社の注文を指定する */
        tenantId: b.tenantId,
        provider: "mock",
        eventId: "evt_other",
        orderId: a.order.orderId,
        reason: "CHARGEBACK",
        amountYen: 1000,
        requestId: "req_other",
        actor: KESSAI,
      }),
    (e: unknown) => e instanceof PurchaseError && e.code === "NO_ORDER",
  );

  /* A社のお客様の残高は、1ptも動いていないこと */
  assert.equal(await zandaka(a.tenantId, a.userId), 1000);
});

/* ══════════════════════════════════════════════
   ⑥ 会員は「要確認」になるだけ。止めない
   ══════════════════════════════════════════════ */

test("取消が起きた会員は要確認になるが、利用停止にはならない", async () => {
  const { tenantId, userId, order } = await shitagoshirae();

  await applyForcedReversal({
    tenantId,
    provider: "mock",
    eventId: "evt_flag",
    orderId: order.orderId,
    reason: "CHARGEBACK",
    amountYen: 1000,
    requestId: "req_flag",
    actor: KESSAI,
  });

  const r = await db().execute({
    sql: `SELECT status, review_flag, review_note FROM customers
           WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, userId],
  });
  const c = r.rows[0] as Record<string, unknown>;

  /* ★勝手に止めないこと。
       カード会社の取消は、本人の落ち度とは限りません。
       盗まれた側（＝被害者）を、機械が締め出してはいけません。 */
  assert.equal(String(c.status), "ACTIVE", "会員を自動で利用停止にしている");
  assert.equal(String(c.review_flag), "PAYMENT_REVERSAL");
  assert.ok(String(c.review_note ?? "").length > 0, "理由が書かれていない");

  const sum = await reversalSummary(tenantId);
  assert.equal(sum.reviewPending, 1);
});

test("要確認は、人が理由を書いたときだけ外せる（空では外せない）", async () => {
  const { tenantId, userId, order } = await shitagoshirae();

  await applyForcedReversal({
    tenantId,
    provider: "mock",
    eventId: "evt_clear",
    orderId: order.orderId,
    reason: "CHARGEBACK",
    amountYen: 1000,
    requestId: "req_clear_1",
    actor: KESSAI,
  });

  await assert.rejects(
    () =>
      clearReviewFlag({
        tenantId,
        userId,
        actor: ADMIN,
        note: "   ",
        requestId: "req_clear_empty",
      }),
    (e: unknown) => e instanceof PurchaseError && e.code === "REASON_REQUIRED",
  );

  /* 空では外れていないこと */
  assert.equal((await reversalSummary(tenantId)).reviewPending, 1);

  await clearReviewFlag({
    tenantId,
    userId,
    actor: ADMIN,
    note: "カード会社へ確認済み。本人の不正ではなく、家族の利用でした。",
    requestId: "req_clear_ok",
  });

  assert.equal((await reversalSummary(tenantId)).reviewPending, 0);
  assert.equal(await kansaKazu(tenantId, "CUSTOMER_REVIEW_CLEARED"), 1);
});

/* ══════════════════════════════════════════════
   ⑦ 記録が、あとから読める形で残っていること
   ══════════════════════════════════════════════ */

test("強制取消は、注文・取消台帳・監査ログの3か所に残り、監査の鎖も切れない", async () => {
  const { tenantId, order } = await shitagoshirae();

  await applyForcedReversal({
    tenantId,
    provider: "mock",
    eventId: "evt_rec",
    orderId: order.orderId,
    reason: "CHARGEBACK",
    amountYen: 1000,
    requestId: "req_rec",
    actor: KESSAI,
  });

  /* ★注文の状態は REVERSED。
       「支払われた事実」と「引き戻された事実」は別のできごとです。
       PENDING に戻したり、注文ごと消したりしないこと。 */
  const or = await db().execute({
    sql: `SELECT status, paid_at FROM point_orders WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, order.orderId],
  });
  const o = or.rows[0] as Record<string, unknown>;
  assert.equal(String(o.status), "REVERSED");
  assert.ok(String(o.paid_at ?? "").length > 0, "支払った日時が消されている");

  /* 一覧に出ること（記録は残っているのに誰も見られない、を作らない） */
  const list = await listReversals(tenantId);
  assert.equal(list.length, 1);
  assert.equal(list[0].orderId, order.orderId);
  assert.equal(list[0].reason, "CHARGEBACK");
  assert.equal(list[0].amountYen, 1000);
  assert.ok(list[0].reasonLabel.includes("チャージバック"));

  /* 監査ログ */
  assert.equal(await kansaKazu(tenantId, "POINT_PURCHASE_REVERSED"), 1);
  assert.equal(await kansaKazu(tenantId, "CUSTOMER_REVIEW_FLAGGED"), 1);
  /* 全額引けたので、取りはぐれの行は出ない */
  assert.equal(await kansaKazu(tenantId, "POINT_REVERSAL_UNRECOVERED"), 0);

  /* ★鎖が切れていないこと。
       途中の行を差し替えると、ここで必ず落ちます。 */
  const v = await verifyAuditOfTenant(db(), tenantId);
  assert.equal(v.ok, true, "監査ログの鎖が切れている");
});

/* ══════════════════════════════════════════════
   ⑧ 「返金ボタン」を作らせない
   ══════════════════════════════════════════════ */

test("管理画面から押せる返金の入口が、増えていないこと", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");

  const ROOT = join(__dirname, "..");
  const mitsuketa: string[] = [];

  function mite(dir: string) {
    for (const na of readdirSync(dir)) {
      if (na === "node_modules" || na === ".next") continue;
      const p = join(dir, na);
      if (statSync(p).isDirectory()) {
        mite(p);
      } else if (/\.(ts|tsx)$/.test(na)) {
        const src = readFileSync(p, "utf8");
        if (src.includes("applyForcedReversal")) mitsuketa.push(p);
      }
    }
  }
  mite(join(ROOT, "app"));
  mite(join(ROOT, "components"));

  /* ★お店の判断で返金できる形にしないこと。
       ポイントは、その場でガチャに使えます。
       引いたあとの返金を認めた時点で、店は必ず負けます。

       呼んでよいのは、決済会社からの通知を受ける入口だけです。
       画面（components/）から呼ばれていたら、そこで止めます。 */
  const gamen = mitsuketa.filter((p) => p.includes("/components/"));
  assert.equal(
    gamen.length,
    0,
    "画面から強制取消を呼んでいます。これは「返金ボタン」です：\n" +
      gamen.join("\n"),
  );

  for (const p of mitsuketa) {
    assert.ok(
      p.includes("/api/") && (p.includes("webhook") || p.includes("payment")),
      `決済の通知を受ける入口以外から呼んでいます：${p}`,
    );
  }
});
