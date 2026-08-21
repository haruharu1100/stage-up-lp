"use client";

import { useState } from "react";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";
import BeforeAfter from "../ui/BeforeAfter";
/* ★製品名は必ず OPERATOR を使うこと。"AI OPERATOR" と直接書くと狭い画面で割れます */
import { OPERATOR } from "@/lib/text";

const qa = [
  {
    q: "今、危険なガチャある？",
    a: "1本あります。#128 スニーカーBOX が市場価格ベース実還元率 108.7%（しきい値 105% 超過）です。残り 128 / 500 口。原因は AJ1 Retro High OG の相場が +23.3% 上昇したためです。販売停止・景品差し替え・口数調整のいずれかをおすすめします。",
  },
  {
    q: "今日の発送、何件残ってる？",
    a: "未発送 26 件です。うち 8 件は仕入れ待ち、18 件は伝票データの書き出し待ちです。同一住所へのまとめ対象が 3 件あります。",
  },
  {
    q: "今月ここまでの利益は？",
    a: "月間売上 ¥28,410,900、景品原価 ¥26,932,100、決済手数料 ¥1,022,792。粗利は ¥456,008（粗利率 1.6%）です。先月同日比では売上 +6.8%、粗利率は −0.9pt です。",
  },
];

/**
 * 毎朝の「今日やること」。
 * 通知を並べるのではなく、粗利への影響が大きい順に並べ替えて渡す。
 */
const morningBrief = [
  {
    level: "最優先",
    tone: "danger",
    title: "#128 の販売可否を決める",
    detail:
      "市場価格ベースの実還元率が 108.7%。残 128 口。停止・景品差し替え・口数調整のいずれかを選んでください。",
    cost: "5分",
  },
  {
    level: "高",
    tone: "warn",
    title: "AJ1 Retro High OG の登録価格を更新する",
    detail:
      "仕入時 ¥42,000 に対し現在 ¥51,800（+23.3%）。この景品を含む全ガチャの実還元率が再計算されます。",
    cost: "3分",
  },
  {
    level: "高",
    tone: "blue",
    title: "未発送 26 件を処理する",
    detail:
      "うち 18 件は伝票データをいますぐ書き出せます。同一住所のまとめ対象が 3 件あります。",
    cost: "15分",
  },
  {
    level: "中",
    tone: "warn",
    title: "AIが答えられなかった問い合わせ 4 件を見る",
    detail:
      "本日 37 件のうち 33 件はAIが一次回答済み。返金・補償の 4 件だけが担当者へ回っています。",
    cost: "10分",
  },
  {
    level: "低",
    tone: "ok",
    title: "広告費の比率が高いガチャを確認する",
    detail:
      "#134 は広告経由の売上に対して広告費の比率が高い状態です。配信停止か訴求の作り直しかを判断してください。",
    cost: "10分",
  },
];

const auditLog = [
  { t: "21:04:11", u: "user_2841", g: "#128", n: "10連", before: "138", res: "A賞 ×1 / C賞 ×9", pt: "5,000", after: "128" },
  { t: "21:04:09", u: "user_1190", g: "#131", n: "1回", before: "403", res: "C賞 ×1", pt: "500", after: "402" },
  { t: "21:03:58", u: "user_3372", g: "#128", n: "5連", before: "143", res: "B賞 ×1 / C賞 ×4", pt: "2,500", after: "138" },
  { t: "21:03:41", u: "user_0917", g: "#134", n: "1回", before: "612", res: "C賞 ×1", pt: "500", after: "611" },
];

const toneMap: Record<string, string> = {
  danger: "border-danger/30 bg-danger/[0.08] text-danger-ink",
  warn: "border-warn/35 bg-warn/[0.12] text-warn-ink",
  blue: "border-blue-ink/25 bg-blue-pale text-blue-ink",
  ok: "border-ok-ink/30 bg-ok/[0.10] text-ok-ink",
};

