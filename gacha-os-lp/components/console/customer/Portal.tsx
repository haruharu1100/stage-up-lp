/**
 * お客様が、自分でログインして開く画面（マイページ）。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、これを作ったのか
 * ═══════════════════════════════════════════════
 *
 *   これまで、お客様側の画面は
 *   管理画面の中の「ユーザー側」という切り替えの中にしかありませんでした。
 *
 *   つまり、お客様はどのURLを開いても
 *   自分のポイントも、当たった商品も見られませんでした。
 *   あれは、運営者が「お客様にはこう見えます」と眺めるための見本です。
 *
 *   見本しか無い状態で「お客様に伝わります」とは言えません。
 *   伝わる場所が、どこにも無いからです。
 *
 *   ですので、お客様がログインして開ける住所を用意します。
 *
 *       /mypage           … 入口（お知らせ・各項目への行き先）
 *       /mypage/prizes    … 獲得商品（発送 or ポイント交換）
 *       /mypage/points    … 保有ポイントと、その履歴
 *       /mypage/shipping  … お届け状況（分割発送・追跡番号）
 *       /mypage/address   … お届け先の変更
 *       /mypage/support   … お問い合わせ
 *
 * ═══════════════════════════════════════════════
 * ★1画面1URLにする理由
 * ═══════════════════════════════════════════════
 *
 *   1つのURLの中でタブを切り替える作りにすると、
 *   お客様は「ポイントの画面」を人に見せられません。
 *   問い合わせのときに「どの画面ですか」が通じません。
 *   ブラウザの戻るを押すと、マイページごと出ます。
 *
 * ═══════════════════════════════════════════════
 * ★読めなかったときに、数字を出さないこと
 * ═══════════════════════════════════════════════
 *
 *   この決まりは、ここに書いたすべての画面に効きます。
 *   通信が切れただけで「0pt」「0件」と出すと、
 *   お客様は、ポイントや商品が消えたと受け取ります。
 *   読めていないときは「—」と、その理由を書きます。
 */

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { OrderList } from "./Account";
import { SHOP_BG, SHOP_EDGE, SHOP_ACCENT, SHOP_SURFACE } from "./Storefront";
import { Back, H, Note, Empty, BigBtn, Panel, Fld, TapRow, TONE } from "./ui";
import {
  useCustomerPrizes,
  useCustomerPoints,
  useCustomerAddress,
  useCustomerSupport,
  useCustomerNotices,
  sendChange,
  liveNum,
  type Live,
  type LivePrize,
  type PrizeState,
} from "@/lib/console/liveMyPage";
import { useCustomerOrders, movingCount } from "@/lib/console/liveOrders";

/* ══════════════════════════════════════════════
   共通の小物
   ══════════════════════════════════════════════ */

