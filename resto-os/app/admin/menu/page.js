'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const STATIONS = [
  ['kitchen', '厨房'],
  ['drink', 'ドリンク場'],
  ['grill', '焼き場'],
  ['sashimi', '刺場'],
  ['dessert', 'デザート'],
];

const EMPTY = {
  name: '', description: '', price: 0, cost: 0, emoji: '🍽', image_url: '', station: 'kitchen',
  allergens: '', calories: '', spicy: 0, is_new: 0, is_recommended: 0, sold_out: 0,
  options_json: '[]', pair_with: '', pair_message: '', category_id: null, sort_order: 999, active: 1,
  tax_rate: 0,
};

export default function MenuAdmin() {
  const [menu, setMenu] = useState([]);
  const [cats, setCats] = useState([]);
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/menu?admin=1').then((x) => x.json());
    if (r.ok) {
      setMenu(r.menu);
      setCats(r.categories);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(body) {
    const method = body.id ? 'PATCH' : 'POST';
    const payload = { ...body, calories: body.calories === '' ? null : Number(body.calories) };
    const r = await fetch('/api/menu', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((x) => x.json());
    if (!r.ok) return alert(r.error);
    setEdit(null);
    load();
  }

  async function toggle(m, field) {
    await fetch('/api/menu', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, [field]: m[field] ? 0 : 1 }),
    });
    load();
  }

  const list = menu.filter((m) => !filter || m.category_name === filter);

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="row-between">
          <div>
            <div className="h1">商品管理</div>
            <div className="muted">価格は税込で登録します。売り切れにすると、お客様の注文画面ですぐ「売り切れ」表示になります。</div>
          </div>
          <button className="btn btn-primary" onClick={() => setEdit({ ...EMPTY, category_id: cats[0]?.id })}>＋ 商品を追加</button>
        </div>

        <div className="wrapflex" style={{ margin: '14px 0' }}>
          <button className={`chip ${!filter ? 'on' : ''}`} onClick={() => setFilter('')}>すべて</button>
          {cats.map((c) => (
            <button key={c.id} className={`chip ${filter === c.name ? 'on' : ''}`} onClick={() => setFilter(c.name)}>{c.name}</button>
          ))}
        </div>

        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table table-wide">
            <thead>
              <tr>
                <th>商品</th><th>カテゴリー</th><th>提供場所</th>
                <th className="num">価格</th><th className="num">原価</th><th className="num">粗利率</th>
                <th className="num">30日販売</th><th>表示</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} style={{ opacity: m.active ? 1 : 0.45 }}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{m.emoji || '🍽'}</span>
                      <div>
                        <div style={{ fontWeight: 700 }}>{m.name}</div>
                        <div className="muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.description}</div>
                      </div>
                    </div>
                  </td>
                  <td>{m.category_name}</td>
                  <td>{STATIONS.find((s) => s[0] === m.station)?.[1]}</td>
                  <td className="num mono">{yen(m.price)}</td>
                  <td className="num mono">{yen(m.cost)}</td>
                  <td className="num mono">{m.price ? (((m.price - m.cost) / m.price) * 100).toFixed(1) : '0.0'}%</td>
                  <td className="num mono">{m.popular_count}</td>
                  <td>
                    <div className="wrapflex">
                      <button className={`btn btn-sm ${m.sold_out ? 'btn-dark' : ''}`} onClick={() => toggle(m, 'sold_out')}>
                        {m.sold_out ? '売り切れ中' : '販売中'}
                      </button>
                      <button className={`btn btn-sm ${m.is_recommended ? 'btn-primary' : ''}`} onClick={() => toggle(m, 'is_recommended')}>おすすめ</button>
                      <button className={`btn btn-sm ${m.is_new ? 'btn-primary' : ''}`} onClick={() => toggle(m, 'is_new')}>NEW</button>
                    </div>
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setEdit({ ...m, calories: m.calories ?? '' })}>編集</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && <EditSheet value={edit} cats={cats} menu={menu} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

