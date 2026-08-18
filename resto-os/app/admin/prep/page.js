'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

/**
 * 仕込みの提案の画面。
 *
 * ねらいは「朝いちばんに開いて、そのまま厨房で使えること」。
 * だから上から順に、多く出る商品から並べる。並びがそのまま作業順になる。
 *
 * この画面がいちばん気をつけているのは **言い切らないこと**。
 * 数量は必ず「26〜34個（目安30個）」の形で出す。
 * ひとつの数字だけを出すと、外れた日にシステムのせいになり、二度と使われなくなる。
 * 幅で出しておけば「今日は上限寄りでいこう」と、人が判断に混ざれる。
 */

const yen = (v) => `${Math.round(Number(v) || 0).toLocaleString('ja-JP')}円`;

const CONF = [
  { min: 60, label: '根拠しっかり', color: '#1f8a4c' },
  { min: 40, label: 'おおよそ', color: '#2f6fed' },
  { min: 0, label: '参考程度', color: '#c79a1f' },
];

function confOf(pct) {
  return CONF.find((c) => (Number(pct) || 0) >= c.min) || CONF[2];
}

/** 1商品ぶんの行。根拠は畳んでおき、押したときだけ開く */
function Line({ line, seeCost }) {
  const [open, setOpen] = useState(false);
  const c = confOf(line.confidencePct);

  return (
    <>
      <tr>
        <td>
          {line.name}
          {line.soldOut && <span className="badge b-out" style={{ marginLeft: 6 }}>売り切れ中</span>}
          {line.station && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{line.station}</span>}
        </td>
        <td className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{line.qty}</td>
        <td className="mono muted">{line.low}〜{line.high}</td>
        <td>
          <span className="badge" style={{ background: c.color, color: '#fff' }}>{c.label}</span>
        </td>
        <td className="muted" style={{ fontSize: 12 }}>{line.basisLabel}</td>
        <td>
          <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? '閉じる' : '根拠'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: '#f7f9fc' }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              お客さま1人あたり {line.perGuest} 個ぶん出ています。これに明日の見込み客数を掛けています。
              {seeCost && line.cost ? `／原価 ${yen(line.cost)}・売価 ${yen(line.price || 0)}` : ''}
            </div>
            <table className="table">
              <thead><tr><th>日付</th><th className="mono">出た数</th><th className="mono">その日の客数</th></tr></thead>
              <tbody>
                {line.dates.map((d) => (
                  <tr key={d.date}>
                    <td className="mono">{d.date}</td>
                    <td className="mono">{d.qty}</td>
                    <td className="mono">{d.guests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export default function PrepPage() {
  const [data, setData] = useState(null);
  const [date, setDate] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (d) => {
    setBusy(true);
    setErr('');
    try {
      const q = d ? `?date=${encodeURIComponent(d)}` : '';
      const r = await fetch(`/api/prep${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || '読み込めませんでした');
      setData(j);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(''); }, [load]);

  const detect = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detect' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || '点検できませんでした');
      await load(date);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const p = data?.plan;

  return (
    <>
      <Nav />
      <div className="wrap">
        <h1 className="h1">今日の仕込み</h1>
        <p className="muted" style={{ marginTop: -6 }}>
          明日の見込み客数と、これまでの出方から「どれをどれだけ用意しておくか」を出します。
          ここに出る数はすべて<b>見込み</b>です。実績ではありません。最後は必ず人が決めてください。
        </p>

        <div className="card">
          <div className="row wrapflex" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div>
              <div className="lbl">いつのぶんか</div>
              <input
                className="input" type="date" value={date}
                onChange={(e) => { setDate(e.target.value); load(e.target.value); }}
                style={{ width: 170 }}
              />
            </div>
            <button className="btn" onClick={() => { setDate(''); load(''); }} disabled={busy}>
              明日のぶんに戻す
            </button>
            {data?.canOrder && (
              <a className="btn" href="/admin/inventory">材料と発注へ</a>
            )}
          </div>
        </div>

        {err && <div className="alert">{err}</div>}

        {p && !p.ok && (
          <div className="card">
            <h2 className="h2">まだ出せません</h2>
            <p>{p.message}</p>
            {p.needDays > 0 && (
              <p className="muted">
                いまの記録は{p.haveDays}日ぶんです。{p.needDays}日ぶんたまると出せるようになります。
                「導入したばかりなのに、それらしい数字を出す」ことはしません。
              </p>
            )}
          </div>
        )}

        {p && p.ok && (
          <>
            <div className="card" style={{ borderLeft: '4px solid #2f6fed' }}>
              <div className="row row-between wrapflex" style={{ alignItems: 'center' }}>
                <div>
                  <h2 className="h2" style={{ margin: 0 }}>
                    {p.date}（{p.dow}）の見込み
                  </h2>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                    お客さま {p.guests.value}人
                    <span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 8 }}>
                      （{p.guests.low}〜{p.guests.high}人）
                    </span>
                  </div>
                </div>
                <span className="badge b-gray">根拠の強さ {p.guests.confidence}</span>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>{p.advice}</p>
            </div>

            <div className="card">
              <h2 className="h2">用意する数（{p.totalItems}品のうち上から{p.lines.length}品）</h2>
              <div style={{ overflowX: 'auto' }}>
                <table className="table table-wide">
                  <thead>
                    <tr>
                      <th>商品</th><th className="mono">目安</th><th className="mono">幅</th>
                      <th>根拠の強さ</th><th>何を見たか</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((l) => <Line key={l.name} line={l} seeCost={data.seeCost} />)}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                日もちしない物は目安どおり、日もちする物は幅の上寄りにしておくと、欠品も廃棄も減らしやすくなります。
              </p>
            </div>

            {p.skipped.length > 0 && (
              <div className="card">
                <h2 className="h2">まだ提案を出さない商品（{p.skipped.length}品）</h2>
                <p className="muted" style={{ fontSize: 12 }}>
                  記録が少ないうちに数字を出すと、当てずっぽうになります。たまるまで出しません。
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead><tr><th>商品</th><th>理由</th></tr></thead>
                    <tbody>
                      {p.skipped.map((s) => (
                        <tr key={s.name}><td>{s.name}</td><td className="muted">{s.message}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {data?.stockouts && (
          <div className="card">
            <div className="row row-between wrapflex" style={{ alignItems: 'center' }}>
              <h2 className="h2" style={{ margin: 0 }}>売り逃していそうな商品（直近30日）</h2>
              <button className="btn btn-sm" onClick={detect} disabled={busy}>いま点検する</button>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              ふだんの同じ曜日と比べて、極端に出数が少なかった日を拾っています。
              <b>ここの金額は推測です。</b>実際に売り逃した額そのものではありません
              （人気が落ちただけ、その日だけ出していなかった、ということもあります）。
            </p>
            {data.stockouts.rows.length === 0 ? (
              <p className="muted">いまのところ、目立つものはありません。</p>
            ) : (
              <>
                <div style={{ marginBottom: 8 }}>
                  合計の見込み <b className="mono">{yen(data.stockouts.total)}</b>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table table-wide">
                    <thead>
                      <tr>
                        <th>日付</th><th>商品</th><th className="mono">ふだん</th>
                        <th className="mono">その日</th><th className="mono">見込み額</th><th className="mono">比べた日数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.stockouts.rows.map((r, i) => (
                        <tr key={`${r.date}-${r.name}-${i}`}>
                          <td className="mono">{r.date}</td>
                          <td>{r.name}</td>
                          <td className="mono muted">{r.usual_qty}</td>
                          <td className="mono">{r.actual_qty}</td>
                          <td className="mono">{yen(r.est_loss)}</td>
                          <td className="mono muted">{r.sample_days}日</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {data?.waste && data.waste.items.length > 0 && (
          <div className="card">
            <h2 className="h2">捨てたもの（直近30日）</h2>
            <p className="muted" style={{ fontSize: 12 }}>
              廃棄として入力があった日だけを見ています（未入力の日を0として数えると、実際より小さく見えるため）。
            </p>
            <div style={{ marginBottom: 8 }}>合計 <b className="mono">{yen(data.waste.total)}</b></div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>材料</th><th className="mono">量</th><th className="mono">金額</th></tr></thead>
                <tbody>
                  {data.waste.items.slice(0, 15).map((w) => (
                    <tr key={w.name}>
                      <td>{w.name}</td>
                      <td className="mono">{Math.round(w.qty * 10) / 10}{w.unit}</td>
                      <td className="mono">{yen(w.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
