import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";
import PriceFreshnessBadge from "../ui/PriceFreshnessBadge";
import {
  RTP_CAUTION,
  RTP_DANGER,
  STALE_AFTER_HOURS,
} from "@/lib/priceFreshness";
/* ★日本語の本文は jp() /  を通すこと。途中改行を止めます */
import { jp } from "@/lib/jp";

/**
 * 信号機UIと UNKNOWN（SAFE FAIL）のセクション。
 *
 * ここに書いてある判定の中身は、すべて lib/priceFreshness.ts の実装に合わせています。
 *  ・しきい値      RTP_CAUTION / RTP_DANGER
 *  ・古い扱いの境目 STALE_AFTER_HOURS
 *  ・鮮度の3段階   FRESH / STALE / UNKNOWN
 * 文言だけ先に良くして、実装と食い違う状態を作らないための決まりです。
 */

const STALE_DAYS = Math.round(STALE_AFTER_HOURS / 24);

const signals = [
  {
    code: "SAFE",
    label: "問題なし",
    dot: "bg-ok",
    text: "text-ok-ink",
    face: "bg-ok/[0.08]",
    edge: "border-ok/30",
    lead: "そのまま販売を続けられる状態です。",
    body: `最新の市場価格で計算した実還元率が ${RTP_CAUTION}% を下回っています。この画面を見て、その日は何もしない、という判断ができます。`,
  },
  {
    code: "CAUTION",
    label: "確認推奨",
    dot: "bg-warn",
    text: "text-warn-ink",
    face: "bg-warn/[0.10]",
    edge: "border-warn/35",
    lead: "まだ止める場面ではないが、見ておく状態です。",
    body: `実還元率が ${RTP_CAUTION}% 以上 ${RTP_DANGER}% 未満。景品構成・口数・販売速度のどれが効いているかを確認する候補として上がります。`,
  },
  {
    code: "DANGER",
    label: "要対応",
    dot: "bg-danger",
    text: "text-danger-ink",
    face: "bg-danger/[0.06]",
    edge: "border-danger/35",
    lead: "その日のうちに決める場面です。",
    body: `実還元率が ${RTP_DANGER}% 以上。販売停止・景品差し替え・口数調整のどれを取るかを選ぶ画面へ進みます。停止するかどうかを決めるのは運営者です。`,
  },
  {
    code: "UNKNOWN",
    label: "情報不足",
    dot: "bg-slate3/45",
    text: "text-slate3",
    face: "bg-paper2",
    edge: "border-edge",
    lead: "判断の材料がそろっていない状態です。",
    body: "計算に使う情報が古い、または足りません。数字を出さず「—」と表示します。安全とも危険とも表示しません。",
  },
];

const unknownCauses = [
  {
    t: "市場価格が古い（STALE）",
    d: `既定の更新周期は週1回です。${STALE_DAYS} 日を過ぎても更新できていない場合、少なくとも1回は取り込みに失敗しています。`,
  },
  {
    t: "市場価格をまだ取り込めていない",
    d: "一度も取得できていない、取得時刻が読み取れない、時刻が未来になっている場合を含みます。",
  },
  {
    t: "景品の情報が足りない",
    d: "景品が未登録、価格の対象が特定できないなど、実還元率の計算に届かない状態です。",
  },
];

/** 市場価格の3つの状態。折りたたみの中で原因と一緒に見せる */
const priceStates = [
  { c: "FRESH", d: "価格は新しい。実還元率を計算して表示します。" },
  {
    c: "STALE",
    d: `${STALE_DAYS} 日を超えて更新できていない。数字は表示しません。`,
  },
  { c: "UNKNOWN", d: "取り込めていない、または時刻が読み取れない。" },
];

const howToRead = [
  { n: "01", t: "赤（要対応）から見る", d: "その日に決めることは、たいてい赤の中にあります。" },
  { n: "02", t: "黄（確認推奨）を見る", d: "止めるかどうかではなく、原因を確認する対象です。" },
  {
    n: "03",
    t: "UNKNOWN は情報を足す",
    d: "判断ではなく、価格の取り込みや景品登録という作業に変わります。",
  },
];

