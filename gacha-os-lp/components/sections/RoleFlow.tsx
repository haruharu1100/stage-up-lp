"use client";

import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";
/* ★製品名は必ず OS を使うこと。"AI GACHA OS" と直接書くと狭い画面で割れます */
import { OS } from "@/lib/text";
/*
  ★このデータは「ただの日本語」で持つこと。
    折り返しを止めるための見えない文字（U+2060 など）を混ぜないこと。
    画面に出すときに lib/jp.tsx の jp() を通せば、
    守るべき言葉だけが <span class="nb"> で包まれます。
*/

/**
 * 「誰が何をやるのか」を、1枚の図で言い切るセクション。
 *
 * ═══════════════════════════════════════════════
 * ★2026-08-22：6枚のカードをやめて、1枚の図にしました。理由を残します。
 * ═══════════════════════════════════════════════
 *
 *   ここは前まで、6つの工程を1枚ずつカードにして並べていました。
 *     指示する → 作る・試す → 確認する → 監視する → 発送する → 答える
 *
 *   ところが、この同じ6工程は、すぐ上の
 *   「A DAY IN OPERATION」（OperatingDay.tsx）で
 *   実際の画面とデータの流れつきで、もう見せ終わっています。
 *
 *   つまり、読む人は同じ話を2回読まされていました。
 *   2回目のほうが情報が少ないので、ただ長いだけになります。
 *
 *   だから、役割分担はここに1つだけ残します。
 *     ・流れを説明するのは OperatingDay（実画面つき）
 *     ・誰の仕事かを一目で示すのは、ここ（1枚の図）
 *   説明を足したくなったら、まず OperatingDay に入らないかを考えること。
 *
 *   ★見出しの「全部をあなたがやる必要はありません。」は残すこと。
 *     ここで一番効いているのはこの一言です。
 *
 * 文章は、動きが無くても最初から読める状態で置くこと。
 * framer-motion の viewport には amount を使わない（過去に画面が真っ白になった）。
 */

type Column = {
  tag: string;
  name: string;
  /** その列が何者かの、ひと言 */
  note: string;
  items: string[];
  /** 枠と地の色 */
  card: string;
  chip: string;
  dot: string;
};

/*
  ★ここは「一覧」ではなく「線引き」です。
    書けることを全部足さないこと。
    足すほど、どこが人の仕事なのかが薄まります。
*/
const COLUMNS: Column[] = [
  {
    tag: "HUMAN",
    name: "あなた",
    note: "決めることと、実物に触ること。",
    items: ["指示する", "確認・承認する", "仕入れ・実物の対応"],
    card: "border-edge bg-white",
    chip: "border-edge bg-paper2 text-slate",
    dot: "bg-slate/30",
  },
  {
    tag: "AI",
    name: OS,
    note: "毎日の計算と、見張りと、一次対応。",
    items: [
      "ガチャ設計",
      "確率と還元率の計算",
      "公開前バックテスト",
      "販売中の監視（現在の実還元率・残り口数）",
      "発送管理の支援",
      "定型の問い合わせ対応",
    ],
    card: "border-blue-ink/16 bg-gradient-to-b from-blue-pale/60 to-white",
    chip: "border-blue-ink/18 bg-blue-pale text-blue-ink",
    dot: "bg-blue-ink/45",
  },
  {
    tag: "CUSTOMER",
    name: "お客様",
    note: "スマホの中で完結します。",
    items: ["ガチャを引く", "当たる", "発送を依頼する", "問い合わせる"],
    card: "border-gold/30 bg-gradient-to-b from-gold-soft/20 to-white",
    chip: "border-gold/45 bg-gold-soft/30 text-slate",
    dot: "bg-gold/55",
  },
];

