/**
 * 【KEEPA_READ_ONLY — 実際にKeepaへ問い合わせる部分】（Phase 3.10・2026-08-25）
 *
 * ★このファイルは画面（'use client'）から絶対に読み込まない（ルール37）。
 *   ここだけが唯一、外へ通信する場所である。
 *
 * ------------------------------------------------------------------
 * 【このファイルが持たない機能】
 *
 *   ・購入 / 出品 / 注文 / 決済 … **1行も無い。** フラグでオフにしているのではない。
 *   ・Keepa側の設定変更（トラッキング登録・通知）… 呼べるエンドポイントを
 *     許可リスト（`KEEPA_ALLOWED_ENDPOINTS`）で2つに絞ってある。
 *   ・POST / PUT / DELETE … GET しか書いていない。
 *
 * ------------------------------------------------------------------
 * 【APIキーの扱い】
 *
 *   ・読むのは `process.env.KEEPA_API_KEY` だけ。引数で渡せるようにしない。
 *     引数で渡せると、いつか誰かが呼び出し側に直接書く。
 *   ・キーは**戻り値に含めない**。例外メッセージにも含めない。
 *   ・**リクエストURLを保存しない・返さない・出力しない。** URLにはキーが入るため。
 *     保存するのは「どのエンドポイントに、どのパラメータで投げたか」だけ。
 *   ・最後の保険として、外へ出す文字列は全部 `redactKeepaKey()` を通す。
 */
import {
  KEEPA_ALLOWED_ENDPOINTS,
  KEEPA_ALLOWED_HTTP_METHOD,
  KEEPA_API_KEY_ENV,
  KEEPA_DOMAIN_JP,
  KEEPA_MAX_ASINS_PER_RUN,
  redactKeepaKey,
  type KeepaEndpoint,
} from './policy';
import {
  estimateTokenCost,
  KEEPA_DEFAULT_REQUEST_OPTIONS,
  type KeepaRequestOptions,
} from './tokens';

const KEEPA_BASE = 'https://api.keepa.com/';

/* ================================================================
 * キーの状態（値そのものは外へ出さない）
 * ================================================================ */

export type KeepaKeyStatus = {
  configured: boolean;
  /** 画面に出す文言。**値は入らない。** */
  messageJa: string;
};

function readKey(): string | null {
  const v = process.env[KEEPA_API_KEY_ENV];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '') return null;
  // 記入例のまま置かれている場合は「未設定」とみなす（間違って本番へ投げないため）。
  if (/^(your|xxx|dummy|sample|ここに)/i.test(t)) return null;
  return t;
}

export function keepaKeyStatus(): KeepaKeyStatus {
  const ok = readKey() !== null;
  return {
    configured: ok,
    messageJa: ok
      ? 'APIキーは設定されています（値は表示しません）。'
      : `APIキーが設定されていません。プロジェクト直下の .env に ${KEEPA_API_KEY_ENV} を書いてください。`
        + '（このシステムはキーの値を表示・保存・記録しません）',
  };
}

/* ================================================================
 * 応答の形
 * ================================================================ */

export type KeepaTokenInfo = {
  /** いまの残り */
  tokensLeft: number | null;
  /** この呼び出しで使った量（実額） */
  tokensConsumed: number | null;
  /** 1分あたりの補充速度 */
  refillRate: number | null;
  /** 次の補充までのミリ秒 */
  refillIn: number | null;
  /** 補充速度が下げられているか（Keepa側の混雑時） */
  tokenFlowReduction: number | null;
  /** Keepa側の処理時間（ミリ秒） */
  processingTimeInMs: number | null;
};

export type KeepaRequestSummary = {
  endpoint: KeepaEndpoint;
  method: 'GET';
  /** 投げたパラメータ。**キーは入っていない。** */
  params: Record<string, string>;
  requestedAt: string;
};

