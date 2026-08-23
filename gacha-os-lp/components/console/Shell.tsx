/**
 * 管理画面の枠（左メニュー・上のバー・お知らせ帯）。
 *
 * ═══════════════════════════════════════════════
 * ★高さを計算で出さないこと（最重要）
 * ═══════════════════════════════════════════════
 *
 *   以前ここは、こう書いてありました。
 *
 *       lg:top-[calc(6.5rem+…)]  lg:h-[calc(100vh-6.5rem-…)]
 *
 *   6.5rem＝104px は「上のバーはだいたいこのくらい」という当て推量です。
 *   実際の上のバーは 128px あり、幅が狭い端末では断り書きが2行になって
 *   156px まで伸びました。その差の分だけ、左メニューが画面の下に
 *   はみ出します。はみ出した部分は、中でスクロールしても画面の外なので、
 *   いつまで経っても見えません。
 *
 *   実測すると、1440×900・1366×768・1280×720・1024×768 の
 *   すべてで、いちばん下の「ログアウト」「販売サイトへ戻る」に
 *   到達できませんでした。押せないボタンは、無いのと同じです。
 *
 *   ★だから、高さの計算をやめました。
 *     いまは、画面を縦に区切るだけの作りです。
 *
 *         画面の高さ（100dvh）
 *         ├─ 上のバー          … 中身のぶんだけ
 *         ├─ お知らせ帯        … 出るときだけ
 *         └─ 残り全部
 *            ├─ 左メニュー … 自分の中だけでスクロール
 *            └─ 中身      … 自分の中だけでスクロール
 *
 *     上のバーが何px でも、断り書きが何行でも、残りが自動で決まります。
 *     決め打ちの数字が1つも無いので、ずれようがありません。
 *
 *   ★100vh ではなく 100dvh を使うこと。
 *     スマホは、上下のバーが出たり消えたりします。
 *     100vh はバーが出ている分を数えないので、その分だけ下がはみ出します。
 *
 * ═══════════════════════════════════════════════
 * ★いちばん下の項目を、スクロールの中に入れないこと
 * ═══════════════════════════════════════════════
 *
 *   ログアウト・デモを戻す・販売サイトへ戻る は、
 *   スクロールしない場所（下に貼り付け）に置いてあります。
 *   スクロールの中に入れると、画面が低い端末で、
 *   また「そこまで辿り着けない」が起きます。
 *   起きたかどうかは、背の高い画面で作っている本人には見えません。
 *
 * ═══════════════════════════════════════════════
 * ★スマホでの決まり
 * ═══════════════════════════════════════════════
 *
 *   左メニューは、スマホでは初めから畳んでおきます。
 *   ただし「畳んだら何も見えない」状態にはしません。
 *   出先で確かめたいのは、だいたい次の4つです。
 *
 *       売上 / 警告 / 問い合わせ / 未発送
 *
 *   だから、この4つはメニューを開かなくても常に見えるようにします。
 *   （下の QuickBar）。押すと、その画面に飛びます。
 *
 * ═══════════════════════════════════════════════
 * ★デモの断り書きを消さないこと
 * ═══════════════════════════════════════════════
 *
 *   上のバーに、常に「デモ」と出しておきます。
 *   本物の決済・メール・SMS・配送業者・本番データベースには
 *   一切つながっていません。
 *   本物と見分けがつかない状態で人に見せてはいけません。
 */

"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { ConsoleState } from "@/lib/console/state";
import { ROLE_LABEL, can, summary } from "@/lib/console/state";
import {
  MENU,
  MENU_GROUPS,
  menuItem,
  searchMenu,
  type MenuGroup,
  type MenuItem,
  type MenuKey,
} from "./menu";
import Icon from "./Icon";
import { Badge, Btn } from "./ui";

