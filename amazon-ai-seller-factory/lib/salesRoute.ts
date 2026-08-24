import { config } from './env';
import type { MarketSnapshot, ProductCore, SalesRoute } from './types';

/**
 * 販売ルート判定。
 *
 * ★絶対ルール（事業Vault/Amazon AI Seller OS/05）
 *   既にAmazonに存在する商品で新規ASINを作るのは「重複出品」違反。
 *   したがって「Amazonに既にある = 相乗り一択」を機械的に固定する。
 *   新規ページを作れるのは
 *     ① Amazonにまだ無い商品
 *     ② 商標を持つ自社ブランド（OEM）
 *   の2つだけ。
 */

export interface RouteDecision {
  route: SalesRoute;
  reason: string;
  /** 新規ページを作ってよいか（false なら lister は必ず相乗りにする） */
  canCreateNewListing: boolean;
  /** 相乗り先のASIN */
  existingAsin: string | null;
}

export function isOwnBrand(product: ProductCore): boolean {
  const brands = config.ownBrands;
  if (!brands.length) return false;
  const b = (product.brand || '').trim().toLowerCase();
  const t = (product.title || '').toLowerCase();
  return brands.some((own) => {
    const o = own.toLowerCase();
    return (b && b === o) || (o.length >= 2 && t.includes(o));
  });
}

export function decideRoute(product: ProductCore, market?: MarketSnapshot | null): RouteDecision {
  const asin = (product.asin || '').trim() || null;

  // ① 自社OEM（商標登録済みブランド）→ 新規ページを堂々と作れる
  if (isOwnBrand(product)) {
    return {
      route: 'oem',
      reason: `自社ブランド「${product.brand || config.ownBrands[0]}」の商品です。ブランド登録済みのため新規ページを作成します`,
      canCreateNewListing: true,
      existingAsin: null,
    };
  }

  // ② Amazonに既にある → 相乗り一択（新規ページは重複出品違反）
  if (asin) {
    const sellers = market?.sellerCount ?? null;
    return {
      route: 'piggyback',
      reason:
        `Amazonに既に商品ページ（${asin}）があります。同じ商品で新しいページを作るのは重複出品違反になるため、既存ページに相乗りします` +
        (sellers != null ? `（現在の出品者数：${sellers}）` : ''),
      canCreateNewListing: false,
      existingAsin: asin,
    };
  }

  // ③ Amazonにまだ無い → 新規ページ作成が本命
  return {
    route: 'new_listing',
    reason:
      'Amazonにこの商品のページがありません。新規ページを作成できます（先に1個仕入れて自分で商品写真を撮ってください）',
    canCreateNewListing: true,
    existingAsin: null,
  };
}

/** 相乗りが現実的かどうか（カートを取れる見込み） */
export function piggybackDifficulty(market?: MarketSnapshot | null): {
  level: 'easy' | 'normal' | 'hard' | 'avoid';
  reason: string;
} {
  const sellers = market?.sellerCount ?? market?.offerCount ?? 0;
  if (market?.isAmazonSelling && config.avoidAmazonSelling) {
    return { level: 'avoid', reason: 'Amazon本体が販売しています。カートをほぼ取れないため相乗りは避けます' };
  }
  if (sellers <= 2) return { level: 'easy', reason: `出品者${sellers}人。カートを取りやすい状態です` };
  if (sellers <= config.maxSellerCount) return { level: 'normal', reason: `出品者${sellers}人。価格次第でカートを取れます` };
  return { level: 'hard', reason: `出品者${sellers}人。値下げ競争になりやすく利益が残りません` };
}
