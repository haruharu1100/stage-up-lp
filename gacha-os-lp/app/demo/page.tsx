import type { Metadata } from "next";
import Link from "next/link";
import DemoConsole from "@/components/demo/DemoConsole";
import CustomerPlay from "@/components/sections/CustomerPlay";

/**
 * 無料デモは2種類あります。
 *
 *   /demo                … 運営者デモ（管理画面）
 *                          AIにガチャを作らせる・公開前バックテスト・還元率の監視・発送管理
 *   /demo?side=customer  … お客様デモ（売り場）
 *                          ガチャを選ぶ・引く・当選する・発送を依頼する・AIに聞く
 *
 * ★1つにまとめないこと。
 *   見たいものが人によって違います。
 *   これから始める方は「自分のお客さんがどう遊ぶのか」を先に見たい。
 *   すでに運営している方は「管理がどれだけ楽になるか」を先に見たい。
 *   どちらか片方しか置いていないと、もう片方の人が判断できずに帰ります。
 *
 * ★/demo のURLは変えないこと。
 *   サイト中のボタン・営業資料・広告のリンク先がここを向いています。
 *   お客様デモは ?side=customer という「足し算」で増やしています。
 */

export const metadata: Metadata = {
  title: "無料デモ",
  description:
    "AI GACHA OS のデモです。運営者側（ガチャ設計・公開前バックテスト・実還元率モニタ・発送管理）と、お客様側（ガチャを引く・当選・発送依頼）の両方をそのまま操作できます。",
  robots: { index: false, follow: true },
};

const TABS = [
  {
    href: "/demo",
    key: "operator",
    label: "運営者デモ",
    /*
      ★説明は短く。10文字を超えないこと。
        「AIガチャ設計・バックテスト・管理」と書いていたところ、
        375pxで164pxの枠から文字がはみ出していました。
        ここは折り返さない設定（whitespace-nowrap）なので、
        長い説明を入れると隣のボタンに重なります。
    */
    note: "AI設計・監視・発送",
  },
  {
    href: "/demo?side=customer",
    key: "customer",
    label: "お客様デモ",
    note: "引く・当選・発送依頼",
  },
] as const;

export default function DemoPage({
  searchParams,
}: {
  searchParams?: { side?: string };
}) {
  const customer = searchParams?.side === "customer";

  return (
    <>
      {/*
        どちらのデモを見ているのかが、常に分かるようにする。
        ★スマホでは横に2つ並べたままにしないこと。
          「運営者デモ」「お客様デモ」と説明文が入りきらず、
          文字が途中で折り返して読めなくなります。
      */}
      <div className="sticky top-0 z-40 border-b border-edge bg-white/92 backdrop-blur-xl">
        <div className="container-wide flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-3.5">
          <Link
            href="/"
            className="num shrink-0 whitespace-nowrap text-[12px] tracking-[0.16em] text-slate3 transition-colors hover:text-blue-ink"
          >
            ← AI GACHA OS
          </Link>

          <div
            role="tablist"
            aria-label="デモの種類"
            className="grid grid-cols-2 gap-2 sm:flex sm:gap-2.5"
          >
            {TABS.map((t) => {
              const on = t.key === (customer ? "customer" : "operator");
              return (
                <Link
                  key={t.key}
                  href={t.href}
                  role="tab"
                  aria-selected={on}
                  className={`rounded-2xl border px-3.5 py-2.5 text-center transition-colors sm:px-5 ${
                    on
                      ? "border-blue-ink/30 bg-blue-ink text-white"
                      : "border-edge bg-paper2 text-slate2 hover:border-blue-ink/30 hover:text-blue-ink"
                  }`}
                >
                  <span className="block whitespace-nowrap text-[13px] font-bold">
                    {t.label}
                  </span>
                  <span
                    className={`mt-0.5 block whitespace-nowrap text-[10px] ${
                      on ? "text-white/70" : "text-slate3"
                    }`}
                  >
                    {t.note}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {customer ? <CustomerPlay /> : <DemoConsole />}
    </>
  );
}
