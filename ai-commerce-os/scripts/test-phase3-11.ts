/**
 * Phase 3.11（ASINの出どころ管理・商品ページURLの決め方）の受け入れテスト。
 *
 * ------------------------------------------------------------------
 * 【このテストは Keepa へ一切アクセスしない】
 *
 * 取得部分も検索部分も差し替え（`deps`）で偽物を渡す。
 * APIキーが無くても、ネットワークが無くても、最後まで通る。
 * **テストが本物のAPIを叩き始めると、テストを回すたびに枠が減る。**
 *
 * ------------------------------------------------------------------
 * 【ここで潰しておきたい将来の事故】
 *
 *   1. AIが作った文字列のASINが、いつのまにか取得に流れる
 *   2. 出どころを「引数で名乗れる」ようになり、名乗るだけで信用される
 *   3. 確かめていないASINから商品ページURLが作られる
 *   4. 親ASIN（買えないことがある）の購入ページを人に押させる
 *   5. 「URLが正しい」が「商品が同じ」に化ける
 *   6. 候補探しで枠を大量に使う（何百・何千ASINを投げる）
 *   7. 候補探しの枠と商品取得の枠が同じ数字に混ざる
 *   8. 候補探しの検索が、書き込み系のエンドポイントに化ける
 */
import fs from 'node:fs';
import path from 'node:path';
import { all, one, run } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import {
  AMAZON_JP_DOMAIN_ID,
  AMAZON_JP_PRODUCT_URL_PREFIX,
  ASIN_CONFIDENCE_FOR_URL,
  ASIN_CONFIDENCE_JA,
  ASIN_CONFIDENCE_LEVELS,
  ASIN_LENGTH,
  ASIN_SOURCE_JA,
  ASIN_SOURCES,
  ASIN_VARIATION_ROLE_JA,
  ASIN_VARIATION_ROLES,
  FORBIDDEN_ASIN_SOURCE_JA,
  FORBIDDEN_ASIN_SOURCES,
  isAllowedAsinSource,
  isAsinShape,
  judgeVariationRole,
  KEEPA_PRODUCT_TYPES,
  PRODUCT_URL_NOTE_JA,
  purchaseGate,
  resolveAmazonProductUrl,
  roleAllowsPurchaseUrl,
  URL_SOURCE_JA,
  URL_SOURCES,
  type AsinProvenance,
} from '../lib/keepa/asinsource';
import {
  KEEPA_ALLOWED_ENDPOINTS,
  KEEPA_DISCOVERY_COSTS,
  KEEPA_DISCOVERY_PER_PAGE,
  KEEPA_DOMAIN_JP,
  KEEPA_EPOCH_MINUTES,
  KEEPA_MAX_DISCOVERY_TOKENS,
  KEEPA_PRODUCT_URL_IN_RESPONSE,
} from '../lib/keepa/policy';
import type { KeepaDiscoveryResult, KeepaFetchResult } from '../lib/keepa/client';
import {
  discoverOneCandidate,
  lookupAsinProvenance,
  runOneAsin,
} from '../lib/keepa/store';

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
 * 偽データ（実在のASINは使わない＝ルール54。後片づけは B0TESTP4 で始まるものだけ）
 * ================================================================ */

const T_ASIN = 'B0TESTP401';
const T_ASIN2 = 'B0TESTP402';
const T_ASIN_PARENT = 'B0TESTP403';

function keepaMinutesAgo(minutesAgo: number): number {
  return Math.floor(Date.now() / 60000) - KEEPA_EPOCH_MINUTES - minutesAgo;
}

/** 実在が確認できている出どころ（URLを作ってよい状態） */
function goodProvenance(over: Partial<AsinProvenance> = {}): AsinProvenance {
  return {
    asin: T_ASIN,
    asinSource: 'KEEPA_API',
    asinVerifiedAt: new Date().toISOString(),
    asinConfidence: 'VERIFIED_EXISTS',
    verificationMethodJa: 'Keepaの商品検索が返した実在ASINの一覧に含まれていた。',
    domainId: AMAZON_JP_DOMAIN_ID,
    ...over,
  };
}

function fakeCurrent(): number[] {
  const a = new Array(20).fill(-1);
  a[1] = 4980;
  a[3] = 12000;
  a[11] = 8;
  a[18] = 5180;
  return a;
}

