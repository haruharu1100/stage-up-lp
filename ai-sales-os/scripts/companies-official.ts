import { migrate } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { ingestCompany } from '../lib/sales/ingest';
import {
  downloadNtaZip,
  unzipCsv,
  selectOfficialCompanies,
  stableOrderKey,
  NTA_FILE_NO,
  NTA_ZENKEN,
} from '../lib/sales/official-data';

/**
 * 本物の法人データを取り込む。
 *
 * ★これはスクレイピングではない。
 *   国税庁の法人番号公表サイトが誰でもダウンロードできる形で配っている
 *   「全件データ（ZIP）」をそのまま受け取り、そのまま読んでいる。
 *   APIキーは要らないので、鍵待ちを理由に本番検証を止めなくてよい。
 *
 * ★入った会社は data_origin = REAL_OFFICIAL になる。練習用データとは完全に別扱い。
 *
 * 使い方:
 *   npm run companies:official -- --pref 27 --city 大阪市 --limit 120
 */

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const pref = arg('pref', '27')!;
  const city = arg('city');
  const limit = Number(arg('limit', '120'));

  const entry = NTA_FILE_NO[pref];
  if (!entry) {
    console.log(`都道府県コード ${pref} は配布ファイル番号を持っていません。`);
    console.log(`使える番号: ${Object.entries(NTA_FILE_NO).map(([k, v]) => `${k}=${v.label}`).join(' / ')}`);
    process.exit(1);
  }

  await migrate();
  await initSettings();

  console.log('■ 国が配っている法人データを取り込む');
  console.log(`  配布元: ${NTA_ZENKEN}`);
  console.log(`  対象  : ${entry.label}${city ? `（${city}）` : ''}`);
  console.log('');

  const zip = downloadNtaZip(pref);
  console.log(`  ${zip.downloaded ? 'ダウンロードした' : '前に取ったものを使う'}: ${zip.path.split('/').pop()}`);

  const csv = unzipCsv(zip.path);
  console.log(`  読み込んだ文字数: ${csv.length.toLocaleString()}`);

  // ★まず全件から条件に合うものを集め、それから決まった順番で先頭N社を取る。
  //   毎回同じ会社が選ばれるようにしておかないと、数字を比べられない。
  const { rows, stats } = selectOfficialCompanies(csv, { salesTargetOnly: true, city });
  console.log('');
  console.log('  ▼ 外した内訳（黙って減らさない）');
  console.log(`    読んだ行            : ${stats.lines.toLocaleString()}`);
  console.log(`    法人として読めた行  : ${stats.parsed.toLocaleString()}`);
  console.log(`    古い履歴なので外した: ${stats.skippedNotLatest.toLocaleString()}`);
  console.log(`    登記が閉じていた    : ${stats.skippedClosed.toLocaleString()}`);
  console.log(`    住所が無い          : ${stats.skippedNoAddress.toLocaleString()}`);
  console.log(`    会社以外の法人      : ${stats.skippedKind.toLocaleString()}`);
  console.log(`    市区町村が違う      : ${stats.skippedCity.toLocaleString()}`);
  console.log(`    残った法人          : ${stats.kept.toLocaleString()}`);

  const picked = rows
    .slice()
    .sort((a, b) => stableOrderKey(a.corporateNumber).localeCompare(stableOrderKey(b.corporateNumber)))
    .slice(0, limit);

  let inserted = 0;
  let duplicate = 0;
  let rejected = 0;
  const warnings: string[] = [];

  for (const r of picked) {
    const res = await ingestCompany({
      name: r.name,
      corporateNumber: r.corporateNumber,
      address: r.address,
      source: 'HOUJIN_BANGOU',
      sourceUrl: NTA_ZENKEN,
      dataOrigin: 'REAL_OFFICIAL',
      corporateKind: r.kind,
      closedAt: r.closedAt,
    });
    if (res.status === 'INSERTED') inserted++;
    else if (res.status === 'DUPLICATE') duplicate++;
    else rejected++;
    for (const w of res.warnings) warnings.push(`${r.name}: ${w}`);
  }

  console.log('');
  console.log(`  新規登録: ${inserted}件 / 既に居た: ${duplicate}件 / 受け付けなかった: ${rejected}件`);
  if (warnings.length > 0) {
    console.log(`  注意: ${warnings.length}件（先頭5件）`);
    for (const w of warnings.slice(0, 5)) console.log(`   ・${w}`);
  }
  console.log('');
  console.log('  ここで入ったのは「法人番号・社名・住所」だけ。');
  console.log('  HP・電話・メールはまだ無い。次に npm run companies:fetch で公式HPを探す。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
