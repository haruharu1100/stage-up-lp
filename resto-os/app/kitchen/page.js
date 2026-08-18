'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const STATIONS = [
  ['', 'すべて'],
  ['drink', 'ドリンク場'],
  ['grill', '焼き場'],
  ['sashimi', '刺場'],
  ['kitchen', '厨房'],
  ['dessert', 'デザート'],
];

const NEXT = { received: 'cooking', cooking: 'ready', ready: 'served' };
const NEXT_LABEL = { received: '調理開始', cooking: '完成', ready: '提供済にする' };
// 押し間違いを1段だけ戻せるようにする（進めるだけだと、間違えた札を直す手段が無くなる）
const PREV = { cooking: 'received', ready: 'cooking' };
const STATUS_LABEL = { received: '受付', cooking: '調理中', ready: '完成' };
const VOID_ROLES = ['owner', 'admin', 'manager', 'staff'];
const OFFLINE_SEC = 40;

function elapsedMin(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

// ブラウザは「画面を一度も触っていない状態」では音を鳴らさない決まりになっている。
// 厨房端末は置きっぱなしで誰も触らないため、音が出る状態かどうかを必ず確かめる。
let _ac = null;

function audioReady() {
  return !!_ac && _ac.state === 'running';
}

async function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    if (!_ac) _ac = new Ctx();
    if (_ac.state === 'suspended') await _ac.resume();
    return _ac.state === 'running';
  } catch {
    return false;
  }
}

/** 新しい注文が入ったことを音で知らせる（端末のスピーカーだけで鳴らす） */
function beep() {
  try {
    if (!audioReady()) return;
    const ac = _ac;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
    osc.start();
    osc.stop(ac.currentTime + 0.35);
  } catch {}
}

