import { NextResponse } from 'next/server';
import { businessDate, businessRange } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, canSeeCost, apiFail } from '../../../lib/auth.js';
import { calendarFacts, calendarLabel, dowLabel, PAYDAY_NONE } from '../../../lib/domain/calendar.js';
import { weatherGroup } from '../../../lib/weather/open-meteo.js';
import { rebuildDay, backfillMissing, backfillWeather, learningStatus, addDays, dayDiff } from '../../../lib/learn.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

/**
 * 過去の記録を引き出す窓口。
 *
 * 見ているのは「1営業日1行にまとめた確定の数字」なので、
 * 何年ぶん貯まっても表示が重くならない。
 * ここが返すのは事実だけで、予測や推測は一切混ぜない。
 */

const GROUP_LABEL = {
  clear: '晴れ', cloudy: 'くもり', rain: '雨', snow: '雪', fog: '霧', storm: '雷雨',
};

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** 期間の指定。既定は直近90日。長くても3年ぶんまでにして、うっかり全件読み込みを防ぐ */
function period(sp) {
  const today = businessDate();
  let to = String(sp.get('to') || today).slice(0, 10);
  let from = String(sp.get('from') || addDays(to, -89)).slice(0, 10);
  if (from > to) [from, to] = [to, from];
  if (dayDiff(from, to) > 1100) from = addDays(to, -1100);
  return { from, to };
}

/** 1日ぶんの行を、画面がそのまま出せる形にそろえる */
function shapeRow(f, cal, wx, evs, seeCost) {
  const code = wx?.weather_code;
  const group = code === null || code === undefined ? '' : weatherGroup(code);
  const row = {
    date: f.business_date,
    source: f.source,
    sales: toNum(f.sales),
    guests: toNum(f.guests),
    checks: toNum(f.checks_count),
    orders: toNum(f.orders_count),
    qty: toNum(f.items_qty),
    discount: toNum(f.discount),
    avgSpend: toNum(f.avg_spend),
    avgCheck: toNum(f.avg_check),
    turnover: toNum(f.turnover),
    voidCount: toNum(f.void_count),
    voidTotal: toNum(f.void_total),
    serveMin: toNum(f.avg_serve_min),
    closed: toNum(f.closed) === 1,
    cost: toNum(f.cost_total),
    profit: toNum(f.gross_profit),
    dow: cal ? toNum(cal.dow) : null,
    dowName: cal ? dowLabel(toNum(cal.dow)) : '',
    holiday: cal?.holiday_name || '',
    isEve: cal ? toNum(cal.is_eve) === 1 : false,
    streak: cal ? toNum(cal.streak_days) : 0,
    special: cal?.special || '',
    season: cal?.season || '',
    payday: cal ? toNum(cal.payday_near, PAYDAY_NONE) : PAYDAY_NONE,
    dayLabel: cal ? calendarLabel({ ...cal, dow: toNum(cal.dow), payday_near: toNum(cal.payday_near, PAYDAY_NONE) }) : '',
    weather: wx?.weather_text || '',
    weatherGroup: group,
    weatherLabel: GROUP_LABEL[group] || '',
    tempMax: wx?.temp_max ?? null,
    tempMin: wx?.temp_min ?? null,
    precip: wx?.precip_mm ?? null,
    events: evs || [],
  };
  if (!seeCost) { delete row.cost; delete row.profit; }
  return row;
}

/**
 * その日の暦（曜日・祝日・連休・季節）。
 * まだ表に無い日（今日や先の日）は、その場で計算して同じ形で返す。
 * 暦は計算で必ず同じ答えになるので、保存の有無で見え方が変わってはいけない。
 */
async function calFor(ctx, date) {
  const row = await ctx.first(`SELECT * FROM calendar_days WHERE SCOPE() AND business_date = ?`, [date]);
  return row || calendarFacts(date);
}

async function loadRange(ctx, from, to) {
  const facts = await ctx.query(
    `SELECT * FROM daily_facts WHERE SCOPE() AND business_date >= ? AND business_date <= ? ORDER BY business_date DESC`,
    [from, to]
  );
  const cals = await ctx.query(
    `SELECT * FROM calendar_days WHERE SCOPE() AND business_date >= ? AND business_date <= ?`, [from, to]
  );
  const wxs = await ctx.query(
    `SELECT * FROM weather_actual WHERE SCOPE() AND business_date >= ? AND business_date <= ?`, [from, to]
  );
  const evs = await ctx.query(
    `SELECT business_date, kind, title, impact FROM day_events WHERE SCOPE() AND business_date >= ? AND business_date <= ?`,
    [from, to]
  );
  const calMap = new Map(cals.map((r) => [r.business_date, r]));
  const wxMap = new Map(wxs.map((r) => [r.business_date, r]));
  const evMap = new Map();
  for (const e of evs) {
    const list = evMap.get(e.business_date) || [];
    list.push({ kind: e.kind, title: e.title, impact: e.impact });
    evMap.set(e.business_date, list);
  }
  return { facts, calMap, wxMap, evMap };
}

