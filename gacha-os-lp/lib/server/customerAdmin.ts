/**
 * 会員管理の正本。一覧・詳細・利用停止・停止解除。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで「危険度」を作り直さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ダッシュボードの「高Riskの会員」は、
 *   fraud_flags のうち status = 'OPEN' かつ severity = 'HIGH' の
 *   会員を数えています（lib/server/adminSummary.ts）。
 *
 *   だから、この画面の「危険度」も、同じ fraud_flags だけから作ります。
 *   ここに独自の点数を足した瞬間、
 *   ダッシュボードが「2名」、会員管理が「5名」になります。
 *   数の合わない2つの画面は、どちらも信じてもらえなくなります。
 *
 *   ★ポイントの食い違いや、ログインの失敗は、
 *     「危険度」に混ぜず、別の印として出します。
 *     大事な情報ですが、名前を分けておけば、数はずれません。
 *
 * ═══════════════════════════════════════════════════════
 * ★一覧に、住所と本名を並べないこと
 * ═══════════════════════════════════════════════════════
 *
 *   毎日開く画面に個人情報が並んでいると、
 *   後ろを人が通っただけで漏れます。
 *
 *   一覧に出すのは、会員番号・表示名・状態・数だけにします。
 *   メールは伏せ字にします。
 *   住所は、この画面ではどこにも出しません。
 *   発送の宛先は shipments に「そのとき写した宛先」があり、
 *   発送管理の画面で読めます。会員管理から読む必要はありません。
 *
 * ═══════════════════════════════════════════════════════
 * ★止めるのに、画面のボタンを頼らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   守りは、必ずここ（サーバー側）に置きます。
 *   入口を直接たたかれても、同じ理由で断ります。
 *
 *       ① 他社の会員は、そもそも見つからない
 *       ② 理由が無い操作は通さない
 *       ③ すでにその状態なら、断る（同じ記録を2回作らない）
 *       ④ 止めたら、その場でログアウトさせる
 *       ⑤ すべて監査ログに残す
 *
 *   ④が要る理由。
 *   止めたのに、その人の画面がしばらく開いたままだと、
 *   運営の方から見て「止まっていない」ように見えます。
 *   実際には次の1回で断られますが、それでは遅いのです。
 */

import { can, type Role } from "@/lib/permissions";
import { appendAuditTx } from "./audit";
import { db, withWriteTx } from "./db";
import { destroyAllSessionsOf } from "./session";

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
/** 空欄は空欄のまま返す。0 や「不明」という文字に化けさせない */
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** 理由として短すぎる文字数。担当者管理・ガチャ管理と同じ基準にそろえる */
export const MIN_REASON = 4;

/* ══════════════════════════════════════════════
   返すもの
   ══════════════════════════════════════════════ */

/**
 * 危険度。
 *
 * ★NONE を LOW に丸めないこと。
 *   「調べた結果、低かった」と「まだ何も出ていない」は別の話です。
 *   丸めると、印の付いていない会員が全員「低リスク」に見えます。
 */
export type CustomerRiskLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export type CustomerStatus = "ACTIVE" | "SUSPENDED" | "OTHER";

export type CustomerRow = {
  id: string;
  /** 人が読める会員番号（GD-0001 など）。IDは長すぎて電話で読めません */
  displayId: string;
  name: string;
  /** ★伏せ字。一覧で完全なメールを配らない */
  emailMasked: string | null;
  status: CustomerStatus;
  /** DBに入っている生の状態。ACTIVE / SUSPENDED 以外が入っていたら、そのまま見せる */
  statusRaw: string;
  joinedAt: string | null;
  lastLoginAt: string | null;

  /** 保有ポイント */
  points: number;
  /**
   * 使った金額。
   * ★見せてよい人にだけ入ります。見せられない人には null。
   *   0 にしないこと。0 は「1円も使っていない」という意味です。
   */
  spent: number | null;

  plays: number;
  prizeCount: number;
  shipmentCount: number;
  openTicketCount: number;

  /** 危険度。fraud_flags（未対応のもの）だけから作る */
  risk: CustomerRiskLevel;
  riskOpenCount: number;

  /**
   * ポイントの残高と、台帳の合計が食い違っているか。
   * ★危険度には混ぜません。ダッシュボードの数がずれるからです。
   *   ただし、これは「記録に残っていないお金が動いた」という意味なので、
   *   一覧にも必ず出します。
   */
  ledgerMismatch: boolean;
  ledgerSum: number;
  ledgerRows: number;

  /** いま締め出されているか（ログイン失敗が続いた） */
  lockedUntil: string | null;
  failedLogins: number;
};

