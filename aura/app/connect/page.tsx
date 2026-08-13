import Link from "next/link";
import { BRAND, IS_TEST_MODE } from "@/config/brand";
import { getConnectedProfiles } from "@/lib/x/connected";
import { X_SCOPES } from "@/lib/x/oauth";

export const dynamic = "force-dynamic";

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { profiles, error } = await getConnectedProfiles();

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-24">
      <header
        className="-mx-4 mb-5 px-4 pb-4 pt-6"
        style={{ background: BRAND.accentSoft }}
      >
        <Link href="/" className="text-sm text-[color:var(--muted)]">
          ‹ ホーム
        </Link>
        <h1 className="font-serif text-2xl">アカウント接続</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Xアカウントを接続すると、投稿・返信ができるようになります。
        </p>
        {IS_TEST_MODE && (
          <p className="mt-2 inline-block rounded bg-ink/80 px-2 py-0.5 text-[11px] text-milk">
            TESTモード（実際のXには接続しません／疑似データ）
          </p>
        )}
      </header>

      {sp.connected === "1" && (
        <p className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          接続が完了しました。
        </p>
      )}
      {(sp.error || error) && (
        <p className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          接続でエラーが発生しました：{sp.error || error}
        </p>
      )}

      {/* 接続済みプロフィール */}
      {profiles.length > 0 ? (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-medium text-[color:var(--muted)]">
            接続済み
          </h2>
          {profiles.map((p) => (
            <div
              key={p.username}
              className="flex items-center gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4"
              style={{ borderColor: BRAND.accent }}
            >
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-lg font-semibold text-white"
                style={{ background: BRAND.accent }}
              >
                {p.profileImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.profileImageUrl}
                    alt={p.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  p.name.slice(0, 1)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="truncate text-sm text-[color:var(--muted)]">
                  @{p.username}
                </p>
              </div>
              <div className="text-right">
                <p className="font-num text-lg font-semibold">
                  {p.followers.toLocaleString()}
                </p>
                <p className="text-[11px] text-[color:var(--muted)]">
                  フォロワー
                </p>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="mb-6 rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-6 text-center">
          <p className="text-sm text-[color:var(--muted)]">
            まだアカウントが接続されていません。
          </p>
        </section>
      )}

      {/* 接続ボタン */}
      <a
        href="/api/connect/x/start"
        className="flex w-full items-center justify-center rounded-xl px-4 py-3 font-medium text-white"
        style={{ background: BRAND.accent }}
      >
        {profiles.length > 0 ? "別のアカウントを接続" : "Xと接続する"}
      </a>

      <p className="mt-4 text-[11px] leading-relaxed text-[color:var(--muted)]">
        取得する権限：{X_SCOPES.join(" / ")}
        <br />
        トークンは暗号化して保存され、期限が切れる前に自動更新されます。
      </p>
    </main>
  );
}
