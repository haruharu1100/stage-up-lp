/**
 * ポイント管理。
 *
 * ═══════════════════════════════════════════════
 * ★ポイントは、お金そのものです
 * ═══════════════════════════════════════════════
 *
 *   お客様が現金で買ったものが、ポイントとして残っています。
 *   管理画面から自由に増やせる状態は、
 *   レジからいつでも現金を出せる状態と同じです。
 *
 *   だから、この画面には3つの縛りを入れてあります。
 *
 *     ① 理由を書かないと実行できない
 *     ② 誰が・誰に・何ポイント・なぜ・いくらからいくらへ を必ず記録する
 *     ③ 大きな金額は、別の管理者が承認しないと1ptも動かない
 *
 *   ③が「二人承認（FOUR EYES）」です。
 *   ★自分が出した申請を、自分で承認できないようにしてあること。
 *     ここを緩めると、二人承認は形だけになります。
 *
 * ★「面倒だから外したい」と言われても、外さないこと。
 *   面倒にしてあるのは、内部の人が1人で現金を動かせないようにするためです。
 *   ここを外すと、何かあったときに「誰がやったか分からない」状態になります。
 */

"use client";

import { useState } from "react";
import type { ConsoleState, ConsoleAction } from "@/lib/console/state";
import {
  FOUR_EYES_THRESHOLD,
  ROLE_LABEL,
  approversOtherThan,
  can,
  canApprove,
  pointsReconcile,
} from "@/lib/console/state";
import { Badge, Btn, Card, Field, KV, Stat, WhatIsThis, inputClass } from "../ui";

