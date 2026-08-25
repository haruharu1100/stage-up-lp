/**
 * Phase 6 / PRODUCT MATCH（同じ商品かどうか）
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§9）：
 *   「JAN一致商品は非常に強い候補ですが、**JAN一致だけで最終商品一致確定にはしないでください。**」
 *   確認すること：数量違い／セット違い／カラー違い／サイズ違い／世代違い
 *
 * ------------------------------------------------------------------
 * 【なぜJAN一致だけで決めないか】
 *   同じJANが「1個」と「6個まとめ買い」に付いていることがある。
 *   同じJANが「2020年モデル」と「2023年モデル」に流用されていることがある。
 *   ここで間違えると、仕入れてから気づく。返品も効かない。
 *
 * ★誤一致は重大事故として扱う（Phase 4 から継続）。
 * ★AIの「たぶん同じ」だけで買わない。画像の似かただけで確定しない（ルール138）。
 * ★安い候補ほど、一致の基準を厳しくする（ルール138）。
 *
 * ------------------------------------------------------------------
 * 【依存ゼロ】何もimportしない（ルール37）。
 * 出す答え（verdict）は lib/phase4/matchgate.ts の judgeMatchGate へそのまま渡せる形にしてある。
 */

/* ================================================================
 * 確認する5つの軸（§9）
 * ================================================================ */

export const MATCH_AXES = ['QUANTITY', 'SET', 'COLOR', 'SIZE', 'GENERATION'] as const;
export type MatchAxis = (typeof MATCH_AXES)[number];

export const MATCH_AXIS_LABEL_JA: Record<MatchAxis, string> = {
  QUANTITY: '数量',
  SET: 'セット売りかどうか',
  COLOR: '色',
  SIZE: 'サイズ・容量',
  GENERATION: '世代・年式',
};

export const AXIS_RESULTS = ['SAME', 'DIFFERENT', 'UNKNOWN'] as const;
export type AxisResult = (typeof AXIS_RESULTS)[number];

export type AxisCheck = {
  axis: MatchAxis;
  result: AxisResult;
  /** Amazon側から読み取れた値 */
  leftJa: string | null;
  /** 仕入先側から読み取れた値 */
  rightJa: string | null;
  noteJa: string;
};

/* ================================================================
 * 商品名から読み取る
 * ================================================================ */

function norm(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 数量。「6個」「×3」「3本入」など。 */
export function readQuantity(title: string | null): number | null {
  const t = norm(title);
  if (t === '') return null;
  const m1 = t.match(/(?:×|x|\*)\s*(\d{1,3})\b/);
  if (m1) return Number(m1[1]);
  const m2 = t.match(/(\d{1,3})\s*(?:個|本|枚|袋|箱|缶|パック|セット|入り|入)/);
  if (m2) return Number(m2[1]);
  return null;
}

/** まとめ売りかどうか。 */
export function readSet(title: string | null): boolean | null {
  const t = norm(title);
  if (t === '') return null;
  if (/(セット|まとめ買い|まとめ売り|バンドル|box|ボックス|ケース販売|詰め合わせ)/.test(t)) return true;
  const q = readQuantity(title);
  if (q !== null) return q > 1;
  return null;
}

const COLOR_WORDS = [
  'ブラック', 'ホワイト', 'レッド', 'ブルー', 'グリーン', 'イエロー', 'ピンク', 'パープル',
  'グレー', 'グレイ', 'シルバー', 'ゴールド', 'ベージュ', 'ブラウン', 'ネイビー', 'オレンジ',
  '黒', '白', '赤', '青', '緑', '黄', '桃', '紫', '灰', '銀', '金', '茶', '紺',
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'purple', 'gray', 'grey',
  'silver', 'gold', 'beige', 'brown', 'navy', 'orange',
];

/** 色の呼び方をひとつにまとめる（黒 と ブラック と black は同じ）。 */
const COLOR_CANON: Record<string, string> = {
  ブラック: 'BLACK', 黒: 'BLACK', black: 'BLACK',
  ホワイト: 'WHITE', 白: 'WHITE', white: 'WHITE',
  レッド: 'RED', 赤: 'RED', red: 'RED',
  ブルー: 'BLUE', 青: 'BLUE', blue: 'BLUE', ネイビー: 'NAVY', 紺: 'NAVY', navy: 'NAVY',
  グリーン: 'GREEN', 緑: 'GREEN', green: 'GREEN',
  イエロー: 'YELLOW', 黄: 'YELLOW', yellow: 'YELLOW',
  ピンク: 'PINK', 桃: 'PINK', pink: 'PINK',
  パープル: 'PURPLE', 紫: 'PURPLE', purple: 'PURPLE',
  グレー: 'GRAY', グレイ: 'GRAY', 灰: 'GRAY', gray: 'GRAY', grey: 'GRAY',
  シルバー: 'SILVER', 銀: 'SILVER', silver: 'SILVER',
  ゴールド: 'GOLD', 金: 'GOLD', gold: 'GOLD',
  ベージュ: 'BEIGE', beige: 'BEIGE',
  ブラウン: 'BROWN', 茶: 'BROWN', brown: 'BROWN',
  オレンジ: 'ORANGE', orange: 'ORANGE',
};

export function readColors(title: string | null): string[] {
  const t = norm(title);
  if (t === '') return [];
  const found = new Set<string>();
  for (const w of COLOR_WORDS) {
    if (t.includes(norm(w))) {
      const canon = COLOR_CANON[w] ?? COLOR_CANON[norm(w)];
      if (canon) found.add(canon);
    }
  }
  return [...found].sort();
}

/** サイズ・容量。「500ml」「2tb」「27インチ」「サイズl」など。 */
export function readSize(title: string | null): string | null {
  const t = norm(title);
  if (t === '') return null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg|mm|cm|m|インチ|inch|gb|tb)\b/);
  if (m) return `${m[1]}${m[2]}`;
  const m2 = t.match(/\bサイズ\s*([sml]{1,3}|\d{2,3})\b/);
  if (m2) return `size:${m2[1]}`;
  return null;
}

