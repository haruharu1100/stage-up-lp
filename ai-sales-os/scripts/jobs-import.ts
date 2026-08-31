import fs from 'node:fs';
import path from 'node:path';
import { migrate, nowIso } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { seedJobSites, sitePolicy } from '../lib/jobs/sites';
import { ingestJob, type JobInput } from '../lib/jobs/ingest';
import { EXCLUSION_RULES } from '../lib/jobs/exclude';

/**
 * 案件をCSVから取り込む。
 *
 * ★サイトを勝手に巡回して集めることはしない（規約とrobots.txtの問題）。
 *   入口は「人が保存したCSV」か「公式API」だけ。
 *   規約台帳に無いサイトコードは受け付けない。
 *
 * 列: サイト,案件ID,タイトル,詳細,カテゴリ,予算下限,予算上限,働き方,締切,URL
 * 使い方: npm run jobs:import -- <CSVのパス>
 */

const HEADER_MAP: Record<string, keyof JobInput> = {
  サイト: 'siteCode',
  サイトコード: 'siteCode',
  site: 'siteCode',
  案件id: 'externalId',
  id: 'externalId',
  タイトル: 'title',
  件名: 'title',
  title: 'title',
  詳細: 'description',
  本文: 'description',
  description: 'description',
  カテゴリ: 'category',
  category: 'category',
  予算下限: 'budgetMin',
  予算上限: 'budgetMax',
  働き方: 'workStyle',
  勤務形態: 'workStyle',
  締切: 'deadline',
  url: 'url',
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('CSVのパスを渡してください。例: npm run jobs:import -- ./jobs.csv');
    console.log('列: サイト,案件ID,タイトル,詳細,カテゴリ,予算下限,予算上限,働き方,締切,URL');
    process.exit(1);
  }
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.log(`ファイルが見つかりません: ${abs}`);
    process.exit(1);
  }

  await migrate();
  await initSettings();
  await seedJobSites();

  const rows = parseCsv(fs.readFileSync(abs, 'utf8'));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const cols = header.map((h) => HEADER_MAP[h] ?? HEADER_MAP[h.replace(/\s/g, '')] ?? null);
  if (!cols.includes('title') || !cols.includes('description')) {
    console.log('「タイトル」と「詳細」の列が必要です。');
    console.log(`読めた列: ${header.join(' / ')}`);
    process.exit(1);
  }

  let added = 0;
  let known = 0;
  let skippedSite = 0;
  const excludedBy: Record<string, number> = {};
  const unknownSites = new Set<string>();

  for (const r of rows.slice(1)) {
    // ★入口は「人がCSVで取り込んだ」。ここを書いておかないと本物として数えない。
    const j: Partial<JobInput> = { source: 'CSV', inboxSource: 'CSV_IMPORT', inboxReceivedAt: nowIso() };
    cols.forEach((key, i) => {
      if (!key) return;
      const v = (r[i] ?? '').trim();
      if (v === '') return;
      if (key === 'budgetMin' || key === 'budgetMax') {
        const n = Number(v.replace(/[^0-9.]/g, ''));
        if (Number.isFinite(n) && n > 0) (j as Record<string, unknown>)[key] = n;
        return;
      }
      (j as Record<string, unknown>)[key] = v;
    });
    if (!j.title || !j.description) continue;

    const code = (j.siteCode ?? 'MANUAL').toUpperCase();
    const policy = await sitePolicy(code);
    if (policy.name === code && policy.reasonJa.includes('台帳に無い')) {
      unknownSites.add(code);
      skippedSite++;
      continue;
    }
    j.siteCode = code;

    const res = await ingestJob(j as JobInput);
    if (res.isNew) added++;
    else known++;
    for (const c of res.excluded) excludedBy[c] = (excludedBy[c] ?? 0) + 1;
  }

  console.log(`読み込み: ${path.basename(abs)}`);
  console.log(`  新規: ${added}件 / 既にあった: ${known}件`);
  if (skippedSite > 0) {
    console.log(`  規約台帳に無いサイトなので取り込まなかった: ${skippedSite}件（${[...unknownSites].join(', ')}）`);
    console.log('  → 先にそのサイトを規約台帳へ登録し、規約を人が読んでから取り込みます。');
  }
  if (Object.keys(excludedBy).length > 0) {
    console.log('  受けない理由が見つかった案件:');
    for (const [code, n] of Object.entries(excludedBy).sort((a, b) => b[1] - a[1])) {
      const rule = EXCLUSION_RULES.find((r) => r.code === code);
      console.log(`   ・${n}件 … ${rule?.label ?? code}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
