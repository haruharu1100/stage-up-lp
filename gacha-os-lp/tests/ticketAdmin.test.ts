/**
 * 問い合わせ（管理側）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   2026-08-27 まで、管理画面の問い合わせは
 *   ブラウザの中だけの見本データでした。
 *   画面の中の控えに返信しても、お客様には何も届きません。
 *   運営者から見ると、返信ボタンは押せて、
 *   一覧は「対応中」に変わるので、届いたように見えます。
 *
 *   いまは support_tickets / ticket_messages を正本にしました。
 *   この試験は、そこへ戻されていないかを見張ります。
 *
 *   ① AIに答えさせてはいけない話は、下書きすら作らない（30項目の7番）
 *   ② AIは、そのお客様・その問い合わせのことしか見ない（6番）
 *   ③ AIが勝手に解決済みにしない（11番）
 *   ④ 会社の壁（18番）
 *   ⑤ 他人の問い合わせは、あることも漏らさない（19番）
 *   ⑥ 2人が同時に返信しても、履歴が壊れない（22番）
 *   ⑦ お客様→運営→お客様が、同じ1つの表でつながる（15番）
 *   ⑧ 返信すると、お客様へのお知らせが1件だけできる（16番）
 *   ⑨ ダッシュボードと問い合わせ画面の件数が、必ず一致する（24番）
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { db, resetDbForTests } from "../lib/server/db";
import { createTenant, createCustomer, createAdmin } from "../lib/server/seed";
import { createTicket as customerAsks, listTickets } from "../lib/server/mypage";
import {
  TicketAdminError,
  aiFirstReply,
  assignTicket,
  assignableStaff,
  changeTicketStatus,
  escalationReason,
  replyAsHuman,
  ticketCounts,
  ticketDetail,
  ticketList,
} from "../lib/server/ticketAdmin";
import { adminSummary } from "../lib/server/adminSummary";

after(async () => {
  await resetDbForTests();
});

/* ══════════════════════════════════════════════
   下ごしらえ
   ══════════════════════════════════════════════ */

type Ba = {
  tenantId: string;
  customerId: string;
  adminId: string;
  by: { adminId: string; name: string; role: string };
};

let n = 0;

/** 会社を1つ作り、会員1人と担当者1人を置く */
async function ba(code: string): Promise<Ba> {
  n += 1;
  const tenantId = await createTenant({ code: `${code}-${n}`, name: code });
  const customerId = await createCustomer({
    tenantId,
    no: 1,
    name: "検証 太郎",
    points: 0,
    email: `cus${n}@example.test`,
  });
  const adminId = await createAdmin({
    tenantId,
    no: 1,
    email: `sup${n}@example.test`,
    name: "サポート 花子",
    role: "SUPPORT",
  });
  return {
    tenantId,
    customerId,
    adminId,
    by: { adminId, name: "サポート 花子", role: "SUPPORT" },
  };
}

/** お客様がマイページから問い合わせを出す */
async function toiawase(b: Ba, subject: string, body: string): Promise<string> {
  const r = await customerAsks({
    tenantId: b.tenantId,
    userId: b.customerId,
    subject,
    body,
    actor: {
      kind: "CUSTOMER",
      id: b.customerId,
      name: "検証 太郎",
      role: "CUSTOMER",
    },
    requestId: `req-${n}-${Math.random().toString(36).slice(2, 8)}`,
  });
  return r.ticketId;
}

/* ══════════════════════════════════════════════
   ① AIに答えさせてはいけない話（30項目の7番）
   ══════════════════════════════════════════════ */

/**
 * ★ここが、この機能でいちばん危ない場所です。
 *
 *   「AIにうまく指示すれば、返金の話は避けてくれる」は、
 *   避けてくれない日が必ず来ます。
 *   だから、下書きを作る前に止めます。
 *   作らなければ、間違って送ることもできません。
 */
