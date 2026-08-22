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
import type {
  ConsoleAction,
  ConsoleState,
  ConsoleGacha,
  Address,
  Prize,
  StepUpReason,
} from "@/lib/console/state";
import { poolOf, type DrawRecord } from "@/lib/console/draw";
import {
  PRIZE_STATUS_LABEL,
  POINT_KIND_LABEL,
  CUSTOMER_AUTH_LABEL,
  CUSTOMER_AUTH_NOTE,
  CUSTOMER_GATES,
  DEMO_STEP_UP_CODE,
  STEP_UP_LABEL,
  STEP_UP_WHY,
} from "@/lib/console/state";
import { ORDER_STATUS_LABEL } from "@/lib/console/support";

/* ══════════════════════════════════════════════
   画面の行き先
   ══════════════════════════════════════════════ */

type View =
  /**
   * お店の棚。
   *
   * ★ここだけは、ログインしていなくても見られること。
   *   何が当たるのか・いくらか・残りいくつかを見られない店では、
   *   そもそも買うかどうかを決められません。
   *   鍵をかけるのは、この先（引く・残高・住所）からです。
   */
  | { name: "shop" }
  | { name: "gacha"; id: string }
  /** ログイン画面。棚から「引く」を押したときに、ここへ来ます */
  | { name: "login" }
  | { name: "home" }
  | { name: "prizes" }
  | { name: "prize"; id: string }
  /** 発送前に、登録されているお届け先を確認していただく画面 */
  | { name: "ship"; id: string }
  | { name: "shipConfirm"; id: string }
  /** お届け先そのものを変える画面（追加の本人確認が入ります） */
  | { name: "address" }
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
  /**
   * 最初に出す画面。
   *
   * ★お店なので、最初に出るのは棚であること。
   *   いきなりログイン画面が出る店は、
   *   何を売っているのかを見る前に会員登録を求める店と同じです。
   */
  const [view, setView] = useState<View>({ name: "shop" });

  /**
   * ログインの前に見ていたガチャ。
   *
   * ★ログインしたら、見ていたところへ戻すこと。
   *   毎回マイページの先頭へ飛ばすと、
   *   引こうとした方が、もう一度ガチャを探し直すことになります。
   */
  const [pending, setPending] = useState<string | null>(null);

  /**
   * ★誰であるかは、ログイン情報からだけ決めること。
   *
   *   以前はここで、決め打ちの会員番号を使っていました。
   *   デモとしては動きますが、それでは
   *   「ログインしていない人が開いたら、どうなるのか」を
   *   一度も試さないまま作ることになります。
   *   本番で最初に突かれるのは、まさにそこです。
   */
  const me = s.customer
    ? s.users.find((u) => u.id === s.customer!.userId)
    : undefined;

  /* ══════════════════════════════════════════
     ログインしていないとき
     ══════════════════════════════════════════

     ★ここで全部を閉じないこと。
       前は、開いた瞬間にログイン画面でした。
       鍵をかける場所としては正しいのですが、
       棚まで閉めてしまっていました。
       店の前を通った人が、何を売っているのかも見られません。

       いま見られるのは、棚（ガチャ一覧）と、
       その中身（賞品・価格・残口数）だけです。
       引く・残高・獲得商品・住所は、この先です。 */
  if (!me) {
    const login = (
      <CustomerLogin
        s={s}
        onLogin={(userId) => {
          setView(pending ? { name: "gacha", id: pending } : { name: "home" });
          setPending(null);
          dispatch({ type: "CUSTOMER_LOGIN", userId });
        }}
        back={() => setView({ name: "shop" })}
      />
    );

    if (view.name === "login") return login;

    if (view.name === "gacha") {
      const g = s.gachas.find((x) => x.id === view.id);
      if (g && g.status === "PUBLISHED") {
        return (
          <PublicShell onLogin={() => setView({ name: "login" })}>
            <GachaDetail
              g={g}
              balance={null}
              lastDraw={null}
              onDraw={() => {
                setPending(g.id);
                setView({ name: "login" });
              }}
              back={() => setView({ name: "shop" })}
            />
          </PublicShell>
        );
      }
    }

    return (
      <PublicShell onLogin={() => setView({ name: "login" })}>
        <Shop
          gachas={s.gachas}
          balance={null}
          go={setView}
          back={null}
        />
      </PublicShell>
    );
  }

  const prizes = s.prizes.filter((p) => p.userId === me.id);
  const orders = s.orders.filter((o) => o.userId === me.id);
  const tickets = s.tickets.filter((t) => t.userId === me.id);
  const ledger = s.ledger.filter((e) => e.userId === me.id);

  const unchosen = prizes.filter((p) => p.status === "UNCHOSEN");
  const shipping = prizes.filter((p) => p.status === "SHIP_REQUESTED");
  const exchanged = prizes.filter((p) => p.status === "EXCHANGED");
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
            {/* ★「誰としてログインしているか」を、常に出しておくこと。
                ここが空欄の画面は、他人の情報を見ていても気づけません */}
            <button
              type="button"
              onClick={() => dispatch({ type: "CUSTOMER_LOGOUT" })}
              className="mt-0.5 text-[0.68rem] text-white/55 underline"
            >
              {CUSTOMER_AUTH_LABEL[s.customer?.method ?? "EMAIL"]}でログイン中／ログアウト
            </button>
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

      <DemoModeNote />

      {/* ── 追加の本人確認（STEP-UP AUTH） ──
          ★これが出ている間は、下の操作を続けさせないこと。
            「確認をお願いします」と出しながら、
            そのまま先へ進めてしまう画面には、意味がありません */}
      {s.stepUp && (
        <StepUpPanel
          reason={s.stepUp.reason}
          note={s.stepUp.note}
          onOk={(code) => dispatch({ type: "CUSTOMER_STEP_UP", code })}
          onCancel={() => dispatch({ type: "CUSTOMER_STEP_UP_CANCEL" })}
        />
      )}

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
        {view.name === "shop" && (
          <Shop
            gachas={s.gachas}
            balance={me.points}
            go={setView}
            back={() => setView({ name: "home" })}
          />
        )}

        {view.name === "gacha" &&
          (() => {
            const g = s.gachas.find((x) => x.id === view.id);
            if (!g || g.status !== "PUBLISHED") {
              return <MissingGacha back={() => setView({ name: "shop" })} />;
            }
            /* ★出す結果は、この方ご本人の分だけにすること。
               いちばん新しい抽選をそのまま出すと、
               他の方が引いた結果が画面に出ます */
            const mine = s.draws.filter(
              (d) => d.userId === me.id && d.gachaId === g.id,
            );
            return (
              <GachaDetail
                g={g}
                balance={me.points}
                lastDraw={mine[mine.length - 1] ?? null}
                onDraw={() =>
                  dispatch({
                    type: "DRAW",
                    gachaId: g.id,
                    key: newKey("draw", g.id),
                  })
                }
                back={() => setView({ name: "shop" })}
              />
            );
          })()}

        {view.name === "home" && (
          <Home
            userName={me.name}
            balance={me.points}
            prizeCount={prizes.length}
            unchosenCount={unchosen.length}
            shippingCount={shipping.length}
            exchangedCount={exchanged.length}
            movingCount={moving.length}
            ticketCount={tickets.length}
            openTicketCount={openTickets.length}
            hasAddress={Boolean(me.address)}
            go={setView}
          />
        )}

        {view.name === "prizes" && (
          <PrizeList
            prizes={prizes}
            go={setView}
            back={() => setView({ name: "home" })}
            onBulkShip={(ids) =>
              dispatch({ type: "PRIZE_SHIP_BULK", prizeIds: ids, key: newKey("bship", String(ids.length)) })
            }
            onBulkExchange={(ids) =>
              dispatch({ type: "PRIZE_EXCHANGE_BULK", prizeIds: ids, key: newKey("bex", String(ids.length)) })
            }
          />
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
              <ShipAddressCheck
                p={p}
                address={me.address}
                onNext={() => setView({ name: "shipConfirm", id: p.id })}
                onEdit={() => setView({ name: "address" })}
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
                address={me.address}
                onSubmit={() => {
                  /* ★お届け先を、ここから送らないこと。
                     受け取った側が、ログイン中の本人の登録住所を使います。
                     画面が持っている住所を送ると、
                     その中身が本人のものである保証がどこにもありません */
                  dispatch({
                    type: "PRIZE_SHIP_REQUEST",
                    prizeId: p.id,
                    key: newKey("ship", p.id),
                  });
                  setView({ name: "orders" });
                }}
                back={() => setView({ name: "ship", id: p.id })}
              />
            );
          })()}

        {view.name === "address" && (
          <AddressForm
            initial={me.address}
            onSubmit={(address) => {
              dispatch({ type: "ADDRESS_UPDATE", address });
              setView({ name: "home" });
            }}
            back={() => setView({ name: "home" })}
          />
        )}

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
   ⓪-a お店の棚（ログインなしで見られる範囲）
   ══════════════════════════════════════════════ */

