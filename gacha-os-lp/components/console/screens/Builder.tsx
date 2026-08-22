/**
 * AI ガチャ作成（AI GACHA BUILDER）。
 *
 * ═══════════════════════════════════════════════
 * ★この画面の考え方
 * ═══════════════════════════════════════════════
 *
 *   ガチャを作るとき、いちばん時間がかかるのは
 *   「賞の数と値段を、還元率が合うように決め直す作業」です。
 *   S賞を1つ強くすると、下の賞を全部いじり直すことになります。
 *   これを電卓でやっていると、1本作るのに何時間もかかります。
 *
 *   ここでは、日本語で条件を書くと、たたき台が出ます。
 *   出たものに「S賞をもう少し強く」と足すと、全体を組み直します。
 *
 * ★出た案を、そのまま公開できるようにしないこと。
 *   この画面から直接「公開」はできません。
 *   必ずバックテストを通してから、ガチャ管理で公開します。
 *   人が考えたものでもAIが出したものでも、検証を飛ばさせません。
 *
 * ★このデモでは、案はブラウザの中の計算で作っています。
 *   外部のAIには接続していません（完全Sandboxのため）。
 *   組み立ての手順と、出てくる数字の性質は本番と同じにしてあります。
 */

"use client";

import { useMemo, useState } from "react";
import { backtestReport, designedRtp, verdictLabel, type GachaSpec } from "@/lib/backtest";
import { STRENGTH_LABEL, buildSpec, type Strength } from "@/lib/console/spec";
import { Badge, Btn, Card, DemoNote, Field, KV, RowCard, Rows, Table, Td, WhatIsThis, inputClass } from "../ui";

/** 「500円・1000口で」のような文から、数字を拾う */
function readPrompt(text: string): { price?: number; total?: number; strength?: Strength } {
  const price = text.match(/(\d[\d,]*)\s*円/);
  const total = text.match(/(\d[\d,]*)\s*口/);
  const num = (m: RegExpMatchArray | null) =>
    m ? Number(m[1].replace(/,/g, "")) : undefined;

  let strength: Strength | undefined;
  if (/(S賞|大当たり|上|1等).*(強|厚|大き|派手)/.test(text)) strength = 2;
  if (/(安全|堅|控えめ|抑え)/.test(text)) strength = 0;

  return { price: num(price), total: num(total), strength };
}

const PRESETS = [
  "500円・1000口で、人気カード中心。S賞を強めに。",
  "1000円・500口で、スニーカー中心。堅めに。",
  "300円・2000口で、週末限定。気軽に引ける構成。",
];

