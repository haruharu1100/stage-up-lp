'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const HOME_BY_ROLE = {
  owner: '/admin',
  admin: '/admin',
  manager: '/admin',
  staff: '/pos',
  kitchen: '/kitchen',
};

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '';
  const [tab, setTab] = useState('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [store, setStore] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(null);

  // テストプレイ用のワンタップ入場（開発中のみ表示される）
  useEffect(() => {
    fetch('/api/auth/demo')
      .then((x) => x.json())
      .then((r) => setDemo(r.enabled ? r.stores : null))
      .catch(() => setDemo(null));
  }, []);

  async function demoLogin(storeId, role) {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/auth/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, role }),
      }).then((x) => x.json());
      if (!r.ok) {
        setErr(r.error || '入れませんでした');
        return;
      }
      router.replace(next || HOME_BY_ROLE[r.role] || '/');
      router.refresh();
    } catch {
      setErr('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const url = tab === 'email' ? '/api/auth/login' : '/api/auth/pin';
      const body = tab === 'email' ? { email, password } : { store: store.trim(), pin };
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((x) => x.json());
      if (!r.ok) {
        setErr(r.error || 'ログインできませんでした');
        return;
      }
      router.replace(next || HOME_BY_ROLE[r.role] || '/');
      router.refresh();
    } catch {
      setErr('通信に失敗しました。電波の状態をご確認ください');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loginwrap">
      <div className="card logincard">
        <div className="brand" style={{ fontSize: 22 }}>飲食店OS</div>
        <div className="muted" style={{ marginBottom: 16 }}>店舗の管理画面にログインします。</div>

        {demo && demo.length > 0 && (
          <div className="demobox">
            <div className="demotitle">テストプレイ（パスワード不要）</div>
            <div className="muted" style={{ marginBottom: 10, lineHeight: 1.6 }}>
              見たい立場をタップするとそのまま入れます。権限によって見える情報が変わります。
            </div>
            {demo.map((s) => (
              <div key={s.id} style={{ marginBottom: 10 }}>
                <div className="demostore">{s.name}</div>
                <div className="demoroles">
                  {s.roles.map((r) => (
                    <button
                      key={r.role} type="button" className="btn btn-sm" disabled={busy}
                      onClick={() => demoLogin(s.id, r.role)} title={r.name}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              この入口はテストプレイ中だけ表示されます。本番運用に切り替えると自動的に消え、
              メールとパスワード（またはPIN）だけになります。
            </div>
          </div>
        )}

        <div className="tabs">
          <button type="button" className={tab === 'email' ? 'on' : ''} onClick={() => setTab('email')}>
            メールでログイン
          </button>
          <button type="button" className={tab === 'pin' ? 'on' : ''} onClick={() => setTab('pin')}>
            店舗コード + PIN
          </button>
        </div>

        <form onSubmit={submit}>
          {tab === 'email' ? (
            <>
              <label className="lbl">メールアドレス</label>
              <input
                className="input" type="email" autoComplete="username" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com"
              />
              <label className="lbl">パスワード</label>
              <input
                className="input" type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="muted" style={{ marginTop: 8 }}>オーナー・管理者・店長の方はこちらです。</div>
            </>
          ) : (
            <>
              <label className="lbl">店舗コード</label>
              <input
                className="input mono" value={store} onChange={(e) => setStore(e.target.value)} placeholder="st_xxxxxxxx"
              />
              <label className="lbl">PIN（4桁）</label>
              <input
                className="input mono" inputMode="numeric" maxLength={8} value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="0000"
                style={{ fontSize: 24, letterSpacing: 6, textAlign: 'center' }}
              />
              <div className="muted" style={{ marginTop: 8 }}>
                ホール・厨房の端末はこちら。店舗コードは管理画面で確認できます。
              </div>
            </>
          )}

          {err && <div className="alert" style={{ marginTop: 12 }}>{err}</div>}

          <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 16 }} disabled={busy}>
            {busy ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
