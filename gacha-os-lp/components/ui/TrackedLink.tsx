"use client";

import type { ReactNode } from "react";
import { track } from "@/lib/track";
import { saveSelectedPlan } from "@/lib/lead";

/**
 * 押されたことを計測するリンク。
 *
 * 「どのプランのボタンが押されたか」を残すために使う。
 * 計測が無効（GA4未設定）でも、リンクとしては普通に動く。
 *
 * plan を渡した場合は、計測に送るだけでなくブラウザにも保存する。
 * 計測（GA4）は人数しか分からないため、
 * 「この問い合わせはGROWTHのボタンから来た」を1件ずつ残すには保存が必要。
 */
export default function TrackedLink({
  href,
  event,
  params,
  plan,
  className,
  children,
}: {
  href: string;
  event: string;
  params?: Record<string, unknown>;
  /** 料金プランのボタンのときだけ渡す（starter / growth / enterprise） */
  plan?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => {
        if (plan) saveSelectedPlan(plan);
        track(event, params ?? {});
      }}
    >
      {children}
    </a>
  );
}
