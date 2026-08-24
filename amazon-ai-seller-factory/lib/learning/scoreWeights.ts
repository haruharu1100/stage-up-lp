import { all, insert, newId, nowIso, one, parseJson, update } from '../db/client';
import { RESEARCH_SCORE_LABEL, RESEARCH_SCORE_MAX, type ResearchScoreBreakdown } from '../types';

/**
 * Research Score の重みの見直し。
 *
 * ユーザー指定：
 *   「重みを固定にしないでください。実績が集まったら、どの指標が実際に効いたか分析してください。
 *     ただし勝手に重みを変更せず、AI推奨重みとして表示し、
 *     人間が承認して初めて変更してください。」
 *
 * ★だからここは「提案を作って保存する」だけ。
 *   承認されるまで、実際の採点は1点も変わらない。
 * ★実績5件未満では提案そのものを作らない（権限ルール）。
 * ★変更幅は±20%まで（権限ルール）。
 */

const MAX_STEP = 0.2;
const KEYS = Object.keys(RESEARCH_SCORE_MAX) as (keyof ResearchScoreBreakdown)[];

export interface WeightProposal {
  id: string;
  basisSamples: number;
  current: ResearchScoreBreakdown;
  proposed: ResearchScoreBreakdown;
  rationale: string[];
  status: 'proposed' | 'approved' | 'rejected';
  createdAt: string;
}

/** 今使っている重み（承認済みがあればそれ、無ければ初期値） */
export async function currentWeights(): Promise<ResearchScoreBreakdown> {
  try {
    const row = await one(
      `SELECT proposed_weights FROM score_weight_proposals
        WHERE status = 'approved' ORDER BY decided_at DESC LIMIT 1`,
    );
    if (row?.proposed_weights) {
      const w = parseJson<Partial<ResearchScoreBreakdown>>(row.proposed_weights, {});
      return { ...RESEARCH_SCORE_MAX, ...w };
    }
  } catch {
    /* テーブルが無い間は初期値で動く */
  }
  return { ...RESEARCH_SCORE_MAX };
}

/**
 * 「儲かった商品」と「儲からなかった商品」で、どの指標に差があったかを見る。
 * 差が大きい指標＝実際に効いた指標なので、そこへ重みを寄せる案を作る。
 */
export async function proposeWeights(minSamples = 5): Promise<{ ok: boolean; message: string; proposal?: WeightProposal }> {
  const rows = await all(
    `SELECT pl.actual_profit_jpy, pl.planned_total_cost_jpy, rc.score_breakdown
       FROM product_lifecycle pl
       JOIN research_candidates rc ON rc.id = pl.research_candidate_id
      WHERE pl.actual_profit_jpy IS NOT NULL AND rc.score_breakdown IS NOT NULL`,
  );

  if (rows.length < minSamples) {
    return {
      ok: false,
      message: `実績が${rows.length}件しかありません。${minSamples}件たまるまで重みの見直しはしません（推測で変えないため）`,
    };
  }

  // 実際にもうかったか（投じたお金に対する利益率）で2グループに分ける
  const scored = rows.map((r) => {
    const cost = Number(r.planned_total_cost_jpy) || 0;
    const profit = Number(r.actual_profit_jpy) || 0;
    const roi = cost > 0 ? profit / cost : 0;
    return { roi, b: parseJson<Partial<ResearchScoreBreakdown>>(r.score_breakdown, {}) };
  });
  const winners = scored.filter((s) => s.roi >= 0.15);
  const losers = scored.filter((s) => s.roi < 0.15);

  if (!winners.length || !losers.length) {
    return {
      ok: false,
      message:
        '成功例と失敗例の両方がそろっていないため、どの指標が効いたか判定できません（片方だけでは比べられません）',
    };
  }

  const current = await currentWeights();
  const proposed: ResearchScoreBreakdown = { ...current };
  const rationale: string[] = [
    `実績${rows.length}件（うまくいった${winners.length}件／うまくいかなかった${losers.length}件）で比較しました`,
  ];

  // 各指標の「満点に対する取得率」の差を見る
  const gaps: { key: keyof ResearchScoreBreakdown; gap: number }[] = [];
  for (const k of KEYS) {
    const rate = (list: typeof scored) => {
      const v = list.map((s) => Number(s.b[k] ?? 0) / RESEARCH_SCORE_MAX[k]).filter((x) => Number.isFinite(x));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    };
    gaps.push({ key: k, gap: rate(winners) - rate(losers) });
  }

  const maxGap = Math.max(...gaps.map((g) => Math.abs(g.gap)));
  if (maxGap < 0.05) {
    return { ok: false, message: '成功例と失敗例で指標に目立った差がありませんでした（重みは変えません）' };
  }

  // 差の大きい指標を最大+20%、差が逆向きの指標を最大-20%（合計100点は保つ）
  let raw = 0;
  const adjusted: Record<string, number> = {};
  for (const g of gaps) {
    const ratio = g.gap / maxGap; // -1 〜 1
    const factor = 1 + Math.max(-MAX_STEP, Math.min(MAX_STEP, ratio * MAX_STEP));
    adjusted[g.key] = current[g.key] * factor;
    raw += adjusted[g.key];
  }
  const total = Object.values(RESEARCH_SCORE_MAX).reduce((a, b) => a + b, 0);
  for (const k of KEYS) proposed[k] = Math.round((adjusted[k] / raw) * total);

  // 端数で合計がずれたぶんを一番大きい項目で吸収する
  const diff = total - KEYS.reduce((s, k) => s + proposed[k], 0);
  if (diff !== 0) {
    const biggest = KEYS.reduce((a, b) => (proposed[a] >= proposed[b] ? a : b));
    proposed[biggest] += diff;
  }

  for (const g of gaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 3)) {
    const dir = g.gap > 0 ? '効いていた' : 'あまり効いていなかった';
    rationale.push(
      `「${RESEARCH_SCORE_LABEL[g.key]}」は${dir}指標です（${current[g.key]}点 → ${proposed[g.key]}点の案）`,
    );
  }
  rationale.push('★これは提案です。あなたが承認するまで、採点は今までどおりのままです');

  const id = newId('swp');
  await insert('score_weight_proposals', {
    id,
    basis_samples: rows.length,
    current_weights: JSON.stringify(current),
    proposed_weights: JSON.stringify(proposed),
    rationale: JSON.stringify(rationale),
    status: 'proposed',
    created_at: nowIso(),
  });

  return {
    ok: true,
    message: '重みの見直し案を作りました（まだ適用していません）',
    proposal: {
      id,
      basisSamples: rows.length,
      current,
      proposed,
      rationale,
      status: 'proposed',
      createdAt: nowIso(),
    },
  };
}

/** 人が承認して初めて重みが変わる */
export async function decideProposal(
  id: string,
  decision: 'approved' | 'rejected',
  actor = 'human',
): Promise<{ ok: boolean; message: string }> {
  const row = await one(`SELECT * FROM score_weight_proposals WHERE id = ?`, [id]);
  if (!row) return { ok: false, message: '対象の提案が見つかりませんでした' };
  if (String(row.status) !== 'proposed') {
    return { ok: false, message: 'この提案はすでに判断済みです' };
  }
  await update('score_weight_proposals', id, {
    status: decision,
    decided_at: nowIso(),
    decided_by: actor,
  });
  return {
    ok: true,
    message: decision === 'approved' ? '新しい重みを適用しました' : '提案を見送りました（重みは変わりません）',
  };
}

export async function proposalList(limit = 20) {
  return all(`SELECT * FROM score_weight_proposals ORDER BY created_at DESC LIMIT ?`, [limit]);
}
