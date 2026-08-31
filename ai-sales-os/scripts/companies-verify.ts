import { migrate } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { enrichActionLabel, enrichPending, websiteVerificationSummary } from '../lib/sales/enrich';

/**
 * 会社のホームページが「本当にその会社のものか」を確かめる（読むだけ）。
 *
 * ★別会社のHPを掴んだまま営業文を書くのが、このシステムで一番大きい事故。
 *   合っているか分からないものは、埋めずに空欄のまま残す。
 *
 * 使い方: npm run companies:verify -- [--limit 20] [--force]
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  await migrate();
  await initSettings();

  const limit = Number(arg('limit') ?? 20);
  const force = process.argv.includes('--force');
  // ★フォーム方針（営業を受け付けているか）がまだ空欄の会社だけを読み直す。
  const missingFormPolicy = process.argv.includes('--missing-form-policy');

  console.log('■ 公式HPの照合（robots.txt を守り、1社あたり最大3ページ。フォーム送信はしません）');
  console.log(`  今回見る上限: ${limit}社${force ? '（前に読んだ会社も読み直す）' : ''}${missingFormPolicy ? '（フォーム方針が空欄の会社だけ）' : ''}`);
  console.log('');

  const results = await enrichPending(limit, { force, missingFormPolicy });
  if (results.length === 0) {
    console.log('確かめる会社がありませんでした。');
  }
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
  for (const [action, n] of counts) console.log(`  ${enrichActionLabel(action as any)}: ${n}件`);

  const bad = results.filter((r) => r.action === 'REJECTED' || r.action === 'UNKNOWN');
  if (bad.length > 0) {
    console.log('');
    console.log('■ HPとして採用しなかったもの（空欄のまま残します）');
    for (const r of bad.slice(0, 30)) console.log(`  ${r.name}: ${r.reason}`);
  }

  const good = results.filter((r) => r.action === 'VERIFIED');
  if (good.length > 0) {
    console.log('');
    console.log('■ 本人のHPと確認できたもの');
    for (const r of good.slice(0, 30)) {
      console.log(`  ${r.name}: ${r.reason}${r.added.length > 0 ? ` ／ 足りた情報：${r.added.join('・')}` : ''}`);
    }
  }

  const s = await websiteVerificationSummary();
  console.log('');
  console.log('■ 全体');
  console.log(`  会社の数: ${s.total}社 ／ 確認できた: ${s.verified}社 ／ 未確認: ${s.unverified}社 ／ 外した: ${s.rejected}社 ／ HP不明: ${s.noWebsite}社`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
