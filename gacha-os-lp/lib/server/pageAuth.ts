/**
 * 画面（ページ）を出す前の、サーバー側の本人確認。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、画面側の isLoggedIn を信じてはいけないのか
 * ═══════════════════════════════════════════════════════
 *
 *   これまで、管理画面はブラウザの中の状態で開いていました。
 *
 *       if (!s.me) return <Login />     ← ブラウザの中の変数
 *
 *   これは「鍵」ではありません。「表示の出し分け」です。
 *   ブラウザの開発者ツールでその変数を書き換えれば、
 *   ログインせずに中身が出ます。
 *   しかも中身のデータは、すでにブラウザへ送り終わっています。
 *
 *   ★つまり、隠していただけで、渡していました。
 *
 *   だから、確認はサーバーでやります。
 *   ログインしていない人には、
 *   中身をブラウザへ送る前に、ログイン画面へ送り返します。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで tenantId を引数で受け取らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   どの会社の人かは、必ずクッキー（セッション）からだけ決めます。
 *   URLや本文から受け取れる形にした瞬間、
 *   他社のIDを書くだけで他社の画面が開きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★戻り先を必ず持たせること
 * ═══════════════════════════════════════════════════════
 *
 *   朝いちばんに /client-demo/shipping を開いた人を、
 *   ログイン後にダッシュボードへ送ると、
 *   毎朝もう一度メニューから探し直すことになります。
 *   開こうとしていた場所へ返します。
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession, type Session } from "./session";
import { asRole } from "@/lib/permissions";

/*
 * ★この形は lib/currentUser.ts にあります。
 *   ブラウザ側も同じ形を読むので、
 *   サーバー専用の部品が混ざらない場所に置いてあります。
 */
import type { PageUser } from "@/lib/currentUser";
export type { PageUser };

export type PageAuth = {
  session: Session;
  user: PageUser;
};

/**
 * いまログインしている管理者を返す。していなければ null。
 *
 * ★null を「ログインしていない」以外の意味に使わないこと。
 *   期限切れも、消されたセッションも、他社のセッションも、
 *   すべて同じ扱いにします。区別して返すと、
 *   外から「そのIDは存在する」を当てる手がかりになります。
 */
export async function currentAdmin(): Promise<PageAuth | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await readSession(token);
  if (!session) return null;

  /* ★お客様のセッションで管理画面を開かせないこと。
       同じクッキーを使っているので、ここを見落とすと
       お客様が管理画面に入れます。 */
  if (session.subjectKind !== "ADMIN") return null;

  const { db } = await import("./db");

  const res = await db().execute({
    sql: `SELECT display_id, name, email, role, mfa_enabled
            FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [session.subjectId, session.tenantId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;

  /* セッションは生きているのに、担当者の行が消えている。
     退職処理の直後などに起こります。中へは入れません */
  if (!row) return null;

  const t = await db().execute({
    sql: `SELECT code, name FROM tenants WHERE id = ? LIMIT 1`,
    args: [session.tenantId],
  });
  const tr = t.rows[0] as Record<string, unknown> | undefined;

  return {
    session,
    user: {
      displayId: String(row.display_id ?? ""),
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      role: asRole(row.role),
      mfaEnabled: Number(row.mfa_enabled ?? 0) === 1,
      stepUpDone: session.stepUpAt != null,
      tenantCode: String(tr?.code ?? ""),
      tenantName: String(tr?.name ?? ""),
    },
  };
}

/**
 * ログインしていなければ、ログイン画面へ送る。
 *
 * @param returnTo いま開こうとしていた場所（/client-demo/shipping など）
 *
 * ★この関数が返ってきた＝通ったこと、にすること。
 *   redirect() は例外を投げて処理を止めるので、
 *   この下に「通ってしまう道」は残りません。
 */
export async function requireAdmin(returnTo: string): Promise<PageAuth> {
  const auth = await currentAdmin();
  if (auth) return auth;

  /*
   * ★戻り先は、必ず encodeURIComponent を通すこと。
   *   通さないと、戻り先に "&" が入っているときに
   *   そこから先が別の指示として読まれます。
   *
   * ★戻り先の中身の安全確認は /login 側で行います（lib/returnTo.ts）。
   *   ここで二重に判断を書くと、片方だけ直したときにずれます。
   */
  redirect(`/login?next=${encodeURIComponent(returnTo)}`);
}
