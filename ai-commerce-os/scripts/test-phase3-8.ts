/**
 * Phase 3.8（まず10件のPILOT：脱落理由・同一商品の答え合わせ・自動化の順番）の受け入れテスト。
 *
 * 【このテストが守っているもの】
 * ユーザーからの指示はこうだった。
 *
 *   「ここでは新機能を増やさず、まず『人が10件入力したときに、どこが面倒か・
 *     どこまで自動判定できるか』を測るのが一番価値があります。」
 *
 *   「重要です。Routeにならなかった商品について、必ず理由を分類してください。」
 *
 *   「利益商品を見逃すより、違う商品を同じ商品として扱う方が危険です。」
 *
 *   「送料不明を0円扱いしないこと。」
 *
 *   「条件を満たさなければ、100件へ進まないでください。」
 *
 *   「今回も、購入 出品 決済 発送 自動ログイン 無許可スクレイピング は実装しません。」
 *
 * この6つが将来なし崩しに戻らないように、次を潰しにいく。
 *
 *   1. 落ちた理由が「その他」に放り込まれ、何も分からなくなること
 *   2. 「たぶん同じ商品」という選択肢ができ、迷ったものが合格側に寄ること
 *   3. 取り違え（FALSE MATCH）が、見逃しと同じ軽さで扱われること
 *   4. 人の答えが機械の判定を上書きし、精度を測れなくなること
 *   5. 時間が長いだけの工程（自動化できない工程）を「次に作るもの」にすること
 *   6. 「全部自動化すれば作業0分」という、実際には起きない数字を出すこと
 *   7. 測っていないものを合格として数え、100件へ進んでしまうこと
 *   8. 購入・出品・決済・自動ログインの処理が紛れ込むこと
 */
import { all, one, run, migrate, nowIso } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import {
  DROPOUT_REASONS, DROPOUT_STAGE_JA, dropoutSummary,
  type DropoutReason,
} from '../lib/dropout';
import {
  matchCandidates, matchReviewSummary, recordMatchReview,
} from '../lib/matchreview';
import {
  MATCH_VERDICTS, MATCH_VERDICT_JA, isMatchVerdict,
  WORK_STEPS, AUTOMATABLE_WEIGHT, AUTOMATABLE_JA, normalizeWorkStep,
} from '../lib/listing';
import { automationPlan } from '../lib/automation';
import { integrityReport, canonicalUrl } from '../lib/integrity';
import { pilotReport } from '../lib/pilot';
import { importListingObservations } from '../lib/observation';
import { assertNoExecutionPath } from '../lib/smalltrade';

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

function section(title: string): void {
  console.log(`\n[${title}]`);
}

/** ソースを読む。パスに日本語が入るので URL をそのまま渡す（CLAUDE.md ルール28）。 */
async function src(rel: string): Promise<string> {
  const fs = await import('node:fs');
  return fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
}

/** ユーザー指示7に書かれている8分類。名前を勝手に変えない。 */
const REQUIRED_REASONS = [
  'MODEL_NUMBER_MISSING',
  'MARKET_DATA_MISSING',
  'PRODUCT_MATCH_FAILED',
  'FEE_UNVERIFIED',
  'SHIPPING_UNKNOWN',
  'INSUFFICIENT_MARGIN',
  'LOW_DATA_CONFIDENCE',
  'NO_SELL_MARKET',
];

/** ユーザー指示15の7条件。 */
const REQUIRED_GATES = [
  'NO_SEVERE_BUG',
  'NO_FALSE_MATCH',
  'NO_DUPLICATE_ENTRY',
  'NO_DATA_CONTAMINATION',
  'ENTRY_TIME_REALISTIC',
  'ROUTE_CALC_HEALTHY',
  'SHADOW_SAVE_HEALTHY',
];

