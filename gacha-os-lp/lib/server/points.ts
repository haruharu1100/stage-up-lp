/**
 * ポイントの増減を、サーバー側で本当に動かす場所。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、画面の中だけではだめなのか
 * ═══════════════════════════════════════════════════════
 *
 *   これまで、二人承認は画面の中だけの話でした。
 *   画面を閉じれば消えます。つまり、
 *
 *       ・誰が申請したのか
 *       ・誰が承認したのか
 *       ・本当に残高が動いたのか
 *
 *   のどれも、あとから確かめられませんでした。
 *
 *   ポイントは、お金と同じものです。
 *   お金が動いたのに、動かした人が残らない仕組みは、
 *   不正を止められないだけでなく、
 *   疑われた担当者の身も守れません。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここが必ず守ること
 * ═══════════════════════════════════════════════════════
 *
 *   1) 申請と承認を、別の行として残す。
 *      1行に「承認済み」とだけ書くと、
 *      申請者と承認者が同じ人だったかが分からなくなります。
 *
 *   2) 自分が出した申請は、自分では承認できない。
 *      権限を持っているかどうかとは、別の話です。
 *      ここを外すと、全権管理者が1人で好きなだけポイントを作れます。
 *
 *   3) 残高を「書き換え」ない。台帳に1行足す。
 *      書き換えると、途中で失敗したときに
 *      いくつだったのかが誰にも分からなくなります。
 *
 *   4) 承認・台帳・監査ログを、1つの取引でまとめる。
 *      「承認は済んだのにポイントが増えていない」を
 *      構造として起こせなくします。
 *
 *   5) 二度押されても、2行目を入れない。
 *      承認ボタンは、たいてい2回押されます。
 *      通信が遅いときは、押した人に悪気はありません。
 */

import { withWriteTx } from "./db";
import { appendAuditTx } from "./audit";
import { id } from "./ids";

/** 断る理由。呼んだ側が、そのまま日本語で返せる形にしておく */
export class PointError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PointError";
  }
}

/**
 * 1回で動かしてよい上限。
 *
 * ★上限を置かない作りにしないこと。
 *   桁を1つ多く打つのは、悪意ではなく、ただの打ち間違いです。
 *   打ち間違いを、そのまま通してしまう仕組みのほうが問題です。
 */
const MAX_DELTA = 1_000_000;

/** なぜ動かすのか。短すぎる理由を受け付けないこと */
const MIN_REASON = 4;

export type AdjustmentRow = {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  status: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  ledger_id: string | null;
};

type Actor = {
  tenantId: string;
  adminId: string;
  adminName: string;
  role: string;
  requestId: string;
};

/* ══════════════════════════════════════════════
   申請する
   ══════════════════════════════════════════════ */

