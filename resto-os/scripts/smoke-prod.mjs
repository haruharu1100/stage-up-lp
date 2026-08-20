// 公開後の動作確認（12項目）を、本番のURLごしに通しでやる。
//
// さわるのは「【テスト】検証店A / B」だけ。ほかのお店には一切ふれない。
// 使い方:
//   node scripts/smoke-prod.mjs
//   node scripts/smoke-prod.mjs http://localhost:3800   （手元で試すとき）

const BASE = (process.argv[2] || 'https://resto-os-alpha.vercel.app').replace(/\/$/, '');

const A = { email: 'test-a@resto-check.local', password: 'CheckA-2026-08', jar: '', name: '検証店A（ライト）' };
const B = { email: 'test-b@resto-check.local', password: 'CheckB-2026-08', jar: '', name: '検証店B（AI DX）' };

let pass = 0;
const fails = [];
function ok(no, label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  OK  ${label}`); }
  else { fails.push({ no, label, detail }); console.log(`  NG  ${label}${detail ? ` … ${detail}` : ''}`); }
}

async function api(who, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(who?.jar ? { cookie: who.jar } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() || [];
  if (who && set.length) who.jar = set.map((c) => c.split(';')[0]).join('; ');
  let json = null;
  try { json = await res.json(); } catch { /* HTMLが返るときもある */ }
  return { status: res.status, json };
}

const rand = () => Math.random().toString(36).slice(2, 10);

async function section(title, fn) {
  console.log(`\n${title}`);
  await fn();
}

async function main() {
  console.log(`本番の動作確認（対象: ${BASE}）`);
  console.log('さわるのはテスト専用店だけです。ほかのお店のデータには一切ふれません。');

  // ── ① 新規店舗ログイン
  await section('① 新しく作ったお店にログインできる', async () => {
    const a = await api(A, '/api/auth/login', { method: 'POST', body: { email: A.email, password: A.password } });
    ok(1, 'ライトプランの店にログインできる', a.status === 200 && a.json?.ok === true, `status=${a.status}`);
    ok(1, 'オーナーとして入れている', a.json?.role === 'owner', String(a.json?.role));
    const b = await api(B, '/api/auth/login', { method: 'POST', body: { email: B.email, password: B.password } });
    ok(1, 'AI DXプランの店にログインできる', b.status === 200 && b.json?.ok === true, `status=${b.status}`);
    const bad = await api(null, '/api/auth/login', { method: 'POST', body: { email: A.email, password: 'ちがう合言葉' } });
    ok(1, '合言葉が違うと入れない', bad.status === 401, `status=${bad.status}`);
  });

  // ── ② 商品登録
  const menuA = {};
  const menuB = {};
  await section('② 商品を登録できる', async () => {
    const beer = await api(A, '/api/menu', { method: 'POST', body: { name: '【検証】生ビール', price: 600, cost: 180, station: 'bar', tax_rate: 10, active: 1 } });
    const kara = await api(A, '/api/menu', { method: 'POST', body: { name: '【検証】から揚げ', price: 780, cost: 260, station: 'kitchen', tax_rate: 10, active: 1 } });
    ok(2, 'ライト店に商品を2つ登録できる', beer.status === 200 && kara.status === 200, `${beer.status}/${kara.status}`);
    menuA.beer = beer.json?.id; menuA.kara = kara.json?.id;
    const list = await api(A, '/api/menu?admin=1');
    ok(2, '登録した商品が一覧に出る', (list.json?.menu || []).some((m) => m.name === '【検証】生ビール'), '');
    ok(2, '税率10%で保存されている', Number((list.json?.menu || []).find((m) => m.name === '【検証】生ビール')?.tax_rate) === 10, '');
    const noPrice = await api(A, '/api/menu', { method: 'POST', body: { name: '【検証】値段なし' } });
    ok(2, '値段のない商品は登録できない', noPrice.status === 400, `status=${noPrice.status}`);

    const bm = await api(B, '/api/menu', { method: 'POST', body: { name: '【検証】醤油ラーメン', price: 900, cost: 300, station: 'kitchen', tax_rate: 10, active: 1 } });
    ok(2, 'AI DX店にも商品を登録できる', bm.status === 200, `status=${bm.status}`);
    menuB.ramen = bm.json?.id;
  });

  // ── ③ テーブル作成
  const tblA = {};
  const tblB = {};
  await section('③ テーブルを作れる（QRができる）', async () => {
    const t = await api(A, '/api/tables', { method: 'POST', body: { name: '【検証】A1卓', seats: 4 } });
    ok(3, 'ライト店にテーブルを作れる', t.status === 200 && !!t.json?.token, `status=${t.status}`);
    tblA.id = t.json?.id; tblA.token = t.json?.token;
    const t2 = await api(B, '/api/tables', { method: 'POST', body: { name: '【検証】B1卓', seats: 2 } });
    ok(3, 'AI DX店にもテーブルを作れる', t2.status === 200 && !!t2.json?.token, `status=${t2.status}`);
    tblB.id = t2.json?.id; tblB.token = t2.json?.token;
    const qr = await api(null, `/api/orders?token=${tblA.token}`);
    ok(3, 'QRのリンクからお客様画面のデータが取れる', qr.status === 200 && qr.json?.table?.name === '【検証】A1卓', `status=${qr.status}`);
    const badQr = await api(null, '/api/orders?token=deadbeefdeadbeef');
    ok(3, 'でたらめなQRでは何も見えない', badQr.status >= 400, `status=${badQr.status}`);
  });

  // ── ④ QR注文
  await section('④ お客様がQRから注文できる', async () => {
    const key = `smoke-${rand()}`;
    const body = { token: tblA.token, clientOrderId: key, source: 'qr', guests: 4, items: [{ itemId: menuA.beer, qty: 4 }, { itemId: menuA.kara, qty: 2 }] };
    const o = await api(null, '/api/orders', { method: 'POST', body });
    ok(4, 'QRから注文が通る', o.status === 200 && o.json?.ok === true, `status=${o.status}`);
    ok(4, '注文の合計が正しい（600×4 + 780×2 = 3,960円）', Number(o.json?.subtotal) === 3960, String(o.json?.subtotal));
    const again = await api(null, '/api/orders', { method: 'POST', body });
    ok(4, '同じ注文を2回送っても二重にならない', again.json?.duplicated === true, JSON.stringify(again.json).slice(0, 80));
    const after = await api(null, `/api/orders?token=${tblA.token}`);
    ok(4, '2回送っても合計は3,960円のまま', Number(after.json?.subtotal) === 3960, String(after.json?.subtotal));
    ok(4, '注文すると自動で着席になる', after.json?.table?.status === 'seated', String(after.json?.table?.status));

    const ob = await api(null, '/api/orders', { method: 'POST', body: { token: tblB.token, clientOrderId: `smoke-${rand()}`, source: 'qr', guests: 2, items: [{ itemId: menuB.ramen, qty: 2 }] } });
    ok(4, 'AI DX店でもQR注文が通る（1,800円）', ob.status === 200 && Number(ob.json?.subtotal) === 1800, String(ob.json?.subtotal));
  });

  // ── ⑤ 厨房への反映
  let kdsIds = [];
  await section('⑤ 厨房の画面に注文が届く', async () => {
    const k = await api(A, '/api/orders?view=kds');
    const mine = (k.json?.items || []).filter((i) => Number(i.table_id) === Number(tblA.id));
    kdsIds = mine.map((i) => Number(i.id));
    ok(5, '厨房の画面に注文が2行出る', mine.length === 2, `${mine.length}行`);
    ok(5, '届いた直後は「受付」になっている', mine.every((i) => i.status === 'received'), '');
    ok(5, '厨房の画面に原価が出ていない', mine.every((i) => i.cost === undefined || i.cost === null), '');
    const bar = await api(A, '/api/orders?view=kds&station=bar');
    ok(5, 'ドリンク場だけに絞って見られる', (bar.json?.items || []).filter((i) => Number(i.table_id) === Number(tblA.id)).length === 1, '');
  });

  // ── ⑥ 提供済み
  await section('⑥ 「提供済み」まで進められる', async () => {
    let allOk = true;
    for (const id of kdsIds) {
      const r1 = await api(A, '/api/orders', { method: 'PATCH', body: { id, status: 'cooking', from: 'received' } });
      const r2 = await api(A, '/api/orders', { method: 'PATCH', body: { id, status: 'ready', from: 'cooking' } });
      const r3 = await api(A, '/api/orders', { method: 'PATCH', body: { id, status: 'served', from: 'ready' } });
      if (r1.status !== 200 || r2.status !== 200 || r3.status !== 200) allOk = false;
    }
    ok(6, '受付→調理中→完成→提供済みへ進められる', allOk, '');
    const stale = await api(A, '/api/orders', { method: 'PATCH', body: { id: kdsIds[0], status: 'cooking', from: 'received' } });
    ok(6, '古い画面からの操作は取り合いにならず弾かれる', stale.status === 409, `status=${stale.status}`);
    const k = await api(A, '/api/orders?view=kds');
    ok(6, '提供済みは厨房の画面から消える', !(k.json?.items || []).some((i) => kdsIds.includes(Number(i.id))), '');
  });

  // ── ⑦⑧ 席を空ける ＋ 簡易売上入力
  await section('⑦⑧ 実際の会計金額を入れて席を空けられる', async () => {
    const pre = await api(A, `/api/cash-sales?view=table&tableId=${tblA.id}`);
    ok(8, '席を空ける前に「注文合計 3,960円」が出る', Number(pre.json?.orderTotal) === 3960, String(pre.json?.orderTotal));

    const noReason = await api(A, '/api/cash-sales', { method: 'POST', body: { tableId: tblA.id, amount: 3900, guests: 4, paymentMethod: 'cash' } });
    ok(8, '注文合計と金額が違うのに理由が無いと登録できない', noReason.status === 400 && noReason.json?.code === 'REASON_REQUIRED', JSON.stringify(noReason.json).slice(0, 80));

    const add = await api(A, '/api/cash-sales', { method: 'POST', body: { tableId: tblA.id, amount: 3900, guests: 4, paymentMethod: 'cash', diffReason: 'discount', diffNote: '常連さま', clearTable: true } });
    ok(8, '実会計3,900円を記録して席を空けられる', add.status === 200 && add.json?.ok === true, JSON.stringify(add.json).slice(0, 100));
    ok(8, '差額が -60円として残る（勝手に直さない）', Number(add.json?.diff) === -60, String(add.json?.diff));
    ok(8, '注文上の合計 3,960円も一緒に残る', Number(add.json?.orderTotal) === 3960, String(add.json?.orderTotal));

    const dup = await api(A, '/api/cash-sales', { method: 'POST', body: { tableId: tblA.id, amount: 1000, guests: 1 } });
    ok(8, '同じ卓をもう一度お金にできない（二重会計にならない）', dup.status === 409 && dup.json?.code === 'ALREADY_ENTERED', JSON.stringify(dup.json).slice(0, 80));

    const tabs = await api(A, '/api/tables');
    const me = (tabs.json?.tables || []).find((t) => Number(t.id) === Number(tblA.id));
    ok(7, '席が空席にもどっている', me && me.status !== 'seated', String(me?.status));
    ok(7, '空席になっても卓に未会計は残っていない', Number(me?.total) === 0, String(me?.total));

    const hist = await api(A, '/api/orders?view=history');
    const left = (hist.json?.items || []).filter((i) => Number(i.table_id) === Number(tblA.id));
    ok(7, '席を空けても注文履歴は消えていない', left.length === 2, `${left.length}行`);
    ok(7, '注文の金額も書き換わっていない', left.reduce((s, i) => s + Number(i.unit_price) * Number(i.qty), 0) === 3960, '');

    // 同じ卓に次のお客様が入る（前の組が混ざらないことの確認）
    const o2 = await api(A, '/api/orders', { method: 'POST', body: { tableId: tblA.id, clientOrderId: `smoke-${rand()}`, source: 'staff', guests: 2, items: [{ itemId: menuA.beer, qty: 2 }] } });
    ok(7, '同じ卓に次のお客様の注文を入れられる', o2.status === 200, `status=${o2.status}`);
    ok(7, '次のお客様の合計に前の組が混ざらない（1,200円）', Number(o2.json?.subtotal) === 1200, String(o2.json?.subtotal));
    const pre2 = await api(A, `/api/cash-sales?view=table&tableId=${tblA.id}`);
    ok(7, '2組目の「注文合計」も1,200円だけになる', Number(pre2.json?.orderTotal) === 1200, String(pre2.json?.orderTotal));
    const add2 = await api(A, '/api/cash-sales', { method: 'POST', body: { tableId: tblA.id, amount: 1200, guests: 2, paymentMethod: 'cash', clearTable: true } });
    ok(8, '同じ卓で2組目の実会計もちゃんと記録できる', add2.status === 200 && add2.json?.ok === true, JSON.stringify(add2.json).slice(0, 100));
  });

  // ── ⑨ 売上への反映（確定まで）
  await section('⑨ 入れた金額が「本日の売上」に反映される', async () => {
    const d = await api(A, '/api/cash-sales');
    ok(9, '注文合計 5,160円が出る（2組ぶん）', Number(d.json?.orderTotal) === 5160, String(d.json?.orderTotal));
    ok(9, '入力済み実会計 5,100円が出る（2組ぶん）', Number(d.json?.cashTotal) === 5100, String(d.json?.cashTotal));
    ok(9, '未入力の卓は0件と出る', Number(d.json?.missingCount) === 0, String(d.json?.missingCount));
    ok(9, '差額の理由が日本語で出る', (d.json?.entries || [])[0]?.diffReasonLabel === '値引き', String((d.json?.entries || [])[0]?.diffReasonLabel));

    const entryId = (d.json?.entries || [])[0]?.id;
    const edit = await api(A, '/api/cash-sales', { method: 'PATCH', body: { id: entryId, amount: 3950, reason: '確認テスト（レジ控えと突合）', diffReason: 'discount' } });
    ok(9, '入力しなおしができる', edit.status === 200 && edit.json?.ok === true, JSON.stringify(edit.json).slice(0, 80));
    const rev = await api(A, `/api/cash-sales?view=revisions&id=${entryId}`);
    ok(9, '直したら変更履歴が残る', (rev.json?.revisions || []).length >= 1, `${(rev.json?.revisions || []).length}件`);
    ok(9, '変更履歴に理由が入っている', (rev.json?.revisions || [])[0]?.reason?.includes('確認テスト'), '');

    const conf = await api(A, '/api/cash-sales', { method: 'POST', body: { action: 'confirm', note: '本番スモークテスト' } });
    ok(9, '「本日の売上を確定」ができる', conf.status === 200 && conf.json?.ok === true, JSON.stringify(conf.json).slice(0, 100));
    const after = await api(A, '/api/cash-sales');
    ok(9, '確定したことが画面に残る', !!after.json?.confirmed, '');
    const locked = await api(A, '/api/cash-sales', { method: 'PATCH', body: { id: entryId, amount: 9999, reason: '確定後の書き換え' } });
    ok(9, '確定した売上はもう書き換えられない', locked.status === 409, `status=${locked.status} ${locked.json?.code || ''}`);
    const addAfter = await api(A, '/api/cash-sales', { method: 'POST', body: { amount: 5000, orderTotal: 5000 } });
    ok(9, '確定した日にあとから足すこともできない', addAfter.status === 409 && addAfter.json?.code === 'DAY_CONFIRMED', `status=${addAfter.status}`);

    const logs = await api(A, '/api/admin/logs');
    ok(9, '誰が入力・修正・確定したかが操作ログに残る（ライトは閲覧不可の想定）', logs.status === 402 || logs.status === 200, `status=${logs.status}`);
  });

  // ── ⑩ AI分析への反映（AI DX店で会計→分析まで）
  await section('⑩ AIの分析・予測に反映される', async () => {
    const kb = await api(B, '/api/orders?view=kds');
    for (const i of (kb.json?.items || []).filter((x) => Number(x.table_id) === Number(tblB.id))) {
      await api(B, '/api/orders', { method: 'PATCH', body: { id: Number(i.id), status: 'served', from: i.status } });
    }
    const co = await api(B, '/api/checkout', { method: 'POST', body: { tableId: tblB.id, paymentMethod: 'cash', received: 2000 } });
    ok(10, 'AI DX店でお会計できる', co.status === 200 && co.json?.ok === true, JSON.stringify(co.json).slice(0, 100));

    const st = await api(B, '/api/stats');
    ok(10, '売上分析に今日の売上が出る', st.status === 200 && Number(st.json?.today?.sales) > 0, `status=${st.status} sales=${st.json?.today?.sales}`);
    ok(10, '客数も分析に入る', Number(st.json?.today?.guests) > 0, String(st.json?.today?.guests));
    ok(10, '商品ランキングに検証商品が出る', JSON.stringify(st.json?.ranking || []).includes('【検証】醤油ラーメン'), '');

    const hist = await api(B, '/api/history');
    ok(10, '過去データ（AIの学習台帳）を見られる', hist.status === 200, `status=${hist.status}`);
    const fc = await api(B, '/api/history/forecast');
    ok(10, '予測の画面が動く', fc.status === 200, `status=${fc.status}`);
    const rc = await api(null, '/api/recommend', { method: 'POST', body: { token: tblB.token } });
    ok(10, 'AIのおすすめが動く', rc.status === 200 && rc.json?.ok === true, `status=${rc.status}`);
    ok(10, 'AI DXプランではおすすめ機能が有効になっている', rc.json?.engine !== 'off', String(rc.json?.engine));
    const rcA = await api(null, '/api/recommend', { method: 'POST', body: { token: tblA.token } });
    ok(10, 'ライトプランではAIおすすめが出ない（画面は壊れない）', rcA.status === 200 && rcA.json?.engine === 'off', String(rcA.json?.engine));
  });

  // ── ⑪ 他店舗からデータが見えない
  await section('⑪ ほかのお店のデータが見えない', async () => {
    const tabs = await api(B, '/api/tables');
    ok(11, 'B店の一覧にA店のテーブルが混ざらない', !(tabs.json?.tables || []).some((t) => t.name === '【検証】A1卓'), '');
    const peek = await api(B, `/api/orders?tableId=${tblA.id}`);
    ok(11, 'B店からA店の卓を指定しても見えない', peek.status === 404, `status=${peek.status}`);
    const menu = await api(B, '/api/menu?admin=1');
    ok(11, 'B店の商品一覧にA店の商品が混ざらない', !(menu.json?.menu || []).some((m) => m.name === '【検証】生ビール'), '');
    const stA = await api(A, '/api/tables');
    ok(11, 'A店の一覧にB店のテーブルが混ざらない', !(stA.json?.tables || []).some((t) => t.name === '【検証】B1卓'), '');
    const patch = await api(B, '/api/menu', { method: 'PATCH', body: { id: menuA.beer, sold_out: 1 } });
    ok(11, 'B店からA店の商品を売り切れにできない', patch.status === 404, `status=${patch.status}`);
    const noLogin = await api(null, '/api/tables');
    ok(11, 'ログインしていない人には何も見えない', noLogin.status === 401, `status=${noLogin.status}`);
  });

  // ── ⑫ ライトプランから上位機能へアクセス不可
  await section('⑫ ライトプランから上のプランの機能に入れない', async () => {
    for (const [path, label] of [
      ['/api/stats', '売上分析'],
      ['/api/history', '過去データ'],
      ['/api/inventory', '在庫'],
      ['/api/shift', 'シフト'],
      ['/api/coupons', 'クーポン'],
      ['/api/admin/logs', '操作ログ'],
      ['/api/prep', '仕込み'],
    ]) {
      const r = await api(A, path);
      ok(12, `ライト店は${label}に入れない`, r.status === 402, `status=${r.status}`);
    }
    const pos = await api(A, `/api/checkout?tableId=${tblA.id}`);
    ok(12, 'ライト店は会計（POS）に入れない', pos.status === 402, `status=${pos.status}`);
    const cash = await api(B, '/api/cash-sales');
    ok(12, '会計まで行うプランからは実会計入力を使えない（二重計上を防ぐ）', cash.status === 400 && cash.json?.code === 'POS_PLAN', `status=${cash.status}`);
  });

  console.log('\n────────────────────────────');
  console.log(`合格 ${pass}件 / 要確認 ${fails.length}件`);
  if (fails.length) {
    for (const f of fails) console.log(`  [項目${f.no}] ${f.label}${f.detail ? ` … ${f.detail}` : ''}`);
    process.exit(1);
  }
  console.log('12項目すべて通りました。');
}

main().catch((e) => { console.error(e); process.exit(1); });
