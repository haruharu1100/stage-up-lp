import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { builtFromOps, metrics } from "@/content/site";

export default function BuiltFromOps() {
  /* 実績は「確認できる数字」だけを表示する。null のものは出さない */
  const shown = metrics.filter(
    (m): m is typeof m & { value: number } => m.value !== null
  );

  return (
    <Section
      id="ops"
      no="19"
      eyebrow="BUILT FROM OPERATIONS"
      title={
        <>
          机上で作った
          <br />
          システムではありません。
        </>
      }
      lead={builtFromOps.lead}
    >
      <Reveal>
        <div className="grid gap-5 md:grid-cols-2">
          {builtFromOps.facts.map((f, i) => (
            <div
              key={f.t}
              className="relative overflow-hidden rounded-3xl border border-edge bg-white p-8 shadow-lift sm:p-10"
            >
              <div className="flex items-center gap-4">
                <span className="num text-label text-slate3">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="h-px w-8 bg-edge" />
              </div>
              <h3 className="h-display mt-7 text-h3 text-slate">{f.t}</h3>
              <p className="mt-6 text-body text-slate2">{f.b}</p>
            </div>
          ))}
        </div>
      </Reveal>

      {/* 実績数値：確認できるものが1つでもあるときだけ出す */}
      {shown.length > 0 && (
        <Reveal delay={0.08} className="mt-5">
          <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
            <div className="border-b border-edge2 px-6 py-5 sm:px-8">
              <span className="num text-label text-slate3">
                OPERATION RECORD
              </span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-edge2 sm:grid-cols-3">
              {shown.map((m) => (
                <div key={m.key} className="px-6 py-8 sm:px-8">
                  <p className="text-note leading-tight text-slate3">
                    {m.label}
                  </p>
                  <p className="num mt-4 text-h1 font-semibold leading-none text-slate">
                    {m.value.toLocaleString("ja-JP")}
                    <span className="ml-2 text-note font-normal text-slate3">
                      {m.unit}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      )}

      <Reveal delay={0.12} className="mt-5">
        <p className="rounded-2xl border border-edge bg-paper2 px-6 py-6 text-note text-slate2">
          運営実績の数値は、集計体制が整い、確認できるようになったものから順に掲載します。現時点では、確認できていない数値は掲載していません。
        </p>
      </Reveal>
    </Section>
  );
}
