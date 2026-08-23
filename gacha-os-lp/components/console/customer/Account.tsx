/**
 * マイページ側（ログインした方だけの画面）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここに並ぶのは、全部お金です
 * ═══════════════════════════════════════════════════════
 *
 *   保有ポイント・当たった商品・お届け先・発送状況。
 *   「個人情報だから守る」ではありません。
 *   他人に触られたら、取り返す方法が無いから守ります。
 *
 *   だからこの中の関数は、どれも「自分の分」しか受け取りません。
 *   一覧を丸ごと渡して、画面の中で絞り込む作りにはしていません。
 *   絞り込みを1か所書き忘れたら、そこが穴になります。
 *
 * ═══════════════════════════════════════════════════════
 * ★取り消せない操作は、必ず確認を1枚はさむこと
 * ═══════════════════════════════════════════════════════
 *
 *     発送する       → お届け先を見る → 依頼する
 *     ポイント交換   → 何ptになるか見る → 交換する
 *
 *   確認の画面には「交換すると、もう発送はできません」と書きます。
 *   押してから知るのでは遅いからです。
 *
 * ═══════════════════════════════════════════════════════
 * ★数字を出したら、必ず押せるようにすること
 * ═══════════════════════════════════════════════════════
 *
 *   「未選択 3点」と出ているのに押せない画面は、
 *   お客様に「どこかを探せ」と言っているのと同じです。
 *   この画面の数字は、全部その中身へ入れます。
 */

"use client";

import { useMemo, useState } from "react";
import type { Address, ConsoleState, Prize } from "@/lib/console/state";
import { POINT_KIND_LABEL } from "@/lib/console/state";
import { ORDER_STATUS_LABEL } from "@/lib/console/support";
import {
  Back,
  BigBtn,
  Empty,
  Fld,
  H,
  Note,
  Panel,
  PrizeArt,
  Row,
  StatusChip,
  TapRow,
  TONE,
  SHOP_ACCENT,
  SHOP_EDGE,
  SHOP_SURFACE,
} from "./ui";
import { NOTICE_LABEL, type Notice } from "./notices";

/* ══════════════════════════════════════════════
   画面の行き先
   ══════════════════════════════════════════════ */

export type View =
  /** 売り場。★ここだけはログイン無しでも見られること */
  | { name: "shop" }
  | { name: "gacha"; id: string }
  | { name: "login" }
  /** マイページ（アカウントの入口） */
  | { name: "home" }
  | { name: "notices" }
  | { name: "prizes" }
  | { name: "prize"; id: string }
  /** 発送前に、登録済みのお届け先を確認していただく画面 */
  | { name: "ship"; id: string }
  | { name: "shipConfirm"; id: string }
  /** お届け先そのものを変える画面（追加の本人確認が入ります） */
  | { name: "address" }
  | { name: "exchange"; id: string }
  | { name: "orders" }
  | { name: "support" }
  | { name: "points" };

/* ══════════════════════════════════════════════
   ① マイページ（入口）
   ══════════════════════════════════════════════ */

/**
 * マイページの入口。
 *
 * ★いちばん上は「やることが残っているもの」であること。
 *   お客様が開く理由は、たいてい「当たったものをどうするか」です。
 *   残高やお知らせを先に見せると、目的まで2回よけいに押します。
 */