export default function RoleFlow() {
  return (
    <section
      id="role"
      className="relative scroll-mt-24 overflow-hidden bg-paper py-11 sm:py-24 lg:py-32"
    >
      {/* 以前の「機能一覧」セクションは、この役割分担の中へ統合しました。
          外から張られているリンクが切れないよう、飛び先だけ残しています。 */}
      <span id="os" aria-hidden className="block scroll-mt-24" />

      {/* 背景。薄いグリッドだけ置いて、面が続いている感じを出す */}
      <div
        aria-hidden
        className="grid-lite pointer-events-none absolute inset-0 opacity-[0.5]"
      />

      <div className="container-x relative">
        {/* ───────── 見出し ───────── */}
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <span className="num text-label text-slate3">MORE DETAIL</span>
          <span className="eyebrow-lite">WHO DOES WHAT</span>
        </div>
        <h2 className="h-display mt-4 text-h1 text-balance text-slate sm:mt-6">
          <span className="inline-block">
            <span className="text-gradient-royal">全部をあなたがやる</span>
            必要はありません。
          </span>
        </h2>
        {/*
          ★ここは短く保つこと。
            流れの説明は、上の「A DAY IN OPERATION」で終わっています。
        */}
        <p className="mt-5 max-w-[36em] text-lead text-pretty leading-[1.9] text-slate2 sm:mt-6">
          運営の仕事を、3つに分けたものです。あなたの手が要るのは、左の3つだけです。
        </p>

        {/* ───────── 1枚の図：HUMAN / OS / CUSTOMER ───────── */}
        <Reveal delay={0.06} className="mt-7 sm:mt-10">
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] lg:items-stretch lg:gap-0">
            {COLUMNS.map((c, i) => (
              <RoleColumn key={c.tag} column={c} first={i === 0} />
            ))}
          </div>
        </Reveal>

        {/* ───────── 結び ───────── */}
        <Reveal delay={0.1} className="mt-4 sm:mt-6">
          <div className="relative overflow-hidden rounded-3xl border border-blue-ink/15 bg-gradient-to-b from-blue-pale/70 to-white px-6 py-8 text-center shadow-lift2 sm:px-12 sm:py-12">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-ink/25 to-transparent"
            />
            <p className="h-display text-h2 text-balance text-slate">
              運営をなくすのではなく、面倒な部分を減らします。
            </p>
            <p className="mx-auto mt-5 max-w-[38em] text-note text-pretty leading-[1.95] text-slate3">
              販売を止めるかどうかのような、事業に影響する判断は、管理画面で人が行います。
              AIは「見つけて知らせる」ところまでを担当します。
            </p>
          </div>
        </Reveal>

        {/* ───────── 項目9：使うほど、あなたらしいガチャへ（ROADMAP） ───────── */}
        <Reveal delay={0.14} className="mt-4 sm:mt-5">
          <Roadmap />
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════
   1つの列
   ──────────────────────────────────────────────
   ★箇条書きに「/」を入れないこと（2026-08-22）。
     前は1行に畳むために間へ「/」を置いていました。
     見た目にも、読み上げにも、コピーしたときにも
     「/扱うジャンル」のような要らない記号が残ります。
     縦に並べれば、記号は要りません。
   ══════════════════════════════════════════════ */

function RoleColumn({ column: c, first }: { column: Column; first: boolean }) {
  return (
    <div
      className={`rounded-3xl border p-5 shadow-lift sm:p-6 lg:rounded-none lg:first:rounded-l-3xl lg:last:rounded-r-3xl ${c.card} ${
        first ? "" : "lg:border-l-0"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={`num inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.14em] ${c.chip}`}
        >
          {c.tag}
        </span>
        <span className="text-note font-semibold text-slate2">{c.name}</span>
      </div>

      <p className="mt-3 text-note text-pretty leading-[1.9] text-slate3">
        {c.note}
      </p>

      <ul className="mt-4 space-y-2 border-t border-edge2 pt-4">
        {c.items.map((it) => (
          <li key={it} className="flex items-baseline gap-2.5">
            <span
              aria-hidden
              className={`mt-[0.55em] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`}
            />
            <span className="text-note leading-[1.85] text-slate2">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ══════════════════════════════════════════════
   項目9：使うほど、あなたらしいガチャへ
   ──────────────────────────────────────────────
   ★自動学習はまだ実装していない。
     いま出来ることのように書かないこと。
     ROADMAP（今後の予定）として、はっきり分けて出す。
   ══════════════════════════════════════════════ */

function Roadmap() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-dashed border-edge bg-paper2 p-5 sm:p-9">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="num inline-flex items-center rounded-full border border-gold/45 bg-gold-soft/25 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-slate">
          ROADMAP
        </span>
        <span className="num text-label text-slate3">今後の予定・未実装</span>
      </div>

      <h3 className="h-display mt-4 text-h3 text-balance text-slate sm:mt-5">
        使うほど、あなたらしいガチャへ。
      </h3>
      <p className="mt-4 max-w-[42em] text-note text-pretty leading-[1.95] text-slate2">
        あなたが「ここは直したい」「これは承認する」と決めた履歴は、そのガチャ運営の判断の記録です。
        この記録を、許可された範囲の運用データとして次のガチャ案づくりに活かす仕組みを検討しています。
      </p>

      <div className="mt-5 grid gap-2.5 sm:mt-7 sm:grid-cols-3">
        {[
          {
            t: "修正の傾向を覚える",
            b: "「S賞はもっと豪華に」といった直しが続けば、最初からその方向の案を出す。",
          },
          {
            t: "承認されやすい形を学ぶ",
            b: "承認された構成と、作り直しになった構成の違いを蓄積する。",
          },
          {
            t: "運営ごとの色を残す",
            b: "同じ条件でも、運営者によって出てくる案が変わっていく。",
          },
        ].map((x) => (
          <div
            key={x.t}
            className="rounded-2xl border border-edge2 bg-white/70 p-4 sm:p-5"
          >
            <p className="text-note font-bold text-slate">{x.t}</p>
            <p className="mt-2 text-note text-pretty leading-[1.9] text-slate3">
              {x.b}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-5 border-t border-edge2 pt-5 text-note text-pretty leading-[1.9] text-slate3">
        この自動学習は、現時点では実装していません。
        今の<span className="nb">AI GACHA OS</span>は、登録済みのデータと入力条件をもとにガチャ案を作ります。
        いつ提供できるかが決まっていない機能を、すでに使えるものとしては書きません。
      </p>

      <div className="mt-5">
        <MoreDetail label="いま実際にできること">
          <ul className="space-y-2.5">
            <li>
              入力した条件（料金・口数・ジャンル・目標還元率）からのガチャ案作成
            </li>
            <li>登録済みの商品データ・市場価格を参照した賞構成と確率の計算</li>
            <li>公開前バックテストによる、相場が動いた場合の試算</li>
            <li>公開後の実還元率・残口数・価格変動の監視と警告</li>
            <li>AIへの修正依頼（賞を豪華に、還元率を下げる、など）</li>
          </ul>
        </MoreDetail>
      </div>
    </div>
  );
}
