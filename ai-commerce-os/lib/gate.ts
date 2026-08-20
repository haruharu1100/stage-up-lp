import { all, nowIso, run } from './db/client';
import { feeStatusCoverage, feeStatusOfUsedRoutes } from './feestatus';
import { precisionReport, realShadowDiversity } from './precision';
import { getGateThresholds, isPhase4Unlocked, type GateThresholds } from './settings';

/**
 * Phase 4（少額の実購入）へ進んでよいかの判定（Phase 3.5・§20 §21 §25）。
 *
 * 【このファイルの役割はただ一つ】
 * 「まだ進めない」と言い続けること。
 *
 * ユーザー指示：「勝手に条件を緩和しないでください」。
 * だからこのファイルは、条件を判定するだけで、条件を書き換えない。
 * 数値は設定（GATE_*）に置いてあるが、AIがそれを変更する経路はコードに存在しない。
 *
 * 【二重の鍵】
 *   鍵1：ここの全項目が合格すること
 *   鍵2：人間が PHASE4_UNLOCKED を true にすること
 *
 * 鍵1が全部通っても、鍵2が無ければ何も起きない。
 * そして今この瞬間、実購入のコードはそもそも1行も存在しない。
 * 仮に両方の鍵が開いても、勝手に商品が買われることはない。
 *
 * 【「不明」は不合格にする】
 * 測れていない項目を「たぶん大丈夫」で通さない（Fail Closed）。
 * 実市場データが0件なら、精度は「100%」ではなく「測定不能」であり、不合格である。
 */

export type GateCheck = {
  key: string;
  /** 画面にそのまま出す日本語の項目名 */
  label: string;
  passed: boolean;
  /** 今の値（測れていなければ null） */
  actual: number | null;
  /** 必要な値 */
  required: number;
  /** 大きいほど良いのか、小さいほど良いのか */
  direction: 'min' | 'max';
  /** なぜ合格／不合格なのかの一文 */
  note: string;
};

export type GateResult = {
  evaluatedAt: string;
  passed: boolean;
  passedCount: number;
  totalCount: number;
  /** 人間が解錠したか。合格していても、これが false なら進まない */
  humanUnlocked: boolean;
  /** 経営者向けの結論1行（§25） */
  verdictJa: string;
  checks: GateCheck[];
  thresholds: GateThresholds;
};

const fmtPct = (v: number | null) => (v === null ? '測定不能' : `${(v * 100).toFixed(1)}%`);

function check(
  key: string, label: string, actual: number | null, required: number,
  direction: 'min' | 'max', render: (v: number | null) => string, extra = '',
): GateCheck {
  // 測れていないものは不合格。ここを true にすると、データが無いほど通りやすくなる。
  const passed = actual === null ? false
    : direction === 'min' ? actual >= required : actual <= required;
  const need = direction === 'min' ? `${render(required)}以上` : `${render(required)}以下`;
  const note = actual === null
    ? `まだ測れていない（必要：${need}）${extra}`
    : `今は ${render(actual)}／必要：${need}${extra}`;
  return { key, label, passed, actual, required, direction, note };
}

/**
 * 卒業条件をすべて測る（記録はしない）。
 *
 * 画面を開くたびに履歴が増えると、
 * 「条件を緩めていないか」を後から追うための履歴が読めなくなる。
 * だから画面はこちらを使い、記録を残すのは実行コマンドのときだけにする。
 */
