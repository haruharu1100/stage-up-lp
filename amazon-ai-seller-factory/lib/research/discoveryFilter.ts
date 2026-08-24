import { bool, num } from '../env';
import type { SupplierListing } from '../types';
import { discoveryModePlan, type DiscoveryMode } from '../providers/supplierDiscovery';

/**
 * 自動探索の「一次除外」。
 *
 * ★ここは AI を1回も使わない。Keepaも呼ばない。ただのルールと計算だけ。
 *   目的は「高いAPIへ送る前に、明らかにダメな候補を無料で落とす」こと。
 *   ユーザー指示：
 *     「Supplier商品500件すべてにKeepaを使わない。まず安価な判定で減らして、
 *       Amazon照合可能性が高い商品だけKeepaへ送ってください。」
 */

/** 絞り込みのどの段で落ちたか */
export type DiscoveryStage =
  | 'SEED' // ★Amazon→仕入先の「種」選び（既に売れているとKeepaで分かっている商品だけに絞る段）
  | 'DISCOVERED' // 仕入先から取得した
  | 'PREFILTER' // 基本条件（無料ルール）
  | 'SELECT' // Amazon照合へ送る分の絞り込み（上限管理）
  | 'AMAZON_SEARCH' // Amazon候補を探した
  | 'MATCH' // 高確率一致
  | 'SALES' // 推定月販
  | 'PROFIT' // 利益条件
  | 'GRADE_A'; // Aランク

export const DISCOVERY_STAGE_LABEL: Record<DiscoveryStage, string> = {
  SEED: 'Amazon側で「売れている」と確認できた（仕入先を探す種）',
  DISCOVERED: '本日仕入先から取得',
  PREFILTER: '基本条件突破',
  SELECT: 'Amazon照合の対象に選ばれた',
  AMAZON_SEARCH: 'Amazon候補あり',
  MATCH: '高確率一致',
  SALES: '月販条件クリア',
  PROFIT: '利益条件突破',
  GRADE_A: 'Aランク',
};

/** なぜ落ちたか（今後の改善分析に使う） */
export type DiscoveryRejectReason =
  | 'NO_PRODUCT_URL'
  | 'NO_IMAGE'
  | 'UNKNOWN_COST'
  | 'PRICE_OUT_OF_RANGE'
  | 'MOCK_DATA'
  | 'DUPLICATE'
  | 'HIGH_IP_RISK'
  | 'REGULATION_RISK'
  | 'FORBIDDEN_SOURCE'
  | 'OVER_API_BUDGET'
  | 'NO_AMAZON_MATCH'
  | 'LOW_MATCH_SCORE'
  | 'LOW_SALES'
  | 'NO_PROFIT'
  | 'HIGH_COMPETITION'
  | 'DATA_ANOMALY'
  // --- Amazon→仕入先の「種」選びで使う理由（★「その他」に丸めない）---
  | 'NO_SALES_DATA' // Keepaの月販がまだ取れていない（推測しない）
  | 'PRICE_UNSTABLE' // 価格の上下が激しく、利益計算が当てにならない
  | 'NO_SEED_KEY' // 商品名も型番もJANも無く、仕入先を探す手がかりが無い
  | 'OTHER';

export const REJECT_REASON_LABEL: Record<DiscoveryRejectReason, string> = {
  NO_PRODUCT_URL: '商品URLが無い（どこで買えるか分からない）',
  NO_IMAGE: '商品画像が無い（同一商品か確認できない）',
  UNKNOWN_COST: '仕入価格が取れていない',
  PRICE_OUT_OF_RANGE: '指定した仕入価格の範囲から外れている',
  MOCK_DATA: 'サンプルデータ（実在しない商品）',
  DUPLICATE: '同じ商品を既に見ている',
  HIGH_IP_RISK: '知的財産（キャラクター・ブランド）のリスクが高い',
  REGULATION_RISK: '法令・認証（電波法・PSE・食品・化粧品など）の確認が必要',
  FORBIDDEN_SOURCE: '仕入先として認められない（Amazon内の他出品者など）',
  OVER_API_BUDGET: '今回のAPI上限に達したため、次回に回した',
  NO_AMAZON_MATCH: 'Amazonに同じ商品が見つからない',
  LOW_MATCH_SCORE: '同一商品と言い切れる一致度に届かなかった',
  LOW_SALES: '推定月販が基準に届かない',
  NO_PROFIT: '利益・利益率・ROIのどれかが基準に届かない',
  HIGH_COMPETITION: '出品者が多すぎる／Amazon本体が販売中',
  DATA_ANOMALY: '明らかにおかしいデータとして隔離した',
  NO_SALES_DATA: 'Amazonでの売れ行き（推定月販）がまだ取れていない',
  PRICE_UNSTABLE: 'Amazon価格の上下が激しく、利益計算が当てにならない',
  NO_SEED_KEY: '商品名・型番・JANのどれも無く、仕入先を探す手がかりが無い',
  OTHER: 'その他',
};

