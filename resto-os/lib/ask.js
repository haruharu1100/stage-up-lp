/**
 * 言葉で聞ける検索。
 *
 * 「先月の雨の土曜、どうだった？」と日本語で書くと、
 * 条件に当てはまる日を実際に数えて、根拠つきで答える場所。
 *
 * いちばん大事な考え方:
 *   **数字はAIに書かせない。** AIがやるのは「質問を絞り込み条件に読み替える」ところまで。
 *   答えの数字は必ずこのファイルがデータベースから数えて出す。
 *   だから、それらしい嘘の数字が出ることが原理的に起きない。
 *   AIの鍵が無くても、日本語の言い回しから条件を読み取って同じように動く。
 *
 * 守っている決まりごと:
 *  1. 必ず「見た日」を全部返す。何日を根拠にした答えなのかを隠さない。
 *  2. 該当が少ないときは、数字は出しても「傾向とは言えない」と添える。
 *  3. 比べるときは同じ曜日のふだんと比べる（曜日の差を二重に数えないため）。
 *  4. 原因は言わない。「雨だから減った」ではなく「雨の日は◯%低めでした」と書く。
 *  5. 原価・粗利は、見てよい権限の人にしか出さない。
 *  6. 答えは事実（第1層）だけで組み立てる。予測（第2層）は混ぜない。
 */

import { addDays, dayDiff } from './learn.js';
import { businessDate, withTx } from './db.js';
import { dowLabel, calendarFacts, PAYDAY_NONE } from './domain/calendar.js';
import { weatherGroup } from './weather/open-meteo.js';

const MAX_SPAN_DAYS = 1100; // 3年ぶんまで。うっかり全件読み込みを防ぐ

// ===== 小さな道具 =====

function median(arr) {
  const a = arr.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

function mean(arr) {
  const a = arr.filter((v) => Number.isFinite(v));
  if (!a.length) return 0;
  return Math.round(a.reduce((s, v) => s + v, 0) / a.length);
}

const yen = (v) => `${Math.round(Number(v) || 0).toLocaleString('ja-JP')}円`;
const nin = (v) => `${Math.round(Number(v) || 0).toLocaleString('ja-JP')}人`;
const signedPct = (v) => `${v > 0 ? '+' : ''}${v}%`;

/** 全角の数字・記号を半角に寄せて、表記ゆれを減らす */
function normalize(s) {
  return String(s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[　\s]+/g, ' ')
    .trim();
}

// ===== 質問を条件に読み替える =====

const DOW_WORDS = [
  [/日曜|にちよう/, 0], [/月曜|げつよう/, 1], [/火曜|かよう/, 2], [/水曜|すいよう/, 3],
  [/木曜|もくよう/, 4], [/金曜|きんよう/, 5], [/土曜|どよう/, 6],
];

const WEATHER_WORDS = [
  [/雨|あめ|雨天/, 'rain', '雨の日'],
  [/雪/, 'snow', '雪の日'],
  [/雷/, 'storm', '雷雨の日'],
  [/晴れ|晴天|はれ/, 'clear', '晴れの日'],
  [/くもり|曇り|曇天/, 'cloudy', 'くもりの日'],
];

const METRICS = {
  sales: { key: 'sales', label: '売上', fmt: yen, sum: true },
  guests: { key: 'guests', label: '客数', fmt: nin, sum: true },
  avgSpend: { key: 'avgSpend', label: '客単価', fmt: yen, sum: false },
  checks: { key: 'checks', label: '会計数', fmt: (v) => `${v}件`, sum: true },
  profit: { key: 'profit', label: '粗利', fmt: yen, cost: true, sum: true },
};

/**
 * 聞かれた指標が使えるかどうかを決める。
 * 粗利は見てよい人にしか出さない。黙ってすり替えず、そのことを言う。
 */
function pickMetric(name, seeCost) {
  const m = METRICS[name] || METRICS.sales;
  if (m.cost && !seeCost) {
    return { metric: METRICS.sales, denied: '粗利は、原価を見られる権限の方だけがご覧になれます。ここでは売上でお答えします。' };
  }
  return { metric: m, denied: '' };
}

/** 「先月」「今月」など、期間の言い回しを日付の範囲に直す */
function parsePeriod(q, today) {
  const [ty, tm] = today.split('-').map(Number);
  const monthRange = (y, m) => {
    const from = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from, to: `${from.slice(0, 8)}${String(last).padStart(2, '0')}`, label: `${y}年${m}月` };
  };

  // 2026-08 / 2026年8月
  const ym = q.match(/(20\d{2})\s*[年\-\/]\s*(1[0-2]|0?[1-9])\s*月?/);
  if (ym) return monthRange(Number(ym[1]), Number(ym[2]));

  if (/先月|前月/.test(q)) {
    const m = tm === 1 ? 12 : tm - 1;
    return monthRange(tm === 1 ? ty - 1 : ty, m);
  }
  if (/今月/.test(q)) return { ...monthRange(ty, tm), to: today };
  if (/去年|昨年/.test(q)) {
    const only = q.match(/(1[0-2]|0?[1-9])\s*月/);
    if (only) return monthRange(ty - 1, Number(only[1]));
    return { from: `${ty - 1}-01-01`, to: `${ty - 1}-12-31`, label: `${ty - 1}年` };
  }
  if (/先週/.test(q)) {
    const d = new Date(`${today}T00:00:00Z`).getUTCDay();
    const thisMon = addDays(today, -((d + 6) % 7));
    return { from: addDays(thisMon, -7), to: addDays(thisMon, -1), label: '先週' };
  }
  if (/今週/.test(q)) {
    const d = new Date(`${today}T00:00:00Z`).getUTCDay();
    return { from: addDays(today, -((d + 6) % 7)), to: today, label: '今週' };
  }
  if (/きのう|昨日/.test(q)) {
    const y = addDays(today, -1);
    return { from: y, to: y, label: `${y}` };
  }
  if (/きょう|今日/.test(q)) return { from: today, to: today, label: `${today}` };

  // 「◯月」だけ（年をまたがないよう、未来になるなら去年の同月とみなす）
  const only = q.match(/(?:^|[^0-9])(1[0-2]|0?[1-9])\s*月/);
  if (only) {
    const m = Number(only[1]);
    const y = m > tm ? ty - 1 : ty;
    const r = monthRange(y, m);
    return { ...r, to: r.to > today ? today : r.to };
  }

  // 「直近30日」「過去3ヶ月」「この1年」
  const n = q.match(/(?:直近|過去|ここ|この)\s*(\d{1,3})\s*(日|週間|ヶ月|か月|カ月|ケ月|month|年)/);
  if (n) {
    const v = Number(n[1]);
    const unit = n[2];
    const days = unit === '日' ? v : unit === '週間' ? v * 7 : unit === '年' ? v * 365 : v * 30;
    return { from: addDays(today, -(Math.min(days, MAX_SPAN_DAYS) - 1)), to: today, label: `直近${v}${unit}` };
  }

  return { from: addDays(today, -89), to: today, label: '直近90日', fallback: true };
}

