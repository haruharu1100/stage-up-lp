/**
 * 台帳を通さずに残高を書き換える、ただ1つの出口。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、危ないものをわざわざ残すのか
 * ═══════════════════════════════════════════════════════
 *
 *   「台帳と残高が食い違っているとき、画面が赤く出すか」
 *   を確かめるには、食い違いを実際に作るしかありません。
 *   台帳経由でしか動かせないなら、食い違いは永遠に作れません。
 *
 *   つまり、この壊し方そのものが、点検の中身です。
 *   ですので、消すのではなく、隔離します。
 *
 * ═══════════════════════════════════════════════════════
 * ★どこまで許すか
 * ═══════════════════════════════════════════════════════
 *
 *   手元の使い捨てDB（file: で始まる接続先）でだけ動きます。
 *   Preview も 本番も、つなぎ先が file: ではないので、
 *   ここは呼ばれた瞬間に止まります。
 *
 *   ★「気をつけて使う」で済ませないこと。
 *     気をつけるのは人です。人は必ず忘れます。
 *     忘れても壊れないように、機械側で閉めます。
 *
 *   ★ここを import できるのは、試験のコードだけにすること。
 *     製品のコード（app / lib / components）から呼んだら、
 *     scripts/check-no-direct-balance-write.mjs が止めます。
 */

/**
 * 手元の使い捨てDBかどうかを確かめ、違えば止める。
 *
 * @param naze 何のために壊すのかを、日本語で1行。
 *             止まったときの画面に、そのまま出ます。
 */
export function tsukaisuteDBだけ(naze) {
  const url = String(process.env.DATABASE_URL ?? "").trim();

  /* 設定が無いときは、lib/server/db.ts が手元のファイルへ書きます。
     これは使い捨てなので、通します。 */
  const teMoto = url === "" || url.startsWith("file:");

  /* つなぎ先が file: でも、Preview／本番の名札が付いていたら止めます。
     名札と接続先の両方を見るのは、どちらか片方が
     設定し忘れでも、もう片方で止めるためです。 */
  const nafuda = String(
    process.env.DATABASE_ENV ?? process.env.VERCEL_ENV ?? "",
  ).toLowerCase();
  const honban = nafuda === "preview" || nafuda === "production";

  if (!teMoto || honban) {
    const doko = url === "" ? "（未設定＝手元のファイル）" : url;
    throw new Error(
      [
        "",
        "  ここは、手元の使い捨てDBでしか動きません。",
        "",
        `    やろうとしたこと : ${naze}`,
        `    いまのつなぎ先   : ${doko}`,
        `    いまの名札       : ${nafuda === "" ? "（無し）" : nafuda}`,
        "",
        "  台帳を通さずに残高を書き換えるので、",
        "  Preview や本番で走らせると、",
        "  「残高はあるのに、台帳にその理由が無い」人を作ります。",
        "",
        "  Preview で残高を動かしたいときは、",
        "  scripts/lib/ledger-write.mjs の movePointsViaLedger を使ってください。",
        "",
      ].join("\n"),
    );
  }
}

/**
 * 台帳を通さずに、残高だけを動かす。＝わざと食い違いを作る。
 *
 * @param db      lib/server/db.ts の db 関数
 * @param p.naze  何のために壊すのか（日本語）
 * @returns 壊す前の残高。あとで戻すのに使います。
 */
export async function breakBalanceForTest(
  db,
  { tenantId, userId, delta, naze = "台帳との食い違いを、わざと作る" },
) {
  tsukaisuteDBだけ(naze);

  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) {
    throw new Error("breakBalanceForTest：増減が 0 です");
  }

  const cu = await db().execute({
    sql: `SELECT points FROM customers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [userId, tenantId],
  });
  if (!cu.rows[0]) {
    throw new Error(`breakBalanceForTest：会員が見つかりません（${userId}）`);
  }
  const before = Number(cu.rows[0].points ?? 0);

  await db().execute({
    sql: `UPDATE customers SET points = ? WHERE id = ? AND tenant_id = ?`,
    args: [before + d, userId, tenantId],
  });

  return before;
}

/**
 * 壊す前の残高へ、そのまま戻す。
 *
 * ★戻すのを忘れないこと。
 *   食い違いを作ったまま次の点検へ進むと、
 *   そのあとの合否が全部、この食い違いのせいになります。
 */
export async function restoreBalanceForTest(
  db,
  { tenantId, userId, points, naze = "わざと作った食い違いを、元へ戻す" },
) {
  tsukaisuteDBだけ(naze);

  await db().execute({
    sql: `UPDATE customers SET points = ? WHERE id = ? AND tenant_id = ?`,
    args: [Math.trunc(Number(points)), userId, tenantId],
  });
}
