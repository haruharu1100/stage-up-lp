/**
 * お客様側の「発送状況」が、本物のデータを見ているかを見張ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを機械に見張らせるのか
 * ═══════════════════════════════════════════════════════
 *
 *   お客様側の発送状況は、長いあいだ見本のデータ（デモ）で作られていました。
 *   見た目は完成しています。動きます。押せます。
 *   ただ、運営者が管理画面で「発送済み」にしても、何も変わりません。
 *
 *   この壊れ方は、画面を見ても分かりません。
 *   分かるのは、お客様が「まだ準備中と出ています」と電話をくれたときです。
 *
 *   だから、次の3つを機械で固定します。
 *
 *     ① 発送状況は /api/customer/orders を読んでいること
 *     ② 「3点中2点発送済み」の1行を、画面に出していること
 *     ③ 読めなかったときに「0件」と書かないこと
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { movingCount, type CustomerOrdersState } from "../lib/console/liveOrders";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ══════════════════════════════════════════════
   ① 本物を読んでいるか
   ══════════════════════════════════════════════ */

test("お客様の発送状況は、サーバーの実データを読んでいる", () => {
  const hook = read("lib/console/liveOrders.ts");

  assert.ok(
    hook.includes("/api/customer/orders"),
    "発送状況の読み取り先が /api/customer/orders ではありません。" +
      "見本のデータへ戻すと、運営者の操作がお客様の画面に出なくなります。",
  );

  const account = read("components/console/customer/Account.tsx");
  assert.ok(
    account.includes("useCustomerOrders"),
    "Account.tsx が useCustomerOrders を使っていません。" +
      "デモの state から発送状況を作ると、管理画面と食い違います。",
  );
});

/* ══════════════════════════════════════════════
   ② 分割発送が、お客様に伝わるか（#17）
   ══════════════════════════════════════════════ */

test("分割発送の1行（3点中2点発送済み…）を、画面に出している", () => {
  const account = read("components/console/customer/Account.tsx");

  assert.ok(
    /\{\s*o\.progress\s*\}/.test(account),
    "progress（点数の1行）を画面に出していません。" +
      "これが無いと、届かない1点の理由がお客様に分かりません。",
  );

  /* ★この文言は、サーバー側（lib/server/shipments.ts）が作ります。
       画面側で作り直すと、管理画面と言い方がずれます */
  const server = read("lib/server/shipments.ts");
  assert.ok(
    server.includes("点発送済み、残り"),
    "点数の言い方が、サーバー側から消えています。",
  );
});

test("追跡番号は、荷物ごとに出している（1注文＝1番号にしていない）", () => {
  const account = read("components/console/customer/Account.tsx");

  assert.ok(
    account.includes("o.shipments.map"),
    "荷物ごとの繰り返しがありません。" +
      "分けて送った日に、2つ目の追跡番号が出せなくなります。",
  );
  assert.ok(
    account.includes("s.trackingNumber"),
    "荷物ごとの追跡番号を出していません。",
  );
});

/* ══════════════════════════════════════════════
   ③ 読めなかったときに、0件と書かないか
   ══════════════════════════════════════════════ */

test("読めていないときの件数は、0ではなく「分からない」", () => {
  const loading: CustomerOrdersState = { phase: "loading", orders: null };
  const anon: CustomerOrdersState = { phase: "anon", orders: null };
  const ng: CustomerOrdersState = { phase: "ng", orders: null, why: "x" };

  for (const s of [loading, anon, ng]) {
    assert.equal(
      movingCount(s),
      null,
      `${s.phase} のときに件数を返しています。` +
        "0件と出すと、お客様は依頼が消えたと受け取ります。",
    );
  }
});

test("読めたときは、お届け完了だけの注文を「動いている」に数えない", () => {
  const done: CustomerOrdersState = {
    phase: "ok",
    orders: [
      {
        orderId: "o1",
        orderNumber: "ORD-0001",
        orderedAt: "2026-01-01",
        orderStatus: "FULFILLED",
        itemCount: 1,
        shippedCount: 1,
        progress: "1点すべて発送済みです。",
        items: [
          {
            name: "商品A",
            state: "配達完了",
            shipmentNumber: "SHP-0001",
            carrier: "ヤマト運輸",
            trackingNumber: "1111",
            },
        ],
        shipments: [
          {
            shipmentNumber: "SHP-0001",
            status: "DELIVERED",
            statusLabel: "配達完了",
            carrier: "ヤマト運輸",
            trackingNumber: "1111",
            shippedAt: "2026-01-02",
            deliveredAt: "2026-01-03",
            itemNames: ["商品A"],
          },
        ],
      },
    ],
  };

  assert.equal(movingCount(done), 0);
});

