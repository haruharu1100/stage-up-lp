/**
 * ポイント管理の正本。一覧・会員ごとの詳細・承認待ち・整合性の点検。
 *
 * ═══════════════════════════════════════════════════════
 * ★正本は customers.points ではなく、point_ledger です
 * ═══════════════════════════════════════════════════════
 *
 *   customers.points は「いまいくら持っているか」を速く読むための、
 *   写しです。正本ではありません。
 *
 *   正本は point_ledger（台帳）です。
 *   台帳は「なぜその金額になったのか」を1行ずつ持っています。
 *
 *       入金 ＋10,000
 *       ガチャ −500
 *       はずれの返還 ＋50
 *       景品をポイントへ交換 ＋170
 *       運営の調整 ＋1,000
 *
 *   この合計と、写し（customers.points）が一致していれば、
 *   その残高は「全部説明できるお金」です。
 *   一致していなければ、どこかに
 *   「記録に残っていないのに動いたお金」があります。
 *
 * ═══════════════════════════════════════════════════════
 * ★食い違いを 0pt として誤魔化さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   食い違いは、音を立てません。
 *   画面には残高がそのまま出るので、見た目は何ともありません。
 *   気づくのは、たいてい月末に集計が合わなくなったときです。
 *   そこから「いつからずれていたのか」を探す作業が始まります。
 *
 *   だから、ここでは必ず3つの状態に分けて返します。
 *
 *       OK       … 写しと台帳が1ptの違いもなく一致している
 *       MISMATCH … 食い違っている（赤で出す）
 *       UNKNOWN  … 見る権限が無くて、確かめられなかった（灰色で出す）
 *
 *   ★UNKNOWN を OK に丸めないこと。
 *     「確かめていない」を「正常」と書いた瞬間に、
 *     この画面は、見張り役をやめます。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで金額を 0 に落とさないこと
 * ═══════════════════════════════════════════════════════
 *
 *   見せてよくない相手には null を返します。0 ではありません。
 *   0 は「本当に0ポイント」という意味です。
 *   Number(null) は 0 になります。その1行で、
 *   「権限がありません」が「残高0pt」に化けます。
 */

import { can, type Role } from "@/lib/permissions";
import { db } from "./db";
import { FOUR_EYES_THRESHOLD } from "./points";
import { maskEmail } from "./customerAdmin";

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
const strOrNull = (v: unknown) =>
  v === null || v === undefined ? null : String(v);
const numOrNull = (v: unknown) =>
  v === null || v === undefined ? null : Number(v);

/** 今日の切り方。★adminSummary.ts と必ず同じにすること */
function kyou() {
  return new Date().toISOString().slice(0, 10);
}

/* ══════════════════════════════════════════════
   返すもの
   ══════════════════════════════════════════════ */

/**
 * 残高と台帳が合っているか。
 *
 * ★3つ目（UNKNOWN）を省かないこと。
 *   2つしかないと、確かめられなかったときに
 *   どちらかへ倒すことになります。どちらへ倒しても嘘になります。
 */
export type PointIntegrity = "OK" | "MISMATCH" | "UNKNOWN";

export type PointRow = {
  userId: string;
  /** 人が読める会員番号（GD-0001 など） */
  displayId: string;
  name: string;
  /** ★一覧では伏せ字。完全なメールを毎日の画面に並べない */
  emailMasked: string | null;
  /** 会員そのものの状態（ACTIVE / SUSPENDED …） */
  customerStatus: string;

  /** いまの残高（写し）。★見せられない人には null */
  points: number | null;
  /** 台帳の合計（正本）。★見せられない人には null */
  ledgerSum: number | null;
  /** 写し − 台帳。0 なら一致 */
  diff: number | null;
  integrity: PointIntegrity;

  /** 今日ぶんの増減と、その件数 */
  todayDelta: number | null;
  todayRows: number;

  /** 台帳の最終更新（＝最後にポイントが動いた時刻） */
  lastAt: string | null;
  /** 台帳の行数。0行なら、まだ一度も動いていない */
  ledgerRows: number;

  /** この会員あての調整申請の数 */
  adjustmentCount: number;
  /** そのうち、承認待ちの数 */
  pendingCount: number;
};

