import { all, batch, nowIso } from './db/client';
import { percentile } from './forecast';

/**
 * 利益機会の半減期と「人間の承認が間に合うか」の判定（Phase 3.5・§7 §8）。
 *
 * 【何を測っているのか】
 * 「A市場で8万、B市場で10万」という差は、永遠には残らない。
 * 誰かが先に買えば消えるし、相場が動いても消える。
 * その差が生まれてから消えるまでの時間を、市場の組ごとに集めたのがこの表。
 *
 * 【半減期という言い方をする理由】
 * 平均で語ると、たまたま長く残った1件に引っ張られて実態より長く見える。
 * 「半分が消えるまでの時間（＝中央値）」で語れば、
 * 「10件のうち5件は◯時間で消える」と読めるので、間に合うかどうかの判断に直結する。
 *
 * 【この数字の使い道は1つだけ】
 * 人間が承認するのに必要な時間（HUMAN_REACH_HOURS＝既定24時間）より
 * 半減期が短ければ、その市場の組は「人が承認していたら間に合わない」。
 *
 * ここで大事なのは、間に合わないと分かったときに何をするかである。
 *   ×  間に合わないから自動購入を解禁する
 *   ○  間に合わないから、その市場の組は今の体制では取りに行かないと決める
 *
 * このシステムは後者を選ぶ。速さのために安全確認を飛ばすことはしない。
 * AUTO_ONLY という判定は「自動化してよい」という意味ではなく、
 * 「人の承認前提では取れない機会である」という事実の記録である。
 */

export type Reachability =
  /** 人が承認しても十分間に合う */
  | 'HUMAN_APPROVAL_OK'
  /** ぎりぎり。承認が遅れると半分は消えている */
  | 'TIGHT'
  /** 人の承認前提では間に合わない。今の体制では取りに行かない */
  | 'AUTO_ONLY'
  /** 消えた実績がまだ足りず、判断できない */
  | 'UNKNOWN';

export const REACHABILITY_JA: Record<Reachability, string> = {
  HUMAN_APPROVAL_OK: '人が確認してから買っても間に合う',
  TIGHT: 'ぎりぎり。確認が遅れると半分は消えている',
  AUTO_ONLY: '人の確認では間に合わない（今の体制では取りに行かない）',
  UNKNOWN: '消えた実績が足りず、まだ判断できない',
};

/** これだけ消えた実績が無いと、寿命を語らない。少数の偶然を半減期と呼ばない。 */
export const MIN_EXPIRED_SAMPLES = 5;

export type HalfLifeRow = {
  segmentType: 'all' | 'pair' | 'cause';
  segmentKey: string;
  sampleCount: number;
  expiredCount: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
  halfLifeHours: number | null;
  reachability: Reachability;
  note: string;
};

/**
 * 半減期と到達可能性を決める。
 *
 * 半減期＝中央値。observationが少ないうちは UNKNOWN のまま返す。
 * 「分からない」を「大丈夫」に読み替えない。
 */
export function judgeReachability(
  halfLifeHours: number | null,
  expiredCount: number,
  humanReachHours: number,
): { reachability: Reachability; note: string } {
  if (halfLifeHours === null || expiredCount < MIN_EXPIRED_SAMPLES) {
    return {
      reachability: 'UNKNOWN',
      note: `消えた実績が${expiredCount}件しかない（${MIN_EXPIRED_SAMPLES}件必要）。まだ寿命を語れない`,
    };
  }
  if (halfLifeHours >= humanReachHours * 2) {
    return {
      reachability: 'HUMAN_APPROVAL_OK',
      note: `半分が消えるまで約${Math.round(halfLifeHours)}時間。承認に見込む${humanReachHours}時間の2倍以上あり、余裕がある`,
    };
  }
  if (halfLifeHours >= humanReachHours) {
    return {
      reachability: 'TIGHT',
      note: `半分が消えるまで約${Math.round(halfLifeHours)}時間。承認に見込む${humanReachHours}時間とほぼ同じで、遅れると取り逃す`,
    };
  }
  return {
    reachability: 'AUTO_ONLY',
    note: `半分が消えるまで約${Math.round(halfLifeHours)}時間しかなく、承認に見込む${humanReachHours}時間より短い。人の確認を前提にすると取れない機会`,
  };
}

