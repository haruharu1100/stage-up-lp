/**
 * 【AUTO RESEARCH ORCHESTRATOR — 自動リサーチの本体】（Phase 5・2026-08-25）
 *
 * ★このファイルは何も import しない（ルール37）。
 * ★このファイルには **市場の名前を1文字も書かない**（§42）。
 *   'KEEPA' も 'KOMEHYO' も 'AMAZON' も出てこない。
 *   口の情報は、呼ぶ側が `ConnectorView` の形にして渡す。
 *
 * ------------------------------------------------------------------
 * 【この仕組みが何をするのか】
 *
 * ご本人の指示（原文・§54）：
 *   「今後は『人間が商品を入力する』ことを主経路にしない。
 *     主経路：AI Research ／ Fallback：Human Input です。」
 *
 * つまりこれは、Phase 4 まで人がやっていた
 *   「商品を探す → 同じ商品か確かめる → 利益を計算する → 買うか決める」
 * の**探す側**を機械に置き換える部品である。
 *
 * ------------------------------------------------------------------
 * 【いま正直に言っておかないといけないこと】
 *
 * ご本人の指示（原文・最初にやること）：
 *   「いきなり外部市場を勝手に検索しないでください。まず、
 *     AUTO RESEARCH ORCHESTRATOR の設計と、
 *     現在正式接続済みのデータだけでどこまで自動化できるかを確認してください。」
 *
 * その答えは、この設計を通すとはっきり出る。
 *   **仕入側で正式に自動取得できる市場が0件なので、
 *     利益の出る Route は1本も自動では作れない。**
 * これは作りが足りないのではなく、材料が無いという意味である。
 * だからこの Orchestrator は「途中で止まる」ことを異常としない。
 * 止まった場所と理由を残して、そこまでの結果を捨てずに貯める形にしてある。
 *
 * ------------------------------------------------------------------
 * 【いちばんやってはいけないこと】
 *
 * 「仕入側が0件だと画面が寂しいので、とりあえず動くところまでを
 *   購入候補として出す」こと。
 * 仕入価格の無い候補は、利益が計算できていない候補である。
 * それを購入候補の欄に出した瞬間、この仕組みは
 * **「買ってよさそうに見えるもの」を並べる装置**に変わる。
 */

/* ================================================================
 * 1. まだ作らないもの（§53）
 * ================================================================ */

/**
 * ご本人の指示（原文・§53）：
 *   「まだ、自動購入・自動出品・自動決済・自動発送 は実装しない。」
 *
 * ★フラグではなく「実装が無い」という事実を定数で置いている。
 *   フラグは誰かが true にできるが、無い関数は呼べない。
 */
export const AUTO_PURCHASE_IMPLEMENTED = false;
export const AUTO_LISTING_IMPLEMENTED = false;
export const AUTO_PAYMENT_IMPLEMENTED = false;
export const AUTO_SHIPPING_IMPLEMENTED = false;

/** 人がやること。ここを機械に渡さない。 */
export const HUMAN_ONLY_ACTIONS_JA = [
  '購入ページを開いて、実際に買う',
  '出品する',
  '支払う',
  '発送する',
];

/* ================================================================
 * 2. リサーチの向き
 * ================================================================ */

export type Direction = 'DEMAND_FIRST' | 'SUPPLY_FIRST';

export type VenueSide = 'BUY_SIDE' | 'SELL_SIDE';

/**
 * どちら側の口から候補を出すか。
 *
 * ★ここが向きの本質である。
 *   Demand First は「売れている側」から始めるので、最初に使う口は販売側。
 *   Supply First は「安い側」から始めるので、最初に使う口は仕入側。
 *   そして**必ず反対側の口も要る**。片側だけでは Route にならない。
 */
export function discoverSide(d: Direction): VenueSide {
  return d === 'DEMAND_FIRST' ? 'SELL_SIDE' : 'BUY_SIDE';
}

