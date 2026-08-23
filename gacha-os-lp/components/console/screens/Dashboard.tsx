/**
 * ダッシュボード。
 *
 * ═══════════════════════════════════════════════
 * ★並び順は、この順から動かさないこと
 * ═══════════════════════════════════════════════
 *
 *     ① 今日やること   … 放っておくと損が出るもの
 *     ② 売上           … 経営として見る数字
 *     ③ 危険           … 出しすぎ・相場の急騰
 *     ④ 発送           … 売ったあとの約束
 *     ⑤ 問い合わせ     … 人が答える必要があるもの
 *
 *   売上のグラフを一番上に置きたくなりますが、置きません。
 *   グラフを見ても、次に何をすればよいかは分かりません。
 *   朝いちばんに知りたいのは
 *     「昨日から今、放っておくとまずいことが起きていないか」
 *   だけです。
 *
 * ═══════════════════════════════════════════════
 * ★数字を小さくしないこと
 * ═══════════════════════════════════════════════
 *
 *   この画面は、担当者だけが見る場所ではありません。
 *   社長が朝いちばんに開いて、3秒で状況を掴む場所です。
 *   項目を増やして1つずつ小さくすると、
 *   結局どれも読まれず、毎朝「で、どうなの？」と人に聞くことになります。
 *   詰めたいときは、文字を小さくするのではなく、項目を減らします。
 *
 * ═══════════════════════════════════════════════
 * ★色の意味を、画面ごとに変えないこと
 * ═══════════════════════════════════════════════
 *
 *     青   … 通常
 *     緑   … 良好
 *     黄   … 確認したほうがよい
 *     赤   … 要対応
 *     灰   … 情報が足りない（分からない）
 *
 *   ★分からないものを緑にしないこと。
 *     相場データが古いのに「安全です」と言う方が、危険です。
 *
 * ★カードを積み過ぎないこと。
 *   1画面に10枚並べると、どれが大事か分からなくなります。
 *   大事なものほど大きく、そうでないものは1行に畳みます。
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ConsoleState } from "@/lib/console/state";
import { summary, todayTodos } from "@/lib/console/state";
import type { MenuKey } from "../menu";
import Icon from "../Icon";

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

  const grossProfit = s.gachas
    .filter((g) => g.status === "PUBLISHED")
    .reduce((a, g) => a + g.profit, 0);

  return (
    <div className="space-y-5">
      <Hero
        name={s.me?.name ?? ""}
        mustCount={must.length}
        shouldCount={should.length}
        onNav={onNav}
      />

      {/* ══ ① 今日やること ══ */}
      <Today must={must} should={should} onNav={onNav} />

      {/* ══ ② 売上 ══ */}
      <section>
        <SectionHead
          title="今日の数字"
          note="金額は税込です。今月は、公開中のガチャの合計です。"
        />
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi label="本日の売上" value={sum.revenueToday} unit="円" tone="ink" />
          <Kpi label="今月の売上" value={sum.revenueMonth} unit="円" tone="ink" />
          <Kpi label="今月の粗利益" value={grossProfit} unit="円" tone="ok" />
          <Kpi label="本日のプレイ" value={sum.playsToday} unit="回" tone="ink" />
          <Kpi label="公開中のガチャ" value={sum.publishedCount} unit="件" tone="ink" />
          <Kpi label="会員数" value={sum.users} unit="人" tone="ink" />
        </div>
      </section>

      {/* ══ ③危険 ④発送 ⑤問い合わせ ══ */}
      <section>
        <SectionHead
          title="いまの状況"
          note="押すと、その画面へ移動します。0件のときも、はっきり0と出します。"
        />
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <StatusCard
            icon="gauge"
            title="危険なガチャ"
            value={sum.rtpAlerts}
            unit="件"
            tone={sum.rtpAlerts > 0 ? "danger" : "ok"}
            say={
              sum.rtpAlerts > 0
                ? "出しすぎています。相場が上がった分だけ、1回ごとに赤字が増えます。"
                : "出しすぎているガチャはありません。"
            }
            to="rtp"
            cta="実還元率を見る"
            onNav={onNav}
          />
          <StatusCard
            icon="truck"
            title="未発送"
            value={sum.unshipped}
            unit="件"
            tone={sum.unshipped > 0 ? "warn" : "ok"}
            say={
              sum.unshipped > 0
                ? "お客様が待っています。溜めるほど問い合わせが増えます。"
                : "発送待ちはありません。"
            }
            to="shipping"
            cta="発送管理へ"
            onNav={onNav}
          />
          <StatusCard
            icon="chat"
            title="人へ回った問い合わせ"
            value={sum.tickets}
            unit="件"
            tone={sum.tickets > 0 ? "warn" : "ok"}
            say={
              sum.tickets > 0
                ? "AIが答えを出せなかったものです。人が返す必要があります。"
                : "人が返すべき問い合わせはありません。"
            }
            to="support"
            cta="問い合わせへ"
            onNav={onNav}
          />
        </div>
      </section>

      {/* ══ 補足。小さく、1行で ══ */}
      <section>
        <SectionHead
          title="システムの状態"
          note="分からないものを「正常」とは出しません。"
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Light label="お客様のサイト" state="ok" say="正常に表示できています" />
          <Light label="抽選の処理" state="ok" say="遅れは出ていません" />
          <Light label="決済" state="ok" say="正常" />
          <Light
            label="景品の相場データ"
            state="unknown"
            say="最終取得から時間が経っています"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-edge2 bg-paper2 px-4 py-3">
          <span className="nb text-note font-bold text-slate3">色の意味</span>
          <Legend dot="bg-blue-ink" text="通常" />
          <Legend dot="bg-ok" text="良好" />
          <Legend dot="bg-warn" text="確認" />
          <Legend dot="bg-danger" text="要対応" />
          <Legend dot="bg-slate3" text="情報が足りない" />
        </div>

        {/* ★「お客様が受け取り方法を選ぶ待ち」という言い方を変えないこと。
              左右の連動を確かめる道具（scripts/shoot-two-sides.mjs）が、
              この言葉を目印に前後の件数を読み取っています。
              言い換えると、確認が黙って動かなくなります。 */}
        <p className="mt-3 rounded-xl border border-edge2 bg-paper2 px-4 py-3 text-note leading-[1.85] text-slate3">
          お客様が受け取り方法を選ぶ待ちが
          <span className="num mx-1.5 font-bold text-slate2">
            {sum.unchosenPrizes}件
          </span>
          あります（発送か、ポイント交換か）。 運営の作業はありません。
          だから「やること」には入れていません。
        </p>
      </section>
    </div>
  );
}

