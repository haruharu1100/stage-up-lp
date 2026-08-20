/**
 * シフト（誰が何時から何時まで入るか）と、時間帯ごとの必要人数との突き合わせ。
 *
 * ★ここが出すのは「足りない・足りている・多い」までで、シフトを勝手に書き換えることはしない。
 *   人を減らす判断は生活に直結するので、システムが自動でやってよいことではない。
 *   案は出す。決めるのは店の人。
 *
 * 必要人数は lib/forecast.js の hourlyPlan が出している「見込み」（第2層）。
 * 配置人数はここに登録された「事実」（第1層）。
 * 画面でも、この2つは必ず別の列に分けて出す。混ぜると、見込みが事実のように見えてしまう。
 */

import { nowIso, businessDate } from './db.js';
import { hourlyPlan } from './forecast.js';

export const SHIFT_ROLES = [
  ['hall', 'ホール'],
  ['kitchen', '厨房'],
  ['other', 'その他'],
];

export const SHIFT_ROLE_LABEL = Object.fromEntries(SHIFT_ROLES);

const JUDGE_LABEL = { short: '不足', ok: '適正', over: '過剰' };

function clean(s, max = 40) {
  return String(s ?? '').trim().slice(0, max);
}

/**
 * '17:00' や '25:00' を時間の数値に直す。
 * 深夜まで営業する店があるので、25時（翌1時）までそのまま書けるようにしている。
 */
function toHour(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 29 || min < 0 || min > 59) return null;
  return h + min / 60;
}

// ===== 登録・削除 =====

export async function saveShift(ctx, { id = null, date, staffId = null, staffName, role = 'hall', startTime, endTime, note = '' }) {
  const d = String(date || businessDate()).slice(0, 10);
  const name = clean(staffName);
  if (!name) throw new Error('だれのシフトかを入れてください');
  const s = toHour(startTime);
  const e = toHour(endTime);
  if (s === null || e === null) throw new Error('時刻は 17:00 のように入れてください');
  if (e <= s) throw new Error('終わりの時刻は、始まりより後にしてください');
  if (!SHIFT_ROLE_LABEL[role]) throw new Error('担当が正しくありません');

  const ts = nowIso();
  if (id) {
    const row = await ctx.first(`SELECT id FROM shifts WHERE SCOPE() AND id = ?`, [Number(id)]);
    if (!row) throw new Error('そのシフトが見つかりません');
    await ctx.run(
      `UPDATE shifts SET business_date = ?, staff_id = ?, staff_name = ?, role = ?,
              start_time = ?, end_time = ?, note = ?, updated_at = ?
        WHERE SCOPE() AND id = ?`,
      [d, staffId ? Number(staffId) : null, name, role, String(startTime), String(endTime), clean(note, 120), ts, Number(id)],
    );
    return { ok: true, id: Number(id) };
  }
  const newId = await ctx.insert('shifts', {
    business_date: d,
    staff_id: staffId ? Number(staffId) : null,
    staff_name: name,
    role,
    start_time: String(startTime),
    end_time: String(endTime),
    note: clean(note, 120),
    created_by: ctx.staffName || '',
    created_at: ts,
    updated_at: ts,
  });
  return { ok: true, id: newId };
}

export async function deleteShift(ctx, id) {
  const row = await ctx.first(`SELECT id FROM shifts WHERE SCOPE() AND id = ?`, [Number(id)]);
  if (!row) throw new Error('そのシフトが見つかりません');
  await ctx.run(`DELETE FROM shifts WHERE SCOPE() AND id = ?`, [Number(id)]);
  return { ok: true };
}

export async function listShifts(ctx, date) {
  const d = String(date || businessDate()).slice(0, 10);
  const rows = await ctx.query(
    `SELECT * FROM shifts WHERE SCOPE() AND business_date = ? ORDER BY start_time, id`, [d],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    date: r.business_date,
    staffId: r.staff_id ? Number(r.staff_id) : null,
    staffName: r.staff_name,
    role: r.role,
    roleLabel: SHIFT_ROLE_LABEL[r.role] || r.role,
    startTime: r.start_time,
    endTime: r.end_time,
    note: r.note || '',
  }));
}

/** その日のシフトから、時間帯ごとの配置人数を数える（ホールだけ／全員の両方） */
function countByHour(shifts, hours) {
  const hall = new Map();
  const all = new Map();
  for (const h of hours) {
    hall.set(h, 0);
    all.set(h, 0);
  }
  for (const s of shifts) {
    const from = toHour(s.startTime);
    const to = toHour(s.endTime);
    if (from === null || to === null) continue;
    for (const h of hours) {
      // その時間帯にすこしでも入っていれば1人と数える（17:30〜なら17時台も1人）
      if (from < h + 1 && to > h) {
        all.set(h, all.get(h) + 1);
        if (s.role === 'hall') hall.set(h, hall.get(h) + 1);
      }
    }
  }
  return { hall, all };
}

