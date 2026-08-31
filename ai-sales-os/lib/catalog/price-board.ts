/**
 * 「商品・価格設定」画面に出す表を作る。
 *
 * ★この画面が存在する理由。
 *   商品の値段が決まっていないと、予想売上も予想利益も出せない。
 *   出せないものを出せるように見せるために仮の数字を入れると、
 *   その仮の数字で会社の並び順が変わり、間違った会社へ営業しに行く。
 *   だから「値段を決めるのは人」「決まるまでは計算しない」を1画面にまとめる。
 *
 * ★ここは数字を作らない。人が入れた数字と、Obsidianに書いてある数字しか出さない。
 *   相場から埋めることは一度もしない。
 */
import { all } from '../db/client';
import { loadSettings, priceSettingKeys, costSettingKeys } from '../settings';
import { PRICE_STATUS_LABEL, type PriceStatus } from './definitions';
import {
  contractValueOf,
  grossProfitOf,
  hourlyProfitOf,
  profitUnsetReasonJa,
  resolveOfferPrice,
  type ResolvedPrice,
} from './pricing';

export type PriceBoardRow = {
  code: string;
  name: string;
  /** 商品の成熟度（SELLABLE / DEV / BLOCKED）と、その理由。 */
  status: string;
  statusReason: string | null;
  /** 段階商品なら LIGHT / STANDARD / CUSTOM。 */
  tier: string | null;
  priceModel: string;
  price: ResolvedPrice;
  priceStatusLabel: string;
  /** 標準価格（契約1本あたりの想定売上）。値段が未設定なら null。 */
  standardValue: number | null;
  /** 想定粗利。原価も割合も未設定なら null（0円にしない）。 */
  grossProfit: number | null;
  grossProfitUnsetReason: string;
  /** 想定時給。作業時間が未設定なら null。 */
  hourlyProfit: number | null;
  /** 人が入力する欄の設定キー。画面のフォームがそのまま使う。 */
  keys: { min: string; max: string; margin: string; costDirect: string; estHours: string };
  /** 人が実際に入れている値（空文字＝未入力）。 */
  input: { min: string; max: string; margin: string; costDirect: string; estHours: string };
  /** 最終更新日。人がまだ何も入れていなければ null。 */
  updatedAt: string | null;
};

function statusOrder(s: string): number {
  return s === 'SELLABLE' ? 0 : s === 'DEV' ? 1 : 2;
}

export async function priceBoard(): Promise<PriceBoardRow[]> {
  const settings = await loadSettings();
  const rows = await all(`SELECT * FROM offers ORDER BY code`);
  // 人が最後にその商品の欄を触った日時。settings 表の updated_at をそのまま使う。
  const touched = await all(
    `SELECT key, updated_at FROM settings WHERE key LIKE 'price.%' OR key LIKE 'cost.offer.%' OR key LIKE 'hours.offer.%'`,
  );
  const touchedAt = new Map<string, string>();
  for (const t of touched) touchedAt.set(String(t.key), String(t.updated_at ?? ''));

  const out: PriceBoardRow[] = [];
  for (const r of rows) {
    const code = String(r.code);
    const price = await resolveOfferPrice({
      code,
      name: String(r.name),
      price_model: r.price_model ?? null,
      price_min: r.price_min === null ? null : Number(r.price_min),
      price_max: r.price_max === null ? null : Number(r.price_max),
      gross_margin_rate: r.gross_margin_rate === null ? null : Number(r.gross_margin_rate),
      price_status: r.price_status ?? null,
      price_evidence: r.price_evidence ?? null,
    });

    const pk = priceSettingKeys(code);
    const ck = costSettingKeys(code);
    const keys = { min: pk.min, max: pk.max, margin: pk.margin, costDirect: ck.direct, estHours: ck.hours };
    const input = {
      min: String(settings.get(pk.min) ?? ''),
      max: String(settings.get(pk.max) ?? ''),
      margin: String(settings.get(pk.margin) ?? ''),
      costDirect: String(settings.get(ck.direct) ?? ''),
      estHours: String(settings.get(ck.hours) ?? ''),
    };
    // 「人が入れた欄」だけを最終更新日の対象にする。何も入れていなければ null。
    const stamps = Object.values(keys)
      .filter((k) => String(settings.get(k) ?? '').trim() !== '')
      .map((k) => touchedAt.get(k) ?? '')
      .filter((s) => s !== '');
    stamps.sort();

    out.push({
      code,
      name: String(r.name),
      status: String(r.status),
      statusReason: r.status_reason ? String(r.status_reason) : null,
      tier: r.tier ? String(r.tier) : null,
      priceModel: String(r.price_model ?? 'unknown'),
      price,
      priceStatusLabel: PRICE_STATUS_LABEL[price.priceStatus as PriceStatus],
      standardValue: contractValueOf(price),
      grossProfit: grossProfitOf(price),
      grossProfitUnsetReason: profitUnsetReasonJa(price),
      hourlyProfit: hourlyProfitOf(price),
      keys,
      input,
      updatedAt: stamps.length > 0 ? stamps[stamps.length - 1] : null,
    });
  }

  out.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.code.localeCompare(b.code));
  return out;
}

/**
 * 「値段を決めないと前に進めない商品」の数。
 * ★今すぐ売れる商品（SELLABLE）だけを数える。売らない商品の値段は決めなくてよい。
 */
export function unpricedSellableCount(rows: PriceBoardRow[]): number {
  return rows.filter((r) => r.status === 'SELLABLE' && r.price.source === 'UNSET').length;
}
