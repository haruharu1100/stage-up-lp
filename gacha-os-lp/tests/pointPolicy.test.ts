/**
 * ポイントの有効期限を「お店が決める」ための入れ物の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを機械に見張らせるのか
 * ═══════════════════════════════════════════════════════
 *
 *   有効期限は、法律（資金決済法・前払式支払手段）に関わります。
 *   ここでの壊れ方は、画面上ではきれいに見えます。
 *
 *     ・「まだ決めていない」を「期限なし」と表示してしまう
 *       → 画面はきれいになります。きれいになるから、誰も直しません。
 *         お店は「決めた覚えがないのに決まっていた」ことになります。
 *
 *     ・こちらが「90日」のような既定値を入れてしまう
 *       → 法律を避ける目的で、こちらが期間を選んだことになります。
 *         それは、こちらが法律の判断をしたのと同じです。
 *
 *     ・「専門家に確認した」を、保存しただけで自動で立ててしまう
 *       → 確認していないことが、確認済みとして記録に残ります。
 *         その記録は、あとで誰の役にも立ちません。
 *
 *     ・期間を変えたのに、前の「確認済み」が残ってしまう
 *       → 確かめていない内容が、確認済みに見えます。
 *
 *     ・設定を保存できるようになっただけで enforced を true にしてしまう
 *       → 「設定したのに消えていない」と言われたとき、
 *         こちらの記録では説明できなくなります。
 *
 *   ★どれも「エラーが出ない壊れ方」です。
 *     だから、人の確認ではなく、ここで機械に固定します。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { db, resetDbForTests } from "../lib/server/db";
import { createTenant } from "../lib/server/seed";
import { verifyAuditOfTenant } from "../lib/server/audit";
import {
  getPointPolicy,
  savePointPolicy,
  policyLabel,
  policyBlocker,
  PointPolicyError,
  MAX_DAYS,
  MAX_MONTHS,
} from "../lib/server/pointPolicy";
import type { Actor } from "../lib/server/orders";

const ADMIN: Actor = {
  kind: "ADMIN",
  id: "adm_test",
  name: "試験の管理者",
  role: "SUPER_ADMIN",
};

let n = 0;
async function tenant(): Promise<string> {
  n += 1;
  return createTenant({ code: `pol${n}`, name: `期限試験${n}` });
}

/** その種類の監査記録が何件あるか */
async function kansaKazu(tenantId: string, action: string): Promise<number> {
  const res = await db().execute({
    sql: `SELECT COUNT(*) AS c FROM audit_events WHERE tenant_id = ? AND action = ?`,
    args: [tenantId, action],
  });
  return Number((res.rows[0] as Record<string, unknown>)?.c ?? 0);
}

after(async () => {
  await resetDbForTests();
});

/* ═══════════════════════════════════════════════════════
   ① いちばん大事な一本
   ═══════════════════════════════════════════════════════ */

test("新しいお店は「まだ決めていない」から始まり、それを「期限なし」と言わない", async () => {
  const t = await tenant();

  const p = await getPointPolicy(t);

  assert.equal(p.mode, "UNSET");
  assert.equal(p.value, null);
  assert.equal(p.decided, false);
  assert.equal(p.confirmedAt, null);

  /* ★ここがいちばん危ない訳し方。
       「期限なし」と表示した時点で、決めていないことが
       決めたことになってしまいます。 */
  assert.ok(
    !p.label.includes("有効期限なし"),
    `未設定を「期限なし」と表示してはいけません: ${p.label}`,
  );
  assert.ok(p.label.includes("未設定"), `未設定と分かる言い方にすること: ${p.label}`);
});

test("行が1件も無いことを、エラーにしない（新しいお店は必ずこの状態）", async () => {
  const t = await tenant();
  const res = await db().execute({
    sql: `SELECT COUNT(*) AS c FROM tenant_point_policy WHERE tenant_id = ?`,
    args: [t],
  });
  assert.equal(Number((res.rows[0] as Record<string, unknown>).c), 0);

  /* ここで例外が飛ばないこと自体が、この試験の中身です */
  const p = await getPointPolicy(t);
  assert.equal(p.mode, "UNSET");
});

/* ═══════════════════════════════════════════════════════
   ② 「決めた」を消す道を作らない
   ═══════════════════════════════════════════════════════ */

