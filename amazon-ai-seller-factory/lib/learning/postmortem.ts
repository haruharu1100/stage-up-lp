import { all, insert, newId, nowIso, parseJson, run } from '../db/client';
import {
  FAILURE_REASON_LABEL,
  LATERAL_KIND_LABEL,
  type FailureReason,
  type LateralKind,
} from '../types';

/**
 * 失敗学習と、成功商品の横展開。
 *
 * ユーザー指定：
 *   失敗 → 「なぜダメだったか」を分類して残し、同じ失敗を減らす
 *   成功 → 「1個当たったら、その周辺を掘る」
 *
 * ★どちらもAIを呼ばない。分類はコード側のルール、横展開は検索語を組み立てるだけ。
 */

// ==================================================================
// 失敗の分類
// ==================================================================

export interface FailureStat {
  reason: FailureReason;
  label: string;
  count: number;
  /** その失敗で失ったお金の合計（円） */
  lossJpy: number;
  /** 次に同じ失敗をしないための一言 */
  advice: string;
}

const ADVICE: Record<FailureReason, string> = {
  price_drop: 'Amazon価格が下がる前提で利益を見る（90日平均価格を基準にする）',
  competitor_increase: '出品者が増えやすい商品は初回の数量をさらに減らす',
  demand_miss: '推定月販をそのまま信じず、カテゴリー別の補正倍率を必ず通す',
  ad_cost: '広告費込みの純利益で判断する（ACOSではなく広告後純利益）',
  high_purchase_cost: '仕入価格の交渉余地を確認してから承認する',
  returns: '評価の低い商品（★3.5未満）は返品コストを厚めに見積もる',
  weak_listing: '相乗りではなく、商品ページを作れる商品を優先する',
  season_end: '季節商品は「売り切れる日数」がシーズン終了に間に合うか先に確認する',
  regulation: '食品・電気製品・化粧品は承認前に必ず規制チェックを通す',
  overstock: '初回仕入れの上限をもっと下げる（安全在庫日数を短くする）',
};

/** どの失敗が多いかを集計する（画面と、次のリサーチの注意書きに使う） */
export async function failureStats(): Promise<{ total: number; stats: FailureStat[] }> {
  const rows = await all(
    `SELECT failure_reasons, planned_total_cost_jpy, actual_profit_jpy
       FROM product_lifecycle WHERE status = 'FAILED'`,
  );

  const map = new Map<FailureReason, { count: number; loss: number }>();
  for (const r of rows) {
    const reasons = parseJson<FailureReason[]>(r.failure_reasons, []);
    const cost = Number(r.planned_total_cost_jpy) || 0;
    const profit = Number(r.actual_profit_jpy);
    // 損失＝利益がマイナスならその額、実績が無ければ投じた金額を暫定の損失とみなす
    const loss = Number.isFinite(profit) ? Math.max(0, -profit) : cost;
    for (const reason of reasons) {
      const cur = map.get(reason) || { count: 0, loss: 0 };
      cur.count += 1;
      cur.loss += loss / Math.max(1, reasons.length);
      map.set(reason, cur);
    }
  }

  const stats: FailureStat[] = Array.from(map.entries())
    .map(([reason, v]) => ({
      reason,
      label: FAILURE_REASON_LABEL[reason],
      count: v.count,
      lossJpy: Math.round(v.loss),
      advice: ADVICE[reason],
    }))
    .sort((a, b) => b.count - a.count || b.lossJpy - a.lossJpy);

  return { total: rows.length, stats };
}

/**
 * 「今リサーチしている商品」に、過去の失敗から見た注意点を付ける。
 * ★3回以上起きた失敗だけを警告する（1回の偶然で判断を歪めない）。
 */
export async function failureWarningsFor(input: {
  category: string | null;
  sellerCount: number | null;
  rating: number | null;
  isFood: boolean;
  moq: number;
}): Promise<string[]> {
  const { stats } = await failureStats();
  const hot = new Set(stats.filter((s) => s.count >= 3).map((s) => s.reason));
  const out: string[] = [];

  if (hot.has('competitor_increase') && (input.sellerCount ?? 0) >= 5) {
    out.push('過去に「競合増加」で失敗しています。出品者が多いこの商品は数量を控えめに');
  }
  if (hot.has('returns') && (input.rating ?? 5) < 3.8) {
    out.push('過去に「返品」で失敗しています。評価が低いこの商品は返品コストを厚く見てください');
  }
  if (hot.has('regulation') && input.isFood) {
    out.push('過去に「規制」で失敗しています。食品なので承認前に表示と許可を必ず確認してください');
  }
  if (hot.has('overstock') && input.moq >= 50) {
    out.push('過去に「在庫過多」で失敗しています。最低発注数が多いこの商品は要注意です');
  }
  if (hot.has('demand_miss')) {
    out.push('過去に「需要予測ミス」が多いため、推定月販は割り引いて見てください');
  }
  return out;
}

