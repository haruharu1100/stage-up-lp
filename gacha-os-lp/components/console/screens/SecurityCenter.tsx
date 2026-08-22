/**
 * セキュリティセンター。
 *
 * ═══════════════════════════════════════════════
 * ★この画面で、いちばん見ていただきたいこと
 * ═══════════════════════════════════════════════
 *
 *   「監査ログを取っています」と書いてあるシステムは、たくさんあります。
 *   でも、その記録を後から書き換えられるなら、記録が無いのと同じです。
 *   内部の人が、自分に都合の悪い1行だけをこっそり直せてしまいます。
 *
 *   だから、この画面には「攻撃する側のボタン」を置いてあります。
 *   記録を1件だけ書き換えてから、検証を押してみてください。
 *   本当に見つかるかどうかを、その場で確かめられます。
 *
 *   ★これはデモのための操作です。本物の管理画面には置きません。
 *
 * ═══════════════════════════════════════════════
 * ★書いてよいことと、いけないこと
 * ═══════════════════════════════════════════════
 *
 *   書いてよい   … 「気づかずに1行だけ書き換えることはできません」
 *   書いてはいけない … 「改ざんできません」「絶対に安全です」
 *
 *   データベースを丸ごと自由にできる人なら、後ろ全部を作り直せます。
 *   守れる範囲を超えた約束を、画面にもLPにも書かないこと。
 *
 *   ★AIの点検だけで「第三者ペネトレーションテスト済み」と表示しないこと。
 *     実施していない検査を、実施したように見せてはいけません。
 */

"use client";

import { useState } from "react";
import type { ConsoleState, ConsoleAction, SecurityEvent } from "@/lib/console/state";
import { SECURITY_EVENT_LABEL } from "@/lib/console/state";
import { verifyAudit, type VerifyResult } from "@/lib/console/audit";
import { Badge, Btn, Card, DemoNote, KV, RowCard, Rows, Stat, Table, Td, WhatIsThis } from "../ui";

