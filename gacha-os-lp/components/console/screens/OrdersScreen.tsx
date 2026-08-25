/**
 * 注文（/client-demo/orders）。
 *
 * ═══════════════════════════════════════════════
 * ★この画面は「発送管理」ではありません
 * ═══════════════════════════════════════════════
 *
 *   ここに出ているのは「何を頼まれたか」だけです。
 *   どの箱に入れて、いつ出したかは、発送管理（/client-demo/shipping）です。
 *
 *   同じ画面にすると、次のことが書けなくなります。
 *
 *       注文A（商品1・商品2・商品3）
 *          ├─ 発送1（商品1・商品2）  ← 今日出した
 *          └─ 発送2（商品3）          ← 取り寄せ中
 *
 *   書けないので、運用の人は手元の紙かExcelで補います。
 *   そして、そのExcelが本当の台帳になります。
 *
 * ★注文の中身は、ここでは直せません。
 *   注文は「そのとき何を頼んだか」の記録だからです。
 *   後から品名や数を直せる作りにすると、記録としての意味が消えます。
 *   直すときは、取り消して立て直します。取り消しは残ります。
 *
 * ★ここに出る数字は、すべてサーバーのデータです。
 *   画面の中で作った見本ではありません。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { postHeaders } from "@/lib/csrf";
import type { MenuKey } from "../menu";
import {
  Badge,
  Btn,
  Card,
  Drawer,
  Empty,
  ErrorBox,
  Field,
  KV,
  RowCard,
  Rows,
  Skeleton,
  Stat,
  Table,
  Td,
  Tr,
  WhatIsThis,
  inputClass,
} from "../ui";

/* ══════════════════════════════════════════════
   サーバーから来る形
   ══════════════════════════════════════════════ */

type OrderRow = {
  id: string;
  orderNumber: string;
  userId: string;
  userName: string;
  orderedAt: string;
  itemCount: number;
  itemNames: string;
  subtotal: number;
  paymentStatus: string;
  orderStatus: string;
  shipmentCount: number;
};

type OrderItem = {
  id: string;
  prizeId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unitValue: number;
  assignedQuantity: number;
  shippedQuantity: number;
  unassignedQuantity: number;
  status: string;
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  userId: string;
  userName: string;
  orderedAt: string;
  orderType: string;
  subtotal: number;
  discount: number;
  pointUsed: number;
  total: number;
  paymentStatus: string;
  orderStatus: string;
  updatedAt: string;
  items: OrderItem[];
};

type ShipmentBrief = {
  id: string;
  shipmentNumber: string;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  itemCount: number;
  requestedAt: string;
};

/* ══════════════════════════════════════════════
   言葉と色
   ══════════════════════════════════════════════ */

const ORDER_STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "blue" | "ok" | "danger" }> = {
  PENDING: { label: "受付済み", tone: "warn" },
  PAID: { label: "支払済み", tone: "blue" },
  PARTIALLY_FULFILLED: { label: "一部発送済み", tone: "warn" },
  FULFILLED: { label: "発送済み", tone: "ok" },
  CANCELLED: { label: "取消", tone: "danger" },
};

const PAYMENT_STATUS: Record<string, string> = {
  UNPAID: "未払い",
  PAID: "支払済み",
  POINT_ONLY: "ポイントのみ",
  REFUNDED: "返金済み",
};

const ITEM_STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "blue" | "ok" | "danger" }> = {
  UNSHIPPED: { label: "未発送", tone: "warn" },
  PARTIALLY_SHIPPED: { label: "一部発送", tone: "warn" },
  SHIPPED: { label: "発送済み", tone: "ok" },
  CANCELLED: { label: "取消", tone: "danger" },
};

function statusOf(s: string) {
  return ORDER_STATUS[s] ?? { label: s, tone: "neutral" as const };
}

function itemStatusOf(s: string) {
  return ITEM_STATUS[s] ?? { label: s, tone: "neutral" as const };
}

