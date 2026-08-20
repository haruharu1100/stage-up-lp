import { all } from './db/client';
import { deriveFeeStatus } from './feestatus';

/**
 * 「なぜRouteにならなかったのか」を分類する（Phase 3.8・ユーザー指示7）。
 *
 * 【なぜこれが要るのか】
 * ファネルは「10件のうち3件しかRouteにならなかった」までは教えてくれるが、
 * **なぜ7件が落ちたのか**は教えてくれない。
 * 理由が分からないまま件数を10倍にしても、落ちる7割がそのまま70件になるだけで、
 * 分かることは何も増えない。
 *
 * 理由が分かれば、次にやることが一つに決まる。
 *   型番が無くて落ちた   → 型番の付いた商品を選ぶ。または型番を引き当てる仕組みを作る。
 *   相場が無くて落ちた   → 比べる市場の相場を登録する。商品を増やしても意味がない。
 *   利益が足りずに落ちた → **判定を甘くするのではなく**、安く買える仕入先を増やす。
 *
 * 【「その他」を作らない】
 * 分類できないものを「その他」に放り込むと、そこが一番大きくなって何も分からなくなる。
 * どうしても決まらないものは `LOW_DATA_CONFIDENCE`（材料が足りない）に入れ、
 * 「材料が足りない」ということ自体を一つの答えとして扱う。
 *
 * 【ここでは何も直さない】
 * このファイルは数えるだけ。落ちた商品を救うために閾値を動かすことはしない
 * （CLAUDE.md ルール13）。
 */

/** ユーザー指示の8分類。増やすときは「観測から言い切れるか」で判断する。 */
export const DROPOUT_REASONS = {
  MODEL_NUMBER_MISSING: {
    ja: '型番・JANが無い',
    why: '商品を特定できないので、他の市場の同じ商品を探せない。',
    next: '型番の載っている商品を選ぶ。または商品名から型番を引き当てる仕組みを作る。',
  },
  NO_SELL_MARKET: {
    ja: '売る先の市場が無い',
    why: '仕入れられても、売る市場が登録されていなければ利益は計算できない。',
    next: '販売先として使える市場を登録する。規約の確認まで済ませる。',
  },
  MARKET_DATA_MISSING: {
    ja: '他市場の相場が無い',
    why: '型番はあるが、比べる相手の市場にその商品の相場が1件も無い。',
    next: '比べたい市場の相場を登録する。商品の件数を増やしても、ここは埋まらない。',
  },
  PRODUCT_MATCH_FAILED: {
    ja: '同じ商品だと確かめられなかった',
    why: '機械が同じ商品だと判定したが、人が確認して違う商品だった（または判断が付かなかった）。',
    next: '何が原因で取り違えたかを見る。色・サイズ・年式・国内版と海外版の違いが多い。',
  },
  FEE_UNVERIFIED: {
    ja: '手数料が確定していない',
    why: '手数料が分からないまま利益を計算すると、その利益は数字の形をした推測にすぎない。',
    next: '公式ページで手数料の実額を確認して登録する。推測で埋めない。',
  },
  SHIPPING_UNKNOWN: {
    ja: '送料が分からない',
    why: '送料は利益の中で大きな割合を占める。不明のまま0円として計算しない決まりにしてある。',
    next: '荷物サイズか発送方法を記録する。どちらか分かれば見込み送料を出せる。',
  },
  INSUFFICIENT_MARGIN: {
    ja: '利益が足りない',
    why: '計算はできたが、費用を全部引くと基準の利益に届かない。',
    next: '**判定を甘くしない。** もっと安く買える仕入先を増やすか、別の商品を探す。',
  },
  LOW_DATA_CONFIDENCE: {
    ja: 'データの確からしさが足りない',
    why: '相場が古い・出品数が少ない・売れた実績が無いなど、判断の材料が薄い。',
    next: '相場を取り直す。売れた実績（SOLD）のある相場を使う。',
  },
} as const;

export type DropoutReason = keyof typeof DROPOUT_REASONS;

/** 落ちた段階。どの段で落ちたかが分かると、直す場所が絞れる。 */
export type DropoutStage =
  | 'IDENTIFY'   // 商品を特定する前
  | 'MATCH'      // 他市場と突き合わせる段
  | 'COST'       // 費用を確定する段
  | 'DECISION';  // 計算はできたが判定で落ちた段

export const DROPOUT_STAGE_JA: Record<DropoutStage, string> = {
  IDENTIFY: '商品を特定する前',
  MATCH: '他市場と突き合わせるところ',
  COST: '費用を確定するところ',
  DECISION: '計算はできたが判定で落ちた',
};