/** 台帳1行。Before・変動量・After をサーバー側で計算して渡す */
export type LedgerLine = {
  id: string;
  kind: string;
  /** 日本語の見出し。★画面ごとに訳し方を変えないため、ここで作る */
  kindLabel: string;
  delta: number;
  memo: string;
  createdAt: string | null;
  /** この行が起きる直前の残高（台帳を積み上げた値） */
  before: number;
  /** この行のあとの残高 */
  after: number;
  /** つながっている先。無ければ null */
  link: {
    kind: "DRAW" | "PRIZE" | "ADJUSTMENT" | "ORDER" | "SHIPMENT" | "OTHER";
    id: string;
    /** 人が読める説明。分からないときは null（作り話をしない） */
    label: string | null;
  } | null;
};

export type PointAdjustment = {
  id: string;
  userId: string;
  userName: string;
  userDisplayId: string;
  delta: number;
  reason: string;
  status: string;
  needsApproval: boolean;
  requestedBy: string;
  requestedByName: string | null;
  requestedAt: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decidedNote: string | null;
  /** 申請したときの残高。古い行には入っていないので null になり得る */
  balanceBefore: number | null;
  /** 反映を決めたときに読み直した残高 */
  balanceAtDecision: number | null;
  balanceAfter: number | null;
  /**
   * いまの残高。★承認待ちの申請では、これが balanceBefore と違うことがあります。
   *   違っていたら、承認する人に必ず見せます。
   */
  balanceNow: number | null;
  /** 申請したときと、いまで、残高が動いているか */
  balanceMoved: boolean;
  ledgerId: string | null;
};

export type PointDetail = {
  userId: string;
  displayId: string;
  name: string;
  /** ★完全なメールは、開いた1人ぶんだけ */
  email: string | null;
  customerStatus: string;

  points: number | null;
  ledgerSum: number | null;
  diff: number | null;
  integrity: PointIntegrity;

  /** 種類ごとの内訳。★4番「時系列表示」の見出しに使う */
  breakdown: { kind: string; kindLabel: string; total: number; rows: number }[];

  /** 台帳（新しい順）。Before / 変動量 / After つき */
  ledger: LedgerLine[];
  ledgerRows: number;
  /** 一度に読む上限。★画面に数字を書き写さないこと */
  limit: number;

  /** この会員あての調整申請 */
  adjustments: PointAdjustment[];
};

/* ══════════════════════════════════════════════
   台帳の種類を、日本語にする
   ══════════════════════════════════════════════ */

/**
 * ★知らない種類を「その他」に丸めないこと。
 *   丸めると、新しい種類の入金が増えても誰も気づきません。
 *   知らない種類は、その文字のまま出します。
 */
const KIND_LABEL: Record<string, string> = {
  OPENING: "開始時の残高",
  CHARGE: "入金",
  DRAW_SPEND: "ガチャ利用",
  DRAW_RETURN: "ガチャの返還",
  PRIZE_EXCHANGE: "景品をポイントへ交換",
  ADMIN_ADJUST: "運営による調整",
  CAMPAIGN: "キャンペーン付与",
  REFUND: "返金",
};

