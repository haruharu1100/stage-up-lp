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
 *   ・Keepa側の設定変更（トラッキング登録・通知）… 呼べる先を
 *     許可リスト（`KEEPA_ALLOWED_ENDPOINTS`）で絞ってある。
 *     いま許しているのは4つで、**どれも読み取り専用**である：
 *       product  … 商品1件のデータ
 *       token    … 残り枠の確認
 *       query    … 条件に合うASINの一覧（商品検索）
 *       category … 売り場の分類の番号と名前（2026-08-25 追加）
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
  KEEPA_CURRENT_STAGE,
  KEEPA_DISCOVERY_COSTS,
  KEEPA_DISCOVERY_PER_PAGE,
  KEEPA_DOMAIN_JP,
  KEEPA_MAX_ASINS_PER_RUN,
  KEEPA_MAX_DISCOVERY_TOKENS,
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
      + `いまは段階${KEEPA_CURRENT_STAGE}（${KEEPA_MAX_ASINS_PER_RUN}件まで）です。件数を増やすには、`
      // ★2026-08-25 復旧。段階S2へ進めたときに文面を書き直し、上限の定数名
      //   （KEEPA_MAX_ASINS_PER_RUN）をここから落としてしまっていた。
      //   これは飾りではなく「どこを書き換えれば増えるのか」を一意に示す唯一の手掛かりで、
      //   受け入れテストもここを見ている。名前は必ず残す（ルール84）。
      + 'コードの上限（KEEPA_MAX_ASINS_PER_RUN）を書き換えてコミットする必要があります。'
      + '設定では増やせません。',
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

/* ================================================================
 * 候補ASINを探す（Product Finder）
 * ================================================================ */

/**
 * 【Keepa自身に、条件に合う実在ASINを挙げてもらう】
 *
 * ご本人の指示（2026-08-25）：
 *   「Keepa公式APIで正式に取得可能な Product Finder / Best Sellers / Deals / 商品検索 等から
 *     ASIN候補を取得できる場合、Keepa自身をASIN候補の発見元として使用可能な設計に
 *     してください。これなら、人間がAmazon画面から毎回コピーする必要がありません。」
 *
 * ここがこの機能のいちばんの利点である。
 * **AIが文字列としてASINを作る余地が、設計から消える。**
 * 返ってくるのは Keepa のデータベースに実在する商品のASINだけなので、
 * 「実在しないASINから、実在するが別の商品のページを開いてしまう」事故が起こりようがない。
 *
 * ------------------------------------------------------------------
 * 【読み取りだけ】
 *
 * `/query` は条件に合うASINの一覧（`asinList`）と件数（`totalResults`）を返すだけ。
 * 買う・出品する・Keepa側の設定を変える、はできない。
 *
 * ------------------------------------------------------------------
 * 【枠を使いすぎない】
 *
 * 公式の実額は「1回10 ＋ 結果100件ごとに1」。最小ページ（50件）で投げるので **11**。
 * 見積もりが `KEEPA_MAX_DISCOVERY_TOKENS`（15）を超えるときは、**投げる前に止める**。
 * `stats=1` は付けない（追加30。今回の判断に要らない）。
 */
export type KeepaFinderSelection = Record<string, unknown>;

export type KeepaDiscoveryResult = KeepaFetchResult & {
  /** 見つかったASIN（Keepaが実在を保証している） */
  asinList: string[];
  /** 条件に合った総数（の見積もり） */
  totalResults: number | null;
};