/**
 * 時間帯ごとの「必要人数（見込み）」と「配置人数（事実）」を並べる。
 *
 * 必要人数はホールの人数の目安なので、比べる相手もホールの人数にする。
 * 厨房の人数を混ぜると、ホールが足りないのに「足りている」と出てしまう。
 */
export async function shiftPlan(ctx, date = null) {
  const d = String(date || businessDate()).slice(0, 10);
  const [plan, shifts] = await Promise.all([hourlyPlan(ctx, d), listShifts(ctx, d)]);

  if (!plan.ok) {
    return {
      ok: false,
      date: d,
      reason: plan.reason,
      message: plan.message || 'まだ記録が足りないため、必要人数の見込みが出せません。',
      shifts,
      staffCount: new Set(shifts.map((s) => s.staffName)).size,
    };
  }

  const hours = plan.rows.map((r) => r.hour);
  const { hall, all } = countByHour(shifts, hours);

  const rows = plan.rows.map((r) => {
    const placed = hall.get(r.hour) || 0;
    const diff = placed - r.staff;
    const judge = diff < 0 ? 'short' : (diff > 0 ? 'over' : 'ok');
    return {
      hour: r.hour,
      needStaff: r.staff,          // ←見込み（第2層）
      placedStaff: placed,          // ←事実（第1層・ホールのみ）
      placedAll: all.get(r.hour) || 0,
      diff,
      judge,
      judgeLabel: JUDGE_LABEL[judge],
      judgeText: diff === 0 ? '適正' : (diff < 0 ? `不足${Math.abs(diff)}人` : `過剰${diff}人`),
      inStore: r.inStore,
      sales: r.sales,
      waitAvgMinutes: r.waitAvgMinutes,
      samples: r.samples,
    };
  });

  const suggestions = buildSuggestions(rows, shifts.length > 0);

  const shortHours = rows.filter((r) => r.judge === 'short');
  const overHours = rows.filter((r) => r.judge === 'over');

  return {
    ok: true,
    date: d,
    basis: plan.basis,
    perStaff: plan.perStaff,
    minStaff: plan.minStaff,
    rows,
    shifts,
    hasShift: shifts.length > 0,
    shortCount: shortHours.length,
    overCount: overHours.length,
    suggestions,
    note: shifts.length
      ? '「必要人数」はこれまでの記録から出した見込みです。「配置人数」は登録されたシフトの実際の人数です。'
      : 'この日のシフトがまだ登録されていないため、配置人数は0人として表示しています。',
    caution: '必要人数は目安です。宴会の予約、慣れている人が入っているかどうかで実際は変わります。最後は店長が決めてください。',
  };
}

/**
 * 「19〜21時だけ1名追加してください」の形にまとめる。
 *
 * 1時間ずつ「17時に1人・18時に1人・19時に1人」と並べても、シフトは組めない。
 * 足りない時間が続いているところをひとまとまりにして、
 * 「何時から何時までを何人」という、そのままシフト表に書ける形にする。
 */
function buildSuggestions(rows, hasShift) {
  const out = [];
  let run = null;

  const flush = () => {
    if (!run) return;
    const need = Math.max(...run.diffs);
    const from = run.from;
    const to = run.to + 1; // 「21時台」まで足りない＝22時までいてほしい
    if (run.kind === 'short') {
      out.push({
        kind: 'short',
        fromHour: from,
        toHour: to,
        people: need,
        text: `${from}時〜${to}時に${need}名を追加すると、見込みどおりの人手になります。`,
      });
    } else {
      out.push({
        kind: 'over',
        fromHour: from,
        toHour: to,
        people: need,
        text: `${from}時〜${to}時は、見込みに対して${need}名ぶん余裕があります。他の時間へ回すか、休憩に充てられるかもしれません。`,
      });
    }
    run = null;
  };

  for (const r of rows) {
    const kind = r.judge === 'ok' ? null : r.judge;
    if (!kind) { flush(); continue; }
    if (run && run.kind === kind && r.hour === run.to + 1) {
      run.to = r.hour;
      run.diffs.push(Math.abs(r.diff));
    } else {
      flush();
      run = { kind, from: r.hour, to: r.hour, diffs: [Math.abs(r.diff)] };
    }
  }
  flush();

  if (!hasShift) {
    return [{
      kind: 'none',
      text: 'この日のシフトを登録すると、時間帯ごとに「足りている・足りない」を並べて出せます。',
    }];
  }
  if (!out.length) {
    return [{ kind: 'ok', text: 'いまのシフトで、見込みの人手はひととおり足りています。' }];
  }
  return out;
}

export { JUDGE_LABEL };
