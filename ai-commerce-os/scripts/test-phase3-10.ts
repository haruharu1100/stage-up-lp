/**
 * Phase 3.10（KEEPA_READ_ONLY・1件だけ取って止まる）の受け入れテスト。
 *
 * ------------------------------------------------------------------
 * 【このテストは Keepa へ一切アクセスしない】
 *
 * 取得部分は差し替え（`deps.fetchProducts`）で偽物を渡す。
 * APIキーが無くても、ネットワークが無くても、最後まで通る。
 * **テストが本物のAPIを叩き始めると、テストを回すたびに枠が減る。**
 *
 * ------------------------------------------------------------------
 * 【ここで潰しておきたい将来の事故】
 *
 *   1. 1件の上限が、環境変数や引数でこっそり増える
 *   2. 書き込み系のエンドポイントが増える（購入・出品・トラッキング登録）
 *   3. APIキーが params や保存内容やログに混ざる
 *   4. ASINから商品ページURLを組み立て始める（ルール55）
 *   5. アメリカの相場（domainId≠5）を日本の相場として保存する
 *   6. 「値なし」の -1 を 0円・0個として通す
 *   7. 円を100で割って1/100の値段にする
 *   8. 下落回数を「販売数」と呼ぶ（ルール78）
 *   9. Keepa 由来の件数を実市場データ100件に数える（ルール77）
 *  10. 同じ内容を2回保存して件数が水増しされる
 *  11. 取り違えた商品を「たぶん合っている」で通す（ルール48）
 *  12. 「月◯◯万Token使える」を主語にして、短時間の大量取得で詰まる
 */
import fs from 'node:fs';
import path from 'node:path';
import { all, one, run } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import { judgeSellability, SELLABILITY_THRESHOLDS } from '../lib/sellability';
import {
  KEEPA_ALLOWED_ENDPOINTS,
  KEEPA_ALLOWED_HTTP_METHOD,
  KEEPA_API_KEY_ENV,
  KEEPA_API_KEY_MASK,
  KEEPA_COUNTS_AS_REAL_MARKET,
  KEEPA_CURRENT_STAGE,
  KEEPA_DATA_CAUTION_JA,
  KEEPA_DOMAIN_JP,
  KEEPA_EPOCH_MINUTES,
  KEEPA_FORBIDDEN_ACTIONS_JA,
  KEEPA_HAS_7DAY_RANK_DROPS,
  KEEPA_JPY_DIVISOR,
  KEEPA_MAX_ASINS_PER_RUN,
  KEEPA_OPEN_QUESTIONS,
  KEEPA_PRODUCT_URL_AVAILABLE,
  KEEPA_RANK_DROP_WINDOWS,
  KEEPA_STAGES,
  KEEPA_USE_SCOPE,
  redactKeepaKey,
} from '../lib/keepa/policy';
import {
  bucketCapacity,
  checkTokenGate,
  estimateTokenCost,
  KEEPA_BUCKET_MINUTES,
  KEEPA_DAILY_TOKEN_BUDGET,
  KEEPA_DEFAULT_REFILL_RATE_PER_MIN,
  KEEPA_DEFAULT_REQUEST_OPTIONS,
  KEEPA_MIN_REFETCH_HOURS,
  KEEPA_MIN_TOKENS_RESERVE,
  KEEPA_REQUEST_COSTS,
  tokenHeadline,
} from '../lib/keepa/tokens';
import {
  ASIN_MATCH_MIN_LEAD,
  ASIN_MATCH_THRESHOLDS,
  ASIN_MATCH_VERDICTS,
  scoreAsinMatch,
  selectAsinMatch,
} from '../lib/keepa/match';
import {
  auditKeepaFields,
  extractWindowSignals,
  judgeTrend,
  keepaFreshness,
  keepaMinutesToIso,
  normalizeKeepaProduct,
  scoreCompetition,
  TREND_VERDICTS,
} from '../lib/keepa/normalize';
import {
  auditKeepaSchema,
  classifyUnknown,
  KEEPA_FIELD_SPECS,
  KEEPA_SENTINEL,
  readPath,
  shapeOf,
  UNKNOWN_REASON_JA,
} from '../lib/keepa/schema';
import { fetchKeepaProducts, isValidAsin, keepaKeyStatus } from '../lib/keepa/client';
import type { KeepaFetchResult } from '../lib/keepa/client';
import {
  findAnomalies,
  judgeFromKeepa,
  runOneAsin,
  saveNormalizedProduct,
  tokenMonitor,
} from '../lib/keepa/store';
import { loadDotEnv } from '../lib/dotenv';

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

const ROOT = path.join(__dirname, '..');
const readFile = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ================================================================
 * テスト用の偽データ
 *
 * ★実在のASIN・実在の型番を使わない（ルール54）。
 *   後片付けは `B0TESTP3` で始まる文字列だけを消す形にしてある。
 * ================================================================ */

const TEST_ASIN = 'B0TESTP310';
const TEST_ASIN_US = 'B0TESTP311';
const TEST_MODEL = 'P310TESTONLY001';

/** いまから n 分前を Keepa の分数（2011-01-01起点）で表す。 */
function keepaMinutesAgo(minutesAgo: number): number {
  return Math.floor(Date.now() / 60000) - KEEPA_EPOCH_MINUTES - minutesAgo;
}

function fakeCurrent(over: Partial<Record<number, number>> = {}): number[] {
  const a = new Array(20).fill(-1);
  a[0] = -1;    // Amazon本体：在庫なし
  a[1] = 4980;  // 新品最安値（円はそのまま）
  a[2] = 3200;  // 中古最安値
  a[3] = 12000; // 売れ筋順位
  a[4] = 6800;  // 定価
  a[11] = 8;    // 新品出品数
  a[12] = 3;    // 中古出品数
  a[16] = 45;   // 評価（10倍で入っている＝星4.5）
  a[17] = 210;  // レビュー件数
  a[18] = 5180; // カート価格
  for (const [k, v] of Object.entries(over)) a[Number(k)] = v as number;
  return a;
}

/**
 * 価格履歴（csv）の偽物。
 *
 * ★2026-08-25 追加（ルール95）。
 *   実物の応答は `csv` が**36個の枠**を持ち、中身は「時刻,値,時刻,値,…」の配列か null である。
 *   枠の数が足りない偽物を使っていると、添字で読む処理のズレを永久に見逃す。
 */
function fakeCsv(): (number[] | null)[] {
  const a: (number[] | null)[] = new Array(36).fill(null);
  const t = keepaMinutesAgo(60 * 24 * 30);
  a[1] = [t, 5100, t + 60 * 24 * 10, 5050, t + 60 * 24 * 20, 4980];
  a[3] = [t, 14000, t + 60 * 24 * 10, 13000, t + 60 * 24 * 20, 12000];
  return a;
}