export function counterpartSide(d: Direction): VenueSide {
  return d === 'DEMAND_FIRST' ? 'BUY_SIDE' : 'SELL_SIDE';
}

export const SIDE_JA: Record<VenueSide, string> = {
  BUY_SIDE: '仕入側',
  SELL_SIDE: '販売側',
};

/* ================================================================
 * 3. 口の見え方（Connector非依存にするための最小の形）
 * ================================================================ */

/**
 * ★Orchestrator が知ってよい口の情報はこれだけ。
 *   `venueCode` は持つが、**中身を条件分岐に使わない**（表示と記録のためだけ）。
 *   受け入れテストで「本体に市場名の文字列が無いこと」を機械的に見張る。
 */
export type ConnectorView = {
  venueCode: string;
  labelJa: string;
  /** その口が仕入側／販売側／両方のどれか。 */
  sides: VenueSide[];
  /** 自動リサーチに載せてよいと確認済みか（判定は Connector 側で行う）。 */
  autoReady: boolean;
  /** 商品を探せるか。 */
  canSearch: boolean;
  /** 価格が取れるか。 */
  canPrice: boolean;
  /** JAN・型番・ASINなどが取れるか。 */
  canIdentify: boolean;
  /** 商品ページのURLが取れるか。★取れないなら、URLをこちらで作らない（ルール55・98）。 */
  canProductUrl: boolean;
};

export function usableOn(v: ConnectorView, side: VenueSide): boolean {
  return v.autoReady && v.sides.includes(side);
}

/* ================================================================
 * 4. 段（Pipeline Stages）
 * ================================================================ */

/**
 * ご本人の指示（原文・§1）の並びを、そのまま段にしたもの。
 *   市場データ取得 → 商品候補を大量発見 → 同一商品を市場横断照合 →
 *   BUY→SELL Route計算 → 需要確認 → 競合確認 → 手数料 → 送料 →
 *   利益 → 売却確率 → 資金回転 → リスク → BUY候補ランキング
 *
 * ★手数料・送料・利益・売却確率・資金回転・リスクは、
 *   Phase 4 で作った計算（calcAmazonFees / calcRouteProfit / judgeBuyDecision）が
 *   すでに担当している。ここで作り直さない。作り直すと2つの答えが生まれる。
 */
export const PIPELINE_STAGES = [
  {
    key: 'CONNECT',
    labelJa: '使える口を確認する',
    purposeJa: '正式に自動で取得してよい市場だけを、この回の対象にします。',
    costsMoney: false,
    /** この段を終えた候補が入る Candidate Queue の状態。 */
    queueState: null,
  },
  {
    key: 'DISCOVER',
    labelJa: '候補を出す',
    purposeJa: '向きに応じて、売れている商品か、安い出品を大量に拾います。',
    costsMoney: true,
    queueState: 'NEW',
  },
  {
    key: 'NORMALIZE',
    labelJa: '形をそろえる',
    purposeJa: '市場ごとにバラバラな値段・状態・数量の書き方を、同じ形に直します。',
    costsMoney: false,
    queueState: 'NEW',
  },
  {
    key: 'CHEAP_FILTER',
    labelJa: '安い計算でふるいにかける',
    purposeJa: 'お金のかからない計算だけで、明らかに無理なものを外します（§19）。',
    costsMoney: false,
    queueState: 'FILTERED',
  },
  {
    key: 'MATCH',
    labelJa: '同じ商品かを確かめる',
    purposeJa: '反対側の市場に、同じ商品があるかを照合します。',
    costsMoney: true,
    queueState: 'MATCHING',
  },
  {
    key: 'DEMAND',
    labelJa: '売れているかを見る',
    purposeJa: '需要と競合を確かめます。ここは買ってよい判定ではありません（ルール124）。',
    costsMoney: true,
    queueState: 'ANALYZING',
  },
  {
    key: 'ROUTE',
    labelJa: '買う場所と売る場所を組む',
    purposeJa: 'どこで買ってどこで売るかの組み合わせを作ります。',
    costsMoney: false,
    queueState: 'ANALYZING',
  },
  {
    key: 'PROFIT',
    labelJa: '利益を計算する',
    purposeJa: '手数料・送料・当社費用を引いて、手元に残る額を出します。',
    costsMoney: false,
    queueState: 'ROUTE_READY',
  },
  {
    key: 'SCORE',
    labelJa: '順位をつける',
    purposeJa: '期待純利益・売却確率・資金回転・データ信頼度・リスクで並べます（§5）。',
    costsMoney: false,
    queueState: 'ROUTE_READY',
  },
  {
    key: 'OPPORTUNITY',
    labelJa: '購入候補として出す',
    purposeJa: '上位だけを人が見る画面へ出します。買うのは人です。',
    costsMoney: false,
    queueState: 'OPPORTUNITY',
  },
] as const;