export function kindLabelOf(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** 台帳の ref が、どこを指しているか */
function linkOf(kind: string, ref: string | null): LedgerLine["link"] {
  if (!ref) return null;
  if (kind === "DRAW_SPEND" || kind === "DRAW_RETURN")
    return { kind: "DRAW", id: ref, label: null };
  if (kind === "PRIZE_EXCHANGE") return { kind: "PRIZE", id: ref, label: null };
  if (kind === "ADMIN_ADJUST")
    return { kind: "ADJUSTMENT", id: ref, label: null };
  return { kind: "OTHER", id: ref, label: null };
}

/* ══════════════════════════════════════════════
   一覧
   ══════════════════════════════════════════════ */

export type PointListFilter = {
  /** 会員番号・名前・メールの一部 */
  q?: string;
  /** 残高が1pt以上ある人だけ */
  onlyHasBalance?: boolean;
  /** 今日ポイントが動いた人だけ */
  onlyMovedToday?: boolean;
  /** 残高と台帳が食い違っている人だけ */
  onlyMismatch?: boolean;
  /** 調整申請がある人だけ */
  onlyAdjusted?: boolean;
  /** 承認待ちの申請がある人だけ */
  onlyPending?: boolean;
};

export type PointListResult = {
  rows: PointRow[];
  /** 絞り込んだ結果の件数 */
  total: number;
  /**
   * 残高を見てよい人か。
   * ★false のとき、画面は「0pt」ではなく「権限がありません」と出すこと。
   */
  canSeePoints: boolean;
  canRequest: boolean;
  canApprove: boolean;
  /** 二人承認の境目。★画面はこの値を使うこと（自分で書かない） */
  fourEyesThreshold: number;
  /** 絞り込みと関係ない、会社ぜんぶの内訳 */
  counts: {
    all: number;
    hasBalance: number;
    movedToday: number;
    mismatch: number;
    adjusted: number;
    pending: number;
    /** 会社ぜんぶの残高合計。★見せられない人には null */
    totalPoints: number | null;
    /** 会社ぜんぶの台帳合計。★見せられない人には null */
    totalLedger: number | null;
  };
};

/**
 * ポイント一覧。
 *
 * ★絞り込みはSQLで行うこと。
 *   全部読んでから画面で絞ると、件数が増えた日に、
 *   上限で切られた中だけを絞ることになり、静かに取りこぼします。
 */
export async function pointList(
  tenantId: string,
  role: Role | null,
  filter: PointListFilter = {},
): Promise<PointListResult> {
  /* ★null は「役割が読み取れなかった」です。そのときは金額を出しません */
  const canSeePoints = role !== null && can(role, "point.view");
  const canRequest = role !== null && can(role, "point.request");
  const canApprove = role !== null && can(role, "point.approve");
  const today = kyou();

  const where: string[] = ["c.tenant_id = ?"];
  const args: (string | number)[] = [tenantId];

  const q = String(filter.q ?? "").trim();
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    where.push(
      "(LOWER(c.display_id) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(COALESCE(c.email,'')) LIKE ?)",
    );
    args.push(like, like, like);
  }

  /*
    ★ここで作る派生列（ledger_sum など）を、WHERE では使えません（SQLiteの決まり）。
      なので、絞り込みは同じ式をもう一度書くのではなく、
      いったん全件を取ってから下で絞ります。

      ★これができるのは、この問い合わせに件数の上限を掛けていないからです。
        上限を掛ける日が来たら、絞り込みも必ずSQL側へ移してください。
        でないと「上限で切られた中だけを絞る」ことになり、静かに取りこぼします。
  */
  const sql = `
    SELECT c.id, c.display_id, c.email, c.name, c.points, c.status,
           (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
             WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS ledger_sum,
           (SELECT COUNT(*) FROM point_ledger l
             WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS ledger_rows,
           (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
             WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id
               AND substr(l.created_at, 1, 10) = ?) AS today_delta,
           (SELECT COUNT(*) FROM point_ledger l
             WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id
               AND substr(l.created_at, 1, 10) = ?) AS today_rows,
           (SELECT MAX(l.created_at) FROM point_ledger l
             WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS last_at,
           (SELECT COUNT(*) FROM point_adjustments a
             WHERE a.tenant_id = c.tenant_id AND a.user_id = c.id) AS adj_count,
           (SELECT COUNT(*) FROM point_adjustments a
             WHERE a.tenant_id = c.tenant_id AND a.user_id = c.id
               AND a.status = 'PENDING') AS pending_count
      FROM customers c
     WHERE ${where.join(" AND ")}
     ORDER BY c.display_id ASC`;

  const r = await db().execute({ sql, args: [today, today, ...args] });

  let rows: PointRow[] = (r.rows as Row[]).map((row) =>
    buildPointRow(row, canSeePoints),
  );

  if (filter.onlyHasBalance) {
    /* ★残高を見られない人には、この絞り込みを効かせないこと。
         効かせると、絞り込んだ件数から残高が推測できます */
    rows = canSeePoints ? rows.filter((x) => (x.points ?? 0) > 0) : [];
  }
  if (filter.onlyMovedToday) {
    rows = rows.filter((x) => x.todayRows > 0);
  }
  if (filter.onlyMismatch) {
    rows = canSeePoints ? rows.filter((x) => x.integrity === "MISMATCH") : [];
  }
  if (filter.onlyAdjusted) {
    rows = rows.filter((x) => x.adjustmentCount > 0);
  }
  if (filter.onlyPending) {
    rows = rows.filter((x) => x.pendingCount > 0);
  }

  const counts = await countPoints(tenantId, today, canSeePoints);

  return {
    rows,
    total: rows.length,
    canSeePoints,
    canRequest,
    canApprove,
    fourEyesThreshold: FOUR_EYES_THRESHOLD,
    counts,
  };
}

