/**
 * 本物のログイン画面（/login の中身）。
 *
 * ═══════════════════════════════════════════════════════
 * ★デモの入口（Gate.tsx）との違い
 * ═══════════════════════════════════════════════════════
 *
 *   Gate.tsx は「見ていただくための入口」です。
 *   打った文字はどこにも送らず、その場で捨てます。
 *
 *   こちらは本物です。打った合言葉はサーバーへ送られ、
 *   DBの登録と照合され、通れば入場券（クッキー）が返ってきます。
 *   同じ見た目にしてありますが、中身はまったく別物です。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面が守ること
 * ═══════════════════════════════════════════════════════
 *
 *   1) 入場券を、画面側で保存しないこと。
 *      サーバーが httpOnly のクッキーで返します。
 *      画面の script からは読めません。読めないのが正しい形です。
 *      localStorage に入れると、外部部品が1つ乗っ取られただけで
 *      全員ぶん抜かれます。
 *
 *   2) 失敗の理由を、こちらで作り変えないこと。
 *      サーバーが返した文をそのまま出します。
 *      「そのメールは登録されていません」と親切にした瞬間、
 *      片っ端から試して会員名簿を作られます。
 *
 *   3) 通ったら、もといた場所へ戻すこと。
 *      戻り先は next で受け取りますが、
 *      安全か どうかは lib/returnTo.ts が決めます。
 *      ここで判断を書き足さないこと。判断が2か所に増えると、
 *      片方だけ直した日に穴が開きます。
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeReturnTo } from "@/lib/returnTo";

type Kind = "ADMIN" | "CUSTOMER";
type Step = "PASSWORD" | "MFA";

const FIELD =
  "w-full rounded-xl border border-silver bg-white px-4 py-3 text-note text-slate outline-none transition-colors placeholder:text-slate3/80 focus:border-blue-ink focus:ring-4 focus:ring-blue-pale";

export default function LoginForm({
  next,
  needTenantCode,
  demoMode,
}: {
  /** ログイン後の戻り先。すでにサーバー側で安全な形にしてあります */
  next: string;
  /** 会社コードの入力欄を出すか（既定の会社が決まっていないとき） */
  needTenantCode: boolean;
  /** デモの案内を出してよいか */
  demoMode: boolean;
}) {
  const router = useRouter();

  const [kind, setKind] = useState<Kind>("ADMIN");
  const [step, setStep] = useState<Step>("PASSWORD");
  const [tenantCode, setTenantCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* ★same-origin にすること。
             include にすると、別サイトへ送るときにも
             クッキーが付いていく形を、うっかり許すことになります。 */
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          kind,
          tenantCode: tenantCode.trim() || undefined,
          email: email.trim(),
          password,
          mfaCode: step === "MFA" ? mfaCode : undefined,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        code?: string;
        message?: string;
        retryAfterMinutes?: number;
        user?: { mustChangePassword?: boolean };
      };

      if (!res.ok || !data.ok) {
        /* 6桁が要る、と言われた。ここで入力欄を出す */
        if (data.code === "MFA_REQUIRED") {
          setStep("MFA");
          setMfaCode("");
          setNotice(
            "パスワードは確認できました。お手元の認証アプリに出ている6桁を入れてください。",
          );
          return;
        }
        if (data.code === "MFA_INVALID") {
          setStep("MFA");
          setMfaCode("");
        }

        const wait =
          typeof data.retryAfterMinutes === "number"
            ? `（あと約${data.retryAfterMinutes}分お待ちください）`
            : "";
        setError((data.message ?? "ログインできませんでした。") + wait);
        return;
      }

      /* ★合言葉は本文に入っていません。クッキーで受け取っています。
           ここで保存する処理を足さないこと。 */
      if (data.user?.mustChangePassword) {
        /* ★これは「まだ作っていない」ところです。
             できていないものを、できたことにして黙って進めないこと。 */
        setNotice(
          "初回のパスワードのままです。入ったあと、設定からパスワードを変更してください。",
        );
      }

      /* ★念のため、こちらでも戻り先を確かめ直します。
           サーバーで確かめてありますが、ここは最後の分かれ道です。 */
      router.replace(safeReturnTo(next));
      router.refresh();
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
          <p className="mt-4 text-[1.35rem] font-bold tracking-tight text-slate">
            AI GACHA OS
          </p>
          <p className="nb mt-1 text-note font-bold text-blue-ink">ログイン</p>
        </div>

        <div className="mt-7 rounded-2xl border border-white/70 bg-white/85 p-6 shadow-float backdrop-blur-xl sm:p-7">
          {/* だれとして入るか。運営と、お客様で入口が違います */}
          <div
            role="tablist"
            aria-label="ログインの種類"
            className="flex gap-1 rounded-xl border border-edge2 bg-paper2 p-1"
          >
            {(
              [
                { key: "ADMIN" as Kind, label: "運営の方" },
                { key: "CUSTOMER" as Kind, label: "お客様" },
              ]
            ).map((t) => {
              const on = t.key === kind;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    setKind(t.key);
                    setStep("PASSWORD");
                    setError(null);
                    setNotice(null);
                  }}
                  className={`nb flex-1 rounded-lg px-2 py-2 text-note font-bold transition-colors ${
                    on
                      ? "bg-white text-blue-ink shadow-lift"
                      : "text-slate3 hover:text-slate2"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {step === "PASSWORD" ? (
              <div className="mt-5 space-y-4">
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
                      placeholder="例：DEMO"
                      value={tenantCode}
                      onChange={(e) => setTenantCode(e.target.value)}
                    />
                    <span className="mt-2 block text-note leading-[1.7] text-slate3">
                      ご契約時にお伝えしているコードです。
                    </span>
                  </label>
                )}

                <label className="block">
                  <span className="block text-note font-bold text-slate2">
                    メールアドレス
                  </span>
                  <input
                    className={`${FIELD} mt-2`}
                    type="email"
                    autoComplete="username"
                    spellCheck={false}
                    placeholder="admin@example.co.jp"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                  />
                </label>

                <label className="block">
                  <span className="block text-note font-bold text-slate2">
                    パスワード
                  </span>
                  <input
                    className={`${FIELD} mt-2`}
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(null);
                    }}
                  />
                </label>
              </div>
            ) : (
              <div className="mt-5">
                <label className="block">
                  <span className="block text-note font-bold text-slate2">
                    6桁の数字
                  </span>
                  <input
                    className={`${FIELD} num mt-2 text-center text-[1.35rem] font-bold tracking-[0.42em]`}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={mfaCode}
                    onChange={(e) => {
                      setMfaCode(e.target.value.replace(/\D/g, ""));
                      setError(null);
                    }}
                  />
                </label>
                <p className="mt-2 text-note leading-[1.8] text-slate3">
                  認証アプリに30秒ごとに出る数字です。
                  同じ数字は二度使えません。
                </p>
              </div>
            )}

            {notice && (
              <p className="mt-4 rounded-xl border border-blue-ink/20 bg-blue-pale px-4 py-3 text-note leading-[1.8] text-blue-ink">
                {notice}
              </p>
            )}

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
              {busy
                ? "確認しています…"
                : step === "MFA"
                  ? "管理画面に入る"
                  : "ログイン"}
            </button>

            {step === "MFA" && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setStep("PASSWORD");
                    setMfaCode("");
                    setError(null);
                    setNotice(null);
                  }}
                  className="nb text-note font-bold text-slate3 underline underline-offset-4 hover:text-slate2"
                >
                  最初からやり直す
                </button>
              </div>
            )}
          </form>
        </div>

        {/* ★戻り先を、必ず本人に見せること。
              「ログインしたら、なぜかこの画面に来た」を作らないためです。 */}
        <p className="mt-5 text-center text-note leading-[1.8] text-slate3">
          ログインすると
          <span className="nb mx-1 font-bold text-slate2">{safeReturnTo(next)}</span>
          へ戻ります。
        </p>

        {demoMode && (
          <p className="mt-6 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.85] text-warn-ink">
            <span className="mr-2 font-bold">ご案内</span>
            これは確認用の環境です。決済・メール送信・SMS送信・配送業者は
            つながっていません。担当者も会員も、すべて架空です。
          </p>
        )}
      </div>
    </div>
  );
}