export default function StatusLights() {
  return (
    <Section
      id="signals"
      no=""
      eyebrow="STATUS SIGNALS"
      title={
        <>
          ガチャ運営の経験がなくても、
          <br />
          何を確認すればいいかが分かる。
        </>
      }
      lead="数字を並べただけの画面は、慣れていない人には読めません。販売中のガチャを4つの信号のどれかに寄せて表示し、見るべき順番を色で決めます。"
    >
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {signals.map((s, i) => (
          <Reveal key={s.code} delay={i * 0.05}>
            <div
              className={`flex h-full flex-col rounded-3xl border ${s.edge} ${s.face} p-4 sm:p-8`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
                <span className={`num text-label ${s.text}`}>{s.code}</span>
              </div>
              <h3 className={`h-display mt-3 text-h3 sm:mt-4 ${s.text}`}>
                {s.label}
              </h3>
              <p className="mt-2 text-note font-bold text-slate sm:mt-3">
                {s.lead}
              </p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1}>
        <div className="mt-3">
          <MoreDetail label="4つの判定は、何を見て決まるのか">
            <ul className="space-y-6">
              {signals.map((s) => (
                <li key={s.code}>
                  <p className="text-note font-bold text-slate">
                    <span className="num">{s.code}</span> / {s.label}
                  </p>
                  <p className="mt-2 text-note text-slate2">{s.body}</p>
                </li>
              ))}
            </ul>
          </MoreDetail>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-3 overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
          <div className="grid gap-6 p-5 sm:gap-8 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12">
            <div>
              <span className="eyebrow-lite">SAFE FAIL</span>
              <h3 className="h-display mt-4 text-h2 text-balance text-slate sm:mt-5">
                分からないものを、
                <br />
                「安全」とは表示しません。
              </h3>
              <p className="mt-5 text-body text-slate2 sm:mt-6">
                取り込みに失敗した古い価格でそのまま計算を続けると、画面はいつも通り「安全」の顔をしたまま、判断の材料だけが古くなります。これがいちばん危ない壊れ方です。
              </p>
            </div>

            <div className="rounded-2xl border border-edge bg-paper2 px-5 py-6 text-center sm:px-6 sm:py-7">
              <span className="num text-h3 font-semibold tracking-[0.14em] text-slate3">
                UNKNOWN
              </span>
              <p className="mt-3 text-note text-slate2 sm:mt-4">
                {jp(
                  "実還元率の欄は「—」になります。市場価格が FRESH でない限り、計算結果が",
                )}
                <span className="num"> 94% </span>
                （普段なら SAFE にあたる数字）でも、SAFE とは表示しません。
              </p>
            </div>
          </div>

          <div className="border-t border-edge2 bg-paper2 p-5 sm:p-10">
            <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-12">
              <div>
                <span className="eyebrow-lite">PRICE DATA STATE</span>
                <p className="mt-3 text-note text-slate2 sm:mt-4">
                  市場価格は FRESH ／ STALE ／ UNKNOWN
                  の3つの状態で扱います。判定は画面を開いたときに行います。
                </p>
                <PriceFreshnessBadge className="mt-4 sm:mt-5" />
              </div>

              <MoreDetail label="SAFE FAIL の考え方と、UNKNOWN になる原因">
                {/* 本文から移した説明。消さずにここへ入れている */}
                <p>
                  材料がそろっていないときは緑にも赤にもせず、UNKNOWN
                  と表示します。安全側に倒して止まる、という意味で SAFE FAIL
                  と呼んでいます。上のバッジは、既定の更新周期（週1回・毎週月曜
                  04:00）で取り込めている場合の表示です。
                </p>
                <ul className="mt-6 space-y-6 border-t border-edge2 pt-6">
                  {unknownCauses.map((c) => (
                    <li key={c.t}>
                      <p className="text-note font-bold text-slate">{c.t}</p>
                      <p className="mt-2 text-note text-slate2">{c.d}</p>
                    </li>
                  ))}
                </ul>
                <ul className="mt-7 space-y-3 border-t border-edge2 pt-6">
                  {priceStates.map((x) => (
                    <li key={x.c}>
                      <span className="num text-label text-slate3">{x.c}</span>
                      <p className="mt-1.5 text-note text-slate2">{x.d}</p>
                    </li>
                  ))}
                </ul>
              </MoreDetail>
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.14}>
        {/* 読む順番の手引き。中身は残したまま畳んでいる */}
        <div className="mt-3">
          <MoreDetail label="信号をどの順番で見ればいいか（3ステップ）">
            <ul className="space-y-5">
              {howToRead.map((h) => (
                <li key={h.n} className="flex gap-4">
                  <span className="num shrink-0 font-semibold text-blue-ink">
                    {h.n}
                  </span>
                  <div className="min-w-0">
                    <p className="text-note font-bold text-slate">{h.t}</p>
                    <p className="mt-1.5 text-note text-slate2">{h.d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </MoreDetail>
        </div>
      </Reveal>

      <Reveal delay={0.18}>
        <p className="mt-4 rounded-2xl border border-edge bg-paper2 px-5 py-5 text-note text-slate2 sm:mt-5 sm:px-6 sm:py-6">
          信号は、状況の整理と優先順位の提示までを行います。販売を止めるか、景品を差し替えるか、そのまま続けるかを決めるのは運営者です。しきい値（
          <span className="num">
            {RTP_CAUTION}% / {RTP_DANGER}%
          </span>
          ）と通知先は、運用に合わせて設定できます。
        </p>
      </Reveal>
    </Section>
  );
}
