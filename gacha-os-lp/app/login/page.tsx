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
import { currentHost, resolveTenantByHost } from "@/lib/server/tenantHost";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ログイン｜AI GACHA OS",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next = safeReturnTo(searchParams.next);

  /* ═══ どのお店へのログインか ═══
     ★お客様に「会社コード」を打たせないこと（2026-09-07）。
       開いている住所から、サーバー側で決めます。

     ★ここで、お客様向けにお断り画面を出さないこと。
       ログイン画面は、お店の担当者も使います。
       住所からお店が決まらない配置（社内共通の管理用アドレス）でも、
       担当者は会社コードを打って入る必要があります。
       その欄は、担当者を選んだときだけ出ます（LoginForm 側）。 */
  const needTenantCode = (await resolveTenantByHost(currentHost())) === null;

  return (
    <LoginForm
      next={next}
      needTenantCode={needTenantCode}
      demoMode={demoAllowed()}
    />
  );
}
