import type { FulfillmentMode, MarketSnapshot, ProductCore, ProfitResult } from './types';
import { config } from './env';

/**
 * 利益計算（Amazon.co.jp / FBA 前提）。
 * ★ここの手数料は「概算」。料金改定があるため、実際の判断前に必ず
 *   セラーセントラルの最新料金表で確認すること（assumptions に毎回明記する）。
 */

type SizeTier = {
  name: string;
  maxSumCm: number;
  maxWeightG: number;
  feeJpy: number;
  storagePer1000cm3: number;
};

const SMALL: SizeTier = { name: '小型区分', maxSumCm: 45, maxWeightG: 250, feeJpy: 288, storagePer1000cm3: 5.16 };

const STANDARD: SizeTier[] = [
  { name: '標準区分1', maxSumCm: 68, maxWeightG: 1000, feeJpy: 318, storagePer1000cm3: 5.16 },
  { name: '標準区分2', maxSumCm: 80, maxWeightG: 2000, feeJpy: 434, storagePer1000cm3: 5.16 },
  { name: '標準区分3', maxSumCm: 100, maxWeightG: 5000, feeJpy: 514, storagePer1000cm3: 5.16 },
  { name: '標準区分4', maxSumCm: 120, maxWeightG: 9000, feeJpy: 603, storagePer1000cm3: 5.16 },
  { name: '標準区分5', maxSumCm: 140, maxWeightG: 40000, feeJpy: 707, storagePer1000cm3: 5.16 },
];

const LARGE: SizeTier[] = [
  { name: '大型区分1', maxSumCm: 60, maxWeightG: 2000, feeJpy: 589, storagePer1000cm3: 4.37 },
  { name: '大型区分2', maxSumCm: 80, maxWeightG: 5000, feeJpy: 712, storagePer1000cm3: 4.37 },
  { name: '大型区分3', maxSumCm: 100, maxWeightG: 10000, feeJpy: 815, storagePer1000cm3: 4.37 },
  { name: '大型区分4', maxSumCm: 120, maxWeightG: 15000, feeJpy: 975, storagePer1000cm3: 4.37 },
  { name: '大型区分5', maxSumCm: 140, maxWeightG: 20000, feeJpy: 1020, storagePer1000cm3: 4.37 },
  { name: '大型区分6', maxSumCm: 160, maxWeightG: 25000, feeJpy: 1100, storagePer1000cm3: 4.37 },
  { name: '大型区分7', maxSumCm: 180, maxWeightG: 30000, feeJpy: 1532, storagePer1000cm3: 4.37 },
  { name: '大型区分8', maxSumCm: 200, maxWeightG: 40000, feeJpy: 1566, storagePer1000cm3: 4.37 },
  { name: '大型区分9', maxSumCm: 220, maxWeightG: 50000, feeJpy: 1560, storagePer1000cm3: 4.37 },
];

/** カテゴリー別 販売手数料率（概算） */
export function referralRate(category: string | null | undefined, priceJpy: number): number {
  const c = category || '';
  if (/食品|飲料|グルメ|Food|Grocery/i.test(c)) return priceJpy <= 1500 ? 0.08 : 0.1;
  if (/ドラッグ|ビューティー|健康|Beauty/i.test(c)) return priceJpy <= 1500 ? 0.08 : 0.1;
  if (/ペット/i.test(c)) return 0.15;
  if (/ホーム|キッチン|日用品|家庭|Home/i.test(c)) return 0.15;
  if (/家電|パソコン|カメラ/i.test(c)) return 0.08;
  if (/おもちゃ|ホビー|スポーツ|文房具|ファッション/i.test(c)) return 0.1;
  return 0.15;
}

/** FBA配送代行手数料の概算（区分名つき）。リサーチ側の全費目計算から使う */
export function fbaFeeJpy(p: ProductCore): { feeJpy: number; label: string } {
  const t = sizeTier(p);
  return { feeJpy: t.feeJpy, label: t.name };
}

