import { READINESS_LABEL, type Readiness } from '../catalog/definitions';
import type { Row } from '../db/client';
import type { JobAnalysis } from './analyze';

/**
 * 「どの案件から先に取りに行くか」を決める点数。
 *
 * ★金額の大きい順に並べてはいけない。
 *   50万円でも100時間かかる案件より、5万円で3時間の案件のほうが手元に残る。
 *   だから見るのは「時間あたりいくら残るか」を中心にする。
 *
 * ★ただし時間あたりの金額だけで並べると、見積りを短く読み違えた案件が
 *   いちばん上に来てしまう。見積り0.6時間・報酬3万円なら時給5万7千円だが、
 *   実際には打ち合わせと手直しが入るので、その通りにはならない。
 *   そこで時給は「目標の2倍」で頭打ちにし、頭打ちにしたことを理由として残す。
 *
 * ★手直しの起きやすさ（REVISION_RISK）を引き算する。
 *   手直しは、見積りに入っていない時間として必ず効いてくる。
 */

/** 手直しが起きやすい理由。1つずつ点数と説明を持たせ、あとから人が読めるようにする。 */
type RiskRule = { code: string; points: number; label: string; test: (text: string) => boolean };

const RISK_RULES: RiskRule[] = [
  {
    code: 'UNLIMITED_REVISION',
    points: 25,
    label: '修正の回数に上限が書かれていない（何度でも直す前提になりやすい）',
    test: (t) => /修正(は)?(無制限|何度でも)|何度でも修正|納得(いく|のいく)まで|ご満足いただけるまで/.test(t),
  },
  {
    code: 'SUBJECTIVE',
    points: 20,
    label: '好みで良し悪しが決まる作業（デザイン・イラスト・世界観）が含まれる',
    test: (t) => /デザイン|イラスト|world|世界観|おしゃれ|かわいい|かっこい|センス|雰囲気/.test(t),
  },
  {
    code: 'VAGUE',
    points: 20,
    label: 'できあがりの形が決まっていない（お任せ・イメージ・よしなに）',
    test: (t) => /お任せ|おまかせ|よしなに|いい感じ|イメージに近い|ご提案(ください|いただ)|自由に/.test(t),
  },
  {
    code: 'MANY_STAKEHOLDERS',
    points: 15,
    label: '確認する人が複数いる（社内確認・上長承認）',
    test: (t) => /社内(で)?(確認|共有)|上長|決裁|関係各所|複数(名|人)で(確認|チェック)/.test(t),
  },
  {
    code: 'STRICT_CHECK',
    points: 10,
    label: '細かい検収がある（レギュレーション・トンマナ・チェック項目）',
    test: (t) => /レギュレーション|トンマナ|表記ゆれ|チェック(項目|リスト)|校正|検収/.test(t),
  },
];

export type RevisionRisk = { score: number; reasons: string[] };

/**
 * 手直しの起きやすさ（0〜100。高いほど手直しが増える）。
 *
 * 文面の手がかりに加えて、
 *  ・依頼文が短い＝要件が固まっていない
 *  ・使う道具が試作しかない＝作り直しが起きやすい
 *  ・予算が書いていない＝あとで金額と量の話が動く
 * を足す。
 */
export function revisionRisk(job: Row, analysis: JobAnalysis): RevisionRisk {
  const text = [job.title, job.description, job.category].filter(Boolean).map(String).join('\n');
  let score = 0;
  const reasons: string[] = [];

  for (const r of RISK_RULES) {
    if (r.test(text)) {
      score += r.points;
      reasons.push(r.label);
    }
  }

  const desc = String(job.description ?? '').replace(/\s+/g, '');
  if (desc.length < 120) {
    score += 20;
    reasons.push(`依頼文が${desc.length}文字と短く、要件が固まっていない`);
  }

  const proven = analysis.matchedCaps.filter((m) => m.readiness === 'PRODUCTION_READY' || m.readiness === 'USABLE_WITH_REVIEW');
  if (analysis.matchedCaps.length > 0 && proven.length === 0) {
    score += 30;
    reasons.push('当たったのが試作段階の仕組みだけで、作り直しが起きやすい');
  } else if (proven.every((m) => m.readiness === 'USABLE_WITH_REVIEW') && proven.length > 0) {
    score += 10;
    reasons.push('人の確認を必ず入れる作業なので、直しが一往復は入る');
  }

  const noBudget =
    (job.budget_min === null || job.budget_min === undefined) && (job.budget_max === null || job.budget_max === undefined);
  if (noBudget) {
    score += 15;
    reasons.push('予算が書かれておらず、あとから量と金額の話が動く');
  }

  if (reasons.length === 0) reasons.push('手直しが増えそうな手がかりは見つからなかった');
  return { score: Math.min(100, score), reasons };
}

