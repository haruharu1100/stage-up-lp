/**
 * 契約者向け管理画面（CLIENT CONSOLE）の、中身のテスト。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ機械で確かめるのか
 * ═══════════════════════════════════════════════
 *
 * この管理画面で、お客様（契約者）に見せたいことは3つあります。
 *
 *   ① 監査ログは、後から1行だけこっそり直せない
 *   ② 不正判定は、1つの手がかりだけで人を止めない
 *   ③ 高額なポイント操作は、1人では通せない
 *
 * どれも「そう作ったつもり」では意味がありません。
 * 画面の見た目を直すたびに壊れていないかを、目で見て確かめるのは無理です。
 * だから、ここで機械に見張らせます。
 *
 * ★特に ① は、ここが通らないなら
 *   「改ざんを検知します」と書くこと自体が嘘になります。
 *   このテストは、販売資料の正しさを守るためのものでもあります。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { sha256 } from "../lib/console/hash";
import {
  GENESIS,
  appendAudit,
  hashEntry,
  verifyAudit,
  type AuditEntry,
} from "../lib/console/audit";
import { SIGNALS, assess, THRESHOLD, type Hit, type SignalKey } from "../lib/console/fraud";
import {
  BACKTEST_SEED,
  DEMO_ADMINS,
  FOUR_EYES_THRESHOLD,
  can,
  canApprove,
  initialState,
  reducer,
  todayTodos,
  type ConsoleState,
  type PointRequest,
} from "../lib/console/state";
import { buildSpec } from "../lib/console/spec";
import { backtestReport, designedRtp } from "../lib/backtest";

/* ══════════════════════════════════════════════
   ① SHA-256 が、本物と同じ値を出すか
   ══════════════════════════════════════════════

   自前で書いた同期版のハッシュです。
   ここがズレていると、監査ログの検証は「動いているように見えて何も見ていない」
   状態になります。Node が持っている本物と、1文字ずつ突き合わせます。
*/

const real = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

test("SHA-256：仕様書の既知の答えと一致する", () => {
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    sha256(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("SHA-256：日本語・絵文字・長文でも Node の本物と一致する", () => {
  const samples = [
    "a",
    "運営 太郎",
    "ポイントを +100,000pt 変更（理由：お詫び）",
    "🎁🎰 当選しました",
    "混在 mixed 文字列 123 🎉 あいうえお",
    "x".repeat(55),   // ブロック境界の手前
    "x".repeat(56),   // ちょうど境界
    "x".repeat(57),   // 境界の直後（2ブロックになる）
    "あ".repeat(200), // 複数ブロック
  ];
  for (const s of samples) {
    assert.equal(sha256(s), real(s), `一致しない入力: ${s.slice(0, 20)}`);
  }
});

/* ══════════════════════════════════════════════
   ② 監査ログ：正しい鎖は PASS になるか
   ══════════════════════════════════════════════ */

function chainOf3(): AuditEntry[] {
  let log: AuditEntry[] = [];
  log = appendAudit(log, {
    at: "2026-08-22 12:00", actorId: "ad_01", actorName: "運営 太郎", actorRole: "SUPER_ADMIN",
    action: "LOGIN", target: "ad_01", summary: "ログイン",
  });
  log = appendAudit(log, {
    at: "2026-08-22 12:01", actorId: "ad_01", actorName: "運営 太郎", actorRole: "SUPER_ADMIN",
    action: "POINT_ADJUST_APPLY", target: "u_8842", summary: "会員 8842 のポイントを +500pt 変更",
    before: "12,500pt", after: "13,000pt", reason: "お詫び",
  });
  log = appendAudit(log, {
    at: "2026-08-22 12:02", actorId: "ad_01", actorName: "運営 太郎", actorRole: "SUPER_ADMIN",
    action: "GACHA_PUBLISH", target: "g_104", summary: "ガチャを公開",
  });
  return log;
}

test("監査ログ：素直に積んだ鎖は検証を通る", () => {
  const log = chainOf3();
  assert.equal(log.length, 3);
  assert.equal(log[0].prevHash, GENESIS);
  assert.equal(log[1].prevHash, log[0].hash);
  assert.equal(log[2].prevHash, log[1].hash);

  const r = verifyAudit(log);
  assert.equal(r.ok, true);
  assert.equal(r.checked, 3);
});

test("監査ログ：通し番号は1から順に振られる", () => {
  const log = chainOf3();
  assert.deepEqual(log.map((e) => e.seq), [1, 2, 3]);
});

test("監査ログ：ハッシュは自分自身を含めずに計算されている", () => {
  /* うっかり entry ごと JSON.stringify すると hash を含んで計算してしまい、
     絶対に一致しなくなる。その事故が起きていないことを確かめる */
  const log = chainOf3();
  for (const e of log) {
    const { hash, ...rest } = e;
    assert.equal(hashEntry(rest), hash);
  }
});

/* ══════════════════════════════════════════════
   ③ 監査ログ：改ざんを本当に見つけられるか
   ══════════════════════════════════════════════

   ここが、この管理画面でいちばん大事なテストです。
*/

test("改ざん検知：真ん中の1件の中身を書き換えると HASH_MISMATCH", () => {
  const log = chainOf3();
  const broken = log.map((e) =>
    e.seq === 2 ? { ...e, after: "999,999,999pt" } : e,
  );
  const r = verifyAudit(broken);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.why, "HASH_MISMATCH");
  assert.equal(r.brokenAt, 2);
});

test("改ざん検知：理由（reason）だけを書き換えても見つかる", () => {
  const log = chainOf3();
  const broken = log.map((e) =>
    e.seq === 2 ? { ...e, reason: "システム調整" } : e,
  );
  const r = verifyAudit(broken);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.why, "HASH_MISMATCH");
});

test("改ざん検知：1件まるごと消すと SEQ_BROKEN", () => {
  const log = chainOf3();
  const broken = log.filter((e) => e.seq !== 2);
  const r = verifyAudit(broken);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.why, "SEQ_BROKEN");
});