test("「まだ決めていない」に戻す保存は、受け付けない", async () => {
  const t = await tenant();

  await savePointPolicy({
    tenantId: t,
    mode: "DAYS",
    value: 180,
    confirmed: true,
    actor: ADMIN,
    requestId: "req_a",
  });

  await assert.rejects(
    () =>
      savePointPolicy({
        tenantId: t,
        mode: "UNSET",
        value: null,
        confirmed: false,
        actor: ADMIN,
        requestId: "req_b",
      }),
    (e: unknown) => e instanceof PointPolicyError && e.code === "MODE_REQUIRED",
  );

  /* 決めた記録が、そのまま残っていること */
  const p = await getPointPolicy(t);
  assert.equal(p.mode, "DAYS");
  assert.equal(p.value, 180);
});

test("空・知らない言葉での保存も、受け付けない", async () => {
  const t = await tenant();

  await assert.rejects(
    () =>
      savePointPolicy({
        tenantId: t,
        mode: "",
        value: null,
        confirmed: false,
        actor: ADMIN,
        requestId: "req_c",
      }),
    (e: unknown) => e instanceof PointPolicyError && e.code === "MODE_REQUIRED",
  );

  await assert.rejects(
    () =>
      savePointPolicy({
        tenantId: t,
        mode: "FOREVER",
        value: null,
        confirmed: false,
        actor: ADMIN,
        requestId: "req_d",
      }),
    (e: unknown) => e instanceof PointPolicyError && e.code === "BAD_MODE",
  );

  /* 何も保存されていないこと */
  assert.equal((await getPointPolicy(t)).decided, false);
});

/* ═══════════════════════════════════════════════════════
   ③ 打ち間違いの幅
   ═══════════════════════════════════════════════════════ */

test("期間が範囲の外なら断る（0・マイナス・大きすぎ・数でない）", async () => {
  const t = await tenant();

  const dame = [
    { mode: "DAYS", value: 0 },
    { mode: "DAYS", value: -1 },
    { mode: "DAYS", value: MAX_DAYS + 1 },
    { mode: "DAYS", value: "きのう" },
    { mode: "MONTHS", value: 0 },
    { mode: "MONTHS", value: MAX_MONTHS + 1 },
  ];

  for (const d of dame) {
    await assert.rejects(
      () =>
        savePointPolicy({
          tenantId: t,
          mode: d.mode,
          value: d.value,
          confirmed: false,
          actor: ADMIN,
          requestId: "req_e",
        }),
      (e: unknown) => e instanceof PointPolicyError && e.code === "BAD_VALUE",
      `${d.mode}=${String(d.value)} は断ること`,
    );
  }

  assert.equal((await getPointPolicy(t)).decided, false);
});

test("範囲の内側なら保存でき、読み直しても同じ", async () => {
  const t = await tenant();

  await savePointPolicy({
    tenantId: t,
    mode: "MONTHS",
    value: 6,
    confirmed: false,
    actor: ADMIN,
    requestId: "req_f",
  });

  const p = await getPointPolicy(t);
  assert.equal(p.mode, "MONTHS");
  assert.equal(p.value, 6);
  assert.equal(p.decided, true);
  assert.equal(p.label, "購入から 6 か月");
});

/* ═══════════════════════════════════════════════════════
   ④ 「期限なし」も、立派な1つの決定
   ═══════════════════════════════════════════════════════ */

test("「期限なし」を選んだら、それは決めたことになる", async () => {
  const t = await tenant();

  const p = await savePointPolicy({
    tenantId: t,
    mode: "NONE",
    value: null,
    confirmed: true,
    actor: ADMIN,
    requestId: "req_g",
  });

  assert.equal(p.mode, "NONE");
  assert.equal(p.value, null);
  assert.equal(p.decided, true);
  assert.equal(p.label, "有効期限なし");
  assert.equal(policyBlocker(p), null);
});

/* ═══════════════════════════════════════════════════════
   ⑤ 「専門家に確認した」を、こちらで埋めない
   ═══════════════════════════════════════════════════════ */

