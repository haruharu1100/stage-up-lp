/**
 * Phase 4（仕入価格 → Amazon販売のRoute検証）の受け入れテスト。
 *
 * ------------------------------------------------------------------
 * 【このテストは Keepa へも仕入先へも一切アクセスしない】
 * 使うのは手で作った偽の行だけ。APIキーが無くても最後まで通る。
 * DBにも書き込まない。
 *
 * ------------------------------------------------------------------
 * 【ここで潰しておきたい将来の事故】
 *
 *   1. 「取り方」の選択肢だけ増やして、動かないものを動くことにする
 *   2. スクレイピングが「種類」として名前だけ復活する
 *   3. 最初の仕入先を KOMEHYO 固定にする
 *   4. 分からない項目を推測で埋める／空欄を0円にする
 *   5. 仕入先URLが無い行を、分析そのものから外す
 *   6. AIがURLを組み立てて「購入ページを開く」に出す
 *   7. 見本データが本物の仕入候補に混ざり、仮の利益額が本番の数に入る
 *   8. 候補が複数あるのに、勝手に1件へ決めてしまう
 *   9. 人が出した答えで、機械の判定を上書きしてしまう
 *  10. BuyBoxが無いのに、あるときと同じ確からしさで値段を出す
 *  11. 実成約データが無いのに CALIBRATED 価格を出す
 *  12. Amazon側の費用と当社側の費用を1つに混ぜる
 *  13. 手数料が欠けているのに、0円として利益を出す
 *  14. 「売れるから買う」でBUYにする（利益を見ないで決める）
 *  15. 需要の食い違い／Amazon本体の存在を、いきなりSKIPにする
 *  16. 落ちた理由を全部「候補が複数」で片付けて、直す場所が分からなくなる
 *  17. ファネルの人数が途中で増えて、KPIが100%を超える
 *  18. 分母0を0%と書く
 *  19. 10件の上限を、自動で増やす
 *  20. 赤字の商品に、追加で枠を使って調べに行く
 *  21. 判定モデルv0が本番の仕入判定へ流れ込む
 *  22. 実購入・実出品・実決済のコードが混入する
 *  23. 新しいファイルが依存を抱えて画面へバンドルできなくなる（ルール37）
 *
 * ------------------------------------------------------------------
 * ★ソース全文を正規表現で検査するときは、**先にコメントを取り除く**（ルール64）。
 *   歯止めを説明したコメント文にテストが反応して落ちる、という同じ形の間違いが
 *   過去に何度も起きている。
 *
 * ★このテストの偽データには、見本の印（SAMPLE / テスト / サンプル 等）を
 *   **絶対に入れない**。入れると looksLikeSampleRow が見本と判定し、
 *   本物として数えるつもりの行が数から外れて、テストが意味を失う。
 *   後片付け用の目印には P4ONLY を使う。
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  calcAmazonFees,
  calcOwnCosts,
  combineCosts,
  isFeeConfidentEnough,
  FEE_CONFIDENCES,
  FEE_CONFIDENCE_MIN_FOR_BUY,
  OWN_COST_DEFAULTS,
  OWN_COST_KEYS,
  OWN_COST_SETTING_KEYS,
  RETURN_LOSS_RATE_DEFAULT,
} from '../lib/phase4/amazoncost';
import {
  calcDeepScanValue,
  checkDeepScanGate,
  DEEP_SCAN_AUTO_RUN,
  DEEP_SCAN_EXECUTION_IMPLEMENTED,
  DEEP_SCAN_ROI_NEAR_RATIO,
} from '../lib/phase4/deepscan';
import {
  AMAZON_RETAIL_RISK_CAUSES_SKIP,
  AUTO_PURCHASE_IMPLEMENTED,
  BUY_DECISIONS,
  DECISION_SETTING_KEYS,
  DECISION_STAGES,
  DECISION_THRESHOLD_DEFAULTS,
  judgeAmazonRetailRisk,
  judgeBuyDecision,
  judgeDemandConfidence,
  SELLABILITY_ALONE_CAN_BUY,
  SELLABILITY_MODEL_V0_APPLIED,
  type BuyDecisionInput,
} from '../lib/phase4/decision';
import {
  checkFunnelBeforeScaling,
  computeKpis,
  DROP_REASONS,
  DROP_REASON_ACTION_JA,
  DROP_REASON_JA,
  emptyFunnelCounts,
  FUNNEL_FIRST_BATCH_SIZE,
  FUNNEL_STEPS,
  KPI_KEYS,
  rankDropReasons,
} from '../lib/phase4/funnel';
import {
  FALSE_MATCH_IS_CRITICAL,
  FALSE_MATCH_REASON_REQUIRED,
  judgeMatchGate,
  LEGACY_MATCH_VERDICTS,
  MACHINE_VERDICT_OVERWRITTEN_BY_HUMAN,
  MATCH_GATES,
  MATCH_GATE_FROM_LEGACY,
  MATCH_GATE_REQUIRED_FOR_BUY,
  toMatchGate,
} from '../lib/phase4/matchgate';
import { calcRouteProfit, formatPriceWatch } from '../lib/phase4/route';
import {
  computeSellPrice,
  isSellPriceConfidentEnough,
  SELL_PRICE_CONFIDENCE_BY_SOURCE,
  SELL_PRICE_CONFIDENCE_MIN_FOR_BUY,
  SELL_PRICE_CROWDING_HAIRCUT_MAX,
  SELL_PRICE_HAIRCUT_DEFAULT,
  SELL_PRICE_SOURCES,
} from '../lib/phase4/sellprice';
import { buildFunnel, offerProductKey, type OfferRouteResult } from '../lib/phase4/store';
import {
  checkOfferLimit,
  checkSupplierUrl,
  looksLikeSampleRow,
  normalizeSupplierOffer,
  PHASE4_AUTO_ADVANCE_LIMIT,
  PHASE4_REAL_LISTING_IMPLEMENTED,
  PHASE4_REAL_PURCHASE_IMPLEMENTED,
  PHASE4_SUPPLIER_OFFER_LIMIT,
  SUPPLIER_CONNECTOR_IMPLEMENTED,
  SUPPLIER_CONNECTOR_KINDS,
  SUPPLIER_FIRST_PARTNER_FIXED,
  SUPPLIER_OFFER_FIELDS,
  SUPPLIER_SCRAPING_ALLOWED,
  SUPPLIER_URL_AI_GENERATION_ALLOWED,
  SUPPLIER_URL_REQUIRED_FOR_ANALYSIS,
  supplierCsvHeader,
  supplierCsvTemplate,
  type SupplierOffer,
} from '../lib/phase4/supplier';
import { SAMPLE_MARKERS } from '../lib/realdata';

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

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const readFile = (p: string) => fs.readFileSync(path.join(decodeURIComponent(ROOT), p), 'utf8');

/** コメントを取り除いた「実際のコードだけ」を返す（ルール64）。 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** lib/phase4 の純粋計算ファイル（画面へそのまま載せられる必要がある） */
const PURE_FILES = [
  'lib/phase4/amazoncost.ts',
  'lib/phase4/deepscan.ts',
  'lib/phase4/decision.ts',
  'lib/phase4/funnel.ts',
  'lib/phase4/matchgate.ts',
  'lib/phase4/route.ts',
  'lib/phase4/sellprice.ts',
  'lib/phase4/supplier.ts',
];

