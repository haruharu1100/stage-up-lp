/**
 * Phase 5（AUTO RESEARCH ORCHESTRATOR）の受け入れテスト。
 *
 * ------------------------------------------------------------------
 * 【このテストは外部へ一切アクセスしない】
 * Keepa へも、他のどの市場へも接続しない。DBにも書き込まない。
 * APIキーが無くても最後まで通る。
 *
 * ------------------------------------------------------------------
 * 【ここで潰しておきたい将来の事故】
 *
 *   1. スクレイピングが「取り方」の1つとして名前だけ復活する
 *   2. 調べていない市場が、既定値で「使える」側に置かれる
 *   3. Rate Limit が分からない口を、とりあえずの値で毎日叩く
 *   4. Orchestrator の中に市場名が直接書かれ、市場を増やすたび本体を書き換える
 *   5. 段を飛ばして、照合していない候補が購入候補に並ぶ
 *   6. 初回の全件が NEW_LISTING になり、優先順位が意味を失う
 *   7. 安すぎる商品を、一致の基準を上げずに通す
 *   8. AIの判断や画像の似かただけで「同じ商品」と確定する
 *   9. 材料の無い軸を0点として足し、材料の少ない商品を沈める
 *  10. 見込み利益が分からないのに、費用をかけて調べる
 *  11. 売却確率を、数件の実績から出す
 *  12. 30日あたりの利益を、欠けた材料を1で埋めて出す
 *  13. 集中リスクの上限を無視して、1商品に資金を寄せる
 *  14. 分母0を0%と書く／購入候補0件で「1件あたり0円」と書く
 *  15. ファネルが途中で増えているのに、そのまま報告する
 *  16. 「あと◯円下がる」に、下がる予測を混ぜる
 *  17. 仕入先の口が無いのに、購入候補を出してしまう
 *  18. 自動購入・自動出品・自動決済・自動発送が混入する
 *  19. しきい値をAIが自分で書き換える
 *  20. 新しいファイルが依存を抱えて画面へバンドルできなくなる（ルール37）
 *
 * ------------------------------------------------------------------
 * ★ソース全文を正規表現で検査するときは、**先にコメントを取り除く**（ルール64）。
 * ★偽データに見本の印（SAMPLE / テスト / サンプル 等）は絶対に入れない。
 *   後片付け用の目印には P5ONLY を使う（ルール54）。
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  ACCESS_TIERS,
  accessTierRank,
  buySideAutoConnectorCount,
  canAutoResearch,
  CANDIDATE_VENUES,
  CONNECTOR_CAPABILITIES,
  CONNECTOR_READINESS,
  CONNECTOR_READINESS_DEFAULT,
  emptyCapabilities,
  isAutomatable,
  REGISTERED_CONNECTORS,
  SCRAPING_IS_NOT_AN_ACCESS_TIER,
  sellSideAutoConnectorCount,
  UNAUTHORIZED_COLLECTION_IMPLEMENTED,
  type ConnectorDescriptor,
} from '../lib/phase5/connector';
import {
  AI_COST_DEFAULTS,
  AUTO_THRESHOLD_CHANGE_IMPLEMENTED,
  buildEffectivenessFunnel,
  checkCostGate,
  computeEfficiency,
  EFFECTIVENESS_STEPS,
  judgeLearning,
  LEARNING_MIN_SAMPLE,
  LEARNING_OUTCOMES,
  morningSummaryLinesJa,
} from '../lib/phase5/effectiveness';
import {
  AUTO_LISTING_IMPLEMENTED,
  AUTO_PAYMENT_IMPLEMENTED,
  AUTO_PURCHASE_IMPLEMENTED,
  AUTO_SHIPPING_IMPLEMENTED,
  checkSafetyStops,
  counterpartSide,
  discoverSide,
  PARK_STATE_SUPPLIER_SEARCH_PENDING,
  PIPELINE_STAGES,
  planRun,
  reachReport,
  SAFETY_STOP_REASONS,
  STAGE_KEYS,
  type ConnectorView,
} from '../lib/phase5/orchestrator';
import {
  candidateKey,
  CANDIDATE_STATES,
  CANDIDATE_TRANSITIONS,
  canTransition,
  isTerminal,
  judgeNovelty,
  judgePriceAnomaly,
  NEW_LISTING_PRIORITY_BONUS,
  PRICE_ANOMALY_RATIO,
  REANALYSIS_MAX_AGE_HOURS,
  shouldReanalyze,
  transition,
} from '../lib/phase5/queue';
import {
  AI_MATCH_ALONE_CAN_BUY,
  cheapFilter,
  CHEAP_FILTER_REASONS,
  DEMAND_FIRST_DEFAULTS,
  IMAGE_MATCH_ALONE_CAN_CONFIRM,
  judgeEvidence,
  MATCH_EVIDENCE_CAN_CONFIRM_ALONE,
  MATCH_EVIDENCE_KINDS,
  maySpendOnResearch,
  pickDemandFirst,
  RESEARCH_DIRECTIONS,
  RESEARCH_SCORE_AXES,
  RESEARCH_SCORE_MIN_COVERAGE,
  RESEARCH_SPEND_MIN_PROFIT_MULTIPLE,
  RESEARCH_SPEND_MIN_SCORE,
  researchPriorityScore,
  ROUGH_FEE_RATE_DEFAULT,
} from '../lib/phase5/research';
import {
  MIN_INTERVAL_MINUTES,
  mayRunNow,
  planSchedule,
  SCHEDULE_SAFETY_MARGIN,
  SCHEDULER_ALLOWED_ACTIONS,
  SCHEDULER_CAN_LIST,
  SCHEDULER_CAN_PAY,
  SCHEDULER_CAN_PURCHASE,
  SCHEDULER_CAN_SHIP,
  schedulerStatusJa,
  WATCH_JOBS,
} from '../lib/phase5/scheduler';
import {
  allocateCapital,
  checkExposure,
  EXPOSURE_DEFAULTS,
  expectedProfitPer30d,
  judgeSellProbability,
  MAX_DAYS_TO_SELL_FOR_VELOCITY,
  objectiveValue,
  SELL_HORIZONS,
  SELL_PROBABILITY_MIN_SAMPLE,
} from '../lib/phase5/velocity';
import {
  judgeWatch,
  mayStartWatching,
  PENDING_REASONS,
  pendingNextStepJa,
  WATCH_EXPIRY_DAYS,
  WATCH_PREDICTS_FUTURE_PRICE,
  WATCH_STATES,
} from '../lib/phase5/watch';

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

/** lib/phase5 の純粋計算ファイル（画面へそのまま載せられる必要がある） */
const PURE_FILES = [
  'lib/phase5/connector.ts',
  'lib/phase5/queue.ts',
  'lib/phase5/research.ts',
  'lib/phase5/orchestrator.ts',
  'lib/phase5/velocity.ts',
  'lib/phase5/watch.ts',
  'lib/phase5/effectiveness.ts',
  'lib/phase5/scheduler.ts',
];

