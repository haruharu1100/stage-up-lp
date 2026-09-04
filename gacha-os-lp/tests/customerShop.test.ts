/**
 * お客様の売り場（ガチャを引く場所）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを機械に見張らせるのか
 * ═══════════════════════════════════════════════════════
 *
 *   2026-09-04 の総点検で「販売できない」と判定した理由は、
 *   ただ1つ、お客様がガチャを引く場所が無かったことでした。
 *
 *   裏側は全部できていました。
 *   引く仕組みも、ポイントの減り方も、当選品の記録も、
 *   発送の手続きも、通しで動いていました。
 *   それでも、押す場所が無いので、売上は1円も立ちません。
 *
 *   ★「裏側が完成している」と「売れる」は別のことです。
 *     だから、次の5つを機械で固定します。
 *
 *       ① 公開していないガチャは、一覧にも詳細にも出ない
 *       ② 他社のガチャは、IDを直に指定しても出ない
 *       ③ 運営の数字（売上・払い出し・還元率）を返していない
 *       ④ 引く入口が、合図（CSRF）なしでは通らない
 *       ⑤ 引く場所への行き先が、マイページから消えていない
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { migrate, resetDbForTests } from "../lib/server/db";
import { createTenant, createGacha } from "../lib/server/seed";
import { listShopGachas, shopGachaDetail } from "../lib/server/shop";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

after(async () => {
  await resetDbForTests();
});

let n = 0;
async function newTenant(): Promise<string> {
  await migrate();
  n += 1;
  return createTenant({ code: `shop${n}${Math.random().toString(36).slice(2, 6)}`, name: `売り場試験${n}` });
}

/* ══════════════════════════════════════════════
   ① 公開していないものを、売り場に出さない
   ══════════════════════════════════════════════ */

test("下書き・審査中・停止中のガチャは、お客様の一覧に出ない", async () => {
  const tenantId = await newTenant();

  const koukai = await createGacha({
    tenantId,
    title: "公開中のガチャ",
    price: 500,
    total: 100,
    designedRtp: 90,
    status: "PUBLISHED",
  });
  await createGacha({
    tenantId,
    title: "下書きのガチャ",
    price: 500,
    total: 100,
    designedRtp: 90,
    status: "DRAFT",
  });
  await createGacha({
    tenantId,
    title: "審査中のガチャ",
    price: 500,
    total: 100,
    designedRtp: 90,
    status: "REVIEW",
  });
  await createGacha({
    tenantId,
    title: "停止中のガチャ",
    price: 500,
    total: 100,
    designedRtp: 90,
    status: "PAUSED",
  });

  const list = await listShopGachas(tenantId);

  assert.equal(
    list.length,
    1,
    "公開していないガチャが、お客様の売り場に並んでいます。" +
      "下書きは、まだ世に出していない商品です。",
  );
  assert.equal(list[0].id, koukai);
});

test("公開していないガチャは、IDを直に指定しても開けない", async () => {
  const tenantId = await newTenant();

  const shitagaki = await createGacha({
    tenantId,
    title: "下書きのガチャ",
    price: 500,
    total: 100,
    designedRtp: 90,
    status: "DRAFT",
  });
  const teishi = await createGacha({
    tenantId,
    title: "停止中のガチャ",
    price: 500,
    total: 100,
    designedRtp: 90,
    status: "PAUSED",
  });

  assert.equal(
    await shopGachaDetail(tenantId, shitagaki),
    null,
    "一覧から隠しても、URLを直に叩けば見えるなら、隠したことになりません。",
  );
  assert.equal(
    await shopGachaDetail(tenantId, teishi),
    null,
    "販売を止めたガチャが、URL直打ちで引ける状態になっています。",
  );
});

/* ══════════════════════════════════════════════
   ② 他社のものは、見えない
   ══════════════════════════════════════════════ */

test("他社のガチャは、一覧にも詳細にも出ない", async () => {
  const a = await newTenant();
  const b = await newTenant();

  const bNoGacha = await createGacha({
    tenantId: b,
    title: "B社のガチャ",
    price: 800,
    total: 50,
    designedRtp: 90,
    status: "PUBLISHED",
  });

  const aList = await listShopGachas(a);
  assert.equal(
    aList.length,
    0,
    "A社のお客様に、B社のガチャが並んでいます。会社の切り分けが効いていません。",
  );

  assert.equal(
    await shopGachaDetail(a, bNoGacha),
    null,
    "他社のガチャのIDを指定すると、中身が読めてしまいます。",
  );
});

