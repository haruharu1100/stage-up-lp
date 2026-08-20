"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Reveal from "../ui/Reveal";
import { ctaTrio } from "@/content/site";
import {
  captureLeadSource,
  readDiagnosis,
  readLastTouch,
  readLeadSource,
  readSelectedPlan,
  type Diagnosis,
  type LastTouch,
  type LeadSource,
} from "@/lib/lead";
import { EV, track, trackOnce } from "@/lib/track";

type State = "idle" | "sending" | "done" | "error";

/** 「現在オンラインガチャを運営しているか」だけ聞く。詳細は商談で。 */
const RUNNING = [
  "運営している",
  "運営していない（これから）",
  "情報収集中",
] as const;

const INTENTS = [
  { key: "meeting", label: "オンライン相談を予約したい" },
  { key: "quote", label: "自社の場合の費用を知りたい" },
  { key: "other", label: "その他・まず話を聞きたい" },
] as const;

/** 入力欄の見た目。白地・1px の細い枠・青のフォーカス。iOSで拡大しない16px以上。 */
const INPUT_CLS =
  "mt-3 w-full rounded-xl border border-edge bg-white px-5 py-4 text-note text-slate outline-none transition-all duration-200 placeholder:text-slate3/60 hover:border-edge focus:border-blue-ink focus:ring-4 focus:ring-blue-ink/10";