export type KeepaFetchResult = {
  ok: boolean;
  /** HTTPの応答コード */
  httpStatus: number | null;
  /** 生の応答（そのまま保存する）。失敗時は null。 */
  raw: any | null;
  tokens: KeepaTokenInfo;
  request: KeepaRequestSummary;
  /** 失敗の理由（日本語）。キーは伏せてある。 */
  errorJa: string | null;
  /** 事前に見積もった消費量（実額は tokens.tokensConsumed） */
  estimatedCost: number;
};

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractTokens(body: any): KeepaTokenInfo {
  return {
    tokensLeft: numOrNull(body?.tokensLeft),
    tokensConsumed: numOrNull(body?.tokensConsumed),
    refillRate: numOrNull(body?.refillRate),
    refillIn: numOrNull(body?.refillIn),
    tokenFlowReduction: numOrNull(body?.tokenFlowReduction),
    processingTimeInMs: numOrNull(body?.processingTimeInMs),
  };
}

/* ================================================================
 * ASINの形の確認
 * ================================================================ */

/**
 * ASINとして筋が通っているか。
 *
 * 通信する前に弾く。おかしな文字列をそのまま投げると、
 * 枠（Token）を使ったうえで空の結果が返ってくるだけになる。
 */
export function isValidAsin(asin: string): boolean {
  return /^[A-Z0-9]{10}$/.test(String(asin ?? '').trim().toUpperCase());
}

/* ================================================================
 * 本体
 * ================================================================ */

/**
 * 商品を取得する。
 *
 * 【1回に1件しか取れない】
 * `KEEPA_MAX_ASINS_PER_RUN` を超える件数を渡すと、投げる前に失敗を返す。
 * 環境変数で増やす経路は作っていない（`lib/autopurchase.ts` と同じ考え方・ルール62）。
 *
 * 【Fail Closed】
 * キーが無い・ASINの形がおかしい・件数が多い・応答がJSONでない、のどれでも
 * 例外を投げずに `ok: false` を返す。呼ぶ側は ok を見て止まる。
 */
