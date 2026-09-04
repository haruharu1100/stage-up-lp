/**
 * お客様がガチャを引く場所（/mypage/shop）。
 *
 * ★ここも、サーバーで本人確認をしてから中身を出すこと。
 *   画面の中で隠す作りにすると、隠しただけで
 *   データはもうブラウザへ送り終わっています。
 *
 * ★静的に作らせないこと。
 *   残り口数は、他の方が引くたびに変わります。
 *   作り置きした画面を配ると、「残り1口」と書いてある画面で
 *   売り切れが起きます。
 */

import type { Metadata } from "next";
import { requireCustomer } from "@/lib/server/pageAuth";
import { ShopList } from "@/components/console/customer/LiveShop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "ガチャを引く",
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireCustomer("/mypage/shop");
  return <ShopList />;
}
