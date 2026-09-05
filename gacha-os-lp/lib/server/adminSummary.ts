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
import {
  pointMismatchCount,
  pointPendingCount,
} from "@/lib/server/pointAdmin";
import { ticketCounts } from "@/lib/server/ticketAdmin";
import { reversalSummary } from "@/lib/server/paymentReversal";

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

  /**
   * 対応の残り。
   *
   * ★数え方を、ここに書き写さないこと。
   *   lib/server/ticketAdmin.ts の ticketCounts() を必ず通します。
   *   問い合わせ画面とダッシュボードで数がずれると、
   *   どちらが本当なのかを調べる人はいません。両方が信じられなくなります。
   */
  supportOpen: number | null;
  supportHumanReview: number | null;
  /** まだ誰も何もしていないもの */
  supportNew: number | null;
  /** 高優先度のうち、まだ終わっていないもの */
  supportHigh: number | null;

  /**
   * ポイントの残高と、ポイント台帳の合計が食い違っている会員の数。
   *
   * ★これを「危険度」に混ぜないこと。
   *   混ぜると、会員管理の「高Riskの会員」とダッシュボードの数がずれます。
   *   食い違いは、危険な会員の話ではなく、
   *   「記録に残っていないのにお金が動いた」という別の話です。
   *
   * ★0 と null を分けること。
   *   0 は「全員ぶん合っている」。null は「見る権限が無くて確かめられなかった」。
   *   確かめていないことを「合っている」と書かないでください。
   */
  pointMismatch: number | null;
  /** 承認待ちのポイント調整の数 */
  pointPending: number | null;

  /**
   * カード会社などから、あとでお金を引き戻された件数（強制取消）。
   *
   * ★件数だけを見て安心しないこと。
   *   下の reversalUnrecovered を必ず並べて出します。
   *   「1件だけれど30万円取りはぐれた」に気づけなくなります。
   */
  reversalCount: number | null;
  /**
   * 強制取消のうち、ポイントを引き戻せなかった額の合計（円）。
   *
   * ★これが、そのまま被害額です。
   *   0 にまるめないこと。0 と null を混ぜないこと。
   */
  reversalUnrecovered: number | null;
  /** 強制取消のあと、まだ人が確認していない会員の数 */
  reversalReviewPending: number | null;

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
    /*
      ★売上・粗利を gacha.view で守らないこと（2026-08-26 に直しました）。

        以前ここは gacha.view で守っていました。
        ところが VIEWER（閲覧のみ）も gacha.view を持っています。
        つまり「守っているつもり」で、誰一人として締め出せていませんでした。

        こういう守りは、無いより悪いです。
        無ければ「守られていない」と分かりますが、
        あるつもりでいると、もう誰も確かめないからです。

        いまは revenue.view で守ります。持っているのは
        SUPER_ADMIN・OPERATOR・FINANCE の3つだけです。
    */
    revenue: role !== null && can(role, "revenue.view"),
    support: role !== null && can(role, "support.view"),
    fraud: role !== null && can(role, "fraud.view"),
    /* ポイントの食い違いは point.view で守ります。
       ★ここだけ別の権限にしないこと。ポイント管理の画面と、
         同じ人に同じ数が見えている必要があります */
    point: role !== null && can(role, "point.view"),
  };

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
    pointMismatch,
    pointPending,
    reversals,
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

      ★引いた回数（plays）と、売れた額（revenue）は、権限が別です。
        回数はガチャの動きなので gacha.view、
        金額は経営の数字なので revenue.view で守ります。
        どちらか片方でも見てよい人がいるので、問い合わせは1回にまとめ、
        返すときに、見せてよいほうだけを取り出します。

      ★引いた回数は COUNT(*) で数えること。play_count を足さないこと。
        （2026-08-26 に、実際に間違えて直しました）

        draws の play_count は「何回ぶん引いたか」ではありません。
        lib/server/draw.ts が、そのガチャで何本目の抽選かを
        1・2・3…と振った通し番号です。

        これを足すと 1+2+3+… になります。
        Preview の画面には「本日引かれた回数 1,615,504回」と出ました。
        1回引いただけで、1797回ぶん増えました。

        恐ろしいのは、この数字が「エラー」ではなく
        「それらしい大きな数」として画面に並ぶことです。
        誰も気づけません。気づいたのは、
        実際に1回引いて前後を比べたからです。

        ★通し番号を、数として足さないこと。
          数えたいときは、行そのものを数えます。
    */
    mieru.gacha || mieru.revenue
      ? db().execute({
          sql: `SELECT
                  SUM(CASE WHEN substr(created_at, 1, 10) = ?
                           THEN point_spent ELSE 0 END) AS revenue_today,
                  SUM(CASE WHEN substr(created_at, 1, 7) = ?
                           THEN point_spent ELSE 0 END) AS revenue_month,
                  SUM(CASE WHEN substr(created_at, 1, 7) = ?
                           THEN prize_value + point_returned ELSE 0 END) AS returned_month,
                  COUNT(CASE WHEN substr(created_at, 1, 10) = ?
                             THEN 1 ELSE NULL END) AS plays_today
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

      ★ここに SQL を書かないこと。
        以前ここには、この画面だけの COUNT が書いてありました。
        問い合わせ画面は ticketAdmin で数えていたので、
        知らない状態が1件でも混ざると、2つの画面で数が変わりました。
        数える場所は ticketCounts() の1つだけにします。
    */
    mieru.support ? ticketCounts(tenantId) : null,

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

    /*
      ポイントの食い違い。

      ★数え方を、ここに書き写さないこと。
        lib/server/pointAdmin.ts の pointMismatchCount() を必ず通します。
        ポイント管理の画面と、ダッシュボードで数がずれると、
        どちらが本当なのかを調べる人はいません。両方が信じられなくなります。
    */
    mieru.point ? pointMismatchCount(tenantId) : null,
    mieru.point ? pointPendingCount(tenantId) : null,

    /*
      カード会社などによる強制取消（チャージバック）。

      ★数え方を、ここに書き写さないこと。
        lib/server/paymentReversal.ts の reversalSummary() を必ず通します。

      ★point.view で守るのは、これがお金の話だからです。
        「誰にいくら取りはぐれたか」は、
        ポイント台帳を見てよい人にだけ見せます。
    */
    mieru.point ? reversalSummary(tenantId) : null,
  ]);

  const o = (orders.rows[0] ?? {}) as Record<string, unknown>;
  const d = (draws?.rows[0] ?? {}) as Record<string, unknown>;
  const c = (customers.rows[0] ?? {}) as Record<string, unknown>;
  const u = (unchosen?.rows[0] ?? {}) as Record<string, unknown>;
  const g = (gachas?.rows[0] ?? {}) as Record<string, unknown>;
  const f = (fraud?.rows[0] ?? {}) as Record<string, unknown>;

  return {
    /*
      ★draws が読めたことと、その人に見せてよいことは、別です。
        引いた回数を見たいだけの人のために問い合わせているので、
        金額はここで、もう一度 revenue.view を確かめてから出します。
    */
    revenueToday: draws && mieru.revenue ? n(d.revenue_today) : null,
    revenueMonth: draws && mieru.revenue ? n(d.revenue_month) : null,
    grossProfitMonth:
      draws && mieru.revenue ? n(d.revenue_month) - n(d.returned_month) : null,

    playsToday: draws && mieru.gacha ? n(d.plays_today) : null,
    customersTotal: n(c.total),
    gachasPublished: gachas ? n(g.published) : null,

    unshippedShipments: unshipped,
    unassignedItems: unassigned,
    ordersTotal: n(o.total),
    ordersPending: n(o.pending),
    ordersUnpaid: n(o.unpaid),
    ordersToday: n(o.today),
    prizesUnchosen: unchosen ? n(u.unchosen) : null,

    supportOpen: support ? support.open : null,
    supportHumanReview: support ? support.humanReview : null,
    supportNew: support ? support.new : null,
    supportHigh: support ? support.high : null,

    /* ★null（見せられない）と 0（全員合っている）を、ここで潰さないこと */
    pointMismatch: pointMismatch,
    pointPending: pointPending,

    reversalCount: reversals ? reversals.count : null,
    reversalUnrecovered: reversals ? reversals.unrecoveredAmount : null,
    reversalReviewPending: reversals ? reversals.reviewPending : null,

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
