import { all, nowIso, run } from '../db/client';
import { canAutoFetch, marketConnectorFor, type MarketCapabilities } from './market';

/**
 * 実市場データの定期観測（Phase 3.5・§4 §23）。
 *
 * 【今この瞬間の正直な状態】
 * 2026-08-20 時点で、この事業には
 * 公式API・法人API・正式なデータフィードの契約が1件も無い。
 * だから、この仕組みを動かしても取れるデータは0件になる。
 *
 * それでもこの層を作るのは、次の3つのため。
 *
 *   1. 契約が取れたとき、1市場ずつ差し込めるようにしておく（§4「一気に全部つながないでください」）
 *   2. 「なぜ0件なのか」を記録に残す。規約上できないのか、鍵が無いのか、実行していないのかを区別する
 *   3. 誰かが後から勝手にスクレイピングで埋める実装を足せないようにする
 *
 * 【絶対にやらないこと】
 * ・無断でサイトを自動巡回しない。取得手段は正規のものだけ（CLAUDE.md ルール1）
 * ・capability が 'api' でないものを自動実行しない（同ルール2）
 * ・「取れなかった」を「0件だった」とすり替えない
 */

/**
 * 1市場あたりの最短の呼び出し間隔（ミリ秒）。
 * 実際の上限は契約ごとに違うので、契約が取れたら市場ごとに設定へ移す。
 * 分からないうちは厳しい側（1分に1回）に置く。
 */
export const MIN_INTERVAL_MS = 60_000;

/** 1回の実行で1市場に投げる上限。取り過ぎない。 */
export const MAX_CALLS_PER_RUN = 30;

export type ObserveResult = {
  venueCode: string;
  operation: keyof MarketCapabilities;
  ok: boolean;
  reason: string;
  itemCount: number;
  message: string;
  sourceType: string;
};

/**
 * 直前の呼び出しからの間隔を守る。
 * 相手のサーバーに迷惑をかけないためであり、規約を守るためでもある。
 */
export async function rateLimitOk(venueCode: string, operation: string, now = Date.now()): Promise<boolean> {
  const rows = await all(
    `SELECT attempted_at FROM market_fetch_log
      WHERE venue_code = ? AND operation = ?
      ORDER BY id DESC LIMIT 1`,
    [venueCode, operation],
  );
  if (rows.length === 0) return true;
  const last = Date.parse(String(rows[0].attempted_at));
  if (!Number.isFinite(last)) return true;
  return now - last >= MIN_INTERVAL_MS;
}

async function logFetch(r: ObserveResult): Promise<void> {
  await run(
    `INSERT INTO market_fetch_log
      (venue_code, operation, attempted_at, ok, reason, source_type, item_count, message)
     VALUES (?,?,?,?,?,?,?,?)`,
    [r.venueCode, r.operation, nowIso(), r.ok ? 1 : 0, r.reason, r.sourceType, r.itemCount, r.message],
  );
}

/**
 * 1市場・1操作だけ観測する。
 *
 * 【1つずつしか動かさない】
 * ユーザー指示「一気に全部つながないでください」に従い、
 * この関数は1市場ぶんしか受け取らない。まとめて回す関数はわざと作らない。
 */
export async function observeOnce(
  venueCode: string,
  operation: keyof MarketCapabilities = 'fetchMarketStats',
  input?: { text?: string },
): Promise<ObserveResult> {
  const connector = marketConnectorFor(venueCode);

  // 自動で取ってよいのは 'api' だけ。環境変数で許可しても動かさない。
  if (!canAutoFetch(connector, operation) && !input?.text) {
    const r: ObserveResult = {
      venueCode, operation, ok: false,
      reason: 'CONNECTOR_NOT_AVAILABLE',
      itemCount: 0,
      sourceType: 'NONE',
      message: `${venueCode} は正規の自動取得手段（公式API・法人API・正式なデータフィード）が未契約のため、自動では取得しません。人が実際の画面を見て記録したCSVを取り込んでください。`,
    };
    await logFetch(r);
    return r;
  }

  if (!(await rateLimitOk(venueCode, operation))) {
    const r: ObserveResult = {
      venueCode, operation, ok: false,
      reason: 'RATE_LIMITED',
      itemCount: 0,
      sourceType: 'NONE',
      message: `${venueCode} への前回の取得から間隔が空いていません。相手先の負荷を避けるため見送りました。`,
    };
    await logFetch(r);
    return r;
  }

  const res = await connector[operation](input);
  const r: ObserveResult = {
    venueCode, operation,
    ok: res.ok,
    reason: res.reason,
    itemCount: res.items.length,
    sourceType: res.sourceType,
    message: res.message,
  };
  await logFetch(r);
  return r;
}

/** 画面用。いつ・どこに・何を試して、どうだったか。 */
export async function fetchLog(limit = 50) {
  return all(
    `SELECT venue_code, operation, attempted_at, ok, reason, source_type, item_count, message
       FROM market_fetch_log ORDER BY id DESC LIMIT ?`,
    [limit],
  );
}

/**
 * どの市場から実データを取れる見込みがあるか（§4 の進捗表）。
 * 「できない」を隠さずに並べる。ここが全部 unavailable なのが現状。
 */
export async function connectorStatus(): Promise<{
  venueCode: string;
  name: string;
  termsChecked: boolean;
  marketStats: string;
  fees: string;
  autoFetchAllowed: boolean;
  note: string;
}[]> {
  const venues = await all('SELECT code, name FROM venues ORDER BY code');
  return venues.map((v) => {
    const c = marketConnectorFor(String(v.code));
    return {
      venueCode: String(v.code),
      name: String(v.name),
      termsChecked: c.termsChecked,
      marketStats: c.capabilities.fetchMarketStats,
      fees: c.capabilities.fetchFees,
      autoFetchAllowed: canAutoFetch(c, 'fetchMarketStats'),
      note: canAutoFetch(c, 'fetchMarketStats')
        ? '正規のAPIで自動取得できる'
        : '正規の自動取得手段が未契約。人が画面を見て記録したCSVで取り込む',
    };
  });
}
