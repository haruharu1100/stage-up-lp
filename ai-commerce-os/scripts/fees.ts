import { migrate } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import { syncFeeVersions } from '../lib/fees';
import { applyVerifiedFees } from '../lib/feeverified';
import { FEE_FIELD_JA, FEE_STATUS_JA, feeStatusCoverage, type FeeStatus } from '../lib/feestatus';

/**
 * 手数料の確認状況を出す（Phase 3.6）。
 *
 *   npm run fees
 *
 * 「どの市場のどの手数料が、公式に確認できていて、どれがまだ当て推量なのか」を1画面で出す。
 * 手数料は利益額そのものを動かすので、ここが曖昧なままだと全部の判断が曖昧になる。
 */

async function main() {
  await migrate();
  await ensureReady();

  const applied = await applyVerifiedFees();
  const changes = await syncFeeVersions();
  const cov = await feeStatusCoverage();

  console.log('='.repeat(72));
  console.log('【手数料の確認状況】');
  console.log('='.repeat(72));

  console.log('\n[公式ページで確認できたもの]');
  if (applied.detail.length === 0) {
    console.log('  まだ1件もありません。');
  }
  for (const d of applied.detail) {
    console.log(`  ${d.venueCode} ${d.side}`);
    console.log(`    確認できた項目：${d.verified.map((k) => FEE_FIELD_JA[k] ?? k).join('・')}`);
    // ここを黙って出さないと「行ごと確認済み」に見えてしまう。必ず併記する。
    console.log(
      `    推定値のまま：${d.stillEstimated.length === 0
        ? 'なし'
        : d.stillEstimated.map((k) => FEE_FIELD_JA[k] ?? k).join('・')
          + '（商品・発送方法で変わるため一律固定していません）'}`,
    );
  }
  for (const s of applied.skipped) {
    console.log(`  [反映せず] ${s.venueCode} ${s.side}：${s.reason}`);
  }

  console.log('\n[全体]');
  const line = (label: string, n: number) =>
    console.log(`  ${label.padEnd(20, '　')} ${String(n).padStart(3)} 件`);
  line(FEE_STATUS_JA.VERIFIED, cov.verified);
  line(FEE_STATUS_JA.ESTIMATED, cov.estimated);
  line(FEE_STATUS_JA.OUTDATED, cov.outdated);
  line(FEE_STATUS_JA.UNKNOWN, cov.unknown);
  console.log(`  確認済みの割合：${(cov.verifiedRatio * 100).toFixed(1)}%（卒業条件は90%以上）`);

  console.log('\n[1件ずつ]');
  for (const r of cov.rows) {
    const mark = r.fee_status === 'VERIFIED' ? '✓' : ' ';
    console.log(`  ${mark} ${`${r.venue_code} ${r.side}`.padEnd(22, ' ')} ${FEE_STATUS_JA[r.fee_status as FeeStatus]}`);
    console.log(`      ${r.status_note ?? ''}`);
    if (r.source_url) console.log(`      出典：${r.source_url}（確認日 ${r.verified_at ?? '不明'}）`);
  }

  if (changes.length > 0) {
    console.log('\n[料金が変わったもの]');
    for (const c of changes) {
      console.log(`  ${c.venueCode} ${c.side}：${c.oldVersion} → ${c.newVersion}`);
      console.log(`      変わった項目：${c.changedFields.map((k) => FEE_FIELD_JA[k] ?? k).join('・') || '不明'}`);
    }
    console.log('  ※ 過去のRouteは当時の料金のまま残します（判断を後から書き換えない）。');
  }

  console.log('\n※ 手数料の数字は人間が公式ページを見て登録します。AIが推測で埋めることはありません。');
}

main().catch((e) => { console.error(e); process.exit(1); });
