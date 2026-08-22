import { all, nowIso, run } from './db/client';
import type { Idea } from './types';

/**
 * PRE_SCORE：外部APIを1回も呼ばずに付ける粗選別の点数（0〜100）。
 *
 * 目的は「良い案件を選ぶこと」ではなく「明らかに金にならない案件を先に落とすこと」。
 * 158件すべてに日本市場調査を掛けるとAPI課金と時間が無駄になるため、
 * ここで上位だけに絞ってから重い処理に進む。
 *
 * 誤って落とさないよう、判断材料が無い案件は低得点ではなく中央値付近に置く。
 */

export type PreScore = { ideaId: string; preScore: number; reason: string };

const B2B_CATEGORIES = ['AI_SALES', 'AI_OPS', 'VERTICAL_AI'];

export function preScoreOf(idea: Idea): PreScore {
  const text = `${idea.title} ${idea.summary}`.toLowerCase();
  const has = (...w: string[]) => w.some((x) => text.includes(x));
  const reasons: string[] = [];
  let score = 50; // 判断材料が無いときの初期値。0にはしない

  if (idea.category === 'VERTICAL_AI') {
    score += 12;
    reasons.push('業種特化で売り先を絞れる(+12)');
  } else if (B2B_CATEGORIES.includes(idea.category)) {
    score += 8;
    reasons.push('法人の業務に入る型(+8)');
  } else if (idea.category === 'AI_SIDE_BUSINESS') {
    score -= 10;
    reasons.push('個人向けで単価が低くなりやすい(-10)');
  }

  if (has('/mo', 'per month', 'monthly', 'subscription', 'saas', 'mrr', 'arr', 'recurring')) {
    score += 12;
    reasons.push('月額課金を示す語がある(+12)');
  }
  if (has('call', 'phone', 'receptionist', 'data entry', 'invoice', 'scheduling', 'transcription', 'bookkeeping')) {
    score += 10;
    reasons.push('人手のかかる定型作業の置き換え(+10)');
  }
  if (has('sales', 'lead', 'sdr', 'outbound', 'booking', 'appointment', 'conversion', 'churn')) {
    score += 8;
    reasons.push('売上に直結する用途(+8)');
  }
  if (has('crm', 'integration', 'workflow', 'knowledge base', 'database')) {
    score += 6;
    reasons.push('顧客の業務データに入り込み解約されにくい(+6)');
  }

  if (has('hardware', 'device', 'robot', 'sensor', 'drone')) {
    score -= 20;
    reasons.push('ハードが絡み個人では作りきれない(-20)');
  }
  if (has('research paper', 'benchmark', 'dataset', 'model weights', 'fine-tuning framework', 'inference engine')) {
    score -= 15;
    reasons.push('研究・基盤寄りで顧客が金を払う形になっていない(-15)');
  }
  if (has('free', 'open source') && !has('enterprise', 'cloud', 'hosted')) {
    score -= 8;
    reasons.push('無料・OSSが前提で課金しづらい(-8)');
  }
  if (idea.summary.trim().length < 30) {
    score -= 5;
    reasons.push('説明文が短く判断材料が乏しい(-5)');
  }

  const preScore = Math.max(0, Math.min(100, score));
  return {
    ideaId: idea.id,
    preScore,
    reason: reasons.length ? reasons.join(' / ') : '判断材料が無いため中央値50のまま',
  };
}

export async function savePreScores(ideas: Idea[]): Promise<PreScore[]> {
  const at = nowIso();
  const out = ideas.map(preScoreOf);
  for (const p of out) {
    await run(
      `INSERT INTO pre_scores (idea_id, pre_score, reason, scored_at) VALUES (?,?,?,?)
       ON CONFLICT(idea_id) DO UPDATE SET pre_score=excluded.pre_score, reason=excluded.reason, scored_at=excluded.scored_at`,
      [p.ideaId, p.preScore, p.reason, at]
    );
  }
  return out;
}

/** 絞り込みの各段。API課金と時間を抑えるため、段ごとに件数を決めておく */
export const FUNNEL_STAGES = {
  research: 20, // 日本市場調査に進む件数
  backtest: 10, // 詳細バックテストに進む件数
  productize: 3, // 商品化候補として残す件数
} as const;

export async function topPreScored(limit: number): Promise<string[]> {
  const rows = await all<{ idea_id: string }>(
    'SELECT idea_id FROM pre_scores ORDER BY pre_score DESC, idea_id ASC LIMIT ?',
    [limit]
  );
  return rows.map((r) => r.idea_id);
}