// ==================================================================
// 成功商品の横展開（1個当たったら、その周辺を掘る）
// ==================================================================

export interface LateralSeedInput {
  lifecycleId: string;
  originAsin: string | null;
  title: string | null;
  category: string | null;
  supplier: string | null;
  attributes?: { color?: string | null; capacity?: string | null; setCount?: number | null } | null;
}

/**
 * 売れた商品から、次に探すべき方向を8種類ぶん作る。
 * ここでは検索語を作ってキューに積むだけで、実際の探索は次回のリサーチが行う。
 */
export async function seedLateralExploration(
  input: LateralSeedInput,
): Promise<{ created: number; skipped: number }> {
  const base = (input.title || '').trim();
  if (!base && !input.supplier && !input.category) return { created: 0, skipped: 0 };

  // 商品名の主要語だけ取る（長い型番や記号を落として検索しやすくする）
  const core = base
    .replace(/[【】\[\]()（）]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 4)
    .join(' ');

  const plans: { kind: LateralKind; query: string; reason: string }[] = [];
  if (input.supplier) {
    plans.push({
      kind: 'same_supplier',
      query: input.supplier,
      reason: `${input.supplier} で当たったので、同じ仕入先の他の商品を見ます`,
    });
  }
  if (input.category) {
    plans.push({
      kind: 'same_category',
      query: input.category,
      reason: `${input.category} が当たったので、同じカテゴリーを掘ります`,
    });
  }
  if (core) {
    plans.push({ kind: 'similar_item', query: core, reason: '売れた商品と似ている商品を探します' });
    plans.push({ kind: 'other_size', query: `${core} 大容量`, reason: '別サイズ（大容量）を探します' });
    plans.push({ kind: 'other_color', query: `${core} カラー`, reason: '別の色を探します' });
    plans.push({ kind: 'bundle', query: `${core} セット`, reason: 'セット販売の形を探します' });
    plans.push({ kind: 'upper_model', query: `${core} 上位`, reason: '上位モデルを探します' });
    plans.push({ kind: 'consumable', query: `${core} 替え`, reason: '関連する消耗品（替え・詰め替え）を探します' });
  }

  let created = 0;
  let skipped = 0;
  for (const p of plans) {
    // 同じ探索を何度も積まない
    const dup = await all(
      `SELECT id FROM lateral_seeds WHERE kind = ? AND query = ? AND status IN ('queued','exploring')`,
      [p.kind, p.query],
    );
    if (dup.length) {
      skipped++;
      continue;
    }
    await insert('lateral_seeds', {
      id: newId('lat'),
      lifecycle_id: input.lifecycleId,
      origin_asin: input.originAsin,
      kind: p.kind,
      query: p.query,
      reason: `${LATERAL_KIND_LABEL[p.kind]}：${p.reason}`,
      status: 'queued',
      created_at: nowIso(),
    });
    created++;
  }
  return { created, skipped };
}

/** 次のリサーチで掘る検索語を取り出す */
export async function nextLateralQueries(limit = 5): Promise<{ id: string; query: string; reason: string }[]> {
  const rows = await all(
    `SELECT id, query, reason FROM lateral_seeds WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ id: String(r.id), query: String(r.query), reason: String(r.reason ?? '') }));
}

export async function markLateralExplored(id: string, found: number): Promise<void> {
  await run(`UPDATE lateral_seeds SET status = ?, explored_at = ?, found = ? WHERE id = ?`, [
    'explored',
    nowIso(),
    found,
    id,
  ]);
}

export async function lateralSeedList(limit = 100) {
  return all(`SELECT * FROM lateral_seeds ORDER BY created_at DESC LIMIT ?`, [limit]);
}

/**
 * 売れた商品（SOLD_OUT・SELLINGで黒字）を見つけて、自動で横展開の種をまく。
 * ★探すだけ。仕入れも出品もしない。
 */
export async function seedFromWinners(): Promise<{ scanned: number; created: number }> {
  const rows = await all(
    `SELECT pl.*, rc.category AS rc_category, rc.supplier_title
       FROM product_lifecycle pl
       LEFT JOIN research_candidates rc ON rc.id = pl.research_candidate_id
      WHERE pl.status IN ('SOLD_OUT','SELLING')
        AND pl.actual_profit_jpy IS NOT NULL AND pl.actual_profit_jpy > 0`,
  );
  let created = 0;
  for (const r of rows) {
    const res = await seedLateralExploration({
      lifecycleId: String(r.id),
      originAsin: (r.asin as string) ?? null,
      title: (r.title as string) ?? (r.supplier_title as string) ?? null,
      category: (r.category as string) ?? (r.rc_category as string) ?? null,
      supplier: (r.supplier as string) ?? null,
    });
    created += res.created;
  }
  return { scanned: rows.length, created };
}
