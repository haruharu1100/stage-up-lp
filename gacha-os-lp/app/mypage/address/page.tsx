/**
 * お客様の「お届け先」（/mypage/address）。
 *
 * ═══════════════════════════════════════════════
 * ★住所の書き換えは、乗っ取りの仕上げの一歩手前です
 * ═══════════════════════════════════════════════
 *
 *   乗っ取りは、ほぼ必ずこの順番で進みます。
 *
 *       ① 見慣れない端末からログインする
 *       ② お届け先を自分の住所へ書き換える
 *       ③ 高いものを発送させる
 *
 *   ②と③の間が、いちばん短い。
 *   ですので、この画面には2つの決まりがあります。
 *
 *   1つめ。すでに確定した荷物の宛先は、ここでは動きません。
 *   動く作りにすると、1回書き換えるだけで、
 *   まだ出していない箱の宛先が全部その人の家になります。
 *
 *   2つめ。将来の追加の本人確認（Step-up）を入れる場所を、
 *   1か所だけ用意してあります（lib/server/stepUpPolicy.ts）。
 *   いまはまだつないでいません。つないでいないことも、
 *   画面に正直に書いています。
 */

import type { Metadata } from "next";
import { requireCustomer } from "@/lib/server/pageAuth";
import { PortalAddress } from "@/components/console/customer/Portal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "お届け先",
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireCustomer("/mypage/address");
  return <PortalAddress />;
}
