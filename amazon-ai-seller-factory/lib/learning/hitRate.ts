import { all, one } from '../db/client';

/**
 * Aランクの的中率と、AI社員それぞれの成績表。
 *
 * ★ユーザー指定の絶対ルール：
 *   「Aランク商品の的中率を管理画面の最上部に表示してください。」
 *   「AI社員ごとの成績表を作ってください。」
 *   「データ取得失敗時に推測値で埋めないでください。UNKNOWNとして扱ってください。」
 *
 * ★このファイルにAIは1行も出てこない。全部わり算。
 *   実績が無いところは必ず null（＝「まだ分かりません」）にする。
 *   サンプルが少ないのに「的中率100%」と出すのは嘘なので、
 *   最低件数に届くまでは「判定できません」と正直に書く。
 */

/** これ以下の件数では的中率を「成績」として扱わない（少なすぎて意味がないため） */
export const MIN_SAMPLES_FOR_RATE = 3;

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function avg(list: (number | null)[]): number | null {
  const vals = list.filter((v): v is number => v !== null);
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export interface GradeHitRate {
  days: number;
  /** Aランクと判定した商品数 */
  gradeACount: number;
  /** そのうち実際に仕入れた数 */
  purchasedCount: number;
  /** 実績が確定した数（黒字＋赤字） */
  judgedCount: number;
  profitableCount: number;
  lossCount: number;
  /** 的中率（黒字 ÷ 実績が確定した数）。件数が少なすぎるときは null */
  hitRate: number | null;
  /** 平均予測誤差（利益予測が実績から何%ずれたか）。分からなければ null */
  avgForecastErrorPct: number | null;
  /** 予測利益の合計と実績利益の合計 */
  forecastProfitJpy: number | null;
  actualProfitJpy: number | null;
  headline: string;
  note: string;
}

/**
 * Aランク商品の的中率。
 * 「過去◯日にAランクと判定した商品が、実際に利益を出したか」を数える。
 */
export async function gradeHitRate(days = 30): Promise<GradeHitRate> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await all(
    `SELECT forecast_grade, ordered_at, ordered_qty, forecast_profit_jpy, actual_profit_jpy
       FROM product_lifecycle
      WHERE forecast_grade = 'A' AND COALESCE(approved_at, created_at) >= ?`,
    [since],
  );

  const gradeACount = rows.length;
  const purchased = rows.filter((r) => r.ordered_at != null || n(r.ordered_qty));
  const judged = rows.filter((r) => n(r.actual_profit_jpy) !== null);
  const profitableCount = judged.filter((r) => (n(r.actual_profit_jpy) ?? 0) > 0).length;
  const lossCount = judged.filter((r) => (n(r.actual_profit_jpy) ?? 0) < 0).length;
  const decided = profitableCount + lossCount;

  const hitRate = decided >= MIN_SAMPLES_FOR_RATE ? profitableCount / decided : null;

  // 平均予測誤差：|実績 − 予測| ÷ |予測|。予測が0や不明の行は数えない。
  const errors = judged.map((r) => {
    const f = n(r.forecast_profit_jpy);
    const a = n(r.actual_profit_jpy);
    if (f === null || a === null || f === 0) return null;
    return Math.abs(a - f) / Math.abs(f);
  });
  const errAvg = avg(errors);

  const fSum = judged.map((r) => n(r.forecast_profit_jpy)).filter((v): v is number => v !== null);
  const aSum = judged.map((r) => n(r.actual_profit_jpy)).filter((v): v is number => v !== null);

  let headline: string;
  if (gradeACount === 0) {
    headline = `過去${days}日にAランクと判定した商品はまだありません`;
  } else if (decided === 0) {
    headline = `Aランク${gradeACount}件のうち、売れた実績が入った商品はまだありません（的中率はこれから出ます）`;
  } else if (hitRate === null) {
    headline = `実績が${decided}件しかないため、的中率はまだ判定していません（${MIN_SAMPLES_FOR_RATE}件から出します）`;
  } else {
    headline = `Aランクの的中率 ${Math.round(hitRate * 100)}%（黒字${profitableCount}件 ／ 赤字${lossCount}件）`;
  }

  const note =
    decided === 0
      ? '★実績が入るまでは、この数字は「まだ分かりません」のままです。推測では埋めません'
      : hitRate !== null && hitRate < 0.6
        ? '★的中率が低い状態です。仕入れを増やす前に、外した商品の理由（学習の画面）を先に見てください'
        : '実績が増えるほど、この数字の信頼度は上がります';

  return {
    days,
    gradeACount,
    purchasedCount: purchased.length,
    judgedCount: judged.length,
    profitableCount,
    lossCount,
    hitRate,
    avgForecastErrorPct: errAvg === null ? null : errAvg * 100,
    forecastProfitJpy: fSum.length ? Math.round(fSum.reduce((s, v) => s + v, 0)) : null,
    actualProfitJpy: aSum.length ? Math.round(aSum.reduce((s, v) => s + v, 0)) : null,
    headline,
    note,
  };
}

