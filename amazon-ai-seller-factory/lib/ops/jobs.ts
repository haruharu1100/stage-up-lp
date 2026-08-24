import { config } from '../env';
import { rebuildCategoryBias } from '../learning/categoryBias';
import { evaluateLifecycle } from '../learning/forecastAccuracy';
import { seedFromWinners } from '../learning/postmortem';
import { proposeWeights } from '../learning/scoreWeights';
import { all } from '../db/client';
import { runResearch } from '../research/pipeline';
import { loadResearchSettings } from '../research/settings';
import { reevaluateWatchList } from '../research/watch';
import { runSupplierImport } from '../suppliers/supplierImport';
import { duePlans, markJobRun, JOB_LABEL, type JobName } from './schedule';
import { canSpend } from './apiUsage';
import { runBackup } from './backup';
import { beat } from './heartbeat';
import {
  consumeRetry,
  dueRetries,
  failJobRun,
  finishJobRunOk,
  finishJobRunSkipped,
  markStage,
  recoverStuckRuns,
  startJobRun,
} from './jobRuns';
import { providerHealthWorst } from './providerHealth';

/**
 * 定期実行の実体。
 *
 * ★ここで動くのは「調べる・数える・学ぶ」だけ。
 *   発注・出品公開・価格変更・広告入札は1行も書かれていない（お金は動かない）。
 * ★月額上限に近づいたら、低優先（C・D）の見張りから止める。
 */

export interface JobResult {
  job: JobName;
  ok: boolean;
  message: string;
  skipped?: boolean;
  /** 1回ごとの実行記録のID（どこで失敗したかを追える） */
  runId?: string;
  /** やり直し待ちなら、その予定時刻 */
  retryAt?: string | null;
  attempt?: number;
}

export async function runJob(
  job: JobName,
  opts?: { trigger?: string; attempt?: number; parentRunId?: string | null },
): Promise<JobResult> {
  const settings = await loadResearchSettings();
  const spend = await canSpend({
    monthlyBudgetJpy: settings.monthlyBudgetJpy,
    budgetStopRatio: settings.budgetStopRatio,
  });

  const runId = await startJobRun({
    job,
    trigger: opts?.trigger ?? 'manual',
    attempt: opts?.attempt ?? 1,
    parentRunId: opts?.parentRunId ?? null,
  });

  // ★お金の見張り：上限が近いときは優先度の低い仕事から止める
  const lowPriority: JobName[] = ['watch_c', 'watch_b'];
  if (!spend.allowed && lowPriority.includes(job)) {
    const msg = `${spend.reason} のため、この見張りは今回とばしました`;
    await finishJobRunSkipped(runId, msg);
    await markJobRun(job, 'skipped', msg);
    return { job, ok: true, skipped: true, message: msg, runId };
  }

  // ★API障害の見張り：提供元が止まっているときは、推測で埋めずに仕事ごと見送る
  const ph = await providerHealthWorst();
  const needsApi: JobName[] = ['daily_research', 'watch_a', 'watch_b', 'watch_c'];
  if (ph.worst === 'DOWN' && needsApi.includes(job)) {
    const msg = `${ph.down.join('・')}が止まっているため、この仕事は見送りました（推測の数字では埋めません）`;
    await finishJobRunSkipped(runId, msg);
    await markJobRun(job, 'skipped', msg);
    return { job, ok: true, skipped: true, message: msg, runId };
  }

  try {
    const message = await execute(job, settings.minMonthlySales, runId);
    await finishJobRunOk(runId, message);
    await markJobRun(job, 'done', message);
    return { job, ok: true, message, runId };
  } catch (e: any) {
    const outcome = await failJobRun(runId, e);
    await markJobRun(job, outcome.status === 'RETRYING' ? 'retrying' : 'failed', outcome.message);
    return {
      job,
      ok: false,
      message: outcome.message,
      runId,
      retryAt: outcome.nextAttemptAt,
      attempt: outcome.attempt,
    };
  }
}

