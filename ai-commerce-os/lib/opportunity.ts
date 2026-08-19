import { all, batch, nowIso } from './db/client';

/**
 * 利益機会の寿命（Phase 3・§14 §15 §16）。
 *
 * 【なぜ寿命を測るのか】
 * 価格差は永遠には続かない。誰かが買えば消える。
 * 「利益は大きいが、見つけた時にはもう無い」機会ばかり追いかけると、
 * 画面上の予想利益だけが増えて現金は増えない。
 *
 * 消えるまでの時間を記録しておくと、
 * 「この種類の価格差は何時間以内に動かないと間に合わないか」が後から分かる。
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- 消える速さ

/**
 * OPPORTUNITY SPEED SCORE（0〜100）。
 * 100に近いほど「すぐ消える＝見つけてもまず間に合わない」。
 *
 * 【まだ消えていないものは高くしない】
 * 生きている機会に高い速度スコアを付けると「急げ」という誤った合図になる。
 * 消えた実績がある機会だけ、消えるまでの時間から算出する。
 */
export function speedScore(
  lifetimeHours: number | null,
  expired: boolean,
  fastHours: number,
): number | null {
  if (!expired || lifetimeHours === null) return null;
  if (lifetimeHours <= 0) return 100;
  // fastHours(既定24h)で消えたら90点。倍の時間もったら半分以下になるよう対数で落とす。
  const ratio = lifetimeHours / Math.max(1, fastHours);
  const score = 90 - 30 * Math.log2(Math.max(0.25, ratio));
  return Math.round(clamp(score, 0, 100));
}

// ---------------------------------------------------------------- 消えた原因

export type CauseClass =
  | 'SUPPLIER_SALE'        // 仕入先のセール
  | 'SUPPLIER_PRICE_DROP'  // 仕入先の値下げ
  | 'NEW_LISTING'          // 新規出品が出た
  | 'MARKET_SURGE'         // 販売相場の急騰
  | 'MARKET_DROP'          // 販売相場の下落
  | 'STOCK_CLEARANCE'      // 在庫処分
  | 'FX'                   // 為替
  | 'PRICE_LAG'            // 市場間の価格更新の遅れ
  | 'UNKNOWN';

export const CAUSE_JA: Record<CauseClass, string> = {
  SUPPLIER_SALE: '仕入先のセール',
  SUPPLIER_PRICE_DROP: '仕入先の値下げ',
  NEW_LISTING: '新規出品が出た',
  MARKET_SURGE: '販売相場の急騰',
  MARKET_DROP: '販売相場の下落',
  STOCK_CLEARANCE: '在庫処分',
  FX: '為替の影響',
  PRICE_LAG: '市場間で価格の反映が遅れている',
  UNKNOWN: '原因不明',
};

export type CauseInput = {
  buyPrice: number;
  sellPrice: number;
  /** 仕入先側の相場（あれば）。仕入価格がこれより明らかに安ければセール・値下げ。 */
  buyMarketMedian: number | null;
  /** 販売側の相場の観測日時。仕入側とかけ離れていれば反映の遅れ。 */
  sellObservedAt: string | null;
  buyObservedAt: string | null;
  /** 販売側の出品件数。極端に少なければ品薄で相場が跳ねている可能性。 */
  sellListingCount: number | null;
  crossBorder: boolean;
};

/**
 * 価格差がなぜ生まれているかを分類する（§16）。
 *
 * 【断定しない】
 * 確かめようがないものは UNKNOWN のままにする。
 * ここで無理に理由を付けると、それが正しいという前提で次の判断が積み上がる。
 */
export function classifyCause(i: CauseInput): { cls: CauseClass; note: string } {
  // 海外との差は為替と関税の影響が大きい。まずこれを見る。
  if (i.crossBorder) {
    return { cls: 'FX', note: '通貨が異なる市場をまたぐため、為替と関税の影響を受ける' };
  }

  if (i.buyMarketMedian !== null && i.buyMarketMedian > 0) {
    const ratio = i.buyPrice / i.buyMarketMedian;
    if (ratio <= 0.7) {
      return { cls: 'SUPPLIER_SALE', note: `仕入価格が仕入先の相場の${Math.round(ratio * 100)}%。セールか処分の可能性` };
    }
    if (ratio <= 0.85) {
      return { cls: 'SUPPLIER_PRICE_DROP', note: `仕入価格が仕入先の相場より${Math.round((1 - ratio) * 100)}%安い` };
    }
  }

  // 両側の相場の取得日が離れていれば、片方が古いだけかもしれない。
  if (i.sellObservedAt && i.buyObservedAt) {
    const gapHours = Math.abs(Date.parse(i.sellObservedAt) - Date.parse(i.buyObservedAt)) / 3600000;
    if (Number.isFinite(gapHours) && gapHours >= 72) {
      return { cls: 'PRICE_LAG', note: `両市場の相場の取得日が${Math.round(gapHours / 24)}日離れている。価格差ではなく更新の遅れの可能性` };
    }
  }

  if (i.sellListingCount !== null && i.sellListingCount > 0 && i.sellListingCount <= 3) {
    return { cls: 'MARKET_SURGE', note: `販売側の出品が${i.sellListingCount}件しかない。品薄で相場が上振れている可能性` };
  }

  return { cls: 'UNKNOWN', note: '価格差の原因を特定できる材料が無い' };
}

// ---------------------------------------------------------------- 記録

export type OpportunityObservation = {
  identityKey: string;
  buyVenueCode: string;
  sellVenueCode: string;
  netProfit: number;
  cause: { cls: CauseClass; note: string };
  seenAt?: string;
};

/**
 * 見えている利益機会を記録する。
 * 同じ組み合わせは1行にまとめ、初回・最高・最後に儲かっていた時刻を更新していく。
 */
