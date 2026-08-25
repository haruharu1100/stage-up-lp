/**
 * Phase 3.15（100件へ進む前に、売り場の偏りと需要指標の向き違いを潰す）の受け入れテスト。
 *
 * ------------------------------------------------------------------
 * 【このテストは Keepa へ一切アクセスしない】
 * 使うのは手で作った偽の行だけ。APIキーが無くても最後まで通る。
 *
 * ------------------------------------------------------------------
 * 【ここで潰しておきたい将来の事故】
 *
 *   1. 取り方を直さないまま、件数だけ80件増やす（＝偏った標本が5倍になる）
 *   2. 売り場を揃えるために、候補探しで枠を無制限に使う
 *   3. 見つからない売り場を「見つかったこと」にして、条件を緩めて水増しする
 *   4. 売り場の番号（catId）を推測で直書きする
 *   5. 「その他型番商品」の枠が、構造上ぜったいに埋まらないまま放置される
 *   6. 既存20件を取り直して枠を溶かす／合計が100件を超えて取り続ける
 *   7. 順位下落回数を「販売個数」に変換して本番判定へ流し込む
 *   8. 「比べられない」を「差が無かった」に足し込む
 *   9. 向きが揃っていることを「当社が間違い」の証拠として断定する
 *  10. 等分の取り分（EQUAL_SHARE）を「自分が月◯個売れる」と読ませる
 *  11. Keepaの区分値が無い商品を、無いという理由で減点する
 *  12. 当社の計算（RECENT_DEMAND_RATIO など）をKeepaの値として表示する
 *  13. Deep Scan が「候補を選ぶ」から「実行する」へ、いつのまにか変わる
 *  14. 判定モデルv0が本番の仕入判定へ流れ込む
 *  15. 成約データが1件も無いのに「v0のほうが優秀」と決める
 *  16. 材料が無い項目を0点で埋めて、点数の分母を100に固定する
 *  17. 区切り（20/40/70/100）の停止条件が7つ以外に増える／減る
 *  18. 取得率が急落したのを「データが無いだけ」と決めつけて進み続ける
 *  19. 新しいファイルが依存を抱えて画面へバンドルできなくなる（ルール37）
 *  20. 100件そろったあと、購入・出品・決済へ進む
 *
 * ------------------------------------------------------------------
 * ★ソース全文を正規表現で検査するときは、**先にコメントを取り除く**（ルール64）。
 *   過去に5件、「歯止めをコメントで説明したら、その説明文にテストが反応して落ちた」
 *   という同じ形の間違いが起きている。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  categoryCoverageEight,
  coverageEight,
  formatBucketJa,
  pct,
  CATEGORY_MIN_SAMPLE_TO_DISCUSS,
  INDICATOR_TOP3_FROM_TWENTY_LOCKED,
  INDICATOR_TOP3_RECOUNT_NOTE_JA,
  categoryStats,
  type CoverageRow,
} from '../lib/keepa/coverage';
import {
  compareModels,
  scoreCalibratedV0,
  selectDeepScanCandidates,
  CALIBRATED_MODEL_V0_APPLIED_IN_PRODUCTION,
  CALIBRATED_MODEL_V0_COMPONENTS,
  CALIBRATED_MODEL_V0_MIN_EVALUATED_WEIGHT,
  DEEP_SCAN_EXECUTE,
  DEEP_SCAN_RULES,
  DEEP_SCAN_TOKENS_SPENT,
  MODEL_COMPARISON_WINNER_DECIDED,
} from '../lib/keepa/modelv0';
import {
  demandEvidenceRows,
  divergenceDirectionSummary,
  judgeSignalDivergence,
  rankDropVelocity,
  rankDropsStrength,
  recentDemandRatio,
  EQUAL_SHARE_IS_SALES_FORECAST,
  EQUAL_SHARE_MISSING_FACTORS_JA,
  KEEPA_BUCKET_ABSENCE_DOWNGRADES_SCORE,
  RANK_DROPS_STRENGTH_BANDS,
  RANK_DROPS_STRENGTH_USED_IN_BUY_DECISION,
  SIGNAL_DIVERGENCE_LEVELS,
  SIGNAL_DIVERGENCE_OVERWRITES_CONFLICT,
  SIGNAL_DIVERGENCE_USED_IN_BUY_DECISION,
  SIGNAL_SOURCES,
} from '../lib/keepa/signals';
import {
  assignStratum,
  canSearchStratum,
  isExclusionCategory,
  judgeCheckpoint,
  judgeUnknownRateAnomaly,
  planHundred,
  KEEPA_HUNDRED_AUTO_ADVANCE_TO_DEEP_SCAN,
  KEEPA_HUNDRED_CHECKPOINTS,
  KEEPA_HUNDRED_DEEP_SCAN_TOKENS,
  KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL,
  KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS,
  KEEPA_HUNDRED_STOP_CONDITIONS,
  KEEPA_HUNDRED_STRATA,
  KEEPA_HUNDRED_TARGET_TOTAL,
  KEEPA_HUNDRED_TOKEN_BUDGET_TOTAL,
  KEEPA_KNOWN_SCHEMA_DRIFT_PATHS,
  KEEPA_STRATUM_MAX_DISCOVERY_ATTEMPTS,
  KEEPA_STRATUM_MAX_DISCOVERY_TOKENS,
  KEEPA_UNKNOWN_RATE_DROP_LIMIT_POINTS,
  STRATUM_OUTCOMES,
  STRATUM_UNASSIGNED,
} from '../lib/keepa/strata';
import { KEEPA_MAX_DISCOVERY_TOKENS } from '../lib/keepa/policy';

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

/** 検査用の偽の行。**実物と同じ形**で作る（ルール95）。 */
function row(over: Partial<CoverageRow> = {}): CoverageRow {
  return {
    asin: 'B00TEST0001',
    titleJa: 'テスト用の商品',
    categoryJa: '本',
    rankDrops30: 10,
    rankDrops90: 30,
    rankDrops180: 60,
    rankDrops365: 120,
    keepaMonthlySoldAtLeast: null,
    sellerCount: 5,
    estimatedEqualShareOpportunity: 2,
    amazonRetailPresent: 'NO',
    outOfStock30: 0,
    outOfStock90: 0,
    dataAgeDays: 1,
    conflictLevel: 'NOT_COMPARABLE',
    sellability: 'SELLS',
    parserErrorCount: 0,
    tokensUsed: 1,
    currentPriceYen: 2500,
    fbaFeeYen: 400,
    referralFeePercent: 10,
    imageCount: 5,
    divergenceLevel: 'NOT_COMPARABLE',
    ...over,
  };
}

