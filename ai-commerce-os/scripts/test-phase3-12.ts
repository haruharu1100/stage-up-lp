/**
 * Phase 3.12（二段階取得・枠の用途分け・形の監査・5件テスト）の受け入れテスト。
 *
 * ------------------------------------------------------------------
 * 【このテストは Keepa へ一切アクセスしない】
 *
 * 取得も検索も分類の一覧も、全部差し替え（`deps`）で偽物を渡す。
 * APIキーが無くても、ネットワークが無くても最後まで通る。
 * **テストが本物のAPIを叩き始めると、テストを回すたびに枠が減る。**
 *
 * ------------------------------------------------------------------
 * 【ここで潰しておきたい将来の事故】
 *
 *   1. 「売れているか」を見るだけなのに Buy Box を取り始める（1件8枠に化ける）
 *   2. Deep Scan が自動で走り出す
 *   3. 深追いの上限（2件）が設定で増やせるようになる
 *   4. 候補探しの枠と商品取得の枠が同じ数字に混ざり、1件あたりの実費が分からなくなる
 *   5. 「枠を多く使った商品ほど良い分析」という読み方が生まれる
 *   6. 5件テストの合格条件（6項目0件）がゆるむ
 *   7. 分類の番号を推測で書く（間違っていても検索は成功するので気づけない）
 *   8. 商品ごとの形の違いを見ないまま件数だけ増やす（ルール95の再発）
 *   9. 「値が無い」と「読めていない」がまた1つの「不明」に混ざる
 *  10. 5件のあと、自動で20件へ進む
 *
 * ------------------------------------------------------------------
 * ★ソース全文を正規表現で検査するときは、**先にコメントを取り除く**（ルール64）。
 *   過去に4件、「歯止めをコメントで説明したら、その説明文にテストが反応して落ちた」
 *   という同じ形の間違いが起きている。同じ轍を踏まない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { all, one, run } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import {
  addToLedger,
  buyBoxRequiredForDecision,
  deepScanGate,
  emptyTokenLedger,
  judgeFiveItemGate,
  tokenBucketOfPurpose,
  usefulDataPerToken,
  BUY_BOX_PURPOSES,
  DEEP_SCAN_MIN_CHEAP_FIELDS,
  KEEPA_AUTO_ADVANCE_STAGE,
  KEEPA_CHEAP_SCAN_FIELDS,
  KEEPA_DEEP_SCAN_AUTO_EXECUTE,
  KEEPA_DEEP_SCAN_FIELDS,
  KEEPA_DEEP_SCAN_MAX_CANDIDATES,
  KEEPA_DEEP_SCAN_TYPICAL_TOKENS,
  KEEPA_SCAN_COSTS,
  KEEPA_SCAN_STAGES,
  KEEPA_SHAPE_WATCH_GROUPS,
  KEEPA_TOKEN_BUCKETS,
  KEEPA_TOKEN_BUCKET_JA,
} from '../lib/keepa/scan';
import {
  KEEPA_ALLOWED_ENDPOINTS,
  KEEPA_CURRENT_STAGE,
  KEEPA_DISCOVERY_COSTS,
  KEEPA_DISCOVERY_PER_PAGE,
  KEEPA_DOMAIN_JP,
  KEEPA_EPOCH_MINUTES,
  KEEPA_MAX_ASINS_PER_RUN,
  KEEPA_MAX_DISCOVERY_TOKENS,
} from '../lib/keepa/policy';
import { readPath, shapeOf, UNKNOWN_REASONS } from '../lib/keepa/schema';
import {
  auditFieldShapes,
  findShapeDrift,
  lookupRootCategories,
  saveFieldShapes,
  tokenLedgerSince,
} from '../lib/keepa/store';
import type { KeepaCategoryResult } from '../lib/keepa/client';
import { judgeSellability } from '../lib/sellability';

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

/* ================================================================
 * 偽データ（実在のASINは使わない＝ルール54。後片づけは B0TESTP5 で始まるものだけ）
 * ================================================================ */

