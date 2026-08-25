/**
 * デモ用の入口を、いつ出すか。
 *
 * ═══════════════════════════════════════════════════════
 * ★決まり
 * ═══════════════════════════════════════════════════════
 *
 *   「デモ管理者としてログイン」「デモのお客様として開始」は、
 *   合言葉なしで中に入れるボタンです。
 *   本番に1つでも残っていたら、鍵のかかっていない裏口です。
 *
 *   だから、次の両方がそろったときだけ出します。
 *
 *       DEMO_MODE=true
 *       かつ 本番ではない
 *
 *   ★片方だけで判断しないこと。
 *     DEMO_MODE を消し忘れただけで裏口が開く作りにはしません。
 *     本番であることが分かった時点で、値に関わらず閉じます。
 */

import { dbEnv } from "./db";

/** デモの入口を出してよいか */
export function demoAllowed(): boolean {
  if (process.env.DEMO_MODE !== "true") return false;

  /* ★本番では、DEMO_MODE の値に関わらず閉じること */
  if (dbEnv() === "production") return false;
  if (process.env.VERCEL_ENV === "production") return false;

  return true;
}

/** 画面へ渡すための、まとめ */
export function demoFlags() {
  const on = demoAllowed();
  return {
    demoMode: on,
    /** デモ管理者として入るボタンを出すか */
    showDemoAdmin: on,
    /** デモのお客様として始めるボタンを出すか */
    showDemoCustomer: on,
    /** 「改ざんしてみる」など、壊して見せる機能を出すか */
    showTamperTools: on,
  };
}
