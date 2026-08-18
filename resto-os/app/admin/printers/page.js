'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

/**
 * プリンターの設定画面。
 *
 * 店の人がやることは「プリンターの設定画面に、ここに出ているURLを1本コピーして入れる」だけ。
 * パソコンも常駐ソフトもいらない。うまくいっているかは、この画面の「最終応答」と
 * テスト印刷の1枚で確かめられるようにしてある。
 */

const STATION_CHOICES = [
  ['kitchen', '厨房'],
  ['drink', 'ドリンク場'],
  ['grill', '焼き場'],
  ['sashimi', '刺場'],
  ['dessert', 'デザート'],
];

const NEW = {
  name: '', kind: 'receipt', width: 80, encoding: 'utf8',
  stations: '', copies: 1, drawer: 0, buzzer: 0, active: 1,
};

function ago(iso) {
  if (!iso) return null;
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(s)) return null;
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}

export default function Printers() {
  const [list, setList] = useState(null);
  const [draft, setDraft] = useState(null); // 追加・編集中のもの
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [origin, setOrigin] = useState('');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/printers').then((x) => x.json());
    if (r.ok) setList(r.printers);
  }, []);

  useEffect(() => { load(); }, [load]);
  // つながったかどうかを、画面を開いたまま確かめられるように定期的に読み直す
  useEffect(() => {
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  function say(text) {
    setMsg(text);
    setTimeout(() => setMsg(''), 4000);
  }

  async function send(method, body, params = '') {
    if (busy) return null;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/printers${params}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      }).then((x) => x.json());
      if (!r.ok) { alert(r.error); return null; }
      await load();
      return r;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const d = draft;
    if (!d.name.trim()) return alert('プリンターの名前を入れてください');
    const r = await send(d.id ? 'PATCH' : 'POST', d);
    if (r) { setDraft(null); say('保存しました'); }
  }

  async function test(p) {
    const r = await send('PATCH', { id: p.id, action: 'test' });
    if (r) say(r.message || 'テスト印刷を送りました');
  }

  async function retry(p) {
    const r = await send('PATCH', { id: p.id, action: 'retry' });
    if (r) say(`${r.retried}枚を出し直します`);
  }

  async function regenerate(p) {
    if (!confirm(`「${p.name}」のURLを作り直します。\nプリンター側の設定も新しいURLに入れ直す必要があります。よろしいですか？`)) return;
    const r = await send('PATCH', { id: p.id, action: 'regenerate' });
    if (r) say('新しいURLを発行しました。プリンターに入れ直してください');
  }

  async function remove(p) {
    if (!confirm(`「${p.name}」を削除します。よろしいですか？`)) return;
    const r = await send('DELETE', null, `?id=${p.id}`);
    if (r) say('削除しました');
  }

  function copy(url) {
    navigator.clipboard?.writeText(url).then(() => say('URLをコピーしました'), () => {});
  }

  if (!list) return (<div><Nav /><div className="wrap"><div className="muted">読み込み中…</div></div></div>);

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">レシートプリンター</div>
        <div className="muted">
          会計のレシートと、厨房への注文票を紙で出します。
          パソコンや常駐ソフトは要りません。プリンターの設定画面に、下のURLを1本入れるだけで使えます。
        </div>

        <div className="card" style={{ marginTop: 14, background: '#fafbfc' }}>
          <div className="h2">はじめかた（3ステップ）</div>
          <ol style={{ lineHeight: 2, margin: '8px 0 0 18px' }}>
            <li>プリンターを店のWi-Fi（または有線LAN）につなぎ、電源を入れます。</li>
            <li>プリンターの設定画面を開き、「CloudPRNT」を<b>有効</b>にして、下の<b>専用URL</b>を貼り付けます。</li>
            <li>この画面の「最終応答」が<b>数秒前</b>になったら成功です。<b>テスト印刷</b>を押して1枚出してください。</li>
          </ol>
          <div className="muted" style={{ marginTop: 8 }}>
            紙は<b>80mm幅（1行48文字）</b>が飲食店の標準です。58mm幅は横に狭く、品名が途中で切れやすいのでおすすめしません。
          </div>
        </div>

        {msg && (
          <div className="card" style={{ marginTop: 12, borderColor: 'var(--green)', color: 'var(--green)', fontWeight: 700 }}>
            {msg}
          </div>
        )}

        {list.length === 0 && !draft && (
          <div className="card" style={{ marginTop: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 38 }}>🖨️</div>
            <div style={{ fontWeight: 700, marginTop: 6 }}>まだプリンターが登録されていません</div>
            <div className="muted" style={{ marginTop: 6 }}>
              プリンターが無くても、会計・注文はそのまま使えます（画面のレシートを印刷することもできます）。
            </div>
          </div>
        )}

        {list.map((p) => {
          const url = `${origin}/api/print/${p.token}`;
          const seen = ago(p.lastSeenAt);
          const alive = p.lastSeenAt && Date.now() - new Date(p.lastSeenAt).getTime() < 120000;
          return (
            <div key={p.id} className="card" style={{ marginTop: 14, opacity: p.active ? 1 : 0.6 }}>
              <div className="row-between" style={{ alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 800, fontSize: 18 }}>{p.name}</span>
                  <span className="muted" style={{ marginLeft: 10 }}>
                    {p.kind === 'kitchen' ? '厨房の注文票' : '会計レシート'} ／ {p.width}mm幅
                    {p.kind === 'kitchen' && `／受け持ち：${p.stations
                      ? p.stations.split(',').map((s) => STATION_CHOICES.find((c) => c[0] === s)?.[1] || s).join('・')
                      : 'すべて'}`}
                    {!p.active && '／使用しない'}
                  </span>
                </div>
                <div style={{ fontWeight: 700, color: alive ? 'var(--green)' : '#999' }}>
                  {seen ? `● 最終応答 ${seen}` : '○ まだ一度もつながっていません'}
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <label className="field">プリンターに設定する専用URL</label>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input mono" readOnly value={url} onFocus={(e) => e.target.select()} />
                  <button className="btn" onClick={() => copy(url)}>コピー</button>
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  このURLは、このプリンター1台だけの鍵です。他のお店の伝票は1枚も出せません。人に見せないでください。
                </div>
              </div>

              {(p.waiting > 0 || p.failed > 0) && (
                <div className="muted" style={{ marginTop: 10 }}>
                  印刷待ち {p.waiting}枚{p.failed > 0 && `／出せなかった伝票 ${p.failed}枚`}
                  {p.lastStatus && `／プリンターの状態：${p.lastStatus}`}
                </div>
              )}

              <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" disabled={busy} onClick={() => test(p)}>テスト印刷</button>
                <button className="btn" disabled={busy} onClick={() => setDraft({ ...p, drawer: p.drawer ? 1 : 0, buzzer: p.buzzer ? 1 : 0, active: p.active ? 1 : 0 })}>設定を変える</button>
                {p.failed > 0 && <button className="btn" disabled={busy} onClick={() => retry(p)}>出せなかった分を出し直す</button>}
                <button className="btn" disabled={busy} onClick={() => regenerate(p)}>URLを作り直す</button>
                <button className="btn" disabled={busy} onClick={() => remove(p)} style={{ marginLeft: 'auto', color: 'var(--red)' }}>削除</button>
              </div>
            </div>
          );
        })}

        {draft ? (
          <div className="card" style={{ marginTop: 14, borderColor: 'var(--blue)' }}>
            <div className="h2">{draft.id ? 'プリンターの設定' : 'プリンターを追加'}</div>
            <div className="grid g4" style={{ marginTop: 10 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="field">名前（どこに置くか分かる名前に）</label>
                <input className="input" value={draft.name} placeholder="レジ／焼き場" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <label className="field">用途</label>
                <select className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                  <option value="receipt">会計レシート</option>
                  <option value="kitchen">厨房の注文票</option>
                </select>
              </div>
              <div>
                <label className="field">用紙幅</label>
                <select className="input" value={draft.width} onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })}>
                  <option value={80}>80mm（推奨・1行48文字）</option>
                  <option value={58}>58mm（1行35文字）</option>
                </select>
              </div>
            </div>

            {draft.kind === 'kitchen' && (
              <div style={{ marginTop: 12 }}>
                <label className="field">受け持つ場所（何も選ばなければ、すべての注文票がこの1台に出ます）</label>
                <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
                  {STATION_CHOICES.map(([v, label]) => {
                    const cur = draft.stations ? draft.stations.split(',').filter(Boolean) : [];
                    const on = cur.includes(v);
                    return (
                      <label key={v} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const next = on ? cur.filter((x) => x !== v) : [...cur, v];
                            setDraft({ ...draft, stations: next.join(',') });
                          }}
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid g4" style={{ marginTop: 12 }}>
              <div>
                <label className="field">枚数（同じ紙を何枚出すか）</label>
                <select className="input" value={draft.copies} onChange={(e) => setDraft({ ...draft, copies: Number(e.target.value) })}>
                  <option value={1}>1枚</option>
                  <option value={2}>2枚（控え用）</option>
                  <option value={3}>3枚</option>
                </select>
              </div>
              <div>
                <label className="field">文字コード（文字化けしたら切り替える）</label>
                <select className="input" value={draft.encoding} onChange={(e) => setDraft({ ...draft, encoding: e.target.value })}>
                  <option value="utf8">標準（UTF-8）</option>
                  <option value="sjis">日本語（Shift_JIS）</option>
                </select>
              </div>
              <div style={{ gridColumn: 'span 2', display: 'flex', gap: 18, alignItems: 'flex-end', paddingBottom: 8 }}>
                {draft.kind === 'receipt' && (
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={draft.drawer === 1} onChange={(e) => setDraft({ ...draft, drawer: e.target.checked ? 1 : 0 })} />
                    レジの引き出しを開ける
                  </label>
                )}
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={draft.buzzer === 1} onChange={(e) => setDraft({ ...draft, buzzer: e.target.checked ? 1 : 0 })} />
                  出たときにブザーを鳴らす
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={draft.active === 1} onChange={(e) => setDraft({ ...draft, active: e.target.checked ? 1 : 0 })} />
                  使用する
                </label>
              </div>
            </div>

            <div className="row" style={{ marginTop: 14, gap: 10 }}>
              <button className="btn btn-primary btn-lg" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存する'}</button>
              <button className="btn" disabled={busy} onClick={() => setDraft(null)}>やめる</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-lg" onClick={() => setDraft({ ...NEW })}>＋ プリンターを追加する</button>
          </div>
        )}

        <div className="card" style={{ marginTop: 18, background: '#fafbfc' }}>
          <div className="h2">うまく出ないとき</div>
          <ul style={{ lineHeight: 2, margin: '6px 0 0 18px' }}>
            <li><b>1枚も出ない</b>：最終応答が「まだ一度もつながっていません」なら、URLの入れ間違いか、プリンターがネットにつながっていません。</li>
            <li><b>日本語が記号だらけになる</b>：文字コードを「日本語（Shift_JIS）」に切り替えて、もう一度テスト印刷してください。</li>
            <li><b>紙が切れて止まった</b>：紙を入れ直すと、待っていた伝票がそのまま出てきます。消えません。</li>
            <li><b>行末がガタつく／品名が切れる</b>：用紙幅の設定と、実際の紙の幅が違っています。</li>
          </ul>
          <div className="muted" style={{ marginTop: 8 }}>
            印刷が失敗しても、注文や会計そのものは失われません。伝票は待ち行列に残り、直せばそのまま出てきます。
          </div>
        </div>
      </div>
    </div>
  );
}
