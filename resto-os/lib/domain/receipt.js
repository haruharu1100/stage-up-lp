/**
 * レシート・厨房伝票の「紙に印字する文字」を組み立てる。
 *
 * ここは計算も通信もしない純粋な文字組みだけ。
 * 金額はすべて呼び出し側（会計処理）が確定させた値をそのまま受け取る。
 * 紙とブラウザ印刷の両方で同じ関数を使い、「画面と紙で金額が違う」を起こさない。
 *
 * 桁数：感熱紙80mm＝半角48桁（日本の飲食店の標準）／58mm＝半角35桁。
 * 日本語（全角）は半角2文字ぶんの幅で数える。
 */

export const WIDTHS = { 80: 48, 58: 35 };

export function columns(width) {
  return WIDTHS[Number(width)] || WIDTHS[80];
}

/** 全角を2、半角を1として数える。ここを間違えると行末がガタつく */
export function textWidth(s) {
  let w = 0;
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    // 半角英数記号・半角カナはそのまま1、それ以外（漢字かな全角記号・絵文字）は2
    const half =
      (c >= 0x20 && c <= 0x7e) || (c >= 0xff61 && c <= 0xff9f) || c === 0xa5 || c === 0x203e;
    w += half ? 1 : 2;
  }
  return w;
}

/** 幅に収まるところで切る（行が折り返して伝票が崩れるのを防ぐ） */
export function cut(s, max) {
  let out = '';
  let w = 0;
  for (const ch of String(s ?? '')) {
    const cw = textWidth(ch);
    if (w + cw > max) break;
    out += ch;
    w += cw;
  }
  return out;
}

/** 左に品名、右に金額。間は空白で埋める */
export function pad(left, right, cols) {
  const r = String(right ?? '');
  const rw = textWidth(r);
  const l = cut(left, Math.max(0, cols - rw - 1));
  const gap = Math.max(1, cols - textWidth(l) - rw);
  return l + ' '.repeat(gap) + r;
}

export function center(s, cols) {
  const t = cut(s, cols);
  const left = Math.max(0, Math.floor((cols - textWidth(t)) / 2));
  return ' '.repeat(left) + t;
}

export function rule(cols, ch = '-') {
  return ch.repeat(cols);
}

const yen = (n) => `${Number(n || 0).toLocaleString('ja-JP')}円`;

/** 2026-08-18T12:34:56Z → 2026/08/18 21:34（日本時間） */
export function jpTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const f = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

const PAYMENT_JP = {
  cash: '現金', credit: 'クレジットカード', qr: 'QR決済', emoney: '電子マネー', other: 'その他',
};

/**
 * お客様にお渡しするレシート（適格簡易請求書）。
 *
 * インボイス制度で必要なのは
 *   ①発行者の名前 ②登録番号 ③取引年月日 ④取引内容 ⑤税率ごとに分けた税込金額 ⑥税率
 * の6点。⑤⑥を出せないレシートは、お客様が経費で落とせない。
 * 軽減税率の品には ※ を付け、下の内訳と対応させる。
 */
