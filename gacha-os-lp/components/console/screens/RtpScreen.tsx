/**
 * 実還元率モニタ。
 *
 * ═══════════════════════════════════════════════
 * ★この画面がいちばん大事な理由
 * ═══════════════════════════════════════════════
 *
 *   ガチャで赤字になるとき、たいていは前触れがあります。
 *   ・設計した通りに出ていない（実還元率が上がっている）
 *   ・景品の相場が上がった（同じ景品を仕入れる値段が上がった）
 *
 *   どちらも、毎日この数字を見ていれば気づけます。
 *   逆に、月末に売上を締めてから気づくと、もう戻せません。
 *
 * ★3つの数字を、必ず並べて出すこと。
 *     設計還元率 … こうなるはずだった数字
 *     実還元率  … 実際に出ている数字
 *     相場基準  … いまの仕入れ値で計算し直した数字
 *
 *   1つだけ見せると、判断できません。
 *   「実還元率98%」は、設計96%なら少し出すぎ、設計99%なら想定内です。
 *
 * ★危ないときは、この画面から止められること。
 *   気づいた画面と、止める画面が別だと、
 *   忙しい日は「あとでやろう」になって、そのまま忘れます。
 */

"use client";

import type { ConsoleState, ConsoleAction, ConsoleGacha } from "@/lib/console/state";
import { can } from "@/lib/console/state";
import { Badge, Btn, Card, KV, RowCard, Rows, Stat, Table, Td, WhatIsThis } from "../ui";

/** どのくらい危ないか。色だけでなく日本語も返す */
function judge(g: ConsoleGacha): {
  tone: "ok" | "warn" | "danger";
  label: string;
  what: string;
} {
  if (g.realRtp >= 105 || g.marketRtp >= 115) {
    return {
      tone: "danger",
      label: "危険",
      what: "このまま売り続けると、1口ごとに赤字が増えます。止めることをおすすめします。",
    };
  }
  if (g.realRtp >= 100 || g.marketRtp >= 108) {
    return {
      tone: "warn",
      label: "注意",
      what: "まだ赤字ではありませんが、この傾向が続くと赤字になります。今日中に見てください。",
    };
  }
  return { tone: "ok", label: "問題なし", what: "設計した範囲に収まっています。何もしなくて大丈夫です。" };
}

