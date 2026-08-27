/**
 * ポイント管理。
 *
 * ═══════════════════════════════════════════════════════
 * ★ポイントは、お金そのものです
 * ═══════════════════════════════════════════════════════
 *
 *   お客様が現金で買ったものが、ポイントとして残っています。
 *   管理画面から自由に増やせる状態は、
 *   レジからいつでも現金を出せる状態と同じです。
 *
 *   だから、3つの縛りをサーバー側に入れてあります。
 *
 *     ① 理由を書かないと実行できない
 *     ② 誰が・誰に・何ポイント・なぜ・いくらからいくらへ を必ず記録する
 *     ③ 大きな金額は、別の管理者が承認しないと1ptも動かない
 *
 *   ③が「二人承認（FOUR EYES）」です。
 *   ★自分が出した申請を、自分で承認できないこと。
 *     ここを緩めると、二人承認は形だけになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★正本は台帳（point_ledger）です。残高はその写しです
 * ═══════════════════════════════════════════════════════
 *
 *   customers.points は、台帳から作られた「いまの残高」です。
 *   便利なので画面でも使いますが、正しさの根拠ではありません。
 *
 *   この2つが食い違ったとき、写し（残高）だけを見せて
 *   「合っています」と言ってしまうのが、いちばん危ない間違いです。
 *   だから、この画面は必ず両方を並べます。
 *
 *       残高 5,000pt ／ 台帳の合計 4,800pt ／ 差 +200pt
 *
 *   差が出ているということは、台帳に残っていないポイントが
 *   動いたということです。原因が分かるまで触らないでください。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面で数えないこと
 * ═══════════════════════════════════════════════════════
 *
 *   残高も、台帳の合計も、Before・After も、食い違いの数も、
 *   ぜんぶサーバー（lib/server/pointAdmin.ts）が作ります。
 *   ここで足し算を書くと、同じ数字を出す場所が2つになります。
 *   2つあるものは、いつか必ずずれます。
 *
 * ═══════════════════════════════════════════════════════
 * ★見せられない人に「0pt」と出さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   0pt は「1ptも持っていない」という意味です。
 *   権限が無いことを 0pt と書くと、その人は
 *   「この会員は空だ」と思って画面を閉じます。
 *   見せられないときは、そう書きます。
 *
 * ★守りを、この画面に置かないこと。
 *   ボタンを隠すのは親切のためであって、守りではありません。
 *   申請できるか・承認できるか・自分の申請を自分で通せないか、
 *   10万pt を超えたら2人必要か──決めているのは全部サーバーです
 *   （lib/server/points.ts）。画面を迂回して直接叩いても同じです。
 */

"use client";

import { useCallback, useState } from "react";
import {
  EMPTY_POINT_FILTER,
  newIdempotencyKey,
  runPointDecide,
  runPointRequest,
  useAdjustments,
  usePointDetail,
  usePointList,
  type LedgerLine,
  type PointAdjustment,
  type PointDetail,
  type PointFilter,
  type PointIntegrity,
  type PointRow,
} from "@/lib/console/livePoints";
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
 * 整合性の印。
 *
 * ★3つを、はっきり分けること。
 *     緑（合っています）   … 台帳の合計と残高が同じ
 *     赤（合っていません） … 違う。記録に無い動きがあった
 *     灰（確認できません） … 権限が無くて照合そのものができない
 *
 *   ★灰を緑に丸めないこと。
 *     「確認していない」を「確認して大丈夫だった」に化けさせます。
 */
const INTEGRITY: Record<PointIntegrity, { label: string; tone: Tone; sub: string }> = {
  OK: {
    label: "合っています",
    tone: "ok",
    sub: "台帳の合計と、いまの残高が同じです。",
  },
  MISMATCH: {
    label: "合っていません",
    tone: "danger",
    sub: "台帳に残っていないポイントが動いています。原因が分かるまで触らないでください。",
  },
  UNKNOWN: {
    label: "確認できません",
    tone: "neutral",
    sub: "残高を見る権限がないため、照合そのものができていません。合っているという意味ではありません。",
  },
};

function IntegrityMark({ v }: { v: PointIntegrity }) {
  return <Badge tone={INTEGRITY[v].tone}>{INTEGRITY[v].label}</Badge>;
}

/**
 * ポイント数。
 * ★null は 0pt ではありません。「見せられません」です。
 */
function Pt({ v }: { v: number | null }) {
  if (v === null) {
    return (
      <span
        className="text-note text-slate3"
        title="ポイントを見る権限がありません。0ptという意味ではありません。"
      >
        見せられません
      </span>
    );
  }
  return <span className="num whitespace-nowrap">{v.toLocaleString()}pt</span>;
}

