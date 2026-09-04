/**
 * 契約者向け管理画面（デモ）の入口。
 *
 * ═══════════════════════════════════════════════
 * ★これは何か
 * ═══════════════════════════════════════════════
 *
 *   販売LPに付いている「さわれるデモ」ではありません。
 *   ご契約後に、毎日この画面で運営していただくことを想定した
 *   管理画面そのものを、データだけ架空にして触れるようにしたものです。
 *
 *   だから、見栄えのための飾りは入れません。
 *   「毎日8時間これを見て仕事ができるか」だけで判断します。
 *
 * ═══════════════════════════════════════════════
 * ★安全のための決まり（絶対に緩めないこと）
 * ═══════════════════════════════════════════════
 *
 *   1) 外に一切つながないこと。
 *      決済・メール送信・SMS送信・配送業者・本番データベース。
 *      どれも呼びません。この画面の中だけで完結します。
 *      「デモから本物のメールが飛んだ」は、取り返しがつきません。
 *
 *   2) 実在のアカウント・実在の会員情報を使わないこと。
 *      担当者も会員も、全員が架空です。
 *
 *   3) 「デモです」という断り書きを消さないこと。
 *      本物と見分けがつかない画面を人に見せてはいけません。
 *
 *   4) データはブラウザの中だけに置くこと。
 *      サーバーには保存しません。ページを閉じれば消えます。
 *      誰かが触った跡が、次の人に見えてしまうのを防ぎます。
 *
 * ═══════════════════════════════════════════════
 * ★「管理サイト」と「ユーザー側」は、同じ1つのデータを見ている
 * ═══════════════════════════════════════════════
 *
 *   上の切り替えで、運営側の管理画面と、
 *   お客様が実際に使う画面（ガチャを引く・当たった商品を選ぶ）を
 *   行き来できます。
 *
 *   ★このとき、データを2つ持たないこと。
 *     ここでは useReducer が1つしかありません。
 *     お客様が発送を依頼すれば、切り替えた先の管理画面に、
 *     その瞬間もう入っています。逆も同じです。
 *
 *     もし「お客様側の見せかけデータ」を別に持ってしまうと、
 *     デモとしては動いて見えるのに、
 *     いちばん大事な「本当につながっているのか」が証明できません。
 *     それは、見せる価値がありません。
 *
 * ═══════════════════════════════════════════════
 * ★お客様側にも、ログインは要る
 * ═══════════════════════════════════════════════
 *
 *   見るだけの画面（ガチャ一覧・賞の内容・価格・残り口数・
 *   よくある質問・利用規約）は、ログインなしで見られます。
 *   ここに鍵をかけても、売れなくなるだけです。
 *
 *   けれど、そこから先は全部ログインが要ります。
 *   ポイント残高／購入／ガチャを引く／当たった商品／獲得商品一覧／
 *   発送依頼／ポイント交換／ポイント履歴／お届け先／
 *   問い合わせ／追跡番号。
 *
 *   ★理由は「個人情報だから」ではありません。
 *     ポイントも、当たった商品も、お届け先も、全部お金です。
 *     他人が触れる状態にしておくと、
 *     取られたあとに取り返す方法がありません。
 *
 *   ★2段階認証について。
 *     運営側は必須のままにします。
 *     1人が乗っ取られると、全会員が危なくなるからです。
 *     お客様側は、任意で設定できるようにします。
 *     全員に強制すると、買う前に離脱します。
 *     そのかわり、危ないときだけ、その場でもう一度確認します
 *     （高額なポイント交換・住所を変えた直後の高額発送・まとめて操作）。
 *     これを STEP-UP と呼びます。中身は lib/console/state.ts にあります。
 *
 *   ★どこから先がログインなのかを、この画面で決めないこと。
 *     決めるのは state.ts の CUSTOMER_GATES ただ1か所です。
 *     画面ごとに判断させると、20か所のうち1か所を必ず忘れます。
 *     1か所忘れたら、そこが穴になります。
 */

"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { initialState, reducer, NOW } from "@/lib/console/state";
import type { PageUser } from "@/lib/currentUser";
import { daySnapshot } from "@/lib/console/dayInLife";
import { IS_DEMO } from "@/lib/console/demo";
import { Login, Mfa } from "./Gate";
import Shell from "./Shell";
import DayInLife, { type DayRun } from "./DayInLife";
import { hrefOf, menuItem, type MenuKey } from "./menu";
import { Card, Planned, WhatIsThis } from "./ui";

