// V5（待ち時間の実測 / 廃棄理由 / シフト照合 / 予測フィードバック）の通し確認
// 使い方:
//   DATABASE_URL=file:./data/test-v5.db node scripts/seed.mjs
//   DATABASE_URL=file:./data/test-v5.db node scripts/test-v5.mjs
// ※本番DBには絶対に向けないこと（file: の検証用DBのみ）
import { initDb, one, nowIso, businessDate } from '../lib/db.js';
import { createCtx } from '../lib/tenant-db.js';
import { addDays } from '../lib/learn.js';
import {
  addWaiting, seatWaiting, leaveWaiting, listWaiting, waitStats, waitForSlots,
} from '../lib/waitlist.js';
import { addMove, listMoves } from '../lib/inventory.js';
import { WASTE_REASON_LABEL } from '../lib/domain/waste.js';
import { wasteByDow } from '../lib/prep.js';
import { saveShift, shiftPlan, listShifts } from '../lib/shift.js';
import {
  saveForecasts, scoreDay, accuracySummary, calibration, familyOf, hourlyPlan,
} from '../lib/forecast.js';
import { saveDetailForecasts } from '../lib/forecast-detail.js';

const url = process.env.DATABASE_URL || '';
if (!url.startsWith('file:')) {
  console.error('検証用の file: DB を指定してください（本番DB保護のため）');
  process.exit(1);
}

const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' … ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

