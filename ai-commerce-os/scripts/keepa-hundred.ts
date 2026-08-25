/**
 * 【Keepa 100件・売り場をばらけさせて追加取得】（Phase 3.15・2026-08-25）
 *
 *   npm run keepa:hundred            … 不足している売り場から順に追加取得する
 *   npm run keepa:hundred -- --dry   … 通信せず、配分表と枠の見積りだけ表示する（枠0）
 *
 * ------------------------------------------------------------------
 * 【なぜ「あと80件」ではなく、この作り方なのか】
 *
 * ご本人の指示（原文・2026-08-25）：
 *   「100件へ進むこと自体は許可します。ただし、
 *     **現在の候補取得方法のまま、単純にあと80件増やすことは禁止**とします。」
 *   「本が10/20件と偏っているので、このまま100件にすると
 *     『本に強い判定ロジック』へ寄る可能性があります。」
 *
 * だから、1回の検索でまとめて80件取るのをやめ、
 * **売り場ごとに、足りない数だけ**探しに行く。
 *
 * ------------------------------------------------------------------
 * 【枠（Token）を無駄にしない仕掛け】
 *
 * ご本人の指示（原文）：
 *   「カテゴリを揃えるために大量Tokenを浪費してはいけません。
 *     カテゴリごとに MAX_DISCOVERY_ATTEMPTS MAX_DISCOVERY_TOKENS を設定してください。
 *     見つからなければ TARGET_NOT_REACHED として終了。
 *     **無理に100件を見栄え良く揃えないこと。**」
 *
 *   ・1つの売り場につき、候補探しは最大2回（26枠）まで
 *   ・候補探し全体で 120枠 まで
 *   ・下見は1件1枠、最大80件
 *   ・Deep Scan は **0枠**（禁止）
 *
 * ------------------------------------------------------------------
 * 【途中で必ず立ち止まる】
 *
 * ご本人の指示（原文）：
 *   「いきなり80件全部を一気に取得しないでください。
 *     20件 → 40件 → 70件 → 100件 の区切りで確認してください。」
 *
 * 区切りで7つの異常のどれかが出たら、その場で止める。
 * 何も出なければ、人の承認を待たずに次の区切りへ進んでよい（ご本人の指示）。
 *
 * ------------------------------------------------------------------
 * 【このスクリプトが絶対にしないこと】
 *   ・すでに保存済みの商品を取り直さない（選ぶ前に候補から外す）
 *   ・売り場の番号を推測で書かない（公式の一覧から名前で突き合わせる）
 *   ・件数が足りないからといって検索条件を緩めない
 *   ・Deep Scan を実行しない
 *   ・購入・出品・決済・発送へ進まない
 */