test("まだ荷物になっていない商品が残っていれば、「動いている」に数える", () => {
  const half: CustomerOrdersState = {
    phase: "ok",
    orders: [
      {
        orderId: "o2",
        orderNumber: "ORD-0002",
        orderedAt: "2026-01-01",
        orderStatus: "PARTIALLY_FULFILLED",
        itemCount: 3,
        shippedCount: 2,
        progress: "3点中2点発送済み、残り1点準備中です。",
        items: [
          {
            name: "商品A",
            state: "配達完了",
            shipmentNumber: "SHP-0002",
            carrier: null,
            trackingNumber: null,
          },
          {
            name: "商品B",
            state: "配達完了",
            shipmentNumber: "SHP-0002",
            carrier: null,
            trackingNumber: null,
          },
          {
            name: "商品C",
            state: "お手続き中",
            shipmentNumber: null,
            carrier: null,
            trackingNumber: null,
          },
        ],
        shipments: [
          {
            shipmentNumber: "SHP-0002",
            status: "DELIVERED",
            statusLabel: "配達完了",
            carrier: "佐川急便",
            trackingNumber: "2222",
            shippedAt: "2026-01-02",
            deliveredAt: "2026-01-03",
            itemNames: ["商品A", "商品B"],
          },
        ],
      },
    ],
  };

  /* ★ここが 0 になると、入口に「お届け中のお荷物はありません」と出ます。
       まだ1点届いていないのに、です。 */
  assert.equal(movingCount(half), 1);
});

/* ══════════════════════════════════════════════
   ④ お客様が、自分でその画面を開けるか

   ★これを見張る理由。
     画面はずっと前からありました。ただし、管理画面の中の
     「ユーザー側」という切り替えの中だけです。
     つまり運営者しか見られませんでした。

     その状態で「お客様に伝わっています」とは言えません。
     伝わる場所が無いからです。
   ══════════════════════════════════════════════ */

test("お客様が自分で開ける住所が、実際にある", () => {
  const home = read("app/mypage/page.tsx");
  const ship = read("app/mypage/shipping/page.tsx");

  for (const [name, src] of [
    ["/mypage", home],
    ["/mypage/shipping", ship],
  ] as const) {
    assert.ok(
      src.includes("requireCustomer"),
      `${name} が、お客様の本人確認をしていません。` +
        "確認せずに出すと、URLを知っている人に他人の宛先が見えます。",
    );
    assert.ok(
      src.includes('dynamic = "force-dynamic"'),
      `${name} が静的に作られる設定です。` +
        "静的にすると、誰に対しても同じ中身＝他人のマイページを返します。",
    );
  }
});

test("お客様の画面は、担当者のクッキーでは開かない", () => {
  const auth = read("lib/server/pageAuth.ts");

  assert.ok(
    auth.includes('session.subjectKind !== "CUSTOMER"'),
    "お客様の画面で、クッキーの種類を見ていません。" +
      "クッキーは担当者と共通の1つです。種類を見ないと、" +
      "運営者のクッキーでお客様の画面が開きます。",
  );
  assert.ok(
    auth.includes('session.subjectKind !== "ADMIN"'),
    "管理画面で、クッキーの種類を見ていません。" +
      "見ないと、お客様のクッキーで管理画面が開きます。",
  );
});

test("お客様の発送状況に、見本のデータを混ぜていない", () => {
  const portal = read("components/console/customer/Portal.tsx");

  /* ★見本を渡すと、読めなかった日に他人の荷物が
       自分のものとして並びます */
  assert.ok(
    /orders=\{\[\]\}/.test(portal),
    "お客様の画面に、見本の発送データを渡しています。",
  );
});

/* ══════════════════════════════════════════════
   ⑤ 機械の書き方のまま、お客様に見せていないか
   ══════════════════════════════════════════════ */

test("日時を 2026-08-25T08:22:25.889Z のまま見せない", () => {
  const account = read("components/console/customer/Account.tsx");

  assert.ok(
    account.includes("Asia/Tokyo"),
    "日時を日本時間に直していません。" +
      "末尾に Z が付いた時刻は世界標準時なので、" +
      "9時間ずれた発送時刻をお客様が信じることになります。",
  );
  assert.ok(
    /\{nichiji\(o\.orderedAt\)\}/.test(account),
    "ご注文日時を、そのままの文字で出しています。",
  );
  assert.ok(
    /nichiji\(s\.shippedAt\)/.test(account),
    "発送日を、そのままの文字で出しています。",
  );
});
