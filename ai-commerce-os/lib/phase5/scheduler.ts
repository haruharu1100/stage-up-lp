/**
 * 【Scheduler — いつ、どれくらいの頻度で回すか】（Phase 5・2026-08-25）
 *
 * ★このファイルは何も import しない（ルール37）。
 * ★市場の名前を1つも書かない（§42）。頻度は Connector の値から決める。
 *
 * ------------------------------------------------------------------
 * 【頻度は、こちらの都合で決めない】
 *
 * ご本人の指示（原文・§29）：
 *   「新着監視 / 価格差監視 / 需要変化監視 / 在庫復活監視 を自動化。
 *     頻度はConnectorのRate Limit・規約に合わせます。」
 *
 * ★ここが「うっかり規約違反」がいちばん起きやすい場所である。
 *   1日1回で許可されている口を、こちらの都合で1時間に1回にすると、
 *   コードは何も壊れないまま規約違反になる。壊れないので気づかない。
 *   だから頻度の上限は **Connector が持っている Rate Limit から計算する**。
 *   分からない口は回さない（Fail Closed）。
 *
 * ------------------------------------------------------------------
 * 【いちばんやってはいけないこと】
 *
 * Rate Limit が分からない口に、とりあえずの既定値を入れて回すこと。
 * 「たぶん毎分60回くらい大丈夫だろう」は、根拠が1つも無い。
 * ここでは null のままにして、**回さない**。
 */

/* ================================================================
 * 1. 見張るもの（§29）
 * ================================================================ */

export const WATCH_JOBS = [
  {
    key: 'NEW_LISTING',
    labelJa: '新着監視',
    purposeJa: '新しく出た出品を先に見ます。安い新規出品は短時間で消えることがあるためです（§16）。',
    /** 早さがものを言うか。ものを言うものほど短い間隔を許す。 */
    timeSensitive: true,
  },
  {
    key: 'PRICE_GAP',
    labelJa: '価格差監視',
    purposeJa: '「あと◯円下がれば買ってよい」候補の値段を追います（§14）。',
    timeSensitive: true,
  },
  {
    key: 'DEMAND_CHANGE',
    labelJa: '需要変化監視',
    purposeJa: '売れ行きと出品者数の変化を見ます。ここは急がなくても差が出にくい項目です。',
    timeSensitive: false,
  },
  {
    key: 'STOCK_RETURN',
    labelJa: '在庫復活監視',
    purposeJa: '在庫切れだった商品が戻ったかを見ます。',
    timeSensitive: false,
  },
] as const;
export type WatchJobKey = (typeof WATCH_JOBS)[number]['key'];

/* ================================================================
 * 2. 回してよい頻度
 * ================================================================ */

/**
 * ★間隔は「何分に1回」ではなく「1日に何回まで呼べるか」から逆算する。
 *   1分あたりの上限だけを見て回すと、24時間動かした合計が
 *   1日の上限を超えていても気づけない。
 */
export type ScheduleInput = {
  jobKey: WatchJobKey;
  /** その口の1分あたりの上限。**分からなければ null**。 */
  rateLimitPerMinute: number | null;
  /** 1回の実行で何件呼ぶか。 */
  callsPerRun: number;
  /** その口の1日の上限。分からなければ null。 */
  dailyCallCap: number | null;
  /** 上限のうち、何割まで使ってよいか（余裕を残す）。 */
  safetyMargin: number;
};

/** 上限いっぱいまで使わない。他の処理と重なった日に必ず超えるため。 */
export const SCHEDULE_SAFETY_MARGIN = 0.5;

/** どれだけ急ぐ用件でも、これより短い間隔では回さない。 */
export const MIN_INTERVAL_MINUTES = 15;
/** 急がない用件の最短間隔。 */
export const MIN_INTERVAL_MINUTES_SLOW = 360;

export type ScheduleResult = {
  jobKey: WatchJobKey;
  /** 何分に1回まで回してよいか。回してはいけないなら null。 */
  intervalMinutes: number | null;
  /** 1日に何回回せるか。 */
  runsPerDay: number | null;
  reasonJa: string;
};

