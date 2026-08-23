/**
 * デモ専用「担当を切り替える」。
 *
 * ═══════════════════════════════════════════════
 * ★これは、ログイン画面には置かないこと
 * ═══════════════════════════════════════════════
 *
 *   以前は、ログイン画面に担当者の一覧が並んでいました。
 *   「どの担当としてログインするか選んでください」です。
 *   本番の管理サイトのログイン画面に、社員名簿は並びません。
 *   並んだ瞬間に、製品ではなく説明資料に見えます。
 *
 *   けれど、役割ごとに何ができるかは、
 *   このシステムのいちばん大事なところです。
 *   だから、消すのではなく、入ったあとに移しました。
 *
 * ★本番には出しません。
 *   ここは、ご確認用に用意している切り替えです。
 *   だから「デモ」と明記し、色も本番の操作と分けます。
 *
 * ★入る前に権限を見せる意味は、ここでも残すこと。
 *   「サポートの子に全部やらせていた」に気づくのは、
 *   たいてい何かが起きたあとです。
 *   誰にどのアカウントを渡すかを決める材料を、
 *   切り替えの、その場に置いておきます。
 */

"use client";

import { useEffect, useState } from "react";
import type { Admin, Permission, Role } from "@/lib/console/state";
import { PERMISSION_LABEL, ROLE_LABEL, ROLE_ORDER, can } from "@/lib/console/state";
import { Badge } from "./ui";

/** 役割ごとの、いちばん分かりやすい一言 */
const ROLE_NOTE: Record<string, string> = {
  SUPER_ADMIN: "全部できます。ポイントの承認もこの人が行います。",
  FINANCE: "ポイントの変更を申請できます。承認は別の人が行います。",
  OPERATOR: "ガチャの作成・公開・発送・返信ができます。お金には触れません。",
  SUPPORT: "問い合わせの返信と発送だけ。ポイントも不正判定も触れません。",
  SECURITY: "不正判定と監査ログの確認。ガチャの公開はできません。",
  VIEWER: "見るだけ。何も変更できません。",
};

/**
 * ★出す項目を5つに絞ること。
 *   16項目すべてを並べると、誰も読みません。
 *   読まれない表は、無いのと同じです。
 *   完全版は「設定」の権限マトリクスにあります。
 */
const GLANCE: Permission[] = [
  "point.approve",
  "point.request",
  "gacha.publish",
  "shipping.act",
  "settings.edit",
];

const GLANCE_SHORT: Record<string, string> = {
  "point.approve": "ポイント承認",
  "point.request": "ポイント申請",
  "gacha.publish": "ガチャ公開",
  "shipping.act": "発送処理",
  "settings.edit": "設定変更",
};

export default function DemoRoleSwitch({
  admins,
  me,
  onSwitch,
}: {
  admins: Admin[];
  me: Admin;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="デモ：担当を切り替える"
        className="nb flex shrink-0 items-center gap-2 rounded-xl border border-warn/35 bg-warn/10 px-3 py-2 text-note font-bold text-warn-ink transition-colors hover:bg-warn/16"
      >
        <span className="nb hidden sm:inline">デモ：担当を切り替える</span>
        <span className="nb sm:hidden">担当</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 py-[6vh]">
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate/45"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="デモ：担当を切り替える"
            className="relative flex max-h-full w-full max-w-[38rem] flex-col overflow-hidden rounded-2xl border border-edge bg-paper shadow-float"
          >
            <header className="flex-none border-b border-edge2 px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <Badge tone="warn">デモ</Badge>
                    <span className="nb text-[1.0625rem] font-bold tracking-tight text-slate">
                      担当を切り替える
                    </span>
                  </p>
                  <p className="mt-1.5 text-note leading-[1.8] text-slate3">
                    ご確認用の切り替えです。本番の管理サイトには、この機能はありません。
                    役割によって、押せるボタンと開ける画面が変わります。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="nb shrink-0 rounded-lg px-2 py-1 text-note font-bold text-slate3 hover:bg-mist"
                >
                  閉じる
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
              <ul className="space-y-2.5">
                {admins.map((a) => {
                  const on = a.id === me.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onSwitch(a.id);
                          setOpen(false);
                        }}
                        aria-current={on ? "true" : undefined}
                        className={`block w-full rounded-xl border px-4 py-3.5 text-left transition-colors ${
                          on
                            ? "border-blue-ink/30 bg-blue-pale"
                            : "border-edge bg-paper hover:border-blue-ink/30 hover:bg-blue-pale/40"
                        }`}
                      >
                        <span className="flex flex-wrap items-center gap-2.5">
                          <span className="nb text-note font-bold text-slate">
                            {a.name}
                          </span>
                          <Badge tone={a.role === "SUPER_ADMIN" ? "blue" : "neutral"}>
                            {ROLE_LABEL[a.role]}
                          </Badge>
                          {on && <Badge tone="ok">いまこの担当</Badge>}
                        </span>
                        <span className="mt-1 block text-note leading-[1.8] text-slate3">
                          {ROLE_NOTE[a.role]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <Glance />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Glance() {
  /* 見るだけの役割は表に出さない（実際に配るのはこの5つです） */
  const roles: Role[] = ROLE_ORDER.filter((r) => r !== "VIEWER");

  return (
    <div className="mt-5 rounded-xl border border-edge2 bg-paper2 px-4 py-4">
      <p className="text-note font-bold text-slate2">
        担当ごとに、できること・できないこと
      </p>

      <div className="-mx-1 mt-3 overflow-x-auto px-1">
        <table className="w-full min-w-[30rem] border-collapse text-[0.85rem]">
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
                        can(r, p) ? "font-bold text-ok-ink" : "font-bold text-slate3"
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
        完全な一覧は「設定」にあります。
      </p>
    </div>
  );
}
