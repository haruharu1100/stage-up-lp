/**
 * 管理画面の各ページ（/client-demo/<画面名>）。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ1画面ずつURLを分けるのか
 * ═══════════════════════════════════════════════
 *
 *   これまでは /client-demo 1本で、中身だけを差し替えていました。
 *   見た目は動きますが、次のことが全部できません。
 *
 *       URLを直接開く／更新する／戻る／進む／
 *       ブックマークする／人に送る
 *
 *   毎日この画面で仕事をする人にとって、これは「不便」ではありません。
 *   朝いちばんに見る発送の画面を、ブックマークしておけないということです。
 *   困ったときに「この画面を見てください」とURLを送れないということです。
 *   更新したら、必ず最初の画面に戻ってしまうということです。
 *
 *   だから、21画面すべてに、それぞれのURLを持たせます。
 *
 * ═══════════════════════════════════════════════
 * ★知らないURLを、黙って別の画面にしないこと
 * ═══════════════════════════════════════════════
 *
 *   打ち間違えた人を、何も言わずにダッシュボードへ送ると、
 *   その人は「自分は正しいURLを開いた」と思ったまま、
 *   別の画面を見ることになります。
 *   知らないURLは、はっきり「ありません」と出します。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ClientConsole from "@/components/console/ClientConsole";
import { MENU, SLUG, keyOfSlug, menuItem } from "@/components/console/menu";

/** 21画面ぶんを、あらかじめ作っておく */
export function generateStaticParams() {
  return MENU.map((m) => ({ screen: SLUG[m.key] }));
}

/* ★知らないURLは、この一覧に無いので 404 にすること */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: { screen: string };
}): Promise<Metadata> {
  const key = keyOfSlug(params.screen);
  if (!key) return { title: "ページが見つかりません", robots: { index: false } };
  const item = menuItem(key);

  return {
    title: `${item.label}｜契約者向け管理画面（デモ）`,
    description: `${item.label}：${item.note}`,
    /* ★検索には出しません。
         本物の管理画面と見た目がほとんど同じなので、
         検索から迷い込んだ方が本物と誤解するのを防ぎます。 */
    robots: { index: false, follow: false },
  };
}

export default function Page({ params }: { params: { screen: string } }) {
  const key = keyOfSlug(params.screen);
  if (!key) notFound();

  /* ★画面のキーをURLから渡すこと。
       ここで決め打ちにすると、どのURLを開いても同じ画面になります。 */
  return <ClientConsole initialPage={key} />;
}
