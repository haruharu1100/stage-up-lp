import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";
import { timeModel as raw_timeModel, timeModelNote as raw_timeModelNote } from "@/content/site";
/* ★画面に出す文字は jpDeep() を通す。日本語が語の途中で割れるのを止める */
import { jpDeep } from "@/lib/jp";

const timeModel = jpDeep(raw_timeModel);
const timeModelNote = jpDeep(raw_timeModelNote);

const beforeTotal = timeModel.reduce((a, r) => a + r.before, 0);
const afterTotal = timeModel.reduce((a, r) => a + r.after, 0);

/** 1時間あたりのバー幅（%）。最大は従来側の最長タスクに合わせる */
const maxRow = Math.max(...timeModel.map((r) => r.before));

const hrs = (n: number) =>
  n >= 1 ? `${Number(n.toFixed(1))}h` : `${Math.round(n * 60)}分`;

/**
 * 「1日の作業時間がどう変わるか」を見せるブロック。
 *
 * 以前は独立したセクション（SECTION 17 / TIME SAVED）でした。
 * ただ、すぐ次の ROI シミュレーターも「いくら浮くのか」を答える場所で、
 * 見出し・導入文・上下の余白を2回ぶん使って同じ話をしていました。
 * いまは ROI セクションの冒頭に置いて、
 * 「時間がこう変わる → その時間はいくらか」を1つの流れにしています。
 */
export default function TimeSaving() {
  return (
    <div id="time" className="scroll-mt-24">
      <div className="mb-6 sm:mb-8">
        <span className="eyebrow-lite">TIME SAVED</span>
        <h3 className="h-display mt-3 text-h2 text-balance text-slate sm:mt-4">
          ガチャ運営に使っていた時間を、仕入れと企画へ。
        </h3>
        <p className="mt-4 max-w-[36em] text-body text-pretty text-slate2 sm:mt-5">
          {/* 製品名の中の空白は必ず &nbsp;。半角スペースだとそこで行が折れます */}
          AI&nbsp;GACHA&nbsp;OS
          が消すのは「作業」であって、「判断」ではありません。数字を集める・計算する・転記する・同じ返信を書く。この4つがなくなると、1日の中身はここまで変わります。
        </p>
      </div>

      {/* 合計の対比 */}
      <Reveal>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch sm:gap-4">
          <div className="rounded-3xl border border-edge bg-paper2 p-6 sm:p-9">
            <span className="num inline-flex items-center gap-2.5 text-label text-slate3">
              <span className="h-1.5 w-1.5 rounded-full bg-slate3/50" />
              従来の運営
            </span>
            <p className="num mt-4 text-h1 font-semibold leading-none text-slate3">
              {beforeTotal}
              <span className="ml-2 text-note font-normal text-slate3">
                時間 / 日
              </span>
            </p>
            <p className="mt-4 text-note text-slate3">
              人が手を動かさないと、何も進まない状態。
            </p>
          </div>

          <div className="flex items-center justify-center sm:px-3 sm:py-0">
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

          <div className="rounded-3xl border border-blue-ink/20 bg-white p-6 shadow-lift2 sm:p-9">
            <span className="num inline-flex items-center gap-2.5 text-label text-blue-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-ink" />
              AI&nbsp;GACHA&nbsp;OS
            </span>
            <p className="num mt-4 text-h1 font-semibold leading-none text-slate">
              1〜2
              <span className="ml-2 text-note font-normal text-slate3">
                時間 / 日
              </span>
            </p>
            <p className="mt-4 text-note text-slate2">
              残るのは「確認」と「承認」。数字はすでに出ている状態から始まります。
            </p>
          </div>
        </div>
      </Reveal>

      {/* 内訳。読みたい人にだけ開いてもらう（合計は上の対比で見えている） */}
      <Reveal delay={0.06} className="mt-4">
        <MoreDetail
          label={`作業ごとの内訳を見る（${timeModel.length}項目・モデルケース）`}
        >
          <div className="divide-y divide-edge2">
            {timeModel.map((r) => (
              <div key={r.task} className="py-5 first:pt-0 last:pb-0">
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
                <div className="mt-3 space-y-2">
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

                <p className="mt-3 text-note text-slate3">導入後：{r.note}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2 border-t border-edge pt-5">
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
        </MoreDetail>
      </Reveal>

      <Reveal delay={0.1} className="mt-4">
        <p className="rounded-2xl border border-edge bg-paper2 px-5 py-5 text-note text-slate2 sm:px-6">
          <span className="mr-3 inline-block rounded-full border border-edge bg-white px-3.5 py-1 text-note leading-normal text-slate3">
            運営例
          </span>
          {timeModelNote}
        </p>
      </Reveal>
    </div>
  );
}
