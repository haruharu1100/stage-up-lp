"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { jpy, rtpTone } from "@/lib/simulate";
import { DEMO_BADGE, demoKpi, demoKpiCards } from "@/content/demoData";
import { EV, track, trackOnce } from "@/lib/track";
import BacktestTab from "./BacktestTab";
import PriceFreshnessBadge from "../ui/PriceFreshnessBadge";

const MENU = [
  { key: "dash", label: "ダッシュボード" },
  { key: "gacha", label: "ガチャ管理" },
  { key: "backtest", label: "公開前バックテスト" },
  { key: "rtp", label: "還元率モニタ" },
  { key: "price", label: "市場価格" },
  { key: "ship", label: "発送管理" },
  { key: "audit", label: "監査ログ" },
] as const;

type MenuKey = (typeof MENU)[number]["key"];

type Gacha = {
  id: string;
  name: string;
  price: number;
  total: number;
  left: number;
  designed: number;
  remaining: number;
  market: number;
  state: "公開中" | "停止中" | "下書き";
};

const INITIAL: Gacha[] = [
  { id: "#128", name: "スニーカーBOX 第12弾", price: 1500, total: 500, left: 128, designed: 100.5, remaining: 103.2, market: 108.7, state: "公開中" },
  { id: "#131", name: "PSA10 スペシャル", price: 3000, total: 800, left: 402, designed: 98.2, remaining: 103.2, market: 104.1, state: "公開中" },
  { id: "#134", name: "家電フェス 2026", price: 1000, total: 700, left: 611, designed: 95.8, remaining: 96.4, market: 96.4, state: "公開中" },
  { id: "#136", name: "ハイブランド小物", price: 2000, total: 300, left: 88, designed: 97.4, remaining: 99.1, market: 99.1, state: "公開中" },
  { id: "#137", name: "ワンピカード 限定", price: 800, total: 1200, left: 1200, designed: 96.1, remaining: 96.1, market: 96.1, state: "下書き" },
];

const PRICES = [
  { name: "AJ1 Retro High OG / 27.5cm", bought: 42000, now: 51800, at: "2026-08-18 04:00" },
  { name: "PSA10 リザードン ex SAR", bought: 128000, now: 139500, at: "2026-08-18 04:00" },
  { name: "限定復刻 ダンク Low / 26.0cm", bought: 31000, now: 28600, at: "2026-08-18 04:00" },
  { name: "ハイブランド 二つ折り財布", bought: 68000, now: 71200, at: "2026-08-18 04:00" },
  { name: "PSA10 ピカチュウ プロモ", bought: 96000, now: 92400, at: "2026-08-18 04:00" },
];

const SHIP = [
  { user: "user_2841", item: "AJ1 Retro High OG 27.5cm", at: "08/16 21:04", state: "仕入れ待ち" },
  { user: "user_1190", item: "PSA10 リザードン ex SAR", at: "08/17 09:22", state: "梱包中" },
  { user: "user_3372", item: "限定復刻 ダンク Low 26.0cm", at: "08/17 12:41", state: "発送済" },
  { user: "user_0917", item: "ハイブランド 二つ折り財布", at: "08/18 08:15", state: "仕入れ待ち" },
  { user: "user_4402", item: "PSA10 ピカチュウ プロモ", at: "08/18 10:02", state: "梱包中" },
];

const AUDIT = [
  { t: "21:04:11", u: "user_2841", g: "#128", n: "10連", before: 138, res: "A賞 ×1 / C賞 ×9", pt: 5000, after: 128 },
  { t: "21:04:09", u: "user_1190", g: "#131", n: "1回", before: 403, res: "C賞 ×1", pt: 500, after: 402 },
  { t: "21:03:58", u: "user_3372", g: "#128", n: "5連", before: 143, res: "B賞 ×1 / C賞 ×4", pt: 2500, after: 138 },
  { t: "21:03:41", u: "user_0917", g: "#134", n: "1回", before: 612, res: "C賞 ×1", pt: 500, after: 611 },
  { t: "21:03:22", u: "user_4402", g: "#136", n: "10連", before: 98, res: "S賞 ×1 / C賞 ×9", pt: 20000, after: 88 },
  { t: "21:02:57", u: "user_2841", g: "#131", n: "1回", before: 404, res: "C賞 ×1", pt: 500, after: 403 },
];

