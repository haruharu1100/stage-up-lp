import { nowIso, run, all } from './db/client';
import { checkCompliance } from './compliance';
import { campaignId, contentId, buildUtm } from './utm';
import type { Idea, MarketBacktest, SalesBacktest, ScoreResult } from './types';

/** X投稿の分類（フォロワー数ではなく契約に繋げるための役割分担） */
export const X_POST_TYPES = [
  { key: 'OVERSEAS_NEWS', label: '海外AI速報', goal: 'REACH' },
  { key: 'SIDE_BUSINESS', label: 'AI副業', goal: 'REACH' },
  { key: 'SUCCESS_CASE', label: '成功事例', goal: 'FOLLOW' },
  { key: 'FAILURE_CASE', label: '失敗事例', goal: 'FOLLOW' },
  { key: 'NUMBERS', label: '数字公開', goal: 'FOLLOW' },
  { key: 'TOOL', label: 'AIツール紹介', goal: 'REACH' },
  { key: 'EXPERIMENT', label: '実験', goal: 'COMMUNITY' },
  { key: 'VERIFICATION', label: '検証', goal: 'COMMUNITY' },
  { key: 'BACKTEST', label: 'バックテスト', goal: 'FOLLOW' },
  { key: 'COMPARISON', label: '比較', goal: 'REACH' },
  { key: 'HOWTO', label: 'ノウハウ', goal: 'FOLLOW' },
  { key: 'PROBLEM', label: '問題提起', goal: 'SALES' },
] as const;

/** 有料noteの基本構成（13章） */
export const NOTE_SECTIONS = [
  '強烈なフック（海外ではもう始まっている）',
  'なぜ今なのか',
  '日本との差',
  '実例',
  '収益モデル',
  '必要ツール',
  '実践方法',
  '自動化',
  'バックテスト',
  'リスク',
  '実行手順',
  'テンプレ',
  '次のステップ',
];

export type GeneratedContent = {
  id: string;
  channel: 'X' | 'NOTE' | 'LP' | 'SALES';
  postType: string;
  title: string;
  body: string;
  utm: string;
  issues: ReturnType<typeof checkCompliance>;
};

type Ctx = {
  idea: Idea;
  score: ScoreResult | null;
  market: MarketBacktest | null;
  sales: SalesBacktest | null;
};

function evidenceLine(ctx: Ctx): string {
  const m = ctx.market;
  if (!m || m.trend === 'INSUFFICIENT_DATA') return '※現時点で成長性を裏づけるデータは取れていません（判定保留）。';
  return `※根拠: ${m.verdict}`;
}

function moneyLine(ctx: Ctx): string {
  const s = ctx.sales;
  if (!s || s.verdict === 'INSUFFICIENT_DATA') return '※収益試算はまだ検証段階です。';
  return (
    `※試算（${s.runs}回シミュレーション）: 契約数の中央値 ${s.contracts.median}件、` +
    `悲観側P10 ${s.contracts.p10}件。断定ではなく幅で見ています。`
  );
}

