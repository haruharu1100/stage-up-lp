'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import { buildReceipt } from '../../lib/domain/receipt.js';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const CALL_LABEL = { staff: '店員呼び出し', water: 'お冷', oshibori: 'おしぼり', plate: '皿交換', checkout: 'お会計' };
// 支払方法はサーバー側が受け付ける種類とそろえる（ずれると全部「現金」で記録されてしまう）
const PAYMENTS = [
  ['cash', '現金'],
  ['credit', 'クレジットカード'],
  ['qr', 'QR決済（PayPay等）'],
  ['emoney', '電子マネー・交通系IC'],
  ['other', 'その他'],
];
const STATUS_LABEL = { received: '受付', cooking: '調理中', ready: '完成', served: '提供済' };

export default function Pos() {
  const [tables, setTables] = useState([]);
  const [calls, setCalls] = useState([]);
  const [kds, setKds] = useState(null);
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [coupon, setCoupon] = useState('');
  const [payment, setPayment] = useState('cash');
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  // 「別々に払いたい」「先に帰る人だけ」に対応するための選択状態。空＝卓ぜんぶ会計。
  const [pick, setPick] = useState([]);
  const [payGuests, setPayGuests] = useState(1);
  const [moveOpen, setMoveOpen] = useState(false);
  // 現金のお預り。入れるとお釣りが自動で出る（暗算のミスと、レジ締めのズレを減らす）
  const [received, setReceived] = useState('');

  const load = useCallback(async () => {
    const [t, c, k] = await Promise.all([
      fetch('/api/tables').then((x) => x.json()),
      fetch('/api/calls').then((x) => x.json()),
      fetch('/api/kds/heartbeat').then((x) => x.json()).catch(() => ({ ok: false })),
    ]);
    if (t.ok) setTables(t.tables);
    if (c.ok) setCalls(c.calls);
    if (k.ok) setKds(k);
  }, []);

  // 金額はいつもサーバーに出させる（画面で足し算すると、レシートと1円ずれる原因になる）
  const loadDetail = useCallback(async (tableId, code, ids, g) => {
    const base = `/api/checkout?tableId=${tableId}&coupon=${encodeURIComponent(code || '')}&guests=${Number(g) || 1}`;
    const url = (q) => `${base}${q}`;
    const has = ids && ids.length;
    let r = await fetch(url(has ? `&itemIds=${ids.join(',')}` : '')).then((x) => x.json());
    // 選んだ商品が取消・別会計で消えていたら、選択を捨てて卓ぜんぶの表示に戻す（画面が固まらないように）
    if (!r.ok && has) {
      setPick([]);
      r = await fetch(url('')).then((x) => x.json());
    }
    if (r.ok) setDetail(r);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (sel) loadDetail(sel, coupon, pick, payGuests);
  }, [sel, coupon, pick, payGuests, loadDetail]);

  function closeSheet() {
    setSel(null); setDetail(null); setCoupon(''); setPick([]); setPayGuests(1); setMoveOpen(false); setReceived('');
  }

  /**
   * 手持ちのプリンター（家庭用でも可）でレシートを出すための予備手段。
   * 専用のレシートプリンターが無い店・故障した日でも、紙をお渡しできる。
   * 文字組みは紙に出すときとまったく同じ関数を使うので、内容がずれない。
   */
  function printReceipt(r) {
    const text = buildReceipt(
      {
        store: r.store || {},
        receiptNo: r.receiptNo, createdAt: r.createdAt, tableName: r.table,
        guests: r.guests, partial: r.partial, items: r.items,
        subtotal: r.subtotal, discount: r.discount, couponCode: r.couponCode,
        seatCharge: r.seatCharge, serviceRate: r.serviceRate, serviceCharge: r.serviceCharge,
        taxRows: r.taxRows, invoiceNo: r.invoiceNo, total: r.total,
        payment: r.payment, received: r.received,
      },
      { width: 80 }
    );
    const w = window.open('', '_blank', 'width=420,height=700');
    if (!w) return alert('印刷用の画面を開けませんでした。ブラウザのポップアップ設定をご確認ください。');
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    w.document.write(
      `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>レシート</title>` +
      `<style>@page{size:80mm auto;margin:4mm}` +
      `body{margin:0}` +
      `pre{font-family:"MS Gothic","Osaka-Mono",monospace;font-size:12px;line-height:1.45;white-space:pre;margin:0}` +
      `</style></head><body><pre>${esc(text)}</pre>` +
      `<script>window.onload=function(){window.print()}<\/script></body></html>`
    );
    w.document.close();
  }

  function togglePick(id) {
    setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function doCheckout() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: sel, coupon, paymentMethod: payment,
          received: payment === 'cash' ? Number(received) || 0 : 0,
          ...(pick.length ? { itemIds: pick, guests: payGuests } : {}),
        }),
      }).then((x) => x.json());
      if (!r.ok) return alert(r.error);
      setReceipt({ ...r, table: detail.table.name, items: detail.items, payment, couponCode: detail.coupon?.code || '' });
      setReceived('');
      if (r.tableClosed) {
        closeSheet();
      } else {
        // まだ残っている人がいる卓は開いたまま。選択だけ解除して次の会計に進めるようにする。
        setPick([]); setCoupon(''); setPayGuests(1);
        loadDetail(sel, '', [], 1);
      }
      load();
    } finally {
      setBusy(false);
    }
  }

  async function tableAction(action, id, extra = {}) {
    const r = await fetch('/api/tables', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id, ...extra }),
    }).then((x) => x.json());
    if (!r.ok) alert(r.error || '操作できませんでした');
    load();
    if (sel === id) loadDetail(id, coupon, pick, payGuests);
  }

  /**
   * 注文の取消。理由を必ず残す（記録は消えず、あとから誰でも追える）。
   * 2点以上ある行は「何点を取り消すか」を先に聞く（1点だけ返したい場面が実際に多い）。
   */
  async function voidItem(i) {
    const have = Number(i.qty);
    let qty = have;
    if (have > 1) {
      const v = prompt(`${i.name}（${have}点）のうち、何点を取消しますか？`, String(have));
      if (v === null) return;
      qty = Number(v);
      if (!Number.isFinite(qty) || qty < 1 || qty > have) return alert(`1〜${have}の数を入力してください`);
    }
    const reason = prompt(`${i.name} を${qty}点 取消します。理由を入力してください（記録に残ります）`);
    if (!reason || !reason.trim()) return;
    const r = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: i.id, status: 'void', reason: reason.trim(), qty }),
    }).then((x) => x.json());
    if (!r.ok) return alert(r.error || '取消できませんでした');
    // 行ごと消えた場合、選択に残しておくと会計できなくなるので外す
    if (qty >= have) setPick((p) => p.filter((x) => x !== Number(i.id)));
    else loadDetail(sel, coupon, pick, payGuests);
    load();
  }

  // 卓ぜんぶの明細（チェックを外しても消えないよう、選択とは別に保つ）
  const allLines = detail?.allItems?.length ? detail.allItems : detail?.items || [];
  const splitting = !!detail?.partial;

  // 厨房モニターが落ちている / 一度も開かれていない / 誰も手をつけていない注文が滞留している
  const kitchenDown = kds && (kds.kitchenOffline || (kds.neverConnected && kds.pending > 0));
  const kitchenAlert = kitchenDown || (kds && kds.oldestPendingSec > 600);

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">テーブル / 会計</div>
        <div className="muted" style={{ marginBottom: 14 }}>卓の状況をリアルタイムで表示します。卓をタップすると明細とお会計に進めます。</div>

        {kitchenAlert && (
          <div className="alert danger" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>
              {kitchenDown ? '厨房モニターの反応がありません' : '厨房で長時間手つかずの注文があります'}
            </div>
            <div style={{ marginTop: 4, lineHeight: 1.7 }}>
              {kitchenDown
                ? '厨房の画面が消えている・Wi-Fiが切れている可能性があります。注文が届いていないおそれがあるため、厨房に口頭で確認してください。'
                : `いちばん古い未着手の注文が${Math.floor(kds.oldestPendingSec / 60)}分前から止まっています。厨房に声をかけてください。`}
              {kds.pending > 0 && <>　（未着手 {kds.pending}件）</>}
            </div>
          </div>
        )}

        {calls.length > 0 && (
          <div className="card" style={{ marginBottom: 14, borderColor: 'var(--red)' }}>
            <div className="h2" style={{ color: 'var(--red)' }}>呼び出し中 {calls.length}件</div>
            <div className="wrapflex">
              {calls.map((c) => (
                <button
                  key={c.id}
                  className="btn"
                  onClick={async () => {
                    await fetch('/api/calls', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id }) });
                    load();
                  }}
                >
                  テーブル{c.table_name}：{CALL_LABEL[c.kind]}　→ 対応済にする
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid g4">
          {tables.map((t) => (
            <div
              key={t.id}
              className={`tablecard ${t.status === 'seated' ? 'seated' : ''} ${t.calls > 0 ? 'calling' : ''}`}
              onClick={() => setSel(Number(t.id))}
            >
              <div className="row-between">
                <div style={{ fontWeight: 800, fontSize: 18 }}>{t.name}</div>
                <span className={`badge ${t.status === 'seated' ? 'b-reco' : 'b-gray'}`}>
                  {t.status === 'seated' ? `${t.guests}名 着席中` : '空席'}
                </span>
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>{yen(t.total)}</div>
              <div className="muted">{t.lines}品　{t.pending > 0 ? `／ 未提供${t.pending}品` : ''}</div>
              {t.calls > 0 && <div style={{ color: 'var(--red)', fontWeight: 800, fontSize: 13, marginTop: 4 }}>呼び出し中</div>}
            </div>
          ))}
        </div>
      </div>

      {sel && detail && (
        <div className="sheet-bg" onClick={closeSheet}>
          <div className="sheet" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <div className="h2" style={{ margin: 0 }}>テーブル {detail.table.name}</div>
              <button className="btn btn-sm" onClick={closeSheet}>閉じる</button>
            </div>

            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <span className="muted">人数</span>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button
                  key={n}
                  className={`btn btn-sm ${Number(detail.table.guests) === n ? 'btn-primary' : ''}`}
                  onClick={() => tableAction('open', Number(detail.table.id), { guests: n })}
                >
                  {n}
                </button>
              ))}
              {/* 宴会など9名以上の卓でも、人数が合わないまま均等割りにならないようにする */}
              <button
                className={`btn btn-sm ${Number(detail.table.guests) > 8 ? 'btn-primary' : ''}`}
                onClick={() => {
                  const v = prompt('人数を入力してください（1〜99）', String(Number(detail.table.guests) || 9));
                  const n = Math.max(1, Math.min(99, Number(v) || 0));
                  if (n) tableAction('open', Number(detail.table.id), { guests: n });
                }}
              >
                {Number(detail.table.guests) > 8 ? `${detail.table.guests}名` : '9名以上'}
              </button>
            </div>

            {/* 席移動・卓の合流。混雑時に必ず起きるので、会計をやり直さずに付け替えられるようにする */}
            {allLines.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-sm" onClick={() => setMoveOpen((v) => !v)}>
                  {moveOpen ? '席の移動をやめる' : '席を移す / 卓をまとめる'}
                </button>
                {moveOpen && (
                  <div className="card" style={{ marginTop: 8, background: '#fafbfc' }}>
                    <div className="muted" style={{ marginBottom: 6 }}>
                      未会計のご注文と呼び出しを、まるごと移動先の卓へ付け替えます。金額は変わりません。
                      すでにお客様がいる卓を選ぶと「卓の合流」になります。
                    </div>
                    <div className="wrapflex">
                      {tables.filter((t) => Number(t.id) !== Number(detail.table.id)).map((t) => (
                        <button
                          key={t.id}
                          className={`btn btn-sm ${t.status === 'seated' ? 'btn-primary' : ''}`}
                          onClick={async () => {
                            const merge = t.status === 'seated';
                            const msg = merge
                              ? `テーブル${detail.table.name} を テーブル${t.name}（${t.guests}名 着席中）に合流させます。よろしいですか？`
                              : `テーブル${detail.table.name} のご注文を テーブル${t.name} に移します。よろしいですか？`;
                            if (!confirm(msg)) return;
                            setMoveOpen(false);
                            setPick([]);
                            await tableAction('move', Number(detail.table.id), { toId: Number(t.id) });
                            setSel(Number(t.id));
                          }}
                        >
                          {t.name}{t.status === 'seated' ? `（${t.guests}名）` : '（空席）'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {allLines.length === 0 ? (
              <div className="card" style={{ marginTop: 12, textAlign: 'center' }}>未会計の注文はありません</div>
            ) : (
              <>
                <div className="row-between" style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 700 }}>ご注文</div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => setPick(allLines.map((i) => Number(i.id)))}>すべて選ぶ</button>
                    <button className="btn btn-sm" onClick={() => setPick([])}>選択を解除</button>
                  </div>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  別々にお支払いされる場合は、先に払う方の商品にチェックを入れてください（選ばなければ卓ぜんぶのお会計です）。
                </div>
                <table className="table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr><th style={{ width: 36 }}></th><th>商品</th><th className="num">数量</th><th className="num">金額</th><th>状態</th><th></th></tr>
                  </thead>
                  <tbody>
                    {allLines.map((i) => (
                      <tr key={i.id} style={{ background: pick.includes(Number(i.id)) ? '#eef6ff' : undefined }}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            style={{ width: 20, height: 20 }}
                            checked={pick.includes(Number(i.id))}
                            onChange={() => togglePick(Number(i.id))}
                          />
                        </td>
                        <td onClick={() => togglePick(Number(i.id))} style={{ cursor: 'pointer' }}>
                          {i.name}
                          {['ai', 'upsell'].includes(i.via) && <span className="badge b-ai" style={{ marginLeft: 6 }}>AI</span>}
                          {i.via === 'otoshi' && <span className="badge b-gray" style={{ marginLeft: 6 }}>自動</span>}
                          {i.options && <div className="muted">{i.options}</div>}
                          {i.note && <div className="muted">備考: {i.note}</div>}
                        </td>
                        <td className="num">{i.qty}</td>
                        <td className="num mono">{yen(i.unit_price * i.qty)}</td>
                        <td><span className="badge b-gray">{STATUS_LABEL[i.status]}</span></td>
                        <td><button className="btn btn-sm" onClick={() => voidItem(i)}>取消</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {splitting && (
              <div className="card" style={{ marginTop: 12, borderColor: 'var(--blue, #2563eb)' }}>
                <div style={{ fontWeight: 800 }}>
                  分割してお会計します（{detail.items.length}品／残り {detail.restCount}品・{yen(detail.restTotal)}）
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  お会計してもこの卓は開いたままです。残りの方はそのままご注文を続けられます。
                </div>
                <div className="row" style={{ marginTop: 8, gap: 6, alignItems: 'center' }}>
                  <span className="muted">今お支払いの人数</span>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button key={n} className={`btn btn-sm ${payGuests === n ? 'btn-primary' : ''}`} onClick={() => setPayGuests(n)}>{n}</button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <label className="field">クーポンコード</label>
              <input className="input" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="例）LINE10" />
              {detail.couponError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>{detail.couponError}</div>}
              {detail.coupon && <div style={{ color: 'var(--green)', fontSize: 12, marginTop: 4, fontWeight: 700 }}>{detail.coupon.name} を適用しました</div>}
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="field">支払方法</label>
              <div className="wrapflex">
                {PAYMENTS.map(([v, label]) => (
                  <button key={v} className={`btn btn-sm ${payment === v ? 'btn-primary' : ''}`} onClick={() => setPayment(v)}>{label}</button>
                ))}
              </div>
            </div>

            {payment === 'cash' && (
              <div style={{ marginTop: 12 }}>
                <label className="field">お預り（入れなくても会計できます）</label>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="input mono"
                    style={{ maxWidth: 160 }}
                    type="number"
                    inputMode="numeric"
                    value={received}
                    placeholder="0"
                    onChange={(e) => setReceived(e.target.value)}
                  />
                  {/* よく出す金額をそのまま押せるように（レジでいちばん時間がかかるのがこの入力） */}
                  {[1000, 5000, 10000].map((v) => (
                    <button key={v} className="btn btn-sm" onClick={() => setReceived(String(v))}>{v.toLocaleString()}</button>
                  ))}
                  <button className="btn btn-sm" onClick={() => setReceived(String(detail.total))}>ちょうど</button>
                  {Number(received) > 0 && (
                    <span style={{ fontWeight: 800, fontSize: 18, color: Number(received) >= detail.total ? 'var(--green)' : 'var(--red)' }}>
                      {Number(received) >= detail.total
                        ? `お釣り ${yen(Number(received) - detail.total)}`
                        : `${yen(detail.total - Number(received))} 足りません`}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="card" style={{ marginTop: 14, background: '#fafbfc' }}>
              <div className="row-between">
                <span>{splitting ? '小計（選んだ商品）' : '小計'}</span><span className="mono">{yen(detail.subtotal)}</span>
              </div>
              {detail.discount > 0 && (
                <div className="row-between" style={{ color: 'var(--green)' }}><span>割引</span><span className="mono">-{yen(detail.discount)}</span></div>
              )}
              {detail.seatCharge > 0 && (
                <div className="row-between"><span>席料（{detail.guests}名）</span><span className="mono">{yen(detail.seatCharge)}</span></div>
              )}
              {detail.serviceCharge > 0 && (
                <div className="row-between"><span>サービス料 {detail.serviceRate}%</span><span className="mono">{yen(detail.serviceCharge)}</span></div>
              )}
              <div className="row-between" style={{ fontWeight: 800, fontSize: 20, marginTop: 6 }}>
                <span>合計（税込）</span><span className="mono">{yen(detail.total)}</span>
              </div>
              {(detail.taxRows || []).map((t) => (
                <div key={t.rate} className="row-between muted" style={{ fontSize: 12 }}>
                  <span>{t.rate}%対象 {yen(t.base)}</span><span className="mono">（内消費税 {yen(t.tax)}）</span>
                </div>
              ))}
              {splitting ? (
                payGuests > 1 && (
                  <div className="muted" style={{ marginTop: 4 }}>
                    均等割り {payGuests}名 → お一人 {yen(Math.ceil(detail.total / payGuests))}
                  </div>
                )
              ) : (
                Number(detail.table.guests) > 1 && (
                  <div className="muted" style={{ marginTop: 4 }}>
                    均等割り {detail.table.guests}名 → お一人 {yen(Math.ceil(detail.total / Number(detail.table.guests)))}
                  </div>
                )
              )}
            </div>

            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn" onClick={() => tableAction('close', Number(detail.table.id))}>空席にする</button>
              <div className="spacer" />
              <button className="btn btn-primary btn-lg" disabled={!detail.items.length || busy} onClick={doCheckout}>
                {busy ? '処理中…' : `${splitting ? '選んだ分だけ会計' : '会計する'}（${yen(detail.total)}）`}
              </button>
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <div className="sheet-bg" onClick={() => setReceipt(null)}>
          <div className="sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <div className="h2" style={{ marginTop: 8 }}>{receipt.partial ? '分割のお会計が完了しました' : 'お会計が完了しました'}</div>
              <div className="muted">伝票番号 #{receipt.checkId}／テーブル {receipt.table}</div>
            </div>
            {receipt.partial && !receipt.tableClosed && (
              <div className="alert" style={{ marginTop: 12 }}>
                テーブル {receipt.table} には、まだ未会計のご注文が {receipt.restCount}品（{yen(receipt.restTotal)}）残っています。席はそのままです。
              </div>
            )}
            <div className="card" style={{ marginTop: 14, background: '#fafbfc' }}>
              <div className="row-between"><span>小計</span><span className="mono">{yen(receipt.subtotal)}</span></div>
              {receipt.discount > 0 && <div className="row-between"><span>割引</span><span className="mono">-{yen(receipt.discount)}</span></div>}
              {receipt.seatCharge > 0 && <div className="row-between"><span>席料（{receipt.guests}名）</span><span className="mono">{yen(receipt.seatCharge)}</span></div>}
              {receipt.serviceCharge > 0 && <div className="row-between"><span>サービス料 {receipt.serviceRate}%</span><span className="mono">{yen(receipt.serviceCharge)}</span></div>}
              <div className="row-between" style={{ fontWeight: 800, fontSize: 20 }}><span>合計</span><span className="mono">{yen(receipt.total)}</span></div>
              {/* インボイス（適格請求書）に必要な、税率ごとの内訳 */}
              {(receipt.taxRows || []).map((t) => (
                <div key={t.rate} className="row-between muted" style={{ fontSize: 12 }}>
                  <span>{t.rate}%対象 {yen(t.base)}</span><span className="mono">（内消費税 {yen(t.tax)}）</span>
                </div>
              ))}
              {Number(receipt.received) > 0 && (
                <>
                  <div className="row-between" style={{ marginTop: 4 }}><span>お預り</span><span className="mono">{yen(receipt.received)}</span></div>
                  <div className="row-between" style={{ fontWeight: 800, color: 'var(--green)' }}>
                    <span>お釣り</span><span className="mono">{yen(Math.max(0, Number(receipt.received) - Number(receipt.total)))}</span>
                  </div>
                </>
              )}
              {receipt.perPerson && <div className="muted" style={{ marginTop: 4 }}>均等割り {receipt.guests}名 → お一人 {yen(receipt.perPerson)}</div>}
              <div className="muted" style={{ marginTop: 4 }}>支払方法：{PAYMENTS.find((p) => p[0] === receipt.payment)?.[1]}</div>
              {receipt.invoiceNo && <div className="muted mono" style={{ marginTop: 4 }}>登録番号 {receipt.invoiceNo}</div>}
            </div>
            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              レシートプリンターを登録していれば、すでに紙が出ています。
              出ていないときや、もう1枚必要なときは下のボタンからこのパソコンのプリンターで印刷できます。
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="btn btn-lg" style={{ flex: 1 }} onClick={() => printReceipt(receipt)}>レシートを印刷</button>
              <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={() => setReceipt(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
