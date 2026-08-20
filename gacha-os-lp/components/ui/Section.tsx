import type { ReactNode } from "react";
import Reveal from "./Reveal";

type Props = {
  id: string;
  no: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  className?: string;
  align?: "left" | "center";
};

export default function Section({
  id,
  no,
  eyebrow,
  title,
  lead,
  children,
  className = "",
  align = "left",
}: Props) {
  /*
    スマホの上下余白は py-11（上下44pxずつ）。
    ここを1段大きくすると、セクションの数だけページ全体が伸びます。
    PCは画面が広いので、これまでどおりゆったり取っています。
  */
  return (
    <section
      id={id}
      className={`relative scroll-mt-24 py-11 sm:py-24 lg:py-36 ${className}`}
    >
      <div className="container-x">
        <Reveal>
          <div
            className={
              align === "center"
                ? "mx-auto max-w-4xl text-center"
                : "max-w-4xl"
            }
          >
            <div
              className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 ${
                align === "center" ? "justify-center" : ""
              }`}
            >
              <span className="num whitespace-nowrap text-label text-slate3">
                SECTION {no}
              </span>
              <span className="hidden h-px w-8 bg-edge sm:block" />
              <span className="eyebrow-lite">{eyebrow}</span>
            </div>
            <h2 className="h-display mt-4 text-h2 text-balance text-slate sm:mt-6">
              {title}
            </h2>
            {lead ? (
              <p
                className={`mt-5 max-w-[36em] text-body text-pretty text-slate2 sm:mt-7 ${
                  align === "center" ? "mx-auto" : ""
                }`}
              >
                {lead}
              </p>
            ) : null}
          </div>
        </Reveal>
        <div className="mt-7 sm:mt-14 lg:mt-20">{children}</div>
      </div>
    </section>
  );
}
