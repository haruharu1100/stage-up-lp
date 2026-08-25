/**
 * お客様の「獲得商品」（/mypage/prizes）。
 *
 * ═══════════════════════════════════════════════
 * ★この画面は、お金が動きます
 * ═══════════════════════════════════════════════
 *
 *   当たった商品は「送らせる権利」であり、
 *   同時に「ポイントに換えられる権利」でもあります。
 *   つまり、この画面のボタンは、そのまま資産を動かします。
 *
 *   ですので、本人確認はサーバーでやります。
 *   画面の中で「ログインしていなければ隠す」にすると、
 *   隠しただけで、当選内容はもうブラウザへ送り終わっています。
 *
 * ★静的に作らせないこと。
 *   静的にすると、誰に対しても同じ中身を返します。
 *   つまり、他人の当選商品が出ます。
 */

import type { Metadata } from "next";
import { requireCustomer } from "@/lib/server/pageAuth";
import { PortalPrizes } from "@/components/console/customer/Portal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "獲得商品",
  /* ★検索に載せないこと。
       マイページの中身が検索結果に出ると、
       ログインしていない人の目にも触れます。 */
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireCustomer("/mypage/prizes");
  return <PortalPrizes />;
}
