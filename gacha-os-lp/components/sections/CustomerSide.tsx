"use client";

/**
 * 「お客様からはどう見えるのか」を見せる場所。
 *
 * このLPは管理画面ばかりを見せてきましたが、
 * 買う側が本当に知りたいのは「自分のお客さんが楽しめるのか」です。
 * ここが無いと、どれだけ管理画面が良くても判断できません。
 *
 * ★仕掛け
 *   左の管理画面で［承認して公開する］を押すと、
 *   中央を通って、右のスマホに NEW GACHA として出ます。
 *   「作る → 実際に売られる」がこの1画面でつながります。
 *
 * ★表示するのは、標準機能として実装しているものだけ（content/site.ts の baseFeatures.user）。
 *   画面の中身はデモです。実績値ではありません。
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";
import { EV, track } from "@/lib/track";

type Phase = "draft" | "published" | "playing" | "result" | "chosen";

export default function CustomerSide() {
  const [phase, setPhase] = useState<Phase>("draft");
  const [choice, setChoice] = useState<"ship" | "point" | null>(null);
  const reduce = useReducedMotion() ?? false;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const publish = () => {
    setPhase("published");
    track(EV.ctaClick, { place: "customer_side", target: "publish" });
  };

  const draw = () => {
    setPhase("playing");
    timer.current = setTimeout(() => setPhase("result"), reduce ? 400 : 1700);
  };

  const reset = () => {
    if (timer.current) clearTimeout(timer.current);
    setChoice(null);
    setPhase("draft");
  };

  const live = phase !== "draft";

  return (
    <section
      id="customer"
      className="relative scroll-mt-24 overflow-hidden bg-paper2 py-11 sm:py-24 lg:py-36"
    >
      <div className="pointer-events-none absolute inset-0 grid-lite opacity-45 [mask-image:radial-gradient(ellipse_at_50%_8%,#000_10%,transparent_70%)]" />

      <div className="container-wide relative">
        <Reveal>
          <div className="mx-auto max-w-4xl text-center">
            <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2">
              <span className="num whitespace-nowrap text-label text-slate3">
                SECTION 02
              </span>
              <span className="hidden h-px w-8 bg-edge sm:block" />
              <span className="eyebrow-lite">CUSTOMER SIDE</span>
            </div>
            <h2 className="h-display mt-4 text-h2 text-balance text-slate sm:mt-6">
              <span className="inline-block">管理が簡単でも、</span>
              <span className="inline-block">
                お客様が楽しめなければ意味がありません。
              </span>
            </h2>
            <p className="mx-auto mt-5 max-w-[34em] text-body text-pretty text-slate2 sm:mt-7">
              管理画面で承認したガチャが、お客様の画面にどう出るのか。実際に触って確かめられます。
            </p>
          </div>
        </Reveal>

        {/* ───────── OPERATOR ─ CORE ─ CUSTOMER ───────── */}
        <div className="mt-10 sm:mt-16 lg:mt-20 lg:[perspective:2000px]">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.72fr)] lg:items-center lg:gap-6 lg:[transform-style:preserve-3d]">
            {/* ── 左：管理画面 ── */}
            <div className="lg:[transform:rotateY(7deg)_translateZ(-30px)]">
              <OperatorPanel live={live} onPublish={publish} />
            </div>

            {/* ── 中央：データが流れる ── */}
            <Conduit live={live} reduce={reduce} />

            {/* ── 右：お客様のスマホ ── */}
            <div className="mx-auto w-full max-w-[320px] lg:[transform:rotateY(-10deg)_translateZ(50px)]">
              <Phone
                phase={phase}
                choice={choice}
                reduce={reduce}
                onDraw={draw}
                onChoose={(c) => {
                  setChoice(c);
                  setPhase("chosen");
                }}
                onReset={reset}
              />
            </div>
          </div>
        </div>

        {/* ───────── いま何が起きたか ───────── */}
        <Reveal delay={0.06} className="mt-5 sm:mt-8">
          <div className="lp-card p-5 sm:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <span className="eyebrow-lite">APPROVE → PUBLISH → CUSTOMER</span>
              <span className="num text-label text-slate3">ONE LOOP</span>
            </div>
            <ol className="mt-5 grid gap-2 sm:mt-7 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  n: "01",
                  t: "管理画面で承認",
                  b: "内容を確認して［承認して公開する］を押します。押すまでは公開されません。",
                },
                {
                  n: "02",
                  t: "そのまま公開",
                  b: "承認した内容が、そのままお客様の画面に並びます。作り直しは要りません。",
                },
                {
                  n: "03",
                  t: "お客様が引く",
                  b: "ポイントで購入し、演出のあと結果が出ます。当たりは発送かポイント還元を選べます。",
                },
                {
                  n: "04",
                  t: "運営側に戻る",
                  b: "発送依頼は管理画面に集まり、実還元率の監視は公開と同時に始まります。",
                },
              ].map((s) => (
                <li
                  key={s.n}
                  className="rounded-2xl border border-edge2 bg-paper2 p-4 sm:p-5"
                >
                  <span className="num text-label text-blue-ink">{s.n}</span>
                  <p className="mt-2.5 text-note font-bold text-pretty text-slate">
                    {s.t}
                  </p>
                  <p className="mt-2 text-note text-pretty text-slate2">
                    {s.b}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>

        {/* ───────── お客様側もシステムが支える ───────── */}
        <Reveal delay={0.06} className="mt-4 sm:mt-6">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="lp-card p-5 sm:p-8">
              <span className="eyebrow-lite">SUPPORT FOR CUSTOMERS</span>
              <h3 className="mt-4 text-h3 font-bold text-balance text-slate">
                運営者だけではなく、お客様の体験も支えます。
              </h3>
              <p className="mt-4 text-note text-pretty leading-[1.95] text-slate2">
                「発送はいつですか」「まだ届きません」。この種の問い合わせは件数が多く、内容もほぼ同じです。
                権限の範囲でマイページの情報を参照し、AIがその場で答えます。
              </p>

              <div className="mt-6 rounded-2xl border border-edge2 bg-paper2 p-4 sm:p-5">
                <div className="flex justify-end">
                  <div className="max-w-[26em] rounded-2xl rounded-br-md bg-blue-ink px-4 py-2.5 text-note leading-[1.8] text-white">
                    さっき当たったカード、いつ届きますか？
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-2.5">
                  <span className="num mt-1 shrink-0 rounded-full border border-blue-ink/18 bg-blue-pale px-2.5 py-1 text-[11px] tracking-[0.16em] text-blue-ink">
                    AI
                  </span>
                  <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-edge bg-white px-4 py-2.5 text-note leading-[1.8] text-slate shadow-lift">
                    発送依頼を受け付けています。準備ができ次第、追跡番号をマイページとメールでお知らせします。
                  </div>
                </div>
                <p className="mt-3.5 text-note leading-[1.9] text-slate3">
                  返金・例外対応・重大な申し出は、AIが答えずに管理者へ引き継ぎます。
                </p>
              </div>
            </div>

            <div className="lp-tint rounded-3xl p-5 sm:p-8">
              <span className="num text-label text-slate3">
                USER SIDE / 標準機能
              </span>
              <ul className="mt-5 space-y-2.5">
                {[
                  "会員登録・ログイン・SMS本人認証",
                  "ポイントチャージ（クレジットカード / 銀行振込）",
                  "ガチャ抽選（等級・在庫・口数の管理）",
                  "当たりは「発送」か「ポイント還元」を選択",
                  "マイページ（保有・履歴・住所・発送状況）",
                  "お知らせ / FAQ / 法務ページ",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-ink/60"
                    />
                    <span className="text-note text-pretty text-slate2">
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t border-edge2 pt-5 text-note leading-[1.95] text-slate2">
                上の画面は、この標準機能の範囲で作ったデモです。演出やデザインは、扱う商品に合わせて調整します。
              </p>
            </div>
          </div>
        </Reveal>

        {/* ───────── AIだから安心、とは書かない ───────── */}
        <Reveal delay={0.1} className="mt-4 sm:mt-6">
          <div className="rounded-3xl border border-edge bg-white px-6 py-8 shadow-lift sm:px-10 sm:py-10">
            <p className="h-display text-h3 text-balance text-slate">
              <span className="inline-block">AIと自動チェックで、</span>
              <span className="inline-block">
                人が見落としやすい部分も確認します。
              </span>
            </p>
            <p className="mt-5 max-w-[42em] text-note text-pretty leading-[1.95] text-slate2">
              ただし、AIだからミスがない、という作りにはしていません。還元率の危険水域、在庫の不足、価格の急変は自動で検知して知らせますが、
              販売を止めるか続けるかの最終判断は管理者が行います。判断の記録は、誰がいつ決めたかまで残ります。
            </p>

            <div className="mt-6">
              <MoreDetail label="お客様側で気をつけて設計していること">
                <ul className="space-y-2.5">
                  <li>
                    ・残り口数と、いま出ている賞の残数を隠さずに表示します。
                  </li>
                  <li>
                    ・演出は結果を再生しているだけで、演出の途中で結果が変わることはありません。
                  </li>
                  <li>
                    ・購入前に、1回の料金・総口数・賞の内容と本数を確認できる位置に置きます。
                  </li>
                  <li>・1人あたりの購入上限を設定できます。</li>
                  <li>
                    ・景品表示法・特定商取引法・資金決済法を意識した画面と表示にしますが、個別の法的適合性は専門家のご確認をお願いしています。
                  </li>
                </ul>
              </MoreDetail>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/demo" className="btn-primary w-full sm:w-auto">
                管理画面のほうを触ってみる
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <Link href="/#contact" className="btn-outline w-full sm:w-auto">
                導入について相談する
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════
   左：管理画面（承認して公開する）
   ══════════════════════════════════════════════ */

function OperatorPanel({
  live,
  onPublish,
}: {
  live: boolean;
  onPublish: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift2">
      <div className="flex items-center justify-between border-b border-edge2 bg-paper2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/55" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-ok/60" />
          <span className="num ml-2 truncate text-[11px] tracking-[0.14em] text-slate3">
            OPERATOR / ガチャ管理
          </span>
        </div>
        <span className="num shrink-0 text-[10px] tracking-[0.2em] text-slate3">
          DEMO
        </span>
      </div>

      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-note font-bold text-slate">
            人気カード 500円ガチャ
          </p>
          <span
            className={`num whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] tracking-[0.16em] ${
              live
                ? "border-ok-ink/25 bg-ok/10 text-ok-ink"
                : "border-edge bg-paper2 text-slate3"
            }`}
          >
            {live ? "公開中" : "未公開（下書き）"}
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-2.5">
          {[
            { k: "1回の料金", v: "500円" },
            { k: "総口数", v: "1,000口" },
            { k: "設定還元率", v: "94.8%" },
            { k: "バックテスト", v: "SAFE" },
          ].map((r) => (
            <div
              key={r.k}
              className="rounded-xl border border-edge2 bg-paper2 px-3.5 py-3"
            >
              <dt className="text-note text-slate3">{r.k}</dt>
              <dd className="num mt-1 text-note font-bold text-slate">{r.v}</dd>
            </div>
          ))}
        </dl>

        <button
          type="button"
          onClick={onPublish}
          disabled={live}
          className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-note font-bold transition-all duration-300 ${
            live
              ? "cursor-default border border-edge bg-paper2 text-slate3"
              : "bg-blue-ink text-white shadow-blue-lift hover:-translate-y-0.5"
          }`}
        >
          {live ? "公開しました" : "承認して公開する"}
          {!live && (
            <svg
              width="17"
              height="17"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
            >
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        <p className="mt-3 text-note leading-[1.9] text-slate3">
          押すと、右のお客様画面に反映されます。押すまでは公開されません。
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   中央：データが流れる導線
   ══════════════════════════════════════════════ */

function Conduit({ live, reduce }: { live: boolean; reduce: boolean }) {
  return (
    <div className="flex items-center justify-center py-1 lg:h-full lg:w-[104px] lg:flex-col">
      {/* スマホ：下向き / PC：右向き */}
      <div className="relative flex h-16 w-full items-center justify-center lg:h-full lg:w-16">
        <span
          aria-hidden
          className="absolute h-px w-full bg-gradient-to-r from-transparent via-edge to-transparent lg:h-full lg:w-px lg:bg-gradient-to-b"
        />
        <AnimatePresence>
          {live && !reduce && (
            <motion.span
              key="pulse"
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute h-1.5 w-1.5 rounded-full bg-blue-ink shadow-glow"
              style={{ animation: "float 2.6s ease-in-out infinite" }}
            />
          )}
        </AnimatePresence>
        <span
          className={`num relative whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] tracking-[0.16em] transition-colors duration-500 ${
            live
              ? "border-blue-ink/25 bg-blue-pale text-blue-ink"
              : "border-edge bg-white text-slate3"
          }`}
        >
          {live ? "PUBLISHED" : "CORE"}
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   右：お客様のスマホ（3D）
   ══════════════════════════════════════════════ */

function Phone({
  phase,
  choice,
  reduce,
  onDraw,
  onChoose,
  onReset,
}: {
  phase: Phase;
  choice: "ship" | "point" | null;
  reduce: boolean;
  onDraw: () => void;
  onChoose: (c: "ship" | "point") => void;
  onReset: () => void;
}) {
  return (
    <div className="relative">
      {/* 端末の枠。金属っぽい縁 → ベゼル → 画面 の3層で厚みを出す */}
      <div className="rounded-[38px] bg-gradient-to-b from-silver via-mist to-silver p-[3px] shadow-float">
        <div className="rounded-[35px] bg-white p-2">
          <div className="relative aspect-[9/19] w-full overflow-hidden rounded-[28px] bg-paper2">
            {/* ノッチ */}
            <span
              aria-hidden
              className="absolute left-1/2 top-2 z-20 h-[18px] w-[86px] -translate-x-1/2 rounded-full bg-slate/90"
            />
            {/* 画面上部のバー */}
            <div className="relative z-10 flex items-center justify-between px-4 pb-2 pt-[34px]">
              <span className="num text-[10px] tracking-[0.18em] text-slate3">
                MY SHOP
              </span>
              <span className="num rounded-full bg-white px-2 py-[3px] text-[10px] tracking-[0.12em] text-slate2 shadow-lift">
                12,500 pt
              </span>
            </div>

            <div className="relative h-[calc(100%-58px)] overflow-hidden px-3 pb-3">
              <AnimatePresence mode="wait">
                {phase === "draft" && <ScreenEmpty key="empty" />}
                {phase === "published" && (
                  <ScreenGacha key="gacha" onDraw={onDraw} />
                )}
                {phase === "playing" && (
                  <ScreenPlaying key="play" reduce={reduce} />
                )}
                {(phase === "result" || phase === "chosen") && (
                  <ScreenResult
                    key="result"
                    choice={choice}
                    chosen={phase === "chosen"}
                    onChoose={onChoose}
                    onReset={onReset}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <p className="num mt-4 text-center text-[11px] tracking-[0.18em] text-slate3">
        CUSTOMER VIEW — DEMO
      </p>
    </div>
  );
}

const screenIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const },
};

function ScreenEmpty() {
  return (
    <motion.div
      {...screenIn}
      className="flex h-full flex-col items-center justify-center px-4 text-center"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-edge bg-white text-slate3 shadow-lift">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 7h16v13H4zM4 7l2-3h12l2 3M12 11v5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <p className="mt-4 text-note font-semibold text-slate2">
        まだガチャがありません
      </p>
      <p className="mt-2 text-[13px] leading-[1.7] text-slate3">
        左の管理画面で承認すると、
        <br />
        ここに並びます。
      </p>
    </motion.div>
  );
}

function ScreenGacha({ onDraw }: { onDraw: () => void }) {
  return (
    <motion.div {...screenIn} className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <span
          // 動きの打ち消しは globals.css の prefers-reduced-motion に任せる
          className="num animate-pulseline rounded-full bg-ok/12 px-2 py-[3px] text-[10px] tracking-[0.16em] text-ok-ink"
        >
          NEW GACHA
        </span>
      </div>

      {/* メイン景品 */}
      <div className="relative mt-2.5 overflow-hidden rounded-2xl border border-edge bg-gradient-to-b from-blue-pale to-white p-3 shadow-lift">
        <div className="flex h-[92px] items-center justify-center rounded-xl border border-edge2 bg-white">
          <span className="num text-[11px] tracking-[0.2em] text-slate3">
            S賞 メイン景品
          </span>
        </div>
        <p className="mt-2.5 text-[13px] font-bold leading-[1.5] text-slate">
          人気カード 500円ガチャ
        </p>
      </div>

      {/* 残口数 */}
      <div className="mt-2.5 rounded-2xl border border-edge2 bg-white p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-slate3">残り口数</span>
          <span className="num text-[13px] font-bold text-slate">
            820 / 1,000
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-mist">
          <div className="h-full w-[82%] rounded-full bg-blue-ink" />
        </div>
        <div className="mt-2.5 grid grid-cols-4 gap-1">
          {[
            { k: "S", v: "2" },
            { k: "A", v: "9" },
            { k: "B", v: "68" },
            { k: "L", v: "1" },
          ].map((t) => (
            <div key={t.k} className="rounded-lg bg-paper2 py-1.5 text-center">
              <p className="num text-[10px] text-slate3">{t.k}賞</p>
              <p className="num text-[12px] font-bold text-slate">{t.v}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto space-y-1.5 pt-2.5">
        <button
          type="button"
          onClick={onDraw}
          className="w-full rounded-xl bg-blue-ink py-3 text-[13px] font-bold text-white shadow-blue-lift transition-transform duration-300 hover:-translate-y-0.5"
        >
          1回引く　500pt
        </button>
        <button
          type="button"
          onClick={onDraw}
          className="w-full rounded-xl border border-edge bg-white py-2.5 text-[13px] font-semibold text-slate2"
        >
          10連　5,000pt
        </button>
      </div>
    </motion.div>
  );
}

function ScreenPlaying({ reduce }: { reduce: boolean }) {
  return (
    <motion.div
      {...screenIn}
      className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-blue-pale via-white to-blue-pale"
    >
      <span
        aria-hidden
        className={`absolute h-[150px] w-[150px] rounded-full bg-blue/25 blur-2xl ${
          reduce ? "" : "animate-breathe"
        }`}
      />
      {!reduce && (
        <span aria-hidden className="absolute inset-0 bg-sheen animate-sweep" />
      )}
      <motion.span
        aria-hidden
        initial={{ rotateY: 0, scale: 0.9 }}
        animate={reduce ? { scale: 1 } : { rotateY: 720, scale: 1.05 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex h-[120px] w-[86px] items-center justify-center rounded-xl border border-blue-ink/25 bg-white shadow-lift2"
      >
        <span className="num text-[11px] tracking-[0.2em] text-blue-ink">
          ?
        </span>
      </motion.span>
      <p className="num relative mt-6 text-[11px] tracking-[0.24em] text-blue-ink">
        DRAWING...
      </p>
    </motion.div>
  );
}

function ScreenResult({
  choice,
  chosen,
  onChoose,
  onReset,
}: {
  choice: "ship" | "point" | null;
  chosen: boolean;
  onChoose: (c: "ship" | "point") => void;
  onReset: () => void;
}) {
  return (
    <motion.div {...screenIn} className="flex h-full flex-col">
      <div className="rounded-2xl border border-blue-ink/20 bg-gradient-to-b from-blue-pale to-white p-3 text-center shadow-lift">
        <p className="num text-[10px] tracking-[0.22em] text-blue-ink">A賞</p>
        <div className="mt-2 flex h-[86px] items-center justify-center rounded-xl border border-edge2 bg-white">
          <span className="num text-[11px] tracking-[0.16em] text-slate3">
            人気シングル
          </span>
        </div>
        <p className="mt-2.5 text-[14px] font-bold text-slate">
          獲得しました！
        </p>
      </div>

      {!chosen ? (
        <>
          <p className="mt-3 text-center text-[12px] leading-[1.7] text-slate2">
            受け取り方を選べます
          </p>
          <div className="mt-2.5 space-y-1.5">
            <button
              type="button"
              onClick={() => onChoose("ship")}
              className="w-full rounded-xl bg-blue-ink py-3 text-[13px] font-bold text-white shadow-blue-lift"
            >
              発送を依頼する
            </button>
            <button
              type="button"
              onClick={() => onChoose("point")}
              className="w-full rounded-xl border border-edge bg-white py-2.5 text-[13px] font-semibold text-slate2"
            >
              ポイントに還元する
            </button>
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-2xl border border-ok-ink/20 bg-ok/[0.07] p-3.5">
          <p className="num text-[10px] tracking-[0.18em] text-ok-ink">
            {choice === "ship" ? "SHIPPING REQUESTED" : "POINT RETURNED"}
          </p>
          <p className="mt-2 text-[12px] leading-[1.75] text-slate2">
            {choice === "ship"
              ? "発送依頼を受け付けました。運営側の管理画面に、この依頼が並びます。追跡番号が入るとマイページに出ます。"
              : "ポイントに戻しました。そのまま次のガチャに使えます。"}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onReset}
        className="mt-auto w-full rounded-xl border border-edge bg-paper2 py-2.5 text-[12px] font-semibold text-slate3"
      >
        最初から見る
      </button>
    </motion.div>
  );
}
