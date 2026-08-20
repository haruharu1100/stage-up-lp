/**
 * 「明日どれくらい来そうか」を出す場所。
 *
 * 守っている決まりごと（ここを崩すと、ただの当てずっぽうになる）:
 *  1. ここが書くのは推測だけ。事実の表（daily_facts など）には絶対に触らない。
 *  2. 必ず範囲（いくつ〜いくつ）と根拠を一緒に返す。数字だけを言い切らない。
 *  3. 原因だとは言わない。「雨だから下がる」ではなく「雨の日は◯%低い傾向がある」と書く。
 *  4. データが足りないうちは、当たっているふりをしない（予測そのものを出さない）。
 *  5. 予測は必ず前日までに確定させ、あとから書き換えない。当たり外れをごまかさないため。
 *
 * 使っているのは、その店の過去の数字だけ。よその店のデータは一切混ぜない。
 */

import { nowIso, withTx } from './db.js';
import { calendarFacts, calendarLabel, dowLabel, PAYDAY_NONE } from './domain/calendar.js';
import { weatherGroup } from './weather/open-meteo.js';
import { addDays, dayDiff } from './learn.js';
import { waitForSlots } from './waitlist.js';

const METRICS = [
  { key: 'sales', col: 'sales', label: '売上', unit: '円' },
  { key: 'guests', col: 'guests', label: '客数', unit: '人' },
];

/**
 * 答え合わせの対象。
 *
 * metric の書き方は「種類:相手」。sales と guests だけ相手がいないので種類そのまま。
 *   sales / guests / hour_sales:20 / item_qty:12 / staff:20 / stock_use:3
 * こうしておくと、表を増やさずに種類を増やせる。
 */
export const METRIC_FAMILIES = [
  { key: 'sales', label: '売上', unit: '円', kind: 'yen' },
  { key: 'guests', label: '来客数', unit: '人', kind: 'num' },
  { key: 'hour_sales', label: '時間帯別売上', unit: '円', kind: 'yen' },
  { key: 'item_qty', label: '商品別販売数', unit: '個', kind: 'num' },
  { key: 'staff', label: '必要人数', unit: '人', kind: 'num' },
  { key: 'stock_use', label: '在庫需要', unit: '', kind: 'num' },
];

export const FAMILY_LABEL = Object.fromEntries(METRIC_FAMILIES.map((f) => [f.key, f.label]));

export function familyOf(metric) {
  return String(metric || '').split(':')[0];
}

export function metricTargetOf(metric) {
  const i = String(metric || '').indexOf(':');
  return i < 0 ? '' : String(metric).slice(i + 1);
}

// 精度を語ってよい下限。これ未満は「まだ判断できません」と正直に返す
const MIN_RESULT_ROWS = 10;
const MIN_RESULT_DAYS = 7;

const GROUP_LABEL = {
  clear: '晴れ', cloudy: 'くもり', rain: '雨', snow: '雪', fog: '霧', storm: '雷雨',
};

// 予測を出してよい最低日数。これ未満は「まだ分かりません」と正直に返す
const MIN_DAYS = 14;

function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ===== 統計の道具 =====

