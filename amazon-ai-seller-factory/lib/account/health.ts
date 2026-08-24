import { all, insert, newId, nowIso, one } from '../db/client';
import { jstToday } from '../format';

/**
 * アカウント健全性（ACCOUNT_HEALTH）。
 *
 * ★ユーザー指定の絶対ルール：
 *   「Amazon API等から取れない項目は、人間入力でもよいです。」
 *   「閾値に近づいたら警告してください。」
 *   「広告や新規仕入れより、アカウント保護を最優先してください。」
 *
 * → アカウントが止まったら、利益も在庫も学習データも全部止まる。
 *   だからこの画面は管理画面の一番上に出す。
 * → 数字はセラーセントラルの「アカウント健全性」から人が転記する。
 *   自動では取れないので、取れないまま推測はしない。
 */

export type HealthLevel = 'ok' | 'warn' | 'danger' | 'unknown';

export interface HealthMetric {
  key: string;
  label: string;
  /** 実際の値（率は0-1、件数は整数） */
  value: number | null;
  /** 表示用 */
  display: string;
  /** Amazonの基準 */
  targetText: string;
  level: HealthLevel;
  message: string;
  /** true=小さいほど良い */
  lowerIsBetter: boolean;
}

export interface AccountHealthInput {
  measuredOn?: string;
  orderDefectRate?: number | null;
  lateShipmentRate?: number | null;
  preFulfillmentCancelRate?: number | null;
  validTrackingRate?: number | null;
  returnRate?: number | null;
  refundRate?: number | null;
  accountWarnings?: number | null;
  policyViolations?: number | null;
  ipComplaints?: number | null;
  note?: string | null;
  enteredBy?: string | null;
}

export interface AccountHealthResult {
  measuredOn: string | null;
  metrics: HealthMetric[];
  worst: HealthLevel;
  /** アカウント保護のため、いま仕入れ・広告を止めるべきか */
  freezeRecommended: boolean;
  headline: string;
  advice: string[];
  missing: string[];
  ageDays: number | null;
}

/** 率の指標：Amazonの基準値と、その8割で先に警告するライン */
interface RateSpec {
  key: string;
  column: string;
  label: string;
  limit: number;
  lowerIsBetter: boolean;
  targetText: string;
}

const RATE_SPECS: RateSpec[] = [
  {
    key: 'orderDefectRate',
    column: 'order_defect_rate',
    label: '注文不良率',
    limit: 0.01,
    lowerIsBetter: true,
    targetText: '1%未満（Amazonの基準）',
  },
  {
    key: 'lateShipmentRate',
    column: 'late_shipment_rate',
    label: '出荷遅延率',
    limit: 0.04,
    lowerIsBetter: true,
    targetText: '4%未満（Amazonの基準）',
  },
  {
    key: 'preFulfillmentCancelRate',
    column: 'pre_fulfillment_cancel_rate',
    label: '出荷前キャンセル率',
    limit: 0.025,
    lowerIsBetter: true,
    targetText: '2.5%未満（Amazonの基準）',
  },
  {
    key: 'validTrackingRate',
    column: 'valid_tracking_rate',
    label: '追跡可能率',
    limit: 0.95,
    lowerIsBetter: false,
    targetText: '95%以上（Amazonの基準）',
  },
  {
    key: 'returnRate',
    column: 'return_rate',
    label: '返品率',
    limit: 0.1,
    lowerIsBetter: true,
    targetText: '10%を目安（自社基準）',
  },
  {
    key: 'refundRate',
    column: 'refund_rate',
    label: '返金率',
    limit: 0.05,
    lowerIsBetter: true,
    targetText: '5%を目安（自社基準）',
  },
];

interface CountSpec {
  key: string;
  column: string;
  label: string;
  danger: number;
}

const COUNT_SPECS: CountSpec[] = [
  { key: 'accountWarnings', column: 'account_warnings', label: 'アカウント警告', danger: 1 },
  { key: 'policyViolations', column: 'policy_violations', label: 'ポリシー違反', danger: 1 },
  { key: 'ipComplaints', column: 'ip_complaints', label: '知的財産の申立て', danger: 1 },
];

function pctText(v: number | null): string {
  if (v == null) return '未入力';
  return `${(v * 100).toFixed(2)}%`;
}

function judgeRate(spec: RateSpec, v: number | null): { level: HealthLevel; message: string } {
  if (v == null) return { level: 'unknown', message: 'まだ入力されていません（推測はしません）' };
  if (spec.lowerIsBetter) {
    if (v >= spec.limit) {
      return { level: 'danger', message: `★基準（${pctText(spec.limit)}）を超えています。すぐ手を打ってください` };
    }
    if (v >= spec.limit * 0.8) {
      return { level: 'warn', message: `基準の8割に近づいています（基準は${pctText(spec.limit)}）` };
    }
    return { level: 'ok', message: '問題ありません' };
  }
  if (v < spec.limit) {
    return { level: 'danger', message: `★基準（${pctText(spec.limit)}）を下回っています。すぐ手を打ってください` };
  }
  if (v < spec.limit + 0.02) {
    return { level: 'warn', message: `基準ぎりぎりです（基準は${pctText(spec.limit)}）` };
  }
  return { level: 'ok', message: '問題ありません' };
}

