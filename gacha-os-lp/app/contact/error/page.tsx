import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "送信できませんでした | AI GACHA OS",
  robots: { index: false, follow: false },
};

export default function ContactError() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-24">
      <div className="w-full max-w-lg rounded-2xl border border-danger/25 bg-danger/[0.05] p-8 text-center sm:p-10">
        <h1 className="h-display text-[22px] leading-[1.4]">
          送信できませんでした。
        </h1>
        <p className="mt-4 text-[13px] leading-[2] text-mute">
          入力内容をご確認のうえ、時間をおいて再度お試しください。
          何度も同じ状態が続く場合は、お手数ですが別の手段でご連絡ください。
        </p>
        <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Link href="/#contact" className="btn btn-primary">
            フォームへ戻る
          </Link>
          <Link href="/" className="btn btn-ghost">
            サイトへ戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
