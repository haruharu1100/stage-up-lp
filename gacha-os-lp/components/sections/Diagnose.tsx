"use client";

import { useMemo, useState } from "react";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { saveDiagnosis } from "@/lib/lead";
import { EV, track, trackOnce } from "@/lib/track";

/**
 * 「いま何に困っていますか？」の簡易診断。
 *
 * 4問だけ聞いて、優先して入れるとよい構成を提示する。
 * 効果は断定せず「〜の可能性があります」「〜が大きくなりやすい構成です」と書く。
 * 数値の約束はしない（実データのない効果は出さない）。
 */

type Trouble =
  | "build"
  | "rtp"
  | "price"
  | "ship"
  | "support"
  | "growth"
  | "all";

const RUNNING = [
  { key: "yes", label: "運営している" },
  { key: "no", label: "これから始める / 検討中" },
] as const;

const TROUBLES: { key: Trouble; label: string }[] = [
  { key: "build", label: "ガチャの作成・構成づくり" },
  { key: "rtp", label: "還元率の管理" },
  { key: "price", label: "商品価格・相場の追跡" },
  { key: "ship", label: "発送作業" },
  { key: "support", label: "問い合わせ対応" },
  { key: "growth", label: "集客" },
  { key: "all", label: "すべて" },
];

const GACHA_VOL = ["〜5本", "6〜15本", "16〜30本", "31本以上"] as const;
const SHIP_VOL = ["〜50件", "51〜200件", "201〜500件", "501件以上"] as const;

/** 困りごと → 提案する構成 */
const MAP: Record<Trouble, { name: string; why: string; modules: string[] }> = {
  build: {
    name: "AIガチャ設計＋実還元率管理",
    why: "ガチャ1本あたりの設計時間が長いほど、公開できる本数が体制の上限で決まってしまいます。設計を「条件を決めて承認するだけ」にすると、本数を増やしても作業時間が比例しにくくなります。",
    modules: ["AIガチャ自動設計", "承認フロー", "設定・残数ベース還元率"],
  },
  rtp: {
    name: "実還元率管理＋市場価格連動",
    why: "還元率は公開したあとに動きます。上位賞が残ったまま口数が減ったとき、景品の相場が上がったとき。この2つを見ていないと、気づいたときには赤字のまま売り切れています。",
    modules: ["残数ベース還元率", "市場価格ベース還元率", "しきい値超過の警告と販売停止"],
  },
  price: {
    name: "市場価格連動＋実還元率管理",
    why: "登録した仕入値のままだと、実際の採算とズレていきます。相場を定期取得して実還元率へ反映すると、採算が反転する前に手を打てます。",
    modules: ["商品価格の定期取得", "価格変動の通知", "全ガチャの実還元率へ自動反映"],
  },
  ship: {
    name: "発送自動化＋AI顧客対応",
    why: "発送は売れた数にそのまま比例する作業です。ここを自動化しないと、売上を伸ばすたびに人を増やすことになります。",
    modules: ["発送依頼の自動集約", "伝票データの一括書き出し", "追跡番号の自動通知"],
  },
  support: {
    name: "AI顧客対応＋発送自動化",
    why: "問い合わせの多くは発送状況の確認です。発送側の情報がそろっていれば、AIの一次対応で返せる割合が上がります。返金・補償など判断が必要なものだけ人へ回します。",
    modules: ["AI一次対応", "権限内での履歴参照", "人へのエスカレーション"],
  },
  growth: {
    name: "運営基盤＋集客オプション",
    why: "集客を増やす前に、増えた注文をさばける状態にしておく必要があります。発送と問い合わせが詰まると、広告費がそのまま損失になります。",
    modules: ["運営基盤（設計・還元率・発送・問い合わせ）", "広告運用", "X / LINE 運用"],
  },
  all: {
    name: "フル構成（設計・還元率・価格・発送・問い合わせ・分析）",
    why: "個別に足していくより、最初から1つの管理画面にまとめたほうが、数字を探しに行く時間そのものがなくなります。",
    modules: [
      "AIガチャ自動設計",
      "実還元率・市場価格連動",
      "発送自動化",
      "AI顧客対応",
      "AI OPERATOR",
    ],
  },
};

