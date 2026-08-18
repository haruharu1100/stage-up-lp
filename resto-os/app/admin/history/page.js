'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Nav from '../../../components/Nav';

/**
 * お店の記憶をたどる画面。
 *
 * 「実際に起きたこと」と「これからの見込み」は、タブごと・色ごとに分けている。
 * 事実は白い枠、見込みは紫の枠。見込みには必ず範囲と根拠と自信の度合いを添える。
 * 見た目で混ざらないようにするのが、この画面のいちばん大事な役目。
 */

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const num = (n) => Number(n || 0).toLocaleString();
const DOWS = ['日', '月', '火', '水', '木', '金', '土'];
const WEATHERS = [
  ['clear', '晴れ'], ['cloudy', 'くもり'], ['rain', '雨'],
  ['snow', '雪'], ['fog', '霧'], ['storm', '雷雨'],
];
const CAMPAIGN_KINDS = [
  ['coupon', 'クーポン'], ['sns', 'SNS・投稿'], ['flyer', 'チラシ・ポスティング'],
  ['gourmet', 'グルメサイト掲載'], ['sale', '割引・セール'], ['event', '店内イベント'],
  ['ad', '広告'], ['other', 'その他'],
];
const CAMPAIGN_KIND_NAME = Object.fromEntries(CAMPAIGN_KINDS);
const METRICS = [
  ['sales', '売上'],
  ['guests', '客数'],
  ['avg_spend', '客単価'],
  ['items_qty', '出た品数'],
  ['checks_count', '会計数'],
  ['turnover', '回転数'],
  ['gross_profit', '粗利'],
];

