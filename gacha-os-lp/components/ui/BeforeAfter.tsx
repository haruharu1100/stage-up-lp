import Reveal from "./Reveal";
import { beforeAfter } from "@/content/site";

type Props = {
  /** content/site.ts の beforeAfter のキー */
  id: keyof typeof beforeAfter;
  className?: string;
  delay?: number;
};

/**
 * 「機能がある」ではなく「何が楽になるか」を見せるブロック。
 * 各主要機能セクションの直前に置く。
 *
 * 左（今まで）は沈んだ紙、右（これから）は白く浮いた面。
 * 色ではなく明るさの差で「軽くなった」を伝える。
 */
export default function BeforeAfter({ id, className = "", delay = 0 }: Props) {
  const x = beforeAfter[id];
  if (!x) return null;

  return (
    <Reveal delay={delay} className={className}>
      <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
        <div className="grid md:grid-cols-[1fr_auto_1fr]">
          {/* BEFORE */}
          <div className="bg-paper2 p-7 sm:p-9">
            <span className="num inline-flex items-center gap-2.5 text-label text-slate3">
              <span className="h-1.5 w-1.5 rounded-full bg-slate3/50" />
              BEFORE
            </span>
            <p className="mt-5 text-note leading-[1.95] text-slate2">
              {x.before}
            </p>
          </div>

          {/* 矢印 */}
          <div className="flex items-center justify-center border-y border-edge2 py-4 md:border-x md:border-y-0 md:px-6 md:py-0">
            <span className="text-blue-ink md:hidden" aria-hidden>
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
            <span className="hidden text-blue-ink md:block" aria-hidden>
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

          {/* AFTER */}
          <div className="bg-white p-7 sm:p-9">
            <span className="num inline-flex items-center gap-2.5 text-label text-blue-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-ink" />
              AFTER
            </span>
            <p className="mt-5 text-note leading-[1.95] text-slate">{x.after}</p>
          </div>
        </div>

        <div className="border-t border-edge2 bg-blue-pale/60 px-7 py-5 sm:px-9">
          <p className="flex items-start gap-3 text-note leading-[1.8] text-ok-ink">
            <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-ok-ink" />
            {x.gain}
          </p>
        </div>
      </div>
    </Reveal>
  );
}