/**
 * 質問を、絞り込み条件のかたまりに読み替える。
 * ここは全部「言い回しの照合」でやる。AIの鍵が無くても動くようにするため。
 */
export function parseQuestion(text, today = businessDate()) {
  const q = normalize(text);
  const period = parsePeriod(q, today);
  const cond = [];

  // 曜日（複数可）
  const dows = [];
  for (const [re, d] of DOW_WORDS) if (re.test(q)) dows.push(d);
  if (/平日/.test(q)) { cond.push({ type: 'weekday', label: '平日' }); }
  if (/週末|土日/.test(q)) { cond.push({ type: 'weekend', label: '週末（土日）' }); }
  if (dows.length) cond.push({ type: 'dow', values: dows, label: dows.map((d) => `${dowLabel(d)}曜`).join('・') });

  // 天気
  for (const [re, group, label] of WEATHER_WORDS) {
    if (re.test(q)) { cond.push({ type: 'weather', value: group, label }); break; }
  }
  if (/暑い|猛暑|真夏日/.test(q)) cond.push({ type: 'hot', label: '暑い日（最高28度以上）' });
  if (/寒い|冷え/.test(q)) cond.push({ type: 'cold', label: '寒い日（最高12度未満）' });

  // 暦
  if (/祝日|祭日/.test(q)) cond.push({ type: 'holiday', label: '祝日' });
  if (/連休/.test(q)) cond.push({ type: 'streak', label: '連休（3日以上）' });
  if (/給料日/.test(q)) cond.push({ type: 'payday', label: '給料日の前後3日' });
  if (/月末/.test(q)) cond.push({ type: 'monthEnd', label: '月末' });
  if (/雨/.test(q) && /たくさん|大雨|強い/.test(q)) cond.push({ type: 'heavyRain', label: '雨量10mm以上' });

  // 何を知りたいか
  let metric = 'sales';
  if (/客数|お客|人数|来店/.test(q)) metric = 'guests';
  if (/客単価|単価/.test(q)) metric = 'avgSpend';
  if (/会計数|伝票|組数/.test(q)) metric = 'checks';
  if (/粗利|利益|儲け/.test(q)) metric = 'profit';

  // 質問のかたち
  let shape = 'summary';
  if (/(商品|メニュー|品|なに|何).*(売れ|出た|人気|多い)|売れ筋|ランキング|よく出/.test(q)) shape = 'items';
  if (/(いちばん|一番|最も|最高|ベスト|トップ).*(日|売れた|多かった)/.test(q) && shape !== 'items') shape = 'bestday';
  if (/(いちばん|一番|最も|最低|ワースト).*(悪|低|少な)/.test(q)) shape = 'worstday';
  if (/比べ|比較|くらべ|どっち|違い|より/.test(q)) shape = 'summary';

  return { text: String(text || '').slice(0, 200), period, cond, metric, shape };
}