test("改ざん検知：別の記録を差し込むと CHAIN_BROKEN", () => {
  const log = chainOf3();
  /* 通し番号だけ辻褄を合わせて、2番目に偽の記録を差し込む */
  const fake: AuditEntry = { ...log[1], summary: "差し込まれた記録" };
  const withHash: AuditEntry = {
    ...fake,
    hash: hashEntry((({ hash: _h, ...rest }) => rest)(fake)),
  };
  const broken = [log[0], withHash, { ...log[2], seq: 3 }];
  const r = verifyAudit(broken);
  assert.equal(r.ok, false);
  if (r.ok) return;
  /* 差し込んだ記録自体は自己整合しているが、次の記録がつながらなくなる */
  assert.equal(r.why, "CHAIN_BROKEN");
  assert.equal(r.brokenAt, 3);
});

test("改ざん検知：区切り文字を悪用した「同じ文字列」は作れない", () => {
  /* 項目を「|」で区切っていたら、reason に「A|B」と書くだけで
     別の内容なのに同じ計算結果になる組み合わせが作れてしまう。
     画面から入力できない制御文字を使っているので、それができないことを確かめる */
  const base = {
    at: "2026-08-22 12:00", actorId: "ad_01", actorName: "運営 太郎", actorRole: "SUPER_ADMIN",
    action: "POINT_ADJUST_APPLY" as const, target: "u_1", summary: "s",
    prevHash: GENESIS, seq: 1,
  };
  const a = hashEntry({ ...base, before: "1|2", after: "3" });
  const b = hashEntry({ ...base, before: "1", after: "2|3" });
  assert.notEqual(a, b);
});

test("改ざん検知：空の監査ログは PASS（まだ何も起きていない）", () => {
  const r = verifyAudit([]);
  assert.equal(r.ok, true);
  assert.equal(r.checked, 0);
});

/* ══════════════════════════════════════════════
   ④ 不正判定：1つの手がかりだけで人を止めないか
   ══════════════════════════════════════════════ */

const hit = (key: SignalKey, detail = "テスト"): Hit => ({
  key, label: SIGNALS[key].label, weight: SIGNALS[key].weight, detail,
});

