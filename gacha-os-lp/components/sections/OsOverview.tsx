import type { ReactNode } from "react";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { engines } from "@/content/site";

/**
 * エンジンごとの目印。意味は変えず、丸タイルの中に置く記号だけを持たせる。
 * （文字ではなく図形なので、読み上げからは外す）
 */
const icons: Record<string, ReactNode> = {
  ai: (
    <path
      d="M12 3.5l2.1 4.4 4.4 2.1-4.4 2.1L12 16.5l-2.1-4.4L5.5 10l4.4-2.1L12 3.5zM18.5 16l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9.9-1.9z"
      fill="currentColor"
    />
  ),
  rtp: (
    <path
      d="M4 15.5a8 8 0 0116 0M12 15.5l4-4"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  price: (
    <path
      d="M4 17l4.5-5 3.5 3 7-8M19 7h-3.5M19 7v3.5"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  ship: (
    <path
      d="M3.5 8.5L12 4.5l8.5 4v7L12 19.5l-8.5-4v-7zM3.5 8.5L12 12.5l8.5-4M12 12.5v7"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  support: (
    <path
      d="M20 12.5c0 3.6-3.6 6.5-8 6.5-.9 0-1.8-.1-2.6-.35L5 20l1.1-3.1C4.8 15.75 4 14.2 4 12.5 4 8.9 7.6 6 12 6s8 2.9 8 6.5z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

export default function OsOverview() {
  return (
    <Section
      id="os"
      no="05"
      eyebrow="AI GACHA OPERATING SYSTEM"
      title={
        <>
          5つのエンジンが、
          <br />
          1つのOSとしてつながる。
        </>
      }
      lead="ガチャを作る。還元率を見張る。相場を取り込む。発送を流す。問い合わせに答える。バラバラに存在していた作業を、ひとつの管理画面の上でつなぎます。"
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {engines.map((e, i) => (
          <Reveal key={e.key} delay={i * 0.07} className="h-full">
            <div className="lp-card flex h-full flex-col p-7 transition-all duration-500 hover:-translate-y-1 hover:shadow-lift2">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-pale text-blue-ink">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  {icons[e.key]}
                </svg>
              </span>
              <span className="num mt-6 block text-label text-slate3">
                {e.code}
              </span>
              <h3 className="mt-4 text-body font-bold text-slate">{e.title}</h3>
              <p className="mt-4 flex-1 text-note text-slate2">{e.lead}</p>
              <ul className="mt-6 space-y-3 border-t border-edge2 pt-6">
                {e.points.map((p) => (
                  <li key={p} className="flex gap-3 text-note text-slate2">
                    <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-ink/60" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