// ---- AI社員の成績表 -------------------------------------------------

export type ScoreVerdict = 'GOOD' | 'OK' | 'BAD' | 'UNKNOWN';

export const VERDICT_LABEL: Record<ScoreVerdict, string> = {
  GOOD: 'よくできています',
  OK: 'まずまず',
  BAD: '★見直しが必要',
  UNKNOWN: 'まだ判定できません',
};

export const VERDICT_COLOR: Record<ScoreVerdict, string | undefined> = {
  GOOD: undefined,
  OK: '#b36b00',
  BAD: '#b00',
  UNKNOWN: undefined,
};

export interface AgentScore {
  key: string;
  name: string;
  /** この社員が何を決めているか */
  role: string;
  /** 0〜100点。判定できないときは null（0点とは違う） */
  score: number | null;
  /** 何件の実績で判定したか */
  samples: number;
  verdict: ScoreVerdict;
  /** 何をもって点数にしたか（計算の中身を隠さない） */
  basis: string;
  /** 良くするには何をすればよいか */
  advice: string;
}

function verdictOf(score: number | null, samples: number): ScoreVerdict {
  if (score === null || samples < MIN_SAMPLES_FOR_RATE) return 'UNKNOWN';
  if (score >= 80) return 'GOOD';
  if (score >= 60) return 'OK';
  return 'BAD';
}

/**
 * AI社員5名の成績表。
 * リサーチAI／需要予測AI／利益予測AI／仕入数AI／広告AI。
 */
