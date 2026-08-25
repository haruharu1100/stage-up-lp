/**
 * Phase 3.14（20件実測・需要指標がどのくらい使えるかを数える）の受け入れテスト。
 *
 * ------------------------------------------------------------------
 * 【このテストは Keepa へ一切アクセスしない】
 * 使うのは手で作った偽の行だけ。APIキーが無くても最後まで通る。
 *
 * ------------------------------------------------------------------
 * 【ここで潰しておきたい将来の事故】
 *
 *   1. 「値が無い」が 0 で埋められ、売れていない商品と見分けがつかなくなる
 *   2. 「比べられない」が「食い違いが無い（＝安心）」に足し込まれる
 *   3. 分母0のときに「0%」と表示され、測っていないのに測った顔をする
 *   4. 順位下落回数の「0回」が欠測に数えられる（中身のある観測結果なのに）
 *   5. 「◯個以上の区分」が「月◯個売れている」という実数として書かれる
 *   6. 4段階の食い違いが、いつのまにか仕入判定へ流れ込む
 *   7. 候補指標TOP3が「採用」に化ける
 *   8. 20件のGateが1つでも0でないのに、100件へ進めてしまう
 *   9. 仕組みが自分で100件へ進む
 *  10. 候補探しが上限（15枠）を超える条件で投げられる
 *  11. 20件の取得スクリプトが、保存済みのASINを取り直して枠を溶かす
 *  12. 集計ファイルが依存を抱えて画面へバンドルできなくなる（ルール37）
 *
 * ------------------------------------------------------------------
 * ★ソース全文を正規表現で検査するときは、**先にコメントを取り除く**（ルール64）。
 *   過去に5件、「歯止めをコメントで説明したら、その説明文にテストが反応して落ちた」
 *   という同じ形の間違いが起きている。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  amazonRetailCrossTab,
  bucketCoverage,
  categoryStats,
  conflictBreakdown,
  formatBucketJa,
  freshnessBuckets,
  indicatorCandidates,
  judgeTwentyItemGate,
  outOfStockCrossTab,
  pct,
  rankDropsCoverage,
  sellabilityBreakdown,
  BUCKET_LOWER_BOUND_NOTE_JA,
  CATEGORY_SAMPLE_WARNING_JA,
  CATEGORY_UNKNOWN_JA,
  INDICATOR_CANDIDATE_DISCLAIMER_JA,
  KEEPA_AUTO_ADVANCE_TO_HUNDRED,
  type CoverageRow,
} from '../lib/keepa/coverage';
import {
  judgeDemandConflictLevel,
  buildDemandEvidence,
  DEMAND_CONFLICT_LEVELS,
  DEMAND_CONFLICT_LEVEL_JA,
  DEMAND_CONFLICT_LEVEL_USED_IN_BUY_DECISION,
  DEMAND_CONFLICT_MILD_THRESHOLD,
  DEMAND_CONFLICT_RATIO_THRESHOLD,
} from '../lib/keepa/demand';
import {
  KEEPA_CURRENT_STAGE,
  KEEPA_DISCOVERY_PER_PAGE_WIDE,
  KEEPA_MAX_ASINS_PER_RUN,
  KEEPA_MAX_DISCOVERY_TOKENS,
  KEEPA_STAGES,
} from '../lib/keepa/policy';
import { normalizeKeepaProduct } from '../lib/keepa/normalize';
import { KEEPA_SHAPE_WATCH_GROUPS } from '../lib/keepa/scan';

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
 * 偽の行（実在の型番・実在ASINは使わない＝ルール54）
 * ================================================================ */

function row(over: Partial<CoverageRow> = {}): CoverageRow {
  return {
    asin: 'B0TESTP701',
    titleJa: 'テスト用の商品（実在しません）',
    categoryJa: '本',
    rankDrops30: 10,
    rankDrops90: 30,
    rankDrops180: 60,
    rankDrops365: 120,
    keepaMonthlySoldAtLeast: null,
    sellerCount: 5,
    estimatedEqualShareOpportunity: 1.7,
    amazonRetailPresent: 'NO',
    outOfStock30: 0,
    outOfStock90: 0,
    dataAgeDays: 1,
    conflictLevel: 'NOT_COMPARABLE',
    sellability: 'SELLS',
    parserErrorCount: 0,
    tokensUsed: 1,
    // ★2026-08-25（Phase 3.15）で CoverageRow へ足した項目。
    //   ここを足さないと型が合わないので、テストも一緒に直す必要がある。
    currentPriceYen: 2500,
    fbaFeeYen: 400,
    referralFeePercent: 10,
    imageCount: 5,
    divergenceLevel: 'NOT_COMPARABLE',
    ...over,
  };
}