/**
 * 消えた機会の寿命を集め、市場の組ごと・原因ごとに半減期を出す。
 *
 * 【まだ消えていないものを寿命0扱いしない】
 * expired_at が入っていない行は、単にまだ生きているだけかもしれない。
 * 消えた実績（expired_at と lifetime_hours がある行）だけで計算する。
 */
export async function rebuildHalfLife(humanReachHours: number): Promise<HalfLifeRow[]> {
  const rows = await all(
    `SELECT buy_venue_code, sell_venue_code, cause_class, lifetime_hours, expired_at
       FROM opportunity_lifetimes`,
  );

  const buckets = new Map<string, { type: HalfLifeRow['segmentType']; key: string; seen: number; lives: number[] }>();
  const put = (type: HalfLifeRow['segmentType'], key: string, life: number | null) => {
    const id = `${type}|${key}`;
    let b = buckets.get(id);
    if (!b) { b = { type, key, seen: 0, lives: [] }; buckets.set(id, b); }
    b.seen++;
    if (life !== null) b.lives.push(life);
  };

  for (const r of rows) {
    const expired = r.expired_at !== null && r.expired_at !== undefined;
    const raw = r.lifetime_hours;
    // 消えた実績があり、時間が読めるものだけを寿命として数える。
    const life = expired && raw !== null && raw !== undefined && Number.isFinite(Number(raw))
      ? Number(raw) : null;
    put('all', '*', life);
    put('pair', `${String(r.buy_venue_code)}→${String(r.sell_venue_code)}`, life);
    put('cause', String(r.cause_class ?? 'UNKNOWN'), life);
  }

  const out: HalfLifeRow[] = [];
  for (const b of buckets.values()) {
    const sorted = [...b.lives].sort((x, y) => x - y);
    const median = sorted.length > 0 ? percentile(sorted, 0.5) : null;
    const j = judgeReachability(median, sorted.length, humanReachHours);
    out.push({
      segmentType: b.type,
      segmentKey: b.key,
      sampleCount: b.seen,
      expiredCount: sorted.length,
      p25: sorted.length > 0 ? percentile(sorted, 0.25) : null,
      median,
      p75: sorted.length > 0 ? percentile(sorted, 0.75) : null,
      halfLifeHours: median,
      reachability: j.reachability,
      note: j.note,
    });
  }

  const now = nowIso();
  const stmts = out.map((r) => ({
    sql: `INSERT INTO opportunity_half_life
      (segment_type, segment_key, sample_count, expired_count,
       p25_lifetime_hours, median_lifetime_hours, p75_lifetime_hours,
       half_life_hours, reachability, reachability_note, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(segment_type, segment_key) DO UPDATE SET
       sample_count = excluded.sample_count, expired_count = excluded.expired_count,
       p25_lifetime_hours = excluded.p25_lifetime_hours,
       median_lifetime_hours = excluded.median_lifetime_hours,
       p75_lifetime_hours = excluded.p75_lifetime_hours,
       half_life_hours = excluded.half_life_hours,
       reachability = excluded.reachability, reachability_note = excluded.reachability_note,
       updated_at = excluded.updated_at`,
    args: [
      r.segmentType, r.segmentKey, r.sampleCount, r.expiredCount,
      r.p25, r.median, r.p75, r.halfLifeHours, r.reachability, r.note, now,
    ],
  }));
  for (let i = 0; i < stmts.length; i += 300) await batch(stmts.slice(i, i + 300));
  return out;
}

/** 画面用。人が承認して間に合う組み合わせを上に出す。 */
export async function halfLifeTable() {
  return all(
    `SELECT segment_type, segment_key, sample_count, expired_count,
            p25_lifetime_hours, median_lifetime_hours, p75_lifetime_hours,
            half_life_hours, reachability, reachability_note, updated_at
       FROM opportunity_half_life
      ORDER BY CASE reachability
                 WHEN 'HUMAN_APPROVAL_OK' THEN 0 WHEN 'TIGHT' THEN 1
                 WHEN 'AUTO_ONLY' THEN 2 ELSE 3 END,
               expired_count DESC`,
  );
}
