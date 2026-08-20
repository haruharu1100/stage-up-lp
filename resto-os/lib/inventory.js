/**
 * 材料・レシピ・在庫と、発注の提案。
 *
 * ★このファイルでいちばん大事な決まりごと:
 *   **システムは絶対に自分で発注しない。**
 *   ここが作るのは「案」だけ。案は必ず人が見て、数量を直せて、承認するまで発注済みにならない。
 *   自動発注は、一度事故が起きると取り返しがつかない（届いてしまう・支払いが発生する）。
 *   仕入れは店の信用と現金に直結するので、最後の一押しは必ず人が押す。
 *
 * 在庫の持ち方:
 *   在庫の「数」を直接書き換えない。動き（stock_moves）だけを積む。
 *   いまの在庫＝いちばん新しい棚卸(count)の数 ＋ そのあとの増減。
 *   こうすると「誰がいつ何をしてこの数になったか」が必ず追える。
 *   数を上書きする作りだと、合わないときに原因がどこにも残らない。
 *
 * 守っている決まりごと:
 *  1. 提案の数量(suggest_qty)と、人が決めた数量(approved_qty)は別に持つ。
 *     どれだけ直されたかが残るので、提案の精度をあとから見直せる。
 *  2. 材料が1件も登録されていない状態でも、画面はきちんと「まず何をすればよいか」を出す。
 *  3. 原価・金額は、原価を見てよい権限の人にしか返さない。
 *  4. 数字はAIに書かせない。ここの計算はすべてこのファイルが記録から出す。
 */

import { addDays } from './learn.js';
import { nowIso, withTx } from './db.js';
import { prepPlan } from './prep.js';
import { WASTE_REASONS, WASTE_REASON_LABEL, isWasteReason } from './domain/waste.js';

export { WASTE_REASONS, WASTE_REASON_LABEL };

export const MOVE_KINDS = ['count', 'receive', 'use', 'waste', 'adjust'];

export const MOVE_LABEL = {
  count: '棚卸',
  receive: '入荷',
  use: '使用',
  waste: '廃棄',
  adjust: '手直し',
};

export const PLAN_STATUS_LABEL = {
  draft: '提案のまま',
  approved: '承認済み',
  ordered: '発注済み',
  rejected: '見送り',
};

const UNITS = ['g', 'kg', 'ml', 'L', '個', '枚', '本', '袋', '玉', '尾', '束', 'パック'];

function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clean(s, max = 60) {
  return String(s ?? '').trim().slice(0, max);
}

// ===== 材料の台帳 =====

export async function listIngredients(ctx, { includeInactive = false } = {}) {
  const rows = await ctx.query(
    `SELECT * FROM ingredients WHERE SCOPE() ${includeInactive ? '' : 'AND active = 1'}
      ORDER BY category, name`,
    [],
  );
  return rows;
}

export async function saveIngredient(ctx, data) {
  const name = clean(data.name, 40);
  if (!name) throw new Error('材料の名前を入れてください');
  const unit = clean(data.unit, 10) || 'g';
  const now = nowIso();

  const row = {
    name,
    unit,
    category: clean(data.category, 20),
    unit_cost: Math.max(0, num(data.unitCost)),
    pack_name: clean(data.packName, 20),
    pack_qty: Math.max(0, num(data.packQty)),
    supplier: clean(data.supplier, 40),
    lead_days: Math.max(0, Math.min(30, Math.round(num(data.leadDays, 1)))),
    min_stock: Math.max(0, num(data.minStock)),
    shelf_days: Math.max(0, Math.min(365, Math.round(num(data.shelfDays)))),
    note: clean(data.note, 120),
    active: data.active === 0 || data.active === false ? 0 : 1,
    updated_at: now,
  };

  if (data.id) {
    const id = Number(data.id);
    const cur = await ctx.first(`SELECT id FROM ingredients WHERE SCOPE() AND id = ?`, [id]);
    if (!cur) throw new Error('その材料が見つかりません');
    const cols = Object.keys(row);
    await ctx.run(
      `UPDATE ingredients SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE SCOPE() AND id = ?`,
      [...cols.map((c) => row[c]), id],
    );
    return { ok: true, id, created: false };
  }

  const dup = await ctx.first(`SELECT id FROM ingredients WHERE SCOPE() AND name = ?`, [name]);
  if (dup) throw new Error('同じ名前の材料がすでにあります');
  const id = await ctx.insert('ingredients', { ...row, created_at: now });
  return { ok: true, id, created: true };
}