const STAGE_OF: Record<DropoutReason, DropoutStage> = {
  MODEL_NUMBER_MISSING: 'IDENTIFY',
  NO_SELL_MARKET: 'MATCH',
  MARKET_DATA_MISSING: 'MATCH',
  PRODUCT_MATCH_FAILED: 'MATCH',
  FEE_UNVERIFIED: 'COST',
  SHIPPING_UNKNOWN: 'COST',
  INSUFFICIENT_MARGIN: 'DECISION',
  LOW_DATA_CONFIDENCE: 'DECISION',
};

export type DropoutRow = {
  listingKey: string;
  productName: string | null;
  category: string | null;
  identityKey: string | null;
  reason: DropoutReason;
  reasonJa: string;
  stage: DropoutStage;
  /** その1件についての具体的な事情。一般論ではなく、この商品の話を書く。 */
  detailJa: string;
};

export type DropoutSummary = {
  /** 実市場の出品のうち、使えるRouteまで届かなかった件数 */
  droppedCount: number;
  /** 使えるRouteまで届いた件数 */
  survivedCount: number;
  total: number;
  rows: DropoutRow[];
  byReason: {
    reason: DropoutReason; ja: string; count: number; share: number;
    whyJa: string; nextJa: string;
  }[];
  byStage: { stage: DropoutStage; ja: string; count: number; share: number }[];
  /** いちばん多い理由。ここが次に直す場所。 */
  topReasonJa: string;
  verdictJa: string;
};

/** 送料が「分かっている」と言える条件。0円で埋めないための判定。 */
function shippingKnown(r: Record<string, unknown>): boolean {
  const size = r.package_size === null || r.package_size === undefined ? '' : String(r.package_size);
  const method = r.shipping_method === null || r.shipping_method === undefined ? '' : String(r.shipping_method);
  const est = r.estimated_shipping_cost;
  if (est !== null && est !== undefined) return true;
  if (size !== '' && size !== 'UNKNOWN') return true;
  if (method !== '' && method !== 'UNKNOWN') return true;
  return false;
}

/**
 * 実市場の出品を1件ずつ見て、落ちた理由を1つに決める。
 *
 * 【順番が意味を持つ】
 * 上から順に見て、最初に当たったものをその商品の理由にする。
 * 型番が無い商品は「相場も無い」「送料も不明」でもあるが、
 * 直す順番は必ず「まず型番」なので、根っこに近いものから並べてある。
 */
