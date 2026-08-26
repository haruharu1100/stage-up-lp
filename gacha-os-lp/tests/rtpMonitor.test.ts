/**
 * 還元率3種（設計・残数・実績）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験は、絶対に消さないでください
 * ═══════════════════════════════════════════════════════
 *
 *   2026-08-26、公開環境の総点検で見つかった事故を、
 *   二度と起こさないために固定します。
 *
 *       画面の表示   88.0％
 *       実際の還元   18.23％
 *
 *   原因は「百分率（88）」と「比率（0.88）」の取り違えでした。
 *   人の目には、どちらも「88パーセント」に見えます。
 *
 *   そして、この間違いは
 *
 *       ・エラーを出さない
 *       ・画面がきれいなまま
 *       ・売上が増える方向（＝お客様への還元が減る方向）
 *
 *   という、いちばん見つかりにくい形で起きました。
 *   だから人の目に頼らず、機械に毎回見張らせます。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   ① 88 と 0.88 を取り違えない
 *   ② 分からないときに 0％ や 100％ を出さない（UNKNOWN を返す）
 *   ③ 壊れた数字を、正常な顔で表示しない（SAFE FAIL）
 *   ④ 回数が足りないときに、良し悪しを判断しない
 *   ⑤ 3種類を混ぜない
 *   ⑥ ポイントでお返しした分も、還元として数える
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  actualRtp,
  designedRtp,
  judgeRtp,
  remainingRtp,
  rtpText,
  worstAlert,
  MIN_PLAYS_FOR_JUDGEMENT,
  RTP_LABEL,
  type Rtp,
} from "../lib/console/rtp";

/** known な値だけを取り出す。known でなければ、その場で試験を落とす */
function percentOf(r: Rtp, why: string): number {
  assert.equal(r.known, true, `${why}：値が出るはずなのに UNKNOWN でした`);
  return (r as Extract<Rtp, { known: true }>).percent;
}

/* ══════════════════════════════════════════════
   ① 88 と 0.88 の取り違え（永久固定）
   ══════════════════════════════════════════════ */

test("【永久固定】88 と 0.88 を、同じ 88％ として扱う", () => {
  const price = 100;
  const total = 500;

  const hyakubunritsu = designedRtp(88, total, price); // 正しい書き方
  const hiritsu = designedRtp(0.88, total, price); // 事故のときの書き方

  assert.equal(
    percentOf(hyakubunritsu, "百分率 88"),
    88,
    "88 は 88％ でなければなりません",
  );
  assert.equal(
    percentOf(hiritsu, "比率 0.88"),
    88,
    "0.88 も 88％ として扱わなければなりません（これが 0.88％ になったのが今回の事故）",
  );

  /* ★黙って直さないこと。直したことを画面に出せるようにしておく */
  assert.equal(
    (hiritsu as { normalized?: boolean }).normalized,
    true,
    "比率で書かれていたことを normalized で知らせなければなりません",
  );
  assert.notEqual(
    (hyakubunritsu as { normalized?: boolean }).normalized,
    true,
    "正しく百分率で書かれていたのに、直したことにしてはいけません",
  );
});

test("【永久固定】88％の設計に対し、実績18.23％を必ず危険として検知する", () => {
  /* 事故のときの実際の数字。売上 50,000pt に対して、お返し 9,113pt */
  const actual = actualRtp({
    plays: 500,
    sold: 50000,
    prizeValue: 9113,
    pointValue: 0,
  });

  assert.equal(percentOf(actual, "実績"), 18.23);

  const designed = designedRtp(88, 500, 100);
  const remaining = remainingRtp({
    price: 100,
    leftCount: 0,
    stock: [{ grade: "S", value: 100, total: 1, drawn: 1 }],
  });

  const alerts = judgeRtp({ designed, remaining, actual });
  const worst = worstAlert(alerts);

  assert.equal(
    worst.level,
    "DANGER",
    "設計88％に対して実績18％なら、必ず危険として知らせなければなりません",
  );
  assert.equal(worst.code, "BELOW_DESIGN");
  assert.match(
    worst.message,
    /18\.23/,
    "実際の数字を、そのまま画面に出さなければなりません",
  );
});

/* ══════════════════════════════════════════════
   ② 境界値（0 / 0.01 / 0.88 / 1 / 18.23 / 88 / 100 / 120）
   ══════════════════════════════════════════════ */

