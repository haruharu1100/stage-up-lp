/**
 * 問い合わせの「状態」の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験が要るのか（2026-08-26 に見つけた不具合）
 * ═══════════════════════════════════════════════════════
 *
 *   同じ「状態」の名前が、3通り、別々の場所に書かれていました。
 *
 *       DBに実際に入っていた値 …… OPEN だけ
 *       お客様の画面の言い換え …… OPEN / IN_PROGRESS / AI_ANSWERED /
 *                                  HUMAN_REVIEW / DONE
 *       運営の画面の見本データ …… また別の並び
 *
 *   このせいで、解決済みの問い合わせでも、
 *   お客様の画面には「確認しています」と出ていました。
 *   お客様は答えを待ち続け、運営は終わったつもりでいます。
 *   誰もエラーに気づけません。
 *
 *   名前を決める場所は lib/server/ticketStatus.ts の1つだけにしました。
 *   この試験は、そこへ戻されていないかを見張ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   ① 決めた5つの状態すべてに、運営用・お客様用の言葉がある
 *   ② お客様に「未対応」と出さない（放っておかれた、と読めます）
 *   ③ 解決済みの問い合わせに「確認しています」と出さない
 *   ④ 終わったものを「未対応」へ戻せない
 *   ⑤ 知らない状態が入っていたら、分かったふりをしない
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db, resetDbForTests, migrate } from "../lib/server/db";
import { listTickets } from "../lib/server/mypage";
import { adminSummary } from "../lib/server/adminSummary";
import { createTenant, createCustomer, createTicket } from "../lib/server/seed";
import { id } from "../lib/server/ids";
import {
  TICKET_STATUSES,
  TICKET_LABEL_ADMIN,
  TICKET_LABEL_CUSTOMER,
  isTicketStatus,
  isOpenTicket,
  canMoveTicket,
} from "../lib/server/ticketStatus";

after(async () => {
  await resetDbForTests();
});

/* ══════════════════════════════════════════════
   ① 言葉の抜けが無いこと
   ══════════════════════════════════════════════ */

test("★決めた5つ全部に、運営用とお客様用の言葉がある", () => {
  for (const s of TICKET_STATUSES) {
    assert.ok(
      TICKET_LABEL_ADMIN[s]?.length > 0,
      `${s} に運営用の言葉がありません`,
    );
    assert.ok(
      TICKET_LABEL_CUSTOMER[s]?.length > 0,
      `${s} にお客様用の言葉がありません`,
    );
  }
});

/* ══════════════════════════════════════════════
   ② お客様に見せてはいけない言葉
   ══════════════════════════════════════════════ */

test("★お客様の画面に「未対応」と出さない", () => {
  for (const s of TICKET_STATUSES) {
    const kotoba = TICKET_LABEL_CUSTOMER[s];
    assert.ok(
      !kotoba.includes("未対応"),
      `${s} が「${kotoba}」になっています。お客様には、放っておかれていると読めます`,
    );
    assert.ok(
      !kotoba.includes("新規"),
      `${s} が「${kotoba}」になっています。新規はただの分類で、お客様には意味がありません`,
    );
  }
});

test("★運営の画面には「未対応」と出す（新規、では次に何をするか分からない）", () => {
  assert.equal(TICKET_LABEL_ADMIN.NEW, "未対応");
});

/* ══════════════════════════════════════════════
   ③ 解決済みを「確認しています」と言わない（実際に起きた不具合）
   ══════════════════════════════════════════════ */

test("★【再発防止】解決済みの問い合わせに「確認しています」と出さない", async () => {
  const t = await createTenant({ code: `TKT${Date.now() % 100000}`, name: "問合社" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "客", points: 0 });

  await createTicket({ tenantId: t, userId: c, subject: "解決した件", status: "RESOLVED" });

  const list = await listTickets(t, c);
  assert.equal(list.length, 1);
  assert.equal(
    list[0].statusLabel,
    "解決済み",
    "解決済みなのに、お客様には終わったことが伝わっていません",
  );
  assert.ok(
    !list[0].statusLabel.includes("確認しています"),
    "解決済みの件で、お客様を待たせ続ける文言が出ています",
  );
});

