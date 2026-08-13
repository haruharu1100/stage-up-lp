"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 加重文字数（全角=2, 半角=1）。非プレミアムXの上限は加重280。
function weightedLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    n += ch.charCodeAt(0) <= 0x7f ? 1 : 2;
  }
  return n;
}

const LIMIT = 280;

export default function PostComposer({
  accent,
  suggestions,
}: {
  accent: string;
  suggestions: string[];
}) {
  const router = useRouter();
  const [bodies, setBodies] = useState<string[]>([""]);
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const overLimit = bodies.some((b) => weightedLength(b) > LIMIT);
  const empty = bodies.every((b) => b.trim() === "");

  function setBody(i: number, v: string) {
    setBodies((prev) => prev.map((b, idx) => (idx === i ? v : b)));
  }
  function addTweet() {
    setBodies((prev) => [...prev, ""]);
  }
  function removeTweet(i: number) {
    setBodies((prev) => prev.filter((_, idx) => idx !== i));
  }
  function fillSuggestion(text: string) {
    // AI/テンプレは必ず編集画面に入れる（ワンタップ投稿は作らない）
    setBodies((prev) => {
      const next = [...prev];
      const target = next.findIndex((b) => b.trim() === "");
      if (target >= 0) next[target] = text;
      else next.push(text);
      return next;
    });
  }

  async function submit(status: "draft" | "scheduled") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bodies,
          status,
          scheduled_at:
            status === "scheduled" && scheduledAt
              ? new Date(scheduledAt).toISOString()
              : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "保存に失敗しました");
      } else {
        setMsg(status === "scheduled" ? "予約しました" : "下書きを保存しました");
        setBodies([""]);
        setSchedule(false);
        setScheduledAt("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
      {bodies.map((b, i) => {
        const w = weightedLength(b);
        return (
          <div key={i} className="mb-3">
            {bodies.length > 1 && (
              <div className="mb-1 flex items-center justify-between text-xs text-[color:var(--muted)]">
                <span>スレッド {i + 1} 件目</span>
                <button
                  onClick={() => removeTweet(i)}
                  className="text-rose-500"
                  type="button"
                >
                  削除
                </button>
              </div>
            )}
            <textarea
              value={b}
              onChange={(e) => setBody(i, e.target.value)}
              rows={4}
              placeholder="いまどうしてる？"
              className="w-full resize-none rounded-lg border border-[color:var(--line)] bg-transparent p-3 text-sm outline-none focus:border-[color:var(--accent)]"
            />
            <div
              className={`mt-1 text-right text-xs ${
                w > LIMIT ? "text-rose-500" : "text-[color:var(--muted)]"
              }`}
            >
              加重 {w} / {LIMIT}
            </div>
          </div>
        );
      })}

      <button
        onClick={addTweet}
        type="button"
        className="mb-4 text-sm"
        style={{ color: accent }}
      >
        ＋ スレッドに追加
      </button>

      {/* 予約 */}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={schedule}
          onChange={(e) => setSchedule(e.target.checked)}
        />
        日時を予約する
      </label>
      {schedule && (
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="mb-3 w-full rounded-lg border border-[color:var(--line)] bg-transparent p-2 text-sm"
        />
      )}

      {msg && <p className="mb-3 text-sm" style={{ color: accent }}>{msg}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => submit("draft")}
          disabled={busy || empty || overLimit}
          type="button"
          className="flex-1 rounded-lg border border-[color:var(--line)] py-2 text-sm disabled:opacity-40"
        >
          下書き保存
        </button>
        <button
          onClick={() => submit("scheduled")}
          disabled={busy || empty || overLimit || !schedule || !scheduledAt}
          type="button"
          className="flex-1 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-40"
          style={{ background: accent }}
        >
          予約する
        </button>
      </div>

      {/* ネタ供給パネル */}
      <div className="mt-5 border-t border-[color:var(--line)] pt-4">
        <p className="mb-2 text-xs font-medium text-[color:var(--muted)]">
          ネタ供給（タップで編集欄に入ります）
        </p>
        <div className="space-y-2">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => fillSuggestion(s)}
              type="button"
              className="block w-full rounded-lg border border-[color:var(--line)] p-2 text-left text-xs leading-relaxed hover:border-[color:var(--accent)]"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
