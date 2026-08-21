"use client";

/**
 * このサイトの代表シーン。「承認したら、こうなる」。
 *
 * 画面を貼り付けたまま、スクロールを"時間"として使います。
 * 下へ送ると、
 *   結果を見る → 承認する → 公開処理 → お客様の画面に出る → 引く → 当たる
 * まで、ひと続きに進みます。
 *
 * ★3Dの中の文字は小さくなるので、読ませたい言葉はこちら（HTML側）に置いています。
 * ★3Dが出せない端末では、静止した絵と、同じ言葉の一覧だけになります。
 */

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { useIsNarrow, useQuality } from "@/lib/quality";
import { BEATS } from "../three/PublishWorld";
import StaticCore from "../hero/StaticCore";

const PublishWorld = dynamic(() => import("../three/PublishWorld"), {
  ssr: false,
  loading: () => <StaticCore />,
});

/** だれの仕事かの色。HUMAN 白 / AI 青 / CUSTOMER 緑 */
const WHO = {
  HUMAN: {
    label: "あなた",
    chip: "border-slate/25 bg-white text-slate",
    dot: "bg-slate",
  },
  AI: {
    label: "システム・AI",
    chip: "border-blue-ink/25 bg-blue-pale text-blue-ink",
    dot: "bg-blue-ink",
  },
  CUSTOMER: {
    label: "お客様",
    chip: "border-ok-ink/25 bg-ok-ink/10 text-ok-ink",
    dot: "bg-ok-ink",
  },
} as const;

export default function PublishStory() {
  const outer = useRef<HTMLElement | null>(null);
  const narrow = useIsNarrow(1024);
  const tier = useQuality();
  const show3D = tier === "high" || tier === "medium";
  const [beat, setBeat] = useState(0);

  const cur = BEATS[beat] ?? BEATS[0];
  const who = WHO[cur.who];

  /* ── 3Dが出せない端末：同じ話を、静かな一覧で ── */
  if (!show3D) {
    return (
      <section id="publish" className="relative scroll-mt-24 py-11 sm:py-24">
        <div className="container-x">
          <Head />
          <ol className="mt-9 space-y-3.5 sm:mt-14">
            {BEATS.map((b, i) => {
              const w = WHO[b.who];
              return (
                <li key={b.title} className="lp-card p-5 sm:p-7">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="num text-label text-slate3">
                      STEP {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium ${w.chip}`}
                    >
                      {w.label}
                    </span>
                  </div>
                  <p className="h-display mt-3 text-h3 text-slate">{b.title}</p>
                  <p className="mt-2.5 text-note text-pretty text-slate2">
                    {b.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    );
  }

  /* ── 3D版 ── */
  return (
    <section
      id="publish"
      ref={outer}
      className="relative scroll-mt-24"
      // 画面を貼り付けたまま話を進めるので、外側は縦に長くしておく
      style={{ height: narrow ? "300vh" : "360vh" }}
    >
      <div className="sticky top-0 h-screen overflow-hidden">
        {/*
          pt … 固定ヘッダーの下に見出しが潜らない値。これ以上詰めないこと。
          pb … スマホは画面下に固定の「相談する」バー（実測157px）が重なるので、
                その高さぶんを必ずあけておく。詰めると説明文と進み具合が
                バーの下に隠れて読めなくなる。
        */}
        <div className="container-x flex h-full flex-col pb-[170px] pt-16 sm:pb-6 sm:pt-20">
          <Head />

          {/* ── 3D本体 ── */}
          <div className="relative mt-4 min-h-0 flex-1 sm:mt-6">
            <PublishWorld
              compact={narrow}
              trackRef={outer}
              onBeat={setBeat}
            />
          </div>

          {/* ── いま何が起きているか（読ませたい言葉はこちら） ── */}
          <div className="relative mt-3 sm:mt-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="num text-label text-slate3">
                STEP {String(beat + 1).padStart(2, "0")} / {BEATS.length}
              </span>
              <span
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-medium ${who.chip}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${who.dot}`} />
                {who.label}
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

            {/* 進み具合 */}
            <div className="mt-4 flex gap-1.5">
              {BEATS.map((b, i) => (
                <span
                  key={b.title}
                  className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
                    i <= beat ? "bg-blue-ink" : "bg-edge"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Head() {
  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span className="num whitespace-nowrap text-label text-slate3">
          SECTION 05
        </span>
        <span className="hidden h-px w-8 bg-edge sm:block" />
        <span className="eyebrow-lite">APPROVE &amp; PUBLISH</span>
      </div>
      <h2 className="h-display mt-3 text-h2 text-balance text-slate sm:mt-5">
        あなたが承認したら、
        <br className="hidden sm:block" />
        お客様の画面に出ます。
      </h2>
    </div>
  );
}
