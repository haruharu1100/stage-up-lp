/**
 * ガチャ1本の中身（/shop/[id]）。★ログインを求めません。
 *
 * ★ここから引けるようにしないこと。
 *   引くとポイントが減ります。減らす相手（お客様）が
 *   決まっていない状態で引かせる作りは、絶対に作らないでください。
 *   ボタンは「ログインして引く」だけです。
 *
 * ★公開していないガチャは、ここでも開かないこと。
 *   判断は lib/server/shop.ts に1つだけ置いてあります。
 *   この画面は、読めたものだけを出します。
 *
 * ★どのお店かは、住所からサーバーが決めます（lib/server/tenantHost.ts）。
 *   ガチャIDだけで引き当てないこと。よそのお店の中身が読めます。
 */

import type { Metadata } from "next";
import { ShopDetailScreen } from "@/components/console/customer/LiveShop";
import UnknownDomain from "@/components/auth/UnknownDomain";
import { currentHost, resolveTenantByHost } from "@/lib/server/tenantHost";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "ガチャの内容",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: { id: string } }) {
  const host = currentHost();
  if ((await resolveTenantByHost(host)) === null) {
    return <UnknownDomain host={host} />;
  }
  return <ShopDetailScreen gachaId={params.id} guest />;
}
