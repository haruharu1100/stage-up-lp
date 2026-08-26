/**
 * 還元率モニター。
 *
 * ═══════════════════════════════════════════════
 * ★この画面が生まれた理由（2026-08-26）
 * ═══════════════════════════════════════════════
 *
 *   公開環境の総点検で、こうなっていました。
 *
 *       画面の表示   88.0％
 *       実際の還元   18.23％
 *
 *   500回ぶんの記録は、最初から全部残っていました。
 *   足して割るだけで分かる話でした。
 *   それでも誰も気づけなかったのは、
 *   ★その数字を見る画面が、1つも無かったからです。
 *
 *   集めているのに見せていない数字は、無いのと同じです。
 *   だから、この画面を正式な機能にしました。
 *
 * ═══════════════════════════════════════════════
 * ★3種類を、絶対に混ぜないこと
 * ═══════════════════════════════════════════════
 *
 *     設計還元率  作ったときの予定値。「こう配るつもり」という約束
 *     残数還元率  いま残っている景品の価値 ÷ 残りの販売総額
 *     実績還元率  実際に売れた金額に対して、実際に返した価値
 *
 *   ★「実還元率」という呼び方をしないこと。
 *     どれのことか分からず、会議で必ず食い違います。
 *     以前この画面は「実還元率」と書いていましたが、
 *     中身は設計値の焼き直しで、実績ではありませんでした。
 *
 * ═══════════════════════════════════════════════
 * ★この画面で計算しないこと
 * ═══════════════════════════════════════════════
 *
 *   割り算はサーバー（lib/server/rtpMonitor.ts）で全部終わらせ、
 *   ここは受け取った数字を出すだけにします。
 *   画面で計算すると、画面ごとに違う答えが出ます。
 *
 * ★分からないときに 0％ と出さないこと。
 *   「まだ売れていない」は 0％ ではありません。UNKNOWN です。
 *   0％と出すと、運営の方は「1円も返していない」と読みます。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { RtpReport } from "@/lib/server/rtpMonitor";
import type { Rtp, RtpAlert } from "@/lib/console/rtp";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorBox,
  KV,
  RowCard,
  Rows,
  Skeleton,
  Stat,
  Table,
  Td,
  WhatIsThis,
} from "../ui";

/* ══════════════════════════════════════════════
   数字の出し方（ここだけ）
   ══════════════════════════════════════════════ */

/**
 * 還元率を、そのまま画面に出す。
 *
 * ★UNKNOWN のときに 0.0% と書かないこと。
 *   ここを1か所にまとめてあるので、
 *   画面のどこかで嘘の0％が出ることはありません。
 */
function Pct({
  r,
  strong = false,
  tone,
}: {
  r: Rtp;
  strong?: boolean;
  tone?: "ok" | "warn" | "danger";
}) {
  if (!r.known) {
    return (
      <span className="text-note font-bold text-slate3" title={r.reason}>
        UNKNOWN
      </span>
    );
  }
  const ink =
    tone === "danger"
      ? "text-danger-ink"
      : tone === "warn"
        ? "text-warn-ink"
        : tone === "ok"
          ? "text-ok-ink"
          : "";
  return (
    <span className={`num ${strong ? "font-bold" : ""} ${ink}`}>
      {r.percent.toFixed(1)}%
    </span>
  );
}

/** 危ないかどうかの印。色だけに頼らず、日本語も出す */
function LevelBadge({ a }: { a: RtpAlert }) {
  if (a.level === "DANGER") return <Badge tone="danger">危険</Badge>;
  if (a.level === "WARN") return <Badge tone="warn">注意</Badge>;
  if (a.level === "INFO") return <Badge tone="neutral">データ不足</Badge>;
  return <Badge tone="ok">問題なし</Badge>;
}

const yen = (n: number) => `${n.toLocaleString()}pt`;

/* ══════════════════════════════════════════════
   時系列グラフ
   ══════════════════════════════════════════════ */

/**
 * 還元率の移り変わりを、3本の線で出す。
 *
 * ★1回ごとの値ではなく「そこまでの累計」を出しています。
 *   1回ごとだと 0％ と 3000％ が交互に並ぶだけで、何も読み取れません。
 *   累計にすると、設計値へ寄っていくのか、離れていくのかが見えます。
 *
 * ★縦軸の上限を、勝手に切らないこと。
 *   100％で切ると、120％まで出ている異常が
 *   グラフの上端に貼りついて、正常に見えてしまいます。
 */
