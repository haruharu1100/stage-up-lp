/**
 * 会員管理（一覧・絞り込み・詳細・利用停止・停止解除）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   ① 会員数は、絞り込んでも減らない
 *      検索するたびに「会員数」が減る画面は、
 *      その日から誰にも信じてもらえません。
 *
 *   ② 金額を見られない人には null が入る（0 にしない）
 *      Number(null) は 0 です。その1行で
 *      「見せられない」が「1円も使っていない」に化けます。
 *
 *   ③ 住所そのものは、この画面へ返さない
 *      毎日開く画面に住所を並べておくと、
 *      背後から覗かれただけで漏れます。
 *
 *   ④ 危険度は fraud_flags の未処理だけから作る
 *      Dashboard の「高Riskユーザー」と同じ数え方であること。
 *      ここに別の条件を足すと、2つの画面で人数が食い違います。
 *
 *   ⑤ ポイントの食い違いを、危険度に混ぜない
 *      混ぜると、どちらの理由で印が付いたのかが読めなくなります。
 *
 *   ⑥ 理由の無い停止は通らない
 *
 *   ⑦ すでにその状態なら断る（黙って成功にしない）
 *
 *   ⑧ 他社の会員は、IDを知っていても見つからない・止められない
 *
 *   ⑨ 止めたら、その場でログアウトさせる
 *
 *   ⑩ 停止も解除も、理由つきで監査ログに残る
 *
 *   ⑪ 知らない状態を ACTIVE に丸めない
 *
 *   ⑫ ログインの記録を引けないことを「0件」と書かない
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
/* ★画面のソースを、そのまま読んで確かめるために使う */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, resetDbForTests } from "../lib/server/db";
import { createTenant, createCustomer } from "../lib/server/seed";
import {
  CustomerAdminError,
  customerDetail,
  customerList,
  maskEmail,
  setCustomerSuspended,
} from "../lib/server/customerAdmin";
/* ★台帳を通さずに残高を壊せる、ただ1つの出口。手元の使い捨てDBでしか動かない */
import { breakBalanceForTest } from "../scripts/lib/fixtures-danger.mjs";

after(async () => {
  await resetDbForTests();
});

const BY = { adminId: "adm_test", name: "試験の人", role: "SUPER_ADMIN" };

let renban = 0;
function code(): string {
  renban += 1;
  return `CU${String(Date.now() % 100000)}${renban}`;
}

/** 投げられた失敗の code を取り出す */
async function codeOf(f: () => Promise<unknown>): Promise<string> {
  try {
    await f();
  } catch (e) {
    if (e instanceof CustomerAdminError) return e.code;
    return `別の失敗：${(e as Error).message}`;
  }
  return "（失敗しませんでした）";
}

async function auditRows(tenantId: string, action: string) {
  const r = await db().execute({
    sql: `SELECT * FROM audit_events WHERE tenant_id = ? AND action = ? ORDER BY seq ASC`,
    args: [tenantId, action],
  });
  return r.rows as Record<string, unknown>[];
}

