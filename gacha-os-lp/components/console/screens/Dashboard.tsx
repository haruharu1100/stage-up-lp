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
import { liveTodos, useLiveCounts } from "@/lib/console/liveCounts";
import type { MenuKey } from "../menu";
import Icon from "../Icon";

export default function Dashboard({
  s,
  onNav,
}: {
  s: ConsoleState;
  onNav: (k: MenuKey) => void;
}) {
  /**
   * ═══════════════════════════════════════════════
   * ★この画面の数字は、全部サーバーから来ること
   * ═══════════════════════════════════════════════
   *
   *   2026-08-26 まで、この画面には
   *   本物の数字と見本の数字が、並んで出ていました。
   *
   *       未発送・注文件数 …… 本物（DB）
   *       売上・粗利・会員数・プレイ数 …… 見本
   *
   *   見た目がまったく同じなので、運営の方には見分けがつきません。
   *   売上だけが動かない画面を、毎朝見ることになります。
   *
   *   いまは1か所（/api/console/summary →
   *   lib/server/adminSummary.ts）だけから取ります。
   *
   *   ★ここで足し算・引き算を書かないこと。
   *     書いた瞬間に、AIオペレーターや発送画面と数がずれます。
   *     必要な数字が足りないなら、adminSummary.ts に足してください。
   *
   *   ★読めなかったときに0を出さないこと。
   *     片づいたのだと思って、画面を閉じてしまいます。
   *     読めていないなら、読めていないと書きます。
   */
  const live = useLiveCounts();
  const c = live.phase === "ok" ? live.counts : null;

  /* ★用件は liveTodos が1か所で作る。
       ここで組み立て直さないこと。AIオペレーターと数がずれます。 */
  const todos = liveTodos(live);

  const must = todos.filter((t) => t.urgency === "MUST");
  const should = todos.filter((t) => t.urgency === "SHOULD");

  /** 数字が出せない理由。カードの下に、そのまま出す */
  const wakaranai =
    live.phase === "loading"
      ? "数えています。"
      : live.phase === "ng"
        ? `${live.why} 数えられていないので、0とは書きません。`
        : null;

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
          note="金額は税込です。すべて、この会社のDBから数えた実データです。"
        />
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {/* ★null は「見せられない・数えられない」。0円ではありません */}
          <Kpi label="本日の売上" value={c?.revenueToday ?? null} unit="円" tone="ink" />
          <Kpi label="今月の売上" value={c?.revenueMonth ?? null} unit="円" tone="ink" />
          <Kpi
            label="今月の粗利益"
            value={c?.grossProfitMonth ?? null}
            unit="円"
            tone="ok"
          />
          <Kpi
            label="本日のプレイ"
            value={c?.playsToday ?? null}
            unit="回"
            tone="ink"
            to="analytics"
            onNav={onNav}
          />
          <Kpi
            label="公開中のガチャ"
            value={c?.gachasPublished ?? null}
            unit="件"
            tone="ink"
            to="gacha"
            onNav={onNav}
          />
          <Kpi
            label="会員数"
            value={c?.customersTotal ?? null}
            unit="人"
            tone="ink"
            to="customers"
            onNav={onNav}
          />
        </div>

        {/* ★0 を、0 とだけ出して終わらせないこと。
              「0回」だけを見た人は、壊れているのか、
              まだ誰も引いていないのかを判断できません。
              判断できない表示は、無いのと同じです。 */}
        {c?.playsToday === 0 && (
          <p className="mt-3 rounded-xl border border-edge2 bg-paper2 px-4 py-3 text-note leading-[1.85] text-slate3">
            本日は、まだ1回も引かれていません。だから本日の売上は0円です。
            <span className="mx-1 font-bold text-slate2">
              上の「ユーザー側」から1回引くと、この数字がその場で動きます。
            </span>
            動かない見本の数字は、ここには置いていません。
          </p>
        )}

        {/* ★「—」だけを並べて終わらせないこと。
              なぜ出ないのかが分からないと、
              壊れているのか、権限が無いのかを判断できません。 */}
        {wakaranai && (
          <p className="mt-3 rounded-xl border border-edge2 bg-mist px-4 py-3 text-note leading-[1.85] text-slate3">
            {wakaranai}
          </p>
        )}

        {/* 見えている中に、権限で伏せられた数字があるとき */}
        {c && c.revenueToday === null && (
          <p className="mt-3 rounded-xl border border-edge2 bg-mist px-4 py-3 text-note leading-[1.85] text-slate3">
            売上・粗利益・プレイ数・公開中のガチャは、
            あなたの権限では表示しません。0円という意味ではありません。
          </p>
        )}
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
            value={c?.rtpDangerCount ?? null}
            unit="件"
            tone={
              c?.rtpDangerCount == null
                ? "unknown"
                : c.rtpDangerCount > 0
                  ? "danger"
                  : "ok"
            }
            say={
              wakaranai
                ? wakaranai
                : c?.rtpDangerCount == null
                  ? "この数字は、あなたの権限では表示しません。"
                  : c.rtpDangerCount > 0
                    ? "出しすぎています。相場が上がった分だけ、1回ごとに赤字が増えます。"
                    : "出しすぎているガチャはありません。"
            }
            to="rtp"
            cta="実績還元率を見る"
            onNav={onNav}
          />
          <StatusCard
            icon="truck"
            title="発送待ち"
            value={c?.unshippedShipments ?? null}
            unit="件"
            tone={
              c === null ? "unknown" : c.unshippedShipments > 0 ? "warn" : "ok"
            }
            say={
              wakaranai
                ? wakaranai
                : c && c.unshippedShipments > 0
                  ? "お客様が待っています。溜めるほど問い合わせが増えます。"
                  : "出荷を待っている箱はありません。"
            }
            to="shipping"
            cta="発送管理へ"
            onNav={onNav}
          />
          <StatusCard
            icon="chat"
            title="人へ回った問い合わせ"
            value={c?.supportHumanReview ?? null}
            unit="件"
            tone={
              c?.supportHumanReview == null
                ? "unknown"
                : c.supportHumanReview > 0
                  ? "warn"
                  : "ok"
            }
            say={
              wakaranai
                ? wakaranai
                : c?.supportHumanReview == null
                  ? "この数字は、あなたの権限では表示しません。"
                  : c.supportHumanReview > 0
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
        {/* ★ここに「正常」と書き込まないこと。
              以前は4つとも決め打ちで「正常」と出していました。
              決済がつながっていない状態でも「決済：正常」と出ます。
              確かめていないものを正常と言うのは、嘘と同じです。

              ★分からないものは、灰色で「分かりません」と出すこと。
                灰色が並ぶのは、かっこ悪いですが、正しい状態です。
                かっこよく見せるために緑にした瞬間に、
                この画面は誰の判断にも使えなくなります。 */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {/* ★「安全のために止めた要求」の件数は、まだ数えていません。
                数えていないものを「0件でした＝正常」と出さないこと。
                実際に数えられる「今日引かれた回数」だけを書きます。 */}
          <Light
            label="抽選の処理"
            state="unknown"
            say={
              c?.playsToday == null
                ? "止めた要求の件数は、まだ数えていません"
                : `今日 ${c.playsToday.toLocaleString()} 回引かれています。止めた要求の件数は、まだ数えていません`
            }
          />
          {/* ★相場（market_prices）は、まだ画面につないでいません。
                つないでいないものを「すべて取れています」と出すと、
                古い値で還元率を計算したまま、正常だと信じることになります。 */}
          <Light
            label="景品の相場データ"
            state="unknown"
            say="相場の取り込みは、まだつないでいません"
          />
          {/* ★この2つは、この画面からは確かめられません。
                確かめる仕組みができるまで、灰色のままにします。 */}
          <Light
            label="お客様のサイト"
            state="unknown"
            say="外から見た表示の確認は、まだつないでいません"
          />
          <Light
            label="決済"
            state="unknown"
            say="決済会社にはつないでいません（この環境では使えません）"
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
            {c?.prizesUnchosen == null
              ? "—件"
              : `${c.prizesUnchosen.toLocaleString()}件`}
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
        /* ★「ありません。」だけにしないこと。
             空なのが正常なのか、取れていないのかが分かれば、
             確認の電話が1本減ります。 */
        <p className="mt-2 rounded-xl border border-edge2 bg-paper2 px-4 py-3 text-note leading-[1.85] text-slate3">
          この区分に、いま手を動かすものはありません。
          新しく発生すると、ここに自動で並びます。
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
 *
 * ★null を 0 と書かないこと（いちばん大事な決まり）。
 *   null は「見せられない・数えられない」です。
 *   これを「0円」と書くと、売れていないのだと読まれます。
 *   本当は、見ていないだけです。
 *   だから「—」を出し、単位も付けません。
 *   「— 円」と書くと、金額として読めてしまうからです。
 */
function Kpi({
  label,
  value,
  unit,
  tone,
  to,
  onNav,
}: {
  label: string;
  /** ★null は「数えられていない・見せられない」。0 と同じ扱いにしないこと */
  value: number | null;
  unit: string;
  tone: "ink" | "ok" | "warn" | "danger";
  /** 中身を見に行ける画面。無いものは押せなくてよい */
  to?: MenuKey;
  onNav?: (k: MenuKey) => void;
}) {
  const wakaru = value !== null;

  const ink = wakaru
    ? {
        ink: "text-slate",
        ok: "text-ok-ink",
        warn: "text-warn-ink",
        danger: "text-danger-ink",
      }[tone]
    : /* 灰色＝分からない。ここを黒くすると、0円と見分けがつきません */
      "text-slate3";

  const body = (
    <>
      <span className="nb block truncate text-note font-medium text-slate3">
        {label}
      </span>
      <span className={`mt-1.5 flex items-baseline gap-1 ${ink}`}>
        <span className="num text-[1.9rem] font-bold leading-none tracking-tight tabular-nums xl:text-[2.05rem]">
          {wakaru ? value.toLocaleString() : "—"}
        </span>
        {wakaru && <span className="nb text-note font-bold">{unit}</span>}
      </span>
    </>
  );

  /* ★中身を見に行ける数字は、押せるようにすること。
       押せないと、気になった数字を確かめるために
       左のメニューから該当画面を探し直すことになります。
       行き先が無い数字（売上・粗利益）は、押せないままにします。
       押しても何も起きないボタンほど、信用を落とすものはありません。 */
  if (!to || !onNav) {
    return (
      <div className="rounded-2xl border border-edge bg-paper px-4 py-4 shadow-lift">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onNav(to)}
      className="rounded-2xl border border-edge bg-paper px-4 py-4 text-left shadow-lift transition-colors hover:border-blue-ink/30 hover:bg-blue-pale/40"
    >
      {body}
    </button>
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
  /** ★null は「数えられていない」。0 と同じ扱いにしないこと */
  value: number | null;
  unit: string;
  tone: "ok" | "warn" | "danger" | "unknown";
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
    /* 灰色＝分からない。緑（安全）にしないこと */
    unknown: { face: "border-edge bg-mist", ink: "text-slate3", dot: "bg-silver" },
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
          {value === null ? "—" : value.toLocaleString()}
        </span>
        {value !== null && <span className="nb text-note font-bold">{unit}</span>}
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
