/**
 * 管理サイトの入口。ログインと、2段階認証（MFA）。
 *
 * ═══════════════════════════════════════════════
 * ★ここは「製品の顔」です
 * ═══════════════════════════════════════════════
 *
 *   契約を検討している方が、いちばん最初に見る画面です。
 *   ここが説明ページに見えると、
 *   そのあと中身がどれだけ良くても「試作品」に見えます。
 *
 *   だから、本番の管理サイトと同じ形にします。
 *
 *       ログインID または メールアドレス
 *       パスワード
 *       ［ログイン］
 *       パスワードを忘れた方 ／ 2段階認証について
 *
 *   担当者の一覧は、ここには出しません。
 *   本番のログイン画面に、社員名簿が並ぶことはありません。
 *   担当の切り替えは、ログインしたあとの
 *   「デモ：担当を切り替える」に移しました。
 *
 * ═══════════════════════════════════════════════
 * ★安全のための決まり（絶対に緩めないこと）
 * ═══════════════════════════════════════════════
 *
 *   ・入力されたIDとパスワードは、どこにも送りません。
 *     照合もしません。変数に入れて、押された瞬間に捨てます。
 *     外に出す先が、そもそもコードの中に1行もありません。
 *
 *   ・パスワード欄には、必ず「入れないでください」と添えること。
 *     本物そっくりの入力欄を黙って置くと、
 *     本当に使っているパスワードを打ってしまう方が出ます。
 *     打たれてから謝るのでは、取り返しがつきません。
 *
 *   ・本番アカウントでは入れません、と画面で言い切ること。
 *     「入れると思って何度も試した」を作らないためです。
 *
 *   ・2段階認証の数字は、画面に出しておきます。
 *     本物は、お手元のアプリに30秒ごとに出る数字です。
 */

"use client";

import { useState, type ReactNode } from "react";
import type { Admin } from "@/lib/console/state";
import { ROLE_LABEL } from "@/lib/console/state";

/** デモの2段階認証コード。本物は、お手元のアプリに出る6桁です */
export const DEMO_MFA_CODE = "204815";

/* ══════════════════════════════════════════════
   共通の器（白 / 薄いブルー / 濃紺 / ガラス / やわらかい影）
   ══════════════════════════════════════════════ */

/**
 * ★ここで min-h-screen を使わないこと。
 *   この画面は、外側が「画面の高さちょうど・はみ出し禁止」の
 *   箱の中に入っています。中で画面いっぱいの高さを主張すると、
 *   上の切り替え帯のぶんだけ下がはみ出して、
 *   いちばん下のボタンが押せなくなります。
 *   残りの高さをもらって、自分の中でスクロールします。
 */
function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-paper2">
      {/* 背景。淡いブルーの光を2つ置くだけ。動かさない */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-[18%] -top-[24%] h-[38rem] w-[38rem] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.16),transparent_66%)]" />
        <div className="absolute -bottom-[30%] -right-[14%] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(27,75,216,0.12),transparent_66%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[26.5rem] flex-col justify-center px-4 py-10 sm:py-14">
        {children}
      </div>
    </div>
  );
}

/** 濃紺の角丸に頭文字。ロゴ画像を待たずに「製品」に見せるための印 */
function Brand({ sub }: { sub: string }) {
  return (
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
      <p className="nb mt-1 text-note font-bold text-blue-ink">{sub}</p>
    </div>
  );
}

/** ガラスのカード。影はやわらかく広く */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-7 rounded-2xl border border-white/70 bg-white/85 p-6 shadow-float backdrop-blur-xl sm:p-7">
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════
   入力欄
   ══════════════════════════════════════════════ */

const FIELD =
  "w-full rounded-xl border border-silver bg-white px-4 py-3 text-note text-slate outline-none transition-colors placeholder:text-slate3/80 focus:border-blue-ink focus:ring-4 focus:ring-blue-pale";

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="block text-note font-bold text-slate2">{children}</span>
  );
}

