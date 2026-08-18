/**
 * 仕込み量の提案。
 *
 * ねらい: **廃棄と欠品を減らすこと。**
 * この2つは、レシートにも日報にも出てこないまま、いちばん静かにお金が消えていくところ。
 * 「なんとなく多め」「なんとなく去年と同じ」で決めていた仕込みを、
 * 明日の見込み客数という数字に結びつけて出す。
 *
 * いちばん大事な考え方:
 *   **登録作業をゼロから始められること。**
 *   材料もレシピも1件も登録していない店で、今日から使えないと意味がない。
 *   だからこのファイルは menu_items と daily_item_facts（すでに毎日たまっている記録）だけで動く。
 *   材料とレシピは「発注の提案」（lib/inventory.js）を使いたくなってから登録すればよい。
 *
 * 守っている決まりごと:
 *  1. 提案は必ず幅で出す。「30個」ではなく「26〜34個（目安30個）」。
 *     ひとつの数字で言い切ると、外れたときに全部の責任がシステム側に行き、二度と使われなくなる。
 *  2. 根拠に使った日を必ず返す。何日ぶんの記録から出したのかを隠さない。
 *  3. 記録が薄い商品は「まだ出せません」と正直に言う。それらしい数字を作らない。
 *  4. 原因は言わない。「雨だから少なめ」ではなく「見込み客数が少なめのため」と書く。
 *  5. これは第2層（推測）。実績（第1層）とは画面でも色を変えて区別する。
 *  6. AIに数字を書かせない。ここの計算はすべてこのファイルが記録から出す。
 */

import { addDays, dayDiff } from './learn.js';
import { nowIso, withTx } from './db.js';
import { predictDay } from './forecast.js';