const ALL_PHASE4_FILES = [
  ...PURE_FILES,
  'lib/phase4/store.ts',
  'scripts/phase4-import.ts',
  'scripts/phase4-route.ts',
  'scripts/phase4-template.ts',
  'app/buy/SupplierRouteTable.tsx',
].filter((p) => fs.existsSync(path.join(decodeURIComponent(ROOT), p)));

/* ================================================================
 * 偽の行を作る道具（見本の印は絶対に入れない）
 * ================================================================ */

function fakeOffer(over: Partial<SupplierOffer & { id: number }> = {}) {
  const base: SupplierOffer & { id: number } = {
    id: 1,
    supplierName: 'P4ONLY 仕入先A',
    supplierProductId: 'P4ONLY001',
    productName: 'P4ONLY 商品A',
    brand: null,
    jan: null,
    ean: null,
    upc: null,
    modelNumber: null,
    color: null,
    size: null,
    condition: null,
    purchasePrice: 10000,
    shippingCostToUs: 0,
    stock: null,
    sourceProductUrl: null,
    observedAt: '2026-08-25T00:00:00.000Z',
    connectorKind: 'CSV_SUPPLIER_IMPORT',
    isSample: false,
  };
  return { ...base, ...over };
}

function decisionInput(over: Partial<BuyDecisionInput> = {}): BuyDecisionInput {
  const base: BuyDecisionInput = {
    matchGate: 'HIGH_CONFIDENCE',
    matchCandidateCount: 1,
    demand: { rankDrops30: 12, rankDrops90: 40, currentSalesRank: 5000, demandSignalConflict: false },
    conservativeNetProfit: 5000,
    conservativeRoi: 0.5,
    maxBuyPrice: 15000,
    purchasePrice: 10000,
    feeConfidenceSufficient: true,
    sellPriceConfidenceSufficient: true,
    amazonRetailPresent: 'NO',
    buyboxIsAmazon: 'NO',
    dataAgeHours: 3,
  };
  return { ...base, ...over };
}

function fakeRoute(over: Partial<OfferRouteResult> = {}): OfferRouteResult {
  const decision = judgeBuyDecision(decisionInput());
  const base: OfferRouteResult = {
    offer: fakeOffer(),
    asin: 'B000P4ONLY',
    matchScore: 90,
    matchGate: 'HIGH_CONFIDENCE',
    candidateCount: 1,
    candidates: [],
    humanVerdict: null,
    sellPrice: null,
    costs: null,
    profit: calcRouteProfit({
      purchasePrice: 10000,
      supplierShipping: 0,
      rawSellPrice: 30000,
      conservativeSellPrice: 28000,
      referralFeePercentage: 8,
      fbaFee: 500,
      ownFixedCost: 750,
      ownRateCost: 0.02,
      minNetProfit: 3000,
      minRoi: 0.15,
    }),
    decision,
    keepa: {
      rankDrops30: 12,
      monthlySoldAtLeast: null,
      offerCountNew: 4,
      keepaLastUpdate: null,
      dataAgeHours: 3,
    },
    canOpenSupplierPage: false,
    supplierUrlReasonJa: '',
    reasonJa: '',
  };
  return { ...base, ...over };
}

/* ================================================================ */

