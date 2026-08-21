"use client";

/**
 * 「AIに伝える → AIが作る → 自分が確かめる」を、読ませずに見せる場所。
 *
 * ★ここで新しく WebGL（3Dのキャンバス）を作らないこと。
 *   Hero で既に1つ動かしているため、2つ目を持つとスマホで一気に重くなります。
 *   奥行きは CSS の 3D 変形（perspective / rotate / translateZ）で出しています。
 *   これは GPU がそのまま処理できるので、見た目は立体でも負荷はほとんど増えません。
 *
 * ★中身は「動かなくても全部読める」状態で書くこと。
 *   スクロール量に応じて出す作りにすると、背の高い端末で
 *   一生表示されない部分が生まれます（過去に実際に起きました）。
 *   動きはあくまで飾りで、初期状態でも意味が通るようにしています。
 */

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";

/* ────────────────────────────────
   ACT 2 で組み上がる賞の構成（デモの数値）
   ──────────────────────────────── */
const tiers = [
  {
    rank: "S",
    label: "S賞",
    item: "高額シングル・封入BOX",
    n: 3,
    p: "0.3%",
    tone: "from-blue-ink to-blue-deep",
    text: "text-white",
  },
  {
    rank: "A",
    label: "A賞",
    item: "人気シングル",
    n: 12,
    p: "1.2%",
    tone: "from-blue/85 to-blue-ink",
    text: "text-white",
  },
  {
    rank: "B",
    label: "B賞",
    item: "中位カード・パック",
    n: 85,
    p: "8.5%",
    tone: "from-blue-pale to-white",
    text: "text-blue-ink",
  },
  {
    rank: "C",
    label: "C賞",
    item: "参加賞カード",
    n: 899,
    p: "89.9%",
    tone: "from-white to-white",
    text: "text-slate2",
  },
  {
    rank: "L",
    label: "ラストワン賞",
    item: "最後の1口に確定",
    n: 1,
    p: "確定",
    tone: "from-gold-soft to-gold",
    text: "text-slate",
  },
];

/** 中央のCOREを通って流れていくデータの並び（HUMAN → OS → CUSTOMER） */
const spine = [
  { code: "INPUT", label: "500円・1000口・人気カード", side: "human" },
  { code: "GACHA DESIGN", label: "賞の構成をAIが設計", side: "os" },
  { code: "BACKTEST", label: "公開前に赤字リスクを試す", side: "os" },
  { code: "APPROVE", label: "内容を見て、人が承認", side: "human" },
  { code: "CUSTOMER GACHA", label: "お客様の画面に公開", side: "customer" },
  { code: "REAL RTP", label: "販売中の実還元率を監視", side: "os" },
  { code: "SHIPPING", label: "発送依頼と伝票データ", side: "os" },
  { code: "SUPPORT", label: "定型の問い合わせに回答", side: "os" },
];

const SIDE_STYLE: Record<string, { chip: string; dot: string; name: string }> =
  {
    human: {
      chip: "border-edge bg-white text-slate",
      dot: "bg-slate3",
      name: "HUMAN",
    },
    os: {
      chip: "border-blue-ink/18 bg-blue-pale text-blue-ink",
      dot: "bg-blue-ink",
      name: "AI GACHA OS",
    },
    customer: {
      chip: "border-ok-ink/20 bg-ok/10 text-ok-ink",
      dot: "bg-ok-ink",
      name: "CUSTOMER",
    },
  };

