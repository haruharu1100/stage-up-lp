/**
 * お客様の「お問い合わせ」（/mypage/support）。
 *
 * ═══════════════════════════════════════════════
 * ★ここで、AIの答えを自動で出さないこと
 * ═══════════════════════════════════════════════
 *
 *   受け付けた直後に、それらしい返事を自動で出す作りは、
 *   一見すると親切です。でも、こうなります。
 *
 *       お客様「まだ届きません」
 *       自動返信「順次発送しております」
 *
 *   実際には荷物が止まっていても、この文は出ます。
 *   お客様は、答えが返ってきたと思って待ちます。
 *   そして待った分だけ、あとで怒ります。
 *
 *   ですので、この画面は「承りました」しか言いません。
 *   答えは、人が確認してから返します。
 *
 * ★本人確認はサーバーで。
 *   問い合わせ本文には、住所や電話番号が書かれます。
 */

import type { Metadata } from "next";
import { requireCustomer } from "@/lib/server/pageAuth";
import { PortalSupport } from "@/components/console/customer/Portal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "お問い合わせ",
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireCustomer("/mypage/support");
  return <PortalSupport />;
}
