/**
 * ユーザー側（実際に販売される画面）のマイページ。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面は、管理画面と同じ材料でできています
 * ═══════════════════════════════════════════════════════
 *
 *   ユーザー側だけのダミーデータは、1つも持っていません。
 *   管理サイトが見ているのと同じ state を、そのまま見ています。
 *
 *   だから、ここで「発送する」を押した瞬間に、
 *   管理サイトの未発送が1件増えます。作り込んだ演出ではありません。
 *
 *   ★ここを別々のダミーデータにしないこと。
 *     画面ごとに数字を持つと、必ずどこかでズレます。
 *     ズレた画面は、お客様から見れば「間違った案内」です。
 *
 * ═══════════════════════════════════════════════════════
 * ★見た目は、管理画面に寄せないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ここを使うのは、運営者ではなくお客様です。
 *   表がびっしり並んだ画面は、スマホで初めて見た人には読めません。
 *
 *     ・1画面に、大きく1つのことだけ
 *     ・押せるものは、指で押せる大きさにする
 *     ・いまどうなっているかを、色ではなく文字でも書く
 *
 * ═══════════════════════════════════════════════════════
 * ★お金が動く操作は、1タップで確定させないこと
 * ═══════════════════════════════════════════════════════
 *
 *   発送も、ポイント交換も、後から取り消せません。
 *   だから必ず、確認の画面を1枚はさみます。
 *
 *     発送する      → お届け先を確認 → 依頼する
 *     ポイントに交換 → 何ptになるか確認 → 交換する
 *
 *   確認の画面には「交換すると、もう発送はできません」と書きます。
 *   押してから知るのでは遅いからです。
 */

"use client";

import { useState } from "react";
import type { ConsoleAction, ConsoleState, Address, Prize } from "@/lib/console/state";
import {
  PREVIEW_USER_ID,
  PRIZE_STATUS_LABEL,
  POINT_KIND_LABEL,
  DEMO_ADDRESS,
} from "@/lib/console/state";
import { ORDER_STATUS_LABEL } from "@/lib/console/support";

/* ══════════════════════════════════════════════
   画面の行き先
   ══════════════════════════════════════════════ */

type View =
  | { name: "home" }
  | { name: "prizes" }
  | { name: "prize"; id: string }
  | { name: "ship"; id: string }
  | { name: "shipConfirm"; id: string; address: Address }
  | { name: "exchange"; id: string }
  | { name: "orders" }
  | { name: "support" }
  | { name: "points" };

/** 等級ごとの見た目。S賞がいちばん強い */
const GRADE_STYLE: Record<string, string> = {
  S: "bg-gradient-to-br from-[#B8912F] to-[#8A6A17] text-white",
  A: "bg-gradient-to-br from-[#7C6BC4] to-[#514296] text-white",
  B: "bg-gradient-to-br from-[#3E7BC4] to-[#265690] text-white",
  C: "bg-gradient-to-br from-[#3E9E8C] to-[#256B5E] text-white",
  D: "bg-gradient-to-br from-[#8A8F98] to-[#5E636B] text-white",
};

const gradeStyle = (g: string) => GRADE_STYLE[g] ?? GRADE_STYLE.D;

/** 状態ごとの色。★色だけで伝えないこと。必ず文字も一緒に出す */
const STATUS_STYLE: Record<Prize["status"], string> = {
  UNCHOSEN: "bg-[#FFF3D6] text-[#7A5A00] border-[#E5C97A]",
  SHIP_REQUESTED: "bg-[#E4F0FF] text-[#1B4BD8] border-[#A9C8F5]",
  EXCHANGED: "bg-[#EDEEF0] text-[#5E636B] border-[#D2D5DA]",
};

/**
 * 二重処理を防ぐ鍵を作る。
 *
 * ★1回の操作につき、1つの鍵を作ること。
 *   同じ鍵で2回届いても、受け取った側が2回目を捨てます。
 *   ボタンを連打しても、通信がやり直されても、処理は1回だけです。
 */
