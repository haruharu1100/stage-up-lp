/**
 * 【利益 × 回転 — 「1商品の最大利益」ではなく「総利益」で並べる】（Phase 5・2026-08-25）
 *
 * ★このファイルは何も import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * 【なぜ ROI だけでは足りないのか】
 *
 * ご本人の指示（原文・§23）：「ROIだけ見ないでください。」
 *   （§6）「1商品最大利益より総利益。」
 *   （§5）「期待純利益 × 売却確率 × 資金回転 × データ信頼度 × リスク調整」
 *
 * 数字で見ると分かりやすい。
 *   A：利益5,000円・ROI 50%・売れるまで180日
 *   B：利益2,000円・ROI 20%・売れるまで20日
 * ROI で並べると A が勝つ。しかし同じ資金を30日で見ると、
 *   A は 5,000 × (30/180) ＝ 約833円
 *   B は 2,000 × (30/20)  ＝ 約3,000円
 * B の方が3倍以上効いている。**資金は1つしかない**ので、
 * 寝ている在庫は「利益が出ていない」ではなく「他を買えなくしている」。
 *
 * ------------------------------------------------------------------
 * 【いちばんやってはいけないこと】
 *
 * 売却確率や売却日数が分からないときに、それらしい数字を入れること。
 * ご本人の指示（原文・§25）：「データがなければ UNKNOWN。」
 * 埋めた瞬間、その商品は「回転が速いことになっている商品」になり、
 * 資金配分の上位へ来る。**分からないものは、上位へ来てはいけない。**
 */

/* ================================================================
 * 1. 売却確率（§25）
 * ================================================================ */

/**
 * ご本人の指示（原文・§25）：
 *   「7日以内 / 30日以内 / 90日以内 の売却確率を出してください。
 *     データがなければ UNKNOWN。」
 */
export const SELL_HORIZONS = [7, 30, 90] as const;
export type SellHorizon = (typeof SELL_HORIZONS)[number];

export type SellProbability = {
  horizonDays: SellHorizon;
  /** 0〜1。**分からなければ null**（0にしない＝ルール115）。 */
  probability: number | null;
  /** 何件の実績から出したか。少ない件数の確率は使わない。 */
  sampleSize: number;
  reasonJa: string;
};

/**
 * 確率を出してよい最低件数。
 *
 * ★Phase 3b で「5件未満でスコアを動かさない」と決めたのと同じ線を引く。
 *   2件のうち1件売れたから50%、は確率ではない。
 */
export const SELL_PROBABILITY_MIN_SAMPLE = 5;

export function judgeSellProbability(
  horizonDays: SellHorizon,
  soldWithinCount: number | null,
  sampleSize: number,
): SellProbability {
  if (soldWithinCount === null) {
    return { horizonDays, probability: null, sampleSize, reasonJa: '売れた実績の記録がありません。' };
  }
  if (sampleSize < SELL_PROBABILITY_MIN_SAMPLE) {
    return {
      horizonDays,
      probability: null,
      sampleSize,
      reasonJa: `実績が${sampleSize}件しかありません（${SELL_PROBABILITY_MIN_SAMPLE}件から確率にします）。`,
    };
  }
  const p = soldWithinCount / sampleSize;
  return {
    horizonDays,
    probability: Math.max(0, Math.min(1, p)),
    sampleSize,
    reasonJa: `${sampleSize}件のうち${soldWithinCount}件が${horizonDays}日以内に売れています。`,
  };
}

/* ================================================================
 * 2. 30日あたりの期待利益（§26）
 * ================================================================ */

/**
 * ご本人の指示（原文・§26）：
 *   「EXPECTED_PROFIT_PER_30D を持ってください。資金効率で並べ替えます。」
 */