/**
 * 知財リスクの高い語。
 * ★これに触れる商品は無料の段階で落とす（Keepaを使う価値が無い）。
 *   除外理由は必ず HIGH_IP_RISK として保存する。
 */
const IP_RISK_WORDS = [
  'ディズニー', 'disney', 'ミッキー', 'プーさん',
  'ポケモン', 'pokemon', 'ピカチュウ', '任天堂', 'nintendo', 'マリオ', 'ゼルダ',
  'サンリオ', 'sanrio', 'キティ', 'kitty', 'マイメロ', 'クロミ', 'シナモロール',
  'ジブリ', 'トトロ', 'ちいかわ', 'すみっコ', 'すみっこ',
  '鬼滅', 'ワンピース ルフィ', 'ドラゴンボール', 'ナルト', 'naruto', '呪術廻戦',
  'マーベル', 'marvel', 'スパイダーマン', 'スターウォーズ', 'star wars',
  'ハリーポッター', 'harry potter', 'バービー', 'barbie', 'レゴ', 'lego',
  'nike', 'ナイキ', 'adidas', 'アディダス', 'supreme', 'シュプリーム',
  'louis vuitton', 'ルイヴィトン', 'gucci', 'グッチ', 'chanel', 'シャネル',
  'rolex', 'ロレックス', 'apple', 'アップル', 'iphone', 'airpods', 'ipad',
  'bts', 'k-pop公式', 'ゲーミング 純正',
];

/**
 * 法令・認証の確認が要る語。
 * ★「絶対に売れない」ではなく「無料の段階では回さない」。
 *   DISCOVERY_BLOCK_REGULATION=false にすれば通せる。
 */
const REGULATION_WORDS = [
  '食品', 'サプリ', 'supplement', 'お菓子', '飲料', 'コーヒー豆', '健康食品',
  '化粧品', 'コスメ', 'cosmetic', '美容液', '日焼け止め', 'シャンプー', '石鹸',
  '医薬', '医療', 'マスク', '体温計', '血圧計', 'コンタクト',
  'リチウム', 'lithium', 'モバイルバッテリー', '充電器', 'acアダプタ', 'usb充電',
  'bluetooth', 'ブルートゥース', 'wi-fi', 'wifi', '無線', 'トランシーバー',
  'レーザー', 'laser', 'led電球', '電気毛布', 'ヒーター',
  'ベビー', '哺乳', 'チャイルドシート', 'ヘルメット',
];

const FORBIDDEN_SUPPLIER_WORDS = ['amazon', 'アマゾン', 'マケプレ', 'marketplace'];

export interface PrefilterResult {
  /** 次の段（Amazon照合）へ送る候補 */
  passed: SupplierListing[];
  /** 落とした候補と理由 */
  rejected: { listing: SupplierListing; reason: DiscoveryRejectReason; note: string }[];
}

export interface PrefilterOptions {
  mode: DiscoveryMode;
  minPriceJpy?: number | null;
  maxPriceJpy?: number | null;
  /** すでに見たことのある externalId（重複を弾く） */
  seen?: Set<string>;
}