export type CustomerDetail = CustomerRow & {
  /**
   * 履歴を一度に読む上限。
   *
   * ★画面に同じ数字を書き写さないこと。
   *   書き写すと、上限を変えた日に画面の説明だけが古くなり、
   *   「最大50件」と書いてあるのに100件出る、が起きます。
   */
  limit: number;
  /** ★完全なメールは、開いた1人ぶんだけ返す */
  email: string | null;
  /** 住所そのものは返さない。持っているかどうかだけ */
  hasAddress: boolean;
  addressChangedAt: string | null;
  passwordChangedAt: string | null;
  mustChangePassword: boolean;

  /** ③ 抽選の履歴 */
  draws: {
    id: string;
    at: string | null;
    gachaId: string;
    gachaTitle: string | null;
    price: number;
    prizeRank: string;
    prizeName: string;
    prizeValue: number;
    pointAfter: number;
  }[];
  /** ④ 獲得した景品 */
  prizes: {
    id: string;
    grade: string;
    name: string;
    value: number;
    status: string;
    wonAt: string | null;
  }[];
  /** ⑤ 注文 */
  orders: {
    id: string;
    orderNumber: string;
    orderedAt: string | null;
    orderType: string;
    orderStatus: string;
    paymentStatus: string;
    /** ★金額。見せられない人には null */
    total: number | null;
  }[];
  /** ⑥ 発送 */
  shipments: {
    id: string;
    shipmentNumber: string;
    status: string;
    carrier: string | null;
    trackingNumber: string | null;
    requestedAt: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
  }[];
  /** ⑦ 問い合わせ */
  tickets: {
    id: string;
    subject: string;
    status: string;
    createdAt: string | null;
  }[];
  /** ② ポイントの動き */
  ledger: {
    id: string;
    kind: string;
    delta: number;
    memo: string;
    createdAt: string | null;
  }[];
  /** ⑧ 危険度の中身 */
  flags: {
    id: string;
    kind: string;
    severity: string;
    status: string;
    detail: string;
    createdAt: string | null;
    reviewedAt: string | null;
  }[];
  /** ⑨ ログインの記録（成功も失敗も） */
  logins: {
    id: string;
    ok: boolean;
    reason: string | null;
    ip: string | null;
    at: string | null;
  }[];
  /** ログインの記録を、そもそも引けたか。★引けないことを「0件」と書かない */
  loginsKnown: boolean;
};

/* ══════════════════════════════════════════════
   失敗の種類
   ══════════════════════════════════════════════ */

export type CustomerAdminCode =
  | "NOT_FOUND"
  | "NO_REASON"
  | "SAME_VALUE"
  | "BAD_REQUEST";

export class CustomerAdminError extends Error {
  constructor(
    readonly code: CustomerAdminCode,
    message: string,
  ) {
    super(message);
    this.name = "CustomerAdminError";
  }
}

function checkReason(reason: string): string {
  const r = String(reason ?? "").trim();
  if (r.length < MIN_REASON) {
    throw new CustomerAdminError(
      "NO_REASON",
      `理由を、${MIN_REASON}文字以上でご記入ください。あとから記録を読む人が、いちばん知りたいのは理由です。`,
    );
  }
  return r;
}

/* ══════════════════════════════════════════════
   道具
   ══════════════════════════════════════════════ */

/**
 * メールを伏せ字にする。
 *
 * ★先頭1文字だけ残すこと。全部隠すと、
 *   同姓同名の会員を取り違えたときに気づけません。
 */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const head = email.slice(0, 1);
  const domain = email.slice(at + 1);
  const dot = domain.indexOf(".");
  const dHead = dot > 0 ? domain.slice(0, 1) : domain.slice(0, 1);
  const dTail = dot > 0 ? domain.slice(dot) : "";
  return `${head}***@${dHead}***${dTail}`;
}

