/**
 * 【Token（取得枠）の管理】（Phase 3.10・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * 【月の総量ではなく、1分あたりの補充速度で管理する】
 *
 * ご本人の指示（2026-08-25）：
 *   「『月89万Token使える』より『20 Token/分で継続補充される』ことを主軸に
 *     管理してください。月単位の総量だけを見ると、短時間の大量取得で詰まる可能性があります。」
 *
 * これは正しい。Keepa の枠は「月◯◯万」ではなく、**バケツ方式**である。
 *
 *   ・1分ごとに一定量（契約では20）が貯まる
 *   ・貯められる上限がある（補充速度 × 60分ぶん＝1,200）
 *   ・使わなかったぶんは60分で期限切れになり、消える
 *
 * だから「月あたり89万」という数字は、**1分も止まらずに使い続けた場合の合計**でしかない。
 * 現実には、1時間で1,200を使い切ったらそこで止まり、あとは1分に20ずつしか進まない。
 * 月の総量を見ていると、この壁がまったく見えない。
 *
 * このファイルは、すべての判断を「補充速度」と「いまの残り」で行う。
 */

/* ================================================================
 * 契約の形（数字はAPIの応答で上書きされる）
 * ================================================================ */

/**
 * 補充速度の既定値（1分あたり）。
 *
 * ★これは「たぶんこれくらい」ではなく、**API応答の `refillRate` で必ず上書きする**。
 *   ここに書いてあるのは、まだ1回も呼んでいないときに画面へ出すための仮の数字。
 *   実際の値が来たら、そちらだけを信じる。
 */
export const KEEPA_DEFAULT_REFILL_RATE_PER_MIN = 20;

/** 貯められる上限は「補充速度 × 60分」。使わなかったぶんは60分で消える。 */
export const KEEPA_BUCKET_MINUTES = 60;

export function bucketCapacity(refillRatePerMin: number): number {
  return Math.max(0, Math.floor(refillRatePerMin * KEEPA_BUCKET_MINUTES));
}

/* ================================================================
 * 1回の取得にかかる枠
 * ================================================================ */

/**
 * 取得の重さ。**重い順に並べてある。**
 *
 * ★2026-08-25 訂正：数字を公式ドキュメントの実額に合わせた。
 *   以前は `OFFERS: 19` としていたが、これは根拠のない多めの見積もりだった。
 *   公式ドキュメント（`https://keepa.com/api-docs/`）の実額は
 *   **オファー1ページ（最大10件）につき 6**（`stats` は無料、`buybox` `stock` が各+2、`rating` が+1）。
 *   推測値をコードに置いておくと、そのうち事実として扱われる。
 *
 * ここが設計のかなめであることは変わらない。`offers` を全商品に付けると、
 * 補充速度20/分では**1分あたり3商品ぶんしか進まない**。
 * だから既定はオフにしてあり、必要な商品にだけ人が付ける。
 */
export const KEEPA_REQUEST_COSTS = {
  /** 商品1点の基本情報（履歴つき） */
  PRODUCT_BASE: 1,
  /** 統計値を付ける（`stats` パラメータ）。売れ筋順位の下落回数はここに入る。**無料**。 */
  STATS: 0,
  /** カート（Buy Box）の詳細を付ける（`buybox=1`） */
  BUYBOX: 2,
  /**
   * 出品者一覧を付ける（`offers=N`）。1ページ（最大10件）につき6。
   *
   * ※Keepa 側では offers を付けると基本の1は加算されない（オファー0件でも5）。
   *   当システムは `PRODUCT_BASE + OFFERS = 7` と見積もるので、**実額より1多く見積もる**。
   *   見積もりは「投げる前に止めるかどうか」を決めるためのものなので、
   *   少なく見積もって足りなくなるより、多く見積もって余らせる方を選ぶ。
   */
  OFFERS: 6,
} as const;

