import { nowIso, run, type Row } from '../db/client';
import { NEED_LABEL, type NeedFlags, type NeedKey } from '../needs';
import { INDUSTRY_LABEL, type IndustryKey } from '../industry';
import type { OfferRow } from '../catalog/sync';

/**
 * この会社に何を売るかを決める。
 *
 * 商品は固定しない。会社の業種と、抱えていそうな課題に、
 * 自社の商品カタログを突き合わせて点を付ける。
 *
 * ★売れない状態の商品（BLOCKED / DEV）は、1位として選ばない。
 *   「本当は売れないもの」を営業してしまうと、話が進んだ時に必ず事故になる。
 */

export type OfferMatch = {
  offerCode: string;
  offerName: string;
  fitScore: number; // 0..100
  reason: string;
  sellable: boolean;
  blockedReason: string | null;
};

export function matchOffers(industry: IndustryKey, needFlags: NeedFlags, offers: OfferRow[]): OfferMatch[] {
  const results: OfferMatch[] = [];

  for (const o of offers) {
    const industryHit = o.fitIndustries.includes(industry);
    const industryPoints = industryHit ? 45 : o.fitIndustries.length === 0 ? 0 : 0;

    const needHits: { key: NeedKey; score: number }[] = [];
    for (const n of o.fitNeeds) {
      const v = needFlags[n as NeedKey];
      if (typeof v === 'number' && v > 0) needHits.push({ key: n as NeedKey, score: v });
    }
    needHits.sort((a, b) => b.score - a.score);
    // 上位3つの課題の平均を、最大55点として使う
    const top = needHits.slice(0, 3);
    const needPoints = top.length === 0 ? 0 : Math.round((top.reduce((s, x) => s + x.score, 0) / top.length / 100) * 55);

    const fitScore = Math.min(100, industryPoints + needPoints);
    if (fitScore <= 0) continue;

    const reasonParts: string[] = [];
    if (industryHit) reasonParts.push(`業種が${INDUSTRY_LABEL[industry]}で合う`);
    if (top.length > 0) reasonParts.push(`${top.map((t) => NEED_LABEL[t.key]).join('・')}に効く`);
    if (!industryHit) reasonParts.push('業種の一致は無いので課題だけで判断している');

    results.push({
      offerCode: o.code,
      offerName: o.name,
      fitScore,
      reason: reasonParts.join('／'),
      sellable: o.status === 'SELLABLE',
      blockedReason: o.status === 'SELLABLE' ? null : (o.status_reason ?? `今は${o.status}のため売れない`),
    });
  }

  // 売れるものを先に、その中で点の高い順
  results.sort((a, b) => {
    if (a.sellable !== b.sellable) return a.sellable ? -1 : 1;
    return b.fitScore - a.fitScore;
  });
  return results;
}

export async function saveOfferMatches(companyId: number, matches: OfferMatch[]): Promise<void> {
  await run('DELETE FROM company_offers WHERE company_id = ?', [companyId]);
  const at = nowIso();
  let rank = 1;
  for (const m of matches.slice(0, 5)) {
    await run(
      'INSERT INTO company_offers (company_id, offer_code, rank, fit_score, reason, sellable, blocked_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        companyId,
        m.offerCode,
        rank,
        m.fitScore,
        m.sellable ? m.reason : `${m.reason}（ただし${m.blockedReason}）`,
        m.sellable ? 1 : 0,
        m.sellable ? null : (m.blockedReason ?? null),
        at,
      ],
    );
    rank++;
  }
}

/** 実際に営業に使ってよい1位。売れない商品しか当たらなければ null を返す。 */
export function primarySellable(matches: OfferMatch[]): OfferMatch | null {
  return matches.find((m) => m.sellable && m.fitScore >= 30) ?? null;
}
