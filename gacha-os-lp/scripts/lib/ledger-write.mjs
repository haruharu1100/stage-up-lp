/**
 * 点検・仕込み用の道具が、ポイントを動かすときの唯一の入口。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、こんなものが必要なのか
 * ═══════════════════════════════════════════════════════
 *
 *   本番のコードだけを安全にしても、足りませんでした。
 *
 *   点検用の道具（scripts/audit-preview.mjs など）が、
 *   台帳を通さずに
 *
 *       UPDATE customers SET points = ...
 *
 *   と書いて残高を直接動かしていました。
 *   その結果、Preview のお客様のうち何名かが
 *   「残高はあるのに、台帳にその理由が無い」状態になりました。
 *
 *   これは、帳簿として最も危ない壊れ方です。
 *   あとから見ても、そのポイントがどこから来たのか誰にも分かりません。
 *
 *   そして厄介なことに、壊したのは点検の道具なので、
 *   製品側をいくら直しても、走らせるたびに増えていきます。
 *
 * ═══════════════════════════════════════════════════════
 * ★だから、こう決めます
 * ═══════════════════════════════════════════════════════
 *
 *   1) 道具がポイントを動かすときは、必ずここを通すこと。
 *      台帳に1行足し、そのうえで残高を同じだけ動かします。
 *      2つは1つの取引にまとめるので、片方だけ残ることがありません。
 *
 *   2) 残高を直接書き換える SQL を、道具の中に書かないこと。
 *      書いたら scripts/check-no-direct-balance-write.mjs が止めます。
 *
 *   3) それでもどうしても直接書き換えたい場合は、
 *      隣の fixtures-danger.mjs を使うこと。
 *      あちらは、手元の使い捨てDBでしか動きません。
 */

/**
 * 台帳に1行足して、残高を同じだけ動かす。
 *
 * @param db        lib/server/db.ts の db 関数
 * @param p.tenantId  会社
 * @param p.userId    お客様
 * @param p.delta     増減（＋も−も可。0 は受け付けない）
 * @param p.kind      台帳の種別（例：SEED / TEST_TOPUP）
 * @param p.memo      あとから読んで意味が分かる言葉
 * @param p.ref       関係する番号があれば
 * @returns 動かしたあとの残高
 *
 * ★残高を負にしないこと。
 *   負を許すと、次に引いたときの判定が全部おかしくなります。
 */
export async function movePointsViaLedger(
  db,
  { tenantId, userId, delta, kind = "TEST_TOPUP", memo = "点検のための調整", ref = null },
) {
  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) {
    throw new Error("movePointsViaLedger：増減が 0 です");
  }

  const tx = await db().transaction("write");
  try {
    const cu = await tx.execute({
      sql: `SELECT points FROM customers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [userId, tenantId],
    });
    if (!cu.rows[0]) {
      throw new Error(`movePointsViaLedger：会員が見つかりません（${userId}）`);
    }
    const before = Number(cu.rows[0].points ?? 0);
    const after = before + d;
    if (after < 0) {
      throw new Error(
        `movePointsViaLedger：残高が負になります（いま ${before}pt に ${d}pt）`,
      );
    }

    const at = new Date().toISOString();
    const id = `pl_${at.replace(/\D/g, "")}_${Math.random().toString(36).slice(2, 10)}`;

    await tx.execute({
      sql: `INSERT INTO point_ledger
              (id, tenant_id, user_id, kind, delta, memo, ref, created_at)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [id, tenantId, userId, kind, d, memo, ref, at],
    });
    await tx.execute({
      sql: `UPDATE customers SET points = ? WHERE id = ? AND tenant_id = ?`,
      args: [after, userId, tenantId],
    });

    await tx.commit();
    return after;
  } catch (e) {
    await tx.rollback().catch(() => null);
    throw e;
  }
}

/**
 * 「この残高にしておきたい」を、台帳経由で叶える。
 *
 * ★便利に見えますが、これは差額を1行足しているだけです。
 *   「今いくらでも構わないから、とにかく 3000pt にする」という
 *   考え方そのものが、帳簿では危ない考え方です。
 *   使うのは、仕込み（seed）のときだけにしてください。
 */
export async function setPointsViaLedger(
  db,
  { tenantId, userId, points, kind = "SEED", memo = "見本データの仕込み" },
) {
  const cu = await db().execute({
    sql: `SELECT points FROM customers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [userId, tenantId],
  });
  if (!cu.rows[0]) {
    throw new Error(`setPointsViaLedger：会員が見つかりません（${userId}）`);
  }
  const before = Number(cu.rows[0].points ?? 0);
  const d = Math.trunc(Number(points)) - before;
  if (d === 0) return before;
  return movePointsViaLedger(db, { tenantId, userId, delta: d, kind, memo });
}
