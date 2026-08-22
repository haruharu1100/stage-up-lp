/**
 * 不正対策センター（FRAUD CENTER）。
 *
 * ═══════════════════════════════════════════════
 * ★この画面の決まり（いちばん大事）
 * ═══════════════════════════════════════════════
 *
 *   1) 点数だけを出して遮断しないこと。
 *      「88点なので止めました」では、運営者が何も説明できません。
 *      お客様から「なぜ登録できないのか」と問い合わせが来たとき、
 *      答えられない状態は、不正を見逃すのと同じくらい危険です。
 *      だから、観測した中身をそのまま並べます。
 *        「同一IPから17アカウント（10分以内）」
 *        「同じ端末から6アカウント」
 *        「入力から送信まで 0.4秒」
 *        「SMS再送 12回」
 *
 *   2) この画面から永久BANはできないこと。
 *      できるのは
 *        通す / 追加認証を求める / 保留して人が見る / 登録を止める
 *      までです。「登録を止める」も、あとから解除できます。
 *      誤検知は必ず起きます。取り返しのつく作りにしておくこと。
 *
 *   3) 1つの手がかりだけで止めないこと。
 *      同じIPは、社員寮・学校・会社・大手キャリアの回線でも起きます。
 *      VPNも、普通に使っている人が大勢います。
 *      判定の仕組みは lib/console/fraud.ts 側で蓋をしてあります。
 */

"use client";

import { useState } from "react";
import type { ConsoleState, ConsoleAction } from "@/lib/console/state";
import { fraudCounts } from "@/lib/console/state";
import { SIGNALS, type Assessment } from "@/lib/console/fraud";
import { Badge, Btn, Card, DemoNote, RiskBadge, Stat, WhatIsThis } from "../ui";

