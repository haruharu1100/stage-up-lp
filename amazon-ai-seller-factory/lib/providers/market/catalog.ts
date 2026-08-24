import type { CandidateInput } from '../../types';

/**
 * サンプル候補カタログ（検証用の仮データ）。
 * ★Amazonから取得したデータではない。スクレイピングもしていない。
 *   本番の数値は Keepa / PA-API / CSV から入れる。
 *   ここにあるのは「配線が正しく動くか」を確かめるための架空の商品。
 */
type Seed = {
  title: string;
  brand: string;
  category: string;
  subcategory: string;
  isFood: boolean;
  temperature: 'ambient' | 'chilled' | 'frozen';
  sizeCm: [number, number, number];
  weightG: number;
  shelfLifeDays?: number;
  storageMethod?: string;
  supplierPriceJpy: number;
  priceJpy: number;
  bsr: number;
  bsrCategory: string;
  reviewCount: number;
  rating: number;
  sellerCount: number;
  fbaSellerCount: number;
  monthlySalesEst: number;
  seasonality: string;
  demandTrend: 'up' | 'flat' | 'down';
  listing: { imageCount: number; hasVideo: boolean; hasAplus: boolean; titleLength: number; bulletCount: number };
  weaknesses: string[];
  note: string;
};

const SEEDS: Seed[] = [
  {
    title: '国産鶏むね サラダチキン プレーン 110g×10袋 常温保存',
    brand: 'サンプル食品',
    category: '食品・飲料',
    subcategory: '肉・加工肉',
    isFood: true,
    temperature: 'ambient',
    sizeCm: [24, 18, 9],
    weightG: 1250,
    shelfLifeDays: 180,
    storageMethod: '直射日光を避け常温で保存',
    supplierPriceJpy: 1180,
    priceJpy: 2480,
    bsr: 780,
    bsrCategory: '食品・飲料',
    reviewCount: 412,
    rating: 4.1,
    sellerCount: 4,
    fbaSellerCount: 2,
    monthlySalesEst: 900,
    seasonality: '通年（1〜3月にやや増）',
    demandTrend: 'up',
    listing: { imageCount: 4, hasVideo: false, hasAplus: false, titleLength: 38, bulletCount: 3 },
    weaknesses: ['画像4枚のみ', '動画なし', 'A+なし', '保存方法が画像で説明されていない'],
    note: '常温保存できる点が競合と違うのに、ページで一切訴求されていない',
  },
  {
    title: '無添加 だし調味料 かつお・昆布 500ml 化学調味料不使用',
    brand: 'サンプル醸造',
    category: '食品・飲料',
    subcategory: '調味料',
    isFood: true,
    temperature: 'ambient',
    sizeCm: [8, 8, 26],
    weightG: 620,
    shelfLifeDays: 365,
    storageMethod: '開封後は冷蔵保存',
    supplierPriceJpy: 520,
    priceJpy: 1280,
    bsr: 2100,
    bsrCategory: '食品・飲料',
    reviewCount: 168,
    rating: 4.4,
    sellerCount: 3,
    fbaSellerCount: 1,
    monthlySalesEst: 520,
    seasonality: '通年',
    demandTrend: 'up',
    listing: { imageCount: 3, hasVideo: false, hasAplus: false, titleLength: 32, bulletCount: 4 },
    weaknesses: ['使用シーン画像なし', '希釈倍率が画像に無い', '動画なし'],
    note: '「何倍に薄めるか分からない」というレビューが繰り返し出ている',
  },
  {
    title: '長期保存 5年 非常用 パン 缶詰 6缶セット（プレーン・オレンジ）',
    brand: 'サンプル備蓄',
    category: '食品・飲料',
    subcategory: '保存食・非常食',
    isFood: true,
    temperature: 'ambient',
    sizeCm: [30, 20, 11],
    weightG: 1800,
    shelfLifeDays: 1825,
    storageMethod: '常温・冷暗所で保存',
    supplierPriceJpy: 1650,
    priceJpy: 3980,
    bsr: 1450,
    bsrCategory: '食品・飲料',
    reviewCount: 96,
    rating: 3.9,
    sellerCount: 6,
    fbaSellerCount: 3,
    monthlySalesEst: 380,
    seasonality: '9月・3月に大きく増（防災の日／震災報道）',
    demandTrend: 'up',
    listing: { imageCount: 5, hasVideo: false, hasAplus: false, titleLength: 41, bulletCount: 5 },
    weaknesses: ['賞味期限表示が読み取りにくい', '中身の写真が1枚だけ', '動画なし'],
    note: '季節性が強く在庫計画が要る。ページの信頼感が弱い',
  },
  {
    title: '国産 味付き牛カルビ 焼肉用 300g×3パック 冷凍',
    brand: 'サンプル精肉',
    category: '食品・飲料',
    subcategory: '肉・加工肉',
    isFood: true,
    temperature: 'frozen',
    sizeCm: [26, 20, 8],
    weightG: 1050,
    shelfLifeDays: 90,
    storageMethod: '-18℃以下で保存',
    supplierPriceJpy: 2400,
    priceJpy: 4980,
    bsr: 3200,
    bsrCategory: '食品・飲料',
    reviewCount: 74,
    rating: 4.2,
    sellerCount: 2,
    fbaSellerCount: 0,
    monthlySalesEst: 210,
    seasonality: '7〜8月・12月に増',
    demandTrend: 'flat',
    listing: { imageCount: 6, hasVideo: false, hasAplus: true, titleLength: 34, bulletCount: 5 },
    weaknesses: ['解凍方法の説明が弱い'],
    note: '冷凍はFBA納品条件の制約が大きい（クール対応の可否を必ず確認）',
  },
  {
    title: '有機 ルイボスティー ティーバッグ 3g×100包 ノンカフェイン',
    brand: 'サンプル茶園',
    category: '食品・飲料',
    subcategory: '飲料・お茶',
    isFood: true,
    temperature: 'ambient',
    sizeCm: [22, 14, 10],
    weightG: 420,
    shelfLifeDays: 730,
    storageMethod: '高温多湿を避け常温保存',
    supplierPriceJpy: 640,
    priceJpy: 1680,
    bsr: 950,
    bsrCategory: '食品・飲料',
    reviewCount: 1240,
    rating: 4.3,
    sellerCount: 12,
    fbaSellerCount: 8,
    monthlySalesEst: 1500,
    seasonality: '通年',
    demandTrend: 'flat',
    listing: { imageCount: 7, hasVideo: true, hasAplus: true, titleLength: 36, bulletCount: 5 },
    weaknesses: [],
    note: '需要は大きいが競合が強くページも完成済み。相乗り前提なら価格勝負になる',
  },
  {
    title: 'ギフト 高級ドリップコーヒー 詰め合わせ 24袋 熨斗対応 化粧箱入り',
    brand: 'サンプル焙煎所',
    category: '食品・飲料',
    subcategory: 'ギフト食品',
    isFood: true,
    temperature: 'ambient',
    sizeCm: [28, 22, 7],
    weightG: 700,
    shelfLifeDays: 365,
    storageMethod: '高温多湿・直射日光を避け常温保存',
    supplierPriceJpy: 1450,
    priceJpy: 3480,
    bsr: 1850,
    bsrCategory: '食品・飲料',
    reviewCount: 132,
    rating: 4.5,
    sellerCount: 3,
    fbaSellerCount: 2,
    monthlySalesEst: 430,
    seasonality: '6月・12月に大きく増（お中元・お歳暮）',
    demandTrend: 'up',
    listing: { imageCount: 4, hasVideo: false, hasAplus: false, titleLength: 44, bulletCount: 4 },
    weaknesses: ['熨斗の実物写真が無い', '贈答シーンの画像が無い', '動画なし', '化粧箱のサイズ表記が無い'],
    note: 'ギフトは「贈って恥ずかしくないか」が購入決定要因。今のページはそこが伝わっていない',
  },
  {
    title: '生ごみ 消臭 密閉ゴミ箱 20L ペダル式 防臭パッキン',
    brand: 'サンプル生活',
    category: 'ホーム＆キッチン',
    subcategory: '日用品',
    isFood: false,
    temperature: 'ambient',
    sizeCm: [42, 32, 30],
    weightG: 2400,
    supplierPriceJpy: 1750,
    priceJpy: 4280,
    bsr: 640,
    bsrCategory: 'ホーム＆キッチン',
    reviewCount: 520,
    rating: 3.8,
    sellerCount: 5,
    fbaSellerCount: 3,
    monthlySalesEst: 760,
    seasonality: '6〜9月に増（夏の匂い対策）',
    demandTrend: 'up',
    listing: { imageCount: 5, hasVideo: false, hasAplus: false, titleLength: 30, bulletCount: 4 },
    weaknesses: ['サイズ比較画像が無い', 'ゴミ袋の掛け方が分からない', '動画なし', '低評価の理由に未回答'],
    note: '低評価が「思ったより大きい」「袋が合わない」に集中。画像で解決できる不満',
  },
  {
    title: '珪藻土 ではない 速乾 バスマット 洗える 60×40cm 2枚組',
    brand: 'サンプル生活',
    category: 'ホーム＆キッチン',
    subcategory: '日用品',
    isFood: false,
    temperature: 'ambient',
    sizeCm: [62, 42, 4],
    weightG: 900,
    supplierPriceJpy: 980,
    priceJpy: 2680,
    bsr: 1120,
    bsrCategory: 'ホーム＆キッチン',
    reviewCount: 288,
    rating: 4.0,
    sellerCount: 9,
    fbaSellerCount: 6,
    monthlySalesEst: 640,
    seasonality: '通年（梅雨に増）',
    demandTrend: 'flat',
    listing: { imageCount: 6, hasVideo: false, hasAplus: true, titleLength: 33, bulletCount: 5 },
    weaknesses: ['洗濯後の乾き方が分からない'],
    note: '競合が多く価格が崩れやすい',
  },
  {
    title: '海苔 巻きずし用 全形 50枚 訳あり 焼海苔 業務用',
    brand: 'サンプル海産',
    category: '食品・飲料',
    subcategory: '加工食品',
    isFood: true,
    temperature: 'ambient',
    sizeCm: [23, 21, 6],
    weightG: 340,
    shelfLifeDays: 270,
    storageMethod: '高温多湿を避け常温保存（開封後は密閉）',
    supplierPriceJpy: 720,
    priceJpy: 1980,
    bsr: 2600,
    bsrCategory: '食品・飲料',
    reviewCount: 214,
    rating: 4.0,
    sellerCount: 4,
    fbaSellerCount: 2,
    monthlySalesEst: 480,
    seasonality: '2月（節分）に急増',
    demandTrend: 'flat',
    listing: { imageCount: 3, hasVideo: false, hasAplus: false, titleLength: 29, bulletCount: 3 },
    weaknesses: ['「訳あり」の理由が説明されていない', '枚数の実物写真が無い', '動画なし', 'A+なし'],
    note: '「訳あり」の中身が不明で買い控えが起きている。説明を足すだけで改善余地',
  },
  {
    title: '米袋 保存容器 密閉 5kg 計量カップ付き 冷蔵庫対応',
    brand: 'サンプル生活',
    category: 'ホーム＆キッチン',
    subcategory: '意外な売れ筋',
    isFood: false,
    temperature: 'ambient',
    sizeCm: [34, 16, 25],
    weightG: 1100,
    supplierPriceJpy: 1080,
    priceJpy: 2980,
    bsr: 890,
    bsrCategory: 'ホーム＆キッチン',
    reviewCount: 356,
    rating: 3.9,
    sellerCount: 3,
    fbaSellerCount: 1,
    monthlySalesEst: 700,
    seasonality: '通年',
    demandTrend: 'up',
    listing: { imageCount: 4, hasVideo: false, hasAplus: false, titleLength: 28, bulletCount: 3 },
    weaknesses: ['冷蔵庫に入るか分からない', '5kgが本当に入るのか写真が無い', '動画なし', 'A+なし'],
    note: '地味だが安定して売れている。ページが弱く、サイズ不安を消せば伸ばせる',
  },
  {
    title: 'ふりかけ 業務用 大袋 500g 3種セット（鮭・のりたま風・おかか）',
    brand: 'サンプル食品',
    category: '食品・飲料',
    subcategory: '加工食品',
    isFood: true,
    temperature: 'ambient',
    sizeCm: [28, 20, 12],
    weightG: 1600,
    shelfLifeDays: 300,
    storageMethod: '高温多湿を避け常温保存',
    supplierPriceJpy: 1240,
    priceJpy: 2680,
    bsr: 4100,
    bsrCategory: '食品・飲料',
    reviewCount: 58,
    rating: 4.2,
    sellerCount: 2,
    fbaSellerCount: 1,
    monthlySalesEst: 180,
    seasonality: '通年（新学期に増）',
    demandTrend: 'flat',
    listing: { imageCount: 3, hasVideo: false, hasAplus: false, titleLength: 37, bulletCount: 3 },
    weaknesses: ['1袋の大きさが分からない', '保存方法の説明が弱い'],
    note: '需要は中程度。利益率は取りやすい',
  },
  {
    title: '冷凍 讃岐うどん 半生麺 200g×10食 つゆ付き',
    brand: 'サンプル製麺',
    category: '食品・飲料',
    subcategory: '加工食品',
    isFood: true,
    temperature: 'frozen',
    sizeCm: [30, 24, 10],
    weightG: 2400,
    shelfLifeDays: 120,
    storageMethod: '-18℃以下で保存',
    supplierPriceJpy: 1520,
    priceJpy: 3280,
    bsr: 2900,
    bsrCategory: '食品・飲料',
    reviewCount: 143,
    rating: 4.3,
    sellerCount: 3,
    fbaSellerCount: 0,
    monthlySalesEst: 260,
    seasonality: '11〜2月に増',
    demandTrend: 'flat',
    listing: { imageCount: 5, hasVideo: false, hasAplus: false, titleLength: 27, bulletCount: 4 },
    weaknesses: ['ゆで時間の記載が弱い', '動画なし'],
    note: '冷凍はFBAのクール対応可否が最大の壁',
  },
];

