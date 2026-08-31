/**
 * 「その商品はいくらで売るのか」を1か所で決める。
 *
 * ★このファイルが存在する理由。
 *   今すぐ売れる商品（SELLABLE）の値段が、どれも決まっていない。
 *   値段が決まっていないと、予想売上も予想利益も出せない。
 *   ここで仮の数字を入れれば表は埋まるが、その仮の数字で会社の並び順が変わり、
 *   本当は利益にならない会社へ営業しに行くことになる。
 *
 * ★だからこのファイルは値段を作らない。
 *   ・カタログに確認済みの値段があれば、それを使う
 *   ・人が設定画面で値段を入れていれば、それを使う
 *   ・どちらも無ければ null を返し、「値段が未設定なので計算できない」と言う
 *   AIが値段を推測して埋めることは、ここでは一度もしない。
 */
import type { OfferRow } from './sync';
import { OFFERS, type PriceStatus } from './definitions';
import { costSettingKeys, numOrNull, priceSettingKeys } from '../settings';

export type PriceSource = 'CATALOG' | 'SETTINGS' | 'UNSET';

export type ResolvedPrice = {
  offerCode: string;
  offerName: string;
  priceModel: string;
  priceMin: number | null;
  priceMax: number | null;
  marginRate: number | null;
  source: PriceSource;
  /**
   * その金額がどこまで決まっているか。
   * CONFIRMED   … 人が設定画面で決めた／公開済みの料金
   * PROVISIONAL … 案としてどこかに書いてあるだけ。計算には使うが必ず「仮」と出す
   * UNKNOWN     … 金額が無い。計算しない
   */
  priceStatus: PriceStatus;
  /** その金額の出どころ。無いときは null。推測の出どころは書かない。 */
  priceEvidence: string | null;
  /** 人が入れた原価（円）。入れるまで null。0で埋めない。 */
  costDirect: number | null;
  /** 人が入れた想定作業時間（時間）。入れるまで null。 */
  estHours: number | null;
  /** 値段が出せないときの、人がそのまま読める理由。出せるときは空文字。 */
  unsetReasonJa: string;
};

type PriceInput = {
  code: string;
  name: string;
  price_model: string | null;
  price_min: number | null;
  price_max: number | null;
  gross_margin_rate: number | null;
  /** カタログ側の値段の状態。渡されないときは、金額があれば PROVISIONAL 扱い（確定とは言い切らない）。 */
  price_status?: PriceStatus | string | null;
  price_evidence?: string | null;
};

/**
 * その商品の値段を解決する。
 *
 * ★順番は「人が設定画面で入れた金額」→「カタログの金額」→「未設定」。
 *   カタログは Obsidian の写しで、同期のたびに上書きされる。
 *   人が自分で決めた金額を写しに負けさせると、直したはずの金額が同期1回で戻る。
 *   だから人の入力を先に見る。
 */
export async function resolveOfferPrice(offer: PriceInput): Promise<ResolvedPrice> {
  const k = priceSettingKeys(offer.code);
  const ck = costSettingKeys(offer.code);
  const costDirect = await numOrNull(ck.direct);
  const estHours = await numOrNull(ck.hours);

  const base = {
    offerCode: offer.code,
    offerName: offer.name,
    priceModel: String(offer.price_model ?? 'unknown'),
    costDirect,
    estHours,
  };

  const setMin = await numOrNull(k.min);
  const setMax = await numOrNull(k.max);
  const setMargin = await numOrNull(k.margin);

  if (setMin !== null || setMax !== null) {
    return {
      ...base,
      priceMin: setMin,
      priceMax: setMax,
      marginRate: setMargin ?? offer.gross_margin_rate,
      source: 'SETTINGS',
      // 人が設定画面に自分で入れた金額なので、その人にとっては決まった金額。
      priceStatus: 'CONFIRMED',
      priceEvidence: '設定画面で入力された金額',
      unsetReasonJa: '',
    };
  }

  if (offer.price_min !== null || offer.price_max !== null) {
    const raw = String(offer.price_status ?? '').trim().toUpperCase();
    // ★状態が付いていない古い行は PROVISIONAL（仮）にする。UNKNOWN でも CONFIRMED でもない。
    //   金額はあるのだから未定ではないし、確定とも言い切れないから。
    const st: PriceStatus = raw === 'CONFIRMED' ? 'CONFIRMED' : raw === 'UNKNOWN' ? 'UNKNOWN' : 'PROVISIONAL';
    return {
      ...base,
      priceMin: offer.price_min,
      priceMax: offer.price_max,
      marginRate: setMargin ?? offer.gross_margin_rate,
      source: 'CATALOG',
      priceStatus: st,
      priceEvidence: offer.price_evidence ? String(offer.price_evidence) : null,
      unsetReasonJa: '',
    };
  }

  return {
    ...base,
    priceMin: null,
    priceMax: null,
    marginRate: setMargin ?? offer.gross_margin_rate,
    source: 'UNSET',
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    unsetReasonJa: `「${offer.name}」の値段がまだ決まっていない（設定画面の「${k.min}」が空欄）。`,
  };
}

