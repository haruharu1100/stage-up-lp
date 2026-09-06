/**
 * ガチャ管理。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面は、数えないこと
 * ═══════════════════════════════════════════════════════
 *
 *   還元率も、売上も、残り口数も、サーバー（lib/server/gachaAdmin.ts）が
 *   作った値をそのまま出すだけです。ここで足し算・割り算を書かないでください。
 *   書いた瞬間に、同じ数字を出す場所が2つになります。
 *
 *   2026-08-26、画面に 88.0％ と出ているのに、
 *   実際にお客様へ返っていたのは 18.23％ でした。
 *   数え方が散らばると、こうなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★還元率を、1つの言葉で呼ばないこと
 * ═══════════════════════════════════════════════════════
 *
 *       設計還元率 … 作ったときの予定
 *       残数還元率 … 残っている景品 ÷ 残っている口数
 *       実績還元率 … 実際に引かれた結果（お客様に返った額）
 *
 *   3つを「実還元率」とまとめて呼ぶと、
 *   どれを見て安心したのかが、誰にも分からなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★守りを、この画面に置かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ボタンを隠すのは、親切のためであって、守りではありません。
 *   「検証していないガチャは公開できない」を本当に守っているのは
 *   サーバーです。ここで先回りして判断すると、判断が2か所になり、
 *   いつか必ずずれます。ずれた側が緩ければ、事故になります。
 *
 * ★売上が null のとき、0円と書かないこと。
 *   null は「見せられません」です。0円は「1円も売れていない」です。
 *   経理でない人の画面に 0円 と出れば、その人は売れていないと報告します。
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import type { ConsoleState } from "@/lib/console/state";
import { can } from "@/lib/console/state";
import type { Rtp } from "@/lib/console/rtp";
import {
  EMPTY_FILTER,
  runGachaAction,
  useGachaDetail,
  useGachaList,
  type GachaActionKind,
  type GachaFilter,
  type GachaRow,
} from "@/lib/console/liveGachas";
import GachaCategoryPicker from "../GachaCategoryPicker";
import {
  COVER_SLOT,
  loadGachaImages,
  saveGachaImages,
  type ImagesView,
  type SlotView,
} from "@/lib/console/liveGachaImages";
import { uploadImage } from "@/lib/console/liveImages";
import type { MenuKey } from "../menu";
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
  Table,
  Td,
  Tr,
  WhatIsThis,
} from "../ui";

/* ══════════════════════════════════════════════
   出し方（ここだけ）
   ══════════════════════════════════════════════ */

const STATUS: Record<
  string,
  { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "blue" }
> = {
  DRAFT: { label: "下書き", tone: "neutral" },
  REVIEW: { label: "公開待ち", tone: "blue" },
  PUBLISHED: { label: "販売中", tone: "ok" },
  PAUSED: { label: "販売停止中", tone: "danger" },
  SOLD_OUT: { label: "完売", tone: "neutral" },
};