import Dashboard from "./screens/Dashboard";
import GachaList from "./screens/GachaList";
import Builder from "./screens/Builder";
import BacktestScreen from "./screens/BacktestScreen";
import PreviewScreen from "./screens/PreviewScreen";
import RtpScreen from "./screens/RtpScreen";
import FraudCenter from "./screens/FraudCenter";
import PointScreen from "./screens/PointScreen";
import OrdersScreen from "./screens/OrdersScreen";
import ShipmentsScreen from "./screens/ShipmentsScreen";
import SupportScreen from "./screens/SupportScreen";
import SecurityCenter from "./screens/SecurityCenter";
import AuditScreen from "./screens/AuditScreen";
import OperatorScreen from "./screens/OperatorScreen";
import SettingsScreen from "./screens/SettingsScreen";
import CustomersScreen from "./screens/CustomersScreen";
import ProductsScreen from "./screens/ProductsScreen";
import MarketScreen from "./screens/MarketScreen";
import AnalyticsScreen from "./screens/AnalyticsScreen";
import MyPage from "./customer/MyPage";
import { SHOP_BG } from "./customer/Storefront";

/** いま、どちら側を見ているか */
type Side = "admin" | "customer";

/**
 * いまのURLに付いている「?あとの部分」を、そのまま読む。
 *
 * ★サーバー側では window がありません。空を返します。
 *   ここで落とすと、画面が真っ白になります。
 */