export type KeepaRequestOptions = {
  /** 統計値（売れ筋順位の下落回数・平均価格など）。既定オン。ほぼ無料。 */
  stats: boolean;
  /** カートの詳細。既定オフ。 */
  buyBox: boolean;
  /** 出品者一覧。既定オフ。**重いので人が明示的に付けたときだけ。** */
  offers: boolean;
};

export const KEEPA_DEFAULT_REQUEST_OPTIONS: KeepaRequestOptions = {
  stats: true,
  buyBox: false,
  offers: false,
};

/**
 * 商品1点あたりの見積もり枠。
 *
 * ★これは「見積もり」であって実額ではない。実際に何を使ったかは、
 *   API応答の `tokensConsumed` に書いてある。**記録するのは実額の方**。
 *   見積もりは「投げる前に止めるかどうか」を決めるためだけに使う。
 */
export function estimateTokenCost(asinCount: number, opt: KeepaRequestOptions): number {
  const per =
    KEEPA_REQUEST_COSTS.PRODUCT_BASE
    + (opt.stats ? KEEPA_REQUEST_COSTS.STATS : 0)
    + (opt.buyBox ? KEEPA_REQUEST_COSTS.BUYBOX : 0)
    + (opt.offers ? KEEPA_REQUEST_COSTS.OFFERS : 0);
  return Math.max(0, Math.floor(asinCount)) * per;
}

/* ================================================================
 * 使いすぎの止め方
 * ================================================================ */

/**
 * 残りがこれを下回ったら、新しい取得を始めない。
 *
 * 0になるまで使い切らない理由：0にすると、次に本当に必要になったとき
 * 「1分に20ずつ」の速度でしか回復せず、身動きが取れなくなる。
 * 少し残しておけば、急ぎの1件はいつでも通せる。
 */
export const KEEPA_MIN_TOKENS_RESERVE = 100;

/** 1日に使ってよい上限。ここに達したらその日は止まる。 */
export const KEEPA_DAILY_TOKEN_BUDGET = 2000;

/** 同じASINを取り直すまでの最短間隔（時間）。連打で枠を溶かさないため。 */
export const KEEPA_MIN_REFETCH_HOURS = 24;

export type TokenGateInput = {
  /** いまの残り（API応答の `tokensLeft`）。まだ1回も呼んでいなければ null。 */
  tokensLeft: number | null;
  /** 1分あたりの補充速度（API応答の `refillRate`）。 */
  refillRatePerMin: number;
  /** 今日すでに使った量。 */
  usedToday: number;
  /** これから使う見積もり。 */
  estimatedCost: number;
};

export type TokenGateResult = {
  allowed: boolean;
  /** 止めた理由・通した理由。画面にそのまま日本語で出す。 */
  reasonJa: string;
  /** この取得は「何分ぶんの補充」に相当するか。月の総量より、こちらを見る。 */
  minutesOfRefill: number;
  /** 足りないとき、あと何分待てば足りるか。 */
  waitMinutes: number | null;
};

/**
 * 投げてよいかを判定する。
 *
 * 【Fail Closed】
 * 残りが分からない（まだ1回も呼んでいない）ときは、**通す**。
 * ただし通すのは、上限が1件に固定されている段階（S1）だからである。
 * 件数の上限は別のところ（`KEEPA_MAX_ASINS_PER_RUN`）で1に固定してあるので、
 * 最初の1回で使いすぎることはない。
 */
