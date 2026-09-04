/**
 * メールアドレスの確認（/verify-email?token=...）。
 *
 * ★合言葉を、サーバー側でここに出さないこと。
 *   画面へそのまま渡すだけにします。
 *   ログや解析へ流れる形にすると、
 *   メールを見ていない人でも確認を済ませられます。
 *
 * ★検索に出さないこと。
 */

import type { Metadata } from "next";
import VerifyEmailForm from "@/components/auth/VerifyEmailForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "メールアドレスのご確認",
  robots: { index: false, follow: false },
};

export default function Page({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token =
    typeof searchParams.token === "string" ? searchParams.token : "";

  return <VerifyEmailForm token={token} />;
}