test("不正判定：手がかりゼロなら通す", () => {
  const r = assess([]);
  assert.equal(r.level, "LOW");
  assert.equal(r.action, "ALLOW");
  assert.equal(r.score, 0);
});

test("不正判定：VPN だけでは止めない（普通に使っている人が大勢いる）", () => {
  const r = assess([hit("anonymizer", "VPN経由")]);
  assert.equal(r.level, "LOW");
  assert.equal(r.action, "ALLOW");
});

test("不正判定：手がかりが2つだけなら、登録は止めない（最大でも人が確認する）", () => {
  /* 点数の付け方をあとから強くしても、
     手がかり2つで人を締め出す状態にはならないこと */
  const r = assess([hit("paymentReuse"), hit("referralRing")]);
  assert.notEqual(r.level, "BLOCK");
  assert.notEqual(r.action, "DENY");
});

test("不正判定：点数を上げても、手がかり2つでは BLOCK にならない", () => {
  /* 誰かが点数だけを大きくしたときに備えた蓋が、実際に働くか */
  const heavy: Hit[] = [
    { ...hit("paymentReuse"), weight: 90 },
    { ...hit("referralRing"), weight: 90 },
  ];
  const r = assess(heavy);
  assert.equal(r.score, 100);
  assert.equal(r.level, "HIGH", "点数だけで登録を止めてしまっている");
  assert.equal(r.action, "REVIEW");
  assert.ok(r.cappedBy, "なぜ下げたのかの説明が必要");
});

test("不正判定：単独の手がかりは、必ずその上限までに収まる", () => {
  for (const key of Object.keys(SIGNALS) as SignalKey[]) {
    const def = SIGNALS[key];
    const r = assess([hit(key)]);
    const order = ["LOW", "MEDIUM", "HIGH", "BLOCK"];
    assert.ok(
      order.indexOf(r.level) <= order.indexOf(def.solo),
      `${key} が単独で ${r.level} になっている（上限 ${def.solo}）`,
    );
    /* そして、単独で BLOCK になる手がかりは1つも無いこと */
    assert.notEqual(r.level, "BLOCK", `${key} が単独で BLOCK になっている`);
  }
});

test("不正判定：手がかりが重なると、ちゃんと強くなる", () => {
  const r = assess([
    hit("ipBurst", "同一IPから17アカウント"),
    hit("deviceReuse", "同じ端末から6アカウント"),
    hit("signupSpeed", "入力から送信まで 0.4秒"),
    hit("smsRetry", "SMS再送 12回"),
  ]);
  assert.ok(r.score >= THRESHOLD.BLOCK, `点数が足りない: ${r.score}`);
  assert.equal(r.level, "BLOCK");
  assert.equal(r.action, "DENY");
  assert.equal(r.cappedBy, undefined);
});

test("不正判定：どの判定にも、必ず人が読める説明が付く", () => {
  const cases = [
    assess([]),
    assess([hit("anonymizer")]),
    assess([hit("ipBurst"), hit("deviceReuse")]),
    assess([hit("ipBurst"), hit("deviceReuse"), hit("phoneReuse"), hit("paymentReuse")]),
  ];
  for (const r of cases) {
    assert.ok(r.explain.length > 0, "説明が空");
    for (const h of r.hits) {
      assert.ok(h.detail.length > 0, "観測した中身が空（理由を見せられない）");
      assert.ok(h.label.length > 0, "名前が空");
    }
  }
});

test("不正判定：BLOCK でも、取り返しがつくことを必ず書く", () => {
  /* AIだけで永久BANを確定させないこと。
     運営者が解除できると、その場の文言で伝わっている必要があります */
  const r = assess([
    hit("referralRing"), hit("phoneReuse"), hit("paymentReuse"),
  ]);
  assert.equal(r.level, "BLOCK");
  assert.ok(!/永久BAN|永久追放|二度と/.test(r.explain), "取り返しのつかない言い方をしている");
  assert.ok(r.explain.includes("永久停止ではありません"), "永久ではないと書いていない");
  assert.ok(r.explain.includes("解除"), "運営者が解除できると書いていない");
});

