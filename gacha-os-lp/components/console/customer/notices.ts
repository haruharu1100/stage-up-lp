/**
 * お客様へのお知らせ（通知）。
 *
 * ═══════════════════════════════════════════════════════
 * ★お知らせ用のデータを、別に持たないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「通知テーブル」を別に作って、操作のたびに1行書き足す作りは、
 *   一見きれいですが、必ず書き忘れが出ます。
 *   書き忘れた操作は、お客様の画面に一生出てきません。
 *   しかも、書き忘れていること自体に誰も気づけません。
 *
 *   ここでは逆にしています。
 *   発送依頼・問い合わせ・当たった商品・公開中のガチャ。
 *   すでにある事実から、そのつど組み立てます。
 *   事実が変われば、お知らせも同じ瞬間に変わります。
 *   ずれる余地がありません。
 *
 * ═══════════════════════════════════════════════════════
 * ★「対応が必要か」を、お知らせ自身が持つこと
 * ═══════════════════════════════════════════════════════
 *
 *   バッジの数字を「まだ開いていない件数」にすると、
 *   1回開いた瞬間に0になります。
 *   受け取り方法を選んでいない商品が3点あっても、0です。
 *
 *   ここでは、バッジの数字を「まだ手を動かしていない件数」にします。
 *   選べば減ります。返事を読んでも減りません。
 *   減らしたければ、やることを済ませるしかありません。
 *   それが、お客様にとって正しい数字です。
 *
 * ═══════════════════════════════════════════════════════
 * ★他人の分を、絶対に混ぜないこと
 * ═══════════════════════════════════════════════════════
 *
 *   通知はいちばん「一覧で全部出す」を書きたくなる場所です。
 *   ここで userId の絞り込みを1つ忘れると、
 *   他の会員の当選内容と発送状況が、そのまま画面に出ます。
 *   だから、この関数は必ず userId を受け取る形にしてあります。
 */

import type { ConsoleState } from "@/lib/console/state";
import { ORDER_STATUS_LABEL } from "@/lib/console/support";
import { cardOf } from "./catalog";

export type NoticeKind = "prize" | "order" | "support" | "gacha";

export type Notice = {
  id: string;
  kind: NoticeKind;
  /** いつの出来事か（並べ替えに使う） */
  at: string;
  title: string;
  body: string;
  /**
   * まだお客様が手を動かしていないか。
   * ここが true のものだけを、バッジの数字に数えます。
   */
  todo: boolean;
  /** 押したときの行き先 */
  go: NoticeGo;
};

export type NoticeGo =
  | { to: "prize"; id: string }
  | { to: "prizes" }
  | { to: "orders" }
  | { to: "support" }
  | { to: "gacha"; id: string };

export const NOTICE_LABEL: Record<NoticeKind, string> = {
  prize: "当選",
  order: "発送",
  support: "問い合わせ",
  gacha: "ガチャ",
};

/**
 * この方あての、お知らせ一覧。新しい順。
 *
 * ★ガチャのお知らせを、いちばん上に固定しないこと。
 *   新着ガチャは運営から見れば重要ですが、
 *   お客様にとっては「まだ受け取っていない商品」のほうが上です。
 *   店の都合で並べ替えると、大事な連絡が下へ流れます。
 */
export function noticesOf(s: ConsoleState, userId: string): Notice[] {
  const out: Notice[] = [];

  /* ── 当たった商品 ── */
  for (const p of s.prizes) {
    if (p.userId !== userId) continue;

    if (p.status === "UNCHOSEN") {
      out.push({
        id: `n-prize-${p.id}`,
        kind: "prize",
        at: p.wonAt,
        title: `${p.grade}賞が当たっています`,
        body: `${p.name}。現物のお届けか、ポイントへの交換をお選びください。`,
        todo: true,
        go: { to: "prize", id: p.id },
      });
    } else if (p.status === "EXCHANGED") {
      out.push({
        id: `n-prize-${p.id}`,
        kind: "prize",
        at: p.exchangedAt ?? p.wonAt,
        title: "ポイントへの交換が完了しました",
        body: `${p.name}を ${p.exchangePt.toLocaleString()}pt に交換しました。`,
        todo: false,
        go: { to: "prizes" },
      });
    }
  }

  /* ── 発送 ──
     ★状態が進むたびに、文言が変わること。
       「準備中」のまま何日も動かない画面は、
       止まっているのか進んでいるのかが分かりません */
  for (const o of s.orders) {
    if (o.userId !== userId) continue;
    const label = ORDER_STATUS_LABEL[o.status];
    const body =
      o.status === "DELIVERED"
        ? "お届けが完了しました。ご確認ください。"
        : o.tracking
          ? `${o.carrier ?? "配送業者"}／お問い合わせ番号 ${o.tracking}`
          : "発送の準備を進めています。追跡番号が決まりましたら、ここに出ます。";
    out.push({
      id: `n-order-${o.id}`,
      kind: "order",
      at: o.requestedAt,
      title: `${o.prize}：${label}`,
      body,
      todo: false,
      go: { to: "orders" },
    });
  }

  /* ── 問い合わせ ──
     ★AIが答えたのか、人が答えたのかを必ず書くこと。
       同じ文面でも、受け取る側の重みが変わります */
  for (const t of s.tickets) {
    if (t.userId !== userId) continue;
    if (t.reply) {
      out.push({
        id: `n-ticket-${t.id}`,
        kind: "support",
        at: t.at,
        title: `お問い合わせに回答しました（${t.replyBy === "HUMAN" ? "担当者" : "AI"}）`,
        body: t.subject,
        todo: false,
        go: { to: "support" },
      });
    } else {
      out.push({
        id: `n-ticket-${t.id}`,
        kind: "support",
        at: t.at,
        title: "お問い合わせを承りました",
        body: `${t.subject}。担当者が確認しています。`,
        todo: false,
        go: { to: "support" },
      });
    }
  }

  /* ── ガチャ ──
     ★煽らないこと。
       「いまだけ」「急いで」は書きません。書けるのは事実だけです。
       残り口数と、公開したという事実。判断はお客様がします */
  for (const g of s.gachas) {
    if (g.status !== "PUBLISHED" || g.left <= 0) continue;
    const c = cardOf(g);
    if (c.fresh) {
      out.push({
        id: `n-gacha-new-${g.id}`,
        kind: "gacha",
        at: `${g.publishedAt ?? ""} 00:00`,
        title: "新しいガチャを公開しました",
        body: `${g.title}／1回 ${g.price.toLocaleString()}pt`,
        todo: false,
        go: { to: "gacha", id: g.id },
      });
    } else if (c.ending) {
      out.push({
        id: `n-gacha-end-${g.id}`,
        kind: "gacha",
        at: `${g.publishedAt ?? ""} 00:00`,
        title: "残りわずかになりました",
        body: `${g.title}／残り ${g.left.toLocaleString()}口`,
        todo: false,
        go: { to: "gacha", id: g.id },
      });
    }
  }

  /* 新しい順。同じ時刻なら、やることが残っている方を上に */
  return out.sort((a, b) => {
    if (a.todo !== b.todo) return a.todo ? -1 : 1;
    return b.at.localeCompare(a.at);
  });
}

/** バッジに出す数字（まだ手を動かしていない件数） */
export function todoCount(list: Notice[]): number {
  return list.filter((n) => n.todo).length;
}