export async function requestAdjustment(
  actor: Actor,
  input: { userId: string; delta: number; reason: string },
): Promise<{ adjustmentId: string }> {
  const delta = Math.trunc(Number(input.delta));
  const reason = String(input.reason ?? "").trim();

  if (!Number.isFinite(delta) || delta === 0) {
    throw new PointError("BAD_DELTA", "増減するポイント数を入力してください。");
  }
  if (Math.abs(delta) > MAX_DELTA) {
    throw new PointError(
      "DELTA_TOO_LARGE",
      `1回で動かせるのは ${MAX_DELTA.toLocaleString("ja-JP")} ポイントまでです。`,
    );
  }
  if (reason.length < MIN_REASON) {
    throw new PointError(
      "REASON_REQUIRED",
      "なぜ変更するのかを、あとから読んで分かる長さで書いてください。",
    );
  }

  const at = new Date().toISOString();
  const adjustmentId = id("adj");

  await withWriteTx(async (tx) => {
    /* ★対象のお客様が、自分の会社の人であることを必ず確かめる。
         確かめないと、他社のIDを送るだけで他社の残高が動きます。 */
    const cu = await tx.execute({
      sql: `SELECT id, name FROM customers
             WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [input.userId, actor.tenantId],
    });
    const customer = cu.rows[0] as Record<string, unknown> | undefined;
    if (!customer) {
      /* ★「他社の方です」と返さないこと。
           返すと、そのIDが存在することを教えてしまいます。 */
      throw new PointError("NO_CUSTOMER", "対象の会員が見つかりません。");
    }

    await tx.execute({
      sql: `INSERT INTO point_adjustments
              (id, tenant_id, user_id, delta, reason, status,
               requested_by, requested_at)
            VALUES (?,?,?,?,?, 'PENDING', ?,?)`,
      args: [
        adjustmentId,
        actor.tenantId,
        input.userId,
        delta,
        reason,
        actor.adminId,
        at,
      ],
    });

    await appendAuditTx(tx, {
      tenantId: actor.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: actor.adminId,
      actorName: actor.adminName,
      actorRole: actor.role,
      action: "POINT_ADJUST_REQUEST",
      target: input.userId,
      summary: `${String(customer.name ?? "")} さんのポイントを ${
        delta > 0 ? "+" : ""
      }${delta} する申請`,
      reason,
      data: { adjustmentId, delta },
      requestId: actor.requestId,
    });
  });

  return { adjustmentId };
}

/* ══════════════════════════════════════════════
   承認する・断る
   ══════════════════════════════════════════════ */

export async function decideAdjustment(
  actor: Actor,
  input: { adjustmentId: string; approve: boolean; note?: string },
): Promise<{ status: "APPROVED" | "REJECTED"; balance: number | null }> {
  const at = new Date().toISOString();
  const note = String(input.note ?? "").trim() || null;

  return withWriteTx(async (tx) => {
    const got = await tx.execute({
      sql: `SELECT id, user_id, delta, reason, status, requested_by
              FROM point_adjustments
             WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [input.adjustmentId, actor.tenantId],
    });
    const row = got.rows[0] as unknown as AdjustmentRow | undefined;
    if (!row) {
      throw new PointError("NO_ADJUSTMENT", "その申請は見つかりません。");
    }

    /* ★すでに処理済みなら、そこで止める。
         二度押しは、悪意ではなく、通信が遅いときに普通に起きます。 */
    if (row.status !== "PENDING") {
      throw new PointError(
        "ALREADY_DECIDED",
        "この申請は、すでに処理されています。",
      );
    }

    /* ★ここが二人承認の本体。
         権限があるかどうかとは、別に確かめること。
         入口の permission 判定だけにすると、
         全権管理者が1人でポイントを作れてしまいます。 */
    if (row.requested_by === actor.adminId) {
      throw new PointError(
        "SELF_APPROVAL",
        "自分が出した申請は、自分では承認できません。別の管理者にお願いしてください。",
      );
    }

    if (!input.approve) {
      await tx.execute({
        sql: `UPDATE point_adjustments
                 SET status = 'REJECTED', decided_by = ?, decided_at = ?, decided_note = ?
               WHERE id = ? AND tenant_id = ? AND status = 'PENDING'`,
        args: [actor.adminId, at, note, row.id, actor.tenantId],
      });

      await appendAuditTx(tx, {
        tenantId: actor.tenantId,
        at,
        actorKind: "ADMIN",
        actorId: actor.adminId,
        actorName: actor.adminName,
        actorRole: actor.role,
        action: "POINT_ADJUST_REJECT",
        target: row.user_id,
        summary: `ポイント変更の申請を却下（${row.delta > 0 ? "+" : ""}${row.delta}）`,
        reason: note ?? row.reason,
        data: { adjustmentId: row.id, delta: row.delta },
        requestId: actor.requestId,
      });

      return { status: "REJECTED" as const, balance: null };
    }

    /* ── 承認。ここからお金が動く ───────────────── */

    const before = await tx.execute({
      sql: `SELECT points FROM customers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [row.user_id, actor.tenantId],
    });
    const beforeRow = before.rows[0] as Record<string, unknown> | undefined;
    if (!beforeRow) {
      throw new PointError("NO_CUSTOMER", "対象の会員が見つかりません。");
    }
    const beforePoints = Number(beforeRow.points ?? 0);
    const afterPoints = beforePoints + row.delta;

    /* ★残高を負にしないこと。
         負を許すと、次に引いたときに「残高が足りている」判定が
         おかしくなります。減らしすぎは、その場で断ります。 */
    if (afterPoints < 0) {
      throw new PointError(
        "WOULD_GO_NEGATIVE",
        `いまの残高は ${beforePoints} ポイントです。${Math.abs(
          row.delta,
        )} ポイントは引けません。`,
      );
    }

    const ledgerId = id("pl");

    /* ★状態を先に「承認済み」へ動かし、
         そのときに ledger_id も入れる。
         ux_point_adj_ledger（重複禁止）が効くので、
         万一2回通っても2行目は入りません。 */
    const marked = await tx.execute({
      sql: `UPDATE point_adjustments
               SET status = 'APPROVED', decided_by = ?, decided_at = ?,
                   decided_note = ?, ledger_id = ?
             WHERE id = ? AND tenant_id = ? AND status = 'PENDING'`,
      args: [actor.adminId, at, note, ledgerId, row.id, actor.tenantId],
    });
    if (Number(marked.rowsAffected ?? 0) !== 1) {
      throw new PointError(
        "ALREADY_DECIDED",
        "この申請は、すでに処理されています。",
      );
    }

    await tx.execute({
      sql: `INSERT INTO point_ledger
              (id, tenant_id, user_id, kind, delta, memo, ref, created_at)
            VALUES (?,?,?, 'ADMIN_ADJUST', ?,?,?,?)`,
      args: [
        ledgerId,
        actor.tenantId,
        row.user_id,
        row.delta,
        `運営による調整：${row.reason}`,
        row.id,
        at,
      ],
    });

    await tx.execute({
      sql: `UPDATE customers SET points = ? WHERE id = ? AND tenant_id = ?`,
      args: [afterPoints, row.user_id, actor.tenantId],
    });

    await appendAuditTx(tx, {
      tenantId: actor.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: actor.adminId,
      actorName: actor.adminName,
      actorRole: actor.role,
      action: "POINT_ADJUST_APPROVE",
      target: row.user_id,
      summary: `ポイントを ${row.delta > 0 ? "+" : ""}${row.delta} 調整（申請者とは別の担当者が承認）`,
      before: String(beforePoints),
      after: String(afterPoints),
      reason: row.reason,
      data: {
        adjustmentId: row.id,
        ledgerId,
        requestedBy: row.requested_by,
        approvedBy: actor.adminId,
      },
      requestId: actor.requestId,
    });

    return { status: "APPROVED" as const, balance: afterPoints };
  });
}