/* ══════════════════════════════════════════════
   ③ 運営の数字を、お客様へ送らない
   ══════════════════════════════════════════════ */

test("お客様へ返す中身に、売上・払い出し・還元率が入っていない", async () => {
  const tenantId = await newTenant();
  const gachaId = await createGacha({
    tenantId,
    title: "数字の試験用ガチャ",
    price: 500,
    total: 100,
    designedRtp: 92,
    status: "PUBLISHED",
  });

  const detail = await shopGachaDetail(tenantId, gachaId);
  assert.ok(detail, "公開中のガチャが読めませんでした。");

  /* ★「画面に出していないから大丈夫」は通りません。
       出していなくても、送っていれば読まれます。 */
  const moji = JSON.stringify(detail);
  for (const kinshi of ["revenue", "paidValue", "paid_value", "designedRtp", "designed_rtp", "rtp"]) {
    assert.ok(
      !moji.includes(kinshi),
      `お客様へ返す中身に ${kinshi} が入っています。` +
        "通信の中身を見るだけで、その店の粗利が分かります。",
    );
  }

  /* 賞の残りは、事実そのものなので出します */
  assert.ok(detail!.prizes.length > 0, "賞の内訳が空です。何が当たるのかが分かりません。");
  for (const p of detail!.prizes) {
    assert.ok(p.total > 0, "賞の本数が0本です。");
    assert.ok(p.left >= 0, "賞の残り本数が負になっています。");
  }
});

test("売り切れた賞を、表紙の目玉として出さない", async () => {
  const tenantId = await newTenant();
  const gachaId = await createGacha({
    tenantId,
    title: "目玉の試験用ガチャ",
    price: 500,
    total: 100,
    designedRtp: 92,
    status: "PUBLISHED",
  });

  const before = await shopGachaDetail(tenantId, gachaId);
  assert.ok(before?.top, "目玉の賞が出ていません。");

  /* 一番高い賞を、引き切った状態にする */
  const { db } = await import("../lib/server/db");
  await db().execute({
    sql: `UPDATE gacha_stock SET drawn = total
           WHERE tenant_id = ? AND gacha_id = ? AND grade = ?`,
    args: [tenantId, gachaId, before!.top!.grade],
  });

  const after2 = await shopGachaDetail(tenantId, gachaId);
  assert.notEqual(
    after2?.top?.grade,
    before!.top!.grade,
    "売り切れた賞を、表紙の目玉として出し続けています（有利誤認になります）。",
  );
});

/* ══════════════════════════════════════════════
   ④ 引く入口が、合図なしで通らない
   ══════════════════════════════════════════════ */

test("引く入口は、合言葉（CSRF）の確認を必ず通る", () => {
  const route = read("app/api/console/draw/route.ts");

  /* ★この入口だけは門番（guard）を通っていません。
       ポイントが実際に減る唯一の場所なので、ここに同じ確認を置きます。 */
  assert.ok(
    route.includes("verifyCsrf"),
    "引く入口に CSRF の確認がありません。" +
      "お客様がログインしたまま別のページを開くだけで、" +
      "意思と関係なくガチャが引かれ、ポイントが減ります。",
  );
  assert.ok(
    route.includes("CSRF_FAILED"),
    "門番と同じ code で断っていません。どちらで止まったのかが記録から読めません。",
  );
  assert.ok(
    route.includes("Idempotency-Key"),
    "二重実行を防ぐ鍵を必須にしていません。通信のやり直しが二重抽選になります。",
  );
});

test("引く指示に、金額や当選結果を混ぜて送っていない", () => {
  const client = read("lib/console/liveShop.ts");
  const route = read("app/api/console/draw/route.ts");

  /* ★送るのは「どのガチャか」と「鍵」だけ。
       金額や確率を送る作りにすると、そこが書き換えられます。 */
  assert.ok(
    client.includes("JSON.stringify({ gachaId })"),
    "引くときに gachaId 以外を送っています。送った値は書き換えられます。",
  );
  assert.ok(
    route.includes("body.gachaId"),
    "入口が gachaId 以外を受け取っています。",
  );
  for (const kinshi of ["body.price", "body.grade", "body.userId", "body.tenantId"]) {
    assert.ok(
      !route.includes(kinshi),
      `入口が ${kinshi} を受け取っています。番号を書き換えるだけで、他人のポイントが使えます。`,
    );
  }
});

