"use client";

/**
 * すでにガチャサイトを運営している方へ向けた章。
 *
 * この章がひとつだけ伝えたいこと：
 *   「お客様から見えるサイトは、大きく変えない。運営する裏側は、大きく変える。」
 *
 * ★書いてはいけないこと
 *   ・「全部必ず移せます」…… 移行できる範囲は、既存システムの構成・契約・
 *     データ仕様によって変わります。断定は景表法上も危険です。
 *   ・今お使いのシステムをけなす表現。相手は現に売上を作っている事業者です。
 *     「悪い/古い」ではなく「道具が別々に分かれている」と書くこと。
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef, useState } from "react";
import { useIsNarrow, useQuality } from "@/lib/quality";
import { MIGRATION_BEATS } from "../three/MigrationWorld";
import StaticCore from "../hero/StaticCore";
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

const MigrationWorld = dynamic(() => import("../three/MigrationWorld"), {
  ssr: false,
  loading: () => <StaticCore />,
});

/** 移行前に必ず確認するもの（項目23）。IPアドレスだけではない、が言いたいこと */
const CHECKLIST = [
  { g: "つながり", items: ["ドメイン", "DNS", "サーバー", "SSL"] },
  { g: "お客様のデータ", items: ["会員", "ポイント", "購入履歴", "配送先"] },
  { g: "つないでいる先", items: ["決済", "Webhook", "配送", "メール", "外部API"] },
];

/** できるだけ残すもの（項目27） */
const KEEP = [
  "ブランド",
  "ドメイン",
  "会員",
  "ポイント残高",
  "ガチャ",
  "発送待ち",
  "顧客データ",
];

/** 3つの進め方（項目30） */
const WAYS = [
  {
    code: "FULL MIGRATION",
    ja: "全面移行",
    d: `今のドメインをそのまま使い、サイトと管理を${OS}へ切り替えます。URLは変わりません。`,
    url: "example-gacha.jp",
  },
  {
    code: "SUBDOMAIN",
    ja: "サブドメイン運用",
    d: "今のサイトは残したまま、ガチャだけを別のアドレスで動かします。少しずつ移したい場合に。",
    url: "gacha.example-gacha.jp",
  },
  {
    code: "HYBRID",
    ja: "部分導入",
    d: "既存システムを残し、AIガチャ設計・実還元率・発送管理など、必要な部分だけを使います。",
    url: "既存サイト ＋ 管理機能",
  },
];

