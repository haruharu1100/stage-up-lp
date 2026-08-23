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
import { initialState, reducer } from "@/lib/console/state";
import { daySnapshot } from "@/lib/console/dayInLife";
import { Login, Mfa } from "./Gate";
import Shell from "./Shell";
import DayInLife, { type DayRun } from "./DayInLife";
import { menuItem, type MenuKey } from "./menu";
import { Card, Planned, WhatIsThis } from "./ui";

import Dashboard from "./screens/Dashboard";
import GachaList from "./screens/GachaList";
import Builder from "./screens/Builder";
import BacktestScreen from "./screens/BacktestScreen";
import PreviewScreen from "./screens/PreviewScreen";
import RtpScreen from "./screens/RtpScreen";
import FraudCenter from "./screens/FraudCenter";
import PointScreen from "./screens/PointScreen";
import ShippingScreen from "./screens/ShippingScreen";
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

/** いま、どちら側を見ているか */
type Side = "admin" | "customer";

export default function ClientConsole() {
  const [s, dispatch] = useReducer(reducer, undefined, initialState);
  const [page, setPage] = useState<MenuKey>("dashboard");
  const [side, setSide] = useState<Side>("admin");

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
      style={{ "--switch-h": `${switchH}px` } as React.CSSProperties}
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
        <div className="bg-[#F4F5F7] pt-4">
          <MyPage s={s} dispatch={dispatch} />
        </div>
      ) : (
        <AdminSide
          s={s}
          dispatch={dispatch}
          page={page}
          setPage={setPage}
        />
      )}

      {run && (
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
      {run && !adminShell && <div style={{ height: dayH }} aria-hidden />}
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
            初めての方が知りたいのは「1日、これで回るのか」だけです */}
        {!dayRunning && (
          <button
            type="button"
            onClick={onStartDay}
            className="nb shrink-0 rounded-xl bg-white px-4 py-2.5 text-[0.78rem] font-bold text-[#0F1B33] shadow-sm transition hover:bg-[#E8EDF7]"
          >
            1日、運営してみる
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
}: {
  s: ReturnType<typeof initialState>;
  dispatch: React.Dispatch<Parameters<typeof reducer>[1]>;
  page: MenuKey;
  setPage: (k: MenuKey) => void;
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
      <Screen page={page} s={s} dispatch={dispatch} onNav={setPage} />
    </Shell>
  );
}

function Screen({
  page,
  s,
  dispatch,
  onNav,
}: {
  page: MenuKey;
  s: ReturnType<typeof initialState>;
  dispatch: React.Dispatch<Parameters<typeof reducer>[1]>;
  onNav: (k: MenuKey) => void;
}) {
  const item = menuItem(page);

  /* 見出しは、どの画面でも同じ形で出す */
  const head = (
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
        return <GachaList s={s} dispatch={dispatch} onNav={onNav} />;
      case "builder":
        return <Builder s={s} dispatch={dispatch} onNav={onNav} />;
      case "backtest":
        return <BacktestScreen s={s} dispatch={dispatch} onNav={onNav} />;
      case "preview":
        return <PreviewScreen s={s} dispatch={dispatch} onNav={onNav} />;
      case "products":
        return <ProductsScreen />;
      case "rtp":
        return <RtpScreen s={s} dispatch={dispatch} />;
      case "market":
        return <MarketScreen />;
      case "analytics":
        return <AnalyticsScreen s={s} />;
      case "fraud":
        return <FraudCenter s={s} dispatch={dispatch} />;
      case "points":
        return <PointScreen s={s} dispatch={dispatch} />;
      case "customers":
        return <CustomersScreen s={s} />;
      case "orders":
      case "shipping":
        return <ShippingScreen s={s} dispatch={dispatch} />;
      case "support":
        return <SupportScreen s={s} dispatch={dispatch} />;
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
