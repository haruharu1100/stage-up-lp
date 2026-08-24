import { all, insert, newId, nowIso, one, update } from '../db/client';

/**
 * 外部APIの調子（HEALTHY / DEGRADED / DOWN）。
 *
 * ★ユーザー指定の絶対ルール：
 *   「Providerごとに HEALTHY / DEGRADED / DOWN を持たせてください。」
 *   「データ取得失敗時に推測値で埋めないでください。UNKNOWNとして扱ってください。」
 *
 * → DOWN のときは、その提供元を使う処理を「止める」。
 *   代わりの数字をでっち上げない。止まるだけで、間違ったデータは1件も入らない。
 */

export type ProviderStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export const PROVIDER_STATUS_LABEL: Record<ProviderStatus, string> = {
  HEALTHY: '正常',
  DEGRADED: '調子が悪い',
  DOWN: '止まっている',
};

export const PROVIDER_STATUS_COLOR: Record<ProviderStatus, string | undefined> = {
  HEALTHY: undefined,
  DEGRADED: '#b36b00',
  DOWN: '#b00',
};

/** 何回続けて失敗したら DOWN とみなすか */
const DOWN_CONSECUTIVE = 5;
/** DOWN のあと、何分は呼び出しを控えるか（相手に連打しない） */
const DOWN_COOLDOWN_MIN = 10;
/** 集計をやり直す間隔（時間）。古い失敗をいつまでも引きずらない */
const WINDOW_HOURS = 6;
/** 失敗率がこれを超えたら DEGRADED */
const DEGRADED_FAIL_RATIO = 0.2;
/** 失敗率で判断するのに最低限必要な回数 */
const MIN_SAMPLES = 5;

export interface ProviderHealthRow {
  provider: string;
  label: string;
  status: ProviderStatus;
  okCount: number;
  failCount: number;
  consecutiveFails: number;
  failRatio: number | null;
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastError: string | null;
  avgLatencyMs: number | null;
  pausedUntil: string | null;
  message: string;
}

const LABEL: Record<string, string> = {
  keepa: 'Keepa（商品データ）',
  openai: 'OpenAI（文章・画像）',
  openai_vision: 'OpenAI 画像確認',
  openai_embedding: 'OpenAI 文章の意味比較',
  openai_text: 'OpenAI 文章生成',
  anthropic: 'Claude 文章生成',
  supplier: '仕入先データ',
  notification: '通知',
  storage: 'ファイル保存',
};

function labelOf(p: string): string {
  return LABEL[p] ?? p;
}

async function load(provider: string): Promise<any | null> {
  return one(`SELECT * FROM provider_health WHERE provider = ?`, [provider]);
}

/** 集計の窓が古くなったら数え直す（何日も前の失敗で DOWN のままにしない） */
function windowExpired(row: any, now: Date): boolean {
  const t = row?.window_started_at ? Date.parse(String(row.window_started_at)) : NaN;
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t > WINDOW_HOURS * 3_600_000;
}

function judge(ok: number, fail: number, consecutive: number): ProviderStatus {
  if (consecutive >= DOWN_CONSECUTIVE) return 'DOWN';
  const total = ok + fail;
  if (total >= MIN_SAMPLES && fail / total > DEGRADED_FAIL_RATIO) return 'DEGRADED';
  if (consecutive >= 2) return 'DEGRADED';
  return 'HEALTHY';
}

/**
 * 1回の呼び出しの結果を記録する。
 * ★記録に失敗しても本流は止めない（見張りのために本業を止めない）。
 */
export async function recordProviderCall(
  provider: string,
  ok: boolean,
  opts?: { latencyMs?: number; error?: any },
): Promise<void> {
  const now = new Date();
  try {
    const row = await load(provider);
    const reset = !row || windowExpired(row, now);

    const okCount = (reset ? 0 : Number(row.ok_count) || 0) + (ok ? 1 : 0);
    const failCount = (reset ? 0 : Number(row.fail_count) || 0) + (ok ? 0 : 1);
    const consecutive = ok ? 0 : (reset ? 0 : Number(row.consecutive_fails) || 0) + 1;
    const status = judge(okCount, failCount, consecutive);

    const prevAvg = reset ? null : row.avg_latency_ms != null ? Number(row.avg_latency_ms) : null;
    const latency = opts?.latencyMs != null ? Math.round(opts.latencyMs) : null;
    const avg = latency == null ? prevAvg : prevAvg == null ? latency : Math.round(prevAvg * 0.8 + latency * 0.2);

    const data: Record<string, any> = {
      status,
      ok_count: okCount,
      fail_count: failCount,
      consecutive_fails: consecutive,
      last_latency_ms: latency,
      avg_latency_ms: avg,
      window_started_at: reset ? nowIso() : String(row.window_started_at),
      paused_until:
        status === 'DOWN' ? new Date(now.getTime() + DOWN_COOLDOWN_MIN * 60_000).toISOString() : null,
      updated_at: nowIso(),
    };
    if (ok) data.last_ok_at = nowIso();
    else {
      data.last_fail_at = nowIso();
      data.last_error = String(opts?.error?.message ?? opts?.error ?? '').slice(0, 300);
    }

    if (row) await update('provider_health', String(row.id), data);
    else await insert('provider_health', { id: newId('ph'), provider, ...data });
  } catch {
    /* 見張りの記録が失敗しても本流は止めない */
  }
}

