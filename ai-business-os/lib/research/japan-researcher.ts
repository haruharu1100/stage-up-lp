import { all, nowIso, run } from '../db/client';
import { readManualChecks } from '../japan';
import type { Idea, JapanStage } from '../types';
import { japaneseKeywords } from './keywords-ja';
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

const ORDER: JapanStage[] = ['NOT_FOUND', 'EARLY', 'EMERGING', 'COMPETITIVE', 'MATURE'];

function shift(stage: JapanStage, by: number): JapanStage {
  const i = ORDER.indexOf(stage);
  if (i < 0) return stage;
  return ORDER[Math.min(ORDER.length - 1, Math.max(0, i + by))];
}

export async function researchJapan(idea: Idea): Promise<JapanResearch> {
  const kw = japaneseKeywords(idea);
  const primary = kw.queries[0] ?? idea.title;

  // 課金と時間を抑えるため、各チャネルへ投げるのは代表クエリ1本だけにする
  const channels: ChannelResult[] = [
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
      `Google検索の鍵が無いため、Wikipedia・GitHub等の間接的な指標のみで推定（合計${weakHits}件、国内らしき競合${domestic.length}件）。` +
      ' 確度が低いので人の確認が要る。';
  }

  const result: JapanResearch = {
    ideaId: idea.id,
    queries: kw.queries,
    channels,
    competitors,
    domesticCount: domestic.length,
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
      domestic.length,
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
