/**
 * 会員登録の画面（/signup）。
 *
 * ★検索に出さないこと。
 *   登録画面が検索に出ても、良いことは1つもありません。
 *   出すのは、店舗のトップと、ログイン画面からの導線です。
 */

import type { Metadata } from "next";
import SignupForm from "@/components/auth/SignupForm";
import { demoAllowed } from "@/lib/server/demo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "新規会員登録",
  robots: { index: false, follow: false },
};

export default function Page() {
  /* ★会社コードの欄は、必要なときだけ出すこと。
       1社しか入らない環境で毎回コードを打たせるのは、
       登録をやめる理由を1つ増やすだけです。 */
  const needTenantCode = !process.env.DEFAULT_TENANT_CODE;

  return <SignupForm needTenantCode={needTenantCode} demoMode={demoAllowed()} />;
}
