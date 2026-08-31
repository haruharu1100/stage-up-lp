import { migrate, one, run } from '../lib/db/client';

/**
 * 規約台帳から、自動で足した行（まだ誰も規約を読んでいない行）を消す。
 *
 * ★人が読んで記録した行は、このコマンドでは消せない。
 *   規約をどう読んだかは、応募してよいかどうかの唯一の根拠で、
 *   消してしまうと「なぜ応募してよいと判断したか」が説明できなくなる。
 *   だから消せるのは auto_registered = 1 の行（貼られたURLから機械が足しただけの行）に限る。
 *
 * ★使う場面は主に1つ。動作確認のために架空のURLを貼って、台帳に行ができてしまったとき。
 *   架空のサイトを台帳に残すと、「未読のサイトが何件あるか」の数字が狂う。
 *
 * 使い方: npx tsx scripts/sites-forget.ts EXAMPLE_JOBBOARD_TEST
 */

async function main() {
  await migrate();

  const codes = process.argv.slice(2).map((s) => s.trim()).filter((s) => s !== '');
  if (codes.length === 0) {
    console.log('消すサイトのコードを指定してください。 例: npx tsx scripts/sites-forget.ts EXAMPLE_JOBBOARD_TEST');
    process.exit(1);
  }

  for (const code of codes) {
    const row = await one('SELECT code, name, auto_registered FROM job_sites WHERE code = ?', [code]);
    if (row === null) {
      console.log(`${code}: 台帳にありません（すでに消えています）。`);
      continue;
    }
    if (Number(row.auto_registered ?? 0) !== 1) {
      console.log(`${code}「${row.name}」: 人が規約を読んで記録した行なので、消しません。`);
      continue;
    }

    const jobs = await one('SELECT COUNT(*) AS n FROM jobs WHERE site_code = ?', [code]);
    const n = Number(jobs?.n ?? 0);
    if (n > 0) {
      console.log(`${code}「${row.name}」: このサイトの案件が${n}件残っているので、消しません。先に案件を消してください。`);
      continue;
    }

    await run('DELETE FROM job_sites WHERE code = ? AND auto_registered = 1', [code]);
    console.log(`${code}「${row.name}」: 自動で足した行を消しました。`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