export async function peekPhase4Gate(): Promise<GateResult> {
  const g = await getGateThresholds();
  const now = nowIso();

  // --- 実市場データの量（§9）
  const div = await realShadowDiversity();
  const evalRows = await all(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN e.outcome = 'ACTUAL_SALE_UNCONFIRMED' THEN 1 ELSE 0 END) AS unconfirmed
       FROM shadow_evaluations e
       JOIN route_shadow_trades s ON s.id = e.shadow_id
      WHERE e.outcome <> 'PENDING' AND s.real_market_data = 1`,
  );
  const evaluated = Number(evalRows[0]?.n ?? 0);
  const unconfirmed = Number(evalRows[0]?.unconfirmed ?? 0);

  // --- 精度（§19 §26）。実市場データだけで測る。
  const p = await precisionReport(30, true);

  // --- 手数料の確からしさ（§1 §2）
  const feeCov = await feeStatusCoverage();
  const feeUsed = await feeStatusOfUsedRoutes();

  // --- 相場データの信頼度
  const conf = await all(
    `SELECT AVG(market_data_confidence) AS avg_c, MIN(market_data_confidence) AS min_c
       FROM route_shadow_trades WHERE real_market_data = 1 AND market_data_confidence IS NOT NULL`,
  );
  const avgConf = conf[0]?.avg_c === null || conf[0]?.avg_c === undefined ? null : Number(conf[0].avg_c);
  const minConf = conf[0]?.min_c === null || conf[0]?.min_c === undefined ? null : Number(conf[0].min_c);

  const num = (v: number | null) => (v === null ? '測定不能' : String(Math.round(v * 10) / 10));

  const checks: GateCheck[] = [
    check('real_shadow', '実市場データのSHADOW件数', div.realShadowCount, g.minRealShadow, 'min', num,
      'ぶんの実データ（テストデータは数えない）'),
    check('evaluated', '答え合わせが済んだ件数', evaluated, g.minEvaluated, 'min', num, '件'),
    check('strong_buy_samples', 'STRONG BUY の判断件数', p.strongBuy.decidedBuy, g.minStrongBuySamples, 'min', num,
      '件（少なすぎる件数で精度を語らない）'),
    check('strong_buy_precision', 'STRONG BUY が実際に利益になった割合',
      p.strongBuy.precision, g.minStrongBuyPrecision, 'min', fmtPct),
    check('strong_buy_precision_lower', '同・95%下限（偶然の当たりを除いた線）',
      p.strongBuy.precisionLower, g.minStrongBuyPrecisionLower, 'min', fmtPct),
    check('buy_precision', 'BUY 以上が実際に利益になった割合',
      p.buyOrBetter.precision, g.minBuyPrecision, 'min', fmtPct),
    check('false_positive_rate', '買うと判断して損した割合',
      p.buyOrBetter.falsePositiveRate, g.maxFalsePositiveRate, 'max', fmtPct),
    check('unconfirmed_ratio', '売れたか確認できなかった割合',
      evaluated > 0 ? unconfirmed / evaluated : null, g.maxUnconfirmedRatio, 'max', fmtPct),
    check('verified_fee_ratio', '手数料が実額で確認できている市場の割合',
      feeCov.total > 0 ? feeCov.verifiedRatio : null, g.minVerifiedFeeRatio, 'min', fmtPct),
    check('verified_fee_used', '実際に使った市場の手数料が確認済みの割合',
      feeUsed.usedPairs > 0 ? feeUsed.ratio : null, g.minVerifiedFeeRatio, 'min', fmtPct,
      '（全体が良くても、使った市場が概算なら意味がない）'),
    check('market_confidence', '相場データの信頼度（平均）', avgConf, g.minMarketConfidence, 'min', num, '点'),
    check('market_confidence_worst', '相場データの信頼度（いちばん低いもの）',
      minConf, g.minMarketConfidenceWorst, 'min', num, '点'),
    check('venue_diversity', '実データが集まった市場の組み合わせ数',
      div.venuePairs > 0 ? div.venuePairs : null, g.minVenueDiversity, 'min', num,
      '通り（1つの市場だけで良い成績でも一般化できない）'),
    check('category_diversity', '実データが集まった商品カテゴリ数',
      div.categories > 0 ? div.categories : null, g.minCategoryDiversity, 'min', num, '種類'),
  ];

  const passedCount = checks.filter((c) => c.passed).length;
  const allPassed = passedCount === checks.length;
  const humanUnlocked = await isPhase4Unlocked();

  const failed = checks.filter((c) => !c.passed);
  const verdictJa = !allPassed
    ? `まだ実購入に進めません。${checks.length}項目中${passedCount}項目クリア。あと${failed.length}項目（例：${failed.slice(0, 2).map((f) => f.label).join('・')}）が足りません。`
    : humanUnlocked
      ? `卒業条件はすべてクリアし、人による解錠も済んでいます。ただし実購入の処理はまだ作られていないため、自動では何も買いません。`
      : `卒業条件はすべてクリアしました。実購入へ進むかどうかは人が決めてください（AIは解錠できません）。`;

  return {
    evaluatedAt: now,
    passed: allPassed,
    passedCount,
    totalCount: checks.length,
    humanUnlocked,
    verdictJa,
    checks,
    thresholds: g,
  };
}

/**
 * 卒業条件を測り、結果を `phase_gate_log` に残す。
 * 実行しても何も解禁しない。判定して記録するだけ。
 */
export async function evaluatePhase4Gate(): Promise<GateResult> {
  const r = await peekPhase4Gate();
  await run(
    `INSERT INTO phase_gate_log (evaluated_at, gate_name, passed, passed_count, total_count, verdict_ja, detail_json)
     VALUES (?,?,?,?,?,?,?)`,
    [r.evaluatedAt, 'PHASE4', r.passed ? 1 : 0, r.passedCount, r.totalCount, r.verdictJa,
     JSON.stringify({ checks: r.checks, humanUnlocked: r.humanUnlocked, thresholds: r.thresholds })],
  );
  return r;
}

/** 直近の判定履歴。条件が緩められていないかを人が後から見るため。 */
export async function gateHistory(limit = 30) {
  return all(
    `SELECT evaluated_at, gate_name, passed, passed_count, total_count, verdict_ja
       FROM phase_gate_log ORDER BY id DESC LIMIT ?`,
    [limit],
  );
}
