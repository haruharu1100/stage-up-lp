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
import DemoRoleSwitch from "./DemoRoleSwitch";
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
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
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

          {/* ★担当の切り替えは、本番には無い機能です。
              本番の操作と同じ見た目で並べないこと。
              中身（誰が何をできるか）は、押した先にまとめてあります */}
          <DemoRoleSwitch admins={s.admins} me={me} onSwitch={onSwitch} />

          <div className="hidden shrink-0 items-center gap-2.5 border-l border-edge2 pl-3 lg:flex">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-pale text-note font-bold text-blue-ink"
            >
              {me.name.slice(0, 1)}
            </span>
            <span className="text-right">
              <span className="nb block text-note font-bold text-slate">
                {me.name}
              </span>
              <span className="nb block text-note text-slate3">
                {ROLE_LABEL[me.role]}
              </span>
            </span>
          </div>
        </div>

        {/* デモの断り書き。常に出す。
            ★消さないこと。本物と見分けがつかない画面を人に見せてはいけません。
            ★ただし2行にしないこと。
              ここは画面のいちばん上に居座り続ける帯です。
              1024px幅で2行になると、それだけで28px、
              毎日の作業領域が削られます。断り書きは1行で足ります。
              押しても実害が出ない、までを1文で言い切ります。
            ★ここに nb（折り返し禁止）を付けないこと。
              PCでは1行に収まりますが、スマホでは必ず溢れます。
              溢れた文は、横スクロールを生むか、途中で切れて読めなくなります。
              断り書きが読めないのでは、置いている意味がありません。 */}
        <p className="border-t border-edge2 bg-warn/8 px-4 py-1.5 text-note leading-[1.6] text-warn-ink sm:px-5">
          デモ環境です。決済・メール・SMS・配送業者・本番データベースには
          つながっていません。
        </p>
      </header>

      {/* ══ お知らせ帯 ══ */}
      {s.flash && (
        <div
          className={`flex-none px-4 py-2 sm:px-5 ${
            s.flash.kind === "error"
              ? "bg-danger/10 text-danger-ink"
              : s.flash.kind === "warn"
                ? "bg-warn/12 text-warn-ink"
                : "bg-ok/10 text-ok-ink"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <p className="text-note font-medium leading-[1.7]">{s.flash.text}</p>
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
          {/* ★ここで中央寄せの最大幅を掛けないこと。
              管理画面は表を読む場所です。1920pxの画面で
              左右に200pxずつ余白を作ると、その分だけ
              表の列が潰れて、横スクロールが増えます。
              販売LPの作法を、そのまま持ち込まないこと */}
          <div className="w-full space-y-5 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-7">
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
    /**
     * ★幅は 15.5rem（248px）／畳んだら 4.5rem（72px）。
     *   これより広げると、中身（表）が狭くなります。
     *   これより狭めると、「お客様サイト編集」のような
     *   長めの名前が2行になって、行の高さが揃わなくなります。
     */
    <nav
      aria-label="管理メニュー"
      className={`${className} relative min-h-0 shrink-0 flex-col border-r border-edge bg-paper ${
        collapsed ? "w-[4.5rem]" : "w-[15.5rem]"
      }`}
    >
      {/* 上：スクロールする一覧
          ★nav の1つめの子であること。
            到達確認（check-admin-reach.mjs）は
            「nav の最初の div がスクロールする場所」として見ています。
            ここに包みを増やすと、確認が別の要素を測り始めます */}
      <div className="nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
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

        {/* ★最後に、余白を少しだけ足すこと。
            最下段の項目が、下のぼかしにぴったり接すると
            「切れている」ように見えます */}
        <div className="h-3" aria-hidden />
      </div>

      {/* ══ 下：絶対にスクロールしない場所 ══

          ★ここを大きくしないこと。
            ここが厚くなった分だけ、上の一覧が薄くなります。
            以前は「畳む」「デモを最初に戻す」「ログアウト」
            「販売サイトへ戻る」を縦4段に積んでいて、
            それだけで約190px を常に使っていました。
            900pxの画面では、メニュー一覧に残るのが
            半分以下になってしまいます。

            使う回数の少ないものほど、小さく置きます。
            ログアウトは1日1回、販売サイトへ戻るはもっと少ない。
            毎日何十回も使う一覧のほうに、場所を渡します。 */}
      <div className="relative flex-none border-t border-edge2 bg-paper px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* ★「まだ下に続いている」ことを、色で言うこと。
            細いスクロールバーは、あることに気づかれません。
            一覧の下端をぼかしておくと、
            そこで終わっていないと一目で分かります。
            ★pointer-events-none を必ず付けること。
              付けないと、この帯の下にある行が押せなくなります */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-b from-transparent to-paper"
        />
        {collapsed ? (
          <div className="space-y-1">
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="メニューを広げる"
                title="メニューを広げる"
                className="nb flex w-full items-center justify-center rounded-xl border border-edge px-3 py-2 text-note font-bold text-slate3 hover:bg-mist"
              >
                <span aria-hidden>»</span>
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              title="ログアウト"
              aria-label="ログアウト"
              className="flex w-full items-center justify-center rounded-xl px-3 py-2 text-slate2 hover:bg-mist"
            >
              <Icon name="lock" />
            </button>
          </div>
        ) : (
          <>
            {/* 上の段：いちばん使うものと、畳む */}
            <div className="flex items-stretch gap-1.5">
              <div className="min-w-0 flex-1">
                <Btn full onClick={onReset}>
                  デモを最初に戻す
                </Btn>
              </div>
              {onToggleCollapse && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label="メニューを畳む"
                  title="メニューを畳む"
                  className="nb shrink-0 rounded-xl border border-edge px-2.5 text-note font-bold text-slate3 hover:bg-mist"
                >
                  <span aria-hidden>«</span>
                </button>
              )}
            </div>

            {/* 下の段：1日に1回あるかどうかの2つ */}
            <div className="mt-1 flex items-center gap-1">
              <button
                type="button"
                onClick={onLogout}
                className="nb min-w-0 flex-1 rounded-lg px-1 py-1.5 text-note font-bold text-slate3 hover:bg-mist hover:text-slate2"
              >
                ログアウト
              </button>
              <Link
                href="/"
                className="nb min-w-0 flex-1 rounded-lg px-1 py-1.5 text-center text-note font-bold text-slate3 hover:bg-mist hover:text-blue-ink"
              >
                販売サイトへ戻る
              </Link>
            </div>
          </>
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
    <div className="mb-3.5">
      {hideTitle ? (
        <div className="mx-2 mb-2 border-t border-edge2" />
      ) : (
        /* ★区分の見出しは、項目より小さく・薄く・字間を広げること。
             同じ濃さで並べると、見出しも押せる項目に見えます */
        <p className="px-2.5 pb-1 pt-1 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-slate3/80">
          {title}
        </p>
      )}
      <ul className="space-y-px">{children}</ul>
    </div>
  );
}

/**
 * 1項目。
 *
 * ★畳んでいるときも、名前が出る仕掛けを残すこと（title 属性）。
 *   印だけのメニューは、覚えるまでのあいだ使えません。
 *
 * ★説明文を、全部の項目に出しっぱなしにしないこと。
 *
 *   以前は21項目すべてに2行（名前＋説明）を出していました。
 *   1項目が56pxになり、全部で1176px。
 *   画面に入るのは4〜5項目だけで、
 *   目当ての項目を探すのに毎回スクロールが要りました。
 *   毎日8時間使う方には、この往復がそのまま疲れになります。
 *
 *   いまは、ふだんは名前だけ（1行）にして、
 *   説明はいま開いている項目にだけ出します。
 *   説明が要るのは「これから行く先を選ぶとき」ではなく
 *   「いまどこにいるか確かめるとき」だからです。
 *
 *   ★説明を消したわけではないこと。
 *     マウスを乗せれば title で出ます。
 *     ⌘K の検索一覧では、全項目の説明が出ます。
 *     初めての方が説明を読む道は、必ず残してあります。
 *
 * ★aria-label に名前を必ず入れること。
 *   見た目を変えるたびに、機械が名前を取れなくなると、
 *   到達確認（check-admin-reach.mjs）が壊れます。
 *   名前の置き場所を1つに決めておきます。
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
      <li className="group relative">
        <button
          type="button"
          onClick={() => onGo(m.key)}
          title={`${m.label}｜${m.note}`}
          aria-label={m.label}
          aria-current={active ? "page" : undefined}
          className={`relative flex w-full items-center justify-center rounded-xl px-3 py-2.5 transition-colors ${
            active ? "bg-blue-pale text-blue-ink" : "text-slate2 hover:bg-mist"
          }`}
        >
          {active && <Accent />}
          <Icon name={m.icon} />
        </button>

        {/* ★畳んだときも、名前が出ること。
            印だけのメニューは、覚えるまでのあいだ使えません。
            title だけに頼らないのは、出るまでに1〜2秒かかるからです */}
        <span
          role="tooltip"
          className="nb pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 rounded-lg bg-navy px-3 py-1.5 text-[0.8rem] font-bold text-white opacity-0 shadow-lift2 transition-opacity group-hover:opacity-100"
        >
          {m.label}
        </span>
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onGo(m.key)}
        aria-label={m.label}
        title={`${m.label}｜${m.note}`}
        aria-current={active ? "page" : undefined}
        /**
         * ★選択中を、薄いブルーの背景だけで表さないこと。
         *   淡い色は、画面の明るさや角度で消えます。
         *   左の線・背景・印の色・文字の太さの4つで言います。
         *   1つ消えても、残り3つで分かります。
         */
        className={`relative flex w-full items-center gap-2.5 rounded-xl py-[0.5rem] pl-3 pr-8 text-left transition-colors ${
          active
            ? "bg-blue-pale font-bold text-blue-ink"
            : "font-medium text-slate2 hover:bg-mist hover:text-slate"
        }`}
      >
        {active && <Accent />}
        <Icon
          name={m.icon}
          className={active ? "text-blue-ink" : "text-slate3"}
        />
        <span className="nb min-w-0 flex-1 truncate text-[0.94rem] leading-[1.5]">
          {m.label}
        </span>
        {!allowed && (
          <span className="nb shrink-0 rounded-md bg-mist px-1.5 py-0.5 text-[0.68rem] font-bold text-slate3">
            権限なし
          </span>
        )}
      </button>

      {/* ★「よく使う」への固定。
          常に見えていると賑やかになるので、触れたときだけ出します。
          ただし固定済みのものは、外し方が分かるよう常に出します */}
      <button
        type="button"
        onClick={() => onTogglePin(m.key)}
        aria-label={pinned ? `${m.label}をよく使うから外す` : `${m.label}をよく使うに入れる`}
        title={pinned ? "よく使うから外す" : "よく使うに入れる"}
        className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-lg px-1.5 py-1 text-[0.9rem] leading-none transition ${
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

/**
 * 選択中を示す、左の線。
 *
 * ★背景色と別に、必ず線でも言うこと。
 *   薄いブルーの面だけだと、明るい場所や、角度の付いた画面では
 *   ほとんど見えません。「いまどこにいるか」が分からない管理画面は、
 *   毎日使う人の負担になります。
 */
function Accent() {
  return (
    <span
      aria-hidden
      className="absolute left-0 top-1/2 h-[1.4rem] w-[3px] -translate-y-1/2 rounded-r-full bg-blue-ink"
    />
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
