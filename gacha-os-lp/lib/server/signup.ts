/**
 * お客様が、ご自分で会員登録する。
 *
 * ═══════════════════════════════════════════════════════
 * ★これが無いと、お店は1円も売れません
 * ═══════════════════════════════════════════════════════
 *
 *   2026-09-05 の監査で分かりました。
 *   この製品には、お客様を作る画面が、顧客側にも管理側にも
 *   1つもありませんでした。開発用の道具からしか作れません。
 *
 *   ガチャがどれだけよくできていても、引く人がいなければ
 *   売上は立ちません。だから、ここが最優先です。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口が守ること（4つ）
 * ═══════════════════════════════════════════════════════
 *
 *   1) 登録の入口を、名簿を作る道具にしないこと。
 *
 *      「そのメールアドレスは、すでに登録されています」と返すと、
 *      片っ端から打ち込むだけで、会員名簿が復元できます。
 *      パスワードも要りません。ログインの入口より手軽です。
 *
 *      ★いてもいなくても、同じ返事にします。
 *        すでにいる方には「登録の申し込みがありました。
 *        お心当たりが無ければ破棄してください」という
 *        別の内容のメールを、同じ宛先へ出します。
 *        本人だけが、違いに気づけます。
 *
 *   2) 重複を、DBに断らせること。
 *
 *      「調べてから入れる」だけでは、同時に2通来たときに
 *      2件とも「無い」と答えます。M015 で index を張ってあります。
 *
 *   3) 確認リンクを、返事の本文に入れないこと。
 *
 *      入れると、メールアドレスを書いただけの人にリンクが渡り、
 *      他人になりすませます。確認用の環境でも同じにします。
 *      （メールは lib/server/mailer.ts が記録に書きます）
 *
 *   4) メール確認が済むまで、お金が動く操作をさせないこと。
 *
 *      止めているのは画面ではなく、門番です（lib/server/context.ts）。
 *      画面を開かずに入口を直接叩く道を、残しません。
 */

import { randomBytes, createHash } from "node:crypto";
import { db, migrate, withWriteTx } from "./db";
import { appendAuditTx } from "./audit";
import { displayNo, id } from "./ids";
import { checkPasswordPolicy, hashPassword } from "./password";
import { deliver } from "./mailer";

/** 確認リンクの有効時間。★長くしすぎないこと */
export const VERIFY_LINK_HOURS = 24;

/** 同じ回線から、1時間に受け付ける登録の上限 */
const SIGNUP_PER_IP_PER_HOUR = 5;

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const nowIso = () => new Date().toISOString();
const str = (v: unknown) => (typeof v === "string" ? v : "");

export class SignupError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SignupError";
  }
}

/**
 * メールアドレスの形だけを見る。
 *
 * ★ここで厳しくしすぎないこと。
 *   実在するかどうかは、確認メールが届くかで決めます。
 *   正規表現を凝らすと、実在する珍しい形の住所を弾きます。
 */