function buildPointRow(row: Row, canSeePoints: boolean): PointRow {
  const points = num(row.points);
  const ledgerSum = num(row.ledger_sum);

  return {
    userId: str(row.id),
    displayId: str(row.display_id),
    name: str(row.name),
    emailMasked: maskEmail(strOrNull(row.email)),
    customerStatus: str(row.status),

    /* ★見せられないときは null。0 にしないこと */
    points: canSeePoints ? points : null,
    ledgerSum: canSeePoints ? ledgerSum : null,
    diff: canSeePoints ? points - ledgerSum : null,
    /* ★確かめられなかったときは UNKNOWN。OK に丸めない */
    integrity: !canSeePoints
      ? "UNKNOWN"
      : points === ledgerSum
        ? "OK"
        : "MISMATCH",

    todayDelta: canSeePoints ? num(row.today_delta) : null,
    todayRows: num(row.today_rows),

    lastAt: strOrNull(row.last_at),
    ledgerRows: num(row.ledger_rows),

    adjustmentCount: num(row.adj_count),
    pendingCount: num(row.pending_count),
  };
}

async function countPoints(
  tenantId: string,
  today: string,
  canSeePoints: boolean,
) {
  const r = await db().execute({
    sql: `SELECT
            COUNT(*) AS all_count,
            SUM(CASE WHEN c.points > 0 THEN 1 ELSE 0 END) AS has_balance,
            COALESCE(SUM(c.points), 0) AS total_points,
            COALESCE(SUM((SELECT COALESCE(SUM(l.delta),0) FROM point_ledger l
                           WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id)), 0)
              AS total_ledger,
            SUM(CASE WHEN c.points <> (SELECT COALESCE(SUM(l.delta),0) FROM point_ledger l
                                        WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id)
                     THEN 1 ELSE 0 END) AS mismatch,
            SUM(CASE WHEN (SELECT COUNT(*) FROM point_ledger l
                            WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id
                              AND substr(l.created_at, 1, 10) = ?) > 0
                     THEN 1 ELSE 0 END) AS moved_today,
            SUM(CASE WHEN (SELECT COUNT(*) FROM point_adjustments a
                            WHERE a.tenant_id = c.tenant_id AND a.user_id = c.id) > 0
                     THEN 1 ELSE 0 END) AS adjusted,
            SUM(CASE WHEN (SELECT COUNT(*) FROM point_adjustments a
                            WHERE a.tenant_id = c.tenant_id AND a.user_id = c.id
                              AND a.status = 'PENDING') > 0
                     THEN 1 ELSE 0 END) AS pending
          FROM customers c
         WHERE c.tenant_id = ?`,
    args: [today, tenantId],
  });

  const b = (r.rows[0] ?? {}) as Row;
  return {
    all: num(b.all_count),
    hasBalance: num(b.has_balance),
    movedToday: num(b.moved_today),
    mismatch: num(b.mismatch),
    adjusted: num(b.adjusted),
    pending: num(b.pending),
    totalPoints: canSeePoints ? num(b.total_points) : null,
    totalLedger: canSeePoints ? num(b.total_ledger) : null,
  };
}

/* ══════════════════════════════════════════════
   会員1人ぶんの詳細
   ══════════════════════════════════════════════ */

/** 一度に読む台帳の行数。★画面に数字を書き写さないこと */
export const LEDGER_LIMIT = 100;