export default function Cta() {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const [intent, setIntent] = useState<string>(INTENTS[0].key);
  const [running, setRunning] = useState<string>(RUNNING[0]);
  const [openNote, setOpenNote] = useState(false);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * 送信内容に必ず同梱する情報。
   *
   * 画面には出さず、hidden項目としてフォームに埋め込みます。
   * こうしておくと、万一 JavaScript の送信処理が失敗しても
   * ブラウザ標準のフォーム送信で同じ情報が届きます（＝流入元が消えない）。
   */
  const [src, setSrc] = useState<LeadSource | null>(null);
  const [last, setLast] = useState<LastTouch | null>(null);
  const [plan, setPlan] = useState<string>("");

  // 流入元（?ref=sales01 / UTM / 参照元）を着地時に1度だけ記録する
  useEffect(() => {
    setSrc(captureLeadSource());
    setLast(readLastTouch());
    setPlan(readSelectedPlan()?.plan ?? "");
    setDiagnosis(readDiagnosis());
  }, []);

  // 料金プランのボタンが押されたら、その場で hidden 項目に反映する
  useEffect(() => {
    const onPlan = (e: Event) =>
      setPlan((e as CustomEvent<{ plan: string }>).detail?.plan ?? "");
    window.addEventListener("gos:plan", onPlan);
    return () => window.removeEventListener("gos:plan", onPlan);
  }, []);

  // 診断セクションで「この構成で相談する」を押されたら、補足欄へ内容を入れる
  useEffect(() => {
    const onDiag = (e: Event) => {
      const d = (e as CustomEvent<Diagnosis>).detail;
      setDiagnosis(d);
      setOpenNote(true);
      // 開いた直後は要素がまだ無いので、描画後に入れる
      requestAnimationFrame(() => {
        if (noteRef.current && !noteRef.current.value) {
          noteRef.current.value = d.summary;
        }
      });
    };
    window.addEventListener("gos:diagnosis", onDiag);
    return () => window.removeEventListener("gos:diagnosis", onDiag);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError("");

    const fd = new FormData(e.currentTarget);
    // 送信の瞬間に読み直す（着地後にプランを押した場合も取りこぼさない）
    const source = readLeadSource();
    const lastTouch = readLastTouch();
    const selectedPlan = readSelectedPlan()?.plan ?? "";
    const payload = {
      company: String(fd.get("company") ?? ""),
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      stage: running,
      intent: INTENTS.find((x) => x.key === intent)?.label ?? "",
      message: String(fd.get("message") ?? ""),
      hp: String(fd.get("hp") ?? ""),
      // 最初の着地（FIRST TOUCH）＝どの経路・どの営業担当から来たか
      ...source,
      // 直近の入口（LAST TOUCH）。同じ訪問中に別のURLから入り直した場合だけ入る
      lastRef: lastTouch?.ref ?? "",
      lastChannel: lastTouch?.channel ?? "",
      lastUtmSource: lastTouch?.utmSource ?? "",
      lastUtmMedium: lastTouch?.utmMedium ?? "",
      lastUtmCampaign: lastTouch?.utmCampaign ?? "",
      lastAt: lastTouch?.at ?? "",
      // 押された料金プラン（プラン別の成約率を出すため）
      plan: selectedPlan,
    };

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "送信に失敗しました");
      // 個人情報は送らず、経路と希望内容だけを計測に残す
      track(EV.contactSubmit, {
        intent: payload.intent,
        stage: payload.stage,
        channel: source.channel,
        ref: source.ref,
        variant: source.variant,
        plan: selectedPlan,
        from_diagnosis: Boolean(diagnosis),
      });
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
      setState("error");
    }
  }

  return (
    <section
      id="contact"
      className="relative overflow-hidden bg-paper2 py-28 sm:py-36"
    >
      <div className="pointer-events-none absolute inset-0 grid-lite mask-fade-b opacity-70" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[880px] -translate-x-1/2 rounded-full bg-blue-pale/80 blur-[140px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 rule" />

      <div className="container-x relative">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <div className="flex items-center justify-center gap-4">
              <span className="num text-label text-slate3">SECTION 23</span>
              <span className="h-px w-10 bg-edge" />
              <span className="eyebrow-lite">GET STARTED</span>
            </div>
            <h2 className="h-display mt-7 text-h2 text-slate">
              まず、いまの運営を
              <br />
              <span className="text-gradient-royal">見せてください。</span>
            </h2>
            <p className="mx-auto mt-7 max-w-2xl text-body text-slate2">
              どこに時間が溶けているのかを一緒に整理します。デモ画面をお見せしながら、
              必要な機能範囲とお見積りの目安をその場でお伝えします。
            </p>
          </div>
        </Reveal>

        {/* CTA 3種 */}
        <div className="mt-16 grid gap-5 md:grid-cols-3">
          {ctaTrio.map((c, i) => {
            const isForm = c.href === "#contact";
            const inner = (
              <>
                <div className="flex items-center justify-between">
                  <span
                    className={`num text-label ${
                      c.primary ? "text-blue-ink" : "text-slate3"
                    }`}
                  >
                    {c.code}
                  </span>
                  {c.primary && (
                    <span className="rounded-full bg-blue-ink px-3.5 py-1 text-note font-bold leading-normal text-white">
                      おすすめ
                    </span>
                  )}
                </div>
                <p className="mt-6 text-h3 font-semibold text-slate">
                  {c.label}
                </p>
                <p className="mt-3.5 text-note text-slate2">{c.body}</p>
                <span
                  className={`mt-7 inline-flex items-center gap-2 text-note font-semibold ${
                    c.primary ? "text-blue-ink" : "text-slate2"
                  }`}
                >
                  {c.primary ? "デモを開く" : "この内容で送る"}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  >
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </>
            );

            const cls = `group flex h-full flex-col rounded-3xl border p-7 text-left shadow-lift transition-all duration-300 hover:-translate-y-1 sm:p-8 ${
              c.primary
                ? "border-blue-ink/20 bg-gradient-to-b from-blue-pale/70 to-white hover:border-blue-ink/40 hover:shadow-blue-lift"
                : "border-edge bg-white hover:border-blue-ink/25 hover:shadow-lift2"
            }`;

            return (
              <Reveal key={c.key} delay={i * 0.05}>
                {isForm ? (
                  <button
                    type="button"
                    className={`${cls} w-full`}
                    onClick={() => {
                      setIntent(c.key === "quote" ? "quote" : "meeting");
                      document
                        .getElementById("lead-form")
                        ?.scrollIntoView({ block: "center" });
                    }}
                  >
                    {inner}
                  </button>
                ) : (
                  <Link href={c.href} className={cls}>
                    {inner}
                  </Link>
                )}
              </Reveal>
            );
          })}
        </div>

        {/* リードフォーム */}
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
          <Reveal delay={0.1}>
            <div
              id="lead-form"
              className="lp-card scroll-mt-24 p-7 shadow-lift2 sm:p-10"
            >
              {state === "done" ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border border-ok-ink/25 bg-ok/10">
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M3.5 8.5l3 3 6-7"
                        stroke="#0F855C"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <h3 className="h-display mt-7 text-h3 text-slate">
                    送信しました
                  </h3>
                  <p className="mt-4 max-w-md text-note text-slate2">
                    内容を確認のうえ、担当者からご連絡します。
                    お急ぎの場合は、その旨をメールでお知らせください。
                  </p>
                  <Link href="/demo" className="btn-outline mt-9">
                    先に管理画面のデモを見る
                  </Link>
                </div>
              ) : (
                <form
                  onSubmit={onSubmit}
                  method="post"
                  action="/api/contact"
                  className="space-y-8"
                  /* フォームに手を付けた人を1回だけ数える（入力内容は送らない） */
                  onFocusCapture={() => trackOnce(EV.contactStart, {})}
                >
                  {/* JavaScript無効時でも、この2項目が送信内容に含まれるようにする */}
                  <input type="hidden" name="stage" value={running} />
                  <input
                    type="hidden"
                    name="intent"
                    value={INTENTS.find((x) => x.key === intent)?.label ?? ""}
                  />

                  {/* 流入元・選択プランの控え。
                      画面には出ません。送信処理が万一失敗しても、
                      ブラウザ標準の送信で同じ情報が届くようにするための保険です。 */}
                  <input type="hidden" name="ref" value={src?.ref ?? ""} />
                  <input type="hidden" name="channel" value={src?.channel ?? ""} />
                  <input type="hidden" name="utmSource" value={src?.utmSource ?? ""} />
                  <input type="hidden" name="utmMedium" value={src?.utmMedium ?? ""} />
                  <input
                    type="hidden"
                    name="utmCampaign"
                    value={src?.utmCampaign ?? ""}
                  />
                  <input type="hidden" name="landing" value={src?.landing ?? ""} />
                  <input type="hidden" name="referrer" value={src?.referrer ?? ""} />
                  <input type="hidden" name="variant" value={src?.variant ?? ""} />
                  <input type="hidden" name="lastRef" value={last?.ref ?? ""} />
                  <input type="hidden" name="lastChannel" value={last?.channel ?? ""} />
                  <input
                    type="hidden"
                    name="lastUtmSource"
                    value={last?.utmSource ?? ""}
                  />
                  <input
                    type="hidden"
                    name="lastUtmMedium"
                    value={last?.utmMedium ?? ""}
                  />
                  <input
                    type="hidden"
                    name="lastUtmCampaign"
                    value={last?.utmCampaign ?? ""}
                  />
                  <input type="hidden" name="lastAt" value={last?.at ?? ""} />
                  <input type="hidden" name="plan" value={plan} />

                  <input
                    type="text"
                    name="hp"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden
                    className="pointer-events-none absolute h-0 w-0 opacity-0"
                  />

                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-body font-bold text-slate">
                      入力は4項目だけです。
                    </p>
                    <p className="num shrink-0 text-note text-slate3">約30秒</p>
                  </div>

                  {/* 診断からお越しの場合は、選んだ構成をここに出す */}
                  {diagnosis && (
                    <p className="lp-tint rounded-2xl px-5 py-4 text-note text-slate2">
                      <span className="num mr-2.5 rounded-md border border-blue-ink/20 bg-white px-2 py-1 text-label text-blue-ink">
                        診断結果
                      </span>
                      {diagnosis.headline}
                      <span className="text-slate3">
                        {" "}
                        の内容を補足欄に入れました。修正いただいても構いません。
                      </span>
                    </p>
                  )}

                  <div className="grid gap-6 sm:grid-cols-2">
                    <Field
                      label="会社名 / 屋号"
                      name="company"
                      placeholder="株式会社◯◯"
                    />
                    <Field
                      label="お名前"
                      name="name"
                      required
                      placeholder="山田 太郎"
                    />
                  </div>

                  <Field
                    label="メールアドレス"
                    name="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                  />

                  <fieldset>
                    <legend className="text-note font-medium text-slate2">
                      現在、オンラインガチャを運営していますか？
                      <span className="ml-2 text-blue-ink">必須</span>
                    </legend>
                    <div className="mt-3.5 flex flex-wrap gap-2.5">
                      {RUNNING.map((r) => {
                        const on = running === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setRunning(r)}
                            aria-pressed={on}
                            className={`rounded-full border px-5 py-3 text-note leading-normal transition-all duration-200 ${
                              on
                                ? "border-blue-ink/35 bg-blue-pale font-semibold text-blue-ink shadow-lift"
                                : "border-edge bg-white text-slate2 hover:border-blue-ink/25 hover:text-slate"
                            }`}
                          >
                            {r}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend className="text-note font-medium text-slate2">
                      ご希望
                    </legend>
                    <div className="mt-3.5 flex flex-wrap gap-2.5">
                      {INTENTS.map((x) => {
                        const on = intent === x.key;
                        return (
                          <button
                            key={x.key}
                            type="button"
                            onClick={() => setIntent(x.key)}
                            aria-pressed={on}
                            className={`rounded-full border px-5 py-3 text-note leading-normal transition-all duration-200 ${
                              on
                                ? "border-blue-ink/35 bg-blue-pale font-semibold text-blue-ink shadow-lift"
                                : "border-edge bg-white text-slate2 hover:border-blue-ink/25 hover:text-slate"
                            }`}
                          >
                            {x.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  {/* 任意の補足。閉じておいて離脱を防ぐ */}
                  {openNote ? (
                    <div>
                      <label
                        className="text-note font-medium text-slate2"
                        htmlFor="message"
                      >
                        補足（任意）
                      </label>
                      <textarea
                        id="message"
                        name="message"
                        ref={noteRef}
                        rows={diagnosis ? 7 : 4}
                        defaultValue={diagnosis?.summary ?? ""}
                        placeholder="扱っているジャンル、いま困っていることなど"
                        className={`${INPUT_CLS} resize-none`}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenNote(true)}
                      className="text-note text-slate3 underline-offset-4 transition hover:text-blue-ink hover:underline"
                    >
                      ＋ 補足を書く（任意）
                    </button>
                  )}

                  {/* JavaScript無効時の入力欄と案内（JSが有効なら描画されない） */}
                  <noscript>
                    <div>
                      <label
                        className="text-note font-medium text-slate2"
                        htmlFor="message-nojs"
                      >
                        ご相談内容（任意）
                      </label>
                      <textarea
                        id="message-nojs"
                        name="message"
                        rows={4}
                        placeholder="扱っているジャンル、いま困っていること、運営状況など"
                        className={`${INPUT_CLS} resize-none`}
                      />
                      <p className="mt-4 text-note text-slate3">
                        ※ お使いの環境ではJavaScriptが無効のため、選択式の項目は初期値で送信されます。運営状況やご希望は、この欄にご記入ください。
                      </p>
                    </div>
                  </noscript>

                  {state === "error" && (
                    <p className="rounded-xl border border-danger-ink/25 bg-danger/[0.06] px-5 py-4 text-note text-danger-ink">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={state === "sending"}
                    className="btn-primary btn-lg w-full rounded-xl disabled:opacity-50"
                  >
                    {state === "sending" ? "送信中…" : "送信する"}
                  </button>

                  <p className="text-note text-slate3">
                    その他の詳細は、ご相談の中でうかがいます。送信された内容は、ご相談への回答のみに使用します。営業目的での第三者提供は行いません。詳しくは
                    <Link
                      href="/legal/privacy"
                      className="ml-1 text-blue-ink underline underline-offset-4 transition hover:text-slate"
                    >
                      個人情報の取り扱いについて
                    </Link>
                    をご覧ください。
                  </p>
                </form>
              )}
            </div>
          </Reveal>

          <Reveal delay={0.16}>
            <div className="flex h-full flex-col gap-5">
              <div className="lp-card flex-1 p-7 sm:p-8">
                <span className="num text-label text-slate3">
                  WHAT HAPPENS NEXT
                </span>
                <ol className="mt-7 space-y-5">
                  {[
                    "内容を確認し、担当者からご連絡します",
                    "オンラインで現状と課題をうかがいます（30〜60分）",
                    "必要な機能範囲とお見積りをご提示します",
                  ].map((t, i) => (
                    <li key={t} className="flex gap-4">
                      <span className="num mt-[3px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge bg-white text-note leading-none text-blue-ink">
                        {i + 1}
                      </span>
                      <span className="text-note text-slate2">{t}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-8 rule" />
                <p className="mt-6 text-note text-slate3">
                  無理な提案はしません。運営規模によっては、既存のやり方を続けたほうがよいこともあります。その場合はそうお伝えします。
                </p>
              </div>

              <Link
                href="/demo"
                className="group rounded-3xl border border-blue-ink/20 bg-gradient-to-b from-blue-pale/70 to-white p-7 shadow-lift transition-all duration-300 hover:-translate-y-1 hover:border-blue-ink/40 hover:shadow-blue-lift sm:p-8"
              >
                <span className="num text-label text-blue-ink">LIVE DEMO</span>
                <p className="mt-4 text-h3 font-semibold text-slate">
                  先に管理画面を触ってみる
                </p>
                <p className="mt-3.5 text-note text-slate2">
                  登録不要です。本番を模したサンプルの運用ダッシュボードと AI
                  OPERATOR を、その場でご覧いただけます。
                </p>
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-note font-medium text-slate2" htmlFor={name}>
        {label}
        {required && <span className="ml-2 text-blue-ink">必須</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className={INPUT_CLS}
      />
    </div>
  );
}
