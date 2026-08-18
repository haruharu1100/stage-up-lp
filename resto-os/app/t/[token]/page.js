'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CALLS = [
  ['staff', '店員を呼ぶ', '🙋'],
  ['water', 'お冷', '💧'],
  ['oshibori', 'おしぼり', '🧻'],
  ['plate', '皿交換', '🍽'],
  ['checkout', 'お会計', '💳'],
];

const STATUS = { received: '受付済み', cooking: '調理中', ready: 'まもなく提供', served: '提供済み' };

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;

const cartKey = (t) => `cart_${t}`;
const pendingKey = (t) => `pending_${t}`;

const readJson = (k, fallback) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

const newClientOrderId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function CustomerOrder({ params }) {
  const token = params.token;
  const [menu, setMenu] = useState([]);
  const [cats, setCats] = useState([]);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false); // お会計が済んで、この画面の役目が終わった状態
  const openedOk = useRef(false);
  const [tab, setTab] = useState('menu');
  const [cat, setCat] = useState('おすすめ');
  const [cart, setCart] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [upsellBox, setUpsell] = useState(null);
  const [reco, setReco] = useState(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [guests, setGuests] = useState(0);
  const [askGuests, setAskGuests] = useState(false);
  const [toast, setToast] = useState('');
  const [sending, setSending] = useState(false);
  const [staffMode, setStaffMode] = useState(false);
  const [pending, setPending] = useState(null); // 送信できていない注文（端末に残す）
  const [rejected, setRejected] = useState([]);

  const notify = (m) => {
    setToast(m);
    setTimeout(() => setToast(''), 2200);
  };

  const loadState = useCallback(async () => {
    const r = await fetch(`/api/orders?token=${token}`).then((x) => x.json());
    if (!r.ok) {
      // 一度ちゃんと開けていたのに開けなくなった＝お会計が済んで席が閉じられた合図。
      // ここでエラー画面を出すと、支払い終えたお客様が「店員を呼べ」と言われてしまう。
      if (openedOk.current) {
        setFinished(true);
        try {
          localStorage.removeItem(cartKey(token));
          localStorage.removeItem(pendingKey(token));
          localStorage.removeItem(`guests_${token}`);
        } catch {}
      } else {
        setError(r.error || '読み込みに失敗しました');
      }
      return;
    }
    openedOk.current = true;
    setState(r);
    if (!guests && Number(r.table.guests) > 0) setGuests(Number(r.table.guests));
  }, [token, guests]);

  useEffect(() => {
    fetch(`/api/menu?token=${token}`)
      .then((x) => x.json())
      .then((r) => {
        if (!r.ok) return;
        setMenu(r.menu);
        setCats(r.categories.map((c) => c.name));
      })
      .catch(() => {});
    loadState();
    setStaffMode(new URLSearchParams(window.location.search).get('staff') === '1');
    const saved = Number(localStorage.getItem(`guests_${token}`) || 0);
    if (saved) setGuests(saved);
    else setAskGuests(true);

    // 端末に残っている「入力中のカート」と「送れていない注文」を拾い直す
    setCart(readJson(cartKey(token), []));
    setPending(readJson(pendingKey(token), null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // カートは打った瞬間に端末へ保存する（画面を閉じても消えない）
  useEffect(() => {
    try {
      if (cart.length) localStorage.setItem(cartKey(token), JSON.stringify(cart));
      else localStorage.removeItem(cartKey(token));
    } catch {}
  }, [cart, token]);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(loadState, 15000);
    return () => clearInterval(id);
  }, [loadState, finished]);

  const tabs = useMemo(() => ['おすすめ', '人気', ...cats.filter((c) => c !== 'おすすめ')], [cats]);

  const list = useMemo(() => {
    if (cat === 'おすすめ') return menu.filter((m) => m.is_recommended || m.is_new || m.rank);
    if (cat === '人気') return [...menu].filter((m) => m.popular_count > 0).sort((a, b) => b.popular_count - a.popular_count);
    return menu.filter((m) => m.category_name === cat);
  }, [menu, cat]);

  const cartTotal = cart.reduce((s, c) => s + c.unitPrice * c.qty, 0);
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);

  function addToCart(entry) {
    setCart((c) => [...c, entry]);
    setSheet(null);
    notify(`${entry.name} をカートに追加しました`);
    fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'upsell', token, itemId: entry.itemId }),
    })
      .then((x) => x.json())
      .then((r) => {
        if (r.ok && r.suggestion?.item) setUpsell(r.suggestion);
      })
      .catch(() => {});
  }

  async function loadReco() {
    setRecoLoading(true);
    setTab('reco');
    try {
      const r = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, guests: guests || 2, cart: cart.map((c) => ({ itemId: c.itemId, name: c.name })) }),
      }).then((x) => x.json());
      setReco(r.ok ? r : null);
    } finally {
      setRecoLoading(false);
    }
  }

  /**
   * 注文を送る。
   * 送る前に必ず端末へ保存し、店のサーバーが「受け取りました」と答えるまで消さない。
   * 同じ注文キー(clientOrderId)で何度送り直しても、店には1回しか登録されない。
   */
  const sendOrder = useCallback(
    async (order, { silent = false } = {}) => {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          clientOrderId: order.clientOrderId,
          source: order.staffMode ? 'staff' : 'qr',
          guests: order.guests,
          items: order.items,
        }),
      });
      const r = await res.json();
      if (!r.ok) {
        // 通信は届いたが店側が受け付けられない内容（売り切れ等）。送り直しても直らないので端末から下ろす
        try { localStorage.removeItem(pendingKey(token)); } catch {}
        setPending(null);
        // 送っている間にお会計が済んで席が閉じられた場合は、エラーではなく「ありがとうございました」を出す
        if (r.code === 'NOT_FOUND' && openedOk.current) {
          setFinished(true);
          return false;
        }
        notify(r.error || '注文をお受けできませんでした。恐れ入りますが店員をお呼びください');
        return false;
      }
      try { localStorage.removeItem(pendingKey(token)); } catch {}
      setPending(null);
      setRejected(r.rejected || []);
      await loadState();
      if (!silent) {
        setTab('history');
        notify(r.duplicated ? 'ご注文は受付済みです' : '注文を承りました。少々お待ちください');
      }
      return true;
    },
    [token, loadState]
  );

  const trySend = useCallback(
    async (order, opts) => {
      // 電波が一瞬切れただけなら、間隔を空けて3回まで自動で送り直す
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await sendOrder(order, opts);
        } catch {
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        }
      }
      return false;
    },
    [sendOrder]
  );

  async function submitOrder() {
    if (!cart.length || sending) return;
    const order = {
      clientOrderId: newClientOrderId(),
      guests: guests || 2,
      staffMode,
      items: cart.map((c) => ({ itemId: c.itemId, qty: c.qty, options: c.options, note: c.note, via: c.via })),
      names: cart.map((c) => `${c.name}×${c.qty}`),
      at: Date.now(),
    };
    // ① まず端末に書く ② 送る ③ 店から受付の返事が来てはじめて消す
    try { localStorage.setItem(pendingKey(token), JSON.stringify(order)); } catch {}
    setPending(order);
    setCart([]);
    setSheet(null);
    setUpsell(null);

    setSending(true);
    try {
      await trySend(order);
    } finally {
      setSending(false);
    }
  }

  // 送れていない注文が残っていたら、画面を開き直したときと電波が戻ったときに自動で送り直す
  useEffect(() => {
    if (!pending || sending) return;
    const retry = () => { setSending(true); trySend(pending, { silent: true }).finally(() => setSending(false)); };
    // 画面を開き直した直後（送信中だった注文が残っている）ならすぐ送り直す
    if (Date.now() - Number(pending.at || 0) > 5000) retry();
    const id = setInterval(retry, 20000);
    window.addEventListener('online', retry);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', retry);
    };
  }, [pending, sending, trySend]);

  async function call(kind, label) {
    const r = await fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, kind }),
    }).then((x) => x.json());
    notify(r.duplicated ? `${label}は受付済みです` : `${label}をお伝えしました`);
    loadState();
  }

  if (finished) {
    return (
      <div className="wrap-narrow">
        <div className="card" style={{ textAlign: 'center', marginTop: 60 }}>
          <div style={{ fontSize: 40 }}>🍵</div>
          <div className="h2" style={{ marginTop: 10 }}>お会計が完了しました</div>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.9 }}>
            本日はご来店いただきありがとうございました。<br />
            またのお越しをお待ちしております。
          </div>
          <div className="muted" style={{ marginTop: 14, fontSize: 12 }}>
            次にご利用の際は、テーブルのQRコードをもう一度読み取ってください。
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wrap-narrow">
        <div className="card" style={{ textAlign: 'center', marginTop: 60 }}>
          <div style={{ fontSize: 40 }}>🔍</div>
          <div className="h2" style={{ marginTop: 10 }}>ページが見つかりません</div>
          <div className="muted">お手数ですが、店員をお呼びください。</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="cust-header">
        <div className="row-between">
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
              テーブル {state?.table?.name ?? '－'}
            </div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>
              ご注文 {staffMode && <span className="badge b-blue">スタッフ入力</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>現在のお会計（税込）</div>
            <div style={{ fontWeight: 800, fontSize: 18 }} className="mono">{yen(state?.subtotal)}</div>
          </div>
        </div>

        <div className="cat-scroll" style={{ marginTop: 6 }}>
          <button className={`chip ${tab === 'menu' ? 'on' : ''}`} onClick={() => setTab('menu')}>メニュー</button>
          <button className={`chip ${tab === 'reco' ? 'on' : ''}`} onClick={loadReco}>✨ おすすめを聞く</button>
          <button className={`chip ${tab === 'history' ? 'on' : ''}`} onClick={() => setTab('history')}>
            注文履歴{state?.items?.length ? `(${state.items.length})` : ''}
          </button>
          <button className={`chip ${tab === 'call' ? 'on' : ''}`} onClick={() => setTab('call')}>店員を呼ぶ</button>
        </div>

        {tab === 'menu' && (
          <div className="cat-scroll">
            {tabs.map((c) => (
              <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
        )}
      </div>

      <div className="wrap-narrow">
        {pending && (
          <div className="alert danger" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 800 }}>ご注文がまだ送信できていません</div>
            <div style={{ marginTop: 4 }}>{pending.names.join('、')}</div>
            <div className="muted" style={{ marginTop: 4 }}>
              電波が戻り次第そのまま送信します。この画面を閉じても内容は消えません。
            </div>
            <button
              className="btn btn-sm" style={{ marginTop: 8 }} disabled={sending}
              onClick={() => { setSending(true); trySend(pending).finally(() => setSending(false)); }}
            >
              {sending ? '送信中…' : 'いますぐ送信する'}
            </button>
          </div>
        )}

        {rejected.length > 0 && (
          <div className="alert" style={{ marginBottom: 12 }}>
            申し訳ございません。{rejected.join('、')} は売り切れのため、お受けできませんでした。
            <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setRejected([])}>閉じる</button>
          </div>
        )}

        {tab === 'menu' && (
          <div className="grid" style={{ gap: 10 }}>
            {list.length === 0 && <div className="muted" style={{ padding: 20, textAlign: 'center' }}>該当する商品がありません</div>}
            {list.map((m) => (
              <MenuCard key={m.id} m={m} onClick={() => !m.sold_out && setSheet({ item: m })} />
            ))}
          </div>
        )}

        {tab === 'reco' && (
          <RecoPanel
            reco={reco}
            loading={recoLoading}
            guests={guests}
            onChangeGuests={() => setAskGuests(true)}
            onReload={loadReco}
            onPick={(p) => setSheet({ item: p.item, via: 'ai', defaultQty: p.qty })}
            onAddAll={(picks) => {
              picks.forEach((p) =>
                setCart((c) => [
                  ...c,
                  { key: Math.random(), itemId: p.item.id, name: p.item.name, unitPrice: p.item.price, qty: p.qty, options: [], note: '', via: 'ai' },
                ])
              );
              notify('おすすめをまとめてカートに入れました');
            }}
          />
        )}

        {tab === 'history' && <HistoryPanel state={state} />}

        {tab === 'call' && (
          <div className="grid g2">
            {CALLS.map(([kind, label, icon]) => (
              <button key={kind} className="card" style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => call(kind, label)}>
                <div style={{ fontSize: 30 }}>{icon}</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>{label}</div>
              </button>
            ))}
            {state?.calls?.length > 0 && (
              <div className="card" style={{ gridColumn: '1 / -1' }}>
                <div className="muted">受付中：{state.calls.map((c) => CALLS.find((x) => x[0] === c.kind)?.[1]).join('・')}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="cartbar">
          <div className="row-between">
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>カート {cartCount}点</div>
              <div style={{ fontWeight: 800, fontSize: 18 }} className="mono">{yen(cartTotal)}</div>
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => setSheet({ cart: true })}>
              カートを見る
            </button>
          </div>
        </div>
      )}

      {sheet?.item && (
        <ItemSheet
          item={sheet.item}
          via={sheet.via}
          defaultQty={sheet.defaultQty}
          onClose={() => setSheet(null)}
          onAdd={addToCart}
        />
      )}

      {sheet?.cart && (
        <CartSheet
          cart={cart}
          total={cartTotal}
          sending={sending}
          onClose={() => setSheet(null)}
          onRemove={(k) => setCart((c) => c.filter((x) => x.key !== k))}
          onQty={(k, d) => setCart((c) => c.map((x) => (x.key === k ? { ...x, qty: Math.max(1, x.qty + d) } : x)))}
          onSubmit={submitOrder}
        />
      )}

      {upsellBox && (
        <div className="sheet-bg" onClick={() => setUpsell(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge b-ai">おすすめ</span>
              <span className="muted">{upsellBox.engine === 'ai' ? 'AIからのご提案' : '相性のよい一品'}</span>
            </div>
            <div className="h2" style={{ marginTop: 8, fontSize: 18 }}>{upsellBox.message}</div>
            <MenuCard m={upsellBox.item} onClick={() => {}} />
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setUpsell(null)}>今回は見送る</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => {
                  const it = upsellBox.item;
                  setCart((c) => [...c, { key: Math.random(), itemId: it.id, name: it.name, unitPrice: it.price, qty: 1, options: [], note: '', via: 'upsell' }]);
                  setUpsell(null);
                  notify('カートに追加しました');
                }}
              >
                追加する（{yen(upsellBox.item.price)}）
              </button>
            </div>
          </div>
        </div>
      )}

      {askGuests && (
        <div className="sheet-bg">
          <div className="sheet">
            <div className="h2">ご来店ありがとうございます</div>
            <div className="muted">ご人数を教えてください。おすすめの量の目安にいたします。</div>
            <div className="wrapflex" style={{ marginTop: 14 }}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <button
                  key={n}
                  className="btn btn-lg"
                  onClick={() => {
                    setGuests(n);
                    localStorage.setItem(`guests_${token}`, String(n));
                    setAskGuests(false);
                  }}
                >
                  {n}名
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function MenuCard({ m, onClick }) {
  return (
    <div className={`mitem ${m.sold_out ? 'out' : ''}`} onClick={onClick}>
      <div className="mthumb" style={m.image_url ? { backgroundImage: `url(${m.image_url})` } : {}}>
        {!m.image_url && (m.emoji || '🍽')}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="wrapflex" style={{ gap: 5, marginBottom: 3 }}>
          {m.rank > 0 && <span className="badge b-rank">人気{m.rank}位</span>}
          {m.is_new === 1 && <span className="badge b-new">NEW</span>}
          {m.is_recommended === 1 && <span className="badge b-reco">おすすめ</span>}
          {m.spicy > 0 && <span className="badge b-spicy">辛さ{'🌶'.repeat(m.spicy)}</span>}
          {m.sold_out === 1 && <span className="badge b-out">売り切れ</span>}
        </div>
        <div className="mname">{m.name}</div>
        <div className="mdesc">{m.description}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
          {m.calories ? `${m.calories}kcal` : ''}
          {m.allergens ? `　アレルギー: ${m.allergens}` : ''}
        </div>
        <div className="mprice mono">{yen(m.price)}<span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>（税込）</span></div>
      </div>
    </div>
  );
}

function ItemSheet({ item, via, defaultQty, onClose, onAdd }) {
  const [qty, setQty] = useState(defaultQty || 1);
  const [sel, setSel] = useState({});
  const [note, setNote] = useState('');
  const groups = item.options || [];

  const extra = groups.reduce((s, g) => {
    const picked = sel[g.name] || [];
    return s + picked.reduce((t, label) => t + (g.choices.find((c) => c.label === label)?.price || 0), 0);
  }, 0);
  const unit = item.price + extra;

  function toggle(g, label) {
    setSel((prev) => {
      const cur = prev[g.name] || [];
      if (g.type === 'multi') {
        return { ...prev, [g.name]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      }
      return { ...prev, [g.name]: cur[0] === label ? [] : [label] };
    });
  }

  const missing = groups.filter((g) => g.required && !(sel[g.name] || []).length);

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <div className="h2" style={{ fontSize: 18, margin: 0 }}>{item.name}</div>
          <button className="btn btn-sm" onClick={onClose}>閉じる</button>
        </div>
        <div className="mthumb" style={{ width: '100%', height: 130, marginTop: 10, fontSize: 56, ...(item.image_url ? { backgroundImage: `url(${item.image_url})` } : {}) }}>
          {!item.image_url && (item.emoji || '🍽')}
        </div>
        <div className="mdesc" style={{ marginTop: 10, fontSize: 13 }}>{item.description}</div>
        <div className="muted" style={{ marginTop: 6 }}>
          {item.calories ? `${item.calories}kcal　` : ''}
          {item.allergens ? `アレルギー: ${item.allergens}　` : ''}
          {item.spicy > 0 ? `辛さ ${'🌶'.repeat(item.spicy)}` : ''}
        </div>

        {groups.map((g) => (
          <div key={g.name} style={{ marginTop: 16 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{g.name}</div>
              {g.required && <span className="badge b-new">必須</span>}
              {g.type === 'multi' && <span className="badge b-gray">複数可</span>}
            </div>
            {g.choices.map((c) => {
              const on = (sel[g.name] || []).includes(c.label);
              return (
                <div key={c.label} className={`opt-row ${on ? 'on' : ''}`} onClick={() => toggle(g, c.label)}>
                  <span style={{ fontSize: 16 }}>{on ? '☑️' : '⬜️'}</span>
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <span className="mono muted">{c.price ? `${c.price > 0 ? '+' : ''}${c.price}円` : '±0円'}</span>
                </div>
              );
            })}
          </div>
        ))}

        <div style={{ marginTop: 16 }}>
          <label className="field">備考（アレルギー・焼き加減など）</label>
          <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例）玉ねぎ抜きでお願いします" />
        </div>

        <div className="row-between" style={{ marginTop: 16 }}>
          <div className="row">
            <button className="qtybtn" onClick={() => setQty((q) => Math.max(1, q - 1))}>－</button>
            <div style={{ width: 40, textAlign: 'center', fontWeight: 800, fontSize: 18 }}>{qty}</div>
            <button className="qtybtn" onClick={() => setQty((q) => Math.min(20, q + 1))}>＋</button>
          </div>
          <div className="mono" style={{ fontWeight: 800, fontSize: 18 }}>{yen(unit * qty)}</div>
        </div>

        <button
          className="btn btn-primary btn-lg"
          style={{ width: '100%', marginTop: 12 }}
          disabled={missing.length > 0}
          onClick={() =>
            onAdd({
              key: Math.random(),
              itemId: item.id,
              name: item.name,
              unitPrice: unit,
              qty,
              note,
              via: via || '',
              options: Object.entries(sel).flatMap(([group, labels]) => labels.map((label) => ({ group, label }))),
            })
          }
        >
          {missing.length ? `${missing[0].name}を選んでください` : 'カートに入れる'}
        </button>
      </div>
    </div>
  );
}

function CartSheet({ cart, total, onClose, onRemove, onQty, onSubmit, sending }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <div className="h2" style={{ margin: 0 }}>カート</div>
          <button className="btn btn-sm" onClick={onClose}>閉じる</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {cart.map((c) => (
            <div key={c.key} style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
              <div className="row-between">
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                <div className="mono" style={{ fontWeight: 700 }}>{yen(c.unitPrice * c.qty)}</div>
              </div>
              {c.options.length > 0 && <div className="muted">{c.options.map((o) => o.label).join(' / ')}</div>}
              {c.note && <div className="muted">備考: {c.note}</div>}
              <div className="row" style={{ marginTop: 6 }}>
                <button className="qtybtn" onClick={() => onQty(c.key, -1)}>－</button>
                <div style={{ width: 34, textAlign: 'center', fontWeight: 800 }}>{c.qty}</div>
                <button className="qtybtn" onClick={() => onQty(c.key, 1)}>＋</button>
                <div className="spacer" />
                <button className="btn btn-sm" onClick={() => onRemove(c.key)}>削除</button>
              </div>
            </div>
          ))}
        </div>
        <div className="row-between" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 800 }}>合計（税込）</div>
          <div className="mono" style={{ fontWeight: 800, fontSize: 20 }}>{yen(total)}</div>
        </div>
        <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 12 }} onClick={onSubmit} disabled={sending}>
          {sending ? '送信中…' : 'この内容で注文する'}
        </button>
      </div>
    </div>
  );
}

