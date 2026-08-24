import { NextResponse } from 'next/server';
import { migrate } from '@/lib/db/client';
import { usageHistory, usageSummary } from '@/lib/ops/apiUsage';
import { backupList, backupStatus, runBackup } from '@/lib/ops/backup';
import { heartbeatStatus } from '@/lib/ops/heartbeat';
import { jobRunList, jobRunSummary, pruneJobRuns } from '@/lib/ops/jobRuns';
import { runDueJobs, runJob } from '@/lib/ops/jobs';
import { providerHealthList } from '@/lib/ops/providerHealth';
import { duePlans, type JobName } from '@/lib/ops/schedule';
import { loadResearchSettings } from '@/lib/research/settings';
import { adapterStatus } from '@/lib/suppliers/importAdapters';
import { runSupplierImport, supplierImportHistory, supplierPriceChanges } from '@/lib/suppliers/supplierImport';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 運用まわり（定期実行の予定表・APIコスト・仕入先データの取込）。
 *
 * ★ここから動かせるのは「調べる・数える・学ぶ」だけ。
 *   発注・出品公開・価格変更は一切できない。
 */

export async function GET() {
  try {
    await migrate();
    const settings = await loadResearchSettings();
    const [plans, usage, history, imports, changes, runs, runSummary, providers, heartbeat] = await Promise.all([
      duePlans(settings),
      usageSummary({ monthlyBudgetJpy: settings.monthlyBudgetJpy, budgetStopRatio: settings.budgetStopRatio }),
      usageHistory(30),
      supplierImportHistory(20),
      supplierPriceChanges(50),
      jobRunList(50),
      jobRunSummary(),
      providerHealthList(),
      heartbeatStatus(),
    ]);
    const [backup, backups] = await Promise.all([backupStatus(), backupList(10)]);
    return NextResponse.json({
      plans,
      usage,
      history,
      imports,
      changes,
      runs,
      runSummary,
      providers,
      heartbeat,
      backup,
      backups,
      adapters: adapterStatus(),
      settings: {
        autoRunEnabled: settings.autoRunEnabled,
        dailyRunTime: settings.dailyRunTime,
        monthlyBudgetJpy: settings.monthlyBudgetJpy,
        maxDataAgeHours: settings.maxDataAgeHours,
        minConfidenceForA: settings.minConfidenceForA,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await migrate();
    const body = await req.json().catch(() => ({}) as any);
    const action = String(body?.action || 'run_due');

    switch (action) {
      case 'run_due': {
        const res = await runDueJobs();
        return NextResponse.json({
          ok: true,
          ran: res.ran,
          plans: res.plans,
          recovered: res.recovered,
          retried: res.retried,
          message: res.ran.length
            ? res.ran.map((r) => `${r.job}：${r.message}`).join(' ／ ')
            : '今動かすべき仕事はありませんでした',
        });
      }

      case 'backup': {
        // ★読むだけの操作。元のデータは1件も書き換えない。お金もかからない。
        const res = await runBackup();
        return NextResponse.json(res, { status: res.ok ? 200 : 500 });
      }

      case 'prune_runs': {
        // ★古い実行記録の掃除。仕入・販売・学習のデータには一切さわらない。
        const removed = await pruneJobRuns(Number(body.keepDays) || 60);
        return NextResponse.json({ ok: true, removed, message: `古い実行記録${removed}件を片づけました` });
      }

      case 'run_job': {
        const job = String(body.job || '') as JobName;
        const res = await runJob(job);
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      case 'supplier_import': {
        const res = await runSupplierImport({ adapters: body.adapters });
        return NextResponse.json({
          ok: true,
          ...res,
          message:
            res.runs.map((r) => `【${r.adapter}】${r.message}`).join(' ／ ') ||
            res.notes.join(' ／ ') ||
            '取り込めるデータがありませんでした',
        });
      }

      default:
        return NextResponse.json({ error: '知らない操作です' }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
