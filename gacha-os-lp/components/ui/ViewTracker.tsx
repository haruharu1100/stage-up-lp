"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/track";

/**
 * 画面に入ったときに1回だけ計測イベントを送る目印。
 *
 * 「料金までスクロールした人がどれくらいいるか」を知るために使う。
 * 計測が無効（GA4未設定）なら何もしない。表示には一切影響しない。
 */
export default function ViewTracker({
  event,
  params,
}: {
  event: string;
  params?: Record<string, unknown>;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !sent.current) {
            sent.current = true;
            track(event, params ?? {});
            io.disconnect();
          }
        }
      },
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  return <span ref={ref} aria-hidden className="block h-px w-full" />;
}