export async function discoverAsinCandidates(
  selection: KeepaFinderSelection,
): Promise<KeepaDiscoveryResult> {
  const perPage = Number((selection as any)?.perPage ?? KEEPA_DISCOVERY_PER_PAGE);
  const estimatedCost =
    KEEPA_DISCOVERY_COSTS.QUERY_BASE
    + Math.max(1, Math.ceil(perPage / 100)) * KEEPA_DISCOVERY_COSTS.QUERY_PER_100_ASINS;

  const params: Record<string, string> = {
    domain: String(KEEPA_DOMAIN_JP),
    // ★selection（検索条件）は params に入れる。キーは入っていないので保存してよい。
    selection: JSON.stringify(selection),
  };

  const request: KeepaRequestSummary = {
    endpoint: 'query',
    method: KEEPA_ALLOWED_HTTP_METHOD,
    params,
    requestedAt: new Date().toISOString(),
  };

  const emptyTokens: KeepaTokenInfo = {
    tokensLeft: null, tokensConsumed: null, refillRate: null,
    refillIn: null, tokenFlowReduction: null, processingTimeInMs: null,
  };

  const fail = (errorJa: string): KeepaDiscoveryResult => ({
    ok: false, httpStatus: null, raw: null, tokens: emptyTokens, request,
    errorJa, estimatedCost, asinList: [], totalResults: null,
  });

  // ---- 投げる前に止める --------------------------------------
  if (estimatedCost > KEEPA_MAX_DISCOVERY_TOKENS) {
    return fail(
      `候補探しの見積もりが${estimatedCost}で、上限（${KEEPA_MAX_DISCOVERY_TOKENS}）を超えています。`
      + '件数を減らしてください。上限を上げるにはコードを書き換えてコミットする必要があります。',
    );
  }
  if ((selection as any)?.stats) {
    return fail('候補探しに stats は付けません（追加で30の枠を使うため）。');
  }
  if (!(KEEPA_ALLOWED_ENDPOINTS as readonly string[]).includes(request.endpoint)) {
    return fail(`このコネクタは ${request.endpoint} を呼びません。`);
  }

  const key = readKey();
  if (!key) return fail(keepaKeyStatus().messageJa);

  // ★キー入りのURLは、この関数の外へ一切出さない（ルール85）。
  const url = new URL('query', KEEPA_BASE);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: KEEPA_ALLOWED_HTTP_METHOD,
      headers: { 'Accept-Encoding': 'gzip', Accept: 'application/json' },
    });
  } catch (e) {
    return fail(`Keepaへ接続できませんでした：${redactKeepaKey(String((e as Error)?.message ?? e), key)}`);
  }

  let body: any = null;
  let text = '';
  try {
    text = await res.text();
    body = JSON.parse(text);
  } catch {
    return {
      ok: false, httpStatus: res.status, raw: null, tokens: emptyTokens, request,
      estimatedCost, asinList: [], totalResults: null,
      errorJa: `応答をJSONとして読み取れませんでした（HTTP ${res.status}）。`
        + `先頭200文字：${redactKeepaKey(text.slice(0, 200), key)}`,
    };
  }

  const tokens = extractTokens(body);

  if (!res.ok) {
    const detail = body?.error?.message ?? body?.error ?? '';
    return {
      ok: false, httpStatus: res.status, raw: body, tokens, request, estimatedCost,
      asinList: [], totalResults: null,
      errorJa: `Keepaがエラーを返しました（HTTP ${res.status}）：${redactKeepaKey(String(detail), key)}`,
    };
  }

  // ★ここで返すASINは、Keepaのデータベースに実在するものだけ。
  //   形が10桁でないものは、念のため落とす（読み違いを通さない）。
  const asinList = (Array.isArray(body?.asinList) ? body.asinList : [])
    .map((a: unknown) => String(a ?? '').trim().toUpperCase())
    .filter((a: string) => isValidAsin(a));

  return {
    ok: true, httpStatus: res.status, raw: body, tokens, request, estimatedCost,
    asinList,
    totalResults: numOrNull(body?.totalResults),
    errorJa: null,
  };
}

/* ================================================================
 * 売り場の分類（本／家電／ゲーム 等）を、正式な一覧として取る
 * ================================================================ */

/**
 * 【なぜ分類を「取りに行く」のか】（Phase 3.12・2026-08-25）
 *
 * ご本人の指示（原文）：
 *   「5種類に分散　本 / 家電 / ゲーム / 日用品 / ホビー。
 *     同じ種類の商品だけ5件にしないでください。目的はSchema Variationの確認です。」
 *
 * 分野をまたいで候補を探すには、Amazonの分類番号が要る。
 * ★その番号を、こちらで「たぶん本は 465392 だろう」と書いたら、それは推測である。
 *   推測した番号で検索すれば、別の売り場の商品が5件返ってきて、
 *   しかも**間違いに気づけない**（返ってきた商品はどれも実在するので、正しく見える）。
 *
 * Keepa は「日本のAmazonの分類を全部ください」に1枠で答える。
 * 公式ドキュメント原文：
 *   "you can specify the value 0 to retrieve a list of all root categories"
 *   "Token Cost: 1 per request"
 *
 * 1枠払って正式な一覧をもらう。推測はしない。
 *
 * ------------------------------------------------------------------
 * 【読み取りだけ】
 * 返るのは分類の番号と名前だけ。商品も価格も返らない。買う・出品するはできない。
 */