export default function Migration() {
  return (
    <section id="migration" className="relative scroll-mt-24 bg-mist">
      <div className="pointer-events-none absolute inset-0 grid-lite opacity-40 [mask-image:radial-gradient(ellipse_at_50%_0%,#000_10%,transparent_72%)]" />

      {/* ── 見出しと、この章の一番大事な一言 ── */}
      <div className="container-x relative z-10 pt-11 sm:pt-24 lg:pt-32">
        <Reveal>
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span className="num whitespace-nowrap text-label text-slate3">
                SECTION 06
              </span>
              <span className="hidden h-px w-8 bg-edge sm:block" />
              <span className="num whitespace-nowrap text-label uppercase text-blue-ink">
                MIGRATION
              </span>
            </div>
            <h2 className="h-display mt-4 text-h1 text-balance text-slate sm:mt-6">
              すでにガチャサイトを
              <br className="hidden sm:block" />
              運営している方へ。
            </h2>
            <p className="mt-5 max-w-[36em] text-body text-pretty text-slate2 sm:mt-7">
              今のお客様体験を大きく変えず、裏側の運営を<span className="nb">AI GACHA OS</span>へ。
            </p>
          </div>
        </Reveal>

        {/* ★この2行が、この章の営業コピーの中心。短く、対比のまま置くこと。 */}
        <Reveal delay={0.06}>
          <div className="mt-9 grid gap-3.5 sm:mt-14 lg:grid-cols-2">
            <div className="rounded-3xl border border-edge bg-white p-7 shadow-lift sm:p-10">
              <span className="num text-label text-slate3">CUSTOMER SIDE</span>
              <p className="h-display mt-4 text-h2 text-balance text-slate">
                お客様から見えるサイトは、
                <br />
                大きく変えない。
              </p>
            </div>
            <div className="rounded-3xl border border-blue-ink/20 bg-gradient-to-b from-blue-pale to-white p-7 shadow-lift2 sm:p-10">
              <span className="num text-label text-blue-ink">OPERATION SIDE</span>
              <p className="h-display mt-4 text-h2 text-balance text-blue-deep">
                運営する裏側は、
                <br />
                大きく変える。
              </p>
            </div>
          </div>
        </Reveal>
      </div>

      {/* ── 3D：左＝今の管理画面 / 中央＝お客様 / 右＝AI GACHA OS ── */}
      <MigrationStory />

      {/* ── ドメインはそのまま（項目24） ── */}
      <div className="container-x relative z-10 pb-11 sm:pb-24 lg:pb-32">
        <Reveal>
          <DomainStrip />
        </Reveal>

        {/* ── 3つの進め方（項目30） ── */}
        <Reveal delay={0.06}>
          <div className="mt-4 grid gap-3.5 lg:grid-cols-3">
            {WAYS.map((w) => (
              <div
                key={w.code}
                className="rounded-3xl border border-edge bg-white p-7 shadow-lift"
              >
                <span className="num text-label text-blue-ink">{w.code}</span>
                <p className="h-display mt-3.5 text-h3 text-slate">{w.ja}</p>
                <p className="mt-3 text-note text-pretty leading-[1.95] text-slate2">
                  {w.d}
                </p>
                <p className="num mt-5 break-all rounded-xl border border-edge2 bg-paper2 px-4 py-3 text-note text-slate2">
                  {w.url}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* ── 本文（項目26）と、断定しないための注記 ── */}
        <Reveal delay={0.1}>
          <div className="mt-4 rounded-3xl border border-edge bg-white p-7 shadow-lift sm:p-10">
            <p className="text-body text-pretty leading-[1.95] text-slate">
              現在お使いのドメインを維持したまま、<span className="nb">AI GACHA OS</span>へ移行できる構成があります。
              {/* 機能名は途中で割らせない。1024/768/375px で「問い合／わせ」と切れていました */}
              お客様はこれまでと同じURLからアクセスし、運営側では、AIガチャ設計・実還元率・価格監視・発送管理・
              <span className="whitespace-nowrap">AI問い合わせ対応</span>
              などを使えるようにします。
            </p>
            <p className="mt-5 text-note text-pretty leading-[1.95] text-slate3">
              ※ 移行できる範囲は、既存システムの構成・契約・データ仕様によって異なります。
              まずは現在の環境を確認したうえで、可能な範囲と手順をお伝えします。
            </p>
            <div className="mt-7 flex flex-wrap gap-3.5">
              <Link href="#contact" className="btn-primary btn-lg">
                既存サイトの移行を相談する
              </Link>
              <Link href="#faq" className="btn-outline btn-lg">
                移行のよくある質問を見る
              </Link>
            </div>
          </div>
        </Reveal>

        {/* ── 詳細は畳んでおく ── */}
        <Reveal delay={0.14} className="mt-4">
          <MoreDetail label="確認する項目と、できるだけ残すものを見る">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="h-display text-h3 text-slate">
                  必要なのは、IPアドレスだけではありません。
                </p>
                <p className="mt-3 text-note leading-[1.95] text-slate2">
                  「サーバーのIPを教えてください」だけでは移行はできません。
                  実際には、次のものを一つずつ確認します。
                </p>
                <div className="mt-5 space-y-4">
                  {CHECKLIST.map((c) => (
                    <div key={c.g}>
                      <span className="text-note font-semibold text-slate">
                        {c.g}
                      </span>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {c.items.map((i) => (
                          <span
                            key={i}
                            className="whitespace-nowrap rounded-full border border-edge bg-white px-3.5 py-1.5 text-note text-slate2"
                          >
                            {i}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="h-display text-h3 text-slate">
                  今まで積み上げたものを、できるだけ残す。
                </p>
                <p className="mt-3 text-note leading-[1.95] text-slate2">
                  既存の運営で一番避けたいのは「全部作り直し」です。
                  次のものは引き継ぐ前提で設計します。
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {KEEP.map((k) => (
                    <span
                      key={k}
                      className="whitespace-nowrap rounded-full border border-ok-ink/25 bg-ok-ink/[0.08] px-3.5 py-1.5 text-note font-medium text-ok-ink"
                    >
                      {k}
                    </span>
                  ))}
                </div>
                <p className="mt-5 text-note leading-[1.95] text-slate3">
                  会員データ・ポイント残高・購入履歴を移す場合は、残高の整合性チェックを行い、
                  差異が出ないことを確認してから切り替えます。
                  ただし、すべてを必ず移せるとお約束することはできません。
                  既存システムの仕様によっては、移せる範囲が限られる場合があります。
                </p>
              </div>
            </div>
          </MoreDetail>
        </Reveal>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────
   BEFORE → MIGRATION → AFTER（項目24）
   ──────────────────────────────────────────── */

function DomainStrip() {
  return (
    <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift2">
      <div className="grid divide-y divide-edge2 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {/* お客様側 */}
        <div className="p-7 sm:p-10">
          <span className="num text-label text-slate3">お客様が見るURL</span>
          {/*
            ★横並びに戻さないこと。
              BEFORE / 矢印 / AFTER を横に3つ並べると、
              画面を2列に割る 1024px 付近で1枠が 147px まで痩せ、
              「example-gacha.jp」や製品名が2行に割れていました。
              縦に積めば、どの幅でも1行で読めます。
          */}
          <div className="mt-5 flex flex-col gap-3">
            <Cell tag="BEFORE" value="example-gacha.jp" />
            <Arrow label="MIGRATION" />
            <Cell tag="AFTER" value="example-gacha.jp" strong />
          </div>
          <p className="h-display mt-6 text-h3 text-slate">URLは、そのまま。</p>
        </div>

        {/* 運営側 */}
        <div className="bg-paper2/60 p-7 sm:p-10">
          <span className="num text-label text-slate3">運営が使う管理画面</span>
          {/*
            ★横並びに戻さないこと。
              BEFORE / 矢印 / AFTER を横に3つ並べると、
              画面を2列に割る 1024px 付近で1枠が 147px まで痩せ、
              「example-gacha.jp」や製品名が2行に割れていました。
              縦に積めば、どの幅でも1行で読めます。
          */}
          <div className="mt-5 flex flex-col gap-3">
            <Cell tag="BEFORE" value="OLD ADMIN" />
            <Arrow label="MIGRATION" />
            <Cell tag="AFTER" value={OS} strong />
          </div>
          <p className="h-display mt-6 text-h3 text-blue-deep">
            管理側だけ、進化する。
          </p>
        </div>
      </div>
    </div>
  );
}

function Cell({
  tag,
  value,
  strong = false,
}: {
  tag: string;
  value: string;
  strong?: boolean;
}) {
  /*
    ★タグと値を上下に積まないこと。
      上に BEFORE、下に値、という形だと、値が短いぶん
      カードの右側が丸ごと余ります（390px でカード292px・文字86px＝
      右に206px の空白）。同じ行に置けば幅を使い切れます。
  */
  return (
    <div
      className={`min-w-0 flex-1 rounded-2xl border px-5 py-4 ${
        strong
          ? "border-blue-ink/25 bg-blue-pale"
          : "border-edge2 bg-paper2/70"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`num shrink-0 text-label ${
            strong ? "text-blue-ink" : "text-slate3"
          }`}
        >
          {tag}
        </span>
        <p
          className={`num min-w-0 text-right text-note font-bold ${
            strong ? "text-blue-deep" : "text-slate2"
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    /*
      ★sm: で横向きに戻さないこと。
        上下の枠は全幅で縦に積むようになったので、
        矢印はどの画面幅でも「下向き」で意味が通ります。
    */
    <div className="flex shrink-0 items-center justify-center gap-2.5">
      <svg
        width="22"
        height="22"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
        className="rotate-90 text-blue-ink"
      >
        <path
          d="M3 8h10M9 4l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="num text-[11px] tracking-[0.16em] text-slate3">
        {label}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────
   3D本体
   ──────────────────────────────────────────── */

function MigrationStory() {
  const outer = useRef<HTMLDivElement | null>(null);
  const narrow = useIsNarrow(1024);
  const tier = useQuality();
  const show3D = tier === "high" || tier === "medium";
  const [beat, setBeat] = useState(0);

  const cur = MIGRATION_BEATS[beat] ?? MIGRATION_BEATS[0];

  /* ── 3Dが出せない端末：同じ話を、静かな一覧で ── */
  if (!show3D) {
    return (
      <div className="container-x relative z-10 mt-9 sm:mt-14">
        <ol className="space-y-3.5">
          {MIGRATION_BEATS.map((b, i) => (
            <li key={b.title} className="lp-card p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-3">
                <span className="num text-label text-slate3">
                  STEP {String(i + 1).padStart(2, "0")}
                </span>
                <span className="num whitespace-nowrap rounded-full border border-blue-ink/25 bg-blue-pale px-2.5 py-1 text-[11px] tracking-[0.14em] text-blue-ink">
                  {b.tag}
                </span>
              </div>
              <p className="h-display mt-3 text-h3 text-slate">{b.title}</p>
              <p className="mt-2.5 text-note text-pretty text-slate2">{b.body}</p>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div
      ref={outer}
      className="relative z-10 mt-9 sm:mt-14"
      // 画面を貼り付けたまま話を進めるので、外側は縦に長くしておく
      style={{ height: narrow ? "300vh" : "340vh" }}
    >
      <div className="sticky top-0 h-screen overflow-hidden">
        {/*
          pt … 固定ヘッダーの下に文字が潜らない値。これ以上詰めないこと。
          pb … スマホは画面下に固定のバーが重なるので、その高さぶんをあける。
               高さは MobileCTA が実測して --mobile-cta-h に入れている。
               ★170px のような決め打ちに戻さないこと。文言を変えるとずれる。
        */}
        <div className="pb-mobile-cta container-x flex h-full flex-col pt-16 sm:pt-20">
          <div className="relative min-h-0 flex-1">
            <MigrationWorld compact={narrow} trackRef={outer} onBeat={setBeat} />
          </div>

          {/* いま何が起きているか（読ませたい言葉はHTML側） */}
          <div className="relative mt-3 sm:mt-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="num text-label text-slate3">
                STEP {String(beat + 1).padStart(2, "0")} /{" "}
                {MIGRATION_BEATS.length}
              </span>
              <span className="num inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-blue-ink/25 bg-blue-pale px-3 py-1 text-[11px] tracking-[0.14em] text-blue-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-ink" />
                {cur.tag}
              </span>
            </div>
            <p
              key={cur.title}
              className="h-display mt-2.5 text-h3 text-balance text-slate"
            >
              {cur.title}
            </p>
            <p className="mt-2 max-w-[42em] text-note text-pretty text-slate2">
              {cur.body}
            </p>

            <div className="mt-4 flex gap-1.5">
              {MIGRATION_BEATS.map((b, i) => (
                <span
                  key={b.title}
                  className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
                    i <= beat ? "bg-blue-ink" : "bg-edge"
                  }`}
                />
              ))}
            </div>

            {/*
              3Dのスマートフォンの下に札を置くと、PCでもスマホでも画面の外へ
              はみ出します（手前のものは遠近で大きく映るため。実際に切れました）。
              この章でいちばん大事な「URLは変わらない」は、
              スマホ本体のアドレスバーと、この一行の2か所で見せています。
            */}
            <p className="num mt-3 text-[11px] tracking-[0.1em] text-slate3">
              お客様のURL：
              <span className="text-blue-ink">example-gacha.jp</span>
              <span className="tracking-normal">（最初から最後まで同じ）</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