function fakeProduct(over: Record<string, any> = {}): any {
  const cur = fakeCurrent();
  const a30 = fakeCurrent({ 1: 5100, 3: 13000 });
  const a90 = fakeCurrent({ 1: 5300, 3: 14000 });
  const a180 = fakeCurrent({ 1: 5500, 3: 15000 });
  return {
    asin: TEST_ASIN,
    domainId: KEEPA_DOMAIN_JP,
    title: 'テスト用ダミー商品 P310 ブラック 1個入り',
    brand: 'TESTBRAND',
    model: TEST_MODEL,
    partNumber: TEST_MODEL,
    eanList: ['4900000000017'],
    upcList: [],
    color: 'ブラック',
    packageQuantity: 1,
    numberOfItems: 1,
    lastUpdate: keepaMinutesAgo(30),
    trackingSince: keepaMinutesAgo(60 * 24 * 400),
    referralFeePercentage: 10,
    fbaFees: { pickAndPackFee: 434 },
    // ★2026-08-25 追加（ルール95）。実物の応答にあって偽物に無かった項目。
    //   形が違うと「形の食い違い（SCHEMA_MISMATCH）」の検査そのものが働かない。
    csv: fakeCsv(),
    availabilityAmazon: -1, // Amazon本体の在庫なし（-1＝値なし。0個ではない）
    stats: {
      current: cur,
      totalOfferCount: 11, // 本当に11人（0との違いを混ぜない＝ルール96）
      retrievedOfferCount: -2, // 今回は offers を頼んでいない＝-2（不明）
      buyBoxPrice: 5180,
      avg30: a30,
      avg90: a90,
      avg180: a180,
      salesRankDrops30: 9,
      salesRankDrops90: 24,
      salesRankDrops180: 45,
      salesRankDrops365: 90,
      offerCountFBA: 3,
      offerCountFBM: 5,
      // ★2026-08-25 訂正（ルール64：テストの方が事実を取り違えていた）。
      //   ここを 0 / 4 という「1つの数」で書いていたが、Keepa の実際の応答は
      //   `stats.current` と同じ添字の**配列**（0=Amazon本体 / 1=新品 / 2=中古）である。
      //   1件目の実取得（B0978NB1VQ）の生データで確認した：
      //     outOfStockPercentage90: [100, 100, 100, -1, -1, ...]
      //   偽物のデータが実物と違う形をしていたせいで、
      //   「配列を数値に変換できず毎回 null になる」不具合をテストが通していた。
      //   テストデータは、実物と同じ形にしないと、この種の抜けを一生見つけられない。
      outOfStockPercentage30: [0, 0, 0, -1],
      outOfStockPercentage90: [0, 4, 4, -1],
      buyBoxIsAmazon: false,
    },
    ...over,
  };
}

function fakeResult(products: any[], over: Partial<KeepaFetchResult> = {}): KeepaFetchResult {
  return {
    ok: true,
    httpStatus: 200,
    raw: { products, tokensLeft: 1150, tokensConsumed: 1, refillRate: 20, refillIn: 45000 },
    tokens: {
      tokensLeft: 1150,
      tokensConsumed: 1,
      refillRate: 20,
      refillIn: 45000,
      tokenFlowReduction: 0,
      processingTimeInMs: 120,
    },
    request: {
      endpoint: 'product',
      method: 'GET',
      params: { domain: String(KEEPA_DOMAIN_JP), asin: TEST_ASIN, stats: '1' },
      requestedAt: new Date().toISOString(),
    },
    errorJa: null,
    estimatedCost: 1,
    ...over,
  };
}

async function cleanup(): Promise<void> {
  await run(`DELETE FROM keepa_products WHERE asin LIKE 'B0TESTP3%'`);
  await run(`DELETE FROM keepa_raw_responses WHERE asin LIKE 'B0TESTP3%'`);
  await run(`DELETE FROM asin_match_candidates WHERE local_product_key LIKE 'P310TESTONLY%'`);

  /*
   * 【枠の記録の後片づけ】
   * `keepa_token_usage` には商品名が入らないので、行だけを見てもテストのものか
   * 本物かを見分けられない。そこで「**本物の取得が1件も無いあいだだけ**」まとめて消す。
   *
   * 本物の取得（テスト用ではないASINで成功した応答）が1件でもあれば、ここは何もしない。
   * テストの後片づけが実測値を巻き添えにしないため（ルール51・実際に起きた事故と同じ形）。
   */
  const real = await one(
    `SELECT COUNT(*) AS n FROM keepa_raw_responses WHERE ok = 1 AND asin NOT LIKE 'B0TESTP3%'`,
  );
  if (Number(real?.n ?? 0) === 0) await run('DELETE FROM keepa_token_usage');
}