test("【境界値】設計還元率に入りうる値を、ひとつずつ確かめる", () => {
  const price = 100;
  const total = 100;

  /* 0 は「設計値が入っていない」。0％と言い切らないこと */
  const zero = designedRtp(0, total, price);
  assert.equal(zero.known, false, "0 は UNKNOWN でなければなりません");
  assert.equal(
    zero.known === false && zero.code,
    "NO_DESIGN",
    "理由は「設計還元率が登録されていません」です",
  );

  /* 0.01 は比率とみなして 1％。
     ★0.01％ という設計は現実にはありません（1万口引いて1口ぶんしか返らない）。
       比率として読む方が、間違いが小さくなります。 */
  assert.equal(percentOf(designedRtp(0.01, total, price), "0.01"), 1);

  /* 0.88 → 88％（今回の事故） */
  assert.equal(percentOf(designedRtp(0.88, total, price), "0.88"), 88);

  /* 1 → 100％。
     ★ここは「1（比率）＝100％」と読みます。
       1％の還元率は、商品として成立しません（1万円売って100円しか返さない）。 */
  assert.equal(percentOf(designedRtp(1, total, price), "1"), 100);

  /* 18.23 → そのまま18.23％。1.5を超えているので、比率とは読まない */
  assert.equal(percentOf(designedRtp(18.23, total, price), "18.23"), 18.23);

  /* 88 → 88％ */
  assert.equal(percentOf(designedRtp(88, total, price), "88"), 88);

  /* 100 → 100％ */
  assert.equal(percentOf(designedRtp(100, total, price), "100"), 100);

  /* 120 → 120％。★勝手に100で頭打ちにしないこと。
     120％は「入力を間違えている」か「本当に赤字の企画」です。
     どちらにせよ、100に丸めて隠すと、運営の方が気づけません。 */
  assert.equal(
    percentOf(designedRtp(120, total, price), "120"),
    120,
    "100％を超える設計値を、100に丸めて隠してはいけません",
  );
});

test("【境界値】1.5 のすぐ上と下で、読み方が変わることを固定する", () => {
  /* ★ここが境目です。動かすときは、必ずこの試験も一緒に直すこと */
  assert.equal(percentOf(designedRtp(1.5, 100, 100), "1.5"), 150);
  assert.equal(percentOf(designedRtp(1.51, 100, 100), "1.51"), 1.51);
});

/* ══════════════════════════════════════════════
   ③ 分からないときに、0％や100％を出さない
   ══════════════════════════════════════════════ */

test("まだ1回も売れていないガチャは、0％ではなく UNKNOWN", () => {
  const r = actualRtp({ plays: 0, sold: 0, prizeValue: 0, pointValue: 0 });

  assert.equal(r.known, false, "0％と言い切ってはいけません");
  assert.equal(r.known === false && r.code, "NO_SALES");
  assert.equal(
    rtpText(r),
    "UNKNOWN",
    "画面には UNKNOWN と出さなければなりません（0.0% は嘘です）",
  );
});

test("完売したガチャの残数還元率は、0％ではなく UNKNOWN", () => {
  const r = remainingRtp({
    price: 500,
    leftCount: 0,
    stock: [{ grade: "S", value: 10000, total: 1, drawn: 1 }],
  });

  assert.equal(r.known, false, "完売を 0％ と表示してはいけません");
  assert.equal(r.known === false && r.code, "NO_SALES");
});

test("景品の在庫が無いときは、100％でも0％でもなく UNKNOWN", () => {
  const r = remainingRtp({ price: 500, leftCount: 100, stock: [] });

  assert.equal(r.known, false);
  assert.equal(r.known === false && r.code, "NO_PRIZE_VALUE");
  assert.equal(
    r.known === false && r.reason,
    "当選価値が取得できません。",
    "理由を、そのまま画面に出せる日本語で持たなければなりません",
  );
});

/* ══════════════════════════════════════════════
   ④ 壊れた数字を、正常な顔で出さない（SAFE FAIL）
   ══════════════════════════════════════════════ */

