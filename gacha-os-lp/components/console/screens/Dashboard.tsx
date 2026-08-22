/**
 * ダッシュボード。
 *
 * ═══════════════════════════════════════════════
 * ★いちばん上は「今日やること」であること
 * ═══════════════════════════════════════════════
 *
 *   売上のグラフを一番上に置きたくなりますが、置きません。
 *   グラフを見ても、次に何をすればよいかは分かりません。
 *
 *   朝いちばんに知りたいのは、
 *     「昨日から今、放っておくとまずいことが起きていないか」
 *   です。だから、確認必須（🔴）と、やった方がよい（🟡）を先に出します。
 *
 *   ★用件が0件のときは、その旨をはっきり出すこと。
 *     空欄にすると「読み込めていないのか、本当に無いのか」が分かりません。
 *
 * ★数字は「良い／悪い」を色で言い切ること。
 *   実還元率 104.7% と出されても、初めての人には
 *   それが良いのか悪いのか分かりません。
 */

"use client";

import type { ConsoleState } from "@/lib/console/state";
import { summary, todayTodos } from "@/lib/console/state";
import type { MenuKey } from "../menu";
import { Badge, Btn, Card, Stat, WhatIsThis } from "../ui";

export default function Dashboard({
  s,
  onNav,
}: {
  s: ConsoleState;
  onNav: (k: MenuKey) => void;
}) {
  const sum = summary(s);
  const todos = todayTodos(s);
  const must = todos.filter((t) => t.urgency === "MUST");
  const should = todos.filter((t) => t.urgency === "SHOULD");

  return (
    <>
      <WhatIsThis>
        今日の状況をひと目で確かめます。上の「今日やること」から順に片づければ、
        その日の運営はひととおり終わります。
      </WhatIsThis>

      {/* ── 今日やること ── */}
      <Card
        title="今日やること"
        note="放っておくと損が出るものから順に並んでいます。"
      >
        {todos.length === 0 ? (
          <p className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-4 text-note font-bold text-ok-ink">
            いま対応が必要な用件はありません。
          </p>
        ) : (
          <div className="space-y-5">
            <TodoGroup
              tone="danger"
              mark="●"
              title="確認必須"
              lead="お金か、お客様への影響が出ます。"
              items={must}
              onNav={onNav}
            />
            <TodoGroup
              tone="warn"
              mark="●"
              title="やった方がよい"
              lead="今日でなくても構いませんが、溜めると重くなります。"
              items={should}
              onNav={onNav}
            />
          </div>
        )}
      </Card>

      {/* ── 数字 ── */}
      <Card title="今日の数字">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="本日の売上" value={sum.revenueToday} unit="円" />
          <Stat label="今月の売上" value={sum.revenueMonth} unit="円" />
          <Stat label="本日のプレイ" value={sum.playsToday} unit="回" />
          <Stat label="会員数" value={sum.users} unit="人" />
          <Stat label="公開中のガチャ" value={sum.publishedCount} unit="件" />
          <Stat
            label="還元率の警告"
            value={sum.rtpAlerts}
            unit="件"
            tone={sum.rtpAlerts > 0 ? "danger" : "ok"}
            sub={sum.rtpAlerts > 0 ? "出しすぎています" : "問題ありません"}
          />
          <Stat
            label="未発送"
            value={sum.unshipped}
            unit="件"
            tone={sum.unshipped > 0 ? "warn" : "ok"}
          />
          <Stat
            label="人へ回った問い合わせ"
            value={sum.tickets}
            unit="件"
            tone={sum.tickets > 0 ? "warn" : "ok"}
          />
        </div>
      </Card>

      {/* ── システムの状態 ── */}
      <Card
        title="システムの状態"
        note="緑・黄・赤の3色と、分からないときの「UNKNOWN」で出します。"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Light label="お客様のサイト" state="ok" note="正常に表示できています" />
          <Light label="抽選の処理" state="ok" note="遅れは出ていません" />
          <Light label="決済" state="ok" note="正常" />
          <Light
            label="景品の相場データ"
            state="unknown"
            note="最終取得から時間が経っています"
          />
        </div>
        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★分からないものを「安全」とは表示しません。
          相場データが古いときは、緑ではなく UNKNOWN と出します。
          古い値をもとに「安全です」と言う方が、危険だからです。
        </p>
      </Card>
    </>
  );
}

function TodoGroup({
  tone,
  mark,
  title,
  lead,
  items,
  onNav,
}: {
  tone: "danger" | "warn";
  mark: string;
  title: string;
  lead: string;
  items: { label: string; count: number; to: string }[];
  onNav: (k: MenuKey) => void;
}) {
  const ink = tone === "danger" ? "text-danger-ink" : "text-warn-ink";
  return (
    <div>
      <p className={`flex flex-wrap items-baseline gap-2 text-note font-bold ${ink}`}>
        <span aria-hidden>{mark}</span>
        <span>{title}</span>
        <span className="font-medium text-slate3">{lead}</span>
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-note text-slate3">ありません。</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((t) => (
            <li
              key={t.label}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                tone === "danger"
                  ? "border-danger/25 bg-danger/8"
                  : "border-warn/30 bg-warn/8"
              }`}
            >
              <span className="text-note font-medium text-slate2">
                {t.label}
                <span className={`num ml-2 font-bold ${ink}`}>{t.count}件</span>
              </span>
              <Btn onClick={() => onNav(t.to as MenuKey)}>この画面へ</Btn>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Light({
  label,
  state,
  note,
}: {
  label: string;
  state: "ok" | "warn" | "danger" | "unknown";
  note: string;
}) {
  const conf = {
    ok: { tone: "ok" as const, text: "正常", dot: "bg-ok" },
    warn: { tone: "warn" as const, text: "注意", dot: "bg-warn" },
    danger: { tone: "danger" as const, text: "異常", dot: "bg-danger" },
    unknown: { tone: "neutral" as const, text: "UNKNOWN", dot: "bg-slate3" },
  }[state];
  return (
    <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${conf.dot}`} aria-hidden />
        <span className="text-note font-bold text-slate">{label}</span>
      </div>
      <div className="mt-2">
        <Badge tone={conf.tone}>{conf.text}</Badge>
      </div>
      <p className="mt-2 text-note leading-[1.7] text-slate3">{note}</p>
    </div>
  );
}