function RecoPanel({ reco, loading, guests, onChangeGuests, onReload, onPick, onAddAll }) {
  if (loading) return <div className="card" style={{ textAlign: 'center' }}>おすすめを考えています…</div>;
  if (!reco) return <div className="card">おすすめを取得できませんでした。<button className="btn btn-sm" onClick={onReload} style={{ marginLeft: 8 }}>再試行</button></div>;
  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="badge b-ai">{reco.engine === 'ai' ? 'AIおすすめ' : 'おすすめ'}</span>
          <span className="muted">{guests || 2}名様 / 現在の時間帯</span>
          <div className="spacer" />
          <button className="btn btn-sm" onClick={onChangeGuests}>人数変更</button>
          <button className="btn btn-sm" onClick={onReload}>更新</button>
        </div>
        <div className="h2" style={{ marginTop: 10, marginBottom: 0, fontSize: 18 }}>{reco.headline}</div>
      </div>

      <div className="grid" style={{ gap: 10 }}>
        {reco.picks.map((p) => (
          <div key={p.id} className="mitem" onClick={() => onPick(p)}>
            <div className="mthumb">{p.item.emoji || '🍽'}</div>
            <div style={{ flex: 1 }}>
              <div className="badge b-reco">{p.reason}</div>
              <div className="mname" style={{ marginTop: 4 }}>{p.item.name}</div>
              <div className="mdesc">{p.item.description}</div>
              <div className="mprice mono">{yen(p.item.price)} × {p.qty}</div>
            </div>
          </div>
        ))}
      </div>

      {reco.picks.length > 0 && (
        <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 14 }} onClick={() => onAddAll(reco.picks)}>
          おすすめをまとめてカートに入れる
        </button>
      )}
    </div>
  );
}