test("★返金・真贋・法的主張・高額は、AIに下書きすら作らせない", () => {
  const abunai: [string, string][] = [
    ["返金してください", "先週の注文を返金してほしいです"],
    ["これは偽物では", "届いたカードが偽物に見えます"],
    ["弁護士に相談します", "対応によっては訴訟も考えています"],
    ["補償してほしい", "ポイントを補償してください"],
    ["退会したい", "アカウントを削除してください"],
    ["個人情報の開示", "登録した個人情報を開示してください"],
    ["確率がおかしい", "何回引いても当たらない。確率操作では？"],
    ["商品が壊れていました", "箱が割れて届きました"],
    ["ポイントの件", "30,000pt が消えています"],
  ];

  for (const [subject, body] of abunai) {
    assert.notEqual(
      escalationReason(subject, body),
      null,
      `「${subject}」がAI回答に回ってしまいます`,
    );
  }
});

test("★ふつうの質問は、AIが答えてよい", () => {
  assert.equal(
    escalationReason("発送はいつごろですか", "注文した商品の発送予定を知りたいです"),
    null,
  );
});

test("★9,999円は人へ回さないが、10,000円からは人へ回す（境目）", () => {
  /* ★この境目を、あとから「1万円台までは大丈夫だろう」と
       緩めないこと。緩めた分だけ、AIが金額を約束します */
  assert.equal(escalationReason("確認", "9,999円の件です"), null);
  assert.notEqual(escalationReason("確認", "10,000円の件です"), null);
});

test("★AIが下書きを作れない話は、人の確認へ回り、下書きは空のまま", async () => {
  const b = await ba("esc");
  const t = await toiawase(b, "返金してください", "先週の注文を返金してほしいです");

  const r = await aiFirstReply({
    tenantId: b.tenantId,
    ticketId: t,
    by: b.by,
    requestId: "req-esc",
  });

  assert.equal(r.outcome, "HUMAN_REVIEW");
  assert.equal(r.status, "HUMAN_REVIEW");
  assert.notEqual(r.escalateReason, null);
  /* ★ここが本体。文が1文字でもできていたら、いつか送られます */
  assert.equal(r.draft, null);

  const saved = await db().execute({
    sql: `SELECT ai_draft FROM support_tickets WHERE tenant_id = ? AND id = ?`,
    args: [b.tenantId, t],
  });
  assert.equal(saved.rows[0]?.ai_draft ?? null, null);
});

/* ══════════════════════════════════════════════
   ② AIが見てよい範囲（30項目の6番）
   ══════════════════════════════════════════════ */

test("★AIの下書きは、他社・他人のことを混ぜない", async () => {
  const a = await ba("aiA");
  const c = await ba("aiB");

  /* 別会社にも、別人にも、問い合わせを置いておく */
  await toiawase(c, "他社の質問", "他社のお客様からの問い合わせです");
  const hoka = await createCustomer({
    tenantId: a.tenantId,
    no: 2,
    name: "別人 次郎",
    points: 0,
    email: "other@example.test",
  });
  await customerAsks({
    tenantId: a.tenantId,
    userId: hoka,
    subject: "別人の質問",
    body: "別のお客様からの問い合わせです",
    actor: { kind: "CUSTOMER", id: hoka, name: "別人 次郎", role: "CUSTOMER" },
    requestId: "req-other",
  });

  const t = await toiawase(a, "発送について", "注文した商品の発送予定を知りたいです");
  const r = await aiFirstReply({
    tenantId: a.tenantId,
    ticketId: t,
    by: a.by,
    requestId: "req-ai",
  });

  assert.equal(r.outcome, "AI_REPLIED");
  assert.ok(r.draft && r.draft.length > 0);

  /* 他人・他社の名前が1文字も混ざっていないこと */
  assert.equal(r.draft!.includes("別人 次郎"), false);
  assert.equal(r.draft!.includes("他社のお客様"), false);
  assert.equal(r.draft!.includes(hoka), false);

  /* ★根拠を残していること（30項目の8番）。
       あとから「なぜそう答えたのか」を追えなくなります */
  assert.ok(r.sources.length > 0);
});

/* ══════════════════════════════════════════════
   ③ AIが勝手に解決済みにしない（30項目の11番）
   ══════════════════════════════════════════════ */