export async function pointDetail(
  tenantId: string,
  userId: string,
  role: Role | null,
): Promise<PointDetail | null> {
  const canSeePoints = role !== null && can(role, "point.view");

  const base = await db().execute({
    sql: `SELECT c.id, c.display_id, c.email, c.name, c.points, c.status,
                 (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
                   WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS ledger_sum,
                 (SELECT COUNT(*) FROM point_ledger l
                   WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS ledger_rows
            FROM customers c
           WHERE c.tenant_id = ? AND c.id = ?`,
    args: [tenantId, userId],
  });
  const row = base.rows[0] as Row | undefined;
  /* ★「他社の会員です」と教えないこと */
  if (!row) return null;

  const points = num(row.points);
  const ledgerSum = num(row.ledger_sum);
  const ledgerRows = num(row.ledger_rows);

  const [ledgerRes, breakdownRes, adjRes] = await Promise.all([
    db().execute({
      sql: `SELECT id, kind, delta, memo, ref, created_at
              FROM point_ledger
             WHERE tenant_id = ? AND user_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ${LEDGER_LIMIT}`,
      args: [tenantId, userId],
    }),
    db().execute({
      sql: `SELECT kind, COALESCE(SUM(delta),0) AS total, COUNT(*) AS rows_count
              FROM point_ledger
             WHERE tenant_id = ? AND user_id = ?
             GROUP BY kind
             ORDER BY kind ASC`,
      args: [tenantId, userId],
    }),
    db().execute({
      sql: `SELECT a.*, c.name AS user_name, c.display_id AS user_display_id,
                   req.name AS requested_by_name, dec.name AS decided_by_name
              FROM point_adjustments a
              JOIN customers c
                ON c.tenant_id = a.tenant_id AND c.id = a.user_id
              LEFT JOIN app_users req
                     ON req.tenant_id = a.tenant_id AND req.id = a.requested_by
              LEFT JOIN app_users dec
                     ON dec.tenant_id = a.tenant_id AND dec.id = a.decided_by
             WHERE a.tenant_id = ? AND a.user_id = ?
             ORDER BY a.requested_at DESC`,
      args: [tenantId, userId],
    }),
  ]);

  /*
    Before / After を、サーバー側で作ります。

    ★画面で足し算をさせないこと。
      画面は上限で切られた行しか持っていません。
      切られた行から積み上げると、途中から始まった数字になります。

    ★積み上げの起点を「いまの残高」にしないこと。
      いまの残高は写しです。食い違っているときに、
      台帳の Before / After まで一緒にずれます。
      台帳の合計（正本）から、新しい行の順に引き算していきます。
  */
  const lines: LedgerLine[] = [];
  let running = ledgerSum;
  for (const r of ledgerRes.rows as Row[]) {
    const delta = num(r.delta);
    const after = running;
    const before = after - delta;
    lines.push({
      id: str(r.id),
      kind: str(r.kind),
      kindLabel: kindLabelOf(str(r.kind)),
      delta,
      memo: str(r.memo),
      createdAt: strOrNull(r.created_at),
      before,
      after,
      link: linkOf(str(r.kind), strOrNull(r.ref)),
    });
    running = before;
  }

  return {
    userId: str(row.id),
    displayId: str(row.display_id),
    name: str(row.name),
    email: strOrNull(row.email),
    customerStatus: str(row.status),

    points: canSeePoints ? points : null,
    ledgerSum: canSeePoints ? ledgerSum : null,
    diff: canSeePoints ? points - ledgerSum : null,
    integrity: !canSeePoints
      ? "UNKNOWN"
      : points === ledgerSum
        ? "OK"
        : "MISMATCH",

    breakdown: canSeePoints
      ? (breakdownRes.rows as Row[]).map((b) => ({
          kind: str(b.kind),
          kindLabel: kindLabelOf(str(b.kind)),
          total: num(b.total),
          rows: num(b.rows_count),
        }))
      : [],

    ledger: canSeePoints ? lines : [],
    ledgerRows,
    limit: LEDGER_LIMIT,

    adjustments: canSeePoints
      ? (adjRes.rows as Row[]).map((a) => buildAdjustment(a, points))
      : [],
  };
}