export async function fetchKeepaProducts(
  asins: string[],
  options: Partial<KeepaRequestOptions> = {},
): Promise<KeepaFetchResult> {
  const opt: KeepaRequestOptions = { ...KEEPA_DEFAULT_REQUEST_OPTIONS, ...options };
  const list = asins.map((a) => String(a ?? '').trim().toUpperCase()).filter((a) => a !== '');
  const estimatedCost = estimateTokenCost(list.length, opt);

  const params: Record<string, string> = {
    domain: String(KEEPA_DOMAIN_JP),
    asin: list.join(','),
    stats: opt.stats ? '1' : '0',
    ...(opt.buyBox ? { buybox: '1' } : {}),
    ...(opt.offers ? { offers: '20' } : {}),
  };

  const request: KeepaRequestSummary = {
    endpoint: 'product',
    method: KEEPA_ALLOWED_HTTP_METHOD,
    params,
    requestedAt: new Date().toISOString(),
  };

  const emptyTokens: KeepaTokenInfo = {
    tokensLeft: null, tokensConsumed: null, refillRate: null,
    refillIn: null, tokenFlowReduction: null, processingTimeInMs: null,
  };

  const fail = (errorJa: string): KeepaFetchResult =>
    ({ ok: false, httpStatus: null, raw: null, tokens: emptyTokens, request, errorJa, estimatedCost });

  // ---- 事前の点検（通信する前に止める） ----------------------
  if (list.length === 0) return fail('ASINが指定されていません。');
  if (list.length > KEEPA_MAX_ASINS_PER_RUN) {
    return fail(
      `一度に取得できるのは${KEEPA_MAX_ASINS_PER_RUN}件までです（${list.length}件が指定されました）。`
      + 'いまは「まず1件だけ取って止まる」段階です。件数を増やすには、'
      + 'コードの上限（KEEPA_MAX_ASINS_PER_RUN）を書き換えてコミットする必要があります。',
    );
  }
  const bad = list.filter((a) => !isValidAsin(a));
  if (bad.length > 0) return fail(`ASINの形が正しくありません：${bad.join(', ')}（半角英数字10桁）`);

  const key = readKey();
  if (!key) return fail(keepaKeyStatus().messageJa);

  // ---- 呼べるエンドポイントかを確認（許可リスト方式） ---------
  if (!(KEEPA_ALLOWED_ENDPOINTS as readonly string[]).includes(request.endpoint)) {
    return fail(`このコネクタは ${request.endpoint} を呼びません。`);
  }

  // ---- 通信 ---------------------------------------------------
  // ★ここで作るURLは、この関数の外へ一切出さない（キーが入っているため）。
  const url = new URL(request.endpoint, KEEPA_BASE);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: KEEPA_ALLOWED_HTTP_METHOD,
      headers: {
        // Keepa は gzip での応答を前提にしている。
        'Accept-Encoding': 'gzip',
        Accept: 'application/json',
      },
    });
  } catch (e) {
    return fail(`Keepaへ接続できませんでした：${redactKeepaKey(String((e as Error)?.message ?? e), key)}`);
  }

  const httpStatus = res.status;

  let body: any = null;
  let text = '';
  try {
    text = await res.text();
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      httpStatus,
      raw: null,
      tokens: emptyTokens,
      request,
      estimatedCost,
      errorJa:
        `応答をJSONとして読み取れませんでした（HTTP ${httpStatus}）。`
        + `先頭200文字：${redactKeepaKey(text.slice(0, 200), key)}`,
    };
  }

  const tokens = extractTokens(body);

  if (!res.ok) {
    const detail = body?.error?.message ?? body?.error ?? '';
    return {
      ok: false,
      httpStatus,
      raw: body,
      tokens,
      request,
      estimatedCost,
      errorJa: `Keepaがエラーを返しました（HTTP ${httpStatus}）：${redactKeepaKey(String(detail), key)}`,
    };
  }

  return { ok: true, httpStatus, raw: body, tokens, request, estimatedCost, errorJa: null };
}

/**
 * 残り枠だけを確認する。
 *
 * Keepa は `product` の応答にも残り枠を載せてくるので、
 * ふだんはそちらを使えばよい。これは「投げる前に残りを知りたい」ときだけ。
 */
export async function fetchKeepaTokenStatus(): Promise<KeepaFetchResult> {
  const request: KeepaRequestSummary = {
    endpoint: 'token',
    method: KEEPA_ALLOWED_HTTP_METHOD,
    params: {},
    requestedAt: new Date().toISOString(),
  };
  const emptyTokens: KeepaTokenInfo = {
    tokensLeft: null, tokensConsumed: null, refillRate: null,
    refillIn: null, tokenFlowReduction: null, processingTimeInMs: null,
  };

  const key = readKey();
  if (!key) {
    return {
      ok: false, httpStatus: null, raw: null, tokens: emptyTokens, request,
      estimatedCost: 0, errorJa: keepaKeyStatus().messageJa,
    };
  }

  const url = new URL('token', KEEPA_BASE);
  url.searchParams.set('key', key);

  try {
    const res = await fetch(url.toString(), {
      method: KEEPA_ALLOWED_HTTP_METHOD,
      headers: { 'Accept-Encoding': 'gzip', Accept: 'application/json' },
    });
    const body = await res.json();
    return {
      ok: res.ok,
      httpStatus: res.status,
      raw: body,
      tokens: extractTokens(body),
      request,
      estimatedCost: 0,
      errorJa: res.ok ? null : `Keepaがエラーを返しました（HTTP ${res.status}）`,
    };
  } catch (e) {
    return {
      ok: false, httpStatus: null, raw: null, tokens: emptyTokens, request,
      estimatedCost: 0,
      errorJa: `Keepaへ接続できませんでした：${redactKeepaKey(String((e as Error)?.message ?? e), key)}`,
    };
  }
}
