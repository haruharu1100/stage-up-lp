import Link from "next/link";
import { BRAND, IS_TEST_MODE } from "@/config/brand";
import {
  todayStats,
  quotas,
  pendingApprovals,
  actionLog,
  tiles,
} from "@/lib/mock";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "おつかれさまです";
  if (h < 11) return "おはようございます";
  if (h < 18) return "こんにちは";
  return "こんばんは";
}

function today(): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}

const actorLabel = { human: "手動", system: "自動" } as const;
const typeLabel = { post: "投稿", reply: "返信", like: "いいね" } as const;

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-24">
      {/* アカウント色のヘッダー帯（誤爆防止の要） */}
      <header
        className="-mx-4 mb-5 px-4 pb-4 pt-6"
        style={{ background: BRAND.accentSoft }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[color:var(--muted)]">{today()}</p>
            <h1 className="font-serif text-2xl">{greeting()}</h1>
          </div>
          <Link
            href="/connect"
            className="rounded-full px-3 py-1 text-xs font-medium text-white"
            style={{ background: BRAND.accent }}
          >
            @{BRAND.handle}
          </Link>
        </div>
        <p className="mt-1 text-sm text-[color:var(--muted)]">{BRAND.tagline}</p>
        {IS_TEST_MODE && (
          <p className="mt-2 inline-block rounded bg-ink/80 px-2 py-0.5 text-[11px] text-milk">
            TESTモード（外部に投稿されません）
          </p>
        )}
      </header>

      {/* 承認待ちバナー */}
      {pendingApprovals > 0 && (
        <a
          href="#"
          className="mb-4 flex items-center justify-between rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] px-4 py-3"
          style={{ borderColor: BRAND.accent }}
        >
          <span className="text-sm">
            <span className="font-num font-semibold" style={{ color: BRAND.accent }}>
              {pendingApprovals}
            </span>{" "}
            件が承認待ちです
          </span>
          <span className="text-lg" style={{ color: BRAND.accent }}>
            ›
          </span>
        </a>
      )}

      {/* 今日の動き */}
      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-[color:var(--muted)]">
          今日の動き
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {todayStats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-3"
            >
              <p className="text-xs text-[color:var(--muted)]">{s.label}</p>
              <p className="font-num text-2xl font-semibold">
                {s.value.toLocaleString()}
              </p>
              <p
                className={`text-xs ${
                  s.delta >= 0 ? "text-emerald-600" : "text-rose-500"
                }`}
              >
                {s.delta >= 0 ? "▲" : "▼"} {Math.abs(s.delta)} 前日比
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* やること6タイル */}
      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-[color:var(--muted)]">
          やること
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {tiles.map((t) => (
            <a
              key={t.key}
              href={t.href}
              className="relative flex aspect-square flex-col items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] text-center text-sm"
            >
              {t.badge ? (
                <span
                  className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-num text-[11px] text-white"
                  style={{ background: BRAND.accent }}
                >
                  {t.badge}
                </span>
              ) : null}
              {t.label}
            </a>
          ))}
        </div>
      </section>

      {/* 今日の残り枠 */}
      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-[color:var(--muted)]">
          今日の残り枠
        </h2>
        <div className="space-y-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4">
          {quotas.map((q) => {
            const pct = Math.min(100, Math.round((q.used / q.limit) * 100));
            return (
              <div key={q.label}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{q.label}</span>
                  <span className="font-num text-[color:var(--muted)]">
                    {q.used} / {q.limit}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[color:var(--line)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: BRAND.accent }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 実行ログのタイムライン */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-[color:var(--muted)]">
          実行ログ
        </h2>
        <ol className="space-y-2">
          {actionLog.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] px-3 py-2"
            >
              <span className="font-num text-xs text-[color:var(--muted)] pt-0.5">
                {a.time}
              </span>
              <div className="min-w-0">
                <p className="text-sm">{a.text}</p>
                <p className="text-[11px] text-[color:var(--muted)]">
                  {typeLabel[a.type]} ・ {actorLabel[a.actor]}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