/** 主ボタン。濃いブルー。押せる場所はここだけ、と分かる濃さにする */
function Primary({
  children,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="nb w-full rounded-xl bg-blue-ink px-5 py-3.5 text-note font-bold text-white shadow-blue-lift transition-colors hover:bg-blue-deep"
    >
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════════
   STEP 1：ログイン
   ══════════════════════════════════════════════ */

export function Login({
  admins,
  onLogin,
}: {
  admins: Admin[];
  onLogin: (id: string) => void;
}) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [help, setHelp] = useState<"pw" | "mfa" | null>(null);

  /**
   * デモ管理者。
   *
   * ★ここで「1人目」を掴まないこと。
   *   見本データの並び順が変わった日に、
   *   権限の弱い担当で入ることになり、
   *   最初の画面から「権限がありません」が並びます。
   *   役割で選びます。
   */
  const demoAdmin =
    admins.find((a) => a.role === "SUPER_ADMIN") ?? admins[0];

  /**
   * 本番ログインは、ここでは成立させません。
   *
   * ★入力値を「使わない」こと。
   *   照合もしませんし、保存も送信もしません。
   *   何を打っても同じ案内に戻します。
   */
  const submit = () => {
    if (!id.trim() || !pw) {
      setMsg("ログインIDとパスワードを入力してください。");
      return;
    }
    setMsg(
      "このデモは、本番のアカウント基盤につながっていません。下の「デモ管理者としてログイン」からお進みください。",
    );
    setPw("");
  };

  return (
    <Stage>
      <Brand sub="管理サイト" />

      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-4">
            <label className="block">
              <Label>ログインID または メールアドレス</Label>
              <input
                className={`${FIELD} mt-2`}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="admin@example.co.jp"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setMsg(null);
                }}
              />
            </label>

            <label className="block">
              <Label>パスワード</Label>
              <input
                className={`${FIELD} mt-2`}
                type="password"
                autoComplete="off"
                placeholder="••••••••"
                value={pw}
                onChange={(e) => {
                  setPw(e.target.value);
                  setMsg(null);
                }}
              />
              {/* ★この一文を消さないこと。
                  本物そっくりの欄を黙って置くと、
                  本当のパスワードを打つ方が必ず出ます */}
              <span className="mt-2 block text-note leading-[1.7] text-slate3">
                ご確認用のデモです。実際にお使いのパスワードは入力しないでください。
              </span>
            </label>
          </div>

          {msg && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-blue-ink/20 bg-blue-pale px-4 py-3 text-note leading-[1.8] text-blue-ink"
            >
              {msg}
            </p>
          )}

          <div className="mt-5">
            <Primary type="submit">ログイン</Primary>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <MiniLink
              on={help === "pw"}
              onClick={() => setHelp(help === "pw" ? null : "pw")}
            >
              パスワードを忘れた方
            </MiniLink>
            <MiniLink
              on={help === "mfa"}
              onClick={() => setHelp(help === "mfa" ? null : "mfa")}
            >
              2段階認証について
            </MiniLink>
          </div>

          {help && (
            <p className="mt-3 rounded-xl border border-edge2 bg-paper2 px-4 py-3 text-note leading-[1.85] text-slate2">
              {help === "pw"
                ? "本番では、登録されたメールアドレス宛に再設定用のリンクをお送りします。リンクの有効期限は短く設定でき、再設定の記録は監査ログに残ります。このデモではメールを送信しません。"
                : "本番では、管理者の2段階認証を必須にできます。必須にすると、パスワードが漏れただけでは管理サイトに入れません。認証アプリ・SMS・メールから選べます。"}
            </p>
          )}
        </form>
      </Panel>

      {/* ══ デモの入口。本番の枠とは、はっきり分けて置く ══ */}
      <div className="mt-6">
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-edge" />
          <span className="nb text-label uppercase text-slate3">デモ</span>
          <span className="h-px flex-1 bg-edge" />
        </div>

        <button
          type="button"
          onClick={() => onLogin(demoAdmin.id)}
          className="nb mt-4 w-full rounded-xl border border-blue-ink/25 bg-white px-5 py-3.5 text-note font-bold text-blue-ink shadow-lift transition-colors hover:bg-blue-pale"
        >
          デモ管理者としてログイン
        </button>

        <p className="mt-3 text-center text-note leading-[1.8] text-slate3">
          入力は要りません。{ROLE_LABEL[demoAdmin.role]}として、
          本番と同じ画面に入ります。
        </p>
      </div>

      <p className="mt-7 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.85] text-warn-ink">
        <span className="mr-2 font-bold">ご案内</span>
        これは動作確認用のデモです。決済・メール送信・SMS送信・配送業者・本番データベースには、
        いっさいつながっていません。担当者も会員も、すべて架空です。
      </p>
    </Stage>
  );
}

