/**
 * 契約者向け管理画面の、共通部品。
 *
 * ═══════════════════════════════════════════════
 * ★見た目の方針
 * ═══════════════════════════════════════════════
 *
 *   白 / 薄いグレー / 薄いブルー / 濃紺 の4色だけで作ります。
 *   派手な色は「危ないとき」だけに取っておきます。
 *   毎日8時間見る画面なので、常に何かが光っている状態にしないこと。
 *
 *   3D・アニメーションは使いません。
 *   販売LPは「すごさ」を伝える場所ですが、ここは「仕事をする場所」です。
 *   動きは、押したものが反応する分だけで足ります。
 *
 * ★文字は 16px を下回らないこと。
 *   管理画面は情報量が多いので小さくしたくなりますが、
 *   毎日見る人の目が持ちません。詰めたいときは、項目を減らします。
 *
 * ★ここに「見た目だけの部品」を増やさないこと。
 *   状態は lib/console/state.ts に集めています。
 *   このファイルは、その状態を並べるための器だけを持ちます。
 */

"use client";

import type { ReactNode } from "react";
import type { RiskLevel } from "@/lib/console/fraud";
import { LEVEL_STYLE } from "@/lib/console/fraud";

/* ══════════════════════════════════════════════
   枠
   ══════════════════════════════════════════════ */

export function Card({
  title,
  note,
  right,
  children,
  className = "",
}: {
  title?: string;
  note?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-edge bg-paper shadow-lift ${className}`}
    >
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge2 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[1.0625rem] font-bold tracking-tight text-slate">
                {title}
              </h2>
            )}
            {note && <p className="mt-1 text-note text-slate3">{note}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

/**
 * 「この画面で、いま何をするのか」を書く帯。
 *
 * ★全部の画面に必ず置くこと。
 *   初めて触る人は、項目名だけでは何をすればよいか分かりません。
 *   「REAL RTP」と書いてあっても、何を見て、どうなったら何をするのかは伝わりません。
 */
export function WhatIsThis({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-blue-pale bg-blue-pale/50 px-5 py-4">
      <p className="text-note leading-[1.9] text-slate2">
        <span className="mr-2 font-bold text-blue-ink">この画面ですること</span>
        {children}
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════
   数字
   ══════════════════════════════════════════════ */

export function Stat({
  label,
  value,
  unit,
  tone = "normal",
  sub,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "normal" | "ok" | "warn" | "danger";
  sub?: string;
}) {
  const ink =
    tone === "danger" ? "text-danger-ink"
    : tone === "warn" ? "text-warn-ink"
    : tone === "ok" ? "text-ok-ink"
    : "text-slate";
  return (
    <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
      <p className="text-note font-medium text-slate3">{label}</p>
      <p className={`mt-1 flex items-baseline gap-1 ${ink}`}>
        <span className="num text-[1.75rem] font-bold tracking-tight tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {unit && <span className="text-note font-medium">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-note text-slate3">{sub}</p>}
    </div>
  );
}

/* ══════════════════════════════════════════════
   印
   ══════════════════════════════════════════════ */

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "blue";
}) {
  const style = {
    neutral: "border-edge bg-mist text-slate2",
    ok: "border-ok/30 bg-ok/10 text-ok-ink",
    warn: "border-warn/35 bg-warn/12 text-warn-ink",
    danger: "border-danger/30 bg-danger/10 text-danger-ink",
    blue: "border-blue-ink/20 bg-blue-pale text-blue-ink",
  }[tone];
  return (
    <span
      className={`nb inline-flex items-center rounded-full border px-3 py-1 text-note font-bold ${style}`}
    >
      {children}
    </span>
  );
}

/** 危険度の印。色と日本語の両方で出す（色だけに頼らない） */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const s = LEVEL_STYLE[level];
  return (
    <span
      className={`nb inline-flex items-center gap-2 rounded-full border px-3 py-1 text-note font-bold ${s.face} ${s.ink} ${s.edge}`}
    >
      <span className="num">{s.label}</span>
      <span className="opacity-70">{s.action}</span>
    </span>
  );
}

/* ══════════════════════════════════════════════
   ボタン
   ══════════════════════════════════════════════ */

export function Btn({
  children,
  onClick,
  kind = "normal",
  disabled,
  title,
  full,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "normal" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
  full?: boolean;
  type?: "button" | "submit";
}) {
  const style = {
    primary:
      "border-transparent bg-blue-ink text-white shadow-blue-lift hover:bg-blue-deep",
    normal: "border-edge bg-paper text-slate hover:bg-paper2",
    danger: "border-danger/30 bg-danger/10 text-danger-ink hover:bg-danger/16",
    ghost: "border-transparent bg-transparent text-slate2 hover:bg-mist",
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`nb inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-note font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${style} ${full ? "w-full" : ""}`}
    >
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════════
   入力
   ══════════════════════════════════════════════ */

export function Field({
  label,
  note,
  children,
  required,
}: {
  label: string;
  note?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-note font-bold text-slate2">
        {label}
        {required && <Badge tone="danger">必須</Badge>}
      </span>
      {note && <span className="mt-1 block text-note text-slate3">{note}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-silver bg-paper px-4 py-3 text-note text-slate outline-none transition-colors placeholder:text-slate3 focus:border-blue-ink focus:ring-4 focus:ring-blue-pale";

/* ══════════════════════════════════════════════
   表
   ══════════════════════════════════════════════ */

/**
 * 表。
 *
 * ★スマホでは、表を横スクロールさせないこと。
 *   指で横に動かす表は、まず読まれません。
 *   狭いときは Row を積み重ねる形（下の Rows）に切り替えます。
 */
export function Table({
  head,
  children,
}: {
  head: string[];
  children: ReactNode;
}) {
  return (
    <div className="hidden md:block">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-edge">
            {head.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-3 py-3 text-note font-bold text-slate3"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={`border-b border-edge2 px-3 py-3 align-top text-note text-slate2 ${className}`}>
      {children}
    </td>
  );
}

/** スマホ用。1件を1枚のカードで積む */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="space-y-3 md:hidden">{children}</div>;
}

export function RowCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
      {children}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <span className="text-note text-slate3">{k}</span>
      <span className="text-note font-medium text-slate2">{v}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════
   注意書き
   ══════════════════════════════════════════════ */

/**
 * デモであることの断り書き。
 *
 * ★消さないこと。
 *   本物の決済・メール送信・SMS送信・配送業者・本番データベースには
 *   一切つながっていません。それを書かずに本物らしく見せるのは、
 *   お客様に嘘をつくのと同じです。
 */
export function DemoNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.85] text-warn-ink">
      <span className="mr-2 font-bold">デモ</span>
      {children}
    </p>
  );
}

/** まだ作っていない機能を、作ってあるように見せないための印 */
export function Planned({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-silver bg-paper2 px-4 py-4">
      <Badge>今後対応予定</Badge>
      <p className="mt-2 text-note leading-[1.85] text-slate3">{children}</p>
    </div>
  );
}