// ===== 材料あつめ =====

/** 期間ぶんの営業日を、暦・天気つきで読む。休業日（売上0）は数に入れない */
async function loadDays(ctx, from, to) {
  const facts = await ctx.query(
    `SELECT business_date, sales, guests, checks_count, avg_spend, gross_profit, cost_total, source
       FROM daily_facts WHERE SCOPE() AND business_date >= ? AND business_date <= ? AND sales > 0
      ORDER BY business_date`,
    [from, to]
  );
  if (!facts.length) return [];
  const cals = await ctx.query(
    `SELECT * FROM calendar_days WHERE SCOPE() AND business_date >= ? AND business_date <= ?`, [from, to]
  );
  const wxs = await ctx.query(
    `SELECT business_date, weather_code, weather_text, temp_max, precip_mm FROM weather_actual
      WHERE SCOPE() AND business_date >= ? AND business_date <= ?`, [from, to]
  );
  const evs = await ctx.query(
    `SELECT business_date, title FROM day_events WHERE SCOPE() AND business_date >= ? AND business_date <= ?`,
    [from, to]
  );
  const calMap = new Map(cals.map((r) => [r.business_date, r]));
  const wxMap = new Map(wxs.map((r) => [r.business_date, r]));
  const evMap = new Map();
  for (const e of evs) {
    if (!evMap.has(e.business_date)) evMap.set(e.business_date, []);
    evMap.get(e.business_date).push(e.title);
  }

  return facts.map((f) => {
    const cal = calMap.get(f.business_date) || calendarFacts(f.business_date);
    const wx = wxMap.get(f.business_date);
    const code = wx?.weather_code;
    return {
      date: f.business_date,
      sales: Number(f.sales || 0),
      guests: Number(f.guests || 0),
      checks: Number(f.checks_count || 0),
      avgSpend: Number(f.avg_spend || 0),
      profit: Number(f.gross_profit || 0),
      cost: Number(f.cost_total || 0),
      dow: Number(cal.dow),
      holiday: cal.holiday_name || '',
      streak: Number(cal.streak_days || 1),
      payday: Number(cal.payday_near ?? PAYDAY_NONE),
      monthEnd: Number(cal.is_month_end || 0) === 1,
      weather: code === null || code === undefined ? '' : weatherGroup(code),
      weatherText: wx?.weather_text || '',
      tempMax: wx?.temp_max === null || wx?.temp_max === undefined ? null : Number(wx.temp_max),
      precip: wx?.precip_mm === null || wx?.precip_mm === undefined ? null : Number(wx.precip_mm),
      events: evMap.get(f.business_date) || [],
    };
  });
}

/** 条件1つを、1日の行に当てはめる */
function matchOne(c, r) {
  switch (c.type) {
    case 'dow': return c.values.includes(r.dow);
    case 'weekday': return r.dow >= 1 && r.dow <= 5 && !r.holiday;
    case 'weekend': return r.dow === 0 || r.dow === 6;
    case 'weather': return r.weather === c.value;
    case 'hot': return r.tempMax !== null && r.tempMax >= 28;
    case 'cold': return r.tempMax !== null && r.tempMax < 12;
    case 'holiday': return Boolean(r.holiday);
    case 'streak': return r.streak >= 3;
    case 'payday': return r.payday !== PAYDAY_NONE && Math.abs(r.payday) <= 3;
    case 'monthEnd': return r.monthEnd;
    case 'heavyRain': return r.precip !== null && r.precip >= 10;
    default: return true;
  }
}

