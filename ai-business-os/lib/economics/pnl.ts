import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../env';
import { HOURLY_YEN } from './channels';
import { aggregate, readSalesActuals, type SalesActual, type SalesMetrics } from './actuals';
import {
  contentTotal,
  readContentActuals,
  type ContentActual,
  type ContentMetrics,
} from './content-actuals';

/**
 * コンテンツ（X・note）とAIシステム（SaaS）の採算を分けて出す。
 *
 * 混ぜると、noteの売上でSaaSの赤字が隠れる。
 * 逆に、SaaSの月額でnote制作にかけた時間が見えなくなる。
 * どちらも「どこで稼いで、どこで損しているか」が分からなくなり、直す場所を間違える。
 *
 * 記入が無い費目は 0 ではなく「未記入」として扱う。
 * 0円と書くと「本当にかかっていない」のか「まだ数えていない」のか区別できない。
 */

const LEDGER_FILE = path.join(DATA_DIR, 'cost-ledger.csv');

export const COST_LEDGER_PATH = LEDGER_FILE;

/**
 * 費目。どのP&Lに乗るかがここで決まる。
 *
 * 「その他」に寄せると、後から何に使ったのか分からなくなって減らしようが無い。
 * 実際に請求が別々に来る単位まで割ってある（AI利用料と検索API利用料は請求元が違う）。
 */
export type CostKind =
  | 'DEVELOPMENT'
  | 'AI_API'
  | 'SEARCH_API'
  | 'SERVER'
  | 'DOMAIN'
  | 'CONTENT'
  | 'ADVERTISING'
  | 'SALES'
  | 'PHONE'
  | 'EMAIL'
  | 'SUPPORT'
  | 'TOOL'
  | 'OTHER';

export const COST_KINDS: CostKind[] = [
  'DEVELOPMENT',
  'AI_API',
  'SEARCH_API',
  'SERVER',
  'DOMAIN',
  'CONTENT',
  'ADVERTISING',
  'SALES',
  'PHONE',
  'EMAIL',
  'SUPPORT',
  'TOOL',
  'OTHER',
];

export const COST_KIND_LABEL: Record<CostKind, string> = {
  DEVELOPMENT: '開発費',
  AI_API: 'AI利用料（生成AIのAPI）',
  SEARCH_API: '検索API利用料（Brave・Tavily等）',
  SERVER: 'サーバー費',
  DOMAIN: 'ドメイン費',
  CONTENT: 'コンテンツ制作費',
  ADVERTISING: '広告費',
  SALES: '営業費',
  PHONE: '電話費',
  EMAIL: 'メール配信費',
  SUPPORT: 'サポート費',
  TOOL: 'ツール利用料',
  OTHER: 'その他',
};

/**
 * 昔の費目名。すでに書いてある cost-ledger.csv を読めなくしないための読み替え表。
 * 名前を変えた時に過去の記入が無視されると、費用が実際より安く見えてしまう。
 */
export const LEGACY_COST_KINDS: Record<string, CostKind> = {
  CONTENT_PRODUCTION: 'CONTENT',
  AD: 'ADVERTISING',
  API: 'AI_API',
};

/** CONTENT側に乗る費目。ここに無いものはSAAS側に乗る */
const CONTENT_KINDS: CostKind[] = ['CONTENT', 'ADVERTISING'];

export const COST_LEDGER_COLUMNS = [
  'date',
  'idea_id',
  'kind',
  'amount_yen',
  'minutes',
  'note',
] as const;

export const COST_LEDGER_TEMPLATE = `${COST_LEDGER_COLUMNS.join(',')}
# 実際に払った費用と、かけた時間を1行ずつ書く。分からない列は空欄（0と書かない）。
# kind: ${COST_KINDS.join(' / ')}
# amount_yen = 実際に払った金額（円）。minutes = かけた分数（時給${HOURLY_YEN.toLocaleString()}円で費用に換算する）
# コンテンツ制作費・広告費はコンテンツ側（CONTENT P&L）に乗る
# それ以外（開発費・AI利用料・検索API利用料・サーバー費・ドメイン費・営業費・電話費・
#   メール配信費・サポート費・ツール利用料・その他）はAIシステム側（SAAS P&L）に乗る
# 検索API利用料は案件を探すためにかかる費用。0円扱いにせず必ずここへ書く
# 個人情報・APIキー・取引先の口座情報はこのファイルに書かない
`;