export default function DemoConsole() {
  const [tab, setTab] = useState<MenuKey>("dash");
  const [gachas, setGachas] = useState(INITIAL);
  const [log, setLog] = useState<string[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  /** 「データを戻す」で作り直すための番号（発送・AI OPERATORの内部状態を初期化する） */
  const [nonce, setNonce] = useState(0);
  const [resetFlash, setResetFlash] = useState(false);

  /**
   * プレゼンテーションモード（/demo?presentation=true）。
   * 動画収録・商談での画面共有で使う。余計なUIを隠し、
   * キーボードだけで操作できるようにしてマウスカーソルを映さないようにする。
   */
  const [presentation, setPresentation] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const [hint, setHint] = useState(true);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 「デモをちゃんと見てもらえたか」を数えるための記録。
   * ・3画面以上を見た
   * ・または管理者操作（販売停止・発送処理など）を1回でも試した
   * のどちらかで「デモ完了」とみなす（1回だけ送信）。
   */
  const seenTabs = useRef<Set<MenuKey>>(new Set());
  const markDemoUsed = useCallback(() => {
    trackOnce(EV.demoComplete, { how: "action" });
  }, []);

  useEffect(() => {
    seenTabs.current.add(tab);
    if (seenTabs.current.size >= 3) {
      trackOnce(EV.demoComplete, { how: "tabs" });
    }
  }, [tab]);

  // 画面が狭いときはAIパネルが管理画面を覆ってしまうため、広い画面でだけ開いておく
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("presentation") === "true";
    setPresentation(p);
    setAiOpen(p || window.innerWidth >= 1024);
    // デモ画面まで来た人を数える（どの導線から来ても1回だけ）
    track(EV.demoStart, { presentation: p });
  }, []);

  /**
   * デモ用データを最初の状態へ戻す（収録のやり直しに使う）。
   * 画面の中で個別に状態を持っているパネル（発送・AI OPERATOR）も
   * nonce を変えて作り直し、「1回の操作で必ず同じ初期状態」に揃える。
   */
  const reset = useCallback(() => {
    setGachas(INITIAL);
    setLog([]);
    setTab("dash");
    setNonce((n) => n + 1);
    setResetFlash(true);
    window.setTimeout(() => setResetFlash(false), 1200);
  }, []);

  // 一定時間マウスを動かさなければカーソルを消す（録画に映り込ませない）
  useEffect(() => {
    if (!presentation) return;
    const onMove = () => {
      setCursorHidden(false);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(() => setCursorHidden(true), 2000);
    };
    onMove();
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
    };
  }, [presentation]);

  // キーボードだけで画面を切り替えられるようにする
  useEffect(() => {
    if (!presentation) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= MENU.length) {
        setTab(MENU[n - 1].key);
        setHint(false);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "a") setAiOpen((v) => !v);
      else if (k === "r") reset();
      else if (k === "h") setHint((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation, reset]);

  const danger = useMemo(
    () => gachas.filter((g) => g.state === "公開中" && g.market >= 105),
    [gachas]
  );

  const stop = (id: string) => {
    markDemoUsed();
    setGachas((gs) =>
      gs.map((g) => (g.id === id ? { ...g, state: "停止中" } : g))
    );
    setLog((l) => [
      `${new Date().toLocaleTimeString("ja-JP")} 管理者が ${id} を販売停止しました`,
      ...l,
    ]);
  };

  const resume = (id: string) => {
    markDemoUsed();
    setGachas((gs) =>
      gs.map((g) => (g.id === id ? { ...g, state: "公開中" } : g))
    );
    setLog((l) => [
      `${new Date().toLocaleTimeString("ja-JP")} 管理者が ${id} を再開しました`,
      ...l,
    ]);
  };

  return (
    <div
      data-presentation={presentation ? "true" : undefined}
      className={`min-h-screen bg-void ${
        presentation && cursorHidden ? "cursor-none" : ""
      }`}
    >
      {/* top bar */}
      <div className="sticky top-0 z-30 border-b border-white/[0.08] bg-void/85 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {!presentation && (
              <>
                <Link
                  href="/"
                  className="num whitespace-nowrap text-[11px] text-white/40 hover:text-white/80"
                >
                  ← <span className="hidden sm:inline">サイトへ</span>戻る
                </Link>
                <span className="hidden h-4 w-px bg-white/12 sm:block" />
              </>
            )}
            <span
              className={`num text-[11px] tracking-[0.16em] text-white/55 ${
                presentation ? "" : "hidden sm:inline"
              }`}
            >
              AI GACHA OS / OPERATION CONSOLE
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="num whitespace-nowrap rounded-full border border-warn/30 bg-warn/[0.08] px-2.5 py-1 text-[10px] text-warn sm:px-3">
              {presentation ? (
                DEMO_BADGE
              ) : (
                <>
                  デモ環境
                  <span className="hidden sm:inline">（データはサンプルです）</span>
                </>
              )}
            </span>
            {presentation && (
              <button
                type="button"
                onClick={reset}
                className={`num shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[10px] tracking-[0.12em] transition-colors ${
                  resetFlash
                    ? "border-ok/50 bg-ok/[0.12] text-ok"
                    : "border-white/12 text-white/45 hover:border-white/30 hover:text-white/85"
                }`}
              >
                {resetFlash ? "RESET DONE" : "RESET DEMO"}
              </button>
            )}
            {!presentation && (
              <button
                type="button"
                onClick={() => setAiOpen((v) => !v)}
                className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-blue/35 bg-blue/10 px-2.5 py-1.5 text-[11px] text-blue-bright sm:px-3"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-blue-bright animate-pulseline" />
                AI<span className="hidden sm:inline"> OPERATOR</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 収録・画面共有用の操作ヒント（Hキーで消せる。録画には映さない想定） */}
      {presentation && hint && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-white/12 bg-void/95 px-4 py-2.5 text-[11px] text-white/55 shadow-panel backdrop-blur">
          <span className="num">
            1〜7 画面切替 ／ A AI OPERATOR ／ R RESET DEMO ／ H このヒントを消す
          </span>
        </div>
      )}

      <div className="flex">
        {/* sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100vh-56px)] w-[200px] shrink-0 border-r border-white/[0.07] py-4 lg:block">
          {MENU.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-current={tab === m.key ? "page" : undefined}
              onClick={() => setTab(m.key)}
              className={`relative mx-2.5 mb-1 block w-[calc(100%-20px)] rounded-lg px-3 py-2.5 text-left text-[12.5px] transition-colors ${
                tab === m.key
                  ? "bg-blue/15 text-[#CFE0FF]"
                  : "text-white/40 hover:bg-white/[0.03] hover:text-white/70"
              }`}
            >
              {tab === m.key && (
                <span className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-full bg-blue-bright" />
              )}
              {m.label}
            </button>
          ))}

          {danger.length > 0 && (
            <div className="mx-2.5 mt-6 rounded-xl border border-danger/30 bg-danger/[0.08] p-3">
              <p className="text-[10px] text-danger">要対応</p>
              <p className="mt-1.5 text-[11px] leading-[1.7] text-[#FFD7D7]">
                実還元率が しきい値を超えているガチャが {danger.length} 本あります
              </p>
            </div>
          )}
        </aside>

        {/* main */}
        <main
          className={`min-w-0 flex-1 p-4 transition-[padding] sm:p-6 ${
            aiOpen ? "sm:pr-[384px]" : ""
          }`}
        >
          <h1 className="sr-only">AI GACHA OS 管理画面デモ</h1>

          {/* 常時表示のデモ注記（本番管理画面と誤認させない） */}
          {!presentation && (
            <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3 text-[11px] leading-[1.8] text-white/70">
              <span className="num rounded border border-warn/35 bg-warn/[0.1] px-1.5 py-0.5 text-[10px] text-warn">
                DEMO
              </span>
              <span>
                これは本番を模したサンプル管理画面です。サンプルデータのみを表示しており、本番環境には接続していません。ここでの操作は保存されません。
              </span>
              <button
                type="button"
                onClick={reset}
                className="num ml-auto shrink-0 rounded-lg border border-white/12 px-2.5 py-1 text-[10px] text-white/50 transition-colors hover:text-white/85"
              >
                データを初期状態に戻す
              </button>
            </div>
          )}

          {/* mobile tabs */}
          <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
            {MENU.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-current={tab === m.key ? "page" : undefined}
                onClick={() => setTab(m.key)}
                className={`shrink-0 rounded-full border px-3.5 py-2 text-[11px] ${
                  tab === m.key
                    ? "border-blue/40 bg-blue/15 text-blue-bright"
                    : "border-white/10 text-white/45"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {tab === "dash" && (
            <Dash gachas={gachas} onStop={stop} presentation={presentation} />
          )}
          {tab === "gacha" && (
            <GachaList gachas={gachas} onStop={stop} onResume={resume} />
          )}
          {tab === "backtest" && <BacktestTab />}
          {tab === "rtp" && <RtpTab gachas={gachas} onStop={stop} />}
          {tab === "price" && <PriceTab />}
          {tab === "ship" && (
            <ShipTab
              key={`ship-${nonce}`}
              onLog={(line) => {
                markDemoUsed();
                setLog((l) => [line, ...l]);
              }}
            />
          )}
          {tab === "audit" && <AuditTab log={log} />}
        </main>

        {aiOpen && (
          <AiOperator
            key={`ai-${nonce}`}
            gachas={gachas}
            onClose={() => setAiOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- panels ---------- */

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-3.5">
        <span className="num text-[10px] tracking-[0.2em] text-white/45">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

const kpiTone: Record<"ink" | "ok" | "warn" | "danger", string> = {
  ink: "text-ink",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

function Dash({
  gachas,
  onStop,
  presentation,
}: {
  gachas: Gacha[];
  onStop: (id: string) => void;
  presentation: boolean;
}) {
  const kpis = [
    { l: "本日売上", v: "¥1,284,300", d: "+12.4%" },
    { l: "月間売上", v: `¥${demoKpi.monthlySalesYen.toLocaleString("ja-JP")}`, d: "+6.8%" },
    { l: "プレイ回数", v: "3,914", d: "+8.1%" },
    { l: "未発送", v: `${demoKpi.unshipped}`, d: "要対応" },
  ];
  const spark = [28, 36, 31, 48, 42, 58, 52, 67, 61, 78, 72, 90];
  const alerts = gachas.filter((g) => g.state === "公開中" && g.market >= 105);

  return (
    <div className="space-y-3">
      {/* 収録モードでは、動画で読み上げる6つの数字を固定で並べる */}
      {presentation ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {demoKpiCards.map((k) => (
            <div
              key={k.label}
              className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5"
            >
              <p className="text-[11px] leading-tight text-white/40">{k.label}</p>
              <p
                className={`num mt-2 truncate text-[17px] font-bold tracking-tight sm:text-[21px] xl:text-[24px] ${kpiTone[k.tone]}`}
              >
                {k.value}
              </p>
              <p className="num mt-1 text-[10px] text-white/30">{k.note}</p>
            </div>
          ))}
        </div>
      ) : (
        /*
          ★4つ横並びにするのは、本当に幅があるときだけにすること。
            lg（1024px）で4列にしていたところ、1枚あたりの中身が53pxしかなく、
            「¥12,840,000」（145px必要）が枠から飛び出していました。
            1280pxでも足りません。売上の金額が枠から出ているのは、
            会計まわりのシステムとして、いちばん見せてはいけない壊れ方です。
        */
        <div className="grid grid-cols-2 gap-3 min-[1400px]:grid-cols-4">
          {kpis.map((k) => (
            <div
              key={k.l}
              className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5"
            >
              <p className="text-[11px] text-white/40">{k.l}</p>
              <p className="num mt-2 truncate text-[17px] font-bold text-ink sm:text-[22px]">
                {k.v}
              </p>
              <p className="num mt-1 text-[10px] text-ok">{k.d}</p>
            </div>
          ))}
        </div>
      )}

      {presentation && (
        <p className="num text-[10px] leading-[1.9] tracking-[0.08em] text-white/30">
          {DEMO_BADGE}／上記はすべて説明用のサンプル数値です。実在の運営実績ではありません。
        </p>
      )}

      {alerts.map((a) => (
        <div
          key={a.id}
          className="flex flex-col gap-3 rounded-2xl border border-danger/35 bg-danger/[0.09] px-5 py-4 sm:flex-row sm:items-center"
        >
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
            <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-danger animate-pulseline sm:mt-0" />
            <p className="min-w-0 flex-1 text-[12px] leading-[1.8] text-[#FFD7D7]">
              警告：{a.id} {a.name} の市場価格ベース実還元率が{" "}
              <span className="num font-bold">{a.market.toFixed(1)}%</span>{" "}
              に上昇しました（しきい値 105%）
            </p>
          </div>
          <button
            type="button"
            onClick={() => onStop(a.id)}
            className="shrink-0 rounded-lg bg-danger/85 px-4 py-2 text-[11px] font-bold text-white hover:bg-danger"
          >
            販売停止
          </button>
        </div>
      ))}

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Card title="売上推移 / 直近30日" right={<span className="num text-[10px] text-white/30">+38.2%</span>}>
          <div className="p-5">
            <svg viewBox="0 0 320 110" className="h-32 w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="dsp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d={`M0,110 ${spark.map((v, i) => `L${(i * 320) / (spark.length - 1)},${110 - v}`).join(" ")} L320,110 Z`}
                fill="url(#dsp)"
              />
              <path
                d={spark.map((v, i) => `${i ? "L" : "M"}${(i * 320) / (spark.length - 1)},${110 - v}`).join(" ")}
                fill="none"
                stroke="#60A5FA"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </Card>

        <Card title="CURRENT REAL RTP / #128">
          <div className="space-y-4 p-5">
            {[
              { l: "設定時還元率", v: gachas[0].designed },
              { l: "残数ベース", v: gachas[0].remaining },
              { l: "市場価格ベース", v: gachas[0].market },
            ].map((g) => {
              const t = rtpTone(g.v);
              return (
                <div key={g.l}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-white/45">{g.l}</span>
                    <span className={`num text-[16px] font-bold ${t.color}`}>
                      {g.v.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className={`h-full rounded-full ${t.bar}`}
                      style={{ width: `${Math.min(100, (g.v / 120) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: Gacha["state"] }) {
  const cls =
    state === "公開中"
      ? "bg-ok/12 text-ok"
      : state === "停止中"
        ? "bg-danger/15 text-danger"
        : "bg-white/6 text-white/45";
  return <span className={`rounded-full px-2.5 py-1 text-[10px] ${cls}`}>{state}</span>;
}

function GachaList({
  gachas,
  onStop,
  onResume,
}: {
  gachas: Gacha[];
  onStop: (id: string) => void;
  onResume: (id: string) => void;
}) {
  return (
    <Card
      title="GACHA MANAGEMENT"
      right={<span className="text-[11px] text-white/35">全 {gachas.length} 本</span>}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid grid-cols-[64px_1fr_84px_96px_88px_84px_100px] gap-3 border-b border-white/8 bg-white/[0.02] px-5 py-2.5 text-[10px] text-white/35">
            <span>ID</span>
            <span>ガチャ名</span>
            <span className="text-right">1回料金</span>
            <span className="text-right">残 / 総口数</span>
            <span className="text-right">実還元率</span>
            <span>状態</span>
            <span className="text-right">操作</span>
          </div>
          {gachas.map((g) => {
            const t = rtpTone(g.market);
            return (
              <div
                key={g.id}
                className="grid grid-cols-[64px_1fr_84px_96px_88px_84px_100px] items-center gap-3 border-b border-white/5 px-5 py-3.5 text-[12px] last:border-0"
              >
                <span className="num text-white/40">{g.id}</span>
                <span className="truncate text-white/80">{g.name}</span>
                <span className="num text-right text-white/50">{jpy(g.price)}</span>
                <span className="num text-right text-white/50">
                  {g.left} / {g.total}
                </span>
                <span className={`num text-right font-bold ${t.color}`}>
                  {g.market.toFixed(1)}%
                </span>
                <StateBadge state={g.state} />
                <div className="text-right">
                  {g.state === "公開中" ? (
                    <button
                      type="button"
                      onClick={() => onStop(g.id)}
                      className="rounded-lg border border-danger/35 px-3 py-1.5 text-[10px] text-danger hover:bg-danger/10"
                    >
                      販売停止
                    </button>
                  ) : g.state === "停止中" ? (
                    <button
                      type="button"
                      onClick={() => onResume(g.id)}
                      className="rounded-lg border border-white/12 px-3 py-1.5 text-[10px] text-white/60 hover:border-white/30"
                    >
                      再開
                    </button>
                  ) : (
                    <span className="text-[10px] text-white/25">承認待ち</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t border-white/8 px-5 py-3.5">
        <p className="text-[11px] leading-[1.9] text-white/40">
          AIが設計したガチャは「下書き」として登録されます。管理者が内容を確認して承認するまで公開されません。
        </p>
      </div>
    </Card>
  );
}

function RtpTab({ gachas, onStop }: { gachas: Gacha[]; onStop: (id: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { l: "注意", v: "105%", c: "border-warn/30 bg-warn/[0.06] text-warn", d: "管理画面に黄色で表示" },
          { l: "警告", v: "110%", c: "border-danger/30 bg-danger/[0.06] text-danger", d: "LINE / メールで通知" },
          { l: "緊急", v: "115%", c: "border-danger/50 bg-danger/[0.12] text-danger", d: "即時停止を推奨（自動停止は任意設定）" },
        ].map((x) => (
          <div key={x.l} className={`rounded-2xl border p-5 ${x.c}`}>
            <p className="num text-[10px] tracking-[0.2em]">{x.l}</p>
            <p className="num mt-2 text-[26px] font-bold">{x.v}</p>
            <p className="mt-2 text-[11px] leading-[1.8] text-white/50">{x.d}</p>
          </div>
        ))}
      </div>

      <Card title="REAL TIME RTP / 公開中の全ガチャ">
        <div className="divide-y divide-white/5">
          {gachas
            .filter((g) => g.state !== "下書き")
            .map((g) => {
              const t = rtpTone(g.market);
              return (
                <div key={g.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="num text-[11px] text-white/35">{g.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">
                      {g.name}
                    </span>
                    <span className={`num text-[15px] font-bold ${t.color}`}>
                      {g.market.toFixed(1)}%
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] ${t.ring} ${t.color}`}>
                      {t.label}
                    </span>
                    {g.state === "公開中" && g.market >= 105 && (
                      <button
                        type="button"
                        onClick={() => onStop(g.id)}
                        className="rounded-lg bg-danger/85 px-3 py-1.5 text-[10px] font-bold text-white"
                      >
                        販売停止
                      </button>
                    )}
                    {g.state === "停止中" && (
                      <span className="text-[10px] text-danger">停止中</span>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {[
                      { l: "設定時", v: g.designed },
                      { l: "残数ベース", v: g.remaining },
                      { l: "市場価格ベース", v: g.market },
                    ].map((x) => (
                      <div key={x.l}>
                        <div className="flex items-baseline justify-between">
                          <span className="text-[10px] text-white/35">{x.l}</span>
                          <span className={`num text-[11px] ${rtpTone(x.v).color}`}>
                            {x.v.toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
                          <div
                            className={`h-full rounded-full ${rtpTone(x.v).bar}`}
                            style={{ width: `${Math.min(100, (x.v / 120) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      </Card>
    </div>
  );
}

function PriceTab() {
  return (
    <Card
      title="MARKET PRICE"
      right={<PriceFreshnessBadge />}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 border-b border-white/8 bg-white/[0.02] px-5 py-2.5 text-[10px] text-white/35">
            <span>景品</span>
            <span className="text-right">購入時価格</span>
            <span className="text-right">現在価格</span>
            <span className="text-right">価格差</span>
            <span className="text-right">変動率</span>
          </div>
          {PRICES.map((p) => {
            const diff = p.now - p.bought;
            const rate = (diff / p.bought) * 100;
            const up = diff > 0;
            return (
              <div
                key={p.name}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-3 border-b border-white/5 px-5 py-3.5 text-[12px] last:border-0"
              >
                <span className="truncate text-white/75">{p.name}</span>
                <span className="num text-right text-white/40">{jpy(p.bought)}</span>
                <span className={`num text-right font-bold ${up ? "text-danger" : "text-ok"}`}>
                  {jpy(p.now)}
                </span>
                <span className={`num text-right ${up ? "text-danger" : "text-ok"}`}>
                  {up ? "+" : "−"}
                  {jpy(Math.abs(diff)).replace("¥", "¥")}
                </span>
                <span className={`num text-right ${up ? "text-danger" : "text-ok"}`}>
                  {up ? "▲" : "▼"} {Math.abs(rate).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t border-white/8 px-5 py-3.5">
        <p className="text-[11px] leading-[1.9] text-white/40">
          価格の取得元は、正式に利用可能なデータソース・API・許諾済みデータを使う前提で設計します。対象ジャンルごとに、導入時に利用規約と取得方法を確認して決定します。
        </p>
      </div>
    </Card>
  );
}

/** 追跡番号の見本（サンプルデータ。実在の伝票ではありません） */
const trackingNo = (i: number) =>
  `4${(812_345_670_000 + i * 7_341).toString().slice(0, 11)}`;

function ShipTab({ onLog }: { onLog: (line: string) => void }) {
  type Row = (typeof SHIP)[number] & { tracking?: string };
  const [rows, setRows] = useState<Row[]>(() => SHIP.map((s) => ({ ...s })));
  const [picked, setPicked] = useState<string[]>([]);
  const [notified, setNotified] = useState(0);

  const idOf = (s: Row) => s.user + s.item;
  const pending = rows.filter((s) => s.state !== "発送済");

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const toggleAll = () =>
    setPicked((p) =>
      p.length === pending.length ? [] : pending.map((s) => idOf(s))
    );

  /** 選択した依頼をまとめて発送済みにし、追跡番号を発行して通知したことにする */
  const shipPicked = () => {
    if (picked.length === 0) return;
    const n = picked.length;
    setRows((rs) =>
      rs.map((s, i) =>
        picked.includes(idOf(s))
          ? { ...s, state: "発送済" as const, tracking: trackingNo(i + 1) }
          : s
      )
    );
    const at = new Date().toLocaleTimeString("ja-JP");
    onLog(`${at} 発送処理 ${n}件 － 伝票データを書き出しました`);
    onLog(`${at} 追跡番号を ${n}件の会員へ自動通知しました`);
    setNotified((v) => v + n);
    setPicked([]);
  };

  const allPicked = pending.length > 0 && picked.length === pending.length;

  return (
    <Card
      title="SHIPPING QUEUE"
      right={
        <div className="flex items-center gap-2">
          <span className="num text-[10px] text-white/35">
            未発送 {pending.length} 件
          </span>
          <button
            type="button"
            onClick={shipPicked}
            disabled={picked.length === 0}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${
              picked.length === 0
                ? "cursor-not-allowed border border-white/10 text-white/25"
                : "bg-blue text-white hover:bg-blue-bright"
            }`}
          >
            {picked.length === 0
              ? "発送処理"
              : `選択した ${picked.length} 件を発送処理`}
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[36px_100px_1fr_100px_88px_136px] gap-3 border-b border-white/8 bg-white/[0.02] px-5 py-2.5 text-[10px] text-white/35">
            <button
              type="button"
              onClick={toggleAll}
              aria-label="未発送をすべて選択"
              className={`h-4 w-4 rounded border transition-colors ${
                allPicked
                  ? "border-blue bg-blue"
                  : "border-white/25 hover:border-white/50"
              }`}
            />
            <span>会員</span>
            <span>景品</span>
            <span>依頼日時</span>
            <span>状態</span>
            <span className="text-right">追跡番号</span>
          </div>
          {rows.map((s) => {
            const id = idOf(s);
            const on = picked.includes(id);
            const done = s.state === "発送済";
            return (
              <div
                key={id}
                className={`grid grid-cols-[36px_100px_1fr_100px_88px_136px] items-center gap-3 border-b border-white/5 px-5 py-3.5 text-[12px] transition-colors last:border-0 ${
                  on ? "bg-blue/[0.06]" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => !done && toggle(id)}
                  disabled={done}
                  aria-label={`${s.item} を選択`}
                  aria-pressed={on}
                  className={`h-4 w-4 rounded border transition-colors ${
                    done
                      ? "cursor-default border-white/8"
                      : on
                        ? "border-blue bg-blue"
                        : "border-white/25 hover:border-white/50"
                  }`}
                />
                <span className="num text-white/40">{s.user}</span>
                <span className="truncate text-white/80">{s.item}</span>
                <span className="num text-white/35">{s.at}</span>
                <span
                  className={`rounded-full px-2.5 py-1 text-center text-[10px] ${
                    done
                      ? "bg-ok/12 text-ok"
                      : s.state === "梱包中"
                        ? "bg-blue/15 text-blue-bright"
                        : "bg-warn/12 text-warn"
                  }`}
                >
                  {s.state}
                </span>
                <span
                  className={`num text-right text-[10.5px] ${
                    s.tracking ? "text-ok" : "text-white/20"
                  }`}
                >
                  {s.tracking ?? "－"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-white/8 px-5 py-3.5">
        {notified > 0 ? (
          <p className="text-[11.5px] leading-[1.85] text-ok">
            {notified}件の発送処理が完了しました。伝票データを書き出し、追跡番号を会員へ通知済みです。
          </p>
        ) : (
          <p className="text-[11.5px] leading-[1.85] text-white/35">
            発送する依頼を選んで「発送処理」を押すと、伝票データの書き出しと追跡番号の通知までが1回で終わります。
          </p>
        )}
      </div>
    </Card>
  );
}

function AuditTab({ log }: { log: string[] }) {
  return (
    <div className="space-y-3">
      {log.length > 0 && (
        <Card title="ADMIN OPERATION LOG">
          <div className="divide-y divide-white/5">
            {log.map((l, i) => (
              <p key={i} className="num px-5 py-3 text-[11px] text-white/55">
                {l}
              </p>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="LOTTERY AUDIT LOG"
        right={<span className="text-[11px] text-white/35">抽選1件ごとに記録</span>}
      >
        <div className="overflow-x-auto">
          <div className="min-w-[780px]">
            <div className="grid grid-cols-[86px_92px_62px_62px_84px_1fr_84px_84px] gap-2 border-b border-white/8 bg-white/[0.02] px-5 py-2.5 text-[10px] text-white/35">
              <span>時刻</span>
              <span>会員</span>
              <span>ガチャ</span>
              <span>回数</span>
              <span className="text-right">抽選前残数</span>
              <span>結果</span>
              <span className="text-right">消費pt</span>
              <span className="text-right">抽選後残数</span>
            </div>
            {AUDIT.map((l) => (
              <div
                key={l.t}
                className="num grid grid-cols-[86px_92px_62px_62px_84px_1fr_84px_84px] items-center gap-2 border-b border-white/5 px-5 py-3 text-[11px] last:border-0"
              >
                <span className="text-white/35">{l.t}</span>
                <span className="text-white/50">{l.u}</span>
                <span className="text-white/50">{l.g}</span>
                <span className="text-white/50">{l.n}</span>
                <span className="text-right text-white/40">{l.before}</span>
                <span className="truncate text-white/75">{l.res}</span>
                <span className="text-right text-white/40">
                  {l.pt.toLocaleString("ja-JP")}
                </span>
                <span className="text-right font-bold text-white/75">{l.after}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------- AI OPERATOR ---------- */

type Tone = "danger" | "warn" | "ok" | "blue";

/** 優先順位つきのタスク（AI OPERATORが毎朝出す「今日やること」） */
type AiTask = {
  level: "最優先" | "高" | "中" | "低";
  tone: Tone;
  title: string;
  detail: string;
  meta: string;
  /** 対応にかかる目安時間 */
  cost: string;
};

type AiCard = {
  tone: Tone;
  badge: string;
  headline: string;
  stats?: { l: string; v: string; tone?: Tone }[];
  rows?: { l: string; v: string; tone?: Tone }[];
  tasks?: AiTask[];
  reason?: string;
  actions?: string[];
};

const toneText: Record<Tone, string> = {
  danger: "text-danger",
  warn: "text-warn",
  ok: "text-ok",
  blue: "text-blue-bright",
};

const toneChip: Record<Tone, string> = {
  danger: "border-danger/35 bg-danger/[0.10] text-danger",
  warn: "border-warn/35 bg-warn/[0.10] text-warn",
  ok: "border-ok/35 bg-ok/[0.10] text-ok",
  blue: "border-blue/35 bg-blue/[0.10] text-blue-bright",
};

function AnswerCard({ c }: { c: AiCard }) {
  return (
    <div className="overflow-hidden rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.035]">
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5">
        <span
          className={`num rounded-full border px-2.5 py-1 text-[9.5px] tracking-[0.12em] ${toneChip[c.tone]}`}
        >
          {c.badge}
        </span>
      </div>

      <div className="px-4 py-3.5">
        <p className="text-[13px] font-bold leading-[1.75] text-white/90">
          {c.headline}
        </p>

        {c.stats && (
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            {c.stats.map((s) => (
              <div
                key={s.l}
                className="rounded-xl border border-white/8 bg-void/40 px-3 py-2.5"
              >
                <p className="text-[10px] leading-tight text-white/40">{s.l}</p>
                <p
                  className={`num mt-1.5 text-[14px] font-bold ${
                    s.tone ? toneText[s.tone] : "text-ink"
                  }`}
                >
                  {s.v}
                </p>
              </div>
            ))}
          </div>
        )}

        {c.rows && (
          <div className="mt-3.5 divide-y divide-white/6 rounded-xl border border-white/8 bg-void/40">
            {c.rows.map((r) => (
              <div
                key={r.l + r.v}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <span className="min-w-0 truncate text-[11.5px] text-white/60">
                  {r.l}
                </span>
                <span
                  className={`num shrink-0 text-[12px] font-bold ${
                    r.tone ? toneText[r.tone] : "text-white/80"
                  }`}
                >
                  {r.v}
                </span>
              </div>
            ))}
          </div>
        )}

        {c.tasks && (
          <ol className="mt-3.5 space-y-2">
            {c.tasks.map((t, i) => (
              <li
                key={t.title}
                className={`rounded-xl border px-3.5 py-3 ${
                  i === 0
                    ? "border-danger/30 bg-danger/[0.06]"
                    : "border-white/8 bg-void/40"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`num mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${toneChip[t.tone]}`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`num rounded border px-1.5 py-0.5 text-[9px] ${toneChip[t.tone]}`}
                      >
                        {t.level}
                      </span>
                      <span className="text-[12px] font-bold text-white/90">
                        {t.title}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-[1.85] text-white/60">
                      {t.detail}
                    </p>
                    <div className="num mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/40">
                      <span>{t.meta}</span>
                      <span>目安 {t.cost}</span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        {c.reason && (
          <div className="mt-3.5 rounded-xl border border-white/8 bg-void/30 px-3.5 py-3">
            <p className="num text-[9.5px] tracking-[0.16em] text-white/35">根拠</p>
            <p className="mt-1.5 text-[11.5px] leading-[1.9] text-white/60">
              {c.reason}
            </p>
          </div>
        )}

        {c.actions && (
          <div className="mt-3">
            <p className="num text-[9.5px] tracking-[0.16em] text-white/35">
              おすすめの対応
            </p>
            <ul className="mt-2 space-y-1.5">
              {c.actions.map((a) => (
                <li
                  key={a}
                  className="flex gap-2.5 text-[11.5px] leading-[1.85] text-white/70"
                >
                  <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-blue-bright" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

type AiMsg =
  | { role: "user"; text: string }
  | { role: "ai"; card: AiCard };

const QUESTIONS = [
  "今日危険なガチャは？",
  "実還元率110%超えは？",
  "未発送は何件？",
  "売上が悪いガチャは？",
  "価格高騰している商品は？",
  "今日何をすればいい？",
] as const;

type Question = (typeof QUESTIONS)[number];

function answer(q: Question, gachas: Gacha[]): AiCard {
  const live = gachas.filter((g) => g.state === "公開中");
  const danger = live.filter((g) => g.market >= 105);
  const over110 = live.filter((g) => g.market >= 110);
  const risen = PRICES.filter((p) => p.now > p.bought).sort(
    (a, b) => b.now / b.bought - a.now / a.bought
  );

  switch (q) {
    case "今日危険なガチャは？":
      return {
        tone: danger.length ? "danger" : "ok",
        badge: "RTP ALERT",
        headline: danger.length
          ? `公開中${live.length}本のうち、${danger.length}本が危険水域（市場価格ベース実還元率105%以上）です。`
          : `公開中${live.length}本すべて、市場価格ベースの実還元率は105%未満です。危険水域のガチャはありません。`,
        rows: danger.length
          ? danger.map((g) => ({
              l: `${g.id} ${g.name}`,
              v: `${g.market.toFixed(1)}%`,
              tone: (g.market >= 110 ? "danger" : "warn") as Tone,
            }))
          : undefined,
        stats: danger.length
          ? [
              { l: "公開中", v: `${live.length}本` },
              {
                l: "危険水域",
                v: `${danger.length}本`,
                tone: "danger" as Tone,
              },
            ]
          : undefined,
        reason:
          "設計時の還元率ではなく、「残っている景品 ÷ 残っている口数」で再計算した実還元率に、登録済みの市場価格を掛けて判定しています。上位賞が早く抜けた、または景品の相場が上がった場合に105%を超えます。",
        actions: danger.length
          ? [
              `${danger[0].id} は残${danger[0].left}口。この条件のまま売り切ると粗利を大きく圧迫するため、販売停止を検討してください。`,
              "停止せず続ける場合は、景品の追加投入で残数ベースの分母を戻す方法もあります。",
              "市場価格が一時的な高騰なら、価格の再取得後に再判定できます。",
            ]
          : ["対応は不要です。次回の価格更新（毎日04:00想定）後に再確認してください。"],
      };

    case "実還元率110%超えは？":
      return {
        tone: over110.length ? "danger" : "ok",
        badge: "RTP > 110%",
        headline: over110.length
          ? `${over110.length}本が110%を超えています。販売が進むほど粗利が削られる可能性が高いため、確認してください。`
          : "110%を超えているガチャはありません。現時点で最も高いのは下記です。",
        rows: (over110.length ? over110 : live)
          .slice()
          .sort((a, b) => b.market - a.market)
          .slice(0, 3)
          .map((g) => ({
            l: `${g.id} ${g.name}`,
            v: `${g.market.toFixed(1)}%`,
            tone: (g.market >= 110
              ? "danger"
              : g.market >= 105
                ? "warn"
                : "ok") as Tone,
          })),
        reason:
          "110%は「景品の価値が売上を10%上回っている」状態です。実還元率は残数と市場価格の両方で動くため、公開後も毎日変わります。",
        actions: over110.length
          ? [
              "対象ガチャを停止し、構成を組み直してから再公開してください。",
              "同ジャンルの他ガチャも、同じ相場変動の影響を受けている可能性があります。",
            ]
          : [
              "しきい値（既定105%/110%）は運営方針に合わせて変更できます。",
              "しきい値を超えたときだけ通知を受け取る設定にしておくと、毎日見に来る必要がなくなります。",
            ],
      };

    case "未発送は何件？":
      return {
        tone: "warn",
        badge: "SHIPPING",
        headline:
          "未発送は26件です。うち18件は、いま伝票データを書き出せます。",
        stats: [
          { l: "未発送 合計", v: "26件", tone: "warn" },
          { l: "書き出し待ち", v: "18件", tone: "blue" },
          { l: "仕入れ待ち", v: "8件" },
          { l: "同梱まとめ対象", v: "3件", tone: "ok" },
        ],
        reason:
          "「仕入れ待ち」は手元に在庫がなく、発送できない状態のものです。同一ユーザーの複数当選は、同梱候補として自動でまとめています。",
        actions: [
          "書き出し待ち18件を選択して、伝票データ（CSV）を生成してください。",
          "発送後は、追跡番号入りのCSVを取り込むと発送済みに一括更新されます。",
          "仕入れ待ち8件は、仕入れ予定日を入れておくと問い合わせ時の回答に使われます。",
        ],
      };

    case "売上が悪いガチャは？":
      return {
        tone: "warn",
        badge: "SALES",
        headline:
          "公開から日が経っているのに消化率が低いガチャが2本あります。",
        rows: live
          .slice()
          .map((g) => ({
            g,
            sold: ((g.total - g.left) / g.total) * 100,
          }))
          .sort((a, b) => a.sold - b.sold)
          .slice(0, 3)
          .map(({ g, sold }) => ({
            l: `${g.id} ${g.name}`,
            v: `消化 ${sold.toFixed(0)}%`,
            tone: (sold < 20 ? "warn" : sold < 50 ? "blue" : "ok") as Tone,
          })),
        reason:
          "消化率＝（総口数 − 残口数）÷ 総口数。消化が伸びないガチャは、上位賞の見え方が弱いか、単価が客層に合っていないことが多い傾向です。",
        actions: [
          "上位賞の内容を1点だけ入れ替えて、見え方を強くする案を作れます。",
          "消化率が低いまま在庫を寝かせるより、景品を別ガチャへ移す判断もできます。",
          "この分析はデモ用の簡易ロジックです。本番では期間・流入元も含めて評価します。",
        ],
      };

    case "価格高騰している商品は？":
      return {
        tone: "warn",
        badge: "PRICE WATCH",
        headline: `登録商品のうち${risen.length}点で、仕入れ時より価格が上がっています。`,
        rows: risen.slice(0, 4).map((p) => {
          const up = ((p.now - p.bought) / p.bought) * 100;
          return {
            l: p.name,
            v: `${jpy(p.bought)} → ${jpy(p.now)}（+${up.toFixed(1)}%）`,
            tone: (up >= 20 ? "danger" : "warn") as Tone,
          };
        }),
        reason:
          "景品の相場が上がると、同じ構成のままでも実還元率が上がり、利益が減ります。価格データは、正式に利用可能なデータソース・API・許諾済みデータと接続する前提で設計しています。",
        actions: [
          "高騰した景品を含むガチャの実還元率を、先に確認してください。",
          "値上がり分が大きい景品は、別ガチャの目玉に回すと訴求を強くできます。",
          "更新頻度（既定1日1回）は運営に合わせて調整できます。",
        ],
      };

    case "今日何をすればいい？":
    default: {
      const top = danger[0];
      const risenTop = risen[0];
      const tasks: AiTask[] = [];

      if (top) {
        tasks.push({
          level: "最優先",
          tone: "danger",
          title: `${top.id} ${top.name} の販売可否を決める`,
          detail: `市場価格ベースの実還元率が ${top.market.toFixed(1)}%。残 ${top.left} 口。停止・景品差し替え・口数調整のいずれかを選んでください。`,
          meta: "粗利への影響が最も大きい",
          cost: "5分",
        });
      }
      if (risenTop) {
        const up = ((risenTop.now - risenTop.bought) / risenTop.bought) * 100;
        tasks.push({
          level: "高",
          tone: "warn",
          title: `${risenTop.name} の登録価格を更新する`,
          detail: `仕入時 ${jpy(risenTop.bought)} に対し現在 ${jpy(risenTop.now)}（+${up.toFixed(1)}%）。この景品を含む全ガチャの実還元率が再計算されます。`,
          meta: "他ガチャにも波及する",
          cost: "3分",
        });
      }
      tasks.push({
        level: "高",
        tone: "blue",
        title: "未発送 26 件を処理する",
        detail:
          "うち 18 件は伝票データをいますぐ書き出せます。残り 8 件は仕入れ待ちのため、仕入れ予定日を入れておくと問い合わせ時の回答に使われます。",
        meta: "同梱まとめ対象 3 件",
        cost: "15分",
      });
      tasks.push({
        level: "中",
        tone: "warn",
        title: "AIが答えられなかった問い合わせ 4 件を見る",
        detail:
          "本日の問い合わせ 37 件のうち 33 件はAIが一次回答済みです。返金・補償に関する 4 件だけが担当者へ回っています。",
        meta: "一次回答率 89%",
        cost: "10分",
      });
      tasks.push({
        level: "低",
        tone: "ok",
        title: "広告費が売上を上回っているガチャを確認する",
        detail:
          "#134 は広告経由の売上に対して広告費の比率が高い状態です。配信を止めるか、訴求を作り直すかを判断してください。",
        meta: "急ぎではない",
        cost: "10分",
      });

      return {
        tone: "blue",
        badge: "MORNING BRIEF",
        headline: `今日やることは ${tasks.length} 件です。上から順に進めれば、重要なものから片づきます。`,
        tasks,
        reason:
          "実還元率・市場価格・発送・問い合わせ・広告の5つを毎朝スキャンし、しきい値を超えたものだけを、粗利への影響が大きい順に並べています。何も超えていない日は「対応なし」と表示されます。",
        actions: [
          "上から順に進めれば、判断が必要なものが先に終わります。",
          "しきい値と並び順の基準は、運営方針に合わせて変更できます。",
          "この一覧は、毎朝メール／LINE で受け取る設定にもできます。",
        ],
      };
    }
  }
}

function AiOperator({
  gachas,
  onClose,
}: {
  gachas: Gacha[];
  onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<AiMsg[]>([
    {
      role: "ai",
      card: {
        tone: "blue",
        badge: "AI OPERATOR",
        headline:
          "運営データを見ています。気になることを聞いてください。下のボタンからも選べます。",
        reason:
          "このデモでは、画面に表示されているサンプルデータをそのまま参照して回答しています。",
      },
    },
  ]);

  const ask = (q: Question) => {
    setMsgs((m) => [
      ...m,
      { role: "user", text: q },
      { role: "ai", card: answer(q, gachas) },
    ]);
  };

  return (
    <aside className="fixed bottom-0 right-0 top-14 z-20 flex w-full flex-col border-l border-white/[0.08] bg-panel/95 backdrop-blur-xl sm:w-[380px]">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-bright/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-bright" />
          </span>
          <span className="num text-[10.5px] tracking-[0.16em] text-white/70">
            AI OPERATOR
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="AIオペレーターを閉じる"
          className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/50 transition hover:border-white/25 hover:text-white/80"
        >
          閉じる
        </button>
      </div>

      {/* messages */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm border border-blue/25 bg-blue/[0.12] px-3.5 py-2.5 text-[12px] leading-[1.7] text-white/85">
                {m.text}
              </p>
            </div>
          ) : (
            <AnswerCard key={i} c={m.card} />
          )
        )}
      </div>

      {/* footer */}
      <div className="shrink-0 border-t border-white/[0.08] px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => ask(q)}
              className="rounded-full border border-white/12 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/65 transition hover:border-blue/40 hover:bg-blue/[0.10] hover:text-white/90"
            >
              {q}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[10px] leading-[1.7] text-white/30">
          デモでは代表的な質問への回答をご覧いただけます。本番環境では、運営データを参照して回答します。
        </p>
      </div>
    </aside>
  );
}
