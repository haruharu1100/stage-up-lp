/**
 * お知らせの送り口（Notification Provider）。
 *
 * ═══════════════════════════════════════════════════════
 * ★いまは、外の会社へ1通も送りません
 * ═══════════════════════════════════════════════════════
 *
 *   メール会社・SMS会社へは、まだつないでいません。
 *   つないでいないのに「送信済み」とだけ書くのが、
 *   いちばん危ない状態です。読んだ人は届いたと思います。
 *
 *   なので、いまは Mock（お手本）だけを使い、
 *   記録には provider = "MOCK" と、はっきり残します。
 *   画面にも「外部送信はまだです」と出します。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、お知らせを「表」にするのか
 * ═══════════════════════════════════════════════════════
 *
 *   メールは、届いたかどうかをこちらから確かめられません。
 *   迷惑メールに入れば、お客様は永久に気づきません。
 *   そのとき「確かにお出ししました」と言える唯一の根拠は、
 *   出した記録が自分の手元にあることです。
 *
 *   だから、順番はこうします。
 *
 *       発送が確定した
 *         ↓
 *       お知らせを作る（notifications に1行）
 *         ↓
 *       送り口へ渡す（いまは Mock。将来ここだけ差し替える）
 *         ↓
 *       お客様のマイページに出る
 *
 *   3段目を外の会社に替えても、1・2・4段目は変わりません。
 *
 * ═══════════════════════════════════════════════════════
 * ★同じ出来事で、2通目を作らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   運営が「発送済み」を押し直すことは必ずあります。
 *   そのたびにお知らせが増えると、お客様には
 *   同じ文面が何度も並びます。数が多いほど不安になります。
 *
 *   だから dedupe_key（出来事の名札）を付け、
 *   データベースの決まりとして2通目を作れなくします。
 *   画面側の注意では、いつか必ず抜けます。
 */

import type { Transaction } from "@libsql/client";
import { appendAuditTx } from "./audit";
import { db } from "./db";
import { id } from "./ids";

/* ══════════════════════════════════════════════
   種類
   ══════════════════════════════════════════════ */

export type NotifyKind =
  /** 発送が確定した（出荷した） */
  | "SHIPMENT_SHIPPED"
  /** 追跡番号が付いた */
  | "SHIPMENT_TRACKING"
  /** お届けが終わった */
  | "SHIPMENT_DELIVERED"
  /** 発送を取り消した */
  | "SHIPMENT_CANCELLED";

export type NotifyChannel = "INAPP" | "EMAIL" | "SMS";
export type NotifyStatus = "QUEUED" | "SENT" | "FAILED";

export type NotificationView = {
  id: string;
  kind: NotifyKind | string;
  channel: NotifyChannel | string;
  provider: string;
  status: NotifyStatus | string;
  title: string;
  body: string;
  refKind: string | null;
  refId: string | null;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
  /** 外の配信会社へ本当に出したか。Mock のあいだは、必ず false */
  reallySent: boolean;
};

/* ══════════════════════════════════════════════
   送り口（差し替えるのは、ここ1か所だけ）
   ══════════════════════════════════════════════ */

export type OutgoingMessage = {
  channel: NotifyChannel;
  to: string;
  title: string;
  body: string;
};

export type SendResult = {
  provider: string;
  status: NotifyStatus;
  ref: string | null;
  /** 外の会社へ本当に出したか */
  reallySent: boolean;
};

export type NotifyProvider = {
  name: string;
  send: (m: OutgoingMessage) => Promise<SendResult>;
};

/**
 * Mock の送り口。
 *
 * ★ここで「送った」と嘘をつかないこと。
 *   reallySent は false のままにします。
 *   この1つの値が、あとで
 *   「お客様には届いていたはずだ」という誤解を防ぎます。
 */
export const mockProvider: NotifyProvider = {
  name: "MOCK",
  async send(m) {
    /* 外へは1バイトも出しません。サーバーの記録に書くだけです */
    console.info(
      [
        "──────── お知らせ（Mock・外部へは送っていません） ────────",
        `経路　： ${m.channel}`,
        `宛先　： ${m.to || "（未登録）"}`,
        `件名　： ${m.title}`,
        "本文　：",
        m.body,
        "──────────────────────────────────────────────",
      ].join("\n"),
    );
    return {
      provider: "MOCK",
      status: "SENT",
      ref: `mock_${id("ntf").slice(-12)}`,
      reallySent: false,
    };
  },
};

/**
 * いま使う送り口を決める。
 *
 * ★既定を「本物」にしないこと。
 *   設定を1つ入れ忘れただけで、確認作業のお知らせが
 *   実在する誰かへ飛びます。
 *   はっきり指定されたときだけ、本物を使います。
 *   （その本物は、まだ実装していません。黙って成功を返さず止めます）
 */
export function provider(): NotifyProvider {
  const want = (process.env.NOTIFY_PROVIDER ?? "MOCK").trim().toUpperCase();
  if (want === "MOCK") return mockProvider;

  return {
    name: want,
    async send() {
      throw new Error(
        `お知らせの配信会社「${want}」は、まだつないでいません（lib/server/notify.ts）。`,
      );
    },
  };
}

/* ══════════════════════════════════════════════
   作る
   ══════════════════════════════════════════════ */

export type NotifyInput = {
  tenantId: string;
  userId: string;
  kind: NotifyKind;
  title: string;
  body: string;
  refKind?: string;
  refId?: string;
  /** 同じ出来事で2通目を作らないための名札 */
  dedupeKey: string;
  at: string;
  requestId?: string;
  actor: {
    kind: "ADMIN" | "CUSTOMER" | "SYSTEM";
    id: string;
    name: string;
    role: string;
  };
};