function looksLikeEmail(v: string): boolean {
  if (v.length < 5 || v.length > 254) return false;
  if (/\s/.test(v)) return false;
  const at = v.indexOf("@");
  if (at <= 0 || at !== v.lastIndexOf("@")) return false;
  const domain = v.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/* ══════════════════════════════════════════════
   受付の記録（多すぎる申し込みを止めるため）
   ══════════════════════════════════════════════ */

async function recordSignupAttempt(input: {
  tenantId: string;
  identifier: string;
  ok: boolean;
  reason: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await db().execute({
    sql: `INSERT INTO login_attempts
            (id, tenant_id, subject_kind, identifier, ok, reason, ip, user_agent, created_at)
          VALUES (?,?,'CUSTOMER',?,?,?,?,?,?)`,
    args: [
      id("lga"),
      input.tenantId,
      input.identifier,
      input.ok ? 1 : 0,
      input.reason,
      input.ip ?? null,
      input.userAgent ?? null,
      nowIso(),
    ],
  });
}

/** 同じ回線から、短い間に何件来ているか */
async function signupsFromIp(ip: string | undefined): Promise<number> {
  if (!ip) return 0;
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM login_attempts
           WHERE ip = ? AND reason LIKE 'SIGNUP%' AND created_at >= ?`,
    args: [ip, since],
  });
  return Number((r.rows[0] as Record<string, unknown>)?.n ?? 0);
}

/* ══════════════════════════════════════════════
   会員登録
   ══════════════════════════════════════════════ */

export type SignupInput = {
  tenantId: string;
  /** 店名。メールの文面に使います */
  tenantName: string;
  email: string;
  password: string;
  /** 呼び名。空でもかまいません（メールの@より前を使います） */
  name?: string;
  agreeTerms: boolean;
  agreePrivacy: boolean;
  ip?: string;
  userAgent?: string;
};

/**
 * 会員登録を受け付ける。
 *
 * ★成功しても失敗しても、外へは同じ返事にすること。
 *   例外を投げるのは「送られてきた内容そのものが正しくない」ときだけです。
 *   それは、送った本人が自分で分かることなので、返しても中身は漏れません。
 */
export async function signupCustomer(
  input: SignupInput,
): Promise<{ accepted: true }> {
  await migrate();

  const email = str(input.email).trim().toLowerCase();
  const password = str(input.password);
  const nickname = str(input.name).trim();

  /* ── ① 送られてきた内容そのものを見る ── */
  if (!looksLikeEmail(email)) {
    throw new SignupError(
      "BAD_EMAIL",
      "メールアドレスの形をご確認ください。",
    );
  }

  /* ★同意は、既定で「していない」にすること。
       画面に出すだけで済ませると、押していない人が通ります。 */
  if (input.agreeTerms !== true || input.agreePrivacy !== true) {
    throw new SignupError(
      "AGREEMENT_REQUIRED",
      "利用規約とプライバシーポリシーへの同意が必要です。",
    );
  }

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    throw new SignupError("WEAK_PASSWORD", policy.why);
  }

  if (nickname.length > 40) {
    throw new SignupError("BAD_NAME", "お名前は40文字まででお願いします。");
  }

  /* ── ② 同じ回線から来すぎていないか ──
       ★ここで断るのは「その回線」であって「そのメール」ではありません。
         メールごとに数えると、数えた事実そのものが手がかりになります。 */
  if ((await signupsFromIp(input.ip)) >= SIGNUP_PER_IP_PER_HOUR) {
    await recordSignupAttempt({
      tenantId: input.tenantId,
      identifier: email,
      ok: false,
      reason: "SIGNUP_RATE_LIMITED",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    throw new SignupError(
      "TOO_MANY",
      "お申し込みが続いています。しばらく時間をおいてから、もう一度お試しください。",
    );
  }

  /* ── ③ すでにいらっしゃる方か ──
       ★ここで返事を分けないこと。分けるのはメールの中身だけです。 */
  const found = await db().execute({
    sql: `SELECT id, name, email FROM customers
           WHERE tenant_id = ? AND lower(email) = ? LIMIT 1`,
    args: [input.tenantId, email],
  });
  const already = found.rows[0] as Record<string, unknown> | undefined;

  if (already) {
    await recordSignupAttempt({
      tenantId: input.tenantId,
      identifier: email,
      ok: false,
      reason: "SIGNUP_DUPLICATE",
      ip: input.ip,
      userAgent: input.userAgent,
    });

    /* ★本人にだけ分かる形で知らせます。
         「すでに登録されています」は、画面には出しません。 */
    await deliver({
      to: str(already.email),
      subject: `【${input.tenantName}】会員登録のお申し込みについて`,
      body:
        `${str(already.name)} 様\n\n` +
        "会員登録のお申し込みを受け付けましたが、\n" +
        "このメールアドレスは、すでに登録されています。\n\n" +
        "ログインできない場合は、パスワードの再設定をお試しください。\n" +
        "お心当たりが無い場合は、このメールを破棄してください。\n",
    });

    return { accepted: true };
  }

  /* ── ④ 新しくお作りする ── */
  const customerId = id("cus");
  const at = nowIso();
  const passwordHash = await hashPassword(password);
  const displayName = nickname !== "" ? nickname : email.slice(0, email.indexOf("@"));
  const token = randomBytes(32).toString("base64url");

  /* ★画面に出す番号は、いま何人いるかから作ります。
       同時に来ると、同じ番号を取り合うことがあります。
       そのときは UNIQUE(tenant_id, display_id) が断るので、
       断られたら数え直して、もう一度だけ試します。 */
  let inserted = false;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const cnt = await db().execute({
      sql: `SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?`,
      args: [input.tenantId],
    });
    const no = Number((cnt.rows[0] as Record<string, unknown>)?.n ?? 0) + 1 + attempt;

    try {
      /* ★会員の行と、確認の合言葉は、まとめて1回で通すこと。
           会員だけ作られて確認メールが出せないと、
           ご自分では二度と有効化できない人が生まれます。 */
      await db().batch(
        [
          {
            /* ★残高（points）と使った額（spent）は、ここに書かないこと。
                 表のほうで 0 から始まると決めてあります（DEFAULT 0）。
                 ここに 0 と書くと「登録の入口が、残高を決めている」形になり、
                 いつか 0 以外を書ける場所になります。
                 残高が動くのは、必ず台帳（point_ledger）と一緒のときだけです。 */
            sql: `INSERT INTO customers
                    (id, tenant_id, display_id, email, name, password_hash,
                     status, created_at,
                     email_verified_at, terms_agreed_at, privacy_agreed_at,
                     signup_source, signup_ip)
                  VALUES (?,?,?,?,?,?,'ACTIVE',?,NULL,?,?,'SELF',?)`,
            args: [
              customerId,
              input.tenantId,
              displayNo("GD", no),
              email,
              displayName,
              passwordHash,
              at,
              at,
              at,
              input.ip ?? null,
            ],
          },
          {
            sql: `INSERT INTO email_verifications
                    (id, tenant_id, customer_id, email, token_hash,
                     expires_at, used_at, created_at, created_ip)
                  VALUES (?,?,?,?,?,?,NULL,?,?)`,
            args: [
              id("evf"),
              input.tenantId,
              customerId,
              email,
              sha256(token),
              new Date(Date.now() + VERIFY_LINK_HOURS * 3_600_000).toISOString(),
              at,
              input.ip ?? null,
            ],
          },
        ],
        "write",
      );
      inserted = true;
    } catch (e) {
      lastError = e;
      const msg = String((e as Error)?.message ?? e);

      /* ★メールの重複でぶつかったときは、そこで終わりにすること。
           ③ を通り抜けた直後に、別の依頼が同じメールで入った、
           という場面です。もう一度試しても、また同じところで断られます。 */
      if (/ux_customers_tenant_email/i.test(msg)) {
        await recordSignupAttempt({
          tenantId: input.tenantId,
          identifier: email,
          ok: false,
          reason: "SIGNUP_DUPLICATE_RACE",
          ip: input.ip,
          userAgent: input.userAgent,
        });
        return { accepted: true };
      }

      /* 画面に出す番号のぶつかりなら、数え直してもう一度 */
      if (!/UNIQUE/i.test(msg)) throw e;
    }
  }

  if (!inserted) {
    console.error("[signup] 会員を作れませんでした", lastError);
    throw new SignupError(
      "INTERNAL",
      "ただいま登録を受け付けられません。少し時間をおいてから、もう一度お試しください。",
    );
  }

  await recordSignupAttempt({
    tenantId: input.tenantId,
    identifier: email,
    ok: true,
    reason: "SIGNUP_OK",
    ip: input.ip,
    userAgent: input.userAgent,
  });

  await sendVerificationMail({
    tenantName: input.tenantName,
    to: email,
    name: displayName,
    token,
  });

  /* ★記録に残すこと。誰が、いつ、自分で登録したか。
       あとから「この会員はどこから来たのか」を追えるようにします。 */
  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId: input.tenantId,
      at,
      actorKind: "CUSTOMER",
      actorId: customerId,
      actorName: displayName,
      actorRole: "CUSTOMER",
      action: "CUSTOMER_SIGNUP",
      target: customerId,
      summary: `${displayName} が会員登録しました（メール確認待ち）。`,
    });
  });

  return { accepted: true };
}

/* ══════════════════════════════════════════════
   確認メール
   ══════════════════════════════════════════════ */

async function sendVerificationMail(input: {
  tenantName: string;
  to: string;
  name: string;
  token: string;
}): Promise<void> {
  await deliver({
    to: input.to,
    subject: `【${input.tenantName}】メールアドレスのご確認`,
    body:
      `${input.name} 様\n\n` +
      "会員登録のお申し込みをいただき、ありがとうございます。\n" +
      `次のリンクを開いて、${VERIFY_LINK_HOURS}時間以内にご確認をお願いします。\n\n` +
      `  /verify-email?token=${input.token}\n\n` +
      "ご確認が済むまで、ポイントの購入とガチャのご利用はできません。\n" +
      "お心当たりが無い場合は、このメールを破棄してください。\n",
  });
}

/* ══════════════════════════════════════════════
   確認リンクを使う
   ══════════════════════════════════════════════ */

/**
 * 確認リンクを使って、メールアドレスの確認を済ませる。
 *
 * ★使い終わったリンクを、その場で無効にすること。
 *   メールは残ります。転送もされます。
 */
export async function verifyEmail(input: {
  token: string;
}): Promise<{ ok: true; tenantId: string; customerId: string }> {
  await migrate();

  const r = await db().execute({
    sql: `SELECT id, tenant_id, customer_id, email, expires_at, used_at
            FROM email_verifications WHERE token_hash = ? LIMIT 1`,
    args: [sha256(str(input.token))],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;

  /* ★「使用済み」と「存在しない」を分けて返さないこと */
  const bad = () =>
    new SignupError(
      "BAD_TOKEN",
      "このリンクは使えません。お手数ですが、確認メールの再送をお試しください。",
    );

  if (!row) throw bad();
  if (row.used_at != null) throw bad();
  if (Date.parse(String(row.expires_at)) <= Date.now()) throw bad();

  const tenantId = String(row.tenant_id);
  const customerId = String(row.customer_id);
  const at = nowIso();

  /* ★2つの書き込みを、まとめて1回で通すこと。
       印だけ付いてリンクが生き残ると、そのリンクが二度使えます。 */
  await db().batch(
    [
      {
        sql: `UPDATE customers
                 SET email_verified_at = ?
               WHERE id = ? AND tenant_id = ? AND email_verified_at IS NULL`,
        args: [at, customerId, tenantId],
      },
      {
        sql: `UPDATE email_verifications
                 SET used_at = ?
               WHERE id = ? AND used_at IS NULL`,
        args: [at, String(row.id)],
      },
    ],
    "write",
  );

  const who = await db().execute({
    sql: `SELECT name FROM customers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [customerId, tenantId],
  });
  const name = String((who.rows[0] as Record<string, unknown>)?.name ?? "");

  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId,
      at,
      actorKind: "CUSTOMER",
      actorId: customerId,
      actorName: name,
      actorRole: "CUSTOMER",
      action: "CUSTOMER_EMAIL_VERIFIED",
      target: customerId,
      summary: `${name} がメールアドレスの確認を完了しました。`,
    });
  });

  return { ok: true, tenantId, customerId };
}

