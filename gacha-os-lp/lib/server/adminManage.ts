/**
 * 担当者の権限変更と、利用停止。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを作ったのか
 * ═══════════════════════════════════════════════════════
 *
 *   権限の即時反映も、停止の即時反映も、中身はもう動いていました。
 *   ところが「権限を変える」「止める」という操作の入口が、
 *   管理画面のどこにもありませんでした。
 *
 *   つまり、辞めた人のアカウントを止めるのに、
 *   DBを直接さわるしかない状態でした。
 *   それは、契約者にお渡しできる製品ではありません。
 *
 * ═══════════════════════════════════════════════════════
 * ★守っていること（UIだけで止めないこと）
 * ═══════════════════════════════════════════════════════
 *
 *   画面でボタンを隠すのは、親切のためであって、守りではありません。
 *   守りは、必ずここ（サーバー側）に置きます。
 *   入口を直接たたかれても、同じ理由で断ります。
 *
 *     ① 他社の担当者は、そもそも見つからない（tenant_id で必ず絞る）
 *     ② 自分自身の権限は下げられない
 *     ③ 自分自身は停止できない
 *     ④ 最後のSUPER ADMINは、降格も停止もできない
 *     ⑤ 理由が無い操作は通さない
 *     ⑥ すべて監査ログに残す
 *
 * ═══════════════════════════════════════════════════════
 * ★②と④が、なぜ必要なのか
 * ═══════════════════════════════════════════════════════
 *
 *   管理者が1人しかいない会社で、その人が自分を「閲覧のみ」に
 *   変えてしまうと、もう誰も権限を戻せません。
 *   DBを直接さわれる人を呼ぶまで、会社の管理画面が死にます。
 *
 *   これは「操作ミス」ですが、起きたときの被害は事故と同じです。
 *   ★戻せない操作は、そもそもさせないこと。
 *
 *   同じ理由で、最後の1人のSUPER ADMINは止められません。
 *   「辞める人を止める」より先に、
 *   「次の管理者を作る」をやってもらいます。
 */

import { withWriteTx } from "./db";
import type { Transaction } from "@libsql/client";
import { appendAuditTx } from "./audit";
import { destroyAllSessionsOf } from "./session";
/*
 * ★このファイルで asRole() を使わないこと。parseRole() を使うこと。
 *
 *   asRole() は、知らない値を VIEWER に丸めます。
 *   画面に役職名を出すための道具なので、それで正しいのです。
 *
 *   けれど、ここは「権限を変える」場所です。丸められると、
 *   打ち間違いや古い役割名が、そのまま黙った降格になります。
 *   運営の方は「経理にしたつもり」で、実際は閲覧のみになります。
 *   DBの役割が壊れていたときも、「VIEWER だったことにする」と
 *   決めつけて上書きしてしまい、壊れていた事実がその場で消えます。
 *
 *   2026-08-26、担当者管理の試験で実際に見つかりました
 *   （"GOD_MODE" を送ると、黙って VIEWER に降格できていた）。
 *   parseRole() は、知らない値なら null を返します。必ず断ります。
 */
import { parseRole, ROLE_LABEL, type Role } from "../permissions";

type Row = Record<string, unknown>;

/** 理由として短すぎる文字数。仮パスワード発行と同じ基準にそろえる */
export const MIN_REASON = 4;

export type AdminManageCode =
  | "NO_SUCH_USER"
  | "NO_REASON"
  | "SELF_DEMOTE"
  | "SELF_SUSPEND"
  | "LAST_SUPER_ADMIN"
  | "SAME_VALUE"
  | "BAD_ROLE";

export class AdminManageError extends Error {
  constructor(
    readonly code: AdminManageCode,
    message: string,
  ) {
    super(message);
    this.name = "AdminManageError";
  }
}

/* ══════════════════════════════════════════════
   道具
   ══════════════════════════════════════════════ */

const str = (v: unknown) => String(v ?? "");

function checkReason(reason: string): string {
  const r = reason.trim();
  if (r.length < MIN_REASON) {
    throw new AdminManageError(
      "NO_REASON",
      `理由を、${MIN_REASON}文字以上でご記入ください。あとから記録を読む人が、いちばん知りたいのは理由です。`,
    );
  }
  return r;
}

/**
 * 役割の強さ。数字が大きいほど強い。
 *
 * ★「下げる」を判定するためだけに使います。
 *   これは権限の判定ではありません。権限は lib/permissions.ts の can() です。
 *   ここで権限を判定しはじめると、判定が2か所になります。
 */
const TSUYOSA: Record<Role, number> = {
  VIEWER: 1,
  SUPPORT: 2,
  OPERATOR: 3,
  FINANCE: 4,
  SECURITY: 5,
  SUPER_ADMIN: 6,
};

