import { migrate, all } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import { validationProgress, listingsDue, workSummary, LISTING_STATE_JA, TRACK_CHECKPOINTS, type ListingState } from '../lib/observation';
import { precisionReport } from '../lib/precision';
import { feeStatusCoverage, FEE_STATUS_JA, type FeeStatus } from '../lib/feestatus';
import { shippingAccuracy } from '../lib/observation';
import { pilotReport } from '../lib/pilot';
import { peekPhase4Gate } from '../lib/gate';

/**
 * 実市場での答え合わせが、いまどこまで進んでいるか（Phase 3.6・§14）。
 *
 *   npm run validation
 *
 * 画面（/validation）と同じ数字を、端末でも見られるようにしたもの。
 * 数字を良く見せる加工は一切しない。0件なら0件と出す。
 */

const line = (label: string, value: string) =>
  console.log(`  ${label.padEnd(28, '　')} ${value}`);

async function main() {
  await migrate();
  await ensureReady();

  const p = await validationProgress(100);
  const cov = await feeStatusCoverage();
  const prec = await precisionReport(30, true);
  const work = await workSummary(100, p.realListings);
  const gate = await peekPhase4Gate();
  const due = await listingsDue(Date.now(), 10);

  console.log('='.repeat(72));
  console.log('【実市場での答え合わせ REAL MARKET VALIDATION】');
  console.log('='.repeat(72));

  /*
   * まず10件（PILOT）。ここを通るまで100件へ進まない。
   * 件数のカードより先に出す。順番そのものが「何を先に見るべきか」の指示になる。
   */
  const pilot = await pilotReport();
  console.log(`\n[まず${pilot.pilotSize}件の操作性テスト]`);
  for (const c of pilot.checks) {
    const mark = c.ok ? '○' : c.unmeasurable ? '△' : '×';
    line(`${mark} ${c.ja}`, `${c.valueJa}（目安 ${c.targetJa}）`);
  }
  line('合格', `${pilot.passedCount} / ${pilot.totalCount} 項目`);
  console.log(`  結論：${pilot.verdictJa}`);
  console.log(`  ${pilot.automateNextJa}`);
  if (pilot.issues.length > 0) {
    console.log('  見つかった問題：');
    for (const t of pilot.issues) console.log(`   ・${t}`);
  }
  line('入力の合計時間', pilot.rowsWithSeconds === 0 ? '未計測'
    : `${Math.round(pilot.totalSeconds / 60)}分（${pilot.rowsWithSeconds}件分）`);
  line('1件あたりの平均', pilot.avgSecondsPerItem === null ? '未計測'
    : `${pilot.avgSecondsPerItem}秒 → 100件でおよそ ${Math.round(pilot.avgSecondsPerItem * 100 / 60)}分`);

  // 検証ファネル。「100件」だけを追わないための表。
  const f = pilot.funnel;
  console.log('\n[検証ファネル]');
  for (const s of f.stages) {
    const top = s.rateFromTop === null ? '—' : `${(s.rateFromTop * 100).toFixed(0)}%`;
    const prev = s.rateFromPrev === null ? '—' : `${(s.rateFromPrev * 100).toFixed(0)}%`;
    line(s.ja, `${s.count} 件（入口比 ${top}／前段比 ${prev}${s.lost > 0 ? `／落ち ${s.lost}件` : ''}）`);
  }
  console.log(`  ${f.bottleneckJa}`);
  console.log('  ※ STRONG BUY候補を増やすために判定を甘くすることはしません。');

  if (f.byCategory.length > 0) {
    console.log('\n[カテゴリの偏り]');
    for (const c of f.byCategory) line(c.category, `${c.count} 件（${(c.share * 100).toFixed(0)}%）`);
    if (f.topCategoryShare !== null && f.topCategoryShare > 0.6) {
      console.log('  ⚠ 1種類に偏っています。他のカテゴリでも同じ結果になるとは限りません。');
    }
  }

  const ship = await shippingAccuracy();
  console.log('\n[送料の精度]');
  line('荷物サイズが分かっている', `${ship.withPackageSize} / ${ship.total} 件`);
  line('発送方法が分かっている', `${ship.withShippingMethod} / ${ship.total} 件`);
  line('送料の負担者が分かっている', `${ship.withPayer} / ${ship.total} 件`);
  line('見込みと実額を比べられる', `${ship.comparable} 件`);
  console.log(`  ${ship.verdictJa}`);

  console.log('\n[集めた出品]');
  line('目標', `${p.goal} 件`);
  line('いま', `${p.realListings} / ${p.goal} 件`);
  line('　商品を特定できるもの', `${p.identifiable} 件`);
  line('　型番なし・一点物', `${p.unidentifiable} 件（ここばかりで100件にしない）`);
  line('積み上がった観測', `${p.observations} 回`);

  console.log('\n[追跡の進み]');
  line('7日後まで見届けた', `${p.done7d} 件`);
  line('30日後まで見届けた', `${p.done30d} 件`);
  line('売り切れを確認できた', `${p.confirmedSold} 件`);
  line('　うち成約価格まで判明', `${p.soldPriceKnown} 件`);
  line('ページが見当たらない', `${p.removedUnknown} 件（売れたかどうかは不明）`);
  console.log(`  ※ 追跡予定：${TRACK_CHECKPOINTS.map((c) => c.ja).join(' → ')}`);

  if (Object.keys(p.byState).length > 0) {
    console.log('\n[いまの状態の内訳]');
    for (const [k, v] of Object.entries(p.byState)) {
      line(LISTING_STATE_JA[k as ListingState] ?? k, `${v} 件`);
    }
  }

  if (due.length > 0) {
    console.log('\n[そろそろ確認する時期のもの]');
    for (const d of due) {
      console.log(`  ${d.checkpointJa}（${Math.floor(d.overdueHours / 24)}日遅れ） ${d.productName ?? d.productUrl}`);
    }
  }

  console.log('\n[メルカリの手数料]');
  const m = cov.rows.find((r) => r.venue_code === 'MERCARI' && r.side === 'SELL');
  line('販売手数料の状態', FEE_STATUS_JA[String(m?.fee_status ?? 'UNKNOWN') as FeeStatus]);
  if (m?.source_url) line('出典', `${m.source_url}（確認日 ${m.verified_at ?? '不明'}）`);
  line('全体の確認済み', `${cov.verified} / ${cov.total} 件（${(cov.verifiedRatio * 100).toFixed(1)}%）`);
  console.log('  ※ 送料・梱包費は商品と発送方法で変わるため、一律固定せず推定値のままにしています。');

  console.log('\n[STRONG BUY の的中率]');
  if (prec.strongBuy.precision === null) {
    line('的中率', '測定不能');
    console.log(`  理由：${prec.note}`);
  } else {
    line('的中率', `${(prec.strongBuy.precision * 100).toFixed(1)}%（${prec.strongBuy.decidedBuy}件で集計）`);
    line('95%下限', prec.strongBuy.precisionLower === null ? '不明' : `${(prec.strongBuy.precisionLower * 100).toFixed(1)}%`);
    line('買うと言って損した割合', prec.strongBuy.falsePositiveRate === null ? '不明' : `${(prec.strongBuy.falsePositiveRate * 100).toFixed(1)}%`);
  }

  /*
   * 予測と実績の比べ方（§16）。
   * 理論値・補正後・保守のどれが実績に近かったかを見る。
   * 実績が無いうちは「まだ比べられない」と書く。近そうな方を選んで書かない。
   */
  console.log('\n[予測と実績の比較]');
  const rows = await all(`
    SELECT s.raw_expected_roi, s.calibrated_expected_roi, s.conservative_expected_roi,
           e.actual_roi
      FROM shadow_evaluations e
      JOIN route_shadow_trades s ON s.id = e.shadow_id
     WHERE e.horizon_days = 30 AND e.outcome <> 'PENDING'
       AND e.real_market_data = 1 AND e.actual_roi IS NOT NULL
  `);
  if (rows.length === 0) {
    console.log('  実市場データで答え合わせが済んだものが0件のため、まだ比べられません。');
  } else {
    const err = (k: string) => {
      const v = rows.filter((r) => r[k] !== null).map((r) => Math.abs(Number(r[k]) - Number(r.actual_roi)));
      return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
    };
    const f = (n: number | null) => (n === null ? '比べられない' : `平均で ${(n * 100).toFixed(1)}ポイントずれ`);
    line('理論値（RAW）', f(err('raw_expected_roi')));
    line('補正後（CALIBRATED）', f(err('calibrated_expected_roi')));
    line('保守（CONSERVATIVE）', f(err('conservative_expected_roi')));
    line('比べた件数', `${rows.length} 件`);
  }

  console.log('\n[人間の作業時間]');
  if (!work.measured) {
    console.log(`  ${work.note}`);
  } else {
    line('1件あたり', work.secondsPerRow === null ? '不明' : `${Math.round(work.secondsPerRow)} 秒`);
    for (const s of work.byStep) {
      line(`　${s.ja}`, `${Math.round(s.seconds)}秒 / ${s.rows}件${s.secondsPerRow === null ? '' : `（1件 ${Math.round(s.secondsPerRow)}秒）`}`);
    }
    line('100件まで残り', work.estimatedHoursTo100 === null ? '不明' : `およそ ${work.estimatedHoursTo100.toFixed(1)} 時間`);
    console.log(`  ${work.note}`);
  }

  console.log('\n[実購入に進めるか]');
  line('卒業条件', `${gate.passedCount} / ${gate.totalCount} 項目`);
  line('結論', gate.verdictJa);
  console.log('  ※ 100件そろっても、それだけでは購入しません。必ずこの14項目で判定します。');
  console.log('  ※ 購入・出品・決済・発送・自動ログインの処理は、このシステムに存在しません。');

  console.log(`\n${'='.repeat(72)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
