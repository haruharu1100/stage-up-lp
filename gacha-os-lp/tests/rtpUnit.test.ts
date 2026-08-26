/**
 * 「画面に出ている還元率」と「実際に返る額」が、ずれていないかの試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験を足したのか
 * ═══════════════════════════════════════════════════════
 *
 *   2026-08-26、公開環境の総点検で見つかりました。
 *
 *       画面の表示   設計還元率 88.0％
 *       実際の数字   18.2％
 *
 *   500回引いた記録が残っていたので、割り算するだけで分かりました。
 *   売上 50,000pt に対して、お返しした合計は 9,113pt でした。
 *
 *   ★原因は、たった1文字です。
 *
 *       データ側が書いた値   0.88
 *       計算側が待っていた値  88
 *
 *   人の目には、どちらも「88パーセント」に見えます。
 *   計算する側は 0.88％ として読みました。
 *
 *   D賞（ポイントでお返しする等級）は 1pt になりました。
 *   S賞からC賞までは、値段の下限である100円に貼りつきました。
 *
 * ═══════════════════════════════════════════════════════
 * ★どちらへ倒れたかが、いちばん大事なところ
 * ═══════════════════════════════════════════════════════
 *
 *   この不具合は「お客様に返す額が減る」方向でした。
 *   画面はきれいなまま、エラーも出ませんでした。
 *   だから、誰も気づきませんでした。
 *
 *   ★売上が増える方向の間違いは、見つかりにくいものです。
 *     ここは、機械に毎回見張らせます。
 *
 *   （もし逆向きだったら、赤字が出ていたはずなので、
 *     いずれ気づけました。返す額が減る方は、気づけません。）
 */

import test from "node:test";
import assert from "node:assert/strict";
import { poolOf, normalizeRtp } from "../lib/console/draw";

/**
 * この箱を最後まで引き切ったら、いくら返ることになるか。
 *
 * ★はずれの札（景品の入っていない口）は、この計算に入れません。
 *   spec.ts は、D賞で残りの口を全部埋める作りなので、
 *   本数の合計は、口数とぴったり同じになります。
 */
function hakoNoKangen(
  title: string,
  price: number,
  total: number,
  rtp: number,
): number {
  const pool = poolOf(title, price, total, rtp);
  const kaesu = pool.reduce((a, p) => a + p.count * p.value, 0);
  return (kaesu / (price * total)) * 100;
}

test("還元率を「％」で書いたとき、そのとおりの額が返る", () => {
  for (const [price, total, rtp] of [
    [100, 500, 88],
    [500, 300, 92],
    [3_000, 120, 95],
    [300, 2_000, 95],
  ] as const) {
    const jissai = hakoNoKangen("試験用ガチャ", price, total, rtp);
    assert.ok(
      Math.abs(jissai - rtp) <= 3,
      `設計 ${rtp}％ のはずが、実際は ${jissai.toFixed(1)}％ しか返りません` +
        `（${price}円 × ${total}口）`,
    );
  }
});

test("★還元率を「比率」で書き間違えても、返す額が減らない", () => {
  /**
   * ★これが本番で起きた形そのものです。
   *   0.88 と書いてあっても、88％として扱えていること。
   */
  const machigai = hakoNoKangen("試験用ガチャ", 100, 500, 0.88);
  const tadashii = hakoNoKangen("試験用ガチャ", 100, 500, 88);

  assert.ok(
    Math.abs(machigai - tadashii) < 0.01,
    `0.88 と 88 で、返る額が違います（${machigai.toFixed(1)}％ と ${tadashii.toFixed(1)}％）`,
  );
  assert.ok(
    machigai > 80,
    `0.88 と書いたら ${machigai.toFixed(1)}％ しか返りませんでした。` +
      "画面には88％と出ます。表示と食い違います",
  );
});

test("単位をそろえる規則が、思ったとおりに働く", () => {
  assert.equal(normalizeRtp(88), 88, "％で書いた値を、動かしてはいけません");
  assert.equal(normalizeRtp(0.88), 88, "比率で書いた値を、％に直せていません");
  assert.equal(normalizeRtp(1.5), 150, "1.5以下は比率として扱う決まりです");
  assert.equal(normalizeRtp(0), 95, "0のときは、既定の95％にします");
  assert.equal(normalizeRtp(Number.NaN), 95, "数でないときも、既定の95％です");
});

test("★どの値段・口数でも、返す額が設計を大きく下回らない", () => {
  /**
   * ★安い1回・多い口数の組み合わせで、100円単位の丸めが効いてきます。
   *   spec.ts はD賞で端数を吸収する作りになっているので、
   *   その仕組みが効いているかを、まとめて確かめます。
   */
  const warui: string[] = [];
  for (const price of [100, 300, 500, 1_000, 3_000, 10_000]) {
    for (const total of [50, 120, 500, 1_000, 5_000]) {
      const jissai = hakoNoKangen("試験用ガチャ", price, total, 95);
      if (jissai < 92 || jissai > 98) {
        warui.push(`${price}円×${total}口 → ${jissai.toFixed(1)}％`);
      }
    }
  }
  assert.equal(
    warui.length,
    0,
    "設計95％から3％以上ずれる組み合わせがあります：\n  " + warui.join("\n  "),
  );
});