export type Per30dInput = {
  /** 手数料・送料・当社費用をすべて引いたあとの、手元に残る額。 */
  expectedNetProfitJpy: number | null;
  /** 売れるまでの想定日数。分からなければ null。 */
  expectedDaysToSell: number | null;
  /** 30日以内に売れる確率（0〜1）。分からなければ null。 */
  sellProbability30d: number | null;
  /** その商品に必要な資金（仕入価格＋先に出ていく費用）。 */
  capitalJpy: number | null;
};

export type Per30dResult = {
  /** 30日あたりに期待できる利益。**材料が欠けたら null**。 */
  expectedProfitPer30dJpy: number | null;
  /** 資金1万円あたりの30日利益。並べ替えの主役。 */
  per30dPer10kJpy: number | null;
  reasonJa: string;
};

/** 想定日数が極端に短いと数字が跳ねるので、下限を置く。 */
export const MIN_DAYS_TO_SELL = 1;
/** これ以上寝るものは「回転で評価しない」（資金が長期に固まる）。 */
export const MAX_DAYS_TO_SELL_FOR_VELOCITY = 365;

/**
 * ★掛け算の順番よりも、**どれか1つでも欠けたら null にする**ことの方が大事。
 *   欠けた項目を1（＝影響なし）で埋めると、材料の少ない商品ほど
 *   数字が良く出て、上位に並ぶ。それは事故である。
 */
export function expectedProfitPer30d(input: Per30dInput): Per30dResult {
  if (input.expectedNetProfitJpy === null) {
    return { expectedProfitPer30dJpy: null, per30dPer10kJpy: null, reasonJa: '手元に残る額がまだ計算できていません。' };
  }
  if (input.expectedDaysToSell === null) {
    return { expectedProfitPer30dJpy: null, per30dPer10kJpy: null, reasonJa: '売れるまでの日数が分かりません。' };
  }
  if (input.sellProbability30d === null) {
    return { expectedProfitPer30dJpy: null, per30dPer10kJpy: null, reasonJa: '30日以内に売れる確率が出せていません。' };
  }

  const days = Math.max(MIN_DAYS_TO_SELL, input.expectedDaysToSell);
  if (days > MAX_DAYS_TO_SELL_FOR_VELOCITY) {
    return {
      expectedProfitPer30dJpy: null,
      per30dPer10kJpy: null,
      reasonJa: `売れるまで${Math.round(days)}日の見込みです。1年を超えるものは資金効率では並べません。`,
    };
  }

  const turnsIn30d = 30 / days;
  const value = input.expectedNetProfitJpy * input.sellProbability30d * turnsIn30d;
  const expectedProfitPer30dJpy = Math.round(value);

  let per30dPer10kJpy: number | null = null;
  if (input.capitalJpy !== null && input.capitalJpy > 0) {
    per30dPer10kJpy = Math.round((expectedProfitPer30dJpy / input.capitalJpy) * 10000);
  }

  return {
    expectedProfitPer30dJpy,
    per30dPer10kJpy,
    reasonJa:
      `手元に残る${input.expectedNetProfitJpy.toLocaleString('ja-JP')}円を、`
      + `${Math.round(days)}日で売れる見込み・30日以内に売れる確率${Math.round(input.sellProbability30d * 100)}%で見ています。`,
  };
}

/* ================================================================
 * 3. 目的関数（§5）
 * ================================================================ */

/**
 * ご本人の指示（原文・§5）：
 *   「単純なROI最大ではなく、期待純利益 × 売却確率 × 資金回転 ×
 *     データ信頼度 × リスク調整 を最大化してください。」
 *
 * ★データ信頼度を掛けるのが効く。
 *   確かでない材料から出た大きい利益は、確かな材料から出た小さい利益より
 *   **下に来なければならない**。掛け算にしておくと、
 *   信頼度が低いものは自動的に沈む（足し算だと沈まない）。
 */
export type ObjectiveInput = {
  expectedProfitPer30dJpy: number | null;
  /** 0〜1。材料の確からしさ。 */
  dataConfidence: number | null;
  /** 0〜1。1が「リスク無し」。 */
  riskAdjust: number | null;
};

