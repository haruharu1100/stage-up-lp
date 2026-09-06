/**
 * 会員登録の画面（/signup の中身）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面が守ること
 * ═══════════════════════════════════════════════════════
 *
 *   1) 同意のチェックを、はじめから入れておかないこと。
 *
 *      入れておくと「押した」ことになりません。
 *      あとで「同意した覚えがない」と言われたとき、
 *      こちらには何も残っていません。
 *      押していただいた時刻は、サーバーが記録します。
 *
 *   2) 「そのメールアドレスは登録済みです」と出さないこと。
 *
 *      出した瞬間、この画面は会員名簿を作る道具になります。
 *      パスワードすら要りません。
 *      すでにご登録の方には、そのアドレス宛のメールでお知らせします。
 *      本人だけが気づけます。
 *
 *      ★サーバーが返した文を、そのまま出すこと。
 *        画面側で親切に言い換えると、その1か所から中身が漏れます。
 *
 *   3) 登録できても、ここでログインさせないこと。
 *
 *      メールを受け取れることを確かめてから、入っていただきます。
 *      ここで入場券を渡すと、他人のアドレスで登録した人が
 *      そのまま中に入れます。
 */

"use client";

import { useState } from "react";
import Link from "next/link";

const FIELD =
  "w-full rounded-xl border border-silver bg-white px-4 py-3 text-note text-slate outline-none transition-colors placeholder:text-slate3/80 focus:border-blue-ink focus:ring-4 focus:ring-blue-pale";