export default function AdminConsole() {
  const [asked, setAsked] = useState(0);

  return (
    <Section
      id="admin"
      no=""
      eyebrow="OPERATION CONSOLE"
      title={
        <>
          数字を探しに行かなくていい。
          <br />
          <span className="text-gradient-royal">聞けば、答えが返ってくる。</span>
        </>
      }
      lead={`管理画面はSaaS水準で設計します。さらに右上には ${OPERATOR}。日本語で聞くだけで、根拠つきの数字がその場で返ります。`}
    >
      <BeforeAfter id="admin" className="mb-3" />

      {/*
        管理画面そのものは、ページ上部（#realscreen）で一度大きく見せています。
        ここで同じものをもう一度出すと、スクロールしても新しい情報が出てこない
        ページになるため、このセクションは AI OPERATOR の会話だけに絞っています。
      */}

      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <Reveal delay={0.06}>
          <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
            <div className="flex items-center justify-between border-b border-edge2 bg-paper2 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-deep to-blue text-[10px] font-bold text-white">
                  AI
                </span>
                <span className="text-[12px] font-semibold text-slate">
                  AI&nbsp;OPERATOR
                </span>
              </div>
              <span className="num text-[10px] text-slate3">管理画面 右上に常駐</span>
            </div>

            <div className="flex-1 space-y-3 p-4 sm:p-5">
              {qa.slice(0, asked).map((x) => (
                <div key={x.q} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-edge bg-paper2 px-4 py-2.5 text-[13px] text-slate">
                      {x.q}
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-blue-pale px-4 py-3 text-[13px] leading-[1.9] text-blue-ink">
                      {x.a}
                    </div>
                  </div>
                </div>
              ))}
              {asked === 0 && (
                <p className="py-4 text-center text-[12px] text-slate3 sm:py-8">
                  下のボタンを押すと、AI&nbsp;OPERATOR の回答が表示されます
                </p>
              )}
            </div>

            <div className="border-t border-edge2 bg-paper2 p-4">
              <div className="flex flex-wrap gap-2">
                {qa.map((x, i) => (
                  <button
                    key={x.q}
                    type="button"
                    onClick={() => setAsked(i + 1)}
                    disabled={asked > i}
                    className={`rounded-full border px-3.5 py-2 text-[11px] transition-colors ${
                      asked > i
                        ? "border-edge2 bg-white text-slate3"
                        : "border-blue-ink/30 bg-white text-blue-ink shadow-lift hover:bg-blue-pale"
                    }`}
                  >
                    {x.q}
                  </button>
                ))}
                {asked > 0 && (
                  <button
                    type="button"
                    onClick={() => setAsked(0)}
                    className="rounded-full border border-edge px-3.5 py-2 text-[11px] text-slate3 transition-colors hover:border-blue-ink/35 hover:text-slate"
                  >
                    最初から
                  </button>
                )}
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.12}>
          <div className="h-full rounded-3xl border border-edge bg-white p-4 shadow-lift sm:p-6">
            <span className="num text-[10px] tracking-[0.2em] text-blue-ink">MORNING BRIEF</span>
            <p className="mt-2 text-[12px] leading-[1.9] text-slate2">
              AIが毎朝、通知を並べるのではなく、粗利への影響が大きい順に並べ替えて渡します。
            </p>
            <ol className="mt-4 space-y-2">
              {/* 上から2件だけ出す。残りは下の「詳しく見る」の中 */}
              {morningBrief.slice(0, 2).map((s, i) => (
                <li
                  key={s.title}
                  className={`rounded-2xl border p-3 sm:p-3.5 ${
                    i === 0
                      ? "border-danger/25 bg-danger/[0.05]"
                      : "border-edge2 bg-paper2"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-edge bg-white text-[10px] text-slate2">
                      {i + 1}
                    </span>
                    <span
                      className={`num inline-block rounded-full border px-2.5 py-0.5 text-[10px] ${toneMap[s.tone]}`}
                    >
                      {s.level}
                    </span>
                    <span className="num ml-auto text-[10px] text-slate3">目安 {s.cost}</span>
                  </div>
                  <p className="mt-2 text-[12.5px] font-bold leading-[1.7] text-slate">
                    {s.title}
                  </p>
                  {i === 0 && (
                    <p className="mt-1.5 text-[11.5px] leading-[1.85] text-slate2">
                      {s.detail}
                    </p>
                  )}
                </li>
              ))}
            </ol>

            {/* 3件目以降と、各項目の中身は、読みたい人だけが開く */}
            <div className="mt-3">
              <MoreDetail label="残り3件と、それぞれの中身を見る">
                <ul className="space-y-5">
                  {morningBrief.slice(1).map((s) => (
                    <li key={s.title}>
                      <span className="num text-label text-slate3">
                        {s.level} ／ 目安 {s.cost}
                      </span>
                      <p className="mt-1 text-note font-bold text-slate">
                        {s.title}
                      </p>
                      <p className="mt-2 text-note text-slate2">{s.detail}</p>
                    </li>
                  ))}
                </ul>
              </MoreDetail>
            </div>

            <p className="mt-4 text-[10.5px] leading-[1.8] text-slate3">
              ※ 表示はサンプルデータによる動作イメージです。この一覧はメール／LINE
              で受け取る設定にもできます。
            </p>
          </div>
        </Reveal>
      </div>

      <Reveal delay={0.16}>
        <div className="console-deep mt-3 overflow-hidden rounded-3xl shadow-console">
          <div className="flex flex-col gap-2 border-b border-white/8 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="num text-[10px] tracking-[0.2em] text-blue-bright">
              LOTTERY AUDIT LOG
            </span>
            <span className="hidden text-[11px] text-white/45 lg:inline">
              誰が・いつ・どのガチャを・何回・抽選前残数・結果・消費ポイント・抽選後残数
            </span>
            <span className="text-[10.5px] text-white/35 sm:hidden">
              → 横にスクロールできます
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[86px_92px_60px_60px_78px_1fr_78px_78px] gap-2 border-b border-white/8 bg-white/[0.03] px-5 py-2.5 text-[10px] text-white/40">
                <span>時刻</span>
                <span>会員</span>
                <span>ガチャ</span>
                <span>回数</span>
                <span className="text-right">抽選前残数</span>
                <span>結果</span>
                <span className="text-right">消費pt</span>
                <span className="text-right">抽選後残数</span>
              </div>
              {auditLog.map((l) => (
                <div
                  key={l.t}
                  className="num grid grid-cols-[86px_92px_60px_60px_78px_1fr_78px_78px] items-center gap-2 border-b border-white/5 px-5 py-2.5 text-[11px] last:border-0 sm:py-3"
                >
                  <span className="text-white/40">{l.t}</span>
                  <span className="text-white/55">{l.u}</span>
                  <span className="text-white/55">{l.g}</span>
                  <span className="text-white/55">{l.n}</span>
                  <span className="text-right text-white/45">{l.before}</span>
                  <span className="truncate text-white/80">{l.res}</span>
                  <span className="text-right text-white/45">{l.pt}</span>
                  <span className="text-right font-bold text-white/85">{l.after}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-white/8 px-5 py-3.5">
            <p className="text-[11px] leading-[1.9] text-white/50">
              抽選は1件ずつ、後から書き換えにくい形で記録に残ります。「本当に正しく抽選されたのか」を運営者自身が確認できる状態を保つためです。
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
