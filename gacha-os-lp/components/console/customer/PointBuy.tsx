/**
 * お客様がポイントを買う画面（/mypage/points/buy）。
 *
 * ═══════════════════════════════════════════════
 * ★この画面は、1ptも足しません
 * ═══════════════════════════════════════════════
 *
 *   お支払いが終わったあと、この画面がすることは
 *
 *       「注文の状態を、サーバーに聞き直す」
 *
 *   これだけです。ポイントを足すのはサーバー側で、
 *   決済会社からの確定通知を受け取ったときだけです。
 *
 *   ★ここに「支払い画面から戻ったら残高に足す」を
 *     書き足さないでください。書き足した瞬間、
 *     ブラウザの戻るを押した回数だけポイントが増えます。
 *     しかも、その増え方は台帳のどこにも残りません。
 *
 * ═══════════════════════════════════════════════
 * ★4つの場面を、はっきり分けて出すこと
 * ═══════════════════════════════════════════════
 *
 *   ① 選ぶ       … 商品が並んでいる
 *   ② 確認       … 「この内容でお支払いに進みます」
 *   ③ 待つ       … 「お支払いを確認しています」
 *   ④ 終わった   … 「反映されました」／理由つきで失敗
 *
 *   ③を出さずに、②から④へ飛ばさないこと。
 *   本番では、決済会社の返事が数秒遅れます。
 *   その数秒に何も出ないと、お客様はもう一度押します。
 *
 * ═══════════════════════════════════════════════
 * ★戻り先（returnTo）を、この画面で組み立てないこと
 * ═══════════════════════════════════════════════
 *
 *   「どこから来たか」はURLの ?from= で受け取りますが、
 *   そのまま移動先には使いません。
 *   注文と一緒にサーバーへ渡し、サーバーが安全と認めた値
 *   （/mypage の中だけ）を返してもらって、それを使います。
 *
 *   画面側で「まあ大丈夫だろう」と判断すると、
 *   外部サイトへ飛ばす細工（Open Redirect）が通ります。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SHOP_BG, SHOP_EDGE, SHOP_ACCENT, SHOP_SURFACE } from "./Storefront";
import { Back, H, Note, Empty, BigBtn, Panel } from "./ui";
import {
  useCustomerPointProducts,
  useCustomerPointOrders,
  useCustomerPoints,
  sendChange,
  type Live,
  type LivePointProduct,
} from "@/lib/console/liveMyPage";

/* ══════════════════════════════════════════════
   共通の小物
   ══════════════════════════════════════════════ */

function nichiji(v: string | null): string {
  if (!v) return "—";
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh]" style={{ background: SHOP_BG }}>
      <div className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-6">{children}</div>
    </div>
  );
}

function Unreadable<T>({ state }: { state: Live<T> }) {
  if (state.phase === "loading") return <Empty>読み込んでいます…</Empty>;
  if (state.phase === "anon")
    return (
      <Note tone="warn">
        ログインの状態が切れているようです。お手数ですが、もう一度ログインしてください。
      </Note>
    );
  if (state.phase === "ng") return <Note tone="danger">{state.why}</Note>;
  return null;
}

const ORDER_LABEL: Record<string, string> = {
  PENDING: "お支払い待ち",
  PAID: "お支払い済み",
  CANCELED: "取り消し",
};

/* ══════════════════════════════════════════════
   画面
   ══════════════════════════════════════════════ */

/** いま、どの場面か */
type Scene =
  | { at: "pick" }
  | { at: "confirm"; p: LivePointProduct }
  | { at: "wait"; orderId: string; totalPoints: number }
  | { at: "done"; addedPoints: number; balance: number; returnTo: string | null }
  | { at: "failed"; why: string };

