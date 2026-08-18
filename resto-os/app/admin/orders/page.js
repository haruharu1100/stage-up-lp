'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const STATUS = { received: '受付', cooking: '調理中', ready: '完成', served: '提供済', void: '取消' };
const SOURCE = { qr: 'QR注文', tablet: 'タブレット', staff: 'スタッフ' };
const PAY = { cash: '現金', credit: 'カード', qr: 'QR決済', emoney: '電子マネー', other: 'その他' };
const CHECK_STATUS = { closed: '会計済', voided: '取消', refunded: '返金' };

const dt = (v) =>
  new Date(v).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function OrdersHistory() {
  const [tab, setTab] = useState('checks');
  const [checks, setChecks] = useState([]);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const [c, o] = await Promise.all([
      fetch('/api/orders?view=checks').then((x) => x.json()),
      fetch('/api/orders?view=history').then((x) => x.json()),
    ]);
    if (c.ok) setChecks(c.checks);
    if (o.ok) setItems(o.items);
  }, []);

  useEffect(() => { load(); }, [load]);

  /** 会計の取消・返金。理由が無ければ実行しない（あとで「誰が・なぜ」を必ず追えるようにする） */
  async function voidCheck(check, action) {
    const word = action === 'refund' ? '返金' : '取消';
    const reason = prompt(
      `テーブル${check.table_name}／${yen(check.total)} の会計を${word}します。\n理由を入力してください（記録に残ります）`
    );
    if (!reason || !reason.trim()) return;
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, checkId: check.id, reason: reason.trim() }),
    }).then((x) => x.json());
    if (!r.ok) return alert(r.error || `${word}できませんでした`);
    load();
  }

  const checkList = checks.filter(
    (c) => !q || String(c.table_name).includes(q) || String(c.public_id).includes(q) || String(c.staff_name || '').includes(q)
  );
  const itemList = items.filter((i) => !q || i.name.includes(q) || String(i.table_name).includes(q));

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">注文・会計履歴</div>
        <div className="muted">
          取消・返金も履歴として残ります（不正防止のため、記録そのものは削除できません）。
        </div>

        <div className="tabs" style={{ marginTop: 14 }}>
          <button className={tab === 'checks' ? 'on' : ''} onClick={() => setTab('checks')}>会計伝票</button>
          <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>注文明細</button>
        </div>

        <div className="card" style={{ marginTop: 14, marginBottom: 14 }}>
          <input
            className="input"
            placeholder={tab === 'checks' ? 'テーブル名・伝票番号・担当者で検索' : '商品名・テーブル名で検索'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {tab === 'checks' ? (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table table-wide">
              <thead>
                <tr>
                  <th>日時</th><th>伝票番号</th><th>卓</th><th className="num">人数</th>
                  <th className="num">合計</th><th>支払</th><th>担当</th><th>状態</th><th></th>
                </tr>
              </thead>
              <tbody>
                {checkList.map((c) => (
                  <tr key={c.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{dt(c.created_at)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{c.public_id}</td>
                    <td>{c.table_name}</td>
                    <td className="num">{c.guests}</td>
                    <td className="num mono">
                      {yen(c.total)}
                      {c.discount > 0 && <div className="muted">割引 -{yen(c.discount)}</div>}
                    </td>
                    <td>{PAY[c.payment_method] || c.payment_method}</td>
                    <td>{c.staff_name || '—'}</td>
                    <td>
                      <span className={`badge ${c.status === 'closed' ? 'b-green' : 'b-out'}`}>{CHECK_STATUS[c.status] || c.status}</span>
                      {c.void_reason && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {c.voided_by}：{c.void_reason}
                        </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.status === 'closed' && (
                        <>
                          <button className="btn btn-sm" onClick={() => voidCheck(c, 'void')}>取消</button>{' '}
                          <button className="btn btn-sm" onClick={() => voidCheck(c, 'refund')}>返金</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {checkList.length === 0 && <div className="muted" style={{ padding: 24, textAlign: 'center' }}>会計の記録はまだありません</div>}
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table table-wide">
              <thead>
                <tr><th>日時</th><th>卓</th><th>商品</th><th className="num">数量</th><th className="num">金額</th><th>経路</th><th>状態</th></tr>
              </thead>
              <tbody>
                {itemList.map((i) => (
                  <tr key={i.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{dt(i.created_at)}</td>
                    <td>{i.table_name}</td>
                    <td>
                      {i.name}
                      {['ai', 'upsell'].includes(i.via) && (
                        <span className="badge b-ai" style={{ marginLeft: 6 }}>{i.via === 'upsell' ? 'セット提案' : 'AIおすすめ'}</span>
                      )}
                      {i.via === 'otoshi' && <span className="badge b-gray" style={{ marginLeft: 6 }}>自動付与</span>}
                      {i.options && <div className="muted">{i.options}</div>}
                      {i.note && <div className="muted">備考: {i.note}</div>}
                      {i.void_reason && <div className="muted">取消理由: {i.void_reason}（{i.void_by}）</div>}
                    </td>
                    <td className="num">{i.qty}</td>
                    <td className="num mono">{yen(i.unit_price * i.qty)}</td>
                    <td>{SOURCE[i.source] || i.source}</td>
                    <td><span className={`badge ${i.status === 'void' ? 'b-out' : i.status === 'served' ? 'b-green' : 'b-gray'}`}>{STATUS[i.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