const todayStr = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const shift = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`).getTime() + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

export default function HistoryPage() {
  const [tab, setTab] = useState('list');
  const [f, setF] = useState({
    from: shift(todayStr(), -89), to: todayStr(),
    dow: [], weather: [], tempMin: '', tempMax: '', item: '', only: '', minSales: '',
  });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [metric, setMetric] = useState('sales');
  const [cmp, setCmp] = useState(null);
  const [simDate, setSimDate] = useState(todayStr());
  const [sim, setSim] = useState(null);
  const [wxBusy, setWxBusy] = useState(false);
  const [wxMsg, setWxMsg] = useState('');

  const [camps, setCamps] = useState(null);
  const [campErr, setCampErr] = useState('');
  const [campBusy, setCampBusy] = useState(false);
  const [campForm, setCampForm] = useState({
    name: '', kind: 'coupon', detail: '', startsOn: todayStr(), endsOn: '', cost: '',
  });

  const [imp, setImp] = useState({ text: '', filename: '', note: '' });
  const [impPre, setImpPre] = useState(null);
  const [impDone, setImpDone] = useState(null);
  const [impErr, setImpErr] = useState('');
  const [impBusy, setImpBusy] = useState(false);
  const [batches, setBatches] = useState(null);

  const [fc, setFc] = useState(null);
  const [fcErr, setFcErr] = useState('');
  const [fcBusy, setFcBusy] = useState(false);
  const [anom, setAnom] = useState(null);
  const [openFc, setOpenFc] = useState('');

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('from', f.from);
    p.set('to', f.to);
    if (f.dow.length) p.set('dow', f.dow.join(','));
    if (f.weather.length) p.set('weather', f.weather.join(','));
    if (f.tempMin !== '') p.set('tempMin', f.tempMin);
    if (f.tempMax !== '') p.set('tempMax', f.tempMax);
    if (f.item) p.set('item', f.item);
    if (f.only) p.set('only', f.only);
    if (f.minSales !== '') p.set('minSales', f.minSales);
    return p.toString();
  }, [f]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/history?${qs}`).then((x) => x.json());
      if (!r.ok) return setErr(r.error || '読み込めませんでした');
      setErr('');
      setData(r);
    } finally {
      setBusy(false);
    }
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  const loadCompare = useCallback(async () => {
    const r = await fetch(`/api/history?view=compare&metric=${metric}&years=3`).then((x) => x.json());
    if (r.ok) setCmp(r);
  }, [metric]);

  useEffect(() => { if (tab === 'compare') loadCompare(); }, [tab, loadCompare]);

  const loadSimilar = useCallback(async () => {
    const r = await fetch(`/api/history?view=similar&date=${simDate}&limit=8`).then((x) => x.json());
    if (r.ok) setSim(r);
  }, [simDate]);

  useEffect(() => { if (tab === 'similar') loadSimilar(); }, [tab, loadSimilar]);

  const loadCamps = useCallback(async () => {
    const r = await fetch('/api/history/campaigns').then((x) => x.json());
    if (r.ok) setCamps(r.campaigns);
  }, []);

  useEffect(() => { if (tab === 'camp') loadCamps(); }, [tab, loadCamps]);

  const loadForecast = useCallback(async () => {
    setFcBusy(true);
    try {
      const [a, b] = await Promise.all([
        fetch('/api/history/forecast?days=7').then((x) => x.json()),
        fetch('/api/history/forecast?view=anomaly').then((x) => x.json()),
      ]);
      if (!a.ok) return setFcErr(a.error || '見込みを出せませんでした');
      setFcErr('');
      setFc(a);
      setAnom(b.ok ? b : null);
    } finally {
      setFcBusy(false);
    }
  }, []);

  useEffect(() => { if (tab === 'fc') loadForecast(); }, [tab, loadForecast]);

  /** 見込みの作り直し。明日から先だけが変わり、過ぎた日の当たり外れは動かない */
  async function remakeForecast() {
    if (fcBusy) return;
    setFcBusy(true);
    setFcErr('');
    try {
      const r = await fetch('/api/history/forecast', { method: 'POST' }).then((x) => x.json());
      if (!r.ok) setFcErr(r.error || '作り直せませんでした');
    } finally {
      setFcBusy(false);
    }
    loadForecast();
  }

  async function saveCampaign() {
    if (campBusy) return;
    setCampBusy(true);
    setCampErr('');
    try {
      const r = await fetch('/api/history/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campForm),
      }).then((x) => x.json());
      if (!r.ok) return setCampErr(r.error || '登録できませんでした');
      setCampForm({ name: '', kind: 'coupon', detail: '', startsOn: todayStr(), endsOn: '', cost: '' });
      loadCamps();
    } finally {
      setCampBusy(false);
    }
  }

  const loadBatches = useCallback(async () => {
    const r = await fetch('/api/history/import').then((x) => x.json());
    if (r.ok) setBatches(r.batches);
  }, []);

  useEffect(() => { if (tab === 'imp') loadBatches(); }, [tab, loadBatches]);

  /**
   * Excelから保存したCSVは、文字コードが2種類ある（UTF-8と、日本語Windowsの Shift_JIS）。
   * まずUTF-8で読んでみて、崩れるようならShift_JISで読み直す。利用者に文字コードを聞かないため。
   */
  async function pickFile(file) {
    if (!file) return;
    setImpErr('');
    setImpPre(null);
    setImpDone(null);
    const buf = await file.arrayBuffer();
    let text = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      try {
        text = new TextDecoder('shift_jis').decode(buf);
      } catch {
        setImpErr('文字が読み取れませんでした。Excelで「CSV UTF-8」を選んで保存し直してください。');
        return;
      }
    }
    setImp({ ...imp, text, filename: file.name });
  }

  async function runImport(action) {
    if (impBusy || !imp.text.trim()) return;
    setImpBusy(true);
    setImpErr('');
    try {
      const r = await fetch('/api/history/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          text: imp.text,
          filename: imp.filename,
          note: imp.note,
          mapping: impPre?.mapping,
        }),
      }).then((x) => x.json());
      if (!r.ok) return setImpErr(r.error || 'うまく読み取れませんでした');
      if (action === 'preview') {
        setImpPre(r);
        setImpDone(null);
      } else {
        setImpDone(r);
        setImpPre(null);
        setImp({ text: '', filename: '', note: '' });
        loadBatches();
        load();
      }
    } finally {
      setImpBusy(false);
    }
  }

  async function delCampaign(id) {
    if (!confirm('この企画の記録を消します。よろしいですか？')) return;
    const r = await fetch(`/api/history/campaigns?id=${id}`, { method: 'DELETE' }).then((x) => x.json());
    if (!r.ok) return setCampErr(r.error || '消せませんでした');
    loadCamps();
  }

  // 導入前の営業日には天気が付いていない。あとから取り寄せて、振り返りに使えるようにする
  async function fillWeather() {
    if (wxBusy) return;
    setWxBusy(true);
    setWxMsg('');
    try {
      const r = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'weather_backfill' }),
      }).then((x) => x.json());
      if (!r.ok) return setWxMsg(r.error || '取り寄せられませんでした');
      setWxMsg(r.remaining > 0
        ? `${r.saved}日ぶん埋めました。残り${r.remaining}日は、もう一度押すか毎晩の処理で埋まります。`
        : `${r.saved}日ぶん埋めました。`);
      load();
    } finally {
      setWxBusy(false);
    }
  }

  const toggle = (key, v) => setF((p) => ({
    ...p, [key]: p[key].includes(v) ? p[key].filter((x) => x !== v) : [...p[key], v],
  }));

  const st = data?.status;
  const seeCost = data?.canSeeCost;
  const rows = data?.rows || [];

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">お店の記憶（過去データ）</div>
        <div className="muted">
          営業日ごとの売上・客数・商品・天気・出来事を、そのまま残しています。日付をクリックすると、その日の全部が見られます。
          「明日を読む」だけがこれからの見込みで、そこは紫の枠で分けています。それ以外の欄には、実際に起きたことしか出ません。
        </div>

        {/* ── 学習状況 ───────────────────────────── */}
        {st && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div className="h2" style={{ marginBottom: 4 }}>
                  今の段階：{st.phaseName}
                  {!st.canForecast && <span className="badge b-out" style={{ marginLeft: 8 }}>予測はまだ出しません</span>}
                </div>
                <div className="muted">{st.phaseDesc}</div>
              </div>
              {st.nextPhaseName && (
                <div className="muted" style={{ textAlign: 'right' }}>
                  次の段階「{st.nextPhaseName}」まで<br />
                  <span className="mono" style={{ fontSize: 20, fontWeight: 800 }}>あと{st.daysToNext}日</span>
                </div>
              )}
            </div>
            <div className="grid g4" style={{ marginTop: 12 }}>
              <Stat label="記録できた営業日" value={`${num(st.days)}日`} />
              <Stat label="貯まった注文" value={`${num(st.orders)}件`} />
              <Stat label="出た品数" value={`${num(st.items)}点`} />
              <Stat label="天気を記録できた日" value={`${num(st.weatherDays)}日`} />
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              {st.firstDay ? `${st.firstDay} 〜 ${st.lastDay} の記録があります。` : 'まだ記録がありません。営業すると自動で貯まっていきます。'}
              {st.importedDays > 0 && ` うち${st.importedDays}日は、過去データとして取り込んだものです。`}
              {st.events > 0 && ` 出来事の登録は${st.events}件です。`}
            </div>
            {data?.hasGeo === false ? (
              <div className="alert" style={{ marginTop: 10 }}>
                お店の場所がまだ設定されていないため、天気の記録が始まっていません。
                <Link href="/admin/store" style={{ marginLeft: 6 }}>お店の設定</Link>から住所を登録してください。
              </div>
            ) : (st.weatherMissing > 0 || wxMsg) && (
              <div className="row wrapflex" style={{ marginTop: 10, gap: 10, alignItems: 'center' }}>
                {st.weatherMissing > 0 && (
                  <button className="btn btn-sm" disabled={wxBusy} onClick={fillWeather}>
                    {wxBusy ? '取り寄せています…' : '天気が抜けている日を、いま埋める'}
                  </button>
                )}
                <span className="muted" style={{ fontSize: 12 }}>
                  {wxMsg || `天気の無い日が ${num(st.weatherMissing)} 日あります。毎晩すこしずつ自動で埋まります。`}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="tabs" style={{ marginTop: 14 }}>
          <button className={tab === 'fc' ? 'on' : ''} onClick={() => setTab('fc')}>明日を読む（見込み）</button>
          <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>日ごとに見る</button>
          <button className={tab === 'compare' ? 'on' : ''} onClick={() => setTab('compare')}>年・月で比べる</button>
          <button className={tab === 'similar' ? 'on' : ''} onClick={() => setTab('similar')}>似た日を探す</button>
          <button className={tab === 'camp' ? 'on' : ''} onClick={() => setTab('camp')}>打った手（企画・販促）</button>
          <button className={tab === 'imp' ? 'on' : ''} onClick={() => setTab('imp')}>昔の売上を取り込む</button>
        </div>

        {err && <div className="alert" style={{ marginTop: 14 }}>{err}</div>}

        {/* ── 明日を読む（ここだけが「推測」。事実の欄とは色を変える） ── */}
        {tab === 'fc' && (
          <ForecastTab
            fc={fc}
            anom={anom}
            busy={fcBusy}
            err={fcErr}
            open={openFc}
            setOpen={setOpenFc}
            onRemake={remakeForecast}
          />
        )}

        {/* ── 日ごとに見る ───────────────────────── */}
        {tab === 'list' && (
          <>
            <div className="card" style={{ marginTop: 14 }}>
              <div className="grid g4">
                <div>
                  <label className="lbl">開始日</label>
                  <input className="input mono" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
                </div>
                <div>
                  <label className="lbl">終了日</label>
                  <input className="input mono" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
                </div>
                <div>
                  <label className="lbl">商品でしぼる</label>
                  <select className="input" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}>
                    <option value="">すべての日</option>
                    {(data?.itemNames || []).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="lbl">日の種類</label>
                  <select className="input" value={f.only} onChange={(e) => setF({ ...f, only: e.target.value })}>
                    <option value="">すべて</option>
                    <option value="holiday">祝日だけ</option>
                    <option value="eve">祝前日だけ</option>
                    <option value="weekday">平日だけ</option>
                    <option value="event">出来事のあった日だけ</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label className="lbl">曜日</label>
                <div className="row wrapflex" style={{ gap: 6 }}>
                  {DOWS.map((d, i) => (
                    <button key={d} className={`btn btn-sm ${f.dow.includes(i) ? 'btn-primary' : ''}`} onClick={() => toggle('dow', i)}>{d}</button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label className="lbl">天気</label>
                <div className="row wrapflex" style={{ gap: 6 }}>
                  {WEATHERS.map(([k, label]) => (
                    <button key={k} className={`btn btn-sm ${f.weather.includes(k) ? 'btn-primary' : ''}`} onClick={() => toggle('weather', k)}>{label}</button>
                  ))}
                </div>
              </div>

              <div className="grid g4" style={{ marginTop: 12 }}>
                <div>
                  <label className="lbl">最高気温がこれ以上（℃）</label>
                  <input className="input mono" type="number" value={f.tempMin} onChange={(e) => setF({ ...f, tempMin: e.target.value })} placeholder="例：30" />
                </div>
                <div>
                  <label className="lbl">最高気温がこれ以下（℃）</label>
                  <input className="input mono" type="number" value={f.tempMax} onChange={(e) => setF({ ...f, tempMax: e.target.value })} placeholder="例：36" />
                </div>
                <div>
                  <label className="lbl">売上がこれ以上（円）</label>
                  <input className="input mono" type="number" value={f.minSales} onChange={(e) => setF({ ...f, minSales: e.target.value })} placeholder="例：200000" />
                </div>
              </div>

              <div className="row wrapflex" style={{ marginTop: 12, gap: 8 }}>
                <button className="btn btn-primary" disabled={busy} onClick={load}>{busy ? '探しています…' : 'この条件で表示'}</button>
                <button className="btn" onClick={() => setF({ from: shift(todayStr(), -89), to: todayStr(), dow: [], weather: [], tempMin: '', tempMax: '', item: '', only: '', minSales: '' })}>条件をクリア</button>
                <button className="btn" onClick={() => setF({ ...f, from: shift(todayStr(), -364), to: todayStr() })}>直近1年</button>
              </div>
            </div>

            {data?.summary && (
              <div className="card" style={{ marginTop: 14 }}>
                <div className="h2">この条件にあてはまった {num(data.summary.days)} 日のまとめ</div>
                <div className="grid g4" style={{ marginTop: 10 }}>
                  <Stat label="売上の合計" value={yen(data.summary.sales)} />
                  <Stat label="1日あたりの売上" value={yen(data.summary.avgSales)} />
                  <Stat label="1日あたりの客数" value={`${num(data.summary.avgGuests)}名`} />
                  <Stat label="客単価" value={yen(data.summary.avgSpend)} />
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  いちばん多い日 {yen(data.summary.maxSales)}／いちばん少ない日 {yen(data.summary.minSales)}
                  {seeCost && data.summary.profit !== undefined && `／粗利の合計 ${yen(data.summary.profit)}`}
                </div>
              </div>
            )}

            <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
              <table className="table table-wide">
                <thead>
                  <tr>
                    <th>営業日</th><th>天気</th><th>気温</th>
                    <th style={{ textAlign: 'right' }}>売上</th>
                    <th style={{ textAlign: 'right' }}>客数</th>
                    <th style={{ textAlign: 'right' }}>客単価</th>
                    <th style={{ textAlign: 'right' }}>会計</th>
                    {f.item && <th style={{ textAlign: 'right' }}>{f.item}</th>}
                    {seeCost && <th style={{ textAlign: 'right' }}>粗利</th>}
                    <th>この日のこと</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.date}>
                      <td>
                        <Link href={`/admin/history/${r.date}`} className="mono" style={{ fontWeight: 700 }}>
                          {r.date}（{r.dowName}）
                        </Link>
                        {r.source === 'import' && <span className="badge b-gray" style={{ marginLeft: 6 }}>取込</span>}
                        {!r.closed && r.source !== 'import' && <span className="badge b-out" style={{ marginLeft: 6 }}>未締め</span>}
                      </td>
                      <td>{r.weather || <span className="muted">—</span>}</td>
                      <td className="mono">{r.tempMax === null ? '—' : `${Math.round(r.tempMax)}/${Math.round(r.tempMin)}℃`}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(r.sales)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(r.guests)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(r.avgSpend)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(r.checks)}</td>
                      {f.item && <td className="mono" style={{ textAlign: 'right' }}>{num(r.itemQty)}点</td>}
                      {seeCost && <td className="mono" style={{ textAlign: 'right' }}>{num(r.profit)}</td>}
                      <td className="muted" style={{ fontSize: 12 }}>
                        {[r.dayLabel, ...(r.events || []).map((e) => e.title)].filter(Boolean).join('／')}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={10} className="muted" style={{ padding: 20 }}>
                      あてはまる日がありませんでした。条件をゆるめるか、期間を広げてお試しください。
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── 年・月で比べる ─────────────────────── */}
        {tab === 'compare' && (
          <>
            <div className="card" style={{ marginTop: 14 }}>
              <label className="lbl">比べるもの</label>
              <div className="row wrapflex" style={{ gap: 6 }}>
                {METRICS.filter(([k]) => seeCost || k !== 'gross_profit').map(([k, label]) => (
                  <button key={k} className={`btn btn-sm ${metric === k ? 'btn-primary' : ''}`} onClick={() => setMetric(k)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="card" style={{ marginTop: 14, overflowX: 'auto' }}>
              <YearChart data={cmp} />
            </div>
          </>
        )}

        {/* ── 似た日を探す ───────────────────────── */}
        {tab === 'similar' && (
          <>
            <div className="card" style={{ marginTop: 14 }}>
              <div className="muted" style={{ marginBottom: 10 }}>
                曜日・天気・気温が近い日を、過去2年から探します。どこが似ているのかを必ず添えて出します。
              </div>
              <div className="row wrapflex" style={{ gap: 10, alignItems: 'flex-end' }}>
                <div>
                  <label className="lbl">この日に似た日を探す</label>
                  <input className="input mono" type="date" value={simDate} onChange={(e) => setSimDate(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={loadSimilar}>探す</button>
              </div>
              {sim?.basis && (
                <div className="muted" style={{ marginTop: 10 }}>
                  探す手がかり：{[
                    sim.basis.dow,
                    sim.basis.weather ? `${sim.basis.weather}（${sim.basis.weatherFrom}）` : '',
                    sim.basis.tempMax === null ? '' : `最高${Math.round(sim.basis.tempMax)}℃`,
                    sim.basis.holiday,
                  ].filter(Boolean).join('／') || '手がかりがまだありません（天気の記録が貯まると精度が上がります）'}
                </div>
              )}
            </div>

            {sim?.summary?.days > 0 && (
              <div className="card" style={{ marginTop: 14 }}>
                <div className="h2">見つかった{num(sim.summary.days)}日の平均</div>
                <div className="grid g4" style={{ marginTop: 10 }}>
                  <Stat label="売上" value={yen(sim.summary.avgSales)} />
                  <Stat label="客数" value={`${num(sim.summary.avgGuests)}名`} />
                  <Stat label="客単価" value={yen(sim.summary.avgSpend)} />
                  <Stat label="いちばん多い日" value={yen(sim.summary.maxSales)} />
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  これは過去に実際にあった日の平均です。今日の予測ではありません。
                </div>
              </div>
            )}

            <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
              <table className="table table-wide">
                <thead>
                  <tr>
                    <th>営業日</th><th>似ているところ</th><th>天気</th>
                    <th style={{ textAlign: 'right' }}>売上</th>
                    <th style={{ textAlign: 'right' }}>客数</th>
                    <th style={{ textAlign: 'right' }}>客単価</th>
                  </tr>
                </thead>
                <tbody>
                  {(sim?.rows || []).map((r) => (
                    <tr key={r.date}>
                      <td><Link href={`/admin/history/${r.date}`} className="mono" style={{ fontWeight: 700 }}>{r.date}（{r.dowName}）</Link></td>
                      <td style={{ fontSize: 12 }}>{r.why.join('／')}</td>
                      <td>{r.weather || <span className="muted">—</span>}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(r.sales)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(r.guests)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(r.avgSpend)}</td>
                    </tr>
                  ))}
                  {sim && !(sim.rows || []).length && (
                    <tr><td colSpan={6} className="muted" style={{ padding: 20 }}>
                      似た日がまだ見つかりません。記録が貯まると見つかるようになります。
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── 打った手（企画・販促） ─────────────── */}
        {tab === 'camp' && (
          <>
            <div className="card" style={{ marginTop: 14 }}>
              <div className="h2">打った手を残す</div>
              <div className="muted" style={{ marginBottom: 12 }}>
                クーポン・SNS・チラシ・セールなど、こちらから仕掛けたことを記録します。
                いつ何をしたかが残っていると、あとから「あの月が良かったのは何をしたからか」を見返せます。
                日付の詳細画面にも、その日に動いていた企画として出ます。
              </div>

              <div className="grid g3">
                <div>
                  <label className="lbl">企画の名前</label>
                  <input
                    className="input" value={campForm.name} placeholder="例：雨の日ドリンク1杯サービス"
                    onChange={(e) => setCampForm({ ...campForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="lbl">種類</label>
                  <select className="input" value={campForm.kind} onChange={(e) => setCampForm({ ...campForm, kind: e.target.value })}>
                    {CAMPAIGN_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="lbl">かけた費用（円・わかれば）</label>
                  <input
                    className="input mono" type="number" value={campForm.cost} placeholder="例：30000"
                    onChange={(e) => setCampForm({ ...campForm, cost: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid g3" style={{ marginTop: 12 }}>
                <div>
                  <label className="lbl">始める日</label>
                  <input
                    className="input mono" type="date" value={campForm.startsOn}
                    onChange={(e) => setCampForm({ ...campForm, startsOn: e.target.value })}
                  />
                </div>
                <div>
                  <label className="lbl">終わる日（ずっと続けるなら空でOK）</label>
                  <input
                    className="input mono" type="date" value={campForm.endsOn}
                    onChange={(e) => setCampForm({ ...campForm, endsOn: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label className="lbl">くわしい内容（あとで思い出せるように）</label>
                <textarea
                  className="input textarea" rows={2} value={campForm.detail}
                  placeholder="例：雨予報の日だけ、来店時にソフトドリンク1杯無料。店頭POPとインスタで告知。"
                  onChange={(e) => setCampForm({ ...campForm, detail: e.target.value })}
                />
              </div>

              {campErr && <div className="alert" style={{ marginTop: 10 }}>{campErr}</div>}
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primary" disabled={campBusy} onClick={saveCampaign}>
                  {campBusy ? '登録しています…' : 'この企画を登録する'}
                </button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
              <table className="table table-wide">
                <thead>
                  <tr>
                    <th>期間</th><th>種類</th><th>企画の名前</th>
                    <th style={{ textAlign: 'right' }}>かけた費用</th>
                    <th>内容</th><th>登録した人</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {(camps || []).map((c) => (
                    <tr key={c.id}>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                        {c.startsOn}
                        <br />
                        <span className="muted">〜{c.endsOn || '（続行中）'}</span>
                        {c.running && <span className="badge b-green" style={{ marginLeft: 6 }}>実施中</span>}
                      </td>
                      <td>{CAMPAIGN_KIND_NAME[c.kind] || 'その他'}</td>
                      <td style={{ fontWeight: 700 }}>{c.name}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c.cost ? num(c.cost) : <span className="muted">—</span>}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{c.detail}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{c.by}</td>
                      <td><button className="btn btn-sm" onClick={() => delCampaign(c.id)}>消す</button></td>
                    </tr>
                  ))}
                  {camps && !camps.length && (
                    <tr><td colSpan={7} className="muted" style={{ padding: 20 }}>
                      まだ記録がありません。クーポンを配った、SNSで告知した、といったことを残しておくと、あとで効果を振り返れます。
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── 昔の売上を取り込む ─────────────────── */}
        {tab === 'imp' && (
          <>
            <div className="card" style={{ marginTop: 14 }}>
              <div className="h2">前のレジや台帳の売上を入れる</div>
              <div className="muted" style={{ marginBottom: 12 }}>
                今日からデータ0で始めなくて済むように、これまでの売上をまとめて入れられます。
                入れておくと、初日から「去年の同じ日」と比べられます。
                Excelの場合は「名前を付けて保存」で <b>CSV</b> を選んでください。表をそのままコピーして下の欄に貼り付けてもかまいません。
              </div>
              <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>
                必要なのは <b>日付</b> と <b>売上</b> の2列だけです。客数・会計数・原価・メモの列があれば、いっしょに取り込みます。
                すでにこのレジで記録した日は、上書きせずそのまま残します。
              </div>

              <div className="grid g2">
                <div>
                  <label className="lbl">ファイルを選ぶ（CSV／テキスト）</label>
                  <input className="input" type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => pickFile(e.target.files?.[0])} />
                </div>
                <div>
                  <label className="lbl">この取り込みのメモ（任意）</label>
                  <input className="input" value={imp.note} placeholder="例：2024年の旧レジぶん" onChange={(e) => setImp({ ...imp, note: e.target.value })} />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label className="lbl">または、表をそのまま貼り付ける</label>
                <textarea
                  className="input textarea mono" rows={5} value={imp.text}
                  placeholder={'日付,売上,客数\n2024/4/1,182000,64\n2024/4/2,151300,52'}
                  onChange={(e) => { setImp({ ...imp, text: e.target.value }); setImpPre(null); setImpDone(null); }}
                />
                {imp.filename && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>読み込んだファイル：{imp.filename}</div>}
              </div>

              {impErr && <div className="alert" style={{ marginTop: 10 }}>{impErr}</div>}

              <div className="row wrapflex" style={{ marginTop: 12, gap: 8 }}>
                <button className="btn btn-primary" disabled={impBusy || !imp.text.trim()} onClick={() => runImport('preview')}>
                  {impBusy ? '読んでいます…' : 'どう読み取れるか確かめる'}
                </button>
                {imp.text && (
                  <button className="btn" onClick={() => { setImp({ text: '', filename: '', note: '' }); setImpPre(null); setImpErr(''); }}>
                    やり直す
                  </button>
                )}
              </div>
            </div>

            {impDone && (
              <div className="card" style={{ marginTop: 14 }}>
                <div className="h2">取り込みました</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {impDone.from}〜{impDone.to} の <b>{num(impDone.saved)}日ぶん</b>を記録しました。
                  {impDone.skipped > 0 && ` ${num(impDone.skipped)}日は、このレジの記録があったのでそのままにしました。`}
                  {impDone.failed > 0 && ` ${num(impDone.failed)}行は読み取れませんでした。`}
                  {impDone.weather > 0 && ` あわせて${num(impDone.weather)}日ぶんの天気も取り寄せました。`}
                </div>
                <div style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => { setTab('list'); setF({ ...f, from: impDone.from, to: impDone.to }); }}>
                    取り込んだ期間を見る
                  </button>
                </div>
              </div>
            )}

            {impPre && (
              <div className="card" style={{ marginTop: 14 }}>
                <div className="h2">こう読み取りました</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  ここで確かめてから「この内容で取り込む」を押すまで、何も保存されません。
                  読み取りがずれていたら、下の組み合わせを選び直してください。
                </div>

                <div className="grid g3" style={{ marginTop: 12 }}>
                  {impPre.fields.map((fl) => (
                    <div key={fl.key}>
                      <label className="lbl">{fl.label}{fl.required && <span style={{ color: '#d93025' }}>（必須）</span>}</label>
                      <select
                        className="input"
                        value={impPre.mapping[fl.key] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? undefined : Number(e.target.value);
                          const next = { ...impPre.mapping };
                          if (v === undefined) delete next[fl.key]; else next[fl.key] = v;
                          setImpPre({ ...impPre, mapping: next });
                        }}
                      >
                        <option value="">（使わない）</option>
                        {impPre.header.map((h, i) => <option key={`${h}-${i}`} value={i}>{h || `${i + 1}列目`}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  選び直したら、もう一度「どう読み取れるか確かめる」を押すと反映されます。
                </div>

                <div className="grid g4" style={{ marginTop: 14 }}>
                  <Stat label="取り込める日数" value={`${num(impPre.counts.ok)}日`} />
                  <Stat label="読めなかった行" value={`${num(impPre.counts.ng)}行`} />
                  <Stat label="レジの記録があり見送る日" value={`${num(impPre.counts.skipLive)}日`} />
                  <Stat label="期間" value={impPre.from ? `${impPre.from}〜${impPre.to}` : '—'} />
                </div>

                {impPre.counts.skipLive > 0 && (
                  <div className="alert" style={{ marginTop: 10 }}>
                    このレジで実際に記録した日は、取り込みで上書きしません。本物の記録を守るためです。
                  </div>
                )}
                {impPre.counts.overwriteImport > 0 && (
                  <div className="muted" style={{ marginTop: 8 }}>
                    前に取り込んだ日が{num(impPre.counts.overwriteImport)}日ぶん重なっています。こちらは新しい内容で入れ直します。
                  </div>
                )}

                <div style={{ marginTop: 14, overflowX: 'auto' }}>
                  <table className="table table-wide">
                    <thead>
                      <tr>
                        <th>日付</th>
                        <th style={{ textAlign: 'right' }}>売上</th>
                        <th style={{ textAlign: 'right' }}>客数</th>
                        <th style={{ textAlign: 'right' }}>会計数</th>
                        <th style={{ textAlign: 'right' }}>原価</th>
                        <th>メモ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impPre.rows.map((r) => (
                        <tr key={r.date}>
                          <td className="mono">{r.date}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(r.sales)}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{r.guests ? num(r.guests) : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{r.checks ? num(r.checks) : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{r.cost ? num(r.cost) : '—'}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {impPre.counts.ok > impPre.rows.length && (
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                      はじめの{impPre.rows.length}日ぶんだけ出しています。残りも同じように取り込みます。
                    </div>
                  )}
                </div>

                {impPre.errors.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="lbl">読み取れなかった行</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {impPre.errors.map((e) => `${e.line}行目：${e.reason}${e.raw ? `（${e.raw}）` : ''}`).join(' ／ ')}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 14 }}>
                  <button className="btn btn-primary btn-lg" disabled={impBusy || !impPre.counts.ok} onClick={() => runImport('commit')}>
                    {impBusy ? '取り込んでいます…' : 'この内容で取り込む'}
                  </button>
                </div>
              </div>
            )}

            {batches && batches.length > 0 && (
              <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
                <table className="table table-wide">
                  <thead>
                    <tr>
                      <th>取り込んだ日時</th><th>ファイル</th><th>期間</th>
                      <th style={{ textAlign: 'right' }}>入った日数</th>
                      <th style={{ textAlign: 'right' }}>入らなかった行</th>
                      <th>メモ</th><th>やった人</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((bt) => (
                      <tr key={bt.id}>
                        <td className="mono" style={{ fontSize: 12 }}>{String(bt.at).replace('T', ' ').slice(0, 16)}</td>
                        <td>{bt.filename || <span className="muted">貼り付け</span>}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{bt.from}〜{bt.to}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{num(bt.rowsOk)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{num(bt.rowsNg)}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{bt.note}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{bt.by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

// ===== 見込み（推測）の表示 =====
// 事実の欄と区別するため、この中はすべて紫の枠で囲む。
const FC_BG = '#faf5ff';
const FC_LINE = '#a142f4';

const confColor = (p) => (p >= 70 ? '#0f9d58' : p >= 45 ? '#e8710a' : '#80868b');

/**
 * 「根拠の強さ」の表示。
 * わざと「的中率」とは呼ばない。似た日の記録がどれだけそろっているかを表す目安であって、
 * 何%当たるという意味ではないため。実際の当たり具合は下の「答え合わせ」に出す。
 */
function ConfBadge({ pct, label }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
        color: '#fff', background: confColor(pct),
      }}
      title="似た日の記録がどれだけあるか、その日どうしがどれだけそろっているかの目安です。的中率ではありません。"
    >
      根拠の強さ {label}（{pct}／100）
    </span>
  );
}

/** 見込みの1日ぶん。数字だけを大きく出さず、必ず範囲と根拠をそばに置く */
function ForecastCard({ row, open, setOpen }) {
  const d = row.date;
  const c = row.context || {};
  const s = row.sales;
  const g = row.guests;
  const isOpen = open === d;

  return (
    <div
      style={{
        border: `1px solid ${isOpen ? FC_LINE : '#e6d9f7'}`, borderRadius: 10,
        background: FC_BG, padding: 12, marginBottom: 8,
      }}
    >
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 800 }}>
            {d}
            <span className="muted" style={{ marginLeft: 8, fontWeight: 500 }}>
              {c.dayLabel || `${c.dowName || ''}曜日`}
            </span>
            {row.fixed
              ? <span className="badge b-gray" style={{ marginLeft: 8 }}>前日までに確定</span>
              : <span className="badge b-out" style={{ marginLeft: 8 }}>参考（いま計算）</span>}
          </div>
          <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>
            {c.weatherText ? `${c.weatherText}${c.weatherFrom ? `（${c.weatherFrom}）` : ''}` : '天気の情報なし'}
            {c.tempMax !== null && c.tempMax !== undefined ? ` ／ 最高${Math.round(c.tempMax)}℃` : ''}
            {(c.campaigns || []).length ? ` ／ 実施中：${c.campaigns.join('、')}` : ''}
          </div>
        </div>
        {s?.ok && <ConfBadge pct={s.confidencePct} label={s.confidence} />}
      </div>

      {row.notEnough && <div className="muted" style={{ marginTop: 8 }}>{row.message}</div>}

      {s?.ok && (
        <div className="grid g2" style={{ marginTop: 10, gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>売上の見込み</div>
            <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: FC_LINE }}>
              {yen(s.low)} 〜 {yen(s.high)}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>真ん中を取ると {yen(s.value)} くらい</div>
          </div>
          {g?.ok && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>客数の見込み</div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: FC_LINE }}>
                {num(g.low)} 〜 {num(g.high)}人
              </div>
              <div className="muted" style={{ fontSize: 12 }}>真ん中を取ると {num(g.value)}人くらい</div>
            </div>
          )}
        </div>
      )}

      {s?.ok && (
        <>
          <button
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => setOpen(isOpen ? '' : d)}
          >
            {isOpen ? '根拠を閉じる' : 'なぜこの数字になったか'}
          </button>
          {isOpen && (
            <div style={{ marginTop: 10, borderTop: '1px dashed #d9c7f0', paddingTop: 10 }}>
              <table className="table">
                <tbody>
                  {(s.basis || []).map((b, i) => (
                    <tr key={`${b.label}-${i}`}>
                      <td style={{ width: 200, fontWeight: 700 }}>{b.label}</td>
                      <td className="muted">{b.detail}</td>
                      <td className="mono" style={{ width: 90, textAlign: 'right', fontWeight: 800 }}>
                        {b.value !== null && b.value !== undefined
                          ? yen(b.value)
                          : b.effect > 0 ? `＋${b.effect}%` : b.effect < 0 ? `${b.effect}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                ここに出るのは「一緒に起きていた傾向」であって、原因ではありません。
                最後に決めるのは、お店の状況を知っている人です。
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 予測が当たったかの記録。都合の良い日だけを選ばず、直近をそのまま出す */
function AccuracyBox({ acc }) {
  if (!acc || !acc.days) {
    return (
      <div className="muted">
        まだ答え合わせができていません。予測を出した日が過ぎると、翌朝に自動で採点され、ここに出ます。
      </div>
    );
  }
  return (
    <>
      <div className="grid g4">
        <Stat label="答え合わせできた日" value={`${num(acc.days)}日`} />
        <Stat label="ずれの真ん中" value={`${acc.medErrorPct}%`} />
        <Stat label="ずれ10%以内だった割合" value={`${acc.within10}%`} />
        <Stat label="示した範囲に収まった割合" value={`${acc.inRangePct}%`} />
      </div>
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        外れた日もそのまま数えています。記録がたまるほど、この数字自体があてになります。
      </div>
      <table className="table table-wide" style={{ marginTop: 10 }}>
        <thead>
          <tr><th>日付</th><th style={{ textAlign: 'right' }}>予測</th><th style={{ textAlign: 'right' }}>実際</th><th style={{ textAlign: 'right' }}>ずれ</th><th>範囲内</th></tr>
        </thead>
        <tbody>
          {acc.rows.slice(0, 14).map((r) => (
            <tr key={r.date}>
              <td className="mono">{r.date}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{yen(r.predicted)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{yen(r.actual)}</td>
              <td className="mono" style={{ textAlign: 'right', color: Math.abs(r.errorPct) <= 10 ? '#0f9d58' : Math.abs(r.errorPct) <= 20 ? '#e8710a' : '#d93025' }}>
                {r.errorPct > 0 ? `＋${r.errorPct}` : r.errorPct}%
              </td>
              <td>{r.inRange ? <span className="badge b-green">収まった</span> : <span className="badge b-out">外れた</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ForecastTab({ fc, anom, busy, err, open, setOpen, onRemake }) {
  const rows = fc?.rows || [];
  const plan = fc?.plan;
  const notEnough = rows.length && rows.every((r) => r.notEnough);

  return (
    <>
      <div className="card" style={{ marginTop: 14, background: FC_BG, borderColor: '#e6d9f7' }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="h2" style={{ marginBottom: 4, color: FC_LINE }}>ここから先は「見込み」です</div>
            <div className="muted">
              過ぎた日の記録（事実）とは分けています。数字は必ず幅で出し、そう考えた理由も一緒に出します。
              当たり外れは毎朝ひとりでに採点され、下に残ります。
            </div>
          </div>
          <button className="btn btn-sm" disabled={busy} onClick={onRemake}>
            {busy ? '計算しています…' : '見込みを作り直す'}
          </button>
        </div>
      </div>

      {err && <div className="alert" style={{ marginTop: 14 }}>{err}</div>}

      {/* 今日の作戦 */}
      {plan?.ok && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">今日の作戦（{plan.date}）</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            {plan.context?.dayLabel}
            {plan.context?.weatherText ? ` ／ ${plan.context.weatherText}` : ''}
          </div>
          {plan.sales?.ok && (
            <div className="grid g3">
              <Stat label="売上の見込み（幅）" value={`${yen(plan.sales.low)}〜${yen(plan.sales.high)}`} />
              <Stat label="客数の見込み（幅）" value={plan.guests?.ok ? `${num(plan.guests.low)}〜${num(plan.guests.high)}人` : '—'} />
              <Stat label="いつものこの曜日" value={yen(plan.sales.base)} />
            </div>
          )}
          <ul style={{ marginTop: 12, paddingLeft: 20, lineHeight: 1.9 }}>
            {(plan.notes || []).map((n, i) => <li key={`${n.kind}-${i}`}>{n.text}</li>)}
          </ul>
        </div>
      )}
      {plan && !plan.ok && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">今日の作戦</div>
          <div className="muted">{plan.message || 'まだ記録が足りないため、見込みは出しません。'}</div>
        </div>
      )}

      {/* これから7日 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="h2">これから7日の見込み</div>
        {busy && !rows.length && <div className="muted">計算しています…</div>}
        {notEnough ? (
          <div className="muted">
            まだ記録が足りません。営業日が14日ぶんたまると、ここに見込みが出ます。
            過去の売上を取り込むと、その日から出せるようになります。
          </div>
        ) : (
          rows.map((r) => <ForecastCard key={r.date} row={r} open={open} setOpen={setOpen} />)
        )}
      </div>

      {/* 答え合わせ */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="h2">予測はどれくらい当たっているか</div>
        <AccuracyBox acc={fc?.accuracy} />
      </div>

      {/* いつもと違った日 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="h2">いつもと違った日</div>
        <div className="muted" style={{ marginBottom: 10 }}>
          同じ曜日のふだんと3割以上ちがった日です。理由は決めつけず、その日にあった事実だけを並べています。
        </div>
        {!anom?.ok ? (
          <div className="muted">まだ見比べられるだけの記録がありません。</div>
        ) : !anom.rows.length ? (
          <div className="muted">大きく外れた日はありませんでした。</div>
        ) : (
          <table className="table table-wide">
            <thead>
              <tr><th>日付</th><th>曜日</th><th style={{ textAlign: 'right' }}>売上</th><th style={{ textAlign: 'right' }}>いつも</th><th style={{ textAlign: 'right' }}>差</th><th>その日にあったこと</th></tr>
            </thead>
            <tbody>
              {anom.rows.map((r) => (
                <tr key={r.date}>
                  <td className="mono">
                    <Link href={`/admin/history/${r.date}`}>{r.date}</Link>
                  </td>
                  <td>{r.dowName}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{yen(r.sales)}</td>
                  <td className="mono muted" style={{ textAlign: 'right' }}>{yen(r.normal)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: r.diffPct > 0 ? '#0f9d58' : '#d93025' }}>
                    {r.diffPct > 0 ? `＋${r.diffPct}` : r.diffPct}%
                  </td>
                  <td className="muted">
                    {[r.holiday, r.weather, r.tempMax !== null ? `${Math.round(r.tempMax)}℃` : '', ...(r.events || [])]
                      .filter(Boolean).join('／') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** 年ごとの月別グラフ。ライブラリは使わず、そのまま描く（読み込みを軽くするため） */
function YearChart({ data }) {
  const series = data?.series || [];
  const label = METRICS.find(([k]) => k === data?.metric)?.[1] || '売上';
  const all = series.flatMap((s) => s.values).filter((v) => v !== null);
  if (!series.length || !all.length) {
    return <div className="muted" style={{ padding: 10 }}>まだ比べられるだけの記録がありません。営業を続けると、去年の同じ月と並べて見られるようになります。</div>;
  }
  const max = Math.max(...all);
  const W = 860, H = 300, PL = 60, PB = 30, PT = 16, PR = 12;
  const x = (i) => PL + ((W - PL - PR) * i) / 11;
  const y = (v) => PT + (H - PT - PB) * (1 - v / (max || 1));
  const COLORS = ['#1a73e8', '#e8710a', '#0f9d58', '#a142f4', '#d93025'];

  return (
    <div>
      <div className="row wrapflex" style={{ gap: 12, marginBottom: 8 }}>
        {series.map((s, i) => (
          <span key={s.year} className="muted" style={{ fontSize: 12 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: COLORS[i % COLORS.length], marginRight: 5, borderRadius: 2 }} />
            {s.year}年
          </span>
        ))}
      </div>
      <svg width={W} height={H} style={{ maxWidth: '100%' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line x1={PL} y1={y(max * p)} x2={W - PR} y2={y(max * p)} stroke="#e8eaed" />
            <text x={PL - 6} y={y(max * p) + 4} textAnchor="end" fontSize="10" fill="#80868b">
              {Math.round(max * p).toLocaleString()}
            </text>
          </g>
        ))}
        {Array.from({ length: 12 }, (_, i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#80868b">{i + 1}月</text>
        ))}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean);
          if (!pts.length) return null;
          return (
            <g key={s.year}>
              <polyline
                fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth="2.5"
                points={pts.map((p) => p.join(',')).join(' ')}
              />
              {pts.map((p) => <circle key={p[0]} cx={p[0]} cy={p[1]} r="3.5" fill={COLORS[si % COLORS.length]} />)}
            </g>
          );
        })}
      </svg>
      <div className="muted" style={{ marginTop: 6 }}>
        たての目もりは{label}です。線が抜けている月は、まだ記録がありません。
      </div>
    </div>
  );
}
