import { all, nowIso, run } from '../db/client';

/**
 * カテゴリー別の予測補正。
 *
 * ユーザー指定：
 *   「食品／日用品／雑貨／家電アクセサリー／消耗品などカテゴリごとに
 *     推定と実績の誤差を保存し、
 *     例：カテゴリA = 推定の0.72倍 → 安全側へ補正
 *         カテゴリB = 推定の1.18倍 → 補正式へ反映」
 *   「LLMに丸投げせず、統計補正を優先してください。」
 *
 * ★平均ではなく中央値を使う。1件の大当たり／大外れで全体が歪むのを防ぐため。
 * ★実績が少ないうちは動かさない（権限ルール：実績5件未満は学習を動かさない）。
 * ★1回の変更幅は±20%まで（権限ルール）。
 */

const MAX_STEP = 0.2; // 1回に動かしてよい幅（±20%）

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function clampStep(prev: number | null, next: number): number {
  if (prev === null || !Number.isFinite(prev)) return next;
  const lo = prev * (1 - MAX_STEP);
  const hi = prev * (1 + MAX_STEP);
  return Math.min(hi, Math.max(lo, next));
}

export interface CategoryBiasRow {
  category: string;
  samples: number;
  demandMultiplier: number | null;
  profitMultiplier: number | null;
  priceMultiplier: number | null;
  demandAccuracy: number | null;
  profitAccuracy: number | null;
  priceAccuracy: number | null;
  applied: boolean;
  note: string;
}

/**
 * 実績テーブルを読み直して、カテゴリーごとの補正倍率を作り直す。
 * minSamples に届かないカテゴリーは「まだ補正しない」と正直に残す。
 */
export async function rebuildCategoryBias(minSamples = 5): Promise<CategoryBiasRow[]> {
  const rows = await all(
    `SELECT category, demand_ratio, profit_ratio, price_ratio,
            demand_accuracy, profit_accuracy, price_accuracy
       FROM forecast_accuracy
      WHERE category IS NOT NULL AND category <> ''`,
  );

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = String(r.category);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const prev = new Map<string, any>();
  for (const p of await all(`SELECT * FROM category_bias`)) prev.set(String(p.category), p);

  const out: CategoryBiasRow[] = [];
  for (const [category, list] of Array.from(groups.entries())) {
    const num = (key: string) =>
      list.map((r) => Number(r[key])).filter((x) => Number.isFinite(x) && x > 0);

    const dRaw = median(num('demand_ratio'));
    const pRaw = median(num('profit_ratio'));
    const prRaw = median(num('price_ratio'));

    const before = prev.get(category);
    const samples = list.length;
    const enough = samples >= minSamples;

    // ★実績が足りないうちは倍率を作らない（推測で補正しない）
    const demand = enough && dRaw !== null ? round2(clampStep(numOrNull(before?.demand_multiplier), dRaw)) : null;
    const profit = enough && pRaw !== null ? round2(clampStep(numOrNull(before?.profit_multiplier), pRaw)) : null;
    const price = enough && prRaw !== null ? round2(clampStep(numOrNull(before?.price_multiplier), prRaw)) : null;

    const accAvg = (key: string) => {
      const v = list.map((r) => Number(r[key])).filter((x) => Number.isFinite(x));
      return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
    };

    const row: CategoryBiasRow = {
      category,
      samples,
      demandMultiplier: demand,
      profitMultiplier: profit,
      priceMultiplier: price,
      demandAccuracy: accAvg('demand_accuracy'),
      profitAccuracy: accAvg('profit_accuracy'),
      priceAccuracy: accAvg('price_accuracy'),
      applied: enough && demand !== null,
      note: enough
        ? demand !== null
          ? `実績${samples}件。このカテゴリーは推定の${demand.toFixed(2)}倍で着地しています` +
            (demand < 1 ? '（予測が甘いので安全側へ補正します）' : '（予測が辛いので上方へ補正します）')
          : `実績${samples}件ありますが、比較できる数字がそろっていないため補正しません`
        : `実績${samples}件（${minSamples}件たまるまで補正しません）`,
    };
    out.push(row);

    await run(
      `INSERT INTO category_bias
         (category, samples, demand_multiplier, profit_multiplier, price_multiplier,
          demand_accuracy, profit_accuracy, price_accuracy, applied, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(category) DO UPDATE SET
         samples = excluded.samples,
         demand_multiplier = excluded.demand_multiplier,
         profit_multiplier = excluded.profit_multiplier,
         price_multiplier = excluded.price_multiplier,
         demand_accuracy = excluded.demand_accuracy,
         profit_accuracy = excluded.profit_accuracy,
         price_accuracy = excluded.price_accuracy,
         applied = excluded.applied,
         updated_at = excluded.updated_at`,
      [
        category,
        samples,
        demand,
        profit,
        price,
        row.demandAccuracy,
        row.profitAccuracy,
        row.priceAccuracy,
        row.applied ? 1 : 0,
        nowIso(),
      ],
    );
  }

  return out.sort((a, b) => b.samples - a.samples);
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * リサーチ中に使う「このカテゴリーの需要補正倍率」。
 * 補正が有効になっていないカテゴリーは 1.0（＝補正しない）を返す。
 */
export async function loadDemandMultipliers(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await all(`SELECT category, demand_multiplier FROM category_bias WHERE applied = 1`);
    for (const r of rows) {
      const m = numOrNull(r.demand_multiplier);
      if (m) out.set(String(r.category), m);
    }
  } catch {
    /* テーブルがまだ無い時は補正なしで動く */
  }
  return out;
}

export async function categoryBiasList() {
  return all(`SELECT * FROM category_bias ORDER BY samples DESC`);
}
