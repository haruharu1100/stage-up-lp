/**
 * お客様の「発送状況」（/mypage/shipping）。
 *
 * ═══════════════════════════════════════════════
 * ★この住所が、④の答え合わせの場所です
 * ═══════════════════════════════════════════════
 *
 *   運営者は「3点のうち2点を出した」と言えます。
 *   では、お客様の画面にそれが出ているか。
 *
 *   出ていなければ、分割発送は
 *   「社内では分かれているが、お客様には伝わっていない」状態です。
 *   お客様から見れば、注文が半分行方不明になっただけです。
 *
 *   だから、ここを本当に開いて確かめます。
 */

import type { Metadata } from "next";
import { requireCustomer } from "@/lib/server/pageAuth";
import { PortalShipping } from "@/components/console/customer/Portal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "発送状況",
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireCustomer("/mypage/shipping");
  return <PortalShipping />;
}