const T1 = 'B0TESTP501';
const T2 = 'B0TESTP502';
const T3 = 'B0TESTP503';
const RUN_ID = 'FIVE-TEST-P512';

function keepaMinutesAgo(minutesAgo: number): number {
  return Math.floor(Date.now() / 60000) - KEEPA_EPOCH_MINUTES - minutesAgo;
}

function fakeCurrent(): number[] {
  const a = new Array(20).fill(-1);
  a[1] = 4980;
  a[3] = 12000;
  a[11] = 8;
  a[18] = 5180;
  return a;
}

/**
 * 【偽データは実物と同じ「形」で作る】（ルール95）
 *
 * `outOfStockPercentage30/90` は**1つの数ではなく配列**である。
 * ここを数値で作ると、実物では動かないコードがテストだけ通ってしまう。
 * 実際にそれが起きて、267項目のテストを全部通ったまま取り込み漏れが残っていた。
 */
function fakeProductBook(): any {
  return {
    asin: T1,
    domainId: KEEPA_DOMAIN_JP,
    title: 'テスト用ダミー書籍 P512',
    productType: 0,
    lastUpdate: keepaMinutesAgo(30),
    trackingSince: keepaMinutesAgo(60 * 24 * 400),
    csv: new Array(36).fill(null),
    availabilityAmazon: -1,
    imagesCSV: 'aaa.jpg,bbb.jpg',
    eanList: ['4901234567890'],
    model: 'BOOK-P512',
    stats: {
      current: fakeCurrent(),
      avg30: fakeCurrent(),
      avg90: fakeCurrent(),
      salesRankDrops30: 9,
      salesRankDrops90: 24,
      totalOfferCount: 11,
      retrievedOfferCount: -2,
      buyBoxPrice: 5180,
      offerCountFBA: 3,
      offerCountFBM: 5,
      outOfStockPercentage30: [0, 0, 0, -1],
      outOfStockPercentage90: [0, 4, 4, -1],
      buyBoxIsAmazon: false,
    },
  };
}

/**
 * 家電のつもりの偽データ。**わざと形を変えてある。**
 *
 *   ・`eanList` が無い（本にはあるが家電には無い、という正常な違い）
 *   ・`stats.avg90` が無い
 *   ・`imagesCSV` が配列で来る（文字で来る商品と混在しうる）
 *
 * この違いを `findShapeDrift` が拾えなければ、5件テストをやる意味が無い。
 */
function fakeProductAppliance(): any {
  const p = fakeProductBook();
  delete p.eanList;
  delete p.stats.avg90;
  return {
    ...p,
    asin: T2,
    title: 'テスト用ダミー家電 P512',
    imagesCSV: ['ccc.jpg', 'ddd.jpg'],
    model: null,
  };
}

function fakeCategories(over: Partial<KeepaCategoryResult> = {}): KeepaCategoryResult {
  const categories = [
    { catId: '465392', name: '本', productCount: 1000 },
    { catId: '3210981', name: '家電&カメラ', productCount: 2000 },
    { catId: '637394', name: 'ゲーム', productCount: 300 },
    { catId: '160384011', name: 'ドラッグストア', productCount: 900 },
    { catId: '13299531', name: 'ホビー', productCount: 700 },
  ];
  return {
    ok: true,
    httpStatus: 200,
    raw: { categories },
    tokens: {
      tokensLeft: 1170, tokensConsumed: 1, refillRate: 20,
      refillIn: 45000, tokenFlowReduction: 0, processingTimeInMs: 90,
    },
    request: {
      endpoint: 'category', method: 'GET',
      params: { domain: String(KEEPA_DOMAIN_JP) },
      requestedAt: new Date().toISOString(),
    },
    errorJa: null,
    estimatedCost: 1,
    categories,
    ...over,
  } as KeepaCategoryResult;
}

