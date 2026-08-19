import { all, nowIso, run } from './db/client';

export type SettingType = 'int' | 'rate' | 'text';

export type SettingDef = {
  key: string;
  value: string;
  value_type: SettingType;
  label: string;
  group_key: string;
  hint?: string;
};

/**
 * 既定値。すべて管理画面から変更できる。
 * AIはこの値を書き換えられない（変更は人間のみ）。
 */
export const SETTING_DEFS: SettingDef[] = [
  // --- 利益 ---
  {
    key: 'TARGET_NET_MARGIN',
    value: '0.15',
    value_type: 'rate',
    label: '目標利益率',
    group_key: '利益',
    hint: '全費用を差し引いた後、投じたお金に対して何%残したいか。仕入価格×1.15ではない。',
  },
  {
    key: 'MIN_NET_PROFIT',
    value: '3000',
    value_type: 'int',
    label: '最低純利益（円）',
    group_key: '利益',
    hint: 'これを下回る商品は利益不足として除外する。',
  },
  {
    key: 'MIN_ROI',
    value: '0.15',
    value_type: 'rate',
    label: '最低ROI',
    group_key: '利益',
    hint: '投じたお金に対する利益率の下限。',
  },

  // --- 相場 ---
  {
    key: 'MAX_MARKET_PREMIUM_RATIO',
    value: '1.05',
    value_type: 'rate',
    label: '必要販売価格の相場超過 上限',
    group_key: '相場',
    hint: '必要販売価格 ÷ 市場価格 がこれを超えたら「相場で成立しない」として除外する。',
  },
  {
    key: 'MARKET_DATA_MAX_AGE_HOURS',
    value: '168',
    value_type: 'int',
    label: '相場データの有効期限（時間）',
    group_key: '相場',
    hint: 'これより古い相場は信頼度を下げる。Phase 1 は既定7日。',
  },

  // --- 異常検知 ---
  {
    key: 'ANOMALY_LOW_RATIO',
    value: '0.15',
    value_type: 'rate',
    label: '安すぎ判定（仕入価格÷市場価格）',
    group_key: '異常検知',
    hint: '市場価格に対してこれ未満の仕入価格は、データ誤り／偽物の疑いとして人間確認へ回す。自動では買わない。',
  },
  {
    key: 'ANOMALY_HIGH_RATIO',
    value: '3.0',
    value_type: 'rate',
    label: '高すぎ判定（仕入価格÷市場価格）',
    group_key: '異常検知',
    hint: '市場価格に対してこれを超える仕入価格は、データ誤りの疑いとして除外する。',
  },

  // --- スコア判定 ---
  { key: 'SCORE_STRONG_BUY', value: '90', value_type: 'int', label: 'STRONG BUY の下限点', group_key: 'スコア判定' },
  { key: 'SCORE_BUY', value: '80', value_type: 'int', label: 'BUY の下限点', group_key: 'スコア判定' },
  { key: 'SCORE_WATCH', value: '70', value_type: 'int', label: 'WATCH の下限点', group_key: 'スコア判定' },
  { key: 'SCORE_LOW_PRIORITY', value: '60', value_type: 'int', label: 'LOW PRIORITY の下限点', group_key: 'スコア判定' },

  // --- AI利用 ---
  {
    key: 'AI_REVIEW_MIN_SCORE',
    value: '70',
    value_type: 'int',
    label: 'AI判定にかける最低スコア',
    group_key: 'AI利用',
    hint: 'これ未満の商品はAIに投げない。AI費用を抑えるための関門。',
  },
  {
    key: 'AI_UNIT_COST_JPY',
    value: '15',
    value_type: 'int',
    label: 'AI 1商品あたりの想定費用（円）',
    group_key: 'AI利用',
  },
  {
    key: 'AI_PROFIT_MULTIPLE',
    value: '20',
    value_type: 'int',
    label: 'AIを呼ぶのに必要な粗利倍率',
    group_key: 'AI利用',
    hint: '想定純利益が「AI費用 × この倍率」以上のときだけAIを呼ぶ。',
  },

  // --- 価格戦略（Phase 1 は記録のみ・自動実行しない） ---
  {
    key: 'PRICE_STEP_UP_RATE',
    value: '0.05',
    value_type: 'rate',
    label: '値上げ幅（新品・型番商品）',
    group_key: '価格戦略',
    hint: '売れたら次回候補価格を何%上げるか。Phase 1 では提案値を出すだけで自動実行しない。',
  },
  {
    key: 'MAX_STEP_UPS',
    value: '6',
    value_type: 'int',
    label: '値上げ回数の上限',
    group_key: '価格戦略',
  },
  {
    key: 'DEFAULT_PREMIUM_RATIO',
    value: '1.00',
    value_type: 'rate',
    label: '初期の相場倍率（中古一点物）',
    group_key: '価格戦略',
    hint: '実績が貯まるまでの暫定値。市場価格の何倍で出すか。',
  },
  {
    key: 'PREMIUM_RATIO_MIN_SAMPLES',
    value: '5',
    value_type: 'int',
    label: '相場倍率を採用する最低件数',
    group_key: '価格戦略',
    hint: 'この件数未満の実績しかないセグメントは、学習値を使わず初期値を使う。',
  },

  // --- 在庫 ---
  {
    key: 'MAX_STOCK_FOR_ONE_OF_A_KIND',
    value: '1',
    value_type: 'int',
    label: '一点物とみなす在庫数',
    group_key: '在庫',
    hint: 'これ以下の在庫かつ中古なら「一点物」として相場倍率方式で価格を学習する。',
  },

  // --- ルート（どこで買ってどこで売るか） ---
  {
    key: 'ROUTE_MIN_NET_PROFIT',
    value: '3000',
    value_type: 'int',
    label: 'ルートの最低純利益（円）',
    group_key: 'ルート',
    hint: '仕入から販売までの費用を全部引いた後、これを下回るルートは候補にしない。',
  },
  {
    key: 'ROUTE_MIN_ROI',
    value: '0.15',
    value_type: 'rate',
    label: 'ルートの最低ROI',
    group_key: 'ルート',
    hint: '仕入総額に対する利益率の下限。',
  },
  {
    key: 'ROUTE_MIN_SELL_PROBABILITY',
    value: '0.2',
    value_type: 'rate',
    label: '30日で売れる確率の下限',
    group_key: 'ルート',
    hint: '利益が出ても、売れなければ現金にならない。これを下回るルートは候補にしない。',
  },
  {
    key: 'ROUTE_MAX_PER_PRODUCT',
    value: '12',
    value_type: 'int',
    label: '1商品あたりのルート保存上限',
    group_key: 'ルート',
    hint: '全市場×全市場を計算した上で、点数の高い順にこの件数だけ保存する。',
  },
  {
    key: 'LIQUIDITY_DEFAULT',
    value: '40',
    value_type: 'int',
    label: '流動性の既定値（実データが無いとき）',
    group_key: 'ルート',
    hint: '成約実績が無い市場に使う控えめな仮の値。実データが入れば使われなくなる。',
  },
  {
    key: 'DEFAULT_DAYS_TO_SELL',
    value: '45',
    value_type: 'int',
    label: '売却までの想定日数（実データが無いとき）',
    group_key: 'ルート',
  },
  {
    key: 'MIN_DAYS_FOR_ANNUALIZED',
    value: '7',
    value_type: 'int',
    label: '年率計算に使う最短日数',
    group_key: 'ルート',
    hint: '「3日で売れる想定」で年率を出すと現実離れした数字になる。下限を置いて過大表示を防ぐ。',
  },
  {
    key: 'CAPITAL_MAX_PER_BRAND_RATIO',
    value: '0.3',
    value_type: 'rate',
    label: '資金配分：同一ブランドの上限比率',
    group_key: 'ルート',
    hint: '1つのブランドに資金が偏らないようにする。',
  },
  {
    key: 'CAPITAL_MAX_PER_VENUE_RATIO',
    value: '0.5',
    value_type: 'rate',
    label: '資金配分：同一販売市場の上限比率',
    group_key: 'ルート',
    hint: '1つの販売先に依存しないようにする。',
  },
];

