/**
 * お店の売り場（/shop）。★ログインを求めません。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜログイン前にも棚を見せるのか
 * ═══════════════════════════════════════════════════════
 *
 *   これまで、売り場は /mypage/shop（ログインの向こう側）だけでした。
 *   つまり、このお店は
 *
 *     「何が売っているかは、会員登録してからお見せします」
 *
 *   という店でした。ふつうのオンラインガチャのお店は逆です。
 *   並んでいる物を見て、引きたいものがあってから会員になります。
 *
 *   もう1つ、こちらのほうが重い理由があります。
 *   ★お店の方が、自分の売り場を見られませんでした。
 *     管理画面から「お客様側で確認」を押しても、
 *     店長さんはお客様用のログイン画面に飛ばされていました。
 *     自分の店の棚を見るために、自分の店の会員登録が要る、
 *     という状態でした。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここから引けるようにしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   引くとポイントが減ります。減らす相手が決まっていない状態で
 *   引かせる作りは、絶対に作らないでください。
 *   この画面のボタンは「ログインして引く」だけです。
 *
 * ═══════════════════════════════════════════════════════
 * ★どのお店かは、住所からサーバーが決めます
 * ═══════════════════════════════════════════════════════
 *
 *   決まらない住所では、棚を出しません（よその店の棚が出ます）。
 *   判断は lib/server/tenantHost.ts の1か所だけです。
 *
 * ★静的に作らせないこと。残り口数は、他の方が引くたびに変わります。
 */

import type { Metadata } from "next";
import { ShopList } from "@/components/console/customer/LiveShop";
import UnknownDomain from "@/components/auth/UnknownDomain";
import { currentHost, resolveTenantByHost } from "@/lib/server/tenantHost";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "ガチャ一覧",
  /* ★検索に載せないこと。
       1つの配置＝1つのお店なので、こちらのLPと同じ入口で
       検索結果に並ぶと、お客様が迷います。 */
  robots: { index: false, follow: false },
};

export default async function Page() {
  /* ★決まらないときは、棚を出さないこと。
       よそのお店の棚が、このお店の棚として並びます。 */
  const host = currentHost();
  if ((await resolveTenantByHost(host)) === null) {
    return <UnknownDomain host={host} />;
  }
  return <ShopList guest />;
}
