import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import {
  collectedData,
  legalPolicy,
  operatorAddress,
  operatorContact,
  operatorName,
  operatorReady,
  operatorRepresentative,
} from "@/config/legal";

export const metadata: Metadata = {
  title: "個人情報の取り扱いについて｜AI GACHA OS",
  description:
    "ご相談フォームでお預かりする情報の内容・利用目的・保管期間・お問い合わせ窓口を記載しています。",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-paper">
      {/*
        本編（LP）が白基調なので、法務ページも同じ白に揃える。
        ここだけ黒いままだと「作りかけのページ」に見えて、
        いちばん信用が要る場所で信用を落とす。
      */}
      <header className="sticky top-0 z-40 border-b border-edge bg-white/85 backdrop-blur-xl">
        <div className="container-x flex h-14 items-center justify-between gap-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Logo className="h-6 w-6 shrink-0" />
            <span className="num shrink-0 text-label font-bold text-slate">
              AI GACHA <span className="text-gradient-royal">OS</span>
            </span>
          </Link>
          <Link
            href="/#contact"
            className="num shrink-0 text-label text-slate3 transition-colors hover:text-blue-ink"
          >
            ご相談フォームへ →
          </Link>
        </div>
      </header>

      <main className="container-x max-w-3xl py-12 sm:py-16">
        <span className="eyebrow-lite">PRIVACY</span>
        <h1 className="h-display mt-4 text-h2 text-slate">
          個人情報の取り扱いについて
        </h1>
        <p className="mt-5 text-note leading-[1.95] text-slate2">
          このサイトのご相談フォームでお預かりする情報について、
          何を取得し、何に使い、どのように扱うかを記載しています。
        </p>

        {!operatorReady && (
          <p className="mt-6 rounded-xl border border-danger-ink/30 bg-danger-ink/[0.06] px-5 py-4 text-note leading-[1.95] text-danger-ink">
            事業者情報または問い合わせ窓口が未設定です。公開前に設定してください
            （config/legal.ts、または環境変数）。
          </p>
        )}

        {/* 事業者情報 */}
        <section className="mt-10">
          <h2 className="text-h3 font-bold text-slate">事業者情報</h2>
          <div className="mt-5 divide-y divide-edge2 rounded-2xl border border-edge bg-white">
            {[
              { k: "事業者名", v: operatorName },
              { k: "代表者", v: operatorRepresentative },
              { k: "所在地", v: operatorAddress },
            ].map((r) => (
              <div
                key={r.k}
                className="flex flex-wrap gap-x-5 gap-y-1 px-5 py-4 sm:px-6"
              >
                <dt className="w-28 shrink-0 text-note text-slate3">{r.k}</dt>
                <dd className="text-note text-slate">{r.v}</dd>
              </div>
            ))}
          </div>
        </section>

        {/* 何を取得しているか */}
        <section className="mt-10">
          <h2 className="text-h3 font-bold text-slate">取得する情報</h2>
          <div className="mt-5 space-y-2.5">
            {collectedData.map((c) => (
              <div
                key={c.what}
                className="rounded-2xl border border-edge bg-white p-5 sm:p-6"
              >
                <p className="text-note font-bold text-slate">{c.what}</p>
                <p className="mt-2 text-note leading-[1.95] text-slate2">
                  {c.detail}
                </p>
                <p className="mt-2 text-note leading-[1.95] text-slate3">
                  利用目的：{c.why}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 方針 */}
        <section className="mt-10">
          <h2 className="text-h3 font-bold text-slate">取り扱いの方針</h2>
          <div className="mt-5 divide-y divide-edge2 rounded-2xl border border-edge bg-white">
            {legalPolicy.map((p) => (
              <div key={p.h} className="px-5 py-5 sm:px-6">
                <p className="text-note font-bold text-slate">{p.h}</p>
                <p className="mt-2 text-note leading-[2] text-slate2">{p.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 窓口 */}
        <section className="mt-10">
          <h2 className="text-h3 font-bold text-slate">お問い合わせ窓口</h2>
          <div className="mt-5 rounded-2xl border border-edge bg-white p-5 sm:p-6">
            <p className="text-note leading-[1.95] text-slate2">
              ご自身の情報の開示・訂正・利用停止・削除のご希望、その他このページに
              ついてのお問い合わせは、
              <span className="font-bold text-slate">{operatorContact}</span>
              から承ります。ご本人であることを確認のうえ、速やかに対応します。
            </p>
            <Link href="/#contact" className="btn-outline mt-5">
              ご相談フォームを開く
            </Link>
          </div>
        </section>

        <p className="mt-10 text-note leading-[1.95] text-slate3">
          この内容は、このLP（AI GACHA OS のご案内サイト）でお預かりする情報についてのものです。
          システムの導入後にお客様の環境でお預かりする情報の取り扱いは、別途、契約時に定めます。
        </p>

        <Link href="/" className="btn-outline mt-8">
          トップへ戻る
        </Link>
      </main>
    </div>
  );
}
