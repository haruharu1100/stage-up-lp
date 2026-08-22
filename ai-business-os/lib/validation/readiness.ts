import { COST_KIND_LABEL, type TotalPnl } from '../economics/pnl';
import { MAX_TEST_LOSS_OPTIONS, VALIDATION_CHANNEL_LABEL, sampleLabel, type ValidationChannelKey } from './channels';
import type { JapanStage } from '../types';

/**
 * 本番テストを始める前のチェック（READY / NOT READY）。
 *
 * 「とりあえず出してみる」を認めない。
 * 出してから決めると、都合の良い数字だけを後付けの成功条件にしてしまい、
 * いつまでも撤退できず、費用だけが増える。
 *
 * 12項目すべてが揃って初めて READY。1つでも欠けたら NOT READY。
 * ここでの READY は「人が始めてよいか判断できる状態」という意味であり、
 * このシステムが投稿・送信・架電・課金を行うという意味ではない（その処理は存在しない）。
 */

export type ReadinessKey =
  | 'JAPAN_RESEARCH'
  | 'COMPETITORS'
  | 'PRICE'
  | 'TARGET'
  | 'CHANNEL'
  | 'TEST_UNIT'
  | 'SAMPLE_SIZE'
  | 'MAX_TEST_LOSS'
  | 'KILL_CRITERIA'
  | 'SCALE_CRITERIA'
  | 'PNL'
  | 'MEASUREMENT';

export const READINESS_ITEMS: { key: ReadinessKey; label: string; why: string }[] = [
  { key: 'JAPAN_RESEARCH', label: '日本市場調査', why: '日本で需要があるか調べずに売ると、海外で流行っただけの物を売ることになる' },
  { key: 'COMPETITORS', label: '競合', why: '競合を知らずに値段を決めると、高すぎて売れないか、安すぎて赤字になる' },
  { key: 'PRICE', label: '価格', why: '価格が決まっていないと、いくら売れれば黒字かも決まらない' },
  { key: 'TARGET', label: 'ターゲット', why: '誰に売るかが曖昧だと、反応が悪かった理由が分からない' },
  { key: 'CHANNEL', label: 'チャネル', why: 'どこで売るかで、必要な件数も費用も変わる' },
  { key: 'TEST_UNIT', label: 'テスト単位', why: '「100件」が何の100件かを決めないと、結果を比べられない' },
  { key: 'SAMPLE_SIZE', label: 'サンプル数', why: '少ない件数で判断すると、たまたまの結果を実力と勘違いする' },
  { key: 'MAX_TEST_LOSS', label: '最大損失額', why: '上限を決めずに始めると、負けを取り返そうとして損失が伸びる' },
  { key: 'KILL_CRITERIA', label: '撤退条件', why: '止める条件を先に決めないと、後から都合よく緩めてしまう' },
  { key: 'SCALE_CRITERIA', label: '拡大条件', why: '当たった時に増やす基準が無いと、良い結果を活かせない' },
  { key: 'PNL', label: '損益計算（P&L）', why: '費用を数えていないと、売れているのに赤字という状態に気付けない' },
  { key: 'MEASUREMENT', label: '計測方法', why: '計測できない施策は、良かったのか悪かったのか永久に分からない' },
];

export type ReadinessCheck = {
  key: ReadinessKey;
  label: string;
  ok: boolean;
  /** 何を根拠にOK/NGとしたか。人が読んで直せる文にする */
  detail: string;
  why: string;
};

export type Readiness = {
  verdict: 'READY' | 'NOT READY';
  checks: ReadinessCheck[];
  missing: ReadinessKey[];
  /** 承認画面にそのまま出す1行説明 */
  message: string;
};

export type ReadinessInput = {
  ideaTitle: string;
  /** 日本市場調査の結果。未調査なら null */
  japan: { stage: JapanStage; confidence: number; sources: number } | null;
  /** 見つかった国内競合の社数。調べていないなら null（0にしない） */
  competitorCount: number | null;
  /** 販売価格（円）。未定なら null */
  priceYen: number | null;
  /** 誰に売るか。空文字なら未記入 */
  target: string;
  channel: ValidationChannelKey | null;
  testUnit: string;
  /** 目標サンプル数 */
  sampleTarget: number | null;
  /** 統計的に必要な最低件数。分からないなら null */
  sampleNeeded: number | null;
  maxTestLossYen: number | null;
  killCriteria: string;
  scaleCriteria: string;
  pnl: TotalPnl | null;
  /** 計測方法（UTM・計測イベント）が用意できているか */
  measurement: { utm: boolean; events: number } | null;
};

/** 日本市場調査が「調べた」と言える最低の情報源数。1エンジンだけで断定しない */
export const MIN_SOURCES_FOR_READY = 2;

/** 撤退条件・拡大条件は、後から解釈がぶれない程度の具体性を求める */
const MIN_CRITERIA_LENGTH = 10;

function check(
  key: ReadinessKey,
  ok: boolean,
  detail: string
): ReadinessCheck {
  const item = READINESS_ITEMS.find((i) => i.key === key);
  if (!item) throw new Error(`未定義のチェック項目: ${key}`);
  return { key, label: item.label, ok, detail, why: item.why };
}

