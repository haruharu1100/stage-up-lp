import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { all, migrate, nowIso, run } from '../lib/db/client';
import {
  downloadNtaZip,
  officialDataDir,
  selectOfficialCompanies,
  unzipCsv,
  NTA_FILE_NO,
  type OfficialCompanyRow,
} from '../lib/sales/official-data';
import {
  buildOfficialIndex,
  matchCorporateNumber,
  CORPORATE_NUMBER_STATUS_JA,
  type CorporateNumberStatus,
} from '../lib/sales/corporate-number';

/**
 * 会社の「法人番号」を、国が配っているデータだけで突き合わせる。
 *
 * ★APIキーは要らない。国税庁の全件データ（誰でもダウンロードできるZIP）だけを使う。
 *   だから「鍵が来るまで法人営業側が動かない」状態には戻さない。
 *
 * ★分からないものは分からないままにする。
 *   候補が2件以上あるときに1つ選ぶと、別会社に営業をかけることになる。だから選ばない。
 *
 * ★すでに入っている番号と国のデータの商号が食い違ったら、その場で営業対象から外す（BLOCK）。
 *
 * 使い方:
 *   npm run companies:corpnum                （手元にあるCSVで照合。無ければ大阪府を取得）
 *   npm run companies:corpnum -- --pref 27
 *   npm run companies:corpnum -- --dry       （書き込まずに結果だけ見る）
 */

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** 手元にすでに展開してあるCSVを探す。無ければ国から取ってくる。 */
function loadCsv(pref: string): { text: string; from: string } {
  const dir = officialDataDir();
  const csvDir = join(dir, 'csv');
  if (existsSync(csvDir)) {
    const found = readdirSync(csvDir)
      .filter((f) => f.toLowerCase().endsWith('.csv') && f.startsWith(pref))
      .sort();
    if (found.length > 0) {
      const path = join(csvDir, found[found.length - 1]);
      // ★展開済みのCSVをそのまま読む（国のサーバーに取りに行かない）。
      //   ただし国が配るCSVは Shift_JIS（CP932）なので、必ず変換してから読む。
      //   ここを素の UTF-8 として読むと、商号が全部文字化けし、
      //   「登録済みの130社すべてが別会社」という誤った結論になる（実際に一度そうなった）。
      const buf = execFileSync('iconv', ['-f', 'CP932', '-t', 'UTF-8', '-c', path], {
        maxBuffer: 1024 * 1024 * 512,
        timeout: 300_000,
      });
      return { text: buf.toString('utf8'), from: `手元のファイル ${found[found.length - 1]}（Shift_JISから変換して読み込み）` };
    }
  }
  const zip = downloadNtaZip(pref);
  return { text: unzipCsv(zip.path), from: `国税庁からダウンロード（${zip.label}）` };
}

