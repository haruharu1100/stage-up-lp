import { all, migrate, one, run } from '../lib/db/client';

/**
 * 間違って入れた案件を、あとに何も残さず消す。
 *
 * ★なぜこれが要るか。
 *   案件は1件入れると、解析・点数・応募文・監査・除外理由が別々の表に散らばって残る。
 *   案件の行だけ消すと、その散らばったほうが宙に浮いたまま残り、
 *   「本物の案件は何件か」を数えるときに、消したはずの1件が別の数字として顔を出す。
 *   数え間違いはそのまま「応募する5件」の中身を狂わせるので、消すときは全部いっしょに消す。
 *
 * ★動作確認のために入れた案件（存在しない会社・架空のURL）は、必ずこれで消すこと。
 *   練習用を本物として数えないのと同じ理由で、動作確認用も本物として数えてはいけない。
 *
 * 使い方: npm run jobs:delete -- 1805
 */

/** 案件1件にぶら下がる表。ここに書き漏らすと、消したはずの数字が残る。 */
const CHILD_TABLES = [
  'job_exclusions',
  'job_analyses',
  'job_scores',
  'proposals',
  'applications',
  'job_audits',
] as const;

async function main() {
  await migrate();

  const ids = process.argv
    .slice(2)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (ids.length === 0) {
    console.log('消す案件の番号を指定してください。 例: npm run jobs:delete -- 1805');
    process.exit(1);
  }

  for (const id of ids) {
    const job = await one('SELECT id, title, site_code, data_origin FROM jobs WHERE id = ?', [id]);
    if (job === null) {
      console.log(`案件#${id}: 見つかりませんでした（すでに消えています）。`);
      continue;
    }

    console.log(`案件#${id}「${job.title}」（サイト: ${job.site_code} ／ 素性: ${job.data_origin}）を消します。`);

    for (const t of CHILD_TABLES) {
      const r = await run(`DELETE FROM ${t} WHERE job_id = ?`, [id]);
      if (r.rowsAffected > 0) console.log(`  ${t}: ${r.rowsAffected}行`);
    }

    // ★この案件を「本家」として束ねていた重複がいる場合、束ね先を消すと重複だけが浮く。
    //   浮いた重複を黙って本家に昇格させると、人が見ていない案件が急に応募候補へ入る。
    //   だから昇格はせず、束ね先を外して「本家が消えた」ことが分かる状態にする。
    const orphans = await all('SELECT id FROM jobs WHERE duplicate_of = ?', [id]);
    if (orphans.length > 0) {
      await run(
        "UPDATE jobs SET duplicate_of = NULL, duplicate_reason = '同じ依頼としていた案件が消されたため、束ねを外した' WHERE duplicate_of = ?",
        [id],
      );
      console.log(`  この案件に束ねていた${orphans.length}件の束ねを外しました（本家には昇格させていません）。`);
    }

    await run('DELETE FROM jobs WHERE id = ?', [id]);
    console.log(`  案件#${id} を消しました。`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