export type ObjectiveResult = {
  value: number | null;
  reasonJa: string;
  /** 何が欠けているか（人が読む用）。 */
  missingJa: string[];
};

export function objectiveValue(input: ObjectiveInput): ObjectiveResult {
  const missingJa: string[] = [];
  if (input.expectedProfitPer30dJpy === null) missingJa.push('30日あたりの期待利益');
  if (input.dataConfidence === null) missingJa.push('データの確からしさ');
  if (input.riskAdjust === null) missingJa.push('リスクの見積り');

  if (missingJa.length > 0) {
    return {
      value: null,
      reasonJa: `${missingJa.join('・')}が分からないので、並べ替えの点数を出しません。`,
      missingJa,
    };
  }

  const conf = Math.max(0, Math.min(1, input.dataConfidence as number));
  const risk = Math.max(0, Math.min(1, input.riskAdjust as number));
  const value = (input.expectedProfitPer30dJpy as number) * conf * risk;

  return {
    value: Math.round(value),
    reasonJa: '30日あたりの期待利益に、データの確からしさとリスクを掛けています。',
    missingJa: [],
  };
}

/* ================================================================
 * 4. 集中リスク（§28）
 * ================================================================ */

/**
 * ご本人の指示（原文・§28）：
 *   「MAX_SKU_EXPOSURE / MAX_BRAND_EXPOSURE / MAX_CATEGORY_EXPOSURE を設定可能に。」
 *
 * ★上限は「儲かる商品を買わせない仕組み」に見える。実際そうである。
 *   ただし、いちばん儲かる1商品に資金を全部入れた状態で相場が動くと、
 *   その1回で資金が止まる。止まると次を買えない。
 *   この仕組みの目的は最大利益ではなく**続けられること**なので、上限を置く。
 */
export const EXPOSURE_SETTING_KEYS = {
  sku: 'MAX_SKU_EXPOSURE',
  brand: 'MAX_BRAND_EXPOSURE',
  category: 'MAX_CATEGORY_EXPOSURE',
} as const;

/** 既定の上限（総資金に対する割合）。設定で変えられる。 */
export const EXPOSURE_DEFAULTS = {
  sku: 0.2,
  brand: 0.35,
  category: 0.5,
} as const;

export type ExposureKind = keyof typeof EXPOSURE_DEFAULTS;

export const EXPOSURE_KIND_JA: Record<ExposureKind, string> = {
  sku: '同じ商品',
  brand: '同じブランド',
  category: '同じカテゴリ',
};

export type ExposureCheck = {
  kind: ExposureKind;
  ok: boolean;
  /** 現在の割合。総資金が0なら null（0にしない＝ルール116）。 */
  currentRatio: number | null;
  limitRatio: number;
  reasonJa: string;
};

export function checkExposure(
  kind: ExposureKind,
  alreadyJpy: number,
  addingJpy: number,
  totalCapitalJpy: number,
  limitRatio: number = EXPOSURE_DEFAULTS[kind],
): ExposureCheck {
  if (totalCapitalJpy <= 0) {
    return {
      kind,
      ok: false,
      currentRatio: null,
      limitRatio,
      reasonJa: '総資金が登録されていないので、集中しすぎかどうかを判定できません。',
    };
  }
  const ratio = (alreadyJpy + addingJpy) / totalCapitalJpy;
  const ok = ratio <= limitRatio;
  return {
    kind,
    ok,
    currentRatio: ratio,
    limitRatio,
    reasonJa: ok
      ? `${EXPOSURE_KIND_JA[kind]}への配分は${Math.round(ratio * 100)}%です（上限${Math.round(limitRatio * 100)}%）。`
      : `${EXPOSURE_KIND_JA[kind]}へ${Math.round(ratio * 100)}%が集まります。上限${Math.round(limitRatio * 100)}%を超えるので見送ります。`,
  };
}