/**
 * ログインしていない方に見せる、外枠。
 *
 * ★ここに、残高も、獲得商品も、住所も出さないこと。
 *   出してよいのは、誰が見ても困らないものだけです。
 *   上の帯に残高を出す作りのまま流用すると、
 *   ログインしていない人の画面に、誰かの残高が出ます。
 */
function PublicShell({
  children,
  onLogin,
}: {
  children: React.ReactNode;
  onLogin: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[560px] pb-16">
      <header className="sticky top-[var(--switch-h,0px)] z-20 rounded-b-2xl bg-[#0F1B33] px-4 py-3 text-white shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-bold tracking-wider text-white/60">
              DEMO SHOP（架空のお店です）
            </p>
            <p className="truncate text-[0.95rem] font-bold">
              ログインしていません
            </p>
          </div>
          <button
            type="button"
            onClick={onLogin}
            className="shrink-0 rounded-xl bg-white px-4 py-2.5 text-[0.85rem] font-bold text-[#0F1B33] transition hover:bg-white/85"
          >
            ログイン
          </button>
        </div>
      </header>

      <DemoModeNote />

      <main className="px-4 pt-4">{children}</main>

      <p className="mt-8 px-4 text-center text-[0.72rem] leading-[1.9] text-slate3">
        これは動作を確かめるためのデモ画面です。DEMO DATA（架空のデータ）で動いています。<br />
        実際の決済・発送・メール送信は行いません。
      </p>
    </div>
  );
}

/**
 * ガチャ一覧。
 *
 * ★販売中のものだけを並べること。
 *   下書き・停止中のガチャをお客様の棚に出すと、
 *   押せるのに引けない商品が並びます。
 */
function Shop({
  gachas,
  balance,
  go,
  back,
}: {
  gachas: ConsoleGacha[];
  /** ログインしていなければ null。残高は出しません */
  balance: number | null;
  go: (v: View) => void;
  back: (() => void) | null;
}) {
  const live = gachas.filter((g) => g.status === "PUBLISHED");

  return (
    <>
      {back && <Back onClick={back} label="マイページへ" />}
      <H sub="いま販売中のガチャです。中身と残りは、ログインなしでもご覧いただけます。">
        ガチャ一覧
      </H>

      {live.length === 0 && (
        <p className="rounded-xl border border-edge bg-white px-4 py-4 text-[0.85rem] leading-[1.9] text-slate3">
          いま販売中のガチャはありません。
        </p>
      )}

      <div className="space-y-3">
        {live.map((g) => {
          const soldPct = Math.round(((g.total - g.left) / g.total) * 100);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => go({ name: "gacha", id: g.id })}
              className="block w-full rounded-2xl border border-edge bg-white px-4 py-4 text-left shadow-sm transition hover:border-[#1B4BD8] hover:shadow-md"
            >
              <span className="block text-[1rem] font-bold leading-[1.6] text-slate">
                {g.title}
              </span>
              <span className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="num text-[1.4rem] font-bold text-[#1B4BD8]">
                  {g.price.toLocaleString()}
                </span>
                <span className="text-[0.78rem] text-slate2">pt / 1回</span>
                <span className="num text-[0.78rem] text-slate3">
                  残り {g.left.toLocaleString()} / {g.total.toLocaleString()}
                </span>
              </span>
              <span className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-[#EDEEF0]">
                <span
                  className="block h-full rounded-full bg-[#1B4BD8]"
                  style={{ width: `${soldPct}%` }}
                />
              </span>
              {balance !== null && balance < g.price && (
                <span className="mt-2 block text-[0.74rem] font-bold text-[#9B1C1C]">
                  いまの残高では足りません
                </span>
              )}
            </button>
          );
        })}
      </div>

      {balance === null && (
        <p className="mt-4 rounded-xl border border-[#A9C8F5] bg-[#F5F9FF] px-4 py-3 text-[0.78rem] leading-[1.9] text-slate2">
          賞品・価格・残口数は、ログインなしでご覧いただけます。
          引くにはログインが必要です。ポイントが減るため、
          どなたの残高から引くのかが決まっている必要があるからです。
        </p>
      )}
    </>
  );
}

