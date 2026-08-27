/**
 * マイページの中身（ポイント・お届け先・お問い合わせ）。
 *
 * ═══════════════════════════════════════════════════════
 * ★誰の分かは、必ず呼び出し側がクッキーから渡すこと
 * ═══════════════════════════════════════════════════════
 *
 *   このファイルの関数は、どれも userId を受け取ります。
 *   その値を本文（リクエストボディ）から取ってはいけません。
 *   1文字書き換えるだけで、他人の残高・他人の住所が読めます。
 *
 *   入口（app/api/customer/*）では session.subjectId しか渡していません。
 */

import { appendAuditTx } from "./audit";
import { withWriteTx, db } from "./db";
import { id } from "./ids";
import { addressLine, parseAddress, type Actor, type AddressSnapshot } from "./orders";
import { guessCategory } from "./ticketAdmin";
import { isTicketStatus, TICKET_LABEL_CUSTOMER } from "./ticketStatus";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
const nul = (v: unknown) => (v == null ? null : String(v));

export class MyPageError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "MyPageError";
  }
}

/* ══════════════════════════════════════════════
   ポイント
   ══════════════════════════════════════════════ */

/**
 * ★ここの言葉を、画面側で作り直さないこと。
 *   管理画面と違う言い方になると、
 *   電話口で運営とお客様が別の言葉で同じ行を指すことになります。
 */
export const POINT_KIND_LABEL: Record<string, string> = {
  OPENING: "開始時の残高",
  CHARGE: "付与",
  CAMPAIGN: "付与（キャンペーン）",
  DRAW_SPEND: "ガチャ利用",
  DRAW_RETURN: "返還",
  PRIZE_EXCHANGE: "商品交換",
  ADMIN_ADJUST: "調整",
};

export type PointEntryView = {
  id: string;
  at: string;
  kind: string;
  kindLabel: string;
  delta: number;
  memo: string;
  ref: string | null;
  /** この行を入れたあとの残高 */
  balanceAfter: number;
};

export type PointsView = {
  /** 会員情報が持っている残高 */
  balance: number;
  /** 台帳を全部足した数 */
  ledgerSum: number;
  /**
   * 残高と台帳が一致しているか。
   *
   * ★一致していないときに、黙って残高だけ出さないこと。
   *   合わないという事実そのものが、いちばん重い情報です。
   *   隠すと、気づくのは決算のときになります。
   */
  matches: boolean;
  entries: PointEntryView[];
};

export async function getPoints(
  tenantId: string,
  userId: string,
  limit = 200,
): Promise<PointsView> {
  const cu = await db().execute({
    sql: `SELECT points FROM customers WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, userId],
  });
  if (cu.rows.length === 0) {
    throw new MyPageError("NO_CUSTOMER", "会員情報が見つかりません。");
  }
  const balance = num((cu.rows[0] as Row).points);

  /* 古い順に読んで、そのつどの残高を積み上げます */
  const all = await db().execute({
    sql: `SELECT id, created_at, kind, delta, memo, ref
            FROM point_ledger
           WHERE tenant_id = ? AND user_id = ?
           ORDER BY created_at ASC, id ASC`,
    args: [tenantId, userId],
  });

  let running = 0;
  const asc: PointEntryView[] = (all.rows as Row[]).map((e) => {
    running += num(e.delta);
    const kind = str(e.kind);
    return {
      id: str(e.id),
      at: str(e.created_at),
      kind,
      kindLabel: POINT_KIND_LABEL[kind] ?? kind,
      delta: num(e.delta),
      memo: str(e.memo),
      ref: nul(e.ref),
      balanceAfter: running,
    };
  });

  return {
    balance,
    ledgerSum: running,
    matches: running === balance,
    /* 画面には新しい順で出します */
    entries: asc.slice(-limit).reverse(),
  };
}

/* ══════════════════════════════════════════════
   お届け先
   ══════════════════════════════════════════════ */

export type AddressView = {
  address: AddressSnapshot | null;
  changedAt: string | null;
  /**
   * すでに宛先が固まっている（＝変えても動かない）荷物の数。
   *
   * ★これを画面に出すこと。
   *   出さないと、住所を変えたお客様は
   *   「発送中の荷物も新しい住所に届く」と思い込みます。
   */
  frozenShipments: number;
  /** 依頼済みで、まだ箱になっていない注文の数（宛先は依頼時のまま） */
  frozenOrders: number;
};

export async function getAddress(
  tenantId: string,
  userId: string,
): Promise<AddressView> {
  const cu = await db().execute({
    sql: `SELECT name, address, address_changed_at FROM customers
           WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, userId],
  });
  if (cu.rows.length === 0) {
    throw new MyPageError("NO_CUSTOMER", "会員情報が見つかりません。");
  }
  const c = cu.rows[0] as Row;

  const sh = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM shipments
           WHERE tenant_id = ? AND user_id = ? AND shipment_status <> 'CANCELLED'`,
    args: [tenantId, userId],
  });
  const or = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM orders
           WHERE tenant_id = ? AND user_id = ?
             AND order_status NOT IN ('CANCELLED', 'FULFILLED')`,
    args: [tenantId, userId],
  });

  return {
    address: parseAddress(c.address, str(c.name)),
    changedAt: nul(c.address_changed_at),
    frozenShipments: num((sh.rows[0] as Row).n),
    frozenOrders: num((or.rows[0] as Row).n),
  };
}