/** 絞り込み。条件は「事実」に対してだけかける */
function applyFilters(rows, sp) {
  const dows = String(sp.get('dow') || '').split(',').filter((x) => x !== '').map(Number);
  const groups = String(sp.get('weather') || '').split(',').filter(Boolean);
  const tMin = sp.get('tempMin') === null ? null : Number(sp.get('tempMin'));
  const tMax = sp.get('tempMax') === null ? null : Number(sp.get('tempMax'));
  const special = String(sp.get('special') || '');
  const only = String(sp.get('only') || ''); // holiday / eve / weekday / event
  const minSales = sp.get('minSales') === null ? null : Number(sp.get('minSales'));

  return rows.filter((r) => {
    if (dows.length && !dows.includes(r.dow)) return false;
    if (groups.length && !groups.includes(r.weatherGroup)) return false;
    if (tMin !== null && Number.isFinite(tMin) && !(r.tempMax !== null && r.tempMax >= tMin)) return false;
    if (tMax !== null && Number.isFinite(tMax) && !(r.tempMax !== null && r.tempMax <= tMax)) return false;
    if (special && r.special !== special) return false;
    if (only === 'holiday' && !r.holiday) return false;
    if (only === 'eve' && !r.isEve) return false;
    if (only === 'weekday' && (r.holiday || r.dow === 0 || r.dow === 6)) return false;
    if (only === 'event' && !(r.events || []).length) return false;
    if (minSales !== null && Number.isFinite(minSales) && r.sales < minSales) return false;
    return true;
  });
}

function summarize(rows, seeCost) {
  const n = rows.length;
  const sum = (k) => rows.reduce((s, r) => s + toNum(r[k]), 0);
  const sales = sum('sales');
  const guests = sum('guests');
  const checks = sum('checks');
  const out = {
    days: n,
    sales,
    guests,
    checks,
    avgSales: n ? Math.round(sales / n) : 0,
    avgGuests: n ? Math.round(guests / n) : 0,
    avgSpend: guests ? Math.round(sales / guests) : 0,
    avgCheck: checks ? Math.round(sales / checks) : 0,
    maxSales: n ? Math.max(...rows.map((r) => r.sales)) : 0,
    minSales: n ? Math.min(...rows.map((r) => r.sales)) : 0,
  };
  if (seeCost) out.profit = sum('profit');
  return out;
}

// ===== それぞれの見え方 =====

async function viewList(ctx, sp, seeCost) {
  const { from, to } = period(sp);
  // この仕組みを入れる前の営業日や、夜の自動処理が動かなかった日をここで埋める。
  // 会計の記録から作り直すだけなので、何度開いても同じ数字になる。
  await backfillMissing(ctx, from, to);
  const { facts, calMap, wxMap, evMap } = await loadRange(ctx, from, to);
  let rows = facts.map((f) => shapeRow(f, calMap.get(f.business_date), wxMap.get(f.business_date), evMap.get(f.business_date), seeCost));

  // 商品で絞る場合は、その商品が出た日だけに限り、売れた数も一緒に返す
  const item = String(sp.get('item') || '').trim();
  if (item) {
    const its = await ctx.query(
      `SELECT business_date, qty, sales FROM daily_item_facts
        WHERE SCOPE() AND business_date >= ? AND business_date <= ? AND name = ?`,
      [from, to, item]
    );
    const m = new Map(its.map((r) => [r.business_date, r]));
    rows = rows.filter((r) => m.has(r.date)).map((r) => ({ ...r, itemQty: toNum(m.get(r.date).qty), itemSales: toNum(m.get(r.date).sales) }));
  }

  rows = applyFilters(rows, sp);
  return { from, to, rows, summary: summarize(rows, seeCost) };
}