async function cleanup(): Promise<void> {
  await run(`DELETE FROM keepa_field_shapes WHERE asin LIKE 'B0TESTP5%'`);
  await run(`DELETE FROM keepa_field_shapes WHERE run_id = ?`, [RUN_ID]);
  await run(`DELETE FROM keepa_products WHERE asin LIKE 'B0TESTP5%'`);
  await run(`DELETE FROM keepa_raw_responses WHERE asin LIKE 'B0TESTP5%'`);
  await run(`DELETE FROM keepa_asin_candidates WHERE asin LIKE 'B0TESTP5%'`);
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

  console.log('Phase 3.12 受け入れテスト（Keepaへは一切アクセスしません）');

  // ================================================================
  console.log('\n[1. 取得は2段階に分かれている]');
  {
    check('段階は2つだけ', KEEPA_SCAN_STAGES.length === 2);
    check('下見（安い方）がある', KEEPA_SCAN_STAGES.includes('CHEAP_SCAN'));
    check('深追い（高い方）がある', KEEPA_SCAN_STAGES.includes('DEEP_SCAN'));
    check('下見は1件1枠', KEEPA_SCAN_COSTS.CHEAP_SCAN_PER_ASIN === 1);
    check('深追いは出品ページ1枚6枠', KEEPA_SCAN_COSTS.DEEP_SCAN_PER_OFFER_PAGE === 6);
    check('深追いの目安は8枠', KEEPA_DEEP_SCAN_TYPICAL_TOKENS === 8);
    check('深追いは下見より高い',
      KEEPA_DEEP_SCAN_TYPICAL_TOKENS > KEEPA_SCAN_COSTS.CHEAP_SCAN_PER_ASIN);
    check('下見で取る項目は13項目', KEEPA_CHEAP_SCAN_FIELDS.length === 13);
    check('下見では取れない項目が3つ挙げてある', KEEPA_DEEP_SCAN_FIELDS.length === 3);
    check('下見の項目に Buy Box の詳細が入っていない',
      !KEEPA_CHEAP_SCAN_FIELDS.some((f) => f.key === 'buyBoxDetail'));
    check('下見の項目に出品者一覧が入っていない',
      !KEEPA_CHEAP_SCAN_FIELDS.some((f) => f.key === 'offerList'));
    for (const f of KEEPA_CHEAP_SCAN_FIELDS) {
      check(`下見の「${f.labelJa}」に使いみちが書いてある`, f.usedForJa.length > 0);
    }
  }

  // ================================================================
  console.log('\n[2. 売れているかを見るだけなら Buy Box は要らない]');
  {
    check('用途は2つだけ', BUY_BOX_PURPOSES.length === 2);
    const only = buyBoxRequiredForDecision('SELLABILITY_ONLY');
    check('売れ行きだけなら Buy Box は不要', only.required === false);
    check('不要の理由が日本語で書いてある', only.reasonJa.includes('売れているか'));
    check('材料不足にはならないと明記してある', only.reasonJa.includes('材料不足'));
    const fin = buyBoxRequiredForDecision('AMAZON_PROFIT_FINAL');
    check('最終利益計算のときだけ必要', fin.required === true);
    check('必要なときは枠の目安を示す', fin.reasonJa.includes(String(KEEPA_DEEP_SCAN_TYPICAL_TOKENS)));
  }

  // ================================================================
  console.log('\n[3. 深追いしてよい商品を選ぶ関門]');
  {
    const good = deepScanGate({
      dataFresh: true, sellabilityVerdict: 'SELLS_WELL',
      cheapFieldsPresent: 12, parserErrorCount: 0,
    });
    check('4条件そろえば候補になる', good.candidate === true);
    check('検査は4項目', good.checksJa.length === 4);
    check('候補でも「取得しない」と書いてある', good.reasonJa.includes('追加の枠は使いません'));

    check('売れていない商品は深追いしない',
      deepScanGate({ dataFresh: true, sellabilityVerdict: 'DOES_NOT_SELL', cheapFieldsPresent: 12, parserErrorCount: 0 }).candidate === false);
    check('データが古ければ深追いしない',
      deepScanGate({ dataFresh: false, sellabilityVerdict: 'SELLS_WELL', cheapFieldsPresent: 12, parserErrorCount: 0 }).candidate === false);
    check('鮮度が分からないものを候補にしない',
      deepScanGate({ dataFresh: null, sellabilityVerdict: 'SELLS_WELL', cheapFieldsPresent: 12, parserErrorCount: 0 }).candidate === false);
    check('材料が足りなければ深追いしない',
      deepScanGate({ dataFresh: true, sellabilityVerdict: 'SELLS_WELL', cheapFieldsPresent: DEEP_SCAN_MIN_CHEAP_FIELDS - 1, parserErrorCount: 0 }).candidate === false);
    check('読み取り不具合が残っていれば深追いしない',
      deepScanGate({ dataFresh: true, sellabilityVerdict: 'SELLS_WELL', cheapFieldsPresent: 12, parserErrorCount: 1 }).candidate === false);
    check('不具合の件数を数えていないものも候補にしない',
      deepScanGate({ dataFresh: true, sellabilityVerdict: 'SELLS_WELL', cheapFieldsPresent: 12, parserErrorCount: null }).candidate === false);
    check('売れるか判定が出ていないものも候補にしない',
      deepScanGate({ dataFresh: true, sellabilityVerdict: null, cheapFieldsPresent: 12, parserErrorCount: 0 }).candidate === false);
    check('材料の線は9項目', DEEP_SCAN_MIN_CHEAP_FIELDS === 9);
  }

  // ================================================================
  console.log('\n[4. 深追いは自動で始まらない・件数はコードで縛る]');
  {
    check('自動実行しない', KEEPA_DEEP_SCAN_AUTO_EXECUTE === false);
    check('深追いの上限は2件', KEEPA_DEEP_SCAN_MAX_CANDIDATES === 2);
    const scan = codeOnly(readFile('lib/keepa/scan.ts'));
    check('scan.ts に process.env が無い', !scan.includes('process.env'));
    check('scan.ts は何も import していない（画面へ持ち込める）',
      !/^\s*import\s/m.test(scan));
    check('深追いを実行する関数が scan.ts に無い',
      !/executeDeepScan|runDeepScan|fetchOffers/.test(scan));
  }

  // ================================================================
  console.log('\n[5. 枠は用途ごとに分けて数える]');
  {
    check('入れ物は3つ', KEEPA_TOKEN_BUCKETS.length === 3);
    for (const b of KEEPA_TOKEN_BUCKETS) {
      check(`${b} に日本語の説明がある`, KEEPA_TOKEN_BUCKET_JA[b].length > 0);
    }
    check('候補探しは DISCOVERY_TOKENS', tokenBucketOfPurpose('DISCOVERY') === 'DISCOVERY_TOKENS');
    check('分類の一覧も候補探しの費用に入れる',
      tokenBucketOfPurpose('CATEGORY_LOOKUP') === 'DISCOVERY_TOKENS');
    check('商品取得は BASE_SCAN_TOKENS', tokenBucketOfPurpose('PRODUCT_FETCH') === 'BASE_SCAN_TOKENS');
    check('深追いは DEEP_SCAN_TOKENS', tokenBucketOfPurpose('DEEP_SCAN') === 'DEEP_SCAN_TOKENS');
    check('知らない用途は入れ物に入れない', tokenBucketOfPurpose('SOMETHING_ELSE') === null);

    const empty = emptyTokenLedger();
    check('最初は全部0', Object.values(empty).every((v) => v === 0));

    let l = emptyTokenLedger();
    l = addToLedger(l, 'DISCOVERY', 11);
    l = addToLedger(l, 'CATEGORY_LOOKUP', 1);
    l = addToLedger(l, 'PRODUCT_FETCH', 5);
    check('候補探しは12にまとまる', l.DISCOVERY_TOKENS === 12);
    check('商品取得は5', l.BASE_SCAN_TOKENS === 5);
    check('深追いは0のまま', l.DEEP_SCAN_TOKENS === 0);
    check('合計は17', l.TOTAL_TOKENS === 17);

    const l2 = addToLedger(l, 'SOMETHING_ELSE', 3);
    check('入れ物が分からない枠も合計には足す', l2.TOTAL_TOKENS === 20);
    check('入れ物が分からない枠を勝手にどれかへ入れない',
      l2.DISCOVERY_TOKENS === 12 && l2.BASE_SCAN_TOKENS === 5 && l2.DEEP_SCAN_TOKENS === 0);
  }

  // ================================================================
  console.log('\n[6. 「枠あたりの材料数」は商品の点数ではない]');
  {
    const u = usefulDataPerToken(12, 1);
    check('12項目÷1枠で12', u.ratio === 12);
    check('枠が0なら計算しない（0で割らない）', usefulDataPerToken(12, 0).ratio === null);
    check('点数ではないと明記してある', u.noteJa.includes('点数ではありません'));
    check('多く使うほど良い、ではないと書いてある', u.noteJa.includes('良い、という読み方をしないで'));
    const scan = codeOnly(readFile('lib/keepa/scan.ts'));
    check('この値を判定に使う関数が無い', !/scoreByTokens|rankByTokens/.test(scan));
  }

  // ================================================================
  console.log('\n[7. 5件テストの合格条件は6項目すべて0]');
  {
    const clean = {
      apiErrors: 0, parserSchemaErrors: 0, wrongMarketplace: 0,
      tokenEstimateMismatch: 0, secretLeak: 0, falseAsin: 0,
    };
    const ok = judgeFiveItemGate(clean);
    check('全部0なら合格', ok.passed === true);
    check('検査は6項目', ok.rows.length === 6);
    check('合格でも「自動では進まない」と書いてある', ok.verdictJa.includes('自動では進みません'));

    for (const k of Object.keys(clean)) {
      const bad = judgeFiveItemGate({ ...clean, [k]: 1 } as any);
      check(`${k} が1件でもあれば不合格`, bad.passed === false);
      check(`${k} のときは20件へ進まないと書く`, bad.verdictJa.includes('20件へは進みません'));
    }
  }

  // ================================================================
  console.log('\n[8. 分類の番号は推測しない（公式の一覧をもらう）]');
  {
    const r = await lookupRootCategories({ fetchCategories: async () => fakeCategories() });
    check('分類の一覧が返る', r.ok === true);
    check('名前つきで返る', r.categories.every((c) => c.name.length > 0));
    check('1枠で済む', r.estimatedCost === 1);

    const empty = await lookupRootCategories({
      fetchCategories: async () => fakeCategories({ categories: [], ok: true } as any),
    });
    check('1件も返らなければ止まる', empty.ok === false);
    check('推測して進まないと書いてある',
      String(empty.stoppedReasonJa).includes('推測'));

    const failed = await lookupRootCategories({
      fetchCategories: async () => fakeCategories({ ok: false, errorJa: '通信できません。' } as any),
    });
    check('失敗しても止まるだけで、番号を作らない', failed.ok === false && failed.categories.length === 0);

    const five = codeOnly(readFile('scripts/keepa-five.ts'));
    check('5件テストは分類の一覧を呼ぶ', five.includes('lookupRootCategories'));
    check('5件テストに分類番号のべた書きが無い',
      !/catId:\s*['"]?\d{4,}/.test(five));
    check('見つからないジャンルは飛ばす（推測しない）',
      five.includes('missing'));
  }

  // ================================================================
  console.log('\n[9. 商品ごとに「形」を記録する]');
  {
    check('見張るのは10グループ', KEEPA_SHAPE_WATCH_GROUPS.length === 10);
    const groups = KEEPA_SHAPE_WATCH_GROUPS.map((g) => g.group);
    for (const g of ['price', 'csv', 'stats', 'offers', 'availability',
      'outOfStock', 'fees', 'salesRanks', 'images', 'identifiers']) {
      check(`${g} を見張っている`, groups.includes(g));
    }
    for (const g of KEEPA_SHAPE_WATCH_GROUPS) {
      check(`${g.labelJa} に見る理由が書いてある`, g.whyJa.length > 0);
      check(`${g.labelJa} に見る場所が指定してある`, g.paths.length > 0);
    }

    const a1 = auditFieldShapes(T1, fakeProductBook());
    const a2 = auditFieldShapes(T2, fakeProductAppliance());
    const pathCount = KEEPA_SHAPE_WATCH_GROUPS.reduce((s, g) => s + g.paths.length, 0);
    check('見る場所を全部記録している', a1.rows.length === pathCount);

    const oos = a1.rows.find((r) => r.path === 'stats.outOfStockPercentage30');
    check('在庫切れ割合は配列として記録される（ルール95）', oos?.shape === 'array');
    check('配列の長さも残す', oos?.arrayLength === 4);

    const ean1 = a1.rows.find((r) => r.path === 'eanList');
    const ean2 = a2.rows.find((r) => r.path === 'eanList');
    check('本にはJANがある', ean1?.present === true);
    check('家電にはJANが無い', ean2?.present === false);
    check('無い項目には理由が付く', ean2?.unknownReason !== null);
    check('理由は2種類のどちらか',
      ean2 !== undefined && UNKNOWN_REASONS.includes(ean2.unknownReason as any));

    const drift = findShapeDrift([a1, a2]);
    check('食い違いの一覧が場所の数だけ出る', drift.length === pathCount);
    check('JANの有無が食い違いとして出る',
      drift.find((d) => d.path === 'eanList')?.drift === true);
    check('画像の形の違いも出る（文字と配列）',
      drift.find((d) => d.path === 'imagesCSV')?.drift === true);
    check('同じ形の場所は食い違いにしない',
      drift.find((d) => d.path === 'stats.current')?.drift === false);
    check('商品ごとの形が並ぶ',
      drift.every((d) => d.byAsin.length === 2));

    const saved = await saveFieldShapes(RUN_ID, a1, null);
    await saveFieldShapes(RUN_ID, a2, null);
    check('形を保存できる', saved === pathCount);
    const rows = await all(`SELECT * FROM keepa_field_shapes WHERE run_id = ?`, [RUN_ID]);
    check('2件ぶん保存されている', rows.length === pathCount * 2);
    check('日本のAmazonとして保存されている',
      rows.every((r) => Number(r.domain_id) === KEEPA_DOMAIN_JP));

    // 同じものをもう一度書いても増えない（上書きもしない）
    await saveFieldShapes(RUN_ID, a1, null);
    const rows2 = await all(`SELECT * FROM keepa_field_shapes WHERE run_id = ?`, [RUN_ID]);
    check('二重に書いても増えない', rows2.length === rows.length);
  }

  // ================================================================
  console.log('\n[10. 「値が無い」と「読めていない」を混ぜない]');
  {
    check('理由は2種類だけ', UNKNOWN_REASONS.length === 2);
    check('市場に値が無い', UNKNOWN_REASONS.includes('DATA_NOT_AVAILABLE'));
    check('当社が読めていない', UNKNOWN_REASONS.includes('PARSER_OR_SCHEMA_ERROR'));

    const raw = fakeProductBook();
    check('配列は配列と分かる', shapeOf(raw.stats.outOfStockPercentage30) === 'array');
    check('無い項目は missing', readPath(raw, 'stats.nothingHere').shape === 'missing');
    check('どこで辿れなくなったかが分かる',
      readPath(raw, 'stats.nothingHere').brokeAt !== null);
    check('0 は「値なし」ではない', shapeOf(0) === 'number');

    const store = codeOnly(readFile('lib/keepa/store.ts'));
    check('形の監査は理由を分けて持つ', store.includes('unknownReason'));
    check('形の監査で classifyUnknown を使う', store.includes('classifyUnknown'));
    const five = codeOnly(readFile('scripts/keepa-five.ts'));
    check('報告でも理由の内訳を出す', five.includes('DATA_NOT_AVAILABLE'));
  }

  // ================================================================
  console.log('\n[11. 5件テストのコマンドが、決めたとおりに作られている]');
  {
    const pkg = JSON.parse(readFile('package.json'));
    check('npm run keepa:five が登録されている', typeof pkg.scripts['keepa:five'] === 'string');
    check('npm run test:phase3-12 が登録されている', typeof pkg.scripts['test:phase3-12'] === 'string');

    const five = codeOnly(readFile('scripts/keepa-five.ts'));
    check('通信しない下見（--dry）がある', five.includes("has('dry')"));
    check('候補探しは1回だけ', (five.match(/discoverOneCandidate\(/g) ?? []).length === 1);
    check('候補探しに stats を付けていない', !/stats:\s*(1|true)/.test(five));
    check('1ページだけ', /page:\s*0/.test(five));
    check('親ASINを避けている', five.includes('hasParentASIN: false'));
    check('出品（offers）を頼んでいない', !/offers:\s*(1|true|\d)/.test(five));
    check('Buy Box を頼んでいない', !/buyBox:\s*(1|true)/.test(five));
    check('在庫数を頼んでいない', !/stock:\s*(1|true)/.test(five));
    check('出どころは保存記録から引く', five.includes('lookupAsinProvenance'));
    check('出どころを引数で受け取らない', !/--source=/.test(five) && !/arg\('source'\)/.test(five));
    /*
     * ★ここは「5件の選び方」だけを見る。
     *   最初はソース全文から /score|rank/ を探していたが、
     *   報告の側にある `salesRank`（売れ筋順位の表示）に反応して落ちた。
     *   落ちた原因は歯止めの不在ではなく、検査範囲が広すぎたことである（ルール64）。
     *   そこで**選ぶ関数の中身だけ**を切り出して見る形へ直した。
     */
    const pickBody = (five.match(/function pickFiveByStride[\s\S]*?\n}/) ?? [''])[0];
    check('5件を選ぶ関数がある', pickBody.length > 0);
    check('選び方は等間隔（点数付けをしていない）',
      pickBody.includes('stride') && !/score|sort\(/i.test(pickBody));
    check('候補に点数を付ける関数が無い', !/scoreCandidate|rankCandidate|pickBest/i.test(five));
    check('用途別の集計を出す', five.includes('tokenLedgerSince'));
    check('合格条件を判定する', five.includes('judgeFiveItemGate'));
    check('深追いの候補を挙げる', five.includes('deepScanGate'));
    check('深追いを実行しない', !/executeDeepScan|runDeepScan/.test(five));
    check('自動で次の段階へ進まないと示す', five.includes('KEEPA_AUTO_ADVANCE_STAGE'));
    check('形の監査を保存する', five.includes('saveFieldShapes'));
  }

  // ================================================================
  console.log('\n[12. いまの段階と、超えられない上限]');
  {
    check('いまは段階S2', KEEPA_CURRENT_STAGE === 'S2');
    check('1回に取れるのは5件まで', KEEPA_MAX_ASINS_PER_RUN === 5);
    check('候補探しの上限は15枠', KEEPA_MAX_DISCOVERY_TOKENS === 15);
    const est = KEEPA_DISCOVERY_COSTS.QUERY_BASE
      + Math.max(1, Math.ceil(KEEPA_DISCOVERY_PER_PAGE / 100)) * KEEPA_DISCOVERY_COSTS.QUERY_PER_100_ASINS;
    check('候補探し1回は11枠', est === 11);
    check('分類1枠＋候補探し11枠は上限内', est + 1 <= KEEPA_MAX_DISCOVERY_TOKENS);
    check('自動で次の段階へ進まない', KEEPA_AUTO_ADVANCE_STAGE === false);

    check('呼ぶエンドポイントは4つだけ', KEEPA_ALLOWED_ENDPOINTS.length === 4);
    for (const e of ['product', 'token', 'query', 'category']) {
      check(`${e} は許可されている`, (KEEPA_ALLOWED_ENDPOINTS as readonly string[]).includes(e));
    }
    const policy = codeOnly(readFile('lib/keepa/policy.ts'));
    check('policy.ts に process.env が無い（設定で増やせない）', !policy.includes('process.env'));
  }

  // ================================================================
  console.log('\n[13. 推定販売数という呼び方をやめている]');
  {
    const s = judgeSellability({
      salesRank: 5000,
      rankDrops30: 12,
      offerCountNew: 4,
      observedAt: new Date().toISOString(),
    } as any);
    check('推定需要シグナルという名前で持つ', 'estimatedDemandSignal' in s);
    check('推定自己販売機会という名前で持つ', 'estimatedEqualShareOpportunity' in s);
    check('回転日数も暫定モデルの出力として持つ', 'estimatedEqualShareTurnoverDays' in s);
    const src = readFile('lib/sellability.ts');
    check('Rank Drops ≠ 実販売数 と書いてある',
      src.includes('Rank Drops') && src.includes('実販売数') || src.includes('Actual Sales'));
    const five = codeOnly(readFile('scripts/keepa-five.ts'));
    check('報告でも「実販売数ではない」と断る', five.includes('実販売数ではありません'));
    check('報告で下落回数の但し書きを出す', five.includes('販売数そのものではありません'));
  }

  // ================================================================
  console.log('\n[14. 用途別の集計が、実際のデータでも動く]');
  {
    const since = new Date(Date.now() - 60_000).toISOString();
    const led = await tokenLedgerSince(since);
    check('集計が返る', typeof led.ledger.TOTAL_TOKENS === 'number');
    check('振り分けられなかった枠を別に数える', typeof led.unclassified === 'number');
    check('合計は用途の足し算ではなく実消費から出す',
      led.ledger.TOTAL_TOKENS >= led.ledger.DISCOVERY_TOKENS + led.ledger.BASE_SCAN_TOKENS + led.ledger.DEEP_SCAN_TOKENS);
  }

  // ================================================================
  console.log('\n[15. 購入・出品・決済は、やはり存在しない]');
  {
    for (const f of ['lib/keepa/scan.ts', 'lib/keepa/store.ts', 'scripts/keepa-five.ts']) {
      const src = codeOnly(readFile(f));
      check(`${f} にカート追加が無い`, !/addToCart|add_to_cart/i.test(src));
      check(`${f} に注文の実行が無い`, !/placeOrder|createOrder|submitOrder/i.test(src));
      check(`${f} に決済が無い`, !/charge\(|payment\.|stripe/i.test(src));
    }
    const schema = readFile('lib/db/schema.ts');
    check('形の表は「形」であって注文ではない',
      schema.includes('keepa_field_shapes')
      && !schema.includes('keepa_orders')
      && !schema.includes('keepa_purchases'));
  }

  // 後片づけ（テスト専用の文字列だけを消す。ルール54）
  await cleanup();
  await run('DELETE FROM keepa_token_usage WHERE id > ?', [beforeUsage]);
  await run('DELETE FROM keepa_raw_responses WHERE id > ?', [beforeRaw]);
  const left = await all(`SELECT id FROM keepa_field_shapes WHERE asin LIKE 'B0TESTP5%'`);
  check('テスト用のデータを残していない', left.length === 0);

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.12（二段階取得・枠の用途分け・形の監査）の受け入れ条件をすべて満たしています。');
  console.log('※ このテストは Keepa へ一切アクセスしません（取得・検索・分類とも差し替えて動かしています）。');
  console.log('※ 深追い（Buy Box・出品者一覧）は、候補を挙げるだけで実行しません。');
  console.log('※ 5件のあと、20件へ自動では進みません。');
}

main().catch((e) => { console.error(e); process.exit(1); });
