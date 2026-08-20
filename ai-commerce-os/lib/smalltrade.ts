/**
 * 少額実取引の安全設計（Phase 3.5・§22）。
 *
 * ============================================================
 * 【重要】このファイルには「買う処理」が入っていない。意図的に入れていない。
 * ============================================================
 *
 * ユーザー指示：「まだ実購入・実出品は絶対に解禁しないでください。」
 *
 * だからここにあるのは、
 *   ・将来 実購入を作るときに守る上限の数値
 *   ・「この1件を買ってよいか」を判定する純粋な関数
 * だけである。
 *
 * 決済も、外部サイトへの送信も、注文APIの呼び出しも、この層には存在しない。
 * `assertNoExecutionPath()` が、それを毎回のテストで確認する。
 *
 * 【なぜ判定だけ先に作るのか】
 * 実購入を作る日に、上限の設計から考え始めると、
 * 「早く動かしたい」という気持ちが上限をゆるめる方向に働く。
 * 危険な判断は、急いでいない今のうちに決めておくのが安全。
 *
 * 【上限（ユーザー指定）】
 *   1件あたり        10,000円まで
 *   1日あたり合計    30,000円まで
 *   同一商品         1個まで（同じ商品を複数買わない）
 *   判定             STRONG BUY のみ
 *   手数料           VERIFIED のみ（概算のままでは買わない）
 *
 * 上の5つに加えて、このシステムは独自にもう4つ足している。
 *   ・実市場データであること（テストデータで実際のお金を動かさない）
 *   ・Phase 4 の卒業条件をすべて満たしていること
 *   ・人が解錠していること
 *   ・人が承認して間に合う機会であること（半減期の判定が AUTO_ONLY でない）
 */

/** 1件あたりの上限（円）。 */
export const MAX_SINGLE_PURCHASE_YEN = 10_000;
/** 1日あたりの合計上限（円）。 */
export const MAX_DAILY_PURCHASE_YEN = 30_000;
/** 同一商品の同時保有上限（個）。 */
export const MAX_UNITS_PER_IDENTITY = 1;
/** 実購入を許す判定。BUY でも WATCH でもなく、STRONG BUY だけ。 */
export const ALLOWED_DECISIONS = ['STRONG_BUY'] as const;

export type SmallTradeInput = {
  decision: string | null;
  /** 仕入にかかる総額（手数料・送料込み） */
  acquisitionTotalCost: number;
  /** 今日すでに使った金額 */
  spentTodayYen: number;
  /** 同じ商品をすでに何個持っているか */
  heldUnitsOfIdentity: number;
  buyFeeStatus: string | null;
  sellFeeStatus: string | null;
  realMarketData: boolean;
  /** Phase 4 卒業条件をすべて満たしているか */
  gatePassed: boolean;
  /** 人が解錠したか */
  humanUnlocked: boolean;
  /** 半減期から見た到達可能性 */
  reachability: string | null;
  /** 同じ判断が二重に実行されないための鍵。無ければ実行しない */
  idempotencyKey: string | null;
};

export type SmallTradeJudgement = {
  allowed: boolean;
  /** 止めた理由。1つでも引っかかれば、そこで止める */
  reasons: string[];
  /** 画面に出す一文 */
  message: string;
};

/**
 * 「この1件を実際に買ってよいか」を判定する。
 *
 * 【判定するだけで、買わない】
 * この関数が true を返しても、呼び出す先に購入処理は存在しない。
 * 将来 実購入を作るときは、必ずこの関数を通す形にする。
 *
 * 【1つでも駄目なら駄目】
 * 合格点方式にしない。「9項目中8項目OKだから買う」を許すと、
 * 毎回どれか1つを妥協する運用になる。
 */
export function judgeSmallTrade(i: SmallTradeInput): SmallTradeJudgement {
  const reasons: string[] = [];

  if (!i.humanUnlocked) reasons.push('人による解錠がされていない（AIは自分で解錠できない）');
  if (!i.gatePassed) reasons.push('Phase 4 の卒業条件をすべて満たしていない');
  if (!i.realMarketData) reasons.push('実市場データではない（テストデータで実際のお金を動かさない）');

  if (!ALLOWED_DECISIONS.includes(String(i.decision ?? '').toUpperCase() as 'STRONG_BUY')) {
    reasons.push(`判定が ${i.decision ?? '未設定'} である（実購入は STRONG BUY のみ）`);
  }

  if (i.buyFeeStatus !== 'VERIFIED' || i.sellFeeStatus !== 'VERIFIED') {
    reasons.push('仕入側・販売側のどちらかの手数料が実額確認できていない');
  }

  if (!(i.acquisitionTotalCost > 0)) {
    reasons.push('仕入総額が計算できていない');
  } else if (i.acquisitionTotalCost > MAX_SINGLE_PURCHASE_YEN) {
    reasons.push(`1件あたりの上限 ${MAX_SINGLE_PURCHASE_YEN.toLocaleString()}円を超えている（${i.acquisitionTotalCost.toLocaleString()}円）`);
  }

  if (i.spentTodayYen + i.acquisitionTotalCost > MAX_DAILY_PURCHASE_YEN) {
    reasons.push(`1日あたりの上限 ${MAX_DAILY_PURCHASE_YEN.toLocaleString()}円を超える（今日すでに${i.spentTodayYen.toLocaleString()}円）`);
  }

  if (i.heldUnitsOfIdentity >= MAX_UNITS_PER_IDENTITY) {
    reasons.push('同じ商品をすでに保有している（同一商品は1個まで）');
  }

  if (i.reachability === 'AUTO_ONLY') {
    reasons.push('人が確認する間に消えてしまう機会（速さのために確認を飛ばさない）');
  }

  if (!i.idempotencyKey) {
    reasons.push('二重実行を防ぐ鍵が無い（同じ商品を2回買う事故を防げない）');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    message: reasons.length === 0
      ? '上限と条件はすべて満たしています。ただし実購入の処理は未実装のため、実際には何も買いません。'
      : `実購入しません。理由：${reasons.join('／')}`,
  };
}

/**
 * このリポジトリに実購入の実行経路が無いことの宣言。
 *
 * 受け入れテストがここを見て、
 * 「フラグで止めている」のではなく「そもそも作っていない」ことを確認する。
 * 将来ここを true に書き換える人は、同時に全部の安全装置を通す義務がある。
 */
export const EXECUTION_PATHS: Record<string, boolean> = {
  /** 実際に商品を購入する処理 */
  purchase: false,
  /** 実際に出品する処理 */
  listing: false,
  /** 決済を実行する処理 */
  payment: false,
  /** 外部サイトへ自動ログインする処理 */
  autoLogin: false,
};

export function assertNoExecutionPath(): { ok: boolean; message: string } {
  const enabled = Object.entries(EXECUTION_PATHS).filter(([, v]) => v === true).map(([k]) => k);
  return {
    ok: enabled.length === 0,
    message: enabled.length === 0
      ? '実購入・実出品・決済・自動ログインの処理はコードごと存在しません（フラグOFFではなく未実装）。'
      : `実行経路が存在します：${enabled.join('、')}`,
  };
}
