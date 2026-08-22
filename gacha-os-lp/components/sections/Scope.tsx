import Link from "next/link";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { scopeOptions as raw_scopeOptions } from "@/content/site";
/*
  ★このデータは「ただの日本語」で持つこと。
    折り返しを止めるための見えない文字（U+2060 など）を混ぜないこと。
    画面に出すときに lib/jp.tsx の jp() を通せば、
    守るべき言葉だけが <span class="nb"> で包まれます。
*/

const scopeOptions = raw_scopeOptions;
import { OS } from "@/lib/text";

export default function Scope() {
  return (
    <Section
      id="scope"
      no=""
      eyebrow="HOW TO START"
      title={
        <>
          今のガチャ運営を、
          <br />
          全部捨てる必要はありません。
        </>
      }
      /*
        ★製品名は必ず OS（lib/text.ts）を使うこと。
          "AI GACHA OS" と半角スペースで直接書くと、
          狭い画面で「AI GACHA／OS」と2行に割れます。
      */
      lead={`乗り換えは、いちばん重い決断です。${OS} は「まるごと入れ替える」以外の入り方も用意しています。いま困っている部分だけを、先に軽くしてください。`}
    >
      <Reveal>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {scopeOptions.map((o, i) => (
            <div
              key={o.title}
              className="lp-card h-full p-6 transition-all duration-300 hover:shadow-lift2 sm:p-8"
            >
              <span className="num text-label text-slate3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-5 text-body font-bold text-slate">{o.title}</h3>
              <p className="mt-4 text-note text-slate2">{o.body}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.08} className="mt-5">
        <div className="lp-tint flex flex-col gap-6 rounded-3xl px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-9">
          <div>
            <p className="text-body font-bold text-slate">
              どこから入れるべきかは、規模と体制で変わります。
            </p>
            <p className="mt-3.5 max-w-[38em] text-note text-pretty text-slate2">
              現状をうかがったうえで、いちばん効果が出る範囲からご提案します。全部入れる前提の見積りはお出ししません。
            </p>
          </div>
          <Link href="#contact" className="btn-primary shrink-0">
            相談する
          </Link>
        </div>
      </Reveal>
    </Section>
  );
}
