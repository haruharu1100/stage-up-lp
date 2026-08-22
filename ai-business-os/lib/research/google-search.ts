import { config } from '../env';
import { providerConfigured, search, searchBudgetStatus as budgetOf } from './providers';
import type { SearchRecord } from './judge';

/**
 * GOOGLE_LEGACY（旧・主要検索基盤）
 *
 * 2026-08-23 の判断：
 *   Google Custom Search JSON API は**新規顧客には提供されておらず、既存顧客向けも
 *   2027-01-01 に終了予定**。長期に使うシステムの中核へ据えると作り直しになるため、
 *   AI BUSINESS OS の主要検索基盤にはしない。
 *
 *   ・既存コードは消さない。`LEGACY / OPTIONAL` 扱いにして、鍵を持っている場合のみ動かす
 *   ・第一候補は BRAVE、第二候補（深掘り）は TAVILY（lib/research/providers.ts）
 *
 * このファイルは後方互換のための入口。実体は providers.ts と judge.ts にある。
 */

export {
  canonicalDomain,
  competitorNameOf,
  entityKeyOf,
  judgeFromSearches,
  judgeItem,
  MIN_SOURCES_TO_CONCLUDE,
  type CompetitorHit,
  type GoogleSearchRecord,
  type SearchJudgement,
  type SearchProviderKey,
  type SearchRecord,
  type SearchResultItem,
} from './judge';

/** Google の鍵が設定されているか。設定されていなければ Google は一切呼ばない */
export function googleSearchConfigured(): boolean {
  return providerConfigured('GOOGLE_LEGACY');
}

/** Google Custom Search はもう主要基盤ではない。ここが false なら新規採用を止めてよい */
export const GOOGLE_LEGACY_ONLY = true;

/** 終了予定日。ここを過ぎたら Google 経路は動かない前提で設計する */
export const GOOGLE_CSE_SHUTDOWN_DATE = '2027-01-01';

export const GOOGLE_LEGACY_REASON =
  'Google Custom Search JSON API は新規顧客への提供が停止され、既存顧客向けも2027-01-01に終了予定。' +
  '長期システムの依存先として不適切なため、主要検索基盤にはしない（既存コードは LEGACY / OPTIONAL として残す）。';

export async function searchBudgetStatus(): Promise<{ used: number; limit: number; left: number }> {
  const s = await budgetOf('GOOGLE_LEGACY');
  return { used: s.used, limit: s.limit, left: s.left };
}

/**
 * 旧・Google 直呼びの入口。
 * 今は共通の search() を Google 指定で呼ぶだけ。鍵が無ければ何もせず UNAVAILABLE を返す。
 */
export async function googleSearchJa(query: string): Promise<SearchRecord> {
  return search(query, { provider: 'GOOGLE_LEGACY' });
}

/** 旧設定の読み出し（1案件あたりの検索語数） */
export const googleSearchPerIdea = config.googleSearchPerIdea;
