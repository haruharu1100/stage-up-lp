/**
 * 発送依頼・発送管理。
 *
 * ═══════════════════════════════════════════════
 * ★この画面の考え方
 * ═══════════════════════════════════════════════
 *
 *   ここは、いちばん件数が多くて、いちばん単純な仕事です。
 *   だから「1件あたり何回クリックするか」で使い勝手が決まります。
 *
 *   ・古い依頼が上に来ること（待たせている人から片づける）
 *   ・仕入れが必要なものは、購入先へすぐ飛べること
 *   ・発送済みにしたら、追跡番号の連絡まで一度に終わること
 *
 * ★「発送済みにする」を押したら、必ず記録が残ること。
 *   後から「送った・送っていない」で揉めたとき、
 *   誰がいつ処理したかが残っていないと、何も証明できません。
 *
 * ★このデモでは、配送業者にも、お客様のメールにもつながっていません。
 *   本物の伝票は作られませんし、通知も飛びません。
 *   ここを曖昧にしたまま人に見せてはいけません。
 */

"use client";

import { useState } from "react";
import type { ConsoleState, ConsoleAction, Order } from "@/lib/console/state";
import { ORDER_TODO, can } from "@/lib/console/state";
import {
  Badge,
  Btn,
  Card,
  DemoNote,
  Drawer,
  KV,
  RowCard,
  Rows,
  Stat,
  Table,
  Td,
  Tr,
  WhatIsThis,
} from "../ui";

const STATUS: Record<Order["status"], { label: string; tone: "warn" | "blue" | "ok" }> = {
  UNSHIPPED: { label: "未発送", tone: "warn" },
  PREPARING: { label: "準備中", tone: "blue" },
  SHIPPED: { label: "発送済み", tone: "ok" },
  IN_TRANSIT: { label: "配送中", tone: "ok" },
  DELIVERED: { label: "配達完了", tone: "ok" },
};

/**
 * まだ手を動かす必要がある状態。
 *
 * ★この画面で作り直さないこと。
 *   同じ「未発送とは何か」を、この画面とダッシュボードの2か所に書くと、
 *   片方だけ直したときに、両者の件数が食い違います。
 *   食い違った瞬間、どちらが正しいのか誰にも分からなくなります。
 *   決めるのは state.ts の1か所だけです。
 */
const TODO_STATUS = ORDER_TODO;

