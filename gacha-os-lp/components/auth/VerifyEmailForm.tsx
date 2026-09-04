/**
 * メールアドレスの確認（/verify-email の中身）。
 *
 * ═══════════════════════════════════════════════════════
 * ★画面を開いただけで、確認を済ませないこと
 * ═══════════════════════════════════════════════════════
 *
 *   合言葉（token）は一度しか使えません。
 *   画面を開いた瞬間に自動で送る作りにすると、
 *   メールソフトやセキュリティ製品の「先読み」が、
 *   本人より先に押して、使い切ってしまいます。
 *
 *   そうなると、本人が開いたときには
 *   「このリンクは使えません」だけが出ます。
 *   本人は何も悪いことをしていないのに、進めなくなります。
 *
 *   ですから、ボタンを1つ押していただきます。
 *   ひと手間ですが、増やす価値のあるひと手間です。
 *
 * ★確認できても、ここでログインさせないこと。
 *   メールを覗ける立場の人が、そのまま中に入れてしまいます。
 */

"use client";

import { useState } from "react";
import Link from "next/link";

type Phase = "READY" | "DONE" | "FAILED";

export default function VerifyEmailForm({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("READY");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);

    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ token }),
      });

      const data = (await res.json()) as { ok?: boolean; message?: string };

      if (!res.ok || !data.ok) {
        setPhase("FAILED");
        setMessage(data.message ?? "このリンクは使えません。");
        return;
      }

      setPhase("DONE");
      setMessage(data.message ?? "メールアドレスのご確認が完了しました。");
    } catch {
      setPhase("FAILED");
      setMessage(
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
      </div>

      <div className="relative mx-auto flex w-full max-w-[26.5rem] flex-col justify-center px-4 py-16">
        <div className="rounded-2xl border border-white/70 bg-white/85 p-6 shadow-float backdrop-blur-xl sm:p-7">
          <p className="nb text-[1.2rem] font-bold tracking-tight text-slate">
            メールアドレスのご確認
          </p>

          {token === "" ? (
            <p
              role="alert"
              data-testid="verify-failed"
              className="mt-4 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-note leading-[1.85] text-danger-ink"
            >
              確認用のリンクが正しくありません。
              メールに記載のリンクを、そのまま開いてください。
            </p>
          ) : phase === "READY" ? (
            <>
              <p className="mt-3 text-note leading-[1.9] text-slate2">
                下のボタンを押すと、ご確認が完了します。
              </p>
              <button
                type="button"
                data-testid="verify-submit"
                disabled={busy}
                onClick={() => void submit()}
                className="nb mt-5 w-full rounded-xl bg-blue-ink px-5 py-3.5 text-note font-bold text-white shadow-blue-lift transition-colors hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "確認しています…" : "メールアドレスを確認する"}
              </button>
            </>
          ) : phase === "DONE" ? (
            <div data-testid="verify-done">
              <p className="mt-4 rounded-xl border border-blue-ink/20 bg-blue-pale px-4 py-3 text-note leading-[1.9] text-blue-ink">
                {message}
              </p>
              <Link
                href="/login"
                className="nb mt-5 block w-full rounded-xl bg-blue-ink px-5 py-3.5 text-center text-note font-bold text-white shadow-blue-lift transition-colors hover:bg-blue-deep"
              >
                ログインする
              </Link>
            </div>
          ) : (
            <div data-testid="verify-failed">
              <p
                role="alert"
                className="mt-4 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-note leading-[1.85] text-danger-ink"
              >
                {message}
              </p>
              <p className="mt-4 text-note leading-[1.9] text-slate2">
                ログインしていただくと、確認のメールをもう一度お送りできます。
              </p>
              <Link
                href="/login"
                className="nb mt-5 block w-full rounded-xl border border-silver bg-white px-5 py-3.5 text-center text-note font-bold text-slate2 transition-colors hover:border-blue-ink hover:text-blue-ink"
              >
                ログイン画面へ
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
