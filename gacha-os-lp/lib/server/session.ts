/**
 * ログイン状態（セッション）。
 *
 * ═══════════════════════════════════════════════════════
 * ★決まり
 * ═══════════════════════════════════════════════════════
 *
 *   1) 誰であるかは、必ずここから決めること。
 *      画面から送られてきた userId を、そのまま信じない。
 *      信じると、IDを書き換えるだけで他人として操作できます。
 *
 *   2) 合言葉（トークン）は、そのまま保存しないこと。
 *      DBを見られたとき、全員になりすませてしまいます。
 *      ハッシュにして保存し、照合はハッシュ同士で行います。
 *
 *   3) どの会社（tenant）のセッションかを、必ず持たせること。
 *      持たせないと、他社のデータを指す操作を止められません。
 *
 *   4) ログインに成功した瞬間に、必ず新しいセッションへ入れ替えること。
 *      入れ替えないと、次のことが起こせます。
 *
 *        攻撃者が自分のセッションIDをお客様に踏ませておく
 *        → お客様がそのままログインする
 *        → 攻撃者の手元のセッションが、お客様のものになる
 *
 *      これを「セッション固定」と言います。入れ替えるだけで防げます。
 *
 * ═══════════════════════════════════════════════════════
 * ★期限は2つ持たせること
 * ═══════════════════════════════════════════════════════
 *
 *     expires_at           … 使っていれば延びる期限（あと何分か）
 *     absolute_expires_at  … 何をしても延びない期限（最長ここまで）
 *
 *   延びるほうだけだと、盗まれた合言葉が永遠に使えます。
 *   毎日ちょっとずつ使われるだけで、期限が来ないからです。
 *   延びないほうを必ず持たせて、いつか必ず切れるようにします。
 *
 * ═══════════════════════════════════════════════════════
 * ★合言葉のほかに、もう1つ合図を持たせること（CSRF）
 * ═══════════════════════════════════════════════════════
 *
 *   クッキーは、どのサイトから送られた依頼にも自動で付いていきます。
 *   だから、まったく別のサイトに置かれたボタンを踏んだだけで、
 *   お客様の名前のまま「ポイントを使う」が成立してしまいます。
 *
 *   そこで、クッキーには入っていない値（CSRFトークン）を
 *   画面から送り返してもらい、一致しなければ受け付けません。
 *   別のサイトからは、この値を読めません。
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db, migrate } from "./db";
import { id } from "./ids";

/** 合言葉をしまうクッキーの名前 */
export const SESSION_COOKIE = "gos_session";

/** CSRF の合図を画面へ渡すクッキーの名前（こちらは読めてよい） */
export const CSRF_COOKIE = "gos_csrf";

/** 画面から送り返してもらうときの見出し */
export const CSRF_HEADER = "x-gos-csrf";

/** 使っていれば延びる期限（分） */
const IDLE_MINUTES = 60;

/** 何をしても延びない期限（時間） */
const ABSOLUTE_HOURS = 12;

export type SubjectKind = "ADMIN" | "CUSTOMER";

export type Session = {
  id: string;
  tenantId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  stepUpAt: string | null;
  expiresAt: string;
  absoluteExpiresAt: string;
  /**
   * 「見るだけ」のセッションか。
   *
   * ★true のときは、役職が何であっても、
   *   状態が変わる依頼（POST／PUT／PATCH／DELETE）を1つも通しません。
   *   判断は lib/server/context.ts の門番に1か所だけ置いてあります。
   *   入口ごとに書き写さないこと。書き写した瞬間、書き忘れが生まれます。
   */
  readOnly: boolean;
};

const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

/** 予測できない合言葉を作る */
const newToken = () => randomBytes(32).toString("base64url");

export type IssuedSession = {
  token: string;
  csrfToken: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  sessionId: string;
};

/**
 * セッションを作り、画面へ渡す合言葉を返す。
 *
 * @param input.replaces  ログイン前に持っていたセッション。
 *                        渡すと、この場で捨てます（セッション固定への備え）。
 */
export async function createSession(input: {
  tenantId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  idleMinutes?: number;
  absoluteHours?: number;
  userAgent?: string;
  replaces?: string;
  /** 「見るだけ」にするか（見学リンク用）。既定はふつうのセッション */
  readOnly?: boolean;
}): Promise<IssuedSession> {
  await migrate();

  /* ★先に、前のセッションを捨てること。
       残したままだと、ログイン前に配られた合言葉が生き続けます。 */
  if (input.replaces) await destroySession(input.replaces);

  const token = newToken();
  const csrfToken = newToken();
  const now = Date.now();
  const sessionId = id("ses");

  const expiresAt = new Date(
    now + (input.idleMinutes ?? IDLE_MINUTES) * 60_000,
  ).toISOString();
  const absoluteExpiresAt = new Date(
    now + (input.absoluteHours ?? ABSOLUTE_HOURS) * 3_600_000,
  ).toISOString();

  await db().execute({
    sql: `INSERT INTO sessions
            (id, tenant_id, subject_kind, subject_id, token_hash, csrf_hash,
             step_up_at, expires_at, absolute_expires_at, rotated_at,
             last_seen_at, user_agent, created_at, read_only)
          VALUES (?,?,?,?,?,?,NULL,?,?,NULL,?,?,?,?)`,
    args: [
      sessionId,
      input.tenantId,
      input.subjectKind,
      input.subjectId,
      hashToken(token),
      hashToken(csrfToken),
      expiresAt,
      absoluteExpiresAt,
      new Date(now).toISOString(),
      input.userAgent ?? null,
      new Date(now).toISOString(),
      input.readOnly ? 1 : 0,
    ],
  });

  return { token, csrfToken, expiresAt, absoluteExpiresAt, sessionId };
}