let cache: Map<string, string> | null = null;

export async function ensureSettings(): Promise<void> {
  const rows = await all('SELECT key FROM settings');
  const existing = new Set(rows.map((r) => String(r.key)));
  const now = nowIso();
  for (const d of SETTING_DEFS) {
    if (existing.has(d.key)) continue;
    await run(
      'INSERT INTO settings (key, value, value_type, label, group_key, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [d.key, d.value, d.value_type, d.label, d.group_key, d.hint ?? null, now],
    );
  }
  cache = null;
}

export async function loadSettings(): Promise<Map<string, string>> {
  if (cache) return cache;
  await ensureSettings();
  const rows = await all('SELECT key, value FROM settings');
  const m = new Map<string, string>();
  for (const d of SETTING_DEFS) m.set(d.key, d.value);
  for (const r of rows) m.set(String(r.key), String(r.value));
  cache = m;
  return m;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [value, nowIso(), key]);
  cache = null;
}

export async function listSettings() {
  await ensureSettings();
  return all('SELECT * FROM settings ORDER BY group_key, key');
}

export type Thresholds = {
  targetNetMargin: number;
  minNetProfit: number;
  minRoi: number;
  maxMarketPremiumRatio: number;
  marketDataMaxAgeHours: number;
  anomalyLowRatio: number;
  anomalyHighRatio: number;
  scoreStrongBuy: number;
  scoreBuy: number;
  scoreWatch: number;
  scoreLowPriority: number;
  aiReviewMinScore: number;
  aiUnitCostJpy: number;
  aiProfitMultiple: number;
  priceStepUpRate: number;
  maxStepUps: number;
  defaultPremiumRatio: number;
  premiumRatioMinSamples: number;
  maxStockForOneOfAKind: number;
  routeMinNetProfit: number;
  routeMinRoi: number;
  routeMinSellProbability: number;
  routeMaxPerProduct: number;
  liquidityDefault: number;
  defaultDaysToSell: number;
  minDaysForAnnualized: number;
  capitalMaxPerBrandRatio: number;
  capitalMaxPerVenueRatio: number;
};

