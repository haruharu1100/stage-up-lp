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
import type { Admin, Permission, Role } from "@/lib/console/state";
import { PERMISSION_LABEL, ROLE_LABEL, ROLE_ORDER, can } from "@/lib/console/state";
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

      <RoleGlance />

      <DemoNote>
        全員が架空の担当者です。実在のアカウントではありません。
        パスワードは入力しません。デモで本物らしい入力欄を出すと、
        本当のパスワードを打ってしまう方がいるためです。
      </DemoNote>
    </Frame>
  );
}

/**
 * どの担当が、何をできて、何をできないか。
 *
 * ═══════════════════════════════════════════════
 * ★入る前に見せること
 * ═══════════════════════════════════════════════
 *
 *   ログインしたあとに権限の説明をしても、もう遅いのです。
 *   「サポートの子に全部やらせていた」に気づくのは、
 *   たいてい、何かが起きたあとです。
 *
 *   だから、入口で先に出します。
 *   ここで「サポートはお金に触れない」と分かっていれば、
 *   誰にどのアカウントを渡すかを、最初から間違えません。
 *
 * ★出す項目を、5つに絞ること。
 *   16項目すべてをここに並べると、誰も読みません。
 *   読まれない表は、無いのと同じです。
 *   全部見たい方のために、中の設定画面に完全版を置いてあります。
 */
const GLANCE: Permission[] = [
  "point.approve",
  "point.request",
  "gacha.publish",
  "shipping.act",
  "settings.edit",
];

/** 入口では短く言い切る。長い正式名称は、中の権限マトリクスにあります */
const GLANCE_SHORT: Record<string, string> = {
  "point.approve": "ポイント承認",
  "point.request": "ポイント申請",
  "gacha.publish": "ガチャ公開",
  "shipping.act": "発送処理",
  "settings.edit": "設定変更",
};

function RoleGlance() {
  const [open, setOpen] = useState(false);
  /* 見るだけの役割は、入口の表には出さない（実際に配るのはこの5つです） */
  const roles: Role[] = ROLE_ORDER.filter((r) => r !== "VIEWER");

  return (
    <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <span className="text-note font-bold text-slate2">
          担当ごとに、できること・できないこと
        </span>
        <span className="nb text-note font-bold text-blue-ink">
          {open ? "閉じる" : "見る"}
        </span>
      </button>

      {open && (
        <>
          <div className="-mx-1 mt-3 overflow-x-auto px-1">
            <table className="w-full min-w-[30rem] border-collapse text-[0.78rem]">
              <thead>
                <tr>
                  <th className="border-b border-edge px-2 py-2 text-left font-bold text-slate3">
                    担当
                  </th>
                  {GLANCE.map((p) => (
                    <th
                      key={p}
                      className="nb border-b border-edge px-1.5 py-2 text-center font-bold text-slate3"
                    >
                      {GLANCE_SHORT[p]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r}>
                    <td className="nb whitespace-nowrap border-b border-edge px-2 py-2 font-bold text-slate">
                      {ROLE_LABEL[r]}
                    </td>
                    {GLANCE.map((p) => (
                      <td key={p} className="border-b border-edge px-1.5 py-2 text-center">
                        <span
                          className={
                            can(r, p)
                              ? "font-bold text-ok-ink"
                              : "font-bold text-slate3"
                          }
                          aria-label={`${PERMISSION_LABEL[p]}：${can(r, p) ? "できる" : "できない"}`}
                        >
                          {can(r, p) ? "○" : "×"}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-note leading-[1.85] text-slate3">
            ★ポイントは「申請する人」と「承認する人」を分けています。
            経理は申請だけ、承認は管理者だけです。1人では動かせません。
            <br />
            ★画面からボタンを消しているだけではありません。
            権限の無い操作は、直接呼び出しても断られ、その記録が残ります。
            完全な一覧は、ログイン後の「設定」にあります。
          </p>
        </>
      )}
    </div>
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
