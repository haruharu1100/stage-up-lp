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
import {
  Badge,
  Btn,
  Card,
  DemoNote,
  Drawer,
  Field,
  KV,
  RowCard,
  Rows,
  Stat,
  Table,
  Td,
  Tr,
  WhatIsThis,
  inputClass,
} from "../ui";

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

  /**
   * いま開いている1件。
   *
   * ★件そのものではなく、番号だけを持つこと。
   *   返信した瞬間に状態が「対応中」へ変わります。
   *   件を写して持つと、板の中だけ「人の確認が必要」のまま残り、
   *   押したのに何も起きていないように見えます。
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (s.tickets.find((t) => t.id === openId) ?? null) : null;

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
        note="AIが自分では答えなかったものです。行を押すと、理由と返信欄が右に出ます。"
      >
        {human.length === 0 ? (
          <p className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-4 text-note font-bold text-ok-ink">
            人が見るべき問い合わせはありません。
          </p>
        ) : (
          <TicketList list={human} openId={openId} onOpen={setOpenId} tone="warn" />
        )}
      </Card>

      {/* ── それ以外 ── */}
      <Card
        title="そのほかの問い合わせ"
        note="AIが答えたものと、対応が終わったものです。行を押すと、やり取りが右に出ます。"
      >
        {rest.length === 0 ? (
          <p className="text-note leading-[1.85] text-slate3">
            AIが答えたものと、対応が終わったものは、まだ1件もありません。
            問い合わせが届いて処理が済むと、ここに移ります。
          </p>
        ) : (
          <TicketList list={rest} openId={openId} onOpen={setOpenId} />
        )}
      </Card>

      {/* ── 1件のやり取りと、返信 ── */}
      <Drawer
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open?.subject ?? ""}
        note={open ? `${open.userName} ／ ${open.at}` : undefined}
      >
        {/* ★key を付けること。
              別の件を開いたときに、前の件の返信文が残らないようにします。
              残ると、Aさん宛の文をBさんに送る事故になります。 */}
        {open && (
          <TicketBody key={open.id} t={open} mayReply={mayReply} dispatch={dispatch} />
        )}
      </Drawer>

      <DemoNote>
        このデモは、お客様へのメール送信につながっていません。
        「送る」を押しても、実際には送信されません。画面の中だけで動きます。
      </DemoNote>
    </>
  );
}

/**
 * 一覧。件名だけを並べる。
 *
 * ★本文を一覧に出さないこと。
 *   問い合わせの本文は3行から5行あります。
 *   20件並べると100行になり、目的の1件を探すのに
 *   関係のない本文を19件分読まされます。
 *   一覧は「どれを開くか決めるため」だけにあります。
 */
function TicketList({
  list,
  openId,
  onOpen,
  tone,
}: {
  list: Ticket[];
  openId: string | null;
  onOpen: (id: string) => void;
  tone?: "warn";
}) {
  return (
    <>
      <Table head={["受信", "会員", "件名", "状態"]}>
        {list.map((t) => (
          <Tr key={t.id} onOpen={() => onOpen(t.id)} active={openId === t.id} tone={tone}>
            <Td className="num whitespace-nowrap">{t.at}</Td>
            <Td className="whitespace-nowrap">{t.userName}</Td>
            <Td className="font-medium text-slate">{t.subject}</Td>
            <Td>
              <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
            </Td>
          </Tr>
        ))}
      </Table>

      <Rows>
        {list.map((t) => (
          <RowCard key={t.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-note font-bold text-slate">{t.subject}</span>
              <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
            </div>
            <div className="mt-2 border-t border-edge pt-2">
              <KV k="会員" v={t.userName} />
              <KV k="受信" v={<span className="num">{t.at}</span>} />
            </div>
            <div className="mt-3">
              <Btn onClick={() => onOpen(t.id)}>やり取りを開く</Btn>
            </div>
          </RowCard>
        ))}
      </Rows>
    </>
  );
}

function TicketBody({
  t,
  mayReply,
  dispatch,
}: {
  t: Ticket;
  mayReply: boolean;
  dispatch: React.Dispatch<ConsoleAction>;
}) {
  const [text, setText] = useState(t.aiDraft ?? "");
  const needsHuman = t.status === "HUMAN_REVIEW";

  return (
    <>
      <div>
        <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
      </div>

      <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
        <p className="text-note font-bold text-slate3">お客様からの内容</p>
        <p className="mt-1 text-note leading-[1.9] text-slate2">{t.body}</p>
      </div>

      {/* ★なぜAIが答えなかったのか。ここを省かないこと */}
      {t.escalateReason && (
        <p className="rounded-xl border border-blue-pale bg-blue-pale/50 px-4 py-3 text-note leading-[1.9] text-slate2">
          <span className="mr-2 font-bold text-blue-ink">AIが答えなかった理由</span>
          {t.escalateReason}
        </p>
      )}

      {t.reply && (
        <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
          {/* ★「AIが答えた」のか「人が答えた」のかを、必ず出すこと。
              どれを自分で確認したのか分からなくなると、
              後から全部を読み直すことになります */}
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-note font-bold text-slate3">返信した内容</p>
            <Badge tone={t.replyBy === "HUMAN" ? "ok" : "blue"}>
              {t.replyBy === "HUMAN" ? "人が返信" : "AIが返信"}
            </Badge>
          </div>
          <p className="mt-1 text-note leading-[1.9] text-slate2">{t.reply}</p>
        </div>
      )}

      {needsHuman &&
        (mayReply ? (
          <div className="space-y-3">
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
          <p className="rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.85] text-warn-ink">
            いまの担当には、返信の権限がありません。
            上の「デモ：担当を切り替える」から「サポート 三郎」に変えると返信できます。
          </p>
        ))}
    </>
  );
}