/** FBA在庫保管料の概算（月数分） */
export function fbaStorageFeeJpy(p: ProductCore, months = 1): number {
  const t = sizeTier(p);
  return Math.round((volumeCm3(p) / 1000) * t.storagePer1000cm3 * months);
}

function sizeTier(p: ProductCore): SizeTier {
  const size = p.packageSizeCm || { length: 0, width: 0, height: 0 };
  const dims = [size.length, size.width, size.height].map((v) => v || 0).sort((a, b) => b - a);
  const sum = dims[0] + dims[1] + dims[2];
  const weight = p.weightG || 0;

  const isSmall = dims[0] <= 25 && dims[1] <= 18 && dims[2] <= 2 && weight <= 250;
  if (isSmall) return SMALL;

  const isLarge = dims[0] > 45 || sum > 140 || weight > 9000;
  const table = isLarge ? LARGE : STANDARD;
  for (const tier of table) {
    if (sum <= tier.maxSumCm && weight <= tier.maxWeightG) return tier;
  }
  return table[table.length - 1];
}

function volumeCm3(p: ProductCore): number {
  const s = p.packageSizeCm;
  if (!s) return 1000;
  return Math.max(1, (s.length || 0) * (s.width || 0) * (s.height || 0));
}

/**
 * 自己発送（FBM）の1件あたり配送料の概算。
 * フェーズ1（受注してから仕入れて自分で送る）で使う。
 * 実際は契約運賃で変わるため、必ず assumptions に「概算」と明記する。
 */
export function outboundShippingJpy(p: ProductCore): { feeJpy: number; label: string } {
  const size = p.packageSizeCm || { length: 0, width: 0, height: 0 };
  const dims = [size.length, size.width, size.height].map((v) => v || 0).sort((a, b) => b - a);
  const sum = dims[0] + dims[1] + dims[2];
  const weight = p.weightG || 0;

  // 冷蔵・冷凍はクール便。ポスト投函も使えないので必ず宅配扱いになる。
  const cool = p.temperatureControl === 'frozen' || p.temperatureControl === 'chilled';
  const coolAdd = cool ? (p.temperatureControl === 'frozen' ? 330 : 220) : 0;
  const coolLabel = cool ? `＋クール便（${p.temperatureControl === 'frozen' ? '冷凍' : '冷蔵'}）` : '';

  if (!cool && dims[0] <= 31.2 && dims[1] <= 22.8 && dims[2] <= 3 && weight <= 1000) {
    return { feeJpy: 210, label: 'ネコポス相当（薄型・1kg以下）' };
  }
  const base =
    sum <= 60 && weight <= 2000 && !cool
      ? { feeJpy: 450, label: '宅急便コンパクト相当' }
      : sum <= 60
        ? { feeJpy: 800, label: '宅配60サイズ相当' }
        : sum <= 80
          ? { feeJpy: 950, label: '宅配80サイズ相当' }
          : sum <= 100
            ? { feeJpy: 1180, label: '宅配100サイズ相当' }
            : sum <= 120
              ? { feeJpy: 1400, label: '宅配120サイズ相当' }
              : sum <= 140
                ? { feeJpy: 1620, label: '宅配140サイズ相当' }
                : { feeJpy: 1900, label: '宅配160サイズ以上相当' };

  return { feeJpy: base.feeJpy + coolAdd, label: base.label + coolLabel };
}

