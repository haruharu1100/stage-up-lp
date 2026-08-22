/**
 * 設定。
 *
 * ═══════════════════════════════════════════════
 * ★ここに何を置き、何を置かないか
 * ═══════════════════════════════════════════════
 *
 *   置くもの   … 運営の方針によって変わるもの
 *                （認証の強さ、二人承認の金額、回数の上限、お客様サイトの見た目）
 *
 *   置かないもの … 安全のための仕組みそのものを「切る」スイッチ
 *                 二人承認を無効にする、監査ログを止める、
 *                 理由の入力を任意にする、といった項目は作りません。
 *                 「面倒だから」で外されると、あとから戻せません。
 *
 * ★実装状況を、必ず3つに分けて表示すること。
 *     いま使えます   … 納品時から動きます
 *     ご要望に応じて  … 構成を追加すれば使えます（別途お見積り）
 *     今後対応予定   … まだありません
 *
 *   ここを曖昧にすると、そのまま説明義務違反になります。
 *   「できます」と言って納品後に無いのが、いちばん困ります。
 */

"use client";

import { useState } from "react";
import type { ConsoleState } from "@/lib/console/state";
import { FOUR_EYES_THRESHOLD, ROLE_LABEL, ROLE_PERMISSIONS, can } from "@/lib/console/state";
import { Badge, Card, DemoNote, Field, KV, RowCard, Rows, Table, Td, WhatIsThis, inputClass } from "../ui";

/** 実装状況の3区分 */
type Ready = "AVAILABLE" | "OPTION" | "PLANNED";

const READY: Record<Ready, { label: string; tone: "ok" | "blue" | "neutral" }> = {
  AVAILABLE: { label: "いま使えます", tone: "ok" },
  OPTION: { label: "ご要望に応じて", tone: "blue" },
  PLANNED: { label: "今後対応予定", tone: "neutral" },
};

const AUTH_METHODS: { key: string; label: string; note: string; ready: Ready }[] = [
  { key: "email", label: "メールアドレスの確認のみ", note: "いちばん軽い方法です。登録は増えますが、不正も入りやすくなります。", ready: "AVAILABLE" },
  { key: "sms", label: "SMS（電話番号）の確認のみ", note: "電話番号1つにつき1アカウントに絞れます。送信費用がかかります。", ready: "AVAILABLE" },
  { key: "both", label: "メール ＋ SMS の両方", note: "特典目当ての大量登録には、いちばん効きます。", ready: "AVAILABLE" },
  { key: "risk", label: "ふだんはメール、怪しいときだけSMS", note: "手がかりが重なった登録にだけ、追加の確認を求めます。ふつうのお客様の手間は増えません。", ready: "AVAILABLE" },
  { key: "passkey", label: "パスキー（指紋・顔）", note: "パスワードを使わない方式です。対応の設計は済んでいますが、まだ入れていません。", ready: "PLANNED" },
];