function fakeProduct(over: Record<string, any> = {}): any {
  return {
    asin: T_ASIN,
    domainId: KEEPA_DOMAIN_JP,
    title: 'テスト用ダミー商品 P411',
    productType: KEEPA_PRODUCT_TYPES.STANDARD,
    lastUpdate: keepaMinutesAgo(30),
    trackingSince: keepaMinutesAgo(60 * 24 * 400),
    csv: new Array(36).fill(null),
    availabilityAmazon: -1,
    stats: {
      current: fakeCurrent(),
      avg30: fakeCurrent(),
      avg90: fakeCurrent(),
      avg180: fakeCurrent(),
      salesRankDrops30: 9,
      salesRankDrops90: 24,
      salesRankDrops180: 45,
      salesRankDrops365: 90,
      totalOfferCount: 11,
      retrievedOfferCount: -2,
      buyBoxPrice: 5180,
      offerCountFBA: 3,
      offerCountFBM: 5,
      outOfStockPercentage30: [0, 0, 0, -1],
      outOfStockPercentage90: [0, 4, 4, -1],
      buyBoxIsAmazon: false,
    },
    ...over,
  };
}

function fakeFetch(products: any[]): KeepaFetchResult {
  return {
    ok: true,
    httpStatus: 200,
    raw: { products, tokensLeft: 1150, tokensConsumed: 1, refillRate: 20, refillIn: 45000 },
    tokens: {
      tokensLeft: 1150, tokensConsumed: 1, refillRate: 20,
      refillIn: 45000, tokenFlowReduction: 0, processingTimeInMs: 120,
    },
    request: {
      endpoint: 'product', method: 'GET',
      params: { domain: String(KEEPA_DOMAIN_JP), asin: T_ASIN, stats: '1' },
      requestedAt: new Date().toISOString(),
    },
    errorJa: null,
    estimatedCost: 1,
  };
}

function fakeDiscovery(asinList: string[], over: Partial<KeepaDiscoveryResult> = {}): KeepaDiscoveryResult {
  return {
    ok: true,
    httpStatus: 200,
    raw: { asinList, totalResults: 137, tokensLeft: 1139, tokensConsumed: 11 },
    tokens: {
      tokensLeft: 1139, tokensConsumed: 11, refillRate: 20,
      refillIn: 45000, tokenFlowReduction: 0, processingTimeInMs: 300,
    },
    request: {
      endpoint: 'query', method: 'GET',
      params: { domain: String(KEEPA_DOMAIN_JP), selection: '{}' },
      requestedAt: new Date().toISOString(),
    },
    errorJa: null,
    estimatedCost: 11,
    asinList,
    totalResults: 137,
    ...over,
  };
}

async function cleanup(): Promise<void> {
  await run(`DELETE FROM keepa_products WHERE asin LIKE 'B0TESTP4%'`);
  await run(`DELETE FROM keepa_raw_responses WHERE asin LIKE 'B0TESTP4%'`);
  await run(`DELETE FROM keepa_asin_candidates WHERE asin LIKE 'B0TESTP4%'`);
}

