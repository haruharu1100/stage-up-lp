/**
 * 【Keepa 20件実測テスト】（Phase 3.14・2026-08-25）
 *
 *   npm run keepa:twenty            … 追加13件だけ取得する（枠を 1 + 13 + 13 = 27 使う）
 *   npm run keepa:twenty -- --dry   … 通信せず、条件と見積もりだけ表示する（枠0）
 *
 * ------------------------------------------------------------------
 * 【このテストの目的】
 *
 * ご本人の指示（原文・2026-08-25）：
 *   「20件テストへ進んでください。ただし**目的は利益商品探しではありません。**
 *     『どの需要指標が、どのカテゴリで、どの程度使えるのか』を実データで確認すること。」
 *
 * ★だから、この実行の成果は「良い商品が何件見つかったか」ではない。
 *   ・Keepaの「◯個以上」の区分値が、20件のうち何件で埋まるか
 *   ・売り場（本／家電／ゲーム…）によって埋まり方が違うか
 *   ・20件に増やしても読み取りが壊れないか
 *   この3つが取れれば成功である。1件も仕入れなくてよい。
 *
 * ------------------------------------------------------------------
 * 【すでに取得済みの7件は取り直さない】
 *
 * ご本人の指示（原文）：
 *   「すでに取得済みの7件は再取得しないでください。追加で必要なのは、13件。
 *     Tokenを無駄にしないこと。」
 *
 * ★取り直しを止める仕組み（24時間あける／ルール88）は前からあるが、
 *   それは「選んでしまってから止める」ものなので、
 *   既存の7件が候補に混ざると、そのぶん**新しい商品が減る**（13件に届かない）。
 *   だからこのスクリプトは、**選ぶ前に**保存済みASINを候補から外す。
 *
 * ------------------------------------------------------------------
 * 【枠（Token）の内訳】
 *
 *   Stage 1  分類の一覧              1   （CATEGORY_LOOKUP）
 *   Stage 2  候補探し（1回だけ）    13   （DISCOVERY = 10 + 結果100件ごとに1 → 300件で13）
 *   Stage 5  下見 1枠×13件          13   （PRODUCT_FETCH）
 *   ------------------------------------------------
 *   合計                            27
 *
 * ★Deep Scan は**禁止**（ご本人の指示：「Deep Scanは禁止です。
 *   Offers詳細・Buy Box詳細・Seller詳細は取得しないでください」）。
 *   5件テストでは「候補を挙げるだけ」だったが、今回はそれもしない。
 *
 * ------------------------------------------------------------------
 * 【終了後は必ず止まる】
 *
 * ご本人の指示（原文）：
 *   「完了後、必ず停止してください。100件には進まないでください。」
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
  KEEPA_CURRENT_STAGE,
  KEEPA_DISCOVERY_COSTS,
  KEEPA_DISCOVERY_PER_PAGE_WIDE,
  KEEPA_DOMAIN_JP,
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
  KEEPA_DEEP_SCAN_AUTO_EXECUTE,
  KEEPA_SHAPE_WATCH_GROUPS,
  KEEPA_TOKEN_BUCKET_JA,
} from '../lib/keepa/scan';
import { KEEPA_SHAPE_JA } from '../lib/keepa/schema';
import { KEEPA_AUTO_ADVANCE_TO_HUNDRED } from '../lib/keepa/coverage';
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
 * 欲しい売り場（番号ではなく「名前に含まれていてほしい言葉」）
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「本 / ゲーム / 家電 / 日用品 / ホビー / おもちゃ / PC周辺 / その他型番商品
 *     **完全均等にする必要はありません。候補探索のToken効率を優先します。**」
 *
 * ★番号は1つも書かない。Stage 1 で公式の一覧をもらって名前で突き合わせる。
 *   番号を推測で書くと、**間違っていても検索は成功してしまう**ので、
 *   「本のつもりが文房具だった」まま20件テストを終えることになる。
 *
 * 「その他型番商品」は売り場の名前ではなく商品の性質なので、
 * ここには入れていない（無い名前を探しに行かない）。
 * 実際にどの売り場が当たったかは、取得後に Keepa が返した名前で報告する。
 */
