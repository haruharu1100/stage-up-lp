/**
 * 1日に営業してよい件数と、同じ会社へ次に触れてよくなるまでの日数。
 *
 * ★なぜ「未設定＝無制限」にしないか。
 *   上限が決まっていない状態は「上限を超えていない」とは言えない。
 *   言えないものを「大丈夫」として通すと、事故が起きたときに何件出たか分からない。
 *   だから未設定は BLOCK として扱う。
 *
 * ★なぜ初期値を勝手に大きくしないか。
 *   最初の1日で100件出して全部が的外れだった、という失敗は取り返せない。
 *   人が「今日は何件まで」と決めて初めて、外へ出す話が始まる。
 *
 * ★全体の上限と、手段ごとの上限を別に持つ理由。
 *   電話は相手の時間を奪う。メールは相手の受信箱に残る。フォームは相手の窓口を埋める。
 *   1件あたりの重さが違うのに、1つの数字でまとめると、
 *   「今日はメールを50件出したので電話の枠が無い」といった、意味のない止まり方をする。
 */
import { loadSettings } from '../settings';
import { one, nowIso } from '../db/client';
import type { Channel } from './channel';

/**
 * 同じ会社に次に触れてよくなるまでの日数（もとから決まっている下限）。
 *
 * ★この数字はここに置く。以前は guards.ts にあったが、
 *   guards.ts がこのファイルの上限判定を使うようになったため、
 *   置いたままだと2つのファイルが互いを読み合う形になる。
 *   「日数・件数の決まりごと」はこのファイルに集める。
 */
export const REAPPROACH_DAYS = 90;

export const DAILY_LIMIT_KEYS = {
  all: 'exec.daily_limit',
  PHONE: 'exec.daily_limit.call',
  EMAIL: 'exec.daily_limit.email',
  FORM: 'exec.daily_limit.form',
} as const;

export const COOLDOWN_KEY = 'exec.cooldown_days';

