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
 * ★一覧からも引けること（2026-09-06 追加）
 * ═══════════════════════════════════════════════════════
 *
 *   以前は、一覧のカードを押す＝詳細へ移動、でした。
 *   引くには「一覧 → 詳細 → 引く → 確認 → 引く」の5手。
 *   ガチャは1回で終わる買い物ではありません。
 *   2回目から先も毎回5手なら、そこで手が止まります。
 *
 *   ですので、一覧のカードに「引く」を置きました。
 *   ★ただし、確認の1枚は必ず残すこと。
 *     一覧は指が滑る場所です。1タップで減る作りにすると、
 *     「押していないのに減った」という問い合わせが必ず来ます。
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
 *
 *   ★そして「足りません」で終わらせないこと。
 *     足りないと書くだけの画面は、お客様をその場に立たせたまま
 *     帰らせます。同じ場所に「ポイントを購入する」を出します。
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
/* ★ここで Sample で始まる部品を読まないこと。
     Sample は「描いた絵」です。本物の売り場は、
     お店が登録した写真だけを出します（scripts/check-real-art.mjs が見張ります）。 */
import { GradeChip, PrizeThumb, ShopPhoto } from "./art";
import {
  DrawTheater,
  Pill,
  SHOP_ACCENT,
  SHOP_EDGE,
  SHOP_GOLD,
  SHOP_SURFACE,
  type TheaterRecord,
} from "./Storefront";
import { CustomerShell } from "./Chrome";
import { BigBtn, Empty, Note, Panel } from "./ui";
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
   共通の小さな部品
   ══════════════════════════════════════════════ */

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

/** 押せる小さな札（絞り込み・並べ替え） */
function Chip({
  on,
  onClick,
  children,
  testId,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="shrink-0 rounded-full px-3 py-2 text-[0.76rem] font-bold transition"
      style={{
        color: on ? "#050912" : "rgba(255,255,255,0.66)",
        background: on ? SHOP_ACCENT : SHOP_SURFACE,
        border: `1px solid ${on ? SHOP_ACCENT : SHOP_EDGE}`,
      }}
    >
      {children}
    </button>
  );
}

/**
 * 「NEW」を出してよいか。
 *
 * ★手で付けられる印にしないこと。
 *   お店が好きに付けられる「NEW」は、いつまでも消えません。
 *   ずっと新着と書いてある店は、優良誤認になり得ます。
 *   ここは公開日という事実からだけ決めます。
 */
const NEW_DAYS = 7;
function isNew(publishedAt: string | null): boolean {
  if (publishedAt === null) return false;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= NEW_DAYS * 24 * 60 * 60 * 1000;
}

/* ══════════════════════════════════════════════
   並べ替え
   ══════════════════════════════════════════════ */