function EditSheet({ value, cats, menu, onClose, onSave }) {
  const [v, setV] = useState(value);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const setNum = (k) => (e) => setV({ ...v, [k]: Number(e.target.value) });

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <div className="h2" style={{ margin: 0 }}>{v.id ? '商品を編集' : '商品を追加'}</div>
          <button className="btn btn-sm" onClick={onClose}>閉じる</button>
        </div>

        <div className="grid g2" style={{ marginTop: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="field">商品名</label>
            <input className="input" value={v.name} onChange={set('name')} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="field">説明</label>
            <textarea className="textarea" value={v.description || ''} onChange={set('description')} />
          </div>
          <div>
            <label className="field">カテゴリー</label>
            <select className="select" value={v.category_id || ''} onChange={setNum('category_id')}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field">提供場所（注文の振り分け先）</label>
            <select className="select" value={v.station} onChange={set('station')}>
              {STATIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="field">販売価格（税込）</label>
            <input className="input mono" type="number" value={v.price} onChange={setNum('price')} />
          </div>
          <div>
            <label className="field">原価</label>
            <input className="input mono" type="number" value={v.cost} onChange={setNum('cost')} />
          </div>
          <div>
            {/* 持ち帰り・テイクアウトのお菓子などは8%。レシートの内訳がここで決まる */}
            <label className="field">消費税率</label>
            <select className="select" value={Number(v.tax_rate) || 0} onChange={setNum('tax_rate')}>
              <option value={0}>店の標準税率（10%）</option>
              <option value={8}>軽減税率 8%（持ち帰りなど）</option>
            </select>
          </div>
          <div>
            <label className="field">アイコン（絵文字）</label>
            <input className="input" value={v.emoji || ''} onChange={set('emoji')} />
          </div>
          <div>
            <label className="field">写真URL（任意）</label>
            <input className="input" value={v.image_url || ''} onChange={set('image_url')} placeholder="https://..." />
          </div>
          <div>
            <label className="field">カロリー（kcal）</label>
            <input className="input mono" type="number" value={v.calories ?? ''} onChange={set('calories')} />
          </div>
          <div>
            <label className="field">辛さ（0〜3）</label>
            <input className="input mono" type="number" min={0} max={3} value={v.spicy} onChange={setNum('spicy')} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="field">アレルギー表示（カンマ区切り）</label>
            <input className="input" value={v.allergens || ''} onChange={set('allergens')} placeholder="小麦,卵,乳" />
          </div>
          <div>
            <label className="field">セットですすめる商品</label>
            <select className="select" value={v.pair_with || ''} onChange={set('pair_with')}>
              <option value="">（AIにおまかせ）</option>
              {menu.filter((m) => m.id !== v.id).map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field">おすすめの一言</label>
            <input className="input" value={v.pair_message || ''} onChange={set('pair_message')} placeholder="一緒にハイボールはいかがですか？" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="field">オプション設定（サイズ・トッピング・セット）</label>
            <textarea
              className="textarea mono"
              style={{ fontSize: 12, minHeight: 120 }}
              value={v.options_json || '[]'}
              onChange={set('options_json')}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              例：[{'{'}"name":"サイズ","type":"single","required":false,"choices":[{'{'}"label":"普通","price":0{'}'},{'{'}"label":"大盛り","price":150{'}'}]{'}'}]
            </div>
          </div>
        </div>

        <div className="wrapflex" style={{ marginTop: 12 }}>
          {[['is_recommended', 'おすすめ'], ['is_new', 'NEW'], ['sold_out', '売り切れ'], ['active', '掲載する']].map(([k, l]) => (
            <button key={k} className={`btn btn-sm ${v[k] ? 'btn-primary' : ''}`} onClick={() => setV({ ...v, [k]: v[k] ? 0 : 1 })}>{l}</button>
          ))}
        </div>

        <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 14 }} onClick={() => onSave(v)}>保存する</button>
      </div>
    </div>
  );
}
