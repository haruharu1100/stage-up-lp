import type { SupplierAttributes } from '../types';

/**
 * テキスト・属性の照合（AI課金ゼロ）。
 * 仕入先は中国語混じり、Amazonは日本語という前提で作る。
 */

// ---- 正規化 ------------------------------------------------------

const FULLWIDTH_OFFSET = 0xfee0;

export function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_OFFSET))
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[・･,.\-–—_/／\\()（）\[\]【】「」『』"'”“:：;；!！?？*＊+＋]/g, '');
}

/** 型番の正規化（英数字だけ残す） */
export function normalizeModel(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_OFFSET))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** GTIN/JANの正規化。13桁/12桁を揃える */
export function normalizeGtin(s: string | null | undefined): string {
  const d = (s || '').replace(/\D/g, '');
  if (d.length === 12) return `0${d}`; // UPC-A → EAN-13
  return d;
}

/** 商品名の中から型番らしき文字列を拾う（例: "CL-300" "PB10K"） */
export function extractModelCandidates(title: string): string[] {
  const out = new Set<string>();
  const re = /[A-Za-z]{1,5}[-‐]?\d{2,6}[A-Za-z]{0,3}/g;
  for (const m of (title || '').match(re) || []) {
    const n = normalizeModel(m);
    // 単なる寸法や容量（500ml, 10cm 等）を型番と誤認しない
    if (n.length >= 4 && !/^(ML|L|G|KG|CM|MM|W|V|MAH|PCS)\d+$/.test(n)) out.add(n);
  }
  return [...out];
}

// ---- 類似度 ------------------------------------------------------

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

/** Dice係数（2文字組の重なり）。日本語・中国語混在でも使える */
export function diceSimilarity(a: string, b: string): number {
  const x = bigrams(normalize(a));
  const y = bigrams(normalize(b));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const g of x) if (y.has(g)) inter++;
  return (2 * inter) / (x.size + y.size);
}

// ---- 属性の抽出（商品名から）---------------------------------------

const COLOR_WORDS: [RegExp, string][] = [
  [/ブラック|黑色|黑|black|ﾌﾞﾗｯｸ|黒/i, 'ブラック'],
  [/ホワイト|白色|白|white/i, 'ホワイト'],
  [/グレー|灰色|灰|gray|grey/i, 'グレー'],
  [/レッド|红色|红|赤|red/i, 'レッド'],
  [/ブルー|蓝色|蓝|青|blue/i, 'ブルー'],
  [/グリーン|绿色|绿|緑|green/i, 'グリーン'],
  [/イエロー|黄色|黄|yellow/i, 'イエロー'],
  [/ピンク|粉色|pink/i, 'ピンク'],
  [/ベージュ|beige/i, 'ベージュ'],
  [/シルバー|银色|银|silver/i, 'シルバー'],
  [/ゴールド|金色|gold/i, 'ゴールド'],
  [/クリア|透明|clear/i, 'クリア'],
  [/アソート|assort|多色|カラフル/i, 'アソート'],
  [/ナチュラル|原木色/i, 'ナチュラル'],
  [/パステル/i, 'パステル'],
];

const MATERIAL_WORDS: [RegExp, string][] = [
  [/シリコン|硅胶|silicone/i, 'シリコン'],
  [/ステンレス|不锈钢|stainless/i, 'ステンレス'],
  [/アルミ|铝|alumin/i, 'アルミ'],
  [/abs樹脂|abs/i, 'ABS'],
  [/pp樹脂|ポリプロピレン|\bpp\b/i, 'PP'],
  [/pvc/i, 'PVC'],
  [/マイクロファイバー|超细纤维|microfiber/i, 'マイクロファイバー'],
  [/ポリエステル|涤纶|polyester/i, 'ポリエステル'],
  [/ナイロン|尼龙|nylon/i, 'ナイロン'],
  [/木製|木|wood|竹/i, '木'],
  [/ガラス|玻璃|glass/i, 'ガラス'],
  [/セラミック|陶瓷|ceramic/i, 'セラミック'],
  [/ウレタン|海绵|スポンジ/i, 'ウレタン'],
  [/hdpe/i, 'HDPE'],
  [/天然毛/i, '天然毛'],
];

/** "500ml" "1.2kg" "15L" のような容量表記を拾って正規化する */
export function extractCapacity(text: string): string | null {
  const m = (text || '').match(/(\d+(?:\.\d+)?)\s*(ml|l|リットル|g|kg|グラム|mah|w|個入|枚入|本入)/i);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const v = Number(m[1]);
  if (unit === 'l' || unit === 'リットル') return `${v * 1000}ml`;
  if (unit === 'kg') return `${v * 1000}g`;
  if (unit === 'グラム') return `${v}g`;
  if (/入$/.test(unit)) return null;
  return `${v}${unit}`;
}

/** "10枚セット" "3本入" "2個組" からセット個数を拾う */
export function extractSetCount(text: string): number | null {
  const m = (text || '').match(/(\d+)\s*(枚|本|個|点|p|pcs|パック)?\s*(セット|組|入|set|pack)/i);
  if (m) return Number(m[1]);
  const m2 = (text || '').match(/(\d+)\s*(枚入|本入|個入)/);
  if (m2) return Number(m2[1]);
  return null;
}

export function extractColor(text: string): string | null {
  for (const [re, label] of COLOR_WORDS) if (re.test(text || '')) return label;
  return null;
}

export function extractMaterial(text: string): string | null {
  for (const [re, label] of MATERIAL_WORDS) if (re.test(text || '')) return label;
  return null;
}