/**
 * お知らせを1件作り、送り口へ渡す。
 *
 * ★同じ書き込みの中で呼ぶこと（tx を受け取ります）。
 *   発送の確定とお知らせを別々に書くと、
 *   途中で落ちたときに「発送済みなのにお知らせが無い」か、
 *   「お知らせだけ届いて、発送は無かったこと」になります。
 *
 * @returns つくったか（既に同じ出来事のお知らせがあれば created=false）
 */
export async function notifyTx(
  tx: Transaction,
  input: NotifyInput,
): Promise<{ id: string | null; created: boolean }> {
  /* 宛先（いまは記録用。Mock は外へ出しません） */
  const cu = await tx.execute({
    sql: `SELECT email, name FROM customers WHERE tenant_id = ? AND id = ?`,
    args: [input.tenantId, input.userId],
  });
  const to = String(
    (cu.rows[0] as Record<string, unknown> | undefined)?.email ?? "",
  );

  const p = provider();
  const sent = await p.send({
    channel: "INAPP",
    to,
    title: input.title,
    body: input.body,
  });

  const nid = id("ntf");
  try {
    await tx.execute({
      sql: `INSERT INTO notifications
              (id, tenant_id, user_id, kind, channel, provider, provider_ref,
               status, title, body, ref_kind, ref_id,
               created_at, sent_at, read_at, dedupe_key)
            VALUES (?,?,?,?, 'INAPP', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      args: [
        nid,
        input.tenantId,
        input.userId,
        input.kind,
        sent.provider,
        sent.ref,
        sent.status,
        input.title,
        input.body,
        input.refKind ?? null,
        input.refId ?? null,
        input.at,
        sent.status === "SENT" ? input.at : null,
        input.dedupeKey,
      ],
    });
  } catch (e) {
    /* ★UNIQUE に当たったら、それは「もう出してある」ということ。
         失敗にしないこと。ここで例外にすると、
         発送済みへ進める操作そのものが、2回目から止まります。 */
    if (/UNIQUE|constraint/i.test(String((e as Error)?.message ?? e))) {
      return { id: null, created: false };
    }
    throw e;
  }

  await appendAuditTx(tx, {
    tenantId: input.tenantId,
    at: input.at,
    actorKind: input.actor.kind,
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    action: "NOTIFICATION_CREATE",
    target: nid,
    summary: `お知らせを作りました：${input.title}`,
    after: input.body,
    requestId: input.requestId,
    data: {
      kind: input.kind,
      channel: "INAPP",
      provider: sent.provider,
      /* ★この1行を消さないこと。
           あとで記録を読む人が、
           「本当に外へ出たのか」を判断できなくなります */
      reallySent: sent.reallySent,
      refKind: input.refKind ?? "",
      refId: input.refId ?? "",
      dedupeKey: input.dedupeKey,
    },
  });

  return { id: nid, created: true };
}

/* ══════════════════════════════════════════════
   読む
   ══════════════════════════════════════════════ */

const str = (v: unknown) => String(v ?? "");
const nul = (v: unknown) => (v == null ? null : String(v));

/**
 * ご自身のお知らせを、新しい順に読む。
 *
 * ★userId は、必ず呼び出し側がクッキーから渡すこと。
 *   本文で受け取る作りにすると、1文字書き換えるだけで
 *   他人のお知らせ（＝他人の追跡番号）が読めます。
 */
export async function listNotifications(
  tenantId: string,
  userId: string,
  limit = 50,
): Promise<NotificationView[]> {
  const r = await db().execute({
    sql: `SELECT id, kind, channel, provider, status, title, body,
                 ref_kind, ref_id, created_at, sent_at, read_at
            FROM notifications
           WHERE tenant_id = ? AND user_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
    args: [tenantId, userId, limit],
  });

  return (r.rows as Record<string, unknown>[]).map((n) => ({
    id: str(n.id),
    kind: str(n.kind),
    channel: str(n.channel),
    provider: str(n.provider),
    status: str(n.status),
    title: str(n.title),
    body: str(n.body),
    refKind: nul(n.ref_kind),
    refId: nul(n.ref_id),
    createdAt: str(n.created_at),
    sentAt: nul(n.sent_at),
    readAt: nul(n.read_at),
    /* ★provider を見て決めること。
         status が "SENT" でも、Mock なら外へは出ていません。 */
    reallySent: str(n.provider) !== "MOCK" && str(n.status) === "SENT",
  }));
}

/** まだ読んでいないお知らせの数 */
export async function unreadCount(
  tenantId: string,
  userId: string,
): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM notifications
           WHERE tenant_id = ? AND user_id = ? AND read_at IS NULL`,
    args: [tenantId, userId],
  });
  return Number((r.rows[0] as Record<string, unknown>)?.n ?? 0);
}

/**
 * 読んだ印を付ける。
 *
 * ★user_id を条件に必ず入れること。
 *   入れないと、他人のお知らせを既読にできます。
 *   既読にできるということは、相手の画面から
 *   「新しいお知らせ」の印を消せる、ということです。
 */
export async function markAllRead(
  tenantId: string,
  userId: string,
  at = new Date().toISOString(),
): Promise<number> {
  const r = await db().execute({
    sql: `UPDATE notifications SET read_at = ?
           WHERE tenant_id = ? AND user_id = ? AND read_at IS NULL`,
    args: [at, tenantId, userId],
  });
  return Number(r.rowsAffected ?? 0);
}