test("確認のチェックが入っていなければ、確認日は空のまま", async () => {
  const t = await tenant();

  const p = await savePointPolicy({
    tenantId: t,
    mode: "DAYS",
    value: 90,
    confirmed: false,
    actor: ADMIN,
    requestId: "req_h",
  });

  assert.equal(p.confirmedAt, null);
  assert.equal((await getPointPolicy(t)).confirmedAt, null);

  /* 決まってはいるが、確認記録が無い、と案内すること */
  const b = policyBlocker(p);
  assert.ok(b !== null);
  assert.ok(b!.includes("専門家"), b ?? "");
});

test("期間を変えたら、前の「確認済み」は引き継がれない", async () => {
  const t = await tenant();

  const mae = await savePointPolicy({
    tenantId: t,
    mode: "DAYS",
    value: 90,
    confirmed: true,
    actor: ADMIN,
    requestId: "req_i",
  });
  assert.ok(mae.confirmedAt !== null);

  /* ★中身が変わったのだから、前の確認は、この内容の確認ではありません */
  const ato = await savePointPolicy({
    tenantId: t,
    mode: "DAYS",
    value: 365,
    confirmed: false,
    actor: ADMIN,
    requestId: "req_j",
  });

  assert.equal(ato.value, 365);
  assert.equal(ato.confirmedAt, null);
  assert.equal((await getPointPolicy(t)).confirmedAt, null);
});

test("確認のチェックを外して保存し直したら、確認済みも外れる", async () => {
  const t = await tenant();

  await savePointPolicy({
    tenantId: t,
    mode: "MONTHS",
    value: 12,
    confirmed: true,
    actor: ADMIN,
    requestId: "req_k",
  });

  /* 中身は同じまま、チェックだけ外す */
  const ato = await savePointPolicy({
    tenantId: t,
    mode: "MONTHS",
    value: 12,
    confirmed: false,
    actor: ADMIN,
    requestId: "req_l",
  });

  assert.equal(ato.confirmedAt, null);
});

