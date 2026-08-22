import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './env';
import { all, nowIso, run } from './db/client';
import { stageRatio } from './japan';
import {
  SCORE_WEIGHTS,
  type Grade,
  type Idea,
  type JapanAssessment,
  type MarketBacktest,
  type ScoreItem,
  type ScoreKey,
  type ScoreResult,
} from './types';

const HUMAN_FILE = path.join(DATA_DIR, 'idea-ratings.csv');

export const HUMAN_RATINGS_PATH = HUMAN_FILE;

export const HUMAN_RATINGS_TEMPLATE = `idea_id,key,score_0_to_5,reason
# 人の判断で採点する項目。0〜5 の6段階。書かない項目は「未評価」として採点対象外になる（0点ではない）。
# key: ${Object.keys(SCORE_WEIGHTS).join(' / ')}
`;

type HumanRating = { ideaId: string; key: ScoreKey; ratio: number; reason: string };

export function readHumanRatings(): HumanRating[] {
  if (!fs.existsSync(HUMAN_FILE)) return [];
  const out: HumanRating[] = [];
  for (const line of fs.readFileSync(HUMAN_FILE, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#') || line.startsWith('idea_id')) continue;
    const [ideaId, key, score, reason] = line.split(',').map((s) => (s ?? '').trim());
    const n = Number(score);
    if (!ideaId || !(key in SCORE_WEIGHTS) || !Number.isFinite(n)) continue;
    out.push({ ideaId, key: key as ScoreKey, ratio: Math.min(1, Math.max(0, n / 5)), reason: reason ?? '' });
  }
  return out;
}

/**
 * 実データが無い項目の仮置き（HEURISTIC）。
 * ビジネスモデルの型から導く弱い推定であり、強い根拠としては数えない。
 */
function heuristics(idea: Idea): Partial<Record<ScoreKey, { ratio: number; reason: string }>> {
  const text = `${idea.title} ${idea.summary}`.toLowerCase();
  const has = (...w: string[]) => w.some((x) => text.includes(x));

  const out: Partial<Record<ScoreKey, { ratio: number; reason: string }>> = {};

  if (has('/mo', 'per month', 'monthly', 'subscription', 'saas', 'mrr', 'seat')) {
    out.recurring = { ratio: 0.9, reason: '月額課金を示す語が説明文にある' };
  } else if (idea.category === 'AI_SALES' || idea.category === 'AI_OPS' || idea.category === 'VERTICAL_AI') {
    out.recurring = { ratio: 0.7, reason: '業務に常駐する型のため月額化しやすい' };
  } else if (idea.category === 'AI_SIDE_BUSINESS') {
    out.recurring = { ratio: 0.3, reason: '売り切り型になりやすい' };
  }

  // ソフト単体は粗利が高い。API課金や通話料が乗るものは下げる
  if (has('voice', 'call', 'phone', 'telephony', 'video')) {
    out.grossMargin = { ratio: 0.6, reason: '通話・映像の従量費用が原価に乗る' };
  } else {
    out.grossMargin = { ratio: 0.85, reason: 'ソフト中心のため原価は主にAPI利用料のみ' };
  }

  if (has('無料', 'open source', 'template', 'no-code', 'nocode', 'workflow')) {
    out.buildEase = { ratio: 0.8, reason: '既存部品で組める型' };
  } else if (has('hardware', 'device', 'robot')) {
    out.buildEase = { ratio: 0.2, reason: 'ハードが絡み開発が重い' };
  } else {
    out.buildEase = { ratio: 0.6, reason: '既存のAI基盤で実装可能な範囲' };
  }

  if (idea.category === 'VERTICAL_AI') {
    out.sellEase = { ratio: 0.7, reason: '業種が絞れており誰に売るかが明確' };
    out.differentiation = { ratio: 0.7, reason: '業種特化は横断型より差別化しやすい' };
  } else if (idea.category === 'AI_SIDE_BUSINESS') {
    out.sellEase = { ratio: 0.5, reason: '個人向けで単価が低い' };
    out.differentiation = { ratio: 0.3, reason: '参入者が多く似た商品が並びやすい' };
  }

  if (has('agent', 'automation', 'autonomous', 'workflow', 'pipeline')) {
    out.automation = { ratio: 0.8, reason: '自動実行を前提とした型' };
  }

  return out;
}

export function gradeFromScore(score: number, strongCoverage: number): Grade {
  if (strongCoverage < 0.5) return 'INSUFFICIENT_DATA';
  if (score >= 85) return 'S';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'REJECT';
}

export const GRADE_LABEL: Record<Grade, string> = {
  S: 'S（最優先で事業化検討）',
  A: 'A（事業化候補）',
  B: 'B（保留・要追加調査）',
  C: 'C（見送り寄り）',
  REJECT: '却下',
  INSUFFICIENT_DATA: '判定不能（根拠不足）',
};

export async function scoreIdea(
  idea: Idea,
  ctx: { japan: JapanAssessment | null; market: MarketBacktest | null }
): Promise<ScoreResult> {
  const human = readHumanRatings().filter((h) => h.ideaId === idea.id);
  const heur = heuristics(idea);
  const items: ScoreItem[] = [];

  for (const key of Object.keys(SCORE_WEIGHTS) as ScoreKey[]) {
    // 1) 人の入力が最優先
    const h = human.find((x) => x.key === key);
    if (h) {
      items.push({ key, ratio: h.ratio, basis: 'HUMAN', status: 'DATA_AVAILABLE', reason: h.reason || '人が評価' });
      continue;
    }

    // 2) 実データから導ける項目
    if (key === 'japanUnpenetrated') {
      const r = ctx.japan ? stageRatio(ctx.japan.stage) : null;
      items.push({
        key,
        ratio: r,
        basis: r === null ? 'NONE' : 'EVIDENCE',
        status: r === null ? 'NOT_CONFIGURED' : 'DATA_AVAILABLE',
        reason: ctx.japan ? `日本での普及段階: ${ctx.japan.stage}` : '日本語調査が未実施',
      });
      continue;
    }
    if (key === 'overseasGrowth') {
      const m = ctx.market;
      let ratio: number | null = null;
      let reason = '市場バックテスト未実施';
      if (m && m.trend !== 'INSUFFICIENT_DATA' && m.growthRatio !== null) {
        ratio = Math.min(1, Math.max(0, (m.growthRatio - 0.5) / 1.5));
        reason = `直近12ヶ月の言及数の伸び ${m.growthRatio.toFixed(2)}倍（${m.trend}）`;
      }
      items.push({
        key,
        ratio,
        basis: ratio === null ? 'NONE' : 'EVIDENCE',
        status: ratio === null ? 'NO_DATA' : 'DATA_AVAILABLE',
        reason,
      });
      continue;
    }

    // 3) 仮置き（弱い根拠）
    const hv = heur[key];
    if (hv) {
      items.push({ key, ratio: hv.ratio, basis: 'HEURISTIC', status: 'DATA_AVAILABLE', reason: hv.reason });
      continue;
    }

    // 4) 根拠なし = 採点対象外（0点にはしない）
    items.push({ key, ratio: null, basis: 'NONE', status: 'NO_DATA', reason: '根拠なし（未評価）' });
  }

  let earned = 0;
  let availableWeight = 0;
  let strongWeight = 0;
  const totalWeight = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

  for (const it of items) {
    const w = SCORE_WEIGHTS[it.key];
    if (it.ratio === null) continue;
    earned += w * it.ratio;
    availableWeight += w;
    if (it.basis === 'EVIDENCE' || it.basis === 'HUMAN') strongWeight += w;
  }

  const normalized100 = availableWeight === 0 ? 0 : (earned / availableWeight) * 100;
  const coverage = availableWeight / totalWeight;
  const strongCoverage = strongWeight / totalWeight;
  const grade = gradeFromScore(normalized100, strongCoverage);

  const result: ScoreResult = {
    ideaId: idea.id,
    items,
    earned: Math.round(earned * 10) / 10,
    availableWeight,
    normalized100: Math.round(normalized100 * 10) / 10,
    coverage: Math.round(coverage * 100) / 100,
    strongCoverage: Math.round(strongCoverage * 100) / 100,
    grade,
    scoredAt: nowIso(),
  };

  await run(
    `INSERT INTO scores (idea_id, items_json, earned, available_weight, normalized100, coverage, grade, scored_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(idea_id) DO UPDATE SET items_json=excluded.items_json, earned=excluded.earned,
       available_weight=excluded.available_weight, normalized100=excluded.normalized100,
       coverage=excluded.coverage, grade=excluded.grade, scored_at=excluded.scored_at`,
    [
      idea.id,
      JSON.stringify({ items, strongCoverage: result.strongCoverage }),
      result.earned,
      availableWeight,
      result.normalized100,
      result.coverage,
      grade,
      result.scoredAt,
    ]
  );

  return result;
}

export async function getScore(ideaId: string): Promise<ScoreResult | null> {
  const rows = await all<{
    idea_id: string;
    items_json: string;
    earned: number;
    available_weight: number;
    normalized100: number;
    coverage: number;
    grade: Grade;
    scored_at: string;
  }>('SELECT * FROM scores WHERE idea_id = ?', [ideaId]);
  const r = rows[0];
  if (!r) return null;
  const parsed = JSON.parse(r.items_json) as { items: ScoreItem[]; strongCoverage: number };
  return {
    ideaId: r.idea_id,
    items: parsed.items,
    earned: r.earned,
    availableWeight: r.available_weight,
    normalized100: r.normalized100,
    coverage: r.coverage,
    strongCoverage: parsed.strongCoverage ?? 0,
    grade: r.grade,
    scoredAt: r.scored_at,
  };
}