/** 設定値を「正の整数」としてだけ読む。空欄・0・文字は未設定（null）として返す。 */
function positiveIntOrNull(raw: unknown): number | null {
  const v = String(raw ?? '').trim();
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export type DailyLimits = {
  /** 全体の上限。未設定なら null（＝LIVE実行不可）。 */
  all: number | null;
  /** 手段ごとの上限。未設定なら null（＝その手段のLIVE実行不可）。 */
  PHONE: number | null;
  EMAIL: number | null;
  FORM: number | null;
};

export async function dailyLimits(): Promise<DailyLimits> {
  const s = await loadSettings();
  return {
    all: positiveIntOrNull(s.get(DAILY_LIMIT_KEYS.all)),
    PHONE: positiveIntOrNull(s.get(DAILY_LIMIT_KEYS.PHONE)),
    EMAIL: positiveIntOrNull(s.get(DAILY_LIMIT_KEYS.EMAIL)),
    FORM: positiveIntOrNull(s.get(DAILY_LIMIT_KEYS.FORM)),
  };
}

/**
 * 同じ会社へ次に触れてよくなるまでの日数。
 *
 * ★この欄で 90日より短くはできない。
 *   90日は、このシステムがずっと守ってきた「同じ会社へ短期間に何度も営業しない」という約束。
 *   設定でこれを短くできるようにすると、数字を良く見せたいときに約束の側を下げられてしまう。
 *   だから設定で「もっと長くする」ことだけを許し、短くする方向には効かせない。
 */
export async function cooldownDays(): Promise<{ days: number; source: 'SETTING' | 'BUILT_IN'; noteJa: string }> {
  const s = await loadSettings();
  const n = positiveIntOrNull(s.get(COOLDOWN_KEY));
  if (n === null) {
    return { days: REAPPROACH_DAYS, source: 'BUILT_IN', noteJa: `未設定なので、もとからの${REAPPROACH_DAYS}日を使う。` };
  }
  if (n <= REAPPROACH_DAYS) {
    return {
      days: REAPPROACH_DAYS,
      source: 'BUILT_IN',
      noteJa: `設定は${n}日だが、もとからの${REAPPROACH_DAYS}日より短くはできないので${REAPPROACH_DAYS}日を使う。`,
    };
  }
  return { days: n, source: 'SETTING', noteJa: `設定した${n}日を使う（もとからの${REAPPROACH_DAYS}日より長い）。` };
}

/**
 * 今日すでに「実際に外へ出した」件数。全体と手段ごとの両方。
 * ★DRY RUN は数えない。外へ出ていないものを上限の消費として数えると、
 *   本当に出せる枠が実際より少なく見え、人が上限を上げたくなる。
 */
export async function todayExecuted(): Promise<{ all: number; PHONE: number; EMAIL: number; FORM: number }> {
  const today = nowIso().slice(0, 10);
  const count = async (where: string, args: unknown[]) => {
    const r = await one(
      `SELECT COUNT(*) AS n FROM outreach_executions WHERE executed = 1 AND substr(executed_at, 1, 10) = ?${where}`,
      [today, ...args],
    );
    return Number(r?.n ?? 0);
  };
  return {
    all: await count('', []),
    PHONE: await count(' AND action = ?', ['CALL']),
    EMAIL: await count(' AND action = ?', ['EMAIL']),
    FORM: await count(' AND action = ?', ['FORM']),
  };
}

export type LimitCheck = { ok: boolean; code: string; detailJa: string };

/**
 * その手段で、今日あと1件出してよいか。
 * ★全体の上限と手段ごとの上限の「両方」が決まっていて、両方とも余っているときだけ ok。
 *   片方でも未設定なら ok にしない（未設定を「余っている」とは数えない）。
 */
export async function checkDailyLimit(channel: Channel): Promise<LimitCheck> {
  if (channel !== 'PHONE' && channel !== 'EMAIL' && channel !== 'FORM') {
    return { ok: false, code: 'DAILY_LIMIT', detailJa: `外へ出す手段ではない（${channel}）。` };
  }
  const limits = await dailyLimits();
  const used = await todayExecuted();
  const chLabel = channel === 'PHONE' ? '電話' : channel === 'EMAIL' ? 'メール' : 'フォーム';

  if (limits.all === null) {
    return { ok: false, code: 'DAILY_LIMIT_ALL_UNSET', detailJa: '1日の上限（全体）が未設定。上限が無い状態を「超えていない」とは数えない。' };
  }
  if (limits[channel] === null) {
    return { ok: false, code: 'DAILY_LIMIT_CHANNEL_UNSET', detailJa: `1日の上限（${chLabel}）が未設定。手段ごとの上限も決めるまで外へは出さない。` };
  }
  if (used.all >= limits.all) {
    return { ok: false, code: 'DAILY_LIMIT_ALL_EXCEEDED', detailJa: `今日はすでに全体で${used.all}件（上限${limits.all}件）。` };
  }
  if (used[channel] >= (limits[channel] as number)) {
    return { ok: false, code: 'DAILY_LIMIT_CHANNEL_EXCEEDED', detailJa: `今日はすでに${chLabel}で${used[channel]}件（上限${limits[channel]}件）。` };
  }
  return {
    ok: true,
    code: 'DAILY_LIMIT',
    detailJa: `全体 ${used.all}/${limits.all}件、${chLabel} ${used[channel]}/${limits[channel]}件。あと出せる。`,
  };
}

/** 人にそのまま見せる、上限の設定状態。 */
export async function dailyLimitSummary(): Promise<{ ready: boolean; rows: { label: string; key: string; value: string; ja: string }[] }> {
  const l = await dailyLimits();
  const cd = await cooldownDays();
  const fmt = (n: number | null) => (n === null ? '未設定' : `${n}件`);
  const rows = [
    { label: '1日の上限（全体）', key: DAILY_LIMIT_KEYS.all, value: fmt(l.all), ja: l.all === null ? '未設定のあいだ、外への実行はすべて止まります。' : `1日に合計${l.all}件まで。` },
    { label: '1日の上限（電話）', key: DAILY_LIMIT_KEYS.PHONE, value: fmt(l.PHONE), ja: l.PHONE === null ? '未設定のあいだ、電話の実行は止まります。' : `電話は1日${l.PHONE}件まで。` },
    { label: '1日の上限（メール）', key: DAILY_LIMIT_KEYS.EMAIL, value: fmt(l.EMAIL), ja: l.EMAIL === null ? '未設定のあいだ、メールの実行は止まります。' : `メールは1日${l.EMAIL}件まで。` },
    { label: '1日の上限（フォーム）', key: DAILY_LIMIT_KEYS.FORM, value: fmt(l.FORM), ja: l.FORM === null ? '未設定のあいだ、フォームの実行は止まります。' : `フォームは1日${l.FORM}件まで。` },
    { label: '同じ会社への間隔', key: COOLDOWN_KEY, value: `${cd.days}日`, ja: cd.noteJa },
  ];
  return { ready: l.all !== null && l.PHONE !== null && l.EMAIL !== null && l.FORM !== null, rows };
}