test("★AIの下書きだけでは、解決済みにならない", async () => {
  const b = await ba("noresolve");
  const t = await toiawase(b, "発送について", "発送の予定を教えてください");

  const r = await aiFirstReply({
    tenantId: b.tenantId,
    ticketId: t,
    by: b.by,
    requestId: "req-nr",
  });
  assert.notEqual(r.status, "RESOLVED");

  const row = await db().execute({
    sql: `SELECT status FROM support_tickets WHERE tenant_id = ? AND id = ?`,
    args: [b.tenantId, t],
  });
  assert.notEqual(String(row.rows[0]?.status ?? ""), "RESOLVED");
});

test("★AIの下書きは2回作れない（読みかけの文を黙って書き換えない）", async () => {
  const b = await ba("twice");
  const t = await toiawase(b, "発送について", "発送の予定を教えてください");

  await aiFirstReply({ tenantId: b.tenantId, ticketId: t, by: b.by, requestId: "r1" });
  await assert.rejects(
    () => aiFirstReply({ tenantId: b.tenantId, ticketId: t, by: b.by, requestId: "r2" }),
    (e: unknown) =>
      e instanceof TicketAdminError && e.code === "ALREADY_AI_REPLIED",
  );
});

/* ══════════════════════════════════════════════
   ③-2 下書きは、送信ではない（2026-08-27の取りこぼし）
   ══════════════════════════════════════════════

   公開先（Preview）で実際に動かして、はじめて見つかった穴です。

     ① AIの下書きが、お客様の画面に
        「サポート担当」からの返信として、その場で出ていた
     ② そのとき状態の表示が「回答いたしました」だった

   担当者は、まだ送信を1度も押していません。
   下書きの中身が間違っていても、取り消せません。
   二度と戻らないよう、ここで固定します。 */

test("★「まだ届いていません」だけなら、人の確認へ回さない", () => {
  /* ★これはいちばん多い、ふつうのご質問です。
       ここを人へ回していたあいだ、追跡番号を調べて下書きを出す
       仕組みが、一度も動きませんでした */
  assert.equal(
    escalationReason("発送について", "注文した商品がまだ届いていません。"),
    null,
  );
  /* 中身が足りない・無くなった、は今までどおり人が見ること */
  assert.notEqual(
    escalationReason("中身について", "1枚入っていませんでした"),
    null,
  );
  assert.notEqual(escalationReason("荷物", "荷物が紛失したようです"), null);
});

test("★AIの下書きは、お客様の画面に1文字も出ない", async () => {
  const b = await ba("draftleak");
  const t = await toiawase(
    b,
    "発送について",
    "注文した商品がまだ届いていません。予定を知りたいです。",
  );

  const r = await aiFirstReply({
    tenantId: b.tenantId,
    ticketId: t,
    by: b.by,
    requestId: "req-leak",
  });
  assert.equal(r.outcome, "AI_REPLIED");
  assert.ok(r.draft && r.draft.length > 0);

  const mine = await listTickets(b.tenantId, b.customerId);
  const mi = mine.find((x) => x.id === t);
  assert.ok(mi);

  /* ★お客様の側にあるのは、ご自身が出した1件だけ */
  assert.equal(mi!.messages.length, 1);
  assert.equal(mi!.messages[0].from, "お客様");

  /* ★状態の言葉も「回答いたしました」にしないこと。
       探しに来て、どこにも無い、が起きます */
  assert.equal(mi!.statusLabel, "担当者が確認しています");
  assert.equal(mi!.answer, null);
});

test("★人が送信を押して、はじめてお客様の画面に出る", async () => {
  const b = await ba("draftsend");
  const t = await toiawase(
    b,
    "発送について",
    "注文した商品がまだ届いていません。予定を知りたいです。",
  );

  await aiFirstReply({
    tenantId: b.tenantId,
    ticketId: t,
    by: b.by,
    requestId: "req-d1",
  });
  const before = await listTickets(b.tenantId, b.customerId);
  assert.equal(before.find((x) => x.id === t)!.messages.length, 1);

  await replyAsHuman({
    tenantId: b.tenantId,
    ticketId: t,
    text: "本日中に発送いたします。追跡番号は明日ご案内します。",
    by: b.by,
    requestId: "req-d2",
  });

  const after2 = await listTickets(b.tenantId, b.customerId);
  const mi = after2.find((x) => x.id === t)!;
  assert.equal(mi.messages.length, 2);
  assert.equal(mi.messages[1].from, "サポート担当");
  assert.ok(mi.messages[1].body.includes("本日中に発送"));
});