export function calcProfit(
  product: ProductCore,
  market: MarketSnapshot,
  opts?: {
    sellPriceJpy?: number;
    supplierPriceJpy?: number;
    storageMonths?: number;
    /** 'fba'（既定）= まとめ仕入れ／'fbm' = 自己発送（受注後に仕入れ） */
    fulfillment?: FulfillmentMode;
    /** 仕入先の送料・関税を含んだ実仕入原価が分かっている場合、輸送費の推定を上書きする */
    inboundShippingJpy?: number;
  },
): ProfitResult {
  const sellPrice = Math.round(opts?.sellPriceJpy ?? market.priceJpy ?? 0);
  // 仕入価格が不明な時は、そのカテゴリの現実的な仕入率（販売価格の45%）を仮置きし、必ず明記する
  const supplierGiven = opts?.supplierPriceJpy ?? product.supplierPriceJpy ?? null;
  const supplierPrice = Math.round(supplierGiven ?? sellPrice * 0.45);
  const fulfillment: FulfillmentMode = opts?.fulfillment ?? 'fba';
  const isFbm = fulfillment === 'fbm';

  const tier = sizeTier(product);
  const rate = referralRate(product.category, sellPrice);
  const referral = Math.max(30, Math.round(sellPrice * rate));

  // 自己発送はFBA手数料の代わりに自分で送料を払う。保管料は発生しない。
  const ship = outboundShippingJpy(product);
  const fulfillmentFee = isFbm ? ship.feeJpy : tier.feeJpy;
  const months = opts?.storageMonths ?? 1;
  const storage = isFbm ? 0 : Math.round((volumeCm3(product) / 1000) * tier.storagePer1000cm3 * months);

  const inbound = Math.round(opts?.inboundShippingJpy ?? supplierPrice * config.importShippingRate);
  const ad = Math.round(sellPrice * config.adCostRate);
  const returnLoss = Math.round((supplierPrice + fulfillmentFee) * config.returnRate);

  const totalCost = supplierPrice + inbound + referral + fulfillmentFee + storage + ad + returnLoss;
  const profit = sellPrice - totalCost;
  const profitRate = sellPrice > 0 ? profit / sellPrice : 0;
  const invested = supplierPrice + inbound;
  const roi = invested > 0 ? profit / invested : 0;
  const breakeven = Math.round(
    (supplierPrice + inbound + fulfillmentFee + storage + returnLoss) / (1 - rate - config.adCostRate),
  );

  const assumptions = [
    isFbm
      ? `自己発送のため配送料は「${ship.label}」の概算 ${ship.feeJpy.toLocaleString()}円（契約運賃で変わります）`
      : `FBA配送代行手数料は「${tier.name}」の概算 ${fulfillmentFee.toLocaleString()}円（最新の料金表で要確認）`,
    `販売手数料は ${(rate * 100).toFixed(0)}%（カテゴリー「${product.category || '不明'}」からの推定）`,
    isFbm ? '自己発送のため在庫保管料は0円' : `在庫保管料は ${months}ヶ月分の概算（1〜9月の料率で計算）`,
    `広告費は販売価格の ${(config.adCostRate * 100).toFixed(0)}%（ASSUMED_AD_COST_RATE）`,
    `返品ロスは ${(config.returnRate * 100).toFixed(0)}%（ASSUMED_RETURN_RATE）`,
    opts?.inboundShippingJpy != null
      ? `仕入輸送費は仕入先見積の実額 ${inbound.toLocaleString()}円`
      : `仕入輸送費は仕入価格の ${(config.importShippingRate * 100).toFixed(0)}%（IMPORT_SHIPPING_RATE）`,
    supplierGiven === null
      ? '★仕入価格が未確定のため販売価格の45%で仮置き。実際の見積が入るまで参考値'
      : '仕入価格は入力値を使用',
  ];

  return {
    sellPriceJpy: sellPrice,
    supplierPriceJpy: supplierPrice,
    inboundShippingJpy: inbound,
    referralFeeJpy: referral,
    referralFeeRate: rate,
    fbaFeeJpy: fulfillmentFee,
    fbaSizeTier: isFbm ? ship.label : tier.name,
    storageFeeJpy: storage,
    adCostJpy: ad,
    returnLossJpy: returnLoss,
    totalCostJpy: totalCost,
    profitJpy: profit,
    profitRate,
    roi,
    breakevenPriceJpy: breakeven,
    assumptions,
  };
}
