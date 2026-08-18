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

const METRICS = [
  { key: 'sales', col: 'sales', label: '売上', unit: '円' },
  { key: 'guests', col: 'guests', label: '客数', unit: '人' },
];

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

  const metrics = {};
  for (const m of METRICS) {
    metrics[m.key] = predictMetric(usable, t, m, date, acc);
  }
  return { date, ok: true, context: t, metrics, haveDays: usable.length };
}

function predictMetric(rows, t, m, date, acc = null) {
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
  let saved = 0;
  for (let i = 0; i < days; i += 1) {
    const d = addDays(from, i);
    const t = await targetContext(ctx, d);
    const pre = rows.slice();
    pre.__ctx = t;
    pre.__acc = acc;
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
  };
}

// ===== 当たり外れを記録する =====

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

  const actualOf = { sales: Number(fact.sales || 0), guests: Number(fact.guests || 0) };
  const ts = nowIso();
  let n = 0;
  for (const f of fcs) {
    const actual = actualOf[f.metric];
    if (actual === undefined) continue;
    // 休業日は外れとして数えない（予測の良し悪しではないため）
    if (!actual) continue;
    const predicted = Number(f.value || 0);
    const errPct = actual ? Math.round(((predicted - actual) / actual) * 1000) / 10 : 0;
    const inRange = predicted && f.low !== null && f.high !== null
      ? actual >= Number(f.low) && actual <= Number(f.high)
      : null;
    await withTx(async (tx) => {
      const c = ctx.bind(tx);
      await c.run(`DELETE FROM forecast_results WHERE SCOPE() AND target_date = ? AND metric = ?`, [date, f.metric]);
      await c.insert('forecast_results', {
        target_date: date,
        metric: f.metric,
        predicted,
        actual,
        error_pct: errPct,
        cause_json: JSON.stringify({ inRange, low: f.low, high: f.high }),
        created_at: ts,
      });
    });
    n += 1;
  }
  return { ok: true, scored: n };
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