export default function SecurityCenter({
  s,
  dispatch,
}: {
  s: ConsoleState;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  const [result, setResult] = useState<VerifyResult | null>(null);

  return (
    <>
      <WhatIsThis>
        止めた操作の一覧と、記録が後から書き換えられていないかの検証です。
        実際に1件書き換えてから検証して、本当に見つかるかを試せます。
      </WhatIsThis>

      {/* ── 止めた操作 ── */}
      <BlockedList events={s.securityEvents} />

      {/* ── 監査ログの検証 ── */}
      <Card
        title="監査ログの検証（AUDIT VERIFY）"
        note="保存されている値を信じず、最初の1件から計算し直して突き合わせます。"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="記録の件数" value={s.audit.length} unit="件" />
          <Stat
            label="検証の結果"
            value={result === null ? "未実施" : result.ok ? "PASS" : "TAMPER"}
            tone={result === null ? "normal" : result.ok ? "ok" : "danger"}
          />
          <Stat
            label="確かめた件数"
            value={result === null ? "-" : result.checked}
            unit={result === null ? undefined : "件"}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Btn kind="primary" onClick={() => setResult(verifyAudit(s.audit))}>
            検証する
          </Btn>
          {result && (
            <Btn kind="ghost" onClick={() => setResult(null)}>
              結果を消す
            </Btn>
          )}
        </div>

        {result && (
          <div
            className={`mt-4 rounded-xl border px-4 py-4 ${
              result.ok
                ? "border-ok/30 bg-ok/10"
                : "border-danger/30 bg-danger/10"
            }`}
          >
            {result.ok ? (
              <>
                <Badge tone="ok">PASS ／ 改ざんは見つかりませんでした</Badge>
                <p className="mt-2 text-note leading-[1.9] text-ok-ink">
                  {result.checked}件すべてについて、記録された当時の内容から
                  計算し直した値と、保存されている値が一致しました。
                </p>
              </>
            ) : (
              <>
                <Badge tone="danger">TAMPER DETECTED ／ 書き換えを検知しました</Badge>
                <p className="mt-2 text-note font-bold leading-[1.9] text-danger-ink">
                  {result.detail}
                </p>
                <p className="mt-2 text-note leading-[1.9] text-danger-ink/85">
                  {result.brokenAt}番目より前の{result.checked}件は、
                  記録された当時のままです。
                  <br />
                  実際の運用では、ここで管理者へ通知し、
                  該当の操作を行った担当者と時刻を照合します。
                </p>
              </>
            )}
          </div>
        )}

        <p className="mt-4 text-note leading-[1.9] text-slate3">
          1件ごとに、前の1件のハッシュと今回の中身をまとめて計算し、鎖のようにつないでいます。
          途中の1件を書き換えると、そこから後ろの計算が全部合わなくなります。
          <br />
          <strong className="font-bold text-slate2">
            ★お約束できるのは「気づかずに1行だけ書き換えることはできない」までです。
          </strong>{" "}
          データベースを丸ごと自由にできる方なら、後ろ全部を作り直せます。
          そこまで防ぐには、追記しかできない保管先（Object Lock など）へ
          写しを送る構成を別途ご用意します。
        </p>
      </Card>

      {/* ── 攻撃する側のボタン ── */}
      <Card
        title="試してみる（デモ専用）"
        note="記録を1件だけ書き換えてから、上の「検証する」を押してください。"
      >
        {s.audit.length === 0 ? (
          <p className="text-note text-slate3">
            まだ記録がありません。ほかの画面で何か操作してから、ここへ戻ってきてください。
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {s.audit.slice(0, 6).map((e) => (
                <Btn
                  key={e.seq}
                  kind="danger"
                  onClick={() => {
                    dispatch({ type: "TAMPER_AUDIT", seq: e.seq });
                    setResult(null);
                  }}
                >
                  {e.seq}番を書き換える
                </Btn>
              ))}
            </div>
            <p className="mt-3 text-note leading-[1.9] text-slate3">
              押しても、画面の見た目はほとんど変わりません。件数も変わりません。
              目で見ても気づけないのが、この種の書き換えの怖いところです。
              そのうえで検証を押すと、何番目のどの記録かまで出ます。
            </p>
          </>
        )}
        <div className="mt-4">
          <DemoNote>
            この「書き換える」ボタンは、検知できることを見ていただくためのものです。
            実際にお使いいただく管理画面には入りません。
          </DemoNote>
        </div>
      </Card>

      {/* ── 防御の状況 ── */}
      <Card
        title="防御の状況"
        note="実施しているものと、していないものを、分けて出しています。"
      >
        <ul className="space-y-3">
          <Row state="done" label="監査ログのハッシュチェーン" note="この画面で検証できます。" />
          <Row state="done" label="管理者の2段階認証" note="ログイン時に必須にできます。" />
          <Row state="done" label="役割ごとの権限分離" note="6段階。申請と承認を分けています。" />
          <Row state="done" label="高額ポイント操作の二人承認" note="金額の線引きは設定で変えられます。" />
          <Row state="done" label="登録時のリスク判定" note="12の観点を重ねて点数にします。" />
          <Row state="option" label="追記のみの保管先への写し" note="Object Lock などを使う構成。ご要望に応じて設計します。" />
          <Row state="option" label="管理画面のIP制限" note="事務所の回線からのみ入れる設定。" />
          <Row
            state="not-run"
            label="第三者によるペネトレーションテスト"
            note="外部の専門会社による検査です。まだ実施していません。実施した場合は、実施日と実施会社をここに出します。"
          />
        </ul>

        <p className="mt-5 rounded-xl border border-edge bg-paper2 px-4 py-4 text-note leading-[1.9] text-slate2">
          <strong className="font-bold text-slate">
            ★実施していない検査を、実施したようには書きません。
          </strong>
          <br />
          社内の点検やAIによる確認は、第三者による検査の代わりにはなりません。
          ここは「まだ実施していない」と、そのまま出しています。
        </p>
      </Card>
    </>
  );
}

/**
 * 止めた操作の一覧。
 *
 * ═══════════════════════════════════════════════
 * ★成功した操作しか並ばない画面は、いつもきれいです
 * ═══════════════════════════════════════════════
 *
 *   きれいな記録は、攻撃されていない証明にはなりません。
 *   ただ「断ったことを数えていない」だけかもしれないからです。
 *
 *   他人の商品IDに書き換えて発送を頼む。
 *   ログインせずに残高を見に行く。
 *   権限の無い担当者が、ポイント変更のAPIを直接叩く。
 *   ——どれも、システムは正しく断ります。
 *   でも、断ったことを残していなければ、
 *   「今この瞬間、誰かが他人の資産を触ろうとしている」に、誰も気づけません。
 *
 *   1回ならURLの打ち間違いかもしれません。
 *   同じ人から30分で200回なら、それは攻撃です。
 *   数えていなければ、その区別が永久につきません。
 *
 * ★0件のときに、この枠を消さないこと。
 *   「0件でした」と出ているのと、枠ごと無いのとでは、意味が違います。
 *   前者は見張っている証拠で、後者は何も分かりません。
 */
function BlockedList({ events }: { events: SecurityEvent[] }) {
  const list = [...events].reverse();
  const blocks = events.filter((e) => e.severity === "BLOCK").length;
  const warns = events.filter((e) => e.severity === "WARN").length;

  const tone = (sv: SecurityEvent["severity"]) =>
    sv === "BLOCK" ? "danger" : sv === "WARN" ? "warn" : "neutral";

  return (
    <Card
      title="止めた操作（SECURITY EVENTS）"
      note="断った要求も、1件ずつ数えています。断ったことを残さないと、攻撃されていたことに気づけません。"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="記録した件数" value={events.length} unit="件" />
        <Stat
          label="拒否した操作"
          value={blocks}
          unit="件"
          tone={blocks > 0 ? "danger" : "ok"}
        />
        <Stat
          label="追加確認で止めた"
          value={warns}
          unit="件"
          tone={warns > 0 ? "warn" : "normal"}
        />
      </div>

      {list.length === 0 ? (
        <p className="mt-4 rounded-xl border border-ok/25 bg-ok/8 px-4 py-4 text-note leading-[1.9] text-ok-ink">
          いまのところ0件です。
          <br />
          <span className="text-slate3">
            ★0件は「見ていない」ではありません。ユーザー側の画面で、
            ログインせずに発送を頼んだり、高額のポイント交換をしたりすると、
            ここに増えます。
          </span>
        </p>
      ) : (
        <div className="mt-4">
          <Table head={["いつ", "何が起きたか", "誰が", "対象", "結果"]}>
            {list.map((e) => (
              <tr key={e.id}>
                <Td className="num whitespace-nowrap">{e.at}</Td>
                <Td>
                  <span className="font-medium text-slate">
                    {SECURITY_EVENT_LABEL[e.kind]}
                  </span>
                  <span className="mt-1 block text-slate3">{e.detail}</span>
                </Td>
                <Td className="whitespace-nowrap">{e.actor}</Td>
                <Td className="num whitespace-nowrap">{e.target}</Td>
                <Td>
                  <Badge tone={tone(e.severity)}>
                    {e.severity === "BLOCK"
                      ? "拒否した"
                      : e.severity === "WARN"
                        ? "追加確認で止めた"
                        : "記録のみ"}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>

          <Rows>
            {list.map((e) => (
              <RowCard key={e.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-note font-bold text-slate">
                    {SECURITY_EVENT_LABEL[e.kind]}
                  </span>
                  <Badge tone={tone(e.severity)}>
                    {e.severity === "BLOCK" ? "拒否した" : "止めた"}
                  </Badge>
                </div>
                <p className="mt-2 text-note leading-[1.85] text-slate2">{e.detail}</p>
                <div className="mt-2 border-t border-edge pt-2">
                  <KV k="いつ" v={<span className="num">{e.at}</span>} />
                  <KV k="誰が" v={e.actor} />
                  <KV k="対象" v={<span className="num">{e.target}</span>} />
                </div>
              </RowCard>
            ))}
          </Rows>
        </div>
      )}

      <p className="mt-4 text-note leading-[1.9] text-slate3">
        ★「見つからない」と「他人のものだ」を、同じ断り方にしています。
        断り方を分けると、商品IDを1つずつ試すだけで、
        存在する番号を外から数えられてしまいます。
      </p>
    </Card>
  );
}

function Row({
  state,
  label,
  note,
}: {
  state: "done" | "option" | "not-run";
  label: string;
  note: string;
}) {
  const conf = {
    done: { tone: "ok" as const, text: "実施しています" },
    option: { tone: "blue" as const, text: "ご要望に応じて" },
    "not-run": { tone: "neutral" as const, text: "未実施" },
  }[state];
  return (
    <li className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-note font-bold text-slate">{label}</span>
        <Badge tone={conf.tone}>{conf.text}</Badge>
      </div>
      <p className="mt-1 text-note leading-[1.85] text-slate3">{note}</p>
    </li>
  );
}