const iso = (date, hour, min) =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`).toISOString();

async function main() {
  await initDb();

  const s1 = await one('SELECT * FROM stores ORDER BY id LIMIT 1');
  const s2 = await one('SELECT * FROM stores ORDER BY id DESC LIMIT 1');
  const t1 = await one('SELECT * FROM tenants WHERE id = ?', [s1.tenant_id]);
  const ctx = createCtx({
    tenantId: s1.tenant_id, storeId: s1.id, role: 'owner',
    staffName: '検証', plan: 'pro', tenant: t1, store: s1,
  });
  const ctxB = createCtx({
    tenantId: s2.tenant_id, storeId: s2.id, role: 'owner',
    staffName: '検証B', plan: 'pro', tenant: null, store: s2,
  });
  ok('検証用の店が2つある（他店から見えないことを確かめるため）', s1.id !== s2.id,
    `店A=${s1.name}(s${s1.id}) 店B=${s2.name}(s${s2.id})`);

  // 何度流しても同じ結果になるよう、店Aの検証対象テーブルだけ先に空にする
  for (const t of ['daily_facts', 'daily_hour_facts', 'daily_item_facts', 'forecasts',
    'forecast_results', 'waitlist', 'shifts', 'stock_moves', 'ingredients']) {
    await ctx.run(`DELETE FROM ${t} WHERE SCOPE()`);
  }

  const today = businessDate();
  const hours = [17, 18, 19, 20, 21, 22];
  const shape = { 17: 0.06, 18: 0.14, 19: 0.26, 20: 0.28, 21: 0.18, 22: 0.08 };

  // ── 0) 土台：90日ぶんの実績（日 / 時間帯 / 商品）
  const menu = await ctx.query('SELECT id, name FROM menu_items WHERE SCOPE() ORDER BY id LIMIT 6');
  for (let i = 1; i <= 90; i++) {
    const d = addDays(today, -i);
    const dow = new Date(`${d}T00:00:00+09:00`).getDay();
    const base = [0.9, 0.7, 0.75, 0.8, 0.85, 1.3, 1.25][dow];
    const jitter = 0.85 + ((i * 37) % 31) / 100;
    const sales = Math.round(180000 * base * jitter);
    const guests = Math.round(60 * base * jitter);
    await ctx.insert('daily_facts', {
      business_date: d, source: 'live', sales, checks_count: Math.round(guests / 2.4),
      guests, orders_count: guests * 3, items_qty: guests * 4,
      cost_total: Math.round(sales * 0.31), gross_profit: Math.round(sales * 0.69),
      avg_spend: Math.round(sales / guests), seats: 46,
      waste_amount: Math.round(sales * (dow === 2 ? 0.028 : 0.012)),
      closed: 1, computed_at: nowIso(),
    });
    for (const h of hours) {
      await ctx.insert('daily_hour_facts', {
        business_date: d, hour: h,
        sales: Math.round(sales * shape[h]), qty: Math.round(guests * 4 * shape[h]),
        orders_count: Math.round(guests * 3 * shape[h]), guests: Math.round(guests * shape[h]),
      });
    }
    for (const [k, m] of menu.entries()) {
      const qty = Math.max(1, Math.round(guests * (0.5 - k * 0.06)));
      await ctx.insert('daily_item_facts', {
        business_date: d, item_id: Number(m.id), name: m.name, category_id: null,
        category_name: '', station: '', qty, sales: qty * 600, cost: qty * 180,
        profit: qty * 420, peak_hour: 20,
      });
    }
  }
  ok('90日ぶんの実績（日・時間帯・商品）を用意', true);

  // ══════════ ① 待ち時間の実測化 ══════════
  console.log('\n── ① 待ち時間の実測化');

  const w1 = await addWaiting(ctx, { name: '検証さま', guests: 2 });
  const listed = await listWaiting(ctx, today);
  ok('受付するとお待ちの一覧に載る', (listed.rows || []).some((r) => r.id === w1.id));
  const beforeSeat = await ctx.first('SELECT actual_wait_minutes FROM waitlist WHERE SCOPE() AND id = ?', [w1.id]);
  ok('ご案内するまで待ち時間は空のまま（推測で埋めない）',
    beforeSeat.actual_wait_minutes === null || beforeSeat.actual_wait_minutes === undefined);

  const seated = await seatWaiting(ctx, { id: w1.id });
  const afterSeat = await ctx.first(
    'SELECT waiting_started_at, seated_at, actual_wait_minutes FROM waitlist WHERE SCOPE() AND id = ?', [w1.id]);
  const diff = Math.round(
    (new Date(afterSeat.seated_at) - new Date(afterSeat.waiting_started_at)) / 60000);
  ok('待ち時間は受付とご案内の時刻の引き算そのもの',
    Number(afterSeat.actual_wait_minutes) === diff, `${afterSeat.actual_wait_minutes}分`);
  ok('ご案内の時刻が入っている', Boolean(afterSeat.seated_at));

  const w2 = await addWaiting(ctx, { name: 'お帰り検証', guests: 3 });
  await leaveWaiting(ctx, { id: w2.id });
  const left = await ctx.first('SELECT status, actual_wait_minutes FROM waitlist WHERE SCOPE() AND id = ?', [w2.id]);
  ok('待ちきれず帰った方は待ち時間に数えない',
    left.status === 'left' && (left.actual_wait_minutes === null || left.actual_wait_minutes === undefined));

  // 記録が足りないうちは平均を出さない
  const thin = await waitStats(ctx, { days: 90 });
  ok('記録が少ないうちは平均待ち時間を出さない', thin.ok === false && thin.reason === 'NOT_ENOUGH', thin.message || '');

  // 金曜20時台に実測を8件つくる（12分前後）
  const friday = (() => {
    for (let i = 1; i <= 14; i++) {
      const d = addDays(today, -i);
      if (new Date(`${d}T00:00:00+09:00`).getDay() === 5) return d;
    }
    return addDays(today, -7);
  })();
  const mins = [10, 11, 12, 12, 13, 14, 12, 10];
  for (const [i, m] of mins.entries()) {
    const start = iso(addDays(friday, -7 * Math.floor(i / 2)), 20, 5 + (i % 2) * 20);
    const seat = new Date(new Date(start).getTime() + m * 60000).toISOString();
    await ctx.insert('waitlist', {
      business_date: String(start).slice(0, 10), name: '', guests: 2, status: 'seated',
      waiting_started_at: start, seated_at: seat, left_at: '', actual_wait_minutes: m,
      wait_dow: 5, wait_hour: 20, table_id: null, staff_id: null, staff_name: '検証',
      note: '', created_at: nowIso(), updated_at: nowIso(),
    });
  }
  const st = await waitStats(ctx, { days: 90 });
  ok('実測がたまると平均待ち時間を出す', st.ok === true, st.reason || '');
  const slot = st.ok ? (st.slots || []).find((s) => s.dow === 5 && s.hour === 20) : null;
  ok('金曜20時台の平均が実測どおり', Boolean(slot) && slot.avgMinutes >= 11 && slot.avgMinutes <= 13,
    slot ? `${slot.avgMinutes}分（${slot.samples}件）` : '');
  ok('「金曜日20時台の平均待ち時間は◯分です」の形で言える',
    Boolean(slot?.text) && /金曜日20時台の平均待ち時間は\d+分です/.test(slot.text), slot?.text || '');

  const slots = await waitForSlots(ctx, 5, hours, { days: 90 });
  ok('記録が5件に満たない時間帯は空のまま（推測を入れない）',
    (slots.get(19)?.avgMinutes ?? null) === null && (slots.get(20)?.avgMinutes ?? null) !== null);

  const hpFri = await hourlyPlan(ctx, friday);
  ok('時間帯の表に実測の待ち時間が並ぶ', hpFri.ok === true
    && hpFri.rows.some((r) => r.waitAvgMinutes !== null),
    hpFri.ok ? hpFri.rows.filter((r) => r.waitAvgMinutes !== null).map((r) => `${r.hour}時${r.waitAvgMinutes}分`).join(' ') : '');
  ok('測っていない時間帯には分数を出さない',
    hpFri.ok && hpFri.rows.some((r) => r.waitAvgMinutes === null));

  const bWait = await ctxB.query('SELECT id FROM waitlist WHERE SCOPE()');
  ok('よその店から待ち行列は見えない', bWait.length === 0, `店Bから見えた件数 ${bWait.length}`);

  // ══════════ ② 廃棄理由 ══════════
  console.log('\n── ② 廃棄の理由');

  const ing = await ctx.insert('ingredients', {
    name: '検証キャベツ', unit: 'g', category: '野菜', unit_cost: 0.4,
    pack_name: '1箱', pack_qty: 5000, supplier: '検証青果', lead_days: 1,
    min_stock: 1000, shelf_days: 3, note: '', active: 1,
    created_at: nowIso(), updated_at: nowIso(),
  });
  let threw = false;
  try {
    await addMove(ctx, { ingredientId: ing, kind: 'waste', qty: 100 });
  } catch { threw = true; }
  ok('理由を選ばずに廃棄を登録できない', threw);

  let threw2 = false;
  try {
    await addMove(ctx, { ingredientId: ing, kind: 'waste', qty: 100, wasteReason: 'でたらめ' });
  } catch { threw2 = true; }
  ok('決められた理由以外は受け付けない', threw2);

  await addMove(ctx, { ingredientId: ing, kind: 'waste', qty: 100, wasteReason: 'prep_over' });
  const mv = await listMoves(ctx, { days: 3, ingredientId: ing });
  const last = mv.rows ? mv.rows[0] : mv[0];
  ok('理由が日本語で残る', last?.wasteReasonLabel === WASTE_REASON_LABEL.prep_over, last?.wasteReasonLabel || '');

  // 火曜だけ「仕込み過多」の割合を高くした記録を作る
  for (let i = 1; i <= 60; i++) {
    const d = addDays(today, -i);
    const dow = new Date(`${d}T00:00:00+09:00`).getDay();
    const f = await ctx.first('SELECT sales FROM daily_facts WHERE SCOPE() AND business_date = ?', [d]);
    const sales = Number(f?.sales || 0);
    if (!sales) continue;
    const rate = dow === 2 ? 0.030 : 0.012;
    const reason = dow === 2 ? 'prep_over' : (i % 3 === 0 ? 'spoiled' : 'expired');
    await ctx.insert('stock_moves', {
      business_date: d, ingredient_id: ing, kind: 'waste', qty: -1200,
      amount: Math.round(sales * rate), reason: '', waste_reason: reason,
      staff_id: null, staff_name: '検証', created_at: nowIso(),
    });
  }
  const wd = await wasteByDow(ctx, { days: 90 });
  ok('廃棄の曜日別が返る', wd.ok === true, wd.reason || '');
  if (wd.ok) {
    const tue = wd.rows.find((r) => r.dow === 2);
    ok('火曜は捨てている割合が高いと出る', Boolean(tue) && tue.diffPct > 15,
      tue ? `火曜 ${tue.diffPct > 0 ? '+' : ''}${tue.diffPct}%` : '');
    const note = (wd.notes || []).find((n) => n.includes('仕込み過多'));
    ok('「火曜は仕込み過多の割合が高い傾向」まで言える', Boolean(note), note || '');
    ok('理由の内訳が数えられている', Array.isArray(wd.reasons) && wd.reasons.length > 0,
      (wd.reasons || []).map((r) => `${r.label}${r.pct}%`).join(' '));
    const txt = JSON.stringify(wd);
    ok('原因だと断定していない', !/が原因/.test(txt) && /傾向/.test(txt));
    ok('断定しない注意書きがある', /確かめられたわけでは|分かりません/.test(txt));
  }

  // ══════════ ③ 人員予測とシフトの照合 ══════════
  console.log('\n── ③ 必要人数と配置人数');

  const target = addDays(today, 1);
  const p0 = await shiftPlan(ctx, target);
  ok('シフト未登録でも過不足の表は出る', p0.ok === true, p0.reason || '');
  ok('シフトが無い日は配置0人として出す', p0.ok && p0.rows.every((r) => r.placedStaff === 0));
  const s0 = (p0.suggestions || [])[0];
  ok('シフト未登録なら、まず登録をすすめる', s0?.kind === 'none', s0?.text || '');

  await saveShift(ctx, { date: target, staffName: '検証ホールA', role: 'hall', startTime: '17:00', endTime: '23:00' });
  await saveShift(ctx, { date: target, staffName: '検証ホールB', role: 'hall', startTime: '19:00', endTime: '23:00' });
  await saveShift(ctx, { date: target, staffName: '検証厨房', role: 'kitchen', startTime: '17:00', endTime: '23:00' });
  const sh = await listShifts(ctx, target);
  ok('シフトが3件登録された', sh.length === 3);

  const p1 = await shiftPlan(ctx, target);
  ok('必要人数（見込み）と配置人数（事実）が別の欄で返る',
    p1.rows.every((r) => 'needStaff' in r && 'placedStaff' in r));
  ok('比べているのはホールの人数だけ（厨房を混ぜない）',
    p1.rows.every((r) => r.placedAll >= r.placedStaff) && p1.rows.some((r) => r.placedAll > r.placedStaff),
    `20時 ホール${p1.rows.find((r) => r.hour === 20)?.placedStaff}人／全員${p1.rows.find((r) => r.hour === 20)?.placedAll}人`);
  const r17 = p1.rows.find((r) => r.hour === 17);
  const r20 = p1.rows.find((r) => r.hour === 20);
  ok('17時台は1人しか入っていない', r17.placedStaff === 1);
  ok('20時台は2人入っている', r20.placedStaff === 2);
  ok('判定が「不足◯人 / 適正 / 過剰◯人」で出る',
    p1.rows.every((r) => /^(適正|不足\d+人|過剰\d+人)$/.test(r.judgeText)),
    p1.rows.map((r) => `${r.hour}時:必要${r.needStaff}/配置${r.placedStaff}→${r.judgeText}`).join('  '));
  ok('判定は必要人数と配置人数の引き算どおり',
    p1.rows.every((r) => r.diff === r.placedStaff - r.needStaff));
  const sug = (p1.suggestions || []).find((s) => s.kind === 'short');
  ok('足りない時間はひとまとまりの案になる（「19〜21時に1名」の形）',
    !p1.rows.some((r) => r.judge === 'short') || Boolean(sug),
    sug ? sug.text : '（不足なし）');
  if (sug) ok('案は「何時〜何時に何名」の形をしている', /\d+時〜\d+時に\d+名を追加/.test(sug.text), sug.text);
  ok('勝手にシフトを書き換えていない', (await listShifts(ctx, target)).length === 3);
  ok('最後は人が決める、と書いてある', /最後は店長が決めて/.test(p1.caution || ''));

  const bShift = await ctxB.query('SELECT id FROM shifts WHERE SCOPE()');
  ok('よその店からシフトは見えない', bShift.length === 0, `店Bから見えた件数 ${bShift.length}`);

  // ══════════ ④ 予測フィードバックループ ══════════
  console.log('\n── ④ 予測 → 実績 → ずれ → 次の予測');

  const sf = await saveForecasts(ctx, { days: 5 });
  ok('1日ぶんの見込み（売上・来客数）を保存できた', sf.ok === true && sf.saved > 0, `${sf.saved}件`);
  const df = await saveDetailForecasts(ctx, { days: 2, hasInventory: true });
  ok('内訳の見込みも保存できた', df.ok === true && df.saved > 0, `${df.saved}件`);

  const fams = await ctx.query(
    `SELECT metric FROM forecasts WHERE SCOPE() AND target_date >= ?`, [addDays(today, 1)]);
  const gotFams = new Set(fams.map((r) => familyOf(r.metric)));
  for (const key of ['sales', 'guests', 'hour_sales', 'item_qty', 'staff']) {
    ok(`「${key}」の見込みが保存されている`, gotFams.has(key));
  }

  // 今日と過去を書き換えていないこと（当たり外れの記録を守る）
  const pastFc = await ctx.query(
    `SELECT metric FROM forecasts WHERE SCOPE() AND target_date <= ?`, [today]);
  ok('今日と過去の見込みは書き換えていない', pastFc.length === 0, `${pastFc.length}件`);

  // 昨日ぶんを「予測 → 実績 → ずれ」で採点する
  const y = addDays(today, -1);
  const yFact = await ctx.first('SELECT sales, guests FROM daily_facts WHERE SCOPE() AND business_date = ?', [y]);
  const yHours = await ctx.query(
    'SELECT hour, sales, guests FROM daily_hour_facts WHERE SCOPE() AND business_date = ? ORDER BY hour', [y]);
  const yItems = await ctx.query(
    'SELECT item_id, qty FROM daily_item_facts WHERE SCOPE() AND business_date = ? AND item_id IS NOT NULL', [y]);

  // わざと 5% 多めに予測していた、という記録を作る
  const put = async (metric, value) => {
    await ctx.run('DELETE FROM forecasts WHERE SCOPE() AND target_date = ? AND metric = ?', [y, metric]);
    await ctx.insert('forecasts', {
      target_date: y, metric, value, low: value * 0.9, high: value * 1.1,
      confidence: 'ふつう', confidence_pct: 50, basis_json: '{}', engine: 'rule', created_at: nowIso(),
    });
  };
  await put('sales', Math.round(Number(yFact.sales) * 1.05));
  await put('guests', Math.round(Number(yFact.guests) * 1.05));
  for (const h of yHours) {
    await put(`hour_sales:${h.hour}`, Math.round(Number(h.sales) * 1.05));
    await put(`staff:${h.hour}`, 3);
  }
  for (const it of yItems.slice(0, 5)) await put(`item_qty:${it.item_id}`, Math.round(Number(it.qty) * 1.05));
  await ctx.insert('stock_moves', {
    business_date: y, ingredient_id: ing, kind: 'use', qty: -200, amount: 0,
    reason: '売れた数から自動計算', waste_reason: '', staff_id: null, staff_name: '',
    created_at: nowIso(),
  });
  await put(`stock_use:${ing}`, 210);

  const sc = await scoreDay(ctx, y);
  ok('昨日ぶんの答え合わせができた', sc.ok === true && sc.scored > 0, `${sc.scored}件`);

  const res = await ctx.query(
    'SELECT metric, predicted, actual, error_pct FROM forecast_results WHERE SCOPE() AND target_date = ?', [y]);
  const resFams = new Set(res.map((r) => familyOf(r.metric)));
  for (const key of ['sales', 'guests', 'hour_sales', 'item_qty', 'staff', 'stock_use']) {
    ok(`「${key}」の答え合わせが残った`, resFams.has(key));
  }
  const rSales = res.find((r) => r.metric === 'sales');
  ok('ずれ（%）が予測と実績から計算されている',
    Math.abs(Number(rSales.error_pct) - 5) < 0.6,
    `予測${Math.round(rSales.predicted).toLocaleString()}円 / 実績${Math.round(rSales.actual).toLocaleString()}円 / ずれ${rSales.error_pct}%`);

  const rStock = res.find((r) => familyOf(r.metric) === 'stock_use');
  ok('在庫需要の実績は「実際に使った量」から取っている', Math.abs(Number(rStock.actual) - 200) < 0.01,
    `実績 ${rStock.actual}`);

  // 予測が実績を書き換えていないこと
  const yFact2 = await ctx.first('SELECT sales, guests FROM daily_facts WHERE SCOPE() AND business_date = ?', [y]);
  ok('採点しても実績（事実）は1円も変わらない',
    Number(yFact2.sales) === Number(yFact.sales) && Number(yFact2.guests) === Number(yFact.guests));

  // 記録が少ないうちは精度を語らない
  const sum1 = await accuracySummary(ctx, { days: 120 });
  const salesFam = sum1.families.find((f) => f.key === 'sales');
  ok('記録が少ない種類は「現在の記録数では精度判断できません」と返す',
    salesFam.enough === false && salesFam.message.includes('現在の記録数では精度判断できません'),
    salesFam.message);
  ok('6種類ぜんぶが並ぶ', sum1.families.length === 6,
    sum1.families.map((f) => f.label).join('・'));

  // 30日ぶん、いつも8%多めに出していた、という答え合わせを作る
  for (let i = 2; i <= 31; i++) {
    const d = addDays(today, -i);
    const f = await ctx.first('SELECT sales FROM daily_facts WHERE SCOPE() AND business_date = ?', [d]);
    if (!f) continue;
    const actual = Number(f.sales);
    await ctx.insert('forecast_results', {
      target_date: d, metric: 'sales', predicted: Math.round(actual * 1.08), actual,
      error_pct: 8, cause_json: JSON.stringify({ inRange: true, family: 'sales' }), created_at: nowIso(),
    });
  }
  const sum2 = await accuracySummary(ctx, { days: 120 });
  const salesFam2 = sum2.families.find((f) => f.key === 'sales');
  ok('記録がたまると精度を出す', salesFam2.enough === true,
    salesFam2.enough ? `${salesFam2.dates}日／ずれの真ん中${salesFam2.medErrorPct}%` : salesFam2.message);
  ok('かたよりの向きが分かる（多めに出しがち）', salesFam2.biasPct > 5, `＋${salesFam2.biasPct}%`);

  const cal = await calibration(ctx, { metric: 'sales', days: 120 });
  ok('かたよりを次の予測に返す倍率が出る', cal.ok === true && cal.ratio < 1,
    `倍率 ${cal.ratio.toFixed(3)}（ずれの真ん中 ＋${cal.biasPct}%）`);
  ok('一度に直しすぎない（上下15%まで）', cal.ratio >= 0.85 && cal.ratio <= 1.15);

  const { predictDay } = await import('../lib/forecast.js');
  const after = await predictDay(ctx, addDays(today, 2));
  const calLine = (after.metrics?.sales?.basis || []).find((b) => String(b.label).includes('補正'));
  ok('次の予測の根拠に補正が現れる（ループが閉じている）', Boolean(calLine), calLine ? calLine.detail : '');
  ok('補正の理由が日本語で説明されている', Boolean(calLine) && /答え合わせ/.test(calLine.detail));

  const bRes = await ctxB.query('SELECT id FROM forecast_results WHERE SCOPE()');
  ok('よその店から答え合わせの記録は見えない', bRes.length === 0, `店Bから見えた件数 ${bRes.length}`);
}

main().catch((e) => { console.error('❌ 落ちました:', e); process.exit(1); });