test("壊れた数字（NaN・マイナス・無限大）は、必ず表示を止める", () => {
  const kowareta = [
    { name: "NaN", facts: { plays: 10, sold: NaN, prizeValue: 0, pointValue: 0 } },
    {
      name: "マイナスの売上",
      facts: { plays: 10, sold: -50000, prizeValue: 100, pointValue: 0 },
    },
    {
      name: "無限大",
      facts: {
        plays: 10,
        sold: 1000,
        prizeValue: Number.POSITIVE_INFINITY,
        pointValue: 0,
      },
    },
    {
      name: "マイナスの当選価値",
      facts: { plays: 10, sold: 1000, prizeValue: -100, pointValue: 0 },
    },
  ];

  for (const k of kowareta) {
    const r = actualRtp(k.facts);
    assert.equal(r.known, false, `${k.name}：正常な顔で表示してはいけません`);
    assert.equal(r.known === false && r.code, "BROKEN_DATA", k.name);
    assert.equal(rtpText(r), "UNKNOWN", k.name);
  }
});

test("在庫が1行でも壊れていたら、残りの行だけで計算しない", () => {
  /* ★壊れた行を 0 として足すと、それらしい数字が出てしまいます。
       「それらしい数字」がいちばん危険です。 */
  const r = remainingRtp({
    price: 100,
    leftCount: 100,
    stock: [
      { grade: "S", value: 10000, total: 1, drawn: 0 },
      { grade: "A", value: NaN, total: 5, drawn: 0 },
    ],
  });

  assert.equal(r.known, false, "1行でも壊れていたら、全体を止めます");
  assert.equal(r.known === false && r.code, "BROKEN_DATA");
});

test("壊れた実績は、危険として知らせる（黙って隠さない）", () => {
  const alerts = judgeRtp({
    designed: designedRtp(90, 100, 100),
    remaining: remainingRtp({ price: 100, leftCount: 50, stock: [] }),
    actual: actualRtp({ plays: 10, sold: NaN, prizeValue: 0, pointValue: 0 }),
  });

  assert.equal(worstAlert(alerts).level, "DANGER");
});

/* ══════════════════════════════════════════════
   ⑤ 回数が足りないときは、良し悪しを言わない
   ══════════════════════════════════════════════ */

test("回数が少ないうちは「データ不足」とだけ言い、警告を出さない", () => {
  /* 10回引いて、たまたまS賞が出た。実績は 800％ になるが、これは異常ではない */
  const actual = actualRtp({
    plays: 10,
    sold: 1000,
    prizeValue: 8000,
    pointValue: 0,
  });
  assert.equal(percentOf(actual, "実績"), 800);

  const alerts = judgeRtp({
    designed: designedRtp(90, 500, 100),
    remaining: remainingRtp({
      price: 100,
      leftCount: 490,
      stock: [{ grade: "S", value: 8000, total: 5, drawn: 1 }],
    }),
    actual,
  });

  assert.equal(alerts.length, 1, "警告を並べてはいけません");
  assert.equal(alerts[0].code, "TOO_FEW_PLAYS");
  assert.equal(
    alerts[0].level,
    "INFO",
    "回数が足りないだけなのに、危険と言ってはいけません",
  );
  assert.match(alerts[0].message, new RegExp(String(MIN_PLAYS_FOR_JUDGEMENT)));
});

test("回数が足りれば、同じずれを警告する", () => {
  const actual = actualRtp({
    plays: 500,
    sold: 50000,
    prizeValue: 40000,
    pointValue: 0,
  });
  const alerts = judgeRtp({
    designed: designedRtp(90, 500, 100),
    remaining: remainingRtp({
      price: 100,
      leftCount: 0,
      stock: [{ grade: "S", value: 8000, total: 5, drawn: 5 }],
    }),
    actual,
  });

  const worst = worstAlert(alerts);
  assert.notEqual(worst.code, "TOO_FEW_PLAYS");
  assert.equal(worst.level, "WARN", "設計90％に対して実績80％は、注意です");
});

/* ══════════════════════════════════════════════
   ⑥ 3種類を混ぜない
   ══════════════════════════════════════════════ */

test("3種類は、それぞれ別の名前と別の値を持つ", () => {
  const designed = designedRtp(94.8, 500, 100);
  const remaining = remainingRtp({
    price: 100,
    leftCount: 200,
    stock: [
      { grade: "S", value: 10000, total: 2, drawn: 0 },
      { grade: "B", value: 200, total: 50, drawn: 20 },
    ],
  });
  const actual = actualRtp({
    plays: 300,
    sold: 30000,
    prizeValue: 20000,
    pointValue: 6400,
  });

  assert.equal(designed.kind, "designed");
  assert.equal(remaining.kind, "remaining");
  assert.equal(actual.kind, "actual");

  assert.equal(RTP_LABEL.designed, "設計");
  assert.equal(RTP_LABEL.remaining, "残数");
  assert.equal(RTP_LABEL.actual, "実績");

  /* 実績 26,400 ÷ 30,000 = 88.0％ */
  assert.equal(percentOf(actual, "実績"), 88);
});

