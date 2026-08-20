import { all } from './db/client';

/**
 * 検証ファネル（Phase 3.7）。
 *
 * 【なぜ「100件」を最重要にしないのか】
 * ユーザー指摘：「100件」という数字だけを追わない方がいい。
 *
 *   100件登録 → 80件で商品一致 → 60件でRoute成立 → 30件がSTRONG BUY候補
 *   → 7/30/90日後に答え合わせ
 *
 * 100件入力しても、他市場と同じ商品だと確かめられなければ利益計算はできない。
 * つまり「100件登録した」は成果ではなく、ただの入口。
 * 入口の数字だけを追うと、比べられない一点物ばかり100件集めて満足する、という失敗が起きる。
 *
 * 【この表は落ちる場所を見つけるためにある】
 * どの段で減ったかで、次に直すべき場所が決まる。
 *  ・商品一致で落ちる → 型番・JANが取れていない。入力項目か対象カテゴリの問題。
 *  ・Route成立で落ちる → 他市場の相場が登録されていない。相場データの問題。
 *  ・STRONG BUYで落ちる → 判定が厳しいのではなく、費用や信頼度が確定していない可能性が高い。
 *    **ここで閾値を下げて数を増やしてはいけない**（CLAUDE.md ルール13）。
 *
 * 【0件のとき「100%」と書かない】
 * 分母が0なら割合は null。「まだ測れません」と出す（CLAUDE.md ルール35）。
 */

export type FunnelStage = {
  code: string;
  ja: string;
  count: number;
  /** 入口（観測した出品）に対する割合。分母0なら null。 */
  rateFromTop: number | null;
  /** 一つ前の段からの通過率。分母0なら null。 */
  rateFromPrev: number | null;
  /** ここで落ちた件数。 */
  lost: number;
  /** 落ちた理由の説明（人間向け）。 */
  lostReasonJa: string;
};

export type ValidationFunnel = {
  /** ①観測した出品。ここが「100件」と呼んでいた数字。 */
  observedListings: number;
  /** ②他市場と同じ商品だと確かめられたもの。 */
  matchableProducts: number;
  /** ③Routeを作れたもの。 */
  routeGeneratedProducts: number;
  /** ④SHADOW（答え合わせ）の対象になったもの。 */
  shadowEligibleProducts: number;
  /** ⑤そのうちSTRONG BUY候補。 */
  strongBuyCandidates: number;

  matchableRate: number | null;
  routeGenerationRate: number | null;
  shadowEligibleRate: number | null;

  stages: FunnelStage[];
  /** カテゴリの偏り。1種類に寄っていないか。 */
  byCategory: { category: string; count: number; share: number }[];
  /** いちばん多いカテゴリの割合。0.5を超えたら偏りすぎ。 */
  topCategoryShare: number | null;
  /** 一言。測れないときは「測れない」と言う。 */
  verdictJa: string;
  /** 次に直すべき場所。 */
  bottleneckJa: string;
};

function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

