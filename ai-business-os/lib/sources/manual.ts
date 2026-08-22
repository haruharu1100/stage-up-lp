import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../env';
import type { FetchResult, RawItem } from './common';

const FILE = path.join(DATA_DIR, 'manual-ideas.csv');

/**
 * 公式APIが無いソース（YC / Indie Hackers / AppSumo / Substack など）は
 * スクレイピングせず、人が見つけたものをこのCSVに書いて取り込む。
 * 列: title,summary,url,service_name,country,published_at,source_name
 */
export function fetchManual(): FetchResult {
  if (!fs.existsSync(FILE)) {
    return {
      source: '手入力CSV',
      query: FILE,
      status: 'NOT_CONFIGURED',
      message: `${FILE} が無い（テンプレートは npm run init で作成）`,
      items: [],
    };
  }
  const text = fs.readFileSync(FILE, 'utf8').trim();
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length <= 1) {
    return { source: '手入力CSV', query: FILE, status: 'NO_DATA', message: '本文行なし', items: [] };
  }
  const items: RawItem[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsv(line);
    if (cols.length < 3 || !cols[0] || !cols[2]) continue;
    items.push({
      title: cols[0],
      summary: cols[1] ?? '',
      url: cols[2],
      serviceName: cols[3] || cols[0],
      country: cols[4] || 'UNKNOWN',
      publishedAt: cols[5] || null,
      sourceName: cols[6] || '手入力',
    });
  }
  return {
    source: '手入力CSV',
    query: FILE,
    status: items.length ? 'DATA_AVAILABLE' : 'PARSE_ERROR',
    message: `${items.length}件`,
    items,
  };
}

export const MANUAL_CSV_PATH = FILE;

export const MANUAL_CSV_TEMPLATE = `title,summary,url,service_name,country,published_at,source_name
# 公式APIが無いソース（YC / Indie Hackers / AppSumo / Substack 等）はここに手で書く
# 例: AI Receptionist for Roofing,屋根工事会社向けAI電話受付。月$299,https://example.com,ExampleAI,US,2026-06-01,Indie Hackers
`;

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