export function planSchedule(input: ScheduleInput): ScheduleResult {
  const job = WATCH_JOBS.find((j) => j.key === input.jobKey);
  const floor = job && job.timeSensitive ? MIN_INTERVAL_MINUTES : MIN_INTERVAL_MINUTES_SLOW;

  if (input.rateLimitPerMinute === null) {
    return {
      jobKey: input.jobKey,
      intervalMinutes: null,
      runsPerDay: null,
      reasonJa: '1分あたり何回まで呼んでよいかが分かっていません。分からないまま自動では回しません。',
    };
  }
  if (input.callsPerRun <= 0) {
    return {
      jobKey: input.jobKey,
      intervalMinutes: null,
      runsPerDay: null,
      reasonJa: '1回の実行で何件呼ぶかが決まっていません。',
    };
  }

  const margin = Math.max(0, Math.min(1, input.safetyMargin));
  const allowedPerMinute = input.rateLimitPerMinute * margin;
  if (allowedPerMinute <= 0) {
    return {
      jobKey: input.jobKey,
      intervalMinutes: null,
      runsPerDay: null,
      reasonJa: '余裕を見ると、呼んでよい回数が残りません。',
    };
  }

  // 1回の実行に必要な「分」。これより短い間隔で回すと上限を超える。
  const minutesNeededPerRun = input.callsPerRun / allowedPerMinute;
  let intervalMinutes = Math.max(floor, Math.ceil(minutesNeededPerRun));

  // 1日の上限があるなら、そちらでも縛る。厳しい方を採る。
  if (input.dailyCallCap !== null) {
    const allowedRunsPerDay = Math.floor((input.dailyCallCap * margin) / input.callsPerRun);
    if (allowedRunsPerDay <= 0) {
      return {
        jobKey: input.jobKey,
        intervalMinutes: null,
        runsPerDay: null,
        reasonJa: '1日の上限に対して、1回の実行で呼ぶ件数が多すぎます。件数を減らすまで回しません。',
      };
    }
    const fromDaily = Math.ceil(1440 / allowedRunsPerDay);
    intervalMinutes = Math.max(intervalMinutes, fromDaily);
  }

  const runsPerDay = Math.floor(1440 / intervalMinutes);

  return {
    jobKey: input.jobKey,
    intervalMinutes,
    runsPerDay,
    reasonJa:
      `上限の${Math.round(margin * 100)}%までを使う前提で、${intervalMinutes}分に1回（1日${runsPerDay}回）まで回せます。`,
  };
}

/* ================================================================
 * 3. いま回してよいか
 * ================================================================ */

export type RunGateInput = {
  intervalMinutes: number | null;
  minutesSinceLastRun: number | null;
  /** 安全停止が出ているか（orchestrator.checkSafetyStops の結果）。 */
  safetyStopped: boolean;
  safetyReasonsJa: string[];
  /** 自動リサーチ自体が有効か（人が切れるようにしておく）。 */
  enabled: boolean;
};

export type RunGateResult = { run: boolean; reasonJa: string };

/**
 * ★安全停止をいちばん先に見る。
 *   間隔の判定を先に置くと、「時間が来たから回す」が安全停止より強くなる。
 */
export function mayRunNow(input: RunGateInput): RunGateResult {
  if (!input.enabled) {
    return { run: false, reasonJa: '自動リサーチが止められています。' };
  }
  if (input.safetyStopped) {
    return {
      run: false,
      reasonJa: `安全のため止めています：${input.safetyReasonsJa.join('／')}`,
    };
  }
  if (input.intervalMinutes === null) {
    return { run: false, reasonJa: '回してよい間隔が決まっていないので、回しません。' };
  }
  if (input.minutesSinceLastRun === null) {
    return { run: true, reasonJa: 'まだ一度も回していないので、1回目を回します。' };
  }
  if (input.minutesSinceLastRun < input.intervalMinutes) {
    const wait = input.intervalMinutes - input.minutesSinceLastRun;
    return { run: false, reasonJa: `前回から${Math.floor(input.minutesSinceLastRun)}分です。あと${Math.ceil(wait)}分待ちます。` };
  }
  return { run: true, reasonJa: '前回から十分な時間がたっています。' };
}

/* ================================================================
 * 4. 自動で回すことに対する歯止め
 * ================================================================ */

/**
 * ご本人の指示（原文・§53）：
 *   「まだ、自動購入・自動出品・自動決済・自動発送 は実装しない。」
 *
 * ★Scheduler は「調べる」だけを回す。
 *   ここに買う処理を足せる形にしておくと、いつか足される。
 */
export const SCHEDULER_ALLOWED_ACTIONS = ['RESEARCH', 'WATCH', 'REPORT'] as const;
export type SchedulerAction = (typeof SCHEDULER_ALLOWED_ACTIONS)[number];

export const SCHEDULER_ACTION_JA: Record<SchedulerAction, string> = {
  RESEARCH: '調べる',
  WATCH: '見張る',
  REPORT: '報告する',
};

export const SCHEDULER_CAN_PURCHASE = false;
export const SCHEDULER_CAN_LIST = false;
export const SCHEDULER_CAN_PAY = false;
export const SCHEDULER_CAN_SHIP = false;

/**
 * いま Scheduler を動かしてよい状態か、人が読む形でまとめる。
 *
 * ★「回せる口が0件」を異常として赤くしない。
 *   いまはそれが正しい状態であり、赤くすると直そうとして
 *   無理に口を足す方向へ動いてしまう。
 */
export function schedulerStatusJa(autoReadyConnectorCount: number, runnableJobCount: number): string[] {
  if (autoReadyConnectorCount === 0) {
    return [
      '自動で取得してよいと確認できた市場が0件です。',
      'この状態では何も回しません（勝手に外部を見に行くことはありません）。',
      '市場を1つ正式につなぐと、そこから回りはじめます。',
    ];
  }
  if (runnableJobCount === 0) {
    return [
      `自動で取得してよい市場は${autoReadyConnectorCount}件ありますが、`,
      '呼んでよい頻度が決まっている用件が0件なので、まだ回しません。',
    ];
  }
  return [
    `自動で取得してよい市場${autoReadyConnectorCount}件・回せる用件${runnableJobCount}件です。`,
    '回すのは「調べる・見張る・報告する」の3つだけです。買う・出品する・支払う・送るは入っていません。',
  ];
}