// ===== レシピ =====

/** 商品1つに使う材料の一覧 */
export async function listRecipe(ctx, itemId) {
  return ctx.query(
    `SELECT r.id, r.ingredient_id, r.qty, i.name, i.unit, i.unit_cost
       FROM recipe_lines r JOIN ingredients i ON i.id = r.ingredient_id
      WHERE SCOPE(r) AND r.item_id = ? ORDER BY i.name`,
    [Number(itemId)],
  );
}

/** 商品のレシピを丸ごと入れ替える（部分更新より、画面の見たままと必ず一致するほうが事故が少ない） */
export async function saveRecipe(ctx, itemId, lines) {
  const id = Number(itemId);
  const item = await ctx.first(`SELECT id, name FROM menu_items WHERE SCOPE() AND id = ?`, [id]);
  if (!item) throw new Error('その商品が見つかりません');

  const keep = (Array.isArray(lines) ? lines : [])
    .map((l) => ({ ingredient_id: Number(l.ingredientId ?? l.ingredient_id), qty: num(l.qty) }))
    .filter((l) => Number.isInteger(l.ingredient_id) && l.ingredient_id > 0 && l.qty > 0);

  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    await t.run(`DELETE FROM recipe_lines WHERE SCOPE() AND item_id = ?`, [id]);
    const now = nowIso();
    const seen = new Set();
    for (const l of keep) {
      if (seen.has(l.ingredient_id)) continue; // 同じ材料が2行あっても1行にまとめる
      seen.add(l.ingredient_id);
      const ing = await t.first(`SELECT id FROM ingredients WHERE SCOPE() AND id = ?`, [l.ingredient_id]);
      if (!ing) continue; // 他店の材料IDを送られても、ここで必ず落ちる
      await t.insert('recipe_lines', {
        item_id: id, ingredient_id: l.ingredient_id, qty: l.qty, created_at: now,
      });
    }
  });
  return { ok: true, itemId: id, lines: keep.length };
}

/** レシピが登録できている商品の一覧（どこまで登録が進んだかを画面に出すため） */
export async function recipeCoverage(ctx) {
  const items = await ctx.query(
    `SELECT id, name, category_id FROM menu_items WHERE SCOPE() AND active = 1 ORDER BY name`,
    [],
  );
  const done = await ctx.query(
    `SELECT item_id, COUNT(*) AS n FROM recipe_lines WHERE SCOPE() GROUP BY item_id`,
    [],
  );
  const map = new Map(done.map((r) => [Number(r.item_id), Number(r.n)]));
  const rows = items.map((it) => ({ id: Number(it.id), name: it.name, lines: map.get(Number(it.id)) || 0 }));
  const withRecipe = rows.filter((r) => r.lines > 0).length;
  return { rows, total: rows.length, withRecipe };
}

// ===== 在庫 =====

/**
 * いまの在庫を出す。
 * いちばん新しい棚卸の数を出発点にして、そのあとの動きを足し引きする。
 * 棚卸が一度も無い材料は「未確認」として返す（0だと言い切らない）。
 *
 * ★「そのあと」は日付ではなく、記録した順（id）で見る。
 *   朝に棚卸して、昼に入荷して、夜に廃棄が出る──同じ日に何度も動くのがふつうなので、
 *   日付で切ると、その日の入荷や廃棄がまるごと消えてしまう。
 */
