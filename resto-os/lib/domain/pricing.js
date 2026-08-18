/**
 * 金額計算はこのファイルだけが持つ。
 * お客様画面の合計・POSのプレビュー・会計確定・レシートが全部ここを通るので、
 * 「画面の金額とレシートが違う」が構造的に起きない。
 * 設計書: docs/03_DB設計.md 4-6
 */

export function safeJson(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * 明細1行の単価をサーバー側で組み立てる。
 * クライアントから送られてきた価格は一切使わない。存在しないオプションは無視する。
 */
export function buildLine(item, selections = []) {
  const groups = safeJson(item.options_json);
  let extra = 0;
  const labels = [];
  for (const sel of Array.isArray(selections) ? selections : []) {
    const g = groups.find((x) => x.name === sel.group);
    const c = g?.choices?.find((x) => x.label === sel.label);
    if (!c) continue;
    const p = Number(c.price) || 0;
    extra += p;
    labels.push(p ? `${c.label}(${p > 0 ? '+' : ''}${p}円)` : c.label);
  }
  return {
    unitPrice: Math.max(0, Math.round(Number(item.price) + extra)),
    optionLabel: labels.join(' / '),
  };
}

export function clampQty(qty) {
  return Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
}

export function sumItems(items) {
  return items.reduce((s, i) => s + Number(i.unit_price) * Number(i.qty), 0);
}

export function sumCost(items) {
  return items.reduce((s, i) => s + Number(i.cost || 0) * Number(i.qty), 0);
}

export function couponDiscount(coupon, subtotal) {
  if (!coupon) return 0;
  if (subtotal < Number(coupon.min_amount || 0)) return 0;
  const v = Number(coupon.value);
  const d = coupon.kind === 'percent' ? Math.floor((subtotal * v) / 100) : v;
  return Math.max(0, Math.min(d, subtotal));
}

// ===== 消費税 =====
// この店の値段はすべて税込。レシートには「どの税率がいくら分か」を必ず出す（インボイス対応）。
export const TAX_STANDARD = 10; // 標準税率
export const TAX_REDUCED = 8; // 軽減税率（持ち帰りなど）

/** 税込金額の中に含まれている消費税額 */
export function taxIncluded(amount, rate) {
  const a = Math.max(0, Math.round(Number(amount) || 0));
  const r = Number(rate) || TAX_STANDARD;
  return Math.floor((a * r) / (100 + r));
}

/** 商品ごとの税率。0 や未設定は、その店の標準税率として扱う */
export function lineTaxRate(item, standard = TAX_STANDARD) {
  const r = Number(item?.tax_rate) || 0;
  return r === TAX_REDUCED ? TAX_REDUCED : Number(standard) || TAX_STANDARD;
}

/**
 * 税率ごとの「対象金額」と「うち消費税」を出す。
 * 割引は、税率ごとの金額の割合どおりに割り振る（片方だけ安くならないように）。
 * 端数は金額の大きい側で吸収し、合計が必ず1円もずれないようにする。
 */
export function taxBreakdown({ items = [], discount = 0, extras = [], standard = TAX_STANDARD }) {
  const bucket = new Map();
  const add = (rate, amount) => bucket.set(rate, (bucket.get(rate) || 0) + amount);
  for (const i of items) add(lineTaxRate(i, standard), Number(i.unit_price) * Number(i.qty));
  for (const e of extras) add(Number(e.rate) || standard, Math.max(0, Number(e.amount) || 0));

  const gross = [...bucket.values()].reduce((s, v) => s + v, 0);
  const cut = Math.max(0, Math.min(Number(discount) || 0, gross));
  const rates = [...bucket.keys()].sort((a, b) => bucket.get(b) - bucket.get(a));

  const rows = [];
  let used = 0;
  rates.forEach((rate, idx) => {
    const raw = bucket.get(rate);
    // 最後の1つで端数を吸収する
    const share = idx === rates.length - 1 ? cut - used : Math.floor((cut * raw) / (gross || 1));
    used += share;
    const base = Math.max(0, raw - share);
    if (base <= 0 && raw <= 0) return;
    rows.push({ rate, base, tax: taxIncluded(base, rate) });
  });
  return {
    rows,
    taxAmount: rows.reduce((s, r) => s + r.tax, 0),
  };
}

/**
 * 会計1件分の金額をまとめて出す（プレビューも確定もレシートも同じ結果になる）。
 * store を渡すと、お通し以外の「席料・サービス料」も自動で足す。
 */
export function buildTotals({ items, coupon, guests, store = {} }) {
  const subtotal = sumItems(items);
  const discount = couponDiscount(coupon, subtotal);
  const g = Math.max(0, Number(guests) || 0);

  // 席料（チャージ）はお一人あたり。人数が0なら取らない。
  const seatCharge = Math.max(0, Number(store.seat_charge) || 0) * g;
  const afterDiscount = Math.max(0, subtotal - discount) + seatCharge;
  // サービス料は「割引後の金額＋席料」に対してかける
  const rate = Math.max(0, Math.min(100, Number(store.service_rate) || 0));
  const serviceCharge = rate > 0 ? Math.floor((afterDiscount * rate) / 100) : 0;
  const total = afterDiscount + serviceCharge;

  const standard = Number(store.tax_rate) || TAX_STANDARD;
  const extras = [];
  if (seatCharge > 0) extras.push({ rate: standard, amount: seatCharge });
  if (serviceCharge > 0) extras.push({ rate: standard, amount: serviceCharge });
  const tax = taxBreakdown({ items, discount, extras, standard });

  return {
    subtotal,
    discount,
    seatCharge,
    serviceRate: rate,
    serviceCharge,
    total,
    taxAmount: tax.taxAmount,
    taxRows: tax.rows,
    costTotal: sumCost(items),
    perPerson: g > 0 ? Math.ceil(total / g) : null,
  };
}