test("分子と分母を、必ず一緒に返す（人が検算できるように）", () => {
  const r = actualRtp({
    plays: 500,
    sold: 500000,
    prizeValue: 400000,
    pointValue: 40120,
  });

  assert.equal(r.known, true);
  const k = r as Extract<Rtp, { known: true }>;
  assert.equal(k.denominator, 500000, "販売額");
  assert.equal(k.numerator, 440120, "実際に返した価値");
  assert.equal(k.percent, 88.02);
  assert.equal(k.plays, 500, "サンプル数も一緒に返すこと");
  assert.deepEqual(k.breakdown, { prizeValue: 400000, pointValue: 40120 });
});

/* ══════════════════════════════════════════════
   ⑦ ポイントでお返しした分も、還元として数える
   ══════════════════════════════════════════════ */

test("ポイントでお返しした分を数えないと、実績が実際より低く出る", () => {
  /* C・D賞は現物ではなくポイントで返している。これも立派な還元です */
  const kazoeta = actualRtp({
    plays: 100,
    sold: 10000,
    prizeValue: 5000,
    pointValue: 4000,
  });
  const kazoenai = actualRtp({
    plays: 100,
    sold: 10000,
    prizeValue: 5000,
    pointValue: 0,
  });

  assert.equal(percentOf(kazoeta, "ポイントも数えた"), 90);
  assert.equal(percentOf(kazoenai, "ポイントを数えない"), 50);
});

/* ══════════════════════════════════════════════
   ⑧ 残数が100％を超えたら知らせる
   ══════════════════════════════════════════════ */

test("残数還元率が100％を超えたら、売るほど損が増えると知らせる", () => {
  /* 残り10口ぶん（1,000pt）に対して、残っている景品が 2,000pt */
  const remaining = remainingRtp({
    price: 100,
    leftCount: 10,
    stock: [{ grade: "S", value: 1000, total: 2, drawn: 0 }],
  });
  assert.equal(percentOf(remaining, "残数"), 200);

  const alerts = judgeRtp({
    designed: designedRtp(90, 500, 100),
    actual: actualRtp({
      plays: 490,
      sold: 49000,
      prizeValue: 44000,
      pointValue: 0,
    }),
    remaining,
  });

  assert.ok(
    alerts.some((a) => a.code === "REMAINING_OVER_100"),
    "100％超えを見逃してはいけません",
  );
});

/* ══════════════════════════════════════════════
   ⑨ 台帳と食い違ったら、どちらかを採用して隠さない
   ══════════════════════════════════════════════ */

test("抽選の記録と集計値が食い違ったら、必ず危険として知らせる", () => {
  const alerts = judgeRtp({
    designed: designedRtp(90, 500, 100),
    remaining: remainingRtp({
      price: 100,
      leftCount: 100,
      stock: [{ grade: "S", value: 1000, total: 2, drawn: 0 }],
    }),
    actual: actualRtp({
      plays: 400,
      sold: 40000,
      prizeValue: 36000,
      pointValue: 0,
    }),
    ledgerMismatch: true,
  });

  const worst = worstAlert(alerts);
  assert.equal(worst.level, "DANGER");
  assert.equal(worst.code, "LEDGER_MISMATCH");
});

/* ══════════════════════════════════════════════
   ⑩ 正常なときは、正常と言う
   ══════════════════════════════════════════════ */

test("設計どおりに還元できていれば、警告を出さない", () => {
  const alerts = judgeRtp({
    designed: designedRtp(90, 500, 100),
    remaining: remainingRtp({
      price: 100,
      leftCount: 100,
      stock: [{ grade: "B", value: 90, total: 100, drawn: 0 }],
    }),
    actual: actualRtp({
      plays: 400,
      sold: 40000,
      prizeValue: 20000,
      pointValue: 16200,
    }),
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].code, "OK");
  assert.equal(alerts[0].level, "OK");
});
