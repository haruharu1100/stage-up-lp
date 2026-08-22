/**
 * 「1日、運営してみる」を、機械に最後まで通させる。
 *
 * ═══════════════════════════════════════════════
 * ★このテストが守るもの
 * ═══════════════════════════════════════════════
 *
 *   案内の文章だけが残って、途中の手順が実際には終われない、
 *   という壊れ方がいちばん困ります。
 *   お見せしている最中に「押しても進まない」が起きるからです。
 *
 *   だから、画面を通さず、操作だけを順番に流して、
 *   12手順が全部ちゃんと終わることを毎回確かめます。
 *
 * ★手順を1つ足したら、ここも必ず通らなくなること。
 *   通ってしまう作りにすると、見張りとして意味がありません。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_ADMINS,
  PREVIEW_USER_ID,
  initialState,
  pointsReconcile,
  reducer,
  type ConsoleAction,
  type ConsoleState,
} from "../lib/console/state";
import {
  DAY_STEPS,
  currentStep,
  daySnapshot,
  doneCount,
  isDone,
} from "../lib/console/dayInLife";

/** 見るだけの手順。画面を開いたことにする */
const VISIT = new Set(
  DAY_STEPS.filter((x) => x.visitOnly).map((x) => x.id),
);

/**
 * この1日で作る、新しいガチャ。
 *
 * ★景品を入れずに作らないこと。
 *   景品0本のガチャは、計算上は売上が丸ごと粗利なので
 *   数字としては安全に見えます。安全なのではなく、
 *   入力が終わっていないだけです。検証も判定を書きません。
 *   ★実在の商品名・ブランド名は書きません。全部、架空です。
 */
const NEW_GACHA: ConsoleAction = {
  type: "CREATE_GACHA",
  title: "1日体験ガチャ（テスト用）",
  spec: {
    name: "1日体験ガチャ（テスト用）",
    price: 1_000,
    total: 300,
    /* ★景品の値段を、売上より高くしないこと。
       1,000円 × 300口 ＝ 300,000円 に対して、
       景品の合計が 270,000円（設計還元率 90%）になるようにしてあります。
       これを超えると検証が DANGER になり、公開の関門で止まります。
       止まるのが正しい動きなので、テストの側を現実的な構成に直します */
    prizes: [
      { grade: "S賞", name: "架空の最上位カード", count: 1, value: 18_000 },
      { grade: "A賞", name: "架空の上位カード", count: 6, value: 5_000 },
      { grade: "B賞", name: "架空の中位カード", count: 40, value: 1_500 },
      { grade: "C賞", name: "架空の下位カード", count: 253, value: 640 },
    ],
  },
};

