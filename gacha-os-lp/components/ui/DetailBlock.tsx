"use client";

/**
 * セクションまるごとを畳んでおく箱。
 *
 * なぜ要るか：
 *   機能を減らさずにページを短くするため。
 *   買う人が最初に読むのは「売る話」で、
 *   「どこまでやってくれるのか」「安全なのか」といった細かい話は、
 *   気になった人だけが開けばいい。消してはいけないが、常時見せる必要もない。
 *
 * 使うときの決まり：
 *   ・中に入れるセクションの id を、必ず ids に書くこと。
 *     ヘッダーやフッターのリンク（#scope など）で飛んできたときに、
 *     ここが閉じたままだと「リンクが効かない」不具合になります。
 *     ids に書いてあれば、自動で開いてその位置まで送ります。
 *   ・閉じているあいだ、中身は本当に画面に無い状態にしています。
 *     中の3Dも動かないので、その分ページが軽くなります。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";

export default function DetailBlock({
  label,
  note,
  ids = [],
  children,
}: {
  /** 閉じているときに出る一行。何が入っているかが分かる言葉にすること */
  label: string;
  /** その下に出る補足。無くてもよい */
  note?: string;
  /** この中に入っているセクションの id（リンクで飛んできたとき用） */
  ids?: string[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  /**
   * ★ids は呼び出し側で毎回新しい配列が作られるため、
   *   そのまま依存に入れると毎描画でイベントを付け直すことになります。
   *   中身を文字列にしてから比べます。
   */
  const key = ids.join(",");

  const openIfMine = useCallback(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash || !key.split(",").includes(hash)) return;
    setOpen(true);
    // 開いてから位置を測らないと、閉じた高さのまま送ってしまう
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ block: "start" });
      });
    });
  }, [key]);

  useEffect(() => {
    openIfMine();
    window.addEventListener("hashchange", openIfMine);
    return () => window.removeEventListener("hashchange", openIfMine);
  }, [openIfMine]);

  return (
    <>
      <section className="relative bg-paper">
        <div className="container-x py-9 sm:py-14">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between gap-5 rounded-2xl border border-edge bg-white px-6 py-6 text-left transition-colors hover:border-blue-ink/30 sm:px-8 sm:py-7"
          >
            <span className="min-w-0">
              <span className="num block text-label text-blue-ink">
                MORE DETAIL
              </span>
              <span className="h-display mt-2 block text-h3 text-balance text-slate">
                {label}
              </span>
              {note && (
                <span className="mt-2 block text-note text-pretty text-slate2">
                  {note}
                </span>
              )}
            </span>
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge text-slate2 transition-transform duration-300 ${
                open ? "rotate-180" : ""
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </div>
      </section>

      {/*
        ★中身は「消す」のではなく「隠す」こと。
          消してしまうと、検索エンジンにもAIにも本文が読まれなくなります。
          隠しているあいだは画面に出ないので、中の3Dも動きません。
      */}
      <div hidden={!open}>{children}</div>
    </>
  );
}
