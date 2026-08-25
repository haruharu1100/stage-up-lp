/**
 * ログインの本体。お客様も、運営の管理者も、ここを通します。
 *
 * ═══════════════════════════════════════════════════════
 * ★決まり
 * ═══════════════════════════════════════════════════════
 *
 *   1) 失敗の理由を、外へ細かく返さないこと。
 *
 *        「そのメールアドレスは登録されていません」  ← 返してはいけない
 *        「パスワードが違います」                    ← 返してはいけない
 *        「メールアドレスまたはパスワードが違います」← これだけ返す
 *
 *      細かく返すと、まずメールアドレスだけを片っ端から試して
 *      「実在する一覧」を作れます。そのあとで合言葉を狙われます。
 *      中では理由を分けて記録しますが、外へは1種類だけ返します。
 *
 *   2) かかる時間も、なるべく同じにすること。
 *      いない人のときだけ即座に返すと、速さで実在が分かります。
 *      （verifyPassword が、いない人のときも同じ計算をします）
 *
 *   3) 続けて失敗したら、しばらく止めること。
 *      止めないと、時間さえかければ必ず破られます。
 *      止めた記録も監査ログへ残します。攻撃された証拠になります。
 *
 *   4) ログインに成功したら、必ずセッションを入れ替えること。
 *      入れ替えないと「セッション固定」を防げません。
 *      （createSession の replaces に、前の合言葉を渡します）
 *
 *   5) 管理者は、二段階認証を通すまで、何もできないこと。
 *      パスワードだけ通った状態を「入れた」と数えません。
 *      セッションは作りますが、step_up_at が空のままにして、
 *      お金が動く操作はすべて断ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★どの会社のログインかを、必ず先に決めること
 * ═══════════════════════════════════════════════════════
 *
 *   同じメールアドレスの人が、別々の会社にいて構いません。
 *   会社を決めずに探すと、他社の人としてログインできてしまいます。
 *   だから、必ず会社を決めてから探します。
 */

import { db, migrate, withWriteTx } from "./db";
import { appendAuditTx } from "./audit";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { verifyMfa } from "./mfa";
import { id } from "./ids";
import {
  createSession,
  destroySession,
  markStepUp,
  type IssuedSession,
  type SubjectKind,
} from "./session";

/* ══════════════════════════════════════════════
   締め出しの決まり
   ══════════════════════════════════════════════ */

/** 何回続けて失敗したら止めるか */
const LOCK_AFTER = 5;

/** 何分止めるか */
const LOCK_MINUTES = 15;

/** 数える時間の幅（分）。この幅の中での失敗だけを数える */
const WINDOW_MINUTES = 15;

/**
 * 外へ返す失敗の理由。
 *
 * ★INVALID は「いない」と「合言葉が違う」の両方を指します。
 *   分けて返さないための、わざとひとまとめの値です。
 */
export type LoginFailure =
  | "INVALID"
  | "LOCKED"
  | "SUSPENDED"
  | "MFA_REQUIRED"
  | "MFA_INVALID"
  | "NO_TENANT"
  /*
   * ★この2つだけは、はっきり理由を返します。
   *
   *   ここまで来た人は、仮パスワードそのものを正しく入れています。
   *   つまり、この人に「その仮パスワードは実在する」と伝えても、
   *   新しく漏れる情報はありません（もう持っています）。
   *
   *   逆に、ここで「メールアドレスまたはパスワードが違います」と
   *   返してしまうと、正しく入力した本人が、
   *   打ち間違いを疑って何度も試し、5回で締め出されます。
   *   そのあと問い合わせが来ますが、記録には
   *   「パスワード違い」としか残っていません。誰も原因に辿り着けません。
   */
  | "TEMP_PASSWORD_EXPIRED"
  | "TEMP_PASSWORD_USED";

export type LoginResult =
  | {
      ok: true;
      session: IssuedSession;
      subjectId: string;
      /** 管理者で、まだ6桁を通していないときは true */
      needsMfa: boolean;
      mustChangePassword: boolean;
      displayName: string;
      role: string;
    }
  | { ok: false; why: LoginFailure; message: string; retryAfterMinutes?: number };