/** 天気の条件が入っているのに、天気の記録が無い日が多いかどうか（正直に言うため） */
function weatherGaps(rows, cond) {
  if (!cond.some((c) => ['weather', 'hot', 'cold', 'heavyRain'].includes(c.type))) return 0;
  return rows.filter((r) => !r.weather && r.tempMax === null).length;
}

// ===== 答えを組み立てる =====

/**
 * 絞り込んだ日を、同じ曜日のふだんと比べる。
 *
 * 曜日をそろえずに「雨の日は低い」と言うと、
 * たまたま雨が平日に多かっただけ、という取り違えが起きる。
 * だから比較の相手は「同じ曜日の、条件に当てはまらない日」にしている。
 */
const DOW_TYPES = ['dow', 'weekday', 'weekend'];

function compareToNormal(hits, all, metricKey, cond) {
  const hitDates = new Set(hits.map((r) => r.date));
  // 曜日そのものだけで絞っているとき（「土曜は？」「平日は？」）は、
  // 同じ曜日どうしの比較が成り立たない。その場合だけ、期間の他の日と比べる。
  const onlyDow = cond.length > 0 && cond.every((c) => DOW_TYPES.includes(c.type));

  let base;
  let baseLabel;
  if (onlyDow) {
    base = all.filter((r) => !hitDates.has(r.date));
    baseLabel = 'この期間のそれ以外の日';
  } else {
    const dows = new Set(hits.map((r) => r.dow));
    base = all.filter((r) => dows.has(r.dow) && !hitDates.has(r.date));
    baseLabel = '同じ曜日で条件に当てはまらない日';
  }
  if (hits.length < 2 || base.length < 3) {
    return { ok: false, onlyDow, baseN: base.length };
  }
  const a = median(hits.map((r) => r[metricKey]));
  const b = median(base.map((r) => r[metricKey]));
  if (!a || !b) return { ok: false, onlyDow, baseN: base.length };
  return { ok: true, baseLabel, hit: a, base: b, diffPct: Math.round((a / b - 1) * 100), baseN: base.length };
}

/** 何日ぶんの話なのかで、言い切りの強さを変える */
function strength(n) {
  if (n === 0) return { level: 'none', note: '' };
  if (n <= 2) return { level: 'weak', note: `${n}日ぶんしかないので、傾向とは言えません。その日にたまたま何かがあった可能性があります。` };
  if (n <= 5) return { level: 'thin', note: `${n}日ぶんの話です。まだ「そういう傾向」と言い切れる数ではありません。` };
  if (n <= 11) return { level: 'ok', note: `${n}日ぶんを見ています。おおよその傾向としては使えます。` };
  return { level: 'good', note: `${n}日ぶんを見ています。傾向としてはそれなりに確かです。` };
}

function condLabel(period, cond) {
  const parts = [period.label];
  for (const c of cond) parts.push(c.label);
  return parts.join(' × ');
}

/** ふつうの質問（条件に当てはまる日はどうだったか） */
function answerSummary(parsed, rows, hits, seeCost) {
  const { metric: m, denied } = pickMetric(parsed.metric, seeCost);
  const lines = [];
  if (denied) lines.push(`※ ${denied}`);
  const label = condLabel(parsed.period, parsed.cond);

  if (!hits.length) {
    lines.push(`「${label}」に当てはまる営業日は、記録の中にありませんでした。`);
    if (!rows.length) lines.push(`そもそも ${parsed.period.from} 〜 ${parsed.period.to} の記録がまだありません。`);
    else lines.push(`この期間の営業日は ${rows.length}日ぶんありますが、条件に合う日はゼロでした。条件をゆるめてもう一度お試しください。`);
    return { text: lines.join('\n'), metric: m.key };
  }

  const vals = hits.map((r) => r[m.key]);
  const st = strength(hits.length);
  lines.push(`「${label}」は ${hits.length}日ありました。`);
  if (m.sum) lines.push(`${m.label}の合計は ${m.fmt(vals.reduce((s, v) => s + v, 0))}。`);
  lines.push(`1日あたりでは、平均 ${m.fmt(mean(vals))}／真ん中 ${m.fmt(median(vals))}（いちばん高い日 ${m.fmt(Math.max(...vals))}、低い日 ${m.fmt(Math.min(...vals))}）。`);

  // 絞り込みが無いときは「ふだんと比べる」相手がいない。無理に比較しない
  if (parsed.cond.length) {
    const cmp = compareToNormal(hits, rows, m.key, parsed.cond);
    if (cmp.ok) {
      const word = cmp.diffPct > 3 ? '高め' : cmp.diffPct < -3 ? '低め' : 'ほぼ同じ';
      lines.push(`${cmp.baseLabel}（${cmp.baseN}日）の真ん中は ${m.fmt(cmp.base)} なので、${signedPct(cmp.diffPct)}＝${word}でした。`);
      lines.push('※ これは「一緒に起きていた」という関係であって、条件が原因だと決まったわけではありません。');
    } else if (hits.length >= 2 && cmp.baseN === 0) {
      lines.push(cmp.onlyDow
        ? 'この期間はすべての日が条件に当てはまったため、比べる相手がいませんでした。'
        : 'この期間の同じ曜日は全部この条件に当てはまったので、比べる相手がいませんでした。期間を広げると比べられます。');
    } else if (hits.length >= 2) {
      lines.push(`比べる相手になる日が ${cmp.baseN}日しかないので、高い・低いの判断は出していません。期間を広げると出せることがあります。`);
    }
  }
  if (st.note) lines.push(st.note);

  const gaps = weatherGaps(hits, parsed.cond);
  if (gaps) lines.push(`※ このうち ${gaps}日は天気の記録が無いため、天気の条件では拾えていない日がある可能性があります。`);

  return { text: lines.join('\n'), metric: m.key };
}

