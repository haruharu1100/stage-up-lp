/**
 * 手元の開発サーバーを「温めて」おく。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ要るのか（2026-09-07）
 * ═══════════════════════════════════════════════════════
 *
 *   手元の開発サーバーは、その画面を最初に開いた1回だけ、
 *   組み立てに10〜40秒かかります。2回目からは一瞬です。
 *
 *   通しE2Eは「20秒以内に出ること」を見ています。
 *   ですから、その画面が初めてだと、
 *   作りは正しいのに「出ませんでした」と記録されます。
 *   実際に、それだけで13件が赤くなりました。
 *
 *   ★E2Eの待ち時間を伸ばして誤魔化さないこと。
 *     伸ばすと、本物の「遅すぎる」を見逃します。
 *     先に温めてから測るのが正しい順番です。
 *
 *   使い方：
 *     node scripts/warm-dev.mjs http://localhost:3212
 */

const BASE = (process.argv[2] ?? "http://localhost:3212").replace(/\/$/, "");

/* 管理画面（1つのURLの形で全部同じ組み立て。代表を数枚だけ） */
const KANRI = [
  "dashboard",
  "store-setup",
  "gachas",
  "gacha-new",
  "customers",
  "points",
  "orders",
  "shipping",
  "support",
  "return-rate",
  "backtest",
  "preview",
  "settings",
  "audit",
  "admins",
];

const MICHI = [
  "/",
  "/login",
  "/signup",
  "/change-password",
  "/verify-email",
  "/shop",
  "/mypage",
  "/mypage/points",
  "/mypage/prizes",
  "/mypage/shipping",
  "/mypage/address",
  "/mypage/support",
  "/mypage/shop",
  "/store/company",
  "/store/legal",
  "/store/terms",
  "/store/privacy",
  "/store/faq",
  "/store/contact",
  ...KANRI.map((s) => `/client-demo/${s}`),
];

console.log(`温めます： ${BASE}（${MICHI.length}か所）`);
let osoi = 0;
for (const m of MICHI) {
  const t = Date.now();
  try {
    const r = await fetch(`${BASE}${m}`, { redirect: "manual" });
    await r.arrayBuffer().catch(() => null);
    const ms = Date.now() - t;
    if (ms > 3000) osoi += 1;
    console.log(`  ${String(r.status).padEnd(3)} ${String(ms).padStart(6)}ms  ${m}`);
  } catch (e) {
    console.log(`  ---  ${String(Date.now() - t).padStart(6)}ms  ${m}  ${String(e).slice(0, 80)}`);
  }
}
console.log(`終わりました（初回で3秒以上かかった画面： ${osoi}件）`);
