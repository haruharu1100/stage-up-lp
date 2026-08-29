import { migrate } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { fetchFromGbizInfo, fetchFromGooglePlaces, fetchFromHoujinBangou, sourceStatuses } from '../lib/sales/sources';
import { ingestCompany } from '../lib/sales/ingest';
import { enrichActionLabel, enrichPending, websiteVerificationSummary } from '../lib/sales/enrich';

/**
 * 公式APIから会社を取ってくる（読むだけ。会社側へは何も送らない）。
 *
 * 順番は「登記に近いものから」。
 *   ① gBizINFO → ② 国税庁 法人番号Web-API → ③ 公式HP（読むだけ）→ ④ Google Places
 *
 * 鍵が無い取得元は「キー待ち」と出して、そこで止める。推測で埋めない。
 * 鍵が1つも無ければ「何もしていない」と正直に言って終わる。
 *
 * 使い方:
 *   npm run companies:fetch -- --name 工務店 [--pref 27] [--area 大阪市] [--limit 50] [--no-site]
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  await migrate();
  await initSettings();

  const statuses = [...sourceStatuses()].sort((a, b) => a.order - b.order);
  console.log('■ 取得元（使う順番）');
  for (const s of statuses) {
    console.log(`  ${s.order}. ${s.label}: ${s.configured ? '使える' : 'キー待ち'}（読み取り専用）`);
    if (!s.configured) console.log(`       あと何をすれば使えるか → ${s.needs}`);
  }
  console.log('');

  const name = arg('name');
  const pref = arg('pref');
  const area = arg('area');
  const limit = Number(arg('limit') ?? 50);
  if (!name && !pref) {
    console.log('探す条件がありません。例: npm run companies:fetch -- --name 工務店 --pref 27');
    console.log('（--pref は都道府県コード。27=大阪府）');
    return;
  }

  // ★この順番のまま実行する。登記側を先に取っておくと、
  //   あとで公式HPを読んだときに「本当にその会社か」を法人番号で照合できる。
  const outcomes = [
    await fetchFromGbizInfo({ name: name ?? undefined, limit }),
    await fetchFromHoujinBangou({ name: name ?? undefined, prefectureCode: pref ?? undefined, limit }),
    await fetchFromGooglePlaces({ name: name ?? undefined, area: area ?? undefined, limit }),
  ];

  let inserted = 0;
  let duplicate = 0;
  let rejected = 0;
  const warnings: string[] = [];
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
      for (const w of r.warnings) warnings.push(`${c.name}: ${w}`);
    }
    console.log(`  ${o.source}: ${o.reason}`);
  }

  console.log('');
  console.log(`新規登録: ${inserted}件 / 既に居た: ${duplicate}件 / 受け付けなかった: ${rejected}件`);
  for (const w of warnings.slice(0, 20)) console.log(`  注意: ${w}`);
  if (inserted === 0 && duplicate === 0) {
    console.log('取れた会社はありません。鍵が未設定か、条件に合う会社がなかったかのどちらかです。');
    return;
  }

  // ── ③ 公式HPを読んで照合する ─────────────────────────────
  if (flag('no-site')) {
    console.log('');
    console.log('公式HPの読み取りは --no-site が付いていたので行いませんでした。');
  } else {
    console.log('');
    console.log('■ 公式HPを読んで「本当にその会社のHPか」を確かめます（robots.txt を守り、1社3ページまで）');
    const results = await enrichPending(Math.min(limit, inserted + duplicate));
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
    for (const [action, n] of counts) console.log(`  ${enrichActionLabel(action as any)}: ${n}件`);
    for (const r of results.filter((x) => x.action === 'REJECTED')) {
      console.log(`  ★別会社の可能性で外した: ${r.name} ／ ${r.reason}`);
    }
  }

  const s = await websiteVerificationSummary();
  console.log('');
  console.log('■ ホームページの確認状況');
  console.log(`  会社の数: ${s.total}社`);
  console.log(`  本人のHPと確認できた: ${s.verified}社`);
  console.log(`  HPはあるがまだ確かめていない: ${s.unverified}社`);
  console.log(`  照合に通らず外した: ${s.rejected}社`);
  console.log(`  HPが分かっていない: ${s.noWebsite}社`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
