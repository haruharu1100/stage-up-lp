/**
 * 管理画面の入口（/client-demo）。
 *
 * ═══════════════════════════════════════════════
 * ★ここは、もう画面を持ちません
 * ═══════════════════════════════════════════════
 *
 *   21画面それぞれが、自分のURLを持つようになりました。
 *
 *       /client-demo/dashboard
 *       /client-demo/shipping
 *       /client-demo/support …
 *
 *   このURLは、ダッシュボードへ送るだけにします。
 *
 * ★このURLを消さないこと。
 *   すでにお伝えしてあるURLです。消すと、
 *   お渡ししたリンクが全部切れます。
 *   中身を移したあとも、入口は残して案内し続けます。
 *
 * ═══════════════════════════════════════════════
 * ★/demo との違い
 * ═══════════════════════════════════════════════
 *
 *   /demo         … 販売LPに付いている「さわれるデモ」。
 *                   短い時間で「何ができるか」を見ていただくためのもの。
 *
 *   /client-demo  … ご契約後に、毎日この画面で運営していただくことを
 *                   想定した管理画面そのもの。データだけ架空にしています。
 */

import { redirect } from "next/navigation";
import { CONSOLE_BASE, SLUG } from "@/components/console/menu";

export default function Page() {
  redirect(`${CONSOLE_BASE}/${SLUG.dashboard}`);
}
