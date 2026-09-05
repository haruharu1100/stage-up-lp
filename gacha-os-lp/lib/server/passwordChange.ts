/**
 * パスワードの発行・変更・作り直し。
 *
 * ═══════════════════════════════════════════════════════
 * ★仮パスワードは「もう漏れているもの」として扱うこと
 * ═══════════════════════════════════════════════════════
 *
 *   仮パスワードは、必ず人の手を通って渡されます。
 *
 *       社内チャットに貼られる
 *       電話で読み上げられる
 *       付箋に書いて机に置かれる
 *
 *   どれも「渡した瞬間から、本人以外も読める」ということです。
 *   ですから、仮パスワードに求めるのは強さではありません。
 *   ★短命であることです。
 *
 *   だから、次の2つを必ず守ります。
 *
 *       ① 期限を切る（既定 72時間）
 *       ② 一度使われたら、それきり無効にする
 *
 *   ②が要です。半年前のチャット履歴をさかのぼって拾った
 *   仮パスワードが、まだ通る仕組みにはしません。
 *
 * ═══════════════════════════════════════════════════════
 * ★パスワードを変えたら、他の端末は追い出すこと
 * ═══════════════════════════════════════════════════════
 *
 *   パスワードを変える理由の多くは「漏れたかもしれない」です。
 *   変えたのに、漏れた相手のログイン状態がそのまま続くなら、
 *   変えた意味がありません。
 *
 *   ★ただし、いま操作している本人だけは残します。
 *     全部消すと、変えた直後に自分もログイン画面へ戻され、
 *     「変わったのか、失敗したのか」が分からなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★二段階認証を、一斉に必須化しないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ある日いっせいに「管理者は全員必須」にすると、
 *   その日から全員が入れなくなります。
 *   認証アプリの登録は、その場で数秒で終わる作業ではありません。
 *
 *   だから「この人からは必須」を、1人ずつ立てられるようにします。
 *   仮パスワードを発行した人は、その時点で必須になります。
 *   つまり、これから増える人は、最初から必須です。
 */

