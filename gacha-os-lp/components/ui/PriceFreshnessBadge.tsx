"use client";

import { useEffect, useState } from "react";
import {
  formatFetchedAt,
  lastScheduledFetch,
  priceFreshness,
  type FreshnessResult,
} from "@/lib/priceFreshness";

/**
 * 市場価格の鮮度バッジ。
 *
 * 「最終更新 2026-08-18 04:00」のような固定の文字を書かず、
 * 実際に判定した結果を出します。
 * 価格が古ければ、緑ではなく警告色になり、実還元率は表示されません。
 *
 * ブラウザ側で時刻を見て判定します（ビルドした日で固まらないようにするため）。
 */
export default function PriceFreshnessBadge({
  className = "",
}: {
  className?: string;
}) {
  const [f, setF] = useState<FreshnessResult | null>(null);
  const [at, setAt] = useState<string>("");

  useEffect(() => {
    const fetchedAt = lastScheduledFetch();
    setF(priceFreshness(fetchedAt));
    setAt(formatFetchedAt(fetchedAt));
  }, []);

  if (!f) {
    return (
      <span className={`num text-note text-slate3 ${className}`}>
        最終更新 確認中…
      </span>
    );
  }

  const tone =
    f.state === "FRESH"
      ? "border-ok/30 bg-ok/[0.08] text-ok-ink"
      : f.state === "STALE"
        ? "border-warn/35 bg-warn/[0.10] text-warn-ink"
        : "border-danger/35 bg-danger/[0.08] text-danger-ink";

  return (
    <span className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span
        className={`num rounded-full border px-3 py-1 text-[13px] font-semibold tracking-[0.14em] ${tone}`}
      >
        {f.state}
      </span>
      <span className="num text-note text-slate3">最終更新 {at}</span>
    </span>
  );
}
