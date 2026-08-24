/**
 * 予定表を見て「今やるべき仕事」だけを実行する常駐スクリプト。
 *
 * ・毎日9:00の自動リサーチ（時刻は管理画面から変更できる）
 * ・Aランクは高頻度／Bは中頻度／Cは低頻度で見張り（Dは原則止める）
 * ・その30分前に仕入先データの取込、1時間後に実績の学習
 *
 * ★動くのは「調べる・数える・学ぶ」だけ。発注・出品公開・価格変更は起きない。
 *
 * 使い方:
 *   node scripts/scheduler.mjs          … 1回だけ確認して終わる（cron / launchd 向け）
 *   node scripts/scheduler.mjs --loop   … 5分おきに確認し続ける（ターミナルを開いたまま）
 *   node scripts/scheduler.mjs --job daily_research  … 指定した仕事を今すぐ動かす
 *
 * 先に `npm run dev` か `npm start` でサーバーを起動しておくこと。
 */
const base = process.env.FACTORY_URL || 'http://localhost:3900';
const args = process.argv.slice(2);
const loop = args.includes('--loop');
const jobIndex = args.indexOf('--job');
const job = jobIndex >= 0 ? args[jobIndex + 1] : null;
const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MIN || 5) * 60_000;

if (String(process.env.AUTO_PURCHASE).toLowerCase() === 'true') {
  console.error('AUTO_PURCHASE=true は許可されていません。自動発注は行わない設計です。中止しました。');
  process.exit(1);
}

async function tick() {
  const stamp = new Date().toLocaleString('ja-JP');
  try {
    const res = await fetch(`${base}/api/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job ? { action: 'run_job', job } : { action: 'run_due' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[${stamp}] 実行できませんでした：${json.error || res.status}`);
      return;
    }
    if (job) {
      console.log(`[${stamp}] ${json.job}：${json.message}`);
      return;
    }

    // ★前回の中断を自動で片づけた分（電源断・強制終了のあとの立て直し）
    if (json.recovered?.recovered) {
      console.log(`[${stamp}] 前回途中で止まっていた仕事${json.recovered.recovered}件を片づけました`);
    }
    // ★やり直しの時間が来て、もう一度動かした分
    for (const r of json.retried || []) {
      console.log(`[${stamp}] やり直し ${r.job}（${r.attempt || '?'}回目）：${r.message}`);
    }

    if (!json.ran?.length) {
      const next = (json.plans || [])
        .filter((p) => p.enabled && p.nextDueAt)
        .sort((a, b) => String(a.nextDueAt).localeCompare(String(b.nextDueAt)))[0];
      console.log(
        `[${stamp}] 今やることはありません` +
          (next ? `（次は「${next.label}」／${new Date(next.nextDueAt).toLocaleString('ja-JP')}）` : ''),
      );
      return;
    }
    for (const r of json.ran) {
      console.log(`[${stamp}] ${r.job}${r.skipped ? '（とばしました）' : ''}：${r.message}`);
    }
  } catch (e) {
    console.error(`[${stamp}] サーバーに繋がりませんでした：${e?.message || e}`);
  }
}

await tick();
if (loop) {
  console.log(`このまま${intervalMs / 60_000}分おきに確認します（止めるときは Ctrl+C）。`);
  setInterval(tick, intervalMs);
}
