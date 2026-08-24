/**
 * Keepaが実際に消費したトークン数を数える（Discovery KPI ⑦）。
 * ===================================================================
 * ユーザー指示のKPIには「Keepa消費トークン」がある。
 *
 * ★「呼び出し回数」とは別物
 *   1回の呼び出しでも、取る商品数やオプション（出品者一覧・価格履歴など）で
 *   消費するトークン数が変わる。回数をトークン数として言い換えるのは嘘になる。
 *   Keepaは応答の中に `tokensConsumed` を入れてくるので、それを素直に足す。
 *
 * ★数えられなかったときは 0 にしない
 *   応答にトークン数が入っていなければ、何も足さない。
 *   一度も数えられなければ `null`（＝不明）のままにして、
 *   画面には「まだ出せません」と出す。0と混ぜない。
 */
let consumed: number | null = null;
let measured = false;

/** Keepaの応答からトークン消費量を拾って足す。入っていなければ何もしない */
export function addKeepaTokens(json: unknown): void {
  const n = Number((json as { tokensConsumed?: unknown })?.tokensConsumed);
  if (!Number.isFinite(n) || n < 0) return;
  consumed = (consumed ?? 0) + n;
  measured = true;
}

/** 今の実行でKeepaが消費したトークン数。数えられていなければ null（＝不明） */
export function keepaTokensConsumed(): number | null {
  return measured ? consumed : null;
}

/** 実行の開始時に呼んで数えなおす */
export function resetKeepaTokenMeter(): void {
  consumed = null;
  measured = false;
}