export default function Diagnose() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState<string>("");
  const [trouble, setTrouble] = useState<Trouble | "">("");
  const [gachaVol, setGachaVol] = useState<string>("");
  const [shipVol, setShipVol] = useState<string>("");

  const result = useMemo(() => {
    if (!trouble) return null;
    const base = MAP[trouble];

    /** 件数から、優先して見る順番を1行足す */
    const extra: string[] = [];
    if (shipVol === "201〜500件" || shipVol === "501件以上") {
      extra.push(
        "発送件数が多いため、発送自動化の効果が先に出やすい構成です。ここを最初に入れる形もご提案できます。"
      );
    }
    if (gachaVol === "16〜30本" || gachaVol === "31本以上") {
      extra.push(
        "公開本数が多いため、1本ずつ手で還元率を確認する運用は負担が大きくなります。実還元率の自動監視を優先することをおすすめします。"
      );
    }
    if (running === "no") {
      extra.push(
        "これから始められる場合は、最初から管理画面と還元率管理を含めた形で構築するほうが、あとから足すより負担が小さくなります。"
      );
    }
    return { ...base, extra };
  }, [trouble, shipVol, gachaVol, running]);

  const total = 4;
  const done = step >= total;

  const toContact = () => {
    if (!result) return;
    const lines = [
      "【診断結果をもとにご相談】",
      `運営状況：${RUNNING.find((r) => r.key === running)?.label ?? "未選択"}`,
      `一番困っていること：${TROUBLES.find((t) => t.key === trouble)?.label ?? "未選択"}`,
      `月間ガチャ数：${gachaVol || "未選択"}`,
      `月間発送件数：${shipVol || "未選択"}`,
      `提案構成：${result.name}`,
    ];
    saveDiagnosis({ headline: result.name, summary: lines.join("\n") });
    track(EV.diagnoseToForm, { plan: result.name, trouble });
    document.getElementById("lead-form")?.scrollIntoView({ block: "center" });
  };

  const reset = () => {
    setStep(0);
    setRunning("");
    setTrouble("");
    setGachaVol("");
    setShipVol("");
  };

  return (
    <Section
      id="diagnose"
      no="05"
      eyebrow="QUICK DIAGNOSIS"
      title={
        <>
          いま、何に困っていますか。
          <br />
          <span className="text-gradient-royal">30秒で、入れる順番を出します。</span>
        </>
      }
      lead="全部入れる必要はありません。4問だけお答えいただければ、どこから始めると効果が出やすいかをお伝えします。入力は不要です。"
    >
      <Reveal>
        <div className="lp-card mx-auto max-w-3xl overflow-hidden shadow-lift2">
          {/* 進行 */}
          <div className="flex items-center gap-4 border-b border-edge2 bg-paper2/70 px-6 py-5 sm:px-9">
            <span className="num text-label text-slate3">
              {done ? "RESULT" : `QUESTION ${step + 1} / ${total}`}
            </span>
            <div className="ml-auto flex gap-1.5">
              {Array.from({ length: total }).map((_, n) => (
                <span
                  key={n}
                  className={`h-1.5 w-9 rounded-full transition-colors duration-500 ${
                    done || n < step
                      ? "bg-ok-ink/60"
                      : n === step
                        ? "bg-blue-ink"
                        : "bg-edge"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="p-6 sm:p-9 lg:p-10">
            {step === 0 && (
              <Q title="現在、オンラインガチャを運営していますか？">
                {RUNNING.map((r) => (
                  <Choice
                    key={r.key}
                    label={r.label}
                    on={running === r.key}
                    onClick={() => {
                      // 診断に手を付けた人を1回だけ数える
                      trackOnce(EV.diagnosisStart, {});
                      setRunning(r.key);
                      setStep(1);
                    }}
                  />
                ))}
              </Q>
            )}

            {step === 1 && (
              <Q title="いま、一番困っていることはどれですか？">
                {TROUBLES.map((t) => (
                  <Choice
                    key={t.key}
                    label={t.label}
                    on={trouble === t.key}
                    onClick={() => {
                      setTrouble(t.key);
                      setStep(2);
                    }}
                  />
                ))}
              </Q>
            )}

            {step === 2 && (
              <Q title="月に公開しているガチャは、だいたい何本ですか？">
                {GACHA_VOL.map((v) => (
                  <Choice
                    key={v}
                    label={v}
                    on={gachaVol === v}
                    onClick={() => {
                      setGachaVol(v);
                      setStep(3);
                    }}
                  />
                ))}
              </Q>
            )}

            {step === 3 && (
              <Q title="月の発送件数は、だいたい何件ですか？">
                {SHIP_VOL.map((v) => (
                  <Choice
                    key={v}
                    label={v}
                    on={shipVol === v}
                    onClick={() => {
                      setShipVol(v);
                      setStep(4);
                      trackOnce(EV.diagnosisComplete, { trouble, gachaVol, shipVol: v });
                    }}
                  />
                ))}
              </Q>
            )}

            {done && result && (
              <div>
                <p className="text-note text-slate3">
                  お答えいただいた内容から、優先して入れるとよい構成です。
                </p>
                <p className="h-display mt-4 text-h3 text-balance text-slate">
                  あなたの場合、
                  <span className="text-gradient-royal">{result.name}</span>
                  <br />
                  の導入効果が高い可能性があります。
                </p>

                <p className="mt-7 max-w-[38em] text-body text-pretty text-slate2">
                  {result.why}
                </p>

                <div className="mt-8 flex flex-wrap gap-2.5">
                  {result.modules.map((m) => (
                    <span
                      key={m}
                      className="rounded-full border border-blue-ink/15 bg-blue-pale px-4 py-2 text-note font-medium text-blue-ink"
                    >
                      {m}
                    </span>
                  ))}
                </div>

                {result.extra.length > 0 && (
                  <ul className="mt-8 space-y-4 border-t border-edge2 pt-7">
                    {result.extra.map((e) => (
                      <li
                        key={e}
                        className="flex gap-3.5 text-note text-pretty text-slate2"
                      >
                        <span className="mt-[0.75em] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-ink/45" />
                        {e}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={toContact}
                    className="btn-primary btn-lg"
                  >
                    この構成で相談する
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="btn-outline btn-lg"
                  >
                    もう一度やる
                  </button>
                </div>

                <p className="mt-8 max-w-[42em] text-note text-pretty text-slate3">
                  ※ これは選択内容にもとづく一般的なご提案です。実際の効果は運営体制・商材・件数によって変わります。正式なご提案は、現状をうかがったうえでお出しします。
                </p>
              </div>
            )}

            {!done && step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="mt-9 text-note text-slate3 underline-offset-4 transition-colors hover:text-blue-ink hover:underline"
              >
                ← ひとつ前に戻る
              </button>
            )}
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

function Q({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="h-display text-h3 text-balance text-slate">{title}</p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Choice({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`w-full rounded-2xl border px-6 py-5 text-left text-body font-medium leading-snug transition-all duration-200 ${
        on
          ? "border-blue-ink/40 bg-blue-pale text-blue-ink shadow-lift"
          : "border-edge bg-white text-slate2 hover:-translate-y-px hover:border-blue-ink/30 hover:text-slate hover:shadow-lift"
      }`}
    >
      {label}
    </button>
  );
}
