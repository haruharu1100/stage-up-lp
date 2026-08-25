/**
 * ログイン画面（/login）。
 *
 * ═══════════════════════════════════════════════════════
 * ★戻り先は、ここで安全な形にしてから渡すこと
 * ═══════════════════════════════════════════════════════
 *
 *   /login?next=/client-demo/shipping
 *
 *   next はURLに書いてあります。つまり、誰でも書き換えられます。
 *   受け取ったまま画面へ渡すと、
 *   ログインした直後に、外の偽サイトへ送ることができてしまいます。
 *
 *   だから、画面へ渡す前に lib/returnTo.ts で確かめます。
 *   ここと画面の両方で確かめますが、判断のもとは1か所だけです。
 *
 * ★検索に出さないこと。
 *   ログイン画面が検索に出ても、良いことは1つもありません。
 */

import type { Metadata } from "next";
import LoginForm from "@/components/auth/LoginForm";
import { demoAllowed } from "@/lib/server/demo";
import { safeReturnTo } from "@/lib/returnTo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ログイン｜AI GACHA OS",
  robots: { index: false, follow: false },
};

export default function Page({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next = safeReturnTo(searchParams.next);

  /* ★会社コードの欄は、必要なときだけ出すこと。
       1社しか入らない環境で毎回コードを打たせるのは、
       毎朝の手間を増やすだけです。 */
  const needTenantCode = !process.env.DEFAULT_TENANT_CODE;

  return (
    <LoginForm
      next={next}
      needTenantCode={needTenantCode}
      demoMode={demoAllowed()}
    />
  );
}