function Graph({ report }: { report: RtpReport }) {
  const pts = report.series;
  if (pts.length < 2) {
    return (
      <Empty
        why="グラフを描くには、抽選の記録がまだ足りません。"
        next="2回以上引かれると、移り変わりが見えるようになります。"
      />
    );
  }

  const W = 720;
  const H = 240;
  const PAD = { t: 16, r: 16, b: 28, l: 44 };

  const all: number[] = [];
  for (const p of pts) {
    if (p.actual !== null) all.push(p.actual);
    if (p.remaining !== null) all.push(p.remaining);
    if (p.designed !== null) all.push(p.designed);
  }
  const rawMax = all.length ? Math.max(...all) : 100;
  const yMax = Math.max(20, Math.ceil((rawMax * 1.1) / 10) * 10);

  const xOf = (i: number) =>
    PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r);
  const yOf = (v: number) =>
    PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);

  const line = (pick: (p: (typeof pts)[number]) => number | null) => {
    let d = "";
    let pen = false;
    pts.forEach((p, i) => {
      const v = pick(p);
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`還元率の移り変わり。実績・残数・設計の3本。最新の実績は${
          report.actual.known ? `${report.actual.percent}％` : "UNKNOWN"
        }です。`}
      >
        {grid.map((g) => (
          <g key={g}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={yOf(g)}
              y2={yOf(g)}
              stroke="currentColor"
              className="text-edge2"
              strokeWidth="1"
            />
            <text
              x={PAD.l - 6}
              y={yOf(g) + 4}
              textAnchor="end"
              className="fill-slate3 text-[10px]"
            >
              {g}%
            </text>
          </g>
        ))}

        {/* 設計（比較線。点線で薄く） */}
        <path
          d={line((p) => p.designed)}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
        {/* 残数 */}
        <path
          d={line((p) => p.remaining)}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth="2"
        />
        {/* 実績（いちばん大事なので、いちばん太く） */}
        <path
          d={line((p) => p.actual)}
          fill="none"
          stroke="#e11d48"
          strokeWidth="3"
        />

        <text
          x={PAD.l}
          y={H - 8}
          className="fill-slate3 text-[10px]"
        >
          {pts[0].plays}回目
        </text>
        <text
          x={W - PAD.r}
          y={H - 8}
          textAnchor="end"
          className="fill-slate3 text-[10px]"
        >
          {pts[pts.length - 1].plays}回目
        </text>
      </svg>

      <div className="mt-3 flex flex-wrap gap-4 text-note text-slate2">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-[3px] w-6 rounded bg-[#e11d48]" />
          実績還元率
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-[2px] w-6 rounded bg-[#0ea5e9]" />
          残数還元率
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-[2px] w-6 rounded bg-[#94a3b8]" />
          設計還元率
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   1本ぶんの詳細
   ══════════════════════════════════════════════ */

function Detail({ gachaId, onClose }: { gachaId: string; onClose: () => void }) {
  const [report, setReport] = useState<RtpReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setReport(null);
    setErr(null);
    fetch(`/api/console/rtp?gachaId=${encodeURIComponent(gachaId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; report?: RtpReport; message?: string }) => {
        if (!alive) return;
        if (!d.ok || !d.report) {
          setErr(d.message ?? "読み込めませんでした。");
          return;
        }
        setReport(d.report);
      })
      .catch(() => alive && setErr("読み込めませんでした。"));
    return () => {
      alive = false;
    };
  }, [gachaId]);

  if (err) return <ErrorBox what={err} code="RTP_DETAIL" />;
  if (!report) return <Skeleton rows={4} label="還元率を計算しています" />;

  const a = report.actual;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-note font-bold text-slate">{report.title}</p>
        <Btn onClick={onClose}>閉じる</Btn>
      </div>

      {/* ── 3種類 ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="設計還元率"
          value={report.designed.known ? `${report.designed.percent.toFixed(1)}%` : "UNKNOWN"}
          sub="作ったときの予定値です"
        />
        <Stat
          label="残数還元率"
          value={report.remaining.known ? `${report.remaining.percent.toFixed(1)}%` : "UNKNOWN"}
          tone={
            report.remaining.known && report.remaining.percent > 100
              ? "warn"
              : "normal"
          }
          sub="これから引く方にとっての期待値です"
        />
        <Stat
          label="実績還元率"
          value={a.known ? `${a.percent.toFixed(1)}%` : "UNKNOWN"}
          tone={
            report.worst.level === "DANGER"
              ? "danger"
              : report.worst.level === "WARN"
                ? "warn"
                : "normal"
          }
          sub={`${report.plays.toLocaleString()}プレイ時点`}
        />
      </div>

      {/* ── 計算の根拠 ──
          ★これを出さないと、人が検算できません。
            「88.02％」だけ見せられても、正しいか確かめようがありません。 */}
      <Card
        title="この数字の出しかた"
        note="表示している数字が正しいか、ここで確かめられます。"
      >
        {a.known ? (
          <>
            <KV k="販売額（分母）" v={<span className="num">{yen(a.denominator)}</span>} />
            <KV
              k="実際に返した価値（分子）"
              v={<span className="num">{yen(a.numerator)}</span>}
            />
            {a.breakdown && (
              <>
                <KV
                  k="　うち 現物としてお渡し"
                  v={<span className="num">{yen(a.breakdown.prizeValue)}</span>}
                />
                <KV
                  k="　うち ポイントでお返し"
                  v={<span className="num">{yen(a.breakdown.pointValue)}</span>}
                />
              </>
            )}
            <KV
              k="実績還元率"
              v={<span className="num font-bold text-slate">{a.percent.toFixed(2)}%</span>}
            />
            <KV k="サンプル数" v={<span className="num">{a.plays.toLocaleString()}回</span>} />
          </>
        ) : (
          <Empty why={`実績還元率：UNKNOWN（${a.reason}）`} />
        )}

        <div className="mt-4 border-t border-edge pt-4">
          <p className="text-note font-bold text-slate">抽選の記録との突き合わせ</p>
          <div className="mt-2">
            <KV
              k="ガチャの集計値（売上／お返し）"
              v={
                <span className="num">
                  {yen(report.ledger.revenue)} ／ {yen(report.ledger.paidValue)}
                </span>
              }
            />
            <KV
              k="抽選の記録から出した値"
              v={
                <span className="num">
                  {yen(report.ledger.revenueFromDraws)} ／ {yen(report.ledger.paidFromDraws)}
                </span>
              }
            />
          </div>
          {report.ledger.mismatch ? (
            <p className="mt-2 text-note leading-[1.9] text-danger-ink">
              ★食い違っています。{report.ledger.note}
              どちらが正しいかは、こちらでは決めません。記録をご確認ください。
            </p>
          ) : (
            <p className="mt-2 text-note leading-[1.9] text-slate3">
              2つの記録は一致しています。
            </p>
          )}
        </div>
      </Card>

      {/* ── 警告 ── */}
      <Card title="いまの判定" note="母数（引かれた回数）も見たうえで判断しています。">
        <ul className="space-y-3">
          {report.alerts.map((al, i) => (
            <li
              key={i}
              className={`rounded-xl border px-4 py-3 ${
                al.level === "DANGER"
                  ? "border-danger/30 bg-danger/8"
                  : al.level === "WARN"
                    ? "border-warn/35 bg-warn/10"
                    : "border-edge bg-paper2"
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <LevelBadge a={al} />
                <span className="text-note font-bold text-slate">{al.message}</span>
              </div>
              {al.advice && (
                <p className="mt-2 text-note leading-[1.9] text-slate2">{al.advice}</p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {/* ── グラフ ── */}
      <Card
        title="還元率の移り変わり"
        note="横軸は「何回目まで」、縦軸は還元率です。そこまでの累計で描いています。"
      >
        <Graph report={report} />
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export default function RtpScreen() {
  const [list, setList] = useState<RtpReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/console/rtp", { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        reports?: RtpReport[];
        message?: string;
      };
      if (!res.ok || !data.ok) {
        if (res.status === 403) {
          setErr("KENGEN");
          setList([]);
          return;
        }
        setErr(data.message ?? "還元率を読み込めませんでした。");
        setList([]);
        return;
      }
      setList(data.reports ?? []);
    } catch {
      setErr("還元率を読み込めませんでした。");
      setList([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ★ここで数を作らないこと。届いた中身をそのまま数えるだけ */
  const danger = (list ?? []).filter((r) => r.worst.level === "DANGER");
  const warn = (list ?? []).filter((r) => r.worst.level === "WARN");
  const unknown = (list ?? []).filter((r) => !r.actual.known);

  return (
    <>
      <WhatIsThis>
        <strong className="font-bold text-slate">設計どおりに還元できているか</strong>
        を、実際の抽選記録から確かめます。設計値を信じるのではなく、
        <strong className="font-bold text-slate">実際にいくら返したか</strong>
        を見ます。
      </WhatIsThis>

      {err === "KENGEN" ? (
        <Card title="還元率">
          <Empty
            why="いまの担当には、還元率を見る権限がありません。"
            next="運営または管理者にご連絡ください。"
          />
        </Card>
      ) : err ? (
        <ErrorBox what={err} code="RTP_LIST" onRetry={() => void load()} />
      ) : list === null ? (
        <Card title="還元率">
          <Skeleton rows={4} label="還元率を計算しています" />
        </Card>
      ) : (
        <>
          <Card
            title="いまの状態"
            note="危ないものが上に来ます。何もなければ、何もしなくて大丈夫です。"
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="ガチャ" value={list.length} unit="本" />
              <Stat
                label="危険"
                value={danger.length}
                unit="本"
                tone={danger.length > 0 ? "danger" : "ok"}
              />
              <Stat
                label="注意"
                value={warn.length}
                unit="本"
                tone={warn.length > 0 ? "warn" : "ok"}
              />
              <Stat
                label="まだ判断できない"
                value={unknown.length}
                unit="本"
                sub="売れた回数が足りないものです"
              />
            </div>
          </Card>

          {open && (
            <Card title="ガチャごとの詳しい中身">
              <Detail gachaId={open} onClose={() => setOpen(null)} />
            </Card>
          )}

          <Card
            title="ガチャごとの還元率"
            note="設計・残数・実績の3つを並べています。1つだけでは判断できません。"
          >
            {list.length === 0 ? (
              <Empty
                why="ガチャがまだ1本もありません。"
                next="ガチャを作ると、ここに還元率が出ます。"
              />
            ) : (
              <>
                <Table
                  head={[
                    "ガチャ",
                    "設計",
                    "残数",
                    "実績",
                    "サンプル数",
                    "判定",
                    "",
                  ]}
                >
                  {list.map((r) => (
                    <tr key={r.gachaId}>
                      <Td className="font-bold text-slate">{r.title}</Td>
                      <Td>
                        <Pct r={r.designed} />
                      </Td>
                      <Td>
                        <Pct
                          r={r.remaining}
                          tone={
                            r.remaining.known && r.remaining.percent > 100
                              ? "warn"
                              : undefined
                          }
                        />
                      </Td>
                      <Td>
                        <Pct
                          r={r.actual}
                          strong
                          tone={
                            r.worst.level === "DANGER"
                              ? "danger"
                              : r.worst.level === "WARN"
                                ? "warn"
                                : undefined
                          }
                        />
                      </Td>
                      <Td className="num whitespace-nowrap">
                        {r.plays.toLocaleString()}回
                      </Td>
                      <Td>
                        <LevelBadge a={r.worst} />
                      </Td>
                      <Td>
                        <Btn onClick={() => setOpen(r.gachaId)}>詳しく</Btn>
                      </Td>
                    </tr>
                  ))}
                </Table>

                <Rows>
                  {list.map((r) => (
                    <RowCard key={r.gachaId}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-note font-bold text-slate">{r.title}</span>
                        <LevelBadge a={r.worst} />
                      </div>
                      <div className="mt-2 border-t border-edge pt-2">
                        <KV k="設計還元率" v={<Pct r={r.designed} />} />
                        <KV k="残数還元率" v={<Pct r={r.remaining} />} />
                        <KV k="実績還元率" v={<Pct r={r.actual} strong />} />
                        <KV
                          k="サンプル数"
                          v={<span className="num">{r.plays.toLocaleString()}回</span>}
                        />
                      </div>
                      <p className="mt-2 text-note leading-[1.85] text-slate3">
                        {r.worst.message}
                      </p>
                      <div className="mt-3">
                        <Btn full onClick={() => setOpen(r.gachaId)}>
                          詳しく見る
                        </Btn>
                      </div>
                    </RowCard>
                  ))}
                </Rows>
              </>
            )}

            <div className="mt-5 space-y-2 rounded-xl border border-edge bg-paper2 px-4 py-4">
              <p className="text-note leading-[1.9] text-slate2">
                <strong className="font-bold text-slate">設計還元率</strong>
                … 作ったときに「こう配るつもり」と決めた予定値です。実績ではありません。
              </p>
              <p className="text-note leading-[1.9] text-slate2">
                <strong className="font-bold text-slate">残数還元率</strong>
                … いま箱に残っている景品の価値 ÷ 残りの販売総額です。
                100％を超えていると、ここから先は売るほど損が増えます。
              </p>
              <p className="text-note leading-[1.9] text-slate2">
                <strong className="font-bold text-slate">実績還元率</strong>
                … 実際に売れた金額に対して、実際にお返しした価値です。
                すでに起きたことなので、いちばん確かな数字です。
              </p>
              <p className="text-note leading-[1.9] text-slate3">
                ★引かれた回数が少ないうちは、たまたまの振れが大きいため、
                良し悪しの判断をしません（「データ不足」と出ます）。
              </p>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