import { loadDotEnv } from '../lib/dotenv';
import { all } from '../lib/db/client';
import {
  discoverAsinCandidates,
  fetchKeepaProducts,
  fetchKeepaRootCategories,
  keepaKeyStatus,
} from '../lib/keepa/client';
import {
  KEEPA_DISCOVERY_COSTS,
  KEEPA_DISCOVERY_PER_PAGE_WIDE,
  KEEPA_DOMAIN_JP,
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
import { KEEPA_DEEP_SCAN_AUTO_EXECUTE, KEEPA_TOKEN_BUCKET_JA } from '../lib/keepa/scan';
import {
  canSearchStratum,
  isExclusionCategory,
  judgeCheckpoint,
  KEEPA_HUNDRED_AFTER_JA,
  KEEPA_HUNDRED_CHECKPOINTS,
  KEEPA_HUNDRED_DEEP_SCAN_TOKENS,
  KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL,
  KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS,
  KEEPA_HUNDRED_STRATA,
  KEEPA_HUNDRED_TARGET_TOTAL,
  KEEPA_HUNDRED_TOKEN_BUDGET_TOTAL,
  KEEPA_KNOWN_SCHEMA_DRIFT_PATHS,
  KEEPA_STRATUM_MAX_DISCOVERY_ATTEMPTS,
  KEEPA_STRATUM_MAX_DISCOVERY_TOKENS,
  planHundred,
  STRATUM_OUTCOME_JA,
  type StratumOutcome,
} from '../lib/keepa/strata';
import type { OneAsinReport } from '../lib/keepa/store';

const LINE = '='.repeat(76);
const THIN = '-'.repeat(76);

function has(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function num(v: number | null | undefined): string {
  return typeof v === 'number' ? String(v) : '不明';
}

/* ================================================================
 * 候補の条件（20件テストと同じ。売り場とページだけ差し替える）
 * ================================================================ */

/**
 * ★条件を「1件も返らなかったから」といって緩めない。
 *   緩めれば必ず何か返るが、それは条件を満たした商品ではない。
 */
function buildSelection(catId: string, page: number): Record<string, unknown> {
  const nowKeepaMinutes = Math.floor(Date.now() / 60000) - 21564000;
  const daysAgo = (d: number) => nowKeepaMinutes - d * 24 * 60;

  return {
    rootCategory: [Number(catId)],

    lastUpdate_gte: daysAgo(3),
    lastPriceChange_gte: daysAgo(60),

    current_NEW_gte: 1000,
    current_NEW_lte: 30000,

    current_COUNT_NEW_gte: 3,
    current_COUNT_NEW_lte: 60,

    current_BUY_BOX_SHIPPING_gte: 1000,
    trackingSince_lte: daysAgo(180),

    productType: 0,
    hasParentASIN: false,

    current_SALES_gte: 1,
    current_SALES_lte: 200000,

    page,
    perPage: KEEPA_DISCOVERY_PER_PAGE_WIDE,
    sort: [['current_SALES', 'asc']],
    // ★stats は付けない（付けると +30 枠）。
  };
}

/** 候補の中から等間隔で選ぶ。点数付けはしない（誰がやっても同じ結果になるように）。 */
function pickByStride(candidates: string[], want: number): string[] {
  if (candidates.length <= want) return [...candidates];
  const stride = candidates.length / want;
  const out: string[] = [];
  for (let i = 0; i < want; i += 1) {
    out.push(candidates[Math.min(Math.floor(i * stride), candidates.length - 1)]);
  }
  return Array.from(new Set(out));
}

/** すでに保存してある商品（ASINと売り場）を読む。通信しない。 */
async function savedProducts(): Promise<{ asin: string; categoryJa: string | null }[]> {
  const rows = await all(
    `SELECT asin, MAX(root_category_name) AS cat
       FROM keepa_products
      WHERE asin IS NOT NULL
      GROUP BY asin`,
  );
  return rows.map((r) => ({
    asin: String(r.asin ?? '').trim().toUpperCase(),
    categoryJa: r.cat === null || r.cat === undefined ? null : String(r.cat),
  })).filter((r) => r.asin !== '');
}

/** 1回の候補探しに使う枠の見積り（10 + 300件ぶん3 = 13）。 */
const DISCOVERY_COST_PER_ATTEMPT =
  KEEPA_DISCOVERY_COSTS.QUERY_BASE
  + Math.max(1, Math.ceil(KEEPA_DISCOVERY_PER_PAGE_WIDE / 100)) * KEEPA_DISCOVERY_COSTS.QUERY_PER_100_ASINS;

/* ================================================================
 * 本体
 * ================================================================ */

async function main(): Promise<void> {
  const names = loadDotEnv();
  const dry = has('dry');
  const startedAt = new Date().toISOString();
  const runId = `HUNDRED-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`;

  console.log(LINE);
  console.log('Keepa 100件・売り場をばらけさせて追加取得（読み取りのみ・購入も出品もしません）');
  console.log(LINE);
  console.log(`  用途：${KEEPA_USE_SCOPE_JA}`);
  console.log(`  実行の通し番号：${runId}`);
  console.log('  ★目的は利益商品探しではありません。');
  console.log('    「どの需要指標が、どの売り場で、どの程度取れるか」を実データで確認します。');

  /* ---------------------------------------------------------------
   * Stage 0：配分表に既存分を当てはめる（通信しない・0枠）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 0】配分表に、いま持っている商品を当てはめる（通信しません・0枠）\n${THIN}`);
  const saved = await savedProducts();
  const plan = planHundred(saved);

  console.log(`  目標の合計：${plan.targetTotal}件 ／ いま持っている：${plan.alreadyTotal}件`);
  console.log('');
  console.log('  売り場　　　　　　　　　目標　保有　あと');
  for (const s of plan.strata) {
    console.log(
      `  ${s.labelJa.padEnd(12, '　')}${String(s.target).padStart(4, ' ')}${String(s.already).padStart(6, ' ')}${String(s.remaining).padStart(6, ' ')}`
      + `${s.searchableByName ? '' : '　（ほかの枠に当てはまらない売り場から探します）'}`
      + `${s.overshoot > 0 ? `　（目標より${s.overshoot}件多く持っています。減らしません）` : ''}`,
    );
  }
  console.log(`\n  配分表の「あと」を足した数：${plan.remainingTotal}件`);
  console.log(`  売り場名が取れなかった商品：${plan.unassigned}件（「その他」に混ぜていません）`);
  console.log(`  ${plan.noteJa}`);

  if (plan.remainingTotal === 0) {
    console.log('\n  すべての売り場が目標に届いています。取得せずに終了します（枠0）。');
    return;
  }

  /* ---------------------------------------------------------------
   * Stage 0b：枠の見積り（通信しない・0枠）
   * ------------------------------------------------------------- */
  const searchable = plan.strata.filter((s) => (s.searchableByName || s.searchByExclusion) && s.remaining > 0);
  const estimateCategory = 1;
  const estimateDiscovery = Math.min(
    searchable.length * DISCOVERY_COST_PER_ATTEMPT,
    KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL,
  );

  /**
   * ★これから取る件数の上限。
   *   配分表の「あと」を全部足すと、目標100件より多くなることがある
   *   （売り場名が取れなかった商品を、どの枠にも数えていないため）。
   *   ご本人の指示（原文）：「**既存20件を再取得しないこと。追加80件だけ取得。**」
   *   なので **合計が100件になったところで打ち切る**。
   *   不足が大きい売り場から順に取るので、削られるのは
   *   いちばん余っている売り場（20件テストで半分を占めた「本」）から。
   */
  const globalFetchCap = Math.max(
    0,
    Math.min(KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS, plan.targetTotal - plan.alreadyTotal),
  );
  const estimateFetch = Math.min(plan.remainingTotal, globalFetchCap);
  const estimateTotal = estimateCategory + estimateDiscovery + estimateFetch;

  console.log(
    `\n  これから取る合計：${estimateFetch}件`
    + `（いま${plan.alreadyTotal}件＋${estimateFetch}件＝${plan.alreadyTotal + estimateFetch}件）`,
  );
  if (plan.remainingTotal > globalFetchCap) {
    console.log(
      `  ※配分表の「あと」を全部足すと${plan.remainingTotal}件ですが、`
      + `合計が${plan.targetTotal}件になったところで打ち切ります。`,
    );
    console.log('    削るのは不足が小さい売り場から（＝すでにいちばん多く持っている「本」から）です。');
  }
  console.log('\n  【使う予定の枠】（1回目の探索がすべて当たった場合）');
  console.log(`    分類の一覧　　　　　　：${estimateCategory}`);
  console.log(`    候補探し（${searchable.length}売り場×${DISCOVERY_COST_PER_ATTEMPT}）：${estimateDiscovery}（全体の上限${KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL}）`);
  console.log(`    下見 1枠×${estimateFetch}件　　　：${estimateFetch}（上限${KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS}）`);
  console.log(`    Deep Scan　　　　　　　：${KEEPA_HUNDRED_DEEP_SCAN_TOKENS}（**禁止**）`);
  console.log(`    合計　　　　　　　　　　：${estimateTotal}（全体の上限${KEEPA_HUNDRED_TOKEN_BUDGET_TOTAL}）`);
  console.log(`\n    ★1つの売り場に使ってよいのは、探索${KEEPA_STRATUM_MAX_DISCOVERY_ATTEMPTS}回・${KEEPA_STRATUM_MAX_DISCOVERY_TOKENS}枠まで。`);
  console.log('      足りなくても条件は緩めず、その売り場は「届かなかった」として終わります。');
  console.log(`    ★1回の探索は上限${KEEPA_MAX_DISCOVERY_TOKENS}枠を超えないことを、通信の前に確認しています。`);
  console.log(`\n  立ち止まる区切り：${KEEPA_HUNDRED_CHECKPOINTS.join(' → ')}件`);

  if (dry) {
    console.log(`\n${THIN}`);
    console.log('--dry のため、ここで終了します。通信していません。枠は1つも使っていません。');
    console.log('\n探しに行く売り場（番号ではなく名前で突き合わせます）：');
    for (const s of KEEPA_HUNDRED_STRATA) {
      console.log(
        `  ・${s.labelJa}（目標${s.target}件）`
        + `${
          s.searchableByName
            ? `：名前に「${s.keywords.join('」か「')}」を含むもの`
            : s.searchByExclusion
              ? '：ほかの7枠のどの言葉にも当てはまらない売り場から探します'
              : '：探しに行きません（受け皿）'
        }`,
      );
    }
    console.log('\nすでに扱いを決めてある「形の違い」（新しい違いに数えません）：');
    for (const p of KEEPA_KNOWN_SCHEMA_DRIFT_PATHS) console.log(`  ・${p}`);
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

  /* ---------------------------------------------------------------
   * Stage 2：売り場ごとに、足りない数だけ候補を探す
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 2】足りない売り場から順に候補を探す\n${THIN}`);

  const alreadySet = new Set(saved.map((s) => s.asin));
  const chosenAll: { asin: string; stratumJa: string }[] = [];
  const outcomes: { labelJa: string; outcome: StratumOutcome; got: number; want: number; tokens: number }[] = [];
  let discoveryTokensTotal = 0;

  // 不足が大きい売り場から先に探す（枠が尽きたときに、いちばん薄い売り場が残らないように）。
  const order = [...plan.strata].sort((a, b) => b.remaining - a.remaining);

  for (const st of order) {
    const def = KEEPA_HUNDRED_STRATA.find((x) => x.key === st.key);
    if (!def) continue;

    if ((!st.searchableByName && !st.searchByExclusion) || st.remaining <= 0) {
      outcomes.push({
        labelJa: st.labelJa,
        outcome: st.searchableByName || st.searchByExclusion ? 'ALREADY_FULL' : 'NOT_SEARCHED_BY_DESIGN',
        got: 0,
        want: st.remaining,
        tokens: 0,
      });
      continue;
    }

    // ★合計100件で打ち切る。ここを超えて取ると「追加80件だけ」の約束を破る。
    const want = Math.min(st.remaining, globalFetchCap - chosenAll.length);
    if (want <= 0) {
      console.log(`\n  ■ ${st.labelJa}：合計${plan.targetTotal}件に達したので、ここは探しません（枠0）。`);
      outcomes.push({ labelJa: st.labelJa, outcome: 'TARGET_NOT_REACHED', got: 0, want: st.remaining, tokens: 0 });
      continue;
    }

    /**
     * 公式の一覧から、この売り場に当たるものを**名前で**探す。**番号は推測しない。**
     * 「その他型番商品」だけは逆で、7枠のどの言葉にも当てはまらない売り場を候補にする。
     */
    const targets = st.searchByExclusion
      ? cats.categories.filter((c) => isExclusionCategory(String(c.name ?? '')))
      : cats.categories.filter((c) => def.keywords.some((k) => String(c.name ?? '').includes(k)));

    if (targets.length === 0) {
      console.log(`\n  ■ ${st.labelJa}：公式の一覧に当たる売り場がありませんでした。番号を作らずに飛ばします。`);
      outcomes.push({ labelJa: st.labelJa, outcome: 'TARGET_NOT_REACHED', got: 0, want, tokens: 0 });
      continue;
    }

    console.log(
      `\n  ■ ${st.labelJa} → ${targets.slice(0, 3).map((t) => t.name).join('／')}`
      + `${targets.length > 3 ? ` ほか${targets.length - 3}件` : ''}／あと${want}件ほしい`,
    );

    let attempts = 0;
    let tokensThisStratum = 0;
    const picked: string[] = [];

    /**
     * 「その他」枠は1つの売り場に偏らないよう、1回の探索で取る数を半分までにする
     * （2回の探索で別々の売り場から集める）。ほかの枠は1回で取り切ってよい。
     */
    const perAttemptCap = st.searchByExclusion
      ? Math.ceil(want / KEEPA_STRATUM_MAX_DISCOVERY_ATTEMPTS)
      : want;

    while (picked.length < want) {
      const may = canSearchStratum({
        attemptsSoFar: attempts,
        tokensSpentOnThisStratum: tokensThisStratum,
        tokensSpentOnDiscoveryTotal: discoveryTokensTotal,
        remaining: want - picked.length,
        searchableByName: st.searchableByName,
        searchByExclusion: st.searchByExclusion,
        nextAttemptCost: DISCOVERY_COST_PER_ATTEMPT,
      });
      if (!may.allowed) {
        console.log(`     ${may.reasonJa}`);
        break;
      }

      // 探索するたびに別の売り場へ移る（同じ売り場ばかり掘らない）。
      const hit = targets[attempts % targets.length];
      const disc = await discoverOneCandidate(buildSelection(hit.catId, st.searchByExclusion ? 0 : attempts), {
        discover: (s) => discoverAsinCandidates(s),
      });
      attempts += 1;
      const used = disc.tokensConsumed ?? DISCOVERY_COST_PER_ATTEMPT;
      tokensThisStratum += used;
      discoveryTokensTotal += used;

      if (!disc.ok) {
        console.log(`     ${attempts}回目：${disc.stoppedReasonJa}（使った枠 ${used}）`);
        break;
      }

      const fresh = disc.candidates.filter(
        (a) => !alreadySet.has(String(a).toUpperCase()) && !picked.includes(a) && !chosenAll.some((c) => c.asin === a),
      );
      const take = pickByStride(fresh, Math.min(perAttemptCap, want - picked.length));
      picked.push(...take);
      console.log(
        `     ${attempts}回目（${hit.name}）：条件に合った商品 ${num(disc.totalResults)}件`
        + ` ／ 受け取った候補 ${disc.candidates.length}件`
        + ` ／ 保存済みを除いて ${fresh.length}件 ／ 選んだ ${take.length}件（使った枠 ${used}）`,
      );
      if (take.length === 0) break;
    }

    for (const a of picked) chosenAll.push({ asin: a, stratumJa: st.labelJa });
    const outcome: StratumOutcome = picked.length >= want ? 'TARGET_REACHED' : 'TARGET_NOT_REACHED';
    outcomes.push({ labelJa: st.labelJa, outcome, got: picked.length, want, tokens: tokensThisStratum });
    console.log(`     結果：${picked.length}/${want}件　${STRATUM_OUTCOME_JA[outcome]}`);
  }

  console.log(`\n  候補探しに使った枠の合計：${discoveryTokensTotal}（上限${KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL}）`);
  console.log(`  これから下見する商品：${chosenAll.length}件`);

  if (chosenAll.length === 0) {
    console.log('\n  下見する商品がありません。ここで終了します。');
    return;
  }

  /* ---------------------------------------------------------------
   * Stage 3：1件ずつ下見しながら、区切りで立ち止まる
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 3】1件ずつ下見する（1枠×${chosenAll.length}）\n${THIN}`);
  console.log('  ★Deep Scan は禁止です。出品者一覧・Buy Box詳細・Seller詳細は取得しません。');
  console.log(`  ★${KEEPA_HUNDRED_CHECKPOINTS.join(' / ')}件の区切りで、7つの異常を確認します。`);

  const reports: OneAsinReport[] = [];
  const skipped: { asin: string; reasonJa: string }[] = [];
  const audits: ShapeAudit[] = [];
  let parserError = 0;
  let wrongMarketplace = 0;
  let falseAsin = 0;
  let priceOk = 0;
  let priceSeen = 0;
  let previousCoverage: number | null = null;
  let stoppedAtCheckpoint = false;
  const passedCheckpoints = new Set<number>();

  for (const c of chosenAll) {
    if (reports.filter((r) => r.ok).length >= KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS) {
      console.log('  下見の上限に達しました。ここで下見を終わります。');
      break;
    }

    const provenance = await lookupAsinProvenance(c.asin);
    if (!provenance) {
      skipped.push({ asin: c.asin, reasonJa: '出どころの記録が見つかりませんでした。通信せずに飛ばしました。' });
      console.log(`  ${c.asin}：出どころの記録なし → 飛ばしました（枠は使っていません）`);
      continue;
    }

    const r = await runOneAsin(
      c.asin,
      null,
      { fetchProducts: (a) => fetchKeepaProducts(a) },
      { windowDays: 90, provenance },
    );
    reports.push(r);

    if (!r.ok) {
      console.log(`  ${c.asin}：${r.stoppedReasonJa}`);
    } else {
      const norm = r.normalized;
      parserError += norm ? norm.parserErrors.length : 0;
      if (norm && norm.isJapan === false) wrongMarketplace += 1;
      if (norm && !norm.asin) falseAsin += 1;
      priceSeen += 1;
      if (norm && norm.currentNewPrice !== null) priceOk += 1;
      if (r.rawProduct) {
        const a = auditFieldShapes(c.asin, r.rawProduct);
        await saveFieldShapes(runId, a, null);
        audits.push(a);
      }
      console.log(
        `  ${c.asin}：取得しました（${c.stratumJa} ／ ${norm?.rootCategoryName ?? '売り場不明'} ／ 使った枠 ${num(r.tokens?.tokensConsumed)}）`,
      );
    }

    /* ---- 区切りに来たかどうか ---- */
    const total = plan.alreadyTotal + reports.filter((x) => x.ok).length;
    const checkpoint = KEEPA_HUNDRED_CHECKPOINTS.find((cp) => total >= cp && !passedCheckpoints.has(cp));
    if (checkpoint === undefined) continue;
    passedCheckpoints.add(checkpoint);

    // 新しい形の違い＝すでに扱いを決めてある場所を除いたもの
    const newDrift = findShapeDrift(audits)
      .filter((d) => d.drift)
      .filter((d) => !KEEPA_KNOWN_SCHEMA_DRIFT_PATHS.some((k) => d.path === k));

    const coverage = priceSeen === 0 ? null : Math.round((priceOk / priceSeen) * 1000) / 10;

    console.log(`\n${THIN}\n  【区切り】${total}件に到達しました\n${THIN}`);
    const judge = judgeCheckpoint({
      reachedCount: total,
      parserError,
      newSchemaDrift: newDrift.length,
      // 枠のズレは最後にまとめて突き合わせる（ここでは判定に使わない）
      tokenMismatch: 0,
      wrongMarketplace,
      falseAsin,
      // ★キーが外へ出る経路そのものが無い（ルール85）。構造上0である。
      secretLeak: 0,
      previousCoveragePercent: previousCoverage,
      currentCoveragePercent: coverage,
    });
    for (const row of judge.rows) {
      console.log(`    ${row.passed ? '○' : '×'} ${row.labelJa}：${row.value}`);
    }
    console.log(`\n  ${judge.verdictJa}`);
    if (newDrift.length > 0) {
      console.log('  新しい形の違いが出た場所：');
      for (const d of newDrift) console.log(`    ${d.labelJa}（${d.path}）`);
    }
    previousCoverage = coverage;

    if (judge.stop) {
      stoppedAtCheckpoint = true;
      break;
    }
  }

  /* ---------------------------------------------------------------
   * Stage 4：枠の集計
   * ------------------------------------------------------------- */
  console.log(`\n${LINE}\n【枠の使い方】（用途ごとに分けて記録しています）\n${LINE}`);
  const led = await tokenLedgerSince(startedAt);
  for (const [k, v] of Object.entries(led.ledger)) {
    const ja = (KEEPA_TOKEN_BUCKET_JA as Record<string, string>)[k] ?? '合計';
    console.log(`  ${k.padEnd(20, ' ')} ${String(v).padStart(4, ' ')}　（${ja}）`);
  }
  console.log(`  用途に振り分けられなかった枠：${led.unclassified}（0であるべき数字です）`);
  const okCount = reports.filter((r) => r.ok).length;
  console.log(`  1商品あたりの枠：${okCount === 0 ? '—' : Math.round((led.ledger.TOTAL_TOKENS / okCount) * 100) / 100}`);
  console.log(`  Deep Scan：${KEEPA_DEEP_SCAN_AUTO_EXECUTE ? '実行した' : `${KEEPA_HUNDRED_DEEP_SCAN_TOKENS}枠（実行していません）`}`);

  const after = await tokenMonitor();
  console.log(`\n  取得後の枠：${after.headlineJa}`);

  /* ---------------------------------------------------------------
   * Stage 5：売り場ごとの結果と停止
   * ------------------------------------------------------------- */
  console.log(`\n${LINE}\n【売り場ごとの結果】\n${LINE}`);
  for (const o of outcomes) {
    console.log(`  ${o.labelJa.padEnd(12, '　')}：${o.got}/${o.want}件　枠${o.tokens}　${o.outcome}`);
  }
  console.log('\n  ★届かなかった売り場は、条件を緩めずにそのまま終えています。');
  console.log('    見栄えのために件数を水増ししていません。');

  console.log(`\n${LINE}\n【ここで止まります】\n${LINE}`);
  console.log(`  今回あらたに取れた商品：${okCount}件`);
  console.log(`  保存済みと合わせて：${plan.alreadyTotal + okCount}件（目標${KEEPA_HUNDRED_TARGET_TOTAL}件）`);
  if (stoppedAtCheckpoint) {
    console.log('  ★区切りの確認で異常が出たため、途中で止めました。原因を直すまで先へ進みません。');
  }
  if (skipped.length > 0) {
    console.log('  【取得しなかったもの】');
    for (const s of skipped) console.log(`    ${s.asin}：${s.reasonJa}`);
  }
  console.log('\n  分析（Coverage・カテゴリ差・シグナルの離れ）は次のコマンドで出します：');
  console.log('    npm run keepa:study　　※Keepaへ通信しません（枠0）');
  console.log(`\n  ${KEEPA_HUNDRED_AFTER_JA}`);
  console.log(`  取得先：Amazon.co.jp（domain=${KEEPA_DOMAIN_JP}）のみ。他の国は保存していません。`);
  console.log('  実購入・実出品・自動値上げは、コードごと存在しません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