// 同じ曜日を何回ぶんまでさかのぼって見るか。
// 多くすると安定するが、古すぎる時期（味・価格・客層が違う）を混ぜてしまう。
const SAME_DOW_LOOKBACK = 10;
// 曜日をそろえずに見るときの日数
const RECENT_DAYS = 28;
// これ未満の回数しか記録が無い商品は、提案を出さない
const MIN_SAMPLES = 3;

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function dowOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function median(arr) {
  const a = arr.filter((v) => Number.isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

function quantile(arr, q) {
  const a = arr.filter((v) => Number.isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const p = (a.length - 1) * q;
  const lo = Math.floor(p), hi = Math.ceil(p);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (p - lo);
}

/** 個数は切り上げ。足りないより余るほうが、その日の営業は回る（余りは翌日の提案に効く） */
function upQty(v) {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.ceil(v);
}

// ===== 記録を読む =====

/**
 * 商品ごとの「客1人あたり何個出たか」を出すための材料をそろえる。
 *
 * 客数で割るのが肝心。
 * 「先週の水曜は40個出た」だけだと、その日たまたま客が多かったのか少なかったのかが分からない。
 * 客1人あたりに直しておくと、明日の見込み客数を掛けるだけで済む。
 */
async function loadItemHistory(ctx, from, to) {
  const facts = await ctx.query(
    `SELECT business_date AS date, guests, sales
       FROM daily_facts
      WHERE SCOPE() AND business_date BETWEEN ? AND ? AND guests > 0 AND sales > 0
      ORDER BY business_date`,
    [from, to],
  );
  if (!facts.length) return { days: [], items: new Map() };

  const rows = await ctx.query(
    `SELECT business_date AS date, item_id, name, category_name, station, qty, sales
       FROM daily_item_facts
      WHERE SCOPE() AND business_date BETWEEN ? AND ?`,
    [from, to],
  );

  const guestsBy = new Map(facts.map((f) => [f.date, Number(f.guests) || 0]));
  const items = new Map();
  for (const r of rows) {
    const g = guestsBy.get(r.date);
    if (!g) continue; // 客数の記録が無い日は使わない（1人あたりに直せないため）
    const key = String(r.name);
    if (!items.has(key)) {
      items.set(key, {
        name: key,
        itemId: r.item_id ? Number(r.item_id) : null,
        category: r.category_name || '',
        station: r.station || '',
        rows: [],
      });
    }
    const qty = Number(r.qty) || 0;
    items.get(key).rows.push({ date: r.date, qty, guests: g, per: qty / g });
  }
  return { days: facts.map((f) => f.date), items };
}

/** メニュー表のいまの状態（値段・原価・売り切れ・出しているか） */
async function loadMenu(ctx) {
  const rows = await ctx.query(
    `SELECT id, name, price, cost, station, active, sold_out
       FROM menu_items WHERE SCOPE()`,
  );
  const byName = new Map();
  for (const r of rows) byName.set(String(r.name), r);
  return { rows, byName };
}

// ===== 1商品ぶんの提案を作る =====

/**
 * ある商品について、明日ぶんの仕込み量を出す。
 *
 * 手順は単純:
 *   1. 同じ曜日の直近の記録から「客1人あたりの出数」を出す（曜日で出方が変わる商品が多いため）
 *   2. 同じ曜日の記録が足りなければ、直近の全曜日で代用する（そのことは根拠に書く）
 *   3. 明日の見込み客数を掛ける
 *   4. 幅は「1人あたりのばらつき」と「見込み客数の幅」の両方から出す
 */
function suggestOne(entry, targetDow, guests, guestsLow, guestsHigh) {
  const all = entry.rows;
  const sameDow = all.filter((r) => dowOf(r.date) === targetDow);

  let used, basisLabel, dowMatched;
  if (sameDow.length >= MIN_SAMPLES) {
    used = sameDow.slice(-SAME_DOW_LOOKBACK);
    basisLabel = `${DOW[targetDow]}曜の直近${used.length}回`;
    dowMatched = true;
  } else if (all.length >= MIN_SAMPLES) {
    used = all.slice(-RECENT_DAYS);
    basisLabel = `直近${used.length}日（${DOW[targetDow]}曜の記録がまだ${sameDow.length}回のため、曜日をそろえずに見ています）`;
    dowMatched = false;
  } else {
    return {
      name: entry.name,
      itemId: entry.itemId,
      ok: false,
      reason: 'NOT_ENOUGH',
      samples: all.length,
      message: `記録が${all.length}日ぶんしかないため、まだ提案を出しません。`,
    };
  }

  const pers = used.map((r) => r.per);
  const per = median(pers);
  if (!per) {
    return {
      name: entry.name,
      itemId: entry.itemId,
      ok: false,
      reason: 'NO_SALES',
      samples: used.length,
      message: 'この期間はほとんど出ていないため、提案を出しません。',
    };
  }

  // 1人あたりのばらつき。四分位で見る（1日だけの大量注文に引っぱられないため）
  const p25 = quantile(pers, 0.25);
  const p75 = quantile(pers, 0.75);

  const value = per * guests;
  // 下限＝ばらつきの下側 × 見込み客数の下限、上限＝その逆。両方の不確かさを重ねる。
  const low = Math.max(0, p25 * (guestsLow || guests));
  const high = p75 * (guestsHigh || guests);

  // 記録の充実度。回数と、日ごとのそろい具合の2つで見る。
  const spread = per ? (p75 - p25) / per : 1;
  const sampleScore = Math.min(1, used.length / 8);
  const steadyScore = Math.max(0, Math.min(1, 1 - spread / 0.8));
  let conf = Math.round(100 * (0.55 * sampleScore + 0.45 * steadyScore));
  if (!dowMatched) conf = Math.min(conf, 45);
  if (used.length < 5) conf = Math.min(conf, 40);
  conf = Math.max(10, Math.min(80, conf));

  return {
    name: entry.name,
    itemId: entry.itemId,
    category: entry.category,
    station: entry.station,
    ok: true,
    qty: upQty(value),
    low: upQty(low),
    high: upQty(high),
    perGuest: Math.round(per * 1000) / 1000,
    samples: used.length,
    dowMatched,
    confidencePct: conf,
    basisLabel,
    dates: used.slice(-8).map((r) => ({ date: r.date, qty: r.qty, guests: r.guests })),
  };
}

// ===== 仕込みの提案（画面・レポートが呼ぶ入口） =====

/**
 * 指定した日の仕込み提案を作る。
 *
 * @param {string} date  何日ぶんか（省略すると明日）
 * @param {object} opts  limit＝出す商品数、seeCost＝原価を含めてよいか
 *
 * 返すもの:
 *   ok:false のときは「なぜ出せないか」を必ず日本語で入れる。空の画面を出さない。
 */
export async function prepPlan(ctx, date = null, { limit = 30, seeCost = false } = {}) {
  const today = todayJst();
  const target = date || addDays(today, 1);
  const targetDow = dowOf(target);

  // 明日の見込み客数。これが無ければ仕込みの提案そのものが成り立たない。
  const f = await predictDay(ctx, target);
  if (!f.ok) {
    return {
      ok: false,
      reason: f.reason,
      date: target,
      message: f.message || 'まだ記録が足りないため、仕込みの提案は出せません。',
      haveDays: f.haveDays || 0,
      needDays: f.needDays || 0,
    };
  }
  const g = f.metrics.guests;
  const guests = Math.max(1, Math.round(g.value));
  const guestsLow = Math.max(1, Math.round(g.low));
  const guestsHigh = Math.max(guests, Math.round(g.high));

  const from = addDays(target, -120);
  const to = addDays(target, -1);
  const [{ items }, menu] = await Promise.all([loadItemHistory(ctx, from, to), loadMenu(ctx)]);

  if (!items.size) {
    return {
      ok: false,
      reason: 'NO_ITEMS',
      date: target,
      message: '商品ごとの出数の記録がまだありません。このシステムで注文を受けた日が増えると、自動で出せるようになります。',
    };
  }

  const lines = [];
  const skipped = [];
  for (const entry of items.values()) {
    const m = menu.byName.get(entry.name);
    // いまメニューから外している商品は仕込まない
    if (m && Number(m.active) === 0) continue;
    const s = suggestOne(entry, targetDow, guests, guestsLow, guestsHigh);
    if (!s.ok) {
      skipped.push({ name: s.name, message: s.message, samples: s.samples });
      continue;
    }
    if (m) {
      s.price = Number(m.price) || 0;
      s.soldOut = Number(m.sold_out) === 1;
      if (seeCost) s.cost = Number(m.cost) || 0;
      if (!s.station) s.station = m.station || '';
    }
    lines.push(s);
  }

  // 出る数が多い順。厨房は上から順に手をつけるので、ここの並びがそのまま作業順になる。
  lines.sort((a, b) => b.qty - a.qty);
  const shown = lines.slice(0, limit);

  // 「多めに用意したほうがよい日か、絞ったほうがよい日か」を一言で添える。
  const spreadPct = guests ? Math.round(((guestsHigh - guestsLow) / guests) * 100) : 0;
  const advice = spreadPct >= 45
    ? '見込みの幅が広い日です。日もちする物は上限寄り、当日中に使い切る物は目安どおりが無難です。'
    : '見込みの幅は落ち着いています。目安どおりで問題なさそうです。';

  return {
    ok: true,
    date: target,
    dow: DOW[targetDow],
    guests: { value: guests, low: guestsLow, high: guestsHigh, confidencePct: g.confidencePct, confidence: g.confidence },
    context: f.context || null,
    lines: shown,
    skipped: skipped.slice(0, 20),
    totalItems: lines.length,
    advice,
    seeCost,
    note: 'ここに出る数はすべて見込み（第2層）です。実績ではありません。最後は必ず人が決めてください。',
  };
}

// ===== 欠品（品切れ）に気づく =====

/**
 * その日、いつもより極端に出数が少なかった商品を拾う。
 *
 * これは「売り切れて売り逃したのでは？」という気づきであって、事実ではない。
 * 単に人気が落ちただけかもしれないし、その日だけ品書きから外していたのかもしれない。
 * だから est_loss は必ず「見込み額（推測）」として扱い、売上の数字とは混ぜない。
 *
 * 拾う条件はきつめにする。毎日ずらずら出ると誰も読まなくなるため。
 *   ・ふだんの同じ曜日の記録が4回以上ある
 *   ・その日の出数が、ふだんの55%未満
 *   ・売り逃した見込みが2個以上かつ1,000円以上
 */
export async function detectStockouts(ctx, date) {
  const target = date || todayJst();
  const from = addDays(target, -119);
  const to = addDays(target, -1);
  const targetDow = dowOf(target);

  const [{ items }, menu] = await Promise.all([loadItemHistory(ctx, from, to), loadMenu(ctx)]);
  if (!items.size) return { ok: true, date: target, rows: [], saved: 0 };

  const todayFact = await ctx.first(
    `SELECT guests FROM daily_facts WHERE SCOPE() AND business_date = ?`,
    [target],
  );
  const guests = Number(todayFact?.guests) || 0;
  if (!guests) return { ok: true, date: target, rows: [], saved: 0, message: 'この日の客数の記録がまだありません。' };

  const todayRows = await ctx.query(
    `SELECT item_id, name, qty FROM daily_item_facts WHERE SCOPE() AND business_date = ?`,
    [target],
  );
  const actualBy = new Map(todayRows.map((r) => [String(r.name), Number(r.qty) || 0]));

  const found = [];
  for (const entry of items.values()) {
    const sameDow = entry.rows.filter((r) => dowOf(r.date) === targetDow).slice(-SAME_DOW_LOOKBACK);
    if (sameDow.length < 4) continue;

    const m = menu.byName.get(entry.name);
    if (m && Number(m.active) === 0) continue;

    const perUsual = median(sameDow.map((r) => r.per));
    const usual = perUsual * guests;      // ふだんなら、この客数で出たはずの数
    const actual = actualBy.get(entry.name) || 0;
    if (usual < 3) continue;              // もともと少ししか出ない商品は拾わない
    if (actual >= usual * 0.55) continue; // ふだんと大きく変わらないなら拾わない

    const miss = usual - actual;
    const price = Number(m?.price) || 0;
    const loss = Math.round(miss * price);
    if (miss < 2 || loss < 1000) continue;

    found.push({
      itemId: entry.itemId,
      name: entry.name,
      usualQty: Math.round(usual * 10) / 10,
      actualQty: actual,
      missQty: Math.round(miss * 10) / 10,
      price,
      estLoss: loss,
      sampleDays: sameDow.length,
    });
  }

  found.sort((a, b) => b.estLoss - a.estLoss);
  const rows = found.slice(0, 10);

  if (rows.length) {
    await withTx(async (tx) => {
      const t = ctx.bind(tx);
      const now = nowIso();
      // 同じ日ぶんは一度消してから入れ直す。何度動かしても増えない。
      await t.run(`DELETE FROM stockouts WHERE SCOPE() AND business_date = ? AND detected = 'auto'`, [target]);
      for (const r of rows) {
        await t.insert('stockouts', {
          business_date: target,
          item_id: r.itemId === null || r.itemId === undefined ? null : Number(r.itemId),
          name: r.name,
          usual_qty: r.usualQty,
          actual_qty: r.actualQty,
          miss_qty: r.missQty,
          price: r.price,
          est_loss: r.estLoss,
          sample_days: r.sampleDays,
          detected: 'auto',
          created_at: now,
        });
      }
    });
  }

  return { ok: true, date: target, rows, saved: rows.length };
}

/** 直近の欠品の気づきを読み出す（画面・レポート用） */
export async function listStockouts(ctx, { days = 30, limit = 40 } = {}) {
  const to = todayJst();
  const from = addDays(to, -Math.max(1, Math.min(365, days)));
  const rows = await ctx.query(
    `SELECT business_date AS date, name, usual_qty, actual_qty, miss_qty, price, est_loss, sample_days
       FROM stockouts WHERE SCOPE() AND business_date BETWEEN ? AND ?
      ORDER BY business_date DESC, est_loss DESC LIMIT ?`,
    [from, to, Math.max(1, Math.min(200, limit))],
  );
  const total = rows.reduce((s, r) => s + (Number(r.est_loss) || 0), 0);
  return {
    rows,
    total,
    from,
    to,
    note: 'ここの金額は「ふだんの同じ曜日と比べて少なかったぶん」から出した見込みです。実際に売り逃した額そのものではありません。',
  };
}

// ===== 廃棄の振り返り =====

/**
 * 廃棄として記録された量と金額をまとめる。
 * 入力があった日だけを見る（未入力の日を0として混ぜると、実態より小さく見えてしまう）。
 */
export async function wasteSummary(ctx, { days = 30 } = {}) {
  const to = todayJst();
  const from = addDays(to, -Math.max(1, Math.min(365, days)));
  const rows = await ctx.query(
    `SELECT m.business_date AS date, i.name AS name, i.unit AS unit,
            SUM(-m.qty) AS qty, SUM(m.amount) AS amount
       FROM stock_moves m JOIN ingredients i ON i.id = m.ingredient_id
      WHERE SCOPE(m) AND m.kind = 'waste' AND m.business_date BETWEEN ? AND ?
      GROUP BY m.business_date, i.name, i.unit
      ORDER BY m.business_date DESC`,
    [from, to],
  );
  const byItem = new Map();
  for (const r of rows) {
    const k = r.name;
    if (!byItem.has(k)) byItem.set(k, { name: k, unit: r.unit, qty: 0, amount: 0, days: 0 });
    const b = byItem.get(k);
    b.qty += Number(r.qty) || 0;
    b.amount += Number(r.amount) || 0;
    b.days += 1;
  }
  const items = [...byItem.values()].sort((a, b) => b.amount - a.amount);
  const total = items.reduce((s, r) => s + r.amount, 0);
  const recordedDays = new Set(rows.map((r) => r.date)).size;
  return { items, total, recordedDays, from, to };
}

export { DOW };
