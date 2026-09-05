/**
 * ポイントを、お客様が自分で買えるようにする場所。
 *
 * ═══════════════════════════════════════════════════════
 * ★この仕組みで、いちばん大事な1行
 * ═══════════════════════════════════════════════════════
 *
 *   「決済が成功しました」という画面を見たことを理由に、
 *   ポイントを足さない。
 *
 *   あの画面は、お客様のブラウザが表示しているだけのものです。
 *   URL を控えておいて、あとから何度も開けば、その回数だけ足りてしまいます。
 *   ブラウザの「戻る」を押しただけでも足りてしまいます。
 *
 *   だから、ポイントを足すのは confirmPayment ただ1つ。
 *   決済会社のサーバーから届く「確定通知」だけが、ここを通ります。
 *   success 画面は「反映を確認しています」と言うだけで、1ptも動かしません。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、注文に金額とポイントを写し取るのか
 * ═══════════════════════════════════════════════════════
 *
 *   ポイント商品（point_products）は、お店がいつでも変えられます。
 *   注文が商品を「参照するだけ」だと、こうなります。
 *
 *       1,000円で 1,000pt の商品を、お客様が買う
 *         ↓
 *       お店が「1,000円で 500pt」に変更する
 *         ↓
 *       決済会社から確定通知が届く
 *         ↓
 *       500pt しか付かない
 *
 *   お客様は 1,000pt のつもりで 1,000円を払っています。
 *   ですので、注文を作った瞬間の金額とポイントを注文の中へ写して固定します。
 *   あとから商品を変えても、この注文は動きません。
 *
 * ═══════════════════════════════════════════════════════
 * ★二重に足さないための備えを、4つ重ねる
 * ═══════════════════════════════════════════════════════
 *
 *   ① payment_events の主キー（会社・決済業者・イベント番号）
 *      同じ通知が100回来ても、2回目からはここで止まります。
 *
 *   ② 注文の状態を「PENDING のときだけ PAID にする」条件付きの更新
 *      2回目は0行しか動きません。0行なら、そこで止めます。
 *
 *   ③ point_ledger の ref に注文番号。kind='PURCHASE' で一意。
 *      万が一 ①② を両方すり抜けても、DBが2行目を拒みます。
 *
 *   ④ 「注文1つにつき、加算の台帳行は1つ」をテストで毎回確かめる
 *
 *   ★1つで足りるように見えても、4つ重ねること。
 *     1つだけだと、その1つを誰かが外した日に、静かに壊れます。
 *     壊れても画面はきれいに動きます。気づくのは、決算のときです。
 *
 * ═══════════════════════════════════════════════════════
 * ★残高を直接書き換えている件について
 * ═══════════════════════════════════════════════════════
 *
 *   このファイルは customers.points を動かします。
 *   check-no-direct-balance-write.mjs の許可リストに入れてあります。
 *
 *   許してよい理由は1つだけです。
 *   台帳（point_ledger）への書き込みと、残高の更新と、監査ログを、
 *   すべて同じ1つの取引（withWriteTx）の中でやっているからです。
 *   途中で落ちれば、全部なかったことになります。
 *   「台帳には無いのに残高だけ増えている」を、構造として作れません。
 */

import { withWriteTx, db } from "./db";
import { appendAuditTx } from "./audit";
import { id } from "./ids";
import type { Actor } from "./orders";
import {
  PAYMENT_CODES,
  PaymentNotConfiguredError,
  resolvePaymentProvider,
  type PaymentProviderName,
} from "./payments";

/** 断る理由。呼んだ側が、そのまま日本語で返せる形にしておく */
export class PurchaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PurchaseError";
  }
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));

/* ══════════════════════════════════════════════
   決済業者を選ぶ
   ══════════════════════════════════════════════ */

export type Provider = PaymentProviderName;

/**
 * いま使う決済業者。
 *
 * ═══════════════════════════════════════════════════════
 * ★中身は lib/server/payments/ へ移しました
 * ═══════════════════════════════════════════════════════
 *
 *   ここは、これまでの呼び出し側が何も変えずに済むように
 *   残してある「取り次ぎ」です。判定そのものは持っていません。
 *
 *   ★ここに判定を書き戻さないこと。
 *     「本番で練習用の決済を使わせない」という約束を
 *     1か所で決めている意味が、消えます。
 *
 * ═══════════════════════════════════════════════════════
 * ★止める条件（lib/server/payments/index.ts で決めています）
 * ═══════════════════════════════════════════════════════
 *
 *   ・PAYMENT_PROVIDER が mock / stripe / gmo 以外    → 止める
 *   ・本番なのに練習用（mock）のまま                  → 止める
 *   ・APIの鍵が無い                                    → 止める
 *   ・確定通知（Webhook）の鍵が無い                    → 止める
 *   ・本番なのに、本番の保存先につながっていない      → 止める
 *
 *   ★どの場合も mock へ戻しません。はっきり止めます。
 *     戻すと、設定を忘れた本番で、誰でもポイントを作れます。
 *
 * @throws PurchaseError 使ってはいけない状態のとき
 */
