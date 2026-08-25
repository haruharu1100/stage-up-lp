/**
 * お客様の「保有ポイント」（/mypage/points）。
 *
 * ═══════════════════════════════════════════════
 * ★残高だけの画面にしないこと
 * ═══════════════════════════════════════════════
 *
 *   「今 1,200pt です」だけを出す画面は、
 *   お客様が減りに気づいたときに、何も答えられません。
 *   問い合わせは、必ず「いつ減ったのか」から始まります。
 *
 *   ですので、この画面は1件ずつの増減と、
 *   そのときの残高を並べます。
 *   ガチャ利用・商品交換・付与・返還・調整が、時系列で追えます。
 *
 * ★本人確認は、必ずサーバーで。
 *   ポイントは、そのままお金に近いものです。
 *   ブラウザへ送ってから隠すのでは、隠したことになりません。
 */

import type { Metadata } from "next";
import { requireCustomer } from "@/lib/server/pageAuth";
import { PortalPoints } from "@/components/console/customer/Portal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "保有ポイント",
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireCustomer("/mypage/points");
  return <PortalPoints />;
}
