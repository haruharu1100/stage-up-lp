/**
 * LIVE_DISCOVERY_READY の最終関門（LIVE READY GATE）
 * ===================================================================
 * ユーザー指示（2026-08-20・待機フェーズ）で条件が増えました。
 *
 *   これまで：4段階（DOCUMENTED → AUTHORIZED → CONNECTED → VERIFIED）が揃うこと
 *   これから：4段階に加えて、さらに次の4つまで通すこと
 *       ・実商品取得成功
 *       ・購入URL確認
 *       ・価格取得
 *       ・Amazon照合成功
 *
 * ★なぜ厳しくするのか
 *   「APIが呼べた」と「商売の判断に使える」は別物だから。
 *   URLが無ければ買いに行けないし、価格が無ければ利益が出せない。
 *   Amazonと結び付いていなければ、そもそも売れるかどうか分からない。
 *
 * ★証拠は必ずDBから読む。宣言では通さない。
 *   live_test_steps  … 鍵投入直後テスト（STEP1〜5）の記録
 *   research_runs    … Amazonとの照合が実際に成立した件数
 */
import { all, one } from '../db/client';

export interface LiveReadyEvidence {
  /** VERIFIED になっているAPI名 */
  verifiedApis: string[];
  /** 実商品を取得できた（STEP2が合格） */
  gotRealProduct: boolean;
  /** 購入ページURLを確認できた */
  gotPurchaseUrl: boolean;
  /** 価格を取得できた */
  gotPrice: boolean;
  /** Amazonとの照合が成立した件数（1件以上で合格） */
  amazonMatched: number;
  /** 全部そろったか */
  ready: boolean;
  /** 足りないものを日本語で */
  missing: string[];
}

/** live_test_steps から「STEP2に合格した記録」を1件読む */
async function step2Pass(): Promise<Record<string, unknown> | null> {
  return (await one(
    `SELECT * FROM live_test_steps
      WHERE step_key = 'SEARCH_ONE' AND passed = 1
      ORDER BY created_at DESC LIMIT 1`,
  ).catch(() => null)) as Record<string, unknown> | null;
}

/** unknown_fields（JSON配列）にその項目名が入っていなければ「取れた」 */
function gotField(row: Record<string, unknown> | null, name: string): boolean {
  if (!row) return false;
  try {
    const list: string[] = JSON.parse(String(row.unknown_fields ?? '[]'));
    return !list.includes(name);
  } catch {
    // ★読めなかったら「取れた」ことにしない。分からないものを合格にしない。
    return false;
  }
}

/**
 * いま LIVE_DISCOVERY_READY にしてよいか、証拠つきで判定する。
 * ★外部APIは1回も呼ばない。DBに残っている「実際にやった記録」だけを見る。
 */
export async function liveReadyEvidence(provider = 'aliexpress'): Promise<LiveReadyEvidence> {
  const rows = await all(
    `SELECT api_name FROM api_contract_registry
      WHERE provider = ? AND implementation_status = 'VERIFIED' ORDER BY api_name`,
    [provider],
  ).catch(() => [] as Record<string, unknown>[]);
  const verifiedApis = rows.map((r) => String(r.api_name));

  const s2 = await step2Pass();
  const gotRealProduct = !!s2;
  const gotPurchaseUrl = gotField(s2, '商品URL');
  const gotPrice = gotField(s2, '価格');

  const m = (await one(
    `SELECT COALESCE(MAX(match_candidates), 0) AS n FROM research_runs`,
  ).catch(() => null)) as Record<string, unknown> | null;
  const amazonMatched = Number(m?.n ?? 0) || 0;

  const missing: string[] = [];
  if (!verifiedApis.length) missing.push('VERIFIED（実データで確認できたAPIが0件）');
  if (!gotRealProduct) missing.push('実商品の取得（鍵投入直後テストのSTEP2が未合格）');
  if (!gotPurchaseUrl) missing.push('購入ページURLの確認');
  if (!gotPrice) missing.push('価格の取得');
  if (amazonMatched < 1) missing.push('Amazonとの照合成立（1件以上）');

  return {
    verifiedApis,
    gotRealProduct,
    gotPurchaseUrl,
    gotPrice,
    amazonMatched,
    ready: missing.length === 0,
    missing,
  };
}

/** なぜ true にできないのかを日本語1文で */
export function describeLiveReady(e: LiveReadyEvidence): string {
  if (e.ready) {
    return `実データまで確認できたAPI：${e.verifiedApis.join(' / ')}／購入URL・価格・Amazon照合まで確認済み`;
  }
  return (
    'まだ LIVE_DISCOVERY_READY にはできません。足りないもの：' +
    e.missing.join('、') +
    '（「0件でした」ではなく「まだそこまで通していない」という意味です）'
  );
}
