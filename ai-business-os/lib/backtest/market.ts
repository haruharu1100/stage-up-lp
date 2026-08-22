import { all, nowIso, run } from '../db/client';
import type { Idea } from '../types';
import { countHackerNewsMentions } from '../sources/hackernews';
import { countGithubRepos } from '../sources/github';
import type { DataStatus, MarketBacktest } from '../types';

/**
 * 市場バックテスト＝「この戦略を3/6/12ヶ月前に始めていたら、その時点で兆しが見えていたか」を
 * 実際の言及数の推移で確かめる。件数0とデータ取得失敗は必ず区別する。
 */
const WINDOWS = [
  { label: '直近3ヶ月', fromMonths: 3, toMonths: 0 },
  { label: '3〜6ヶ月前', fromMonths: 6, toMonths: 3 },
  { label: '6〜12ヶ月前', fromMonths: 12, toMonths: 6 },
  { label: '12〜24ヶ月前', fromMonths: 24, toMonths: 12 },
];

function monthsAgo(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

/** これ未満の件数では傾向を語らない（1件→2件を「2倍成長」と言わないため） */
const MIN_MENTIONS_FOR_TREND = 5;

/**
 * 市場の検索語は「その案件を見つけたときの検索語」を使う。
 * 記事タイトルをそのまま検索すると固有名詞が効きすぎて0件になり、傾向が測れない。
 */
export async function marketQueryFor(idea: Idea): Promise<string> {
  const rows = await all<{ note: string }>(
    'SELECT note FROM evidences WHERE idea_id = ? ORDER BY id LIMIT 1',
    [idea.id]
  );
  const note = rows[0]?.note ?? '';
  const m = note.match(/検索クエリ:\s*(.+)$/);
  if (m && m[1]) {
    // GitHub検索の絞り込み（in:name stars:>50 など）は他の情報源では検索語として使えない
    const cleaned = m[1]
      .split(/\s+/)
      .filter((w) => !w.includes(':'))
      .join(' ')
      .trim();
    if (cleaned && !cleaned.includes('/') && cleaned.length < 60) return cleaned;
  }
  return idea.title.split(/[:—–\-|]/)[0].trim().slice(0, 50);
}

export async function runMarketBacktest(
  ideaId: string,
  query: string
): Promise<MarketBacktest> {
  const windows: MarketBacktest['windows'] = [];

  for (const w of WINDOWS) {
    const from = monthsAgo(w.fromMonths);
    const to = monthsAgo(w.toMonths);
    const hn = await countHackerNewsMentions(
      query,
      Math.floor(from.getTime() / 1000),
      Math.floor(to.getTime() / 1000)
    );
    const gh = await countGithubRepos(query, from.toISOString(), to.toISOString());

    let mentions: number | null = null;
    let status: DataStatus = 'NO_DATA';
    if (hn.count !== null || gh.count !== null) {
      mentions = (hn.count ?? 0) + (gh.count ?? 0);
      status = 'DATA_AVAILABLE';
    } else {
      status = hn.status === 'DATA_AVAILABLE' ? gh.status : hn.status;
    }
    windows.push({ label: w.label, months: w.fromMonths, mentions, status });
  }

  const recent = windows[0].mentions;
  const prior = windows[1].mentions;
  const older = windows[2].mentions;

  let trend: MarketBacktest['trend'] = 'INSUFFICIENT_DATA';
  let growthRatio: number | null = null;
  let verdict = 'データ不足のため成長性を判定しない';

  const usable = [recent, prior, older].filter((v) => v !== null).length;
  const peak = Math.max(...[recent, prior, older].map((v) => v ?? 0));

  if (usable >= 2 && peak < MIN_MENTIONS_FOR_TREND) {
    verdict = `言及が最大でも${peak}件しかない。件数が少なすぎるため傾向を判定しない`;
  } else if (usable >= 2 && recent !== null && prior !== null) {
    const base = prior === 0 ? null : prior;
    if (base === null) {
      // 過去が0で今があるのは「新しく生まれた」＝成長。倍率は計算不能なので出さない
      trend = recent > 0 ? 'GROWING' : 'INSUFFICIENT_DATA';
      verdict = recent > 0 ? '3〜6ヶ月前は言及ゼロ、直近で出現。ごく初期の可能性' : '言及が見つからない';
    } else {
      growthRatio = recent / base;
      if (growthRatio >= 1.3) trend = 'GROWING';
      else if (growthRatio >= 0.8) trend = 'FLAT';
      else trend = 'DECLINING';
      verdict =
        `直近3ヶ月の言及 ${recent}件 / 3〜6ヶ月前 ${prior}件 = ${growthRatio.toFixed(2)}倍。` +
        (older !== null ? ` 6〜12ヶ月前は${older}件。` : '') +
        (trend === 'GROWING'
          ? ' 3ヶ月前に着手していれば立ち上がりに乗れた可能性が高い。'
          : trend === 'FLAT'
            ? ' 横ばい。早く始める利点は小さい。'
            : ' 減少傾向。今から入るのは不利。');
    }
  }

  const result: MarketBacktest = {
    ideaId,
    windows,
    trend,
    growthRatio,
    verdict,
    ranAt: nowIso(),
  };

  await run(
    `INSERT INTO market_backtests (idea_id, windows_json, trend, growth_ratio, verdict, ran_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(idea_id) DO UPDATE SET windows_json=excluded.windows_json, trend=excluded.trend,
       growth_ratio=excluded.growth_ratio, verdict=excluded.verdict, ran_at=excluded.ran_at`,
    [ideaId, JSON.stringify(windows), trend, growthRatio, verdict, result.ranAt]
  );

  return result;
}

export async function getMarketBacktest(ideaId: string): Promise<MarketBacktest | null> {
  const rows = await all<{
    idea_id: string;
    windows_json: string;
    trend: MarketBacktest['trend'];
    growth_ratio: number | null;
    verdict: string;
    ran_at: string;
  }>('SELECT * FROM market_backtests WHERE idea_id = ?', [ideaId]);
  const r = rows[0];
  if (!r) return null;
  return {
    ideaId: r.idea_id,
    windows: JSON.parse(r.windows_json),
    trend: r.trend,
    growthRatio: r.growth_ratio,
    verdict: r.verdict,
    ranAt: r.ran_at,
  };
}
