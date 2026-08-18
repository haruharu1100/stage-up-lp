'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

/**
 * 朝と閉店後のレポートの画面。
 *
 * この画面のねらいは「この画面を見なくてよくすること」。
 * 宛先をいちど登録すれば、あとは毎朝ひとりでにLINEへ届く。
 * ここに来るのは、宛先を変えるときと、過去のぶんを読み返すときだけでよい。
 */

const KIND_LABEL = { morning: '朝のレポート', night: '閉店後のレポート' };

function fmtDate(d) {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  const dow = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return `${m}/${dd}(${dow})`;
}

/** 1件ぶんの表示。中身はそのまま出す（送った文章と画面の文章が食い違わないように） */
function ReportCard({ r, onResend, busy }) {
  const [open, setOpen] = useState(false);
  const night = r.kind === 'night';
  return (
    <div className="card" style={{ marginTop: 10, borderLeft: `4px solid ${night ? '#7a8699' : '#2f6fed'}` }}>
      <div className="row row-between wrapflex" style={{ gap: 8 }}>
        <div>
          <span className="badge b-gray">{fmtDate(r.date)}</span>{' '}
          <b style={{ marginLeft: 6 }}>{KIND_LABEL[r.kind] || r.kind}</b>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {r.delivered
            ? <span className="badge b-green">LINEに届きました</span>
            : <span className="badge b-out">未送信</span>}
          <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? '閉じる' : '全文を読む'}
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => onResend(r.id)}>送る</button>
        </div>
      </div>
      {!r.delivered && r.error && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>送られなかった理由：{r.error}</div>
      )}
      {open && (
        <pre style={{
          marginTop: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          background: '#f7f8fb', padding: 12, borderRadius: 8, lineHeight: 1.8, fontSize: 13,
        }}>{r.body}</pre>
      )}
    </div>
  );
}

export default function Reports() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/reports').then((x) => x.json());
    if (r.ok) {
      setData(r);
      setForm(r.settings);
    } else {
      setData({ ok: false, error: r.error });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function say(t) {
    setMsg(t);
    setTimeout(() => setMsg(''), 5000);
  }

  async function post(body) {
    if (busy) return null;
    setBusy(true);
    try {
      const r = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((x) => x.json());
      await load();
      return r;
    } finally {
      setBusy(false);
    }
  }

  if (!data) return (<div><Nav /><div className="wrap"><div className="muted">読み込み中…</div></div></div>);
  if (data.ok === false) return (<div><Nav /><div className="wrap"><div className="alert">{data.error}</div></div></div>);

  const s = form || {};
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1" style={{ marginTop: 10 }}>朝と閉店後のレポート</div>
        <div className="muted" style={{ marginBottom: 16, lineHeight: 1.8 }}>
          その日に知っておきたいことを短くまとめて、LINEに送ります。
          この画面を毎日開く必要はありません。宛先をいちど登録すれば、あとはひとりでに届きます。<br />
          文章の中では「実績（実際に起きたこと）」と「見込み（AIの推測）」を見出しで分けています。
        </div>

        {msg && <div className="alert" style={{ marginBottom: 12 }}>{msg}</div>}

        {/* ===== 届け先の設定 ===== */}
        <div className="card">
          <div className="h2">届け先</div>

          {!data.lineReady && (
            <div className="alert" style={{ marginTop: 10 }}>
              LINEに送るための鍵がまだ設定されていません。設定が済むまで、レポートは
              <b>この画面に保存されるだけ</b>になります（内容は毎日きちんと作られます）。
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div className="lbl">LINEの宛先ID</div>
            <input
              className="input"
              value={s.report_line_to || ''}
              placeholder="Uから始まるID、またはCから始まるグループID"
              onChange={(e) => set('report_line_to', e.target.value.trim())}
            />
            <div className="muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.7 }}>
              お店のLINE公式アカウントに、受け取る人が友だち登録すると発行されるIDです。
              グループに送りたい場合はグループのIDを入れてください。
            </div>
          </div>

          <div className="grid g2" style={{ marginTop: 16 }}>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={s.report_morning === '1'}
                onChange={(e) => set('report_morning', e.target.checked ? '1' : '0')}
              />
              <span>朝のレポートを送る（毎朝11時ごろ）</span>
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={s.report_night === '1'}
                onChange={(e) => set('report_night', e.target.checked ? '1' : '0')}
              />
              <span>閉店後のレポートを作る</span>
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={s.report_night_send === '1'}
                onChange={(e) => set('report_night_send', e.target.checked ? '1' : '0')}
              />
              <span>閉店後のぶんもすぐ送る（深夜3時ごろに届きます）</span>
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={s.report_profit === '1'}
                onChange={(e) => set('report_profit', e.target.checked ? '1' : '0')}
              />
              <span>原価・粗利も文章に入れる</span>
            </label>
          </div>

          <div className="muted" style={{ marginTop: 10, fontSize: 12, lineHeight: 1.7 }}>
            ・閉店後のぶんは、初めは<b>送らずに保存だけ</b>します。深夜に通知が鳴らないようにするためです。
            送らない設定のままでも、その日の結果は翌朝のレポートに必ず入ります。<br />
            ・原価・粗利は初めは<b>入れません</b>。LINEは誰の目に触れるか分からないためです。
          </div>

          <div className="row wrapflex" style={{ gap: 8, marginTop: 16 }}>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                const r = await post({ action: 'settings', settings: form });
                say(r?.ok ? '設定を保存しました。' : `保存できませんでした：${r?.error || ''}`);
              }}
            >設定を保存</button>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                const r = await post({ action: 'test' });
                say(r?.ok ? 'テストの1通を送りました。LINEをご確認ください。' : `送れませんでした：${r?.error || ''}`);
              }}
            >テストで1通送ってみる</button>
          </div>
        </div>

        {/* ===== いま作る ===== */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="h2">いま作る</div>
          <div className="muted" style={{ marginTop: 4 }}>
            ふだんは自動で作られます。内容を今すぐ確かめたいときだけ使ってください。
          </div>
          <div className="row wrapflex" style={{ gap: 8, marginTop: 12 }}>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                const r = await post({ action: 'run', kind: 'morning', send: false });
                say(r?.ok ? '朝のレポートを作りました（送信はしていません）。' : `作れませんでした：${r?.error || ''}`);
              }}
            >朝のレポートを作る</button>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                const r = await post({ action: 'run', kind: 'night', send: false });
                say(r?.ok ? '閉店後のレポートを作りました（送信はしていません）。' : `作れませんでした：${r?.error || ''}`);
              }}
            >閉店後のレポートを作る</button>
          </div>
        </div>

        {/* ===== これまでのレポート ===== */}
        <div className="h2" style={{ marginTop: 24 }}>これまでのレポート</div>
        {data.rows.length === 0 ? (
          <div className="card" style={{ marginTop: 10 }}>
            <div className="muted">まだ1件もありません。上の「いま作る」で内容を確かめられます。</div>
          </div>
        ) : data.rows.map((r) => (
          <ReportCard
            key={r.id}
            r={r}
            busy={busy}
            onResend={async (id) => {
              const res = await post({ action: 'resend', id });
              say(res?.ok ? 'LINEに送りました。' : `送れませんでした：${res?.error || ''}`);
            }}
          />
        ))}
      </div>
    </div>
  );
}
