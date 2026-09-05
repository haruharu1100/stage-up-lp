/**
 * 販売中のガチャの「写真だけ」を差し替える試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を確かめる試験なのか
 * ═══════════════════════════════════════════════════════
 *
 *   写真の差し替えは、店員さんが毎日やる軽い操作です。
 *   軽い操作から、お金の話に手が届いてはいけません。
 *
 *     1) 販売中でも差し替えられる（止めなくてよい）
 *     2) 差し替えても、当たりの本数・残り口数・売上が1つも動かない
 *     3) すでに当てた方の履歴の写真が、当選した時点のまま変わらない  ★最重要
 *     4) 他社の写真IDを指定しても通らない
 *     5) 他社のガチャは、そもそも見つからない
 *     6) 理由を書かないと通らない
 *     7) 見るだけの担当（VIEWER）は差し替えられない
 *     8) 差し替えの履歴と監査ログが残り、鎖が壊れていない
 *     9) 外した古い写真は片付くが、当選記録が指している写真は残る
 *
 *   ★3) が、このファイルがある理由です。
 *     ここが壊れると、
 *     「安い写真に差し替えたら、過去に当てた人の履歴まで安い写真になった」
 *     が静かに起きます。誰も気づかないまま、記録だけが書き換わります。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { verifyAuditOfTenant } from "../lib/server/audit";
import { db, migrate, resetDbForTests, withWriteTx } from "../lib/server/db";
import { drawOnceServer } from "../lib/server/draw";
import {
  COVER_SLOT,
  GachaImagesError,
  getGachaImages,
  replaceGachaImages,
} from "../lib/server/gachaImages";
import { id as newId } from "../lib/server/ids";
import { listCustomerPrizes } from "../lib/server/prizes";
import { createCustomer, createGacha, createTenant } from "../lib/server/seed";

after(async () => {
  await resetDbForTests();
});

const n = (v: unknown) => Number(v ?? 0);

const OPERATOR = { adminId: "adm_test", name: "試験 担当", role: "OPERATOR" as const };

/** 写真を1枚、直接しまう（画像の中身は試験に関係ないので最小の1バイト） */
async function putImage(tenantId: string): Promise<string> {
  const imageId = newId("img");
  await withWriteTx(async (tx) => {
    await tx.execute({
      sql: `INSERT INTO images
              (id, tenant_id, kind, mime, bytes, sha256, data, created_at, created_by)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [
        imageId,
        tenantId,
        "PRIZE",
        "image/png",
        1,
        `sha_${imageId}`,
        new Uint8Array([1]),
        new Date().toISOString(),
        null,
      ],
    });
  });
  return imageId;
}

async function setup() {
  await migrate();
  const tenantId = await createTenant({
    code: `t${Math.random().toString(36).slice(2, 8)}`,
    name: "試験用の会社",
  });
  const userId = await createCustomer({
    tenantId,
    no: 1,
    name: "試験 太郎",
    points: 1_000_000,
  });
  const gachaId = await createGacha({
    tenantId,
    title: `写真試験ガチャ_${Math.random().toString(36).slice(2, 8)}`,
    price: 500,
    total: 50,
    designedRtp: 80,
    status: "PUBLISHED",
  });
  return { tenantId, userId, gachaId };
}

/* ══════════════════════════════════════════════ */

test("販売中のままでも、表紙の写真を差し替えられる", async () => {
  const { tenantId, gachaId } = await setup();
  const img = await putImage(tenantId);

  const out = await replaceGachaImages({
    tenantId,
    gachaId,
    slots: { [COVER_SLOT]: img },
    reason: "現物の写真に撮り直したため",
    by: OPERATOR,
  });

  assert.equal(out.changed.length, 1);

  const g = await db().execute({
    sql: `SELECT status, cover_image_id FROM gachas WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, gachaId],
  });
  const row = g.rows[0] as Record<string, unknown>;
  /* ★販売が止まっていないこと。
       止めてから替える作りにすると、写真1枚のために売り場が毎回落ちます */
  assert.equal(String(row.status), "PUBLISHED");
  assert.equal(String(row.cover_image_id), img);
});

