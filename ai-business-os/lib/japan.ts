import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './env';
import { nowIso, run, all } from './db/client';
import type { DataStatus, Idea, JapanAssessment, JapanStage } from './types';

/**
 * 「日本未上陸」と簡単に断定しないための調査フレーム。
 * 公式APIが無いチャネル（Google/note/X/YouTube/PR TIMES）はスクレイピングせず、
 * 検索URLを生成して人が件数を data/japan-checks.csv に記入する方式にする。
 * 記入が無い間は 0 件ではなく「UNKNOWN / NOT_CONFIGURED」として扱う。
 */
export const JAPAN_CHANNELS = [
  { key: 'google', label: '日本語Google検索', url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=ja&lr=lang_ja` },
  { key: 'corp', label: '国内法人（国税庁法人番号）', url: (q: string) => `https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?q=${encodeURIComponent(q)}` },
  { key: 'saas', label: '国内SaaS比較サイト', url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q + ' site:boxil.jp OR site:it-trend.jp')}&hl=ja` },
  { key: 'note', label: 'note', url: (q: string) => `https://note.com/search?q=${encodeURIComponent(q)}` },
  { key: 'x', label: 'X', url: (q: string) => `https://x.com/search?q=${encodeURIComponent(q)}&f=live` },
  { key: 'youtube', label: 'YouTube', url: (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { key: 'prtimes', label: 'PR TIMES', url: (q: string) => `https://prtimes.jp/main/action.php?run=html&page=searchkey&search_word=${encodeURIComponent(q)}` },
] as const;

const CHECK_FILE = path.join(DATA_DIR, 'japan-checks.csv');

export const JAPAN_CHECKS_TEMPLATE = `idea_id,channel,hits,note
# 上のideasの日本語調査結果を手で記入する。件数不明の行は書かない（0と書かない）。
# channel: ${JAPAN_CHANNELS.map((c) => c.key).join(' / ')}
`;

export const JAPAN_CHECKS_PATH = CHECK_FILE;

type ManualCheck = { ideaId: string; channel: string; hits: number; note: string };

export function readManualChecks(): ManualCheck[] {
  if (!fs.existsSync(CHECK_FILE)) return [];
  const out: ManualCheck[] = [];
  for (const line of fs.readFileSync(CHECK_FILE, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#') || line.startsWith('idea_id')) continue;
    const [ideaId, channel, hits, note] = line.split(',').map((s) => (s ?? '').trim());
    const n = Number(hits);
    if (!ideaId || !channel || !Number.isFinite(n)) continue;
    out.push({ ideaId, channel, hits: n, note: note ?? '' });
  }
  return out;
}

/** 総ヒット数から普及段階を決める（しきい値はコードで固定。AIに決めさせない） */
export function stageFromHits(totalHits: number, channelsWithData: number): JapanStage {
  if (channelsWithData === 0) return 'UNKNOWN';
  if (totalHits === 0) return 'NOT_FOUND';
  if (totalHits < 10) return 'EARLY';
  if (totalHits < 100) return 'EMERGING';
  if (totalHits < 1000) return 'COMPETITIVE';
  return 'MATURE';
}

export const STAGE_LABEL: Record<JapanStage, string> = {
  NOT_FOUND: '国内に見当たらない',
  EARLY: 'ごく初期',
  EMERGING: '立ち上がり中',
  COMPETITIVE: '競争あり',
  MATURE: '成熟',
  UNKNOWN: '未調査',
};

/** 未普及度の点数化（15点満点の達成率）。UNKNOWN は null（0点にしない） */
export function stageRatio(stage: JapanStage): number | null {
  switch (stage) {
    case 'NOT_FOUND':
      return 1.0;
    case 'EARLY':
      return 0.85;
    case 'EMERGING':
      return 0.6;
    case 'COMPETITIVE':
      return 0.25;
    case 'MATURE':
      return 0.05;
    default:
      return null;
  }
}

export async function assessJapan(idea: Idea): Promise<JapanAssessment> {
  const manual = readManualChecks().filter((m) => m.ideaId === idea.id);
  const checked = JAPAN_CHANNELS.map((c) => {
    const hit = manual.find((m) => m.channel === c.key);
    const status: DataStatus = hit ? 'DATA_AVAILABLE' : 'NOT_CONFIGURED';
    return {
      channel: c.label,
      hits: hit ? hit.hits : null,
      status,
      note: hit ? hit.note : `未調査。確認URL: ${c.url(idea.title)}`,
    };
  });
  const withData = checked.filter((c) => c.hits !== null);
  const total = withData.reduce((s, c) => s + (c.hits ?? 0), 0);
  const stage = stageFromHits(total, withData.length);
  const assessment: JapanAssessment = {
    ideaId: idea.id,
    stage,
    status: withData.length ? 'DATA_AVAILABLE' : 'NOT_CONFIGURED',
    checked,
    assessedAt: nowIso(),
  };
  await run(
    `INSERT INTO japan_assessments (idea_id, stage, status, checked_json, assessed_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(idea_id) DO UPDATE SET stage=excluded.stage, status=excluded.status,
       checked_json=excluded.checked_json, assessed_at=excluded.assessed_at`,
    [idea.id, stage, assessment.status, JSON.stringify(checked), assessment.assessedAt]
  );
  return assessment;
}

export async function getJapanAssessment(ideaId: string): Promise<JapanAssessment | null> {
  const rows = await all<{
    idea_id: string;
    stage: JapanStage;
    status: DataStatus;
    checked_json: string;
    assessed_at: string;
  }>('SELECT * FROM japan_assessments WHERE idea_id = ?', [ideaId]);
  if (!rows[0]) return null;
  return {
    ideaId: rows[0].idea_id,
    stage: rows[0].stage,
    status: rows[0].status,
    checked: JSON.parse(rows[0].checked_json),
    assessedAt: rows[0].assessed_at,
  };
}

/** 人が調査するためのチェックリスト（検索URL付き） */
export function japanChecklist(idea: { id: string; title: string }) {
  const q = idea.title;
  return JAPAN_CHANNELS.map((c) => ({ channel: c.key, label: c.label, url: c.url(q) }));
}
