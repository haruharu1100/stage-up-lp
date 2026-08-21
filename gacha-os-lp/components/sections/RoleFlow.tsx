"use client";

import { motion, useReducedMotion } from "framer-motion";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";

/**
 * 「6つ全部を、あなたがやるわけではない」を見せるセクション。
 *
 * ここで一番伝えたいのは “運営者が全部やらなくていい” ということなので、
 * 6つの工程を横一列の細いカードに詰めない。
 * 左（人）と右（AI GACHA OS）の2レーンに振り分けて、
 * どちら側の仕事なのかが一目で分かる形にしている。
 *
 * 奥行きは CSS の 3D 変形だけで出している。
 * ★ここで新しく WebGL を立ち上げないこと（Hero で既に1つ動いている）。
 *
 * 文章は、動きが無くても最初から読める状態で置くこと。
 * framer-motion の viewport には amount を使わない（過去に画面が真っ白になった）。
 */

type Side = "human" | "ai" | "both";

type Role = {
  no: string;
  side: Side;
  /** 誰の仕事か */
  actor: string;
  title: string;
  body: string;
  /** 具体例。人には入力例、AIには何を見ているかを出す */
  detail: string[];
  /** 入力例など、そのまま読ませたい一文 */
  quote?: string;
};

const roles: Role[] = [
  {
    no: "01",
    side: "human",
    actor: "あなた",
    title: "指示する",
    body: "どんなガチャを作りたいかを、言葉で伝えます。専門用語は必要ありません。",
    quote:
      "500円・1000口で、いま人気のポケモンカード中心。還元率95%前後。ラストワンあり。",
    detail: [
      "1回いくらか / 何口売るか",
      "扱うジャンル・入れたい商品",
      "目標にしたい還元率",
      "ラストワン賞を入れるかどうか",
    ],
  },
  {
    no: "02",
    side: "ai",
    actor: "AI GACHA OS",
    title: "作る・試す",
    body: "商品候補から賞の構成までを組み上げ、公開前に結果のばらつきまで試算します。",
    detail: [
      "商品候補・賞構成・景品の本数",
      "等級ごとの当選確率",
      "設定還元率の計算",
      "登録済みの市場価格・人気傾向の参照",
      "公開前バックテスト（相場が動いた場合の試算）",
    ],
  },
  {
    no: "03",
    side: "human",
    actor: "あなた",
    title: "確認する",
    body: "出てきた内容を見て、承認するか、AIに直してもらうかを決めます。ここが人の重要な判断です。",
    detail: [
      "APPROVE（承認して公開する）",
      "AIに修正を依頼する（賞を豪華に／還元率を下げる など）",
      "承認しないかぎり、ガチャは公開されません",
    ],
  },
  {
    no: "04",
    side: "ai",
    actor: "AI GACHA OS",
    title: "販売中を監視する",
    body: "公開したあとも、数字を見続けます。危ないと判断した内容は管理画面と通知で知らせます。",
    detail: [
      "残り口数・売れ行き",
      "実際に出た還元率（実還元率）",
      "景品の市場価格の変動・高騰",
      "設定した条件から外れたときの警告",
    ],
  },
  {
    no: "05",
    side: "both",
    actor: "あなた ＋ システム",
    title: "仕入れて発送する",
    body: "実際の商品を扱うのは人の仕事です。そのまわりの事務作業はシステムが引き受けます。",
    detail: [
      "必要な商品と数量の一覧表示",
      "商品の購入先URLの表示",
      "発送依頼の一覧・ステータス管理",
      "伝票データの作成",
      "追跡番号の登録とお客様への発送通知",
    ],
  },
  {
    no: "06",
    side: "ai",
    actor: "AI GACHA OS",
    title: "問い合わせに答える",
    body: "よくある質問はAIが一次対応します。判断が必要なものは、AIが答えずに管理者へ引き継ぎます。",
    detail: [
      "発送状況・ポイント・使い方などの一次対応",
      "マイページの情報を参照した回答",
      "返金・例外対応・重大な申し出は管理者へエスカレーション",
    ],
  },
];

const SIDE_META: Record<
  Side,
  { tag: string; chip: string; bar: string; card: string }
> = {
  human: {
    tag: "HUMAN",
    chip: "border-edge bg-white text-slate",
    bar: "bg-slate/25",
    card: "border-edge bg-white",
  },
  ai: {
    tag: "AI",
    chip: "border-blue-ink/18 bg-blue-pale text-blue-ink",
    bar: "bg-blue-ink/40",
    card: "border-blue-ink/14 bg-gradient-to-b from-blue-pale/55 to-white",
  },
  both: {
    tag: "HUMAN + SYSTEM",
    chip: "border-gold/40 bg-gold-soft/25 text-slate",
    bar: "bg-gold/50",
    card: "border-gold/30 bg-gradient-to-b from-gold-soft/20 to-white",
  },
};

