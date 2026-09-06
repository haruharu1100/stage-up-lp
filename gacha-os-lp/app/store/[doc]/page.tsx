/**
 * お店の法定・信頼ページ（/store/company ほか6つ）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここだけ、ログインを求めません
 * ═══════════════════════════════════════════════════════
 *
 *   特定商取引法に基づく表記・利用規約・プライバシーポリシーは、
 *   「まだ会員になっていない人」が読むためのものです。
 *   /mypage の下に置いてログインを求めたら、
 *   置いていないのと同じです。
 *
 * ═══════════════════════════════════════════════════════
 * ★app/legal（こちらの会社の分）と混ぜないこと
 * ═══════════════════════════════════════════════════════
 *
 *   app/legal は AI GACHA OS 運営会社のページです。
 *   /store の下は、導入した「お店」のページです。
 *   同じ場所に置くと、いつか片方がもう片方として表示されます。
 *
 * ★検索に載せないこと（noindex）。
 *   1つの配置＝1つのお店なので、こちらのLPと同じ入口で
 *   検索結果に並ぶと、お客様が迷います。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { CustomerShell } from "@/components/console/customer/Chrome";
import { StoreDocView } from "@/components/console/customer/StoreDoc";
/* ★ここを "@/lib/console/shopInfo" に戻さないこと。
     あちらは "use client"（ブラウザの中で動く道具です）の札が付いています。
     サーバー側で作るこの画面が、そこから isShopDoc を借りると
     本物の関数になりません。この4ページが 500 で落ちます。 */
import { SHOP_DOC_LABEL, isShopDoc } from "@/lib/console/shopDocs";
import { readSession, SESSION_COOKIE } from "@/lib/server/session";
import {
  getPublicShopInfo,
  resolvePublicTenantId,
  type PublicShopInfo,
} from "@/lib/server/publicShop";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export function generateMetadata({
  params,
}: {
  params: { doc: string };
}): Metadata {
  const label = isShopDoc(params.doc) ? SHOP_DOC_LABEL[params.doc] : "お店の情報";
  return { title: label, robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: { doc: string } }) {
  /* ★知らない名前を、黙って会社情報に丸めないこと。
       /store/anything が会社情報として開くと、
       どこからリンクされたのか分からないページが増えます。 */
  if (!isShopDoc(params.doc)) notFound();

  /* ログインしていれば、その方のお店。していなければ設定から決めます。
     ★読めなくても、ここで落とさないこと。
       規約が読めない画面になります。 */
  let sessionTenantId: string | null = null;
  try {
    const s = await readSession(cookies().get(SESSION_COOKIE)?.value);
    if (s !== null && s.subjectKind === "CUSTOMER") sessionTenantId = s.tenantId;
  } catch {
    sessionTenantId = null;
  }

  let shop: PublicShopInfo | null = null;
  try {
    const tenantId = await resolvePublicTenantId(sessionTenantId);
    /* ★決まらなかったときに「1社目」を拾わないこと。
         よその会社の法人名・住所・電話が、
         このお店の特商法ページとして表示されます。 */
    if (tenantId !== null) shop = await getPublicShopInfo(tenantId);
  } catch {
    shop = null;
  }

  return (
    <CustomerShell>
      <StoreDocView doc={params.doc} shop={shop} />
    </CustomerShell>
  );
}