export function PortalPointBuy() {
  const router = useRouter();
  const sp = useSearchParams();
  /* ★ここで受け取るだけ。移動先としては使いません。
       安全かどうかは、サーバーの safeReturnTo が決めます。 */
  const from = sp.get("from");

  const { state } = useCustomerPointProducts();
  const { state: pointState, reload: reloadPoints } = useCustomerPoints();
  const { state: orderState, reload: reloadOrders } = useCustomerPointOrders();

  const [scene, setScene] = useState<Scene>({ at: "pick" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /* ── ② 確認 → 注文を作る ───────────────── */
  const chumon = useCallback(
    async (p: LivePointProduct) => {
      if (busy) return;
      setBusy(true);
      setErr(null);

      const r = await sendChange("/api/customer/point-orders", "POST", {
        productId: p.id,
        returnTo: from,
      });

      if (!r.ok) {
        setBusy(false);
        setErr(r.message);
        return;
      }

      const orderId = String(r.data.orderId ?? "");
      const totalPoints = Number(r.data.totalPoints ?? 0);
      const provider = String(r.data.provider ?? "");

      if (!orderId) {
        setBusy(false);
        setErr("注文を作成できませんでした。もう一度お試しください。");
        return;
      }

      /* ★本番（決済会社あり）では、ここで決済会社の画面へ移ります。
           まだ接続していないので、その分岐はまだ書けません。
           「書けていない」ことを、はっきり残します。 */
      if (provider !== "mock") {
        setBusy(false);
        setScene({ at: "wait", orderId, totalPoints });
        return;
      }

      /* ── モックのとき：支払ったことにする ──
           ★金額を送らないこと。注文番号だけ送ります。
             金額を送る形にすると、開発者ツールで
             1000 を 1 に書き換えるだけで買えるようになります。 */
      const pay = await sendChange(
        "/api/customer/point-orders/mock-pay",
        "POST",
        { orderId },
      );

      setBusy(false);

      if (!pay.ok) {
        setScene({ at: "failed", why: pay.message });
        return;
      }

      /* 返事は来ましたが、ここで残高を信じ切りません。
         注文の状態を、もう一度サーバーに聞き直します。 */
      setScene({ at: "wait", orderId, totalPoints });
    },
    [busy, from],
  );

  /* ── ③ 待つ：注文の状態を聞き直す ───────── */
  useEffect(() => {
    if (scene.at !== "wait") return;
    let ikiteru = true;
    let kaisu = 0;

    const miru = async () => {
      try {
        const res = await fetch(
          `/api/customer/point-orders/${encodeURIComponent(scene.orderId)}`,
          { cache: "no-store" },
        );
        const raw = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!ikiteru) return;

        const order = raw.order as Record<string, unknown> | undefined;
        const status = String(order?.status ?? "");

        if (status === "PAID") {
          reloadPoints();
          reloadOrders();
          setScene({
            at: "done",
            addedPoints: Number(order?.totalPoints ?? 0),
            balance: Number.NaN,
            returnTo:
              typeof order?.returnTo === "string" ? order.returnTo : null,
          });
          return;
        }
        if (status === "CANCELED") {
          setScene({ at: "failed", why: "この注文は取り消されています。" });
          return;
        }

        kaisu++;
        /* ★永久に回さないこと。
             回し続けると、決済会社が落ちている日に
             お客様の端末が延々と通信します。 */
        if (kaisu > 20) {
          setScene({
            at: "failed",
            why:
              "お支払いの確認に時間がかかっています。ポイントは反映され次第、自動で加算されます。" +
              "しばらくしてから「保有ポイント」をご確認ください。",
          });
          return;
        }
        setTimeout(miru, 1500);
      } catch {
        if (!ikiteru) return;
        setScene({
          at: "failed",
          why: "通信が途中で切れました。二重にならないよう、画面を読み込み直して結果をご確認ください。",
        });
      }
    };

    void miru();
    return () => {
      ikiteru = false;
    };
  }, [scene, reloadPoints, reloadOrders]);

  /* ── 注文の取り消し ───────────────────── */
  const torikeshi = useCallback(
    async (orderId: string) => {
      if (busy) return;
      setBusy(true);
      const r = await sendChange(
        `/api/customer/point-orders/${encodeURIComponent(orderId)}/cancel`,
        "POST",
        {},
      );
      setBusy(false);
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      reloadOrders();
    },
    [busy, reloadOrders],
  );

  const balance =
    pointState.phase === "ok" ? pointState.data.balance : null;

  /* ══════════════════════════════════════════
     ④ 終わった
     ══════════════════════════════════════════ */
  if (scene.at === "done") {
    return (
      <Shell>
        <div data-testid="buy-done" />
        <H sub="ご購入ありがとうございました。">反映されました</H>
        <Panel>
          <p className="text-[0.78rem] text-white/50">加算されたポイント</p>
          <p className="num mt-1 text-[2rem] font-bold leading-none text-white">
            +{scene.addedPoints.toLocaleString()}
            <span className="ml-1 text-[0.9rem] text-white/45">pt</span>
          </p>
          <p className="num mt-3 text-[0.8rem] text-white/55">
            現在の残高 {balance === null ? "—" : balance.toLocaleString()}pt
          </p>
        </Panel>

        <div className="mt-6 space-y-2">
          {/* ★戻り先は、サーバーが安全と認めた値だけを使います */}
          {scene.returnTo && (
            <BigBtn
              testId="buy-return"
              onClick={() => router.push(scene.returnTo as string)}
            >
              元のガチャへ戻る
            </BigBtn>
          )}
          <BigBtn tone="quiet" onClick={() => router.push("/mypage/points")}>
            保有ポイントを見る
          </BigBtn>
        </div>
      </Shell>
    );
  }

  /* ══════════════════════════════════════════
     失敗
     ══════════════════════════════════════════ */
  if (scene.at === "failed") {
    return (
      <Shell>
        <div data-testid="buy-failed" />
        <H>お支払いが確認できませんでした</H>
        <Note tone="danger">{scene.why}</Note>
        <div className="mt-6 space-y-2">
          <BigBtn tone="quiet" onClick={() => setScene({ at: "pick" })}>
            もう一度選ぶ
          </BigBtn>
          <BigBtn tone="quiet" onClick={() => router.push("/mypage/points")}>
            保有ポイントを見る
          </BigBtn>
        </div>
      </Shell>
    );
  }

  /* ══════════════════════════════════════════
     ③ 待つ
     ══════════════════════════════════════════ */
  if (scene.at === "wait") {
    return (
      <Shell>
        <div data-testid="buy-wait" />
        <H sub="この画面を閉じても、反映は続きます。">
          お支払いを確認しています
        </H>
        <Note tone="info">
          少しお待ちください。ポイントは、お支払いの確定が確認できてから加算されます。
          {/* ★ここで「加算しました」と先に書かないこと。
               まだ確定していません。 */}
        </Note>
        <p className="mt-4 text-center text-[0.78rem] text-white/40">
          {scene.totalPoints.toLocaleString()}pt のご購入
        </p>
      </Shell>
    );
  }

  /* ══════════════════════════════════════════
     ② 確認
     ══════════════════════════════════════════ */
  if (scene.at === "confirm") {
    const p = scene.p;
    return (
      <Shell>
        <Back onClick={() => setScene({ at: "pick" })} label="選び直す" />
        <H sub="内容をご確認ください。">お支払いの確認</H>

        <Panel>
          <p className="text-[0.95rem] font-bold text-white">{p.name}</p>
          <div className="mt-3 space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[0.8rem] text-white/50">お支払い金額</span>
              <span className="num text-[1.1rem] font-bold text-white">
                {p.priceYen.toLocaleString()}円
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[0.8rem] text-white/50">付与ポイント</span>
              <span className="num text-[0.95rem] font-bold text-white/85">
                {p.points.toLocaleString()}pt
              </span>
            </div>
            {p.bonusPoints > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-[0.8rem] text-white/50">おまけ</span>
                <span
                  className="num text-[0.95rem] font-bold"
                  style={{ color: SHOP_ACCENT }}
                >
                  +{p.bonusPoints.toLocaleString()}pt
                </span>
              </div>
            )}
            <div
              className="flex items-baseline justify-between pt-2"
              style={{ borderTop: `1px solid ${SHOP_EDGE}` }}
            >
              <span className="text-[0.84rem] font-bold text-white/70">
                受け取る合計
              </span>
              <span className="num text-[1.2rem] font-bold text-white">
                {p.totalPoints.toLocaleString()}pt
              </span>
            </div>
          </div>
        </Panel>

        {err && (
          <div className="mt-3">
            <Note tone="danger">{err}</Note>
          </div>
        )}

        {state.phase === "ok" && state.data.mock && (
          <div className="mt-4">
            {/* ★このお知らせを消さないこと。
                 本物のお金が動くと誤解されたまま操作されるのが、
                 いちばん危ない状態です。 */}
            <Note tone="warn">
              ただいまは、動作確認用のお支払いです。実際の請求は発生しません。
            </Note>
          </div>
        )}

        <div className="mt-6">
          <BigBtn
            testId="buy-pay"
            onClick={() => void chumon(p)}
            disabled={busy}
          >
            {busy
              ? "処理しています…"
              : state.phase === "ok" && state.data.mock
                ? "支払ったことにする（動作確認）"
                : "お支払いに進む"}
          </BigBtn>
        </div>
      </Shell>
    );
  }

  /* ══════════════════════════════════════════
     ① 選ぶ
     ══════════════════════════════════════════ */
  return (
    <Shell>
      <Back onClick={() => router.push("/mypage/points")} label="ポイントへ戻る" />
      <H sub="ご購入いただいたポイントで、ガチャを引けます。">
        ポイントを購入する
      </H>

      <Panel>
        <p className="text-[0.78rem] text-white/50">現在の残高</p>
        <p className="num mt-1 text-[1.6rem] font-bold leading-none text-white">
          {balance === null ? "—" : balance.toLocaleString()}
          <span className="ml-1 text-[0.85rem] text-white/45">pt</span>
        </p>
      </Panel>

      {err && (
        <div className="mt-3">
          <Note tone="danger">{err}</Note>
        </div>
      )}

      <div className="mt-5">
        {state.phase !== "ok" ? (
          <Unreadable state={state} />
        ) : state.data.providerError ? (
          /* ★商品だけ並べて、押したら失敗する画面にしないこと */
          <Note tone="danger">{state.data.providerError}</Note>
        ) : state.data.products.length === 0 ? (
          <Empty>ただいま、ご購入いただけるポイントがございません。</Empty>
        ) : (
          <div className="space-y-2">
            {state.data.products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setErr(null);
                  setScene({ at: "confirm", p });
                }}
                data-testid="buy-product"
                className="w-full rounded-xl px-4 py-4 text-left transition hover:brightness-110"
                style={{
                  background: SHOP_SURFACE,
                  border: `1px solid ${SHOP_EDGE}`,
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[0.9rem] font-bold text-white">
                    {p.name}
                  </span>
                  <span className="num shrink-0 text-[1.05rem] font-bold text-white">
                    {p.priceYen.toLocaleString()}円
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="text-[0.76rem] text-white/45">
                    {p.points.toLocaleString()}pt
                    {p.bonusPoints > 0 && (
                      <span style={{ color: SHOP_ACCENT }}>
                        {" "}
                        + おまけ {p.bonusPoints.toLocaleString()}pt
                      </span>
                    )}
                  </span>
                  <span className="num shrink-0 text-[0.8rem] font-bold text-white/70">
                    合計 {p.totalPoints.toLocaleString()}pt
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── 購入履歴 ─────────────────────── */}
      <h3 className="mb-2 mt-8 text-[0.9rem] font-bold text-white">購入の履歴</h3>
      {orderState.phase !== "ok" ? (
        <Unreadable state={orderState} />
      ) : orderState.data.length === 0 ? (
        <Empty>まだご購入はございません。</Empty>
      ) : (
        <div className="space-y-1.5">
          {orderState.data.map((o) => (
            <div
              key={o.id}
              className="rounded-xl px-4 py-3"
              style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[0.84rem] font-bold text-white/90">
                  {o.productName}
                </span>
                <span className="num shrink-0 text-[0.9rem] font-bold text-white">
                  {o.priceYen.toLocaleString()}円
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="text-[0.73rem] text-white/45">
                  {ORDER_LABEL[o.status] ?? o.status}
                </span>
                <span className="num shrink-0 text-[0.72rem] text-white/40">
                  {o.totalPoints.toLocaleString()}pt
                </span>
              </div>
              <p className="num mt-0.5 text-[0.7rem] text-white/30">
                {nichiji(o.paidAt ?? o.createdAt)}
              </p>

              {/* ★取り消せるのは、お支払い待ちだけです。
                   支払い済みを取り消せる作りにすると、
                   ポイントだけ残して注文が消えます。 */}
              {o.status === "PENDING" && (
                <button
                  type="button"
                  onClick={() => void torikeshi(o.id)}
                  disabled={busy}
                  className="mt-2 min-h-[36px] text-[0.74rem] font-bold text-white/45 underline disabled:opacity-50"
                >
                  この注文を取り消す
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
