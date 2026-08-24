import { config } from '../env';
import { SUPPLIER_CRITICAL_FIELDS } from '../types';
import type { SupplierListing } from '../types';

/**
 * 仕入先Provider（受け取り口）と仕入先Discovery Provider（自動探索）の
 * 両方が使う共通部品。
 *
 * ★ここに置く理由：supplier.ts と supplierDiscovery.ts が互いを読み合う
 *   （循環参照）のを避けるため。
 */

/** 外貨を円に直す。レートは .env（USD_JPY / CNY_JPY）。 */
export function toJpy(value: number, currency: string): number {
  const c = (currency || 'JPY').trim().toUpperCase();
  if (c === 'USD' || c === '$') return Math.round(value * config.usdJpy);
  if (c === 'CNY' || c === 'RMB' || c === '元') return Math.round(value * config.cnyJpy);
  return Math.round(value);
}

/**
 * 1件の仕入先データに「本物かどうか」の区分を付ける。
 *
 *   LIVE      … 実在の仕入先から取得。必須項目が全部そろっている
 *   ESTIMATED … 本物だが、画像・更新日時・MOQ・送料・在庫のどれかが取れていない
 *   UNKNOWN   … 仕入先名・商品名・URL・価格・通貨のどれかが欠けている
 *   MOCK      … サンプル（練習用）
 *
 * ★取れなかった項目は unknownFields に名前を残し、値は埋めない。
 */
export function applySupplierQuality(l: SupplierListing, fromRealSource: boolean): SupplierListing {
  const missing = l.unknownFields ?? [];
  const has = (k: string) => !missing.includes(k);

  if (!fromRealSource) {
    l.dataQuality = 'MOCK';
    l.dataQualityNote = 'サンプル（練習用）。実在の商品・実在の価格ではありません';
    return l;
  }

  // 仕入れ判断そのものが成立しない欠落
  const criticalMissing = SUPPLIER_CRITICAL_FIELDS.filter((k) => missing.includes(k));
  if (criticalMissing.length > 0) {
    l.dataQuality = 'UNKNOWN';
    l.dataQualityNote = `必須項目が取れていません：${criticalMissing.join(' / ')}`;
    return l;
  }

  // 価格・URL・通貨はそろっているが、判断の質を落とす欠落
  const weak: string[] = [];
  if (!has('image_url')) weak.push('画像');
  if (!has('updated_at')) weak.push('更新日時');
  if (!has('minimum_order_quantity')) weak.push('最小ロット');
  if (!has('shipping_cost')) weak.push('送料');
  if (!has('stock')) weak.push('在庫数');

  if (weak.length > 0) {
    l.dataQuality = 'ESTIMATED';
    // ★「推測で埋めた」と誤解されない書き方にする。取れなかった項目は不明のまま扱う。
    l.dataQualityNote = `本物の仕入先データですが、${weak.join('・')}が取れていません（この項目は不明のまま扱います）`;
    return l;
  }

  l.dataQuality = 'LIVE';
  l.dataQualityNote = '実在の仕入先から取得した本物のデータ';
  return l;
}
