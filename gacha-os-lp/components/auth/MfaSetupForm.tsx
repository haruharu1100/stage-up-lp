"use client";

/**
 * 二段階認証の登録画面。
 *
 * ═══════════════════════════════════════════════════════
 * ★登録が途中で終わった人を、締め出さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ここでいちばん起きやすい事故は、これです。
 *
 *       「有効にした」ことになったのに、
 *        認証アプリ側には登録できていなかった
 *
 *   こうなると、その人は二度と入れません。
 *   6桁を求められるのに、6桁を出せる場所が無いからです。
 *
 *   だから、6桁を1回通せたときだけ、有効にします。
 *   この画面を閉じても、有効にはなりません。
 *   もう一度ここへ来て、やり直せます。
 *
 * ═══════════════════════════════════════════════════════
 * ★QRの画像を、外のサービスで作らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「QR画像を作ってくれるURL」に、この文字列を渡すと、
 *   その会社に、6桁を作るための鍵をそのまま渡すことになります。
 *
 *   ですから、ここでは文字列を、そのまま見せます。
 *   認証アプリには「手入力（セットアップキー）」の欄があります。
 *   見た目は地味ですが、鍵は外に出ません。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postHeaders } from "@/lib/csrf";

const FIELD =
  "w-full rounded-xl border border-silver bg-white px-4 py-3 text-note text-slate outline-none transition-colors placeholder:text-slate3/80 focus:border-blue-ink focus:ring-4 focus:ring-blue-pale";

export default function MfaSetupForm({
  email,
  required,
}: {
  email: string;
  /** 登録を済ませないと先へ進めない人か */
  required: boolean;
}) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/begin", {
        method: "POST",
        headers: postHeaders(),
        body: "{}",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        secret?: string;
        message?: string;
      };
      if (!res.ok || !data.ok || !data.secret) {
        setError(data.message ?? "登録をはじめられませんでした。");
        return;
      }
      setSecret(data.secret);
    } catch {
      setError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/confirm", {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        next?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "6桁の数字を確認できませんでした。");
        setCode("");
        return;
      }
      router.replace(data.next ?? "/client-demo/dashboard");
      router.refresh();
    } catch {
      setError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-paper2">
      <div className="relative mx-auto flex w-full max-w-[28rem] flex-col justify-center px-4 py-12 sm:py-16">
        <p className="nb text-note font-bold text-blue-ink">
          {required ? "つづいて、認証アプリの登録をお願いします" : "認証アプリの登録"}
        </p>
        <h1 className="mt-2 text-[1.35rem] font-bold tracking-tight text-slate">
          パスワードだけでは、守りきれません
        </h1>
        <p className="mt-3 text-note leading-[1.8] text-slate3">
          管理画面では、お客様のポイント（お金と同じもの）が動きます。
          パスワードが漏れたときに、それだけで入られないようにします。
          お手元のスマートフォンに、認証アプリ（Google認証システムなど）をご用意ください。
        </p>

        <div className="mt-6 rounded-2xl border border-white/70 bg-white/85 p-6 shadow-float backdrop-blur-xl sm:p-7">
          {!secret ? (
            <>
              <ol className="space-y-2 text-note leading-[1.8] text-slate2">
                <li>① スマートフォンに認証アプリを入れる</li>
                <li>② 下のボタンを押して、登録用のキーを出す</li>
                <li>③ アプリにキーを入れて、出てきた6桁をここに入れる</li>
              </ol>
              <button
                type="button"
                disabled={busy}
                onClick={() => void begin()}
                className="nb mt-5 w-full rounded-xl bg-blue-ink px-5 py-3.5 text-note font-bold text-white shadow-blue-lift transition-colors hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "準備しています…" : "登録用のキーを出す"}
              </button>
            </>
          ) : (
            <>
              <p className="text-note font-bold text-slate2">
                このキーを、認証アプリの「手入力（セットアップキー）」に入れてください
              </p>
              <p className="nb mt-2 select-all break-all rounded-xl border border-silver bg-paper2 px-4 py-3 text-note tracking-[0.08em] text-slate">
                {secret}
              </p>
              <p className="mt-2 text-note leading-[1.7] text-slate3">
                アカウント名の欄には {email} をお使いください。
                <br />
                ★このキーは、他の方に見せないでください。
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirm();
                }}
                className="mt-5"
              >
                <label className="block">
                  <span className="block text-note font-bold text-slate2">
                    アプリに出ている6桁の数字
                  </span>
                  <input
                    className={`${FIELD} mt-2 tracking-[0.35em]`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, ""));
                      setError(null);
                    }}
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className="nb mt-4 w-full rounded-xl bg-blue-ink px-5 py-3.5 text-note font-bold text-white shadow-blue-lift transition-colors hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "確認しています…" : "登録を終える"}
                </button>
              </form>

              <p className="mt-4 text-note leading-[1.7] text-slate3">
                6桁が通るまで、二段階認証は有効になりません。
                うまくいかないときは、この画面を開き直して、はじめからやり直せます。
              </p>
            </>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-silver bg-paper2 px-4 py-3 text-note leading-[1.7] text-slate2"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