test("1日の12手順を、順番どおり全部やり切れる", () => {
  let s = initialState();
  const base = daySnapshot(s);
  const seen = new Set<string>();

  const at = () => currentStep(s, base, seen);
  const step = (n: number) => DAY_STEPS[n];

  /* ── 始めた時点では、1つも終わっていない ──
     見本データに発送も問い合わせも入っているので、
     ここが 0 でなければ、控えの取り方が間違っています */
  assert.equal(doneCount(s, base, seen), 0, "始めた時点で、もう終わっている手順がある");
  assert.equal(at(), 0);

  /* ① 9:00 ダッシュボード（見るだけ） */
  assert.equal(step(0).id, "morning");
  s = reducer(s, { type: "LOGIN", adminId: DEMO_ADMINS[0].id });
  s = reducer(s, { type: "MFA_OK" });
  seen.add("morning");
  assert.equal(at(), 1, "①が終わっていない");

  /* ② 9:05 AIオペレーター（見るだけ） */
  seen.add("operator");
  assert.equal(at(), 2, "②が終わっていない");

  /* ③ 9:15 相場ウォッチ（見るだけ） */
  seen.add("market");
  assert.equal(at(), 3, "③が終わっていない");

  /* ④ 9:30 怪しい登録を判定する（実際に動かす） */
  const sg = s.signups.find((x) => !x.handled);
  assert.ok(sg, "判定していない登録が、見本データに1件も無い");
  s = reducer(s, { type: "FRAUD_HANDLE", signupId: sg!.id, decision: "REVIEW" });
  assert.equal(at(), 4, "④が終わっていない");

  /* ⑤ 10:00 ガチャを作る */
  s = reducer(s, NEW_GACHA);
  assert.equal(s.gachas.length, base.gachas + 1, "ガチャが増えていない");
  const g = s.gachas[s.gachas.length - 1];
  assert.equal(g.status, "DRAFT", "作った直後に下書き以外になっている");
  assert.equal(at(), 5, "⑤が終わっていない");

  /* ⑥ 10:20 公開前バックテスト */
  s = reducer(s, { type: "RUN_BACKTEST", gachaId: g.id });
  assert.notEqual(
    s.gachas[s.gachas.length - 1].backtest,
    null,
    "検証しても判定が入っていない（景品の入力が足りていない可能性）",
  );
  assert.equal(at(), 6, "⑥が終わっていない");

  /* ⑦ 10:40 公開する */
  s = reducer(s, { type: "PUBLISH_GACHA", gachaId: g.id });
  assert.equal(
    s.gachas[s.gachas.length - 1].status,
    "PUBLISHED",
    "公開できていない",
  );
  assert.equal(at(), 7, "⑦が終わっていない");

  /* ⑧ 11:00 お客様として引く
     ★「当たったか」で判定しないこと。
       ポイントでお返しする等級も、はずれもあります。
       当たりを条件にすると、はずれた方は
       ちゃんと引いたのに案内が止まります */
  s = reducer(s, { type: "CUSTOMER_LOGIN", userId: PREVIEW_USER_ID });
  s = reducer(s, { type: "DRAW", gachaId: g.id, key: "day-draw" });
  assert.equal(s.draws.length, base.draws + 1, "引いた記録が残っていない");
  assert.equal(s.draws[s.draws.length - 1].userId, PREVIEW_USER_ID, "引いた本人の記録になっていない");
  assert.equal(at(), 8, "⑧が終わっていない");

  /* ⑨ 11:10 お客様として発送を依頼する
     ★受取方法をまだ選んでいない、本人の商品から選ぶこと。
       いま引いて当たったものでも、前から持っているものでも構いません */
  const won = s.prizes.find(
    (p) => p.userId === PREVIEW_USER_ID && p.status === "UNCHOSEN",
  );
  assert.ok(won, "受取方法を選んでいない商品が、本人の手元に1件も無い");
  s = reducer(s, { type: "PRIZE_SHIP_REQUEST", prizeId: won!.id, key: "day-ship" });
  assert.equal(
    s.prizes.find((p) => p.id === won!.id)?.status,
    "SHIP_REQUESTED",
    "発送を依頼しても、状態が変わっていない",
  );
  assert.equal(at(), 9, "⑨が終わっていない");

  /* ⑩ 11:20 お客様として質問する */
  s = reducer(s, { type: "USER_ASK", text: "発送はいつになりますか", key: "day-ask" });
  assert.equal(s.tickets.length, base.tickets + 1, "問い合わせが増えていない");
  assert.equal(at(), 10, "⑩が終わっていない");

  /* ⑪ 13:00 運営に戻って発送する
     ★お客様の依頼から立った伝票を処理すること。
       もともと入っていた伝票を処理しても数は増えますが、
       それでは「つながっている」ことの証明になりません */
  const order = s.orders.find(
    (o) => o.id === s.prizes.find((p) => p.id === won!.id)?.orderId,
  );
  assert.ok(order, "お客様の発送依頼から、伝票が立っていない");
  s = reducer(s, { type: "SHIP", orderId: order!.id });
  assert.equal(at(), 11, "⑪が終わっていない");

  /* ⑫ 17:00 売上を見る（見るだけ） */
  seen.add("close");

  /* ── 1日、回りきった ── */
  assert.equal(
    doneCount(s, base, seen),
    DAY_STEPS.length,
    "終わっていない手順が残っている",
  );
  assert.equal(at(), DAY_STEPS.length);

  /* ★最後に必ず帳尻を見ること。
     手順が全部終わっても、ポイントが合っていなければ意味がありません */
  assert.equal(pointsReconcile(s).every((r) => r.ok), true, "残高と履歴がずれている");
});

