import Link from "next/link";
import Logo from "./ui/Logo";
import {
  operatorAddress,
  operatorName,
  operatorRepresentative,
} from "@/config/legal";

export default function Footer() {
  return (
    // 下の余白は、スマホの固定CTAバー（実測157px）に文章が隠れない高さにしている
    <footer className="relative border-t border-edge bg-paper2 pb-44 pt-16 sm:py-20">
      <div className="container-x">
        <div className="flex flex-col gap-14 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy">
                <Logo className="h-6 w-6" />
              </span>
              <span className="num text-label font-bold text-slate">
                AI GACHA <span className="text-gradient-royal">OS</span>
              </span>
            </div>
            <p className="mt-6 text-note text-pretty text-slate2">
              オンラインガチャ事業の運営を支えるシステムです。ガチャ設計から還元率管理、発送、顧客対応までを1つの管理画面にまとめます。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-4 text-note sm:grid-cols-3">
            {[
              { label: "3分ツアー", href: "/#tour" },
              { label: "機能一覧", href: "/#os" },
              { label: "実還元率", href: "/#rtp" },
              { label: "導入効果の試算", href: "/#roi" },
              { label: "管理画面デモ", href: "/demo" },
              { label: "セキュリティ", href: "/#security" },
              { label: "導入の入り方", href: "/#scope" },
              { label: "料金", href: "/#pricing" },
              { label: "FAQ", href: "/#faq" },
              { label: "導入フロー", href: "/#flow" },
              { label: "営業資料ページ", href: "/sales" },
              { label: "導入について相談する", href: "/#contact" },
            ].map((l) => (
              <Link
                key={l.href + l.label}
                href={l.href}
                className="text-slate2 transition-colors hover:text-blue-ink"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="rule my-12" />

        {/*
          誰が売っているのかを、探さなくても分かる場所に置く。
          ここが無い（または探しにくい）と、
          サイトの出来がよくても最後の一歩で信用されない。
        */}
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <dl className="grid gap-x-6 gap-y-2 text-note sm:grid-cols-[auto_1fr]">
            <dt className="text-slate3">販売事業者</dt>
            <dd className="text-slate">{operatorName}</dd>
            <dt className="text-slate3">代表者</dt>
            <dd className="text-slate">{operatorRepresentative}</dd>
            <dt className="text-slate3">所在地</dt>
            <dd className="text-slate">{operatorAddress}</dd>
          </dl>

          <Link
            href="/legal/privacy"
            className="text-note text-slate2 underline decoration-edge underline-offset-4 transition-colors hover:text-blue-ink"
          >
            個人情報の取り扱いについて
          </Link>
        </div>

        <div className="rule my-10" />

        <div className="flex flex-col gap-4 text-note text-slate3 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} AI GACHA OS. All rights reserved.</p>
          <p className="text-pretty sm:text-right">
            記載金額は税別・目安です。個別の法的適合性については専門家のご確認をお願いしています。
          </p>
        </div>
      </div>
    </footer>
  );
}
