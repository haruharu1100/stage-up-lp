import { all, batch, nowIso } from './db/client';

/**
 * 手数料の「状態」（Phase 3.5・§1 §2 §3）。
 *
 * 【なぜ0/1では足りないのか】
 * Phase 3 までは is_estimated が 0 か 1 かだけだった。
 * これだと次の2つを区別できない。
 *
 *   ・去年公式ページで確認した10%（その後、料金改定があったかもしれない）
 *   ・今週公式ページで確認した10%
 *
 * どちらも is_estimated=0 になり、同じ「確認済み」の顔をしてしまう。
 * 手数料は利益額そのものを動かすので、ここを曖昧にすると全部の判断が狂う。
 *
 * 【4つの状態】
 *   VERIFIED  … 出典があり、確認日があり、有効期間内で、確認から1年以内
 *   ESTIMATED … 概算。計算はしてよいが STRONG BUY へは上げない
 *   OUTDATED  … かつて確認したが、有効期限が切れた／確認から1年以上経った
 *   UNKNOWN   … 出典も確認日も無い。何も分かっていない
 *
 * 【過去は書き換えない】
 * 状態が変わっても、過去のRouteやSHADOWを新しい手数料で計算し直さない。
 * 判断時点の fee_version を持っているので、当時の利益見込みはそのまま残る（ルール24）。
 */

export type FeeStatus = 'VERIFIED' | 'ESTIMATED' | 'OUTDATED' | 'UNKNOWN';

/**
 * 【Phase 3.6 で足した考え方】手数料は「行まるごと確認済み」にできない。
 *
 * メルカリを例にすると、同じ1行の中に性質の違う2種類が同居している。
 *
 *   販売手数料 10%   … メルカリが決めている。公式の料金ページに書いてある。**確認できる**
 *   送料 800円       … 商品の大きさ・重さ・発送方法で変わる。**メルカリが決めた固定額ではない**
 *   梱包費 150円     … こちらの都合。相手は関係ない
 *
 * 行ごと「確認済み」にすると、確認していない送料800円まで確認済みの顔をしてしまう。
 * ユーザー指示「送料等は商品・発送方法で異なるため、一律固定値として勝手に確定しないでください」に反する。
 *
 * だから項目を2種類に分け、**確認した項目名を1つずつ記録する**（`verified_fields`）。
 */

/** 市場が決める料金。公式の料金ページ・契約書で「確認できる」種類。 */
export const VENUE_RATE_FIELDS = [
  'fee_rate', 'payment_fee_rate', 'currency_fee_rate', 'tax_rate',
  'import_duty_rate', 'advertising_fee_rate', 'fixed_fee', 'authentication_fee',
] as const;

/**
 * 商品・発送方法・こちらの都合で変わる実費。
 * 市場に聞いても「一律いくら」という答えは無いので、原則ずっと推定値のまま。
 * ここが推定でも VERIFIED は名乗れるが、**推定であることを必ず画面に出す**。
 */
export const ITEM_COST_FIELDS = [
  'shipping_cost', 'packing_cost', 'warehouse_cost',
  'return_loss_fixed', 'return_loss_rate', 'other_cost',
] as const;

export const FEE_FIELD_JA: Record<string, string> = {
  fee_rate: '販売手数料率', payment_fee_rate: '決済手数料率', currency_fee_rate: '為替手数料率',
  tax_rate: '税率', import_duty_rate: '関税率', advertising_fee_rate: '広告費率',
  fixed_fee: '固定手数料', authentication_fee: '鑑定料',
  shipping_cost: '送料', packing_cost: '梱包費', warehouse_cost: '保管費',
  return_loss_fixed: '返品損失（定額）', return_loss_rate: '返品損失率', other_cost: 'その他費用',
};

