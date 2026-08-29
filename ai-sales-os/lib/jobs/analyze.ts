import { nowIso, upsert, type Row } from '../db/client';
import { loadCapabilities, type CapabilityRow } from '../catalog/sync';

/**
 * 案件の中身を読んで、自社（＝すでに作ってあるAI・システム）で作れるかを見る。
 *
 * ★Obsidianに実在する自社の道具（capabilities）だけを使う。
 *   「たぶん作れる」は数えない。道具が当たらなければ missing に入れて、受注可能性を下げる。
 */

export type JobAnalysis = {
  jobId: number;
  engine: 'rule' | 'openai';
  tasks: string[];
  matchedCaps: { code: string; name: string; hits: string[] }[];
  missingCaps: string[];
  estHours: number;
  automationRate: number;
  notes: string;
};

/** 案件文から作業のかたまりを拾う。 */
const TASK_HINTS: { key: string; label: string; patterns: RegExp[] }[] = [
  { key: 'RESEARCH', label: '調査・情報収集', patterns: [/リサーチ/, /市場調査/, /競合調査/, /情報収集/, /営業リスト/] },
  { key: 'WRITE', label: '文章作成', patterns: [/ライティング/, /記事/, /文章/, /コピー/, /キャッチ/, /説明文/, /台本/, /シナリオ/] },
  { key: 'DESIGN', label: '画像・デザイン', patterns: [/デザイン/, /バナー/, /サムネ/, /画像/, /イラスト/] },
  { key: 'BUILD', label: '構築・実装', patterns: [/構築/, /実装/, /開発/, /システム/, /サイト制作/, /LP制作/, /WordPress/i, /GAS/i, /スプレッドシート/] },
  { key: 'OPERATE', label: '運用・投稿', patterns: [/運用/, /投稿/, /更新/, /管理代行/] },
  { key: 'ANALYZE', label: '分析・集計', patterns: [/分析/, /集計/, /データ整理/, /レポート/] },
];

export function decomposeTasks(text: string): string[] {
  const out: string[] = [];
  for (const t of TASK_HINTS) {
    if (t.patterns.some((p) => p.test(text))) out.push(t.label);
  }
  return out.length > 0 ? out : ['内容の確認（作業の種類が読み取れない）'];
}

/** 案件文と自社の道具を、キーワードで突き合わせる。 */
export function matchCapabilities(text: string, caps: CapabilityRow[]): { code: string; name: string; hits: string[] }[] {
  const lower = text.toLowerCase();
  const out: { code: string; name: string; hits: string[] }[] = [];
  for (const c of caps) {
    const hits = c.keywords.filter((k) => lower.includes(k.toLowerCase()));
    if (hits.length > 0) out.push({ code: c.code, name: c.name, hits });
  }
  return out.sort((a, b) => b.hits.length - a.hits.length);
}

/**
 * どの案件にも必ずかかる時間（時間）。
 * 依頼文を読む・確認のやりとり・出来上がりの点検・受け渡し・1回分の手直し。
 * これを入れないと、AIが生成する時間だけで数分の案件に見えてしまい、
 * 時間あたりの利益が実態からかけ離れた大きさになる。
 */
const JOB_OVERHEAD_HOURS = 0.5;

/** 想定作業時間。当たった道具の想定時間を足す。当たらなければ「分からない」ではなく多めに見る。 */
function estimateHours(matched: { code: string }[], caps: CapabilityRow[], text: string): { hours: number; automation: number; note: string } {
  if (matched.length === 0) {
    // 自社の道具が1つも当たらない＝手作業になる。多めに見積もって、割に合わないことを見えるようにする。
    return { hours: 12, automation: 0, note: '自社の道具が当たらないので、手作業として多めに見積もっている' };
  }
  const byCode = new Map(caps.map((c) => [c.code, c]));
  let hours = 0;
  let weighted = 0;
  let heaviest = 0;
  for (const m of matched.slice(0, 3)) {
    const c = byCode.get(m.code);
    if (!c) continue;
    hours += c.unit_hours;
    weighted += c.automation_rate * c.unit_hours;
    if (c.unit_hours > heaviest) heaviest = c.unit_hours;
  }
  // 分量の手がかり（本数・記事数）を見る。
  // ★件数をそのまま掛けない。道具の想定時間には「一度だけ済む準備」も入っているので、
  //   20件だから20倍、とすると準備を20回やる計算になり、受けられる案件まで赤字に見える。
  //   1件目は準備込みの合計、2件目以降はいちばん重い作業の6割で数える。
  const qty = text.match(/([0-9０-９]{1,3})\s*(本|記事|件|ページ|枚)/);
  const n = qty ? Number(qty[1].replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)))) : 1;
  const mult = Number.isFinite(n) && n >= 1 && n <= 200 ? n : 1;
  const work = hours + (mult > 1 ? (mult - 1) * heaviest * 0.6 : 0);
  const total = Number((work + JOB_OVERHEAD_HOURS).toFixed(2));
  const automation = hours > 0 ? Number((weighted / hours).toFixed(2)) : 0;
  return {
    hours: total,
    automation,
    note:
      (mult > 1
        ? `分量${mult}${qty?.[2] ?? '件'}として計算（1件目は準備込みで${hours}時間、2件目以降は1件あたり${(heaviest * 0.6).toFixed(2)}時間）`
        : '1件分として計算') + `＋どの案件にもかかる${JOB_OVERHEAD_HOURS}時間`,
  };
}

export async function analyzeJob(job: Row): Promise<JobAnalysis> {
  const jobId = Number(job.id);
  const text = [job.title, job.description, job.category, job.work_style].filter(Boolean).map(String).join('\n');
  // 使えるのは「今すぐ動く道具」だけ。開発中のものを当てにしない。
  const caps = await loadCapabilities(true);
  const matched = matchCapabilities(text, caps);
  const tasks = decomposeTasks(text);
  const est = estimateHours(matched, caps, text);

  const missing = matched.length === 0 ? ['この案件に当たる自社の道具が無い'] : [];

  return {
    jobId,
    engine: 'rule',
    tasks,
    matchedCaps: matched,
    missingCaps: missing,
    estHours: est.hours,
    automationRate: est.automation,
    notes: est.note,
  };
}

export async function saveJobAnalysis(a: JobAnalysis): Promise<void> {
  await upsert(
    'job_analyses',
    {
      job_id: a.jobId,
      engine: a.engine,
      tasks: JSON.stringify(a.tasks),
      matched_caps: JSON.stringify(a.matchedCaps),
      missing_caps: JSON.stringify(a.missingCaps),
      est_hours: a.estHours,
      automation_rate: a.automationRate,
      notes: a.notes,
      analyzed_at: nowIso(),
    },
    ['job_id'],
  );
}
