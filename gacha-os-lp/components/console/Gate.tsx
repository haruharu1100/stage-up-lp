/**
 * ログインと、2段階認証（MFA）。
 *
 * ═══════════════════════════════════════════════
 * ★なぜデモにログイン画面を付けるのか
 * ═══════════════════════════════════════════════
 *
 *   「管理画面です」と言っていきなり中身を出すと、
 *   本当に鍵がかかっているのかが伝わりません。
 *   管理画面はお金と個人情報が集まる場所なので、
 *   ここが甘いシステムは、それだけで選ばれません。
 *
 *   だから、入口の順番そのものを見てもらいます。
 *     ① どの担当としてログインするかを選ぶ
 *     ② パスワードだけでは入れない（2段階認証）
 *     ③ 役割ごとに、できることが違う
 *
 * ═══════════════════════════════════════════════
 * ★このデモの決まり（重要）
 * ═══════════════════════════════════════════════
 *
 *   ・実在のアカウントは使いません。全員が架空の担当者です。
 *   ・パスワードは入力させません。
 *     デモで本物らしいパスワード欄を出すと、
 *     本当のパスワードを打ってしまう方が出ます。
 *     打たせない作りにしておくのが、いちばん確実です。
 *   ・2段階認証の数字は、画面に出してあります。
 *     本物は、お手元のアプリに30秒ごとに出る数字です。
 */

"use client";

import { useState } from "react";
import type { Admin } from "@/lib/console/state";
import { ROLE_LABEL, can } from "@/lib/console/state";
import { Badge, Btn, DemoNote, inputClass } from "./ui";

/** デモの2段階認証コード。本物は、お手元のアプリに出る6桁です */
export const DEMO_MFA_CODE = "204815";

/** 役割ごとの、いちばん分かりやすい一言 */
const ROLE_NOTE: Record<string, string> = {
  SUPER_ADMIN: "全部できます。ポイントの承認もこの人が行います。",
  FINANCE: "ポイントの変更を申請できます。承認は別の人が行います。",
  OPERATOR: "ガチャの作成・公開・発送・返信ができます。お金には触れません。",
  SUPPORT: "問い合わせの返信と発送だけ。ポイントも不正判定も触れません。",
  SECURITY: "不正判定と監査ログの確認。ガチャの公開はできません。",
  VIEWER: "見るだけ。何も変更できません。",
};

export function Login({
  admins,
  onLogin,
}: {
  admins: Admin[];
  onLogin: (id: string) => void;
}) {
  return (
    <Frame
      step="1 / 2"
      title="ログイン"
      lead="どの担当としてログインするかを選んでください。役割によって、できることが変わります。"
    >
      <div className="space-y-3">
        {admins.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onLogin(a.id)}
            className="block w-full rounded-xl border border-edge bg-paper px-5 py-4 text-left transition-colors hover:border-blue-ink hover:bg-blue-pale/40"
          >
            <span className="flex flex-wrap items-center gap-3">
              <span className="text-[1.0625rem] font-bold text-slate">{a.name}</span>
              <Badge tone={a.role === "SUPER_ADMIN" ? "blue" : "neutral"}>
                {ROLE_LABEL[a.role]}
              </Badge>
              {can(a.role, "point.approve") && <Badge tone="ok">承認できる</Badge>}
            </span>
            <span className="mt-1.5 block text-note leading-[1.85] text-slate3">
              {ROLE_NOTE[a.role]}
            </span>
          </button>
        ))}
      </div>

      <DemoNote>
        全員が架空の担当者です。実在のアカウントではありません。
        パスワードは入力しません。デモで本物らしい入力欄を出すと、
        本当のパスワードを打ってしまう方がいるためです。
      </DemoNote>
    </Frame>
  );
}

export function Mfa({
  me,
  onOk,
  onBack,
}: {
  me: Admin;
  onOk: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [ng, setNg] = useState(false);
  const ok = code === DEMO_MFA_CODE;

  return (
    <Frame
      step="2 / 2"
      title="2段階認証"
      lead={`${me.name}（${ROLE_LABEL[me.role]}）としてログインしています。管理画面は、パスワードだけでは開きません。`}
    >
      <div className="rounded-xl border border-blue-pale bg-blue-pale/50 px-5 py-4">
        <p className="text-note text-slate2">
          本物では、お手元の認証アプリに30秒ごとに出る6桁を入れます。
          このデモでは、次の数字を入れてください。
        </p>
        <p className="num mt-2 text-[1.75rem] font-bold tracking-[0.3em] text-blue-ink">
          {DEMO_MFA_CODE}
        </p>
      </div>

      <div className="mt-5">
        <label className="block">
          <span className="text-note font-bold text-slate2">6桁の数字</span>
          <input
            className={`${inputClass} num mt-2 tracking-[0.3em]`}
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
          <p className="mt-2 text-note font-bold text-danger-ink">
            数字が違います。上に出ている6桁を入れてください。
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Btn kind="primary" onClick={() => (ok ? onOk() : setNg(true))}>
          管理画面に入る
        </Btn>
        <Btn kind="ghost" onClick={onBack}>
          別の担当に変える
        </Btn>
      </div>

      <p className="mt-5 text-note leading-[1.85] text-slate3">
        本物では、管理者の2段階認証を必須にできます。
        必須にすると、パスワードが漏れただけでは管理画面に入れません。
      </p>
    </Frame>
  );
}

function Frame({
  step,
  title,
  lead,
  children,
}: {
  step: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper2 px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-[36rem]">
        <p className="text-label uppercase text-blue-ink">AI GACHA OS ／ 管理画面</p>
        <div className="mt-4 rounded-2xl border border-edge bg-paper p-6 shadow-lift2 sm:p-8">
          <p className="num text-note font-bold text-slate3">STEP {step}</p>
          <h1 className="mt-1 text-[1.5rem] font-bold tracking-tight text-slate">
            {title}
          </h1>
          <p className="mt-2 text-note leading-[1.9] text-slate2">{lead}</p>
          <div className="mt-6 space-y-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