export default function SignupForm({
  needTenantCode,
  demoMode,
}: {
  /** 会社コードの入力欄を出すか（既定の会社が決まっていないとき） */
  needTenantCode: boolean;
  /** 確認用の環境かどうか */
  demoMode: boolean;
}) {
  const [tenantCode, setTenantCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  /* ★既定は false。画面に出すだけで済ませないこと */
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          tenantCode: tenantCode.trim() || undefined,
          email: email.trim(),
          password,
          name: name.trim(),
          agreeTerms,
          agreePrivacy,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
      };

      if (!res.ok || !data.ok) {
        setError(data.message ?? "お申し込みを受け付けられませんでした。");
        return;
      }

      /* ★ここで「登録できました」と言い切らないこと。
           すでにご登録の方にも、まったく同じ文が出ます。 */
      setDone(data.message ?? "お申し込みを受け付けました。");
    } catch {
      setError(
        "通信に失敗しました。電波の状態をご確認のうえ、もう一度お試しください。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-paper2">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-[18%] -top-[24%] h-[38rem] w-[38rem] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.16),transparent_66%)]" />
        <div className="absolute -bottom-[30%] -right-[14%] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(27,75,216,0.12),transparent_66%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[26.5rem] flex-col justify-center px-4 py-12 sm:py-16">
        <div className="flex flex-col items-center text-center">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-navy2 to-navy shadow-lift2"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7"
              fill="none"
              stroke="#8FB6FF"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 8 12 4l8 4v8l-8 4-8-4Z" />
              <path d="M4 8l8 4 8-4M12 12v8" />
            </svg>
          </span>
          <p className="nb mt-4 text-[1.35rem] font-bold tracking-tight text-slate">
            新規会員登録
          </p>
          <p className="mt-1 text-note text-slate3">
            ご登録は無料です。1分ほどで終わります。
          </p>
        </div>

        <div className="mt-7 rounded-2xl border border-white/70 bg-white/85 p-6 shadow-float backdrop-blur-xl sm:p-7">
          {done ? (
            /* ── 受け付けたあとの画面 ──────────────
                 ★ここで「登録が完了しました」と書かないこと。
                   完了するのは、メールのリンクを開いていただいた時です。 */
            <div data-testid="signup-done">
              <p className="rounded-xl border border-blue-ink/20 bg-blue-pale px-4 py-3 text-note leading-[1.9] text-blue-ink">
                {done}
              </p>
              <p className="mt-4 text-note leading-[1.9] text-slate2">
                メールが届かないときは、迷惑メールフォルダをご確認ください。
                しばらく待っても届かない場合は、
                もう一度この画面からお申し込みください。
              </p>
              <Link
                href="/login"
                className="nb mt-5 block w-full rounded-xl bg-blue-ink px-5 py-3.5 text-center text-note font-bold text-white shadow-blue-lift transition-colors hover:bg-blue-deep"
              >
                ログイン画面へ
              </Link>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-4">
                {needTenantCode && (
                  <label className="block">
                    <span className="block text-note font-bold text-slate2">
                      会社コード
                    </span>
                    <input
                      className={`${FIELD} mt-2`}
                      type="text"
                      autoComplete="organization"
                      spellCheck={false}
                      /* ★ここに、それらしい会社コードの例を書かないこと。
                           本物のお客様が、その例をご自分のコードだと思って
                           そのまま入れてしまいます。書式だけを示します。 */
                      placeholder="半角英数字"
                      value={tenantCode}
                      onChange={(e) => setTenantCode(e.target.value)}
                    />
                  </label>
                )}

                <label className="block">
                  <span className="block text-note font-bold text-slate2">
                    メールアドレス
                  </span>
                  <input
                    className={`${FIELD} mt-2`}
                    type="email"
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                  />
                  <span className="mt-2 block text-note leading-[1.7] text-slate3">
                    ご確認のメールをお送りします。受け取れるアドレスをご入力ください。
                  </span>
                </label>

                <label className="block">
                  <span className="block text-note font-bold text-slate2">
                    パスワード
                  </span>
                  <input
                    className={`${FIELD} mt-2`}
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    placeholder="10文字以上"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(null);
                    }}
                  />
                  <span className="mt-2 block text-note leading-[1.7] text-slate3">
                    10文字以上。数字だけ・英字だけは使えません。
                  </span>
                </label>

                <label className="block">
                  <span className="block text-note font-bold text-slate2">
                    お名前・ニックネーム
                    <span className="ml-2 font-normal text-slate3">（任意）</span>
                  </span>
                  <input
                    className={`${FIELD} mt-2`}
                    type="text"
                    name="name"
                    autoComplete="nickname"
                    maxLength={40}
                    placeholder="ごろごろ太郎"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </div>

              {/* ── 同意 ────────────────────────────
                    ★はじめからチェックを入れておかないこと。
                      押していただいた事実が、記録に残らなくなります。 */}
              <div className="mt-5 space-y-3 rounded-xl border border-edge2 bg-paper2 px-4 py-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    name="agreeTerms"
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-silver text-blue-ink focus:ring-blue-pale"
                    checked={agreeTerms}
                    onChange={(e) => {
                      setAgreeTerms(e.target.checked);
                      setError(null);
                    }}
                  />
                  <span className="text-note leading-[1.8] text-slate2">
                    利用規約に同意します
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    name="agreePrivacy"
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-silver text-blue-ink focus:ring-blue-pale"
                    checked={agreePrivacy}
                    onChange={(e) => {
                      setAgreePrivacy(e.target.checked);
                      setError(null);
                    }}
                  />
                  <span className="text-note leading-[1.8] text-slate2">
                    プライバシーポリシーに同意します
                  </span>
                </label>

                {/* ★ここに、この製品を作った会社の情報を出さないこと。
                      お客様が取引するのは、ご利用の店舗です。 */}
                <p className="text-note leading-[1.8] text-slate3">
                  適用されるのは、ご利用の店舗が定める規約とポリシーです。
                </p>
              </div>

              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-note leading-[1.8] text-danger-ink"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="nb mt-5 w-full rounded-xl bg-blue-ink px-5 py-3.5 text-note font-bold text-white shadow-blue-lift transition-colors hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "受け付けています…" : "この内容で登録する"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-note leading-[1.8] text-slate3">
          すでにアカウントをお持ちですか？
          <Link
            href="/login"
            className="nb ml-1 font-bold text-blue-ink underline underline-offset-4 hover:text-blue-deep"
          >
            ログイン
          </Link>
        </p>

        {/* 表示OK: demoAllowed() が真のときだけ。DEMO_MODE=true かつ本番でないの
              両方がそろわないと出ません（lib/server/demo.ts）。本番では値に関わらず閉じます */}
        {demoMode && (
          <p className="mt-6 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.85] text-warn-ink">
            <span className="mr-2 font-bold">ご案内</span>
            これは確認用の環境です。決済・メール送信・SMS送信・配送業者は
            つながっていません。
          </p>
        )}
      </div>
    </div>
  );
}
