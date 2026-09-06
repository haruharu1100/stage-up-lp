/**
 * お客様側の、いちばん外側（常にあるヘッダーとフッター）。
 *
 * ═══════════════════════════════════════════════════════
 * ★「次にどこを押せばいいか」を、画面ごとに考えさせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   これまでは、画面ごとに「戻る」だけがありました。
 *   ガチャを引いた方が獲得商品を見るには、
 *   戻る → マイページ → 獲得商品、と3回押す必要がありました。
 *   3回押す間に、たいていの方は離れます。
 *
 *   ですので、どの画面にも同じ並びを常に出します。
 *
 *       ロゴ ／ 保有ポイント ／ ポイント購入
 *       ガチャ一覧 ／ 獲得商品 ／ マイページ ／ ログアウト
 *
 *   ログインしていない方には、ログイン ／ 新規会員登録。
 *
 * ═══════════════════════════════════════════════════════
 * ★スマホで、押せる大きさを保つこと
 * ═══════════════════════════════════════════════════════
 *
 *   横に7つ並べると、スマホでは1つが指より小さくなります。
 *   ですので2段に分け、下の段は横スクロールにしてあります。
 *   小さくして詰め込むより、はみ出して流すほうが押せます。
 *
 * ═══════════════════════════════════════════════════════
 * ★残高を、読めていないのに 0pt と書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   通信が切れただけで「0pt」と出ると、
 *   お客様はポイントが消えたと受け取ります。
 *   読めていないときは「—」です。これは全画面共通の決まりです。
 *
 * ═══════════════════════════════════════════════════════
 * ★フッターの中身を、このファイルに書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   会社名・住所・電話・規約は、導入した店舗ごとに違います。
 *   ここに書くと、AI GACHA OS 運営会社の情報が
 *   よそのお店の特定商取引法の表記として出ます。
 *   出すのはリンクだけ。中身は /api/shop/info（＝店舗の設定）です。
 */

"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { postHeaders } from "@/lib/csrf";
import { useCustomerPoints } from "@/lib/console/liveMyPage";
import {
  SHOP_DOCS,
  SHOP_DOC_LABEL,
  useShopInfo,
  type ShopInfo,
} from "@/lib/console/shopInfo";
/* ★Sample で始まる部品を読まないこと。
     ここは本物のお客様が見る画面です（scripts/check-real-art.mjs が見張ります）。 */
import { ShopPhoto } from "./art";
import {
  SHOP_ACCENT,
  SHOP_BG,
  SHOP_EDGE,
  SHOP_SURFACE,
} from "./Storefront";

/* ══════════════════════════════════════════════
   行き先
   ══════════════════════════════════════════════ */

/**
 * 下の段に出す行き先。
 *
 * ★ここを画面ごとに変えないこと。
 *   並びが画面ごとに変わると、指が場所を覚えられません。
 */
const NAV = [
  { key: "shop", label: "ガチャ一覧", href: "/mypage/shop" },
  { key: "prizes", label: "獲得商品", href: "/mypage/prizes" },
  { key: "mypage", label: "マイページ", href: "/mypage" },
] as const;

export type NavKey = (typeof NAV)[number]["key"];

/** いま開いている場所を、URLから決める */
function activeFromPath(path: string | null): NavKey | null {
  if (path === null) return null;
  if (path.startsWith("/mypage/shop")) return "shop";
  if (path.startsWith("/mypage/prizes")) return "prizes";
  if (path === "/mypage") return "mypage";
  return null;
}

/* ══════════════════════════════════════════════
   ヘッダー
   ══════════════════════════════════════════════ */