test("不正判定：点数は100を超えない（画面の目盛りが壊れないため）", () => {
  const all = (Object.keys(SIGNALS) as SignalKey[]).map((k) => hit(k));
  assert.ok(assess(all).score <= 100);
});

/* ══════════════════════════════════════════════
   ⑤ 権限：見えるだけの人が、お金を動かせないか
   ══════════════════════════════════════════════ */

test("権限：閲覧のみの人は、ポイントもガチャ公開も触れない", () => {
  assert.equal(can("VIEWER", "point.request"), false);
  assert.equal(can("VIEWER", "point.approve"), false);
  assert.equal(can("VIEWER", "gacha.publish"), false);
  assert.equal(can("VIEWER", "user.suspend"), false);
});

test("権限：サポートは返信できるが、ポイントは動かせない", () => {
  assert.equal(can("SUPPORT", "support.reply"), true);
  assert.equal(can("SUPPORT", "point.request"), false);
  assert.equal(can("SUPPORT", "point.approve"), false);
});

/* ══════════════════════════════════════════════
   ⑥ 二人承認：1人で高額ポイントを作れないか
   ══════════════════════════════════════════════

   ここが抜けると、全権管理者が1人で好きなだけポイントを作れます。
*/

const admin = (id: string) => DEMO_ADMINS.find((a) => a.id === id)!;

const pendingReq = (requestedBy: string, delta = FOUR_EYES_THRESHOLD): PointRequest => ({
  id: "pr_1", userId: "u_8842", userName: "会員 8842",
  delta, reason: "システム障害のお詫び",
  requestedBy, requestedByName: "申請者",
  requestedAt: "2026-08-22 12:00",
  status: "PENDING", needsApproval: true, balanceBefore: 12_500,
});

test("二人承認：自分の申請は、自分では承認できない", () => {
  const req = pendingReq("ad_01");
  const r = canApprove(req, admin("ad_01"));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.why.length > 0, "断る理由が空");
});

test("二人承認：全権管理者であっても、自分の申請は承認できない", () => {
  const me = admin("ad_01");
  assert.equal(me.role, "SUPER_ADMIN");
  assert.equal(canApprove(pendingReq(me.id), me).ok, false);
});

test("二人承認：別の管理者なら承認できる", () => {
  const r = canApprove(pendingReq("ad_03"), admin("ad_01"));
  assert.equal(r.ok, true);
});

test("二人承認：承認の権限が無い人は承認できない", () => {
  const r = canApprove(pendingReq("ad_03"), admin("ad_04")); // サポート
  assert.equal(r.ok, false);
});

test("二人承認：処理済みの申請は、もう一度承認できない", () => {
  const req = { ...pendingReq("ad_03"), status: "APPLIED" as const };
  assert.equal(canApprove(req, admin("ad_01")).ok, false);
});

/* ══════════════════════════════════════════════
   ⑦ 画面の操作：仕組みとして止まるか
   ══════════════════════════════════════════════ */

function loggedIn(adminId = "ad_01"): ConsoleState {
  let s = reducer(initialState(), { type: "LOGIN", adminId });
  s = reducer(s, { type: "MFA_OK" });
  return s;
}

/**
 * その時点の、会員の残高。
 *
 * ★残高の数字を、テストに直接書かないこと。
 *   デモの見本データを作り直すと、初期残高は変わります。
 *   数字を書いてしまうと、そのたびにテストが赤くなり、
 *   「またテストが壊れた」と思って直さなくなります。
 *   見たいのは「いくらだったか」ではなく「いくら動いたか」です。
 */
const pt = (s: ConsoleState, id = "u_8842") => s.users.find((u) => u.id === id)!.points;

test("操作：バックテスト未実施のガチャは公開できない", () => {
  const s = loggedIn();
  const before = s.gachas.find((g) => g.id === "g_105")!;
  assert.equal(before.backtest, null);
  const after = reducer(s, { type: "PUBLISH_GACHA", gachaId: "g_105" });
  assert.equal(after.gachas.find((g) => g.id === "g_105")!.status, "DRAFT");
  assert.equal(after.flash?.kind, "error");
});

