/**
 * 売上・分析。
 *
 * ═══════════════════════════════════════════════
 * ★この画面で気をつけること
 * ═══════════════════════════════════════════════
 *
 *   1) 数字を並べるだけにしないこと。
 *      「今月 949,500円」と出しても、それが良いのか悪いのかは伝わりません。
 *      前と比べてどうか、何が効いたのかまで書きます。
 *
 *   2) 売上より、粗利を大きく出すこと。
 *      オンラインガチャは、売上が伸びていても
 *      還元率が上がっていれば粗利は減ります。
 *      売上だけを大きく出すと、赤字に気づくのが遅れます。
 *
 *   3) 取れていない期間を、0として描かないこと。
 *      グラフの0は「売れなかった」を意味します。
 *      「まだ集計していない」とは違います。
 */

"use client";

import type { ConsoleState } from "@/lib/console/state";
import { summary } from "@/lib/console/state";
import { Badge, Card, DemoNote, KV, RowCard, Rows, Stat, Table, Td, WhatIsThis } from "../ui";

/** 直近7日（すべて架空の数字） */
const DAYS = [
  { d: "8/16", revenue: 96_200, profit: 12_800 },
  { d: "8/17", revenue: 121_400, profit: 16_100 },
  { d: "8/18", revenue: 143_900, profit: 19_400 },
  { d: "8/19", revenue: 138_600, profit: 17_200 },
  { d: "8/20", revenue: 152_300, profit: 9_600 },
  { d: "8/21", revenue: 168_700, profit: 4_100 },
  { d: "8/22", revenue: 128_400, profit: 11_900 },
];

export default function AnalyticsScreen({ s }: { s: ConsoleState }) {
  const sm = summary(s);
  const maxRevenue = Math.max(...DAYS.map((d) => d.revenue));
  const weekRevenue = DAYS.reduce((a, d) => a + d.revenue, 0);
  const weekProfit = DAYS.reduce((a, d) => a + d.profit, 0);
  const margin = weekRevenue > 0 ? (weekProfit / weekRevenue) * 100 : 0;

  return (
    <>
      <WhatIsThis>
        売上と粗利の推移を見ます。
        <strong className="font-bold text-slate">売上が伸びていても、粗利が減っていれば危ない状態です。</strong>
        そこが分かるように並べています。
      </WhatIsThis>

      <Card title="この7日間">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="売上" value={`${weekRevenue.toLocaleString()}円`} />
          <Stat
            label="粗利"
            value={`${weekProfit.toLocaleString()}円`}
            tone={weekProfit < 0 ? "danger" : "ok"}
          />
          <Stat
            label="粗利率"
            value={`${margin.toFixed(1)}%`}
            tone={margin < 5 ? "danger" : margin < 10 ? "warn" : "ok"}
          />
          <Stat label="会員数" value={sm.users} unit="名" />
        </div>

        <p className="mt-4 rounded-xl border border-warn/30 bg-warn/8 px-4 py-4 text-note leading-[1.9] text-warn-ink">
          <strong className="font-bold">8/20 から、売上は伸びているのに粗利が落ちています。</strong>
          <br />
          景品の相場が上がり、同じ1回を売っても手元に残る金額が減っているためです。
          売上のグラフだけを見ていると、この動きは「好調」に見えます。
        </p>
      </Card>

      {/* ── 推移 ── */}
      <Card title="日ごとの売上と粗利" note="棒の長さは売上、下の数字が粗利です。">
        <ul className="space-y-3">
          {DAYS.map((d) => {
            const w = Math.round((d.revenue / maxRevenue) * 100);
            const rate = (d.profit / d.revenue) * 100;
            return (
              <li key={d.d}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="num text-note font-bold text-slate">{d.d}</span>
                  <span className="num text-note text-slate2">
                    売上 {d.revenue.toLocaleString()}円 ／ 粗利{" "}
                    <span
                      className={
                        rate < 5 ? "font-bold text-danger-ink" : rate < 10 ? "font-bold text-warn-ink" : "text-ok-ink"
                      }
                    >
                      {d.profit.toLocaleString()}円（{rate.toFixed(1)}%）
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-mist">
                  <div
                    className={`h-full rounded-full ${
                      rate < 5 ? "bg-danger" : rate < 10 ? "bg-warn" : "bg-blue-ink"
                    }`}
                    style={{ width: `${w}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★色は粗利率で変えています。棒が長い（売上が大きい）のに赤い日が、いちばん危ない日です。
        </p>
      </Card>

      {/* ── ガチャごと ── */}
      <Card title="ガチャごとの成績" note="売上ではなく、粗利の順に並べています。">
        <Table head={["ガチャ", "状態", "売上", "粗利", "粗利率", "実還元率"]}>
          {[...s.gachas]
            .filter((g) => g.revenue > 0)
            .sort((a, b) => b.profit - a.profit)
            .map((g) => {
              const rate = g.revenue > 0 ? (g.profit / g.revenue) * 100 : 0;
              return (
                <tr key={g.id}>
                  <Td className="font-bold text-slate">{g.title}</Td>
                  <Td>
                    <Badge tone={g.status === "PUBLISHED" ? "ok" : "danger"}>
                      {g.status === "PUBLISHED" ? "販売中" : "販売停止中"}
                    </Badge>
                  </Td>
                  <Td className="num whitespace-nowrap">{g.revenue.toLocaleString()}円</Td>
                  <Td className="num whitespace-nowrap">
                    <span className={g.profit < 0 ? "font-bold text-danger-ink" : ""}>
                      {g.profit.toLocaleString()}円
                    </span>
                  </Td>
                  <Td className="num">{rate.toFixed(1)}%</Td>
                  <Td className="num">{g.realRtp.toFixed(1)}%</Td>
                </tr>
              );
            })}
        </Table>

        <Rows>
          {[...s.gachas]
            .filter((g) => g.revenue > 0)
            .sort((a, b) => b.profit - a.profit)
            .map((g) => (
              <RowCard key={g.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-note font-bold text-slate">{g.title}</span>
                  <Badge tone={g.status === "PUBLISHED" ? "ok" : "danger"}>
                    {g.status === "PUBLISHED" ? "販売中" : "販売停止中"}
                  </Badge>
                </div>
                <div className="mt-2 border-t border-edge pt-2">
                  <KV k="売上" v={<span className="num">{g.revenue.toLocaleString()}円</span>} />
                  <KV k="粗利" v={<span className="num">{g.profit.toLocaleString()}円</span>} />
                  <KV k="実還元率" v={<span className="num">{g.realRtp.toFixed(1)}%</span>} />
                </div>
              </RowCard>
            ))}
        </Rows>

        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★売上の順ではなく、粗利の順に並べています。
          いちばん売れているガチャが、いちばん儲かっているとは限りません。
        </p>
      </Card>

      <DemoNote>
        ここに出ている数字は、すべて架空です。実際の売上ではありません。
        実際にお使いいただく管理画面では、この画面の数字は本番の取引データから作られます。
      </DemoNote>
    </>
  );
}