async function main(): Promise<void> {
  await ensureReady();
  await cleanup();
  // 枠の記録には商品名が入らないので、テストで増えた行はID範囲で片づける。
  const beforeUsage = Number(
    (await one('SELECT COALESCE(MAX(id), 0) AS id FROM keepa_token_usage'))?.id ?? 0,
  );

  // ================================================================
  console.log('\n[1. 1件だけ。増やせる経路が無い]');
  {
    check('1回に取れるのは1件', KEEPA_MAX_ASINS_PER_RUN === 1);
    check('いまの段階はS1', KEEPA_CURRENT_STAGE === 'S1');
    check('段階は4つ用意してある（1→5→20→100）', KEEPA_STAGES.length === 4);
    check('S1の上限は1件', KEEPA_STAGES[0].maxAsins === 1);

    const policy = readFile('lib/keepa/policy.ts');
    check('上限に環境変数を使っていない', !/process\.env/.test(policy));
    const client = readFile('lib/keepa/client.ts');
    // 【テストの方を直した理由】（ルール64）
    // 元は client.ts 全文の `process.env` を数えて1個であることを求めていたが、
    // ファイル冒頭の説明コメントにも「読むのは process.env.KEEPA_API_KEY だけ」と
    // 書いてあるため2個と数えられて落ちていた。安全装置が壊れたのではなく、
    // テストがコメントとコードを取り違えていた。コメント行を除いてから数える。
    const clientCode = client
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n');
    check('取得側で環境変数を読むのはAPIキーだけ',
      (clientCode.match(/process\.env/g) ?? []).length === 1);

    // 2件渡すと、通信する前に止まる（キーが無くても・あっても止まる）
    const two = await fetchKeepaProducts([TEST_ASIN, TEST_ASIN_US]);
    check('2件渡すと失敗する', two.ok === false);
    check('止めた理由に件数が書いてある', String(two.errorJa).includes('1件まで'));
    check('コードを書き換えないと増やせないと書いてある',
      String(two.errorJa).includes('KEEPA_MAX_ASINS_PER_RUN'));
  }

  // ================================================================
  console.log('\n[2. 読み取りだけ。書き込み系の機能が存在しない]');
  {
    const client = readFile('lib/keepa/client.ts');
    const store = readFile('lib/keepa/store.ts');
    check('呼べるエンドポイントは2つだけ', KEEPA_ALLOWED_ENDPOINTS.length === 2);
    check('product と token のみ',
      KEEPA_ALLOWED_ENDPOINTS.includes('product') && KEEPA_ALLOWED_ENDPOINTS.includes('token'));
    check('HTTPメソッドはGETのみ', KEEPA_ALLOWED_HTTP_METHOD === 'GET');
    check('POSTを書いていない', !/method:\s*'POST'/.test(client) && !/"POST"/.test(client));
    check('PUT/DELETEを書いていない', !/method:\s*'(PUT|DELETE)'/.test(client));
    check('許可リスト方式になっている', client.includes('KEEPA_ALLOWED_ENDPOINTS'));
    check('Keepa側の設定変更（tracking登録）を呼んでいない',
      !/\btracking\/(add|remove)\b/.test(client) && !client.includes('trackingAdd'));

    // 購入・出品・決済を思わせる実装が無い（ルール46の考え方）
    const forbidden = ['placeOrder', 'createOrder', 'submitListing', 'purchase(', 'checkout(', 'payment('];
    for (const f of forbidden) {
      check(`取得側に ${f} が無い`, !client.includes(f));
      check(`保存側に ${f} が無い`, !store.includes(f));
    }
    check('やらないことを日本語で並べてある', KEEPA_FORBIDDEN_ACTIONS_JA.length >= 6);
  }

  // ================================================================
  console.log('\n[3. APIキーが外へ出ない]');
  {
    const client = readFile('lib/keepa/client.ts');
    const store = readFile('lib/keepa/store.ts');
    const script = readFile('scripts/keepa-one.ts');

    check('キーは環境変数の名前で参照している', KEEPA_API_KEY_ENV === 'KEEPA_API_KEY');
    check('キーを引数で渡す関数を作っていない', !/function\s+\w*\(.*apiKey/i.test(client));
    check('キーの値を返す関数が無い', !client.includes('export function keepaKey()'));
    check('画面表示用のマスクが用意されている', KEEPA_API_KEY_MASK.includes('表示しません'));

    const status = keepaKeyStatus();
    check('キーの状態は真偽値と文言だけを返す',
      typeof status.configured === 'boolean' && typeof status.messageJa === 'string');
    check('文言にキーらしき長い文字列が入っていない',
      !/[A-Za-z0-9]{20,}/.test(status.messageJa));

    // 伏せ処理
    const fake = 'abcdefgh12345678';
    check('キー文字列そのものを伏せる',
      redactKeepaKey(`https://api.keepa.com/product?key=${fake}&asin=X`, fake).includes('[REDACTED]'));
    check('伏せたあとにキーが残らない',
      !redactKeepaKey(`key=${fake}`, fake).includes(fake));
    check('キーを渡さなくても key= の後ろを伏せる',
      redactKeepaKey('?key=SOMETHINGSECRET&x=1').includes('[REDACTED]'));
    check('token= の後ろも伏せる', redactKeepaKey('?token=SECRETVALUE').includes('[REDACTED]'));

    // 取得結果に持ち出す情報にキーが無い
    const two = await fetchKeepaProducts([TEST_ASIN, TEST_ASIN_US]);
    check('持ち出すパラメータに key が無い', !('key' in two.request.params));
    check('持ち出す情報にURLが入っていない', !('url' in (two.request as any)));
    check('取得側はURLを返していない', !/return[^;]*url\.toString\(\)/.test(client));
    check('保存側は保存の直前にも伏せ処理を通している', store.includes('redactKeepaKey'));
    check('保存する表にURLの列が無い', !readFile('lib/db/schema.ts').includes('request_url'));
    check('コマンドがキーを出力していない',
      !script.includes('console.log(key)') && !/console\.log\([^)]*process\.env/.test(script));
    check('.env 読み込みは名前だけを返す', readFile('lib/dotenv.ts').includes('名前だけ'));
    const names = loadDotEnv('.env.example');
    check('.env 読み込みの戻り値は文字列の配列（値ではない）', Array.isArray(names));
    check('.env が git 管理外になっている', readFile('.gitignore').includes('.env'));
  }

  // ================================================================
  console.log('\n[4. URLを組み立てない（ルール55）]');
  {
    for (const f of ['lib/keepa/policy.ts', 'lib/keepa/normalize.ts', 'lib/keepa/store.ts', 'lib/keepa/match.ts']) {
      const src = readFile(f);
      check(`${f} にURL組み立て関数が無い`,
        !/function\s+(build|make|generate)Url/i.test(src));
      check(`${f} が amazon.co.jp のURLを組み立てていない`,
        !/amazon\.co\.jp\/dp/.test(src));
    }
    check('商品ページURLは取れないと記録してある', KEEPA_PRODUCT_URL_AVAILABLE === false);
    const schema = readFile('lib/db/schema.ts');
    const keepaSchema = schema.slice(schema.indexOf('SCHEMA_KEEPA'));
    // 【テストの方を直した理由】（ルール64）
    // 元は文字列 'product_url' がSCHEMA_KEEPAの範囲に出てこないことを求めていたが、
    // schema.ts の中に「★ product_url の列を作っていない。」という説明コメントがあり、
    // その文言に反応して落ちていた。列が作られていないという事実は変わっていない。
    // 見るべきなのは「列の定義があるか」なので、列定義の形だけを検査する。
    check('保存する表に product_url 列が無い',
      !/^\s*product_url\s+(TEXT|INTEGER|REAL)/m.test(keepaSchema));
  }

  // ================================================================
  console.log('\n[5. 日本のAmazonでなければ保存しない]');
  {
    check('日本のドメイン番号は5', KEEPA_DOMAIN_JP === 5);
    const jp = normalizeKeepaProduct(fakeProduct());
    check('domainId=5 は日本と判定', jp.isJapan === true);

    const us = normalizeKeepaProduct(fakeProduct({ asin: TEST_ASIN_US, domainId: 1 }));
    check('domainId=1 は日本ではない', us.isJapan === false);

    const saved = await saveNormalizedProduct(us, {
      competition: scoreCompetition(us),
      trend: judgeTrend(us),
      sellability: { windowDays: null, result: null },
    });
    check('日本以外は保存しない', saved.saved === false);
    check('止めた理由が日本語で出る', saved.messageJa.includes('日本のAmazon'));
    const rows = await all('SELECT id FROM keepa_products WHERE asin = ?', [TEST_ASIN_US]);
    check('日本以外の行は1件も入っていない', rows.length === 0);
  }

  // ================================================================
  console.log('\n[6. 「値なし」を0で代用しない・円を割らない]');
  {
    check('円の割り算は1（＝割らない）', KEEPA_JPY_DIVISOR === 1);
    const n = normalizeKeepaProduct(fakeProduct());
    check('4980 は 4,980円のまま', n.currentNewPrice === 4980);
    check('100で割っていない', n.currentNewPrice !== 49.8 && n.currentNewPrice !== 50);

    // -1（値なし）は null。0ではない。
    check('Amazon本体の価格 -1 は null', n.currentAmazonPrice === null);
    check('Amazon本体の価格を0円にしていない', n.currentAmazonPrice !== 0);
    check('Amazon本体の在庫は NO と判定', n.amazonRetailPresent === 'NO');

    const empty = normalizeKeepaProduct({ asin: TEST_ASIN, domainId: 5 });
    check('統計が無ければ新品価格は null', empty.currentNewPrice === null);
    check('統計が無ければ出品数は null', empty.offerCountNew === null);
    check('取れなかった項目を並べている', empty.unknownFields.length > 0);
    check('商品名が無ければ不明として挙がる', empty.unknownFields.includes('商品名'));

    check('評価は10分の1にして星の値にする', n.rating === 4.5);
    check('FBA手数料が円で取れる', n.fbaPickAndPackFee === 434);
    check('販売手数料率が取れる', n.referralFeePercentage === 10);
    check('Keepaの分数を日時に直せる', (keepaMinutesToIso(keepaMinutesAgo(0)) ?? '').startsWith('20'));
    check('0以下の分数は null', keepaMinutesToIso(0) === null);

    /* ★2026-08-25 追加：1件目の実取得で見つかった取り込み漏れの再発防止。
       在庫切れ割合は配列（0=Amazon本体 / 1=新品 / 2=中古）で来る。
       配列のまま Number() に通すと NaN になり、値があるのに毎回「不明」になっていた。
       「不明」は安全側に見えるが、ここでは品切れの多い商品（＝入り込む余地がある）を
       見落とす方向に効くので、静かに機会を捨てることになる。 */
    check('在庫切れ割合は配列から新品の値を読む（30日）', n.outOfStockPercentage30 === 0);
    check('在庫切れ割合は配列から新品の値を読む（90日）', n.outOfStockPercentage90 === 4);
    check('配列を丸ごと数値化していない（NaN→nullにしていない）',
      n.outOfStockPercentage90 !== null);
    const oosAll = normalizeKeepaProduct(fakeProduct({
      stats: { ...fakeProduct().stats, outOfStockPercentage90: [100, 100, 100, -1] },
    }));
    check('品切れ100%を読み取れる', oosAll.outOfStockPercentage90 === 100);
    const oosAllScore = scoreCompetition(oosAll).score;
    const oosBaseScore = scoreCompetition(normalizeKeepaProduct(fakeProduct())).score;
    check('品切れが多いとライバルの多さが下がる',
      oosAllScore !== null && oosBaseScore !== null && oosAllScore < oosBaseScore);
    const oosNone = normalizeKeepaProduct(fakeProduct({
      stats: { ...fakeProduct().stats, outOfStockPercentage90: [-1, -1, -1, -1] },
    }));
    check('値なし(-1)は0%ではなく不明', oosNone.outOfStockPercentage90 === null);
  }

  // ================================================================
  console.log('\n[7. 下落回数は販売数ではない（ルール78）]');
  {
    const normalize = readFile('lib/keepa/normalize.ts');
    check('項目名が salesRankDrops のまま', normalize.includes('salesRankDrops30'));
    check('下落回数を「販売数」と呼んでいない', !/sales(Count|Volume)30/.test(normalize));
    check('コメントで販売数ではないと明記している', normalize.includes('販売数ではない'));

    const s = judgeSellability({
      observedAt: new Date().toISOString(),
      windowDays: 90,
      rankDrops: 24,
      offerCount: 8,
    });
    check('推定の月間販売数という名前になっている', 'estimatedMonthlySales' in s);
    check('推定の回転日数という名前になっている', 'estimatedTurnoverDays' in s);

    const script = readFile('scripts/keepa-one.ts');
    check('報告にも「推定」と書いている', script.includes('すべて「推定」です'));
  }

  // ================================================================
  console.log('\n[8. 7日間の下落回数は存在しないので UNKNOWN のまま]');
  {
    check('Keepaの期間は4つ', KEEPA_RANK_DROP_WINDOWS.length === 4);
    check('7日は含まれない', !(KEEPA_RANK_DROP_WINDOWS as readonly number[]).includes(7));
    check('7日版は無いと記録してある', KEEPA_HAS_7DAY_RANK_DROPS === false);

    const n = normalizeKeepaProduct(fakeProduct());
    const w = extractWindowSignals(n);
    const seven = w.find((x) => x.window === 'SELLABILITY_7D')!;
    check('7日は UNKNOWN', seven.status === 'UNKNOWN');
    check('7日は「取得できない」扱い', seven.provenance === 'NOT_AVAILABLE');
    check('7日に数字を作っていない', seven.rankDrops === null);
    check('7日が不明である理由を書いている', seven.noteJa.includes('項目がありません'));

    const thirty = w.find((x) => x.window === 'SELLABILITY_30D')!;
    check('30日は Keepa の項目として取れる', thirty.provenance === 'KEEPA_FIELD');
    check('30日の回数が入っている', thirty.rankDrops === 9);
    const ninety = w.find((x) => x.window === 'SELLABILITY_90D')!;
    check('90日も取れる', ninety.rankDrops === 24);
  }

  // ================================================================
  console.log('\n[9. 勢い（一時的なブームと安定を分ける）]');
  {
    check('判定は5種類', TREND_VERDICTS.length === 5);
    check('「材料不足」を持っている', TREND_VERDICTS.includes('INSUFFICIENT_DATA' as any));

    const stable = judgeTrend(normalizeKeepaProduct(fakeProduct()));
    check('30日9回・90日24回は安定', stable.verdict === 'STABLE', `ratio=${stable.ratio?.toFixed(2)}`);

    const few = judgeTrend(normalizeKeepaProduct(fakeProduct({
      stats: { ...fakeProduct().stats, salesRankDrops30: 1, salesRankDrops90: 2 },
    })));
    check('回数が少なすぎるときは判断しない', few.verdict === 'INSUFFICIENT_DATA');
    check('判断しない理由を書いている', few.reasonJa.includes('たまたま'));

    const boom = judgeTrend(normalizeKeepaProduct(fakeProduct({
      stats: { ...fakeProduct().stats, salesRankDrops30: 19, salesRankDrops90: 20 },
    })));
    check('90日の動きが直近30日に集中していれば「読みにくい」', boom.verdict === 'VOLATILE');
    check('一時的なブームの可能性に触れている', boom.reasonJa.includes('一時的'));

    const down = judgeTrend(normalizeKeepaProduct(fakeProduct({
      stats: { ...fakeProduct().stats, salesRankDrops30: 3, salesRankDrops90: 30 },
    })));
    check('直近が落ちていれば減速', down.verdict === 'DECELERATING');

    const nulls = judgeTrend(normalizeKeepaProduct({ asin: TEST_ASIN, domainId: 5 }));
    check('回数が取れなければ判断しない', nulls.verdict === 'INSUFFICIENT_DATA');
  }

  // ================================================================
  console.log('\n[10. ライバルの多さは出品者数だけで決めない]');
  {
    const base = scoreCompetition(normalizeKeepaProduct(fakeProduct()));
    check('点数が出る', base.status === 'AVAILABLE' && base.score !== null);
    check('材料を分けて持っている', base.materials.length >= 5);
    check('内訳に出品数が入っている', base.materials.some((m) => m.labelJa === '新品の出品数'));
    check('内訳にAmazon本体が入っている', base.materials.some((m) => m.labelJa === 'Amazon本体の在庫'));
    check('内訳にカートの保持者が入っている', base.materials.some((m) => m.labelJa === 'カートの保持者'));

    const withAmazon = scoreCompetition(normalizeKeepaProduct(fakeProduct({
      stats: { ...fakeProduct().stats, current: fakeCurrent({ 0: 4800 }), buyBoxIsAmazon: true },
    })));
    check('Amazon本体がいると点数が上がる', (withAmazon.score ?? 0) > (base.score ?? 0),
      `${base.score} → ${withAmazon.score}`);

    const noOffers = scoreCompetition(normalizeKeepaProduct({ asin: TEST_ASIN, domainId: 5 }));
    check('出品数が取れなければ点を作らない', noOffers.score === null);
    check('その場合は UNKNOWN', noOffers.status === 'UNKNOWN');
    check('取れない材料を0点＝安全と読まない説明がある',
      readFile('lib/keepa/normalize.ts').includes('都合よく0点'));
  }

  // ================================================================
  console.log('\n[11. ASIN_MATCH_SCORE：取り違えを止める]');
  {
    check('判定は3種類', ASIN_MATCH_VERDICTS.length === 3);
    check('「たぶん合っている」が無い',
      !(ASIN_MATCH_VERDICTS as readonly string[]).some((v) => /PROBABLY|MAYBE|LIKELY/.test(v)));

    const amazon = {
      asin: TEST_ASIN,
      eanList: ['4900000000017'],
      upcList: [],
      model: TEST_MODEL,
      partNumber: TEST_MODEL,
      brand: 'TESTBRAND',
      title: 'テスト用ダミー商品 P310 ブラック 1個入り',
      color: 'ブラック',
      packageQuantity: 1,
      numberOfItems: 1,
    };

    const good = scoreAsinMatch(
      { jan: '4900000000017', model: TEST_MODEL, brand: 'TESTBRAND', name: 'テスト用ダミー商品 P310 ブラック 1個入り', color: 'ブラック', quantity: 1 },
      amazon,
    );
    check('全部そろえば一致と判定', good.verdict === 'MATCHED', `${good.score}点`);
    check('しきい値以上になっている', good.score >= ASIN_MATCH_THRESHOLDS.MATCHED);
    check('判断の内訳を項目ごとに持っている', good.fields.length === 6);

    // 拒否権①：バーコード違い
    const badCode = scoreAsinMatch(
      { jan: '4900000000024', model: TEST_MODEL, brand: 'TESTBRAND', name: amazon.title, quantity: 1 },
      amazon,
    );
    check('バーコードが違えば、他が合っていても不一致', badCode.verdict === 'MISMATCH', `${badCode.score}点`);
    check('決定的な違いとして記録する', badCode.vetoes.length >= 1);

    // 拒否権②：入数違い
    const badQty = scoreAsinMatch(
      { jan: '4900000000017', model: TEST_MODEL, brand: 'TESTBRAND', name: amazon.title, quantity: 3 },
      amazon,
    );
    check('入数が違えば不一致', badQty.verdict === 'MISMATCH');
    check('単品とセットの取り違えに触れている',
      badQty.vetoes.some((v) => v.includes('セット')));

    // 拒否権③：ブランド違い
    const badBrand = scoreAsinMatch(
      { jan: '4900000000017', model: TEST_MODEL, brand: 'OTHERBRAND', name: amazon.title, quantity: 1 },
      amazon,
    );
    check('ブランドが違えば不一致', badBrand.verdict === 'MISMATCH');

    // 空欄は「違い」ではない
    const missing = scoreAsinMatch({ jan: null, model: TEST_MODEL, brand: null, name: amazon.title }, amazon);
    check('空欄を「違う」と扱わない', missing.vetoes.length === 0);
    // 【テストの方を直した理由】（ルール64）
    // 元は「型番＋商品名だけ（30点）」で NEEDS_HUMAN_CHECK になることを求めていたが、
    // 30点は候補の最低ライン（MIN_CANDIDATE = 40点）に届かないので MISMATCH が正しい。
    // 材料が少なすぎるものを人の確認へ回すと、確認待ちの山に埋もれて判断が甘くなる。
    // 判定の方は正しく、テストの期待値が間違っていた。
    check('材料が少なすぎるものは候補にもしない', missing.verdict === 'MISMATCH', `${missing.score}点`);

    // 候補の最低ラインは超えるが確定はできない（型番20＋ブランド10＋商品名10＋入数6＝46点）
    const partial = scoreAsinMatch(
      { jan: null, model: TEST_MODEL, brand: 'TESTBRAND', name: amazon.title, quantity: 1 },
      amazon,
    );
    check('バーコードが無ければ確定させない', partial.verdict === 'NEEDS_HUMAN_CHECK', `${partial.score}点`);
    check('その点数は候補の最低ライン以上', partial.score >= ASIN_MATCH_THRESHOLDS.MIN_CANDIDATE);
    check('確定ラインには届いていない', partial.score < ASIN_MATCH_THRESHOLDS.MATCHED);

    // 型番違いは拒否権にしない（表記ゆれが多いため）
    const modelDiff = scoreAsinMatch(
      { jan: '4900000000017', model: 'DIFFERENT999', brand: 'TESTBRAND', name: amazon.title, quantity: 1 },
      amazon,
    );
    check('型番違いは拒否権にしない', modelDiff.vetoes.length === 0);

    // 候補が競っているときは選ばない
    const a = scoreAsinMatch({ jan: '4900000000017', model: TEST_MODEL, brand: 'TESTBRAND', name: amazon.title, quantity: 1 }, amazon);
    const b = scoreAsinMatch({ jan: '4900000000017', model: TEST_MODEL, brand: 'TESTBRAND', name: amazon.title, quantity: 1 }, { ...amazon, asin: TEST_ASIN_US });
    const close = selectAsinMatch([a, b]);
    check('点数が近い候補が並んだら選ばない', close.chosenAsin === null);
    check('その場合は人の確認へ', close.verdict === 'NEEDS_HUMAN_CHECK');
    check('差が何点しかないかを日本語で言う', close.reasonJa.includes('点しかありません'));
    check('必要な点差が決めてある', ASIN_MATCH_MIN_LEAD === 15);

    const alone = selectAsinMatch([a]);
    check('候補が1つで十分な点数なら選べる', alone.chosenAsin === TEST_ASIN);

    const none = selectAsinMatch([]);
    check('候補が無ければ不一致', none.verdict === 'MISMATCH');
    check('候補が無いときにASINを返さない', none.chosenAsin === null);

    const match = readFile('lib/keepa/match.ts');
    check('しきい値を下げるなという注意が書いてある', match.includes('ここを下げない'));
    check('1つのJANに複数のASINがある事実を書いてある', match.includes('複数のASIN'));
  }

  // ================================================================
  console.log('\n[12. Token は「月の総量」ではなく「1分あたりの補充」で管理する]');
  {
    check('補充速度の既定値がある', KEEPA_DEFAULT_REFILL_RATE_PER_MIN === 20);
    check('貯められるのは60分ぶん', KEEPA_BUCKET_MINUTES === 60);
    check('上限＝補充速度×60', bucketCapacity(20) === 1200);
    check('補充速度が変われば上限も変わる', bucketCapacity(5) === 300);

    const headline = tokenHeadline({ refillRatePerMin: 20, tokensLeft: 900, usedToday: 12 });
    check('1行の結論が「1分あたり」から始まる', headline.startsWith('1分あたり'));
    check('60分で消えることを書いている', headline.includes('期限切れ'));
    check('月の総量を主語にしていない', !headline.includes('89万') && !headline.includes('月間'));

    const tokens = readFile('lib/keepa/tokens.ts');
    check('ご本人の指示を原文で残している', tokens.includes('20 Token/分'));
    check('バケツ方式だと説明している', tokens.includes('バケツ'));

    /*
     * 【テストの方を直した理由】（ルール64・76）
     * `OFFERS >= 19` を合格条件にしていたが、19 という数字に根拠が無かった。
     * 公式ドキュメントの実額は「オファー1ページ（最大10件）につき 6」。
     * 根拠のない多めの数字をテストで固定すると、**正しい値に直すと不合格になる**。
     * 検査すべきは「19以上か」ではなく「基本の取得よりはっきり重いか」なので、そちらへ変える。
     */
    check('出品者一覧は基本の取得よりはっきり重い',
      KEEPA_REQUEST_COSTS.OFFERS >= KEEPA_REQUEST_COSTS.PRODUCT_BASE * 5);
    check('統計は無料', KEEPA_REQUEST_COSTS.STATS === 0);
    check('カートの詳細は+2', KEEPA_REQUEST_COSTS.BUYBOX === 2);
    check('既定では出品者一覧を付けない', KEEPA_DEFAULT_REQUEST_OPTIONS.offers === false);
    check('既定では統計だけ付ける', KEEPA_DEFAULT_REQUEST_OPTIONS.stats === true);
    check('1件・統計のみの見積もりは1', estimateTokenCost(1, KEEPA_DEFAULT_REQUEST_OPTIONS) === 1);
    check('出品者一覧を付けると重くなる',
      estimateTokenCost(1, { stats: true, buyBox: false, offers: true }) === 7);
    check('見積もりは実額より少なくしない（多めに見積もる）',
      estimateTokenCost(1, { stats: true, buyBox: false, offers: true }) >= 6);
    check('実額の根拠を書いてある', readFile('lib/keepa/tokens.ts').includes('keepa.com/api-docs/'));

    const ok = checkTokenGate({ tokensLeft: 900, refillRatePerMin: 20, usedToday: 0, estimatedCost: 1 });
    check('余裕があれば通す', ok.allowed === true);
    check('何分ぶんの補充にあたるかを言う', ok.reasonJa.includes('分ぶんの補充'));

    const low = checkTokenGate({ tokensLeft: 50, refillRatePerMin: 20, usedToday: 0, estimatedCost: 1 });
    check('残りが少なければ止める', low.allowed === false);
    check('あと何分待てばよいかを言う', typeof low.waitMinutes === 'number' && (low.waitMinutes ?? 0) > 0);
    check('手元に残す量が決めてある', KEEPA_MIN_TOKENS_RESERVE === 100);

    const over = checkTokenGate({
      tokensLeft: 1000,
      refillRatePerMin: 20,
      usedToday: KEEPA_DAILY_TOKEN_BUDGET,
      estimatedCost: 1,
    });
    check('1日の上限を超えたら止める', over.allowed === false);
    check('日付が変わればまた使えると伝える', over.reasonJa.includes('日付が変わ'));

    const first = checkTokenGate({ tokensLeft: null, refillRatePerMin: 20, usedToday: 0, estimatedCost: 1 });
    check('まだ一度も取っていなければ1件だけ通す', first.allowed === true);
    check('残りが分からないことを隠さない', first.reasonJa.includes('分かりません'));

    check('取り直しは24時間あける', KEEPA_MIN_REFETCH_HOURS === 24);
  }

  // ================================================================
  console.log('\n[13. 1件の全工程（取得→保存→正規化→判定→枠の確認）]');
  {
    let calls: string[][] = [];
    const fake = async (asins: string[]): Promise<KeepaFetchResult> => {
      calls.push(asins);
      return fakeResult([fakeProduct()]);
    };

    const r = await runOneAsin(
      TEST_ASIN,
      { productKey: TEST_MODEL, jan: '4900000000017', model: TEST_MODEL, brand: 'TESTBRAND', name: 'テスト用ダミー商品 P310 ブラック 1個入り', quantity: 1 },
      { fetchProducts: fake },
      { windowDays: 90 },
    );

    check('取得は1回だけ', calls.length === 1);
    check('渡したASINは1件だけ', calls[0].length === 1);
    check('全工程が通る', r.ok === true, r.stoppedReasonJa ?? '');
    check('正規化された結果がある', r.normalized !== null);
    check('売れるか判定が出ている', r.sellability !== null);
    check('勢いが出ている', r.trend !== null);
    check('ライバルの多さが出ている', r.competition !== null);
    check('同一商品の判定が出ている', r.match !== null);
    check('枠の実額が出ている', r.tokens?.tokensConsumed === 1);
    check('見積もりも出ている', r.estimatedCost === 1);
    check('枠の監視が更新されている', r.monitor.refillRatePerMin === 20);
    check('保存された', r.save?.saved === true);

    const rows = await all('SELECT * FROM keepa_products WHERE asin = ?', [TEST_ASIN]);
    check('商品が1件保存されている', rows.length === 1);
    check('用途が内部検証に限定されている', rows[0]?.use_scope === KEEPA_USE_SCOPE);
    check('実市場データに数えていない', Number(rows[0]?.counts_as_real_market) === 0);
    check('新品価格がそのまま保存されている', Number(rows[0]?.current_new_price) === 4980);
    check('売れるか判定も保存されている', typeof rows[0]?.sellability_verdict === 'string');

    const raws = await all('SELECT * FROM keepa_raw_responses WHERE asin = ?', [TEST_ASIN]);
    check('生の応答が残っている', raws.length === 1);
    check('保存したパラメータにキーが無い', !String(raws[0]?.params_json).includes('key'));
    check('保存した内容にURLが無い', !String(raws[0]?.params_json).includes('api.keepa.com'));

    const cands = await all('SELECT * FROM asin_match_candidates WHERE local_product_key = ?', [TEST_MODEL]);
    check('一致候補が保存されている', cands.length === 1);
    check('人の答えを入れる列が別にある', 'human_verdict' in (cands[0] ?? {}));
    check('人の答えは空のまま（機械判定を上書きしていない）', cands[0]?.human_verdict === null);

    // 同じ内容をもう一度：増えない（冪等性）
    const again = await saveNormalizedProduct(normalizeKeepaProduct(fakeProduct()), {
      competition: scoreCompetition(normalizeKeepaProduct(fakeProduct())),
      trend: judgeTrend(normalizeKeepaProduct(fakeProduct())),
      sellability: { windowDays: 90, result: null },
    });
    check('同じ内容は2行にしない', again.saved === false && again.duplicate === true);
    const after = await all('SELECT id FROM keepa_products WHERE asin = ?', [TEST_ASIN]);
    check('件数が増えていない', after.length === 1);
  }

  // ================================================================
  console.log('\n[14. 同じASINを24時間以内に取り直さない]');
  {
    let called = 0;
    const fake = async (): Promise<KeepaFetchResult> => {
      called++;
      return fakeResult([fakeProduct()]);
    };
    const r = await runOneAsin(TEST_ASIN, null, { fetchProducts: fake as any });
    check('直前に取っていれば通信しない', called === 0);
    check('止めた理由を日本語で返す', String(r.stoppedReasonJa).includes('取得済み'));
    check('止まったので判定もしない', r.normalized === null);
  }

  // ================================================================
  console.log('\n[15. 失敗しても記録は残す]');
  {
    await run('DELETE FROM keepa_raw_responses WHERE asin = ?', [TEST_ASIN_US]);
    const failResult: KeepaFetchResult = fakeResult([], {
      ok: false,
      httpStatus: 429,
      raw: { error: { message: 'too many requests' } },
      errorJa: 'Keepaがエラーを返しました（HTTP 429）',
      tokens: {
        tokensLeft: 0, tokensConsumed: 0, refillRate: 20,
        refillIn: 60000, tokenFlowReduction: 0, processingTimeInMs: 5,
      },
    });
    const r = await runOneAsin(TEST_ASIN_US, null, { fetchProducts: async () => failResult });
    check('失敗として返る', r.ok === false);
    check('失敗の理由が残る', String(r.stoppedReasonJa).includes('429'));

    const raws = await all('SELECT * FROM keepa_raw_responses WHERE asin = ?', [TEST_ASIN_US]);
    check('失敗した応答も保存されている', raws.length === 1);
    check('失敗として記録されている', Number(raws[0]?.ok) === 0);
    const usage = await all(
      'SELECT * FROM keepa_token_usage WHERE id > ? ORDER BY id DESC LIMIT 1',
      [beforeUsage],
    );
    check('失敗しても枠の使用を記録している', usage.length === 1);
  }

  // ================================================================
  console.log('\n[16. 売れるか判定は手入力のときと同じ関数を使う]');
  {
    const store = readFile('lib/keepa/store.ts');
    check('judgeSellability を呼んでいる', store.includes('judgeSellability'));
    check('Keepa専用の判定関数を作っていない',
      !/function\s+judgeSellabilityFromKeepa/.test(store));

    const n = normalizeKeepaProduct(fakeProduct());
    const viaKeepa = judgeFromKeepa(n, { windowDays: 90 });
    const direct = judgeSellability({
      observedAt: n.lastUpdateIso,
      windowDays: 90,
      rankDrops: n.salesRankDrops90,
      salesRank: n.currentSalesRank,
      offerCount: n.offerCountNew,
      avgPrice: n.avgNewPrice90,
      currentPrice: n.currentNewPrice,
    });
    check('入口が違っても判定は同じ', viaKeepa.result.verdict === direct.verdict);
    check('しきい値は共通のものを使っている', SELLABILITY_THRESHOLDS.MIN_RANK_DROPS === 3);

    // Keepa側が古い情報なら、取得した時刻ではなく Keepa の更新時刻で古さを見る
    const old = normalizeKeepaProduct(fakeProduct({ lastUpdate: keepaMinutesAgo(60 * 24 * 200) }));
    const oldJudge = judgeFromKeepa(old, { windowDays: 90 });
    check('Keepa側が古ければ判断しない', oldJudge.result.verdict === 'UNKNOWN');
    check('取得した時刻で新しいことにしない', store.includes('取得した時刻ではない'));
  }

  // ================================================================
  console.log('\n[17. 異常値は直さず、人に見せる（ルール52）]');
  {
    const spike = normalizeKeepaProduct(fakeProduct({
      stats: { ...fakeProduct().stats, current: fakeCurrent({ 1: 40000 }) },
    }));
    const a1 = findAnomalies(spike);
    check('平均から大きく外れた価格を知らせる', a1.some((x) => x.includes('倍です')));
    check('値そのものは直していない', spike.currentNewPrice === 40000);

    const crash = normalizeKeepaProduct(fakeProduct({
      stats: { ...fakeProduct().stats, current: fakeCurrent({ 1: 900 }) },
    }));
    check('安すぎる場合も知らせる', findAnomalies(crash).some((x) => x.includes('偽物')));

    const weird = normalizeKeepaProduct(fakeProduct({
      stats: { ...fakeProduct().stats, salesRankDrops30: 30, salesRankDrops90: 10 },
    }));
    check('ありえない並びを知らせる',
      findAnomalies(weird).some((x) => x.includes('ありえない')));

    const stale = normalizeKeepaProduct(fakeProduct({ lastUpdate: keepaMinutesAgo(60 * 24 * 90) }));
    check('Keepa側が古いことを知らせる',
      findAnomalies(stale).some((x) => x.includes('新しい数字ではありません')));

    const normal = findAnomalies(normalizeKeepaProduct(fakeProduct()));
    check('ふつうの商品では何も出ない', normal.length === 0, normal.join(' / '));

    const store = readFile('lib/keepa/store.ts');
    check('自動で直さないと明記している', store.includes('直さない'));
  }

  // ================================================================
  console.log('\n[18. 用途は社内の検証だけ。未確認の2点を残してある]');
  {
    check('用途が内部検証に固定されている', KEEPA_USE_SCOPE === 'INTERNAL_VERIFICATION_ONLY');
    check('未確認の質問が2件ある', KEEPA_OPEN_QUESTIONS.length === 2);
    check('U1（正規化・保存の可否）がある',
      KEEPA_OPEN_QUESTIONS.some((q) => q.code === 'U1' && q.status === 'UNKNOWN'));
    check('U2（契約終了後の扱い）がある',
      KEEPA_OPEN_QUESTIONS.some((q) => q.code === 'U2' && q.status === 'UNKNOWN'));
    check('実市場データに数えない', KEEPA_COUNTS_AS_REAL_MARKET === false);
    check('第三者サービスであることを注意書きにしている',
      KEEPA_DATA_CAUTION_JA.includes('第三者サービス'));
    // 【テストの方を直した理由】（ルール64・76）
    // 一度は「規約本文を確認できていない」と書かせるテストにしていたが、これは事実誤認だった。
    // Keepa の利用条件（Version of July 28, 2026）は 2026-08-22 にブラウザで本文を読んでおり、
    // 記録が 事業Vault/AI Commerce OS/20_Keepa公式API調査.md に残っている（第2条(4)）。
    // 読んだものを「読んでいない」と書き続ける方が、事実から遠い。
    check('Keepa自身が完全性を保証していないと書いてある',
      KEEPA_DATA_CAUTION_JA.includes('データの完全性は保証しない'));
    check('妥当性の確認が利用者の義務だと書いてある',
      KEEPA_DATA_CAUTION_JA.includes('妥当性を確認しなければならない'));
    check('正確だと決めつけていない',
      KEEPA_DATA_CAUTION_JA.includes('正しい前提では使わず'));

    const script = readFile('scripts/keepa-one.ts');
    check('コマンドが未確認の2点を表示する', script.includes('KEEPA_OPEN_QUESTIONS'));
    check('コマンドが「ここで止まります」と言う', script.includes('ここで止まります'));
    check('5件へ進まないと書いてある', script.includes('5件へは進みません'));
  }

  // ================================================================
  console.log('\n[19. 画面から読めるファイルがデータベース層を引きずっていない（ルール37）]');
  {
    /*
     * ★2026-08-25 修正（ルール64：テストの方が事実を取り違えていた）。
     *   ここは「normalize が読んでよいのは ./policy 1つだけ」と書いていた。
     *   しかしルール37が禁じているのは**データベース層を引きずること**であって、
     *   「読み込みが1つだけ」であることではない。
     *   新しく足した `./schema.ts` は何も import していない（この下で検査している）ので、
     *   画面へバンドルしても安全である。件数ではなく**中身**で判定する形に直した。
     */
    const SAFE_KEEPA_MODULES = ['./policy', './schema'];
    for (const f of ['lib/keepa/policy.ts', 'lib/keepa/tokens.ts', 'lib/keepa/match.ts', 'lib/keepa/schema.ts']) {
      check(`${f} は他のファイルを import していない`, !/^\s*import\s/m.test(readFile(f)));
    }
    const normalize = readFile('lib/keepa/normalize.ts');
    const imports = (normalize.match(/^import[\s\S]*?from\s+'([^']+)'/gm) ?? [])
      .map((s) => (s.match(/from\s+'([^']+)'/) ?? [])[1]);
    check('lib/keepa/normalize.ts は依存ゼロのファイルしか読んでいない',
      imports.length > 0 && imports.every((m) => SAFE_KEEPA_MODULES.includes(m as string)),
      imports.join(', '));
    check('normalize はDB層（lib/db）を読んでいない', !normalize.includes("lib/db") && !normalize.includes("../db"));
    check('schema は node: を読んでいない', !readFile('lib/keepa/schema.ts').includes("from 'node:"));
    check('normalize は node: を読んでいない', !normalize.includes("from 'node:"));
    check('match は node: を読んでいない', !readFile('lib/keepa/match.ts').includes("from 'node:"));
  }

  // ================================================================
  console.log('\n[20. ASINの形を通信の前に確かめる]');
  {
    check('10桁の英数字は通る', isValidAsin('B0TESTP310'));
    check('短いものは弾く', !isValidAsin('B0TEST'));
    check('記号入りは弾く', !isValidAsin('B0-TESTP31'));
    check('空文字は弾く', !isValidAsin(''));
    const bad = await fetchKeepaProducts(['SHORT']);
    check('形がおかしければ通信しない', bad.ok === false);
    check('理由を日本語で返す', String(bad.errorJa).includes('半角英数字10桁'));
    const none = await fetchKeepaProducts([]);
    check('空なら通信しない', none.ok === false);
  }

  // ================================================================
  console.log('\n[21. 枠の監視（画面に出す数字）]');
  {
    const m = await tokenMonitor();
    check('補充速度が出る', m.refillRatePerMin > 0);
    check('上限が補充速度から計算されている', m.capacity === bucketCapacity(m.refillRatePerMin));
    check('今日の使用が数えられている', typeof m.usedToday === 'number');
    check('1商品あたりの平均は、取得0件なら未測定にする',
      m.productCount === 0 ? m.avgPerProduct === null : typeof m.avgPerProduct === 'number');
    check('費用の目安を判定に混ぜないと書いてある',
      m.estimatedCostNoteJa.includes('判定にも計算にも入れていません'));
    check('1行の結論がある', m.headlineJa.length > 0);
  }

  // ================================================================
  console.log('\n[22. 画面（/keepa）— 見せるだけで、ここから取得させない]');
  {
    const page = readFile('app/keepa/page.tsx');
    // ★画面に取得ボタンを置かない。ボタンにすると連打できてしまう。
    //   いまは1件ごとに人が結果を読む段階なので、取得はコマンドからだけにする。
    check('取得を実行するボタン・フォームが無い', !/<form|<button|onClick|action=\{/.test(page));
    check('取得は runOneAsin を画面から呼んでいない', !page.includes('runOneAsin'));
    check('画面はコマンドの使い方を案内している', page.includes('npm run keepa:one'));
    // 枠の監視6項目
    for (const label of ['1分あたりの補充', 'いまの残り', '今日つかった量', '今月つかった量', '取得した商品', '1商品あたりの平均']) {
      check(`枠の監視に「${label}」がある`, page.includes(label));
    }
    check('取得0件のとき「未測定」と出す', page.includes('未測定'));
    check('第三者サービスの注意書きを出している', page.includes('KEEPA_DATA_CAUTION_JA'));
    check('未確認の2点を画面に出している', page.includes('KEEPA_OPEN_QUESTIONS'));
    check('やらないことの一覧を出している', page.includes('KEEPA_FORBIDDEN_ACTIONS_JA'));
    check('販売数ではなく推定だと書いてある', page.includes('実際の販売数ではありません'));
    check('APIキーの値を画面に出していない', !page.includes('process.env'));
    check('1件だけであることを画面に書いてある', page.includes('KEEPA_MAX_ASINS_PER_RUN'));
    const layout = readFile('app/layout.tsx');
    check('メニューから開ける', layout.includes('href="/keepa"'));
  }

  // ================================================================
  console.log('\n[23. 「不明」を2種類に分ける（データが無い vs 当社が読めていない）]');
  {
    /*
     * 【なぜこの検査が要るのか】
     *
     * 「不明（UNKNOWN）」で返しておけば安全、というのは間違いである。
     * 2026-08-25 の初回取得で、在庫切れ割合が**値はあるのに読めていない**まま
     * 「不明」になっていたのを見つけた。テストは267項目すべて通っていた。
     *
     * 不明には2つある。混ぜてはいけない。
     *   DATA_NOT_AVAILABLE     … Keepa に値が無い（市場データの問題。当社にできることは無い）
     *   PARSER_OR_SCHEMA_ERROR … 値はあるのに当社が読めていない（**当社のコードの不具合**）
     */
    const p = fakeProduct();

    // --- 形の監査（SCHEMA_AUDIT）---------------------------------
    const audit = auditKeepaSchema(p);
    check('検査する項目が20個以上ある', KEEPA_FIELD_SPECS.length >= 20, `${KEEPA_FIELD_SPECS.length}項目`);
    check(
      '偽データは実物と同じ形（形の食い違いが0件）',
      audit.mismatches.length === 0,
      audit.mismatches.map((m) => `${m.path}:${m.actual}`).join(' / '),
    );
    check('監査結果に日本語の見出しがある', audit.headlineJa.length > 0);
    check('形が正しければ ok = true', audit.ok === true);

    // --- わざと形を壊すと必ず気づけるか ---------------------------
    // ★ここが本題。壊したのに黙って「不明」で通るなら、この仕組みは役に立っていない。
    const broken = fakeProduct({
      stats: { ...p.stats, outOfStockPercentage90: 4 }, // 配列で来るはずが1つの数
    });
    const brokenAudit = auditKeepaSchema(broken);
    check(
      '在庫切れ割合が配列でなければ SCHEMA_MISMATCH として出る',
      brokenAudit.mismatches.some((m) => m.path === 'stats.outOfStockPercentage90'),
    );
    check('形が壊れていれば ok = false', brokenAudit.ok === false);
    // 静かに通さない＝人の目に触れる場所（異常一覧）にも必ず出す
    const brokenAnomalies = findAnomalies(normalizeKeepaProduct(broken));
    check(
      '形の食い違いは異常一覧にも出る（黙って不明で通さない）',
      brokenAnomalies.some((x) => x.includes('形の食い違い')),
    );

    // --- 不明の理由分け ------------------------------------------
    const n = normalizeKeepaProduct(p);
    check(
      '健全なデータでは読み取り不具合が0件',
      n.parserErrors.length === 0,
      n.parserErrors.map((x) => `${x.path}`).join(' / '),
    );
    check('不明の内訳（unknownDetails）を持っている', Array.isArray(n.unknownDetails));
    check('人へ見せる不明（unknownFields）は日本語の項目名', n.unknownFields.every((x) => typeof x === 'string'));

    // -1（値なし）・-2（そもそも頼んでいない）・null・項目そのものが無い → データが無い
    const c1 = classifyUnknown({ stats: { buyBoxPrice: KEEPA_SENTINEL.NO_VALUE } }, 'stats.buyBoxPrice', 'カート価格');
    check('-1 は DATA_NOT_AVAILABLE', c1.reason === 'DATA_NOT_AVAILABLE', c1.reason);
    const c2 = classifyUnknown({ stats: { offerCountFBA: KEEPA_SENTINEL.NOT_REQUESTED } }, 'stats.offerCountFBA', 'FBA出品数');
    check('-2 は DATA_NOT_AVAILABLE', c2.reason === 'DATA_NOT_AVAILABLE', c2.reason);
    check('-2 の説明に「頼んでいない」と書いてある', c2.detailJa.includes('頼んで'), c2.detailJa);
    const c3 = classifyUnknown({ brand: null }, 'brand', 'ブランド');
    check('null は DATA_NOT_AVAILABLE', c3.reason === 'DATA_NOT_AVAILABLE', c3.reason);
    const c4 = classifyUnknown({}, 'monthlySold', '月間販売数');
    check('項目が無いのは DATA_NOT_AVAILABLE', c4.reason === 'DATA_NOT_AVAILABLE', c4.reason);

    // ★値があるのに読めていない → 当社の不具合
    const c5 = classifyUnknown(
      { stats: { outOfStockPercentage90: [0, 4, 4, -1] } },
      'stats.outOfStockPercentage90',
      '90日間の在庫切れ割合',
    );
    check(
      '値があるのに読めていないのは PARSER_OR_SCHEMA_ERROR',
      c5.reason === 'PARSER_OR_SCHEMA_ERROR',
      c5.reason,
    );
    check(
      '不具合側の説明に「システムの不具合」と書いてある',
      UNKNOWN_REASON_JA.PARSER_OR_SCHEMA_ERROR.includes('不具合'),
    );
    check('2つの理由の説明文が別物である', UNKNOWN_REASON_JA.DATA_NOT_AVAILABLE !== UNKNOWN_REASON_JA.PARSER_OR_SCHEMA_ERROR);

    // --- 0 を「不明」に混ぜない（ルール96）-------------------------
    const zero = classifyUnknown({ stats: { totalOfferCount: 0 } }, 'stats.totalOfferCount', '出品者数');
    check('0（本当に0人）は「値が無い」扱いにしない', zero.reason === 'PARSER_OR_SCHEMA_ERROR', zero.reason);
    const sentinels: number[] = [KEEPA_SENTINEL.NO_VALUE, KEEPA_SENTINEL.NOT_REQUESTED];
    check('0 は「値なし」の印に含まれていない', !sentinels.includes(0), sentinels.join(' / '));

    // --- 場所の指定（添字つき）が読めるか --------------------------
    const r1 = readPath(p, 'stats.current[1]');
    check('stats.current[1] を読める', r1.exists && r1.value === 4980, String(r1.value));
    const r2 = readPath(p, 'stats.current[99]');
    check('無い添字は「無い」と返す（0にしない）', r2.exists === false && r2.value !== 0);
    const r3 = readPath(p, 'stats.nothing.here');
    check('途中で切れた場所はどこで切れたかを返す', r3.exists === false && r3.brokeAt !== null, String(r3.brokeAt));
    check('形の判定：配列は array', shapeOf([1, 2]) === 'array');
    check('形の判定：null は null（object にしない）', shapeOf(null) === 'null');

    // --- 鮮度の線は動かさない（ルール11相当の約束）------------------
    const fresh = keepaFreshness(n);
    check('鮮度の上限は30日で固定', fresh.maxDays === 30, String(fresh.maxDays));
    check('30分前の更新なら判定に使える', fresh.usable === true && fresh.ageDays === 0, String(fresh.ageDays));
    const old = normalizeKeepaProduct(fakeProduct({ lastUpdate: keepaMinutesAgo(60 * 24 * 45) }));
    const oldFresh = keepaFreshness(old);
    check('45日前のデータは判定に使わない', oldFresh.usable === false, String(oldFresh.ageDays));
    check('使わない理由が日本語で書いてある', oldFresh.reasonJa.length > 0);

    // --- 突き合わせ表（監査用）------------------------------------
    const rows = auditKeepaFields(p, n);
    check('主要フィールドの突き合わせ表が20行以上出る', rows.length >= 20, `${rows.length}行`);
    check('各行に Keepa 側の場所が書いてある', rows.every((r) => r.path.length > 0));
    check('各行に変換ルールが書いてある', rows.every((r) => r.ruleJa.length > 0));
    check('健全なデータでは不具合の行が無い', rows.every((r) => r.issue !== 'PARSER_OR_SCHEMA_ERROR'));
    const yenRow = rows.find((r) => r.labelJa === '新品最安値');
    check('円は100で割らずそのまま出す', /4,?980/.test(yenRow?.normalizedJa ?? ''), yenRow?.normalizedJa);
    check('信用度は3段階のどれか', rows.every((r) => ['HIGH', 'MEDIUM', 'UNKNOWN'].includes(r.confidence)));

    // --- 検算コマンドは通信しない --------------------------------
    const auditScript = readFile('scripts/keepa-audit.ts');
    check('検算コマンドは取得関数を呼ばない', !auditScript.includes('runOneAsin') && !auditScript.includes('fetchKeepaProducts'));
    check('検算コマンドはAPIキーに触れない', !auditScript.includes('process.env'));
    check('検算コマンドは保存済みの生データだけを読む', auditScript.includes('latestRawResponse'));
    const pkg = JSON.parse(readFile('package.json'));
    check('npm run keepa:audit が登録されている', typeof pkg.scripts['keepa:audit'] === 'string');
  }

  // 後片づけ（テスト専用の文字列だけを消す。ルール54）
  await cleanup();
  await run('DELETE FROM keepa_token_usage WHERE id > ?', [beforeUsage]);
  const left = await all(`SELECT id FROM keepa_products WHERE asin LIKE 'B0TESTP3%'`);
  check('テスト用のデータを残していない', left.length === 0);

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.10（KEEPA_READ_ONLY）の受け入れ条件をすべて満たしています。');
  console.log('※ このテストは Keepa へ一切アクセスしません（取得部分を差し替えて動かしています）。');
  console.log('※ 1回の実行で取れるのは1件だけで、環境変数で増やす経路はありません。');
  console.log('※ APIキーは保存内容・パラメータ・画面表示のどこにも出ません。');
  console.log('※ Keepa 由来の記録は、実市場データ100件には数えていません。');
}

main().catch((e) => { console.error(e); process.exit(1); });
