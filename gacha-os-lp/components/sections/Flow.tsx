import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { flow } from "@/content/site";

export default function Flow() {
  return (
    <Section
      id="flow"
      no="21"
      eyebrow="ONBOARDING"
      title={
        <>
          相談から公開まで、
          <br />
          おおむね1〜3か月。
        </>
      }
      lead="いきなり作り始めません。いまの運営体制と、どこに時間が溶けているかを整理してから、必要な機能範囲とインフラ構成を確定します。"
    >
      <div className="relative">
        <div className="absolute left-0 right-0 top-[62px] hidden h-px bg-edge lg:block" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {flow.map((f, i) => (
            <Reveal key={f.step} delay={i * 0.07} className="h-full">
              <div className="lp-card relative h-full p-7 transition-all duration-300 hover:shadow-lift2 sm:p-8">
                <div className="flex items-center justify-between gap-4">
                  <span className="num text-h3 font-semibold text-blue-ink">
                    {f.step}
                  </span>
                  <span className="num rounded-full border border-edge bg-paper2 px-3.5 py-1.5 text-label text-slate3">
                    {f.term}
                  </span>
                </div>
                <h3 className="mt-6 text-body font-bold text-slate">{f.title}</h3>
                <p className="mt-4 text-note text-slate2">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>

      <Reveal delay={0.14}>
        <div className="lp-tint mt-5 rounded-3xl px-7 py-8 sm:px-10 sm:py-9">
          <span className="num text-label text-slate3">
            WHAT YOU PREPARE
          </span>
          <div className="mt-8 grid gap-7 sm:grid-cols-3">
            {[
              { t: "商品の仕入れ", d: "景品そのものと、その仕入れ判断。ここだけは人の仕事として残ります。" },
              { t: "サイトの方向性", d: "扱うジャンル、ブランドの雰囲気、既存サイトがあればその情報。" },
              { t: "各種アカウント", d: "決済事業者・ドメイン・AWS。取得からご一緒することもできます。" },
            ].map((x) => (
              <div key={x.t}>
                <p className="text-note font-bold text-slate">{x.t}</p>
                <p className="mt-2.5 text-note text-slate2">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
