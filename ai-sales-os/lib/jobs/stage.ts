import { one } from '../db/client';
import { REAL_SQL } from '../origin';

/**
 * 本物の案件が何件そろったら「正式なTOP5」と呼んでよいか。
 * ★20件に届くまでは、いくら点数が高くても「暫定」と書く。
 */
export const REQUIRED_MIN_REAL = 20;

/**
 * いま出している案件TOP5が「暫定」なのか「正式」なのかを、1か所で決める。
 *
 * ★なぜ1か所にするか。
 *   同じ5件が、トップ画面・案件TOP5の資料・取り込み後のメッセージの3か所に出る。
 *   3か所で別々に「20件以上かどうか」を書くと、必ずどこかが古いままになる。
 *   古いほうを見た人は、暫定の順位を確定と思って1件目を出してしまう。
 *
 * ★件数を揃えるために基準は下げない。
 *   足りないときは足りないと書く。5件に見せるために監査の基準をゆるめることはしない。
 *
 * ★0件のときも「0件」と書く。ここは数えた結果の0なので、0でよい。
 *   （予想利益や時給のように「計算できない」ものを0にしてはいけないのとは別の話。）
 */

export type Top5Stage = {
  /** 本物（REAL）の案件の数。練習用（TEST）は1件も入っていない。 */
  realTotal: number;
  /** 正式に切り替わる件数。 */
  required: number;
  /** 正式かどうか。false なら暫定。 */
  official: boolean;
  /** 画面の見出しに出す言葉。「暫定TOP5」または「正式TOP5」。 */
  headingJa: string;
  /** 見出しの横に必ず添える一言。「暫定：REAL案件◯件中」。 */
  badgeJa: string;
  /** なぜ暫定なのか／なぜ正式なのかの説明。 */
  noteJa: string;
};

/** 件数から段階を組み立てる（DBを見ない純粋な計算。テストしやすいように分けてある）。 */
export function top5StageOf(realTotal: number, required: number = REQUIRED_MIN_REAL): Top5Stage {
  const n = Math.max(0, Math.trunc(realTotal));
  const official = n >= required;
  return {
    realTotal: n,
    required,
    official,
    headingJa: official ? '正式TOP5' : '暫定TOP5',
    // ★「暫定：REAL案件◯件中」という言い方を、この1行に固定する。
    badgeJa: official ? `正式：REAL案件${n}件中` : `暫定：REAL案件${n}件中`,
    noteJa: official
      ? `本物の案件が${n}件（${required}件以上）そろっているので、この順位は正式なものとして見てよい段階です。`
      : `本物の案件が${n}件しかなく、${required}件に${required - n}件足りません。`
        + 'いま入っているぶんだけで並べた暫定の順位なので、案件が増えると入れ替わります。'
        + '件数を揃えるために基準は下げていません。',
  };
}

/** いまのDBの中身から段階を出す。 */
export async function top5Stage(): Promise<Top5Stage> {
  const realTotal = Number((await one(`SELECT COUNT(*) AS n FROM jobs WHERE ${REAL_SQL}`))?.n ?? 0);
  return top5StageOf(realTotal);
}