export type CostEntry = {
  date: string;
  ideaId: string;
  kind: CostKind;
  amountYen: number | null;
  minutes: number | null;
  note: string;
};

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseCostLedger(text: string): CostEntry[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  const head = lines.shift();
  if (!head) return [];
  const idx = new Map<string, number>();
  head.split(',').forEach((name, i) => idx.set(name.trim(), i));
  const at = (cols: string[], name: string) => {
    const i = idx.get(name);
    return i === undefined ? undefined : cols[i];
  };
  const out: CostEntry[] = [];
  for (const line of lines) {
    const c = line.split(',');
    const raw = (at(c, 'kind') ?? '').trim();
    const kind = (LEGACY_COST_KINDS[raw] ?? raw) as CostKind;
    if (!COST_KINDS.includes(kind)) continue;
    out.push({
      date: (at(c, 'date') ?? '').trim(),
      ideaId: (at(c, 'idea_id') ?? '').trim(),
      kind,
      amountYen: num(at(c, 'amount_yen')),
      minutes: num(at(c, 'minutes')),
      note: (at(c, 'note') ?? '').trim(),
    });
  }
  return out;
}

export function readCostLedger(): CostEntry[] {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  return parseCostLedger(fs.readFileSync(LEDGER_FILE, 'utf8'));
}

export type CostLine = {
  kind: CostKind;
  label: string;
  /** 未記入なら null。0にしない */
  amountYen: number | null;
  entries: number;
};

export type PnlSection = {
  title: string;
  revenueLines: { label: string; amountYen: number }[];
  costLines: CostLine[];
  revenueYen: number;
  /** 記入されている費用の合計 */
  costYen: number;
  profitYen: number;
  /** 未記入の費目。ここが残っている限り、利益は「わかっている範囲」の数字 */
  missingCostKinds: CostKind[];
  note: string;
};

export type TotalPnl = {
  content: PnlSection;
  saas: PnlSection;
  revenueYen: number;
  costYen: number;
  profitYen: number;
  missingCostKinds: CostKind[];
  /** 費用のうち「自分が動いた時間」の分。上の costYen にも含まれている（二重計上ではなく内訳） */
  labor: LaborCost;
  note: string;
};

function sumKind(entries: CostEntry[], kind: CostKind): CostLine {
  const rows = entries.filter((e) => e.kind === kind);
  if (rows.length === 0) {
    return { kind, label: COST_KIND_LABEL[kind], amountYen: null, entries: 0 };
  }
  const amount = rows.reduce(
    (a, e) => a + (e.amountYen ?? 0) + ((e.minutes ?? 0) / 60) * HOURLY_YEN,
    0
  );
  return { kind, label: COST_KIND_LABEL[kind], amountYen: Math.round(amount), entries: rows.length };
}

function sectionOf(
  title: string,
  revenueLines: { label: string; amountYen: number }[],
  lines: CostLine[],
  note: string
): PnlSection {
  const revenueYen = revenueLines.reduce((a, r) => a + r.amountYen, 0);
  const costYen = lines.reduce((a, l) => a + (l.amountYen ?? 0), 0);
  return {
    title,
    revenueLines,
    costLines: lines,
    revenueYen,
    costYen,
    profitYen: revenueYen - costYen,
    missingCostKinds: lines.filter((l) => l.amountYen === null).map((l) => l.kind),
    note,
  };
}

/** アウトバウンド実測の全体合計。無ければ null */
export function salesTotal(rows: SalesActual[] = readSalesActuals()): SalesMetrics | null {
  return (
    aggregate(
      rows,
      () => 'ALL',
      () => ({ ideaId: null, channel: null })
    ).get('ALL') ?? null
  );
}

export type LaborLine = {
  kind: CostKind;
  label: string;
  minutes: number;
  amountYen: number;
};

export type LaborCost = {
  /** 台帳に書かれた作業時間の合計（分） */
  minutes: number;
  /** 換算に使った仮の時給 */
  hourlyYen: number;
  /** 時間を金額に換算した合計 */
  amountYen: number;
  lines: LaborLine[];
  note: string;
};

