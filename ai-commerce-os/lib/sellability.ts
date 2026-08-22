/**
 * 【売れるかテスト】（Phase 3.9d・2026-08-22）
 *
 * ★このファイルは他のファイルを一切 import しない（CLAUDE.md ルール37）。
 *   画面（'use client'）から読んでもビルドが落ちないようにするため。
 *
 * ------------------------------------------------------------------
 * 【なぜ作るのか】
 *
 * これまでの「実市場での答え合わせ」は、1件の出品を7日・30日・90日と見張って
 * 「本当に売れたか」を確かめる仕組みだった。正確だが、**答えが出るまで3ヶ月かかる**。
 *
 * 知りたいのは先に1つだけ。「この商品は、そもそも売れているのか」。
 * 過去の販売履歴を見れば、待たずに分かる。それを人が Keepa の画面で見て、
 * 数字をこのシステムに書き写す。それが「売れるかテスト」である。
 *
 * ------------------------------------------------------------------
 * 【このファイルがやらないこと】
 *
 *  1. どこかへ通信しない。Keepa へも Amazon へもアクセスしない。
 *     入るのは「人が画面を見て書き写した数字」だけ（HUMAN_ENTRY）。
 *  2. URLを作らない（ルール55）。商品ページURLは人が貼ったものだけを扱う。
 *  3. 空欄を推測で埋めない。分からない項目があれば、判定は「判断できない」になる。
 *  4. 判定を甘くして候補を増やさない。下の閾値は定数で持ち、根拠をここに書く。
 *
 * ------------------------------------------------------------------
 * 【いちばん大事な但し書き】
 *
 * Keepa の「売れ筋順位の下落回数（Sales Rank drops）」は、
 * **販売数そのものではない**。
 *
 *   ・1回の注文で2個売れても、下落は1回しか起きないことがある
 *   ・下落が起きない販売もある
 *   ・逆に、販売以外の理由で順位が動くこともある
 *
 * だからこのファイルは、下落回数から出した数字を必ず「推定」と呼ぶ。
 * 画面にも「推定」と出す。確定した販売数として扱った瞬間に、
 * 「正確性 > 安全性 > 利益」という順番が崩れる。
 */

/* ================================================================
 * 判定の答え（4つ）
 * ================================================================ */

/**
 * 【なぜ「売れる／売れない」の2択にしないのか】
 *
 * 商品が売れていることと、**その売上が自分に回ってくること**は別の話である。
 * 月に30個売れていても、出品者が60人いれば自分の番はなかなか来ない。
 * これを「売れる」に入れると、回転しない在庫を掴む。
 * 逆に「売れない」に入れると、値付け次第で勝てる商品を捨てる。
 * だから3つ目に「売れてはいるが、ライバルが多い」を置く。
 */
export const SELLABILITY_VERDICTS = [
  'SELLS',
  'CROWDED',
  'DOES_NOT_SELL',
  'UNKNOWN',
] as const;

export type SellabilityVerdict = (typeof SELLABILITY_VERDICTS)[number];

export const SELLABILITY_VERDICT_JA: Record<SellabilityVerdict, string> = {
  SELLS: '売れている（自分にも回ってきそう）',
  CROWDED: '売れてはいるが、ライバルが多く自分に回りにくい',
  DOES_NOT_SELL: '売れていない',
  UNKNOWN: '判断できない（材料が足りない）',
};

/** 画面の色分け。判定と色を1か所で決めて、画面ごとにブレさせない。 */
export const SELLABILITY_VERDICT_TONE: Record<SellabilityVerdict, 'ok' | 'warn' | 'danger' | 'muted'> = {
  SELLS: 'ok',
  CROWDED: 'warn',
  DOES_NOT_SELL: 'danger',
  UNKNOWN: 'muted',
};

/* ================================================================
 * どこで見た数字か
 * ================================================================ */

