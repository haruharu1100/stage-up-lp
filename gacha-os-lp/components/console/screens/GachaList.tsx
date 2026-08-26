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

import { useState } from "react";
import type { ConsoleState, ConsoleAction, ConsoleGacha } from "@/lib/console/state";
import { can } from "@/lib/console/state";
import type { MenuKey } from "../menu";
import { Badge, Btn, Card, DemoNote, Drawer, KV, RowCard, Rows, Table, Td, Tr, WhatIsThis } from "../ui";

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

/** 残数還元率が、どのくらい危ないか */
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
  const mayEdit = can(me.role, "gacha.edit");

  /**
   * いま開いている1件。
   *
   * ★件そのものではなく、番号だけを持つこと。
   *   公開・停止を押した瞬間に状態が変わります。件を写して持つと、
   *   板の中だけ古い状態のまま残り、押しても何も起きていないように見えます。
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (s.gachas.find((g) => g.id === openId) ?? null) : null;

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

      {/*
        ── 還元率の呼び分け ──

        ★「実還元率」という書き方に戻さないこと。
          その言葉は、次の3つのどれを指すのか分かりません。

              設計還元率 … 作ったときの予定
              残数還元率 … 残っている景品 ÷ 残っている口数
              実績還元率 … 実際に引かれた結果（お客様に返った額）

          2026-08-26、画面に 88.0％ と出ているのに、
          実際に返っていたのは 18.23％ でした。
          3つを1つの言葉で呼んでいたことが、気づけなかった一因です。

        ★この一覧の数字は、まだ見本です。
          本物の3種類は「実績還元率」の画面で見られます。
          この一覧を本物へ差し替えるのは、次の作業です。
      */}
      <div className="rounded-xl border border-blue-ink/25 bg-blue-pale/40 px-5 py-4">
        <p className="text-note leading-[1.9] text-slate2">
          <strong className="font-bold text-slate">還元率は、3種類あります。</strong>
          設計（作ったときの予定）・残数（残っている景品 ÷ 残っている口数）・
          実績（実際にお客様へ返った額）。
          <br />
          この一覧に出ているのは <strong className="font-bold text-slate">設計</strong> と{" "}
          <strong className="font-bold text-slate">残数</strong> です。
          実際にいくら返ったかは、
          <button
            type="button"
            className="mx-1 font-bold text-blue-ink underline underline-offset-4"
            onClick={() => onNav("rtp")}
          >
            実績還元率
          </button>
          の画面でご確認ください。
        </p>
      </div>

      {/* ── 止まっているガチャ ──

          ★1件を5行で書かないこと。
            もとは、止まった理由を1件ごとに3行の文章で説明していました。
            止まっているガチャが3つあれば、それだけで画面の半分が
            ほぼ同じ文章で埋まります。
            違うのは「どれが」「何%で」の2つだけなので、
            1行に並べて、詳しくはボタンの先で読みます。 */}
      {paused.length > 0 && (
        <Card
          title="いま止まっているガチャ"
          note="システムが自動で止めたものも含みます。このまま売り続けると、1口ごとに赤字が増えます。"
        >
          <ul className="space-y-2">
            {paused.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-2.5"
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Badge tone="danger">販売停止中</Badge>
                  <span className="text-note font-bold text-slate">{g.title}</span>
                  <span className="num text-note text-danger-ink">
                    残数還元率 {g.realRtp}% ／ 粗利 {g.profit.toLocaleString()}円
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Btn onClick={() => onNav("rtp")}>くわしく見る</Btn>
                  <Btn onClick={() => onNav("market")}>相場を見る</Btn>
                </span>
              </li>
            ))}
          </ul>
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
                  <span className="num ml-2 text-warn-ink">残数還元率 {g.realRtp}%</span>
                </span>
                {mayPublish && (
                  <Btn
                    kind="danger"
                    onClick={() =>
                      dispatch({
                        type: "PAUSE_GACHA",
                        gachaId: g.id,
                        reason: `残数還元率 ${g.realRtp}% ／ 相場基準 ${g.marketRtp}% のため停止`,
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
      <Card
        title="ガチャ一覧"
        note={`${s.gachas.length}件`}
        right={
          mayEdit ? (
            <Btn kind="ghost" onClick={() => onNav("builder")}>
              新しく作る
            </Btn>
          ) : undefined
        }
      >
        {/* ★操作ボタンを表の中に並べないこと。
              ボタンを1列足すと、それだけで数字の列が押し潰されます。
              しかも行そのものが押せるので、行を開くつもりで
              「公開する」を押してしまう事故が起きます。
              操作は、行を押して開いた右の板の中だけに置きます。 */}
        <Table head={["ガチャ", "状態", "価格", "残り", "設計還元率", "残数還元率", "粗利"]}>
          {s.gachas.map((g) => (
            /* ★危ない行に色を付けること。
                 上の警告で名前を見た人が、一覧の中からその行を
                 目で探し直さずに済みます。 */
            <Tr
              key={g.id}
              onOpen={() => setOpenId(g.id)}
              active={openId === g.id}
              tone={
                g.status === "PAUSED" || rtpTone(g) === "danger"
                  ? "danger"
                  : rtpTone(g) === "warn"
                    ? "warn"
                    : undefined
              }
            >
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
            </Tr>
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
                <KV k="残数還元率" v={<span className="num">{g.realRtp ? `${g.realRtp}%` : "-"}</span>} />
                <KV k="粗利" v={<span className="num">{g.profit.toLocaleString()}円</span>} />
              </div>
              <div className="mt-3">
                <Btn onClick={() => setOpenId(g.id)}>中身と操作を開く</Btn>
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

      {/* ── 1件の中身と、操作 ── */}
      <Drawer
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open?.title ?? ""}
        note={open ? `1回 ${open.price.toLocaleString()}円` : undefined}
        foot={
          open ? (
            <Actions g={open} mayPublish={mayPublish} mayEdit={mayEdit} dispatch={dispatch} />
          ) : undefined
        }
      >
        {open && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS[open.status].tone}>{STATUS[open.status].label}</Badge>
              {open.backtest === null ? (
                <Badge tone="neutral">公開前の検証がまだ</Badge>
              ) : (
                <Badge
                  tone={
                    open.backtest === "DANGER"
                      ? "danger"
                      : open.backtest === "CAUTION"
                        ? "warn"
                        : "ok"
                  }
                >
                  検証 {open.backtest}
                </Badge>
              )}
            </div>

            <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
              <KV
                k="残り口数"
                v={
                  <span className="num">
                    {open.left.toLocaleString()} / {open.total.toLocaleString()}
                  </span>
                }
              />
              <KV k="設計還元率" v={<span className="num">{open.designedRtp ? `${open.designedRtp}%` : "-"}</span>} />
              <KV k="残数還元率" v={<span className="num">{open.realRtp ? `${open.realRtp}%` : "-"}</span>} />
              <KV k="相場基準の還元率" v={<span className="num">{open.marketRtp ? `${open.marketRtp}%` : "-"}</span>} />
              <KV k="粗利" v={<span className="num">{open.profit.toLocaleString()}円</span>} />
            </div>

            {/* ★止まっているなら、そのままにしないこと。
                  「販売停止中」だけ見せて放置すると、
                  何を直せば再開できるのかが分かりません */}
            {open.status === "PAUSED" && (
              <p className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-note leading-[1.9] text-danger-ink">
                販売を止めています。残数還元率か、相場の値上がりが原因です。
                下の「実績還元率を見る」「相場を見る」で、どちらなのかが分かります。
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => onNav("rtp")}>実績還元率を見る</Btn>
              <Btn onClick={() => onNav("market")}>相場を見る</Btn>
              <Btn onClick={() => onNav("preview")}>お客様の画面で見る</Btn>
            </div>
          </>
        )}
      </Drawer>

      <DemoNote>
        ここに並んでいるガチャ・売上・還元率は、すべて架空の見本です。
        実際にお使いいただくときは、登録したガチャがそのまま並びます。
      </DemoNote>
    </>
  );
}

function Actions({
  g,
  mayPublish,
  mayEdit,
  dispatch,
}: {
  g: ConsoleGacha;
  mayPublish: boolean;
  mayEdit: boolean;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  if (!mayPublish && !mayEdit) return <span className="text-note text-slate3">権限なし</span>;

  if (g.status === "PUBLISHED") {
    if (!mayPublish) return <span className="text-note text-slate3">権限なし</span>;
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
      {/* ★検証がまだのものは、この場で実行できるようにします。
          「先に検証してください」とだけ出して、どこで押すのか分からないのが
          いちばん飛ばされやすい形です */}
      {mayEdit && (
        <Btn
          kind={g.backtest === null ? "primary" : "ghost"}
          onClick={() => dispatch({ type: "RUN_BACKTEST", gachaId: g.id })}
        >
          {g.backtest === null ? "検証を実行する" : "検証をやり直す"}
        </Btn>
      )}
      {mayPublish && (
        <Btn
          kind={blocked ? "ghost" : "primary"}
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
      )}
      {blocked && (
        <span className="text-note text-slate3">
          {g.backtest === null ? "先に検証してください" : "検証の結果が DANGER です"}
        </span>
      )}
    </div>
  );
}
