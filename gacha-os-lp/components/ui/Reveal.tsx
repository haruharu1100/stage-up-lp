"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
};

export default function Reveal({
  children,
  delay = 0,
  y = 26,
  className,
  once = true,
}: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      /*
        ★initial はサーバーとクライアントで必ず同じ値にすること。
          「動きを減らす」設定の端末だけ initial を変えると、
          最初の表示がサーバーの結果と食い違って hydration エラーになる。
          動きを止めたいときは、初期値ではなく所要時間を0にする。
      */
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-12% 0px -8% 0px" }}
      transition={
        reduce
          ? { duration: 0 }
          : { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }
      }
    >
      {children}
    </motion.div>
  );
}
