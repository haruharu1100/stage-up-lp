import { all, nowIso, run } from '../db/client';
import { config } from '../env';
import { readManualChecks } from '../japan';
import type { Idea, JapanStage } from '../types';
import { MAX_QUERIES, japaneseKeywords } from './keywords-ja';
import {
  googleSearchJa,
  judgeFromSearches,
  type GoogleSearchRecord,
  type SearchJudgement,
} from './google-search';
import {
  checkCorp,
  checkGithubJa,
  checkGoogleJa,
  checkNote,
  checkPrTimes,
  checkWikipediaJa,
  checkXJa,
  checkYoutubeJa,
  type ChannelResult,
  type Competitor,
} from './channels-ja';

/**
 * JAPAN_MARKET_RESEARCHER
 * 海外案件ごとに日本語市場を調べ、5段階の普及度と根拠を残す。
 *
 * 判定の考え方：
 *   「日本語ページが何万件あるか」ではなく「上位に国内の競合サービスが何社いるか」で決める。
 *   ページ数は関連記事や海外記事の翻訳でいくらでも膨らみ、競合の多さを表さないため。
 *   ページ数は極端に少ない/多いときの補正にだけ使う。
 */

export type JapanResearch = {
  ideaId: string;
  queries: string[];
  channels: ChannelResult[];
  competitors: Competitor[];
  domesticCount: number;
  stage: JapanStage;
  confidence: number; // 0〜1
  humanCorrected: boolean;
  reason: string;
  researchedAt: string;
};

/** 競合とみなす類似度の下限。これ未満は「たまたま単語が被っただけ」として数えない */
const COMPETITOR_SIMILARITY_MIN = 0.5;

function stageFromCompetitors(domestic: number): JapanStage {
  if (domestic === 0) return 'NOT_FOUND';
  if (domestic <= 2) return 'EARLY';
  if (domestic <= 5) return 'EMERGING';
  if (domestic <= 9) return 'COMPETITIVE';
  return 'MATURE';
}

/**
 * これ以上の確度が既にあるなら、無料枠を使ってまで調べ直さない。
 * （検索の無料枠は1日100回しかなく、まだ一度も調べていない案件に回したほうが得るものが大きい）
 */
export const ENOUGH_CONFIDENCE = 0.6;

/** 既に十分な根拠があるか。人が確認済み、または実測で確度0.6以上 */
export function hasEnoughEvidence(prior: JapanResearch | null): boolean {
  if (!prior) return false;
  if (prior.humanCorrected) return true;
  return prior.stage !== 'UNKNOWN' && prior.confidence >= ENOUGH_CONFIDENCE;
}

const ORDER: JapanStage[] = ['NOT_FOUND', 'EARLY', 'EMERGING', 'COMPETITIVE', 'MATURE'];

function shift(stage: JapanStage, by: number): JapanStage {
  const i = ORDER.indexOf(stage);
  if (i < 0) return stage;
  return ORDER[Math.min(ORDER.length - 1, Math.max(0, i + by))];
}

/** 複数検索の判定結果を、既存のチャネル表示にそのまま載せられる形へ変換する */
export function channelFromSearch(search: SearchJudgement): ChannelResult {
  const failed = search.records.find((r) => r.status !== 'DATA_AVAILABLE');
  const ok = search.records.some((r) => r.status === 'DATA_AVAILABLE');
  return {
    key: 'google_search_ja',
    label: '日本語一般検索（複数語）',
    query: search.queries.join(' / '),
    // 件数は参考値。判定には使っていないことを reason 側で明記している
    hits: ok ? search.totalResultsMax : null,
    status: ok ? 'DATA_AVAILABLE' : failed ? failed.status : 'UNAVAILABLE',
    competitors: search.domesticCompetitors.map((c) => ({
      serviceName: c.competitorName,
      url: c.url,
      origin: 'DOMESTIC' as const,
      similarity: c.similarityScore,
      snippet: c.snippet,
    })),
    strength: 'STRONG',
    note: ok
      ? `${search.records.filter((r) => r.status === 'DATA_AVAILABLE').length}本の検索語で実測。国内の類似サービス${search.domesticCompetitors.length}社`
      : (failed?.note ?? '検索未実行'),
    checkedAt: new Date().toISOString(),
  };
}

