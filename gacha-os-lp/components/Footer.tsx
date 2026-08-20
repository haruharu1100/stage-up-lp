import Link from "next/link";
import Logo from "./ui/Logo";

export default function Footer() {
  return (
    <footer className="relative border-t border-edge bg-paper2 pb-36 pt-16 sm:py-20">
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
