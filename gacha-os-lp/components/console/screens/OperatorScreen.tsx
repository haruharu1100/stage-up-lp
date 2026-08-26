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
import { NOW, summary, todayTodos } from "@/lib/console/state";
import { liveTodos, useLiveCounts } from "@/lib/console/liveCounts";
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

  /**
   * 「未発送は何件？」「今日の注文は？」に、実データで答える（#29）。
   *
   * ★ここを見本の数で答えないこと。
   *   人は、AIが言った数を確かめずに使います。
   *   確かめられない数を自信たっぷりに言うのが、いちばん危険です。
   *
   * ★数えられなかったときは「分かりません」と言うこと。
   *   0件と答えてしまうと、放置が起きます。
   */
  const live = useLiveCounts();
  const todos = [...todayTodos(s), ...liveTodos(live)];
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
      <Card title="今日のご報告" note={`${s.me?.name ?? ""} さん向け。${NOW} 時点。`}>
        <div className="space-y-4">
          {/*
            ★売上・回数・販売中の本数は、まだ見本の数字です。
              集計につながっていません。

              ここを、下の「注文と発送」（本物）と同じ見た目で並べないこと。
              同じ見た目で並べると、全部が本物に見えます。
              いちばん困るのは、見本の売上を本物だと思って
              仕入れや値付けを決めてしまうことです。

              だから、見本のほうにだけ枠と札を付けて、
              ★どこまでが本物か が一目で分かるようにします。
          */}
          <div className="rounded-xl border border-dashed border-edge2 bg-paper2 px-4 py-3">
            <span className="mb-2 inline-block rounded-md border border-edge2 bg-paper px-2 py-0.5 text-[11px] font-bold text-slate3">
              ここから3つは見本の数字（集計に未接続）
            </span>
            <p className="text-note leading-[2] text-slate2">
              いま販売中のガチャは
              <strong className="font-bold text-slate"> {sm.publishedCount}本 </strong>
              です。本日の売上は
              <span className="num font-bold text-slate"> {sm.revenueToday.toLocaleString()}円</span>
              、引かれた回数は
              <span className="num font-bold text-slate"> {sm.playsToday.toLocaleString()}回</span>
              でした。
            </p>
          </div>

          {/* ★注文と発送は、実データの数をそのまま読み上げる */}
          {live.phase === "ok" ? (
            <p className="text-note leading-[2] text-slate2">
              本日の注文は
              <span className="num font-bold text-slate"> {live.counts.ordersToday.toLocaleString()}件</span>
              （これまでの合計
              <span className="num font-bold text-slate"> {live.counts.ordersTotal.toLocaleString()}件</span>
              ）です。出荷がまだの発送は
              <span className="num font-bold text-slate"> {live.counts.unshippedShipments.toLocaleString()}件</span>
              、まだ箱に入れていない商品は
              <span className="num font-bold text-slate"> {live.counts.unassignedItems.toLocaleString()}点</span>
              あります。
            </p>
          ) : (
            <p className="rounded-xl border border-edge2 bg-paper2 px-4 py-3 text-note leading-[1.9] text-slate3">
              {live.phase === "loading"
                ? "注文と発送の件数を数えています。"
                : `注文と発送の件数は分かりません（${live.why}）。数えられていないので、0件とは申しません。`}
            </p>
          )}

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
          <p className="text-note leading-[1.85] text-slate3">
            いま手を動かすものはありません。未発送・問い合わせ・相場のずれを
            すべて確認したうえで、1件も見つからなかった状態です。
            新しく発生すると、ここに自動で並びます。
          </p>
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
      {/*
        ★ここを決め打ちで書かないこと。
          以前ここは「相場の取得が止まっています」と、
          実際に止まっているかどうかに関係なく、いつも出していました。
          止まっていないときに「止まっています」と出すのは、
          分からないことを隠すのと同じくらい、たちが悪いです。
          数えた結果だけを出します。
      */}
      <Card
        title="いま分かっていないこと"
        note="推測で埋めず、そのまま出しています。（相場は見本のデータです）"
      >
        {sm.marketStale === 0 ? (
          <p className="text-note leading-[1.85] text-slate3">
            いまは、取れていない項目はありません。
            見張っている景品
            <span className="num font-bold text-slate"> {sm.marketWatched}点 </span>
            は、すべて相場が取れています。
          </p>
        ) : (
          <ul className="space-y-3">
            <li className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-note font-bold text-slate">
                  一部の景品の相場（{sm.marketStale}点）
                </span>
                <Badge>分かりません</Badge>
              </div>
              <p className="mt-1 text-note leading-[1.85] text-slate3">
                見張っている{sm.marketWatched}点のうち
                <span className="num font-bold text-slate"> {sm.marketStale}点 </span>
                は、相場が取れていません。その分の還元率は、古い値のままです。
                ★「問題なし」とは表示しません。分からないものは分からないと出します。
              </p>
              <div className="mt-3">
                <Btn onClick={() => onNav("market" as MenuKey)}>相場の画面へ</Btn>
              </div>
            </li>
          </ul>
        )}
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
      return "箱はできていますが、まだ出ていません。お客様をお待たせしています。まとめて片づけるのが早いです。";
    case "orders":
      return "頼まれたのに、まだ箱に入れていない商品があります。ここを溜めると「注文したのに何も来ない」の問い合わせになります。支払の確認待ちも、この画面です。";
    case "rtp":
      /*
       * ★これを、いちばん強い言い方で書くこと。
       *   2026-08-26、設計88％のガチャが、実際には18.23％しか
       *   返していませんでした。500回ぶん売れきってから気づきました。
       *   発送の遅れは取り返せますが、これは取り返せません。
       */
      return "設計した還元率と、実際にお返しした額がずれています。ずれたまま売り続けると、売れた数だけ被害が増えます。しかも、あとから取り返せません。今日いちばんに見てください。";
    case "market":
      return "相場が取れていない景品があります。還元率を古い値で計算しているので、いまの数字は当てになりません。先に取り直してください。";
    default:
      /*
       * ★ここに落ちてきたら、それは書き忘れです。
       *   「ご確認ください。」とだけ出すと、
       *   なぜ先にやるのかが分からないまま並びます。
       *   todayTodos に行き先を足したら、必ずここにも足すこと。
       *   足し忘れは tests/operatorReasons.test.ts が見つけます。
       */
      return "ご確認ください。";
  }
}