export function checkTokenGate(i: TokenGateInput): TokenGateResult {
  const rate = i.refillRatePerMin > 0 ? i.refillRatePerMin : KEEPA_DEFAULT_REFILL_RATE_PER_MIN;
  const minutesOfRefill = i.estimatedCost / rate;

  const base = {
    minutesOfRefill,
    waitMinutes: null as number | null,
  };

  if (i.usedToday + i.estimatedCost > KEEPA_DAILY_TOKEN_BUDGET) {
    return {
      ...base,
      allowed: false,
      reasonJa:
        `今日はすでに${i.usedToday}使っていて、1日の上限（${KEEPA_DAILY_TOKEN_BUDGET}）を超えるので止めました。`
        + '日付が変わればまた使えます。',
    };
  }

  if (i.tokensLeft === null) {
    return {
      ...base,
      allowed: true,
      reasonJa:
        'まだ一度も取得していないため、残り枠が分かりません。'
        + `1件だけ取って残りを確かめます（この1件はおよそ${minutesOfRefill.toFixed(1)}分ぶんの補充にあたります）。`,
    };
  }

  const after = i.tokensLeft - i.estimatedCost;
  if (after < KEEPA_MIN_TOKENS_RESERVE) {
    const need = KEEPA_MIN_TOKENS_RESERVE + i.estimatedCost - i.tokensLeft;
    return {
      ...base,
      allowed: false,
      waitMinutes: Math.ceil(need / rate),
      reasonJa:
        `残りが${i.tokensLeft}しかなく、この取得（見積もり${i.estimatedCost}）をすると`
        + `手元に${KEEPA_MIN_TOKENS_RESERVE}を残せないので止めました。`
        + `1分あたり${rate}ずつ貯まるので、およそ${Math.ceil(need / rate)}分待てば足ります。`,
    };
  }

  return {
    ...base,
    allowed: true,
    reasonJa:
      `残り${i.tokensLeft}。この取得の見積もりは${i.estimatedCost}で、`
      + `1分あたり${rate}ずつ貯まるので、およそ${minutesOfRefill.toFixed(1)}分ぶんの補充にあたります。`,
  };
}

/* ================================================================
 * 画面に出す指標（Keepa API Cost Monitor）
 * ================================================================ */

export type TokenMonitor = {
  /** 1分あたりの補充速度。**いちばん大きく出す数字。** */
  refillRatePerMin: number;
  /** 貯められる上限（補充速度×60分）。 */
  capacity: number;
  /** いまの残り。まだ取得していなければ null。 */
  tokensLeft: number | null;
  /** 今日使った量。 */
  usedToday: number;
  /** 今月使った量。 */
  usedThisMonth: number;
  /** 商品1点あたりの実測平均。取得0件なら null（0にしない）。 */
  avgPerProduct: number | null;
  /** これまでに取得した商品点数（重複を除く）。 */
  productCount: number;
  /** 呼び出した回数。 */
  requestCount: number;
  /**
   * 費用の目安。**参考表示のみ。**
   * 仕入判断にも利益計算にも入れない。推定を利益に混ぜると数字が嘘になる。
   */
  estimatedCostNoteJa: string;
  /** 1行の結論。 */
  headlineJa: string;
};

/**
 * 監視用の1行を作る。
 *
 * 【なぜ「月◯◯万まで使える」と書かないか】
 * 書いた瞬間に、人は「まだ余裕がある」と思って一気に投げる。
 * 実際に効くのは1分あたりの速度なので、そちらを主語にする。
 */
export function tokenHeadline(m: {
  refillRatePerMin: number;
  tokensLeft: number | null;
  usedToday: number;
}): string {
  const cap = bucketCapacity(m.refillRatePerMin);
  const left = m.tokensLeft === null ? '不明（まだ取得していません）' : `${m.tokensLeft}`;
  return (
    `1分あたり${m.refillRatePerMin}ずつ補充され、貯められるのは最大${cap}まで（60分ぶん）。`
    + `いまの残りは${left}。今日の使用は${m.usedToday}（1日の上限${KEEPA_DAILY_TOKEN_BUDGET}）。`
    + '使わずに貯め続けることはできません（60分で期限切れになります）。'
  );
}

export const KEEPA_TOKEN_DESIGN_NOTE_JA =
  '取得枠は「月にいくら」ではなく「1分あたりいくら貯まるか」で管理しています。'
  + '月の合計だけを見ると、短時間にまとめて取ったときに枠が尽きることが見えません。'
  + `貯められる上限は補充速度の60分ぶんまでで、使わなかったぶんは消えます。`
  + '重い取得（出品者一覧）は既定でオフにしてあり、必要な商品にだけ付けます。';