function main(): void {
  console.log('='.repeat(72));
  console.log('Phase 3.14 受け入れテスト（20件実測・需要指標の使えるかを数える）');
  console.log('='.repeat(72));

  // ================================================================
  console.log('\n[1. 割合の出し方：分母0を0%にしない]');
  {
    check('10件中3件は 30%', pct(3, 10) === 30);
    check('小数1桁まで出す（7件中2件＝28.6%）', pct(2, 7) === 28.6);
    check('★分母0は null（0%にしない）', pct(0, 0) === null);
    check('★分母がマイナスでも null', pct(1, -3) === null);
    check('全件そろえば100%', pct(7, 7) === 100);
  }

  // ================================================================
  console.log('\n[2. Keepaの区分値が入っている割合（MONTHLY_BOUGHT_BUCKET_COVERAGE）]');
  {
    const rows = [
      row({ keepaMonthlySoldAtLeast: 200 }),
      row({ keepaMonthlySoldAtLeast: 5000 }),
      row(), row(), row(),
    ];
    const c = bucketCoverage(rows);
    check('キー名が MONTHLY_BOUGHT_BUCKET_COVERAGE', c.key === 'MONTHLY_BOUGHT_BUCKET_COVERAGE');
    check('5件中2件で 40%', c.present === 2 && c.total === 5 && c.percent === 40);
    check('0件でも例外にならず null を返す', bucketCoverage([]).percent === null);
    check('★空の商品を低評価にしない、と注意書きがある', c.noteJa.includes('低評価にしない'));
    check('★公式の「大半の商品では空」を引いている', c.noteJa.includes('Most ASINs do not have this value set'));
    check('★区分値が0の商品も「値あり」に数える',
      bucketCoverage([row({ keepaMonthlySoldAtLeast: 0 })]).present === 1);
  }

  // ================================================================
  console.log('\n[3. 順位下落回数が入っている割合（RANK_DROPS_COVERAGE）]');
  {
    const rows = [row({ rankDrops30: 0 }), row({ rankDrops30: 12 }), row({ rankDrops30: null })];
    const c = rankDropsCoverage(rows);
    check('キー名が RANK_DROPS_COVERAGE', c.key === 'RANK_DROPS_COVERAGE');
    check('★「0回」は取得できたに数える（3件中2件＝66.7%）',
      c.present === 2 && c.percent === 66.7);
    check('★0回は欠測ではない、と注意書きがある', c.noteJa.includes('0回は「取得できた」'));
    check('★下落回数は販売数ではない、と明記している（ルール78）',
      c.noteJa.includes('販売数ではありません'));
  }

  // ================================================================
  console.log('\n[4. 食い違いの4段階]');
  {
    check('4段階が定義されている', DEMAND_CONFLICT_LEVELS.length === 4);
    for (const k of ['NO_CONFLICT', 'MILD_CONFLICT', 'STRONG_CONFLICT', 'NOT_COMPARABLE']) {
      check(`${k} がある`, (DEMAND_CONFLICT_LEVELS as readonly string[]).includes(k));
      check(`${k} に日本語の説明がある`,
        typeof DEMAND_CONFLICT_LEVEL_JA[k as keyof typeof DEMAND_CONFLICT_LEVEL_JA] === 'string');
    }
    check('軽い食い違いの線は2倍', DEMAND_CONFLICT_MILD_THRESHOLD === 2);
    check('強い食い違いの線は3倍（従来と同じ）', DEMAND_CONFLICT_RATIO_THRESHOLD === 3);
    check('★この4段階は仕入判定に使っていない', DEMAND_CONFLICT_LEVEL_USED_IN_BUY_DECISION === false);

    check('1.5倍差は「食い違い無し」',
      judgeDemandConflictLevel(100, 150).level === 'NO_CONFLICT');
    check('2倍ちょうどは「軽い食い違い」',
      judgeDemandConflictLevel(100, 200).level === 'MILD_CONFLICT');
    check('3倍ちょうどは「強い食い違い」',
      judgeDemandConflictLevel(100, 300).level === 'STRONG_CONFLICT');
    check('★上下どちらへずれても同じ扱い（1/3倍も強い食い違い）',
      judgeDemandConflictLevel(300, 100).level === 'STRONG_CONFLICT');
    check('★片方が無ければ「比べられない」',
      judgeDemandConflictLevel(100, null).level === 'NOT_COMPARABLE');
    check('★「比べられない」は「食い違いが無い」ではない、と書いてある',
      judgeDemandConflictLevel(100, null).reasonJa.includes('食い違いが無い」という意味ではありません'));
    check('比べられないときの倍率は null', judgeDemandConflictLevel(null, null).ratio === null);
  }

  // ================================================================
  console.log('\n[5. 4段階の内訳を数える]');
  {
    const rows = [
      row({ conflictLevel: 'NO_CONFLICT' }),
      row({ conflictLevel: 'MILD_CONFLICT' }),
      row({ conflictLevel: 'STRONG_CONFLICT' }),
      row({ conflictLevel: 'NOT_COMPARABLE' }),
      row({ conflictLevel: 'NOT_COMPARABLE' }),
    ];
    const b = conflictBreakdown(rows);
    check('4段階とも数えている',
      b.noConflict === 1 && b.mildConflict === 1 && b.strongConflict === 1 && b.notComparable === 2);
    check('合計は5件', b.total === 5);
    check('★比べられた3件を分母に、強い食い違いは33.3%',
      b.strongPercentAmongComparable === 33.3);
    check('★比べられた商品が0件なら null（0%にしない）',
      conflictBreakdown([row({ conflictLevel: 'NOT_COMPARABLE' })]).strongPercentAmongComparable === null);
    check('★「比べられない」を足すな、と注意書きがある',
      b.noteJa.includes('「食い違いが無い」に足さないでください'));
    check('★どちらが正解かを決めていない、と書いてある',
      b.noteJa.includes('どちらの数字が正しいかはここでは決めていません'));
  }

  // ================================================================
  console.log('\n[6. 売り場（カテゴリ）ごとの集計]');
  {
    const rows = [
      row({ categoryJa: '本', keepaMonthlySoldAtLeast: null, sellerCount: 10 }),
      row({ categoryJa: '本', keepaMonthlySoldAtLeast: 100, sellerCount: 20 }),
      row({ categoryJa: '本', keepaMonthlySoldAtLeast: null, sellerCount: 30 }),
      row({ categoryJa: 'おもちゃ', keepaMonthlySoldAtLeast: 50, amazonRetailPresent: 'YES' }),
      row({ categoryJa: null }),
    ];
    const s = categoryStats(rows);
    check('件数の多い順に並ぶ（本が先頭）', s[0].categoryJa === '本' && s[0].count === 3);
    check('本の区分値ありは3件中1件＝33.3%', s[0].bucketPresent === 1 && s[0].bucketPercent === 33.3);
    check('本の順位下落回数は3件中3件＝100%', s[0].rankDropsPercent === 100);
    check('出品者数の中央値が出る（10/20/30 → 20）', s[0].medianSellerCount === 20);
    const toy = s.find((x) => x.categoryJa === 'おもちゃ');
    check('おもちゃのAmazon本体ありが1件', toy?.amazonRetailYes === 1);
    const unknown = s.find((x) => x.categoryJa === CATEGORY_UNKNOWN_JA);
    check('★売り場が取れない商品は「その他」に混ぜず別立てにする', unknown?.count === 1);
    check('★結論を出すなという警告文がある', CATEGORY_SAMPLE_WARNING_JA.includes('結論を出さないでください'));
    check('★件数が足りないと明言している', CATEGORY_SAMPLE_WARNING_JA.includes('件数がまったく足りません'));
    check('出品者数が全部 null なら中央値も null',
      categoryStats([row({ categoryJa: 'X', sellerCount: null })])[0].medianSellerCount === null);
  }

  // ================================================================
  console.log('\n[7. データの新しさの分布（線は動かさない）]');
  {
    const f = freshnessBuckets([
      row({ dataAgeDays: 0 }), row({ dataAgeDays: 7 }),
      row({ dataAgeDays: 8 }), row({ dataAgeDays: 30 }),
      row({ dataAgeDays: 31 }), row({ dataAgeDays: null }),
    ]);
    check('0〜7日が2件', f.within7 === 2);
    check('8〜30日が2件', f.within30 === 2);
    check('31日以上が1件', f.over30 === 1);
    check('★取れなかった1件は「不明」で別に置く（新しい側に混ぜない）', f.unknown === 1);
    check('合計6件', f.total === 6);
    check('★既存の30日の線は変更していない、と書いてある', f.noteJa.includes('変更していません'));
  }

  // ================================================================
  console.log('\n[8. Amazon本体・在庫切れとの関係（観察のみ）]');
  {
    const a = amazonRetailCrossTab([
      row({ amazonRetailPresent: 'YES', keepaMonthlySoldAtLeast: 100 }),
      row({ amazonRetailPresent: 'YES' }),
      row({ amazonRetailPresent: 'NO' }),
      row({ amazonRetailPresent: 'UNKNOWN' }),
    ]);
    check('Amazon本体あり／なし／不明の3つに分ける', a.groups.length === 3);
    check('Amazon本体ありは2件中1件＝50%', a.groups[0].count === 2 && a.groups[0].bucketPercent === 50);
    check('★判定を補正していない、と書いてある', a.noteJa.includes('補正していません'));

    const o = outOfStockCrossTab([
      row({ outOfStock30: 0 }), row({ outOfStock30: 15 }),
      row({ outOfStock30: 55 }), row({ outOfStock30: null }),
    ]);
    check('在庫切れは4区分（0% / 1〜30% / 31%以上 / 不明）', o.groups.length === 4);
    check('★0% と 不明 を別に置いている',
      o.groups[0].count === 1 && o.groups[3].count === 1);
    check('1〜30%が1件・31%以上が1件', o.groups[1].count === 1 && o.groups[2].count === 1);
    check('★不明が多いときは自社の読み取りを疑え、と書いてある',
      o.noteJa.includes('当社の読み取りを疑ってください'));
  }

  // ================================================================
  console.log('\n[9. 仕入判定の内訳（4種のまま）]');
  {
    const b = sellabilityBreakdown([
      row({ sellability: 'SELLS' }), row({ sellability: 'CROWDED' }),
      row({ sellability: 'DOES_NOT_SELL' }), row({ sellability: 'UNKNOWN' }),
    ]);
    check('SELLS / CROWDED / DOES_NOT_SELL / UNKNOWN を数える',
      b.sells === 1 && b.crowded === 1 && b.doesNotSell === 1 && b.unknown === 1);
    check('★判定を1文字も変えていない、と書いてある', b.noteJa.includes('1文字も変えていません'));
    check('★区分値も食い違いも判定に入っていない、と書いてある',
      b.noteJa.includes('この判定へは1つも入っていません'));
  }

  // ================================================================
  console.log('\n[10. 需要指標の候補TOP3（採用ではない）]');
  {
    const rows = [
      row({ rankDrops30: 3, sellerCount: 4, outOfStock30: 0, keepaMonthlySoldAtLeast: 100 }),
      row({ rankDrops30: 5, sellerCount: null, outOfStock30: null, keepaMonthlySoldAtLeast: null }),
      row({ rankDrops30: 8, sellerCount: 9, outOfStock30: 2, keepaMonthlySoldAtLeast: null }),
    ];
    const c = indicatorCandidates(rows);
    check('★3件だけ出す', c.length === 3);
    check('順位は1・2・3', c[0].rank === 1 && c[1].rank === 2 && c[2].rank === 3);
    check('★どれも「採用していない」', c.every((x) => x.adopted === false));
    check('★埋まっている順に並ぶ（1位は全件そろう順位下落回数）',
      c[0].nameJa.includes('順位下落回数'));
    check('★埋まらない区分値はTOP3から落ちる',
      !c.some((x) => x.nameJa.includes('月間購入回数')));
    check('理由に「出どころ」が書いてある', c.every((x) => x.nameJa.includes('出どころ＝Keepa')));
    check('★採用ではないという但し書きがある',
      INDICATOR_CANDIDATE_DISCLAIMER_JA.includes('「採用」ではありません'));
    check('★どれを使うかは人が決める、と書いてある',
      INDICATOR_CANDIDATE_DISCLAIMER_JA.includes('人が決めます'));
  }

  // ================================================================
  console.log('\n[11. 100件へ進む条件（5つ全部が0）]');
  {
    const zero = {
      parserOrSchemaError: 0, criticalFalseAsin: 0, wrongMarketplace: 0,
      tokenEstimateMismatch: 0, secretLeak: 0,
    };
    const ok = judgeTwentyItemGate(zero);
    check('5項目すべて0なら合格', ok.passed === true);
    check('5項目を並べている', ok.rows.length === 5);
    check('★合格でも「進みます」とは書かない', !ok.verdictJa.includes('進みます'));
    check('★合格文に「ご本人が決めてください」がある', ok.verdictJa.includes('ご本人が決めて'));

    for (const k of Object.keys(zero) as (keyof typeof zero)[]) {
      const bad = judgeTwentyItemGate({ ...zero, [k]: 1 });
      check(`${k} が1件でもあれば不合格`, bad.passed === false);
    }
    check('不合格のときは0でない項目を名指しする',
      judgeTwentyItemGate({ ...zero, secretLeak: 2 }).verdictJa.includes('カギの漏れ=2'));
    check('★仕組みが自動で100件へ進むことはない', KEEPA_AUTO_ADVANCE_TO_HUNDRED === false);
  }

  // ================================================================
  console.log('\n[12. 「◯個以上」を実数として書かない]');
  {
    check('5000は「5,000個以上の区分」', formatBucketJa(5000) === '5,000個以上の区分');
    check('★「個売れている」と書かない', !formatBucketJa(5000).includes('個売れて'));
    check('値が無ければ「区分値なし」', formatBucketJa(null).includes('区分値なし'));
    check('★下限であって実数ではない、と書いてある', BUCKET_LOWER_BOUND_NOTE_JA.includes('実際の数ではありません'));
    check('★「月◯個売れている」とは書かない、と明記している',
      BUCKET_LOWER_BOUND_NOTE_JA.includes('とは書きません'));
  }

  // ================================================================
  console.log('\n[13. 売り場（カテゴリ）を商品ごとに保存する]');
  {
    const raw = {
      asin: 'B0TESTP702', domainId: 5, title: 'テスト商品',
      rootCategory: 465392,
      categoryTree: [{ catId: 465392, name: '本' }, { catId: 466282, name: 'ジャンル別' }],
      lastUpdate: 7_600_000,
      stats: { current: [-1, 1000, -1], salesRankDrops30: 4 },
    };
    const n = normalizeKeepaProduct(raw as any);
    check('rootCategory を保存している', n.rootCategoryId === 465392);
    check('売り場の名前は categoryTree の先頭から取る', n.rootCategoryName === '本');
    check('階層をすべて残している', n.categoryTreeNames.join(' > ') === '本 > ジャンル別');
    const empty = normalizeKeepaProduct({ asin: 'B0TESTP703', domainId: 5 } as any);
    check('★categoryTree が無ければ名前は null（番号から推測しない）', empty.rootCategoryName === null);
    check('★categoryTree が無ければ空配列（作らない）', empty.categoryTreeNames.length === 0);
    check('文字列の配列で来ても読める',
      normalizeKeepaProduct({ asin: 'B0TESTP704', domainId: 5, categoryTree: ['ゲーム', '機種別'] } as any)
        .rootCategoryName === 'ゲーム');
  }

  // ================================================================
  console.log('\n[14. 形の見張りに categoryTree を足した]');
  {
    const g = KEEPA_SHAPE_WATCH_GROUPS.find((x) => x.paths.includes('salesRanks'));
    check('売れ筋順位のグループがある', !!g);
    check('★categoryTree を見張っている', !!g && g.paths.includes('categoryTree'));
    const total = KEEPA_SHAPE_WATCH_GROUPS.reduce((s, x) => s + x.paths.length, 0);
    check('見張る項目は27か所以上（26から増えた）', total >= 27, `${total}か所`);
  }

  // ================================================================
  console.log('\n[15. 段階（S3＝20件）まで人が進めた]');
  {
    // ★2026-08-25 修正（ルール64。同じ間違いの2件目。1件目は test-phase3-12.ts の「いまはS2」）。
    //   ここは「いまの段階は S3」「上限は20件」を合格条件にしていたため、
    //   ご本人が「100件へ進むこと自体は許可します」と判断して S4 へ進めた瞬間に落ちた。
    //   **段階が正しく進むと不合格になるテストは逆さま**なので、
    //   「S3以上まで来ていること」「上限が段階の表と一致していること」に直した。
    //   守りたいのは「S3固定」ではなく「AIが自分で段階を進めないこと」であり、
    //   それは KEEPA_AUTO_ADVANCE_STAGE === false と下の2行（環境変数で動かせない）が見張っている。
    const order = KEEPA_STAGES.map((s) => s.code);
    check('いまの段階は S3 以上まで来ている',
      order.indexOf(KEEPA_CURRENT_STAGE) >= order.indexOf('S3'), KEEPA_CURRENT_STAGE);
    const now = KEEPA_STAGES.find((s) => s.code === KEEPA_CURRENT_STAGE);
    check('1回に取れる件数が段階の表と一致している',
      now !== undefined && KEEPA_MAX_ASINS_PER_RUN === now.maxAsins,
      `${KEEPA_MAX_ASINS_PER_RUN}件`);
    const s3 = KEEPA_STAGES.find((s) => s.code === 'S3');
    check('S3 の上限は20件', s3?.maxAsins === 20);
    const policy = codeOnly(readFile('lib/keepa/policy.ts'));
    check('★policy.ts に process.env が1つも無い（ルール84）', !policy.includes('process.env'));
    check('★段階は環境変数で動かせない', !/KEEPA_CURRENT_STAGE\s*=\s*[^;]*env/.test(policy));
  }

  // ================================================================
  console.log('\n[16. 候補探しの枠は上限を超えない（ルール102）]');
  {
    check('上限は15枠', KEEPA_MAX_DISCOVERY_TOKENS === 15);
    const wide = 10 + Math.ceil(KEEPA_DISCOVERY_PER_PAGE_WIDE / 100);
    check('広めに探す設定は300件', KEEPA_DISCOVERY_PER_PAGE_WIDE === 300);
    check('★300件でも13枠で上限15を超えない', wide === 13 && wide <= KEEPA_MAX_DISCOVERY_TOKENS);
    check('★上限ぎりぎり（500件＝15枠）にしていない', KEEPA_DISCOVERY_PER_PAGE_WIDE < 500);
  }

  // ================================================================
  console.log('\n[17. 20件取得スクリプトの歯止め]');
  {
    const src = codeOnly(readFile('scripts/keepa-twenty.ts'));
    check('★保存済みのASINを数えてから足りない分だけ取る', src.includes('alreadyFetchedAsins'));
    check('★保存済みのASINは候補から外す', /already|saved/i.test(src));
    /*
     * ★候補探しは1回きり。ここで数えているのは「読み込み1回＋呼び出し1回＝2回」。
     *   for / while の中に入っていたら、ジャンルの数だけ枠を使うことになる（ルール108）。
     */
    check('候補探しは1回だけ（ループで回していない）',
      (src.match(/discoverAsinCandidates/g) ?? []).length === 2
      && !/for\s*\([^)]*\)[^{]*\{[^}]*discoverAsinCandidates/.test(src));
    check('★Deep Scan を呼んでいない', !/deepScan|DeepScan|runDeepScan/.test(src));
    check('★出品者一覧（offers）を取っていない', !/offers\s*:\s*(20|100|true)/.test(src));
    check('--dry で通信せずに止まれる', src.includes("'--dry'") || src.includes('--dry'));
    check('★枠は用途ごとに分けて記録する（ルール104）',
      src.includes('DISCOVERY') && src.includes('PRODUCT_FETCH'));
    check('★カート追加が無い', !/addToCart|add_to_cart/i.test(src));
    check('★注文の実行が無い', !/placeOrder|createOrder|submitOrder/i.test(src));
    check('★出品の実行が無い', !/createListing|submitListing/i.test(src));
    check('★APIキーを画面へ出していない', !/console\.log\([^)]*KEEPA_API_KEY/.test(src));
    check('★売り場は番号ではなく名前で探す（ルール108）',
      src.includes('WANTED_GENRES') && !/catId\s*:\s*\d{4,}/.test(src));
  }

  // ================================================================
  console.log('\n[18. 分析スクリプトは枠を1つも使わない]');
  {
    const src = codeOnly(readFile('scripts/keepa-study.ts'));
    check('★Keepaへ通信していない', !src.includes('fetchKeepaProducts') && !src.includes('api.keepa.com'));
    check('★APIキーを読んでいない', !/KEEPA_API_KEY|process\.env/.test(src));
    check('読むのは保存済みの応答だけ', src.includes('keepa_raw_responses'));
    check('商品の応答だけに絞っている', src.includes("endpoint"));
    check('★「◯個以上の区分」の表示関数を使っている', src.includes('formatBucketJa'));
    check('★候補TOP3を「採用」と書いていない', !/採用します|採用しました/.test(src));
  }

  // ================================================================
  console.log('\n[19. 集計ファイルは画面へ載せられる（ルール37）]');
  {
    const src = readFile('lib/keepa/coverage.ts');
    check('★coverage.ts は何も import しない', !/^\s*import\s/m.test(src));
    check('★node: を読んでいない', !src.includes("from 'node:"));
    check('★DB層（lib/db）を読んでいない', !src.includes('lib/db') && !src.includes('../db'));
    const code = codeOnly(src);
    check('★通信していない', !/fetch\(|axios|https?:\/\/api\./.test(code));
  }

  // ================================================================
  console.log('\n[20. 需要の材料に4段階の食い違いが入った]');
  {
    const e = buildDemandEvidence({
      rankDrops30: 12,
      keepaMonthlySoldAtLeast: 5000,
      internalDemandSignal: 44,
      sellerCount: 56,
      amazonRetailPresent: 'NO',
      dataAgeDays: 1,
    } as any);
    check('4段階の結果が入っている', typeof e.conflictLevel?.level === 'string');
    check('44 と 5000 は強い食い違い', e.conflictLevel.level === 'STRONG_CONFLICT');
    check('従来の3種の判定も残っている', typeof e.conflict?.status === 'string');
    const e2 = buildDemandEvidence({
      rankDrops30: 12, keepaMonthlySoldAtLeast: null,
      internalDemandSignal: 32.7, sellerCount: 24,
      amazonRetailPresent: 'YES', dataAgeDays: 2,
    } as any);
    check('★Keepa値が無ければ「比べられない」', e2.conflictLevel.level === 'NOT_COMPARABLE');
    const sell = codeOnly(readFile('lib/sellability.ts'));
    check('★lib/sellability.ts は demand.ts を1行も読んでいない（ルール112）',
      !sell.includes("from './keepa/demand'") && !sell.includes('keepa/demand'));
  }

  // ================================================================
  console.log('\n[21. 保存する表に売り場と食い違いの欄がある]');
  {
    const schema = readFile('lib/db/schema.ts');
    for (const col of ['root_category_id', 'root_category_name', 'category_tree_json', 'demand_conflict_level']) {
      check(`${col} を保存できる`, schema.includes(col));
    }
    check('★既定は「比べられない」（食い違い無しにしない）',
      schema.includes("demand_conflict_level TEXT NOT NULL DEFAULT 'NOT_COMPARABLE'"));
    const store = codeOnly(readFile('lib/keepa/store.ts'));
    check('保存処理でも売り場を書き込んでいる', store.includes('rootCategoryId'));
    check('保存処理でも食い違いの段階を書き込んでいる', store.includes('conflictLevel.level'));
    check('★保存する表にURLの列が無い（ルール85）', !schema.includes('request_url'));
  }

  // ================================================================
  console.log('\n[22. 購入・出品・決済は、やはり存在しない]');
  {
    for (const f of ['lib/keepa/coverage.ts', 'scripts/keepa-twenty.ts', 'scripts/keepa-study.ts']) {
      const src = codeOnly(readFile(f));
      check(`${f} にカート追加が無い`, !/addToCart|add_to_cart/i.test(src));
      check(`${f} に注文の実行が無い`, !/placeOrder|createOrder|submitOrder/i.test(src));
      check(`${f} に決済が無い`, !/charge\(|payment\.|stripe/i.test(src));
    }
  }

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.14（20件実測・需要指標がどのくらい使えるか）の受け入れ条件をすべて満たしています。');
  console.log('※ このテストは Keepa へ一切アクセスしません。');
  console.log('※ 候補指標TOP3は「候補」であって「採用」ではありません。');
  console.log('※ この仕組みは自分で100件へ進みません。');
}

main();