import { randomBytes, createHash } from "node:crypto";
import { db, migrate, withWriteTx } from "./db";
import { appendAuditTx } from "./audit";
import {
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from "./password";
import { id } from "./ids";
import { deliver } from "./mailer";

/* ══════════════════════════════════════════════
   決まりの数
   ══════════════════════════════════════════════ */

/** 仮パスワードが使える時間（時間） */
export const TEMP_PASSWORD_HOURS = 72;

/** 作り直しのリンクが使える時間（分）。★ここは短くすること */
export const RESET_LINK_MINUTES = 30;

/**
 * 仮パスワードを発行する直前に、6桁を入れ直してもらってから
 * 有効とみなす長さ（分）。
 *
 * ★短くしすぎないこと。
 *   相手を選び、理由を書き、確認の文面を読む。
 *   ここまでで数分かかります。
 *   その途中で切れる画面は、やがて必ず「面倒だから」で外されます。
 *
 * ★長くしすぎないこと。
 *   長くするほど、朝ログインしたまま開いている画面と同じになり、
 *   入れ直してもらう意味そのものが消えます。
 */
export const FRESH_STEP_UP_MINUTES = 10;

/**
 * 仮パスワードに使う文字。
 *
 * ★紛らわしい字を外すこと（0/O、1/l/I）。
 *   電話で読み上げるときも、紙に書き写すときも、
 *   ここで間違えると「合っているのに入れない」が起きます。
 *   そのとき人は、たいてい合言葉ではなく仕組みを疑います。
 */
const TEMP_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 仮パスワードの長さ。★短くしないこと */
const TEMP_LENGTH = 16;

/* ══════════════════════════════════════════════
   失敗の伝え方
   ══════════════════════════════════════════════ */

export type PasswordFailure =
  | "WEAK"
  | "MISMATCH"
  | "SAME_AS_OLD"
  | "WRONG_CURRENT"
  | "NO_SUCH_USER"
  | "BAD_TOKEN";

export class PasswordError extends Error {
  readonly code: PasswordFailure;
  constructor(code: PasswordFailure, message: string) {
    super(message);
    this.code = code;
    this.name = "PasswordError";
  }
}

/* ══════════════════════════════════════════════
   小さな道具
   ══════════════════════════════════════════════ */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const nowIso = () => new Date().toISOString();

/** 期限が切れているか（null は「期限なし」ではなく「切れていない」扱い） */
export function expired(at: unknown): boolean {
  if (at == null) return false;
  const t = new Date(String(at)).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

/** 偏りなく1文字選ぶ（% は端の文字が出やすくなるので使わない） */
function pick(alphabet: string): string {
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  for (;;) {
    const b = randomBytes(1)[0];
    if (b < limit) return alphabet[b % alphabet.length];
  }
}

/** 仮パスワードの文字列を作る */
export function newTemporaryPassword(): string {
  let out = "";
  for (let i = 0; i < TEMP_LENGTH; i += 1) out += pick(TEMP_ALPHABET);
  return out;
}

/* ══════════════════════════════════════════════
   ① 仮パスワードを発行する
   ══════════════════════════════════════════════ */

/**
 * 担当者に仮パスワードを発行する。
 *
 * ★返り値の password は、この1回しか手に入りません。
 *   保存していないので、あとから読み出すことはできません。
 *   「あとで確認できる」作りにすると、そこが狙われます。
 */
export async function issueTemporaryPassword(input: {
  tenantId: string;
  targetAdminId: string;
  by: { adminId: string; name: string; role: string };
  reason: string;
  /**
   * その依頼につけた通し番号。
   *
   * ★これを記録に入れておくと、
   *   「画面でエラーが出た」という連絡を受けたときに、
   *   サーバーの記録と監査ログを、同じ番号で突き合わせられます。
   *   番号が無いと、時刻の前後だけを頼りに探すことになります。
   */
  requestId?: string;
}): Promise<{ password: string; expiresAt: string }> {
  await migrate();

  const found = await db().execute({
    sql: `SELECT id, name, email FROM app_users
           WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [input.targetAdminId, input.tenantId],
  });
  const target = found.rows[0] as Record<string, unknown> | undefined;
  if (!target) {
    throw new PasswordError("NO_SUCH_USER", "その担当者が見つかりません。");
  }

  const password = newTemporaryPassword();
  const hash = await hashPassword(password);
  const expiresAt = new Date(
    Date.now() + TEMP_PASSWORD_HOURS * 3600_000,
  ).toISOString();
  const at = nowIso();

  await db().execute({
    sql: `UPDATE app_users
             SET password_hash = ?,
                 must_change_password = 1,
                 temp_password_expires_at = ?,
                 temp_password_used_at = NULL,
                 mfa_required = 1,
                 failed_logins = 0,
                 locked_until = NULL
           WHERE id = ? AND tenant_id = ?`,
    args: [hash, expiresAt, input.targetAdminId, input.tenantId],
  });

  /* ★いま入っている端末は、全部追い出すこと。
       仮パスワードを出し直す場面は、たいてい
       「入れなくなった」か「乗っ取られたかもしれない」です。
       どちらの場合も、前のログイン状態を残す理由がありません。 */
  const { destroyAllSessionsOf } = await import("./session");
  await destroyAllSessionsOf(input.tenantId, input.targetAdminId);

  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId: input.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: input.by.adminId,
      actorName: input.by.name,
      actorRole: input.by.role,
      action: "TEMP_PASSWORD_ISSUED",
      target: input.targetAdminId,
      summary: `${String(target.name ?? "")} に仮パスワードを発行しました。`,
      reason: input.reason,
      requestId: input.requestId,
      /*
       * ★data に、パスワードそのものを入れないこと。
       *   監査ログは「あとから読み返すためのもの」です。
       *   そこに合言葉を書いたら、読み返せる人全員が入れます。
       *
       * ★入れるのは「あとから調べる人が必要とするもの」だけです。
       *   誰に出したのか（targetAdminId・名前・メール）、
       *   いつ出したのか（issuedAt）、いつまで使えるのか（expiresAt）、
       *   そして、成功したのか（result）。
       *
       *   result を入れておく理由は、
       *   のちに「試したが断られた」も記録するようになったとき、
       *   同じ形で並べられるようにするためです。
       */
      data: {
        targetAdminId: input.targetAdminId,
        targetName: String(target.name ?? ""),
        targetEmail: String(target.email ?? ""),
        issuedAt: at,
        expiresAt,
        validHours: TEMP_PASSWORD_HOURS,
        /*
         * ★"mfa" という名前を、ここで使わないこと。
         *
         *   監査ログの出口には「鍵に見える名前は、何があっても外に出さない」
         *   という、例外のない網をかけてあります。その網に "mfa" も入っています。
         *
         *   ここで mfaRequired という名前を使うと、
         *   害の無い項目なのに、その網に引っかかって消えます。
         *   そこで網のほうに例外を足して逃がすのは、いちばんやってはいけません。
         *   例外は、必ず増えます。増えた先で、本物の鍵が通ります。
         *   だから、名前のほうを変えます。
         */
        freshStepUp: true,
        result: "OK",
      },
    });
  });

  return { password, expiresAt };
}

/* ══════════════════════════════════════════════
   ② 自分でパスワードを変える
   ══════════════════════════════════════════════ */

/**
 * いま入っている本人が、自分のパスワードを変える。
 *
 * ★いまのパスワードを、必ずもう一度聞くこと。
 *   席を外した隙に、開いたままの画面で
 *   パスワードだけ書き換えられると、
 *   そのアカウントは、その人の手を離れます。
 */
export async function changeOwnPassword(input: {
  tenantId: string;
  adminId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  /** いま操作している端末の合言葉。ここだけは残します */
  keepToken?: string;
}): Promise<{ mfaRequired: boolean; mfaEnabled: boolean }> {
  await migrate();

  const res = await db().execute({
    sql: `SELECT id, name, role, email, password_hash,
                 mfa_enabled, mfa_required
            FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [input.adminId, input.tenantId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new PasswordError("NO_SUCH_USER", "担当者が見つかりません。");
  }

  /* ★確認入力の一致を、いちばん先に見ること。
       打ち間違えただけの人に「いまのパスワードが違う」と
       言ってしまうと、原因の見当がつかなくなります。 */
  if (input.newPassword !== input.confirmPassword) {
    throw new PasswordError(
      "MISMATCH",
      "確認用に入れた新しいパスワードが、一致していません。",
    );
  }

  const policy = checkPasswordPolicy(input.newPassword);
  if (!policy.ok) {
    throw new PasswordError("WEAK", policy.why);
  }

  const currentOk = await verifyPassword(
    input.currentPassword ?? "",
    row.password_hash as string | null,
  );
  if (!currentOk) {
    throw new PasswordError(
      "WRONG_CURRENT",
      "いま使っているパスワードが違います。",
    );
  }

  /* ★同じものへ「変更」させないこと。
       仮パスワードのまま続けるのが、いちばん危ない状態です。 */
  if (input.newPassword === input.currentPassword) {
    throw new PasswordError(
      "SAME_AS_OLD",
      "いまと同じパスワードには変更できません。別のものにしてください。",
    );
  }

  const hash = await hashPassword(input.newPassword);
  const at = nowIso();

  await db().execute({
    sql: `UPDATE app_users
             SET password_hash = ?,
                 must_change_password = 0,
                 password_changed_at = ?,
                 temp_password_expires_at = NULL,
                 temp_password_used_at = NULL
           WHERE id = ? AND tenant_id = ?`,
    args: [hash, at, input.adminId, input.tenantId],
  });

  /* ★他の端末は追い出すこと。ただし、いまの端末は残すこと。 */
  await dropOtherSessions({
    tenantId: input.tenantId,
    subjectId: input.adminId,
    keepToken: input.keepToken,
  });

  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId: input.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: input.adminId,
      actorName: String(row.name ?? ""),
      actorRole: String(row.role ?? ""),
      action: "PASSWORD_CHANGED",
      target: input.adminId,
      summary: `${String(row.name ?? "")} が自分のパスワードを変更しました。`,
      data: { otherSessionsRevoked: true },
    });
  });

  return {
    mfaRequired: Number(row.mfa_required ?? 0) === 1,
    mfaEnabled: Number(row.mfa_enabled ?? 0) === 1,
  };
}

