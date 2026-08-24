import { all, insert, newId, nowIso, parseJson, run } from './db/client';
import type { OemRequirement, ProductCore, ReviewAnalysisResult } from './types';

/**
 * OEM改善要件の蓄積（事業Vault/Amazon AI Seller OS/05）。
 *
 * ★このシステムで一番価値が出る場所
 *   最終ゴールは自社OEM商品を作ること。その設計図は想像で書くのではなく、
 *   「他社商品の低評価レビューに何度も出てくる不満」そのもの。
 *   相乗り・新規出品の各フェーズはこのデータを溜めるための調査でもある。
 *
 *   同じ不満が何回出たか（hit_count）でカテゴリー別に積み上げ、
 *   3回以上=high / 2回=medium / 1回=low として優先度を付ける。
 */

/** 表記ゆれを吸収して「同じ不満」としてまとめるためのキー化 */
function normalizeComplaint(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[。、,.!！?？\s　「」『』()（）]/g, '')
    .slice(0, 60);
}

function priorityOf(count: number): OemRequirement['priority'] {
  if (count >= 3) return 'high';
  if (count === 2) return 'medium';
  return 'low';
}

/**
 * レビュー分析の結果からOEM改善要件を溜める。
 * 不満（complaints）と改善要望（improvementRequests）の両方を対象にする。
 */
export async function recordOemRequirements(
  product: ProductCore,
  analysis: ReviewAnalysisResult | null | undefined,
): Promise<number> {
  if (!analysis) return 0;
  const category = (product.category || 'その他').trim();
  const phrases = [...(analysis.complaints || []), ...(analysis.improvementRequests || [])]
    .map((s) => (s || '').trim())
    .filter((s) => s.length >= 4);
  if (!phrases.length) return 0;

  const now = nowIso();
  const existing = await all('SELECT * FROM oem_requirements WHERE category = ?', [category]);
  const byKey = new Map<string, any>();
  for (const r of existing) byKey.set(normalizeComplaint(String(r.complaint)), r);

  let saved = 0;
  const seenThisTime = new Set<string>();

  for (const phrase of phrases) {
    const key = normalizeComplaint(phrase);
    if (!key || seenThisTime.has(key)) continue;
    seenThisTime.add(key);

    const hit = byKey.get(key);
    if (hit) {
      const count = Number(hit.hit_count || 0) + 1;
      const titles: string[] = parseJson(hit.sample_product_titles, []);
      if (product.title && !titles.includes(product.title)) titles.push(product.title);
      await run(
        'UPDATE oem_requirements SET hit_count = ?, priority = ?, sample_product_titles = ?, updated_at = ? WHERE id = ?',
        [count, priorityOf(count), JSON.stringify(titles.slice(0, 10)), now, String(hit.id)],
      );
    } else {
      await insert('oem_requirements', {
        id: newId('oem'),
        category,
        complaint: phrase.slice(0, 200),
        hit_count: 1,
        priority: 'low',
        sample_product_titles: JSON.stringify(product.title ? [product.title] : []),
        first_seen_at: now,
        updated_at: now,
      });
    }
    saved++;
  }
  return saved;
}

/** 溜まったOEM要件を優先度順に取り出す */
export async function listOemRequirements(opts?: { category?: string; limit?: number }): Promise<OemRequirement[]> {
  const limit = opts?.limit ?? 50;
  const rows = opts?.category
    ? await all(
        'SELECT * FROM oem_requirements WHERE category = ? ORDER BY hit_count DESC, updated_at DESC LIMIT ?',
        [opts.category, limit],
      )
    : await all('SELECT * FROM oem_requirements ORDER BY hit_count DESC, updated_at DESC LIMIT ?', [limit]);

  return rows.map((r) => ({
    category: String(r.category),
    complaint: String(r.complaint),
    hitCount: Number(r.hit_count || 0),
    priority: (r.priority as OemRequirement['priority']) || 'low',
    sampleProductTitles: parseJson<string[]>(r.sample_product_titles, []),
  }));
}

/** カテゴリー別の「作るべき自社商品」候補（不満が集中しているカテゴリー順） */
export async function oemOpportunityByCategory(): Promise<
  { category: string; totalHits: number; topComplaints: string[] }[]
> {
  const rows = await all(
    'SELECT category, SUM(hit_count) AS hits FROM oem_requirements GROUP BY category ORDER BY hits DESC LIMIT 10',
  );
  const out: { category: string; totalHits: number; topComplaints: string[] }[] = [];
  for (const r of rows) {
    const category = String(r.category);
    const top = await all(
      'SELECT complaint FROM oem_requirements WHERE category = ? ORDER BY hit_count DESC LIMIT 3',
      [category],
    );
    out.push({
      category,
      totalHits: Number(r.hits || 0),
      topComplaints: top.map((t) => String(t.complaint)),
    });
  }
  return out;
}
