"use client";

/**
 * 「実際に触れます」と言うためだけの、細い1本の帯。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを足したのか（2026-09-16）
 * ═══════════════════════════════════════════════════════
 *
 *   このページには、触れるデモが2つあります。
 *     /demo                … 運営者デモ（管理画面）
 *     /demo?side=customer  … お客様デモ（売り場）
 *
 *   ところが、公開されているページのHTMLを調べたところ、
 *   /demo へのリンクが1本もありませんでした。
 *   ヘッダーもファーストビューも最後のボタンも、
 *   全部「導入について相談する」だけを指していました。
 *
 *   広告から30日で約72回クリックが入っても、
 *   「デモを触った」は0件のまま。品質の問題ではなく、扉が無かっただけです。
 *
 *   だから、ページを読んでいる途中で
 *   「これ、自分で触れるのか」と気づける場所を1つ置きます。
 *
 * ★ここを「相談する」に差し替えないこと。
 *   相談はページの最後にあります。ここは、その前段です。
 *   まだ何も見ていない人に先に名前を書かせると、そのまま帰ります。
 */

import Link from "next/link";
import { EV, track } from "@/lib/track";

const LINKS = [
  {
    href: "/demo",
    target: "demo_operator",
    label: "運営者デモを触る",
    note: "AIでガチャを作る／公開前に試す／還元率を見張る／発送する",
    primary: true,
  },
  {
    href: "/demo?side=customer",
    target: "demo_customer",
    label: "お客様デモを触る",
    note: "ガチャを選ぶ／引く／当たる／発送を依頼する／AIに聞く",
    primary: false,
  },
] as const;

export default function DemoInvite() {
  return (
    <section className="bg-paper2 py-14 sm:py-16">
      <div className="container-x">
        <div className="rounded-[28px] border border-edge bg-white px-6 py-9 shadow-lift sm:px-10 sm:py-11">
          <p className="num text-label uppercase text-blue-ink">FREE DEMO</p>

          <h2 className="h-display mt-4 text-h3 text-balance text-slate">
            ここまでの画面は、
            <br className="sm:hidden" />
            そのまま触れます。
          </h2>

          <p className="mt-4 text-body text-pretty text-slate2">
            お申し込みも、ご登録も、クレジットカードも必要ありません。
            <br className="hidden sm:block" />
            見ていただくのは、営業用に作った別物ではなく、実際に動いている画面です。
          </p>

          <div className="mt-8 grid gap-3.5 sm:grid-cols-2">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() =>
                  track(EV.ctaClick, { place: "demo_invite", target: l.target })
                }
                className={`${
                  l.primary ? "btn-primary" : "btn-outline"
                } btn-lg !h-auto flex-col !items-start gap-1 !px-6 !py-4 text-left`}
              >
                <span className="text-[15px] font-bold">{l.label}</span>
                <span
                  className={`text-note font-normal ${
                    l.primary ? "text-white/70" : "text-slate3"
                  }`}
                >
                  {l.note}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
