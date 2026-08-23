/**
 * お客様の売り場（ホーム・ガチャ詳細・演出・結果）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここは「デモだから簡素でよい」を捨てた場所です
 * ═══════════════════════════════════════════════════════
 *
 *   以前ここは、白い箱に題名と価格が並ぶだけの一覧でした。
 *   動きはします。数字も合っています。それでも、
 *   このまま実際のお客様に出せるかと問われたら、出せません。
 *   買う理由が、画面のどこにも書かれていないからです。
 *
 *   売り場に要るのは、次の3つです。
 *
 *     ①何が当たるのかが、見て分かること（絵があること）
 *     ②いま引くと得なのか、待つべきなのかが分かること（残り・新着・人気）
 *     ③押す前に、いくら減って何回引くのかが分かること（購入前確認）
 *
 * ═══════════════════════════════════════════════════════
 * ★スマホを最優先にすること
 * ═══════════════════════════════════════════════════════
 *
 *   オンラインでガチャを引く方は、ほぼスマホです。
 *   だから幅は 390px を基準に組み、375px でも崩れないことを条件にします。
 *   広い画面は「余白が増えるだけ」で構いません。逆はできません。
 *
 * ═══════════════════════════════════════════════════════
 * ★演出の中で、結果を決めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   当選は引いた瞬間に運営側（reducer）で確定しています。
 *   ここでやっているのは、確定した結果を再生することだけです。
 *   だから SKIP を押しても、結果は1文字も変わりません。
 *   演出の中で乱数を回す作りにすると、
 *   「演出を止めれば引き直せる」が成立してしまいます。
 *
 * ★演出を、飛ばせないようにしないこと。
 *   100連を引く方は、演出を100回見たいわけではありません。
 *   SKIP と「軽い演出」の両方を、最初から用意します。
 */

"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConsoleGacha } from "@/lib/console/state";
import type { DrawRecord } from "@/lib/console/draw";
import {
  CoverArt,
  GradeChip,
  ProductArt,
  artKindOf,
  gradeArt,
  type ArtKind,
} from "./art";
import {
  BULK_OPTIONS,
  SHELVES,
  featured,
  lastOneOf,
  maxDraws,
  shelf,
  tiersOf,
  type Card as ShopCard,
  type ShelfKey,
} from "./catalog";

/* ══════════════════════════════════════════════
   売り場の色
   ══════════════════════════════════════════════

   ★管理サイトと同じ白い画面にしないこと。
     運営が1日中見る画面は、目が疲れない白がいい。
     お客様が数分だけ見る売り場は、商品が浮き立つ濃い色がいい。
     用途が違うので、同じ色にする理由はありません。 */

export const SHOP_BG = "#070C16";
export const SHOP_SURFACE = "#111B2E";
export const SHOP_EDGE = "#22314F";
export const SHOP_ACCENT = "#5B8CFF";
export const SHOP_GOLD = "#E7C25C";

/* ══════════════════════════════════════════════
   小さな部品
   ══════════════════════════════════════════════ */

export function Pill({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "hot" | "new" | "gold";
}) {
  const style =
    tone === "hot"
      ? { color: "#FFC9C9", background: "rgba(220,60,60,0.18)", border: "1px solid rgba(240,120,120,0.45)" }
      : tone === "new"
        ? { color: "#B7F0D2", background: "rgba(40,180,110,0.16)", border: "1px solid rgba(90,210,150,0.45)" }
        : tone === "gold"
          ? { color: SHOP_GOLD, background: "rgba(231,194,92,0.14)", border: `1px solid ${SHOP_GOLD}55` }
          : { color: "rgba(255,255,255,0.72)", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)" };

  return (
    <span
      className="nb inline-flex items-center rounded-md px-2 py-0.5 text-[0.68rem] font-bold leading-[1.5]"
      style={style}
    >
      {children}
    </span>
  );
}

/**
 * 残りの帯。
 *
 * ★「残り○%」ではなく「残り○口」を主役にすること。
 *   %は、全体が何口なのかを知らないと意味が取れません。
 *   引く方が知りたいのは「あと何回ぶん残っているか」です。
 */
