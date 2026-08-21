"use client";

/**
 * 3Dを置くための共通の器。
 *
 * ここが性能の要です。3Dは「重いから使わない」ではなく、
 * 「見えているときだけ、その端末に合う重さで動かす」ようにしています。
 *
 *   PC（高性能）   … Full 3D      … ガラスの映り込み・キーの刻み・粒を全部出す
 *   PC（低性能）   … Reduced 3D   … 材質を軽くし、解像度を落とす
 *   スマホ         … Lite 3D      … 部品を減らした軽い3D
 *   動きを減らす設定 … Static Premium … 3Dを出さず、静止した上質な絵にする
 *
 * さらに、画面の外に出たら描画そのものを止めます（スクロール中に電池を使わない）。
 */

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MutableRefObject,
} from "react";
import { Canvas } from "@react-three/fiber";
import { useQuality } from "@/lib/quality";
import type { Tier } from "./parts";

export type StageRender = (args: {
  tier: Tier;
  /** そのセクションのスクロール進み具合 0→1（画面に入る前=0、抜けた後=1） */
  progress: MutableRefObject<number>;
}) => ReactNode;

type Props = {
  className?: string;
  /** 3Dを出せないときに代わりに出すもの（静止した上質な絵） */
  fallback: ReactNode;
  camera?: { position: [number, number, number]; fov: number };
  children: StageRender;
  /** スクロール連動を使うか。使わないなら計算しない */
  track?: boolean;
  /**
   * 進み具合を測る相手。省略すると自分自身。
   * 画面に貼り付けて（sticky）長い距離を使う演出では、
   * 「貼り付いている入れ物」ではなく「長い外側」を測る必要がある。
   */
  trackRef?: MutableRefObject<HTMLElement | null>;
  /**
   * through … 画面下から入って上へ抜けるまでを 0→1（通り過ぎる演出）
   * sticky  … 貼り付いている間だけを 0→1（話が進む演出）
   */
  trackMode?: "through" | "sticky";
  /** 画面に入る手前どれくらいから読み込むか */
  rootMargin?: string;
};

export default function Stage3D({
  className = "",
  fallback,
  camera = { position: [0, 0, 8], fov: 38 },
  children,
  track = false,
  trackRef,
  trackMode = "through",
  rootMargin = "300px",
}: Props) {
  const tier = useQuality();
  const host = useRef<HTMLDivElement | null>(null);
  const progress = useRef(0);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  const can3D = tier === "high" || tier === "medium";

  // 画面に入ったら読み込む。出たら描画を止める
  useEffect(() => {
    const el = host.current;
    if (!el || !can3D) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setMounted(true);
        setVisible(e.isIntersecting);
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [can3D, rootMargin]);

  // スクロール進み具合を ref に入れる（再描画を起こさないため state にしない）
  useEffect(() => {
    if (!track || !can3D) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = trackRef?.current ?? host.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      let v: number;
      if (trackMode === "sticky") {
        // 貼り付いている間だけを 0→1 にする。
        // 上端が画面の上に来た瞬間が0、下端が画面の下に来た瞬間が1。
        const usable = Math.max(1, r.height - vh);
        v = -r.top / usable;
      } else {
        // 要素の上端が画面下に来た瞬間を0、下端が画面上に抜けた瞬間を1にする
        v = (vh - r.top) / (r.height + vh);
      }
      progress.current = Math.min(1, Math.max(0, v));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [track, can3D, trackRef, trackMode]);

  if (!can3D) {
    return (
      <div ref={host} className={className}>
        {fallback}
      </div>
    );
  }

  return (
    <div ref={host} className={className}>
      {mounted ? (
        <Canvas
          dpr={tier === "high" ? [1, 1.8] : [1, 1.4]}
          camera={camera}
          frameloop={visible ? "always" : "never"}
          gl={{
            antialias: tier === "high",
            alpha: true,
            powerPreference: "high-performance",
          }}
          style={{ width: "100%", height: "100%" }}
        >
          {children({ tier: tier === "high" ? "high" : "medium", progress })}
        </Canvas>
      ) : (
        fallback
      )}
    </div>
  );
}
