import { insert, newId, nowIso, all } from '../db/client';

/**
 * 探索1回ごとの「結果の種類」を必ず区別して記録する。
 * ===================================================================
 * なぜ必要か（2026-08-20・実際に起きた事故）
 *   Amazon→仕入先の逆方向探索は、**壊れていたのに「0件でした」と表示していた。**
 *   種を選ぶSQLが存在しない列を読んで毎回失敗していたのに、
 *   catch がそれを握りつぶし、呼び出し元には空配列だけが返っていた。
 *   その結果、**「探したけれど無かった」と「そもそも壊れていた」が見分けられなかった。**
 *
 * ユーザーの指示：
 *   「今回発見した『逆検索が壊れているのに0件と表示』は二度と起こさない。
 *     必ず 0_RESULTS / API_ERROR / AUTH_ERROR / PARSE_ERROR / RATE_LIMIT /
 *     NO_PERMISSION / NO_MATCH を区別してください。画面にも日本語で理由を表示。」
 *
 * ★鉄則：**空配列を返すときは、必ずこの種類のどれかを添える。**
 *   種類を付けずに空配列を返す関数を作らない。
 */

export type DiscoveryOutcome =
  /** 正常に呼べて、結果が1件以上あった */
  | 'OK'
  /** 正常に呼べたが、本当に0件だった（＝壊れてはいない） */
  | '0_RESULTS'
  /** APIがエラーを返した（相手側の異常・不正なリクエストなど） */
  | 'API_ERROR'
  /** 認証に失敗した（鍵が違う・署名が違う・トークン切れ） */
  | 'AUTH_ERROR'
  /** 返ってきたが、中身を読み取れなかった（項目名が変わった等） */
  | 'PARSE_ERROR'
  /** 呼びすぎで断られた */
  | 'RATE_LIMIT'
  /** そのAPIを使う権限が無い（申請していない・承認されていない） */
  | 'NO_PERMISSION'
  /** 結果は返ったが、同一商品と言える候補が無かった */
  | 'NO_MATCH'
  /** ★API契約台帳でVERIFIEDになっていないので、呼ぶ前に止めた */
  | 'NOT_VERIFIED'
  /** 鍵が設定されていないので呼ばなかった */
  | 'NO_CREDENTIALS';

/** 画面にそのまま出せる日本語。専門用語を使わない */
export const OUTCOME_LABEL: Record<DiscoveryOutcome, string> = {
  OK: '取得できました',
  '0_RESULTS': '正常に検索できましたが、条件に合う商品が0件でした（壊れてはいません）',
  API_ERROR: '★仕入先のAPIがエラーを返しました（0件ではなく、失敗です）',
  AUTH_ERROR: '★鍵が違うか期限切れで、ログインに失敗しました（0件ではなく、失敗です）',
  PARSE_ERROR: '★返ってきた内容を読み取れませんでした。項目名が変わった可能性があります',
  RATE_LIMIT: '★短時間に呼びすぎて、仕入先から一時的に断られました。時間をおいて再実行します',
  NO_PERMISSION: '★このAPIを使う権限がまだありません（申請・承認が必要です）',
  NO_MATCH: '検索はできましたが、同じ商品と言い切れる候補がありませんでした',
  NOT_VERIFIED: '★このAPIはまだ実データで確認できていないため、呼ばずに止めました',
  NO_CREDENTIALS: '鍵が設定されていないため、呼びませんでした',
};

/** 「失敗」なのか「本当に0件」なのかの判定。ここを間違えると事故が再発する */
export function isFailure(o: DiscoveryOutcome): boolean {
  return (
    o === 'API_ERROR' ||
    o === 'AUTH_ERROR' ||
    o === 'PARSE_ERROR' ||
    o === 'RATE_LIMIT' ||
    o === 'NO_PERMISSION' ||
    o === 'NOT_VERIFIED'
  );
}

/**
 * 呼び出し結果を必ずこの形で返す。
 * ★`items` が空でも `outcome` を見れば、壊れたのか無かったのかが分かる。
 */
export interface DiscoveryCallResult<T> {
  items: T[];
  outcome: DiscoveryOutcome;
  /** 何が起きたかの日本語の説明 */
  note: string;
  httpStatus?: number | null;
  errorCode?: string | null;
  elapsedMs?: number | null;
}

export function okResult<T>(items: T[], note = ''): DiscoveryCallResult<T> {
  if (!items.length) {
    return { items, outcome: '0_RESULTS', note: note || OUTCOME_LABEL['0_RESULTS'] };
  }
  return { items, outcome: 'OK', note: note || `${items.length}件を取得しました` };
}

export function failResult<T>(
  outcome: DiscoveryOutcome,
  note?: string,
  extra?: { httpStatus?: number | null; errorCode?: string | null },
): DiscoveryCallResult<T> {
  return {
    items: [],
    outcome,
    note: note || OUTCOME_LABEL[outcome],
    httpStatus: extra?.httpStatus ?? null,
    errorCode: extra?.errorCode ?? null,
  };
}

