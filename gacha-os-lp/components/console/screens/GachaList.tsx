/**
 * ガチャ管理。
 *
 * ★状態を、色と日本語の両方で出すこと。
 *   「PAUSED」とだけ出しても、初めての人には
 *   自分で止めたのか、勝手に止まったのかが分かりません。
 *
 * ★公開ボタンは、検証を通していないガチャでは押せないこと。
 *   「危ないかもしれないが、とりあえず出す」を、仕組みとして禁じます。
 *   人の注意力で守るものは、忙しい日に必ず破られます。
 */

"use client";

import type { ConsoleState, ConsoleAction, ConsoleGacha } from "@/lib/console/state";
import { can } from "@/lib/console/state";
import type { MenuKey } from "../menu";
import { Badge, Btn, Card, KV, RowCard, Rows, Table, Td, WhatIsThis } from "../ui";

const STATUS: Record<
  ConsoleGacha["status"],
  { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "blue" }
> = {
  DRAFT: { label: "下書き", tone: "neutral" },
  REVIEW: { label: "公開待ち", tone: "blue" },
  PUBLISHED: { label: "販売中", tone: "ok" },
  PAUSED: { label: "販売停止中", tone: "danger" },
  SOLD_OUT: { label: "完売", tone: "neutral" },
};

/** 実還元率が、どのくらい危ないか */
function rtpTone(g: ConsoleGacha): "ok" | "warn" | "danger" {
  if (g.realRtp === 0) return "ok";
  if (g.realRtp >= 103 || g.marketRtp >= 115) return "danger";
  if (g.realRtp >= 100 || g.marketRtp >= 108) return "warn";
  return "ok";
}

