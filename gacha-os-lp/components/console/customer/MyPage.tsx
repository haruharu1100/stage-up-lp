/**
 * ユーザー側（実際に販売される画面）の入口。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルは「つなぐ役」だけをすること
 * ═══════════════════════════════════════════════════════
 *
 *   以前は、この1枚に売り場も演出もマイページも全部入っていました。
 *   2400行ありました。直したい場所を探すのに、まず本文を読む必要がありました。
 *
 *   いまは分けてあります。
 *     Storefront.tsx … 売り場・ガチャ詳細・引いたときの演出
 *     Account.tsx    … マイページ・獲得商品・発送・交換・履歴
 *     ui.tsx         … 押せる大きさ・注意書きなど、共通の部品
 *     notices.ts     … お知らせ（事実から組み立てる）
 *     catalog.ts     … 棚の並べ方・引ける回数
 *     art.tsx        … 商品と表紙の絵
 *
 *   ここに残っているのは、
 *     ・いま誰としてログインしているか
 *     ・どの画面を出すか
 *     ・押されたときに、どの操作を送るか
 *   の3つだけです。見た目はここに書きません。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面は、管理画面と同じ材料でできています
 * ═══════════════════════════════════════════════════════
 *
 *   ユーザー側だけのダミーデータは、1つも持っていません。
 *   管理サイトが見ているのと同じ state を、そのまま見ています。
 *   だから、ここで「発送する」を押した瞬間に、
 *   管理サイトの未発送が1件増えます。作り込んだ演出ではありません。
 *
 * ═══════════════════════════════════════════════════════
 * ★お金が動く操作は、1タップで確定させないこと
 * ═══════════════════════════════════════════════════════
 *
 *   発送も、ポイント交換も、後から取り消せません。
 *   だから必ず、確認の画面を1枚はさみます。
 *     発送する      → お届け先を確認 → 依頼する
 *     ポイントに交換 → 何ptになるか確認 → 交換する
 */

"use client";

import { useState } from "react";
import type {
  ConsoleAction,
  ConsoleState,
  StepUpReason,
} from "@/lib/console/state";
import {
  CUSTOMER_AUTH_LABEL,
  CUSTOMER_AUTH_NOTE,
  CUSTOMER_GATES,
  DEMO_STEP_UP_CODE,
  STEP_UP_LABEL,
  STEP_UP_WHY,
} from "@/lib/console/state";
import { ORDER_STATUS_LABEL } from "@/lib/console/support";

