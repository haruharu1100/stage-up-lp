/**
 * 待ち時間を「実際に測る」ところ。
 *
 * ★このファイルの絶対の決まりごと:
 *   待ち時間は**測った時刻の引き算でしか作らない**。
 *   受付を押した時刻と、席にご案内した時刻の差。それ以外は出さない。
 *   「たぶん15分くらい」という数字を画面に出すことは絶対にしない。
 *   お客様に伝えた待ち時間が外れると、そのままお店の信用が落ちるため。
 *
 * だから、
 *   ・受付を押していない日は、その日の待ち時間は「記録なし」であって「0分」ではない。
 *   ・待たずにお帰りになった方は、待ち時間の平均に混ぜない（席についていない＝測れていない）。
 *     ただし件数は必ず別で出す。混ぜないぶん、見落とすと実態より軽く見えてしまうため。
 *   ・記録が少ない曜日・時間帯は、平均を出さずに「まだ出せません」と返す。
 */

import { nowIso, businessDate } from './db.js';

export const WAIT_STATUS_LABEL = {
  waiting: 'お待ち中',
  seated: 'ご案内済み',
  left: 'お帰り',
};

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

// この件数に届くまでは、平均を出さない。
// 2〜3件の平均を「金曜20時台は12分です」と言い切ると、次の日に簡単に裏切られる。
const MIN_SAMPLES = 5;

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clean(s, max = 40) {
  return String(s ?? '').trim().slice(0, max);
}

/** UTCのISO時刻から、日本時間の曜日と時間帯を出す */
function jstSlot(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return { dow: d.getUTCDay(), hour: d.getUTCHours() };
}

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ===== 受付・ご案内（ここで時刻が記録される） =====

/** 受付する。押したその時刻が待ち時間の起点になる。 */
export async function addWaiting(ctx, { name = '', guests = 1, note = '' } = {}) {
  const g = Math.max(1, Math.min(99, Math.round(num(guests, 1))));
  const at = nowIso();
  const slot = jstSlot(at);
  const ts = at;
  const id = await ctx.insert('waitlist', {
    business_date: businessDate(),
    name: clean(name),
    guests: g,
    status: 'waiting',
    waiting_started_at: at,
    seated_at: '',
    left_at: '',
    actual_wait_minutes: null, // ★席につくまでは絶対に埋めない
    wait_dow: slot.dow,
    wait_hour: slot.hour,
    table_id: null,
    staff_id: ctx.staffId ? Number(ctx.staffId) : null,
    staff_name: ctx.staffName || '',
    note: clean(note, 120),
    created_at: ts,
    updated_at: ts,
  });
  return { ok: true, id };
}

/** 席へご案内した。ここで初めて待ち分数が確定する。 */
export async function seatWaiting(ctx, { id, tableId = null } = {}) {
  const row = await ctx.first(`SELECT * FROM waitlist WHERE SCOPE() AND id = ?`, [Number(id)]);
  if (!row) throw new Error('その受付が見つかりません');
  if (row.status !== 'waiting') throw new Error('すでにご案内済み、またはお帰りになっています');

  const at = nowIso();
  const minutes = Math.max(
    0,
    Math.round((new Date(at).getTime() - new Date(row.waiting_started_at).getTime()) / 60000),
  );
  await ctx.run(
    `UPDATE waitlist SET status = 'seated', seated_at = ?, actual_wait_minutes = ?, table_id = ?, updated_at = ?
      WHERE SCOPE() AND id = ?`,
    [at, minutes, tableId ? Number(tableId) : null, at, Number(id)],
  );
  return { ok: true, id: Number(id), waitMinutes: minutes };
}

/** 待たずにお帰りになった。待ち分数は入れない（席についていないので測れていない）。 */
export async function leaveWaiting(ctx, { id } = {}) {
  const row = await ctx.first(`SELECT * FROM waitlist WHERE SCOPE() AND id = ?`, [Number(id)]);
  if (!row) throw new Error('その受付が見つかりません');
  if (row.status !== 'waiting') throw new Error('すでにご案内済み、またはお帰りになっています');
  const at = nowIso();
  await ctx.run(
    `UPDATE waitlist SET status = 'left', left_at = ?, updated_at = ? WHERE SCOPE() AND id = ?`,
    [at, at, Number(id)],
  );
  return { ok: true, id: Number(id) };
}

/** その日の受付一覧。お待ち中の方は「いま何分お待ちか」を実測でそのまま出す。 */
export async function listWaiting(ctx, date = null) {
  const d = date || businessDate();
  const rows = await ctx.query(
    `SELECT * FROM waitlist WHERE SCOPE() AND business_date = ? ORDER BY id`,
    [d],
  );
  const now = Date.now();
  const list = rows.map((r) => ({
    id: Number(r.id),
    name: r.name || '',
    guests: Number(r.guests || 0),
    status: r.status,
    statusLabel: WAIT_STATUS_LABEL[r.status] || r.status,
    startedAt: r.waiting_started_at,
    seatedAt: r.seated_at || '',
    // お待ち中の方の「経過分数」は推測ではなく、いま時刻との実際の差
    elapsedMinutes: r.status === 'waiting'
      ? Math.max(0, Math.round((now - new Date(r.waiting_started_at).getTime()) / 60000))
      : null,
    waitMinutes: r.actual_wait_minutes === null || r.actual_wait_minutes === undefined
      ? null
      : Number(r.actual_wait_minutes),
    tableId: r.table_id ? Number(r.table_id) : null,
    staffName: r.staff_name || '',
    note: r.note || '',
  }));
  const waiting = list.filter((r) => r.status === 'waiting');
  return {
    ok: true,
    date: d,
    rows: list,
    waitingCount: waiting.length,
    waitingGuests: waiting.reduce((s, r) => s + r.guests, 0),
    seatedCount: list.filter((r) => r.status === 'seated').length,
    leftCount: list.filter((r) => r.status === 'left').length,
  };
}

