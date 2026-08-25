/**
 * 発送管理（/client-demo/shipping）。
 *
 * ═══════════════════════════════════════════════
 * ★この画面と「注文」は、別の台帳です
 * ═══════════════════════════════════════════════
 *
 *   注文（/client-demo/orders）に出るのは「何を頼まれたか」。
 *   ここに出るのは「どの箱に、何を入れて、いつ出したか」。
 *
 *   1つの注文から、箱はいくつでも作れます。
 *
 *       注文A（商品1・商品2・商品3）
 *          ├─ 発送1（商品1・商品2）  ← 今日出した
 *          └─ 発送2（商品3）          ← 取り寄せ待ち
 *
 * ═══════════════════════════════════════════════
 * ★同じ商品を2つの箱に入れられないのは、この画面のおかげではありません
 * ═══════════════════════════════════════════════
 *
 *   ここでは、まだ箱に入っていない商品だけを選べるようにしています。
 *   これは親切のためであって、安全のためではありません。
 *
 *   本当に止めているのは、DBの索引（ux_shipment_items_live）と、
 *   条件つきの UPDATE が1行だけ動いたかの確認です。
 *   画面を通さずに入口を直接叩いても、そこで断られます。
 *
 *   だから、ここのチェックボックスの出し方を変えても、
 *   二重発送は起きません。逆に、ここを直したから安全になった、
 *   とは絶対に考えないこと。
 *
 * ★お届け先は、発送を作った瞬間の住所を写して持っています。
 *   会員があとで住所を変えても、この箱の宛先は動きません。
 *   動かしたいときは「お届け先を直す」から、理由を書いて直します。
 *   その1行は、監査ログに赤で残ります。乗っ取りは必ずここを通るからです。
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type Addr = { name: string; zip: string; addr: string; tel: string };

type ShipRow = {
  id: string;
  shipmentNumber: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  userName: string;
  itemNames: string;
  itemCount: number;
  zip: string;
  carrier: string | null;
  trackingNumber: string | null;
  status: string;
  requestedAt: string;
  shippedAt: string | null;
};

type ShipItem = {
  id: string;
  orderItemId: string;
  name: string;
  quantity: number;
  releasedAt: string | null;
};

type ShipDetail = {
  id: string;
  shipmentNumber: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  userName: string;
  address: Addr | null;
  carrier: string | null;
  trackingNumber: string | null;
  status: string;
  requestedAt: string;
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  note: string | null;
  updatedAt: string;
  items: ShipItem[];
};

type Hist = {
  seq: number;
  at: string;
  action: string;
  actorName: string;
  actorRole: string;
  summary: string;
  before: string | null;
  after: string | null;
  reason: string | null;
};

type OrderItem = {
  id: string;
  prizeId: string | null;
  name: string;
  quantity: number;
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
  orderStatus: string;
  items: OrderItem[];
};

type TraceOut = {
  from: { kind: string; id: string };
  customer: { id: string; name: string } | null;
  draw: {
    id: string;
    gachaTitle: string;
    at: string;
    price: number;
    pointBefore: number;
    pointAfter: number;
    grade: string;
    prizeName: string;
  } | null;
  prize: { id: string; name: string; grade: string; value: number; status: string; wonAt: string } | null;
  order: { id: string; orderNumber: string; orderedAt: string; orderStatus: string } | null;
  orderItem: {
    id: string;
    name: string;
    quantity: number;
    assignedQuantity: number;
    shippedQuantity: number;
    status: string;
  } | null;
  shipments: {
    id: string;
    shipmentNumber: string;
    status: string;
    carrier: string | null;
    trackingNumber: string | null;
    requestedAt: string;
    shippedAt: string | null;
    releasedAt: string | null;
  }[];
  pointLedger: { id: string; kind: string; delta: number; memo: string; at: string }[];
  audit: { seq: number; at: string; action: string; actorName: string; summary: string; reason: string | null }[];
};

/* ══════════════════════════════════════════════
   言葉と色
   ══════════════════════════════════════════════ */

type Tone = "neutral" | "ok" | "warn" | "danger" | "blue";

const SHIP_STATUS: Record<string, { label: string; tone: Tone }> = {
  REQUESTED: { label: "依頼受付", tone: "warn" },
  PREPARING: { label: "準備中", tone: "warn" },
  READY: { label: "発送待ち", tone: "blue" },
  SHIPPED: { label: "発送済み", tone: "ok" },
  IN_TRANSIT: { label: "配送中", tone: "ok" },
  DELIVERED: { label: "配達完了", tone: "ok" },
  CANCELLED: { label: "取消", tone: "danger" },
};

function shipStatusOf(s: string) {
  return SHIP_STATUS[s] ?? { label: s, tone: "neutral" as const };
}

/**
 * 次に進める先。
 *
 * ★ここを「どこへでも進める」にしないこと。
 *   準備中の箱を、いきなり配達完了にできる画面は、
 *   届いていない荷物を「届いた」にできる画面です。
 *   本当の順路はサーバーが持っています（NEXT_OK）。
 *   ここは、その順路を先に見せているだけです。
 */
