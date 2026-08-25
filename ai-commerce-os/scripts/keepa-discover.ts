/**
 * 【候補ASINを、正式な情報源から1件だけ選ぶ】（Phase 3.11・2026-08-25）
 *
 *   npm run keepa:discover            … 実際に1回だけ検索する
 *   npm run keepa:discover -- --dry    … 通信せず、条件と見積もりだけ表示する（枠0）
 *
 * ------------------------------------------------------------------
 * 【ご本人の指示（原文）】
 *
 *   「『次のKeepaテスト用ASINは必ず人間がAmazonを開いて探して渡す必要がある』という
 *     制約は外してください。…ただし、架空ASIN・推測ASINは禁止を維持します。」
 *
 *   「Keepa自身から候補ASINを選べる場合は利用してください。…
 *     Keepa → 実在ASIN → Keepa商品取得 となり、
 *     人間がAmazon画面から毎回コピーする必要がありません。」
 *
 *   「候補探しのために何百・何千ASINもKeepaへ投げないでください。
 *     …最小Tokenで1候補を選ぶこと。候補選定に使用したTokenも別記録してください。」
 *
 * ------------------------------------------------------------------
 * 【なぜこれが「推測で作ったASIN」と違うのか】
 *
 * ASINは半角英数字10桁である。**それらしい文字列はいくらでも作れる。**
 * だから「形が正しい」ことは何の保証にもならない。
 * 保証になるのは「その文字列を、実在を知っている相手から受け取った」ことだけである。
 *
 * このコマンドは、条件をKeepaへ渡し、**Keepaが実在すると答えたASINの一覧**を受け取る。
 * 当社側で文字を組み立てる場所が一箇所も無い。ここが要点である。
 *
 * ------------------------------------------------------------------
 * 【枠（Token）について（公式ドキュメントの記載）】
 *
 *   Product Finder … 基本10 ＋ 結果100件ごとに1
 *   `stats` を付けると さらに +30（付けない）
 *   1ページの最小は50件
 *
 * よって 10 + 1 = **11**。これが候補選定に使う枠の全部である。
 * 商品データを取る枠（1）とは別に記録する（purpose = DISCOVERY）。
 */
import { loadDotEnv } from '../lib/dotenv';
import { discoverAsinCandidates, keepaKeyStatus } from '../lib/keepa/client';
import {
  KEEPA_DISCOVERY_COSTS,
  KEEPA_DISCOVERY_PER_PAGE,
  KEEPA_DOMAIN_JP,
  KEEPA_MAX_DISCOVERY_TOKENS,
} from '../lib/keepa/policy';
import { discoverOneCandidate, tokenMonitor } from '../lib/keepa/store';
import { ASIN_CONFIDENCE_JA, ASIN_SOURCE_JA } from '../lib/keepa/asinsource';

const LINE = '='.repeat(72);