export function generateXPosts(ctx: Ctx, noteUrl: string): GeneratedContent[] {
  const camp = campaignId(ctx.idea.id, 1);
  const t = ctx.idea.title;
  const out: GeneratedContent[] = [];

  const drafts: { type: string; title: string; body: string }[] = [
    {
      type: 'OVERSEAS_NEWS',
      title: '海外AI速報',
      body: `海外で「${t}」という動きが出ています。\n\n${ctx.idea.summary || '概要は出典を参照。'}\n\n${evidenceLine(ctx)}\n出典: ${ctx.idea.sourceUrl}`,
    },
    {
      type: 'BACKTEST',
      title: 'バックテスト',
      body: `「${t}」を3ヶ月前に始めていたらどうだったかを、実際の言及数で数えました。\n\n${evidenceLine(ctx)}\n\n数字が足りない項目は「判定不能」と書いています。`,
    },
    {
      type: 'NUMBERS',
      title: '数字公開',
      body: `${t} の収益試算を公開します。\n\n${moneyLine(ctx)}\n\n固定値で「儲かる」と言わず、悲観〜楽観の幅で出しています。`,
    },
    {
      type: 'PROBLEM',
      title: '問題提起',
      body: `${t} が解こうとしている問題は、日本では今も人手でやっている会社が多い領域です。\n\n同じ仕組みを自社で試せる無料デモを用意しています。`,
    },
    {
      type: 'HOWTO',
      title: 'ノウハウ',
      body: `${t} を自分で試すなら、順番はこうです。\n\n1. 対象業種を1つに絞る\n2. 現状の作業時間を計る\n3. 小さく1工程だけAIに置き換える\n4. 数字が動いたか確認する\n\n詳細は無料noteにまとめています。`,
    },
    {
      type: 'FAILURE_CASE',
      title: '失敗事例',
      body: `うまくいかなかった条件も残しています。\n\n例: 対象を広げすぎて誰にも刺さらない／効果を測る前に本番投入する／少ない件数で結論を出す。\n\n失敗の条件のほうが次に効きます。`,
    },
  ];

  drafts.forEach((d, i) => {
    const cid = contentId('post', i + 1);
    const utm = buildUtm({ source: 'x', medium: 'social', campaign: camp, content: cid });
    const body = `${d.body}\n\n${noteUrl}?${utm}`;
    out.push({
      id: `${ctx.idea.id}_x_${cid}`,
      channel: 'X',
      postType: d.type,
      title: d.title,
      body,
      utm,
      issues: checkCompliance(body),
    });
  });

  return out;
}

/**
 * 有料noteの最後を「読んで終わり」にしない。
 * 商品階層の1つ上の商品へ自然につながる文面を、価格帯ごとに決めて返す。
 */
function nextStepBlock(priceYen: number, utm: string): string[] {
  if (priceYen <= 980) {
    return [
      'ここまでで「何をやるか」は分かった状態です。次に必要なのは、実際に自分の業種でどう組むかです。',
      `実践編（2,980円）で、業種を1つに絞った組み立て手順と失敗条件をまとめています: /note/practice?${utm}`,
    ];
  }
  if (priceYen <= 2980) {
    return [
      '実践編までで、1工程を自動化するところまでは進められます。全工程をつなぐと運用の話になります。',
      `完全版教材（9,800円）に、全工程の設計・運用・計測までを入れています: /note/full?${utm}`,
    ];
  }
  if (priceYen <= 9800) {
    return [
      '教材どおりに作れば動きます。ただし「作る時間が無い」「社内に触れる人がいない」場合は、作らずに使う選択肢があります。',
      `まず無料デモで実物を触ってください: /demo?${utm}`,
      '導入は LIGHT 月29,800円 / STANDARD 月49,800円 / PRO 月98,000円（通常価格のみ）。効果には条件があり、成果を保証するものではありません。',
    ];
  }
  return [`無料デモ: /demo?${utm}`];
}

