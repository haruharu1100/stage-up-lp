/**
 * 店舗の「記憶」をつくる場所。
 *
 * 大事な決まりごと（ここを崩すと学習基盤の意味が無くなる）:
 *  1. ここが書くのは「事実」と「事実を足し算した数字」だけ。予測や推測は一切書かない。
 *  2. 何度動かしても結果が同じになる（同じ日を二重に数えない）。
 *  3. 日次の集計はいつでも作り直せる。正本はあくまで注文・会計の生データ。
 *
 * 日次集計を持つ理由は速さ。何年ぶんの注文明細を毎回なめると画面が重くなるので、
 * 1営業日1行にまとめたものを別に持ち、検索や比較はそちらを見る。
 */

import { nowIso, businessRange, withTx } from './db.js';
import { calendarFacts } from './domain/calendar.js';
import { getForecast, getActual, providerName } from './weather/provider.js';
import { weatherGroup } from './weather/open-meteo.js';

export { weatherGroup };

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function addDays(dateStr, n) {
  const t = new Date(`${dateStr}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function dayDiff(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

function rangeDates(from, to, limit = 800) {
  const out = [];
  let d = from;
  while (d <= to && out.length < limit) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

// ===== 暦 =====

/**
 * 指定期間の「暦の性質」を用意する。
 * 未来の日にも作れるようにしてあるので、売上が1件も無い日でも予測の材料になる。
 */
export async function ensureCalendar(ctx, from, to) {
  const dates = rangeDates(from, to);
  if (!dates.length) return 0;
  const have = await ctx.query(
    `SELECT business_date FROM calendar_days WHERE SCOPE() AND business_date >= ? AND business_date <= ?`,
    [from, to]
  );
  const known = new Set(have.map((r) => r.business_date));
  const missing = dates.filter((d) => !known.has(d));
  if (!missing.length) return 0;
  await withTx(async (tx) => {
    const c = ctx.bind(tx);
    for (const d of missing) await c.insert('calendar_days', calendarFacts(d));
  });
  return missing.length;
}

// ===== 天気 =====

/**
 * 場所が入っていない店は、天気を取りに行かない。
 * 未設定は空欄や null で入ってくる（Number(null) は 0 になってしまうので、先に空かどうかを見る）。
 * 緯度経度がどちらも0の地点は海の上なので、店の場所としては扱わない。
 */
function needGeo(store) {
  const raw = (v) => v === null || v === undefined || v === '';
  if (raw(store?.lat) || raw(store?.lng)) return true;
  const lat = Number(store.lat);
  const lng = Number(store.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  return lat === 0 && lng === 0;
}

/**
 * 予報を保存する。slot は「いつ時点の予報か」（am6 / am11 / pm16 / live）。
 * 同じ日について複数の時点を残すのは、
 * 「予報が雨だったのでお客様が来店を控えた」という、実際の天気とは別の動きを見るため。
 */
export async function saveForecast(ctx, { slot = 'am6', days = 7 } = {}) {
  const store = ctx.store;
  if (needGeo(store)) return { ok: false, reason: 'NO_GEO' };
  const from = todayJst();
  const to = addDays(from, Math.max(0, days - 1));
  const rows = await getForecast(store.lat, store.lng, from, to);
  const ts = nowIso();
  await withTx(async (tx) => {
    const c = ctx.bind(tx);
    for (const w of rows) {
      await c.run(`DELETE FROM weather_forecast WHERE SCOPE() AND business_date = ? AND slot = ?`, [w.date, slot]);
      await c.insert('weather_forecast', {
        business_date: w.date,
        slot,
        provider: providerName(),
        weather_code: num(w.code),
        weather_text: w.text || '',
        temp_max: num(w.tempMax), temp_min: num(w.tempMin), temp_avg: num(w.tempAvg),
        precip_mm: num(w.precipMm), precip_prob: num(w.precipProb),
        humidity: num(w.humidity), wind_speed: num(w.windSpeed),
        temp_now: num(w.tempNow), feels_like: num(w.feelsLike),
        cloud_pct: num(w.cloudPct), solar_mj: num(w.solarMj),
        snow_cm: num(w.snowCm), pressure_hpa: num(w.pressureHpa),
        fetched_at: ts,
      });
    }
  });
  await ensureCalendar(ctx, from, to);
  return { ok: true, saved: rows.length, from, to };
}

/**
 * 実績を保存する。confirmed=1 は「もうこの日の天気は動かない」という印。
 * 過去の売上を取り込んだあとの後追い補完でも、この同じ関数を使う。
 */
export async function saveActual(ctx, from, to, { confirmed = 1, overwrite = false } = {}) {
  const store = ctx.store;
  if (needGeo(store)) return { ok: false, reason: 'NO_GEO' };
  let targets = rangeDates(from, to, 400);
  if (!overwrite) {
    const have = await ctx.query(
      `SELECT business_date FROM weather_actual WHERE SCOPE() AND business_date >= ? AND business_date <= ? AND confirmed = 1`,
      [from, to]
    );
    const known = new Set(have.map((r) => r.business_date));
    targets = targets.filter((d) => !known.has(d));
  }
  if (!targets.length) return { ok: true, saved: 0, skipped: true };

  const rows = await getActual(store.lat, store.lng, targets[0], targets[targets.length - 1]);
  const wanted = new Set(targets);
  const use = rows.filter((r) => wanted.has(r.date));
  const ts = nowIso();
  await withTx(async (tx) => {
    const c = ctx.bind(tx);
    for (const w of use) {
      await c.run(`DELETE FROM weather_actual WHERE SCOPE() AND business_date = ?`, [w.date]);
      await c.insert('weather_actual', {
        business_date: w.date,
        provider: providerName(),
        weather_code: num(w.code),
        weather_text: w.text || '',
        temp_max: num(w.tempMax), temp_min: num(w.tempMin), temp_avg: num(w.tempAvg),
        precip_mm: num(w.precipMm),
        humidity: num(w.humidity), wind_speed: num(w.windSpeed),
        temp_now: num(w.tempNow), feels_like: num(w.feelsLike),
        cloud_pct: num(w.cloudPct), solar_mj: num(w.solarMj),
        snow_cm: num(w.snowCm), pressure_hpa: num(w.pressureHpa),
        confirmed: confirmed ? 1 : 0,
        fetched_at: ts,
      });
    }
  });
  await ensureCalendar(ctx, targets[0], targets[targets.length - 1]);
  return { ok: true, saved: use.length };
}

/**
 * 記録はあるのに天気が空いている過去の日を、あとから埋める。
 *
 * この仕組みを入れる前の営業日や、取り込んだ過去の売上には天気が付いていない。
 * 天気が無いままだと「雨の日はどうだったか」を振り返れないので、あとから取り寄せる。
 * すでに確定している日には触らないので、何度動かしても上書きにはならない。
 */
export async function backfillWeather(ctx, { days = 120, cap = 60 } = {}) {
  if (needGeo(ctx.store)) return { ok: false, reason: 'NO_GEO' };
  const to = addDays(todayJst(), -1);
  const from = addDays(to, -Math.max(1, days));
  const have = await ctx.query(
    `SELECT business_date FROM weather_actual WHERE SCOPE() AND business_date >= ? AND business_date <= ? AND confirmed = 1`,
    [from, to]
  );
  const known = new Set(have.map((r) => r.business_date));
  const facts = await ctx.query(
    `SELECT business_date FROM daily_facts WHERE SCOPE() AND business_date >= ? AND business_date <= ? ORDER BY business_date DESC`,
    [from, to]
  );
  const missing = facts.map((r) => r.business_date).filter((d) => !known.has(d)).slice(0, cap);
  if (!missing.length) return { ok: true, saved: 0 };

  // 抜けている日をまとめて1回で取り寄せる（すでにある日は saveActual 側で除かれる）
  const lo = missing[missing.length - 1];
  const hi = missing[0];
  const r = await saveActual(ctx, lo, hi, { confirmed: 1 });
  return { ok: true, saved: r.saved ?? 0, from: lo, to: hi, missing: missing.length };
}

/**
 * 決めた期間の天気を、まとめて取り寄せる（過去データを取り込んだ直後に使う）。
 *
 * 毎晩の自動処理は「直近1年ぶん」しか見ないので、3年前の売上を取り込んでも
 * そのままでは天気が付かない。取り込んだ期間そのものを指定して埋められるようにする。
 * 取り寄せ先には一度に頼める日数の目安があるので、300日ずつに区切って順に頼む。
 */
export async function backfillWeatherRange(ctx, from, to) {
  if (needGeo(ctx.store)) return { ok: false, reason: 'NO_GEO' };
  // 今日の天気はまだ確定していないので、昨日までを対象にする
  const last = addDays(todayJst(), -1);
  const hi = to > last ? last : to;
  if (!from || !hi || from > hi) return { ok: true, saved: 0 };

  let saved = 0;
  let cur = from;
  for (let guard = 0; guard < 20 && cur <= hi; guard += 1) {
    const end = addDays(cur, 299);
    const chunkEnd = end > hi ? hi : end;
    const r = await saveActual(ctx, cur, chunkEnd, { confirmed: 1 });
    if (r.reason === 'NO_GEO') return r;
    saved += r.saved || 0;
    cur = addDays(chunkEnd, 1);
  }
  return { ok: true, saved };
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ===== 日次の確定集計 =====

/**
 * 1営業日ぶんの数字を、注文・会計の生データから作り直して保存する。
 * 途中で失敗しても「古い数字と新しい数字が混ざる」ことがないよう、
 * 消してから入れ直す形にしている（同じ日を二重に数えない）。
 *
 * 取り込んだ過去データ（source='import'）の日は、生データが無いので上書きしない。
 */
export async function rebuildDay(ctx, date) {
  const [s, e] = businessRange(date);

  const existing = await ctx.first(
    `SELECT source FROM daily_facts WHERE SCOPE() AND business_date = ?`, [date]
  );
  if (existing && existing.source === 'import') return { skipped: 'import' };

  const c = await ctx.first(
    `SELECT COUNT(*) AS checks, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(guests),0) AS guests,
            COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(cost_total),0) AS cost,
            COALESCE(SUM(seat_charge),0) AS seat, COALESCE(SUM(service_charge),0) AS service
       FROM checks WHERE SCOPE() AND status = 'closed' AND created_at >= ? AND created_at < ?`,
    [s, e]
  );
  const bad = await ctx.first(
    `SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS total
       FROM checks WHERE SCOPE() AND status <> 'closed' AND created_at >= ? AND created_at < ?`,
    [s, e]
  );
  const o = await ctx.first(
    `SELECT COUNT(DISTINCT order_id) AS orders, COALESCE(SUM(qty),0) AS qty,
            COALESCE(SUM(CASE WHEN via IN ('ai','upsell') THEN unit_price * qty ELSE 0 END),0) AS ai_sales
       FROM order_items WHERE SCOPE() AND status <> 'void' AND created_at >= ? AND created_at < ?`,
    [s, e]
  );
  const serve = await ctx.first(
    `SELECT AVG((julianday(served_at) - julianday(created_at)) * 1440) AS m
       FROM order_items
      WHERE SCOPE() AND status <> 'void' AND served_at <> '' AND served_at IS NOT NULL
        AND created_at >= ? AND created_at < ?`,
    [s, e]
  );
  const seatsRow = await ctx.first(`SELECT COALESCE(SUM(seats),0) AS seats FROM tables WHERE SCOPE()`);
  const closeRow = await ctx.first(
    `SELECT id FROM day_closes WHERE SCOPE() AND business_date = ?`, [date]
  );

  const hours = await ctx.query(
    `SELECT CAST(strftime('%H', datetime(created_at, '+9 hours')) AS INTEGER) AS h,
            COALESCE(SUM(unit_price * qty),0) AS sales, COALESCE(SUM(qty),0) AS qty,
            COUNT(DISTINCT order_id) AS orders
       FROM order_items WHERE SCOPE() AND status <> 'void' AND created_at >= ? AND created_at < ?
      GROUP BY h`,
    [s, e]
  );
  // 「何時に何人が席についたか」。
  // 会計の時刻ではなく、その伝票の“最初の注文”が入った時刻で数える。
  // 会計時刻で数えると、19時に来て22時に払ったお客様が「22時の客」になってしまい、
  // 人手がいちばん要る時間を読み違えるため。
  const hourGuests = await ctx.query(
    `SELECT CAST(strftime('%H', datetime(f.first_at, '+9 hours')) AS INTEGER) AS h,
            COALESCE(SUM(c.guests),0) AS guests
       FROM checks c
       JOIN (SELECT check_id, MIN(created_at) AS first_at
               FROM order_items
              WHERE SCOPE() AND status <> 'void' AND check_id IS NOT NULL
              GROUP BY check_id) f ON f.check_id = c.id
      WHERE SCOPE(c) AND c.status = 'closed' AND c.created_at >= ? AND c.created_at < ?
      GROUP BY h`,
    [s, e]
  );
  const guestsByHour = new Map(hourGuests.map((r) => [Number(r.h), Number(r.guests)]));
  const items = await ctx.query(
    `SELECT oi.name AS name, MIN(oi.item_id) AS item_id, MIN(oi.station) AS station,
            COALESCE(SUM(oi.qty),0) AS qty,
            COALESCE(SUM(oi.unit_price * oi.qty),0) AS sales,
            COALESCE(SUM(oi.cost * oi.qty),0) AS cost
       FROM order_items oi
      WHERE SCOPE(oi) AND oi.status <> 'void' AND oi.created_at >= ? AND oi.created_at < ?
      GROUP BY oi.name`,
    [s, e]
  );
  const itemPeak = await ctx.query(
    `SELECT name, CAST(strftime('%H', datetime(created_at, '+9 hours')) AS INTEGER) AS h,
            COALESCE(SUM(qty),0) AS qty
       FROM order_items WHERE SCOPE() AND status <> 'void' AND created_at >= ? AND created_at < ?
      GROUP BY name, h`,
    [s, e]
  );
  const peak = new Map();
  for (const r of itemPeak) {
    const cur = peak.get(r.name);
    if (!cur || Number(r.qty) > cur.qty) peak.set(r.name, { h: Number(r.h), qty: Number(r.qty) });
  }
  // 商品の分類名は、いま登録されている内容から引く（消された商品は空欄のまま残す）
  const cats = await ctx.query(
    `SELECT m.name AS name, m.category_id AS cid, c.name AS cname
       FROM menu_items m LEFT JOIN categories c ON c.id = m.category_id
      WHERE SCOPE(m)`
  );
  const catByName = new Map(cats.map((r) => [r.name, { id: r.cid, name: r.cname || '' }]));

  const sales = Number(c.sales);
  const guests = Number(c.guests);
  const checksCount = Number(c.checks);
  const cost = Number(c.cost);
  const seats = Number(seatsRow?.seats || 0);
  const ts = nowIso();

  const fact = {
    business_date: date,
    source: 'live',
    import_batch_id: null,
    sales,
    checks_count: checksCount,
    guests,
    orders_count: Number(o.orders),
    items_qty: Number(o.qty),
    discount: Number(c.discount),
    seat_charge: Number(c.seat),
    service_charge: Number(c.service),
    void_count: Number(bad.c),
    void_total: Number(bad.total),
    cost_total: cost,
    gross_profit: sales - cost,
    ai_sales: Number(o.ai_sales),
    avg_spend: guests ? Math.round(sales / guests) : 0,
    avg_check: checksCount ? Math.round(sales / checksCount) : 0,
    turnover: seats ? Math.round((guests / seats) * 100) / 100 : 0,
    seats,
    avg_serve_min: serve?.m ? Math.round(Number(serve.m) * 10) / 10 : 0,
    labor_cost: 0,
    staff_count: 0,
    waste_amount: 0,
    closed: closeRow ? 1 : 0,
    computed_at: ts,
  };

  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    await t.run(`DELETE FROM daily_facts WHERE SCOPE() AND business_date = ?`, [date]);
    await t.insert('daily_facts', fact);

    await t.run(`DELETE FROM daily_hour_facts WHERE SCOPE() AND business_date = ?`, [date]);
    for (const h of hours) {
      await t.insert('daily_hour_facts', {
        business_date: date,
        hour: Number(h.h),
        sales: Number(h.sales),
        qty: Number(h.qty),
        orders_count: Number(h.orders),
        guests: guestsByHour.get(Number(h.h)) || 0,
      });
    }

    await t.run(`DELETE FROM daily_item_facts WHERE SCOPE() AND business_date = ?`, [date]);
    for (const it of items) {
      const cat = catByName.get(it.name) || { id: null, name: '' };
      const itemSales = Number(it.sales);
      const itemCost = Number(it.cost);
      await t.insert('daily_item_facts', {
        business_date: date,
        item_id: it.item_id === null ? null : Number(it.item_id),
        name: it.name,
        category_id: cat.id === null || cat.id === undefined ? null : Number(cat.id),
        category_name: cat.name,
        station: it.station || '',
        qty: Number(it.qty),
        sales: itemSales,
        cost: itemCost,
        profit: itemSales - itemCost,
        peak_hour: peak.get(it.name)?.h ?? null,
      });
    }
  });

  await ensureCalendar(ctx, date, date);
  return { ok: true, date, sales, items: items.length, hours: hours.length };
}

/** まとめて作り直す（取り込み直後や、集計を入れる前の期間を埋めるとき用） */
export async function rebuildRange(ctx, from, to) {
  let n = 0;
  for (const d of rangeDates(from, to, 400)) {
    const r = await rebuildDay(ctx, d);
    if (r?.ok) n += 1;
  }
  return n;
}

/**
 * まだ記憶になっていない過去の営業日を、あとから埋める。
 *
 * この仕組みを入れる前の営業や、夜の自動処理が動かなかった日があっても、
 * 会計の記録さえ残っていれば、あとから同じ数字を作り直せる。
 * 1回に埋める日数には上限を置く（画面を待たせないため。残りは次に開いたときに続きから埋まる）。
 */
export async function backfillMissing(ctx, from, to, cap = 40) {
  // 会計があるのに、まとめが無い日を探す。営業日は 05:00 JST 区切りなので UTC に4時間足して日付を取る
  const rows = await ctx.query(
    `SELECT DISTINCT substr(datetime(c.created_at, '+4 hours'), 1, 10) AS d
       FROM checks c
      WHERE SCOPE(c) AND c.status = 'closed'
        AND c.created_at >= ? AND c.created_at < ?
      ORDER BY d DESC`,
    [businessRange(from)[0], businessRange(to)[1]]
  );
  const have = await ctx.query(
    `SELECT business_date FROM daily_facts WHERE SCOPE() AND business_date >= ? AND business_date <= ?`,
    [from, to]
  );
  const known = new Set(have.map((r) => r.business_date));
  const todo = rows.map((r) => r.d).filter((d) => d && d >= from && d <= to && !known.has(d)).slice(0, cap);
  for (const d of todo) await rebuildDay(ctx, d);
  return todo.length;
}

// ===== 学習の進み具合 =====

const PHASES = [
  { max: 30, key: 'start', name: '初期学習', desc: 'その店のふだんの形をおぼえている段階です。' },
  { max: 90, key: 'trend', name: '傾向形成', desc: '曜日ごとの差や売れ筋の並びが見えてきます。' },
  { max: 365, key: 'season', name: '季節比較', desc: '暑い時期・寒い時期の違いを見比べられます。' },
  { max: 730, key: 'deep', name: '高度学習', desc: '前年の同じ日と比べられます。' },
  { max: Infinity, key: 'expert', name: '長期学習', desc: '2年以上の積み重ねから、年ごとの動きを追えます。' },
];

/**
 * 「どれくらい賢くなっているか」を数字で返す。
 * データが足りない時期に、当たっているふりをさせないための土台でもある。
 */
export async function learningStatus(ctx) {
  const f = await ctx.first(
    `SELECT COUNT(*) AS days, MIN(business_date) AS first_day, MAX(business_date) AS last_day,
            COALESCE(SUM(orders_count),0) AS orders, COALESCE(SUM(items_qty),0) AS items,
            COALESCE(SUM(guests),0) AS guests
       FROM daily_facts WHERE SCOPE() AND sales > 0`
  );
  const imported = await ctx.first(
    `SELECT COUNT(*) AS days FROM daily_facts WHERE SCOPE() AND source = 'import'`
  );
  const weatherDays = await ctx.first(
    `SELECT COUNT(*) AS days FROM weather_actual WHERE SCOPE() AND confirmed = 1`
  );
  const events = await ctx.first(`SELECT COUNT(*) AS c FROM day_events WHERE SCOPE()`);
  // 記録はあるのに天気だけ空いている「過去の日」の数。
  // 今日はまだ天気が確定していないので、抜けとは数えない（直せない抜けを見せない）。
  const yesterday = addDays(todayJst(), -1);
  const wxMissing = await ctx.first(
    `SELECT COUNT(*) AS c FROM daily_facts d
      WHERE SCOPE(d) AND d.business_date <= ?
        AND NOT EXISTS (
          SELECT 1 FROM weather_actual w
           WHERE w.tenant_id = d.tenant_id AND w.store_id = d.store_id
             AND w.business_date = d.business_date AND w.confirmed = 1
        )`,
    [yesterday]
  );

  const days = Number(f?.days || 0);
  const span = f?.first_day && f?.last_day ? dayDiff(f.first_day, f.last_day) + 1 : 0;
  const phase = PHASES.find((p) => days < p.max) || PHASES[PHASES.length - 1];
  const nextPhase = PHASES[PHASES.indexOf(phase) + 1] || null;

  return {
    days,
    span,
    firstDay: f?.first_day || '',
    lastDay: f?.last_day || '',
    orders: Number(f?.orders || 0),
    items: Number(f?.items || 0),
    guests: Number(f?.guests || 0),
    importedDays: Number(imported?.days || 0),
    weatherDays: Number(weatherDays?.days || 0),
    weatherMissing: Number(wxMissing?.c || 0),
    events: Number(events?.c || 0),
    phase: phase.key,
    phaseName: phase.name,
    phaseDesc: phase.desc,
    nextPhaseName: nextPhase?.name || '',
    daysToNext: nextPhase ? Math.max(0, phase.max - days) : 0,
    // 予測を出してよいかの目安。足りないうちは出さない（当たっているふりをさせない）
    canForecast: days >= 14,
    canCompareYear: days >= 365 || (f?.first_day ? dayDiff(f.first_day, f.last_day) >= 365 : false),
  };
}