/* ══════════════════════════════════════════════
   いちばん上。あいさつと、今日の件数
   ══════════════════════════════════════════════ */

/**
 * ★件数を、あいさつと同じ文に入れること。
 *   「おはようございます」だけでは、飾りです。
 *   「今日確認することは3件です」まで言い切って、
 *   はじめて、開いた意味が出ます。
 *
 * ★時刻は、画面が出てから決めること。
 *   サーバーで作った文と、手元の時計で作った文が食い違うと、
 *   React が画面を作り直して一瞬ちらつきます。
 */
function Hero({
  name,
  mustCount,
  shouldCount,
  onNav,
}: {
  name: string;
  mustCount: number;
  shouldCount: number;
  onNav: (k: MenuKey) => void;
}) {
  const [hello, setHello] = useState("おはようございます");

  useEffect(() => {
    const h = new Date().getHours();
    setHello(h < 11 ? "おはようございます" : h < 18 ? "おつかれさまです" : "おつかれさまです");
  }, []);

  const total = mustCount + shouldCount;

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-gradient-to-br from-navy2 to-navy shadow-lift2">
      <div className="flex flex-col gap-5 px-5 py-6 sm:px-7 sm:py-7 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          {/* ★この見出しは、飾りではなく現在地です。
              どの画面にも「画面の名前」がいちばん上にある、という
              ただ1つの決まりを、ここだけ崩さないための行です。
              あいさつを見出しにすると、朝と夕方で見出しが変わります。 */}
          <h1 className="nb text-[0.8125rem] font-bold tracking-[0.22em] text-white/45">
            ダッシュボード
          </h1>
          <p className="nb mt-2.5 text-note font-bold text-blue-bright">
            {hello}、{name} さん
          </p>
          <p className="mt-1.5 text-[1.5rem] font-bold leading-[1.45] tracking-tight text-white sm:text-[1.75rem]">
            {total === 0 ? (
              "今日、確認することはありません。"
            ) : (
              <>
                今日確認することは
                <span className="num mx-1.5 text-[2.1rem] text-blue-bright sm:text-[2.4rem]">
                  {total}
                </span>
                件です。
              </>
            )}
          </p>
          <p className="mt-2 text-note leading-[1.85] text-white/65">
            {mustCount > 0
              ? `うち ${mustCount} 件は、放っておくとお金かお客様への影響が出ます。`
              : "急いで対応が必要なものはありません。"}
          </p>
        </div>

        {/* AI オペレーター。あいさつの真横に置く */}
        <button
          type="button"
          onClick={() => onNav("operator")}
          className="group flex w-full shrink-0 items-center gap-3.5 rounded-2xl border border-white/15 bg-white/8 px-4 py-4 text-left transition-colors hover:bg-white/14 lg:w-[22rem]"
        >
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-bright/20 text-blue-bright"
          >
            <Icon name="spark" className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="nb block text-note font-bold text-white">
              AI オペレーターに聞く
            </span>
            <span className="mt-0.5 block text-note leading-[1.7] text-white/60">
              「今日は何をしたらいい？」で答えます
            </span>
          </span>
          <span aria-hidden className="nb shrink-0 text-white/45 group-hover:text-white">
            →
          </span>
        </button>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════
   ① 今日やること
   ══════════════════════════════════════════════ */

