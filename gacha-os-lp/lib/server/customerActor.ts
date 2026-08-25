/**
 * 「いま操作しているお客様は誰か」を作る、たった1つの場所。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、わざわざ1か所にまとめるのか
 * ═══════════════════════════════════════════════════════
 *
 *   記録（監査ログ）に残す名前を、入口ごとに書いていると、
 *   いつか必ず、こういう行が混ざります。
 *
 *       actor.id = body.userId
 *
 *   本文から受け取った値です。書き換えれば、他人の名前で
 *   記録を残せます。あとから記録を読んでも、
 *   誰がやったのか分からなくなります。
 *
 *   だから、身元はクッキー（門番が渡す session）からしか作りません。
 *   この関数は、本文（body）を受け取りません。受け取れません。
 *
 * ═══════════════════════════════════════════════════════
 * ★名前は「そのとき」の名前を書き写します
 * ═══════════════════════════════════════════════════════
 *
 *   会員名は、あとから変わることがあります。
 *   記録には、操作した時点の名前をそのまま残します。
 *   いま引いてきて、そのまま渡すのは、そのためです。
 */

import { db } from "./db";
import type { Actor } from "./orders";

/**
 * クッキーで確定した本人から、記録用の「誰が」を作る。
 *
 * @param tenantId どの店か（門番が渡した値）
 * @param userId   どのお客様か（門番が渡した値。本文からは絶対に取らない）
 */
export async function customerActor(
  tenantId: string,
  userId: string,
): Promise<Actor> {
  const r = await db().execute({
    sql: `SELECT name FROM customers WHERE tenant_id = ? AND id = ? LIMIT 1`,
    args: [tenantId, userId],
  });

  const name = String(
    (r.rows[0] as Record<string, unknown> | undefined)?.name ?? "",
  );

  return {
    kind: "CUSTOMER",
    id: userId,
    name,
    /* ★お客様の役割は、常にこれ1つ。
         ここに管理側の役割名が入る余地を作らないこと。 */
    role: "CUSTOMER",
  };
}