/**
 * ガチャの詳細と、引くところ。
 *
 * ★当たりの本数を隠さないこと。
 *   何が何本入っているかを見てから引くかどうかを決められる、
 *   というのが、お客様側の最低限です。
 *
 * ★設計還元率・粗利・仕入れ値は出さないこと。
 *   これは運営の数字で、出すと当たりやすい時期を狙って引かれます。
 */
function GachaDetail({
  g,
  balance,
  lastDraw,
  onDraw,
  back,
}: {
  g: ConsoleGacha;
  balance: number | null;
  lastDraw: DrawRecord | null;
  onDraw: () => void;
  back: () => void;
}) {
  const pool = poolOf(g.title, g.price, g.total, g.designedRtp);
  const soldPct = Math.round(((g.total - g.left) / g.total) * 100);
  const short = balance !== null && balance < g.price;
  const soldOut = g.left <= 0;

  return (
    <>
      <Back onClick={back} label="ガチャ一覧へ" />
      <H>{g.title}</H>

      <div className="rounded-2xl border border-edge bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-[2rem] font-bold leading-none text-[#1B4BD8]">
            {g.price.toLocaleString()}
          </span>
          <span className="text-[0.85rem] text-slate2">pt / 1回</span>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[0.8rem] text-slate2">残り</span>
            <span className="num text-[0.85rem] font-bold text-slate">
              {g.left.toLocaleString()} / {g.total.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#EDEEF0]">
            <div
              className="h-full rounded-full bg-[#1B4BD8]"
              style={{ width: `${soldPct}%` }}
            />
          </div>
          <p className="mt-2 text-[0.74rem] text-slate3">{soldPct}% が売れました</p>
        </div>
      </div>

      {/* ── 賞の内容 ── */}
      <div className="mt-3 rounded-2xl border border-edge bg-white p-2 shadow-sm">
        <p className="px-2 pb-1 pt-1.5 text-[0.78rem] font-bold text-slate3">
          賞の内容
        </p>
        <ul>
          {pool.map((p) => (
            <li
              key={p.grade}
              className="flex items-center gap-3 border-b border-edge px-2 py-2.5 last:border-b-0"
            >
              <PrizeArt grade={p.grade} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.85rem] font-bold text-slate">{p.name}</p>
                <p className="mt-0.5 text-[0.74rem] text-slate3">
                  {["S", "A", "B"].includes(p.grade)
                    ? "現物のお届け、またはポイントに交換できます"
                    : "ポイントでお返しします"}
                </p>
              </div>
              <span className="num shrink-0 text-[0.85rem] font-bold text-slate">
                {p.count.toLocaleString()}本
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── 引いた結果 ──
          ★結果は、この画面で決めていないこと。
            受け取り側（reducer）で決めた結果を、見せているだけです */}
      {lastDraw && (
        <div
          className={[
            "mt-4 rounded-2xl border-2 px-4 py-4",
            lastDraw.grade === "-"
              ? "border-edge bg-[#F7F8F9]"
              : "border-[#A9C8F5] bg-[#F5F9FF]",
          ].join(" ")}
        >
          <p className="text-[0.75rem] font-bold text-slate3">いちばん新しい結果</p>
          <div className="mt-2 flex items-center gap-3">
            {lastDraw.grade !== "-" && <PrizeArt grade={lastDraw.grade} size="sm" />}
            <div className="min-w-0">
              <p className="text-[1.1rem] font-bold text-slate">
                {lastDraw.grade === "-" ? "はずれ" : `${lastDraw.grade}賞`}
              </p>
              <p className="mt-0.5 text-[0.82rem] leading-[1.8] text-slate2">
                {lastDraw.prizeName}
              </p>
            </div>
          </div>
          <p className="num mt-3 border-t border-edge pt-3 text-[0.78rem] text-slate3">
            残高 {lastDraw.balanceBefore.toLocaleString()}pt →{" "}
            {lastDraw.balanceAfter.toLocaleString()}pt
          </p>
        </div>
      )}

      {/* ── 引く ── */}
      <div className="mt-4 space-y-2">
        <BigBtn
          onClick={onDraw}
          disabled={soldOut || short}
          note={
            balance === null
              ? "引くにはログインが必要です"
              : short
                ? "残高が足りません"
                : undefined
          }
        >
          {soldOut ? "完売しました" : `${g.price.toLocaleString()}pt で引く`}
        </BigBtn>
      </div>

      <p className="mt-4 text-[0.74rem] leading-[1.9] text-slate3">
        ・当たった商品は、現物のお届けか、ポイントへの交換をお選びいただけます。<br />
        ・これはデモです。実際の決済・発送・メール送信は行いません。
      </p>
    </>
  );
}

function MissingGacha({ back }: { back: () => void }) {
  return (
    <>
      <Back onClick={back} label="ガチャ一覧へ" />
      <p className="rounded-xl border border-[#EDA9A9] bg-[#FDECEC] px-4 py-4 text-[0.85rem] leading-[1.9] text-[#9B1C1C]">
        そのガチャは、いま販売しておりません。
      </p>
    </>
  );
}

/* ══════════════════════════════════════════════
   ⓪ ログイン／DEMO MODE／追加の本人確認
   ══════════════════════════════════════════════ */

/**
 * お客様のログイン画面。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、お客様側にもログインを付けたのか
 * ═══════════════════════════════════════════════
 *
 *   前は「お客様はガチャを引きに来ただけだから、鍵は要らない」と
 *   書いていました。これは半分だけ正しくて、半分は危険でした。
 *
 *   棚を見るのに鍵は要りません。
 *   しかし、この画面には、その方だけのものが並んでいます。
 *     ・保有ポイント（お金と同じ）
 *     ・当たった商品（換金できる資産）
 *     ・お届け先の住所と電話番号
 *   これらが誰でも開ける場所にあるのは、
 *   店の棚ではなく、店の金庫を開けっぱなしにしているのと同じです。
 *
 * ═══════════════════════════════════════════════
 * ★デモでパスワードを打たせないこと
 * ═══════════════════════════════════════════════
 *
 *   本物らしいパスワード欄を出すと、
 *   本当のパスワードを打ってしまう方が必ず出ます。
 *   打てない作りにしておくのが、いちばん確実です。
 *   管理画面（Gate.tsx）と、同じ考え方です。
 */
function CustomerLogin({
  s,
  onLogin,
  back,
}: {
  s: ConsoleState;
  onLogin: (userId: string) => void;
  /** 棚へ戻る。★ログイン画面を行き止まりにしないこと */
  back: () => void;
}) {
  const [open, setOpen] = useState(false);
  const method = s.customerAuth;

  /* ★停止中の会員を、ログインできる人として並べないこと。
     並べてしまうと「押せるのに入れない」画面になり、
     止めているのか壊れているのか、見た人には区別できません */
  const list = s.users.filter((u) => u.status !== "SUSPENDED");

  const free = CUSTOMER_GATES.filter((g) => !g.needsLogin);
  const locked = CUSTOMER_GATES.filter((g) => g.needsLogin);

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-4">
      <Back onClick={back} label="ガチャ一覧へ" />
      <div className="rounded-2xl bg-[#0F1B33] px-5 py-5 text-white shadow-lg">
        <p className="text-[0.7rem] font-bold tracking-wider text-white/60">
          DEMO SHOP（架空のお店です）
        </p>
        <h1 className="mt-1 text-[1.25rem] font-bold leading-snug">マイページにログイン</h1>
        <p className="mt-2 text-[0.8rem] leading-[1.9] text-white/70">
          ポイント・当たった商品・お届け先は、ご本人だけのものです。
          ここから先は、ログインした方ご本人のみご覧いただけます。
        </p>
      </div>

      <DemoModeNote />

      <div className="mt-4 space-y-3">
        <p className="text-[0.85rem] font-bold text-slate">
          デモユーザーとして開始する
        </p>
        {list.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => onLogin(u.id)}
            className="block w-full rounded-2xl border border-edge bg-white px-4 py-4 text-left shadow-sm transition hover:border-[#1B4BD8] hover:shadow-md"
          >
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="text-[1rem] font-bold text-slate">{u.name}</span>
              <span className="num text-[0.72rem] text-slate3">{u.id}</span>
            </span>
            <span className="mt-1 block text-[0.78rem] leading-[1.85] text-slate3">
              保有 {u.points.toLocaleString()}pt ／ 獲得商品{" "}
              {s.prizes.filter((p) => p.userId === u.id).length} 点
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-[#A9C8F5] bg-[#F5F9FF] px-4 py-4">
        <p className="text-[0.82rem] font-bold text-[#1B4BD8]">
          本番でのご本人確認：{CUSTOMER_AUTH_LABEL[method]}
        </p>
        <p className="mt-1 text-[0.78rem] leading-[1.9] text-slate2">
          {CUSTOMER_AUTH_NOTE[method]}
          <br />
          この方式は、管理サイトの「設定」からご契約後に切り替えられます。
        </p>
      </div>

      {/* ── ログインが要るもの／要らないもの ──
          ★ここを一覧で見せること。
            「どこから先が鍵の内側なのか」を口で説明すると、
            聞いた人ごとに違う理解になります。表にすれば1つになります */}
      <div className="mt-5 rounded-2xl border border-edge bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="text-[0.85rem] font-bold text-slate">
            どこから先が、ログインが要るのか
          </span>
          <span className="shrink-0 text-[0.78rem] font-bold text-[#1B4BD8]">
            {open ? "閉じる" : "見る"}
          </span>
        </button>

        {open && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-[0.78rem] font-bold text-[#14663A]">
                ログインなしでご覧いただけます
              </p>
              <ul className="mt-2 space-y-2">
                {free.map((g) => (
                  <li
                    key={g.key}
                    className="rounded-xl border border-[#9FD8B4] bg-[#E9F8EF] px-3 py-2"
                  >
                    <p className="text-[0.8rem] font-bold text-[#14663A]">{g.label}</p>
                    <p className="mt-0.5 text-[0.74rem] leading-[1.8] text-[#14663A]/85">
                      {g.why}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[0.78rem] font-bold text-[#9B1C1C]">
                ログインが必要です
              </p>
              <ul className="mt-2 space-y-2">
                {locked.map((g) => (
                  <li
                    key={g.key}
                    className="rounded-xl border border-[#EDA9A9] bg-[#FDECEC] px-3 py-2"
                  >
                    <p className="text-[0.8rem] font-bold text-[#9B1C1C]">{g.label}</p>
                    <p className="mt-0.5 text-[0.74rem] leading-[1.8] text-[#9B1C1C]/85">
                      {g.why}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-[0.72rem] leading-[1.9] text-slate3">
        これは動作を確かめるためのデモ画面です。DEMO DATA（架空のデータ）で動いています。<br />
        実際の決済・発送・メール送信は行いません。
      </p>
    </div>
  );
}

/**
 * DEMO MODE の断り書き。
 *
 * ★消さないこと。
 *   本物と見分けがつかない画面を人に見せてはいけません。
 *   とくにここは、本番なら通す確認をわざと省いています。
 *   省いていることを黙っているのは、嘘をつくのと同じです。
 */
function DemoModeNote() {
  return (
    <div className="mt-3 rounded-xl border border-[#E5C97A] bg-[#FFF7E4] px-4 py-3">
      <p className="flex items-center gap-2 text-[0.75rem] font-bold tracking-wider text-[#7A5A00]">
        <span className="rounded bg-[#7A5A00] px-1.5 py-0.5 text-[0.65rem] text-white">
          DEMO MODE
        </span>
        操作を簡略化しています
      </p>
      <p className="mt-1.5 text-[0.78rem] leading-[1.9] text-[#7A5A00]">
        確認用デモでは操作を簡略化しています。本番環境では設定した認証方式が適用されます。
        パスワードは入力しません。実際のメール・SMSも送信しません。
      </p>
    </div>
  );
}

/**
 * 追加の本人確認（STEP-UP AUTH）。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、ログイン後にもう一度確認するのか
 * ═══════════════════════════════════════════════
 *
 *   乗っ取りは、ログインを突破した「あと」に本番が始まります。
 *     ①見慣れない端末から入る ②送り先を書き換える ③高いものを送らせる
 *   ログインの鍵だけでは、②と③を止められません。
 *
 *   だから、被害の大きい操作の直前だけ、もう一度確かめます。
 *   全部の操作で毎回確かめると、誰も使わなくなります。
 *   「いつもは通す。危ないところだけ止める」が、続けられる形です。
 *
 * ★止めた操作は、この画面が覚えていないこと。
 *   覚えているのは受け取り側（state.ts の stepUp.pending）です。
 *   画面が覚えて送り直す形にすると、
 *   確認した操作と、実際に実行される操作が、別のものになり得ます。
 */
function StepUpPanel({
  reason,
  note,
  onOk,
  onCancel,
}: {
  reason: StepUpReason;
  note: string;
  onOk: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");

  return (
    <div className="px-4 pt-3">
      <div className="rounded-2xl border-2 border-[#EDA9A9] bg-[#FDECEC] px-4 py-4">
        <p className="text-[0.9rem] font-bold text-[#9B1C1C]">
          もう一度、ご本人か確認させてください
        </p>
        <p className="mt-1.5 text-[0.8rem] leading-[1.9] text-[#9B1C1C]">
          この操作：<strong className="font-bold">{STEP_UP_LABEL[reason]}</strong>
          <br />
          {note}
        </p>
        <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-[0.76rem] leading-[1.85] text-[#9B1C1C]">
          {STEP_UP_WHY[reason]}
        </p>

        <div className="mt-3 rounded-xl border border-[#E5C97A] bg-[#FFF7E4] px-3 py-2.5">
          <p className="text-[0.74rem] leading-[1.85] text-[#7A5A00]">
            本番では、ご登録のメールまたはSMSに6桁の数字が届きます。
            このデモでは、次の数字をご入力ください。
          </p>
          <p className="num mt-1 text-[1.4rem] font-bold tracking-[0.3em] text-[#7A5A00]">
            {DEMO_STEP_UP_CODE}
          </p>
        </div>

        <input
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="num mt-3 w-full rounded-xl border border-edge bg-white px-3 py-3 text-[1rem] tracking-[0.3em] text-slate outline-none focus:border-[#1B4BD8]"
        />

        <div className="mt-3 space-y-2">
          <BigBtn onClick={() => onOk(code)} disabled={code.length !== 6}>
            確認して、この操作を続ける
          </BigBtn>
          <BigBtn tone="quiet" onClick={onCancel}>
            やめる
          </BigBtn>
        </div>
      </div>
    </div>
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
  shippingCount,
  exchangedCount,
  movingCount,
  ticketCount,
  openTicketCount,
  hasAddress,
  go,
}: {
  userName: string;
  balance: number;
  prizeCount: number;
  unchosenCount: number;
  shippingCount: number;
  exchangedCount: number;
  movingCount: number;
  ticketCount: number;
  openTicketCount: number;
  hasAddress: boolean;
  go: (v: View) => void;
}) {
  return (
    <>
      <H sub={`${userName}様。数字を押すと、中身をご確認いただけます。`}>マイページ</H>

      {/* ★お店なので、いちばん上は「引く」であること。
          マイページの管理項目だけが並ぶ画面は、店ではなく事務所です */}
      <button
        type="button"
        onClick={() => go({ name: "shop" })}
        className="mb-4 flex w-full items-center justify-between gap-3 rounded-2xl bg-[#1B4BD8] px-5 py-4 text-left text-white shadow-sm transition hover:bg-[#163CAE]"
      >
        <span className="min-w-0">
          <span className="block text-[1rem] font-bold">ガチャを引く</span>
          <span className="mt-1 block text-[0.75rem] leading-[1.8] text-white/75">
            販売中のガチャと、当たる商品の本数をご覧いただけます
          </span>
        </span>
        <span className="shrink-0 text-[1.1rem]" aria-hidden>
          ›
        </span>
      </button>

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
          note="当たった商品の全部です。下の3つを足すと、この数になります"
          onClick={() => go({ name: "prizes" })}
        />

        {/* ── 内訳 ──
            ★合計と内訳を、必ず足し算が合う形で並べること。
              前は「獲得商品23点／発送手配中23点」と並べていました。
              これを見た方は「23点ぜんぶ発送中なのか？」と読みます。
              実際は、まだ選んでいないものも、交換済みのものも混ざっています。
              数字が正しくても、並べ方で誤解されるなら、それは間違った案内です。 */}
        <div className="rounded-2xl border border-edge bg-white p-2 shadow-sm">
          <p className="px-2 pb-1 pt-1.5 text-[0.75rem] font-bold text-slate3">
            内訳（{unchosenCount} ＋ {shippingCount} ＋ {exchangedCount} ＝ {prizeCount} 点）
          </p>
          <div className="space-y-1">
            <MiniRow
              label="受取方法が未選択"
              value={unchosenCount}
              tone={unchosenCount > 0 ? "warn" : "quiet"}
              note="発送か、ポイント交換かをお選びいただけます"
              onClick={() => go({ name: "prizes" })}
            />
            <MiniRow
              label="発送手配中"
              value={shippingCount}
              tone="blue"
              note="配送状況と追跡番号をご確認いただけます"
              onClick={() => go({ name: "orders" })}
            />
            <MiniRow
              label="ポイント交換済み"
              value={exchangedCount}
              tone="quiet"
              note="交換した分は、ポイント履歴に残っています"
              onClick={() => go({ name: "points" })}
            />
          </div>
        </div>

        <TapCard
          label="発送状況"
          value={movingCount}
          unit="件"
          note={
            movingCount > 0
              ? "お届けまでの状況をご確認いただけます"
              : "お届け中のお荷物はありません"
          }
          onClick={() => go({ name: "orders" })}
        />

        {/* ★0件でも押せるようにすること。
            「0件だから」と押せなくすると、
            新しく問い合わせたい方の入口が、その画面から消えます */}
        <TapCard
          label="お問い合わせ"
          value={ticketCount}
          unit="件"
          note={
            openTicketCount > 0
              ? `${openTicketCount} 件が対応中です`
              : "新しいご質問も、こちらから送れます"
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

      {/* ── お届け先 ──
          ★住所が未登録のまま発送を選べる導線にしないこと。
            宛先のない発送依頼は、受け取った側で必ず止まります。
            止まってから気づくより、先に登録していただくほうが早いです */}
      <button
        type="button"
        onClick={() => go({ name: "address" })}
        className={[
          "mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-4 text-left shadow-sm transition",
          hasAddress
            ? "border-edge bg-white hover:border-[#1B4BD8]"
            : "border-[#EDA9A9] bg-[#FDECEC] hover:border-[#9B1C1C]",
        ].join(" ")}
      >
        <div className="min-w-0">
          <p
            className={[
              "text-[0.85rem] font-bold",
              hasAddress ? "text-slate" : "text-[#9B1C1C]",
            ].join(" ")}
          >
            お届け先
          </p>
          <p
            className={[
              "mt-1 text-[0.75rem] leading-[1.8]",
              hasAddress ? "text-slate3" : "text-[#9B1C1C]",
            ].join(" ")}
          >
            {hasAddress
              ? "ご登録済みです。変更には、追加の本人確認が入ります"
              : "まだご登録がありません。発送のご依頼には、お届け先が必要です"}
          </p>
        </div>
        <span className="shrink-0 text-[1.1rem] text-[#1B4BD8]" aria-hidden>
          ›
        </span>
      </button>
    </>
  );
}

/** 内訳の1行。★合計カードより小さく出して、主従を間違えないこと */
function MiniRow({
  label,
  value,
  note,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  note: string;
  tone: "warn" | "blue" | "quiet";
  onClick: () => void;
}) {
  const dot =
    tone === "warn" ? "bg-[#E5C97A]" : tone === "blue" ? "bg-[#A9C8F5]" : "bg-[#D2D5DA]";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-paper2"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <div className="min-w-0">
          <p className="text-[0.82rem] font-bold text-slate">{label}</p>
          <p className="mt-0.5 text-[0.72rem] leading-[1.75] text-slate3">{note}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-baseline gap-1">
        <span className="num text-[1.05rem] font-bold text-slate">{value}</span>
        <span className="text-[0.7rem] font-bold text-slate3">点</span>
        <span className="ml-0.5 text-[0.95rem] text-[#1B4BD8]" aria-hidden>
          ›
        </span>
      </div>
    </button>
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

/**
 * 獲得商品の一覧。
 *
 * ═══════════════════════════════════════════════
 * ★23点を、23回押させないこと
 * ═══════════════════════════════════════════════
 *
 *   1件ずつ選ぶ画面は、作るのは簡単です。
 *   しかし、当たりが増えるほど使えなくなります。
 *   23点あれば、確認画面を含めて50回以上押すことになります。
 *   そこまで押していただいた頃には、
 *   何を選んだのか、ご本人にも分からなくなっています。
 *
 *   だから、まとめて選べるようにします。
 *
 * ★ただし、まとめる操作ほど慎重にすること。
 *   まとめてポイント交換は、取り消せません。
 *   一度に5点以上は、追加の本人確認（STEP-UP）に回ります。
 *   その判断をするのは、この画面ではなく受け取り側です。
 *   ここは「何を選んだか」を送るだけにします。
 */
function PrizeList({
  prizes,
  go,
  back,
  onBulkShip,
  onBulkExchange,
}: {
  prizes: Prize[];
  go: (v: View) => void;
  back: () => void;
  onBulkShip: (ids: string[]) => void;
  onBulkExchange: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState<"ALL" | Prize["status"]>("ALL");
  const [picked, setPicked] = useState<string[]>([]);
  const [ask, setAsk] = useState<"SHIP" | "EXCHANGE" | null>(null);

  const list = filter === "ALL" ? prizes : prizes.filter((p) => p.status === filter);

  /* ★選べるのは、まだ受け取り方法が決まっていないものだけ。
     決まったものを選べる画面にすると、
     「選んだのに何も起きない」が起きます */
  const selectable = list.filter((p) => p.status === "UNCHOSEN");
  const pickedPrizes = prizes.filter((p) => picked.includes(p.id) && p.status === "UNCHOSEN");
  const pickedPt = pickedPrizes.reduce((acc, p) => acc + p.exchangePt, 0);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const allPicked = selectable.length > 0 && selectable.every((p) => picked.includes(p.id));

  const run = () => {
    const ids = pickedPrizes.map((p) => p.id);
    if (ids.length === 0) return;
    if (ask === "SHIP") onBulkShip(ids);
    if (ask === "EXCHANGE") onBulkExchange(ids);
    setPicked([]);
    setAsk(null);
  };

  /* ── まとめ操作の確認 ──
      ★お金が動く操作は、まとめても1タップで確定させないこと */
  if (ask) {
    return (
      <>
        <Back onClick={() => setAsk(null)} label="獲得商品" />
        <H sub={`${pickedPrizes.length} 点をまとめて処理します。取り消しはできません。`}>
          {ask === "SHIP" ? "まとめて発送のご確認" : "まとめてポイント交換のご確認"}
        </H>

        <ul className="space-y-2 rounded-2xl border border-edge bg-white p-3 shadow-sm">
          {pickedPrizes.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <PrizeArt grade={p.grade} size="sm" />
              <p className="min-w-0 flex-1 truncate text-[0.85rem] font-bold text-slate">
                {p.name}
              </p>
              <span className="num shrink-0 text-[0.78rem] font-bold text-slate3">
                {p.exchangePt.toLocaleString()}pt
              </span>
            </li>
          ))}
        </ul>

        {ask === "EXCHANGE" ? (
          <>
            <div className="mt-4 rounded-2xl bg-[#0F1B33] px-4 py-4 text-white">
              <p className="text-[0.78rem] text-white/60">加算されるポイント</p>
              <p className="num mt-1 text-[1.75rem] font-bold leading-none">
                +{pickedPt.toLocaleString()}
                <span className="ml-1 text-[0.85rem] font-medium">pt</span>
              </p>
            </div>
            <p className="mt-3 rounded-xl border border-[#EDA9A9] bg-[#FDECEC] px-4 py-3 text-[0.8rem] leading-[1.85] text-[#9B1C1C]">
              ★{pickedPt.toLocaleString()}ptへ交換します。交換後は、これらの商品の発送依頼ができません。
            </p>
          </>
        ) : (
          <p className="mt-3 rounded-xl border border-[#E5C97A] bg-[#FFF7E4] px-4 py-3 text-[0.8rem] leading-[1.85] text-[#7A5A00]">
            ★ご登録のお届け先へ、{pickedPrizes.length} 点の発送をご依頼します。
            発送をご依頼されると、これらの商品はポイントへ交換できなくなります。
          </p>
        )}

        <div className="mt-4 space-y-3">
          <BigBtn onClick={run}>
            {ask === "SHIP"
              ? `${pickedPrizes.length} 点の発送を依頼する`
              : `${pickedPt.toLocaleString()}pt へ交換する`}
          </BigBtn>
          <BigBtn tone="quiet" onClick={() => setAsk(null)}>
            キャンセル
          </BigBtn>
        </div>
      </>
    );
  }

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

      {/* ── まとめて選ぶ ──
          ★選べるものが無いときは、この帯ごと出さないこと。
            押せないボタンが並んでいるだけの画面は、
            壊れているように見えます */}
      {selectable.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-edge bg-paper2 px-3 py-2.5">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() =>
                setPicked(allPicked ? [] : selectable.map((p) => p.id))
              }
              className="h-5 w-5 accent-[#1B4BD8]"
            />
            <span className="text-[0.8rem] font-bold text-slate">
              未選択の {selectable.length} 点をすべて選ぶ
            </span>
          </label>
          {picked.length > 0 && (
            <button
              type="button"
              onClick={() => setPicked([])}
              className="shrink-0 text-[0.76rem] font-bold text-[#1B4BD8] underline"
            >
              選択を外す
            </button>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <p className="rounded-xl border border-edge bg-paper2 px-4 py-6 text-center text-[0.85rem] text-slate3">
          このしぼり込みに当てはまる商品はありません。
        </p>
      ) : (
        <ul className={picked.length > 0 ? "space-y-3 pb-40" : "space-y-3"}>
          {list.map((p) => {
            const canPick = p.status === "UNCHOSEN";
            const on = picked.includes(p.id);
            return (
              <li key={p.id}>
                <div
                  className={[
                    "flex items-center gap-2 rounded-2xl border bg-white px-2 py-3 shadow-sm transition",
                    on ? "border-[#1B4BD8] bg-[#F5F9FF]" : "border-edge",
                  ].join(" ")}
                >
                  {/* ★選ぶ場所と、開く場所を分けること。
                      同じ場所が両方を兼ねると、
                      詳細を見たいだけの操作が、選択になってしまいます */}
                  {canPick ? (
                    <label className="flex cursor-pointer items-center px-1.5 py-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(p.id)}
                        aria-label={`${p.name} を選ぶ`}
                        className="h-5 w-5 accent-[#1B4BD8]"
                      />
                    </label>
                  ) : (
                    <span className="w-8 shrink-0" aria-hidden />
                  )}

                  <button
                    type="button"
                    onClick={() => go({ name: "prize", id: p.id })}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
                    <span className="shrink-0 pr-1 text-[1.1rem] text-[#1B4BD8]" aria-hidden>
                      ›
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── 選んだあとの操作 ──
          ★画面の下に固定すること。
            一覧を下までたどってから上へ戻る作りにすると、
            選んだ内容を見失います */}
      {pickedPrizes.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,27,51,0.12)] backdrop-blur">
          <div className="mx-auto w-full max-w-[560px]">
            <p className="text-[0.8rem] font-bold text-slate">
              {pickedPrizes.length} 点を選択中
              <span className="num ml-2 font-medium text-slate3">
                （交換すると +{pickedPt.toLocaleString()}pt）
              </span>
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setAsk("SHIP")}
                className="flex-1 rounded-xl bg-[#1B4BD8] px-3 py-3 text-[0.88rem] font-bold text-white transition hover:bg-[#163CAE]"
              >
                まとめて発送
              </button>
              <button
                type="button"
                onClick={() => setAsk("EXCHANGE")}
                className="flex-1 rounded-xl border-2 border-[#1B4BD8] bg-white px-3 py-3 text-[0.88rem] font-bold text-[#1B4BD8] transition hover:bg-[#F2F6FF]"
              >
                まとめてポイント交換
              </button>
            </div>
          </div>
        </div>
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

/**
 * 発送の前に、ご登録のお届け先を確認していただく画面。
 *
 * ═══════════════════════════════════════════════
 * ★ここで住所を「入力」させないこと
 * ═══════════════════════════════════════════════
 *
 *   前は、この画面が入力欄になっていました。
 *   入力した住所を、そのまま発送の依頼に付けて送っていました。
 *
 *   それは、送り先を送信のたびに自由に決められる、ということです。
 *   受け取った側から見ると、届いた住所が
 *   本当にその方のものかを確かめる手立てがありません。
 *   乗っ取った人は、ここに自分の家を書くだけで済みます。
 *
 *   だから今は、
 *     ・この画面は「登録されている住所」を表示するだけ
 *     ・変えるときは、別の画面で、追加の本人確認を通してから
 *     ・発送の依頼に、住所は付けない（受け取り側が本人の登録住所を使う）
 *   という形にしています。
 */
function ShipAddressCheck({
  p,
  address,
  onNext,
  onEdit,
  back,
}: {
  p: Prize;
  address: Address | undefined;
  onNext: () => void;
  onEdit: () => void;
  back: () => void;
}) {
  return (
    <>
      <Back onClick={back} label="商品の詳細" />
      <H sub={`「${p.name}」を、ご登録のお届け先へお送りします。`}>お届け先の確認</H>

      {address ? (
        <>
          <div className="rounded-2xl border border-edge bg-white p-4 shadow-sm">
            <p className="text-[0.78rem] font-bold text-slate3">ご登録のお届け先</p>
            <p className="num mt-2 text-[0.9rem] leading-[1.95] text-slate">
              〒{address.zip}
              <br />
              {address.addr}
              <br />
              {address.name}　{address.tel}
            </p>
          </div>

          <p className="mt-3 rounded-xl border border-[#A9C8F5] bg-[#F5F9FF] px-4 py-3 text-[0.78rem] leading-[1.9] text-slate2">
            発送先は、ログイン中のご本人に登録されている住所です。
            この画面から書き換えることはできません。
            変更には、追加の本人確認が必要です。
          </p>

          <div className="mt-4 space-y-3">
            <BigBtn onClick={onNext}>この住所で確認へすすむ</BigBtn>
            <BigBtn tone="second" onClick={onEdit} note="追加の本人確認が入ります">
              お届け先を変更する
            </BigBtn>
          </div>
        </>
      ) : (
        <>
          <p className="rounded-xl border border-[#EDA9A9] bg-[#FDECEC] px-4 py-4 text-[0.85rem] leading-[1.9] text-[#9B1C1C]">
            お届け先がまだご登録されていません。
            <br />
            宛先のない発送は、お受けできません。先にご登録をお願いします。
          </p>
          <div className="mt-4">
            <BigBtn onClick={onEdit}>お届け先を登録する</BigBtn>
          </div>
        </>
      )}

      <p className="mt-3 text-[0.78rem] leading-[1.85] text-slate3">
        ここは架空の住所です。デモのため、実際の配送は行いません。
      </p>
    </>
  );
}

/**
 * お届け先そのものを変える画面。
 *
 * ★ここは、必ず追加の本人確認を通ること。
 *   乗っ取りは、ほぼ必ずこの順で進みます。
 *     ①どこかから入る ②送り先を書き換える ③高いものを送らせる
 *   ②で止められれば、③は起きません。
 *   ①を完全に防ぐことはできないので、止めるならここです。
 *
 * ★確認を求めるのは、この画面ではありません。
 *   ここは「変えたい住所」を送るだけです。
 *   要るか要らないかを決めるのは、受け取った側です。
 */
function AddressForm({
  initial,
  onSubmit,
  back,
}: {
  initial: Address | undefined;
  onSubmit: (a: Address) => void;
  back: () => void;
}) {
  const [a, setA] = useState<Address>(
    initial ?? { name: "", zip: "", addr: "", tel: "" },
  );
  const filled = a.name.trim() && a.zip.trim() && a.addr.trim() && a.tel.trim();

  return (
    <>
      <Back onClick={back} label="マイページ" />
      <H sub="変更には、もう一度ご本人かどうかの確認が入ります。">お届け先の変更</H>

      <div className="space-y-3 rounded-2xl border border-edge bg-white p-4 shadow-sm">
        <Fld label="お名前" value={a.name} onChange={(v) => setA({ ...a, name: v })} />
        <Fld label="郵便番号" value={a.zip} onChange={(v) => setA({ ...a, zip: v })} />
        <Fld label="ご住所" value={a.addr} onChange={(v) => setA({ ...a, addr: v })} />
        <Fld label="お電話番号" value={a.tel} onChange={(v) => setA({ ...a, tel: v })} />
      </div>

      <p className="mt-3 rounded-xl border border-[#E5C97A] bg-[#FFF7E4] px-4 py-3 text-[0.78rem] leading-[1.9] text-[#7A5A00]">
        ★お届け先を変更されますと、変更の直後の高額商品の発送では、
        もう一度ご本人確認をお願いすることがあります。
        身に覚えのない変更を防ぐための仕組みです。
      </p>

      <p className="mt-3 text-[0.78rem] leading-[1.85] text-slate3">
        ここは架空の住所です。デモのため、実際の配送は行いません。
        実在するご住所・お電話番号はご入力にならないでください。
      </p>

      <div className="mt-4 space-y-3">
        <BigBtn onClick={() => onSubmit(a)} disabled={!filled}>
          この内容に変更する
        </BigBtn>
        <BigBtn tone="quiet" onClick={back}>
          やめる
        </BigBtn>
        {!filled && (
          <p className="text-center text-[0.78rem] text-[#9B1C1C]">
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
  address: Address | undefined;
  onSubmit: () => void;
  back: () => void;
}) {
  const [sent, setSent] = useState(false);

  return (
    <>
      <Back onClick={back} label="お届け先の確認" />
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
          {address ? (
            <p className="num mt-1 text-[0.85rem] leading-[1.9] text-slate">
              〒{address.zip}
              <br />
              {address.addr}
              <br />
              {address.name}　{address.tel}
            </p>
          ) : (
            <p className="mt-1 text-[0.85rem] font-bold leading-[1.9] text-[#9B1C1C]">
              お届け先がご登録されていません。先にご登録をお願いします。
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-[#E5C97A] bg-[#FFF7E4] px-4 py-3 text-[0.78rem] leading-[1.85] text-[#7A5A00]">
        ★発送をご依頼されると、この商品はポイントへ交換できなくなります。
      </p>

      <div className="mt-4">
        <BigBtn
          disabled={sent || !address}
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