import {
  type View,
  AccountHome,
  NoticeList,
  PrizeList,
  PrizeDetail,
  ShipAddressCheck,
  AddressForm,
  ShipConfirm,
  ExchangeConfirm,
  OrderList,
  SupportView,
  PointHistory,
  Missing,
  MissingGacha,
} from "./Account";
import { Shop, GachaDetail, DrawTheater } from "./Storefront";
import { artKindOf } from "./art";
import { maxDraws } from "./catalog";
import { noticesOf, todoCount } from "./notices";
import {
  Back,
  BigBtn,
  Note,
  Panel,
  TONE,
  SHOP_ACCENT,
  SHOP_EDGE,
  SHOP_SURFACE,
} from "./ui";

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
  const [view, setRawView] = useState<View>({ name: "shop" });

  /**
   * 画面を移る。
   *
   * ★移ったら、いちばん上から見せること。
   *   前の画面で下まで送っていた位置が残ると、
   *   タブを押した瞬間、次の画面の途中から始まります。
   *   見出しが見えないので、どこへ来たのか分かりません。
   *   「押したのに何も変わらなかった」と受け取られます。
   *
   * ★同じ画面をもう一度押したときも、上へ戻すこと。
   *   スマホで下まで送ったあと、いま居るタブをもう一度押すのは、
   *   「先頭に戻りたい」という意味です。
   */
  const setView = (v: View) => {
    setRawView(v);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  /**
   * ログインの前に見ていたガチャ。
   *
   * ★ログインしたら、見ていたところへ戻すこと。
   *   毎回マイページの先頭へ飛ばすと、
   *   引こうとした方が、もう一度ガチャを探し直すことになります。
   */
  const [pending, setPending] = useState<string | null>(null);

  /**
   * いま演出で見せている抽選。
   *
   * ★結果そのものを、この画面が持たないこと。
   *   持つと「画面が覚えている結果」と「記録に残った結果」が
   *   別々になり得ます。ここが覚えているのは
   *   「s.draws の、どこから先が今回の分か」という目印だけです。
   *   中身は毎回、記録のほうから読み直します。
   */
  const [draw, setDraw] = useState<{ from: number; n: number } | null>(null);

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
    const toLogin = () => setView({ name: "login" });

    if (view.name === "login") {
      return (
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
    }

    if (view.name === "gacha") {
      const g = s.gachas.find((x) => x.id === view.id);
      if (g && g.status === "PUBLISHED") {
        return (
          <PublicShell onLogin={toLogin} view={view} go={setView}>
            <GachaDetail
              g={g}
              balance={null}
              loggedIn={false}
              onDraw={() => {
                setPending(g.id);
                toLogin();
              }}
              onLogin={() => {
                setPending(g.id);
                toLogin();
              }}
              back={() => setView({ name: "shop" })}
            />
          </PublicShell>
        );
      }
      return (
        <PublicShell onLogin={toLogin} view={view} go={setView}>
          <MissingGacha back={() => setView({ name: "shop" })} />
        </PublicShell>
      );
    }

    return (
      <PublicShell onLogin={toLogin} view={view} go={setView}>
        <Shop
          gachas={s.gachas}
          balance={null}
          onOpen={(id) => setView({ name: "gacha", id })}
        />
      </PublicShell>
    );
  }

  /* ══════════════════════════════════════════
     ここから先は、ログインしたご本人の分だけ
     ══════════════════════════════════════════

     ★userId の絞り込みを、1か所でまとめてやること。
       画面ごとに書くと、必ずどこか1つ書き忘れます。
       書き忘れた画面には、他の方の当選内容が出ます */
  const prizes = s.prizes.filter((p) => p.userId === me.id);
  const orders = s.orders.filter((o) => o.userId === me.id);
  const tickets = s.tickets.filter((t) => t.userId === me.id);
  const ledger = s.ledger.filter((e) => e.userId === me.id);

  const notices = noticesOf(s, me.id);
  const todo = todoCount(notices);

  const prizeOf = (id: string) => prizes.find((p) => p.id === id);

  /* ── いま演出に出す抽選 ──
     ★目印より後ろの、ご本人の分だけを出すこと */
  const drawRecords =
    draw === null
      ? []
      : s.draws.slice(draw.from).filter((d) => d.userId === me.id);

  const gachaOnScreen =
    view.name === "gacha" ? s.gachas.find((x) => x.id === view.id) : undefined;

  /** n回引く。★1回ずつ送ること。まとめて送ると、途中で残高が尽きた分を戻せません */
  const runDraw = (gachaId: string, n: number) => {
    setDraw({ from: s.draws.length, n });
    for (let i = 0; i < n; i++) {
      dispatch({ type: "DRAW", gachaId, key: newKey("draw", `${gachaId}-${i}`) });
    }
  };

  return (
    <div
      className="mx-auto w-full max-w-[560px]"
      style={{ paddingBottom: "calc(var(--day-h, 0px) + 96px)" }}
    >
      {/* ── 上の帯（お店の名前と残高） ── */}
      {/* ★上の切り替え帯の下に貼りつくこと。重ねると残高が読めなくなる */}
      <header
        className="sticky top-[var(--switch-h,0px)] z-[45] px-4 py-3 text-white"
        style={{
          background: "rgba(9,14,26,0.94)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: `1px solid ${SHOP_EDGE}`,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setView({ name: "shop" })}
            className="nb min-w-0 text-left"
          >
            <span className="block text-[0.62rem] font-bold tracking-[0.18em] text-white/45">
              DEMO SHOP
            </span>
            <span className="block truncate text-[0.95rem] font-bold">
              {me.name} 様
            </span>
          </button>

          <button
            type="button"
            onClick={() => setView({ name: "points" })}
            className="shrink-0 rounded-xl px-3 py-2 text-right transition active:scale-[0.98]"
            style={{ background: "rgba(255,255,255,0.07)", border: `1px solid ${SHOP_EDGE}` }}
          >
            <span className="block text-[0.62rem] font-bold text-white/50">保有ポイント</span>
            <span className="num block text-[1.05rem] font-bold leading-tight">
              {me.points.toLocaleString()}
              <span className="ml-0.5 text-[0.68rem] font-medium text-white/60">pt</span>
            </span>
          </button>
        </div>

        {/* ★「誰としてログインしているか」を、常に出しておくこと。
            ここが空欄の画面は、他人の情報を見ていても気づけません */}
        <button
          type="button"
          onClick={() => dispatch({ type: "CUSTOMER_LOGOUT" })}
          className="nb mt-1 text-[0.66rem] text-white/45 underline"
        >
          {CUSTOMER_AUTH_LABEL[s.customer?.method ?? "EMAIL"]}でログイン中／ログアウト
        </button>
      </header>

      <div className="px-4">
        <DemoModeNote />
      </div>

      {/* ── 追加の本人確認（STEP-UP AUTH） ──
          ★これが出ている間は、下の操作を続けさせないこと。
            「確認をお願いします」と出しながら、
            そのまま先へ進めてしまう画面には、意味がありません */}
      {s.stepUp && (
        <div className="px-4 pt-3">
          <StepUpPanel
            reason={s.stepUp.reason}
            note={s.stepUp.note}
            onOk={(code) => dispatch({ type: "CUSTOMER_STEP_UP", code })}
            onCancel={() => dispatch({ type: "CUSTOMER_STEP_UP_CANCEL" })}
          />
        </div>
      )}

      {/* ── お知らせ（操作の結果） ── */}
      {/* ★お客様に向けて書かれた文だけを出すこと。
          運営側の知らせには、担当者の名前と役割が入っています。
          「運営 太郎（管理者（全権））としてログインしました。」が
          ここに出たら、本番ならそのまま情報の漏れです */}
      {s.flash?.to === "customer" && (
        <div className="px-4 pt-3">
          <div
            className="rounded-xl px-4 py-3 text-[0.83rem] leading-[1.85]"
            style={(() => {
              const t =
                s.flash.kind === "ok"
                  ? TONE.ok
                  : s.flash.kind === "warn"
                    ? TONE.warn
                    : TONE.danger;
              return { background: t.bg, border: `1px solid ${t.line}`, color: t.fg };
            })()}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1">{s.flash.text}</p>
              <button
                type="button"
                onClick={() => dispatch({ type: "CLEAR_FLASH" })}
                className="nb shrink-0 text-[0.74rem] font-bold underline"
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
            onOpen={(id) => setView({ name: "gacha", id })}
          />
        )}

        {view.name === "gacha" &&
          (gachaOnScreen && gachaOnScreen.status === "PUBLISHED" ? (
            <GachaDetail
              g={gachaOnScreen}
              balance={me.points}
              loggedIn
              onDraw={(n) => runDraw(gachaOnScreen.id, n)}
              onLogin={() => setView({ name: "login" })}
              back={() => setView({ name: "shop" })}
            />
          ) : (
            <MissingGacha back={() => setView({ name: "shop" })} />
          ))}

        {view.name === "home" && (
          <AccountHome
            userName={me.name}
            balance={me.points}
            prizes={prizes}
            orders={orders}
            tickets={tickets}
            todo={todo}
            hasAddress={Boolean(me.address)}
            go={setView}
            onLogout={() => dispatch({ type: "CUSTOMER_LOGOUT" })}
          />
        )}

        {view.name === "notices" && (
          <NoticeList list={notices} go={setView} back={() => setView({ name: "home" })} />
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

      <p className="mt-8 px-4 text-center text-[0.7rem] leading-[1.9] text-white/35">
        これは動作を確かめるためのデモ画面です。DEMO DATA（架空のデータ）で動いています。
        <br />
        実際の決済・発送・メール送信は行いません。
      </p>

      {/* ── 引いたときの演出 ──
          ★演出の中から「もう一度」を押せること。
            結果を見たあと、また商品ページまで戻らせると、
            そこで1人ずつ抜けていきます */}
      {draw !== null && gachaOnScreen && (
        <DrawTheater
          records={drawRecords}
          kind={artKindOf(gachaOnScreen.title)}
          canAgain={maxDraws(gachaOnScreen.price, me.points, gachaOnScreen.left) >= draw.n}
          onAgain={() => runDraw(gachaOnScreen.id, draw.n)}
          onPrizes={() => {
            setDraw(null);
            setView({ name: "prizes" });
          }}
          onClose={() => setDraw(null)}
        />
      )}

      <TabBar view={view} go={setView} todo={todo} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   下タブ
   ══════════════════════════════════════════════ */

/**
 * 画面の下に、いつも出ているタブ。
 *
 * ★スマホの店に、これが無いのは致命的です。
 *   目的の画面まで、毎回「もどる」を3回押させることになります。
 *   3回押させる店では、2回目で見るのをやめます。
 *
 * ★下の案内パネルの分だけ、上へ逃がすこと（--day-h）。
 *   bottom-0 で置くと案内の裏に入り、押しても反応しないように見えます。
 *
 * ★数字のバッジは「まだ手を動かしていない件数」であること。
 *   開いただけで0になる数字は、
 *   出しても出さなくても同じです（notices.ts）。
 */
const TABS: {
  key: string;
  label: string;
  to: View;
  /** この画面を見ているとき、このタブが光る */
  match: View["name"][];
}[] = [
  { key: "shop", label: "ガチャ", to: { name: "shop" }, match: ["shop", "gacha"] },
  {
    key: "prizes",
    label: "獲得商品",
    to: { name: "prizes" },
    match: ["prizes", "prize", "ship", "shipConfirm", "exchange"],
  },
  { key: "notices", label: "お知らせ", to: { name: "notices" }, match: ["notices"] },
  { key: "orders", label: "発送", to: { name: "orders" }, match: ["orders"] },
  {
    key: "home",
    label: "マイページ",
    to: { name: "home" },
    match: ["home", "points", "support", "address", "login"],
  },
];

function TabIcon({ name, on }: { name: string; on: boolean }) {
  const c = on ? SHOP_ACCENT : "rgba(255,255,255,0.5)";
  const p = { fill: "none", stroke: c, strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden>
      {name === "shop" && (
        <>
          <path {...p} d="M4 8h16l-1.2 11.2a1.6 1.6 0 0 1-1.6 1.4H6.8a1.6 1.6 0 0 1-1.6-1.4L4 8Z" />
          <path {...p} d="M8.6 8V6.4a3.4 3.4 0 0 1 6.8 0V8" />
        </>
      )}
      {name === "prizes" && (
        <>
          <path {...p} d="M3.6 8.4h16.8v3.4H3.6z" />
          <path {...p} d="M5.2 11.8v7.2a1.4 1.4 0 0 0 1.4 1.4h10.8a1.4 1.4 0 0 0 1.4-1.4v-7.2" />
          <path {...p} d="M12 8.4v12M12 8.4S10.4 3.6 7.9 3.6a2.4 2.4 0 0 0 0 4.8M12 8.4s1.6-4.8 4.1-4.8a2.4 2.4 0 0 1 0 4.8" />
        </>
      )}
      {name === "notices" && (
        <>
          <path {...p} d="M18.2 9.4a6.2 6.2 0 1 0-12.4 0c0 5.4-2 6.9-2 6.9h16.4s-2-1.5-2-6.9Z" />
          <path {...p} d="M13.7 20a2 2 0 0 1-3.4 0" />
        </>
      )}
      {name === "orders" && (
        <>
          <path {...p} d="M2.8 7.6h10.6v9.6H2.8zM13.4 11h3.9l2.9 3v3.2h-6.8z" />
          <circle {...p} cx="6.6" cy="18.4" r="1.9" />
          <circle {...p} cx="16.6" cy="18.4" r="1.9" />
        </>
      )}
      {name === "home" && (
        <>
          <circle {...p} cx="12" cy="8.4" r="3.6" />
          <path {...p} d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0" />
        </>
      )}
    </svg>
  );
}

function TabBar({
  view,
  go,
  todo,
  locked,
}: {
  view: View;
  go: (v: View) => void;
  todo: number;
  /** ログインしていないとき、鍵の内側のタブを押したら行く先 */
  locked?: () => void;
}) {
  return (
    <nav
      aria-label="メニュー"
      className="fixed inset-x-0 z-[46]"
      style={{
        bottom: "var(--day-h, 0px)",
        background: "rgba(7,11,20,0.96)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: `1px solid ${SHOP_EDGE}`,
        paddingBottom: "max(0.35rem, env(safe-area-inset-bottom))",
      }}
    >
      <ul className="mx-auto flex w-full max-w-[560px]">
        {TABS.map((t) => {
          const on = t.match.includes(view.name);
          const badge = t.key === "notices" ? todo : 0;
          return (
            <li key={t.key} className="min-w-0 flex-1">
              <button
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => {
                  if (locked && t.key !== "shop") locked();
                  else go(t.to);
                }}
                className="nb relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1 pt-1.5 transition active:scale-[0.96]"
              >
                <span className="relative">
                  <TabIcon name={t.key} on={on} />
                  {badge > 0 && (
                    <span
                      className="num absolute -right-2.5 -top-1.5 min-w-[17px] rounded-full px-1 text-center text-[0.62rem] font-bold leading-[17px]"
                      style={{ background: "#E5484D", color: "#FFFFFF" }}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span
                  className="block text-[0.63rem] font-bold leading-none"
                  style={{ color: on ? SHOP_ACCENT : "rgba(255,255,255,0.5)" }}
                >
                  {t.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ══════════════════════════════════════════════
   ログインしていない人の外枠
   ══════════════════════════════════════════════ */

/**
 * ログインしていない方に見せる外枠。
 *
 * ★ログイン後の外枠を、そのまま使い回さないこと。
 *   出してよいのは、誰が見ても困らないものだけです。
 *   上の帯に残高を出す作りのまま流用すると、
 *   ログインしていない人の画面に、誰かの残高が出ます。
 */
function PublicShell({
  children,
  onLogin,
  view,
  go,
}: {
  children: React.ReactNode;
  onLogin: () => void;
  view: View;
  go: (v: View) => void;
}) {
  return (
    <div
      className="mx-auto w-full max-w-[560px]"
      style={{ paddingBottom: "calc(var(--day-h, 0px) + 96px)" }}
    >
      <header
        className="sticky top-[var(--switch-h,0px)] z-[45] px-4 py-3 text-white"
        style={{
          background: "rgba(9,14,26,0.94)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: `1px solid ${SHOP_EDGE}`,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.62rem] font-bold tracking-[0.18em] text-white/45">
              DEMO SHOP
            </p>
            <p className="truncate text-[0.95rem] font-bold">ログインしていません</p>
          </div>
          <button
            type="button"
            onClick={onLogin}
            className="shrink-0 rounded-xl px-4 py-2.5 text-[0.85rem] font-bold transition active:scale-[0.98]"
            style={{ background: SHOP_ACCENT, color: "#06101F" }}
          >
            ログイン
          </button>
        </div>
      </header>

      <div className="px-4">
        <DemoModeNote />
      </div>

      <main className="px-4 pt-4">{children}</main>

      <p className="mt-8 px-4 text-center text-[0.7rem] leading-[1.9] text-white/35">
        これは動作を確かめるためのデモ画面です。DEMO DATA（架空のデータ）で動いています。
        <br />
        実際の決済・発送・メール送信は行いません。
      </p>

      <TabBar view={view} go={go} todo={0} locked={onLogin} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   ログイン／DEMO MODE／追加の本人確認
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

      <div
        className="rounded-2xl px-5 py-5 text-white"
        style={{
          background: "linear-gradient(135deg, #16233F 0%, #0A1122 100%)",
          border: `1px solid ${SHOP_EDGE}`,
        }}
      >
        <p className="text-[0.62rem] font-bold tracking-[0.18em] text-white/45">
          DEMO SHOP
        </p>
        <h1 className="mt-1 text-[1.25rem] font-bold leading-snug">マイページにログイン</h1>
        <p className="mt-2 text-[0.8rem] leading-[1.9] text-white/65">
          ポイント・当たった商品・お届け先は、ご本人だけのものです。
          ここから先は、ログインした方ご本人のみご覧いただけます。
        </p>
      </div>

      <DemoModeNote />

      <div className="mt-4 space-y-2.5">
        <p className="text-[0.85rem] font-bold text-white/85">
          デモユーザーとして開始する
        </p>
        {list.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => onLogin(u.id)}
            className="block w-full rounded-2xl px-4 py-4 text-left transition active:scale-[0.995]"
            style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
          >
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="text-[1rem] font-bold text-white">{u.name}</span>
              <span className="num text-[0.72rem] text-white/40">{u.id}</span>
            </span>
            <span className="mt-1 block text-[0.78rem] leading-[1.85] text-white/55">
              保有 {u.points.toLocaleString()}pt ／ 獲得商品{" "}
              {s.prizes.filter((p) => p.userId === u.id).length} 点
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        <Note tone="info">
          <strong className="font-bold">本番でのご本人確認：{CUSTOMER_AUTH_LABEL[method]}</strong>
          <br />
          {CUSTOMER_AUTH_NOTE[method]}
          <br />
          この方式は、管理サイトの「設定」からご契約後に切り替えられます。
        </Note>
      </div>

      {/* ── ログインが要るもの／要らないもの ──
          ★ここを一覧で見せること。
            「どこから先が鍵の内側なのか」を口で説明すると、
            聞いた人ごとに違う理解になります。表にすれば1つになります */}
      <div className="mt-4">
        <Panel>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="nb flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
          >
            <span className="text-[0.85rem] font-bold text-white">
              どこから先が、ログインが要るのか
            </span>
            <span className="shrink-0 text-[0.78rem] font-bold" style={{ color: SHOP_ACCENT }}>
              {open ? "閉じる" : "見る"}
            </span>
          </button>

          {open && (
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-[0.78rem] font-bold" style={{ color: TONE.ok.fg }}>
                  ログインなしでご覧いただけます
                </p>
                <ul className="mt-2 space-y-2">
                  {free.map((g) => (
                    <li
                      key={g.key}
                      className="rounded-xl px-3 py-2.5"
                      style={{ background: TONE.ok.bg, border: `1px solid ${TONE.ok.line}` }}
                    >
                      <p className="text-[0.8rem] font-bold" style={{ color: TONE.ok.fg }}>
                        {g.label}
                      </p>
                      <p className="mt-0.5 text-[0.74rem] leading-[1.8] text-white/60">{g.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[0.78rem] font-bold" style={{ color: TONE.danger.fg }}>
                  ログインが必要です
                </p>
                <ul className="mt-2 space-y-2">
                  {locked.map((g) => (
                    <li
                      key={g.key}
                      className="rounded-xl px-3 py-2.5"
                      style={{ background: TONE.danger.bg, border: `1px solid ${TONE.danger.line}` }}
                    >
                      <p className="text-[0.8rem] font-bold" style={{ color: TONE.danger.fg }}>
                        {g.label}
                      </p>
                      <p className="mt-0.5 text-[0.74rem] leading-[1.8] text-white/60">{g.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <p className="mt-8 text-center text-[0.7rem] leading-[1.9] text-white/35">
        これは動作を確かめるためのデモ画面です。DEMO DATA（架空のデータ）で動いています。
        <br />
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
 *
 * ★ただし、全部を開いたまま置かないこと。
 *   小さい端末（375×667）では、この断り書きだけで
 *   最初の1画面のうち110pxを使っていました。
 *   売り場の表紙が1枚も見えないまま、
 *   お客様は「読み込みに失敗した画面」として閉じます。
 *
 *   だから、いちばん大事な一文だけを常に出し、
 *   細かい条件は押したときに開きます。
 *   ★畳んでよいのは「細かい条件」だけです。
 *     「これはデモである」「本物のお金は動かない」の2つは、
 *     畳んだ状態でも必ず読める場所に置きます。
 */
function DemoModeNote() {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="mt-3 rounded-xl px-3.5 py-2.5"
      style={{ background: TONE.warn.bg, border: `1px solid ${TONE.warn.line}` }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 text-left"
      >
        <span
          className="nb shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider"
          style={{ background: TONE.warn.fg, color: "#241A00" }}
        >
          DEMO MODE
        </span>
        <span
          className="min-w-0 flex-1 text-[0.72rem] font-bold leading-[1.7]"
          style={{ color: TONE.warn.fg }}
        >
          架空のデータです。実際の決済・発送は行いません
        </span>
        <span
          className="nb shrink-0 text-[0.68rem] font-bold underline"
          style={{ color: TONE.warn.fg }}
        >
          {open ? "閉じる" : "詳しく"}
        </span>
      </button>

      {open && (
        <p className="mt-2 text-[0.74rem] leading-[1.9]" style={{ color: TONE.warn.fg }}>
          確認用デモでは操作を簡略化しています。本番環境では設定した認証方式が適用されます。
          パスワードは入力しません。実際のメール・SMSも送信しません。
        </p>
      )}
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
    <div
      className="rounded-2xl px-4 py-4"
      style={{ background: TONE.danger.bg, border: `2px solid ${TONE.danger.line}` }}
    >
      <p className="text-[0.9rem] font-bold" style={{ color: TONE.danger.fg }}>
        もう一度、ご本人か確認させてください
      </p>
      <p className="mt-1.5 text-[0.8rem] leading-[1.9]" style={{ color: TONE.danger.fg }}>
        この操作：<strong className="font-bold">{STEP_UP_LABEL[reason]}</strong>
        <br />
        {note}
      </p>
      <p
        className="mt-2 rounded-xl px-3 py-2 text-[0.76rem] leading-[1.85] text-white/70"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        {STEP_UP_WHY[reason]}
      </p>

      <div
        className="mt-3 rounded-xl px-3 py-2.5"
        style={{ background: TONE.warn.bg, border: `1px solid ${TONE.warn.line}` }}
      >
        <p className="text-[0.74rem] leading-[1.85]" style={{ color: TONE.warn.fg }}>
          本番では、ご登録のメールまたはSMSに6桁の数字が届きます。
          このデモでは、次の数字をご入力ください。
        </p>
        <p
          className="num mt-1 text-[1.4rem] font-bold tracking-[0.3em]"
          style={{ color: TONE.warn.fg }}
        >
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
        className="num mt-3 w-full rounded-xl px-3 py-3 text-[1rem] tracking-[0.3em] text-white outline-none placeholder:text-white/25"
        style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${SHOP_EDGE}` }}
      />

      <div className="mt-3 space-y-2">
        <BigBtn
          onClick={() => onOk(code)}
          disabled={code.length !== 6}
          note={code.length !== 6 ? "6桁すべてご入力いただくと押せます" : undefined}
        >
          確認して、この操作を続ける
        </BigBtn>
        <BigBtn tone="quiet" onClick={onCancel}>
          やめる
        </BigBtn>
      </div>
    </div>
  );
}