/* ────────────────────────────────────────────────────────────────
 * CLIENT_RISK（依頼主の危なさ）
 *
 * ★手直しの起きやすさ（REVISION_RISK）とは別物。混ぜない。
 *   REVISION_RISK …「作ったあと何度も直しになる」＝ 時間が増える危険。
 *   CLIENT_RISK   …「お金が払われない・条件が後出しになる」＝ 取引そのものの危険。
 *   同じ欄に入れると、「手直しは少ないが払ってもらえない案件」が上位に来る。
 *
 * ★ここで見るのは、案件の文面に実際に書いてあることだけ。
 *   依頼主の評価（星いくつ・過去の発注件数）は案件ページを見ないと分からないので、
 *   分からないものは「不明」と書き、良い方にも悪い方にも決めつけない。
 * ──────────────────────────────────────────────────────────────── */

const CLIENT_RISK_RULES: RiskRule[] = [
  {
    code: 'OFFSITE_CONTACT',
    points: 35,
    label: 'サイトの外でのやり取りに誘っている（払われなかったときに間へ入ってもらえない）',
    // ★「LINE公式アカウントを作ってほしい」という案件と取り違えないこと。
    //   道具の名前として出てくるのではなく、「その道具でやり取りする」と書いてあるときだけ拾う。
    test: (t) =>
      /(?:LINE|ライン|Skype|スカイプ|Discord|Telegram|テレグラム|チャットワーク|Chatwork)[^\n]{0,8}(?:で|にて)[^\n]{0,10}(?:やり取り|連絡|ご連絡|打ち合わせ|相談|進め)/.test(t) ||
      /(?:サイト|システム|プラットフォーム)外[^\n]{0,10}(?:取引|やり取り|連絡)/.test(t) ||
      /直接(?:の)?(?:取引|やり取り|お取引)/.test(t),
  },
  {
    code: 'UNPAID_TEST',
    points: 30,
    label: '報酬の出ないテスト・サンプル提出を求めている（ただ働きになる）',
    test: (t) =>
      /(?:無償|無料)[^\n]{0,6}(?:テスト|トライアル|課題|サンプル|お試し)/.test(t) ||
      /テスト(?:ライティング|記事|案件)[^\n]{0,10}(?:無償|無料|報酬(?:は)?(?:なし|ありません))/.test(t),
  },
  {
    code: 'NO_ESCROW',
    points: 30,
    label: '仮払いを使わない・直接支払いにすると書かれている（払われない事故が起きても戻せない）',
    test: (t) => /仮払い[^\n]{0,8}(?:なし|無し|不要|しません|行いません)/.test(t) || /(?:銀行振込|現金)[^\n]{0,6}直接[^\n]{0,6}(?:支払|お支払)/.test(t),
  },
  {
    code: 'HIDDEN_SCOPE',
    points: 20,
    label: '契約したあとでないと中身を教えないと書かれている（受けてから作業量が分かる）',
    test: (t) => /(?:契約(?:後|してから)|受注後|応募(?:後|いただいた方)|お申し込み後)[^\n]{0,24}(?:詳細|内容|仕様|お伝え|ご案内|共有)/.test(t),
  },
  {
    code: 'RIGHTS_TRANSFER',
    points: 20,
    label: '著作権をすべて渡す条件が書かれている（あとから二次利用の報酬を取れない）',
    test: (t) => /著作(?:権|者人格権)[^\n]{0,20}(?:譲渡|放棄|帰属|移転)/.test(t) || /(?:全て|すべて)の権利[^\n]{0,10}譲渡/.test(t),
  },
  {
    code: 'CONTINUOUS_DISCOUNT',
    points: 15,
    label: '「継続するから初回は安く」と単価を下げる話が書かれている（安いまま続くことが多い）',
    test: (t) =>
      /継続[^\n]{0,10}前提[^\n]{0,20}(?:単価|安く|お安く|低め|抑え)/.test(t) ||
      /初回[^\n]{0,8}(?:お試し価格|お安く|安く|低単価)/.test(t) ||
      /(?:軌道に乗|慣れて|実績がつ)[^\n]{0,8}(?:たら|れば)[^\n]{0,12}(?:単価|報酬)[^\n]{0,8}(?:上げ|アップ)/.test(t),
  },
  {
    code: 'RUSH_DECISION',
    points: 15,
    label: 'すぐ決めるよう急かしている（条件を確かめる時間が取りにくい）',
    test: (t) => /先着|即決|早い者勝ち|本日中に[^\n]{0,8}(?:返信|ご連絡)|今すぐ[^\n]{0,8}(?:応募|ご連絡)/.test(t),
  },
];

