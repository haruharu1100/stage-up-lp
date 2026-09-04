/**
 * お客様の入口（/mypage）。
 *
 * ★ここも、サーバーで本人確認をしてから中身を出すこと。
 *   画面の中で「ログインしていなければ隠す」にすると、
 *   隠しただけで、データはもうブラウザへ送り終わっています。
 *
 * ★お客様のクッキーでだけ開くこと。
 *   クッキーは管理者と共通の1つです。種類を見ないと、
 *   運営者のクッキーでお客様の画面が開きます。
 */

import type { Metadata } from "next";
import { requireCustomer } from "@/lib/server/pageAuth";
import { PortalHome } from "@/components/console/customer/Portal";

/* ★静的に作らせないこと。
     静的にすると、誰に対しても同じ中身を返します。
     つまり、他人のマイページが出ます。 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "マイページ",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const auth = await requireCustomer("/mypage");
  return (
    <PortalHome
      name={auth.customer.name}
      emailVerified={auth.customer.emailVerified}
    />
  );
}