export function paymentProvider(): Provider {
  try {
    return resolvePaymentProvider(process.env);
  } catch (e) {
    if (e instanceof PaymentNotConfiguredError) {
      /* ★画面のHTTP状態の対応表（各 route.ts の STATUS）が
           知っている2つの符号へ寄せること。
           ここで新しい符号をそのまま返すと、画面が「500」としか
           出せなくなり、お客様にも運営にも理由が伝わりません。
           止めた本当の理由は message に全部入っています。 */
      const code =
        e.code === PAYMENT_CODES.UNKNOWN
          ? "PROVIDER_UNKNOWN"
          : "PROVIDER_NOT_CONFIGURED";
      throw new PurchaseError(code, e.message);
    }
    throw e;
  }
}

/**
 * モック決済かどうか。
 *
 * ★「支払ったことにする」ボタンを出してよいのは、ここが true のときだけです。
 */
export function isMock(): boolean {
  return paymentProvider() === "mock";
}

/* ══════════════════════════════════════════════
   戻り先（Open Redirect を作らないための唯一の関門）
   ══════════════════════════════════════════════ */

/**
 * 「買ったあと、どこへ戻すか」を安全な形だけに絞る。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、ここまで細かく弾くのか
 * ═══════════════════════════════════════════════════════
 *
 *   戻り先をそのまま受け取ると、こういうURLが作れます。
 *
 *       /mypage/points/buy?return=https://にせもの.example/login
 *
 *   お客様から見れば「本物のサイトのリンク」です。踏みます。
 *   支払いを終えると、そっくりの偽ログイン画面へ飛ばされます。
 *   これを Open Redirect といいます。
 *
 *   ★「http で始まっていたら弾く」だけでは足りません。
 *     //にせもの.example  … 先頭2本のスラッシュだけで別サイトへ行きます
 *     /\にせもの.example  … ブラウザによっては同じ扱いになります
 *     https:/／…         … 全角や制御文字を混ぜて検査をすり抜けます
 *
 *   ですので、弾く形を数えるのをやめました。
 *   代わりに「通す形」だけを決めます。
 *
 *       /mypage で始まる、自分のサイトの中の道だけ。
 *
 *   これなら、新しい抜け道が見つかっても影響を受けません。
 *
 * @returns 通せる道ならその文字列。だめなら null（呼んだ側が既定の場所へ戻す）
 */
export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return null;

  /* 長すぎるものは、そもそも道ではありません */
  if (s.length > 300) return null;

  /* 制御文字・改行が混ざっているものは、検査をすり抜けるための細工です。
     ★正規表現で書かないこと。制御文字そのものをソースへ書くことになり、
       ファイルを編集するたびに壊れます。文字の番号で見ます。 */
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  /* 半角バックスラッシュは、ブラウザによってスラッシュとして読まれます */
  if (s.includes("\\")) return null;

  /* ★ここが本体。通すのは /mypage の中だけ。
       /mypageXXX のような「頭だけ似ている別の道」も通しません。 */
  if (!/^\/mypage(\/[^\s]*)?$/.test(s)) return null;

  /* //… や /\… は、別サイトへの入口です */
  if (s.startsWith("//")) return null;

  return s;
}

/* ══════════════════════════════════════════════
   ポイント商品（お店が自由に決める）
   ══════════════════════════════════════════════ */

export type PointProduct = {
  id: string;
  name: string;
  priceYen: number;
  points: number;
  bonusPoints: number;
  totalPoints: number;
  status: "ACTIVE" | "DISABLED";
  sortOrder: number;
};

function toProduct(r: Row): PointProduct {
  const points = num(r.points);
  const bonus = num(r.bonus_points);
  return {
    id: str(r.id),
    name: str(r.name),
    priceYen: num(r.price_yen),
    points,
    bonusPoints: bonus,
    totalPoints: points + bonus,
    status: str(r.status) === "DISABLED" ? "DISABLED" : "ACTIVE",
    sortOrder: num(r.sort_order),
  };
}

/**
 * ポイント商品の一覧。
 *
 * @param includeDisabled 管理画面では true（止めている商品も見せる）。
 *                        お客様側では必ず false。
 */
export async function listProducts(
  tenantId: string,
  includeDisabled = false,
): Promise<PointProduct[]> {
  const r = await db().execute({
    sql: `SELECT id, name, price_yen, points, bonus_points, status, sort_order
            FROM point_products
           WHERE tenant_id = ?
             ${includeDisabled ? "" : "AND status = 'ACTIVE'"}
           ORDER BY sort_order ASC, price_yen ASC, rowid ASC`,
    args: [tenantId],
  });
  return r.rows.map((x) => toProduct(x as Row));
}

