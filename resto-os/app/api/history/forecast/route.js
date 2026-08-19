import { NextResponse } from 'next/server';
import { businessDate } from '../../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, apiFail } from '../../../../lib/auth.js';
import { addDays, learningStatus } from '../../../../lib/learn.js';
import { predictDay, saveForecasts, accuracy, anomalies, todayPlan, hourlyPlan, confLabel } from '../../../../lib/forecast.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

/**
 * これから先の見込みを返す窓口。
 *
 * ここが返すのは「推測」なので、事実を返す /api/history とは入口ごと分けている。
 * 画面でも別の場所に出し、数字の色も変えて、事実と混ざらないようにする。
 *
 * 前日までに確定した予測がある日は、それをそのまま見せる（あとから書き換えない）。
 * まだ予測が無い日は、その場で計算して「参考」と印を付けて返す。
 */

function shapeStored(row) {
  let basis = [];
  let context = null;
  let samples = 0;
  try {
    const j = JSON.parse(row.basis_json || '{}');
    basis = Array.isArray(j.basis) ? j.basis : [];
    context = j.context || null;
    samples = Number(j.samples || 0);
  } catch { /* 壊れていたら根拠なしとして扱う（表示は止めない） */ }
  return {
    ok: true,
    value: Number(row.value),
    low: row.low === null ? null : Number(row.low),
    high: row.high === null ? null : Number(row.high),
    confidencePct: Number(row.confidence_pct || 0),
    confidence: row.confidence || confLabel(Number(row.confidence_pct || 0)),
    basis,
    samples,
    context,
  };
}

/** これから7〜10日ぶんの見込みを、日付順に並べて返す */
async function viewNext(ctx, sp) {
  const days = Math.max(1, Math.min(14, Number(sp.get('days')) || 7));
  const today = businessDate();
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));

  const stored = await ctx.query(
    `SELECT target_date, metric, value, low, high, confidence, confidence_pct, basis_json, created_at
       FROM forecasts WHERE SCOPE() AND target_date >= ? AND target_date <= ?`,
    [dates[0], dates[dates.length - 1]]
  );
  const map = new Map();
  for (const r of stored) map.set(`${r.target_date}|${r.metric}`, r);

  const out = [];
  for (const d of dates) {
    const sRow = map.get(`${d}|sales`);
    const gRow = map.get(`${d}|guests`);
    if (sRow && gRow) {
      const s = shapeStored(sRow);
      out.push({
        date: d,
        fixed: true,
        fixedAt: sRow.created_at,
        context: s.context,
        sales: s,
        guests: shapeStored(gRow),
      });
      continue;
    }
    // まだ確定していない日は、その場で計算して参考として返す
    const p = await predictDay(ctx, d);
    if (!p.ok) {
      out.push({ date: d, fixed: false, notEnough: true, message: p.message, context: p.context });
      continue;
    }
    out.push({
      date: d, fixed: false,
      context: {
        dowName: p.context.dowName, holiday: p.context.holiday, isEve: p.context.isEve,
        streak: p.context.streak, special: p.context.special, dayLabel: p.context.dayLabel,
        weatherText: p.context.weatherText, weatherFrom: p.context.weatherFrom,
        tempMax: p.context.tempMax, campaigns: p.context.campaigns.map((c) => c.name),
      },
      sales: p.metrics.sales,
      guests: p.metrics.guests,
    });
  }
  return { today, rows: out };
}

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const sp = new URL(req.url).searchParams;
    const view = String(sp.get('view') || 'next');

    if (view === 'accuracy') {
      const metric = sp.get('metric') === 'guests' ? 'guests' : 'sales';
      return NextResponse.json({ ok: true, accuracy: await accuracy(ctx, { days: 120, metric }) });
    }
    if (view === 'anomaly') {
      return NextResponse.json({ ok: true, ...(await anomalies(ctx, { days: 120 })) });
    }
    if (view === 'today') {
      return NextResponse.json({ ok: true, plan: await todayPlan(ctx) });
    }
    if (view === 'hourly') {
      // 何時が忙しいか・何人いれば回りそうか。日付を指定しなければ今日ぶん。
      const date = String(sp.get('date') || businessDate()).slice(0, 10);
      return NextResponse.json({ ok: true, hourly: await hourlyPlan(ctx, date) });
    }
    if (view === 'day') {
      const date = String(sp.get('date') || businessDate()).slice(0, 10);
      return NextResponse.json({ ok: true, forecast: await predictDay(ctx, date) });
    }

    const next = await viewNext(ctx, sp);
    const [status, acc, plan] = await Promise.all([
      learningStatus(ctx),
      accuracy(ctx, { days: 120, metric: 'sales' }),
      todayPlan(ctx),
    ]);
    return NextResponse.json({ ok: true, ...next, status, accuracy: acc, plan });
  } catch (e) {
    return apiFail(e);
  }
}

/**
 * 予測の作り直し。
 * ふだんは毎晩ひとりでに動くが、「いま出し直したい」ときのための入口。
 * 明日から先だけを書き換えるので、過去の当たり外れの記録は動かない。
 */
export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const r = await saveForecasts(ctx, { days: 10 });
    if (!r.ok) {
      return NextResponse.json({
        ok: false,
        error: `まだ${r.haveDays || 0}日ぶんしか記録がないため、予測を出せません。記録がたまるとここに出ます。`,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true, saved: r.saved });
  } catch (e) {
    return apiFail(e);
  }
}
