/**
 * 画面を開かずに1回だけ実行する（cronから叩く用）。
 * 先に `npm run dev` か `npm start` でサーバーを起動しておくこと。
 */
const base = process.env.FACTORY_URL || 'http://localhost:3900';

const res = await fetch(`${base}/api/run`, { method: 'POST' });
const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`開始できませんでした：${json.error || res.status}`);
  process.exit(1);
}
console.log(`開始しました（${json.runId}）`);

while (true) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await fetch(`${base}/api/run/status`, { cache: 'no-store' }).then((r) => r.json());
  if (!s.run) break;
  console.log(`  ${s.run.stage} … ${s.run.status}`);
  if (s.run.status !== 'running') {
    if (s.run.error) console.error(`止まった理由：${s.run.error}`);
    break;
  }
}
