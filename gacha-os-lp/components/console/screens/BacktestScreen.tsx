/**
 * 公開前バックテスト。
 *
 * ═══════════════════════════════════════════════
 * ★この画面がある理由
 * ═══════════════════════════════════════════════
 *
 *   オンラインガチャで赤字になるのは、たいてい
 *   「平均では合っていたが、たまたま悪い順番で出た」ときです。
 *   設計還元率が94%でも、S賞が序盤で出れば、その後は
 *   お客様が引くほど赤字が増えます。
 *
 *   平均だけを見て公開すると、これに気づけません。
 *   だから6つの状況について200回ずつ試して、
 *   「いちばん悪かったとき」を必ず一緒に出します。
 *
 * ★SAFE と出せない条件では、SAFE と出さないこと。
 *   景品を1本も登録していないガチャは、計算上は
 *   売上が丸ごと粗利になるので、数字としては安全に見えます。
 *   でもそれは「安全な構成」ではなく「入力が終わっていない」だけです。
 *   その場合は「判定できません」と出します（lib/backtest の usable）。
 *
 * ★同じ内容なら、いつ実行しても同じ結果になること。
 *   種（seed）を固定しています。押すたびに判定が変わる検証は、
 *   都合のよい結果が出るまで押されます。
 */

"use client";

import { useMemo, useState } from "react";
import type { ConsoleState } from "@/lib/console/state";
import { buildSpec } from "@/lib/console/spec";
import {
  backtestReport,
  riskLabel,
  verdictLabel,
  type ScenarioResult,
  type Verdict,
} from "@/lib/backtest";
import { Badge, Card, KV, RowCard, Rows, Stat, Table, Td, WhatIsThis } from "../ui";

const TONE: Record<Verdict, "ok" | "warn" | "danger"> = {
  SAFE: "ok",
  CAUTION: "warn",
  DANGER: "danger",
};