/** 増減。★0 を空白にしないこと。「今日は動いていない」も情報です */
function Delta({ v }: { v: number | null }) {
  if (v === null) return <Pt v={null} />;
  if (v === 0) return <span className="text-note text-slate3">動いていません</span>;
  return (
    <span
      className={`num whitespace-nowrap font-bold ${
        v > 0 ? "text-ok-ink" : "text-danger-ink"
      }`}
    >
      {v > 0 ? "+" : ""}
      {v.toLocaleString()}pt
    </span>
  );
}

/** 差。★0 のときは呼ばれません（整合性が OK になります） */
function Sa({ v }: { v: number | null }) {
  if (v === null) return <Pt v={null} />;
  return (
    <span className="num whitespace-nowrap">
      {v > 0 ? "+" : ""}
      {v.toLocaleString()}pt
    </span>
  );
}

const ADJ_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "承認待ち", tone: "warn" },
  APPLIED: { label: "反映済み", tone: "ok" },
  APPROVED: { label: "承認して反映済み", tone: "ok" },
  REJECTED: { label: "却下", tone: "neutral" },
};

function AdjStatusBadge({ v }: { v: string }) {
  const s = ADJ_STATUS[v];
  /* ★知らない状態を、それらしい日本語へ丸めないこと */
  if (!s) return <Badge tone="neutral">{v}</Badge>;
  return <Badge tone={s.tone}>{s.label}</Badge>;
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

/** 見出し付きのまとまり。★件数を必ず添えること */
function Block({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count?: number;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-note font-bold text-slate2">
        {title}
        {count !== undefined && (
          <span className="num ml-2 font-medium text-slate3">（{count}件）</span>
        )}
      </h3>
      {note && <p className="mt-1 text-note leading-[1.85] text-slate3">{note}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
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
   本体
   ══════════════════════════════════════════════ */

export default function PointScreen() {
  const [tab, setTab] = useState<"list" | "approve">("list");

  return (
    <>
      <WhatIsThis>
        会員のポイントを、
        <strong className="font-bold text-slate">台帳（1件ずつの増減の記録）</strong>
        から確かめます。画面に出ている残高は台帳の写しなので、
        両方を並べて「合っているか」を毎回確認できるようにしています。
        合っていない会員がいる場合は、原因が分かるまでポイントを触らないでください。
      </WhatIsThis>

      {/* ── 切り替え ── */}
      <div className="flex flex-wrap gap-2">
        <Btn kind={tab === "list" ? "primary" : "ghost"} onClick={() => setTab("list")}>
          会員ごとのポイント
        </Btn>
        <Btn
          kind={tab === "approve" ? "primary" : "ghost"}
          onClick={() => setTab("approve")}
        >
          ポイント調整の承認
        </Btn>
      </div>

      {tab === "list" ? <PointList /> : <ApprovalList />}
    </>
  );
}

/* ══════════════════════════════════════════════
   会員ごとのポイント（一覧＋板）
   ══════════════════════════════════════════════ */

function PointList() {
  const [filter, setFilter] = useState<PointFilter>(EMPTY_POINT_FILTER);
  /* 1文字ごとに通信しないよう、押したときだけ反映します */
  const [qDraft, setQDraft] = useState("");

  const { state, reload } = usePointList(filter);

  /* ★会員を写して持たないこと。
       調整を1件通した瞬間に、残高も台帳も整合性も変わります。
       番号だけ持って、毎回サーバーから引き直します */
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = usePointDetail(openId);

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const afterChange = useCallback(
    (ok: boolean, text: string) => {
      setMsg({ ok, text });
      /* ★成功したときだけ読み直す、にしないこと。
           断られた理由が「すでに承認済み」のこともあります。
           そのときは画面のほうが古いので、読み直すのが正解です */
      reload();
      detail.reload();
    },
    [reload, detail],
  );

  const data = state.phase === "ok" ? state.data : null;
  const rows = data?.customers ?? [];
  const shibori =
    filter.q !== "" ||
    filter.onlyHasBalance ||
    filter.onlyMovedToday ||
    filter.onlyMismatch ||
    filter.onlyAdjusted ||
    filter.onlyPending;

  return (
    <>
      <Msg msg={msg} onClose={() => setMsg(null)} />

      {/* ── 絞り込み ──

          ★画面に届いた配列を絞らないこと。
            件数が増えた日に、上限で切られた中だけを絞ることになります。
            出てこない会員がいても、画面には何も出ません。 */}
      <Card title="さがす" note="条件はサーバー側で絞り込みます。">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Field label="会員番号・お名前・メール">
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
          <div className="flex items-end gap-2">
            <Btn kind="primary" onClick={() => setFilter((f) => ({ ...f, q: qDraft }))}>
              さがす
            </Btn>
            <Btn
              kind="ghost"
              onClick={() => {
                setQDraft("");
                setFilter(EMPTY_POINT_FILTER);
              }}
            >
              条件を消す
            </Btn>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Check
            on={filter.onlyHasBalance}
            set={(v) => setFilter((f) => ({ ...f, onlyHasBalance: v }))}
          >
            残高がある人だけ
          </Check>
          <Check
            on={filter.onlyMovedToday}
            set={(v) => setFilter((f) => ({ ...f, onlyMovedToday: v }))}
          >
            今日ポイントが動いた人だけ
          </Check>
          <Check
            on={filter.onlyMismatch}
            set={(v) => setFilter((f) => ({ ...f, onlyMismatch: v }))}
          >
            台帳と残高が合っていない人だけ
          </Check>
          <Check
            on={filter.onlyAdjusted}
            set={(v) => setFilter((f) => ({ ...f, onlyAdjusted: v }))}
          >
            運営が調整したことがある人だけ
          </Check>
          <Check
            on={filter.onlyPending}
            set={(v) => setFilter((f) => ({ ...f, onlyPending: v }))}
          >
            承認待ちの調整がある人だけ
          </Check>
        </div>
      </Card>

      {state.phase === "loading" && (
        <Card title="ポイント一覧">
          <Skeleton rows={5} label="ポイントを読み込んでいます" />
        </Card>
      )}

      {state.phase === "ng" && (
        <ErrorBox what={state.why} code={state.code} onRetry={reload} />
      )}

      {data && (
        <>
          {/* ── 会社ぜんぶの内訳 ──

              ★ここは絞り込みと関係なく、会社ぜんぶで数えています。
                絞ったあとの数を出すと、検索するたびに
                「合っていない人」が減る画面になります。 */}
          <Card
            title="ポイントの状況"
            note="絞り込みとは関係なく、登録されている会員ぜんぶを数えています。"
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="会員数（全体）" value={data.counts.all} unit="名" />
              <Stat
                label="残高がある"
                value={data.counts.hasBalance}
                unit="名"
                sub="1pt以上お持ちの方"
              />
              <Stat
                label="今日ポイントが動いた"
                value={data.counts.movedToday}
                unit="名"
              />
              <Stat
                label="台帳と合っていない"
                value={data.counts.mismatch}
                unit="名"
                tone={data.counts.mismatch > 0 ? "danger" : "ok"}
                sub="残高と台帳の合計が違う方"
              />
            </div>

            {/* ★合計を「0pt」と書かないこと。見せられないなら、そう書きます */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
                <KV k="いまの残高の合計" v={<Pt v={data.counts.totalPoints} />} />
                <KV k="台帳の合計" v={<Pt v={data.counts.totalLedger} />} />
              </div>
              <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
                <KV
                  k="承認待ちの調整"
                  v={<span className="num">{data.pendingCount.toLocaleString()}件</span>}
                />
                <KV
                  k="2人の承認が必要になる額"
                  v={
                    <span className="num">
                      {data.fourEyesThreshold.toLocaleString()}pt 以上
                    </span>
                  }
                />
              </div>
            </div>

            {data.counts.mismatch > 0 ? (
              <p className="mt-4 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-note leading-[1.9] text-danger-ink">
                <strong className="font-bold">
                  台帳の合計と、いまの残高が合っていない会員がいます。
                </strong>
                合わないということは、台帳に残っていないポイントが動いたということです。
                その残高のままガチャが回ると、どこまでが正しかったのかを、あとから決められなくなります。
                上の「台帳と残高が合っていない人だけ」で絞り込んで、先に原因を確かめてください。
              </p>
            ) : (
              <p className="mt-4 rounded-xl border border-ok/30 bg-ok/8 px-4 py-3 text-note leading-[1.9] text-ok-ink">
                いま、台帳の合計と残高が食い違っている会員は
                <strong className="font-bold">1人もいません</strong>
                。これは「調べていない」ではなく、会員を1人ずつ照合したうえでの結果です。
              </p>
            )}
          </Card>

          {/* ── 一覧 ── */}
          <Card
            title="ポイント一覧"
            note={
              `${data.total}件` +
              (shibori ? `（絞り込み中／全体は${data.counts.all}名）` : "") +
              " ／ 行を押すと、台帳と操作を開きます。"
            }
          >
            {rows.length === 0 ? (
              <Empty
                why={
                  shibori
                    ? "この条件に当てはまる会員はいませんでした。"
                    : "まだ会員が1人も登録されていません。"
                }
                next={
                  shibori
                    ? "上の「条件を消す」を押すと、すべての会員が出ます。"
                    : "お客様がご登録されると、ここに並びます。"
                }
              />
            ) : (
              <>
                <Table
                  head={[
                    "会員",
                    "いまの残高",
                    "台帳の合計",
                    "今日の増減",
                    "最終更新",
                    "整合性",
                  ]}
                >
                  {rows.map((c) => (
                    <ListRow
                      key={c.userId}
                      c={c}
                      active={openId === c.userId}
                      onOpen={() => setOpenId(c.userId)}
                    />
                  ))}
                </Table>

                <Rows>
                  {rows.map((c) => (
                    <RowCard key={c.userId}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-note font-bold text-slate">{c.name}</span>
                        <IntegrityMark v={c.integrity} />
                      </div>
                      <p className="num mt-0.5 text-note text-slate3">
                        {c.displayId}
                        {c.emailMasked ? ` ／ ${c.emailMasked}` : ""}
                      </p>
                      <div className="mt-2 border-t border-edge pt-2">
                        <KV k="いまの残高" v={<Pt v={c.points} />} />
                        <KV k="台帳の合計" v={<Pt v={c.ledgerSum} />} />
                        <KV k="今日の増減" v={<Delta v={c.todayDelta} />} />
                        <KV k="最終更新" v={<Toki iso={c.lastAt} none="動きなし" />} />
                      </div>
                      {c.integrity === "MISMATCH" && (
                        <p className="mt-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-note leading-[1.85] text-danger-ink">
                          残高が台帳より <Sa v={c.diff} /> ずれています。
                        </p>
                      )}
                      <div className="mt-3">
                        <Btn onClick={() => setOpenId(c.userId)}>台帳と操作を開く</Btn>
                      </div>
                    </RowCard>
                  ))}
                </Rows>
              </>
            )}

            {!data.canSeePoints && (
              <p className="mt-4 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.9] text-warn-ink">
                <strong className="font-bold">
                  いまの担当には、ポイントの数字を見る権限がありません。
                </strong>
                残高が「見せられません」になっているのは、0ptという意味ではありません。
                整合性も「確認できません」のままです。
              </p>
            )}

            {!data.canRequest && (
              <p className="mt-2 text-note leading-[1.9] text-slate3">
                ★いまの担当には、ポイント調整を申請する権限がありません。台帳は見られます。
              </p>
            )}
          </Card>
        </>
      )}

      {/* ── 1人ぶんの台帳と操作 ── */}
      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={detail.state.phase === "ok" ? detail.state.customer.name : "ポイント"}
        note={
          detail.state.phase === "ok"
            ? `${detail.state.customer.displayId} ／ 台帳${detail.state.customer.ledgerRows.toLocaleString()}件`
            : undefined
        }
        foot={
          detail.state.phase === "ok" && detail.state.canRequest ? (
            <RequestForm
              c={detail.state.customer}
              threshold={detail.state.fourEyesThreshold}
              onDone={afterChange}
            />
          ) : undefined
        }
      >
        {detail.state.phase === "loading" && (
          <Skeleton rows={4} label="台帳を読み込んでいます" />
        )}
        {detail.state.phase === "ng" && (
          <ErrorBox
            what={detail.state.why}
            code={detail.state.code}
            onRetry={detail.reload}
          />
        )}
        {detail.state.phase === "ok" && (
          <DetailBody c={detail.state.customer} canRequest={detail.state.canRequest} />
        )}
      </Drawer>
    </>
  );
}

function Check({
  on,
  set,
  children,
}: {
  on: boolean;
  set: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-note text-slate2">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      {children}
    </label>
  );
}

function ListRow({
  c,
  active,
  onOpen,
}: {
  c: PointRow;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <Tr
      onOpen={onOpen}
      active={active}
      tone={
        c.integrity === "MISMATCH" ? "danger" : c.pendingCount > 0 ? "warn" : undefined
      }
    >
      <Td>
        <span className="font-bold text-slate">{c.name}</span>
        <br />
        <span className="num text-slate3">{c.displayId}</span>
        {c.emailMasked && <span className="ml-2 text-slate3">{c.emailMasked}</span>}
        {c.pendingCount > 0 && (
          <span className="ml-2 whitespace-nowrap font-bold text-warn-ink">
            承認待ち{c.pendingCount}件
          </span>
        )}
      </Td>
      <Td>
        <Pt v={c.points} />
      </Td>
      <Td>
        <Pt v={c.ledgerSum} />
        {c.integrity === "MISMATCH" && (
          <span className="ml-2 whitespace-nowrap font-bold text-danger-ink">
            差 <Sa v={c.diff} />
          </span>
        )}
      </Td>
      <Td>
        <Delta v={c.todayDelta} />
      </Td>
      <Td>
        <Toki iso={c.lastAt} none="動きなし" />
      </Td>
      <Td>
        <IntegrityMark v={c.integrity} />
      </Td>
    </Tr>
  );
}

/* ══════════════════════════════════════════════
   板の中身（台帳の時系列）
   ══════════════════════════════════════════════ */

function DetailBody({ c, canRequest }: { c: PointDetail; canRequest: boolean }) {
  return (
    <>
      {/* ── 整合性 ──

          ★これを、いちばん上に、いちばん目立つ形で出すこと。
            台帳を下まで読まないと食い違いに気づけない作りだと、
            忙しい日には誰も気づきません。 */}
      <div
        className={[
          "rounded-xl border px-4 py-3 text-note leading-[1.85]",
          c.integrity === "OK"
            ? "border-ok/30 bg-ok/10 text-ok-ink"
            : c.integrity === "MISMATCH"
              ? "border-danger/40 bg-danger/10 text-danger-ink"
              : "border-edge bg-paper2 text-slate2",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <IntegrityMark v={c.integrity} />
          <span className="font-bold">残高と台帳の照合</span>
        </div>
        <div className="mt-2">
          <KV k="いまの残高" v={<Pt v={c.points} />} />
          <KV k="台帳の合計" v={<Pt v={c.ledgerSum} />} />
          <KV k="差" v={<Sa v={c.diff} />} />
        </div>
        <p className="mt-2">{INTEGRITY[c.integrity].sub}</p>
      </div>

      {/* ── ① 会員情報 ── */}
      <Block title="会員情報">
        <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
          <KV k="会員番号" v={<span className="num">{c.displayId}</span>} />
          <KV k="お名前" v={c.name} />
          <KV
            k="メール"
            v={c.email ?? <span className="text-slate3">登録されていません</span>}
          />
          <KV k="会員の状態" v={c.customerStatus} />
        </div>
      </Block>

      {/* ── ② 内訳 ──

          ★合計だけを出さないこと。
            「何で増えて、何で減ったのか」が分からないと、
            食い違いの原因を探しようがありません。 */}
      <Block title="何で増減したか" count={c.breakdown.length}>
        {c.breakdown.length === 0 ? (
          <p className="text-note leading-[1.85] text-slate3">
            この会員のポイントは、まだ一度も動いていません。ご入金・ガチャ利用・景品の交換があると、ここに並びます。
          </p>
        ) : (
          <ul className="space-y-1">
            {c.breakdown.map((b) => (
              <li
                key={b.kind}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper2 px-3 py-2 text-note"
              >
                <span className="text-slate2">
                  {b.kindLabel}
                  <span className="num ml-2 text-slate3">（{b.rows}件）</span>
                </span>
                <Delta v={b.total} />
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── ③ 台帳（時系列・Before/After） ── */}
      <Block
        title="ポイント台帳"
        count={c.ledgerRows}
        note={`新しい順・最大${c.limit}件 ／ 増減のたびに1行ずつ残ります。`}
      >
        {c.ledger.length === 0 ? (
          <p className="text-note leading-[1.85] text-slate3">
            台帳に1件も記録がありません。この会員は、まだ一度もポイントが動いていません。
          </p>
        ) : (
          <ul className="space-y-2">
            {c.ledger.map((l) => (
              <LedgerItem key={l.id} l={l} />
            ))}
          </ul>
        )}
        {c.ledgerRows > c.limit && (
          <p className="mt-2 text-note leading-[1.85] text-slate3">
            ★新しい {c.limit}件だけを出しています。台帳そのものは
            {c.ledgerRows.toLocaleString()}件あります。上の「台帳の合計」は、
            切らずに全件で数えた数字です。
          </p>
        )}
      </Block>

      {/* ── ④ 運営による調整 ── */}
      <Block title="運営による調整" count={c.adjustments.length}>
        {c.adjustments.length === 0 ? (
          <p className="text-note leading-[1.85] text-slate3">
            この会員には、運営が手で行った調整の記録が1件もありません。お詫びの付与や、誤った付与の取り消しをすると、ここに残ります。
          </p>
        ) : (
          <ul className="space-y-2">
            {c.adjustments.map((a) => (
              <li
                key={a.id}
                className="rounded-lg border border-edge bg-paper2 px-3 py-2 text-note leading-[1.85]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AdjStatusBadge v={a.status} />
                  <Delta v={a.delta} />
                </div>
                <p className="mt-1 text-slate2">理由：{a.reason}</p>
                <p className="mt-1 text-slate3">
                  申請：{a.requestedByName ?? a.requestedBy} ／{" "}
                  <Toki iso={a.requestedAt} />
                </p>
                {a.decidedAt && (
                  <p className="mt-0.5 text-slate3">
                    判断：{a.decidedByName ?? a.decidedBy} ／{" "}
                    <Toki iso={a.decidedAt} />
                    {a.decidedNote ? ` ／ ${a.decidedNote}` : ""}
                  </p>
                )}
                <BeforeAfter a={a} />
              </li>
            ))}
          </ul>
        )}
      </Block>

      {!canRequest && (
        <p className="text-note leading-[1.9] text-slate3">
          ★いまの担当には、ポイント調整を申請する権限がありません。台帳は見られます。
        </p>
      )}
    </>
  );
}

/**
 * 台帳の1行。
 *
 * ★Before・変動量・After の3つを必ず並べること。
 *   「−500pt」だけだと、そのとき残高がいくらだったのかが分かりません。
 *   食い違いを調べるときに、いちばん要るのはそこです。
 */
function LedgerItem({ l }: { l: LedgerLine }) {
  return (
    <li className="rounded-lg border border-edge bg-paper2 px-3 py-2 text-note leading-[1.85]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate2">{l.kindLabel}</span>
        <Delta v={l.delta} />
      </div>
      <p className="num mt-1 text-slate3">
        {l.before.toLocaleString()}pt → {l.after.toLocaleString()}pt
      </p>
      <p className="mt-0.5 text-slate3">
        <Toki iso={l.createdAt} />
        {l.memo ? ` ／ ${l.memo}` : ""}
      </p>
      {l.link && (
        /* ★どの抽選・どの景品・どの調整で動いたのかを残すこと。
             番号が無いと、あとから追いようがありません */
        <p className="num mt-0.5 text-slate3">
          {l.link.label ?? "関連"}：{l.link.id}
        </p>
      )}
    </li>
  );
}

/**
 * 申請したときの残高と、実際に反映したときの残高。
 *
 * ★ずれていたら、必ず書くこと。
 *   申請時 100,000pt → 承認までに 80,000pt へ動いた、という場合、
 *   古い数字のまま上書きすると、20,000pt が消えます。
 *   サーバーは「いまの残高」を基準に計算し直していますが、
 *   人が見て気づけるように、画面にも並べます。
 */
function BeforeAfter({ a }: { a: PointAdjustment }) {
  if (a.balanceBefore === null && a.balanceAtDecision === null) return null;

  return (
    <div className="mt-2 border-t border-edge pt-2">
      <KV k="申請したときの残高" v={<Pt v={a.balanceBefore} />} />
      {a.balanceAtDecision !== null && (
        <KV k="反映したときの残高" v={<Pt v={a.balanceAtDecision} />} />
      )}
      {a.balanceAfter !== null && <KV k="反映後の残高" v={<Pt v={a.balanceAfter} />} />}
      {a.balanceMoved && (
        <p className="mt-1 rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-note leading-[1.85] text-warn-ink">
          承認を待つあいだに、この会員の残高が動いていました。古い残高ではなく、
          <strong className="font-bold">反映したときの残高</strong>
          を基準に計算しています。
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   調整の申請
   ══════════════════════════════════════════════ */

/**
 * ポイント変更のフォーム。
 *
 * ★押す前に、対象・現在残高・変更量・変更後・理由の5つを
 *   必ず見せること。数字だけ入れて押せる作りにすると、
 *   桁を1つ間違えたことに、誰も気づけません。
 *
 * ★「変更後」を、サーバーの答えとして扱わないこと。
 *   ここに出るのは、いまの残高から計算した見込みです。
 *   本当の反映後の残高は、反映した瞬間にサーバーが決めます
 *   （待っているあいだに残高が動くことがあるためです）。
 *
 * ★境目（何ptから2人必要か）を、ここに書き写さないこと。
 *   サーバーから受け取った threshold をそのまま使います。
 *   書き写すと、境目を変えた日に画面だけ古いままになります。
 */
function RequestForm({
  c,
  threshold,
  onDone,
}: {
  c: PointDetail;
  threshold: number;
  onDone: (ok: boolean, text: string) => void;
}) {
  const [deltaText, setDeltaText] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const raw = Number(deltaText);
  const okNum = deltaText.trim() !== "" && Number.isFinite(raw) && Math.trunc(raw) !== 0;
  const delta = Math.trunc(raw);
  const after = c.points === null || !okNum ? null : c.points + delta;

  const send = useCallback(async () => {
    setBusy(true);
    const r = await runPointRequest({
      userId: c.userId,
      delta,
      reason,
      /* ★1回の操作につき1つ。二度押しでも1件しか作られません */
      idempotencyKey: newIdempotencyKey(),
    });
    setBusy(false);
    setConfirm(false);
    if (r.ok) {
      setDeltaText("");
      setReason("");
    }
    onDone(r.ok, r.message);
  }, [c.userId, delta, reason, onDone]);

  if (!confirm) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="増やす・減らすポイント（減らすときは − を付けます）">
            <input
              className={inputClass}
              inputMode="numeric"
              value={deltaText}
              placeholder="例：500 ／ -500"
              onChange={(e) => setDeltaText(e.target.value)}
            />
          </Field>
          <Field label="理由（必ず書いてください）">
            <input
              className={inputClass}
              value={reason}
              placeholder="例：発送遅延のお詫び（問い合わせ #123）"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </div>

        <p className="text-note leading-[1.85] text-slate3">
          {threshold.toLocaleString()}pt 以上の変更は、別の担当者が承認するまで1ptも動きません。
          それ未満は、その場で反映されます。どちらの場合も、追加の本人確認（6桁）と理由が必要です。
        </p>

        {reason.trim().length > 0 && reason.trim().length < 4 && (
          <p className="text-note leading-[1.85] text-danger-ink">
            理由が短すぎます。あとから読んで分かる長さで書いてください。
          </p>
        )}

        <Btn
          kind="primary"
          disabled={!okNum || reason.trim().length < 4}
          onClick={() => setConfirm(true)}
        >
          内容を確かめる
        </Btn>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-warn/40 bg-warn/8 px-4 py-3">
        <p className="text-note font-bold leading-[1.85] text-warn-ink">
          この内容で送ります。よろしいですか。
        </p>
        <div className="mt-2">
          <KV k="対象の会員" v={`${c.name}（${c.displayId}）`} />
          <KV k="いまの残高" v={<Pt v={c.points} />} />
          <KV k="変更量" v={<Delta v={delta} />} />
          <KV
            k="変更後（見込み）"
            v={
              after === null ? (
                <span className="text-note text-slate3">計算できません</span>
              ) : (
                <span className="num">{after.toLocaleString()}pt</span>
              )
            }
          />
          <KV k="理由" v={reason} />
          <KV
            k="扱い"
            v={
              Math.abs(delta) >= threshold
                ? "別の担当者の承認を待ちます（この時点では1ptも動きません）"
                : "その場で反映されます"
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Btn kind="primary" disabled={busy} onClick={send}>
          {busy ? "送っています…" : "この内容で送る"}
        </Btn>
        <Btn kind="ghost" disabled={busy} onClick={() => setConfirm(false)}>
          書き直す
        </Btn>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   承認待ちの一覧
   ══════════════════════════════════════════════ */

function ApprovalList() {
  const [status, setStatus] = useState("PENDING");
  const { state, reload } = useAdjustments(status);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const data = state.phase === "ok" ? state.data : null;
  const rows = data?.adjustments ?? [];

  return (
    <>
      <Msg msg={msg} onClose={() => setMsg(null)} />

      <Card title="しぼりこみ">
        <div className="max-w-xs">
          <Field label="状態">
            <select
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="PENDING">承認待ち</option>
              <option value="APPROVED">承認して反映済み</option>
              <option value="APPLIED">その場で反映済み</option>
              <option value="REJECTED">却下</option>
              <option value="">すべて</option>
            </select>
          </Field>
        </div>
      </Card>

      {state.phase === "loading" && (
        <Card title="ポイント調整">
          <Skeleton rows={3} label="申請を読み込んでいます" />
        </Card>
      )}

      {state.phase === "ng" && (
        <ErrorBox what={state.why} code={state.code} onRetry={reload} />
      )}

      {data && (
        <Card
          title="ポイント調整の申請"
          note={`承認待ち ${data.pendingCount.toLocaleString()}件 ／ ${data.fourEyesThreshold.toLocaleString()}pt 以上は、2人目の承認が必要です。`}
        >
          {rows.length === 0 ? (
            <Empty
              why={
                status === "PENDING"
                  ? "いま、承認を待っているポイント調整は1件もありません。"
                  : "この状態に当てはまる申請はありませんでした。"
              }
              next={
                status === "PENDING" ? (
                  <>
                    {data.fourEyesThreshold.toLocaleString()}
                    pt 以上のポイント変更が申請されると、ここに入ります。
                    それ未満の変更は承認を待たずにその場で反映されるので、ここには並びません
                    （記録は会員ごとの台帳に残ります）。
                  </>
                ) : (
                  <>上の「状態」を「すべて」にすると、過去の申請も出ます。</>
                )
              }
            />
          ) : (
            <div className="space-y-3">
              {rows.map((a) => (
                <ApprovalCard
                  key={a.id}
                  a={a}
                  canApprove={data.canApprove}
                  meId={data.meId}
                  onDone={(ok, text) => {
                    setMsg({ ok, text });
                    reload();
                  }}
                />
              ))}
            </div>
          )}

          {!data.canApprove && (
            <p className="mt-4 text-note leading-[1.9] text-slate3">
              ★いまの担当には、ポイント調整を承認する権限がありません。内容は確認できます。
            </p>
          )}
        </Card>
      )}
    </>
  );
}

function ApprovalCard({
  a,
  canApprove,
  meId,
  onDone,
}: {
  a: PointAdjustment;
  canApprove: boolean;
  meId: string;
  onDone: (ok: boolean, text: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  /* ★これは親切のためであって、守りではありません。
       自分の申請を自分で通せないことは、サーバー側
       （lib/server/points.ts の SELF_APPROVAL）が決めています */
  const mine = a.requestedBy === meId;
  const pending = a.status === "PENDING";

  const run = useCallback(
    async (approve: boolean) => {
      setBusy(true);
      const r = await runPointDecide({ adjustmentId: a.id, approve, note });
      setBusy(false);
      onDone(r.ok, r.message);
    },
    [a.id, note, onDone],
  );

  return (
    <div
      className={`rounded-xl border px-4 py-4 ${
        pending ? "border-warn/40 bg-warn/8" : "border-edge bg-paper2"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-note font-bold text-slate">
          {a.userName}
          <span className="num ml-2 font-medium text-slate3">{a.userDisplayId}</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {mine && <Badge tone="blue">自分が出した申請</Badge>}
          <AdjStatusBadge v={a.status} />
        </div>
      </div>

      <div className="mt-2 border-t border-edge pt-2">
        <KV k="変更量" v={<Delta v={a.delta} />} />
        <KV k="申請したときの残高" v={<Pt v={a.balanceBefore} />} />
        <KV
          k="いまの残高"
          v={
            <span className="flex flex-wrap items-center gap-2">
              <Pt v={a.balanceNow} />
              {a.balanceMoved && <Badge tone="warn">申請したときから動いています</Badge>}
            </span>
          }
        />
        <KV k="理由" v={a.reason} />
        <KV
          k="申請者"
          v={
            <>
              {a.requestedByName ?? a.requestedBy} ／ <Toki iso={a.requestedAt} />
            </>
          }
        />
        {a.decidedAt && (
          <KV
            k="判断"
            v={
              <>
                {a.decidedByName ?? a.decidedBy} ／ <Toki iso={a.decidedAt} />
                {a.decidedNote ? ` ／ ${a.decidedNote}` : ""}
              </>
            }
          />
        )}
        <BeforeAfter a={a} />
      </div>

      {a.balanceMoved && pending && (
        <p className="mt-2 rounded-lg border border-warn/40 bg-warn/12 px-3 py-2 text-note leading-[1.85] text-warn-ink">
          <strong className="font-bold">
            申請されたあとに、この会員の残高が動いています。
          </strong>
          承認すると、申請したときの残高ではなく
          <strong className="font-bold">いまの残高</strong>
          を基準に計算されます。それでよいか、先に確かめてください。
        </p>
      )}

      {pending && canApprove && !mine && (
        <div className="mt-3 space-y-2">
          <Field label="ひとこと（却下するときは必ず書いてください）">
            <input
              className={inputClass}
              value={note}
              placeholder="例：金額の根拠が確認できないため"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Btn kind="primary" disabled={busy} onClick={() => run(true)}>
              {busy ? "処理しています…" : "承認して反映する"}
            </Btn>
            <Btn
              kind="danger"
              disabled={busy || note.trim().length < 4}
              onClick={() => run(false)}
            >
              却下する
            </Btn>
          </div>
          <p className="text-note leading-[1.85] text-slate3">
            承認・却下には、直前の追加の本人確認（6桁）が必要です。求められた場合は、認証アプリの数字を入れてください。
          </p>
        </div>
      )}

      {pending && mine && (
        <p className="mt-3 text-note leading-[1.85] text-slate3">
          自分が出した申請は、自分では承認できません。別の担当者にお願いしてください。これは画面の都合ではなく、サーバー側で断っています。
        </p>
      )}

      {pending && !canApprove && !mine && (
        <p className="mt-3 text-note leading-[1.85] text-slate3">
          いまの担当には、この申請を承認する権限がありません。
        </p>
      )}
    </div>
  );
}
