"use client";

/**
 * CUSTOMER PLAY DEMO — お客様が実際にガチャを引く画面。
 *
 * ★なぜ独立したセクションなのか
 *   このLPは長いあいだ「管理画面（運営者が楽になる話）」しか見せていませんでした。
 *   買う側が本当に知りたいのは、その先です。
 *   「自分のお客さんは、どんな画面で、どうやって遊ぶのか」。
 *   ここが見えないと、いくら管理画面が良くても購入の判断ができません。
 *
 * ★ここで見せる一本道（途中で切らないこと）
 *   ガチャ一覧 → 詳細 → 1回引く / 10連 → 演出 → 当選 →
 *   マイページ → 発送依頼 → AIへの問い合わせ
 *   これを1台のスマホの中で、実際に指で触って最後まで進められます。
 *
 * ★同時に、運営側の数字が動くこと
 *   お客様が500ptで引くと、運営側の残口数が1減り、売上が500増え、
 *   実還元率が計算し直されます。発送を依頼すれば未発送が1件増えます。
 *   「お客様の操作と管理画面が、ぜんぶ同じ1つのシステムにつながっている」——
 *   これがこの製品の中心なので、言葉ではなく数字の動きで見せます。
 *
 * ★デザインの決まり（重要）
 *   お客様の売り場は、管理画面と同じ見た目にしないこと。
 *   管理画面 … データを読む場所。白基調、数字と表。
 *   お客様側 … 商品を選んで買う場所。濃紺の売り場、大きな絵、ワクワク。
 *   ただし普段の画面は明るく保ち、暗く派手にするのはガチャ演出の数秒だけ。
 *   ずっと暗いと、高級な売り場ではなくゲームの画面になります。
 *
 * ★中身はすべて架空のデモです
 *   実在の商品名・写真は使いません。権利の問題に加えて、
 *   「いまこれを売っている」と誤解されるのを避けるためです。
 *   画面の中に DEMO を常時出しています。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Reveal from "../ui/Reveal";
import GachaArt from "../customer/GachaArt";
import { rank } from "@/lib/rank";
import { EV, track } from "@/lib/track";
/* ★画面に出す日本語は jp() を通す。語の途中で割れるのを止める */
import { jp } from "@/lib/jp";
import {
  BADGE_LABEL,
  CATALOG,
  bestOf,
  drawMany,
  makeRng,
  operatorView,
  pt,
  makeTicket,
  replyTicket,
  ticketCounts,
  type ArtKey,
  type DrawResult,
  type Gacha,
  type Owned,
  type Ticket,
} from "@/lib/customerDemo";

type Screen =
  | "home"
  | "detail"
  | "play"
  | "result"
  | "mypage"
  | "ship"
  | "ai"
  | "linked";

/** 演出の段階。0 暗転 → 1 光 → 2 出現 → 3 レアリティ → 結果へ */
const STAGE_MS = [420, 520, 620, 620];

const START_POINTS = 12500;
const START_UNSHIPPED = 26;

/** 一本道のどこにいるか。初めて見る人が迷子にならないための道しるべ */
const JOURNEY: { key: string; label: string; on: Screen[] }[] = [
  { key: "01", label: "ガチャ一覧", on: ["home"] },
  { key: "02", label: "ガチャ詳細", on: ["detail"] },
  { key: "03", label: "演出", on: ["play"] },
  { key: "04", label: "当選", on: ["result"] },
  { key: "05", label: "マイページ", on: ["mypage"] },
  { key: "06", label: "発送依頼", on: ["ship"] },
  { key: "07", label: "問い合わせ", on: ["ai"] },
  { key: "08", label: "運営と連動", on: ["linked"] },
];

/* ══════════════════════════════════════════════
   問い合わせで使う質問

   ★「AIが全部答えます」で終わらせないこと。
     全部AIが答える画面を見せると、頼もしいどころか不安になります。
     返金・破損・例外は、AIに決めさせてはいけない話です。
     ここでは「AIが即答する質問」と「人へ引き継ぐ質問」を
     同じ画面に並べ、どちらに転ぶかを実際に押して確かめられるようにします。
   ══════════════════════════════════════════════ */

/** 答えを作るときに参照する、いまのデモの状態 */
type AskCtx = {
  /** 保有中の点数 */
  held: number;
  /** 発送準備中の点数 */
  preparing: number;
  /** 獲得済みの合計点数 */
  total: number;
  /** 残っているポイント */
  points: number;
};

type Faq = {
  key: string;
  /** ボタンとチャットに出る質問文 */
  q: string;
  /** ボタンに出す短い名前（質問文が長いので、押す前は短く見せる） */
  chip: string;
  /** AIの答え */
  a: (c: AskCtx) => string;
  /** 答えの下に出す小さな帯（状態や根拠） */
  tag?: (c: AskCtx) => string;
  /** true なら AI は答えず、運営者へ引き継ぐ */
  escalate?: boolean;
  /** 引き継ぐとき、AIが「なぜ自分では答えないのか」を運営者に伝える理由 */
  reason?: string;
  /** 運営者の返信欄に最初から入れておく文面。人が読んで直してから送る */
  draft?: string;
};

const FAQ: Faq[] = [
  {
    key: "when",
    chip: "発送はいつですか？",
    q: "さっき当たった商品、いつ届きますか？",
    a: (c) =>
      c.preparing > 0
        ? "発送依頼を受け付けています。現在のステータスは「発送準備中」です。発送手配が完了しだい、追跡番号をマイページとメールでお知らせします。"
        : "まだ発送のご依頼がありません。マイページの「発送を依頼する」から、届けてほしい商品を選んでください。",
    tag: (c) => `STATUS：発送準備中 ${c.preparing} 点`,
  },
  {
    key: "point",
    chip: "ポイントの有効期限は？",
    q: "ポイントの有効期限を教えてください。",
    a: () =>
      "最後にポイントを獲得または利用した日から1年間ご利用いただけます。期限が近づいた場合は、マイページとメールでお知らせします。",
    tag: (c) => `保有ポイント ${c.points.toLocaleString("ja-JP")} pt`,
  },
  {
    key: "odds",
    chip: "ガチャの確率は？",
    q: "ガチャの確率はどこで確認できますか？",
    a: () =>
      "各賞の残り本数と確率は、ガチャ詳細ページに常時掲載しています。表示している本数は在庫の実数で、引かれるたびに更新されます。",
    tag: () => "確率表：ガチャ詳細ページに掲載",
  },
  {
    key: "address",
    chip: "発送先を確認したい",
    q: "登録している発送先を確認したいです。",
    a: () =>
      "ご登録の住所は「東京都◯◯区◯◯ 1-2-3 ◯◯マンション 101（デモ）」です。変更はマイページの住所設定から行えます。",
    tag: () => "会員ID GD-0001（デモ）",
  },
  {
    key: "owned",
    chip: "当選商品を確認したい",
    q: "これまでに当たった商品を確認したいです。",
    a: (c) =>
      `現在 ${c.total} 点を獲得済みです。うち ${c.held} 点が保有中、${c.preparing} 点が発送準備中です。明細はマイページの獲得商品からご確認いただけます。`,
    tag: (c) => `獲得 ${c.total} 点 / 発送準備中 ${c.preparing} 点`,
  },
  {
    key: "refund",
    chip: "商品に傷があった",
    q: "届いた商品に傷があったので、返金できますか？",
    a: () =>
      "この内容は個別確認が必要です。運営スタッフへ引き継ぎます。担当者から、ご登録のメールアドレスへご連絡します。",
    tag: () => "受付番号 CS-0001（デモ）",
    escalate: true,
    reason: "個別の商品状態確認が必要",
    /*
      ★下書きを入れておく理由
        人へ渡すだけなら、渡された側は白紙から書くことになります。
        それでは「AIが仕事を投げただけ」です。
        AIは答えを決めない代わりに、定型の部分まで用意しておきます。
        最終的に何を送るかを決めるのは、必ず人です。
    */
    draft:
      "商品の状態を確認いたします。お手数ですが、傷のある箇所の写真を添付のうえ、発送コードをお知らせください。",
  },
];

/** チャットの1往復 */
type Turn = {
  id: string;
  q: string;
  /** 答えが決まる前は空。決まったら入る */
  a: string;
  tag: string;
  mode: "auto" | "escalate";
  /** 人へ渡した件だけ付く受付番号。運営画面のチケットと同じもの */
  ticket?: string;
  /** 運営スタッフが送った返信。届くまでは空 */
  staff?: string;
};

/**
 * マイページの「これまでに獲得した商品」。
 *
 * ★空のマイページを見せないこと。
 *   最初、引く前のマイページを空にしていたところ、
 *   引いた直後に1行だけ並ぶ画面になり、下が3分の2ほど真っ白でした。
 *   本物のマイページには、前に当てた分が必ず残っています。
 *   ステータスも「保有中」だけでなく「発送準備中」まで並んでいる方が、
 *   発送までつながっていることが、説明しなくても伝わります。
 */
const OWNED_SEED: Owned[] = [
  {
    key: "seed-1",
    rank: "B",
    name: "レアカード（デモ）",
    pt: 4200,
    art: "card",
    at: "2026/08/21 21:04",
    status: "held",
  },
  {
    key: "seed-2",
    rank: "C",
    name: "オリジナルソックス（デモ）",
    pt: 360,
    art: "sneaker",
    at: "2026/08/19 12:38",
    status: "preparing",
  },
  {
    key: "seed-3",
    rank: "C",
    name: "スタンダードカード（デモ）",
    pt: 220,
    art: "card",
    at: "2026/08/19 12:38",
    status: "held",
  },
];