export async function recordOpportunities(
  obs: OpportunityObservation[],
  opts: { fastHours: number; now?: string },
): Promise<{ tracked: number }> {
  if (obs.length === 0) return { tracked: 0 };
  const now = opts.now ?? nowIso();

  // 同じ商品・同じ市場の組み合わせが、仕入元の重複で何度も来ることがある。
  // そのまま順に書くと「最後に来た安くない仕入」で上書きされ、
  // 時間で消えたわけでもないのに消滅扱いになる。今この瞬間の最良だけを残す。
  const bestByKey = new Map<string, OpportunityObservation>();
  for (const o of obs) {
    const key = `${o.identityKey}|${o.buyVenueCode}|${o.sellVenueCode}`;
    const prev = bestByKey.get(key);
    if (!prev || o.netProfit > prev.netProfit) bestByKey.set(key, o);
  }

  const stmts = [...bestByKey.values()].map((o) => {
    const seenAt = o.seenAt ?? now;
    const profitable = o.netProfit > 0;

    // 一度も儲かったことがない組み合わせは「機会」ではない。新しい行は作らない。
    // ただし既に追跡中の組み合わせなら、儲からなくなったことを必ず記録する（消滅の判定に要る）。
    if (!profitable) {
      return {
        sql: `UPDATE opportunity_lifetimes
                 SET last_net_profit = ?, last_seen_at = ?, observation_count = observation_count + 1,
                     cause_class = ?, cause_note = ?, updated_at = ?
               WHERE identity_key = ? AND buy_venue_code = ? AND sell_venue_code = ?`,
        args: [
          o.netProfit, seenAt, o.cause.cls, o.cause.note, now,
          o.identityKey, o.buyVenueCode, o.sellVenueCode,
        ],
      };
    }

    return {
      sql: `INSERT INTO opportunity_lifetimes
        (identity_key, buy_venue_code, sell_venue_code, first_seen_at, best_seen_at,
         best_net_profit, first_net_profit, last_net_profit, last_profitable_at, last_seen_at,
         observation_count, cause_class, cause_note, updated_at)
       VALUES (?,?,?,?,?, ?,?,?,?,?, 1,?,?,?)
       ON CONFLICT(identity_key, buy_venue_code, sell_venue_code) DO UPDATE SET
         last_net_profit = excluded.last_net_profit,
         last_seen_at = excluded.last_seen_at,
         observation_count = observation_count + 1,
         best_net_profit = CASE WHEN excluded.last_net_profit > best_net_profit
                                THEN excluded.last_net_profit ELSE best_net_profit END,
         best_seen_at = CASE WHEN excluded.last_net_profit > best_net_profit
                             THEN excluded.last_seen_at ELSE best_seen_at END,
         last_profitable_at = CASE WHEN excluded.last_net_profit > 0
                                   THEN excluded.last_seen_at ELSE last_profitable_at END,
         -- 一度消えた機会がまた儲かるようになったら、消滅の記録を取り消す
         expired_at = CASE WHEN excluded.last_net_profit > 0 THEN NULL ELSE expired_at END,
         cause_class = excluded.cause_class,
         cause_note = excluded.cause_note,
         updated_at = excluded.updated_at`,
      args: [
        o.identityKey, o.buyVenueCode, o.sellVenueCode, seenAt, seenAt,
        o.netProfit, o.netProfit, o.netProfit, profitable ? seenAt : null, seenAt,
        o.cause.cls, o.cause.note, now,
      ],
    };
  });

  for (let i = 0; i < stmts.length; i += 300) await batch(stmts.slice(i, i + 300));
  await markExpired(opts.fastHours, now);
  return { tracked: stmts.length };
}

/**
 * 儲からなくなった機会に消滅時刻を打ち、寿命と速度スコアを計算する。
 * 「今回見えていない」だけでは消したことにしない（データが来なかっただけかもしれない）。
 * 見えていて、かつ利益が消えているときだけ消滅とする。
 */
export async function markExpired(fastHours: number, now?: string): Promise<number> {
  const t = now ?? nowIso();
  const rows = await all(
    `SELECT id, first_seen_at, last_profitable_at, last_net_profit, last_seen_at, expired_at
       FROM opportunity_lifetimes
      WHERE last_net_profit <= 0 AND expired_at IS NULL AND last_profitable_at IS NOT NULL`,
  );
  if (rows.length === 0) return 0;

  const stmts = rows.map((r) => {
    const start = Date.parse(String(r.first_seen_at));
    const end = Date.parse(String(r.last_seen_at));
    const lifetime = Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? (end - start) / 3600000 : null;
    return {
      sql: `UPDATE opportunity_lifetimes
              SET expired_at = ?, lifetime_hours = ?, speed_score = ?, updated_at = ?
            WHERE id = ?`,
      args: [r.last_seen_at, lifetime, speedScore(lifetime, true, fastHours), t, r.id],
    };
  });
  for (let i = 0; i < stmts.length; i += 300) await batch(stmts.slice(i, i + 300));
  return rows.length;
}

/** 画面用。消えるのが速い順。 */
export async function fastestOpportunities(limit = 30) {
  return all(
    `SELECT * FROM opportunity_lifetimes
      WHERE speed_score IS NOT NULL
      ORDER BY speed_score DESC LIMIT ?`, [limit],
  );
}

export async function opportunitySummary() {
  const rows = await all(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN expired_at IS NULL THEN 1 ELSE 0 END) AS alive,
           SUM(CASE WHEN expired_at IS NOT NULL THEN 1 ELSE 0 END) AS expired,
           AVG(lifetime_hours) AS avg_lifetime_hours,
           AVG(speed_score) AS avg_speed_score
      FROM opportunity_lifetimes`);
  return rows[0] ?? null;
}