/** 外へ出す文言。理由ごとに1種類だけ */
const MESSAGES: Record<LoginFailure, string> = {
  INVALID: "メールアドレスまたはパスワードが違います。",
  LOCKED:
    "続けて失敗したため、しばらくログインできません。時間をおいてからお試しください。",
  SUSPENDED: "このアカウントは現在ご利用いただけません。",
  MFA_REQUIRED: "認証アプリの6桁の数字を入力してください。",
  MFA_INVALID: "6桁の数字が正しくありません。",
  NO_TENANT: "ログイン先が見つかりません。",
  TEMP_PASSWORD_EXPIRED:
    "仮パスワードの期限が切れています。社内の管理者（全権）の方に、再発行をご依頼ください。",
  TEMP_PASSWORD_USED:
    "仮パスワードは一度しか使えません。社内の管理者（全権）の方に、再発行をご依頼ください。",
};

/* ══════════════════════════════════════════════
   会社を決める
   ══════════════════════════════════════════════ */

/** 会社コードから会社を探す。無ければ null */
export async function tenantByCode(code: string | undefined | null) {
  if (!code) return null;
  await migrate();
  const res = await db().execute({
    sql: `SELECT id, code, name, status FROM tenants WHERE code = ? LIMIT 1`,
    args: [code],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    status: String(row.status),
  };
}

/* ══════════════════════════════════════════════
   失敗の記録と、締め出しの判定
   ══════════════════════════════════════════════ */

/**
 * 試した記録を1件残す。
 *
 * ★成功も残すこと。
 *   失敗だけ残すと、「破られた瞬間」が記録から抜けます。
 *   5回失敗のあと6回目で成功、が見えてはじめて異常と分かります。
 */
async function recordAttempt(input: {
  tenantId: string;
  subjectKind: SubjectKind;
  identifier: string;
  ok: boolean;
  reason: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await db().execute({
    sql: `INSERT INTO login_attempts
            (id, tenant_id, subject_kind, identifier, ok, reason, ip, user_agent, created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      id("lga"),
      input.tenantId,
      input.subjectKind,
      input.identifier,
      input.ok ? 1 : 0,
      input.reason,
      input.ip ?? null,
      input.userAgent ?? null,
      new Date().toISOString(),
    ],
  });
}

/** 直近の失敗回数を数える（成功が1回でもあれば、そこで区切る） */
async function recentFailures(input: {
  tenantId: string;
  subjectKind: SubjectKind;
  identifier: string;
}): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const res = await db().execute({
    sql: `SELECT ok FROM login_attempts
           WHERE tenant_id = ? AND subject_kind = ? AND identifier = ?
             AND created_at >= ?
           ORDER BY created_at DESC
           LIMIT ?`,
    args: [input.tenantId, input.subjectKind, input.identifier, since, LOCK_AFTER],
  });

  let n = 0;
  for (const row of res.rows) {
    if (Number((row as Record<string, unknown>).ok) === 1) break;
    n += 1;
  }
  return n;
}

const tableOfKind = (kind: SubjectKind) =>
  kind === "ADMIN" ? "app_users" : "customers";

/** いま締め出し中か */
function lockedNow(lockedUntil: unknown): number {
  if (lockedUntil == null) return 0;
  const t = new Date(String(lockedUntil)).getTime();
  if (!Number.isFinite(t) || t <= Date.now()) return 0;
  return Math.ceil((t - Date.now()) / 60_000);
}

/* ══════════════════════════════════════════════
   ログイン本体
   ══════════════════════════════════════════════ */

export type LoginInput = {
  tenantId: string;
  email: string;
  password: string;
  /** 管理者で二段階認証を使っているとき、6桁の数字 */
  mfaCode?: string;
  ip?: string;
  userAgent?: string;
  /** ログイン前に持っていた合言葉。渡すと、その場で捨てます */
  previousToken?: string;
};

/** お客様のログイン */
export function loginCustomer(input: LoginInput): Promise<LoginResult> {
  return login("CUSTOMER", input);
}

/** 運営の管理者のログイン */
export function loginAdmin(input: LoginInput): Promise<LoginResult> {
  return login("ADMIN", input);
}

async function login(
  kind: SubjectKind,
  input: LoginInput,
): Promise<LoginResult> {
  if (!input.tenantId) {
    return { ok: false, why: "NO_TENANT", message: MESSAGES.NO_TENANT };
  }
  await migrate();

  const identifier = String(input.email ?? "").trim().toLowerCase();
  const table = tableOfKind(kind);

  /* ★会社を必ず条件に入れること。
       抜くと、同じメールアドレスの他社の人として入れてしまいます。 */
  const res = await db().execute({
    sql: `SELECT * FROM ${table} WHERE tenant_id = ? AND lower(email) = ? LIMIT 1`,
    args: [input.tenantId, identifier],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;

  /* 締め出し中なら、合言葉を見るまでもなく断る */
  const waitMinutes = lockedNow(row?.locked_until);
  if (waitMinutes > 0) {
    await recordAttempt({
      tenantId: input.tenantId,
      subjectKind: kind,
      identifier,
      ok: false,
      reason: "LOCKED",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return {
      ok: false,
      why: "LOCKED",
      message: MESSAGES.LOCKED,
      retryAfterMinutes: waitMinutes,
    };
  }

  /* ★いない人のときも、必ず同じ計算をすること。
       verifyPassword が中で空打ちします。速さで実在が分かるのを防ぎます。 */
  const passwordOk = await verifyPassword(
    input.password ?? "",
    row ? (row.password_hash as string | null) : null,
  );

  if (!row || !passwordOk) {
    await onFailure({
      tenantId: input.tenantId,
      kind,
      identifier,
      row,
      reason: row ? "BAD_PASSWORD" : "NO_SUCH_ACCOUNT",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    /* ★外へは、どちらも同じ文言 */
    return { ok: false, why: "INVALID", message: MESSAGES.INVALID };
  }

  if (String(row.status) !== "ACTIVE") {
    await recordAttempt({
      tenantId: input.tenantId,
      subjectKind: kind,
      identifier,
      ok: false,
      reason: "SUSPENDED",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: false, why: "SUSPENDED", message: MESSAGES.SUSPENDED };
  }

  const subjectId = String(row.id);
  const displayName = String(row.name ?? "");
  const role = kind === "ADMIN" ? String(row.role ?? "ADMIN") : "CUSTOMER";
  const mustChange = Number(row.must_change_password ?? 0) === 1;

  /*
   * ── 仮パスワードの寿命 ──────────────────────
   *
   * ★仮パスワードは、必ず人の手を通って渡ります。
   *   チャットに貼られ、口で読み上げられ、付箋に書かれます。
   *   渡した先から漏れていく前提のものです。
   *
   *   ですから、強さではなく短さで守ります。
   *
   *       ① 期限を過ぎたら使えない
   *       ② 一度使われたら、それきり使えない
   *
   *   ②を外さないこと。外すと、半年前のチャット履歴を
   *   さかのぼって拾った仮パスワードが、まだ通ります。
   *
   * ★この確認を、パスワードが合っていた後に置くこと。
   *   前に置くと、仮パスワードを知らない人にまで
   *   「この人はまだ初期状態だ」と教えることになります。
   */
  if (kind === "ADMIN" && mustChange) {
    const { expired } = await import("./passwordChange");

    if (expired(row.temp_password_expires_at)) {
      await recordAttempt({
        tenantId: input.tenantId,
        subjectKind: kind,
        identifier,
        ok: false,
        reason: "TEMP_PASSWORD_EXPIRED",
        ip: input.ip,
        userAgent: input.userAgent,
      });
      return {
        ok: false,
        why: "TEMP_PASSWORD_EXPIRED",
        message: MESSAGES.TEMP_PASSWORD_EXPIRED,
      };
    }

    if (row.temp_password_used_at != null) {
      await recordAttempt({
        tenantId: input.tenantId,
        subjectKind: kind,
        identifier,
        ok: false,
        reason: "TEMP_PASSWORD_USED",
        ip: input.ip,
        userAgent: input.userAgent,
      });
      return {
        ok: false,
        why: "TEMP_PASSWORD_USED",
        message: MESSAGES.TEMP_PASSWORD_USED,
      };
    }
  }

  /* ── 管理者の二段階認証 ── */
  let stepUpDone = kind === "CUSTOMER";
  let mfaCounter: number | null = null;

  if (kind === "ADMIN" && Number(row.mfa_enabled ?? 0) === 1) {
    if (!input.mfaCode) {
      /* ★ここで「合言葉は合っていた」と分かる情報を返しています。
           これは意図的です。6桁を求める画面を出す必要があるためで、
           この時点ではまだ何も操作できません（step_up_at が空）。 */
      return { ok: false, why: "MFA_REQUIRED", message: MESSAGES.MFA_REQUIRED };
    }
    const v = verifyMfa({
      secret: row.mfa_secret as string | null,
      code: input.mfaCode,
      lastCounter:
        row.mfa_last_counter == null ? null : Number(row.mfa_last_counter),
    });
    if (!v.ok) {
      await onFailure({
        tenantId: input.tenantId,
        kind,
        identifier,
        row,
        reason: `MFA_${v.why}`,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      return { ok: false, why: "MFA_INVALID", message: MESSAGES.MFA_INVALID };
    }
    stepUpDone = true;
    mfaCounter = v.counter;
  }

  /* ── ここから成功の処理 ── */

  /* ★合言葉の隠し方が古ければ、この機会に作り直すこと。
       このときだけ、生の合言葉が手元にあります。 */
  if (needsRehash(row.password_hash as string | null)) {
    const fresh = await hashPassword(input.password);
    await db().execute({
      sql: `UPDATE ${table} SET password_hash = ? WHERE id = ? AND tenant_id = ?`,
      args: [fresh, subjectId, input.tenantId],
    });
  }

  const now = new Date().toISOString();
  await db().execute({
    sql: `UPDATE ${table}
             SET last_login_at = ?, failed_logins = 0, locked_until = NULL
           WHERE id = ? AND tenant_id = ?`,
    args: [now, subjectId, input.tenantId],
  });

  if (mfaCounter != null) {
    await db().execute({
      sql: `UPDATE app_users SET mfa_last_counter = ? WHERE id = ? AND tenant_id = ?`,
      args: [mfaCounter, subjectId, input.tenantId],
    });
  }

  /*
   * ★仮パスワードを、ここで使い切ること。
   *
   *   「パスワードを変え終わってから使い切る」ほうが
   *   親切に見えますが、それでは1回きりになりません。
   *   変えずに閉じた人の仮パスワードが、そのまま生き続けます。
   *
   *   ここで使い切ると、変えずに閉じた人は入れなくなります。
   *   その人には再発行が必要です。それでよい、と決めています。
   *   面倒さと引き換えに、出回った仮パスワードの寿命を
   *   「1回」に固定できます。
   */
  if (kind === "ADMIN" && mustChange && row.temp_password_used_at == null) {
    await db().execute({
      sql: `UPDATE app_users SET temp_password_used_at = ?
             WHERE id = ? AND tenant_id = ? AND temp_password_used_at IS NULL`,
      args: [now, subjectId, input.tenantId],
    });
  }

  /* ★前のセッションを捨ててから、新しいものを作ること（セッション固定への備え） */
  const session = await createSession({
    tenantId: input.tenantId,
    subjectKind: kind,
    subjectId,
    userAgent: input.userAgent,
    replaces: input.previousToken,
  });

  if (stepUpDone && kind === "ADMIN" && Number(row.mfa_enabled ?? 0) === 1) {
    await markStepUp(session.token);
  }

  await recordAttempt({
    tenantId: input.tenantId,
    subjectKind: kind,
    identifier,
    ok: true,
    reason: "OK",
    ip: input.ip,
    userAgent: input.userAgent,
  });

  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId: input.tenantId,
      at: now,
      actorKind: kind,
      actorId: subjectId,
      actorName: displayName,
      actorRole: role,
      action: kind === "ADMIN" ? "LOGIN" : "CUSTOMER_LOGIN",
      target: subjectId,
      summary: `${displayName} がログインしました。`,
      data: {
        subjectKind: kind,
        sessionId: session.sessionId,
        mfa: mfaCounter != null,
        userAgent: input.userAgent ?? "",
      },
    });
    if (mfaCounter != null) {
      await appendAuditTx(tx, {
        tenantId: input.tenantId,
        at: now,
        actorKind: kind,
        actorId: subjectId,
        actorName: displayName,
        actorRole: role,
        action: "MFA_VERIFIED",
        target: subjectId,
        summary: `${displayName} が二段階認証を通しました。`,
        data: { sessionId: session.sessionId },
      });
    }
  });

  return {
    ok: true,
    session,
    subjectId,
    needsMfa: false,
    mustChangePassword: mustChange,
    displayName,
    role,
  };
}

/** 失敗したときの共通処理。数えて、必要なら止めて、記録する */
async function onFailure(input: {
  tenantId: string;
  kind: SubjectKind;
  identifier: string;
  row: Record<string, unknown> | undefined;
  reason: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await recordAttempt({
    tenantId: input.tenantId,
    subjectKind: input.kind,
    identifier: input.identifier,
    ok: false,
    reason: input.reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const fails = await recentFailures({
    tenantId: input.tenantId,
    subjectKind: input.kind,
    identifier: input.identifier,
  });

  /* ★いない人のぶんも数えること。
       行が無いと止められませんが、記録は残ります。
       行がある場合だけ、実際に締め出します。 */
  const lockRow = input.row;
  if (!lockRow || fails < LOCK_AFTER) return;

  const until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
  const table = tableOfKind(input.kind);
  await db().execute({
    sql: `UPDATE ${table} SET failed_logins = ?, locked_until = ?
           WHERE id = ? AND tenant_id = ?`,
    args: [fails, until, String(lockRow.id), input.tenantId],
  });

  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId: input.tenantId,
      at: new Date().toISOString(),
      actorKind: "SYSTEM",
      actorId: "system",
      actorName: "システム",
      actorRole: "SYSTEM",
      action: "ACCOUNT_LOCKED",
      target: String(lockRow.id),
      summary: `${input.identifier} を ${LOCK_MINUTES} 分ログインできないようにしました。`,
      reason: `${fails} 回続けて失敗しました。`,
      data: {
        subjectKind: input.kind,
        failures: fails,
        until,
        lastReason: input.reason,
      },
    });
  });
}

/* ══════════════════════════════════════════════
   ログアウト
   ══════════════════════════════════════════════ */

/**
 * ログアウト。
 *
 * ★誰が出ていったかも残すこと。
 *   入った記録だけだと、事故の時刻に誰が中にいたのかを言えません。
 */
export async function logout(input: {
  token: string | undefined;
  tenantId?: string;
  subjectKind?: SubjectKind;
  subjectId?: string;
  displayName?: string;
  role?: string;
}): Promise<void> {
  if (!input.token) return;

  if (input.tenantId && input.subjectId) {
    await withWriteTx(async (tx) => {
      await appendAuditTx(tx, {
        tenantId: input.tenantId as string,
        at: new Date().toISOString(),
        actorKind: input.subjectKind ?? "CUSTOMER",
        actorId: input.subjectId as string,
        actorName: input.displayName ?? "",
        actorRole: input.role ?? "",
        action:
          input.subjectKind === "ADMIN" ? "LOGOUT" : "CUSTOMER_LOGOUT",
        target: input.subjectId as string,
        summary: `${input.displayName ?? "利用者"} がログアウトしました。`,
      });
    });
  }

  await destroySession(input.token);
}

/* ══════════════════════════════════════════════
   アカウントを作る（Preview の仕込み用と、お客様の新規登録）
   ══════════════════════════════════════════════ */

/** 合言葉を設定する（作成時・変更時の共通） */
export async function setPassword(input: {
  tenantId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  password: string;
}): Promise<void> {
  await migrate();
  const table = tableOfKind(input.subjectKind);
  const hash = await hashPassword(input.password);
  await db().execute({
    sql: `UPDATE ${table}
             SET password_hash = ?, must_change_password = 0
           WHERE id = ? AND tenant_id = ?`,
    args: [hash, input.subjectId, input.tenantId],
  });
}

/* ══════════════════════════════════════════════
   二段階認証の入切
   ══════════════════════════════════════════════ */

/**
 * 二段階認証を始める。まだ有効にはしない。
 *
 * ★いきなり有効にしないこと。
 *   認証アプリへの登録に失敗した状態で有効にすると、
 *   本人が二度と入れなくなります。
 *   6桁を1回通せたら、そこで初めて有効にします。
 */
export async function beginMfaEnrollment(input: {
  tenantId: string;
  adminId: string;
}): Promise<{ secret: string }> {
  await migrate();
  const { newMfaSecret } = await import("./mfa");
  const secret = newMfaSecret();
  await db().execute({
    sql: `UPDATE app_users
             SET mfa_secret = ?, mfa_enabled = 0, mfa_last_counter = NULL
           WHERE id = ? AND tenant_id = ?`,
    args: [secret, input.adminId, input.tenantId],
  });
  return { secret };
}

/** 6桁が通ったら、そこで有効にする */
export async function confirmMfaEnrollment(input: {
  tenantId: string;
  adminId: string;
  code: string;
  actorName?: string;
  actorRole?: string;
}): Promise<{ ok: boolean }> {
  await migrate();
  const res = await db().execute({
    sql: `SELECT mfa_secret, mfa_last_counter, name, role
            FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [input.adminId, input.tenantId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false };

  const v = verifyMfa({
    secret: row.mfa_secret as string | null,
    code: input.code,
    lastCounter:
      row.mfa_last_counter == null ? null : Number(row.mfa_last_counter),
  });
  if (!v.ok) return { ok: false };

  const now = new Date().toISOString();
  await db().execute({
    sql: `UPDATE app_users
             SET mfa_enabled = 1, mfa_last_counter = ?, mfa_enrolled_at = ?
           WHERE id = ? AND tenant_id = ?`,
    args: [v.counter, now, input.adminId, input.tenantId],
  });

  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId: input.tenantId,
      at: now,
      actorKind: "ADMIN",
      actorId: input.adminId,
      actorName: input.actorName ?? String(row.name ?? ""),
      actorRole: input.actorRole ?? String(row.role ?? "ADMIN"),
      action: "MFA_ENABLED",
      target: input.adminId,
      summary: "二段階認証を有効にしました。",
    });
  });
  return { ok: true };
}

