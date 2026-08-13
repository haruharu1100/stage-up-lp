import Link from "next/link";
import { BRAND, IS_TEST_MODE } from "@/config/brand";
import { getPrimaryAccountId } from "@/lib/context";
import { listPosts } from "@/lib/posts";
import { feedSuggestions } from "@/lib/feed";
import PostComposer from "@/components/PostComposer";
import PostBoard from "@/components/PostBoard";
import type { Post } from "@/lib/types";

export const dynamic = "force-dynamic";

// スレッド親のみを一覧に出す（子はスレッドとして親にぶら下がる）
const parentsOnly = (rows: Post[]) => rows.filter((r) => !r.thread_parent_id);

export default async function PostPage() {
  const accountId = await getPrimaryAccountId();

  let drafts: Post[] = [];
  let scheduled: Post[] = [];
  let published: Post[] = [];

  if (accountId) {
    [drafts, scheduled, published] = await Promise.all([
      listPosts(accountId, "draft").then(parentsOnly),
      listPosts(accountId, "scheduled").then(parentsOnly),
      listPosts(accountId, "published").then(parentsOnly),
    ]);
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
        <h1 className="font-serif text-2xl">投稿</h1>
        {IS_TEST_MODE && (
          <p className="mt-2 inline-block rounded bg-ink/80 px-2 py-0.5 text-[11px] text-milk">
            TESTモード（実際には投稿されません）
          </p>
        )}
      </header>

      {!accountId ? (
        <p className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4 text-center text-sm">
          先に{" "}
          <Link href="/connect" className="underline" style={{ color: BRAND.accent }}>
            アカウント接続
          </Link>{" "}
          を行ってください。
        </p>
      ) : (
        <div className="space-y-6">
          <PostComposer accent={BRAND.accent} suggestions={feedSuggestions()} />
          <PostBoard
            accent={BRAND.accent}
            drafts={drafts}
            scheduled={scheduled}
            published={published}
          />
        </div>
      )}
    </main>
  );
}