/** その金額を画面に出すときに必ず添える一言。確定なら空文字。 */
export function priceCaveatJa(p: ResolvedPrice): string {
  if (p.priceStatus === 'PROVISIONAL') return '※仮の金額（本人が最終決定していません）';
  if (p.priceStatus === 'UNKNOWN') return '※金額は未設定';
  return '';
}

/**
 * 契約1本あたりの想定売上（1年分）。
 * 月額は12ヶ月分、単発はそのまま。値段が未設定なら null。
 * ★高い方に寄せない。安い方と真ん中の間を取る（強気に見積もらない）。
 */
export function contractValueOf(p: ResolvedPrice): number | null {
  if (p.priceMin === null && p.priceMax === null) return null;
  const lo = p.priceMin ?? p.priceMax ?? 0;
  const hi = p.priceMax ?? p.priceMin ?? 0;
  const mid = Math.round(lo + (hi - lo) * 0.35);
  return p.priceModel === 'monthly' ? mid * 12 : mid;
}

/**
 * 契約1本あたりの想定利益。
 *
 * ★「手元に残る割合」も「原価」も未設定なら、売上から利益を勝手に決めない（null を返す）。
 *   ここを0で埋めると「原価0円＝売上まるごと利益」という、いちばん都合の良い嘘が出る。
 *
 * ★原価が入っていれば原価を優先する。割合より実額のほうが確かだから。
 */
export function grossProfitOf(p: ResolvedPrice): number | null {
  const rev = contractValueOf(p);
  if (rev === null) return null;
  if (p.costDirect !== null && Number.isFinite(p.costDirect)) return Math.round(rev - p.costDirect);
  if (p.marginRate === null || !Number.isFinite(p.marginRate)) return null;
  return Math.round(rev * p.marginRate);
}

/** 想定利益を出せない理由。出せるときは空文字。 */
export function profitUnsetReasonJa(p: ResolvedPrice): string {
  if (contractValueOf(p) === null) return '金額が未設定なので、利益は計算できない。';
  if (p.costDirect !== null || p.marginRate !== null) return '';
  return '原価も「手元に残る割合」も未設定なので、利益は計算できない（0円として扱わない）。';
}

/** 想定時給。作業時間が未設定なら null（推測しない）。 */
export function hourlyProfitOf(p: ResolvedPrice): number | null {
  const profit = grossProfitOf(p);
  if (profit === null) return null;
  if (p.estHours === null || !Number.isFinite(p.estHours) || p.estHours <= 0) return null;
  return Math.round(profit / p.estHours);
}

export type PriceTodo = { offerCode: string; offerName: string; status: string; settingKey: string; whyJa: string };

/**
 * 「値段を決めないと先へ進めない商品」の一覧。
 * ★人にそのまま見せるためのもの。ここが空になるまで、金額の期待値は出せない。
 */
export async function pricesToDecide(offers: OfferRow[]): Promise<PriceTodo[]> {
  const todo: PriceTodo[] = [];
  for (const o of offers) {
    const p = await resolveOfferPrice(o);
    if (p.source !== 'UNSET') continue;
    const def = OFFERS.find((x) => x.code === o.code);
    todo.push({
      offerCode: o.code,
      offerName: o.name,
      status: o.status,
      settingKey: priceSettingKeys(o.code).min,
      whyJa:
        o.status === 'SELLABLE'
          ? '今すぐ売れる商品なのに値段が無い。これが決まるまで予想売上・予想利益は出せない。'
          : `今は売りに行かない商品（${o.status}${def?.statusReason ? '：' + def.statusReason : ''}）。値段は後で良い。`,
    });
  }
  // 今すぐ売れる商品を先に出す（決めるべき順番がそのまま並ぶ）。
  return todo.sort((a, b) => (a.status === 'SELLABLE' ? 0 : 1) - (b.status === 'SELLABLE' ? 0 : 1));
}