/** 真ん中の値。平均だと、貸切1回のような特別な日に引っぱられるので中央値を使う */
function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 下から p 割の位置の値（ばらつきの幅を見るのに使う） */
function quantile(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/**
 * 極端に外れた日を、参考から外す。
 * 貸切・大雪・テレビ取材のような日をそのまま混ぜると、ふだんの見込みがゆがむ。
 * 外した日は必ず件数を返して、画面で「◯日を除いた」と言えるようにする。
 */
function trimOutliers(values) {
  if (values.length < 5) return { kept: values, dropped: 0 };
  const med = median(values);
  const devs = values.map((v) => Math.abs(v - med));
  const mad = median(devs) || 0;
  if (!mad) return { kept: values, dropped: 0 };
  const kept = values.filter((v) => Math.abs(v - med) <= mad * 3.5);
  return { kept: kept.length >= 3 ? kept : values, dropped: kept.length >= 3 ? values.length - kept.length : 0 };
}

// ===== 材料あつめ =====

/**
 * 過去の営業日を、暦・天気つきで読み込む。
 * 売上0の日（休業日）は、ふだんの見込みには使わない。
 */
async function loadHistory(ctx, from, to) {
  const facts = await ctx.query(
    `SELECT business_date, sales, guests, checks_count, avg_spend, source
       FROM daily_facts WHERE SCOPE() AND business_date >= ? AND business_date <= ? AND sales > 0
      ORDER BY business_date`,
    [from, to]
  );
  if (!facts.length) return [];
  const cals = await ctx.query(
    `SELECT * FROM calendar_days WHERE SCOPE() AND business_date >= ? AND business_date <= ?`, [from, to]
  );
  const wxs = await ctx.query(
    `SELECT business_date, weather_code, temp_max, precip_mm FROM weather_actual
      WHERE SCOPE() AND business_date >= ? AND business_date <= ?`, [from, to]
  );
  // 近くの会場で催しがあった日。店が自分で登録した会場だけを見る
  // （どこを「近く」と考えるかは、店によって違うため）
  const ves = await ctx.query(
    `SELECT e.business_date, e.end_date, e.expected_people, v.distance_km
       FROM venue_events e JOIN venues v ON v.id = e.venue_id
      WHERE SCOPE(e) AND v.active = 1 AND e.business_date <= ? AND (e.end_date = '' OR e.end_date >= ?)`,
    [to, from]
  );
  const veMap = new Map();
  for (const e of ves) {
    const last = e.end_date && e.end_date > e.business_date ? e.end_date : e.business_date;
    for (let d = e.business_date; d <= last; d = addDays(d, 1)) {
      const cur = veMap.get(d) || { n: 0, people: 0 };
      cur.n += 1;
      cur.people += Number(e.expected_people || 0);
      veMap.set(d, cur);
    }
  }

  const calMap = new Map(cals.map((r) => [r.business_date, r]));
  const wxMap = new Map(wxs.map((r) => [r.business_date, r]));

  return facts.map((f) => {
    const cal = calMap.get(f.business_date) || calendarFacts(f.business_date);
    const wx = wxMap.get(f.business_date);
    const code = wx?.weather_code;
    return {
      date: f.business_date,
      sales: Number(f.sales || 0),
      guests: Number(f.guests || 0),
      dow: Number(cal.dow),
      holiday: cal.holiday_name || '',
      isEve: Number(cal.is_eve || 0) === 1,
      streak: Number(cal.streak_days || 0),
      special: cal.special || '',
      payday: Number(cal.payday_near ?? PAYDAY_NONE),
      group: code === null || code === undefined ? '' : weatherGroup(code),
      tempMax: wx?.temp_max === null || wx?.temp_max === undefined ? null : Number(wx.temp_max),
      precip: wx?.precip_mm === null || wx?.precip_mm === undefined ? null : Number(wx.precip_mm),
      venue: (veMap.get(f.business_date)?.n || 0) > 0,
      venuePeople: veMap.get(f.business_date)?.people || 0,
    };
  });
}

/** 予測したい日の「その日らしさ」。天気は、過去なら実績・これからなら予報を使う */
async function targetContext(ctx, date) {
  const calRow = await ctx.first(`SELECT * FROM calendar_days WHERE SCOPE() AND business_date = ?`, [date]);
  const cal = calRow || calendarFacts(date);

  let wx = await ctx.first(
    `SELECT weather_code, weather_text, temp_max, temp_min, precip_mm FROM weather_actual
      WHERE SCOPE() AND business_date = ?`, [date]
  );
  let wxFrom = '実績';
  if (!wx) {
    wx = await ctx.first(
      `SELECT weather_code, weather_text, temp_max, temp_min, precip_prob AS precip_mm FROM weather_forecast
        WHERE SCOPE() AND business_date = ? ORDER BY fetched_at DESC LIMIT 1`, [date]
    );
    wxFrom = wx ? '予報' : '';
  }
  const code = wx?.weather_code;
  const camps = await ctx.query(
    `SELECT name, kind FROM campaigns WHERE SCOPE() AND starts_on <= ? AND (ends_on = '' OR ends_on >= ?)`,
    [date, date]
  );
  const events = await ctx.query(
    `SELECT kind, title, impact FROM day_events WHERE SCOPE() AND business_date = ?`, [date]
  );
  // 近くの会場の催し（店が登録したもの）。何時からかも一緒に見る
  const venueEvents = await ctx.query(
    `SELECT v.name AS venue, v.distance_km, e.title, e.kind, e.expected_people, e.start_time, e.end_time
       FROM venue_events e JOIN venues v ON v.id = e.venue_id
      WHERE SCOPE(e) AND v.active = 1 AND e.business_date <= ? AND (e.end_date = '' OR e.end_date >= ?) AND e.business_date >= ?
      ORDER BY v.distance_km`,
    [date, date, addDays(date, -14)]
  );

  return {
    date,
    dow: Number(cal.dow),
    dowName: dowLabel(Number(cal.dow)),
    holiday: cal.holiday_name || '',
    isEve: Number(cal.is_eve || 0) === 1,
    streak: Number(cal.streak_days || 0),
    special: cal.special || '',
    season: cal.season || '',
    payday: Number(cal.payday_near ?? PAYDAY_NONE),
    dayLabel: calendarLabel({ ...cal, dow: Number(cal.dow), payday_near: Number(cal.payday_near ?? PAYDAY_NONE) }),
    group: code === null || code === undefined ? '' : weatherGroup(code),
    weatherText: wx?.weather_text || '',
    weatherFrom: wxFrom,
    tempMax: wx?.temp_max === null || wx?.temp_max === undefined ? null : Number(wx.temp_max),
    campaigns: camps.map((c) => ({ name: c.name, kind: c.kind })),
    events: events.map((e) => ({ kind: e.kind, title: e.title, impact: e.impact })),
    venueEvents: venueEvents.map((e) => ({
      venue: e.venue,
      distanceKm: e.distance_km === null || e.distance_km === undefined ? null : Number(e.distance_km),
      title: e.title,
      kind: e.kind,
      people: Number(e.expected_people || 0),
      startTime: e.start_time || '',
      endTime: e.end_time || '',
    })),
  };
}

// ===== 効き具合の測り方 =====

/**
 * 曜日の差を、いったん取り除いた形に直す。
 *
 * これをやらないと、条件の効き目を二重に数えてしまう。
 * たとえば金曜はもともと売れる曜日なのに、「金曜はたいてい休みの前の日」なので、
 * 曜日を無視して「休みの前の日は◯%高い」と測ると、
 * 金曜の高さを二度足すことになり、現実離れした数字が出る。
 *
 * そこで、それぞれの日を「その曜日のふだんの何倍だったか」に置き換えてから比べる。
 */
function relativize(rows, key) {
  const byDow = new Map();
  for (let d = 0; d < 7; d += 1) {
    const m = median(rows.filter((r) => r.dow === d).map((r) => r[key]).filter((v) => v > 0));
    if (m) byDow.set(d, m);
  }
  const all = median(rows.map((r) => r[key]).filter((v) => v > 0)) || 1;
  return rows
    .filter((r) => r[key] > 0)
    .map((r) => ({ ...r, rel: r[key] / (byDow.get(r.dow) || all) }));
}

/**
 * 「ある条件の日」が、同じ曜日のふだんと比べて何倍だったかを測る。
 *
 * ここで出るのは相関であって、原因ではない。
 * （雨の日に売上が低いとしても、雨そのものが理由とは限らない）
 * 少ない件数で断定しないよう、最低件数に届かないものは使わない。
 */
function ratioOf(rows, pick, { min = 6, lo = 0.7, hi = 1.4 } = {}) {
  const hit = rows.filter(pick).map((r) => r.rel);
  if (hit.length < min) return null;
  const rest = rows.filter((r) => !pick(r)).map((r) => r.rel);
  if (rest.length < min) return null;
  const a = median(hit);
  const b = median(rest);
  if (!a || !b) return null;
  return { ratio: clamp(a / b, lo, hi), n: hit.length };
}

/** 直近の伸び／落ち。28日ずつを比べる（季節の変わり目に置いていかれないため） */
function trendOf(rows, key, date) {
  const recent = rows.filter((r) => dayDiff(r.date, date) <= 28).map((r) => r[key]);
  const before = rows.filter((r) => {
    const d = dayDiff(r.date, date);
    return d > 28 && d <= 56;
  }).map((r) => r[key]);
  if (recent.length < 10 || before.length < 10) return null;
  const a = median(recent);
  const b = median(before);
  if (!a || !b) return null;
  return { ratio: clamp(a / b, 0.8, 1.25), n: recent.length + before.length };
}

// ===== 予測本体 =====

/**
 * 1日ぶんの予測を作る。保存はせず、計算結果だけを返す。
 *
 * 考え方はできるだけ単純にしてある。複雑な式より、
 * 「同じ曜日のふだんの数字を土台に、その日らしさで足し引きする」ほうが、
 * なぜその数字になったのかを店長に説明できるため。
 */
export async function predictDay(ctx, date, preload = null) {
  const today = todayJst();
  const histTo = addDays(date < today ? date : today, -1);
  const histFrom = addDays(histTo, -364);
  const rows = preload || (await loadHistory(ctx, histFrom, histTo));
  const usable = rows.filter((r) => r.date <= histTo);

  const t = preload && preload.__ctx ? preload.__ctx : await targetContext(ctx, date);

  if (usable.length < MIN_DAYS) {
    return {
      date,
      ok: false,
      reason: 'NOT_ENOUGH',
      haveDays: usable.length,
      needDays: MIN_DAYS,
      context: t,
      message: `まだ${usable.length}日ぶんしか記録がありません。あと${MIN_DAYS - usable.length}日たつと予測を出せます。`,
    };
  }

  // これまでの当たり具合。あれば「根拠の強さ」に反映する（自己採点だけにしないため）
  const acc = preload && preload.__acc !== undefined
    ? preload.__acc
    : await accuracy(ctx, { days: 120, metric: 'sales' });

  // これまでのずれが片側に寄っていたら、そのぶんを戻す（答え合わせを次の予測に返す）
  const cal = preload && preload.__cal !== undefined
    ? preload.__cal
    : Object.fromEntries(await Promise.all(
      METRICS.map(async (m) => [m.key, await calibration(ctx, { metric: m.key, days: 120 })]),
    ));

  const metrics = {};
  for (const m of METRICS) {
    metrics[m.key] = predictMetric(usable, t, m, date, acc, cal?.[m.key] || null);
  }
  return { date, ok: true, context: t, metrics, haveDays: usable.length };
}

function predictMetric(rows, t, m, date, acc = null, cal = null) {
  const key = m.key;
  const basis = [];
  // 条件の効き目は、曜日の差を取り除いてから測る（同じ効果を二度足さないため）
  const rel = relativize(rows, key);

  // ---- 土台：同じ曜日のふだんの数字 ----
  let sameDow = rows.filter((r) => r.dow === t.dow && dayDiff(r.date, date) <= 126);
  let baseLabel = `${t.dowName}曜日`;
  if (sameDow.length < 4) {
    sameDow = rows.filter((r) => dayDiff(r.date, date) <= 126);
    baseLabel = '直近18週';
  }
  if (sameDow.length < 4) {
    sameDow = rows;
    baseLabel = '記録のある全期間';
  }
  const rawValues = sameDow.map((r) => r[key]).filter((v) => v > 0);
  const { kept, dropped } = trimOutliers(rawValues);
  const base = median(kept);
  if (!base) {
    return { ok: false, reason: 'NO_BASE', label: m.label, unit: m.unit };
  }
  basis.push({
    label: `${baseLabel}のふだんの${m.label}`,
    detail: `過去${kept.length}日の真ん中の値${dropped ? `（極端な${dropped}日は除外）` : ''}`,
    value: Math.round(base),
    effect: 0,
  });

  // ---- ここから、その日らしさで足し引きする ----
  const factors = [];

  const trend = trendOf(rows, key, date);
  if (trend && Math.abs(trend.ratio - 1) >= 0.03) {
    factors.push({
      k: 'trend',
      ratio: trend.ratio,
      label: '最近の流れ',
      detail: `直近4週は、その前の4週より${pct(trend.ratio)}（${trend.n}日ぶんの比較）`,
    });
  }

  if (t.group) {
    const w = ratioOf(rel, (r) => r.group === t.group, { min: 8 });
    if (w && Math.abs(w.ratio - 1) >= 0.03) {
      factors.push({
        k: 'weather',
        ratio: w.ratio,
        label: `天気（${GROUP_LABEL[t.group] || t.group}）`,
        // 「〜が原因」とは書かない。あくまで一緒に起きていた傾向として書く
        detail: `${GROUP_LABEL[t.group] || t.group}の日は、ほかの日より${pct(w.ratio)}傾向（過去${w.n}日との相関）`,
      });
    }
  }

  if (t.holiday) {
    const h = ratioOf(rel, (r) => Boolean(r.holiday), { min: 4, lo: 0.6, hi: 1.8 });
    if (h) {
      factors.push({
        k: 'holiday',
        ratio: h.ratio,
        label: `祝日（${t.holiday}）`,
        detail: `祝日は、ふだんより${pct(h.ratio)}傾向（過去${h.n}日との相関）`,
      });
    }
  } else if (t.isEve) {
    const e = ratioOf(rel, (r) => r.isEve && !r.holiday, { min: 4, lo: 0.6, hi: 1.8 });
    if (e) {
      factors.push({
        k: 'eve',
        ratio: e.ratio,
        label: '祝前日',
        detail: `休みの前の日は、ふだんより${pct(e.ratio)}傾向（過去${e.n}日との相関）`,
      });
    }
  }

  if (t.streak >= 3) {
    const s = ratioOf(rel, (r) => r.streak >= 3, { min: 4, lo: 0.6, hi: 1.8 });
    if (s) {
      factors.push({
        k: 'streak',
        ratio: s.ratio,
        label: `${t.streak}連休のなか`,
        detail: `3連休以上の日は、ふだんより${pct(s.ratio)}傾向（過去${s.n}日との相関）`,
      });
    }
  }

  if (t.payday !== PAYDAY_NONE && Math.abs(t.payday) <= 3) {
    const p = ratioOf(rel, (r) => r.payday !== PAYDAY_NONE && Math.abs(r.payday) <= 3, { min: 8 });
    if (p && Math.abs(p.ratio - 1) >= 0.03) {
      factors.push({
        k: 'payday',
        ratio: p.ratio,
        label: '給料日のころ',
        detail: `給料日の前後は、ふだんより${pct(p.ratio)}傾向（過去${p.n}日との相関）`,
      });
    }
  }

  // 近くの会場で催しがある日。
  // ★これも「催しがあったから増えた」とは書かない。過去の開催日にどうだったかを並べるだけ。
  //   会場を登録した直後は開催日の記録が少ないので、そのあいだは何も足さない（当てずっぽうを混ぜない）。
  if (t.venueEvents && t.venueEvents.length) {
    const v = ratioOf(rel, (r) => r.venue, { min: 4, lo: 0.6, hi: 1.8 });
    if (v) {
      factors.push({
        k: 'venue',
        ratio: v.ratio,
        label: `近くの会場の催し（${t.venueEvents[0].venue}）`,
        detail: `近くで催しがあった日は、ほかの日より${pct(v.ratio)}傾向（過去${v.n}日との相関）`,
      });
    } else {
      basis.push({
        label: `近くの会場の催し（${t.venueEvents[0].venue}）`,
        detail: '登録された開催日の記録がまだ少ないため、見込みには足していません（記録がたまると反映されます）',
        effect: 0,
        value: null,
      });
    }
  }

  if (t.special) {
    const sp = ratioOf(rel, (r) => r.special === t.special, { min: 4, lo: 0.5, hi: 2.0 });
    if (sp) {
      factors.push({
        k: 'special',
        ratio: sp.ratio,
        label: t.special,
        detail: `${t.special}の時期は、ふだんより${pct(sp.ratio)}傾向（過去${sp.n}日との相関）`,
      });
    }
  }

  // 答え合わせから分かった「いつものかたより」を戻す。
  // これは条件の効き目ではなく、この店に対するこのやり方のクセの補正。
  if (cal?.ok) {
    factors.push({
      k: 'calibration',
      ratio: cal.ratio,
      label: 'これまでの外し方の補正',
      detail: `過去${cal.n}回の答え合わせで、${cal.biasPct > 0 ? '多めに出す' : '少なめに出す'}ことが続いていたぶんを戻しています`
        + `（ずれの真ん中 ${cal.biasPct > 0 ? '＋' : ''}${cal.biasPct}%の半分だけ）。`,
    });
  }

  // 効かせすぎを防ぐ。かけ算を重ねると、まれな日で現実離れした数字になる
  let mult = 1;
  for (const f of factors) mult *= f.ratio;
  mult = clamp(mult, 0.55, 1.9);
  const value = Math.max(0, base * mult);

  for (const f of factors) {
    basis.push({
      label: f.label,
      detail: f.detail,
      effect: Math.round((f.ratio - 1) * 1000) / 10,
      value: null,
    });
  }

  // ---- 範囲：ふだんのばらつきから出す ----
  const p25 = quantile(kept, 0.25);
  const p75 = quantile(kept, 0.75);
  const spread = base ? Math.max(0.08, (p75 - p25) / base) : 0.2;
  // 件数が少ないほど、範囲は正直に広くとる
  const widen = 1 + 1.2 / Math.sqrt(Math.max(3, kept.length));
  const half = clamp(spread * widen * 0.75, 0.08, 0.45);
  const low = Math.max(0, value * (1 - half));
  const high = value * (1 + half);

  // ---- 根拠の強さ ----
  // これは「何%当たる」という意味ではない。
  // 似た日の記録がどれだけあり、その日どうしがどれだけそろっていたか、という材料の充実度。
  // 実際の当たり具合は、答え合わせの記録（forecast_results）のほうに出す。
  const sampleScore = clamp(kept.length / 10, 0, 1);
  const spreadScore = clamp(1 - spread / 0.6, 0, 1);
  const historyScore = clamp(rows.length / 120, 0, 1);
  const weatherScore = t.group ? 1 : 0.6;
  // すでに答え合わせが20日ぶん以上あるなら、実際の外し具合も混ぜる（自己申告だけにしない）
  const hasAcc = acc && acc.days >= 20 && Number.isFinite(acc.medErrorPct);
  const accScore = hasAcc ? clamp(1 - acc.medErrorPct / 30, 0, 1) : null;

  let confPct = hasAcc
    ? Math.round(100 * (0.2 * sampleScore + 0.2 * spreadScore + 0.15 * historyScore + 0.1 * weatherScore + 0.35 * accScore))
    : Math.round(100 * (0.3 * sampleScore + 0.3 * spreadScore + 0.25 * historyScore + 0.15 * weatherScore));

  // 記録が浅いうちは、上限を低く抑える（当たっているふりをさせない）
  if (rows.length < 30) confPct = Math.min(confPct, 40);
  else if (rows.length < 60) confPct = Math.min(confPct, 60);
  else if (rows.length < 120) confPct = Math.min(confPct, 70);
  // 答え合わせがまだ無いうちは、どれだけ材料がそろっていても言い切らない
  if (!hasAcc) confPct = Math.min(confPct, 75);
  confPct = clamp(confPct, 10, 85);

  return {
    ok: true,
    label: m.label,
    unit: m.unit,
    value: round(key, value),
    low: round(key, low),
    high: round(key, high),
    base: round(key, base),
    samples: kept.length,
    dropped,
    confidencePct: confPct,
    confidence: confLabel(confPct),
    basis,
  };
}

function round(key, v) {
  if (key === 'guests') return Math.max(0, Math.round(v));
  return Math.max(0, Math.round(v / 100) * 100);
}

function pct(ratio) {
  const d = Math.round((ratio - 1) * 1000) / 10;
  if (d === 0) return 'ほぼ同じ';
  return d > 0 ? `${d}%高い` : `${Math.abs(d)}%低い`;
}

export function confLabel(p) {
  if (p >= 70) return '高め';
  if (p >= 45) return 'ふつう';
  return '低め';
}

// ===== 保存する（前日までに確定させる） =====

/**
 * 明日から先の予測を作って残す。
 *
 * わざと「今日」と「過去」は書き換えない。
 * その日が終わってから予測を上書きできてしまうと、当たり外れの記録が意味を失うため。
 */
export async function saveForecasts(ctx, { days = 10 } = {}) {
  const today = todayJst();
  const from = addDays(today, 1);
  const histTo = addDays(today, -1);
  const rows = await loadHistory(ctx, addDays(histTo, -364), histTo);
  if (rows.length < MIN_DAYS) return { ok: false, reason: 'NOT_ENOUGH', haveDays: rows.length };

  const ts = nowIso();
  const acc = await accuracy(ctx, { days: 120, metric: 'sales' });
  const cal = Object.fromEntries(await Promise.all(
    METRICS.map(async (m) => [m.key, await calibration(ctx, { metric: m.key, days: 120 })]),
  ));
  let saved = 0;
  for (let i = 0; i < days; i += 1) {
    const d = addDays(from, i);
    const t = await targetContext(ctx, d);
    const pre = rows.slice();
    pre.__ctx = t;
    pre.__acc = acc;
    pre.__cal = cal;
    const p = await predictDay(ctx, d, pre);
    if (!p.ok) continue;
    for (const m of METRICS) {
      const r = p.metrics[m.key];
      if (!r?.ok) continue;
      // 同じ日を二重に持たないよう、消してから入れ直す
      await withTx(async (tx) => {
        const c = ctx.bind(tx);
        await c.run(`DELETE FROM forecasts WHERE SCOPE() AND target_date = ? AND metric = ?`, [d, m.key]);
        await c.insert('forecasts', {
          target_date: d,
          metric: m.key,
          value: r.value,
          low: r.low,
          high: r.high,
          confidence: r.confidence,
          confidence_pct: r.confidencePct,
          basis_json: JSON.stringify({ basis: r.basis, samples: r.samples, context: pickContext(t) }),
          engine: 'rule',
          created_at: ts,
        });
      });
      saved += 1;
    }
  }
  return { ok: true, saved, from, days };
}

function pickContext(t) {
  return {
    dowName: t.dowName, holiday: t.holiday, isEve: t.isEve, streak: t.streak,
    special: t.special, dayLabel: t.dayLabel,
    weatherText: t.weatherText, weatherFrom: t.weatherFrom, tempMax: t.tempMax,
    campaigns: t.campaigns.map((c) => c.name),
    venueEvents: (t.venueEvents || []).map((v) => `${v.venue}：${v.title}`),
  };
}

// ===== 当たり外れを記録する =====

/**
 * その日の「実際そうだった数字」を、予測と同じ metric の名前で集める。
 *
 * ★ここが読むのは事実の表（第1層・第1.5層）だけ。
 *   予測の表からは1つも取らない。予測で予測を採点すると、いつまでも満点になってしまう。
 */
async function actualsFor(ctx, date, fact) {
  const map = new Map();
  map.set('sales', Number(fact.sales || 0));
  map.set('guests', Number(fact.guests || 0));

  // 時間帯別の売上と、その時間に席についた人数
  const hrs = await ctx.query(
    `SELECT hour, sales, guests FROM daily_hour_facts WHERE SCOPE() AND business_date = ? ORDER BY hour`,
    [date],
  );
  const arrivals = new Map();
  for (const h of hrs) {
    const hour = Number(h.hour);
    map.set(`hour_sales:${hour}`, Number(h.sales || 0));
    arrivals.set(hour, Number(h.guests || 0));
  }

  // 必要人数の「実際」は、その日ほんとうに来たお客さんから計算し直した人数。
  // 組んだシフトの人数ではない（それは店が決めた数であって、必要だった数ではないため）。
  const perStaff = Math.max(4, Number(ctx.store?.guests_per_staff) || 12);
  const minStaff = Math.max(1, Number(ctx.store?.min_staff) || 2);
  for (const [hour, come] of arrivals) {
    const before = arrivals.get(hour - 1) || 0;
    const inStore = come + before * 0.6;
    map.set(`staff:${hour}`, Math.max(minStaff, Math.ceil(inStore / perStaff)));
  }

  // 商品ごとに実際に出た数
  const items = await ctx.query(
    `SELECT item_id, SUM(qty) AS qty FROM daily_item_facts
      WHERE SCOPE() AND business_date = ? AND item_id IS NOT NULL GROUP BY item_id`,
    [date],
  );
  for (const r of items) map.set(`item_qty:${Number(r.item_id)}`, Number(r.qty || 0));

  // 材料ごとに実際に減った量（使用の記録。qty はマイナスで入っているので符号を戻す）
  const used = await ctx.query(
    `SELECT ingredient_id, SUM(-qty) AS q FROM stock_moves
      WHERE SCOPE() AND business_date = ? AND kind = 'use' GROUP BY ingredient_id`,
    [date],
  );
  for (const r of used) map.set(`stock_use:${Number(r.ingredient_id)}`, Math.round(Number(r.q || 0) * 100) / 100);

  return map;
}

/**
 * 予測と実際を突き合わせて残す。
 * 外れた日も必ず残す。都合の良い日だけ数えると、精度の表示が嘘になる。
 */
export async function scoreDay(ctx, date) {
  const fact = await ctx.first(
    `SELECT sales, guests FROM daily_facts WHERE SCOPE() AND business_date = ?`, [date]
  );
  if (!fact) return { ok: false, reason: 'NO_FACT' };
  const fcs = await ctx.query(
    `SELECT metric, value, low, high, basis_json FROM forecasts WHERE SCOPE() AND target_date = ?`, [date]
  );
  if (!fcs.length) return { ok: false, reason: 'NO_FORECAST' };

  const actualOf = await actualsFor(ctx, date, fact);
  const ts = nowIso();
  const scoreRows = [];
  for (const f of fcs) {
    const actual = actualOf.get(f.metric);
    if (actual === undefined) continue;
    // 休業日・その日ぜんぜん出なかったものは外れとして数えない
    // （0で割れないうえ、予測の良し悪しとも言い切れないため）
    if (!actual) continue;
    const predicted = Number(f.value || 0);
    const errPct = Math.round(((predicted - actual) / actual) * 1000) / 10;
    const inRange = predicted && f.low !== null && f.high !== null
      ? actual >= Number(f.low) && actual <= Number(f.high)
      : null;
    scoreRows.push({
      target_date: date,
      metric: f.metric,
      predicted,
      actual,
      error_pct: errPct,
      cause_json: JSON.stringify({ inRange, low: f.low, high: f.high, family: familyOf(f.metric) }),
      created_at: ts,
    });
  }
  if (!scoreRows.length) return { ok: true, scored: 0 };

  // その日ぶんはまとめて1回で入れ直す。件数が多い（時間帯・商品・材料ぶん）ので、
  // 1件ずつ取引を開けると夜間処理が間に合わなくなる。
  await withTx(async (tx) => {
    const c = ctx.bind(tx);
    await c.run(`DELETE FROM forecast_results WHERE SCOPE() AND target_date = ?`, [date]);
    for (const r of scoreRows) await c.insert('forecast_results', r);
  });
  return { ok: true, scored: scoreRows.length };
}

/** ここ最近の当たり具合。良い数字だけを選ばず、そのまま出す */
export async function accuracy(ctx, { days = 60, metric = 'sales' } = {}) {
  const from = addDays(todayJst(), -days);
  const rows = await ctx.query(
    `SELECT target_date, predicted, actual, error_pct, cause_json FROM forecast_results
      WHERE SCOPE() AND metric = ? AND target_date >= ? ORDER BY target_date DESC`,
    [metric, from]
  );
  if (!rows.length) return { metric, days: 0, rows: [] };

  const errs = rows.map((r) => Math.abs(Number(r.error_pct)));
  const inRange = rows.filter((r) => {
    try { return JSON.parse(r.cause_json || '{}').inRange === true; } catch { return false; }
  }).length;
  return {
    metric,
    days: rows.length,
    // 平均だと大外しの1日に引っぱられるので、真ん中の値も一緒に出す
    avgErrorPct: Math.round((errs.reduce((s, v) => s + v, 0) / errs.length) * 10) / 10,
    medErrorPct: Math.round(median(errs) * 10) / 10,
    within10: Math.round((errs.filter((v) => v <= 10).length / errs.length) * 100),
    within20: Math.round((errs.filter((v) => v <= 20).length / errs.length) * 100),
    inRangePct: Math.round((inRange / rows.length) * 100),
    rows: rows.slice(0, 30).map((r) => ({
      date: r.target_date,
      predicted: Math.round(Number(r.predicted)),
      actual: Math.round(Number(r.actual)),
      errorPct: Number(r.error_pct),
      inRange: (() => { try { return JSON.parse(r.cause_json || '{}').inRange === true; } catch { return false; } })(),
    })),
  };
}

/**
 * 6種類ぜんぶの当たり具合を、種類ごとにまとめて返す。
 *
 * ★記録が少ないうちは、数字を出さずに「まだ判断できません」と返す。
 *   3日ぶんの記録で「ずれ2%」と出すと、当たっているように見えてしまうため。
 */
export async function accuracySummary(ctx, { days = 120 } = {}) {
  const from = addDays(todayJst(), -days);
  const rows = await ctx.query(
    `SELECT target_date, metric, predicted, actual, error_pct, cause_json FROM forecast_results
      WHERE SCOPE() AND target_date >= ?`,
    [from],
  );

  const byFamily = new Map(METRIC_FAMILIES.map((f) => [f.key, []]));
  for (const r of rows) {
    const fam = familyOf(r.metric);
    if (!byFamily.has(fam)) continue;
    byFamily.get(fam).push(r);
  }

  const families = METRIC_FAMILIES.map((f) => {
    const list = byFamily.get(f.key) || [];
    const dates = new Set(list.map((r) => r.target_date));
    const base = {
      key: f.key, label: f.label, unit: f.unit,
      records: list.length, dates: dates.size,
    };
    if (list.length < MIN_RESULT_ROWS || dates.size < MIN_RESULT_DAYS) {
      return {
        ...base,
        enough: false,
        message: list.length
          ? `現在の記録数では精度判断できません（いまは${dates.size}日ぶん・${list.length}件。${MIN_RESULT_DAYS}日ぶん・${MIN_RESULT_ROWS}件たまると出します）。`
          : '現在の記録数では精度判断できません（まだ答え合わせの記録がありません）。',
      };
    }
    const errs = list.map((r) => Math.abs(Number(r.error_pct)));
    const signed = list.map((r) => Number(r.error_pct));
    const inRange = list.filter((r) => {
      try { return JSON.parse(r.cause_json || '{}').inRange === true; } catch { return false; }
    }).length;
    return {
      ...base,
      enough: true,
      avgErrorPct: Math.round((errs.reduce((s, v) => s + v, 0) / errs.length) * 10) / 10,
      medErrorPct: Math.round(median(errs) * 10) / 10,
      // ＋なら出しすぎ、−なら出し足りない。かたよりが続くなら次の予測で補正する材料になる
      biasPct: Math.round(median(signed) * 10) / 10,
      within10: Math.round((errs.filter((v) => v <= 10).length / errs.length) * 100),
      within20: Math.round((errs.filter((v) => v <= 20).length / errs.length) * 100),
      inRangePct: Math.round((inRange / list.length) * 100),
    };
  });

  return {
    ok: true,
    days,
    families,
    totalRecords: rows.length,
    note: '予測 → 実績 → ずれ、をそのまま残しています。外れた日も抜かずに数えています。',
  };
}

/**
 * 「いつも出しすぎている／出し足りない」というかたよりを見つけて、次の予測にかける倍率を返す。
 *
 * ここが Prediction Feedback Loop の「改善」にあたる部分。
 * ただしやることは1つだけ——ずれの真ん中ぶんを戻すこと。
 * 凝った学習をさせないのは、なぜその数字になったのかを店長に説明できなくなるため。
 *
 * かけるのは、記録が十分たまっていて、かつ、かたよりが片側に続いているときだけ。
 */
export async function calibration(ctx, { metric = 'sales', days = 120 } = {}) {
  const from = addDays(todayJst(), -days);
  const rows = await ctx.query(
    `SELECT target_date, error_pct FROM forecast_results
      WHERE SCOPE() AND metric = ? AND target_date >= ?`,
    [metric, from],
  );
  const none = { ok: false, ratio: 1, n: rows.length, biasPct: null };
  if (rows.length < 20) return none;

  const signed = rows.map((r) => Number(r.error_pct));
  const bias = median(signed);
  if (!Number.isFinite(bias) || Math.abs(bias) < 5) return { ...none, biasPct: Math.round(bias * 10) / 10 };

  // 片側に寄っているかを確かめる。半々に散らばっているだけなら、それは偏りではなくばらつき。
  const overs = signed.filter((v) => v > 0).length;
  const share = overs / signed.length;
  if (share > 0.35 && share < 0.65) return { ...none, biasPct: Math.round(bias * 10) / 10 };

  // 一度に直しすぎない。半分だけ戻し、上下15%で頭打ちにする。
  const ratio = clamp(1 / (1 + (bias / 100) * 0.5), 0.85, 1.15);
  return {
    ok: true,
    ratio,
    n: rows.length,
    biasPct: Math.round(bias * 10) / 10,
    overShare: Math.round(share * 100),
  };
}

// ===== ふだんと違う日を見つける =====

/**
 * 「いつもと違った日」を拾う。
 * これは予測ではなく、過ぎた日の振り返り。理由までは決めつけず、その日にあった事実を添える。
 */
export async function anomalies(ctx, { days = 90, limit = 12 } = {}) {
  const to = addDays(todayJst(), -1);
  const from = addDays(to, -days);
  const rows = await loadHistory(ctx, from, to);
  if (rows.length < 20) return { ok: false, reason: 'NOT_ENOUGH', haveDays: rows.length, rows: [] };

  const evs = await ctx.query(
    `SELECT business_date, title FROM day_events WHERE SCOPE() AND business_date >= ? AND business_date <= ?`,
    [from, to]
  );
  const evMap = new Map();
  for (const e of evs) {
    const list = evMap.get(e.business_date) || [];
    list.push(e.title);
    evMap.set(e.business_date, list);
  }

  const out = [];
  for (const r of rows) {
    // 比べる相手は「同じ曜日のふだん」。曜日ごとの差を異常だと言わないため
    const peers = rows.filter((x) => x.dow === r.dow && x.date !== r.date).map((x) => x.sales);
    if (peers.length < 5) continue;
    const med = median(peers);
    if (!med) continue;
    const diff = (r.sales - med) / med;
    if (Math.abs(diff) < 0.3) continue;
    out.push({
      date: r.date,
      sales: r.sales,
      guests: r.guests,
      normal: Math.round(med),
      diffPct: Math.round(diff * 1000) / 10,
      dowName: dowLabel(r.dow),
      holiday: r.holiday,
      weather: GROUP_LABEL[r.group] || '',
      tempMax: r.tempMax,
      events: evMap.get(r.date) || [],
    });
  }
  out.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
  return { ok: true, rows: out.slice(0, limit), checked: rows.length };
}

// ===== 時間帯ごとの見込みと、必要な人手 =====

/** 同じ曜日で、時間帯の記録がある日を集める（何時に何人・いくら） */
async function hourHistory(ctx, date, dow) {
  const to = addDays(date, -1);
  const from = addDays(to, -180);
  const rows = await ctx.query(
    `SELECT h.business_date, h.hour, h.sales, h.guests
       FROM daily_hour_facts h
      WHERE SCOPE(h) AND h.business_date >= ? AND h.business_date <= ?
      ORDER BY h.business_date, h.hour`,
    [from, to]
  );
  if (!rows.length) return { days: [], usedLabel: '' };

  const byDay = new Map();
  for (const r of rows) {
    const list = byDay.get(r.business_date) || [];
    list.push({ hour: Number(r.hour), sales: Number(r.sales || 0), guests: Number(r.guests || 0) });
    byDay.set(r.business_date, list);
  }
  const all = [...byDay.entries()]
    .map(([d, hours]) => ({ date: d, dow: new Date(`${d}T00:00:00Z`).getUTCDay(), hours }))
    .filter((d) => d.hours.some((h) => h.sales > 0));

  // まずは同じ曜日だけで見る。足りなければ全曜日に広げる（無いものを作らない）
  const same = all.filter((d) => d.dow === dow);
  if (same.length >= 4) return { days: same, usedLabel: `${dowLabel(dow)}曜日の過去${same.length}日` };
  if (all.length >= 4) return { days: all, usedLabel: `曜日を問わず過去${all.length}日` };
  return { days: [], usedLabel: '', haveDays: all.length };
}

/**
 * 時間帯ごとの見込みと、その時間に必要な人手の目安。
 *
 * やっていることは単純で、
 *  1. 過去の同じ曜日で「1日のうち何時に何％売れたか」の割合を出し（真ん中の値）、
 *  2. その日の見込み合計に、その割合をかけている。
 *
 * 時間帯の売上をそのまま平均しないのは、
 * 「よく売れた日」と「静かな日」が混ざると山の高さがぼやけ、
 * ピークの時間そのものがずれて見えてしまうため。割合で見れば山の形は崩れない。
 *
 * 必要な人手は「その時間に席についた人数」ではなく「そのときお店にいる人数」で出す。
 * 19時に来たお客様は20時にもまだ席にいるので、席についた人数だけで数えると
 * いちばん忙しい時間の人手が足りなくなる。
 */
export async function hourlyPlan(ctx, date = null) {
  const d = date || todayJst();
  const day = await predictDay(ctx, d);
  if (!day.ok) return { ok: false, date: d, reason: day.reason, message: day.message };

  const dow = day.context.dow;
  const { days, usedLabel, haveDays } = await hourHistory(ctx, d, dow);
  if (!days.length) {
    return {
      ok: false, date: d, reason: 'NOT_ENOUGH_HOURS', haveDays: haveDays || 0,
      message: '時間帯ごとの記録がまだ足りません。数日ぶん営業すると、何時が忙しいかを出せます。',
    };
  }

  // 各日を「1日の合計に対する割合」に直してから重ねる
  const hours = new Set();
  const shareSales = new Map();
  const shareGuests = new Map();
  for (const dd of days) {
    const totS = dd.hours.reduce((s, h) => s + h.sales, 0);
    const totG = dd.hours.reduce((s, h) => s + h.guests, 0);
    for (const h of dd.hours) {
      hours.add(h.hour);
      if (totS > 0) {
        const l = shareSales.get(h.hour) || [];
        l.push(h.sales / totS);
        shareSales.set(h.hour, l);
      }
      if (totG > 0) {
        const l = shareGuests.get(h.hour) || [];
        l.push(h.guests / totG);
        shareGuests.set(h.hour, l);
      }
    }
  }
  const hourList = [...hours].sort((a, b) => a - b);
  const medOf = (map, h) => median(map.get(h) || []) || 0;
  const sumS = hourList.reduce((s, h) => s + medOf(shareSales, h), 0) || 1;
  const sumG = hourList.reduce((s, h) => s + medOf(shareGuests, h), 0) || 0;

  const totalSales = day.metrics.sales?.ok ? day.metrics.sales.value : 0;
  const totalGuests = day.metrics.guests?.ok ? day.metrics.guests.value : 0;
  const lowRate = day.metrics.sales?.ok && day.metrics.sales.value
    ? day.metrics.sales.low / day.metrics.sales.value : 0.8;
  const highRate = day.metrics.sales?.ok && day.metrics.sales.value
    ? day.metrics.sales.high / day.metrics.sales.value : 1.2;

  const perStaff = Math.max(4, Number(ctx.store?.guests_per_staff) || 12);
  const minStaff = Math.max(1, Number(ctx.store?.min_staff) || 2);
  const seatRow = await ctx.first(`SELECT COALESCE(SUM(seats),0) AS seats FROM tables WHERE SCOPE()`);
  const seats = Number(seatRow?.seats || 0);

  const arrivals = hourList.map((h) => (sumG ? (medOf(shareGuests, h) / sumG) * totalGuests : 0));

  // 実際に測った待ち時間。記録が足りない時間帯は入らないので、そこには何も表示しない。
  // ★ここに入るのは受付ボタンとご案内ボタンの時刻差だけ。分数を計算で作ることはしない。
  const waits = await waitForSlots(ctx, dow, hourList, { days: 90 });

  const rows = hourList.map((h, i) => {
    const sales = (medOf(shareSales, h) / sumS) * totalSales;
    // そのときお店にいる人数の目安＝この時間に来た人＋前の時間に来た人（2時間ほど滞在するとみて）
    const inStore = arrivals[i] + (i > 0 ? arrivals[i - 1] * 0.6 : 0);
    const staff = Math.max(minStaff, Math.ceil(inStore / perStaff));
    return {
      hour: h,
      sales: Math.round(sales / 100) * 100,
      salesLow: Math.round((sales * lowRate) / 100) * 100,
      salesHigh: Math.round((sales * highRate) / 100) * 100,
      arrivals: Math.round(arrivals[i]),
      inStore: Math.round(inStore),
      staff,
      // 人手も幅で持つ。1人単位なので幅は狭いが、「ぴったり何人」と言い切らないため。
      staffLow: Math.max(minStaff, Math.ceil((inStore * lowRate) / perStaff)),
      staffHigh: Math.max(minStaff, Math.ceil((inStore * highRate) / perStaff)),
      // 席がいっぱいに近づきそうかどうか。
      nearFull: seats > 0 && inStore >= seats * 0.9,
      // 実測の待ち時間（記録が足りない時間帯は null。ここを推測で埋めることは絶対にしない）
      waitAvgMinutes: waits.get(h)?.avgMinutes ?? null,
      waitSamples: waits.get(h)?.samples ?? 0,
      samples: (shareSales.get(h) || []).length,
    };
  });

  const peak = rows.reduce((a, b) => (b.sales > (a?.sales ?? -1) ? b : a), null);
  const busiest = rows.reduce((a, b) => (b.inStore > (a?.inStore ?? -1) ? b : a), null);
  const notes = [];
  if (peak) notes.push(`いちばん売上が立ちそうなのは ${peak.hour}時台（${usedLabel}の形から）です。`);
  if (busiest && busiest.staff > minStaff) {
    notes.push(`${busiest.hour}時台がいちばん混みそうです。目安として ${busiest.staff}人いると回しやすい見込みです。`);
  }
  const full = rows.filter((r) => r.nearFull).map((r) => `${r.hour}時台`);
  if (full.length) {
    notes.push(`${full.join('・')}は満席に近づく可能性があります。`);
  }
  // 実際に測った待ち時間がある時間帯だけ、そのまま添える（測っていない時間帯には触れない）
  const measured = rows.filter((r) => r.waitAvgMinutes !== null);
  if (measured.length) {
    notes.push(`実際に測った待ち時間の平均：${measured.map((r) => `${r.hour}時台 ${r.waitAvgMinutes}分`).join('・')}（受付とご案内の時刻の差）。`);
  } else {
    notes.push('お待たせした時間は、受付とご案内をボタンで記録すると実測で出せるようになります（記録が無いうちは推測の分数を出しません）。');
  }

  return {
    ok: true,
    date: d,
    basis: usedLabel,
    seats,
    perStaff,
    minStaff,
    totalSales,
    totalGuests,
    rows,
    peakHour: peak?.hour ?? null,
    busiestHour: busiest?.hour ?? null,
    notes,
  };
}

// ===== 今日の作戦 =====

/**
 * 今日ぶんの見込みと、そこから素直に言えることだけを返す。
 * 「絶対に売れます」のような言い切りはしない。判断するのは人。
 */
export async function todayPlan(ctx, date = null) {
  const d = date || todayJst();
  const p = await predictDay(ctx, d);
  if (!p.ok) return { ok: false, date: d, ...p };

  const stored = await ctx.query(
    `SELECT metric, value, low, high, confidence, confidence_pct FROM forecasts WHERE SCOPE() AND target_date = ?`, [d]
  );
  const storedMap = new Map(stored.map((r) => [r.metric, r]));

  const notes = [];
  const s = p.metrics.sales;
  const g = p.metrics.guests;

  // 直近の同じ曜日と比べて、多い日か少ない日か
  if (s?.ok) {
    const diff = s.base ? (s.value - s.base) / s.base : 0;
    if (diff >= 0.1) notes.push({ kind: 'busy', text: `いつもの${p.context.dowName}曜日より多めの見込みです（${Math.round(diff * 100)}%）。仕込みと人手を厚めに。` });
    else if (diff <= -0.1) notes.push({ kind: 'slow', text: `いつもの${p.context.dowName}曜日より少なめの見込みです（${Math.round(Math.abs(diff) * 100)}%）。仕込みを抑えると廃棄を減らせます。` });
    else notes.push({ kind: 'flat', text: `いつもの${p.context.dowName}曜日と同じくらいの見込みです。` });
  }
  if (p.context.weatherFrom === '予報' && p.context.group === 'rain') {
    notes.push({ kind: 'weather', text: '雨の予報です。過去の雨の日と似た動きになるかもしれません（断定はできません）。' });
  }
  if (p.context.venueEvents?.length) {
    const v = p.context.venueEvents[0];
    const when = v.startTime ? `${v.startTime}〜` : '';
    const km = v.distanceKm ? `徒歩・車で${v.distanceKm}kmほど` : '';
    const people = v.people ? `想定${v.people.toLocaleString()}人` : '';
    notes.push({
      kind: 'venue',
      text: `近くの${v.venue}で「${v.title}」があります（${[when, people, km].filter(Boolean).join('・')}）。終わったあとの時間帯に人が動く可能性があります。`,
    });
  }
  if (p.context.campaigns.length) {
    notes.push({ kind: 'campaign', text: `いま動いている企画：${p.context.campaigns.map((c) => c.name).join('、')}。効果は後日、同じ条件の日と比べて確かめられます。` });
  }
  if (s?.ok && s.confidencePct < 45) {
    notes.push({ kind: 'caution', text: '似た日の記録がまだ少ないため、この見込みは目安として見てください。' });
  }

  return {
    ok: true,
    date: d,
    context: p.context,
    sales: s,
    guests: g,
    // 前日までに確定していた予測（あとから作った参考値と区別する）
    fixed: {
      sales: storedMap.get('sales') ? Number(storedMap.get('sales').value) : null,
      guests: storedMap.get('guests') ? Number(storedMap.get('guests').value) : null,
    },
    notes,
  };
}