/** 不正の手がかりを1件入れる */
async function addFlag(
  tenantId: string,
  userId: string,
  severity: string,
  status: string,
) {
  await db().execute({
    sql: `INSERT INTO fraud_flags
            (id, tenant_id, user_id, kind, severity, status, detail, created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      `ff_${Math.random().toString(36).slice(2)}`,
      tenantId,
      userId,
      "SAME_DEVICE",
      severity,
      status,
      "同じ端末から複数のアカウント",
      new Date().toISOString(),
    ],
  });
}

/* ══════════════════════════════════════════════
   ① 会員数は、絞り込んでも減らない
   ══════════════════════════════════════════════ */

test("★絞り込んでも、会員数（全体）は減らない", async () => {
  const t = await createTenant({ code: code(), name: "会員社A" });
  await createCustomer({ tenantId: t, no: 1, name: "架空 一郎", points: 100, email: "a@x.example" });
  await createCustomer({ tenantId: t, no: 2, name: "架空 二郎", points: 0, email: "b@x.example" });
  await createCustomer({ tenantId: t, no: 3, name: "架空 三郎", points: 50, email: "c@x.example" });

  const zenbu = await customerList(t, "SUPER_ADMIN");
  assert.equal(zenbu.total, 3);
  assert.equal(zenbu.counts.all, 3);

  const shibori = await customerList(t, "SUPER_ADMIN", { q: "一郎" });
  assert.equal(shibori.total, 1, "絞り込んだ結果は1件");
  assert.equal(
    shibori.counts.all,
    3,
    "★会員数（全体）は3のまま。検索で会社の会員数が減ってはいけない",
  );
});

test("★検索は、会員番号・お名前・メールのどれでも当たる", async () => {
  const t = await createTenant({ code: code(), name: "会員社B" });
  await createCustomer({ tenantId: t, no: 7, name: "架空 花子", points: 10, email: "hanako@x.example" });

  const byName = await customerList(t, "SUPER_ADMIN", { q: "花子" });
  assert.equal(byName.total, 1);

  const byMail = await customerList(t, "SUPER_ADMIN", { q: "hanako" });
  assert.equal(byMail.total, 1);

  const byNo = await customerList(t, "SUPER_ADMIN", { q: byName.rows[0].displayId });
  assert.equal(byNo.total, 1);

  const hazure = await customerList(t, "SUPER_ADMIN", { q: "いない人" });
  assert.equal(hazure.total, 0);
  assert.equal(hazure.counts.all, 1, "見つからなくても、会員数は変わらない");
});

/* ══════════════════════════════════════════════
   ② 金額は、見せてよい人にだけ入る
   ══════════════════════════════════════════════ */

test("★金額を見られない役割には、0ではなく null が入る", async () => {
  const t = await createTenant({ code: code(), name: "会員社C" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 金太", points: 0, email: "k@x.example" });
  await db().execute({
    sql: `UPDATE customers SET spent = 12345 WHERE tenant_id = ? AND id = ?`,
    args: [t, c],
  });

  const mieru = await customerList(t, "FINANCE");
  assert.equal(mieru.canSeeMoney, true);
  assert.equal(mieru.rows[0].spent, 12345);

  const mienai = await customerList(t, "SUPPORT");
  assert.equal(mienai.canSeeMoney, false);
  assert.equal(
    mienai.rows[0].spent,
    null,
    "★0 にしないこと。0 は「1円も使っていない」という別の意味になる",
  );

  /* 役割が読み取れなかったときも、見せない */
  const fumei = await customerList(t, null);
  assert.equal(fumei.canSeeMoney, false);
  assert.equal(fumei.rows[0].spent, null);
});

test("★詳細でも、見せられない人には金額を渡さない", async () => {
  const t = await createTenant({ code: code(), name: "会員社D" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 金次", points: 0, email: "k2@x.example" });

  const mienai = await customerDetail(t, c, "VIEWER");
  assert.ok(mienai);
  assert.equal(mienai.spent, null);
});

/* ══════════════════════════════════════════════
   ③ 住所そのものは返さない
   ══════════════════════════════════════════════ */

test("★住所そのものは、会員管理へ返さない（持っているかどうかだけ）", async () => {
  const t = await createTenant({ code: code(), name: "会員社E" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 住子", points: 0, email: "j@x.example" });
  await db().execute({
    sql: `UPDATE customers SET address = ? WHERE tenant_id = ? AND id = ?`,
    args: ["大阪府どこか1-2-3", t, c],
  });

  const d = await customerDetail(t, c, "SUPER_ADMIN");
  assert.ok(d);
  assert.equal(d.hasAddress, true, "持っていることは分かる");
  assert.equal(
    JSON.stringify(d).includes("大阪府どこか1-2-3"),
    false,
    "★住所の中身が、どこにも入っていないこと",
  );
});

test("★メールは、一覧では伏せ字にする", () => {
  assert.equal(maskEmail("hanako@example.com"), "h***@e***.com");
  assert.equal(maskEmail(null), null, "無いものを「***」にしない");
});

/* ══════════════════════════════════════════════
   ④⑤ 危険度は fraud_flags の未処理だけから作る
   ══════════════════════════════════════════════ */

test("★危険度は、未処理の不正フラグだけから作る", async () => {
  const t = await createTenant({ code: code(), name: "会員社F" });
  const a = await createCustomer({ tenantId: t, no: 1, name: "架空 危一", points: 0, email: "r1@x.example" });
  const b = await createCustomer({ tenantId: t, no: 2, name: "架空 危二", points: 0, email: "r2@x.example" });
  const c = await createCustomer({ tenantId: t, no: 3, name: "架空 安全", points: 0, email: "r3@x.example" });

  await addFlag(t, a, "HIGH", "OPEN");
  await addFlag(t, b, "MEDIUM", "OPEN");
  /* 処理済みのフラグは、危険度に数えない */
  await addFlag(t, c, "HIGH", "REVIEWED");

  const l = await customerList(t, "SUPER_ADMIN");
  const byId = new Map(l.rows.map((x) => [x.id, x]));
  assert.equal(byId.get(a)!.risk, "HIGH");
  assert.equal(byId.get(b)!.risk, "MEDIUM");
  assert.equal(
    byId.get(c)!.risk,
    "NONE",
    "★処理済みのフラグを、危険度に残さないこと",
  );

  assert.equal(l.counts.highRisk, 1, "高Riskは1名（Dashboardと同じ数え方）");
});

test("★知らない severity を、HIGH に上げない", async () => {
  const t = await createTenant({ code: code(), name: "会員社G" });
  const a = await createCustomer({ tenantId: t, no: 1, name: "架空 未知", points: 0, email: "u@x.example" });
  await addFlag(t, a, "CRITICAL", "OPEN");

  const l = await customerList(t, "SUPER_ADMIN");
  assert.equal(
    l.rows[0].risk,
    "NONE",
    "★知らない言葉を、勝手にいちばん重い扱いにしないこと",
  );
});

test("★危険度で絞り込める", async () => {
  const t = await createTenant({ code: code(), name: "会員社H" });
  const a = await createCustomer({ tenantId: t, no: 1, name: "架空 高", points: 0, email: "h1@x.example" });
  await createCustomer({ tenantId: t, no: 2, name: "架空 無", points: 0, email: "h2@x.example" });
  await addFlag(t, a, "HIGH", "OPEN");

  const high = await customerList(t, "SUPER_ADMIN", { risk: "HIGH" });
  assert.equal(high.total, 1);
  assert.equal(high.rows[0].id, a);
  assert.equal(high.counts.all, 2, "絞っても会員数は変わらない");

  const none = await customerList(t, "SUPER_ADMIN", { risk: "NONE" });
  assert.equal(none.total, 1);
});

test("★ポイントの食い違いを、危険度に混ぜない", async () => {
  const t = await createTenant({ code: code(), name: "会員社I" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 不一致", points: 1000, email: "m@x.example" });

  /*
   * 台帳を触らずに残高だけ動かす＝記録に残っていないポイントが動いた状態。
   *
   * ★ここだけは、わざと壊さないと確かめられません。
   *   台帳経由でしか動かせないなら、食い違いは一生作れないので、
   *   「食い違いを見つけて赤く出す」機能を試せなくなります。
   *
   *   ですので、壊す道具は scripts/lib/fixtures-danger.mjs に隔離し、
   *   手元の使い捨てDBでしか動かないようにしてあります。
   *   Preview や本番につながっていれば、呼んだ瞬間に止まります。
   */
  await breakBalanceForTest(db, {
    tenantId: t,
    userId: c,
    delta: 9999 - 1000,
    naze: "台帳と残高の食い違いを、画面が見つけられるか確かめる",
  });

  const l = await customerList(t, "SUPER_ADMIN");
  const row = l.rows[0];
  assert.equal(row.ledgerMismatch, true, "食い違いは、食い違いとして出す");
  assert.equal(
    row.risk,
    "NONE",
    "★食い違いを危険度に混ぜないこと。混ぜると、どちらの理由で印が付いたか読めなくなる",
  );
  assert.equal(l.counts.mismatch, 1);

  const only = await customerList(t, "SUPER_ADMIN", { onlyMismatch: true });
  assert.equal(only.total, 1);
});

test("★台帳が0件・残高0の人を、食い違い扱いにしない", async () => {
  const t = await createTenant({ code: code(), name: "会員社J" });
  await createCustomer({ tenantId: t, no: 1, name: "架空 新人", points: 0, email: "n@x.example" });

  const l = await customerList(t, "SUPER_ADMIN");
  assert.equal(l.rows[0].ledgerRows, 0);
  assert.equal(
    l.rows[0].ledgerMismatch,
    false,
    "行が1つも無い 0pt は、食い違いではない",
  );
  assert.equal(l.counts.mismatch, 0);
});

/* ══════════════════════════════════════════════
   ⑪ 知らない状態を ACTIVE に丸めない
   ══════════════════════════════════════════════ */

test("★知らない状態を、通常（ACTIVE）に丸めない", async () => {
  const t = await createTenant({ code: code(), name: "会員社K" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 変則", points: 0, email: "x@x.example" });
  await db().execute({
    sql: `UPDATE customers SET status = 'FROZEN' WHERE tenant_id = ? AND id = ?`,
    args: [t, c],
  });

  const l = await customerList(t, "SUPER_ADMIN");
  assert.equal(l.rows[0].status, "OTHER");
  assert.equal(l.rows[0].statusRaw, "FROZEN", "元の言葉も、そのまま渡すこと");
  assert.equal(l.counts.active, 0);
  assert.equal(l.counts.other, 1);

  const other = await customerList(t, "SUPER_ADMIN", { status: "OTHER" });
  assert.equal(other.total, 1);
});

/* ══════════════════════════════════════════════
   ⑥⑦ 理由が無い停止・すでにその状態
   ══════════════════════════════════════════════ */

test("★理由が短い停止は、通らない", async () => {
  const t = await createTenant({ code: code(), name: "会員社L" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 停止", points: 0, email: "s@x.example" });

  assert.equal(
    await codeOf(() =>
      setCustomerSuspended({ tenantId: t, customerId: c, suspend: true, reason: "", by: BY }),
    ),
    "NO_REASON",
  );
  assert.equal(
    await codeOf(() =>
      setCustomerSuspended({ tenantId: t, customerId: c, suspend: true, reason: "うむ", by: BY }),
    ),
    "NO_REASON",
    "4文字未満は通さない",
  );

  const after = await customerList(t, "SUPER_ADMIN");
  assert.equal(after.rows[0].status, "ACTIVE", "断られたら、状態は変わっていないこと");
});

test("★すでに停止している会員を、黙ってもう一度止めない", async () => {
  const t = await createTenant({ code: code(), name: "会員社M" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 二度", points: 0, email: "d@x.example" });

  await setCustomerSuspended({
    tenantId: t, customerId: c, suspend: true, reason: "確認のため停止", by: BY,
  });
  assert.equal(
    await codeOf(() =>
      setCustomerSuspended({
        tenantId: t, customerId: c, suspend: true, reason: "もう一度停止", by: BY,
      }),
    ),
    "SAME_VALUE",
  );

  const logs = await auditRows(t, "CUSTOMER_SUSPEND");
  assert.equal(logs.length, 1, "★同じ記録が2行並ばないこと（2回止めたと読み違えられる）");
});

test("★止まっていない会員の解除は、断る", async () => {
  const t = await createTenant({ code: code(), name: "会員社N" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 通常", points: 0, email: "e@x.example" });

  assert.equal(
    await codeOf(() =>
      setCustomerSuspended({
        tenantId: t, customerId: c, suspend: false, reason: "解除してみる", by: BY,
      }),
    ),
    "SAME_VALUE",
  );
});

/* ══════════════════════════════════════════════
   ⑧ 他社の会員は、見つからない・止められない
   ══════════════════════════════════════════════ */

test("★他社の会員は、IDを知っていても見つからない・止められない", async () => {
  const a = await createTenant({ code: code(), name: "A社" });
  const b = await createTenant({ code: code(), name: "B社" });
  const bCustomer = await createCustomer({
    tenantId: b, no: 1, name: "B社の架空", points: 500, email: "b1@x.example",
  });

  /* A社の一覧に、B社の会員は出ない */
  const l = await customerList(a, "SUPER_ADMIN");
  assert.equal(l.total, 0);
  assert.equal(l.counts.all, 0);

  /* IDを知っていても、詳細は取れない */
  assert.equal(
    await customerDetail(a, bCustomer, "SUPER_ADMIN"),
    null,
    "★「他社の会員です」と教えないこと。有る無しだけで中身が推測できる",
  );

  /* 止められない */
  assert.equal(
    await codeOf(() =>
      setCustomerSuspended({
        tenantId: a, customerId: bCustomer, suspend: true, reason: "他社を止めてみる", by: BY,
      }),
    ),
    "NOT_FOUND",
  );

  /* B社側は、無事なまま */
  const bl = await customerList(b, "SUPER_ADMIN");
  assert.equal(bl.rows[0].status, "ACTIVE");
  assert.equal((await auditRows(a, "CUSTOMER_SUSPEND")).length, 0);
});

/* ══════════════════════════════════════════════
   ⑨ 止めたら、その場でログアウトさせる
   ══════════════════════════════════════════════ */

test("★止めたら、開いていた画面のセッションも消える", async () => {
  const t = await createTenant({ code: code(), name: "会員社O" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 在席", points: 0, email: "o@x.example" });

  const now = new Date();
  await db().execute({
    sql: `INSERT INTO sessions
            (id, tenant_id, subject_kind, subject_id, token_hash, created_at, expires_at)
          VALUES (?,?,?,?,?,?,?)`,
    args: [
      "ses_test_customer",
      t,
      "CUSTOMER",
      c,
      "hash_dummy",
      now.toISOString(),
      new Date(now.getTime() + 3600_000).toISOString(),
    ],
  });

  const before = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM sessions WHERE tenant_id = ? AND subject_id = ?`,
    args: [t, c],
  });
  assert.equal(Number((before.rows[0] as Record<string, unknown>).n), 1);

  await setCustomerSuspended({
    tenantId: t, customerId: c, suspend: true, reason: "不審な購入のため停止", by: BY,
  });

  const after = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM sessions WHERE tenant_id = ? AND subject_id = ?`,
    args: [t, c],
  });
  assert.equal(
    Number((after.rows[0] as Record<string, unknown>).n),
    0,
    "★止めたのに、その人の画面が開いたまま、を無くす",
  );
});

/* ══════════════════════════════════════════════
   ⑩ 停止も解除も、理由つきで監査ログに残る
   ══════════════════════════════════════════════ */

test("★停止と解除は、理由つきで監査ログに残る", async () => {
  const t = await createTenant({ code: code(), name: "会員社P" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 記録", points: 0, email: "p@x.example" });

  await setCustomerSuspended({
    tenantId: t, customerId: c, suspend: true, reason: "同一端末からの大量購入のため", by: BY,
  });
  await setCustomerSuspended({
    tenantId: t, customerId: c, suspend: false, reason: "本人確認が取れたため解除", by: BY,
  });

  const logs = await auditRows(t, "CUSTOMER_SUSPEND");
  assert.equal(logs.length, 2);

  for (const l of logs) {
    assert.ok(String(l.reason).trim().length >= 4, "理由が空の記録が無いこと");
    assert.equal(String(l.actor_id), BY.adminId);
    assert.equal(String(l.target), `customer:${c}`);
  }
  /* ★列名は before_text / after_text。
        before / after で読むと undefined が返り、
        「記録が残っていない」ことに気づけないまま合格してしまいます */
  assert.equal(String(logs[0].before_text), "利用中");
  assert.equal(String(logs[0].after_text), "停止中");
  assert.equal(String(logs[1].before_text), "停止中");
  assert.equal(String(logs[1].after_text), "利用中");

  /* ★担当者の停止（USER_SUSPEND）と、同じ名前で残さないこと */
  assert.equal(
    (await auditRows(t, "USER_SUSPEND")).length,
    0,
    "★会員の停止を、担当者の停止と同じ種類で残さないこと",
  );

  const l2 = await customerList(t, "SUPER_ADMIN");
  assert.equal(l2.rows[0].status, "ACTIVE", "解除したら、戻っていること");
});

test("★停止で絞り込める", async () => {
  const t = await createTenant({ code: code(), name: "会員社Q" });
  const a = await createCustomer({ tenantId: t, no: 1, name: "架空 止", points: 0, email: "q1@x.example" });
  await createCustomer({ tenantId: t, no: 2, name: "架空 動", points: 0, email: "q2@x.example" });
  await setCustomerSuspended({
    tenantId: t, customerId: a, suspend: true, reason: "確認のため停止", by: BY,
  });

  const susp = await customerList(t, "SUPER_ADMIN", { status: "SUSPENDED" });
  assert.equal(susp.total, 1);
  assert.equal(susp.rows[0].id, a);
  assert.equal(susp.counts.all, 2);
  assert.equal(susp.counts.suspended, 1);
  assert.equal(susp.counts.active, 1);
});

/* ══════════════════════════════════════════════
   ⑫ 引けないことを「0件」と書かない
   ══════════════════════════════════════════════ */

test("★メールが無い会員のログイン記録を、0件と言わない", async () => {
  const t = await createTenant({ code: code(), name: "会員社R" });
  const nashi = await createCustomer({ tenantId: t, no: 1, name: "架空 無メール", points: 0 });
  const ari = await createCustomer({ tenantId: t, no: 2, name: "架空 有メール", points: 0, email: "y@x.example" });

  const d1 = await customerDetail(t, nashi, "SUPER_ADMIN");
  assert.ok(d1);
  assert.equal(
    d1.loginsKnown,
    false,
    "★引く手がかりが無いことと、1度もログインしていないことは別",
  );
  assert.equal(d1.logins.length, 0);

  const d2 = await customerDetail(t, ari, "SUPER_ADMIN");
  assert.ok(d2);
  assert.equal(d2.loginsKnown, true);
});

test("★詳細は、9つの中身をそろえて返す", async () => {
  const t = await createTenant({ code: code(), name: "会員社S" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "架空 詳細", points: 300, email: "z@x.example" });

  const d = await customerDetail(t, c, "SUPER_ADMIN");
  assert.ok(d);
  /* ①会員情報 ②ポイント ③引いた記録 ④景品 ⑤注文 ⑥発送 ⑦問い合わせ ⑧危険度 ⑨ログイン */
  assert.equal(typeof d.displayId, "string");
  assert.ok(Array.isArray(d.ledger));
  assert.ok(Array.isArray(d.draws));
  assert.ok(Array.isArray(d.prizes));
  assert.ok(Array.isArray(d.orders));
  assert.ok(Array.isArray(d.shipments));
  assert.ok(Array.isArray(d.tickets));
  assert.ok(Array.isArray(d.flags));
  assert.ok(Array.isArray(d.logins));
  assert.ok(d.limit > 0, "一度に読む上限を、画面へも伝えること");
});

/* ══════════════════════════════════════════════
   画面そのものを読んで確かめる
   ══════════════════════════════════════════════ */

const SCREEN = join(__dirname, "..", "components", "console", "screens", "CustomersScreen.tsx");

test("★会員管理の画面が、見本データではなくサーバーを見ている", () => {
  const src = readFileSync(SCREEN, "utf8");

  assert.ok(
    src.includes("@/lib/console/liveCustomers"),
    "サーバーから読む口（liveCustomers）を使っていること",
  );
  assert.equal(
    src.includes("ConsoleState"),
    false,
    "★見本データ（ConsoleState）を受け取らないこと",
  );
  assert.equal(
    src.includes("ledgerBalance"),
    false,
    "★残高を画面で計算し直さないこと。数える場所が2つになる",
  );
  assert.equal(
    src.includes("DemoNote"),
    false,
    "★本物につながったら「架空です」の断り書きを外すこと",
  );
});

test("★会員管理の画面が、読み込み中・失敗・空っぽの3つを出している", () => {
  const src = readFileSync(SCREEN, "utf8");
  for (const parts of ["<Skeleton", "<ErrorBox", "<Empty"]) {
    assert.ok(src.includes(parts), `${parts} が置かれていること`);
  }
});

test("★会員管理の画面が、住所を出そうとしていない", () => {
  const src = readFileSync(SCREEN, "utf8");
  assert.equal(
    /\.address\b/.test(src),
    false,
    "★住所そのものを画面で読もうとしないこと（サーバーも返しません）",
  );
});

test("★停止の理由が、4文字未満では押せないようになっている", () => {
  const src = readFileSync(SCREEN, "utf8");
  assert.ok(
    src.includes("reason.trim().length < 4"),
    "理由が短いうちは、押せないこと（守りはサーバー側にもあります）",
  );
});

test("★会員管理の入口が、見る権限と止める権限を分けている", () => {
  const list = readFileSync(
    join(__dirname, "..", "app", "api", "console", "customers", "route.ts"),
    "utf8",
  );
  const action = readFileSync(
    join(__dirname, "..", "app", "api", "console", "customers", "action", "route.ts"),
    "utf8",
  );

  assert.ok(list.includes(`permission: "point.view"`), "見るのは point.view");
  assert.ok(
    action.includes(`permission: "user.suspend"`),
    "★止めるのは user.suspend。ここを point.view にすると、閲覧のみの担当者がお客様を止められる",
  );
  /* ★入口をキャッシュしないこと。止めた直後に、止まっていない一覧が出ます */
  assert.ok(list.includes(`dynamic = "force-dynamic"`));
  assert.ok(action.includes(`dynamic = "force-dynamic"`));
});
