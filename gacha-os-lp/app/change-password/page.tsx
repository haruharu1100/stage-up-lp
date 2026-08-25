/**
 * パスワード変更の画面（/change-password）。
 *
 * ★requireAdmin を使わないこと。
 *   requireAdmin は「仮パスワードのままの人」をこの画面へ送ります。
 *   この画面で requireAdmin を呼ぶと、自分自身へ送り返し続けます。
 *   （ブラウザは数回で「リダイレクトが多すぎます」と諦めます）
 *
 * ★検索に出さないこと。
 */

import type { Metadata } from "next";
import ChangePasswordForm from "@/components/auth/ChangePasswordForm";
import { requireAdminForFirstRun, FIRST_RUN } from "@/lib/server/pageAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "パスワードの変更｜AI GACHA OS",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const { user } = await requireAdminForFirstRun(FIRST_RUN.changePassword);

  return (
    <ChangePasswordForm
      name={user.name}
      email={user.email}
      forced={user.mustChangePassword}
    />
  );
}
