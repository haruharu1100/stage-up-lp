/**
 * 管理画面の数字を、ここ1か所だけで数える。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ「1か所」でなければならないのか
 * ═══════════════════════════════════════════════════════
 *
 *   同じ「未発送」という数が、いま3か所に出ます。
 *
 *       ダッシュボードのカード
 *       今日やること
 *       AIオペレーターの報告
 *
 *   3か所が、それぞれ自分で数えたらどうなるか。
 *   必ずずれます。しかも、ずれ方がいちばん悪い形になります。
 *   片方が「0件」、片方が「14件」と出ます。
 *
 *   そうなったとき、運営の方は
 *   「どちらが本当なのか」を確かめる方法を持ちません。
 *   そして、どちらも見なくなります。
 *
 *   数字が違っている画面は、間違っている画面より たちが悪いです。
 *   間違いなら直せますが、信じてもらえない画面は、
 *   直しても もう見てもらえないからです。
 *
 *   ★だから、数えるのはこのファイルだけにします。
 *     画面の側で数え直さないこと。合計し直さないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★「見えない」と「0件」を、絶対に混ぜないこと
 * ═══════════════════════════════════════════════════════
 *
 *   権限が無くて見せられない数は、null で返します。0 にしません。
 *
 *   0 と書くと、画面は「異常なし」と読みます。
 *   本当は「見ていない」だけなのに、片づいたことにされます。
 *   片づいたことにされた仕事は、誰もやりません。
 *
 *   数えられなかったときも同じです。
 *   「たぶんこれくらい」を作らないこと。
 *   作った瞬間に、この画面は嘘をつきはじめます。
 *
 * ═══════════════════════════════════════════════════════
 * ★見本データを、ここへ書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ここに書いてよいのは、DBに聞いた答えだけです。
 *   DBが空なら 0 を返します。それが正しい姿です。
 *   空だからといって、それらしい数字で埋めないこと。
 */

import { can, type Role } from "@/lib/permissions";
import { countUnassignedItems, countUnshipped } from "@/lib/server/shipments";
import { rtpDangers } from "@/lib/server/rtpMonitor";

/* ══════════════════════════════════════════════
   返すもの

   ★number | null であることに意味があります。
     null は「見せられない・数えられない」。0 は「本当に0件」。
     この2つを、画面側でも最後まで分けて扱ってください。
   ══════════════════════════════════════════════ */
export type AdminSummary = {
  /** お金 */
  revenueToday: number | null;
  revenueMonth: number | null;
  grossProfitMonth: number | null;

  /** 動き */
  playsToday: number | null;
  customersTotal: number | null;
  gachasPublished: number | null;

  /** 仕事の残り */
  unshippedShipments: number;
  unassignedItems: number;
  ordersTotal: number;
  ordersPending: number;
  ordersUnpaid: number;
  ordersToday: number;

  /**
   * お客様が、発送かポイント交換かをまだ選んでいない景品の数。
   *
   * ★これを「やること」に入れないこと。
   *   待っているのはお客様であって、運営ではありません。
   *   運営の作業一覧に混ぜると、片づかない用件が毎日並びます。
   */
  prizesUnchosen: number | null;

  /** 対応の残り */
  supportOpen: number | null;
  supportHumanReview: number | null;

  /** 危ないもの */
  fraudHighRisk: number | null;
  rtpDangerCount: number | null;
  rtpWarnCount: number | null;
  rtpAlerts: Awaited<ReturnType<typeof rtpDangers>> | null;
};

/** 数にする。null や undefined は 0 として扱う（SQLのSUMは空だとNULLを返すため） */
const n = (v: unknown) => Number(v ?? 0);

/**
 * その日の「今日」と「今月」を、文字で作る。
 *
 * ★日付の切り方を、画面ごとに変えないこと。
 *   ここで作った文字だけを使います。
 *   created_at は ISO文字列（2026-08-26T...）で入っているので、
 *   前から10文字が「今日」、7文字が「今月」になります。
 */
function kyouToKongetsu() {
  const iso = new Date().toISOString();
  return { kyou: iso.slice(0, 10), kongetsu: iso.slice(0, 7) };
}

/**
 * 管理画面の数字を、まとめて数える。
 *
 * @param tenantId どの会社の数字か。★必ず渡すこと。
 *   渡し忘れると、他社の数字が混ざります。
 *   混ざったことは、画面を見ても分かりません。
 * @param role 見ている人の役割。見せてよい数だけを数えます。
 */