export function parseVerifiedFields(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 「市場が決める料金」のうち、金額に効いているのに未確認のものを挙げる。
 *
 * 【0円の項目も見る】
 * 「決済手数料0円」は、本当に0円なのか、まだ調べていないだけなのか区別できない。
 * 0のまま未確認なら費用を少なく見積もっている＝利益を多く見せている可能性がある。
 * ただし全項目を必須にすると現実に確認できないので、
 * **0でない項目は必ず確認を要求し、0の項目は「未確認の0」として別に報告する**。
 */
export function unverifiedRateFields(
  f: Record<string, unknown>, verified: string[],
): { blocking: string[]; zeroUnchecked: string[] } {
  const blocking: string[] = [];
  const zeroUnchecked: string[] = [];
  for (const k of VENUE_RATE_FIELDS) {
    if (verified.includes(k)) continue;
    if (Number(f[k] ?? 0) !== 0) blocking.push(k);
    else zeroUnchecked.push(k);
  }
  return { blocking, zeroUnchecked };
}

/** 実費のうち、金額に効いているのに未確認のもの。VERIFIED は止めないが、必ず表に出す。 */
export function estimatedCostFields(f: Record<string, unknown>, verified: string[]): string[] {
  return ITEM_COST_FIELDS.filter((k) => !verified.includes(k) && Number(f[k] ?? 0) !== 0);
}

export const FEE_STATUS_JA: Record<FeeStatus, string> = {
  VERIFIED: '確認済み（実額）',
  ESTIMATED: '概算（未確認）',
  OUTDATED: '確認が古い・期限切れ',
  UNKNOWN: '出典なし（不明）',
};

/** 確認からこれ以上経っていたら「確認済み」と言い切らない。 */
export const VERIFIED_MAX_AGE_DAYS = 365;

export type FeeStatusInput = {
  is_estimated?: number | null;
  source_url?: string | null;
  source_name?: string | null;
  source_type?: string | null;
  verified_at?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  /** 確認できた項目名のJSON配列。無ければ「1項目も確認していない」扱い（Fail Closed）。 */
  verified_fields?: string | null;
  /** 項目ごとの金額。未確認の項目を見つけるために読む。 */
  [k: string]: unknown;
};

export type FeeStatusResult = {
  status: FeeStatus;
  /** なぜその状態なのかを日本語で。画面にそのまま出す。 */
  note: string;
  /** 確認からの経過日数。分からなければ null。 */
  verifiedAgeDays: number | null;
  /** 確認できた項目（市場が決める料金）。 */
  verifiedFields: string[];
  /** 金額に効いているのに未確認の「実費」。VERIFIED でもここは推定のまま。 */
  estimatedCosts: string[];
};

/**
 * 手数料1件の状態を決める。
 *
 * 【推測で VERIFIED にしない】
 * 「たぶん公式の数字だろう」は VERIFIED ではない。
 * 出典と確認日の両方が揃っているものだけを確認済みと呼ぶ。
 */
export function deriveFeeStatus(f: FeeStatusInput, now = Date.now()): FeeStatusResult {
  const hasSource = Boolean((f.source_url ?? '') || (f.source_name ?? ''));
  const verifiedAt = f.verified_at ? Date.parse(f.verified_at) : NaN;
  const hasVerifiedAt = Number.isFinite(verifiedAt);
  const verifiedAgeDays = hasVerifiedAt ? Math.max(0, (now - verifiedAt) / 86400000) : null;
  const verifiedFields = parseVerifiedFields(f.verified_fields);
  const estimatedCosts = estimatedCostFields(f, verifiedFields);
  const base = { verifiedAgeDays, verifiedFields, estimatedCosts };

  // 有効期限が切れているものは、確認済みかどうか以前に「今の料金ではない」。
  if (f.effective_to) {
    const to = Date.parse(f.effective_to);
    if (Number.isFinite(to) && to <= now) {
      return {
        ...base,
        status: 'OUTDATED',
        note: `有効期限（${f.effective_to.slice(0, 10)}）を過ぎている。現在の料金として使えない`,
      };
    }
  }

  // 概算はここで確定。出典があってもなくても概算は概算。
  if (Number(f.is_estimated ?? 1) === 1) {
    return {
      ...base,
      status: 'ESTIMATED',
      note: hasSource
        ? '概算。出典はあるが、実額として確認が取れていない'
        : '概算。出典が登録されていない',
    };
  }

  // ここから下は is_estimated=0（実額のつもり）。裏付けを確かめる。
  if (!hasSource && !hasVerifiedAt) {
    return { ...base, status: 'UNKNOWN', note: '実額とされているが、出典も確認日も無い。裏付けが取れない' };
  }
  if (!hasSource) {
    return { ...base, status: 'UNKNOWN', note: '確認日はあるが、出典（料金ページ・契約書など）が無い' };
  }
  if (!hasVerifiedAt) {
    return { ...base, status: 'UNKNOWN', note: '出典はあるが、いつ確認したのかが分からない' };
  }
  if (verifiedAgeDays !== null && verifiedAgeDays > VERIFIED_MAX_AGE_DAYS) {
    return {
      ...base,
      status: 'OUTDATED',
      note: `最後に確認したのが${Math.round(verifiedAgeDays)}日前。料金改定があった可能性があるため確認済みとしない`,
    };
  }

  // 【Phase 3.6】ここが新しい関門。
  // 出典と確認日が揃っていても、金額に効いている「市場が決める料金」に
  // 1つでも未確認が残っていたら確認済みとは呼ばない（Fail Closed）。
  const { blocking, zeroUnchecked } = unverifiedRateFields(f, verifiedFields);
  if (blocking.length > 0) {
    return {
      ...base,
      status: 'ESTIMATED',
      note: `出典はあるが、金額に効く項目が未確認のまま：${blocking.map((k) => FEE_FIELD_JA[k] ?? k).join('・')}`,
    };
  }

  const parts = [`出典と確認日が揃っている（${Math.round(verifiedAgeDays ?? 0)}日前に確認）`];
  parts.push(`確認した項目：${verifiedFields.map((k) => FEE_FIELD_JA[k] ?? k).join('・') || 'なし'}`);
  // VERIFIED でも、実費が推定のままなら必ず併記する。黙って確認済みの顔をさせない。
  if (estimatedCosts.length > 0) {
    parts.push(
      `ただし ${estimatedCosts.map((k) => FEE_FIELD_JA[k] ?? k).join('・')} は`
      + '商品・発送方法で変わるため推定値のまま（一律固定していない）',
    );
  }
  if (zeroUnchecked.length > 0) {
    parts.push(`未確認だが0円として計算している項目：${zeroUnchecked.map((k) => FEE_FIELD_JA[k] ?? k).join('・')}`);
  }

  return { ...base, status: 'VERIFIED', note: parts.join('。') };
}

/**
 * 手数料の状態による信頼度の天井（§2）。
 *
 * 【「計算はしてよいが、STRONG BUY にはしない」を数字で表す】
 * ユーザー指示：VERIFIED以外は FULL CONFIDENCE にしない。
 * STRONG BUY に必要なデータ信頼度の既定は65点なので、
 * VERIFIED以外の天井をそれ未満に置けば、利益額がいくら大きくても届かない。
 *
 * OUTDATED をここで止めるのが Phase 3.5 の追加点。
 * Phase 3 までは is_estimated=0 なら75点以上に行けたので、
 * 5年前に確認した料金でも STRONG BUY になり得た。
 */
export const FEE_CONFIDENCE_CAP: Record<FeeStatus, number> = {
  VERIFIED: 100,
  ESTIMATED: 50,
  OUTDATED: 45,
  UNKNOWN: 25,
};

/**
 * 【Phase 3.6】確認済みでも、実費（送料・梱包費など）が推定のままなら満点にしない。
 *
 * メルカリで言えば「販売手数料10%は確認できた。でも送料800円はこちらの当て推量」という状態。
 * 手数料率が確認できたことは前進なので ESTIMATED（50点）には留め置かない。
 * かといって、確認していない送料を含んだまま100点は名乗らせない。
 *
 * 85点にした理由：STRONG BUY に必要なデータ信頼度は65点なので、
 * 「手数料率が確認できていれば STRONG BUY の候補にはなる」が、満点にはならない位置。
 * **この数字を下げる方向（＝通しやすくする方向）へ動かさないこと。**
 */
export const FEE_CONFIDENCE_CAP_COST_ESTIMATED = 85;

export function capFeeConfidence(
  raw: number, status: FeeStatus, estimatedCostCount = 0,
): number {
  const cap = status === 'VERIFIED' && estimatedCostCount > 0
    ? Math.min(FEE_CONFIDENCE_CAP.VERIFIED, FEE_CONFIDENCE_CAP_COST_ESTIMATED)
    : FEE_CONFIDENCE_CAP[status];
  return Math.min(raw, cap);
}

/**
 * 全手数料の状態を計算し直して保存する。
 * 状態は「今の日付から見てどうか」で変わるので、毎回計算して書き直す。
 * ここで書き換わるのは状態の表示だけで、料率そのものには一切触らない。
 */
export async function syncFeeStatuses(now = Date.now()): Promise<Record<FeeStatus, number>> {
  // 項目ごとの確認状況を見るので、金額の列もまとめて読む（`SELECT *`）。
  // 列を書き並べると、項目が増えたときに読み忘れて「未確認なのに確認済み」になる。
  const rows = await all('SELECT * FROM venue_fee_profiles');
  const counts: Record<FeeStatus, number> = { VERIFIED: 0, ESTIMATED: 0, OUTDATED: 0, UNKNOWN: 0 };
  const t = nowIso();
  const stmts = rows.map((r) => {
    const d = deriveFeeStatus(r as FeeStatusInput, now);
    counts[d.status]++;
    return {
      sql: 'UPDATE venue_fee_profiles SET fee_status = ?, status_note = ?, updated_at = ? WHERE id = ?',
      args: [d.status, d.note, t, r.id],
    };
  });
  for (let i = 0; i < stmts.length; i += 300) await batch(stmts.slice(i, i + 300));
  return counts;
}

export type FeeStatusCoverage = {
  total: number;
  verified: number;
  estimated: number;
  outdated: number;
  unknown: number;
  /** VERIFIED の割合（0〜1）。Phase 4 の卒業条件で使う。 */
  verifiedRatio: number;
  rows: {
    venue_code: string;
    side: string;
    category_key: string;
    fee_status: FeeStatus;
    status_note: string | null;
    source_name: string | null;
    source_url: string | null;
    verified_at: string | null;
    fee_version: string | null;
  }[];
};

/** 画面と卒業条件の両方で使う集計。 */
export async function feeStatusCoverage(): Promise<FeeStatusCoverage> {
  const rows = await all(
    `SELECT venue_code, side, category_key, fee_status, status_note, source_name, source_url, verified_at, fee_version
       FROM venue_fee_profiles ORDER BY venue_code, side, category_key`,
  );
  const n = (s: FeeStatus) => rows.filter((r) => String(r.fee_status) === s).length;
  const verified = n('VERIFIED');
  return {
    total: rows.length,
    verified,
    estimated: n('ESTIMATED'),
    outdated: n('OUTDATED'),
    unknown: n('UNKNOWN'),
    verifiedRatio: rows.length === 0 ? 0 : verified / rows.length,
    rows: rows.map((r) => ({
      venue_code: String(r.venue_code),
      side: String(r.side),
      category_key: String(r.category_key),
      fee_status: (String(r.fee_status) as FeeStatus) || 'UNKNOWN',
      status_note: r.status_note === null || r.status_note === undefined ? null : String(r.status_note),
      source_name: r.source_name === null || r.source_name === undefined ? null : String(r.source_name),
      source_url: r.source_url === null || r.source_url === undefined ? null : String(r.source_url),
      verified_at: r.verified_at === null || r.verified_at === undefined ? null : String(r.verified_at),
      fee_version: r.fee_version === null || r.fee_version === undefined ? null : String(r.fee_version),
    })),
  };
}

/**
 * 実市場SHADOWが実際に使った手数料が、すべて確認済みかどうか（§20の補強）。
 *
 * 【なぜ全体の割合だけでは足りないのか】
 * 「手数料の90%が確認済み」でも、残り10%が
 * ちょうど実取引で使う市場だったら意味がない。
 * 実際に使われた組み合わせが確認済みかを別に見る。
 */
export async function feeStatusOfUsedRoutes(): Promise<{
  usedPairs: number;
  verifiedPairs: number;
  ratio: number;
  unverified: { venue_code: string; side: string; fee_status: string }[];
}> {
  const rows = await all(`
    SELECT DISTINCT v.venue_code, v.side, v.fee_status
      FROM venue_fee_profiles v
     WHERE (v.side = 'BUY'  AND v.venue_code IN (SELECT DISTINCT buy_venue_code  FROM route_shadow_trades WHERE real_market_data = 1))
        OR (v.side = 'SELL' AND v.venue_code IN (SELECT DISTINCT sell_venue_code FROM route_shadow_trades WHERE real_market_data = 1))
  `);
  const verified = rows.filter((r) => String(r.fee_status) === 'VERIFIED');
  return {
    usedPairs: rows.length,
    verifiedPairs: verified.length,
    ratio: rows.length === 0 ? 0 : verified.length / rows.length,
    unverified: rows
      .filter((r) => String(r.fee_status) !== 'VERIFIED')
      .map((r) => ({ venue_code: String(r.venue_code), side: String(r.side), fee_status: String(r.fee_status) })),
  };
}