export default function BacktestScreen({ s }: { s: ConsoleState }) {
  const [gachaId, setGachaId] = useState(s.gachas[0]?.id ?? "");
  const g = s.gachas.find((x) => x.id === gachaId) ?? s.gachas[0];

  /* ★同じガチャなら、いつ押しても同じ結果になるように種を固定します */
  const report = useMemo(() => {
    if (!g) return null;
    const spec = buildSpec(g.title, g.price, g.total, 1, g.designedRtp || 95);
    return backtestReport(spec, 20260822, "2026-08-22 12:00");
  }, [g]);

  if (!g || !report) {
    return (
      <Card title="ガチャがありません">
        <p className="text-note text-slate3">先にガチャを作ってください。</p>
      </Card>
    );
  }

  return (
    <>
      <WhatIsThis>
        公開する前に、
        <strong className="font-bold text-slate">赤字になる条件を先に試します</strong>
        。6つの状況を200回ずつ動かし、いちばん悪かった結果に合わせて判定します。
      </WhatIsThis>

      <Card
        title="どのガチャを検証しますか"
        note="同じ内容なら、何度押しても同じ結果になります。"
      >
        <select
          className="w-full rounded-xl border border-silver bg-paper px-4 py-3 text-note text-slate outline-none focus:border-blue-ink focus:ring-4 focus:ring-blue-pale"
          value={gachaId}
          onChange={(e) => setGachaId(e.target.value)}
        >
          {s.gachas.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </select>
      </Card>

      {/* ── 結論 ── */}
      <Card title="結論" note="いちばん悪いシナリオに合わせています。">
        {!report.usable ? (
          <div className="rounded-xl border border-warn/35 bg-warn/10 px-4 py-4">
            <Badge tone="warn">判定できません</Badge>
            <ul className="mt-2 space-y-1">
              {report.issues.map((i) => (
                <li key={i.code} className="text-note leading-[1.9] text-warn-ink">
                  {i.message}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-note leading-[1.9] text-warn-ink/85">
              ★入力が足りていないので、「安全です」とは出しません。
            </p>
          </div>
        ) : (
          <>
            <div
              className={`rounded-xl border px-4 py-4 ${
                report.overall === "SAFE"
                  ? "border-ok/30 bg-ok/10"
                  : report.overall === "CAUTION"
                    ? "border-warn/35 bg-warn/10"
                    : "border-danger/30 bg-danger/10"
              }`}
            >
              <Badge tone={TONE[report.overall]}>
                {report.overall} ／ {verdictLabel[report.overall]}
              </Badge>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="設計還元率" value={`${report.designedRtp.toFixed(1)}%`} />
              <Stat
                label="赤字になる確率（最悪）"
                value={`${(report.maxLossRate * 100).toFixed(1)}%`}
                tone={report.maxLossRate >= 0.2 ? "danger" : report.maxLossRate >= 0.05 ? "warn" : "ok"}
              />
              <Stat label="試した回数" value={report.runs * report.scenarios.length} unit="回" />
              <Stat label="シナリオ数" value={report.scenarios.length} unit="通り" />
            </div>
          </>
        )}

        <p className="mt-4 text-note leading-[1.9] text-slate3">
          検証の版：{report.engineVersion} ／ 種：
          <span className="num">{report.seed}</span> ／ 実行：
          <span className="num">{report.ranAt}</span>
          <br />
          ★同じ内容・同じ種なら、必ず同じ結果になります。
          押すたびに判定が変わる検証は、都合のよい結果が出るまで押されてしまいます。
        </p>
      </Card>

      {/* ── 6つのシナリオ ── */}
      <Card title="6つの状況で試した結果" note="1つずつ、何を想定しているかを書いています。">
        <Table head={["状況", "何を想定しているか", "還元率（真ん中）", "還元率（最悪）", "赤字確率", "判定"]}>
          {report.scenarios.map((sc) => (
            <tr key={sc.key}>
              <Td className="font-bold text-slate">{sc.label}</Td>
              <Td className="max-w-[22rem]">{sc.premise}</Td>
              <Td className="num">{sc.distribution.rtpMedian.toFixed(1)}%</Td>
              <Td className="num">
                <span className={sc.distribution.rtpWorst >= 110 ? "font-bold text-danger-ink" : ""}>
                  {sc.distribution.rtpWorst.toFixed(1)}%
                </span>
              </Td>
              <Td className="num">{(sc.distribution.lossRate * 100).toFixed(1)}%</Td>
              <Td>
                <Badge tone={TONE[sc.verdict]}>{sc.verdict}</Badge>
              </Td>
            </tr>
          ))}
        </Table>

        <Rows>
          {report.scenarios.map((sc) => (
            <RowCard key={sc.key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-note font-bold text-slate">{sc.label}</span>
                <Badge tone={TONE[sc.verdict]}>{sc.verdict}</Badge>
              </div>
              <p className="mt-2 text-note leading-[1.85] text-slate2">{sc.premise}</p>
              <div className="mt-2 border-t border-edge pt-2">
                <KV k="還元率（真ん中）" v={<span className="num">{sc.distribution.rtpMedian.toFixed(1)}%</span>} />
                <KV k="還元率（最悪）" v={<span className="num">{sc.distribution.rtpWorst.toFixed(1)}%</span>} />
                <KV k="赤字確率" v={<span className="num">{(sc.distribution.lossRate * 100).toFixed(1)}%</span>} />
              </div>
              <p className="mt-2 text-note leading-[1.85] text-slate3">{sc.reason}</p>
            </RowCard>
          ))}
        </Rows>
      </Card>

      {/* ── 終盤だけを見る ── */}
      <Card
        title="終盤だけを見た場合"
        note="残り口数が少なくなってからが、いちばん危ないところです。"
      >
        <p className="text-note leading-[1.9] text-slate2">
          S賞が残ったまま口数が減ると、残りを引く人にとっては
          還元率が跳ね上がります。ここで「残りを買い占める」動きが起きると、
          その分がまるごと赤字になります。
        </p>
        <ul className="mt-4 space-y-3">
          {report.scenarios.map((sc) => (
            <Endgame key={sc.key} sc={sc} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function Endgame({ sc }: { sc: ScenarioResult }) {
  const e = sc.endgame;
  return (
    <li className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-note font-bold text-slate">{sc.label}</span>
        <span className="flex flex-wrap items-center gap-2">
          <Badge>テールリスク {riskLabel[sc.tailRisk]}</Badge>
          <Badge tone={TONE[e.verdict]}>{e.verdict}</Badge>
        </span>
      </div>
      {e.reached ? (
        <>
          <div className="mt-2 border-t border-edge pt-2">
            <KV k="終盤の還元率（最悪）" v={<span className="num">{e.rtpWorst.toFixed(1)}%</span>} />
            <KV k="残り口数" v={<span className="num">{e.tailSlots.toLocaleString()}口</span>} />
            <KV
              k="そこでS賞が残っている確率"
              v={<span className="num">{(e.topPrizeTailRate * 100).toFixed(1)}%</span>}
            />
          </div>
          <p className="mt-2 text-note leading-[1.85] text-slate3">{e.reason}</p>
          {e.actions.length > 0 && (
            <ul className="mt-2 space-y-1">
              {e.actions.map((a, i) => (
                <li key={i} className="text-note leading-[1.85] text-slate2">
                  ・{a}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-2 text-note leading-[1.85] text-slate3">{e.reason}</p>
      )}
    </li>
  );
}
