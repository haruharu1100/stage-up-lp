import Link from "next/link";
import { BRAND, IS_TEST_MODE } from "@/config/brand";
import { getPrimaryAccountId } from "@/lib/context";
import { listInbox } from "@/lib/inbox";
import InboxBoard from "@/components/InboxBoard";
import type { InboxReply } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const accountId = await getPrimaryAccountId();
  let replies: InboxReply[] = [];
  if (accountId) {
    replies = await listInbox(accountId);
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-24">
      <header
        className="-mx-4 mb-5 px-4 pb-4 pt-6"
        style={{ background: BRAND.accentSoft }}
      >
        <Link href="/" className="text-sm text-[color:var(--muted)]">
          ‹ ホーム
        </Link>
        <h1 className="font-serif text-2xl">届いたリプ</h1>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          重い相談・炎上リスクは自動でフラグを立て、AI下書きを作りません（人が対応）。
        </p>
        {IS_TEST_MODE && (
          <p className="mt-2 inline-block rounded bg-ink/80 px-2 py-0.5 text-[11px] text-milk">
            TESTモード（実際の送信はされません）
          </p>
        )}
      </header>

      {!accountId ? (
        <p className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4 text-center text-sm">
          先に{" "}
          <Link
            href="/connect"
            className="underline"
            style={{ color: BRAND.accent }}
          >
            アカウント接続
          </Link>{" "}
          を行ってください。
        </p>
      ) : (
        <InboxBoard accent={BRAND.accent} initial={replies} />
      )}
    </main>
  );
}