/**
 * 例外・HTTP応答から、結果の種類を判定する。
 * ★迷ったら API_ERROR にする。**間違っても 0_RESULTS にしない。**
 *   「分からないから0件」は、今回の事故そのものだから。
 */
export function classifyError(err: unknown, httpStatus?: number | null): DiscoveryOutcome {
  const msg = String((err as { message?: string })?.message ?? err ?? '').toLowerCase();

  // ★呼ぶ前の関門（トークン期限切れ・鍵なし等）が、自分で種類を決めて投げてくる場合がある。
  //   その場合は文面から推測し直さず、決められた種類をそのまま使う。
  //   （期限切れを API_ERROR に混ぜてしまうと、原因が分からなくなるため）
  const declared = (err as { discoveryOutcome?: DiscoveryOutcome })?.discoveryOutcome;
  if (declared && declared in OUTCOME_LABEL) return declared;

  const status = httpStatus ?? (err as { httpStatus?: number | null })?.httpStatus ?? null;
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  if (status === 429) return 'RATE_LIMIT';

  if (httpStatus === 401 || httpStatus === 403) return 'AUTH_ERROR';
  if (httpStatus === 429) return 'RATE_LIMIT';

  // AliExpress / Alibaba 系のエラーコードは文字列で返ることが多い
  if (/invalid[_ -]?signature|sign(ature)? (error|invalid)|incorrect signature/.test(msg)) return 'AUTH_ERROR';
  if (/invalid[_ -]?session|session[_ -]?expired|token.*(expired|invalid)|unauthorized/.test(msg)) return 'AUTH_ERROR';
  if (/app[_ -]?call[_ -]?limited|rate.?limit|too many requests|qps/.test(msg)) return 'RATE_LIMIT';
  if (/permission|not[_ -]?authoriz|no[_ -]?privilege|forbidden|apply.*api/.test(msg)) return 'NO_PERMISSION';
  if (/unexpected token|json|parse|cannot read propert/.test(msg)) return 'PARSE_ERROR';

  return 'API_ERROR';
}

/**
 * 呼び出し1回ぶんをDBに残す。
 * ★成功も失敗も残す。失敗だけ残すと「動いていないこと」に気づけないため。
 */
export async function logDiscoveryCall(entry: {
  runId?: string | null;
  provider: string;
  apiName?: string | null;
  direction?: string | null;
  query?: string | null;
  outcome: DiscoveryOutcome;
  note?: string | null;
  resultCount?: number;
  httpStatus?: number | null;
  errorCode?: string | null;
  elapsedMs?: number | null;
}): Promise<void> {
  try {
    await insert('discovery_call_log', {
      id: newId('dcall'),
      run_id: entry.runId ?? null,
      provider: entry.provider,
      api_name: entry.apiName ?? null,
      direction: entry.direction ?? null,
      query: entry.query ?? null,
      outcome: entry.outcome,
      outcome_note: entry.note ?? OUTCOME_LABEL[entry.outcome],
      result_count: entry.resultCount ?? 0,
      http_status: entry.httpStatus ?? null,
      error_code: entry.errorCode ?? null,
      elapsed_ms: entry.elapsedMs ?? null,
      created_at: nowIso(),
    });
  } catch {
    // 記録に失敗しても本処理は止めない（ただし握りつぶすのはここだけ）
  }
}

export interface OutcomeSummaryRow {
  outcome: DiscoveryOutcome;
  label: string;
  count: number;
  isFailure: boolean;
}

/**
 * 直近の呼び出し結果を種類別に集計する。
 * 画面に「なぜ0件なのか」を日本語で出すための材料。
 */
export async function outcomeSummary(days = 7): Promise<{
  rows: OutcomeSummaryRow[];
  totalCalls: number;
  failureCalls: number;
  headline: string;
}> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = await all(
    `SELECT outcome, COUNT(*) AS n FROM discovery_call_log
      WHERE created_at >= ? GROUP BY outcome ORDER BY n DESC`,
    [since],
  ).catch(() => [] as Record<string, unknown>[]);

  const out: OutcomeSummaryRow[] = rows.map((r) => {
    const o = String(r.outcome ?? 'API_ERROR') as DiscoveryOutcome;
    return {
      outcome: o,
      label: OUTCOME_LABEL[o] ?? String(o),
      count: Number(r.n ?? 0),
      isFailure: isFailure(o),
    };
  });

  const totalCalls = out.reduce((s, r) => s + r.count, 0);
  const failureCalls = out.filter((r) => r.isFailure).reduce((s, r) => s + r.count, 0);

  let headline: string;
  if (!totalCalls) {
    headline = `直近${days}日間、仕入先のAPIを1回も呼んでいません（鍵がまだ無いためです）`;
  } else if (failureCalls > 0) {
    headline =
      `★直近${days}日間で${totalCalls}回呼び、そのうち${failureCalls}回は「0件」ではなく**失敗**です。` +
      '失敗を0件として扱っていません。';
  } else {
    headline = `直近${days}日間で${totalCalls}回呼び、失敗は0回でした`;
  }

  return { rows: out, totalCalls, failureCalls, headline };
}
