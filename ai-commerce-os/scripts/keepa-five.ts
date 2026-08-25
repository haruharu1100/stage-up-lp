/**
 * 【Keepa 5件実測テスト】（Phase 3.12・2026-08-25）
 *
 *   npm run keepa:five            … 実際に取得する（枠を 12 + 5 = 17 使う）
 *   npm run keepa:five -- --dry   … 通信せず、条件と見積もりだけ表示する（枠0）
 *
 * ------------------------------------------------------------------
 * 【このテストの目的】
 *
 * ご本人の指示（原文）：
 *   「5件で特に確認するSchema　price fields / csv arrays / stats / offers / availability /
 *     outOfStockPercentage / fees / salesRanks / images / identifiers の
 *     実際の型が商品ごとにどう違うか。」
 *
 * ★目的は「売れる商品を5件見つけること」ではない。
 *   **1件では分からなかったこと＝商品ごとの形の違いを見つけること**が目的である。
 *   ルール95（在庫切れ割合が配列で来ていたのに1つの数だと思っていた）は、
 *   1件しか見ていなかったために起きた。5件を横に並べて初めて分かることがある。
 *
 * ------------------------------------------------------------------
 * 【枠（Token）の内訳】
 *
 *   Stage 1  分類の一覧            1   （CATEGORY_LOOKUP）
 *   Stage 2  候補探し（1回だけ）  11   （DISCOVERY = 10 + 結果100件ごとに1）
 *   Stage 4  下見 1件×5枠          5   （PRODUCT_FETCH）
 *   ------------------------------------------------
 *   合計                          17
 *
 * ★Deep Scan（Buy Box・出品者一覧）は**一切実行しない**。
 *   候補を挙げるところまでで止まる（KEEPA_DEEP_SCAN_AUTO_EXECUTE = false）。
 *
 * ------------------------------------------------------------------
 * 【5件終了後は必ず止まる】
 *
 * ご本人の指示（原文）：
 *   「5件終了後、必ず停止してください。」
 *   「20件へは進まない　結果を見て、5 → 20 へ進めるか判断します。自動で進まないこと。」
 */
import { loadDotEnv } from '../lib/dotenv';
import {
  discoverAsinCandidates,
  fetchKeepaProducts,
  fetchKeepaRootCategories,
  keepaKeyStatus,
} from '../lib/keepa/client';
import {
  KEEPA_CURRENT_STAGE,
  KEEPA_DISCOVERY_COSTS,
  KEEPA_DISCOVERY_PER_PAGE,
  KEEPA_DOMAIN_JP,
  KEEPA_FRESHNESS_MAX_DAYS,
  KEEPA_MAX_ASINS_PER_RUN,
  KEEPA_MAX_DISCOVERY_TOKENS,
  KEEPA_USE_SCOPE_JA,
} from '../lib/keepa/policy';
import {
  auditFieldShapes,
  discoverOneCandidate,
  findShapeDrift,
  lookupAsinProvenance,
  lookupRootCategories,
  runOneAsin,
  saveFieldShapes,
  tokenLedgerSince,
  tokenMonitor,
  type ShapeAudit,
} from '../lib/keepa/store';
import {
  buyBoxRequiredForDecision,
  deepScanGate,
  judgeFiveItemGate,
  usefulDataPerToken,
  KEEPA_AUTO_ADVANCE_STAGE,
  KEEPA_CHEAP_SCAN_FIELDS,
  KEEPA_DEEP_SCAN_AUTO_EXECUTE,
  KEEPA_DEEP_SCAN_MAX_CANDIDATES,
  KEEPA_SHAPE_WATCH_GROUPS,
  KEEPA_TOKEN_BUCKET_JA,
  type DeepScanGateResult,
} from '../lib/keepa/scan';
import { KEEPA_SHAPE_JA, UNKNOWN_REASON_JA } from '../lib/keepa/schema';
import { SELLABILITY_VERDICT_JA } from '../lib/sellability';
import { ASIN_CONFIDENCE_JA, ASIN_SOURCE_JA } from '../lib/keepa/asinsource';
import type { OneAsinReport } from '../lib/keepa/store';

const LINE = '='.repeat(76);
const THIN = '-'.repeat(76);