// ===== 実測がたまったあとの振り返り =====

/**
 * 曜日×時間帯の、実測の待ち時間。
 *
 * 記録が MIN_SAMPLES 件に届かない枠は、平均を出さずに enough:false で返す。
 * 画面はそこに数字を書かず「まだ出せません」と表示する。
 */
export async function waitStats(ctx, { days = 90 } = {}) {
  const to = businessDate();
  const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - Math.max(14, Math.min(365, days)) * 86400000)
    .toISOString().slice(0, 10);

  const rows = await ctx.query(
    `SELECT wait_dow, wait_hour, actual_wait_minutes, guests, status
       FROM waitlist
      WHERE SCOPE() AND business_date BETWEEN ? AND ?`,
    [from, to],
  );

  const seated = rows.filter((r) => r.status === 'seated' && r.actual_wait_minutes !== null);
  const left = rows.filter((r) => r.status === 'left');

  if (seated.length < MIN_SAMPLES) {
    return {
      ok: false,
      reason: 'NOT_ENOUGH',
      records: seated.length,
      needed: MIN_SAMPLES,
      leftCount: left.length,
      message: seated.length
        ? `待ち時間の記録が${seated.length}件しかないため、平均はまだ出せません（推測の分数は表示しません）。`
        : '待ち時間の記録がまだありません。受付とご案内をボタンで残すと、実際に測った待ち時間が出せるようになります。',
    };
  }

  const bySlot = new Map();
  for (const r of seated) {
    const k = `${r.wait_dow}-${r.wait_hour}`;
    const list = bySlot.get(k) || [];
    list.push(Number(r.actual_wait_minutes));
    bySlot.set(k, list);
  }

  const slots = [];
  for (const [k, list] of bySlot) {
    const [dow, hour] = k.split('-').map(Number);
    const enough = list.length >= MIN_SAMPLES;
    slots.push({
      dow,
      dowName: DOW[dow],
      hour,
      samples: list.length,
      enough,
      // 記録が足りない枠には数字を入れない（null のまま返し、画面でも空にする）
      avgMinutes: enough ? Math.round(list.reduce((s, v) => s + v, 0) / list.length) : null,
      medMinutes: enough ? Math.round(median(list)) : null,
      maxMinutes: enough ? Math.max(...list) : null,
      text: enough
        ? `${DOW[dow]}曜日${hour}時台の平均待ち時間は${Math.round(list.reduce((s, v) => s + v, 0) / list.length)}分です（${list.length}件の実測）。`
        : `${DOW[dow]}曜日${hour}時台は記録が${list.length}件のため、平均待ち時間はまだ出せません。`,
    });
  }
  slots.sort((a, b) => (a.dow - b.dow) || (a.hour - b.hour));

  const all = seated.map((r) => Number(r.actual_wait_minutes));
  const ready = slots.filter((s) => s.enough);
  const worst = ready.length ? ready.reduce((a, b) => (b.avgMinutes > a.avgMinutes ? b : a)) : null;

  const notes = [];
  if (worst) notes.push(`いちばんお待たせしているのは${worst.dowName}曜日${worst.hour}時台で、平均${worst.avgMinutes}分です（${worst.samples}件の実測）。`);
  if (left.length) {
    notes.push(`この期間に、待たずにお帰りになった記録が${left.length}件あります。この方々の待ち時間は測れていないため、上の平均には入れていません。`);
  }
  if (slots.some((s) => !s.enough)) {
    notes.push('記録が5件に満たない曜日・時間帯は、あえて数字を出していません。');
  }

  return {
    ok: true,
    from,
    to,
    records: seated.length,
    leftCount: left.length,
    minSamples: MIN_SAMPLES,
    overallAvg: Math.round(all.reduce((s, v) => s + v, 0) / all.length),
    overallMed: Math.round(median(all)),
    slots,
    readySlots: ready.length,
    notes,
    caution: 'ここに出るのは、受付とご案内の時刻から実際に測った分数だけです。測っていない時間帯には数字を出しません。',
  };
}

/**
 * ある曜日・時間帯の実測平均を1件だけ引く。
 * 時間帯別の見込み画面が「その時間はふだんどれくらいお待たせしているか」を添えるのに使う。
 * 記録が足りなければ null を返す。呼び出し側は null のとき何も表示しない。
 */
export async function waitForSlots(ctx, dow, hours = [], { days = 90 } = {}) {
  const st = await waitStats(ctx, { days });
  const out = new Map();
  if (!st.ok) return out;
  for (const h of hours) {
    const s = st.slots.find((x) => x.dow === dow && x.hour === h);
    if (s && s.enough) out.set(h, { avgMinutes: s.avgMinutes, samples: s.samples });
  }
  return out;
}

export { DOW, MIN_SAMPLES };