test("写真を差し替えても、本数・残り口数・売上が1つも動かない", async () => {
  const { tenantId, userId, gachaId } = await setup();

  /* 先に何回か引いて、数字を動かしておく */
  for (let i = 0; i < 3; i += 1) {
    await drawOnceServer({
      tenantId,
      userId,
      gachaId,
      idempotencyKey: `k_${i}_${Math.random()}`,
      requestId: `r_${i}`,
    });
  }

  const mae = await db().execute({
    sql: `SELECT left_count, revenue, paid_value FROM gachas WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, gachaId],
  });
  const maeStock = await db().execute({
    sql: `SELECT grade, total, drawn, reserved FROM gacha_stock
           WHERE tenant_id = ? AND gacha_id = ? ORDER BY grade`,
    args: [tenantId, gachaId],
  });

  const st = await db().execute({
    sql: `SELECT grade FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ? LIMIT 1`,
    args: [tenantId, gachaId],
  });
  const grade = String((st.rows[0] as Record<string, unknown>).grade);
  const img = await putImage(tenantId);

  await replaceGachaImages({
    tenantId,
    gachaId,
    slots: { [grade]: img },
    reason: "写真を撮り直したため",
    by: OPERATOR,
  });

  const ato = await db().execute({
    sql: `SELECT left_count, revenue, paid_value FROM gachas WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, gachaId],
  });
  const atoStock = await db().execute({
    sql: `SELECT grade, total, drawn, reserved FROM gacha_stock
           WHERE tenant_id = ? AND gacha_id = ? ORDER BY grade`,
    args: [tenantId, gachaId],
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(ato.rows)),
    JSON.parse(JSON.stringify(mae.rows)),
    "写真を差し替えたら、残り口数や売上が動きました。写真の操作からお金の数字へ手が届いています。",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(atoStock.rows)),
    JSON.parse(JSON.stringify(maeStock.rows)),
    "写真を差し替えたら、当たりの本数が動きました。ここは絶対に動いてはいけません。",
  );
});