export async function adminSummary(
  tenantId: string,
  role: Role | null,
): Promise<AdminSummary> {
  const { db } = await import("@/lib/server/db");
  const { kyou, kongetsu } = kyouToKongetsu();

  /* 何を見せてよいか。ここで先に決めて、下では迷わない */
  const mieru = {
    gacha: role !== null && can(role, "gacha.view"),
    support: role !== null && can(role, "support.view"),
    fraud: role !== null && can(role, "fraud.view"),
  };

  /*
    ★売上と粗利は「ガチャを見る権限」で守ること。
      売上と、いくら返したか（＝粗利）は、
      経営の中身がそのまま読める数字です。
      閲覧だけの担当者に、既定で見せてよいものではありません。
  */

  const [
    unshipped,
    unassigned,
    orders,
    draws,
    customers,
    unchosen,
    gachas,
    support,
    fraud,
    dangers,
  ] = await Promise.all([
    countUnshipped(tenantId),
    countUnassignedItems(tenantId),

    /* 注文 */
    db().execute({
      sql: `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN order_status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN payment_status = 'UNPAID'
                        AND order_status <> 'CANCELLED' THEN 1 ELSE 0 END) AS unpaid,
              SUM(CASE WHEN substr(ordered_at, 1, 10) = ? THEN 1 ELSE 0 END) AS today
            FROM orders
           WHERE tenant_id = ?`,
      args: [kyou, tenantId],
    }),

    /*
      抽選から、売上・返した額・引いた回数を数える。

      ★売上を gachas.revenue から取らないこと。
        あちらは「そのガチャの通算」なので、
        「今日いくら売れたか」には答えられません。
        1回ずつの記録（draws）だけが、日付を持っています。

      ★粗利＝ 売った額 − お客様へ返した額（景品の値 ＋ 返したポイント）。
        返した額を引き忘れると、粗利が実際より大きく出ます。
        大きく出た粗利を見て値段を決めると、そのまま損になります。
    */
    mieru.gacha
      ? db().execute({
          sql: `SELECT
                  SUM(CASE WHEN substr(created_at, 1, 10) = ?
                           THEN point_spent ELSE 0 END) AS revenue_today,
                  SUM(CASE WHEN substr(created_at, 1, 7) = ?
                           THEN point_spent ELSE 0 END) AS revenue_month,
                  SUM(CASE WHEN substr(created_at, 1, 7) = ?
                           THEN prize_value + point_returned ELSE 0 END) AS returned_month,
                  SUM(CASE WHEN substr(created_at, 1, 10) = ?
                           THEN play_count ELSE 0 END) AS plays_today
                FROM draws
               WHERE tenant_id = ?`,
          args: [kyou, kongetsu, kongetsu, kyou, tenantId],
        })
      : null,

    /* 会員数。★止めた人も会社の会員なので、内訳で分けて返す */
    db().execute({
      sql: `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active
            FROM customers
           WHERE tenant_id = ?`,
      args: [tenantId],
    }),

    /* まだ受け取り方法を選んでいない景品 */
    mieru.gacha
      ? db().execute({
          sql: `SELECT COUNT(*) AS unchosen
                  FROM prizes
                 WHERE tenant_id = ? AND status = 'UNCHOSEN'`,
          args: [tenantId],
        })
      : null,

    /* 公開中のガチャ */
    mieru.gacha
      ? db().execute({
          sql: `SELECT COUNT(*) AS published
                  FROM gachas
                 WHERE tenant_id = ? AND status = 'PUBLISHED'`,
          args: [tenantId],
        })
      : null,

    /*
      問い合わせ。

      ★「終わっていないもの」を数えること。
        RESOLVED 以外は、まだ誰かが待っています。
    */
    mieru.support
      ? db().execute({
          sql: `SELECT
                  SUM(CASE WHEN status <> 'RESOLVED' THEN 1 ELSE 0 END) AS open_count,
                  SUM(CASE WHEN status = 'HUMAN_REVIEW' THEN 1 ELSE 0 END) AS human_review
                FROM support_tickets
               WHERE tenant_id = ?`,
          args: [tenantId],
        })
      : null,

    /*
      危ない会員。

      ★まだ人が見ていないもの（OPEN）だけを数えること。
        処理済みまで数えると、数が減らないので、
        いつまでも赤いままになります。
        減らない警告は、そのうち誰も見なくなります。
    */
    mieru.fraud
      ? db().execute({
          sql: `SELECT COUNT(DISTINCT user_id) AS high
                  FROM fraud_flags
                 WHERE tenant_id = ?
                   AND status = 'OPEN'
                   AND severity = 'HIGH'`,
          args: [tenantId],
        })
      : null,

    mieru.gacha ? rtpDangers(tenantId) : null,
  ]);

  const o = (orders.rows[0] ?? {}) as Record<string, unknown>;
  const d = (draws?.rows[0] ?? {}) as Record<string, unknown>;
  const c = (customers.rows[0] ?? {}) as Record<string, unknown>;
  const u = (unchosen?.rows[0] ?? {}) as Record<string, unknown>;
  const g = (gachas?.rows[0] ?? {}) as Record<string, unknown>;
  const s = (support?.rows[0] ?? {}) as Record<string, unknown>;
  const f = (fraud?.rows[0] ?? {}) as Record<string, unknown>;

  return {
    revenueToday: draws ? n(d.revenue_today) : null,
    revenueMonth: draws ? n(d.revenue_month) : null,
    grossProfitMonth: draws
      ? n(d.revenue_month) - n(d.returned_month)
      : null,

    playsToday: draws ? n(d.plays_today) : null,
    customersTotal: n(c.total),
    gachasPublished: gachas ? n(g.published) : null,

    unshippedShipments: unshipped,
    unassignedItems: unassigned,
    ordersTotal: n(o.total),
    ordersPending: n(o.pending),
    ordersUnpaid: n(o.unpaid),
    ordersToday: n(o.today),
    prizesUnchosen: unchosen ? n(u.unchosen) : null,

    supportOpen: support ? n(s.open_count) : null,
    supportHumanReview: support ? n(s.human_review) : null,

    fraudHighRisk: fraud ? n(f.high) : null,
    rtpDangerCount: dangers
      ? dangers.filter((x) => x.level === "DANGER").length
      : null,
    rtpWarnCount: dangers
      ? dangers.filter((x) => x.level === "WARN").length
      : null,
    rtpAlerts: dangers,
  };
}