/** 無料ルールだけで一次除外する */
export function prefilterDiscovered(listings: SupplierListing[], opts: PrefilterOptions): PrefilterResult {
  const plan = discoveryModePlan(opts.mode);
  const blockRegulation = bool('DISCOVERY_BLOCK_REGULATION', true);
  const blockIp = bool('DISCOVERY_BLOCK_IP_RISK', true);
  const maxPrice = opts.maxPriceJpy ?? plan.maxPriceJpy ?? null;
  const minPrice = opts.minPriceJpy ?? null;
  const seen = opts.seen ?? new Set<string>();

  const passed: SupplierListing[] = [];
  const rejected: PrefilterResult['rejected'] = [];
  const reject = (listing: SupplierListing, reason: DiscoveryRejectReason, note: string) =>
    rejected.push({ listing, reason, note });

  for (const l of listings) {
    const hay = `${l.title} ${l.brand ?? ''} ${l.supplier}`.toLowerCase();

    if (seen.has(l.externalId)) {
      reject(l, 'DUPLICATE', 'この商品は今回すでに見ています');
      continue;
    }
    seen.add(l.externalId);

    if (l.dataQuality === 'MOCK') {
      reject(l, 'MOCK_DATA', 'サンプル（練習用）のため本番の判定に混ぜません');
      continue;
    }
    if (FORBIDDEN_SUPPLIER_WORDS.some((w) => hay.includes(w))) {
      reject(l, 'FORBIDDEN_SOURCE', 'Amazon内の他出品者からの仕入れはドロップシッピングポリシー違反です');
      continue;
    }
    if (!l.url) {
      reject(l, 'NO_PRODUCT_URL', '実際にどこで買えるか分からない商品は候補にしません');
      continue;
    }
    if (!(l.unitPriceJpy > 0)) {
      reject(l, 'UNKNOWN_COST', '仕入価格が取れていないので利益計算ができません');
      continue;
    }
    if (minPrice !== null && l.unitPriceJpy < minPrice) {
      reject(l, 'PRICE_OUT_OF_RANGE', `仕入${l.unitPriceJpy.toLocaleString()}円は下限${minPrice.toLocaleString()}円未満です`);
      continue;
    }
    if (maxPrice !== null && l.unitPriceJpy > maxPrice) {
      reject(l, 'PRICE_OUT_OF_RANGE', `仕入${l.unitPriceJpy.toLocaleString()}円は上限${maxPrice.toLocaleString()}円を超えています`);
      continue;
    }
    if ((l.imageUrls?.length ?? 0) === 0) {
      reject(l, 'NO_IMAGE', '画像が無いと同一商品かを確認できません（誤一致を防ぐため外します）');
      continue;
    }
    if (blockIp) {
      const hit = IP_RISK_WORDS.find((w) => hay.includes(w));
      if (hit) {
        reject(l, 'HIGH_IP_RISK', `「${hit}」を含むため知的財産のリスクが高い商品です`);
        continue;
      }
    }
    if (blockRegulation) {
      const hit = REGULATION_WORDS.find((w) => hay.includes(w));
      if (hit) {
        reject(l, 'REGULATION_RISK', `「${hit}」を含むため法令・認証の確認が必要です（無料の段階では回しません）`);
        continue;
      }
    }
    passed.push(l);
  }

  return { passed, rejected };
}

/**
 * 「Amazonで同じ商品を見つけられそうか」の見込み点（0〜100）。
 *
 * ★AI不使用・API不使用。ここで高い順に並べ替えて、上位だけKeepaへ送る。
 *   JANが取れている商品は突合が確実なので最優先。
 */
export function amazonMatchLikelihood(l: SupplierListing): number {
  let s = 0;
  if (l.gtin && /^\d{8,14}$/.test(String(l.gtin))) s += 45; // JAN/EANは一撃で当たる
  if (l.modelNumber && String(l.modelNumber).length >= 4) s += 20;
  if (l.brand) s += 10;
  if ((l.imageUrls?.length ?? 0) > 0) s += 10;

  // 商品名が「特徴のある語」を持っているか（記号だらけ・短すぎるものは当たらない）
  const words = String(l.title).split(/[\s　,、･・/【】\[\]（）()]+/).filter((w) => w.length >= 2);
  if (words.length >= 3) s += 10;
  else if (words.length === 2) s += 5;

  // 仕入が安いほど利益の余地があるので、同点なら安い方を先に見る
  if (l.unitPriceJpy > 0 && l.unitPriceJpy <= 500) s += 5;

  return Math.min(100, s);
}

/**
 * Keepaへ送る件数を絞る。
 * ★ここが「500件全部にKeepaを使わない」の実装本体。
 */
export function selectForAmazonCheck(
  listings: SupplierListing[],
  maxChecks: number,
): { selected: SupplierListing[]; deferred: SupplierListing[] } {
  const ranked = [...listings]
    .map((l) => ({ l, k: amazonMatchLikelihood(l) }))
    .sort((a, b) => (b.k - a.k) || a.l.unitPriceJpy - b.l.unitPriceJpy);
  const cap = Math.max(0, maxChecks);
  return {
    selected: ranked.slice(0, cap).map((x) => x.l),
    deferred: ranked.slice(cap).map((x) => x.l),
  };
}

/** 1回の探索で使ってよい上限（無限探索の禁止） */
export function discoveryLimits() {
  return {
    /** 仕入先から取得する上限 */
    maxDiscoveryItems: Math.max(1, num('MAX_DISCOVERY_ITEMS', 100)),
    /** 横展開の深さ上限 */
    maxDiscoveryDepth: Math.max(0, num('MAX_DISCOVERY_DEPTH', 1)),
    /** Amazon照合（＝Keepa）へ送る上限 */
    maxAmazonChecks: Math.max(1, num('MAX_AMAZON_CHECKS', 20)),
    /** 1件の有望候補から広げる上限 */
    maxExpandPerSeed: Math.max(0, num('MAX_EXPAND_PER_SEED', 10)),
    /** ★Amazon→仕入先で使う「種」の上限（1回の実行で何商品ぶん仕入先を探すか） */
    maxSeeds: Math.max(1, num('MAX_REVERSE_SEEDS', 20)),
    /** 画像検索を使うか（有料APIを無駄打ちしないための栓） */
    useImageSearch: bool('DISCOVERY_USE_IMAGE_SEARCH', true),
  };
}