/**
 * 自分が動いた時間を費用に換算する（LABOR COST）。
 *
 * 現金が出ていかない時間を0円のままにすると、
 * 「手作業でやれば無料」という結論になり、赤字の事業が黒字に見えてしまう。
 * 時給は仮置きなので、金額だけでなく「何時間をいくらで見積もったか」を必ず一緒に出す。
 */
export function laborCost(entries: CostEntry[] = readCostLedger()): LaborCost {
  const lines: LaborLine[] = [];
  let minutes = 0;
  for (const kind of COST_KINDS) {
    const m = entries.filter((e) => e.kind === kind).reduce((a, e) => a + (e.minutes ?? 0), 0);
    if (m <= 0) continue;
    minutes += m;
    lines.push({
      kind,
      label: COST_KIND_LABEL[kind],
      minutes: m,
      amountYen: Math.round((m / 60) * HOURLY_YEN),
    });
  }
  return {
    minutes,
    hourlyYen: HOURLY_YEN,
    amountYen: Math.round((minutes / 60) * HOURLY_YEN),
    lines,
    note:
      minutes === 0
        ? '作業時間の記入がまだ無い。0時間ではなく未記入として扱う'
        : `作業時間 ${Math.round((minutes / 60) * 10) / 10}時間 を仮の時給 ${HOURLY_YEN.toLocaleString()}円で費用に換算した（仮定値であり実際の支払いではない）`,
  };
}

export type PnlInput = {
  content?: ContentMetrics;
  sales?: SalesMetrics;
  ledger?: CostEntry[];
  /** 契約中の月額合計（MRR）。実績のある契約だけを入れる */
  mrrYen?: number;
  /**
   * 検索API利用料（Brave・Tavily等）。台帳に手書きが無くても、
   * 実際に検索した回数から出た費用をここへ渡してSAAS側に必ず乗せる。
   * 分からない間は渡さない（0と書かない）。
   */
  searchApiYen?: number;
};

/**
 * コンテンツ側の採算。
 * 有料noteの売上は手取り（プラットフォーム手数料を引いた後）で数える。
 */
export function contentPnl(input: PnlInput): PnlSection {
  const m = input.content ?? contentTotal();
  const ledger = input.ledger ?? readCostLedger();
  const revenueLines = [{ label: '有料noteの手取り', amountYen: m.paidNoteNetYen }];

  const lines: CostLine[] = CONTENT_KINDS.map((k) => sumKind(ledger, k));
  // 実測CSVに書かれた制作費・制作時間は、台帳に無くても必ず費用として数える
  const fromActuals = m.totalCost;
  if (fromActuals > 0) {
    const i = lines.findIndex((l) => l.kind === 'CONTENT');
    lines[i] = {
      ...lines[i],
      amountYen: (lines[i].amountYen ?? 0) + fromActuals,
      entries: lines[i].entries + m.rows,
    };
  }

  return sectionOf(
    'CONTENT P&L（X・note）',
    revenueLines,
    lines,
    '無料noteの売上は0円。信用を作る費用として見る。ここを赤字だからと切ると、見込み客の入口を失う'
  );
}

/**
 * AIシステム側の採算。
 * noteの売上はここに入れない（入れるとSaaSの赤字が隠れる）。
 */