export type StageKey = (typeof PIPELINE_STAGES)[number]['key'];

export const STAGE_KEYS: StageKey[] = PIPELINE_STAGES.map((s) => s.key);

export function stageIndex(k: StageKey): number {
  return STAGE_KEYS.indexOf(k);
}

/* ================================================================
 * 5. この回はどこまで進めるか
 * ================================================================ */

export type StagePlan = {
  key: StageKey;
  labelJa: string;
  runnable: boolean;
  /** 進めない理由。進めるときは空。 */
  blockedReasonsJa: string[];
};

export type RunPlan = {
  direction: Direction;
  stages: StagePlan[];
  /** どこまで進めるか。1段も進めないときは null。 */
  reachableUpTo: StageKey | null;
  /** 進めた結果を、どの状態で貯めるか。 */
  parkAt: string | null;
  summaryJa: string;
};

/**
 * 「先に進めない候補」を捨てずに貯める置き場（§40）。
 *
 * ご本人の指示（原文・§40）：
 *   「他市場に正式Connectorが無い場合、そのASINを SUPPLIER_SEARCH_PENDING として保存。
 *     無断でWebを巡回しないこと。」
 *
 * ★これがあるかどうかで、この Phase の意味が変わる。
 *   捨ててしまうと、仕入側の口がついた日に**また最初から全部調べ直す**。
 *   貯めておけば、口がついた日に「もう選んである商品」から始められる。
 */
export const PARK_STATE_SUPPLIER_SEARCH_PENDING = 'SUPPLIER_SEARCH_PENDING';

/**
 * この回の計画を立てる。
 *
 * ★口の一覧は引数で受け取る。ここで市場を1つも名指ししない（§42）。
 * ★Fail Closed。材料が無い段は「たぶん動く」ではなく「動かない」にする。
 */
