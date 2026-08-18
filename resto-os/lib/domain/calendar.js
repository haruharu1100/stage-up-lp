/**
 * 「その日がどんな日か」を、外部サービスに頼らず自分で判定する。
 *
 * 祝日APIに頼ると、そのサービスが止まった日に予測ができなくなる。
 * 日本の祝日は法律で計算方法が決まっているので、ここで計算して持つ。
 * （春分・秋分の計算式は 1980〜2099年で有効）
 *
 * ここが出すのは「事実」だけ。売れる/売れないの判断は一切しない。
 */

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function dowLabel(dow) {
  return WEEK[dow] || '';
}

/** 'YYYY-MM-DD' → {y,m,d}。時差の影響を受けないよう文字列のまま扱う */
function parts(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return { y, m, d };
}

function toStr(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** その日の曜日（0=日）。UTCで固定して計算し、実行環境の時差で1日ずれるのを防ぐ */
export function dowOf(dateStr) {
  const { y, m, d } = parts(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr, n) {
  const { y, m, d } = parts(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000
  );
}

export function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** その月の第n週の指定曜日（例：1月の第2月曜＝成人の日） */
function nthDow(y, m, dow, nth) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((dow - first + 7) % 7) + (nth - 1) * 7;
}

function equinox(y, spring) {
  const base = spring ? 20.8431 : 23.2488;
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

/** その年の祝日一覧（振替休日・国民の休日を含む） */
function holidaysOfYear(y) {
  const h = new Map();
  const put = (m, d, name) => h.set(toStr(y, m, d), name);

  put(1, 1, '元日');
  put(1, nthDow(y, 1, 1, 2), '成人の日');
  put(2, 11, '建国記念の日');
  if (y >= 2020) put(2, 23, '天皇誕生日');
  put(3, equinox(y, true), '春分の日');
  put(4, 29, '昭和の日');
  put(5, 3, '憲法記念日');
  put(5, 4, 'みどりの日');
  put(5, 5, 'こどもの日');
  put(7, nthDow(y, 7, 1, 3), '海の日');
  if (y >= 2016) put(8, 11, '山の日');
  put(9, nthDow(y, 9, 1, 3), '敬老の日');
  put(9, equinox(y, false), '秋分の日');
  put(10, nthDow(y, 10, 1, 2), 'スポーツの日');
  put(11, 3, '文化の日');
  put(11, 23, '勤労感謝の日');

  // 振替休日：日曜と重なったら、次の平日が休みになる
  for (const key of [...h.keys()]) {
    if (dowOf(key) !== 0) continue;
    let next = addDays(key, 1);
    while (h.has(next)) next = addDays(next, 1);
    h.set(next, '振替休日');
  }
  // 国民の休日：祝日と祝日にはさまれた平日（敬老の日と秋分の日の間など）
  for (const key of [...h.keys()]) {
    const next2 = addDays(key, 2);
    const mid = addDays(key, 1);
    if (h.has(next2) && !h.has(mid) && dowOf(mid) !== 0) h.set(mid, '国民の休日');
  }
  return h;
}

const _cache = new Map();
function holidayMap(y) {
  if (!_cache.has(y)) _cache.set(y, holidaysOfYear(y));
  return _cache.get(y);
}

export function holidayName(dateStr) {
  const { y } = parts(dateStr);
  return holidayMap(y).get(dateStr) || '';
}

/** お客様にとっての「休み」＝土日または祝日 */
function isOff(dateStr) {
  const d = dowOf(dateStr);
  return d === 0 || d === 6 || Boolean(holidayName(dateStr));
}

function season(m) {
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

/** 飲食店の売上が明らかに動く特別な期間だけを名前で持つ */
function specialPeriod(m, d) {
  if ((m === 12 && d >= 29) || (m === 1 && d <= 3)) return '年末年始';
  if (m === 4 && d >= 29) return 'ゴールデンウィーク';
  if (m === 5 && d <= 5) return 'ゴールデンウィーク';
  if (m === 8 && d >= 13 && d <= 16) return 'お盆';
  if (m === 12 && (d === 24 || d === 25)) return 'クリスマス';
  if (m === 12 && d >= 15 && d <= 28) return '忘年会シーズン';
  if (m === 1 && d >= 8 && d <= 25) return '新年会シーズン';
  if (m === 3 && d >= 20) return '歓送迎会シーズン';
  if (m === 4 && d <= 10) return '歓送迎会シーズン';
  if (m === 2 && d === 14) return 'バレンタイン';
  if (m === 10 && d === 31) return 'ハロウィン';
  return '';
}

/**
 * 給料日（25日。土日なら直前の平日へ前倒し）との近さ。
 * -3〜+3 で返し、0＝給料日当日。関係ない日は 99（0と取り違えないための決め事）。
 */
export const PAYDAY_NONE = 99;
function paydayNear(y, m, d) {
  let pay = Math.min(25, lastDayOfMonth(y, m));
  while (true) {
    const w = dowOf(toStr(y, m, pay));
    if (w !== 0 && w !== 6) break;
    pay -= 1;
  }
  const diff = d - pay;
  return Math.abs(diff) <= 3 ? diff : PAYDAY_NONE;
}

/** 連休の長さ。その日が休みでなければ0 */
function streak(dateStr) {
  if (!isOff(dateStr)) return 0;
  let n = 1;
  let p = addDays(dateStr, -1);
  while (isOff(p)) { n += 1; p = addDays(p, -1); }
  let q = addDays(dateStr, 1);
  while (isOff(q)) { n += 1; q = addDays(q, 1); }
  return n;
}

/**
 * 1日ぶんの「暦の性質」をまとめて返す。ここに推測は入らない。
 */
export function calendarFacts(dateStr) {
  const { y, m, d } = parts(dateStr);
  const name = holidayName(dateStr);
  const last = lastDayOfMonth(y, m);
  return {
    business_date: dateStr,
    dow: dowOf(dateStr),
    holiday_name: name,
    is_holiday: name ? 1 : 0,
    is_eve: isOff(addDays(dateStr, 1)) ? 1 : 0,   // 翌日が休み＝夜が伸びやすい日
    streak_days: streak(dateStr),
    is_month_start: d <= 3 ? 1 : 0,
    is_month_end: d >= last - 2 ? 1 : 0,
    payday_near: paydayNear(y, m, d),
    season: season(m),
    special: specialPeriod(m, d),
  };
}

/** 画面に出す一言（例：「土曜・祝前日・給料日直後」） */
export function calendarLabel(f) {
  const t = [`${dowLabel(f.dow)}曜`];
  if (f.holiday_name) t.push(f.holiday_name);
  else if (f.is_eve) t.push('祝前日');
  if (f.streak_days >= 3) t.push(`${f.streak_days}連休`);
  if (f.special) t.push(f.special);
  if (f.payday_near === 0) t.push('給料日');
  else if (f.payday_near > 0 && f.payday_near !== PAYDAY_NONE) t.push('給料日後');
  else if (f.payday_near < 0) t.push('給料日前');
  return t.join('・');
}