const newKey = (kind: string, id: string) =>
  `${kind}-${id}-${Math.random().toString(36).slice(2, 10)}`;

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export default function MyPage({
  s,
  dispatch,
}: {
  s: ConsoleState;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  const [view, setView] = useState<View>({ name: "home" });

  const me = s.users.find((u) => u.id === PREVIEW_USER_ID);
  if (!me) return null;

  const prizes = s.prizes.filter((p) => p.userId === me.id);
  const orders = s.orders.filter((o) => o.userId === me.id);
  const tickets = s.tickets.filter((t) => t.userId === me.id);
  const ledger = s.ledger.filter((e) => e.userId === me.id);

  const unchosen = prizes.filter((p) => p.status === "UNCHOSEN");
  const moving = orders.filter((o) => o.status !== "DELIVERED");
  const openTickets = tickets.filter((t) => t.status !== "DONE");

  const prizeOf = (id: string) => prizes.find((p) => p.id === id);

  return (
    <div className="mx-auto w-full max-w-[560px] pb-16">
      {/* ── 上の帯（お店の名前と残高） ── */}
      {/* ★上の切り替え帯の下に貼りつくこと。重ねると残高が読めなくなる */}
      <header className="sticky top-[var(--switch-h,0px)] z-20 rounded-b-2xl bg-[#0F1B33] px-4 py-3 text-white shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-bold tracking-wider text-white/60">
              DEMO SHOP（架空のお店です）
            </p>
            <p className="truncate text-[0.95rem] font-bold">{me.name} のマイページ</p>
          </div>
          <button
            type="button"
            onClick={() => setView({ name: "points" })}
            className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-right transition hover:bg-white/20"
          >
            <span className="block text-[0.65rem] text-white/60">保有ポイント</span>
            <span className="num block text-[1.05rem] font-bold leading-tight">
              {me.points.toLocaleString()}
              <span className="ml-0.5 text-[0.7rem] font-medium">pt</span>
            </span>
          </button>
        </div>
      </header>

      {/* ── お知らせ（操作の結果） ── */}
      {/* ★お客様に向けて書かれた文だけを出すこと。
          運営側の知らせには、担当者の名前と役割が入っています。
          「運営 太郎（管理者（全権））としてログインしました。」が
          ここに出たら、本番ならそのまま情報の漏れです */}
      {s.flash?.to === "customer" && (
        <div className="px-4 pt-3">
          <div
            className={[
              "rounded-xl border px-4 py-3 text-[0.85rem] leading-[1.8]",
              s.flash.kind === "ok"
                ? "border-[#9FD8B4] bg-[#E9F8EF] text-[#14663A]"
                : s.flash.kind === "warn"
                  ? "border-[#E5C97A] bg-[#FFF7E4] text-[#7A5A00]"
                  : "border-[#EDA9A9] bg-[#FDECEC] text-[#9B1C1C]",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1">{s.flash.text}</p>
              <button
                type="button"
                onClick={() => dispatch({ type: "CLEAR_FLASH" })}
                className="shrink-0 text-[0.75rem] font-bold underline"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="px-4 pt-4">
        {view.name === "home" && (
          <Home
            userName={me.name}
            balance={me.points}
            prizeCount={prizes.length}
            unchosenCount={unchosen.length}
            movingCount={moving.length}
            ticketCount={tickets.length}
            openTicketCount={openTickets.length}
            go={setView}
          />
        )}

        {view.name === "prizes" && (
          <PrizeList prizes={prizes} go={setView} back={() => setView({ name: "home" })} />
        )}

        {view.name === "prize" &&
          (() => {
            const p = prizeOf(view.id);
            if (!p) return <Missing back={() => setView({ name: "prizes" })} />;
            const order = p.orderId ? orders.find((o) => o.id === p.orderId) : undefined;
            return (
              <PrizeDetail
                p={p}
                orderStatus={order ? ORDER_STATUS_LABEL[order.status] : undefined}
                go={setView}
                back={() => setView({ name: "prizes" })}
              />
            );
          })()}

        {view.name === "ship" &&
          (() => {
            const p = prizeOf(view.id);
            if (!p) return <Missing back={() => setView({ name: "prizes" })} />;
            return (
              <ShipForm
                p={p}
                initial={me.address ?? DEMO_ADDRESS}
                onNext={(address) => setView({ name: "shipConfirm", id: p.id, address })}
                back={() => setView({ name: "prize", id: p.id })}
              />
            );
          })()}

        {view.name === "shipConfirm" &&
          (() => {
            const p = prizeOf(view.id);
            if (!p) return <Missing back={() => setView({ name: "prizes" })} />;
            return (
              <ShipConfirm
                p={p}
                address={view.address}
                onSubmit={() => {
                  dispatch({
                    type: "PRIZE_SHIP_REQUEST",
                    prizeId: p.id,
                    key: newKey("ship", p.id),
                    address: view.address,
                  });
                  setView({ name: "orders" });
                }}
                back={() => setView({ name: "ship", id: p.id })}
              />
            );
          })()}

        {view.name === "exchange" &&
          (() => {
            const p = prizeOf(view.id);
            if (!p) return <Missing back={() => setView({ name: "prizes" })} />;
            return (
              <ExchangeConfirm
                p={p}
                balance={me.points}
                onSubmit={() => {
                  dispatch({
                    type: "PRIZE_EXCHANGE",
                    prizeId: p.id,
                    key: newKey("ex", p.id),
                  });
                  setView({ name: "prizes" });
                }}
                back={() => setView({ name: "prize", id: p.id })}
              />
            );
          })()}

        {view.name === "orders" && (
          <OrderList orders={orders} back={() => setView({ name: "home" })} />
        )}

        {view.name === "support" && (
          <SupportView
            tickets={tickets}
            onAsk={(text) =>
              dispatch({ type: "USER_ASK", text, key: newKey("ask", String(tickets.length)) })
            }
            back={() => setView({ name: "home" })}
          />
        )}

        {view.name === "points" && (
          <PointHistory
            balance={me.points}
            ledger={ledger}
            back={() => setView({ name: "home" })}
          />
        )}
      </main>

      <p className="mt-8 px-4 text-center text-[0.72rem] leading-[1.9] text-slate3">
        これは動作を確かめるためのデモ画面です。DEMO DATA（架空のデータ）で動いています。<br />
        実際の決済・発送・メール送信は行いません。
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════
   共通の部品
   ══════════════════════════════════════════════ */

function Back({ onClick, label = "もどる" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 inline-flex items-center gap-1 text-[0.85rem] font-bold text-[#1B4BD8]"
    >
      <span aria-hidden>←</span> {label}
    </button>
  );
}

function H({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[1.15rem] font-bold tracking-tight text-slate">{children}</h2>
      {sub && <p className="mt-1 text-[0.8rem] leading-[1.85] text-slate3">{sub}</p>}
    </div>
  );
}

/** 商品の絵。★デモなので写真は置かず、等級の札で代わりにしています */
function PrizeArt({ grade, size = "lg" }: { grade: string; size?: "lg" | "sm" }) {
  const big = size === "lg";
  return (
    <div
      className={[
        "flex shrink-0 items-center justify-center rounded-xl font-bold shadow-inner",
        gradeStyle(grade),
        big ? "h-28 w-28 text-[2rem]" : "h-16 w-16 text-[1.15rem]",
      ].join(" ")}
    >
      {grade}
      <span className={big ? "ml-0.5 text-[0.9rem]" : "ml-0.5 text-[0.65rem]"}>賞</span>
    </div>
  );
}

function StatusChip({ status }: { status: Prize["status"] }) {
  return (
    <span
      className={[
        "inline-block rounded-full border px-2.5 py-1 text-[0.72rem] font-bold",
        STATUS_STYLE[status],
      ].join(" ")}
    >
      {PRIZE_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * 大きなボタン。
 *
 * ★スマホで指で押すものなので、小さくしないこと。
 *   高さを詰めると、隣を押してしまいます。
 *   お金が動く画面での押し間違いは、そのまま事故になります。
 */
function BigBtn({
  children,
  onClick,
  tone = "primary",
  note,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "primary" | "second" | "quiet";
  note?: string;
  disabled?: boolean;
}) {
  const style =
    tone === "primary"
      ? "bg-[#1B4BD8] text-white hover:bg-[#163CAE]"
      : tone === "second"
        ? "bg-white text-[#1B4BD8] border-2 border-[#1B4BD8] hover:bg-[#F2F6FF]"
        : "bg-[#EDEEF0] text-[#5E636B] hover:bg-[#E3E5E8]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "w-full rounded-2xl px-5 py-4 text-[1rem] font-bold shadow-sm transition",
        "disabled:cursor-not-allowed disabled:opacity-45",
        style,
      ].join(" ")}
    >
      {children}
      {note && <span className="mt-1 block text-[0.75rem] font-medium opacity-80">{note}</span>}
    </button>
  );
}

function Missing({ back }: { back: () => void }) {
  return (
    <>
      <Back onClick={back} />
      <p className="rounded-xl border border-[#EDA9A9] bg-[#FDECEC] px-4 py-4 text-[0.85rem] text-[#9B1C1C]">
        その商品が見つかりませんでした。
      </p>
    </>
  );
}

/* ══════════════════════════════════════════════
   ① ホーム
   ══════════════════════════════════════════════ */

function Home({
  userName,
  balance,
  prizeCount,
  unchosenCount,
  movingCount,
  ticketCount,
  openTicketCount,
  go,
}: {
  userName: string;
  balance: number;
  prizeCount: number;
  unchosenCount: number;
  movingCount: number;
  ticketCount: number;
  openTicketCount: number;
  go: (v: View) => void;
}) {
  return (
    <>
      <H sub={`${userName}様。数字を押すと、中身をご確認いただけます。`}>マイページ</H>

      {unchosenCount > 0 && (
        <div className="mb-4 rounded-2xl border-2 border-[#E5C97A] bg-[#FFF7E4] px-4 py-4">
          <p className="text-[0.9rem] font-bold text-[#7A5A00]">
            お受け取り方法が未選択の商品が {unchosenCount} 点あります
          </p>
          <p className="mt-1 text-[0.8rem] leading-[1.85] text-[#7A5A00]">
            現物のお届けか、ポイントへの交換をお選びください。
          </p>
          <button
            type="button"
            onClick={() => go({ name: "prizes" })}
            className="mt-3 w-full rounded-xl bg-[#7A5A00] px-4 py-3 text-[0.9rem] font-bold text-white"
          >
            受け取り方法を選ぶ
          </button>
        </div>
      )}

      {/* ★数字を出して終わりにしないこと。押したら中身に入れること */}
      <div className="space-y-3">
        <TapCard
          label="獲得商品"
          value={prizeCount}
          unit="点"
          note={
            unchosenCount > 0
              ? `うち ${unchosenCount} 点が未選択です`
              : "すべて受け取り方法が決まっています"
          }
          onClick={() => go({ name: "prizes" })}
        />
        <TapCard
          label="発送手配中"
          value={movingCount}
          unit="点"
          note="配送状況と追跡番号をご確認いただけます"
          onClick={() => go({ name: "orders" })}
        />
        <TapCard
          label="お問い合わせ"
          value={ticketCount}
          unit="件"
          note={
            openTicketCount > 0
              ? `${openTicketCount} 件が対応中です`
              : "新しいご質問もこちらから送れます"
          }
          onClick={() => go({ name: "support" })}
        />
        <TapCard
          label="ポイント履歴"
          value={balance}
          unit="pt"
          note="いまの残高になるまでの動きを、すべて残しています"
          onClick={() => go({ name: "points" })}
        />
      </div>
    </>
  );
}

function TapCard({
  label,
  value,
  unit,
  note,
  onClick,
}: {
  label: string;
  value: number;
  unit: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-edge bg-white px-4 py-4 text-left shadow-sm transition hover:border-[#1B4BD8] hover:shadow-md"
    >
      <div className="min-w-0">
        <p className="text-[0.85rem] font-bold text-slate">{label}</p>
        <p className="mt-1 text-[0.75rem] leading-[1.8] text-slate3">{note}</p>
      </div>
      <div className="flex shrink-0 items-baseline gap-1">
        <span className="num text-[1.6rem] font-bold leading-none text-slate">
          {value.toLocaleString()}
        </span>
        <span className="text-[0.75rem] font-bold text-slate3">{unit}</span>
        <span className="ml-1 text-[1.1rem] text-[#1B4BD8]" aria-hidden>
          ›
        </span>
      </div>
    </button>
  );
}

/* ══════════════════════════════════════════════
   ② 獲得商品の一覧
   ══════════════════════════════════════════════ */

const FILTERS: { key: "ALL" | Prize["status"]; label: string }[] = [
  { key: "ALL", label: "すべて" },
  { key: "UNCHOSEN", label: "未選択" },
  { key: "SHIP_REQUESTED", label: "発送依頼済み" },
  { key: "EXCHANGED", label: "ポイント交換済み" },
];

function PrizeList({
  prizes,
  go,
  back,
}: {
  prizes: Prize[];
  go: (v: View) => void;
  back: () => void;
}) {
  const [filter, setFilter] = useState<"ALL" | Prize["status"]>("ALL");
  const list = filter === "ALL" ? prizes : prizes.filter((p) => p.status === filter);

  return (
    <>
      <Back onClick={back} label="マイページ" />
      <H sub="当たった商品の一覧です。押すと、受け取り方法をお選びいただけます。">獲得商品</H>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = f.key === "ALL" ? prizes.length : prizes.filter((p) => p.status === f.key).length;
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={[
                "rounded-full border px-3 py-2 text-[0.78rem] font-bold transition",
                on
                  ? "border-[#1B4BD8] bg-[#1B4BD8] text-white"
                  : "border-edge bg-white text-slate3 hover:border-[#1B4BD8]",
              ].join(" ")}
            >
              {f.label}
              <span className="num ml-1">{n}</span>
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-edge bg-paper2 px-4 py-6 text-center text-[0.85rem] text-slate3">
          このしぼり込みに当てはまる商品はありません。
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => go({ name: "prize", id: p.id })}
                className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-white px-3 py-3 text-left shadow-sm transition hover:border-[#1B4BD8] hover:shadow-md"
              >
                <PrizeArt grade={p.grade} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9rem] font-bold text-slate">{p.name}</p>
                  <p className="num mt-0.5 text-[0.72rem] text-slate3">
                    {p.gachaTitle} ／ {p.wonAt}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusChip status={p.status} />
                    <span className="num text-[0.75rem] font-bold text-slate3">
                      交換 {p.exchangePt.toLocaleString()}pt
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-[1.1rem] text-[#1B4BD8]" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════
   ③ 商品の詳細（ここで2つに1つを選ぶ）
   ══════════════════════════════════════════════ */

function PrizeDetail({
  p,
  orderStatus,
  go,
  back,
}: {
  p: Prize;
  orderStatus?: string;
  go: (v: View) => void;
  back: () => void;
}) {
  return (
    <>
      <Back onClick={back} label="獲得商品" />

      <div className="rounded-2xl border border-edge bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <PrizeArt grade={p.grade} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.05rem] font-bold leading-snug text-slate">{p.name}</h2>
            <dl className="mt-3 space-y-1.5 text-[0.8rem]">
              <Row k="獲得日時" v={p.wonAt} />
              <Row k="ガチャ" v={p.gachaTitle} />
              <Row k="賞ランク" v={`${p.grade}賞`} />
              <Row k="ポイント交換価値" v={`${p.exchangePt.toLocaleString()}pt`} />
            </dl>
            <div className="mt-3">
              <StatusChip status={p.status} />
            </div>
          </div>
        </div>
      </div>

      {/* ── まだ選んでいない：2つに1つを選ぶ ── */}
      {p.status === "UNCHOSEN" && (
        <div className="mt-5 space-y-3">
          <p className="text-center text-[0.85rem] font-bold text-slate">
            お受け取り方法をお選びください
          </p>
          <BigBtn onClick={() => go({ name: "ship", id: p.id })} note="ご登録のご住所にお届けします">
            発送する
          </BigBtn>
          <BigBtn
            tone="second"
            onClick={() => go({ name: "exchange", id: p.id })}
            note={`${p.exchangePt.toLocaleString()}pt が残高に加算されます`}
          >
            ポイントに交換する
          </BigBtn>
          <p className="rounded-xl border border-[#E5C97A] bg-[#FFF7E4] px-4 py-3 text-[0.78rem] leading-[1.85] text-[#7A5A00]">
            ★どちらか一方のみお選びいただけます。ポイントに交換された商品は、その後の発送はできません。
          </p>
        </div>
      )}

      {/* ── 発送を選んだあと ── */}
      {p.status === "SHIP_REQUESTED" && (
        <div className="mt-5 space-y-3">
          <p className="rounded-xl border border-[#A9C8F5] bg-[#E4F0FF] px-4 py-4 text-[0.85rem] leading-[1.85] text-[#1B4BD8]">
            この商品は発送をご依頼済みです。
            {orderStatus && (
              <>
                <br />
                現在の状態：<strong className="font-bold">{orderStatus}</strong>
              </>
            )}
            <br />
            発送を選ばれたため、ポイントへの交換はできません。
          </p>
          <BigBtn tone="second" onClick={() => go({ name: "orders" })}>
            配送状況を見る
          </BigBtn>
        </div>
      )}

      {/* ── ポイントに交換したあと ── */}
      {p.status === "EXCHANGED" && (
        <div className="mt-5 space-y-3">
          <p className="rounded-xl border border-[#D2D5DA] bg-[#EDEEF0] px-4 py-4 text-[0.85rem] leading-[1.85] text-[#5E636B]">
            この商品は {p.exchangedAt ?? ""} にポイントへ交換済みです。
            <br />
            交換された商品の発送はできません。
          </p>
          <BigBtn tone="quiet" onClick={() => go({ name: "points" })}>
            ポイント履歴で確認する
          </BigBtn>
        </div>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate3">{k}</dt>
      <dd className="num text-right font-bold text-slate">{v}</dd>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ④ 発送：お届け先の確認
   ══════════════════════════════════════════════ */

function ShipForm({
  p,
  initial,
  onNext,
  back,
}: {
  p: Prize;
  initial: Address;
  onNext: (a: Address) => void;
  back: () => void;
}) {
  const [a, setA] = useState<Address>(initial);
  const filled = a.name.trim() && a.zip.trim() && a.addr.trim() && a.tel.trim();

  return (
    <>
      <Back onClick={back} label="商品の詳細" />
      <H sub={`「${p.name}」のお届け先をご確認ください。`}>お届け先の確認</H>

      <div className="space-y-3 rounded-2xl border border-edge bg-white p-4 shadow-sm">
        <Fld label="お名前" value={a.name} onChange={(v) => setA({ ...a, name: v })} />
        <Fld label="郵便番号" value={a.zip} onChange={(v) => setA({ ...a, zip: v })} />
        <Fld label="ご住所" value={a.addr} onChange={(v) => setA({ ...a, addr: v })} />
        <Fld label="お電話番号" value={a.tel} onChange={(v) => setA({ ...a, tel: v })} />
      </div>

      <p className="mt-3 text-[0.78rem] leading-[1.85] text-slate3">
        ここは架空の住所です。デモのため、実際の配送は行いません。
      </p>

      <div className="mt-4">
        <BigBtn onClick={() => onNext(a)} disabled={!filled}>
          この住所で確認へすすむ
        </BigBtn>
        {!filled && (
          <p className="mt-2 text-center text-[0.78rem] text-[#9B1C1C]">
            すべての項目をご入力ください。
          </p>
        )}
      </div>
    </>
  );
}

function Fld({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[0.78rem] font-bold text-slate3">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-edge bg-paper2 px-3 py-3 text-[0.9rem] text-slate outline-none focus:border-[#1B4BD8]"
      />
    </label>
  );
}

/* ══════════════════════════════════════════════
   ⑤ 発送：最後の確認
   ══════════════════════════════════════════════ */

function ShipConfirm({
  p,
  address,
  onSubmit,
  back,
}: {
  p: Prize;
  address: Address;
  onSubmit: () => void;
  back: () => void;
}) {
  const [sent, setSent] = useState(false);

  return (
    <>
      <Back onClick={back} label="お届け先の入力" />
      <H sub="この内容で発送をご依頼します。よろしければ下のボタンを押してください。">
        ご依頼内容の確認
      </H>

      <div className="rounded-2xl border border-edge bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <PrizeArt grade={p.grade} size="sm" />
          <p className="min-w-0 flex-1 text-[0.9rem] font-bold text-slate">{p.name}</p>
        </div>
        <div className="mt-4 border-t border-edge pt-3">
          <p className="text-[0.78rem] font-bold text-slate3">お届け先</p>
          <p className="num mt-1 text-[0.85rem] leading-[1.9] text-slate">
            〒{address.zip}
            <br />
            {address.addr}
            <br />
            {address.name}　{address.tel}
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-[#E5C97A] bg-[#FFF7E4] px-4 py-3 text-[0.78rem] leading-[1.85] text-[#7A5A00]">
        ★発送をご依頼されると、この商品はポイントへ交換できなくなります。
      </p>

      <div className="mt-4">
        <BigBtn
          disabled={sent}
          onClick={() => {
            /* ★押した瞬間に、もう押せなくすること。
               ただし、これは親切のためであって、守りではありません。
               本当の守りは、受け取った側が同じ鍵の依頼を捨てることです */
            setSent(true);
            onSubmit();
          }}
        >
          {sent ? "送信しました" : "この内容で発送を依頼する"}
        </BigBtn>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════
   ⑥ ポイント交換の確認
   ══════════════════════════════════════════════ */

function ExchangeConfirm({
  p,
  balance,
  onSubmit,
  back,
}: {
  p: Prize;
  balance: number;
  onSubmit: () => void;
  back: () => void;
}) {
  const [sent, setSent] = useState(false);
  const after = balance + p.exchangePt;

  return (
    <>
      <Back onClick={back} label="商品の詳細" />
      <H>ポイント交換の確認</H>

      <div className="rounded-2xl border border-edge bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <PrizeArt grade={p.grade} size="sm" />
          <p className="min-w-0 flex-1 text-[0.9rem] font-bold text-slate">{p.name}</p>
        </div>

        <p className="mt-5 text-center text-[0.95rem] font-bold leading-[1.9] text-slate">
          この商品を
          <span className="num mx-1 text-[1.35rem] text-[#1B4BD8]">
            {p.exchangePt.toLocaleString()}pt
          </span>
          へ交換しますか？
        </p>

        <div className="mt-5 rounded-xl bg-paper2 px-4 py-3">
          <div className="flex items-center justify-between text-[0.85rem]">
            <span className="text-slate3">いまの残高</span>
            <span className="num font-bold text-slate">{balance.toLocaleString()}pt</span>
          </div>
          <div className="my-2 text-center text-[0.9rem] text-slate3" aria-hidden>
            ↓
          </div>
          <div className="flex items-center justify-between text-[0.85rem]">
            <span className="font-bold text-slate">交換後の残高</span>
            <span className="num text-[1.15rem] font-bold text-[#1B4BD8]">
              {after.toLocaleString()}pt
            </span>
          </div>
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-[#EDA9A9] bg-[#FDECEC] px-4 py-3 text-[0.8rem] leading-[1.85] text-[#9B1C1C]">
        ★ポイントに交換されたあとは、この商品の発送はできません。
        取り消しもできませんので、ご確認のうえお進みください。
      </p>

      <div className="mt-4 space-y-3">
        <BigBtn
          disabled={sent}
          onClick={() => {
            setSent(true);
            onSubmit();
          }}
        >
          {sent ? "交換しました" : `${p.exchangePt.toLocaleString()}pt へ交換する`}
        </BigBtn>
        <BigBtn tone="quiet" onClick={back}>
          やめる
        </BigBtn>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════
   ⑦ 発送手配中
   ══════════════════════════════════════════════ */

function OrderList({
  orders,
  back,
}: {
  orders: ConsoleState["orders"];
  back: () => void;
}) {
  const sorted = [...orders].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

  return (
    <>
      <Back onClick={back} label="マイページ" />
      <H sub="お届けの状況です。追跡番号は、発送時にお知らせします。">発送手配中</H>

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-edge bg-paper2 px-4 py-6 text-center text-[0.85rem] text-slate3">
          現在、発送のご依頼はありません。
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((o) => (
            <li key={o.id} className="rounded-2xl border border-edge bg-white px-4 py-4 shadow-sm">
              <p className="text-[0.9rem] font-bold text-slate">{o.prize}</p>
              <dl className="mt-3 space-y-1.5 text-[0.8rem]">
                <Row k="発送依頼日" v={o.requestedAt} />
                <Row k="現在の状態" v={ORDER_STATUS_LABEL[o.status]} />
                <Row k="配送会社" v={o.carrier ?? "発送時にお知らせします"} />
                <Row k="追跡番号" v={o.tracking ?? "発送時にお知らせします"} />
              </dl>

              {o.tracking ? (
                <button
                  type="button"
                  disabled
                  title="デモのため、配送会社のサイトへは移動しません"
                  className="mt-3 w-full cursor-not-allowed rounded-xl border-2 border-edge px-4 py-3 text-[0.85rem] font-bold text-slate3"
                >
                  配送状況を見る（デモでは移動しません）
                </button>
              ) : (
                <p className="mt-3 text-[0.78rem] leading-[1.85] text-slate3">
                  発送が完了しますと、追跡番号をこちらに表示します。
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════
   ⑧ お問い合わせ
   ══════════════════════════════════════════════ */

const EXAMPLES = [
  "発送はいつになりますか？",
  "ポイントが減っている理由を知りたいです",
  "届いた商品に傷がありました",
];

function SupportView({
  tickets,
  onAsk,
  back,
}: {
  tickets: ConsoleState["tickets"];
  onAsk: (text: string) => void;
  back: () => void;
}) {
  const [text, setText] = useState("");

  const send = () => {
    if (!text.trim()) return;
    onAsk(text.trim());
    setText("");
  };

  return (
    <>
      <Back onClick={back} label="マイページ" />
      <H sub="AIがその場でお答えできるものは、すぐに回答します。判断が必要なものは、運営スタッフが確認のうえご連絡します。">
        お問い合わせ
      </H>

      {/* ── 新しく送る ── */}
      <div className="rounded-2xl border border-edge bg-white p-4 shadow-sm">
        <p className="text-[0.85rem] font-bold text-slate">新しくお問い合わせをする</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="ご質問の内容をご記入ください"
          className="mt-2 w-full resize-none rounded-xl border border-edge bg-paper2 px-3 py-3 text-[0.9rem] text-slate outline-none focus:border-[#1B4BD8]"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setText(q)}
              className="rounded-full border border-edge bg-paper2 px-3 py-1.5 text-[0.72rem] font-bold text-slate3 hover:border-[#1B4BD8]"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <BigBtn onClick={send} disabled={!text.trim()}>
            送信する
          </BigBtn>
        </div>
      </div>

      {/* ── 過去のやりとり ── */}
      <h3 className="mb-3 mt-6 text-[0.95rem] font-bold text-slate">これまでのお問い合わせ</h3>
      {tickets.length === 0 ? (
        <p className="rounded-xl border border-edge bg-paper2 px-4 py-6 text-center text-[0.85rem] text-slate3">
          まだお問い合わせはありません。
        </p>
      ) : (
        <ul className="space-y-3">
          {tickets.map((t) => (
            <li key={t.id} className="rounded-2xl border border-edge bg-white px-4 py-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="num text-[0.72rem] text-slate3">{t.at}</span>
                <span
                  className={[
                    "rounded-full border px-2.5 py-1 text-[0.7rem] font-bold",
                    t.status === "DONE"
                      ? "border-[#9FD8B4] bg-[#E9F8EF] text-[#14663A]"
                      : t.status === "AI_ANSWERED"
                        ? "border-[#A9C8F5] bg-[#E4F0FF] text-[#1B4BD8]"
                        : "border-[#E5C97A] bg-[#FFF7E4] text-[#7A5A00]",
                  ].join(" ")}
                >
                  {t.status === "DONE"
                    ? "解決済み"
                    : t.status === "AI_ANSWERED"
                      ? "AIが回答"
                      : "運営スタッフが確認中"}
                </span>
              </div>

              {/* お客様が送った文 */}
              <p className="mt-2 rounded-xl bg-paper2 px-3 py-2 text-[0.85rem] leading-[1.85] text-slate">
                {t.body}
              </p>

              {/* 返ってきた文。★誰が書いたのかを必ず出すこと */}
              {t.reply ? (
                <div className="mt-3 rounded-xl border border-[#A9C8F5] bg-[#F5F9FF] px-3 py-3">
                  <p className="text-[0.72rem] font-bold text-[#1B4BD8]">
                    {t.replyBy === "HUMAN" ? "運営スタッフから返信" : "AIからの回答"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[0.85rem] leading-[1.9] text-slate">
                    {t.reply}
                  </p>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-[#E5C97A] bg-[#FFF7E4] px-3 py-3">
                  <p className="text-[0.72rem] font-bold text-[#7A5A00]">
                    運営スタッフが確認しています
                  </p>
                  <p className="mt-1 text-[0.82rem] leading-[1.9] text-[#7A5A00]">
                    {t.escalateReason ??
                      "この内容は、AIでは判断できないため運営スタッフにお繋ぎしました。"}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════
   ⑨ ポイント履歴
   ══════════════════════════════════════════════ */

function PointHistory({
  balance,
  ledger,
  back,
}: {
  balance: number;
  ledger: ConsoleState["ledger"];
  back: () => void;
}) {
  const sum = ledger.reduce((acc, e) => acc + e.delta, 0);
  const list = [...ledger].reverse();

  return (
    <>
      <Back onClick={back} label="マイページ" />
      <H sub="いまの残高になるまでの動きを、すべて残しています。">ポイント履歴</H>

      <div className="rounded-2xl bg-[#0F1B33] px-5 py-5 text-white shadow-lg">
        <p className="text-[0.75rem] text-white/60">現在の保有ポイント</p>
        <p className="num mt-1 text-[2rem] font-bold leading-none">
          {balance.toLocaleString()}
          <span className="ml-1 text-[0.9rem] font-medium">pt</span>
        </p>
        {/* ★履歴の合計と残高が合わないなら、隠さずに出すこと。
            合わないということは、記録に残っていない増減があるということです */}
        <p className="mt-3 text-[0.72rem] leading-[1.8] text-white/60">
          {sum === balance
            ? "下の履歴をすべて足すと、この残高になります。"
            : `★履歴の合計（${sum.toLocaleString()}pt）と残高が一致していません。運営者が確認します。`}
        </p>
      </div>

      <ul className="mt-4 space-y-2">
        {list.map((e) => (
          <li
            key={e.id}
            className="flex items-start justify-between gap-3 rounded-xl border border-edge bg-white px-4 py-3 shadow-sm"
          >
            <div className="min-w-0">
              <p className="text-[0.85rem] font-bold text-slate">{POINT_KIND_LABEL[e.kind]}</p>
              <p className="mt-0.5 text-[0.75rem] leading-[1.8] text-slate3">{e.memo}</p>
              <p className="num mt-0.5 text-[0.7rem] text-slate3">{e.at}</p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={[
                  "num text-[0.95rem] font-bold",
                  e.delta > 0 ? "text-[#14663A]" : e.delta < 0 ? "text-[#9B1C1C]" : "text-slate3",
                ].join(" ")}
              >
                {e.delta > 0 ? "+" : ""}
                {e.delta.toLocaleString()}pt
              </p>
              <p className="num mt-0.5 text-[0.7rem] text-slate3">
                残高 {e.balanceAfter.toLocaleString()}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