function has(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

/**
 * 【候補の条件】（ユーザー指示3）
 *
 *   ・Amazon.co.jp の商品                → domain=5（通信側で固定）
 *   ・Keepaの最終更新が新しい            → lastUpdate_gte
 *   ・現在価格が存在する                 → current_NEW_gte
 *   ・新品Offerが存在する                → current_COUNT_NEW_gte
 *   ・複数Sellerが望ましい               → current_COUNT_NEW_gte: 3
 *   ・Buy Boxデータがあることが望ましい  → current_BUY_BOX_SHIPPING_gte
 *   ・価格履歴がある                     → trackingSince_lte（十分前から追跡している）
 *
 * ★さらに、親ASIN（色・サイズをまとめた入れ物）を最初から除く（ユーザー指示8）。
 *   親のページには実際のOfferが無いことがあり、買い物導線に出すと別の色を買わせてしまう。
 *
 * ★この条件を「1件も返らなかったから」といって緩めない。
 *   通したくて緩めた条件は、もはや条件ではない。
 */
function buildSelection(): Record<string, unknown> {
  const nowKeepaMinutes = Math.floor(Date.now() / 60000) - 21564000;
  const daysAgo = (d: number) => nowKeepaMinutes - d * 24 * 60;

  return {
    // ---- 新しさ（鮮度30日の線は動かさない） ----
    lastUpdate_gte: daysAgo(3), // 直近3日以内に更新されている
    lastPriceChange_gte: daysAgo(60), // 直近60日で価格が動いている＝生きている

    // ---- 現在価格が存在する（新品） ----
    current_NEW_gte: 1000, // 1,000円以上（円はそのまま。100で割らない）
    current_NEW_lte: 30000, // 高額品はデータの癖が強いので今回は外す

    // ---- 新品Offerが複数ある ----
    current_COUNT_NEW_gte: 3,
    current_COUNT_NEW_lte: 60,

    // ---- Buy Box のデータがある ----
    current_BUY_BOX_SHIPPING_gte: 1000,

    // ---- 価格履歴がある（180日以上前から追跡されている） ----
    trackingSince_lte: daysAgo(180),

    // ---- 親ASINを避ける（実際に買える子ASIN・単品を選ぶ） ----
    productType: 0, // 0 = STANDARD（親＝5 を除く）
    hasParentASIN: false,

    // ---- 順位がある（＝売れている痕跡がある） ----
    current_SALES_gte: 1,
    current_SALES_lte: 200000,

    // ---- 1ページ分だけ。最小は50件（公式ドキュメント） ----
    page: 0,
    perPage: KEEPA_DISCOVERY_PER_PAGE,
    // 売れ筋の順に並べる。並び順の根拠を記録に残すため、必ず明示する。
    sort: [['current_SALES', 'asc']],
    // ★stats は付けない（付けると +30 枠）。
  };
}

async function main(): Promise<void> {
  const names = loadDotEnv();
  const dry = has('dry');

  console.log(LINE);
  console.log('候補ASINを1件だけ選びます（Keepaの商品検索・読み取りのみ）');
  console.log(LINE);

  const selection = buildSelection();
  const estimated =
    KEEPA_DISCOVERY_COSTS.QUERY_BASE
    + Math.max(1, Math.ceil(KEEPA_DISCOVERY_PER_PAGE / 100)) * KEEPA_DISCOVERY_COSTS.QUERY_PER_100_ASINS;

  console.log('\n【条件】（1件も返らなくても緩めません）');
  for (const [k, v] of Object.entries(selection)) {
    console.log(`  ${k} = ${JSON.stringify(v)}`);
  }
  console.log(`\n  対象：Amazon.co.jp（domain=${KEEPA_DOMAIN_JP}）`);
  console.log(`  見積もりの枠：${estimated}（上限 ${KEEPA_MAX_DISCOVERY_TOKENS}）`);
  console.log('  ※ この枠は「候補選定」として、商品取得の枠とは別に記録します。');

  if (dry) {
    console.log('\n--dry のため、ここで終了します。通信していません。枠は1つも使っていません。');
    return;
  }

  const key = keepaKeyStatus();
  console.log(`\n.env から読み込んだ変数：${names.length}件（名前だけ。値は表示しません）`);
  console.log(`APIキー：${key.messageJa}`);
  if (!key.configured) {
    console.log('\n通信せずに終了します。');
    process.exit(1);
  }

  const before = await tokenMonitor();
  console.log(`\n検索前の枠：${before.headlineJa}`);

  const r = await discoverOneCandidate(selection, {
    discover: (s) => discoverAsinCandidates(s),
  });

  console.log(`\n${LINE}`);
  console.log('【結果】');
  console.log(LINE);
  console.log(`  見積もり：${r.estimatedCost} ／ 実際に使った枠：${r.tokensConsumed ?? '不明'}`);
  console.log(`  残り：${r.tokensLeft ?? '不明'}`);
  console.log(`  記録した用途：DISCOVERY（候補選定）。商品取得の枠とは分けて記録しました。`);

  if (!r.ok) {
    console.log(`\n【止まりました】${r.stoppedReasonJa}`);
    process.exit(1);
  }

  console.log(`\n  条件に合った商品の総数：${r.totalResults ?? '不明'}`);
  console.log(`  受け取った候補：${r.candidates.length}件（全部そのまま保存しました）`);
  console.log(`  先頭の10件：${r.candidates.slice(0, 10).join(' , ')}`);

  const p = r.chosenProvenance!;
  console.log(`\n${LINE}`);
  console.log('【選んだ1件】');
  console.log(LINE);
  console.log(`  ASIN：${p.asin}`);
  console.log(`  出どころ：${p.asinSource}（${ASIN_SOURCE_JA[p.asinSource]}）`);
  console.log(`  確信度：${p.asinConfidence}（${ASIN_CONFIDENCE_JA[p.asinConfidence]}）`);
  console.log(`  実在の確認方法：${p.verificationMethodJa}`);
  console.log(`  確認した時刻：${p.asinVerifiedAt}`);
  console.log('  ★AIが文字列として作ったASINではありません。Keepaが返した一覧の中の1件です。');

  console.log(`\n${LINE}`);
  console.log('ここで止まります。商品データはまだ取っていません。');
  console.log(LINE);
  console.log('  次にやること（別のコマンド・枠を1つ使います）：');
  console.log(`    npm run keepa:one -- --asin=${p.asin}`);
  console.log('  ※ そのとき出どころは、この保存記録から自動で引かれます。');
  console.log('    コマンドの引数で「Keepaが返した」と名乗ることはできません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
