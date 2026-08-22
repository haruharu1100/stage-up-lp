/**
 * 問い合わせ。
 *
 * ═══════════════════════════════════════════════
 * ★AIに答えさせるものと、答えさせないもの
 * ═══════════════════════════════════════════════
 *
 *   答えさせてよい   … 発送はいつか、ポイントの残りはいくつか、
 *                      使い方が分からない、といった「調べれば分かること」
 *
 *   答えさせない    … 返金、規約違反の判断、不正判定に関わること、
 *                      お客様が強く怒っているとき
 *
 *   後者をAIに答えさせると、一言で取り返しがつかなくなります。
 *   だから、AIは下書きだけ作って人に渡します。
 *
 * ★「AIが答えました」と「人が答えました」を、必ず区別して表示すること。
 *   運営者が、どれを自分で確認したのかを分からなくしてはいけません。
 *
 * ★AIが人へ回したときは、その理由を必ず出すこと。
 *   理由がないと、運営者は「なぜ自分に来たのか」から調べ始めます。
 */

"use client";

import { useState } from "react";
import type { ConsoleState, ConsoleAction, Ticket } from "@/lib/console/state";
import { can } from "@/lib/console/state";
import { Badge, Btn, Card, DemoNote, Field, Stat, WhatIsThis, inputClass } from "../ui";

const STATUS: Record<
  Ticket["status"],
  { label: string; tone: "ok" | "warn" | "blue" | "neutral" }
> = {
  AI_ANSWERED: { label: "AIが回答済み", tone: "blue" },
  HUMAN_REVIEW: { label: "人の確認が必要", tone: "warn" },
  IN_PROGRESS: { label: "対応中", tone: "warn" },
  DONE: { label: "対応済み", tone: "ok" },
};

export default function SupportScreen({
  s,
  dispatch,
}: {
  s: ConsoleState;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  const me = s.me!;
  const mayReply = can(me.role, "support.reply");

  const human = s.tickets.filter((t) => t.status === "HUMAN_REVIEW");
  const rest = s.tickets.filter((t) => t.status !== "HUMAN_REVIEW");

  return (
    <>
      <WhatIsThis>
        お客様からの問い合わせです。調べれば分かるものはAIが答えます。
        <strong className="font-bold text-slate">返金や不正判定に関わるものは、AIは答えません</strong>
        。下書きだけ作って、ここへ回します。
      </WhatIsThis>

      <Card title="いまの状況">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="人の確認が必要"
            value={human.length}
            unit="件"
            tone={human.length > 0 ? "warn" : "ok"}
            sub="ここだけ見れば足ります"
          />
          <Stat
            label="AIが回答済み"
            value={s.tickets.filter((t) => t.status === "AI_ANSWERED").length}
            unit="件"
            tone="ok"
          />
          <Stat label="対応済み" value={s.tickets.filter((t) => t.status === "DONE").length} unit="件" />
          <Stat label="全体" value={s.tickets.length} unit="件" />
        </div>
      </Card>

      {/* ── 人が見るもの ── */}
      <Card
        title="人の確認が必要なもの"
        note="AIが自分では答えなかったものです。理由も出しています。"
      >
        {human.length === 0 ? (
          <p className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-4 text-note font-bold text-ok-ink">
            人が見るべき問い合わせはありません。
          </p>
        ) : (
          <ul className="space-y-4">
            {human.map((t) => (
              <TicketCard key={t.id} t={t} mayReply={mayReply} dispatch={dispatch} />
            ))}
          </ul>
        )}
      </Card>

      {/* ── それ以外 ── */}
      <Card title="そのほかの問い合わせ" note="AIが答えたものと、対応が終わったものです。">
        {rest.length === 0 ? (
          <p className="text-note text-slate3">ありません。</p>
        ) : (
          <ul className="space-y-3">
            {rest.map((t) => (
              <li key={t.id} className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-note font-bold text-slate">{t.subject}</p>
                  <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                </div>
                <p className="num mt-1 text-note text-slate3">
                  {t.userName} ／ {t.at}
                </p>
                <p className="mt-2 text-note leading-[1.9] text-slate2">{t.body}</p>
                {t.reply && (
                  <div className="mt-3 rounded-lg border border-edge bg-paper px-3 py-2.5">
                    <p className="text-note font-bold text-slate3">返信した内容</p>
                    <p className="mt-1 text-note leading-[1.9] text-slate2">{t.reply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DemoNote>
        このデモは、お客様へのメール送信につながっていません。
        「送る」を押しても、実際には送信されません。画面の中だけで動きます。
      </DemoNote>
    </>
  );
}

function TicketCard({
  t,
  mayReply,
  dispatch,
}: {
  t: Ticket;
  mayReply: boolean;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  const [text, setText] = useState(t.aiDraft ?? "");

  return (
    <li className="rounded-xl border border-warn/35 bg-warn/8 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-note font-bold text-slate">{t.subject}</p>
        <Badge tone="warn">人の確認が必要</Badge>
      </div>
      <p className="num mt-1 text-note text-slate3">
        {t.userName} ／ {t.at}
      </p>

      <div className="mt-3 rounded-lg border border-edge bg-paper px-3 py-2.5">
        <p className="text-note font-bold text-slate3">お客様からの内容</p>
        <p className="mt-1 text-note leading-[1.9] text-slate2">{t.body}</p>
      </div>

      {/* ★なぜAIが答えなかったのか。ここを省かないこと */}
      {t.escalateReason && (
        <p className="mt-3 rounded-lg border border-blue-pale bg-blue-pale/50 px-3 py-2.5 text-note leading-[1.9] text-slate2">
          <span className="mr-2 font-bold text-blue-ink">AIが答えなかった理由</span>
          {t.escalateReason}
        </p>
      )}

      {mayReply ? (
        <div className="mt-4 space-y-3">
          <Field
            label="返信する内容"
            note="AIが下書きを用意しています。そのままでも、書き直しても構いません。"
          >
            <textarea
              className={`${inputClass} min-h-[7rem]`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Btn
              kind="primary"
              disabled={!text.trim()}
              onClick={() => dispatch({ type: "SUPPORT_REPLY", ticketId: t.id, text })}
            >
              この内容で返信する
            </Btn>
            {t.aiDraft && (
              <Btn kind="ghost" onClick={() => setText(t.aiDraft!)}>
                AIの下書きに戻す
              </Btn>
            )}
          </div>
          <p className="text-note leading-[1.85] text-slate3">
            ★送るかどうかは、必ず人が決めます。AIが勝手に送ることはありません。
          </p>
        </div>
      ) : (
        <p className="mt-4 text-note text-slate3">
          ★いまの担当には、返信の権限がありません。
          上の担当の切り替えから「サポート 三郎」に変えると返信できます。
        </p>
      )}
    </li>
  );
}