test("何もしていない状態で、勝手に手順が終わっていない", () => {
  const s = initialState();
  const base = daySnapshot(s);
  const seen = new Set<string>();

  for (const st of DAY_STEPS) {
    assert.equal(
      isDone(st, s, base, seen),
      false,
      `${st.time} ${st.title} が、何もしていないのに終わっている`,
    );
  }
});

test("見るだけの手順は、開いたときだけ終わる", () => {
  const s = initialState();
  const base = daySnapshot(s);

  for (const st of DAY_STEPS.filter((x) => x.visitOnly)) {
    assert.equal(isDone(st, s, base, new Set()), false);
    assert.equal(isDone(st, s, base, new Set([st.id])), true);
  }
});

test("操作が要る手順を、画面を開いただけで終わらせていない", () => {
  /* ★ここが緩むと、案内が一気に嘘になります。
     「押すだけで進むツアー」と何も変わらなくなるからです */
  const s = initialState();
  const base = daySnapshot(s);
  const all = new Set(DAY_STEPS.map((x) => x.id));

  for (const st of DAY_STEPS.filter((x) => !x.visitOnly)) {
    assert.equal(
      isDone(st, s, base, all),
      false,
      `${st.time} ${st.title} が、開いただけで終わってしまう`,
    );
  }
});

test("見るだけの手順は、案内の全体の半分を超えない", () => {
  /* 見るだけばかりの案内は、結局スライドショーです */
  assert.ok(
    VISIT.size * 2 <= DAY_STEPS.length,
    `見るだけの手順が多すぎます（${VISIT.size} / ${DAY_STEPS.length}）`,
  );
});

test("全部の手順に、なぜそうするのかが書いてある", () => {
  for (const st of DAY_STEPS) {
    assert.ok(st.why.length >= 20, `${st.id}：「なぜ」が短すぎる`);
    assert.ok(st.lead.length >= 20, `${st.id}：「何をするか」が短すぎる`);
    assert.ok(st.hint.length > 0, `${st.id}：押す場所の案内が無い`);
  }
});

test("運営側の手順には、行き先の画面が必ず指定されている", () => {
  for (const st of DAY_STEPS) {
    if (st.side !== "admin") continue;
    assert.ok(st.page, `${st.id}：管理サイトの手順なのに、行き先が無い`);
  }
});

test("デモを最初に戻すと、1日もやり直せる", () => {
  /* 項目37：ワンクリックで元に戻ること。
     戻らないと、2人目にお見せするときに前の人の跡が残ります */
  let s = initialState();
  s = reducer(s, { type: "LOGIN", adminId: DEMO_ADMINS[0].id });
  s = reducer(s, { type: "MFA_OK" });
  s = reducer(s, NEW_GACHA);
  assert.notEqual(s.gachas.length, initialState().gachas.length);

  const back = reducer(s, { type: "RESET" });
  const base = daySnapshot(back);
  assert.equal(doneCount(back, base, new Set()), 0, "戻したのに手順が終わったまま");
  assert.equal(back.gachas.length, initialState().gachas.length, "作ったガチャが残っている");
});

/** 型の見張り。ConsoleState を使わない書き方に変わったら気づけるように */
const _typecheck: (s: ConsoleState) => number = (s) =>
  doneCount(s, daySnapshot(s), new Set());
void _typecheck;