export function planRun(direction: Direction, connectors: ConnectorView[]): RunPlan {
  const dSide = discoverSide(direction);
  const cSide = counterpartSide(direction);

  const discoverConnectors = connectors.filter((v) => usableOn(v, dSide) && v.canSearch);
  const counterpartConnectors = connectors.filter((v) => usableOn(v, cSide) && v.canSearch);

  const hasDiscover = discoverConnectors.length > 0;
  const hasCounterpart = counterpartConnectors.length > 0;

  // 反対側の口で「値段」が取れないと、Route の片側が空欄のままになる。
  const counterpartHasPrice = counterpartConnectors.some((v) => v.canPrice);
  // 照合の手がかりは、両側で取れないと突き合わせられない。
  const bothCanIdentify =
    discoverConnectors.some((v) => v.canIdentify) && counterpartConnectors.some((v) => v.canIdentify);

  const stages: StagePlan[] = PIPELINE_STAGES.map((s) => {
    const blockedReasonsJa: string[] = [];

    if (s.key === 'CONNECT') {
      if (connectors.filter((v) => v.autoReady).length === 0) {
        blockedReasonsJa.push('自動で取得してよいと確認できた市場が1つもありません。');
      }
    }

    if (s.key === 'DISCOVER' || s.key === 'NORMALIZE' || s.key === 'CHEAP_FILTER') {
      if (!hasDiscover) {
        blockedReasonsJa.push(`${SIDE_JA[dSide]}に、商品を探せる市場がありません。`);
      }
    }

    if (s.key === 'MATCH') {
      if (!hasCounterpart) {
        blockedReasonsJa.push(`${SIDE_JA[cSide]}に、商品を探せる市場がありません。照合する相手がいません。`);
      } else if (!bothCanIdentify) {
        blockedReasonsJa.push('JANや型番が両側で取れないので、同じ商品だと確かめられません。');
      }
    }

    if (s.key === 'DEMAND') {
      // 需要は販売側の材料。販売側の口が無ければ見られない。
      if (!connectors.some((v) => usableOn(v, 'SELL_SIDE'))) {
        blockedReasonsJa.push('販売側の市場が無いので、売れているかを見られません。');
      }
    }

    if (s.key === 'ROUTE' || s.key === 'PROFIT' || s.key === 'SCORE' || s.key === 'OPPORTUNITY') {
      if (!hasCounterpart) {
        blockedReasonsJa.push(`${SIDE_JA[cSide]}の市場が無いので、買う場所と売る場所を組めません。`);
      } else if (!counterpartHasPrice) {
        blockedReasonsJa.push(`${SIDE_JA[cSide]}で値段が取れないので、利益を計算できません。`);
      }
    }

    return { key: s.key, labelJa: s.labelJa, runnable: blockedReasonsJa.length === 0, blockedReasonsJa };
  });

  // ★途中で止まったら、その先は「動くかもしれない」ではなく動かさない。
  //   先の段だけ動かすと、材料の無い判定が混ざる。
  let reachableUpTo: StageKey | null = null;
  for (const st of stages) {
    if (!st.runnable) break;
    reachableUpTo = st.key;
  }

  const stopped = stages.find((s) => !s.runnable) ?? null;
  const parkAt = reachableUpTo === null || stopped === null ? null : PARK_STATE_SUPPLIER_SEARCH_PENDING;

  let summaryJa: string;
  if (reachableUpTo === null) {
    summaryJa = '自動で回せる市場がないので、この回は1段も進みません。';
  } else if (stopped === null) {
    summaryJa = '最後の段まで進めます。';
  } else {
    summaryJa =
      `「${PIPELINE_STAGES[stageIndex(reachableUpTo)].labelJa}」まで進めます。`
      + `その先の「${stopped.labelJa}」は、${stopped.blockedReasonsJa.join('')}`
      + `そこまでの結果は捨てずに「${PARK_STATE_SUPPLIER_SEARCH_PENDING}」として貯めます。`;
  }

  return { direction, stages, reachableUpTo, parkAt, summaryJa };
}

/* ================================================================
 * 6. 安全停止（§52-9）
 * ================================================================ */

/**
 * ご本人の指示（原文・§52）：「9. 安全停止」
 *
 * ★自動で毎日回るものには、**自分で止まる条件**が要る。
 *   人が見ていないから自動なのであって、
 *   止まらない自動は「気づかないまま費用と誤りが増える装置」になる。
 */
export const SAFETY_STOP_REASONS = [
  'BUDGET_EXCEEDED',
  'RATE_LIMIT_UNKNOWN',
  'CONNECTOR_NOT_READY',
  'DATA_TOO_OLD',
  'MATCH_INCIDENT',
  'FUNNEL_BROKEN',
] as const;
export type SafetyStopReason = (typeof SAFETY_STOP_REASONS)[number];