export function AccountHome({
  userName,
  balance,
  prizes,
  orders,
  tickets,
  todo,
  hasAddress,
  go,
  onLogout,
}: {
  userName: string;
  balance: number;
  prizes: Prize[];
  orders: ConsoleState["orders"];
  tickets: ConsoleState["tickets"];
  /** まだ手を動かしていないお知らせの件数 */
  todo: number;
  hasAddress: boolean;
  go: (v: View) => void;
  onLogout: () => void;
}) {
  const unchosen = prizes.filter((p) => p.status === "UNCHOSEN").length;
  const shipping = prizes.filter((p) => p.status === "SHIP_REQUESTED").length;
  const exchanged = prizes.filter((p) => p.status === "EXCHANGED").length;
  const moving = orders.filter((o) => o.status !== "DELIVERED").length;
  const openTickets = tickets.filter((t) => t.status !== "DONE").length;

  return (
    <div className="space-y-4">
      <H sub={`${userName}様。数字を押すと、その中身に入れます。`}>マイページ</H>

      {/* ── いちばん上は、やることが残っているもの ── */}
      {unchosen > 0 && (
        <div
          className="rounded-2xl px-4 py-4"
          style={{ background: TONE.warn.bg, border: `1px solid ${TONE.warn.line}` }}
        >
          <p className="text-[0.92rem] font-bold" style={{ color: TONE.warn.fg }}>
            受け取り方法が未選択の商品が {unchosen} 点あります
          </p>
          <p className="mt-1.5 text-[0.79rem] leading-[1.9] text-white/60">
            現物のお届けか、ポイントへの交換をお選びください。
            選ぶまでは、どちらにもなりません。
          </p>
          <div className="mt-3">
            <BigBtn onClick={() => go({ name: "prizes" })}>受け取り方法を選ぶ</BigBtn>
          </div>
        </div>
      )}

      {/* ── 残高 ── */}
      <button
        type="button"
        onClick={() => go({ name: "points" })}
        className="block w-full rounded-2xl px-5 py-5 text-left transition active:scale-[0.995]"
        style={{
          background: "linear-gradient(135deg, #14213D 0%, #0B1224 100%)",
          border: `1px solid ${SHOP_EDGE}`,
        }}
      >
        <span className="block text-[0.74rem] font-bold tracking-wider text-white/45">
          保有ポイント
        </span>
        <span className="num mt-1 block text-[2.2rem] font-bold leading-none text-white">
          {balance.toLocaleString()}
          <span className="ml-1 text-[0.95rem] font-medium text-white/60">pt</span>
        </span>
        <span className="mt-2 block text-[0.74rem] text-white/45">
          押すと、この残高になるまでの動きを全部ご覧いただけます ›
        </span>
      </button>

      {/* ── 内訳 ──
          ★合計と内訳を、必ず足し算が合う形で並べること。
            「獲得商品23点／発送手配中23点」と並べると、
            23点ぜんぶ発送中だと読まれます。
            数字が正しくても、並べ方で誤解されるなら誤案内です */}
      <div className="space-y-2">
        <TapRow
          label="獲得商品"
          note={`当たった商品の全部です（${unchosen} ＋ ${shipping} ＋ ${exchanged} ＝ ${prizes.length} 点）`}
          value={prizes.length}
          unit="点"
          onClick={() => go({ name: "prizes" })}
        />
        <TapRow
          label="お知らせ"
          note={todo > 0 ? `${todo} 件、お客様の操作をお待ちしています` : "当選・発送・お問い合わせの記録です"}
          value={todo}
          unit="件"
          tone={todo > 0 ? "warn" : undefined}
          onClick={() => go({ name: "notices" })}
        />
        <TapRow
          label="発送状況"
          note={moving > 0 ? "お届けまでの状況と追跡番号をご確認いただけます" : "お届け中のお荷物はありません"}
          value={moving}
          unit="件"
          onClick={() => go({ name: "orders" })}
        />
        {/* ★0件でも押せるようにすること。
            押せなくすると、新しく問い合わせたい方の入口が消えます */}
        <TapRow
          label="お問い合わせ"
          note={openTickets > 0 ? `${openTickets} 件が対応中です` : "新しいご質問も、こちらから送れます"}
          value={tickets.length}
          unit="件"
          onClick={() => go({ name: "support" })}
        />
      </div>

      {/* ── お届け先 ──
          ★住所が未登録のまま発送を選べる導線にしないこと。
            宛先のない発送依頼は、受け取った側で必ず止まります。
            止まってから気づくより、先に登録していただくほうが早いです */}
      <button
        type="button"
        onClick={() => go({ name: "address" })}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-4 text-left transition active:scale-[0.995]"
        style={
          hasAddress
            ? { background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }
            : { background: TONE.danger.bg, border: `1px solid ${TONE.danger.line}` }
        }
      >
        <span className="min-w-0">
          <span
            className="block text-[0.88rem] font-bold"
            style={{ color: hasAddress ? "#FFFFFF" : TONE.danger.fg }}
          >
            お届け先
          </span>
          <span className="mt-1 block text-[0.74rem] leading-[1.8] text-white/50">
            {hasAddress
              ? "ご登録済みです。変更には、追加の本人確認が入ります"
              : "まだご登録がありません。発送のご依頼には、お届け先が必要です"}
          </span>
        </span>
        <span className="shrink-0 text-[1.05rem]" style={{ color: SHOP_ACCENT }} aria-hidden>
          ›
        </span>
      </button>

      <button
        type="button"
        onClick={onLogout}
        className="min-h-[44px] w-full text-[0.8rem] font-bold text-white/40 underline"
      >
        ログアウトする
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ② お知らせ
   ══════════════════════════════════════════════ */

/**
 * お知らせ一覧。
 *
 * ★「未読」で数えないこと。
 *   一度開けば0になる数字は、何も表していません。
 *   ここで太字にするのは「まだ手を動かしていないもの」だけです。
 */
export function NoticeList({
  list,
  go,
  back,
}: {
  list: Notice[];
  go: (v: View) => void;
  back: () => void;
}) {
  const open = (n: Notice) => {
    const g = n.go;
    if (g.to === "prize") go({ name: "prize", id: g.id });
    else if (g.to === "prizes") go({ name: "prizes" });
    else if (g.to === "orders") go({ name: "orders" });
    else if (g.to === "support") go({ name: "support" });
    else go({ name: "gacha", id: g.id });
  };

  return (
    <>
      <Back onClick={back} label="マイページ" />
      <H sub="当選・発送・お問い合わせ・新しいガチャのお知らせです。">お知らせ</H>

      {list.length === 0 ? (
        <Empty>
          いまお知らせはありません。
          <br />
          ガチャを引くと、当選のお知らせがここに届きます。
        </Empty>
      ) : (
        <ul className="space-y-2">
          {list.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => open(n)}
                className="flex w-full items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition active:scale-[0.995]"
                style={
                  n.todo
                    ? { background: TONE.warn.bg, border: `1px solid ${TONE.warn.line}` }
                    : { background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }
                }
              >
                <span
                  className="nb mt-0.5 shrink-0 rounded-full px-2 py-1 text-[0.66rem] font-bold"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    color: "rgba(255,255,255,0.65)",
                  }}
                >
                  {NOTICE_LABEL[n.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-[0.87rem] font-bold leading-snug"
                    style={{ color: n.todo ? TONE.warn.fg : "#FFFFFF" }}
                  >
                    {n.title}
                  </span>
                  <span className="mt-1 block text-[0.76rem] leading-[1.85] text-white/55">
                    {n.body}
                  </span>
                  {n.todo && (
                    <span
                      className="mt-1.5 block text-[0.72rem] font-bold"
                      style={{ color: TONE.warn.fg }}
                    >
                      お客様の操作をお待ちしています
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[1rem]" style={{ color: SHOP_ACCENT }} aria-hidden>
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
   ③ 獲得商品の一覧
   ══════════════════════════════════════════════ */

const FILTERS: { key: "ALL" | Prize["status"]; label: string }[] = [
  { key: "ALL", label: "すべて" },
  { key: "UNCHOSEN", label: "未選択" },
  { key: "SHIP_REQUESTED", label: "発送依頼済み" },
  { key: "EXCHANGED", label: "交換済み" },
];

/**
 * 獲得商品の一覧。
 *
 * ═══════════════════════════════════════════════
 * ★23点を、23回押させないこと
 * ═══════════════════════════════════════════════
 *
 *   1件ずつ選ぶ画面は、作るのは簡単です。
 *   しかし当たりが増えるほど使えなくなります。
 *   23点あれば、確認画面を含めて50回以上押すことになります。
 *   そこまで押していただいた頃には、
 *   何を選んだのか、ご本人にも分からなくなっています。
 *
 * ★ただし、まとめる操作ほど慎重にすること。
 *   まとめてポイント交換は、取り消せません。
 *   一度に5点以上は、追加の本人確認（STEP-UP）に回ります。
 *   その判断をするのは、この画面ではなく受け取り側です。
 */
export function PrizeList({
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

        <Panel pad={false}>
          <ul className="divide-y" style={{ borderColor: SHOP_EDGE }}>
            {pickedPrizes.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                <PrizeArt p={p} size="sm" />
                <p className="min-w-0 flex-1 truncate text-[0.85rem] font-bold text-white">
                  {p.name}
                </p>
                <span className="num shrink-0 text-[0.78rem] font-bold text-white/55">
                  {p.exchangePt.toLocaleString()}pt
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        {ask === "EXCHANGE" ? (
          <>
            <div
              className="mt-3 rounded-2xl px-4 py-4"
              style={{ background: "linear-gradient(135deg, #14213D 0%, #0B1224 100%)", border: `1px solid ${SHOP_EDGE}` }}
            >
              <p className="text-[0.76rem] text-white/50">加算されるポイント</p>
              <p className="num mt-1 text-[1.9rem] font-bold leading-none text-white">
                +{pickedPt.toLocaleString()}
                <span className="ml-1 text-[0.85rem] font-medium text-white/60">pt</span>
              </p>
            </div>
            <div className="mt-3">
              <Note tone="danger">
                {pickedPt.toLocaleString()}pt へ交換します。交換後は、これらの商品の発送依頼ができません。
              </Note>
            </div>
          </>
        ) : (
          <div className="mt-3">
            <Note tone="warn">
              ご登録のお届け先へ、{pickedPrizes.length} 点の発送をご依頼します。
              発送をご依頼されると、これらの商品はポイントへ交換できなくなります。
            </Note>
          </div>
        )}

        <div className="mt-4 space-y-2.5">
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

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => {
          const n = f.key === "ALL" ? prizes.length : prizes.filter((p) => p.status === f.key).length;
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={on}
              className="nb min-h-[40px] shrink-0 rounded-full px-3.5 text-[0.79rem] font-bold transition"
              style={
                on
                  ? { background: SHOP_ACCENT, color: "#06101F" }
                  : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.65)", border: `1px solid ${SHOP_EDGE}` }
              }
            >
              {f.label}
              <span className="num ml-1">{n}</span>
            </button>
          );
        })}
      </div>

      {/* ── まとめて選ぶ ──
          ★選べるものが無いときは、この帯ごと出さないこと。
            押せないボタンが並ぶ画面は、壊れて見えます */}
      {selectable.length > 0 && (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
          style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${SHOP_EDGE}` }}
        >
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() => setPicked(allPicked ? [] : selectable.map((p) => p.id))}
              className="h-5 w-5"
              style={{ accentColor: SHOP_ACCENT }}
            />
            <span className="text-[0.8rem] font-bold text-white/85">
              未選択の {selectable.length} 点をすべて選ぶ
            </span>
          </label>
          {picked.length > 0 && (
            <button
              type="button"
              onClick={() => setPicked([])}
              className="shrink-0 text-[0.76rem] font-bold underline"
              style={{ color: SHOP_ACCENT }}
            >
              選択を外す
            </button>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <Empty>このしぼり込みに当てはまる商品はありません。</Empty>
      ) : (
        <ul className={pickedPrizes.length > 0 ? "space-y-2.5 pb-44" : "space-y-2.5"}>
          {list.map((p) => {
            const canPick = p.status === "UNCHOSEN";
            const on = picked.includes(p.id);
            return (
              <li key={p.id}>
                <div
                  className="flex items-center gap-1 rounded-2xl px-2 py-2.5 transition"
                  style={{
                    background: on ? "rgba(91,140,255,0.10)" : SHOP_SURFACE,
                    border: `1px solid ${on ? SHOP_ACCENT : SHOP_EDGE}`,
                  }}
                >
                  {/* ★選ぶ場所と、開く場所を分けること。
                      同じ場所が両方を兼ねると、
                      詳細を見たいだけの操作が、選択になってしまいます */}
                  {canPick ? (
                    <label className="flex min-h-[44px] cursor-pointer items-center px-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(p.id)}
                        aria-label={`${p.name} を選ぶ`}
                        className="h-5 w-5"
                        style={{ accentColor: SHOP_ACCENT }}
                      />
                    </label>
                  ) : (
                    <span className="w-9 shrink-0" aria-hidden />
                  )}

                  <button
                    type="button"
                    onClick={() => go({ name: "prize", id: p.id })}
                    className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
                  >
                    <PrizeArt p={p} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.89rem] font-bold text-white">
                        {p.name}
                      </span>
                      <span className="num mt-0.5 block truncate text-[0.72rem] text-white/45">
                        {p.gachaTitle} ／ {p.wonAt}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusChip status={p.status} />
                        <span className="num text-[0.74rem] font-bold text-white/50">
                          交換 {p.exchangePt.toLocaleString()}pt
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 pr-1 text-[1.05rem]" style={{ color: SHOP_ACCENT }} aria-hidden>
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
            選んだ内容を見失います。
          ★下タブと案内パネルの上に出すこと（--day-h ぶん逃がす） */}
      {pickedPrizes.length > 0 && (
        <div
          className="fixed inset-x-0 z-[45] px-4 pt-3 backdrop-blur"
          style={{
            bottom: "calc(var(--day-h, 0px) + 64px)",
            background: "rgba(7,12,22,0.94)",
            borderTop: `1px solid ${SHOP_EDGE}`,
            paddingBottom: "0.75rem",
          }}
        >
          <div className="mx-auto w-full max-w-[560px]">
            <p className="text-[0.79rem] font-bold text-white">
              {pickedPrizes.length} 点を選択中
              <span className="num ml-2 font-medium text-white/50">
                （交換すると +{pickedPt.toLocaleString()}pt）
              </span>
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setAsk("SHIP")}
                className="min-h-[48px] flex-1 rounded-xl px-3 text-[0.86rem] font-bold"
                style={{ background: SHOP_ACCENT, color: "#06101F" }}
              >
                まとめて発送
              </button>
              <button
                type="button"
                onClick={() => setAsk("EXCHANGE")}
                className="min-h-[48px] flex-1 rounded-xl px-3 text-[0.86rem] font-bold"
                style={{ background: "transparent", color: "#BFD4FF", border: `2px solid ${SHOP_ACCENT}` }}
              >
                まとめて交換
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════
   ④ 商品の詳細（ここで2つに1つを選ぶ）
   ══════════════════════════════════════════════ */

export function PrizeDetail({
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

      <Panel>
        <div className="flex items-start gap-4">
          <PrizeArt p={p} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.02rem] font-bold leading-snug text-white">{p.name}</h2>
            <dl className="mt-3 space-y-1.5 text-[0.79rem]">
              <Row k="獲得日時" v={p.wonAt} />
              <Row k="ガチャ" v={p.gachaTitle} />
              <Row k="賞ランク" v={`${p.grade}賞`} />
              <Row k="交換価値" v={`${p.exchangePt.toLocaleString()}pt`} />
            </dl>
            <div className="mt-3">
              <StatusChip status={p.status} />
            </div>
          </div>
        </div>
      </Panel>

      {/* ── まだ選んでいない：2つに1つを選ぶ ── */}
      {p.status === "UNCHOSEN" && (
        <div className="mt-5 space-y-2.5">
          <p className="text-center text-[0.86rem] font-bold text-white/85">
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
          <Note tone="warn">
            どちらか一方のみお選びいただけます。
            ポイントに交換された商品は、その後の発送はできません。
          </Note>
        </div>
      )}

      {/* ── 発送を選んだあと ── */}
      {p.status === "SHIP_REQUESTED" && (
        <div className="mt-5 space-y-2.5">
          <Note tone="info">
            この商品は発送をご依頼済みです。
            {orderStatus && (
              <>
                <br />
                現在の状態：<strong className="font-bold">{orderStatus}</strong>
              </>
            )}
            <br />
            発送を選ばれたため、ポイントへの交換はできません。
          </Note>
          <BigBtn tone="second" onClick={() => go({ name: "orders" })}>
            配送状況を見る
          </BigBtn>
        </div>
      )}

      {/* ── ポイントに交換したあと ── */}
      {p.status === "EXCHANGED" && (
        <div className="mt-5 space-y-2.5">
          <Note tone="quiet">
            この商品は {p.exchangedAt ?? ""} にポイントへ交換済みです。
            <br />
            交換された商品の発送はできません。
          </Note>
          <BigBtn tone="quiet" onClick={() => go({ name: "points" })}>
            ポイント履歴で確認する
          </BigBtn>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════
   ⑤ 発送：お届け先の確認
   ══════════════════════════════════════════════ */

/**
 * 発送の前に、ご登録のお届け先を確認していただく画面。
 *
 * ═══════════════════════════════════════════════
 * ★ここで住所を「入力」させないこと
 * ═══════════════════════════════════════════════
 *
 *   入力した住所をそのまま発送依頼に付けて送る作りは、
 *   送り先を送信のたびに自由に決められる、ということです。
 *   受け取った側から見ると、届いた住所が本当にその方のものかを
 *   確かめる手立てがありません。
 *   乗っ取った人は、ここに自分の家を書くだけで済みます。
 *
 *   だから今は、
 *     ・この画面は「登録されている住所」を表示するだけ
 *     ・変えるときは別画面で、追加の本人確認を通してから
 *     ・発送の依頼に住所は付けない（受け取り側が本人の登録住所を使う）
 */
export function ShipAddressCheck({
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
          <Panel>
            <p className="text-[0.77rem] font-bold text-white/50">ご登録のお届け先</p>
            <p className="num mt-2 text-[0.9rem] leading-[1.95] text-white">
              〒{address.zip}
              <br />
              {address.addr}
              <br />
              {address.name}　{address.tel}
            </p>
          </Panel>

          <div className="mt-3">
            <Note tone="info">
              発送先は、ログイン中のご本人に登録されている住所です。
              この画面から書き換えることはできません。変更には、追加の本人確認が必要です。
            </Note>
          </div>

          <div className="mt-4 space-y-2.5">
            <BigBtn onClick={onNext}>この住所で確認へすすむ</BigBtn>
            <BigBtn tone="second" onClick={onEdit} note="追加の本人確認が入ります">
              お届け先を変更する
            </BigBtn>
          </div>
        </>
      ) : (
        <>
          <Note tone="danger">
            お届け先がまだご登録されていません。
            <br />
            宛先のない発送は、お受けできません。先にご登録をお願いします。
          </Note>
          <div className="mt-4">
            <BigBtn onClick={onEdit}>お届け先を登録する</BigBtn>
          </div>
        </>
      )}

      <p className="mt-3 text-[0.76rem] leading-[1.85] text-white/40">
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
export function AddressForm({
  initial,
  onSubmit,
  back,
}: {
  initial: Address | undefined;
  onSubmit: (a: Address) => void;
  back: () => void;
}) {
  const [a, setA] = useState<Address>(initial ?? { name: "", zip: "", addr: "", tel: "" });
  const filled = a.name.trim() && a.zip.trim() && a.addr.trim() && a.tel.trim();

  return (
    <>
      <Back onClick={back} label="マイページ" />
      <H sub="変更には、もう一度ご本人かどうかの確認が入ります。">お届け先の変更</H>

      <Panel>
        <div className="space-y-3.5">
          <Fld label="お名前" value={a.name} onChange={(v) => setA({ ...a, name: v })} />
          <Fld
            label="郵便番号"
            value={a.zip}
            inputMode="numeric"
            hint="デモです。000-0000 のような架空の番号をご入力ください"
            onChange={(v) => setA({ ...a, zip: v })}
          />
          <Fld label="ご住所" value={a.addr} onChange={(v) => setA({ ...a, addr: v })} />
          <Fld
            label="お電話番号"
            value={a.tel}
            inputMode="tel"
            hint="デモです。000-0000-0000 のような架空の番号をご入力ください"
            onChange={(v) => setA({ ...a, tel: v })}
          />
        </div>
      </Panel>

      <div className="mt-3 space-y-3">
        <Note tone="warn">
          お届け先を変更されますと、変更の直後の高額商品の発送では、
          もう一度ご本人確認をお願いすることがあります。
          身に覚えのない変更を防ぐための仕組みです。
        </Note>
        <Note tone="quiet">
          ここは架空の住所です。デモのため、実際の配送は行いません。
          実在するご住所・お電話番号はご入力にならないでください。
        </Note>
      </div>

      <div className="mt-4 space-y-2.5">
        <BigBtn
          onClick={() => onSubmit(a)}
          disabled={!filled}
          note={filled ? undefined : "すべての項目をご入力ください"}
        >
          この内容に変更する
        </BigBtn>
        <BigBtn tone="quiet" onClick={back}>
          やめる
        </BigBtn>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════
   ⑥ 発送：最後の確認
   ══════════════════════════════════════════════ */

export function ShipConfirm({
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

      <Panel>
        <div className="flex items-center gap-3">
          <PrizeArt p={p} size="sm" />
          <p className="min-w-0 flex-1 text-[0.9rem] font-bold text-white">{p.name}</p>
        </div>
        <div className="mt-4 border-t pt-3" style={{ borderColor: SHOP_EDGE }}>
          <p className="text-[0.77rem] font-bold text-white/50">お届け先</p>
          {address ? (
            <p className="num mt-1 text-[0.85rem] leading-[1.9] text-white">
              〒{address.zip}
              <br />
              {address.addr}
              <br />
              {address.name}　{address.tel}
            </p>
          ) : (
            <p className="mt-1 text-[0.85rem] font-bold leading-[1.9]" style={{ color: TONE.danger.fg }}>
              お届け先がご登録されていません。先にご登録をお願いします。
            </p>
          )}
        </div>
      </Panel>

      <div className="mt-4">
        <Note tone="warn">
          発送をご依頼されると、この商品はポイントへ交換できなくなります。
        </Note>
      </div>

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
   ⑦ ポイント交換の確認
   ══════════════════════════════════════════════ */

export function ExchangeConfirm({
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

      <Panel>
        <div className="flex items-center gap-3">
          <PrizeArt p={p} size="sm" />
          <p className="min-w-0 flex-1 text-[0.9rem] font-bold text-white">{p.name}</p>
        </div>

        <p className="mt-5 text-center text-[0.93rem] font-bold leading-[1.9] text-white">
          この商品を
          <span className="num mx-1 text-[1.35rem]" style={{ color: SHOP_ACCENT }}>
            {p.exchangePt.toLocaleString()}pt
          </span>
          へ交換しますか？
        </p>

        <div
          className="mt-5 rounded-xl px-4 py-3"
          style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${SHOP_EDGE}` }}
        >
          <div className="flex items-center justify-between text-[0.84rem]">
            <span className="text-white/50">いまの残高</span>
            <span className="num font-bold text-white">{balance.toLocaleString()}pt</span>
          </div>
          <div className="my-2 text-center text-[0.9rem] text-white/35" aria-hidden>
            ↓
          </div>
          <div className="flex items-center justify-between text-[0.84rem]">
            <span className="font-bold text-white">交換後の残高</span>
            <span className="num text-[1.15rem] font-bold" style={{ color: SHOP_ACCENT }}>
              {after.toLocaleString()}pt
            </span>
          </div>
        </div>
      </Panel>

      <div className="mt-4">
        <Note tone="danger">
          ポイントに交換されたあとは、この商品の発送はできません。
          取り消しもできませんので、ご確認のうえお進みください。
        </Note>
      </div>

      <div className="mt-4 space-y-2.5">
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
   ⑧ 発送状況
   ══════════════════════════════════════════════ */

/** 発送の進み具合を、目で追える形にする */
const STEPS: { key: string; label: string }[] = [
  { key: "UNSHIPPED", label: "受付" },
  { key: "PREPARING", label: "準備中" },
  { key: "SHIPPED", label: "発送済み" },
  { key: "IN_TRANSIT", label: "配送中" },
  { key: "DELIVERED", label: "お届け完了" },
];

export function OrderList({
  orders,
  back,
}: {
  orders: ConsoleState["orders"];
  back: () => void;
}) {
  const sorted = useMemo(
    () => [...orders].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    [orders],
  );

  return (
    <>
      <Back onClick={back} label="マイページ" />
      <H sub="お届けの状況です。追跡番号は、発送時にお知らせします。">発送状況</H>

      {sorted.length === 0 ? (
        <Empty>現在、発送のご依頼はありません。</Empty>
      ) : (
        <ul className="space-y-3">
          {sorted.map((o) => {
            const at = STEPS.findIndex((s) => s.key === o.status);
            return (
              <li key={o.id}>
                <Panel>
                  <p className="text-[0.9rem] font-bold text-white">{o.prize}</p>

                  {/* ── 進み具合 ──
                      ★「準備中」の一言で済ませないこと。
                        どこまで進んだのかが見えないと、
                        同じ方から3日おきに同じ問い合わせが来ます */}
                  <ol className="mt-3.5 flex items-start">
                    {STEPS.map((s, i) => {
                      const done = i <= at;
                      return (
                        <li key={s.key} className="flex min-w-0 flex-1 flex-col items-center">
                          <div className="flex w-full items-center">
                            <span
                              className="h-[2px] flex-1"
                              style={{ background: i === 0 ? "transparent" : done ? SHOP_ACCENT : SHOP_EDGE }}
                            />
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ background: done ? SHOP_ACCENT : SHOP_EDGE }}
                            />
                            <span
                              className="h-[2px] flex-1"
                              style={{
                                background:
                                  i === STEPS.length - 1 ? "transparent" : i < at ? SHOP_ACCENT : SHOP_EDGE,
                              }}
                            />
                          </div>
                          <span
                            className="nb mt-1.5 text-[0.63rem] font-bold"
                            style={{ color: done ? "#BFD4FF" : "rgba(255,255,255,0.35)" }}
                          >
                            {s.label}
                          </span>
                        </li>
                      );
                    })}
                  </ol>

                  <dl className="mt-4 space-y-1.5 border-t pt-3 text-[0.79rem]" style={{ borderColor: SHOP_EDGE }}>
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
                      className="mt-3 min-h-[48px] w-full cursor-not-allowed rounded-xl px-4 text-[0.83rem] font-bold text-white/40"
                      style={{ border: `1px solid ${SHOP_EDGE}` }}
                    >
                      配送状況を見る（デモでは移動しません）
                    </button>
                  ) : (
                    <p className="mt-3 text-[0.76rem] leading-[1.85] text-white/45">
                      発送が完了しますと、追跡番号をこちらに表示します。
                    </p>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════
   ⑨ お問い合わせ
   ══════════════════════════════════════════════ */

const EXAMPLES = [
  "発送はいつになりますか？",
  "ポイントが減っている理由を知りたいです",
  "届いた商品に傷がありました",
];

export function SupportView({
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

      <Panel>
        <p className="text-[0.85rem] font-bold text-white">新しくお問い合わせをする</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="ご質問の内容をご記入ください"
          className="mt-2 w-full resize-none rounded-xl px-3 py-3 text-[0.9rem] text-white outline-none placeholder:text-white/30"
          style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${SHOP_EDGE}` }}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setText(q)}
              className="min-h-[40px] rounded-full px-3 text-[0.73rem] font-bold text-white/60"
              style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${SHOP_EDGE}` }}
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
      </Panel>

      <h3 className="mb-3 mt-6 text-[0.93rem] font-bold text-white">これまでのお問い合わせ</h3>
      {tickets.length === 0 ? (
        <Empty>まだお問い合わせはありません。</Empty>
      ) : (
        <ul className="space-y-3">
          {tickets.map((t) => {
            const tone = t.status === "DONE" ? TONE.ok : t.status === "AI_ANSWERED" ? TONE.info : TONE.warn;
            const label =
              t.status === "DONE"
                ? "解決済み"
                : t.status === "AI_ANSWERED"
                  ? "AIが回答"
                  : "運営スタッフが確認中";
            return (
              <li key={t.id}>
                <Panel>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="num text-[0.72rem] text-white/45">{t.at}</span>
                    <span
                      className="nb rounded-full px-2.5 py-1 text-[0.7rem] font-bold"
                      style={{ background: tone.bg, border: `1px solid ${tone.line}`, color: tone.fg }}
                    >
                      {label}
                    </span>
                  </div>

                  {/* お客様が送った文 */}
                  <p
                    className="mt-2 rounded-xl px-3 py-2.5 text-[0.85rem] leading-[1.85] text-white/85"
                    style={{ background: "rgba(255,255,255,0.045)" }}
                  >
                    {t.body}
                  </p>

                  {/* 返ってきた文。★誰が書いたのかを必ず出すこと */}
                  {t.reply ? (
                    <div
                      className="mt-3 rounded-xl px-3 py-3"
                      style={{ background: TONE.info.bg, border: `1px solid ${TONE.info.line}` }}
                    >
                      <p className="text-[0.72rem] font-bold" style={{ color: TONE.info.fg }}>
                        {t.replyBy === "HUMAN" ? "運営スタッフから返信" : "AIからの回答"}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-[0.85rem] leading-[1.9] text-white/85">
                        {t.reply}
                      </p>
                    </div>
                  ) : (
                    <div
                      className="mt-3 rounded-xl px-3 py-3"
                      style={{ background: TONE.warn.bg, border: `1px solid ${TONE.warn.line}` }}
                    >
                      <p className="text-[0.72rem] font-bold" style={{ color: TONE.warn.fg }}>
                        運営スタッフが確認しています
                      </p>
                      <p className="mt-1 text-[0.82rem] leading-[1.9] text-white/80">
                        {t.escalateReason ??
                          "この内容は、AIでは判断できないため運営スタッフにお繋ぎしました。"}
                      </p>
                    </div>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════
   ⑩ ポイント履歴
   ══════════════════════════════════════════════ */

export function PointHistory({
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

      <div
        className="rounded-2xl px-5 py-5"
        style={{ background: "linear-gradient(135deg, #14213D 0%, #0B1224 100%)", border: `1px solid ${SHOP_EDGE}` }}
      >
        <p className="text-[0.74rem] text-white/45">現在の保有ポイント</p>
        <p className="num mt-1 text-[2.1rem] font-bold leading-none text-white">
          {balance.toLocaleString()}
          <span className="ml-1 text-[0.9rem] font-medium text-white/60">pt</span>
        </p>
        {/* ★履歴の合計と残高が合わないなら、隠さずに出すこと。
            合わないということは、記録に残っていない増減があるということです */}
        <p
          className="mt-3 text-[0.73rem] leading-[1.8]"
          style={{ color: sum === balance ? "rgba(255,255,255,0.45)" : TONE.danger.fg }}
        >
          {sum === balance
            ? "下の履歴をすべて足すと、この残高になります。"
            : `履歴の合計（${sum.toLocaleString()}pt）と残高が一致していません。運営者が確認します。`}
        </p>
      </div>

      {list.length === 0 ? (
        <div className="mt-4">
          <Empty>まだポイントの動きはありません。</Empty>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {list.map((e) => (
            <li
              key={e.id}
              className="flex items-start justify-between gap-3 rounded-xl px-4 py-3"
              style={{ background: SHOP_SURFACE, border: `1px solid ${SHOP_EDGE}` }}
            >
              <div className="min-w-0">
                <p className="text-[0.85rem] font-bold text-white">{POINT_KIND_LABEL[e.kind]}</p>
                <p className="mt-0.5 text-[0.74rem] leading-[1.8] text-white/50">{e.memo}</p>
                <p className="num mt-0.5 text-[0.7rem] text-white/35">{e.at}</p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className="num text-[0.95rem] font-bold"
                  style={{
                    color: e.delta > 0 ? TONE.ok.fg : e.delta < 0 ? TONE.danger.fg : "rgba(255,255,255,0.5)",
                  }}
                >
                  {e.delta > 0 ? "+" : ""}
                  {e.delta.toLocaleString()}pt
                </p>
                <p className="num mt-0.5 text-[0.7rem] text-white/35">
                  残高 {e.balanceAfter.toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Missing({ back }: { back: () => void }) {
  return (
    <>
      <Back onClick={back} label="獲得商品" />
      <Note tone="danger">その商品が見つかりませんでした。</Note>
    </>
  );
}

export function MissingGacha({ back }: { back: () => void }) {
  return (
    <>
      <Back onClick={back} label="ガチャ一覧へ" />
      <Note tone="danger">そのガチャは、いま販売しておりません。</Note>
    </>
  );
}