/** 属性が空でも商品名から拾って埋める */
export function enrichAttributes(attrs: SupplierAttributes | null | undefined, title: string): SupplierAttributes {
  const a: SupplierAttributes = { ...(attrs || {}) };
  if (!a.color) a.color = extractColor(title);
  if (!a.material) a.material = extractMaterial(title);
  if (!a.capacity) a.capacity = extractCapacity(title);
  if (!a.setCount) a.setCount = extractSetCount(title);
  return a;
}

// ---- 属性の比較 ---------------------------------------------------

export interface AttrCompare {
  /** 一致 1 / 不一致 -1 / 判定不能 0 */
  verdict: 1 | 0 | -1;
  detail: string;
}

function sizeClose(a?: number | null, b?: number | null, tolerance = 0.15): 1 | 0 | -1 {
  if (!a || !b) return 0;
  const diff = Math.abs(a - b) / Math.max(a, b);
  return diff <= tolerance ? 1 : -1;
}

export function compareSize(x: SupplierAttributes, y: SupplierAttributes): AttrCompare {
  const xs = x.sizeCm;
  const ys = y.sizeCm;
  const parts: string[] = [];
  let hits = 0;
  let misses = 0;

  if (xs && ys && (xs.length || xs.width) && (ys.length || ys.width)) {
    const sx = [xs.length, xs.width, xs.height].map((v) => v || 0).sort((a, b) => b - a);
    const sy = [ys.length, ys.width, ys.height].map((v) => v || 0).sort((a, b) => b - a);
    let ok = 0;
    for (let i = 0; i < 3; i++) if (sizeClose(sx[i], sy[i], 0.2) === 1) ok++;
    if (ok >= 2) {
      hits++;
      parts.push(`外形寸法が近い（${sx.join('×')}cm / ${sy.join('×')}cm）`);
    } else {
      misses++;
      parts.push(`外形寸法が違う（${sx.join('×')}cm / ${sy.join('×')}cm）`);
    }
  }

  const w = sizeClose(x.weightG, y.weightG, 0.2);
  if (w === 1) {
    hits++;
    parts.push(`重量が近い（${x.weightG}g / ${y.weightG}g）`);
  } else if (w === -1) {
    misses++;
    parts.push(`重量が違う（${x.weightG}g / ${y.weightG}g）`);
  }

  if (x.capacity && y.capacity) {
    if (normalize(x.capacity) === normalize(y.capacity)) {
      hits++;
      parts.push(`容量が一致（${x.capacity}）`);
    } else {
      misses++;
      parts.push(`容量が違う（${x.capacity} / ${y.capacity}）`);
    }
  }

  if (!hits && !misses) return { verdict: 0, detail: 'サイズ・容量の情報が足りません' };
  return { verdict: misses > hits ? -1 : 1, detail: parts.join('／') };
}

export function compareColorSpec(x: SupplierAttributes, y: SupplierAttributes): AttrCompare {
  const parts: string[] = [];
  let hits = 0;
  let misses = 0;

  if (x.color && y.color) {
    if (normalize(x.color) === normalize(y.color)) {
      hits++;
      parts.push(`色が一致（${x.color}）`);
    } else {
      misses++;
      parts.push(`色が違う（${x.color} / ${y.color}）`);
    }
  }
  if (x.spec && y.spec) {
    const sim = diceSimilarity(x.spec, y.spec);
    if (sim >= 0.4) {
      hits++;
      parts.push(`仕様の記載が近い（一致度${Math.round(sim * 100)}%）`);
    } else {
      misses++;
      parts.push(`仕様の記載が離れている（一致度${Math.round(sim * 100)}%）`);
    }
  }
  if (!hits && !misses) return { verdict: 0, detail: '色・仕様の情報が足りません' };
  return { verdict: misses > hits ? -1 : 1, detail: parts.join('／') };
}

export function compareOther(
  x: SupplierAttributes,
  y: SupplierAttributes,
  xBrand: string | null | undefined,
  yBrand: string | null | undefined,
): AttrCompare {
  const parts: string[] = [];
  let hits = 0;
  let misses = 0;

  if (x.setCount && y.setCount) {
    if (x.setCount === y.setCount) {
      hits++;
      parts.push(`セット個数が一致（${x.setCount}）`);
    } else {
      misses++;
      parts.push(`セット個数が違う（${x.setCount} / ${y.setCount}）`);
    }
  }
  if (x.material && y.material) {
    if (normalize(x.material).includes(normalize(y.material)) || normalize(y.material).includes(normalize(x.material))) {
      hits++;
      parts.push(`素材が一致（${y.material}）`);
    } else {
      misses++;
      parts.push(`素材が違う（${x.material} / ${y.material}）`);
    }
  }
  if (xBrand && yBrand) {
    if (normalize(xBrand) === normalize(yBrand)) {
      hits++;
      parts.push(`ブランドが一致（${yBrand}）`);
    } else {
      parts.push(`ブランド表記が違う（${xBrand} / ${yBrand}）※OEM品では普通に起きます`);
    }
  }
  if (!hits && !misses) return { verdict: 0, detail: 'その他の特徴を比較できる情報がありません' };
  return { verdict: misses > hits ? -1 : 1, detail: parts.join('／') };
}

/** 埋め込み・Visionに渡す「商品を一言で表す文字列」 */
export function canonicalText(title: string, brand: string | null | undefined, a: SupplierAttributes): string {
  const bits = [
    title,
    brand || '',
    a.color || '',
    a.material || '',
    a.capacity || '',
    a.setCount ? `${a.setCount}個セット` : '',
    a.spec || '',
    a.sizeCm ? `${a.sizeCm.length}x${a.sizeCm.width}x${a.sizeCm.height}cm` : '',
    a.weightG ? `${a.weightG}g` : '',
  ];
  return bits.filter(Boolean).join(' / ').slice(0, 600);
}