export default function RoleFlow() {
  const reduce = useReducedMotion();

  return (
    <section
      id="role"
      className="relative scroll-mt-24 overflow-hidden bg-paper py-11 sm:py-24 lg:py-36"
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
          <span className="inline-block">運営の流れは6つ。</span>{" "}
          <span className="inline-block">
            <span className="text-gradient-royal">全部をあなたがやる</span>
            必要はありません。
          </span>
        </h2>
        <p className="mt-5 max-w-[42em] text-lead text-pretty leading-[1.9] text-slate2 sm:mt-7">
          「ガチャを売る」と聞くと、作って、試して、公開して、見張って、送って、答えて……と、
          やることが多そうに見えます。実際にあなたの手が要るのは、この中の一部です。
        </p>

        {/* ───────── レーンの見出し（PCのみ） ───────── */}
        <div className="mt-9 hidden lg:mt-16 lg:grid lg:grid-cols-[minmax(0,1fr)_92px_minmax(0,1fr)] lg:items-end lg:gap-0">
          <div className="text-center">
            <span className="num text-label text-slate3">左のレーン</span>
            <p className="mt-2 text-body font-bold text-slate">
              あなたがすること
            </p>
          </div>
          <div aria-hidden />
          <div className="text-center">
            <span className="num text-label text-blue-ink/70">右のレーン</span>
            <p className="mt-2 text-body font-bold text-blue-ink">
              AI GACHA OS がすること
            </p>
          </div>
        </div>

        {/* ───────── 6つの役割 ───────── */}
        <ol className="relative mt-6 sm:mt-8 lg:mt-6 lg:[perspective:1600px]">
          {/* 中央の背骨（PCのみ） */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-edge to-transparent lg:block"
          />

          {roles.map((r, i) => (
            <RoleRow key={r.no} role={r} index={i} reduce={!!reduce} />
          ))}
        </ol>

        {/* ───────── 中央の一文（項目3） ───────── */}
        <Reveal delay={0.08} className="mt-6 sm:mt-10">
          <div className="relative overflow-hidden rounded-3xl border border-blue-ink/15 bg-gradient-to-b from-blue-pale/70 to-white px-6 py-9 text-center shadow-lift2 sm:px-12 sm:py-14">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-ink/25 to-transparent"
            />
            <p className="h-display text-h2 text-balance text-slate">
              <span className="inline-block">人が判断するのは、</span>{" "}
              <span className="inline-block">
                「確認」と「実物の対応」が中心。
              </span>
            </p>
            <p className="mx-auto mt-6 max-w-[40em] text-body text-pretty leading-[1.95] text-slate2">
              AIが日常の作業を支え、人は重要な判断と、実際の商品の取り扱いに集中できます。
              どこまでをAIに任せるかは、運営の方針に合わせて決められます。
            </p>
            <p className="mx-auto mt-4 max-w-[40em] text-note text-pretty leading-[1.9] text-slate3">
              販売を止めるかどうかのような、事業に影響する判断は、管理画面で人が行います。
              AIは「見つけて知らせる」ところまでを担当します。
            </p>

            {/*
              「運営をなくすのではなく、面倒な部分を減らします。」は、
              もともと独立したカードで置いていました。
              ただ、すぐ上の一文と同じことを言っているので、
              スマホでは似た箱が2つ続くだけになっていました。ここへ入れています。
            */}
            <p className="h-display mx-auto mt-8 max-w-[26em] border-t border-edge2 pt-8 text-h3 text-balance text-slate">
              運営をなくすのではなく、面倒な部分を減らします。
            </p>
          </div>
        </Reveal>

        {/* ───────── 項目9：使うほど、あなたらしいガチャへ（ROADMAP） ───────── */}
        <Reveal delay={0.16} className="mt-4 sm:mt-5">
          <Roadmap />
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════
   1つの役割（左レーン / 右レーン / 中央またぎ）
   ══════════════════════════════════════════════ */

function RoleRow({
  role: r,
  index,
  reduce,
}: {
  role: Role;
  index: number;
  reduce: boolean;
}) {
  const isRight = r.side === "ai";
  const isBoth = r.side === "both";

  /* 奥行き。中央に近いほど手前に出す。
     motion 側が transform を書き換えるので、外側の箱に持たせている。 */
  const depth = isBoth ? 44 : 26;

  return (
    <li className="relative lg:[transform-style:preserve-3d]">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_92px_minmax(0,1fr)] lg:items-stretch">
        {/* 左レーン */}
        {!isRight && !isBoth ? (
          <div
            className="pb-3 lg:pb-4 lg:pr-8"
            style={{ transform: `translateZ(${depth}px)` }}
          >
            <RoleCard role={r} index={index} reduce={reduce} />
          </div>
        ) : (
          <div aria-hidden className="hidden lg:block" />
        )}

        {/* 中央の番号 */}
        <div className="hidden lg:flex lg:items-center lg:justify-center">
          <span
            className={`num relative z-10 flex h-11 w-11 items-center justify-center rounded-full border bg-white text-[13px] font-bold shadow-lift ${
              isRight
                ? "border-blue-ink/25 text-blue-ink"
                : isBoth
                  ? "border-gold/45 text-slate"
                  : "border-edge text-slate"
            }`}
          >
            {r.no}
          </span>
        </div>

        {/* 右レーン */}
        {isRight ? (
          <div
            className="pb-3 lg:pb-4 lg:pl-8"
            style={{ transform: `translateZ(${depth}px)` }}
          >
            <RoleCard role={r} index={index} reduce={reduce} />
          </div>
        ) : (
          <div aria-hidden className="hidden lg:block" />
        )}
      </div>

      {/* 中央またぎ（05：人＋システム）は横幅いっぱいに置く */}
      {isBoth ? (
        <div
          className="pb-3 lg:-mt-2 lg:px-16 lg:pb-4"
          style={{ transform: `translateZ(${depth}px)` }}
        >
          <RoleCard role={r} index={index} reduce={reduce} />
        </div>
      ) : null}
    </li>
  );
}

/*
  カードの中の文章は、左右どちらのレーンにあっても必ず左そろえにする。
  右レーンだからと右そろえにすると、日本語が変な位置で折れて読みにくくなる。
  どちら側の仕事なのかは、置かれている位置とタグの色で分かる。
*/
function RoleCard({
  role: r,
  index,
  reduce,
}: {
  role: Role;
  index: number;
  reduce: boolean;
}) {
  const m = SIDE_META[r.side];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8% 0px -8% 0px" }}
      transition={
        reduce
          ? { duration: 0 }
          : {
              duration: 0.6,
              delay: Math.min(index, 3) * 0.05,
              ease: [0.16, 1, 0.3, 1],
            }
      }
      className={`h-full rounded-3xl border p-5 shadow-lift sm:p-7 ${m.card}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* スマホでは中央の番号が出ないので、カード内に番号を置く */}
        <span className="num text-label text-slate3 lg:hidden">
          STEP {r.no}
        </span>
        <span
          className={`num inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.14em] ${m.chip}`}
        >
          {m.tag}
        </span>
        <span className="text-note font-semibold text-slate2">{r.actor}</span>
      </div>

      <h3 className="mt-3.5 text-h3 font-bold text-balance text-slate sm:mt-4">
        {r.title}
      </h3>
      <p className="mt-3 max-w-[34em] text-note text-pretty leading-[1.95] text-slate2">
        {r.body}
      </p>

      {/* 入力例だけは、そのまま読ませたいので枠で出す */}
      {r.quote ? (
        <div className="mt-4 max-w-[34em] rounded-2xl rounded-tl-md border border-edge bg-paper2 px-4 py-3 sm:px-5 sm:py-3.5">
          <span className="num block text-[11px] tracking-[0.16em] text-slate3">
            入力の例
          </span>
          <p className="mt-1.5 text-note leading-[1.9] text-slate">
            「{r.quote}」
          </p>
          <p className="mt-2 text-note text-slate3">これだけです。</p>
        </div>
      ) : null}

      {/*
        ここは以前、1項目ずつ丸いタグにしていました。
        スマホだと1タグ＝1行になり、6枚ぶんで 1,000px 以上を
        「読み飛ばされる箇条書き」に使ってしまっていたため、
        続けて読める1つの文の形に畳んでいます。中身は減らしていません。
      */}
      <ul className="mt-4 max-w-[34em] rounded-2xl border border-edge2 bg-white/70 px-4 py-3 text-note leading-[1.95] text-slate2 sm:mt-5 sm:px-5">
        {r.detail.map((d, i) => (
          <li key={d} className="inline">
            {i > 0 && (
              <span aria-hidden className="mx-1.5 text-slate3/45">
                /
              </span>
            )}
            <span className="inline-flex items-baseline gap-1.5">
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${m.bar}`}
              />
              {d}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
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
        <span className="num text-label text-slate3">今後の予定 / 未実装</span>
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
        この自動学習は、現時点では実装していません。 今のAI GACHA
        OSは、登録済みのデータと入力条件をもとにガチャ案を作ります。
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
