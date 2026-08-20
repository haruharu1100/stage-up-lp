/**
 * 振込費用（PAYOUT COST）。
 *
 * 【この修正の理由】
 * ユーザー指摘：「メルカリの『振込手数料200円』は、1商品ごとの販売コストではなく、
 * 売上金を銀行へ振り込む"申請1回ごと"の費用です。」
 *
 * それまでこのシステムは、振込手数料200円を fixed_fee（1取引ごとの固定手数料）に入れていた。
 * つまり商品1件ごとに200円を引いていた。
 *
 * これは「安全側に倒しているから良い」ではない。
 *   ・1回の申請で100件分をまとめて振り込めば、1商品あたりの負担は2円
 *   ・200円で計算すると、100倍の費用を見込んでいることになる
 *   ・その結果、本当は利益が出る商品を「利益が小さい」として捨てる
 *
 * 見送るべきものを見送るのが Fail Closed。見送らなくていいものを捨てるのは、ただの計算間違い。
 *
 * 【だから3つに分ける】
 *   1. ACQUISITION COST … 仕入にかかったお金（商品代・仕入側手数料・支払方法の手数料など）
 *   2. TRANSACTION COST … 商品1件を売るたびにかかるお金（販売手数料10%・送料・梱包費）
 *   3. PAYOUT COST      … 売上金を銀行へ移すときのお金（申請1回ごと。商品単位ではない）
 *
 * PAYOUT COST は、1と2のどちらにも入れない。
 * 商品ごとの見え方を出すときは「按分した参考値」として、必ず別の行に出す。
 */

export type PayoutBasis = 'ACTUAL' | 'SETTING' | 'NONE';

export const PAYOUT_BASIS_JA: Record<PayoutBasis, string> = {
  ACTUAL: '実際の振込実績から算出',
  SETTING: '設定値（1回の申請でまとめる件数）から算出',
  NONE: 'この市場に振込費用は登録されていない',
};

export type PayoutFeeInput = {
  payout_fee_fixed?: number | null;
  payout_fee_rate?: number | null;
  payout_note?: string | null;
};

export type PayoutAllocation = {
  /** 振込申請1回あたりの定額（円）。 */
  payoutFeeFixed: number;
  /** 振込額に対する率（今のところ0。将来、率で取る市場のために持っておく）。 */
  payoutFeeRate: number;
  /** 1回の申請で何件分をまとめるか。 */
  itemsPerRequest: number;
  /** 1商品あたりに割り当てた参考額（円）。**判定には使わない。** */
  allocatedPerItem: number;
  basis: PayoutBasis;
  /** 画面にそのまま出す説明。 */
  note: string;
};

/**
 * 振込費用を1商品あたりに按分する（参考表示専用）。
 *
 * 【judgement（買う／買わない）には絶対に使わない】
 * ユーザー指示：「SHADOW段階では EXPECTED_PAYOUT_ALLOCATED_COST として別表示にしてください。
 * 主要な商品判定が200円固定で歪まないようにします。」
 *
 * まとめる件数はこちらの運用次第で、商品の良し悪しとは何の関係も無い。
 * それを判定に混ぜると「今月たくさん売れたから、この商品の点数が上がった」という
 * わけの分からない挙動になる。
 */
export function allocatePayoutCost(
  fee: PayoutFeeInput,
  itemsPerRequest: number,
  basis: PayoutBasis = 'SETTING',
): PayoutAllocation {
  const payoutFeeFixed = Math.max(0, Math.round(Number(fee.payout_fee_fixed ?? 0)));
  const payoutFeeRate = Math.max(0, Number(fee.payout_fee_rate ?? 0));
  // 0件や負の件数で割らない。分からないときは「1回に1件」＝いちばん重い見方に落とす。
  const items = Number.isFinite(itemsPerRequest) && itemsPerRequest >= 1
    ? Math.floor(itemsPerRequest)
    : 1;

  if (payoutFeeFixed === 0 && payoutFeeRate === 0) {
    return {
      payoutFeeFixed: 0, payoutFeeRate: 0, itemsPerRequest: items,
      allocatedPerItem: 0, basis: 'NONE',
      note: fee.payout_note || 'この市場の振込費用は登録されていない（0円として扱っている、という意味ではない）',
    };
  }

  const allocatedPerItem = Math.ceil(payoutFeeFixed / items);
  const note = items === 1
    ? `振込申請1回につき${payoutFeeFixed}円。まだ1回にまとめる件数の実績が無いため、1件ずつ振り込んだ場合（いちばん重い見方）で${allocatedPerItem}円としている。`
    : `振込申請1回につき${payoutFeeFixed}円を、1回あたり${items}件で割った参考値（1商品あたり約${allocatedPerItem}円）。この金額は買う／買わないの判定には入れていない。`;

  return { payoutFeeFixed, payoutFeeRate, itemsPerRequest: items, allocatedPerItem, basis, note };
}

/**
 * 振込費用が1商品ごとの費用に紛れ込んでいないかの検算。
 *
 * 【なぜ関数にするのか】
 * 今回の間違いは「コメントで正しさを説明しながら、コードでは間違ったことをしていた」型。
 * 人の注意力ではなく、テストで止められる形にしておく。
 * 受け入れテストから呼び、200円が販売費用に混ざったら赤くなるようにする。
 */
export function payoutLeakCheck(args: {
  /** 1商品を売るたびにかかる費用の合計（振込費用を含んではいけない）。 */
  transactionCost: number;
  /** 販売価格。 */
  sellPrice: number;
  /** 販売手数料率。 */
  feeRate: number;
  /** 振込申請1回あたりの定額。 */
  payoutFeeFixed: number;
  /** 販売手数料・送料・梱包費など、取引費用として正しく入っているものの合計。 */
  expectedTransactionCost: number;
}): { ok: boolean; message: string } {
  if (args.transactionCost !== args.expectedTransactionCost) {
    return {
      ok: false,
      message: `取引費用が合わない。期待${args.expectedTransactionCost}円 / 実際${args.transactionCost}円。`
        + `差${args.transactionCost - args.expectedTransactionCost}円`
        + (args.transactionCost - args.expectedTransactionCost === args.payoutFeeFixed
          ? '（＝振込手数料が1商品ごとに混ざっている）' : ''),
    };
  }
  return { ok: true, message: '振込費用は1商品ごとの費用に含まれていない' };
}
