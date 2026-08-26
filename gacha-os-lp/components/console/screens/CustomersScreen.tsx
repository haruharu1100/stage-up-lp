/**
 * 会員管理。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面は、数えないこと
 * ═══════════════════════════════════════════════════════
 *
 *   会員数も、危険度も、ポイントの食い違いも、
 *   サーバー（lib/server/customerAdmin.ts）が作った値を出すだけです。
 *   ここで足し算や条件分けを書かないでください。
 *   書いた瞬間に、同じ数字を出す場所が2つになります。
 *   ずれた日に、どちらが正しいかを調べる人はいません。
 *
 *   危険度は、Dashboard の「高Riskユーザー」と同じ数え方
 *   （fraud_flags の未処理）から来ています。
 *   ★ここだけ別の数え方を足さないこと。
 *     足した瞬間に、Dashboardと会員管理で人数が食い違います。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面で気をつけること
 * ═══════════════════════════════════════════════════════
 *
 *   1) 会員の個人情報を、必要以上に画面へ出さないこと。
 *      毎日開く画面に本名・住所・電話番号を並べておくと、
 *      背後から覗かれただけで漏れます。
 *      ★住所そのものは、この画面には来ません。
 *        サーバーが「登録されているか / いないか」しか返しません。
 *        住所が要る仕事は、発送管理でします。
 *
 *   2) 危険度の印は「決めつけ」ではなく「手がかり」として出すこと。
 *      同じIPは、会社・学校・寮・大手キャリアの回線でも起きます。
 *      印が付いている＝悪い人、ではありません。
 *
 *   3) この画面から、いきなり永久停止はしないこと。
 *      できるのは「一時的に止める」までです。誤検知は必ず起きます。
 *      止めるときは理由が要ります。理由は監査ログにそのまま残ります。
 *
 *   4) お客様が自分の画面でした操作を、ここから必ず見えるようにすること。
 *      「発送をお願いしたのに来ない」と電話が来たとき、
 *      運営がこの画面を開いて
 *      「〇月〇日にご依頼いただき、いま準備中です」と
 *      その場で答えられなければ、折り返しになります。
 *      折り返しは、それだけで1件あたり10分以上かかります。
 *
 * ★守りを、この画面に置かないこと。
 *   ボタンを隠すのは親切のためであって、守りではありません。
 *   止められるかどうかを本当に決めているのはサーバーです。
 */

"use client";

import { useCallback, useState } from "react";
import {
  EMPTY_CUSTOMER_FILTER,
  runCustomerAction,
  useCustomerDetail,
  useCustomerList,
  type CustomerActionKind,
  type CustomerDetail,
  type CustomerFilter,
  type CustomerRow,
} from "@/lib/console/liveCustomers";
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
   言葉と色（出し方だけ。判断はしない）
   ══════════════════════════════════════════════ */

type Tone = "neutral" | "ok" | "warn" | "danger" | "blue";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "通常", tone: "ok" },
  SUSPENDED: { label: "停止中", tone: "danger" },
  OTHER: { label: "その他", tone: "warn" },
};