export default function Kitchen() {
  const router = useRouter();
  const [station, setStation] = useState('');
  const [items, setItems] = useState([]);
  const [tick, setTick] = useState(0);
  const [role, setRole] = useState('');
  const [lastOk, setLastOk] = useState(Date.now());
  const [soundOn, setSoundOn] = useState(false);
  const [undo, setUndo] = useState(null); // 直前に「提供済」にした札（押し間違いをすぐ戻すため）
  const knownIds = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/orders?view=kds${station ? `&station=${station}` : ''}`).then((x) => x.json());
      if (!r.ok) {
        if (r.code === 'UNAUTHENTICATED') router.replace('/login');
        return;
      }
      setItems(r.items);
      setLastOk(Date.now());

      // 見たことのない注文が増えたら鳴らす（最初の読み込みでは鳴らさない）
      const ids = new Set(r.items.map((i) => i.id));
      if (knownIds.current && [...ids].some((id) => !knownIds.current.has(id))) beep();
      knownIds.current = ids;
    } catch {
      // 通信断。lastOk を更新しないので、続けば全画面警告が出る
    }
  }, [station, router]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((x) => x.json())
      .then((r) => (r.authenticated ? setRole(r.me.role) : router.replace('/login')))
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    load();
    const a = setInterval(load, 5000);
    const b = setInterval(() => setTick((t) => t + 1), 10000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [load]);

  // 画面のどこかが最初に触られた時点で、音を鳴らせる状態にしておく
  useEffect(() => {
    unlockAudio().then(setSoundOn);
    const on = () => unlockAudio().then(setSoundOn);
    document.addEventListener('pointerdown', on);
    document.addEventListener('keydown', on);
    return () => {
      document.removeEventListener('pointerdown', on);
      document.removeEventListener('keydown', on);
    };
  }, []);

  // 厨房のタブレットが勝手に画面を消すと、注文が来ても誰も気づけない。
  // この画面を開いている間だけ、端末に「眠らないで」と頼み続ける。
  useEffect(() => {
    let lock = null;
    let alive = true;

    const acquire = async () => {
      try {
        if (!alive || document.visibilityState !== 'visible') return;
        lock = await navigator.wakeLock?.request('screen');
        lock?.addEventListener?.('release', () => { lock = null; });
      } catch {
        // 端末が対応していない場合は何もしない（画面は普通に消える）
      }
    };

    acquire();
    // スリープや別アプリへの切り替えで解除されるので、戻ってきたら取り直す
    const onVisible = () => { if (document.visibilityState === 'visible' && !lock) acquire(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      try { lock?.release(); } catch {}
    };
  }, []);

  // ホール側に「厨房モニターは生きている」と伝え続ける
  useEffect(() => {
    const ping = () =>
      fetch('/api/kds/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station: station || 'all' }),
      }).catch(() => {});
    ping();
    const id = setInterval(ping, 20000);
    return () => clearInterval(id);
  }, [station]);

  const offlineSec = Math.round((Date.now() - lastOk) / 1000);
  const offline = offlineSec > OFFLINE_SEC;

  const groups = useMemo(() => {
    const map = new Map();
    for (const i of items) {
      const k = `${i.table_id}_${i.order_id}`;
      if (!map.has(k)) map.set(k, { key: k, table: i.table_name, source: i.source, created: i.created_at, items: [] });
      map.get(k).items.push(i);
    }
    return [...map.values()].sort((a, b) => new Date(a.created) - new Date(b.created));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, tick]);

  // from = 押した人が画面で見ていた状態。ほかの担当者が先に進めていたら店側で弾かれる。
  async function setStatus(id, status, reason = '', from = '') {
    const r = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, reason, from }),
    }).then((x) => x.json());
    if (!r.ok) alert(r.error || '更新できませんでした');
    load();
    return !!r.ok;
  }

  // 「提供済」にすると、その札はこの画面から消える。
  // 押し間違いに気づいても戻す手段が無いと、料理が出ていないのに出たことになってしまう。
  // そこで、直前の1件だけ画面下に残して、しばらくの間そこから戻せるようにする。
  async function advance(i) {
    const next = NEXT[i.status];
    const ok = await setStatus(i.id, next, '', i.status);
    if (ok && next === 'served') {
      setUndo({ id: i.id, name: i.name, table: i.table_name, at: Date.now() });
      setTimeout(() => setUndo((u) => (u && u.id === i.id ? null : u)), 30000);
    }
  }

  async function undoServed() {
    if (!undo) return;
    const ok = await setStatus(undo.id, 'ready', '', 'served');
    if (ok) setUndo(null);
  }

  // 2点以上ある行は「何点を取り消すか」を先に聞く（1点だけ作り直す場面が実際に多い）
  async function voidItem(i) {
    const have = Number(i.qty);
    let qty = have;
    if (have > 1) {
      const v = prompt(`${i.name}（${have}点）のうち、何点を取消しますか？`, String(have));
      if (v === null) return;
      qty = Number(v);
      if (!Number.isFinite(qty) || qty < 1 || qty > have) return alert(`1〜${have}の数を入力してください`);
    }
    const reason = prompt(`${i.name} を${qty}点 取消します。理由を入力してください（記録に残ります）`);
    if (!reason || !reason.trim()) return;
    const r = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: i.id, status: 'void', reason: reason.trim(), qty }),
    }).then((x) => x.json());
    if (!r.ok) alert(r.error || '取消できませんでした');
    load();
  }

  const counts = {
    received: items.filter((i) => i.status === 'received').length,
    cooking: items.filter((i) => i.status === 'cooking').length,
    ready: items.filter((i) => i.status === 'ready').length,
  };

  return (
    <div className="kds">
      {offline && (
        <div className="kds-offline">
          <div style={{ fontSize: 60 }}>⚠️</div>
          <div style={{ fontSize: 30, fontWeight: 800 }}>店のシステムにつながっていません</div>
          <div style={{ fontSize: 18, lineHeight: 1.8 }}>
            この画面は{offlineSec}秒前から更新できていません。<br />
            新しい注文が届いていない可能性があります。<br />
            <b>Wi-Fiの状態を確認し、ホールに口頭で確認してください。</b>
          </div>
          <button className="btn btn-lg" onClick={load}>再接続する</button>
        </div>
      )}

      <div className="topbar" style={{ background: '#0e1013' }}>
        <Link href="/" className="brand" style={{ color: '#fff' }}>厨房モニター</Link>
        {STATIONS.map(([v, label]) => (
          <button
            key={v}
            className="btn btn-sm"
            style={{
              background: station === v ? 'var(--accent)' : 'transparent',
              color: station === v ? '#fff' : '#c9cdd6',
              borderColor: station === v ? 'var(--accent)' : '#333',
            }}
            onClick={() => setStation(v)}
          >
            {label}
          </button>
        ))}
        <div className="spacer" />
        <div style={{ color: '#c9cdd6', fontSize: 13, fontWeight: 700 }}>
          受付 {counts.received}／調理中 {counts.cooking}／完成 {counts.ready}
        </div>
      </div>

      <div className="wrap">
        {groups.length === 0 && (
          <div style={{ textAlign: 'center', padding: 80, color: '#6b7280', fontSize: 18 }}>
            現在、調理待ちの注文はありません
          </div>
        )}
        <div className="grid g4">
          {groups.map((g) => {
            const min = elapsedMin(g.created);
            const level = min >= 15 ? 'late' : min >= 8 ? 'warn' : '';
            return (
              <div key={g.key} className={`kcard ${level}`}>
                <div className="row-between">
                  <div className="ktable">テーブル {g.table}</div>
                  <div className={`kelapsed ${level}`}>{min}分</div>
                </div>
                <div style={{ fontSize: 11, color: '#8b90a0', marginTop: 2 }}>
                  {g.source === 'staff' ? 'スタッフ入力' : g.source === 'tablet' ? 'タブレット' : 'QR注文'}
                </div>
                <div style={{ marginTop: 8 }}>
                  {g.items.map((i) => (
                    <div key={i.id} className="kitem">
                      <div className="row-between">
                        <div>
                          <span style={{ color: '#ffd166' }}>{i.qty}点</span>　{i.name}
                        </div>
                        <span className="kelapsed">{STATUS_LABEL[i.status]}</span>
                      </div>
                      {i.options && <div style={{ fontSize: 13, color: '#8b90a0' }}>{i.options}</div>}
                      {i.note && <div style={{ fontSize: 13, color: '#fbbf24' }}>備考: {i.note}</div>}
                      <div className="row" style={{ marginTop: 6, gap: 6 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => advance(i)}>
                          {NEXT_LABEL[i.status]}
                        </button>
                        {PREV[i.status] && (
                          <button
                            className="btn btn-sm"
                            style={{ background: 'transparent', color: '#c9cdd6', borderColor: '#333' }}
                            onClick={() => setStatus(i.id, PREV[i.status], '', i.status)}
                            title="押し間違いを1つ前に戻します"
                          >
                            ← 戻す
                          </button>
                        )}
                        {VOID_ROLES.includes(role) && (
                          <button
                            className="btn btn-sm"
                            style={{ background: 'transparent', color: '#8b90a0', borderColor: '#333' }}
                            onClick={() => voidItem(i)}
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {undo && (
        <div
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
            background: '#1b1f27', borderTop: '2px solid #2a2f3a',
            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
          }}
        >
          <div style={{ color: '#c9cdd6', fontSize: 15, fontWeight: 700 }}>
            テーブル {undo.table}「{undo.name}」を提供済にしました
          </div>
          <div className="spacer" />
          <button className="btn" onClick={undoServed}>押し間違い　→　戻す</button>
          <button
            className="btn btn-sm"
            style={{ background: 'transparent', color: '#8b90a0', borderColor: '#333' }}
            onClick={() => setUndo(null)}
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}