function LeftBar({ left, total }: { left: number; total: number }) {
  const soldPct = total > 0 ? Math.round(((total - left) / total) * 100) : 0;
  const low = total > 0 && left / total <= 0.2;
  return (
    <span className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="num text-[0.74rem] font-bold" style={{ color: low ? "#FF9F9F" : "rgba(255,255,255,0.78)" }}>
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
   ガチャカード（棚に並ぶ1枚）
   ══════════════════════════════════════════════ */

/**
 * ★文字だけのカードを作らないこと。
 *   絵のない棚は、値札だけが並んだ棚です。
 *   何が当たるのかが見えないと、買うかどうかを決められません。
 */
export function GachaCard({
  c,
  balance,
  onOpen,
}: {
  c: ShopCard;
  balance: number | null;
  onOpen: () => void;
}) {
  const short = balance !== null && balance < c.g.price;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full overflow-hidden rounded-2xl text-left transition active:scale-[0.985]"
      style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden">
        <CoverArt id={c.g.id} kind={c.kind} className="h-full w-full" />

        {/* 目玉の賞。ここが空のカードは「何が当たるか分からないカード」になる */}
        {c.top && (
          <span
            className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1"
            style={{ background: "rgba(5,9,18,0.72)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            <GradeChip grade={c.top.grade} onDark />
            <span className="num nb truncate text-[0.72rem] font-bold text-white/85">
              {c.top.value.toLocaleString()}円相当
            </span>
          </span>
        )}

        <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
          {c.fresh && <Pill tone="new">新着</Pill>}
          {c.ending && <Pill tone="hot">残りわずか</Pill>}
          {c.sLeft > 0 && <Pill tone="gold">S賞 残り{c.sLeft}</Pill>}
        </span>
      </span>

      <span className="block px-3 pb-3 pt-2.5">
        <span className="block min-h-[2.6rem] text-[0.86rem] font-bold leading-[1.5] text-white">
          {c.g.title}
        </span>
        <span className="mt-1.5 flex items-baseline gap-1">
          <span className="num text-[1.25rem] font-bold" style={{ color: SHOP_ACCENT }}>
            {c.g.price.toLocaleString()}
          </span>
          <span className="text-[0.7rem] font-bold text-white/50">pt / 1回</span>
        </span>
        <span className="mt-2 block">
          <LeftBar left={c.left} total={c.g.total} />
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
   ホーム
   ══════════════════════════════════════════════ */

/**
 * 売り場のトップ。
 *
 * ★いちばん上に「おすすめ」を置き、なぜおすすめなのかを書くこと。
 *   理由の無いおすすめは、ただの広告枠です。
 *   「残り3口」「公開したばかり」なら、読んだ方が自分で判断できます。
 */
export function Shop({
  gachas,
  balance,
  onOpen,
}: {
  gachas: ConsoleGacha[];
  /** ログインしていなければ null（残高は出しません） */
  balance: number | null;
  onOpen: (id: string) => void;
}) {
  const [tab, setTab] = useState<ShelfKey>("all");
  const picks = useMemo(() => featured(gachas), [gachas]);
  const list = useMemo(() => shelf(gachas, tab), [gachas, tab]);
  const note = SHELVES.find((x) => x.key === tab)?.note ?? "";

  const live = gachas.filter((g) => g.status === "PUBLISHED" && g.left > 0);

  if (live.length === 0) {
    return (
      <div
        className="rounded-2xl px-4 py-8 text-center text-[0.88rem] leading-[1.9] text-white/60"
        style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
      >
        いま販売中のガチャはありません。
        <br />
        新しいガチャが公開されると、ここに並びます。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── おすすめ ── */}
      {picks.length > 0 && (
        <section aria-labelledby="pick-h">
          <h2 id="pick-h" className="mb-2 text-[0.95rem] font-bold text-white">
            おすすめ
          </h2>
          {/* ★横に流す棚は、指で送れること。
              矢印ボタンだけの作りは、スマホでいちばん押しにくい */}
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
            {picks.map(({ card, why }) => (
              <button
                key={card.g.id}
                type="button"
                onClick={() => onOpen(card.g.id)}
                className="relative w-[78%] max-w-[300px] shrink-0 snap-start overflow-hidden rounded-2xl text-left transition active:scale-[0.99]"
                style={{ border: `1px solid ${SHOP_EDGE}`, background: SHOP_SURFACE }}
              >
                <span className="relative block aspect-[16/9] w-full">
                  <CoverArt id={card.g.id} kind={card.kind} className="h-full w-full" />
                  <span
                    className="absolute inset-x-0 bottom-0 block px-3 pb-2.5 pt-8"
                    style={{ background: "linear-gradient(to top, rgba(5,9,18,0.92), rgba(5,9,18,0))" }}
                  >
                    <span className="block truncate text-[0.92rem] font-bold text-white">
                      {card.g.title}
                    </span>
                    <span className="num mt-0.5 block text-[0.74rem] font-bold text-white/70">
                      {card.g.price.toLocaleString()}pt / 1回
                    </span>
                  </span>
                </span>
                <span className="block px-3 py-2 text-[0.74rem] font-bold" style={{ color: SHOP_GOLD }}>
                  {why}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── 棚の切り替え ── */}
      <section aria-labelledby="shelf-h">
        <h2 id="shelf-h" className="mb-2 text-[0.95rem] font-bold text-white">
          ガチャを探す
        </h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
          {SHELVES.map((sh) => {
            const on = sh.key === tab;
            return (
              <button
                key={sh.key}
                type="button"
                onClick={() => setTab(sh.key)}
                aria-pressed={on}
                className="nb shrink-0 rounded-full px-3.5 py-2 text-[0.8rem] font-bold transition"
                style={
                  on
                    ? { background: SHOP_ACCENT, color: "#06101F" }
                    : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", border: `1px solid ${SHOP_EDGE}` }
                }
              >
                {sh.label}
              </button>
            );
          })}
        </div>
        {note && <p className="mb-3 text-[0.74rem] leading-[1.8] text-white/45">{note}</p>}

        {list.length === 0 ? (
          <p
            className="rounded-2xl px-4 py-6 text-center text-[0.84rem] leading-[1.9] text-white/55"
            style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
          >
            この条件に当てはまるガチャは、いまありません。
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {list.map((c) => (
              <GachaCard key={c.g.id} c={c} balance={balance} onOpen={() => onOpen(c.g.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ガチャ詳細
   ══════════════════════════════════════════════ */

/**
 * ガチャの中身と、引くところ。
 *
 * ★何が何本入っていて、あと何本残っているかを、必ず出すこと。
 *   「S賞あり」とだけ書かれた箱は、もう出たあとかもしれません。
 *   残り本数まで見せて、はじめて引くかどうかを決められます。
 *
 * ★設計還元率・粗利・仕入れ値は出さないこと。
 *   これは運営の数字です。出すと、条件のよい時期を狙って引かれ、
 *   その後に引く方が必ず損をします。
 */
export function GachaDetail({
  g,
  balance,
  loggedIn,
  onDraw,
  onLogin,
  back,
}: {
  g: ConsoleGacha;
  balance: number | null;
  loggedIn: boolean;
  /** n回引く */
  onDraw: (n: number) => void;
  onLogin: () => void;
  back: () => void;
}) {
  const kind = artKindOf(g.title);
  const tiers = useMemo(() => tiersOf(g), [g]);
  const lastOne = useMemo(() => lastOneOf(g), [g]);
  const [ask, setAsk] = useState<number | null>(null);

  const can = balance === null ? 0 : maxDraws(g.price, balance, g.left);
  const soldOut = g.left <= 0;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={back}
        className="nb -ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[0.82rem] font-bold text-white/65 hover:text-white"
      >
        <span aria-hidden>‹</span> ガチャ一覧へ
      </button>

      {/* ── 表紙 ── */}
      <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${SHOP_EDGE}` }}>
        <div className="relative aspect-[16/10] w-full">
          <CoverArt id={g.id} kind={kind} className="h-full w-full" />
          <div
            className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-10"
            style={{ background: "linear-gradient(to top, rgba(4,8,16,0.94), rgba(4,8,16,0))" }}
          >
            <h1 className="text-[1.15rem] font-bold leading-[1.55] text-white">{g.title}</h1>
          </div>
        </div>

        <div className="space-y-3 px-4 py-4" style={{ background: SHOP_SURFACE }}>
          <div className="flex items-end justify-between gap-3">
            <p className="flex items-baseline gap-1">
              <span className="num text-[1.75rem] font-bold leading-none" style={{ color: SHOP_ACCENT }}>
                {g.price.toLocaleString()}
              </span>
              <span className="text-[0.78rem] font-bold text-white/55">pt / 1回</span>
            </p>
            {balance !== null && (
              <p className="text-right">
                <span className="block text-[0.66rem] text-white/45">保有ポイント</span>
                <span className="num block text-[1.05rem] font-bold text-white">
                  {balance.toLocaleString()}
                  <span className="ml-0.5 text-[0.68rem] font-bold text-white/55">pt</span>
                </span>
              </p>
            )}
          </div>
          <LeftBar left={g.left} total={g.total} />
        </div>
      </div>

      {/* ── 賞の一覧 ── */}
      <section aria-labelledby="tiers-h">
        <h2 id="tiers-h" className="mb-1 text-[0.95rem] font-bold text-white">
          この箱に入っているもの
        </h2>
        <p className="mb-3 text-[0.74rem] leading-[1.8] text-white/45">
          残り本数は、実際に出た分をそのまま引いた数です。
          出尽くした賞は、二度と出ません。
        </p>

        <ul className="space-y-2">
          {tiers.map((t) => {
            const a = gradeArt(t.grade);
            const gone = t.left <= 0;
            return (
              <li
                key={t.grade}
                className="flex items-center gap-3 overflow-hidden rounded-2xl p-2.5"
                style={{
                  background: SHOP_SURFACE,
                  border: `1px solid ${gone ? SHOP_EDGE : `${a.line}55`}`,
                  opacity: gone ? 0.5 : 1,
                }}
              >
                <span
                  className="block h-16 w-16 shrink-0 overflow-hidden rounded-xl"
                  style={{ border: `1px solid ${a.line}66` }}
                >
                  <ProductArt grade={t.grade} kind={kind} className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <GradeChip grade={t.grade} onDark />
                    {t.physical ? (
                      <Pill>現物をお届け</Pill>
                    ) : (
                      <Pill>ポイントでお返し</Pill>
                    )}
                  </span>
                  <span className="num mt-1 block text-[0.95rem] font-bold text-white">
                    {t.value.toLocaleString()}
                    <span className="ml-0.5 text-[0.7rem] font-bold text-white/55">
                      {t.physical ? "円相当" : "pt"}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="num block text-[1.05rem] font-bold" style={{ color: gone ? "#FF9F9F" : "#FFFFFF" }}>
                    {t.left.toLocaleString()}
                  </span>
                  <span className="num block text-[0.66rem] text-white/40">
                    / {t.count.toLocaleString()}本
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {/* ── ラストワン ── */}
        {lastOne && (
          <div
            className="mt-3 flex items-start gap-3 rounded-2xl p-3"
            style={{ background: "rgba(231,194,92,0.08)", border: `1px solid ${SHOP_GOLD}55` }}
          >
            <span
              className="block h-14 w-14 shrink-0 overflow-hidden rounded-xl"
              style={{ border: `1px solid ${SHOP_GOLD}77` }}
            >
              <ProductArt grade={lastOne.grade} kind={kind} className="h-full w-full" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="nb block text-[0.85rem] font-bold" style={{ color: SHOP_GOLD }}>
                ラストワン賞
              </span>
              <span className="mt-1 block text-[0.74rem] leading-[1.8] text-white/60">
                最後の1口を引いた方には、
                {lastOne.grade}賞（{lastOne.value.toLocaleString()}円相当）を取り置いてお渡しします。
                <br />
                ★賞を1本増やしているのではなく、上の{lastOne.grade}賞のうち1本を、
                最後の1口のために取り置いています。
              </span>
            </span>
          </div>
        )}
      </section>

      {/* ── 引く ── */}
      <section aria-labelledby="draw-h">
        <h2 id="draw-h" className="mb-2 text-[0.95rem] font-bold text-white">
          引く
        </h2>

        {soldOut ? (
          <p
            className="rounded-2xl px-4 py-4 text-center text-[0.85rem] font-bold text-white/60"
            style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
          >
            このガチャは完売しました。
          </p>
        ) : !loggedIn ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={onLogin}
              className="w-full rounded-2xl px-4 py-4 text-[1rem] font-bold"
              style={{ background: SHOP_ACCENT, color: "#06101F" }}
            >
              ログインして引く
            </button>
            <p className="text-[0.74rem] leading-[1.8] text-white/45">
              中身と残り本数は、ログインなしでご覧いただけます。
              引くにはログインが必要です。ポイントが減るので、
              どなたの残高から引くのかが決まっている必要があるためです。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              {BULK_OPTIONS.map((n) => {
                const ok = can >= n;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={!ok}
                    onClick={() => setAsk(n)}
                    className="rounded-2xl px-2 py-3.5 text-center transition disabled:cursor-not-allowed disabled:opacity-35"
                    style={
                      n === 1
                        ? { background: "rgba(255,255,255,0.07)", border: `1px solid ${SHOP_EDGE}`, color: "#FFFFFF" }
                        : { background: SHOP_ACCENT, color: "#06101F" }
                    }
                  >
                    <span className="num block text-[1.15rem] font-bold leading-none">
                      {n === 1 ? "1回" : `${n}連`}
                    </span>
                    <span className="num mt-1 block text-[0.68rem] font-bold opacity-70">
                      {(g.price * n).toLocaleString()}pt
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ★押せない理由を、押す前に書くこと。
                押してから「引けません」と返す作りは、
                10連のつもりが3回だけ引かれた、を生みます */}
            {can === 0 ? (
              <p className="text-[0.76rem] font-bold text-[#FF9F9F]">
                残高が {g.price.toLocaleString()}pt に足りないため、いまは引けません。
              </p>
            ) : can < 100 ? (
              <p className="text-[0.74rem] leading-[1.8] text-white/45">
                いまの残高と残り口数では、最大 {can.toLocaleString()} 回まで引けます。
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* ── 購入前の確認 ── */}
      {ask !== null && (
        <BuySheet
          g={g}
          n={ask}
          balance={balance ?? 0}
          onCancel={() => setAsk(null)}
          onOk={() => {
            const n = ask;
            setAsk(null);
            onDraw(n);
          }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   購入前の確認
   ══════════════════════════════════════════════ */

/**
 * 押す前に、いくら減って何回引くのかを見せる。
 *
 * ★「本当によろしいですか？」だけの確認にしないこと。
 *   何が起きるのかが書いていない確認は、読まずに押されます。
 *   減る額・引く回数・引いた後の残高を、数字で出します。
 */
function BuySheet({
  g,
  n,
  balance,
  onOk,
  onCancel,
}: {
  g: ConsoleGacha;
  n: number;
  balance: number;
  onOk: () => void;
  onCancel: () => void;
}) {
  const cost = g.price * n;
  const after = balance - cost;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onCancel}
        className="absolute inset-0 bg-black/70"
      />
      <div
        className="relative w-full max-w-[560px] rounded-t-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4"
        style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
      >
        <p className="mb-3 text-[1rem] font-bold text-white">引く前の確認</p>

        <dl className="space-y-2 rounded-2xl px-3.5 py-3" style={{ background: "rgba(255,255,255,0.04)" }}>
          <Line k="ガチャ" v={g.title} />
          <Line k="回数" v={`${n.toLocaleString()} 回`} />
          <Line k="使うポイント" v={`${cost.toLocaleString()} pt`} strong />
          <Line k="いまの残高" v={`${balance.toLocaleString()} pt`} />
          <Line k="引いた後の残高" v={`${after.toLocaleString()} pt`} strong />
        </dl>

        <p className="mt-3 text-[0.74rem] leading-[1.85] text-white/50">
          当たった現物の賞は「獲得商品」に入ります。
          発送するか、ポイントに換えるかは、後からお選びいただけます。
          <br />
          ★これはデモです。実際の決済・発送・メール送信は行いません。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl px-4 py-3.5 text-[0.95rem] font-bold text-white/75"
            style={{ background: "rgba(255,255,255,0.07)", border: `1px solid ${SHOP_EDGE}` }}
          >
            やめる
          </button>
          <button
            type="button"
            onClick={onOk}
            className="rounded-2xl px-4 py-3.5 text-[0.95rem] font-bold"
            style={{ background: SHOP_ACCENT, color: "#06101F" }}
          >
            {n === 1 ? "引く" : `${n}連を引く`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Line({ k, v, strong = false }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="nb shrink-0 text-[0.78rem] text-white/50">{k}</dt>
      <dd
        className={`num min-w-0 flex-1 text-right ${
          strong ? "text-[1rem] font-bold text-white" : "text-[0.85rem] text-white/80"
        }`}
      >
        {v}
      </dd>
    </div>
  );
}

/* ══════════════════════════════════════════════
   演出 と 当選結果
   ══════════════════════════════════════════════ */

const GRADE_RANK: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1, "-": 0 };

const LITE_KEY = "gachaos.lite";

/**
 * 演出と結果。
 *
 * ★結果は、この画面に渡ってきた時点でもう決まっています。
 *   ここは再生装置です。乱数は1つも回していません。
 *
 * ★SKIP を必ず出すこと。
 *   100連を引く方は、演出を100回見たいわけではありません。
 *
 * ★「軽い演出」を覚えておくこと。
 *   毎回オフにし直させるのは、設定を用意していないのと同じです。
 */
export function DrawTheater({
  records,
  kind,
  onAgain,
  onPrizes,
  onClose,
  canAgain,
}: {
  records: DrawRecord[];
  kind: ArtKind;
  onAgain: () => void;
  onPrizes: () => void;
  onClose: () => void;
  canAgain: boolean;
}) {
  const [lite, setLite] = useState(false);
  const [phase, setPhase] = useState<"shake" | "burst" | "result">("shake");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /* 覚えてある設定を読む（読めない環境でも落ちないこと） */
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LITE_KEY) === "1") {
        setLite(true);
        setPhase("result");
      }
    } catch {
      /* localStorage が使えない環境。演出は通常のまま */
    }
  }, []);

  useEffect(() => {
    if (lite) {
      setPhase("result");
      return;
    }
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => setPhase("burst"), 1100),
      setTimeout(() => setPhase("result"), 1750),
    ];
    return () => timers.current.forEach(clearTimeout);
  }, [lite]);

  const best = useMemo(
    () =>
      records.reduce<DrawRecord | null>(
        (a, b) => (a === null || (GRADE_RANK[b.grade] ?? 0) > (GRADE_RANK[a.grade] ?? 0) ? b : a),
        null,
      ),
    [records],
  );

  const spent = records.reduce((a, r) => a + r.price, 0);
  const gained = records.reduce((a, r) => a + r.prizeValue, 0);
  const lastOne = records.some((r) => r.prizeName.includes("ラストワン"));

  const skip = () => {
    timers.current.forEach(clearTimeout);
    setPhase("result");
  };

  const toggleLite = () => {
    const next = !lite;
    setLite(next);
    try {
      window.localStorage.setItem(LITE_KEY, next ? "1" : "0");
    } catch {
      /* 覚えられない環境。その場だけ効きます */
    }
  };

  if (records.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[70] overflow-y-auto"
      style={{ background: "rgba(4,7,14,0.97)" }}
      role="dialog"
      aria-modal="true"
      aria-label="ガチャの結果"
    >
      {/* ── 演出中 ── */}
      {phase !== "result" && (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6">
          <div className="relative flex h-56 w-56 items-center justify-center">
            <div
              className="absolute inset-0 animate-rayspin rounded-full"
              style={{
                background: `conic-gradient(from 0deg, ${SHOP_ACCENT}00, ${SHOP_ACCENT}55, ${SHOP_ACCENT}00, ${SHOP_GOLD}44, ${SHOP_ACCENT}00)`,
              }}
              aria-hidden
            />
            {phase === "burst" && (
              <div
                className="absolute inset-0 animate-burst rounded-full"
                style={{ background: `radial-gradient(circle, ${SHOP_GOLD}cc, ${SHOP_GOLD}00 70%)` }}
                aria-hidden
              />
            )}
            <div className={phase === "shake" ? "animate-shakebox" : ""}>
              <div
                className="h-28 w-28 overflow-hidden rounded-2xl"
                style={{ border: `2px solid ${SHOP_GOLD}`, boxShadow: `0 0 40px ${SHOP_ACCENT}66` }}
              >
                <CoverArt id={records[0].gachaId} kind={kind} className="h-full w-full" />
              </div>
            </div>
          </div>

          <p className="mt-8 text-[0.9rem] font-bold text-white/70" aria-live="polite">
            {records.length === 1 ? "引いています…" : `${records.length}連を引いています…`}
          </p>

          <button
            type="button"
            onClick={skip}
            className="mt-6 rounded-full px-6 py-2.5 text-[0.85rem] font-bold text-white/80"
            style={{ border: "1px solid rgba(255,255,255,0.25)" }}
          >
            演出をとばす
          </button>
          <p className="mt-3 max-w-[22rem] text-center text-[0.7rem] leading-[1.8] text-white/35">
            結果は引いた時点でもう決まっています。
            とばしても、内容は変わりません。
          </p>
        </div>
      )}

      {/* ── 結果 ── */}
      {phase === "result" && (
        <div className="mx-auto w-full max-w-[560px] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6">
          <p className="text-center text-[0.78rem] font-bold tracking-[0.2em] text-white/45">
            RESULT
          </p>
          <h2 className="mt-1 text-center text-[1.25rem] font-bold text-white">
            {records.length === 1 ? "結果" : `${records.length}連の結果`}
          </h2>

          {lastOne && (
            <p
              className="mx-auto mt-3 w-fit rounded-full px-4 py-1.5 text-[0.8rem] font-bold"
              style={{ background: "rgba(231,194,92,0.16)", color: SHOP_GOLD, border: `1px solid ${SHOP_GOLD}77` }}
            >
              ラストワン賞が出ました
            </p>
          )}

          {/* いちばん良かった1本を、大きく出す */}
          {best && (
            <div className="mt-4 animate-revealIn">
              <div
                className="overflow-hidden rounded-3xl"
                style={{ border: `2px solid ${gradeArt(best.grade).line}`, background: SHOP_SURFACE }}
              >
                <div className="aspect-[16/10] w-full">
                  <ProductArt grade={best.grade} kind={kind} className="h-full w-full" />
                </div>
                <div className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <GradeChip grade={best.grade} onDark />
                    <p className="min-w-0 flex-1 truncate text-[0.9rem] font-bold text-white">
                      {best.prizeName}
                    </p>
                  </div>
                  <p className="num mt-1.5 text-[1.35rem] font-bold" style={{ color: gradeArt(best.grade).chip }}>
                    {best.prizeValue > 0
                      ? `${best.prizeValue.toLocaleString()}円相当`
                      : "参加ポイント"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 10連・100連は、全部を一覧で */}
          {records.length > 1 && (
            <div className="mt-4">
              <p className="mb-2 text-[0.85rem] font-bold text-white">出たもの（{records.length}件）</p>
              <div className="grid grid-cols-5 gap-1.5">
                {records.map((r) => {
                  const a = gradeArt(r.grade);
                  return (
                    <div
                      key={r.id}
                      title={`${a.label}：${r.prizeName}`}
                      className="overflow-hidden rounded-lg"
                      style={{ border: `1px solid ${a.line}66` }}
                    >
                      <div className="aspect-square w-full">
                        <ProductArt grade={r.grade} kind={kind} className="h-full w-full" />
                      </div>
                      <p
                        className="nb py-0.5 text-center text-[0.62rem] font-bold"
                        style={{ background: "rgba(0,0,0,0.35)", color: a.chip }}
                      >
                        {r.grade === "-" ? "pt" : r.grade}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 使った額と、当たった額 */}
          <dl
            className="mt-4 space-y-2 rounded-2xl px-4 py-3.5"
            style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${SHOP_EDGE}` }}
          >
            <Line k="使ったポイント" v={`${spent.toLocaleString()} pt`} />
            <Line k="当たった賞の合計" v={`${gained.toLocaleString()} 円相当`} strong />
            <Line
              k="引いた後の残高"
              v={`${records[records.length - 1].balanceAfter.toLocaleString()} pt`}
            />
          </dl>

          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={onPrizes}
              className="w-full rounded-2xl px-4 py-4 text-[0.98rem] font-bold"
              style={{ background: SHOP_ACCENT, color: "#06101F" }}
            >
              獲得商品を見る（発送 / ポイント交換）
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onAgain}
                disabled={!canAgain}
                className="rounded-2xl px-4 py-3.5 text-[0.9rem] font-bold text-white disabled:opacity-35"
                style={{ background: "rgba(255,255,255,0.07)", border: `1px solid ${SHOP_EDGE}` }}
              >
                もう一度引く
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl px-4 py-3.5 text-[0.9rem] font-bold text-white/75"
                style={{ background: "rgba(255,255,255,0.07)", border: `1px solid ${SHOP_EDGE}` }}
              >
                閉じる
              </button>
            </div>
          </div>

          <label className="mt-5 flex items-center justify-center gap-2 text-[0.78rem] font-bold text-white/55">
            <input
              type="checkbox"
              checked={lite}
              onChange={toggleLite}
              className="h-4 w-4 accent-[#5B8CFF]"
            />
            次からは、演出なしですぐ結果を出す
          </label>

          <p className="mt-4 text-center text-[0.7rem] leading-[1.9] text-white/30">
            これはデモです。DEMO DATA（架空のデータ）で動いています。
            <br />
            実際の決済・発送・メール送信は行いません。
          </p>
        </div>
      )}
    </div>
  );
}