/** ★知らない状態を「通常」に丸めないこと。丸めると壊れたデータが普通に見えます */
function StatusBadge({ c }: { c: CustomerRow }) {
  const s = STATUS[c.status];
  if (!s) return <Badge tone="neutral">{c.statusRaw}</Badge>;
  if (c.status === "OTHER") {
    return <Badge tone="warn">その他（{c.statusRaw}）</Badge>;
  }
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const RISK: Record<string, { label: string; action: string; tone: Tone }> = {
  HIGH: { label: "高", action: "先に確認", tone: "danger" },
  MEDIUM: { label: "中", action: "様子を見る", tone: "warn" },
  LOW: { label: "低", action: "記録のみ", tone: "blue" },
  /* ★「なし」だけにしないこと。
        何が無いのかが書いていないと、読んだ人の次の行動が決まりません */
  NONE: { label: "手がかりなし", action: "", tone: "neutral" },
};

/** 危険度の印。★色だけに頼らず、日本語も一緒に出すこと */
function RiskMark({ level }: { level: string }) {
  const r = RISK[level] ?? { label: level, action: "", tone: "neutral" as Tone };
  return (
    <Badge tone={r.tone}>
      {r.label}
      {r.action && <span className="ml-2 font-medium opacity-70">{r.action}</span>}
    </Badge>
  );
}

/**
 * 金額。
 * ★見せられない人には、0円ではなく理由を出すこと。
 *   0円は「1円も使っていない」です。null は「見せられません」です。
 */
function Money({ v }: { v: number | null }) {
  if (v === null) {
    return (
      <span
        className="text-note text-slate3"
        title="金額を見る権限がありません。0円という意味ではありません。"
      >
        見せられません
      </span>
    );
  }
  return <span className="num whitespace-nowrap">{v.toLocaleString()}円</span>;
}

/** 日時。★分からないものを、それらしい日付で埋めないこと */
function nichiji(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 日付だけ */
function hizuke(iso: string | null): string {
  const s = nichiji(iso);
  return s ? s.slice(0, 10) : "";
}

/** ★記録が無いことを、空白で済ませないこと */
function Toki({ iso, none = "記録なし" }: { iso: string | null; none?: string }) {
  const s = nichiji(iso);
  if (!s) return <span className="text-note text-slate3">{none}</span>;
  return <span className="num whitespace-nowrap">{s}</span>;
}

const POINT_KIND: Record<string, string> = {
  OPENING: "開始時の残高",
  CHARGE: "入金",
  DRAW_SPEND: "ガチャ利用",
  DRAW_RETURN: "抽選結果のお返し",
  PRIZE_EXCHANGE: "獲得商品をポイントに交換",
  ADMIN_ADJUST: "運営による調整",
  CAMPAIGN: "キャンペーン付与",
};

const PRIZE_STATUS: Record<string, { label: string; tone: Tone }> = {
  UNCHOSEN: { label: "受け取り方法をお選びいただき中", tone: "warn" },
  SHIP_REQUESTED: { label: "発送依頼済み", tone: "blue" },
  EXCHANGED: { label: "ポイント交換済み", tone: "neutral" },
  SHIPPED: { label: "発送済み", tone: "ok" },
};

const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "受付済み", tone: "warn" },
  PAID: { label: "支払済み", tone: "blue" },
  PARTIALLY_FULFILLED: { label: "一部発送済み", tone: "warn" },
  FULFILLED: { label: "発送済み", tone: "ok" },
  CANCELLED: { label: "取消", tone: "danger" },
};

const SHIPMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  REQUESTED: { label: "依頼受付", tone: "warn" },
  PREPARING: { label: "準備中", tone: "warn" },
  READY: { label: "発送待ち", tone: "warn" },
  SHIPPED: { label: "発送済み", tone: "ok" },
  IN_TRANSIT: { label: "配送中", tone: "blue" },
  DELIVERED: { label: "配達完了", tone: "ok" },
  CANCELLED: { label: "取消", tone: "danger" },
};

const TICKET_STATUS: Record<string, { label: string; tone: Tone }> = {
  NEW: { label: "未対応", tone: "danger" },
  AI_REPLIED: { label: "AIが下書き済み", tone: "warn" },
  HUMAN_REVIEW: { label: "人の確認待ち", tone: "warn" },
  IN_PROGRESS: { label: "対応中", tone: "blue" },
  RESOLVED: { label: "完了", tone: "ok" },
};

