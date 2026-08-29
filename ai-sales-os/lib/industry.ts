/**
 * 業種の推定。会社名・事業内容・HPの本文から当てる。
 * 当たらなかったら 'UNKNOWN' を返す。無理にどれかへ寄せない（間違った業種で営業する方が損）。
 */

export const INDUSTRY_KEYS = [
  'REAL_ESTATE',   // 不動産
  'RESTAURANT',    // 飲食
  'CONSTRUCTION',  // 建設・リフォーム
  'EC_RETAIL',     // EC・小売
  'GACHA',         // オンラインガチャ・トレカ
  'BEAUTY',        // 美容・サロン
  'MEDICAL',       // 医療・介護
  'EDUCATION',     // 教育・スクール
  'LOGISTICS',     // 運送・物流
  'MANUFACTURING', // 製造
  'IT',            // IT・システム
  'PROFESSIONAL',  // 士業・コンサル
  'AUTOMOTIVE',    // 自動車
  'RECRUIT',       // 人材
  'UNKNOWN',
] as const;

export type IndustryKey = (typeof INDUSTRY_KEYS)[number];

export const INDUSTRY_LABEL: Record<IndustryKey, string> = {
  REAL_ESTATE: '不動産',
  RESTAURANT: '飲食',
  CONSTRUCTION: '建設・リフォーム',
  EC_RETAIL: 'EC・小売',
  GACHA: 'オンラインガチャ・トレカ',
  BEAUTY: '美容・サロン',
  MEDICAL: '医療・介護',
  EDUCATION: '教育・スクール',
  LOGISTICS: '運送・物流',
  MANUFACTURING: '製造',
  IT: 'IT・システム',
  PROFESSIONAL: '士業・コンサル',
  AUTOMOTIVE: '自動車',
  RECRUIT: '人材',
  UNKNOWN: '不明',
};

const RULES: { key: Exclude<IndustryKey, 'UNKNOWN'>; words: string[] }[] = [
  { key: 'REAL_ESTATE', words: ['不動産', '賃貸', '売買仲介', 'マンション管理', '土地活用', '住宅販売', 'ハウジング'] },
  { key: 'RESTAURANT', words: ['飲食', 'レストラン', '居酒屋', 'カフェ', '焼肉', 'ラーメン', '寿司', '食堂', 'ダイニング', 'バル'] },
  { key: 'CONSTRUCTION', words: ['建設', '工務店', 'リフォーム', '塗装', '内装', '解体', '電気工事', '設備工事', '土木', '外構', '板金'] },
  { key: 'GACHA', words: ['オリパ', 'ガチャ', 'トレカ', 'トレーディングカード', 'ポケカ', '遊戯王'] },
  { key: 'EC_RETAIL', words: ['通販', 'EC', 'オンラインショップ', '小売', '物販', 'せどり', 'amazon', '楽天市場', 'ネットショップ'] },
  { key: 'BEAUTY', words: ['美容', 'サロン', 'エステ', 'ネイル', '理容', 'ヘアー', 'まつげ', 'リラクゼーション'] },
  { key: 'MEDICAL', words: ['クリニック', '医院', '歯科', '整骨', '接骨', '介護', 'デイサービス', '訪問看護', '薬局'] },
  { key: 'EDUCATION', words: ['学習塾', 'スクール', '教室', '予備校', '研修', '講座', '教育'] },
  { key: 'LOGISTICS', words: ['運送', '物流', '配送', '倉庫', 'トラック', '引越'] },
  { key: 'MANUFACTURING', words: ['製造', '工業', '加工', '製作所', '金属', '樹脂', 'プラント', '部品'] },
  { key: 'IT', words: ['システム開発', 'ソフトウェア', 'web制作', 'ホームページ制作', 'アプリ開発', 'it', 'dx支援', 'sier'] },
  { key: 'PROFESSIONAL', words: ['税理士', '社労士', '行政書士', '司法書士', '弁護士', '会計事務所', 'コンサルティング', 'コンサル'] },
  { key: 'AUTOMOTIVE', words: ['自動車', '中古車', '車検', '整備', 'カーショップ', 'モータース'] },
  { key: 'RECRUIT', words: ['人材紹介', '人材派遣', '求人', '採用支援'] },
];

export function guessIndustry(...texts: (string | null | undefined)[]): { key: IndustryKey; matched: string | null } {
  const joined = texts.filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
  if (!joined.trim()) return { key: 'UNKNOWN', matched: null };
  let best: { key: IndustryKey; matched: string; len: number } | null = null;
  for (const rule of RULES) {
    for (const w of rule.words) {
      if (joined.includes(w.toLowerCase())) {
        if (!best || w.length > best.len) best = { key: rule.key, matched: w, len: w.length };
      }
    }
  }
  return best ? { key: best.key, matched: best.matched } : { key: 'UNKNOWN', matched: null };
}