export type ClientRisk = { score: number; reasons: string[] };

/**
 * 依頼主の危なさ（0〜100。高いほど危ない）。
 *
 * ★案件ページのURLが無いものは、依頼主の評価を見に行けない。
 *   「危なくない」ではなく「確かめられない」ので、その分だけ足す。
 */
export function clientRisk(job: Row): ClientRisk {
  const text = [job.title, job.description].filter(Boolean).map(String).join('\n');
  let score = 0;
  const reasons: string[] = [];

  for (const r of CLIENT_RISK_RULES) {
    if (r.test(text)) {
      score += r.points;
      reasons.push(r.label);
    }
  }

  if (!job.url) {
    score += 15;
    reasons.push('案件ページのURLが無く、依頼主の評価や過去の発注を確かめに行けない');
  }

  if (reasons.length === 0) {
    reasons.push('文面には危ない条件は書かれていなかった（依頼主の評価そのものは案件ページを見ないと不明）');
  }
  return { score: Math.min(100, score), reasons };
}

/* ────────────────────────────────────────────────────────────────
 * CAPABILITY_READINESS（自社の道具の仕上がり具合）
 *
 * ★「完成済み」「レビュー付きで使える」「試作」を1つの数字に潰さない。
 *   潰すと、試作しか無い案件に「実際に運用しています」と書いて応募することになる。
 *   一番上の段階と、段階ごとの内訳の両方を持ち、応募文に名前を出してよいのは
 *   完成済み・レビュー付きの道具だけにする。
 * ──────────────────────────────────────────────────────────────── */

export type CapabilityReadiness = {
  /** 当たった道具のうち、いちばん仕上がっている段階。1つも当たらなければ NONE。 */
  level: Readiness | 'NONE';
  levelLabel: string;
  /** 段階ごとの本数。ここを足し合わせない。 */
  counts: { PRODUCTION_READY: number; USABLE_WITH_REVIEW: number; PROTOTYPE: number };
  /** 応募文に実績として名前を出してよい道具（完成済み＋レビュー付き）。 */
  provenNames: string[];
  /** 実績としては書けない道具。名前を出すなら「試作」と断る。 */
  prototypeNames: string[];
  /** 0〜100。段階だけで決める（本数で水増ししない）。 */
  score: number;
  /** 人が読んで確かめられる内訳の文章。 */
  detail: string;
};

const READINESS_POINTS: Record<'PRODUCTION_READY' | 'USABLE_WITH_REVIEW' | 'PROTOTYPE', number> = {
  PRODUCTION_READY: 100,
  USABLE_WITH_REVIEW: 70,
  PROTOTYPE: 30,
};

export function capabilityReadiness(analysis: JobAnalysis): CapabilityReadiness {
  const counts = { PRODUCTION_READY: 0, USABLE_WITH_REVIEW: 0, PROTOTYPE: 0 };
  const provenNames: string[] = [];
  const prototypeNames: string[] = [];

  for (const m of analysis.matchedCaps) {
    if (m.readiness === 'PRODUCTION_READY' || m.readiness === 'USABLE_WITH_REVIEW') {
      counts[m.readiness] += 1;
      provenNames.push(m.name);
    } else if (m.readiness === 'PROTOTYPE') {
      counts.PROTOTYPE += 1;
      prototypeNames.push(m.name);
    }
    // NOT_SELLABLE は matchedCaps に入ってこない（売り物にしない側へ分けてある）。
  }

  const level: CapabilityReadiness['level'] =
    counts.PRODUCTION_READY > 0 ? 'PRODUCTION_READY' : counts.USABLE_WITH_REVIEW > 0 ? 'USABLE_WITH_REVIEW' : counts.PROTOTYPE > 0 ? 'PROTOTYPE' : 'NONE';

  const score = level === 'NONE' ? 0 : READINESS_POINTS[level];
  const levelLabel = level === 'NONE' ? '当たる道具が無い' : READINESS_LABEL[level];

  const parts = [
    `本番で動いている ${counts.PRODUCTION_READY}件`,
    `人の確認を入れて使える ${counts.USABLE_WITH_REVIEW}件`,
    `試作 ${counts.PROTOTYPE}件`,
  ];
  if (provenNames.length > 0) parts.push(`実績として書ける道具＝${provenNames.join('・')}`);
  if (prototypeNames.length > 0) parts.push(`試作なので実績としては書けない道具＝${prototypeNames.join('・')}`);

  return { level, levelLabel, counts, provenNames, prototypeNames, score, detail: parts.join(' ／ ') };
}