test("★状態を変えるには理由が要る", async () => {
  const b = await ba("reason");
  const t = await toiawase(b, "発送について", "発送の予定を教えてください");

  await assert.rejects(
    () =>
      changeTicketStatus({
        tenantId: b.tenantId,
        ticketId: t,
        to: "RESOLVED",
        reason: "",
        by: b.by,
        requestId: "r",
      }),
    (e: unknown) => e instanceof TicketAdminError,
  );
});

/* ══════════════════════════════════════════════
   ④ 会社の壁（30項目の18番）
   ══════════════════════════════════════════════ */

test("★A社の担当者は、B社の問い合わせを 一覧・詳細のどちらでも見られない", async () => {
  const a = await ba("isoA");
  const bb = await ba("isoB");

  const ta = await toiawase(a, "A社の質問", "A社のお客様からの問い合わせです");
  const tb = await toiawase(bb, "B社の質問", "B社のお客様からの問い合わせです");

  const la = await ticketList(a.tenantId, "SUPPORT");
  const lb = await ticketList(bb.tenantId, "SUPPORT");

  assert.equal(la.rows.some((x) => x.id === ta), true);
  assert.equal(la.rows.some((x) => x.id === tb), false, "A社にB社の問い合わせが出ています");
  assert.equal(lb.rows.some((x) => x.id === tb), true);
  assert.equal(lb.rows.some((x) => x.id === ta), false, "B社にA社の問い合わせが出ています");

  /* 詳細も、双方向で断ること */
  assert.equal(await ticketDetail(a.tenantId, tb, "SUPPORT"), null);
  assert.equal(await ticketDetail(bb.tenantId, ta, "SUPPORT"), null);
});

test("★会社をまたいだ 返信・担当者変更・状態変更 は、すべて断る", async () => {
  const a = await ba("actA");
  const bb = await ba("actB");
  const tb = await toiawase(bb, "B社の質問", "B社のお客様からの問い合わせです");

  const nomi = (e: unknown) =>
    e instanceof TicketAdminError && e.code === "NOT_FOUND";

  await assert.rejects(
    () =>
      replyAsHuman({
        tenantId: a.tenantId,
        ticketId: tb,
        text: "こちらはA社の担当者です",
        by: a.by,
        requestId: "x1",
      }),
    nomi,
  );
  await assert.rejects(
    () =>
      assignTicket({
        tenantId: a.tenantId,
        ticketId: tb,
        assigneeId: a.adminId,
        by: a.by,
        requestId: "x2",
      }),
    nomi,
  );
  await assert.rejects(
    () =>
      changeTicketStatus({
        tenantId: a.tenantId,
        ticketId: tb,
        to: "RESOLVED",
        reason: "他社のものを閉じようとしています",
        by: a.by,
        requestId: "x3",
      }),
    nomi,
  );
  await assert.rejects(
    () =>
      aiFirstReply({
        tenantId: a.tenantId,
        ticketId: tb,
        by: a.by,
        requestId: "x4",
      }),
    nomi,
  );
});

test("★担当者に選べる人に、他社の人は出てこない", async () => {
  const a = await ba("stfA");
  const bb = await ba("stfB");

  const la = await assignableStaff(a.tenantId, "SUPPORT");
  assert.equal(la.some((x) => x.id === a.adminId), true);
  assert.equal(
    la.some((x) => x.id === bb.adminId),
    false,
    "他社の担当者が選択肢に出ています",
  );
});

/* ══════════════════════════════════════════════
   ⑤ 存在を漏らさない（30項目の19番）
   ══════════════════════════════════════════════ */