export default function FraudCenter({
  s,
  dispatch,
}: {
  s: ConsoleState;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  const c = fraudCounts(s);
  const [burst, setBurst] = useState<number | null>(null);

  return (
    <>
      <WhatIsThis>
        新規登録に怪しい点がないかを見ます。
        <strong className="font-bold text-slate">確認が必要なもの</strong>
        だけがここに出ます。判定した理由も一緒に出るので、
        お客様から問い合わせが来ても、そのまま説明できます。
      </WhatIsThis>

      {/* ── 今日の登録 ── */}
      <Card title="今日の新規登録" note="ほとんどは、何もしなくてもそのまま通っています。">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="今日の新規登録" value={c.total} unit="件" />
          <Stat label="通常登録" value={c.normal} unit="件" tone="ok" sub="そのまま通した" />
          <Stat label="追加認証" value={c.stepUp} unit="件" tone="warn" sub="SMSなどを求めた" />
          <Stat label="要確認" value={c.review} unit="件" tone="warn" sub="人が見る" />
          <Stat label="登録を止めた" value={c.block} unit="件" tone="danger" sub="解除できます" />
        </div>
        <p className="mt-4 text-note leading-[1.9] text-slate3">
          {c.total.toLocaleString()}件のうち、手を動かしていただくのは
          <strong className="font-bold text-slate2">
            {" "}
            {(c.review + c.block).toLocaleString()}件{" "}
          </strong>
          だけです。残りはシステムが処理しています。
        </p>
      </Card>

      {/* ── 実際に手を動かす分 ── */}
      <Card
        title="確認が必要な登録"
        note="なぜそう判定したのかを、必ず一緒に出しています。"
      >
        {c.pending.length === 0 ? (
          <p className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-4 text-note font-bold text-ok-ink">
            すべて処理済みです。
          </p>
        ) : (
          <ul className="space-y-4">
            {c.pending.map((sg) => (
              <li
                key={sg.id}
                className="rounded-xl border border-edge bg-paper2 px-4 py-4 sm:px-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num text-note font-bold text-slate">
                      {sg.emailMasked}
                    </p>
                    <p className="num mt-0.5 text-note text-slate3">
                      {sg.at} ／ IP {sg.ipMasked}
                    </p>
                  </div>
                  <RiskBadge level={sg.risk.level} />
                </div>

                <Reasons a={sg.risk} />

                <div className="mt-4 flex flex-wrap gap-2">
                  <Btn
                    onClick={() =>
                      dispatch({ type: "FRAUD_HANDLE", signupId: sg.id, decision: "ALLOW" })
                    }
                  >
                    通す
                  </Btn>
                  <Btn
                    onClick={() =>
                      dispatch({ type: "FRAUD_HANDLE", signupId: sg.id, decision: "STEP_UP" })
                    }
                  >
                    追加認証を求める
                  </Btn>
                  <Btn
                    onClick={() =>
                      dispatch({ type: "FRAUD_HANDLE", signupId: sg.id, decision: "REVIEW" })
                    }
                  >
                    保留して調べる
                  </Btn>
                  <Btn
                    kind="danger"
                    onClick={() =>
                      dispatch({ type: "FRAUD_HANDLE", signupId: sg.id, decision: "DENY" })
                    }
                  >
                    登録を止める
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-5 rounded-xl border border-blue-pale bg-blue-pale/50 px-4 py-3 text-note leading-[1.9] text-slate2">
          <strong className="font-bold text-blue-ink">この画面では、永久停止はできません。</strong>{" "}
          できるのは、通す・追加認証を求める・保留する・登録を止める、の4つです。
          「登録を止める」もあとから解除できます。
          間違えたときに取り返しがつかない操作を、判定の画面には置きません。
        </p>
      </Card>

      {/* ── 大量登録が来たときの動き ── */}
      <Card
        title="大量の不正登録が来たとき"
        note="新規登録キャンペーンや紹介特典は、必ず狙われます。"
      >
        <p className="text-note leading-[1.9] text-slate2">
          1人が100アカウント作れば、100人分の特典を持っていかれます。
          これは正規の登録画面を正規の手順で使われるので、
          ファイアウォールでは止まりません。入口で見分けるしかありません。
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {[1, 20, 100, 500].map((n) => (
            <Btn key={n} kind={burst === n ? "primary" : "normal"} onClick={() => setBurst(n)}>
              {n}件が同時に来たら
            </Btn>
          ))}
          {burst !== null && (
            <Btn kind="ghost" onClick={() => setBurst(null)}>
              戻す
            </Btn>
          )}
        </div>

        {burst !== null && <BurstResult n={burst} />}
      </Card>

      {/* ── 何を見ているのか ── */}
      <Card title="何を見て判定しているのか" note="12の観点を重ねて点数にしています。">
        <ul className="space-y-3">
          {Object.values(SIGNALS).map((d) => (
            <li key={d.key} className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-note font-bold text-slate">{d.label}</span>
                <Badge>単独では最大 {d.solo}</Badge>
              </div>
              <p className="mt-1 text-note leading-[1.85] text-slate3">{d.why}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-note leading-[1.9] text-slate3">
          ★どれか1つだけでは、登録を止めません。
          同じIPは、会社・学校・寮・大手キャリアの回線でも起きます。
          VPNも普通に使っている方が大勢います。
          重なったときにだけ強く効くようにしてあります。
        </p>
      </Card>

      <DemoNote>
        ここに出ている登録は、すべて架空です。実在の方の情報ではありません。
        メールアドレスとIPは、本物の管理画面でも一部を伏せて表示します。
      </DemoNote>
    </>
  );
}

/** 判定の理由。ここを省かないこと */
function Reasons({ a }: { a: Assessment }) {
  return (
    <div className="mt-3">
      <p className="text-note font-bold text-slate2">
        判定した理由
        <span className="num ml-2 font-medium text-slate3">（{a.score}点）</span>
      </p>
      {a.hits.length === 0 ? (
        <p className="mt-1 text-note text-slate3">気になる点はありません。</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {a.hits.map((h) => (
            <li key={h.key} className="flex flex-wrap items-baseline gap-2">
              <span className="text-note font-medium text-slate2">{h.label}</span>
              <span className="num text-note text-slate3">— {h.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-note leading-[1.85] text-slate3">{a.explain}</p>
      {a.cappedBy && (
        <p className="mt-2 rounded-lg border border-ok/25 bg-ok/8 px-3 py-2 text-note leading-[1.8] text-ok-ink">
          {a.cappedBy}
        </p>
      )}
    </div>
  );
}

/**
 * 大量登録が来たときの内訳。
 *
 * ★この数字は「こう分かれる見込み」であって、実測ではありません。
 *   そう書いてあること。実測のように見せないこと。
 */
function BurstResult({ n }: { n: number }) {
  /* 500件のときの内訳を基準に、比率で割る */
  const normal = Math.round(n * 0.944);
  const stepUp = Math.max(0, Math.round(n * 0.042));
  const review = Math.max(0, Math.round(n * 0.01));
  const block = Math.max(0, n - normal - stepUp - review);

  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="通常登録" value={normal} unit="件" tone="ok" />
        <Stat label="追加認証" value={stepUp} unit="件" tone="warn" />
        <Stat label="要確認" value={review} unit="件" tone="warn" />
        <Stat label="登録を止めた" value={block} unit="件" tone="danger" />
      </div>
      <p className="mt-3 text-note leading-[1.9] text-slate3">
        {n}件が同時に来ても、運営者が手を動かすのは
        <strong className="font-bold text-slate2"> {review + block}件 </strong>
        だけです。
        <br />
        ★この内訳は、判定の仕組みから計算した見込みです。実際の測定値ではありません。
        実際の比率は、扱う商材とキャンペーンの内容によって変わります。
      </p>
    </div>
  );
}
