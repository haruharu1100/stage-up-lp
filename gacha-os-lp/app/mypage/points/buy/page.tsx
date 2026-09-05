/**
 * お客様の「ポイントを購入する」（/mypage/points/buy）。
 *
 * ═══════════════════════════════════════════════
 * ★1画面1URLにする理由（ここは特に大事です）
 * ═══════════════════════════════════════════════
 *
 *   購入は、途中で止まることがあります。
 *   「支払いの途中で電波が切れた」「途中で閉じた」。
 *   そのとき、お客様はもう一度この住所を開きます。
 *
 *   タブの中に隠れていると、開き直せません。
 *   問い合わせでも「どの画面ですか」が通じません。
 *
 * ★本人確認は、必ずサーバーで。
 *   ここは、お金を払う入口です。
 *   ログインしていない方をここへ通してはいけません。
 */

import type { Metadata } from "next";
import { Suspense } from "react";
import { requireCustomer } from "@/lib/server/pageAuth";
import { PortalPointBuy } from "@/components/console/customer/PointBuy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "ポイントを購入する",
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireCustomer("/mypage/points/buy");
  /* ★useSearchParams を使う画面は、Suspense で包むこと。
       包まないと、ビルド時に「静的に書き出せません」で止まります。 */
  return (
    <Suspense fallback={null}>
      <PortalPointBuy />
    </Suspense>
  );
}
