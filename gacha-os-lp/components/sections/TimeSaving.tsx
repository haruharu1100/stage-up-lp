import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { timeModel, timeModelNote } from "@/content/site";

const beforeTotal = timeModel.reduce((a, r) => a + r.before, 0);
const afterTotal = timeModel.reduce((a, r) => a + r.after, 0);

/** 1時間あたりのバー幅（%）。最大は従来側の最長タスクに合わせる */
const maxRow = Math.max(...timeModel.map((r) => r.before));

const hrs = (n: number) =>
  n >= 1 ? `${Number(n.toFixed(1))}h` : `${Math.round(n * 60)}分`;

export default function TimeSaving() {
  return (
    <Section
      id="time"
      no="17"
      eyebrow="TIME SAVED"
      title={
        <>
          ガチャ運営に使っていた時間を、
          <br />
          仕入れと企画へ。
        </>
      }
      lead="AI GACHA OS が消すのは「作業」であって、「判断」ではありません。数字を集める・計算する・転記する・同じ返信を書く。この4つがなくなると、1日の中身はここまで変わります。"
    >
      {/* 合計の対比 */}
      <Reveal>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
          <div className="rounded-3xl border border-edge bg-paper2 p-7 sm:p-9">
            <span className="num inline-flex items-center gap-2.5 text-label text-slate3">
              <span className="h-1.5 w-1.5 rounded-full bg-slate3/50" />
              従来の運営
            </span>
            <p className="num mt-6 text-h1 font-semibold leading-none text-slate3">
              {beforeTotal}
              <span className="ml-2 text-note font-normal text-slate3">
                時間 / 日
              </span>
            </p>
            <p className="mt-6 text-note text-slate3">
              計算・確認・転記・返信。人が手を動かさないと、何も進まない状態。
            </p>
          </div>

          <div className="flex items-center justify-center py-1 sm:px-3 sm:py-0">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-white text-blue-ink shadow-lift sm:hidden"
              aria-hidden
            >
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 3v10M4 9l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span
              className="hidden h-11 w-11 items-center justify-center rounded-full border border-edge bg-white text-blue-ink shadow-lift sm:flex"
              aria-hidden
            >
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>

          <div className="rounded-3xl border border-blue-ink/20 bg-white p-7 shadow-lift2 sm:p-9">
            <span className="num inline-flex items-center gap-2.5 text-label text-blue-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-ink" />
              AI GACHA OS
            </span>
            <p className="num mt-6 text-h1 font-semibold leading-none text-slate">
              1〜2
              <span className="ml-2 text-note font-normal text-slate3">
                時間 / 日
              </span>
            </p>
            <p className="mt-6 text-note text-slate2">
              残るのは「確認」と「承認」。数字はすでに出ている状態から始まります。
            </p>
          </div>
        </div>
      </Reveal>

      {/* 内訳 */}
      <Reveal delay={0.06} className="mt-4">
        <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-edge2 px-6 py-5 sm:px-8">
            <span className="num text-label text-slate3">DAILY BREAKDOWN</span>
            <span className="num text-note text-slate3">モデルケース</span>
          </div>

          <div className="divide-y divide-edge2">
            {timeModel.map((r) => (
              <div key={r.task} className="px-6 py-6 sm:px-8">
                <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
                  <p className="text-note font-semibold text-slate">{r.task}</p>
                  <p className="num shrink-0 text-note">
                    <span className="text-slate3 line-through">
                      {hrs(r.before)}
                    </span>
                    <span className="mx-2.5 text-slate3/50">→</span>
                    <span className="font-bold text-blue-ink">
                      {hrs(r.after)}
                    </span>
                  </p>
                </div>

                {/* バー */}
                <div className="mt-4 space-y-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-mist">
                    <div
                      className="h-full rounded-full bg-slate3/35"
                      style={{ width: `${(r.before / maxRow) * 100}%` }}
                    />
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-mist">
                    <div
                      className="h-full rounded-full bg-blue-ink"
                      style={{
                        width: `${Math.max(1.5, (r.after / maxRow) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <p className="mt-3.5 text-note text-slate3">
                  導入後：{r.note}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2 border-t border-edge bg-paper2 px-6 py-6 sm:px-8">
            <span className="text-note text-slate2">合計</span>
            <span className="num flex flex-wrap items-baseline gap-x-2.5">
              <span className="text-note text-slate3 line-through">
                {beforeTotal}時間
              </span>
              <span className="text-note text-slate3/50">→</span>
              <span className="text-h3 font-semibold text-blue-ink">
                約 {Number(afterTotal.toFixed(1))}時間
              </span>
            </span>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.1} className="mt-4">
        <p className="rounded-2xl border border-edge bg-paper2 px-6 py-6 text-note text-slate2">
          <span className="mr-3 inline-block rounded-full border border-edge bg-white px-3.5 py-1 text-note leading-normal text-slate3">
            運営例
          </span>
          {timeModelNote}
        </p>
      </Reveal>
    </Section>
  );
}