export function buildReceipt(check, { width = 80 } = {}) {
  const cols = columns(width);
  const L = [];
  const store = check.store || {};
  const rows = Array.isArray(check.taxRows) ? check.taxRows : [];
  const hasReduced = rows.some((r) => Number(r.rate) === 8);

  L.push(center(store.name || '', cols));
  if (store.tel) L.push(center(`TEL ${store.tel}`, cols));
  if (store.address) L.push(center(cut(store.address, cols), cols));
  L.push('');
  if (check.invoiceNo) L.push(`登録番号 ${check.invoiceNo}`);
  L.push(jpTime(check.createdAt));
  L.push(pad(`${check.tableName ? `${check.tableName}番卓` : ''}${check.guests ? ` ${check.guests}名様` : ''}`, `No.${String(check.receiptNo || '').slice(-8)}`, cols));
  if (check.partial) L.push('※ 分割してお会計いただいた分です');
  L.push(rule(cols));

  for (const i of check.items || []) {
    const qty = Number(i.qty) || 1;
    const amount = (Number(i.unit_price) || 0) * qty;
    const mark = Number(i.tax_rate) === 8 ? '※' : '';
    L.push(pad(`${mark}${i.name}${qty > 1 ? ` x${qty}` : ''}`, yen(amount), cols));
    if (i.options) L.push(`  ${cut(i.options, cols - 2)}`);
  }

  L.push(rule(cols));
  L.push(pad('小計', yen(check.subtotal), cols));
  if (check.discount > 0) L.push(pad(`割引${check.couponCode ? `（${check.couponCode}）` : ''}`, `-${yen(check.discount)}`, cols));
  if (check.seatCharge > 0) L.push(pad('席料', yen(check.seatCharge), cols));
  if (check.serviceCharge > 0) L.push(pad(`サービス料 ${check.serviceRate}%`, yen(check.serviceCharge), cols));
  L.push(pad('合計（税込）', yen(check.total), cols));
  L.push('');

  for (const r of rows) {
    L.push(pad(`（${r.rate}%対象）`, yen(r.base), cols));
    L.push(pad('　うち消費税', yen(r.tax), cols));
  }
  if (hasReduced) L.push('※ は軽減税率（8%）対象');
  L.push('');
  L.push(pad('お支払い方法', PAYMENT_JP[check.payment] || 'その他', cols));
  if (Number(check.received) > 0) {
    L.push(pad('お預り', yen(check.received), cols));
    L.push(pad('お釣り', yen(Math.max(0, Number(check.received) - Number(check.total))), cols));
  }
  if (check.guests > 1) L.push(pad('お一人あたり', yen(Math.ceil(check.total / check.guests)), cols));

  if (store.receiptNote) {
    L.push('');
    for (const line of String(store.receiptNote).split('\n').slice(0, 4)) L.push(center(cut(line, cols), cols));
  }
  L.push('');
  L.push(center('ありがとうございました', cols));
  return L.join('\n');
}

const STATION_JP = {
  kitchen: '厨房', drink: 'ドリンク場', grill: '焼き場', sashimi: '刺場', dessert: 'デザート',
};

/**
 * 厨房に流す注文伝票。
 * 作る人が離れた場所から一目で分かることだけを大きく出す。
 * 金額は入れない（作る手が止まるだけで、厨房には要らない情報）。
 */
export function buildKitchenTicket(ticket, { width = 80 } = {}) {
  const cols = columns(width);
  const L = [];
  L.push(center(`【${STATION_JP[ticket.station] || ticket.station || '厨房'}】`, cols));
  L.push(rule(cols, '='));
  L.push(pad(`${ticket.tableName || ''}番卓`, jpTime(ticket.createdAt), cols));
  L.push(pad(ticket.source === 'staff' ? '（ハンディ）' : '（お客様QR）', `No.${String(ticket.orderId || '').slice(-6)}`, cols));
  L.push(rule(cols));
  for (const i of ticket.items || []) {
    L.push(pad(cut(i.name, cols - 6), `x ${Number(i.qty) || 1}`, cols));
    if (i.options) L.push(`  ${cut(i.options, cols - 2)}`);
    // 備考は作り方が変わる情報なので、見落とさないよう記号で囲って必ず出す
    if (i.note) L.push(`  >> ${cut(i.note, cols - 5)}`);
  }
  L.push(rule(cols, '='));
  return L.join('\n');
}

/** つながっているか確かめるための1枚 */
export function buildTestTicket(name, { width = 80 } = {}) {
  const cols = columns(width);
  return [
    center('テスト印刷', cols),
    rule(cols),
    pad('プリンター', cut(name || '', 20), cols),
    pad('用紙幅', `${width}mm（${cols}桁）`, cols),
    pad('時刻', jpTime(), cols),
    rule(cols),
    'あいうえお　漢字テスト　カタカナ',
    'ABCDEfghij 0123456789 ¥',
    '',
    center('この紙が出れば準備完了です', cols),
  ].join('\n');
}