test("★当てた方の履歴の写真は、当選した時点のまま変わらない", async () => {
  const { tenantId, userId, gachaId } = await setup();

  /* ① 先に写真を付けてから引く。この写真が「当選時に見えていたもの」 */
  const st = await db().execute({
    sql: `SELECT grade FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ?`,
    args: [tenantId, gachaId],
  });
  const grades = st.rows.map((r) => String((r as Record<string, unknown>).grade));

  const mukashi: Record<string, string> = {};
  for (const g of grades) mukashi[g] = await putImage(tenantId);

  await replaceGachaImages({
    tenantId,
    gachaId,
    slots: mukashi,
    reason: "最初の写真を登録したため",
    by: OPERATOR,
  });

  /* ★「現物が当たる」まで引くこと。
       ポイント還元の等級（C・D・E）は、獲得商品の履歴を作りません。
       1回だけ引く書き方にすると、引いた等級しだいで
       この試験が通ったり通らなかったりします。
       いちばん大事な試験を、運まかせにしないこと。
       50口しか無いので、上限も必ず付けます。 */
  let atattaGrade = "";
  for (let i = 0; i < 40; i++) {
    const drew = await drawOnceServer({
      tenantId,
      userId,
      gachaId,
      idempotencyKey: `k_snap_${i}_${Math.random()}`,
      requestId: "r_snap",
    });
    if (drew.needsShipping) {
      atattaGrade = drew.grade;
      break;
    }
  }
  assert.notEqual(
    atattaGrade,
    "",
    "現物が1本も当たりませんでした。試験の作りを見直してください。",
  );
  const atattaShashin = mukashi[atattaGrade];
  assert.ok(atattaShashin, "当たった等級の写真が、試験の準備で用意できていません。");

  /* 引いた直後は、当選時の写真が見えているはず */
  const mae = await listCustomerPrizes(tenantId, userId);
  const p1 = mae.find((p) => p.grade === atattaGrade);
  assert.ok(p1, "当たった景品が、獲得商品に出てきません。");
  assert.equal(p1.imageId, atattaShashin);
  assert.equal(p1.imageIsSnapshot, true, "当選した時点の写真が、写し取られていません。");

  /* ② 当たったあとで、同じ等級の写真を別のものへ差し替える */
  const atarashii = await putImage(tenantId);
  await replaceGachaImages({
    tenantId,
    gachaId,
    slots: { [atattaGrade]: atarashii },
    reason: "在庫の写真を新しいものへ替えたため",
    by: OPERATOR,
  });

  /* ③ 売り場は新しい写真。履歴は当選時の写真のまま */
  const stock = await db().execute({
    sql: `SELECT image_id FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ? AND grade = ?`,
    args: [tenantId, gachaId, atattaGrade],
  });
  assert.equal(
    String((stock.rows[0] as Record<string, unknown>).image_id),
    atarashii,
    "売り場の写真が、新しいものに替わっていません。",
  );

  const ato = await listCustomerPrizes(tenantId, userId);
  const p2 = ato.find((p) => p.grade === atattaGrade);
  assert.ok(p2);
  assert.equal(
    p2.imageId,
    atattaShashin,
    "★当てた方の履歴の写真まで差し替わりました。過去の記録が書き換わっています。",
  );

  /* ④ 古い写真そのものが、消えずに残っていること */
  const nokori = await db().execute({
    sql: `SELECT 1 FROM images WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, atattaShashin],
  });
  assert.equal(
    nokori.rows.length,
    1,
    "当選記録が指している写真が、片付けで消えました。履歴が「壊れた画像」になります。",
  );
});

test("どこからも使われなくなった写真は、片付けられる", async () => {
  const { tenantId, gachaId } = await setup();
  const furui = await putImage(tenantId);
  const atarashii = await putImage(tenantId);

  await replaceGachaImages({
    tenantId,
    gachaId,
    slots: { [COVER_SLOT]: furui },
    reason: "最初の表紙を登録したため",
    by: OPERATOR,
  });
  /* まだ誰も当てていないので、この時点で古い写真は迷子になる */
  await replaceGachaImages({
    tenantId,
    gachaId,
    slots: { [COVER_SLOT]: atarashii },
    reason: "表紙を新しいものへ替えたため",
    by: OPERATOR,
  });

  const r = await db().execute({
    sql: `SELECT 1 FROM images WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, furui],
  });
  assert.equal(r.rows.length, 0, "使われなくなった写真が残り続けています。");
});

test("他社の写真IDを指定しても、通らない", async () => {
  const a = await setup();
  const b = await setup();
  const yoso = await putImage(b.tenantId);

  await assert.rejects(
    () =>
      replaceGachaImages({
        tenantId: a.tenantId,
        gachaId: a.gachaId,
        slots: { [COVER_SLOT]: yoso },
        reason: "他社の写真を指してみる",
        by: OPERATOR,
      }),
    (e: unknown) => e instanceof GachaImagesError && e.code === "BAD_IMAGE",
    "他社の写真IDが通りました。IDを1つ書き換えるだけで、他社の写真を自分の売り場に出せます。",
  );

  const g = await db().execute({
    sql: `SELECT cover_image_id FROM gachas WHERE tenant_id = ? AND id = ?`,
    args: [a.tenantId, a.gachaId],
  });
  assert.equal((g.rows[0] as Record<string, unknown>).cover_image_id, null);
});

test("他社のガチャは、そもそも見つからない", async () => {
  const a = await setup();
  const b = await setup();

  await assert.rejects(
    () => getGachaImages(a.tenantId, b.gachaId),
    (e: unknown) => e instanceof GachaImagesError && e.code === "NOT_FOUND",
  );

  await assert.rejects(
    () =>
      replaceGachaImages({
        tenantId: a.tenantId,
        gachaId: b.gachaId,
        slots: { [COVER_SLOT]: null },
        reason: "他社のガチャを触ってみる",
        by: OPERATOR,
      }),
    (e: unknown) => e instanceof GachaImagesError && e.code === "NOT_FOUND",
  );
});