/** その日の全部。時間帯・商品・注文の履歴・天気・出来事まで一度に返す */
async function viewDay(ctx, sp, seeCost) {
  const date = String(sp.get('date') || businessDate()).slice(0, 10);

  let fact = await ctx.first(`SELECT * FROM daily_facts WHERE SCOPE() AND business_date = ?`, [date]);
  // まだ記憶にない日（機能を入れる前の日など）は、その場で生データから作り直す
  if (!fact && date < businessDate()) {
    await rebuildDay(ctx, date);
    fact = await ctx.first(`SELECT * FROM daily_facts WHERE SCOPE() AND business_date = ?`, [date]);
  }
  if (!fact) {
    // 当日ぶんはまだ確定していないので、その場で数えて見せる（記憶には書かない）
    await rebuildDay(ctx, date);
    fact = await ctx.first(`SELECT * FROM daily_facts WHERE SCOPE() AND business_date = ?`, [date]);
  }

  const cal = await calFor(ctx, date);
  const wx = await ctx.first(`SELECT * FROM weather_actual WHERE SCOPE() AND business_date = ?`, [date]);
  const fc = await ctx.query(
    `SELECT slot, weather_text, temp_max, temp_min, precip_prob FROM weather_forecast WHERE SCOPE() AND business_date = ? ORDER BY slot`,
    [date]
  );
  const events = await ctx.query(
    `SELECT id, kind, title, detail, impact, staff_name, created_at FROM day_events WHERE SCOPE() AND business_date = ? ORDER BY id`,
    [date]
  );
  const camps = await ctx.query(
    `SELECT id, name, kind, detail, cost FROM campaigns WHERE SCOPE() AND starts_on <= ? AND (ends_on = '' OR ends_on >= ?)`,
    [date, date]
  );
  const hours = await ctx.query(
    `SELECT hour, sales, qty, orders_count FROM daily_hour_facts WHERE SCOPE() AND business_date = ? ORDER BY hour`, [date]
  );
  const items = await ctx.query(
    `SELECT name, category_name, station, qty, sales, cost, profit, peak_hour
       FROM daily_item_facts WHERE SCOPE() AND business_date = ? ORDER BY qty DESC`, [date]
  );

  const [s, e] = businessRange(date);
  const checks = await ctx.query(
    `SELECT public_id, table_name, guests, subtotal, discount, total, payment_method, status, staff_name, created_at
       FROM checks WHERE SCOPE() AND created_at >= ? AND created_at < ? ORDER BY created_at`,
    [s, e]
  );
  const payments = await ctx.query(
    `SELECT payment_method AS m, COUNT(*) AS c, COALESCE(SUM(total),0) AS total
       FROM checks WHERE SCOPE() AND status = 'closed' AND created_at >= ? AND created_at < ? GROUP BY m`,
    [s, e]
  );

  const day = shapeRow(fact, cal, wx, events.map((x) => ({ kind: x.kind, title: x.title, impact: x.impact })), seeCost);

  // 前年・前月・過去4週の同じ曜日と比べる
  const refDates = [addDays(date, -364), addDays(date, -28), addDays(date, -7)];
  const refs = await ctx.query(
    `SELECT business_date, sales, guests, avg_spend FROM daily_facts WHERE SCOPE() AND business_date IN (?,?,?)`,
    refDates
  );
  const refMap = new Map(refs.map((r) => [r.business_date, r]));
  const compare = [
    { label: '1週間前の同じ曜日', date: refDates[2] },
    { label: '4週間前の同じ曜日', date: refDates[1] },
    { label: '前年の同じ曜日', date: refDates[0] },
  ].map((c) => {
    const r = refMap.get(c.date);
    return {
      ...c,
      sales: r ? toNum(r.sales) : null,
      guests: r ? toNum(r.guests) : null,
      diff: r ? day.sales - toNum(r.sales) : null,
      ratio: r && toNum(r.sales) ? Math.round((day.sales / toNum(r.sales)) * 1000) / 10 : null,
    };
  });

  return {
    date,
    day,
    hours: hours.map((h) => ({ hour: toNum(h.hour), sales: toNum(h.sales), qty: toNum(h.qty), orders: toNum(h.orders_count) })),
    items: items.map((i) => {
      const row = {
        name: i.name, category: i.category_name || '', station: i.station || '',
        qty: toNum(i.qty), sales: toNum(i.sales),
        cost: toNum(i.cost), profit: toNum(i.profit),
        peakHour: i.peak_hour === null ? null : toNum(i.peak_hour),
      };
      if (!seeCost) { delete row.cost; delete row.profit; }
      return row;
    }),
    checks: checks.map((c) => ({
      id: c.public_id, table: c.table_name, guests: toNum(c.guests),
      subtotal: toNum(c.subtotal), discount: toNum(c.discount), total: toNum(c.total),
      payment: c.payment_method, status: c.status, staff: c.staff_name, at: c.created_at,
    })),
    payments: payments.map((p) => ({ method: p.m, count: toNum(p.c), total: toNum(p.total) })),
    forecasts: fc.map((f) => ({
      slot: f.slot, text: f.weather_text, tempMax: f.temp_max, tempMin: f.temp_min, precipProb: f.precip_prob,
    })),
    events: events.map((x) => ({
      id: Number(x.id), kind: x.kind, title: x.title, detail: x.detail, impact: x.impact,
      by: x.staff_name, at: x.created_at,
    })),
    campaigns: camps.map((c) => ({ id: Number(c.id), name: c.name, kind: c.kind, detail: c.detail, cost: toNum(c.cost) })),
    compare,
  };
}

