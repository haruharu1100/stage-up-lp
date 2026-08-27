/**
 * 問い合わせ。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここに出るのは、お客様が本当に出した問い合わせです
 * ═══════════════════════════════════════════════════════
 *
 *   以前ここには、ブラウザの中だけで作った見本が並んでいました。
 *   見本は、返信しても誰にも届きません。
 *   いまは、お客様がマイページから出したものが、そのまま出ます。
 *   お客様の画面と、この画面は、同じ1つの表を読んでいます。
 *
 * ═══════════════════════════════════════════════════════
 * ★AIに答えさせるものと、答えさせないもの
 * ═══════════════════════════════════════════════════════
 *
 *   答えさせてよい … 発送はいつか、ポイントの残りはいくつか、
 *                    といった「調べれば分かること」
 *
 *   答えさせない  … 返金、補償、商品の破損、本物かどうか、
 *                    法的な主張、退会・凍結、個人情報、
 *                    確率への強い苦情、高額の話
 *
 *   ★後者は、下書きすら作りません。
 *     作らなければ、間違って送ることもできません。
 *     「たぶん大丈夫そうだから通す」という道を、作らないためです。
 *
 * ═══════════════════════════════════════════════════════
 * ★AIが答えただけで「解決済み」にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   解決にできるのは、人だけです。
 *   AIが答えた時点の状態は「AIが一次回答済み」までです。
 *   ここを自動で解決にすると、
 *   納得していないお客様の問い合わせが、静かに閉じられます。
 *
 * ★守りを、この画面に置かないこと。
 *   ボタンを隠すのは親切であって、守りではありません。
 *   返信できるか・他社の問い合わせが見えないか・
 *   理由なしで状態を変えられないか──決めているのは全部サーバーです
 *   （lib/server/ticketAdmin.ts）。画面を迂回しても同じです。
 */

"use client";

import { useCallback, useState } from "react";
import {
  EMPTY_TICKET_FILTER,
  runAiReply,
  runAssign,
  runPriority,
  runReply,
  runStatus,
  useTicketDetail,
  useTicketList,
  type Assignee,
  type TicketDetail,
  type TicketFilter,
  type TicketMessage,
  type TicketRow,
} from "@/lib/console/liveTickets";
import {
  Badge,
  Btn,
  Card,
  Drawer,
  Empty,
  ErrorBox,
  Field,
  inputClass,
  KV,
  NotConnected,
  RowCard,
  Rows,
  Skeleton,
  Stat,
  Table,
  Td,
  Tr,
  WhatIsThis,
} from "../ui";

/* ══════════════════════════════════════════════
   出し方だけ（判断はしない）
   ══════════════════════════════════════════════ */

type Tone = "neutral" | "ok" | "warn" | "danger" | "blue";

/**
 * 状態の見た目。
 *
 * ★ここで独自の状態名を増やさないこと（30項目の1番）。
 *   以前ここには AI_ANSWERED / DONE という、
 *   DBにもお客様の画面にも無い名前が書かれていました。
 *   名前を決める場所は lib/server/ticketStatus.ts の1つだけです。
 */
const STATUS_TONE: Record<string, Tone> = {
  NEW: "warn",
  AI_REPLIED: "blue",
  HUMAN_REVIEW: "danger",
  IN_PROGRESS: "warn",
  RESOLVED: "ok",
};

function StatusBadge({ code, label }: { code: string; label: string }) {
  /* ★知らない状態を、それらしい日本語に丸めないこと */
  return <Badge tone={STATUS_TONE[code] ?? "neutral"}>{label}</Badge>;
}

function PriorityBadge({ code, label }: { code: string; label: string }) {
  if (code === "HIGH") return <Badge tone="danger">{label}</Badge>;
  if (code === "LOW") return <Badge tone="neutral">{label}</Badge>;
  return <span className="text-note text-slate3">{label}</span>;
}

