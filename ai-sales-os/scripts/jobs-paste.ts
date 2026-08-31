import fs from 'node:fs';
import path from 'node:path';
import { migrate, nowIso, scalar } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { seedJobSites } from '../lib/jobs/sites';
import { CollectionBlocked, ingestJob, type JobInput } from '../lib/jobs/ingest';
import { parsePastedJob } from '../lib/jobs/paste';
import { REAL_SQL } from '../lib/origin';

/**
 * 人が貼った案件を取り込む。
 *
 * 使い方:
 *   1. data/inbox/ に、案件1件につきテキストファイルを1つ置く（.txt）。
 *      案件ページをそのままコピーして貼るだけでよい。URLも一緒に入れておくとよい。
 *   2. npm run jobs:paste
 *
 * ★このコマンドは外部へ一切つながらない。
 *   サイトを見にいくこともしないし、応募もしない。置かれたファイルを読むだけ。
 */

const INBOX_DIR = path.join(process.cwd(), 'data', 'inbox');

const README = `このフォルダの使い方
────────────────────────────────────────
案件1件につき、テキストファイルを1つ置いてください（拡張子 .txt）。

・案件ページの内容を、そのままコピーして貼るだけでかまいません。
・案件ページのURLも一緒に貼っておくと、どのサイトの案件か自動で分かります。
・1行目は案件の件名にしてください。

置いたあと、ターミナルで次を実行します。
    npm run jobs:paste

予算と締切について
────────────────────────────────────────
貼った文章の中に「予算：〇〇円」「納期：〇月〇日」と書いてあるときだけ読み取ります。
書いていなければ空のままにします。こちらで想像して数字を入れることはしません。
（想像で入れた金額のまま応募すると、赤字の案件を受けることになるためです）

このフォルダの中身は git に入りません。
`;

function ensureDir(): void {
  if (!fs.existsSync(INBOX_DIR)) fs.mkdirSync(INBOX_DIR, { recursive: true });
  const readme = path.join(INBOX_DIR, 'README.txt');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README, 'utf8');
}

async function main() {
  await migrate();
  await initSettings();
  await seedJobSites();
  ensureDir();

  const files = fs
    .readdirSync(INBOX_DIR)
    .filter((f) => /\.txt$/i.test(f) && f !== 'README.txt')
    .sort();

  console.log('══════════════════════════════════════════════════════════');
  console.log('人が貼った案件の取り込み');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`読み込む場所: ${INBOX_DIR}`);
  console.log('');

  if (files.length === 0) {
    console.log('置かれているファイルがありません。');
    console.log('');
    console.log('■ いま何ができるか');
    console.log('  ・案件ページをコピーして .txt で置くだけで、本物の案件として取り込めます。');
    console.log('  ・取り込んだあとは npm run pipeline で、受ける／受けないの判定まで一気に通ります。');
    console.log('  ・外部への応募は行いません（応募する処理コードがそもそもありません）。');
    console.log('');
    console.log('■ どうすれば前に進むか');
    console.log(`  1. ${INBOX_DIR} を開く`);
    console.log('  2. 気になる案件のページを開いて、本文をまるごとコピーする');
    console.log('  3. 案件1件につき1つ、テキストファイルとして貼り付けて保存する（名前は何でもよい）');
    console.log('  4. npm run jobs:paste をもう一度実行する');
    return;
  }

  let added = 0;
  let known = 0;
  let rejected = 0;
  const notes: string[] = [];

  for (const f of files) {
    const text = fs.readFileSync(path.join(INBOX_DIR, f), 'utf8');
    const p = parsePastedJob(text);
    if (p.problems.length > 0) {
      rejected++;
      for (const q of p.problems) notes.push(`${f}: ${q}`);
      continue;
    }

    const input: JobInput = {
      siteCode: p.siteCode,
      title: p.title,
      description: p.body,
      budgetMin: p.budgetMin,
      budgetMax: p.budgetMax,
      deadline: p.deadline,
      url: p.url,
      source: 'MANUAL',
      // ★URLが分かっているものと、本文だけのものは、信じてよい範囲が違う。入口を分けて記録する。
      inboxSource: p.url ? 'MANUAL_URL' : 'MANUAL_TEXT',
      inboxReceivedAt: nowIso(),
    };

    try {
      const res = await ingestJob(input);
      if (res.isNew) added++;
      else known++;
      console.log(`  ${res.isNew ? '新規' : '既出'} … ${p.title.slice(0, 46)}`);
      console.log(`         サイト＝${p.siteCode} / 入口＝${input.inboxSource}`);
      console.log(
        `         予算＝${p.budgetMin === null ? '書かれていない（空のまま）' : `${p.budgetMin.toLocaleString()}〜${(p.budgetMax ?? p.budgetMin).toLocaleString()}円`}`
        + ` / 締切＝${p.deadline ?? '書かれていない（空のまま）'}`,
      );
      for (const e of p.evidence) console.log(`         根拠（${e.field}）＝「${e.matched.slice(0, 60)}」`);
      if (res.excluded.length > 0) console.log(`         ★受けない判定: ${res.excluded.join('、')}`);
    } catch (err) {
      rejected++;
      notes.push(`${f}: ${err instanceof CollectionBlocked ? err.message : String(err)}`);
    }
  }

  console.log('');
  console.log(`新しく入った: ${added}件 / 既にあった: ${known}件 / 受け取らなかった: ${rejected}件`);
  for (const n of notes.slice(0, 20)) console.log(`   ・${n}`);
  console.log('');
  console.log(`本物の案件の合計: ${await scalar(`SELECT COUNT(*) FROM jobs WHERE ${REAL_SQL}`)}件`);
  console.log('※ 外部への応募は1件も行っていません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
