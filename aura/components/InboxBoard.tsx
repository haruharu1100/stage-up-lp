"use client";

import { useState } from "react";
import type { InboxReply } from "@/lib/types";

const PRIORITY_LABEL: Record<string, string> = {
  high: "高",
  normal: "中",
  low: "低",
};

export default function InboxBoard({
  accent,
  initial,
}: {
  accent: string;
  initial: InboxReply[];
}) {
  const [replies, setReplies] = useState<InboxReply[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/inbox/sync", { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error || "取得に失敗しました");
      } else {
        setMsg(
          `取得${json.fetched}件 / 新規${json.added}件 ・ 要注意${json.sensitive}件 ・ AI下書き${json.drafted}件`
        );
        const list = await fetch("/api/inbox").then((r) => r.json());
        if (list.ok) setReplies(list.replies);
      }
    } catch {
      setMsg("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={sync}
          disabled={busy}
          className="rounded-full px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: accent }}
        >
          {busy ? "取得中…" : "最新のリプを取得"}
        </button>
        {msg && <span className="text-xs text-[color:var(--muted)]">{msg}</span>}
      </div>

      {replies.length === 0 ? (
        <p className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4 text-center text-sm text-[color:var(--muted)]">
          まだ取り込んだリプはありません。「最新のリプを取得」を押してください。
        </p>
      ) : (
        <ul className="space-y-3">
          {replies.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4"
              style={
                r.sensitivity_flag
                  ? { borderColor: "#B54545", borderWidth: 2 }
                  : undefined
              }
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-[color:var(--muted)]">
                <span className="font-medium">@{r.author_handle ?? "user"}</span>
                {r.author_follower_count != null && (
                  <span>{r.author_follower_count.toLocaleString()} フォロワー</span>
                )}
                <span className="ml-auto rounded-full bg-black/5 px-2 py-0.5">
                  優先度 {PRIORITY_LABEL[r.priority] ?? r.priority}
                </span>
              </div>

              <p className="whitespace-pre-wrap text-sm">{r.body}</p>

              {r.sensitivity_flag ? (
                <p className="mt-3 rounded-lg bg-[#FBE9E9] px-3 py-2 text-xs text-[#8A2B2B]">
                  ⚠ 重い相談・トラブルの可能性。AI下書きは作成していません。
                  内容を確認し、人が丁寧に対応してください。
                </p>
              ) : r.ai_draft ? (
                <div className="mt-3 rounded-lg bg-black/5 px-3 py-2">
                  <p className="mb-1 text-[11px] text-[color:var(--muted)]">
                    AI返信下書き（送信前に必ず確認）
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{r.ai_draft}</p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-[color:var(--muted)]">
                  AI下書きなし
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