export async function currentStock(ctx) {
  const ings = await listIngredients(ctx);
  if (!ings.length) return [];

  // 材料ごとの「いちばん新しい棚卸」。同じ日に2回入っていても、あとに入れたほうを採る。
  const counts = await ctx.query(
    `SELECT ingredient_id, MAX(id) AS last_id FROM stock_moves
      WHERE SCOPE() AND kind = 'count' GROUP BY ingredient_id`,
    [],
  );
  const lastId = new Map(counts.map((r) => [Number(r.ingredient_id), Number(r.last_id)]));

  const countRows = await ctx.query(
    `SELECT id, ingredient_id, business_date, qty FROM stock_moves WHERE SCOPE() AND kind = 'count'`,
    [],
  );
  const baseQty = new Map();
  const baseDate = new Map();
  for (const r of countRows) {
    const iid = Number(r.ingredient_id);
    if (Number(r.id) !== lastId.get(iid)) continue;
    baseQty.set(iid, num(r.qty));
    baseDate.set(iid, r.business_date);
  }

  // 棚卸のあとの増減
  const moves = await ctx.query(
    `SELECT id, ingredient_id, qty FROM stock_moves WHERE SCOPE() AND kind <> 'count'`,
    [],
  );
  const delta = new Map();
  for (const r of moves) {
    const iid = Number(r.ingredient_id);
    const since = lastId.get(iid);
    if (since && Number(r.id) < since) continue; // 棚卸より前の動きは、棚卸の数にもう含まれている
    delta.set(iid, (delta.get(iid) || 0) + num(r.qty));
  }

  return ings.map((i) => {
    const id = Number(i.id);
    const counted = lastId.has(id);
    const qty = counted ? (baseQty.get(id) || 0) + (delta.get(id) || 0) : null;
    return {
      id,
      name: i.name,
      unit: i.unit,
      category: i.category || '',
      supplier: i.supplier || '',
      minStock: num(i.min_stock),
      leadDays: num(i.lead_days, 1),
      shelfDays: num(i.shelf_days),
      packName: i.pack_name || '',
      packQty: num(i.pack_qty),
      unitCost: num(i.unit_cost),
      qty,
      counted,
      lastCount: counted ? (baseDate.get(id) || '') : '',
      low: counted && num(i.min_stock) > 0 && qty !== null && qty < num(i.min_stock),
    };
  });
}

/** 在庫の動きを1件記録する。棚卸だけは「その時点の数」、それ以外は増減。 */
export async function addMove(ctx, { ingredientId, kind, qty, reason = '', wasteReason = '', date = null }) {
  const iid = Number(ingredientId);
  if (!MOVE_KINDS.includes(kind)) throw new Error('記録の種類が正しくありません');
  // 廃棄は理由が要る。理由の無い廃棄記録は、あとから何の役にも立たないため。
  let wr = '';
  if (kind === 'waste') {
    wr = String(wasteReason || '');
    if (!isWasteReason(wr)) throw new Error('捨てた理由を選んでください');
  }
  const ing = await ctx.first(`SELECT * FROM ingredients WHERE SCOPE() AND id = ?`, [iid]);
  if (!ing) throw new Error('その材料が見つかりません');

  let q = num(qty);
  if (kind === 'count') {
    if (q < 0) throw new Error('棚卸の数はマイナスにできません');
  } else if (kind === 'use' || kind === 'waste') {
    // 使った・捨てた量は、画面ではプラスで入れてもらい、ここでマイナスに直す。
    // 入力する人にマイナスを書かせると、必ず符号の間違いが起きる。
    q = -Math.abs(q);
  }
  if (q === 0 && kind !== 'count') throw new Error('数量を入れてください');

  const amount = Math.round(Math.abs(q) * num(ing.unit_cost));
  const id = await ctx.insert('stock_moves', {
    business_date: date || todayJst(),
    ingredient_id: iid,
    kind,
    qty: q,
    amount: kind === 'waste' || kind === 'receive' ? amount : 0,
    waste_reason: wr,
    reason: clean(reason, 120),
    staff_id: ctx.staffId ? Number(ctx.staffId) : null,
    staff_name: ctx.staffName || '',
    created_at: nowIso(),
  });
  return { ok: true, id, qty: q, amount };
}