/** いちばん多かった日／少なかった日 */
function answerExtremeDay(parsed, rows, hits, seeCost, worst) {
  const { metric: m, denied } = pickMetric(parsed.metric, seeCost);
  const label = condLabel(parsed.period, parsed.cond);
  if (!hits.length) return answerSummary(parsed, rows, hits, seeCost);

  const sorted = [...hits].sort((a, b) => (worst ? a[m.key] - b[m.key] : b[m.key] - a[m.key]));
  const top = sorted[0];
  const lines = [];
  if (denied) lines.push(`※ ${denied}`);
  lines.push(`「${label}」で${m.label}が${worst ? 'いちばん低かった' : 'いちばん高かった'}のは ${top.date}（${dowLabel(top.dow)}曜）で、${m.fmt(top[m.key])}でした。`);
  const extra = [];
  if (top.weatherText) extra.push(`天気は${top.weatherText}`);
  if (top.holiday) extra.push(`${top.holiday}`);
  if (top.events.length) extra.push(`記録された出来事：${top.events.join('・')}`);
  if (extra.length) lines.push(`この日は ${extra.join('／')}。`);
  const rest = sorted.slice(1, 5);
  if (rest.length) {
    lines.push(`次点は ${rest.map((r) => `${r.date}（${m.fmt(r[m.key])}）`).join('、')}。`);
  }
  lines.push('※ 順番は事実ですが、なぜその日が高かった（低かった）のかは、この数字だけでは分かりません。');
  return { text: lines.join('\n'), metric: m.key };
}

/** よく出た商品 */
async function answerItems(ctx, parsed, hits, seeCost) {
  const label = condLabel(parsed.period, parsed.cond);
  if (!hits.length) {
    return { text: `「${label}」に当てはまる営業日が無いため、商品を数えられませんでした。`, metric: 'items', items: [] };
  }
  const dates = hits.map((r) => r.date);
  const ph = dates.map(() => '?').join(',');
  const rows = await ctx.query(
    `SELECT name, category_name, SUM(qty) AS qty, SUM(sales) AS sales, SUM(profit) AS profit
       FROM daily_item_facts WHERE SCOPE() AND business_date IN (${ph})
      GROUP BY name ORDER BY qty DESC LIMIT 10`,
    dates
  );
  if (!rows.length) {
    return { text: `「${label}」の ${hits.length}日ぶんを見ましたが、商品ごとの記録がまだ残っていませんでした。`, metric: 'items', items: [] };
  }
  const items = rows.map((r) => ({
    name: r.name, category: r.category_name || '',
    qty: Number(r.qty || 0), sales: Number(r.sales || 0),
    profit: seeCost ? Number(r.profit || 0) : null,
  }));
  const lines = [`「${label}」の ${hits.length}日ぶんで、よく出た商品は次のとおりです。`];
  items.slice(0, 5).forEach((it, i) => {
    lines.push(`${i + 1}. ${it.name} … ${it.qty}個／${yen(it.sales)}${it.profit !== null ? `（粗利 ${yen(it.profit)}）` : ''}`);
  });
  lines.push('※ 出た数の順です。品切れだった日や、おすすめした日の影響までは分かりません。');
  return { text: lines.join('\n'), metric: 'items', items };
}

