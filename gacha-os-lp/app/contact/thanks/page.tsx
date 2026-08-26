import Link from "next/link";
import type { Metadata } from "next";
import { deliveryPeriod } from "@/content/site";

export const metadata: Metadata = {
  title: "送信しました | AI GACHA OS",
  robots: { index: false, follow: false },
};

export default function ContactThanks() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-24">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/[0.025] p-8 text-center sm:p-10">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-ok/35 bg-ok/10">
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3.5 8.5l3 3 6-7"
              stroke="#34D399"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1 className="h-display mt-6 text-[22px] leading-[1.4]">
          送信しました。
        </h1>
        <p className="mt-4 text-[13px] leading-[2] text-mute">
          内容を確認のうえ、担当者からご連絡します。
          お急ぎの場合は、その旨をメールでお知らせください。
        </p>
        {/* ★納品の目安（必須表示）。
               問い合わせた直後の人が、いちばん「いつ使えるのか」を知りたがります。
               LP と同じ文言を deliveryPeriod から出すこと。
               label と note は必ずセットで（景品表示法）。 */}
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5 text-left">
          <p className="text-[13px] font-bold text-white/90">
            {deliveryPeriod.label}
          </p>
          <p className="mt-2 text-[12px] leading-[1.9] text-mute">
            {deliveryPeriod.note}
          </p>
        </div>
        <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Link href="/" className="btn btn-primary">
            サイトへ戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