export default function Builder() {
  const [text, setText] = useState(PRESETS[0]);
  const [spec, setSpec] = useState<GachaSpec | null>(null);
  const [price, setPrice] = useState(500);
  const [total, setTotal] = useState(1000);
  const [strength, setStrength] = useState<Strength>(1);
  const [target, setTarget] = useState(95);
  const [log, setLog] = useState<string[]>([]);

  const generate = (nextStrength = strength, nextTarget = target, note?: string) => {
    const read = readPrompt(text);
    const p = read.price ?? price;
    const t = read.total ?? total;
    const st = note ? nextStrength : (read.strength ?? nextStrength);
    setPrice(p);
    setTotal(t);
    setStrength(st);
    setTarget(nextTarget);
    setSpec(buildSpec("AIが組んだ案", p, t, st, nextTarget));
    setLog((prev) => [
      ...prev,
      note ?? `「${text}」から、${p.toLocaleString()}円 × ${t.toLocaleString()}口 で組みました。`,
    ]);
  };

  /* 出た案を、その場で検証にかける。判定を見ないまま次へ進ませない */
  const report = useMemo(() => (spec ? backtestReport(spec, 20260822, "2026-08-22 12:00") : null), [spec]);

  return (
    <>
      <WhatIsThis>
        日本語で条件を書くと、賞の数と値段のたたき台が出ます。
        出た案は<strong className="font-bold text-slate">その場で検証にかけます</strong>。
        この画面から直接は公開できません。
      </WhatIsThis>

      {/* ── 条件を書く ── */}
      <Card title="どんなガチャを作りますか" note="値段と口数は、文の中に書いても拾います。">
        <div className="space-y-4">
          <Field label="条件" note="例）500円・1000口で、人気カード中心。S賞を強めに。">
            <textarea
              className={`${inputClass} min-h-[5rem]`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Btn key={p} kind="ghost" onClick={() => setText(p)}>
                {p.slice(0, 14)}…
              </Btn>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="1回の値段">
              <input
                className={`${inputClass} num`}
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value.replace(/\D/g, "")) || 0)}
              />
            </Field>
            <Field label="口数">
              <input
                className={`${inputClass} num`}
                inputMode="numeric"
                value={total}
                onChange={(e) => setTotal(Number(e.target.value.replace(/\D/g, "")) || 0)}
              />
            </Field>
            <Field label="目標の還元率" note="景品にいくら回すか。90〜97%が一般的です。">
              <select
                className={inputClass}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
              >
                {[90, 92, 94, 95, 96, 97].map((v) => (
                  <option key={v} value={v}>
                    {v}%
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Btn kind="primary" onClick={() => generate()}>
            案を作る
          </Btn>
        </div>
      </Card>

      {/* ── 出た案 ── */}
      {spec && report && (
        <>
          <Card
            title="AIが組んだ案"
            note={`${price.toLocaleString()}円 × ${total.toLocaleString()}口 ／ S賞は「${STRENGTH_LABEL[strength]}」`}
            right={<Badge tone="blue">設計還元率 {designedRtp(spec).toFixed(1)}%</Badge>}
          >
            <Table head={["賞", "本数", "1本あたりの価値", "この賞に回す金額"]}>
              {spec.prizes.map((p) => (
                <tr key={p.grade}>
                  <Td className="font-bold text-slate">{p.grade}賞</Td>
                  <Td className="num">{p.count.toLocaleString()}本</Td>
                  <Td className="num">{p.value.toLocaleString()}円</Td>
                  <Td className="num">{(p.value * p.count).toLocaleString()}円</Td>
                </tr>
              ))}
            </Table>

            <Rows>
              {spec.prizes.map((p) => (
                <RowCard key={p.grade}>
                  <p className="text-note font-bold text-slate">{p.grade}賞</p>
                  <div className="mt-2 border-t border-edge pt-2">
                    <KV k="本数" v={<span className="num">{p.count.toLocaleString()}本</span>} />
                    <KV k="1本あたり" v={<span className="num">{p.value.toLocaleString()}円</span>} />
                    <KV k="合計" v={<span className="num">{(p.value * p.count).toLocaleString()}円</span>} />
                  </div>
                </RowCard>
              ))}
            </Rows>

            <div className="mt-5 border-t border-edge2 pt-4">
              <p className="text-note font-bold text-slate2">案を直す</p>
              <p className="mt-1 text-note leading-[1.85] text-slate3">
                押すと、全体を組み直します。1つの賞だけ変えて還元率がずれる、が起きません。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn
                  onClick={() =>
                    generate(Math.min(2, strength + 1) as Strength, target, "S賞をもう少し強くして、組み直しました。")
                  }
                  disabled={strength === 2}
                >
                  S賞をもう少し強く
                </Btn>
                <Btn
                  onClick={() =>
                    generate(Math.max(0, strength - 1) as Strength, target, "S賞を控えめにして、組み直しました。")
                  }
                  disabled={strength === 0}
                >
                  S賞を控えめに
                </Btn>
                <Btn
                  onClick={() => generate(strength, Math.max(90, target - 2), "景品に回す割合を下げて、組み直しました。")}
                  disabled={target <= 90}
                >
                  もう少し利益を残す
                </Btn>
                <Btn
                  onClick={() => generate(strength, Math.min(97, target + 2), "景品に回す割合を上げて、組み直しました。")}
                  disabled={target >= 97}
                >
                  もう少しお得に見せる
                </Btn>
              </div>
            </div>
          </Card>

          {/* ── その場で検証 ── */}
          <Card
            title="この案の検証結果"
            note="6つの状況で200回ずつ試し、いちばん悪い結果に合わせて判定しています。"
          >
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
                  <Badge
                    tone={
                      report.overall === "SAFE" ? "ok" : report.overall === "CAUTION" ? "warn" : "danger"
                    }
                  >
                    {report.overall} ／ {verdictLabel[report.overall]}
                  </Badge>
                  <p className="mt-2 text-note leading-[1.9] text-slate2">
                    いちばん悪い状況でも、赤字になる確率は
                    <span className="num font-bold"> {(report.maxLossRate * 100).toFixed(1)}% </span>
                    でした。
                  </p>
                </div>

                <ul className="mt-4 space-y-2">
                  {report.scenarios.map((sc) => (
                    <li
                      key={sc.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge2 bg-paper2 px-4 py-3"
                    >
                      <span className="text-note font-medium text-slate2">{sc.label}</span>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="num text-note text-slate3">
                          最悪 {sc.distribution.rtpWorst.toFixed(1)}%
                        </span>
                        <Badge
                          tone={
                            sc.verdict === "SAFE" ? "ok" : sc.verdict === "CAUTION" ? "warn" : "danger"
                          }
                        >
                          {sc.verdict}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="mt-4 text-note leading-[1.9] text-slate3">
              この案を実際に登録して公開する手順は、ガチャ管理の画面から行います。
              <br />
              ★AIが出した案でも、検証を飛ばして公開することはできません。
            </p>
          </Card>
        </>
      )}

      {/* ── やりとりの記録 ── */}
      {log.length > 0 && (
        <Card title="ここまでの操作" note="何をどう直したかが残ります。">
          <ol className="space-y-2">
            {log.map((l, i) => (
              <li key={i} className="flex gap-3 text-note leading-[1.9] text-slate2">
                <span className="num shrink-0 font-bold text-slate3">{i + 1}</span>
                <span>{l}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <DemoNote>
        このデモでは、案をブラウザの中の計算で作っています。外部のAIには接続していません。
        実際にお使いいただく管理画面では、同じ手順でAIが案を出します。
        検証の計算そのものは、本番と同じものを使っています。
      </DemoNote>
    </>
  );
}