async function execute(job: JobName, _minSales: number, runId = ''): Promise<string> {
  switch (job) {
    case 'daily_research': {
      await markStage(runId, '安全設定の確認');
      if (config.autoPurchase) {
        throw new Error('AUTO_PURCHASE=true になっているため、安全のため自動リサーチを止めました');
      }
      await markStage(runId, '商品を調べています');
      const r = await runResearch({ limit: 200, trigger: 'schedule' });
      return `${r.summary.surveyed}件を調べ、Aランク${r.summary.gradeA}件／強い推奨${r.summary.strongPicks}件でした`;
    }

    case 'watch_a':
    case 'watch_b':
    case 'watch_c': {
      const grade = job === 'watch_a' ? 'A' : job === 'watch_b' ? 'B' : 'C';
      await markStage(runId, `${grade}ランクを見張っています`);
      const r = await reevaluateWatchList({ grade, limit: grade === 'A' ? 200 : 100 });
      return `${grade}ランク${r.checked}件を見張り、${r.promoted}件が昇格・${r.demoted}件が条件割れでした`;
    }

    case 'supplier_import': {
      await markStage(runId, '仕入先データを取り込んでいます');
      const r = await runSupplierImport();
      const seen = r.runs.reduce((s, x) => s + x.seen, 0);
      return (
        `仕入先${seen}件を確認し、変更${r.changed.length}件・新規${r.added.length}件。` +
        `値下がりでA昇格${r.promoted.length}件（変化のないものは再計算していません）`
      );
    }

    case 'learning': {
      // 実績が入っている商品の「予測と実績の差」を計算し直す
      await markStage(runId, '予測と実績の差を計算しています');
      const rows = await all(
        `SELECT id FROM product_lifecycle WHERE actual_profit_jpy IS NOT NULL OR actual_units_sold IS NOT NULL`,
      );
      let evaluated = 0;
      for (const r of rows) {
        const got = await evaluateLifecycle(String(r.id));
        if (got) evaluated++;
      }
      await markStage(runId, 'カテゴリー補正を作り直しています');
      const bias = await rebuildCategoryBias();
      const applied = bias.filter((b) => b.applied).length;
      await markStage(runId, '売れた商品の横展開を作っています');
      const seeds = await seedFromWinners();
      await markStage(runId, '重みの見直し案を作っています');
      const proposal = await proposeWeights();
      return [
        `実績${evaluated}件の精度を計算しました`,
        `カテゴリー補正：${applied}件を適用（実績5件未満のカテゴリーは補正しません）`,
        `売れた商品からの横展開：${seeds.created}件`,
        proposal.ok ? '重みの見直し案を作りました（未適用。承認が必要です）' : proposal.message,
      ].join('／');
    }

    case 'backup': {
      // ★読むだけ。元のデータは1件も書き換えない。API代もかからない。
      await markStage(runId, '大事なデータを写しています');
      const r = await runBackup();
      if (!r.ok) throw new Error(r.error || 'バックアップに失敗しました');
      return r.message;
    }

    default:
      throw new Error(`知らない仕事です: ${job}`);
  }
}

/**
 * 予定表を見て、今動かすべき仕事をすべて動かす（cron/launchd から呼ぶ）。
 *
 * ★毎回いちばん先に「前回の中断」を片づけてから始める。
 *   電源が落ちても、次の1回で自動的に立て直せる。
 */
export async function runDueJobs(opts?: { force?: JobName[] }): Promise<{
  ran: JobResult[];
  plans: Awaited<ReturnType<typeof duePlans>>;
  recovered: { recovered: number; jobs: string[] };
  retried: JobResult[];
}> {
  // ① 生きていることを記録する（管理画面が「止まっている」を見分けられる）
  await beat('scheduler', '予定表を確認しました');

  // ② 電源断などで実行中のまま残った仕事を閉じる（自動復旧）
  const recovered = await recoverStuckRuns();

  // ③ やり直しの時間が来た仕事を先に片づける
  const retried: JobResult[] = [];
  for (const r of await dueRetries()) {
    await consumeRetry(r.id);
    retried.push(
      await runJob(r.job as JobName, { trigger: 'retry', attempt: r.attempt + 1, parentRunId: r.id }),
    );
  }

  // ④ 予定どおりの仕事
  const settings = await loadResearchSettings();
  const plans = await duePlans(settings);
  const targets = opts?.force?.length ? opts.force : plans.filter((p) => p.due).map((p) => p.job);

  // やり直しで今回すでに動かした仕事は、二重に動かさない
  const alreadyRan = new Set(retried.map((r) => r.job));
  const ran: JobResult[] = [];
  for (const job of targets) {
    if (alreadyRan.has(job)) continue;
    ran.push(await runJob(job, { trigger: opts?.force?.length ? 'manual' : 'schedule' }));
  }

  return { ran, plans, recovered, retried };
}

export { JOB_LABEL };