const NEXT_OF: Record<string, { to: string; label: string }[]> = {
  REQUESTED: [{ to: "PREPARING", label: "準備をはじめる" }],
  PREPARING: [{ to: "READY", label: "箱づめ完了（発送待ちへ）" }],
  READY: [{ to: "SHIPPED", label: "発送を確定する（出荷）" }],
  SHIPPED: [
    { to: "IN_TRANSIT", label: "配送中にする" },
    { to: "DELIVERED", label: "配達完了にする" },
  ],
  IN_TRANSIT: [{ to: "DELIVERED", label: "配達完了にする" }],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * 配送会社。
 *
 * ★ここは、まだ本物の配送会社とはつながっていません。
 *   伝票データはCSVで出して、各社の送り状ソフトへ取り込む形です。
 *   つないだ気にさせないため、画面にもそう書いてあります。
 */
const CARRIERS = ["ヤマト運輸", "佐川急便", "日本郵便"];

const ACTION_LABEL: Record<string, string> = {
  ORDER_CREATE: "注文の受付",
  ORDER_CANCEL: "注文の取り消し",
  SHIPMENT_CREATE: "発送の作成",
  SHIPMENT_SPLIT: "分割発送の作成",
  SHIPMENT_TRACKING_SET: "追跡番号の登録",
  SHIPMENT_SHIPPED: "発送の確定（出荷）",
  SHIPMENT_STATUS: "発送状態の更新",
  SHIPMENT_ADDRESS_CHANGE: "発送先の変更",
  SHIPMENT_CANCEL: "発送の取り消し",
  DRAW: "抽選",
};

function nichiji(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export default function ShipmentsScreen({
  onNav,
  query,
}: {
  onNav?: (key: MenuKey, q?: Record<string, string>) => void;
  /** 注文画面から「この注文の発送を作る」で渡ってくる目印 */
  query?: Record<string, string>;
}) {
  const [rows, setRows] = useState<ShipRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [todo, setTodo] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  /** "" = 全部 / "todo" = 発送待ち / それ以外は状態そのもの */
  const [shibori, setShibori] = useState<string>("todo");

  const [openId, setOpenId] = useState<string | null>(null);
  const [makeFor, setMakeFor] = useState<string | null>(null);
  const [traceKey, setTraceKey] = useState<string | null>(null);
  const [erabi, setErabi] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setErr(null);
    try {
      const q =
        shibori === "todo"
          ? "?todo=1"
          : shibori === ""
            ? ""
            : `?status=${encodeURIComponent(shibori)}`;
      const res = await fetch(`/api/console/shipments${q}`, { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        shipments?: ShipRow[];
        total?: number;
        todo?: number;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        /* ★権限が足りないだけの状態を、赤いエラーにしないこと。
             壊れてはいません。断られているだけです。 */
        setErr(res.status === 403 ? "KENGEN" : (data.message ?? "発送を読み込めませんでした。"));
        setRows([]);
        return;
      }
      setRows(data.shipments ?? []);
      setTotal(data.total ?? 0);
      setTodo(data.todo ?? 0);
    } catch {
      setErr("発送を読み込めませんでした。");
      setRows([]);
    }
  }, [shibori]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 注文画面や、辿るボタンから飛んできたとき */
  useEffect(() => {
    if (query?.order) setMakeFor(query.order);
    if (query?.trace) setTraceKey(query.trace);
    if (query?.shipment) setOpenId(query.shipment);
  }, [query]);

  const list = rows ?? [];

  /*
   * ★「出荷がまだ」を、いま画面に出ている分から数えないこと。
   *
   *   絞り込みを「発送済み」にした瞬間、画面には発送済みしか並びません。
   *   その並びから数えると、出荷がまだの箱が本当は残っているのに、
   *   この欄が 0 件になります。
   *
   *   0 件と出た日は、誰もその箱を出しません。
   *   だから、会社全体の件数（サーバーが数えた todo）を出します。
   */
  const machi = todo;
  const bangoNashi = useMemo(
    () => list.filter((r) => r.status !== "CANCELLED" && !r.trackingNumber).length,
    [list],
  );

  const erabiRows = list.filter((r) => erabi.has(r.id));

  const toggle = (id: string) => {
    setErabi((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ── 伝票用CSV（#14）──────────────────────────
       ★「配送業者と接続済み」に見せないこと。
         今つながっているのは、各社の送り状ソフトが読める
         CSVを出すところまでです。押した人が
         「これで集荷が来る」と思う画面にしてはいけません。 */
  const [csvChu, setCsvChu] = useState(false);
  const csv = async () => {
    if (erabiRows.length === 0) return;
    setCsvChu(true);
    try {
      const lines = [
        "発送番号,注文番号,お名前,郵便番号,ご住所,お電話,品名,点数,配送会社,追跡番号",
      ];
      for (const r of erabiRows) {
        const res = await fetch(`/api/console/shipments/${r.id}`, { cache: "no-store" });
        const d = (await res.json()) as { ok?: boolean; shipment?: ShipDetail };
        const s = d.shipment;
        const a = s?.address ?? null;
        const cell = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
        lines.push(
          [
            cell(r.shipmentNumber),
            cell(r.orderNumber),
            cell(a?.name ?? r.userName),
            cell(a?.zip ?? r.zip),
            cell(a?.addr ?? ""),
            cell(a?.tel ?? ""),
            cell(r.itemNames),
            String(r.itemCount),
            cell(r.carrier ?? ""),
            cell(r.trackingNumber ?? ""),
          ].join(","),
        );
      }
      /* Excelで開いても文字が化けないよう、先頭に目印（BOM）を付ける。
         ★この目印を、本文に直接書かないこと。
           見えない文字なので、他の場所へ貼り付けられても誰も気づけません。
           見張り番（tests/noInvisibleChars.test.ts）が本文を止めます。
           ここは「文字コード番号から作る」形にして、目印だと分かるようにします */
      const BOM = String.fromCharCode(0xfeff);
      const blob = new Blob([BOM + lines.join("\r\n")], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `denpyo-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setCsvChu(false);
    }
  };

  if (err === "KENGEN") {
    return (
      <Empty
        why="発送を見る権限がありません。"
        next="発送を見られるのは、運営・サポート・経理・管理者です。担当を切り替えるか、管理者に権限をご相談ください。"
      />
    );
  }

  if (err) {
    return <ErrorBox what={err} onRetry={() => void load()} />;
  }

  if (rows === null) {
    return <Skeleton rows={6} label="発送を読み込んでいます" />;
  }

  return (
    <div className="space-y-4">
      <WhatIsThis>
        ここは「箱の台帳」です。1つの注文を何回かに分けて送れます。
        お届け先は、箱を作った時点の住所を写して持つので、
        会員があとで住所を変えても、確定済みの宛先は動きません。
      </WhatIsThis>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="表示中の発送" value={list.length} unit="件" />
        <Stat label="全部で" value={total} unit="件" sub="取消も含みます" />
        <Stat
          label="出荷がまだ"
          value={machi}
          unit="件"
          tone={machi > 0 ? "warn" : "ok"}
          sub="依頼受付・準備中・発送待ち（絞り込みに関係なく全件）"
        />
        <Stat
          label="追跡番号がまだ"
          value={bangoNashi}
          unit="件"
          tone={bangoNashi > 0 ? "warn" : "normal"}
          sub="番号なしでは出荷できません"
        />
      </div>

      <Card
        title="発送の一覧"
        note="行を押すと、中身と操作が開きます。"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={shibori}
              onChange={(e) => {
                setShibori(e.target.value);
                setErabi(new Set());
              }}
              className={inputClass}
              aria-label="絞り込み"
            >
              <option value="todo">出荷がまだのもの</option>
              <option value="">全部</option>
              <option value="REQUESTED">依頼受付</option>
              <option value="PREPARING">準備中</option>
              <option value="READY">発送待ち</option>
              <option value="SHIPPED">発送済み</option>
              <option value="IN_TRANSIT">配送中</option>
              <option value="DELIVERED">配達完了</option>
              <option value="CANCELLED">取消</option>
            </select>
            <Btn kind="ghost" onClick={() => setTraceKey("")}>
              追跡番号から辿る
            </Btn>
            <Btn
              kind="normal"
              disabled={erabiRows.length === 0 || csvChu}
              onClick={() => void csv()}
              title="選んだ発送を、送り状ソフト用のCSVにします"
            >
              {csvChu ? "作成中…" : `伝票用CSV（${erabiRows.length}件）`}
            </Btn>
          </div>
        }
      >
        {list.length === 0 ? (
          <Empty
            why="この条件に当てはまる発送はありません。"
            next="注文画面から「発送を作る」で、箱を1つ作れます。"
          />
        ) : (
          <>
            <Table
              head={[
                "選ぶ",
                "発送番号",
                "注文番号",
                "お客様",
                "中身",
                "配送会社・追跡番号",
                "状態",
                "依頼日時",
              ]}
            >
              {list.map((r) => (
                <Tr
                  key={r.id}
                  onOpen={() => setOpenId(r.id)}
                  active={openId === r.id}
                  tone={r.status === "CANCELLED" ? "danger" : undefined}
                >
                  <Td>
                    <span
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={erabi.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`${r.shipmentNumber} を選ぶ`}
                        className="h-4 w-4 accent-blue-ink"
                      />
                    </span>
                  </Td>
                  <Td className="num">{r.shipmentNumber}</Td>
                  <Td className="num">{r.orderNumber}</Td>
                  <Td>{r.userName}</Td>
                  <Td>
                    {r.itemNames}
                    <span className="text-note text-slate3">（{r.itemCount}点）</span>
                  </Td>
                  <Td>
                    {r.trackingNumber ? (
                      <span className="num">
                        {r.carrier} {r.trackingNumber}
                      </span>
                    ) : (
                      <span className="text-slate3">未登録</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={shipStatusOf(r.status).tone}>
                      {shipStatusOf(r.status).label}
                    </Badge>
                  </Td>
                  <Td className="num">{nichiji(r.requestedAt)}</Td>
                </Tr>
              ))}
            </Table>

            <Rows>
              {list.map((r) => (
                <RowCard key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(r.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-[0.9375rem] font-bold text-slate">
                        {r.shipmentNumber}
                      </span>
                      <Badge tone={shipStatusOf(r.status).tone}>
                        {shipStatusOf(r.status).label}
                      </Badge>
                    </div>
                    <p className="mt-1 text-note text-slate2">
                      {r.userName} ／ {r.itemNames}（{r.itemCount}点）
                    </p>
                    <p className="mt-0.5 text-note text-slate3">
                      {r.trackingNumber
                        ? `${r.carrier} ${r.trackingNumber}`
                        : "追跡番号は未登録"}
                    </p>
                  </button>
                </RowCard>
              ))}
            </Rows>
          </>
        )}
      </Card>

      {openId && (
        <ShipDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
          onNav={onNav}
        />
      )}

      {makeFor !== null && (
        <MakeDrawer
          orderId={makeFor}
          onClose={() => setMakeFor(null)}
          onDone={(shipmentId) => {
            setMakeFor(null);
            void load();
            setOpenId(shipmentId);
          }}
        />
      )}

      {traceKey !== null && (
        <TraceDrawer first={traceKey} onClose={() => setTraceKey(null)} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   発送を作る（#13 発送処理）
   ══════════════════════════════════════════════ */

function MakeDrawer({
  orderId,
  onClose,
  onDone,
}: {
  orderId: string;
  onClose: () => void;
  onDone: (shipmentId: string) => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [carrier, setCarrier] = useState("");
  const [memo, setMemo] = useState("");
  const [chu, setChu] = useState(false);

  useEffect(() => {
    let ikiteru = true;
    (async () => {
      setErr(null);
      try {
        const res = await fetch(`/api/console/orders/${orderId}`, { cache: "no-store" });
        const d = (await res.json()) as { ok?: boolean; order?: OrderDetail; message?: string };
        if (!ikiteru) return;
        if (!res.ok || !d.ok || !d.order) {
          setErr(d.message ?? "注文が見つかりません。");
          return;
        }
        setOrder(d.order);
        /* まだ箱に入っていないものを、はじめから選んでおく。
           全部選べば1回で終わり、外せば分割になります。 */
        setPick(
          new Set(
            d.order.items
              .filter((i) => i.unassignedQuantity > 0 && i.status !== "CANCELLED")
              .map((i) => i.id),
          ),
        );
      } catch {
        if (ikiteru) setErr("注文を読み込めませんでした。");
      }
    })();
    return () => {
      ikiteru = false;
    };
  }, [orderId]);

  const nokori = (order?.items ?? []).filter(
    (i) => i.unassignedQuantity > 0 && i.status !== "CANCELLED",
  );

  const tsukuru = async () => {
    if (pick.size === 0) return;
    setChu(true);
    setErr(null);
    try {
      const res = await fetch("/api/console/shipments", {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({
          orderId,
          orderItemIds: Array.from(pick),
          carrier: carrier || null,
          note: memo || null,
        }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        shipmentId?: string;
        message?: string;
      };
      if (!res.ok || !d.ok || !d.shipmentId) {
        setErr(d.message ?? "発送を作れませんでした。");
        return;
      }
      onDone(d.shipmentId);
    } catch {
      setErr("発送を作れませんでした。");
    } finally {
      setChu(false);
    }
  };

  return (
    <Drawer
      open
      title="発送を作る"
      note="箱に入れる商品を選びます。一部だけ選べば、分割発送になります。"
      onClose={onClose}
      foot={
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={onClose}>
            やめる
          </Btn>
          <Btn kind="primary" full disabled={pick.size === 0 || chu} onClick={() => void tsukuru()}>
            {chu ? "作成中…" : `この${pick.size}点で発送を作る`}
          </Btn>
        </div>
      }
    >
      {err && <ErrorBox what={err} />}

      {!order ? (
        <Skeleton rows={4} label="注文を読み込んでいます" />
      ) : (
        <div className="space-y-4">
          <Card title="どの注文か">
            <KV k="注文番号" v={<span className="num">{order.orderNumber}</span>} />
            <KV k="お客様" v={order.userName} />
            <KV k="ご注文日時" v={<span className="num">{nichiji(order.orderedAt)}</span>} />
          </Card>

          <Card
            title="箱に入れる商品"
            note="すでに別の箱に入っている商品は、ここに出ません。"
          >
            {nokori.length === 0 ? (
              <Empty
                why="この注文に、まだ箱に入っていない商品はありません。"
                next="すべての商品が、いずれかの発送に入っています。"
              />
            ) : (
              <ul className="space-y-2">
                {nokori.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-start gap-3 rounded-lg border border-edge2 bg-paper2 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={pick.has(i.id)}
                      onChange={() =>
                        setPick((prev) => {
                          const next = new Set(prev);
                          if (next.has(i.id)) next.delete(i.id);
                          else next.add(i.id);
                          return next;
                        })
                      }
                      id={`pick-${i.id}`}
                      className="mt-1 h-4 w-4 accent-blue-ink"
                    />
                    <label htmlFor={`pick-${i.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block text-[0.9375rem] font-semibold text-slate">
                        {i.name}
                      </span>
                      <span className="block text-note text-slate3">
                        数量 {i.quantity} ／ 未割当 {i.unassignedQuantity}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="配送会社（あとからでも大丈夫）"
            note="追跡番号は、箱を作ったあとに登録します。"
          >
            <Field label="配送会社">
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                className={inputClass}
              >
                <option value="">あとで決める</option>
                {CARRIERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="社内メモ" note="お客様には見えません。">
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                className={inputClass}
                placeholder="例：割れ物。緩衝材を多めに"
              />
            </Field>
          </Card>
        </div>
      )}
    </Drawer>
  );
}

/* ══════════════════════════════════════════════
   発送1件（#12 発送詳細）
   ══════════════════════════════════════════════ */

function ShipDrawer({
  id,
  onClose,
  onChanged,
  onNav,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onNav?: (key: MenuKey, q?: Record<string, string>) => void;
}) {
  const [s, setS] = useState<ShipDetail | null>(null);
  const [hist, setHist] = useState<Hist[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [shirase, setShirase] = useState<string | null>(null);
  const [chu, setChu] = useState(false);

  /* 追跡番号 */
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [trackWake, setTrackWake] = useState("");

  /* お届け先の変更 */
  const [addrHiraku, setAddrHiraku] = useState(false);
  const [addr, setAddr] = useState<Addr>({ name: "", zip: "", addr: "", tel: "" });
  const [addrWake, setAddrWake] = useState("");

  /* 取り消し */
  const [keshiWake, setKeshiWake] = useState("");
  const [keshiHiraku, setKeshiHiraku] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/console/shipments/${id}`, { cache: "no-store" });
      const d = (await res.json()) as {
        ok?: boolean;
        shipment?: ShipDetail;
        history?: Hist[];
        message?: string;
      };
      if (!res.ok || !d.ok || !d.shipment) {
        setErr(d.message ?? "発送が見つかりません。");
        return;
      }
      setS(d.shipment);
      setHist(d.history ?? []);
      setCarrier(d.shipment.carrier ?? "");
      setTracking(d.shipment.trackingNumber ?? "");
      if (d.shipment.address) setAddr(d.shipment.address);
    } catch {
      setErr("発送を読み込めませんでした。");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 入口をたたく。断られたら、その言葉をそのまま出す */
  const yaru = async (body: Record<string, unknown>, seiko: string) => {
    setChu(true);
    setErr(null);
    setShirase(null);
    try {
      const res = await fetch(`/api/console/shipments/${id}`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        setErr(d.message ?? "この操作は行えませんでした。");
        return false;
      }
      setShirase(seiko);
      await load();
      onChanged();
      return true;
    } catch {
      setErr("この操作は行えませんでした。");
      return false;
    } finally {
      setChu(false);
    }
  };

  const st = s ? shipStatusOf(s.status) : null;
  const susumeru = s ? (NEXT_OF[s.status] ?? []) : [];
  const dashita = s ? ["SHIPPED", "IN_TRANSIT", "DELIVERED"].includes(s.status) : false;
  const owari = s ? s.status === "CANCELLED" || s.status === "DELIVERED" : false;

  return (
    <Drawer
      open
      title={s ? `発送 ${s.shipmentNumber}` : "発送"}
      note={s ? `${s.userName} 様ぶん・${s.items.length}点` : undefined}
      onClose={onClose}
      foot={
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={onClose}>
            閉じる
          </Btn>
          {s && (
            <Btn kind="normal" full onClick={() => onNav?.("orders", { open: s.orderId })}>
              この発送のもとの注文を見る
            </Btn>
          )}
        </div>
      }
    >
      {err && <ErrorBox what={err} />}
      {shirase && (
        <div className="mb-3 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-note text-ok-ink">
          {shirase}
        </div>
      )}

      {!s ? (
        <Skeleton rows={5} label="発送を読み込んでいます" />
      ) : (
        <div className="space-y-4">
          <Card title="この発送のこと">
            <KV
              k="状態"
              v={st ? <Badge tone={st.tone}>{st.label}</Badge> : "-"}
            />
            <KV k="発送番号" v={<span className="num">{s.shipmentNumber}</span>} />
            <KV k="注文番号" v={<span className="num">{s.orderNumber}</span>} />
            <KV k="依頼を受けた" v={<span className="num">{nichiji(s.requestedAt)}</span>} />
            <KV k="箱づめ完了" v={<span className="num">{nichiji(s.packedAt)}</span>} />
            <KV k="出荷した" v={<span className="num">{nichiji(s.shippedAt)}</span>} />
            <KV k="配達完了" v={<span className="num">{nichiji(s.deliveredAt)}</span>} />
            {s.note && <KV k="社内メモ" v={s.note} />}
          </Card>

          <Card
            title="お届け先"
            note="この住所は、発送を作った時点の写しです。会員が住所を変えても、ここは動きません。"
          >
            {!s.address ? (
              <Empty
                why="お届け先を読み取れませんでした。"
                next="この発送は、住所の形が壊れています。お客様にご確認のうえ、下の「お届け先を直す」から入れ直してください。"
              />
            ) : (
              <>
                <KV k="お名前" v={s.address.name} />
                <KV k="郵便番号" v={<span className="num">{s.address.zip}</span>} />
                <KV k="ご住所" v={s.address.addr} />
                <KV k="お電話" v={<span className="num">{s.address.tel}</span>} />
              </>
            )}

            {!dashita && s.status !== "CANCELLED" && (
              <div className="mt-3">
                {!addrHiraku ? (
                  <Btn kind="ghost" onClick={() => setAddrHiraku(true)}>
                    お届け先を直す
                  </Btn>
                ) : (
                  <div className="space-y-2 rounded-lg border border-warn/35 bg-warn/6 p-3">
                    <p className="text-note text-warn-ink">
                      お届け先の変更は、監査ログに強い印で残ります。
                      お客様ご本人からのご依頼であることを確かめてから行ってください。
                    </p>
                    <Field label="お名前" required>
                      <input
                        value={addr.name}
                        onChange={(e) => setAddr({ ...addr, name: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="郵便番号" required>
                      <input
                        value={addr.zip}
                        onChange={(e) => setAddr({ ...addr, zip: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="ご住所" required>
                      <input
                        value={addr.addr}
                        onChange={(e) => setAddr({ ...addr, addr: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="お電話" required>
                      <input
                        value={addr.tel}
                        onChange={(e) => setAddr({ ...addr, tel: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="直す理由" note="4文字以上。あとから読む人のために書きます。" required>
                      <input
                        value={addrWake}
                        onChange={(e) => setAddrWake(e.target.value)}
                        className={inputClass}
                        placeholder="例：お客様より転居のご連絡があったため"
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Btn kind="ghost" onClick={() => setAddrHiraku(false)}>
                        やめる
                      </Btn>
                      <Btn
                        kind="danger"
                        disabled={chu || addrWake.trim().length < 4}
                        onClick={async () => {
                          const ok = await yaru(
                            { action: "address", address: addr, reason: addrWake },
                            "お届け先を直しました。",
                          );
                          if (ok) {
                            setAddrHiraku(false);
                            setAddrWake("");
                          }
                        }}
                      >
                        お届け先を直す
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            )}

            {dashita && (
              <p className="mt-3 text-note text-slate3">
                すでに出荷したため、お届け先は直せません。
                行き先を変えるには、配送会社への連絡が必要です。
              </p>
            )}
          </Card>

          <Card title="この箱の中身" note="取り消して外した商品も、記録として残します。">
            <ul className="space-y-2">
              {s.items.map((i) => (
                <li
                  key={i.id}
                  className="rounded-lg border border-edge2 bg-paper2 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[0.9375rem] font-semibold text-slate">
                      {i.name}
                    </span>
                    {i.releasedAt ? (
                      <Badge tone="danger">この箱から外れています</Badge>
                    ) : (
                      <Badge tone="neutral">{i.quantity}点</Badge>
                    )}
                  </div>
                  {i.releasedAt && (
                    <p className="mt-1 text-note text-slate3">
                      外した日時：{nichiji(i.releasedAt)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="配送会社と追跡番号"
            note="出荷を確定するには、追跡番号が要ります。番号のない「発送済み」は、お客様から見て確かめようがないためです。"
          >
            {s.status === "CANCELLED" ? (
              <p className="text-note text-slate3">
                取り消された発送には、追跡番号を登録できません。
              </p>
            ) : (
              <>
                <Field label="配送会社" required>
                  <select
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">選んでください</option>
                    {CARRIERS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="追跡番号" required>
                  <input
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                    className={inputClass}
                    placeholder="例：1234-5678-9012"
                  />
                </Field>
                {s.trackingNumber && (
                  <Field
                    label="変更する理由"
                    note="すでに登録済みの番号を直すときだけ必要です（4文字以上）。"
                  >
                    <input
                      value={trackWake}
                      onChange={(e) => setTrackWake(e.target.value)}
                      className={inputClass}
                      placeholder="例：貼り間違えのため、正しい番号に直す"
                    />
                  </Field>
                )}
                <Btn
                  kind="normal"
                  disabled={chu || carrier === "" || tracking.trim() === ""}
                  onClick={() =>
                    void yaru(
                      {
                        action: "tracking",
                        carrier,
                        trackingNumber: tracking,
                        reason: trackWake || undefined,
                      },
                      "追跡番号を登録しました。お客様の画面にも出ます。",
                    )
                  }
                >
                  追跡番号を登録する
                </Btn>
              </>
            )}
          </Card>

          {susumeru.length > 0 && (
            <Card
              title="状態を進める"
              note="順路の外へは進めません（準備中から、いきなり配達完了にはできません）。"
            >
              <div className="flex flex-wrap gap-2">
                {susumeru.map((n) => (
                  <Btn
                    key={n.to}
                    kind={n.to === "SHIPPED" ? "primary" : "normal"}
                    disabled={chu}
                    onClick={() =>
                      void yaru(
                        { action: "advance", to: n.to },
                        n.to === "SHIPPED"
                          ? "出荷を確定しました。お客様の画面が「発送済み」になります。"
                          : "状態を進めました。",
                      )
                    }
                  >
                    {n.label}
                  </Btn>
                ))}
              </div>
            </Card>
          )}

          {!owari && (
            <Card
              title="この発送を取り消す"
              note="中の商品は、発送待ちへ戻ります。箱の記録は消えません。"
            >
              {!keshiHiraku ? (
                <Btn kind="ghost" onClick={() => setKeshiHiraku(true)}>
                  取り消す
                </Btn>
              ) : (
                <div className="space-y-2">
                  <Field label="取り消す理由" note="4文字以上" required>
                    <input
                      value={keshiWake}
                      onChange={(e) => setKeshiWake(e.target.value)}
                      className={inputClass}
                      placeholder="例：商品に傷が見つかったため、入れ直す"
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Btn kind="ghost" onClick={() => setKeshiHiraku(false)}>
                      やめる
                    </Btn>
                    <Btn
                      kind="danger"
                      disabled={chu || keshiWake.trim().length < 4}
                      onClick={async () => {
                        const ok = await yaru(
                          { action: "cancel", reason: keshiWake },
                          "発送を取り消しました。中の商品は、また発送できます。",
                        );
                        if (ok) {
                          setKeshiHiraku(false);
                          setKeshiWake("");
                        }
                      }}
                    >
                      この発送を取り消す
                    </Btn>
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card title="この発送の記録" note="誰が、いつ、何をしたか。消せません。">
            {hist.length === 0 ? (
              <Empty why="まだ記録はありません。" />
            ) : (
              <ul className="space-y-2">
                {[...hist].reverse().map((h) => (
                  <li
                    key={h.seq}
                    className="rounded-lg border border-edge2 bg-paper2 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={h.action === "SHIPMENT_ADDRESS_CHANGE" ? "danger" : "neutral"}
                      >
                        {ACTION_LABEL[h.action] ?? h.action}
                      </Badge>
                      <span className="num text-note text-slate3">{nichiji(h.at)}</span>
                    </div>
                    <p className="mt-1 text-note text-slate2">{h.summary}</p>
                    <p className="mt-0.5 text-note text-slate3">
                      {h.actorName}（{h.actorRole}）
                    </p>
                    {h.reason && (
                      <p className="mt-0.5 text-note text-slate2">理由：{h.reason}</p>
                    )}
                    {(h.before || h.after) && (
                      <p className="mt-0.5 text-note text-slate3">
                        {h.before ?? "（なし）"} → {h.after ?? "（なし）"}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Drawer>
  );
}

/* ══════════════════════════════════════════════
   端から端まで辿る（#21・追跡性）
   ══════════════════════════════════════════════ */

const TRACE_KINDS: { key: string; label: string }[] = [
  { key: "tracking", label: "追跡番号" },
  { key: "shipmentNumber", label: "発送番号" },
  { key: "orderNumber", label: "注文番号" },
  { key: "prize", label: "景品ID" },
  { key: "draw", label: "抽選ID" },
  { key: "order", label: "注文ID" },
  { key: "shipment", label: "発送ID" },
];

function TraceDrawer({ first, onClose }: { first: string; onClose: () => void }) {
  const [kind, setKind] = useState(first.startsWith("prz_") ? "prize" : "tracking");
  const [key, setKey] = useState(first);
  const [out, setOut] = useState<TraceOut | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chu, setChu] = useState(false);

  const hiku = useCallback(async (k: string, v: string) => {
    if (v.trim() === "") return;
    setChu(true);
    setErr(null);
    setOut(null);
    try {
      const res = await fetch(
        `/api/console/trace?${k}=${encodeURIComponent(v.trim())}`,
        { cache: "no-store" },
      );
      const d = (await res.json()) as { ok?: boolean; trace?: TraceOut; message?: string };
      if (!res.ok || !d.ok || !d.trace) {
        setErr(d.message ?? "この手がかりでは、何も見つかりませんでした。");
        return;
      }
      setOut(d.trace);
    } catch {
      setErr("辿れませんでした。");
    } finally {
      setChu(false);
    }
  }, []);

  useEffect(() => {
    if (first.trim() !== "") {
      void hiku(first.startsWith("prz_") ? "prize" : "tracking", first);
    }
  }, [first, hiku]);

  return (
    <Drawer
      open
      title="端から端まで辿る"
      note="1つの手がかりから、抽選・景品・注文・発送・ポイント・記録まで並べます。"
      onClose={onClose}
      foot={
        <Btn kind="ghost" full onClick={onClose}>
          閉じる
        </Btn>
      }
    >
      <div className="space-y-4">
        <Card title="手がかり">
          <Field label="種類">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={inputClass}
            >
              {TRACE_KINDS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="番号・ID">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className={inputClass}
              placeholder="例：1234-5678-9012"
            />
          </Field>
          <Btn kind="primary" disabled={chu || key.trim() === ""} onClick={() => void hiku(kind, key)}>
            {chu ? "探しています…" : "辿る"}
          </Btn>
        </Card>

        {err && <ErrorBox what={err} />}

        {out && (
          <>
            <Card title="お客様">
              <KV k="お名前" v={out.customer?.name ?? "-"} />
            </Card>

            <Card title="抽選">
              {!out.draw ? (
                <Empty why="この品物に、抽選の記録はありません。" />
              ) : (
                <>
                  <KV k="ガチャ" v={out.draw.gachaTitle} />
                  <KV k="引いた日時" v={<span className="num">{nichiji(out.draw.at)}</span>} />
                  <KV k="出た景品" v={`${out.draw.prizeName}（${out.draw.grade}）`} />
                  <KV
                    k="ポイント"
                    v={
                      <span className="num">
                        {out.draw.pointBefore.toLocaleString()} →{" "}
                        {out.draw.pointAfter.toLocaleString()}
                      </span>
                    }
                  />
                </>
              )}
            </Card>

            <Card title="景品">
              {!out.prize ? (
                <Empty why="景品の記録はありません。" />
              ) : (
                <>
                  <KV k="品名" v={out.prize.name} />
                  <KV k="等級" v={out.prize.grade} />
                  <KV k="いまの状態" v={out.prize.status} />
                </>
              )}
            </Card>

            <Card title="注文">
              {!out.order ? (
                <Empty why="まだ発送は頼まれていません。" />
              ) : (
                <>
                  <KV k="注文番号" v={<span className="num">{out.order.orderNumber}</span>} />
                  <KV k="ご注文日時" v={<span className="num">{nichiji(out.order.orderedAt)}</span>} />
                  <KV k="注文の状態" v={out.order.orderStatus} />
                  {out.orderItem && (
                    <KV
                      k="この明細"
                      v={`${out.orderItem.name}（数量${out.orderItem.quantity}／箱に入れた${out.orderItem.assignedQuantity}／発送済み${out.orderItem.shippedQuantity}）`}
                    />
                  )}
                </>
              )}
            </Card>

            <Card title="発送" note="取り消して外れたものも、外した日時つきで出します。">
              {out.shipments.length === 0 ? (
                <Empty why="まだ箱に入っていません。" />
              ) : (
                <ul className="space-y-2">
                  {out.shipments.map((sh) => (
                    <li
                      key={sh.id}
                      className="rounded-lg border border-edge2 bg-paper2 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num text-[0.9375rem] font-bold text-slate">
                          {sh.shipmentNumber}
                        </span>
                        <Badge tone={shipStatusOf(sh.status).tone}>
                          {shipStatusOf(sh.status).label}
                        </Badge>
                        {sh.releasedAt && <Badge tone="danger">この箱からは外れました</Badge>}
                      </div>
                      <p className="mt-1 text-note text-slate3">
                        {sh.trackingNumber
                          ? `${sh.carrier} ${sh.trackingNumber}`
                          : "追跡番号は未登録"}
                        ／ 依頼 {nichiji(sh.requestedAt)}
                        {sh.shippedAt ? ` ／ 出荷 ${nichiji(sh.shippedAt)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="ポイントの動き">
              {out.pointLedger.length === 0 ? (
                <Empty why="関係するポイントの動きはありません。" />
              ) : (
                <ul className="space-y-1">
                  {out.pointLedger.map((p) => (
                    <li key={p.id} className="text-note text-slate2">
                      <span className="num">{nichiji(p.at)}</span>
                      <span className="num">
                        {p.delta > 0 ? "+" : ""}
                        {p.delta.toLocaleString()}
                      </span>
                      　{p.memo}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="記録（監査ログ）">
              {out.audit.length === 0 ? (
                <Empty why="記録はありません。" />
              ) : (
                <ul className="space-y-1">
                  {out.audit.map((a) => (
                    <li key={a.seq} className="text-note text-slate2">
                      <span className="num">{nichiji(a.at)}</span>
                      {ACTION_LABEL[a.action] ?? a.action}　{a.summary}
                      {a.reason ? `（理由：${a.reason}）` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </Drawer>
  );
}