test("★無い問い合わせと、他社の問い合わせは、同じ断り方になる", async () => {
  const a = await ba("idorA");
  const bb = await ba("idorB");
  const tb = await toiawase(bb, "B社の質問", "B社のお客様からの問い合わせです");

  /* 詳細は、どちらも null（見つからない）で揃うこと。
     ★「他社のものです」と返さないこと。
       それは「そのIDは実在する」と教えているのと同じです */
  assert.equal(await ticketDetail(a.tenantId, tb, "SUPPORT"), null);
  assert.equal(await ticketDetail(a.tenantId, "tkt_nai_mono", "SUPPORT"), null);

  /* 操作も、どちらも同じ NOT_FOUND で揃うこと */
  const koe = async (ticketId: string) => {
    try {
      await replyAsHuman({
        tenantId: a.tenantId,
        ticketId,
        text: "確認します",
        by: a.by,
        requestId: "idor",
      });
      return "とおった";
    } catch (e) {
      return e instanceof TicketAdminError ? `${e.code}:${e.message}` : "ほか";
    }
  };
  assert.equal(await koe(tb), await koe("tkt_nai_mono"));
});

/* ══════════════════════════════════════════════
   ⑥ 権限（30項目の13番・20番）
   ══════════════════════════════════════════════ */

test("★VIEWER は見られるが、返信ボタンは出ない", async () => {
  const b = await ba("role");
  await toiawase(b, "発送について", "発送の予定を教えてください");

  const viewer = await ticketList(b.tenantId, "VIEWER");
  assert.equal(viewer.rows.length, 1, "VIEWER が一覧を見られません");
  assert.equal(viewer.canReply, false, "VIEWER に返信ボタンが出ています");

  const support = await ticketList(b.tenantId, "SUPPORT");
  assert.equal(support.canReply, true);
});

test("★問い合わせを見る権限が無い人には、一覧も詳細も渡さない", async () => {
  const b = await ba("nofin");
  const t = await toiawase(b, "発送について", "発送の予定を教えてください");

  /* FINANCE には support.view がありません */
  const fin = await ticketList(b.tenantId, "FINANCE");
  assert.equal(fin.rows.length, 0);
  assert.equal(fin.canReply, false);
  assert.equal(await ticketDetail(b.tenantId, t, "FINANCE"), null);

  /* ログインしていない（role が無い）ときも同じ */
  assert.equal(await ticketDetail(b.tenantId, t, null), null);
});

test("★返信できない人を、担当者の選択肢に出さない", async () => {
  const b = await ba("assignable");
  const viewerId = await createAdmin({
    tenantId: b.tenantId,
    no: 2,
    email: `viewer${n}@example.test`,
    name: "閲覧 三郎",
    role: "VIEWER",
  });

  const list = await assignableStaff(b.tenantId, "SUPPORT");
  assert.equal(
    list.some((x) => x.id === viewerId),
    false,
    "返信できない人が担当者に選べます（割り当てても返信ボタンが出ません）",
  );
});

/* ══════════════════════════════════════════════
   ⑦ 同時返信（30項目の22番）
   ══════════════════════════════════════════════ */

test("★2人が同時に返信しても、履歴が壊れず、番号も重ならない", async () => {
  const b = await ba("race");
  const t = await toiawase(b, "発送について", "発送の予定を教えてください");

  const futari = await createAdmin({
    tenantId: b.tenantId,
    no: 2,
    email: `sup2-${n}@example.test`,
    name: "サポート 次郎",
    role: "SUPPORT",
  });

  const res = await Promise.allSettled([
    replyAsHuman({
      tenantId: b.tenantId,
      ticketId: t,
      text: "花子です。確認して折り返します。",
      by: b.by,
      requestId: "race-1",
    }),
    replyAsHuman({
      tenantId: b.tenantId,
      ticketId: t,
      text: "次郎です。確認して折り返します。",
      by: { adminId: futari, name: "サポート 次郎", role: "SUPPORT" },
      requestId: "race-2",
    }),
  ]);

  /* どちらか一方でも通っていること（両方失敗は困ります） */
  assert.ok(res.some((r) => r.status === "fulfilled"));

  const rows = await db().execute({
    sql: `SELECT seq FROM ticket_messages
           WHERE tenant_id = ? AND ticket_id = ? ORDER BY seq`,
    args: [b.tenantId, t],
  });
  const seqs = rows.rows.map((r) => Number((r as Record<string, unknown>).seq));

  /* ★番号が重なっていないこと。
       重なると、あとから並べ直したときに順番が決まりません */
  assert.equal(new Set(seqs).size, seqs.length, `番号が重複しています: ${seqs}`);
  /* 1から抜けなく並んでいること */
  assert.deepEqual(
    seqs,
    seqs.map((_, i) => i + 1),
    `番号が飛んでいます: ${seqs}`,
  );
});

