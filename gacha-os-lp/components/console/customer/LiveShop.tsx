/**
 * お客様が、実際にガチャを引く画面。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面が無かったせいで、売れませんでした
 * ═══════════════════════════════════════════════════════
 *
 *   2026-09-04 の総点検の結論は「販売できない」でした。
 *   理由はただ1つ、ここです。
 *
 *   引く仕組みも、ポイントの減り方も、当選品の記録も、
 *   発送の手続きも、ぜんぶ動いていました。
 *   お客様がログインして、残高も当選品も見られました。
 *   それでも、引く場所がどこにも無かったので、
 *   お客様は最初の1回すら引けませんでした。
 *
 * ═══════════════════════════════════════════════════════
 * ★見本の売り場（Storefront.tsx の Shop）と混ぜないこと
 * ═══════════════════════════════════════════════════════
 *
 *   あちらは、運営の方に「お客様にはこう見えます」と
 *   お見せするための見本です。中の数字は作り物で、
 *   引いてもDBは1行も動きません。
 *
 *   ここは本物です。押せばポイントが減り、在庫が減ります。
 *   見た目の部品（色・演出）だけを共有し、
 *   データは1つも共有しません。
 *
 * ═══════════════════════════════════════════════════════
 * ★押せてしまう作りにしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   残高が足りない・売り切れ・送信中、のときにボタンを押せると、
 *   お客様はサーバーに断られてから理由を知ることになります。
 *   先に理由を書いて、押せなくします。
 *
 *   ★ただし、押せなくするだけで終わらせないこと。
 *     最後に断るのは必ずサーバーです（lib/server/draw.ts）。
 *     画面の判断は、待たせないための親切であって、守りではありません。
 */

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
/* ★ここで Sample で始まる部品を読まないこと。
     Sample は「描いた絵」です。本物の売り場は、
     お店が登録した写真だけを出します（scripts/check-real-art.mjs が見張ります）。 */
import { GradeChip, PrizeThumb, ShopPhoto } from "./art";
import {
  DrawTheater,
  Pill,
  SHOP_ACCENT,
  SHOP_BG,
  SHOP_EDGE,
  SHOP_GOLD,
  SHOP_SURFACE,
  type TheaterRecord,
} from "./Storefront";
import { Back, BigBtn, Empty, H, Note, Panel } from "./ui";
import { useCustomerPoints } from "@/lib/console/liveMyPage";
import {
  drawOnce,
  newDrawKey,
  useShopDetail,
  useShopList,
  type DrawOutcome,
  type Live,
  type ShopItem,
} from "@/lib/console/liveShop";

/* ══════════════════════════════════════════════
   共通の外枠
   ══════════════════════════════════════════════ */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh]" style={{ background: SHOP_BG }}>
      <div className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-6">{children}</div>
    </div>
  );
}

/**
 * 読めていないときの言い方。
 *
 * ★「販売中のガチャはありません」を、読めなかったときに出さないこと。
 *   通信が切れただけなのに、店が閉まったように見えます。
 */
function Unreadable<T>({ state }: { state: Live<T> }) {
  if (state.phase === "loading") return <Empty>読み込んでいます…</Empty>;
  if (state.phase === "anon") {
    return (
      <Note tone="warn">
        ログインの状態が切れているようです。お手数ですが、もう一度ログインしてください。
      </Note>
    );
  }
  if (state.phase === "ng") return <Note tone="warn">{state.why}</Note>;
  return null;
}

