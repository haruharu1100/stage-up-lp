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
  return (
    <section
      id={id}
      className={`relative scroll-mt-24 py-24 sm:py-28 lg:py-36 ${className}`}
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
            <h2 className="h-display mt-6 text-h2 text-balance text-slate">
              {title}
            </h2>
            {lead ? (
              <p
                className={`mt-7 max-w-[36em] text-body text-pretty text-slate2 ${
                  align === "center" ? "mx-auto" : ""
                }`}
              >
                {lead}
              </p>
            ) : null}
          </div>
        </Reveal>
        <div className="mt-14 sm:mt-16 lg:mt-20">{children}</div>
      </div>
    </section>
  );
}