/**
 * 商品の中身を確かめる。
 *
 * ★上限を置くのは、意地悪のためではありません。
 *   桁を1つ多く打つのは、悪意ではなく、ただの打ち間違いです。
 *   打ち間違いをそのまま通す仕組みのほうが問題です。
 */
const MAX_PRICE_YEN = 1_000_000;
const MAX_POINTS = 10_000_000;

function checkProductInput(input: {
  name: string;
  priceYen: number;
  points: number;
  bonusPoints: number;
}): void {
  const name = input.name.trim();
  if (name.length < 1) {
    throw new PurchaseError("BAD_INPUT", "商品名を入れてください。");
  }
  if (name.length > 60) {
    throw new PurchaseError("BAD_INPUT", "商品名は60文字までにしてください。");
  }
  for (const [label, v, max] of [
    ["販売金額", input.priceYen, MAX_PRICE_YEN],
    ["付与ポイント", input.points, MAX_POINTS],
    ["ボーナスポイント", input.bonusPoints, MAX_POINTS],
  ] as const) {
    if (!Number.isInteger(v)) {
      throw new PurchaseError("BAD_INPUT", `${label}は整数で入れてください。`);
    }
    if (v < 0) {
      throw new PurchaseError("BAD_INPUT", `${label}に負の数は入れられません。`);
    }
    if (v > max) {
      throw new PurchaseError(
        "BAD_INPUT",
        `${label}が大きすぎます（上限 ${max.toLocaleString("ja-JP")}）。`,
      );
    }
  }
  if (input.priceYen < 1) {
    throw new PurchaseError("BAD_INPUT", "販売金額は1円以上にしてください。");
  }
  if (input.points + input.bonusPoints < 1) {
    throw new PurchaseError(
      "BAD_INPUT",
      "付与ポイントが0では、お客様が何も受け取れません。",
    );
  }
}

/**
 * ポイント商品を作る・直す。
 *
 * ★止めるときは status を DISABLED にすること。行を消さないこと。
 *   消すと、過去の注文が「何を買ったのか」を誰も答えられなくなります。
 */
