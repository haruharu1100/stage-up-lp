/**
 * ガチャ1本の中身と、引くところ（/mypage/shop/[id]）。
 *
 * ★公開していないガチャは、ここでも開かないこと。
 *   判断は lib/server/shop.ts に1つだけ置いてあります。
 *   この画面は、読めたものだけを出します。
 *
 * ★引く処理を、この画面で書かないこと。
 *   ポイントが実際に減るのは /api/console/draw だけです。
 */

import type { Metadata } from "next";
import { requireCustomer } from "@/lib/server/pageAuth";
import { ShopDetailScreen } from "@/components/console/customer/LiveShop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "ガチャを引く",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: { id: string } }) {
  await requireCustomer(`/mypage/shop/${params.id}`);
  return <ShopDetailScreen gachaId={params.id} />;
}
