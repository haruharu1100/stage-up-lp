/**
 * 会員登録の画面（/signup）。
 *
 * ★検索に出さないこと。
 *   登録画面が検索に出ても、良いことは1つもありません。
 *   出すのは、店舗のトップと、ログイン画面からの導線です。
 */

import type { Metadata } from "next";
import SignupForm from "@/components/auth/SignupForm";
import UnknownDomain from "@/components/auth/UnknownDomain";
import { demoAllowed } from "@/lib/server/demo";
import { currentHost, resolveTenantByHost } from "@/lib/server/tenantHost";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "新規会員登録",
  robots: { index: false, follow: false },
};

export default async function Page() {
  /* ═══ どのお店の登録画面か ═══
     ★お客様に「会社コード」を打たせないこと（2026-09-07）。
       開いている住所から、サーバー側で決めます。

     ★決まらないときは、登録の入口そのものを出さないこと。
       出すと「送信 → お断り」になり、
       お客様には、なぜ断られたのかが分かりません。
       それ以前に、決まらないまま登録を通すと、
       よそのお店の会員名簿に人が増えます。 */
  const host = currentHost();
  const here = await resolveTenantByHost(host);
  if (!here) return <UnknownDomain host={host} />;

  return <SignupForm needTenantCode={false} demoMode={demoAllowed()} />;
}