export const SAFETY_STOP_REASON_JA: Record<SafetyStopReason, string> = {
  BUDGET_EXCEEDED: '今日の調査費用の上限に達しました',
  RATE_LIMIT_UNKNOWN: '呼んでよい頻度が分からない市場があります',
  CONNECTOR_NOT_READY: '自動で取得してよいと確認できていない市場があります',
  DATA_TOO_OLD: 'データが古すぎます',
  MATCH_INCIDENT: '商品の取り違えが見つかりました',
  FUNNEL_BROKEN: '各段の件数が増えており、数え方が壊れています',
};

export type SafetyStopInput = {
  spentTodayJpy: number;
  dailyBudgetJpy: number;
  anyRateLimitUnknown: boolean;
  anyConnectorNotReady: boolean;
  oldestDataAgeHours: number | null;
  maxDataAgeHours: number;
  incorrectMatchCount: number;
  /** 各段の件数（前の段より増えていたら壊れている）。 */
  funnelCounts: number[];
};

export type SafetyStopResult = {
  stop: boolean;
  reasons: SafetyStopReason[];
  reasonsJa: string[];
};

/**
 * ★取り違えは1件でも止める（ルール48）。
 *   「1件くらいなら」を許すと、次は3件になる。
 *   ここは件数ではなく「起きたかどうか」で判定する。
 */
export function checkSafetyStops(input: SafetyStopInput): SafetyStopResult {
  const reasons: SafetyStopReason[] = [];

  if (input.dailyBudgetJpy > 0 && input.spentTodayJpy >= input.dailyBudgetJpy) {
    reasons.push('BUDGET_EXCEEDED');
  }
  if (input.anyRateLimitUnknown) reasons.push('RATE_LIMIT_UNKNOWN');
  if (input.anyConnectorNotReady) reasons.push('CONNECTOR_NOT_READY');
  if (input.oldestDataAgeHours !== null && input.oldestDataAgeHours > input.maxDataAgeHours) {
    reasons.push('DATA_TOO_OLD');
  }
  if (input.incorrectMatchCount > 0) reasons.push('MATCH_INCIDENT');

  // ファネルは必ず減る（ルール131）。増えていたら数え方が壊れている。
  for (let i = 1; i < input.funnelCounts.length; i += 1) {
    if (input.funnelCounts[i] > input.funnelCounts[i - 1]) {
      reasons.push('FUNNEL_BROKEN');
      break;
    }
  }

  return {
    stop: reasons.length > 0,
    reasons,
    reasonsJa: reasons.map((r) => SAFETY_STOP_REASON_JA[r]),
  };
}

/* ================================================================
 * 7. いまどこまで届くか（人が読む用）
 * ================================================================ */

export type ReachReport = {
  direction: Direction;
  reachableUpTo: StageKey | null;
  reachedStageLabelJa: string;
  linesJa: string[];
};

/**
 * ★ここで「もうすぐ全自動になります」と書かない（ルール63）。
 *   書けるのは、数えられることだけである。
 */
export function reachReport(direction: Direction, connectors: ConnectorView[]): ReachReport {
  const plan = planRun(direction, connectors);
  const buy = connectors.filter((v) => usableOn(v, 'BUY_SIDE')).length;
  const sell = connectors.filter((v) => usableOn(v, 'SELL_SIDE')).length;

  const linesJa = [
    `向き：${direction === 'DEMAND_FIRST' ? '売れている商品から仕入先を探す' : '安い商品から売り場を探す'}`,
    `自動で使える市場：仕入側${buy}件・販売側${sell}件`,
    plan.summaryJa,
  ];
  if (buy === 0) {
    linesJa.push(
      '仕入側が0件のあいだは、利益の出る組み合わせを自動では作れません。'
      + 'これは作りが足りないのではなく、正式に取得してよい仕入先がまだ無いという意味です。',
    );
  }

  return {
    direction,
    reachableUpTo: plan.reachableUpTo,
    reachedStageLabelJa:
      plan.reachableUpTo === null ? '（1段も進みません）' : PIPELINE_STAGES[stageIndex(plan.reachableUpTo)].labelJa,
    linesJa,
  };
}
