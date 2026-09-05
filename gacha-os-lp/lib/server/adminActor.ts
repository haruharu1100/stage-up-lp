/**
 * 「いま操作している担当者は誰か」を作る、たった1つの場所。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、わざわざ1か所にまとめるのか
 * ═══════════════════════════════════════════════════════
 *
 *   customerActor.ts と同じ理由です。
 *   記録に残す名前を入口ごとに書いていると、いつか必ず
 *
 *       actor.name = body.operatorName
 *
 *   という行が混ざります。本文から受け取った値です。
 *   書き換えれば、他人の名前で記録を残せます。
 *
 *   ですので、身元はクッキー（門番が渡す session）からしか作りません。
 *   この関数は、本文（body）を受け取りません。受け取れません。
 *
 * ═══════════════════════════════════════════════════════
 * ★役割（role）は、門番が確定させたものを渡すこと
 * ═══════════════════════════════════════════════════════
 *
 *   役割はDBから引き直しません。門番（guard）が
 *   そのログインについて確定させた値を、そのまま書き残します。
 *   引き直すと、権限を確かめた瞬間と、記録に残した瞬間とで、
 *   違う役割が書かれることがあります。
 *
 *   ★名前は「そのとき」の名前を書き写します。
 *     担当者名はあとから変わります。記録には操作した時点の名前を残します。
 */

import { db } from "./db";
import type { Actor } from "./orders";

/**
 * クッキーで確定した担当者から、記録用の「誰が」を作る。
 *
 * @param tenantId どの店か（門番が渡した値）
 * @param userId   どの担当者か（門番が渡した値。本文からは絶対に取らない）
 * @param role     門番が確定させた役割
 */
export async function adminActor(
  tenantId: string,
  userId: string,
  role: string | null,
): Promise<Actor> {
  const r = await db().execute({
    sql: `SELECT name FROM app_users WHERE tenant_id = ? AND id = ? LIMIT 1`,
    args: [tenantId, userId],
  });

  const name = String(
    (r.rows[0] as Record<string, unknown> | undefined)?.name ?? "",
  );

  return {
    kind: "ADMIN",
    id: userId,
    name,
    /* ★null のときに、勝手に強い役割を入れないこと。
         いちばん弱い VIEWER にします。 */
    role: role ?? "VIEWER",
  };
}
