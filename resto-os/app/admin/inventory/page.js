'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

/**
 * 材料・在庫・発注の画面。
 *
 * ★この画面には「自動で発注する」ボタンがありません。わざと作っていません。
 *   案を作る → 数量を直す → 人が承認する、の順を必ず通ります。
 *   仕入れは現金と店の信用に直結するので、最後の一押しは必ず人が押す形にしています。
 *
 * 登録の負担をなるべく後回しにできるよう、画面は3つに分けています。
 *   1. 在庫 … 毎日ここだけ触ればよい（棚卸・入荷・廃棄）
 *   2. 材料 … 最初に一度だけ登録する
 *   3. 発注の提案 … 材料とレシピが入ってから使う
 */

const yen = (v) => `${Math.round(Number(v) || 0).toLocaleString('ja-JP')}円`;

const TABS = [
  ['stock', '在庫'],
  ['ingredient', '材料'],
  ['recipe', 'レシピ'],
  ['plan', '発注の提案'],
];

const EMPTY_ING = {
  id: null, name: '', unit: 'g', category: '', unitCost: '', packName: '', packQty: '',
  supplier: '', leadDays: 1, minStock: '', shelfDays: '', note: '',
};

async function post(body) {
  const r = await fetch('/api/inventory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || 'うまくいきませんでした');
  return j;
}

// ===== 在庫 =====

function StockTab({ data, reload, setErr }) {
  const [form, setForm] = useState({ ingredientId: '', kind: 'count', qty: '', reason: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.ingredientId) { setErr('材料を選んでください'); return; }
    setBusy(true);
    try {
      await post({ action: 'move', ...form });
      setForm((f) => ({ ...f, qty: '', reason: '' }));
      await reload();
      setErr('');
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card">
        <h2 className="h2">在庫を記録する</h2>
        <p className="muted" style={{ fontSize: 12 }}>
          在庫の数を直接書き換えることはしません。<b>動きだけを残します。</b>
          こうしておくと「誰がいつ何をしてこの数になったか」が必ず追えます。
          数が合わなくなったら、棚卸を入れれば、そこから数え直します。
        </p>
        <div className="row wrapflex" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div>
            <div className="lbl">材料</div>
            <select
              className="input" value={form.ingredientId} style={{ minWidth: 160 }}
              onChange={(e) => setForm((f) => ({ ...f, ingredientId: e.target.value }))}
            >
              <option value="">選んでください</option>
              {data.ingredients.filter((i) => Number(i.active) === 1).map((i) => (
                <option key={i.id} value={i.id}>{i.name}（{i.unit}）</option>
              ))}
            </select>
          </div>
          <div>
            <div className="lbl">種類</div>
            <select
              className="input" value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            >
              <option value="count">棚卸（いま何あるか）</option>
              <option value="receive">入荷（届いた）</option>
              <option value="waste">廃棄（捨てた）</option>
              <option value="use">使用（手で使った）</option>
              <option value="adjust">手直し</option>
            </select>
          </div>
          <div>
            <div className="lbl">数量</div>
            <input
              className="input mono" type="number" step="0.1" value={form.qty} style={{ width: 110 }}
              onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
            />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div className="lbl">ひとこと（あれば）</div>
            <input
              className="input" value={form.reason} placeholder="例：仕込みすぎ"
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>記録する</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          廃棄と使用は、そのままの数（プラス）で入れてください。差し引きはこちらでします。
        </p>
      </div>

      <div className="card">
        <h2 className="h2">いまの在庫</h2>
        {data.stock.length === 0 ? (
          <p className="muted">材料がまだ登録されていません。「材料」から登録してください。</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-wide">
              <thead>
                <tr>
                  <th>材料</th><th className="mono">いまある量</th><th className="mono">最低量</th>
                  <th>状態</th><th>最後の棚卸</th><th>仕入れ先</th>
                </tr>
              </thead>
              <tbody>
                {data.stock.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="mono">{s.counted ? `${Math.round(s.qty * 10) / 10}${s.unit}` : <span className="muted">未確認</span>}</td>
                    <td className="mono muted">{s.minStock ? `${s.minStock}${s.unit}` : '—'}</td>
                    <td>
                      {!s.counted ? <span className="badge b-gray">棚卸まだ</span>
                        : s.low ? <span className="badge b-out">少ない</span>
                        : <span className="badge b-green">足りている</span>}
                    </td>
                    <td className="mono muted">{s.lastCount || '—'}</td>
                    <td className="muted">{s.supplier || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="h2">最近の動き（14日）</h2>
        {data.moves.length === 0 ? (
          <p className="muted">まだ記録がありません。</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-wide">
              <thead>
                <tr><th>日付</th><th>材料</th><th>種類</th><th className="mono">数量</th>
                {data.seeCost && <th className="mono">金額</th>}<th>入れた人</th><th>ひとこと</th></tr>
              </thead>
              <tbody>
                {data.moves.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.date}</td>
                    <td>{m.name}</td>
                    <td>{data.kindLabel[m.kind] || m.kind}</td>
                    <td className="mono">{Math.round(m.qty * 10) / 10}{m.unit}</td>
                    {data.seeCost && <td className="mono">{m.amount ? yen(m.amount) : '—'}</td>}
                    <td className="muted">{m.staff_name || '自動'}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{m.reason || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ===== 材料 =====

function IngredientTab({ data, reload, setErr }) {
  const [form, setForm] = useState(EMPTY_ING);
  const [busy, setBusy] = useState(false);

  const edit = (i) => setForm({
    id: i.id, name: i.name, unit: i.unit, category: i.category || '',
    unitCost: i.unit_cost ?? '', packName: i.pack_name || '', packQty: i.pack_qty || '',
    supplier: i.supplier || '', leadDays: i.lead_days ?? 1, minStock: i.min_stock || '',
    shelfDays: i.shelf_days || '', note: i.note || '',
  });

  const submit = async () => {
    setBusy(true);
    try {
      await post({ action: 'ingredient', ...form });
      setForm(EMPTY_ING);
      await reload();
      setErr('');
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };

  const F = (k, label, extra = {}) => (
    <div>
      <div className="lbl">{label}</div>
      <input
        className="input" value={form[k]} style={{ width: 120, ...extra.style }}
        type={extra.type || 'text'} step={extra.step} placeholder={extra.placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
      />
    </div>
  );

  return (
    <>
      <div className="card">
        <h2 className="h2">{form.id ? '材料を直す' : '材料を登録する'}</h2>
        <p className="muted" style={{ fontSize: 12 }}>
          最初から全部入れる必要はありません。<b>よく切らすもの・高いもの</b>から数点だけで十分効きます。
        </p>
        <div className="row wrapflex" style={{ gap: 8, alignItems: 'flex-end' }}>
          {F('name', '材料の名前', { style: { width: 160 }, placeholder: '例：豚バラ' })}
          <div>
            <div className="lbl">使う単位</div>
            <select
              className="input" value={form.unit} style={{ width: 90 }}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            >
              {data.units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          {F('category', '分類', { style: { width: 100 }, placeholder: '肉・魚など' })}
          {F('unitCost', '1単位の原価（円）', { type: 'number', step: '0.01', style: { width: 130 } })}
          {F('packName', '仕入れの呼び名', { style: { width: 120 }, placeholder: '1ケース' })}
          {F('packQty', '仕入れ1つ＝何単位', { type: 'number', step: '0.1', style: { width: 140 } })}
          {F('supplier', '仕入れ先', { style: { width: 130 } })}
          {F('leadDays', '届くまでの日数', { type: 'number', style: { width: 120 } })}
          {F('minStock', '切らしたくない量', { type: 'number', step: '0.1', style: { width: 130 } })}
          {F('shelfDays', 'もつ日数', { type: 'number', style: { width: 100 } })}
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {form.id ? '直す' : '登録する'}
          </button>
          {form.id && <button className="btn" onClick={() => setForm(EMPTY_ING)}>やめる</button>}
        </div>
      </div>

      <div className="card">
        <h2 className="h2">登録済みの材料（{data.ingredients.length}件）</h2>
        {data.ingredients.length === 0 ? (
          <p className="muted">まだありません。</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-wide">
              <thead>
                <tr>
                  <th>材料</th><th>単位</th><th>分類</th>
                  {data.seeCost && <th className="mono">原価</th>}
                  <th>仕入れ単位</th><th>仕入れ先</th><th className="mono">最低量</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.ingredients.map((i) => (
                  <tr key={i.id} style={{ opacity: Number(i.active) === 1 ? 1 : 0.5 }}>
                    <td>{i.name}</td>
                    <td className="mono">{i.unit}</td>
                    <td className="muted">{i.category || '—'}</td>
                    {data.seeCost && <td className="mono">{i.unit_cost ? `${i.unit_cost}円` : '—'}</td>}
                    <td className="muted">{i.pack_qty ? `${i.pack_name || '1つ'}＝${i.pack_qty}${i.unit}` : '—'}</td>
                    <td className="muted">{i.supplier || '—'}</td>
                    <td className="mono muted">{i.min_stock || '—'}</td>
                    <td><button className="btn btn-sm" onClick={() => edit(i)}>直す</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ===== レシピ =====

function RecipeTab({ setErr }) {
  const [d, setD] = useState(null);
  const [itemId, setItemId] = useState('');
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id) => {
    const q = id ? `&itemId=${encodeURIComponent(id)}` : '';
    const r = await fetch(`/api/inventory?view=recipe${q}`);
    const j = await r.json();
    if (!r.ok) { setErr(j.message || '読み込めませんでした'); return; }
    setD(j);
    if (id) setLines(j.lines.map((l) => ({ ingredientId: l.ingredient_id, qty: l.qty })));
  }, [setErr]);

  useEffect(() => { load(''); }, [load]);

  const pick = (id) => { setItemId(id); setLines([]); if (id) load(id); };

  const submit = async () => {
    setBusy(true);
    try {
      await post({ action: 'recipe', itemId, lines });
      await load(itemId);
      setErr('');
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };

  if (!d) return <div className="card"><p className="muted">読み込み中…</p></div>;

  const pct = d.coverage.total ? Math.round((d.coverage.withRecipe / d.coverage.total) * 100) : 0;

  return (
    <>
      <div className="card">
        <h2 className="h2">レシピの登録ぐあい</h2>
        <p>
          {d.coverage.total}品のうち <b>{d.coverage.withRecipe}品</b>（{pct}%）に材料が登録されています。
        </p>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          全部そろえる必要はありません。<b>よく出る商品の上位10品だけ</b>入っていれば、発注の提案は十分役に立ちます。
          登録した商品ぶんだけを計算し、入っていない商品は黙って無視するのではなく、
          「まだ含めていない」と発注の提案側に書きます。
        </p>
      </div>

      <div className="card">
        <h2 className="h2">商品ごとに材料を決める</h2>
        <div className="row wrapflex" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div>
            <div className="lbl">商品</div>
            <select className="input" value={itemId} onChange={(e) => pick(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">選んでください</option>
              {d.coverage.rows.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.lines ? `（${r.lines}件登録済み）` : ''}</option>
              ))}
            </select>
          </div>
          {itemId && (
            <button className="btn" onClick={() => setLines((v) => [...v, { ingredientId: '', qty: '' }])}>
              材料を1行足す
            </button>
          )}
        </div>

        {itemId && (
          <>
            <div style={{ marginTop: 12 }}>
              {lines.length === 0 && <p className="muted">材料をまだ足していません。</p>}
              {lines.map((l, idx) => (
                <div key={idx} className="row wrapflex" style={{ gap: 8, marginBottom: 6, alignItems: 'center' }}>
                  <select
                    className="input" value={l.ingredientId} style={{ minWidth: 160 }}
                    onChange={(e) => setLines((v) => v.map((x, i) => i === idx ? { ...x, ingredientId: e.target.value } : x))}
                  >
                    <option value="">材料を選ぶ</option>
                    {d.ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}（{i.unit}）</option>)}
                  </select>
                  <input
                    className="input mono" type="number" step="0.1" value={l.qty} style={{ width: 110 }}
                    placeholder="1つぶんの量"
                    onChange={(e) => setLines((v) => v.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {d.ingredients.find((i) => String(i.id) === String(l.ingredientId))?.unit || ''}
                  </span>
                  <button className="btn btn-sm" onClick={() => setLines((v) => v.filter((_, i) => i !== idx))}>消す</button>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" onClick={submit} disabled={busy} style={{ marginTop: 8 }}>
              この商品のレシピを保存する
            </button>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              「この商品1つを作るのに、その材料をどれだけ使うか」を入れてください。
              ざっくりで構いません。正確でなくても、発注の桁を間違えなくなるだけで十分効きます。
            </p>
          </>
        )}
      </div>
    </>
  );
}

// ===== 発注の提案 =====

function PlanTab({ setErr }) {
  const [d, setD] = useState(null);
  const [days, setDays] = useState(3);
  const [qtys, setQtys] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (n) => {
    const r = await fetch(`/api/inventory?view=plan&days=${n}`);
    const j = await r.json();
    if (!r.ok) { setErr(j.message || '読み込めませんでした'); return; }
    setD(j);
  }, [setErr]);

  useEffect(() => { load(days); }, [load, days]);

  const savePlan = async () => {
    setBusy(true);
    try { await post({ action: 'savePlan', days }); await load(days); setErr(''); }
    catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };

  const decide = async (planId, decision) => {
    setBusy(true);
    try {
      await post({ action: 'decide', planId, decision, qtys: qtys[planId] || {} });
      await load(days); setErr('');
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };

  const receive = async (planId) => {
    setBusy(true);
    try { await post({ action: 'receive', planId }); await load(days); setErr(''); }
    catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };

  if (!d) return <div className="card"><p className="muted">読み込み中…</p></div>;
  const p = d.plan;

  return (
    <>
      <div className="card" style={{ borderLeft: '4px solid #c76a1f' }}>
        <b>このシステムは、自分では発注しません。</b>
        <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
          ここに出るのは案だけです。数量を直したうえで、人が承認して初めて次に進みます。
          仕入れは現金と店の信用に直結するので、最後の一押しは必ず人が押す形にしています。
        </p>
      </div>

      <div className="card">
        <div className="row wrapflex" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div>
            <div className="lbl">何日ぶんの案を出すか</div>
            <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 120 }}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}日ぶん</option>)}
            </select>
          </div>
          {p.ok && p.lines.length > 0 && (
            <button className="btn btn-primary" onClick={savePlan} disabled={busy}>この案を残す</button>
          )}
        </div>
      </div>

      {!p.ok && (
        <div className="card">
          <h2 className="h2">まだ出せません</h2>
          <p>{p.message}</p>
        </div>
      )}

      {p.ok && (
        <div className="card">
          <h2 className="h2">{p.from} 〜 {p.to} のぶん（案）</h2>
          {p.covered < p.days && (
            <p className="muted" style={{ fontSize: 12 }}>
              {p.days}日のうち{p.covered}日ぶんだけ見込みが出せました。残りの日は含まれていません。
            </p>
          )}
          {p.lines.length === 0 ? (
            <p className="muted">いまの在庫で足りる見込みです。頼むものはありません。</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="table table-wide">
                  <thead>
                    <tr>
                      <th>材料</th><th className="mono">要る量</th><th className="mono">いまある</th>
                      <th className="mono">頼む量</th>{d.seeCost && <th className="mono">おおよその額</th>}
                      <th>急ぎ</th><th>根拠</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((l) => (
                      <tr key={l.ingredientId}>
                        <td>{l.name}<div className="muted" style={{ fontSize: 11 }}>{l.supplier}</div></td>
                        <td className="mono muted">{l.needQty}{l.unit}</td>
                        <td className="mono">{l.counted ? `${l.stockQty}${l.unit}` : <span className="muted">未確認</span>}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>
                          {l.suggestQty}{l.unit}
                          {l.packs > 0 && <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{l.packName || ''}{l.packs}つぶん</div>}
                        </td>
                        {d.seeCost && <td className="mono">{yen(l.amount)}</td>}
                        <td>{l.urgency === 'soon' ? <span className="badge b-out">早め</span> : <span className="badge b-gray">ふつう</span>}</td>
                        <td className="muted" style={{ fontSize: 11 }}>{l.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.seeCost && <p>おおよその合計 <b className="mono">{yen(p.total)}</b></p>}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="h2">これまでの案</h2>
        {d.past.length === 0 ? (
          <p className="muted">まだありません。</p>
        ) : d.past.map((pl) => (
          <div key={pl.id} style={{ borderTop: '1px solid #e6eaf2', paddingTop: 10, marginTop: 10 }}>
            <div className="row row-between wrapflex" style={{ alignItems: 'center' }}>
              <div>
                <b>{pl.from} 〜 {pl.to}</b>
                <span className="badge b-gray" style={{ marginLeft: 8 }}>{pl.statusLabel}</span>
                <div className="muted" style={{ fontSize: 12 }}>
                  {pl.createdAt.slice(0, 16).replace('T', ' ')} に {pl.createdBy || '—'} が作成
                  {pl.decidedBy && `／${pl.decidedBy} が${pl.statusLabel}`}
                </div>
              </div>
              <div className="row wrapflex" style={{ gap: 6 }}>
                {pl.status === 'draft' && (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => decide(pl.id, 'approved')} disabled={busy}>承認する</button>
                    <button className="btn btn-sm" onClick={() => decide(pl.id, 'rejected')} disabled={busy}>見送る</button>
                  </>
                )}
                {pl.status === 'approved' && (
                  <>
                    <button className="btn btn-sm" onClick={() => decide(pl.id, 'ordered')} disabled={busy}>発注した</button>
                    <button className="btn btn-primary btn-sm" onClick={() => receive(pl.id)} disabled={busy}>届いた（在庫に入れる）</button>
                  </>
                )}
                {pl.status === 'ordered' && (
                  <button className="btn btn-sm" onClick={() => receive(pl.id)} disabled={busy}>届いた（在庫に入れる）</button>
                )}
              </div>
            </div>

            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table className="table">
                <thead>
                  <tr><th>材料</th><th className="mono">提案</th><th className="mono">決めた量</th>{d.seeCost && <th className="mono">金額</th>}</tr>
                </thead>
                <tbody>
                  {pl.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td className="mono muted">{l.suggest_qty}{l.unit}</td>
                      <td className="mono">
                        {pl.status === 'draft' ? (
                          <input
                            className="input mono" type="number" step="0.1" style={{ width: 90 }}
                            defaultValue={l.suggest_qty}
                            onChange={(e) => setQtys((v) => ({
                              ...v, [pl.id]: { ...(v[pl.id] || {}), [String(l.id)]: e.target.value },
                            }))}
                          />
                        ) : (l.approved_qty === null ? '—' : `${l.approved_qty}${l.unit}`)}
                      </td>
                      {d.seeCost && <td className="mono">{yen(l.amount)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ===== 本体 =====

export default function InventoryPage() {
  const [tab, setTab] = useState('stock');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    const r = await fetch('/api/inventory');
    const j = await r.json();
    if (!r.ok) { setErr(j.message || '読み込めませんでした'); return; }
    setData(j);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      <Nav />
      <div className="wrap">
        <h1 className="h1">材料と発注</h1>
        <p className="muted" style={{ marginTop: -6 }}>
          在庫を記録しておくと、明日の見込みから「これは頼んだほうがよい」という案が出せるようになります。
          <b>システムが勝手に発注することはありません。</b>
        </p>

        <div className="tabs">
          {TABS.map(([k, label]) => (
            <button
              key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : ''}`}
              onClick={() => setTab(k)}
            >{label}</button>
          ))}
        </div>

        {err && <div className="alert">{err}</div>}

        {!data && <div className="card"><p className="muted">読み込み中…</p></div>}
        {data && tab === 'stock' && <StockTab data={data} reload={reload} setErr={setErr} />}
        {data && tab === 'ingredient' && (
          data.canManage
            ? <IngredientTab data={data} reload={reload} setErr={setErr} />
            : <div className="card"><p className="muted">材料の登録は店長以上の方が行えます。</p></div>
        )}
        {data && tab === 'recipe' && (
          data.canManage
            ? <RecipeTab setErr={setErr} />
            : <div className="card"><p className="muted">レシピの登録は店長以上の方が行えます。</p></div>
        )}
        {data && tab === 'plan' && (
          data.canManage
            ? <PlanTab setErr={setErr} />
            : <div className="card"><p className="muted">発注の提案は店長以上の方がご覧になれます。</p></div>
        )}
      </div>
    </>
  );
}