export default function Shell({
  s,
  page,
  onNav,
  onReset,
  onLogout,
  onSwitch,
  onClearFlash,
  children,
}: {
  s: ConsoleState;
  page: MenuKey;
  onNav: (k: MenuKey) => void;
  onReset: () => void;
  onLogout: () => void;
  onSwitch: (id: string) => void;
  onClearFlash: () => void;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [finder, setFinder] = useState(false);
  const [pinned, setPinned] = useState<MenuKey[]>([]);
  const me = s.me!;
  const sum = summary(s);
  const item = menuItem(page);

  /* ── ⌘K / Ctrl+K で検索を開く ────────────────────
     ★入力欄に文字を打っているときは開かないこと。
       ガチャ名を打っている途中に画面が乗っ取られると、打ち直しになります */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setFinder(true);
      }
      if (e.key === "Escape") setFinder(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (k: MenuKey) => {
    onNav(k);
    setDrawer(false);
    setFinder(false);
  };

  const togglePin = (k: MenuKey) =>
    setPinned((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]));

  return (
    /* ★ここが土台。画面の高さちょうどで、外にはみ出さない */
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-paper2">
      {/* ══ 上のバー。中身のぶんだけの高さ（計算しない） ══ */}
      <header className="flex-none border-b border-edge bg-paper">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="メニューを開く"
            className="nb rounded-xl border border-edge px-3 py-2 text-note font-bold text-slate2 hover:bg-mist lg:hidden"
          >
            メニュー
          </button>

          {/* いまどこにいるか（パンくず） */}
          <nav aria-label="現在地" className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-note text-slate3">
              <span className="nb font-bold tracking-tight text-slate">
                AI GACHA OS
              </span>
              <Sep />
              <span className="nb hidden sm:inline">{item.group}</span>
              <span className="hidden sm:inline">
                <Sep />
              </span>
              <span className="nb truncate font-bold text-slate2">
                {item.label}
              </span>
            </p>
          </nav>

          <button
            type="button"
            onClick={() => setFinder(true)}
            className="nb hidden items-center gap-2 rounded-xl border border-edge bg-paper2 px-3 py-2 text-note text-slate3 hover:bg-mist md:inline-flex"
          >
            <Icon name="eye" className="h-4 w-4" />
            画面を探す
            <kbd className="num rounded-md border border-edge bg-paper px-1.5 py-0.5 text-[0.72rem] font-bold text-slate3">
              ⌘K
            </kbd>
          </button>

          <Badge tone="warn">デモ</Badge>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right lg:block">
              <p className="nb text-note font-bold text-slate">{me.name}</p>
              <p className="nb text-note text-slate3">{ROLE_LABEL[me.role]}</p>
            </div>
            <select
              value={me.id}
              onChange={(e) => onSwitch(e.target.value)}
              aria-label="担当を切り替える"
              className="nb max-w-[9.5rem] rounded-xl border border-silver bg-paper px-3 py-2 text-note text-slate2 sm:max-w-none"
            >
              {s.admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}（{ROLE_LABEL[a.role]}）
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* デモの断り書き。常に出す */}
        <p className="border-t border-edge2 bg-warn/8 px-4 py-2 text-note leading-[1.7] text-warn-ink sm:px-5">
          これはデモです。本物の決済・メール送信・SMS送信・配送業者・本番データベースには、
          いっさいつながっていません。何を押しても実害は出ません。
        </p>
      </header>

      {/* ══ お知らせ帯 ══ */}
      {s.flash && (
        <div
          className={`flex-none px-4 py-3 sm:px-5 ${
            s.flash.kind === "error"
              ? "bg-danger/10 text-danger-ink"
              : s.flash.kind === "warn"
                ? "bg-warn/12 text-warn-ink"
                : "bg-ok/10 text-ok-ink"
          }`}
        >
          <div className="mx-auto flex max-w-[1500px] items-start justify-between gap-4">
            <p className="text-note font-medium leading-[1.85]">{s.flash.text}</p>
            <button
              type="button"
              onClick={onClearFlash}
              className="nb shrink-0 text-note font-bold underline underline-offset-4"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* ══ 残り全部を、左メニューと中身で分ける ══ */}
      <div className="flex min-h-0 flex-1">
        {/* ── 左メニュー（PC）。ここだけで独立してスクロールする ── */}
        <SideNav
          s={s}
          page={page}
          collapsed={collapsed}
          pinned={pinned}
          onGo={go}
          onTogglePin={togglePin}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          onReset={onReset}
          onLogout={onLogout}
          className="hidden lg:flex"
        />

        {/* ── 中身。ここも独立してスクロールする ── */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {/* スマホで、メニューを開かなくても見える4つ */}
          <QuickBar
            revenue={sum.revenueToday}
            alerts={sum.rtpAlerts + sum.fraudReview}
            tickets={sum.tickets}
            unshipped={sum.unshipped}
            onGo={go}
          />
          <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
            {children}
          </div>
        </main>
      </div>

      {/* ── 左メニュー（スマホ）。かぶせて出す ── */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-slate/40"
          />
          <SideNav
            s={s}
            page={page}
            collapsed={false}
            pinned={pinned}
            onGo={go}
            onTogglePin={togglePin}
            onReset={onReset}
            onLogout={onLogout}
            onClose={() => setDrawer(false)}
            className="relative flex w-[min(20rem,86vw)] shadow-lift2"
          />
        </div>
      )}

      {/* ── 画面を探す（⌘K） ── */}
      {finder && <Finder onGo={go} onClose={() => setFinder(false)} me={s.me!} />}
    </div>
  );
}

