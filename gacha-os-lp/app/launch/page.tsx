import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import LaunchBoard from "@/components/launch/LaunchBoard";
import {
  buildChecklist,
  launchSummary,
  STAGE_LABEL,
  STAGE_ORDER,
} from "@/lib/readiness";

export const metadata: Metadata = {
  title: "公開前チェック｜AI GACHA OS",
  description: "公開してよい状態かどうかを確認する管理者用の画面です。",
  robots: { index: false, follow: false, nocache: true },
};

/** 環境変数の状態をその場で読むため、事前生成しない */
export const dynamic = "force-dynamic";

export default function LaunchPage({
  searchParams,
}: {
  searchParams?: { key?: string };
}) {
  /**
   * 管理者用の画面なので、合言葉（LAUNCH_KEY）を設定していれば
   * URLに ?key=（合言葉）が付いていない限り中身を出さない。
   * 未設定のときは開けるが、画面上で設定を促す。
   */
  const gate = process.env.LAUNCH_KEY?.trim();
  const allowed = !gate || searchParams?.key === gate;

  const items = buildChecklist(process.env);
  const summary = launchSummary(items);

  return (
    <div className="min-h-screen bg-void">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-void/90 backdrop-blur-xl">
        <div className="container-x flex h-14 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo className="h-6 w-6 shrink-0" />
            <span className="num shrink-0 text-[12px] font-bold tracking-[0.16em]">
              AI GACHA <span className="text-gradient-blue">OS</span>
            </span>
            <span className="num hidden shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[9.5px] tracking-[0.14em] text-white/40 sm:inline">
              LAUNCH READINESS
            </span>
          </div>
          <Link
            href="/"
            className="num shrink-0 text-[11px] text-white/40 transition-colors hover:text-white/80"
          >
            ← サイトへ戻る
          </Link>
        </div>
      </header>

      <main className="container-x py-8 sm:py-12">
        <h1 className="h-display text-[22px] leading-[1.4] sm:text-[30px] sm:leading-[1.3]">
          公開してよい状態かを確認する
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-[2] text-mute">
          公開前に必ずこの画面を開いてください。
          <span className="text-white/80">
            必須の項目が1つでも埋まっていない場合、このサイトは公開できません。
          </span>
          自動で判定できない項目（規約・スマホ表示など）は、確認したうえで手動でチェックを付けてください。
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.95] text-white/45">
          外部サービスへのつなぎ方と、確認のしかたは
          <span className="num text-white/70"> docs/本番接続手順.md </span>
          に手順としてまとめてあります。
        </p>

        {allowed && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="num text-[10px] tracking-[0.2em] text-white/40">
                LAUNCH SUMMARY
              </span>
              <span className="num text-[10px] text-white/30">
                {summary.filter((r) => r.ready).length} / {summary.length} 完了
              </span>
            </div>
            <p className="mt-3 text-[11.5px] leading-[1.95] text-white/45">
              1項目につき
              <span className="num text-white/70"> IMPLEMENTED / CONNECTED / E2E VERIFIED </span>
              の3段階で見ます。3つそろって初めて完了です。
              <span className="block text-white/35">
                ここはサーバー側で分かる範囲の状態です。目視確認の反映は下のボードをご覧ください。
              </span>
            </p>
            <div className="mt-5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {summary.map((r) => (
                <div
                  key={r.name}
                  className={`rounded-xl border px-3.5 py-2.5 ${
                    r.ready
                      ? "border-ok/30 bg-ok/[0.06]"
                      : "border-white/10 bg-white/[0.02]"
                  }`}
                  title={
                    r.pending.length > 0 ? `未完了：${r.pending.join(" / ")}` : "完了"
                  }
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`num text-[12px] ${r.ready ? "text-ok" : "text-white/30"}`}
                    >
                      {r.ready ? "✓" : "—"}
                    </span>
                    <span className="num truncate text-[11px] text-white/70">
                      {r.name}
                    </span>
                    {r.required && (
                      <span className="num ml-auto shrink-0 text-[8.5px] tracking-[0.1em] text-white/25">
                        必須
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex gap-1">
                    {STAGE_ORDER.map((s) => (
                      <span
                        key={s}
                        title={STAGE_LABEL[s]}
                        className={`h-1 flex-1 rounded-full ${
                          r.stages[s] === "ok"
                            ? "bg-ok/70"
                            : r.stages[s] === "todo"
                              ? "bg-danger/60"
                              : "bg-white/10"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          {allowed ? (
            <LaunchBoard items={items} />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8">
              <p className="num text-[10px] tracking-[0.2em] text-white/35">LOCKED</p>
              <p className="mt-3 text-[14px] font-bold text-ink">
                この画面は管理者専用です。
              </p>
              <p className="mt-2.5 text-[12px] leading-[1.95] text-white/50">
                合言葉つきのURL（末尾に <span className="num">?key=…</span>）でお開きください。
              </p>
            </div>
          )}
        </div>

        {allowed && !gate && (
          <p className="mt-6 rounded-xl border border-warn/25 bg-warn/[0.06] px-5 py-4 text-[11.5px] leading-[1.95] text-white/60">
            この画面は現在、URLを知っていれば誰でも開ける状態です。検索には出ませんが、
            環境変数 <span className="num">LAUNCH_KEY</span> に合言葉を設定すると、
            <span className="num"> ?key=（合言葉）</span> 付きのURL以外では開けなくなります。
          </p>
        )}

        <p className="mt-8 text-[11px] leading-[1.9] text-white/35">
          この画面は検索エンジンに登録されません。手動チェックの状態は、いまお使いの端末のブラウザにのみ保存されます。
        </p>
      </main>
    </div>
  );
}