/**
 * その日に売れた商品ぶんの材料を、自動で「使用」として引く。
 *
 * これが無いと、在庫は入荷でしか動かず、いつまでも減らない。
 * 毎日スタッフに使用量を手入力させるのは現実的でないので、
 * 「売れた数 × レシピ」で機械的に引き、ズレは棚卸で直す、という運用にする。
 *
 * 同じ日を何度動かしても増えないよう、その日の自動ぶんは消してから入れ直す。
 * 人が手で入れた使用・廃棄の記録には触らない（reason で見分ける）。
 */
export async function consumeDay(ctx, date = null) {
  const target = date || todayJst();
  const recipes = await ctx.query(`SELECT item_id, ingredient_id, qty FROM recipe_lines WHERE SCOPE()`, []);
  if (!recipes.length) return { ok: true, date: target, lines: 0, message: 'レシピが未登録のため、使用量の計算はしません。' };

  const sold = await ctx.query(
    `SELECT item_id, name, qty FROM daily_item_facts WHERE SCOPE() AND business_date = ? AND item_id IS NOT NULL`,
    [target],
  );
  if (!sold.length) return { ok: true, date: target, lines: 0 };

  const soldBy = new Map(sold.map((r) => [Number(r.item_id), num(r.qty)]));
  const use = new Map();
  for (const r of recipes) {
    const q = soldBy.get(Number(r.item_id));
    if (!q) continue;
    const iid = Number(r.ingredient_id);
    use.set(iid, (use.get(iid) || 0) + num(r.qty) * q);
  }
  if (!use.size) return { ok: true, date: target, lines: 0 };

  const costs = await ctx.query(`SELECT id, unit_cost FROM ingredients WHERE SCOPE()`, []);
  const costBy = new Map(costs.map((r) => [Number(r.id), num(r.unit_cost)]));

  const AUTO = '売れた数から自動計算';
  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    await t.run(
      `DELETE FROM stock_moves WHERE SCOPE() AND business_date = ? AND kind = 'use' AND reason = ?`,
      [target, AUTO],
    );
    const now = nowIso();
    for (const [iid, q] of use) {
      if (q <= 0) continue;
      await t.insert('stock_moves', {
        business_date: target,
        ingredient_id: iid,
        kind: 'use',
        qty: -q,
        amount: 0, // 使用は原価に計上済みなので、ここでは金額を二重に数えない
        reason: AUTO,
        staff_id: null,
        staff_name: '',
        created_at: now,
      });
    }
  });
  return { ok: true, date: target, lines: use.size };
}

export async function listMoves(ctx, { days = 14, ingredientId = null, limit = 100 } = {}) {
  const to = todayJst();
  const from = addDays(to, -Math.max(1, Math.min(365, days)));
  const args = [from, to];
  let where = '';
  if (ingredientId) { where = 'AND m.ingredient_id = ?'; args.push(Number(ingredientId)); }
  args.push(Math.max(1, Math.min(300, limit)));
  const rows = await ctx.query(
    `SELECT m.id, m.business_date AS date, m.kind, m.qty, m.amount, m.reason, m.waste_reason, m.staff_name,
            i.name, i.unit
       FROM stock_moves m JOIN ingredients i ON i.id = m.ingredient_id
      WHERE SCOPE(m) AND m.business_date BETWEEN ? AND ? ${where}
      ORDER BY m.business_date DESC, m.id DESC LIMIT ?`,
    args,
  );
  return rows.map((r) => ({
    ...r,
    wasteReason: r.waste_reason || '',
    wasteReasonLabel: WASTE_REASON_LABEL[r.waste_reason] || '',
  }));
}

// ===== 発注の提案 =====

/**
 * 何日ぶんかの見込みから、材料が足りるかを確かめて、足りない材料の案を作る。
 *
 * 考え方:
 *   1. これから数日ぶんの「商品ごとの見込み出数」を仕込み提案から取る
 *   2. レシピを掛けて「材料ごとに何ぶん要るか」に直す
 *   3. いまの在庫を引く
 *   4. 足りなければ、仕入れ単位（ケースなど）に切り上げて案にする
 *
 * わざとやっていること:
 *   ・見込みの上限側ではなく目安で計算する。上限で発注すると、毎回だいたい余る。
 *   ・そのぶん「最低量(min_stock)」を必ず上乗せして、切らさない側の保険にする。
 *   ・届くまでの日数(lead_days)が長い材料は、早めに出す（urgency='soon'）。
 */
