/**
 * 【Keepa から ASIN を1件だけ取って、必ず止まる】（Phase 3.10・2026-08-25）
 *
 *   npm run keepa:one -- --asin=B0XXXXXXXX
 *
 * ------------------------------------------------------------------
 * 【ご本人の指示（原文）】
 *
 *   「KEEPA_READ_ONLYとして、まずは1 ASINだけ取得→保存→正規化→売れるか判定→
 *     Token消費確認まで実装し、そこで必ず停止してください。5件には進まないでください。」
 *
 * この命令は「1件ずつ何回も回してよい」という意味ではない。
 * だから、
 *   ・1回の実行で取れるのは1件（`KEEPA_MAX_ASINS_PER_RUN`）
 *   ・同じASINは24時間あけないと取り直せない（`KEEPA_MIN_REFETCH_HOURS`）
 *   ・1日に使ってよい枠の上限がある（`KEEPA_DAILY_TOKEN_BUDGET`）
 * の3つで、繰り返し実行しても大量取得にならないようにしてある。
 *
 * ------------------------------------------------------------------
 * 【APIキーをここで一切表示しない】
 *
 * このコマンドは `.env` からキーを読むが、**値をどこにも出さない**。
 * 画面に出すのは「設定されているか」だけ。
 * デバッグのつもりでキーを出力する行を、ここにも他のどこにも書かない。
 */
import { loadDotEnv } from '../lib/dotenv';
import { fetchKeepaProducts, isValidAsin, keepaKeyStatus } from '../lib/keepa/client';
import {
  KEEPA_CURRENT_STAGE,
  KEEPA_DATA_CAUTION_JA,
  KEEPA_MAX_ASINS_PER_RUN,
  KEEPA_OPEN_QUESTIONS,
  KEEPA_PRODUCT_URL_NOTE_JA,
  KEEPA_STAGES,
  KEEPA_USE_SCOPE,
  KEEPA_USE_SCOPE_JA,
} from '../lib/keepa/policy';
import { KEEPA_TOKEN_DESIGN_NOTE_JA } from '../lib/keepa/tokens';
import { ASIN_MATCH_VERDICT_JA } from '../lib/keepa/match';
import { COMPETITION_SCORE_NOTE_JA, TREND_VERDICT_JA } from '../lib/keepa/normalize';
import { SELLABILITY_VERDICT_JA } from '../lib/sellability';
import { runOneAsin, tokenMonitor } from '../lib/keepa/store';

const LINE = '='.repeat(72);

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
}

function yen(v: number | null | undefined): string {
  return v === null || v === undefined ? '不明' : `${v.toLocaleString()}円`;
}

function num(v: number | null | undefined, unit = ''): string {
  return v === null || v === undefined ? '不明' : `${v.toLocaleString()}${unit}`;
}

function text(v: string | null | undefined): string {
  return v === null || v === undefined || v === '' ? '不明' : v;
}

