import crypto from 'node:crypto';

import { type ConditionRank } from './conditions';

export { CONDITION_RANKS, CONDITION_LABELS, type ConditionRank } from './conditions';

/**
 * 仕入先横断の状態ラベル辞書。
 * ここに無いラベルは推測でマッピングせず、人間確認（MANUAL_REVIEW）へ回す。
 */
const CONDITION_DICT: Record<string, ConditionRank> = {
  // ランク表記
  n: 'N', s: 'S', a: 'A', b: 'B', c: 'C', d: 'D',
  sa: 'S', ab: 'A', bc: 'B', cd: 'C',
  'aランク': 'A', 'bランク': 'B', 'cランク': 'C', 'dランク': 'D', 'sランク': 'S', 'nランク': 'N',
  // 日本語表記
  '新品': 'N', '新品未使用': 'N', '未使用': 'N', '新品・未使用': 'N', '完全新品': 'N', 'デッドストック': 'N',
  '未使用に近い': 'S', 'ほぼ新品': 'S', '極美品': 'S',
  '目立った傷や汚れなし': 'A', '美品': 'A', '状態良好': 'A',
  'やや傷や汚れあり': 'B', '中古': 'B', '並品': 'B', '使用感あり': 'B',
  '傷や汚れあり': 'C', '難あり': 'C', '状態不良': 'C',
  '全体的に状態が悪い': 'D', 'ジャンク': 'D', 'ジャンク品': 'D', '要修理': 'D',
  // 英語表記
  new: 'N', unused: 'N', 'like new': 'S', mint: 'S', excellent: 'A',
  good: 'B', used: 'B', fair: 'C', poor: 'D', junk: 'D',
};

/** ブランド表記ゆれ辞書。DBの brand_aliases で上書き・追加できる。 */
export const BRAND_ALIASES: Record<string, string> = {
  'ナイキ': 'NIKE', 'nike': 'NIKE',
  'アディダス': 'ADIDAS', 'adidas': 'ADIDAS',
  'ニューバランス': 'NEW BALANCE', 'newbalance': 'NEW BALANCE', 'nb': 'NEW BALANCE',
  'ルイヴィトン': 'LOUIS VUITTON', 'ルイ・ヴィトン': 'LOUIS VUITTON', 'louisvuitton': 'LOUIS VUITTON', 'lv': 'LOUIS VUITTON',
  'シャネル': 'CHANEL', 'chanel': 'CHANEL',
  'グッチ': 'GUCCI', 'gucci': 'GUCCI',
  'エルメス': 'HERMES', 'hermes': 'HERMES',
  'プラダ': 'PRADA', 'prada': 'PRADA',
  'ロレックス': 'ROLEX', 'rolex': 'ROLEX',
  'オメガ': 'OMEGA', 'omega': 'OMEGA',
  'セイコー': 'SEIKO', 'seiko': 'SEIKO',
  'ソニー': 'SONY', 'sony': 'SONY',
  'ニンテンドー': 'NINTENDO', '任天堂': 'NINTENDO', 'nintendo': 'NINTENDO',
  'アップル': 'APPLE', 'apple': 'APPLE',
  'キヤノン': 'CANON', 'キャノン': 'CANON', 'canon': 'CANON',
  'ニコン': 'NIKON', 'nikon': 'NIKON',
  'ザノースフェイス': 'THE NORTH FACE', 'ノースフェイス': 'THE NORTH FACE', 'thenorthface': 'THE NORTH FACE',
};

