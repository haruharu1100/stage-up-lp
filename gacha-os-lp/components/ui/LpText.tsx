/**
 * 編集画面（/admin/lp-content）で直した文章を、実際の画面に出す部品。
 *
 * ★やっていること
 *   1. その項目が「非表示」なら、何も出さない
 *   2. 改行（Enter）を、そのまま画面の改行にする
 *   3. PC用とスマホ用で別の改行が指定されていたら、両方を書き出して
 *      CSSで出し分ける（640px未満はスマホ用）
 *   4. 用語（オンラインガチャ・実還元率など）が語の途中で割れないようにする
 *
 * ★なぜ両方を書き出すのか
 *   画面幅で出し分けるのに JavaScript を使うと、
 *   サーバーが作った画面とブラウザが作った画面が食い違い、
 *   一瞬だけ違う文字が見えたり、警告が出たりします。
 *   両方を書き出してCSSで隠すのが、いちばん確実です。
 *   （隠れているほうは読み上げにも出ないよう aria-hidden を付けています）
 */

import { Fragment } from "react";
import { jp } from "@/lib/jp";
import { lpText, type LpValue } from "@/lib/lpText";

/** 改行を <br> に変える。用語の保護もここでかける */
function lines(text: string) {
  return text.split("\n").map((line, i, all) => (
    <Fragment key={i}>
      {jp(line)}
      {i < all.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

type Props = {
  /** lib/lpText.ts の LP_FIELDS にある id */
  id: string;
  /** コード側の元の文章。編集されていなければこれが出ます */
  fallback: string;
  /**
   * スマホ用の元の文章。
   * 元から「PCだけ改行する」書き方をしていた場所で、見え方を変えないために使います。
   */
  fallbackSp?: string;
  /** 出したいタグ。既定は <span> */
  as?: "span" | "p" | "h1" | "h2" | "h3" | "div";
  className?: string;
  /** 編集画面のプレビュー用。ふだんは渡しません */
  values?: Record<string, LpValue>;
};

export default function LpText({
  id,
  fallback,
  fallbackSp,
  as: Tag = "span",
  className,
  values,
}: Props) {
  const t = lpText(id, fallback, values);
  if (t.hidden) return null;

  /* 編集されていないときは、元からあったスマホ用の書き方を尊重する */
  const untouched = t.pc === fallback && t.sp === fallback;
  const sp = untouched && fallbackSp !== undefined ? fallbackSp : t.sp;

  // PCとスマホで同じなら、1つだけ書けばよい
  if (t.pc === sp) {
    return <Tag className={className}>{lines(t.pc)}</Tag>;
  }

  return (
    <Tag className={className}>
      <span className="sm:hidden">{lines(sp)}</span>
      <span aria-hidden className="hidden sm:inline">
        {lines(t.pc)}
      </span>
    </Tag>
  );
}

/**
 * ボタンの文字のように「タグを増やしたくない」場所で使う。
 * 改行は入れられません（ボタンの中で改行させないため）。
 */
export function lpLabel(
  id: string,
  fallback: string,
  values?: Record<string, LpValue>,
): { text: string; hidden: boolean } {
  const t = lpText(id, fallback, values);
  return { text: jp(t.pc.replace(/\n/g, " ")), hidden: t.hidden };
}

/** スマホ用の短いボタン文字。無ければ PC 用と同じ */
export function lpLabelSp(
  id: string,
  fallback: string,
  values?: Record<string, LpValue>,
): { text: string; hidden: boolean } {
  const t = lpText(id, fallback, values);
  return { text: jp(t.sp.replace(/\n/g, " ")), hidden: t.hidden };
}
