"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { faqs } from "@/content/site";

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section
      id="faq"
      no="10"
      eyebrow="FAQ"
      title={<>よくいただく質問</>}
      lead="導入前に確認されることの多い項目をまとめました。ここに無いことは、そのままご相談ください。"
    >
      <div className="mx-auto max-w-3xl space-y-3.5">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={f.q} delay={i * 0.03}>
              <div
                className={`overflow-hidden rounded-3xl border shadow-lift transition-all duration-300 ${
                  isOpen
                    ? "border-blue-ink/20 bg-gradient-to-b from-blue-pale/60 to-white"
                    : "border-edge bg-white hover:border-blue-ink/20"
                }`}
              >
                <button
                  type="button"
                  id={`faq-q-${i}`}
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${i}`}
                  className="flex w-full items-start gap-4 px-6 py-6 text-left sm:px-8 sm:py-7"
                >
                  <span
                    className={`num mt-[7px] shrink-0 text-label ${
                      isOpen ? "text-blue-ink" : "text-slate3"
                    }`}
                  >
                    Q{String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-body font-semibold leading-[1.65] text-slate">
                    {f.q}
                  </span>
                  <span
                    className={`mt-[7px] shrink-0 transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M8 3v10M3 8h10"
                        stroke={isOpen ? "#1B4BD8" : "#63708A"}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-a-${i}`}
                      role="region"
                      aria-labelledby={`faq-q-${i}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {/*
                        質問と回答は必ず Q01 → A01 の形で並べる。
                        番号のない答えがぶら下がっているだけだと、
                        どこからが回答なのかが読み取りにくくなる。
                      */}
                      <div className="flex items-start gap-4 border-t border-edge2 px-6 pb-7 pt-6 sm:px-8">
                        <span className="num mt-[3px] shrink-0 text-label text-blue-ink">
                          A{String(i + 1).padStart(2, "0")}
                        </span>
                        <p className="min-w-0 flex-1 text-note text-pretty leading-[1.95] text-slate2">
                          {f.a}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