export type KeepaCategory = {
  /** Keepa/Amazon の分類番号 */
  catId: string;
  /** 分類の名前（日本のAmazonなので日本語で返る） */
  name: string;
  /** その分類に入っている商品数（Keepaが把握している分） */
  productCount: number | null;
};

export type KeepaCategoryResult = KeepaFetchResult & {
  categories: KeepaCategory[];
};

export async function fetchKeepaRootCategories(): Promise<KeepaCategoryResult> {
  /*
   * 公式の実額：1回1枠。
   * ★ここは見積もりではなく、ドキュメントに書かれた固定額である。
   *   実消費と食い違ったら、それ自体が報告すべき異常として扱う。
   */
  const estimatedCost = 1;

  const params: Record<string, string> = {
    domain: String(KEEPA_DOMAIN_JP),
    // 0 ＝「いちばん上の分類を全部」。公式ドキュメントに書かれている使い方。
    category: '0',
    parents: '0',
  };

  const request: KeepaRequestSummary = {
    endpoint: 'category',
    method: KEEPA_ALLOWED_HTTP_METHOD,
    params,
    requestedAt: new Date().toISOString(),
  };

  const emptyTokens: KeepaTokenInfo = {
    tokensLeft: null, tokensConsumed: null, refillRate: null,
    refillIn: null, tokenFlowReduction: null, processingTimeInMs: null,
  };

  const fail = (errorJa: string): KeepaCategoryResult => ({
    ok: false, httpStatus: null, raw: null, tokens: emptyTokens, request,
    errorJa, estimatedCost, categories: [],
  });

  if (!(KEEPA_ALLOWED_ENDPOINTS as readonly string[]).includes(request.endpoint)) {
    return fail(`このコネクタは ${request.endpoint} を呼びません。`);
  }

  const key = readKey();
  if (!key) return fail(keepaKeyStatus().messageJa);

  // ★キー入りのURLは、この関数の外へ一切出さない（ルール85）。
  const url = new URL('category', KEEPA_BASE);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: KEEPA_ALLOWED_HTTP_METHOD,
      headers: { 'Accept-Encoding': 'gzip', Accept: 'application/json' },
    });
  } catch (e) {
    return fail(`Keepaへ接続できませんでした：${redactKeepaKey(String((e as Error)?.message ?? e), key)}`);
  }

  let body: any = null;
  let text = '';
  try {
    text = await res.text();
    body = JSON.parse(text);
  } catch {
    return {
      ok: false, httpStatus: res.status, raw: null, tokens: emptyTokens, request,
      estimatedCost, categories: [],
      errorJa: `応答をJSONとして読み取れませんでした（HTTP ${res.status}）。`
        + `先頭200文字：${redactKeepaKey(text.slice(0, 200), key)}`,
    };
  }

  const tokens = extractTokens(body);

  if (!res.ok) {
    const detail = body?.error?.message ?? body?.error ?? '';
    return {
      ok: false, httpStatus: res.status, raw: body, tokens, request, estimatedCost,
      categories: [],
      errorJa: `Keepaがエラーを返しました（HTTP ${res.status}）：${redactKeepaKey(String(detail), key)}`,
    };
  }

  /*
   * 応答の形：`categories` は配列ではなく「番号をキーにしたまとまり」で返る。
   * ★配列だと決めつけて `.map()` を書くと、ここで落ちる。実物の形に合わせる。
   */
  const rawCats = body?.categories;
  const categories: KeepaCategory[] = [];
  if (rawCats && typeof rawCats === 'object' && !Array.isArray(rawCats)) {
    for (const [catId, v] of Object.entries(rawCats as Record<string, any>)) {
      categories.push({
        catId: String(catId),
        name: String(v?.name ?? ''),
        productCount: numOrNull(v?.productCount),
      });
    }
  }

  return {
    ok: true, httpStatus: res.status, raw: body, tokens, request, estimatedCost,
    categories, errorJa: null,
  };
}
