// V4（店舗データ蓄積・AI需要予測の強化）の通し確認
// 使い方: DATABASE_URL=file:./data/test-v4.db node scripts/test-v4.mjs
// ※本番DBには絶対に向けないこと（file: の検証用DBのみ）
import { initDb, one, all, nowIso, businessDate } from '../lib/db.js';
import { createCtx } from '../lib/tenant-db.js';
import { hourlyPlan, predictDay } from '../lib/forecast.js';
import { addDays } from '../lib/learn.js';
import { wasteByDow } from '../lib/prep.js';

const url = process.env.DATABASE_URL || '';
if (!url.startsWith('file:')) {
  console.error('検証用の file: DB を指定してください（本番DB保護のため）');
  process.exit(1);
}

const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' … ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

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
  console.log(`店A=${s1.name}(t${s1.tenant_id}/s${s1.id}) 店B=${s2.name}(t${s2.tenant_id}/s${s2.id})`);

  // ── 1) 90日ぶんの実績をつくる（曜日で山を変え、金土を強くする）
  const today = businessDate();
  const hours = [17, 18, 19, 20, 21, 22];
  const shape = { 17: 0.06, 18: 0.14, 19: 0.26, 20: 0.28, 21: 0.18, 22: 0.08 };
  // 「近くの催しがあった日」は実際に25%多かった、という想定で実績を作る
  const venuePast = new Set();
  for (let i = 1; i <= 10; i++) venuePast.add(addDays(today, -(i * 7)));

  let made = 0;
  for (let i = 1; i <= 90; i++) {
    const d = addDays(today, -i);
    const dow = new Date(d + 'T00:00:00+09:00').getDay();
    const base = [0.9, 0.7, 0.75, 0.8, 0.85, 1.3, 1.25][dow];
    const jitter = 0.85 + ((i * 37) % 31) / 100;
    const lift = venuePast.has(d) ? 1.25 : 1;
    const sales = Math.round(180000 * base * jitter * lift);
    const guests = Math.round(60 * base * jitter * lift);
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
    made++;
  }
  ok('90日ぶんの実績を用意', made === 90, `${made}日`);

  // ── 2) 時間帯別の予測（V4-c / V4-d）
  const hp = await hourlyPlan(ctx, today);
  ok('時間帯別の予測が返る', hp.ok === true, hp.reason || '');
  if (hp.ok) {
    const peak = hp.rows.reduce((a, b) => (b.sales > a.sales ? b : a), hp.rows[0]);
    ok('ピーク時間が20時', peak.hour === 20, `${peak.hour}時 / ${peak.sales.toLocaleString()}円`);
    ok('人手の目安が最低人数以上', hp.rows.every((r) => r.staff >= 2), `最大${Math.max(...hp.rows.map((r) => r.staff))}人`);
    const rising = hp.rows.find((r) => r.hour === 20);
    ok('在店の目安は来店より多い（前の時間が残る）', rising.inStore > rising.arrivals,
      `20時 来店${rising.arrivals}人 / 在店${rising.inStore}人`);
    ok('待ち時間を分数で出していない', !JSON.stringify(hp).includes('waitMin'));
    console.log('   ' + hp.rows.map((r) => `${r.hour}時:${Math.round(r.sales / 1000)}千円/${r.staff}人`).join('  '));
  }

  // ── 3) 廃棄の曜日別の偏り（V4-e）
  // 記録が無いうちは「まだ出せません」と言うのが正しい
  const w0 = await wasteByDow(ctx, { days: 90 });
  ok('記録が無いときは正直に断る', w0.ok === false && w0.reason === 'NOT_ENOUGH', w0.message || '');

  const ing = await ctx.insert('ingredients', {
    name: '検証キャベツ', unit: 'g', category: '野菜', unit_cost: 0.4,
    pack_name: '1箱', pack_qty: 5000, supplier: '検証青果', lead_days: 1,
    min_stock: 1000, shelf_days: 3, note: '', active: 1,
    created_at: nowIso(), updated_at: nowIso(),
  });
  for (let i = 1; i <= 60; i++) {
    const d = addDays(today, -i);
    const dow = new Date(d + 'T00:00:00+09:00').getDay();
    const f = await ctx.first('SELECT sales FROM daily_facts WHERE SCOPE() AND business_date = ?', [d]);
    const sales = Number(f?.sales || 0);
    if (!sales) continue;
    const rate = dow === 2 ? 0.030 : 0.012; // 火曜だけ捨てている割合が高い、という想定
    await ctx.insert('stock_moves', {
      business_date: d, ingredient_id: ing, kind: 'waste', qty: -1200,
      amount: Math.round(sales * rate), reason: '仕込み残り',
      staff_id: null, staff_name: '検証', created_at: nowIso(),
    });
  }
  const w = await wasteByDow(ctx, { days: 90 });
  ok('廃棄の曜日別が返る', w.ok === true, w.reason || '');
  if (w.ok) {
    const tue = w.rows.find((r) => r.dow === 2);
    ok('火曜が多いと指摘される', tue && tue.diffPct > 15, tue ? `火曜 ${tue.diffPct > 0 ? '+' : ''}${tue.diffPct}%` : '');
    ok('言い切らない注意書きがある', /分かりません|傾向/.test(w.caution || ''));
  }

  // ── 4) 近くの催し（V4-g）
  const vid = await ctx.insert('venues', {
    name: '検証ドーム', kind: 'live', lat: 34.6693, lng: 135.4762,
    distance_km: 1.2, capacity: 36000, note: '', active: 1, created_at: nowIso(),
  });
  const evDate = addDays(today, 3);
  await ctx.insert('venue_events', {
    venue_id: vid, business_date: evDate, end_date: '', title: '検証ライブ', kind: 'live',
    expected_people: 30000, start_time: '18:00', end_time: '21:00',
    source: 'manual', staff_name: '検証', created_at: nowIso(),
  });
  ok('会場と開催予定を登録できた', Number(vid) > 0, `会場ID ${vid}`);

  const seenByB = await ctxB.query('SELECT id FROM venues WHERE SCOPE()');
  ok('よその店からは会場が見えない', seenByB.length === 0, `店Bから見えた件数 ${seenByB.length}`);

  const venueLine = (fc) => (fc.metrics?.sales?.basis || []).find((b) => String(b.label).includes('検証ドーム'));

  const fcYes = await predictDay(ctx, evDate); // 催しのある日（ただし過去の開催記録はまだ無い）
  ok('催しの日の見込みが作れる', Boolean(fcYes && fcYes.ok && fcYes.metrics?.sales?.value));
  const before = Number(fcYes.metrics?.sales?.value || 0);
  const l1 = venueLine(fcYes);
  ok('催しが根拠に出てくる', Boolean(l1), l1 ? l1.detail : '');
  ok('記録が少ないうちは数字を動かさない',
    Boolean(l1) && /まだ少ない/.test(l1.detail) && Number(l1.effect || 0) === 0,
    '（実績のある開催日がたまってから反映）');
  ok('断定していない（「原因」と書かない）', !/が原因/.test(JSON.stringify(fcYes)));

  // ── 5) 蓄積後：開催実績がたまると相関として扱われるか
  for (const d of venuePast) {
    await ctx.insert('venue_events', {
      venue_id: vid, business_date: d, end_date: '', title: '過去ライブ', kind: 'live',
      expected_people: 30000, start_time: '18:00', end_time: '21:00',
      source: 'manual', staff_name: '検証', created_at: nowIso(),
    });
  }
  const fc2 = await predictDay(ctx, evDate);
  const after = Number(fc2.metrics?.sales?.value || 0);
  const l2 = venueLine(fc2);
  ok('開催実績がたまると相関として現れる', Boolean(l2) && /相関/.test(l2.detail), l2 ? l2.detail : '（まだ足りない）');
  ok('言い切らず「傾向」と書いている', Boolean(l2) && /傾向/.test(l2.detail));
  ok('過去に多かったぶんが見込みに反映される', after > before,
    `${before.toLocaleString()}円 → ${after.toLocaleString()}円`);
  ok('断定していない（「原因」と書かない）', !/が原因/.test(JSON.stringify(fc2)));

  // ── 6) 今日の作戦に、催しのお知らせが載るか
  const { todayPlan } = await import('../lib/forecast.js');
  const tp = await todayPlan(ctx, evDate);
  const note = (tp.notes || []).find((n) => n.kind === 'venue');
  ok('今日の作戦に催しのお知らせが載る', Boolean(note), note ? note.text : '');
  if (note) ok('お知らせも言い切っていない', /可能性/.test(note.text));
}

main().catch((e) => { console.error('❌ 落ちました:', e); process.exit(1); });