const WANTED_GENRES: { key: string; labelJa: string; keywords: string[] }[] = [
  { key: 'BOOKS', labelJa: '本', keywords: ['本'] },
  { key: 'GAMES', labelJa: 'ゲーム', keywords: ['ゲーム', 'テレビゲーム'] },
  { key: 'ELECTRONICS', labelJa: '家電', keywords: ['家電', 'カメラ'] },
  { key: 'DAILY', labelJa: '日用品', keywords: ['ドラッグストア', '日用品', 'ビューティー'] },
  { key: 'HOBBY', labelJa: 'ホビー', keywords: ['ホビー'] },
  { key: 'TOYS', labelJa: 'おもちゃ', keywords: ['おもちゃ'] },
  { key: 'PC', labelJa: 'PC周辺', keywords: ['パソコン', 'PC'] },
];

type PickedCategory = { key: string; labelJa: string; catId: string; officialName: string };

/** 公式の一覧から、欲しい売り場に当たるものだけ選ぶ。**見つからないものは飛ばす（番号を作らない）。** */
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
 * 候補の条件
 * ================================================================ */

/**
 * 5件テストと同じ条件に、売り場（rootCategory）だけ差し替える。
 *
 * ★条件を「1件も返らなかったから」といって緩めない。
 *   緩めれば必ず何か返るが、それは条件を満たした商品ではない。
 */
function buildSelection(catIds: string[]): Record<string, unknown> {
  const nowKeepaMinutes = Math.floor(Date.now() / 60000) - 21564000;
  const daysAgo = (d: number) => nowKeepaMinutes - d * 24 * 60;

  return {
    rootCategory: catIds.map((c) => Number(c)),

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

    page: 0,
    // ★1回で広めに出す。回数を増やすのではなく、1回の取り分を増やす（枠は 11 → 13 の +2 だけ）。
    perPage: KEEPA_DISCOVERY_PER_PAGE_WIDE,
    sort: [['current_SALES', 'asc']],
    // ★stats は付けない（付けると +30 枠）。
  };
}

/**
 * 【候補の中から等間隔で選ぶ】
 *
 * ★点数を付けて選ばない。
 *   点数で選ぶと「なぜこの13件なのか」を後から検算できず、
 *   「AIが良さそうな順に選んだ」という一番あてにならない根拠だけが残る。
 *   等間隔なら、同じ候補一覧から誰がやっても同じ13件になる。
 */
function pickByStride(candidates: string[], want: number): string[] {
  if (candidates.length <= want) return [...candidates];
  const stride = candidates.length / want;
  const out: string[] = [];
  for (let i = 0; i < want; i += 1) {
    out.push(candidates[Math.min(Math.floor(i * stride), candidates.length - 1)]);
  }
  return Array.from(new Set(out));
}

/** すでに保存してあるASIN（＝取り直す必要が無いもの）を読む。通信しない。 */
async function alreadyFetchedAsins(): Promise<string[]> {
  const rows = await all(`SELECT DISTINCT asin FROM keepa_products WHERE asin IS NOT NULL`);
  return rows.map((r) => String(r.asin ?? '').trim().toUpperCase()).filter((a) => a !== '');
}

/* ================================================================
 * 本体
 * ================================================================ */