/** 実行ごとに少しだけ数値を揺らす（毎回同じ順位にならないように） */
function jitter(base: number, ratio: number, seed: number): number {
  const wave = Math.sin(seed * 12.9898) * 43758.5453;
  const frac = wave - Math.floor(wave);
  return Math.round(base * (1 + (frac - 0.5) * 2 * ratio));
}

function priceHistory(price: number, bsr: number, seed: number) {
  const out: { date: string; priceJpy: number; bsr: number }[] = [];
  const today = new Date();
  for (let i = 89; i >= 0; i -= 7) {
    const d = new Date(today.getTime() - i * 86400000);
    out.push({
      date: d.toISOString().slice(0, 10),
      priceJpy: jitter(price, 0.06, seed + i),
      bsr: jitter(bsr, 0.25, seed + i * 3),
    });
  }
  return out;
}

export function sampleCandidates(runSeed: number, limit = 10): CandidateInput[] {
  const picked = [...SEEDS]
    .map((seed, i) => ({ seed, order: jitter(1000, 0.9, runSeed + i * 7) }))
    .sort((a, b) => b.order - a.order)
    .slice(0, limit)
    .map(({ seed }, i) => toCandidate(seed, runSeed + i));
  return picked;
}

function toCandidate(seed: Seed, s: number): CandidateInput {
  const price = jitter(seed.priceJpy, 0.05, s);
  const bsr = jitter(seed.bsr, 0.2, s + 1);
  const asin = 'SAMPLE' + Math.abs(hash(seed.title)).toString(36).toUpperCase().slice(0, 4);
  return {
    product: {
      id: '',
      asin,
      gtin: null,
      title: seed.title,
      brand: seed.brand,
      category: seed.category,
      subcategory: seed.subcategory,
      isFood: seed.isFood,
      temperatureControl: seed.temperature,
      packageSizeCm: { length: seed.sizeCm[0], width: seed.sizeCm[1], height: seed.sizeCm[2] },
      weightG: seed.weightG,
      shelfLifeDays: seed.shelfLifeDays ?? null,
      storageMethod: seed.storageMethod ?? null,
      supplierName: '（未定：仕入先は要確認）',
      supplierPriceJpy: jitter(seed.supplierPriceJpy, 0.05, s + 2),
      sourceType: null,
    },
    market: {
      source: 'sample',
      fetchedAt: new Date().toISOString(),
      priceJpy: price,
      bsr,
      bsrCategory: seed.bsrCategory,
      reviewCount: jitter(seed.reviewCount, 0.1, s + 3),
      rating: Math.min(5, Math.max(1, Number((seed.rating + (jitter(10, 0.5, s + 4) - 10) / 100).toFixed(1)))),
      offerCount: seed.sellerCount,
      sellerCount: seed.sellerCount,
      fbaSellerCount: seed.fbaSellerCount,
      isAmazonSelling: seed.sellerCount > 8,
      monthlySalesEst: jitter(seed.monthlySalesEst, 0.15, s + 5),
      seasonality: seed.seasonality,
      demandTrend: seed.demandTrend,
      priceHistory: priceHistory(price, bsr, s),
      listingQuality: seed.listing,
    },
    competitors: [
      {
        asin: asin + 'C1',
        title: seed.title.replace(/^(\S+)/, '$1（競合A）'),
        priceJpy: jitter(price, 0.12, s + 6),
        rating: 4.0,
        reviewCount: jitter(seed.reviewCount, 0.4, s + 7),
        imageCount: seed.listing.imageCount,
        hasVideo: seed.listing.hasVideo,
        hasAplus: seed.listing.hasAplus,
        listingWeakness: seed.weaknesses,
        note: seed.note,
      },
    ],
    notes: seed.note,
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
