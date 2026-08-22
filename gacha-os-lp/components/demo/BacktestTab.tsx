"use client";

import { useMemo } from "react";
import { jpy } from "@/lib/simulate";
import {
  backtestReport,
  overallEndgameVerdict,
  riskLabel,
  RUNS,
  THRESHOLD,
  verdictLabel,
  type RiskLevel,
  type ScenarioResult,
  type Verdict,
} from "@/lib/backtest";
import { demoBacktestSpec } from "@/content/demoData";

/**
 * 公開前バックテスト。
 *
 * ガチャを公開する前に、6通りの想定 × 当選順200通りで最後まで回し、
 * 「赤字になる確率」「悪い方の分布」まで含めて判定します。
 * 計算は lib/backtest.ts が実際に行っています（表示だけの見せかけではありません）。
 */

const TONE: Record<Verdict, { chip: string; text: string; bar: string; ring: string }> = {
  SAFE: {
    chip: "border-ok/40 bg-ok/[0.10] text-ok",
    text: "text-ok",
    bar: "bg-ok",
    ring: "border-ok/35",
  },
  CAUTION: {
    chip: "border-warn/40 bg-warn/[0.10] text-warn",
    text: "text-warn",
    bar: "bg-warn",
    ring: "border-warn/35",
  },
  DANGER: {
    chip: "border-danger/45 bg-danger/[0.12] text-danger",
    text: "text-danger",
    bar: "bg-danger",
    ring: "border-danger/40",
  },
};

const RISK_TONE: Record<RiskLevel, string> = {
  LOW: "border-ok/40 bg-ok/[0.10] text-ok",
  MEDIUM: "border-warn/40 bg-warn/[0.10] text-warn",
  HIGH: "border-danger/45 bg-danger/[0.12] text-danger",
};

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/** 粗利のように、マイナスがあり得る金額 */
function signed(n: number) {
  return `${n < 0 ? "−" : "+"}${jpy(Math.abs(n))}`;
}