async function main() {
  await migrate();
  await ensureReady();

  // ================================================================
  section('1. 落ちた理由を8分類する（「その他」を作らない）');

  const codes = Object.keys(DROPOUT_REASONS);
  check('脱落理由はちょうど8分類', codes.length === 8, `${codes.length}分類`);
  for (const r of REQUIRED_REASONS) {
    check(`指示どおりの分類がある：${r}`, codes.includes(r));
  }
  check(
    '「その他」に逃げる分類を作っていない',
    !codes.some((c) => /^(OTHER|MISC|UNKNOWN|ETC)$/i.test(c)),
    codes.join('・'),
  );
  check(
    'すべての分類に「なぜ落ちるか」と「次にやること」が書いてある',
    codes.every((c) => {
      const d = DROPOUT_REASONS[c as DropoutReason];
      return d.ja.length > 0 && d.why.length > 0 && d.next.length > 0;
    }),
  );
  check(
    '「利益が足りない」の対処が「判定を甘くする」になっていない',
    DROPOUT_REASONS.INSUFFICIENT_MARGIN.next.includes('甘くしない'),
    DROPOUT_REASONS.INSUFFICIENT_MARGIN.next,
  );
  check(
    '「相場が無い」の対処が「商品を増やす」になっていない',
    DROPOUT_REASONS.MARKET_DATA_MISSING.next.includes('件数を増やしても'),
  );
  check('落ちた段階は4段階に整理されている', Object.keys(DROPOUT_STAGE_JA).length === 4);

  const dropSrc = await src('../lib/dropout.ts');
  check(
    '脱落の集計が、しきい値や判定結果を書き換えていない（数えるだけ）',
    !/\b(UPDATE|INSERT|DELETE)\s+/i.test(dropSrc),
  );

  const drop = await dropoutSummary();
  check(
    '落ちた件数と通った件数の合計が、対象の件数と一致する',
    drop.droppedCount + drop.survivedCount === drop.total,
    `${drop.droppedCount}+${drop.survivedCount}=${drop.total}`,
  );
  check(
    'すべての行が8分類のどれかに入っている',
    drop.rows.every((r) => codes.includes(r.reason)),
  );
  check(
    '理由ごとの合計が、落ちた件数と一致する',
    drop.byReason.reduce((a, r) => a + r.count, 0) === drop.droppedCount,
  );
  check(
    '段階ごとの合計が、落ちた件数と一致する',
    drop.byStage.reduce((a, r) => a + r.count, 0) === drop.droppedCount,
  );
  check(
    '理由は多い順に並んでいる（次に直す場所が先頭に来る）',
    drop.byReason.every((r, i) => i === 0 || drop.byReason[i - 1].count >= r.count),
  );
  check(
    '0件のときに割合を作り話にしていない',
    drop.droppedCount > 0 || drop.byReason.length === 0,
  );

  // ================================================================
  section('2. 送料が不明なものを0円扱いしない');

  const shipSrc = dropSrc;
  check(
    '送料が分かっているかを判定する関数がある',
    /function shippingKnown/.test(shipSrc),
  );
  check(
    '送料不明を落とす理由として持っている',
    codes.includes('SHIPPING_UNKNOWN'),
  );
  check(
    '送料不明の説明に「0円として計算しない」と書いてある',
    DROPOUT_REASONS.SHIPPING_UNKNOWN.why.includes('0円'),
  );
  check(
    '送料不明の行が、送料0円のまま利益計算まで進んでいない',
    drop.rows.filter((r) => r.reason === 'SHIPPING_UNKNOWN')
      .every((r) => r.stage === 'COST'),
  );

  // ================================================================
  section('3. 同じ商品かどうかを人が確かめる（迷いを合格にしない）');

  check('確認結果は3つだけ', MATCH_VERDICTS.length === 3,
    MATCH_VERDICTS.map((v) => v.code).join('・'));
  check(
    '「たぶん合っている」のような曖昧な選択肢を作っていない',
    !MATCH_VERDICTS.some((v) => /PROBABLY|LIKELY|TENTATIVE|MAYBE/i.test(v.code)),
  );
  check(
    '重大なのは「違う商品だった」だけ',
    MATCH_VERDICTS.filter((v) => v.severe).map((v) => v.code).join(',') === 'INCORRECT_MATCH',
  );
  check('未知の確認結果は受け付けない', !isMatchVerdict('PROBABLY_CORRECT'));
  check('3つの確認結果は受け付ける',
    MATCH_VERDICTS.every((v) => isMatchVerdict(v.code)));
  check('確認結果に日本語の名前が付いている',
    MATCH_VERDICTS.every((v) => (MATCH_VERDICT_JA[v.code] ?? '').length > 0));

  const mrSrc = await src('../lib/matchreview.ts');
  check(
    '人の答えが、機械の判定（identity_key）を書き換えていない',
    !/UPDATE\s+tracked_listings/i.test(mrSrc),
  );
  check(
    '人の答えは別の表に保存している',
    /INSERT INTO identity_match_reviews/i.test(mrSrc),
  );
  check(
    '取り違えの説明に「見逃しより危険」という趣旨が書いてある',
    /見逃し/.test(mrSrc) && /危険|失う/.test(mrSrc),
  );

  // --- 実際に記録してみる。テスト用の行は最後に必ず消す。 -------------
  const wipe = async () => {
    await run(`DELETE FROM identity_match_reviews WHERE listing_key LIKE '%mP38%'`);
    await run(`DELETE FROM listing_observations WHERE listing_key LIKE '%mP38%'`);
    await run(`DELETE FROM tracked_listings WHERE listing_key LIKE '%mP38%'`);
    // 相場の行は「実データと絶対にぶつからない型番」で作ってあるので、
    // 型番の文字列で消せる。実在の型番で消すと本物の相場を巻き添えにする。
    await run(`DELETE FROM venue_market_prices WHERE identity_key LIKE '%p38testonly001%'`);
    await run(`DELETE FROM observation_work_log WHERE batch_id LIKE 'P38%'`);
  };
  await wipe();

  const url = 'https://jp.mercari.com/item/mP38ACCEPT001';
  const imp = await importListingObservations(
    `確認日時,市場,商品名,ブランド,型番,状態,出品価格,商品URL,販売状況,荷物サイズ,発送方法,入力秒数,発見秒数,情報確認秒数,型番確認秒数,状態確認秒数,記入秒数
2026-08-20 10:00,MERCARI,テスト用ダミー商品（受け入れテスト）,NIKE,P38TESTONLY001,未使用に近い,105000,${url},出品中,80サイズ,らくらくメルカリ便,150,40,25,35,25,25`,
  );
  check('確認用の出品を1件登録できた', imp.newListings === 1, `${imp.newListings}件`);
  check('工程ごとの秒数も一緒に記録された', imp.workStepRows === 5, `${imp.workStepRows}行`);

  const listingRow = await one(
    `SELECT listing_key, identity_key FROM tracked_listings WHERE product_url LIKE '%mP38ACCEPT001%'`,
  );
  const lk = String(listingRow?.listing_key ?? '');
  const ik = String(listingRow?.identity_key ?? '');
  check('型番から商品を特定できている', ik !== '' && ik !== 'null', ik);

  // 比べる相手（別市場の相場）を1件だけ用意する
  await run(
    `INSERT INTO venue_market_prices
       (venue_code, side, identity_key, price, price_basis, sold_count_30d,
        listing_count, avg_days_to_sell, observed_at, is_estimated, created_at)
     VALUES ('YAHOO_AUCTION','SELL',?,130000,'SOLD_MEDIAN',12,20,5,?,0,?)`,
    [ik, nowIso(), nowIso()],
  );

  const cands = await matchCandidates();
  const mine = cands.filter((c) => c.listingKey === lk);
  check('比べる相手ができると、確認待ちとして出てくる', mine.length === 1,
    `${mine.length}件`);
  check('確認前は「未確認」になっている', mine[0]?.verdict === null);

  const before = await matchReviewSummary();
  check(
    '1件も確認していない段階で「的中率」を作らない',
    before.reviewed > 0 || before.precision === null,
  );

  let rejected = false;
  try {
    await recordMatchReview(lk, 'YAHOO_AUCTION', 'PROBABLY_CORRECT');
  } catch { rejected = true; }
  check('登録されていない確認結果は保存できない', rejected);

  let rejectedListing = false;
  try {
    await recordMatchReview('mNOT_EXIST_P38', 'YAHOO_AUCTION', 'CORRECT_MATCH');
  } catch { rejectedListing = true; }
  check('登録されていない出品には確認結果を付けられない', rejectedListing);

  await recordMatchReview(lk, 'YAHOO_AUCTION', 'INCORRECT_MATCH', '海外版で付属品が違った');
  const afterBad = await matchReviewSummary();
  check('取り違えを記録できた', afterBad.incorrect >= 1, `${afterBad.incorrect}件`);
  check('取り違えは重大として扱われる', afterBad.severeIssue === true);
  check('取り違えの理由（何が違ったか）が残っている',
    afterBad.falseMatches.some((f) => (f.note ?? '').includes('海外版')));

  // 同じ組み合わせを2回押しても行は増えない（冪等）
  await recordMatchReview(lk, 'YAHOO_AUCTION', 'INCORRECT_MATCH', '海外版で付属品が違った');
  const dupRows = await one(
    `SELECT COUNT(*) AS n FROM identity_match_reviews WHERE listing_key = ?`, [lk],
  );
  check('同じ組み合わせを2回確認しても記録は1行のまま',
    Number(dupRows?.n ?? 0) === 1, `${Number(dupRows?.n ?? 0)}行`);

  // 機械の判定は触っていない
  const afterKey = await one(
    `SELECT identity_key FROM tracked_listings WHERE listing_key = ?`, [lk],
  );
  check('人が「違う」と答えても、機械の判定はそのまま残っている',
    String(afterKey?.identity_key ?? '') === ik);

  // 取り違えがあるうちは100件へ進めない
  const pilotBad = await pilotReport();
  const gateFalse = pilotBad.gateChecks.find((c) => c.code === 'NO_FALSE_MATCH');
  check('取り違えが1件でもあると、100件へ進む条件を満たさない',
    gateFalse !== undefined && gateFalse.ok === false);
  check('取り違えは、見つかった問題として画面に出る',
    pilotBad.issues.some((s) => s.includes('違う商品')));
  check('取り違えた出品は Route にならず PRODUCT_MATCH_FAILED として数える',
    (await dropoutSummary()).rows.some(
      (r) => r.listingKey === lk && r.reason === 'PRODUCT_MATCH_FAILED'));

  // 答えを直せる（見直して直すのは正しい行為）
  await recordMatchReview(lk, 'YAHOO_AUCTION', 'CORRECT_MATCH', '型番・色・サイズまで一致を確認');
  const afterGood = await matchReviewSummary();
  check('確認結果は後から直せる',
    afterGood.correct >= 1 && afterGood.rows.find((r) => r.listingKey === lk)?.verdict === 'CORRECT_MATCH');
  check('直したあとは重大扱いが解ける', afterGood.severeIssue === false);

  // ================================================================
  section('4. 次に自動化する工程を、実測した秒数で決める');

  check('工程は6つ', WORK_STEPS.length === 6, WORK_STEPS.map((s) => s.code).join('・'));
  check('すべての工程に「自動化しやすさ」が付いている',
    WORK_STEPS.every((s) => AUTOMATABLE_JA[String(s.automatable)] !== undefined));
  check(
    '商品発見と商品情報確認は「正規の取得手段が無いと難しい」に分類している',
    WORK_STEPS.find((s) => s.code === 'FIND')?.automatable === 'HARD'
    && WORK_STEPS.find((s) => s.code === 'INSPECT')?.automatable === 'HARD',
  );
  check(
    '無断で自動巡回しない方針が、工程の説明に書いてある',
    String(WORK_STEPS.find((s) => s.code === 'FIND')?.automatableNote ?? '').includes('無断'),
  );
  check('自動化しやすい工程の重みが1.0を超えない',
    Object.values(AUTOMATABLE_WEIGHT).every((w) => w > 0 && w <= 1));
  check('難しい工程の重みは1.0より小さい',
    AUTOMATABLE_WEIGHT.HARD < AUTOMATABLE_WEIGHT.EASY);
  check('旧い工程コードも今の6工程に寄せて数える',
    normalizeWorkStep('RECORD') === 'ENTRY' && normalizeWorkStep('IDENTIFY') === 'MODEL_CHECK');

  /*
   * 【記入見本の秒数を「実測」に混ぜていないか】
   * 画面の記入見本を取り込むと、出品は実market データではないと弾かれるのに
   * 作業秒数だけがログに残る。これを数えると、誰も作業していないのに
   * 「型番確認が26%」のような数字が出て、それを見て次に作るものを決めてしまう。
   */
  const wipeAuto = async () => {
    await run(`DELETE FROM listing_observations WHERE listing_key LIKE '%mP38AUTO%'`);
    await run(`DELETE FROM tracked_listings WHERE listing_key LIKE '%mP38AUTO%'`);
    await run(`DELETE FROM observation_work_log WHERE batch_id LIKE '%mP38AUTO%'`);
  };
  await wipeAuto();

  const beforeReal = await automationPlan();
  const sampleRows = await all(
    `SELECT COUNT(*) AS n FROM observation_work_log WHERE batch_id LIKE '%SAMPLE%'`,
  );
  if (Number(sampleRows[0]?.n ?? 0) > 0) {
    check(
      '記入見本の作業時間を「実測」として数えていない',
      beforeReal.excludedSeconds > 0,
      `除外 ${Math.round(beforeReal.excludedSeconds)}秒`,
    );
    check(
      '除外したことを黙って隠さず、画面の文言に書いている',
      beforeReal.verdictJa.includes('記入見本'),
    );
  }

  // ここから先は「実際に人が入力した1件」を用意して測る
  const autoUrl = 'https://jp.mercari.com/item/mP38AUTO001';
  await importListingObservations(
    `確認日時,市場,商品名,ブランド,型番,状態,出品価格,商品URL,販売状況,荷物サイズ,発送方法,入力秒数,発見秒数,情報確認秒数,型番確認秒数,状態確認秒数,記入秒数
2026-08-20 11:00,MERCARI,受け入れテスト用の商品,NIKE,P38AUTOONLY001,未使用に近い,42000,${autoUrl},出品中,60サイズ,らくらくメルカリ便,150,40,25,35,25,25`,
  );

  const plan = await automationPlan();
  check('工程ごとの実測がある', plan.measured, `合計${Math.round(plan.totalSeconds)}秒`);
  check(
    '数えているのは、実際に入力した出品の作業時間だけ',
    // 用意した出品は1件150秒。件数×150秒ぴったりなら、記入見本の分は混ざっていない。
    plan.measuredItems > 0 && Math.round(plan.totalSeconds) === plan.measuredItems * 150,
    `${plan.measuredItems}件 / ${Math.round(plan.totalSeconds)}秒`,
  );
  check('かかっている時間の順と、自動化して効く順を両方出している',
    plan.byTime.length === plan.byImpact.length && plan.byTime.length > 0);
  check('割合の合計が100%になる',
    Math.abs(plan.byTime.reduce((a, s) => a + s.share, 0) - 1) < 0.01);
  check('減らせる見込みの割合の合計が100%になる',
    Math.abs(plan.byImpact.reduce((a, s) => a + s.reducibleShare, 0) - 1) < 0.01);
  check('減らせる秒数は、実測の秒数を超えない',
    plan.byImpact.every((s) => s.reducibleSeconds <= s.seconds + 0.001));
  check('次に自動化すべき工程を3つまで出している', plan.top3Ja.length > 0 && plan.top3Ja.length <= 3);
  check(
    '時間が長いだけの理由で、自動化できない工程を1位にしていない',
    plan.byImpact[0].automatable !== 'HARD',
    `1位＝${plan.byImpact[0].ja}（${plan.byImpact[0].automatableJa}）`,
  );

  const autoSrc = await src('../lib/automation.ts');
  check(
    '「全部自動化すれば0分」という計算をしていない（残る時間を必ず出す）',
    /remainingHours/.test(autoSrc) && /remainRatio/.test(autoSrc),
  );
  check('自動化の計算に外部サイトへの通信が無い',
    !/fetch\(|axios|puppeteer|playwright/i.test(autoSrc));

  // 実市場の出品が入っている状態なので、1件あたりの秒数が出るはず
  check('1000件で換算した作業時間を出している',
    plan.roi.scaleItems === 1000);
  if (plan.roi.secondsPerItem !== null) {
    check('自動化しても作業時間が0にならない',
      (plan.roi.remainingHours ?? 0) > 0,
      `残り${plan.roi.remainingHours}時間`);
    check('減らせる時間が、もとの時間を超えない',
      (plan.roi.savedHours ?? 0) <= (plan.roi.manualHours ?? 0));
  } else {
    check('測れないときは、数字を作らずに「計算できません」と言う',
      plan.roi.manualHours === null && plan.roi.ja.includes('計算できません'));
  }

  await wipeAuto();
  const afterWipe = await all(
    `SELECT COUNT(*) AS n FROM tracked_listings WHERE listing_key LIKE '%mP38AUTO%'`,
  );
  check('自動化の検査で使った行を残していない', Number(afterWipe[0]?.n ?? 0) === 0);

  // ================================================================
  section('5. 集めたデータが壊れていないかを点検する');

  check('URLの末尾スラッシュの違いを同じものとして扱う',
    canonicalUrl('https://jp.mercari.com/item/m1/') === canonicalUrl('https://jp.mercari.com/item/m1'));
  check('広告用のパラメータが付いても同じものとして扱う',
    canonicalUrl('https://jp.mercari.com/item/m1?utm_source=x') === canonicalUrl('https://jp.mercari.com/item/m1'));
  check('httpとhttpsの違いを同じものとして扱う',
    canonicalUrl('http://jp.mercari.com/item/m1') === canonicalUrl('https://jp.mercari.com/item/m1'));
  check('www の有無を同じものとして扱う',
    canonicalUrl('https://www.jp.mercari.com/item/m1') === canonicalUrl('https://jp.mercari.com/item/m1'));
  check('別の商品ページは別のものとして扱う',
    canonicalUrl('https://jp.mercari.com/item/m1') !== canonicalUrl('https://jp.mercari.com/item/m2'));

  const integ = await integrityReport();
  check('点検の対象は実市場データだけ', integ.checked >= 1, `${integ.checked}件`);
  check('重大な問題と、気になる点を分けている',
    integ.issues.every((i) => typeof i.severe === 'boolean'));
  check('重大な問題の件数と、内訳の合計が一致する',
    integ.issues.filter((i) => i.severe).reduce((a, i) => a + i.count, 0) === integ.severeCount);

  const integSrc = await src('../lib/integrity.ts');
  check(
    '点検が、見つけたデータを勝手に消したり直したりしない',
    !/\b(UPDATE|DELETE)\s+/i.test(integSrc),
  );

  // わざと壊したデータを入れて、見つかることを確かめる
  await run(
    `UPDATE tracked_listings SET sold_price_known = 1, actual_sold_price = 90000
      WHERE listing_key = ? AND latest_state <> 'CONFIRMED_SOLD'`, [lk],
  );
  const integBad = await integrityReport();
  check('売り切れを確認していないのに成約価格が入っていたら見つける',
    integBad.issues.some((i) => i.code === 'SOLD_PRICE_WITHOUT_SOLD_STATE' && i.count >= 1));
  check('それは重大として扱う',
    integBad.issues.find((i) => i.code === 'SOLD_PRICE_WITHOUT_SOLD_STATE')?.severe === true);
  await run(
    `UPDATE tracked_listings SET sold_price_known = 0, actual_sold_price = NULL WHERE listing_key = ?`,
    [lk],
  );

  const integFixed = await integrityReport();
  check('直したら重大な問題として数えなくなる',
    !integFixed.issues.some((i) => i.code === 'SOLD_PRICE_WITHOUT_SOLD_STATE'));

  // ================================================================
  section('6. 100件へ進む条件（満たさないうちは進まない）');

  const p = await pilotReport();
  check('100件へ進む条件は7項目', p.gateChecks.length === 7, `${p.gateChecks.length}項目`);
  for (const g of REQUIRED_GATES) {
    check(`指示どおりの条件がある：${g}`, p.gateChecks.some((c) => c.code === g));
  }
  check('操作性の7項目とは別に持っている',
    p.checks.length === 7 && p.gateChecks.length === 7);
  check('両方そろわないと100件へ進めない',
    p.canProceed === (p.passedCount === p.totalCount && p.gatePassedCount === p.gateTotalCount));
  check('すべての条件に「いまの状態」と「目安」が書いてある',
    p.gateChecks.every((c) => c.valueJa.length > 0 && c.targetJa.length > 0));
  check('測れていないものを、そのまま合格にしていない',
    p.gateChecks.every((c) => !(c.unmeasurable && c.ok && c.valueJa.includes('未確認'))));

  const pilotSrc = await src('../lib/pilot.ts');
  check(
    '合格できないときに条件をゆるめる仕掛けを入れていない',
    !/relax|loosen|ignoreGate|forceProceed|skipGate/i.test(pilotSrc),
  );

  check('報告は①〜⑧の8項目', p.report8.length === 8, `${p.report8.length}項目`);
  check('報告の順番が①から⑧になっている',
    p.report8.every((r, i) => r.no === i + 1));
  check('すべての報告に中身がある',
    p.report8.every((r) => r.title.length > 0 && r.bodyJa.length > 0));
  check('②は「いちばん時間がかかった工程」',
    p.report8[1].title.includes('時間がかかった'));
  check('⑦は「次に自動化すべき工程」',
    p.report8[6].title.includes('自動化'));
  check('⑧は「100件へ進んでよいか」',
    p.report8[7].title.includes('100件'));

  check('型番・JAN・状態の取得率を出している',
    p.captureRates.length === 3
    && p.captureRates.map((c) => c.field).join(',') === 'model_number,jan,condition_rank');
  check('対象が0件のときに取得率を「100%」と書かない',
    p.captureRates.every((c) => c.total > 0 || c.rate === null));
  check('取得率は0〜100%の範囲に収まる',
    p.captureRates.every((c) => c.rate === null || (c.rate >= 0 && c.rate <= 1)));
  check('材料が足りず判断できなかった件数を数えている',
    typeof p.insufficientDataCount === 'number' && p.insufficientDataCount >= 0);
  check(
    '「利益が足りない」は、材料不足として数えない（判断はできているため）',
    p.insufficientDataCount
      === p.dropout.rows.filter((r) => r.reason !== 'INSUFFICIENT_MARGIN' && r.reason !== 'PRODUCT_MATCH_FAILED').length,
  );
  check('人の確認が必要な件数を数えている',
    p.humanReviewCount === p.match.unreviewed + p.match.uncertain);

  check('ファネル・脱落理由・答え合わせ・自動化・点検を、1つの報告にまとめている',
    p.funnel !== undefined && p.dropout !== undefined && p.match !== undefined
    && p.automation !== undefined && p.integrity !== undefined);

  // ================================================================
  section('7. まだ実取引をしない（READ / ANALYZE / SHADOW まで）');

  const noExec = assertNoExecutionPath();
  check('購入・出品・決済・発送の実行処理が存在しない', noExec.ok, noExec.message);
  const owned = await one(
    `SELECT COUNT(*) AS n FROM supplier_products WHERE ownership_state <> 'NOT_OWNED'`,
  );
  check('所有している商品は1件も無い', Number(owned?.n ?? 0) === 0);

  for (const f of ['../lib/dropout.ts', '../lib/matchreview.ts', '../lib/automation.ts', '../lib/integrity.ts']) {
    const s = await src(f);
    check(`${f.replace('../lib/', '')} に外部サイトへの通信が無い`,
      !/fetch\(|axios|puppeteer|playwright|got\(/i.test(s));
    check(`${f.replace('../lib/', '')} に自動ログインの処理が無い`,
      !/login|signin|password|cookie/i.test(s));
  }

  const actionsSrc = await src('../app/actions.ts');
  check(
    '画面から呼べる操作に、購入・出品・発送が増えていない',
    !/export async function (buy|purchase|listItem|ship|checkout|pay)[A-Za-z]*Action/i.test(actionsSrc),
  );
  check(
    '「違う商品だった」を選んだときに理由を必ず書かせる',
    /INCORRECT_MATCH' && note === ''/.test(actionsSrc),
  );

  const tablesRaw = await all(
    `SELECT name FROM sqlite_master WHERE type='table'`,
  );
  const tables = tablesRaw.map((t) => String(t.name));
  check(
    '購入・決済・発送を思わせるテーブルを作っていない',
    !tables.some((t) => /^(orders|purchases|payments|shipments|checkouts|carts)$/i.test(t)),
    tables.filter((t) => /order|payment|ship|purchase/i.test(t)).join('・') || '該当なし',
  );
  check('人の答えを入れる表は identity_match_reviews',
    tables.includes('identity_match_reviews'));

  // ================================================================
  // 後始末。テスト用の行は実市場データ100件に混ざってはいけない。
  await wipe();
  const leftover = await one(
    `SELECT COUNT(*) AS n FROM tracked_listings WHERE listing_key LIKE '%mP38%'`,
  );
  check('テスト用に入れた行を残していない', Number(leftover?.n ?? 0) === 0);

  // ================================================================
  const fin = await pilotReport();
  console.log(`\n${'='.repeat(72)}`);
  console.log('【現状の正直な数字】');
  console.log(`  実市場の出品：${fin.entered}件（目標 まず${fin.pilotSize}件）`);
  console.log(`  操作性：${fin.passedCount} / ${fin.totalCount}項目`);
  console.log(`  安全条件：${fin.gatePassedCount} / ${fin.gateTotalCount}項目`);
  console.log(`  100件へ進める：${fin.canProceed ? 'はい' : 'いいえ'}`);
  console.log(`  取り違え（FALSE MATCH）：${fin.match.incorrect}件`);
  console.log(`  Routeにならなかった：${fin.dropout.droppedCount}件`);
  console.log(`  次に自動化すべき工程：${fin.automation.byImpact[0]?.ja ?? '（未計測）'}`);
  console.log('='.repeat(72));

  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.8（まず10件のPILOT）の受け入れ条件をすべて満たしています。');
  console.log('※ 落ちた理由は必ず8分類のどれかに入れています。「その他」はありません。');
  console.log('※ 取り違え（違う商品を同じ商品として扱うこと）は重大として扱い、0件を求めます。');
  console.log('※ 購入・出品・決済・発送・自動ログイン・無断のスクレイピングは、いまも未実装です。');
}

main().catch((e) => { console.error(e); process.exit(1); });
