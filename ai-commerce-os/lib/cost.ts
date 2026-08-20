import { FEE_FIELD_JA, parseVerifiedFields, type FeeStatus } from './feestatus';

/**
 * 費目ごとの確認状況（COST CONFIDENCE）。
 *
 * 【なぜ手数料の行まるごとでは足りないのか】
 * ユーザー指示：
 *   「Fee Verificationも項目単位にしてください。
 *    SELL_PLATFORM_FEE = VERIFIED / BUY_PAYMENT_FEE = VERIFIED or ESTIMATED /
 *    SHIPPING_COST = ESTIMATED / PACKING_COST = ESTIMATED / PAYOUT_COST = VERIFIED。
 *    Fee Profile全体を一括で VERIFIED にしないでください。」
 *   「一部費用だけ公式確認済みでも、全体を『完全確認済み』と扱わないでください。
 *    COST_CONFIDENCE を100%にしないでください。」
 *
 * メルカリで言えば、同じ1件の取引の中に性質のまったく違う費用が並んでいる。
 *
 *   販売手数料10%   公式ページに書いてある      → 確認できる
 *   振込手数料200円 公式ページに書いてある      → 確認できる（ただし商品ごとではない）
 *   支払方法の手数料 方法と金額で変わる          → 方法ごとに確認が要る
 *   送料           商品の大きさと発送方法で変わる → こちらの見積り。確認しようがない
 *   梱包費         こちらの都合                  → 同上
 *
 * これを1つの「確認済み」で表すと、確認していない送料まで確認済みの顔をする。
 */

export const COST_ITEMS = [
  {
    code: 'SELL_PLATFORM_FEE',
    ja: '販売手数料',
    side: 'SELL' as const,
    fields: ['fee_rate', 'fixed_fee'],
    /** 市場が決めている＝公式ページで確認できる種類。 */
    verifiable: true,
  },
  {
    code: 'BUY_PAYMENT_FEE',
    ja: '仕入時の支払手数料',
    side: 'BUY' as const,
    fields: ['payment_fee_rate'],
    verifiable: true,
  },
  {
    code: 'PAYOUT_COST',
    ja: '売上金の振込手数料',
    side: 'SELL' as const,
    fields: ['payout_fee_fixed', 'payout_fee_rate'],
    verifiable: true,
  },
  {
    code: 'SHIPPING_COST',
    ja: '送料',
    side: 'SELL' as const,
    fields: ['shipping_cost'],
    /** 商品ごとに変わるので、市場に聞いても「一律いくら」という答えが無い。 */
    verifiable: false,
  },
  {
    code: 'PACKING_COST',
    ja: '梱包費',
    side: 'SELL' as const,
    fields: ['packing_cost'],
    verifiable: false,
  },
] as const;

export type CostItemCode = (typeof COST_ITEMS)[number]['code'];

export type CostItemStatus = {
  code: CostItemCode;
  ja: string;
  status: FeeStatus;
  /** その費目が実際に金額として効いているか（0円なら効いていない）。 */
  active: boolean;
  note: string;
};

type FeeRow = Record<string, unknown>;

/**
 * 費目ごとに VERIFIED / ESTIMATED / UNKNOWN を出す。
 *
 * 【判定の考え方】
 *   ・その費目の項目がすべて `verified_fields` に入っていれば VERIFIED
 *   ・確認できない性質の費目（送料・梱包費）は、金額が入っていれば必ず ESTIMATED
 *   ・金額も入っておらず確認もしていないものは UNKNOWN（0円と決めつけない）
 */
export function costItemStatuses(args: {
  buyFee: FeeRow;
  sellFee: FeeRow;
  /** 仕入の支払方法の手数料が分かっているか。分からなければ UNKNOWN になる。 */
  buyPaymentFeeStatus?: 'VERIFIED' | 'ESTIMATED' | 'UNKNOWN';
}): CostItemStatus[] {
  const buyVerified = parseVerifiedFields(args.buyFee.verified_fields);
  const sellVerified = parseVerifiedFields(args.sellFee.verified_fields);

  return COST_ITEMS.map((item) => {
    const row = item.side === 'BUY' ? args.buyFee : args.sellFee;
    const verified = item.side === 'BUY' ? buyVerified : sellVerified;
    const amountish = item.fields.some((f) => Number(row[f] ?? 0) !== 0);

    // 仕入の支払手数料だけは、支払方法ごとの表から状態が来る。
    if (item.code === 'BUY_PAYMENT_FEE') {
      const s = args.buyPaymentFeeStatus ?? 'UNKNOWN';
      return {
        code: item.code, ja: item.ja, status: s as FeeStatus, active: true,
        note: s === 'UNKNOWN'
          ? '実際に使う支払方法の手数料が分かっていない。この分の費用を0円として計算していない'
          : s === 'VERIFIED'
            ? '支払方法ごとの実額を確認済み'
            : '支払方法ごとの手数料は概算（公式ページ未確認）',
      };
    }

    if (!item.verifiable) {
      return {
        code: item.code, ja: item.ja,
        status: (amountish ? 'ESTIMATED' : 'UNKNOWN') as FeeStatus,
        active: amountish,
        note: amountish
          ? `${item.ja}は商品・発送方法で変わるため、こちらの見積り。実際に発送するまで確定しない`
          : `${item.ja}が0円のまま。確認していないだけの可能性がある`,
      };
    }

    const allVerified = item.fields.every((f) => verified.includes(f));
    if (allVerified) {
      return {
        code: item.code, ja: item.ja, status: 'VERIFIED' as FeeStatus, active: amountish,
        note: `公式の料金ページで確認済み（${item.fields.map((f) => FEE_FIELD_JA[f] ?? f).join('・')}）`,
      };
    }
    return {
      code: item.code, ja: item.ja,
      status: (amountish ? 'ESTIMATED' : 'UNKNOWN') as FeeStatus,
      active: amountish,
      note: amountish
        ? `金額は入っているが、公式の確認が取れていない（${item.fields.map((f) => FEE_FIELD_JA[f] ?? f).join('・')}）`
        : `未確認のまま0円として計算している（${item.fields.map((f) => FEE_FIELD_JA[f] ?? f).join('・')}）`,
    };
  });
}

