"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/types";

type Tab = "draft" | "scheduled" | "published";

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function PostBoard({
  accent,
  drafts,
  scheduled,
  published,
}: {
  accent: string;
  drafts: Post[];
  scheduled: Post[];
  published: Post[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("draft");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const map: Record<Tab, Post[]> = {
    draft: drafts,
    scheduled,
    published,
  };
  const labels: Record<Tab, string> = {
    draft: `下書き (${drafts.length})`,
    scheduled: `予約 (${scheduled.length})`,
    published: `公開済み (${published.length})`,
  };

  async function publishNow(id: string) {
    setBusyId(id);
    setNote(null);
    try {
      const res = await fetch(`/api/posts/${id}/publish`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setNote("公開しました");
        router.refresh();
      } else {
        setNote(`公開できません：${data.reason ?? "不明"}`);
      }
    } finally {
      setBusyId(null);
    }
  }

  const list = map[tab];

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {(Object.keys(labels) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            type="button"
            className="rounded-full px-3 py-1 text-xs"
            style={
              tab === t
                ? { background: accent, color: "#fff" }
                : { border: "1px solid var(--line)" }
            }
          >
            {labels[t]}
          </button>
        ))}
      </div>

      {note && (
        <p className="mb-3 text-sm" style={{ color: accent }}>
          {note}
        </p>
      )}

      {list.length === 0 ? (
        <p className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4 text-center text-sm text-[color:var(--muted)]">
          {tab === "draft"
            ? "下書きはありません"
            : tab === "scheduled"
              ? "予約はありません"
              : "公開済みの投稿はありません"}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-3"
            >
              <p className="whitespace-pre-wrap text-sm">{p.body}</p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[color:var(--muted)]">
                <span>
                  {tab === "scheduled" && p.scheduled_at
                    ? `予約: ${fmt(p.scheduled_at)}`
                    : tab === "published" && p.published_at
                      ? `公開: ${fmt(p.published_at)}`
                      : `作成: ${fmt(p.created_at)}`}
                  {p.thread_order !== null && p.thread_order > 0
                    ? `（スレッド${p.thread_order + 1}）`
                    : ""}
                </span>
                {tab !== "published" && (
                  <button
                    onClick={() => publishNow(p.id)}
                    disabled={busyId === p.id}
                    type="button"
                    className="rounded-full px-3 py-1 text-white disabled:opacity-40"
                    style={{ background: accent }}
                  >
                    今すぐ公開
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