function MiniLink({
  children,
  on,
  onClick,
}: {
  children: ReactNode;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={on}
      className={`nb text-note font-bold underline underline-offset-4 transition-colors ${
        on ? "text-blue-deep" : "text-blue-ink hover:text-blue-deep"
      }`}
    >
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════════
   STEP 2：2段階認証
   ══════════════════════════════════════════════ */

type Way = "app" | "sms" | "mail";

const WAY: { key: Way; label: string; note: string }[] = [
  {
    key: "app",
    label: "認証アプリ",
    note: "Google Authenticator などに30秒ごとに出る6桁を入れます。",
  },
  {
    key: "sms",
    label: "SMS",
    note: "登録の携帯番号あてに6桁をお送りします。このデモでは送信しません。",
  },
  {
    key: "mail",
    label: "メール",
    note: "登録のメールアドレスあてに6桁をお送りします。このデモでは送信しません。",
  },
];

export function Mfa({
  me,
  onOk,
  onBack,
}: {
  me: Admin;
  onOk: () => void;
  onBack: () => void;
}) {
  const [way, setWay] = useState<Way>("app");
  const [code, setCode] = useState("");
  const [ng, setNg] = useState(false);
  const now = WAY.find((w) => w.key === way)!;

  return (
    <Stage>
      <Brand sub="管理サイト" />

      <Panel>
        <p className="num text-note font-bold tracking-[0.18em] text-slate3">
          STEP 2 / 2
        </p>
        <h1 className="mt-1.5 text-[1.375rem] font-bold tracking-tight text-slate">
          2段階認証
        </h1>
        <p className="mt-2 text-note leading-[1.85] text-slate2">
          {me.name}（{ROLE_LABEL[me.role]}）としてログインしています。
          管理サイトは、パスワードだけでは開きません。
        </p>

        {/* 認証方法。本番で選べるものを、そのまま出す */}
        <div
          role="tablist"
          aria-label="認証方法"
          className="mt-5 flex gap-1 rounded-xl border border-edge2 bg-paper2 p-1"
        >
          {WAY.map((w) => {
            const on = w.key === way;
            return (
              <button
                key={w.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setWay(w.key);
                  setNg(false);
                }}
                className={`nb flex-1 rounded-lg px-2 py-2 text-note font-bold transition-colors ${
                  on
                    ? "bg-white text-blue-ink shadow-lift"
                    : "text-slate3 hover:text-slate2"
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-note leading-[1.8] text-slate3">{now.note}</p>

        <label className="mt-5 block">
          <Label>6桁の数字</Label>
          <input
            className={`${FIELD} num mt-2 text-center text-[1.35rem] font-bold tracking-[0.42em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            placeholder="000000"
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ""));
              setNg(false);
            }}
          />
        </label>

        {ng && (
          <p role="alert" className="mt-2 text-note font-bold text-danger-ink">
            数字が違います。デモのコードは {DEMO_MFA_CODE} です。
          </p>
        )}

        <div className="mt-5">
          <Primary onClick={() => (code === DEMO_MFA_CODE ? onOk() : setNg(true))}>
            管理画面に入る
          </Primary>
        </div>

        <p className="mt-4 text-note leading-[1.8] text-slate3">
          本番では、お手元の認証アプリに出る6桁を入れます。
          このデモのコードは
          <span className="num mx-1.5 font-bold text-blue-ink">{DEMO_MFA_CODE}</span>
          です。
        </p>
      </Panel>

      <div className="mt-6">
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-edge" />
          <span className="nb text-label uppercase text-slate3">デモ</span>
          <span className="h-px flex-1 bg-edge" />
        </div>

        <button
          type="button"
          onClick={onOk}
          className="nb mt-4 w-full rounded-xl border border-blue-ink/25 bg-white px-5 py-3.5 text-note font-bold text-blue-ink shadow-lift transition-colors hover:bg-blue-pale"
        >
          デモ認証を通過
        </button>

        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={onBack}
            className="nb text-note font-bold text-slate3 underline underline-offset-4 hover:text-slate2"
          >
            ログイン画面へ戻る
          </button>
        </div>
      </div>
    </Stage>
  );
}