test("操作：検証済みのガチャは公開でき、監査ログに残る", () => {
  const s = loggedIn();
  const after = reducer(s, { type: "PUBLISH_GACHA", gachaId: "g_104" });
  assert.equal(after.gachas.find((g) => g.id === "g_104")!.status, "PUBLISHED");
  const last = after.audit[after.audit.length - 1];
  assert.equal(last.action, "GACHA_PUBLISH");
  assert.equal(verifyAudit(after.audit).ok, true);
});

test("操作：理由を書かないポイント変更は、そもそも受け付けない", () => {
  const s = loggedIn();
  const before = pt(s);
  const after = reducer(s, { type: "POINT_REQUEST", userId: "u_8842", delta: 500, reason: "   " });
  assert.equal(after.flash?.kind, "error");
  assert.equal(pt(after), before, "理由が無いのに残高が動いた");
  assert.equal(after.pointRequests.length, 0);
});

test("操作：閾値未満のポイント変更は、その場で反映されて記録が残る", () => {
  const s = loggedIn();
  const before = pt(s);
  const after = reducer(s, { type: "POINT_REQUEST", userId: "u_8842", delta: 500, reason: "お詫び" });
  assert.equal(pt(after), before + 500);
  assert.equal(after.pointRequests[0].status, "APPLIED");
  assert.equal(verifyAudit(after.audit).ok, true);
});

test("操作：高額なポイント変更は、承認されるまで1ptも動かない", () => {
  const s = loggedIn();
  const before = pt(s);
  const after = reducer(s, {
    type: "POINT_REQUEST", userId: "u_8842",
    delta: FOUR_EYES_THRESHOLD, reason: "システム障害のお詫び",
  });
  assert.equal(pt(after), before, "承認前に反映されている");
  assert.equal(after.pointRequests[0].status, "PENDING");
});

test("操作：高額申請を、申請した本人が承認しても反映されない", () => {
  let s = loggedIn("ad_01");
  const before = pt(s);
  s = reducer(s, {
    type: "POINT_REQUEST", userId: "u_8842",
    delta: FOUR_EYES_THRESHOLD, reason: "システム障害のお詫び",
  });
  const after = reducer(s, { type: "POINT_APPROVE", requestId: s.pointRequests[0].id });
  assert.equal(pt(after), before);
  assert.equal(after.pointRequests[0].status, "PENDING");
  assert.equal(after.flash?.kind, "error");
});

test("操作：別の管理者が承認すると反映され、監査ログが両方に残る", () => {
  let s = loggedIn("ad_02"); // 経理（申請する側）
  const before = pt(s);
  s = reducer(s, {
    type: "POINT_REQUEST", userId: "u_8842",
    delta: FOUR_EYES_THRESHOLD, reason: "システム障害のお詫び",
  });
  assert.equal(s.pointRequests.length, 1, "申請が作られていない");
  s = reducer(s, { type: "SWITCH_ADMIN", adminId: "ad_01" }); // 管理者（承認する側）
  const after = reducer(s, { type: "POINT_APPROVE", requestId: "pr_1" });

  assert.equal(pt(after), before + FOUR_EYES_THRESHOLD);
  assert.equal(after.pointRequests[0].status, "APPLIED");
  assert.equal(after.pointRequests[0].approvedBy, "ad_01");

  const kinds = after.audit.map((e) => e.action);
  assert.ok(kinds.includes("POINT_ADJUST_REQUEST"));
  assert.ok(kinds.includes("POINT_ADJUST_APPROVE"));
  assert.equal(verifyAudit(after.audit).ok, true);
});

test("操作：申請できない役割は、そもそもポイントを動かせない", () => {
  /* 運営（OPERATOR）はガチャは公開できるが、お金には触れない */
  const s = loggedIn("ad_03");
  const before = pt(s);
  const after = reducer(s, { type: "POINT_REQUEST", userId: "u_8842", delta: 500, reason: "お詫び" });
  assert.equal(after.flash?.kind, "error");
  assert.equal(pt(after), before);
});

