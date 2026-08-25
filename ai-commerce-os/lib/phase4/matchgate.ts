/**
 * 【Match Gate — 同じ商品と言い切ってよいか】（Phase 4・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 *   点数の付け方そのものは `lib/keepa/match.ts` にあり、こちらは**その結果に門をかける**だけ。
 *
 * ------------------------------------------------------------------
 * 【なぜ点数の上にもう一段の門を置くのか】
 *
 * ご本人の指示（原文）：
 *   「最低でも HIGH_CONFIDENCE / REVIEW_REQUIRED / REJECTED に分けてください。」
 *   「FALSE MATCHは今までどおり重大事故扱い。」
 *
 * 点数だけを見ると、人は必ず「あと数点なら大丈夫だろう」と考える。
 * 実際、取り違えがいちばん起きるのは**いちばん儲かって見える商品**である。
 * 儲かって見えるのは、たいてい「別の商品の相場を見ている」からで、
 * 点数が少し足りない候補ほど、儲かって見える。
 *
 * だから門は点数と別に置き、**門を通っていない商品はBUY判定へ進ませない**。
 *
 * ------------------------------------------------------------------
 * 【名前が2つあることについて】（ルール109）
 *
 * ご本人の今回の指示が正で、こちらを**表の名前**にする：
 *     HIGH_CONFIDENCE / REVIEW_REQUIRED / REJECTED
 *
 * 既存実装（Phase 3.10）の名前は次のとおりで、こちらは**内部の呼び名として残す**：
 *     MATCHED / NEEDS_HUMAN_CHECK / MISMATCH
 *
 * ★名前を一斉に付け替えなかった理由：
 *   `asin_match_candidates` テーブルに保存済みの行が既に旧名で入っている。
 *   列の中身を一括で書き換える作業は「直したつもりで別の行までずれる」事故を起こしやすい。
 *   対応表をこの1か所だけに置き、読むときに必ずここを通す方が安全である。
 */

/* ================================================================
 * 門の3段階
 * ================================================================ */

export const MATCH_GATES = ['HIGH_CONFIDENCE', 'REVIEW_REQUIRED', 'REJECTED'] as const;
export type MatchGate = (typeof MATCH_GATES)[number];

export const MATCH_GATE_JA: Record<MatchGate, string> = {
  HIGH_CONFIDENCE: '同じ商品と言い切れる',
  REVIEW_REQUIRED: '人が確かめるまで使わない',
  REJECTED: '違う商品',
};

/** 既存（Phase 3.10）の呼び名。読み替え専用で、新しく増やさない。 */
export const LEGACY_MATCH_VERDICTS = ['MATCHED', 'NEEDS_HUMAN_CHECK', 'MISMATCH'] as const;
export type LegacyMatchVerdict = (typeof LEGACY_MATCH_VERDICTS)[number];

/**
 * 旧名 → 新名。
 *
 * ★1対1で対応している。**意味を変えていない。**
 *   もしここで「NEEDS_HUMAN_CHECK は実質OKだから HIGH_CONFIDENCE にしよう」と
 *   丸めたら、それは名前の付け替えではなく判定を緩めたことになる。
 */
export const MATCH_GATE_FROM_LEGACY: Record<LegacyMatchVerdict, MatchGate> = {
  MATCHED: 'HIGH_CONFIDENCE',
  NEEDS_HUMAN_CHECK: 'REVIEW_REQUIRED',
  MISMATCH: 'REJECTED',
};

export function toMatchGate(verdict: string | null | undefined): MatchGate {
  if (verdict === 'MATCHED' || verdict === 'HIGH_CONFIDENCE') return 'HIGH_CONFIDENCE';
  if (verdict === 'NEEDS_HUMAN_CHECK' || verdict === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
  if (verdict === 'MISMATCH' || verdict === 'REJECTED') return 'REJECTED';
  // 知らない値が来たら「大丈夫」側へ倒さない。分からないものは人へ回す。
  return 'REVIEW_REQUIRED';
}

/* ================================================================
 * 取り違えは重大事故のまま
 * ================================================================ */

/**
 * ご本人の指示（原文）：「FALSE MATCHは今までどおり重大事故扱い。」
 *
 * 重大事故扱いというのは、具体的には次の3つである。
 *   ① 人が「違う商品だった」と報告したら、理由の入力を必須にする
 *   ② 機械の判定を人の答えで上書きしない（機械が何回間違えたかを数え続ける）
 *   ③ 取り違えが1件でも出たら、件数を増やす前にそこで立ち止まる
 */
export const FALSE_MATCH_IS_CRITICAL = true;
export const FALSE_MATCH_REASON_REQUIRED = true;
export const MACHINE_VERDICT_OVERWRITTEN_BY_HUMAN = false;

/* ================================================================
 * BUY判定へ進んでよいか
 * ================================================================ */

/**
 * ご本人の指示（原文・§14）：BUY の条件の1つ目が「MATCH_HIGH」。
 * つまり **REVIEW_REQUIRED のまま BUY にはならない。**
 */
export const MATCH_GATE_REQUIRED_FOR_BUY: MatchGate = 'HIGH_CONFIDENCE';

export type MatchGateDecision = {
  gate: MatchGate;
  canProceedToBuy: boolean;
  reasonJa: string;
};

export function judgeMatchGate(input: {
  verdict: string | null | undefined;
  score: number | null;
  candidateCount: number;
  /** 人が確認済みの答え。あれば門の判断材料にする（ただし機械の判定は上書きしない）。 */
  humanVerdict?: string | null;
}): MatchGateDecision {
  const machineGate = toMatchGate(input.verdict);

  // 人が「これは同じ商品だ」と確かめた場合だけ、門を開ける。
  // ★機械の判定（input.verdict）はそのまま残す。上書きしない。
  if (input.humanVerdict) {
    const humanGate = toMatchGate(input.humanVerdict);
    if (humanGate === 'HIGH_CONFIDENCE') {
      return {
        gate: 'HIGH_CONFIDENCE',
        canProceedToBuy: true,
        reasonJa: `人が確認して「同じ商品」と判断しました（機械の判定は ${MATCH_GATE_JA[machineGate]} のまま残しています）。`,
      };
    }
    if (humanGate === 'REJECTED') {
      return {
        gate: 'REJECTED',
        canProceedToBuy: false,
        reasonJa: '人が確認して「違う商品」と判断しました。',
      };
    }
  }

  if (machineGate === 'REJECTED') {
    return { gate: 'REJECTED', canProceedToBuy: false, reasonJa: '同じ商品と考える根拠がありません。' };
  }

  if (machineGate === 'HIGH_CONFIDENCE') {
    return {
      gate: 'HIGH_CONFIDENCE',
      canProceedToBuy: true,
      reasonJa: `${input.score ?? '—'}点で一致しました。`,
    };
  }

  return {
    gate: 'REVIEW_REQUIRED',
    canProceedToBuy: false,
    reasonJa:
      input.candidateCount > 1
        ? `似た候補が${input.candidateCount}件あり、機械が1件に決めていません。人が確かめてください。`
        : '同じ商品と言い切るには材料が足りません。人が確かめてください。',
  };
}
