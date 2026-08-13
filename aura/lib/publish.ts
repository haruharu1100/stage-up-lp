import { IS_TEST_MODE } from "@/config/brand";
import { Post } from "./types";
import { checkGuard, GuardResult } from "./guard";
import {
  getThread,
  updatePost,
  logAction,
  getPost,
} from "./posts";
import { getAccountById } from "./accounts";
import { getXCreds } from "./x/creds";
import { createTweet } from "./x/post";
import { uploadMedia } from "./x/media";
import { genId } from "./store/testdb";
import fs from "fs";

export interface PublishResult {
  published: boolean;
  reason?: string;
}

// 予約/手動いずれの公開もここを通す。ガードを必ず経由する。
// scheduled/手動タップは人の意思決定済みのため承認ゲートは通過扱い(ignoreApproval)、
// ただし上限・間隔・NGワード・重複は必ず判定する。
export async function publishPost(
  postId: string,
  actor: "human" | "system"
): Promise<PublishResult> {
  const parent = await getPost(postId);
  if (!parent) return { published: false, reason: "投稿が見つかりません" };
  if (parent.status === "published") {
    return { published: false, reason: "すでに公開済みです" };
  }

  const guard: GuardResult = await checkGuard(parent.account_id, "post", {
    body: parent.body,
    ignoreApproval: true,
  });
  if (!guard.ok) {
    return { published: false, reason: guard.reason };
  }

  const children = await getThread(parent.id);
  const chain = [parent, ...children];

  // --- テストモード：外部に出さず疑似公開 ---
  if (IS_TEST_MODE) {
    const now = new Date().toISOString();
    for (const p of chain) {
      await updatePost(p.id, {
        status: "published",
        published_at: now,
        x_post_id: `test-${genId()}`,
      });
    }
    await logAction(parent.account_id, "post", actor, parent.id);
    return { published: true };
  }

  // --- 本番：X APIで実際に投稿 ---
  const account = await getAccountById(parent.account_id);
  if (!account) return { published: false, reason: "アカウント未接続" };

  try {
    const creds = await getXCreds(account);
    let replyTo: string | undefined;
    for (const p of chain) {
      // ローカルにある画像ファイルは media/upload してツイートに添付する
      const mediaIds: string[] = [];
      for (const m of (p.media_urls ?? []).slice(0, 4)) {
        if (m && !/^https?:\/\//.test(m) && fs.existsSync(m)) {
          mediaIds.push(await uploadMedia(creds, m));
        }
      }
      const created = await createTweet(
        creds,
        p.body,
        replyTo,
        mediaIds.length ? mediaIds : undefined
      );
      await updatePost(p.id, {
        status: "published",
        published_at: new Date().toISOString(),
        x_post_id: created.id,
      });
      replyTo = created.id; // 次のツイートはこれへの返信＝スレッド連結
    }
    await logAction(parent.account_id, "post", actor, parent.id);
    return { published: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await updatePost(parent.id, { status: "failed" });
    return { published: false, reason: msg };
  }
}

// 予約時刻が到来した投稿をまとめて公開（cronから呼ぶ）
export async function publishDue(due: Post[]): Promise<{
  published: number;
  skipped: number;
  reasons: string[];
}> {
  let published = 0;
  let skipped = 0;
  const reasons: string[] = [];
  for (const p of due) {
    const r = await publishPost(p.id, "system");
    if (r.published) published++;
    else {
      skipped++;
      if (r.reason) reasons.push(`${p.id}: ${r.reason}`);
    }
  }
  return { published, skipped, reasons };
}
