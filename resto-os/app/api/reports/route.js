import { NextResponse } from 'next/server';
import { businessDate } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../lib/auth.js';
import { logAudit } from '../../../lib/audit.js';
import { addDays } from '../../../lib/learn.js';
import {
  listReports, getReportSettings, saveReportSettings, runReport, resendReport, testDelivery, REPORT_KINDS,
} from '../../../lib/report.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 朝・閉店後のレポートの窓口。
 *
 * ふだんは自動処理が勝手に作って送るので、この入口を使うのは
 * 「宛先を設定するとき」と「いま作り直して送りたいとき」だけ。
 *
 * 宛先の設定は店ごとに分かれていて、他店の宛先に送られることはない。
 * LINEの合言葉そのものは環境変数にあり、画面にもDBにも出さない。
 */

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const sp = new URL(req.url).searchParams;
    const [rows, settings] = await Promise.all([
      listReports(ctx, { limit: Number(sp.get('limit')) || 30 }),
      getReportSettings(ctx),
    ]);
    return NextResponse.json({
      ok: true,
      rows,
      settings,
      // 鍵そのものは返さない。「使える状態かどうか」だけを伝える
      lineReady: Boolean(process.env.LINE_CHANNEL_TOKEN),
      today: businessDate(),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action === 'settings') {
      const before = await getReportSettings(ctx);
      await saveReportSettings(ctx, body.settings || {});
      const after = await getReportSettings(ctx);
      await logAudit(ctx, { action: 'report.settings', targetType: 'settings', before, after });
      return NextResponse.json({ ok: true, settings: after });
    }

    if (action === 'test') {
      const r = await testDelivery(ctx);
      await logAudit(ctx, { action: 'report.send', targetType: 'test', reason: r.ok ? '成功' : r.error });
      return NextResponse.json({ ok: r.ok, error: r.error });
    }

    if (action === 'resend') {
      const r = await resendReport(ctx, body.id);
      await logAudit(ctx, { action: 'report.send', targetType: 'report', targetId: body.id, reason: r.ok ? '成功' : r.error });
      return NextResponse.json({ ok: r.ok, error: r.error });
    }

    if (action === 'run') {
      const kind = REPORT_KINDS.includes(body.kind) ? body.kind : 'morning';
      // 朝は今日ぶん、閉店後は昨日ぶんが既定。日付を指定すればその日で作れる
      const date = body.date ? String(body.date).slice(0, 10)
        : (kind === 'morning' ? businessDate() : addDays(businessDate(), -1));
      const r = await runReport(ctx, { kind, date, send: body.send !== false });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.skipped || '作れませんでした' }, { status: 400 });
      await logAudit(ctx, { action: 'report.run', targetType: kind, targetId: date, reason: r.delivered ? '送信済' : (r.error || '保存のみ') });
      return NextResponse.json(r);
    }

    throw new ApiError('BAD_REQUEST', '不明な操作です', 400);
  } catch (e) {
    return apiFail(e);
  }
}