/** 日時を、読める形に */
function nichiji(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

const yen = (n: number) => `${n.toLocaleString()}円`;

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export default function OrdersScreen({
  onNav,
  query,
}: {
  /** 発送管理へ飛ぶための入口。#11「注文詳細からShipmentへ飛べること」 */
  onNav?: (key: MenuKey, query?: Record<string, string>) => void;
  /** 発送画面から「もとの注文を見る」で渡ってくる目印（?open=注文ID） */
  query?: Record<string, string>;
}) {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [shibori, setShibori] = useState("");

  const [openId, setOpenId] = useState<string | null>(null);

  /* 発送画面から「もとの注文を見る」で来たときは、その注文を開く */
  useEffect(() => {
    if (query?.open) setOpenId(query.open);
  }, [query]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const q = shibori ? `?status=${encodeURIComponent(shibori)}` : "";
      const res = await fetch(`/api/console/orders${q}`, { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        orders?: OrderRow[];
        total?: number;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        /* ★権限が足りないだけの状態を、赤いエラーにしないこと。
             壊れてはいません。断られているだけです。 */
        setErr(res.status === 403 ? "KENGEN" : data.message ?? "注文を読み込めませんでした。");
        setRows([]);
        return;
      }
      setRows(data.orders ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setErr("注文を読み込めませんでした。");
      setRows([]);
    }
  }, [shibori]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) {
    return (
      <div className="space-y-6">
        <Card title="注文">
          <Skeleton rows={5} label="注文を読み込んでいます" />
        </Card>
      </div>
    );
  }

  if (err === "KENGEN") {
    return (
      <Card title="注文">
        <Empty
          why="注文を見る権限が、いまのアカウントにはありません。"
          next="必要な場合は、設定画面の権限表をご確認ください。"
        />
      </Card>
    );
  }

  if (err) {
    return (
      <Card title="注文">
        <ErrorBox what={err} onRetry={() => void load()} />
      </Card>
    );
  }

  const machi = rows.filter(
    (r) => r.orderStatus === "PENDING" || r.orderStatus === "PAID",
  ).length;
  const ichibu = rows.filter((r) => r.orderStatus === "PARTIALLY_FULFILLED").length;

  return (
    <div className="space-y-6">
      <WhatIsThis>
        ここは「何を頼まれたか」の一覧です。実際にどの箱へ入れて、いつ出したかは
        <b>発送管理</b>の画面で扱います。1つの注文から、発送は何件でも立ちます。
        3点のうち2点だけ先に送る、といった形はそのためのものです。
        <br />
        注文の中身は、この画面では直せません。注文は「そのとき何を頼んだか」の記録だからです。
        直す必要があるときは、取り消して立て直します。取り消しは記録に残りますが、書き換えは残りません。
      </WhatIsThis>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="注文（表示中）" value={rows.length} unit="件" />
        <Stat label="全部で" value={total} unit="件" />
        <Stat
          label="発送がまだの注文"
          value={machi}
          unit="件"
          tone={machi > 0 ? "warn" : "ok"}
          sub="発送を1つも作っていない、または未出荷"
        />
        <Stat
          label="一部だけ発送済み"
          value={ichibu}
          unit="件"
          tone={ichibu > 0 ? "warn" : "normal"}
          sub="残りが未発送のまま残っています"
        />
      </div>

      <Card
        title="注文の一覧"
        note={total === 0 ? "まだ1件もありません。" : `新しいものが上です（全${total}件）。`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={shibori}
              onChange={(e) => setShibori(e.target.value)}
              className={`${inputClass} w-auto py-2`}
              aria-label="状態でしぼりこむ"
            >
              <option value="">すべての状態</option>
              <option value="PENDING">受付済み</option>
              <option value="PAID">支払済み</option>
              <option value="PARTIALLY_FULFILLED">一部発送済み</option>
              <option value="FULFILLED">発送済み</option>
              <option value="CANCELLED">取消</option>
            </select>
            <Btn kind="ghost" onClick={() => void load()}>
              最新にする
            </Btn>
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty
            why={
              shibori
                ? "その状態の注文は、1件もありません。"
                : "注文は、まだ1件もありません。"
            }
            next="お客様が当選品の発送を依頼すると、ここに1件増えます。"
          />
        ) : (
          <>
            <Table
              head={[
                "注文番号",
                "お客様",
                "商品",
                "点数",
                "金額",
                "発送",
                "状態",
                "受付",
              ]}
            >
              {rows.map((r) => {
                const st = statusOf(r.orderStatus);
                return (
                  <Tr
                    key={r.id}
                    onOpen={() => setOpenId(r.id)}
                    active={openId === r.id}
                    tone={r.orderStatus === "PARTIALLY_FULFILLED" ? "warn" : undefined}
                  >
                    <Td className="num font-bold text-slate">{r.orderNumber}</Td>
                    <Td>{r.userName || "（不明）"}</Td>
                    <Td className="max-w-[18rem] truncate">{r.itemNames || "-"}</Td>
                    <Td className="num tabular-nums">{r.itemCount}</Td>
                    <Td className="num tabular-nums">{yen(r.subtotal)}</Td>
                    <Td className="num tabular-nums">
                      {r.shipmentCount === 0 ? (
                        <span className="text-slate3">まだ無し</span>
                      ) : (
                        `${r.shipmentCount}件`
                      )}
                    </Td>
                    <Td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </Td>
                    <Td className="num whitespace-nowrap">{nichiji(r.orderedAt)}</Td>
                  </Tr>
                );
              })}
            </Table>

            {/* 幅の狭い画面では、表ではなくカードで */}
            <div className="md:hidden">
              <Rows>
                {rows.map((r) => {
                  const st = statusOf(r.orderStatus);
                  return (
                    <RowCard key={r.id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(r.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="num font-bold text-slate">
                            {r.orderNumber}
                          </span>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </div>
                        <p className="mt-1 text-note text-slate2">{r.userName}</p>
                        <p className="mt-1 text-note text-slate3">
                          {r.itemNames}（{r.itemCount}点・{yen(r.subtotal)}）
                        </p>
                      </button>
                    </RowCard>
                  );
                })}
              </Rows>
            </div>
          </>
        )}
      </Card>

      {openId && (
        <OrderDrawer
          orderId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
          onNav={onNav}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   1件の中身
   ══════════════════════════════════════════════ */

function OrderDrawer({
  orderId,
  onClose,
  onChanged,
  onNav,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
  onNav?: (key: MenuKey, query?: Record<string, string>) => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [ships, setShips] = useState<ShipmentBrief[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [torikeshi, setTorikeshi] = useState(false);
  const [riyuu, setRiyuu] = useState("");
  const [okuriChuu, setOkuriChuu] = useState(false);
  const [shippai, setShippai] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/console/orders/${orderId}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        order?: OrderDetail;
        shipments?: ShipmentBrief[];
        message?: string;
      };
      if (!res.ok || !data.ok || !data.order) {
        setErr(data.message ?? "注文を読み込めませんでした。");
        return;
      }
      setOrder(data.order);
      setShips(data.shipments ?? []);
    } catch {
      setErr("注文を読み込めませんでした。");
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async () => {
    setShippai(null);
    setOkuriChuu(true);
    try {
      const res = await fetch(`/api/console/orders/${orderId}`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ action: "cancel", reason: riyuu }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setShippai(data.message ?? "取り消せませんでした。");
        return;
      }
      setTorikeshi(false);
      setRiyuu("");
      await load();
      onChanged();
    } catch {
      setShippai("取り消せませんでした。通信をご確認ください。");
    } finally {
      setOkuriChuu(false);
    }
  };

  const st = order ? statusOf(order.orderStatus) : null;

  /* まだ箱に入っていない商品があるか（分割発送の続きが要るか） */
  const nokori =
    order?.items.filter((i) => i.unassignedQuantity > 0 && i.status !== "CANCELLED") ?? [];

  return (
    <Drawer
      open
      title={order ? `注文 ${order.orderNumber}` : "注文"}
      note={order ? `${order.userName} 様・${nichiji(order.orderedAt)}` : undefined}
      onClose={onClose}
      foot={
        order && order.orderStatus !== "CANCELLED" ? (
          <div className="flex flex-wrap gap-2">
            <Btn
              kind="primary"
              onClick={() => onNav?.("shipping", { order: order.id })}
              disabled={nokori.length === 0}
              title={
                nokori.length === 0
                  ? "すべての商品が、すでに発送に入っています"
                  : undefined
              }
            >
              発送を作る（{nokori.length}点が未割当）
            </Btn>
            <Btn kind="danger" onClick={() => setTorikeshi((v) => !v)}>
              注文を取り消す
            </Btn>
          </div>
        ) : undefined
      }
    >
      {err && <ErrorBox what={err} onRetry={() => void load()} />}

      {!order && !err && <Skeleton rows={5} label="注文を読み込んでいます" />}

      {order && (
        <div className="space-y-6">
          {/* ── 注文の情報 ── */}
          <section>
            <h3 className="mb-2 text-note font-bold text-slate">注文の情報</h3>
            <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
              <KV k="注文番号" v={<span className="num">{order.orderNumber}</span>} />
              <KV k="お客様" v={order.userName || "（不明）"} />
              <KV k="受付日時" v={<span className="num">{nichiji(order.orderedAt)}</span>} />
              <KV k="種類" v={order.orderType === "PRIZE_SHIPPING" ? "当選品の発送" : order.orderType} />
              <KV k="状態" v={st ? <Badge tone={st.tone}>{st.label}</Badge> : "-"} />
            </div>
          </section>

          {/* ── 支払 ── */}
          <section>
            <h3 className="mb-2 text-note font-bold text-slate">支払</h3>
            <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
              <KV k="商品の合計" v={<span className="num">{yen(order.subtotal)}</span>} />
              <KV k="割引" v={<span className="num">{yen(order.discount)}</span>} />
              <KV k="ポイント利用" v={<span className="num">{order.pointUsed.toLocaleString()}pt</span>} />
              <KV k="お支払い" v={<span className="num font-bold">{yen(order.total)}</span>} />
              <KV k="支払の状態" v={PAYMENT_STATUS[order.paymentStatus] ?? order.paymentStatus} />
            </div>
          </section>

          {/* ── 商品と、発送の進み具合 ── */}
          <section>
            <h3 className="mb-2 text-note font-bold text-slate">
              商品（{order.items.length}点）
            </h3>
            <p className="mb-3 text-note leading-[1.85] text-slate3">
              「箱に入れた」と「家を出た」は別の数です。
              箱に入れただけでは、まだ発送済みにはなりません。
            </p>
            <Rows>
              {order.items.map((i) => {
                const is = itemStatusOf(i.status);
                return (
                  <RowCard key={i.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate">{i.name}</span>
                      <Badge tone={is.tone}>{is.label}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                      <KV k="数量" v={<span className="num">{i.quantity}</span>} />
                      <KV k="箱に入れた" v={<span className="num">{i.assignedQuantity}</span>} />
                      <KV k="発送済み" v={<span className="num">{i.shippedQuantity}</span>} />
                      <KV
                        k="未割当"
                        v={
                          <span
                            className={`num ${i.unassignedQuantity > 0 ? "font-bold text-warn-ink" : ""}`}
                          >
                            {i.unassignedQuantity}
                          </span>
                        }
                      />
                    </div>
                    {i.prizeId && (
                      <div className="mt-2">
                        <Btn
                          kind="ghost"
                          onClick={() => onNav?.("shipping", { trace: i.prizeId ?? "" })}
                        >
                          この商品を端から端まで辿る
                        </Btn>
                      </div>
                    )}
                  </RowCard>
                );
              })}
            </Rows>
          </section>

          {/* ── この注文から立っている発送 ── */}
          <section>
            <h3 className="mb-2 text-note font-bold text-slate">
              この注文の発送（{ships.length}件）
            </h3>
            {ships.length === 0 ? (
              <Empty
                why="この注文からは、まだ発送を1件も作っていません。"
                next="下の「発送を作る」から、送る商品を選んでください。全部選べば1回で終わり、一部だけ選べば分割発送になります。"
              />
            ) : (
              <Rows>
                {ships.map((s) => (
                  <RowCard key={s.id}>
                    <button
                      type="button"
                      onClick={() => onNav?.("shipping", { shipment: s.id })}
                      className="w-full text-left"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="num font-bold text-slate">
                          {s.shipmentNumber}
                        </span>
                        <Badge tone={s.status === "CANCELLED" ? "danger" : "blue"}>
                          {s.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-note text-slate3">
                        {s.itemCount}点・{s.carrier ?? "配送会社は未定"}・
                        {s.trackingNumber ? (
                          <span className="num">{s.trackingNumber}</span>
                        ) : (
                          "追跡番号はまだ"
                        )}
                      </p>
                    </button>
                  </RowCard>
                ))}
              </Rows>
            )}
          </section>

          {/* ── 取り消し ── */}
          {torikeshi && (
            <section className="rounded-xl border border-danger/30 bg-danger/6 px-4 py-4">
              <h3 className="text-note font-bold text-danger-ink">
                この注文を取り消します
              </h3>
              <p className="mt-1 text-note leading-[1.85] text-slate2">
                取り消すと、中の商品はお客様の「まだ選んでいない当選品」へ戻ります。
                すでに出荷が済んでいる商品が1点でもある注文は、取り消せません。
                <br />
                <b>理由は必ず残ります。</b>あとから「なぜ取り消したのか」を
                説明できるようにするためです。
              </p>
              <div className="mt-3">
                <Field label="取り消しの理由" required>
                  <input
                    className={inputClass}
                    value={riyuu}
                    onChange={(e) => setRiyuu(e.target.value)}
                    placeholder="例）お客様のご希望により、住所確定後に立て直します"
                  />
                </Field>
              </div>
              {shippai && (
                <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-note text-danger-ink">
                  {shippai}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Btn
                  kind="danger"
                  onClick={() => void cancel()}
                  disabled={riyuu.trim().length < 4 || okuriChuu}
                >
                  {okuriChuu ? "処理しています…" : "取り消す"}
                </Btn>
                <Btn kind="ghost" onClick={() => setTorikeshi(false)}>
                  やめる
                </Btn>
              </div>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