function ShopHeader({ info }: { info: ShopInfo | null }) {
  const router = useRouter();
  const path = usePathname();
  const active = activeFromPath(path);

  const points = useCustomerPoints();
  /* ★読めたときだけ数字を出す。それ以外は「—」 */
  const balance = points.state.phase === "ok" ? points.state.data.balance : null;
  const anon = points.state.phase === "anon";

  const [deteru, setDeteru] = useState(false);

  /* ポイント購入から戻ってくる先。
     ★いま見ている画面を渡すこと。渡さないと、購入後に
       マイページの入口へ放り出され、探し直しになります。
     ★ここで作った値をそのまま行き先に使わないこと。
       サーバー（safeReturnTo）が /mypage の中だと認めたものだけが戻り先です。 */
  const modoriSaki = path !== null && path.startsWith("/mypage") ? path : "/mypage";

  const deru = useCallback(async () => {
    if (deteru) return;
    setDeteru(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: postHeaders() });
    } catch {
      /* 通信に失敗しても、画面はログインへ送ります。
         ★ここで「ログアウトできませんでした」と出して留めないこと。
           出たいのに出られない画面は、いちばん不安にさせます。 */
    }
    /* ★router.push で済ませないこと。
         手元に残った古い画面（残高・獲得商品）が、
         戻るボタンで読み直されずに出てしまいます。 */
    window.location.href = "/login";
  }, [deteru]);

  const shopName = info?.shopName ?? null;
  const accent = info?.brandColor ?? SHOP_ACCENT;

  return (
    <header
      className="sticky top-0 z-40"
      style={{
        background: "rgba(5,9,18,0.94)",
        backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${SHOP_EDGE}`,
      }}
    >
      <div className="mx-auto w-full max-w-[560px] px-4">
        {/* ── 上の段：ロゴ・残高・ポイント購入 ── */}
        <div className="flex h-14 items-center gap-2">
          <button
            type="button"
            data-testid="chrome-logo"
            onClick={() => router.push(anon ? "/" : "/mypage")}
            className="flex min-w-0 items-center gap-2"
          >
            {info?.logoImageId ? (
              <span className="block h-8 w-8 shrink-0 overflow-hidden rounded-lg">
                <ShopPhoto
                  imageId={info.logoImageId}
                  alt={shopName ?? "お店のロゴ"}
                  className="h-full w-full object-cover"
                />
              </span>
            ) : null}
            <span className="truncate text-[0.92rem] font-bold text-white">
              {/* ★店名が未設定のときに、こちらの商品名を出さないこと。
                    お客様には、よその会社の店に見えます。 */}
              {shopName ?? "オンラインガチャ"}
            </span>
          </button>

          <span className="flex-1" />

          {anon ? (
            <span className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                data-testid="chrome-login"
                onClick={() => router.push("/login")}
                className="rounded-xl px-3 py-2 text-[0.78rem] font-bold text-white/75"
                style={{ border: `1px solid ${SHOP_EDGE}` }}
              >
                ログイン
              </button>
              <button
                type="button"
                data-testid="chrome-signup"
                onClick={() => router.push("/signup")}
                className="rounded-xl px-3 py-2 text-[0.78rem] font-bold text-[#050912]"
                style={{ background: accent }}
              >
                新規会員登録
              </button>
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                data-testid="chrome-balance"
                onClick={() => router.push("/mypage/points")}
                className="rounded-xl px-2.5 py-1.5 text-right"
                style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
              >
                <span className="block text-[0.58rem] font-bold leading-none text-white/45">
                  保有ポイント
                </span>
                <span
                  className="num block text-[0.88rem] font-bold leading-tight"
                  style={{ color: accent }}
                >
                  {balance === null ? "—" : balance.toLocaleString()}
                  <span className="ml-0.5 text-[0.6rem] text-white/45">pt</span>
                </span>
              </button>
              <button
                type="button"
                data-testid="chrome-buy-points"
                onClick={() =>
                  router.push(
                    `/mypage/points/buy?from=${encodeURIComponent(modoriSaki)}`,
                  )
                }
                className="rounded-xl px-3 py-2.5 text-[0.78rem] font-bold text-[#050912]"
                style={{ background: accent }}
              >
                ＋ 購入
              </button>
            </span>
          )}
        </div>

        {/* ── 下の段：行き先 ──
            ★ログインしていない方に「獲得商品」を出さないこと。
              押しても入れない場所を並べると、壊れて見えます。 */}
        {!anon && (
          <nav className="-mx-4 flex items-stretch gap-1 overflow-x-auto px-4 pb-1.5">
            {NAV.map((n) => {
              const on = active === n.key;
              return (
                <button
                  key={n.key}
                  type="button"
                  data-testid={`chrome-nav-${n.key}`}
                  onClick={() => router.push(n.href)}
                  className="shrink-0 rounded-lg px-3 py-2 text-[0.78rem] font-bold transition"
                  style={{
                    color: on ? "#050912" : "rgba(255,255,255,0.66)",
                    background: on ? accent : "transparent",
                  }}
                >
                  {n.label}
                </button>
              );
            })}
            <span className="flex-1" />
            <button
              type="button"
              data-testid="chrome-logout"
              onClick={deru}
              disabled={deteru}
              className="shrink-0 rounded-lg px-3 py-2 text-[0.78rem] font-bold text-white/45 disabled:opacity-40"
            >
              {deteru ? "ログアウト中…" : "ログアウト"}
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}

/* ══════════════════════════════════════════════
   フッター
   ══════════════════════════════════════════════ */

function ShopFooter({ info }: { info: ShopInfo | null }) {
  const router = useRouter();

  return (
    <footer
      className="mt-10"
      style={{ borderTop: `1px solid ${SHOP_EDGE}`, background: "rgba(5,9,18,0.6)" }}
    >
      <div className="mx-auto w-full max-w-[560px] px-4 py-6">
        <nav className="grid grid-cols-2 gap-x-3 gap-y-1">
          {SHOP_DOCS.map((d) => (
            <button
              key={d}
              type="button"
              data-testid={`footer-${d}`}
              onClick={() => router.push(`/store/${d}`)}
              className="py-2 text-left text-[0.76rem] font-bold leading-[1.6] text-white/60 underline underline-offset-4"
            >
              {SHOP_DOC_LABEL[d]}
            </button>
          ))}
        </nav>

        {/* ★ここに、こちらの会社名を書かないこと。
              お店が設定していなければ、何も出しません。
              空欄のほうが、よその会社名より、はるかに安全です。 */}
        {info?.legalName && (
          <p className="mt-4 text-[0.7rem] leading-[1.9] text-white/35">
            {info.legalName}
            {info.antiqueLicense ? `／${info.antiqueLicense}` : ""}
          </p>
        )}

        {/* ★お店の設定が空のままなら、そのことを隠さないこと。
              隠すと、お店は自分の設定が足りないことに気づけません。
              気づかないまま売り続けるほうが、はるかに危ないです。 */}
        {info !== null && !info.legalReady && (
          <p className="mt-3 rounded-xl px-3 py-2 text-[0.7rem] leading-[1.8] text-[#FFD08A]"
             style={{ background: "rgba(255,190,90,0.08)", border: "1px solid rgba(255,190,90,0.25)" }}>
            このお店の表記は、まだ設定が完了していません。
          </p>
        )}
      </div>
    </footer>
  );
}

/* ══════════════════════════════════════════════
   外枠
   ══════════════════════════════════════════════ */

/**
 * お客様側の全画面で使う外枠。
 *
 * ★画面ごとに独自の外枠を作らないこと。
 *   ヘッダーが出る画面と出ない画面が混ざると、
 *   お客様は「行き止まりに入った」と感じます。
 */
export function CustomerShell({ children }: { children: React.ReactNode }) {
  const info = useShopInfo();
  const shop = info.phase === "ok" ? info.data : null;

  return (
    <div className="flex min-h-[100dvh] flex-col" style={{ background: SHOP_BG }}>
      <ShopHeader info={shop} />
      <div className="mx-auto w-full max-w-[560px] flex-1 px-4 pb-14 pt-4">
        {children}
      </div>
      <ShopFooter info={shop} />
    </div>
  );
}