test("中身が変わらなければ、最初に確認した日はそのまま（後ろへずれない）", async () => {
  const t = await tenant();

  const mae = await savePointPolicy({
    tenantId: t,
    mode: "MONTHS",
    value: 12,
    confirmed: true,
    actor: ADMIN,
    requestId: "req_m",
    now: "2026-01-01T00:00:00.000Z",
  });

  const ato = await savePointPolicy({
    tenantId: t,
    mode: "MONTHS",
    value: 12,
    confirmed: true,
    actor: ADMIN,
    requestId: "req_n",
    now: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(ato.confirmedAt, mae.confirmedAt);
  assert.equal(ato.confirmedAt, "2026-01-01T00:00:00.000Z");
});

/* ═══════════════════════════════════════════════════════
   ⑥ 保存しても、1ptも消えない
   ═══════════════════════════════════════════════════════ */

test("どんな決め方をしても、いまは失効させない（enforced は必ず false）", async () => {
  const t = await tenant();

  for (const k of [
    { mode: "NONE", value: null },
    { mode: "DAYS", value: 30 },
    { mode: "MONTHS", value: 24 },
  ]) {
    const p = await savePointPolicy({
      tenantId: t,
      mode: k.mode,
      value: k.value,
      confirmed: true,
      actor: ADMIN,
      requestId: "req_o",
    });
    assert.equal(p.enforced, false, `${k.mode} で enforced が true になっています`);
    assert.equal((await getPointPolicy(t)).enforced, false);
  }
});

test("失効させる処理を、まだどこにも作っていないこと", async () => {
  /* ★ここが緩むと「設定したのに消えない」ではなく
       「気づかないうちに消えた」に変わります。
       消す処理を作るのは、お店が値を決め、専門家の確認が済んだあとです。 */
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(
    new URL("../lib/server/pointPolicy.ts", import.meta.url),
    "utf8",
  );

  assert.ok(
    !/DELETE\s+FROM\s+point_ledger/i.test(src),
    "台帳を消す文が入っています",
  );
  assert.ok(
    !/UPDATE\s+customers\s+SET\s+points/i.test(src),
    "残高を動かす文が入っています",
  );
});

/* ═══════════════════════════════════════════════════════
   ⑦ 壊れた値が入っていても、「期限なし」に読み替えない
   ═══════════════════════════════════════════════════════ */

test("読めない値が保存されていたら「未設定」に倒す（期限なしにしない）", async () => {
  const t = await tenant();

  await db().execute({
    sql: `INSERT INTO tenant_point_policy
            (tenant_id, expiry_mode, expiry_value, confirmed_at, updated_at, updated_by)
          VALUES (?,?,?,?,?,?)`,
    args: [t, "ETERNAL", null, null, "2026-01-01T00:00:00.000Z", "こわれた値"],
  });

  const p = await getPointPolicy(t);
  assert.equal(p.mode, "UNSET");
  assert.equal(p.decided, false);
  assert.ok(!p.label.includes("有効期限なし"), p.label);
  assert.ok(policyBlocker(p) !== null);
});

/* ═══════════════════════════════════════════════════════
   ⑧ 見せる日本語を、画面ごとに書き直させない
   ═══════════════════════════════════════════════════════ */

test("同じ決まりは、いつでも同じ日本語になる", () => {
  assert.equal(policyLabel("NONE", null), "有効期限なし");
  assert.equal(policyLabel("DAYS", 180), "購入から 180 日");
  assert.equal(policyLabel("MONTHS", 6), "購入から 6 か月");
  assert.equal(policyLabel("UNSET", null), "未設定（お店がまだ決めていません）");

  /* 桁が多いときに読みやすいこと（打ち間違いに気づけます） */
  assert.equal(policyLabel("DAYS", 1000), "購入から 1,000 日");
});

/* ═══════════════════════════════════════════════════════
   ⑨ 公開前の止め方
   ═══════════════════════════════════════════════════════ */

test("決めていないお店は、公開前に止まる（勝手に「期限なし」で通さない）", async () => {
  const t = await tenant();
  const p = await getPointPolicy(t);

  const b = policyBlocker(p);
  assert.ok(b !== null, "未設定のまま公開できてしまいます");
  assert.ok(b!.includes("有効期限"), b ?? "");
  /* ★こちらでは決められない、と書いてあること */
  assert.ok(b!.includes("お店"), b ?? "");
});

/* ═══════════════════════════════════════════════════════
   ⑩ 誰が決めたのかを、記録だけで言えること
   ═══════════════════════════════════════════════════════ */

test("保存すると監査に残り、監査の鎖も切れない", async () => {
  const t = await tenant();

  assert.equal(await kansaKazu(t, "POINT_POLICY_UPDATED"), 0);

  await savePointPolicy({
    tenantId: t,
    mode: "DAYS",
    value: 180,
    confirmed: true,
    actor: ADMIN,
    requestId: "req_p",
  });

  assert.equal(await kansaKazu(t, "POINT_POLICY_UPDATED"), 1);

  const res = await db().execute({
    sql: `SELECT summary, before_text, after_text, actor_name
            FROM audit_events
           WHERE tenant_id = ? AND action = 'POINT_POLICY_UPDATED'`,
    args: [t],
  });
  const row = res.rows[0] as Record<string, unknown>;
  assert.equal(String(row.actor_name), ADMIN.name);
  assert.ok(String(row.summary).includes("購入から 180 日"), String(row.summary));
  /* 前の状態が「未設定」だったことも残っていること */
  assert.ok(String(row.before_text).includes("未設定"), String(row.before_text));
  assert.ok(String(row.after_text).includes("180"), String(row.after_text));

  const v = await verifyAuditOfTenant(db(), t);
  assert.equal(v.ok, true);
});

test("断られた保存は、監査に残らない（決めていないのに記録だけ残さない）", async () => {
  const t = await tenant();

  await assert.rejects(() =>
    savePointPolicy({
      tenantId: t,
      mode: "DAYS",
      value: 99999,
      confirmed: true,
      actor: ADMIN,
      requestId: "req_q",
    }),
  );

  assert.equal(await kansaKazu(t, "POINT_POLICY_UPDATED"), 0);
});

/* ═══════════════════════════════════════════════════════
   ⑪ お店どうしが混ざらないこと
   ═══════════════════════════════════════════════════════ */

test("A社の決まりが、B社に見えない", async () => {
  const a = await tenant();
  const b = await tenant();

  await savePointPolicy({
    tenantId: a,
    mode: "DAYS",
    value: 30,
    confirmed: true,
    actor: ADMIN,
    requestId: "req_r",
  });

  const pb = await getPointPolicy(b);
  assert.equal(pb.mode, "UNSET");
  assert.equal(pb.decided, false);

  const pa = await getPointPolicy(a);
  assert.equal(pa.value, 30);
});