export type Opportunity = {
  score: number;
  reason: string;
  /** 見積りの確からしさ。時給が現実離れしているときに HIGH にしない。 */
  estimateConfidence: 'NORMAL' | 'LOW';
};

/**
 * 時給は目標の何倍まで順位付けに使うか。ここを超えた分は順位に効かせない。
 * 「時給が高い順」だけで並べると、見積りを短く読み違えた案件がいつも一番上に来てしまうため。
 */
export const HOURLY_CAP_MULTIPLIER = 2;

/**
 * ここを超えたら「見積りが短すぎるかもしれない」と印を付ける線。
 * 目標の5倍（＝1時間あたりの利益が目標の5倍）は、打ち合わせや手直しを入れれば
 * まず残らない数字なので、そのまま信じない。
 */
export const HOURLY_SUSPECT_MULTIPLIER = 5;

/** 1件で残る利益の「これ以上は同じ扱い」の線。小口ばかり取りに行かないための項。 */
const PROFIT_FULL = 50000;

export function computeOpportunity(args: {
  expectedProfit: number | null;
  expectedHours: number | null;
  expectedHourlyProfit: number | null;
  winProbability: number;
  automationRate: number;
  revisionRisk: number;
  /** 依頼主の危なさ（0〜100）。手直しの起きやすさとは別に引き算する。 */
  clientRisk: number;
  targetHourly: number;
}): Opportunity {
  const {
    expectedProfit,
    expectedHourlyProfit,
    winProbability,
    automationRate,
    revisionRisk: risk,
    clientRisk: cRisk,
    targetHourly,
  } = args;
  const parts: string[] = [];

  // 金額が出せない案件は、順位付けの土俵に乗せない（想像で埋めない）。
  if (expectedHourlyProfit === null || expectedProfit === null) {
    return {
      score: 0,
      reason: '予算か作業時間が読み取れないので、取りに行く順番を決められない。金額を確認してから人が決める。',
      estimateConfidence: 'LOW',
    };
  }

  const capped = targetHourly * HOURLY_CAP_MULTIPLIER;
  const usedHourly = Math.min(expectedHourlyProfit, capped);
  if (expectedHourlyProfit > capped) {
    parts.push(`順位付けでは時給を${capped.toLocaleString()}円で頭打ちにしている（時給の高さだけで順番を決めないため）`);
  }

  // 「見積りが短すぎるかもしれない」印。順位を下げるのではなく、人に見てもらうための印。
  const suspect = targetHourly * HOURLY_SUSPECT_MULTIPLIER;
  const estimateConfidence: Opportunity['estimateConfidence'] = expectedHourlyProfit > suspect ? 'LOW' : 'NORMAL';
  if (estimateConfidence === 'LOW') {
    parts.push(
      `時給${expectedHourlyProfit.toLocaleString()}円は目標の${HOURLY_SUSPECT_MULTIPLIER}倍を超えている。作業時間を短く読み違えている可能性があるので、応募前に見積りを確かめること`,
    );
  }

  const hourlyFactor = Math.max(0, Math.min(1, usedHourly / capped));
  const winFactor = Math.max(0, Math.min(1, winProbability));
  const autoFactor = Math.max(0, Math.min(1, automationRate));
  const riskFactor = Math.max(0, Math.min(1, 1 - risk / 100));
  const clientFactor = Math.max(0, Math.min(1, 1 - cRisk / 100));
  const sizeFactor = Math.max(0, Math.min(1, expectedProfit / PROFIT_FULL));

  // ★合計は必ず1.0。手直しの危なさ（riskFactor）と依頼主の危なさ（clientFactor）は
  //   別の項として持つ。片方が良くてももう片方が悪ければ順位は上がらない。
  const score = Number(
    (
      100 *
      (0.35 * hourlyFactor + 0.18 * winFactor + 0.12 * autoFactor + 0.15 * riskFactor + 0.1 * clientFactor + 0.1 * sizeFactor)
    ).toFixed(1),
  );

  parts.unshift(
    `時間あたり${expectedHourlyProfit.toLocaleString()}円（目標${targetHourly.toLocaleString()}円）`,
    `取れる見込み${Math.round(winFactor * 100)}%`,
    `AIの肩代わり${Math.round(autoFactor * 100)}%`,
    `手直しの起きやすさ${risk}`,
    `依頼主の危なさ${cRisk}`,
    `1件で残る見込み${expectedProfit.toLocaleString()}円`,
  );

  return { score, reason: parts.join(' ／ '), estimateConfidence };
}