export default function SettingsScreen({ s }: { s: ConsoleState }) {
  const me = s.me!;
  const mayEdit = can(me.role, "settings.edit");
  const [auth, setAuth] = useState("risk");
  const [threshold, setThreshold] = useState(FOUR_EYES_THRESHOLD);

  return (
    <>
      <WhatIsThis>
        認証の強さ、承認が必要になる金額、お客様サイトの見た目を決めます。
        <strong className="font-bold text-slate">安全の仕組みそのものを切る設定は置いていません。</strong>
      </WhatIsThis>

      {!mayEdit && (
        <Card title="設定を変える権限がありません">
          <p className="text-note leading-[1.9] text-slate2">
            {ROLE_LABEL[me.role]} には、設定を変える権限がありません。内容の確認だけできます。
            <br />
            <span className="text-slate3">
              ★上の担当の切り替えから「運営 太郎」または「統括 五郎」に変えると操作できます。
            </span>
          </p>
        </Card>
      )}

      {/* ── 会員の登録方法 ── */}
      <Card
        title="お客様の登録・ログイン方法"
        note="厳しくするほど不正は減りますが、ふつうのお客様の手間も増えます。"
      >
        <ul className="space-y-3">
          {AUTH_METHODS.map((m) => (
            <li
              key={m.key}
              className={`rounded-xl border px-4 py-4 ${
                auth === m.key && m.ready === "AVAILABLE"
                  ? "border-blue-ink/30 bg-blue-pale/40"
                  : "border-edge2 bg-paper2"
              }`}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="auth"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={auth === m.key}
                  disabled={!mayEdit || m.ready !== "AVAILABLE"}
                  onChange={() => setAuth(m.key)}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-note font-bold text-slate">{m.label}</span>
                    <Badge tone={READY[m.ready].tone}>{READY[m.ready].label}</Badge>
                  </span>
                  <span className="mt-1 block text-note leading-[1.85] text-slate3">{m.note}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★どれを選んでも、同じ端末から短時間に何度も登録された場合は、
          回数の上限で先に止まります。認証方法だけに頼りません。
        </p>
      </Card>

      {/* ── 管理者のログイン ── */}
      <Card title="管理者のログイン" note="お客様よりも強くします。ここが破られると全部が破られます。">
        <ul className="space-y-3">
          <Row ready="AVAILABLE" label="管理者の2段階認証を必須にする" note="スマートフォンの認証アプリで6桁の数字を入れる方式です。いまは必須になっています。" />
          <Row ready="AVAILABLE" label="ログイン失敗が続いたら一時的に止める" note="同じ相手からの連続失敗を、回数で止めます。" />
          <Row ready="AVAILABLE" label="役割ごとに、できることを分ける" note="下の表のとおりです。全員を管理者にしないための仕組みです。" />
          <Row ready="OPTION" label="管理画面に入れる回線を限定する" note="事務所の回線からだけ入れる設定です。ご要望に応じて構成します。" />
          <Row ready="OPTION" label="パスワードを使わないログイン" note="ハードウェアキー方式。ご要望に応じて構成します。" />
        </ul>

        <div className="mt-5">
          <p className="text-note font-bold text-slate2">いまの管理者</p>
          <Table head={["名前", "役割", "2段階認証", "最終ログイン"]}>
            {s.admins.map((a) => (
              <tr key={a.id}>
                <Td className="font-bold text-slate">{a.name}</Td>
                <Td>{ROLE_LABEL[a.role]}</Td>
                <Td>
                  <Badge tone={a.mfaEnabled ? "ok" : "warn"}>
                    {a.mfaEnabled ? "設定済み" : "未設定"}
                  </Badge>
                </Td>
                <Td className="num whitespace-nowrap">{a.lastLogin}</Td>
              </tr>
            ))}
          </Table>
          <Rows>
            {s.admins.map((a) => (
              <RowCard key={a.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-note font-bold text-slate">{a.name}</span>
                  <Badge tone={a.mfaEnabled ? "ok" : "warn"}>
                    {a.mfaEnabled ? "2段階認証あり" : "2段階認証なし"}
                  </Badge>
                </div>
                <div className="mt-2 border-t border-edge pt-2">
                  <KV k="役割" v={ROLE_LABEL[a.role]} />
                  <KV k="最終ログイン" v={<span className="num">{a.lastLogin}</span>} />
                </div>
              </RowCard>
            ))}
          </Rows>
        </div>
      </Card>

      {/* ── 二人承認の金額 ── */}
      <Card title="別の管理者の承認が必要になる金額" note="これ以上のポイント操作は、1人では実行できません。">
        <div className="max-w-sm">
          <Field label="承認が必要になる金額" note="この値以上は、必ず別の管理者が承認します。">
            <input
              className={`${inputClass} num`}
              inputMode="numeric"
              value={threshold}
              disabled={!mayEdit}
              onChange={(e) => setThreshold(Number(e.target.value.replace(/\D/g, "")) || 0)}
            />
          </Field>
        </div>
        <p className="mt-4 rounded-xl border border-warn/30 bg-warn/8 px-4 py-4 text-note leading-[1.9] text-warn-ink">
          <strong className="font-bold">★この仕組み自体を切ることはできません。</strong>
          <br />
          金額の線引きは変えられますが、「承認なしで実行する」設定は作っていません。
          自分が出した申請を自分で承認することもできません。
          ここを緩められるようにすると、二人承認は形だけになります。
        </p>
        <p className="mt-3 text-note leading-[1.9] text-slate3">
          ★承認できる管理者は、必ず2人以上ご登録ください。
          1人しかいないと、その方が出した申請を誰も承認できず、永久に止まります。
          いまは
          <span className="num font-bold text-slate2">
            {" "}
            {s.admins.filter((a) => can(a.role, "point.approve")).length}名{" "}
          </span>
          が承認できます。
        </p>
      </Card>

      {/* ── 回数の上限 ── */}
      <Card title="回数の上限" note="短い時間に何度も繰り返す動きを、先に止めます。">
        <Table head={["対象", "上限", "何を防ぐか", "状況"]}>
          {[
            ["新規登録", "同一IPから 10回 / 10分", "特典目当ての大量登録", "AVAILABLE"],
            ["ログイン", "同一IPから 10回 / 5分", "パスワードの総当たり", "AVAILABLE"],
            ["SMS送信", "同一番号へ 3回 / 1時間", "SMS爆撃と送信費用の浪費", "AVAILABLE"],
            ["パスワード再発行", "同一アカウント 5回 / 1時間", "アカウント乗っ取りの試行", "AVAILABLE"],
            ["ガチャを引く", "同一アカウント 30回 / 1分", "抽選APIの連打", "AVAILABLE"],
            ["問い合わせ送信", "同一アカウント 5回 / 10分", "いたずら送信", "AVAILABLE"],
            ["外部連携API", "APIキーごと 600回 / 1分", "連携先の異常", "OPTION"],
          ].map(([target, limit, why, ready]) => (
            <tr key={target}>
              <Td className="font-bold text-slate">{target}</Td>
              <Td className="num whitespace-nowrap">{limit}</Td>
              <Td>{why}</Td>
              <Td>
                <Badge tone={READY[ready as Ready].tone}>{READY[ready as Ready].label}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
        <Rows>
          {[
            ["新規登録", "同一IPから 10回 / 10分", "特典目当ての大量登録"],
            ["ログイン", "同一IPから 10回 / 5分", "パスワードの総当たり"],
            ["SMS送信", "同一番号へ 3回 / 1時間", "SMS爆撃と送信費用の浪費"],
            ["パスワード再発行", "同一アカウント 5回 / 1時間", "アカウント乗っ取りの試行"],
            ["ガチャを引く", "同一アカウント 30回 / 1分", "抽選APIの連打"],
            ["問い合わせ送信", "同一アカウント 5回 / 10分", "いたずら送信"],
          ].map(([target, limit, why]) => (
            <RowCard key={target}>
              <p className="text-note font-bold text-slate">{target}</p>
              <div className="mt-2 border-t border-edge pt-2">
                <KV k="上限" v={<span className="num">{limit}</span>} />
                <KV k="防ぐもの" v={why} />
              </div>
            </RowCard>
          ))}
        </Rows>
        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★回線（IP）だけで数えていません。アカウント・端末・接続ごとにも数えます。
          回線だけで数えると、回線を変えるだけで抜けられます。
        </p>
      </Card>

      {/* ── 役割ごとにできること ── */}
      <Card title="役割ごとにできること" note="全員を管理者にしないための表です。">
        <Table head={["役割", "できること"]}>
          {(Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]).map((r) => (
            <tr key={r}>
              <Td className="whitespace-nowrap font-bold text-slate">{ROLE_LABEL[r]}</Td>
              <Td>
                <span className="num">{ROLE_PERMISSIONS[r].length}項目</span>
                <span className="mt-1 block text-slate3">{PERM_SUMMARY[r]}</span>
              </Td>
            </tr>
          ))}
        </Table>
        <Rows>
          {(Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]).map((r) => (
            <RowCard key={r}>
              <p className="text-note font-bold text-slate">{ROLE_LABEL[r]}</p>
              <p className="mt-1 text-note leading-[1.85] text-slate3">{PERM_SUMMARY[r]}</p>
            </RowCard>
          ))}
        </Rows>
        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★ポイントを「申請できる人」と「承認できる人」を分けてあります。
          経理は申請だけ、承認は管理者だけです。
        </p>
      </Card>

      {/* ── お客様サイト ── */}
      <Card
        title="お客様が見るサイトの設定"
        note="コードを書かずに変えられる範囲です。"
      >
        <ul className="space-y-3">
          <Row ready="AVAILABLE" label="店名・ロゴ・色" note="お客様サイトと管理画面の両方に反映されます。" />
          <Row ready="AVAILABLE" label="トップページの見出しと説明文" note="文章を書き換えるだけです。" />
          <Row ready="AVAILABLE" label="お知らせの掲載" note="メンテナンス予定や新しいガチャの告知に使います。" />
          <Row ready="AVAILABLE" label="特定商取引法・プライバシーポリシーの本文" note="事業者名・住所・古物商許可番号などを入れる欄です。" />
          <Row ready="AVAILABLE" label="発送に関する案内文" note="発送までの日数や送料の説明です。" />
          <Row ready="OPTION" label="独自ドメインの割り当て" note="お持ちのドメインを使う場合の設定です。" />
          <Row ready="PLANNED" label="ページを自由に組み立てる編集画面" note="ブロックを並べて自由にページを作る機能は、まだありません。" />
        </ul>
        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★法令で表示が必要な項目は、空欄のままでは公開できないようにしています。
          「あとで入れよう」で公開されるのを、仕組みで防ぎます。
        </p>
      </Card>

      <DemoNote>
        このデモでは、設定を変えても保存されません。ページを閉じると元に戻ります。
        本物の管理画面では、変更のたびに「誰がいつ何をどう変えたか」が監査ログに残ります。
      </DemoNote>
    </>
  );
}

const PERM_SUMMARY: Record<string, string> = {
  VIEWER: "見るだけ。何も変えられません。",
  SUPPORT: "発送処理と、問い合わせへの返信ができます。",
  OPERATOR: "ガチャの作成・公開・停止と、発送・問い合わせができます。ポイントは触れません。",
  FINANCE: "ポイント変更の申請と、監査ログの確認ができます。承認はできません。",
  SECURITY: "不正判定の処理と、監査ログの検証、会員の一時停止ができます。",
  SUPER_ADMIN: "すべてできます。ただし、自分の申請を自分で承認することはできません。",
};

function Row({ ready, label, note }: { ready: Ready; label: string; note: string }) {
  return (
    <li className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-note font-bold text-slate">{label}</span>
        <Badge tone={READY[ready].tone}>{READY[ready].label}</Badge>
      </div>
      <p className="mt-1 text-note leading-[1.85] text-slate3">{note}</p>
    </li>
  );
}
