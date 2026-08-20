// V6（レジ会計の店向け「実会計」入力・売上確定・AI学習の優先順位）の通し確認
// 使い方:
//   DATABASE_URL=file:./data/test-v6.db node scripts/seed.mjs
//   DATABASE_URL=file:./data/test-v6.db node scripts/test-v6.mjs
// ※本番DBには絶対に向けないこと（file: の検証用DBのみ）
import { initDb, one, nowIso, businessDate } from '../lib/db.js';
import { createCtx } from '../lib/tenant-db.js';
import {
  addCashSale, editCashSale, confirmDay, daySummary, revisions, decideSales, tableOpen, DIFF_REASONS,
} from '../lib/cash.js';
import { getOpenItems } from '../lib/store.js';
import { rebuildDay } from '../lib/learn.js';

const url = process.env.DATABASE_URL || '';
if (!url.startsWith('file:')) {
  console.error('検証用の file: DB を指定してください（本番DB保護のため）');
  process.exit(1);
}

const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' … ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

/** 失敗するはずの操作。止まった理由（コード）を返す */
const mustFail = async (fn) => {
  try { await fn(); return ''; } catch (e) { return e.code || 'ERROR'; }
};

const audits = [];
const logAudit = async (ctx, a) => { audits.push({ by: ctx.staffName, ...a }); };

async function seatTable(ctx, table, lines) {
  const ts = nowIso();
  const orderId = await ctx.insert('orders', {
    public_id: `v6_${table.id}_${Date.now()}`, table_id: Number(table.id),
    client_order_id: `v6_${table.id}_${Date.now()}`, source: 'test', staff_id: null, created_at: ts,
  });
  const ids = [];
  for (const l of lines) {
    ids.push(await ctx.insert('order_items', {
      order_id: orderId, table_id: Number(table.id), item_id: null, name: l.name,
      unit_price: l.price, cost: Math.floor(l.price * 0.3), qty: l.qty, station: 'kitchen',
      status: 'received', via: 'test', check_id: null, created_at: ts, updated_at: ts,
    }));
  }
  await ctx.run(
    `UPDATE tables SET status = 'seated', guests = ?, opened_at = ? WHERE SCOPE() AND id = ?`,
    [lines.guests || 2, ts, Number(table.id)]
  );
  return { orderId, ids, total: lines.reduce((s, l) => s + l.price * l.qty, 0) };
}

