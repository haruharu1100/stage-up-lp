/**
 * Phase 6（FIRST SUPPLIER CONNECTOR）の受け入れテスト。
 *
 * ------------------------------------------------------------------
 * 【このテストは外部へ一切アクセスしない】
 * Yahoo!へも、eBayへも、Keepaへも接続しない。DBにも書き込まない。
 * APIキーが無くても最後まで通る。
 *
 * ------------------------------------------------------------------
 * 【ここで潰しておきたい将来の事故】
 *
 *   1. 「禁止と書いていない」を根拠に、確認前の口を叩き始める
 *   2. UNKNOWN が、いつのまにか YES 側で数えられる
 *   3. 根拠（原文・出典・確認日）の無い判定が YES として通る
 *   4. 公式内で数字が矛盾しているのに、都合のいい方だけ残す
 *   5. 送料が分からない候補を、送料無料として利益計算する
 *   6. ポイントを現金として利益に足す
 *   7. 在庫が分からない候補が購入候補に並ぶ
 *   8. JANが一致しただけで「同じ商品」と確定する
 *   9. まとめ売りを単品として計算する
 *  10. 単純最安だけで仕入先を決める
 *  11. 最安以外の候補を捨てて、あとで探し直しになる
 *  12. 材料の無い軸に点が付き、分からない候補が上位に来る
 *  13. ファネルが途中で増える
 *  14. 分母0を0%と書く
 *  15. 商品ページURLをAIが組み立てる
 *  16. Phase 4 とは別の利益計算式が増える
 *  17. 輸入の費用が欠けたままBUYになる
 *  18. Connectorがつながった瞬間に47件全部へ通信する
 *  19. 自動購入・自動注文のコードが混入する
 *  20. 新しいファイルが依存を抱えて画面へバンドルできなくなる（ルール37）
 *
 * ------------------------------------------------------------------
 * ★ソース全文を正規表現で検査するときは、**先にコメントを取り除く**（ルール64）。
 * ★偽データに見本の印（SAMPLE / テスト / サンプル 等）は絶対に入れない。
 *   後片付け用の目印には P6ONLY を使う（ルール54）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { judgeMatchGate } from '../lib/phase4/matchgate';
import {
  buildPhase6Report,
  calcPhase6Kpis,
  checkFunnelMonotonic,
  displayableKpis,
  DROPOUT_MEANS_WATCH,
  DROPOUT_REASONS,
  emptyFunnel,
  FUNNEL_STAGES,
  PHASE6_KPIS,
  summarizeDropouts,
} from '../lib/phase6/funnel';
import {
  AUTO_ORDER_API_IMPLEMENTED,
  AUTO_PURCHASE_IMPLEMENTED as GATE_AUTO_PURCHASE,
  AUTO_SUPPLIER_RESEARCH as GATE_AUTO_RESEARCH,
  canFetchLive,
  CONTACT_VENUE_BY_AI_ALLOWED,
  EBAY_APP_TOKEN_ISSUE_LIMIT_PER_DAY,
  EBAY_BROWSE_LEGAL_CHECKS,
  EBAY_BROWSE_PER_SECOND_LIMIT_KNOWN,
  EBAY_CONTENT_MAY_BE_MIXED_WITH_OTHER_VENUES,
  EBAY_CONTENT_MAY_ENTER_AI_LEARNING,
  EBAY_JAPAN_MARKETPLACE_EXISTS,
  ANSWER_STATES,
  canPromoteToFirstLiveSupplier,
  effectiveAnswer,
  effectiveValue,
  evaluateLegalGate,
  firstLiveSupplier,
  FIRST_LIVE_SUPPLIER_MIN_CONDITIONS,
  FIRST_LIVE_SUPPLIER_READ_ONLY,
  FIRST_LIVE_SUPPLIER_STAGES,
  GATE_DISPLAY_STATES,
  HUMAN_TODOS,
  LEGAL_GATE_WAITING_PHASE,
  NEW_FEATURE_DEVELOPMENT_PAUSED,
  normalizeAnswerInput,
  OROSY_CHECKLIST_KEYS,
  supplierGateBoard,
  SUPPLIER_GATE_WAITING,
  ENTRY_GATE_BEFORE_LEGAL_GATE,
  SUPPLIER_ENTRY_GATE_STEPS,
  SUPPLIER_ENTRY_GATE_RESULTS,
  supplierEntryGateBoard,
  supplierEntryGateResult,
  supplierEntryGateStatus,
  canStartLegalGateResearch,
  NETSEA_ENTRY_QUESTIONS_JA,
  isLiveFetchAllowed,
  LEGAL_CHECK_DEFAULT,
  LEGAL_CHECK_KEYS,
  LEGAL_GATE_UNKNOWN_IS_NOT_YES,
  legalGateFor,
  liveFetchImplemented,
  minIntervalMs,
  SCRAPING_IMPLEMENTED,
  strictestRateLimitPerMinute,
  TRI_STATES,
  YAHOO_CREDIT_SHOWN_ON_INTERNAL_SCREEN,
  YAHOO_SHOPPING_LEGAL_CHECKS,
  YAHOO_SHOPPING_LIVE_FETCH_IMPLEMENTED,
  YAHOO_SHOPPING_OBLIGATIONS,
  YAHOO_SHOPPING_RATE_LIMIT_CONFLICT,
  YAHOO_SHOPPING_RATE_LIMITS,
  type LegalCheckItem,
} from '../lib/phase6/legalgate';
import {
  AI_ONLY_MATCH_ALLOWED,
  checkAxes,
  IMAGE_ONLY_MATCH_ALLOWED,
  judgeProductMatch,
  MATCH_AXES,
  readColors,
  readGeneration,
  readQuantity,
  readSet,
  readSize,
  SUSPICIOUSLY_CHEAP_RATIO,
} from '../lib/phase6/match';
import {
  AUTO_SUPPLIER_RESEARCH,
  buildSearchKeys,
  checkStageGate,
  currentStage,
  hasSearchableKey,
  LIVE_SUPPLIER_CONNECTOR_MAX,
  PHASE6_MAX_PRODUCTS,
  planSupplierSearch,
  SEARCH_KEY_KINDS,
  SEARCH_KEY_PRIORITY,
  STAGE_SIZES,
  SUPPLIER_QUEUE_STATES,
  WATCHING_IS_NOT_FAILURE,
  type QueueItem,
} from '../lib/phase6/queue';
import {
  CHEAPEST_ONLY_DECISION_ALLOWED,
  crossVenueView,
  DEFAULT_STALE_AFTER_HOURS,
  KEEP_ALL_CANDIDATES,
  landedCost,
  RANK_FACTOR_MAX,
  RANK_FACTORS,
  RANK_SCORE_MAX,
  rankSupplierCandidates,
  type RankCandidate,
} from '../lib/phase6/rank';
import {
  AUTO_PURCHASE_IMPLEMENTED as ROUTE_AUTO_PURCHASE,
  checkCrossBorderCosts,
  CROSS_BORDER_COST_FIELDS,
  judgeRouteConfidence,
  POINTS_ADDED_TO_PROFIT,
  pointsView,
  PURCHASE_IS_HUMAN_ONLY,
  runPhase6Route,
  type Phase6RouteInput,
} from '../lib/phase6/route';
import {
  availabilityFromInStock,
  AVAILABILITY_STATES,
  buildYahooSearchQuery,
  canBecomeBuyOpportunity,
  janOrNull,
  normalizeYahooHit,
  normalizeYahooResponse,
  numberOrNull,
  POINTS_COUNTED_AS_CASH,
  PRODUCT_URL_AI_GENERATION_ALLOWED,
  readExpectedPoints,
  readProductUrl,
  readShipping,
  SHIPPING_FREE_ASSUMED_WHEN_UNKNOWN,
  textOrNull,
  YAHOO_CART_ENDPOINT_IMPLEMENTED,
  YAHOO_CONNECTOR_CODE,
  YAHOO_FIELD_MAP,
  YAHOO_PURCHASE_ENDPOINT_IMPLEMENTED,
  YAHOO_READ_ONLY,
  YAHOO_SEARCH_RESULTS_MAX,
} from '../lib/phase6/yahoo';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
}

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const readFile = (p: string) => fs.readFileSync(path.join(decodeURIComponent(ROOT), p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(decodeURIComponent(ROOT), p));

/** コメントを取り除いた「実際のコードだけ」を返す（ルール64）。 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** 画面へそのまま載せられる必要があるファイル（何もimportしない）。 */
const PURE_FILES = [
  'lib/phase6/legalgate.ts',
  'lib/phase6/yahoo.ts',
  'lib/phase6/queue.ts',
  'lib/phase6/match.ts',
  'lib/phase6/rank.ts',
  'lib/phase6/funnel.ts',
];

/** 橋渡し。importしてよいのは「何もimportしていないファイル」だけ。 */
const BRIDGE_FILES = ['lib/phase6/route.ts'];

const ALL_PHASE6_FILES = [...PURE_FILES, ...BRIDGE_FILES];

const NOW = '2026-08-26T09:00:00.000Z';

/* ================================================================
 * 偽の仕入候補（見本の印は入れない。目印は P6ONLY）
 * ================================================================ */

function fakeCandidate(over: Partial<RankCandidate> = {}): RankCandidate {
  return {
    venueCode: 'YAHOO_SHOPPING',
    supplierName: 'P6ONLY_STORE',
    supplierProductId: 'P6ONLY-0001',
    productName: 'P6ONLY 携帯扇風機 ブラック 1個',
    purchasePrice: 3000,
    shippingCost: 500,
    availability: 'AVAILABLE',
    matchVerdict: 'HIGH_CONFIDENCE',
    storeRating: 4.5,
    storeReviewCount: 120,
    observedAt: '2026-08-26T08:00:00.000Z',
    sourceProductUrl: 'https://store.shopping.yahoo.co.jp/p6only/item.html',
    ...over,
  };
}