export function saasPnl(input: PnlInput): PnlSection {
  const content = input.content ?? contentTotal();
  const sales = input.sales ?? salesTotal();
  const ledger = input.ledger ?? readCostLedger();

  const revenueLines: { label: string; amountYen: number }[] = [
    { label: 'AIシステムの売上（実測）', amountYen: content.saasRevenue + (sales?.revenue ?? 0) },
  ];
  if (input.mrrYen !== undefined) {
    revenueLines.push({ label: '契約中の月額合計（MRR）', amountYen: Math.round(input.mrrYen) });
  }

  // コンテンツ側に乗る費目以外はすべてここ。費目を増やしたら自動でこちらに入る
  const kinds: CostKind[] = COST_KINDS.filter((k) => !CONTENT_KINDS.includes(k));
  const lines = kinds.map((k) => sumKind(ledger, k));

  // 検索API利用料は台帳への手書きが無くても、実際の検索回数から出た費用を必ず乗せる
  const searchYen = input.searchApiYen;
  if (searchYen !== undefined && searchYen > 0) {
    const i = lines.findIndex((l) => l.kind === 'SEARCH_API');
    lines[i] = {
      ...lines[i],
      amountYen: (lines[i].amountYen ?? 0) + Math.round(searchYen),
      entries: lines[i].entries + 1,
    };
  }

  const salesCost = sales?.totalCost ?? 0;
  if (salesCost > 0) {
    const i = lines.findIndex((l) => l.kind === 'SALES');
    lines[i] = {
      ...lines[i],
      amountYen: (lines[i].amountYen ?? 0) + salesCost,
      entries: lines[i].entries + (sales?.rows ?? 0),
    };
  }

  return sectionOf(
    'SAAS P&L（AIシステム）',
    revenueLines,
    lines,
    '開発費・API利用料・サポート費が未記入のうちは、この利益は「まだ数えていない費用を除いた数字」'
  );
}

export function totalPnl(input: PnlInput = {}): TotalPnl {
  const ledger = input.ledger ?? readCostLedger();
  const content = contentPnl({ ...input, ledger });
  const saas = saasPnl({ ...input, ledger });
  const missing = [...content.missingCostKinds, ...saas.missingCostKinds];
  return {
    content,
    saas,
    revenueYen: content.revenueYen + saas.revenueYen,
    costYen: content.costYen + saas.costYen,
    profitYen: content.profitYen + saas.profitYen,
    missingCostKinds: missing,
    labor: laborCost(ledger),
    note:
      missing.length === 0
        ? '全ての費目が記入済み'
        : `未記入の費目：${missing.map((k) => COST_KIND_LABEL[k]).join(' / ')}。この分だけ利益は多めに出ている`,
  };
}

export type TestRoi = {
  /** 実際に入金された金額だけ */
  revenueYen: number;
  costYen: number;
  profitYen: number;
  /** 契約見込み（未入金の受注・MRRの将来分）を含めた参考値 */
  withPipelineYen: number | null;
  note: string;
};

/**
 * テストの損益。
 * 「契約が取れそう」を売上に数えると、いつまでも黒字に見えてしまう。
 * そのため、入金済みだけの利益を主として出し、見込みは必ず別枠にする。
 */
export function testRoi(params: {
  content?: ContentMetrics;
  sales?: SalesMetrics;
  ledger?: CostEntry[];
  pipelineYen?: number | null;
}): TestRoi {
  const c = params.content ?? contentTotal();
  const s = params.sales ?? null;
  const ledger = params.ledger ?? readCostLedger();
  const ledgerCost = ledger.reduce(
    (a, e) => a + (e.amountYen ?? 0) + ((e.minutes ?? 0) / 60) * HOURLY_YEN,
    0
  );
  const revenue = c.paidNoteNetYen + c.saasRevenue + (s?.revenue ?? 0);
  const cost = Math.round(c.totalCost + (s?.totalCost ?? 0) + ledgerCost);
  const pipeline = params.pipelineYen ?? null;
  return {
    revenueYen: revenue,
    costYen: cost,
    profitYen: revenue - cost,
    withPipelineYen: pipeline === null ? null : revenue - cost + Math.round(pipeline),
    note:
      pipeline === null
        ? 'TEST PROFIT は入金済みの売上だけで計算している。契約見込みは含めていない'
        : 'TEST PROFIT は入金済みのみ。括弧内の見込みは契約が成立した場合の参考値であり、実績ではない',
  };
}

/** 実測CSVから直接計算する入口 */
export function pnlFromFiles(params: {
  contentRows?: ContentActual[];
  salesRows?: SalesActual[];
  mrrYen?: number;
  searchApiYen?: number;
} = {}): TotalPnl {
  const content = contentTotal(params.contentRows ?? readContentActuals());
  const sales = salesTotal(params.salesRows ?? readSalesActuals()) ?? undefined;
  return totalPnl({ content, sales, mrrYen: params.mrrYen, searchApiYen: params.searchApiYen });
}