/** fraud_flags の severity を、危険度に写す。★知らない値を HIGH に上げないこと */
function levelOf(maxSeverity: number): CustomerRiskLevel {
  if (maxSeverity >= 3) return "HIGH";
  if (maxSeverity === 2) return "MEDIUM";
  if (maxSeverity === 1) return "LOW";
  return "NONE";
}

const SEVERITY_SQL = `CASE UPPER(f.severity)
                        WHEN 'HIGH' THEN 3
                        WHEN 'MEDIUM' THEN 2
                        WHEN 'MED' THEN 2
                        WHEN 'LOW' THEN 1
                        ELSE 0 END`;

function statusOf(raw: string): CustomerStatus {
  if (raw === "ACTIVE") return "ACTIVE";
  if (raw === "SUSPENDED") return "SUSPENDED";
  /* ★知らない状態を ACTIVE に丸めないこと。
       丸めると、壊れたデータが「普通の会員」に見えます */
  return "OTHER";
}

/* ══════════════════════════════════════════════
   一覧
   ══════════════════════════════════════════════ */

export type CustomerListFilter = {
  /** 会員番号・表示名・メールの一部。空なら絞らない */
  q?: string;
  /** ACTIVE / SUSPENDED。空なら絞らない */
  status?: string;
  /** NONE / LOW / MEDIUM / HIGH。空なら絞らない */
  risk?: string;
  /** ポイントが台帳と食い違っている人だけ */
  onlyMismatch?: boolean;
};

/**
 * 会員一覧。
 *
 * ★絞り込みはSQLで行うこと。
 *   全部読んでから画面で絞ると、件数が増えた日に、
 *   上限で切られた中だけを絞ることになり、静かに取りこぼします。
 */
export async function customerList(
  tenantId: string,
  role: Role | null,
  filter: CustomerListFilter = {},
): Promise<{
  rows: CustomerRow[];
  total: number;
  canSeeMoney: boolean;
  /** 絞り込みを外したときの、会社ぜんぶの内訳 */
  counts: {
    all: number;
    active: number;
    suspended: number;
    other: number;
    highRisk: number;
    mismatch: number;
  };
}> {
  /* ★null は「役割が読み取れなかった」です。そのときは金額を出しません */
  const canSeeMoney = role !== null && can(role, "revenue.view");

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

  const status = String(filter.status ?? "").trim().toUpperCase();
  if (status === "ACTIVE" || status === "SUSPENDED") {
    where.push("c.status = ?");
    args.push(status);
  } else if (status === "OTHER") {
    where.push("c.status NOT IN ('ACTIVE','SUSPENDED')");
  }

  const sql = `
    SELECT c.id, c.display_id, c.email, c.name, c.points, c.spent, c.status,
           c.created_at, c.last_login_at, c.failed_logins, c.locked_until,
           (SELECT COUNT(*) FROM draws d
             WHERE d.tenant_id = c.tenant_id AND d.user_id = c.id) AS plays,
           (SELECT COUNT(*) FROM prizes p
             WHERE p.tenant_id = c.tenant_id AND p.user_id = c.id) AS prize_count,
           (SELECT COUNT(*) FROM shipments s
             WHERE s.tenant_id = c.tenant_id AND s.user_id = c.id) AS shipment_count,
           (SELECT COUNT(*) FROM support_tickets t
             WHERE t.tenant_id = c.tenant_id AND t.user_id = c.id
               AND t.status <> 'RESOLVED') AS open_tickets,
           (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
             WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS ledger_sum,
           (SELECT COUNT(*) FROM point_ledger l
             WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS ledger_rows,
           (SELECT COUNT(*) FROM fraud_flags f
             WHERE f.tenant_id = c.tenant_id AND f.user_id = c.id
               AND f.status = 'OPEN') AS flags_open,
           (SELECT COALESCE(MAX(${SEVERITY_SQL}), 0) FROM fraud_flags f
             WHERE f.tenant_id = c.tenant_id AND f.user_id = c.id
               AND f.status = 'OPEN') AS flag_max
      FROM customers c
     WHERE ${where.join(" AND ")}
     ORDER BY c.created_at DESC, c.display_id ASC`;

  const r = await db().execute({ sql, args });

  let rows: CustomerRow[] = (r.rows as Row[]).map((row) => buildRow(row, canSeeMoney));

  /* ★危険度と食い違いは、SQLの CASE では書きづらいので、ここで絞ります。
       絞る前の行は「その会社の全件」なので、取りこぼしは起きません。
       （件数の上限を掛けていないことが前提です。掛ける日が来たら、
         この絞り込みも必ずSQL側へ移してください） */
  const risk = String(filter.risk ?? "").trim().toUpperCase();
  if (risk === "NONE" || risk === "LOW" || risk === "MEDIUM" || risk === "HIGH") {
    rows = rows.filter((x) => x.risk === risk);
  }
  if (filter.onlyMismatch) {
    rows = rows.filter((x) => x.ledgerMismatch);
  }

  /* 内訳は、絞り込みと関係なく会社ぜんぶで数えます。
     ★絞ったあとの数を「会員数」として出さないこと。
       検索するたびに会員数が減る画面になります */
  const counts = await countAll(tenantId);

  return { rows, total: rows.length, canSeeMoney, counts };
}