test("理由を書かないと、差し替えられない", async () => {
  const { tenantId, gachaId } = await setup();
  const img = await putImage(tenantId);

  await assert.rejects(
    () =>
      replaceGachaImages({
        tenantId,
        gachaId,
        slots: { [COVER_SLOT]: img },
        reason: "あ",
        by: OPERATOR,
      }),
    (e: unknown) => e instanceof GachaImagesError && e.code === "NO_REASON",
  );
});

test("見るだけの担当は、写真を差し替えられない", async () => {
  const { tenantId, gachaId } = await setup();
  const img = await putImage(tenantId);

  await assert.rejects(
    () =>
      replaceGachaImages({
        tenantId,
        gachaId,
        slots: { [COVER_SLOT]: img },
        reason: "権限のない担当で差し替えてみる",
        by: { adminId: "adm_v", name: "見るだけ", role: "VIEWER" },
      }),
    (e: unknown) => e instanceof GachaImagesError && e.code === "FORBIDDEN",
  );
});

test("知らない賞の記号は、黙って受け取らない", async () => {
  const { tenantId, gachaId } = await setup();
  const img = await putImage(tenantId);

  await assert.rejects(
    () =>
      replaceGachaImages({
        tenantId,
        gachaId,
        slots: { ZZZ: img },
        reason: "存在しない賞を指してみる",
        by: OPERATOR,
      }),
    (e: unknown) => e instanceof GachaImagesError && e.code === "BAD_SLOT",
  );
});

test("差し替えの履歴と監査ログが残り、鎖が壊れていない", async () => {
  const { tenantId, gachaId } = await setup();
  const img = await putImage(tenantId);

  await replaceGachaImages({
    tenantId,
    gachaId,
    slots: { [COVER_SLOT]: img },
    reason: "現物の写真に撮り直したため",
    by: OPERATOR,
  });

  const view = await getGachaImages(tenantId, gachaId);
  assert.equal(view.history.length, 1);
  assert.equal(view.history[0].slot, COVER_SLOT);
  assert.equal(view.history[0].kind, "REPLACE");
  assert.equal(view.history[0].newImageId, img);
  assert.equal(view.history[0].reason, "現物の写真に撮り直したため");

  const audit = await db().execute({
    sql: `SELECT action, summary FROM audit_events
           WHERE tenant_id = ? AND action = 'IMAGE_REPLACE'`,
    args: [tenantId],
  });
  assert.equal(n(audit.rows.length), 1, "写真の差し替えが、監査ログに残っていません。");

  const chain = await verifyAuditOfTenant(db(), tenantId);
  assert.equal(chain.ok, true, "監査ログの鎖が壊れました。");
});

test("写真を外したときは、REMOVE として残る", async () => {
  const { tenantId, gachaId } = await setup();
  const img = await putImage(tenantId);

  await replaceGachaImages({
    tenantId,
    gachaId,
    slots: { [COVER_SLOT]: img },
    reason: "最初の表紙を登録したため",
    by: OPERATOR,
  });
  await replaceGachaImages({
    tenantId,
    gachaId,
    slots: { [COVER_SLOT]: null },
    reason: "表紙を外したいため",
    by: OPERATOR,
  });

  const view = await getGachaImages(tenantId, gachaId);
  assert.equal(view.history[0].kind, "REMOVE");
  assert.equal(view.history[0].newImageId, null);
  assert.equal(view.slots.find((s) => s.slot === COVER_SLOT)?.imageId, null);
});

test("何も変わっていないときは、記録を増やさない", async () => {
  const { tenantId, gachaId } = await setup();

  await assert.rejects(
    () =>
      replaceGachaImages({
        tenantId,
        gachaId,
        /* もともと写真が無いところへ「無し」を送っている */
        slots: { [COVER_SLOT]: null },
        reason: "同じ内容で保存してみる",
        by: OPERATOR,
      }),
    (e: unknown) => e instanceof GachaImagesError && e.code === "NO_CHANGE",
  );

  const view = await getGachaImages(tenantId, gachaId);
  assert.equal(view.history.length, 0, "変わっていないのに、履歴が増えました。");
});