const ALL_PHASE5_FILES = [
  ...PURE_FILES,
  'lib/phase5/store.ts',
  'scripts/phase5-research.ts',
].filter((p) => fs.existsSync(path.join(decodeURIComponent(ROOT), p)));

/* ================================================================
 * 偽の Connector（見本の印は入れない）
 * ================================================================ */

function fakeConnector(over: Partial<ConnectorDescriptor> = {}): ConnectorDescriptor {
  return {
    venueCode: 'P5ONLY_VENUE',
    labelJa: '検査用の口',
    role: 'BUY_SIDE',
    accessTier: 'OFFICIAL_API',
    readiness: 'AUTO_READY',
    capabilities: { ...emptyCapabilities(), productSearch: true, price: true, identifiers: true },
    rateLimitPerMinute: 30,
    sourceUrl: 'https://example.invalid/docs',
    checkedAt: '2026-08-25',
    noteJa: '',
    ...over,
  };
}

function fakeView(over: Partial<ConnectorView> = {}): ConnectorView {
  return {
    venueCode: 'P5ONLY_VIEW',
    labelJa: '検査用',
    sides: ['BUY_SIDE'],
    autoReady: true,
    canSearch: true,
    canPrice: true,
    canIdentify: true,
    canProductUrl: false,
    ...over,
  };
}