export async function getThresholds(): Promise<Thresholds> {
  const s = await loadSettings();
  const num = (k: string) => Number(s.get(k));
  return {
    targetNetMargin: num('TARGET_NET_MARGIN'),
    minNetProfit: num('MIN_NET_PROFIT'),
    minRoi: num('MIN_ROI'),
    maxMarketPremiumRatio: num('MAX_MARKET_PREMIUM_RATIO'),
    marketDataMaxAgeHours: num('MARKET_DATA_MAX_AGE_HOURS'),
    anomalyLowRatio: num('ANOMALY_LOW_RATIO'),
    anomalyHighRatio: num('ANOMALY_HIGH_RATIO'),
    scoreStrongBuy: num('SCORE_STRONG_BUY'),
    scoreBuy: num('SCORE_BUY'),
    scoreWatch: num('SCORE_WATCH'),
    scoreLowPriority: num('SCORE_LOW_PRIORITY'),
    aiReviewMinScore: num('AI_REVIEW_MIN_SCORE'),
    aiUnitCostJpy: num('AI_UNIT_COST_JPY'),
    aiProfitMultiple: num('AI_PROFIT_MULTIPLE'),
    priceStepUpRate: num('PRICE_STEP_UP_RATE'),
    maxStepUps: num('MAX_STEP_UPS'),
    defaultPremiumRatio: num('DEFAULT_PREMIUM_RATIO'),
    premiumRatioMinSamples: num('PREMIUM_RATIO_MIN_SAMPLES'),
    maxStockForOneOfAKind: num('MAX_STOCK_FOR_ONE_OF_A_KIND'),
    routeMinNetProfit: num('ROUTE_MIN_NET_PROFIT'),
    routeMinRoi: num('ROUTE_MIN_ROI'),
    routeMinSellProbability: num('ROUTE_MIN_SELL_PROBABILITY'),
    routeMaxPerProduct: num('ROUTE_MAX_PER_PRODUCT'),
    liquidityDefault: num('LIQUIDITY_DEFAULT'),
    defaultDaysToSell: num('DEFAULT_DAYS_TO_SELL'),
    minDaysForAnnualized: num('MIN_DAYS_FOR_ANNUALIZED'),
    capitalMaxPerBrandRatio: num('CAPITAL_MAX_PER_BRAND_RATIO'),
    capitalMaxPerVenueRatio: num('CAPITAL_MAX_PER_VENUE_RATIO'),
  };
}

/**
 * 判定ルールの版。分析結果に必ず記録し、後からバックテストできるようにする。
 * しきい値を変えたら版も上げる。
 */
export async function ruleVersion(): Promise<string> {
  const t = await getThresholds();
  const sig = [
    t.targetNetMargin,
    t.minNetProfit,
    t.minRoi,
    t.maxMarketPremiumRatio,
    t.anomalyLowRatio,
    t.anomalyHighRatio,
    t.scoreStrongBuy,
    t.scoreBuy,
    t.scoreWatch,
    t.scoreLowPriority,
  ].join('|');
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  return `v1-${h.toString(16)}`;
}

/**
 * ルート判定の版。Phase 1 の rule_version とは別に持つ。
 * ここを Phase 1 と共有すると、ルート用のしきい値を触っただけで
 * 過去の仕入判断の版まで変わってしまい、判断履歴が追えなくなる。
 */
export async function routeRuleVersion(): Promise<string> {
  const t = await getThresholds();
  const sig = [
    t.routeMinNetProfit,
    t.routeMinRoi,
    t.routeMinSellProbability,
    t.liquidityDefault,
    t.defaultDaysToSell,
    t.minDaysForAnnualized,
    t.scoreStrongBuy,
    t.scoreBuy,
    t.scoreWatch,
    t.scoreLowPriority,
  ].join('|');
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  return `r1-${h.toString(16)}`;
}
