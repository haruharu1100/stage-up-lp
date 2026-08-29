import { spawnSync } from 'node:child_process';

/**
 * 受入テストをまとめて流す。
 *
 * 順番に意味がある。安全 → 法人営業 → 案件。
 * 安全が落ちた時点で止める（他が合格でも出荷してはいけないため）。
 *
 * 使い方: npm test
 * ※テストデータの作り直しから始めたい場合は npm run seed -- --reset を先に。
 */

const STEPS: { label: string; file: string; stopOnFail: boolean }[] = [
  { label: '安全（外部への操作・納品の関門）', file: 'scripts/test-safety.ts', stopOnFail: true },
  { label: '法人営業（SYSTEM A）', file: 'scripts/test-sales.ts', stopOnFail: false },
  { label: '案件受注（SYSTEM B）', file: 'scripts/test-jobs.ts', stopOnFail: false },
];

const failed: string[] = [];

for (const s of STEPS) {
  console.log('');
  console.log(`━━━ ${s.label} ━━━`);
  const res = spawnSync('npx', ['tsx', s.file], { stdio: 'inherit', shell: false });
  if (res.status !== 0) {
    failed.push(s.label);
    if (s.stopOnFail) {
      console.log('');
      console.log(`「${s.label}」が不合格です。ここが通らないうちは先に進みません。`);
      process.exit(1);
    }
  }
}

console.log('');
console.log('================================');
if (failed.length > 0) {
  console.log(`不合格の区分: ${failed.join('、')}`);
  console.log('直してからもう一度 npm test を実行してください。');
  process.exit(1);
}
console.log('すべての区分が合格しました。');
console.log('※合格しても、外部への送信・応募・納品は行われていません（送る処理コードが存在しないため）。');