/**
 * お届け先を変える。
 *
 * ═══════════════════════════════════════════════════════
 * ★確定した発送の宛先には、絶対に触らないこと（#19）
 * ═══════════════════════════════════════════════════════
 *
 *   ここが shipments を1行も UPDATE しないのは、わざとです。
 *   会員情報の変更が発送へ自動で流れる作りにすると、
 *   乗っ取った人が住所を1回書き換えるだけで、
 *   まだ出していない箱の宛先が、全部その人の家になります。
 *
 *   同じ理由で、すでに立っている注文（orders）の写しにも触りません。
 *   お客様が「この住所でお願いします」と押した内容だからです。
 *
 *   新しい住所が効くのは、これから出す依頼だけです。
 */
export async function setAddress(args: {
  tenantId: string;
  userId: string;
  address: AddressSnapshot;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ address: AddressSnapshot; auditSeq: number; frozen: number }> {
  const at = args.now ?? new Date().toISOString();

  const a: AddressSnapshot = {
    name: args.address.name.trim(),
    zip: args.address.zip.trim(),
    addr: args.address.addr.trim(),
    tel: args.address.tel.trim(),
  };

  /* ★「あとで直せばいい」で通さないこと。
       宛先の欠けた依頼は、伝票を刷る直前まで誰も気づきません。 */
  if (a.name === "") {
    throw new MyPageError("BAD_NAME", "お名前をご記入ください。");
  }
  if (a.addr === "") {
    throw new MyPageError("BAD_ADDR", "ご住所をご記入ください。");
  }
  if (a.zip !== "" && !/^\d{3}-?\d{4}$/.test(a.zip)) {
    throw new MyPageError(
      "BAD_ZIP",
      "郵便番号は、7桁の数字でご記入ください（例：100-0001）。",
    );
  }
  if (a.tel !== "" && !/^[0-9\-+() ]{9,20}$/.test(a.tel)) {
    throw new MyPageError("BAD_TEL", "お電話番号をご確認ください。");
  }

  return withWriteTx(async (tx) => {
    const cu = await tx.execute({
      sql: `SELECT id, name, address, status FROM customers
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.userId],
    });
    if (cu.rows.length === 0) {
      throw new MyPageError("NO_CUSTOMER", "会員情報が見つかりません。");
    }
    const c = cu.rows[0] as Row;
    if (str(c.status) !== "ACTIVE") {
      throw new MyPageError(
        "CUSTOMER_SUSPENDED",
        "このアカウントは現在ご利用いただけません。",
      );
    }
    const before = parseAddress(c.address, str(c.name));

    await tx.execute({
      sql: `UPDATE customers SET address = ?, address_changed_at = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [JSON.stringify(a), at, args.tenantId, args.userId],
    });

    /* いま宛先が固まっている荷物の数（記録に残すため） */
    const sh = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM shipments
             WHERE tenant_id = ? AND user_id = ? AND shipment_status <> 'CANCELLED'`,
      args: [args.tenantId, args.userId],
    });
    const frozen = num((sh.rows[0] as Row).n);

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "ADDRESS_UPDATE",
      target: args.userId,
      summary: "お届け先を変更しました。",
      /* ★前と後の両方を残すこと。
           変えた事実だけでは、何がどう変わったのかを言えません。 */
      before: before ? addressLine(before) : "（未登録）",
      after: addressLine(a),
      requestId: args.requestId,
      data: {
        userId: args.userId,
        userName: str(c.name),
        /* ★この2行が、あとで効きます。
             「宛先が違う」と言われたときに、
             確定済みの荷物には触っていないことを示せます。 */
        appliesTo: "NEXT_REQUESTS_ONLY",
        frozenShipments: frozen,
      },
    });

    return { address: a, auditSeq: audit.seq, frozen };
  });
}

/* ══════════════════════════════════════════════
   お問い合わせ
   ══════════════════════════════════════════════ */

/**
 * お客様に見せる、1件のやり取り。
 *
 * ★お客様には「AI」と書かないこと。
 *   下書きをAIが作っても、送るかどうかを決めたのは人です。
 *   送り主は「サポート担当」です。
 *   社内で誰が書いたかは、管理画面の側に残します。
 */
export type TicketMessageView = {
  seq: number;
  /** お客様 / サポート担当 の2つだけ */
  from: "お客様" | "サポート担当";
  mine: boolean;
  body: string;
  createdAt: string;
};

export type TicketView = {
  id: string;
  subject: string;
  body: string;
  status: string;
  statusLabel: string;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  createdAt: string;
  /**
   * 時系列のやり取り（正本）。
   *
   * ★answer（1つ前のやり方）は、いちばん新しい返信の写しです。
   *   2回以上返信すると、answer には最後の1件しか残りません。
   *   読むときは、必ずこちらを使ってください。
   */
  messages: TicketMessageView[];
};

/**
 * お客様に見せる状態の言葉。
 *
 * ★ここで独自の一覧を作らないこと。
 *   以前ここには OPEN / AI_ANSWERED / DONE という、
 *   DBにも管理画面にも無い名前が書かれていました。
 *   そのため「解決済み」の問い合わせでも、
 *   お客様の画面には「確認しています」と出ていました。
 *   名前を決める場所は lib/server/ticketStatus.ts の1つだけです。
 */
function ticketLabel(status: string): string {
  /* 決めた5つのどれでもない値が入っていたら、
     分かったふりをしないこと。まだ途中である、とだけ伝えます */
  return isTicketStatus(status)
    ? TICKET_LABEL_CUSTOMER[status]
    : "確認しています";
}

export async function listTickets(
  tenantId: string,
  userId: string,
): Promise<TicketView[]> {
  const r = await db().execute({
    sql: `SELECT id, subject, body, status, answer, answered_by,
                 answered_at, created_at
            FROM support_tickets
           WHERE tenant_id = ? AND user_id = ?
           ORDER BY created_at DESC, id DESC`,
    args: [tenantId, userId],
  });

  const ids = (r.rows as Row[]).map((t) => str(t.id));

  /* やり取りを、まとめて1回で読む。
     ★1件ずつ読みに行かないこと。問い合わせが20件あれば20往復になります */
  const msgs = new Map<string, TicketMessageView[]>();
  if (ids.length > 0) {
    const m = await db().execute({
      /*
       * ★AIの下書き（author_kind = 'AI'）を、ここへ混ぜないこと。
       *
       *   AIが作るのは「下書き」です。まだ誰も送っていません。
       *   人が読んで、直して、送信を押したときにだけ、
       *   'STAFF' として別の1行が入ります。
       *
       *   2026-08-27、ここで author_kind を絞っていなかったため、
       *   AIが下書きを作った瞬間に、その文がお客様の画面へ
       *   「サポート担当」として出ていました。
       *   担当者はまだ何も送っていないのに、です。
       *   下書きの中身が違っていても、取り消せません。
       *
       *   「AIか人か」をお客様に見せない方針（下の from）と、
       *   「下書きは出さない」は、別の話です。混ぜないでください。
       */
      sql: `SELECT ticket_id, seq, author_kind, body, created_at
              FROM ticket_messages
             WHERE tenant_id = ? AND ticket_id IN (${ids.map(() => "?").join(",")})
               AND author_kind <> 'AI'
             ORDER BY ticket_id, seq`,
      args: [tenantId, ...ids],
    });
    for (const row of m.rows as Row[]) {
      const tid = str(row.ticket_id);
      const mine = str(row.author_kind) === "CUSTOMER";
      const list = msgs.get(tid) ?? [];
      list.push({
        seq: Number(row.seq ?? 0),
        /* ★AI と 担当者 を、お客様の画面で分けないこと。
             分けると「これはAIだから読まなくていい」と思われます。
             送ると決めたのは、どちらの場合も人です */
        from: mine ? "お客様" : "サポート担当",
        mine,
        body: str(row.body),
        createdAt: str(row.created_at),
      });
      msgs.set(tid, list);
    }
  }

  return (r.rows as Row[]).map((t) => {
    const st = str(t.status);
    return {
      id: str(t.id),
      subject: str(t.subject),
      body: str(t.body),
      status: st,
      statusLabel: ticketLabel(st),
      answer: nul(t.answer),
      answeredBy: nul(t.answered_by),
      answeredAt: nul(t.answered_at),
      createdAt: str(t.created_at),
      messages: msgs.get(str(t.id)) ?? [],
    };
  });
}

/**
 * お問い合わせを1件出す。
 *
 * ★ここで自動返信を作らないこと。
 *   いまAIの回答はつないでいません。
 *   つないでいないのに「回答しました」と出すと、
 *   お客様は答えを待つのをやめます。
 *   受け付けたことだけを、そのまま書きます。
 */
export async function createTicket(args: {
  tenantId: string;
  userId: string;
  subject: string;
  body: string;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ ticketId: string; auditSeq: number }> {
  const at = args.now ?? new Date().toISOString();
  const body = args.body.trim();
  const subject = args.subject.trim() || body.slice(0, 30);

  if (body.length < 4) {
    throw new MyPageError(
      "TOO_SHORT",
      "お問い合わせの内容を、もう少し詳しくご記入ください。",
    );
  }
  if (body.length > 2000) {
    throw new MyPageError(
      "TOO_LONG",
      "お問い合わせの内容が長すぎます（2000文字まで）。",
    );
  }

  return withWriteTx(async (tx) => {
    const cu = await tx.execute({
      sql: `SELECT id, name, status FROM customers WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.userId],
    });
    if (cu.rows.length === 0) {
      throw new MyPageError("NO_CUSTOMER", "会員情報が見つかりません。");
    }
    const c = cu.rows[0] as Row;

    const ticketId = id("tkt");

    /* 分類は、分かるときだけ入れる。
       ★分からないものを「その他」で埋めないこと。
         埋めると「その他」が山になり、分類の意味が無くなります。
         分からないときは null のままにして、人が決めます */
    const category = guessCategory(subject, body);

    await tx.execute({
      /* ★status は 'NEW'。以前の 'OPEN' は、
         管理画面の一覧にも、状態の絞り込みにも出てこない名前でした */
      sql: `INSERT INTO support_tickets
              (id, tenant_id, user_id, subject, body, status,
               category, priority, needs_human, created_at, updated_at)
            VALUES (?,?,?,?,?, 'NEW', ?, 'NORMAL', 0, ?, ?)`,
      args: [
        ticketId,
        args.tenantId,
        args.userId,
        subject,
        body,
        category,
        at,
        at,
      ],
    });

    /* ★やり取りの1件目として、必ず残すこと。
         support_tickets.body にしか無いと、
         2通目以降と並べて読めません（時系列にならない） */
    await tx.execute({
      sql: `INSERT INTO ticket_messages
              (id, tenant_id, ticket_id, seq, author_kind,
               author_id, author_name, body, sources, created_at)
            VALUES (?,?,?, 1, 'CUSTOMER', ?, ?, ?, NULL, ?)`,
      args: [
        id("tmsg"),
        args.tenantId,
        ticketId,
        args.userId,
        str(c.name),
        body,
        at,
      ],
    });

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      /* ★「問い合わせが来た」と「AIが下書きした」と「人が返信した」を、
           1種類の記録にまとめないこと。
           苦情になったとき、誰が書いた文なのかを必ず聞かれます */
      action: "TICKET_CREATED",
      target: ticketId,
      summary: "お問い合わせを受け付けました。",
      after: subject,
      requestId: args.requestId,
      data: {
        ticketId,
        userId: args.userId,
        userName: str(c.name),
        category,
        length: body.length,
      },
    });

    return { ticketId, auditSeq: audit.seq };
  });
}
