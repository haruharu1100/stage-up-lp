/**
 * Phase 3.6（メルカリを第1実市場とする実データ検証）の受け入れテスト。
 *
 * 【このテストが守っているもの】
 * ユーザーからの指摘はこうだった。
 *
 *   「『CSV連携だから規約上安全』という考え方は違う。
 *     自分で公開画面を見て手動記録することと、
 *     事業者から正式に提供されたCSVデータフィードは別物なので、
 *     システム上も MANUAL_OBSERVATION と OFFICIAL_CSV_FEED は分離しておいた方がいい」
 *
 *   「メルカリSELL Feeについては公式情報を確認した上で VERIFIED へ変更できるようにしてください。
 *     ただし送料等は商品・発送方法で異なるため、一律固定値として勝手に確定しないでください」
 *
 * この2つが将来なし崩しに戻らないように、次を潰しにいく。
 *
 *   1. 「自分で見て記録したもの」を「事業者から提供されたもの」と同じ箱に入れること
 *   2. 確認していない送料まで「確認済み」の顔をさせること
 *   3. 手数料が変わったのに、古い料金で計算されたRouteを画面に残し続けること
 *   4. 購入・出品・決済・自動ログインの処理が紛れ込むこと
 */
import { all, one, run, migrate } from '../lib/db/client';
import {
  deriveFeeStatus, capFeeConfidence, estimatedCostFields, unverifiedRateFields,
  parseVerifiedFields, feeStatusCoverage,
  FEE_CONFIDENCE_CAP, FEE_CONFIDENCE_CAP_COST_ESTIMATED,
  VENUE_RATE_FIELDS, ITEM_COST_FIELDS,
} from '../lib/feestatus';
import { VERIFIED_FEES, applyVerifiedFees } from '../lib/feeverified';
import {
  judgeRealMarketData, sourceClassOf, REAL_DATA_SOURCES, SOURCE_CLASS_OF,
  SELF_OBSERVED_CAUTION, dataSourceJa,
} from '../lib/realdata';
import { decideNextAction } from '../lib/dailyreport';
import {
  importListingObservations, parseListingState, listingKeyOf, checkpointFor,
  validationProgress, listingsDue, workSummary, recordWork,
  LISTING_STATES, LISTING_STATE_JA, TRACK_CHECKPOINTS, WORK_STEPS,
  OBSERVATION_CSV_TEMPLATE, REQUIRED_FIRST,
} from '../lib/observation';
import { ensureReady } from '../lib/queries';
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

async function n(sql: string, args: unknown[] = []): Promise<number> {
  const r = await one(`SELECT COUNT(*) AS n FROM ${sql}`, args);
  return Number(r?.n ?? 0);
}

const NOW = Date.parse('2026-08-20T00:00:00.000Z');

