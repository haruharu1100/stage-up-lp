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

import type { ConsoleState, ConsoleAction, Order } from "@/lib/console/state";
import { ORDER_TODO, can } from "@/lib/console/state";
import { Badge, Btn, Card, DemoNote, KV, RowCard, Rows, Stat, Table, Td, WhatIsThis } from "../ui";

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
        note={todo.length > 0 ? `${todo.length}件。上から順に片づけてください。` : undefined}
      >
        {todo.length === 0 ? (
          <p className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-4 text-note font-bold text-ok-ink">
            未発送はありません。すべて処理済みです。
          </p>
        ) : (
          <ul className="space-y-4">
            {todo.map((o) => (
              <li key={o.id} className="rounded-xl border border-edge bg-paper2 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-note font-bold text-slate">{o.prize}</p>
                    <p className="num mt-0.5 text-note text-slate3">
                      {o.userName} ／ 依頼 {o.requestedAt}
                    </p>
                  </div>
                  <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                </div>

                {/* ★お届け先は、お客様が依頼したときのものを写して持っています。
                    会員情報の住所を後から直しても、この宛先は変わりません */}
                {o.address && (
                  <div className="mt-3 rounded-lg border border-edge bg-paper px-3 py-2">
                    <p className="text-note font-bold text-slate">お届け先</p>
                    <p className="num mt-0.5 text-note leading-[1.85] text-slate3">
                      〒{o.address.zip}　{o.address.addr}
                      <br />
                      {o.address.name}　{o.address.tel}
                    </p>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {mayShip ? (
                    <>
                      <Btn kind="primary" onClick={() => dispatch({ type: "SHIP", orderId: o.id })}>
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
                  ) : (
                    <p className="text-note text-slate3">
                      ★いまの担当には、発送処理の権限がありません。
                      上の担当の切り替えから「サポート 三郎」または「運営 太郎」に変えると押せます。
                    </p>
                  )}
                </div>

                {mayShip && (
                  <p className="mt-3 text-note leading-[1.85] text-slate3">
                    押すと、伝票を作り、追跡番号をお客様にお知らせし、記録を1件残します。
                    3つが1回で終わります。
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

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