function fakeRouteInput(over: Partial<Phase6RouteInput> = {}): Phase6RouteInput {
  const ranked = rankSupplierCandidates([fakeCandidate()], { nowIso: NOW, staleAfterHours: DEFAULT_STALE_AFTER_HOURS });
  return {
    ranked: ranked.all[0],
    rawSellPrice: 9800,
    conservativeSellPrice: 9000,
    referralFeePercentage: 8,
    fbaFee: 500,
    ownFixedCost: 300,
    ownRateCost: 0.02,
    minNetProfit: 500,
    minRoi: 10,
    // Phase 4 の `DemandInput` をそのまま使う（Phase 6 で別の形を作らない）。
    demand: {
      rankDrops30: 40,
      rankDrops90: 120,
      currentSalesRank: 3000,
      demandSignalConflict: false,
    },
    amazonRetailPresent: 'false',
    buyboxIsAmazon: 'false',
    dataAgeHours: 2,
    matchGate: 'HIGH_CONFIDENCE',
    matchCandidateCount: 1,
    isCrossBorder: false,
    crossBorderCosts: {},
    expectedPoints: 30,
    ...over,
  };
}

/* ================================================================ */

function main(): void {
  console.log('\n========== Phase 6（FIRST SUPPLIER CONNECTOR）受け入れテスト ==========');

  // ================================================================
  section('1. ファイルが存在し、画面へそのまま載せられる（ルール37）');
  // ================================================================
  {
    for (const f of ALL_PHASE6_FILES) {
      check(`${f} がある`, exists(f));
    }

    for (const f of PURE_FILES) {
      const src = codeOnly(readFile(f));
      const hasValueImport = /(^|\n)\s*import\s+(?!type\b)/.test(src);
      check(`${f} は何もimportしていない`, !hasValueImport);
      check(`${f} は require を使っていない`, !/\brequire\s*\(/.test(src));
    }

    for (const f of BRIDGE_FILES) {
      const src = codeOnly(readFile(f));
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      check(`${f} の import はすべて相対パス`, imports.every((i) => i.startsWith('.')));
      // 依存ゼロのファイルだけを import しているか。
      // ★2026-08-26 修正（ルール64）：ここは当初「from '...' を全部」拾っていたが、
      //   `import type` は型だけの読み込みで、コンパイル時に消える＝画面へ何もバンドルされない。
      //   実際 route.ts は `import type { SupplierOffer } from '../phase4/supplier'` を持ち、
      //   supplier.ts 側には値のimportがあるため不合格になっていた。
      //   見張りたいのは「実行時に何が積まれるか」なので、値のimportだけを対象にする
      //   （PURE_FILES 側の判定が最初から `(?!type\b)` で型を除いているのと同じ考え方）。
      const valueImports = [...src.matchAll(/(^|\n)\s*import\s+(?!type\b)[^;]*?from\s+'([^']+)'/g)].map((m) => m[2]);
      for (const i of valueImports) {
        const target = path.normalize(path.join('lib/phase6', i)) + '.ts';
        if (!exists(target)) continue;
        const tsrc = codeOnly(readFile(target));
        check(`${f} が読む ${target} は依存ゼロ`, !/(^|\n)\s*import\s+(?!type\b)/.test(tsrc));
      }
    }
  }

  // ================================================================
  section('2. 通信コード・自動購入・無許可収集が存在しない');
  // ================================================================
  {
    for (const f of ALL_PHASE6_FILES) {
      const src = codeOnly(readFile(f));
      check(`${f} に fetch が無い`, !/\bfetch\s*\(/.test(src));
      check(`${f} に axios が無い`, !/axios/i.test(src));
      check(`${f} に puppeteer / playwright が無い`, !/(puppeteer|playwright)/i.test(src));
      check(`${f} に cheerio が無い`, !/cheerio/i.test(src));
      check(`${f} に URL組み立て関数が無い`, !/\b(buildUrl|makeUrl|generateUrl|composeUrl)\b/.test(src));
      check(`${f} に注文・カートの関数が無い`, !/\b(placeOrder|createOrder|addToCart|checkout)\b/i.test(src));
    }

    check('本番の取得コードは存在しない', YAHOO_SHOPPING_LIVE_FETCH_IMPLEMENTED === false);
    check('自動購入は実装されていない（門側）', GATE_AUTO_PURCHASE === false);
    check('自動購入は実装されていない（橋渡し側）', ROUTE_AUTO_PURCHASE === false);
    check('注文APIは実装されていない', AUTO_ORDER_API_IMPLEMENTED === false);
    check('購入は人だけが行う', PURCHASE_IS_HUMAN_ONLY === true);
    check('無許可の収集は実装されていない', SCRAPING_IMPLEMENTED === false);
    check('AIが市場へ問い合わせ連絡することは許していない', CONTACT_VENUE_BY_AI_ALLOWED === false);
    check('Yahoo口は読み取り専用', YAHOO_READ_ONLY === true);
    check('Yahoo購入の口は実装されていない', YAHOO_PURCHASE_ENDPOINT_IMPLEMENTED === false);
    check('Yahooカートの口は実装されていない', YAHOO_CART_ENDPOINT_IMPLEMENTED === false);
  }

  // ================================================================
  section('3. 利用可否の門（10項目・UNKNOWNをYESにしない）');
  // ================================================================
  {
    check('3値である', TRI_STATES.length === 3 && TRI_STATES.includes('UNKNOWN'));
    check('既定値は UNKNOWN', LEGAL_CHECK_DEFAULT === 'UNKNOWN');
    check('UNKNOWNをYES扱いしないと明記している', LEGAL_GATE_UNKNOWN_IS_NOT_YES === true);
    check('確認項目はちょうど10個', LEGAL_CHECK_KEYS.length === 10, `${LEGAL_CHECK_KEYS.length}件`);

    const required = [
      'API_EXISTS',
      'COMMERCIAL_USE_ALLOWED',
      'INTERNAL_BUSINESS_RESEARCH_ALLOWED',
      'PRICE_COMPARISON_ALLOWED',
      'DATA_STORAGE_ALLOWED',
      'AUTOMATED_RETRIEVAL_ALLOWED',
      'PRODUCT_URL_USE_ALLOWED',
      'AFFILIATE_REQUIRED_OR_OPTIONAL',
      'CREDIT_DISPLAY_REQUIRED',
      'RATE_LIMIT',
    ];
    for (const k of required) {
      check(`${k} を持っている`, (LEGAL_CHECK_KEYS as readonly string[]).includes(k));
    }

    check('Yahooの判定も10項目そろっている', YAHOO_SHOPPING_LEGAL_CHECKS.length === 10, `${YAHOO_SHOPPING_LEGAL_CHECKS.length}件`);

    for (const item of YAHOO_SHOPPING_LEGAL_CHECKS) {
      check(`${item.key} に根拠がある`, item.evidence.length > 0);
      for (const e of item.evidence) {
        check(`${item.key} の出典URLがhttps`, e.sourceUrl.startsWith('https://'));
        check(`${item.key} に確認日がある`, /^\d{4}-\d{2}-\d{2}$/.test(e.checkedAt));
        check(`${item.key} の引用が空でない`, e.quoteJa.trim().length > 0);
      }
    }

    // 根拠が無ければ YES と数えない
    const noEvidence: LegalCheckItem = {
      key: 'COMMERCIAL_USE_ALLOWED',
      labelJa: 'P6ONLY',
      kind: 'PERMISSION',
      value: 'YES',
      answerJa: null,
      evidence: [],
      noteJa: '',
    };
    check('根拠の無いYESはYESとして数えない', effectiveValue(noEvidence) === 'UNKNOWN');

    const gate = legalGateFor('YAHOO_SHOPPING');
    check('Yahooの門の判定が取れる', gate !== null);
    check('Yahooの門は BLOCKED', gate?.gate === 'BLOCKED');
    check('BLOCKEDの理由が書かれている', (gate?.reasonsJa.length ?? 0) > 0);
    check('商用利用が不明として挙がっている', gate?.unknownKeys.includes('COMMERCIAL_USE_ALLOWED') === true);
    check('社内利用が不明として挙がっている', gate?.unknownKeys.includes('INTERNAL_BUSINESS_RESEARCH_ALLOWED') === true);
    check('価格比較が不明として挙がっている', gate?.unknownKeys.includes('PRICE_COMPARISON_ALLOWED') === true);
    check('データ保存が不明として挙がっている', gate?.unknownKeys.includes('DATA_STORAGE_ALLOWED') === true);
    check('自動取得が不明として挙がっている', gate?.unknownKeys.includes('AUTOMATED_RETRIEVAL_ALLOWED') === true);
    check('商品URL利用が不明として挙がっている', gate?.unknownKeys.includes('PRODUCT_URL_USE_ALLOWED') === true);
    check('不明は6件', gate?.unknownKeys.length === 6, `${gate?.unknownKeys.length}件`);
    check('禁止と確認できた項目は0件', gate?.prohibitedKeys.length === 0);
    check('Yahooは本番取得を許可していない', isLiveFetchAllowed('YAHOO_SHOPPING') === false);

    // 調べていない市場は Fail Closed
    check('登録の無い市場は許可されない', isLiveFetchAllowed('P6ONLY_UNKNOWN_VENUE') === false);
    check('登録の無い市場の門は取れない', legalGateFor('P6ONLY_UNKNOWN_VENUE') === null);
    check('登録の無い市場の取得コードも無い', liveFetchImplemented('P6ONLY_UNKNOWN_VENUE') === false);

    const live = canFetchLive('YAHOO_SHOPPING');
    check('いま実際に通信してよいかは false', live.ok === false);
    check('通信できない理由が3つ挙がる', live.reasonsJa.length === 3, `${live.reasonsJa.length}件`);

    // アフィリエイトは任意と確定している
    const aff = YAHOO_SHOPPING_LEGAL_CHECKS.find((x) => x.key === 'AFFILIATE_REQUIRED_OR_OPTIONAL');
    check('アフィリエイトは任意と確定している', aff?.value === 'YES' && (aff?.answerJa ?? '').includes('任意'));

    // クレジット表示は義務。果たす実装を持っている
    const credit = YAHOO_SHOPPING_LEGAL_CHECKS.find((x) => x.key === 'CREDIT_DISPLAY_REQUIRED');
    check('クレジット表示は義務（YES）', credit?.value === 'YES');
    check('クレジット表示を果たす実装がある', YAHOO_SHOPPING_OBLIGATIONS.some((o) => o.key === 'CREDIT_DISPLAY_REQUIRED' && o.satisfied));
    check('社内画面にもクレジットを出す', YAHOO_CREDIT_SHOWN_ON_INTERNAL_SCREEN === true);
    check('未実装の義務は0件', gate?.unmetObligationKeys.length === 0);

    // 人がやる残作業が残っている
    check('人がやる問い合わせが残っている', HUMAN_TODOS.some((t) => t.venueCode === 'YAHOO_SHOPPING'));

    // ------------------------------------------------------------------
    // eBay（Browse API）— 第2の市場。同じ門を、同じ厳しさで通す
    // ------------------------------------------------------------------
    const ebay = legalGateFor('EBAY_BROWSE');
    check('eBayの門の判定が取れる', ebay !== null);
    check('eBayの門も BLOCKED', ebay?.gate === 'BLOCKED');
    check('eBayも本番取得を許可していない', isLiveFetchAllowed('EBAY_BROWSE') === false);
    check('eBayの取得コードも存在しない', liveFetchImplemented('EBAY_BROWSE') === false);
    check('eBayも実際には通信できない', canFetchLive('EBAY_BROWSE').ok === false);
    check('eBayの10項目がそろっている', EBAY_BROWSE_LEGAL_CHECKS.length === LEGAL_CHECK_KEYS.length);
    check(
      'eBayの全項目に根拠（原文・出典・確認日）がある',
      EBAY_BROWSE_LEGAL_CHECKS.every((c) => c.evidence.length > 0 && c.evidence.every((e) => e.quoteJa !== '' && e.sourceUrl.startsWith('https://') && e.checkedAt !== '')),
    );
    // 価格比較は「不明」ではなく「禁止と確認できた」側。ここを UNKNOWN に緩めない。
    check('eBayは価格比較が禁止側で挙がる', ebay?.prohibitedKeys.includes('PRICE_COMPARISON_ALLOWED') === true);
    check('eBayの商用利用は不明のまま', ebay?.unknownKeys.includes('COMMERCIAL_USE_ALLOWED') === true);
    // 条文が名指しで禁じている2点。フラグで有効化できる形にしない。
    check('eBayのデータをAI学習へ入れない', EBAY_CONTENT_MAY_ENTER_AI_LEARNING === false);
    check('eBayのデータを他市場と混ぜない', EBAY_CONTENT_MAY_BE_MIXED_WITH_OTHER_VENUES === false);
    check('eBayに日本の売り場が無いことを記録している', EBAY_JAPAN_MARKETPLACE_EXISTS === false);
    check('eBayの人がやる問い合わせが残っている', HUMAN_TODOS.some((t) => t.venueCode === 'EBAY_BROWSE'));
    // 合鍵の発行上限は「探す回数の上限」ではないので、間隔の計算へ混ぜない。
    check('eBayの間隔は1日5,000回から出す', ebay?.minIntervalMs === Math.ceil(60000 / (5000 / (24 * 60))));
    check('合鍵の発行上限は別に持つ', EBAY_APP_TOKEN_ISSUE_LIMIT_PER_DAY === 1000);
    check('1秒あたりの上限は不明として持つ', EBAY_BROWSE_PER_SECOND_LIMIT_KNOWN === false);
  }

  // ================================================================
  section('4. 門がすべてそろえば開く（作りっぱなしのBLOCKEDではない）');
  // ================================================================
  {
    const allYes: LegalCheckItem[] = YAHOO_SHOPPING_LEGAL_CHECKS.map((x) => ({
      ...x,
      value: 'YES',
      evidence: x.evidence.length > 0 ? x.evidence : [{ quoteJa: 'P6ONLY', sourceUrl: 'https://example.invalid/p6only', checkedAt: '2026-08-26' }],
    }));
    const opened = evaluateLegalGate({
      venueCode: 'P6ONLY_VENUE',
      labelJa: 'P6ONLY 検査用',
      checks: allYes,
      obligations: YAHOO_SHOPPING_OBLIGATIONS,
      rateLimits: YAHOO_SHOPPING_RATE_LIMITS,
    });
    check('すべてYESなら門は開く', opened.gate === 'ALLOWED');
    check('開いたときは間隔が出る', opened.minIntervalMs !== null);

    // 1つでもNOがあれば閉じる
    const oneNo = allYes.map((x) => (x.key === 'DATA_STORAGE_ALLOWED' ? { ...x, value: 'NO' as const } : x));
    const blockedByNo = evaluateLegalGate({
      venueCode: 'P6ONLY_VENUE',
      labelJa: 'P6ONLY 検査用',
      checks: oneNo,
      obligations: YAHOO_SHOPPING_OBLIGATIONS,
      rateLimits: YAHOO_SHOPPING_RATE_LIMITS,
    });
    check('1つでも禁止があれば閉じる', blockedByNo.gate === 'BLOCKED');
    check('禁止項目が記録される', blockedByNo.prohibitedKeys.includes('DATA_STORAGE_ALLOWED'));

    // 義務を果たしていなければ閉じる
    const blockedByObligation = evaluateLegalGate({
      venueCode: 'P6ONLY_VENUE',
      labelJa: 'P6ONLY 検査用',
      checks: allYes,
      obligations: [{ key: 'CREDIT_DISPLAY_REQUIRED', labelJa: 'クレジット表示', satisfied: false, howJa: '' }],
      rateLimits: YAHOO_SHOPPING_RATE_LIMITS,
    });
    check('義務を果たしていなければ閉じる', blockedByObligation.gate === 'BLOCKED');

    // 叩く間隔が分からなければ閉じる
    const blockedByRate = evaluateLegalGate({
      venueCode: 'P6ONLY_VENUE',
      labelJa: 'P6ONLY 検査用',
      checks: allYes,
      obligations: YAHOO_SHOPPING_OBLIGATIONS,
      rateLimits: [],
    });
    check('叩く間隔が分からなければ閉じる', blockedByRate.gate === 'BLOCKED');
  }

  // ================================================================
  section('5. 公式内で矛盾した数字を、矛盾のまま持ち、厳しい方で設計する（ルール70）');
  // ================================================================
  {
    check('矛盾していることを記録している', YAHOO_SHOPPING_RATE_LIMIT_CONFLICT === true);
    check('数字を3つとも残している', YAHOO_SHOPPING_RATE_LIMITS.length === 3, `${YAHOO_SHOPPING_RATE_LIMITS.length}件`);
    check('確かめられた数字がある', YAHOO_SHOPPING_RATE_LIMITS.some((r) => r.confirmedAt !== null));
    check('確かめられていない数字も残している', YAHOO_SHOPPING_RATE_LIMITS.some((r) => r.confirmedAt === null));
    const strict = strictestRateLimitPerMinute(YAHOO_SHOPPING_RATE_LIMITS);
    check('いちばん厳しい値を選ぶ', strict === 30, `${strict}`);
    check('間隔は2秒', minIntervalMs(strict) === 2000, `${minIntervalMs(strict)}`);
    check('材料が無ければ間隔は出さない', strictestRateLimitPerMinute([]) === null);
    check('0や負の値からは間隔を作らない', minIntervalMs(0) === null && minIntervalMs(-5) === null);
  }

  // ================================================================
  section('6. Yahooの答えを共通の形へ直す（存在しない項目はNULL）');
  // ================================================================
  {
    check('Connector名が決まっている', YAHOO_CONNECTOR_CODE === 'YAHOO_SHOPPING_READ_ONLY');
    check('取りたい項目が並んでいる', YAHOO_FIELD_MAP.length >= 13, `${YAHOO_FIELD_MAP.length}件`);
    check('確かめた項目と確かめていない項目を分けている', YAHOO_FIELD_MAP.some((f) => f.confirmed) && YAHOO_FIELD_MAP.some((f) => !f.confirmed));

    check('空文字はnull', textOrNull('') === null);
    check('「不明」はnull', textOrNull('不明') === null);
    check('空欄を0で埋めない', numberOrNull('') === null && numberOrNull(null) === null);
    check('数字は読む', numberOrNull('1,280円') === 1280);
    check('短すぎるコードはJANとして扱わない', janOrNull('1234') === null);
    check('JANは数字だけ残す', janOrNull('4901234-567890') === '4901234567890');

    const full = normalizeYahooHit(
      {
        code: 'p6only-0001',
        name: 'P6ONLY 携帯扇風機 ブラック 1個',
        janCode: '4901234567890',
        price: 3000,
        shipping: { code: '2', name: '条件付き送料無料' },
        inStock: true,
        url: 'https://store.shopping.yahoo.co.jp/p6only/item.html',
        seller: { name: 'P6ONLY_STORE' },
        image: { medium: 'https://item-shopping.c.yimg.jp/p6only.jpg' },
        review: { rate: 4.5, count: 120 },
        brand: { name: 'P6ONLYブランド' },
        genreCategory: { name: '家電' },
        point: { amount: 30 },
      },
      NOW,
    );
    check('読み取りに成功する', full.ok === true, full.errorsJa.join('/'));
    check('商品コードが入る', full.offer?.supplierProductId === 'p6only-0001');
    check('JANが入る', full.offer?.jan === '4901234567890');
    check('仕入価格が入る', full.offer?.purchasePrice === 3000);
    check('店舗名が入る', full.extras?.storeName === 'P6ONLY_STORE');
    check('カテゴリが入る', full.extras?.category === '家電');
    check('画像URLが入る', full.extras?.imageUrl !== null);
    check('レビューが入る', full.extras?.reviewRate === 4.5 && full.extras?.reviewCount === 120);
    check('観測日時が入る', full.offer?.observedAt === NOW);
    check('見本の印は付けない', full.offer?.isSample === false);
    check('取得手段は公式API', full.offer?.connectorKind === 'OFFICIAL_API');

    // 欠けているときはNULLのまま
    const sparse = normalizeYahooHit({ code: 'p6only-0002', name: 'P6ONLY 何か', price: 800 }, NOW);
    check('欠けた項目があっても読み取りは通る', sparse.ok === true);
    check('JANが無ければnull', sparse.offer?.jan === null);
    check('ブランドが無ければnull', sparse.offer?.brand === null);
    check('カテゴリが無ければnull', sparse.extras?.category === null);
    check('欠けた項目を記録している', (sparse.extras?.missingFields.length ?? 0) > 0);
    check('在庫が無ければUNKNOWN', sparse.extras?.availability === 'UNKNOWN');

    // 価格が無いものは候補にしない
    const noPrice = normalizeYahooHit({ code: 'p6only-0003', name: 'P6ONLY 価格なし' }, NOW);
    check('価格が無ければ候補にしない', noPrice.ok === false);
    check('価格が無い理由が書かれる', noPrice.errorsJa.some((e) => e.includes('価格')));

    const many = normalizeYahooResponse([{ code: 'a', name: 'P6ONLY A', price: 100 }, { name: 'こわれた行' }], NOW);
    check('壊れた1件で全部を落とさない', many.okCount === 1 && many.ngCount === 1);
    check('配列でなければ0件', normalizeYahooResponse('P6ONLY', NOW).results.length === 0);
  }

  // ================================================================
  section('7. 送料・在庫・ポイント・URLの扱い（§7 §12 §13 §14）');
  // ================================================================
  {
    check('送料不明を無料とみなさない（方針）', SHIPPING_FREE_ASSUMED_WHEN_UNKNOWN === false);
    const unknownShipping = readShipping(undefined);
    check('送料が無ければ金額はnull', unknownShipping.amount === null);
    check('送料が無ければ不明と記録する', unknownShipping.isUnknown === true);
    const codeOnlyShipping = readShipping({ code: '2', name: '条件付き送料無料' });
    check('区分だけでは金額を作らない', codeOnlyShipping.amount === null && codeOnlyShipping.isUnknown === true);
    const freeShipping = readShipping({ code: '1', name: '送料無料' });
    check('口が無料と明言したときだけ0円', freeShipping.amount === 0 && freeShipping.isUnknown === false);
    check('金額が返れば読む', readShipping(550).amount === 550);
    check('金額が入った形も読む', readShipping({ fee: 700 }).amount === 700);

    check('在庫は3値', AVAILABILITY_STATES.length === 3);
    check('trueは在庫あり', availabilityFromInStock(true) === 'AVAILABLE');
    check('falseは在庫なし', availabilityFromInStock(false) === 'OUT_OF_STOCK');
    check('分からなければUNKNOWN', availabilityFromInStock(undefined) === 'UNKNOWN');
    check('在庫ありだけが購入候補になれる', canBecomeBuyOpportunity('AVAILABLE') === true);
    check('在庫なしは購入候補にしない', canBecomeBuyOpportunity('OUT_OF_STOCK') === false);
    check('在庫不明は購入候補にしない', canBecomeBuyOpportunity('UNKNOWN') === false);

    check('ポイントを現金として扱わない（方針）', POINTS_COUNTED_AS_CASH === false);
    check('ポイントを利益に足さない（方針）', POINTS_ADDED_TO_PROFIT === false);
    const pts = readExpectedPoints({ amount: 120 });
    check('ポイントは別枠で持つ', pts.points === 120);
    check('ポイントは利益に足していない', pts.addedToProfit === false);
    check('ポイントの見せ方に注意書きがある', pointsView(120).noteJa.includes('利益には入れ'));

    check('AIがURLを作ることは許していない', PRODUCT_URL_AI_GENERATION_ALLOWED === false);
    check('URLが無ければnull', readProductUrl(undefined).url === null);
    check('URLが無い理由を残す', readProductUrl(undefined).reasonJa.includes('作らない'));
    check('httpは受け取らない', readProductUrl('http://example.invalid/x').ok === false);
    check('認証情報つきURLは受け取らない', readProductUrl('https://u:p@example.invalid/x').ok === false);
    check('正しいURLは受け取る', readProductUrl('https://store.shopping.yahoo.co.jp/p6only/item.html').ok === true);
  }

  // ================================================================
  section('8. 検索条件（JAN優先・在庫ありに絞る・上限あり）');
  // ================================================================
  {
    const q = buildYahooSearchQuery({ jan: '4901234567890', keywords: 'P6ONLY 扇風機' });
    check('JANがあればJANで探す', q?.janCode === '4901234567890' && q?.query === undefined);
    check('在庫ありに絞る', q?.inStock === true);
    const q2 = buildYahooSearchQuery({ jan: null, keywords: 'P6ONLY 扇風機' });
    check('JANが無ければ言葉で探す', q2?.query === 'P6ONLY 扇風機');
    check('材料が無ければ検索を作らない', buildYahooSearchQuery({ jan: null, keywords: null }) === null);
    const q3 = buildYahooSearchQuery({ jan: '4901234567890', results: 999 });
    check('受け取る件数に上限がある', q3?.results === YAHOO_SEARCH_RESULTS_MAX);
  }

  // ================================================================
  section('9. 待ち行列と探し方の優先順位（§8）');
  // ================================================================
  {
    check('探し方は5種類', SEARCH_KEY_KINDS.length === 5);
    check('JANがいちばん先', SEARCH_KEY_PRIORITY.JAN_EXACT === 1);
    check('EAN・UPCが2番目', SEARCH_KEY_PRIORITY.EAN_UPC_EXACT === 2);
    check('型番が3番目', SEARCH_KEY_PRIORITY.MODEL_EXACT === 3);
    check('ブランド＋型番が4番目', SEARCH_KEY_PRIORITY.BRAND_AND_MODEL === 4);
    check('商品名が5番目', SEARCH_KEY_PRIORITY.PRODUCT_NAME === 5);

    const keys = buildSearchKeys({
      asin: 'P6ONLYASIN',
      title: 'P6ONLY 携帯扇風機 ブラック',
      brand: 'P6ONLYブランド',
      modelNumber: 'PX-100',
      jan: '4901234567890',
      ean: '4901234567890',
      upc: null,
    });
    check('強い順に並ぶ', keys[0].kind === 'JAN_EXACT');
    check('同じ数字のEANを重ねて叩かない', !keys.some((k) => k.kind === 'EAN_UPC_EXACT'));
    check('型番も作る', keys.some((k) => k.kind === 'MODEL_EXACT'));
    check('ブランド＋型番も作る', keys.some((k) => k.kind === 'BRAND_AND_MODEL'));
    check('JANの強さはSTRONG', keys[0].strength === 'STRONG');
    check('商品名の強さはWEAK', keys.find((k) => k.kind === 'PRODUCT_NAME')?.strength === 'WEAK');

    const noKeys = buildSearchKeys({ asin: 'P6ONLYASIN2', title: null, brand: null, modelNumber: null, jan: null, ean: null, upc: null });
    check('材料が無ければ探し方を作らない', noKeys.length === 0);
    check('探しようが無い商品は探しに行かない', hasSearchableKey({ asin: 'x', title: null, brand: null, modelNumber: null, jan: null, ean: null, upc: null }) === false);

    check('待ち行列の状態にSUPPLIER_SEARCH_PENDINGがある', (SUPPLIER_QUEUE_STATES as readonly string[]).includes('SUPPLIER_SEARCH_PENDING'));
    check('門が閉じている状態を持っている', (SUPPLIER_QUEUE_STATES as readonly string[]).includes('SEARCH_BLOCKED'));
    check('見張る状態を持っている', (SUPPLIER_QUEUE_STATES as readonly string[]).includes('WATCHING'));
    check('見張るのは失敗ではない', WATCHING_IS_NOT_FAILURE === true);
  }

  // ================================================================
  section('10. 段階の門（1→5→10・いきなり47件へ通信しない）');
  // ================================================================
  {
    check('自動の仕入先検索はまだOFF', AUTO_SUPPLIER_RESEARCH === false);
    check('門側のスイッチもOFF', GATE_AUTO_RESEARCH === false);
    check('段は1→5→10', STAGE_SIZES.join(',') === '1,5,10');
    check('Phase 6の上限は10件', PHASE6_MAX_PRODUCTS === 10);
    check('本番でつなぐ市場は1つだけ', LIVE_SUPPLIER_CONNECTOR_MAX === 1);
    check('0件のときの段は1', currentStage(0) === 1);
    check('1件終わったら次の段は5', currentStage(1) === 5);
    check('5件終わったら次の段は10', currentStage(5) === 10);
    check('10件終わったら段は無い', currentStage(10) === null);

    const blocked = checkStageGate({
      completedProducts: 0,
      requestedProducts: 47,
      previousStageAudited: true,
      legalGateAllowed: false,
      liveFetchImplemented: false,
      liveConnectorCount: 0,
    });
    check('門が閉じていれば1件も進まない', blocked.allowed === false && blocked.allowedProducts === 0);
    check('進めない理由が書かれる', blocked.reasonsJa.length > 0);

    // 仮に全部そろっていても、47件は通らない
    const asIf = checkStageGate({
      completedProducts: 0,
      requestedProducts: 47,
      previousStageAudited: true,
      legalGateAllowed: true,
      liveFetchImplemented: true,
      liveConnectorCount: 1,
    });
    check('全部そろっても最初は1件まで（AUTO_SUPPLIER_RESEARCHがOFFのため0）', asIf.allowedProducts === 0);

    const audited = checkStageGate({
      completedProducts: 1,
      requestedProducts: 5,
      previousStageAudited: false,
      legalGateAllowed: true,
      liveFetchImplemented: true,
      liveConnectorCount: 1,
    });
    check('前の段を人が見ていなければ進まない', audited.allowedProducts === 0);
    check('見ていない理由が書かれる', audited.reasonsJa.some((r) => r.includes('確認')));

    const over = checkStageGate({
      completedProducts: 10,
      requestedProducts: 1,
      previousStageAudited: true,
      legalGateAllowed: true,
      liveFetchImplemented: true,
      liveConnectorCount: 1,
    });
    check('10件で止まる', over.allowed === false);
    check('10件で止める理由が書かれる', over.reasonsJa.some((r) => r.includes('10')));

    const tooMany = checkStageGate({
      completedProducts: 0,
      requestedProducts: 1,
      previousStageAudited: true,
      legalGateAllowed: true,
      liveFetchImplemented: true,
      liveConnectorCount: 2,
    });
    check('市場を2つ同時につながない', tooMany.allowed === false);

    const queue: QueueItem[] = Array.from({ length: 47 }, (_, i) => ({
      asin: `P6ONLY${String(i).padStart(4, '0')}`,
      state: 'SUPPLIER_SEARCH_PENDING' as const,
      source: { asin: `P6ONLY${i}`, title: `P6ONLY 商品${i}`, brand: null, modelNumber: null, jan: null, ean: null, upc: null },
      rankScore: i,
    }));
    const plan = planSupplierSearch(queue, {
      completedProducts: 0,
      requestedProducts: 47,
      previousStageAudited: true,
      legalGateAllowed: false,
      liveFetchImplemented: false,
      liveConnectorCount: 0,
    });
    check('47件あっても1件も通信しない', plan.items.length === 0);
    check('進めない理由が返る', plan.allowed === false && plan.reasonsJa.length > 0);

    const queueNoKey: QueueItem[] = [
      { asin: 'P6ONLY_NOKEY', state: 'SUPPLIER_SEARCH_PENDING', source: { asin: 'x', title: null, brand: null, modelNumber: null, jan: null, ean: null, upc: null }, rankScore: null },
    ];
    const plan2 = planSupplierSearch(queueNoKey, {
      completedProducts: 0,
      requestedProducts: 1,
      previousStageAudited: true,
      legalGateAllowed: true,
      liveFetchImplemented: true,
      liveConnectorCount: 1,
    });
    check('手がかりの無い商品は外す', plan2.skipped.length === 1);
  }

  // ================================================================
  section('11. 同じ商品かどうか（JAN一致だけで確定しない・§9）');
  // ================================================================
  {
    check('見る軸は5つ', MATCH_AXES.length === 5);
    check('AIの見立てだけでは確定しない', AI_ONLY_MATCH_ALLOWED === false);
    check('画像だけでは確定しない', IMAGE_ONLY_MATCH_ALLOWED === false);

    check('数量を読む', readQuantity('P6ONLY 洗剤 6個セット') === 6);
    check('×表記も読む', readQuantity('P6ONLY 洗剤 ×3') === 3);
    check('数量が無ければnull', readQuantity('P6ONLY 洗剤') === null);
    check('セット売りを見抜く', readSet('P6ONLY 洗剤 まとめ買い') === true);
    check('単品を見抜く', readSet('P6ONLY 洗剤 1個') === false);
    check('色を読む', readColors('P6ONLY 扇風機 ブラック').includes('BLACK'));
    check('黒とブラックを同じに扱う', readColors('P6ONLY 扇風機 黒').includes('BLACK'));
    check('サイズを読む', readSize('P6ONLY ボトル 500ml') === '500ml');
    check('世代を読む', readGeneration('P6ONLY イヤホン 第3世代') === 'gen3');
    check('年式も読む', readGeneration('P6ONLY 掃除機 2023年モデル') === 'year2023');

    const axes = checkAxes('P6ONLY 洗剤 1個', 'P6ONLY 洗剤 6個セット');
    check('数量の違いに気づく', axes.find((a) => a.axis === 'QUANTITY')?.result === 'DIFFERENT');
    check('セットの違いに気づく', axes.find((a) => a.axis === 'SET')?.result === 'DIFFERENT');
    check('読めない軸はUNKNOWN', axes.find((a) => a.axis === 'SIZE')?.result === 'UNKNOWN');

    const mismatch = judgeProductMatch({
      keyStrength: 'STRONG',
      identifierExact: true,
      amazonTitle: 'P6ONLY 洗剤 1個',
      supplierTitle: 'P6ONLY 洗剤 6個セット',
      supplierPrice: 3000,
      amazonSellPrice: 1200,
    });
    check('JANが一致してもまとめ売りなら別商品', mismatch.verdict === 'REJECTED');
    check('違う軸が記録される', mismatch.differentAxes.includes('QUANTITY'));

    const unclear = judgeProductMatch({
      keyStrength: 'STRONG',
      identifierExact: true,
      amazonTitle: 'P6ONLY 扇風機',
      supplierTitle: 'P6ONLY 扇風機',
      supplierPrice: 3000,
      amazonSellPrice: 9000,
    });
    check('数量が読めないJAN一致は確定しない', unclear.verdict === 'REVIEW_REQUIRED');

    const ok = judgeProductMatch({
      keyStrength: 'STRONG',
      identifierExact: true,
      amazonTitle: 'P6ONLY 扇風機 ブラック 1個 500ml',
      supplierTitle: 'P6ONLY 扇風機 ブラック 1個 500ml',
      supplierPrice: 5000,
      amazonSellPrice: 9000,
    });
    check('材料がそろえば同じ商品と判断する', ok.verdict === 'HIGH_CONFIDENCE');

    const weak = judgeProductMatch({
      keyStrength: 'WEAK',
      identifierExact: false,
      amazonTitle: 'P6ONLY 扇風機 ブラック 1個',
      supplierTitle: 'P6ONLY 扇風機 ブラック 1個',
      supplierPrice: 5000,
      amazonSellPrice: 9000,
    });
    check('商品名だけの一致は確定しない', weak.verdict === 'REVIEW_REQUIRED');

    const cheap = judgeProductMatch({
      keyStrength: 'STRONG',
      identifierExact: true,
      amazonTitle: 'P6ONLY 扇風機 ブラック 1個',
      supplierTitle: 'P6ONLY 扇風機 ブラック 1個',
      supplierPrice: 500,
      amazonSellPrice: 9000,
    });
    check('安すぎる候補は基準を上げる', cheap.cheapGuardApplied === true);
    check('安すぎる候補は確定しない', cheap.verdict === 'REVIEW_REQUIRED');
    check('安すぎの基準が決まっている', SUSPICIOUSLY_CHEAP_RATIO > 0 && SUSPICIOUSLY_CHEAP_RATIO < 1);

    // Phase 4 の門へそのまま渡せる
    const gate = judgeMatchGate({ verdict: ok.verdict, score: null, candidateCount: 1 });
    check('Phase 4 の門へそのまま渡せる', gate.gate === 'HIGH_CONFIDENCE' && gate.canProceedToBuy === true);
    const gate2 = judgeMatchGate({ verdict: mismatch.verdict, score: null, candidateCount: 1 });
    check('別商品はPhase 4 の門でも通らない', gate2.canProceedToBuy === false);
  }

  // ================================================================
  section('12. 候補の並べ方（最安だけで決めない・全部残す）');
  // ================================================================
  {
    check('最安だけで決めない（方針）', CHEAPEST_ONLY_DECISION_ALLOWED === false);
    check('全部残す（方針）', KEEP_ALL_CANDIDATES === true);
    check('見る軸は6つ', RANK_FACTORS.length === 6);
    check('満点は100点', Object.values(RANK_FACTOR_MAX).reduce((a, b) => a + b, 0) === RANK_SCORE_MAX);

    const l1 = landedCost(fakeCandidate({ purchasePrice: 3000, shippingCost: 500 }));
    check('総額は商品価格＋送料', l1.amount === 3500 && l1.incomplete === false);
    const l2 = landedCost(fakeCandidate({ purchasePrice: 3000, shippingCost: null }));
    check('送料不明でも0円を足さない', l2.amount === 3000);
    check('送料不明は不完全と記録する', l2.incomplete === true);
    check('送料不明の注意書きがある', l2.noteJa.includes('無料とはみなしていない'));

    const ctx = { nowIso: NOW, staleAfterHours: DEFAULT_STALE_AFTER_HOURS };

    // 最安だが在庫なし vs 少し高いが在庫あり
    const r = rankSupplierCandidates(
      [
        fakeCandidate({ supplierName: 'P6ONLY_A', purchasePrice: 2000, shippingCost: 0, availability: 'OUT_OF_STOCK' }),
        fakeCandidate({ supplierName: 'P6ONLY_B', purchasePrice: 2600, shippingCost: 0, availability: 'AVAILABLE' }),
      ],
      ctx,
    );
    check('最安でも在庫が無ければ先頭にしない', r.best?.candidate.supplierName === 'P6ONLY_B');
    check('候補を捨てない', r.all.length === 2);
    check('購入候補に上げられる件数を出す', r.eligibleCount === 1);

    // 一致が確定していない候補は購入候補にしない
    const r2 = rankSupplierCandidates(
      [fakeCandidate({ supplierName: 'P6ONLY_C', matchVerdict: 'REVIEW_REQUIRED' })],
      ctx,
    );
    check('一致が確定していなければ購入候補にしない', r2.best === null);
    check('それでも候補は残す', r2.all.length === 1);

    // 送料不明の候補は、分かっている候補より下
    const r3 = rankSupplierCandidates(
      [
        fakeCandidate({ supplierName: 'P6ONLY_D', purchasePrice: 2500, shippingCost: null }),
        fakeCandidate({ supplierName: 'P6ONLY_E', purchasePrice: 2600, shippingCost: 0 }),
      ],
      ctx,
    );
    check('送料が分かっている候補を上に置く', r3.all[0].candidate.supplierName === 'P6ONLY_E');
    check('送料不明は点を付けない', r3.all.find((x) => x.candidate.supplierName === 'P6ONLY_D')?.unknownFactors.includes('SHIPPING') === true);

    // 店舗評価が無い候補に点を付けない
    const r4 = rankSupplierCandidates([fakeCandidate({ storeRating: null, storeReviewCount: null })], ctx);
    check('店舗評価が無ければ点を付けない', r4.all[0].unknownFactors.includes('STORE'));
    check('その分は0点', r4.all[0].factors.find((f) => f.factor === 'STORE')?.score === 0);

    // 古いデータ
    const r5 = rankSupplierCandidates([fakeCandidate({ observedAt: '2026-08-20T00:00:00.000Z' })], ctx);
    check('古いデータは新しさの点が0', r5.all[0].factors.find((f) => f.factor === 'FRESHNESS')?.score === 0);
    check('古いことを理由に書く', r5.all[0].reasonsJa.some((x) => x.includes('古い')));

    check('候補0件でも落ちない', rankSupplierCandidates([], ctx).candidateCount === 0);
    check('候補0件のときは先頭も無い', rankSupplierCandidates([], ctx).best === null);

    // 将来の市場横断
    const cross = crossVenueView(
      rankSupplierCandidates(
        [fakeCandidate({ venueCode: 'YAHOO_SHOPPING' }), fakeCandidate({ venueCode: 'P6ONLY_OTHER_VENUE', purchasePrice: 2000, shippingCost: 0 })],
        ctx,
      ).all,
      { YAHOO_SHOPPING: 'Yahoo!ショッピング' },
    );
    check('市場ごとに並べ替えられる', cross.length === 2);
    check('市場ごとの最安が出る', cross.find((c) => c.venueCode === 'P6ONLY_OTHER_VENUE')?.bestLanded === 2000);
  }

  // ================================================================
  section('13. Phase 4 の利益計算へそのまま流す（式を増やさない）');
  // ================================================================
  {
    const src = codeOnly(readFile('lib/phase6/route.ts'));
    check('Phase 4 の利益計算を呼んでいる', /calcRouteProfit/.test(src));
    check('Phase 4 の判定を呼んでいる', /judgeBuyDecision/.test(src));
    check('自前の利益式を作っていない', !/conservativeNetProfit\s*=\s*[^n]/.test(src.replace(/profit\.conservativeNetProfit/g, '')));

    const res = runPhase6Route(fakeRouteInput());
    check('利益が計算できる', res.profit.calculable === true);
    check('保守の利益が出る', res.profit.conservativeNetProfit !== null);
    check('保守のROIが出る', res.profit.conservativeRoi !== null);
    check('買ってよい上限額が出る', res.profit.maxBuyPrice !== null);
    check('確からしさが出る', res.confidence.confidence === 'HIGH');
    check('ポイントは別枠で出る', res.points.expectedPoints === 30);

    // 手数料が欠けていれば計算しない
    const noFee = runPhase6Route(fakeRouteInput({ referralFeePercentage: null }));
    check('手数料が欠ければ利益を出さない', noFee.profit.calculable === false);
    check('手数料が欠ければBUYにしない', noFee.finalDecision !== 'BUY');
    check('落ちた理由が手数料', noFee.dropoutReason === 'FEE_UNKNOWN');

    // 送料が分からなければBUYにしない
    const noShip = runPhase6Route(
      fakeRouteInput({
        ranked: rankSupplierCandidates([fakeCandidate({ shippingCost: null })], { nowIso: NOW, staleAfterHours: DEFAULT_STALE_AFTER_HOURS }).all[0],
      }),
    );
    check('送料が分からなければBUYにしない', noShip.finalDecision !== 'BUY');
    check('確からしさが下がる', noShip.confidence.confidence !== 'HIGH');
    check('送料不明の理由が残る', noShip.confidence.reasonsJa.some((x) => x.includes('送料')));

    // 在庫が無ければBUYにしない
    const oos = runPhase6Route(
      fakeRouteInput({
        ranked: rankSupplierCandidates([fakeCandidate({ availability: 'OUT_OF_STOCK' })], { nowIso: NOW, staleAfterHours: DEFAULT_STALE_AFTER_HOURS }).all[0],
      }),
    );
    check('在庫が無ければBUYにしない', oos.finalDecision !== 'BUY');

    // 購入リンク
    check('BUYでなければ購入ページを出さない', oos.showPurchaseLink === false);
    const withUrl = runPhase6Route(fakeRouteInput());
    check('URLが無い候補には購入ページを出さない', runPhase6Route(
      fakeRouteInput({
        ranked: rankSupplierCandidates([fakeCandidate({ sourceProductUrl: null })], { nowIso: NOW, staleAfterHours: DEFAULT_STALE_AFTER_HOURS }).all[0],
      }),
    ).showPurchaseLink === false);
    check('購入ページは口が返したURLだけ', withUrl.purchaseUrl === null || withUrl.purchaseUrl.startsWith('https://'));
  }

  // ================================================================
  section('14. 国をまたぐ仕入は費用がそろわないとBUYにしない（§19）');
  // ================================================================
  {
    check('必要な費用は6項目', CROSS_BORDER_COST_FIELDS.length === 6);
    const domestic = checkCrossBorderCosts(false, {});
    check('国内仕入なら輸入費用は要らない', domestic.canBuy === true);

    const missing = checkCrossBorderCosts(true, { ITEM_PRICE: 10000 });
    check('輸入費用が欠けていればBUYにしない', missing.canBuy === false);
    check('欠けている項目を並べる', missing.missing.length === 5, `${missing.missing.length}件`);

    const complete = checkCrossBorderCosts(true, {
      ITEM_PRICE: 10000,
      FX_RATE: 150,
      INTERNATIONAL_SHIPPING: 2000,
      CUSTOMS_DUTY: 0,
      IMPORT_CONSUMPTION_TAX: 800,
      PAYMENT_FEE: 300,
    });
    check('そろえば進める', complete.canBuy === true);

    const res = runPhase6Route(fakeRouteInput({ isCrossBorder: true, crossBorderCosts: { ITEM_PRICE: 3000 } }));
    check('輸入費用が足りないままBUYにならない', res.finalDecision !== 'BUY');
    check('輸入費用が足りない理由が出る', res.crossBorder.missing.length > 0);
  }

  // ================================================================
  section('15. ファネル・脱落理由・KPI（§24 §25 §27）');
  // ================================================================
  {
    check('ファネルは6段', FUNNEL_STAGES.length === 6);
    check('最初はAmazonで調べた商品', FUNNEL_STAGES[0] === 'RESEARCH_CANDIDATES');
    check('最後はBUY', FUNNEL_STAGES[FUNNEL_STAGES.length - 1] === 'BUY');

    const good = { ...emptyFunnel(), RESEARCH_CANDIDATES: 10, SUPPLIER_FOUND: 6, HIGH_MATCH: 4, PROFIT_CALCULATED: 3, PROFITABLE: 1, BUY: 1 };
    check('減っていれば合格', checkFunnelMonotonic(good).ok === true);

    const bad = { ...good, HIGH_MATCH: 8 };
    check('途中で増えていたら止める', checkFunnelMonotonic(bad).ok === false);
    check('増えた段を指摘する', checkFunnelMonotonic(bad).increasedStages.includes('HIGH_MATCH'));

    check('脱落理由は9分類', DROPOUT_REASONS.length === 9, `${DROPOUT_REASONS.length}件`);
    for (const r of ['NO_SUPPLIER_RESULT', 'PRODUCT_MISMATCH', 'MULTIPLE_MATCH_UNRESOLVED', 'OUT_OF_STOCK', 'SHIPPING_UNKNOWN', 'FEE_UNKNOWN', 'NO_PROFIT', 'ROI_TOO_LOW', 'STALE_DATA']) {
      check(`脱落理由に ${r} がある`, (DROPOUT_REASONS as readonly string[]).includes(r));
    }
    check('利益が出ないだけなら見張る側へ回す', DROPOUT_MEANS_WATCH.NO_PROFIT === true);
    check('別商品は見張らない', DROPOUT_MEANS_WATCH.PRODUCT_MISMATCH === false);
    check('脱落理由をまとめられる', summarizeDropouts({ NO_PROFIT: 3 }).find((x) => x.reason === 'NO_PROFIT')?.count === 3);
    check('数えていない理由は0件として並ぶ', summarizeDropouts({}).length === 9);

    check('KPIは5つ', PHASE6_KPIS.length === 5);
    const kpis = calcPhase6Kpis({ funnel: good, conservativeProfitSum: 4000, apiCostJpy: 120 });
    check('仕入先が見つかった割合が出る', kpis.find((k) => k.kpi === 'SUPPLIER_MATCH_RATE')?.value === 40);
    check('買ってよい割合が出る', kpis.find((k) => k.kpi === 'BUY_OPPORTUNITY_RATE')?.value === 10);
    check('100件あたりの見込み利益が出る', kpis.find((k) => k.kpi === 'EXPECTED_PROFIT_PER_100_RESEARCHED')?.value === 40000);
    check('買える1件あたりの費用が出る', kpis.find((k) => k.kpi === 'API_COST_PER_BUY')?.value === 120);

    const zero = calcPhase6Kpis({ funnel: emptyFunnel(), conservativeProfitSum: null, apiCostJpy: 0 });
    for (const k of zero) {
      check(`${k.kpi} は分母0のとき null`, k.value === null);
      check(`${k.kpi} は出せない理由を書く`, k.unavailableReasonJa !== null);
    }
    check('出せない数字は画面に並べない', displayableKpis(zero).length === 0);

    const report = buildPhase6Report({ funnel: good, conservativeProfitSum: 4000, apiCostJpy: 120, dropouts: { NO_PROFIT: 2 } });
    check('報告にファネルが入る', report.funnel.length === 6);
    check('報告に脱落理由が入る', report.dropouts.length === 9);
    check('報告に見出しが入る', report.headlineJa.length > 0);

    const zeroReport = buildPhase6Report({ funnel: { ...emptyFunnel(), RESEARCH_CANDIDATES: 10 }, conservativeProfitSum: null, apiCostJpy: 0, dropouts: {} });
    check('0件でも失敗と書かない', zeroReport.headlineJa.includes('失敗ではありません'));
  }

  // ================================================================
  section('16. Phase 4・Phase 5 の経路を壊していない');
  // ================================================================
  {
    check('人が10件入れる経路が残っている', exists('lib/phase4/supplier.ts'));
    check('Phase 4 の取込スクリプトが残っている', exists('scripts/phase4-import.ts'));
    check('Phase 5 の自動リサーチが残っている', exists('lib/phase5/orchestrator.ts'));
    check('Phase 5 の待ち行列が残っている', exists('lib/phase5/queue.ts'));

    const pkg = readFile('package.json');
    check('Phase 4 の手入力コマンドが残っている', /"phase4:import"/.test(pkg));
    check('Phase 5 のリサーチコマンドが残っている', /"phase5:research"/.test(pkg));
    check('Phase 6 のテストコマンドがある', /"test:phase6"/.test(pkg));

    const connector = codeOnly(readFile('lib/phase5/connector.ts'));
    check('無許可収集は取り方の選択肢に無いまま', /SCRAPING_IS_NOT_AN_ACCESS_TIER\s*=\s*true/.test(connector));
    check('Yahooはまだ候補のままで登録していない', /YAHOO_SHOPPING/.test(connector));
  }

  // ================================================================
  section('17. 仕入先の門の待ち状況ボード（Phase 6.5）');
  // ================================================================
  {
    const board = supplierGateBoard();
    check('待っている相手は5件', board.length === 5);
    check('順番どおりに並ぶ', board.map((b) => b.waiting.order).join(',') === '1,2,3,4,5');
    check(
      '5件の中身がNETSEA・バリューコマース・orosy・Yahoo!・楽天',
      board.map((b) => b.waiting.supplierCode).join(',') ===
        'NETSEA,VALUECOMMERCE,OROSY,YAHOO_SHOPPING,RAKUTEN',
    );
    // 2026-08-26：orosy だけ「不可」の回答2件が入った（バイヤー審査基準）。他の4件はまだ0件。
    check(
      'orosy以外はまだ回答が1件も入っていない',
      SUPPLIER_GATE_WAITING.filter((w) => w.supplierCode !== 'OROSY').every(
        (w) => w.answers.length === 0,
      ),
    );
    check('全員が止まっている', board.every((b) => b.gate === 'BLOCKED'));
    check(
      '未回答は不明として数える（回答が入った分だけ不明が減る）',
      board.every((b) => b.unknown === b.waiting.requiredCount - b.waiting.answers.length),
    );
    check('可が0件のまま', board.every((b) => b.yes === 0));

    check('回答の種類は4つ', ANSWER_STATES.length === 4);
    check('条件付きで可がある', ANSWER_STATES.includes('CONDITIONAL'));

    // 出典3点がそろわない「可」は、可として通さない（ルール144）
    const noEvidence = effectiveAnswer({
      key: 'Q1', questionJa: '保存してよいか', value: 'YES',
      conditionJa: null, quoteJa: null, sourceJa: null, checkedAt: null,
    });
    check('原文・出典・確認日が無い「可」は不明に落ちる', noEvidence === 'UNKNOWN');

    const withEvidence = effectiveAnswer({
      key: 'Q1', questionJa: '保存してよいか', value: 'YES',
      conditionJa: null, quoteJa: '保存して差し支えありません', sourceJa: '回答メール', checkedAt: '2026-08-26',
    });
    check('3点そろえば可として数える', withEvidence === 'YES');

    check('最初の接続先はまだ決まっていない', firstLiveSupplier() === null);
    check('通過しても、まず読むだけ', FIRST_LIVE_SUPPLIER_READ_ONLY === true);
    check('広げる順は1→5→10→47', FIRST_LIVE_SUPPLIER_STAGES.join(',') === '1,5,10,47');

    // 情報源（バリューコマース・Yahoo!・楽天）は、門を通っても仕入先にはならない
    const gate = codeOnly(readFile('lib/phase6/legalgate.ts'));
    check(
      '仕入先候補はNETSEAとorosyだけ',
      /PURCHASABLE_CANDIDATE_CODES\s*=\s*\['NETSEA',\s*'OROSY'\]/.test(gate),
    );
    check('AIは外部へ連絡しないまま', /CONTACT_VENUE_BY_AI_ALLOWED\s*=\s*false/.test(gate));

    const venuesPage = readFile('app/venues/page.tsx');
    check('管理画面に待ち状況が出る', /supplierGateBoard\(\)/.test(venuesPage));
  }

  // ================================================================
  section('18. 回答待ちフェーズの固定と、最初の接続先の最低条件（Phase 6.5b）');
  // ================================================================
  {
    check('いまは回答待ちフェーズ', LEGAL_GATE_WAITING_PHASE === true);
    check('新しい機能開発は止めている', NEW_FEATURE_DEVELOPMENT_PAUSED === true);

    check('画面に出す状態は5つ', GATE_DISPLAY_STATES.length === 5);
    check(
      '状態は回答待ち・人間確認待ち・条件付き・不可・通過',
      GATE_DISPLAY_STATES.join(',') ===
        'WAITING_ANSWER,WAITING_HUMAN_CHECK,CONDITIONAL,BLOCKED,PASSED',
    );

    const board18 = supplierGateBoard();
    const orosy = board18.find((b) => b.waiting.supplierCode === 'OROSY');
    const netsea = board18.find((b) => b.waiting.supplierCode === 'NETSEA');
    // 2026-08-26：orosy はバイヤー審査基準（一次資料）で「モール」が利用不可と判明し、
    // 当社（Amazon主販路・実店舗なし）は審査対象外。人間確認待ちではなく「不可」で確定した。
    check('orosyは不可で確定', orosy?.display === 'BLOCKED');
    check('orosyの不可には出典3点が揃っている', (orosy?.no ?? 0) >= 1);
    check(
      'orosyの不可の根拠に審査基準の原文が入っている',
      (orosy?.waiting.answers ?? []).some(
        (a) =>
          a.value === 'NO' &&
          (a.quoteJa ?? '').includes('ご利用頂けません') &&
          (a.sourceJa ?? '').includes('help.orosy.com') &&
          a.checkedAt === '2026-08-26',
      ),
    );
    check(
      'orosyの残りの項目は不明のまま（読んでいないものを読んだことにしない）',
      (orosy?.unknown ?? 0) === 11,
    );
    check('NETSEAは返事待ち', netsea?.display === 'WAITING_ANSWER');
    check('通過している相手はまだ0件', board18.every((b) => b.display !== 'PASSED'));
    check('購入できる仕入先候補で残っているのはNETSEAだけ', firstLiveSupplier() === null);

    check('最低条件は7つ', FIRST_LIVE_SUPPLIER_MIN_CONDITIONS.length === 7);
    const allYes = {
      COMMERCIAL_USE: 'YES', INTERNAL_USE: 'YES', AUTOMATED_RETRIEVAL: 'YES',
      DATA_STORAGE: 'YES', PRICE_COMPARISON: 'YES', PURCHASABLE: 'YES', AMAZON_RESALE: 'YES',
    } as const;
    check(
      '7つすべて可で入口も通っていれば最初の接続先にできる',
      canPromoteToFirstLiveSupplier({
        supplierCode: 'NETSEA', conditions: { ...allYes }, amazonResaleCheckablePerProduct: false,
        entryGateResult: 'PASS',
      }).ok === true,
    );
    check(
      '1つでも不明なら通過禁止',
      canPromoteToFirstLiveSupplier({
        supplierCode: 'NETSEA',
        conditions: { ...allYes, DATA_STORAGE: 'UNKNOWN' },
        amazonResaleCheckablePerProduct: false,
        entryGateResult: 'PASS',
      }).ok === false,
    );
    check(
      '条件付きで可は「可」として数えない',
      canPromoteToFirstLiveSupplier({
        supplierCode: 'NETSEA',
        conditions: { ...allYes, PRICE_COMPARISON: 'CONDITIONAL' },
        amazonResaleCheckablePerProduct: false,
        entryGateResult: 'PASS',
      }).ok === false,
    );
    check(
      'Amazon販売可否は商品ごとに機械で確認できるなら通してよい',
      canPromoteToFirstLiveSupplier({
        supplierCode: 'NETSEA',
        conditions: { ...allYes, AMAZON_RESALE: 'UNKNOWN' },
        amazonResaleCheckablePerProduct: true,
        entryGateResult: 'PASS',
      }).ok === true,
    );
    check(
      '情報源（バリューコマース）は最初の接続先にしない',
      canPromoteToFirstLiveSupplier({
        supplierCode: 'VALUECOMMERCE', conditions: { ...allYes }, amazonResaleCheckablePerProduct: true,
        entryGateResult: 'PASS',
      }).ok === false,
    );
    check(
      '通せない理由が日本語で出る',
      canPromoteToFirstLiveSupplier({
        supplierCode: 'NETSEA',
        conditions: { ...allYes, INTERNAL_USE: 'UNKNOWN' },
        amazonResaleCheckablePerProduct: false,
        entryGateResult: 'PASS',
      }).missingJa.length > 0,
    );
    // ★ 入口の門を省略したら「通った」ことにはしない。記録済みの実際の値を見る。
    check(
      '7つすべて可でも、入口の門が未確認なら昇格させない（NETSEAの現状）',
      canPromoteToFirstLiveSupplier({
        supplierCode: 'NETSEA', conditions: { ...allYes }, amazonResaleCheckablePerProduct: false,
      }).ok === false,
    );

    check('orosyの確認項目は13個', OROSY_CHECKLIST_KEYS.length === 13);

    check('「可」は可として読む', normalizeAnswerInput('可') === 'YES');
    check('「不可」は不可として読む', normalizeAnswerInput('不可') === 'NO');
    check('「条件付き」は条件付きとして読む', normalizeAnswerInput('条件付き') === 'CONDITIONAL');
    check('空欄は不明として読む', normalizeAnswerInput('') === 'UNKNOWN');
    check('書いていない言葉を勝手に可にしない', normalizeAnswerInput('たぶん大丈夫') === 'UNKNOWN');

    const venuesPage18 = readFile('app/venues/page.tsx');
    check('管理画面が5つの状態で表示する', /GATE_DISPLAY_STATE_JA/.test(venuesPage18));
  }

  {
    section('19. 入口の門（SUPPLIER_ENTRY_GATE）— 規約より先に「客として認められるか」');

    check('入口の門は規約確認より先に置く', ENTRY_GATE_BEFORE_LEGAL_GATE === true);
    check('確認する項目は5つ', SUPPLIER_ENTRY_GATE_STEPS.length === 5);
    check(
      '順番は 事業形態 → モール販売 → Amazon中心 → 必要資格 → 審査条件',
      SUPPLIER_ENTRY_GATE_STEPS.join(',') ===
        'ACCOUNT_ELIGIBLE,MALL_SELLER_ALLOWED,AMAZON_CENTRIC_ALLOWED,REQUIRED_LICENSES_MET,SCREENING_CONDITIONS_KNOWN',
    );
    check('結果は3つ（通過・不可・未確認）', SUPPLIER_ENTRY_GATE_RESULTS.length === 3);

    // orosy＝入口で不可（この教訓からこの門を作った）
    check('orosyの入口の門は不可', supplierEntryGateResult('OROSY') === 'FAIL');
    const orosyEntry = supplierEntryGateBoard().find((x) => x.gate.supplierCode === 'OROSY');
    check('orosyは不可の理由が原文つきで残っている', (orosyEntry?.failedJa.length ?? 0) >= 1);
    check(
      'orosyの不可の理由にモールの記載がある',
      (orosyEntry?.failedJa ?? []).some((s) => s.includes('モール')),
    );
    check('orosyは規約・API調査へ進ませない', orosyEntry?.canProceedToLegalGate === false);
    check('orosyの規約調査は着手禁止', canStartLegalGateResearch('OROSY') === false);

    // NETSEA＝入口が未確認。まずここから。
    check('NETSEAの入口の門はまだ未確認', supplierEntryGateResult('NETSEA') === 'UNKNOWN');
    const netseaEntry = supplierEntryGateBoard().find((x) => x.gate.supplierCode === 'NETSEA');
    check('NETSEAは5つとも未確認', netseaEntry?.unknownJa.length === 5);
    check(
      '未確認のまま規約・API調査へ進ませない',
      canStartLegalGateResearch('NETSEA') === false,
    );
    check('NETSEAで先に聞く項目は4つ', NETSEA_ENTRY_QUESTIONS_JA.length === 4);
    check(
      'NETSEAの4項目にモール販売目的の仕入可否が入っている',
      NETSEA_ENTRY_QUESTIONS_JA.some((q) => q.includes('モール')),
    );
    check(
      'NETSEAの4項目にAmazon中心の可否が入っている',
      NETSEA_ENTRY_QUESTIONS_JA.some((q) => q.includes('Amazon中心')),
    );
    check(
      'NETSEAの4項目に審査条件が入っている',
      NETSEA_ENTRY_QUESTIONS_JA.some((q) => q.includes('審査条件')),
    );

    // 知らない相手は「不明」。勝手に通さない。
    check('記録の無い相手は不明として扱う', supplierEntryGateResult('UNKNOWN_SUPPLIER') === 'UNKNOWN');
    check('記録の無い相手も調査着手禁止', canStartLegalGateResearch('UNKNOWN_SUPPLIER') === false);

    // 出典3点が無い「可」は入口でも採用しない（ルール144）
    const noEvidence = supplierEntryGateStatus({
      supplierCode: 'TEST',
      labelJa: 'テスト',
      answers: Object.fromEntries(
        SUPPLIER_ENTRY_GATE_STEPS.map((k) => [
          k,
          { key: k, questionJa: '', value: 'YES', conditionJa: null, quoteJa: null, sourceJa: null, checkedAt: null },
        ]),
      ),
    });
    check('出典の無い「可」は入口でも通さない', noEvidence.result === 'UNKNOWN');

    // 5つすべてが出典つきYESなら通過
    const withEvidence = supplierEntryGateStatus({
      supplierCode: 'TEST',
      labelJa: 'テスト',
      answers: Object.fromEntries(
        SUPPLIER_ENTRY_GATE_STEPS.map((k) => [
          k,
          {
            key: k, questionJa: '', value: 'YES', conditionJa: null,
            quoteJa: '原文', sourceJa: '出典', checkedAt: '2026-08-26',
          },
        ]),
      ),
    });
    check('5つとも出典つきで可なら入口通過', withEvidence.result === 'PASS');
    check('入口通過なら規約調査へ進んでよい', withEvidence.canProceedToLegalGate === true);

    // 1つでも不可があれば、他が全部可でも不可
    const oneNo = supplierEntryGateStatus({
      supplierCode: 'TEST',
      labelJa: 'テスト',
      answers: {
        ...withEvidence.gate.answers,
        MALL_SELLER_ALLOWED: {
          key: 'MALL_SELLER_ALLOWED', questionJa: '', value: 'NO', conditionJa: null,
          quoteJa: 'モール不可', sourceJa: '出典', checkedAt: '2026-08-26',
        },
      },
    });
    check('1つでも不可があればその時点で調査終了', oneNo.result === 'FAIL');
    check('不可なら規約調査へ進ませない', oneNo.canProceedToLegalGate === false);

    // 入口が通っていない相手は FIRST_LIVE_SUPPLIER にしない
    check('入口が通っていなければ最初の接続先にならない', firstLiveSupplier() === null);

    const venuesPage19 = readFile('app/venues/page.tsx');
    check('管理画面に入口の門を出している', /supplierEntryGateBoard/.test(venuesPage19));
    check(
      '管理画面が入口の門を規約の門より先に出している',
      venuesPage19.indexOf('SUPPLIER ENTRY GATE') < venuesPage19.indexOf('仕入先の門（LEGAL GATE）'),
    );
  }

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 6（FIRST SUPPLIER CONNECTOR）の受け入れ条件をすべて満たしています。');
  console.log('※ このテストは外部へ一切アクセスしません（DBにも書き込みません）。');
  console.log('※ Yahoo!ショッピングの本番取得は LEGAL_USAGE_GATE = BLOCKED のため行いません。');
  console.log('※ 自動購入・自動注文は、コードとして存在しません。');
  console.log('※ 人が10件入れる経路（Phase 4）と自動リサーチ（Phase 5）はそのまま残っています。');
}

main();