export async function buildOrderPlan(ctx, { days = 3, from = null } = {}) {
  const start = from || addDays(todayJst(), 1);
  const span = Math.max(1, Math.min(7, Math.round(num(days, 3))));

  const ings = await currentStock(ctx);
  if (!ings.length) {
    return { ok: false, reason: 'NO_INGREDIENTS', message: '材料がまだ1件も登録されていません。材料を登録すると、発注の提案が出せるようになります。' };
  }

  const recipes = await ctx.query(
    `SELECT item_id, ingredient_id, qty FROM recipe_lines WHERE SCOPE()`,
    [],
  );
  if (!recipes.length) {
    return { ok: false, reason: 'NO_RECIPE', message: 'レシピ（商品にどの材料をどれだけ使うか）がまだ登録されていません。よく出る商品から数品だけでも登録すると、発注の提案が出せるようになります。' };
  }
  const byItem = new Map();
  for (const r of recipes) {
    const k = Number(r.item_id);
    if (!byItem.has(k)) byItem.set(k, []);
    byItem.get(k).push({ ingredientId: Number(r.ingredient_id), qty: num(r.qty) });
  }

  // 何日ぶんの仕込み見込みを積む
  const need = new Map();      // ingredientId → 必要量
  const fromItems = new Map(); // ingredientId → どの商品ぶんか（根拠に出す）
  const dates = [];
  let covered = 0;
  for (let i = 0; i < span; i += 1) {
    const d = addDays(start, i);
    const p = await prepPlan(ctx, d, { limit: 200 });
    if (!p.ok) { dates.push({ date: d, ok: false, message: p.message }); continue; }
    covered += 1;
    dates.push({ date: d, ok: true, guests: p.guests.value, items: p.lines.length });
    for (const line of p.lines) {
      if (!line.itemId) continue; // メニューに紐づかない記録（取り込んだ過去データなど）は使わない
      const rec = byItem.get(Number(line.itemId));
      if (!rec) continue;
      for (const r of rec) {
        need.set(r.ingredientId, (need.get(r.ingredientId) || 0) + r.qty * line.qty);
        if (!fromItems.has(r.ingredientId)) fromItems.set(r.ingredientId, new Set());
        fromItems.get(r.ingredientId).add(line.name);
      }
    }
  }

  if (!covered) {
    return { ok: false, reason: 'NO_FORECAST', message: 'まだ記録が足りず、見込みが出せません。記録がたまると、発注の提案も出せるようになります。', dates };
  }

  const lines = [];
  for (const ing of ings) {
    const needQty = need.get(ing.id) || 0;
    if (needQty <= 0 && !(ing.counted && ing.low)) continue;

    // 在庫が未確認（棚卸をまだ一度もしていない）なら、0として案は出すが理由に明記する
    const stock = ing.counted ? Math.max(0, ing.qty) : 0;
    const target = needQty + ing.minStock;
    const short = target - stock;
    if (short <= 0) continue;

    const packQty = ing.packQty > 0 ? ing.packQty : 0;
    const packs = packQty ? Math.ceil(short / packQty) : 0;
    const suggest = packQty ? packs * packQty : Math.ceil(short);
    const amount = Math.round(suggest * ing.unitCost);

    const r1 = (v) => Math.round(v * 10) / 10;
    const why = [];
    why.push(`${span}日ぶんの見込みで${r1(needQty)}${ing.unit}使う想定`);
    if (ing.minStock > 0) why.push(`切らしたくない量${r1(ing.minStock)}${ing.unit}を上乗せ`);
    why.push(ing.counted ? `いまの在庫${r1(stock)}${ing.unit}（${ing.lastCount}の棚卸から計算）` : '在庫の棚卸がまだ無いため、0として計算');
    if (packQty) why.push(`${ing.packName || '仕入れ単位'}＝${packQty}${ing.unit}なので切り上げ`);

    lines.push({
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      supplier: ing.supplier,
      needQty: Math.round(needQty * 10) / 10,
      stockQty: ing.counted ? Math.round(stock * 10) / 10 : 0,
      suggestQty: suggest,
      packQty,
      packs,
      unitCost: ing.unitCost,
      amount,
      urgency: ing.leadDays >= 2 || (ing.counted && ing.low) ? 'soon' : 'normal',
      reason: why.join(' / '),
      counted: ing.counted,
    });
  }

  lines.sort((a, b) => (a.urgency === b.urgency ? b.amount - a.amount : a.urgency === 'soon' ? -1 : 1));

  return {
    ok: true,
    from: start,
    to: addDays(start, span - 1),
    days: span,
    covered,
    dates,
    lines,
    total: lines.reduce((s, r) => s + r.amount, 0),
    note: 'これは案です。システムは自分で発注しません。数量を直したうえで、承認してください。',
  };
}