export default function OperatingDay() {
  const stage = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;

  /** COREへ向かって商品が集まる量。動きを止める設定なら最初から完成形。 */
  const { scrollYProgress } = useScroll({
    target: stage,
    offset: ["start 0.9", "end 0.4"],
  });
  const gather = useTransform(scrollYProgress, [0, 0.5], [0, 1]);

  return (
    <section
      id="builder"
      className="relative scroll-mt-24 overflow-hidden bg-paper2 py-11 sm:py-24 lg:py-36"
    >
      {/*
        以前あった「3分ツアー」「6ステップ」「AIガチャ生成」の3セクションは、
        この1セクションにまとめました。
        外から張られているリンクが切れないよう、飛び先だけここに残しています。
      */}
      <span id="sixsteps" aria-hidden className="block scroll-mt-24" />
      <span id="tour" aria-hidden className="block scroll-mt-24" />

      <div className="pointer-events-none absolute inset-0 grid-lite opacity-45 [mask-image:radial-gradient(ellipse_at_50%_10%,#000_10%,transparent_72%)]" />

      <div className="container-wide relative">
        {/* ───────── 見出し ───────── */}
        <Reveal>
          <div className="mx-auto max-w-4xl text-center">
            <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2">
              <span className="num whitespace-nowrap text-label text-slate3">
                SECTION 02
              </span>
              <span className="hidden h-px w-8 bg-edge sm:block" />
              <span className="eyebrow-lite">A DAY IN OPERATION</span>
            </div>
            <h2 className="h-display mt-4 text-h2 text-balance text-slate sm:mt-6">
              <span className="inline-block">ガチャの作り方が</span>
              <span className="inline-block">分からなくても大丈夫。</span>
            </h2>
            <p className="mx-auto mt-5 max-w-[34em] text-body text-pretty text-slate2 sm:mt-7">
              AIに、「どういうガチャを作りたいか」を伝えてください。市場価格や商品候補など、利用可能なデータを参照しながら、ガチャの構成案を作成します。
            </p>
          </div>
        </Reveal>

        {/* ───────── 3Dステージ：HUMAN → CORE → CUSTOMER ───────── */}
        <div ref={stage} className="relative mt-8 sm:mt-14 lg:mt-20">
          <Stage gather={gather} />
          <p className="mt-2 text-center text-note text-slate3 lg:hidden">
            → 横になぞると、人 → AI → お客様の順に見られます
          </p>
        </div>

        {/*
          ───────── 流れ（COREを通って何が起きるか） ─────────
          ここは「地図」であって、説明ではありません。
          8個をカードで縦に積むと、このすぐ下の ACT 01〜03 と
          ページ後半のセクションで もう一度同じ話をすることになり、
          スマホでは 1,300px ぶん ただ長いだけの場所になっていました。
          いまは1本のレールに畳んで、中身は各セクション側に任せています。
        */}
        <Reveal delay={0.06} className="mt-4 sm:mt-6">
          <div className="lp-card overflow-hidden p-5 sm:p-7">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <span className="eyebrow-lite">DATA FLOW</span>
              <span className="num text-label text-slate3">
                HUMAN / OS / CUSTOMER
              </span>
            </div>

            <div className="-mx-5 mt-4 overflow-x-auto px-5 sm:mt-5">
              <ol className="flex min-w-max items-center gap-1.5">
                {spine.map((s, i) => {
                  const st = SIDE_STYLE[s.side];
                  return (
                    <li key={s.code} className="flex items-center gap-1.5">
                      {i > 0 && (
                        <span aria-hidden className="text-slate3/50">
                          ›
                        </span>
                      )}
                      <span
                        className={`num inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] tracking-[0.12em] ${st.chip}`}
                        title={`${st.name}／${s.label}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                        {s.code}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            <p className="mt-4 text-note text-pretty leading-[1.95] text-slate2">
              白＝あなた、青＝AI GACHA OS、緑＝お客様の画面です。
              このうち白は2か所。残りはこの下から順番に、実際の画面で見ていきます。
            </p>
          </div>
        </Reveal>

        {/* ───────── ACT 1：自然文で伝える ───────── */}
        <Reveal delay={0.06} className="mt-4 sm:mt-6">
          <ActOne />
        </Reveal>

        {/* ───────── ACT 2：賞の構成が組み上がる ───────── */}
        <Reveal delay={0.06} className="mt-4 sm:mt-6">
          <ActTwo reduce={reduce} />
        </Reveal>

        {/* ───────── ACT 3：試して、承認する ───────── */}
        <Reveal delay={0.06} className="mt-4 sm:mt-6">
          <ActThree />
        </Reveal>

        {/* ───────── 中央の一文 ───────── */}
        <Reveal delay={0.1} className="mt-5 sm:mt-8">
          <div className="relative overflow-hidden rounded-3xl border border-blue-ink/15 bg-gradient-to-b from-blue-pale/70 to-white px-6 py-9 text-center shadow-lift2 sm:px-12 sm:py-12">
            <p className="h-display text-h3 text-balance text-slate">
              <span className="inline-block">ここまでで人がしたのは、</span>
              <span className="inline-block">
                「伝える」と「確認する」だけ。
              </span>
            </p>
            <p className="mx-auto mt-5 max-w-[38em] text-note text-pretty leading-[1.95] text-slate2">
              賞の構成も、本数も、確率も、還元率の計算も、公開前の試算も、AI
              GACHA OS
              側で組み上がります。承認しないかぎり、ガチャは公開されません。
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════
   3Dステージ
   ══════════════════════════════════════════════ */

/** COREへ集まってくる商品札。中心へ寄る動きだけを持たせる。 */
const INBOUND = [
  { t: "カード相場", x: -280, y: -104 },
  { t: "在庫", x: 268, y: -118 },
  { t: "人気傾向", x: -306, y: 58 },
  { t: "仕入れ値", x: 292, y: 74 },
  { t: "過去の実績", x: -150, y: 148 },
  { t: "目標還元率", x: 168, y: 152 },
];

function Stage({
  gather,
}: {
  gather: ReturnType<typeof useTransform<number, number>>;
}) {
  return (
    /*
      PCは、奥行きを付けた3枚の面（左＝人／中央＝OS／右＝お客様）。

      スマホでは、これを縦に積んでいました。
      ただ、左の吹き出しはこの下の ACT 01 と、
      右のガチャ画面は「お客様の画面」セクションと同じ内容なので、
      縦に積むと同じものを3回見せることになっていました。
      いまは横に並べて、指でなぞって見てもらう形にしています
      （中身は減らしていません。並べ方を変えただけです）。
    */
    <div className="relative">
      <div className="lg:[perspective:1800px]">
        <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3 lg:mx-0 lg:grid lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.16fr)_minmax(0,0.92fr)] lg:items-center lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0 lg:[transform-style:preserve-3d]">
          {/* ── 左：HUMAN ── */}
          <div className="w-[82%] shrink-0 snap-center lg:w-auto lg:[transform:rotateY(9deg)_translateZ(-40px)]">
            <SidePanel
              name="HUMAN"
              sub="運営者"
              tone="human"
              foot="入力するのは、方針だけ。"
            >
              <div className="relative rounded-2xl rounded-bl-md border border-edge bg-white p-4 text-note leading-[1.85] text-slate shadow-lift">
                「今人気のポケカ中心で、1回500円、1000口。
                <br className="hidden sm:block" />
                S賞は豪華にして、ラストワンも入れて。」
              </div>
            </SidePanel>
          </div>

          {/* ── 中央：AI GACHA OS CORE ── */}
          <div className="relative w-[82%] shrink-0 snap-center lg:w-auto lg:[transform:translateZ(60px)]">
            <Core gather={gather} />
          </div>

          {/* ── 右：CUSTOMER ── */}
          <div className="w-[82%] shrink-0 snap-center lg:w-auto lg:[transform:rotateY(-9deg)_translateZ(-40px)]">
            <SidePanel
              name="CUSTOMER"
              sub="お客様"
              tone="customer"
              foot="承認した内容が、そのまま並びます。"
            >
              <div className="rounded-2xl border border-edge bg-white p-3.5 shadow-lift">
                <div className="flex items-center justify-between">
                  <span className="num rounded-full bg-ok/12 px-2.5 py-1 text-[11px] tracking-[0.16em] text-ok-ink">
                    NEW
                  </span>
                  <span className="num text-[11px] tracking-[0.14em] text-slate3">
                    1000口
                  </span>
                </div>
                <p className="mt-3 text-note font-bold leading-[1.5] text-slate">
                  人気カード 500円ガチャ
                </p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-mist">
                  <div className="h-full w-[18%] rounded-full bg-blue-ink" />
                </div>
                <p className="num mt-2 text-[11px] tracking-[0.14em] text-slate3">
                  残 820 / 1000
                </p>
                <div className="mt-3 rounded-xl bg-blue-ink py-2.5 text-center text-note font-bold text-white">
                  1回引く　500pt
                </div>
              </div>
            </SidePanel>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidePanel({
  name,
  sub,
  tone,
  foot,
  children,
}: {
  name: string;
  sub: string;
  tone: "human" | "customer";
  foot: string;
  children: React.ReactNode;
}) {
  const st = SIDE_STYLE[tone];
  return (
    <div className="h-full rounded-3xl border border-edge bg-white/70 p-4 shadow-lift backdrop-blur-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={`num inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] tracking-[0.16em] ${st.chip}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
          {name}
        </span>
        <span className="text-note text-slate3">{sub}</span>
      </div>
      <div className="mt-4">{children}</div>
      <p className="mt-4 text-note text-pretty text-slate2">{foot}</p>
    </div>
  );
}

/** 中央の核。同心円を別々の深さに置いて、CSSだけで立体に見せる。 */
function Core({
  gather,
}: {
  gather: ReturnType<typeof useTransform<number, number>>;
}) {
  return (
    <div className="relative flex min-h-[280px] items-center justify-center py-6 sm:min-h-[340px]">
      {/* 集まってくるデータ（PCのみ。スマホでは重なって読めなくなるため出さない）

          ★「動きを減らす」設定のときに、この かたまり を JSX ごと消してはいけない。
            サーバーは常に「動きあり」で書き出すため、消すと最初の表示が食い違い、
            ページ全体が hydration エラーで作り直しになる（実際に起きました）。
            出し分けは CSS（motion-reduce）に任せて、HTMLは常に同じにしておく。 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex lg:motion-reduce:hidden"
      >
        {INBOUND.map((p) => (
          <Inbound key={p.t} p={p} gather={gather} />
        ))}
      </div>

      <div className="relative [perspective:900px]">
        {/* 外周のリング（奥に傾ける） */}
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[230px] w-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-ink/12 [transform:translate(-50%,-50%)_rotateX(68deg)] sm:h-[280px] sm:w-[280px]"
        />
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[178px] w-[178px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-ink/18 [transform:translate(-50%,-50%)_rotateX(68deg)_rotateZ(28deg)] sm:h-[216px] sm:w-[216px]"
        />
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[250px] w-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue/12 blur-2xl sm:h-[300px] sm:w-[300px]"
        />

        {/* 核そのもの */}
        <div
          // 動きの打ち消しは globals.css の prefers-reduced-motion に任せる
          // （ここでクラスを出し分けると hydration エラーになる）
          className="relative flex h-[152px] w-[152px] animate-breathe items-center justify-center rounded-full border border-blue-ink/20 bg-gradient-to-b from-white via-blue-pale to-white shadow-lift2 sm:h-[184px] sm:w-[184px]"
          style={{ animationDuration: "7s" }}
        >
          <span className="absolute inset-[12px] rounded-full border border-edge2" />
          <span className="absolute inset-0 overflow-hidden rounded-full">
            <span className="absolute inset-0 bg-sheen" />
          </span>
          <span className="num relative text-center text-label font-bold leading-[1.9] text-blue-ink">
            AI GACHA
            <br />
            OS
          </span>
        </div>
      </div>

      <span className="num absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] tracking-[0.2em] text-slate3">
        CORE
      </span>
    </div>
  );
}

function Inbound({
  p,
  gather,
}: {
  p: (typeof INBOUND)[number];
  gather: ReturnType<typeof useTransform<number, number>>;
}) {
  // gather 0 = 外側に散っている / 1 = 中心に吸い込まれている
  const x = useTransform(gather, (v) => `${p.x * (1 - v * 0.86)}px`);
  const y = useTransform(gather, (v) => `${p.y * (1 - v * 0.86)}px`);
  const opacity = useTransform(gather, [0, 0.72, 1], [0.95, 0.95, 0]);
  const scale = useTransform(gather, [0, 1], [1, 0.72]);

  return (
    <motion.span
      style={{ x, y, opacity, scale }}
      className="num absolute whitespace-nowrap rounded-full border border-edge bg-white px-3.5 py-1.5 text-[11px] tracking-[0.14em] text-slate2 shadow-lift"
    >
      {p.t}
    </motion.span>
  );
}

/* ══════════════════════════════════════════════
   ACT 1：自然文で伝える
   ══════════════════════════════════════════════ */

/**
 * ★「いま人気」と言い切れるのは、正式に利用可能なデータソースを
 *   実際に接続したときだけ。未接続の状態でそう書くと、優良誤認になります。
 *   ここは必ず「デモ表示」と明記します。
 */
const popular = [
  { name: "商品A（デモ）", note: "相場 12,800円 / 出品数 多" },
  { name: "商品B（デモ）", note: "相場 4,200円 / 出品数 多" },
  { name: "商品C（デモ）", note: "相場 1,900円 / 出品数 中" },
];

function ActOne() {
  return (
    <div className="lp-card overflow-hidden p-5 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <span className="eyebrow-lite">ACT 01 — TELL THE AI</span>
        <span className="num text-label text-slate3">HUMAN</span>
      </div>
      <h3 className="mt-4 text-h3 font-bold text-balance text-slate sm:mt-5">
        フォームを埋めなくても、話し言葉で伝わります。
      </h3>

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] sm:mt-8">
        {/* 会話 */}
        <div className="rounded-2xl border border-edge2 bg-paper2 p-4 sm:p-6">
          <div className="flex justify-end">
            <div className="max-w-[30em] rounded-2xl rounded-br-md bg-blue-ink px-4 py-3 text-note leading-[1.8] text-white shadow-blue-lift">
              今人気のポケカ中心で、1回500円、1000口。S賞は豪華にして、ラストワンも入れて。
            </div>
          </div>

          <div className="mt-3.5 flex items-start gap-2.5">
            <span className="num mt-1 shrink-0 rounded-full border border-blue-ink/18 bg-blue-pale px-2.5 py-1 text-[11px] tracking-[0.16em] text-blue-ink">
              AI
            </span>
            <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-edge bg-white px-4 py-3 shadow-lift">
              <p className="text-note leading-[1.8] text-slate">
                ガチャ案を作成しました。
              </p>
              <ul className="mt-2.5 space-y-1 text-note text-slate2">
                <li>・1回 500円 / 総口数 1,000口</li>
                <li>・S / A / B / C とラストワン賞</li>
                <li>・設定還元率 94.8%</li>
              </ul>
              <p className="mt-2.5 text-note leading-[1.8] text-slate2">
                内容を確認して、承認するか、直したいところを伝えてください。
              </p>
            </div>
          </div>
        </div>

        {/* 候補（デモ表示であることを必ず出す） */}
        <div className="rounded-2xl border border-edge2 bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="num text-label text-slate3">POPULAR ITEMS</span>
            <span className="num rounded-full border border-warn-ink/25 bg-warn/10 px-2.5 py-1 text-[11px] tracking-[0.16em] text-warn-ink">
              DEMO DATA
            </span>
          </div>
          <ul className="mt-4 space-y-2">
            {popular.map((p) => (
              <li
                key={p.name}
                className="flex min-w-0 items-center gap-3 rounded-xl border border-edge2 bg-paper2 px-3.5 py-3"
              >
                <span aria-hidden className="shrink-0 text-[15px]">
                  🔥
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-note font-semibold text-slate">
                    {p.name}
                  </span>
                  <span className="num mt-0.5 block text-[11px] tracking-[0.12em] text-slate3">
                    {p.note}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-note leading-[1.9] text-slate2">
            この一覧はデモ表示です。「いま人気」といった実データの表示は、正式に利用可能なデータソースを接続したうえで行います。
          </p>
        </div>
      </div>

      <div className="mt-4">
        <MoreDetail label="入力欄から指定することもできます（項目一覧）">
          <ul className="space-y-1.5">
            <li>・1回の料金 / 総口数</li>
            <li>・ジャンル・扱う商品の範囲</li>
            <li>・目標還元率</li>
            <li>・賞の段数、ラストワン賞の有無</li>
            <li>・1人あたりの購入上限</li>
          </ul>
          <p className="mt-4">
            話し言葉と入力欄のどちらでも同じ結果になります。慣れないうちは話し言葉、慣れてきたら入力欄、という使い分けができます。
          </p>
        </MoreDetail>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ACT 2：賞の構成が立体的に組み上がる
   ══════════════════════════════════════════════ */

function ActTwo({ reduce }: { reduce: boolean }) {
  return (
    <div className="lp-card overflow-hidden p-5 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <span className="eyebrow-lite">ACT 02 — THE AI BUILDS IT</span>
        <span className="num text-label text-slate3">AI GACHA OS</span>
      </div>
      <h3 className="mt-4 text-h3 font-bold text-balance text-slate sm:mt-5">
        賞の構成・本数・確率・還元率が、同時に組み上がります。
      </h3>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] sm:mt-8">
        {/* 立体的に積み上がる賞 */}
        <div className="rounded-2xl border border-edge2 bg-paper2 p-4 sm:p-6 lg:[perspective:1200px]">
          <div className="space-y-2 lg:[transform-style:preserve-3d] lg:[transform:rotateX(9deg)]">
            {tiers.map((t, i) => (
              /*
                奥行き（translateZ）は、この外側の箱に持たせています。
                中の motion.div は transform を自分で書き換えるので、
                同じ要素に translateZ を書くと消されてしまいます。
              */
              <div
                key={t.rank}
                style={{ transform: `translateZ(${(tiers.length - i) * 9}px)` }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-10% 0px -10% 0px" }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : {
                          duration: 0.55,
                          delay: i * 0.07,
                          ease: [0.16, 1, 0.3, 1],
                        }
                  }
                  className="flex min-w-0 items-center gap-3 rounded-2xl border border-edge bg-white p-3 shadow-lift sm:gap-4 sm:p-4"
                >
                  <span
                    className={`num flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-[15px] font-bold shadow-lift sm:h-12 sm:w-12 ${t.tone} ${t.text}`}
                  >
                    {t.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-note font-bold text-slate">
                      {t.label}
                    </span>
                    <span className="mt-0.5 block truncate text-note text-slate2">
                      {t.item}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-note font-bold text-slate">
                      {t.n.toLocaleString()}本
                    </span>
                    <span className="num mt-0.5 block text-[11px] tracking-[0.12em] text-slate3">
                      {t.p}
                    </span>
                  </span>
                </motion.div>
              </div>
            ))}
          </div>
        </div>

        {/* 出てくる数字 */}
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-edge bg-white p-5 shadow-lift sm:p-6">
            <p className="num text-label text-slate3">設定還元率</p>
            <p className="num mt-3 text-[44px] font-bold leading-none tracking-tight text-blue-ink sm:text-[56px]">
              94.8<span className="text-[26px] sm:text-[32px]">%</span>
            </p>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-mist">
              <div className="h-full w-[94.8%] rounded-full bg-gradient-to-r from-blue-ink to-blue" />
            </div>
            <p className="mt-3 text-note leading-[1.9] text-slate2">
              入力した目標に対して、賞の本数を調整しながら組みます。数値はデモの運営例です。
            </p>
          </div>

          <div className="rounded-2xl border border-edge2 bg-paper2 p-5 sm:p-6">
            <p className="num text-label text-slate3">同時に出るもの</p>
            <ul className="mt-3.5 space-y-1.5 text-note text-slate2">
              <li>・想定売上と想定原価</li>
              <li>・等級ごとの当選確率</li>
              <li>・必要な仕入れ数と仕入れ先の候補</li>
              <li>・在庫が足りない場合の警告</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ACT 3：試して、承認する
   ══════════════════════════════════════════════ */

function ActThree() {
  return (
    <div className="lp-card overflow-hidden p-5 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <span className="eyebrow-lite">ACT 03 — YOU CHECK IT</span>
        <span className="num text-label text-slate3">HUMAN</span>
      </div>
      <h3 className="mt-4 text-h3 font-bold text-balance text-slate sm:mt-5">
        公開する前に試せます。承認しなければ、公開されません。
      </h3>

      <div className="mt-6 grid gap-3 sm:mt-8 lg:grid-cols-3">
        {/* BACKTEST */}
        <div className="rounded-2xl border border-edge bg-white p-5 shadow-lift sm:p-6">
          <span className="num text-label text-slate3">BACKTEST</span>
          <p className="mt-3.5 text-note text-pretty leading-[1.9] text-slate2">
            相場が動いた場合や、当たりが早く出た場合の収益を、公開する前に何度も回して確かめます。
          </p>
          <div className="mt-4 space-y-2">
            {[
              { k: "相場が10%上がった場合", v: "97.1%", tone: "text-warn-ink" },
              { k: "S賞が序盤に出た場合", v: "99.4%", tone: "text-warn-ink" },
              { k: "通常の売れ方", v: "94.8%", tone: "text-ok-ink" },
            ].map((r) => (
              <div
                key={r.k}
                className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-edge2 bg-paper2 px-3.5 py-2.5"
              >
                <span className="min-w-0 flex-1 text-note text-slate2">
                  {r.k}
                </span>
                <span className={`num shrink-0 text-note font-bold ${r.tone}`}>
                  {r.v}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 判定 */}
        <div className="rounded-2xl border border-ok-ink/22 bg-ok/[0.06] p-5 sm:p-6">
          <span className="num text-label text-ok-ink">RESULT</span>
          <p className="num mt-4 text-[40px] font-bold leading-none tracking-tight text-ok-ink sm:text-[48px]">
            SAFE
          </p>
          <p className="mt-4 text-note text-pretty leading-[1.9] text-slate2">
            試した範囲で、危険な水準に届きませんでした。判定できるだけの材料がそろわないときは、SAFEとは表示せずUNKNOWNと出します。
          </p>
        </div>

        {/* 承認 */}
        <div className="rounded-2xl border border-edge bg-white p-5 shadow-lift sm:p-6">
          <span className="num text-label text-slate3">APPROVE</span>
          <p className="mt-3.5 text-note text-pretty leading-[1.9] text-slate2">
            ここが人の仕事です。内容を見て、承認するか、AIに直しを伝えるかを決めます。
          </p>
          <div className="mt-5 space-y-2">
            <div className="rounded-xl bg-blue-ink py-3 text-center text-note font-bold text-white shadow-blue-lift">
              承認して公開する
            </div>
            <div className="rounded-xl border border-edge bg-paper2 py-3 text-center text-note font-semibold text-slate2">
              AIに修正を依頼する
            </div>
          </div>
          <p className="mt-4 text-note leading-[1.9] text-slate3">
            承認の記録は、誰がいつ承認したかまで残ります。
          </p>
        </div>
      </div>
    </div>
  );
}