async function main() {
  const pref = arg('pref', '27')!;
  const dry = has('dry');
  const entry = NTA_FILE_NO[pref];
  if (!entry) {
    console.log(`都道府県コード ${pref} は配布ファイル番号を持っていません。`);
    process.exit(1);
  }

  await migrate();

  console.log('================================');
  console.log('法人番号の照合（国税庁の全件データだけを使う。APIキー不要）');
  console.log('================================\n');

  const { text, from } = loadCsv(pref);
  console.log(`読んだ元：${from}`);

  // ★ここでは営業対象の種別で絞らない。照合が目的なので全種別を索引に入れる。
  //   絞ると「一般社団法人◯◯」を NOT_FOUND と誤って言うことになる。
  const { rows, stats } = selectOfficialCompanies(text, { salesTargetOnly: false });
  console.log(`国のデータ：${stats.lines.toLocaleString()}行を読み、${rows.length.toLocaleString()}法人を索引にしました。`);
  console.log(`（除いたもの：古い履歴 ${stats.skippedNotLatest.toLocaleString()}件／登記が閉鎖済み ${stats.skippedClosed.toLocaleString()}件／住所なし ${stats.skippedNoAddress.toLocaleString()}件）\n`);

  const index = buildOfficialIndex(rows as OfficialCompanyRow[]);

  // ★練習用（TEST）は照合しない。実在しない会社なので、国のデータに無いのが当たり前。
  const companies = await all(
    `SELECT id, name, address, city, prefecture, corporate_number, corporate_number_status, sales_excluded
       FROM companies
      WHERE data_origin <> 'TEST' AND merged_into IS NULL
      ORDER BY id`,
  );
  console.log(`照合する会社：${companies.length}社（練習用は対象外）\n`);

  const tally: Record<CorporateNumberStatus, number> = {
    VERIFIED: 0, UNKNOWN: 0, AMBIGUOUS: 0, NOT_FOUND: 0, CONFLICT: 0,
  };
  const at = nowIso();
  let blocked = 0;
  let newlyNumbered = 0;
  const conflicts: string[] = [];

  for (const c of companies) {
    const m = matchCorporateNumber(
      {
        name: String(c.name),
        address: c.address === null ? null : String(c.address),
        city: c.city === null ? null : String(c.city),
        prefecture: c.prefecture === null ? null : String(c.prefecture),
        corporateNumber: c.corporate_number === null ? null : String(c.corporate_number),
      },
      index,
    );
    tally[m.status]++;
    if (m.status === 'VERIFIED' && c.corporate_number === null) newlyNumbered++;
    if (m.block) {
      blocked++;
      conflicts.push(`#${c.id} ${String(c.name)} … ${m.reasonJa}`);
    }
    if (dry) continue;

    // ★VERIFIED のときだけ番号を書く。それ以外は今ある値をそのまま残す（消しも足しもしない）。
    if (m.status === 'VERIFIED' && m.corporateNumber !== null) {
      await run(
        `UPDATE companies
            SET corporate_number = ?, corporate_number_status = 'VERIFIED',
                corporate_number_reason = ?, corporate_number_source = 'NTA_ZENKEN',
                corporate_number_checked_at = ?, updated_at = ?
          WHERE id = ?`,
        [m.corporateNumber, m.reasonJa, at, at, c.id],
      );
    } else {
      await run(
        `UPDATE companies
            SET corporate_number_status = ?, corporate_number_reason = ?,
                corporate_number_source = 'NTA_ZENKEN', corporate_number_checked_at = ?, updated_at = ?
          WHERE id = ?`,
        [m.status, m.reasonJa, at, at, c.id],
      );
    }

    // ★別会社の疑い（CONFLICT）は、その場で営業対象から外す。
    //   外した理由は必ず残す。人があとから覆せなければ、外したこと自体が事故になる。
    if (m.block) {
      await run(
        `UPDATE companies SET sales_excluded = 1, sales_excluded_reason = ?, updated_at = ? WHERE id = ?`,
        [`法人番号が別会社の疑い：${m.reasonJa}`, at, c.id],
      );
      // 営業候補としての順位も外す（トップ5に残ったままにしない）。
      await run(`UPDATE company_opportunities SET final_rank = NULL WHERE company_id = ?`, [c.id]);
    }
  }

  console.log('照合の結果');
  console.log('--------------------------------');
  for (const k of ['VERIFIED', 'AMBIGUOUS', 'NOT_FOUND', 'CONFLICT', 'UNKNOWN'] as CorporateNumberStatus[]) {
    console.log(`  ${CORPORATE_NUMBER_STATUS_JA[k].padEnd(12, '　')} ${String(tally[k]).padStart(4)}社`);
  }
  console.log(`\n  新しく法人番号が付いた会社：${newlyNumbered}社`);
  console.log(`  別会社の疑いで営業対象から外した会社：${blocked}社`);
  if (conflicts.length > 0) {
    console.log('\n  外した会社：');
    for (const line of conflicts.slice(0, 20)) console.log(`    ${line}`);
  }
  if (dry) console.log('\n※ --dry を付けたので、1件も書き込んでいません。');

  console.log('\n★ 分からなかった会社は「不明」のままです。');
  console.log('  同じ商号が複数あるときに1つ選ぶと、別の会社へ営業をかけることになります。だから選びません。');
  console.log('★ この処理で外部へ送ったものはありません（国の配布ファイルを読んだだけです）。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