/** 案を保存する（保存しただけでは発注にならない。status は draft） */
export async function saveOrderPlan(ctx, plan) {
  if (!plan?.ok || !plan.lines?.length) throw new Error('保存できる案がありません');
  const now = nowIso();
  let planId = 0;
  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    // 同じ期間の、まだ決めていない案は作り直す（同じ案が何枚もたまらないようにする）
    const old = await t.query(
      `SELECT id FROM order_plans WHERE SCOPE() AND target_from = ? AND target_to = ? AND status = 'draft'`,
      [plan.from, plan.to],
    );
    for (const o of old) {
      await t.run(`DELETE FROM order_plan_lines WHERE SCOPE() AND plan_id = ?`, [Number(o.id)]);
      await t.run(`DELETE FROM order_plans WHERE SCOPE() AND id = ?`, [Number(o.id)]);
    }

    planId = await t.insert('order_plans', {
      business_date: todayJst(),
      target_from: plan.from,
      target_to: plan.to,
      status: 'draft',
      basis_json: JSON.stringify({ days: plan.days, covered: plan.covered, dates: plan.dates }),
      note: '',
      created_by: ctx.staffName || '',
      created_at: now,
    });
    for (const l of plan.lines) {
      await t.insert('order_plan_lines', {
        plan_id: planId,
        ingredient_id: l.ingredientId,
        name: l.name,
        unit: l.unit,
        supplier: l.supplier || '',
        need_qty: l.needQty,
        stock_qty: l.stockQty,
        suggest_qty: l.suggestQty,
        approved_qty: null,
        pack_qty: l.packQty,
        packs: l.packs,
        unit_cost: l.unitCost,
        amount: l.amount,
        urgency: l.urgency,
        reason: l.reason,
        created_at: now,
      });
    }
  });
  return { ok: true, planId };
}

export async function listOrderPlans(ctx, { limit = 20 } = {}) {
  const plans = await ctx.query(
    `SELECT * FROM order_plans WHERE SCOPE() ORDER BY id DESC LIMIT ?`,
    [Math.max(1, Math.min(60, limit))],
  );
  if (!plans.length) return [];
  const ids = plans.map((p) => Number(p.id));
  const lines = await ctx.query(
    `SELECT * FROM order_plan_lines WHERE SCOPE() AND plan_id IN (${ids.map(() => '?').join(',')})
      ORDER BY id`,
    ids,
  );
  const byPlan = new Map();
  for (const l of lines) {
    const k = Number(l.plan_id);
    if (!byPlan.has(k)) byPlan.set(k, []);
    byPlan.get(k).push(l);
  }
  return plans.map((p) => ({
    id: Number(p.id),
    businessDate: p.business_date,
    from: p.target_from,
    to: p.target_to,
    status: p.status,
    statusLabel: PLAN_STATUS_LABEL[p.status] || p.status,
    note: p.note || '',
    createdBy: p.created_by || '',
    decidedBy: p.decided_by || '',
    decidedAt: p.decided_at || '',
    createdAt: p.created_at,
    lines: byPlan.get(Number(p.id)) || [],
  }));
}

/**
 * 人が決める。ここを通らないと発注済みにならない。
 *
 * @param decision 'approved'（承認）/ 'ordered'（発注した）/ 'rejected'（見送り）
 * @param qtys     行ごとに直した数量 { 行id: 数量 }。0にすればその材料は頼まない。
 */