async function main(): Promise<void> {
  // `.env` を読む（Next.js は自分で読むが、コマンド実行では読まれないため）。
  // 返ってくるのは変数の**名前だけ**。値は返らない。
  const names = loadDotEnv();

  console.log(LINE);
  console.log('Keepa から1件だけ取得します（KEEPA_READ_ONLY）');
  console.log(LINE);

  const stage = KEEPA_STAGES.find((s) => s.code === KEEPA_CURRENT_STAGE);
  console.log(`段階：${KEEPA_CURRENT_STAGE}（${stage?.labelJa}）`);
  console.log(`1回に取れる上限：${KEEPA_MAX_ASINS_PER_RUN}件`);
  console.log(`用途：${KEEPA_USE_SCOPE}`);
  console.log(`  ${KEEPA_USE_SCOPE_JA}`);
  console.log('未確認のまま残している点：');
  for (const q of KEEPA_OPEN_QUESTIONS) {
    console.log(`  ${q.code}（${q.status}）：${q.questionJa}`);
  }

  // ---- キーの確認（値は出さない） -----------------------------
  const key = keepaKeyStatus();
  console.log(`\n.env から読み込んだ変数：${names.length}件（名前だけ。値は表示しません）`);
  console.log(`APIキー：${key.messageJa}`);
  if (!key.configured) {
    console.log('\n通信せずに終了します。');
    console.log('プロジェクト直下の .env に KEEPA_API_KEY を書いてから、もう一度実行してください。');
    console.log('※ キーの値をこちら（AI）へ送る必要はありません。ファイルに書くだけで動きます。');
    process.exit(1);
  }

  // ---- ASIN の確認 --------------------------------------------
  const asin = (arg('asin') ?? '').toUpperCase();
  if (!asin) {
    console.log('\nASINが指定されていません。');
    console.log('  npm run keepa:one -- --asin=B0XXXXXXXX');
    process.exit(1);
  }
  if (!isValidAsin(asin)) {
    console.log(`\nASINの形が正しくありません：${asin}（半角英数字10桁）`);
    console.log('通信する前に止めました（おかしな文字列を投げると、枠を使って空の結果が返るだけのため）。');
    process.exit(1);
  }

  // ---- 手元の商品（あれば、同一商品かを確かめる） ---------------
  const janArg = arg('jan');
  const modelArg = arg('model');
  const nameArg = arg('name');
  const brandArg = arg('brand');
  const colorArg = arg('color');
  const qtyArg = arg('quantity');
  const hasLocal = Boolean(janArg || modelArg || nameArg || brandArg);
  const localProduct = hasLocal
    ? {
        productKey: (modelArg || janArg || asin).toUpperCase(),
        jan: janArg,
        model: modelArg,
        name: nameArg,
        brand: brandArg,
        color: colorArg,
        quantity: qtyArg ? Number(qtyArg) : null,
      }
    : null;

  const windowArg = Number(arg('window') ?? 90);
  const windowDays = ([30, 90, 180] as const).includes(windowArg as any)
    ? (windowArg as 30 | 90 | 180)
    : 90;

  console.log(`\n取得するASIN：${asin}（1件のみ）`);
  console.log(`売れるか判定の期間：${windowDays}日`);
  console.log(hasLocal
    ? `手元の商品と照合します：${text(nameArg)}`
    : '手元の商品が指定されていないため、同一商品の照合は行いません（--jan= / --model= / --name= で指定できます）。');

  // ---- 取得前の枠 ---------------------------------------------
  const before = await tokenMonitor();
  console.log(`\n取得前の枠：${before.headlineJa}`);

  // ---- 実行 ---------------------------------------------------
  const r = await runOneAsin(
    asin,
    localProduct,
    { fetchProducts: (asins) => fetchKeepaProducts(asins) },
    { windowDays },
  );

  if (r.stoppedReasonJa && !r.normalized) {
    console.log(`\n${LINE}`);
    console.log('【止まりました】');
    console.log(`  ${r.stoppedReasonJa}`);
    if (r.tokens) {
      console.log(`  この呼び出しで使った枠：${num(r.tokens.tokensConsumed)}／残り ${num(r.tokens.tokensLeft)}`);
    }
    console.log(`  ${r.monitor.headlineJa}`);
    console.log(LINE);
    process.exit(1);
  }

  const n = r.normalized!;

  // ================================================================
  console.log(`\n${LINE}`);
  console.log('① 取得できた項目');
  console.log(LINE);
  console.log(`  ASIN：${n.asin}`);
  console.log(`  Keepaのドメイン番号：${num(n.domainId)}`);
  console.log(`  商品名：${text(n.title)}`);
  console.log(`  ブランド：${text(n.brand)}`);
  console.log(`  型番（model）：${text(n.model)} ／ 型番（partNumber）：${text(n.partNumber)}`);
  console.log(`  JAN/EAN：${n.eanList.length ? n.eanList.join(', ') : '不明'}`);
  console.log(`  UPC：${n.upcList.length ? n.upcList.join(', ') : '不明'}`);
  console.log(`  色：${text(n.color)} ／ 入数：${num(n.numberOfItems)} ／ 梱包内個数：${num(n.packageQuantity)}`);
  console.log('  --- いまの値 ---');
  console.log(`  Amazon本体の価格：${yen(n.currentAmazonPrice)}`);
  console.log(`  新品の最安値：${yen(n.currentNewPrice)}`);
  console.log(`  中古の最安値：${yen(n.currentUsedPrice)}`);
  console.log(`  カート価格：${yen(n.currentBuyBoxPrice)}`);
  console.log(`  定価：${yen(n.listPrice)}`);
  console.log(`  売れ筋順位：${num(n.currentSalesRank, '位')}`);
  console.log(`  評価：${n.rating === null ? '不明' : `星${n.rating}`} ／ レビュー：${num(n.reviewCount, '件')}`);
  console.log('  --- 平均 ---');
  console.log(`  新品30日平均：${yen(n.avgNewPrice30)} ／ 90日：${yen(n.avgNewPrice90)} ／ 180日：${yen(n.avgNewPrice180)}`);
  console.log(`  順位30日平均：${num(n.avgSalesRank30, '位')} ／ 90日：${num(n.avgSalesRank90, '位')}`);
  console.log('  --- 売れ行きの手がかり（販売数ではありません） ---');
  console.log(`  順位の下落回数 30日：${num(n.salesRankDrops30, '回')} ／ 90日：${num(n.salesRankDrops90, '回')}`);
  console.log(`  　　　　　　　180日：${num(n.salesRankDrops180, '回')} ／ 365日：${num(n.salesRankDrops365, '回')}`);
  console.log(`  Keepaの月間販売個数：${num(n.monthlySold, '個')}（大半の商品では入っていません）`);
  console.log('  --- ライバル ---');
  console.log(`  新品の出品数：${num(n.offerCountNew, '人')} ／ 中古：${num(n.offerCountUsed, '人')}`);
  console.log(`  FBA：${num(n.offerCountFBA, '人')} ／ FBM：${num(n.offerCountFBM, '人')}`);
  console.log(`  Amazon本体の在庫：${n.amazonRetailPresent} ／ カートの保持者がAmazon：${n.buyBoxIsAmazon}`);
  console.log(`  在庫切れ割合 30日：${num(n.outOfStockPercentage30, '%')} ／ 90日：${num(n.outOfStockPercentage90, '%')}`);
  console.log('  --- 費用（Amazonが決めるもの） ---');
  console.log(`  FBA梱包発送手数料：${yen(n.fbaPickAndPackFee)} ／ 販売手数料率：${num(n.referralFeePercentage, '%')}`);
  console.log('  --- いつの情報か ---');
  console.log(`  Keepa側の最終更新：${text(n.lastUpdateIso)}`);
  console.log(`  追跡開始：${text(n.trackingSinceIso)}`);
  console.log(`  商品ページURL：取得できません（${KEEPA_PRODUCT_URL_NOTE_JA}）`);

  // ================================================================
  console.log(`\n${LINE}`);
  console.log('② 取れなかった項目（UNKNOWN）');
  console.log(LINE);
  if (r.unknownFieldsJa.length === 0) {
    console.log('  ありません（主要項目はすべて取得できました）。');
  } else {
    for (const f of r.unknownFieldsJa) console.log(`  ・${f}`);
  }
  const seven = r.windows.find((w) => w.window === 'SELLABILITY_7D');
  if (seven) console.log(`  ・7日間の下落回数：${seven.status}（${seven.noteJa}）`);

  // ================================================================
  console.log(`\n${LINE}`);
  console.log('③ Token（取得枠）の消費');
  console.log(LINE);
  console.log(`  見積もり：${r.estimatedCost}`);
  console.log(`  実際に使った量：${num(r.tokens?.tokensConsumed)}`);
  console.log(`  残り：${num(r.tokens?.tokensLeft)}`);
  console.log(`  1分あたりの補充：${num(r.tokens?.refillRate)}`);
  console.log(`  次の補充まで：${num(r.tokens?.refillIn, 'ミリ秒')}`);
  console.log(`  補充速度の低下：${num(r.tokens?.tokenFlowReduction)}`);
  console.log(`  Keepa側の処理時間：${num(r.tokens?.processingTimeInMs, 'ミリ秒')}`);
  console.log(`  ${r.monitor.headlineJa}`);
  console.log(`  今月の使用：${r.monitor.usedThisMonth}（呼び出し${r.monitor.requestCount}回）`);
  console.log(`  1商品あたりの実測平均：${r.monitor.avgPerProduct === null ? '未測定' : r.monitor.avgPerProduct}`);
  console.log(`  ${KEEPA_TOKEN_DESIGN_NOTE_JA}`);

  // ================================================================
  console.log(`\n${LINE}`);
  console.log('④ ASIN_MATCH_SCORE（手元の商品と同じものか）');
  console.log(LINE);
  if (!r.match) {
    console.log('  手元の商品が指定されていないため、判定していません。');
    console.log('  ※ 判定していないことを「一致」として扱いません。');
  } else {
    console.log(`  判定：${r.match.verdict}（${ASIN_MATCH_VERDICT_JA[r.match.verdict]}）`);
    console.log(`  選ばれたASIN：${r.match.chosenAsin ?? 'なし（人の確認が必要）'}`);
    console.log(`  理由：${r.match.reasonJa}`);
    for (const c of r.match.candidates) {
      console.log(`  - ${c.asin}：${c.score}点`);
      for (const f of c.fields) console.log(`      ${f.labelJa}：${f.state}（${f.points}点）${f.detailJa}`);
      for (const v of c.vetoes) console.log(`      ★決定的な違い：${v}`);
    }
  }

  // ================================================================
  console.log(`\n${LINE}`);
  console.log('⑤ 日本Amazonの判定');
  console.log(LINE);
  console.log(`  domainId＝${num(n.domainId)}（日本は5）`);
  console.log(`  判定：${n.isJapan ? '日本のAmazonのデータです' : '日本のAmazonではありません（保存せずに止めます）'}`);

  // ================================================================
  console.log(`\n${LINE}`);
  console.log('⑥ 売れるか判定');
  console.log(LINE);
  if (!r.sellability) {
    console.log('  判定していません。');
  } else {
    const s = r.sellability.result;
    console.log(`  期間：直近${r.sellability.windowDays}日`);
    console.log(`  判定：${s.verdict}（${SELLABILITY_VERDICT_JA[s.verdict]}）`);
    console.log(`  理由：${s.reason}`);
    console.log(`  推定の月間販売数：${s.estimatedMonthlySales === null ? '不明' : `${s.estimatedMonthlySales}個`}`);
    console.log(`  自分に回ってくる推定：${s.perSellerMonthly === null ? '不明' : `月${s.perSellerMonthly}個`}`);
    console.log(`  推定の回転日数：${s.estimatedTurnoverDays === null ? '不明' : `${s.estimatedTurnoverDays}日`}`);
    console.log('  ※ 順位の下落回数は販売数そのものではないため、上の数はすべて「推定」です。');
  }
  console.log(`  勢い：${r.trend?.verdict}（${r.trend ? TREND_VERDICT_JA[r.trend.verdict] : ''}）`);
  console.log(`    ${r.trend?.reasonJa}`);
  console.log(`  ライバルの多さ：${r.competition?.score === null ? '判定不能' : `${r.competition?.score}点`}`);
  console.log(`    ${r.competition?.reasonJa}`);
  console.log(`  ${COMPETITION_SCORE_NOTE_JA}`);

  // ================================================================
  console.log(`\n${LINE}`);
  console.log('⑦ 異常値（直していません。人が見て判断してください）');
  console.log(LINE);
  if (r.anomaliesJa.length === 0) {
    console.log('  見つかりませんでした。');
  } else {
    for (const a of r.anomaliesJa) console.log(`  ・${a}`);
  }

  // ================================================================
  console.log(`\n${LINE}`);
  console.log('⑧ 保存した内容');
  console.log(LINE);
  console.log(`  生の応答：keepa_raw_responses に1件（リクエストURLは保存していません＝キーが入るため）`);
  console.log(`  枠の使用：keepa_token_usage に1件`);
  console.log(`  正規化した商品：${r.save?.messageJa ?? '保存していません'}`);
  console.log(`  実市場データ100件に数えるか：数えません（counts_as_real_market = 0）`);
  console.log(`  用途の記録：${KEEPA_USE_SCOPE}`);
  if (r.match) console.log(`  一致候補：asin_match_candidates に${r.match.candidates.length}件`);

  // ================================================================
  console.log(`\n${LINE}`);
  console.log('ここで止まります。');
  console.log(LINE);
  console.log(`  ${KEEPA_DATA_CAUTION_JA}`);
  console.log('  5件へは進みません。進めてよいかは、上の結果を人が見て決めます。');
  console.log('  進めるときは lib/keepa/policy.ts の KEEPA_MAX_ASINS_PER_RUN を書き換えてコミットします');
  console.log('  （環境変数で増やせる経路は作っていません）。');
}

main().catch((e) => {
  // 例外メッセージにキーが混ざらないよう、通信部分では必ず伏せ処理を通してある。
  console.error(e);
  process.exit(1);
});
