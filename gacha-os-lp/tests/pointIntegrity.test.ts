/**
 * 台帳と残高が食い違ったとき、画面が黙らずに赤く言えるか。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験がここにあるのか
 * ═══════════════════════════════════════════════════════
 *
 *   この確認は、もともと Preview（公開している検証環境）で
 *   やっていました。やり方はこうです。
 *
 *       ① 残高だけを直接 +777 する（台帳は動かさない）
 *       ② 画面が「合っていない」と言うか見る
 *       ③ 残高を −777 して戻す
 *
 *   ②が通っている限り、これは正しい確認に見えます。
 *   ですが、①と③のあいだで1つでも失敗すると、③に届きません。
 *   実際に届かず、Preview のお客様に
 *
 *       「残高はあるのに、台帳にその理由が無い」
 *
 *   人が残りました。3名です。
 *   点検の道具が、点検している当の帳簿を壊していた、ということです。
 *
 *   ★ここが肝心です。
 *     壊れ方が悪いのではありません。「壊しては戻す」という
 *     やり方そのものが、いつか必ず戻し忘れる、という話です。
 *     人が気をつけて防げるものではありません。
 *
 *   ですので、壊す確認は、手元の使い捨てDBへ移しました。
 *   ここなら、途中で失敗しても、誰の帳簿も汚れません。
 *   使い捨てDBは、この試験が終わるたびに捨てられます。
 *
 *   Preview 側（scripts/check-points-preview.mjs）に残したのは、
 *
 *       画面が言う「合っていない人数」＝ DBを数え直した人数
 *
 *   の突き合わせだけです。0人でも2人でも正しく成り立ちます。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   ① 食い違ったら、一覧で MISMATCH になる（黙らない）
 *   ② 差の大きさが、実際の差と一致する
 *   ③ 詳細でも、同じ差が出る（一覧と詳細で食い違わない）
 *   ④ 「合っていない人だけ」の絞り込みに、その人が出る
 *   ⑤ 直したら OK に戻る（言いっぱなしにしない）
 *   ⑥ 食い違いを、危険度（risk）に混ぜない
 *   ⑦ ★壊す道具は、手元の使い捨てDBでしか動かない
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db, resetDbForTests } from "../lib/server/db";
import { createTenant, createCustomer } from "../lib/server/seed";
import { pointList, pointDetail } from "../lib/server/pointAdmin";
import { customerList } from "../lib/server/customerAdmin";
/* ★台帳を通さずに残高を壊せる、ただ1つの出口 */
import {
  breakBalanceForTest,
  restoreBalanceForTest,
  tsukaisuteDBだけ,
} from "../scripts/lib/fixtures-danger.mjs";

after(async () => {
  await resetDbForTests();
});

let renban = 0;
function code(): string {
  renban += 1;
  return `PI${String(Date.now() % 100000)}${renban}`;
}

