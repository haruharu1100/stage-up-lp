#!/usr/bin/env node
/**
 * 指定したリサーチ1回分だけを消す（動作確認で作った結果の後片付け用）。
 *
 * ★消すのは research_runs と research_candidates の該当1回分だけ。
 *   販売実績・仕入記録・学習データには一切さわりません。
 *
 * 使い方: node scripts/drop-run.mjs <runId>
 */
import { createClient } from '@libsql/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2];
if (!runId) {
  console.error('runId を指定してください。例: node scripts/drop-run.mjs rsr_xxxxx');
  process.exit(1);
}

const db = createClient({ url: 'file:' + path.join(ROOT, 'data', 'factory.db') });
const before = await db.execute({
  sql: 'SELECT COUNT(*) n FROM research_candidates WHERE research_run_id = ?',
  args: [runId],
});
await db.execute({ sql: 'DELETE FROM research_candidates WHERE research_run_id = ?', args: [runId] });
await db.execute({ sql: 'DELETE FROM research_runs WHERE id = ?', args: [runId] });
const rest = await db.execute('SELECT COUNT(*) n FROM research_candidates');
console.log(`${runId} の候補 ${before.rows[0].n}件を消しました。残りの候補：${rest.rows[0].n}件`);