function buildRow(row: Row, canSeeMoney: boolean): CustomerRow {
  const points = num(row.points);
  const ledgerSum = num(row.ledger_sum);
  const ledgerRows = num(row.ledger_rows);
  const statusRaw = str(row.status);

  return {
    id: str(row.id),
    displayId: str(row.display_id),
    name: str(row.name),
    emailMasked: maskEmail(strOrNull(row.email)),
    status: statusOf(statusRaw),
    statusRaw,
    joinedAt: strOrNull(row.created_at),
    lastLoginAt: strOrNull(row.last_login_at),

    points,
    /* ★見せられないときは null。0 にしないこと */
    spent: canSeeMoney ? num(row.spent) : null,

    plays: num(row.plays),
    prizeCount: num(row.prize_count),
    shipmentCount: num(row.shipment_count),
    openTicketCount: num(row.open_tickets),

    risk: levelOf(num(row.flag_max)),
    riskOpenCount: num(row.flags_open),

    /* 台帳が1行も無い人の残高0は、食い違いではありません。
       0 と 0 は、行が無くても一致します */
    ledgerMismatch: ledgerSum !== points,
    ledgerSum,
    ledgerRows,

    lockedUntil: strOrNull(row.locked_until),
    failedLogins: num(row.failed_logins),
  };
}

async function countAll(tenantId: string) {
  const [base, high, mismatch] = await Promise.all([
    db().execute({
      sql: `SELECT COUNT(*) AS all_count,
                   SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
                   SUM(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END) AS suspended
              FROM customers WHERE tenant_id = ?`,
      args: [tenantId],
    }),
    /* ★ダッシュボードと同じ数え方にすること（lib/server/adminSummary.ts）。
         あちらは status='OPEN' かつ severity='HIGH' の会員を
         DISTINCT で数えています。ここを変えると、2つの画面がずれます */
    db().execute({
      sql: `SELECT COUNT(DISTINCT user_id) AS n
              FROM fraud_flags
             WHERE tenant_id = ? AND status = 'OPEN' AND severity = 'HIGH'`,
      args: [tenantId],
    }),
    db().execute({
      sql: `SELECT COUNT(*) AS n FROM customers c
             WHERE c.tenant_id = ?
               AND c.points <> (SELECT COALESCE(SUM(l.delta), 0)
                                  FROM point_ledger l
                                 WHERE l.tenant_id = c.tenant_id
                                   AND l.user_id = c.id)`,
      args: [tenantId],
    }),
  ]);

  const b = (base.rows[0] ?? {}) as Row;
  const all = num(b.all_count);
  const active = num(b.active);
  const suspended = num(b.suspended);

  return {
    all,
    active,
    suspended,
    /* ACTIVE でも SUSPENDED でもない行。★あるなら隠さず出す */
    other: all - active - suspended,
    highRisk: num((high.rows[0] ?? {}).n),
    mismatch: num((mismatch.rows[0] ?? {}).n),
  };
}