/* ══════════════════════════════════════════════
   権限の変更
   ══════════════════════════════════════════════ */

export async function changeRole(args: {
  tenantId: string;
  targetAdminId: string;
  newRole: string;
  reason: string;
  by: { adminId: string; name: string; role: string };
  requestId?: string;
}): Promise<{ targetName: string; before: Role; after: Role }> {
  const reason = checkReason(args.reason);

  const after = parseRole(args.newRole);
  if (after === null) {
    throw new AdminManageError(
      "BAD_ROLE",
      "その権限は選べません。一覧から選び直してください。",
    );
  }

  const at = new Date().toISOString();

  return withWriteTx(async (tx) => {
    /* ★必ず tenant_id で絞ること。
         ここを緩めると、他社の担当者の権限を変えられます。 */
    const t = await tx.execute({
      sql: `SELECT id, name, email, role, status
              FROM app_users WHERE tenant_id = ? AND id = ? LIMIT 1`,
      args: [args.tenantId, args.targetAdminId],
    });
    const target = t.rows[0] as Row | undefined;

    /* ★「他社の担当者です」と教えないこと。
         有る無しを答えるだけで、他社の中身が推測できます。 */
    if (!target) {
      throw new AdminManageError(
        "NO_SUCH_USER",
        "その担当者は見つかりませんでした。",
      );
    }

    const before = parseRole(str(target.role));
    if (before === null) {
      /* 読めない役割が入っている＝データが壊れています。
         ★勝手に直さないこと。直すと、壊れた原因が消えます。 */
      throw new AdminManageError(
        "BAD_ROLE",
        "いまの権限が読み取れませんでした。安全のため、変更を中止しました。",
      );
    }

    if (before === after) {
      throw new AdminManageError(
        "SAME_VALUE",
        `すでに「${ROLE_LABEL[after]}」です。変更の必要はありません。`,
      );
    }

    /* ── ② 自分自身の権限は下げられない ─────────────
         ★上げるのは通します（他の管理者から見れば、
           自分で自分を強くできてしまうように見えますが、
           そもそも settings.edit を持っている時点で
           他人を SUPER_ADMIN にできます。止めても意味がありません）。
           防ぎたいのは「自分を弱くして、戻せなくなる」ほうです。 */
    if (
      args.targetAdminId === args.by.adminId &&
      TSUYOSA[after] < TSUYOSA[before]
    ) {
      throw new AdminManageError(
        "SELF_DEMOTE",
        "ご自身の権限を下げることはできません。下げてしまうと、戻す操作もできなくなります。ほかの管理者に変更してもらってください。",
      );
    }

    /* ── ④ 最後のSUPER ADMINを降格させない ───────── */
    if (before === "SUPER_ADMIN" && after !== "SUPER_ADMIN") {
      await ensureNotLastSuperAdmin(tx, args.tenantId, args.targetAdminId);
    }

    await tx.execute({
      sql: `UPDATE app_users SET role = ? WHERE tenant_id = ? AND id = ?`,
      args: [after, args.tenantId, args.targetAdminId],
    });

    /**
     * ★セッションは消さないこと。
     *
     *   権限の判定は、リクエストのたびに app_users を読み直しています
     *   （lib/server/context.ts の guard）。
     *   だから、権限を下げた瞬間から、次の1回で効きます。
     *
     *   ここでセッションまで消すと、その人は作業中の画面から
     *   突然ログアウトします。権限が変わっただけなのに、
     *   「システムが落ちた」と受け取られます。
     *
     *   ★停止（suspend）とは、扱いを分けること。
     *     止めた人は、その場で出ていってもらう必要があります。
     */

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      action: "ROLE_CHANGE",
      target: `admin:${args.targetAdminId}`,
      summary: `${str(target.name)} の権限を ${ROLE_LABEL[before]} → ${ROLE_LABEL[after]} に変更`,
      before: ROLE_LABEL[before],
      after: ROLE_LABEL[after],
      reason,
      data: {
        targetAdminId: args.targetAdminId,
        targetName: str(target.name),
        targetEmail: str(target.email),
        beforeRole: before,
        afterRole: after,
        /* 強くしたのか、弱くしたのか。あとから読む人が、いちばん見る所 */
        direction: TSUYOSA[after] > TSUYOSA[before] ? "UP" : "DOWN",
      },
      requestId: args.requestId,
    });

    return { targetName: str(target.name), before, after };
  });
}

/* ══════════════════════════════════════════════
   利用停止・停止解除
   ══════════════════════════════════════════════ */

