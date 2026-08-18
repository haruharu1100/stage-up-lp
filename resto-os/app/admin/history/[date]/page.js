'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Nav from '../../../../components/Nav';

/**
 * その日1日の全部を見る画面。
 *
 * 上半分は「実際に起きたこと」、下の出来事だけが人の手で書き足すところ。
 * 予報（前もって出ていた天気）と実績（実際の天気）は、混ざらないように別々に出す。
 */

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const num = (n) => Number(n || 0).toLocaleString();
const PAY = { cash: '現金', credit: 'クレジット', qr: 'QR決済', emoney: '電子マネー・交通系IC', other: 'その他' };
const SLOT = { am6: '朝6時の予報', am11: '昼11時の予報', pm16: '夕16時の予報' };
const KINDS = [
  ['reserved', '貸切・団体'],
  ['media', '取材・掲載'],
  ['buzz', 'SNSで話題'],
  ['newmenu', '新メニュー'],
  ['pricing', '価格の変更'],
  ['nearby', '近所の催し'],
  ['trouble', 'トラブル・設備'],
  ['other', 'その他'],
];
const IMPACTS = [['up', '売上が伸びた'], ['down', '売上が落ちた'], ['unknown', '影響はわからない']];

const shift = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export default function DayDetail() {
  const { date } = useParams();
  const router = useRouter();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [ev, setEv] = useState({ kind: 'other', title: '', detail: '', impact: 'unknown' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/history?view=day&date=${date}`).then((x) => x.json());
    if (!r.ok) return setErr(r.error || '読み込めませんでした');
    setErr('');
    setD(r);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function addEvent() {
    if (!ev.title.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/history/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, ...ev }),
      }).then((x) => x.json());
      if (!r.ok) return alert(r.error);
      setEv({ kind: 'other', title: '', detail: '', impact: 'unknown' });
      load();
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(id) {
    if (!confirm('この出来事の登録を消しますか？')) return;
    const r = await fetch(`/api/history/events?id=${id}`, { method: 'DELETE' }).then((x) => x.json());
    if (!r.ok) return alert(r.error);
    load();
  }

  if (err) return (<div><Nav /><div className="wrap"><div className="alert">{err}</div></div></div>);
  if (!d) return (<div><Nav /><div className="wrap"><div className="muted">読み込み中…</div></div></div>);

  const day = d.day;
  const seeCost = d.canSeeCost;
  const maxHour = Math.max(1, ...d.hours.map((h) => h.sales));

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="row wrapflex" style={{ gap: 8, alignItems: 'center' }}>
          <Link className="btn btn-sm" href="/admin/history">← 一覧にもどる</Link>
          <button className="btn btn-sm" onClick={() => router.push(`/admin/history/${shift(date, -1)}`)}>前の日</button>
          <button className="btn btn-sm" onClick={() => router.push(`/admin/history/${shift(date, 1)}`)}>次の日</button>
        </div>

        <div className="h1" style={{ marginTop: 10 }}>
          {date}（{day.dowName}）{day.holiday && <span className="badge b-green" style={{ marginLeft: 8 }}>{day.holiday}</span>}
          {day.source === 'import' && <span className="badge b-gray" style={{ marginLeft: 8 }}>取り込んだ過去データ</span>}
          {!day.closed && day.source !== 'import' && <span className="badge b-out" style={{ marginLeft: 8 }}>レジ締め前</span>}
        </div>
        <div className="muted">{day.dayLabel}</div>

        {/* ── その日の数字 ─────────────────────── */}
        <div className="card" style={{ marginTop: 14 }}>
          <div className="grid g4">
            <Stat label="売上" value={yen(day.sales)} big />
            <Stat label="客数" value={`${num(day.guests)}名`} big />
            <Stat label="客単価" value={yen(day.avgSpend)} big />
            <Stat label="会計数" value={`${num(day.checks)}件`} big />
          </div>
          <div className="grid g4" style={{ marginTop: 14 }}>
            <Stat label="注文の数" value={`${num(day.orders)}件`} />
            <Stat label="出た品数" value={`${num(day.qty)}点`} />
            <Stat label="値引の合計" value={yen(day.discount)} />
            <Stat label="回転数" value={day.turnover ? `${day.turnover}回` : '—'} />
          </div>
          <div className="grid g4" style={{ marginTop: 14 }}>
            <Stat label="取消（数・金額）" value={`${num(day.voidCount)}件 / ${yen(day.voidTotal)}`} />
            <Stat label="平均のお出しまでの時間" value={day.serveMin ? `${Math.round(day.serveMin)}分` : '—'} />
            {seeCost && <Stat label="原価" value={yen(day.cost)} />}
            {seeCost && <Stat label="粗利" value={yen(day.profit)} />}
          </div>
        </div>

        {/* ── くらべる ─────────────────────────── */}
        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">同じ曜日とくらべる</div>
          <table className="table" style={{ marginTop: 8 }}>
            <thead><tr><th>いつ</th><th>営業日</th><th style={{ textAlign: 'right' }}>売上</th><th style={{ textAlign: 'right' }}>差</th><th style={{ textAlign: 'right' }}>くらべた割合</th></tr></thead>
            <tbody>
              {d.compare.map((c) => (
                <tr key={c.date}>
                  <td>{c.label}</td>
                  <td><Link className="mono" href={`/admin/history/${c.date}`}>{c.date}</Link></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{c.sales === null ? '記録なし' : num(c.sales)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: c.diff > 0 ? 'var(--green)' : c.diff < 0 ? 'var(--red)' : '' }}>
                    {c.diff === null ? '—' : `${c.diff > 0 ? '+' : ''}${num(c.diff)}`}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{c.ratio === null ? '—' : `${c.ratio}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── 天気 ─────────────────────────────── */}
        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">この日の天気</div>
          <div className="muted" style={{ marginBottom: 8 }}>
            前もって出ていた「予報」と、実際にそうなった「実績」を分けて残しています。
            お客様は予報を見て来店を決めることがあるためです。
          </div>
          <div className="grid g2">
            <div>
              <div className="lbl">実際の天気（実績）</div>
              {day.weather ? (
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{day.weather}</div>
                  <div className="mono muted">
                    最高{day.tempMax === null ? '—' : Math.round(day.tempMax)}℃／最低{day.tempMin === null ? '—' : Math.round(day.tempMin)}℃
                    {day.precip !== null && `／降水${day.precip}mm`}
                  </div>
                </div>
              ) : <div className="muted">記録がありません。</div>}
            </div>
            <div>
              <div className="lbl">前もって出ていた予報</div>
              {d.forecasts.length ? d.forecasts.map((f) => (
                <div key={f.slot} className="row-between">
                  <span>{SLOT[f.slot] || f.slot}</span>
                  <span className="mono">
                    {f.text}／{f.tempMax === null ? '—' : Math.round(f.tempMax)}℃
                    {f.precipProb !== null && f.precipProb !== undefined && `／降水${f.precipProb}%`}
                  </span>
                </div>
              )) : <div className="muted">記録がありません。</div>}
            </div>
          </div>
        </div>

        {/* ── 時間帯 ───────────────────────────── */}
        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">時間帯ごとの売れ方</div>
          {d.hours.length ? (
            <div style={{ marginTop: 10 }}>
              {d.hours.map((h) => (
                <div key={h.hour} className="row" style={{ alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span className="mono" style={{ width: 46 }}>{String(h.hour).padStart(2, '0')}時</span>
                  <div style={{ flex: 1, background: '#f1f3f4', borderRadius: 4, height: 18 }}>
                    <div style={{ width: `${(h.sales / maxHour) * 100}%`, background: '#1a73e8', height: '100%', borderRadius: 4 }} />
                  </div>
                  <span className="mono" style={{ width: 90, textAlign: 'right' }}>{num(h.sales)}円</span>
                  <span className="mono muted" style={{ width: 70, textAlign: 'right' }}>{num(h.qty)}点</span>
                </div>
              ))}
            </div>
          ) : <div className="muted">記録がありません。</div>}
        </div>

        {/* ── 商品 ─────────────────────────────── */}
        <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '14px 16px 0' }}><div className="h2">この日に出た商品</div></div>
          <table className="table table-wide">
            <thead>
              <tr>
                <th>商品</th><th>分類</th>
                <th style={{ textAlign: 'right' }}>数</th>
                <th style={{ textAlign: 'right' }}>売上</th>
                {seeCost && <th style={{ textAlign: 'right' }}>粗利</th>}
                <th>よく出た時間</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td>
                  <td className="muted">{i.category}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(i.qty)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(i.sales)}</td>
                  {seeCost && <td className="mono" style={{ textAlign: 'right' }}>{num(i.profit)}</td>}
                  <td className="mono muted">{i.peakHour === null ? '—' : `${String(i.peakHour).padStart(2, '0')}時ごろ`}</td>
                </tr>
              ))}
              {!d.items.length && <tr><td colSpan={6} className="muted" style={{ padding: 20 }}>記録がありません。</td></tr>}
            </tbody>
          </table>
        </div>

        {/* ── 会計 ─────────────────────────────── */}
        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">お支払いの内わけ</div>
          <div className="grid g4" style={{ marginTop: 10 }}>
            {d.payments.map((p) => (
              <Stat key={p.method} label={`${PAY[p.method] || p.method}（${p.count}件）`} value={yen(p.total)} />
            ))}
            {!d.payments.length && <div className="muted">記録がありません。</div>}
          </div>
        </div>

        {/* ── 出来事（人が書き足すところ） ───────── */}
        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">この日にあった特別なこと</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            貸切・取材・SNSで話題になった・新メニューを出した・値段を変えた…といった出来事を残しておくと、
            あとで「なぜこの日は違ったのか」がわかります。数字だけでは追えないところなので、ここだけは人の手で入れてください。
          </div>

          {d.events.map((e) => (
            <div key={e.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <div>
                <span className="badge b-blue">{KINDS.find(([k]) => k === e.kind)?.[1] || e.kind}</span>
                <span style={{ fontWeight: 700, marginLeft: 8 }}>{e.title}</span>
                {e.impact && e.impact !== 'unknown' && (
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                    {IMPACTS.find(([k]) => k === e.impact)?.[1]}
                  </span>
                )}
                {e.detail && <div className="muted" style={{ fontSize: 12 }}>{e.detail}</div>}
                <div className="muted" style={{ fontSize: 11 }}>{e.by}／{String(e.at).slice(0, 16).replace('T', ' ')}</div>
              </div>
              <button className="btn btn-sm" onClick={() => removeEvent(e.id)}>消す</button>
            </div>
          ))}

          <div className="grid g4" style={{ marginTop: 12 }}>
            <div>
              <label className="lbl">できごとの種類</label>
              <select className="input" value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value })}>
                {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label className="lbl">ひとことで</label>
              <input className="input" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} placeholder="例：18時から2階を貸切（20名）" />
            </div>
            <div>
              <label className="lbl">売上への影響</label>
              <select className="input" value={ev.impact} onChange={(e) => setEv({ ...ev, impact: e.target.value })}>
                {IMPACTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="lbl">くわしく（なくても大丈夫です）</label>
            <textarea className="textarea" rows={2} value={ev.detail} onChange={(e) => setEv({ ...ev, detail: e.target.value })} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy || !ev.title.trim()} onClick={addEvent}>この出来事を残す</button>
          </div>
        </div>

        {/* ── 会計の一覧 ───────────────────────── */}
        <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '14px 16px 0' }}><div className="h2">この日の会計（{d.checks.length}件）</div></div>
          <table className="table table-wide">
            <thead>
              <tr><th>時刻</th><th>伝票</th><th>席</th><th style={{ textAlign: 'right' }}>人数</th><th style={{ textAlign: 'right' }}>値引</th><th style={{ textAlign: 'right' }}>合計</th><th>支払</th><th>担当</th></tr>
            </thead>
            <tbody>
              {d.checks.map((c) => (
                <tr key={c.id} style={{ opacity: c.status === 'closed' ? 1 : 0.5 }}>
                  <td className="mono">{String(c.at).slice(11, 16)}</td>
                  <td className="mono">{c.id}</td>
                  <td>{c.table}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{c.guests}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{c.discount ? num(c.discount) : ''}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(c.total)}</td>
                  <td>{PAY[c.payment] || c.payment}</td>
                  <td className="muted">{c.staff}</td>
                </tr>
              ))}
              {!d.checks.length && <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>記録がありません。</td></tr>}
            </tbody>
          </table>
        </div>

        {d.campaigns.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="h2">この日に動いていた企画</div>
            {d.campaigns.map((c) => (
              <div key={c.id} className="row-between" style={{ padding: '6px 0' }}>
                <span>{c.name}<span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{c.detail}</span></span>
                <span className="mono muted">{c.cost ? yen(c.cost) : ''}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}

function Stat({ label, value, big }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className="mono" style={{ fontSize: big ? 26 : 20, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
