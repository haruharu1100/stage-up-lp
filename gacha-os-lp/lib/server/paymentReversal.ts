/**
 * 決済会社の側で、お金が引き戻されたときの処理（強制取消）。
 *
 * ═══════════════════════════════════════════════════════
 * ★これは「返金機能」ではありません
 * ═══════════════════════════════════════════════════════
 *
 *   このシステムに、お店の判断でポイント購入を返金する機能は
 *   ありません。作っていません。意図的にです。
 *
 *   理由：ポイントは、その場でガチャに使えます。
 *   引いたあとに返金を認めると、こうなります。
 *
 *       1万円ぶんポイントを買う
 *         ↓
 *       引く。良いカードが出なかった
 *         ↓
 *       返金を申し出る
 *         ↓
 *       お金は戻り、引いた記録だけが残る
 *
 *   これを認めた時点で、店は必ず負けます。
 *
 *   ですので、ここで扱うのは1種類だけです。
 *
 *       決済会社・カード会社の側で、こちらの意思と関係なく
 *       お金が引き戻された（チャージバック／強制返金）
 *
 *   こちらに拒否権はありません。すでにお金は出ていっています。
 *   ですので「受け入れて、正しく記録する」ことだけをします。
 *
 * ═══════════════════════════════════════════════════════
 * ★過去の台帳を書き換えないこと。これが最重要です
 * ═══════════════════════════════════════════════════════
 *
 *   いちど付けたポイントの行（PURCHASE）は、そのまま残します。
 *   消しません。金額も変えません。
 *
 *   代わりに、新しい行を1つ足します。これを逆仕訳といいます。
 *
 *       2026-09-01  PURCHASE           +1,000pt   ← 残す
 *       2026-09-06  PURCHASE_REVERSAL  -1,000pt   ← 足す
 *
 *   なぜ書き換えてはいけないのか。
 *
 *     書き換えると、あとから見たときに
 *     「最初から付いていなかった」ようにしか見えません。
 *     いつ何が起きたのかを、誰も再現できなくなります。
 *
 *     揉めごとは、必ず「あとから」起きます。
 *     そのときに残っていない記録は、無かったのと同じです。
 *     カード会社に事情を説明することも、できなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★引けなかったぶんを、0で埋めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   お客様がもうポイントを使い切っていると、引くものがありません。
 *
 *       付けたポイント     1,000pt
 *       いまの残高           200pt
 *       引けるのは           200pt
 *       引けないのは         800pt  ← これが被害額
 *
 *   ★残高をマイナスにしないこと。
 *     マイナスの残高は、画面のあちこちで想定されていません。
 *     「-800pt なのにガチャが引ける」のような壊れ方をします。
 *
 *   ★引けなかった 800pt を、0として捨てないこと。
 *     捨てると、被害額そのものが帳簿から消えます。
 *     いくら取りはぐれたのかを、誰も答えられなくなります。
 *
 *   ですので、引けるぶんだけ引いて、
 *   引けなかったぶんは unrecovered として別に残します。
 *
 * ═══════════════════════════════════════════════════════
 * ★会員を、自動で利用停止にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   カード会社の取消は、本人の落ち度とは限りません。
 *
 *     ・カードを盗まれた（本人も被害者）
 *     ・家族が黙って使った
 *     ・決済会社側の手違い
 *     ・本当に不正利用
 *
 *   機械には見分けられません。ですので「要確認」の印だけを付け、
 *   止めるかどうかは人が決めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★残高を直接書き換えている件について
 * ═══════════════════════════════════════════════════════
 *
 *   このファイルは customers.points を動かします。
 *   台帳への書き込み・残高の更新・監査ログを、
 *   すべて同じ1つの取引（withWriteTx）の中でやっています。
 *   途中で落ちれば、全部なかったことに戻ります。
 */

import { withWriteTx } from "./db";
import { appendAuditTx } from "./audit";
import { id } from "./ids";
import type { Actor } from "./orders";
import { PurchaseError, type Provider } from "./pointPurchase";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const pt = (n: number) => `${n.toLocaleString("ja-JP")}pt`;

/** 取消の理由。★勝手に増やさないこと。増やすなら画面の表示も直すこと */
export type ReversalReason = "CHARGEBACK" | "FORCED_REFUND";

export const REVERSAL_REASON_LABEL: Record<ReversalReason, string> = {
  CHARGEBACK: "カード会社による取消（チャージバック）",
  FORCED_REFUND: "決済会社による強制返金",
};