/**
 * すでに登録済みの人に、いまその場で6桁を入れ直してもらう。
 *
 * ═══════════════════════════════════════════════════════
 * ★登録（confirmMfaEnrollment）とは、目的が違います
 * ═══════════════════════════════════════════════════════
 *
 *   登録は「これから使う鍵を、本当に読み取れたか」の確認です。
 *   こちらは「いま画面の前にいるのは、本当にその人か」の確認です。
 *
 *   だから、こちらは mfa_enabled を1にしません。
 *   まだ登録していない人が、ここを通って
 *   登録そのものを飛ばせてしまうからです。
 *
 * ★同じ6桁を二度通さないこと（mfa_last_counter）。
 *   6桁は30秒ごとに変わります。
 *   肩越しに見た人が、すぐ後ろで同じ数字を打てるなら、
 *   それは「本人だけが知っているもの」ではありません。
 */
export async function verifyStepUpCode(input: {
  tenantId: string;
  adminId: string;
  code: string;
}): Promise<{ ok: boolean; why?: "NOT_ENROLLED" | "BAD_CODE" }> {
  await migrate();
  const res = await db().execute({
    sql: `SELECT mfa_secret, mfa_enabled, mfa_last_counter
            FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [input.adminId, input.tenantId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, why: "NOT_ENROLLED" };

  if (Number(row.mfa_enabled ?? 0) !== 1 || !row.mfa_secret) {
    return { ok: false, why: "NOT_ENROLLED" };
  }

  const v = verifyMfa({
    secret: row.mfa_secret as string | null,
    code: input.code,
    lastCounter:
      row.mfa_last_counter == null ? null : Number(row.mfa_last_counter),
  });
  if (!v.ok) return { ok: false, why: "BAD_CODE" };

  await db().execute({
    sql: `UPDATE app_users SET mfa_last_counter = ?
           WHERE id = ? AND tenant_id = ?`,
    args: [v.counter, input.adminId, input.tenantId],
  });
  return { ok: true };
}

/**
 * 二段階認証を解除する。
 *
 * ★解除は、必ず記録に残すこと。
 *   乗っ取りは「まず二段階認証を切る」ところから始まります。
 *   切った記録が無いと、後から誰も気づけません。
 */
export async function disableMfa(input: {
  tenantId: string;
  adminId: string;
  byId: string;
  byName: string;
  byRole: string;
  reason: string;
}): Promise<void> {
  await migrate();
  const now = new Date().toISOString();
  await db().execute({
    sql: `UPDATE app_users
             SET mfa_enabled = 0, mfa_secret = NULL, mfa_last_counter = NULL
           WHERE id = ? AND tenant_id = ?`,
    args: [input.adminId, input.tenantId],
  });
  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId: input.tenantId,
      at: now,
      actorKind: "ADMIN",
      actorId: input.byId,
      actorName: input.byName,
      actorRole: input.byRole,
      action: "MFA_DISABLED",
      target: input.adminId,
      summary: "二段階認証を解除しました。",
      reason: input.reason,
    });
  });
}

/* ══════════════════════════════════════════════
   お客様の、追加の本人確認（Step-up）
   ══════════════════════════════════════════════ */

/**
 * お客様に、その場でパスワードを入れ直してもらう。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、お客様は6桁ではなくパスワードなのか
 * ═══════════════════════════════════════════════════════
 *
 *   運営の担当者には、認証アプリを入れてもらえます。
 *   会社の道具だからです。
 *
 *   お客様には、それを求められません。
 *   求めた瞬間、買ってくださるはずだった方の多くが離れます。
 *   ★「安全にしたので、誰も使わなくなりました」は、安全ではありません。
 *
 *   では、パスワードの入れ直しに意味はあるのか。あります。
 *   守りたいのは、こういう場面です。
 *
 *       ・共用のパソコンで、ログインしたまま席を立った
 *       ・スマホを一時的に人に貸した
 *       ・合言葉（クッキー）だけを盗まれた
 *
 *   どれも「その画面は使えるが、パスワードは知らない」状態です。
 *   ここで入れ直しを求めると、そこで止まります。
 *
 *   ★パスワードごと盗まれた場合は、これでは止まりません。
 *     止まらないことを、はっきり書いておきます。
 *     そこは、本物のメールやSMSにつないだ日に足す仕事です。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここを、パスワードの当てっこ機にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   この入口は、すでにログインしている人しか叩けません。
 *   だからといって、何度でも試させてよい理由にはなりません。
 *
 *   合言葉だけを盗んだ人にとって、ここは
 *   「回数制限のないパスワード入力欄」になり得ます。
 *   ログイン画面には締め出しがあるのに、
 *   こちらに無ければ、こちらから破られます。
 *
 *   ですので、ログイン画面とまったく同じ数え方で締め出します。
 *   記録も同じ login_attempts に残します。
 *   ★別の数え方を作らないこと。片方だけ緩い日ができます。
 */
export async function verifyCustomerStepUp(input: {
  tenantId: string;
  customerId: string;
  password: string;
  ip?: string;
  userAgent?: string;
}): Promise<{
  ok: boolean;
  why?: "INVALID" | "LOCKED" | "SUSPENDED";
  retryAfterMinutes?: number;
}> {
  await migrate();

  const res = await db().execute({
    sql: `SELECT id, email, password_hash, status, locked_until
            FROM customers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [input.customerId, input.tenantId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  const identifier = String(row?.email ?? "").trim().toLowerCase();

  const waitMinutes = lockedNow(row?.locked_until);
  if (waitMinutes > 0) {
    await recordAttempt({
      tenantId: input.tenantId,
      subjectKind: "CUSTOMER",
      identifier,
      ok: false,
      reason: "STEP_UP_LOCKED",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: false, why: "LOCKED", retryAfterMinutes: waitMinutes };
  }

  /* ★いない人のときも、必ず同じ計算をすること。
       すぐ返すと、速さだけで実在が分かります。 */
  const passwordOk = await verifyPassword(
    input.password ?? "",
    row ? (row.password_hash as string | null) : null,
  );

  if (!row || !passwordOk) {
    await onFailure({
      tenantId: input.tenantId,
      kind: "CUSTOMER",
      identifier,
      row,
      reason: row ? "STEP_UP_BAD_PASSWORD" : "STEP_UP_NO_SUCH_ACCOUNT",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: false, why: "INVALID" };
  }

  /* ★止めた会員を、ここから通さないこと。
       ログインだけを止めて、いま開いている画面をそのままにすると、
       止めた意味がありません。 */
  if (String(row.status) !== "ACTIVE") {
    await recordAttempt({
      tenantId: input.tenantId,
      subjectKind: "CUSTOMER",
      identifier,
      ok: false,
      reason: "STEP_UP_SUSPENDED",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: false, why: "SUSPENDED" };
  }

  /* ★通ったことも記録すること。
       失敗だけを残すと、締め出しの数え方が狂います
       （recentFailures は、成功が1回出たところで区切ります）。 */
  await recordAttempt({
    tenantId: input.tenantId,
    subjectKind: "CUSTOMER",
    identifier,
    ok: true,
    reason: "STEP_UP_OK",
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ok: true };
}

export const LOGIN_LOCK_AFTER = LOCK_AFTER;
export const LOGIN_LOCK_MINUTES = LOCK_MINUTES;
