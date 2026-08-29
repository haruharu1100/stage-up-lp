import { migrate } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { fetchFromGbizInfo, fetchFromHoujinBangou, sourceStatuses } from '../lib/sales/sources';
import { ingestCompany } from '../lib/sales/ingest';

/**
 * 公式APIから会社を取ってくる（読むだけ。会社側へは何も送らない）。
 *
 * 1つの取得元に頼らない。鍵が無いものは静かに飛ばし、使えるものだけで動かす。
 * 鍵が1つも無ければ「何もしていない」と正直に言って終わる。
 *
 * 使い方: npm run companies:fetch -- --name 工務店 [--pref 27] [--limit 50]
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  await migrate();
  await initSettings();

  console.log('■ 取得元の状態');
  for (const s of sourceStatuses()) {
    console.log(`  ${s.label}: ${s.configured ? '使える' : '鍵が未設定'}（読み取り専用）`);
  }
  console.log('');

  const name = arg('name');
  const pref = arg('pref');
  const limit = Number(arg('limit') ?? 50);
  if (!name && !pref) {
    console.log('探す条件がありません。例: npm run companies:fetch -- --name 工務店 --pref 27');
    console.log('（--pref は都道府県コード。27=大阪府）');
    return;
  }

  const outcomes = [
    await fetchFromHoujinBangou({ name: name ?? undefined, prefectureCode: pref ?? undefined, limit }),
    await fetchFromGbizInfo({ name: name ?? undefined, limit }),
  ];

  let inserted = 0;
  let duplicate = 0;
  let rejected = 0;
  for (const o of outcomes) {
    if (!o.ok) {
      console.log(`  ${o.source}: 使わなかった（${o.reason}）`);
      continue;
    }
    for (const c of o.companies) {
      const r = await ingestCompany(c);
      if (r.status === 'INSERTED') inserted++;
      else if (r.status === 'DUPLICATE') duplicate++;
      else rejected++;
    }
    console.log(`  ${o.source}: ${o.reason}`);
  }

  console.log('');
  console.log(`新規登録: ${inserted}件 / 既に居た: ${duplicate}件 / 受け付けなかった: ${rejected}件`);
  if (inserted === 0 && duplicate === 0) {
    console.log('取れた会社はありません。鍵が未設定か、条件に合う会社がなかったかのどちらかです。');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
