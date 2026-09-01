import { all } from '../lib/db/client';

/**
 * 送れる状態のメール文面を、そのまま貼れる形で並べて出す。
 *
 * 送信はしない。「宛先・件名・本文」を人が読める形にするだけ。
 * 使い方: npx tsx scripts/mail-list.ts
 */

async function main() {
  const rows = await all(
    `SELECT c.name, c.email, c.website, d.status, d.subject, d.body, d.blocked_reason
       FROM outreach_drafts d
       JOIN companies c ON c.id = d.company_id
      WHERE d.channel = 'EMAIL'
        AND c.data_origin = 'REAL_USER_OWNED'
        AND c.email IS NOT NULL AND TRIM(c.email) <> ''
        AND c.no_sales_flag = 0
        AND c.sales_excluded = 0
      ORDER BY d.status, c.id`
  );

  const ok = rows.filter((r) => String(r.status) === 'READY');
  const ng = rows.filter((r) => String(r.status) !== 'READY');

  console.log(`■ 送れる文面: ${ok.length}件 / 止まっている: ${ng.length}件\n`);

  ok.forEach((r, i) => {
    console.log('='.repeat(70));
    console.log(`【${i + 1}】${r.name}`);
    console.log(`宛先: ${r.email}`);
    console.log(`件名: ${r.subject ?? '（件名なし）'}`);
    console.log('-'.repeat(70));
    console.log(r.body);
    console.log('');
  });

  if (ng.length > 0) {
    console.log('='.repeat(70));
    console.log('■ 止まっているもの（理由つき）');
    for (const r of ng) console.log(`・${r.name}（${r.status}）… ${r.blocked_reason ?? '理由の記録なし'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