export type ResearchOptions = {
  /** 既に十分な根拠があっても調べ直す */
  force?: boolean;
};

export async function researchJapan(idea: Idea, opts: ResearchOptions = {}): Promise<JapanResearch> {
  const prior = await getJapanResearch(idea.id);
  if (!opts.force && hasEnoughEvidence(prior) && prior) {
    // 無料枠を、まだ一度も調べていない案件に回すため再検索しない
    return prior;
  }

  const kw = japaneseKeywords(idea);
  const primary = kw.queries[0] ?? idea.title;

  // --- 日本語一般検索（複数の言い換えで引く） ---
  // 1本の検索語だけだと「その言い方をしていない競合」を丸ごと見落とすため、
  // 業種違い・言い換え・「SaaS 日本」などを混ぜて最大 GOOGLE_SEARCH_PER_IDEA 本まで引く。
  const perIdea = Math.max(1, Math.min(MAX_QUERIES, config.googleSearchPerIdea));
  const searchRecords: GoogleSearchRecord[] = [];
  for (const q of kw.queries.slice(0, perIdea)) {
    searchRecords.push(await googleSearchJa(q));
  }
  const search = judgeFromSearches(searchRecords);
  const searchChannel = channelFromSearch(search);

  // 課金と時間を抑えるため、各チャネルへ投げるのは代表クエリ1本だけにする
  const channels: ChannelResult[] = [
    searchChannel,
    await checkGoogleJa(primary),
    await checkGoogleJa(primary, 'site:boxil.jp OR site:it-trend.jp'),
    await checkWikipediaJa(primary),
    await checkGithubJa(primary),
    await checkYoutubeJa(primary),
    checkXJa(primary),
    checkNote(primary),
    checkPrTimes(primary),
    checkCorp(primary),
  ];

  const withData = channels.filter((c) => c.hits !== null);
  const strongWithData = withData.filter((c) => c.strength === 'STRONG');

  const competitors: Competitor[] = [];
  const seen = new Set<string>();
  for (const c of channels) {
    for (const comp of c.competitors) {
      const k = comp.url.split('?')[0];
      if (seen.has(k)) continue;
      seen.add(k);
      competitors.push(comp);
    }
  }
  const domestic = competitors.filter(
    (c) => c.origin === 'DOMESTIC' && c.similarity >= COMPETITOR_SIMILARITY_MIN
  );

  // --- 人による最終補正（data/japan-checks.csv）が最優先 ---
  const manual = readManualChecks().filter((m) => m.ideaId === idea.id);
  const humanCorrected = manual.length > 0;

  let stage: JapanStage;
  let confidence: number;
  let reason: string;

  if (humanCorrected) {
    const total = manual.reduce((s, m) => s + m.hits, 0);
    stage = total === 0 ? 'NOT_FOUND' : total < 10 ? 'EARLY' : total < 100 ? 'EMERGING' : total < 1000 ? 'COMPETITIVE' : 'MATURE';
    confidence = 0.95;
    reason = `人が調査した${manual.length}チャネルの合計${total}件による判定（自動調査より優先）`;
  } else if (search.stage !== 'UNKNOWN') {
    // 日本語一般検索の実測が最も強い根拠。件数ではなく「実在する国内サービスの社数」で決める
    stage = search.stage;
    confidence = search.confidence;
    reason = search.reason;
  } else if (withData.length === 0) {
    stage = 'UNKNOWN';
    confidence = 0;
    reason = 'どのチャネルからもデータを取得できなかった。0件ではなく未取得として扱う';
  } else if (strongWithData.length > 0) {
    const pageHits = strongWithData.reduce((s, c) => s + (c.hits ?? 0), 0);
    let s0 = stageFromCompetitors(domestic.length);
    let adj = '';
    if (pageHits < 1000) {
      s0 = shift(s0, -1);
      adj = `日本語ページが${pageHits}件と非常に少ないため1段下げた`;
    } else if (pageHits > 1_000_000) {
      s0 = shift(s0, 1);
      adj = `日本語ページが${pageHits.toLocaleString()}件と非常に多いため1段上げた`;
    }
    stage = s0;
    confidence = Math.min(0.9, 0.7 + (withData.length >= 4 ? 0.1 : 0));
    reason =
      `検索語「${primary}」の日本語検索結果の上位で、国内サービスとみなせるものが${domestic.length}件。` +
      (adj ? ` ${adj}。` : '') +
      ` 取得できたチャネル${withData.length}件。`;
  } else {
    // 弱い指標（Wikipedia/GitHub/YouTube/X）しか無い場合は断定しない
    const weakHits = withData.reduce((s, c) => s + (c.hits ?? 0), 0);
    stage = domestic.length > 0 ? stageFromCompetitors(domestic.length) : weakHits === 0 ? 'NOT_FOUND' : 'EARLY';
    confidence = 0.35;
    reason =
      `日本語一般検索を実行できなかったため（${searchChannel.note}）、Wikipedia・GitHub等の間接的な指標のみで推定` +
      `（合計${weakHits}件、国内らしき競合${domestic.length}件）。確度が低いので人の確認が要る。`;
  }

  // 国内競合の数え方は、検索の実測があるときは会社（ドメイン）単位の社数を使う。
  // 同じ会社の別ページを2社と数えないため。
  const domesticCount =
    !humanCorrected && search.stage !== 'UNKNOWN' ? search.domesticCompetitors.length : domestic.length;

  const result: JapanResearch = {
    ideaId: idea.id,
    queries: kw.queries,
    channels,
    competitors,
    domesticCount,
    stage,
    confidence: Math.round(confidence * 100) / 100,
    humanCorrected,
    reason,
    researchedAt: nowIso(),
  };

  await run(
    `INSERT INTO japan_research (idea_id, queries_json, channels_json, domestic_count, stage, confidence, human_corrected, reason, researched_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(idea_id) DO UPDATE SET queries_json=excluded.queries_json, channels_json=excluded.channels_json,
       domestic_count=excluded.domestic_count, stage=excluded.stage, confidence=excluded.confidence,
       human_corrected=excluded.human_corrected, reason=excluded.reason, researched_at=excluded.researched_at`,
    [
      idea.id,
      JSON.stringify(kw.queries),
      JSON.stringify(channels),
      domesticCount,
      stage,
      result.confidence,
      humanCorrected ? 1 : 0,
      reason,
      result.researchedAt,
    ]
  );

  await run('DELETE FROM japan_competitors WHERE idea_id = ?', [idea.id]);
  for (const c of competitors) {
    await run(
      `INSERT INTO japan_competitors (idea_id, channel, service_name, url, origin, similarity, snippet, found_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        idea.id,
        channels.find((ch) => ch.competitors.includes(c))?.key ?? 'unknown',
        c.serviceName,
        c.url,
        c.origin,
        c.similarity,
        c.snippet,
        result.researchedAt,
      ]
    );
  }

  // 既存の japan_assessments も更新して、採点側の入口を1本に保つ
  await run(
    `INSERT INTO japan_assessments (idea_id, stage, status, checked_json, assessed_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(idea_id) DO UPDATE SET stage=excluded.stage, status=excluded.status,
       checked_json=excluded.checked_json, assessed_at=excluded.assessed_at`,
    [
      idea.id,
      stage,
      withData.length ? 'DATA_AVAILABLE' : 'NOT_CONFIGURED',
      JSON.stringify(
        channels.map((c) => ({ channel: c.label, hits: c.hits, status: c.status, note: c.note }))
      ),
      result.researchedAt,
    ]
  );

  return result;
}

export async function getJapanResearch(ideaId: string): Promise<JapanResearch | null> {
  const rows = await all<{
    idea_id: string;
    queries_json: string;
    channels_json: string;
    domestic_count: number;
    stage: JapanStage;
    confidence: number;
    human_corrected: number;
    reason: string;
    researched_at: string;
  }>('SELECT * FROM japan_research WHERE idea_id = ?', [ideaId]);
  const r = rows[0];
  if (!r) return null;
  const channels: ChannelResult[] = JSON.parse(r.channels_json);
  return {
    ideaId: r.idea_id,
    queries: JSON.parse(r.queries_json),
    channels,
    competitors: channels.flatMap((c) => c.competitors),
    domesticCount: r.domestic_count,
    stage: r.stage,
    confidence: r.confidence,
    humanCorrected: r.human_corrected === 1,
    reason: r.reason,
    researchedAt: r.researched_at,
  };
}