/** 台帳の合計を、DBから数え直す */
async function daichouGoukei(tenantId: string, userId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COALESCE(SUM(delta), 0) AS n FROM point_ledger
           WHERE tenant_id = ? AND user_id = ?`,
    args: [tenantId, userId],
  });
  return Number(r.rows[0].n ?? 0);
}

test("★食い違ったら、一覧で赤く言う（黙らない）", async () => {
  const t = await createTenant({ code: code(), name: "点検社A" });
  const c = await createCustomer({
    tenantId: t,
    no: 1,
    name: "架空 いちろう",
    points: 5_000,
    email: `pi1-${Date.now()}@x.example`,
  });

  /* まず、合っている状態から始める。
     ★ここを確かめずに壊さないこと。
       もともとずれていたら、あとの判定が全部おかしくなります。 */
  const mae = await pointList(t, "SUPER_ADMIN", {});
  const maeGyou = mae.rows.find((x) => x.userId === c);
  assert.ok(maeGyou, "作ったばかりの会員が、一覧に出ていません");
  assert.equal(maeGyou.integrity, "OK", "作った直後なのに、合っていません");
  assert.equal(maeGyou.diff, 0, "作った直後なのに、差が出ています");
  assert.equal(await daichouGoukei(t, c), 5_000, "開始時の残高が、台帳に入っていません");

  /* わざと壊す（手元の使い捨てDBでしか動かない出口を通す） */
  const zure = 777;
  await breakBalanceForTest(db, {
    tenantId: t,
    userId: c,
    delta: zure,
    naze: "台帳と残高の食い違いを、画面が見つけられるか確かめる",
  });

  const ato = await pointList(t, "SUPER_ADMIN", {});
  const atoGyou = ato.rows.find((x) => x.userId === c);
  assert.ok(atoGyou, "食い違っている会員が、一覧から消えています");
  assert.equal(atoGyou.integrity, "MISMATCH", "ずれているのに、赤くなっていません");
  assert.equal(atoGyou.diff, zure, "差の大きさが違います");
  assert.equal(atoGyou.points, 5_000 + zure, "いまの残高が違います");
  assert.equal(atoGyou.ledgerSum, 5_000, "台帳は動かしていないのに、合計が変わっています");

  /* ★人数も数えられていること。
       1人ずつ赤くできても、件数が0のままなら、
       ダッシュボードには何も出ません。 */
  assert.equal(ato.counts.mismatch, 1, "合っていない人数が、数えられていません");
});

test("「合っていない人だけ」の絞り込みに、その人が出る", async () => {
  const t = await createTenant({ code: code(), name: "点検社B" });
  const zureta = await createCustomer({
    tenantId: t,
    no: 1,
    name: "架空 ずれた",
    points: 1_000,
    email: `pi2a-${Date.now()}@x.example`,
  });
  const atteru = await createCustomer({
    tenantId: t,
    no: 2,
    name: "架空 あってる",
    points: 2_000,
    email: `pi2b-${Date.now()}@x.example`,
  });

  await breakBalanceForTest(db, {
    tenantId: t,
    userId: zureta,
    delta: -300,
    naze: "絞り込みに出るか確かめる",
  });

  const r = await pointList(t, "SUPER_ADMIN", { onlyMismatch: true });
  assert.equal(r.total, 1, "合っていない人だけを出す絞り込みが、効いていません");
  assert.equal(r.rows[0].userId, zureta);
  assert.equal(r.rows[0].diff, -300, "減る側のずれが、数えられていません");

  /* ★絞り込んでも、全体の人数は変わらないこと。
       ここが変わる画面は、その日から誰にも信じてもらえません。 */
  assert.equal(r.counts.all, 2, "絞り込んだら、会員数まで減りました");
  assert.ok(
    !r.rows.some((x) => x.userId === atteru),
    "合っている人が、合っていない側に混ざっています",
  );
});

test("詳細でも、一覧と同じ差が出る", async () => {
  const t = await createTenant({ code: code(), name: "点検社C" });
  const c = await createCustomer({
    tenantId: t,
    no: 1,
    name: "架空 さぶろう",
    points: 800,
    email: `pi3-${Date.now()}@x.example`,
  });

  await breakBalanceForTest(db, {
    tenantId: t,
    userId: c,
    delta: 1_234,
    naze: "一覧と詳細で、差が食い違わないか確かめる",
  });

  const ichiran = await pointList(t, "SUPER_ADMIN", {});
  const gyou = ichiran.rows.find((x) => x.userId === c);
  const shousai = await pointDetail(t, c, "SUPER_ADMIN");

  assert.ok(shousai, "食い違っている会員の詳細が、開けません");
  assert.equal(shousai.integrity, "MISMATCH", "詳細では、ずれが消えています");
  assert.equal(
    shousai.diff,
    gyou?.diff,
    "★一覧と詳細で、差の大きさが違います。どちらを信じればよいか分かりません",
  );
  assert.equal(shousai.ledgerSum, 800, "詳細の台帳合計が違います");
});

test("直したら、「合っている」に戻る（言いっぱなしにしない）", async () => {
  const t = await createTenant({ code: code(), name: "点検社D" });
  const c = await createCustomer({
    tenantId: t,
    no: 1,
    name: "架空 しろう",
    points: 3_000,
    email: `pi4-${Date.now()}@x.example`,
  });

  const moto = await breakBalanceForTest(db, {
    tenantId: t,
    userId: c,
    delta: 555,
    naze: "戻したら緑に戻るか確かめる",
  });
  assert.equal(moto, 3_000, "壊す前の残高が、正しく返っていません");

  const zure = await pointList(t, "SUPER_ADMIN", {});
  assert.equal(zure.counts.mismatch, 1, "壊したのに、合っていない人数が0のままです");

  await restoreBalanceForTest(db, {
    tenantId: t,
    userId: c,
    points: moto,
    naze: "わざと作った食い違いを、元へ戻す",
  });

  const ato = await pointList(t, "SUPER_ADMIN", {});
  const gyou = ato.rows.find((x) => x.userId === c);
  assert.equal(gyou?.integrity, "OK", "戻したのに、赤いままです");
  assert.equal(gyou?.diff, 0, "戻したのに、差が残っています");
  assert.equal(ato.counts.mismatch, 0, "戻したのに、合っていない人数が減っていません");
});

test("★食い違いを、危険度（risk）に混ぜない", async () => {
  /*
   * ★混ぜると、どちらの理由で印が付いたのかが読めなくなります。
   *   「不正の疑い」と「帳簿が合っていない」は、
   *   やるべきことがまったく違います。
   */
  const t = await createTenant({ code: code(), name: "点検社E" });
  const c = await createCustomer({
    tenantId: t,
    no: 1,
    name: "架空 ごろう",
    points: 100,
    email: `pi5-${Date.now()}@x.example`,
  });

  await breakBalanceForTest(db, {
    tenantId: t,
    userId: c,
    delta: 9_999,
    naze: "食い違いが危険度に混ざらないか確かめる",
  });

  const r = await pointList(t, "SUPER_ADMIN", {});
  const gyou = r.rows.find((x) => x.userId === c);
  assert.equal(gyou?.integrity, "MISMATCH", "壊したのに、ポイント一覧が赤くなっていません");

  /* ★危険度は、会員管理のほうが持っています。
       帳簿が合っていないだけで、そちらが上がっていないことを確かめます。 */
  const kaiin = await customerList(t, "SUPER_ADMIN", {});
  const kaiinGyou = kaiin.rows.find((x) => x.id === c);
  assert.ok(kaiinGyou, "食い違っている会員が、会員管理から消えています");
  assert.equal(
    kaiinGyou.risk,
    "NONE",
    "★食い違いが、危険度に混ざっています。\n" +
      "  「不正の疑い」と「帳簿が合っていない」は、やることが違います",
  );
  assert.equal(
    kaiinGyou.riskOpenCount,
    0,
    "★食い違いだけで、対応中の不正の件数が増えています",
  );

  /* ★ただし、黙ってもいけません。
       危険度とは別の欄で、必ず表に出ていること。 */
  assert.equal(
    kaiinGyou.ledgerMismatch,
    true,
    "★危険度に混ぜないかわりに、どこにも出なくなっています",
  );
});

test("★壊す道具は、手元の使い捨てDB以外では動かない", async () => {
  /*
   * ★ここが、この仕組みのいちばん大事なところです。
   *
   *   「気をつけて使う」では守れません。人は必ず忘れます。
   *   ですので、つなぎ先が手元のファイルでなければ、
   *   呼んだ瞬間に止まるようにしてあります。
   *
   *   ここでは、その止まり方を実際に確かめます。
   */
  const moto = process.env.DATABASE_URL;
  const motoNafuda = process.env.DATABASE_ENV;

  try {
    /* ① 本番・Preview のような接続先 */
    process.env.DATABASE_URL = "libsql://example-preview.turso.io";
    assert.throws(
      () => tsukaisuteDBだけ("本番につながっているときに壊そうとする"),
      /手元の使い捨てDB/,
      "★Preview や本番のDBにつながっていても、壊せてしまいます",
    );

    /* ② つなぎ先は手元でも、Preview の名札が付いている */
    process.env.DATABASE_URL = "file:.data/test.db";
    process.env.DATABASE_ENV = "preview";
    assert.throws(
      () => tsukaisuteDBだけ("Preview の名札が付いているときに壊そうとする"),
      /手元の使い捨てDB/,
      "★名札が preview でも、壊せてしまいます",
    );

    /* ③ 名札が production */
    process.env.DATABASE_ENV = "production";
    assert.throws(
      () => tsukaisuteDBだけ("本番の名札が付いているときに壊そうとする"),
      /手元の使い捨てDB/,
      "★名札が production でも、壊せてしまいます",
    );

    /* ④ 手元の使い捨てなら、通る */
    delete process.env.DATABASE_ENV;
    process.env.DATABASE_URL = "file:.data/test.db";
    tsukaisuteDBだけ("手元の使い捨てDBで壊す");

    /* ⑤ 設定が無いときも、手元のファイルなので通る */
    delete process.env.DATABASE_URL;
    tsukaisuteDBだけ("設定が無いときは、手元のファイル");
  } finally {
    /* ★元へ戻すこと。戻さないと、次の試験がおかしくなります */
    if (moto === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = moto;
    if (motoNafuda === undefined) delete process.env.DATABASE_ENV;
    else process.env.DATABASE_ENV = motoNafuda;
  }
});