async function main(): Promise<void> {
  console.log('='.repeat(72));
  console.log('Phase 3.15 受け入れテスト（100件の配分・需要シグナル・判定モデルv0案）');
  console.log('='.repeat(72));

  // ================================================================
  console.log('\n[1. 100件の配分表が、ご本人の指示どおりになっている]');
  {
    check('配分表の合計は100件', KEEPA_HUNDRED_TARGET_TOTAL === 100, `${KEEPA_HUNDRED_TARGET_TOTAL}`);
    check('売り場は8つ', KEEPA_HUNDRED_STRATA.length === 8, `${KEEPA_HUNDRED_STRATA.length}`);
    const want: Record<string, number> = {
      BOOKS: 15, GAMES: 10, TOYS_HOBBY: 15, ELECTRONICS: 15,
      PC: 10, DAILY: 10, BEAUTY: 10, OTHER_MODEL_NUMBER: 15,
    };
    for (const [key, n] of Object.entries(want)) {
      const s = KEEPA_HUNDRED_STRATA.find((x) => x.key === key);
      check(`${key} の目標は${n}件`, !!s && s.target === n, s ? `${s.target}` : 'なし');
    }
    check('20件テストで薄かった家電が、いちばん厚い枠に入っている',
      (KEEPA_HUNDRED_STRATA.find((x) => x.key === 'ELECTRONICS')?.target ?? 0) >= 15);
  }

  // ================================================================
  console.log('\n[2. 売り場は名前で突き合わせる（番号を直書きしない・ルール108）]');
  {
    const src = codeOnly(readFile('lib/keepa/strata.ts'));
    check('★配分表のファイルに売り場の番号が1つも書かれていない',
      !/catId|rootCategory\s*:\s*\[?\s*\d/.test(src));
    for (const s of KEEPA_HUNDRED_STRATA) {
      if (!s.searchableByName) continue;
      check(`${s.labelJa} は名前のキーワードを持っている`, s.keywords.length > 0);
    }
    check('本は「本」で当たる', assignStratum('本').key === 'BOOKS');
    check('洋書も本の枠に入る', assignStratum('洋書').key === 'BOOKS');
    check('ビューティーはビューティーの枠', assignStratum('ビューティー').key === 'BEAUTY');
    check('★売り場名が空のときは「その他」に落とさない',
      assignStratum('').key === STRATUM_UNASSIGNED);
    check('★売り場名が null のときも「その他」に落とさない',
      assignStratum(null).key === STRATUM_UNASSIGNED);
    check('どの枠にも当たらない売り場は「その他型番商品」',
      assignStratum('文房具・オフィス用品').key === 'OTHER_MODEL_NUMBER');
  }

  // ================================================================
  console.log('\n[3. 「その他」枠は、構造上ぜったい埋まらない設計にしない]');
  {
    const other = KEEPA_HUNDRED_STRATA.find((x) => x.key === 'OTHER_MODEL_NUMBER');
    check('その他は名前では探しに行かない', other?.searchableByName === false);
    check('★その他は「ほかに当たらない売り場」から探す（0件固定にしない）',
      other?.searchByExclusion === true);
    check('本は除外検索の対象にしない', isExclusionCategory('本') === false);
    check('家電＆カメラも除外検索の対象にしない', isExclusionCategory('家電＆カメラ') === false);
    check('文房具は除外検索の対象になる', isExclusionCategory('文房具・オフィス用品') === true);
    check('スポーツも除外検索の対象になる', isExclusionCategory('スポーツ＆アウトドア') === true);
    check('空文字は除外検索の対象にしない', isExclusionCategory('') === false);
  }

  // ================================================================
  console.log('\n[4. 既存分を配分へ当てはめ、足りない分だけ取る]');
  {
    const saved = [
      ...Array.from({ length: 7 }, (_, i) => ({ asin: `B0BOOK${i}`, categoryJa: '本' })),
      { asin: 'B0GAME1', categoryJa: 'ゲーム' },
      ...Array.from({ length: 3 }, (_, i) => ({ asin: `B0TOY${i}`, categoryJa: 'おもちゃ' })),
      { asin: 'B0PC1', categoryJa: 'PCソフト' },
      { asin: 'B0BEAUTY1', categoryJa: 'ビューティー' },
      ...Array.from({ length: 7 }, (_, i) => ({ asin: `B0UNK${i}`, categoryJa: null })),
    ];
    const plan = planHundred(saved);
    check('保存済みは20件と数えている', plan.alreadyTotal === 20, `${plan.alreadyTotal}`);
    check('売り場名が取れなかった7件を別に数えている', plan.unassigned === 7, `${plan.unassigned}`);
    const books = plan.strata.find((s) => s.key === 'BOOKS');
    check('★本はすでに7件あるので、追加は8件だけ', books?.remaining === 8, `${books?.remaining}`);
    const elec = plan.strata.find((s) => s.key === 'ELECTRONICS');
    check('★家電は0件なので、追加は15件', elec?.remaining === 15, `${elec?.remaining}`);
    const other = plan.strata.find((s) => s.key === 'OTHER_MODEL_NUMBER');
    check('★その他も探しに行くので追加15件（0固定ではない）', other?.remaining === 15, `${other?.remaining}`);

    // 目標より多く持っている場合、減らさない
    const over = planHundred(
      Array.from({ length: 20 }, (_, i) => ({ asin: `B0BOOK${i}`, categoryJa: '本' })),
    );
    const b2 = over.strata.find((s) => s.key === 'BOOKS');
    check('★目標を超えている枠は、追加0にするだけで持っている分を捨てない',
      b2?.remaining === 0 && b2?.already === 20 && b2?.overshoot === 5);
  }

  // ================================================================
  console.log('\n[5. 売り場を揃えるために枠を浪費しない]');
  {
    check('1つの売り場の探索は2回まで', KEEPA_STRATUM_MAX_DISCOVERY_ATTEMPTS === 2);
    check('1つの売り場に使ってよい枠は26まで', KEEPA_STRATUM_MAX_DISCOVERY_TOKENS === 26);
    check('候補探し全体の上限は120', KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL === 120);
    check('★追加で下見するのは80件まで（既存20件を取り直さない）',
      KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS === 80);
    check('★Deep Scan の予算は0（禁止）', KEEPA_HUNDRED_DEEP_SCAN_TOKENS === 0);
    check('全体の枠の上限は分けた4つの合計と一致する',
      KEEPA_HUNDRED_TOKEN_BUDGET_TOTAL
        === 1 + KEEPA_HUNDRED_MAX_DISCOVERY_TOKENS_TOTAL + KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS + 0);
    check('★1回の探索(13枠)は、1回あたりの上限15枠の内側',
      13 <= KEEPA_MAX_DISCOVERY_TOKENS && KEEPA_MAX_DISCOVERY_TOKENS === 15);

    const base = {
      attemptsSoFar: 0, tokensSpentOnThisStratum: 0, tokensSpentOnDiscoveryTotal: 0,
      remaining: 10, searchableByName: true, nextAttemptCost: 13,
    };
    check('ふつうは探してよい', canSearchStratum(base).allowed === true);
    check('★もう足りているなら探さない',
      canSearchStratum({ ...base, remaining: 0 }).outcomeIfStopped === 'ALREADY_FULL');
    check('★2回使い切ったら「届かなかった」で終わる',
      canSearchStratum({ ...base, attemptsSoFar: 2 }).outcomeIfStopped === 'TARGET_NOT_REACHED');
    check('★売り場ごとの枠を超えるなら探さない',
      canSearchStratum({ ...base, tokensSpentOnThisStratum: 20 }).allowed === false);
    check('★全体の枠を超えるなら探さない',
      canSearchStratum({ ...base, tokensSpentOnDiscoveryTotal: 115 }).allowed === false);
    check('名前でも除外でも探せない枠は「設計上探さない」',
      canSearchStratum({ ...base, searchableByName: false }).outcomeIfStopped === 'NOT_SEARCHED_BY_DESIGN');
    check('★除外で探す枠は探してよい',
      canSearchStratum({ ...base, searchableByName: false, searchByExclusion: true }).allowed === true);
    check('終わり方は4種類だけ', STRATUM_OUTCOMES.length === 4);
    check('「届かなかった」という終わり方が用意されている',
      STRATUM_OUTCOMES.includes('TARGET_NOT_REACHED'));
  }

  // ================================================================
  console.log('\n[6. 取得スクリプトが、条件を緩めず・取り直さず・100件で打ち切る]');
  {
    const src = codeOnly(readFile('scripts/keepa-hundred.ts'));
    check('保存済みのASINを、選ぶ前に除いている', /alreadySet\.has/.test(src));
    check('★合計が100件になったら打ち切る仕掛けがある', /globalFetchCap/.test(src));
    check('打ち切りの上限は「目標−保有」と「80」の小さいほう',
      /Math\.min\(\s*KEEPA_HUNDRED_MAX_PRODUCT_FETCH_TOKENS,\s*plan\.targetTotal\s*-\s*plan\.alreadyTotal/.test(src));
    check('売り場ごとに canSearchStratum を通してから探している', /canSearchStratum\(/.test(src));
    check('★公式の一覧を取ってから名前で突き合わせている', /lookupRootCategories/.test(src));
    check('★売り場の番号を直書きしていない', !/rootCategory\s*:\s*\[\s*\d+/.test(src));
    check('区切りで judgeCheckpoint を呼んでいる', /judgeCheckpoint\(/.test(src));
    check('★Deep Scan を呼んでいない', !/deepScan|DEEP_SCAN_STAGE/i.test(src));
    check('★条件を緩める分岐が無い（緩めれば必ず何か返るが、条件を満たした商品ではない）',
      !/relax|loosen|fallbackSelection/i.test(src));
  }

  // ================================================================
  console.log('\n[7. 順位下落回数を「販売個数」に変換して本番判定へ入れない]');
  {
    check('強さの区分は4段階', RANK_DROPS_STRENGTH_BANDS.length === 4);
    check('LOW/MEDIUM/HIGH/VERY_HIGH がそろっている',
      ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'].every((c) =>
        RANK_DROPS_STRENGTH_BANDS.some((b) => b.code === c)));
    check('0回は LOW（中身のある観測結果として扱う）', rankDropsStrength(0).code === 'LOW');
    check('10回は MEDIUM', rankDropsStrength(10).code === 'MEDIUM');
    check('30回は HIGH', rankDropsStrength(30).code === 'HIGH');
    check('100回は VERY_HIGH', rankDropsStrength(100).code === 'VERY_HIGH');
    check('★値が無いときは LOW にしない（null）', rankDropsStrength(null).code === null);
    check('★強さの区分は仕入判定に使っていない', RANK_DROPS_STRENGTH_USED_IN_BUY_DECISION === false);
    check('★強さの区分は当社の計算（Keepaの値ではない）',
      rankDropsStrength(10).source === 'INTERNAL_CALCULATION');
  }

  // ================================================================
  console.log('\n[8. 勢いと直近比は「当社の計算」と明示する]');
  {
    const fast = rankDropVelocity(30, 40);
    check('30日30回・90日40回は「加速」', fast.level === 'ACCELERATING', `${fast.ratio}倍`);
    const slow = rankDropVelocity(5, 60);
    check('30日5回・90日60回は「失速」', slow.level === 'SLOWING', `${slow.ratio}倍`);
    check('★材料が無ければ UNKNOWN（0とみなさない）', rankDropVelocity(null, 40).level === 'UNKNOWN');
    check('★勢いは当社の計算', fast.source === 'INTERNAL_CALCULATION');

    const r = recentDemandRatio({ rankDrops30: 10, rankDrops90: 30, rankDrops180: 60, rankDrops365: 120 });
    check('直近30日と各期間の平均が同じなら1.0倍', r.vs90 === 1 && r.vs180 === 1 && r.vs365 === 1);
    check('★直近比も当社の計算', r.source === 'INTERNAL_CALCULATION');
    const none = recentDemandRatio({ rankDrops30: 10, rankDrops90: null, rankDrops180: 0, rankDrops365: null });
    check('★材料が無いところは 0 ではなく null', none.vs90 === null && none.vs180 === null);
    check('出どころは2種類だけ', SIGNAL_SOURCES.length === 2);
  }

  // ================================================================
  console.log('\n[9. SIGNAL_DIVERGENCE は分析専用。既存の食い違い判定を壊さない]');
  {
    check('離れぐあいは4段階', SIGNAL_DIVERGENCE_LEVELS.length === 4);
    check('★既存の CONFLICT を上書きしない', SIGNAL_DIVERGENCE_OVERWRITES_CONFLICT === false);
    check('★仕入判定に使っていない', SIGNAL_DIVERGENCE_USED_IN_BUY_DECISION === false);

    const large = judgeSignalDivergence({ ourSignal: 32.7, keepaBucketLowerBound: 200 });
    check('6倍離れていれば LARGE', large.level === 'LARGE', `${large.ratio}倍`);
    check('当社のほうが小さいと分かる', large.direction === 'OURS_LOWER');
    const small = judgeSignalDivergence({ ourSignal: 10, keepaBucketLowerBound: 25 });
    check('2.5倍なら SMALL', small.level === 'SMALL', `${small.ratio}倍`);
    const same = judgeSignalDivergence({ ourSignal: 10, keepaBucketLowerBound: 11 });
    check('1.1倍なら NONE', same.level === 'NONE');
    const nc = judgeSignalDivergence({ ourSignal: 10, keepaBucketLowerBound: null });
    check('★片方が無ければ「比べられない」', nc.level === 'NOT_COMPARABLE');
    check('★比べられないときに倍率を作らない', nc.ratio === null);

    const sum = divergenceDirectionSummary([
      ...Array.from({ length: 7 }, () => ({ direction: 'OURS_LOWER' as const, level: 'LARGE' as const })),
      ...Array.from({ length: 13 }, () => ({ direction: 'NONE' as const, level: 'NOT_COMPARABLE' as const })),
    ]);
    check('★比べられた7件だけを分母にしている', sum.comparable === 7, `${sum.comparable}`);
    check('7件とも同じ向きだと分かる', sum.allSameDirection === true);
    check('★「比べられない13件」を差が無かったに足していない', sum.same === 0);
    check('★向きが揃っても「当社が間違い」と断定していない',
      !/当社が間違|Keepaが正し/.test(sum.noteJa));
  }

  // ================================================================
  console.log('\n[10. 等分の取り分は「自分が月◯個売れる」ではない]');
  {
    check('★等分の取り分は販売予測ではない', EQUAL_SHARE_IS_SALES_FORECAST === false);
    check('等分では説明できない要素を7つ書き出している',
      EQUAL_SHARE_MISSING_FACTORS_JA.length >= 7, `${EQUAL_SHARE_MISSING_FACTORS_JA.length}件`);
    for (const w of ['Buy Box', '価格', 'FBA', '在庫', '配送', '評価', 'Amazon']) {
      check(`「${w}」の違いに触れている`, EQUAL_SHARE_MISSING_FACTORS_JA.some((s) => s.includes(w)));
    }
  }

  // ================================================================
  console.log('\n[11. Keepaの区分値が無いことを、減点の理由にしない]');
  {
    check('★値が無くても評価を下げない', KEEPA_BUCKET_ABSENCE_DOWNGRADES_SCORE === false);
    const rows = demandEvidenceRows(
      {
        rankDrops30: 10, rankDrops90: 30, rankDrops180: 60, rankDrops365: 120,
        keepaMonthlySoldAtLeast: null, sellerCount: 5,
        outOfStock30: 0, outOfStock90: 0, amazonRetailPresent: 'NO', dataAgeDays: 1,
      },
      formatBucketJa,
    );
    check('材料は11項目そろっている', rows.length === 11, `${rows.length}件`);
    check('★すべての行に出どころが付いている',
      rows.every((r) => r.source === 'KEEPA' || r.source === 'INTERNAL_CALCULATION'));
    // ★2026-08-25 修正（ルール64：テストの方が事実を取り違えていた）。
    //   ここで最初 OUT_OF_STOCK_30D / AMAZON_RETAIL / DATA_FRESHNESS という名前を
    //   期待していたが、ご本人の指示12の原文は
    //   「Out of Stock % / Amazon Retail Present / Freshness」であり、
    //   実装の OUT_OF_STOCK / AMAZON_RETAIL_PRESENT / FRESHNESS の方が原文どおりである。
    //   在庫切れは30日と90日を1行に並べているので、30D だけを名乗るのは誤り。
    for (const key of [
      'RANK_DROPS_30D', 'RANK_DROPS_90D', 'RANK_DROPS_180D', 'RANK_DROPS_365D',
      'KEEPA_MONTHLY_BOUGHT_BUCKET', 'SELLER_COUNT', 'OUT_OF_STOCK',
      'AMAZON_RETAIL_PRESENT', 'FRESHNESS',
    ]) {
      check(`${key} が並んでいる`, rows.some((r) => r.key === key));
    }
    const bucketRow = rows.find((r) => r.key === 'KEEPA_MONTHLY_BOUGHT_BUCKET');
    // ★2026-08-25 修正（ルール64）。「不明」の3文字を必ず含むことを合格条件にしていたが、
    //   実装は「区分値なし（Keepa側に値がありません）」と、なぜ無いのかまで書いている。
    //   ルール97は「不明を2種類に分ける」なので、こちらの方が指示に沿っている。
    //   守りたいのは「0と混ぜないこと」なので、そちらを検査する。
    check('★区分値が無い商品は「不明」であって0ではない',
      !!bucketRow && bucketRow.valueJa.includes('なし') && !/0個/.test(bucketRow.valueJa));
    check('★順位下落は Keepa の値として出している',
      rows.find((r) => r.key === 'RANK_DROPS_30D')?.source === 'KEEPA');
    check('★直近の傾向は当社の計算として出している',
      rows.find((r) => r.key === 'RECENT_DEMAND_TREND')?.source === 'INTERNAL_CALCULATION');
    check('★「販売個数ではない」但し書きが行に付いている',
      rows.some((r) => r.noteJa.includes('販売個数ではありません')));
  }

  // ================================================================
  console.log('\n[12. 「◯個以上」を実数として書かない（ルール116の続き）]');
  {
    check('区分値は「以上」を付けて書く', formatBucketJa(5000).includes('以上'));
    // ★2026-08-25 修正（ルール64）。上と同じ理由で、文言そのものではなく
    //   「0個と読めないこと」を合格条件にした。
    check('★値が無いときは「値が無い」と書く（0にしない）',
      formatBucketJa(null).includes('なし') && !/0個/.test(formatBucketJa(null)));
    const signals = codeOnly(readFile('lib/keepa/signals.ts'));
    // ★2026-08-25 修正（ルール64・同じ形の間違いが6件目）。
    //   「個以上」の3文字を1つでも見つけたら不合格にしていたが、signals.ts に残っていたのは
    //   「片方は◯個以上という区分の下限値で、もともと物差しが違います」という**説明文**だった。
    //   歯止めをコメントや説明文で書くと、その説明文にテストが反応して落ちる——という
    //   これまで5件あったのと同じ型である。
    //   本当に禁じたいのは「値から表示文を組み立てること」なので、そちらだけを検査する。
    check('★signals.ts は自分で「◯個以上」を組み立てていない（1か所に集める）',
      !/\$\{[^}]*\}\s*個以上/.test(signals) && !/toLocaleString/.test(signals));
    check('★signals.ts は formatBucket を受け取って使う（依存を持たない）',
      /formatBucket:\s*\(v:\s*number\s*\|\s*null\)\s*=>\s*string/.test(signals));
    for (const f of ['lib/keepa/signals.ts', 'lib/keepa/strata.ts', 'lib/keepa/modelv0.ts']) {
      const src = codeOnly(readFile(f));
      check(`${f} に「実測販売数」が無い`, !src.includes('実測販売数'));
      check(`${f} に ACTUAL_MONTHLY_SALES が無い`, !src.includes('ACTUAL_MONTHLY_SALES'));
    }
  }

  // ================================================================
  console.log('\n[13. 8つのCoverageを、全体と売り場別の両方で出す]');
  {
    const rows: CoverageRow[] = [
      row({ asin: 'A1', categoryJa: '本', currentPriceYen: 1000 }),
      row({ asin: 'A2', categoryJa: '本', currentPriceYen: null, imageCount: null }),
      row({ asin: 'A3', categoryJa: '家電＆カメラ', keepaMonthlySoldAtLeast: 200 }),
    ];
    const eight = coverageEight(rows);
    check('Coverage は8種類', eight.length === 8, `${eight.length}件`);
    // ★2026-08-25 修正（ルール64）。短い名前を期待していたが、ご本人の指示20の原文は
    //   「CURRENT_PRICE_COVERAGE / RANK_DROPS_COVERAGE / …」と _COVERAGE 付きであり、
    //   実装の方が原文どおりである。
    for (const key of [
      'CURRENT_PRICE_COVERAGE', 'RANK_DROPS_COVERAGE', 'SELLER_COUNT_COVERAGE',
      'OUT_OF_STOCK_COVERAGE', 'MONTHLY_BOUGHT_BUCKET_COVERAGE',
      'AMAZON_RETAIL_COVERAGE', 'FEE_COVERAGE', 'IMAGE_COVERAGE',
    ]) {
      check(`${key} を数えている`, eight.some((e) => e.key === key));
    }
    const price = eight.find((e) => e.key === 'CURRENT_PRICE_COVERAGE');
    // ★2026-08-25 修正（ルール64）。取れた件数の欄名は have ではなく present。
    check('価格は3件中2件で取れている', price?.present === 2 && price?.total === 3);
    const byCat = categoryCoverageEight(rows);
    check('★売り場別にも8つ出している',
      byCat.length === 2 && byCat.every((c) => c.stats.length === 8));
    check('★分母0なら0%ではなく null', pct(0, 0) === null);
    check('分母があれば率を出す', pct(1, 4) === 25);
  }

  // ================================================================
  console.log('\n[14. サンプルが少ない売り場について断定しない]');
  {
    check('10件未満は「まだ語れない」線を持っている', CATEGORY_MIN_SAMPLE_TO_DISCUSS === 10);
    const few = categoryStats([row({ asin: 'X1', categoryJa: 'ゲーム' })]);
    check('★1件しかない売り場に「断定できない」印が付く', few[0]?.tooFewToConclude === true);
    const many = categoryStats(
      Array.from({ length: 12 }, (_, i) => row({ asin: `Y${i}`, categoryJa: '本' })),
    );
    check('12件あれば印は付かない', many[0]?.tooFewToConclude === false);
    check('売り場ごとに出品者数の平均を出している', typeof many[0]?.avgSellerCount === 'number');
    check('売り場ごとに Amazon本体の割合を出している', many[0]?.amazonRetailPercent !== undefined);
    check('売り場ごとに在庫切れの分布を出している', typeof many[0]?.outOfStock?.zero === 'number');
    check('売り場ごとに判定の分布を出している', typeof many[0]?.sellability?.sells === 'number');
    check('売り場ごとに離れぐあいの分布を出している', typeof many[0]?.divergence?.notComparable === 'number');
  }

  // ================================================================
  console.log('\n[15. 20件での暫定TOP3を、そのまま固定採用しない]');
  {
    check('★20件のTOP3は確定していない', INDICATOR_TOP3_FROM_TWENTY_LOCKED === false);
    check('数え直す約束が文章で残っている', INDICATOR_TOP3_RECOUNT_NOTE_JA.length > 20);
    check('★「採用」と書いていない', !INDICATOR_TOP3_RECOUNT_NOTE_JA.includes('採用します'));
  }

  // ================================================================
  console.log('\n[16. Deep Scan は「候補を選ぶ」だけ。実行しない]');
  {
    check('★Deep Scan は実行しない', DEEP_SCAN_EXECUTE === false);
    check('★Deep Scan で使った枠は0', DEEP_SCAN_TOKENS_SPENT === 0);
    check('候補の条件は6つ', DEEP_SCAN_RULES.length === 6, `${DEEP_SCAN_RULES.length}件`);
    for (const code of [
      'FRESH_DATA', 'DEMAND_STRONG', 'SELLER_COMPETITION_ACCEPTABLE',
      'AMAZON_RETAIL_RISK_ACCEPTABLE', 'PRICE_DATA_AVAILABLE', 'PROFIT_ROUTE_EXISTS',
    ]) {
      check(`条件 ${code} がある`, DEEP_SCAN_RULES.some((r) => r.code === code));
    }
    const sel = selectDeepScanCandidates([
      {
        asin: 'B1', dataAgeDays: 1, rankDrops30: 30, sellerCount: 5,
        amazonRetailPresent: 'NO', currentPriceYen: 2000, hasProfitRoute: true,
      },
      {
        asin: 'B2', dataAgeDays: 1, rankDrops30: 30, sellerCount: 5,
        amazonRetailPresent: 'NO', currentPriceYen: 2000, hasProfitRoute: null,
      },
    ]);
    check('★選んだだけで実行していない', sel.executed === false && sel.tokensSpent === 0);
    check('6つ全部そろえば候補になる', sel.candidates[0]?.qualified === true);
    check('★材料が無い（不明）ものを合格に寄せない', sel.candidates[1]?.qualified === false);
    check('★材料が無いものを「不合格」に混ぜない',
      sel.candidates[1]?.unknownCount === 1 && sel.candidates[1]?.failCount === 0);
    check('100件のあと、自動でDeep Scanへ進まない', KEEPA_HUNDRED_AUTO_ADVANCE_TO_DEEP_SCAN === false);
  }

  // ================================================================
  console.log('\n[17. 判定モデルv0は案のまま。本番へ入れない]');
  {
    check('★v0は本番の判定に使っていない', CALIBRATED_MODEL_V0_APPLIED_IN_PRODUCTION === false);
    check('要素は6つ', CALIBRATED_MODEL_V0_COMPONENTS.length === 6);
    check('重みの合計は100', CALIBRATED_MODEL_V0_COMPONENTS.reduce((s, c) => s + c.weight, 0) === 100);
    for (const code of [
      'DEMAND', 'COMPETITION', 'TREND', 'AVAILABILITY', 'AMAZON_RETAIL_RISK', 'DATA_CONFIDENCE',
    ]) {
      check(`要素 ${code} がある`, CALIBRATED_MODEL_V0_COMPONENTS.some((c) => c.code === code));
    }

    const full = scoreCalibratedV0({
      asin: 'C1', rankDropsStrength: 'HIGH', sellerCount: 3, velocity: 'ACCELERATING',
      outOfStock90: 0, amazonRetailPresent: 'NO', dataAgeDays: 1, hasKeepaBucket: true,
    });
    check('材料がそろえば点が出る', typeof full.score === 'number');
    check('見られた重みが100', full.evaluatedWeight === 100, `${full.evaluatedWeight}`);

    const thin = scoreCalibratedV0({
      asin: 'C2', rankDropsStrength: null, sellerCount: null, velocity: 'UNKNOWN',
      outOfStock90: null, amazonRetailPresent: 'UNKNOWN', dataAgeDays: null, hasKeepaBucket: false,
    });
    check('★材料が無い項目を0点で埋めていない',
      thin.parts.filter((p) => p.points === null).length >= 5);
    check('★見られた重みが足りなければ点を付けず UNKNOWN',
      thin.score === null && thin.verdict === 'UNKNOWN');
    check('点を付ける最低ラインは50', CALIBRATED_MODEL_V0_MIN_EVALUATED_WEIGHT === 50);
    check('★Keepaの区分値が無くても、そのぶんを減点していない',
      scoreCalibratedV0({
        asin: 'C3', rankDropsStrength: 'HIGH', sellerCount: 3, velocity: 'STEADY',
        outOfStock90: 0, amazonRetailPresent: 'NO', dataAgeDays: 1, hasKeepaBucket: false,
      }).evaluatedWeight === 100);
  }

  // ================================================================
  console.log('\n[18. 現行とv0は「何件変わったか」だけ数え、優劣を決めない]');
  {
    const cmp = compareModels([
      { asin: 'D1', current: 'SELLS', v0: 'SELLS' },
      { asin: 'D2', current: 'SELLS', v0: 'CROWDED' },
      { asin: 'D3', current: 'CROWDED', v0: 'UNKNOWN' },
      { asin: 'D4', current: 'SELLS', v0: 'SELLS' },
    ]);
    check('4件を比べている', cmp.total === 4);
    check('2件で判定が変わったと数えている', cmp.changed === 2, `${cmp.changed}`);
    check('変わった割合を出している', cmp.changedPercent === 50, `${cmp.changedPercent}`);
    check('★どちらが優秀かは決めていない', cmp.winnerDecided === false && MODEL_COMPARISON_WINNER_DECIDED === false);
    check('★決めない理由（成約データが無い）を書いている', cmp.noteJa.includes('成約データ'));
    check('★0件のときに割合を0%にしない', compareModels([]).changedPercent === null);
    check('★既存の判定を消していない（4種類のまま）',
      readFile('lib/sellability.ts').includes('DOES_NOT_SELL'));
  }

  // ================================================================
  console.log('\n[19. 区切り（20/40/70/100）と、7つの停止条件]');
  {
    check('区切りは 20 → 40 → 70 → 100',
      KEEPA_HUNDRED_CHECKPOINTS.join(',') === '20,40,70,100');
    check('停止条件は7つ', KEEPA_HUNDRED_STOP_CONDITIONS.length === 7);
    for (const code of [
      'PARSER_ERROR', 'NEW_SCHEMA_DRIFT', 'TOKEN_MISMATCH', 'WRONG_MARKETPLACE',
      'FALSE_ASIN', 'SECRET_LEAK', 'UNKNOWN_RATE_ANOMALY',
    ]) {
      check(`停止条件 ${code} がある`, KEEPA_HUNDRED_STOP_CONDITIONS.some((s) => s.code === code));
    }

    const clean = {
      reachedCount: 40, parserError: 0, newSchemaDrift: 0, tokenMismatch: 0,
      wrongMarketplace: 0, falseAsin: 0, secretLeak: 0,
      previousCoveragePercent: 95, currentCoveragePercent: 94,
    };
    check('問題が無ければ止まらない', judgeCheckpoint(clean).stop === false);
    check('★問題が無ければ人の承認を毎回は求めない', judgeCheckpoint(clean).needsHumanApproval === false);
    check('読み取り不具合が1件でもあれば止まる',
      judgeCheckpoint({ ...clean, parserError: 1 }).stop === true);
    check('新しい形の違いがあれば止まる',
      judgeCheckpoint({ ...clean, newSchemaDrift: 1 }).stop === true);
    check('枠のズレがあれば止まる', judgeCheckpoint({ ...clean, tokenMismatch: 1 }).stop === true);
    check('日本以外が混ざれば止まる', judgeCheckpoint({ ...clean, wrongMarketplace: 1 }).stop === true);
    check('実在しないASINがあれば止まる', judgeCheckpoint({ ...clean, falseAsin: 1 }).stop === true);
    check('カギが漏れたら止まる', judgeCheckpoint({ ...clean, secretLeak: 1 }).stop === true);
    check('★取得率が95%→60%へ急落したら止まる',
      judgeCheckpoint({ ...clean, previousCoveragePercent: 95, currentCoveragePercent: 60 }).stop === true);
    check('7つとも見ている', judgeCheckpoint(clean).rows.length === 7);
  }

  // ================================================================
  console.log('\n[20. 「不明」の急増を、データが無いだけと決めつけない]');
  {
    check('20ポイント下がったら異常とみなす', KEEPA_UNKNOWN_RATE_DROP_LIMIT_POINTS === 20);
    const bad = judgeUnknownRateAnomaly(95, 60);
    check('95%→60%は異常', bad.anomaly === true && bad.dropPoints === 35);
    check('★「データが無いだけ」と決めつけない文言がある',
      bad.messageJa.includes('決めつけず'));
    check('当社の読み取りかKeepa仕様変更の可能性に触れている',
      bad.messageJa.includes('仕様'));
    const ok = judgeUnknownRateAnomaly(95, 90);
    check('5ポイントの低下は範囲内', ok.anomaly === false);
    const first = judgeUnknownRateAnomaly(null, 90);
    check('★前回が無いときは「比べられない」（異常なしと書かない）',
      first.anomaly === false && first.dropPoints === null && first.messageJa.includes('比べられません'));
  }

  // ================================================================
  console.log('\n[21. すでに扱いを決めた「形の違い」だけを、新しい違いから外す]');
  {
    // ★2026-08-25 修正（ルール64。「進むと落ちるテスト」の3件目）。
    //   ここは「扱い済みはちょうど3か所」を合格条件にしていたため、
    //   100件取得が40件の区切りで**設計どおり止まり**、その原因（eanList / upcList）を
    //   調べて扱いを決めた瞬間に落ちた。
    //   歯止めが正しく働いて前へ進むと不合格になるテストは逆さまなので、
    //   「3か所以上あること」「最初の3か所が消えていないこと」に直した。
    //   守りたいのは件数ではなく「**扱いを決めていない違いを黙って通さないこと**」であり、
    //   それは keepa-hundred.ts が NEW_SCHEMA_DRIFT で止まることの方が見張っている。
    check('扱い済みは3か所以上', KEEPA_KNOWN_SCHEMA_DRIFT_PATHS.length >= 3,
      `${KEEPA_KNOWN_SCHEMA_DRIFT_PATHS.length}か所`);
    for (const p of ['availabilityAmazonDelay', 'model', 'partNumber']) {
      check(`${p} は扱い済み`, (KEEPA_KNOWN_SCHEMA_DRIFT_PATHS as readonly string[]).includes(p));
    }
    const src = codeOnly(readFile('scripts/keepa-hundred.ts'));
    check('★扱い済み以外で形が割れたら新しい違いとして数えている',
      /KEEPA_KNOWN_SCHEMA_DRIFT_PATHS/.test(src));
  }

  // ================================================================
  console.log('\n[22. 新しいファイルは画面へバンドルできる（ルール37）]');
  {
    for (const f of ['lib/keepa/strata.ts', 'lib/keepa/signals.ts', 'lib/keepa/modelv0.ts']) {
      check(`${f} は他のファイルを import していない`, !/^\s*import\s/m.test(readFile(f)));
      check(`${f} は node: を読んでいない`, !readFile(f).includes("node:"));
    }
  }

  // ================================================================
  console.log('\n[23. 100件そろっても、購入・出品・決済・発送には進まない]');
  {
    for (const f of [
      'lib/keepa/strata.ts', 'lib/keepa/signals.ts', 'lib/keepa/modelv0.ts',
      'scripts/keepa-hundred.ts', 'scripts/keepa-study.ts',
    ]) {
      const src = codeOnly(readFile(f));
      check(`${f} にカート追加が無い`, !/addToCart|add_to_cart/i.test(src));
      check(`${f} に注文の実行が無い`, !/placeOrder|createOrder|submitOrder/i.test(src));
      check(`${f} に決済が無い`, !/charge\(|payment\.|stripe/i.test(src));
      check(`${f} に出品の実行が無い`, !/createListing|publishListing/i.test(src));
    }
    const study = readFile('scripts/keepa-study.ts');
    check('★報告Gで「実購入へ進む：NO」と書いている', /実購入[^\n]*NO/.test(study));
  }

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.15（100件の配分・需要シグナル・判定モデルv0案）の受け入れ条件をすべて満たしています。');
  console.log('※ このテストは Keepa へ一切アクセスしません。');
  console.log('※ Deep Scan は「候補を選ぶ」までで、実行しません。');
  console.log('※ 判定モデルv0は案のままで、本番の仕入判定には使いません。');
  console.log('※ 100件そろっても、購入・出品・決済・発送には進みません。');
}

main();