export default function CustomerPlay() {
  const reduce = useReducedMotion() ?? false;

  /* ── お客様側の状態 ── */
  const [screen, setScreen] = useState<Screen>("home");
  const [gachaId, setGachaId] = useState(CATALOG[0].id);
  const [shop, setShop] = useState<Gacha[]>(CATALOG);
  const [points, setPoints] = useState(START_POINTS);
  const [owned, setOwned] = useState<Owned[]>(OWNED_SEED);
  const [results, setResults] = useState<DrawResult[]>([]);
  const [stage, setStage] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [shipStep, setShipStep] = useState<"list" | "address" | "done">("list");
  /** 問い合わせのやり取り。押した順に下へ積む */
  const [chat, setChat] = useState<Turn[]>([]);
  /** AIが考えている最中かどうか。連打で会話が壊れないようにする */
  const [thinking, setThinking] = useState(false);

  /* ── 運営側の状態（お客様の操作でのみ動く） ── */
  const [unshipped, setUnshipped] = useState(START_UNSHIPPED);
  /*
    ★「要確認 1件」を、ただの数え札にしないこと。
      中身（誰が、何を聞いて、AIがなぜ答えなかったか）を持たせておくと、
      運営者はその場で読んで、その場で返信できます。
      数だけ持っていた頃は、押しても何も出ない飾りでした。
  */
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const counts = ticketCounts(tickets);
  const needCheck = counts.open;
  /** 数字が動いた瞬間だけ光らせるための印 */
  const [pulse, setPulse] = useState(0);

  /*
    抽選の種。
    ★固定の種のままにしないこと。
      固定にすると、誰が見ても必ず同じ賞が出ます。
      「決まった結果を再生しているだけ」と受け取られたら、
      本当に抽選していても、それを証明する手立てがなくなります。

    ★ただし、出やすさに手心を加えないこと。
      種を変えるだけで、確率そのものは在庫どおりです。
      デモで良い賞を出やすくするのは、景品表示法の観点でも、
      商売の筋としても、やってはいけないことです。
  */
  const seed = useRef(20260822);
  useEffect(() => {
    seed.current = Math.floor(Math.random() * 2 ** 31);
  }, []);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => () => clear(), [clear]);

  const gacha = shop.find((g) => g.id === gachaId) ?? shop[0];
  const base = CATALOG.find((g) => g.id === gachaId) ?? CATALOG[0];
  const op = useMemo(
    () => operatorView(gacha, base, unshipped),
    [gacha, base, unshipped],
  );

  /* ═════ 引く ═════ */
  const play = (count: number) => {
    const cost = gacha.price * count;
    if (points < cost || gacha.left < count) return;

    const rng = makeRng(seed.current);
    seed.current += 977;
    const { results: rs, next } = drawMany(gacha, count, rng);

    setResults(rs);
    setShop((s) => s.map((g) => (g.id === gachaId ? next : g)));
    setPoints((p) => p - cost);
    setOwned((o) => [
      ...rs.map((r, i) => ({
        key: `${seed.current}-${i}`,
        rank: r.rank,
        name: r.name,
        pt: r.pt,
        art: gacha.art,
        /* 今この場で引いた分。時計の文字より「たった今」の方が、実感が伝わります */
        at: "たった今",
        status: "held" as const,
      })),
      ...o,
    ]);
    setPulse((n) => n + 1);
    track(EV.playDraw, { count });

    setScreen("play");
    setStage(0);
    clear();
    if (reduce) {
      timers.current.push(setTimeout(() => setScreen("result"), 260));
      return;
    }
    let t = 0;
    STAGE_MS.forEach((ms, i) => {
      t += ms;
      timers.current.push(setTimeout(() => setStage(i + 1), t));
    });
    timers.current.push(setTimeout(() => setScreen("result"), t + 120));
  };

  /** 演出を飛ばす。何度も引く人がここで嫌にならないように、必ず用意する */
  const skip = () => {
    clear();
    setScreen("result");
  };

  /* ═════ 発送を依頼する ═════ */
  const requestShip = () => {
    setOwned((o) =>
      o.map((x) =>
        picked.includes(x.key) ? { ...x, status: "preparing" as const } : x,
      ),
    );
    setUnshipped((n) => n + picked.length);
    setShipStep("done");
    setPulse((n) => n + 1);
    track(EV.playComplete, { items: picked.length });
  };

  /* ═════ AIに聞く ═════

     ★ここは「AIがどこまでやるか」を見せる場所です。
       答えが決まっている質問はAIが即答し、
       返金のように判断が要る質問は、AIが答えずに人へ渡す。
       この2つが同じ画面で起きることが、いちばん大事です。 */
  const ask = (f: Faq) => {
    if (thinking) return;

    const ctx: AskCtx = {
      held: owned.filter((o) => o.status === "held").length,
      preparing: owned.filter((o) => o.status !== "held").length,
      total: owned.length,
      points,
    };
    const id = `${f.key}-${chat.length}`;

    /* 人へ渡す件は、この場で受付番号を決める。お客様と運営者に同じ番号を出す */
    const ticket = f.escalate
      ? makeTicket(tickets.length + 1, f.q, f.reason ?? "", f.draft ?? "")
      : null;

    setChat((c) => [
      ...c,
      {
        id,
        q: f.q,
        a: "",
        tag: "",
        mode: f.escalate ? "escalate" : "auto",
        ticket: ticket?.id,
      },
    ]);
    setThinking(true);
    clear();

    timers.current.push(
      setTimeout(
        () => {
          setChat((c) =>
            c.map((t) =>
              t.id === id
                ? {
                    ...t,
                    a: f.a(ctx),
                    /* 受付番号は本文に書かず、実際に採番したものを出す */
                    tag: ticket
                      ? `受付番号 ${ticket.id}（デモ）`
                      : (f.tag?.(ctx) ?? ""),
                  }
                : t,
            ),
          );
          setThinking(false);
          /*
            ★引き継ぎは、画面の言葉だけで終わらせないこと。
              運営者側の「要確認」を実際に1件増やします。
              言葉だけなら、あとから何とでも書けます。
          */
          if (ticket) {
            setTickets((ts) => [...ts, ticket]);
            setPulse((n) => n + 1);
          }
          track(EV.playAsk, { q: f.key, mode: f.escalate ? "escalate" : "auto" });
        },
        reduce ? 200 : 850,
      ),
    );
  };

  /* ═════ 運営者が返信する ═════

     ★ここが、このデモのいちばん最後のひと押しです。
       「AIが人へ渡しました」で画面を終わらせると、
       見ている人の頭には「で、そのあと誰がやるの？」が残ります。
       渡された運営者がその場で読んで、書いて、送る。
       送った瞬間にお客様のスマホへ出て、要確認が1件減る。
       ここまで見せて、はじめて一周です。

     ★数の増減は lib/customerDemo.ts の replyTicket に任せています。
       画面の中で数を足し引きすると、表示と実体がずれます。 */
  const sendReply = (id: string, body: string) => {
    const text = body.trim();
    if (!text) return;

    setTickets((ts) => replyTicket(ts, id, text));
    /* 同じ返信を、お客様側のやり取りにも差し込む */
    setChat((c) =>
      c.map((t) => (t.ticket === id && !t.staff ? { ...t, staff: text } : t)),
    );
    setPulse((n) => n + 1);
    track(EV.playAsk, { q: "operator_reply", mode: "reply" });
  };

  /** いまAIがどちらに振り分けたか。データの流れ図を光らせるのに使う */
  const route: "idle" | "thinking" | "auto" | "escalate" = thinking
    ? "thinking"
    : chat.length === 0
      ? "idle"
      : chat[chat.length - 1].mode;

  /* ═════ 最初から ═════ */
  const restart = () => {
    clear();
    setScreen("home");
    setGachaId(CATALOG[0].id);
    setShop(CATALOG);
    setPoints(START_POINTS);
    setOwned(OWNED_SEED);
    setResults([]);
    setPicked([]);
    setShipStep("list");
    setChat([]);
    setThinking(false);
    setUnshipped(START_UNSHIPPED);
    setTickets([]);
    setPulse(0);
  };

  const step = JOURNEY.findIndex((j) => j.on.includes(screen));

  return (
    <section
      id="play"
      className="relative scroll-mt-24 overflow-hidden bg-white py-11 sm:py-24 lg:py-36"
    >
      <div className="pointer-events-none absolute inset-0 grid-lite opacity-40 [mask-image:radial-gradient(ellipse_at_50%_6%,#000_12%,transparent_72%)]" />

      <div className="container-wide relative">
        {/* ───────── 見出し ───────── */}
        <Reveal>
          <div className="mx-auto max-w-4xl text-center">
            {/*
              ★ここに「SECTION 06」と出さないこと（2026-08-22 に外しました）。

                このセクションは、直前の CUSTOMER SIDE（SECTION 05）と
                2つで1章です。承認した瞬間にお客様の画面へ出るところ（05）と、
                そのお客様が実際に引いて発送を頼むところ（ここ）は、
                同じ「お客様から見た売り場」の話だからです。

                番号を振ると、読む人には章が1つ増えたように見えます。
                実際そのせいで後ろの番号が全部ずれ、06 と 07 が
                ページの中で2回ずつ出ていました。番号は増やさず、名前で分けます。
            */}
            <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2">
              <span className="eyebrow-lite">CUSTOMER PLAY DEMO</span>
            </div>
            {/*
              ★手で改行を置いています。ブラウザ任せにしないこと。
                「お客様には、」で一度切ると、次の「こう見えます。」が強く立ちます。
            */}
            <h2 className="h-display mt-4 text-h2 text-balance text-slate sm:mt-6">
              <span className="inline-block">お客様には、</span>
              <span className="inline-block">こう見えます。</span>
            </h2>
            {/*
              ★「こう見えます」の次に、いちばん強い一文を置くこと。
                この製品の値打ちは、管理画面の出来ではなく、
                管理画面とお客様の画面が1つにつながっていることです。
            */}
            <p className="mx-auto mt-5 max-w-[36em] text-body text-pretty text-slate2 sm:mt-7">
              {jp(
                "管理画面だけではありません。実際にお客様が遊ぶ画面まで、1つにつながっています。下のスマホは画像ではありません。そのまま引いて、当選して、発送依頼と問い合わせまで進められます。",
              )}
            </p>
          </div>
        </Reveal>

        {/* ───────── いまどこにいるか ───────── */}
        <Reveal delay={0.04}>
          <ol className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-1.5 sm:mt-10 sm:gap-2">
            {JOURNEY.map((j, i) => {
              const now = i === step;
              const done = step > i;
              return (
                <li key={j.key}>
                  <span
                    className={`num flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[11px] tracking-[0.1em] transition-colors duration-300 ${
                      now
                        ? "border-blue-ink/30 bg-blue-ink text-white"
                        : done
                          ? "border-blue-ink/20 bg-blue-pale text-blue-ink"
                          : "border-edge bg-paper2 text-slate3"
                    }`}
                  >
                    <b className="font-bold">{j.key}</b>
                    {j.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </Reveal>

        {/* ───────── スマホ ＋ 運営画面 ─────────
            ★スマホを先に置いています。
              このセクションの主役はお客様の画面なので、
              狭い画面では必ずスマホが最初に来ること。 */}
        <div
          data-play-stage=""
          className="mt-8 grid gap-5 sm:mt-12 lg:mt-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-start lg:gap-8"
        >
          {/* ── 左（PCのみ左）：運営者の画面 ── */}
          <div className="order-2 lg:order-1">
            <OperatorMirror
              title={gacha.title}
              view={op}
              tickets={tickets}
              pulse={pulse}
              reduce={reduce}
              onReply={sendReply}
            />
          </div>

          {/* ── 右：お客様のスマホ ── */}
          <div className="order-1 lg:order-2">
            <Phone
              screen={screen}
              stage={stage}
              reduce={reduce}
              points={points}
              shop={shop}
              gacha={gacha}
              results={results}
              owned={owned}
              picked={picked}
              shipStep={shipStep}
              chat={chat}
              thinking={thinking}
              unshipped={unshipped}
              needCheck={needCheck}
              answered={counts.answered}
              view={op}
              onOpen={(id) => {
                setGachaId(id);
                setScreen("detail");
              }}
              onHome={() => setScreen("home")}
              onPlay={play}
              onSkip={skip}
              onMypage={() => setScreen("mypage")}
              onShip={() => {
                setPicked(
                  owned.filter((o) => o.status === "held").map((o) => o.key),
                );
                setShipStep("list");
                setScreen("ship");
              }}
              onTogglePick={(k) =>
                setPicked((p) =>
                  p.includes(k) ? p.filter((x) => x !== k) : [...p, k],
                )
              }
              onShipStep={setShipStep}
              onRequestShip={requestShip}
              onAi={() => setScreen("ai")}
              onAsk={ask}
              onLinked={() => setScreen("linked")}
              onRestart={restart}
            />
          </div>
        </div>

        {/* ───────── AIと人の分かれ道 ───────── */}
        <Reveal delay={0.05} className="mt-5 sm:mt-8">
          <CoreRoute
            route={route}
            needCheck={needCheck}
            answered={counts.answered}
            reduce={reduce}
          />
        </Reveal>

        {/* ───────── 説明 ───────── */}
        <Reveal delay={0.06} className="mt-6 sm:mt-10">
          <div className="grid gap-3 lg:grid-cols-3">
            {[
              {
                t: "お客様の操作が、そのまま運営の数字になる",
                b: jp(
                  "1回引かれるたびに残り口数が減り、売上が増え、実還元率が計算し直されます。日次で集計しているのではなく、その場で反映されます。",
                ),
              },
              {
                t: "発送依頼も、同じ流れで管理画面へ",
                b: jp(
                  "お客様が発送を依頼すると、運営側の未発送が1件増えます。メールを見て手で転記する作業は要りません。",
                ),
              },
              {
                t: "AIが答え、人が返し、お客様へ戻る",
                b: jp(
                  "発送状況のような質問はAIが即答します。返金や破損だけが要確認として残り、運営者がその場で返信すると、お客様のスマホにそのまま届きます。",
                ),
              },
            ].map((c) => (
              <div key={c.t} className="lp-card p-5 sm:p-7">
                <p className="text-note font-bold text-pretty text-slate">
                  {c.t}
                </p>
                <p className="mt-3 text-note text-pretty leading-[1.95] text-slate2">
                  {c.b}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* ───────── 新規と既存、それぞれへの一言 ───────── */}
        <Reveal delay={0.08} className="mt-4 sm:mt-6">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-3xl border border-edge bg-white p-6 shadow-lift sm:p-9">
              <span className="eyebrow-lite">これから始める方へ</span>
              <p className="mt-4 text-h3 font-bold text-balance text-slate">
                <span className="inline-block">
                  「管理画面を作る」だけでは
                </span>
                <span className="inline-block">ありません。</span>
              </p>
              <p className="mt-4 text-note text-pretty leading-[1.95] text-slate2">
                {jp(
                  "お客様がガチャを選び、引き、当選し、発送を依頼するところまでが1つのシステムです。売り場を別に作る必要はありません。",
                )}
              </p>
            </div>

            <div className="lp-tint rounded-3xl p-6 sm:p-9">
              <span className="eyebrow-lite">すでに運営している方へ</span>
              <p className="mt-4 text-h3 font-bold text-balance text-slate">
                <span className="inline-block">お客様側はそのまま、</span>
                <span className="inline-block">裏側だけを入れ替える。</span>
              </p>
              <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                {[
                  {
                    k: "CUSTOMER 側",
                    v: "いままでのブランド",
                    n: "デザイン・ドメイン・会員は引き継げます",
                  },
                  {
                    k: "OPERATOR 側",
                    v: "AI GACHA OS",
                    n: "設計・還元率の監視・発送・問い合わせを置き換えます",
                  },
                ].map((r) => (
                  <div
                    key={r.k}
                    className="rounded-2xl border border-edge2 bg-white/70 p-4"
                  >
                    <p className="num text-[11px] tracking-[0.16em] text-slate3">
                      {r.k}
                    </p>
                    <p className="mt-2 text-note font-bold text-pretty text-slate">
                      {r.v}
                    </p>
                    <p className="mt-1.5 text-note text-pretty text-slate2">
                      {r.n}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        {/* ───────── 締めとCTA ───────── */}
        <Reveal delay={0.1} className="mt-4 sm:mt-6">
          <div className="rounded-3xl border border-edge bg-white px-6 py-9 shadow-lift sm:px-10 sm:py-11">
            <p className="h-display text-h3 text-balance text-slate">
              <span className="inline-block">ガチャを作るところから、</span>
              <span className="inline-block">お客様が引くところまで。</span>
              <span className="inline-block">
                その後の発送・問い合わせまで、
              </span>
              <span className="inline-block">1つのOSでつながります。</span>
            </p>
            <p className="mt-5 max-w-[42em] text-note text-pretty leading-[1.95] text-slate2">
              {jp(
                "上の画面は、標準機能の範囲で作ったデモです。デザインや演出は、扱う商品に合わせて調整します。表示している商品名・数字はすべて架空のもので、実績値ではありません。",
              )}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/demo?side=customer"
                className="btn-primary w-full sm:w-auto"
                onClick={() =>
                  track(EV.ctaClick, {
                    place: "customer_play",
                    target: "customer_demo",
                  })
                }
              >
                お客様側のガチャを体験する
              </Link>
              <Link
                href="/demo"
                className="btn-outline w-full sm:w-auto"
                onClick={() =>
                  track(EV.ctaClick, {
                    place: "customer_play",
                    target: "operator_demo",
                  })
                }
              >
                運営者側の管理画面を触る
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════
   運営者の画面（お客様の操作を映す鏡）
   ══════════════════════════════════════════════ */

function OperatorMirror({
  title,
  view,
  tickets,
  pulse,
  reduce,
  onReply,
}: {
  title: string;
  view: ReturnType<typeof operatorView>;
  tickets: Ticket[];
  pulse: number;
  reduce: boolean;
  onReply: (id: string, body: string) => void;
}) {
  const rtpBad = view.realRtp >= 105;
  const { open, answered } = ticketCounts(tickets);

  /** いま開いている件。押すまでは閉じておく（本物の管理画面と同じ） */
  const [openId, setOpenId] = useState<string | null>(null);
  const current = tickets.find((t) => t.id === openId) ?? null;
  return (
    /* data-play-mirror … スクリーンショットの目印。消さないこと */
    <div
      data-play-mirror=""
      className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift2"
    >
      <div className="flex items-center justify-between border-b border-edge2 bg-paper2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/55" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-ok/60" />
          <span className="num ml-2 truncate text-[11px] tracking-[0.14em] text-slate3">
            OPERATOR / 販売状況
          </span>
        </div>
        <span className="num shrink-0 text-[10px] tracking-[0.2em] text-slate3">
          DEMO
        </span>
      </div>

      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-note font-bold text-pretty text-slate">{title}</p>
          <span className="num whitespace-nowrap rounded-full border border-ok-ink/25 bg-ok/10 px-2.5 py-1 text-[11px] tracking-[0.16em] text-ok-ink">
            公開中
          </span>
        </div>

        {/*
          ★ここが「つながっている」ことの証拠になる場所です。
            お客様が引いた瞬間に、この4つが同時に動きます。
            動いたことが分かるよう、変わった直後だけ枠を光らせています。
        */}
        <dl className="mt-5 grid grid-cols-2 gap-2.5">
          <Metric
            k="残り口数"
            v={view.left.toLocaleString("ja-JP")}
            unit="口"
            pulse={pulse}
            reduce={reduce}
          />
          <Metric
            k="このデモ中の売上"
            v={view.revenue.toLocaleString("ja-JP")}
            unit="pt"
            pulse={pulse}
            reduce={reduce}
          />
          <Metric
            k="実還元率（残数ベース）"
            v={view.realRtp.toFixed(1)}
            unit="%"
            pulse={pulse}
            reduce={reduce}
            tone={rtpBad ? "warn" : "ok"}
          />
          <Metric
            k="未発送"
            v={String(view.unshipped)}
            unit="件"
            pulse={pulse}
            reduce={reduce}
          />
        </dl>

        {/*
          ★「要確認 1件」を、押せない札にしないこと。
            押しても何も出ない数字は、見ている人にとって
            「1件あるらしい、で、そのあとは？」で終わります。
            ここを押すと中身が開き、その場で返信できるところまで見せます。
        */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-play-op="ticket"
            disabled={tickets.length === 0}
            onClick={() =>
              setOpenId((v) =>
                v ? null : (tickets.find((t) => t.status === "open") ?? tickets[0]).id,
              )
            }
            className={`num inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] tracking-[0.14em] transition-colors duration-500 disabled:cursor-default ${
              open > 0
                ? "border-warn/45 bg-warn/10 text-warn-ink"
                : "border-edge bg-paper2 text-slate3"
            }`}
          >
            要確認 {open} 件
            {tickets.length > 0 && (
              <span className="text-[9px] opacity-70">
                {current ? "閉じる" : "開く"}
              </span>
            )}
          </button>

          {answered > 0 && (
            <motion.span
              initial={reduce ? false : { scale: 1.1, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              data-play-op="done"
              className="num whitespace-nowrap rounded-full border border-ok-ink/30 bg-ok/10 px-3 py-1.5 text-[11px] tracking-[0.14em] text-ok-ink"
            >
              対応済み {answered} 件
            </motion.span>
          )}

          <span className="text-note text-slate3">
            {tickets.length === 0
              ? jp("AIが答えられない相談だけが、ここに残ります。")
              : open > 0
                ? jp("押すと中身が開きます。この画面から返信できます。")
                : jp("返信が済んだ件は、要確認から外れます。")}
          </span>
        </div>

        {/* ── 問い合わせの中身と、運営者の返信欄 ── */}
        <AnimatePresence initial={false}>
          {current && (
            <TicketPanel
              key={current.id}
              t={current}
              reduce={reduce}
              onSend={(body) => onReply(current.id, body)}
              onClose={() => setOpenId(null)}
            />
          )}
        </AnimatePresence>

        <p className="mt-5 border-t border-edge2 pt-4 text-note leading-[1.9] text-slate3">
          {jp(
            "スマホ側を操作すると、この数字がその場で動きます。集計を待つ必要はありません。",
          )}
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   運営画面：問い合わせの中身と返信欄

   ★AIが人へ渡したあとを、必ず見せること。
     ここが無かったとき、デモは
       お客様が相談する → AIが「人が確認します」と言う → 要確認 +1
     で止まっていました。買う人が本当に知りたいのはその先です。
       ・渡された運営者は、何を見て判断するのか
       ・返信は、どこに書いて、どこへ届くのか
       ・返したあと、その件は画面からどう消えるのか

   ★AIの下書きを入れておくこと。ただし送信は必ず人の操作にすること。
     文面まで自動で送ってしまうと、この製品の売りである
     「判断が要ることは人が決める」が崩れます。
   ══════════════════════════════════════════════ */

function TicketPanel({
  t,
  reduce,
  onSend,
  onClose,
}: {
  t: Ticket;
  reduce: boolean;
  onSend: (body: string) => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState(t.draft);
  const done = t.status === "answered";

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={reduce ? undefined : { opacity: 0, height: 0 }}
      transition={{ duration: 0.32 }}
      data-play-ticket=""
      className="overflow-hidden"
    >
      <div
        className={`mt-3 rounded-2xl border p-4 ${
          done ? "border-ok-ink/25 bg-ok/[0.05]" : "border-warn/40 bg-warn/[0.05]"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="num whitespace-nowrap text-[11px] tracking-[0.16em] text-slate3">
            INQUIRY <b className="font-bold text-slate">{t.id}</b>
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`num whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] tracking-[0.12em] ${
                done
                  ? "border-ok-ink/30 bg-ok/10 text-ok-ink"
                  : "border-warn/45 bg-warn/12 text-warn-ink"
              }`}
            >
              {done ? "ANSWERED" : "OPEN"}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="num whitespace-nowrap rounded-full border border-edge bg-white px-2.5 py-1 text-[10px] tracking-[0.1em] text-slate3"
            >
              閉じる
            </button>
          </div>
        </div>

        {/* ① お客様が書いた内容 */}
        <div className="mt-3.5 rounded-xl border border-edge2 bg-white px-3.5 py-3">
          <p className="num text-[10px] tracking-[0.14em] text-slate3">
            ユーザー
          </p>
          <p className="mt-1.5 text-note leading-[1.85] text-pretty text-slate">
            {jp(t.q)}
          </p>
        </div>

        {/* ② AIの判定と、その理由 */}
        <div className="mt-2 rounded-xl border border-edge2 bg-white px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <p className="num text-[10px] tracking-[0.14em] text-slate3">
              AI判定
            </p>
            <span className="num nb whitespace-nowrap rounded-full border border-warn/45 bg-warn/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] text-warn-ink">
              {t.verdict}
            </span>
          </div>
          <p className="mt-2 text-note leading-[1.85] text-pretty text-slate2">
            理由：{jp(t.reason)}
          </p>
        </div>

        {/* ③ 運営者の返信 */}
        {done ? (
          <div className="mt-2 rounded-xl border border-ok-ink/25 bg-white px-3.5 py-3">
            <p className="num text-[10px] tracking-[0.14em] text-ok-ink">
              運営スタッフの返信 — 送信済み
            </p>
            <p className="mt-1.5 text-note leading-[1.85] text-pretty text-slate">
              {jp(t.reply)}
            </p>
            <p className="mt-2.5 text-note leading-[1.85] text-pretty text-slate3">
              {jp(
                "この返信は、お客様のスマホの問い合わせ画面にそのまま出ています。要確認からは外れ、対応済みへ移りました。",
              )}
            </p>
          </div>
        ) : (
          <div className="mt-2">
            <label className="num block text-[10px] tracking-[0.14em] text-slate3">
              返信内容
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="mt-1.5 w-full resize-none rounded-xl border border-edge bg-white px-3.5 py-3 text-note leading-[1.85] tracking-normal text-slate outline-none focus:border-blue-ink/45"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                data-play-op="send"
                disabled={!body.trim()}
                onClick={() => onSend(body)}
                className="num whitespace-nowrap rounded-xl bg-blue-ink px-5 py-2.5 text-[12px] font-bold tracking-[0.1em] text-white shadow-blue-lift disabled:opacity-45"
              >
                SEND
              </button>
              <span className="text-note text-pretty text-slate3">
                {jp("AIが下書きまで用意し、送るかどうかは人が決めます。")}
              </span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Metric({
  k,
  v,
  unit,
  pulse,
  reduce,
  tone = "plain",
}: {
  k: string;
  v: string;
  unit: string;
  pulse: number;
  reduce: boolean;
  tone?: "plain" | "ok" | "warn";
}) {
  const ink =
    tone === "warn" ? "text-warn-ink" : tone === "ok" ? "text-ok-ink" : "text-slate";
  return (
    <motion.div
      key={`${k}-${pulse}`}
      initial={reduce || pulse === 0 ? false : { borderColor: "rgba(27,75,216,0.55)" }}
      animate={{ borderColor: "rgba(11,18,32,0.06)" }}
      transition={{ duration: 1.1 }}
      className="rounded-xl border border-edge2 bg-paper2 px-3.5 py-3"
    >
      <dt className="text-note text-pretty text-slate3">{k}</dt>
      {/*
        ★数字と単位を横に並べたまま固定しないこと。
          狭い枠では入りきらず、単位が枠の外へ出ます。
          入らないときは単位を次の行へ落とします。
      */}
      <dd
        className={`num-lead mt-1.5 flex flex-wrap items-baseline gap-x-1 text-[19px] font-bold leading-none ${ink}`}
      >
        {v}
        <span className="text-[13px] font-semibold opacity-70">{unit}</span>
      </dd>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════
   AIと人の分かれ道（データの流れ）

   ★このLPで、いちばん誤解されやすいところを打ち消す場所です。
     「AIが全部やります」と言うと、便利そうに聞こえる一方で、
     「返金の判断までAIがするのか」という不安が必ず残ります。
     だから、流れの真ん中に判定を置いて、
     AUTO ANSWER と ESCALATE の2本に分かれるところを見せます。

   ★飾りの図にしないこと。
     右側の「要確認」は、実際にスマホで返金の相談を押したときだけ増えます。
     押していないのに 1 と書いてある図は、ただの絵です。
   ══════════════════════════════════════════════ */

function CoreRoute({
  route,
  needCheck,
  answered,
  reduce,
}: {
  route: "idle" | "thinking" | "auto" | "escalate";
  needCheck: number;
  answered: number;
  reduce: boolean;
}) {
  const auto = route === "auto";
  const esc = route === "escalate";
  const busy = route === "thinking";

  return (
    <div
      data-play-route=""
      className="overflow-hidden rounded-3xl border border-edge bg-white p-6 shadow-lift sm:p-9"
    >
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span className="eyebrow-lite">AI ROUTING</span>
        <span className="hidden h-px w-8 bg-edge sm:block" />
        {/*
          ★ここを whitespace-nowrap の1本にしないこと。
            390px では「→ CUSTOMER」が枠の外へ出て、
            戻ってくるところだけが見えなくなります（実際にそうなりました）。
            折れてよい場所を作り、語の途中では折れないようにします。
        */}
        <span className="num text-label text-slate3">
          <span className="nb">CUSTOMER → CORE → OPERATOR</span>{" "}
          <span className="nb">→ CUSTOMER</span>
        </span>
      </div>

      <h3 className="h-display mt-4 text-h3 text-balance text-slate">
        <span className="inline-block">AIが答えられることはAIへ。</span>
        <span className="inline-block">判断が必要なことは、人へ。</span>
        <br />
        {/*
          ★この一文を消さないこと。
            「人へ渡します」までで止めた図は、渡されたあとが見えません。
            買う人が心配しているのは、渡されたあとに誰が何をするかです。
        */}
        <span className="text-gradient-royal inline-block">
          そして、人の回答も同じ画面からお客様へ。
        </span>
      </h3>

      <div className="mt-7 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] lg:items-stretch">
        {/* ① お客様のスマホ */}
        <RouteBox
          code="01"
          head="CUSTOMER PHONE"
          title="お客様が問い合わせる"
          body="発送のこと、ポイントのこと、返金のこと。入口は1つです。"
          on={route !== "idle"}
        />

        {/* ② CORE ── 判定 */}
        <div
          className={`relative rounded-2xl border p-5 transition-colors duration-500 ${
            route === "idle"
              ? "border-edge bg-paper2"
              : "border-blue-ink/25 bg-blue-pale"
          }`}
        >
          <p className="num text-[11px] tracking-[0.16em] text-slate3">
            02<span className="nb ml-2">AI GACHA OS CORE</span>
          </p>
          <p className="mt-2.5 text-note font-bold text-pretty text-slate">
            AIが、答えられるかどうかを判定する
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <RouteVerdict
              label="AUTO ANSWER"
              jaLabel="AIが即答"
              tone="ok"
              on={auto}
              reduce={reduce}
            />
            <RouteVerdict
              label="ESCALATE"
              jaLabel="人へ引き継ぎ"
              tone="warn"
              on={esc}
              reduce={reduce}
            />
          </div>

          <p className="mt-3.5 text-note leading-[1.9] text-pretty text-slate2">
            {busy
              ? jp("判定しています…")
              : auto
                ? jp(
                    "答えが決まっている質問でした。AIがその場で答え、運営者の手は動きません。",
                  )
                : esc
                  ? jp(
                      "返金・破損のような、判断が必要な相談でした。AIは答えを出さずに運営者へ渡します。",
                    )
                  : jp(
                      "スマホの問い合わせ画面で質問を押すと、ここでどちらに振り分けられたかが分かります。",
                    )}
          </p>
        </div>

        {/* ③ 運営者のPC */}
        <div
          className={`rounded-2xl border p-5 transition-colors duration-500 ${
            needCheck > 0
              ? "border-warn/45 bg-warn/[0.06]"
              : "border-edge bg-paper2"
          }`}
        >
          <p className="num text-[11px] tracking-[0.16em] text-slate3">
            03<span className="nb ml-2">OPERATOR PC</span>
          </p>
          <p className="mt-2.5 text-note font-bold text-pretty text-slate">
            人が見るのは、残ったものだけ
          </p>
          <motion.p
            key={needCheck}
            initial={reduce || needCheck === 0 ? false : { scale: 1.12 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.45 }}
            className={`num mt-4 inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-bold tracking-[0.08em] ${
              needCheck > 0
                ? "border-warn/50 bg-warn/12 text-warn-ink"
                : "border-edge bg-white text-slate3"
            }`}
          >
            要確認
            <b className="text-[19px] font-extrabold">{needCheck}</b>件
          </motion.p>
          <p className="mt-3.5 text-note leading-[1.9] text-pretty text-slate2">
            {jp(
              "AIが答えた分は、ここに残りません。運営者が読むのは、判断が要るものだけになります。件名を押すと中身が開き、その場で返信できます。",
            )}
          </p>
        </div>
      </div>

      {/* ── ④ 人の回答が、お客様へ戻る ──
          ★図をここで終わらせないこと。
            01→02→03 だけだと「人へ渡した」で話が切れます。
            渡された人が返信し、それがお客様の画面に出て、
            運営画面の要確認が減る。ここまでで、ようやく一周です。 */}
      <div
        className={`mt-3 rounded-2xl border p-5 transition-colors duration-500 ${
          answered > 0 ? "border-ok-ink/30 bg-ok/[0.06]" : "border-edge bg-paper2"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <p className="num text-[11px] tracking-[0.16em] text-slate3">
            04<span className="nb ml-2">BACK TO CUSTOMER</span>
          </p>
          <motion.span
            key={answered}
            initial={reduce || answered === 0 ? false : { scale: 1.12 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.45 }}
            className={`num inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-bold tracking-[0.08em] ${
              answered > 0
                ? "border-ok-ink/35 bg-ok/12 text-ok-ink"
                : "border-edge bg-white text-slate3"
            }`}
          >
            対応済み
            <b className="text-[19px] font-extrabold">{answered}</b>件
          </motion.span>
        </div>
        <p className="mt-2.5 text-note font-bold text-pretty text-slate">
          運営者が書いた返信が、そのままお客様のスマホへ
        </p>
        <p className="mt-2.5 text-note leading-[1.9] text-pretty text-slate2">
          {answered > 0
            ? jp(
                "返信はお客様の問い合わせ画面に「運営スタッフ」として表示されました。要確認からは外れ、対応済みへ移っています。メールに書き写す作業はありません。",
              )
            : jp(
                "左の運営画面で「要確認」を押すと、問い合わせの中身とAIの判定理由が開きます。返信を書いてSENDを押すと、お客様のスマホにその場で届きます。",
              )}
        </p>
      </div>

      <p className="mt-6 border-t border-edge2 pt-4 text-note leading-[1.9] text-pretty text-slate3">
        {jp(
          "AIに任せる範囲は、運営者が決められます。ここではデモとして、発送状況・ポイント・確率・住所・獲得履歴をAIの担当にし、返金と破損は必ず人へ渡す設定にしています。返信の文面はAIが下書きしますが、送るかどうかを決めるのは必ず人です。",
        )}
      </p>
    </div>
  );
}

function RouteBox({
  code,
  head,
  title,
  body,
  on,
}: {
  code: string;
  head: string;
  title: string;
  body: string;
  on: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 transition-colors duration-500 ${
        on ? "border-blue-ink/25 bg-blue-pale/60" : "border-edge bg-paper2"
      }`}
    >
      <p className="num text-[11px] tracking-[0.16em] text-slate3">
        {code}
        <span className="nb ml-2">{head}</span>
      </p>
      <p className="mt-2.5 text-note font-bold text-pretty text-slate">{title}</p>
      <p className="mt-3.5 text-note leading-[1.9] text-pretty text-slate2">
        {jp(body)}
      </p>
    </div>
  );
}

function RouteVerdict({
  label,
  jaLabel,
  tone,
  on,
  reduce,
}: {
  label: string;
  jaLabel: string;
  tone: "ok" | "warn";
  on: boolean;
  reduce: boolean;
}) {
  const active =
    tone === "ok"
      ? "border-ok-ink/40 bg-ok/12 text-ok-ink"
      : "border-warn/50 bg-warn/12 text-warn-ink";
  return (
    <motion.div
      animate={reduce ? {} : { opacity: on ? 1 : 0.45 }}
      transition={{ duration: 0.35 }}
      className={`rounded-xl border px-3 py-2.5 text-center transition-colors duration-500 ${
        on ? active : "border-edge bg-white text-slate3"
      }`}
    >
      <p className="num whitespace-nowrap text-[10px] font-bold tracking-[0.1em]">
        {label}
      </p>
      <p className="mt-1 whitespace-nowrap text-[11px] font-bold">{jaLabel}</p>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════
   スマホ本体
   ══════════════════════════════════════════════ */

function Phone(p: {
  screen: Screen;
  stage: number;
  reduce: boolean;
  points: number;
  shop: Gacha[];
  gacha: Gacha;
  results: DrawResult[];
  owned: Owned[];
  picked: string[];
  shipStep: "list" | "address" | "done";
  /** 問い合わせのやり取り */
  chat: Turn[];
  thinking: boolean;
  /** 運営側の未発送件数。発送依頼の完了画面で「運営にも届いた」ことを示すのに使う */
  unshipped: number;
  /** 運営側の要確認件数。引き継いだあとの画面で見せる */
  needCheck: number;
  /** 運営者が返信を済ませた件数。最後の一覧で「要確認から移った」ことを見せる */
  answered: number;
  /** 運営側の集計。最後の「連動しています」画面で、同じ数字を並べる */
  view: ReturnType<typeof operatorView>;
  onOpen: (id: string) => void;
  onHome: () => void;
  onPlay: (n: number) => void;
  onSkip: () => void;
  onMypage: () => void;
  onShip: () => void;
  onTogglePick: (k: string) => void;
  onShipStep: (s: "list" | "address" | "done") => void;
  onRequestShip: () => void;
  onAi: () => void;
  onAsk: (f: Faq) => void;
  onLinked: () => void;
  onRestart: () => void;
}) {
  const dark = p.screen === "play";
  return (
    /* data-play-phone … スクリーンショットを撮るときの「ここを写す」目印。消さないこと */
    <div data-play-phone="" className="mx-auto w-full max-w-[380px]">
      {/* 端末。金属の縁 → ベゼル → 画面 の3層で厚みを出す */}
      <div className="rounded-[42px] bg-gradient-to-b from-silver via-mist to-silver p-[3px] shadow-float">
        <div className="rounded-[39px] bg-white p-1.5 sm:p-2">
          <div
            className={`relative aspect-[9/18.6] w-full overflow-hidden rounded-[32px] transition-colors duration-500 ${
              dark ? "bg-navy" : "bg-paper2"
            }`}
          >
            {/* ノッチ */}
            <span
              aria-hidden
              className="absolute left-1/2 top-2 z-30 h-[18px] w-[84px] -translate-x-1/2 rounded-full bg-slate/90"
            />

            {/* 上のバー。ポイントは常に見えていること */}
            <div
              className={`relative z-20 flex items-center justify-between px-3.5 pb-2 pt-[34px] transition-colors duration-500 ${
                dark ? "text-white/70" : "text-slate3"
              }`}
            >
              <span className="num text-[10px] tracking-[0.18em]">
                MY SHOP
              </span>
              <div className="flex items-center gap-1.5">
                <span className="num rounded-full border border-gold/40 bg-gold-soft/25 px-2 py-[3px] text-[10px] tracking-[0.14em] text-gold-deep">
                  DEMO
                </span>
                <motion.span
                  key={p.points}
                  initial={{ scale: 1 }}
                  animate={{ scale: [1.12, 1] }}
                  transition={{ duration: 0.4 }}
                  className={`num rounded-full px-2.5 py-[3px] text-[11px] font-bold tracking-[0.06em] shadow-lift ${
                    dark ? "bg-white/12 text-white" : "bg-white text-slate"
                  }`}
                >
                  {p.points.toLocaleString("ja-JP")} pt
                </motion.span>
              </div>
            </div>

            {/* 画面本体。下のタブぶんだけ高さを引く */}
            <div className="relative h-[calc(100%-58px-46px)] overflow-hidden">
              <AnimatePresence mode="wait">
                {p.screen === "home" && (
                  <Home key="home" shop={p.shop} onOpen={p.onOpen} />
                )}
                {p.screen === "detail" && (
                  <Detail
                    key="detail"
                    g={p.gacha}
                    points={p.points}
                    onBack={p.onHome}
                    onPlay={p.onPlay}
                  />
                )}
                {p.screen === "play" && (
                  <Play
                    key="play"
                    stage={p.stage}
                    reduce={p.reduce}
                    onSkip={p.onSkip}
                  />
                )}
                {p.screen === "result" && (
                  <Result
                    key="result"
                    results={p.results}
                    art={p.gacha.art}
                    onAgain={() => p.onPlay(p.results.length)}
                    onMypage={p.onMypage}
                  />
                )}
                {p.screen === "mypage" && (
                  <MyPage
                    key="mypage"
                    owned={p.owned}
                    asks={p.chat.length}
                    onShip={p.onShip}
                    onHome={p.onHome}
                  />
                )}
                {p.screen === "ship" && (
                  <Ship
                    key="ship"
                    owned={p.owned}
                    picked={p.picked}
                    step={p.shipStep}
                    onToggle={p.onTogglePick}
                    onStep={p.onShipStep}
                    onRequest={p.onRequestShip}
                    onAi={p.onAi}
                    onMypage={p.onMypage}
                    unshipped={p.unshipped}
                  />
                )}
                {p.screen === "ai" && (
                  <Ai
                    key="ai"
                    chat={p.chat}
                    thinking={p.thinking}
                    needCheck={p.needCheck}
                    onAsk={p.onAsk}
                    onLinked={p.onLinked}
                  />
                )}
                {p.screen === "linked" && (
                  <Linked
                    key="linked"
                    view={p.view}
                    needCheck={p.needCheck}
                    answered={p.answered}
                    onRestart={p.onRestart}
                  />
                )}
              </AnimatePresence>
            </div>

            {/* 下のタブ。演出中は隠す（実機のガチャでもそうします） */}
            <div
              className={`absolute inset-x-0 bottom-0 z-20 flex h-[46px] items-stretch border-t transition-opacity duration-300 ${
                dark
                  ? "pointer-events-none border-white/10 bg-navy opacity-0"
                  : "border-edge bg-white opacity-100"
              }`}
            >
              {[
                { k: "home", label: "ホーム", on: p.onHome },
                { k: "mypage", label: "マイページ", on: p.onMypage },
                { k: "ai", label: "問い合わせ", on: p.onAi },
              ].map((t) => {
                const active =
                  t.k === p.screen ||
                  (t.k === "home" && p.screen === "detail") ||
                  (t.k === "mypage" && p.screen === "ship") ||
                  (t.k === "ai" && p.screen === "linked");
                return (
                  <button
                    key={t.k}
                    type="button"
                    onClick={t.on}
                    className={`flex flex-1 items-center justify-center whitespace-nowrap text-[11px] font-bold transition-colors ${
                      active ? "text-blue-ink" : "text-slate3"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <p className="num mt-4 text-center text-[11px] leading-[1.7] tracking-[0.16em] text-slate3">
        CUSTOMER VIEW — 実際に触れます
      </p>
    </div>
  );
}

/* 画面の切り替え。横滑りではなく、軽く持ち上げる程度にする */
const slide = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.26 },
};

/** 画面ごとの共通の入れ物。中だけ縦スクロールする */
function Pane({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      {...slide}
      className={`h-full overflow-y-auto overscroll-contain px-3 pb-4 ${className}`}
    >
      {children}
    </motion.div>
  );
}

/* ══════════════════════════════════════════════
   01 ガチャ一覧
   ══════════════════════════════════════════════ */

function Home({
  shop,
  onOpen,
}: {
  shop: Gacha[];
  onOpen: (id: string) => void;
}) {
  return (
    <Pane>
      <p className="px-0.5 pb-2 text-[13px] font-bold text-slate">
        開催中のガチャ
      </p>
      <div className="space-y-2.5">
        {shop.map((g) => (
          <button
            key={g.id}
            type="button"
            /*
              ★この目印（data-play）は消さないこと。
                「一覧 → 詳細 → 引く → 当選 → 発送依頼」を機械で通しで動かし、
                8枚のスクリーンショットを毎回同じ手順で撮るために使っています。
                見た目には何も影響しません。
            */
            data-play="open"
            onClick={() => onOpen(g.id)}
            className="block w-full overflow-hidden rounded-2xl border border-edge bg-white text-left shadow-lift transition-transform active:scale-[0.985]"
          >
            {/* サムネイルは大きく。文字だけの一覧にしないこと */}
            <div className="relative">
              <GachaArt art={g.art} className="h-[104px] w-full" />
              <div className="absolute left-2 top-2 flex gap-1">
                {g.badges.map((b) => (
                  <span
                    key={b}
                    className={`num whitespace-nowrap rounded-full px-2 py-[3px] text-[9px] font-bold tracking-[0.1em] ${
                      b === "few"
                        ? "bg-danger text-white"
                        : b === "hot"
                          ? "bg-gold text-slate"
                          : "bg-white/90 text-slate"
                    }`}
                  >
                    {BADGE_LABEL[b]}
                  </span>
                ))}
              </div>
              <p className="absolute inset-x-2.5 bottom-2 whitespace-nowrap text-[13px] font-bold text-white drop-shadow">
                {g.title}
              </p>
            </div>

            <div className="p-2.5">
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <p className="num text-[10px] tracking-[0.12em] text-slate3">
                    1回
                  </p>
                  <p className="num-lead whitespace-nowrap text-[17px] font-bold leading-none text-slate">
                    {g.price.toLocaleString("ja-JP")}
                    <span className="text-[11px] font-semibold opacity-70">
                      {" "}
                      pt
                    </span>
                  </p>
                </div>
                <div className="min-w-0 text-right">
                  <p className="num text-[10px] tracking-[0.12em] text-slate3">
                    残り
                  </p>
                  <p className="num-lead whitespace-nowrap text-[15px] font-bold leading-none text-blue-ink">
                    {g.left.toLocaleString("ja-JP")}
                    <span className="text-[11px] text-slate3">
                      {" "}
                      / {g.total.toLocaleString("ja-JP")}
                    </span>
                  </p>
                </div>
              </div>

              {/* 残りの割合。数字だけより、減っていることが伝わる */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-mist">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-ink to-blue"
                  style={{ width: `${(g.left / g.total) * 100}%` }}
                />
              </div>

              <p className="mt-2 truncate text-[12px] text-slate2">
                {g.headline}
              </p>
              <span className="mt-2.5 block rounded-lg bg-blue-ink py-2 text-center text-[12px] font-bold text-white">
                ガチャを見る
              </span>
            </div>
          </button>
        ))}
      </div>
    </Pane>
  );
}

/* ══════════════════════════════════════════════
   02 ガチャ詳細
   ══════════════════════════════════════════════ */

function Detail({
  g,
  points,
  onBack,
  onPlay,
}: {
  g: Gacha;
  points: number;
  onBack: () => void;
  onPlay: (n: number) => void;
}) {
  const can1 = points >= g.price && g.left >= 1;
  const can10 = points >= g.price * 10 && g.left >= 10;
  return (
    <Pane className="pb-2">
      <button
        type="button"
        onClick={onBack}
        className="mb-2 whitespace-nowrap text-[12px] font-bold text-slate3"
      >
        ← 一覧へ戻る
      </button>

      {/*
        ★上半分（写真・タイトル・料金・残り・注目賞・最低保証）を、
          必ず1画面に収めること。
          最初これを縦に積んだところ、賞の一覧が1行しか見えませんでした。
          お客様が知りたいのは「何が当たるのか」なので、
          そこへ届く前にスクロールを要求してはいけません。
          そのためにタイトルは絵の上へ重ね、注目賞と最低保証は1枚にまとめています。
      */}
      <div className="overflow-hidden rounded-2xl border border-edge bg-white shadow-lift">
        <div className="relative">
          <GachaArt art={g.art} className="h-[96px] w-full" />
          <p className="absolute inset-x-3 bottom-2 whitespace-nowrap text-[14px] font-bold text-white drop-shadow">
            {g.title}
          </p>
        </div>
        <div className="p-2.5">
          {/*
            ★お客様がいちばん先に知りたい数字を、上にまとめて出します。
              値段・残り・注目賞・最低保証。これを探させないこと。
          */}
          <dl className="grid grid-cols-2 gap-1.5">
            {[
              { k: "1回の料金", v: `${g.price.toLocaleString("ja-JP")} pt` },
              {
                k: "残り口数",
                v: `${g.left.toLocaleString("ja-JP")} / ${g.total.toLocaleString("ja-JP")}`,
              },
            ].map((r) => (
              <div
                key={r.k}
                className="rounded-lg border border-edge2 bg-paper2 px-2.5 py-1.5"
              >
                <dt className="text-[10px] text-slate3">{r.k}</dt>
                <dd className="num-lead mt-0.5 whitespace-nowrap text-[14px] font-bold text-slate">
                  {r.v}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-baseline gap-2 rounded-lg border border-blue-ink/18 bg-blue-pale px-2.5 py-1.5">
              <span className="shrink-0 whitespace-nowrap text-[10px] tracking-[0.1em] text-blue-ink">
                注目賞
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-slate">
                {g.headline}
              </span>
            </div>
            <div className="rounded-lg border border-ok-ink/20 bg-ok/[0.07] px-2.5 py-1.5">
              <span className="whitespace-nowrap text-[10px] tracking-[0.1em] text-ok-ink">
                最低保証
              </span>
              <span className="ml-2 text-[12px] text-pretty text-slate2">
                {g.guarantee}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 賞の一覧。残っている本数と、いまの確率を隠さない */}
      <p className="mt-2.5 px-0.5 text-[12px] font-bold text-slate">賞の内容</p>
      <div className="mt-1.5 space-y-1.5">
        {g.prizes.map((pz) => {
          const r = rank(pz.rank);
          const pool = g.prizes
            .filter((x) => x.rank !== "L")
            .reduce((a, x) => a + x.left, 0);
          const prob = pz.rank === "L" ? null : (pz.left / pool) * 100;
          return (
            <div
              key={pz.id}
              className={`flex items-center gap-2.5 rounded-xl border border-edge2 px-2.5 py-2 ${r.row}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg ${r.face} ${r.ink} ${r.edge}`}
              >
                <b className="num text-[11px] font-bold leading-none">
                  {r.mark}
                </b>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="whitespace-nowrap text-[12px] font-bold text-slate">
                    {r.label}
                  </span>
                  <span className="num whitespace-nowrap text-[9px] tracking-[0.12em] text-slate3">
                    {r.tier}
                  </span>
                </div>
                <p className="truncate text-[11px] text-slate2">{pz.name}</p>
              </div>
              {/*
                ★売り切れた賞を一覧から消さないこと。
                  消すと「最初から無かった」ように見えて、かえって疑われます。
                  残0のまま「完売」と書くのが、いちばん正直で、いちばん信用されます。
              */}
              <div className="shrink-0 text-right">
                <p
                  className={`num-lead whitespace-nowrap text-[12px] font-bold ${
                    pz.left === 0 ? "text-slate3" : "text-slate"
                  }`}
                >
                  {pz.left === 0 ? "完売" : `残 ${pz.left}`}
                </p>
                <p className="num whitespace-nowrap text-[10px] text-slate3">
                  {pz.left === 0
                    ? "—"
                    : prob === null
                      ? "最後の1口"
                      : `${prob.toFixed(1)}%`}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 px-0.5 text-[10px] leading-[1.7] text-slate3">
        確率は残っている本数から計算しています。引くたびに変わります。
      </p>

      {/*
        ★［1回引く］［10連］は、詳細の下に固定で置くこと。
          スクロールして探させないための位置です。
      */}
      <div className="sticky bottom-0 -mx-3 mt-3 border-t border-edge bg-white/95 px-3 py-2.5 backdrop-blur">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!can1}
            data-play="draw1"
            onClick={() => onPlay(1)}
            className={`rounded-xl py-2.5 text-center transition-transform active:scale-[0.97] ${
              can1
                ? "bg-blue-ink text-white shadow-blue-lift"
                : "cursor-not-allowed bg-mist text-slate3"
            }`}
          >
            <span className="block whitespace-nowrap text-[13px] font-bold">
              1回引く
            </span>
            <span className="num block whitespace-nowrap text-[11px] opacity-80">
              {g.price.toLocaleString("ja-JP")} pt
            </span>
          </button>
          <button
            type="button"
            disabled={!can10}
            data-play="draw10"
            onClick={() => onPlay(10)}
            className={`rounded-xl py-2.5 text-center transition-transform active:scale-[0.97] ${
              can10
                ? "bg-gradient-to-br from-gold to-gold-deep text-white shadow-goldglow"
                : "cursor-not-allowed bg-mist text-slate3"
            }`}
          >
            <span className="block whitespace-nowrap text-[13px] font-bold">
              10連
            </span>
            <span className="num block whitespace-nowrap text-[11px] opacity-80">
              {(g.price * 10).toLocaleString("ja-JP")} pt
            </span>
          </button>
        </div>
        {!can10 && (
          <p className="mt-1.5 text-center text-[10px] text-slate3">
            10連にはポイントが足りません。
          </p>
        )}
      </div>
    </Pane>
  );
}

/* ══════════════════════════════════════════════
   03 演出
   ══════════════════════════════════════════════ */

function Play({
  stage,
  reduce,
  onSkip,
}: {
  stage: number;
  reduce: boolean;
  onSkip: () => void;
}) {
  return (
    <motion.div {...slide} className="relative h-full">
      {/*
        光が広がる。

        ★中央そろえは flex で行うこと。translate クラスを使わないこと。
          -translate-x-1/2 と framer-motion の scale は、どちらも transform を使います。
          後から当たる framer-motion 側が打ち消してしまい、
          光が画面の右下にずれて出ていました（実際にそうなっていた）。
      */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <AnimatePresence>
          {stage >= 1 && !reduce && (
            <motion.span
              key="rays"
              initial={{ opacity: 0, rotate: 0, scale: 0.6 }}
              animate={{ opacity: [0, 0.45, 0.22], rotate: 26, scale: 1.6 }}
              transition={{ duration: 1.6, times: [0, 0.35, 1] }}
              className="absolute h-[420px] w-[420px] rounded-full bg-[conic-gradient(from_0deg,rgba(255,255,255,0.5),transparent_14%,rgba(255,255,255,0.42)_26%,transparent_40%,rgba(255,255,255,0.5)_54%,transparent_68%,rgba(255,255,255,0.42)_80%,transparent_94%)] [mask-image:radial-gradient(circle,#000_18%,transparent_66%)]"
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {stage >= 1 && !reduce && (
            <motion.span
              key="glow"
              initial={{ opacity: 0, scale: 0.2 }}
              animate={{ opacity: [0, 0.95, 0.55], scale: [0.2, 1.5, 2.4] }}
              transition={{ duration: 1.4, times: [0, 0.35, 1] }}
              className="absolute h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.95),rgba(96,165,250,0.5)_38%,transparent_70%)]"
            />
          )}
        </AnimatePresence>
      </div>

      {/* 箱が現れて開く */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatePresence>
          {stage >= 2 && (
            <motion.div
              key="box"
              initial={{ opacity: 0, scale: 0.7, rotate: -6 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 210, damping: 16 }}
              className="relative h-24 w-24 rounded-2xl bg-gradient-to-br from-blue-bright via-blue to-blue-deep shadow-glow"
            >
              <span className="absolute inset-x-0 top-1/3 h-[3px] bg-white/70" />
              <span className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-white/40" />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {stage >= 3 && (
            <motion.p
              key="tier"
              initial={{ opacity: 0, y: 14, letterSpacing: "0.5em" }}
              animate={{ opacity: 1, y: 0, letterSpacing: "0.22em" }}
              transition={{ duration: 0.5 }}
              className="num mt-7 whitespace-nowrap text-[13px] font-bold text-gold-soft"
            >
              RARITY CHECK
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/*
        ★SKIP は必ず出すこと。
          何十回も引く人にとって、飛ばせない演出はただの待ち時間です。
      */}
      <button
        type="button"
        data-play="skip"
        onClick={onSkip}
        className="num absolute bottom-5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/25 bg-white/10 px-5 py-2 text-[11px] font-bold tracking-[0.18em] text-white backdrop-blur"
      >
        SKIP
      </button>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════
   04 当選
   ══════════════════════════════════════════════ */

function Result({
  results,
  art,
  onAgain,
  onMypage,
}: {
  results: DrawResult[];
  art: ArtKey;
  onAgain: () => void;
  onMypage: () => void;
}) {
  const best = bestOf(results);
  if (!best) return null;
  const many = results.length > 1;
  const r = rank(best.rank);

  return (
    <Pane>
      <p className="px-0.5 pb-2 text-center text-[12px] font-bold text-slate3">
        {many ? `${results.length}連の結果` : "結果"}
      </p>

      {/* いちばん良かった賞を大きく */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}
        className="overflow-hidden rounded-2xl border border-edge bg-white shadow-lift2"
      >
        <div className={`${r.face} px-3 py-2.5`}>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`num whitespace-nowrap text-[15px] font-bold ${r.ink}`}
            >
              {r.label}
            </span>
            <span
              className={`num whitespace-nowrap rounded-full bg-black/15 px-2 py-[3px] text-[9px] tracking-[0.16em] ${r.ink}`}
            >
              {r.tier}
            </span>
          </div>
        </div>

        {/*
          ★当たった「モノ」を必ず絵で見せること。文字だけにしないこと。
            最初ここを文字だけにしていたところ、
            「C賞／スタンダードカード（デモ）／220pt」と書かれた
            白い箱が出るだけで、下半分が真っ白に空いていました。
            ガチャは「何が出たか」を見る瞬間がいちばんの山場です。
            そこに絵が無いのは、箱を開けたのに中身が見えないのと同じです。

          ★ここに実在ブランドの商品写真は絶対に置かないこと。
            使うのは自作のデモ用アートワーク（GachaArt）だけです。
            権利のない画像を並べた時点で、販売ページとして失格になります。

          ★10連のときは絵を低くすること。
            下に10個の結果一覧が続くので、同じ高さのままだと
            スマホ1画面に「いちばん良かった賞」と「一覧」が同時に収まりません。
        */}
        {/*
          ★格（C賞）は上の帯に既に出ています。絵の上に重ねて2回書かないこと。
            同じ言葉が10mm以内に2回出ると、作りが雑に見えます。
        */}
        <GachaArt
          art={art}
          className={many ? "h-[104px] w-full" : "h-[188px] w-full"}
        />

        <div className="p-3">
          <p className="text-[13px] font-bold text-pretty text-slate">
            {best.name}
          </p>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="whitespace-nowrap text-[11px] text-slate3">
              参考価値
            </span>
            <span className="num-lead whitespace-nowrap text-[16px] font-bold text-slate">
              {pt(best.pt)}
            </span>
          </div>
          {best.lastOne && (
            <p className="num mt-2 whitespace-nowrap rounded-full bg-gold-soft/40 px-2.5 py-1 text-center text-[10px] font-bold text-gold-deep">
              LAST ONE — 最後の1口の特典
            </p>
          )}
          <p className="mt-2.5 whitespace-nowrap rounded-lg bg-ok/10 py-1.5 text-center text-[12px] font-bold text-ok-ink">
            獲得しました
          </p>
        </div>
      </motion.div>

      {/* 10連は全部を一覧で。いちばん良い賞だけ少し強く */}
      {many && (
        <div className="mt-2.5 grid grid-cols-5 gap-1.5">
          {results.map((x) => {
            const rr = rank(x.rank);
            const top = x.n === best.n;
            return (
              <motion.div
                key={x.n}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 * x.n, duration: 0.24 }}
                className={`flex aspect-square flex-col items-center justify-center rounded-lg ${rr.face} ${rr.ink} ${
                  top ? "ring-2 ring-gold ring-offset-1" : rr.edge
                }`}
              >
                <b className="num text-[12px] font-bold leading-none">
                  {rr.mark === "LAST" ? "L" : rr.mark}
                </b>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onAgain}
          className="whitespace-nowrap rounded-xl bg-blue-ink py-2.5 text-[12px] font-bold text-white shadow-blue-lift"
        >
          もう一度引く
        </button>
        <button
          type="button"
          data-play="tomypage"
          onClick={onMypage}
          className="whitespace-nowrap rounded-xl border border-edge bg-white py-2.5 text-[12px] font-bold text-slate"
        >
          マイページで確認
        </button>
      </div>
    </Pane>
  );
}

/* ══════════════════════════════════════════════
   05 マイページ
   ══════════════════════════════════════════════ */

const STATUS: Record<Owned["status"], { label: string; cls: string }> = {
  held: { label: "保有中", cls: "bg-paper2 text-slate3 border-edge" },
  requested: {
    label: "発送依頼済み",
    cls: "bg-blue-pale text-blue-ink border-blue-ink/20",
  },
  preparing: {
    label: "発送準備中",
    cls: "bg-ok/10 text-ok-ink border-ok-ink/25",
  },
};

function MyPage({
  owned,
  asks,
  onShip,
  onHome,
}: {
  owned: Owned[];
  /** これまでの問い合わせ件数。同じ会員の情報として並べる */
  asks: number;
  onShip: () => void;
  onHome: () => void;
}) {
  const held = owned.filter((o) => o.status === "held").length;
  const moving = owned.filter((o) => o.status !== "held").length;
  return (
    <Pane>
      <p className="px-0.5 pb-2 text-[13px] font-bold text-slate">マイページ</p>

      {/*
        ★獲得商品・発送状況・問い合わせを、別々の話にしないこと。
          この3つが同じ会員に紐づいていることが分かると、
          「1つのシステムで動いている」ことが説明なしで伝わります。
          逆に、商品一覧だけを出すと、ただの当選履歴に見えます。
      */}
      <div className="rounded-2xl border border-edge bg-white p-3 shadow-lift">
        <div className="flex items-center gap-2.5">
          <span className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-blue-ink/20 bg-blue-pale text-[11px] font-bold text-blue-ink">
            GD
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold text-slate">
              デモユーザー 様
            </p>
            <p className="num mt-0.5 whitespace-nowrap text-[10px] text-slate3">
              会員ID GD-0001（デモ）
            </p>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {[
            { k: "獲得商品", v: owned.length, u: "点" },
            { k: "発送手配中", v: moving, u: "点" },
            { k: "問い合わせ", v: asks, u: "件" },
          ].map((c) => (
            <div
              key={c.k}
              className="rounded-xl border border-edge2 bg-paper2 px-2 py-2 text-center"
            >
              <p className="whitespace-nowrap text-[9px] text-slate3">{c.k}</p>
              <p className="num mt-0.5 flex items-baseline justify-center gap-0.5 whitespace-nowrap">
                <b className="text-[15px] font-extrabold text-slate">{c.v}</b>
                <span className="text-[9px] text-slate3">{c.u}</span>
              </p>
            </div>
          ))}
        </div>
      </div>

      <p className="px-0.5 pb-2 pt-3 text-[13px] font-bold text-slate">
        獲得商品
      </p>

      {owned.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-white p-5 text-center">
          <p className="text-[12px] text-slate2">
            まだ獲得した商品はありません。
          </p>
          <button
            type="button"
            onClick={onHome}
            className="mt-3 whitespace-nowrap rounded-lg bg-blue-ink px-4 py-2 text-[12px] font-bold text-white"
          >
            ガチャを見に行く
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {owned.map((o) => {
              const r = rank(o.rank);
              const s = STATUS[o.status];
              return (
                <div
                  key={o.key}
                  className="flex items-center gap-2.5 rounded-xl border border-edge bg-white px-2.5 py-2 shadow-lift"
                >
                  {/*
                    ★ここは商品の絵にすること。アルファベットの箱に戻さないこと。
                      「A」「C」とだけ並べると、注文履歴ではなく成績表に見えます。
                      格（S/A/B/C）は絵の左上に小さく重ねれば足ります。
                  */}
                  <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-edge">
                    <GachaArt art={o.art} className="h-full w-full" />
                    <b
                      className={`num absolute left-0 top-0 rounded-br-md px-1 py-[1px] text-[9px] font-bold leading-none ${r.face} ${r.ink}`}
                    >
                      {r.mark === "LAST" ? "L" : r.mark}
                    </b>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-slate">
                      {o.name}
                    </p>
                    <p className="num mt-0.5 whitespace-nowrap text-[10px] text-slate3">
                      {r.label} / 参考価値 {pt(o.pt)}
                    </p>
                    {/* 獲得日時。いつ当てたのか分からない注文履歴は、履歴とは呼べません */}
                    <p className="num mt-[3px] whitespace-nowrap text-[10px] text-slate3/85">
                      獲得 {o.at}
                    </p>
                  </div>
                  <span
                    className={`num shrink-0 whitespace-nowrap rounded-full border px-2 py-[3px] text-[9px] tracking-[0.08em] ${s.cls}`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={held === 0}
            data-play="toship"
            onClick={onShip}
            className={`mt-3 w-full whitespace-nowrap rounded-xl py-2.5 text-[12px] font-bold ${
              held > 0
                ? "bg-blue-ink text-white shadow-blue-lift"
                : "cursor-not-allowed bg-mist text-slate3"
            }`}
          >
            {held > 0 ? `発送を依頼する（${held}点）` : "依頼できる商品がありません"}
          </button>
          <p className="mt-2 px-0.5 text-[10px] leading-[1.7] text-slate3">
            発送のかわりにポイントへ交換することもできます。
          </p>
        </>
      )}
    </Pane>
  );
}

/* ══════════════════════════════════════════════
   06 発送依頼
   ══════════════════════════════════════════════ */

function Ship({
  owned,
  picked,
  step,
  onToggle,
  onStep,
  onRequest,
  onAi,
  onMypage,
  unshipped,
}: {
  owned: Owned[];
  picked: string[];
  step: "list" | "address" | "done";
  onToggle: (k: string) => void;
  onStep: (s: "list" | "address" | "done") => void;
  onRequest: () => void;
  onAi: () => void;
  onMypage: () => void;
  unshipped: number;
}) {
  const target = owned.filter((o) => o.status === "held");
  /*
    ★依頼が済むと status が「発送準備中」に変わるので、
      上の target からは消えます。控えを出すには、
      選んだ key を手がかりに引き直す必要があります。
  */
  const requested = owned.filter((o) => picked.includes(o.key));

  return (
    <Pane>
      <button
        type="button"
        onClick={onMypage}
        className="mb-2 whitespace-nowrap text-[12px] font-bold text-slate3"
      >
        ← マイページへ戻る
      </button>

      {step === "list" && (
        <>
          <p className="px-0.5 pb-2 text-[13px] font-bold text-slate">
            発送する商品を選ぶ
          </p>
          <div className="space-y-1.5">
            {target.map((o) => {
              const on = picked.includes(o.key);
              const r = rank(o.rank);
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => onToggle(o.key)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                    on
                      ? "border-blue-ink/35 bg-blue-pale"
                      : "border-edge bg-white"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      on
                        ? "border-blue-ink bg-blue-ink text-white"
                        : "border-edge bg-white"
                    }`}
                  >
                    {on && (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M3.5 8.5l3 3 6-7"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  {/* 選ぶ画面でも絵を出す。名前だけだと、どれを選んだのか分かりません */}
                  <span className="block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-edge">
                    <GachaArt art={o.art} className="h-full w-full" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-bold text-slate">
                      {o.name}
                    </span>
                    <span className="num block whitespace-nowrap text-[10px] text-slate3">
                      {r.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={picked.length === 0}
            data-play="ship-address"
            onClick={() => onStep("address")}
            className={`mt-3 w-full whitespace-nowrap rounded-xl py-2.5 text-[12px] font-bold ${
              picked.length > 0
                ? "bg-blue-ink text-white shadow-blue-lift"
                : "cursor-not-allowed bg-mist text-slate3"
            }`}
          >
            発送を依頼する
          </button>
        </>
      )}

      {step === "address" && (
        <>
          <p className="px-0.5 pb-2 text-[13px] font-bold text-slate">
            お届け先の確認
          </p>
          {/*
            ★デモなので、住所は架空のものを固定で出しています。
              入力欄にして個人情報を書かせないこと。
          */}
          <div className="rounded-2xl border border-edge bg-white p-3 shadow-lift">
            <dl className="space-y-2">
              {[
                { k: "お名前", v: "山田 太郎（デモ）" },
                { k: "郵便番号", v: "100-0001（デモ）" },
                { k: "ご住所", v: "東京都千代田区1-1-1 デモマンション101" },
                { k: "電話番号", v: "090-0000-0000（デモ）" },
              ].map((r) => (
                <div key={r.k}>
                  <dt className="text-[10px] text-slate3">{r.k}</dt>
                  <dd className="mt-0.5 text-[12px] text-pretty text-slate">
                    {r.v}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-edge2 pt-2.5 text-[10px] leading-[1.7] text-slate3">
              マイページに登録済みの住所です。ここでは変更できません。
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onStep("list")}
              className="whitespace-nowrap rounded-xl border border-edge bg-white py-2.5 text-[12px] font-bold text-slate"
            >
              戻る
            </button>
            <button
              type="button"
              data-play="ship-request"
              onClick={onRequest}
              className="whitespace-nowrap rounded-xl bg-blue-ink py-2.5 text-[12px] font-bold text-white shadow-blue-lift"
            >
              この住所で依頼
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-ok-ink/25 bg-ok/[0.07] p-4 text-center"
        >
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-ok/20">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
              <path
                d="M3.5 8.5l3 3 6-7"
                stroke="#0F855C"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <p className="mt-2.5 whitespace-nowrap text-[13px] font-bold text-ok-ink">
            発送依頼が完了しました
          </p>
          <p className="mt-1.5 text-[11px] leading-[1.8] text-pretty text-slate2">
            {jp(
              "準備ができ次第、追跡番号をマイページとメールでお知らせします。",
            )}
          </p>
          <p className="num mt-3 whitespace-nowrap rounded-full border border-ok-ink/25 bg-white px-3 py-1.5 text-[11px] font-bold text-ok-ink">
            STATUS：発送準備中
          </p>
          {/*
            ★「完了しました」の一言で終わらせないこと。
              最初これだけを出していたところ、画面の下3分の2が真っ白になり、
              しかも「何を頼んだのか」が画面から消えていました。
              実際の通販で、注文したのに控えが出ないサイトは信用されません。
          */}
          <div className="mt-3 space-y-1.5 text-left">
            {requested.map((o) => (
              <div
                key={o.key}
                className="flex items-center gap-2.5 rounded-xl border border-ok-ink/20 bg-white px-2.5 py-2"
              >
                <span className="block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-edge">
                  <GachaArt art={o.art} className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-slate">
                  {o.name}
                </span>
                <span className="num shrink-0 whitespace-nowrap text-[10px] text-ok-ink">
                  準備中
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            data-play="toai"
            onClick={onAi}
            className="mt-3 w-full whitespace-nowrap rounded-xl border border-edge bg-white py-2.5 text-[12px] font-bold text-slate"
          >
            発送について質問する
          </button>
        </motion.div>
      )}

      {/*
        ★この一文を消さないこと。
          お客様が発送を頼んだ瞬間に、運営者の管理画面の「未発送」が増えます。
          このデモの狙いは「お客様側と運営側が同じ1つのシステムだ」と
          分かってもらうことなので、その橋渡しを画面に書いておきます。
      */}
      {step === "done" && (
        <p className="mt-3 rounded-xl border border-edge bg-paper2 px-3 py-2.5 text-[10px] leading-[1.8] text-pretty text-slate3">
          {jp("この依頼は、運営者の管理画面にも同時に届いています。")}
          <br />
          <span className="num">未発送 {unshipped} 件</span>
          {jp("（画面の外にある集計表へ、転記する作業はありません）")}
        </p>
      )}
    </Pane>
  );
}
/* ══════════════════════════════════════════════
   07 問い合わせ（AIが答える／人へ引き継ぐ）

   ★以前の作りの何が悪かったか
     用意した質問が1つだけで、2往復して終わりでした。
     その結果、スマホの下3分の1ほどが白いまま残り、
     「作りかけの画面」に見えていました。
     実際の問い合わせ画面は、まず「よくある質問」が並んでいます。

   ★Q と A が、ひと目で分かる形にすること
     吹き出しだけだと、どちらが質問でどちらが答えか、
     文字を読まないと分かりません。Q / A の印を付けます。
   ══════════════════════════════════════════════ */

function Ai({
  chat,
  thinking,
  needCheck,
  onAsk,
  onLinked,
}: {
  chat: Turn[];
  thinking: boolean;
  needCheck: number;
  onAsk: (f: Faq) => void;
  onLinked: () => void;
}) {
  const used = new Set(chat.map((t) => t.id.split("-")[0]));
  const escalated = chat.some((t) => t.mode === "escalate" && t.a);
  /* まだ運営スタッフの返信を待っている件があるか。届いたら上の帯を「回答済み」に変える */
  const waiting = chat.some((t) => t.mode === "escalate" && t.a && !t.staff);

  return (
    <Pane>
      <div className="flex items-center justify-between px-0.5 pb-2">
        <p className="text-[13px] font-bold text-slate">お問い合わせ</p>
        <span className="num whitespace-nowrap rounded-full border border-blue-ink/18 bg-blue-pale px-2 py-[3px] text-[9px] tracking-[0.12em] text-blue-ink">
          AI 受付中
        </span>
      </div>

      {/* ── 引き継ぎ中の帯。いちばん上に固定で出す ──
          ★これを会話の下に埋もれさせないこと。
            お客様が知りたいのは「自分の件がいま誰の手にあるか」です。 */}
      {escalated && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          data-play-escalated=""
          className={`mb-2 rounded-xl border px-3 py-2.5 ${
            waiting
              ? "border-warn/45 bg-warn/10"
              : "border-ok-ink/30 bg-ok/[0.08]"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              {waiting && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn/70" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  waiting ? "bg-warn" : "bg-ok-ink"
                }`}
              />
            </span>
            <p
              className={`text-[12px] font-bold ${
                waiting ? "text-warn-ink" : "text-ok-ink"
              }`}
            >
              {waiting ? "担当者確認中" : "運営スタッフが回答しました"}
            </p>
            <span
              className={`num ml-auto whitespace-nowrap text-[9px] tracking-[0.1em] ${
                waiting ? "text-warn-ink/80" : "text-ok-ink/80"
              }`}
            >
              {chat.find((t) => t.ticket)?.ticket ?? "CS-0001"}
            </span>
          </div>
          <p className="mt-1.5 text-[10px] leading-[1.75] text-pretty text-slate2">
            {waiting
              ? jp(
                  "この件はAIでは判断せず、運営スタッフが確認しています。運営者側の「要確認」に1件として残っています。",
                )
              : jp(
                  "運営スタッフが内容を確認し、返信しました。運営者側の「要確認」は0件になり、対応済みへ移っています。",
                )}
          </p>
        </motion.div>
      )}

      {/* ── AIの最初のあいさつ ── */}
      <Bubble side="ai" mark="AI">
        {jp(
          "ご注文・発送・ポイントについてお答えします。よくある質問からお選びいただくか、そのままご相談ください。",
        )}
      </Bubble>

      {/* ── これまでのやり取り ── */}
      {chat.map((t) => (
        <div key={t.id} className="mt-2 space-y-2">
          <Bubble side="me" mark="Q">
            {t.q}
          </Bubble>

          {!t.a ? (
            <Bubble side="ai" mark="A" muted>
              <span className="inline-flex items-center gap-1.5">
                {t.mode === "escalate"
                  ? "内容を確認しています…"
                  : "発送・ご注文の状況を確認しています…"}
                <Dots />
              </span>
            </Bubble>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Bubble side="ai" mark="A" tone={t.mode}>
                <span className="block">{jp(t.a)}</span>
                {t.tag && (
                  <span
                    className={`num mt-2 inline-block whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                      t.mode === "escalate"
                        ? "border-warn/45 bg-warn/10 text-warn-ink"
                        : "border-ok-ink/25 bg-ok/10 text-ok-ink"
                    }`}
                  >
                    {t.tag}
                  </span>
                )}
                {/* AIが自分で答えたのか、人へ渡したのかを必ず明示する */}
                <span
                  className={`num mt-2 block whitespace-nowrap text-[9px] tracking-[0.12em] ${
                    t.mode === "escalate" ? "text-warn-ink" : "text-slate3"
                  }`}
                >
                  {t.mode === "escalate"
                    ? "ESCALATE — 運営スタッフへ引き継ぎ"
                    : "AUTO ANSWER — AIが回答"}
                </span>
              </Bubble>
            </motion.div>
          )}

          {/* ── 運営スタッフからの返信 ──
              ★AIの吹き出しと同じ見た目にしないこと。
                誰が答えたのかが分からなくなります。
                名前（運営スタッフ）と色を変えて、人が書いたことを明示します。 */}
          {t.staff && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              data-play-staff=""
            >
              <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[10px] font-bold text-ok-ink">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok-ink" />
                運営スタッフから返信が届きました
              </p>
              <Bubble side="ai" mark="運営" tone="staff">
                <span className="block">{jp(t.staff)}</span>
                <span className="num mt-2 block whitespace-nowrap text-[9px] tracking-[0.12em] text-ok-ink">
                  HUMAN REPLY — 運営スタッフが回答
                </span>
              </Bubble>
            </motion.div>
          )}
        </div>
      ))}

      {/* ── よくある質問 ──
          ★ここを空けたままにしないこと。
            問い合わせ画面の下半分が白いだけの画面は、未完成に見えます。 */}
      <div className="mt-3 rounded-2xl border border-edge bg-white p-2.5 shadow-lift">
        <p className="num px-0.5 pb-2 text-[10px] tracking-[0.14em] text-slate3">
          よくある質問
        </p>
        <div className="space-y-1.5">
          {FAQ.map((f, i) => {
            const done = used.has(f.key);
            return (
              <button
                key={f.key}
                type="button"
                disabled={thinking}
                /* data-play … スクリーンショットの目印。消さないこと */
                data-play={i === 0 ? "ask" : f.escalate ? "ask-escalate" : undefined}
                onClick={() => onAsk(f)}
                className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[12px] font-bold transition-colors disabled:opacity-55 ${
                  f.escalate
                    ? "border-warn/40 bg-warn/[0.07] text-warn-ink"
                    : done
                      ? "border-edge2 bg-paper2 text-slate3"
                      : "border-blue-ink/20 bg-blue-pale/50 text-blue-ink"
                }`}
              >
                <span className="min-w-0 flex-1">{f.chip}</span>
                <span className="num shrink-0 whitespace-nowrap text-[9px] tracking-[0.1em] opacity-75">
                  {f.escalate ? "人へ" : done ? "回答済" : "AI"}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-0.5 text-[10px] leading-[1.7] text-pretty text-slate3">
          {jp(
            "返金・破損・例外のご相談は、AIが答えずに運営スタッフへお渡しします。",
          )}
        </p>
      </div>

      {/* ── 次へ ── */}
      {chat.some((t) => t.a) && (
        <button
          type="button"
          data-play="tolinked"
          onClick={onLinked}
          className="mt-2.5 w-full whitespace-nowrap rounded-xl bg-blue-ink py-2.5 text-[12px] font-bold text-white shadow-blue-lift"
        >
          運営画面との連動を見る
          {needCheck > 0 ? `（要確認 ${needCheck} 件）` : ""}
        </button>
      )}
    </Pane>
  );
}

/** 「…」だけの、考え中の印 */
function Dots() {
  return (
    <span aria-hidden className="inline-flex gap-[3px]">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
          className="inline-block h-[3px] w-[3px] rounded-full bg-slate3"
        />
      ))}
    </span>
  );
}

/**
 * 吹き出し。
 * ★Q と A の印を必ず付けること。
 *   色と位置だけで区別させると、印刷したときや、
 *   色が見えにくい方には、どちらの発言か分かりません。
 */
function Bubble({
  side,
  mark,
  tone = "auto",
  muted = false,
  children,
}: {
  side: "me" | "ai";
  mark: string;
  /** staff … 人（運営スタッフ）が書いたもの。AIと同じ色にしないこと */
  tone?: "auto" | "escalate" | "staff";
  muted?: boolean;
  children: React.ReactNode;
}) {
  if (side === "me") {
    return (
      <div className="flex items-start justify-end gap-2">
        <p className="max-w-[84%] rounded-2xl rounded-br-md bg-blue-ink px-3 py-2 text-[12px] leading-[1.8] text-pretty text-white">
          {children}
        </p>
        <span className="num mt-1 shrink-0 rounded-full border border-blue-ink/30 bg-blue-ink px-2 py-[3px] text-[9px] font-bold tracking-[0.12em] text-white">
          {mark}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <span
        className={`num nb mt-1 shrink-0 rounded-full border px-2 py-[3px] text-[9px] font-bold tracking-[0.12em] ${
          tone === "escalate"
            ? "border-warn/45 bg-warn/12 text-warn-ink"
            : tone === "staff"
              ? "border-ok-ink/30 bg-ok/12 text-ok-ink"
              : "border-blue-ink/18 bg-blue-pale text-blue-ink"
        }`}
      >
        {mark}
      </span>
      <div
        className={`min-w-0 flex-1 rounded-2xl rounded-tl-md border bg-white px-3 py-2 text-[12px] leading-[1.8] text-pretty shadow-lift ${
          tone === "escalate"
            ? "border-warn/35"
            : tone === "staff"
              ? "border-ok-ink/30"
              : "border-edge"
        } ${muted ? "text-slate3" : "text-slate"}`}
      >
        {children}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   08 すべて運営画面につながっています

   ★最後にこの1枚を置く理由
     ここまでの操作（引く・当選・発送依頼・問い合わせ）は、
     お客様側から見ると、ただの買い物です。
     その裏で運営者の数字が動いていたことを、最後に1枚で示します。
     ここに出す数字は説明用に書いた文字ではなく、
     運営者側の集計（左の画面）と同じ値をそのまま出しています。
   ══════════════════════════════════════════════ */

function Linked({
  view,
  needCheck,
  answered,
  onRestart,
}: {
  view: ReturnType<typeof operatorView>;
  needCheck: number;
  answered: number;
  onRestart: () => void;
}) {
  const rows = [
    { k: "残り口数", v: view.left.toLocaleString("ja-JP"), u: "口", why: "引かれた分だけ減る" },
    { k: "売上", v: view.revenue.toLocaleString("ja-JP"), u: "pt", why: "引かれた瞬間に増える" },
    { k: "未発送", v: String(view.unshipped), u: "件", why: "発送を依頼した分だけ増える" },
    { k: "要確認", v: String(needCheck), u: "件", why: "AIが答えなかった相談だけ残る" },
    /*
      ★この行を消さないこと。
        「要確認 0」だけを見せると、相談が消えてなくなったように見えます。
        人が返信したから0になった、という移り先を必ず並べます。
    */
    { k: "対応済み", v: String(answered), u: "件", why: "運営者が返信を送ると、要確認からここへ移る" },
  ];

  return (
    <Pane>
      <p className="px-0.5 pb-2 text-[13px] font-bold text-slate">
        ここまでの操作
      </p>

      <div className="rounded-2xl border border-blue-ink/20 bg-blue-pale/55 p-3.5 text-center">
        <p className="num text-[10px] tracking-[0.16em] text-blue-ink">
          CUSTOMER → OPERATOR
        </p>
        <p className="mt-2 text-[14px] font-bold leading-[1.7] text-pretty text-slate">
          <span className="inline-block">ガチャを引く・当選・発送依頼・</span>
          <span className="inline-block">問い合わせ。</span>
          <span className="inline-block">すべて運営画面に</span>
          <span className="inline-block">つながっています。</span>
        </p>
      </div>

      {/* いま運営者の画面に出ている数字。左のPC画面と同じ値 */}
      <div className="mt-2.5 space-y-1.5" data-play-linked="">
        {rows.map((r) => (
          <div
            key={r.k}
            className="flex items-center gap-2.5 rounded-xl border border-edge bg-white px-3 py-2.5 shadow-lift"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-bold text-slate">{r.k}</p>
              <p className="mt-0.5 text-[10px] leading-[1.6] text-pretty text-slate3">
                {r.why}
              </p>
            </div>
            <p className="num flex shrink-0 items-baseline gap-1 whitespace-nowrap">
              <b className="text-[19px] font-extrabold text-slate">{r.v}</b>
              <span className="text-[11px] font-semibold text-slate3">
                {r.u}
              </span>
            </p>
          </div>
        ))}
      </div>

      <p className="mt-2.5 rounded-xl border border-edge bg-paper2 px-3 py-2.5 text-[10px] leading-[1.8] text-pretty text-slate3">
        {jp(
          "この5つは、左の運営者画面に出ている数字と同じものです。日次で集計しているのではなく、お客様が操作したその場で動いています。",
        )}
      </p>

      <button
        type="button"
        onClick={onRestart}
        className="num mt-2.5 w-full whitespace-nowrap rounded-xl border border-edge bg-white py-2.5 text-[11px] font-bold tracking-[0.1em] text-slate3"
      >
        最初から見る
      </button>
    </Pane>
  );
}