async function main() {
  console.log('Phase 5（AUTO RESEARCH ORCHESTRATOR）の受け入れテスト\n');

  // ================================================================
  console.log('【1】データの取り方は7段階で、スクレイピングは選択肢に無い（§8）');
  {
    check('取り方は7種類ある', ACCESS_TIERS.length === 7, `${ACCESS_TIERS.length}種類`);
    check('順番がご本人の指示どおり', accessTierRank('OFFICIAL_API') === 1 && accessTierRank('MANUAL_FALLBACK') === 7);
    check('人が手で入れるものだけ自動に載せない', !isAutomatable('MANUAL_FALLBACK'));
    for (const t of ACCESS_TIERS) {
      if (t === 'MANUAL_FALLBACK') continue;
      check(`「${t}」は自動に載せてよい`, isAutomatable(t));
    }
    check('スクレイピングという種類が無い', !ACCESS_TIERS.some((t) => /SCRAP|CRAWL/i.test(t)));
    check('スクレイピングを種類に入れない決まりが残っている', SCRAPING_IS_NOT_AN_ACCESS_TIER === true);
    check('無許可の収集は実装していない', UNAUTHORIZED_COLLECTION_IMPLEMENTED === false);

    for (const f of ALL_PHASE5_FILES) {
      const src = codeOnly(readFile(f));
      check(
        `${f} に巡回・取得のコードが無い`,
        !/(puppeteer|playwright|cheerio|jsdom|got\(|axios|node-fetch)/i.test(src),
      );
      check(`${f} が外部へ通信していない`, !/\bfetch\s*\(/.test(src));
    }
  }

  // ================================================================
  console.log('\n【2】調べていない市場は「使える」側に置かない（§36）');
  {
    check('状態は4つ', CONNECTOR_READINESS.length === 4);
    check('「たぶん使える」が無い', !CONNECTOR_READINESS.some((s) => /MAYBE|PROBABLY|LIKELY/i.test(s)));
    check('既定はUNKNOWN', CONNECTOR_READINESS_DEFAULT === 'UNKNOWN');

    check('できることは8項目', CONNECTOR_CAPABILITIES.length === 8);
    const empty = emptyCapabilities();
    check(
      '調べていない項目はfalseではなくnull',
      CONNECTOR_CAPABILITIES.every((k) => empty[k] === null),
    );

    check('自動に載せる関門が4条件すべて必要（正しい口は通る）', canAutoResearch(fakeConnector()).ok);
    check('人が手で入れる口は載せない', !canAutoResearch(fakeConnector({ accessTier: 'MANUAL_FALLBACK' })).ok);
    check('申請中の口は載せない', !canAutoResearch(fakeConnector({ readiness: 'WAITING_APPROVAL' })).ok);
    check('未調査の口は載せない', !canAutoResearch(fakeConnector({ readiness: 'UNKNOWN' })).ok);
    check('頻度の分からない口は載せない', !canAutoResearch(fakeConnector({ rateLimitPerMinute: null })).ok);
    check('出典の無い口は載せない', !canAutoResearch(fakeConnector({ sourceUrl: null })).ok);
    check('確認日の無い口は載せない', !canAutoResearch(fakeConnector({ checkedAt: null })).ok);
    check(
      '商品を探せない口は載せない',
      !canAutoResearch(fakeConnector({ capabilities: { ...emptyCapabilities(), price: true } })).ok,
    );
    check('載せない理由は必ず日本語で返る', canAutoResearch(fakeConnector({ sourceUrl: null })).reasonsJa.length > 0);
  }

  // ================================================================
  console.log('\n【3】いま接続しているのは1つだけで、候補市場は接続していない（§3）');
  {
    check('登録済みの口は1つ', REGISTERED_CONNECTORS.length === 1, `${REGISTERED_CONNECTORS.length}件`);
    check('候補として名前だけ持つ市場が13件ある', CANDIDATE_VENUES.length === 13, `${CANDIDATE_VENUES.length}件`);
    check(
      '候補市場は1つも登録済みに入っていない',
      CANDIDATE_VENUES.every((c) => !REGISTERED_CONNECTORS.some((r) => r.venueCode === c.venueCode)),
    );
    check('仕入側で自動リサーチできる口は0件', buySideAutoConnectorCount() === 0, `${buySideAutoConnectorCount()}件`);
    check('販売側で自動リサーチできる口は1件', sellSideAutoConnectorCount() === 1, `${sellSideAutoConnectorCount()}件`);
    check(
      '最初の仕入先をKOMEHYOに固定していない',
      !REGISTERED_CONNECTORS.some((r) => /KOMEHYO/i.test(r.venueCode)),
    );
    check(
      '候補市場に買う側・売る側の両方を持てる形になっている',
      CANDIDATE_VENUES.some((c) => c.role === 'BOTH'),
    );
  }

  // ================================================================
  console.log('\n【4】Orchestratorは市場の名前を1つも知らない（§42）');
  {
    const orch = codeOnly(readFile('lib/phase5/orchestrator.ts'));
    const venueWords = ['KEEPA', 'KOMEHYO', 'BOOKOFF', 'MERCARI', 'AMAZON', 'EBAY', 'SNKRDUNK', 'YAHOO', 'HARD_OFF'];
    for (const w of venueWords) {
      check(`Orchestratorに「${w}」という市場名が書かれていない`, !new RegExp(w, 'i').test(orch));
    }
    check('Orchestratorは何もimportしない', !/^\s*import\s/m.test(orch));
    check('口の情報は引数で受け取る形になっている', /connectors:\s*ConnectorView\[\]/.test(orch));
  }

  // ================================================================
  console.log('\n【5】段は決まった順で、材料が無ければ先へ進まない（§1）');
  {
    check('段は10ある', PIPELINE_STAGES.length === 10, `${PIPELINE_STAGES.length}段`);
    check('段のキーが重複していない', new Set(STAGE_KEYS).size === STAGE_KEYS.length);

    // いまの実際の口（仕入側0件・販売側1件）
    const nowViews: ConnectorView[] = [
      fakeView({ venueCode: 'P5ONLY_SELL', sides: ['SELL_SIDE'] }),
    ];
    const plan = planRun('DEMAND_FIRST', nowViews);
    check('仕入側が無いと「同じ商品かを確かめる」で止まる', plan.stages.find((s) => s.key === 'MATCH')?.runnable === false);
    check('止まる前の段までは進める', plan.reachableUpTo === 'CHEAP_FILTER', String(plan.reachableUpTo));
    check('購入候補の段までは進まない', plan.reachableUpTo !== 'OPPORTUNITY');
    check('止まっても結果は捨てずに貯める', plan.parkAt === PARK_STATE_SUPPLIER_SEARCH_PENDING);
    check('止まった理由が日本語で返る', plan.summaryJa.length > 0 && /仕入側/.test(plan.summaryJa));

    // 両側そろえば最後まで進める
    const bothViews: ConnectorView[] = [
      fakeView({ venueCode: 'P5ONLY_BUY', sides: ['BUY_SIDE'] }),
      fakeView({ venueCode: 'P5ONLY_SELL', sides: ['SELL_SIDE'] }),
    ];
    const full = planRun('DEMAND_FIRST', bothViews);
    check('両側そろえば最後の段まで進める', full.reachableUpTo === 'OPPORTUNITY', String(full.reachableUpTo));
    check('最後まで進めるときは貯め置きしない', full.parkAt === null);

    check('口が1つも無ければ1段も進まない', planRun('DEMAND_FIRST', []).reachableUpTo === null);

    check('向きは2つ', RESEARCH_DIRECTIONS.length === 2);
    check('Demand Firstは販売側から始める', discoverSide('DEMAND_FIRST') === 'SELL_SIDE');
    check('Demand Firstの相手は仕入側', counterpartSide('DEMAND_FIRST') === 'BUY_SIDE');
    check('Supply Firstは仕入側から始める', discoverSide('SUPPLY_FIRST') === 'BUY_SIDE');
    check('Supply Firstの相手は販売側', counterpartSide('SUPPLY_FIRST') === 'SELL_SIDE');

    const rep = reachReport('DEMAND_FIRST', nowViews);
    check('いまどこまで届くかを正直に返す', rep.linesJa.some((l) => /仕入側が0件/.test(l)));
    check('「もうすぐ全自動」とは書かない', !rep.linesJa.some((l) => /もうすぐ|近日|まもなく/.test(l)));
  }

  // ================================================================
  console.log('\n【6】候補の状態は8つで、段を飛ばせない（§43）');
  {
    check('状態は8つ', CANDIDATE_STATES.length === 8, `${CANDIDATE_STATES.length}個`);
    check('見つけたばかりから購入候補へ直接は行けない', !canTransition('NEW', 'OPPORTUNITY'));
    check('照合をとばして利益計算へ行けない', !canTransition('FILTERED', 'ANALYZING'));
    check('照合をとばして道すじへ行けない', !canTransition('MATCHING', 'ROUTE_READY'));
    check('順に進むことはできる', canTransition('NEW', 'FILTERED') && canTransition('FILTERED', 'MATCHING'));
    check('見送りからいきなり購入候補へ戻れない', !canTransition('REJECTED', 'OPPORTUNITY'));
    check('値下がり待ちからは利益計算へ戻れる', canTransition('WATCHING', 'ANALYZING'));

    const bad = transition('NEW', 'OPPORTUNITY');
    check('進めないときは状態が変わらない', bad.ok === false && bad.state === 'NEW');
    check('進めない理由が日本語で返る', /段を飛ばさない/.test(bad.reasonJa));
    const good = transition('NEW', 'FILTERED');
    check('進めるときは状態が変わる', good.ok && good.state === 'FILTERED');
    check('同じ状態への移動は許す', transition('NEW', 'NEW').ok);
    check('終わりの状態は見送りだけ', CANDIDATE_STATES.filter((s) => isTerminal(s)).length === 1);
    check(
      'どの状態にも進み先が定義されている',
      CANDIDATE_STATES.every((s) => Array.isArray(CANDIDATE_TRANSITIONS[s])),
    );
  }

  // ================================================================
  console.log('\n【7】同じものを二度調べない・値が動いたときだけ調べ直す（§44・§45）');
  {
    check('鍵は市場と出品番号で作る', candidateKey('p5only_venue', ' ABC123 ') === 'P5ONLY_VENUE:ABC123');
    check('商品名では鍵を作らない', !codeOnly(readFile('lib/phase5/queue.ts')).includes('title'));

    const base = {
      previousPrice: 1000,
      currentPrice: 1000,
      previousStock: 3,
      currentStock: 3,
      previousRuleVersion: 'a1-x',
      currentRuleVersion: 'a1-x',
      hoursSinceLastAnalysis: 1,
    };
    check('何も動いていなければ調べ直さない', shouldReanalyze(base).should === false);
    check('価格が動いたら調べ直す', shouldReanalyze({ ...base, currentPrice: 900 }).should);
    check('在庫が動いたら調べ直す', shouldReanalyze({ ...base, currentStock: 1 }).should);
    check('しきい値の版が変わったら調べ直す', shouldReanalyze({ ...base, currentRuleVersion: 'a1-y' }).should);
    check('まだ一度も調べていなければ調べる', shouldReanalyze({ ...base, hoursSinceLastAnalysis: null }).should);
    check(
      `${REANALYSIS_MAX_AGE_HOURS}時間たてば値が同じでも調べ直す`,
      shouldReanalyze({ ...base, hoursSinceLastAnalysis: REANALYSIS_MAX_AGE_HOURS }).should,
    );
    check('調べ直さない理由も日本語で返る', shouldReanalyze(base).reasonJa.length > 0);
  }

  // ================================================================
  console.log('\n【8】新着と、安すぎる商品の扱い（§16・§17）');
  {
    check('前回の記録が無ければ新着と言わない', judgeNovelty(null) === 'UNKNOWN');
    check('前から見えていた出品は新着ではない', judgeNovelty(true) === 'KNOWN_LISTING');
    check('前回いなければ新着', judgeNovelty(false) === 'NEW_LISTING');
    check('新着は順番だけを前に出す', NEW_LISTING_PRIORITY_BONUS > 0 && NEW_LISTING_PRIORITY_BONUS <= 20);

    const normal = judgePriceAnomaly(9000, 10000);
    check('相場から外れていなければ何も足さない', normal.anomaly === false && normal.extraMatchPoints === 0);

    const half = judgePriceAnomaly(5000, 10000);
    check(`相場の${PRICE_ANOMALY_RATIO * 100}%は安すぎる扱い`, half.anomaly === true);
    check('安すぎる商品は捨てずに一致の基準を上げる', half.extraMatchPoints >= 10);

    const quarter = judgePriceAnomaly(2000, 10000);
    check('もっと安いほど基準を上げる', quarter.extraMatchPoints > half.extraMatchPoints);
    check('上げ幅は青天井にしない', judgePriceAnomaly(1, 10000).extraMatchPoints <= 20);
    check('疑う理由を4つ挙げる', half.suspicionsJa.length === 4);
    check(
      '誤商品・状態・付属品・数量をすべて疑う',
      ['違う商品', '状態', '付属品', '数量'].every((w) => half.suspicionsJa.some((s) => s.includes(w))),
    );
    check('比べる相場が無ければ判定しない', judgePriceAnomaly(1000, null).anomaly === false);
  }

  // ================================================================
  console.log('\n【9】需要の強い商品を選ぶのは、買ってよい判定ではない（§12）');
  {
    const ok = pickDemandFirst({
      asin: 'P5ONLYAAA1',
      rankDrops30: 30,
      offerCountNew: 5,
      amazonRetailPresent: false,
      priceVolatility: 0.1,
      dataAgeHours: 24,
      hasIdentifier: true,
    });
    check('条件を満たせば選ばれる', ok.selected);
    check('選ばれた理由も日本語で返る', ok.reasonsJa.length > 0);

    check(
      '売れ行きが分からないものは選ばない',
      !pickDemandFirst({ ...{ asin: 'P5ONLYAAA2', rankDrops30: null, offerCountNew: 5, amazonRetailPresent: false, priceVolatility: 0.1, dataAgeHours: 24, hasIdentifier: true } }).selected,
    );
    check(
      '出品者数が分からないものは選ばない',
      !pickDemandFirst({ asin: 'P5ONLYAAA3', rankDrops30: 30, offerCountNew: null, amazonRetailPresent: false, priceVolatility: 0.1, dataAgeHours: 24, hasIdentifier: true }).selected,
    );
    check(
      '手がかりが無ければ選ばない',
      !pickDemandFirst({ asin: 'P5ONLYAAA4', rankDrops30: 30, offerCountNew: 5, amazonRetailPresent: false, priceVolatility: 0.1, dataAgeHours: 24, hasIdentifier: false }).selected,
    );
    check(
      'データが古すぎれば選ばない',
      !pickDemandFirst({ asin: 'P5ONLYAAA5', rankDrops30: 30, offerCountNew: 5, amazonRetailPresent: false, priceVolatility: 0.1, dataAgeHours: 99999, hasIdentifier: true }).selected,
    );

    // ルール130：Amazon本体がいても、いきなり選外にしない
    const withAmazon = pickDemandFirst({
      asin: 'P5ONLYAAA6',
      rankDrops30: 30,
      offerCountNew: 5,
      amazonRetailPresent: true,
      priceVolatility: 0.1,
      dataAgeHours: 24,
      hasIdentifier: true,
    });
    check('Amazon本体がいても即・選外にしない（ルール130）', withAmazon.selected);
    check('ただし後回しにすることは書く', withAmazon.reasonsJa.some((r) => /Amazon本体/.test(r)));

    // 価格の振れ幅が分からないだけでは落とさない
    check(
      '価格の振れ幅が分からないだけでは落とさない',
      pickDemandFirst({ asin: 'P5ONLYAAA7', rankDrops30: 30, offerCountNew: 5, amazonRetailPresent: false, priceVolatility: null, dataAgeHours: 24, hasIdentifier: true }).selected,
    );

    check('しきい値は設定で変えられる', DEMAND_FIRST_DEFAULTS.minRankDrops30 > 0);
    const src = codeOnly(readFile('lib/phase5/research.ts'));
    check('ここでBUYを出していない（ルール124）', !/\bBUY\b/.test(src));
  }

  // ================================================================
  console.log('\n【10】お金のかからない計算で先にふるいにかける（§19）');
  {
    check('除外の理由は3つだけ', CHEAP_FILTER_REASONS.length === 3);
    check('「その他」を作っていない（ルール47）', !CHEAP_FILTER_REASONS.some((r) => /OTHER|MISC/i.test(r)));

    check(
      '手がかりが無ければ落とす',
      cheapFilter({ buyPrice: 1000, sellPrice: 5000, roughFeeRate: ROUGH_FEE_RATE_DEFAULT, hasIdentifier: false }).reason === 'NO_IDENTIFIER',
    );
    check(
      '比べる相場が無ければ落とす',
      cheapFilter({ buyPrice: 1000, sellPrice: null, roughFeeRate: ROUGH_FEE_RATE_DEFAULT, hasIdentifier: true }).reason === 'NO_MARKET_PRICE',
    );
    check(
      '明らかな赤字は落とす',
      cheapFilter({ buyPrice: 5000, sellPrice: 5000, roughFeeRate: ROUGH_FEE_RATE_DEFAULT, hasIdentifier: true }).reason === 'OBVIOUS_LOSS',
    );
    check(
      '見込みのあるものは次へ進む',
      cheapFilter({ buyPrice: 1000, sellPrice: 5000, roughFeeRate: ROUGH_FEE_RATE_DEFAULT, hasIdentifier: true }).pass,
    );
    check(
      '仕入価格がまだ無い段でも止めない',
      cheapFilter({ buyPrice: null, sellPrice: 5000, roughFeeRate: ROUGH_FEE_RATE_DEFAULT, hasIdentifier: true }).pass,
    );
  }

  // ================================================================
  console.log('\n【11】調べる順番の点数は、材料の無い軸を0点にしない（§18）');
  {
    check('軸は7つ', RESEARCH_SCORE_AXES.length === 7);
    check('重みの合計が100', RESEARCH_SCORE_AXES.reduce((a, b) => a + b.weight, 0) === 100);

    const full = researchPriorityScore({
      priceGap: 1, demand: 1, competition: 1, dataConfidence: 1, matchability: 1, sellSpeed: 1, expectedProfit: 1,
    });
    check('全部そろっていれば100点', full.score === 100 && full.coverage === 1);

    const partial = researchPriorityScore({ priceGap: 1, demand: 1 });
    check('材料の無い軸を0点として足さない', partial.score === 100, `${partial.score}点`);
    check('どれだけ材料がそろっていたかを必ず返す', partial.coverage > 0 && partial.coverage < 1);
    check('材料なしの軸は理由に出す', partial.detailsJa.some((d) => /材料なし/.test(d)));

    const none = researchPriorityScore({});
    check('材料が1つも無ければ0点・材料0割', none.score === 0 && none.coverage === 0);

    const bonus = researchPriorityScore({ priceGap: 0.5 }, NEW_LISTING_PRIORITY_BONUS);
    check('新着は上乗せされる', bonus.noveltyBonus === NEW_LISTING_PRIORITY_BONUS);
    check('点数は100を超えない', researchPriorityScore({ priceGap: 1 }, 50).score === 100);
  }

  // ================================================================
  console.log('\n【12】費用をかけて調べてよいかの蛇口（§46）');
  {
    check(
      '材料が足りなければ調べない',
      !maySpendOnResearch({ score: 90, coverage: 0.2, expectedProfitJpy: 100000, costJpy: 10 }).ok,
    );
    check(
      `点数が${RESEARCH_SPEND_MIN_SCORE}点に届かなければ調べない`,
      !maySpendOnResearch({ score: RESEARCH_SPEND_MIN_SCORE - 1, coverage: 1, expectedProfitJpy: 100000, costJpy: 10 }).ok,
    );
    check(
      '見込み利益が分からなければ調べない',
      !maySpendOnResearch({ score: 90, coverage: 1, expectedProfitJpy: null, costJpy: 10 }).ok,
    );
    check(
      `見込み利益が費用の${RESEARCH_SPEND_MIN_PROFIT_MULTIPLE}倍に届かなければ調べない`,
      !maySpendOnResearch({ score: 90, coverage: 1, expectedProfitJpy: 100, costJpy: 10 }).ok,
    );
    check(
      '条件がそろえば調べる',
      maySpendOnResearch({ score: 90, coverage: 1, expectedProfitJpy: 100000, costJpy: 10 }).ok,
    );
    check('材料の割合の下限がある', RESEARCH_SCORE_MIN_COVERAGE > 0);

    // 1日の上限・1件あたりの上限（§46）
    check(
      '1件あたりの上限を超えたら調べない',
      !checkCostGate({ spentTodayJpy: 0, dailyLimitJpy: 500, thisProductCostJpy: 999, perProductLimitJpy: 20 }).ok,
    );
    check(
      '1日の上限を超えたら止まる',
      !checkCostGate({ spentTodayJpy: 500, dailyLimitJpy: 500, thisProductCostJpy: 10, perProductLimitJpy: 20 }).ok,
    );
    check(
      '上限の範囲内なら調べる',
      checkCostGate({ spentTodayJpy: 100, dailyLimitJpy: 500, thisProductCostJpy: 10, perProductLimitJpy: 20 }).ok,
    );
    check('上限の既定値がある', AI_COST_DEFAULTS.dailyLimitJpy > 0 && AI_COST_DEFAULTS.perProductLimitJpy > 0);
  }

  // ================================================================
  console.log('\n【13】AIと画像だけでは「同じ商品」と確定しない（§20・§21）');
  {
    check('照合の材料は6種類', MATCH_EVIDENCE_KINDS.length === 6);
    check('AIの判断だけでは確定しない', MATCH_EVIDENCE_CAN_CONFIRM_ALONE.AI_JUDGEMENT === false);
    check('画像の似かただけでは確定しない', MATCH_EVIDENCE_CAN_CONFIRM_ALONE.IMAGE_SIMILARITY === false);
    check('商品名の似かただけでは確定しない', MATCH_EVIDENCE_CAN_CONFIRM_ALONE.TEXT_SIMILARITY === false);
    check('型番だけでも確定しない', MATCH_EVIDENCE_CAN_CONFIRM_ALONE.MODEL_NUMBER === false);
    check('バーコードは確定してよい', MATCH_EVIDENCE_CAN_CONFIRM_ALONE.BARCODE === true);
    check('ASINは確定してよい', MATCH_EVIDENCE_CAN_CONFIRM_ALONE.ASIN === true);
    check('AI一致だけで買わない決まりが残っている', AI_MATCH_ALONE_CAN_BUY === false);
    check('画像だけで確定しない決まりが残っている', IMAGE_MATCH_ALONE_CAN_CONFIRM === false);

    check(
      '弱い材料をいくつ足しても確定しない',
      !judgeEvidence([
        { kind: 'AI_JUDGEMENT', strength: 0.99, noteJa: '' },
        { kind: 'IMAGE_SIMILARITY', strength: 0.99, noteJa: '' },
        { kind: 'TEXT_SIMILARITY', strength: 0.99, noteJa: '' },
      ]).canConfirm,
    );
    check(
      'バーコードが一致すれば確定する',
      judgeEvidence([{ kind: 'BARCODE', strength: 1, noteJa: '' }]).canConfirm,
    );
    check('材料が無ければ確定しない', !judgeEvidence([]).canConfirm);
    check('何を根拠にしたかを人が読める形で返す', judgeEvidence([{ kind: 'BARCODE', strength: 1, noteJa: '' }]).usedJa.length === 1);
  }

  // ================================================================
  console.log('\n【14】利益は「回転」と一緒に見る（§5・§23・§25・§26）');
  {
    check('売却確率は7日・30日・90日', SELL_HORIZONS.length === 3 && SELL_HORIZONS.includes(30));
    check(
      `実績が${SELL_PROBABILITY_MIN_SAMPLE}件未満なら確率にしない`,
      judgeSellProbability(30, 1, 2).probability === null,
    );
    check('実績の記録が無ければUNKNOWN扱い', judgeSellProbability(30, null, 100).probability === null);
    check('十分な件数があれば確率を出す', judgeSellProbability(30, 5, 10).probability === 0.5);

    const good = expectedProfitPer30d({
      expectedNetProfitJpy: 2000, expectedDaysToSell: 20, sellProbability30d: 1, capitalJpy: 10000,
    });
    check('30日あたりの利益を出せる', good.expectedProfitPer30dJpy === 3000, String(good.expectedProfitPer30dJpy));
    check('資金1万円あたりでも出せる', good.per30dPer10kJpy === 3000);

    check(
      '利益が分からなければ出さない',
      expectedProfitPer30d({ expectedNetProfitJpy: null, expectedDaysToSell: 20, sellProbability30d: 1, capitalJpy: 10000 }).expectedProfitPer30dJpy === null,
    );
    check(
      '売れるまでの日数が分からなければ出さない',
      expectedProfitPer30d({ expectedNetProfitJpy: 2000, expectedDaysToSell: null, sellProbability30d: 1, capitalJpy: 10000 }).expectedProfitPer30dJpy === null,
    );
    check(
      '売却確率が分からなければ出さない',
      expectedProfitPer30d({ expectedNetProfitJpy: 2000, expectedDaysToSell: 20, sellProbability30d: null, capitalJpy: 10000 }).expectedProfitPer30dJpy === null,
    );
    check(
      '1年を超えて寝るものは資金効率で並べない',
      expectedProfitPer30d({ expectedNetProfitJpy: 2000, expectedDaysToSell: MAX_DAYS_TO_SELL_FOR_VELOCITY + 1, sellProbability30d: 1, capitalJpy: 10000 }).expectedProfitPer30dJpy === null,
    );

    // ROIだけで並べない（§23）を数字で確かめる
    const highRoiSlow = expectedProfitPer30d({ expectedNetProfitJpy: 5000, expectedDaysToSell: 180, sellProbability30d: 1, capitalJpy: 10000 });
    const lowRoiFast = expectedProfitPer30d({ expectedNetProfitJpy: 2000, expectedDaysToSell: 20, sellProbability30d: 1, capitalJpy: 10000 });
    check(
      '利益は小さくても速く回る方が上に来る（ROIだけで並べない）',
      (lowRoiFast.expectedProfitPer30dJpy ?? 0) > (highRoiSlow.expectedProfitPer30dJpy ?? 0),
    );

    check(
      'データの確からしさが分からなければ点数を出さない',
      objectiveValue({ expectedProfitPer30dJpy: 3000, dataConfidence: null, riskAdjust: 1 }).value === null,
    );
    check(
      '確からしさが低いものは沈む',
      (objectiveValue({ expectedProfitPer30dJpy: 3000, dataConfidence: 0.3, riskAdjust: 1 }).value ?? 0)
        < (objectiveValue({ expectedProfitPer30dJpy: 3000, dataConfidence: 1, riskAdjust: 1 }).value ?? 0),
    );
    check('何が欠けているかを返す', objectiveValue({ expectedProfitPer30dJpy: null, dataConfidence: null, riskAdjust: null }).missingJa.length === 3);
  }

  // ================================================================
  console.log('\n【15】1つに寄せすぎない（§27・§28）');
  {
    check('上限は同じ商品・ブランド・カテゴリの3つ', Object.keys(EXPOSURE_DEFAULTS).length === 3);
    check('同じ商品の上限がいちばん厳しい', EXPOSURE_DEFAULTS.sku < EXPOSURE_DEFAULTS.brand);
    check('ブランドはカテゴリより厳しい', EXPOSURE_DEFAULTS.brand < EXPOSURE_DEFAULTS.category);

    check('上限内なら通る', checkExposure('sku', 0, 10000, 100000).ok);
    check('上限を超えたら見送る', !checkExposure('sku', 15000, 10000, 100000).ok);
    check('総資金が無ければ判定できない（0%と書かない）', checkExposure('sku', 0, 1, 0).currentRatio === null);

    const alloc = allocateCapital(
      [
        { id: 'a', labelJa: 'P5ONLY-A', capitalJpy: 10000, objectiveValue: 5000, skuKey: 's1', brandKey: 'b1', categoryKey: 'c1' },
        { id: 'b', labelJa: 'P5ONLY-B', capitalJpy: 10000, objectiveValue: 1000, skuKey: 's2', brandKey: 'b2', categoryKey: 'c2' },
        { id: 'c', labelJa: 'P5ONLY-C', capitalJpy: 10000, objectiveValue: null, skuKey: 's3', brandKey: 'b3', categoryKey: 'c3' },
      ],
      100000,
    );
    check('点数の高いものが先に選ばれる', alloc.picks[0]?.id === 'a');
    check('点数の出せない候補は配分に入れない', !alloc.picks.some((p) => p.id === 'c'));
    check('入らなかった理由を返す', alloc.skippedJa.length > 0);
    check('使った資金と残りが合う', alloc.usedCapitalJpy + alloc.remainingCapitalJpy === 100000);

    // 同じ商品へ寄せようとしても上限で止まる
    const same = allocateCapital(
      Array.from({ length: 5 }, (_, i) => ({
        id: `x${i}`, labelJa: `P5ONLY-X${i}`, capitalJpy: 10000, objectiveValue: 5000,
        skuKey: 'same', brandKey: 'same', categoryKey: 'same',
      })),
      100000,
    );
    check('同じ商品へ寄せすぎない', same.usedCapitalJpy <= 100000 * EXPOSURE_DEFAULTS.sku);
  }

  // ================================================================
  console.log('\n【16】値下がり待ちと、仕入先探し待ち（§14・§15・§40）');
  {
    check('見張る状態は4つ', WATCH_STATES.length === 4);

    const profit = judgeWatch({
      currentBuyPriceJpy: 10000, thresholdBuyPriceJpy: 12000,
      currentNetProfitJpy: 5000, minNetProfitJpy: 3000, daysWatched: 999, ruleVersionChanged: false,
    });
    check('利益が出ていれば期限切れより先に拾う', profit.state === 'PROFIT_OPPORTUNITY');

    const reached = judgeWatch({
      currentBuyPriceJpy: 10000, thresholdBuyPriceJpy: 12000,
      currentNetProfitJpy: null, minNetProfitJpy: 3000, daysWatched: 1, ruleVersionChanged: false,
    });
    check('決めた値段まで下がったら知らせる', reached.state === 'BUY_THRESHOLD_REACHED');

    const waiting = judgeWatch({
      currentBuyPriceJpy: 20000, thresholdBuyPriceJpy: 12000,
      currentNetProfitJpy: null, minNetProfitJpy: 3000, daysWatched: 1, ruleVersionChanged: false,
    });
    check('まだ届かないものは待つ', waiting.state === 'WATCHING');
    check('あといくら下がればよいかを出す', waiting.gapToThresholdJpy === 8000);
    check('「下がりそう」とは言わない', !/下がりそう|下がるでしょう|見込みです/.test(waiting.reasonJa));

    const expired = judgeWatch({
      currentBuyPriceJpy: 20000, thresholdBuyPriceJpy: 12000,
      currentNetProfitJpy: null, minNetProfitJpy: 3000, daysWatched: WATCH_EXPIRY_DAYS, ruleVersionChanged: false,
    });
    check(`${WATCH_EXPIRY_DAYS}日で見るのをやめる`, expired.state === 'EXPIRED');

    check(
      'しきい値の版が変わったら決め直す',
      judgeWatch({ currentBuyPriceJpy: 20000, thresholdBuyPriceJpy: 12000, currentNetProfitJpy: null, minNetProfitJpy: 3000, daysWatched: 1, ruleVersionChanged: true }).reasonJa.includes('しきい値'),
    );
    check('未来の値段を予測しない決まりが残っている', WATCH_PREDICTS_FUTURE_PRICE === false);

    check('値段が分からなければ見張らない', !mayStartWatching(null, 12000).ok);
    check('開きが大きすぎるものは見張らない', !mayStartWatching(100000, 12000).ok);
    check('現実的な差なら見張る', mayStartWatching(13000, 12000).ok);
    check('すでに買ってよい値段なら通す', mayStartWatching(10000, 12000).ok);

    check('仕入先探し待ちの理由は4つ', PENDING_REASONS.length === 4);
    check(
      'どの理由にも「次に何をすれば進むか」がある',
      PENDING_REASONS.every((r) => pendingNextStepJa(r).length > 0),
    );
  }

  // ================================================================
  console.log('\n【17】調べた件数ではなく、見つけた利益で評価する（§47・§48）');
  {
    check('ファネルは4段', EFFECTIVENESS_STEPS.length === 4);

    const f = buildEffectivenessFunnel({
      RESEARCHED_PRODUCTS: 100, MATCHED_PRODUCTS: 30, PROFITABLE_ROUTES: 5, BUY_OPPORTUNITIES: 2,
    });
    check('ファネルは減っていく', f.monotonic);
    check('最初の段には残存率が無い', f.rows[0].survivalRate === null);
    check('残存率を計算できる', f.rows[1].survivalRate === 0.3);

    const broken = buildEffectivenessFunnel({
      RESEARCHED_PRODUCTS: 10, MATCHED_PRODUCTS: 30, PROFITABLE_ROUTES: 5, BUY_OPPORTUNITIES: 2,
    });
    check('増えていたら壊れていると言う', !broken.monotonic && broken.warningsJa.length > 0);

    const zero = buildEffectivenessFunnel({
      RESEARCHED_PRODUCTS: 0, MATCHED_PRODUCTS: 0, PROFITABLE_ROUTES: 0, BUY_OPPORTUNITIES: 0,
    });
    check('分母0を0%と書かない（ルール116）', zero.rows[1].survivalRate === null && zero.rows[1].overallRate === null);

    const eff = computeEfficiency({
      researchedProducts: 1000, buyOpportunities: 0, expectedProfitJpy: null, apiCostJpy: 100, humanMinutes: 30,
    });
    check('購入候補が0件なら1件あたりの費用は出さない', eff.apiCostPerBuyOpportunity === null);
    check('購入候補が0件なら1件あたりの人の時間も出さない', eff.humanMinutesPerBuyOpportunity === null);
    check('見込み利益が無ければ1,000件あたりも出さない', eff.profitPer1000Researched === null);
    check('出せない理由を日本語で書く', eff.linesJa.every((l) => l.length > 0));

    const eff2 = computeEfficiency({
      researchedProducts: 1000, buyOpportunities: 5, expectedProfitJpy: 50000, apiCostJpy: 100, humanMinutes: 30,
    });
    check('材料がそろえば1,000件あたりの利益を出す', eff2.profitPer1000Researched === 50000);
    check('購入候補1件あたりの費用を出す', eff2.apiCostPerBuyOpportunity === 20);
    check('かけた費用の何倍かを出す', eff2.returnOnResearch === 500);

    const lines = morningSummaryLinesJa({
      researchedProducts: 0, profitCandidates: 0, buyCount: 0, strongBuyCount: 0,
      needsAttentionCount: 0, requiredCapitalJpy: 0, conservativeProfitJpy: null,
      dataNoteJa: 'まだ材料がありません。',
    });
    check('朝の要約は0件でも正直に0と出す', lines.some((l) => /0件/.test(l)));
    check('材料が無ければ予想利益を出さない', lines.some((l) => /出しません/.test(l)));
    check('指示書の見本の数字をそのまま出していない（ルール63）', !lines.some((l) => /82,431|1,420,000|284,000/.test(l)));
  }

  // ================================================================
  console.log('\n【18】負けも学習し、しきい値はAIが動かさない（§49・§50・ルール129）');
  {
    check('結果の種類は5つ', LEARNING_OUTCOMES.length === 5);
    check('見送って外した分がある', LEARNING_OUTCOMES.includes('MISSED'));
    check('負けた分がある', LEARNING_OUTCOMES.includes('LOST'));

    const few = judgeLearning({
      labelJa: 'P5ONLY-カテゴリ',
      counts: { WON: 2, LOST: 1, NOT_BOUGHT: 50, MISSED: 0, UNKNOWN: 3 },
    });
    check(`${LEARNING_MIN_SAMPLE}件未満ならしきい値を動かさない`, few.mayAdjustThresholds === false);
    check('件数が足りなければ勝率も出さない', few.winRate === null);

    const enough = judgeLearning({
      labelJa: 'P5ONLY-カテゴリ',
      counts: { WON: 6, LOST: 3, NOT_BOUGHT: 50, MISSED: 1, UNKNOWN: 3 },
    });
    check('件数がそろえば勝率を出す', enough.winRate === 0.6, String(enough.winRate));
    check('見送って外した分も勝率の分母に入れる', enough.decided === 10);
    check('しきい値の自動変更は実装していない', AUTO_THRESHOLD_CHANGE_IMPLEMENTED === false);
  }

  // ================================================================
  console.log('\n【19】頻度は相手の決まりに合わせる・止まる条件を持つ（§29・§52-9）');
  {
    check('見張る用件は4つ', WATCH_JOBS.length === 4);
    check('余裕を残して回す', SCHEDULE_SAFETY_MARGIN < 1);

    check(
      '頻度が分からない口は回さない',
      planSchedule({ jobKey: 'NEW_LISTING', rateLimitPerMinute: null, callsPerRun: 10, dailyCallCap: null, safetyMargin: SCHEDULE_SAFETY_MARGIN }).intervalMinutes === null,
    );
    const s = planSchedule({ jobKey: 'NEW_LISTING', rateLimitPerMinute: 20, callsPerRun: 10, dailyCallCap: null, safetyMargin: SCHEDULE_SAFETY_MARGIN });
    check('頻度が分かれば間隔を出す', s.intervalMinutes !== null);
    check(`どんなに急いでも${MIN_INTERVAL_MINUTES}分より短くしない`, (s.intervalMinutes ?? 0) >= MIN_INTERVAL_MINUTES);
    check('急がない用件はもっと長い間隔にする', (planSchedule({ jobKey: 'DEMAND_CHANGE', rateLimitPerMinute: 20, callsPerRun: 10, dailyCallCap: null, safetyMargin: SCHEDULE_SAFETY_MARGIN }).intervalMinutes ?? 0) > (s.intervalMinutes ?? 0));
    check(
      '1日の上限があればそちらでも縛る',
      (planSchedule({ jobKey: 'NEW_LISTING', rateLimitPerMinute: 20, callsPerRun: 10, dailyCallCap: 100, safetyMargin: SCHEDULE_SAFETY_MARGIN }).intervalMinutes ?? 0) > (s.intervalMinutes ?? 0),
    );

    check('止まる条件は6つ', SAFETY_STOP_REASONS.length === 6);
    const baseStop = {
      spentTodayJpy: 0, dailyBudgetJpy: 500, anyRateLimitUnknown: false, anyConnectorNotReady: false,
      oldestDataAgeHours: 1, maxDataAgeHours: 720, incorrectMatchCount: 0, funnelCounts: [100, 30, 5, 2],
    };
    check('問題が無ければ止まらない', !checkSafetyStops(baseStop).stop);
    check('費用の上限に達したら止まる', checkSafetyStops({ ...baseStop, spentTodayJpy: 500 }).stop);
    check('頻度の分からない口があれば止まる', checkSafetyStops({ ...baseStop, anyRateLimitUnknown: true }).stop);
    check('データが古すぎれば止まる', checkSafetyStops({ ...baseStop, oldestDataAgeHours: 99999 }).stop);
    check('取り違えは1件でも止まる（ルール48）', checkSafetyStops({ ...baseStop, incorrectMatchCount: 1 }).stop);
    check('ファネルが増えていたら止まる', checkSafetyStops({ ...baseStop, funnelCounts: [10, 30] }).stop);
    check('止まった理由は日本語で返る', checkSafetyStops({ ...baseStop, incorrectMatchCount: 1 }).reasonsJa.length > 0);

    check('止められていれば回さない', !mayRunNow({ intervalMinutes: 60, minutesSinceLastRun: 999, safetyStopped: false, safetyReasonsJa: [], enabled: false }).run);
    check('安全停止は時間より強い', !mayRunNow({ intervalMinutes: 60, minutesSinceLastRun: 999, safetyStopped: true, safetyReasonsJa: ['x'], enabled: true }).run);
    check('間隔が決まっていなければ回さない', !mayRunNow({ intervalMinutes: null, minutesSinceLastRun: 999, safetyStopped: false, safetyReasonsJa: [], enabled: true }).run);
    check('時間がたっていれば回す', mayRunNow({ intervalMinutes: 60, minutesSinceLastRun: 61, safetyStopped: false, safetyReasonsJa: [], enabled: true }).run);
    check('まだなら待つ', !mayRunNow({ intervalMinutes: 60, minutesSinceLastRun: 10, safetyStopped: false, safetyReasonsJa: [], enabled: true }).run);

    check('回してよいのは調べる・見張る・報告するの3つ', SCHEDULER_ALLOWED_ACTIONS.length === 3);
    check('口が0件のときを異常扱いにしない', schedulerStatusJa(0, 0).some((l) => /何も回しません/.test(l)));
  }

  // ================================================================
  console.log('\n【20】買う・出品する・支払う・送るは、コードとして存在しない（§53）');
  {
    check('自動購入は実装していない', AUTO_PURCHASE_IMPLEMENTED === false);
    check('自動出品は実装していない', AUTO_LISTING_IMPLEMENTED === false);
    check('自動決済は実装していない', AUTO_PAYMENT_IMPLEMENTED === false);
    check('自動発送は実装していない', AUTO_SHIPPING_IMPLEMENTED === false);
    check('Schedulerも買えない', SCHEDULER_CAN_PURCHASE === false);
    check('Schedulerも出品できない', SCHEDULER_CAN_LIST === false);
    check('Schedulerも支払えない', SCHEDULER_CAN_PAY === false);
    check('Schedulerも送れない', SCHEDULER_CAN_SHIP === false);

    for (const f of ALL_PHASE5_FILES) {
      const src = codeOnly(readFile(f));
      check(
        `${f} に購入・決済のコードが無い`,
        !/(placeOrder|createOrder|submitOrder|checkout|stripe|paypal|charge\()/i.test(src),
      );
      check(`${f} がURLを組み立てていない`, !/amazon\.co\.jp\/dp|\/dp\/\$\{/.test(src));
    }
  }

  // ================================================================
  console.log('\n【21】画面へそのまま載せられる形を保つ（ルール37）');
  {
    for (const f of PURE_FILES) {
      const src = codeOnly(readFile(f));
      check(`${f} は何もimportしない`, !/^\s*import\s/m.test(src));
    }
    const storeSrc = codeOnly(readFile('lib/phase5/store.ts'));
    check('DBとつながるのは store.ts だけ', /from '\.\.\/db\/client'/.test(storeSrc));
    for (const f of PURE_FILES) {
      check(`${f} はDBに触らない`, !/db\/client/.test(readFile(f)));
    }
  }

  // ================================================================
  console.log('\n【22】表の形と、記録の残し方');
  {
    const schema = readFile('lib/db/schema.ts');
    check('自動リサーチの記録の表がある', /CREATE TABLE IF NOT EXISTS research_runs/.test(schema));
    check('候補の表がある', /CREATE TABLE IF NOT EXISTS research_candidates/.test(schema));
    check('仕入先探し待ちの表がある（§40）', /CREATE TABLE IF NOT EXISTS supplier_search_pending/.test(schema));
    check('同じ出品を二重に入れない', /UNIQUE\s*\(\s*candidate_key\s*\)/.test(schema));
    check('同じ商品を二重に貯めない', /UNIQUE\s*\(\s*sell_side_venue\s*,\s*sell_side_id\s*\)/.test(schema));
    check('通信したかどうかを記録する', /network_used/.test(schema));
    check('費用と件数を同じ行に持つ', /api_cost_jpy/.test(schema) && /researched_products/.test(schema));
    check(
      '購入・出品・決済・発送の表は作っていない',
      !/CREATE TABLE[^\n]*(purchase_orders|listings_published|payments|shipments)/i.test(schema),
    );

    const settings = readFile('lib/settings.ts');
    check('需要の条件は設定で変えられる', /RESEARCH_DEMAND_MIN_RANK_DROPS_30/.test(settings));
    check('1日の費用上限は設定で変えられる', /RESEARCH_AI_DAILY_LIMIT_JPY/.test(settings));
    check('自動リサーチの版は他と混ぜない', /a1-\$\{/.test(settings));

    const storeSrc = codeOnly(readFile('lib/phase5/store.ts'));
    check('見本の印が付いた行を判定から外す', /SAMPLE_MARKERS/.test(storeSrc));
    check('保存済みデータだけを読んでいる', /FROM keepa_products/.test(storeSrc));
    check('購入候補は0件のまま保存している', /PARK_STATE_SUPPLIER_SEARCH_PENDING|SUPPLIER_SEARCH_PENDING/.test(readFile('lib/phase5/store.ts')));
    check('人が手で入れる経路を消していない（§35）', fs.existsSync(path.join(decodeURIComponent(ROOT), 'lib/phase4/supplier.ts')));
  }

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 5（AUTO RESEARCH ORCHESTRATOR）の受け入れ条件をすべて満たしています。');
  console.log('※ このテストは外部へ一切アクセスしません（DBにも書き込みません）。');
  console.log('※ スクレイピングは「取り方」の選択肢として存在しません。');
  console.log('※ 自動購入・自動出品・自動決済・自動発送は、コードとして存在しません。');
  console.log('※ 人が10件入れる経路（MANUAL_SUPPLIER_FALLBACK）は残したままです。');
}

main();
