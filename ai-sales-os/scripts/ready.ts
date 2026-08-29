import { readinessSummary } from '../lib/readiness';

/**
 * 「あと何を用意すれば1件目を実行できるか」を並べる。
 *
 * ★このコマンドは何も送らない。読むだけ。
 * ★秘密の値は出さない。「あるか無いか」だけを出す。
 *
 * 使い方: npm run ready
 */

const MARK: Record<string, string> = { DONE: '済', MISSING: '要', BLOCKED: '★' };

async function main() {
  const r = await readinessSummary();

  console.log('■ 1件目を実行するために、あと何が要るか');
  console.log('  （そろっても送信は起きません。実行する処理コードがこのシステムに無いためです）');
  console.log('');

  console.log('▼ 会社データの取得元');
  for (const k of r.dataKeys) {
    console.log(`  ${k.ok ? '済' : '要'} ${k.label}`);
    if (!k.ok) console.log(`     → ${k.how}`);
  }
  console.log('');

  for (const a of r.actions) {
    console.log(`▼ ${a.label}　（${a.candidateLabel}）`);
    for (const it of a.items) {
      console.log(`  ${MARK[it.state]} ${it.label}：${it.detail}`);
      if (it.how) console.log(`     → ${it.how}`);
    }
    console.log('');
  }

  console.log('  記号：済＝もうできている／要＝用意すれば済む／★＝先に人が決めることがある');
  console.log('');
  console.log(`  用意すれば済むもの: ${r.totalMissing}件 / 先に決めることがあるもの: ${r.totalBlocked}件`);
  console.log('');
  console.log(`■ 次にやること`);
  console.log(`  ${r.nextStep}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
