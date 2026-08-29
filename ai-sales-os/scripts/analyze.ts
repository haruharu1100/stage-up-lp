import { all } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { analyzeCompany, saveAnalysis } from '../lib/sales/analyze';
import { INDUSTRY_LABEL, type IndustryKey } from '../lib/industry';
import { NEED_LABEL, type NeedKey } from '../lib/needs';

/**
 * 会社を1社ずつ読んで「何をしている会社か」「何に困っていそうか」を出す。
 * 会社側へは何も送らない。読んで書き留めるだけ。
 *
 * 使い方: npm run analyze
 */

async function main() {
  await initSettings();
  const companies = await all('SELECT * FROM companies ORDER BY id');
  if (companies.length === 0) {
    console.log('会社が1件も入っていません。先に npm run seed か npm run companies:import を実行してください。');
    return;
  }

  const industries: Record<string, number> = {};
  const needs: Record<string, number> = {};
  let lowConfidence = 0;

  for (const c of companies) {
    const a = await analyzeCompany(c);
    await saveAnalysis(Number(c.id), a);
    industries[a.industry] = (industries[a.industry] ?? 0) + 1;
    for (const [k, v] of Object.entries(a.needFlags)) {
      if (Number(v) >= 50) needs[k] = (needs[k] ?? 0) + 1;
    }
    if (a.confidence < 0.4) lowConfidence++;
  }

  console.log(`■ 会社の読み取り: ${companies.length}社`);
  console.log('  業種の内訳:');
  for (const [k, n] of Object.entries(industries).sort((a, b) => b[1] - a[1])) {
    console.log(`   ・${n}社 … ${INDUSTRY_LABEL[k as IndustryKey] ?? k}`);
  }
  console.log('  困りごとが見えた会社（強く出たものだけ）:');
  const topNeeds = Object.entries(needs).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topNeeds.length === 0) console.log('   ・0件（HPの本文が無いと困りごとは読み取れません）');
  for (const [k, n] of topNeeds) console.log(`   ・${n}社 … ${NEED_LABEL[k as NeedKey] ?? k}`);
  console.log(`  読み取りの確からしさが低い会社: ${lowConfidence}社（情報が足りない。推測では埋めません）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