/** 世代・年式。「第3世代」「gen2」「mark ii」「2023年モデル」。 */
export function readGeneration(title: string | null): string | null {
  const t = norm(title);
  if (t === '') return null;
  const m1 = t.match(/第\s*(\d{1,2})\s*世代/);
  if (m1) return `gen${m1[1]}`;
  const m2 = t.match(/\bgen\.?\s*(\d{1,2})\b/);
  if (m2) return `gen${m2[1]}`;
  const m3 = t.match(/\bmark\s*(i{1,3}|iv|v)\b/);
  if (m3) return `mark${m3[1]}`;
  const m4 = t.match(/\b(20\d{2})\s*年?\s*モデル/);
  if (m4) return `year${m4[1]}`;
  const m5 = t.match(/\bv\.?\s*(\d{1,2})\b/);
  if (m5) return `v${m5[1]}`;
  return null;
}

/* ================================================================
 * 5軸を突き合わせる
 * ================================================================ */

function cmp<T>(left: T | null, right: T | null, eq: (a: T, b: T) => boolean): AxisResult {
  if (left === null || right === null) return 'UNKNOWN';
  return eq(left, right) ? 'SAME' : 'DIFFERENT';
}

export function checkAxes(amazonTitle: string | null, supplierTitle: string | null): AxisCheck[] {
  const lq = readQuantity(amazonTitle);
  const rq = readQuantity(supplierTitle);
  const ls = readSet(amazonTitle);
  const rs = readSet(supplierTitle);
  const lc = readColors(amazonTitle);
  const rc = readColors(supplierTitle);
  const lz = readSize(amazonTitle);
  const rz = readSize(supplierTitle);
  const lg = readGeneration(amazonTitle);
  const rg = readGeneration(supplierTitle);

  const colorResult: AxisResult =
    lc.length === 0 || rc.length === 0 ? 'UNKNOWN' : lc.some((c) => rc.includes(c)) ? 'SAME' : 'DIFFERENT';

  return [
    {
      axis: 'QUANTITY',
      result: cmp(lq, rq, (a, b) => a === b),
      leftJa: lq === null ? null : `${lq}`,
      rightJa: rq === null ? null : `${rq}`,
      noteJa: '同じJANでも「1個」と「まとめ買い」で商品名が違うことがある。',
    },
    {
      axis: 'SET',
      result: cmp(ls, rs, (a, b) => a === b),
      leftJa: ls === null ? null : ls ? 'まとめ売り' : '単品',
      rightJa: rs === null ? null : rs ? 'まとめ売り' : '単品',
      noteJa: 'セット売りを単品として計算すると、利益がまるごとひっくり返る。',
    },
    {
      axis: 'COLOR',
      result: colorResult,
      leftJa: lc.length === 0 ? null : lc.join('/'),
      rightJa: rc.length === 0 ? null : rc.join('/'),
      noteJa: '色違いは別の商品として扱う。',
    },
    {
      axis: 'SIZE',
      result: cmp(lz, rz, (a, b) => a === b),
      leftJa: lz,
      rightJa: rz,
      noteJa: '容量・サイズ違いは別の商品として扱う。',
    },
    {
      axis: 'GENERATION',
      result: cmp(lg, rg, (a, b) => a === b),
      leftJa: lg,
      rightJa: rg,
      noteJa: '型番が同じでも世代が違うことがある。',
    },
  ];
}

/* ================================================================
 * 判定
 * ================================================================ */

/** 相手の想定売値に対して、これより安い候補は「安すぎる」として基準を上げる（ルール138）。 */
export const SUSPICIOUSLY_CHEAP_RATIO = 0.3;