function readQuery(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * @param initialPage  URLから決まった画面。
 *                     ★必ずURLから受け取ること。
 *                       ここで "dashboard" に決め打ちすると、
 *                       /client-demo/shipping を開いた人が
 *                       毎回ダッシュボードに飛ばされます。
 *
 * @param me  サーバーが本人と認めた担当者。
 *            ★これが渡ってきている＝サーバー側で
 *              クッキーを確かめ、DBから役割を読んだあと、ということです。
 *              渡ってこない場合（デモの入口）だけ、
 *              画面の中のログインに落とします。
 */
export default function ClientConsole({
  initialPage = "dashboard",
  me,
}: {
  initialPage?: MenuKey;
  me?: PageUser;
} = {}) {
  const [s, dispatch] = useReducer(reducer, undefined, initialState);

  /**
   * サーバーが決めた「いま誰か」を、画面の状態へ写す。
   *
   * ★ここで役割を作らないこと。
   *   role は必ず me（サーバー）から来た値をそのまま使います。
   *   画面側で「たぶん管理者だろう」と補うと、
   *   画面には出るのに入口では断られる状態になります。
   *
   * ★displayId を id として使うこと。
   *   内部のIDはブラウザへ送っていません。送る必要もありません。
   */
  useEffect(() => {
    if (!me) return;
    dispatch({
      type: "SESSION",
      admin: {
        id: me.displayId,
        name: me.name,
        role: me.role,
        mfaEnabled: me.mfaEnabled,
        lastLogin: NOW,
      },
    });
  }, [me]);
  const [page, setPageState] = useState<MenuKey>(initialPage);
  const [navQuery, setNavQuery] = useState<Record<string, string>>(() => readQuery());
  const [side, setSide] = useState<Side>("admin");
  const router = useRouter();

  /**
   * 画面を移るときは、必ずURLも変えること。
   *
   * ★変えないと、次のことが全部できません。
   *     更新する／戻る／進む／ブックマークする／人に送る
   *
   * ★replace ではなく push にすること。
   *   replace にすると履歴が残らないので、「戻る」で前の画面に戻れません。
   */
  /**
   * 画面を移るときに、行き先へ渡す目印（?order=... など）。
   *
   * ★これを React の中だけで持ち回さないこと。
   *   「注文Aの発送を作る」画面を人に送れなくなります。
   *   URLに出しておけば、送れる・戻れる・更新しても残ります。
   */
  const setPage = useCallback(
    (k: MenuKey, q?: Record<string, string>) => {
      setPageState(k);
      setNavQuery(q ?? {});
      const qs = q ? new URLSearchParams(q).toString() : "";
      router.push(hrefOf(k) + (qs ? `?${qs}` : ""), { scroll: true });
    },
    [router],
  );

  /**
   * 戻る・進むで、URLだけが変わったときに、中身も合わせる。
   *
   * ★これが無いと、戻るボタンでURLは変わるのに画面が変わりません。
   *   その状態は「壊れている」と見分けがつきません。
   */
  useEffect(() => {
    setPageState(initialPage);
    setNavQuery(readQuery());
  }, [initialPage]);

  /**
   * 「1日、運営してみる」の進行。
   *
   * ★始めた時点の数を、必ず控えておくこと。
   *   デモの見本データには、最初から発送も問い合わせも入っています。
   *   控えずに「1件でもあれば済み」と判定すると、
   *   始めた瞬間に全部終わったことになります。
   * ★null は「やっていない」。ここを空の配列などで表さないこと。
   */
  const [run, setRun] = useState<DayRun | null>(null);

  const startDay = useCallback(() => {
    setRun({ base: daySnapshot(s), seen: new Set() });
    setSide("admin");
    setPage("dashboard");
  }, [s]);

  /** データごと最初に戻し、1日もやり直す */
  const resetDay = useCallback(() => {
    dispatch({ type: "RESET" });
    setRun({ base: daySnapshot(initialState()), seen: new Set() });
    setSide("admin");
    setPage("dashboard");
  }, []);

  const markSeen = useCallback((id: string) => {
    setRun((r) => (r ? { ...r, seen: new Set(r.seen).add(id) } : r));
  }, []);

  /**
   * 切り替え帯の高さを測って、下の画面に伝える。
   *
   * ★決め打ちの数値を書かないこと。
   *   この帯は、画面の幅と文字の大きさで高さが変わります。
   *   「だいたい80px」と書いた瞬間、どこかの端末で
   *   下の見出しが帯に隠れて読めなくなります。
   *   隠れているかどうかは、作った本人には気づけません。
   */
  const switchRef = useRef<HTMLDivElement>(null);
  const [switchH, setSwitchH] = useState(0);

  useEffect(() => {
    const el = switchRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSwitchH(el.offsetHeight));
    ro.observe(el);
    setSwitchH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  /**
   * 下の案内パネルの高さを測る（お客様側でだけ使う）。
   *
   * ★このパネルは手順ごとに文章の長さが変わり、高さも変わります。
   *   固定値で逃げると、ある手順だけボタンが隠れて押せなくなり、
   *   「案内どおりにやったのに進まない」という状態になります。
   *
   * ★管理サイト側では、そもそも重ねません（下の dock を参照）。
   *   重ねない作りにすれば、高さを測る必要も、ずれる余地も消えます。
   */
  const dayRef = useRef<HTMLDivElement>(null);
  const [dayH, setDayH] = useState(0);

  useEffect(() => {
    const el = dayRef.current;
    if (!el || side === "admin") {
      setDayH(0);
      return;
    }
    const ro = new ResizeObserver(() => setDayH(el.offsetHeight + 16));
    ro.observe(el);
    setDayH(el.offsetHeight + 16);
    return () => ro.disconnect();
  }, [run, side]);

  /**
   * 案内パネルの置き方。
   *
   *   管理サイト … 画面の中に「区画」として置く（flow）
   *   お客様側   … 下に貼り付ける（fixed）
   *
   * ★管理サイトで fixed を使わないこと。
   *   管理サイトは画面の高さぴったりの作りで、中身が自分の中で
   *   スクロールします。そこへ下から板をかぶせると、
   *   中身のいちばん下が板の裏に入り、スクロールしても出てきません。
   *   区画として置けば、場所が最初から分かれているので、
   *   何をどう伸ばしても重なりようがありません。
   *
   * ★お客様側は逆に fixed のままにすること。
   *   こちらはスマホ前提で、ページ全体が普通に縦スクロールします。
   *   区画にすると、画面の外へ流れていって見えなくなります。
   */
  const adminShell = side === "admin";

  return (
    <div
      style={
        {
          "--switch-h": `${switchH}px`,
          /* ★お客様側の下タブは、この値のぶん上へ逃がすこと。
             案内パネルは下に貼り付いています。タブを bottom-0 で置くと、
             案内の裏に入って押せなくなります。しかも「押しても反応しない」
             ようにしか見えないので、壊れていると思われます */
          "--day-h": `${!adminShell ? dayH : 0}px`,
        } as React.CSSProperties
      }
      className={adminShell ? "flex h-[100dvh] flex-col overflow-hidden" : ""}
    >
      <SideSwitch
        boxRef={switchRef}
        side={side}
        onChange={setSide}
        dayRunning={run !== null}
        onStartDay={startDay}
      />
      {side === "customer" ? (
        /* ★お客様側。
           ここから先（残高・当たった商品・発送・交換・お届け先）は
           ログインが要ります。止めるかどうかを決めるのは MyPage ではなく、
           state.ts の CUSTOMER_GATES です。
           見ているデータは、管理側とまったく同じ1つです */
        /* ★ここを白のままにしないこと。
           お客様側は暗い売り場です。外枠だけ白いと、
           スクロールで行き止まったときに下から白が出てきて、
           「読み込みに失敗した画面」に見えます */
        <div className="min-h-[100dvh]" style={{ background: SHOP_BG }}>
          <MyPage s={s} dispatch={dispatch} />
        </div>
      ) : (
        <AdminSide
          s={s}
          dispatch={dispatch}
          page={page}
          setPage={setPage}
          navQuery={navQuery}
        />
      )}

      {/* ★ここにも IS_DEMO を掛けること。
          入口のボタンを消しただけでは、すでに始めている人の画面には
          案内が残ります。出口も塞いで、はじめて「本番には無い」と言えます */}
      {IS_DEMO && run && (
        <DayInLife
          dock={adminShell ? "flow" : "fixed"}
          boxRef={dayRef}
          s={s}
          run={run}
          side={side}
          page={page}
          onGo={(nextSide, nextPage) => {
            setSide(nextSide);
            if (nextPage) setPage(nextPage);
          }}
          onSeen={markSeen}
          onFinish={() => setRun(null)}
          onReset={resetDay}
        />
      )}

      {/* ★お客様側だけ、案内が下に居座るぶんの隙間を空ける。
          高さは必ず実測すること。「だいたい208px」と書くと、
          文章が1行増えただけで、いちばん下のボタンが案内の裏に隠れます。 */}
      {IS_DEMO && run && !adminShell && <div style={{ height: dayH }} aria-hidden />}
    </div>
  );
}

/**
 * 上に出しっぱなしにする、左右の切り替え。
 *
 * ★どちらを見ているか、常に分かるようにすること。
 *   運営の画面とお客様の画面は、見た目が似ていなくても、
 *   説明しながら行き来していると、すぐに分からなくなります。
 *   「いま自分はどちら側にいるのか」は、画面のいちばん上に出しておきます。
 *
 * ★「同じデータを見ています」と、必ず添えること。
 *   これを書かないと、左右で別々のサンプルを見せているだけだと思われます。
 *   このデモでいちばん見ていただきたいのは、そこではありません。
 */
function SideSwitch({
  boxRef,
  side,
  onChange,
  dayRunning,
  onStartDay,
}: {
  /**
   * 高さを測るための取っ手。
   *
   * ★prop の名前を ref にしないこと。
   *   React では ref は特別扱いで、ただの関数コンポーネントには
   *   渡ってきません（undefined になります）。型では気づけません。
   *   気づけないまま「高さを測っている」つもりになると、
   *   実際には 0 のまま、下の中身が帯に隠れ続けます。
   */
  boxRef: React.Ref<HTMLDivElement>;
  side: Side;
  onChange: (s: Side) => void;
  dayRunning: boolean;
  onStartDay: () => void;
}) {
  const tab = (v: Side, label: string, sub: string) => {
    const on = side === v;
    return (
      <button
        type="button"
        onClick={() => onChange(v)}
        aria-pressed={on}
        className={[
          "flex-1 rounded-xl px-3 py-2.5 text-left transition sm:px-4",
          on
            ? "bg-white text-[#0F1B33] shadow-sm"
            : "text-white/70 hover:bg-white/10 hover:text-white",
        ].join(" ")}
      >
        <span className="nb block text-[0.85rem] font-bold leading-tight">{label}</span>
        <span
          className={[
            "mt-0.5 block text-[0.68rem] leading-tight",
            on ? "text-[#5E636B]" : "text-white/50",
          ].join(" ")}
        >
          {sub}
        </span>
      </button>
    );
  };

  return (
    <div ref={boxRef} className="sticky top-0 z-40 bg-[#0F1B33] px-3 py-2.5 shadow-md sm:px-4">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex flex-1 gap-1.5 rounded-2xl bg-white/5 p-1.5">
          {tab("admin", "管理サイト", "運営が毎日使う画面")}
          {tab("customer", "ユーザー側", "実際にお客様が利用する画面")}
        </div>
        {/* ★ここに nb（折り返し禁止）を付けないこと。
            短い見出しなら1行に保てますが、この長さの文に付けると
            画面の右端を突き抜けて、最後まで読めなくなります */}
        <p className="shrink-0 text-[0.68rem] leading-[1.7] text-white/55 sm:max-w-[16rem] sm:text-right">
          左右は<span className="nb font-bold text-white/80">同じ1つのデータ</span>
          を見ています。片方で操作すると、もう片方にすぐ反映されます。
        </p>

        {/* ★「機能を1つずつ見る」の隣に、これを置くこと。
            機能一覧は、すでに使っている人にしか読めません。
            初めての方が知りたいのは「1日、これで回るのか」だけです。

            ★これはデモ専用です。本番の管理画面には出しません。
              本物の売上を見ている画面に、練習用の進行が並んでいると、
              どちらの数字を見ているのか分からなくなります。
              出す・出さないを決めるのは lib/console/demo.ts の1か所だけです。 */}
        {IS_DEMO && !dayRunning && (
          <button
            type="button"
            onClick={onStartDay}
            className="shrink-0 rounded-xl bg-white px-4 py-2 text-left shadow-sm transition hover:bg-[#E8EDF7]"
          >
            <span className="nb block text-[0.78rem] font-bold leading-tight text-[#0F1B33]">
              1日、運営してみる
            </span>
            <span className="nb block text-[0.66rem] leading-tight text-[#5E636B]">
              デモ専用
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 運営側。ここだけは、ログインと2段階認証を必ず通します。
 */
function AdminSide({
  s,
  dispatch,
  page,
  setPage,
  navQuery,
}: {
  s: ReturnType<typeof initialState>;
  dispatch: React.Dispatch<Parameters<typeof reducer>[1]>;
  page: MenuKey;
  setPage: (k: MenuKey, q?: Record<string, string>) => void;
  navQuery: Record<string, string>;
}) {
  /* ① まだ誰としてログインするかを選んでいない */
  if (!s.me) {
    return (
      <Login
        admins={s.admins}
        onLogin={(adminId) => dispatch({ type: "LOGIN", adminId })}
      />
    );
  }

  /* ② ログインはしたが、2段階認証がまだ。ここで止める */
  if (!s.mfaPassed) {
    return (
      <Mfa
        me={s.me}
        onOk={() => dispatch({ type: "MFA_OK" })}
        onBack={() => dispatch({ type: "LOGOUT" })}
      />
    );
  }

  return (
    <Shell
      s={s}
      page={page}
      onNav={setPage}
      onReset={() => dispatch({ type: "RESET" })}
      onLogout={() => dispatch({ type: "LOGOUT" })}
      onSwitch={(adminId) => dispatch({ type: "SWITCH_ADMIN", adminId })}
      onClearFlash={() => dispatch({ type: "CLEAR_FLASH" })}
    >
      <Screen
        page={page}
        s={s}
        dispatch={dispatch}
        onNav={setPage}
        navQuery={navQuery}
      />
    </Shell>
  );
}

function Screen({
  page,
  s,
  dispatch,
  onNav,
  navQuery,
}: {
  page: MenuKey;
  s: ReturnType<typeof initialState>;
  dispatch: React.Dispatch<Parameters<typeof reducer>[1]>;
  onNav: (k: MenuKey, q?: Record<string, string>) => void;
  navQuery: Record<string, string>;
}) {
  const item = menuItem(page);

  /**
   * 見出しは、どの画面でも同じ形で出す。
   *
   * ★見出しを2つ出さないこと。
   *   ダッシュボードは、いちばん上の帯の中に画面名を持っています
   *   （あいさつと件数を、画面名と同じ塊で読ませるためです）。
   *   ここでもう一度出すと、同じ言葉が上下に並びます。
   *
   * ★ただし「main の中の最初の見出し＝画面名」は崩さないこと。
   *   どの画面に着いたかを機械で確かめる仕掛け
   *   （scripts/check-admin-reach.mjs）が、この約束だけを頼りに
   *   全項目を押して回っています。見出しの置き場所を変えるときは、
   *   必ずその画面の中に、同じ名前の h1 を1つ残してください。
   */
  const ownHead = page === "dashboard";

  const head = ownHead ? null : (
    <div>
      <h1 className="text-[1.375rem] font-bold tracking-tight text-slate">
        {item.label}
      </h1>
      <p className="mt-1 text-note text-slate3">{item.note}</p>
    </div>
  );

  const body = (() => {
    switch (page) {
      case "dashboard":
        return <Dashboard s={s} onNav={onNav} />;
      case "gacha":
        /* ★dispatch を渡さないこと。
             この画面は、見本データではなくサーバーを見ています。
             画面の中の控えを書き換えても、DBは変わりません。 */
        return <GachaList s={s} onNav={onNav} />;
      case "builder":
        /* ★dispatch を渡さないこと。
             この画面の「下書きとして登録する」は、サーバーへ送ります。
             画面の中の控えに足しても、開き直した瞬間に消えます。 */
        return <Builder s={s} onNav={onNav} />;
      case "backtest":
        return <BacktestScreen s={s} dispatch={dispatch} onNav={onNav} />;
      case "preview":
        /* ★見本データ（s）と dispatch を渡さないこと。
             ここは「公開前にお客様の目で見る」ための下見です。
             見本を渡すと、本物と違うものを見て公開を決めることになります。 */
        return <PreviewScreen onNav={onNav} />;
      case "products":
        return <ProductsScreen />;
      case "rtp":
        /* ★見本データではなく、サーバーの抽選記録から計算します。
             だから、この画面はデモの状態（s）を受け取りません。 */
        return <RtpScreen />;
      case "market":
        return <MarketScreen />;
      case "analytics":
        return <AnalyticsScreen s={s} />;
      case "fraud":
        return <FraudCenter s={s} dispatch={dispatch} />;
      case "points":
        /* ★見本データ（s）を渡さないこと。
             ポイントの正本は台帳（point_ledger）です。
             画面が自分でサーバーから読み、残高と台帳を毎回照合します。 */
        return <PointScreen />;
      case "customers":
        /* ★見本データ（s）を渡さないこと。
             この画面は、サーバーの会員そのものを見ています。
             画面の中の控えを書き換えても、DBは変わりません。 */
        return <CustomersScreen />;
      /* ★注文と発送を、同じ画面に戻さないこと。
           1つの注文を2回に分けて送った日に、書けなくなります。 */
      case "orders":
        return <OrdersScreen onNav={onNav} query={navQuery} />;
      case "shipping":
        return (
          <ShipmentsScreen onNav={onNav} query={navQuery} />
        );
      case "support":
        /* ★見本の問い合わせ（s.tickets）を渡さないこと。
             画面の中の控えに返信しても、お客様には何も届きません。
             いまは、お客様が出した本物の問い合わせを直接読みます */
        return <SupportScreen query={navQuery} />;
      case "security":
        return <SecurityCenter s={s} dispatch={dispatch} />;
      case "audit":
        return <AuditScreen s={s} />;
      case "operator":
        return <OperatorScreen s={s} onNav={onNav} />;
      case "settings":
        return <SettingsScreen s={s} dispatch={dispatch} />;
      default:
        return <NotBuiltYet label={item.label} />;
    }
  })();

  return (
    <>
      {head}
      {body}
    </>
  );
}

/**
 * まだ作っていない画面。
 *
 * ★空白のまま出さないこと。
 *   「押しても何も出ない」のは、壊れているのと区別がつきません。
 * ★作ってあるように見せないこと。
 */
function NotBuiltYet({ label }: { label: string }) {
  return (
    <>
      <WhatIsThis>この画面は、デモではまだご覧いただけません。</WhatIsThis>
      <Card title={label}>
        <Planned>
          この画面は、このデモにはまだ入れていません。
          実際にお使いいただく管理画面には入ります。
          先にご覧になりたい場合は、お問い合わせください。
        </Planned>
      </Card>
    </>
  );
}