/** 日時を、日本語で読める形にする（秒までは要りません） */
function nichiji(v: string | null): string {
  if (!v) return "—";
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 外枠。お客様側は暗い売り場です */
function Shell({ children }: { children: React.ReactNode }) {
  /* ★背景を白のままにしないこと。
       外枠だけ白いと、下までスクロールしたときに白が出てきて、
       読み込みに失敗した画面に見えます */
  return (
    <div className="min-h-[100dvh]" style={{ background: SHOP_BG }}>
      <div className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-6">{children}</div>
    </div>
  );
}

/**
 * 読めていないときの、共通の言い方。
 *
 * ★ここを画面ごとに書かないこと。
 *   画面ごとに書くと、ある画面は「0件」、別の画面は「読めません」に
 *   なります。どちらが本当なのかを、お客様は判断できません。
 */
function Unreadable<T>({ state }: { state: Live<T> }) {
  if (state.phase === "loading") {
    return <Empty>読み込んでいます…</Empty>;
  }
  if (state.phase === "anon") {
    return (
      <Note tone="warn">
        ログインの状態が切れているようです。お手数ですが、もう一度ログインしてください。
      </Note>
    );
  }
  if (state.phase === "ng") {
    /* ★ここで「0件」と書かないこと。
         読めていないだけです。無いこととは違います。 */
    return <Note tone="danger">{state.why}</Note>;
  }
  return null;
}

/**
 * 下の行き先。
 *
 * ★どの画面からでも、他の画面へ行けるようにすること。
 *   毎回マイページの入口まで戻らせると、
 *   ポイントを見てから商品を見るだけで3回押させることになります。
 */
const NAV: { href: string; label: string }[] = [
  { href: "/mypage", label: "ホーム" },
  { href: "/mypage/prizes", label: "獲得商品" },
  { href: "/mypage/points", label: "ポイント" },
  { href: "/mypage/shipping", label: "発送状況" },
  { href: "/mypage/support", label: "問い合わせ" },
];

function Nav({ here }: { here: string }) {
  const router = useRouter();
  return (
    <nav className="mt-10 grid grid-cols-5 gap-1.5">
      {NAV.map((n) => {
        const now = n.href === here;
        return (
          <button
            key={n.href}
            type="button"
            onClick={() => router.push(n.href)}
            className="min-h-[52px] rounded-xl px-1 text-[0.68rem] font-bold leading-tight transition"
            style={{
              background: now ? "rgba(255,255,255,0.09)" : "transparent",
              border: `1px solid ${now ? SHOP_ACCENT : SHOP_EDGE}`,
              color: now ? "#FFFFFF" : "rgba(255,255,255,0.55)",
            }}
          >
            {n.label}
          </button>
        );
      })}
    </nav>
  );
}

/* ══════════════════════════════════════════════
   ① 入口（/mypage）
   ══════════════════════════════════════════════ */

export function PortalHome({ name }: { name: string }) {
  const router = useRouter();
  const prizes = useCustomerPrizes();
  const points = useCustomerPoints();
  const orders = useCustomerOrders();
  const notices = useCustomerNotices();

  /* ★null を 0 に丸めないこと。
       読めていないときは「—」を出すために、null のまま渡します。 */
  const mochi = liveNum(points.state, (d) => d.balance);
  const miSentaku = liveNum(prizes.state, (d) => d.counts.UNCHOSEN);
  const ugoki = movingCount(orders.state);
  const midoku = liveNum(notices.state, (d) => d.unread);

  return (
    <Shell>
      <h1 className="text-[1.15rem] font-bold text-white">マイページ</h1>
      <p className="mt-1 text-[0.8rem] text-white/45">{name} 様</p>

      {/* ═══ お知らせ ═══
          ★発送のお知らせを、いちばん上に出すこと。
            下に置くと読まれず、「発送されていない」という
            問い合わせが、発送済みの荷物について立ちます。 */}
      {notices.state.phase === "ok" && notices.state.data.notices.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[0.9rem] font-bold text-white">お知らせ</h2>
            {midoku !== null && midoku > 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-[0.7rem] font-bold"
                style={{ background: TONE.info.bg, color: TONE.info.fg }}
              >
                未読 {midoku}件
              </span>
            )}
          </div>
          <div className="space-y-2">
            {notices.state.data.notices.slice(0, 3).map((n) => (
              <Panel key={n.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[0.88rem] font-bold text-white">{n.title}</span>
                  <span className="num shrink-0 text-[0.7rem] text-white/40">
                    {nichiji(n.createdAt)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[0.79rem] leading-[1.9] text-white/60">
                  {n.body}
                </p>
              </Panel>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 space-y-2.5">
        <TapRow
          label="保有ポイント"
          note="ガチャのご利用・商品交換の履歴も、こちらでご確認いただけます。"
          value={mochi}
          unit="pt"
          onClick={() => router.push("/mypage/points")}
        />
        <TapRow
          label="獲得商品"
          note="お手続きがお済みでない商品の数です。発送・ポイント交換をお選びいただけます。"
          value={miSentaku}
          unit="件"
          tone={miSentaku !== null && miSentaku > 0 ? "warn" : undefined}
          onClick={() => router.push("/mypage/prizes")}
        />
        <TapRow
          label="発送状況"
          note="お届けの進み方と、追跡番号をご確認いただけます。"
          value={ugoki}
          unit="件"
          onClick={() => router.push("/mypage/shipping")}
        />
      </div>

      <div className="mt-2.5 space-y-2.5">
        <button
          type="button"
          onClick={() => router.push("/mypage/address")}
          className="flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left"
          style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
        >
          <span>
            <span className="block text-[0.88rem] font-bold text-white">お届け先の変更</span>
            <span className="mt-1 block text-[0.74rem] leading-[1.8] text-white/50">
              変更後のご住所は、次回以降の発送依頼に使わせていただきます。
            </span>
          </span>
          <span className="text-white/40">›</span>
        </button>

        <button
          type="button"
          onClick={() => router.push("/mypage/support")}
          className="flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left"
          style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
        >
          <span>
            <span className="block text-[0.88rem] font-bold text-white">お問い合わせ</span>
            <span className="mt-1 block text-[0.74rem] leading-[1.8] text-white/50">
              運営スタッフが内容を確認のうえ、ご連絡いたします。
            </span>
          </span>
          <span className="text-white/40">›</span>
        </button>
      </div>

      {/* 読めていないものがあるなら、黙って隠さずに書きます */}
      {(points.state.phase === "ng" ||
        prizes.state.phase === "ng" ||
        orders.state.phase === "ng") && (
        <div className="mt-4">
          <Note tone="danger">
            一部の情報を読み取れませんでした。上の「—」は、0ではなく、まだ読み取れていないという意味です。
            画面を読み込み直してください。
          </Note>
        </div>
      )}

      <Nav here="/mypage" />
    </Shell>
  );
}

/* ══════════════════════════════════════════════
   ② 獲得商品（/mypage/prizes）
   ══════════════════════════════════════════════ */

/** 5つの状態を、この順番で出します（お手続きが要るものが上） */
const STATE_ORDER: PrizeState[] = [
  "UNCHOSEN",
  "SHIP_REQUESTED",
  "SHIPPING",
  "SHIPPED",
  "EXCHANGED",
];

const STATE_TONE: Record<PrizeState, keyof typeof TONE> = {
  UNCHOSEN: "warn",
  SHIP_REQUESTED: "info",
  SHIPPING: "info",
  SHIPPED: "ok",
  EXCHANGED: "quiet",
};

export function PortalPrizes() {
  const router = useRouter();
  const { state, reload } = useCustomerPrizes();

  /** 選んだ商品。★状態を変える操作なので、押した瞬間には送りません */
  const [erabi, setErabi] = useState<Set<string>>(new Set());
  const [kakunin, setKakunin] = useState<"SHIP" | "EXCHANGE" | null>(null);
  const [okurichu, setOkurichu] = useState(false);
  const [shirase, setShirase] = useState<{ tone: "ok" | "danger"; text: string } | null>(
    null,
  );

  const toggle = useCallback((id: string) => {
    setShirase(null);
    setErabi((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const list = state.phase === "ok" ? state.data.prizes : [];
  const erabareta = list.filter((p) => erabi.has(p.id));

  /* ★「送れるか」を、ここで組み立て直さないこと。
       サーバーが返した canShip / canExchange を、そのまま見ます。 */
  const okShip = erabareta.length > 0 && erabareta.every((p) => p.canShip);
  const okExchange = erabareta.length > 0 && erabareta.every((p) => p.canExchange);
  const goukeiPt = erabareta.reduce((a, p) => a + p.exchangePt, 0);

  async function jikkou(what: "SHIP" | "EXCHANGE") {
    setOkurichu(true);
    setShirase(null);

    const ids = Array.from(erabi);
    const r =
      what === "SHIP"
        ? await sendChange("/api/customer/orders", "POST", { prizeIds: ids })
        : await sendChange("/api/customer/prizes/exchange", "POST", { prizeIds: ids });

    setOkurichu(false);
    setKakunin(null);

    if (!r.ok) {
      setShirase({ tone: "danger", text: r.message });
      /* ★失敗しても、必ず読み直すこと。
           先に他の画面で手続きが済んでいた場合、
           読み直さないと、押せないボタンが出たままになります。 */
      reload();
      return;
    }

    setErabi(new Set());
    setShirase({
      tone: "ok",
      text:
        what === "SHIP"
          ? `${ids.length}点の発送を承りました。ご用意ができ次第、お知らせいたします。`
          : `${ids.length}点をポイントに交換いたしました（+${Number(r.data.gainedPt ?? 0).toLocaleString()}pt）。`,
    });
    reload();
  }

  return (
    <Shell>
      <Back onClick={() => router.push("/mypage")} label="マイページへ戻る" />
      <H sub="お手続きがお済みでない商品は、発送またはポイント交換をお選びいただけます。">
        獲得商品
      </H>

      {state.phase !== "ok" ? (
        <Unreadable state={state} />
      ) : (
        <>
          {shirase && (
            <div className="mb-4">
              <Note tone={shirase.tone === "ok" ? "ok" : "danger"}>{shirase.text}</Note>
            </div>
          )}

          {list.length === 0 ? (
            <Empty>まだ獲得された商品はございません。</Empty>
          ) : (
            <div className="space-y-6">
              {STATE_ORDER.map((st) => {
                const naka = list.filter((p) => p.state === st);
                if (naka.length === 0) return null;
                const t = TONE[STATE_TONE[st]];

                return (
                  <section key={st}>
                    <div className="mb-2 flex items-baseline gap-2">
                      <h3 className="text-[0.92rem] font-bold" style={{ color: t.fg }}>
                        {state.data.labels[st]}
                      </h3>
                      <span className="num text-[0.76rem] text-white/45">
                        {naka.length}件
                      </span>
                    </div>
                    {/* ★状態の意味を、必ず1行で添えること。
                         「発送依頼済み」だけでは、まだ出ていないのか
                         もう出たのかが分かりません */}
                    <p className="mb-2.5 text-[0.74rem] leading-[1.8] text-white/45">
                      {state.data.notes[st]}
                    </p>

                    <div className="space-y-2">
                      {naka.map((p) => (
                        <PrizeRow
                          key={p.id}
                          p={p}
                          chosen={erabi.has(p.id)}
                          onToggle={() => toggle(p.id)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* ═══ 操作 ═══ */}
          {erabareta.length > 0 && (
            <div className="mt-6 space-y-2.5">
              <Panel>
                <p className="text-[0.82rem] font-bold text-white">
                  {erabareta.length}点を選択中
                </p>
                <p className="mt-1 text-[0.75rem] leading-[1.8] text-white/50">
                  ポイントに交換される場合の合計：
                  <span className="num font-bold text-white/80">
                    {goukeiPt.toLocaleString()}pt
                  </span>
                </p>
              </Panel>

              <BigBtn
                onClick={() => setKakunin("SHIP")}
                disabled={!okShip || okurichu}
                note={
                  okShip
                    ? "ご登録のお届け先へお送りします。"
                    : "お手続きがお済みの商品が含まれています。"
                }
              >
                発送を依頼する
              </BigBtn>

              <BigBtn
                tone="second"
                onClick={() => setKakunin("EXCHANGE")}
                disabled={!okExchange || okurichu}
                note={
                  okExchange
                    ? "交換後、商品はお送りできなくなります。"
                    : "お手続きがお済みの商品が含まれています。"
                }
              >
                ポイントに交換する
              </BigBtn>
            </div>
          )}

          {/* ═══ 最終確認 ═══
              ★ポイント交換は取り消せません。
                押した瞬間に実行する作りにしないこと。 */}
          {kakunin && (
            <div className="mt-4">
              <Panel>
                <p className="text-[0.9rem] font-bold text-white">
                  {kakunin === "SHIP"
                    ? "この内容で発送を依頼します"
                    : "この内容でポイントに交換します"}
                </p>
                <ul className="mt-2 space-y-1">
                  {erabareta.map((p) => (
                    <li key={p.id} className="text-[0.79rem] text-white/65">
                      ・{p.name}
                      {kakunin === "EXCHANGE" && (
                        <span className="num text-white/45">
                          {" "}
                          （{p.exchangePt.toLocaleString()}pt）
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="mt-3">
                  <Note tone={kakunin === "EXCHANGE" ? "danger" : "info"}>
                    {kakunin === "EXCHANGE"
                      ? `合計 ${goukeiPt.toLocaleString()}pt を差し上げます。交換されますと、この商品はお送りできなくなります。取り消しはできません。`
                      : "ご登録のお届け先へお送りします。お届け先を変更される場合は、依頼の前にご変更ください。"}
                  </Note>
                </div>

                <div className="mt-3 space-y-2">
                  <BigBtn
                    tone={kakunin === "EXCHANGE" ? "danger" : "primary"}
                    onClick={() => jikkou(kakunin)}
                    disabled={okurichu}
                  >
                    {okurichu
                      ? "送信しています…"
                      : kakunin === "SHIP"
                        ? "はい、発送を依頼します"
                        : "はい、ポイントに交換します"}
                  </BigBtn>
                  <BigBtn tone="quiet" onClick={() => setKakunin(null)} disabled={okurichu}>
                    やめる
                  </BigBtn>
                </div>
              </Panel>
            </div>
          )}
        </>
      )}

      <Nav here="/mypage/prizes" />
    </Shell>
  );
}

/**
 * 商品1件。
 *
 * ★選べない商品を、消さずに出すこと。
 *   一覧から消すと、お客様は「商品が無くなった」と受け取ります。
 *   出したうえで、いまどうなっているのかを書きます。
 */
function PrizeRow({
  p,
  chosen,
  onToggle,
}: {
  p: LivePrize;
  chosen: boolean;
  onToggle: () => void;
}) {
  const erabu = p.canShip || p.canExchange;

  return (
    <button
      type="button"
      onClick={erabu ? onToggle : undefined}
      disabled={!erabu}
      className="flex w-full items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition disabled:cursor-default"
      style={{
        background: chosen ? "rgba(91,140,255,0.12)" : SHOP_SURFACE,
        border: `1px solid ${chosen ? SHOP_ACCENT : SHOP_EDGE}`,
        opacity: erabu ? 1 : 0.72,
      }}
    >
      {erabu && (
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[0.7rem] font-bold"
          style={{
            background: chosen ? SHOP_ACCENT : "transparent",
            border: `1px solid ${chosen ? SHOP_ACCENT : SHOP_EDGE}`,
            color: "#06101F",
          }}
          aria-hidden
        >
          {chosen ? "✓" : ""}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block text-[0.88rem] font-bold text-white">{p.name}</span>
        <span className="mt-0.5 block text-[0.73rem] text-white/40">
          {p.gachaTitle} ／ {nichiji(p.wonAt)}
        </span>

        {/* 追跡できるものは、ここに出します */}
        {p.shipmentNumber && (
          <span className="num mt-1 block text-[0.73rem] text-white/50">
            お荷物番号 {p.shipmentNumber}
            {p.trackingNumber ? ` ／ 追跡番号 ${p.trackingNumber}` : ""}
          </span>
        )}
        {p.orderNumber && !p.shipmentNumber && (
          <span className="num mt-1 block text-[0.73rem] text-white/50">
            ご注文番号 {p.orderNumber}
          </span>
        )}
      </span>

      <span className="num shrink-0 text-right text-[0.73rem] text-white/45">
        {p.exchangePt.toLocaleString()}
        <span className="text-white/30">pt</span>
      </span>
    </button>
  );
}

/* ══════════════════════════════════════════════
   ③ ポイント（/mypage/points）
   ══════════════════════════════════════════════ */

export function PortalPoints() {
  const router = useRouter();
  const { state } = useCustomerPoints();

  return (
    <Shell>
      <Back onClick={() => router.push("/mypage")} label="マイページへ戻る" />
      <H sub="ガチャのご利用・商品交換・付与・返還・調整を、新しい順に並べています。">
        保有ポイント
      </H>

      {state.phase !== "ok" ? (
        <Unreadable state={state} />
      ) : (
        <>
          <Panel>
            <p className="text-[0.78rem] text-white/50">現在の残高</p>
            <p className="num mt-1 text-[2rem] font-bold leading-none text-white">
              {state.data.balance.toLocaleString()}
              <span className="ml-1 text-[0.9rem] text-white/45">pt</span>
            </p>
          </Panel>

          {/* ★合っていないときに、黙って表示だけ揃えないこと。
               表示だけ揃えると、ずれた原因ごと見えなくなります。 */}
          {!state.data.matches && (
            <div className="mt-3">
              <Note tone="danger">
                履歴の合計（{state.data.ledgerSum.toLocaleString()}pt）と残高が一致していません。
                お手数ですが、お問い合わせよりご連絡ください。運営にて確認いたします。
              </Note>
            </div>
          )}

          <h3 className="mb-2 mt-6 text-[0.9rem] font-bold text-white">履歴</h3>

          {state.data.entries.length === 0 ? (
            <Empty>まだ履歴はございません。</Empty>
          ) : (
            <div className="space-y-1.5">
              {state.data.entries.map((e) => (
                <div
                  key={e.id}
                  className="rounded-xl px-4 py-3"
                  style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.84rem] font-bold text-white/90">
                      {e.kindLabel}
                    </span>
                    {/* ★増減は、色だけで表さないこと。
                         必ず符号（＋／−）を文字で書きます。 */}
                    <span
                      className="num shrink-0 text-[0.95rem] font-bold"
                      style={{ color: e.delta >= 0 ? TONE.ok.fg : TONE.warn.fg }}
                    >
                      {e.delta >= 0 ? "+" : "−"}
                      {Math.abs(e.delta).toLocaleString()}pt
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[0.73rem] text-white/45">
                      {e.memo || "—"}
                    </span>
                    <span className="num shrink-0 text-[0.72rem] text-white/40">
                      残高 {e.balanceAfter.toLocaleString()}pt
                    </span>
                  </div>
                  <p className="num mt-0.5 text-[0.7rem] text-white/30">{nichiji(e.at)}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Nav here="/mypage/points" />
    </Shell>
  );
}

/* ══════════════════════════════════════════════
   ④ 発送状況（/mypage/shipping）
   ══════════════════════════════════════════════ */

export function PortalShipping() {
  const router = useRouter();

  return (
    <Shell>
      {/*
        orders（見本のデータ）には、あえて空を渡します。
        ★ここに見本を渡さないこと。
          ログインして開く画面です。読めなかったときに見本が出ると、
          他人の荷物が自分のものとして見えます。
      */}
      <OrderList orders={[]} back={() => router.push("/mypage")} />
      <Nav here="/mypage/shipping" />
    </Shell>
  );
}

/* ══════════════════════════════════════════════
   ⑤ お届け先（/mypage/address）
   ══════════════════════════════════════════════ */

export function PortalAddress() {
  const router = useRouter();
  const { state, reload } = useCustomerAddress();

  const [hen, setHen] = useState(false);
  const [f, setF] = useState({ name: "", zip: "", addr: "", tel: "" });
  const [okurichu, setOkurichu] = useState(false);
  const [shirase, setShirase] = useState<{ tone: "ok" | "danger"; text: string } | null>(
    null,
  );

  function hirakuHenkou() {
    if (state.phase !== "ok") return;
    const a = state.data.address;
    setF({
      name: a?.name ?? "",
      zip: a?.zip ?? "",
      addr: a?.addr ?? "",
      tel: a?.tel ?? "",
    });
    setShirase(null);
    setHen(true);
  }

  async function hozon() {
    setOkurichu(true);
    setShirase(null);
    const r = await sendChange("/api/customer/address", "PUT", f);
    setOkurichu(false);

    if (!r.ok) {
      setShirase({ tone: "danger", text: r.message });
      return;
    }
    setHen(false);
    setShirase({
      tone: "ok",
      text: "お届け先を変更いたしました。次回以降の発送依頼から、こちらのご住所へお送りします。",
    });
    reload();
  }

  return (
    <Shell>
      <Back onClick={() => router.push("/mypage")} label="マイページへ戻る" />
      <H sub="変更後のご住所は、次回以降の発送依頼に使わせていただきます。">お届け先</H>

      {state.phase !== "ok" ? (
        <Unreadable state={state} />
      ) : (
        <>
          {shirase && (
            <div className="mb-4">
              <Note tone={shirase.tone === "ok" ? "ok" : "danger"}>{shirase.text}</Note>
            </div>
          )}

          {!hen ? (
            <>
              <Panel>
                {state.data.address ? (
                  <>
                    <p className="text-[0.9rem] font-bold text-white">
                      {state.data.address.name} 様
                    </p>
                    <p className="num mt-1 text-[0.8rem] text-white/60">
                      〒{state.data.address.zip || "—"}
                    </p>
                    <p className="mt-0.5 text-[0.84rem] leading-[1.9] text-white/75">
                      {state.data.address.addr}
                    </p>
                    <p className="num mt-1 text-[0.8rem] text-white/60">
                      {state.data.address.tel || "—"}
                    </p>
                    {state.data.changedAt && (
                      <p className="num mt-2 text-[0.72rem] text-white/35">
                        最終変更：{nichiji(state.data.changedAt)}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[0.85rem] leading-[1.9] text-white/55">
                    お届け先がまだご登録されていません。
                    発送のご依頼をいただく前に、ご登録をお願いいたします。
                  </p>
                )}
              </Panel>

              {/* ★ここが、この画面でいちばん大事な1行です。
                   すでに出した荷物の宛先は動かない、と先に書きます。
                   書かないと、住所を変えたお客様は
                   「発送中の荷物も新しい住所に届く」と思い込みます。 */}
              {state.data.frozenShipments + state.data.frozenOrders > 0 && (
                <div className="mt-3">
                  <Note tone="warn">
                    すでにご依頼いただいたお荷物
                    {state.data.frozenShipments > 0 &&
                      `（発送手配済み ${state.data.frozenShipments}件）`}
                    {state.data.frozenOrders > 0 &&
                      `（ご依頼済み ${state.data.frozenOrders}件）`}
                    のお届け先は、ご依頼をいただいた時点のご住所のままとなります。
                    こちらを変更されても、そのお荷物の宛先は変わりません。
                  </Note>
                </div>
              )}

              {/* ★まだ本人確認をつないでいないことを、隠さないこと。
                   つないだつもりで運用を始めると、
                   乗っ取りの一番大事な一手が素通りになります。 */}
              {state.data.stepUp.wouldNeed && !state.data.stepUp.need && (
                <div className="mt-3">
                  <Note tone="quiet">{state.data.stepUp.reason}</Note>
                </div>
              )}

              <div className="mt-4">
                <BigBtn onClick={hirakuHenkou}>お届け先を変更する</BigBtn>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <Fld label="お名前" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
                <Fld
                  label="郵便番号"
                  value={f.zip}
                  inputMode="numeric"
                  hint="7桁の数字でご記入ください（例：100-0001）"
                  onChange={(v) => setF({ ...f, zip: v })}
                />
                <Fld
                  label="ご住所"
                  value={f.addr}
                  hint="建物名・部屋番号まで、省略せずにご記入ください"
                  onChange={(v) => setF({ ...f, addr: v })}
                />
                <Fld
                  label="お電話番号"
                  value={f.tel}
                  inputMode="tel"
                  hint="配送会社からのご連絡に使わせていただきます"
                  onChange={(v) => setF({ ...f, tel: v })}
                />
              </div>

              <div className="mt-4">
                <Note tone="info">
                  変更後のご住所は、次回以降の発送依頼から使わせていただきます。
                  すでにご依頼いただいたお荷物の宛先は変わりません。
                </Note>
              </div>

              <div className="mt-4 space-y-2">
                <BigBtn onClick={hozon} disabled={okurichu}>
                  {okurichu ? "保存しています…" : "この内容で保存する"}
                </BigBtn>
                <BigBtn tone="quiet" onClick={() => setHen(false)} disabled={okurichu}>
                  やめる
                </BigBtn>
              </div>
            </>
          )}
        </>
      )}

      <Nav here="/mypage/address" />
    </Shell>
  );
}

/* ══════════════════════════════════════════════
   ⑥ お問い合わせ（/mypage/support）
   ══════════════════════════════════════════════ */

export function PortalSupport() {
  const router = useRouter();
  const { state, reload } = useCustomerSupport();

  const [subject, setSubject] = useState("");
  const [honbun, setHonbun] = useState("");
  const [okurichu, setOkurichu] = useState(false);
  const [shirase, setShirase] = useState<{ tone: "ok" | "danger"; text: string } | null>(
    null,
  );

  async function okuru() {
    setOkurichu(true);
    setShirase(null);
    const r = await sendChange("/api/customer/support", "POST", {
      subject,
      body: honbun,
    });
    setOkurichu(false);

    if (!r.ok) {
      setShirase({ tone: "danger", text: r.message });
      return;
    }
    setSubject("");
    setHonbun("");
    setShirase({
      tone: "ok",
      /* ★「回答しました」と書かないこと。受け付けただけです。
           答えたことにすると、お客様は待つのをやめます。 */
      text: "お問い合わせを承りました。運営スタッフが確認のうえ、ご連絡いたします。",
    });
    reload();
  }

  return (
    <Shell>
      <Back onClick={() => router.push("/mypage")} label="マイページへ戻る" />
      <H sub="運営スタッフが内容を確認のうえ、順次ご連絡いたします。">お問い合わせ</H>

      {shirase && (
        <div className="mb-4">
          <Note tone={shirase.tone === "ok" ? "ok" : "danger"}>{shirase.text}</Note>
        </div>
      )}

      <Panel>
        <div className="space-y-3">
          <Fld
            label="件名（任意）"
            value={subject}
            hint="空欄の場合は、本文の冒頭を件名にいたします"
            onChange={setSubject}
          />
          <label className="block">
            <span className="block text-[0.78rem] font-bold text-white/60">
              お問い合わせ内容
            </span>
            <textarea
              value={honbun}
              onChange={(e) => setHonbun(e.target.value)}
              rows={6}
              className="mt-1.5 w-full rounded-xl px-3 py-3 text-[0.92rem] leading-[1.9] text-white outline-none"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${SHOP_EDGE}`,
              }}
            />
            <span className="mt-1 block text-[0.72rem] leading-[1.75] text-white/40">
              お荷物番号・ご注文番号をお書き添えいただくと、お調べが早く進みます。
            </span>
          </label>
        </div>

        <div className="mt-4">
          <BigBtn onClick={okuru} disabled={okurichu || honbun.trim().length < 4}>
            {okurichu ? "送信しています…" : "この内容で送信する"}
          </BigBtn>
        </div>
      </Panel>

      <h3 className="mb-2 mt-6 text-[0.9rem] font-bold text-white">
        これまでのお問い合わせ
      </h3>

      {state.phase !== "ok" ? (
        <Unreadable state={state} />
      ) : state.data.length === 0 ? (
        <Empty>まだお問い合わせはございません。</Empty>
      ) : (
        <div className="space-y-2">
          {state.data.map((t) => (
            <Panel key={t.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[0.88rem] font-bold text-white">
                  {t.subject}
                </span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-bold"
                  style={{
                    background: t.answer ? TONE.ok.bg : TONE.info.bg,
                    color: t.answer ? TONE.ok.fg : TONE.info.fg,
                  }}
                >
                  {t.statusLabel}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[0.78rem] leading-[1.9] text-white/55">
                {t.body}
              </p>
              <p className="num mt-1 text-[0.7rem] text-white/30">{nichiji(t.createdAt)}</p>

              {t.answer && (
                <div
                  className="mt-3 rounded-xl px-3 py-3"
                  style={{ background: "rgba(255,255,255,0.045)" }}
                >
                  <p className="text-[0.74rem] font-bold text-white/50">運営からの回答</p>
                  <p className="mt-1 whitespace-pre-wrap text-[0.82rem] leading-[1.9] text-white/80">
                    {t.answer}
                  </p>
                  <p className="num mt-1 text-[0.7rem] text-white/30">
                    {nichiji(t.answeredAt)}
                    {t.answeredBy ? ` ／ ${t.answeredBy}` : ""}
                  </p>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}

      <Nav here="/mypage/support" />
    </Shell>
  );
}