export async function validationFunnel(): Promise<ValidationFunnel> {
  // ① 観測した出品（実市場データだけ。テストデータ・記入見本は入らない）
  const listings = await all(
    `SELECT listing_key, identity_key, venue_code, category
       FROM tracked_listings WHERE real_market_data = 1`,
  );
  const observedListings = listings.length;

  /*
   * ② 他市場と同じ商品だと確かめられたもの。
   *
   * 「商品を特定できる情報がある（identifiable）」だけでは足りない。
   * 型番が書いてあっても、比べる相手の市場に同じ商品の相場が無ければ、利益は計算できない。
   * だから「別の市場に同じ identity_key の相場がある」ことまで確かめる。
   * ここを甘くすると、次の段の数字が実力より良く見えてしまう。
   */
  const priced = await all('SELECT DISTINCT identity_key, venue_code FROM venue_market_prices');
  const venuesOf = new Map<string, Set<string>>();
  for (const p of priced) {
    const k = String(p.identity_key);
    if (!venuesOf.has(k)) venuesOf.set(k, new Set());
    venuesOf.get(k)!.add(String(p.venue_code));
  }

  const matchedKeys = new Set<string>();
  for (const l of listings) {
    const k = l.identity_key === null || l.identity_key === undefined ? '' : String(l.identity_key);
    if (k === '') continue;
    const vs = venuesOf.get(k);
    if (!vs) continue;
    // 自分が見た市場以外にも相場がある＝比べられる。
    if ([...vs].some((v) => v !== String(l.venue_code))) matchedKeys.add(k);
  }
  const matchableProducts = matchedKeys.size;

  // ③ Routeを作れたもの
  const routed = await all(`
    SELECT DISTINCT p.identity_key AS k
      FROM arbitrage_routes r
      JOIN supplier_products sp ON sp.id = r.supplier_product_id
      JOIN products p ON p.id = sp.product_id
     WHERE p.identity_key IS NOT NULL`);
  const routedKeys = new Set(routed.map((r) => String(r.k)));
  const routeGeneratedProducts = [...matchedKeys].filter((k) => routedKeys.has(k)).length;

  // ④ SHADOW（答え合わせ）の対象になったもの
  const shadowed = await all(`
    SELECT DISTINCT p.identity_key AS k
      FROM route_shadow_trades t
      JOIN supplier_products sp ON sp.id = t.supplier_product_id
      JOIN products p ON p.id = sp.product_id
     WHERE p.identity_key IS NOT NULL`);
  const shadowKeys = new Set(shadowed.map((r) => String(r.k)));
  const shadowEligibleProducts = [...matchedKeys].filter((k) => shadowKeys.has(k)).length;

  // ⑤ STRONG BUY候補
  const strong = await all(`
    SELECT DISTINCT p.identity_key AS k
      FROM arbitrage_routes r
      JOIN supplier_products sp ON sp.id = r.supplier_product_id
      JOIN products p ON p.id = sp.product_id
     WHERE r.decision = 'STRONG_BUY' AND r.status = 'OK' AND p.identity_key IS NOT NULL`);
  const strongKeys = new Set(strong.map((r) => String(r.k)));
  const strongBuyCandidates = [...matchedKeys].filter((k) => strongKeys.has(k)).length;

  const stages: FunnelStage[] = [
    {
      code: 'OBSERVED_LISTINGS', ja: '観測した出品',
      count: observedListings, rateFromTop: rate(observedListings, observedListings),
      rateFromPrev: null, lost: 0,
      lostReasonJa: 'ここが入口。人が公開画面を見て書き写した件数。',
    },
    {
      code: 'MATCHABLE_PRODUCTS', ja: '他市場と同じ商品だと確かめられた',
      count: matchableProducts, rateFromTop: rate(matchableProducts, observedListings),
      rateFromPrev: rate(matchableProducts, observedListings),
      lost: observedListings - matchableProducts,
      lostReasonJa: '型番やJANが無い、または比べる相手の市場に同じ商品の相場が無い。',
    },
    {
      code: 'ROUTE_GENERATED_PRODUCTS', ja: 'Routeを作れた',
      count: routeGeneratedProducts, rateFromTop: rate(routeGeneratedProducts, observedListings),
      rateFromPrev: rate(routeGeneratedProducts, matchableProducts),
      lost: matchableProducts - routeGeneratedProducts,
      lostReasonJa: '商品マスタと結びついていない、または費用が確定せず計算まで進めなかった。',
    },
    {
      code: 'SHADOW_ELIGIBLE_PRODUCTS', ja: '答え合わせ（SHADOW）の対象になった',
      count: shadowEligibleProducts, rateFromTop: rate(shadowEligibleProducts, observedListings),
      rateFromPrev: rate(shadowEligibleProducts, routeGeneratedProducts),
      lost: routeGeneratedProducts - shadowEligibleProducts,
      lostReasonJa: '利益が出る見込みが立たず、記録して答え合わせする対象にならなかった。',
    },
    {
      code: 'STRONG_BUY_CANDIDATES', ja: 'STRONG BUY候補',
      count: strongBuyCandidates, rateFromTop: rate(strongBuyCandidates, observedListings),
      rateFromPrev: rate(strongBuyCandidates, routeGeneratedProducts),
      lost: routeGeneratedProducts - strongBuyCandidates,
      lostReasonJa:
        '費用や同一商品の確からしさが足りず、最上位の判定まで届かなかった。'
        + 'ここを増やすために判定を甘くしてはいけない。手数料の実額確認と仕入先を増やす方で増やす。',
    },
  ];

  // カテゴリの偏り（ユーザー指示：カテゴリも1種類だけに偏らせない）
  const catCount = new Map<string, number>();
  for (const l of listings) {
    const c = l.category === null || l.category === undefined || String(l.category) === ''
      ? '（未記入）' : String(l.category);
    catCount.set(c, (catCount.get(c) ?? 0) + 1);
  }
  const byCategory = [...catCount.entries()]
    .map(([category, count]) => ({ category, count, share: observedListings > 0 ? count / observedListings : 0 }))
    .sort((a, b) => b.count - a.count);
  const topCategoryShare = byCategory.length > 0 && observedListings > 0 ? byCategory[0].share : null;

  const verdictJa = observedListings === 0
    ? '実市場の出品がまだ1件もありません。ファネルは測れません。'
    : `観測 ${observedListings}件 → 商品一致 ${matchableProducts}件 → Route成立 ${routeGeneratedProducts}件`
      + ` → 答え合わせ対象 ${shadowEligibleProducts}件 → STRONG BUY候補 ${strongBuyCandidates}件。`;

  // どこで一番落ちているか。数だけでなく「次に何を直すか」を出す。
  let bottleneckJa = '実市場の出品がまだ無いため、詰まっている場所を特定できません。';
  if (observedListings > 0) {
    const drops = stages.slice(1).map((s) => ({ s, lost: Math.max(0, s.lost) }));
    const worst = drops.sort((a, b) => b.lost - a.lost)[0];
    bottleneckJa = worst.lost === 0
      ? 'どの段でも大きく落ちていません。件数を増やして様子を見てください。'
      : `いちばん落ちているのは「${worst.s.ja}」の手前で ${worst.lost}件です。理由：${worst.s.lostReasonJa}`;
  }

  return {
    observedListings, matchableProducts, routeGeneratedProducts,
    shadowEligibleProducts, strongBuyCandidates,
    matchableRate: rate(matchableProducts, observedListings),
    routeGenerationRate: rate(routeGeneratedProducts, observedListings),
    shadowEligibleRate: rate(shadowEligibleProducts, observedListings),
    stages, byCategory, topCategoryShare, verdictJa, bottleneckJa,
  };
}