/** 残りの帯 */
function LeftBar({ left, total }: { left: number; total: number }) {
  const soldPct = total > 0 ? Math.round(((total - left) / total) * 100) : 0;
  const low = total > 0 && left / total <= 0.2;
  return (
    <span className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span
          className="num text-[0.74rem] font-bold"
          style={{ color: low ? "#FF9F9F" : "rgba(255,255,255,0.78)" }}
        >
          残り {left.toLocaleString()} 口
        </span>
        <span className="num text-[0.68rem] text-white/40">
          / {total.toLocaleString()} 口
        </span>
      </span>
      <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${soldPct}%`, background: low ? "#E86A6A" : SHOP_ACCENT }}
        />
      </span>
    </span>
  );
}

/* ══════════════════════════════════════════════
   売り場（一覧）
   ══════════════════════════════════════════════ */

export function ShopList() {
  const router = useRouter();
  const { state } = useShopList();
  const points = useCustomerPoints();
  const balance =
    points.state.phase === "ok" ? points.state.data.balance : null;

  return (
    <Shell>
      <Back onClick={() => router.push("/mypage")} label="マイページへ戻る" />
      <H sub="お引きになるガチャをお選びください。">ガチャを引く</H>

      {/* ★残高を、読めていないのに 0pt と書かないこと */}
      <div
        className="mt-4 flex items-baseline justify-between rounded-2xl px-4 py-3"
        style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
      >
        <span className="text-[0.82rem] font-bold text-white/70">保有ポイント</span>
        <span className="num text-[1.1rem] font-bold" style={{ color: SHOP_ACCENT }}>
          {balance === null ? "—" : `${balance.toLocaleString()} pt`}
        </span>
      </div>

      <div className="mt-5">
        {state.phase !== "ok" ? (
          <Unreadable state={state} />
        ) : state.data.length === 0 ? (
          <Empty>
            ただいま販売中のガチャはございません。
            <br />
            新しいガチャが公開されますと、こちらに並びます。
          </Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {state.data.map((g) => (
              <Tile
                key={g.id}
                g={g}
                balance={balance}
                onOpen={() => router.push(`/mypage/shop/${g.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

function Tile({
  g,
  balance,
  onOpen,
}: {
  g: ShopItem;
  balance: number | null;
  onOpen: () => void;
}) {
  const soldOut = g.left <= 0;
  const short = !soldOut && balance !== null && balance < g.price;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full overflow-hidden rounded-2xl text-left transition active:scale-[0.985]"
      style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden">
        <ShopPhoto
          imageId={g.coverImageId}
          alt={g.title}
          className="h-full w-full object-cover"
        />

        {/* 目玉の賞。★売り切れた賞をここに出さないこと（有利誤認になります） */}
        {g.top && (
          <span
            className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1"
            style={{
              background: "rgba(5,9,18,0.72)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <GradeChip grade={g.top.grade} onDark />
            <span className="num nb truncate text-[0.72rem] font-bold text-white/85">
              {g.top.value.toLocaleString()}円相当
            </span>
          </span>
        )}

        <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
          {soldOut && <Pill tone="hot">完売</Pill>}
          {!soldOut && g.sLeft > 0 && <Pill tone="gold">S賞 残り{g.sLeft}</Pill>}
        </span>
      </span>

      <span className="block px-3 pb-3 pt-2.5">
        <span className="block min-h-[2.6rem] text-[0.86rem] font-bold leading-[1.5] text-white">
          {g.title}
        </span>
        <span className="mt-1.5 flex items-baseline gap-1">
          <span className="num text-[1.25rem] font-bold" style={{ color: SHOP_ACCENT }}>
            {g.price.toLocaleString()}
          </span>
          <span className="text-[0.7rem] font-bold text-white/50">pt / 1回</span>
        </span>
        <span className="mt-2 block">
          <LeftBar left={g.left} total={g.total} />
        </span>
        {short && (
          <span className="mt-1.5 block text-[0.7rem] font-bold text-[#FF9F9F]">
            いまの残高では足りません
          </span>
        )}
      </span>
    </button>
  );
}

/* ══════════════════════════════════════════════
   1本の中身と、引く
   ══════════════════════════════════════════════ */

export function ShopDetailScreen({ gachaId }: { gachaId: string }) {
  const router = useRouter();
  const detail = useShopDetail(gachaId);
  const points = useCustomerPoints();

  /* 確認 → 送信中 → 結果、の3つ。
     ★「送信中」を持たないと、二重に押せてしまいます。 */
  const [kakunin, setKakunin] = useState(false);
  const [okuruChu, setOkuruChu] = useState(false);
  const [shippai, setShippai] = useState<string | null>(null);
  const [kekka, setKekka] = useState<DrawOutcome | null>(null);

  const g = detail.state.phase === "ok" ? detail.state.data : null;
  const balance = points.state.phase === "ok" ? points.state.data.balance : null;

  const hiku = useCallback(async () => {
    if (!g || okuruChu) return;
    setOkuruChu(true);
    setShippai(null);

    /* ★鍵は、1回の「引く」につき1つ。
         押すたびに新しくしてよいのは、前の1回が終わってからです。 */
    const ans = await drawOnce(g.id, newDrawKey());

    setOkuruChu(false);
    if (!ans.ok) {
      setShippai(ans.message);
      setKakunin(false);
      return;
    }
    setKakunin(false);
    setKekka(ans.result);

    /* 残高と在庫を、必ず読み直す。
       ★画面側で引き算しないこと。サーバーの値と食い違います。 */
    points.reload();
    detail.reload();
  }, [g, okuruChu, points, detail]);

  const shimeru = useCallback(() => setKekka(null), []);

  if (!g) {
    return (
      <Shell>
        <Back onClick={() => router.push("/mypage/shop")} label="ガチャ一覧へ戻る" />
        <div className="mt-5">
          <Unreadable state={detail.state} />
        </div>
      </Shell>
    );
  }

  const soldOut = g.left <= 0;
  const tarinai = balance !== null && balance < g.price;
  const hikenai = soldOut || tarinai || okuruChu;

  /* 演出に渡す形へ、そのまま移し替える。
     ★ここで金額や等級を作り直さないこと。サーバーの値をそのまま使います。 */
  const engi: TheaterRecord[] = kekka
    ? [
        {
          id: kekka.drawId,
          gachaId: kekka.gachaId,
          grade: kekka.grade,
          prizeName: kekka.prizeName,
          prizeValue: kekka.prizeValue,
          price: kekka.price,
          balanceAfter: kekka.pointAfter,
          /* 当たった賞の写真。★無ければ null のまま渡すこと。
             ここで表紙の写真で代用すると、当たっていない物が
             「当たった物」として大きく出ます */
          imageId: kekka.imageId,
          coverImageId: g.coverImageId,
        },
      ]
    : [];

  return (
    <Shell>
      <Back onClick={() => router.push("/mypage/shop")} label="ガチャ一覧へ戻る" />

      <div
        className="mt-3 overflow-hidden rounded-2xl"
        style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
      >
        <div className="relative aspect-[16/9] w-full">
          <ShopPhoto
            imageId={g.coverImageId}
            alt={g.title}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="px-4 pb-4 pt-3">
          <h1 className="text-[1.05rem] font-bold leading-[1.6] text-white">{g.title}</h1>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="num text-[1.6rem] font-bold" style={{ color: SHOP_ACCENT }}>
              {g.price.toLocaleString()}
            </span>
            <span className="text-[0.78rem] font-bold text-white/50">pt / 1回</span>
          </div>
          <div className="mt-3">
            <LeftBar left={g.left} total={g.total} />
          </div>
        </div>
      </div>

      {/* ── 賞の内訳 ──
          ★還元率という1つの数字にまとめないこと。
            「ぜんぶ引き切ったとき」の数字であって、
            1回引く方の取り分ではありません（景品表示法）。
            残り本数をそのまま出せば、読んだ方が判断できます。 */}
      <div className="mt-5">
        <h2 className="mb-2 text-[0.95rem] font-bold text-white">賞の内訳と残り</h2>
        <Panel>
          <div className="space-y-2.5">
            {g.prizes.map((p) => {
              return (
                <div key={p.grade} className="flex items-center gap-3">
                  <PrizeThumb
                    imageId={p.imageId}
                    grade={p.grade}
                    alt={p.name}
                    className="h-11 w-11 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <GradeChip grade={p.grade} onDark />
                      <span className="truncate text-[0.82rem] font-bold text-white/90">
                        {p.name}
                      </span>
                    </div>
                    <div className="num mt-0.5 text-[0.72rem] text-white/50">
                      {p.value.toLocaleString()}円相当
                    </div>
                  </div>
                  <div className="num shrink-0 text-right text-[0.76rem] font-bold text-white/75">
                    残り {p.left.toLocaleString()}
                    <span className="block text-[0.68rem] font-normal text-white/40">
                      / {p.total.toLocaleString()}本
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* ── 引く ── */}
      <div className="mt-5 space-y-3">
        {shippai && <Note tone="warn">{shippai}</Note>}

        {soldOut && <Note tone="warn">このガチャは完売いたしました。</Note>}

        {!soldOut && tarinai && (
          <>
            <Note tone="warn">
              保有ポイントが不足しています（1回 {g.price.toLocaleString()}pt ／ 保有{" "}
              {balance === null ? "—" : balance.toLocaleString()}pt）。
            </Note>

            {/* ═══════════════════════════════════════════
                ★足りないと伝えるだけで、終わらせないこと
                ═══════════════════════════════════════════

                  「足りません」だけを出す画面は、
                  お客様をその場に立たせたまま帰らせます。
                  足す道を、同じ場所に置きます。

                ★戻り先（from）を必ず渡すこと。
                  渡さないと、購入が終わったお客様は
                  マイページの入口に放り出されます。
                  もう一度このガチャを探し直すことになり、
                  たいていは、そこで終わります。

                ★ここで組み立てた住所を、そのまま移動先に使わないこと。
                  この値はサーバーへ渡すだけです。
                  サーバー（safeReturnTo）が /mypage の中だと
                  認めたものだけが、戻り先として返ってきます。 */}
            <BigBtn
              testId="go-buy-points"
              tone="second"
              onClick={() =>
                router.push(
                  `/mypage/points/buy?from=${encodeURIComponent(`/mypage/shop/${g.id}`)}`,
                )
              }
              note="ご購入後、このガチャへお戻りいただけます。"
            >
              ポイントを購入する
            </BigBtn>
          </>
        )}

        <BigBtn testId="draw-open" onClick={() => setKakunin(true)} disabled={hikenai}>
          {okuruChu ? "引いています…" : `${g.price.toLocaleString()}pt で 1回引く`}
        </BigBtn>

        <p className="text-[0.72rem] leading-[1.9] text-white/45">
          お引きになった時点でポイントを申し受けます。当選された商品は、マイページの「獲得商品」からお手続きいただけます。
        </p>
      </div>

      {/* ── 押す前の確認 ──
          ★いくら減るのかを、押す前に必ず出すこと。
            金額が出ないまま減る買い物は、苦情になります。 */}
      {kakunin && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center"
          style={{ background: "rgba(4,7,14,0.7)" }}
          role="dialog"
          aria-modal="true"
          aria-label="お引きになる前の確認"
        >
          <div
            className="w-full max-w-[560px] rounded-t-2xl px-4 pb-6 pt-5"
            style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
          >
            <h2 className="text-[1rem] font-bold text-white">こちらの内容でお引きしますか</h2>
            <dl className="mt-3 space-y-2 text-[0.85rem]">
              <div className="flex justify-between">
                <dt className="text-white/55">ガチャ</dt>
                <dd className="max-w-[60%] truncate text-right font-bold text-white">
                  {g.title}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/55">お支払い</dt>
                <dd className="num font-bold" style={{ color: SHOP_GOLD }}>
                  {g.price.toLocaleString()} pt
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/55">お引きになった後の残高</dt>
                <dd className="num font-bold text-white">
                  {balance === null ? "—" : `${(balance - g.price).toLocaleString()} pt`}
                </dd>
              </div>
            </dl>

            <div className="mt-5 space-y-2.5">
              <BigBtn testId="draw-go" onClick={hiku} disabled={okuruChu}>
                {okuruChu ? "引いています…" : "引く"}
              </BigBtn>
              <button
                type="button"
                onClick={() => setKakunin(false)}
                disabled={okuruChu}
                className="w-full rounded-xl py-3 text-[0.85rem] font-bold text-white/60 disabled:opacity-40"
              >
                やめる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 結果（演出は、確定した結果を再生するだけ） ──
          ★sampleKind を渡さないこと。渡すと、描いた絵が結果画面に出ます */}
      {kekka && (
        <DrawTheater
          records={engi}
          canAgain={!hikenai}
          onAgain={() => {
            setKekka(null);
            setKakunin(true);
          }}
          onPrizes={() => router.push("/mypage/prizes")}
          onClose={shimeru}
        />
      )}
    </Shell>
  );
}
