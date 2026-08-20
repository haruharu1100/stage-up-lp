"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import { engines } from "@/content/site";

const spread = [
  { x: -230, y: -104 },
  { x: 230, y: -104 },
  { x: -280, y: 30 },
  { x: 280, y: 30 },
  { x: 0, y: 140 },
];

const chipClass =
  "num whitespace-nowrap rounded-full border border-edge bg-white px-4 py-2 text-label text-slate2 shadow-lift";

function Core() {
  return (
    <div className="relative flex h-[168px] w-[168px] items-center justify-center rounded-full border border-blue-ink/20 bg-gradient-to-b from-blue-pale to-white shadow-lift2 sm:h-[200px] sm:w-[200px]">
      <span className="absolute inset-[14px] rounded-full border border-edge2" />
      <span className="num relative text-center text-label font-bold leading-[1.9] text-blue-ink">
        AI GACHA
        <br />
        OS
      </span>
    </div>
  );
}

function EngineChip({
  code,
  merge,
  offset,
  still,
  scale,
}: {
  code: string;
  merge: MotionValue<number>;
  offset: { x: number; y: number };
  still: boolean;
  scale: number;
}) {
  const x = useTransform(merge, (v) => `${offset.x * v * scale}px`);
  const y = useTransform(merge, (v) => `${offset.y * v * scale}px`);
  const opacity = useTransform(merge, [0, 0.3, 1], [0, 1, 1]);

  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <motion.div style={still ? { x: 0, y: 0, opacity: 1 } : { x, y, opacity }}>
        <span className={chipClass}>{code}</span>
      </motion.div>
    </div>
  );
}

export default function Converge() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  const [scale, setScale] = useState(1);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const fit = () => {
      const w = window.innerWidth;
      setCompact(w < 640);
      setScale(Math.min(1, Math.max(0.62, (w - 200) / 720)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const merge = useTransform(scrollYProgress, [0.15, 0.62], [1, 0]);
  const coreScale = useTransform(scrollYProgress, [0.3, 0.72], [0.72, 1]);
  const coreOpacity = useTransform(scrollYProgress, [0.34, 0.68], [0, 1]);
  const lineOpacity = useTransform(scrollYProgress, [0.5, 0.78], [0, 1]);

  const still = reduce || compact;

  return (
    <section
      ref={ref}
      className="relative overflow-hidden bg-paper2 py-28 sm:py-40"
    >
      <div className="pointer-events-none absolute inset-0 grid-lite opacity-45 [mask-image:radial-gradient(ellipse_at_50%_50%,#000_10%,transparent_72%)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-pale/70 blur-[120px]" />

      <div className="container-x relative">
        {compact ? (
          <div className="flex flex-col items-center">
            <Core />
            <div className="mt-9 flex flex-wrap justify-center gap-2">
              {engines.map((e) => (
                <span key={e.key} className={chipClass}>
                  {e.code}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="relative mx-auto h-[300px] max-w-3xl sm:h-[360px]">
            {engines.map((e, i) => (
              <EngineChip
                key={e.key}
                code={e.code}
                merge={merge}
                offset={spread[i]}
                still={still}
                scale={scale}
              />
            ))}

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <motion.div
                style={
                  still
                    ? { scale: 1, opacity: 1 }
                    : { scale: coreScale, opacity: coreOpacity }
                }
              >
                <Core />
              </motion.div>
            </div>
          </div>
        )}

        <motion.div
          className="mx-auto mt-14 max-w-2xl text-center"
          style={{ opacity: still ? 1 : lineOpacity }}
        >
          <p className="text-note text-pretty text-slate2">
            5つのエンジンは、別々の機能ではありません。
            <br className="hidden sm:block" />
            ひとつの運営システムとして、同じ数字を見ながら動きます。
          </p>
          <h2 className="h-display mt-8 text-h2 text-balance text-slate">
            5つで、ひとつ。
            <br />
            <span className="text-gradient-royal">1画面で、運営が回ります。</span>
          </h2>
        </motion.div>
      </div>
    </section>
  );
}