test("操作：承認できる人が他にいなければ、高額の申請を受け付けない", () => {
  /* 誰も承認できない申請が「承認待ち」のまま残り続けるのを防ぐ。
     止まっていることに気づきにくい、いちばん困る壊れ方 */
  const base = loggedIn("ad_01");
  const alone: ConsoleState = {
    ...base,
    admins: base.admins.filter((x) => x.id === "ad_01"), // 承認できるのは自分だけ
  };
  const after = reducer(alone, {
    type: "POINT_REQUEST", userId: "u_8842",
    delta: FOUR_EYES_THRESHOLD, reason: "システム障害のお詫び",
  });
  assert.equal(after.flash?.kind, "error");
  assert.equal(after.pointRequests.length, 0, "誰も承認できない申請を作ってしまっている");
  assert.ok(after.flash!.text.includes("もう1人"), "どうすれば直るかを伝えていない");
});

test("承認できる管理者が、デモに2人以上いる", () => {
  /* 1人しかいないと、二人承認を実際に試せない */
  const s = initialState();
  const approvers = DEMO_ADMINS.filter((a) => can(a.role, "point.approve"));
  assert.ok(approvers.length >= 2, `承認できる人が ${approvers.length} 人しかいない`);
  assert.equal(s.admins.length, DEMO_ADMINS.length);
});

test("操作：不正判定の処理は、判定理由ごと監査ログに残る", () => {
  const s = loggedIn("ad_01");
  const after = reducer(s, { type: "FRAUD_HANDLE", signupId: "s_03", decision: "REVIEW" });
  const last = after.audit[after.audit.length - 1];
  assert.equal(last.action, "FRAUD_REVIEW");
  assert.ok(last.reason && last.reason.length > 0, "なぜ止めたのかが残っていない");
  assert.ok(last.reason!.includes("同一IP"), "観測した中身が残っていない");
});

test("操作：サポート担当は、不正判定を処理できない", () => {
  const s = loggedIn("ad_04");
  const after = reducer(s, { type: "FRAUD_HANDLE", signupId: "s_03", decision: "DENY" });
  assert.equal(after.flash?.kind, "error");
  assert.equal(after.signups.find((x) => x.id === "s_03")!.handled, false);
});

/* ══════════════════════════════════════════════
   ⑧ デモ専用の「攻撃ボタン」が、本当に検知されるか
   ══════════════════════════════════════════════ */

test("実演：監査ログを1件書き換えると、検証が TAMPER を報告する", () => {
  let s = loggedIn();
  s = reducer(s, { type: "PUBLISH_GACHA", gachaId: "g_104" });
  s = reducer(s, { type: "POINT_REQUEST", userId: "u_8842", delta: 500, reason: "お詫び" });
  assert.equal(verifyAudit(s.audit).ok, true, "書き換える前は通るはず");

  const attacked = reducer(s, { type: "TAMPER_AUDIT", seq: 2 });
  assert.equal(attacked.audit.length, s.audit.length, "件数は変わらない（見た目では気づけない）");

  const r = verifyAudit(attacked.audit);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.brokenAt, 2);
  assert.equal(r.why, "HASH_MISMATCH");
  assert.ok(r.detail.length > 0);
});

/* ══════════════════════════════════════════════
   ⑨ ダッシュボード：今日やることが、本当に出るか
   ══════════════════════════════════════════════ */

test("今日やること：初期状態で、確認必須の用件が出る", () => {
  const s = initialState();
  const todos = todayTodos(s);
  assert.ok(todos.length > 0);
  assert.ok(todos.some((t) => t.urgency === "MUST"), "確認必須が1件も出ていない");
  for (const t of todos) {
    assert.ok(t.count > 0, "0件の用件を出している");
    assert.ok(t.to.length > 0, "押しても行き先がない");
  }
});

test("今日やること：処理すると、その用件は消える", () => {
  let s = loggedIn("ad_01");
  const before = todayTodos(s).find((t) => t.to === "fraud" && t.urgency === "MUST");
  assert.ok(before, "不正登録の用件が出ていない");

  for (const sg of s.signups) {
    s = reducer(s, { type: "FRAUD_HANDLE", signupId: sg.id, decision: "REVIEW" });
  }
  const after = todayTodos(s).find((t) => t.to === "fraud");
  assert.equal(after, undefined, "処理したのに用件が残っている");
});