/**
 * 【出どころを分けて持つ理由】
 *
 * Keepa は Amazon ではない。**Amazon の外にある第三者のツール**である。
 * 「Amazon が提供したデータ」と同じ箱に入れると、
 * 出どころの信頼度も、規約上の扱いも、まとめて見えなくなる。
 *
 * だからここでは市場（Amazon）と道具（Keepa）を別々に持つ。
 */
export const SELLABILITY_SOURCE_TOOLS = [
  'KEEPA',
  'VENUE_PAGE',
  'OTHER_TOOL',
] as const;

export type SellabilitySourceTool = (typeof SELLABILITY_SOURCE_TOOLS)[number];

export const SELLABILITY_SOURCE_TOOL_JA: Record<SellabilitySourceTool, string> = {
  KEEPA: 'Keepa（第三者ツール。人が画面を見て記入）',
  VENUE_PAGE: '市場の公開ページ（人が画面を見て記入）',
  OTHER_TOOL: 'その他のツール（人が画面を見て記入）',
};

/**
 * 第三者ツールで見た数字に必ず付ける注意書き。
 *
 * ここを黙らせない。「Keepa で見たから正しい」と読ませないための一文である。
 */
export const THIRD_PARTY_TOOL_CAUTION =
  'これは第三者ツールの画面を人が見て書き写した数字です。市場（Amazon等）から正式に提供されたデータではありません。'
  + 'ツール側の推定が含まれるため、実際の販売数と一致するとは限りません。'
  + 'また、ツールの利用規約でこの使い方が認められているかは、ご本人の確認が必要です。';

/* ================================================================
 * 閾値（勝手に緩めない）
 * ================================================================ */

/**
 * 【この数字を下げれば候補は増える。だから下げない】
 *
 * ユーザー指示：「商品数を増やすためにAI判定を甘くしてはいけません」
 * 変えるときは、変えた理由と、変えた人と、変えた日をここに書き残すこと。
 * 黙って書き換えたら、あとから成績を見ても原因が分からなくなる。
 */
export const SELLABILITY_THRESHOLDS = {
  /** 対象にできる観測期間。これ以外は判断できないとする。 */
  ALLOWED_WINDOW_DAYS: [30, 90, 180] as number[],

  /**
   * 期間中の下落回数がこれ未満なら「少なすぎて判断できない」。
   * 1〜2回はたまたま起こり得る。たまたまで仕入を決めない。
   * （SHADOW学習で「5件未満ではスコアを動かさない」としたのと同じ考え方）
   */
  MIN_RANK_DROPS: 3,

  /**
   * 観測日がこれより古い数字では判定しない。
   * 相場も出品者数も動く。古い数字で「売れる」と言わない。
   */
  STALE_DAYS: 30,

  /**
   * 自分が1人加わったとして、1ヶ月に何回自分の番が来そうか。
   * 1.0 未満＝月に1回も回ってこない見込み → CROWDED。
   */
  MIN_PER_SELLER_MONTHLY: 1.0,

  /**
   * 現在価格が期間平均のこの倍を超えていたら注意を出す（判定は変えない）。
   * 「売れている」のは平均価格での話で、いまの高い値段で売れる話ではない。
   */
  PRICE_WARN_RATIO: 1.2,
} as const;

/* ================================================================
 * 入力と出力
 * ================================================================ */

export type SellabilityInput = {
  /** いつ画面を見たか（ISO文字列）。必須。 */
  observedAt: string | null | undefined;
  /** 何日間の数字か。30 / 90 / 180 のいずれか。必須。 */
  windowDays: number | null | undefined;
  /** 期間中に売れ筋順位が下がった回数。必須。※販売数そのものではない。 */
  rankDrops: number | null | undefined;
  /** いまの売れ筋順位。任意（あると参考情報が増える）。 */
  salesRank?: number | null;
  /** いまのライバル出品者数。必須。分からないなら判断しない。 */
  offerCount: number | null | undefined;
  /** 期間の平均価格（円）。任意。 */
  avgPrice?: number | null;
  /** いまの価格（円）。任意。 */
  currentPrice?: number | null;
  /** 判定の基準時刻。テスト用。 */
  now?: number;
};

