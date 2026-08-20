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

/**
 * 【重要な訂正・2026-08-20】
 * 「CSVだから規約上安全」という説明は誤り。CSVはただの入れ物であって、根拠ではない。
 *
 * 区別すべきなのはファイル形式ではなく、**データの出どころの立場** である。
 *
 *   MANUAL_OBSERVATION … 自分が公開画面を見て、必要な情報を手で書き写した
 *                         → 相手からデータ提供を受けたわけではない。
 *                            相手は「渡した」と認識していない。契約も無い。
 *                            件数が増えれば人手でも規約上の問題になり得る。
 *
 *   OFFICIAL_CSV_FEED  … 事業者が正式に提供したデータフィード（契約・利用規約あり）
 *                         → 相手が「渡す」と決めて渡している。使ってよい範囲が文書で決まっている。
 *
 * この2つを同じ箱に入れると、
 * 「手で写したものを、正式提供データと同じ信頼度で扱う」という一番危ない誤解が起きる。
 * だから種別を分け、画面にも別の文言で出す。
 */

/** データの出どころの立場。ファイル形式ではなく「誰が渡したか」で分ける。 */
export type SourceClass =
  /** 事業者から正式に提供された（契約・規約で使ってよい範囲が決まっている） */
  | 'PROVIDED_BY_VENUE'
  /** 自分が公開画面を見て手で記録した（提供を受けたわけではない） */
  | 'SELF_OBSERVED'
  /** 実データではない */
  | 'NOT_REAL';

/** 実データとして認める取得方法。ここに無いものはすべてテスト扱い。 */
export const REAL_DATA_SOURCES = new Set([
  /** 公式API・法人APIから取得 */
  'API',
  /** 事業者が正式に提供したデータフィード（CSV形式） */
  'OFFICIAL_CSV_FEED',
  /** 提携先から正式に提供されたフィード */
  'PARTNER_FEED',
  /** 正式なWebhook通知 */
  'WEBHOOK',
  /** 人間が公開画面を見て手で記録したもの。**正式提供ではない**（下の注意を読むこと） */
  'MANUAL_OBSERVATION',
]);

/** 取得方法ごとの「立場」。ここが実装上の分離点。 */
export const SOURCE_CLASS_OF: Record<string, SourceClass> = {
  API: 'PROVIDED_BY_VENUE',
  OFFICIAL_CSV_FEED: 'PROVIDED_BY_VENUE',
  PARTNER_FEED: 'PROVIDED_BY_VENUE',
  WEBHOOK: 'PROVIDED_BY_VENUE',
  MANUAL_OBSERVATION: 'SELF_OBSERVED',
};

export function sourceClassOf(code: string | null | undefined): SourceClass {
  const k = normalizeSource(code);
  return SOURCE_CLASS_OF[k] ?? 'NOT_REAL';
}

/**
 * 自分で見て記録したデータに付ける注意書き。
 * 画面と取込結果に必ず出す。「安全だから増やしてよい」と読ませない。
 */
export const SELF_OBSERVED_CAUTION =
  '自分で公開画面を見て記録したデータです。事業者から提供を受けたデータではありません。'
  + '自動巡回は行わず、閲覧の範囲を超えないでください。件数を増やす前に、正規の提供手段（公式API・データフィード）を探してください。';

/** 旧称の受け皿。過去データを読めなくしないために残す（新規では使わない）。 */
const SOURCE_ALIASES: Record<string, string> = {
  CSV_FEED: 'OFFICIAL_CSV_FEED',
};

function normalizeSource(code: string | null | undefined): string {
  const k = String(code ?? '').toUpperCase().replace(/[\s-]/g, '_');
  return SOURCE_ALIASES[k] ?? k;
}

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
  /** データの出どころの立場。実データでも「正式提供」と「自分で記録」は別物。 */
  sourceClass: SourceClass;
  /** 自分で記録したデータのときだけ付く注意書き。 */
  caution: string | null;
};

export function judgeRealMarketData(i: RealDataInput): RealDataJudgement {
  const src = normalizeSource(i.dataSource);
  const cls = sourceClassOf(src);
  const fail = (reason: string): RealDataJudgement =>
    ({ isReal: false, reason, sourceClass: 'NOT_REAL', caution: null });

  if (!REAL_DATA_SOURCES.has(src)) {
    return fail(
      src === 'CSV_MANUAL'
        ? '手入力のCSV。実際の市場画面を見て記録したものなら取得方法を MANUAL_OBSERVATION にする'
        : `取得方法「${i.dataSource ?? '未指定'}」は正規の取得手段として登録されていない`,
    );
  }

  const note = String(i.sourceNote ?? '').toUpperCase();
  const url = String(i.sourceUrl ?? '');
  const marked = SAMPLE_MARKERS.some((m) => note.includes(m.toUpperCase()) || url.toUpperCase().includes(m.toUpperCase()));
  if (marked) return fail('設計用サンプル・テストデータの印が付いている');

  if (!url && !String(i.sourceNote ?? '')) {
    return fail('どこから取得したデータかが分からない（出典URLも出典名も無い）');
  }

  if (!i.observedAt) return fail('いつ観測したデータか分からない');

  const t = Date.parse(i.observedAt);
  if (!Number.isFinite(t)) return fail('観測日時が読み取れない');

  // 未来の日付は入力ミス。実データとして数えると、答え合わせの前後関係が壊れる。
  if (t > (i.now ?? Date.now()) + 86400000) {
    return fail('観測日時が未来になっている（入力ミスの可能性）');
  }

  return {
    isReal: true,
    reason: cls === 'SELF_OBSERVED'
      ? '実市場データ（自分で公開画面を見て記録したもの。正式提供データではない）'
      : '実市場データ（事業者から正式に提供されたもの）',
    sourceClass: cls,
    caution: cls === 'SELF_OBSERVED' ? SELF_OBSERVED_CAUTION : null,
  };
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
  API: '公式API（事業者から正式に提供）',
  OFFICIAL_CSV_FEED: '正式なデータフィード（事業者から正式に提供）',
  PARTNER_FEED: '提携先のデータフィード（正式に提供）',
  WEBHOOK: '正式なWebhook通知（事業者から正式に提供）',
  MANUAL_OBSERVATION: '自分で公開画面を見て記録（正式提供ではない）',
  CSV_MANUAL: '手入力CSV（実データとして数えない）',
  NONE: '取得できていない',
};

export function dataSourceJa(code: string | null | undefined): string {
  const k = normalizeSource(code) || 'NONE';
  return DATA_SOURCE_JA[k] ?? k;
}

export const SOURCE_CLASS_JA: Record<SourceClass, string> = {
  PROVIDED_BY_VENUE: '事業者から正式に提供されたデータ',
  SELF_OBSERVED: '自分で公開画面を見て記録したデータ',
  NOT_REAL: '実市場データではない',
};
