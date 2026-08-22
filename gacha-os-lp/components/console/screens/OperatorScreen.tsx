/**
 * AI オペレーター。
 *
 * ═══════════════════════════════════════════════
 * ★この画面が返すべき答え
 * ═══════════════════════════════════════════════
 *
 *   運営者が朝いちばんに知りたいのは、
 *   「昨日の売上」ではなく「今日、自分は何をすればいいのか」です。
 *
 *   だから、数字の要約だけを出しません。
 *   ・いま何が起きているか
 *   ・そのうち、放っておくと損になるものはどれか
 *   ・最初にどれをやるべきか
 *   を、順番に並べて出します。
 *
 * ★AIに、勝手に実行させないこと。
 *   この画面のボタンは「その画面へ移動する」だけです。
 *   販売停止も、登録の遮断も、ポイントの変更も、
 *   人が自分の目で見てから押します。
 *
 * ★分からないことを「問題なし」と書かないこと。
 *   データが取れていない項目は「分かりません」と出します。
 *   安全側に倒したつもりで「異常なし」と書くのが、いちばん危険です。
 */

"use client";

import type { ConsoleState } from "@/lib/console/state";
import { summary, todayTodos } from "@/lib/console/state";
import type { MenuKey } from "../menu";
import { Badge, Btn, Card, DemoNote, WhatIsThis } from "../ui";

export default function OperatorScreen({
  s,
  onNav,
}: {
  s: ConsoleState;
  onNav: (k: MenuKey) => void;
}) {
  const sm = summary(s);
  const todos = todayTodos(s);
  const must = todos.filter((t) => t.urgency === "MUST");
  const should = todos.filter((t) => t.urgency === "SHOULD");

  return (
    <>
      <WhatIsThis>
        いまの状況を、
        <strong className="font-bold text-slate">やるべき順に並べて</strong>
        お伝えします。ここから実行はしません。移動するだけです。
      </WhatIsThis>

      {/* ── 今日のまとめ ── */}
      <Card title="今日のご報告" note={`${s.me?.name ?? ""} さん向け。2026-08-22 12:00 時点。`}>
        <div className="space-y-4">
          <p className="text-note leading-[2] text-slate2">
            いま販売中のガチャは
            <strong className="font-bold text-slate"> {sm.publishedCount}本 </strong>
            です。本日の売上は
            <span className="num font-bold text-slate"> {sm.revenueToday.toLocaleString()}円</span>
            、引かれた回数は
            <span className="num font-bold text-slate"> {sm.playsToday.toLocaleString()}回</span>
            でした。
          </p>

          {must.length === 0 ? (
            <p className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-4 text-note font-bold leading-[1.9] text-ok-ink">
              今日、急いで対応が必要なものはありません。
              未発送と問い合わせだけ、お時間のあるときにご確認ください。
            </p>
          ) : (
            <p className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-4 text-note font-bold leading-[1.9] text-danger-ink">
              今日は、先に見ていただきたいものが {must.length}件 あります。
              放っておくと、損が増えるか、お客様をお待たせします。
            </p>
          )}
        </div>
      </Card>

      {/* ── 順番 ── */}
      <Card title="この順にやるのがおすすめです" note="上から片づけると、いちばん損が小さくなります。">
        {todos.length === 0 ? (
          <p className="text-note text-slate3">やることはありません。</p>
        ) : (
          <ol className="space-y-3">
            {[...must, ...should].map((t, i) => (
              <li
                key={`${t.to}-${t.label}`}
                className={`rounded-xl border px-4 py-4 ${
                  t.urgency === "MUST"
                    ? "border-danger/30 bg-danger/8"
                    : "border-warn/35 bg-warn/8"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex flex-wrap items-center gap-3 text-note font-bold text-slate">
                    <span className="num inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge bg-paper text-slate2">
                      {i + 1}
                    </span>
                    {t.label}
                    <span className="num">{t.count}件</span>
                  </p>
                  <Badge tone={t.urgency === "MUST" ? "danger" : "warn"}>
                    {t.urgency === "MUST" ? "今日中" : "できれば今日"}
                  </Badge>
                </div>
                <p className="mt-2 text-note leading-[1.9] text-slate2">{why(t.to)}</p>
                <div className="mt-3">
                  <Btn onClick={() => onNav(t.to as MenuKey)}>この画面へ</Btn>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* ── 分からないもの ── */}
      <Card title="いま分かっていないこと" note="推測で埋めず、そのまま出しています。">
        <ul className="space-y-3">
          <li className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-note font-bold text-slate">一部の景品の相場</span>
              <Badge>分かりません</Badge>
            </div>
            <p className="mt-1 text-note leading-[1.85] text-slate3">
              相場の取得が今朝から止まっている景品があります。
              その分の還元率は、古い値のままです。
              ★「問題なし」とは表示しません。分からないものは分からないと出します。
            </p>
          </li>
        </ul>
      </Card>

      <DemoNote>
        この画面は、状況を読んで順番を並べるところまでを行います。
        販売停止・登録の遮断・ポイントの変更は、必ず人が押します。
        AIが勝手に実行することはありません。
      </DemoNote>
    </>
  );
}

/** なぜ、それを先にやるのか */
function why(to: string): string {
  switch (to) {
    case "gacha":
      return "景品の相場が上がっているため、売れるほど赤字が増えます。止めるかどうかを先に決めてください。";
    case "fraud":
      return "新規登録に、重なった手がかりが出ています。特典目当ての大量登録が通ると、その分だけ持っていかれます。";
    case "support":
      return "AIが答えられなかった問い合わせです。返金や不正判定に関わるものなので、人が読む必要があります。";
    case "points":
      return "ポイントの変更が承認待ちです。承認されるまで1ptも動きません。止まったままになります。";
    case "shipping":
      return "お客様をお待たせしています。件数が多いので、まとめて片づけるのが早いです。";
    default:
      return "ご確認ください。";
  }
}
