import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import {
  collectedData,
  legalPolicy,
  operatorContact,
  operatorName,
  operatorReady,
} from "@/config/legal";

export const metadata: Metadata = {
  title: "個人情報の取り扱いについて｜AI GACHA OS",
  description:
    "ご相談フォームでお預かりする情報の内容・利用目的・保管期間・お問い合わせ窓口を記載しています。",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-void">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-void/90 backdrop-blur-xl">
        <div className="container-x flex h-14 items-center justify-between gap-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Logo className="h-6 w-6 shrink-0" />
            <span className="num shrink-0 text-[12px] font-bold tracking-[0.16em]">
              AI GACHA <span className="text-gradient-blue">OS</span>
            </span>
          </Link>
          <Link
            href="/#contact"
            className="num shrink-0 text-[11px] text-white/40 transition-colors hover:text-white/80"
          >
            ご相談フォームへ →
          </Link>
        </div>
      </header>

      <main className="container-x max-w-3xl py-10 sm:py-16">
        <span className="eyebrow">PRIVACY</span>
        <h1 className="h-display mt-4 text-[24px] leading-[1.4] sm:text-[32px] sm:leading-[1.3]">
          個人情報の取り扱いについて
        </h1>
        <p className="mt-5 text-[13px] leading-[2] text-mute">
          このサイトのご相談フォームでお預かりする情報について、
          何を取得し、何に使い、どのように扱うかを記載しています。
        </p>

        {!operatorReady && (
          <p className="mt-6 rounded-xl border border-danger/30 bg-danger/[0.08] px-5 py-4 text-[12px] leading-[1.95] text-[#FFD7D7]">
            事業者名または問い合わせ窓口が未設定です。公開前に設定してください
            （config/legal.ts、または環境変数 NEXT_PUBLIC_OPERATOR_NAME /
            NEXT_PUBLIC_OPERATOR_CONTACT）。
          </p>
        )}

        {/* 何を取得しているか */}
        <section className="mt-10">
          <h2 className="text-[15px] font-bold text-ink sm:text-[17px]">
            取得する情報
          </h2>
          <div className="mt-5 space-y-2.5">
            {collectedData.map((c) => (
              <div
                key={c.what}
                className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"
              >
                <p className="text-[13.5px] font-bold text-white/90">{c.what}</p>
                <p className="mt-2 text-[12.5px] leading-[1.95] text-white/60">
                  {c.detail}
                </p>
                <p className="mt-2 text-[12px] leading-[1.95] text-white/40">
                  利用目的：{c.why}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 方針 */}
        <section className="mt-10">
          <h2 className="text-[15px] font-bold text-ink sm:text-[17px]">
            取り扱いの方針
          </h2>
          <div className="mt-5 divide-y divide-white/6 rounded-2xl border border-white/10 bg-white/[0.02]">
            {legalPolicy.map((p) => (
              <div key={p.h} className="px-5 py-5">
                <p className="text-[13px] font-bold text-white/85">{p.h}</p>
                <p className="mt-2 text-[12.5px] leading-[2] text-white/55">{p.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 窓口 */}
        <section className="mt-10">
          <h2 className="text-[15px] font-bold text-ink sm:text-[17px]">
            お問い合わせ窓口
          </h2>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-6">
            <dl className="space-y-3.5">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <dt className="w-24 shrink-0 text-[12px] text-white/40">事業者名</dt>
                <dd
                  className={`text-[13px] ${
                    operatorReady ? "text-white/85" : "text-danger"
                  }`}
                >
                  {operatorName}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <dt className="w-24 shrink-0 text-[12px] text-white/40">連絡先</dt>
                <dd
                  className={`num text-[13px] ${
                    operatorReady ? "text-white/85" : "text-danger"
                  }`}
                >
                  {operatorContact}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <p className="mt-10 text-[11px] leading-[1.95] text-white/35">
          この内容は、このLP（AI GACHA OS のご案内サイト）でお預かりする情報についてのものです。
          システムの導入後にお客様の環境でお預かりする情報の取り扱いは、別途、契約時に定めます。
        </p>

        <Link href="/#contact" className="btn btn-ghost mt-8">
          ご相談フォームへ戻る
        </Link>
      </main>
    </div>
  );
}