async function main() {
  await initDb();

  const s1 = await one('SELECT * FROM stores ORDER BY id LIMIT 1');
  const s2 = await one('SELECT * FROM stores ORDER BY id DESC LIMIT 1');
  const t1 = await one('SELECT * FROM tenants WHERE id = ?', [s1.tenant_id]);
  // レジ会計の店（ライトプラン）
  const A = createCtx({
    tenantId: s1.tenant_id, storeId: s1.id, role: 'owner', staffId: 1,
    staffName: '店長A', plan: 'light', tenant: t1, store: s1,
  });
  const B = createCtx({
    tenantId: s2.tenant_id, storeId: s2.id, role: 'owner', staffId: 2,
    staffName: '店長B', plan: 'light', tenant: null, store: s2,
  });
  ok('検証用の店が2つある（他店から見えないことを確かめるため）', s1.id !== s2.id,
    `店A=${s1.name}(s${s1.id}) 店B=${s2.name}(s${s2.id})`);

  const date = businessDate();
  for (const c of [A, B]) {
    for (const t of ['cash_sale_revisions', 'cash_sales', 'cash_day_closes', 'order_items', 'orders', 'checks', 'daily_facts']) {
      await c.run(`DELETE FROM ${t} WHERE SCOPE()`);
    }
  }

  const tables = await A.query('SELECT * FROM tables WHERE SCOPE() ORDER BY id LIMIT 3');
  ok('検証に使える卓が3つ以上ある', tables.length >= 3, `${tables.length}卓`);

  // ══════════ 1. 実会計を入力できる（注文は消えない） ══════════
  console.log('\n1. 実会計の入力');

  const o1 = await seatTable(A, tables[0], [
    { name: '生ビール', price: 600, qty: 4 }, { name: '唐揚げ', price: 780, qty: 2 },
  ]);
  ok('卓1の注文上の合計が計算できる', o1.total === 3960, `${o1.total}円`);

  const r1 = await addCashSale(A, {
    tableId: tables[0].id, amount: 3960, guests: 4, paymentMethod: 'cash', note: '',
  }, { clearTable: true, logAudit });
  ok('注文どおりの金額なら、理由なしで実会計を記録できる', r1.ok && r1.diff === 0, `実会計 ${r1.amount}円`);

  const afterClear = await A.query(
    `SELECT status, check_id FROM order_items WHERE SCOPE() AND table_id = ?`, [tables[0].id]
  );
  ok('席を空けても注文履歴は1件も消えない', afterClear.length === 2, `${afterClear.length}件残っている`);
  ok('席を空けた注文は「提供済」として残る（会計扱いにはしない）',
    afterClear.every((r) => r.status === 'served' && r.check_id === null));

  const tbl1 = await A.first('SELECT * FROM tables WHERE SCOPE() AND id = ?', [tables[0].id]);
  ok('卓が空席に戻り、QRも新しくなる（前の組の注文が次のお客様に見えない）',
    tbl1.status === 'empty' && Number(tbl1.guests) === 0 && tbl1.token !== tables[0].token);

  // ★席を空けたら、その注文は「卓から外れた」状態にならなければならない。
  //   ここが抜けていると、次のお客様のQR画面に前の組の注文と合計が出てしまう。
  const stillOpen = await getOpenItems(A, tables[0].id);
  ok('席を空けたら、卓に残る未会計は0件になる（次のお客様に前の組が見えない）',
    stillOpen.length === 0, `${stillOpen.length}件`);
  const openAfter = await tableOpen(A, tables[0].id);
  ok('次のお客様から見た「注文上の合計」も0円に戻る', openAfter.total === 0, `${openAfter.total}円`);

  // ★同じ卓に次のお客様が入っても、もう一度きちんと実会計を記録できる。
  //   前の組の注文が卓に残っていると「すでに実会計に入っています」で止まり、
  //   その卓はその日ずっと売上を記録できなくなる。
  const o1b = await seatTable(A, tables[0], [{ name: 'ハイボール', price: 500, qty: 2 }]);
  const nextOpen = await tableOpen(A, tables[0].id);
  ok('次のお客様の注文だけが卓の合計になる（前の組が混ざらない）',
    nextOpen.total === 1000 && nextOpen.ids.length === 1, `${nextOpen.total}円 / ${nextOpen.ids.length}件`);
  const r1b = await addCashSale(A, {
    tableId: tables[0].id, amount: 1000, guests: 2, paymentMethod: 'cash',
  }, { clearTable: true, logAudit });
  ok('同じ卓で2組目の実会計もちゃんと記録できる', r1b.ok && r1b.orderTotal === 1000, `${r1b.orderTotal}円`);
  const hist1 = await A.query(
    `SELECT id FROM order_items WHERE SCOPE() AND table_id = ?`, [tables[0].id]
  );
  ok('2組ぶんの注文履歴が両方とも残る', hist1.length === 3, `${hist1.length}件`);

  // ══════════ 2. 差額は自動でそろえない ══════════
  console.log('\n2. 注文合計と実会計の差');

  const o2 = await seatTable(A, tables[1], [{ name: 'コース', price: 12400, qty: 1 }]);
  const noReason = await mustFail(() => addCashSale(A, {
    tableId: tables[1].id, amount: 12000, guests: 4,
  }, { clearTable: true, logAudit }));
  ok('金額がちがうのに理由がないと、記録できない', noReason === 'REASON_REQUIRED', noReason);

  const r2 = await addCashSale(A, {
    tableId: tables[1].id, amount: 12000, guests: 4, diffReason: 'discount', paymentMethod: 'card',
  }, { clearTable: true, logAudit });
  ok('理由を選べば、差額があっても記録できる', r2.ok && r2.diff === -400,
    `注文 ${r2.orderTotal}円／実会計 ${r2.amount}円／差額 ${r2.diff}円`);

  const row2 = await A.first('SELECT * FROM cash_sales WHERE SCOPE() AND id = ?', [r2.id]);
  ok('注文上の合計と実会計が、どちらも別々に残っている',
    Number(row2.order_total) === 12400 && Number(row2.amount) === 12000 && Number(row2.diff) === -400);
  ok('差額の理由が日本語で残る', DIFF_REASONS[row2.diff_reason] === '値引き', DIFF_REASONS[row2.diff_reason]);
  const items2 = await A.query('SELECT unit_price, qty FROM order_items WHERE SCOPE() AND table_id = ?', [tables[1].id]);
  ok('実会計を入れても、注文の金額は書き換わらない',
    items2.length === 1 && Number(items2[0].unit_price) === 12400, `${items2[0]?.unit_price}円`);

  // ══════════ 3. 二重会計にならない ══════════
  console.log('\n3. 二重会計の防止');

  const dupCode = await mustFail(() => addCashSale(A, {
    tableId: tables[1].id, amount: 12000, guests: 4, diffReason: 'discount',
  }, { logAudit }));
  ok('同じ卓の同じ注文を、二度お金にできない', dupCode === 'ALREADY_ENTERED', dupCode);

  const sum1 = await daySummary(A, date);
  ok('入力済みの実会計は3件、合計は注文合計とは別に出る',
    sum1.entries.length === 3 && sum1.cashTotal === 16960 && sum1.orderTotal === 17360,
    `注文合計 ${sum1.orderTotal}円／実会計 ${sum1.cashTotal}円／差 ${sum1.diff}円`);

  // ══════════ 4. 未入力が分かる ══════════
  console.log('\n4. 未入力の見える化');

  const o3 = await seatTable(A, tables[2], [{ name: '刺身盛り', price: 2200, qty: 2 }]);
  const sum2 = await daySummary(A, date);
  ok('実会計が入っていない卓が「未入力」として出る',
    sum2.missingCount === 1 && sum2.missingTotal === 4400,
    `未入力 ${sum2.missingCount}件／${sum2.missingTotal}円`);

  // ══════════ 5. 本日の売上を確定 ══════════
  console.log('\n5. 本日の売上を確定');

  const hasMissing = await mustFail(() => confirmDay(A, { date }, { logAudit }));
  ok('未入力があるまま、うっかり確定できない', hasMissing === 'HAS_MISSING', hasMissing);

  await addCashSale(A, {
    tableId: tables[2].id, amount: 4400, guests: 2, paymentMethod: 'qr',
  }, { clearTable: true, logAudit });

  const conf = await confirmDay(A, { date }, { logAudit });
  ok('全部入力すれば、その日の売上を確定できる',
    conf.ok && conf.cashTotal === 21360 && conf.entries === 4,
    `実会計 ${conf.cashTotal}円／${conf.entries}件`);

  const lockedEdit = await mustFail(() => editCashSale(A, {
    id: r2.id, amount: 12400, reason: 'あとから直したい',
  }, { logAudit }));
  ok('確定した売上は、あとから書き換えられない', lockedEdit === 'LOCKED', lockedEdit);

  const lockedAdd = await mustFail(() => addCashSale(A, { amount: 5000, orderTotal: 5000 }, { logAudit }));
  ok('確定した日に、あとから実会計を足せない', lockedAdd === 'DAY_CONFIRMED', lockedAdd);

  const twice = await mustFail(() => confirmDay(A, { date }, { logAudit }));
  ok('同じ日を二度確定できない', twice === 'ALREADY_CONFIRMED', twice);

  // ══════════ 6. 直した控えが残る ══════════
  console.log('\n6. 直した記録が残る');

  const yday = new Date(new Date(`${date}T00:00:00+09:00`).getTime() - 86400000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const y1 = await addCashSale(A, {
    date: yday, amount: 8000, orderTotal: 8000, tableName: '前日ぶん', guests: 3,
  }, { logAudit });

  const noWhy = await mustFail(() => editCashSale(A, { id: y1.id, amount: 7500 }, { logAudit }));
  ok('理由なしでは直せない', noWhy === 'REASON_REQUIRED', noWhy);

  const ed = await editCashSale(A, {
    id: y1.id, amount: 7500, diffReason: 'mistake', reason: '5百円多く入れていた',
  }, { logAudit });
  ok('理由を書けば直せる（版が増える）', ed.ok && ed.revision === 2, `版 ${ed.revision}`);

  const revs = await revisions(A, y1.id);
  ok('直す前の金額と、直したあとの金額が両方残る',
    revs.length === 1 && revs[0].before.amount === 8000 && revs[0].after.amount === 7500,
    `${revs[0]?.before.amount}円 → ${revs[0]?.after.amount}円`);
  ok('誰が・なぜ直したかが残る',
    revs[0].by === '店長A' && revs[0].reason === '5百円多く入れていた', `${revs[0]?.by}／${revs[0]?.reason}`);

  // ══════════ 7. 操作ログ ══════════
  console.log('\n7. 誰が・いつ・何をしたか');

  const acts = audits.map((a) => a.action);
  ok('実会計の入力が操作ログに残る', acts.filter((a) => a === 'cash.create').length === 5,
    `${acts.filter((a) => a === 'cash.create').length}件`);
  ok('売上の確定が操作ログに残る', acts.includes('cash.confirm'));
  ok('直したことが操作ログに残る', acts.includes('cash.update'));
  ok('操作ログに入力した人の名前が残る', audits.every((a) => a.by === '店長A'));

  // ══════════ 8. 他店から見えない ══════════
  console.log('\n8. 他店舗から見えない');

  const bSum = await daySummary(B, date);
  ok('店Bからは、店Aの実会計が1件も見えない',
    bSum.entries.length === 0 && bSum.cashTotal === 0, `${bSum.entries.length}件`);
  const bEdit = await mustFail(() => editCashSale(B, { id: y1.id, amount: 1, reason: 'よそから直す' }, { logAudit }));
  ok('店Bからは、店Aの実会計を直せない', bEdit === 'NOT_FOUND', bEdit);
  const bDecide = await decideSales(B, date, { posSales: 0, posChecks: 0, posGuests: 0, orderTotal: 0 });
  ok('店Bの売上には、店Aの金額がまざらない', bDecide.sales === 0 && bDecide.source === 'none', bDecide.source);

  // ══════════ 9. AIが使う売上の優先順位 ══════════
  console.log('\n9. AI学習に使う売上の出どころ');

  const d1 = await decideSales(A, date, { posSales: 111111, posChecks: 9, posGuests: 20, orderTotal: 21760 });
  ok('確定した実会計があれば、それを最優先で使う（POSや注文合計より上）',
    d1.source === 'cash_confirmed' && d1.confidence === 3 && d1.sales === 21360,
    `${d1.source}／${d1.sales}円`);

  const d2 = await decideSales(A, yday, { posSales: 50000, posChecks: 4, posGuests: 10, orderTotal: 33000 });
  ok('確定していない日は、POSの会計を使う', d2.source === 'pos' && d2.confidence === 2 && d2.sales === 50000,
    `${d2.source}／${d2.sales}円`);

  const d3 = await decideSales(A, yday, { posSales: 0, posChecks: 0, posGuests: 8, orderTotal: 33000 });
  ok('POSも無い日は、注文合計を「参考値」として使う',
    d3.source === 'order' && d3.confidence === 1 && d3.sales === 33000, `${d3.source}／${d3.sales}円`);

  const d4 = await decideSales(A, '2000-01-01', {});
  ok('どれも無い日は「データなし」になり、0円を売上として作らない',
    d4.source === 'none' && d4.confidence === 0 && d4.sales === 0, d4.source);

  ok('確定した日でも、注文合計と実会計は別の数字として持ち回る',
    d1.orderTotal === 21760 && d1.cashTotal === 21360 && d1.cashEntries === 4,
    `注文 ${d1.orderTotal}円／実会計 ${d1.cashTotal}円`);

  // ══════════ 10. その日のまとめ（AIが読む所） ══════════
  console.log('\n10. その日のまとめへの反映');

  await rebuildDay(A, date);
  const fact = await A.first('SELECT * FROM daily_facts WHERE SCOPE() AND business_date = ?', [date]);
  ok('その日のまとめに、確定した実売上が入る', Number(fact.sales) === 21360, `${fact?.sales}円`);
  ok('その日のまとめに、売上の出どころが残る（AIが注文金額と実売上を混ぜない）',
    fact.sales_source === 'cash_confirmed' && Number(fact.sales_confidence) === 3,
    `${fact?.sales_source}／確かさ${fact?.sales_confidence}`);
  ok('注文合計も参考値として別枠で残る', Number(fact.order_total) === 21760, `${fact?.order_total}円`);
  ok('実会計の合計と件数も別枠で残る',
    Number(fact.cash_total) === 21360 && Number(fact.cash_entries) === 4);

  // AIの予測は、確定した実売上を書き換えない
  const before = Number(fact.sales);
  await A.insert('forecasts', {
    target_date: date, metric: 'sales', value: 999999, low: 900000, high: 1100000,
    engine: 'rule', basis_json: '{}', created_at: nowIso(),
  });
  await rebuildDay(A, date);
  const fact2 = await A.first('SELECT sales, sales_source FROM daily_facts WHERE SCOPE() AND business_date = ?', [date]);
  ok('AIの予測値が、確定した実売上を書き換えない',
    Number(fact2.sales) === before && fact2.sales_source === 'cash_confirmed', `${fact2?.sales}円`);

  console.log(`\n${process.exitCode ? '❌ 直すところがあります' : '✅ V6 すべて通りました'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