export function generateNoteOutline(ctx: Ctx, priceYen: number): GeneratedContent {
  const t = ctx.idea.title;
  const camp = campaignId(ctx.idea.id, 1);
  const utm = buildUtm({ source: 'note', medium: 'referral', campaign: camp, content: contentId('note', priceYen) });

  const lines: string[] = [];
  lines.push(`# ${t}｜日本での実装ガイド（${priceYen.toLocaleString()}円）`);
  lines.push('');
  lines.push(`価格: ${priceYen.toLocaleString()}円（通常価格のみ表示）`);
  lines.push('');
  NOTE_SECTIONS.forEach((s, i) => {
    lines.push(`## ${i + 1}. ${s}`);
    if (s.startsWith('強烈なフック')) {
      lines.push(`海外では「${t}」がすでに動き始めています。`);
      lines.push(evidenceLine(ctx));
    } else if (s === '日本との差') {
      lines.push('日本での普及段階は本文中の調査結果セクションを参照（未調査なら「未調査」と明記）。');
    } else if (s === 'バックテスト') {
      lines.push(evidenceLine(ctx));
      lines.push(moneyLine(ctx));
    } else if (s === 'リスク') {
      lines.push('法規制・プラットフォーム規約・再現性の限界をここに正直に書く。');
      lines.push('効果には個人差があり、成果を保証するものではありません。');
    } else if (s === '次のステップ') {
      for (const l of nextStepBlock(priceYen, utm)) lines.push(l);
    } else {
      lines.push('（本文をここに書く）');
    }
    lines.push('');
  });
  lines.push('---');
  lines.push(`無料部分と有料部分の境界: 「${NOTE_SECTIONS[4]}」の直前に置く。`);

  const body = lines.join('\n');
  return {
    id: `${ctx.idea.id}_note_${priceYen}`,
    channel: 'NOTE',
    postType: 'PAID_NOTE',
    title: `${t}｜${priceYen.toLocaleString()}円note`,
    body,
    utm,
    issues: checkCompliance(body),
  };
}

export function generateSalesAssets(ctx: Ctx): GeneratedContent[] {
  const t = ctx.idea.title;
  const camp = campaignId(ctx.idea.id, 1);
  const utm = buildUtm({ source: 'lp', medium: 'referral', campaign: camp, content: contentId('lp', 1) });

  const lp = [
    `# ${t}｜導入のご案内`,
    '',
    '## この仕組みでできること',
    '- 現状の作業のうち、どの工程を自動化できるかを最初に切り分けます',
    '- 効果は導入前後の実測で確認します（推定値は推定と明記します）',
    '',
    '## 料金（通常価格のみ）',
    '- LIGHT 月29,800円 / STANDARD 月49,800円 / PRO 月98,000円 / ENTERPRISE 個別見積',
    '',
    '## 無料デモ',
    `その場で動かして確認できます: /demo?${utm}`,
    '',
    '## ご注意',
    '効果には条件があり、成果を保証するものではありません。',
  ].join('\n');

  const script = [
    `# ${t}｜商談台本`,
    '',
    '1. 今その業務に月何時間かけているかを聞く（推測しない）',
    '2. 1時間あたりの人件費を聞く',
    '3. デモをその場で見せる',
    '4. 削減見込み時間 × 人件費 で ROI を計算して提示する',
    '5. 数字が合わなければ「今は導入しない」を正しい結論として提示する',
  ].join('\n');

  return [
    { id: `${ctx.idea.id}_lp`, channel: 'LP', postType: 'LP', title: `${t} LP`, body: lp, utm, issues: checkCompliance(lp) },
    { id: `${ctx.idea.id}_script`, channel: 'SALES', postType: 'SCRIPT', title: `${t} 商談台本`, body: script, utm: '', issues: checkCompliance(script) },
  ];
}

export async function saveContents(ideaId: string, items: GeneratedContent[]): Promise<void> {
  const createdAt = nowIso();
  for (const c of items) {
    const blocked = c.issues.some((i) => i.severity === 'BLOCK');
    await run(
      `INSERT INTO contents (id, idea_id, product_id, channel, post_type, title, body, utm, status, published_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET body=excluded.body, utm=excluded.utm, status=excluded.status`,
      [
        c.id,
        ideaId,
        null,
        c.channel,
        c.postType,
        c.title,
        c.body,
        c.utm,
        blocked ? 'BLOCKED_BY_COMPLIANCE' : 'DRAFT',
        null,
        createdAt,
      ]
    );
  }
}

export async function listContents(ideaId: string) {
  return all<{
    id: string;
    channel: string;
    post_type: string;
    title: string;
    body: string;
    utm: string;
    status: string;
  }>('SELECT id, channel, post_type, title, body, utm, status FROM contents WHERE idea_id = ? ORDER BY channel, id', [ideaId]);
}