/* ══════════════════════════════════════════════
   ⑧ お客様 → 運営 → お客様（30項目の15番）
   ══════════════════════════════════════════════ */

test("★お客様が出した問い合わせが、そのまま運営に出て、返信がお客様に戻る", async () => {
  const b = await ba("e2e");

  /* A. お客様が出す */
  const t = await toiawase(b, "発送について", "注文した商品の発送予定を知りたいです");

  /* B. 運営の一覧に、その場で出る */
  const l1 = await ticketList(b.tenantId, "SUPPORT");
  const row = l1.rows.find((x) => x.id === t);
  assert.ok(row, "お客様の問い合わせが、運営の一覧に出ていません");
  assert.equal(row!.status, "NEW");

  /* C. 担当者を決める */
  await assignTicket({
    tenantId: b.tenantId,
    ticketId: t,
    assigneeId: b.adminId,
    by: b.by,
    requestId: "e2e-assign",
  });

  /* D. 人が返信する */
  await replyAsHuman({
    tenantId: b.tenantId,
    ticketId: t,
    text: "本日中に発送いたします。追跡番号は発送後にお知らせします。",
    by: b.by,
    requestId: "e2e-reply",
  });

  /* E. お客様の画面に、その場で出る */
  const mine = await listTickets(b.tenantId, b.customerId);
  const mi = mine.find((x) => x.id === t);
  assert.ok(mi, "返信した問い合わせが、お客様の画面から消えています");
  assert.equal(mi!.messages.length, 2, "お客様の画面に、やり取りが2件出ていません");
  assert.equal(mi!.messages[0].from, "お客様");
  assert.equal(mi!.messages[1].from, "サポート担当");
  assert.ok(mi!.messages[1].body.includes("本日中に発送"));

  /* ★お客様に「AI」という言葉を見せないこと。
       送ると決めたのは人です。AIのせいにはできません */
  for (const m of mi!.messages) {
    assert.equal(m.from.includes("AI"), false);
  }

  /* F. 解決にする */
  await changeTicketStatus({
    tenantId: b.tenantId,
    ticketId: t,
    to: "RESOLVED",
    reason: "発送日をご案内し、ご納得いただきました。",
    by: b.by,
    requestId: "e2e-resolve",
  });

  const l2 = await ticketList(b.tenantId, "SUPPORT");
  assert.equal(l2.rows.find((x) => x.id === t)?.status, "RESOLVED");
});

/* ══════════════════════════════════════════════
   ⑨ 返信のお知らせ（30項目の16番）
   ══════════════════════════════════════════════ */

