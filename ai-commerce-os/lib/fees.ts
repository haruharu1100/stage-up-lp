import { all, nowIso, run } from './db/client';
import type { FeeProfile } from './route';

/**
 * 手数料データの管理（Phase 3・§10 §11）。
 *
 * 【なぜ「版」が要るのか】
 * 手数料は変わる。変わったあとの料金で過去の利益を計算し直すと、
 * 「当時いくらの利益を見込んで買うと判断したのか」が消えてしまい、答え合わせが嘘になる。
 * だから判断した瞬間の版（fee_version）を Route と SHADOW に焼き付け、
 * 検証のときはその版の料金で計算する。
 *
 * 【版は内容から決める】
 * 手動で番号を振ると付け忘れる。金額に影響する項目だけを並べてハッシュにする。
 * 出典URLや備考を直しただけでは版は変わらない（利益額が変わらないから）。
 */

/** 金額に影響する項目だけ。ここに無いものを足しても版は変わらない。 */
const MONEY_FIELDS: (keyof FeeProfile)[] = [
  'fee_rate', 'payment_fee_rate', 'currency_fee_rate', 'tax_rate', 'import_duty_rate',
  'advertising_fee_rate', 'return_loss_rate', 'fixed_fee', 'shipping_cost',
  'authentication_fee', 'packing_cost', 'warehouse_cost', 'return_loss_fixed', 'other_cost',
];

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/**
 * 手数料の版。
 * 概算か実額かも含める。同じ数字でも「概算の10%」と「公式確認済みの10%」は別物として扱う。
 */
export function feeVersionOf(f: Record<string, unknown>): string {
  const sig = MONEY_FIELDS.map((k) => Number(f[k as string] ?? 0)).join('|');
  const est = Number(f.is_estimated ?? 1) === 1 ? 'E' : 'V';
  return `f${est}-${hash(sig)}`;
}

export type FeeChange = {
  venueCode: string;
  side: string;
  categoryKey: string;
  oldVersion: string | null;
  newVersion: string;
  changedFields: string[];
};

/**
 * 全手数料の版を計算し直す。変わっていたら履歴へ残す。
 *
 * 【消さない・上書きしない】
 * 変更検知は「気づく」ためのもの。過去の Route を書き換えない。
 * 古い版で作られた判断は、その版のまま残す。
 */
export async function syncFeeVersions(): Promise<FeeChange[]> {
  const rows = await all('SELECT * FROM venue_fee_profiles');
  const now = nowIso();
  const changes: FeeChange[] = [];

  for (const r of rows) {
    const next = feeVersionOf(r as Record<string, unknown>);
    const prev = r.fee_version === null || r.fee_version === undefined ? null : String(r.fee_version);
    if (prev === next) continue;

    const nowValues = moneyValues(r as Record<string, unknown>);
    await run('UPDATE venue_fee_profiles SET fee_version = ?, updated_at = ? WHERE id = ?', [next, now, r.id]);

    // 初回（prev が無い）は「変更」ではなく版の付与。履歴には残さない。
    if (prev === null) continue;

    // 何が動いたのかを項目名で残す。「変わった」だけでは原因を追えない。
    // 前回の値は履歴のJSONから復元する（プロフィール行は上書きされてしまうため）。
    const last = await all(
      `SELECT changed_fields FROM fee_change_log
        WHERE venue_code = ? AND side = ? AND category_key = ? ORDER BY id DESC LIMIT 1`,
      [r.venue_code, r.side, r.category_key],
    );
    const before = parseValues(last[0]?.changed_fields);
    const changed = before
      ? MONEY_FIELDS.map(String).filter((k) => before[k] !== nowValues[k])
      : [];

    await run(
      `INSERT INTO fee_change_log
        (venue_code, side, category_key, old_fee_version, new_fee_version, changed_fields, source_type, detected_at, note)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        r.venue_code, r.side, r.category_key, prev, next,
        JSON.stringify({ fields: changed, values: nowValues }),
        r.source_type ?? 'ESTIMATE', now,
        '手数料が変わった。過去のRouteは旧版のまま残す（当時の判断を書き換えない）。',
      ],
    );
    changes.push({
      venueCode: String(r.venue_code), side: String(r.side), categoryKey: String(r.category_key),
      oldVersion: prev, newVersion: next, changedFields: changed,
    });
  }
  return changes;
}

function moneyValues(f: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of MONEY_FIELDS) out[String(k)] = Number(f[k as string] ?? 0);
  return out;
}

function parseValues(raw: unknown): Record<string, number> | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const j = JSON.parse(raw);
    return j && typeof j === 'object' && j.values ? (j.values as Record<string, number>) : null;
  } catch {
    return null;
  }
}

/** 手数料の出どころ。公式確認できていないものは画面で目立たせる。 */
export const FEE_SOURCE_JA: Record<string, string> = {
  ESTIMATE: '概算（未確認）',
  OFFICIAL_PAGE: '公式の料金ページ',
  CONTRACT: '契約書',
  API: 'APIから取得',
  INVOICE: '請求書の実額',
};

/**
 * 概算のままかどうか。ここが true の間は自動購入を許さない（CLAUDE.md ルール）。
 * Phase 3 ではそもそも購入しないが、判定の天井（STRONG BUY にしない）に効く。
 */
export function isFeeEstimated(f: Pick<FeeProfile, 'is_estimated'>): boolean {
  return Number(f.is_estimated ?? 1) === 1;
}

export type FeeCoverage = {
  total: number;
  estimated: number;
  verified: number;
  withSourceUrl: number;
  byVenue: { venue_code: string; side: string; is_estimated: number; source_type: string | null }[];
};

/** 画面用。どれだけ「まだ概算」なのかを一目で出すための集計。 */
export async function feeCoverage(): Promise<FeeCoverage> {
  const rows = await all(
    `SELECT venue_code, side, is_estimated, source_type, source_url FROM venue_fee_profiles ORDER BY venue_code, side`,
  );
  const est = rows.filter((r) => Number(r.is_estimated) === 1).length;
  return {
    total: rows.length,
    estimated: est,
    verified: rows.length - est,
    withSourceUrl: rows.filter((r) => r.source_url).length,
    byVenue: rows.map((r) => ({
      venue_code: String(r.venue_code), side: String(r.side),
      is_estimated: Number(r.is_estimated),
      source_type: r.source_type === null || r.source_type === undefined ? null : String(r.source_type),
    })),
  };
}