export default function PointScreen({
  s,
  dispatch,
}: {
  s: ConsoleState;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  const me = s.me!;
  const mayRequest = can(me.role, "point.request");
  const [userId, setUserId] = useState(s.users[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  const n = Number(delta.replace(/[^\d-]/g, ""));
  const valid = Number.isFinite(n) && n !== 0;
  const needsApproval = valid && Math.abs(n) >= FOUR_EYES_THRESHOLD;
  const approvers = approversOtherThan(s, me.id);

  const pending = s.pointRequests.filter((r) => r.status === "PENDING");
  const done = s.pointRequests.filter((r) => r.status !== "PENDING");

  return (
    <>
      <WhatIsThis>
        会員のポイントを増やしたり減らしたりします。
        <strong className="font-bold text-slate">理由の入力は必須</strong>
        で、{FOUR_EYES_THRESHOLD.toLocaleString()}pt 以上は
        <strong className="font-bold text-slate">別の管理者の承認</strong>
        がないと反映されません。
      </WhatIsThis>

      <Reconcile s={s} />

      {/* ── 申請する ── */}
      <Card title="ポイントを変更する" note="お詫び・調査結果の反映・入力ミスの訂正など。">
        {!mayRequest ? (
          <p className="rounded-xl border border-edge bg-paper2 px-4 py-4 text-note leading-[1.9] text-slate2">
            {ROLE_LABEL[me.role]} には、ポイントを変更する権限がありません。
            経理または管理者にご依頼ください。
            <br />
            <span className="text-slate3">
              ★ここで「権限がありません」と出ること自体が、この仕組みの目的です。
              誰でも触れる状態にはしていません。
            </span>
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="どの会員か">
                <select
                  className={inputClass}
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                >
                  {s.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}（現在 {u.points.toLocaleString()}pt）
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="増やす／減らすポイント" note="減らすときは頭に「-」を付けます。">
                <input
                  className={`${inputClass} num`}
                  inputMode="numeric"
                  placeholder="例）500 または -500"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                />
              </Field>
            </div>

            <Field
              label="理由"
              required
              note="あとから見たときに、それだけで意味が分かるように書いてください。"
            >
              <textarea
                className={`${inputClass} min-h-[6rem]`}
                placeholder="例）2026-08-21 の抽選エラーに対するお詫び。問い合わせ番号 t_301。"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>

            {needsApproval && (
              <p className="rounded-xl border border-warn/35 bg-warn/10 px-4 py-3 text-note leading-[1.9] text-warn-ink">
                {FOUR_EYES_THRESHOLD.toLocaleString()}pt 以上のため、
                <strong className="font-bold">別の管理者の承認</strong>が必要です。
                承認されるまで、1ptも動きません。
                {approvers.length === 0 ? (
                  <>
                    <br />
                    いまは承認できる方が他にいないため、この申請は受け付けられません。
                  </>
                ) : (
                  <>
                    <br />
                    承認できる方：{approvers.map((a) => a.name).join(" ／ ")}
                  </>
                )}
              </p>
            )}

            <Btn
              kind="primary"
              disabled={!valid || !reason.trim()}
              onClick={() => {
                dispatch({ type: "POINT_REQUEST", userId, delta: n, reason });
                setDelta("");
                setReason("");
              }}
            >
              {needsApproval ? "承認を申請する" : "変更する"}
            </Btn>

            {(!valid || !reason.trim()) && (
              <p className="text-note text-slate3">
                ポイント数と理由の両方を入れてください。理由のない変更は記録できません。
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ── 承認待ち ── */}
      <Card
        title="承認待ち"
        note={`${FOUR_EYES_THRESHOLD.toLocaleString()}pt 以上の変更は、ここに溜まります。`}
      >
        {pending.length === 0 ? (
          <p className="text-note text-slate3">承認待ちの申請はありません。</p>
        ) : (
          <ul className="space-y-4">
            {pending.map((r) => {
              const check = canApprove(r, me);
              return (
                <li key={r.id} className="rounded-xl border border-warn/35 bg-warn/8 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-note font-bold text-slate">
                      {r.userName} へ{" "}
                      <span className="num text-warn-ink">
                        {r.delta > 0 ? "+" : ""}
                        {r.delta.toLocaleString()}pt
                      </span>
                    </p>
                    <Badge tone="warn">承認待ち</Badge>
                  </div>

                  <div className="mt-3 border-t border-warn/25 pt-3">
                    <KV k="申請した人" v={r.requestedByName} />
                    <KV k="申請した時刻" v={<span className="num">{r.requestedAt}</span>} />
                    <KV k="理由" v={r.reason} />
                    <KV
                      k="変更前の残高"
                      v={<span className="num">{r.balanceBefore.toLocaleString()}pt</span>}
                    />
                  </div>

                  {check.ok ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Btn
                        kind="primary"
                        onClick={() => dispatch({ type: "POINT_APPROVE", requestId: r.id })}
                      >
                        承認して反映する
                      </Btn>
                      <Btn
                        kind="danger"
                        onClick={() =>
                          dispatch({
                            type: "POINT_REJECT",
                            requestId: r.id,
                            reason: "内容を確認できないため却下",
                          })
                        }
                      >
                        却下する
                      </Btn>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-lg border border-edge bg-paper px-3 py-2.5 text-note leading-[1.85] text-slate2">
                      {check.why}
                      {r.requestedBy === me.id && (
                        <>
                          <br />
                          <span className="text-slate3">
                            ★上の担当の切り替えから別の管理者に変えると、承認できます。
                            本物では、別の方がご自身の端末からログインして承認します。
                          </span>
                        </>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── 処理済み ── */}
      <Card title="処理済みの変更" note="すべて監査ログにも残っています。">
        {done.length === 0 ? (
          <p className="text-note text-slate3">まだありません。</p>
        ) : (
          <ul className="space-y-3">
            {done.map((r) => (
              <li key={r.id} className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-note font-bold text-slate">
                    {r.userName} ／{" "}
                    <span className="num">
                      {r.delta > 0 ? "+" : ""}
                      {r.delta.toLocaleString()}pt
                    </span>
                  </p>
                  <Badge tone={r.status === "APPLIED" ? "ok" : "danger"}>
                    {r.status === "APPLIED" ? "反映済み" : "却下"}
                  </Badge>
                </div>
                <div className="mt-2 border-t border-edge2 pt-2">
                  <KV k="申請した人" v={r.requestedByName} />
                  {r.approvedByName && <KV k="承認した人" v={r.approvedByName} />}
                  <KV k="理由" v={r.reason} />
                  {r.balanceAfter !== undefined && (
                    <KV
                      k="残高"
                      v={
                        <span className="num">
                          {r.balanceBefore.toLocaleString()}pt → {r.balanceAfter.toLocaleString()}pt
                        </span>
                      }
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/* ══════════════════════════════════════════════
   ポイントが合っているかの点検
   ══════════════════════════════════════════════ */

/**
 * 会員ごとに「いまの残高」と「ポイント履歴の合計」を突き合わせる。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、この画面のいちばん上に置くのか
 * ═══════════════════════════════════════════════
 *
 *   ポイントは、お金と同じものです。
 *   お客様がガチャを引けば減り、商品をポイントに交換すれば増え、
 *   運営が調整すれば動きます。動く場所が多いということは、
 *   どこか1か所でも記録を書き忘れれば、静かにずれるということです。
 *
 *   ずれは、音を立てません。
 *   画面には残高がそのまま出るので、見た目は何ともありません。
 *   気づくのは、たいてい月末に集計が合わなくなったときで、
 *   そこから「いつからずれていたのか」を探す作業が始まります。
 *   1か月ぶんの操作を全部読み直すことになります。
 *
 *   だから、ポイントを触る画面を開いた瞬間に、
 *   いちばん最初に目に入る場所へ置きます。
 *
 * ★合っているときも、必ず表示すること。
 *   異常なときだけ出す作りにすると、
 *   何も出ていないのが「正常」なのか「点検していない」のかが
 *   区別できません。
 */
function Reconcile({ s }: { s: ConsoleState }) {
  const rows = pointsReconcile(s);
  if (rows.length === 0) return null;

  const bad = rows.filter((r) => !r.ok);
  const ok = bad.length === 0;

  return (
    <Card
      title="ポイントの点検"
      note="いまの残高と、ポイント履歴の合計が合っているかを、開くたびに確かめています。"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="点検した会員" value={rows.length} unit="名" />
        <Stat
          label="合っている"
          value={rows.length - bad.length}
          unit="名"
          tone="ok"
        />
        <Stat
          label="合っていない"
          value={bad.length}
          unit="名"
          tone={ok ? "ok" : "danger"}
          sub={ok ? undefined : "原因が分かるまで触らないでください"}
        />
        <Stat
          label="履歴の件数"
          value={s.ledger.length}
          unit="件"
        />
      </div>

      <div
        className={[
          "mt-4 rounded-xl border px-4 py-3 text-note leading-[1.9]",
          ok
            ? "border-ok/30 bg-ok/10 text-ok-ink"
            : "border-danger/40 bg-danger/10 text-danger-ink",
        ].join(" ")}
      >
        {ok ? (
          <>
            <strong className="font-bold">全員ぶん、合っています。</strong>{" "}
            それぞれの残高は、ポイント履歴を1件ずつ足し上げた金額と、1ptの違いもありません。
            つまり、いまの残高は全部「なぜその金額なのか」を説明できます。
          </>
        ) : (
          <>
            <strong className="font-bold">合っていない会員がいます。</strong>{" "}
            残高だけが動いて、履歴に残っていないポイントがあります。
            これは、後から誰にも説明できないお金です。
            原因が分かるまで、この会員のポイントは変更しないでください。
          </>
        )}
      </div>

      <ul className="mt-4 space-y-1.5">
        {rows.map((r) => (
          <li
            key={r.userId}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-edge bg-paper2 px-3 py-2"
          >
            <span className="text-note font-bold text-slate">{r.name}</span>
            <span className="num flex flex-wrap items-baseline gap-x-3 text-note text-slate3">
              <span>残高 {r.wallet.toLocaleString()}pt</span>
              <span>履歴の合計 {r.ledger.toLocaleString()}pt</span>
              <Badge tone={r.ok ? "ok" : "danger"}>{r.ok ? "一致" : "不一致"}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