/* ================================================================
 * 5. 資金配分（§27）
 * ================================================================ */

/**
 * ご本人の指示（原文・§27）：
 *   「利用可能資金内で、期待利益 × 回転率 が最大になる購入組み合わせを提案。」
 *
 * ★これは「買う」ではなく「並べて、いくら要るかを見せる」までである（§53）。
 *   自動購入は実装しない。
 */
export type AllocationCandidate = {
  id: string;
  labelJa: string;
  capitalJpy: number;
  objectiveValue: number | null;
  skuKey: string;
  brandKey: string;
  categoryKey: string;
};

export type AllocationPick = {
  id: string;
  labelJa: string;
  capitalJpy: number;
  objectiveValue: number;
};

export type AllocationResult = {
  picks: AllocationPick[];
  usedCapitalJpy: number;
  remainingCapitalJpy: number;
  skippedJa: string[];
};

/**
 * ★点数の出せない候補（objectiveValue が null）は、この配分に入れない。
 *   「分からないので後ろに置く」ではなく「入れない」。
 *   後ろに置くと、資金が余ったときに入ってくる。
 */
export function allocateCapital(
  candidates: AllocationCandidate[],
  totalCapitalJpy: number,
): AllocationResult {
  const skippedJa: string[] = [];
  const usable = candidates.filter((c) => {
    if (c.objectiveValue === null) {
      skippedJa.push(`${c.labelJa}：並べ替えの点数が出せないので、配分に入れません。`);
      return false;
    }
    if (c.capitalJpy <= 0) {
      skippedJa.push(`${c.labelJa}：必要な資金が分かりません。`);
      return false;
    }
    return true;
  });

  // 資金1円あたりの点数が高い順。同点なら必要資金の小さい順（回転を優先）。
  const sorted = [...usable].sort((a, b) => {
    const ra = (a.objectiveValue as number) / a.capitalJpy;
    const rb = (b.objectiveValue as number) / b.capitalJpy;
    if (rb !== ra) return rb - ra;
    return a.capitalJpy - b.capitalJpy;
  });

  const picks: AllocationPick[] = [];
  const bySku = new Map<string, number>();
  const byBrand = new Map<string, number>();
  const byCategory = new Map<string, number>();
  let used = 0;

  for (const c of sorted) {
    if (used + c.capitalJpy > totalCapitalJpy) {
      skippedJa.push(`${c.labelJa}：残りの資金では足りません。`);
      continue;
    }
    const sku = checkExposure('sku', bySku.get(c.skuKey) ?? 0, c.capitalJpy, totalCapitalJpy);
    const brand = checkExposure('brand', byBrand.get(c.brandKey) ?? 0, c.capitalJpy, totalCapitalJpy);
    const cat = checkExposure('category', byCategory.get(c.categoryKey) ?? 0, c.capitalJpy, totalCapitalJpy);
    const failed = [sku, brand, cat].find((x) => !x.ok);
    if (failed) {
      skippedJa.push(`${c.labelJa}：${failed.reasonJa}`);
      continue;
    }

    picks.push({
      id: c.id,
      labelJa: c.labelJa,
      capitalJpy: c.capitalJpy,
      objectiveValue: c.objectiveValue as number,
    });
    used += c.capitalJpy;
    bySku.set(c.skuKey, (bySku.get(c.skuKey) ?? 0) + c.capitalJpy);
    byBrand.set(c.brandKey, (byBrand.get(c.brandKey) ?? 0) + c.capitalJpy);
    byCategory.set(c.categoryKey, (byCategory.get(c.categoryKey) ?? 0) + c.capitalJpy);
  }

  return {
    picks,
    usedCapitalJpy: used,
    remainingCapitalJpy: totalCapitalJpy - used,
    skippedJa,
  };
}