export type SellabilityResult = {
  verdict: SellabilityVerdict;
  /** なぜその判定になったか。画面にそのまま日本語で出す。 */
  reason: string;
  /** 推定の月間販売数。分からなければ null。0 と null を混ぜない。 */
  estimatedMonthlySales: number | null;
  /** 自分が1人加わったときに、月に何回自分の番が来そうか。 */
  perSellerMonthly: number | null;
  /** 自分の1個が売れるまで何日かかりそうか（推定）。 */
  estimatedTurnoverDays: number | null;
  /** 止めるほどではないが、必ず見せる注意。黙って飲み込まない。 */
  warnings: string[];
  /** 判定に使えなかった項目（空欄・値がおかしい）。 */
  missing: string[];
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 売れるかを判定する。
 *
 * 【Fail Closed】
 * 迷ったら SELLS を返さない。materialが足りなければ UNKNOWN。
 * 「たぶん売れる」は売れるではない。
 */
export function judgeSellability(i: SellabilityInput): SellabilityResult {
  const warnings: string[] = [];
  const missing: string[] = [];

  const out = (
    verdict: SellabilityVerdict,
    reason: string,
    extra?: Partial<SellabilityResult>,
  ): SellabilityResult => ({
    verdict,
    reason,
    estimatedMonthlySales: null,
    perSellerMonthly: null,
    estimatedTurnoverDays: null,
    warnings,
    missing,
    ...extra,
  });

  // ---- 1. いつ見た数字か ----------------------------------------
  const t = i.observedAt ? Date.parse(i.observedAt) : NaN;
  if (!i.observedAt) missing.push('観測日（いつ画面を見たか）');
  else if (!Number.isFinite(t)) missing.push('観測日（日付として読み取れない）');

  const now = i.now ?? Date.now();
  if (Number.isFinite(t)) {
    // 未来の日付は入力ミス。実データとして扱うと前後関係が壊れる。
    if (t > now + 86400000) {
      return out('UNKNOWN', '観測日が未来になっています。入力を確かめてください。');
    }
    const ageDays = (now - t) / 86400000;
    if (ageDays > SELLABILITY_THRESHOLDS.STALE_DAYS) {
      return out(
        'UNKNOWN',
        `観測から${Math.floor(ageDays)}日たっています（${SELLABILITY_THRESHOLDS.STALE_DAYS}日を超えた数字では判定しません）。もう一度見て入れ直してください。`,
      );
    }
  }

  // ---- 2. 何日間の数字か ----------------------------------------
  const win = num(i.windowDays);
  if (win === null) missing.push('期間（何日間の数字か）');
  else if (!SELLABILITY_THRESHOLDS.ALLOWED_WINDOW_DAYS.includes(win)) {
    return out('UNKNOWN', `期間は ${SELLABILITY_THRESHOLDS.ALLOWED_WINDOW_DAYS.join(' / ')} 日のいずれかで入れてください。`);
  }

  // ---- 3. 下落回数 ----------------------------------------------
  const drops = num(i.rankDrops);
  if (drops === null) missing.push('期間中に売れ筋順位が下がった回数');
  else if (drops < 0) return out('UNKNOWN', '下落回数がマイナスになっています。入力を確かめてください。');

  // ---- 4. ライバル出品者数 --------------------------------------
  const offers = num(i.offerCount);
  if (offers === null) missing.push('いまのライバル出品者数');
  else if (offers < 0) return out('UNKNOWN', '出品者数がマイナスになっています。入力を確かめてください。');

  if (missing.length > 0) {
    return out('UNKNOWN', `次の項目が入っていないため判断できません：${missing.join(' / ')}`);
  }

  // ここから先は win / drops / offers が確実に数値。
  const windowDays = win as number;
  const rankDrops = drops as number;
  const offerCount = offers as number;

  // ---- 5. 参考になる値の計算（すべて推定） ----------------------
  const estimatedMonthlySales = (rankDrops / windowDays) * 30;
  // 自分が1人加わる前提で割る。ライバル数だけで割ると自分の取り分を多く見積もる。
  const perSellerMonthly = estimatedMonthlySales / (offerCount + 1);
  const estimatedTurnoverDays = perSellerMonthly > 0 ? 30 / perSellerMonthly : null;

  const nums = { estimatedMonthlySales, perSellerMonthly, estimatedTurnoverDays };

  // ---- 6. 価格の注意（判定は変えない） --------------------------
  const avg = num(i.avgPrice);
  const cur = num(i.currentPrice);
  if (avg !== null && cur !== null && avg > 0) {
    if (cur > avg * SELLABILITY_THRESHOLDS.PRICE_WARN_RATIO) {
      warnings.push(
        `いまの価格（${Math.round(cur).toLocaleString()}円）は期間平均（${Math.round(avg).toLocaleString()}円）より高い状態です。`
        + '「売れている」のは平均価格での話で、いまの値段で売れるという意味ではありません。',
      );
    }
  } else {
    warnings.push('平均価格または現在価格が空欄です。いくらで売れているかは判定に入っていません。');
  }
  if (num(i.salesRank) === null) {
    warnings.push('売れ筋順位が空欄です。判定はできますが、あとで見返すときの手がかりが減ります。');
  }

  // ---- 7. 判定 --------------------------------------------------
  if (rankDrops === 0) {
    return out(
      'DOES_NOT_SELL',
      `${windowDays}日間で売れ筋順位が1回も下がっていません。この期間、動いた形跡がありません。`,
      nums,
    );
  }

  if (rankDrops < SELLABILITY_THRESHOLDS.MIN_RANK_DROPS) {
    return out(
      'UNKNOWN',
      `${windowDays}日間で${rankDrops}回しか動いていません（${SELLABILITY_THRESHOLDS.MIN_RANK_DROPS}回未満は、たまたまと区別がつかないので判定しません）。`,
      nums,
    );
  }

  if (perSellerMonthly < SELLABILITY_THRESHOLDS.MIN_PER_SELLER_MONTHLY) {
    return out(
      'CROWDED',
      `月におよそ${estimatedMonthlySales.toFixed(1)}個売れている見込みですが、ライバルが${offerCount}人います。`
      + `自分が加わると月${perSellerMonthly.toFixed(2)}個ペース＝1個売れるのにおよそ${Math.round(estimatedTurnoverDays ?? 0)}日かかる計算です。`,
      nums,
    );
  }

  return out(
    'SELLS',
    `月におよそ${estimatedMonthlySales.toFixed(1)}個売れている見込みで、ライバルは${offerCount}人。`
    + `自分が加わっても月${perSellerMonthly.toFixed(2)}個ペース＝1個売れるのにおよそ${Math.round(estimatedTurnoverDays ?? 0)}日の計算です。`,
    nums,
  );
}

/**
 * 「この判定だけで買ってよいか」への答え。
 *
 * 【売れる＝買ってよい ではない】
 * 売れるかどうかは、仕入判断の材料の**ひとつ**でしかない。
 * 利益が出るか・手数料がいくらか・状態が合っているかは、まったく別の判定である。
 * ここで「買ってよい」と言い切ると、そちらの判定を飛ばして買うことになる。
 */
export const SELLABILITY_SCOPE_NOTE =
  'これは「売れているかどうか」だけの判定です。買ってよいかどうかの判定ではありません。'
  + '利益が出るか・手数料がいくらか・商品の状態が合っているかは、別の画面の判定を必ず見てください。';