export function checkReadiness(input: ReadinessInput): Readiness {
  const checks: ReadinessCheck[] = [];

  const j = input.japan;
  checks.push(
    check(
      'JAPAN_RESEARCH',
      j !== null && j.stage !== 'UNKNOWN' && j.sources >= MIN_SOURCES_FOR_READY,
      j === null
        ? '日本市場をまだ調べていない'
        : j.stage === 'UNKNOWN'
          ? '調べたが判定不能（情報が足りない）'
          : j.sources < MIN_SOURCES_FOR_READY
            ? `情報源が${j.sources}種類しかない。1つの検索エンジンだけで「日本に競合がない」と決めない（最低${MIN_SOURCES_FOR_READY}種類）`
            : `国内の状況：${j.stage}（確からしさ ${Math.round(j.confidence * 100)}％・情報源${j.sources}種類）`
    )
  );

  const cc = input.competitorCount;
  checks.push(
    check(
      'COMPETITORS',
      cc !== null,
      cc === null ? '国内競合を数えていない（0社ではなく未調査）' : `国内競合 ${cc}社を確認済み`
    )
  );

  checks.push(
    check(
      'PRICE',
      input.priceYen !== null && input.priceYen > 0,
      input.priceYen === null || input.priceYen <= 0
        ? '販売価格が未定'
        : `販売価格 ${input.priceYen.toLocaleString()}円`
    )
  );

  checks.push(
    check(
      'TARGET',
      input.target.trim().length > 0,
      input.target.trim().length > 0 ? `売る相手：${input.target.trim()}` : '誰に売るかが未記入'
    )
  );

  checks.push(
    check(
      'CHANNEL',
      input.channel !== null,
      input.channel === null
        ? 'どこで売るかが未決定'
        : `売り方：${VALIDATION_CHANNEL_LABEL[input.channel]}`
    )
  );

  checks.push(
    check(
      'TEST_UNIT',
      input.testUnit.trim().length > 0,
      input.testUnit.trim().length > 0
        ? `テスト単位：${input.testUnit.trim()}`
        : '「何を1件と数えるか」が未決定'
    )
  );

  const target = input.sampleTarget;
  const needed = input.sampleNeeded;
  const sampleOk = target !== null && target > 0 && (needed === null || target >= needed);
  checks.push(
    check(
      'SAMPLE_SIZE',
      sampleOk,
      target === null || target <= 0
        ? '必要な件数が未決定'
        : needed !== null && target < needed
          ? `目標${target}件は、判断に必要な${needed}件に足りない`
          : input.channel !== null
            ? `目標 ${sampleLabel(input.channel, target)}`
            : `目標 ${target}件`
    )
  );

  const loss = input.maxTestLossYen;
  checks.push(
    check(
      'MAX_TEST_LOSS',
      loss !== null && loss > 0,
      loss === null || loss <= 0
        ? `最大損失額が未設定（選べる上限：${MAX_TEST_LOSS_OPTIONS.map((v) => `${v.toLocaleString()}円`).join(' / ')}）`
        : `ここまで負けたら止める：${loss.toLocaleString()}円`
    )
  );

  checks.push(
    check(
      'KILL_CRITERIA',
      input.killCriteria.trim().length >= MIN_CRITERIA_LENGTH,
      input.killCriteria.trim().length >= MIN_CRITERIA_LENGTH
        ? `撤退条件：${input.killCriteria.trim()}`
        : '撤退条件が未記入、または「反応が悪ければ止める」のように後から解釈を変えられる書き方になっている'
    )
  );

  checks.push(
    check(
      'SCALE_CRITERIA',
      input.scaleCriteria.trim().length >= MIN_CRITERIA_LENGTH,
      input.scaleCriteria.trim().length >= MIN_CRITERIA_LENGTH
        ? `拡大条件：${input.scaleCriteria.trim()}`
        : '拡大条件が未記入、または具体的な数字が入っていない'
    )
  );

  const pnl = input.pnl;
  checks.push(
    check(
      'PNL',
      pnl !== null && pnl.missingCostKinds.length === 0,
      pnl === null
        ? '損益計算がまだ無い'
        : pnl.missingCostKinds.length > 0
          ? `未記入の費目がある：${pnl.missingCostKinds.map((k) => COST_KIND_LABEL[k]).join(' / ')}。この分だけ利益が多めに出ている`
          : `費用は全費目が記入済み（うち作業時間 ${Math.round((pnl.labor.minutes / 60) * 10) / 10}時間＝${pnl.labor.amountYen.toLocaleString()}円）`
    )
  );

  const m = input.measurement;
  checks.push(
    check(
      'MEASUREMENT',
      m !== null && m.utm && m.events > 0,
      m === null
        ? '計測の準備がまだ無い'
        : !m.utm
          ? 'リンクに計測用の印（UTM）が付いていない。どこから来たのか分からなくなる'
          : m.events <= 0
            ? '記録する出来事（申込・購入など）が1つも定義されていない'
            : `計測用リンクあり・記録する出来事 ${m.events}種類`
    )
  );

  const missing = checks.filter((c) => !c.ok).map((c) => c.key);
  const verdict = missing.length === 0 ? 'READY' : 'NOT READY';
  return {
    verdict,
    checks,
    missing,
    message:
      verdict === 'READY'
        ? `${input.ideaTitle}：12項目すべて揃っている。人が最終承認すればテストを始められる（送信・投稿・課金の処理はこのシステムに無い。実際の連絡は人が行う）`
        : `${input.ideaTitle}：NOT READY。不足 ${missing.length}項目（${missing
            .map((k) => READINESS_ITEMS.find((i) => i.key === k)?.label ?? k)
            .join(' / ')}）。1つでも欠けている間はテストを始めない`,
  };
}