/** AIの見立てや画像の似かただけでは確定しない。 */
export const AI_ONLY_MATCH_ALLOWED = false;
export const IMAGE_ONLY_MATCH_ALLOWED = false;

export const MATCH_VERDICTS = ['HIGH_CONFIDENCE', 'REVIEW_REQUIRED', 'REJECTED'] as const;
export type MatchVerdict = (typeof MATCH_VERDICTS)[number];

export type MatchInput = {
  /** 探すのに使った言葉の強さ */
  keyStrength: 'STRONG' | 'MEDIUM' | 'WEAK';
  /** 識別子（JAN等）がぴったり一致したか */
  identifierExact: boolean;
  amazonTitle: string | null;
  supplierTitle: string | null;
  /** 仕入価格 */
  supplierPrice: number | null;
  /** Amazonでの想定売値（保守側）。無ければ null。 */
  amazonSellPrice: number | null;
};

export type MatchResult = {
  verdict: MatchVerdict;
  axes: AxisCheck[];
  differentAxes: MatchAxis[];
  unknownAxes: MatchAxis[];
  /** 安すぎる候補として基準を上げたか */
  cheapGuardApplied: boolean;
  reasonsJa: string[];
  summaryJa: string;
};

export function judgeProductMatch(input: MatchInput): MatchResult {
  const axes = checkAxes(input.amazonTitle, input.supplierTitle);
  const differentAxes = axes.filter((a) => a.result === 'DIFFERENT').map((a) => a.axis);
  const unknownAxes = axes.filter((a) => a.result === 'UNKNOWN').map((a) => a.axis);
  const reasonsJa: string[] = [];

  const cheapGuardApplied =
    input.supplierPrice !== null &&
    input.amazonSellPrice !== null &&
    input.amazonSellPrice > 0 &&
    input.supplierPrice < input.amazonSellPrice * SUSPICIOUSLY_CHEAP_RATIO;

  if (cheapGuardApplied) {
    reasonsJa.push('想定売値に比べて安すぎる。中身違い・状態違いの疑いがあるため、基準を上げた。');
  }

  // 1つでも食い違えば、別商品として落とす。
  if (differentAxes.length > 0) {
    for (const ax of differentAxes) {
      const a = axes.find((x) => x.axis === ax)!;
      reasonsJa.push(`${MATCH_AXIS_LABEL_JA[ax]}が違う（${a.leftJa ?? '—'} と ${a.rightJa ?? '—'}）。`);
    }
    return {
      verdict: 'REJECTED',
      axes,
      differentAxes,
      unknownAxes,
      cheapGuardApplied,
      reasonsJa,
      summaryJa: `別の商品と判断しました（${differentAxes.map((a) => MATCH_AXIS_LABEL_JA[a]).join('・')}が違う）。`,
    };
  }

  // 識別子が一致していないものは、そもそも言い切らない。
  if (!input.identifierExact || input.keyStrength !== 'STRONG') {
    reasonsJa.push('JAN等のコードでぴったり一致したわけではない。人が確かめる。');
    return {
      verdict: 'REVIEW_REQUIRED',
      axes,
      differentAxes,
      unknownAxes,
      cheapGuardApplied,
      reasonsJa,
      summaryJa: '同じ商品と言い切るには材料が足りません。人が確かめてください。',
    };
  }

  // JAN一致でも、数量とセットの区別が読めないものは確定しない（§9）。
  const criticalUnknown = unknownAxes.filter((a) => a === 'QUANTITY' || a === 'SET');
  if (criticalUnknown.length > 0) {
    reasonsJa.push('JANは一致したが、数量やセット売りの区別が商品名から読み取れない。');
    return {
      verdict: 'REVIEW_REQUIRED',
      axes,
      differentAxes,
      unknownAxes,
      cheapGuardApplied,
      reasonsJa,
      summaryJa: 'JANは一致していますが、まとめ売りかどうかが分かりません。人が確かめてください。',
    };
  }

  if (cheapGuardApplied) {
    return {
      verdict: 'REVIEW_REQUIRED',
      axes,
      differentAxes,
      unknownAxes,
      cheapGuardApplied,
      reasonsJa,
      summaryJa: '安すぎるため、JANが一致していても人が確かめてください。',
    };
  }

  reasonsJa.push('JANが一致し、数量・セット・色・サイズ・世代に食い違いが無い。');
  return {
    verdict: 'HIGH_CONFIDENCE',
    axes,
    differentAxes,
    unknownAxes,
    cheapGuardApplied,
    reasonsJa,
    summaryJa: '同じ商品と判断しました。',
  };
}

/** 同じJANの候補が複数あって1件に絞れないとき用。 */
export const MULTIPLE_MATCH_UNRESOLVED = 'MULTIPLE_MATCH_UNRESOLVED';
