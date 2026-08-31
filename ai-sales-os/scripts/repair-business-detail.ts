import { all, migrate, nowIso, run } from '../lib/db/client';

/**
 * すでにデータベースへ入ってしまった「こちらの営業メモ」を、事業内容の欄から追い出す。
 *
 * ★なぜ必要か。
 *   CSVの「メモ」列を事業内容として取り込んでいた。中身は
 *   「2026-07-28 人が応答/手応えC/取次で終了」のような、こちらの架電記録だった。
 *   それが営業文に引用され、電話台本が
 *   「『2026-07-28人が応答/手応えC/取次で終了』とありましたので、ご連絡しました」
 *   と、こちらの営業メモを相手に読み上げる形になっていた。
 *
 * ★消さずに internal_note へ移す。記録は残す。ただし営業文からは見えなくする。
 *
 * 使い方: npm run repair:business-detail
 */

/** こちらの営業記録に見える書き方。相手が自社サイトに書く文章ではない。 */
const OUR_NOTE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /手応え[ＡＢＣＤA-D]/, label: '架電の手応え' },
  { re: /不応答|応答なし|話し中|留守電/, label: '架電の結果' },
  { re: /取次(で終了|不可)?|受付(で)?(終了|ブロック)/, label: '取次の記録' },
  { re: /人が応答|担当者不在|折り返し(依頼|待ち)/, label: '架電の記録' },
  { re: /^\s*20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}/, label: '日付から始まる作業記録' },
  { re: /(再|要)(架電|連絡|TEL)/i, label: '次にかける予定のメモ' },
  { re: /NG|断られ|お断りされ/, label: '断られた記録' },
];

async function main() {
  await migrate();
  const rows = await all(
    `SELECT id, name, business_detail, business_detail_source, internal_note
       FROM companies
      WHERE business_detail IS NOT NULL AND business_detail <> ''`,
  );

  let moved = 0;
  let markedManual = 0;
  const samples: string[] = [];

  for (const r of rows) {
    const bd = String(r.business_detail);
    const hits = OUR_NOTE_PATTERNS.filter((p) => p.re.test(bd));
    const src = String(r.business_detail_source ?? '');

    if (hits.length > 0) {
      // こちらのメモだと分かるもの。事業内容から外し、内部メモへ移す。
      const note = r.internal_note ? `${String(r.internal_note)} / ${bd}` : bd;
      await run(
        `UPDATE companies SET business_detail = NULL, business_detail_source = NULL, internal_note = ?, updated_at = ? WHERE id = ?`,
        [note, nowIso(), r.id],
      );
      moved++;
      if (samples.length < 10) samples.push(`${r.name}: ${hits[0].label}「${bd.slice(0, 40)}」`);
      continue;
    }

    if (src === '') {
      // メモとは言い切れないが、どこから来た文章かも分からない。
      // 分からないものを「その会社が書いた文章」として引用しない。MANUAL と記録して引用対象から外す。
      await run(`UPDATE companies SET business_detail_source = 'MANUAL', updated_at = ? WHERE id = ?`, [nowIso(), r.id]);
      markedManual++;
    }
  }

  console.log('■ 事業内容の欄に入っていた「こちらの営業メモ」を外しました');
  console.log(`  見た会社: ${rows.length}社`);
  console.log(`  営業メモだったので外した: ${moved}社（内容は内部メモへ移しました。消していません）`);
  console.log(`  出どころ不明として引用対象から外した: ${markedManual}社`);
  if (samples.length > 0) {
    console.log('');
    console.log('■ 外したものの例');
    for (const s of samples) console.log(`  ・${s}`);
  }
  console.log('');
  console.log('  ※このあと npm run companies:verify を実行すると、HPが読めた会社は');
  console.log('    HP本文が事業内容として入り直します（出どころ＝OFFICIAL_WEBSITE）。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
