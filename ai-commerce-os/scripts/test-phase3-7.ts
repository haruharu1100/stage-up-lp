/**
 * Phase 3.7（費用の分離・支払方法・検証ファネル）の受け入れテスト。
 *
 * 【このテストが守っているもの】
 * ユーザーからの指摘はこうだった。
 *
 *   「メルカリの『振込手数料200円』は、1商品ごとの販売コストではなく、
 *     売上金を銀行へ振り込む"申請1回ごと"の費用です。
 *     もし現在の利益計算で商品1件ごとに200円を引いているなら、それは修正が必要です。」
 *
 *   「メルカリで仕入れる側の支払い手数料も固定ではありません。
 *     クレジットカード払い、メルペイ残高払い、Apple Pay、FamiPay などは現在無料ですが、
 *     コンビニ・ATM・キャリア決済では金額に応じた手数料があります。」
 *
 *   「『最も安い支払方法を勝手に選ぶ』のではなく、実際に当社が使う支払方法を基準にしてください。」
 *
 *   「一部費用だけ公式確認済みでも、全体を『完全確認済み』と扱わないでください。」
 *
 *   「100件という数字だけを追わない方がいいです。」
 *
 * この5つが将来なし崩しに戻らないように、次を潰しにいく。
 *
 *   1. 振込手数料が、また1商品ごとの費用として引かれること
 *   2. 分からない支払手数料が「0円」として計算に混ざること
 *   3. 安い支払方法をシステムが勝手に選ぶこと
 *   4. 一部の費目が確認済みなだけで COST_CONFIDENCE が100点になること
 *   5. 「100件入力した」だけで前に進めること
 *   6. 購入・出品・決済・自動ログインの処理が紛れ込むこと
 */