function HistoryPanel({ state }) {
  const items = state?.items || [];
  if (!items.length) return <div className="card" style={{ textAlign: 'center' }} >まだご注文はありません</div>;
  return (
    <div className="card">
      <div className="h2">ご注文内容</div>
      {items.map((i) => (
        <div key={i.id} className="row-between" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
          <div>
            <div style={{ fontWeight: 700 }}>{i.name} × {i.qty}</div>
            {i.options && <div className="muted">{i.options}</div>}
            {i.note && <div className="muted">備考: {i.note}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`badge ${i.status === 'served' ? 'b-green' : i.status === 'ready' ? 'b-blue' : 'b-gray'}`}>{STATUS[i.status]}</span>
            <div className="mono" style={{ fontWeight: 700, marginTop: 4 }}>{yen(i.unit_price * i.qty)}</div>
          </div>
        </div>
      ))}
      <div className="row-between" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800 }}>合計（税込）</div>
        <div className="mono" style={{ fontWeight: 800, fontSize: 20 }}>{yen(state.subtotal)}</div>
      </div>
      {(state.seatCharge > 0 || state.serviceRate > 0) && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.7 }}>
          お会計時に
          {state.seatCharge > 0 && `席料 ${yen(state.seatCharge)}（お一人あたり）`}
          {state.seatCharge > 0 && state.serviceRate > 0 && 'と'}
          {state.serviceRate > 0 && `サービス料 ${state.serviceRate}%`}
          が加算されます。
        </div>
      )}
    </div>
  );
}
