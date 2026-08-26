/**
 * 問い合わせの「状態」を、ここ1か所だけで決める。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、わざわざ1つのファイルにするのか
 * ═══════════════════════════════════════════════════════
 *
 *   2026-08-26 に調べたところ、同じ「状態」の名前が
 *   3通り、別々の場所に書かれていました。
 *
 *       DBに入っていた実際の値 …… OPEN だけ
 *       お客様の画面の言い換え …… OPEN / IN_PROGRESS / AI_ANSWERED / HUMAN_REVIEW / DONE
 *       運営の画面の見本データ …… また別の並び
 *
 *   3通りあると、どこかで必ず食い違います。
 *   食い違ったときに何が起きるかというと、
 *   「運営の画面では対応済みなのに、お客様の画面ではずっと受付中」
 *   という状態が生まれます。お客様は待ち続け、運営は気づきません。
 *
 *   ★だから、名前を決めるのはこのファイルだけにします。
 *     新しい状態を足したくなったら、ここに足してください。
 *     画面の側で、独自の名前を作らないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★お客様に見せる言葉と、運営に見せる言葉を分けること
 * ═══════════════════════════════════════════════════════
 *
 *   運営には「AIが一次回答」と出してよいですが、
 *   お客様に「AIが答えました」と出すかどうかは、別の判断です。
 *
 *   ここでは、状態は同じものを使い、
 *   見せる言葉だけを2つ持ちます。
 *   状態そのものを2種類作ると、また食い違いが始まります。
 */

/** 問い合わせの状態。★この5つ以外を、DBに入れないこと */
export const TICKET_STATUSES = [
  "NEW",
  "AI_REPLIED",
  "HUMAN_REVIEW",
  "IN_PROGRESS",
  "RESOLVED",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** 外から来た文字が、決めた5つのどれかであること */
export function isTicketStatus(v: unknown): v is TicketStatus {
  return (
    typeof v === "string" &&
    (TICKET_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * 運営の画面に出す言葉。
 *
 * ★「新規」ではなく「未対応」と書くこと。
 *   新規は、ただの分類です。未対応は、やることです。
 *   一覧を見た人が、次に何をすればよいかが分かる言葉にします。
 */
export const TICKET_LABEL_ADMIN: Record<TicketStatus, string> = {
  NEW: "未対応",
  AI_REPLIED: "AIが一次回答",
  HUMAN_REVIEW: "人の確認が必要",
  IN_PROGRESS: "対応中",
  RESOLVED: "解決済み",
};

/**
 * お客様の画面に出す言葉。
 *
 * ★「未対応」とは書かないこと。
 *   お客様にとっては、放っておかれていると読めます。
 *   実際には受け付けているので、そう伝えます。
 */
export const TICKET_LABEL_CUSTOMER: Record<TicketStatus, string> = {
  NEW: "受け付けいたしました",
  AI_REPLIED: "回答いたしました",
  HUMAN_REVIEW: "担当者が確認しています",
  IN_PROGRESS: "担当者が確認しています",
  RESOLVED: "解決済み",
};

/**
 * まだ誰かが待っている状態か。
 *
 * ★数えるときに、この関数を使うこと。
 *   画面ごとに「RESOLVED 以外」と書き直すと、
 *   状態が増えた日に、片方だけ直し忘れます。
 */
export function isOpenTicket(s: TicketStatus): boolean {
  return s !== "RESOLVED";
}

/**
 * 状態を変えてよいか。
 *
 * ★終わったものを、勝手に「未対応」へ戻さないこと。
 *   戻せてしまうと、対応済みの件数が後から減ります。
 *   減った理由は、記録を全部たどらないと分かりません。
 *   もう一度みてほしいときは、IN_PROGRESS へ戻します。
 */
export function canMoveTicket(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return false;
  if (to === "NEW") return false;
  return true;
}