export async function dropoutSummary(): Promise<DropoutSummary> {
  const listings = await all(
    `SELECT listing_key, product_name, category, identity_key, identifiable, venue_code,
            package_size, shipping_method, estimated_shipping_cost
       FROM tracked_listings WHERE real_market_data = 1`,
  );

  // 売る先として使える市場（構造として売れる、という意味。規約の可否は別欄）
  const sellVenues = await all(`SELECT code FROM venues WHERE can_sell = 1`);
  const sellCodes = new Set(sellVenues.map((v) => String(v.code)));

  // 相場のある市場（identity_key ごと）
  const priced = await all('SELECT DISTINCT identity_key, venue_code FROM venue_market_prices');
  const venuesOf = new Map<string, Set<string>>();
  for (const p of priced) {
    const k = String(p.identity_key);
    if (!venuesOf.has(k)) venuesOf.set(k, new Set());
    venuesOf.get(k)!.add(String(p.venue_code));
  }

  // 人が確認した同一商品判定の結果
  const reviews = await all('SELECT listing_key, verdict FROM identity_match_reviews');
  const badMatch = new Set(
    reviews.filter((r) => String(r.verdict) !== 'CORRECT_MATCH').map((r) => String(r.listing_key)),
  );

  // Routeの結果（identity_key ごと）。使えるRouteが1本でもあれば「生き残った」。
  const routes = await all(`
    SELECT p.identity_key AS k, r.status, r.decision, r.skip_reason, r.data_confidence, r.fees_estimated
      FROM arbitrage_routes r
      JOIN supplier_products sp ON sp.id = r.supplier_product_id
      JOIN products p ON p.id = sp.product_id
     WHERE p.identity_key IS NOT NULL`);
  const routesOf = new Map<string, typeof routes>();
  for (const r of routes) {
    const k = String(r.k);
    if (!routesOf.has(k)) routesOf.set(k, []);
    routesOf.get(k)!.push(r);
  }

  // 販売側の手数料が確定しているか（市場ごと）
  const fees = await all(`SELECT * FROM venue_fee_profiles WHERE side = 'SELL'`);
  const feeOk = new Set(
    fees.filter((f) => deriveFeeStatus(f).status === 'VERIFIED').map((f) => String(f.venue_code)),
  );

  const rows: DropoutRow[] = [];
  let survived = 0;

  for (const l of listings) {
    const key = String(l.listing_key);
    const idKey = l.identity_key === null || l.identity_key === undefined ? '' : String(l.identity_key);
    const name = l.product_name === null ? null : String(l.product_name);
    const cat = l.category === null ? null : String(l.category);

    const push = (reason: DropoutReason, detailJa: string) => {
      rows.push({
        listingKey: key, productName: name, category: cat,
        identityKey: idKey || null, reason, reasonJa: DROPOUT_REASONS[reason].ja,
        stage: STAGE_OF[reason], detailJa,
      });
    };

    // ① 商品そのものを特定できない
    if (Number(l.identifiable) !== 1 || idKey === '') {
      push('MODEL_NUMBER_MISSING', '型番もJANも無いため、他市場の同じ商品を探しに行けません。');
      continue;
    }

    // ② そもそも売る先が無い
    const otherSell = [...sellCodes].filter((c) => c !== String(l.venue_code));
    if (otherSell.length === 0) {
      push('NO_SELL_MARKET', '仕入れた商品を売る市場が1つも登録されていません。');
      continue;
    }

    // ③ 人が確認して「違う商品だった」
    if (badMatch.has(key)) {
      push('PRODUCT_MATCH_FAILED', '人が確認したところ、同じ商品ではありませんでした（または判断が付きませんでした）。');
      continue;
    }

    // ④ 比べる相手の相場が無い
    const vs = venuesOf.get(idKey);
    const comparable = vs ? [...vs].filter((v) => v !== String(l.venue_code)) : [];
    if (comparable.length === 0) {
      push('MARKET_DATA_MISSING', '他の市場に、この商品の相場が1件も登録されていません。');
      continue;
    }

    // ⑤ 販売側の手数料が未確定
    const feeVerified = comparable.some((v) => feeOk.has(v));
    if (!feeVerified) {
      push('FEE_UNVERIFIED',
        `比べられる市場（${comparable.join('・')}）の販売手数料が公式確認済みになっていません。`);
      continue;
    }

    // ⑥ 送料が不明（0円として計算しない）
    if (!shippingKnown(l)) {
      push('SHIPPING_UNKNOWN', '荷物サイズも発送方法も見込み送料も空欄のため、送料を確定できません。');
      continue;
    }

    // ⑦⑧ Routeまで進んだ場合、その結果を見る
    const rs = routesOf.get(idKey) ?? [];
    const usable = rs.filter((r) => String(r.status) === 'OK' && String(r.decision) !== 'SKIP');
    if (usable.length > 0) {
      survived++;
      continue;
    }
    if (rs.length === 0) {
      // 材料はそろっているのにRouteが1本も作られていない＝商品マスタと結びついていない。
      push('LOW_DATA_CONFIDENCE',
        '材料はそろっていますが、この出品がまだ商品マスタと結びついていないため計算していません。');
      continue;
    }

    const marginReasons = new Set(['NEGATIVE_PROFIT', 'LOW_PROFIT', 'LOW_ROI', 'MARKET_PRICE_TOO_LOW']);
    const skips = rs.map((r) => String(r.skip_reason ?? ''));
    if (skips.some((s) => marginReasons.has(s))) {
      push('INSUFFICIENT_MARGIN',
        '費用を全部引くと、基準の利益に届きませんでした。判定は甘くしません。');
      continue;
    }
    push('LOW_DATA_CONFIDENCE',
      `計算はできましたが判定で落ちました（理由：${skips.filter(Boolean).join('・') || '基準未達'}）。`);
  }

  const droppedCount = rows.length;
  const total = listings.length;

  const byReason = (Object.keys(DROPOUT_REASONS) as DropoutReason[])
    .map((reason) => {
      const count = rows.filter((r) => r.reason === reason).length;
      return {
        reason, ja: DROPOUT_REASONS[reason].ja, count,
        share: droppedCount > 0 ? count / droppedCount : 0,
        whyJa: DROPOUT_REASONS[reason].why,
        nextJa: DROPOUT_REASONS[reason].next,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const stages: DropoutStage[] = ['IDENTIFY', 'MATCH', 'COST', 'DECISION'];
  const byStage = stages
    .map((stage) => {
      const count = rows.filter((r) => r.stage === stage).length;
      return { stage, ja: DROPOUT_STAGE_JA[stage], count, share: droppedCount > 0 ? count / droppedCount : 0 };
    })
    .filter((s) => s.count > 0);

  const top = byReason[0];
  return {
    droppedCount, survivedCount: survived, total, rows, byReason, byStage,
    topReasonJa: top
      ? `いちばん多い脱落理由は「${top.ja}」で ${top.count}件（落ちた分の${Math.round(top.share * 100)}%）。${top.nextJa}`
      : total === 0
        ? '実市場の出品がまだ無いため、脱落理由を数えられません。'
        : '落ちた出品はありません。',
    verdictJa: total === 0
      ? '実市場の出品がまだ1件もありません。'
      : `${total}件のうち ${survived}件が使えるRouteまで届き、${droppedCount}件が途中で落ちました。`,
  };
}
