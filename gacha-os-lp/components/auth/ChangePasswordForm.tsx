"use client";

/**
 * パスワードを変える画面。
 *
 * ═══════════════════════════════════════════════════════
 * ★「あとで変えてください」で済ませないこと
 * ═══════════════════════════════════════════════════════
 *
 *   お知らせ帯は読まれません。読まれても閉じられます。
 *   その結果、仮パスワードのままの管理者が半年後も残ります。
 *
 *   仮パスワードは、チャットに貼られ、口で読み上げられ、
 *   付箋に書かれたものです。渡した先から漏れている前提のものです。
 *   ですから、ここは通さずに止めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★強さの案内は出すが、条件で縛りすぎないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「大文字・数字・記号を必ず1つずつ」を求めると、
 *   人は Password1! のような形に寄ります。
 *   条件は満たしますが、真っ先に試される形です。
 *
 *   だから、長さを主に見ます（判定は lib/server/password.ts の1か所）。
 *   ここでは、その同じ考え方を、言葉で伝えるだけにします。
 *
 * ★ここでの判定を「守り」と呼ばないこと。
 *   ブラウザの中の判定は、開発者ツールで飛ばせます。
 *   実際に断っているのは、いつでもサーバー側です。
 *   ここは、送る前に気づけるようにするための親切です。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postHeaders } from "@/lib/csrf";

const FIELD =
  "w-full rounded-xl border border-silver bg-white px-4 py-3 text-note text-slate outline-none transition-colors placeholder:text-slate3/80 focus:border-blue-ink focus:ring-4 focus:ring-blue-pale";

/** 目安として出す長さ。★これを「安全の保証」として書かないこと */
const GOOD_LENGTH = 12;

export default function ChangePasswordForm({
  name,
  email,
  forced,
}: {
  name: string;
  email: string;
  /** 仮パスワードのままで、変えるまで先へ進めない状態か */
  forced: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* 送る前に気づけるように。★断っているのはサーバー側です */
  const tooShort = next.length > 0 && next.length < 10;
  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({
          currentPassword: current,
          newPassword: next,
          confirmPassword: confirm,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        next?: string;
      };

      if (!res.ok || !data.ok) {
        setError(data.message ?? "変更できませんでした。");
        return;
      }

      /* ★次にどこへ行くかは、サーバーが決めた行き先に従うこと。
           画面側で決めると、二段階認証の登録を飛ばす道ができます。 */
      router.replace(data.next ?? "/client-demo/dashboard");
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
      <div className="relative mx-auto flex w-full max-w-[28rem] flex-col justify-center px-4 py-12 sm:py-16">
        <p className="nb text-note font-bold text-blue-ink">
          {forced ? "はじめに、パスワードの変更をお願いします" : "パスワードの変更"}
        </p>
        <h1 className="mt-2 text-[1.35rem] font-bold tracking-tight text-slate">
          {forced
            ? "仮パスワードのままでは、先へ進めません"
            : "新しいパスワードを決めてください"}
        </h1>

        {forced && (
          <p className="mt-3 text-note leading-[1.8] text-slate3">
            仮パスワードは、チャットや口頭でお渡ししたものです。
            お渡しした時点から、ご本人以外も知り得る状態にあります。
            ここで、ご自身しか知らないものに変えてください。
          </p>
        )}

        <div className="mt-6 rounded-2xl border border-white/70 bg-white/85 p-6 shadow-float backdrop-blur-xl sm:p-7">
          <dl className="mb-5 space-y-1 text-note text-slate3">
            <div className="flex gap-3">
              <dt className="w-20 shrink-0">お名前</dt>
              <dd className="font-bold text-slate2">{name}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-20 shrink-0">メール</dt>
              <dd className="nb text-slate2">{email}</dd>
            </div>
          </dl>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-4">
              <label className="block">
                <span className="block text-note font-bold text-slate2">
                  {forced ? "仮パスワード（いまのもの）" : "いまのパスワード"}
                </span>
                <input
                  className={`${FIELD} mt-2`}
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => {
                    setCurrent(e.target.value);
                    setError(null);
                  }}
                />
                {/* ★なぜ聞くのかを書くこと。
                      書かないと「知っているはずなのに、なぜ？」になります。 */}
                <span className="mt-2 block text-note leading-[1.7] text-slate3">
                  席を外している間に書き換えられるのを防ぐため、もう一度うかがいます。
                </span>
              </label>

              <label className="block">
                <span className="block text-note font-bold text-slate2">
                  新しいパスワード
                </span>
                <input
                  className={`${FIELD} mt-2`}
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => {
                    setNext(e.target.value);
                    setError(null);
                  }}
                />
                <span className="mt-2 block text-note leading-[1.7] text-slate3">
                  10文字以上。{GOOD_LENGTH}文字を超えると、ぐっと破られにくくなります。
                  記号を混ぜるより、長くするほうが効きます。
                  <br />
                  他のサービスで使っているものは、使わないでください。
                </span>
                {tooShort && (
                  <span className="nb mt-2 block text-note font-bold text-blue-ink">
                    あと{10 - next.length}文字です。
                  </span>
                )}
              </label>

              <label className="block">
                <span className="block text-note font-bold text-slate2">
                  新しいパスワード（確認）
                </span>
                <input
                  className={`${FIELD} mt-2`}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setError(null);
                  }}
                />
                {mismatch && (
                  <span className="nb mt-2 block text-note font-bold text-blue-ink">
                    上と一致していません。
                  </span>
                )}
              </label>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-silver bg-paper2 px-4 py-3 text-note leading-[1.7] text-slate2"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="nb mt-5 w-full rounded-xl bg-blue-ink px-5 py-3.5 text-note font-bold text-white shadow-blue-lift transition-colors hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "変更しています…" : "パスワードを変更する"}
            </button>
          </form>

          <p className="mt-4 text-note leading-[1.7] text-slate3">
            変更すると、他の端末で開いたままになっているログインは切れます。
            いまお使いのこの画面は、そのままお使いいただけます。
          </p>
        </div>
      </div>
    </div>
  );
}