export async function saveProduct(args: {
  tenantId: string;
  productId?: string;
  name: string;
  priceYen: number;
  points: number;
  bonusPoints: number;
  status: "ACTIVE" | "DISABLED";
  sortOrder: number;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ productId: string; created: boolean }> {
  checkProductInput(args);
  const at = args.now ?? new Date().toISOString();
  const name = args.name.trim();

  return withWriteTx(async (tx) => {
    if (args.productId) {
      const cur = await tx.execute({
        sql: `SELECT id, name, price_yen, points, bonus_points, status, sort_order
                FROM point_products WHERE tenant_id = ? AND id = ?`,
        args: [args.tenantId, args.productId],
      });
      /* ★他社の商品を触れないこと。
           「見つかりません」で返すのは、
           そのIDが他社に存在することを教えないためです。 */
      if (cur.rows.length === 0) {
        throw new PurchaseError("NO_PRODUCT", "商品が見つかりません。");
      }
      const before = toProduct(cur.rows[0] as Row);

      await tx.execute({
        sql: `UPDATE point_products
                 SET name = ?, price_yen = ?, points = ?, bonus_points = ?,
                     status = ?, sort_order = ?, updated_at = ?
               WHERE tenant_id = ? AND id = ?`,
        args: [
          name,
          args.priceYen,
          args.points,
          args.bonusPoints,
          args.status,
          args.sortOrder,
          at,
          args.tenantId,
          args.productId,
        ],
      });

      await appendAuditTx(tx, {
        tenantId: args.tenantId,
        at,
        actorKind: args.actor.kind,
        actorId: args.actor.id,
        actorName: args.actor.name,
        actorRole: args.actor.role,
        action: "POINT_PRODUCT_UPDATE",
        target: args.productId,
        summary: `ポイント商品「${name}」を変更（${args.priceYen.toLocaleString("ja-JP")}円 → ${(args.points + args.bonusPoints).toLocaleString("ja-JP")}pt）`,
        before: `${before.name} / ${before.priceYen}円 / ${before.totalPoints}pt / ${before.status}`,
        after: `${name} / ${args.priceYen}円 / ${args.points + args.bonusPoints}pt / ${args.status}`,
        requestId: args.requestId,
        data: {
          productId: args.productId,
          priceYen: args.priceYen,
          points: args.points,
          bonusPoints: args.bonusPoints,
          status: args.status,
        },
      });

      return { productId: args.productId, created: false };
    }

    const productId = id("ppr");
    await tx.execute({
      sql: `INSERT INTO point_products
              (id, tenant_id, name, price_yen, points, bonus_points,
               status, sort_order, created_at, updated_at, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        productId,
        args.tenantId,
        name,
        args.priceYen,
        args.points,
        args.bonusPoints,
        args.status,
        args.sortOrder,
        at,
        at,
        args.actor.id,
      ],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "POINT_PRODUCT_CREATE",
      target: productId,
      summary: `ポイント商品「${name}」を追加（${args.priceYen.toLocaleString("ja-JP")}円 → ${(args.points + args.bonusPoints).toLocaleString("ja-JP")}pt）`,
      after: `${name} / ${args.priceYen}円 / ${args.points + args.bonusPoints}pt / ${args.status}`,
      requestId: args.requestId,
      data: {
        productId,
        priceYen: args.priceYen,
        points: args.points,
        bonusPoints: args.bonusPoints,
        status: args.status,
      },
    });

    return { productId, created: true };
  });
}

/* ══════════════════════════════════════════════
   注文を作る
   ══════════════════════════════════════════════ */

export type CreatedOrder = {
  orderId: string;
  productName: string;
  priceYen: number;
  points: number;
  bonusPoints: number;
  totalPoints: number;
  provider: Provider;
  returnTo: string | null;
};

/**
 * 注文を作る。
 *
 * ★ここでは1ptも足しません。
 *   足すのは confirmPayment（決済会社からの確定通知）だけです。
 *
 * ★金額とポイントを、商品から「写し取って」注文の中に固定します。
 *   あとから商品の設定が変わっても、この注文は動きません。
 */
export async function createOrder(args: {
  tenantId: string;
  userId: string;
  productId: string;
  returnTo?: unknown;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<CreatedOrder> {
  /* ★注文を作る前に、決済業者が使える状態かを確かめること。
       鍵が無いのに注文だけ溜まる状態を作らないためです。 */
  const provider = paymentProvider();
  const at = args.now ?? new Date().toISOString();
  const returnTo = safeReturnTo(args.returnTo);

  return withWriteTx(async (tx) => {
    const cu = await tx.execute({
      sql: `SELECT id, name, status FROM customers
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.userId],
    });
    if (cu.rows.length === 0) {
      throw new PurchaseError("NO_CUSTOMER", "会員情報が見つかりません。");
    }
    const user = cu.rows[0] as Row;
    if (str(user.status) !== "ACTIVE") {
      throw new PurchaseError(
        "CUSTOMER_SUSPENDED",
        "このアカウントは現在ご利用いただけません。",
      );
    }

    const pr = await tx.execute({
      sql: `SELECT id, name, price_yen, points, bonus_points, status
              FROM point_products WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.productId],
    });
    /* ★他社の商品を買えないこと。
         「見つかりません」で返すのは、他社にそのIDがあると
         教えないためです（404 と 403 を打ち分けると存在が漏れます）。 */
    if (pr.rows.length === 0) {
      throw new PurchaseError("NO_PRODUCT", "商品が見つかりません。");
    }
    const p = pr.rows[0] as Row;
    if (str(p.status) !== "ACTIVE") {
      throw new PurchaseError(
        "PRODUCT_DISABLED",
        "この商品は、ただいま販売を停止しています。",
      );
    }

    const orderId = id("por");
    const priceYen = num(p.price_yen);
    const points = num(p.points);
    const bonus = num(p.bonus_points);
    const productName = str(p.name);

    await tx.execute({
      sql: `INSERT INTO point_orders
              (id, tenant_id, user_id, product_id, product_name,
               price_yen, points, bonus_points, status, provider,
               return_to, created_at)
            VALUES (?,?,?,?,?,?,?,?, 'PENDING', ?,?,?)`,
      args: [
        orderId,
        args.tenantId,
        args.userId,
        args.productId,
        productName,
        priceYen,
        points,
        bonus,
        provider,
        returnTo,
        at,
      ],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "POINT_ORDER_CREATE",
      target: orderId,
      summary: `${str(user.name)} さんがポイント購入の注文を作成（${productName} ／ ${priceYen.toLocaleString("ja-JP")}円 → ${(points + bonus).toLocaleString("ja-JP")}pt）`,
      after: "支払い待ち",
      requestId: args.requestId,
      data: {
        orderId,
        userId: args.userId,
        productId: args.productId,
        productName,
        priceYen,
        points,
        bonusPoints: bonus,
        provider,
      },
    });

    return {
      orderId,
      productName,
      priceYen,
      points,
      bonusPoints: bonus,
      totalPoints: points + bonus,
      provider,
      returnTo,
    };
  });
}

/* ══════════════════════════════════════════════
   確定通知（ポイントが増える、唯一の場所）
   ══════════════════════════════════════════════ */

export type ConfirmResult = {
  result: "APPLIED" | "DUPLICATE";
  orderId: string;
  addedPoints: number;
  balance: number;
  returnTo: string | null;
};

/**
 * 決済会社からの確定通知を受け取り、ポイントを足す。
 *
 * ═══════════════════════════════════════════════════════
 * ★この関数以外から、購入ポイントを足さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   画面からも、管理者の操作からも、足しません。
 *   入口を1つにしておかないと、二重加算の備えを
 *   入口の数だけ書き写すことになります。必ず1つ書き忘れます。
 *
 * ═══════════════════════════════════════════════════════
 * ★金額が合わないときは、足さずに記録して止める
 * ═══════════════════════════════════════════════════════
 *
 *   注文は 1,000円なのに、通知は 100円だった。
 *   このとき「100円ぶんのポイントを足す」ことも
 *   「1,000円ぶん足す」こともしません。
 *
 *   前者はお客様が損をします。後者はお店が損をします。
 *   どちらも、機械が勝手に決めてよいことではありません。
 *   ですので加算せず、payment_events に MISMATCH として残し、
 *   監査ログにも残して、人が見るのを待ちます。
 *
 * @param eventId 決済会社が付けた、その通知1回ぶんの番号。
 *                同じ番号が2回来たら、2回目は加算しません。
 */
export async function confirmPayment(args: {
  tenantId: string;
  provider: Provider;
  eventId: string;
  orderId: string;
  amountYen: number;
  requestId: string;
  /* 誰が確定させたか。モックのときは操作したお客様、
     本番のときは決済会社（システム）です。 */
  actor: Actor;
  now?: string;
}): Promise<ConfirmResult> {
  const at = args.now ?? new Date().toISOString();

  if (!args.eventId || args.eventId.length > 200) {
    throw new PurchaseError("BAD_EVENT", "確定通知の番号が正しくありません。");
  }

  /* ═══════════════════════════════════════════════════
     ★断るときは、記録を残してから、外へ出てから断ること
     ═══════════════════════════════════════════════════

       ここは、書き込みを1本の取引（トランザクション）で包んでいます。
       取引の中で例外を投げると、その取引で書いたものは
       ぜんぶ無かったことに戻されます。

       つまり「金額が違うので受信記録に残して断る」を
       素直に書くと、残したはずの記録まで一緒に消えます。
       画面には正しく「受け付けません」と出るので、
       消えていることには、誰も気づけません。

       ですので、取引の中では投げず、
       「断る」という結果を持って外へ出て、
       記録が確定してから断ります。 */
  type Reject = { result: "REJECT"; code: string; message: string };

  const out = await withWriteTx<ConfirmResult | Reject>(async (tx) => {
    /* ── 備え① 同じ通知が来ていないか ────────────
       ★先に見て、あとで入れます。
         withWriteTx は書き込みを1本ずつ順番に通すので、
         見た直後に別の通知が割り込む余地はありません。 */
    const seen = await tx.execute({
      sql: `SELECT order_id, result FROM payment_events
             WHERE tenant_id = ? AND provider = ? AND event_id = ?`,
      args: [args.tenantId, args.provider, args.eventId],
    });
    if (seen.rows.length > 0) {
      const prev = seen.rows[0] as Row;
      const o = await tx.execute({
        sql: `SELECT points, bonus_points, user_id, return_to FROM point_orders
               WHERE tenant_id = ? AND id = ?`,
        args: [args.tenantId, str(prev.order_id) || args.orderId],
      });
      const row = o.rows[0] as Row | undefined;
      const bal = row
        ? await tx.execute({
            sql: `SELECT points FROM customers WHERE tenant_id = ? AND id = ?`,
            args: [args.tenantId, str(row.user_id)],
          })
        : null;
      /* ★ここで「成功」と嘘をつかず、前回の結果をそのまま返します。
           2回目を成功にすると、呼んだ側が
           「2回足りたのでは」と疑えなくなります。 */
      return {
        result: "DUPLICATE" as const,
        orderId: str(prev.order_id) || args.orderId,
        addedPoints: 0,
        balance: bal ? num((bal.rows[0] as Row)?.points) : 0,
        returnTo: row ? safeReturnTo(row.return_to) : null,
      };
    }

    const or = await tx.execute({
      sql: `SELECT id, user_id, product_name, price_yen, points, bonus_points,
                   status, provider, return_to
              FROM point_orders WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.orderId],
    });

    /* ★存在しない注文・他社の注文は、同じ言葉で断ること。
         打ち分けると、番号を総当たりして
         「どの番号が実在するか」を数えられます。 */
    if (or.rows.length === 0) {
      await tx.execute({
        sql: `INSERT INTO payment_events
                (tenant_id, provider, event_id, order_id, result,
                 amount_yen, note, created_at)
              VALUES (?,?,?,?, 'REJECTED', ?,?,?)`,
        args: [
          args.tenantId,
          args.provider,
          args.eventId,
          args.orderId,
          args.amountYen,
          "その注文はありません",
          at,
        ],
      });
      return {
        result: "REJECT" as const,
        code: "NO_ORDER",
        message: "注文が見つかりません。",
      };
    }

    const order = or.rows[0] as Row;
    const userId = str(order.user_id);
    const priceYen = num(order.price_yen);
    const points = num(order.points);
    const bonus = num(order.bonus_points);
    const returnTo = safeReturnTo(order.return_to);

    /* ── 金額の照合 ────────────────────────── */
    if (!Number.isInteger(args.amountYen) || args.amountYen !== priceYen) {
      await tx.execute({
        sql: `INSERT INTO payment_events
                (tenant_id, provider, event_id, order_id, result,
                 amount_yen, note, created_at)
              VALUES (?,?,?,?, 'MISMATCH', ?,?,?)`,
        args: [
          args.tenantId,
          args.provider,
          args.eventId,
          args.orderId,
          args.amountYen,
          `注文は ${priceYen} 円、通知は ${args.amountYen} 円`,
          at,
        ],
      });

      await appendAuditTx(tx, {
        tenantId: args.tenantId,
        at,
        actorKind: "SYSTEM",
        actorId: "payment",
        actorName: `決済（${args.provider}）`,
        actorRole: "SYSTEM",
        action: "POINT_ORDER_AMOUNT_MISMATCH",
        target: args.orderId,
        summary: `確定通知の金額が注文と一致しません。ポイントは足していません（注文 ${priceYen.toLocaleString("ja-JP")}円 ／ 通知 ${String(args.amountYen)}円）。`,
        before: `${priceYen}円`,
        after: `${String(args.amountYen)}円`,
        reason: "金額不一致のため加算を保留",
        requestId: args.requestId,
        data: {
          orderId: args.orderId,
          userId,
          expectedYen: priceYen,
          receivedYen: args.amountYen,
          provider: args.provider,
          eventId: args.eventId,
        },
      });

      return {
        result: "REJECT" as const,
        code: "AMOUNT_MISMATCH",
        message:
          "お支払い金額が注文と一致しないため、ポイントを反映できませんでした。運営が確認いたします。",
      };
    }

    /* ── 備え② PENDING のときだけ PAID にする ──────
       ★先に読んで「PENDING だったから足す」ではなく、
         書き換えが1行に効いたかどうかで判断します。
         読んでから書くまでの隙間に、
         2通目の通知が滑り込めなくなります。 */
    const ledgerId = id("led");
    const marked = await tx.execute({
      sql: `UPDATE point_orders
               SET status = 'PAID', paid_yen = ?, paid_at = ?,
                   provider_ref = ?, ledger_id = ?
             WHERE tenant_id = ? AND id = ? AND status = 'PENDING'`,
      args: [
        args.amountYen,
        at,
        args.eventId,
        ledgerId,
        args.tenantId,
        args.orderId,
      ],
    });

    if (Number(marked.rowsAffected ?? 0) !== 1) {
      const nowStatus = str(order.status);
      await tx.execute({
        sql: `INSERT INTO payment_events
                (tenant_id, provider, event_id, order_id, result,
                 amount_yen, note, created_at)
              VALUES (?,?,?,?, 'DUPLICATE', ?,?,?)`,
        args: [
          args.tenantId,
          args.provider,
          args.eventId,
          args.orderId,
          args.amountYen,
          `注文はすでに ${nowStatus} でした`,
          at,
        ],
      });

      const bal = await tx.execute({
        sql: `SELECT points FROM customers WHERE tenant_id = ? AND id = ?`,
        args: [args.tenantId, userId],
      });

      if (nowStatus === "CANCELED") {
        return {
          result: "REJECT" as const,
          code: "ORDER_CANCELED",
          message: "この注文は取り消されています。ポイントは反映されません。",
        };
      }

      /* すでに支払い済み。足しません。 */
      return {
        result: "DUPLICATE" as const,
        orderId: args.orderId,
        addedPoints: 0,
        balance: num((bal.rows[0] as Row)?.points),
        returnTo,
      };
    }

    /* ── 備え③ 台帳。ref は注文番号。kind='PURCHASE' で一意 ── */
    await tx.execute({
      sql: `INSERT INTO point_ledger
              (id, tenant_id, user_id, kind, delta, memo, ref, created_at)
            VALUES (?,?,?, 'PURCHASE', ?,?,?,?)`,
      args: [
        ledgerId,
        args.tenantId,
        userId,
        points,
        `ポイント購入：${str(order.product_name)}（${priceYen.toLocaleString("ja-JP")}円）`,
        args.orderId,
        at,
      ],
    });

    if (bonus > 0) {
      await tx.execute({
        sql: `INSERT INTO point_ledger
                (id, tenant_id, user_id, kind, delta, memo, ref, created_at)
              VALUES (?,?,?, 'PURCHASE_BONUS', ?,?,?,?)`,
        args: [
          id("led"),
          args.tenantId,
          userId,
          bonus,
          `ポイント購入のボーナス：${str(order.product_name)}`,
          args.orderId,
          at,
        ],
      });
    }

    const added = points + bonus;

    const beforeRow = await tx.execute({
      sql: `SELECT points, name FROM customers WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, userId],
    });
    if (beforeRow.rows.length === 0) {
      throw new PurchaseError("NO_CUSTOMER", "会員情報が見つかりません。");
    }
    const balanceBefore = num((beforeRow.rows[0] as Row).points);
    const userName = str((beforeRow.rows[0] as Row).name);

    /* ★ここは足し算で書くこと（= balanceBefore + added としない）。
         読んだ値を書き戻す形にすると、
         同時に別の増減が入ったときに、それを消してしまいます。 */
    await tx.execute({
      sql: `UPDATE customers SET points = points + ?
             WHERE tenant_id = ? AND id = ?`,
      args: [added, args.tenantId, userId],
    });

    const afterRow = await tx.execute({
      sql: `SELECT points FROM customers WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, userId],
    });
    const balance = num((afterRow.rows[0] as Row)?.points);

    await tx.execute({
      sql: `INSERT INTO payment_events
              (tenant_id, provider, event_id, order_id, result,
               amount_yen, note, created_at)
            VALUES (?,?,?,?, 'APPLIED', ?,?,?)`,
      args: [
        args.tenantId,
        args.provider,
        args.eventId,
        args.orderId,
        args.amountYen,
        `+${added}pt`,
        at,
      ],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "POINT_PURCHASE_APPLIED",
      target: args.orderId,
      summary: `${userName} さんのポイント購入が確定しました（${str(order.product_name)} ／ ${priceYen.toLocaleString("ja-JP")}円 → +${added.toLocaleString("ja-JP")}pt）`,
      before: `残高 ${balanceBefore.toLocaleString("ja-JP")}pt`,
      after: `残高 ${balance.toLocaleString("ja-JP")}pt`,
      requestId: args.requestId,
      data: {
        orderId: args.orderId,
        userId,
        userName,
        productName: str(order.product_name),
        priceYen,
        points,
        bonusPoints: bonus,
        addedPoints: added,
        balanceBefore,
        balanceAfter: balance,
        provider: args.provider,
        eventId: args.eventId,
        ledgerId,
      },
    });

    return {
      result: "APPLIED" as const,
      orderId: args.orderId,
      addedPoints: added,
      balance,
      returnTo,
    };
  });

  /* ★断るのは、記録が確定したあと（取引の外）で。
       ここまで来ていれば、受信記録と監査ログは残っています。 */
  if (out.result === "REJECT") {
    throw new PurchaseError(out.code, out.message);
  }
  return out;
}

