/**
 * AliExpress アクセストークンの素性管理（TOKEN META）
 * ===================================================================
 * ユーザー指示（2026-08-20）：
 *   「Access Token には 取得日時／期限／refresh情報／権限 を保存してください。
 *     期限切れを商品0件として扱わない。AUTH_ERROR として止める。」
 *   「App Secret / Access Token を ログ・画面・Obsidian・DB へ平文保存しない。」
 *
 * ★この2つを同時に守るための設計
 *   - トークン**本体**は .env にしか置かない。DBには入れない。
 *   - DB（provider_token_meta）に入れるのは
 *       取得日時 / 期限 / refreshの期限 / refreshの有無 / 権限 / 末尾4桁
 *     だけ。末尾4桁は「今 .env にあるのと同じ鍵か」を人が見分けるための目印。
 *
 * ★「期限が分からない」を「期限内」と言い換えない
 *   AliExpress の公式説明では access_token は90日・refresh_token は180日とされているが、
 *   **実際に発行された日を機械は知らない**。
 *   .env に取得日が書かれていなければ、期限は UNKNOWN のままにする。
 *   90日と決めつけて「まだ有効です」と表示するのは嘘になるので、しない。
 */
import { one, run, nowIso } from '../db/client';
import { mask } from './secretMask';

/** .env から読む（無ければ空） */
function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export interface TokenState {
  /** .env にトークンが入っているか */
  present: boolean;
  /** 末尾4桁だけ（****1234）。本体は返さない */
  masked: string;
  /** 取得日時（.env の ALIEXPRESS_TOKEN_OBTAINED_AT）。無ければ null＝UNKNOWN */
  obtainedAt: string | null;
  /** 期限（.env の ALIEXPRESS_TOKEN_EXPIRES_AT）。無ければ null＝UNKNOWN */
  expiresAt: string | null;
  /** refresh_token の期限。無ければ null＝UNKNOWN */
  refreshExpiresAt: string | null;
  /** refresh_token が .env にあるか */
  hasRefresh: boolean;
  /** 権限（.env の ALIEXPRESS_TOKEN_SCOPES）。無ければ null＝UNKNOWN */
  scopes: string | null;
  /**
   * 期限切れかどうか。
   *   true  … 期限を過ぎている（＝呼んではいけない）
   *   false … 期限内
   *   null  … ★期限が分からない（UNKNOWN）。「有効」ではない
   */
  expired: boolean | null;
  /** 残り日数。期限が分からなければ null */
  daysLeft: number | null;
  /** 画面にそのまま出せる日本語 */
  summary: string;
}

/** .env だけを見て、いまのトークンの状態を言う（外部APIは呼ばない） */
export function tokenState(): TokenState {
  const token = env('ALIEXPRESS_ACCESS_TOKEN');
  const refresh = env('ALIEXPRESS_REFRESH_TOKEN');
  const obtainedAt = env('ALIEXPRESS_TOKEN_OBTAINED_AT') || null;
  const expiresAt = env('ALIEXPRESS_TOKEN_EXPIRES_AT') || null;
  const refreshExpiresAt = env('ALIEXPRESS_REFRESH_EXPIRES_AT') || null;
  const scopes = env('ALIEXPRESS_TOKEN_SCOPES') || null;

  let expired: boolean | null = null;
  let daysLeft: number | null = null;
  if (expiresAt) {
    const t = Date.parse(expiresAt);
    if (Number.isFinite(t)) {
      expired = t <= Date.now();
      daysLeft = Math.floor((t - Date.now()) / 86_400_000);
    }
  }

  let summary: string;
  if (!token) {
    summary = 'アクセストークン：未設定（MOQ・在庫・実送料・画像検索は取得できません）';
  } else if (expired === true) {
    summary = `アクセストークン：★期限切れです（${expiresAt}）。取り直してください`;
  } else if (expired === false) {
    summary = `アクセストークン：設定済み（${mask(token)}）／残り約${daysLeft}日`;
  } else {
    summary =
      `アクセストークン：設定済み（${mask(token)}）／` +
      '期限は不明です（.env に ALIEXPRESS_TOKEN_EXPIRES_AT が無いため）。' +
      '★「期限内」とは断定しません';
  }

  return {
    present: !!token,
    masked: mask(token),
    obtainedAt,
    expiresAt,
    refreshExpiresAt,
    hasRefresh: !!refresh,
    scopes,
    expired,
    daysLeft,
    summary,
  };
}

/**
 * ★呼ぶ前の関門。
 *   期限切れが分かっているのに呼びに行って「0件でした」と言うのが一番まずい。
 *   期限切れなら、ここで AUTH_ERROR として止める。
 *
 *   期限が UNKNOWN のときは止めない（勝手に切れたことにしない）。
 *   その場合はAPI側が返すエラーを AUTH_ERROR として分類する。
 */
export function assertTokenUsable(apiName: string): void {
  const st = tokenState();
  if (!st.present) {
    const e: any = new Error(
      `${apiName} には access_token が必要ですが、.env に ALIEXPRESS_ACCESS_TOKEN がありません` +
        '（0件ではなく、鍵が無いという意味です）',
    );
    e.discoveryOutcome = 'NO_CREDENTIALS';
    throw e;
  }
  if (st.expired === true) {
    const e: any = new Error(
      `${apiName} を呼びませんでした。アクセストークンの期限が切れています（${st.expiresAt}）。` +
        '★これは「商品0件」ではありません。トークンを取り直してください',
    );
    e.discoveryOutcome = 'AUTH_ERROR';
    e.httpStatus = 401;
    throw e;
  }
}

/**
 * トークンの素性をDBに残す（★本体は保存しない）。
 * 鍵を入れ替えたときに「いつのどの鍵か」が後から分かるようにするためのもの。
 */
export async function recordTokenMeta(provider = 'aliexpress'): Promise<TokenState> {
  const st = tokenState();
  const now = nowIso();
  await run(
    `INSERT INTO provider_token_meta
       (provider, obtained_at, expires_at, refresh_expires_at, has_refresh, scopes, token_tail, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       obtained_at = excluded.obtained_at,
       expires_at = excluded.expires_at,
       refresh_expires_at = excluded.refresh_expires_at,
       has_refresh = excluded.has_refresh,
       scopes = excluded.scopes,
       token_tail = excluded.token_tail,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    [
      provider,
      st.obtainedAt,
      st.expiresAt,
      st.refreshExpiresAt,
      st.hasRefresh ? 1 : 0,
      st.scopes,
      // ★末尾4桁のみ。本体は入れない
      st.present ? st.masked : null,
      st.expiresAt ? null : '期限は不明（.env に ALIEXPRESS_TOKEN_EXPIRES_AT が無い）',
      now,
    ],
  ).catch(() => {});
  return st;
}

/** 保存済みの素性を読む（画面表示用） */
export async function savedTokenMeta(provider = 'aliexpress'): Promise<Record<string, unknown> | null> {
  return (await one('SELECT * FROM provider_token_meta WHERE provider = ?', [provider]).catch(
    () => null,
  )) as Record<string, unknown> | null;
}