export default function ShippingScreen({
  s,
  dispatch,
}: {
  s: ConsoleState;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  const me = s.me!;
  const mayShip = can(me.role, "shipping.act");

  /* 待たせている人から片づける。新しい順ではありません */
  const todo = s.orders
    .filter((o) => TODO_STATUS.includes(o.status))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const done = s.orders.filter((o) => !TODO_STATUS.includes(o.status));

  /**
   * いま開いている1件。
   *
   * ★件そのものではなく、番号だけを持つこと。
   *   件をそのまま持つと、発送済みにしたあとも
   *   板の中は「未発送」のまま残ります。押した手応えが消えます。
   *   番号だけを持って、毎回いまの一覧から引き直せば、
   *   処理した瞬間に板の中身も追いつきます。
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (s.orders.find((o) => o.id === openId) ?? null) : null;

  return (
    <>
      <WhatIsThis>
        お客様からの発送依頼を処理します。
        <strong className="font-bold text-slate">お待たせしている順</strong>
        に並べています。発送済みにすると、追跡番号のお知らせまで一度に終わります。
      </WhatIsThis>

      <Card title="いまの状況">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="未発送" value={todo.length} unit="件" tone={todo.length > 0 ? "warn" : "ok"} />
          <Stat label="発送済み" value={done.length} unit="件" tone="ok" />
          <Stat label="本日の依頼" value={s.orders.filter((o) => o.requestedAt.startsWith("2026-08-22")).length} unit="件" />
          <Stat label="累計" value={s.orders.length} unit="件" />
        </div>
      </Card>

      {/* ── やること ── */}
      <Card
        title="発送するもの"
        note={
          todo.length > 0
            ? `${todo.length}件。上ほど長くお待たせしています。行を押すと、宛先と操作が右に出ます。`
            : undefined
        }
      >
        {todo.length === 0 ? (
          <p className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-4 text-note font-bold text-ok-ink">
            未発送はありません。すべて処理済みです。
          </p>
        ) : (
          <>
            <Table head={["依頼日", "会員", "景品", "お届け先", "状態"]}>
              {todo.map((o) => (
                <Tr key={o.id} onOpen={() => setOpenId(o.id)} active={openId === o.id} tone="warn">
                  <Td className="num whitespace-nowrap">{o.requestedAt}</Td>
                  <Td className="whitespace-nowrap">{o.userName}</Td>
                  <Td className="font-medium text-slate">{o.prize}</Td>
                  {/* ★住所は一覧では折りたたむこと。
                        全文を出すと1行が3行になり、表にした意味が消えます。
                        全文は右の板で読みます。 */}
                  <Td className="num text-slate3">
                    {o.address ? `〒${o.address.zip}` : "—"}
                  </Td>
                  <Td>
                    <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                  </Td>
                </Tr>
              ))}
            </Table>

            <Rows>
              {todo.map((o) => (
                <RowCard key={o.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-note font-bold text-slate">{o.prize}</span>
                    <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                  </div>
                  <div className="mt-2 border-t border-edge pt-2">
                    <KV k="会員" v={o.userName} />
                    <KV k="依頼日" v={<span className="num">{o.requestedAt}</span>} />
                  </div>
                  <div className="mt-3">
                    <Btn onClick={() => setOpenId(o.id)}>宛先と操作を開く</Btn>
                  </div>
                </RowCard>
              ))}
            </Rows>
          </>
        )}
      </Card>

      {/* ── 1件の中身と、操作 ── */}
      <Drawer
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open?.prize ?? ""}
        note={open ? `${open.userName} ／ 依頼 ${open.requestedAt}` : undefined}
        foot={
          open && TODO_STATUS.includes(open.status) && mayShip ? (
            <>
              <Btn
                kind="primary"
                onClick={() => dispatch({ type: "SHIP", orderId: open.id })}
              >
                発送済みにする
              </Btn>
              <Btn
                onClick={() => {
                  /* ★デモでは外部サイトへ飛ばしません。本番では景品マスターに
                     登録した購入URLを開きます */
                }}
                title="デモでは開きません"
                disabled
              >
                仕入れ先を開く
              </Btn>
            </>
          ) : undefined
        }
      >
        {open && (
          <>
            <div className="flex items-center gap-2">
              <Badge tone={STATUS[open.status].tone}>{STATUS[open.status].label}</Badge>
            </div>

            {/* ★お届け先は、お客様が依頼したときのものを写して持っています。
                会員情報の住所を後から直しても、この宛先は変わりません */}
            {open.address && (
              <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
                <p className="text-note font-bold text-slate">お届け先</p>
                <p className="num mt-1 text-note leading-[1.85] text-slate3">
                  〒{open.address.zip}　{open.address.addr}
                  <br />
                  {open.address.name}　{open.address.tel}
                </p>
              </div>
            )}

            {open.tracking && (
              <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
                <KV k="配送業者" v={open.carrier ?? "-"} />
                <KV k="追跡番号" v={<span className="num">{open.tracking}</span>} />
              </div>
            )}

            {TODO_STATUS.includes(open.status) &&
              (mayShip ? (
                <p className="text-note leading-[1.85] text-slate3">
                  「発送済みにする」を押すと、伝票を作り、追跡番号をお客様にお知らせし、
                  記録を1件残します。3つが1回で終わります。
                </p>
              ) : (
                <p className="rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.85] text-warn-ink">
                  いまの担当には、発送処理の権限がありません。
                  上の「デモ：担当を切り替える」から「サポート 三郎」または「運営 太郎」に
                  変えると押せます。
                </p>
              ))}
          </>
        )}
      </Drawer>

      {/* ── 済んだもの ── */}
      <Card title="発送済み" note="追跡番号はここから確認できます。">
        {done.length === 0 ? (
          <p className="text-note text-slate3">まだありません。</p>
        ) : (
          <>
            <Table head={["依頼日", "会員", "景品", "配送業者", "追跡番号", "状態"]}>
              {done.map((o) => (
                <tr key={o.id}>
                  <Td className="num whitespace-nowrap">{o.requestedAt}</Td>
                  <Td>{o.userName}</Td>
                  <Td className="font-medium text-slate">{o.prize}</Td>
                  <Td>{o.carrier ?? "-"}</Td>
                  <Td className="num">{o.tracking ?? "-"}</Td>
                  <Td>
                    <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>

            <Rows>
              {done.map((o) => (
                <RowCard key={o.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-note font-bold text-slate">{o.prize}</span>
                    <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                  </div>
                  <div className="mt-2 border-t border-edge pt-2">
                    <KV k="会員" v={o.userName} />
                    <KV k="依頼日" v={<span className="num">{o.requestedAt}</span>} />
                    <KV k="配送業者" v={o.carrier ?? "-"} />
                    <KV k="追跡番号" v={<span className="num">{o.tracking ?? "-"}</span>} />
                  </div>
                </RowCard>
              ))}
            </Rows>
          </>
        )}
      </Card>

      <DemoNote>
        このデモは、配送業者のシステムにも、お客様へのメール送信にもつながっていません。
        「発送済みにする」を押しても、本物の伝票は作られませんし、通知も飛びません。
        画面の中で、手順だけを再現しています。
      </DemoNote>
    </>
  );
}
