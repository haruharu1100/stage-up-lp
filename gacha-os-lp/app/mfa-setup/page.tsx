/**
 * 二段階認証の登録画面（/mfa-setup）。
 *
 * ★ここでも requireAdmin を使わないこと。
 *   requireAdmin は「登録がまだの人」をこの画面へ送ります。
 *   この画面で呼ぶと、自分自身へ送り返し続けます。
 *
 * ★ただし、仮パスワードのままの人は、先に変更画面へ送ること。
 *   順番は「パスワード → 認証アプリ」です。
 *   逆にすると、漏れているかもしれない仮パスワードのまま、
 *   認証アプリの登録だけが済んだ状態になります。
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MfaSetupForm from "@/components/auth/MfaSetupForm";
import { requireAdminForFirstRun, FIRST_RUN } from "@/lib/server/pageAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "認証アプリの登録｜AI GACHA OS",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const { user } = await requireAdminForFirstRun(FIRST_RUN.mfaSetup);

  if (user.mustChangePassword) redirect(FIRST_RUN.changePassword);

  return <MfaSetupForm email={user.email} required={user.mfaRequired} />;
}
