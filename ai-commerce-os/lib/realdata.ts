/**
 * 「これは実市場のデータか」の判定（Phase 3.5・§4 §9 §10）。
 *
 * 【この1ファイルが Phase 3.5 でいちばん重要】
 * ユーザー指示は「実市場データによるSHADOW TRADEを最低100件。テストデータは件数に含めない」。
 * つまり、システムが自分で作ったサンプルを実データとして数えた瞬間に、
 * このフェーズの目的そのものが崩れる。
 *
 * だから判定は1か所に集め、条件を厳しくし、迷ったら false にする（Fail Closed）。
 * 「たぶん実データだろう」は実データではない。
 *
 * 【実データと認める条件（すべて満たすこと）】
 *   1. 取得方法が正規のものである（API / 正式なデータフィード / Webhook / 人が実際の画面を見て記録したCSV）
 *   2. どこから取ったかが分かる（出典URL、または出典名）
 *   3. いつ観測したかが分かる（observed_at）
 *   4. 観測日が未来ではない（明らかな入力ミスを実データにしない）
 *   5. 設計用サンプルの印が付いていない
 *
 * 【スクレイピングはここに無い】
 * 無断の自動巡回で得たデータは、そもそも受け付けない。
 * 取得方法として選べる値の中に入れていない（CLAUDE.md ルール1）。
 */

/** 実データとして認める取得方法。ここに無いものはすべてテスト扱い。 */
export const REAL_DATA_SOURCES = new Set([
  /** 公式API・法人APIから取得 */
  'API',
  /** 正式に提供されたデータフィード */
  'CSV_FEED',
  'PARTNER_FEED',
  /** 正式なWebhook通知 */
  'WEBHOOK',
  /** 人間が実際の市場画面を見て手で記録したもの。規約上いちばん安全な方法 */
  'MANUAL_OBSERVATION',
]);

/** テストデータ・設計用サンプルであることが分かる印。 */
export const SAMPLE_MARKERS = ['SAMPLE', 'SEED', 'TEST', 'DEMO', 'DUMMY', 'FIXTURE', '設計用', 'サンプル'];

export type RealDataInput = {
  dataSource: string | null | undefined;
  sourceUrl?: string | null;
  sourceNote?: string | null;
  observedAt?: string | null;
  now?: number;
};

export type RealDataJudgement = {
  isReal: boolean;
  /** なぜ実データではないのか。画面にそのまま日本語で出す。 */
  reason: string;
};

export function judgeRealMarketData(i: RealDataInput): RealDataJudgement {
  const src = String(i.dataSource ?? '').toUpperCase().replace(/[\s-]/g, '_');

  if (!REAL_DATA_SOURCES.has(src)) {
    return {
      isReal: false,
      reason: src === 'CSV_MANUAL'
        ? '手入力のCSV。実際の市場画面を見て記録したものなら取得方法を MANUAL_OBSERVATION にする'
        : `取得方法「${i.dataSource ?? '未指定'}」は正規の取得手段として登録されていない`,
    };
  }

  const note = String(i.sourceNote ?? '').toUpperCase();
  const url = String(i.sourceUrl ?? '');
  const marked = SAMPLE_MARKERS.some((m) => note.includes(m.toUpperCase()) || url.toUpperCase().includes(m.toUpperCase()));
  if (marked) {
    return { isReal: false, reason: '設計用サンプル・テストデータの印が付いている' };
  }

  if (!url && !String(i.sourceNote ?? '')) {
    return { isReal: false, reason: 'どこから取得したデータかが分からない（出典URLも出典名も無い）' };
  }

  if (!i.observedAt) {
    return { isReal: false, reason: 'いつ観測したデータか分からない' };
  }
  const t = Date.parse(i.observedAt);
  if (!Number.isFinite(t)) {
    return { isReal: false, reason: '観測日時が読み取れない' };
  }
  // 未来の日付は入力ミス。実データとして数えると、答え合わせの前後関係が壊れる。
  if (t > (i.now ?? Date.now()) + 86400000) {
    return { isReal: false, reason: '観測日時が未来になっている（入力ミスの可能性）' };
  }

  return { isReal: true, reason: '正規の取得方法・出典・観測日時がそろっている' };
}

/**
 * SHADOW全体が実市場データかどうか（§9）。
 *
 * 【片方だけ実データでも実市場とは呼ばない】
 * 仕入側だけ実データで販売側がサンプルなら、その利益予測は実市場のものではない。
 * 両側そろっているものだけを実市場のSHADOWとして数える。
 */
export function shadowIsRealMarket(buyIsReal: boolean, sellIsReal: boolean): boolean {
  return buyIsReal && sellIsReal;
}

export const DATA_SOURCE_JA: Record<string, string> = {
  API: '公式API',
  CSV_FEED: '正式なデータフィード（CSV）',
  PARTNER_FEED: '提携先のデータフィード',
  WEBHOOK: '正式なWebhook通知',
  MANUAL_OBSERVATION: '人が実際の市場画面を見て記録',
  CSV_MANUAL: '手入力CSV（実データとして数えない）',
  NONE: '取得できていない',
};

export function dataSourceJa(code: string | null | undefined): string {
  const k = String(code ?? 'NONE').toUpperCase();
  return DATA_SOURCE_JA[k] ?? k;
}