/* ══════════════════════════════════════════════
   ⑤ 引く場所へ、たどり着けるか
   ══════════════════════════════════════════════ */

test("マイページから、ガチャを引く場所へ行ける", () => {
  const portal = read("components/console/customer/Portal.tsx");

  assert.ok(
    portal.includes("/mypage/shop"),
    "マイページに、ガチャを引く場所への行き先がありません。" +
      "押す場所が無い機能は、無いのと同じです。",
  );
  assert.ok(
    portal.includes("ガチャを引く"),
    "「ガチャを引く」という言葉が、マイページに出ていません。",
  );
});

test("お客様が、自分でログアウトできる", () => {
  const portal = read("components/console/customer/Portal.tsx");

  /* ★2026-09-05 のブラウザ実測で見つかった穴です。
       本物のお客様の画面には、ログアウトの押し場所が1つもありませんでした。
       見本の画面（Account.tsx）には昔からありましたが、
       あれは画面の中の状態を戻すだけで、サーバー側の行は消えません。

       店頭のタブレット、家族と共有のパソコン、ネットカフェ。
       出られない作りだと、次に触った人に残高も住所も見えます。 */
  assert.ok(
    portal.includes("ログアウトする"),
    "お客様の画面に、ログアウトの押し場所がありません。" +
      "共有の端末では、次に触った人へ残高と住所がそのまま渡ります。",
  );
  assert.ok(
    portal.includes("/api/auth/logout"),
    "画面の中の状態を戻すだけで、サーバー側のログインを消していません。" +
      "控えておいた合言葉が、そのあとも使えてしまいます。",
  );
  assert.ok(
    portal.includes("postHeaders()"),
    "ログアウトの通信に合図（CSRF）が付いていません。" +
      "外のページを開いただけで、勝手にログアウトさせられます。",
  );

  /* ★戻るボタン対策。画面の中だけで移動すると、
       ブラウザの手元（bfcache）にさっきの画面が残ります。 */
  assert.ok(
    /location\.replace\(/.test(portal),
    "ログアウトのあと、読み込みごと入れ替えていません。" +
      "戻るボタンで、消したはずの残高が画面に戻ります。",
  );
});

test("引く画面は、サーバー側で本人確認をしてから中身を出す", () => {
  for (const rel of ["app/mypage/shop/page.tsx", "app/mypage/shop/[id]/page.tsx"]) {
    const page = read(rel);
    assert.ok(
      page.includes("requireCustomer"),
      `${rel} が requireCustomer を通っていません。` +
        "画面の中で隠すだけでは、データはもうブラウザへ送り終わっています。",
    );
    assert.ok(
      page.includes('dynamic = "force-dynamic"'),
      `${rel} が静的に作られます。作り置きした残り口数を配ると、` +
        "「残り1口」と書いてある画面で売り切れが起きます。",
    );
  }
});

test("引いた結果を、画面側で作っていない", () => {
  const screen = read("components/console/customer/LiveShop.tsx");

  /* ★当選・料金・残高は、すべてサーバーが決めた値をそのまま出します。
       画面側で計算すると、画面とDBで違う数字が出ます。 */
  assert.ok(
    screen.includes("drawOnce("),
    "引く処理がサーバーの入口を通っていません。",
  );
  assert.ok(
    screen.includes("points.reload()") && screen.includes("detail.reload()"),
    "引いたあとに、残高と在庫を読み直していません。" +
      "画面側で引き算すると、サーバーの値と食い違います。",
  );
  assert.ok(
    !/state\.ts/.test(screen),
    "見本データ（lib/console/state.ts）を、本物の売り場に持ち込んでいます。" +
      "見本が1本混ざると、押しても引けないガチャになります。",
  );
});

test("お客様の画面に、還元率の数字を出していない", () => {
  const screen = read("components/console/customer/LiveShop.tsx");

  /* 設計上の還元率は「箱をぜんぶ引き切ったとき」の数字で、
     1回引く方の取り分ではありません（景品表示法・有利誤認）。 */
  assert.ok(
    !/還元率\s*\{/.test(screen) && !screen.includes("designedRtp"),
    "お客様の画面に還元率の数字を出しています。有利誤認になり得ます。",
  );
});
