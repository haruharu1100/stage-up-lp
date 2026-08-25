/**
 * 追加の本人確認（Step-up）を、どこで求めるかの取り決め。
 *
 * ═══════════════════════════════════════════════════════
 * ★いまは、まだ求めていません。正直に書きます
 * ═══════════════════════════════════════════════════════
 *
 *   お客様側の2段階認証は、まだ実装していません。
 *   ですので、この取り決めは今のところ「求めない」を返します。
 *
 *   では、なぜ先に作るのか。
 *   あとから足そうとすると、判断が散らばるからです。
 *
 *       住所変更の入口に1つ
 *       発送依頼の入口に1つ
 *       高額商品の判定にもう1つ
 *
 *   3か所に別々の条件が書かれると、
 *   1か所直し忘れた日から、そこだけ素通りになります。
 *   素通りしている場所は、外からは見えません。
 *
 *   だから、判断は最初からこの1か所に集めます。
 *   本人確認をつなぐ日は、ここだけを true にします。
 *
 * ═══════════════════════════════════════════════════════
 * ★乗っ取りは、この順番で進みます
 * ═══════════════════════════════════════════════════════
 *
 *       ① 見慣れない端末からログインする
 *       ② お届け先を自分の住所へ書き換える
 *       ③ 高いものを発送させる
 *
 *   ②と③の間が、いちばん短い。
 *   だから「住所を変えた直後の発送依頼」を、別扱いにします。
 */

/** 追加の本人確認が要るか、の答え */
export type StepUpDecision = {
  /** いま求めるか */
  need: boolean;
  /** なぜ求める（求めない）のか。画面と記録の両方に出す */
  reason: string;
  /**
   * 将来つないだときに、求めることになる条件に当てはまっていたか。
   *
   * ★この値を残す理由。
   *   本人確認をつなぐ前でも、「つないでいたら止めていた操作」を
   *   数えられます。つないだ日に何件が止まるのかが、事前に分かります。
   */
  wouldNeed: boolean;
};

/** 本人確認をつないだかどうか。つなぐまでは false */
export function stepUpAvailable(): boolean {
  /* ★既定を true にしないこと。
       つないでいないのに「確認済み」として通すと、
       記録の上だけ本人確認をした形が残ります。 */
  return (process.env.CUSTOMER_STEP_UP ?? "").trim() === "ON";
}

/** 高額とみなす金額（円）。ここを1か所にしておくこと */
export const TAKAGAKU_YEN = 30_000;

/** 住所を変えた直後とみなす時間（分） */
export const ADDRESS_FRESH_MIN = 60;

/**
 * お届け先を変えるとき。
 *
 * ★本来は、ここで必ず求めるべき操作です。
 *   住所の書き換えは、乗っ取りの仕上げの一歩手前だからです。
 */
export function forAddressChange(): StepUpDecision {
  const wouldNeed = true;
  if (!stepUpAvailable()) {
    return {
      need: false,
      reason:
        "お客様側の追加の本人確認は、まだご用意できていません（本番前に必ず有効にします）。",
      wouldNeed,
    };
  }
  return {
    need: true,
    reason: "お届け先の変更は、ご本人の確認が必要です。",
    wouldNeed,
  };
}

/**
 * 発送を依頼するとき。
 *
 * @param totalValue 依頼する商品の合計（円）
 * @param addressChangedAt お届け先を最後に変えた時刻（無ければ null）
 * @param now いまの時刻
 */
export function forShipRequest(input: {
  totalValue: number;
  addressChangedAt: string | null;
  now?: string;
}): StepUpDecision {
  const takai = input.totalValue >= TAKAGAKU_YEN;

  let kawatteSugu = false;
  if (input.addressChangedAt) {
    const t = new Date(input.addressChangedAt).getTime();
    const n = new Date(input.now ?? new Date().toISOString()).getTime();
    if (!Number.isNaN(t) && !Number.isNaN(n)) {
      kawatteSugu = n - t <= ADDRESS_FRESH_MIN * 60 * 1000;
    }
  }

  const wouldNeed = takai || kawatteSugu;
  const naze = kawatteSugu
    ? "お届け先を変更された直後のご依頼のためです。"
    : takai
      ? `お品物の合計が${TAKAGAKU_YEN.toLocaleString("ja-JP")}円以上のためです。`
      : "";

  if (!wouldNeed) {
    return { need: false, reason: "", wouldNeed: false };
  }
  if (!stepUpAvailable()) {
    return {
      need: false,
      reason:
        "お客様側の追加の本人確認は、まだご用意できていません（本番前に必ず有効にします）。",
      wouldNeed,
    };
  }
  return { need: true, reason: `ご本人の確認が必要です。${naze}`, wouldNeed };
}