// ===== 入口 =====

/**
 * 質問に答える。保存はしない（保存は runAsk がやる）。
 *
 * 返すものの中身:
 *   answer  … そのまま読める文章
 *   basis   … 何を見て言っているか（根拠）。日付は全部入れる
 */
export async function askQuestion(ctx, text, { seeCost = false } = {}) {
  const q = String(text || '').trim();
  if (!q) throw new Error('質問が空です');

  const today = businessDate();
  const parsed = parseQuestion(q, today);
  let { from, to } = parsed.period;
  if (to > today) to = today;
  if (dayDiff(from, to) > MAX_SPAN_DAYS) from = addDays(to, -MAX_SPAN_DAYS);

  const rows = await loadDays(ctx, from, to);
  const hits = rows.filter((r) => parsed.cond.every((c) => matchOne(c, r)));

  let out;
  if (parsed.shape === 'items') out = await answerItems(ctx, parsed, hits, seeCost);
  else if (parsed.shape === 'bestday') out = answerExtremeDay(parsed, rows, hits, seeCost, false);
  else if (parsed.shape === 'worstday') out = answerExtremeDay(parsed, rows, hits, seeCost, true);
  else out = answerSummary(parsed, rows, hits, seeCost);

  const st = strength(hits.length);
  const basis = {
    period: { from, to, label: parsed.period.label, guessed: Boolean(parsed.period.fallback) },
    conditions: parsed.cond.map((c) => c.label),
    metric: out.metric,          // 権限で差し替わったあとの、実際に答えた指標
    askedMetric: parsed.metric,  // 聞かれた指標
    shape: parsed.shape,
    daysInPeriod: rows.length,
    matchedDays: hits.length,
    strength: st.level,
    dates: hits.map((r) => ({
      date: r.date, dow: dowLabel(r.dow),
      sales: r.sales, guests: r.guests, avgSpend: r.avgSpend,
      profit: seeCost ? r.profit : null,
      weather: r.weatherText, tempMax: r.tempMax,
      holiday: r.holiday, events: r.events,
    })),
    items: out.items || [],
  };

  // 条件をひとつも読み取れなかったときは、そのことを先に伝える（勝手に決めない）
  const head = [];
  if (parsed.period.fallback) head.push('※ 期間の指定が読み取れなかったので、直近90日で調べました。');
  // 「いちばん売れた日」「よく出た商品」は、絞り込みが無くても成り立つ質問なので黙っておく
  if (!parsed.cond.length && parsed.shape === 'summary') {
    head.push('※ 絞り込みの条件が読み取れなかったので、期間ぜんぶで調べました。「雨の土曜」「祝日」のように書くと絞り込めます。');
  }

  return {
    ok: true,
    question: q,
    answer: [...head, out.text].join('\n'),
    basis,
    engine: 'rule',
  };
}

/** 答えて、そのまま記録に残す（誰が何を聞いたかも追えるようにするため） */
export async function runAsk(ctx, text, { seeCost = false } = {}) {
  const res = await askQuestion(ctx, text, { seeCost });
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    await t.insert('ai_answers', {
      question: res.question,
      answer: res.answer,
      basis_json: JSON.stringify(res.basis),
      engine: res.engine,
      staff_name: ctx.staffName || '',
      created_at: now,
    });
  });
  return res;
}

/** 前に聞いた質問と答えを、新しい順に返す */
export async function listAnswers(ctx, { limit = 20 } = {}) {
  const n = Math.max(1, Math.min(Number(limit) || 20, 60));
  const rows = await ctx.query(
    `SELECT id, question, answer, basis_json, engine, staff_name, created_at
       FROM ai_answers WHERE SCOPE() ORDER BY id DESC LIMIT ${n}`
  );
  return rows.map((r) => {
    let basis = null;
    try { basis = r.basis_json ? JSON.parse(r.basis_json) : null; } catch { basis = null; }
    return {
      id: r.id, question: r.question, answer: r.answer, basis,
      engine: r.engine, staffName: r.staff_name, createdAt: r.created_at,
    };
  });
}

/**
 * 何を聞けるのかが分からないと、そもそも使われない。
 * だから最初から「そのまま押せる質問」を並べておく。
 */
export const EXAMPLES = [
  '先月の雨の土曜、どうだった？',
  '先月いちばん売れた日は？',
  '今月の祝日の客数は？',
  '先月よく出た商品は？',
  '直近30日の平日の客単価は？',
  '去年の8月の売上は？',
];
