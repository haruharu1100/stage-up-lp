/**
 * 細かいほうの予測を、答え合わせできる形で残す。
 *
 * 1日の売上と客数は lib/forecast.js の saveForecasts が残している。
 * ここが残すのは、その内訳にあたる4つ。
 *   ・時間帯別売上   hour_sales:<時>
 *   ・必要人数       staff:<時>
 *   ・商品別販売数   item_qty:<商品ID>
 *   ・在庫需要       stock_use:<材料ID>
 *
 * 守っている決まりごと:
 *  1. 予測しか書かない。事実の表には触らない。
 *  2. 明日から先だけ。今日と過去は書き換えない（当たり外れの記録を守るため）。
 *  3. 出せないものは無理に出さない。レシピが無ければ在庫需要は書かない。
 *  4. 件数に上限をつける。商品300点の店で毎日300行ずつ増えると、
 *     答え合わせの表がすぐ読めなくなるうえ、夜間処理も重くなる。
 *
 * ★ここを lib/forecast.js の中に置かないのは、prepPlan が forecast.js を呼んでいるため。
 *   同じファイルに入れると、お互いを呼び合う形（循環参照）になって壊れやすくなる。
 */

import { nowIso, withTx } from './db.js';
import { addDays } from './learn.js';
import { hourlyPlan } from './forecast.js';
import { prepPlan } from './prep.js';

// 1日あたり、商品と材料をそれぞれ何件まで残すか
const ITEM_CAP = 20;
const ING_CAP = 20;

function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function fc(metric, value, low, high, confPct, basis) {
  return {
    metric,
    value: Math.max(0, value),
    low: low === null || low === undefined ? null : Math.max(0, low),
    high: high === null || high === undefined ? null : Math.max(0, high),
    confidence_pct: Math.max(0, Math.min(100, Math.round(confPct || 0))),
    basis_json: JSON.stringify(basis || {}),
  };
}

/** 1日ぶんの内訳予測を組み立てる（保存はしない） */
async function buildForDate(ctx, date, { hasInventory = true } = {}) {
  const out = [];

  const hp = await hourlyPlan(ctx, date);
  if (hp.ok) {
    for (const r of hp.rows) {
      out.push(fc(`hour_sales:${r.hour}`, r.sales, r.salesLow, r.salesHigh, 50, {
        label: `${r.hour}時台の売上`, basis: hp.basis, samples: r.samples,
      }));
      out.push(fc(`staff:${r.hour}`, r.staff, r.staffLow, r.staffHigh, 45, {
        label: `${r.hour}時台に必要な人手`,
        basis: `在店の見込み${r.inStore}人 ÷ 1人あたり${hp.perStaff}人（最低${hp.minStaff}人）`,
        inStore: r.inStore,
      }));
    }
  }

  const pp = await prepPlan(ctx, date, { limit: 200 });
  const lines = pp.ok ? pp.lines.filter((l) => l.itemId) : [];
  for (const l of [...lines].sort((a, b) => b.qty - a.qty).slice(0, ITEM_CAP)) {
    out.push(fc(`item_qty:${l.itemId}`, l.qty, l.low, l.high, l.confidencePct, {
      label: `${l.name}の出数`, basis: l.basisLabel, samples: l.samples,
    }));
  }

  // 在庫需要＝その日の仕込み見込み × レシピ。レシピが無い店では何も出さない。
  if (hasInventory && lines.length) {
    const recipes = await ctx.query(
      `SELECT item_id, ingredient_id, qty FROM recipe_lines WHERE SCOPE()`, [],
    );
    if (recipes.length) {
      const byItem = new Map();
      for (const r of recipes) {
        const k = Number(r.item_id);
        if (!byItem.has(k)) byItem.set(k, []);
        byItem.get(k).push({ id: Number(r.ingredient_id), qty: Number(r.qty) || 0 });
      }
      const need = new Map();
      for (const l of lines) {
        const rec = byItem.get(Number(l.itemId));
        if (!rec) continue;
        for (const r of rec) {
          const cur = need.get(r.id) || { v: 0, lo: 0, hi: 0 };
          cur.v += r.qty * l.qty;
          cur.lo += r.qty * (l.low ?? l.qty);
          cur.hi += r.qty * (l.high ?? l.qty);
          need.set(r.id, cur);
        }
      }
      const sorted = [...need.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, ING_CAP);
      for (const [id, n] of sorted) {
        if (n.v <= 0) continue;
        out.push(fc(`stock_use:${id}`, Math.round(n.v * 100) / 100,
          Math.round(n.lo * 100) / 100, Math.round(n.hi * 100) / 100, 40, {
            label: '材料の使用見込み', basis: 'その日の仕込み見込み × レシピ',
          }));
      }
    }
  }

  return out;
}

/**
 * 明日から先の内訳予測を作って残す。
 *
 * days を小さくしてあるのは、1日ぶん作るのに時間帯・商品・材料の計算が要るため。
 * 発注も仕込みも3日先までしか見ないので、それ以上先を作っても使い道がない。
 */
export async function saveDetailForecasts(ctx, { days = 3, hasInventory = true } = {}) {
  const from = addDays(todayJst(), 1);
  const span = Math.max(1, Math.min(7, Math.round(Number(days) || 3)));
  const ts = nowIso();
  let saved = 0;
  const skipped = [];

  for (let i = 0; i < span; i += 1) {
    const d = addDays(from, i);
    let rows = [];
    try {
      rows = await buildForDate(ctx, d, { hasInventory });
    } catch (e) {
      // 1日ぶんが作れなくても、ほかの日と夜間処理そのものは止めない
      skipped.push({ date: d, reason: String(e?.message || e).slice(0, 120) });
      continue;
    }
    if (!rows.length) { skipped.push({ date: d, reason: 'まだ記録が足りません' }); continue; }

    await withTx(async (tx) => {
      const c = ctx.bind(tx);
      // 内訳ぶんだけ入れ直す。1日の売上・客数（metric に : が無い）は消さない。
      await c.run(
        `DELETE FROM forecasts WHERE SCOPE() AND target_date = ? AND metric LIKE '%:%'`, [d],
      );
      for (const r of rows) {
        await c.insert('forecasts', {
          target_date: d,
          metric: r.metric,
          value: r.value,
          low: r.low,
          high: r.high,
          confidence: r.confidence_pct >= 70 ? '高め' : r.confidence_pct >= 45 ? 'ふつう' : '低め',
          confidence_pct: r.confidence_pct,
          basis_json: r.basis_json,
          engine: 'rule',
          created_at: ts,
        });
      }
    });
    saved += rows.length;
  }

  return { ok: true, saved, from, days: span, skipped };
}