/** 年ごと・月ごとの比較グラフ用 */
async function viewCompare(ctx, sp, seeCost) {
  const metric = String(sp.get('metric') || 'sales');
  const allowed = ['sales', 'guests', 'avg_spend', 'gross_profit', 'items_qty', 'checks_count', 'turnover'];
  const col = allowed.includes(metric) ? metric : 'sales';
  if ((col === 'gross_profit') && !seeCost) {
    return { metric: 'sales', unit: 'month', series: [] };
  }
  const to = String(sp.get('to') || businessDate()).slice(0, 10);
  const years = Math.max(1, Math.min(5, Number(sp.get('years')) || 3));
  const from = addDays(to, -365 * years);

  // 客単価などの「平均で見るべき数字」は平均、金額や人数は合計にする
  const agg = ['avg_spend', 'turnover'].includes(col) ? 'AVG' : 'SUM';
  const rows = await ctx.query(
    `SELECT substr(business_date, 1, 4) AS y, substr(business_date, 6, 2) AS m,
            ${agg}(${col}) AS v, COUNT(*) AS days
       FROM daily_facts WHERE SCOPE() AND business_date >= ? AND business_date <= ?
      GROUP BY y, m ORDER BY y, m`,
    [from, to]
  );
  const byYear = new Map();
  for (const r of rows) {
    const y = r.y;
    if (!byYear.has(y)) byYear.set(y, Array.from({ length: 12 }, () => null));
    byYear.get(y)[Number(r.m) - 1] = Math.round(Number(r.v) * 10) / 10;
  }
  return {
    metric: col,
    unit: 'month',
    series: [...byYear.entries()].map(([year, values]) => ({ year, values })),
  };
}

/**
 * 似た日を探す。
 * 「同じ曜日・近い気温・同じ天気の大分類」を軸に、近い日から順に並べる。
 * どこが似ているのかを必ず添えて返す（理由の分からない候補は出さない）。
 */
async function viewSimilar(ctx, sp, seeCost) {
  const date = String(sp.get('date') || businessDate()).slice(0, 10);
  const limit = Math.max(1, Math.min(20, Number(sp.get('limit')) || 5));

  const cal = await calFor(ctx, date);
  // 当日・未来なら予報を、過去なら実績を「その日の天気」として使う
  let wx = await ctx.first(`SELECT * FROM weather_actual WHERE SCOPE() AND business_date = ?`, [date]);
  let wxFrom = '実績';
  if (!wx) {
    wx = await ctx.first(
      `SELECT * FROM weather_forecast WHERE SCOPE() AND business_date = ? ORDER BY fetched_at DESC LIMIT 1`, [date]
    );
    wxFrom = '予報';
  }

  const to = addDays(date, -1);
  const from = addDays(date, -730);
  await backfillMissing(ctx, from, to, 60);
  const { facts, calMap, wxMap, evMap } = await loadRange(ctx, from, to);
  const base = {
    dow: cal ? toNum(cal.dow) : null,
    temp: wx?.temp_max ?? null,
    group: wx?.weather_code === undefined || wx?.weather_code === null ? '' : weatherGroup(wx.weather_code),
    holiday: Boolean(cal?.holiday_name),
  };

  const scored = facts
    .map((f) => shapeRow(f, calMap.get(f.business_date), wxMap.get(f.business_date), evMap.get(f.business_date), seeCost))
    .filter((r) => r.sales > 0)
    .map((r) => {
      const why = [];
      let score = 0;
      if (base.dow !== null && r.dow === base.dow) { score += 40; why.push(`同じ${r.dowName}曜日`); }
      if (base.group && r.weatherGroup === base.group) { score += 30; why.push(`同じ天気（${GROUP_LABEL[base.group] || r.weather}）`); }
      if (base.temp !== null && r.tempMax !== null) {
        const d = Math.abs(r.tempMax - base.temp);
        if (d <= 2) { score += 25; why.push(`気温が近い（${Math.round(r.tempMax)}℃）`); }
        else if (d <= 4) { score += 15; why.push(`気温がやや近い（${Math.round(r.tempMax)}℃）`); }
      }
      if (base.holiday && r.holiday) { score += 10; why.push('同じ祝日まわり'); }
      if (r.holiday === (cal?.holiday_name || '') && r.holiday) score += 5;
      // 近い時期のほうが、お店の状態も近い
      const ago = dayDiff(r.date, date);
      score += Math.max(0, 10 - ago / 60);
      return { ...r, score: Math.round(score), why };
    })
    .filter((r) => r.why.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    date,
    basis: {
      dow: base.dow === null ? '' : `${dowLabel(base.dow)}曜日`,
      weather: wx?.weather_text || '',
      weatherFrom: wx ? wxFrom : '',
      tempMax: base.temp,
      holiday: cal?.holiday_name || '',
    },
    rows: scored,
    summary: summarize(scored, seeCost),
  };
}