test("デモを初期状態に戻せる（何度でもやり直せる）", () => {
  let s = loggedIn("ad_01");
  const start = pt(s);
  s = reducer(s, { type: "POINT_REQUEST", userId: "u_8842", delta: 500, reason: "お詫び" });
  assert.equal(pt(s), start + 500, "そもそも動いていない");
  const back = reducer(s, { type: "RESET" });
  assert.equal(pt(back), start, "初期状態に戻っていない");
  assert.equal(back.pointRequests.length, 0);
  assert.equal(back.me?.id, "ad_01", "ログインまで切れると使いにくい");
  assert.equal(verifyAudit(back.audit).ok, true);
});

/* ══════════════════════════════════════════════
   ⑩ 作る → 検証する → 公開する、が一本につながっているか
   ══════════════════════════════════════════════

   ここが通らないと、BUILDER は「案を見せるだけの画面」になります。
   そして何より、検証を飛ばして公開できてしまわないかを見張ります。
   公開前バックテストは、この商品でいちばん高く売っている部分です。
   仕組みとして飛ばせるなら、資料に書いていること自体が嘘になります。
*/

/** 検証用の、まともな構成（500円 × 1,000口 ／ 目標95%） */
const sampleSpec = () => buildSpec("新しい案", 500, 1000, 1, 95);

test("作成：登録した時点では、検証結果が空である", () => {
  const s = loggedIn("ad_01");
  const after = reducer(s, { type: "CREATE_GACHA", title: "テスト用ガチャ", spec: sampleSpec() });
  const g = after.gachas.find((x) => x.title === "テスト用ガチャ");
  assert.ok(g, "登録されていない");
  assert.equal(g!.backtest, null, "登録しただけで検証済みになっている（公開の関門が無意味になる）");
  assert.equal(g!.status, "DRAFT");
  assert.equal(g!.left, g!.total, "1本も引いていないのに残数が減っている");
  assert.equal(after.audit[after.audit.length - 1].action, "GACHA_CREATE");
});

test("作成：登録した直後は、まだ公開できない", () => {
  let s = loggedIn("ad_01");
  s = reducer(s, { type: "CREATE_GACHA", title: "テスト用ガチャ", spec: sampleSpec() });
  const id = s.gachas.find((x) => x.title === "テスト用ガチャ")!.id;
  const after = reducer(s, { type: "PUBLISH_GACHA", gachaId: id });
  assert.equal(after.gachas.find((x) => x.id === id)!.status, "DRAFT");
  assert.equal(after.flash?.kind, "error");
});

test("作成：設計還元率は、目標値ではなく組み上がった構成から出す", () => {
  let s = loggedIn("ad_01");
  const spec = sampleSpec();
  s = reducer(s, { type: "CREATE_GACHA", title: "テスト用ガチャ", spec });
  const g = s.gachas.find((x) => x.title === "テスト用ガチャ")!;
  assert.equal(g.designedRtp, Math.round(designedRtp(spec) * 10) / 10);
});

test("作成：同じ名前は登録できない", () => {
  let s = loggedIn("ad_01");
  s = reducer(s, { type: "CREATE_GACHA", title: "テスト用ガチャ", spec: sampleSpec() });
  const n = s.gachas.length;
  const after = reducer(s, { type: "CREATE_GACHA", title: "テスト用ガチャ", spec: sampleSpec() });
  assert.equal(after.gachas.length, n, "同じ名前が2本できている");
  assert.equal(after.flash?.kind, "error");
});

test("作成：サポート担当は、ガチャを登録できない", () => {
  const s = loggedIn("ad_04");
  const after = reducer(s, { type: "CREATE_GACHA", title: "テスト用ガチャ", spec: sampleSpec() });
  assert.equal(after.gachas.length, s.gachas.length);
  assert.equal(after.flash?.kind, "error");
});