export async function saveAccountHealth(
  input: AccountHealthInput,
): Promise<{ ok: boolean; message: string }> {
  const measuredOn = (input.measuredOn || jstToday()).slice(0, 10);
  await insert('account_health', {
    id: newId('ah'),
    measured_on: measuredOn,
    order_defect_rate: input.orderDefectRate ?? null,
    late_shipment_rate: input.lateShipmentRate ?? null,
    pre_fulfillment_cancel_rate: input.preFulfillmentCancelRate ?? null,
    valid_tracking_rate: input.validTrackingRate ?? null,
    return_rate: input.returnRate ?? null,
    refund_rate: input.refundRate ?? null,
    account_warnings: input.accountWarnings ?? null,
    policy_violations: input.policyViolations ?? null,
    ip_complaints: input.ipComplaints ?? null,
    note: input.note ?? null,
    source: 'human',
    entered_by: input.enteredBy ?? 'human',
    created_at: nowIso(),
  });
  const res = await accountHealth();
  return { ok: true, message: `${measuredOn}の数字を記録しました。${res.headline}` };
}

/** いちばん新しい記録から健全性を判定する */
export async function accountHealth(): Promise<AccountHealthResult> {
  const row = await one(`SELECT * FROM account_health ORDER BY measured_on DESC, created_at DESC LIMIT 1`);

  if (!row) {
    return {
      measuredOn: null,
      metrics: [
        ...RATE_SPECS.map((s) => ({
          key: s.key,
          label: s.label,
          value: null,
          display: '未入力',
          targetText: s.targetText,
          level: 'unknown' as HealthLevel,
          message: 'まだ一度も入力されていません',
          lowerIsBetter: s.lowerIsBetter,
        })),
        ...COUNT_SPECS.map((s) => ({
          key: s.key,
          label: s.label,
          value: null,
          display: '未入力',
          targetText: '0件が正常',
          level: 'unknown' as HealthLevel,
          message: 'まだ一度も入力されていません',
          lowerIsBetter: true,
        })),
      ],
      worst: 'unknown',
      freezeRecommended: false,
      headline: 'アカウント健全性がまだ一度も記録されていません',
      advice: [
        'セラーセントラルの「アカウント健全性」を開き、数字をこの画面に転記してください',
        '週に1回で構いません。ここが赤くなったら、仕入れも広告も止めるのが最優先です',
      ],
      missing: [...RATE_SPECS.map((s) => s.label), ...COUNT_SPECS.map((s) => s.label)],
      ageDays: null,
    };
  }

  const metrics: HealthMetric[] = [];
  const missing: string[] = [];
  const advice: string[] = [];

  for (const s of RATE_SPECS) {
    const raw = row[s.column];
    const v = raw == null ? null : Number(raw);
    const j = judgeRate(s, v);
    if (v == null) missing.push(s.label);
    metrics.push({
      key: s.key,
      label: s.label,
      value: v,
      display: pctText(v),
      targetText: s.targetText,
      level: j.level,
      message: j.message,
      lowerIsBetter: s.lowerIsBetter,
    });
  }

  for (const s of COUNT_SPECS) {
    const raw = row[s.column];
    const v = raw == null ? null : Number(raw);
    if (v == null) missing.push(s.label);
    const level: HealthLevel = v == null ? 'unknown' : v >= s.danger ? 'danger' : 'ok';
    metrics.push({
      key: s.key,
      label: s.label,
      value: v,
      display: v == null ? '未入力' : `${v}件`,
      targetText: '0件が正常',
      level,
      message:
        v == null
          ? 'まだ入力されていません'
          : v >= s.danger
            ? '★出品停止につながります。ほかの何よりも先に対応してください'
            : '問題ありません',
      lowerIsBetter: true,
    });
  }

  const hasDanger = metrics.some((m) => m.level === 'danger');
  const hasWarn = metrics.some((m) => m.level === 'warn');
  const worst: HealthLevel = hasDanger ? 'danger' : hasWarn ? 'warn' : metrics.every((m) => m.level === 'unknown') ? 'unknown' : 'ok';

  const measuredOn = String(row.measured_on);
  // ★日本時間どうしで引き算する（世界標準時と混ぜると1日ずれる）
  const t = Date.parse(`${measuredOn}T00:00:00.000Z`);
  const nowT = Date.parse(`${jstToday()}T00:00:00.000Z`);
  const ageDays = Number.isFinite(t) ? Math.max(0, Math.round((nowT - t) / 86_400_000)) : null;

  let headline: string;
  if (hasDanger) {
    const bad = metrics.filter((m) => m.level === 'danger').map((m) => m.label);
    headline = `★アカウントが危険な状態です（${bad.join('・')}）。新しい仕入れと広告より先に、ここを直してください`;
    advice.push('新規の仕入れ承認と広告の増額を止める');
    advice.push('該当する注文・出品を確認し、Amazonへの改善計画を出す');
  } else if (hasWarn) {
    const w = metrics.filter((m) => m.level === 'warn').map((m) => m.label);
    headline = `基準に近づいている項目があります（${w.join('・')}）。いまのうちに直せば止まりません`;
    advice.push('出荷の遅れ・追跡番号の入力漏れがないかを先に確認する');
  } else if (worst === 'unknown') {
    headline = 'アカウント健全性の数字がほとんど入っていません';
    advice.push('セラーセントラルから数字を転記してください');
  } else {
    headline = 'アカウントは健全です。このまま維持してください';
  }

  if (ageDays != null && ageDays >= 14) {
    advice.push(`★この数字は${ageDays}日前のものです。古い数字で安心しないでください`);
  }
  if (missing.length) {
    advice.push(`未入力：${missing.join('・')}（推測では埋めません）`);
  }

  return {
    measuredOn,
    metrics,
    worst,
    freezeRecommended: hasDanger,
    headline,
    advice,
    missing,
    ageDays,
  };
}

export async function accountHealthHistory(limit = 12) {
  return all(`SELECT * FROM account_health ORDER BY measured_on DESC, created_at DESC LIMIT ?`, [limit]);
}