/**
 * 合言葉から、いま誰なのかを取り出す。無効なら null。
 *
 * ★期限が切れていたら、その場で消すこと。
 *   残しておくと、切れた行がいつまでも積もります。
 */
export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  await migrate();

  const res = await db().execute({
    sql: `SELECT id, tenant_id, subject_kind, subject_id, step_up_at,
                 expires_at, absolute_expires_at, read_only
            FROM sessions WHERE token_hash = ?`,
    args: [hashToken(token)],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const now = Date.now();
  const expiresAt = String(row.expires_at);
  const absolute = row.absolute_expires_at == null ? expiresAt : String(row.absolute_expires_at);

  if (new Date(expiresAt).getTime() <= now || new Date(absolute).getTime() <= now) {
    await destroySession(token);
    return null;
  }

  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    subjectKind: String(row.subject_kind) as SubjectKind,
    subjectId: String(row.subject_id),
    stepUpAt: row.step_up_at == null ? null : String(row.step_up_at),
    expiresAt,
    absoluteExpiresAt: absolute,
    /* ★列が無い古いDBでも、必ず「ふつうのセッション」に倒すこと。
         ここを「分からなければ見るだけ」にすると、
         移行前のDBにつないだ瞬間、全員が何もできなくなります。 */
    readOnly: Number(row.read_only ?? 0) === 1,
  };
}

/**
 * CSRF の合図が合っているか。
 *
 * ★読み取りだけの依頼にまで求めないこと。
 *   画面を開くたびに落ちるようになり、
 *   最終的には「面倒だから外そう」になります。
 *   状態が変わる依頼（POST など）にだけ求めます。
 */
export async function verifyCsrf(
  token: string | undefined,
  csrfToken: string | undefined,
): Promise<boolean> {
  if (!token || !csrfToken) return false;
  await migrate();

  const res = await db().execute({
    sql: `SELECT csrf_hash FROM sessions WHERE token_hash = ?`,
    args: [hashToken(token)],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row || row.csrf_hash == null) return false;

  const want = Buffer.from(String(row.csrf_hash), "utf8");
  const got = Buffer.from(hashToken(csrfToken), "utf8");
  if (want.length !== got.length) return false;
  return timingSafeEqual(want, got);
}

/**
 * 使われたので、期限を延ばす。
 *
 * ★延ばないほうの期限（absolute）は、絶対に触らないこと。
 *   触ると、盗まれた合言葉が永遠に使えるようになります。
 */
export async function touchSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await migrate();
  const now = Date.now();
  await db().execute({
    sql: `UPDATE sessions
             SET expires_at = ?, last_seen_at = ?
           WHERE token_hash = ?
             AND datetime(absolute_expires_at) > datetime(?)`,
    args: [
      new Date(now + IDLE_MINUTES * 60_000).toISOString(),
      new Date(now).toISOString(),
      hashToken(token),
      new Date(now).toISOString(),
    ],
  });
}

/**
 * 合言葉だけを新しくする（中の人は変えない）。
 *
 * 権限が変わったときなどに使います。
 * 盗まれた古い合言葉は、その場で使えなくなります。
 */
export async function rotateSession(
  token: string,
): Promise<IssuedSession | null> {
  const s = await readSession(token);
  if (!s) return null;

  const issued = await createSession({
    tenantId: s.tenantId,
    subjectKind: s.subjectKind,
    subjectId: s.subjectId,
    replaces: token,
    /* ★「見るだけ」の印を、必ず引き継ぐこと。
         ここを落とすと、合言葉を作り直しただけで
         見学の方が触れるようになります。
         しかも、その瞬間には何も起きないので、誰も気づきません。 */
    readOnly: s.readOnly,
  });

  /* 追加の本人確認が済んでいたなら、それは引き継ぐ */
  if (s.stepUpAt) {
    await db().execute({
      sql: `UPDATE sessions SET step_up_at = ?, rotated_at = ? WHERE id = ?`,
      args: [s.stepUpAt, new Date().toISOString(), issued.sessionId],
    });
  }
  return issued;
}

/** 追加の本人確認（2段階認証など）が済んだ印をつける */
export async function markStepUp(token: string | undefined): Promise<void> {
  if (!token) return;
  await migrate();
  await db().execute({
    sql: `UPDATE sessions SET step_up_at = ? WHERE token_hash = ?`,
    args: [new Date().toISOString(), hashToken(token)],
  });
}

/** ログアウト */
export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await migrate();
  await db().execute({
    sql: `DELETE FROM sessions WHERE token_hash = ?`,
    args: [hashToken(token)],
  });
}

/** その人のセッションを全部捨てる（乗っ取りに気づいたとき用） */
export async function destroyAllSessionsOf(
  tenantId: string,
  subjectId: string,
): Promise<void> {
  await migrate();
  await db().execute({
    sql: `DELETE FROM sessions WHERE tenant_id = ? AND subject_id = ?`,
    args: [tenantId, subjectId],
  });
}

/**
 * クッキーの付け方。
 *
 * ★httpOnly を外さないこと。
 *   外すと画面の script から合言葉が読めます。
 *   広告や外部部品が1つ乗っ取られただけで、全員ぶん抜かれます。
 *
 * ★sameSite は lax にすること。
 *   strict にすると、メールのリンクから来た方が毎回ログアウト状態になります。
 *   none は、他所のサイトからでも送られるという意味なので使いません。
 */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** CSRF の合図は、画面の script から読める必要がある（httpOnly にしない） */
export function csrfCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export const SESSION_IDLE_SECONDS = IDLE_MINUTES * 60;
export const SESSION_ABSOLUTE_SECONDS = ABSOLUTE_HOURS * 3600;