test("検証：実行すると、エンジンの判定がそのまま書き戻る", () => {
  let s = loggedIn("ad_01");
  s = reducer(s, { type: "CREATE_GACHA", title: "テスト用ガチャ", spec: sampleSpec() });
  const id = s.gachas.find((x) => x.title === "テスト用ガチャ")!.id;

  const after = reducer(s, { type: "RUN_BACKTEST", gachaId: id });
  const g = after.gachas.find((x) => x.id === id)!;

  /* ★「検証したことにする」ではなく、実際に回した結果と一致すること */
  const expected = backtestReport(sampleSpec(), BACKTEST_SEED, "");
  assert.equal(g.backtest, expected.overall);
  assert.notEqual(g.backtest, null);

  const last = after.audit[after.audit.length - 1];
  assert.equal(last.action, "BACKTEST_RUN");
  assert.equal(last.before, "未実施");
  assert.ok(last.after && last.after.includes("【設計】"), "何を判定したのかが残っていない");
});

test("検証：同じ内容なら、何度実行しても同じ判定になる", () => {
  let s = loggedIn("ad_01");
  s = reducer(s, { type: "CREATE_GACHA", title: "テスト用ガチャ", spec: sampleSpec() });
  const id = s.gachas.find((x) => x.title === "テスト用ガチャ")!.id;

  const a = reducer(s, { type: "RUN_BACKTEST", gachaId: id });
  const b = reducer(a, { type: "RUN_BACKTEST", gachaId: id });
  assert.equal(
    a.gachas.find((x) => x.id === id)!.backtest,
    b.gachas.find((x) => x.id === id)!.backtest,
    "押すたびに判定が変わると、都合のよい結果が出るまで押される",
  );
});

test("検証：入力が足りないときは、判定を書き込まない", () => {
  let s = loggedIn("ad_01");
  /* 景品が1本も無い構成。計算上は売上が丸ごと粗利になるので、数字は「安全」に見える */
  s = reducer(s, {
    type: "CREATE_GACHA",
    title: "景品なしガチャ",
    spec: { name: "景品なしガチャ", price: 500, total: 1000, prizes: [] },
  });
  const id = s.gachas.find((x) => x.title === "景品なしガチャ")!.id;

  const after = reducer(s, { type: "RUN_BACKTEST", gachaId: id });
  assert.equal(
    after.gachas.find((x) => x.id === id)!.backtest,
    null,
    "判定できないものを判定済みにしている（公開の関門をすり抜ける）",
  );
  assert.equal(after.flash?.kind, "warn");

  /* そのまま公開しようとしても、当然止まる */
  const pub = reducer(after, { type: "PUBLISH_GACHA", gachaId: id });
  assert.equal(pub.gachas.find((x) => x.id === id)!.status, "DRAFT");
});

test("検証：サポート担当は、検証を実行できない", () => {
  const s = loggedIn("ad_04");
  const after = reducer(s, { type: "RUN_BACKTEST", gachaId: "g_105" });
  assert.equal(after.gachas.find((x) => x.id === "g_105")!.backtest, null);
  assert.equal(after.flash?.kind, "error");
});

test("一本通し：作る → 検証する → 公開する、が最後までつながる", () => {
  let s = loggedIn("ad_01");
  s = reducer(s, { type: "CREATE_GACHA", title: "通しテスト", spec: sampleSpec() });
  const id = s.gachas.find((x) => x.title === "通しテスト")!.id;

  s = reducer(s, { type: "RUN_BACKTEST", gachaId: id });
  const verdict = s.gachas.find((x) => x.id === id)!.backtest;
  assert.notEqual(verdict, null, "検証が実行できていない");
  assert.notEqual(verdict, "DANGER", "まともな構成が DANGER になっている（AIが通らない案しか出せない）");

  s = reducer(s, { type: "PUBLISH_GACHA", gachaId: id });
  assert.equal(s.gachas.find((x) => x.id === id)!.status, "PUBLISHED");

  /* 監査ログは、作成 → 検証 → 公開 の順で3件そろい、改ざん検知も通る */
  const actions = s.audit.map((e) => e.action);
  assert.deepEqual(actions.slice(-3), ["GACHA_CREATE", "BACKTEST_RUN", "GACHA_PUBLISH"]);
  assert.equal(verifyAudit(s.audit).ok, true);
});