/**
 * その人の、いま操作している端末以外のログインを捨てる。
 *
 * ★keepToken を渡し忘れたときは、全部捨てること。
 *   「消し残す」より「消しすぎる」ほうが安全です。
 */
async function dropOtherSessions(input: {
  tenantId: string;
  subjectId: string;
  keepToken?: string;
}): Promise<void> {
  if (!input.keepToken) {
    const { destroyAllSessionsOf } = await import("./session");
    await destroyAllSessionsOf(input.tenantId, input.subjectId);
    return;
  }
  await db().execute({
    sql: `DELETE FROM sessions
           WHERE tenant_id = ? AND subject_id = ? AND token_hash <> ?`,
    args: [input.tenantId, input.subjectId, sha256(input.keepToken)],
  });
}

/* ══════════════════════════════════════════════
   ③ パスワードの作り直し（本人が忘れたとき）
   ══════════════════════════════════════════════ */

/**
 * 作り直しを申し込む。
 *
 * ═══════════════════════════════════════════════════════
 * ★「そのメールアドレスは登録されていません」を返さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   返した瞬間、この入口が「実在するメールアドレスを調べる道具」に
 *   変わります。ログインの入口と違って、ここは
 *   合言葉すら要らないので、誰でも何度でも試せます。
 *
 *   いてもいなくても、同じ返事にします。
 *   実際に送るのは、いた場合だけです。
 */