function StatusBadge({ status }: { status: string }) {
  /* ★知らない状態を「下書き」に丸めないこと。
       丸めると、DBに増えた新しい状態が画面から消えます */
  const s = STATUS[status];
  if (!s) return <Badge tone="neutral">{status}</Badge>;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/**
 * 還元率を、そのまま出す。
 *
 * ★出せないときに 0.0% と書かないこと。
 *   まだ1回も引かれていないガチャの「0％」は、
 *   還元していないという意味ではありません。分母が無いだけです。
 */
function Pct({ r, strong = false }: { r: Rtp; strong?: boolean }) {
  if (!r.known) {
    return (
      <span className="text-note text-slate3" title={r.reason}>
        —
      </span>
    );
  }
  return (
    <span className={`num ${strong ? "font-bold" : ""}`}>
      {r.percent.toFixed(1)}%
    </span>
  );
}

/** 警告の重さ。色だけに頼らず、日本語も出す */
function WorstBadge({ g }: { g: GachaRow }) {
  const w = g.worst.level;
  if (w === "DANGER") return <Badge tone="danger">危険</Badge>;
  if (w === "WARN") return <Badge tone="warn">注意</Badge>;
  if (w === "INFO") return <Badge tone="neutral">データ不足</Badge>;
  return <Badge tone="ok">問題なし</Badge>;
}

/**
 * 売上。
 * ★見せられない人には、金額の代わりに理由を出すこと。
 */
function Money({ v }: { v: number | null }) {
  if (v === null) {
    return (
      <span
        className="text-note text-slate3"
        title="売上を見る権限がありません。0円という意味ではありません。"
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

function PublishedAt({ g }: { g: GachaRow }) {
  if (g.publishedAt) {
    return <span className="num whitespace-nowrap">{nichiji(g.publishedAt)}</span>;
  }
  if (g.status === "PUBLISHED" || g.status === "PAUSED" || g.status === "SOLD_OUT") {
    /* ★作った日で埋めないこと。埋めた瞬間に、記録ではなく作り話になります */
    return (
      <span
        className="text-note text-slate3"
        title="この機能を入れる前に公開されたため、記録が残っていません。"
      >
        不明
      </span>
    );
  }
  return <span className="text-note text-slate3">—</span>;
}

/** 公開前検証の状態 */
function BacktestBadge({ g }: { g: GachaRow }) {
  if (!g.backtest.ran) {
    return (
      <Badge tone={g.backtest.reason === "SPEC_CHANGED" ? "warn" : "neutral"}>
        {g.backtest.reason === "SPEC_CHANGED" ? "検証のやり直しが必要" : "検証がまだ"}
      </Badge>
    );
  }
  const v = g.backtest.verdict;
  return (
    <Badge tone={v === "DANGER" ? "danger" : v === "CAUTION" ? "warn" : "ok"}>
      検証 {v}
    </Badge>
  );
}

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export default function GachaList({
  s,
  onNav,
}: {
  s: ConsoleState;
  onNav: (k: MenuKey) => void;
}) {
  const me = s.me!;
  const mayPublish = can(me.role, "gacha.publish");
  const mayEdit = can(me.role, "gacha.edit");

  const [filter, setFilter] = useState<GachaFilter>(EMPTY_FILTER);
  /* 入力のたびに読みにいくと、1文字ごとに通信します。
     押したときだけ反映します */
  const [qDraft, setQDraft] = useState("");

  const { state, reload } = useGachaList(filter);

  /**
   * いま開いている1件。
   *
   * ★件そのものを写して持たないこと。
   *   公開・停止を押した瞬間に、状態も還元率も変わります。
   *   写した値を持つと、板の中だけ古いまま残ります。
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useGachaDetail(openId);

  /** 操作したあとの知らせ（この画面の中だけ） */
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const afterAction = useCallback(
    (r: { ok: boolean; message: string }) => {
      setMsg({ ok: r.ok, text: r.message });
      /* ★成功したときだけ読み直す、にしないこと。
           断られた理由が「もう公開済み」のこともあります。
           そのときは、画面の方が古いので、読み直すのが正解です */
      reload();
      detail.reload();
    },
    [reload, detail],
  );

  const run = useCallback(
    async (action: GachaActionKind, gachaId: string, reason?: string) => {
      setBusy(true);
      const r = await runGachaAction({ action, gachaId, reason });
      setBusy(false);
      afterAction(r);
    },
    [afterAction],
  );

  const data = state.phase === "ok" ? state.data : null;
  const rows = data?.gachas ?? [];

  const paused = useMemo(() => rows.filter((g) => g.status === "PAUSED"), [rows]);
  const danger = useMemo(
    () => rows.filter((g) => g.status === "PUBLISHED" && g.worst.level === "DANGER"),
    [rows],
  );

  return (
    <>
      <WhatIsThis>
        ガチャを作り、検証し、公開し、必要なら止めます。
        <strong className="font-bold text-slate">検証を通していないガチャは公開できません。</strong>
        この画面の数字は、すべて登録されているガチャそのものから数えています。
      </WhatIsThis>

      {/* ── 還元率の呼び分け ── */}
      <div className="rounded-xl border border-blue-ink/25 bg-blue-pale/40 px-5 py-4">
        <p className="text-note leading-[1.9] text-slate2">
          <strong className="font-bold text-slate">還元率は、3種類あります。</strong>
          設計（作ったときの予定）・残数（残っている景品 ÷ 残っている口数）・
          実績（実際にお客様へ返った額）。
          <br />
          実績は、引かれた回数が少ないうちは「—」と出ます。
          10回しか引かれていないガチャの数字は、良し悪しの判断に使えないためです。
          くわしい移り変わりは
          <button
            type="button"
            className="mx-1 font-bold text-blue-ink underline underline-offset-4"
            onClick={() => onNav("rtp")}
          >
            実績還元率
          </button>
          の画面で見られます。
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
            出てこないガチャがあっても、画面には何も出ません。 */}
      <Card title="さがす" note="条件はサーバー側で絞り込みます。">
        <div className="grid gap-3 md:grid-cols-[1fr_12rem_auto]">
          <Field label="ガチャ名">
            <input
              className={inputClass}
              value={qDraft}
              placeholder="名前の一部でさがせます"
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
              <option value="DRAFT">下書き</option>
              <option value="REVIEW">公開待ち</option>
              <option value="PUBLISHED">販売中</option>
              <option value="PAUSED">販売停止中</option>
              <option value="SOLD_OUT">完売</option>
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
                setFilter(EMPTY_FILTER);
              }}
            >
              条件を消す
            </Btn>
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 text-note text-slate2">
          <input
            type="checkbox"
            checked={filter.onlyAlert}
            onChange={(e) => setFilter((f) => ({ ...f, onlyAlert: e.target.checked }))}
          />
          警告が出ているものだけ
        </label>
      </Card>

      {/* ── 読めていないとき ── */}
      {state.phase === "loading" && (
        <Card title="ガチャ一覧">
          <Skeleton rows={5} label="ガチャを読み込んでいます" />
        </Card>
      )}

      {state.phase === "ng" && (
        <ErrorBox what={state.why} code={state.code} onRetry={reload} />
      )}

      {data && (
        <>
          {/* ── 止まっているガチャ ── */}
          {paused.length > 0 && (
            <Card
              title="いま止まっているガチャ"
              note="システムが自動で止めたものも含みます。このまま売り続けると、1口ごとに赤字が増えます。"
            >
              <ul className="space-y-2">
                {paused.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-2.5"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Badge tone="danger">販売停止中</Badge>
                      <span className="text-note font-bold text-slate">{g.title}</span>
                      {/* ★止めた理由を、必ず一緒に出すこと。
                            「止まっている」だけでは、直し方が分かりません */}
                      <span className="text-note text-danger-ink">
                        {g.pauseReason ?? "理由の記録がありません"}
                      </span>
                    </span>
                    <Btn onClick={() => setOpenId(g.id)}>中身と操作を開く</Btn>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ── 出しすぎているガチャ ── */}
          {danger.length > 0 && (
            <Card
              title="出しすぎているガチャ"
              note="止まってはいませんが、放っておくと赤字になります。"
            >
              <ul className="space-y-3">
                {danger.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/35 bg-warn/8 px-4 py-3"
                  >
                    <span className="text-note leading-[1.9] text-slate2">
                      <strong className="font-bold text-slate">{g.title}</strong>
                      <br />
                      {g.worst.message}
                    </span>
                    <Btn onClick={() => setOpenId(g.id)}>中身と操作を開く</Btn>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ── 一覧 ── */}
          <Card
            title="ガチャ一覧"
            note={
              `${data.total}件` +
              (data.dangerCount > 0 ? ` ／ 危険 ${data.dangerCount}本` : "") +
              (data.warnCount > 0 ? ` ／ 注意 ${data.warnCount}本` : "") +
              (data.unverifiedCount > 0 ? ` ／ 検証がまだ ${data.unverifiedCount}本` : "")
            }
            right={
              mayEdit ? (
                <Btn kind="ghost" onClick={() => onNav("builder")}>
                  新しく作る
                </Btn>
              ) : undefined
            }
          >
            {rows.length === 0 ? (
              <Empty
                why={
                  filter.q || filter.status || filter.onlyAlert
                    ? "この条件に当てはまるガチャはありませんでした。"
                    : "まだガチャが1本も登録されていません。"
                }
                next={
                  filter.q || filter.status || filter.onlyAlert
                    ? "上の「条件を消す」を押すと、すべてのガチャが出ます。"
                    : mayEdit
                      ? "右上の「新しく作る」から、1本目を登録できます。"
                      : "登録は、運営の担当者にご依頼ください。"
                }
              />
            ) : (
              <>
                {/* ★操作ボタンを表の中に並べないこと。
                      1列足すだけで数字の列が押し潰されます。
                      しかも行そのものが押せるので、行を開くつもりで
                      「公開する」を押してしまう事故が起きます。 */}
                <Table
                  head={[
                    "ガチャ",
                    "状態",
                    "価格",
                    "総口数",
                    "残口数",
                    "売上",
                    "設計還元率",
                    "残数還元率",
                    "実績還元率",
                    "公開日時",
                    "警告",
                  ]}
                >
                  {rows.map((g) => (
                    <Tr
                      key={g.id}
                      onOpen={() => setOpenId(g.id)}
                      active={openId === g.id}
                      tone={
                        g.status === "PAUSED" || g.worst.level === "DANGER"
                          ? "danger"
                          : g.worst.level === "WARN"
                            ? "warn"
                            : undefined
                      }
                    >
                      <Td className="font-bold text-slate">{g.title}</Td>
                      <Td>
                        <StatusBadge status={g.status} />
                      </Td>
                      <Td className="num whitespace-nowrap">{g.price.toLocaleString()}円</Td>
                      <Td className="num whitespace-nowrap">{g.total.toLocaleString()}</Td>
                      <Td className="num whitespace-nowrap">{g.leftCount.toLocaleString()}</Td>
                      <Td>
                        <Money v={g.revenue} />
                      </Td>
                      <Td>
                        <Pct r={g.designed} />
                      </Td>
                      <Td>
                        <Pct r={g.remaining} />
                      </Td>
                      <Td>
                        <Pct r={g.actual} strong />
                      </Td>
                      <Td>
                        <PublishedAt g={g} />
                      </Td>
                      <Td>
                        <WorstBadge g={g} />
                      </Td>
                    </Tr>
                  ))}
                </Table>

                <Rows>
                  {rows.map((g) => (
                    <RowCard key={g.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-note font-bold text-slate">{g.title}</span>
                        <StatusBadge status={g.status} />
                      </div>
                      <div className="mt-2 border-t border-edge pt-2">
                        <KV k="価格" v={<span className="num">{g.price.toLocaleString()}円</span>} />
                        <KV
                          k="残口数"
                          v={
                            <span className="num">
                              {g.leftCount.toLocaleString()} / {g.total.toLocaleString()}
                            </span>
                          }
                        />
                        <KV k="売上" v={<Money v={g.revenue} />} />
                        <KV k="設計還元率" v={<Pct r={g.designed} />} />
                        <KV k="残数還元率" v={<Pct r={g.remaining} />} />
                        <KV k="実績還元率" v={<Pct r={g.actual} strong />} />
                        <KV k="公開日時" v={<PublishedAt g={g} />} />
                        <KV k="警告" v={<WorstBadge g={g} />} />
                      </div>
                      <div className="mt-3">
                        <Btn onClick={() => setOpenId(g.id)}>中身と操作を開く</Btn>
                      </div>
                    </RowCard>
                  ))}
                </Rows>
              </>
            )}

            {!data.canSeeRevenue && (
              <p className="mt-4 text-note leading-[1.9] text-slate3">
                ★売上の欄が「見せられません」になっています。
                いまの担当には、売上を見る権限がありません。0円という意味ではありません。
              </p>
            )}

            {!mayPublish && (
              <p className="mt-2 text-note leading-[1.9] text-slate3">
                ★いまの担当には、公開・停止の権限がありません。中身は見られます。
              </p>
            )}
          </Card>
        </>
      )}

      {/* ── 1件の中身と、操作 ── */}
      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={detail.state.phase === "ok" ? detail.state.gacha.title : "ガチャ"}
        note={
          detail.state.phase === "ok"
            ? `1回 ${detail.state.gacha.price.toLocaleString()}円`
            : undefined
        }
        foot={
          detail.state.phase === "ok" ? (
            <Actions
              g={detail.state.gacha}
              mayPublish={mayPublish}
              mayEdit={mayEdit}
              busy={busy}
              onRun={run}
            />
          ) : undefined
        }
      >
        {detail.state.phase === "loading" && <Skeleton rows={4} label="中身を読み込んでいます" />}
        {detail.state.phase === "ng" && (
          <ErrorBox
            what={detail.state.why}
            code={detail.state.code}
            onRetry={detail.reload}
          />
        )}
        {detail.state.phase === "ok" && (
          <GachaBody g={detail.state.gacha} onNav={onNav} mayEdit={mayEdit} />
        )}
      </Drawer>
    </>
  );
}

/* ══════════════════════════════════════════════
   板の中身
   ══════════════════════════════════════════════ */

function GachaBody({
  g,
  onNav,
  mayEdit,
}: {
  g: import("@/lib/console/liveGachas").GachaDetail;
  onNav: (k: MenuKey) => void;
  mayEdit: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={g.status} />
        <BacktestBadge g={g} />
        <WorstBadge g={g} />
      </div>

      {/* ★検証がいつのものかを出すこと。
            「検証 SAFE」だけだと、半年前の検証でも通ったように見えます */}
      {g.backtest.ran ? (
        <p className="text-note leading-[1.9] text-slate3">
          {nichiji(g.backtest.at)} に検証（{g.backtest.engine} ／ 種 {g.backtest.seed}）。
          運営時の判定は {g.backtest.stress} です。
          {!g.backtest.current && (
            <strong className="font-bold text-warn-ink">
              　検証したあとに構成が変わっています。公開の前にやり直してください。
            </strong>
          )}
        </p>
      ) : (
        <p className="text-note leading-[1.9] text-slate3">{g.backtest.message}</p>
      )}

      <div className="rounded-xl border border-edge bg-paper2 px-4 py-3">
        <KV
          k="残り口数"
          v={
            <span className="num">
              {g.leftCount.toLocaleString()} / {g.total.toLocaleString()}
            </span>
          }
        />
        <KV k="売上" v={<Money v={g.revenue} />} />
        <KV k="設計還元率" v={<Pct r={g.designed} />} />
        <KV k="残数還元率" v={<Pct r={g.remaining} />} />
        <KV k="実績還元率" v={<Pct r={g.actual} strong />} />
        {/* ★実績は、必ず回数と一緒に出すこと。
              回数を書かないと、3回ぶんの数字が
              1万回ぶんと同じ重さで読まれます */}
        <KV k="引かれた回数" v={<span className="num">{g.plays.toLocaleString()}回</span>} />
        <KV k="公開日時" v={<PublishedAt g={g} />} />
        {g.pausedAt && <KV k="停止日時" v={<span className="num">{nichiji(g.pausedAt)}</span>} />}
        {g.pauseReason && <KV k="停止の理由" v={g.pauseReason} />}
      </div>

      {/* ★台帳と抽選の記録が食い違っていたら、黙って出さないこと */}
      {g.ledgerMismatch && (
        <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-note leading-[1.9] text-danger-ink">
          <strong className="font-bold">数字が食い違っています。</strong>
          <br />
          {g.ledger.note}
        </div>
      )}

      {/* ── 警告の中身 ── */}
      {g.alerts.length > 0 && (
        <ul className="space-y-2">
          {g.alerts.map((a, i) => (
            <li
              key={i}
              className={`rounded-xl border px-4 py-3 text-note leading-[1.9] ${
                a.level === "DANGER"
                  ? "border-danger/30 bg-danger/8 text-danger-ink"
                  : a.level === "WARN"
                    ? "border-warn/35 bg-warn/8 text-warn-ink"
                    : "border-edge bg-paper2 text-slate2"
              }`}
            >
              {a.message}
            </li>
          ))}
        </ul>
      )}

      {/* ── 景品の残り ── */}
      <div>
        <h3 className="text-note font-bold text-slate2">景品の残り</h3>
        {g.stock.length === 0 ? (
          <div className="mt-2">
            <Empty
              why="景品がまだ1本も登録されていません。"
              next="景品を入れないと、検証も公開もできません。「新しく作る」から登録してください。"
            />
          </div>
        ) : (
          <div className="mt-2 overflow-hidden rounded-xl border border-edge">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-edge bg-paper2">
                  {["等級", "景品", "価値", "残り"].map((h) => (
                    <th key={h} className="px-3 py-2 text-note font-bold text-slate3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.stock.map((st, i) => (
                  <tr key={i} className="border-b border-edge2 last:border-0">
                    <td className="px-3 py-2 text-note font-bold text-slate">{st.grade}</td>
                    <td className="px-3 py-2 text-note text-slate2">{st.name}</td>
                    <td className="num px-3 py-2 text-note text-slate2">
                      {st.value.toLocaleString()}円
                    </td>
                    <td className="num px-3 py-2 text-note text-slate2">
                      {st.left.toLocaleString()} / {st.total.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── どの棚に置くか ──
            ★棚の名前をここに書かないこと。お店が作ったものだけを出します */}
      <GachaCategoryPicker gachaId={g.id} mayEdit={mayEdit} />

      {/* ── 写真の差し替え ──
            ★販売中でも触れます。止めてから替える運用にすると、
              写真1枚のために毎回売り場が落ちます。 */}
      <ImagePanel gachaId={g.id} mayEdit={mayEdit} />

      <div className="flex flex-wrap gap-2">
        <Btn onClick={() => onNav("rtp")}>実績還元率を見る</Btn>
        <Btn onClick={() => onNav("market")}>相場を見る</Btn>
        <Btn onClick={() => onNav("preview")}>お客様の画面で見る</Btn>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════
   写真の差し替え
   ══════════════════════════════════════════════ */

/**
 * 表紙と、賞ごとの写真を差し替える。
 *
 * ═══════════════════════════════════════════════════════
 * ★「保存」を押すまで、売り場は変わらないこと
 * ═══════════════════════════════════════════════════════
 *
 *   選んだ瞬間に反映すると、間違えた1枚がそのまま
 *   お客様に見えます。取り消しもできません。
 *   ですので、選んだ写真は画面の中だけに置き、
 *   保存を押したときにまとめて送ります。
 *
 * ★変えたところだけを送ること。
 *   全部を毎回送ると、読み込みが1回こけただけで
 *   「全部を空で上書き」になります。写真が全消えします。
 *
 * ★すでに引かれている賞には、必ず注意書きを出すこと。
 *   出さないと「当てた人の履歴も差し替わった」と誤解されます。
 *   実際には当選時点の写真のまま変わりません（018）。
 */
function ImagePanel({ gachaId, mayEdit }: { gachaId: string; mayEdit: boolean }) {
  const [view, setView] = useState<ImagesView | null>(null);
  const [yomi, setYomi] = useState<"yet" | "loading" | "ok" | "ng">("yet");
  const [yomiNg, setYomiNg] = useState("");

  /* 選んだだけで、まだ送っていない写真。ここが「保存前プレビュー」 */
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [reason, setReason] = useState("");
  const [okuri, setOkuri] = useState(false);
  const [shirase, setShirase] = useState<{ ok: boolean; text: string } | null>(null);

  const yomu = useCallback(async () => {
    setYomi("loading");
    const r = await loadGachaImages(gachaId);
    if (!r.ok) {
      setYomi("ng");
      setYomiNg(r.message);
      return;
    }
    setView(r.view);
    setDraft({});
    setYomi("ok");
  }, [gachaId]);

  const kawatta = Object.keys(draft).length;

  const hozon = async () => {
    setOkuri(true);
    setShirase(null);
    const r = await saveGachaImages({ gachaId, slots: draft, reason });
    setOkuri(false);
    if (!r.ok) {
      setShirase({ ok: false, text: r.message });
      return;
    }
    setShirase({ ok: true, text: `${r.changed.length}か所を差し替えました。${r.note}` });
    setReason("");
    await yomu();
  };

  if (yomi === "yet") {
    return (
      <div>
        <h3 className="text-note font-bold text-slate2">商品の写真</h3>
        <p className="mt-1 text-note leading-[1.9] text-slate3">
          販売中でも差し替えられます。すでに当選している方の履歴の写真は、
          当選した時点のまま変わりません。
        </p>
        <div className="mt-2">
          <Btn onClick={() => void yomu()}>いまの写真を見る</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-note font-bold text-slate2">商品の写真</h3>

      {yomi === "loading" && (
        <div className="mt-2">
          <Skeleton rows={3} label="写真を読み込んでいます" />
        </div>
      )}

      {yomi === "ng" && (
        <div className="mt-2">
          <ErrorBox what={yomiNg} onRetry={() => void yomu()} />
        </div>
      )}

      {yomi === "ok" && view && (
        <>
          <div className="mt-2 space-y-2">
            {view.slots.map((s) => {
              /* 選び直していれば、そちらを出す（保存前プレビュー） */
              const erabu = s.slot in draft ? draft[s.slot] : s.imageId;
              const kaeta = s.slot in draft;
              return (
                <PhotoSlot
                  key={s.slot}
                  slot={s}
                  imageId={erabu}
                  changed={kaeta}
                  mayEdit={mayEdit}
                  onPick={(id) =>
                    setDraft((d) => {
                      /* 元に戻したなら、送る対象から外す */
                      if (id === s.imageId) {
                        const n = { ...d };
                        delete n[s.slot];
                        return n;
                      }
                      return { ...d, [s.slot]: id };
                    })
                  }
                />
              );
            })}
          </div>

          {mayEdit && (
            <div className="mt-3 space-y-3 rounded-xl border border-edge bg-paper2 px-4 py-3">
              <p className="text-note leading-[1.9] text-slate3">
                {kawatta === 0
                  ? "まだ何も変えていません。写真を選ぶと、ここに保存ボタンが出ます。"
                  : `${kawatta}か所を変えようとしています。保存を押すまで、売り場は変わりません。`}
              </p>

              {kawatta > 0 && (
                <>
                  <Field
                    label="差し替える理由"
                    required
                    note="4文字以上。監査ログにそのまま残ります。"
                  >
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={reason}
                      placeholder="例：現物の写真に撮り直したため／背景に値札が写っていたため"
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>

                  <div className="flex flex-wrap gap-2">
                    <Btn
                      kind="primary"
                      disabled={okuri || reason.trim().length < 4}
                      onClick={() => void hozon()}
                    >
                      {okuri ? "保存しています…" : "この内容で保存する"}
                    </Btn>
                    <Btn kind="ghost" disabled={okuri} onClick={() => setDraft({})}>
                      選び直しをやめる
                    </Btn>
                  </div>
                </>
              )}
            </div>
          )}

          {!mayEdit && (
            <p className="mt-2 text-note leading-[1.9] text-slate3">
              いまの担当には、写真を差し替える権限がありません。中身は見られます。
            </p>
          )}

          {shirase && (
            <p
              className={`mt-2 rounded-xl border px-4 py-3 text-note leading-[1.9] ${
                shirase.ok
                  ? "border-ok/30 bg-ok/8 text-ok-ink"
                  : "border-warn/35 bg-warn/10 text-warn-ink"
              }`}
            >
              {shirase.text}
            </p>
          )}

          {view.history.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-note font-bold text-slate2">
                差し替えの履歴（{view.history.length}件）
              </summary>
              <ul className="mt-2 space-y-1">
                {view.history.map((h) => (
                  <li key={h.id} className="text-label leading-[1.85] text-slate3">
                    <span className="num">{nichiji(h.at)}</span>
                    {h.slot === COVER_SLOT ? "表紙" : `${h.slot}賞`}
                    {h.kind === "REMOVE" ? "写真を外した" : "差し替え"}
                    {h.byName ?? "担当者不明"}
                    {h.reason ? `　理由：${h.reason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/** 1か所ぶんの枠。写真の預け入れは Builder と同じ入口を使う */
function PhotoSlot({
  slot,
  imageId,
  changed,
  mayEdit,
  onPick,
}: {
  slot: SlotView;
  imageId: string | null;
  changed: boolean;
  mayEdit: boolean;
  onPick: (id: string | null) => void;
}) {
  const [okurichuu, setOkurichuu] = useState(false);
  const [kotowari, setKotowari] = useState<string | null>(null);

  const erabu = async (f: File | null) => {
    if (!f) return;
    setOkurichuu(true);
    setKotowari(null);
    const r = await uploadImage(f, slot.slot === COVER_SLOT ? "GACHA_COVER" : "PRIZE");
    setOkurichuu(false);
    /* ★弾かれたときに、いま選んでいる写真を消さないこと */
    if (!r.ok) {
      setKotowari(r.message);
      return;
    }
    onPick(r.imageId);
  };

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        changed ? "border-blue-400 bg-blue-50/60" : "border-edge2 bg-paper2"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        {imageId ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/images/${imageId}`}
            alt={slot.label}
            className="h-16 w-16 shrink-0 rounded-lg border border-edge object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-edge bg-slate-100 text-center text-[0.65rem] font-medium text-slate-500">
            画像未登録
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-note font-bold text-slate">
            {slot.label}
            {changed && (
              <span className="ml-2 text-label font-medium text-blue-700">
                （保存前・まだ売り場は変わっていません）
              </span>
            )}
          </p>

          {/* ★すでに引かれた賞は、必ずここで断っておくこと */}
          {slot.drawn > 0 && (
            <p className="mt-0.5 text-label leading-[1.8] text-slate3">
              この賞は、すでに {slot.drawn.toLocaleString()} 本出ています。
              差し替えても、当てた方の履歴の写真は当選した時点のまま変わりません。
            </p>
          )}

          {mayEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-edge bg-white px-3 py-1.5 text-label font-medium text-slate2 hover:bg-paper2">
                {okurichuu ? "送っています…" : imageId ? "写真を差し替える" : "写真を選ぶ"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={okurichuu}
                  onChange={(e) => {
                    void erabu(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
              </label>
              {imageId && (
                <Btn kind="ghost" onClick={() => onPick(null)}>
                  写真を外す
                </Btn>
              )}
            </div>
          )}
        </div>
      </div>

      {kotowari && (
        <p className="mt-2 rounded-lg border border-warn/35 bg-warn/10 px-3 py-2 text-label leading-[1.85] text-warn-ink">
          {kotowari}
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   操作
   ══════════════════════════════════════════════ */

/**
 * 検証・公開・停止・再開。
 *
 * ★理由の入力を省かないこと。
 *   あとから記録を読む人が、いちばん知りたいのは理由です。
 *   「誰が」「いつ」は自動で残せますが、「なぜ」は本人しか書けません。
 *
 * ★押せない理由を、必ず文字で出すこと。
 *   ボタンが薄いだけだと、壊れているのか、
 *   自分の権限が足りないのかが分かりません。
 */
function Actions({
  g,
  mayPublish,
  mayEdit,
  busy,
  onRun,
}: {
  g: import("@/lib/console/liveGachas").GachaDetail;
  mayPublish: boolean;
  mayEdit: boolean;
  busy: boolean;
  onRun: (action: GachaActionKind, gachaId: string, reason?: string) => void;
}) {
  const [reason, setReason] = useState("");

  if (!mayPublish && !mayEdit) {
    return (
      <span className="text-note text-slate3">
        いまの担当には、この操作の権限がありません。
      </span>
    );
  }

  const canPublish = g.status === "DRAFT" || g.status === "REVIEW";
  const canPause = g.status === "PUBLISHED";
  const canResume = g.status === "PAUSED";

  return (
    <div className="w-full space-y-3">
      {mayEdit && (
        <Btn
          kind={g.backtest.ran ? "ghost" : "primary"}
          disabled={busy}
          onClick={() => onRun("verify", g.id)}
        >
          {g.backtest.ran ? "検証をやり直す" : "検証を実行する"}
        </Btn>
      )}

      {mayPublish && (canPublish || canPause || canResume) && (
        <>
          <Field label="理由" required note="4文字以上。監査ログにそのまま残ります。">
            <textarea
              className={inputClass}
              rows={2}
              value={reason}
              placeholder="例：検証SAFEのため公開／残数還元率が高いため停止"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            {canPublish && (
              <Btn
                kind="primary"
                disabled={busy || reason.trim().length < 4}
                onClick={() => onRun("publish", g.id, reason)}
              >
                公開する
              </Btn>
            )}
            {canPause && (
              <Btn
                kind="danger"
                disabled={busy || reason.trim().length < 4}
                onClick={() => onRun("pause", g.id, reason)}
              >
                販売を止める
              </Btn>
            )}
            {canResume && (
              <Btn
                kind="primary"
                disabled={busy || reason.trim().length < 4}
                onClick={() => onRun("resume", g.id, reason)}
              >
                販売を再開する
              </Btn>
            )}
          </div>
        </>
      )}

      {/* ★「なぜ今それができないのか」を書くこと */}
      {mayPublish && !canPublish && !canPause && !canResume && (
        <p className="text-note leading-[1.9] text-slate3">
          {g.status === "SOLD_OUT"
            ? "完売しています。売り切れたガチャは、公開も停止もできません。"
            : "いまの状態では、公開・停止・再開のどれもできません。"}
        </p>
      )}
      {!mayPublish && (
        <p className="text-note leading-[1.9] text-slate3">
          公開・停止・再開の権限がありません。検証だけ実行できます。
        </p>
      )}
    </div>
  );
}