export type ReversalResult =
  | {
      result: "APPLIED";
      reversalId: string;
      orderId: string;
      userId: string;
      /** 本来引くべきだったポイント（付与した全部） */
      pointsToReverse: number;
      /** 実際に引けたポイント */
      pointsReversed: number;
      /** 引けなかったポイント。★0で埋めない */
      unrecoveredPoints: number;
      /** 引けなかったぶんの相当額（円） */
      unrecoveredAmount: number;
      /** 引いたあとの残高 */
      balance: number;
      /** 足した逆仕訳の行 */
      ledgerId: string;
    }
  | {
      /** 同じ取消通知が2回来た。1回目の結果をそのまま返す */
      result: "DUPLICATE";
      reversalId: string;
      orderId: string;
      userId: string;
      pointsToReverse: number;
      pointsReversed: number;
      unrecoveredPoints: number;
      unrecoveredAmount: number;
    };

/**
 * 強制取消を受け入れて、記録する。
 *
 * ★呼ぶ場所は、決済会社からの通知を受ける入口だけにすること。
 *   管理画面から人が押せるボタンにしないでください。
 *   押せる形にした瞬間、これは「返金機能」になります。
 *
 * @throws PurchaseError 受け付けられないとき
 */
export async function applyForcedReversal(args: {
  tenantId: string;
  provider: Provider;
  /** 決済会社が付けた、その取消通知1回ぶんの番号 */
  eventId: string;
  orderId: string;
  reason: ReversalReason;
  /** 取り消された金額（円） */
  amountYen: number;
  requestId: string;
  /** 誰が確定させたか。本番では決済会社（システム） */
  actor: Actor;
  now?: string;
}): Promise<ReversalResult> {
  const at = args.now ?? new Date().toISOString();

  if (!args.eventId || args.eventId.length > 200) {
    throw new PurchaseError("BAD_EVENT", "取消通知の番号が正しくありません。");
  }
  if (!Number.isInteger(args.amountYen) || args.amountYen <= 0) {
    throw new PurchaseError("BAD_AMOUNT", "取消の金額が正しくありません。");
  }

  /* ★断るときは、取引の外へ出てから断ること。
       取引の中で投げると、残したはずの記録まで一緒に消えます。
       （confirmPayment と同じ考え方です） */
  type Reject = { result: "REJECT"; code: string; message: string };

  const out = await withWriteTx<ReversalResult | Reject>(async (tx) => {
    /* ── 備え① 同じ取消通知が来ていないか ──────────
         payment_reversals の一意制約が最後の砦ですが、
         先に見ておくと、はっきりした結果を返せます。 */
    const seen = await tx.execute({
      sql: `SELECT id, order_id, user_id, points_to_reverse, points_reversed,
                   unrecovered_points, unrecovered_amount
              FROM payment_reversals
             WHERE tenant_id = ? AND provider = ? AND event_id = ?`,
      args: [args.tenantId, args.provider, args.eventId],
    });
    if (seen.rows.length > 0) {
      const p = seen.rows[0] as Row;
      /* ★2回目を「成功」にしないこと。
           2回引いたのかどうかを、呼んだ側が疑えなくなります。 */
      return {
        result: "DUPLICATE" as const,
        reversalId: str(p.id),
        orderId: str(p.order_id),
        userId: str(p.user_id),
        pointsToReverse: num(p.points_to_reverse),
        pointsReversed: num(p.points_reversed),
        unrecoveredPoints: num(p.unrecovered_points),
        unrecoveredAmount: num(p.unrecovered_amount),
      };
    }

    /* ★入金の通知と、同じ番号が使われていないか。
         同じ番号なら、片方は偽物か、決済会社側の手違いです。
         どちらにしても、機械が黙って決めてよいことではありません。 */
    const clash = await tx.execute({
      sql: `SELECT result FROM payment_events
             WHERE tenant_id = ? AND provider = ? AND event_id = ?`,
      args: [args.tenantId, args.provider, args.eventId],
    });
    if (clash.rows.length > 0) {
      return {
        result: "REJECT" as const,
        code: "EVENT_ID_CLASH",
        message:
          "この取消通知の番号は、すでに入金の通知として使われています。運営が確認するまで処理しません。",
      };
    }

    /* ── 注文を読む ────────────────────────── */
    const or = await tx.execute({
      sql: `SELECT id, user_id, product_name, price_yen, points, bonus_points,
                   status, paid_yen
              FROM point_orders WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.orderId],
    });
    if (or.rows.length === 0) {
      return {
        result: "REJECT" as const,
        code: "NO_ORDER",
        message: "注文が見つかりません。",
      };
    }

    const order = or.rows[0] as Row;
    const status = str(order.status);
    const userId = str(order.user_id);
    const priceYen = num(order.price_yen);
    const productName = str(order.product_name);

    /* ★支払い済みでない注文は、取り消しようがありません。
         ここを通してしまうと、付けてもいないポイントを引きます。 */
    if (status !== "PAID") {
      return {
        result: "REJECT" as const,
        code: "ORDER_NOT_PAID",
        message: `この注文は入金確定していません（いまの状態：${status}）。取り消すものがありません。`,
      };
    }

    /* ★引くのは「付けた全部」。ボーナスも含みます。
         お金が全部戻っているのに、ボーナスだけ残す理由がありません。 */
    const pointsToReverse = num(order.points) + num(order.bonus_points);

    const cust = await tx.execute({
      sql: `SELECT points, name FROM customers WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, userId],
    });
    if (cust.rows.length === 0) {
      throw new PurchaseError("NO_CUSTOMER", "会員情報が見つかりません。");
    }
    const balanceBefore = num((cust.rows[0] as Row).points);
    const userName = str((cust.rows[0] as Row).name);

    /* ── 引けるぶんだけ引く ────────────────────
         ★残高をマイナスにしないこと。
           マイナスの残高は、画面のどこも想定していません。 */
    const pointsReversed = Math.max(
      0,
      Math.min(balanceBefore, pointsToReverse),
    );
    const unrecoveredPoints = pointsToReverse - pointsReversed;

    /* 引けなかったぶんの相当額。
       ★四捨五入ではなく切り上げにすること。
         取りはぐれた額を、少なめに見積もらないためです。 */
    const unrecoveredAmount =
      pointsToReverse > 0
        ? Math.ceil((args.amountYen * unrecoveredPoints) / pointsToReverse)
        : 0;

    /* ── 逆仕訳を1行足す（過去の行は触らない） ────── */
    const ledgerId = id("led");
    if (pointsReversed > 0) {
      await tx.execute({
        sql: `INSERT INTO point_ledger
                (id, tenant_id, user_id, kind, delta, memo, ref, created_at)
              VALUES (?,?,?, 'PURCHASE_REVERSAL', ?,?,?,?)`,
        args: [
          ledgerId,
          args.tenantId,
          userId,
          -pointsReversed,
          `${REVERSAL_REASON_LABEL[args.reason]}：${productName}（${yen(priceYen)}）`,
          args.orderId,
          at,
        ],
      });

      /* ★足し引きで書くこと（= balanceBefore - x としない）。
           読んだ値を書き戻すと、同時に入った増減を消します。 */
      await tx.execute({
        sql: `UPDATE customers SET points = points - ?
               WHERE tenant_id = ? AND id = ?`,
        args: [pointsReversed, args.tenantId, userId],
      });
    }

    const afterRow = await tx.execute({
      sql: `SELECT points FROM customers WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, userId],
    });
    const balance = num((afterRow.rows[0] as Row)?.points);

    /* ★念のための最後の確認。
         ここが負なら、上の計算のどこかが壊れています。
         気づかずに進むより、取引ごと戻すほうが安全です。 */
    if (balance < 0) {
      throw new PurchaseError(
        "BALANCE_NEGATIVE",
        "残高がマイナスになりました。処理を取り消しました。",
      );
    }

    /* ── 注文の状態を変える ────────────────────
         ★PAID を消さないこと。
           「支払われた事実」と「あとで引き戻された事実」は別です。
           REVERSED という別の状態にして、両方を残します。 */
    await tx.execute({
      sql: `UPDATE point_orders SET status = 'REVERSED'
             WHERE tenant_id = ? AND id = ? AND status = 'PAID'`,
      args: [args.tenantId, args.orderId],
    });

    /* ── 取消の記録 ────────────────────────── */
    const reversalId = id("rev");
    await tx.execute({
      sql: `INSERT INTO payment_reversals
              (id, tenant_id, order_id, user_id, provider, event_id, reason,
               amount_yen, points_to_reverse, points_reversed,
               unrecovered_points, unrecovered_amount, ledger_id, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        reversalId,
        args.tenantId,
        args.orderId,
        userId,
        args.provider,
        args.eventId,
        args.reason,
        args.amountYen,
        pointsToReverse,
        pointsReversed,
        unrecoveredPoints,
        unrecoveredAmount,
        pointsReversed > 0 ? ledgerId : null,
        at,
      ],
    });

    await tx.execute({
      sql: `INSERT INTO payment_events
              (tenant_id, provider, event_id, order_id, result,
               amount_yen, note, created_at)
            VALUES (?,?,?,?, 'REVERSED', ?,?,?)`,
      args: [
        args.tenantId,
        args.provider,
        args.eventId,
        args.orderId,
        args.amountYen,
        `-${String(pointsReversed)}pt（回収できず ${String(unrecoveredPoints)}pt）`,
        at,
      ],
    });

    /* ── 会員に「要確認」の印を付ける（利用停止にはしない） ── */
    await tx.execute({
      sql: `UPDATE customers
               SET review_flag = 'PAYMENT_REVERSAL',
                   review_note = ?,
                   review_at = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [
        `${REVERSAL_REASON_LABEL[args.reason]}が発生しました（${yen(args.amountYen)}）。` +
          (unrecoveredPoints > 0
            ? `ポイントを使い切っていたため ${pt(unrecoveredPoints)}（${yen(unrecoveredAmount)}相当）を回収できていません。`
            : "ポイントは全額を引き戻しました。") +
          "止めるかどうかは、中身を見て判断してください。",
        at,
        args.tenantId,
        userId,
      ],
    });

    /* ── 監査ログ ─────────────────────────── */
    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "POINT_PURCHASE_REVERSED",
      target: args.orderId,
      summary:
        `${userName} さんの購入が、${REVERSAL_REASON_LABEL[args.reason]}で取り消されました` +
        `（${productName} ／ ${yen(args.amountYen)} → 逆仕訳 -${pt(pointsReversed)}）`,
      before: `残高 ${pt(balanceBefore)}`,
      after: `残高 ${pt(balance)}`,
      reason: REVERSAL_REASON_LABEL[args.reason],
      requestId: args.requestId,
      data: {
        reversalId,
        orderId: args.orderId,
        userId,
        userName,
        provider: args.provider,
        eventId: args.eventId,
        amountYen: args.amountYen,
        pointsToReverse,
        pointsReversed,
        unrecoveredPoints,
        unrecoveredAmount,
        /* ★過去の行を書き換えていないことを、記録にも残しておきます */
        ledgerRewritten: false,
      },
    });

    /* ★回収できなかったときは、必ず別の行を残すこと。
         上の1件に混ぜると、被害額だけを数えられなくなります。 */
    if (unrecoveredPoints > 0) {
      await appendAuditTx(tx, {
        tenantId: args.tenantId,
        at,
        actorKind: "SYSTEM",
        actorId: "payment",
        actorName: `決済（${args.provider}）`,
        actorRole: "SYSTEM",
        action: "POINT_REVERSAL_UNRECOVERED",
        target: args.orderId,
        summary:
          `回収できなかった額が出ました：${pt(unrecoveredPoints)}（${yen(unrecoveredAmount)}相当）。` +
          `${userName} さんは、すでにポイントを使っています。`,
        before: `引くべき ${pt(pointsToReverse)}`,
        after: `引けた ${pt(pointsReversed)}`,
        reason: "残高が足りず、全額を引き戻せませんでした",
        requestId: args.requestId,
        data: {
          reversalId,
          orderId: args.orderId,
          userId,
          unrecoveredPoints,
          unrecoveredAmount,
        },
      });
    }

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "SYSTEM",
      actorId: "payment",
      actorName: `決済（${args.provider}）`,
      actorRole: "SYSTEM",
      action: "CUSTOMER_REVIEW_FLAGGED",
      target: userId,
      summary: `${userName} さんを要確認にしました（利用停止ではありません）。`,
      reason: REVERSAL_REASON_LABEL[args.reason],
      requestId: args.requestId,
      data: { userId, userName, reversalId, orderId: args.orderId },
    });

    return {
      result: "APPLIED" as const,
      reversalId,
      orderId: args.orderId,
      userId,
      pointsToReverse,
      pointsReversed,
      unrecoveredPoints,
      unrecoveredAmount,
      balance,
      ledgerId,
    };
  });

  if ((out as Reject).result === "REJECT") {
    const r = out as Reject;
    throw new PurchaseError(r.code, r.message);
  }
  return out as ReversalResult;
}

/* ══════════════════════════════════════════════
   管理画面から見るための読み取り
   ══════════════════════════════════════════════ */

export type ReversalRow = {
  id: string;
  orderId: string;
  userId: string;
  userName: string;
  provider: string;
  reason: ReversalReason;
  reasonLabel: string;
  amountYen: number;
  pointsToReverse: number;
  pointsReversed: number;
  unrecoveredPoints: number;
  unrecoveredAmount: number;
  createdAt: string;
};

/**
 * 強制取消の一覧。
 *
 * ★この画面を必ず作ること。
 *   記録は残っているのに誰も見ない、では、残す意味がありません。
 */
export async function listReversals(
  tenantId: string,
  limit = 100,
): Promise<ReversalRow[]> {
  const { db } = await import("./db");
  const res = await db().execute({
    sql: `SELECT r.*, c.name AS user_name
            FROM payment_reversals r
            LEFT JOIN customers c
              ON c.tenant_id = r.tenant_id AND c.id = r.user_id
           WHERE r.tenant_id = ?
           ORDER BY r.created_at DESC
           LIMIT ?`,
    args: [tenantId, Math.max(1, Math.min(500, limit))],
  });

  return res.rows.map((raw) => {
    const r = raw as Row;
    const reason = (str(r.reason) === "FORCED_REFUND"
      ? "FORCED_REFUND"
      : "CHARGEBACK") as ReversalReason;
    return {
      id: str(r.id),
      orderId: str(r.order_id),
      userId: str(r.user_id),
      userName: str(r.user_name),
      provider: str(r.provider),
      reason,
      reasonLabel: REVERSAL_REASON_LABEL[reason],
      amountYen: num(r.amount_yen),
      pointsToReverse: num(r.points_to_reverse),
      pointsReversed: num(r.points_reversed),
      unrecoveredPoints: num(r.unrecovered_points),
      unrecoveredAmount: num(r.unrecovered_amount),
      createdAt: str(r.created_at),
    };
  });
}

export type ReversalSummary = {
  /** 取消の件数 */
  count: number;
  /** 取り消された金額の合計（円） */
  amountYen: number;
  /** 回収できなかった額の合計（円）。★これがいちばん見たい数字 */
  unrecoveredAmount: number;
  /** 要確認のまま残っている会員の数 */
  reviewPending: number;
};

/**
 * 管理画面の「今日やること」に出すための集計。
 *
 * ★unrecoveredAmount を必ず単独で出すこと。
 *   取消の件数だけを見ていると、
 *   「1件だが30万円取りはぐれた」に気づけません。
 */
export async function reversalSummary(
  tenantId: string,
): Promise<ReversalSummary> {
  const { db } = await import("./db");
  const client = db();

  const a = await client.execute({
    sql: `SELECT COUNT(*) AS c,
                 COALESCE(SUM(amount_yen), 0) AS amt,
                 COALESCE(SUM(unrecovered_amount), 0) AS unrec
            FROM payment_reversals WHERE tenant_id = ?`,
    args: [tenantId],
  });
  const b = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM customers
           WHERE tenant_id = ? AND review_flag IS NOT NULL AND review_flag <> ''`,
    args: [tenantId],
  });

  const r = a.rows[0] as Row;
  return {
    count: num(r.c),
    amountYen: num(r.amt),
    unrecoveredAmount: num(r.unrec),
    reviewPending: num((b.rows[0] as Row).c),
  };
}

/**
 * 要確認の印を、人が見たうえで外す。
 *
 * ★自動で外さないこと。時間が経っても外さないこと。
 *   外してよいと決められるのは、中身を見た人だけです。
 */
export async function clearReviewFlag(args: {
  tenantId: string;
  userId: string;
  actor: Actor;
  note: string;
  requestId: string;
  now?: string;
}): Promise<void> {
  const at = args.now ?? new Date().toISOString();
  const note = args.note.trim();
  if (note === "") {
    throw new PurchaseError(
      "REASON_REQUIRED",
      "確認した内容を書いてください。空のままでは解除できません。",
    );
  }

  await withWriteTx(async (tx) => {
    const cur = await tx.execute({
      sql: `SELECT name, review_flag, review_note FROM customers
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.userId],
    });
    if (cur.rows.length === 0) {
      throw new PurchaseError("NO_CUSTOMER", "会員情報が見つかりません。");
    }
    const row = cur.rows[0] as Row;

    await tx.execute({
      sql: `UPDATE customers
               SET review_flag = NULL, review_note = NULL, review_at = NULL
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.userId],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "CUSTOMER_REVIEW_CLEARED",
      target: args.userId,
      summary: `${str(row.name)} さんの要確認を解除しました。`,
      before: str(row.review_note),
      after: note,
      reason: note,
      requestId: args.requestId,
      data: { userId: args.userId, note },
    });
  });
}