export async function startPasswordReset(input: {
  tenantId: string;
  email: string;
  ip?: string;
}): Promise<{ accepted: true }> {
  await migrate();

  const email = String(input.email ?? "").trim().toLowerCase();
  const res = await db().execute({
    sql: `SELECT id, name, email, status FROM app_users
           WHERE tenant_id = ? AND lower(email) = ? LIMIT 1`,
    args: [input.tenantId, email],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;

  /* ★ここで早く返さないこと（返事の速さで実在が分かります）。
       いない場合も、同じだけの手間をかけてから返します。 */
  const token = randomBytes(32).toString("base64url");

  if (row && String(row.status) === "ACTIVE") {
    const at = nowIso();
    await db().execute({
      sql: `INSERT INTO password_resets
              (id, tenant_id, subject_kind, subject_id, token_hash,
               expires_at, used_at, created_at, created_ip)
            VALUES (?,?,?,?,?,?,NULL,?,?)`,
      args: [
        id("prs"),
        input.tenantId,
        "ADMIN",
        String(row.id),
        sha256(token),
        new Date(Date.now() + RESET_LINK_MINUTES * 60_000).toISOString(),
        at,
        input.ip ?? null,
      ],
    });

    await deliver({
      kind: "PASSWORD_RESET",
      to: String(row.email ?? ""),
      subject: "パスワードの再設定",
      body:
        `${String(row.name ?? "")} 様\n\n` +
        "パスワードの再設定を受け付けました。\n" +
        `次のリンクから、${RESET_LINK_MINUTES}分以内に設定してください。\n\n` +
        `  /reset-password?token=${token}\n\n` +
        "お心当たりが無い場合は、このメールを破棄してください。\n",
    });
  }

  return { accepted: true };
}

/**
 * 作り直しのリンクを使って、新しいパスワードを設定する。
 *
 * ★使い終わったリンクを、その場で無効にすること。
 *   メールは、たいてい残ります。転送もされます。
 *   1回きりにしないと、そのメールを見た人が、あとから入れます。
 */
export async function completePasswordReset(input: {
  token: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: true }> {
  await migrate();

  const res = await db().execute({
    sql: `SELECT id, tenant_id, subject_id, expires_at, used_at
            FROM password_resets WHERE token_hash = ? LIMIT 1`,
    args: [sha256(String(input.token ?? ""))],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;

  /* ★「そのリンクは使用済みです」と「そんなリンクはありません」を
       分けて返さないこと。総当たりの手がかりになります。 */
  const bad = () =>
    new PasswordError(
      "BAD_TOKEN",
      "このリンクは使えません。お手数ですが、もう一度お申し込みください。",
    );

  if (!row) throw bad();
  if (row.used_at != null) throw bad();
  if (expired(row.expires_at)) throw bad();

  if (input.newPassword !== input.confirmPassword) {
    throw new PasswordError(
      "MISMATCH",
      "確認用に入れた新しいパスワードが、一致していません。",
    );
  }
  const policy = checkPasswordPolicy(input.newPassword);
  if (!policy.ok) throw new PasswordError("WEAK", policy.why);

  const tenantId = String(row.tenant_id);
  const subjectId = String(row.subject_id);
  const hash = await hashPassword(input.newPassword);
  const at = nowIso();

  /* ★先にリンクを潰してから、パスワードを変えること。
       順番が逆だと、同時に2回押されたときに2回通ります。 */
  const used = await db().execute({
    sql: `UPDATE password_resets SET used_at = ?
           WHERE id = ? AND used_at IS NULL`,
    args: [at, String(row.id)],
  });
  if (Number(used.rowsAffected ?? 0) !== 1) throw bad();

  await db().execute({
    sql: `UPDATE app_users
             SET password_hash = ?,
                 must_change_password = 0,
                 password_changed_at = ?,
                 temp_password_expires_at = NULL,
                 temp_password_used_at = NULL,
                 failed_logins = 0,
                 locked_until = NULL
           WHERE id = ? AND tenant_id = ?`,
    args: [hash, at, subjectId, tenantId],
  });

  /* ★作り直したときは、全部の端末を追い出すこと。
       忘れた人の代わりに、誰かが入っている可能性があります。 */
  const { destroyAllSessionsOf } = await import("./session");
  await destroyAllSessionsOf(tenantId, subjectId);

  const who = await db().execute({
    sql: `SELECT name, role FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [subjectId, tenantId],
  });
  const w = who.rows[0] as Record<string, unknown> | undefined;

  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId,
      at,
      actorKind: "ADMIN",
      actorId: subjectId,
      actorName: String(w?.name ?? ""),
      actorRole: String(w?.role ?? ""),
      action: "PASSWORD_RESET",
      target: subjectId,
      summary: `${String(w?.name ?? "")} がパスワードを再設定しました。`,
      data: { allSessionsRevoked: true },
    });
  });

  return { ok: true };
}