/** ★知らない値を、勝手にそれらしい日本語へ丸めないこと。生の値をそのまま出します */
function label(map: Record<string, { label: string; tone: Tone }>, v: string) {
  return map[v] ?? { label: v, tone: "neutral" as Tone };
}

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export default function CustomersScreen() {
  const [filter, setFilter] = useState<CustomerFilter>(EMPTY_CUSTOMER_FILTER);
  /* 1文字ごとに通信しないよう、押したときだけ反映します */
  const [qDraft, setQDraft] = useState("");

  const { state, reload } = useCustomerList(filter);

  /* ★会員そのものを写して持たないこと。
       止める・戻すを押した瞬間に、状態も履歴も変わります。
       番号だけ持って、毎回サーバーから引き直します */
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useCustomerDetail(openId);

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action: CustomerActionKind, customerId: string, reason: string) => {
      setBusy(true);
      const r = await runCustomerAction({ action, customerId, reason });
      setBusy(false);
      setMsg({ ok: r.ok, text: r.message });
      /* ★成功したときだけ読み直す、にしないこと。
           断られた理由が「すでに停止中」のこともあります。
           そのときは画面の方が古いので、読み直すのが正解です */
      reload();
      detail.reload();
    },
    [reload, detail],
  );

  const data = state.phase === "ok" ? state.data : null;
  const rows = data?.customers ?? [];
  const shibori =
    filter.q !== "" || filter.status !== "" || filter.risk !== "" || filter.onlyMismatch;

  return (
    <>
      <WhatIsThis>
        会員をさがし、中身を確かめ、必要なら一時的に止めます。危険度の印が付いていても、
        <strong className="font-bold text-slate">
          それだけで悪い人だと決めつけないでください
        </strong>
        。同じ回線・同じ端末は、会社や家庭でも普通に起きます。この画面の数字は、すべて登録されている会員そのものから数えています。
      </WhatIsThis>

      {/* ── 危険度の意味 ── */}
      <div className="rounded-xl border border-blue-ink/25 bg-blue-pale/40 px-5 py-4">
        <p className="text-note leading-[1.9] text-slate2">
          <strong className="font-bold text-slate">危険度は、未処理の不正フラグから出しています。</strong>
          Dashboardの「高Riskユーザー」と同じ数え方です。
          <br />
          ポイントの食い違い・ログイン失敗は、危険度とは
          <strong className="font-bold text-slate">別の欄</strong>
          に出しています。混ぜると、どちらの理由で印が付いたのか分からなくなるためです。
        </p>
      </div>

      {/* ── 操作の知らせ ── */}
      {msg && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4 text-note leading-[1.9] ${
            msg.ok
              ? "border-ok/30 bg-ok/10 text-ok-ink"
              : "border-danger/30 bg-danger/10 text-danger-ink"
          }`}
        >
          <span className="font-bold">{msg.text}</span>
          <Btn kind="ghost" onClick={() => setMsg(null)}>
            閉じる
          </Btn>
        </div>
      )}

      {/* ── 絞り込み ──

          ★画面に届いた配列を絞らないこと。
            件数が増えた日に、上限で切られた中だけを絞ることになります。
            出てこない会員がいても、画面には何も出ません。 */}
      <Card title="さがす" note="条件はサーバー側で絞り込みます。">
        <div className="grid gap-3 md:grid-cols-[1fr_10rem_10rem_auto]">
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
          <Field label="状態">
            <select
              className={inputClass}
              value={filter.status}
              onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">すべて</option>
              <option value="ACTIVE">通常</option>
              <option value="SUSPENDED">停止中</option>
              <option value="OTHER">その他</option>
            </select>
          </Field>
          <Field label="危険度">
            <select
              className={inputClass}
              value={filter.risk}
              onChange={(e) => setFilter((f) => ({ ...f, risk: e.target.value }))}
            >
              <option value="">すべて</option>
              <option value="HIGH">高</option>
              <option value="MEDIUM">中</option>
              <option value="LOW">低</option>
              <option value="NONE">手がかりなし</option>
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <Btn kind="primary" onClick={() => setFilter((f) => ({ ...f, q: qDraft }))}>
              さがす
            </Btn>
            <Btn
              kind="ghost"
              onClick={() => {
                setQDraft("");
                setFilter(EMPTY_CUSTOMER_FILTER);
              }}
            >
              条件を消す
            </Btn>
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 text-note text-slate2">
          <input
            type="checkbox"
            checked={filter.onlyMismatch}
            onChange={(e) => setFilter((f) => ({ ...f, onlyMismatch: e.target.checked }))}
          />
          ポイントが履歴と合っていない人だけ
        </label>
      </Card>

      {/* ── 読めていないとき ── */}
      {state.phase === "loading" && (
        <Card title="会員一覧">
          <Skeleton rows={5} label="会員を読み込んでいます" />
        </Card>
      )}

      {state.phase === "ng" && (
        <ErrorBox what={state.why} code={state.code} onRetry={reload} />
      )}

      {data && (
        <>
          {/* ── 会社ぜんぶの内訳 ──

              ★ここは絞り込みと関係なく、会社ぜんぶで数えています。
                絞ったあとの数を「会員数」として出すと、
                検索するたびに会員数が減る画面になります。 */}
          <Card
            title="会員の状況"
            note="絞り込みとは関係なく、登録されている会員ぜんぶを数えています。"
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="会員数（全体）" value={data.counts.all} unit="名" />
              <Stat label="通常" value={data.counts.active} unit="名" tone="ok" />
              <Stat
                label="停止中"
                value={data.counts.suspended}
                unit="名"
                tone={data.counts.suspended > 0 ? "danger" : "normal"}
              />
              <Stat
                label="危険度が高い"
                value={data.counts.highRisk}
                unit="名"
                tone={data.counts.highRisk > 0 ? "danger" : "normal"}
                sub="未処理の不正フラグがある方"
              />
              <Stat
                label="ポイントが合っていない"
                value={data.counts.mismatch}
                unit="名"
                tone={data.counts.mismatch > 0 ? "danger" : "normal"}
                sub="残高と履歴の合計が違う方"
              />
            </div>

            {data.counts.mismatch > 0 && (
              <p className="mt-4 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-note leading-[1.9] text-danger-ink">
                <strong className="font-bold">
                  ポイントの残高と、履歴の合計が合っていない会員がいます。
                </strong>
                合わないということは、記録に残っていないポイントが動いたということです。
                原因が分かるまで、その会員のポイントは触らないでください。上の
                「ポイントが履歴と合っていない人だけ」で絞り込めます。
              </p>
            )}
          </Card>

          {/* ── 一覧 ── */}
          <Card
            title="会員一覧"
            note={
              `${data.total}件` +
              (shibori ? `（絞り込み中／全体は${data.counts.all}名）` : "") +
              " ／ 行を押すと、中身と操作を開きます。"
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
                {/* ★操作ボタンを表の中に並べないこと。
                      行そのものが押せるので、行を開くつもりで
                      「停止する」を押してしまう事故が起きます。 */}
                <Table
                  head={[
                    "会員",
                    "登録日",
                    "保有pt",
                    "使った金額",
                    "引いた回数",
                    "発送",
                    "危険度",
                    "状態",
                  ]}
                >
                  {rows.map((c) => (
                    <Tr
                      key={c.id}
                      onOpen={() => setOpenId(c.id)}
                      active={openId === c.id}
                      tone={
                        c.status === "SUSPENDED" || c.risk === "HIGH" || c.ledgerMismatch
                          ? "danger"
                          : c.risk === "MEDIUM"
                            ? "warn"
                            : undefined
                      }
                    >
                      <Td>
                        <span className="font-bold text-slate">{c.name}</span>
                        <br />
                        <span className="num text-slate3">{c.displayId}</span>
                        {c.emailMasked && (
                          <span className="ml-2 text-slate3">{c.emailMasked}</span>
                        )}
                      </Td>
                      <Td className="num whitespace-nowrap">{hizuke(c.joinedAt)}</Td>
                      <Td className="num whitespace-nowrap">
                        {c.points.toLocaleString()}pt
                        {c.ledgerMismatch && (
                          <span className="ml-2 whitespace-nowrap font-bold text-danger-ink">
                            合っていません
                          </span>
                        )}
                      </Td>
                      <Td>
                        <Money v={c.spent} />
                      </Td>
                      <Td className="num">{c.plays.toLocaleString()}回</Td>
                      <Td className="num">{c.shipmentCount.toLocaleString()}件</Td>
                      <Td>
                        <RiskMark level={c.risk} />
                      </Td>
                      <Td>
                        <StatusBadge c={c} />
                      </Td>
                    </Tr>
                  ))}
                </Table>

                <Rows>
                  {rows.map((c) => (
                    <RowCard key={c.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-note font-bold text-slate">{c.name}</span>
                        <StatusBadge c={c} />
                      </div>
                      <p className="num mt-0.5 text-note text-slate3">
                        {c.displayId}
                        {c.emailMasked ? ` ／ ${c.emailMasked}` : ""}
                      </p>
                      <div className="mt-2">
                        <RiskMark level={c.risk} />
                      </div>
                      <div className="mt-2 border-t border-edge pt-2">
                        <KV k="登録日" v={<span className="num">{hizuke(c.joinedAt)}</span>} />
                        <KV
                          k="保有pt"
                          v={<span className="num">{c.points.toLocaleString()}pt</span>}
                        />
                        <KV k="使った金額" v={<Money v={c.spent} />} />
                        <KV k="引いた回数" v={<span className="num">{c.plays}回</span>} />
                        <KV k="発送" v={<span className="num">{c.shipmentCount}件</span>} />
                      </div>
                      {c.ledgerMismatch && (
                        <p className="mt-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-note leading-[1.85] text-danger-ink">
                          残高と履歴の合計が合っていません。
                        </p>
                      )}
                      <div className="mt-3">
                        <Btn onClick={() => setOpenId(c.id)}>中身と操作を開く</Btn>
                      </div>
                    </RowCard>
                  ))}
                </Rows>
              </>
            )}

            <p className="mt-5 rounded-xl border border-blue-pale bg-blue-pale/50 px-4 py-3 text-note leading-[1.9] text-slate2">
              <strong className="font-bold text-blue-ink">
                住所・電話番号は、この画面には出しません。
              </strong>{" "}
              サーバーから送っていないので、開いても出てきません。お届け先が要る仕事は、発送管理でします。
              メールも伏せ字にしています。毎日開く画面に個人情報を並べておくと、後ろから覗かれただけで漏れます。
            </p>

            {!data.canSeeMoney && (
              <p className="mt-2 text-note leading-[1.9] text-slate3">
                ★「使った金額」が「見せられません」になっています。いまの担当には、金額を見る権限がありません。0円という意味ではありません。
              </p>
            )}

            {!data.canSuspend && (
              <p className="mt-2 text-note leading-[1.9] text-slate3">
                ★いまの担当には、会員を停止する権限がありません。中身は見られます。
              </p>
            )}
          </Card>
        </>
      )}

      {/* ── 1人ぶんの中身と、操作 ── */}
      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={detail.state.phase === "ok" ? detail.state.customer.name : "会員"}
        note={
          detail.state.phase === "ok"
            ? `${detail.state.customer.displayId} ／ 保有 ${detail.state.customer.points.toLocaleString()}pt`
            : undefined
        }
        foot={
          detail.state.phase === "ok" ? (
            <Actions
              c={detail.state.customer}
              canSuspend={detail.state.canSuspend}
              busy={busy}
              onRun={run}
            />
          ) : undefined
        }
      >
        {detail.state.phase === "loading" && (
          <Skeleton rows={4} label="会員の中身を読み込んでいます" />
        )}
        {detail.state.phase === "ng" && (
          <ErrorBox
            what={detail.state.why}
            code={detail.state.code}
            onRetry={detail.reload}
          />
        )}
        {detail.state.phase === "ok" && <Body c={detail.state.customer} />}
      </Drawer>
    </>
  );
}

/* ══════════════════════════════════════════════
   板の中身（9項目）
   ══════════════════════════════════════════════ */

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

/** 空のとき。★「ありません。」だけで終わらせないこと */
function Nashi({ children }: { children: React.ReactNode }) {
  return <p className="text-note leading-[1.85] text-slate3">{children}</p>;
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="rounded-lg bg-paper2 px-3 py-2">{children}</li>;
}

function Body({ c }: { c: CustomerDetail }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge c={c} />
        <RiskMark level={c.risk} />
        {c.ledgerMismatch && <Badge tone="danger">ポイントが合っていません</Badge>}
      </div>

      {/* ── ① 会員情報 ── */}
      <Block title="会員情報">
        <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
          <KV k="会員番号" v={<span className="num">{c.displayId}</span>} />
          <KV k="お名前" v={c.name} />
          <KV
            k="メール"
            v={
              c.emailMasked ?? (
                <span className="text-slate3">登録されていません</span>
              )
            }
          />
          <KV k="登録日" v={<Toki iso={c.joinedAt} none="記録がありません" />} />
          <KV
            k="最終ログイン"
            v={<Toki iso={c.lastLoginAt} none="まだログインがありません" />}
          />
          <KV
            k="お届け先"
            v={
              c.hasAddress ? (
                /* ★住所そのものは出しません。サーバーからも送っていません */
                <span>登録あり（中身は発送管理で確認）</span>
              ) : (
                <span className="text-slate3">未登録</span>
              )
            }
          />
          {c.addressChangedAt && (
            <KV k="住所の最終変更" v={<Toki iso={c.addressChangedAt} />} />
          )}
          <KV
            k="パスワード変更"
            v={<Toki iso={c.passwordChangedAt} none="変更されていません" />}
          />
          {c.mustChangePassword && (
            <KV k="仮パスワード" v={<Badge tone="warn">次のログインで変更が必要</Badge>} />
          )}
        </div>
      </Block>

      {/* ── ② ポイント ── */}
      <Block title="ポイント" count={c.ledger.length} note={`新しい順・最大${c.limit}件`}>
        <div
          className={[
            "rounded-xl border px-4 py-3 text-note leading-[1.85]",
            c.ledgerMismatch
              ? "border-danger/40 bg-danger/10 text-danger-ink"
              : "border-ok/30 bg-ok/10 text-ok-ink",
          ].join(" ")}
        >
          {c.ledgerMismatch ? (
            <>
              <strong className="font-bold">ポイントが合っていません。</strong> 残高は{" "}
              <span className="num">{c.points.toLocaleString()}pt</span>、履歴{c.ledgerRows}件の合計は{" "}
              <span className="num">{c.ledgerSum.toLocaleString()}pt</span> です。
              記録に残っていないポイントが動いています。原因が分かるまで、この会員のポイントは触らないでください。
            </>
          ) : (
            <>
              <strong className="font-bold">ポイントは合っています。</strong> いまの残高{" "}
              <span className="num">{c.points.toLocaleString()}pt</span> は、履歴{c.ledgerRows}件の合計と一致しています。
            </>
          )}
        </div>

        {c.ledger.length === 0 ? (
          <p className="mt-2 text-note leading-[1.85] text-slate3">
            ポイントの増減は、まだ1件もありません。購入・抽選・付与のときに、ここへ記録されます。
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {c.ledger.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg bg-paper2 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-note font-medium text-slate2">
                    {POINT_KIND[e.kind] ?? e.kind}
                  </span>
                  {e.memo && <span className="ml-2 text-note text-slate3">{e.memo}</span>}
                  <span className="num ml-2 text-note text-slate3">
                    {nichiji(e.createdAt)}
                  </span>
                </span>
                <span
                  className={`num shrink-0 text-note font-bold ${
                    e.delta >= 0 ? "text-ok-ink" : "text-slate2"
                  }`}
                >
                  {e.delta >= 0 ? "+" : ""}
                  {e.delta.toLocaleString()}pt
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── ③ 引いた記録 ── */}
      <Block title="引いた記録" count={c.plays} note={`新しい順・最大${c.limit}件を表示`}>
        {c.draws.length === 0 ? (
          <Nashi>
            まだ1回も引かれていません。ガチャを引くと、1回ぶんずつここに残ります。
          </Nashi>
        ) : (
          <ul className="space-y-1.5">
            {c.draws.map((d) => (
              <Li key={d.id}>
                <span className="text-note font-bold text-slate">
                  {/* ★ガチャが消えていたら、それらしい名前で埋めないこと */}
                  {d.gachaTitle ?? "（ガチャの記録が残っていません）"}
                </span>
                <span className="num ml-2 text-note text-slate3">{nichiji(d.at)}</span>
                <p className="mt-0.5 text-note text-slate2">
                  {d.prizeRank}賞 {d.prizeName}
                  <span className="num ml-2 text-slate3">
                    価値 {d.prizeValue.toLocaleString()}円 ／ 1回 {d.price.toLocaleString()}pt
                    ／ 残高 {d.pointAfter.toLocaleString()}pt
                  </span>
                </p>
              </Li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── ④ 獲得景品 ── */}
      <Block title="獲得した景品" count={c.prizeCount} note={`新しい順・最大${c.limit}件を表示`}>
        {c.prizes.length === 0 ? (
          <Nashi>まだ1点も当たっていません。ガチャで当たると、ここに並びます。</Nashi>
        ) : (
          <ul className="space-y-1.5">
            {c.prizes.map((p) => {
              const st = label(PRIZE_STATUS, p.status);
              return (
                <Li key={p.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-note font-bold text-slate">
                      {p.grade}賞 {p.name}
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="num mt-0.5 text-note text-slate3">
                    価値 {p.value.toLocaleString()}円 ／ {nichiji(p.wonAt)}
                  </p>
                </Li>
              );
            })}
          </ul>
        )}
      </Block>

      {/* ── ⑤ 注文 ── */}
      <Block title="注文" count={c.orders.length}>
        {c.orders.length === 0 ? (
          <Nashi>
            注文はありません。お客様が獲得景品から「発送してもらう」を選ぶと、ここに入ります。
          </Nashi>
        ) : (
          <ul className="space-y-1.5">
            {c.orders.map((o) => {
              const st = label(ORDER_STATUS, o.orderStatus);
              return (
                <Li key={o.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-note font-bold text-slate">
                      {o.orderNumber}
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="mt-0.5 text-note text-slate3">
                    <span className="num">{nichiji(o.orderedAt)}</span>
                    <span className="ml-2">支払い {o.paymentStatus}</span>
                    <span className="ml-2">
                      合計 <Money v={o.total} />
                    </span>
                  </p>
                </Li>
              );
            })}
          </ul>
        )}
      </Block>

      {/* ── ⑥ 発送 ── */}
      <Block title="発送" count={c.shipmentCount}>
        {c.shipments.length === 0 ? (
          <Nashi>
            発送はまだありません。注文を受け付けたあと、発送管理で1件ずつ進めます。
          </Nashi>
        ) : (
          <ul className="space-y-1.5">
            {c.shipments.map((s) => {
              const st = label(SHIPMENT_STATUS, s.status);
              return (
                <Li key={s.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-note font-bold text-slate">
                      {s.shipmentNumber}
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="mt-0.5 text-note text-slate3">
                    <span className="num">依頼 {nichiji(s.requestedAt)}</span>
                    {s.shippedAt && (
                      <span className="num ml-2">発送 {nichiji(s.shippedAt)}</span>
                    )}
                    {s.deliveredAt && (
                      <span className="num ml-2">配達 {nichiji(s.deliveredAt)}</span>
                    )}
                    {s.trackingNumber && (
                      <span className="num ml-2">
                        {s.carrier ?? ""} {s.trackingNumber}
                      </span>
                    )}
                  </p>
                </Li>
              );
            })}
          </ul>
        )}
      </Block>

      {/* ── ⑦ 問い合わせ ── */}
      <Block
        title="問い合わせ"
        count={c.tickets.length}
        note={
          c.openTicketCount > 0
            ? `うち ${c.openTicketCount}件は、まだ終わっていません。`
            : undefined
        }
      >
        {c.tickets.length === 0 ? (
          <Nashi>この会員からの問い合わせは、まだ届いていません。</Nashi>
        ) : (
          <ul className="space-y-1.5">
            {c.tickets.map((t) => {
              const st = label(TICKET_STATUS, t.status);
              return (
                <Li key={t.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-note font-medium text-slate2">{t.subject}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="num mt-0.5 text-note text-slate3">{nichiji(t.createdAt)}</p>
                </Li>
              );
            })}
          </ul>
        )}
      </Block>

      {/* ── ⑧ 危険度の手がかり ── */}
      <Block
        title="危険度の手がかり"
        count={c.flags.length}
        note="印が付いている＝悪い人、ではありません。同じ回線・同じ端末は、会社や家庭でも普通に起きます。"
      >
        {c.flags.length === 0 ? (
          <Nashi>
            気になる点は記録されていません。未処理の手がかりは0件です。
          </Nashi>
        ) : (
          <ul className="space-y-1.5">
            {c.flags.map((f) => (
              <Li key={f.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-note font-bold text-slate">{f.kind}</span>
                  <Badge
                    tone={
                      f.severity.toUpperCase() === "HIGH"
                        ? "danger"
                        : f.severity.toUpperCase().startsWith("MED")
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {f.severity}
                  </Badge>
                  <Badge tone={f.status === "OPEN" ? "warn" : "ok"}>
                    {f.status === "OPEN" ? "未処理" : f.status}
                  </Badge>
                </div>
                <p className="mt-0.5 text-note leading-[1.85] text-slate2">{f.detail}</p>
                <p className="num mt-0.5 text-note text-slate3">
                  {nichiji(f.createdAt)}
                  {f.reviewedAt && ` ／ 確認済み ${nichiji(f.reviewedAt)}`}
                </p>
              </Li>
            ))}
          </ul>
        )}

        {/* ★ログイン失敗とポイントの食い違いを、危険度に混ぜないこと。
              混ぜると、どちらの理由で印が付いたのかが読めなくなります */}
        <div className="mt-3 rounded-xl border border-edge bg-paper2 px-4 py-3">
          <p className="text-note font-bold text-slate2">危険度とは別の手がかり</p>
          <KV
            k="ログイン失敗の連続回数"
            v={<span className="num">{c.failedLogins}回</span>}
          />
          <KV
            k="ロック"
            v={
              c.lockedUntil ? (
                <span className="num text-danger-ink">{nichiji(c.lockedUntil)}まで</span>
              ) : (
                <span className="text-slate3">かかっていません</span>
              )
            }
          />
          <KV
            k="ポイントの一致"
            v={
              c.ledgerMismatch ? (
                <span className="font-bold text-danger-ink">合っていません</span>
              ) : (
                <span className="text-ok-ink">合っています</span>
              )
            }
          />
        </div>
      </Block>

      {/* ── ⑨ ログイン履歴 ── */}
      <Block
        title="ログイン履歴"
        count={c.loginsKnown ? c.logins.length : undefined}
        note={c.loginsKnown ? `新しい順・最大${c.limit}件` : undefined}
      >
        {/* ★引く手がかりが無いことを「0件」と書かないこと。
              「1度もログインしていない」とは意味が違います */}
        {!c.loginsKnown ? (
          <Nashi>
            この会員はメールが登録されていないため、ログインの記録を引けません。0件という意味ではありません。
          </Nashi>
        ) : c.logins.length === 0 ? (
          <Nashi>ログインの記録は、まだ1件もありません。</Nashi>
        ) : (
          <ul className="space-y-1">
            {c.logins.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg bg-paper2 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <Badge tone={l.ok ? "ok" : "danger"}>{l.ok ? "成功" : "失敗"}</Badge>
                  {!l.ok && l.reason && (
                    <span className="ml-2 text-note text-slate3">{l.reason}</span>
                  )}
                </span>
                <span className="num shrink-0 text-note text-slate3">
                  {nichiji(l.at)}
                  {l.ip && ` ／ ${l.ip}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </>
  );
}