/** 日時。★分からないものを、それらしい日付で埋めないこと */
function nichiji(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Toki({ iso, none = "記録なし" }: { iso: string | null; none?: string }) {
  const s = nichiji(iso);
  if (!s) return <span className="text-note text-slate3">{none}</span>;
  return <span className="num whitespace-nowrap">{s}</span>;
}

/** 分類。★分からないものを「その他」で埋めないこと */
function Bunrui({ label }: { label: string | null }) {
  if (!label) {
    return (
      <span className="text-note text-slate3" title="分類がまだ決まっていません">
        未分類
      </span>
    );
  }
  return <span className="text-note text-slate2">{label}</span>;
}

/** 担当者。★空欄にしないこと。「誰も見ていない」は重要な情報です */
function Tantou({ name }: { name: string | null }) {
  if (!name) {
    return <span className="text-note font-bold text-warn-ink">未担当</span>;
  }
  return <span className="text-note text-slate2">{name}</span>;
}

/** 操作の知らせ */
function Msg({
  msg,
  onClose,
}: {
  msg: { ok: boolean; text: string } | null;
  onClose: () => void;
}) {
  if (!msg) return null;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4 text-note leading-[1.9] ${
        msg.ok
          ? "border-ok/30 bg-ok/10 text-ok-ink"
          : "border-danger/30 bg-danger/10 text-danger-ink"
      }`}
    >
      <span className="font-bold">{msg.text}</span>
      <Btn kind="ghost" onClick={onClose}>
        閉じる
      </Btn>
    </div>
  );
}

/* ══════════════════════════════════════════════
   画面
   ══════════════════════════════════════════════ */

export default function SupportScreen({
  query,
}: {
  /**
   * ダッシュボードの「今日やること」から飛んできたときの条件（30項目の25番）。
   *
   * ★件数を押したのに、全件の一覧が出る、をやらないこと。
   *   「人の確認が必要 3件」を押した人が見たいのは、その3件です。
   */
  query?: Record<string, string>;
}) {
  const [filter, setFilter] = useState<TicketFilter>(() => ({
    ...EMPTY_TICKET_FILTER,
    status: query?.status ?? "",
    onlyHigh: query?.high === "1",
    onlyUnassigned: query?.unassigned === "1",
    onlyOpen: query?.open === "1",
  }));
  const [qDraft, setQDraft] = useState("");
  const { state, reload } = useTicketList(filter);

  /**
   * いま開いている1件。
   *
   * ★件そのものではなく、番号だけを持つこと。
   *   返信した瞬間に状態も担当者も変わります。
   *   件を写して持つと、板の中だけ古いまま残り、
   *   押したのに何も起きていないように見えます。
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useTicketDetail(openId);

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const after = useCallback(
    (r: { ok: boolean; message: string }) => {
      setMsg({ ok: r.ok, text: r.message });
      /* ★成功したときだけ読み直す、にしないこと。
           断られた理由が「すでにAIが答えています」のこともあります。
           そのときは画面のほうが古いので、読み直すのが正解です */
      reload();
      detail.reload();
    },
    [reload, detail],
  );

  const data = state.phase === "ok" ? state.data : null;
  const rows = data?.tickets ?? [];
  const shibori =
    filter.q !== "" ||
    filter.status !== "" ||
    filter.onlyHigh ||
    filter.onlyUnassigned ||
    filter.onlyOpen ||
    filter.assigneeId !== "";

  return (
    <>
      <WhatIsThis>
        お客様がマイページから出した問い合わせです。調べれば分かるものは、AIが下書きを作ります。
        <strong className="font-bold text-slate">
          返金・破損・法的な話には、AIは下書きすら作りません
        </strong>
        。人の確認へ回します。送るかどうかを決めるのは、いつも人です。
      </WhatIsThis>

      <Msg msg={msg} onClose={() => setMsg(null)} />

      {/* ── さがす（30項目の3・4番） ──

          ★画面に届いた配列を絞らないこと。
            件数が増えた日に、上限で切られた中だけを絞ることになります。
            出てこない問い合わせがあっても、画面には何も出ません。 */}
      <Card title="さがす" note="条件はサーバー側で絞り込みます。">
        <div className="grid gap-3 md:grid-cols-[1fr_11rem_11rem_auto]">
          <Field label="問い合わせ番号・会員番号・お名前・メール・件名">
            <input
              className={inputClass}
              value={qDraft}
              placeholder="一部でさがせます"
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setFilter((f) => ({ ...f, q: qDraft }));
              }}
            />
          </Field>
          <Field label="状態">
            <select
              className={inputClass}
              value={filter.status}
              onChange={(e) =>
                setFilter((f) => ({ ...f, status: e.target.value }))
              }
            >
              <option value="">すべて</option>
              <option value="NEW">未対応</option>
              <option value="AI_REPLIED">AIが一次回答済み</option>
              <option value="HUMAN_REVIEW">人の確認が必要</option>
              <option value="IN_PROGRESS">対応中</option>
              <option value="RESOLVED">解決済み</option>
            </select>
          </Field>
          <Field label="担当者">
            <select
              className={inputClass}
              value={filter.assigneeId}
              onChange={(e) =>
                setFilter((f) => ({ ...f, assigneeId: e.target.value }))
              }
            >
              <option value="">すべて</option>
              {(data?.assignees ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <Btn
              kind="primary"
              onClick={() => setFilter((f) => ({ ...f, q: qDraft }))}
            >
              さがす
            </Btn>
            <Btn
              kind="ghost"
              onClick={() => {
                setQDraft("");
                setFilter(EMPTY_TICKET_FILTER);
              }}
            >
              条件を消す
            </Btn>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-note text-slate2">
            <input
              type="checkbox"
              checked={filter.onlyHigh}
              onChange={(e) =>
                setFilter((f) => ({ ...f, onlyHigh: e.target.checked }))
              }
            />
            高優先度だけ
          </label>
          <label className="flex items-center gap-2 text-note text-slate2">
            <input
              type="checkbox"
              checked={filter.onlyUnassigned}
              onChange={(e) =>
                setFilter((f) => ({ ...f, onlyUnassigned: e.target.checked }))
              }
            />
            未担当だけ
          </label>
          <label className="flex items-center gap-2 text-note text-slate2">
            <input
              type="checkbox"
              checked={filter.onlyOpen}
              onChange={(e) =>
                setFilter((f) => ({ ...f, onlyOpen: e.target.checked }))
              }
            />
            まだ終わっていないものだけ
          </label>
        </div>
      </Card>

      {/* ── 読めていないとき ──

          ★取れなかったことを「0件」と書かないこと。
            0件は「対応が必要な問い合わせは無い」という意味です */}
      {state.phase === "loading" && (
        <Card title="問い合わせ一覧">
          <Skeleton rows={5} label="問い合わせを読み込んでいます" />
        </Card>
      )}

      {state.phase === "ng" && (
        <ErrorBox what={state.why} code={state.code} onRetry={reload} />
      )}

      {data && (
        <>
          {/* ── 会社ぜんぶの内訳 ──

              ★ここは絞り込みと関係なく、会社ぜんぶで数えています。
                絞ったあとの数を「件数」として出すと、
                検索するたびに件数が減る画面になります。 */}
          <Card
            title="いまの状況"
            note="絞り込みとは関係なく、届いている問い合わせぜんぶを数えています。ダッシュボードと同じ数え方です。"
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat
                label="人の確認が必要"
                value={data.counts.humanReview}
                unit="件"
                tone={data.counts.humanReview > 0 ? "danger" : "ok"}
                sub="AIが答えなかったものです"
              />
              <Stat
                label="未対応"
                value={data.counts.new}
                unit="件"
                tone={data.counts.new > 0 ? "warn" : "ok"}
                sub="まだ誰も何もしていません"
              />
              <Stat
                label="高優先度"
                value={data.counts.high}
                unit="件"
                tone={data.counts.high > 0 ? "danger" : "normal"}
              />
              <Stat
                label="未担当"
                value={data.counts.unassigned}
                unit="件"
                tone={data.counts.unassigned > 0 ? "warn" : "normal"}
              />
              <Stat
                label="解決済み"
                value={data.counts.resolved}
                unit="件"
                tone="ok"
              />
            </div>
          </Card>

          {/* ── 一覧（30項目の2番） ── */}
          <Card
            title="問い合わせ一覧"
            note={
              `${data.total}件` +
              (shibori ? `（絞り込み中／全体は${data.counts.all}件）` : "") +
              " ／ 行を押すと、やり取りと操作を開きます。"
            }
          >
            {rows.length === 0 ? (
              <Empty
                why={
                  shibori
                    ? "この条件に当てはまる問い合わせはありませんでした。"
                    : "現在、対応が必要な問い合わせはありません。"
                }
                next={
                  shibori
                    ? "上の「条件を消す」を押すと、すべての問い合わせが出ます。"
                    : "お客様がマイページから問い合わせを出すと、ここに出ます。"
                }
              />
            ) : (
              <TicketList
                list={rows}
                openId={openId}
                onOpen={setOpenId}
              />
            )}
          </Card>
        </>
      )}

      {/* ── 1件のやり取りと、操作 ── */}
      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={
          detail.state.phase === "ok" ? detail.state.ticket.subject : "問い合わせ"
        }
        note={
          detail.state.phase === "ok"
            ? `${detail.state.ticket.displayId} ${detail.state.ticket.userName}`
            : undefined
        }
      >
        {detail.state.phase === "loading" && (
          <Skeleton rows={4} label="やり取りを読み込んでいます" />
        )}

        {detail.state.phase === "ng" && (
          <ErrorBox
            what={detail.state.why}
            code={detail.state.code}
            onRetry={detail.reload}
          />
        )}

        {/* ★key を付けること。
              別の件を開いたときに、前の件の返信文が残らないようにします。
              残ると、Aさん宛の文をBさんに送る事故になります */}
        {detail.state.phase === "ok" && (
          <TicketBody
            key={detail.state.ticket.id}
            t={detail.state.ticket}
            canReply={detail.state.canReply}
            assignees={data?.assignees ?? []}
            busy={busy}
            setBusy={setBusy}
            after={after}
          />
        )}
      </Drawer>

      <NotConnected what="お客様へのメール送信">
        返信の内容は、お客様のマイページには、その場で出ます。
        メールは、まだ送信会社につないでいないため、届きません。
        送るつもりだった記録だけが残ります。
      </NotConnected>
    </>
  );
}

/* ══════════════════════════════════════════════
   一覧
   ══════════════════════════════════════════════ */

/**
 * 一覧。
 *
 * ★本文を一覧に出さないこと。
 *   問い合わせの本文は3行から5行あります。
 *   20件並べると100行になり、目的の1件を探すのに
 *   関係のない本文を19件分読まされます。
 *
 * ★住所を一覧に出さないこと（30項目の14番）。
 *   一覧は肩越しに見られます。メールも伏せ字にしてあります。
 */
function TicketList({
  list,
  openId,
  onOpen,
}: {
  list: TicketRow[];
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <Table
        head={[
          "受信",
          "問い合わせ番号",
          "お客様",
          "件名",
          "分類",
          "状態",
          "優先度",
          "AI一次回答",
          "人の確認",
          "担当者",
          "最終更新",
        ]}
      >
        {list.map((t) => (
          <Tr
            key={t.id}
            onOpen={() => onOpen(t.id)}
            active={openId === t.id}
            tone={t.needsHuman ? "warn" : undefined}
          >
            <Td className="num whitespace-nowrap">
              <Toki iso={t.createdAt} />
            </Td>
            <Td className="num whitespace-nowrap text-slate3">{t.id}</Td>
            <Td className="whitespace-nowrap">
              <span className="num mr-2 text-slate3">{t.displayId}</span>
              {t.userName}
            </Td>
            <Td className="font-medium text-slate">{t.subject}</Td>
            <Td>
              <Bunrui label={t.categoryLabel} />
            </Td>
            <Td>
              <StatusBadge code={t.status} label={t.statusLabel} />
            </Td>
            <Td>
              <PriorityBadge code={t.priority} label={t.priorityLabel} />
            </Td>
            <Td>
              {t.aiReplied ? (
                <Badge tone="blue">済み</Badge>
              ) : (
                <span className="text-note text-slate3">まだ</span>
              )}
            </Td>
            <Td>
              {t.needsHuman ? (
                <Badge tone="danger">必要</Badge>
              ) : (
                <span className="text-note text-slate3">不要</span>
              )}
            </Td>
            <Td className="whitespace-nowrap">
              <Tantou name={t.assigneeName} />
            </Td>
            <Td className="num whitespace-nowrap">
              <Toki iso={t.updatedAt} />
            </Td>
          </Tr>
        ))}
      </Table>

      <Rows>
        {list.map((t) => (
          <RowCard key={t.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-note font-bold text-slate">{t.subject}</span>
              <StatusBadge code={t.status} label={t.statusLabel} />
            </div>
            <div className="mt-2 border-t border-edge pt-2">
              <KV k="問い合わせ番号" v={<span className="num">{t.id}</span>} />
              <KV k="お客様" v={`${t.displayId} ${t.userName}`} />
              <KV k="分類" v={<Bunrui label={t.categoryLabel} />} />
              <KV
                k="優先度"
                v={<PriorityBadge code={t.priority} label={t.priorityLabel} />}
              />
              <KV k="AI一次回答" v={t.aiReplied ? "済み" : "まだ"} />
              <KV k="人の確認" v={t.needsHuman ? "必要" : "不要"} />
              <KV k="担当者" v={<Tantou name={t.assigneeName} />} />
              <KV k="受信" v={<Toki iso={t.createdAt} />} />
              <KV k="最終更新" v={<Toki iso={t.updatedAt} />} />
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

/* ══════════════════════════════════════════════
   1件の中身
   ══════════════════════════════════════════════ */

/** やり取りの1行（30項目の5番） */
function Message({ m }: { m: TicketMessage }) {
  const kokyaku = m.authorKind === "CUSTOMER";
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        kokyaku
          ? "border-edge bg-paper2"
          : "border-blue-pale bg-blue-pale/30"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* ★「AIが書いた」と「人が書いた」を、必ず分けて出すこと。
              どれを自分で確認したのか分からなくなると、
              後から全部を読み直すことになります */}
        <Badge tone={kokyaku ? "neutral" : m.authorKind === "AI" ? "blue" : "ok"}>
          {m.authorLabel}
        </Badge>
        <span className="text-note text-slate3">{m.authorName}</span>
        <span className="num ml-auto text-note text-slate3">
          {nichiji(m.createdAt)}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-note leading-[1.9] text-slate2">
        {m.body}
      </p>

      {/* ★送ったあとに直したことを、隠さないこと（30項目の9番） */}
      {m.edited && (
        <p className="mt-2 rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-note leading-[1.85] text-warn-ink">
          この返信は、送ったあとに直されています（
          {nichiji(m.editedAt)} ／ {m.editedBy ?? "記録なし"}）。
        </p>
      )}

      {/* ★AIが何を見て書いたかを残すこと（30項目の8番）。
            お客様には見せません。社内で確かめるためのものです */}
      {m.sources && m.sources.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-note text-slate3">
            AIが見たもの（社内用・{m.sources.length}件）
          </summary>
          <ul className="mt-1 space-y-1">
            {m.sources.map((s) => (
              <li key={s} className="num text-note text-slate3">
                {s}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TicketBody({
  t,
  canReply,
  assignees,
  busy,
  setBusy,
  after,
}: {
  t: TicketDetail;
  canReply: boolean;
  assignees: Assignee[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  after: (r: { ok: boolean; message: string }) => void;
}) {
  const [text, setText] = useState(t.aiDraft ?? "");
  const [reason, setReason] = useState("");
  const owari = t.status === "RESOLVED";

  const go = useCallback(
    async (fn: () => Promise<{ ok: boolean; message: string }>) => {
      setBusy(true);
      const r = await fn();
      setBusy(false);
      after(r);
    },
    [setBusy, after],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge code={t.status} label={t.statusLabel} />
        <PriorityBadge code={t.priority} label={t.priorityLabel} />
        <Bunrui label={t.categoryLabel} />
      </div>

      <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
        <KV k="問い合わせ番号" v={<span className="num">{t.id}</span>} />
        <KV k="お客様" v={`${t.displayId} ${t.userName}`} />
        {/* ★完全なメールは、開いた1件だけ。一覧には出しません */}
        <KV
          k="メール"
          v={
            t.email ?? (
              <span className="text-note text-slate3">登録がありません</span>
            )
          }
        />
        <KV k="担当者" v={<Tantou name={t.assigneeName} />} />
        <KV k="受信" v={<Toki iso={t.createdAt} />} />
        <KV k="最終更新" v={<Toki iso={t.updatedAt} />} />
      </div>

      {/* ★なぜAIが答えなかったのか。ここを省かないこと（30項目の7番） */}
      {t.escalateReason && (
        <p className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-note leading-[1.9] text-danger-ink">
          <strong className="mr-2 font-bold">AIには書かせませんでした</strong>
          {t.escalateReason}
          <br />
          この種類の問い合わせは、下書きも作りません。人がご自身の言葉で書いてください。
        </p>
      )}

      {/* ── やり取り（時系列） ── */}
      <div>
        <h3 className="text-note font-bold text-slate2">
          やり取り
          <span className="num ml-2 font-medium text-slate3">
            （{t.messages.length}件）
          </span>
        </h3>
        <div className="mt-2 space-y-3">
          {t.messages.length === 0 ? (
            <Empty why="やり取りの記録がありません。" />
          ) : (
            t.messages.map((m) => <Message key={m.id} m={m} />)
          )}
        </div>
      </div>

      {/* ── AIの一次回答（送信ではない） ── */}
      {canReply && !t.aiReplied && !owari && (
        <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
          <p className="text-note leading-[1.9] text-slate2">
            AIに下書きを作らせます。
            <strong className="font-bold text-slate">送信はしません。</strong>
            返金や破損など、人が判断すべき内容だった場合は、下書きを作らずに
            「人の確認が必要」へ回します。
          </p>
          <div className="mt-3">
            <Btn
              disabled={busy}
              onClick={() => go(() => runAiReply(t.id))}
            >
              AIに下書きを作らせる
            </Btn>
          </div>
        </div>
      )}

      {/* ── 人の返信（30項目の9番） ── */}
      {canReply ? (
        owari ? (
          <p className="rounded-xl border border-edge bg-paper2 px-4 py-3 text-note leading-[1.9] text-slate3">
            この問い合わせは解決済みです。続きがある場合は、状態を「対応中」に戻してから返信してください。
          </p>
        ) : (
          <div className="space-y-3">
            <Field
              label="返信する内容"
              note="送信すると、お客様のマイページにその場で出ます。取り消せません。"
            >
              <textarea
                className={`${inputClass} min-h-[8rem]`}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Btn
                kind="primary"
                disabled={busy || !text.trim()}
                onClick={() =>
                  go(() => runReply({ ticketId: t.id, text, resolve: false }))
                }
              >
                この内容で返信する
              </Btn>
              <Btn
                disabled={busy || !text.trim()}
                onClick={() =>
                  go(() => runReply({ ticketId: t.id, text, resolve: true }))
                }
              >
                返信して解決済みにする
              </Btn>
              {t.aiDraft && (
                <Btn kind="ghost" onClick={() => setText(t.aiDraft ?? "")}>
                  AIの下書きに戻す
                </Btn>
              )}
            </div>
            <p className="text-note leading-[1.85] text-slate3">
              ★送るかどうかは、必ず人が決めます。AIが勝手に送ることはありません。
              AIが答えただけでは、解決済みにもなりません。
            </p>
          </div>
        )
      ) : (
        <p className="rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.85] text-warn-ink">
          いまの担当には、問い合わせに返信する権限がありません。
          読むことはできますが、送ることはできません。
        </p>
      )}

      {/* ── 担当者・状態・優先度 ── */}
      {canReply && (
        <div className="space-y-3 rounded-xl border border-edge bg-paper2 px-4 py-3">
          <Field
            label="担当者を決める"
            note="返信できる担当者だけが出ます。割り当てても、その人へメールは飛びません。"
          >
            <select
              className={inputClass}
              value={t.assigneeId ?? ""}
              disabled={busy}
              onChange={(e) =>
                go(() =>
                  runAssign({
                    ticketId: t.id,
                    assigneeId: e.target.value === "" ? null : e.target.value,
                  }),
                )
              }
            >
              <option value="">未担当</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          {/* ★理由なしで状態を変えられないこと（30項目の10番）。
                「なぜ解決にしたのか」が残らないと、
                苦情が再燃したときに、誰も説明できません */}
          <Field
            label="状態・優先度を変える理由"
            note="4文字以上。理由は監査ログに残ります。"
          >
            <input
              className={inputClass}
              value={reason}
              placeholder="例：お客様から解決した旨のご連絡がありました"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            {t.status !== "IN_PROGRESS" && (
              <Btn
                disabled={busy || reason.trim().length < 4}
                onClick={() =>
                  go(() =>
                    runStatus({ ticketId: t.id, to: "IN_PROGRESS", reason }),
                  )
                }
              >
                対応中にする
              </Btn>
            )}
            {t.status !== "HUMAN_REVIEW" && (
              <Btn
                disabled={busy || reason.trim().length < 4}
                onClick={() =>
                  go(() =>
                    runStatus({ ticketId: t.id, to: "HUMAN_REVIEW", reason }),
                  )
                }
              >
                人の確認へ回す
              </Btn>
            )}
            {t.status !== "RESOLVED" && (
              <Btn
                disabled={busy || reason.trim().length < 4}
                onClick={() =>
                  go(() => runStatus({ ticketId: t.id, to: "RESOLVED", reason }))
                }
              >
                解決済みにする
              </Btn>
            )}
            {t.priority !== "HIGH" && (
              <Btn
                disabled={busy || reason.trim().length < 4}
                onClick={() =>
                  go(() => runPriority({ ticketId: t.id, to: "HIGH", reason }))
                }
              >
                高優先度にする
              </Btn>
            )}
            {t.priority !== "NORMAL" && (
              <Btn
                disabled={busy || reason.trim().length < 4}
                onClick={() =>
                  go(() => runPriority({ ticketId: t.id, to: "NORMAL", reason }))
                }
              >
                優先度をふつうに戻す
              </Btn>
            )}
          </div>
        </div>
      )}
    </>
  );
}