function has(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function yen(v: number | null | undefined): string {
  return typeof v === 'number' ? `${v.toLocaleString()}円` : '不明';
}

function num(v: number | null | undefined): string {
  return typeof v === 'number' ? String(v) : '不明';
}

/* ================================================================
 * Stage 1 用：欲しい売り場の「言葉」（番号ではない）
 * ================================================================ */

/**
 * 【なぜ番号を書かないのか】
 *
 * ご本人の指示（原文）：
 *   「本 / 家電 / ゲーム / 日用品 / ホビー のように、ジャンルを散らしてください。」
 *
 * ★Amazonの分類番号を推測で書くと、**間違っていても検索は成功する**。
 *   返ってくる商品は実在するので、間違いに気づく機会が一度も無い。
 *   「本のつもりが実は文房具だった」まま5件テストを終えることになる。
 *   そこで1枠払って公式の一覧をもらい、**返ってきた名前**と突き合わせて番号を決める。
 *
 * 下にあるのは番号ではなく、名前に含まれていてほしい言葉である。
 */
const WANTED_GENRES: { key: string; labelJa: string; keywords: string[] }[] = [
  { key: 'BOOKS', labelJa: '本', keywords: ['本'] },
  { key: 'ELECTRONICS', labelJa: '家電', keywords: ['家電', 'カメラ'] },
  { key: 'GAMES', labelJa: 'ゲーム', keywords: ['ゲーム', 'テレビゲーム'] },
  { key: 'DAILY', labelJa: '日用品', keywords: ['ドラッグストア', 'ビューティー', '日用品'] },
  { key: 'HOBBY', labelJa: 'ホビー', keywords: ['ホビー', 'おもちゃ'] },
];

type PickedCategory = {
  key: string;
  labelJa: string;
  catId: string;
  officialName: string;
};

/**
 * 公式の一覧（名前つき）から、欲しいジャンルに当たるものを選ぶ。
 *
 * ★見つからないジャンルは**飛ばす。番号を作らない。**
 *   「たぶんこれだろう」で埋めた瞬間、このStageを作った意味が消える。
 */
function pickCategories(
  categories: { catId: string; name: string; productCount: number | null }[],
): { picked: PickedCategory[]; missing: string[] } {
  const picked: PickedCategory[] = [];
  const missing: string[] = [];
  const used = new Set<string>();

  for (const g of WANTED_GENRES) {
    const hit = categories.find(
      (c) => !used.has(c.catId) && g.keywords.some((k) => String(c.name ?? '').includes(k)),
    );
    if (hit) {
      used.add(hit.catId);
      picked.push({ key: g.key, labelJa: g.labelJa, catId: hit.catId, officialName: hit.name });
    } else {
      missing.push(g.labelJa);
    }
  }

  return { picked, missing };
}

/* ================================================================
 * Stage 2 用：候補の条件
 * ================================================================ */

/**
 * `scripts/keepa-discover.ts` の条件をそのまま使い、売り場（rootCategory）だけ足す。
 *
 * ★条件を「1件も返らなかったから」といって緩めない。
 *   緩めれば必ず何か返るが、それは条件を満たした商品ではない。
 */
function buildSelection(catIds: string[]): Record<string, unknown> {
  const nowKeepaMinutes = Math.floor(Date.now() / 60000) - 21564000;
  const daysAgo = (d: number) => nowKeepaMinutes - d * 24 * 60;

  return {
    // ---- ジャンルを散らす（Stage 1 で公式の一覧から決めた番号だけ） ----
    rootCategory: catIds.map((c) => Number(c)),

    // ---- 新しさ（鮮度30日の線は動かさない） ----
    lastUpdate_gte: daysAgo(3),
    lastPriceChange_gte: daysAgo(60),

    // ---- 現在価格が存在する（新品） ----
    current_NEW_gte: 1000,
    current_NEW_lte: 30000,

    // ---- 新品Offerが複数ある ----
    current_COUNT_NEW_gte: 3,
    current_COUNT_NEW_lte: 60,

    // ---- Buy Box のデータがある ----
    current_BUY_BOX_SHIPPING_gte: 1000,

    // ---- 価格履歴がある ----
    trackingSince_lte: daysAgo(180),

    // ---- 親ASINを避ける（実際に買える子ASIN・単品を選ぶ） ----
    productType: 0,
    hasParentASIN: false,

    // ---- 順位がある（＝売れている痕跡がある） ----
    current_SALES_gte: 1,
    current_SALES_lte: 200000,

    page: 0,
    perPage: KEEPA_DISCOVERY_PER_PAGE,
    sort: [['current_SALES', 'asc']],
    // ★stats は付けない（付けると +30 枠）。
  };
}

/**
 * 【50件の中から5件を選ぶ】
 *
 * ★点数を付けて選ばない。
 *   点数で選ぶと「なぜその5件なのか」を後から検算できず、
 *   「AIが良さそうな順に選んだ」という一番あてにならない根拠だけが残る。
 *   等間隔（先頭・1/4・中央・3/4・末尾）で取れば、選び方は誰でも再現できる。
 */
function pickFiveByStride(candidates: string[], want: number): string[] {
  if (candidates.length <= want) return [...candidates];
  const stride = Math.floor(candidates.length / want);
  const out: string[] = [];
  for (let i = 0; i < want; i += 1) {
    out.push(candidates[Math.min(i * stride, candidates.length - 1)]);
  }
  return Array.from(new Set(out));
}

/** 下見13項目のうち、実際に値が取れた数を数える（Deep Scan Gate の材料）。 */
function countCheapFields(r: OneAsinReport): number {
  const n = r.normalized;
  if (!n) return 0;
  const got: boolean[] = [
    n.title !== null,
    n.brand !== null,
    n.eanList.length > 0,
    n.model !== null,
    n.currentNewPrice !== null,
    n.currentUsedPrice !== null,
    n.currentSalesRank !== null,
    n.salesRankDrops30 !== null || n.salesRankDrops90 !== null,
    n.offerCountNew !== null,
    n.amazonRetailPresent !== 'UNKNOWN',
    n.outOfStockPercentage30 !== null || n.outOfStockPercentage90 !== null,
    n.fbaPickAndPackFee !== null || n.referralFeePercentage !== null,
    n.lastUpdateIso !== null,
  ];
  return got.filter(Boolean).length;
}

/** データが鮮度の線の内側か。分からなければ null（true に寄せない）。 */
function isDataFresh(r: OneAsinReport): boolean | null {
  const iso = r.normalized?.lastUpdateIso;
  if (!iso) return null;
  const days = (Date.now() - Date.parse(iso)) / 86400000;
  if (!Number.isFinite(days)) return null;
  return days <= KEEPA_FRESHNESS_MAX_DAYS;
}

/* ================================================================
 * 本体
 * ================================================================ */

async function main(): Promise<void> {
  const names = loadDotEnv();
  const dry = has('dry');
  const startedAt = new Date().toISOString();
  const runId = `FIVE-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`;

  const wantAsins = KEEPA_MAX_ASINS_PER_RUN; // 5（コードで縛ってある。設定では増やせない）

  console.log(LINE);
  console.log(`Keepa ${wantAsins}件実測テスト（読み取りのみ・購入も出品もしません）`);
  console.log(LINE);
  console.log(`  段階：${KEEPA_CURRENT_STAGE}（1回に取れるのは${wantAsins}件まで）`);
  console.log(`  用途：${KEEPA_USE_SCOPE_JA}`);
  console.log(`  実行の通し番号：${runId}`);

  /* ---------------------------------------------------------------
   * Stage 0：枠の確認（通信しない・0枠）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 0】いまの枠の残り（保存済みの記録から。通信しません）\n${THIN}`);
  const before = await tokenMonitor();
  console.log(`  ${before.headlineJa}`);

  const estimateDiscovery =
    KEEPA_DISCOVERY_COSTS.QUERY_BASE
    + Math.max(1, Math.ceil(KEEPA_DISCOVERY_PER_PAGE / 100)) * KEEPA_DISCOVERY_COSTS.QUERY_PER_100_ASINS;
  const estimateCategory = 1;
  const estimateFetch = wantAsins;
  const estimateTotal = estimateCategory + estimateDiscovery + estimateFetch;

  console.log('\n  【使う予定の枠】');
  console.log(`    Stage 1 分類の一覧　　：${estimateCategory}（用途 CATEGORY_LOOKUP）`);
  console.log(`    Stage 2 候補探し1回　　：${estimateDiscovery}（用途 DISCOVERY・上限${KEEPA_MAX_DISCOVERY_TOKENS}）`);
  console.log(`    Stage 4 下見 1×${wantAsins}件　：${estimateFetch}（用途 PRODUCT_FETCH）`);
  console.log(`    合計　　　　　　　　　：${estimateTotal}`);
  console.log('    ※ Deep Scan（Buy Box・出品者一覧）は実行しません。候補を挙げるだけです。');

  if (dry) {
    console.log(`\n${THIN}`);
    console.log('--dry のため、ここで終了します。通信していません。枠は1つも使っていません。');
    console.log('欲しい売り場（番号ではなく名前で探します）：');
    for (const g of WANTED_GENRES) {
      console.log(`  ・${g.labelJa}（名前に「${g.keywords.join('」か「')}」を含むもの）`);
    }
    console.log('\n見張る項目（10グループ）：');
    for (const g of KEEPA_SHAPE_WATCH_GROUPS) {
      console.log(`  ・${g.labelJa}：${g.paths.join(' , ')}`);
    }
    return;
  }

  const key = keepaKeyStatus();
  console.log(`\n  .env から読み込んだ変数：${names.length}件（名前だけ。値は表示しません）`);
  console.log(`  APIキー：${key.messageJa}`);
  if (!key.configured) {
    console.log('\n通信せずに終了します。');
    process.exit(1);
  }

  /* ---------------------------------------------------------------
   * Stage 1：分類の一覧（1枠）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 1】売り場の公式な一覧をもらう（1枠）\n${THIN}`);
  const cats = await lookupRootCategories({ fetchCategories: fetchKeepaRootCategories });
  console.log(`  見積もり：${cats.estimatedCost} ／ 実際に使った枠：${num(cats.tokensConsumed)}`);
  if (!cats.ok) {
    console.log(`\n【止まりました】${cats.stoppedReasonJa}`);
    console.log('  ★ここで番号を推測して先へ進むと、違う売り場を調べたまま気づけません。');
    process.exit(1);
  }
  console.log(`  返ってきた売り場：${cats.categories.length}件`);

  const { picked, missing } = pickCategories(cats.categories);
  console.log('\n  【突き合わせた結果】（番号は一度も推測していません）');
  for (const p of picked) {
    console.log(`    ${p.labelJa.padEnd(6, '　')} → ${p.officialName}（番号 ${p.catId}）`);
  }
  if (missing.length > 0) {
    console.log(`    見つからなかったジャンル：${missing.join(' / ')}（推測で埋めていません）`);
  }
  if (picked.length === 0) {
    console.log('\n【止まりました】欲しい売り場が1つも見つかりませんでした。');
    process.exit(1);
  }

  /* ---------------------------------------------------------------
   * Stage 2：候補探し（11枠・1回だけ）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 2】候補を1回だけ探す（${estimateDiscovery}枠）\n${THIN}`);
  const selection = buildSelection(picked.map((p) => p.catId));
  console.log('  条件（1件も返らなくても緩めません）：');
  for (const [k, v] of Object.entries(selection)) {
    console.log(`    ${k} = ${JSON.stringify(v)}`);
  }

  const disc = await discoverOneCandidate(selection, { discover: (s) => discoverAsinCandidates(s) });
  console.log(`\n  見積もり：${disc.estimatedCost} ／ 実際に使った枠：${num(disc.tokensConsumed)}`);
  if (!disc.ok) {
    console.log(`\n【止まりました】${disc.stoppedReasonJa}`);
    process.exit(1);
  }
  console.log(`  条件に合った商品の総数：${num(disc.totalResults)}`);
  console.log(`  受け取った候補：${disc.candidates.length}件（全部そのまま保存しました）`);

  /* ---------------------------------------------------------------
   * Stage 3：5件を選ぶ（0枠）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 3】${wantAsins}件を選ぶ（通信しません・0枠）\n${THIN}`);
  const chosen = pickFiveByStride(disc.candidates, wantAsins);
  console.log(`  選び方：等間隔（${disc.candidates.length}件から${chosen.length}件）。点数付けはしていません。`);
  console.log(`  選んだASIN：${chosen.join(' , ')}`);
  console.log('  ★出どころは引数で名乗らせません。保存済みの候補一覧から引きます。');

  /* ---------------------------------------------------------------
   * Stage 4：下見（1枠×5）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 4】1件ずつ下見する（1枠×${chosen.length}）\n${THIN}`);
  const reports: OneAsinReport[] = [];
  const skipped: { asin: string; reasonJa: string }[] = [];

  for (const asin of chosen) {
    const provenance = await lookupAsinProvenance(asin);
    if (!provenance) {
      skipped.push({ asin, reasonJa: '出どころの記録が見つかりませんでした。通信せずに飛ばしました。' });
      console.log(`  ${asin}：出どころの記録なし → 飛ばしました（枠は使っていません）`);
      continue;
    }
    const r = await runOneAsin(
      asin,
      null,
      { fetchProducts: (a) => fetchKeepaProducts(a) },
      { windowDays: 90, provenance },
    );
    reports.push(r);
    if (!r.ok) {
      console.log(`  ${asin}：${r.stoppedReasonJa}`);
    } else {
      console.log(`  ${asin}：取得しました（使った枠 ${num(r.tokens?.tokensConsumed)}）`);
    }
  }

  /* ---------------------------------------------------------------
   * Stage 5：形の監査（0枠）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 5】商品ごとに「形」がどう違うかを見る（通信しません・0枠）\n${THIN}`);
  const audits: ShapeAudit[] = [];
  for (const r of reports) {
    if (!r.rawProduct) continue;
    const a = auditFieldShapes(r.asin, r.rawProduct);
    await saveFieldShapes(runId, a, null);
    audits.push(a);
  }
  console.log(`  形を記録した商品：${audits.length}件 × ${KEEPA_SHAPE_WATCH_GROUPS.reduce((s, g) => s + g.paths.length, 0)}か所`);

  const drift = findShapeDrift(audits);
  const drifted = drift.filter((d) => d.drift);
  console.log(`  商品どうしで形が違った場所：${drifted.length}か所`);
  if (drifted.length > 0) {
    console.log('  ★「形が違う＝不具合」ではありません。本にはJANがあり家電には無い、は正常な違いです。');
    for (const d of drifted) {
      console.log(`\n    ${d.labelJa}（${d.path}）：${d.distinctShapes.map((s) => KEEPA_SHAPE_JA[s as keyof typeof KEEPA_SHAPE_JA] ?? s).join(' / ')}`);
      for (const b of d.byAsin) {
        const len = b.arrayLength === null ? '' : `・要素${b.arrayLength}個`;
        console.log(`      ${b.asin}：${KEEPA_SHAPE_JA[b.shape] ?? b.shape}${len}`);
      }
    }
  }

  /* ---------------------------------------------------------------
   * Stage 6：報告（0枠）
   * ------------------------------------------------------------- */
  console.log(`\n${LINE}\n【Stage 6】商品ごとの報告（21項目）\n${LINE}`);

  for (const r of reports) {
    const n = r.normalized;
    const tokensUsed = r.tokens?.tokensConsumed ?? 0;
    const useful = countCheapFields(r);
    const eff = usefulDataPerToken(useful, tokensUsed);

    console.log(`\n${THIN}`);
    console.log(`  1. ASIN　　　　　　　：${r.asin}`);
    console.log(`  2. 出どころ　　　　　：${r.provenance.asinSource}（${ASIN_SOURCE_JA[r.provenance.asinSource]}）`);
    console.log(`  3. 確信度　　　　　　：${r.provenance.asinConfidence}（${ASIN_CONFIDENCE_JA[r.provenance.asinConfidence]}）`);
    if (!r.ok) {
      console.log(`     取得できませんでした：${r.stoppedReasonJa}`);
      continue;
    }
    console.log(`  4. 商品名　　　　　　：${n?.title ?? '不明'}`);
    console.log(`  5. ブランド　　　　　：${n?.brand ?? '不明'}`);
    console.log(`  6. JAN/EAN　　　　　 ：${n && n.eanList.length > 0 ? n.eanList.join(' , ') : '不明'}`);
    console.log(`  7. 型番　　　　　　　：${n?.model ?? '不明'}`);
    console.log(`  8. いまの新品価格　　：${yen(n?.currentNewPrice)}`);
    console.log(`  9. いまの中古価格　　：${yen(n?.currentUsedPrice)}`);
    console.log(` 10. 売れ筋順位　　　　：${num(n?.currentSalesRank)}`);
    console.log(` 11. 順位の下落回数　　：30日 ${num(n?.salesRankDrops30)} ／ 90日 ${num(n?.salesRankDrops90)}`);
    console.log(`     ※ 下落回数は販売数そのものではありません（1回の注文で2個売れても1回のことがあります）。`);
    console.log(` 12. 新品の出品者数　　：${num(n?.offerCountNew)}`);
    console.log(` 13. Amazon本体の出品　：${n?.amazonRetailPresent ?? 'UNKNOWN'}`);
    console.log(` 14. 在庫切れだった割合：30日 ${num(n?.outOfStockPercentage30)}% ／ 90日 ${num(n?.outOfStockPercentage90)}%`);
    console.log(` 15. 手数料　　　　　　：FBA ${yen(n?.fbaPickAndPackFee)} ／ 紹介料 ${num(n?.referralFeePercentage)}%`);
    console.log(` 16. データの鮮度　　　：${n?.lastUpdateIso ?? '不明'}（線は${KEEPA_FRESHNESS_MAX_DAYS}日）`);
    console.log(` 17. 親か子か　　　　　：${r.variationRole}`);
    console.log(` 18. 売れるか判定　　　：${
      r.sellability
        ? `${SELLABILITY_VERDICT_JA[r.sellability.result.verdict]}（${r.sellability.result.verdict}）`
        : '出ていません'
    }`);
    if (r.sellability) {
      console.log(`     理由：${r.sellability.result.reason}`);
      console.log(`     推定需要シグナル：${num(r.sellability.result.estimatedDemandSignal)}（実販売数ではありません）`);
    }
    console.log(` 19. 不明だった項目　　：${n && n.unknownFields.length > 0 ? n.unknownFields.join(' / ') : 'なし'}`);
    if (n) {
      const notAvail = n.unknownDetails.filter((u) => u.reason === 'DATA_NOT_AVAILABLE').length;
      const parserErr = n.parserErrors.length;
      console.log(`     内訳：${UNKNOWN_REASON_JA.DATA_NOT_AVAILABLE} ${notAvail}件 ／ ${UNKNOWN_REASON_JA.PARSER_OR_SCHEMA_ERROR} ${parserErr}件`);
    }
    console.log(` 20. 使った枠　　　　　：${tokensUsed}（見積もり ${r.estimatedCost}）`);
    console.log(` 21. 枠あたりの材料数　：${
      eff.ratio === null ? '計算できません' : `${eff.usefulFields}項目 ÷ ${eff.tokens}枠 = ${eff.ratio.toFixed(1)}`
    }`);
    console.log(`     ※ ${eff.noteJa}`);

    if (r.anomaliesJa.length > 0) {
      console.log('     【人に見せるべきもの】');
      for (const a of r.anomaliesJa) console.log(`       ・${a}`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\n  【取得しなかったもの】`);
    for (const s of skipped) console.log(`    ${s.asin}：${s.reasonJa}`);
  }

  /* ---- 枠の集計（用途別） ---- */
  console.log(`\n${LINE}\n【枠の使い方】（用途ごとに分けて記録しています）\n${LINE}`);
  const led = await tokenLedgerSince(startedAt);
  for (const [k, v] of Object.entries(led.ledger)) {
    const ja = (KEEPA_TOKEN_BUCKET_JA as Record<string, string>)[k] ?? '合計';
    console.log(`  ${k.padEnd(20, ' ')} ${String(v).padStart(4, ' ')}　（${ja}）`);
  }
  console.log(`  用途に振り分けられなかった枠：${led.unclassified}（0であるべき数字です）`);
  const perProduct = reports.filter((r) => r.ok).length;
  if (perProduct > 0) {
    console.log(`  商品1件あたりの実費：${(led.ledger.TOTAL_TOKENS / perProduct).toFixed(1)}枠`);
    console.log('    ※ 候補探しの枠も含めた実費です。商品取得だけを見ると「1件1枠」に見えてしまいます。');
  }
  const after = await tokenMonitor();
  console.log(`\n  取得後の枠：${after.headlineJa}`);

  /* ---- 合格条件（6項目すべて0） ---- */
  const parserSchemaErrors = reports.reduce(
    (s, r) => s + (r.normalized?.parserErrors.length ?? 0) + (r.normalized?.schema.mismatches.length ?? 0),
    0,
  );
  const wrongMarketplace = reports.filter((r) => r.normalized && r.normalized.isJapan === false).length;
  const apiErrors = reports.filter((r) => !r.ok).length + skipped.length;
  const tokenEstimateMismatch = reports.filter(
    (r) => r.ok && typeof r.tokens?.tokensConsumed === 'number' && r.tokens.tokensConsumed !== r.estimatedCost,
  ).length;
  const falseAsin = reports.filter((r) => r.ok && !r.normalized?.asin).length;

  const gate = judgeFiveItemGate({
    apiErrors,
    parserSchemaErrors,
    wrongMarketplace,
    tokenEstimateMismatch,
    // ★キーは関数の外へ出る経路そのものが無い（ルール85）。ここは構造上0である。
    secretLeak: 0,
    falseAsin,
  });

  console.log(`\n${LINE}\n【${wantAsins}件テストの合格条件】\n${LINE}`);
  for (const row of gate.rows) {
    console.log(`  ${row.passed ? '○' : '×'} ${row.labelJa}：${row.value}件`);
  }
  console.log(`\n  ${gate.verdictJa}`);

  /* ---------------------------------------------------------------
   * Stage 7：Deep Scan候補（0枠・選ぶだけ）
   * ------------------------------------------------------------- */
  console.log(`\n${LINE}\n【Stage 7】深追いの候補（選ぶだけ。取得しません・0枠）\n${LINE}`);
  const bb = buyBoxRequiredForDecision('SELLABILITY_ONLY');
  console.log(`  Buy Box は要るか：${bb.required ? '要る' : '要らない'}`);
  console.log(`  理由：${bb.reasonJa}`);

  const gated: { asin: string; g: DeepScanGateResult }[] = [];
  for (const r of reports) {
    if (!r.ok) continue;
    const g = deepScanGate({
      dataFresh: isDataFresh(r),
      sellabilityVerdict: r.sellability?.result.verdict ?? null,
      cheapFieldsPresent: countCheapFields(r),
      parserErrorCount: r.normalized?.parserErrors.length ?? null,
    });
    gated.push({ asin: r.asin, g });
    console.log(`\n  ${r.asin}：${g.candidate ? '候補にできます' : '候補にしません'}`);
    for (const c of g.checksJa) {
      console.log(`    ${c.passed ? '○' : '×'} ${c.labelJa}：${c.detailJa}`);
    }
  }

  const candidates = gated.filter((x) => x.g.candidate).slice(0, KEEPA_DEEP_SCAN_MAX_CANDIDATES);
  console.log(`\n  深追いの候補（最大${KEEPA_DEEP_SCAN_MAX_CANDIDATES}件）：${
    candidates.length > 0 ? candidates.map((c) => c.asin).join(' , ') : 'なし'
  }`);
  console.log(`  自動で深追いするか：${KEEPA_DEEP_SCAN_AUTO_EXECUTE ? 'する' : 'しません（枠を使いません）'}`);
  console.log(`  下見の項目数：${KEEPA_CHEAP_SCAN_FIELDS.length}項目（このうち9項目以上が候補の条件）`);

  /* ---------------------------------------------------------------
   * Stage 8：停止
   * ------------------------------------------------------------- */
  console.log(`\n${LINE}\n【Stage 8】ここで止まります\n${LINE}`);
  console.log(`  次の段階へ自動で進むか：${KEEPA_AUTO_ADVANCE_STAGE ? '進む' : '進みません'}`);
  console.log('  20件へは進みません。結果を見て、進めるかどうかはご本人が決めてください。');
  console.log(`  取得先：Amazon.co.jp（domain=${KEEPA_DOMAIN_JP}）のみ。他の国は保存していません。`);
  console.log('  実購入・実出品・自動値上げは、コードごと存在しません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