/* ══════════════════════════════════════════════
   操作（止める・戻す）
   ══════════════════════════════════════════════ */

/**
 * 利用停止と、その解除。
 *
 * ★理由の入力を省かないこと。
 *   あとから記録を読む人が、いちばん知りたいのは理由です。
 *   「誰が」「いつ」は自動で残せますが、「なぜ」は本人しか書けません。
 *
 * ★押せない理由を、必ず文字で出すこと。
 *   ボタンが薄いだけだと、壊れているのか、
 *   自分の権限が足りないのかが分かりません。
 *
 * ★ここで「できるかどうか」を決めないこと。
 *   守りはサーバー（lib/server/customerAdmin.ts）にあります。
 *   この見た目は親切のためです。
 */
function Actions({
  c,
  canSuspend,
  busy,
  onRun,
}: {
  c: CustomerDetail;
  canSuspend: boolean;
  busy: boolean;
  onRun: (action: CustomerActionKind, customerId: string, reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  if (!canSuspend) {
    return (
      <span className="text-note leading-[1.9] text-slate3">
        いまの担当には、会員を停止する権限がありません。中身は見られます。
      </span>
    );
  }

  const tomeru = c.status !== "SUSPENDED";

  return (
    <div className="w-full space-y-3">
      <Field label="理由" required note="4文字以上。監査ログにそのまま残ります。">
        <textarea
          className={inputClass}
          rows={2}
          value={reason}
          placeholder={
            tomeru
              ? "例：同一端末からの大量購入のため、確認が終わるまで停止"
              : "例：本人確認が取れたため停止を解除"
          }
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>

      {tomeru ? (
        <>
          <p className="text-note leading-[1.85] text-slate3">
            止めると、この方は
            <strong className="font-bold text-slate2">
              その場でログアウトし、ガチャも発送依頼もできなくなります
            </strong>
            。誤検知は必ず起きます。永久停止ではありません。あとから解除できます。
          </p>
          <Btn
            kind="danger"
            disabled={busy || reason.trim().length < 4}
            onClick={() => onRun("suspend", c.id, reason)}
          >
            利用を停止する
          </Btn>
        </>
      ) : (
        <>
          <p className="text-note leading-[1.85] text-slate3">
            解除すると、この方はまたログインしてご利用いただけるようになります。
          </p>
          <Btn
            kind="primary"
            disabled={busy || reason.trim().length < 4}
            onClick={() => onRun("resume", c.id, reason)}
          >
            停止を解除する
          </Btn>
        </>
      )}

      {reason.trim().length < 4 && (
        <p className="text-note leading-[1.85] text-slate3">
          ★理由を4文字以上ご記入いただくと、押せるようになります。
        </p>
      )}
    </div>
  );
}