async function main(): Promise<void> {
  await ensureReady();
  await cleanup();
  const beforeUsage = Number(
    (await one('SELECT COALESCE(MAX(id), 0) AS id FROM keepa_token_usage'))?.id ?? 0,
  );
  const beforeRaw = Number(
    (await one('SELECT COALESCE(MAX(id), 0) AS id FROM keepa_raw_responses'))?.id ?? 0,
  );

  // ================================================================
  console.log('\n[1. ASINの出どころ（許可4つ・禁止3つ）]');
  {
    check('使ってよい出どころは4つ', ASIN_SOURCES.length === 4);
    for (const s of ['KEEPA_API', 'OFFICIAL_AMAZON_SOURCE', 'AUTHORIZED_DATA_FEED', 'HUMAN_INPUT']) {
      check(`${s} は使ってよい`, isAllowedAsinSource(s));
      check(`${s} に日本語の説明がある`, typeof ASIN_SOURCE_JA[s as never] === 'string');
    }
    check('使ってはいけない出どころは3つ', FORBIDDEN_ASIN_SOURCES.length === 3);
    for (const s of ['AI_GUESS', 'STRING_GENERATION', 'UNVERIFIED_SEARCH_RESULT']) {
      check(`${s} は使えない`, !isAllowedAsinSource(s));
      check(`${s} に日本語の説明がある`, typeof FORBIDDEN_ASIN_SOURCE_JA[s as never] === 'string');
    }
    check('許可と禁止が重なっていない',
      FORBIDDEN_ASIN_SOURCES.every((f) => !(ASIN_SOURCES as readonly string[]).includes(f)));
    check('知らない文字列は許可されない', !isAllowedAsinSource('SOMETHING_ELSE'));
    check('空文字は許可されない', !isAllowedAsinSource(''));
  }

  // ================================================================
  console.log('\n[2. 確からしさ（「たぶん在る」の段を作らない）]');
  {
    check('確からしさは3段階', ASIN_CONFIDENCE_LEVELS.length === 3);
    check('URLを出すには実在確認済みが要る', ASIN_CONFIDENCE_FOR_URL === 'VERIFIED_EXISTS');
    check('「たぶん在る」のような中間の段が無い',
      !ASIN_CONFIDENCE_LEVELS.some((c) => /PROBABLY|LIKELY|MAYBE/i.test(c)));
    check('未確認は「使いません」と書いてある', ASIN_CONFIDENCE_JA.UNVERIFIED.includes('使いません'));
  }

  // ================================================================
  console.log('\n[3. ASINの形（形が正しいだけでは信用しない）]');
  {
    check('10桁の英数字は形として正しい', isAsinShape('B0TESTP401'));
    check('9桁は正しくない', !isAsinShape('B0TESTP40'));
    check('11桁は正しくない', !isAsinShape('B0TESTP4011'));
    check('記号入りは正しくない', !isAsinShape('B0TEST-401'));
    check('空文字は正しくない', !isAsinShape(''));
    check('ASINの長さは10で固定', ASIN_LENGTH === 10);

    /*
     * ★ここがこのPhaseの一番大事な検査である。
     *   「形が正しい」だけでURLが出てしまうなら、AIが適当に10桁を作れば通ってしまう。
     *   形が正しくても、出どころがAIの推測ならURLは出ない、を実際に確かめる。
     */
    const guessed = resolveAmazonProductUrl(
      goodProvenance({ asinSource: 'AI_GUESS' as never }),
      'STANDALONE',
    );
    check('形が正しくてもAIの推測ならURLを作らない', guessed.available === false);
    check('URLは null のまま', guessed.url === null);
    check('作らなかった理由が日本語で書いてある', guessed.blockersJa.length > 0);
    check('理由に「推測」と書いてある', guessed.blockersJa.join('').includes('推測'));
  }

  // ================================================================
  console.log('\n[4. URLを作ってよい7つの条件（1つでも欠けたら作らない）]');
  {
    const ok = resolveAmazonProductUrl(goodProvenance(), 'STANDALONE');
    check('7条件をすべて満たせばURLを作る', ok.available === true);
    check('URLは Amazon 公式の形', ok.url === `${AMAZON_JP_PRODUCT_URL_PREFIX}${T_ASIN}`);
    check('URLの出どころは公式ASIN形式', ok.urlSource === 'AMAZON_OFFICIAL_ASIN_PATTERN');
    check('URLの出どころに AI_GENERATED という選択肢が無い',
      !(URL_SOURCES as readonly string[]).includes('AI_GENERATED'));
    check('URL_VALID は true', ok.urlValid === true);
    check('作った理由が日本語で書いてある', ok.reasonJa.length > 10);
    check('理由に「商品が同じかは別」と釘を刺してある', ok.reasonJa.includes('別'));

    // ①禁止された出どころ
    for (const bad of FORBIDDEN_ASIN_SOURCES) {
      const r = resolveAmazonProductUrl(goodProvenance({ asinSource: bad as never }), 'STANDALONE');
      check(`出どころが ${bad} ならURLを作らない`, r.available === false && r.url === null);
    }
    // ②許可外の出どころ
    const unknownSrc = resolveAmazonProductUrl(
      goodProvenance({ asinSource: 'WHATEVER' as never }), 'STANDALONE');
    check('知らない出どころならURLを作らない', unknownSrc.available === false);
    // ③確からしさ
    for (const c of ['REPORTED', 'UNVERIFIED'] as const) {
      const r = resolveAmazonProductUrl(goodProvenance({ asinConfidence: c }), 'STANDALONE');
      check(`確からしさが ${c} ならURLを作らない`, r.available === false);
    }
    // ④確認日時
    const noDate = resolveAmazonProductUrl(goodProvenance({ asinVerifiedAt: null }), 'STANDALONE');
    check('実在を確認した日時が無ければURLを作らない', noDate.available === false);
    check('理由に日時のことが書いてある', noDate.blockersJa.join('').includes('日時'));
    // ⑤形
    const badShape = resolveAmazonProductUrl(goodProvenance({ asin: 'SHORT' }), 'STANDALONE');
    check('ASINの形が違えばURLを作らない', badShape.available === false);
    // ⑥市場
    const us = resolveAmazonProductUrl(goodProvenance({ domainId: 1 }), 'STANDALONE');
    check('日本のAmazonでなければURLを作らない', us.available === false);
    check('理由に Amazon.co.jp と書いてある', us.blockersJa.join('').includes('Amazon.co.jp'));
    // ⑦親ASIN
    const parent = resolveAmazonProductUrl(goodProvenance(), 'PARENT');
    check('親ASINならURLを作らない', parent.available === false);
    const unknownRole = resolveAmazonProductUrl(goodProvenance(), 'UNKNOWN');
    check('親か子か分からなければURLを作らない', unknownRole.available === false);

    // 条件は7つそろって初めて通る、を数で確かめる
    const allBad = resolveAmazonProductUrl(
      {
        asin: 'x', asinSource: 'AI_GUESS' as never, asinVerifiedAt: null,
        asinConfidence: 'UNVERIFIED', verificationMethodJa: '', domainId: 1,
      },
      'PARENT',
    );
    check('全部だめなら理由が7件そろう', allBad.blockersJa.length === 7, `${allBad.blockersJa.length}件`);
  }

  // ================================================================
  console.log('\n[5. 親ASIN / 子ASIN（分からないときは UNKNOWN のまま）]');
  {
    check('役割は4種類', ASIN_VARIATION_ROLES.length === 4);
    check('すべてに日本語の説明がある',
      ASIN_VARIATION_ROLES.every((r) => typeof ASIN_VARIATION_ROLE_JA[r] === 'string'));

    check('productType=5 は親',
      judgeVariationRole({ asin: T_ASIN, productType: KEEPA_PRODUCT_TYPES.VARIATION_PARENT }) === 'PARENT');
    check('親ASINが別にあるなら子',
      judgeVariationRole({ asin: T_ASIN, parentAsin: T_ASIN_PARENT }) === 'CHILD');
    check('自分自身が親として書かれていれば親',
      judgeVariationRole({ asin: T_ASIN, parentAsin: T_ASIN }) === 'PARENT');
    check('子の一覧を持っていれば親',
      judgeVariationRole({ asin: T_ASIN, variations: [{ asin: T_ASIN2 }] }) === 'PARENT');
    check('productType=0 で親も子の一覧も無ければ単独商品',
      judgeVariationRole({ asin: T_ASIN, productType: KEEPA_PRODUCT_TYPES.STANDARD }) === 'STANDALONE');

    // ★ここが Fail Closed の要。分からないものを「たぶん単独」に寄せない。
    check('何も分からなければ UNKNOWN', judgeVariationRole({ asin: T_ASIN }) === 'UNKNOWN');
    check('中身が無ければ UNKNOWN', judgeVariationRole(null) === 'UNKNOWN');
    check('物ですらなければ UNKNOWN', judgeVariationRole('B0TESTP401') === 'UNKNOWN');
    check('ダウンロード商品は UNKNOWN（単独に寄せない）',
      judgeVariationRole({ asin: T_ASIN, productType: KEEPA_PRODUCT_TYPES.DOWNLOADABLE }) === 'UNKNOWN');

    check('購入導線に載せてよいのは単独と子だけ',
      roleAllowsPurchaseUrl('STANDALONE') && roleAllowsPurchaseUrl('CHILD'));
    check('親は載せない', !roleAllowsPurchaseUrl('PARENT'));
    check('分からないものは載せない', !roleAllowsPurchaseUrl('UNKNOWN'));
  }

  // ================================================================
  console.log('\n[6. 「URLが正しい」と「商品が同じ」は別（混ぜない）]');
  {
    const ok = resolveAmazonProductUrl(goodProvenance(), 'STANDALONE');

    const notConfirmed = purchaseGate(ok, false);
    check('URLが正しくても、商品一致が未確認なら購入候補にしない',
      notConfirmed.purchaseUrlAvailable === false);
    check('そのときも URL_VALID は true のまま（片方が片方を消さない）',
      notConfirmed.urlValid === true);
    check('理由に「未確認」と書いてある', notConfirmed.reasonJa.includes('未確認'));

    const confirmed = purchaseGate(ok, true);
    check('両方そろって初めて購入候補になる', confirmed.purchaseUrlAvailable === true);

    const badUrlConfirmed = purchaseGate(resolveAmazonProductUrl(goodProvenance(), 'PARENT'), true);
    check('商品一致を確認しても、URLがだめなら購入候補にしない',
      badUrlConfirmed.purchaseUrlAvailable === false);
    check('その場合 URL_VALID は false', badUrlConfirmed.urlValid === false);

    // 真偽値でないものを渡しても「はい」にしない
    check('true 以外は一致確認として扱わない',
      purchaseGate(ok, 'yes' as never).purchaseUrlAvailable === false);
    check('1 も一致確認として扱わない',
      purchaseGate(ok, 1 as never).purchaseUrlAvailable === false);

    check('画面に添える注意書きがある', PRODUCT_URL_NOTE_JA.length > 50);
    check('注意書きに「AIが推測で作ったURLではない」と書いてある',
      PRODUCT_URL_NOTE_JA.includes('推測で作ったURLではありません'));
    check('注意書きに「カートに入れる・購入する」はしないと書いてある',
      PRODUCT_URL_NOTE_JA.includes('カートに入れる') && PRODUCT_URL_NOTE_JA.includes('購入する'));
    check('URLの出どころ5つすべてに日本語の説明がある',
      URL_SOURCES.every((s) => typeof URL_SOURCE_JA[s] === 'string'));
  }

  // ================================================================
  console.log('\n[7. 候補探しは読み取りだけ・枠を大量に使わない]');
  {
    check('呼べるエンドポイントに query が入っている',
      (KEEPA_ALLOWED_ENDPOINTS as readonly string[]).includes('query'));
    // ★2026-08-25 追記：`category`（売り場の一覧をもらうだけ）を足した。
    //   これも一覧を返すだけで、何も書き換えない。中身で判定する方針は変えていない。
    check('呼べるエンドポイントは読み取り専用のものだけ',
      KEEPA_ALLOWED_ENDPOINTS.every((e) => ['product', 'token', 'query', 'category'].includes(e)),
      KEEPA_ALLOWED_ENDPOINTS.join(' / '));

    /*
     * 公式ドキュメントの記載：
     *   Product Finder … 基本10 ＋ 結果100件ごとに1（stats を付けると +30）
     *   1ページの最小は50件
     * よって 10 + 1 = 11。これを上限15の中に収める。
     */
    check('候補探しの基本費用は10', KEEPA_DISCOVERY_COSTS.QUERY_BASE === 10);
    check('100件ごとに1', KEEPA_DISCOVERY_COSTS.QUERY_PER_100_ASINS === 1);
    check('statsを付けると+30と記録してある', KEEPA_DISCOVERY_COSTS.QUERY_STATS_EXTRA === 30);
    check('1ページは50件（公式の最小）', KEEPA_DISCOVERY_PER_PAGE === 50);
    const estimate = KEEPA_DISCOVERY_COSTS.QUERY_BASE
      + Math.max(1, Math.ceil(KEEPA_DISCOVERY_PER_PAGE / 100)) * KEEPA_DISCOVERY_COSTS.QUERY_PER_100_ASINS;
    check('候補探しの見積もりは11', estimate === 11, String(estimate));
    check('候補探しの上限は15', KEEPA_MAX_DISCOVERY_TOKENS === 15);
    check('見積もりが上限を超えていない', estimate <= KEEPA_MAX_DISCOVERY_TOKENS);

    const client = readFile('lib/keepa/client.ts');
    check('候補探しは stats を拒む', client.includes('stats は付けません'));
    check('候補探しにも上限の検査がある', client.includes('KEEPA_MAX_DISCOVERY_TOKENS'));
    check('候補探しは許可リストを通っている', client.includes('KEEPA_ALLOWED_ENDPOINTS'));

    const script = readFile('scripts/keepa-discover.ts');
    check('候補探しのコマンドは stats を渡していない', !/stats:\s*(1|true)/.test(script));
    check('候補探しのコマンドは1ページだけ', /page:\s*0/.test(script));
    check('候補探しのコマンドは親ASINを避けている', script.includes('hasParentASIN: false'));
    check('候補探しのコマンドは通信しない --dry を持つ', script.includes("has('dry')"));
    check('条件を緩めないと書いてある', script.includes('緩めません'));
    const pkg = JSON.parse(readFile('package.json'));
    check('npm run keepa:discover が登録されている',
      typeof pkg.scripts['keepa:discover'] === 'string');
  }

  // ================================================================
  console.log('\n[8. 候補探しの結果を保存する（選ばれなかったものも残す）]');
  {
    const r = await discoverOneCandidate(
      { perPage: KEEPA_DISCOVERY_PER_PAGE },
      { discover: async () => fakeDiscovery([T_ASIN, T_ASIN2, T_ASIN_PARENT]) },
    );
    check('候補が返ってくる', r.ok === true);
    check('選ぶのは先頭の1件', r.chosen === T_ASIN);
    check('候補は全部残す', r.candidates.length === 3);
    check('総件数も記録する', r.totalResults === 137);

    const rows = await all(
      `SELECT * FROM keepa_asin_candidates WHERE asin LIKE 'B0TESTP4%' ORDER BY rank_in_result`,
    );
    check('保存された候補は3件', rows.length === 3);
    check('選ばれた1件だけに印がついている',
      rows.filter((x: any) => Number(x.chosen) === 1).length === 1);
    check('選ばれなかった候補も消していない',
      rows.filter((x: any) => Number(x.chosen) === 0).length === 2);
    check('出どころは KEEPA_API', rows.every((x: any) => x.asin_source === 'KEEPA_API'));
    check('確からしさは実在確認済み',
      rows.every((x: any) => x.asin_confidence === 'VERIFIED_EXISTS'));
    check('実在を確認した時刻が入っている', rows.every((x: any) => Boolean(x.asin_verified_at)));
    check('どうやって確認したかが日本語で入っている',
      rows.every((x: any) => String(x.verification_method_ja).includes('Keepa')));
    check('どの条件で探したかを残している',
      rows.every((x: any) => String(x.selection_json).includes('perPage')));
    check('生の応答へのひも付けがある', rows.every((x: any) => x.raw_response_id !== null));

    // ---- 枠は「候補選定」として別に記録される ----
    const usage = await all(
      'SELECT * FROM keepa_token_usage WHERE id > ? ORDER BY id', [beforeUsage],
    );
    check('枠の記録が1件増えた', usage.length === 1);
    check('用途は DISCOVERY（候補選定）', usage[0]?.purpose === 'DISCOVERY');
    check('商品取得（PRODUCT_FETCH）と混ざっていない', usage[0]?.purpose !== 'PRODUCT_FETCH');
    check('使った枠は11', Number(usage[0]?.tokens_consumed) === 11);
    check('どのエンドポイントかも残っている', usage[0]?.endpoint === 'query');
    check('保存した条件にAPIキーが入っていない',
      !JSON.stringify(await all('SELECT * FROM keepa_raw_responses WHERE id > ?', [beforeRaw]))
        .includes('"key"'));

    // ---- 1件も返らなかったら、条件を緩めずに止まる ----
    const none = await discoverOneCandidate(
      { perPage: KEEPA_DISCOVERY_PER_PAGE },
      { discover: async () => fakeDiscovery([]) },
    );
    check('1件も返らなければ止まる', none.ok === false && none.chosen === null);
    check('止まった理由に「緩めずに」と書いてある',
      String(none.stoppedReasonJa).includes('緩めず'));
  }

  // ================================================================
  console.log('\n[9. 出どころは「名乗る」のではなく「記録から引く」]');
  {
    const p = await lookupAsinProvenance(T_ASIN);
    check('保存済みの候補から出どころを引ける', p !== null);
    check('引いた出どころは KEEPA_API', p?.asinSource === 'KEEPA_API');
    check('引いた確からしさは実在確認済み', p?.asinConfidence === 'VERIFIED_EXISTS');

    const missing = await lookupAsinProvenance('B0TESTP499');
    check('記録が無いASINは null（勝手に「確認済み」にしない）', missing === null);

    const oneSrc = readFile('scripts/keepa-one.ts');
    /*
     * ★2026-08-25 修正（ルール64：テストの方が事実を取り違えていた）。
     *   ここは元のソース**全文**から `--source=` を探していたが、
     *   実際に引っかかったのは「**なぜ引数で受け取らないか**」を説明したコメント本文だった
     *   （keepa-one.ts のコメントに「`--source=KEEPA_API` と書くだけで名乗れてしまう」とある）。
     *   歯止めを説明したせいで不合格になるのは逆さまなので、
     *   コメントを取り除いた**実際のコード部分だけ**を見る形へ直した。
     *   同じ取り違えは過去に2件あった（ログイン情報入りURLを弾く `u.password` の件／
     *   `lib/autopurchase.ts` に引用したユーザー指示の原文の件）。これが3件目である。
     */
    const oneCode = oneSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    check('取得コマンドは出どころを引数で受け取らない',
      !/arg\('source'\)/.test(oneCode) && !/--source=/.test(oneCode));
    check('取得コマンドは保存記録から出どころを引く',
      oneCode.includes('lookupAsinProvenance'));
    check('確信度も引数で受け取らない', !/arg\('confidence'\)/.test(oneCode));

    const storeSrc = readFile('lib/keepa/store.ts');
    check('記録から引くときも許可リストを通す',
      storeSrc.includes('isAllowedAsinSource'));
  }

  // ================================================================
  console.log('\n[10. 禁止された出どころは、通信する前に止まる]');
  {
    let called = 0;
    const r = await runOneAsin(
      T_ASIN2,
      null,
      {
        fetchProducts: async () => {
          called += 1;
          return fakeFetch([fakeProduct({ asin: T_ASIN2 })]);
        },
      },
      {
        windowDays: 90,
        provenance: {
          asin: T_ASIN2,
          asinSource: 'AI_GUESS' as never,
          asinVerifiedAt: new Date().toISOString(),
          asinConfidence: 'VERIFIED_EXISTS',
          verificationMethodJa: 'AIが推測した。',
          domainId: AMAZON_JP_DOMAIN_ID,
        },
      },
    );
    check('AIの推測ASINでは取得しない', r.ok === false);
    check('★通信そのものを行っていない（枠を1つも使わない）', called === 0);
    check('止めた理由に出どころのことが書いてある',
      String(r.stoppedReasonJa).includes('出どころ'));
    check('止めたときもURLは作らない', r.urlResolution.available === false);
  }

  // ================================================================
  console.log('\n[11. 取得した1件に、出どころとURLの判定が付いてくる]');
  {
    const r = await runOneAsin(
      T_ASIN,
      null,
      { fetchProducts: async () => fakeFetch([fakeProduct()]) },
      { windowDays: 90, provenance: goodProvenance() },
    );
    check('取得できる', r.ok === true);
    check('報告に出どころが入っている', r.provenance.asinSource === 'KEEPA_API');
    check('報告に親子の判定が入っている', r.variationRole === 'STANDALONE');
    check('報告にURLの判定が入っている', r.urlResolution.available === true);
    check('URLは公式の形', r.urlResolution.url === `${AMAZON_JP_PRODUCT_URL_PREFIX}${T_ASIN}`);

    const row = await one(`SELECT * FROM keepa_products WHERE asin = ?`, [T_ASIN]);
    check('保存した行に出どころが入っている', row?.asin_source === 'KEEPA_API');
    check('保存した行に確認時刻が入っている', Boolean(row?.asin_verified_at));
    check('保存した行に確認方法が日本語で入っている',
      String(row?.asin_verification_method_ja ?? '').length > 5);
    check('保存した行に確からしさが入っている', row?.asin_confidence === 'VERIFIED_EXISTS');
    check('保存した行に親子の判定が入っている', row?.variation_role === 'STANDALONE');
    check('保存した行にURLが入っている',
      String(row?.product_url ?? '').startsWith(AMAZON_JP_PRODUCT_URL_PREFIX));
    check('保存したURLの出どころは公式ASIN形式',
      row?.product_url_source === 'AMAZON_OFFICIAL_ASIN_PATTERN');
    check('URL_VALID は 1', Number(row?.url_valid) === 1);

    // ★ここが要点。取得しただけでは「商品が同じ」にならない。
    check('商品一致は機械が勝手に確認済みにしない',
      Number(row?.product_match_confirmed) === 0);
    check('購入導線は開かない（両方そろっていないため）',
      Number(row?.purchase_url_available) === 0);

    // 枠の用途は商品取得として記録される
    const usage = await all(
      `SELECT * FROM keepa_token_usage WHERE id > ? AND endpoint = 'product' ORDER BY id DESC LIMIT 1`,
      [beforeUsage],
    );
    check('商品取得の枠は PRODUCT_FETCH として記録される',
      usage[0]?.purpose === 'PRODUCT_FETCH');
  }

  // ================================================================
  console.log('\n[12. 親ASINを取得しても購入導線を出さない]');
  {
    await run(`DELETE FROM keepa_raw_responses WHERE asin = ?`, [T_ASIN_PARENT]);
    const r = await runOneAsin(
      T_ASIN_PARENT,
      null,
      {
        fetchProducts: async () => fakeFetch([
          fakeProduct({
            asin: T_ASIN_PARENT,
            productType: KEEPA_PRODUCT_TYPES.VARIATION_PARENT,
            variations: [{ asin: T_ASIN }, { asin: T_ASIN2 }],
          }),
        ]),
      },
      { windowDays: 90, provenance: goodProvenance({ asin: T_ASIN_PARENT }) },
    );
    check('親ASINでも取得自体はできる', r.ok === true);
    check('親ASINと判定される', r.variationRole === 'PARENT');
    check('親ASINにはURLを作らない', r.urlResolution.available === false);
    check('理由に親ASINのことが書いてある', r.urlResolution.blockersJa.join('').includes('親ASIN'));

    const row = await one(`SELECT * FROM keepa_products WHERE asin = ?`, [T_ASIN_PARENT]);
    check('保存した行にもURLが入っていない', row?.product_url === null);
    check('保存した行の URL_VALID は 0', Number(row?.url_valid) === 0);
    check('購入導線は開かない', Number(row?.purchase_url_available) === 0);
  }

  // ================================================================
  console.log('\n[13. URLを組み立ててよい場所は1つだけ]');
  {
    const BUILDER = 'lib/keepa/asinsource.ts';
    for (const f of [
      'lib/keepa/policy.ts', 'lib/keepa/normalize.ts', 'lib/keepa/store.ts',
      'lib/keepa/match.ts', 'lib/keepa/client.ts', 'lib/keepa/schema.ts',
      'lib/keepa/tokens.ts',
    ]) {
      check(`${f} はURLを組み立てていない`, !/amazon\.co\.jp\/dp/.test(readFile(f)));
    }
    const builder = readFile(BUILDER);
    check(`${BUILDER} だけが組み立てる`, builder.includes('amazon.co.jp/dp'));
    check('組み立ての前に7つの検査がある', (builder.match(/blockersJa\.push/g) ?? []).length === 7);
    check('Keepaの応答にURLは入っていないと記録してある',
      KEEPA_PRODUCT_URL_IN_RESPONSE === false);

    // ルール37：画面から読んでよいファイルは、何も import していないこと
    check(`${BUILDER} は他のファイルを読み込んでいない`, !/^\s*import\s/m.test(builder));
    check(`${BUILDER} はデータベース層を読んでいない`,
      !builder.includes('lib/db') && !builder.includes('../db'));
    check(`${BUILDER} は環境変数を読んでいない`, !builder.includes('process.env'));
  }

  // ================================================================
  console.log('\n[14. 購入・出品・決済は、やはり存在しない]');
  {
    for (const f of ['lib/keepa/asinsource.ts', 'lib/keepa/store.ts', 'scripts/keepa-discover.ts']) {
      const src = readFile(f);
      check(`${f} にカート追加が無い`, !/addToCart|add_to_cart/i.test(src));
      check(`${f} に注文の実行が無い`, !/placeOrder|createOrder|submitOrder/i.test(src));
      check(`${f} に決済が無い`, !/charge\(|payment\.|stripe/i.test(src));
    }
    const schema = readFile('lib/db/schema.ts');
    check('候補の表は「候補」であって注文ではない',
      schema.includes('keepa_asin_candidates')
      && !schema.includes('keepa_orders')
      && !schema.includes('keepa_purchases'));
  }

  // 後片づけ（テスト専用の文字列だけを消す。ルール54）
  await cleanup();
  await run('DELETE FROM keepa_token_usage WHERE id > ?', [beforeUsage]);
  await run('DELETE FROM keepa_raw_responses WHERE id > ?', [beforeRaw]);
  const left = await all(`SELECT id FROM keepa_products WHERE asin LIKE 'B0TESTP4%'`);
  check('テスト用のデータを残していない', left.length === 0);
  const leftCand = await all(`SELECT id FROM keepa_asin_candidates WHERE asin LIKE 'B0TESTP4%'`);
  check('テスト用の候補も残していない', leftCand.length === 0);

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.11（ASINの出どころ管理）の受け入れ条件をすべて満たしています。');
  console.log('※ このテストは Keepa へ一切アクセスしません（取得・検索とも差し替えて動かしています）。');
  console.log('※ AIが推測で作ったASINは、通信する前に止まります。');
  console.log('※ 商品ページURLは、実在が確認できたASINからだけ作られます。');
  console.log('※ 「URLが正しい」と「商品が同じ」は、最後まで別の値として持っています。');
}

main().catch((e) => { console.error(e); process.exit(1); });
