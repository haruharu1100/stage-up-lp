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

/*
 * ═══════════════════════════════════════════════
 * ★なぜ、この21枚を「先に作っておく」のをやめたのか
 * ═══════════════════════════════════════════════
 *
 *   以前は、21画面を事前に作っておいて配っていました（速いので）。
 *   ですが、事前に作るということは、
 *   ★誰が開いても同じ中身を返す、ということです。
 *
 *   ログインしているかどうかを、サーバーで確かめられません。
 *   確かめられるのはブラウザに届いたあと、つまり
 *   中身を渡し終わったあとです。それでは鍵になりません。
 *
 *   だから、1回ごとにサーバーで確かめてから作ります。
 *   表示は少し遅くなります。それでも、
 *   ログインしていない人に管理画面を渡さないほうを取ります。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ClientConsole from "@/components/console/ClientConsole";
import NoPermission from "@/components/console/NoPermission";
import { keyOfSlug, menuItem } from "@/components/console/menu";
import { requireAdmin } from "@/lib/server/pageAuth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export default async function Page({
  params,
  searchParams,
}: {
  params: { screen: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const key = keyOfSlug(params.screen);

  /* ★知らないURLは、先に 404 にすること。
       ログインを求めてから 404 を出すと、
       「どの画面名が存在するか」を、ログインできる人以外にも
       試させることになります。 */
  if (!key) notFound();

  /*
   * ★ここが鍵です。
   *   ログインしていなければ、この行より先へは進みません。
   *   中身はブラウザへ1バイトも送られません。
   *
   * ★戻り先には「?」の後ろも付けること。
   *   未発送だけを絞り込んで見ていた人を一覧の先頭へ返すと、
   *   毎回そこから絞り込み直しになります。
   */
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") query.set(k, v);
    else if (Array.isArray(v)) for (const one of v) query.append(k, one);
  }
  const qs = query.toString();
  const here = `/client-demo/${params.screen}${qs ? `?${qs}` : ""}`;

  const { user } = await requireAdmin(here);

  /*
   * ═══════════════════════════════════════════════
   * ★役割で開ける画面を分けるのも、ここで行うこと
   * ═══════════════════════════════════════════════
   *
   *   左メニューでは、開けない項目を灰色にしています。
   *   それは親切のためであって、守りではありません。
   *
   *   灰色になっていても、URLを直接打てば開けます。
   *   そのURLは、前に見た人のブラウザの履歴にも、
   *   社内チャットに貼られたリンクにも残っています。
   *   「押せないから見られない」は成り立ちません。
   *
   *   ★断るのは、中身を作る前。
   *     ClientConsole を返してから画面の中で判定すると、
   *     中身はすでにブラウザへ届いています。
   */
  const item = menuItem(key);
  if (item.need && !can(user.role, item.need)) {
    return <NoPermission screenLabel={item.label} role={user.role} />;
  }

  /* ★画面のキーをURLから渡すこと。
       ここで決め打ちにすると、どのURLを開いても同じ画面になります。 */
  return <ClientConsole initialPage={key} me={user} />;
}
