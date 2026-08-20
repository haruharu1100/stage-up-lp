"use client";

import { useEffect, useState } from "react";

/**
 * 表示品質の段階。
 * 端末の力・画面の広さ・省電力設定を見て、出す絵の重さを自動で切り替える。
 *
 *  high   … PC。ガラスの屈折・影・粒子まで出す
 *  medium … スマホ／タブレット。3Dは出すが軽い材質にして粒子は減らす
 *  low    … 非力な端末・省データ。3Dは出さず、動きのある2Dで見せる
 *  static … 動きを減らす設定・WebGLなし。完全に静止した上質な絵にする
 *
 * サーバー側とページ表示直後は必ず "static"。
 * 画面が出てから1回だけ判定を上げるので、表示のガタつきが起きない。
 */
export type QualityTier = "high" | "medium" | "low" | "static";

export const TIER_LABEL: Record<QualityTier, string> = {
  high: "DESKTOP HIGH QUALITY",
  medium: "MOBILE MEDIUM",
  low: "LOW POWER",
  static: "STATIC PREMIUM",
};

type NavigatorLike = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

function hasWebGL(): boolean {
  try {
    const cv = document.createElement("canvas");
    return !!(cv.getContext("webgl2") || cv.getContext("webgl"));
  } catch {
    return false;
  }
}

/** 端末を1回だけ調べて段階を決める。 */
export function detectQuality(): QualityTier {
  if (typeof window === "undefined") return "static";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return "static";
  if (!hasWebGL()) return "static";

  const nav = navigator as NavigatorLike;

  // 省データモードの人に重い絵を送らない
  if (nav.connection?.saveData) return "low";
  const eff = nav.connection?.effectiveType;
  if (eff === "slow-2g" || eff === "2g") return "low";

  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  if (cores <= 3 || memory <= 2) return "low";

  const wide = window.matchMedia("(min-width: 1024px)").matches;
  const fine = window.matchMedia("(pointer: fine)").matches;

  if (wide && fine && cores >= 4) return "high";
  return "medium";
}

/**
 * 表示品質を返す。
 * 動きを減らす設定は後から変えられるので、変更も拾い直す。
 */
export function useQuality(): QualityTier {
  const [tier, setTier] = useState<QualityTier>("static");

  useEffect(() => {
    const apply = () => setTier(detectQuality());
    apply();

    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqWide = window.matchMedia("(min-width: 1024px)");
    mqReduce.addEventListener("change", apply);
    mqWide.addEventListener("change", apply);
    return () => {
      mqReduce.removeEventListener("change", apply);
      mqWide.removeEventListener("change", apply);
    };
  }, []);

  return tier;
}

/** 3Dを描いてよいか（high / medium のときだけ） */
export function use3D(): boolean {
  const tier = useQuality();
  return tier === "high" || tier === "medium";
}

/** アニメーションを動かしてよいか（static 以外） */
export function useMotion(): boolean {
  return useQuality() !== "static";
}

/** 画面が狭いかどうか。スマホ専用の並びに切り替えるために使う。 */
export function useIsNarrow(breakpoint = 1024): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [breakpoint]);
  return narrow;
}