/** 全角→半角、記号・空白の統一。 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    // 長音符「ー」は日本語の文字なので変換しない（商品名が読めなくなる）
    .replace(/[‐‑‒–—―−]/g, '-');
}

export function cleanText(s: string | undefined | null): string {
  if (!s) return '';
  return toHalfWidth(String(s)).replace(/\s+/g, ' ').trim();
}

export function normalizeBrand(raw: string | undefined | null, extra?: Map<string, string>): string {
  const t = cleanText(raw);
  if (!t) return '';
  const key = t.toLowerCase().replace(/[\s\-.]/g, '');
  if (extra?.has(key)) return extra.get(key)!;
  if (BRAND_ALIASES[key]) return BRAND_ALIASES[key];
  if (BRAND_ALIASES[t]) return BRAND_ALIASES[t];
  return t.toUpperCase();
}

/** 型番の照合キー。ハイフン・空白・大小文字の違いを吸収する。 */
export function modelKey(raw: string | undefined | null): string {
  const t = cleanText(raw);
  if (!t) return '';
  return t.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeSize(raw: string | undefined | null): string {
  const t = cleanText(raw);
  if (!t) return '';
  const cm = t.match(/^([0-9]+(?:\.[0-9])?)\s*(?:cm|センチ)?$/i);
  if (cm) return String(parseFloat(cm[1]));
  return t.toUpperCase();
}

export function normalizeColor(raw: string | undefined | null): string {
  return cleanText(raw).toUpperCase();
}

export function normalizeCategory(raw: string | undefined | null): string {
  const t = cleanText(raw).toLowerCase();
  if (!t) return 'unknown';
  const table: Record<string, string> = {
    'スニーカー': 'sneaker', sneaker: 'sneaker', shoes: 'sneaker', '靴': 'sneaker',
    'バッグ': 'bag', bag: 'bag', '鞄': 'bag',
    '財布': 'wallet', wallet: 'wallet',
    '時計': 'watch', watch: 'watch', '腕時計': 'watch',
    'アパレル': 'apparel', '衣類': 'apparel', apparel: 'apparel', '服': 'apparel',
    'ゲーム': 'game', game: 'game',
    '家電': 'appliance', appliance: 'appliance',
    'カメラ': 'camera', camera: 'camera',
    '本': 'book', book: 'book', '書籍': 'book',
    'トレカ': 'tradingcard', 'トレーディングカード': 'tradingcard',
    'アクセサリー': 'accessory', accessory: 'accessory',
  };
  return table[t] ?? t.replace(/\s+/g, '-');
}

/** 「¥82,000」「82000円」などを整数の円へ。取れなければ null。 */
export function parseMoney(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const t = toHalfWidth(String(raw)).replace(/[¥,、\s円]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export function parseIntOrNull(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(toHalfWidth(String(raw)).replace(/[,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export type ConditionResult = { rank: ConditionRank | null; raw: string };

export function normalizeCondition(raw: string | undefined | null, supplierMap?: Map<string, ConditionRank>): ConditionResult {
  const t = cleanText(raw);
  if (!t) return { rank: null, raw: '' };
  const key = t.toLowerCase().replace(/[\s・]/g, '');
  if (supplierMap?.has(key)) return { rank: supplierMap.get(key)!, raw: t };
  const hit = CONDITION_DICT[key] ?? CONDITION_DICT[t] ?? CONDITION_DICT[t.toLowerCase()];
  return { rank: hit ?? null, raw: t };
}

export function normalizeJan(raw: string | undefined | null): string {
  const t = toHalfWidth(String(raw ?? '')).replace(/[^0-9]/g, '');
  if (t.length === 8 || t.length === 12 || t.length === 13 || t.length === 14) return t;
  return '';
}

/**
 * L2 個体重複の判定キー。
 * 同じ店に同じ内容の出品が二重に載っているケースを弾く。
 * ※ 画像pHash は Phase 2 で追加する（Phase 1 では未実装）。
 */
export function contentHash(input: {
  brand: string;
  modelKey: string;
  color: string;
  size: string;
  conditionRank: string | null;
  purchasePrice: number | null;
  name: string;
}): string {
  const bucket = input.purchasePrice === null ? 'na' : String(Math.round(input.purchasePrice / 1000));
  const parts = [
    input.brand,
    input.modelKey || input.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40),
    input.color,
    input.size,
    input.conditionRank ?? 'na',
    bucket,
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/**
 * L3 商品マスタの同一性キー。
 * JANがあれば決定的。無ければブランド＋型番＋色＋サイズ。
 * どれも無ければ null（＝マスタに紐づけない。推測で束ねない）。
 */
export function identityKey(input: {
  jan: string;
  brand: string;
  modelKey: string;
  color: string;
  size: string;
}): string | null {
  if (input.jan) return `gtin:${input.jan}`;
  if (input.brand && input.modelKey) {
    return `bm:${input.brand}|${input.modelKey}|${input.color}|${input.size}`;
  }
  return null;
}