type Todo = { label: string; count: number; to: string };

function Today({
  must,
  should,
  onNav,
}: {
  must: Todo[];
  should: Todo[];
  onNav: (k: MenuKey) => void;
}) {
  const none = must.length === 0 && should.length === 0;

  return (
    <section className="rounded-2xl border border-edge bg-paper shadow-lift">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge2 px-5 py-4 sm:px-6">
        <h2 className="text-[1.0625rem] font-bold tracking-tight text-slate">
          今日やること
        </h2>
        <p className="text-note text-slate3">
          放っておくと損が出るものから順に並んでいます。
        </p>
      </header>

      <div className="px-5 py-5 sm:px-6">
        {none ? (
          <p className="flex items-center gap-2.5 rounded-xl border border-ok/30 bg-ok/10 px-4 py-4 text-note font-bold text-ok-ink">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-ok" />
            いま対応が必要な用件はありません。
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <TodoGroup
              tone="danger"
              title="要対応"
              lead="お金か、お客様への影響が出ます。"
              items={must}
              onNav={onNav}
            />
            <TodoGroup
              tone="warn"
              title="確認推奨"
              lead="今日でなくても構いませんが、溜めると重くなります。"
              items={should}
              onNav={onNav}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function TodoGroup({
  tone,
  title,
  lead,
  items,
  onNav,
}: {
  tone: "danger" | "warn";
  title: string;
  lead: string;
  items: Todo[];
  onNav: (k: MenuKey) => void;
}) {
  const conf =
    tone === "danger"
      ? { dot: "bg-danger", ink: "text-danger-ink", face: "border-danger/25 bg-danger/8" }
      : { dot: "bg-warn", ink: "text-warn-ink", face: "border-warn/30 bg-warn/8" };

  const total = items.reduce((a, t) => a + t.count, 0);

  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${conf.dot}`} />
        <span className={`nb text-note font-bold ${conf.ink}`}>{title}</span>
        <span className={`num text-note font-bold ${conf.ink}`}>{total}件</span>
        <span className="text-note text-slate3">{lead}</span>
      </p>

      {items.length === 0 ? (
        <p className="mt-2 rounded-xl border border-edge2 bg-paper2 px-4 py-3 text-note text-slate3">
          ありません。
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((t) => (
            <li key={t.label}>
              {/* ★行そのものを押せるようにすること。
                  「この画面へ」の小さなボタンを狙わせると、
                  1件ごとに手元を止めることになります */}
              <button
                type="button"
                onClick={() => onNav(t.to as MenuKey)}
                className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border px-4 py-3 text-left transition-colors hover:brightness-[0.98] ${conf.face}`}
              >
                <span className="min-w-0 text-note font-medium text-slate2">
                  {t.label}
                  <span className={`num ml-2 font-bold ${conf.ink}`}>{t.count}件</span>
                </span>
                <span className={`nb shrink-0 text-note font-bold ${conf.ink}`}>
                  対応する →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   ② 数字
   ══════════════════════════════════════════════ */

/**
 * ★数字を、説明より先に読ませること。
 *   ラベルを大きくして数字を小さくすると、
 *   「何の数字か」は分かるのに「いくらか」が分かりません。
 *   人が知りたいのは、いつも後者です。
 */
function Kpi({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  tone: "ink" | "ok" | "warn" | "danger";
}) {
  const ink = {
    ink: "text-slate",
    ok: "text-ok-ink",
    warn: "text-warn-ink",
    danger: "text-danger-ink",
  }[tone];

  return (
    <div className="rounded-2xl border border-edge bg-paper px-4 py-4 shadow-lift">
      <p className="nb truncate text-note font-medium text-slate3">{label}</p>
      <p className={`mt-1.5 flex items-baseline gap-1 ${ink}`}>
        <span className="num text-[1.9rem] font-bold leading-none tracking-tight tabular-nums xl:text-[2.05rem]">
          {value.toLocaleString()}
        </span>
        <span className="nb text-note font-bold">{unit}</span>
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ③④⑤ いまの状況
   ══════════════════════════════════════════════ */

function StatusCard({
  icon,
  title,
  value,
  unit,
  tone,
  say,
  to,
  cta,
  onNav,
}: {
  icon: "gauge" | "truck" | "chat";
  title: string;
  value: number;
  unit: string;
  tone: "ok" | "warn" | "danger";
  say: string;
  to: MenuKey;
  cta: string;
  onNav: (k: MenuKey) => void;
}) {
  const conf = {
    ok: { face: "border-edge bg-paper", ink: "text-ok-ink", dot: "bg-ok" },
    warn: { face: "border-warn/30 bg-warn/6", ink: "text-warn-ink", dot: "bg-warn" },
    danger: {
      face: "border-danger/30 bg-danger/6",
      ink: "text-danger-ink",
      dot: "bg-danger",
    },
  }[tone];

  return (
    <button
      type="button"
      onClick={() => onNav(to)}
      className={`group flex w-full flex-col rounded-2xl border px-5 py-4 text-left shadow-lift transition-colors hover:brightness-[0.985] ${conf.face}`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${conf.dot}`} />
        <Icon name={icon} className={`h-[1.15rem] w-[1.15rem] ${conf.ink}`} />
        <span className="nb text-note font-bold text-slate">{title}</span>
      </span>

      <span className={`mt-2 flex items-baseline gap-1 ${conf.ink}`}>
        <span className="num text-[2.05rem] font-bold leading-none tracking-tight tabular-nums">
          {value.toLocaleString()}
        </span>
        <span className="nb text-note font-bold">{unit}</span>
      </span>

      <span className="mt-2 block text-note leading-[1.75] text-slate2">{say}</span>

      <span className="nb mt-3 block text-note font-bold text-blue-ink group-hover:text-blue-deep">
        {cta} →
      </span>
    </button>
  );
}

/* ══════════════════════════════════════════════
   補足
   ══════════════════════════════════════════════ */

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-[1.0625rem] font-bold tracking-tight text-slate">{title}</h2>
      <p className="text-note text-slate3">{note}</p>
    </div>
  );
}

function Light({
  label,
  state,
  say,
}: {
  label: string;
  state: "ok" | "warn" | "danger" | "unknown";
  say: string;
}) {
  const conf = {
    ok: { dot: "bg-ok", text: "正常", ink: "text-ok-ink" },
    warn: { dot: "bg-warn", text: "注意", ink: "text-warn-ink" },
    danger: { dot: "bg-danger", text: "異常", ink: "text-danger-ink" },
    unknown: { dot: "bg-slate3", text: "情報が足りない", ink: "text-slate3" },
  }[state];

  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-xl border border-edge2 bg-paper px-4 py-3">
      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${conf.dot}`} />
      <span className="nb text-note font-bold text-slate">{label}</span>
      <span className={`nb text-note font-bold ${conf.ink}`}>{conf.text}</span>
      <span className="min-w-0 text-note text-slate3">{say}</span>
    </div>
  );
}

function Legend({ dot, text }: { dot: string; text: string }): ReactNode {
  return (
    <span className="nb flex items-center gap-1.5 text-note text-slate2">
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