function buildAdjustment(a: Row, balanceNow: number | null): PointAdjustment {
  const balanceBefore = numOrNull(a.balance_before);
  const moved =
    String(a.status ?? "") === "PENDING" &&
    balanceBefore !== null &&
    balanceNow !== null &&
    balanceBefore !== balanceNow;

  return {
    id: str(a.id),
    userId: str(a.user_id),
    userName: str(a.user_name),
    userDisplayId: str(a.user_display_id),
    delta: num(a.delta),
    reason: str(a.reason),
    status: str(a.status),
    needsApproval: num(a.needs_approval) === 1,
    requestedBy: str(a.requested_by),
    requestedByName: strOrNull(a.requested_by_name),
    requestedAt: strOrNull(a.requested_at),
    decidedBy: strOrNull(a.decided_by),
    decidedByName: strOrNull(a.decided_by_name),
    decidedAt: strOrNull(a.decided_at),
    decidedNote: strOrNull(a.decided_note),
    balanceBefore,
    balanceAtDecision: numOrNull(a.balance_at_decision),
    balanceAfter: numOrNull(a.balance_after),
    balanceNow,
    balanceMoved: moved,
    ledgerId: strOrNull(a.ledger_id),
  };
}

/* ══════════════════════════════════════════════
   承認待ち／処理済みの申請
   ══════════════════════════════════════════════ */

export type AdjustmentListFilter = {
  /** PENDING / APPLIED / APPROVED / REJECTED。空なら全部 */
  status?: string;
};

/**
 * 調整申請の一覧。
 *
 * ★「いまの残高」を必ず一緒に返すこと。
 *   承認する人が見るのは、申請書に書いてある古い残高ではなく、
 *   いまの残高です。並べて出さないと、気づけません。
 */
export async function adjustmentList(
  tenantId: string,
  role: Role | null,
  filter: AdjustmentListFilter = {},
): Promise<{ rows: PointAdjustment[]; pendingCount: number }> {
  const canSeePoints = role !== null && can(role, "point.view");
  if (!canSeePoints) return { rows: [], pendingCount: 0 };

  const where: string[] = ["a.tenant_id = ?"];
  const args: (string | number)[] = [tenantId];

  const status = String(filter.status ?? "").trim().toUpperCase();
  if (["PENDING", "APPLIED", "APPROVED", "REJECTED"].includes(status)) {
    where.push("a.status = ?");
    args.push(status);
  }

  const r = await db().execute({
    sql: `SELECT a.*, c.name AS user_name, c.display_id AS user_display_id,
                 c.points AS balance_now,
                 req.name AS requested_by_name, dec.name AS decided_by_name
            FROM point_adjustments a
            JOIN customers c
              ON c.tenant_id = a.tenant_id AND c.id = a.user_id
            LEFT JOIN app_users req
                   ON req.tenant_id = a.tenant_id AND req.id = a.requested_by
            LEFT JOIN app_users dec
                   ON dec.tenant_id = a.tenant_id AND dec.id = a.decided_by
           WHERE ${where.join(" AND ")}
           ORDER BY CASE WHEN a.status = 'PENDING' THEN 0 ELSE 1 END,
                    a.requested_at DESC`,
    args,
  });

  const rows = (r.rows as Row[]).map((a) =>
    buildAdjustment(a, num(a.balance_now)),
  );

  const p = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM point_adjustments
           WHERE tenant_id = ? AND status = 'PENDING'`,
    args: [tenantId],
  });

  return { rows, pendingCount: num((p.rows[0] ?? {}).n) };
}

/* ══════════════════════════════════════════════
   整合性の数だけを数える（ダッシュボード用）
   ══════════════════════════════════════════════ */

/**
 * 残高と台帳が食い違っている会員の数。
 *
 * ★この数え方を、ここ以外に書かないこと。
 *   ダッシュボードの「ポイント確認が必要 ○件」も、
 *   会員管理の「食い違い」も、この関数を通します。
 *   同じ数字を出す場所が2つあると、必ずずれます。
 */
export async function pointMismatchCount(tenantId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM customers c
           WHERE c.tenant_id = ?
             AND c.points <> (SELECT COALESCE(SUM(l.delta), 0)
                                FROM point_ledger l
                               WHERE l.tenant_id = c.tenant_id
                                 AND l.user_id = c.id)`,
    args: [tenantId],
  });
  return num((r.rows[0] ?? {}).n);
}

/** 承認待ちの調整申請の数 */
export async function pointPendingCount(tenantId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM point_adjustments
           WHERE tenant_id = ? AND status = 'PENDING'`,
    args: [tenantId],
  });
  return num((r.rows[0] ?? {}).n);
}