function Sep() {
  return <span className="select-none text-slate3/60">/</span>;
}

/* ══════════════════════════════════════════════
   左メニュー本体
   ══════════════════════════════════════════════ */

/**
 * ★中身を2段に分けること。
 *
 *     上（flex-1 overflow-y-auto） … 項目の一覧。ここだけスクロールする
 *     下（flex-none）              … ログアウト等。絶対にスクロールさせない
 *
 *   下を一覧の中に入れると、画面が低いときに辿り着けなくなります。
 *   「スクロールすれば出る」は、スクロール範囲が画面内に収まっている
 *   ときにしか成り立ちません。
 */
function SideNav({
  s,
  page,
  collapsed,
  pinned,
  onGo,
  onTogglePin,
  onToggleCollapse,
  onReset,
  onLogout,
  onClose,
  className = "",
}: {
  s: ConsoleState;
  page: MenuKey;
  collapsed: boolean;
  pinned: MenuKey[];
  onGo: (k: MenuKey) => void;
  onTogglePin: (k: MenuKey) => void;
  onToggleCollapse?: () => void;
  onReset: () => void;
  onLogout: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const me = s.me!;
  const pins = pinned.map((k) => MENU.find((m) => m.key === k)!).filter(Boolean);

  return (
    <nav
      aria-label="管理メニュー"
      className={`${className} min-h-0 shrink-0 flex-col border-r border-edge bg-paper ${
        collapsed ? "w-[4.75rem]" : "w-[17.5rem]"
      }`}
    >
      {/* 上：スクロールする一覧 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-4">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="nb mb-3 w-full rounded-xl border border-edge px-3 py-2 text-note font-bold text-slate2 hover:bg-mist"
          >
            閉じる
          </button>
        )}

        {pins.length > 0 && !collapsed && (
          <Group title="よく使う">
            {pins.map((m) => (
              <Row
                key={`pin-${m.key}`}
                m={m}
                active={page === m.key}
                allowed={!m.need || can(me.role, m.need)}
                collapsed={false}
                pinned
                onGo={onGo}
                onTogglePin={onTogglePin}
              />
            ))}
          </Group>
        )}

        {MENU_GROUPS.map((g: MenuGroup) => (
          <Group key={g} title={g} hideTitle={collapsed}>
            {MENU.filter((m) => m.group === g).map((m) => (
              <Row
                key={m.key}
                m={m}
                active={page === m.key}
                allowed={!m.need || can(me.role, m.need)}
                collapsed={collapsed}
                pinned={pinned.includes(m.key)}
                onGo={onGo}
                onTogglePin={onTogglePin}
              />
            ))}
          </Group>
        ))}
      </div>

      {/* 下：絶対にスクロールしない場所 */}
      <div className="flex-none border-t border-edge2 bg-paper px-2.5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "メニューを広げる" : "メニューを畳む"}
            className="nb mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-edge px-3 py-2 text-note font-bold text-slate3 hover:bg-mist"
          >
            <span aria-hidden>{collapsed ? "»" : "«"}</span>
            {!collapsed && "畳む"}
          </button>
        )}

        {collapsed ? (
          <button
            type="button"
            onClick={onLogout}
            title="ログアウト"
            aria-label="ログアウト"
            className="flex w-full items-center justify-center rounded-xl px-3 py-2.5 text-slate2 hover:bg-mist"
          >
            <Icon name="lock" />
          </button>
        ) : (
          <div className="space-y-2">
            <Btn full onClick={onReset}>
              デモを最初に戻す
            </Btn>
            <Btn full kind="ghost" onClick={onLogout}>
              ログアウト
            </Btn>
            <Link
              href="/"
              className="nb block rounded-xl px-4 py-2 text-center text-note font-bold text-slate3 underline underline-offset-4 hover:text-blue-ink"
            >
              販売サイトへ戻る
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}

function Group({
  title,
  hideTitle,
  children,
}: {
  title: string;
  hideTitle?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      {hideTitle ? (
        <div className="mx-2 mb-2 border-t border-edge2" />
      ) : (
        <p className="px-2 pb-1.5 text-label uppercase tracking-wide text-slate3">
          {title}
        </p>
      )}
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

/**
 * 1項目。
 *
 * ★畳んでいるときも、名前が出る仕掛けを残すこと（title 属性）。
 *   印だけのメニューは、覚えるまでのあいだ使えません。
 */
function Row({
  m,
  active,
  allowed,
  collapsed,
  pinned,
  onGo,
  onTogglePin,
}: {
  m: MenuItem;
  active: boolean;
  allowed: boolean;
  collapsed: boolean;
  pinned: boolean;
  onGo: (k: MenuKey) => void;
  onTogglePin: (k: MenuKey) => void;
}) {
  if (collapsed) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onGo(m.key)}
          title={`${m.label}｜${m.note}`}
          aria-label={m.label}
          aria-current={active ? "page" : undefined}
          className={`flex w-full items-center justify-center rounded-xl px-3 py-2.5 transition-colors ${
            active ? "bg-blue-pale text-blue-ink" : "text-slate2 hover:bg-mist"
          }`}
        >
          <Icon name={m.icon} />
        </button>
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onGo(m.key)}
        aria-current={active ? "page" : undefined}
        className={`flex w-full items-start gap-2.5 rounded-xl py-2.5 pl-3 pr-9 text-left transition-colors ${
          active ? "bg-blue-pale text-blue-ink" : "text-slate2 hover:bg-mist"
        }`}
      >
        <Icon
          name={m.icon}
          className={`mt-0.5 ${active ? "text-blue-ink" : "text-slate3"}`}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="nb text-note font-bold">{m.label}</span>
            {!allowed && <Badge>権限なし</Badge>}
          </span>
          <span className="mt-0.5 block text-note leading-[1.6] text-slate3">
            {m.note}
          </span>
        </span>
      </button>

      {/* ★「よく使う」への固定。
          常に見えていると賑やかになるので、触れたときだけ出します。
          ただし固定済みのものは、外し方が分かるよう常に出します */}
      <button
        type="button"
        onClick={() => onTogglePin(m.key)}
        aria-label={pinned ? `${m.label}をよく使うから外す` : `${m.label}をよく使うに入れる`}
        title={pinned ? "よく使うから外す" : "よく使うに入れる"}
        className={`absolute right-1.5 top-2 rounded-lg px-1.5 py-1 text-[0.9rem] leading-none transition ${
          pinned
            ? "text-blue-ink"
            : "text-slate3 opacity-0 hover:bg-mist focus:opacity-100 group-hover:opacity-100"
        }`}
      >
        {pinned ? "★" : "☆"}
      </button>
    </li>
  );
}

/* ══════════════════════════════════════════════
   画面を探す（⌘K）
   ══════════════════════════════════════════════ */

/**
 * ★何も打っていないときに、空白を出さないこと。
 *   初めて開いた人は、何を打てばよいか分かりません。
 *   だから、打つ前は全部の項目を出しておきます。
 */
function Finder({
  onGo,
  onClose,
  me,
}: {
  onGo: (k: MenuKey) => void;
  onClose: () => void;
  me: NonNullable<ConsoleState["me"]>;
}) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => box.current?.focus(), []);

  const hits = useMemo(() => (q.trim() ? searchMenu(q) : MENU), [q]);
  const pick = hits[Math.min(i, hits.length - 1)];

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-slate/45"
      />
      <div className="relative w-full max-w-[34rem] overflow-hidden rounded-2xl border border-edge bg-paper shadow-lift2">
        <input
          ref={box}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setI((v) => Math.min(v + 1, hits.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setI((v) => Math.max(v - 1, 0));
            }
            if (e.key === "Enter" && pick) onGo(pick.key);
          }}
          placeholder="画面を探す（はっそう / shipping / 追跡 …）"
          aria-label="画面を探す"
          className="w-full border-b border-edge2 bg-paper px-5 py-4 text-[1rem] text-slate outline-none placeholder:text-slate3"
        />

        <ul className="max-h-[52vh] overflow-y-auto py-2">
          {hits.length === 0 && (
            <li className="px-5 py-6 text-note leading-[1.9] text-slate3">
              その言葉では見つかりませんでした。
              画面の名前でも、やりたいこと（例：追跡番号・還元率・複垢）でも探せます。
            </li>
          )}
          {hits.map((m, n) => {
            const allowed = !m.need || can(me.role, m.need);
            return (
              <li key={m.key}>
                <button
                  type="button"
                  onMouseEnter={() => setI(n)}
                  onClick={() => onGo(m.key)}
                  className={`flex w-full items-start gap-3 px-5 py-2.5 text-left ${
                    n === i ? "bg-blue-pale" : "hover:bg-mist"
                  }`}
                >
                  <Icon name={m.icon} className="mt-0.5 text-slate3" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="nb text-note font-bold text-slate">
                        {m.label}
                      </span>
                      <span className="nb text-note text-slate3">{m.group}</span>
                      {!allowed && <Badge>権限なし</Badge>}
                    </span>
                    <span className="mt-0.5 block text-note text-slate3">
                      {m.note}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="border-t border-edge2 bg-paper2 px-5 py-2.5 text-note text-slate3">
          ↑↓ で選び、Enter で移動します。Esc で閉じます。
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   スマホで、メニューを開かなくても見える4つ
   ══════════════════════════════════════════════ */

/**
 * ★数字を出すだけで終わらせないこと。
 *   出先で「警告2件」と出ているのに、そこへ行く道が
 *   メニューの奥にしか無いと、結局メニューを開くことになります。
 *   だから、押したらその画面に飛ぶようにします。
 */
function QuickBar({
  revenue,
  alerts,
  tickets,
  unshipped,
  onGo,
}: {
  revenue: number;
  alerts: number;
  tickets: number;
  unshipped: number;
  onGo: (k: MenuKey) => void;
}) {
  const items: { k: string; v: string; bad: boolean; to: MenuKey }[] = [
    { k: "本日の売上", v: `${revenue.toLocaleString()}円`, bad: false, to: "analytics" },
    { k: "警告", v: `${alerts}件`, bad: alerts > 0, to: "rtp" },
    { k: "問い合わせ", v: `${tickets}件`, bad: tickets > 0, to: "support" },
    { k: "未発送", v: `${unshipped}件`, bad: unshipped > 0, to: "orders" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px border-b border-edge bg-edge2 lg:hidden">
      {items.map((i) => (
        <button
          key={i.k}
          type="button"
          onClick={() => onGo(i.to)}
          className="bg-paper px-4 py-3 text-left active:bg-mist"
        >
          <p className="text-note text-slate3">{i.k}</p>
          <p
            className={`num text-[1.125rem] font-bold tabular-nums ${
              i.bad ? "text-danger-ink" : "text-slate"
            }`}
          >
            {i.v}
          </p>
        </button>
      ))}
    </div>
  );
}