export default function BacktestTab() {
  const spec = demoBacktestSpec;
  const report = useMemo(() => backtestReport(spec), [spec]);
  const results = report.scenarios;
  const overall = report.overall;
  const endgameOverall = overallEndgameVerdict(results);
  const t = TONE[overall];

  return (
    <div className="space-y-3">
      {/* ★入力が足りていないときは、判定そのものを出さない（SAFE FAIL） */}
      {!report.usable && (
        <div className="rounded-2xl border border-warn/40 bg-warn/[0.06] p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="num rounded-full border border-warn/45 bg-warn/[0.10] px-3 py-1 text-[10px] tracking-[0.16em] text-warn">
              UNKNOWN
            </span>
            <span className="num text-[10px] tracking-[0.2em] text-white/40">
              CANNOT JUDGE
            </span>
          </div>
          <p className="mt-4 text-[15px] font-bold leading-[1.7] text-ink sm:text-[17px]">
            この構成は、まだ判定できません。
          </p>
          <ul className="mt-3 space-y-2">
            {report.issues.map((i) => (
              <li key={i.code} className="flex gap-2.5 text-[11.5px] leading-[1.95] text-white/65">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                <span>{i.message}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10.5px] leading-[1.9] text-white/40">
            入力が終わっていないだけの構成に「このまま公開できます」とは表示しません。
            下の数字は参考値として出していますが、判定としては使わないでください。
          </p>
        </div>
      )}

      {/* 総合判定 */}
      <div className={`rounded-2xl border bg-white/[0.02] p-6 ${report.usable ? t.ring : "border-white/10 opacity-60"}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="num text-[10px] tracking-[0.2em] text-white/40">
            PRE-LAUNCH BACKTEST
          </span>
          <span className={`num rounded-full border px-3 py-1 text-[10px] tracking-[0.16em] ${report.usable ? t.chip : "border-white/20 bg-white/[0.04] text-white/45"}`}>
            {report.usable ? overall : "UNKNOWN"}
          </span>
          <span className="num ml-auto text-[9.5px] tracking-[0.1em] text-white/25">
            ENGINE v{report.engineVersion} ／ SEED {report.seed} ／ {report.runs}×6 SIM
          </span>
        </div>

        <p className="mt-4 text-[15px] font-bold leading-[1.7] text-ink sm:text-[18px]">
          {spec.name}：
          {report.usable ? verdictLabel[overall] : "判定できません（入力が足りていません）"}
        </p>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-4">
          <Stat label="設計時の還元率" value={`${report.designedRtp.toFixed(1)}%`} />
          <Stat
            label="公開可否（設計そのもの）"
            value={overall}
            tone={overall}
          />
          <Stat
            label="相場が上がって赤字に変わる線"
            value={report.stopLineUpPct === null ? "—" : `+${report.stopLineUpPct.toFixed(1)}%`}
            tone={report.stress === "DANGER" ? "CAUTION" : undefined}
          />
          <Stat
            label="終盤運営リスク"
            value={endgameOverall}
            tone={endgameOverall}
          />
        </div>

        <p className="mt-5 text-[11.5px] leading-[1.95] text-white/45">
          設計時の還元率が {report.designedRtp.toFixed(1)}% でも、当選の順番や相場の動きによって、
          販売中の「残っている景品 ÷ 残っている口数」で見た実還元率は変わります。
          各シナリオは当選順を {RUNS} 通り変えて回し、中央値だけでなく
          「何回が赤字になったか」まで見て判定しています。
          同じ設定と同じ SEED なら、何度実行しても同じ結果になります。
        </p>

        <p className="mt-3 text-[11.5px] leading-[1.95] text-white/45">
          結果は
          <span className="font-bold text-ink">【設計】</span>
          （この構成のまま公開してよいか）と
          <span className="font-bold text-ink">【運営】</span>
          （公開後に相場や売れ行きが動いたとき）に分けています。
          公開を止めるかどうかは【設計】だけで決めます。相場の高騰はどんな構成でも
          還元率を押し上げるため、これで止めると成立する構成まで全部止まってしまうからです。
          代わりに「相場が
          {report.stopLineUpPct === null ? "—" : `+${report.stopLineUpPct.toFixed(1)}%`}
          を超えたら手を打つ」という線を出し、運営中はそこを見張ります。
          <br />
          ★これは事前のシミュレーションであり、結果を保証するものではありません。
        </p>
      </div>

      {/* シナリオ別 */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/8 px-5 py-3.5">
          <span className="num text-[10px] tracking-[0.2em] text-white/45">
            SCENARIOS
          </span>
          <span className="text-[11px] text-white/35">
            6通りの想定 × 当選順 {RUNS} 通り
          </span>
        </div>

        <div className="divide-y divide-white/5">
          {results.map((r) => (
            <Row key={r.key} r={r} />
          ))}
        </div>
      </div>

      {/* 判定基準 */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="num text-[10px] tracking-[0.2em] text-white/35">判定の基準</p>

        <div className="mt-3.5 grid gap-2 sm:grid-cols-3">
          {[
            { v: "SAFE" as Verdict, d: `実還元率の中央値が ${THRESHOLD.caution}% 未満で、赤字になった回がほぼない` },
            {
              v: "CAUTION" as Verdict,
              d: `${THRESHOLD.caution}% 以上、赤字確率が ${pct(THRESHOLD.lossRateMedium)} 以上、または売れ残りが大きい`,
            },
            { v: "DANGER" as Verdict, d: `${THRESHOLD.danger}% 以上、中央値で赤字、または赤字確率が ${pct(THRESHOLD.lossRateForceDanger)} 以上` },
          ].map((x) => (
            <div
              key={x.v}
              className={`rounded-xl border px-4 py-3 ${TONE[x.v].ring}`}
            >
              <p className={`num text-[10.5px] tracking-[0.14em] ${TONE[x.v].text}`}>
                {x.v}
              </p>
              <p className="mt-1.5 text-[11px] leading-[1.8] text-white/50">{x.d}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-void/40 px-4 py-3">
            <p className="num text-[10px] tracking-[0.14em] text-white/45">
              NORMAL PHASE ／ 消化 0〜{THRESHOLD.judgeUntilSoldRatio * 100}%
            </p>
            <p className="mt-1.5 text-[11px] leading-[1.85] text-white/50">
              通常運営リスク。上の SAFE / CAUTION / DANGER はこの区間で判定します。
            </p>
          </div>
          <div className="rounded-xl border border-white/8 bg-void/40 px-4 py-3">
            <p className="num text-[10px] tracking-[0.14em] text-white/45">
              ENDGAME PHASE ／ 消化 {THRESHOLD.judgeUntilSoldRatio * 100}〜100%
            </p>
            <p className="mt-1.5 text-[11px] leading-[1.85] text-white/50">
              終盤運営リスク。どんな構成でも数字が跳ねるため、別の基準（
              {THRESHOLD.endgameCaution}% / {THRESHOLD.endgameDanger}%）で見ます。
            </p>
          </div>
        </div>

        <p className="mt-4 text-[11px] leading-[1.9] text-white/40">
          終盤は、上位賞が1本残っているだけで実還元率が必ず跳ね上がります。
          残り40口なら、その枠の売上は「口数 × 料金」しかないためです。
          これは構成の良し悪しではなく計算上そうなるものなので、通常運営とは分けて表示しています。
          売上・粗利・売れ残りは最後まで計算しています。
        </p>

        <p className="mt-3 text-[10.5px] leading-[1.9] text-white/30">
          これは複数の条件でのシミュレーションです。将来の結果を保証するものではありません。
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: Verdict;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-void/40 px-4 py-3">
      <p className="text-[10.5px] leading-tight text-white/40">{label}</p>
      <p
        className={`num mt-1.5 text-[15px] font-bold ${
          tone ? TONE[tone].text : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Row({ r }: { r: ScenarioResult }) {
  const t = TONE[r.verdict];
  const d = r.distribution;
  const eg = r.endgame;
  const egTone = TONE[eg.verdict];

  return (
    <div className="px-5 py-4">
      {/* 見出し行 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* ★このシナリオが公開を止める側か、運営で見張る側か */}
        <span
          className={`num nb rounded-full border px-2.5 py-1 text-[10px] tracking-[0.14em] ${
            r.kind === "design"
              ? "border-blue-bright/40 bg-blue-bright/[0.10] text-blue-bright"
              : "border-white/15 bg-white/[0.04] text-white/45"
          }`}
        >
          {r.kind === "design" ? "設計" : "運営"}
        </span>
        <span className="text-[13px] font-bold text-white/85">{r.label}</span>
        <span className={`num rounded-full border px-2.5 py-1 text-[10px] ${t.chip}`}>
          {r.verdict}
        </span>
        <span className={`num ml-auto text-[15px] font-bold ${t.text}`}>
          {r.peakRtp.toFixed(1)}%
        </span>
      </div>

      {/* 2軸の判定 */}
      <div className="num mt-2.5 flex flex-wrap items-center gap-2 text-[9.5px] tracking-[0.1em]">
        <span className="text-white/30">EXPECTED</span>
        <span className={`rounded border px-2 py-0.5 ${TONE[r.expected].chip}`}>
          {r.expected}
        </span>
        <span className="text-white/20">＋</span>
        <span className="text-white/30">TAIL RISK</span>
        <span className={`rounded border px-2 py-0.5 ${RISK_TONE[r.tailRisk]}`}>
          {r.tailRisk}（{riskLabel[r.tailRisk]}）
        </span>
        <span className="text-white/20">＝</span>
        <span className={`rounded border px-2 py-0.5 ${t.chip}`}>{r.verdict}</span>
      </div>

      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={`h-full rounded-full ${t.bar}`}
          style={{ width: `${Math.min(100, (r.peakRtp / 130) * 100)}%` }}
        />
      </div>

      <p className="mt-2.5 text-[11.5px] leading-[1.9] text-white/45">{r.premise}</p>
      <p className="mt-1 text-[11.5px] leading-[1.9] text-white/65">{r.reason}</p>

      {/* 200回の内訳 */}
      <div className="mt-3 rounded-xl border border-white/8 bg-void/40 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="num text-[9.5px] tracking-[0.14em] text-white/35">
            {d.runs} SIMULATIONS
          </span>
          {d.lossRate > 0 && (
            <span className="num text-[10px] font-bold text-danger">
              赤字確率 {pct(d.lossRate)}
            </span>
          )}
        </div>

        {/* 内訳バー */}
        <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full bg-ok" style={{ width: `${d.safeRate * 100}%` }} />
          <div className="h-full bg-warn" style={{ width: `${d.cautionRate * 100}%` }} />
          <div className="h-full bg-danger" style={{ width: `${d.dangerRate * 100}%` }} />
        </div>

        <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          <span className="text-ok">SAFE {pct(d.safeRate)}</span>
          <span className="text-warn">CAUTION {pct(d.cautionRate)}</span>
          <span className="text-danger">DANGER {pct(d.dangerRate)}</span>
        </div>

        <div className="num mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10.5px] sm:grid-cols-3">
          <Kv k="実還元率 中央値" v={`${d.rtpMedian.toFixed(1)}%`} />
          <Kv k="P90" v={`${d.rtpP90.toFixed(1)}%`} />
          <Kv k="P95" v={`${d.rtpP95.toFixed(1)}%`} />
          <Kv k="最悪値" v={`${d.rtpWorst.toFixed(1)}%`} warn />
          {d.profitVaries ? (
            <>
              <Kv k="粗利 中央値" v={signed(d.profitMedian)} warn={d.profitMedian < 0} />
              <Kv
                k="P95 Loss"
                v={signed(d.profitP95Loss)}
                warn={d.profitP95Loss < 0}
              />
              <Kv k="最悪の粗利" v={signed(d.profitWorst)} warn={d.profitWorst < 0} />
            </>
          ) : (
            <Kv k="粗利（当選順によらず一定）" v={signed(d.profitMedian)} warn={d.profitMedian < 0} />
          )}
        </div>

        {!d.profitVaries && (
          <p className="mt-2 text-[10px] leading-[1.8] text-white/30">
            この想定では最後まで売り切るため、出ていく景品は当選順に関係なく同じです。
            そのため粗利はばらつきません。ばらつくのは、販売中の実還元率と、その途中で止める判断のほうです。
          </p>
        )}
      </div>

      {/* 終盤 */}
      <div className={`mt-2 rounded-xl border bg-void/40 px-4 py-3 ${egTone.ring}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="num text-[9.5px] tracking-[0.14em] text-white/35">
            ENDGAME PHASE
          </span>
          <span className={`num rounded border px-2 py-0.5 text-[9.5px] ${egTone.chip}`}>
            {eg.verdict}
          </span>
          {eg.reached && (
            <span className="num ml-auto text-[10.5px] text-white/45">
              終盤の実還元率 中央値 {eg.rtpMedian.toFixed(0)}% ／ 最悪 {eg.rtpWorst.toFixed(0)}%
            </span>
          )}
        </div>

        <p className="mt-2 text-[11px] leading-[1.9] text-white/55">{eg.reason}</p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {eg.actions.map((a) => (
            <span
              key={a}
              className="rounded-full border border-white/12 bg-white/[0.03] px-2.5 py-1 text-[10px] text-white/55"
            >
              {a}
            </span>
          ))}
        </div>
        <p className="num mt-2 text-[9.5px] text-white/25">
          運営判断の候補です。自動では変更しません。
        </p>
      </div>

      {/* 金額（中央値の回） */}
      <div className="num mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-white/35">
        <span>最大到達：消化 {r.peakAtSoldPct.toFixed(0)}% 時点</span>
        <span>売上 {jpy(r.revenue)}</span>
        <span>出た景品 {jpy(r.payout)}</span>
        <span className={r.profit >= 0 ? "text-white/50" : "text-danger"}>
          粗利 {signed(r.profit)}
        </span>
        {r.leftoverValue > 0 && <span>売れ残り {jpy(r.leftoverValue)}</span>}
      </div>
    </div>
  );
}

function Kv({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className="text-white/30">{k}</span>
      <span className={warn ? "font-bold text-danger" : "text-white/70"}>{v}</span>
    </span>
  );
}