async function main() {
  await migrate();
  await ensureReady();

  // ================================================================
  section('1. 取得手段の立場を分ける（自分で記録 vs 事業者提供）');

  check('自分で画面を見て記録したものは SELF_OBSERVED',
    sourceClassOf('MANUAL_OBSERVATION') === 'SELF_OBSERVED');
  check('事業者から正式に提供されたフィードは PROVIDED_BY_VENUE',
    sourceClassOf('OFFICIAL_CSV_FEED') === 'PROVIDED_BY_VENUE');
  check('公式APIも PROVIDED_BY_VENUE', sourceClassOf('API') === 'PROVIDED_BY_VENUE');
  check('この2つを同じ立場にまとめていない',
    SOURCE_CLASS_OF.MANUAL_OBSERVATION !== SOURCE_CLASS_OF.OFFICIAL_CSV_FEED);
  check('知らない取得方法は実データにしない（Fail Closed）',
    sourceClassOf('SCRAPING') === 'NOT_REAL' && sourceClassOf(null) === 'NOT_REAL');
  check('スクレイピングは正規の取得手段の一覧に入っていない',
    !REAL_DATA_SOURCES.has('SCRAPING') && !REAL_DATA_SOURCES.has('CRAWL'));

  const selfObserved = judgeRealMarketData({
    dataSource: 'MANUAL_OBSERVATION',
    sourceUrl: 'https://jp.mercari.com/item/m00000000001',
    observedAt: '2026-08-19T10:00:00.000Z',
    now: NOW,
  });
  check('自分で記録したものも実市場データとしては数える', selfObserved.isReal);
  check('ただし「正式提供ではない」と明記する',
    selfObserved.sourceClass === 'SELF_OBSERVED' && selfObserved.reason.includes('正式提供データではない'),
    selfObserved.reason);
  check('自分で記録したものには必ず注意書きが付く',
    selfObserved.caution === SELF_OBSERVED_CAUTION);

  const provided = judgeRealMarketData({
    dataSource: 'OFFICIAL_CSV_FEED',
    sourceNote: '事業者から提供されたデータフィード',
    observedAt: '2026-08-19T10:00:00.000Z',
    now: NOW,
  });
  check('正式提供データには注意書きを付けない', provided.isReal && provided.caution === null);
  check('正式提供と自分で記録では画面の文言が違う',
    dataSourceJa('OFFICIAL_CSV_FEED') !== dataSourceJa('MANUAL_OBSERVATION'),
    `${dataSourceJa('OFFICIAL_CSV_FEED')} ／ ${dataSourceJa('MANUAL_OBSERVATION')}`);
  check('手入力CSVは実市場データとして数えない',
    !judgeRealMarketData({ dataSource: 'CSV_MANUAL', sourceUrl: 'https://x', observedAt: '2026-08-19', now: NOW }).isReal);

  const next = decideNextAction(0, 0, 0);
  check('「規約上いちばん安全」という誤った説明をしない', !next.includes('安全な方法'), next);
  check('手で記録したものを「提供を受けたデータ」と言わない',
    next.includes('提供を受けたデータ」ではありません'));
  check('正規の取得手段を探す作業も同時に案内する',
    next.includes('公式API') || next.includes('データフィード'));

  // ================================================================
  section('2. 手数料は項目ごとに確認する（送料を勝手に確定しない）');

  check('「市場が決める料金」と「商品ごとに変わる実費」を別の一覧にしている',
    VENUE_RATE_FIELDS.includes('fee_rate') && ITEM_COST_FIELDS.includes('shipping_cost')
    && !(VENUE_RATE_FIELDS as readonly string[]).includes('shipping_cost'));

  // 送料が確認できていないのに行ごと確認済みにしていないか
  const partial = {
    is_estimated: 0,
    source_url: 'https://help.jp.mercari.com/guide/articles/65/',
    verified_at: '2026-08-20',
    verified_fields: JSON.stringify(['fee_rate', 'fixed_fee']),
    fee_rate: 0.1, fixed_fee: 200, shipping_cost: 800, packing_cost: 150,
  };
  const pd = deriveFeeStatus(partial, NOW);
  check('料率を確認できていれば確認済みになる', pd.status === 'VERIFIED', pd.status);
  check('確認していない送料は「推定値のまま」として挙がる',
    pd.estimatedCosts.includes('shipping_cost') && pd.estimatedCosts.includes('packing_cost'),
    pd.estimatedCosts.join('・'));
  check('その説明が日本語で画面に出る',
    pd.note.includes('送料') && pd.note.includes('推定値のまま'), pd.note);
  check('送料を一律固定したとは書かない', pd.note.includes('一律固定していない'));

  // 金額に効く料率が未確認のまま確認済みを名乗れないこと
  const rateMissing = deriveFeeStatus({
    is_estimated: 0, source_url: 'https://example.com', verified_at: '2026-08-20',
    verified_fields: JSON.stringify(['fee_rate']),
    fee_rate: 0.1, payment_fee_rate: 0.035,
  }, NOW);
  check('金額に効く料率が1つでも未確認なら確認済みにしない（Fail Closed）',
    rateMissing.status === 'ESTIMATED', `${rateMissing.status}：${rateMissing.note}`);

  const noFields = deriveFeeStatus({
    is_estimated: 0, source_url: 'https://example.com', verified_at: '2026-08-20',
    verified_fields: null, fee_rate: 0.1,
  }, NOW);
  check('確認した項目を1つも書いていなければ確認済みにしない',
    noFields.status === 'ESTIMATED', noFields.status);

  const zeroOnly = unverifiedRateFields({ fee_rate: 0.1, payment_fee_rate: 0 }, ['fee_rate']);
  check('0円の項目は確認済みを妨げないが、別枠で報告する',
    zeroOnly.blocking.length === 0 && zeroOnly.zeroUnchecked.includes('payment_fee_rate'));
  check('未確認の0円項目も画面に出す', pd.note.includes('0円として計算している'), pd.note);

  check('確認済みでも実費が推定なら信頼度は満点にならない',
    capFeeConfidence(100, 'VERIFIED', 2) === FEE_CONFIDENCE_CAP_COST_ESTIMATED,
    `${capFeeConfidence(100, 'VERIFIED', 2)}点まで`);
  check('全項目を確認できていれば満点を名乗れる',
    capFeeConfidence(100, 'VERIFIED', 0) === FEE_CONFIDENCE_CAP.VERIFIED);
  check('概算の天井は据え置き（ゆるめていない）',
    FEE_CONFIDENCE_CAP.ESTIMATED === 50 && FEE_CONFIDENCE_CAP.OUTDATED === 45
    && FEE_CONFIDENCE_CAP.UNKNOWN === 25);
  check('実費が推定のときの天井は概算より高く、満点より低い',
    FEE_CONFIDENCE_CAP.ESTIMATED < FEE_CONFIDENCE_CAP_COST_ESTIMATED
    && FEE_CONFIDENCE_CAP_COST_ESTIMATED < FEE_CONFIDENCE_CAP.VERIFIED,
    `概算${FEE_CONFIDENCE_CAP.ESTIMATED} < 実費推定${FEE_CONFIDENCE_CAP_COST_ESTIMATED} < 満点${FEE_CONFIDENCE_CAP.VERIFIED}`);

  check('確認済みでも1年以上経っていれば確認済みと言わない',
    deriveFeeStatus({
      is_estimated: 0, source_url: 'https://example.com', verified_at: '2024-01-01',
      verified_fields: JSON.stringify(['fee_rate']), fee_rate: 0.1,
    }, NOW).status === 'OUTDATED');

  // ================================================================
  section('3. メルカリの販売手数料が公式ページ由来で登録されている');

  const merc = VERIFIED_FEES.find((f) => f.venueCode === 'MERCARI' && f.side === 'SELL');
  check('台帳にメルカリSELLがある', Boolean(merc));
  check('販売手数料は10%', merc?.values.fee_rate === 0.1, String(merc?.values.fee_rate));
  check('出典が公式ヘルプのURL',
    merc?.sourceUrl === 'https://help.jp.mercari.com/guide/articles/65/', merc?.sourceUrl);
  check('確認日が入っている', merc?.verifiedAt === '2026-08-20', merc?.verifiedAt);
  check('送料を確認済み項目に入れていない',
    !merc?.verifiedFields.includes('shipping_cost'), merc?.verifiedFields.join('・'));
  check('台帳の「金額を入れた項目」と「確認したと書いた項目」が一致する',
    Object.keys(merc?.values ?? {}).sort().join(',') === [...(merc?.verifiedFields ?? [])].sort().join(','));

  const row = (await all(
    `SELECT * FROM venue_fee_profiles WHERE venue_code='MERCARI' AND side='SELL'`))[0];
  check('DBに反映されている（料率10%）', Number(row?.fee_rate) === 0.1, String(row?.fee_rate));
  check('DBの状態が確認済みになっている', String(row?.fee_status) === 'VERIFIED', String(row?.fee_status));
  check('出典URLと確認日がDBに入っている',
    String(row?.source_url ?? '').includes('help.jp.mercari.com') && Boolean(row?.verified_at));
  check('取得元が公式ページとして記録されている',
    String(row?.source_type) === 'OFFICIAL_PAGE', String(row?.source_type));
  check('確認した項目がDBに残っている',
    parseVerifiedFields(row?.verified_fields).includes('fee_rate'),
    parseVerifiedFields(row?.verified_fields).join('・'));
  check('送料はDB上でも確認済みにしていない',
    !parseVerifiedFields(row?.verified_fields).includes('shipping_cost'));
  check('送料の値そのものは書き換えていない（推定値のまま残っている）',
    Number(row?.shipping_cost) > 0 && estimatedCostFields(row, parseVerifiedFields(row?.verified_fields)).includes('shipping_cost'));
  check('手数料の版が「確認済み」を表す fV- で始まる',
    String(row?.fee_version).startsWith('fV-'), String(row?.fee_version));

  const again = await applyVerifiedFees();
  const row2 = (await all(
    `SELECT fee_rate, fixed_fee, fee_version FROM venue_fee_profiles WHERE venue_code='MERCARI' AND side='SELL'`))[0];
  check('何度反映しても結果が変わらない（冪等）',
    again.skipped.length === 0 && Number(row2?.fee_rate) === 0.1
    && String(row2?.fee_version) === String(row?.fee_version));

  const buyRow = (await all(
    `SELECT fee_status FROM venue_fee_profiles WHERE venue_code='MERCARI' AND side='BUY'`))[0];
  check('確認できていない購入側まで確認済みにしていない',
    String(buyRow?.fee_status) !== 'VERIFIED', String(buyRow?.fee_status));

  const cov = await feeStatusCoverage();
  check('確認済みの手数料が1件以上ある', cov.verified >= 1, `${cov.verified} / ${cov.total}件`);
  check('まだ大半は概算のままだと正直に出す', cov.estimated > cov.verified,
    `概算${cov.estimated}件 / 確認済み${cov.verified}件`);
  check('確認済みの割合はまだ卒業条件（90%）に届かない', cov.verifiedRatio < 0.9,
    `${(cov.verifiedRatio * 100).toFixed(1)}%`);

  // ================================================================
  section('4. 手数料が変わったときの扱い');

  const changed = await n(`fee_change_log WHERE venue_code='MERCARI' AND side='SELL'`);
  check('料金を変えたことが履歴に残っている', changed >= 1, `${changed}件`);

  const logs = await all(
    `SELECT old_fee_version, new_fee_version FROM fee_change_log WHERE venue_code='MERCARI' AND side='SELL'`);
  check('概算(fE-)から実額(fV-)への変更として記録されている',
    logs.some((l) => String(l.old_fee_version).startsWith('fE-') && String(l.new_fee_version).startsWith('fV-')));

  // 過去の判断は当時の版のまま残っていること（ルール24）
  const shadowOld = await n(
    `route_shadow_trades WHERE sell_venue_code='MERCARI' AND sell_fee_version = ?`,
    [String(logs[0]?.old_fee_version ?? '')]);
  check('答え合わせ用のSHADOWは当時の版を持ったまま（過去を書き換えない）', shadowOld >= 1, `${shadowOld}件`);

  // 「いま狙える機会」は古い料金のまま残さないこと
  const feeNow = await all('SELECT venue_code, side, fee_version FROM venue_fee_profiles');
  const vset = new Set(feeNow.map((f) => `${f.venue_code}|${f.side}|${f.fee_version}`));
  const staleRoutes = (await all(
    'SELECT buy_venue_code, sell_venue_code, buy_fee_version, sell_fee_version FROM arbitrage_routes'))
    .filter((r) => !vset.has(`${r.buy_venue_code}|BUY|${r.buy_fee_version}`)
                || !vset.has(`${r.sell_venue_code}|SELL|${r.sell_fee_version}`));
  check('古い料金で計算されたRouteが残っていない', staleRoutes.length === 0, `${staleRoutes.length}件`);

  // ================================================================
  section('5. 出品を1件ずつ追いかける（上書きしない）');

  /*
   * ここから先はテスト用の観測を実際に取り込む。
   * 実市場データ100件の中に混ざらないよう、前後で必ず消す。
   * URLに TEST / SAMPLE の文字は入れない（入れると実データ判定を素通りしてしまい、
   * 「実データとして数える経路」そのものを検査できなくなる）。
   */
  const wipe = async () => {
    await run(`DELETE FROM listing_observations WHERE listing_key LIKE '%mACCEPT%'`);
    await run(`DELETE FROM tracked_listings WHERE listing_key LIKE '%mACCEPT%'`);
    await run(`DELETE FROM observation_work_log WHERE batch_id = 'ACCEPT'`);
  };
  await wipe();

  const realBefore = (await validationProgress(100)).realListings;

  check('状態は5つだけ（推測を状態にしていない）',
    LISTING_STATES.length === 5 && LISTING_STATES.includes('REMOVED_UNKNOWN'),
    LISTING_STATES.join('・'));
  check('追跡の予定は 初回→24時間→3日→7日→14日→30日',
    TRACK_CHECKPOINTS.map((c) => c.hours).join(',') === '0,24,72,168,336,720');
  check('7日後あたりの観測は「7日後」に割り当てられる', checkpointFor(170) === 'D7', checkpointFor(170));
  check('予定から外れた観測も捨てない（EXTRA として残す）', checkpointFor(500) === 'EXTRA');
  check('広告用のパラメータが付いても同じ出品として扱う',
    listingKeyOf('https://jp.mercari.com/item/m1?afid=99') === listingKeyOf('https://jp.mercari.com/item/m1/'));
  check('URLでないものは受け付けない', listingKeyOf('メルカリの靴') === null);

  const url1 = 'https://jp.mercari.com/item/mACCEPT0000001';
  const first = await importListingObservations(
    `確認日時,市場,商品名,ブランド,型番,状態,出品価格,商品URL,販売状況,入力秒数
2026-08-01 10:00,MERCARI,ナイキ エアジョーダン1,NIKE,DZ5485-612,未使用に近い,105000,${url1},出品中,50`,
  );
  check('観測を1件記録できた', first.observations === 1 && first.newListings === 1,
    `観測${first.observations}件／新規${first.newListings}件`);
  check('自分で見て記録したデータとして数えている',
    first.selfObservedRows === 1 && first.providedRows === 0);
  check('型番があるので「商品を特定できる」に数えている', first.identifiableRows === 1);

  const second = await importListingObservations(
    `確認日時,商品URL,販売状況,出品価格
2026-08-08 10:00,${url1},出品中,98000`,
  );
  check('2回目は商品名を書かなくても受け付ける', second.observations === 1 && second.invalid === 0,
    second.errors.map((e) => e.reason).join('／'));

  const obs1 = await all(
    'SELECT observed_at, listing_price, listing_state, checkpoint, price_delta FROM listing_observations WHERE listing_key = ? ORDER BY observed_at',
    [listingKeyOf(url1)]);
  check('同じURLの観測が上書きされず2件積まれている', obs1.length === 2, `${obs1.length}件`);
  check('1回目の価格が残っている（上書きされていない）', Number(obs1[0]?.listing_price) === 105000,
    String(obs1[0]?.listing_price));
  check('値下げが「価格が変わった」として記録される',
    String(obs1[1]?.listing_state) === 'PRICE_CHANGED' && Number(obs1[1]?.price_delta) === -7000,
    `${obs1[1]?.listing_state} / ${obs1[1]?.price_delta}`);
  check('7日後の観測として割り当てられている', String(obs1[1]?.checkpoint) === 'D7',
    String(obs1[1]?.checkpoint));

  const dup = await importListingObservations(
    `確認日時,商品URL,販売状況\n2026-08-08 10:00,${url1},出品中`);
  const obsAfterDup = await all('SELECT id FROM listing_observations WHERE listing_key = ?', [listingKeyOf(url1)]);
  check('同じ時刻の同じ観測を2回入れても増えない（冪等）', obsAfterDup.length === 2, `${obsAfterDup.length}件`);

  check('初回に商品名・価格・状態が無い行は受け付けない',
    REQUIRED_FIRST.includes('product_name') && REQUIRED_FIRST.includes('listing_price')
    && REQUIRED_FIRST.includes('condition'));
  const badFirst = await importListingObservations(
    `確認日時,商品URL,販売状況\n2026-08-01 10:00,https://jp.mercari.com/item/mACCEPT0000009,出品中`);
  check('初回で必須項目が欠けていれば止める（Fail Closed）',
    badFirst.invalid === 1 && badFirst.observations === 0,
    badFirst.errors.map((e) => e.reason).join('／'));

  // ================================================================
  section('6. 「消えた＝売れた」にしない・売れた値段を推測しない');

  check('「消えた」は売れた扱いにしない', parseListingState('消えた') === 'REMOVED_UNKNOWN');
  check('「見つからない」も売れた扱いにしない', parseListingState('見つからない') === 'REMOVED_UNKNOWN');
  check('「404」も売れた扱いにしない', parseListingState('404') === 'REMOVED_UNKNOWN');
  check('「削除」も売れた扱いにしない', parseListingState('削除') === 'REMOVED_UNKNOWN');
  check('売り切れ表示を見たときだけ売れた扱い', parseListingState('売り切れ') === 'CONFIRMED_SOLD');
  check('書いていなければ不明のまま（勝手に出品中にしない）', parseListingState('') === null);
  check('読めない言葉を推測で状態にしない', parseListingState('たぶん売れた気がする') === null);
  check('日本語の説明が5つとも用意されている',
    LISTING_STATES.every((s) => Boolean(LISTING_STATE_JA[s])));

  const url2 = 'https://jp.mercari.com/item/mACCEPT0000002';
  await importListingObservations(
    `確認日時,市場,商品名,型番,状態,出品価格,商品URL,販売状況
2026-08-01 10:00,MERCARI,消えた商品の例,ABC-123,未使用に近い,50000,${url2},出品中`);
  const gone = await importListingObservations(
    `確認日時,商品URL,販売状況,成約価格\n2026-08-02 10:00,${url2},消えた,50000`);
  const goneRow = (await all('SELECT * FROM tracked_listings WHERE listing_key = ?', [listingKeyOf(url2)]))[0];
  check('ページが消えただけでは売れたことにしない',
    String(goneRow?.latest_state) === 'REMOVED_UNKNOWN', String(goneRow?.latest_state));
  check('消えた出品に成約価格を書かれても採用しない',
    Number(goneRow?.sold_price_known) === 0 && goneRow?.actual_sold_price === null,
    `known=${goneRow?.sold_price_known} / price=${goneRow?.actual_sold_price}`);
  check('採用しなかったことを黙らずに知らせる',
    gone.warnings.some((w) => w.reason.includes('採用しませんでした')),
    gone.warnings.map((w) => w.reason).join('／'));

  const url3 = 'https://jp.mercari.com/item/mACCEPT0000003';
  await importListingObservations(
    `確認日時,市場,商品名,型番,状態,出品価格,商品URL,販売状況
2026-08-01 10:00,MERCARI,売り切れ商品の例,DEF-456,目立った傷や汚れなし,100000,${url3},出品中`);
  const soldNoPrice = await importListingObservations(
    `確認日時,商品URL,販売状況\n2026-08-05 10:00,${url3},売り切れ`);
  const soldRow = (await all('SELECT * FROM tracked_listings WHERE listing_key = ?', [listingKeyOf(url3)]))[0];
  check('売り切れは確認できたと記録する',
    String(soldRow?.latest_state) === 'CONFIRMED_SOLD', String(soldRow?.latest_state));
  check('売れた値段を出品価格で埋めない（不明のまま）',
    Number(soldRow?.sold_price_known) === 0 && soldRow?.actual_sold_price === null,
    `known=${soldRow?.sold_price_known} / price=${soldRow?.actual_sold_price}`);
  check('出品価格100,000円が成約価格として紛れ込んでいない',
    Number(soldRow?.latest_listing_price) === 100000 && soldRow?.actual_sold_price === null);
  check('「値段は分からない」と画面に伝える',
    soldNoPrice.warnings.some((w) => w.reason.includes('出品価格で代用していません')),
    soldNoPrice.warnings.map((w) => w.reason).join('／'));

  const url4 = 'https://jp.mercari.com/item/mACCEPT0000004';
  await importListingObservations(
    `確認日時,市場,商品名,型番,状態,出品価格,商品URL,販売状況
2026-08-01 10:00,MERCARI,成約価格まで分かった例,GHI-789,新品、未使用,70000,${url4},出品中`);
  await importListingObservations(
    `確認日時,商品URL,販売状況,成約価格,成約日\n2026-08-06 10:00,${url4},売り切れ,64000,2026-08-06`);
  const knownRow = (await all('SELECT * FROM tracked_listings WHERE listing_key = ?', [listingKeyOf(url4)]))[0];
  check('確認できた成約価格だけを採用する',
    Number(knownRow?.sold_price_known) === 1 && Number(knownRow?.actual_sold_price) === 64000,
    String(knownRow?.actual_sold_price));
  check('出品価格と成約価格を別々に持っている',
    Number(knownRow?.first_listing_price) === 70000 && Number(knownRow?.actual_sold_price) === 64000);

  // ================================================================
  section('7. テストデータを実績に混ぜない');

  const sample = await importListingObservations(OBSERVATION_CSV_TEMPLATE);
  check('画面の記入例をそのまま取り込んでも実市場データにはしない',
    sample.realRows === 0, `${sample.realRows}件`);
  check('記入例を数えなかった理由を出す',
    sample.warnings.some((w) => w.reason.includes('実市場データとして数えません')),
    sample.warnings[0]?.reason ?? '');
  await run(`DELETE FROM listing_observations WHERE listing_key LIKE '%SAMPLE%'`);
  await run(`DELETE FROM tracked_listings WHERE listing_key LIKE '%SAMPLE%'`);

  const prog = await validationProgress(100);
  check('目標は100件', prog.goal === 100);
  check('実データとして数えているのは今入れた4件だけ',
    prog.realListings === realBefore + 4, `${prog.realListings}件（前 ${realBefore}件）`);
  check('売り切れ確認は2件、そのうち値段まで分かったのは1件',
    prog.confirmedSold === 2 && prog.soldPriceKnown === 1,
    `売り切れ${prog.confirmedSold}件／値段判明${prog.soldPriceKnown}件`);
  check('消えた1件を売れた側に数えていない', prog.removedUnknown === 1, `${prog.removedUnknown}件`);
  check('7日後まで見届けたものを数えられる', prog.done7d === 1, `${prog.done7d}件`);
  check('30日後まで見届けたものはまだ0件', prog.done30d === 0, `${prog.done30d}件`);

  const due = await listingsDue(Date.parse('2026-09-30T00:00:00.000Z'), 50);
  check('売り切れを確認した出品は「次に見る」に出さない',
    !due.some((d) => d.listingKey === listingKeyOf(url3)));
  check('まだ追い切れていない出品を「そろそろ確認」として出す',
    due.some((d) => d.listingKey === listingKeyOf(url1)),
    due.map((d) => d.checkpointJa).join('／'));

  // ================================================================
  section('8. 人間の作業時間を実測する');

  const before = await workSummary(100, 0);
  check('工程は5つ', WORK_STEPS.length === 5, WORK_STEPS.map((s) => s.ja).join('・'));
  check('CSVに書いた入力秒数を拾っている', first.entrySecondsTotal === 50 && first.entrySecondsRows === 1,
    `${first.entrySecondsTotal}秒 / ${first.entrySecondsRows}件`);

  await recordWork('ACCEPT', 'FIND', 600, 10, '受入テスト');
  await recordWork('ACCEPT', 'RECORD', 300, 10, '受入テスト');
  const after = await workSummary(100, 0);
  check('工程ごとの時間を集計できる', after.measured);
  check('いちばん時間を食っている工程を名指しできる',
    after.slowest?.step === 'FIND', after.slowest?.ja ?? '不明');
  check('感覚ではなく秒数で言う',
    after.note.includes('感覚ではなく'), after.note);
  check('100件そろえるのに必要な時間を見積もれる',
    (after.estimatedHoursTo100 ?? 0) > 0, `${after.estimatedHoursTo100?.toFixed(1)}時間`);
  check('1件も計測していなければ「まだ言えない」と答える',
    before.measured === false || before.note.length > 0);

  await wipe();
  const cleaned = await validationProgress(100);
  check('受入テストのデータを実績に残していない',
    cleaned.realListings === realBefore, `${cleaned.realListings}件`);

  // ================================================================
  section('9. まだ何も実行しない');

  const noExec = assertNoExecutionPath();
  check('購入・出品・決済・発送の実行処理が存在しない', noExec.ok, noExec.message);
  const owned = await n(`supplier_products WHERE ownership_state <> 'NOT_OWNED'`);
  check('所有している商品は1件も無い', owned === 0, `${owned}件`);
  const strongEstimated = await n(`arbitrage_routes WHERE decision='STRONG_BUY' AND fees_estimated=1`);
  check('概算の手数料のまま STRONG BUY になっているRouteが無い', strongEstimated === 0, `${strongEstimated}件`);

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log('【現状の正直な数字】');
  console.log(`  メルカリ販売手数料：${Number(row?.fee_rate) * 100}%（${String(row?.fee_status)}）`);
  console.log(`  　出典：${String(row?.source_url)}（確認日 ${String(row?.verified_at)}）`);
  console.log(`  　送料・梱包費・返品損失は推定値のまま（商品と発送方法で変わるため確定しない）`);
  console.log(`  手数料の実額確認：${cov.verified} / ${cov.total}件`);
  const realShadow = await n('route_shadow_trades WHERE real_market_data = 1');
  console.log(`  実市場データのSHADOW：${realShadow}件（目標100件）`);
  console.log('='.repeat(72));

  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('Phase 3.6（メルカリ実市場検証の土台）の受け入れ条件をすべて満たしています。');
  console.log('※ 実市場データはまだ集めていません。購入・出品・決済・自動ログインは未実装です。');
}

main().catch((e) => { console.error(e); process.exit(1); });