const SORTS = [
  { key: "new", label: "新着順" },
  { key: "cheap", label: "価格が安い順" },
  { key: "few", label: "残りが少ない順" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

function narabe(list: ShopItem[], key: SortKey): ShopItem[] {
  const a = [...list];
  if (key === "cheap") a.sort((x, y) => x.price - y.price);
  else if (key === "few") {
    /* ★完売を「残り0」として先頭に並べないこと。
         買えないものが一番上に来る売り場になります。 */
    a.sort((x, y) => {
      const xs = x.left <= 0 ? 1 : 0;
      const ys = y.left <= 0 ? 1 : 0;
      if (xs !== ys) return xs - ys;
      return x.left - y.left;
    });
  } else {
    a.sort((x, y) => (y.publishedAt ?? "").localeCompare(x.publishedAt ?? ""));
  }
  return a;
}

/* ══════════════════════════════════════════════
   引くときの確認（一覧・詳細で共通）
   ══════════════════════════════════════════════ */

/**
 * 押す前の確認。
 *
 * ★いくら減るのかを、押す前に必ず出すこと。
 *   金額が出ないまま減る買い物は、苦情になります。
 *
 * ★一覧から引くときも、必ずこれを通すこと。
 *   一覧は指が滑る場所です。
 */
function DrawSheet({
  g,
  balance,
  okuruChu,
  onGo,
  onCancel,
}: {
  g: ShopItem;
  balance: number | null;
  okuruChu: boolean;
  onGo: () => void;
  onCancel: () => void;
}) {
  return (
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
        <h2 className="text-[1rem] font-bold text-white">
          こちらの内容でお引きしますか
        </h2>
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
              {/* ★残高が読めていないときに、計算した数字を出さないこと */}
              {balance === null
                ? "—"
                : `${(balance - g.price).toLocaleString()} pt`}
            </dd>
          </div>
        </dl>

        <div className="mt-5 space-y-2.5">
          <BigBtn testId="draw-go" onClick={onGo} disabled={okuruChu}>
            {okuruChu ? "引いています…" : "引く"}
          </BigBtn>
          <button
            type="button"
            onClick={onCancel}
            disabled={okuruChu}
            className="w-full rounded-xl py-3 text-[0.85rem] font-bold text-white/60 disabled:opacity-40"
          >
            やめる
          </button>
        </div>
      </div>
    </div>
  );
}

/** 引いた結果を、演出に渡す形へ移し替える */
function toTheater(k: DrawOutcome, coverImageId: string | null): TheaterRecord[] {
  return [
    {
      id: k.drawId,
      gachaId: k.gachaId,
      grade: k.grade,
      prizeName: k.prizeName,
      prizeValue: k.prizeValue,
      price: k.price,
      balanceAfter: k.pointAfter,
      /* 当たった賞の写真。★無ければ null のまま渡すこと。
         ここで表紙の写真で代用すると、当たっていない物が
         「当たった物」として大きく出ます */
      imageId: k.imageId,
      coverImageId,
    },
  ];
}

/* ══════════════════════════════════════════════
   売り場（一覧）
   ══════════════════════════════════════════════ */

/**
 * @param guest true = まだログインしていない方に見せる売り場（/shop）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ログイン前でも、棚は見せること（2026-09-07 追加）
 * ═══════════════════════════════════════════════════════
 *
 *   以前は、売り場が /mypage の中にありました。つまり、
 *   何が売っているのかを見るために、先に会員登録が要りました。
 *   お店の方ですら、自分の売り場を見るのに
 *   自分の店の会員登録をする必要がありました。
 *
 *   ★ただし、ログイン前に「引ける」ようにはしないこと。
 *     引くとポイントが減ります。減らす相手が決まっていない
 *     状態で引かせる作りは、絶対に作らないでください。
 *     ここでは「ログインして引く」へ案内するだけです。
 */
export function ShopList({ guest = false }: { guest?: boolean } = {}) {
  const router = useRouter();
  const { state, reload } = useShopList(guest);
  /* ★ログインが要らない画面では、残高を見に行かないこと。
       見に行っても必ず断られます（401）。断られること自体は正しいのですが、
       ブラウザの記録が赤いエラーで埋まり、本当の不具合が埋もれます。 */
  const points = useCustomerPoints(!guest);
  const balance =
    points.state.phase === "ok" ? points.state.data.balance : null;

  const [tana, setTana] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("new");
  const [kanbaiKakusu, setKanbaiKakusu] = useState(false);

  /* 引く（一覧から直接） */
  const [target, setTarget] = useState<ShopItem | null>(null);
  const [okuruChu, setOkuruChu] = useState(false);
  const [shippai, setShippai] = useState<string | null>(null);
  const [kekka, setKekka] = useState<DrawOutcome | null>(null);

  const board = state.phase === "ok" ? state.data : null;

  const narabeta = useMemo(() => {
    if (board === null) return [];
    let a = board.gachas;
    if (tana !== null) a = a.filter((g) => g.categoryIds.includes(tana));
    if (kanbaiKakusu) a = a.filter((g) => g.left > 0);
    return narabe(a, sort);
  }, [board, tana, kanbaiKakusu, sort]);

  const hiku = useCallback(async () => {
    if (target === null || okuruChu) return;
    setOkuruChu(true);
    setShippai(null);

    /* ★鍵は、1回の「引く」につき1つ。
         押すたびに新しくしてよいのは、前の1回が終わってからです。 */
    const ans = await drawOnce(target.id, newDrawKey());

    setOkuruChu(false);
    if (!ans.ok) {
      setShippai(ans.message);
      setTarget(null);
      return;
    }
    setTarget(null);
    setKekka(ans.result);

    /* 残高と在庫を、必ず読み直す。
       ★画面側で引き算しないこと。サーバーの値と食い違います。 */
    points.reload();
    reload();
  }, [target, okuruChu, points, reload]);

  /* 演出の「もう一度」に使う、いまのガチャ。
     ★引く前に控えた値を使い回さないこと。
       残り口数も残高も、引いた分だけ変わっています。 */
  const ima =
    kekka === null
      ? null
      : (board?.gachas.find((g) => g.id === kekka.gachaId) ?? null);
  /* ★残高は、引いた結果が持っている「引いた後の残高」を先に使うこと。
       別便で読み直している balance は、返ってくるまで引く前の値です。
       その一瞬に「もう一度引く」を大きく出すと、
       押した方は、押してから残高不足で断られます。 */
  const atoZandaka = kekka === null ? balance : kekka.pointAfter;
  const mataHikeru =
    ima !== null && ima.left > 0 && atoZandaka !== null && atoZandaka >= ima.price;

  return (
    <CustomerShell guest={guest}>
      <h1 className="text-[1.15rem] font-bold text-white">ガチャを引く</h1>
      <p className="mt-1 text-[0.78rem] text-white/45">
        お引きになるガチャをお選びください。
      </p>

      {shippai && (
        <div className="mt-3">
          <Note tone="warn">{shippai}</Note>
        </div>
      )}

      {/* ── 棚（カテゴリ）──
          ★棚が1つも無いお店では、この行ごと出さないこと。
            「すべて」だけが並ぶ行は、何のためにあるのか分かりません。 */}
      {board !== null && board.categories.length > 0 && (
        <div className="-mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <Chip on={tana === null} onClick={() => setTana(null)} testId="cat-all">
            すべて
          </Chip>
          {board.categories.map((c) => (
            <Chip
              key={c.id}
              on={tana === c.id}
              onClick={() => setTana(c.id)}
              testId={`cat-${c.id}`}
            >
              {/* ★名前は、お店が管理画面で作った値です。
                    ここに例（ポケモン等）を書き足さないこと。 */}
              {c.name}
              <span className="num ml-1 text-[0.66rem] opacity-60">{c.count}</span>
            </Chip>
          ))}
        </div>
      )}

      {/* ── 並べ替えと絞り込み ──
          ★これ以上ボタンを増やさないこと。
            選ぶ手間が増えるほど、引くまでが遠くなります。 */}
      <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {SORTS.map((s) => (
          <Chip
            key={s.key}
            on={sort === s.key}
            onClick={() => setSort(s.key)}
            testId={`sort-${s.key}`}
          >
            {s.label}
          </Chip>
        ))}
        <Chip
          on={kanbaiKakusu}
          onClick={() => setKanbaiKakusu((v) => !v)}
          testId="filter-onsale"
        >
          販売中のみ
        </Chip>
      </div>

      <div className="mt-4">
        {state.phase !== "ok" ? (
          <Unreadable state={state} />
        ) : board !== null && board.gachas.length === 0 ? (
          <Empty>
            ただいま販売中のガチャはございません。
            <br />
            新しいガチャが公開されますと、こちらに並びます。
          </Empty>
        ) : narabeta.length === 0 ? (
          /* ★「絞り込んだ結果0件」と「1本も無い」を同じ文にしないこと。
               お店が閉まったように見えます。 */
          <Empty>
            この条件に合うガチャはありませんでした。
            <br />
            絞り込みを変えてお試しください。
          </Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {narabeta.map((g) => (
              <Tile
                key={g.id}
                g={g}
                guest={guest}
                balance={balance}
                busy={okuruChu}
                onOpen={() =>
                  router.push(guest ? `/shop/${g.id}` : `/mypage/shop/${g.id}`)
                }
                onDraw={() => {
                  /* ★ログイン前に引かせないこと。
                       減らす相手（お客様）が決まっていません。
                       引いたあとの1本へ戻れるように next を渡します。 */
                  if (guest) {
                    router.push(
                      `/login?next=${encodeURIComponent(`/mypage/shop/${g.id}`)}`,
                    );
                    return;
                  }
                  setShippai(null);
                  setTarget(g);
                }}
                onBuyPoints={() =>
                  router.push(
                    `/mypage/points/buy?from=${encodeURIComponent("/mypage/shop")}`,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      {target !== null && (
        <DrawSheet
          g={target}
          balance={balance}
          okuruChu={okuruChu}
          onGo={hiku}
          onCancel={() => setTarget(null)}
        />
      )}

      {kekka && (
        <DrawTheater
          records={toTheater(kekka, ima?.coverImageId ?? null)}
          canAgain={mataHikeru}
          onAgain={() => {
            setKekka(null);
            if (ima !== null) setTarget(ima);
          }}
          onPrizes={() => router.push("/mypage/prizes")}
          onClose={() => setKekka(null)}
          /* ★結果を見た直後に、買い足す場所を出しておくこと。
               ここで探させると、その場でやめられます。
               戻り先は、いま引いたガチャにします。 */
          onBuyPoints={() =>
            router.push(
              `/mypage/points/buy?from=${encodeURIComponent(
                ima !== null ? `/mypage/shop/${ima.id}` : "/mypage/shop",
              )}`,
            )
          }
        />
      )}
    </CustomerShell>
  );
}

/**
 * 売り場の1枚。
 *
 * ★カード全体を1つのボタンにしないこと。
 *   中に「引く」を置けなくなります（ボタンの中のボタンは作れません）。
 *   上半分＝詳しく見る、下＝引く、の2つに分けてあります。
 */
function Tile({
  g,
  guest,
  balance,
  busy,
  onOpen,
  onDraw,
  onBuyPoints,
}: {
  g: ShopItem;
  guest: boolean;
  balance: number | null;
  busy: boolean;
  onOpen: () => void;
  onDraw: () => void;
  onBuyPoints: () => void;
}) {
  const soldOut = g.left <= 0;
  /* ★ログイン前に「ポイントが足りません」と出さないこと。
       まだ会員でない方に、残高の話をしても意味が分かりません。 */
  const short = !guest && !soldOut && balance !== null && balance < g.price;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl"
      style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
    >
      <button
        type="button"
        data-testid={`tile-open-${g.id}`}
        onClick={onOpen}
        className="block w-full flex-1 text-left transition active:scale-[0.985]"
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

          {/* ★印は、すべて事実から決めること。
                手で付けられる「おすすめ」「大人気」を足さないこと。 */}
          <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
            {soldOut && <Pill tone="hot">完売</Pill>}
            {!soldOut && isNew(g.publishedAt) && <Pill tone="gold">NEW</Pill>}
            {!soldOut && g.sLeft > 0 && <Pill tone="gold">S賞 残り{g.sLeft}</Pill>}
          </span>
        </span>

        <span className="block px-3 pb-2 pt-2.5">
          <span className="block min-h-[2.6rem] text-[0.86rem] font-bold leading-[1.5] text-white">
            {g.title}
          </span>
          <span className="mt-1.5 flex items-baseline gap-1">
            <span
              className="num text-[1.25rem] font-bold"
              style={{ color: SHOP_ACCENT }}
            >
              {g.price.toLocaleString()}
            </span>
            <span className="text-[0.7rem] font-bold text-white/50">pt / 1回</span>
          </span>
          <span className="mt-2 block">
            <LeftBar left={g.left} total={g.total} />
          </span>
        </span>
      </button>

      {/* ── ここから引ける ──
          ★「足りません」だけを出さないこと。
            足す道を、同じ場所に置きます。 */}
      <div className="px-3 pb-3 pt-1">
        {soldOut ? (
          <div className="rounded-xl py-2.5 text-center text-[0.76rem] font-bold text-white/35"
               style={{ border: `1px solid ${SHOP_EDGE}` }}>
            完売しました
          </div>
        ) : short ? (
          <button
            type="button"
            data-testid={`tile-buy-points-${g.id}`}
            onClick={onBuyPoints}
            className="w-full rounded-xl py-2.5 text-[0.76rem] font-bold text-white/85"
            style={{ border: `1px solid ${SHOP_ACCENT}` }}
          >
            ポイントを購入する
          </button>
        ) : (
          <button
            type="button"
            data-testid={`tile-draw-${g.id}`}
            onClick={onDraw}
            disabled={busy}
            className="w-full rounded-xl py-2.5 text-[0.8rem] font-bold text-[#050912] disabled:opacity-40"
            style={{ background: SHOP_ACCENT }}
          >
            {guest ? "ログインして引く" : "1回引く"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   1本の中身と、引く
   ══════════════════════════════════════════════ */

export function ShopDetailScreen({
  gachaId,
  guest = false,
}: {
  gachaId: string;
  /** true = まだログインしていない方（/shop/[id]）。引くことはできません */
  guest?: boolean;
}) {
  const router = useRouter();
  const detail = useShopDetail(gachaId, guest);
  /* ★理由は ShopList と同じです。ログイン前は残高を見に行きません。 */
  const points = useCustomerPoints(!guest);

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

    const ans = await drawOnce(g.id, newDrawKey());

    setOkuruChu(false);
    if (!ans.ok) {
      setShippai(ans.message);
      setKakunin(false);
      return;
    }
    setKakunin(false);
    setKekka(ans.result);

    points.reload();
    detail.reload();
  }, [g, okuruChu, points, detail]);

  if (!g) {
    return (
      <CustomerShell guest={guest}>
        <div className="mt-2">
          <Unreadable state={detail.state} />
        </div>
      </CustomerShell>
    );
  }

  const soldOut = g.left <= 0;
  /* ★ログイン前の方に、残高不足の話をしないこと（意味が通じません） */
  const tarinai = !guest && balance !== null && balance < g.price;
  const hikenai = soldOut || tarinai || okuruChu;

  /* ★結果画面だけは、引いた直後の残高で判断すること（2026-09-07）。

       上の balance は、別便で読み直している値です。読み直しが返るまでの
       あいだ、引く前の残高のままになります。その一瞬に

         残高が足りないのに「もう一度引く」が大きく出る

       という状態が起きます。押した方は、押してから断られます。
       断られた回数だけ、お店の信用が減ります。

       引いた結果そのものが「引いた後にいくら残ったか」を持っているので、
       そちらを先に使います。 */
  const ato = kekka === null ? null : kekka.pointAfter;
  const mataHikeruKekka =
    !soldOut && !okuruChu && (ato === null ? !hikenai : ato >= g.price);

  return (
    <CustomerShell guest={guest}>
      {/* ═══════════════════════════════════════════
          ★「引く」までスクロールさせないこと
          ═══════════════════════════════════════════

            以前は、賞の内訳（十数行）を挟んだ下に
            「引く」がありました。スマホでは2画面ぶん下です。
            引きに来た方に、毎回スクロールさせていました。

            いまは、最初の画面に
              写真・題名・価格・保有ポイント・残り口数・目玉景品
              ・引く・ポイント購入
            が全部そろっています。賞の内訳はその下です。 */}
      <div
        className="overflow-hidden rounded-2xl"
        style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
      >
        <div className="relative aspect-[16/9] w-full">
          <ShopPhoto
            imageId={g.coverImageId}
            alt={g.title}
            className="h-full w-full object-cover"
          />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {soldOut && <Pill tone="hot">完売</Pill>}
            {!soldOut && isNew(g.publishedAt) && <Pill tone="gold">NEW</Pill>}
          </div>
          {/* 目玉の賞。★売り切れた賞をここに出さないこと */}
          {g.top && (
            <div
              className="absolute bottom-2 left-2 right-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{
                background: "rgba(5,9,18,0.74)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              <GradeChip grade={g.top.grade} onDark />
              <span className="truncate text-[0.76rem] font-bold text-white/85">
                {g.top.name}
              </span>
              <span className="num nb ml-auto shrink-0 text-[0.76rem] font-bold"
                    style={{ color: SHOP_GOLD }}>
                {g.top.value.toLocaleString()}円相当
              </span>
            </div>
          )}
        </div>

        <div className="px-4 pb-4 pt-3">
          <h1 className="text-[1.05rem] font-bold leading-[1.6] text-white">
            {g.title}
          </h1>

          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="flex items-baseline gap-1">
              <span
                className="num text-[1.6rem] font-bold"
                style={{ color: SHOP_ACCENT }}
              >
                {g.price.toLocaleString()}
              </span>
              <span className="text-[0.78rem] font-bold text-white/50">
                pt / 1回
              </span>
            </div>
            {/* ★残高を、読めていないのに 0pt と書かないこと。
                  ★ログイン前の方には、この枠ごと出さないこと。
                    まだ会員でない方に「保有ポイント —」とだけ出すと、
                    自分のポイントが読めていないように見えます。 */}
            {!guest && (
              <div className="text-right">
                <span className="block text-[0.62rem] font-bold text-white/40">
                  保有ポイント
                </span>
                <span className="num text-[0.95rem] font-bold text-white">
                  {balance === null ? "—" : `${balance.toLocaleString()} pt`}
                </span>
              </div>
            )}
          </div>

          <div className="mt-3">
            <LeftBar left={g.left} total={g.total} />
          </div>
        </div>
      </div>

      {/* ── 引く（最初の画面の中） ── */}
      <div className="mt-4 space-y-3">
        {shippai && <Note tone="warn">{shippai}</Note>}

        {soldOut && <Note tone="warn">このガチャは完売いたしました。</Note>}

        {!soldOut && tarinai && (
          <>
            <Note tone="warn">
              保有ポイントが不足しています（1回 {g.price.toLocaleString()}pt ／ 保有{" "}
              {balance === null ? "—" : balance.toLocaleString()}pt）。
            </Note>

            {/* ★戻り先（from）を必ず渡すこと。
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

        {/* ★ログイン前に引かせないこと。
              減らす相手（お客様）が決まっていません。
              押した1本へそのまま戻れるよう next を渡します。 */}
        {guest ? (
          <BigBtn
            testId="guest-login-to-draw"
            onClick={() =>
              router.push(
                `/login?next=${encodeURIComponent(`/mypage/shop/${g.id}`)}`,
              )
            }
            note="ログインまたは新規会員登録のあと、このガチャへお戻りいただけます。"
          >
            ログインして引く
          </BigBtn>
        ) : (
          <BigBtn
            testId="draw-open"
            onClick={() => setKakunin(true)}
            disabled={hikenai}
          >
            {okuruChu ? "引いています…" : `${g.price.toLocaleString()}pt で 1回引く`}
          </BigBtn>
        )}

        <p className="text-[0.72rem] leading-[1.9] text-white/45">
          お引きになった時点でポイントを申し受けます。当選された商品は、マイページの「獲得商品」からお手続きいただけます。
        </p>
      </div>

      {/* ── 賞の内訳 ──
          ★還元率という1つの数字にまとめないこと。
            「ぜんぶ引き切ったとき」の数字であって、
            1回引く方の取り分ではありません（景品表示法）。
            残り本数をそのまま出せば、読んだ方が判断できます。 */}
      <div className="mt-6">
        <h2 className="mb-2 text-[0.95rem] font-bold text-white">賞の内訳と残り</h2>
        <Panel>
          <div className="space-y-2.5">
            {g.prizes.map((p) => (
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
            ))}
          </div>
        </Panel>
      </div>

      <button
        type="button"
        data-testid="detail-back-to-list"
        onClick={() => router.push(guest ? "/shop" : "/mypage/shop")}
        className="mt-5 w-full rounded-xl py-3 text-[0.82rem] font-bold text-white/55"
        style={{ border: `1px solid ${SHOP_EDGE}` }}
      >
        ほかのガチャを見る
      </button>

      {kakunin && (
        <DrawSheet
          g={g}
          balance={balance}
          okuruChu={okuruChu}
          onGo={hiku}
          onCancel={() => setKakunin(false)}
        />
      )}

      {/* ── 結果（演出は、確定した結果を再生するだけ） ──
          ★sampleKind を渡さないこと。渡すと、描いた絵が結果画面に出ます */}
      {kekka && (
        <DrawTheater
          records={toTheater(kekka, g.coverImageId)}
          canAgain={mataHikeruKekka}
          onAgain={() => {
            setKekka(null);
            setKakunin(true);
          }}
          onPrizes={() => router.push("/mypage/prizes")}
          onClose={() => setKekka(null)}
          /* ★戻り先は、いま見ているガチャ。
               買ったあと売り場の一覧へ戻すと、
               どれを引こうとしていたのかを、もう一度探させます。 */
          onBuyPoints={() =>
            router.push(
              `/mypage/points/buy?from=${encodeURIComponent(`/mypage/shop/${g.id}`)}`,
            )
          }
        />
      )}
    </CustomerShell>
  );
}