export default function RtpScreen({
  s,
  dispatch,
}: {
  s: ConsoleState;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  const me = s.me!;
  const mayPause = can(me.role, "gacha.publish");
  const live = s.gachas.filter((g) => g.status === "PUBLISHED" || g.status === "PAUSED");
  const danger = live.filter((g) => judge(g).tone === "danger");

  const totalRevenue = live.reduce((a, g) => a + g.revenue, 0);
  const totalProfit = live.reduce((a, g) => a + g.profit, 0);

  return (
    <>
      <WhatIsThis>
        いま売っているガチャが、
        <strong className="font-bold text-slate">設計より出しすぎていないか</strong>
        を見ます。危ないものは、この画面からそのまま止められます。
      </WhatIsThis>

      {/* ── まとめ ── */}
      <Card title="いま売っている分の合計" note="停止中のものも含みます。">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="売上" value={`${totalRevenue.toLocaleString()}円`} />
          <Stat
            label="粗利"
            value={`${totalProfit.toLocaleString()}円`}
            tone={totalProfit < 0 ? "danger" : "ok"}
          />
          <Stat label="販売中" value={s.gachas.filter((g) => g.status === "PUBLISHED").length} unit="本" />
          <Stat
            label="危ないもの"
            value={danger.length}
            unit="本"
            tone={danger.length > 0 ? "danger" : "ok"}
          />
        </div>
      </Card>

      {/* ── 相場の値上がり警告 ── */}
      {danger.length > 0 && (
        <Card
          title="景品の相場が上がっています"
          note="設計したときより、同じ景品の仕入れ値が上がっている状態です。"
        >
          <ul className="space-y-4">
            {danger.map((g) => {
              const up = g.designedRtp > 0 ? ((g.marketRtp - g.designedRtp) / g.designedRtp) * 100 : 0;
              return (
                <li key={g.id} className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-note font-bold text-slate">{g.title}</p>
                    <Badge tone="danger">危険</Badge>
                  </div>
                  <div className="mt-3 border-t border-danger/25 pt-3">
                    <KV
                      k="設計したときの還元率"
                      v={<span className="num">{g.designedRtp.toFixed(1)}%</span>}
                    />
                    <KV
                      k="いまの相場で計算し直すと"
                      v={
                        <span className="num font-bold text-danger-ink">
                          {g.marketRtp.toFixed(1)}%（{up > 0 ? "+" : ""}
                          {up.toFixed(1)}%）
                        </span>
                      }
                    />
                    <KV
                      k="いまの粗利"
                      v={
                        <span className={`num ${g.profit < 0 ? "font-bold text-danger-ink" : ""}`}>
                          {g.profit.toLocaleString()}円
                        </span>
                      }
                    />
                  </div>
                  <p className="mt-3 text-note leading-[1.9] text-danger-ink">
                    100%を超えるということは、お客様が払った金額より、
                    お渡ししている景品の価値のほうが大きい状態です。
                    引かれるほど赤字が増えます。
                  </p>
                  {g.status === "PUBLISHED" ? (
                    mayPause ? (
                      <div className="mt-3">
                        <Btn
                          kind="danger"
                          onClick={() =>
                            dispatch({
                              type: "PAUSE_GACHA",
                              gachaId: g.id,
                              reason: `相場高騰により停止（実還元率 ${g.realRtp}% ／ 相場基準 ${g.marketRtp}%）`,
                            })
                          }
                        >
                          このガチャの販売を止める
                        </Btn>
                      </div>
                    ) : (
                      <p className="mt-3 text-note text-slate3">
                        ★いまの担当には、販売を止める権限がありません。運営または管理者にご連絡ください。
                      </p>
                    )
                  ) : (
                    <p className="mt-3 text-note font-bold text-slate2">
                      すでに販売を停止しています。これ以上は増えません。
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* ── 一覧 ── */}
      <Card title="ガチャごとの還元率" note="3つの数字を並べています。1つだけでは判断できません。">
        <Table
          head={["ガチャ", "設計還元率", "実還元率", "相場基準", "売上", "粗利", "状態", ""]}
        >
          {live.map((g) => {
            const j = judge(g);
            return (
              <tr key={g.id}>
                <Td className="font-bold text-slate">{g.title}</Td>
                <Td className="num">{g.designedRtp.toFixed(1)}%</Td>
                <Td className="num">
                  <span
                    className={
                      j.tone === "danger"
                        ? "font-bold text-danger-ink"
                        : j.tone === "warn"
                          ? "font-bold text-warn-ink"
                          : "text-ok-ink"
                    }
                  >
                    {g.realRtp.toFixed(1)}%
                  </span>
                </Td>
                <Td className="num">{g.marketRtp.toFixed(1)}%</Td>
                <Td className="num whitespace-nowrap">{g.revenue.toLocaleString()}円</Td>
                <Td className="num whitespace-nowrap">
                  <span className={g.profit < 0 ? "font-bold text-danger-ink" : ""}>
                    {g.profit.toLocaleString()}円
                  </span>
                </Td>
                <Td>
                  <Badge tone={j.tone}>{j.label}</Badge>
                </Td>
                <Td>
                  {g.status === "PUBLISHED" && j.tone !== "ok" && mayPause && (
                    <Btn
                      kind="danger"
                      onClick={() =>
                        dispatch({
                          type: "PAUSE_GACHA",
                          gachaId: g.id,
                          reason: `実還元率 ${g.realRtp}% ／ 相場基準 ${g.marketRtp}% のため停止`,
                        })
                      }
                    >
                      止める
                    </Btn>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>

        <Rows>
          {live.map((g) => {
            const j = judge(g);
            return (
              <RowCard key={g.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-note font-bold text-slate">{g.title}</span>
                  <Badge tone={j.tone}>{j.label}</Badge>
                </div>
                <div className="mt-2 border-t border-edge pt-2">
                  <KV k="設計還元率" v={<span className="num">{g.designedRtp.toFixed(1)}%</span>} />
                  <KV k="実還元率" v={<span className="num">{g.realRtp.toFixed(1)}%</span>} />
                  <KV k="相場基準" v={<span className="num">{g.marketRtp.toFixed(1)}%</span>} />
                  <KV k="粗利" v={<span className="num">{g.profit.toLocaleString()}円</span>} />
                </div>
                <p className="mt-2 text-note leading-[1.85] text-slate3">{j.what}</p>
                {g.status === "PUBLISHED" && j.tone !== "ok" && mayPause && (
                  <div className="mt-3">
                    <Btn
                      kind="danger"
                      full
                      onClick={() =>
                        dispatch({
                          type: "PAUSE_GACHA",
                          gachaId: g.id,
                          reason: `実還元率 ${g.realRtp}% ／ 相場基準 ${g.marketRtp}% のため停止`,
                        })
                      }
                    >
                      止める
                    </Btn>
                  </div>
                )}
              </RowCard>
            );
          })}
        </Rows>

        <div className="mt-5 space-y-2 rounded-xl border border-edge bg-paper2 px-4 py-4">
          <p className="text-note leading-[1.9] text-slate2">
            <strong className="font-bold text-slate">設計還元率</strong>
            … 作ったときに「こうなるはず」と決めた数字です。
          </p>
          <p className="text-note leading-[1.9] text-slate2">
            <strong className="font-bold text-slate">実還元率</strong>
            … 実際に出ている数字です。設計より高いなら、出しすぎています。
          </p>
          <p className="text-note leading-[1.9] text-slate2">
            <strong className="font-bold text-slate">相場基準</strong>
            … 残っている景品を「いまの仕入れ値」で計算し直した数字です。
            相場が上がると、まだ出していない景品の分だけ先に悪化します。
          </p>
        </div>
      </Card>
    </>
  );
}
