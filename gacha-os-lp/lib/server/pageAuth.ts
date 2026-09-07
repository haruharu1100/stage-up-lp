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
import { hostMatchesTenant } from "./tenantHost";

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
 * いまログインしている「お客様」を返す。していなければ null。
 *
 * ═══════════════════════════════════════════════
 * ★管理者用と分けてある理由
 * ═══════════════════════════════════════════════
 *
 *   クッキーは1つ（gos_session）しかありません。
 *   その中に「担当者か、お客様か」が書いてあります。
 *
 *   ここで種類を見ないと、担当者のクッキーで
 *   お客様の画面が開いてしまいます。
 *   逆も同じです。currentAdmin が ADMIN を確かめているのと、
 *   まったく同じ理由です。
 */
export type CustomerAuth = {
  session: Session;
  customer: {
    displayId: string;
    name: string;
    email: string;
    tenantCode: string;
    /**
     * メールアドレスのご確認が済んでいるか。
     *
     * ★これを「入れる・入れない」の判断に使わないこと。
     *   済んでいなくても、画面は見ていただきます。
     *   見えないと、確認しようという気持ちが起きません。
     *
     *   実際に止めているのはサーバー側です
     *   （lib/server/context.ts の guard と lib/server/draw.ts）。
     *   ここは、お知らせを出すためだけに使います。
     */
    emailVerified: boolean;
  };
};

export async function currentCustomer(): Promise<CustomerAuth | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await readSession(token);
  if (!session) return null;

  /* ★ここを外さないこと。担当者のクッキーで
       お客様の画面に入れてしまいます */
  if (session.subjectKind !== "CUSTOMER") return null;

  /*
   * ★A店の会員証で、B店の画面を開かせないこと（2026-09-07）。
   *
   *   会社コードを廃止して、住所（ドメイン）でお店を決めるようにしました。
   *   その結果、「A店でログインしたまま、B店の住所を開く」が
   *   起こり得ます。そのとき画面はB店の看板を出しながら、
   *   中身はA店の残高と獲得商品を出します。
   *
   *   食い違ったら、ログインしていない扱いにします。
   *   （住所からお店が決まらない配置では判断しません。
   *     判断できないものを不合格にすると、正しい方まで締め出します）
   */
  if (!(await hostMatchesTenant(session.tenantId))) return null;

  const { db } = await import("./db");

  const res = await db().execute({
    sql: `SELECT display_id, name, email, email_verified_at FROM customers
           WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [session.subjectId, session.tenantId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;

  /* 退会済みなど、行が消えている。中へは入れません */
  if (!row) return null;

  const t = await db().execute({
    sql: `SELECT code FROM tenants WHERE id = ? LIMIT 1`,
    args: [session.tenantId],
  });

  return {
    session,
    customer: {
      displayId: String(row.display_id ?? ""),
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      emailVerified: row.email_verified_at != null,
      tenantCode: String(
        (t.rows[0] as Record<string, unknown> | undefined)?.code ?? "",
      ),
    },
  };
}

/**
 * お客様がログインしていなければ、ログイン画面へ送る。
 *
 * ★戻り先を必ず渡すこと。
 *   お届け状況を見に来た方を、ログイン後に
 *   別の場所へ落とすと、もう一度探すことになります。
 */
export async function requireCustomer(returnTo: string): Promise<CustomerAuth> {
  const auth = await currentCustomer();
  if (auth) return auth;
  redirect(`/login?next=${encodeURIComponent(returnTo)}`);
}

/**
 * 入る前に済ませてもらう画面。
 *
 * ★住所を、この1か所にまとめること。
 *   送り先と、その画面自身の場所が別々に書いてあると、
 *   片方だけ直した日に、無限に往復するようになります
 *   （送られた先が、また送り返す）。
 */
export const FIRST_RUN = {
  changePassword: "/change-password",
  mfaSetup: "/mfa-setup",
} as const;

/**
 * 「入る前に済ませてもらう画面」そのものを出すときに使う。
 *
 * ★requireAdmin を使わないこと。
 *   requireAdmin は、その画面へ送り返します。
 *   自分自身へ送り返し続けることになります。
 */
export async function requireAdminForFirstRun(
  returnTo: string,
): Promise<PageAuth> {
  const auth = await currentAdmin();
  if (auth) return auth;
  redirect(`/login?next=${encodeURIComponent(returnTo)}`);
}

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

  /* ★担当者も同じです。B店の住所でA店の管理画面を開かせないこと。
       住所からお店が決まらない入口（社内共通の管理用アドレス）では、
       ここは判断しません。 */
  if (!(await hostMatchesTenant(session.tenantId))) return null;

  const { db } = await import("./db");

  const res = await db().execute({
    sql: `SELECT display_id, name, email, role, mfa_enabled,
                 mfa_required, must_change_password
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
      mfaRequired: Number(row.mfa_required ?? 0) === 1,
      mustChangePassword: Number(row.must_change_password ?? 0) === 1,
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

  if (auth) {
    /*
     * ═══════════════════════════════════════════════
     * ★入る前に済ませてもらうことが、2つあります
     * ═══════════════════════════════════════════════
     *
     *   ① 仮パスワードのままなら、変えてもらう
     *   ② 二段階認証が必須の人なら、登録してもらう
     *
     *   ★これを画面の中の「お知らせ帯」で済ませないこと。
     *     帯は読まれません。読まれても、閉じられます。
     *     そして、仮パスワードのままの管理者が
     *     半年後もそのまま残ります。
     *     仮パスワードは、渡した先から漏れている前提のものです。
     *
     *   ★ここで通してしまうと、入口（API）側だけで断る形になり、
     *     「画面は開くのにボタンが全部エラーになる」という
     *     いちばん分かりにくい状態になります。
     */
    if (auth.user.mustChangePassword) redirect(FIRST_RUN.changePassword);
    if (auth.user.mfaRequired && !auth.user.mfaEnabled) {
      redirect(FIRST_RUN.mfaSetup);
    }
    return auth;
  }

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