test("★人が返信したときだけ、お客様へのお知らせが1件できる", async () => {
  const b = await ba("notify");
  const t = await toiawase(b, "発送について", "発送の予定を教えてください");

  const kazu = async () => {
    const r = await db().execute({
      sql: `SELECT COUNT(*) AS n FROM notifications
             WHERE tenant_id = ? AND ref_kind = 'TICKET' AND ref_id = ?`,
      args: [b.tenantId, t],
    });
    return Number((r.rows[0] as Record<string, unknown>).n);
  };

  /* AIの下書きだけでは、お知らせを作らないこと。
     ★作ると「返事が来ました」を見て開いた人が、何も無い画面を見ます */
  await aiFirstReply({ tenantId: b.tenantId, ticketId: t, by: b.by, requestId: "n1" });
  assert.equal(await kazu(), 0, "AIの下書きでお知らせが出ています");

  await replyAsHuman({
    tenantId: b.tenantId,
    ticketId: t,
    text: "本日中に発送いたします。",
    by: b.by,
    requestId: "n2",
  });
  assert.equal(await kazu(), 1);

  /* 2通目の返信でも、ちゃんと2件目ができること。
     ★同じ名札にすると、2通目が黙って消えます */
  await replyAsHuman({
    tenantId: b.tenantId,
    ticketId: t,
    text: "追跡番号をお知らせします。",
    by: b.by,
    requestId: "n3",
  });
  assert.equal(await kazu(), 2);

  /* お知らせの本文に、返信の中身をそのまま入れないこと */
  const one = await db().execute({
    sql: `SELECT title, body FROM notifications
           WHERE tenant_id = ? AND ref_id = ? ORDER BY created_at LIMIT 1`,
    args: [b.tenantId, t],
  });
  const body = String((one.rows[0] as Record<string, unknown>).body ?? "");
  assert.equal(body.includes("本日中に発送いたします。"), false);
});

/* ══════════════════════════════════════════════
   ⑩ ダッシュボードと同じ数（30項目の24番・26番）
   ══════════════════════════════════════════════ */

test("★ダッシュボードの件数は、問い合わせ画面と必ず同じ", async () => {
  const b = await ba("count");

  /* ふつうの質問1件（AIが答えられる） */
  const t1 = await toiawase(b, "発送について", "発送の予定を教えてください");
  /* AIに答えさせてはいけない質問1件 */
  await toiawase(b, "返金してください", "先週の注文を返金してほしいです");
  /* AIの下書きを作って、AI_REPLIED を1件つくる */
  await aiFirstReply({ tenantId: b.tenantId, ticketId: t1, by: b.by, requestId: "c1" });

  const c = await ticketCounts(b.tenantId);
  const l = await ticketList(b.tenantId, "SUPPORT");
  const s = await adminSummary(b.tenantId, "SUPER_ADMIN");

  /* 一覧の全件と、数えた全件が同じであること */
  assert.equal(c.all, l.rows.length);

  /* ★ここが本体。
       ダッシュボードが自前で数え直すと、いつか必ずずれます */
  assert.equal(s.supportOpen, c.open);
  assert.equal(s.supportHumanReview, c.humanReview);
  assert.equal(s.supportNew, c.new);
  assert.equal(s.supportHigh, c.high);

  /* 数えた中身が、実際の状態と合っていること */
  const byStatus = (st: string) => l.rows.filter((x) => x.status === st).length;
  assert.equal(c.new, byStatus("NEW"));
  assert.equal(c.aiReplied, byStatus("AI_REPLIED"));
  assert.equal(c.humanReview, byStatus("HUMAN_REVIEW"));
  assert.equal(c.resolved, byStatus("RESOLVED"));
});

test("★0件のときは、0件と数える（読めなかったことにしない）", async () => {
  const b = await ba("zero");
  const c = await ticketCounts(b.tenantId);
  assert.equal(c.all, 0);
  assert.equal(c.open, 0);
  assert.equal(c.humanReview, 0);

  const s = await adminSummary(b.tenantId, "SUPER_ADMIN");
  assert.equal(s.supportOpen, 0, "0件が null（見せられない）に化けています");
  assert.equal(s.supportHumanReview, 0);
});

/* ══════════════════════════════════════════════
   ⑪ 一覧に、要らない個人情報を出さない（30項目の14番）
   ══════════════════════════════════════════════ */

test("★一覧に、住所とメールをそのまま出さない", async () => {
  const b = await ba("pii");
  await toiawase(b, "発送について", "発送の予定を教えてください");

  const l = await ticketList(b.tenantId, "SUPPORT");
  const row = l.rows[0];
  const nakami = JSON.stringify(row);

  /* 住所は、そもそも一覧に載せないこと */
  assert.equal("address" in (row as unknown as Record<string, unknown>), false);
  /* メールは、そのままの形で出さないこと */
  assert.equal(
    nakami.includes(`cus${n}@example.test`),
    false,
    "一覧にメールアドレスがそのまま出ています",
  );
});