async function main(): Promise<void> {
  const names = loadDotEnv();
  const dry = has('dry');
  const startedAt = new Date().toISOString();
  const runId = `TWENTY-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`;

  console.log(LINE);
  console.log('Keepa 20件実測テスト（読み取りのみ・購入も出品もしません）');
  console.log(LINE);
  console.log(`  段階：${KEEPA_CURRENT_STAGE}（1回に取れるのは${KEEPA_MAX_ASINS_PER_RUN}件まで）`);
  console.log(`  用途：${KEEPA_USE_SCOPE_JA}`);
  console.log(`  実行の通し番号：${runId}`);
  console.log('  ★目的は利益商品探しではありません。');
  console.log('    「どの需要指標が、どのカテゴリで、どの程度使えるか」を実データで確認します。');

  /* ---------------------------------------------------------------
   * Stage 0：すでに持っている分を数える（通信しない・0枠）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 0】すでに取得済みの商品を数える（通信しません・0枠）\n${THIN}`);
  const alreadyList = await alreadyFetchedAsins();
  console.log(`  保存済み：${alreadyList.length}件`);
  console.log(`  　${alreadyList.join(' , ') || '（なし）'}`);

  const wantTotal = KEEPA_MAX_ASINS_PER_RUN; // 20
  const wantNew = Math.max(0, wantTotal - alreadyList.length);
  console.log(`\n  合計で欲しい件数：${wantTotal}件`);
  console.log(`  今回あらたに取る件数：${wantNew}件（${wantTotal} − 保存済み${alreadyList.length}）`);
  console.log('  ★保存済みの分は取り直しません（枠を使いません）。');

  if (wantNew === 0) {
    console.log('\n  すでに20件そろっています。取得せずに終了します（枠0）。');
    return;
  }

  /* ---------------------------------------------------------------
   * Stage 0b：枠の見積り（通信しない・0枠）
   * ------------------------------------------------------------- */
  const before = await tokenMonitor();
  console.log(`\n  いまの枠：${before.headlineJa}`);

  const estimateCategory = 1;
  const estimateDiscovery =
    KEEPA_DISCOVERY_COSTS.QUERY_BASE
    + Math.max(1, Math.ceil(KEEPA_DISCOVERY_PER_PAGE_WIDE / 100)) * KEEPA_DISCOVERY_COSTS.QUERY_PER_100_ASINS;
  const estimateFetch = wantNew;
  const estimateTotal = estimateCategory + estimateDiscovery + estimateFetch;

  console.log('\n  【使う予定の枠】');
  console.log(`    Stage 1 分類の一覧　　　：${estimateCategory}（用途 CATEGORY_LOOKUP）`);
  console.log(`    Stage 2 候補探し1回　　　：${estimateDiscovery}（用途 DISCOVERY・上限${KEEPA_MAX_DISCOVERY_TOKENS}）`);
  console.log(`    Stage 5 下見 1×${wantNew}件　：${estimateFetch}（用途 PRODUCT_FETCH）`);
  console.log(`    Deep Scan　　　　　　　：0（**禁止**。出品者一覧・Buy Box詳細は取りません）`);
  console.log(`    合計　　　　　　　　　　：${estimateTotal}`);

  if (dry) {
    console.log(`\n${THIN}`);
    console.log('--dry のため、ここで終了します。通信していません。枠は1つも使っていません。');
    console.log('\n欲しい売り場（番号ではなく名前で探します）：');
    for (const g of WANTED_GENRES) {
      console.log(`  ・${g.labelJa}（名前に「${g.keywords.join('」か「')}」を含むもの）`);
    }
    console.log('\n見張る項目：');
    for (const g of KEEPA_SHAPE_WATCH_GROUPS) {
      console.log(`  ・${g.labelJa}：${g.paths.join(' , ')}`);
    }
    console.log(`  合計 ${KEEPA_SHAPE_WATCH_GROUPS.reduce((s, g) => s + g.paths.length, 0)}か所`);
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
    console.log(`    見つからなかった売り場：${missing.join(' / ')}（推測で埋めていません）`);
  }
  if (picked.length === 0) {
    console.log('\n【止まりました】欲しい売り場が1つも見つかりませんでした。');
    process.exit(1);
  }

  /* ---------------------------------------------------------------
   * Stage 2：候補探し（1回だけ）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 2】候補を1回だけ探す（${estimateDiscovery}枠）\n${THIN}`);
  console.log('  ★1商品ごとに検索していません（ご本人の指示）。1回で広めに出して、そこから選びます。');
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
   * Stage 3：保存済みを外して13件を選ぶ（0枠）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 3】保存済みを外して${wantNew}件を選ぶ（通信しません・0枠）\n${THIN}`);
  const already = new Set(alreadyList);
  const fresh = disc.candidates.filter((a) => !already.has(String(a).toUpperCase()));
  const excluded = disc.candidates.length - fresh.length;
  console.log(`  候補から外した保存済みASIN：${excluded}件（取り直しません）`);
  console.log(`  選べる候補：${fresh.length}件`);

  if (fresh.length < wantNew) {
    console.log(`  ★候補が${wantNew}件に足りません。足りない分は取得しません（条件を緩めません）。`);
  }

  const chosen = pickByStride(fresh, wantNew);
  console.log(`  選び方：等間隔（${fresh.length}件から${chosen.length}件）。点数付けはしていません。`);
  console.log(`  選んだASIN：${chosen.join(' , ')}`);

  /* ---------------------------------------------------------------
   * Stage 5：下見（1枠×13）※Deep Scan は取りません
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 5】1件ずつ下見する（1枠×${chosen.length}）\n${THIN}`);
  console.log('  ★Deep Scan は禁止です。出品者一覧・Buy Box詳細・Seller詳細は取得しません。');
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
      const cat = r.normalized?.rootCategoryName ?? '売り場不明';
      console.log(`  ${asin}：取得しました（${cat}／使った枠 ${num(r.tokens?.tokensConsumed)}）`);
    }
  }

  /* ---------------------------------------------------------------
   * Stage 6：形の監査（0枠）
   * ------------------------------------------------------------- */
  console.log(`\n${THIN}\n【Stage 6】商品ごとに「形」がどう違うかを見る（通信しません・0枠）\n${THIN}`);
  const audits: ShapeAudit[] = [];
  for (const r of reports) {
    if (!r.rawProduct) continue;
    const a = auditFieldShapes(r.asin, r.rawProduct);
    await saveFieldShapes(runId, a, null);
    audits.push(a);
  }
  const pathCount = KEEPA_SHAPE_WATCH_GROUPS.reduce((s, g) => s + g.paths.length, 0);
  console.log(`  形を記録した商品：${audits.length}件 × ${pathCount}か所`);

  const drift = findShapeDrift(audits);
  const drifted = drift.filter((d) => d.drift);
  console.log(`  商品どうしで形が違った場所（SCHEMA_DRIFT）：${drifted.length}か所`);
  console.log('  ★「形が違う＝不具合」ではありません。本にはJANがあり家電には無い、は正常な違いです。');
  console.log('    ただし**黙って「不明」に落とさず、必ずここへ出します**（ご本人の指示）。');
  for (const d of drifted) {
    console.log(`\n    ${d.labelJa}（${d.path}）：${d.distinctShapes.map((s) => KEEPA_SHAPE_JA[s as keyof typeof KEEPA_SHAPE_JA] ?? s).join(' / ')}`);
    for (const b of d.byAsin) {
      const len = b.arrayLength === null ? '' : `・要素${b.arrayLength}個`;
      console.log(`      ${b.asin}：${KEEPA_SHAPE_JA[b.shape] ?? b.shape}${len}`);
    }
  }

  /* ---------------------------------------------------------------
   * 枠の集計（用途別）
   * ------------------------------------------------------------- */
  console.log(`\n${LINE}\n【枠の使い方】（用途ごとに分けて記録しています）\n${LINE}`);
  const led = await tokenLedgerSince(startedAt);
  for (const [k, v] of Object.entries(led.ledger)) {
    const ja = (KEEPA_TOKEN_BUCKET_JA as Record<string, string>)[k] ?? '合計';
    console.log(`  ${k.padEnd(20, ' ')} ${String(v).padStart(4, ' ')}　（${ja}）`);
  }
  console.log(`  用途に振り分けられなかった枠：${led.unclassified}（0であるべき数字です）`);
  console.log(`  見積り合計：${estimateTotal} ／ 実消費合計：${led.ledger.TOTAL_TOKENS}`);
  console.log(`  差：${led.ledger.TOTAL_TOKENS - estimateTotal}（0であるべき数字です）`);
  console.log(`  Deep Scan：${KEEPA_DEEP_SCAN_AUTO_EXECUTE ? '実行した' : '0枠（実行していません）'}`);

  const after = await tokenMonitor();
  console.log(`\n  取得後の枠：${after.headlineJa}`);

  /* ---------------------------------------------------------------
   * Stage 7：停止
   * ------------------------------------------------------------- */
  console.log(`\n${LINE}\n【Stage 7】ここで止まります\n${LINE}`);
  const okCount = reports.filter((r) => r.ok).length;
  console.log(`  今回あらたに取れた商品：${okCount}件`);
  console.log(`  保存済みと合わせて：${alreadyList.length + okCount}件`);
  if (skipped.length > 0) {
    console.log('  【取得しなかったもの】');
    for (const s of skipped) console.log(`    ${s.asin}：${s.reasonJa}`);
  }
  console.log('\n  分析（Coverage・食い違い・カテゴリ差）は次のコマンドで出します：');
  console.log('    npm run keepa:study　　※Keepaへ通信しません（枠0）');
  console.log(`\n  100件へ自動で進むか：${KEEPA_AUTO_ADVANCE_TO_HUNDRED ? '進む' : '進みません'}`);
  console.log('  100件へ進めるかどうかは、結果を見てご本人が決めてください。');
  console.log(`  取得先：Amazon.co.jp（domain=${KEEPA_DOMAIN_JP}）のみ。他の国は保存していません。`);
  console.log('  実購入・実出品・自動値上げは、コードごと存在しません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