export async function aiScorecard(days = 30): Promise<{ agents: AgentScore[]; headline: string }> {
  const hit = await gradeHitRate(days);

  // ---- ① リサーチAI（Aランクをどれだけ当てたか）----------------------
  const research: AgentScore = {
    key: 'research',
    name: 'リサーチAI',
    role: '売れそうな商品を見つけて、A/B/C/Dのランクを付ける',
    score: hit.hitRate === null ? null : Math.round(hit.hitRate * 100),
    samples: hit.profitableCount + hit.lossCount,
    verdict: verdictOf(hit.hitRate === null ? null : hit.hitRate * 100, hit.profitableCount + hit.lossCount),
    basis:
      hit.hitRate === null
        ? `実績が確定した商品が${hit.profitableCount + hit.lossCount}件しかありません（${MIN_SAMPLES_FOR_RATE}件から判定します）`
        : `Aランクにした商品のうち、実際に黒字だった割合（黒字${hit.profitableCount}件／赤字${hit.lossCount}件）`,
    advice:
      hit.hitRate !== null && hit.hitRate < 0.6
        ? '外した商品の共通点（学習の画面の「失敗理由」）を見て、Aランクの条件を厳しくしてください'
        : '実績を入れ続けると精度が上がります。売れた商品の実績入力を止めないでください',
  };

  // ---- ②③ 需要予測AI・利益予測AI（予測と実績のズレ）------------------
  const acc = await all(
    `SELECT demand_accuracy, profit_accuracy, price_accuracy FROM forecast_accuracy`,
  );
  const demandVals = acc.map((r) => n(r.demand_accuracy)).filter((v): v is number => v !== null);
  const profitVals = acc.map((r) => n(r.profit_accuracy)).filter((v): v is number => v !== null);

  const demand: AgentScore = {
    key: 'demand',
    name: '需要予測AI',
    role: '「1か月に何個売れそうか」を出す',
    score: demandVals.length ? Math.round(avg(demandVals)!) : null,
    samples: demandVals.length,
    verdict: verdictOf(demandVals.length ? avg(demandVals) : null, demandVals.length),
    basis: demandVals.length
      ? `推定月販と実績月販のズレから計算した精度の平均（${demandVals.length}件）`
      : '実績（売れた個数と販売日数）がまだ入っていません',
    advice: '販売日数を必ず入れてください。日数が無いと「月に何個」に直せず、精度を計算できません',
  };

  const profit: AgentScore = {
    key: 'profit',
    name: '利益予測AI',
    role: '手数料・送料・広告費まで引いた「手元に残る額」を出す',
    score: profitVals.length ? Math.round(avg(profitVals)!) : null,
    samples: profitVals.length,
    verdict: verdictOf(profitVals.length ? avg(profitVals) : null, profitVals.length),
    basis: profitVals.length
      ? `予測利益と実績利益のズレから計算した精度の平均（${profitVals.length}件）`
      : '実績利益がまだ入っていません',
    advice: '実際にかかった費目（関税・国際送料・返品・保管料）を漏れなく入れると、次の予測が当たるようになります',
  };

  // ---- ④ 仕入数AI（多すぎ・少なすぎ）---------------------------------
  const qtyRows = await all(
    `SELECT ordered_qty, actual_units_sold, actual_selldays
       FROM product_lifecycle
      WHERE ordered_qty IS NOT NULL AND actual_units_sold IS NOT NULL`,
  );
  const qtyScores = qtyRows
    .map((r) => {
      const ordered = n(r.ordered_qty);
      const sold = n(r.actual_units_sold);
      if (ordered === null || sold === null || ordered <= 0) return null;
      // 仕入れた数のうち、実際に売れた割合。売り切れ＝100点、半分残った＝50点。
      // 売れすぎ（在庫切れ）も機会損失なので、上限は100点で止める。
      return Math.max(0, Math.min(1, sold / ordered)) * 100;
    })
    .filter((v): v is number => v !== null);
  const leftovers = qtyRows.filter((r) => (n(r.actual_units_sold) ?? 0) < (n(r.ordered_qty) ?? 0)).length;

  const qty: AgentScore = {
    key: 'quantity',
    name: '仕入数AI',
    role: '「何個買うか」を決める（初回は必ず少なめにする）',
    score: qtyScores.length ? Math.round(avg(qtyScores)!) : null,
    samples: qtyScores.length,
    verdict: verdictOf(qtyScores.length ? avg(qtyScores) : null, qtyScores.length),
    basis: qtyScores.length
      ? `仕入れた数のうち実際に売れた割合の平均（${qtyScores.length}件／売れ残りが出た商品${leftovers}件）`
      : '仕入数と販売実績の両方がそろった商品がまだありません',
    advice: '売れ残りが多いときは、初回の安全係数（NEW_PRODUCT_SAFETY_FACTOR）を下げて、もっと少なく試してください',
  };

  // ---- ⑤ 広告AI（赤字の広告を出していないか）--------------------------
  const adRows = await all(
    `SELECT acos, break_even_acos, state, ad_cost_jpy, profit_after_ad_jpy FROM ad_weekly`,
  );
  const adJudged = adRows.filter((r) => n(r.acos) !== null && n(r.break_even_acos) !== null);
  const adHealthy = adJudged.filter((r) => (n(r.acos) ?? 1) <= (n(r.break_even_acos) ?? 0)).length;
  const adScore = adJudged.length ? (adHealthy / adJudged.length) * 100 : null;
  const overspend = adJudged.length - adHealthy;

  const ads: AgentScore = {
    key: 'ads',
    name: '広告AI',
    role: '広告費と売上のつり合いを見て、増やす・減らすを提案する（実行はしません）',
    score: adScore === null ? null : Math.round(adScore),
    samples: adJudged.length,
    verdict: verdictOf(adScore, adJudged.length),
    basis: adJudged.length
      ? `広告費が利益の範囲に収まっていた週の割合（${adHealthy}週／${adJudged.length}週。使いすぎ${overspend}週）`
      : '広告の週次実績がまだ入っていません',
    advice: '★「売れるが赤字」も「黒字だがほぼ売れない」も失敗です。損益分岐点ACOSを超えた週から先に手を打ってください',
  };

  const agents = [research, demand, profit, qty, ads];
  const bad = agents.filter((a) => a.verdict === 'BAD');
  const unknown = agents.filter((a) => a.verdict === 'UNKNOWN');

  const headline = bad.length
    ? `★${bad.map((a) => a.name).join('・')}の成績が下がっています。仕入れを増やす前に確認してください`
    : unknown.length === agents.length
      ? 'まだ実績が無いため、AI社員の成績はどれも判定できません（本番データが入ると出ます）'
      : unknown.length
        ? `${agents.length - unknown.length}名ぶんの成績が出ています（残り${unknown.length}名は実績待ちです）`
        : '5名とも実績にもとづく成績が出ています';

  return { agents, headline };
}
