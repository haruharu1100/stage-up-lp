/**
 * 管理画面の枠（左メニュー・上のバー・お知らせ帯）。
 *
 * ═══════════════════════════════════════════════
 * ★スマホでの決まり
 * ═══════════════════════════════════════════════
 *
 *   左メニューは、スマホでは初めから畳んでおきます。
 *   ただし「畳んだら何も見えない」状態にはしません。
 *   出先で確かめたいのは、だいたい次の4つです。
 *
 *       売上 / 警告 / 問い合わせ / 未発送
 *
 *   だから、この4つはメニューを開かなくても常に見えるようにします。
 *   （下の QuickBar）
 *
 * ═══════════════════════════════════════════════
 * ★デモの断り書きを消さないこと
 * ═══════════════════════════════════════════════
 *
 *   上のバーに、常に「デモ」と出しておきます。
 *   本物の決済・メール・SMS・配送業者・本番データベースには
 *   一切つながっていません。
 *   本物と見分けがつかない状態で人に見せてはいけません。
 */

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { ConsoleState } from "@/lib/console/state";
import { ROLE_LABEL, can, summary } from "@/lib/console/state";
import { MENU, MENU_GROUPS, type MenuKey } from "./menu";
import { Badge, Btn } from "./ui";

export default function Shell({
  s,
  page,
  onNav,
  onReset,
  onLogout,
  onSwitch,
  onClearFlash,
  children,
}: {
  s: ConsoleState;
  page: MenuKey;
  onNav: (k: MenuKey) => void;
  onReset: () => void;
  onLogout: () => void;
  onSwitch: (id: string) => void;
  onClearFlash: () => void;
  children: ReactNode;
}) {
  const [openMenu, setOpenMenu] = useState(false);
  const me = s.me!;
  const sum = summary(s);

  return (
    <div className="min-h-screen bg-paper2">
      {/* ── 上のバー ── */}
      {/* ★上に「管理サイト／ユーザー側」の切り替え帯があるときは、その下に貼りつく。
          --switch-h は帯の実測値。帯が無い場所で使われたときは 0px になる */}
      <header className="sticky top-[var(--switch-h,0px)] z-30 border-b border-edge bg-paper/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setOpenMenu((v) => !v)}
            aria-expanded={openMenu}
            className="nb rounded-xl border border-edge px-3 py-2 text-note font-bold text-slate2 lg:hidden"
          >
            {openMenu ? "閉じる" : "メニュー"}
          </button>

          <p className="nb text-note font-bold tracking-tight text-slate">
            AI GACHA OS
          </p>
          <Badge tone="warn">デモ</Badge>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="nb text-note font-bold text-slate">{me.name}</p>
              <p className="nb text-note text-slate3">{ROLE_LABEL[me.role]}</p>
            </div>
            <select
              value={me.id}
              onChange={(e) => onSwitch(e.target.value)}
              aria-label="担当を切り替える"
              className="nb rounded-xl border border-silver bg-paper px-3 py-2 text-note text-slate2"
            >
              {s.admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}（{ROLE_LABEL[a.role]}）
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* デモの断り書き。常に出す */}
        <p className="border-t border-edge2 bg-warn/8 px-4 py-2 text-note leading-[1.7] text-warn-ink sm:px-6">
          これはデモです。本物の決済・メール送信・SMS送信・配送業者・本番データベースには、
          いっさいつながっていません。何を押しても実害は出ません。
        </p>
      </header>

      {/* ── お知らせ帯 ── */}
      {s.flash && (
        <div
          className={`px-4 py-3 sm:px-6 ${
            s.flash.kind === "error"
              ? "bg-danger/10 text-danger-ink"
              : s.flash.kind === "warn"
                ? "bg-warn/12 text-warn-ink"
                : "bg-ok/10 text-ok-ink"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <p className="text-note font-medium leading-[1.85]">{s.flash.text}</p>
            <button
              type="button"
              onClick={onClearFlash}
              className="nb shrink-0 text-note font-bold underline underline-offset-4"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      <div className="lg:flex">
        {/* ── 左メニュー ── */}
        <nav
          className={`${openMenu ? "block" : "hidden"} border-b border-edge bg-paper px-4 py-4 lg:sticky lg:top-[calc(6.5rem+var(--switch-h,0px))] lg:block lg:h-[calc(100vh-6.5rem-var(--switch-h,0px))] lg:w-[17rem] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3`}
        >
          {MENU_GROUPS.map((g) => (
            <div key={g} className="mb-5">
              <p className="px-2 pb-2 text-label uppercase text-slate3">{g}</p>
              <ul className="space-y-1">
                {MENU.filter((m) => m.group === g).map((m) => {
                  const allowed = !m.need || can(me.role, m.need);
                  const active = page === m.key;
                  return (
                    <li key={m.key}>
                      <button
                        type="button"
                        onClick={() => {
                          onNav(m.key);
                          setOpenMenu(false);
                        }}
                        className={`block w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                          active
                            ? "bg-blue-pale text-blue-ink"
                            : "text-slate2 hover:bg-mist"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-note font-bold">{m.label}</span>
                          {!allowed && <Badge>権限なし</Badge>}
                        </span>
                        <span className="mt-0.5 block text-note leading-[1.6] text-slate3">
                          {m.note}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <div className="mt-6 space-y-3 border-t border-edge2 pt-5">
            <Btn full onClick={onReset}>
              デモを最初に戻す
            </Btn>
            <Btn full kind="ghost" onClick={onLogout}>
              ログアウト
            </Btn>
            <Link
              href="/"
              className="nb block rounded-xl px-4 py-2.5 text-center text-note font-bold text-slate3 underline underline-offset-4 hover:text-blue-ink"
            >
              販売サイトへ戻る
            </Link>
          </div>
        </nav>

        {/* ── 中身 ── */}
        <main className="min-w-0 flex-1">
          {/* スマホで、メニューを開かなくても見える4つ */}
          <QuickBar
            revenue={sum.revenueToday}
            alerts={sum.rtpAlerts + sum.fraudReview}
            tickets={sum.tickets}
            unshipped={sum.unshipped}
          />
          <div className="space-y-5 px-4 py-6 sm:px-6 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

/**
 * 出先で確かめたい4つ。
 * ★スマホでだけ出します。PCではダッシュボードに同じ数字が並びます。
 */
function QuickBar({
  revenue,
  alerts,
  tickets,
  unshipped,
}: {
  revenue: number;
  alerts: number;
  tickets: number;
  unshipped: number;
}) {
  const items = [
    { k: "本日の売上", v: `${revenue.toLocaleString()}円`, bad: false },
    { k: "警告", v: `${alerts}件`, bad: alerts > 0 },
    { k: "問い合わせ", v: `${tickets}件`, bad: tickets > 0 },
    { k: "未発送", v: `${unshipped}件`, bad: false },
  ];
  return (
    <div className="grid grid-cols-2 gap-px border-b border-edge bg-edge2 lg:hidden">
      {items.map((i) => (
        <div key={i.k} className="bg-paper px-4 py-3">
          <p className="text-note text-slate3">{i.k}</p>
          <p
            className={`num text-[1.125rem] font-bold tabular-nums ${
              i.bad ? "text-danger-ink" : "text-slate"
            }`}
          >
            {i.v}
          </p>
        </div>
      ))}
    </div>
  );
}
