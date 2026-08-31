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

/**
 * 会社の規模。
 *
 * ★これを分けるのは「いきなり大きい買い物を提案しない」ため。
 *   相手の規模が分からないのに、複数業務をまたぐ専用システムの話から始めると、
 *   相手にとっては見当違いの高い提案になり、こちらの信用も落ちる。
 *   分からないときは UNKNOWN のままにして、いちばん小さい入口の商品だけを提案する。
 */
export const SCALE_BANDS = ['MICRO', 'SMALL', 'MID', 'LARGE', 'UNKNOWN'] as const;
export type ScaleBand = (typeof SCALE_BANDS)[number];

export const SCALE_LABEL: Record<ScaleBand, string> = {
  MICRO: '個人・数名',
  SMALL: '小規模（〜30名程度）',
  MID: '中規模（〜300名程度）',
  LARGE: '大規模（300名以上）',
  UNKNOWN: '規模が分かっていない',
};

/** 文字列を規模に直す。知らない値・空欄は UNKNOWN（勝手にどれかへ寄せない）。 */
export function toScaleBand(v: unknown): ScaleBand {
  const s = String(v ?? '').trim().toUpperCase();
  return (SCALE_BANDS as readonly string[]).includes(s) ? (s as ScaleBand) : 'UNKNOWN';
}

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

/**
 * その言葉が本文に「言葉として」出てくるか。
 *
 * ★アルファベットだけの短い言葉を、ただの文字列として探してはいけない。
 *   「EC」を文字列として探すと、会社のURL「nagasetechnos.com」の中の "ec" に当たり、
 *   プラスチックの製造会社が「EC・小売」と判定されてしまう（実際に起きた）。
 *   業種を間違えると、売る商品も営業文の切り口も丸ごと間違う。
 *
 *   そこで、アルファベットと数字だけでできた言葉は、前後が英数字でないときだけ当たりとする。
 *   日本語の言葉（「建設」など）は、日本語に語の切れ目が無いので今までどおり文字列で探す。
 */
function hasWord(haystack: string, word: string): boolean {
  const w = word.toLowerCase();
  if (!/^[a-z0-9]+$/.test(w)) return haystack.includes(w);
  const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
  return re.test(haystack);
}

function countWord(haystack: string, word: string): number {
  const w = word.toLowerCase();
  if (!hasWord(haystack, w)) return 0;
  return haystack.split(w).length - 1;
}

/**
 * 業種を推定する。
 *
 * ★1つ当たっただけで決めない。当たった言葉の「重み」を業種ごとに足して、いちばん重い業種を選ぶ。
 *   重みは 言葉の長さ × 出てきた回数（3回で頭打ち） × 出てきた場所。
 *
 * ★なぜこの形か。
 *   以前は「いちばん長く当たった言葉」1つだけで決めていた。そのため、HPの本文
 *   （数千文字）のメニュー欄に1回だけ出てきた言葉が、その会社の本業を上書きしていた。
 *   実例: 株式会社ナガセテクノス（プラスチックの製造会社）。本文に「製造」と何度も
 *   書いてあるのに、どこかに1回だけあった「配送」で「運送・物流」と判定された。
 *   業種を間違えると、売る商品も営業文の切り口も丸ごと間違う。
 *
 * ★1つ目のテキスト（会社名）で当たった言葉は3倍に重くする。
 *   会社名は、その会社が自分の本業として名乗っている言葉だから。
 *   本文のメニュー欄に1回出ただけの言葉より、はるかに確かな手がかりになる。
 */
export function guessIndustry(...texts: (string | null | undefined)[]): { key: IndustryKey; matched: string | null } {
  const norm = (v: unknown) => String(v ?? '').normalize('NFKC').toLowerCase();
  const list = texts.map(norm);
  const nameZone = list[0] ?? '';
  const joined = list.filter((s) => s.trim()).join(' ');
  if (!joined.trim()) return { key: 'UNKNOWN', matched: null };

  let best: { key: IndustryKey; matched: string; score: number } | null = null;
  for (const rule of RULES) {
    let score = 0;
    let top: { word: string; weight: number } | null = null;
    for (const w of rule.words) {
      const hits = countWord(joined, w);
      if (hits === 0) continue;
      const inName = hasWord(nameZone, w) ? 3 : 1;
      const weight = w.length * Math.min(hits, 3) * inName;
      score += weight;
      if (!top || weight > top.weight) top = { word: w, weight };
    }
    if (top && (!best || score > best.score)) best = { key: rule.key, matched: top.word, score };
  }
  return best ? { key: best.key, matched: best.matched } : { key: 'UNKNOWN', matched: null };
}