/* ══════════════════════════════════════════════
   詳細（1人ぶん・9項目）
   ══════════════════════════════════════════════ */

/** 詳細で一度に読む件数の上限。★上限があることを、画面にも伝えること */
export const DETAIL_LIMIT = 50;

export async function customerDetail(
  tenantId: string,
  customerId: string,
  role: Role | null,
): Promise<CustomerDetail | null> {
  const canSeeMoney = role !== null && can(role, "revenue.view");

  const base = await db().execute({
    sql: `
      SELECT c.id, c.display_id, c.email, c.name, c.points, c.spent, c.status,
             c.created_at, c.last_login_at, c.failed_logins, c.locked_until,
             c.address, c.address_changed_at, c.password_changed_at,
             c.must_change_password,
             (SELECT COUNT(*) FROM draws d
               WHERE d.tenant_id = c.tenant_id AND d.user_id = c.id) AS plays,
             (SELECT COUNT(*) FROM prizes p
               WHERE p.tenant_id = c.tenant_id AND p.user_id = c.id) AS prize_count,
             (SELECT COUNT(*) FROM shipments s
               WHERE s.tenant_id = c.tenant_id AND s.user_id = c.id) AS shipment_count,
             (SELECT COUNT(*) FROM support_tickets t
               WHERE t.tenant_id = c.tenant_id AND t.user_id = c.id
                 AND t.status <> 'RESOLVED') AS open_tickets,
             (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l
               WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS ledger_sum,
             (SELECT COUNT(*) FROM point_ledger l
               WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id) AS ledger_rows,
             (SELECT COUNT(*) FROM fraud_flags f
               WHERE f.tenant_id = c.tenant_id AND f.user_id = c.id
                 AND f.status = 'OPEN') AS flags_open,
             (SELECT COALESCE(MAX(${SEVERITY_SQL}), 0) FROM fraud_flags f
               WHERE f.tenant_id = c.tenant_id AND f.user_id = c.id
                 AND f.status = 'OPEN') AS flag_max
        FROM customers c
       WHERE c.tenant_id = ? AND c.id = ?`,
    args: [tenantId, customerId],
  });

  const row = base.rows[0] as Row | undefined;
  /* ★「他社の会員です」と教えないこと。
       有る無しを答えるだけで、他社の中身が推測できます */
  if (!row) return null;

  const email = strOrNull(row.email);

  const [draws, prizes, orders, shipments, tickets, ledger, flags] =
    await Promise.all([
      db().execute({
        sql: `SELECT d.id, d.created_at, d.gacha_id, d.price, d.prize_rank,
                     d.prize_name, d.prize_value, d.point_after,
                     g.title AS gacha_title
                FROM draws d
                LEFT JOIN gachas g
                       ON g.tenant_id = d.tenant_id AND g.id = d.gacha_id
               WHERE d.tenant_id = ? AND d.user_id = ?
               ORDER BY d.created_at DESC
               LIMIT ${DETAIL_LIMIT}`,
        args: [tenantId, customerId],
      }),
      db().execute({
        sql: `SELECT id, grade, name, value, status, won_at
                FROM prizes
               WHERE tenant_id = ? AND user_id = ?
               ORDER BY won_at DESC
               LIMIT ${DETAIL_LIMIT}`,
        args: [tenantId, customerId],
      }),
      db().execute({
        sql: `SELECT id, order_number, ordered_at, order_type,
                     order_status, payment_status, total
                FROM orders
               WHERE tenant_id = ? AND user_id = ?
               ORDER BY ordered_at DESC
               LIMIT ${DETAIL_LIMIT}`,
        args: [tenantId, customerId],
      }),
      db().execute({
        sql: `SELECT id, shipment_number, shipment_status, carrier,
                     tracking_number, requested_at, shipped_at, delivered_at
                FROM shipments
               WHERE tenant_id = ? AND user_id = ?
               ORDER BY requested_at DESC
               LIMIT ${DETAIL_LIMIT}`,
        args: [tenantId, customerId],
      }),
      db().execute({
        sql: `SELECT id, subject, status, created_at
                FROM support_tickets
               WHERE tenant_id = ? AND user_id = ?
               ORDER BY created_at DESC
               LIMIT ${DETAIL_LIMIT}`,
        args: [tenantId, customerId],
      }),
      db().execute({
        sql: `SELECT id, kind, delta, memo, created_at
                FROM point_ledger
               WHERE tenant_id = ? AND user_id = ?
               ORDER BY created_at DESC
               LIMIT ${DETAIL_LIMIT}`,
        args: [tenantId, customerId],
      }),
      db().execute({
        sql: `SELECT id, kind, severity, status, detail, created_at, reviewed_at
                FROM fraud_flags
               WHERE tenant_id = ? AND user_id = ?
               ORDER BY created_at DESC
               LIMIT ${DETAIL_LIMIT}`,
        args: [tenantId, customerId],
      }),
    ]);

  /**
   * ログインの記録は、メールで引きます（login_attempts.identifier）。
   *
   * ★メールが無い会員の記録を「0件」と書かないこと。
   *   引く手がかりが無いだけで、「1度もログインしていない」とは違います。
   */
  const logins = email
    ? await db().execute({
        sql: `SELECT id, ok, reason, ip, created_at
                FROM login_attempts
               WHERE tenant_id = ? AND subject_kind = 'CUSTOMER' AND identifier = ?
               ORDER BY created_at DESC
               LIMIT ${DETAIL_LIMIT}`,
        args: [tenantId, email],
      })
    : null;

  return {
    ...buildRow(row, canSeeMoney),
    limit: DETAIL_LIMIT,
    email,
    /* ★住所そのものは返さない。持っているかどうかだけ */
    hasAddress: strOrNull(row.address) !== null && str(row.address).trim() !== "",
    addressChangedAt: strOrNull(row.address_changed_at),
    passwordChangedAt: strOrNull(row.password_changed_at),
    mustChangePassword: num(row.must_change_password) === 1,

    draws: (draws.rows as Row[]).map((d) => ({
      id: str(d.id),
      at: strOrNull(d.created_at),
      gachaId: str(d.gacha_id),
      /* ガチャが消えていたら null。「不明」という文字で埋めない */
      gachaTitle: strOrNull(d.gacha_title),
      price: num(d.price),
      prizeRank: str(d.prize_rank),
      prizeName: str(d.prize_name),
      prizeValue: num(d.prize_value),
      pointAfter: num(d.point_after),
    })),
    prizes: (prizes.rows as Row[]).map((p) => ({
      id: str(p.id),
      grade: str(p.grade),
      name: str(p.name),
      value: num(p.value),
      status: str(p.status),
      wonAt: strOrNull(p.won_at),
    })),
    orders: (orders.rows as Row[]).map((o) => ({
      id: str(o.id),
      orderNumber: str(o.order_number),
      orderedAt: strOrNull(o.ordered_at),
      orderType: str(o.order_type),
      orderStatus: str(o.order_status),
      paymentStatus: str(o.payment_status),
      total: canSeeMoney ? num(o.total) : null,
    })),
    shipments: (shipments.rows as Row[]).map((s) => ({
      id: str(s.id),
      shipmentNumber: str(s.shipment_number),
      status: str(s.shipment_status),
      carrier: strOrNull(s.carrier),
      trackingNumber: strOrNull(s.tracking_number),
      requestedAt: strOrNull(s.requested_at),
      shippedAt: strOrNull(s.shipped_at),
      deliveredAt: strOrNull(s.delivered_at),
    })),
    tickets: (tickets.rows as Row[]).map((t) => ({
      id: str(t.id),
      subject: str(t.subject),
      status: str(t.status),
      createdAt: strOrNull(t.created_at),
    })),
    ledger: (ledger.rows as Row[]).map((l) => ({
      id: str(l.id),
      kind: str(l.kind),
      delta: num(l.delta),
      memo: str(l.memo),
      createdAt: strOrNull(l.created_at),
    })),
    flags: (flags.rows as Row[]).map((f) => ({
      id: str(f.id),
      kind: str(f.kind),
      severity: str(f.severity),
      status: str(f.status),
      detail: str(f.detail),
      createdAt: strOrNull(f.created_at),
      reviewedAt: strOrNull(f.reviewed_at),
    })),
    logins: logins
      ? (logins.rows as Row[]).map((a) => ({
          id: str(a.id),
          ok: num(a.ok) === 1,
          reason: strOrNull(a.reason),
          ip: strOrNull(a.ip),
          at: strOrNull(a.created_at),
        }))
      : [],
    loginsKnown: logins !== null,
  };
}