/* ══════════════════════════════════════════════
   注文を取り消す
   ══════════════════════════════════════════════ */

/**
 * 支払い待ちの注文を取り消す。
 *
 * ★支払い済み（PAID）は取り消せません。
 *   取り消せてしまうと、ポイントだけ残して注文が消えます。
 *   返金は別の話（お金を戻す手続き）で、ここではやりません。
 */
export async function cancelOrder(args: {
  tenantId: string;
  userId: string;
  orderId: string;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ orderId: string }> {
  const at = args.now ?? new Date().toISOString();

  return withWriteTx(async (tx) => {
    const or = await tx.execute({
      sql: `SELECT id, user_id, status, product_name FROM point_orders
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.orderId],
    });
    if (or.rows.length === 0) {
      throw new PurchaseError("NO_ORDER", "注文が見つかりません。");
    }
    const order = or.rows[0] as Row;

    /* ★他人の注文を取り消せないこと。
         同じ「見つかりません」で返します。 */
    if (str(order.user_id) !== args.userId) {
      throw new PurchaseError("NO_ORDER", "注文が見つかりません。");
    }

    const done = await tx.execute({
      sql: `UPDATE point_orders SET status = 'CANCELED', canceled_at = ?
             WHERE tenant_id = ? AND id = ? AND user_id = ?
               AND status = 'PENDING'`,
      args: [at, args.tenantId, args.orderId, args.userId],
    });
    if (Number(done.rowsAffected ?? 0) !== 1) {
      throw new PurchaseError(
        "ORDER_NOT_PENDING",
        str(order.status) === "PAID"
          ? "この注文はお支払いが済んでいます。取り消せません。"
          : "この注文は、すでに取り消されています。",
      );
    }

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "POINT_ORDER_CANCEL",
      target: args.orderId,
      summary: `ポイント購入の注文を取り消しました（${str(order.product_name)}）`,
      before: "支払い待ち",
      after: "取り消し",
      requestId: args.requestId,
      data: { orderId: args.orderId, userId: args.userId },
    });

    return { orderId: args.orderId };
  });
}

/* ══════════════════════════════════════════════
   読み取り（画面が見るところ）
   ══════════════════════════════════════════════ */

export type OrderView = {
  id: string;
  productName: string;
  priceYen: number;
  points: number;
  bonusPoints: number;
  totalPoints: number;
  status: "PENDING" | "PAID" | "CANCELED";
  provider: string;
  createdAt: string;
  paidAt: string | null;
  returnTo: string | null;
};

function toOrder(r: Row): OrderView {
  const points = num(r.points);
  const bonus = num(r.bonus_points);
  const st = str(r.status);
  return {
    id: str(r.id),
    productName: str(r.product_name),
    priceYen: num(r.price_yen),
    points,
    bonusPoints: bonus,
    totalPoints: points + bonus,
    status: st === "PAID" ? "PAID" : st === "CANCELED" ? "CANCELED" : "PENDING",
    provider: str(r.provider),
    createdAt: str(r.created_at),
    paidAt: r.paid_at ? str(r.paid_at) : null,
    returnTo: safeReturnTo(r.return_to),
  };
}

/**
 * 自分の注文を1件だけ見る。
 *
 * ★必ず userId でも絞ること。
 *   注文番号だけで引くと、番号を書き換えるだけで
 *   他人の購入内容が見えます。
 */
export async function getMyOrder(
  tenantId: string,
  userId: string,
  orderId: string,
): Promise<OrderView | null> {
  const r = await db().execute({
    sql: `SELECT id, product_name, price_yen, points, bonus_points,
                 status, provider, created_at, paid_at, return_to
            FROM point_orders
           WHERE tenant_id = ? AND user_id = ? AND id = ?`,
    args: [tenantId, userId, orderId],
  });
  if (r.rows.length === 0) return null;
  return toOrder(r.rows[0] as Row);
}

/** 自分の購入履歴 */
export async function listMyOrders(
  tenantId: string,
  userId: string,
  limit = 50,
): Promise<OrderView[]> {
  const r = await db().execute({
    sql: `SELECT id, product_name, price_yen, points, bonus_points,
                 status, provider, created_at, paid_at, return_to
            FROM point_orders
           WHERE tenant_id = ? AND user_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?`,
    args: [tenantId, userId, Math.min(Math.max(limit, 1), 200)],
  });
  return r.rows.map((x) => toOrder(x as Row));
}

/** 管理画面：購入一覧 */
export async function listOrdersForAdmin(
  tenantId: string,
  limit = 100,
): Promise<(OrderView & { userId: string; userName: string })[]> {
  const r = await db().execute({
    sql: `SELECT o.id, o.product_name, o.price_yen, o.points, o.bonus_points,
                 o.status, o.provider, o.created_at, o.paid_at, o.return_to,
                 o.user_id, c.name AS user_name
            FROM point_orders o
            LEFT JOIN customers c
              ON c.id = o.user_id AND c.tenant_id = o.tenant_id
           WHERE o.tenant_id = ?
           ORDER BY o.created_at DESC, o.rowid DESC
           LIMIT ?`,
    args: [tenantId, Math.min(Math.max(limit, 1), 500)],
  });
  return r.rows.map((x) => {
    const row = x as Row;
    return {
      ...toOrder(row),
      userId: str(row.user_id),
      userName: str(row.user_name),
    };
  });
}

/** 管理画面：確定通知の受信記録（金額不一致を見つけるため） */
export async function listPaymentEvents(
  tenantId: string,
  limit = 100,
): Promise<
  {
    provider: string;
    eventId: string;
    orderId: string | null;
    result: string;
    amountYen: number | null;
    note: string;
    createdAt: string;
  }[]
> {
  const r = await db().execute({
    sql: `SELECT provider, event_id, order_id, result, amount_yen, note, created_at
            FROM payment_events
           WHERE tenant_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?`,
    args: [tenantId, Math.min(Math.max(limit, 1), 500)],
  });
  return r.rows.map((x) => {
    const row = x as Row;
    return {
      provider: str(row.provider),
      eventId: str(row.event_id),
      orderId: row.order_id ? str(row.order_id) : null,
      result: str(row.result),
      amountYen: row.amount_yen == null ? null : num(row.amount_yen),
      note: str(row.note),
      createdAt: str(row.created_at),
    };
  });
}
