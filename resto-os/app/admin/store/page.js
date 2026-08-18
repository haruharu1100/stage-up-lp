'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;

export default function StoreSettings() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMsg, setGeoMsg] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/store').then((x) => x.json());
    if (r.ok) setS(r.store);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/store', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      }).then((x) => x.json());
      if (!r.ok) return alert(r.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      load();
    } finally {
      setBusy(false);
    }
  }

  // 住所から地図上の位置を割り出す。見つからないときは勝手に近い場所を当てはめず、手入力に案内する。
  async function findPlace() {
    if (geoBusy) return;
    setGeoBusy(true);
    setGeoMsg('');
    try {
      const r = await fetch('/api/admin/store', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'geocode', address: s.address }),
      }).then((x) => x.json());
      if (!r.ok) return setGeoMsg(r.error || '場所を特定できませんでした');
      setS({ ...s, lat: r.lat, lng: r.lng, geoSource: 'geocode' });
      setGeoMsg(`「${r.matched}」の位置を読み取りました。地図でご確認ください。`);
    } finally {
      setGeoBusy(false);
    }
  }

  if (!s) return (<div><Nav /><div className="wrap"><div className="muted">読み込み中…</div></div></div>);

  // 3,000円のお会計・4名のとき、いくらになるかをその場で見せる（設定ミスに気づけるように）
  const sample = 3000;
  const sampleSeat = s.seatCharge * 4;
  const sampleService = Math.floor(((sample + sampleSeat) * s.serviceRate) / 100);
  const sampleTotal = sample + sampleSeat + sampleService;

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">お店の設定</div>
        <div className="muted">お通し・席料・サービス料・レシートの登録番号を設定します。変更はすべて操作ログに残ります。</div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">お通し（自動で伝票と厨房に出す）</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            金額を0円にすると、お通しは付きません。お客様を席にご案内した時点で、人数ぶんが自動で入ります。
            人数を増やしたときは、足りない分だけ追加されます（減らしても自動では消えません。理由を残して取消してください）。
          </div>
          <div className="grid g4">
            <div style={{ gridColumn: 'span 2' }}>
              <label className="field">お通しの名前</label>
              <input className="input" value={s.otoshiName} onChange={(e) => setS({ ...s, otoshiName: e.target.value })} placeholder="お通し" />
            </div>
            <div>
              <label className="field">お通しの金額（1名あたり）</label>
              <input className="input mono" type="number" value={s.otoshiPrice} onChange={(e) => setS({ ...s, otoshiPrice: Number(e.target.value) })} />
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">席料・サービス料（会計時に自動で加算）</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            席料はお一人あたりの金額、サービス料は「割引後の金額＋席料」に対する割合です。どちらも0にすれば加算されません。
          </div>
          <div className="grid g4">
            <div>
              <label className="field">席料（1名あたり）</label>
              <input className="input mono" type="number" value={s.seatCharge} onChange={(e) => setS({ ...s, seatCharge: Number(e.target.value) })} />
            </div>
            <div>
              <label className="field">サービス料（％・上限30）</label>
              <input className="input mono" type="number" value={s.serviceRate} onChange={(e) => setS({ ...s, serviceRate: Number(e.target.value) })} />
            </div>
          </div>
          <div className="card" style={{ marginTop: 12, background: '#fafbfc' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>この設定だと、こうなります（お料理3,000円・4名の例）</div>
            <div className="row-between"><span>お料理・お飲み物</span><span className="mono">{yen(sample)}</span></div>
            {sampleSeat > 0 && <div className="row-between"><span>席料（{yen(s.seatCharge)}×4名）</span><span className="mono">{yen(sampleSeat)}</span></div>}
            {sampleService > 0 && <div className="row-between"><span>サービス料 {s.serviceRate}%</span><span className="mono">{yen(sampleService)}</span></div>}
            <div className="row-between" style={{ fontWeight: 800, fontSize: 18, marginTop: 6 }}>
              <span>合計（税込）</span><span className="mono">{yen(sampleTotal)}</span>
            </div>
            {s.otoshiPrice > 0 && (
              <div className="muted" style={{ marginTop: 6 }}>
                ※ この他に{s.otoshiName} {yen(s.otoshiPrice)}×人数が、ご注文として伝票に入ります。
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">レシート（インボイス対応）</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            登録番号を入れると、レシートに登録番号と税率ごとの内訳（{s.taxRate}%対象・8%対象）が印字されます。
            持ち帰りなど軽減税率の商品は、商品管理でその商品の税率を8%に設定してください。
          </div>
          <div className="grid g4">
            <div style={{ gridColumn: 'span 2' }}>
              <label className="field">適格請求書発行事業者の登録番号</label>
              <input
                className="input mono"
                value={s.invoiceNo}
                onChange={(e) => setS({ ...s, invoiceNo: e.target.value.toUpperCase() })}
                placeholder="T1234567890123"
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label className="field">レシート下部のひとこと</label>
              <input className="input" value={s.receiptNote} onChange={(e) => setS({ ...s, receiptNote: e.target.value })} placeholder="ご来店ありがとうございました" />
            </div>
          </div>
          <div className="grid g4" style={{ marginTop: 12 }}>
            <div>
              <label className="field">電話番号（レシートの上に印字）</label>
              <input className="input mono" value={s.tel} onChange={(e) => setS({ ...s, tel: e.target.value })} placeholder="06-1234-5678" />
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label className="field">住所（レシートの上に印字）</label>
              <input className="input" value={s.address} onChange={(e) => setS({ ...s, address: e.target.value })} placeholder="大阪市北区○○1-2-3" />
            </div>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            この店の標準税率は {s.taxRate}%、営業日の切り替わりは {s.businessDayStart} です。
          </div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">お店の場所（毎日の天気を記録するために使います）</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            天気は住所ではなく地図上の位置で調べます。表記のゆれで別の町の天気を拾わないようにするためです。
            住所を入れて「住所から探す」を押し、ピンの位置が合っているかご確認ください。ずれていれば地図で直せます。
            位置が未設定のあいだ、天気の記録は行いません。
          </div>
          <div className="grid g4">
            <div>
              <label className="field">郵便番号</label>
              <input className="input mono" value={s.postalCode || ''} onChange={(e) => setS({ ...s, postalCode: e.target.value })} placeholder="530-0001" />
            </div>
            <div>
              <label className="field">都道府県</label>
              <input className="input" value={s.prefecture || ''} onChange={(e) => setS({ ...s, prefecture: e.target.value })} placeholder="大阪府" />
            </div>
            <div>
              <label className="field">市区町村</label>
              <input className="input" value={s.city || ''} onChange={(e) => setS({ ...s, city: e.target.value })} placeholder="大阪市北区" />
            </div>
            <div>
              <label className="field">建物名・部屋番号</label>
              <input className="input" value={s.building || ''} onChange={(e) => setS({ ...s, building: e.target.value })} placeholder="○○ビル 2F" />
            </div>
          </div>

          <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" disabled={geoBusy} onClick={findPlace}>{geoBusy ? '探しています…' : '住所から場所を探す'}</button>
            {s.lat && s.lng ? (
              <span className="badge b-green">位置は設定済み（{s.geoSource === 'manual' ? '手動で調整' : '住所から自動'}）</span>
            ) : (
              <span className="badge b-out">位置が未設定です</span>
            )}
          </div>
          {geoMsg && <div className="muted" style={{ marginTop: 8 }}>{geoMsg}</div>}

          <div className="grid g4" style={{ marginTop: 12 }}>
            <div>
              <label className="field">緯度</label>
              <input className="input mono" value={s.lat ?? ''} onChange={(e) => setS({ ...s, lat: e.target.value, geoSource: 'manual' })} placeholder="34.702485" />
            </div>
            <div>
              <label className="field">経度</label>
              <input className="input mono" value={s.lng ?? ''} onChange={(e) => setS({ ...s, lng: e.target.value, geoSource: 'manual' })} placeholder="135.495951" />
            </div>
            <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'flex-end' }}>
              {s.lat && s.lng ? (
                <a className="btn" href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`} target="_blank" rel="noreferrer">
                  地図でこの位置を確認する
                </a>
              ) : (
                <span className="muted">住所から探すと、ここに地図のボタンが出ます。</span>
              )}
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 14, gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={save}>{busy ? '保存中…' : '設定を保存する'}</button>
          {saved && <span style={{ color: 'var(--green)', fontWeight: 700 }}>保存しました</span>}
        </div>
      </div>
    </div>
  );
}