import { all, one, migrate } from '../lib/db/client';
import { calcRoute, calcAcquisitionCost, calcNetReceipt, type FeeProfile } from '../lib/route';
import { allocatePayoutCost, payoutLeakCheck, PAYOUT_BASIS_JA } from '../lib/payout';
import {
  costConfidence, costItemStatuses, COST_ITEMS, COST_CONFIDENCE_MAX, PROFIT_LADDER_JA,
} from '../lib/cost';
import {
  BUY_PAYMENT_METHODS, MERCARI_PAYMENT_RULES, resolvePaymentFee,
  isBuyPaymentMethod, buyPaymentMethodJa,
} from '../lib/paymentmethods';
import { loadPaymentRules, paymentMethodCoverage, buyPaymentFeeFor } from '../lib/payment';
import { VERIFIED_FEES } from '../lib/feeverified';
import { VENUE_RATE_FIELDS, FEE_FIELD_JA } from '../lib/feestatus';
import { feeVersionOf } from '../lib/fees';
import {
  parsePackageSize, parseShippingMethod, parseShippingPayer,
  PACKAGE_SIZES, SHIPPING_METHODS, SHIPPING_PAYERS,
  OBSERVATION_CSV_TEMPLATE, shippingAccuracy,
} from '../lib/observation';
import { validationFunnel } from '../lib/funnel';
import { pilotReport } from '../lib/pilot';
import { getCostSettings, SETTING_DEFS, getThresholds } from '../lib/settings';
import { ensureReady } from '../lib/queries';
import { assertNoExecutionPath } from '../lib/smalltrade';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  OK   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  NG   ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n[${title}]`);
}

async function n(sql: string, args: unknown[] = []): Promise<number> {
  const r = await one(`SELECT COUNT(*) AS n FROM ${sql}`, args);
  return Number(r?.n ?? 0);
}

/** テスト用の素の手数料。ここを書き換えると全部の期待値が動くので触らない。 */
function fee(over: Partial<FeeProfile> = {}): FeeProfile {
  return {
    venue_code: 'TEST', side: 'SELL', category_key: 'DEFAULT',
    fee_rate: 0, payment_fee_rate: 0, currency_fee_rate: 0, tax_rate: 0,
    import_duty_rate: 0, advertising_fee_rate: 0, return_loss_rate: 0,
    fixed_fee: 0, shipping_cost: 0, authentication_fee: 0, packing_cost: 0,
    warehouse_cost: 0, return_loss_fixed: 0, other_cost: 0,
    is_estimated: 0, source_type: 'OFFICIAL_PAGE', source_url: null,
    ...over,
  } as unknown as FeeProfile;
}

/**
 * よく売れている市場の観測データ。
 * ここを「良い条件」で固定しておくことで、
 * このテストが見たいもの（費用の分け方・支払方法の扱い）だけを比べられる。
 */
const GOOD_MARKET = {
  identity_key: 'gtin:4901234567894', venue_code: 'B', side: 'SELL', price: 20000,
  price_basis: 'SOLD_MEDIAN', low_price: 19000, median_price: 20000, avg_price: 20000,
  listing_count: 60, sold_count_30d: 60, avg_days_to_sell: 3,
  price_stddev_ratio: 0.03, source_type: 'CSV_MANUAL', observed_at: new Date().toISOString(),
} as never;

async function main() {
  await migrate();
  await ensureReady();
  const thresholds = await getThresholds();

  /** 足りない項目を埋めた calcRoute の入力。テストでは変えたい所だけ上書きする。 */
  const route = (over: Partial<Parameters<typeof calcRoute>[0]>) => calcRoute({
    buyVenueCode: 'A', sellVenueCode: 'B',
    buyFee: fee({ side: 'BUY' }), sellFee: fee({ fee_rate: 0.1 }),
    itemPrice: 10000, sellPrice: 20000, sellVenueMarketPrice: 20000,
    sellObservation: GOOD_MARKET,
    sellPriceBasis: 'SOLD_MEDIAN', buyPriceBasis: 'SUPPLIER_PRICE',
    thresholds, isBrandedHighValue: false, sellVenueAuthentication: 'NONE',
    sellVenueTermsStatus: 'VERIFIED', crossBorder: false, humanVerified: true,
    identityKey: 'gtin:4901234567894',
    ...over,
  });

  console.log('='.repeat(72));
  console.log('【Phase 3.7 受け入れテスト：費用の分離・支払方法・検証ファネル】');
  console.log('='.repeat(72));

  // ================================================================
  section('1. 振込手数料を1商品ごとの販売費用にしない');

  const mercariSell = VERIFIED_FEES.find((f) => f.venueCode === 'MERCARI' && f.side === 'SELL');
  check('メルカリSELLの登録がある', Boolean(mercariSell));
  check(
    '販売手数料は10%',
    Number(mercariSell?.values.fee_rate) === 0.1,
    `${Number(mercariSell?.values.fee_rate) * 100}%`,
  );
  check(
    'fixed_fee（1取引ごとの固定費）に200円が入っていない',
    Number(mercariSell?.values.fixed_fee ?? 0) === 0,
    `fixed_fee=${Number(mercariSell?.values.fixed_fee ?? 0)}`,
  );
  check(
    '振込手数料200円は payout_fee_fixed に入っている',
    Number(mercariSell?.values.payout_fee_fixed) === 200,
    `payout_fee_fixed=${Number(mercariSell?.values.payout_fee_fixed)}`,
  );

  const dbSell = await one(
    `SELECT * FROM venue_fee_profiles WHERE venue_code='MERCARI' AND side='SELL'`,
  );
  check(
    'データベース側も fixed_fee = 0',
    Number(dbSell?.fixed_fee ?? -1) === 0,
    `${Number(dbSell?.fixed_fee ?? -1)}円`,
  );
  check(
    'データベース側の payout_fee_fixed = 200',
    Number(dbSell?.payout_fee_fixed ?? -1) === 200,
    `${Number(dbSell?.payout_fee_fixed ?? -1)}円`,
  );

  // 1万円の商品を売ったときの入金。10%だけ引かれ、200円は引かれない。
  const sell10k = calcNetReceipt(10000, fee({ fee_rate: 0.1, payout_fee_fixed: 200 }));
  check(
    '1万円で売ったときの販売手数料は1,000円（200円が上乗せされない）',
    sell10k.sellerFee === 1000,
    `${sell10k.sellerFee}円`,
  );
  check(
    '入金予想は9,000円（8,800円にならない）',
    sell10k.netReceipt === 9000,
    `${sell10k.netReceipt}円`,
  );

  const leak = payoutLeakCheck({
    transactionCost: sell10k.total, sellPrice: 10000, feeRate: 0.1,
    payoutFeeFixed: 200, expectedTransactionCost: 1000,
  });
  check('取引費用に振込手数料が混ざっていない（漏れ検査）', leak.ok, leak.message);

  // 安い商品ほど不当に不利にならないこと。1,000円の商品で確かめる。
  const sell1k = calcNetReceipt(1000, fee({ fee_rate: 0.1, payout_fee_fixed: 200 }));
  check(
    '1,000円の商品でも入金は900円（振込手数料で赤字にならない）',
    sell1k.netReceipt === 900,
    `${sell1k.netReceipt}円`,
  );

  // ================================================================
  section('2. TRANSACTION_COST と PAYOUT_COST の分離・按分');

  const a1 = allocatePayoutCost({ payout_fee_fixed: 200, payout_fee_rate: 0 }, 1);
  check('1件ずつ申請すると1商品あたり200円', a1.allocatedPerItem === 200, `${a1.allocatedPerItem}円`);
  const a100 = allocatePayoutCost({ payout_fee_fixed: 200, payout_fee_rate: 0 }, 100);
  check('100件まとめると1商品あたり2円', a100.allocatedPerItem === 2, `${a100.allocatedPerItem}円`);
  const a0 = allocatePayoutCost({ payout_fee_fixed: 200, payout_fee_rate: 0 }, 0);
  check('0件と書かれても0で割らない（1件として扱う）', a0.allocatedPerItem === 200, `${a0.allocatedPerItem}円`);
  const aNone = allocatePayoutCost({ payout_fee_fixed: 0, payout_fee_rate: 0 }, 10);
  check('振込手数料が無い市場では按分しない（basis=NONE）', aNone.basis === 'NONE', aNone.basis);
  check('按分の根拠に日本語の説明がある', Object.keys(PAYOUT_BASIS_JA).length >= 3);

  const buyFee = fee({ side: 'BUY' });
  const sellFee = fee({ fee_rate: 0.1, payout_fee_fixed: 200 });
  const r = route({
    buyFee, sellFee,
    payoutItemsPerRequest: 100, payoutBasis: 'SETTING',
  });

  check(
    '粗利は売値と買値の差（20,000 − 10,000 = 10,000円）',
    r.profits.grossProfit === 10000,
    `${r.profits.grossProfit}円`,
  );
  check(
    '取引後利益に振込手数料が入っていない（8,000円）',
    r.profits.transactionNetProfit === 8000,
    `${r.profits.transactionNetProfit}円`,
  );
  check(
    '振込費按分後利益は取引後利益より2円だけ低い（7,998円）',
    r.profits.payoutAllocatedNetProfit === 7998,
    `${r.profits.payoutAllocatedNetProfit}円`,
  );
  check(
    '判定に使う利益（expectedNetProfit）は按分前のまま',
    r.expectedNetProfit === r.profits.transactionNetProfit,
    `${r.expectedNetProfit}円`,
  );

  // 按分の分母を変えても、買う／買わないの判定と点数は動かないこと。
  const rSame = route({
    buyFee, sellFee,
    payoutItemsPerRequest: 1, payoutBasis: 'SETTING',
  });
  check(
    '按分の分母を変えても判定は変わらない',
    rSame.decision === r.decision,
    `${r.decision} / ${rSame.decision}`,
  );
  check(
    '按分の分母を変えても点数は変わらない',
    rSame.routeScore === r.routeScore,
    `${r.routeScore}点 / ${rSame.routeScore}点`,
  );
  check(
    '按分後の金額だけが変わる（200円 vs 2円）',
    rSame.payout.allocatedPerItem === 200 && r.payout.allocatedPerItem === 2,
  );

  check('4つの利益に日本語の名前がある', Object.keys(PROFIT_LADDER_JA).length === 4);
  check(
    '「振込費按分後利益」は参考だと名前に書いてある',
    PROFIT_LADDER_JA.payoutAllocatedNetProfit.includes('参考'),
    PROFIT_LADDER_JA.payoutAllocatedNetProfit,
  );
  check(
    '「保守利益」で買う判断をすると名前に書いてある',
    PROFIT_LADDER_JA.conservativeNetProfit.includes('判断'),
    PROFIT_LADDER_JA.conservativeNetProfit,
  );

  check(
    '振込手数料は手数料の版（fee_version）に含まれる',
    feeVersionOf({ payout_fee_fixed: 200 }) !== feeVersionOf({ payout_fee_fixed: 0 }),
  );

  // ================================================================
  section('3. 仕入時の支払方法（BUY_PAYMENT_METHOD）');

  check('支払方法は8種類ある', BUY_PAYMENT_METHODS.length === 8, `${BUY_PAYMENT_METHODS.length}種類`);
  for (const code of ['CREDIT_CARD', 'MERCARI_BALANCE', 'APPLE_PAY', 'FAMIPAY',
    'CONVENIENCE_STORE', 'ATM', 'CARRIER_PAYMENT', 'OTHER']) {
    check(`支払方法 ${code} がある`, isBuyPaymentMethod(code));
  }
  check('知らない支払方法は受け付けない', !isBuyPaymentMethod('PAYPAY_SOMETHING'));
  check('支払方法に日本語名がある', buyPaymentMethodJa('CREDIT_CARD') === 'クレジットカード払い');

  const rules = await loadPaymentRules('MERCARI');
  check('メルカリの支払方法がデータベースに登録されている', rules.length === MERCARI_PAYMENT_RULES.length,
    `${rules.length}件`);

  const card = resolvePaymentFee(rules, 'CREDIT_CARD', 50000);
  check('クレジットカード払いの手数料は0円', card.fee === 0 && card.known, `${card.fee}`);
  check(
    'ただし「公式で確認済み」にはしていない（概算のまま）',
    card.status === 'ESTIMATED',
    card.status,
  );

  const conv = resolvePaymentFee(rules, 'CONVENIENCE_STORE', 50000);
  check(
    'コンビニ払いの手数料は「不明」（0円で埋めない）',
    conv.fee === null && !conv.known,
    `fee=${conv.fee}`,
  );
  check('コンビニ払いの状態は UNKNOWN', conv.status === 'UNKNOWN', conv.status);

  const atm = resolvePaymentFee(rules, 'ATM', 3000);
  check('ATM払いの手数料も「不明」', atm.fee === null && !atm.known);
  const carrier = resolvePaymentFee(rules, 'CARRIER_PAYMENT', 3000);
  check('キャリア決済の手数料も「不明」', carrier.fee === null && !carrier.known);

  const nothing = resolvePaymentFee(rules, 'NOT_REGISTERED', 1000);
  check('登録が無い支払方法は「不明」を返す（例外で落ちない）', nothing.fee === null && !nothing.known);

  const other = await buyPaymentFeeFor('YAHOO_AUCTION', 'CREDIT_CARD', 10000);
  check(
    '支払方法を登録していない市場は null（勝手に0円を足さない）',
    other === null,
    String(other),
  );

  // 「最も安い方法を勝手に選ぶ」関数が存在しないこと
  const payMod = await import('../lib/paymentmethods');
  const cheapest = Object.keys(payMod).filter((k) => /cheap|lowest|best/i.test(k));
  check(
    '「最も安い支払方法を選ぶ」関数が存在しない',
    cheapest.length === 0,
    cheapest.join(',') || 'なし',
  );

  // 分からない支払方法を使うと、仕入総額が確定しない → STRONG BUY へ上げない
  const buyUnknown = calcAcquisitionCost(10000, buyFee, { code: 'CONVENIENCE_STORE', fee: null });
  check(
    '手数料が不明な支払方法では paymentMethodFeeKnown = false',
    buyUnknown.paymentMethodFeeKnown === false,
  );
  check(
    '不明な手数料を勝手に0円として総額へ足していない',
    buyUnknown.paymentMethodFee === 0 && buyUnknown.paymentMethodFeeKnown === false,
  );

  const rUnknownPay = route({
    itemPrice: 1000, buyFee, sellFee: fee({ fee_rate: 0.05 }),
    buyPaymentMethod: { code: 'CONVENIENCE_STORE', fee: null, status: 'UNKNOWN' },
  });
  check(
    '支払手数料が不明なら STRONG BUY にしない',
    rUnknownPay.decision !== 'STRONG_BUY',
    rUnknownPay.decision,
  );
  check('支払手数料が不明ならリスク点が上がる', rUnknownPay.riskScore > 0, `${rUnknownPay.riskScore}点`);

  const cs = await getCostSettings();
  check(
    '標準の支払方法が設定として存在する',
    isBuyPaymentMethod(cs.mercariBuyPaymentMethod),
    cs.mercariBuyPaymentMethod,
  );
  check(
    '標準の支払方法は管理画面から変えられる（設定項目がある）',
    SETTING_DEFS.some((d) => d.key === 'DEFAULT_MERCARI_BUY_PAYMENT_METHOD'),
  );
  check(
    '振込申請1回でまとめる件数も設定できる',
    SETTING_DEFS.some((d) => d.key === 'PAYOUT_ITEMS_PER_REQUEST'),
  );

  const covPay = await paymentMethodCoverage('MERCARI', cs.mercariBuyPaymentMethod);
  check(
    '手数料が分からない支払方法の件数を画面に出せる',
    covPay.unknown === 4,
    `${covPay.unknown}件（コンビニ・ATM・キャリア決済・その他）`,
  );

  // ================================================================
  section('4. 費目ごとの確からしさ（COST_CONFIDENCE を100点にしない）');

  check('費目は5つに分かれている', COST_ITEMS.length === 5, `${COST_ITEMS.length}件`);
  for (const code of ['SELL_PLATFORM_FEE', 'BUY_PAYMENT_FEE', 'SHIPPING_COST', 'PACKING_COST', 'PAYOUT_COST']) {
    check(`費目 ${code} がある`, COST_ITEMS.some((c) => c.code === code));
  }

  const perfect = costItemStatuses({
    buyFee: { verified_fields: JSON.stringify(VENUE_RATE_FIELDS), is_estimated: 0 },
    sellFee: {
      verified_fields: JSON.stringify(VENUE_RATE_FIELDS), is_estimated: 0,
      fee_rate: 0.1, payout_fee_fixed: 200, shipping_cost: 800, packing_cost: 100,
    },
    buyPaymentFeeStatus: 'VERIFIED',
  });
  const bestScore = costConfidence(perfect);
  check(
    '全部そろっていても COST_CONFIDENCE は100点にならない',
    bestScore < 100,
    `${bestScore}点`,
  );
  check('上限は95点', COST_CONFIDENCE_MAX === 95, `${COST_CONFIDENCE_MAX}点`);
  check('上限を超えない', bestScore <= COST_CONFIDENCE_MAX, `${bestScore}点`);

  const partial = costItemStatuses({
    buyFee: { verified_fields: JSON.stringify(['fee_rate']), is_estimated: 1 },
    sellFee: {
      verified_fields: JSON.stringify(['fee_rate']), is_estimated: 1,
      fee_rate: 0.1, shipping_cost: 800,
    },
    buyPaymentFeeStatus: 'UNKNOWN',
  });
  const partialScore = costConfidence(partial);
  check(
    '一部だけ確認済みのとき、点数は全部確認済みより低い',
    partialScore < bestScore,
    `${partialScore}点 < ${bestScore}点`,
  );
  check(
    '確認していない費目は VERIFIED にならない',
    partial.filter((c) => c.status === 'VERIFIED').length < partial.length,
  );

  check(
    'Routeの結果に費目ごとの状態が入っている',
    Array.isArray(r.costItems) && r.costItems.length === 5,
    `${r.costItems.length}件`,
  );
  check('Routeの結果に費用の確からしさが入っている', typeof r.costConfidence === 'number');
  check('費用の確からしさも100点にならない', r.costConfidence < 100, `${r.costConfidence}点`);

  check(
    '振込手数料は「市場が決めている率」として検証できる項目に入っている',
    (VENUE_RATE_FIELDS as readonly string[]).includes('payout_fee_fixed'),
  );
  check(
    '振込手数料の日本語名に「申請1回ごと」と書いてある',
    FEE_FIELD_JA.payout_fee_fixed.includes('申請1回'),
    FEE_FIELD_JA.payout_fee_fixed,
  );

  // ================================================================
  section('5. 送料の精度');

  check('荷物サイズの選択肢がある', PACKAGE_SIZES.length >= 6, `${PACKAGE_SIZES.length}種類`);
  check('発送方法の選択肢がある', SHIPPING_METHODS.length >= 6, `${SHIPPING_METHODS.length}種類`);
  check('送料の負担者の選択肢がある', SHIPPING_PAYERS.length === 3, `${SHIPPING_PAYERS.length}種類`);

  check('「80サイズ」を読み取れる', parsePackageSize('80サイズ') === 'SIZE_80');
  check('数字だけの「80」も読み取れる', parsePackageSize('80') === 'SIZE_80');
  check('「ネコポス」を読み取れる', parsePackageSize('ネコポス') === 'NEKOPOS');
  check('読み取れない言葉は null（近い方に寄せない）', parsePackageSize('だいたい中くらい') === null);
  check('空欄は null', parsePackageSize('') === null);

  check('「らくらくメルカリ便」を読み取れる', parseShippingMethod('らくらくメルカリ便') === 'RAKURAKU');
  check('「ゆうゆうメルカリ便」を読み取れる', parseShippingMethod('ゆうゆうメルカリ便') === 'YUYU');
  check('読み取れない発送方法は null', parseShippingMethod('たぶん宅配') === null);

  check('「送料込み」は出品者負担', parseShippingPayer('送料込み') === 'SELLER');
  check('「着払い」は購入者負担', parseShippingPayer('着払い') === 'BUYER');
  check('読み取れない負担者は null', parseShippingPayer('よくわからない') === null);

  check(
    'CSVの見本に送料の項目が入っている',
    OBSERVATION_CSV_TEMPLATE.includes('荷物サイズ')
      && OBSERVATION_CSV_TEMPLATE.includes('発送方法')
      && OBSERVATION_CSV_TEMPLATE.includes('見込み送料')
      && OBSERVATION_CSV_TEMPLATE.includes('実際の送料'),
  );

  const ship = await shippingAccuracy();
  check(
    '比べられる件数が0のとき「精度100%」と書かない',
    ship.comparable > 0 || ship.verdictJa.includes('測れません'),
    ship.verdictJa,
  );
  check('比べられないとき平均のずれは null', ship.comparable > 0 || ship.avgGapYen === null);

  // ================================================================
  section('6. 検証ファネル（「100件」だけを追わない）');

  const f = await validationFunnel();
  check('ファネルは5段ある', f.stages.length === 5, `${f.stages.length}段`);
  for (const code of ['OBSERVED_LISTINGS', 'MATCHABLE_PRODUCTS', 'ROUTE_GENERATED_PRODUCTS',
    'SHADOW_ELIGIBLE_PRODUCTS', 'STRONG_BUY_CANDIDATES']) {
    check(`段階 ${code} がある`, f.stages.some((s) => s.code === code));
  }
  check(
    '実市場0件のとき割合は null（100%と書かない）',
    f.observedListings > 0 || f.matchableRate === null,
    `observed=${f.observedListings} rate=${String(f.matchableRate)}`,
  );
  check(
    '実市場0件のとき「測れない」と言う',
    f.observedListings > 0 || f.verdictJa.includes('測れません'),
    f.verdictJa,
  );
  check(
    '落ちている場所を言葉で出せる',
    typeof f.bottleneckJa === 'string' && f.bottleneckJa.length > 0,
  );
  check(
    '各段に「なぜ落ちるか」の説明がある',
    f.stages.every((s) => s.lostReasonJa.length > 0),
  );
  check(
    'STRONG BUYを増やすために判定を甘くしない、と書いてある',
    f.stages.find((s) => s.code === 'STRONG_BUY_CANDIDATES')!.lostReasonJa.includes('甘く'),
  );
  check('カテゴリの偏りを測れる', Array.isArray(f.byCategory));

  // ================================================================
  section('7. まず10件（PILOT）を通るまで100件へ進まない');

  const p = await pilotReport();
  check('PILOTの件数は設定から読む', p.pilotSize === cs.pilotSize, `${p.pilotSize}件`);
  check('PILOTの既定は10件', SETTING_DEFS.find((d) => d.key === 'PILOT_SIZE')?.value === '10');
  check('100件は別の設定として持つ', SETTING_DEFS.some((d) => d.key === 'VALIDATION_TARGET'));
  check('確認項目が7つある', p.checks.length === 7, `${p.checks.length}項目`);
  check(
    '入力0件のときは100件へ進めない',
    p.entered > 0 || p.canProceed === false,
    `entered=${p.entered} canProceed=${p.canProceed}`,
  );
  check(
    '入力0件のとき「まず10件」と案内する',
    p.entered > 0 || p.verdictJa.includes('まず'),
    p.verdictJa,
  );
  check(
    '測れていない項目は「合格」ではなく「まだ測れない」として出す',
    p.checks.every((c) => !(c.unmeasurable && c.ok)),
  );
  check('見つかった問題を隠さずに出す', Array.isArray(p.issues));
  check(
    '作業時間が未計測なら「自動化する場所は決められない」と言う',
    p.automateNextJa.includes('決められません') || p.automateNextJa.includes('自動化'),
    p.automateNextJa,
  );
  check('①総時間・②1件平均を出せる', typeof p.totalSeconds === 'number' && 'avgSecondsPerItem' in p);
  check('③入力できなかった情報を出せる', Array.isArray(p.missingFields) && p.missingFields.length > 0);
  check('④⑤⑥はファネルから出せる', p.funnel.stages.length === 5);

  // ================================================================
  section('8. 壊してはいけないもの（回帰）');

  // 支払方法を渡さない従来の呼び出しでも、計算が1円も変わらないこと。
  const oldWay = calcAcquisitionCost(10000, buyFee);
  const newWayNoMethod = calcAcquisitionCost(10000, buyFee, null);
  check(
    '支払方法を渡さない従来の計算は1円も変わらない',
    oldWay.total === newWayNoMethod.total && oldWay.total === 10000,
    `${oldWay.total}円 / ${newWayNoMethod.total}円`,
  );
  check(
    '支払方法を渡さないときは「分かっている」扱い（従来どおり）',
    oldWay.paymentMethodFeeKnown === true,
  );

  // BUY費用にSELL専用の費用が混ざっていないこと（Phase 2 のルール）
  const buyWithSellCosts = calcAcquisitionCost(10000, fee({
    side: 'BUY', packing_cost: 500, warehouse_cost: 300, payout_fee_fixed: 200,
  }));
  check(
    'BUY費用に梱包費・保管費・振込手数料が混ざっていない',
    buyWithSellCosts.total === 10000,
    `${buyWithSellCosts.total}円`,
  );

  // 手数料が概算のままなら STRONG BUY にしない（Phase 2 のルール）
  const rEstimated = route({
    itemPrice: 1000, buyFee: fee({ side: 'BUY', is_estimated: 1 }),
    sellFee: fee({ fee_rate: 0.05, is_estimated: 1 }),
  });
  check(
    '手数料が概算のままなら STRONG BUY にしない',
    rEstimated.decision !== 'STRONG_BUY',
    rEstimated.decision,
  );

  const strongEstimated = await n(`arbitrage_routes WHERE decision='STRONG_BUY' AND fees_estimated=1`);
  check('概算の手数料のまま STRONG BUY になっているRouteが無い', strongEstimated === 0, `${strongEstimated}件`);

  const strongPayUnknown = await n(
    `arbitrage_routes WHERE decision='STRONG_BUY' AND buy_payment_fee_known=0`,
  );
  check(
    '支払手数料が不明なまま STRONG BUY になっているRouteが無い',
    strongPayUnknown === 0,
    `${strongPayUnknown}件`,
  );

  const badPayout = await n(
    `arbitrage_routes WHERE expected_net_profit <> (expected_net_receipt - acquisition_total_cost)`,
  );
  check(
    '保存されたRouteの利益に振込手数料が混ざっていない',
    badPayout === 0,
    `${badPayout}件`,
  );

  // ================================================================
  section('9. まだ実行系は無い');

  const noExec = assertNoExecutionPath();
  check('購入・出品・決済・発送の実行処理が存在しない', noExec.ok, noExec.message);
  const owned = await n(`supplier_products WHERE ownership_state <> 'NOT_OWNED'`);
  check('所有している商品は1件も無い', owned === 0, `${owned}件`);

  const paySrc = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../lib/payment.ts', import.meta.url).pathname
      .split('/').map(decodeURIComponent).join('/'), 'utf8'));
  check(
    '支払方法の処理に外部サイトへの通信が無い',
    !/fetch\(|axios|https?:\/\/[^\s'"]*\/(buy|purchase|checkout)/i.test(paySrc),
  );

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log('【現状の正直な数字】');
  console.log(`  メルカリ販売手数料：10%（fixed_fee = ${Number(dbSell?.fixed_fee ?? 0)}円）`);
  console.log(`  メルカリ振込手数料：${Number(dbSell?.payout_fee_fixed ?? 0)}円／振込申請1回ごと（商品ごとではない）`);
  console.log(`  仕入時の支払方法：${buyPaymentMethodJa(cs.mercariBuyPaymentMethod)}`);
  console.log(`  　手数料が分からない支払方法：${covPay.unknown} / ${covPay.total}件`);
  console.log(`  振込申請1回でまとめる件数：${cs.payoutItemsPerRequest}件`);
  console.log(`  検証ファネル：観測${f.observedListings} → 一致${f.matchableProducts}`
    + ` → Route${f.routeGeneratedProducts} → 答え合わせ${f.shadowEligibleProducts}`
    + ` → STRONG BUY候補${f.strongBuyCandidates}`);
  console.log(`  ${p.pilotSize}件テスト：${p.passedCount} / ${p.totalCount}項目（100件へ進める：${p.canProceed ? 'はい' : 'いいえ'}）`);
  console.log('='.repeat(72));

  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.7（費用の分離・支払方法・検証ファネル）の受け入れ条件をすべて満たしています。');
  console.log('※ 振込手数料は1商品ごとの費用として引いていません。');
  console.log('※ 購入・出品・決済・発送・自動ログインは、いまも未実装です。');
}

main().catch((e) => { console.error(e); process.exit(1); });