/* ══════════════════════════════════════════════
   確認メールの再送
   ══════════════════════════════════════════════ */

/**
 * ログイン済みの、まだ確認が済んでいない方へ、もう一度お送りする。
 *
 * ★古いリンクを、その場で使えなくすること。
 *   何通も生きたままにすると、いちばん古い（＝いちばん漏れやすい）
 *   ものが、いつまでも有効なままになります。
 */
export async function resendVerification(input: {
  tenantId: string;
  tenantName: string;
  customerId: string;
  ip?: string;
}): Promise<{ accepted: true }> {
  await migrate();

  const r = await db().execute({
    sql: `SELECT id, name, email, email_verified_at
            FROM customers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [input.customerId, input.tenantId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;

  /* すでに済んでいる方・見つからない方にも、同じ返事にします */
  if (!row || row.email_verified_at != null || row.email == null) {
    return { accepted: true };
  }

  const at = nowIso();
  const token = randomBytes(32).toString("base64url");

  await db().batch(
    [
      {
        sql: `UPDATE email_verifications SET used_at = ?
               WHERE tenant_id = ? AND customer_id = ? AND used_at IS NULL`,
        args: [at, input.tenantId, input.customerId],
      },
      {
        sql: `INSERT INTO email_verifications
                (id, tenant_id, customer_id, email, token_hash,
                 expires_at, used_at, created_at, created_ip)
              VALUES (?,?,?,?,?,?,NULL,?,?)`,
        args: [
          id("evf"),
          input.tenantId,
          input.customerId,
          String(row.email),
          sha256(token),
          new Date(Date.now() + VERIFY_LINK_HOURS * 3_600_000).toISOString(),
          at,
          input.ip ?? null,
        ],
      },
    ],
    "write",
  );

  await sendVerificationMail({
    tenantName: input.tenantName,
    to: String(row.email),
    name: String(row.name ?? ""),
    token,
  });

  return { accepted: true };
}
