import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { problems as raw_problems } from "@/content/site";
/* ★画面に出す文字は jpDeep() を通す。日本語が語の途中で割れるのを止める */
import { jpDeep } from "@/lib/jp";

const problems = jpDeep(raw_problems);

export default function Problems() {
  return (
    <Section
      id="problems"
      no=""
      eyebrow="THE PROBLEM"
      title={
        <>
          売れているのに、
          <br />
          <span className="text-slate3">利益が残らない理由。</span>
        </>
      }
      lead="オンラインガチャの運営は、公開した後に増える作業でできています。数字を見に行った人だけが判断でき、見に行かない日はそのまま流れていく。ここが、いちばん静かにお金が消える場所です。"
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {problems.map((p, i) => (
          <Reveal key={p.no} delay={i * 0.06} className="h-full">
            <div className="group h-full rounded-3xl border border-edge2 bg-paper2 p-6 transition-colors duration-500 hover:border-edge sm:p-8">
              <div className="flex items-center gap-4">
                <span className="num text-label text-slate3">{p.no}</span>
                <span className="h-px flex-1 bg-edge2" />
                <span className="rounded-full border border-danger-ink/20 bg-white px-3.5 py-1.5 text-note leading-normal text-danger-ink">
                  {p.cost}
                </span>
              </div>
              <h3 className="mt-5 text-body font-bold leading-snug text-slate">
                {p.title}
              </h3>
              <p className="mt-4 text-note text-slate2">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1}>
        <div className="lp-tint mt-5 rounded-3xl px-6 py-7 sm:px-10 sm:py-9">
          <p className="text-body text-pretty text-slate2">
            <span className="font-bold text-blue-ink">仕入れは、人にしかできません。</span>
            <br className="hidden sm:block" />
            {/* 製品名の中の空白は &nbsp;。ふつうの空白だと「AI GACHA／OS」と割れます */}
            それ以外の「計算・監視・転記・返信」を、システムとAIに寄せる。これが
            AI&nbsp;GACHA&nbsp;OS の考え方です。
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
