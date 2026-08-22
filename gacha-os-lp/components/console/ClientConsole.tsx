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
 */

"use client";

import { useReducer, useState } from "react";
import { initialState, reducer } from "@/lib/console/state";
import { Login, Mfa } from "./Gate";
import Shell from "./Shell";
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

export default function ClientConsole() {
  const [s, dispatch] = useReducer(reducer, undefined, initialState);
  const [page, setPage] = useState<MenuKey>("dashboard");

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
        return <SettingsScreen s={s} />;
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
