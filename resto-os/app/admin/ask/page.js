'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

/**
 * 言葉で聞ける検索の画面。
 *
 * ねらいは「思いついたときに、その場で確かめられること」。
 * 表やグラフを探して回らなくても、日本語で書けば答えが返る。
 *
 * この画面がいちばん気をつけているのは **根拠を隠さないこと**。
 * 答えの下には、必ず「何日を見たのか」「その日は実際いくらだったのか」を並べる。
 * 数字だけを信じてもらうのではなく、確かめられる形で渡す。
 */

const yen = (v) => `${Math.round(Number(v) || 0).toLocaleString('ja-JP')}円`;

const STRENGTH = {
  none: { label: '該当なし', color: '#7a8699' },
  weak: { label: '根拠が薄い', color: '#c76a1f' },
  thin: { label: '参考程度', color: '#c79a1f' },
  ok: { label: 'おおよそ確か', color: '#2f6fed' },
  good: { label: '確かめられる', color: '#1f8a4c' },
};

/** 根拠の折りたたみ。ここを開くと、答えのもとになった日が全部見える */
function Basis({ b, seeCost }) {
  const [open, setOpen] = useState(false);
  if (!b) return null;
  const st = STRENGTH[b.strength] || STRENGTH.none;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row wrapflex" style={{ gap: 6, alignItems: 'center' }}>
        <span className="badge" style={{ background: st.color, color: '#fff' }}>{st.label}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          調べた期間 {b.period.from} 〜 {b.period.to}
          {b.period.guessed ? '（指定が無かったので直近90日）' : ''}
          ／営業日 {b.daysInPeriod}日のうち {b.matchedDays}日が条件に一致
        </span>
        {b.dates?.length > 0 && (
          <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? '根拠を閉じる' : `根拠の${b.dates.length}日を見る`}
          </button>
        )}
      </div>

      {b.conditions?.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          絞り込み：{b.conditions.join(' / ')}
        </div>
      )}

      {open && (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="table table-wide">
            <thead>
              <tr>
                <th>日付</th><th>曜日</th><th className="mono">売上</th><th className="mono">客数</th>
                <th className="mono">客単価</th>{seeCost && <th className="mono">粗利</th>}
                <th>天気</th><th>その日のこと</th>
              </tr>
            </thead>
            <tbody>
              {b.dates.map((d) => (
                <tr key={d.date}>
                  <td className="mono">{d.date}</td>
                  <td>{d.dow}</td>
                  <td className="mono">{yen(d.sales)}</td>
                  <td className="mono">{d.guests}</td>
                  <td className="mono">{yen(d.avgSpend)}</td>
                  {seeCost && <td className="mono">{d.profit === null ? '—' : yen(d.profit)}</td>}
                  <td>{d.weather || '記録なし'}{d.tempMax !== null && d.tempMax !== undefined ? ` ${Math.round(d.tempMax)}度` : ''}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {[d.holiday, ...(d.events || [])].filter(Boolean).join('／') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && b.items?.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="table table-wide">
            <thead>
              <tr><th>商品</th><th>分類</th><th className="mono">出た数</th><th className="mono">売上</th>{seeCost && <th className="mono">粗利</th>}</tr>
            </thead>
            <tbody>
              {b.items.map((it) => (
                <tr key={it.name}>
                  <td>{it.name}</td>
                  <td className="muted">{it.category || '—'}</td>
                  <td className="mono">{it.qty}</td>
                  <td className="mono">{yen(it.sales)}</td>
                  {seeCost && <td className="mono">{it.profit === null ? '—' : yen(it.profit)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AnswerCard({ r, seeCost }) {
  return (
    <div className="card" style={{ marginTop: 10, borderLeft: '4px solid #2f6fed' }}>
      <div style={{ fontWeight: 800 }}>Q. {r.question}</div>
      <pre style={{
        marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: '#f7f8fb', padding: 12, borderRadius: 8, lineHeight: 1.9, fontSize: 13,
      }}>{r.answer}</pre>
      <Basis b={r.basis} seeCost={seeCost} />
      {r.createdAt && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          {String(r.createdAt).slice(0, 16).replace('T', ' ')}
          {r.staffName ? `／${r.staffName}` : ''}
        </div>
      )}
    </div>
  );
}

export default function Ask() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [latest, setLatest] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/ask').then((x) => x.json());
    if (r.ok) setData(r);
    else setData({ ok: false, error: r.error });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function ask(text) {
    const question = String(text ?? q).trim();
    if (!question || busy) return;
    setBusy(true);
    setMsg('');
    setLatest(null);
    try {
      const r = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      }).then((x) => x.json());
      if (r.ok) {
        setLatest(r);
        setQ('');
        await load();
      } else {
        setMsg(r.error || '答えられませんでした');
      }
    } catch {
      setMsg('通信に失敗しました。もう一度お試しください。');
    }
    setBusy(false);
  }

  if (!data) return (<><Nav /><div className="wrap"><div className="muted">読み込んでいます…</div></div></>);
  if (!data.ok) return (<><Nav /><div className="wrap"><div className="alert">{data.error}</div></div></>);

  // いま出した答えは上に大きく出しているので、履歴では二重に出さない
  const past = latest ? data.rows.slice(1) : data.rows;

  return (
    <>
      <Nav />
      <div className="wrap">
        <div className="h1" style={{ marginTop: 10 }}>言葉で聞ける検索</div>
        <div className="muted" style={{ marginBottom: 14, lineHeight: 1.8 }}>
          知りたいことを、ふだんの言葉で書いてください。<br />
          答えの数字は、この店に実際に残っている記録から数えたものだけです。
          <b>AIが数字を作ることはありません。</b>答えの下の「根拠を見る」を開けば、
          もとになった日を1日ずつ確かめられます。
        </div>

        <div className="card">
          <div className="row wrapflex" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ flex: '1 1 320px' }}
              placeholder="例：先月の雨の土曜、どうだった？"
              value={q}
              maxLength={200}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
            />
            <button className="btn btn-primary" disabled={busy || !q.trim()} onClick={() => ask()}>
              {busy ? '調べています…' : '聞いてみる'}
            </button>
          </div>

          <div className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 6 }}>
            そのまま押せる質問：
          </div>
          <div className="row wrapflex" style={{ gap: 6 }}>
            {(data.examples || []).map((e) => (
              <button key={e} className="btn btn-sm" disabled={busy} onClick={() => ask(e)}>{e}</button>
            ))}
          </div>

          <div className="muted" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.8 }}>
            使える言い回し：期間（先月・今月・先週・去年の8月・直近30日）／
            曜日（土曜・平日・週末）／天気（雨・晴れ・暑い日・寒い日）／
            暦（祝日・連休・給料日・月末）／
            知りたいこと（売上・客数・客単価{data.seeCost ? '・粗利' : ''}）／
            聞き方（いちばん売れた日は？・よく出た商品は？）
          </div>
        </div>

        {msg && <div className="alert" style={{ marginTop: 12 }}>{msg}</div>}

        {latest && (
          <>
            <div className="h2" style={{ marginTop: 20 }}>答え</div>
            <AnswerCard r={latest} seeCost={data.seeCost} />
          </>
        )}

        <div className="h2" style={{ marginTop: 24 }}>これまでに聞いたこと</div>
        {past.length === 0 ? (
          <div className="card muted" style={{ marginTop: 10 }}>
            {latest ? '過去の記録はここに並びます。' : 'まだ何も聞かれていません。上の例をひとつ押してみてください。'}
          </div>
        ) : (
          past.map((r) => <AnswerCard key={r.id} r={r} seeCost={data.seeCost} />)
        )}
      </div>
    </>
  );
}