/**
 * COST CONFIDENCE の上限。
 *
 * 【100にしない】
 * ユーザー指示：「COST_CONFIDENCE を100%にしないでください。」
 * 送料と梱包費は、実際に売って発送するまで確定しない。
 * どれだけ公式ページを確認しても、この2つが見積りである以上「費用を完全に把握した」とは言えない。
 *
 * 95にした理由：STRONG BUY に必要なデータ信頼度は65点なので、
 * 全部確認できていれば STRONG BUY の妨げにはならない位置。
 * ただし満点は名乗らせない。**この数字を上げる方向へ動かさないこと。**
 */
export const COST_CONFIDENCE_MAX = 95;

/** 費目ごとの点数。確認できていないものは大きく引く。 */
const COST_ITEM_POINTS: Record<FeeStatus, number> = {
  VERIFIED: 100,
  ESTIMATED: 60,
  OUTDATED: 40,
  UNKNOWN: 20,
};

/**
 * 費目ごとの状態から、費用全体の信頼度（0〜100）を出す。
 *
 * 【平均ではなく「いちばん低い費目」を重く見る】
 * 4つ確認済みで1つ不明のとき、平均だと84点になって「だいたい分かっている」に見える。
 * だが不明の1つが送料なら、利益額そのものが分からない。
 * 平均と最低値を半々で混ぜ、悪い1つが隠れないようにする。
 */
export function costConfidence(items: CostItemStatus[]): number {
  const active = items.filter((i) => i.active || i.status === 'UNKNOWN');
  if (active.length === 0) return COST_ITEM_POINTS.UNKNOWN;
  const points = active.map((i) => COST_ITEM_POINTS[i.status] ?? 20);
  const avg = points.reduce((a, b) => a + b, 0) / points.length;
  const worst = Math.min(...points);
  return Math.round(Math.min(COST_CONFIDENCE_MAX, avg * 0.5 + worst * 0.5));
}

export const COST_ITEM_JA: Record<string, string> = Object.fromEntries(
  COST_ITEMS.map((i) => [i.code, i.ja]),
);

/**
 * 商品1件について、4段階に分けた利益（ユーザー指示 §8）。
 *
 * 【なぜ4つに分けるのか】
 * 1つの「利益」という言葉に、性質の違う4つが混ざっていた。
 *   ・手数料を引く前の値差
 *   ・その1件を売り切ったときに残るお金
 *   ・振込費用まで按分したときの見え方（運用次第で変わる参考値）
 *   ・思ったより安く売れた場合でも残るお金
 * 混ぜたままだと「利益3,000円」と言われても、それがどの意味か分からない。
 *
 * **お金を出す判断に使うのは CONSERVATIVE_NET_PROFIT（保守利益）。**
 * ユーザー指示：「特に重要なのは CONSERVATIVE_NET_PROFIT です。」
 */
export type ProfitLadder = {
  /** 粗利：販売価格 − 仕入価格。手数料を一切引いていない見かけの差。 */
  grossProfit: number;
  /** 取引後利益：仕入総額と、その1件を売るのにかかる費用を全部引いたあと。 */
  transactionNetProfit: number;
  /** 振込費按分後利益：上から、振込費用の按分（参考値）をさらに引いたもの。判定には使わない。 */
  payoutAllocatedNetProfit: number;
  /** 保守利益：控えめな販売価格で売れた場合に残るお金。実際に買うかどうかはこれで決める。 */
  conservativeNetProfit: number;
};

export const PROFIT_LADDER_JA: Record<keyof ProfitLadder, string> = {
  grossProfit: '粗利（手数料を引く前の値差）',
  transactionNetProfit: '取引後利益（1件を売り切ったときに残るお金）',
  payoutAllocatedNetProfit: '振込費按分後利益（参考。判定には使わない）',
  conservativeNetProfit: '保守利益（控えめに売れた場合。買う判断はこれで行う）',
};