export async function decideOrderPlan(ctx, planId, decision, { qtys = {}, note = '' } = {}) {
  const id = Number(planId);
  if (!['approved', 'ordered', 'rejected'].includes(decision)) {
    throw new Error('決め方が正しくありません');
  }
  const plan = await ctx.first(`SELECT * FROM order_plans WHERE SCOPE() AND id = ?`, [id]);
  if (!plan) throw new Error('その案が見つかりません');
  if (plan.status === 'ordered') throw new Error('この案はすでに発注済みです');

  const now = nowIso();
  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    const lines = await t.query(`SELECT * FROM order_plan_lines WHERE SCOPE() AND plan_id = ?`, [id]);
    for (const l of lines) {
      const lid = Number(l.id);
      // 数量の決め方は3段階。
      //   1. 今回はっきり指定された数量があれば、それ
      //   2. 無ければ、前に人が決めた数量をそのまま守る（★ここが大事。
      //      「承認」のあとに「発注した」を押しただけで、直した数量が提案値に戻ってしまうと、
      //      頼んだ覚えのない量が記録に残る）
      //   3. どちらも無ければ、提案どおりの数量を人が受け入れたものとして記録する
      const given = Object.prototype.hasOwnProperty.call(qtys, String(lid));
      const prev = l.approved_qty === null || l.approved_qty === undefined ? null : num(l.approved_qty);
      const raw = given ? qtys[String(lid)] : (prev === null ? l.suggest_qty : prev);
      const q = decision === 'rejected' ? 0 : Math.max(0, num(raw));
      const amount = Math.round(q * num(l.unit_cost));
      await t.run(
        `UPDATE order_plan_lines SET approved_qty = ?, amount = ? WHERE SCOPE() AND id = ? AND plan_id = ?`,
        [q, amount, lid, id],
      );
    }
    await t.run(
      `UPDATE order_plans SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE SCOPE() AND id = ?`,
      [decision, ctx.staffName || '', now, clean(note, 200), id],
    );
  });

  return { ok: true, planId: id, status: decision };
}

/**
 * 頼んだものが届いたときに、まとめて入荷として記録する。
 *
 * ★発注した時点では在庫を増やさない。届いたときに人が押して初めて増える。
 * 頼んだ＝ある、にしてしまうと、欠品したときに「在庫はあるはず」と表示され続けて、
 * いちばん困る場面でいちばん嘘をつくことになる。
 */
export async function receiveOrderPlan(ctx, planId, { qtys = {} } = {}) {
  const id = Number(planId);
  const plan = await ctx.first(`SELECT * FROM order_plans WHERE SCOPE() AND id = ?`, [id]);
  if (!plan) throw new Error('その案が見つかりません');
  if (!['approved', 'ordered'].includes(plan.status)) {
    throw new Error('承認された案だけが入荷を記録できます');
  }

  const now = nowIso();
  let n = 0;
  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    const lines = await t.query(`SELECT * FROM order_plan_lines WHERE SCOPE() AND plan_id = ?`, [id]);
    for (const l of lines) {
      const lid = String(l.id);
      const raw = Object.prototype.hasOwnProperty.call(qtys, lid)
        ? qtys[lid]
        : (l.approved_qty === null || l.approved_qty === undefined ? l.suggest_qty : l.approved_qty);
      const q = Math.max(0, num(raw));
      if (q <= 0) continue;
      await t.insert('stock_moves', {
        business_date: todayJst(),
        ingredient_id: Number(l.ingredient_id),
        kind: 'receive',
        qty: q,
        amount: Math.round(q * num(l.unit_cost)),
        reason: `入荷（発注案 #${id}）`,
        staff_id: ctx.staffId ? Number(ctx.staffId) : null,
        staff_name: ctx.staffName || '',
        created_at: now,
      });
      n += 1;
    }
    if (plan.status !== 'ordered') {
      await t.run(`UPDATE order_plans SET status = 'ordered' WHERE SCOPE() AND id = ?`, [id]);
    }
  });
  return { ok: true, planId: id, lines: n };
}

export { UNITS };
