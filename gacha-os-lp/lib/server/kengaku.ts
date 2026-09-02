/**
 * 見学リンク ── 合言葉なしで、管理画面を「見るだけ」開く。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを作ったか（2026-09-03）
 * ═══════════════════════════════════════════════════════
 *
 *   契約後にお渡しする管理画面を、人に見てもらいたい場面があります。
 *   ところが、いまは会社コード・メールアドレス・パスワード・
 *   認証アプリの6桁、の4つが要ります。
 *
 *   これは「本番の管理画面」としては、まったく正しい形です。
 *   ですが「ちょっと中を見てほしい」には重すぎます。
 *   重すぎる手順は、結局こうなります。
 *
 *       面倒だから、パスワードを弱くしよう
 *       面倒だから、二段階認証を外そう
 *
 *   ★本物の鍵を緩めて見せる、が、いちばん危ない道です。
 *     だから、本物の鍵はそのままにして、
 *     「見るだけの入口」を別に1本だけ作ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口が、絶対に守ること（3つ）
 * ═══════════════════════════════════════════════════════
 *
 *   ① 本番では、開かない。
 *      demoAllowed() を通します。DEMO_MODE=true かつ 本番でないとき
 *      だけです。片方だけでは開きません。
 *      ★本番に1つでも残っていたら、鍵のかかっていない裏口です。
 *
 *   ② 見学のセッションは「見るだけ」の印が付く。
 *      印が付いていると、役職が何であっても、
 *      状態が変わる依頼（POST／PUT／PATCH／DELETE）は
 *      1つも通りません（lib/server/context.ts の門番）。
 *
 *   ③ 見学の担当者は、合言葉で入れない。
 *      password_hash を空（NULL）のまま作ります。
 *      verifyPassword は、空の相手には必ず false を返します
 *      （lib/server/password.ts）。
 *      つまり、この入口以外からは、この人になれません。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、役職を SUPER_ADMIN にしてあるのか
 * ═══════════════════════════════════════════════════════
 *
 *   見せたいのは「この管理画面は、ここまでできます」です。
 *   閲覧のみ（VIEWER）を渡すと、不正対策・セキュリティ・
 *   監査ログ・設定の4画面が開けません。
 *   いちばん見ていただきたい部分が、そっくり抜け落ちます。
 *
 *   ★見えることと、動かせることは、別の話です。
 *     見えるほうは役職で開け、動かすほうはセッションの印で閉じます。
 *     どちらか一方でやろうとすると、必ずどちらかを諦めることになります。
 */

import { db, migrate } from "./db";
import { id, displayNo } from "./ids";
import { demoAllowed } from "./demo";
import { tenantByCode } from "./auth";
import { createSession } from "./session";

/** 見学リンクで入る会社（見本データの入っている会社） */
export const KENGAKU_TENANT_CODE = "DEMO";

/** 見学用の担当者。実在の方と混ざらないよう .example を使います */
export const KENGAKU_EMAIL = "kengaku@demo.example";

/** 画面に出る名前。★「見学」と分かる名前にすること */
export const KENGAKU_NAME = "見学の方（閲覧のみ）";

/**
 * 見学の入口を開いてよいか。
 *
 * ★demoAllowed() をそのまま使うこと。
 *   ここに独自の条件を書くと、判断が2枚になります。
 *   2枚になった表は、片方だけ直された日に、静かにずれます。
 */
export function kengakuAllowed(): boolean {
  return demoAllowed();
}

/** 見学のセッションが、どれだけもつか */
export const KENGAKU_IDLE_MINUTES = 60;
export const KENGAKU_ABSOLUTE_HOURS = 12;

/**
 * 見学用の担当者を用意する（無ければ作り、有れば安全な状態へ戻す）。
 *
 * ★「有れば、そのまま使う」にしないこと。
 *   誰かが管理画面から、この人の役職を変えたり、
 *   パスワードを設定したりできてしまいます。
 *   呼ばれるたびに、あるべき状態へ戻します。
 *
 * @returns 見学用担当者の id
 */
export async function ensureKengakuUser(tenantId: string): Promise<string> {
  await migrate();

  const found = await db().execute({
    sql: `SELECT id FROM app_users
           WHERE tenant_id = ? AND lower(email) = ? LIMIT 1`,
    args: [tenantId, KENGAKU_EMAIL],
  });
  const row = found.rows[0] as Record<string, unknown> | undefined;

  if (row) {
    const userId = String(row.id);
    /* ★毎回、あるべき状態へ戻すこと。
         とくに password_hash は必ず空へ戻します。
         ここを飛ばすと、いちど設定された合言葉が生き続けます。 */
    await db().execute({
      sql: `UPDATE app_users
               SET role = 'SUPER_ADMIN',
                   status = 'ACTIVE',
                   name = ?,
                   password_hash = NULL,
                   must_change_password = 0,
                   temp_password_expires_at = NULL,
                   temp_password_used_at = NULL,
                   mfa_required = 0,
                   mfa_enabled = 0,
                   mfa_secret = NULL,
                   mfa_last_counter = NULL,
                   failed_logins = 0,
                   locked_until = NULL
             WHERE id = ? AND tenant_id = ?`,
      args: [KENGAKU_NAME, userId, tenantId],
    });
    return userId;
  }

  const userId = id("usr");
  await db().execute({
    sql: `INSERT INTO app_users
            (id, tenant_id, display_id, email, name, role, password_hash,
             must_change_password, status, created_at,
             mfa_required, mfa_enabled)
          VALUES (?,?,?,?,?,'SUPER_ADMIN',NULL,0,'ACTIVE',?,0,0)`,
    args: [
      userId,
      tenantId,
      displayNo("AD", 99),
      KENGAKU_EMAIL,
      KENGAKU_NAME,
      new Date().toISOString(),
    ],
  });
  return userId;
}

export type KengakuStart =
  | {
      ok: true;
      token: string;
      csrfToken: string;
      expiresAt: string;
      absoluteExpiresAt: string;
    }
  | { ok: false; why: "NOT_ALLOWED" | "NO_TENANT" };

/**
 * 見学のセッションを1つ作る。
 *
 * ★step_up_at は付けません。
 *   6桁の入れ直しを求める操作（権限変更・利用停止など）は、
 *   見学では通しません。もっとも、その前に
 *   「見るだけ」の印で止まりますので、二重の守りになります。
 */
export async function startKengaku(
  userAgent?: string,
): Promise<KengakuStart> {
  if (!kengakuAllowed()) return { ok: false, why: "NOT_ALLOWED" };

  const tenant = await tenantByCode(KENGAKU_TENANT_CODE);
  if (!tenant) return { ok: false, why: "NO_TENANT" };

  const userId = await ensureKengakuUser(tenant.id);

  const issued = await createSession({
    tenantId: tenant.id,
    subjectKind: "ADMIN",
    subjectId: userId,
    idleMinutes: KENGAKU_IDLE_MINUTES,
    absoluteHours: KENGAKU_ABSOLUTE_HOURS,
    userAgent,
    readOnly: true,
  });

  return {
    ok: true,
    token: issued.token,
    csrfToken: issued.csrfToken,
    expiresAt: issued.expiresAt,
    absoluteExpiresAt: issued.absoluteExpiresAt,
  };
}