/** 1つの商品が、いつ・どれだけ売れてきたか */
async function viewItem(ctx, sp, seeCost) {
  const name = String(sp.get('item') || '').trim();
  const { from, to } = period(sp);
  if (!name) return { item: '', rows: [] };
  const rows = await ctx.query(
    `SELECT business_date, qty, sales, cost, profit, peak_hour FROM daily_item_facts
      WHERE SCOPE() AND name = ? AND business_date >= ? AND business_date <= ? ORDER BY business_date`,
    [name, from, to]
  );
  return {
    item: name,
    from,
    to,
    rows: rows.map((r) => {
      const row = {
        date: r.business_date, qty: toNum(r.qty), sales: toNum(r.sales),
        cost: toNum(r.cost), profit: toNum(r.profit),
        peakHour: r.peak_hour === null ? null : toNum(r.peak_hour),
      };
      if (!seeCost) { delete row.cost; delete row.profit; }
      return row;
    }),
  };
}

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const sp = new URL(req.url).searchParams;
    const view = String(sp.get('view') || 'list');
    const seeCost = canSeeCost(ctx);

    if (view === 'day') return NextResponse.json({ ok: true, canSeeCost: seeCost, ...(await viewDay(ctx, sp, seeCost)) });
    if (view === 'compare') return NextResponse.json({ ok: true, canSeeCost: seeCost, ...(await viewCompare(ctx, sp, seeCost)) });
    if (view === 'similar') return NextResponse.json({ ok: true, canSeeCost: seeCost, ...(await viewSimilar(ctx, sp, seeCost)) });
    if (view === 'item') return NextResponse.json({ ok: true, canSeeCost: seeCost, ...(await viewItem(ctx, sp, seeCost)) });
    if (view === 'status') return NextResponse.json({ ok: true, status: await learningStatus(ctx) });

    const list = await viewList(ctx, sp, seeCost);
    const status = await learningStatus(ctx);
    // 商品の選択肢（絞り込み用）。よく出るものから並べる
    const names = await ctx.query(
      `SELECT name, SUM(qty) AS q FROM daily_item_facts WHERE SCOPE() AND business_date >= ? AND business_date <= ?
        GROUP BY name ORDER BY q DESC LIMIT 100`,
      [list.from, list.to]
    );
    return NextResponse.json({
      ok: true, canSeeCost: seeCost, status, ...list,
      itemNames: names.map((r) => r.name),
      hasGeo: Boolean(ctx.store?.lat && ctx.store?.lng),
    });
  } catch (e) {
    return apiFail(e);
  }
}

/**
 * 過去の天気の取り寄せ。
 * ふだんは毎晩ひとりでに少しずつ埋まるが、「いま埋めたい」ときのための入口。
 * すでに確定している日には触らない。
 */
export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const b = await req.json().catch(() => ({}));
    if (String(b.action) !== 'weather_backfill') {
      return NextResponse.json({ ok: false, error: '不明な操作です' }, { status: 400 });
    }
    const r = await backfillWeather(ctx, { days: 400, cap: 60 });
    if (r.reason === 'NO_GEO') {
      return NextResponse.json({
        ok: false,
        error: 'お店の場所がまだ設定されていません。「お店の設定」で住所を登録してください。',
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true, saved: r.saved || 0, remaining: Math.max(0, (r.missing || 0) - (r.saved || 0)) });
  } catch (e) {
    return apiFail(e);
  }
}