/**
 * 「いまこの提供元を呼んでよいか」。
 * ★DOWN の直後は少し待つ。待つだけで、推測値では埋めない。
 */
export async function canCallProvider(
  provider: string,
  now = new Date(),
): Promise<{ allowed: boolean; status: ProviderStatus; reason: string }> {
  try {
    const row = await load(provider);
    if (!row) return { allowed: true, status: 'HEALTHY', reason: 'まだ記録がありません' };
    const status = (String(row.status) as ProviderStatus) ?? 'HEALTHY';
    const pausedUntil = row.paused_until ? Date.parse(String(row.paused_until)) : NaN;
    if (status === 'DOWN' && Number.isFinite(pausedUntil) && now.getTime() < pausedUntil) {
      const min = Math.ceil((pausedUntil - now.getTime()) / 60_000);
      return {
        allowed: false,
        status,
        reason: `${labelOf(provider)}が${DOWN_CONSECUTIVE}回続けて失敗したため、あと${min}分は呼び出しを控えます（推測では埋めません）`,
      };
    }
    return { allowed: true, status, reason: PROVIDER_STATUS_LABEL[status] };
  } catch {
    return { allowed: true, status: 'HEALTHY', reason: '記録を読めませんでした' };
  }
}

/**
 * 呼び出しを包んで、成功・失敗と所要時間を自動で記録する。
 * ★DOWN のあいだは呼ばずに throw する。呼び出し側は「取れなかった＝UNKNOWN」として扱う。
 */
export async function withProviderHealth<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const gate = await canCallProvider(provider);
  if (!gate.allowed) throw new Error(gate.reason);
  const t0 = Date.now();
  try {
    const out = await fn();
    await recordProviderCall(provider, true, { latencyMs: Date.now() - t0 });
    return out;
  } catch (e) {
    await recordProviderCall(provider, false, { latencyMs: Date.now() - t0, error: e });
    throw e;
  }
}

export async function providerHealthList(): Promise<ProviderHealthRow[]> {
  const rows = await all(`SELECT * FROM provider_health ORDER BY provider`);
  return rows.map((r: any) => {
    const ok = Number(r.ok_count) || 0;
    const fail = Number(r.fail_count) || 0;
    const total = ok + fail;
    const status = (String(r.status) as ProviderStatus) ?? 'HEALTHY';
    return {
      provider: String(r.provider),
      label: labelOf(String(r.provider)),
      status,
      okCount: ok,
      failCount: fail,
      consecutiveFails: Number(r.consecutive_fails) || 0,
      failRatio: total > 0 ? fail / total : null,
      lastOkAt: r.last_ok_at ? String(r.last_ok_at) : null,
      lastFailAt: r.last_fail_at ? String(r.last_fail_at) : null,
      lastError: r.last_error ? String(r.last_error) : null,
      avgLatencyMs: r.avg_latency_ms != null ? Math.round(Number(r.avg_latency_ms)) : null,
      pausedUntil: r.paused_until ? String(r.paused_until) : null,
      message:
        status === 'DOWN'
          ? `★${DOWN_CONSECUTIVE}回以上続けて失敗しています。直るまでこの提供元は使いません（推測では埋めません）`
          : status === 'DEGRADED'
            ? `失敗が増えています（直近${WINDOW_HOURS}時間で${fail}回／${total}回）`
            : total > 0
              ? `直近${WINDOW_HOURS}時間で${total}回呼んで、失敗${fail}回です`
              : 'まだ呼ばれていません',
    };
  });
}

export async function providerHealthWorst(): Promise<{ worst: ProviderStatus; down: string[]; degraded: string[] }> {
  const rows = await providerHealthList();
  const down = rows.filter((r) => r.status === 'DOWN').map((r) => r.label);
  const degraded = rows.filter((r) => r.status === 'DEGRADED').map((r) => r.label);
  const worst: ProviderStatus = down.length ? 'DOWN' : degraded.length ? 'DEGRADED' : 'HEALTHY';
  return { worst, down, degraded };
}