export default function GachaList({
  s,
  dispatch,
  onNav,
}: {
  s: ConsoleState;
  dispatch: React.Dispatch<ConsoleAction>;
  onNav: (k: MenuKey) => void;
}) {
  const me = s.me!;
  const mayPublish = can(me.role, "gacha.publish");

  const alerts = s.gachas.filter(
    (g) => g.status === "PUBLISHED" && (g.realRtp >= 105 || g.marketRtp >= 110),
  );
  const paused = s.gachas.filter((g) => g.status === "PAUSED");

  return (
    <>
      <WhatIsThis>
        ガチャを作り、検証し、公開し、必要なら止めます。
        <strong className="font-bold text-slate">検証を通していないガチャは公開できません。</strong>
      </WhatIsThis>

      {/* ── 止まっているガチャ ── */}
      {paused.length > 0 && (
        <Card title="いま止まっているガチャ" note="システムが自動で止めたものも含みます。">
          {paused.map((g) => (
            <div
              key={g.id}
              className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-note font-bold text-slate">{g.title}</p>
                <Badge tone="danger">販売停止中</Badge>
              </div>
              <p className="mt-2 text-note leading-[1.9] text-danger-ink">
                景品の相場が上がり、実際にお返ししている割合が
                <span className="num font-bold"> {g.realRtp}% </span>
                になっています。このまま売り続けると、1口ごとに赤字が増えます。
                <br />
                いまの粗利：
                <span className="num font-bold">{g.profit.toLocaleString()}円</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn onClick={() => onNav("rtp")}>くわしく見る</Btn>
                <Btn onClick={() => onNav("market")}>相場を見る</Btn>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* ── 警告 ── */}
      {alerts.length > 0 && (
        <Card title="出しすぎているガチャ" note="止まってはいませんが、放っておくと赤字になります。">
          <ul className="space-y-3">
            {alerts.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/35 bg-warn/8 px-4 py-3"
              >
                <span className="text-note text-slate2">
                  <strong className="font-bold text-slate">{g.title}</strong>
                  <span className="num ml-2 text-warn-ink">実還元率 {g.realRtp}%</span>
                </span>
                {mayPublish && (
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
                    販売を止める
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── 一覧 ── */}
      <Card title="ガチャ一覧" note={`${s.gachas.length}件`}>
        <Table head={["ガチャ", "状態", "価格", "残り", "設計還元率", "実還元率", "粗利", ""]}>
          {s.gachas.map((g) => (
            <tr key={g.id}>
              <Td className="font-bold text-slate">{g.title}</Td>
              <Td>
                <Badge tone={STATUS[g.status].tone}>{STATUS[g.status].label}</Badge>
              </Td>
              <Td className="num whitespace-nowrap">{g.price.toLocaleString()}円</Td>
              <Td className="num whitespace-nowrap">
                {g.left.toLocaleString()} / {g.total.toLocaleString()}
              </Td>
              <Td className="num">{g.designedRtp ? `${g.designedRtp}%` : "-"}</Td>
              <Td className="num">
                {g.realRtp ? (
                  <span
                    className={
                      rtpTone(g) === "danger"
                        ? "font-bold text-danger-ink"
                        : rtpTone(g) === "warn"
                          ? "font-bold text-warn-ink"
                          : "text-ok-ink"
                    }
                  >
                    {g.realRtp}%
                  </span>
                ) : (
                  "-"
                )}
              </Td>
              <Td className="num whitespace-nowrap">
                <span className={g.profit < 0 ? "font-bold text-danger-ink" : ""}>
                  {g.profit.toLocaleString()}円
                </span>
              </Td>
              <Td>
                <Actions g={g} mayPublish={mayPublish} dispatch={dispatch} />
              </Td>
            </tr>
          ))}
        </Table>

        <Rows>
          {s.gachas.map((g) => (
            <RowCard key={g.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-note font-bold text-slate">{g.title}</span>
                <Badge tone={STATUS[g.status].tone}>{STATUS[g.status].label}</Badge>
              </div>
              <div className="mt-2 border-t border-edge pt-2">
                <KV k="価格" v={<span className="num">{g.price.toLocaleString()}円</span>} />
                <KV
                  k="残り"
                  v={
                    <span className="num">
                      {g.left.toLocaleString()} / {g.total.toLocaleString()}
                    </span>
                  }
                />
                <KV k="実還元率" v={<span className="num">{g.realRtp ? `${g.realRtp}%` : "-"}</span>} />
                <KV k="粗利" v={<span className="num">{g.profit.toLocaleString()}円</span>} />
              </div>
              <div className="mt-3">
                <Actions g={g} mayPublish={mayPublish} dispatch={dispatch} />
              </div>
            </RowCard>
          ))}
        </Rows>

        {!mayPublish && (
          <p className="mt-4 text-note leading-[1.9] text-slate3">
            ★いまの担当には、公開・停止の権限がありません。
            上の担当の切り替えから「運営 太郎」または「運営 次郎」に変えると押せます。
          </p>
        )}
      </Card>
    </>
  );
}

function Actions({
  g,
  mayPublish,
  dispatch,
}: {
  g: ConsoleGacha;
  mayPublish: boolean;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  if (!mayPublish) return <span className="text-note text-slate3">権限なし</span>;

  if (g.status === "PUBLISHED") {
    return (
      <Btn
        kind="danger"
        onClick={() =>
          dispatch({ type: "PAUSE_GACHA", gachaId: g.id, reason: "運営判断による一時停止" })
        }
      >
        止める
      </Btn>
    );
  }

  const blocked = g.backtest === null || g.backtest === "DANGER";
  return (
    <div className="flex flex-col items-start gap-1">
      <Btn
        kind="primary"
        disabled={blocked}
        title={
          g.backtest === null
            ? "公開前の検証がまだです"
            : g.backtest === "DANGER"
              ? "検証の結果が DANGER です"
              : undefined
        }
        onClick={() => dispatch({ type: "PUBLISH_GACHA", gachaId: g.id })}
      >
        公開する
      </Btn>
      {blocked && (
        <span className="text-note text-slate3">
          {g.backtest === null ? "先に検証してください" : "検証の結果が DANGER です"}
        </span>
      )}
    </div>
  );
}