/* ══════════════════════════════════════════════
   利用停止・停止解除
   ══════════════════════════════════════════════ */

/**
 * 会員を止める・戻す。
 *
 * ★止めるのに、追加の条件を付けないこと。
 *   「不正の疑いが確定していないと止められない」のような作りにすると、
 *   本当に急いで止めたい日に止められません。
 *   代わりに、理由を必ず残します。誤って止めても、記録から戻せます。
 */
export async function setCustomerSuspended(args: {
  tenantId: string;
  customerId: string;
  /** true = 止める、false = 元に戻す */
  suspend: boolean;
  reason: string;
  by: { adminId: string; name: string; role: string };
  requestId?: string;
}): Promise<{
  customerId: string;
  displayId: string;
  name: string;
  before: string;
  after: "ACTIVE" | "SUSPENDED";
}> {
  const reason = checkReason(args.reason);
  const at = new Date().toISOString();

  const result = await withWriteTx(async (tx) => {
    /* ★必ず tenant_id で絞ること。
         ここを緩めると、他社の会員を止められます */
    const t = await tx.execute({
      sql: `SELECT id, display_id, name, status
              FROM customers WHERE tenant_id = ? AND id = ? LIMIT 1`,
      args: [args.tenantId, args.customerId],
    });
    const target = t.rows[0] as Row | undefined;
    if (!target) {
      throw new CustomerAdminError(
        "NOT_FOUND",
        "その会員は見つかりませんでした。",
      );
    }

    const before = str(target.status);
    const after: "ACTIVE" | "SUSPENDED" = args.suspend ? "SUSPENDED" : "ACTIVE";

    if (before === after) {
      /* ★黙って成功にしないこと。
           同じ記録が2行並ぶと、あとから読む人が
           「2回止めた」と読み違えます */
      throw new CustomerAdminError(
        "SAME_VALUE",
        args.suspend
          ? "この会員は、すでに停止しています。"
          : "この会員は、すでにご利用いただける状態です。",
      );
    }

    await tx.execute({
      sql: `UPDATE customers SET status = ? WHERE tenant_id = ? AND id = ?`,
      args: [after, args.tenantId, args.customerId],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      /* ★止めるのも解除するのも、同じ種類で残すこと。
           解除だけ別の種類にすると、
           「止めたが解除されていない会員」を数えるのが難しくなります */
      action: "CUSTOMER_SUSPEND",
      target: `customer:${args.customerId}`,
      summary: args.suspend
        ? `${str(target.display_id)} ${str(target.name)} の利用を停止`
        : `${str(target.display_id)} ${str(target.name)} の停止を解除`,
      before: before === "SUSPENDED" ? "停止中" : "利用中",
      after: after === "SUSPENDED" ? "停止中" : "利用中",
      reason,
      data: {
        customerId: args.customerId,
        displayId: str(target.display_id),
        name: str(target.name),
        suspended: args.suspend,
        beforeStatus: before,
        afterStatus: after,
      },
      requestId: args.requestId,
    });

    return {
      customerId: args.customerId,
      displayId: str(target.display_id),
      name: str(target.name),
      before,
      after,
    };
  });

  /**
   * ★止めたら、開いている画面からも、その場で出てもらうこと。
   *
   *   抽選・注文・発送依頼・マイページは、毎回 customers.status を
   *   読み直しているので、セッションを残したままでも次の1回で断られます。
   *   それでもここで消すのは、
   *   「止めたのに、その人の画面が開いたまま」を無くすためです。
   *
   *   ★取引（トランザクション）の外で消していること。
   *     取引の中で消して取引が失敗すると、
   *     「止めていないのにログアウトだけした」が起きます。
   */
  if (args.suspend) {
    await destroyAllSessionsOf(args.tenantId, args.customerId);
  }

  return result;
}