function main(): void {
  console.log('Phase 4（仕入価格 → Amazon販売のRoute検証）受け入れテスト');
  console.log('※ Keepa・仕入先・DBへは一切アクセスしません。\n');

  // ==============================================================
  console.log('■ 1. §3 仕入先の取り方（SUPPLIER_CONNECTOR）');
  {
    check(
      '手入力とCSV取り込みが用意されている',
      SUPPLIER_CONNECTOR_KINDS.includes('MANUAL_SUPPLIER_INPUT')
        && SUPPLIER_CONNECTOR_KINDS.includes('CSV_SUPPLIER_IMPORT'),
    );
    check(
      '動くのは手入力とCSVの2つだけで、残りは「まだ動かない」と書いてある',
      SUPPLIER_CONNECTOR_IMPLEMENTED.MANUAL_SUPPLIER_INPUT === true
        && SUPPLIER_CONNECTOR_IMPLEMENTED.CSV_SUPPLIER_IMPORT === true
        && SUPPLIER_CONNECTOR_KINDS.filter((k) => SUPPLIER_CONNECTOR_IMPLEMENTED[k]).length === 2,
    );
    check('自動取得（AUTHORIZED_CONNECTOR）はまだ動かない', SUPPLIER_CONNECTOR_IMPLEMENTED.AUTHORIZED_CONNECTOR === false);
    check('スクレイピングは許可されていない', SUPPLIER_SCRAPING_ALLOWED === false);
    check(
      'スクレイピングが「取り方」の名前にも入っていない',
      !SUPPLIER_CONNECTOR_KINDS.some((k) => /SCRAP|CRAWL/i.test(k)),
    );
    check('最初の仕入先を1社に固定していない（§25）', SUPPLIER_FIRST_PARTNER_FIXED === false);
    for (const f of ALL_PHASE4_FILES) {
      const src = codeOnly(readFile(f));
      check(`${f} に取得用の通信が無い`, !/\bfetch\(|axios|puppeteer|playwright|cheerio/i.test(src));
    }
  }

  // ==============================================================
  console.log('\n■ 2. §4 仕入先データの16項目（分からないものはNULL）');
  {
    check('項目がちょうど16個ある', SUPPLIER_OFFER_FIELDS.length === 16, `${SUPPLIER_OFFER_FIELDS.length}個`);
    const required = SUPPLIER_OFFER_FIELDS.filter((f) => f.required).map((f) => f.key);
    check(
      '空欄では受け取らないのは5項目だけ',
      required.length === 5
        && ['supplier_name', 'supplier_product_id', 'product_name', 'purchase_price', 'observed_at']
          .every((k) => required.includes(k)),
      required.join(' / '),
    );
    check(
      'JAN・型番・ブランド・在庫は空欄でよい（推測で埋めない）',
      ['jan', 'model_number', 'brand', 'stock'].every(
        (k) => SUPPLIER_OFFER_FIELDS.find((f) => f.key === k)?.required === false,
      ),
    );

    // 送料の空欄を0円にしない（ルール115）
    const blankShipping = normalizeSupplierOffer(
      {
        supplier_name: 'P4ONLY 仕入先A',
        supplier_product_id: 'P4ONLY002',
        product_name: 'P4ONLY 商品B',
        purchase_price: '12000',
        shipping_cost_to_us: '',
        observed_at: '2026-08-25T00:00:00.000Z',
      },
      'CSV_SUPPLIER_IMPORT',
    );
    check('送料が空欄なら null のまま（0円にしない）', blankShipping.offer?.shippingCostToUs === null);
    check(
      '送料が空欄だと「空欄のまま進みます」と本人に伝える',
      blankShipping.issues.some((i) => i.field === 'shipping_cost_to_us' && i.levelJa === '空欄のまま進みます'),
    );

    const zeroShipping = normalizeSupplierOffer(
      {
        supplier_name: 'P4ONLY 仕入先A',
        supplier_product_id: 'P4ONLY003',
        product_name: 'P4ONLY 商品C',
        purchase_price: '12000',
        shipping_cost_to_us: '0',
        observed_at: '2026-08-25T00:00:00.000Z',
      },
      'CSV_SUPPLIER_IMPORT',
    );
    check('送料0円は0円として受け取る（不明と別物）', zeroShipping.offer?.shippingCostToUs === 0);

    const noPrice = normalizeSupplierOffer(
      {
        supplier_name: 'P4ONLY 仕入先A',
        supplier_product_id: 'P4ONLY004',
        product_name: 'P4ONLY 商品D',
        purchase_price: '',
        observed_at: '2026-08-25T00:00:00.000Z',
      },
      'CSV_SUPPLIER_IMPORT',
    );
    check('仕入価格が空欄の行は受け取らない', noPrice.offer === null);
    check(
      '仕入価格が空欄なら「止まります」と伝える',
      noPrice.issues.some((i) => i.levelJa === '止まります'),
    );

    const shortJan = normalizeSupplierOffer(
      {
        supplier_name: 'P4ONLY 仕入先A',
        supplier_product_id: 'P4ONLY005',
        product_name: 'P4ONLY 商品E',
        jan: '1234',
        brand: 'N/A',
        purchase_price: '12000',
        observed_at: '2026-08-25T00:00:00.000Z',
      },
      'CSV_SUPPLIER_IMPORT',
    );
    check('8桁未満の数字はバーコードとして受け取らない', shortJan.offer?.jan === null);
    check('「N/A」のような空欄表現をブランド名にしない', shortJan.offer?.brand === null);

    check('CSVの見出しが16項目そろっている', supplierCsvHeader().split(',').length === 16);
    check(
      'CSVテンプレートに「推測で埋めない」と書いてある',
      /推測で埋めないでください/.test(supplierCsvTemplate()),
    );
    check(
      'CSVテンプレートに「0円と不明は別物」と書いてある',
      /0円.*不明|不明.*0/.test(supplierCsvTemplate()),
    );
  }

  // ==============================================================
  console.log('\n■ 3. §5 仕入先URL（無くても分析する・AIは作らない）');
  {
    check('URLが無くても分析を続ける', SUPPLIER_URL_REQUIRED_FOR_ANALYSIS === false);
    check('AIがURLを組み立てるのは禁止のまま', SUPPLIER_URL_AI_GENERATION_ALLOWED === false);

    const blank = checkSupplierUrl(null, false);
    check('URLが無ければ開かない', blank.canOpen === false && blank.url === null);
    check('URLが無くても「分析は続けられる」と書いてある', /分析はこのまま続けられます/.test(blank.reasonJa));

    check('URLの形になっていなければ開かない', checkSupplierUrl('これはURLではない', false).canOpen === false);
    check('http は開かない', checkSupplierUrl('http://example.com/item/1', false).canOpen === false);
    check(
      'ログイン情報が埋まったURLは開かない',
      checkSupplierUrl('https://user:pass@example.com/item/1', false).canOpen === false,
    );
    const ok = checkSupplierUrl('https://example.com/item/1', false);
    check('仕入先が出した https のURLだけ開く', ok.canOpen === true && ok.url !== null);
    check('開くだけで購入はしないと書いてある', /購入はしません/.test(ok.reasonJa));
    check('見本データのURLは開かない', checkSupplierUrl('https://example.com/item/1', true).canOpen === false);

    for (const f of ALL_PHASE4_FILES) {
      const src = codeOnly(readFile(f));
      check(`${f} にURLを組み立てる関数が無い`, !/buildUrl|makeUrl|generateUrl|composeUrl/i.test(src));
      check(`${f} にAmazonの商品URLを直書きしていない`, !/amazon\.co\.jp\/dp/i.test(src));
    }
  }

  // ==============================================================
  console.log('\n■ 4. 見本データが本物に混ざらない');
  {
    check('見本の印は既存の一覧を使い回している', SAMPLE_MARKERS.length > 0);
    check(
      '印が付いていれば見本と判定する',
      looksLikeSampleRow({ supplier_name: 'SAMPLE商店' }) === true
        && looksLikeSampleRow({ product_name: 'サンプル商品' }) === true
        && looksLikeSampleRow({ supplier_product_id: 'TEST-1' }) === true,
    );
    check(
      '印が無いものを見本にはしない（判定は片方向）',
      looksLikeSampleRow({ supplier_name: 'P4ONLY 仕入先A', product_name: 'P4ONLY 商品A' }) === false,
    );

    const marked = normalizeSupplierOffer(
      {
        supplier_name: 'サンプル仕入先',
        supplier_product_id: 'P4ONLY006',
        product_name: 'P4ONLY 商品F',
        purchase_price: '12000',
        observed_at: '2026-08-25T00:00:00.000Z',
      },
      'CSV_SUPPLIER_IMPORT',
    );
    check('印の付いた行は、指定が無くても見本として取り込む', marked.offer?.isSample === true);
    check(
      '見本にしたことを黙って直さず本人に伝える',
      marked.issues.some((i) => i.levelJa === '見本として入れます'),
    );
    check(
      '見本にしたことで取り込みを止めはしない',
      marked.offer !== null && !marked.issues.some((i) => i.levelJa === '止まります'),
    );

    // ファネルの分母から見本を外し、外した件数を必ず書く
    const report = buildFunnel([
      fakeRoute(),
      fakeRoute({ offer: fakeOffer({ id: 2, isSample: true }) }),
    ]);
    check('見本はファネルの分母に入れない', report.counts.SUPPLIER_OFFERS === 1);
    check('外した見本の件数を残している', report.excludedSamples === 1);
  }

  // ==============================================================
  console.log('\n■ 5. §6/§7 同じ商品かの門（Match Gate）');
  {
    check('門は3段階', MATCH_GATES.length === 3 && MATCH_GATES.includes('HIGH_CONFIDENCE'));
    check(
      '旧い言い方と1対1で対応している',
      LEGACY_MATCH_VERDICTS.every((v) => MATCH_GATES.includes(MATCH_GATE_FROM_LEGACY[v])),
    );
    check('MATCHED は言い切れる側', MATCH_GATE_FROM_LEGACY.MATCHED === 'HIGH_CONFIDENCE');
    check('MISMATCH は違う商品', MATCH_GATE_FROM_LEGACY.MISMATCH === 'REJECTED');
    check('知らない値は安全な側（人が確かめる）に寄せる', toMatchGate('なにこれ') === 'REVIEW_REQUIRED');
    check('空欄も人が確かめる側', toMatchGate(null) === 'REVIEW_REQUIRED');
    check('BUYに進めるのは言い切れた場合だけ', MATCH_GATE_REQUIRED_FOR_BUY === 'HIGH_CONFIDENCE');
    check('誤一致は重大事故のまま', FALSE_MATCH_IS_CRITICAL === true && FALSE_MATCH_REASON_REQUIRED === true);
    check('人の答えで機械の判定を上書きしない', MACHINE_VERDICT_OVERWRITTEN_BY_HUMAN === false);

    const many = judgeMatchGate({ verdict: 'NEEDS_HUMAN_CHECK', score: 60, candidateCount: 3 });
    check('候補が複数なら1件に決めない', many.gate === 'REVIEW_REQUIRED' && many.canProceedToBuy === false);
    check('候補が何件あるかを本人に見せる', /3件/.test(many.reasonJa));

    const human = judgeMatchGate({
      verdict: 'NEEDS_HUMAN_CHECK',
      score: 60,
      candidateCount: 2,
      humanVerdict: 'MATCHED',
    });
    check('人が確かめたら門は開く', human.gate === 'HIGH_CONFIDENCE' && human.canProceedToBuy === true);
    check('そのとき機械の判定は残すと書いてある', /機械の判定/.test(human.reasonJa));

    const humanNo = judgeMatchGate({
      verdict: 'MATCHED',
      score: 95,
      candidateCount: 1,
      humanVerdict: 'MISMATCH',
    });
    check('人が「違う商品」と言えば止まる', humanNo.gate === 'REJECTED' && humanNo.canProceedToBuy === false);

    const storeSrc = codeOnly(readFile('lib/phase4/store.ts'));
    check(
      '人の答えを機械の判定の列へ書き戻していない',
      !/UPDATE\s+asin_match_candidates[\s\S]{0,200}\bset\b[\s\S]{0,120}\bverdict\s*=/i.test(storeSrc),
    );
  }

  // ==============================================================
  console.log('\n■ 6. §8/§9 Amazon想定販売価格は2本立て');
  {
    check('値段の出どころは5種類', SELL_PRICE_SOURCES.length === 5);
    check('BuyBoxがあれば確からしさは高い', SELL_PRICE_CONFIDENCE_BY_SOURCE.BUYBOX === 'HIGH');
    check(
      'BuyBoxが無ければ別の確からしさにする（無理に埋めない）',
      SELL_PRICE_CONFIDENCE_BY_SOURCE.NEW_PRICE !== 'HIGH'
        && SELL_PRICE_CONFIDENCE_BY_SOURCE.AVG_NEW_90 !== 'HIGH'
        && SELL_PRICE_CONFIDENCE_BY_SOURCE.NONE === 'UNKNOWN',
    );

    const withBuybox = computeSellPrice({
      currentBuyBoxPrice: 30000,
      currentNewPrice: 31000,
      avgNewPrice30: 29000,
      avgNewPrice90: 32000,
      offerCountNew: 2,
    });
    check('素の値段はいちばん強い根拠を使う', withBuybox.rawExpectedSellPrice === 30000);
    check('確からしさは高い', withBuybox.confidence === 'HIGH');
    check('保守の値段は素の値段より必ず低い', (withBuybox.conservativeSellPrice ?? 0) < 30000);
    check('実績で補正した値段は必ず空欄（実成約データが無いため）', withBuybox.calibratedSellPrice === null);

    const noBuybox = computeSellPrice({
      currentBuyBoxPrice: null,
      currentNewPrice: null,
      avgNewPrice30: null,
      avgNewPrice90: 32000,
      offerCountNew: 2,
    });
    check('BuyBoxも新品価格も無ければ確からしさを下げる', noBuybox.confidence === 'LOW');
    check(
      'BuyBoxが無いほうが下げ幅は大きい',
      noBuybox.appliedHaircut > withBuybox.appliedHaircut,
    );

    const nothing = computeSellPrice({
      currentBuyBoxPrice: null,
      currentNewPrice: null,
      avgNewPrice30: null,
      avgNewPrice90: null,
    });
    check('手がかりが無ければ値段は空欄（0円にしない）', nothing.conservativeSellPrice === null && nothing.rawExpectedSellPrice === null);
    check('そのとき出どころは NONE', nothing.source === 'NONE' && nothing.confidence === 'UNKNOWN');

    const zeroPrice = computeSellPrice({
      currentBuyBoxPrice: 0,
      currentNewPrice: null,
      avgNewPrice30: null,
      avgNewPrice90: null,
    });
    check('0円は「値段が無い」として扱う', zeroPrice.source === 'NONE');

    const crowded = computeSellPrice({
      currentBuyBoxPrice: 30000,
      currentNewPrice: null,
      avgNewPrice30: null,
      avgNewPrice90: null,
      offerCountNew: 40,
    });
    check(
      '出品者が多いほど余計に下げる（上限あり）',
      crowded.appliedHaircut > SELL_PRICE_HAIRCUT_DEFAULT.HIGH
        && crowded.appliedHaircut <= SELL_PRICE_HAIRCUT_DEFAULT.HIGH + SELL_PRICE_CROWDING_HAIRCUT_MAX,
    );

    check('BUYに進める確からしさは中以上', SELL_PRICE_CONFIDENCE_MIN_FOR_BUY === 'MEDIUM');
    check(
      '低い・不明ではBUYに進めない',
      isSellPriceConfidentEnough('HIGH') && isSellPriceConfidentEnough('MEDIUM')
        && !isSellPriceConfidentEnough('LOW') && !isSellPriceConfidentEnough('UNKNOWN'),
    );

    const sellSrc = codeOnly(readFile('lib/phase4/sellprice.ts'));
    const calibratedValues = [...sellSrc.matchAll(/calibratedSellPrice\s*:\s*([A-Za-z0-9_.?]+)/g)]
      .map((m) => m[1]);
    check(
      'CALIBRATED を値で埋めている場所が無い（型の宣言以外はすべて null）',
      calibratedValues.length > 0 && calibratedValues.every((v) => v === 'null' || v === 'number'),
      calibratedValues.join(' / '),
    );
  }

  // ==============================================================
  console.log('\n■ 7. §10 Amazon側の費用と当社側の費用を混ぜない');
  {
    const fee = calcAmazonFees({ referralFeePercentage: 8, fbaPickAndPackFee: 500, sellPrice: 30000 });
    check('販売手数料は率から計算する', fee.referralFee === Math.ceil(30000 * 0.08));
    check('両方そろえば確からしさは VERIFIED', fee.confidence === 'VERIFIED');
    check('合計はAmazon側だけの合計', fee.totalAmazonFee === (fee.referralFee ?? 0) + (fee.fbaFee ?? 0));

    const missing = calcAmazonFees({ referralFeePercentage: null, fbaPickAndPackFee: 500, sellPrice: 30000 });
    check('率が取れなければ手数料は空欄（0で埋めない）', missing.referralFee === null && missing.totalAmazonFee === null);
    check('そのとき確からしさは VERIFIED ではない', missing.confidence !== 'VERIFIED');
    check('何が足りないかを書いている', missing.missingJa.length > 0);

    check('確からしさは3段階', FEE_CONFIDENCES.length === 3);
    check('BUYに進めるのは VERIFIED だけ', FEE_CONFIDENCE_MIN_FOR_BUY === 'VERIFIED');
    check(
      'PARTIAL・UNKNOWN ではBUYに進めない',
      isFeeConfidentEnough('VERIFIED') && !isFeeConfidentEnough('PARTIAL') && !isFeeConfidentEnough('UNKNOWN'),
    );

    const own = calcOwnCosts({ supplierShippingCost: null, sellPrice: 30000 });
    check('当社側の費目は6つ', OWN_COST_KEYS.length === 6 && own.items.length === 6);
    check(
      '当社側の費目はすべて設定から変えられる',
      OWN_COST_KEYS.every((k) => /^SUPPLIER_ROUTE_/.test(OWN_COST_SETTING_KEYS[k])),
    );
    check('返品の見込み損は必ず「仮置き」と印を付ける', own.items.find((i) => i.key === 'EXPECTED_RETURN_LOSS')?.assumed === true);
    check('仮置きが混ざっていることを画面で断れる', own.hasAssumed === true);
    check(
      '返品の見込み損は売値と率から出す',
      own.items.find((i) => i.key === 'EXPECTED_RETURN_LOSS')?.amount === Math.ceil(30000 * RETURN_LOSS_RATE_DEFAULT),
    );
    check(
      '納品送料などは既定値をそのまま使う',
      own.items.find((i) => i.key === 'INBOUND_SHIPPING')?.amount === OWN_COST_DEFAULTS.INBOUND_SHIPPING,
    );

    const both = combineCosts(fee, own);
    check('2つの箱を分けたまま持っている', both.amazonFee !== undefined && both.ownCost !== undefined);
    check('引かれる合計はAmazon側＋当社側', both.totalDeduction === (fee.totalAmazonFee ?? 0) + own.total);

    const brokenTotal = combineCosts(missing, own);
    check('Amazon側が欠けたら合計は出さない（0にしない）', brokenTotal.totalDeduction === null);
    check('出せない理由を書いている', /出せません/.test(brokenTotal.reasonJa));
  }

  // ==============================================================
  console.log('\n■ 8. §11/§12 利益8項目と「いくらまでなら買えるか」');
  {
    const r = calcRouteProfit({
      purchasePrice: 20000,
      supplierShipping: 500,
      rawSellPrice: 40000,
      conservativeSellPrice: 36000,
      referralFeePercentage: 10,
      fbaFee: 600,
      ownFixedCost: 750,
      ownRateCost: 0.02,
      minNetProfit: 3000,
      minRoi: 0.15,
    });
    check('① 仕入総額＝仕入価格＋仕入送料', r.totalAcquisitionCost === 20500);
    check('② 素の手取りが出ている', r.expectedNetReceipt !== null);
    check('③④ 保守の利益は素の利益より小さい', (r.conservativeNetProfit ?? 0) < (r.expectedNetProfit ?? 0));
    check('⑤⑥ ROIは利益÷仕入総額', Math.abs((r.conservativeRoi ?? 0) - (r.conservativeNetProfit ?? 0) / 20500) < 1e-9);
    check('⑦ 損益分岐の売値が出ている', (r.breakEvenSellPrice ?? 0) > 0);
    check('⑧ 買ってよい上限額が出ている', r.maxBuyPrice !== null);
    check('計算できたことを立てている', r.calculable === true);

    // 上限額は「利益額の条件」と「ROIの条件」の厳しいほうを採る
    const receipt = r.conservativeNetReceipt ?? 0;
    const byProfit = receipt - 3000;
    const byRoi = receipt / 1.15;
    check(
      '上限額は2つの条件の厳しいほうを採っている',
      r.maxBuyPrice === Math.floor(Math.min(byProfit, byRoi) - 500),
    );
    check(
      '上限額を超えていなければ差は0',
      r.priceGapToBuyable === Math.max(0, 20000 - (r.maxBuyPrice ?? 0)),
    );

    const noFee = calcRouteProfit({
      purchasePrice: 20000,
      supplierShipping: 500,
      rawSellPrice: 40000,
      conservativeSellPrice: 36000,
      referralFeePercentage: null,
      fbaFee: 600,
      ownFixedCost: 750,
      ownRateCost: 0.02,
      minNetProfit: 3000,
      minRoi: 0.15,
    });
    check('手数料が欠けたら利益は出さない', noFee.conservativeNetProfit === null && noFee.calculable === false);
    check('そのとき上限額も出さない', noFee.maxBuyPrice === null);
    check('仮の手数料で埋めないと書いてある', /仮の数字で埋めることはしません/.test(noFee.reasonJa));

    const noShipping = calcRouteProfit({
      purchasePrice: 20000,
      supplierShipping: null,
      rawSellPrice: 40000,
      conservativeSellPrice: 36000,
      referralFeePercentage: 10,
      fbaFee: 600,
      ownFixedCost: 750,
      ownRateCost: 0.02,
      minNetProfit: 3000,
      minRoi: 0.15,
    });
    check('仕入送料が不明なまま計算したことを立てている', noShipping.acquisitionCostIncomplete === true);
    check('不明のまま計算したと画面に書く', /仕入送料が不明/.test(noShipping.reasonJa));

    const brokenRate = calcRouteProfit({
      purchasePrice: 20000,
      supplierShipping: 0,
      rawSellPrice: 40000,
      conservativeSellPrice: 36000,
      referralFeePercentage: 120,
      fbaFee: 600,
      ownFixedCost: 750,
      ownRateCost: 0.02,
      minNetProfit: 3000,
      minRoi: 0.15,
    });
    check('手数料の設定が壊れていたら計算を止める', brokenRate.calculable === false && brokenRate.maxBuyPrice === null);

    const expensive = calcRouteProfit({
      purchasePrice: 52000,
      supplierShipping: 0,
      rawSellPrice: 40000,
      conservativeSellPrice: 36000,
      referralFeePercentage: 10,
      fbaFee: 600,
      ownFixedCost: 750,
      ownRateCost: 0.02,
      minNetProfit: 3000,
      minRoi: 0.15,
    });
    check('高すぎる仕入は赤字になる', (expensive.conservativeNetProfit ?? 0) < 0);
    check('あといくら下がればよいかを出す', (expensive.priceGapToBuyable ?? 0) > 0);

    const watch = formatPriceWatch(52000, 45300);
    check('§12の画面表示が作れる', /52,000円/.test(watch.purchasePriceJa) && /45,300円/.test(watch.maxBuyPriceJa));
    check('あといくら下がればよいかを日本語で出す', /6,700円/.test(watch.gapJa));
    check('上限が出せないときは「計算できません」と書く', /計算できません/.test(formatPriceWatch(52000, null).maxBuyPriceJa));
  }

  // ==============================================================
  console.log('\n■ 9. §13/§14 BUY判定v0（透明なルール・売れるだけでは買わない）');
  {
    check('判定は4種類', BUY_DECISIONS.length === 4 && BUY_DECISIONS.includes('WATCH'));
    check('段階は4つ', DECISION_STAGES.length === 4);
    check('「売れるから買う」を禁止する印がある', SELLABILITY_ALONE_CAN_BUY === false);
    check(
      'しきい値はすべて設定から変えられる',
      Object.values(DECISION_SETTING_KEYS).every((k) => /^SUPPLIER_ROUTE_/.test(String(k))),
    );
    check(
      'しきい値の既定値がそろっている',
      DECISION_THRESHOLD_DEFAULTS.minNetProfit === 3000 && DECISION_THRESHOLD_DEFAULTS.minRoi === 0.15,
    );

    const buy = judgeBuyDecision(decisionInput());
    check('条件がそろえばBUY', buy.decision === 'BUY' && buy.stoppedAt === null && buy.dropReason === null);
    check('なぜそうなったかを1つずつ残している', buy.checks.length >= 4);

    // 売れていても赤字ならBUYにしない
    const loss = judgeBuyDecision(decisionInput({
      conservativeNetProfit: -5000,
      conservativeRoi: -0.5,
      maxBuyPrice: 4000,
      purchasePrice: 10000,
    }));
    check('よく売れていても赤字ならBUYにしない', loss.decision !== 'BUY');
    check('止まった段階は「利益」', loss.stoppedAt === 'PROFITABILITY');
    check('落ちた理由は赤字', loss.dropReason === 'LOSS_MAKING');

    const nearMiss = judgeBuyDecision(decisionInput({
      conservativeNetProfit: 1000,
      conservativeRoi: 0.05,
      maxBuyPrice: 9000,
      purchasePrice: 10000,
    }));
    check('あと少しで届くものは消さずに様子見にする', nearMiss.decision === 'WATCH');
    check('そのとき理由は「利益が基準に届かない」', nearMiss.dropReason === 'ROI_TOO_LOW');

    const farMiss = judgeBuyDecision(decisionInput({
      conservativeNetProfit: 1000,
      conservativeRoi: 0.05,
      maxBuyPrice: 9000,
      purchasePrice: 100000,
    }));
    check('差が大きすぎるものは見送る', farMiss.decision === 'SKIP');

    const staleData = judgeBuyDecision(decisionInput({ dataAgeHours: 24 * 30 }));
    check('データが古ければ判断を保留する', staleData.decision === 'REVIEW' && staleData.dropReason === 'STALE_DATA');

    const noDemand = judgeBuyDecision(decisionInput({
      demand: { rankDrops30: null, rankDrops90: null, currentSalesRank: null, demandSignalConflict: null },
    }));
    check('売れているか分からなければBUYにしない', noDemand.decision === 'REVIEW' && noDemand.dropReason === 'DEMAND_UNKNOWN');

    const weakSell = judgeBuyDecision(decisionInput({ sellPriceConfidenceSufficient: false }));
    check('売値の根拠が弱ければ利益を判断しない', weakSell.decision === 'REVIEW' && weakSell.dropReason === 'AMAZON_DATA_MISSING');

    const noFee = judgeBuyDecision(decisionInput({ feeConfidenceSufficient: false }));
    check('手数料がそろわなければ利益を判断しない', noFee.decision === 'REVIEW' && noFee.dropReason === 'FEE_UNKNOWN');

    const decisionSrc = codeOnly(readFile('lib/phase4/decision.ts'));
    check('判定にAIモデルを使っていない（透明なルールだけ）', !/anthropic|openai|claude|gpt-|messages\.create/i.test(decisionSrc));
    check('判定に乱数を使っていない', !/Math\.random/.test(decisionSrc));
  }

  // ==============================================================
  console.log('\n■ 10. §15/§16 食い違い・Amazon本体はいきなり見送らない');
  {
    const th = DECISION_THRESHOLD_DEFAULTS;
    const conflict = judgeDemandConfidence(
      { rankDrops30: 12, rankDrops90: 40, currentSalesRank: 5000, demandSignalConflict: true },
      th,
    );
    check('需要の手がかりが食い違ったら「弱い」にする', conflict.confidence === 'LOW');
    check('食い違いを「需要が無い」にはしない', conflict.confidence !== 'UNKNOWN');

    const conflictDecision = judgeBuyDecision(decisionInput({
      demand: { rankDrops30: 12, rankDrops90: 40, currentSalesRank: 5000, demandSignalConflict: true },
    }));
    check('食い違いは即SKIPにしない（様子見）', conflictDecision.decision === 'WATCH' && conflictDecision.stoppedAt === 'RISK');
    check('そのとき落ちた理由は付けない（脱落ではない）', conflictDecision.dropReason === null);

    check('Amazon本体は即SKIPの理由にしない', AMAZON_RETAIL_RISK_CAUSES_SKIP === false);
    check('カートを取っていれば DOMINANT', judgeAmazonRetailRisk('YES', 'YES') === 'DOMINANT');
    check('出品しているだけなら PRESENT', judgeAmazonRetailRisk('YES', 'NO') === 'PRESENT');
    check('出品していなければ NONE', judgeAmazonRetailRisk('NO', 'NO') === 'NONE');
    check('分からなければ UNKNOWN（NONEにしない）', judgeAmazonRetailRisk(null, null) === 'UNKNOWN');

    const dominant = judgeBuyDecision(decisionInput({ amazonRetailPresent: 'YES', buyboxIsAmazon: 'YES' }));
    check('Amazon本体がカートを取っていても見送らず様子見', dominant.decision === 'WATCH' && dominant.stoppedAt === 'RISK');

    const present = judgeBuyDecision(decisionInput({ amazonRetailPresent: 'YES', buyboxIsAmazon: 'NO' }));
    check('本体が出品しているだけならBUYを止めない', present.decision === 'BUY');
  }

  // ==============================================================
  console.log('\n■ 11. §23 落ちた理由を書き分ける（次にやることが違うため）');
  {
    check('落ちた理由はちょうど10分類', DROP_REASONS.length === 10);
    check(
      '10分類すべてに日本語と「次にやること」がある',
      DROP_REASONS.every((r) => DROP_REASON_JA[r] && DROP_REASON_ACTION_JA[r]),
    );

    const none = judgeBuyDecision(decisionInput({ matchGate: 'REJECTED', matchCandidateCount: 0 }));
    check('候補0件は「Amazon側に見つからない」', none.dropReason === 'NO_ASIN' && none.decision === 'SKIP');

    const wrong = judgeBuyDecision(decisionInput({ matchGate: 'REJECTED', matchCandidateCount: 1 }));
    check('候補はあるが違う商品なら「一致が弱い」', wrong.dropReason === 'LOW_MATCH' && wrong.decision === 'SKIP');

    const one = judgeBuyDecision(decisionInput({ matchGate: 'REVIEW_REQUIRED', matchCandidateCount: 1 }));
    check('候補1件で決め手が無ければ「一致が弱い」', one.dropReason === 'LOW_MATCH' && one.decision === 'REVIEW');

    const multi = judgeBuyDecision(decisionInput({ matchGate: 'REVIEW_REQUIRED', matchCandidateCount: 3 }));
    check('候補が2件以上なら「複数あって決められない」', multi.dropReason === 'MULTIPLE_ASIN' && multi.decision === 'REVIEW');
    check('候補が1件の行に「複数から選べ」と書かない', one.dropReason !== 'MULTIPLE_ASIN');

    const ranked = rankDropReasons({ LOW_MATCH: 2, NO_ASIN: 5, FEE_UNKNOWN: 2 });
    check('多い順に並ぶ', ranked[0]?.reason === 'NO_ASIN');
    check('同数のときは分類の並び順を保つ', ranked[1]?.reason === 'LOW_MATCH' && ranked[2]?.reason === 'FEE_UNKNOWN');
    check('0件の理由は並べない', rankDropReasons({}).length === 0);
  }

  // ==============================================================
  console.log('\n■ 12. §22/§24 ファネルとKPI（途中で増えない・分母0は0%にしない）');
  {
    check('工程は6段階', FUNNEL_STEPS.length === 6);
    check('KPIは4つ', KPI_KEYS.length === 4);

    const empty = computeKpis(emptyFunnelCounts());
    check('1件も無いときKPIは0%ではなく空欄', empty.every((k) => k.rate === null));
    check('そのとき画面には「まだ1件も通っていません」と出す', empty.every((k) => /まだ1件も通っていません/.test(k.displayJa)));

    const report = buildFunnel([
      fakeRoute(),
      fakeRoute({
        offer: fakeOffer({ id: 2 }),
        candidateCount: 0,
        matchGate: 'REJECTED',
        decision: judgeBuyDecision(decisionInput({ matchGate: 'REJECTED', matchCandidateCount: 0 })),
      }),
      fakeRoute({
        offer: fakeOffer({ id: 3 }),
        candidateCount: 3,
        matchGate: 'REVIEW_REQUIRED',
        decision: judgeBuyDecision(decisionInput({ matchGate: 'REVIEW_REQUIRED', matchCandidateCount: 3 })),
      }),
      fakeRoute({
        offer: fakeOffer({ id: 4 }),
        decision: judgeBuyDecision(decisionInput({
          demand: { rankDrops30: null, rankDrops90: null, currentSalesRank: null, demandSignalConflict: null },
        })),
      }),
    ]);

    const c = report.counts;
    check('工程の人数は途中で増えない',
      c.SUPPLIER_OFFERS >= c.ASIN_CANDIDATES
      && c.ASIN_CANDIDATES >= c.HIGH_MATCH
      && c.HIGH_MATCH >= c.AMAZON_DATA
      && c.AMAZON_DATA >= c.PROFIT_CALCULABLE
      && c.PROFIT_CALCULABLE >= c.BUY_OR_WATCH,
      JSON.stringify(c),
    );
    check('KPIが100%を超えない', computeKpis(c).every((k) => k.rate === null || k.rate <= 1));
    check(
      '早く落ちた行の理由も必ず数える',
      (report.drops.NO_ASIN ?? 0) === 1
      && (report.drops.MULTIPLE_ASIN ?? 0) === 1
      && (report.drops.DEMAND_UNKNOWN ?? 0) === 1,
      JSON.stringify(report.drops),
    );
    check('落ちた理由の合計が、落ちた件数と食い違わない',
      Object.values(report.drops).reduce((a, b) => a + (b ?? 0), 0) >= 3);

    const kpis = computeKpis(c);
    const matchRate = kpis.find((k) => k.key === 'SUPPLIER_TO_ASIN_MATCH_RATE');
    check('「仕入先→同じ商品」の分母は仕入候補の件数', matchRate?.denominator === c.SUPPLIER_OFFERS);
    check('その分子は言い切れた件数', matchRate?.numerator === c.HIGH_MATCH);
  }

  // ==============================================================
  console.log('\n■ 13. §21 まず10件（自動で増やさない）');
  {
    check('最初の上限は10件', PHASE4_SUPPLIER_OFFER_LIMIT === 10 && FUNNEL_FIRST_BATCH_SIZE === 10);
    check('上限を自動で増やさない', PHASE4_AUTO_ADVANCE_LIMIT === false);
    check('10件までは受け取る', checkOfferLimit(8, 2).ok === true);
    check('11件目は止める', checkOfferLimit(10, 1).ok === false);
    check('止めた理由と、増やすのは本人が決めることを書く', /ご本人が決めて/.test(checkOfferLimit(10, 1).messageJa));

    const few = emptyFunnelCounts();
    few.SUPPLIER_OFFERS = 4;
    check('10件に満たないうちは立ち止まらない', checkFunnelBeforeScaling(few).shouldStop === false);

    const ten = emptyFunnelCounts();
    ten.SUPPLIER_OFFERS = 10;
    ten.HIGH_MATCH = 6;
    check('10件通したら必ず立ち止まる', checkFunnelBeforeScaling(ten).shouldStop === true);

    const bad = emptyFunnelCounts();
    bad.SUPPLIER_OFFERS = 10;
    bad.HIGH_MATCH = 1;
    const badCheck = checkFunnelBeforeScaling(bad);
    check('一致率が低いときは、先に仕入先データを直せと言う', badCheck.shouldStop === true && /仕入先データ/.test(badCheck.reasonJa));

    const importSrc = codeOnly(readFile('scripts/phase4-import.ts'));
    check('取り込みスクリプトが上限を見ている', /PHASE4_SUPPLIER_OFFER_LIMIT/.test(importSrc));
    check('残りの枠を数えている', /PHASE4_SUPPLIER_OFFER_LIMIT\s*-\s*/.test(importSrc));
    check('残り枠を超えた行は取り込まない', /slice\(\s*0\s*,\s*room\s*\)/.test(importSrc));
    check('上限の数字をスクリプト側で書き換えていない', !/PHASE4_SUPPLIER_OFFER_LIMIT\s*=/.test(importSrc));
  }

  // ==============================================================
  console.log('\n■ 14. §18〜§20 Deep Scan（赤字には枠を使わない・実行はしない）');
  {
    const ok = checkDeepScanGate({
      matchGate: 'HIGH_CONFIDENCE',
      conservativeNetProfit: 5000,
      conservativeRoi: 0.5,
      demandConfidence: 'HIGH',
      dataAgeHours: 3,
      minRoi: 0.15,
      maxDataAgeHours: 24 * 7,
    });
    check('条件がそろえば追加調査の候補になる', ok.eligible === true && ok.failedJa.length === 0);

    const lossGate = checkDeepScanGate({
      matchGate: 'HIGH_CONFIDENCE',
      conservativeNetProfit: -1000,
      conservativeRoi: -0.1,
      demandConfidence: 'HIGH',
      dataAgeHours: 3,
      minRoi: 0.15,
      maxDataAgeHours: 24 * 7,
    });
    check('赤字は追加調査の候補にしない', lossGate.eligible === false);
    check('何が足りないかを書いている', lossGate.failedJa.length > 0);

    const notMatched = checkDeepScanGate({
      matchGate: 'REVIEW_REQUIRED',
      conservativeNetProfit: 5000,
      conservativeRoi: 0.5,
      demandConfidence: 'HIGH',
      dataAgeHours: 3,
      minRoi: 0.15,
      maxDataAgeHours: 24 * 7,
    });
    check('同じ商品と言い切れないものは調べない', notMatched.eligible === false);

    check('基準に近いかどうかの幅は仮置きと分かる形で持つ', DEEP_SCAN_ROI_NEAR_RATIO > 0 && DEEP_SCAN_ROI_NEAR_RATIO < 1);

    const lossValue = calcDeepScanValue({
      conservativeNetProfit: -1000,
      tokenCost: 5,
      tokenUnitCostJpy: 3,
      flipProbability: 0.3,
    });
    check('赤字なら追加調査の価値は0円', lossValue.valueJpy === 0 && lossValue.worthIt === false);
    check('その理由を日本語で書く', /どのみち赤字/.test(lossValue.reasonJa));

    const goodValue = calcDeepScanValue({
      conservativeNetProfit: 10000,
      tokenCost: 5,
      tokenUnitCostJpy: 3,
      flipProbability: 0.3,
    });
    check('利益が出るものは価値と費用を比べる', goodValue.valueJpy > goodValue.costJpy && goodValue.worthIt === true);

    check('Deep Scan の実行はまだ作っていない', DEEP_SCAN_EXECUTION_IMPLEMENTED === false);
    check('Deep Scan は自動で走らない', DEEP_SCAN_AUTO_RUN === false);
    const deepSrc = codeOnly(readFile('lib/phase4/deepscan.ts'));
    check('Deep Scan のファイルに取得の通信が無い', !/fetch\(|keepa/i.test(deepSrc));
  }

  // ==============================================================
  console.log('\n■ 15. §17/§29 BUY OPPORTUNITIES画面への統合');
  {
    const tsx = readFile('app/buy/SupplierRouteTable.tsx');
    const tsxCode = codeOnly(tsx);
    const columns = [
      '商品名', '仕入先', '仕入価格', 'Amazon想定販売（保守）', 'Amazonの売れ行き',
      '30日の値下がり', '出品者数', 'Amazon本体', '保守の純利益', '保守のROI',
      '同じ商品か', 'データの確からしさ', '判定', '仕入先ページ',
    ];
    for (const col of columns) {
      check(`画面に「${col}」の列がある`, new RegExp(`<th[^>]*>${col}</th>`).test(tsx));
    }
    const headRow = (tsx.match(/<thead>[\s\S]*?<\/thead>/) ?? [''])[0];
    const headCells = [...headRow.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    check(
      '仕入候補の表は14列ちょうど（§17の項目がそろっている）',
      headCells.length === columns.length,
      `${headCells.length}列`,
    );
    check('列の並びが§17の順どおり', headCells.join('／') === columns.join('／'), headCells.join('／'));
    check('仕入先の商品ページを開く導線がある', tsx.includes('仕入先の商品ページを開く'));
    check(
      'リンク先は保存してあるURLだけ（組み立てない）',
      /href=\{[^}]*sourceProductUrl[^}]*\}/.test(tsxCode),
    );
    check('別タブで開き、参照元を渡さない', /rel="noopener noreferrer"/.test(tsxCode));
    check('開けないときは理由を出す', /supplierUrlReasonJa/.test(tsxCode));
    check('見本の件数を画面に断っている', /見本/.test(tsx));
    check('ファネルと落ちた理由を画面に出している', /rankDropReasons/.test(tsxCode) && /computeKpis/.test(tsxCode));
    check('この画面では保存しない（表示だけ）', /save:\s*false/.test(tsxCode));
    check('buy画面がこの表を読み込んでいる', readFile('app/buy/page.tsx').includes('SupplierRouteTable'));
    check(
      '既存の実市場一覧は消さずに残している（Multi-Venue Engineは維持）',
      readFile('app/buy/page.tsx').includes('buyOpportunities'),
    );
  }

  // ==============================================================
  console.log('\n■ 16. §28/§31/§32 まだやらないこと');
  {
    check('実購入はまだ作っていない', PHASE4_REAL_PURCHASE_IMPLEMENTED === false && AUTO_PURCHASE_IMPLEMENTED === false);
    check('実出品はまだ作っていない', PHASE4_REAL_LISTING_IMPLEMENTED === false);
    check('判定モデルv0を本番判定に使っていない', SELLABILITY_MODEL_V0_APPLIED === false);

    for (const f of ALL_PHASE4_FILES) {
      const src = codeOnly(readFile(f));
      check(`${f} にカート追加が無い`, !/addToCart|add_to_cart/i.test(src));
      check(`${f} に注文の実行が無い`, !/placeOrder|createOrder|submitOrder/i.test(src));
      check(`${f} に決済が無い`, !/charge\(|payment\.|stripe/i.test(src));
      check(`${f} に出品の実行が無い`, !/createListing|publishListing/i.test(src));
    }

    // 取得済み100件を消さない
    const storeSrc = codeOnly(readFile('lib/phase4/store.ts'));
    check('Keepaで取得済みの商品を消す処理が無い', !/DELETE\s+FROM\s+keepa_products/i.test(storeSrc));
    check(
      '消せるのは見本の行だけ',
      /DELETE\s+FROM\s+supplier_offers[\s\S]{0,80}is_sample\s*=\s*1/i.test(storeSrc),
    );
    for (const f of ALL_PHASE4_FILES) {
      const src = codeOnly(readFile(f));
      check(`${f} がKeepaの取得済みデータを消さない`, !/DELETE\s+FROM\s+keepa_/i.test(src));
    }
  }

  // ==============================================================
  console.log('\n■ 17. ルール37（画面へ載せられる形）とDBの受け皿');
  {
    for (const f of PURE_FILES) {
      const src = codeOnly(readFile(f));
      const imports = src.match(/^\s*import\s[\s\S]*?from\s+'([^']+)'/gm) ?? [];
      const froms = imports.map((s) => (s.match(/from\s+'([^']+)'/) ?? [])[1] ?? '');
      const bad = froms.filter((x) => x !== '../realdata');
      check(`${f} が余計な依存を持たない`, bad.length === 0, bad.join(' / '));
    }
    const realdata = codeOnly(readFile('lib/realdata.ts'));
    check('lib/realdata.ts 自体も依存を持たない', !/^\s*import\s/m.test(realdata));

    const schema = readFile('lib/db/schema.ts');
    check('仕入候補の表がある', /CREATE TABLE IF NOT EXISTS supplier_offers/.test(schema));
    check('ルート計算の記録の表がある', /CREATE TABLE IF NOT EXISTS supplier_offer_routes/.test(schema));
    check('実際に売れた結果の受け皿がある（§33）', /CREATE TABLE IF NOT EXISTS real_trade_results/.test(schema));
    check('同じ仕入候補を二重に入れない決まりがある', /UNIQUE\s*\(\s*supplier_name\s*,\s*supplier_product_id\s*,\s*observed_at\s*\)/.test(schema));
    check('ルート計算は上書きせず積み上げる', /UNIQUE\s*\(\s*offer_id\s*,\s*computed_at\s*\)/.test(schema));
    check('Amazon側の手数料と当社側の費用を別の列で持つ', /amazon_referral_fee/.test(schema) && /own_cost_total/.test(schema));
    const storeCode = codeOnly(readFile('lib/phase4/store.ts'));
    check('実績で補正した値段の列はある', /calibrated_sell_price/.test(schema));
    check(
      'その列へは必ず空欄を書き込む（保守価格を流用していない）',
      /conservativeSellPrice\s*\?\?\s*null\s*,\s*null\s*,/.test(storeCode),
    );
    check('実績で補正した値段を計算している場所が無い', !/calibratedSellPrice/.test(storeCode));
    check('購入・出品・決済の表は作っていない', !/CREATE TABLE[^\n]*(purchase_orders|listings_published|payments)/i.test(schema));

    check('人が答えた記録は既存の表と結び付ける', offerProductKey(7) === 'SUPPLIER:7');
  }

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 4（仕入価格 → Amazon販売のRoute検証）の受け入れ条件をすべて満たしています。');
  console.log('※ このテストは Keepa・仕入先・DB へ一切アクセスしません。');
  console.log('※ 仕入先URLが無くても分析は続きます。URLをAIが組み立てることはありません。');
  console.log('※ Amazon側の費用と当社側の費用は、最後まで分けたまま持ちます。');
  console.log('※ 実際の購入・出品・決済は、コードとして存在しません（買うのはご本人です）。');
}

main();