test("★5つの状態すべてで、お客様に出る言葉が決めたとおりになる", async () => {
  const t = await createTenant({ code: `TKT2${Date.now() % 10000}`, name: "全状態社" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "客", points: 0 });

  for (const s of TICKET_STATUSES) {
    await createTicket({ tenantId: t, userId: c, subject: s, status: s });
  }

  const list = await listTickets(t, c);
  assert.equal(list.length, TICKET_STATUSES.length);

  for (const row of list) {
    assert.ok(isTicketStatus(row.status), `知らない状態が保存されています：${row.status}`);
    assert.equal(
      row.statusLabel,
      TICKET_LABEL_CUSTOMER[row.status as (typeof TICKET_STATUSES)[number]],
      `${row.status} の言葉が、決めたものと違います`,
    );
  }
});

/* ══════════════════════════════════════════════
   ④ 戻してはいけない動き
   ══════════════════════════════════════════════ */

test("★終わったものを「未対応」へ戻せない（対応済みの件数が後から減る）", () => {
  assert.equal(canMoveTicket("RESOLVED", "NEW"), false);
  assert.equal(canMoveTicket("IN_PROGRESS", "NEW"), false);
  assert.equal(canMoveTicket("AI_REPLIED", "NEW"), false);

  /* もう一度みてほしいときは、対応中へ戻す */
  assert.equal(canMoveTicket("RESOLVED", "IN_PROGRESS"), true);

  /* 同じ状態への「変更」は、何も起きていないので通さない */
  assert.equal(canMoveTicket("NEW", "NEW"), false);
});

test("★終わっていない状態の見分け方が、1か所に決まっている", () => {
  assert.equal(isOpenTicket("NEW"), true);
  assert.equal(isOpenTicket("AI_REPLIED"), true);
  assert.equal(isOpenTicket("HUMAN_REVIEW"), true);
  assert.equal(isOpenTicket("IN_PROGRESS"), true);
  assert.equal(isOpenTicket("RESOLVED"), false);
});

/* ══════════════════════════════════════════════
   ⑤ 知らない状態が入っていたとき
   ══════════════════════════════════════════════ */

test("★知らない状態を、決めた5つだと言い張らない", () => {
  assert.equal(isTicketStatus("OPEN"), false, "もう使わない古い名前が通っています");
  assert.equal(isTicketStatus("AI_ANSWERED"), false);
  assert.equal(isTicketStatus("DONE"), false);
  assert.equal(isTicketStatus(""), false);
  assert.equal(isTicketStatus(null), false);
  assert.equal(isTicketStatus(123), false);
});

test("★古い名前の行が残っていても、勝手に「解決済み」にしない", async () => {
  const t = await createTenant({ code: `TKT3${Date.now() % 10000}`, name: "古株社" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "客", points: 0 });

  await migrate();
  /* 移行し損ねた昔の行を、わざと作る */
  const at = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO support_tickets
            (id, tenant_id, user_id, subject, body, status, created_at, updated_at)
          VALUES (?,?,?, '昔の件', '本文', 'OPEN', ?, ?)`,
    args: [id("tkt"), t, c, at, at],
  });

  const list = await listTickets(t, c);
  assert.equal(list.length, 1);
  assert.ok(
    !list[0].statusLabel.includes("解決"),
    "分からない状態を、終わったことにしています",
  );

  /*
    ★数える側では、終わっていない扱いにすること。
      分からないものを勝手に片づけると、
      その問い合わせは誰の目にも触れなくなります。
  */
  const s = await adminSummary(t, "SUPER_ADMIN");
  assert.equal(
    s.supportOpen,
    1,
    "状態が読めない問い合わせが、片づいたことにされています",
  );
});