export async function setSuspended(args: {
  tenantId: string;
  targetAdminId: string;
  /** true = 止める、false = 元に戻す */
  suspend: boolean;
  reason: string;
  by: { adminId: string; name: string; role: string };
  requestId?: string;
}): Promise<{ targetName: string; status: "ACTIVE" | "SUSPENDED" }> {
  const reason = checkReason(args.reason);
  const at = new Date().toISOString();

  const result = await withWriteTx(async (tx) => {
    const t = await tx.execute({
      sql: `SELECT id, name, email, role, status
              FROM app_users WHERE tenant_id = ? AND id = ? LIMIT 1`,
      args: [args.tenantId, args.targetAdminId],
    });
    const target = t.rows[0] as Row | undefined;
    if (!target) {
      throw new AdminManageError(
        "NO_SUCH_USER",
        "その担当者は見つかりませんでした。",
      );
    }

    const nowStatus = str(target.status) === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    const next = args.suspend ? "SUSPENDED" : "ACTIVE";

    if (nowStatus === next) {
      throw new AdminManageError(
        "SAME_VALUE",
        args.suspend
          ? "すでに停止しています。"
          : "すでに使える状態です。",
      );
    }

    /* ── ③ 自分自身は停止できない ─────────────────
         ★押し間違いで自分を締め出す道を、わざわざ残さないこと。 */
    if (args.suspend && args.targetAdminId === args.by.adminId) {
      throw new AdminManageError(
        "SELF_SUSPEND",
        "ご自身を停止することはできません。停止すると、その場でログアウトされ、解除する操作もできなくなります。",
      );
    }

    /* ── ④ 最後のSUPER ADMINは止められない ───────── */
    if (args.suspend && str(target.role) === "SUPER_ADMIN") {
      await ensureNotLastSuperAdmin(tx, args.tenantId, args.targetAdminId);
    }

    await tx.execute({
      sql: `UPDATE app_users SET status = ? WHERE tenant_id = ? AND id = ?`,
      args: [next, args.tenantId, args.targetAdminId],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      /* ★停止も解除も、同じ種類で残すこと。
           解除だけ別の種類にすると、
           「止めたが解除されていない人」を数えるのが難しくなります。 */
      action: "USER_SUSPEND",
      target: `admin:${args.targetAdminId}`,
      summary: args.suspend
        ? `${str(target.name)} の利用を停止`
        : `${str(target.name)} の停止を解除`,
      before: nowStatus === "SUSPENDED" ? "停止中" : "利用中",
      after: next === "SUSPENDED" ? "停止中" : "利用中",
      reason,
      data: {
        targetAdminId: args.targetAdminId,
        targetName: str(target.name),
        targetEmail: str(target.email),
        targetRole: str(target.role),
        suspended: args.suspend,
      },
      requestId: args.requestId,
    });

    return { targetName: str(target.name), status: next as "ACTIVE" | "SUSPENDED" };
  });

  /**
   * ★止めたら、開いている画面からも、その場で出てもらうこと。
   *
   *   guard は毎回 status を読み直すので、
   *   セッションを残したままでも、次の1回で断られます。
   *   それでも、ここで消します。理由は2つです。
   *
   *     ・「止めた」のに、その人の画面がしばらく開いたままなのは、
   *       運営の方から見て、止まったように見えません。
   *     ・読み取りだけの画面が、キャッシュで一瞬だけ生き残る
   *       余地を残さないため。
   *
   *   ★取引（トランザクション）の外で消していること。
   *     セッションの削除は、取引が確定してからで構いません。
   *     逆に、取引の中で消して取引が失敗すると、
   *     「止めていないのにログアウトだけした」が起きます。
   */
  if (args.suspend) {
    await destroyAllSessionsOf(args.tenantId, args.targetAdminId);
  }

  return result;
}

/* ══════════════════════════════════════════════
   最後のSUPER ADMIN を守る
   ══════════════════════════════════════════════ */

/**
 * その人以外に、使えるSUPER ADMINが残るかどうかを確かめる。
 *
 * ★「停止中のSUPER ADMIN」を数に入れないこと。
 *   止まっている人は、入れません。
 *   数えてしまうと、「1人残っている」と判断したまま
 *   誰も入れない会社ができあがります。
 */
async function ensureNotLastSuperAdmin(
  tx: Transaction,
  tenantId: string,
  excludeId: string,
): Promise<void> {
  const r = await tx.execute({
    sql: `SELECT COUNT(*) AS n FROM app_users
           WHERE tenant_id = ? AND id <> ?
             AND role = 'SUPER_ADMIN' AND status = 'ACTIVE'`,
    args: [tenantId, excludeId],
  });
  const n = Number((r.rows[0] as Row)?.n ?? 0);

  if (n <= 0) {
    throw new AdminManageError(
      "LAST_SUPER_ADMIN",
      "この方は、最後の管理者（SUPER ADMIN）です。変更・停止すると、誰も権限を戻せなくなります。先に、別の方を管理者にしてください。",
    );
  }
}
