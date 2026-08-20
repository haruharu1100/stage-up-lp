import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import PriceFreshnessBadge from "../ui/PriceFreshnessBadge";
import {
  RTP_CAUTION,
  RTP_DANGER,
  STALE_AFTER_HOURS,
} from "@/lib/priceFreshness";

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
      no="16"
      eyebrow="STATUS SIGNALS"
      title={
        <>
          ガチャ運営の経験がなくても、
          <br />
          何を確認すればいいかが分かる。
        </>
      }
      lead="数字を並べただけの画面は、慣れていない人には読めません。この製品では、販売中のガチャを4つの信号のどれかに寄せて表示します。見るべき順番が色で決まるので、その日に何を確認するかが画面の側から示されます。"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {signals.map((s, i) => (
          <Reveal key={s.code} delay={i * 0.05}>
            <div
              className={`flex h-full flex-col rounded-3xl border ${s.edge} ${s.face} p-7 sm:p-8`}
            >
              <div className="flex items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                <span className={`num text-label ${s.text}`}>{s.code}</span>
              </div>
              <h3 className={`h-display mt-6 text-h3 ${s.text}`}>{s.label}</h3>
              <p className="mt-4 text-note font-bold text-slate">{s.lead}</p>
              <p className="mt-3 text-note text-slate2">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1}>
        <div className="mt-3 overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
          <div className="grid gap-10 p-8 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
            <div>
              <span className="eyebrow-lite">SAFE FAIL</span>
              <h3 className="h-display mt-6 text-h2 text-balance text-slate">
                分からないものを、
                <br />
                「安全」とは表示しません。
              </h3>
              <p className="mt-7 text-body text-slate2">
                実還元率は、外から取り込んだ市場価格を使って計算します。取り込みに失敗したときに古い価格でそのまま計算を続けると、画面はいつも通り「安全」の顔をしたまま、判断の材料だけが古くなります。これがいちばん危ない壊れ方です。
              </p>
              <p className="mt-5 text-body text-slate2">
                そこでこの製品は、材料がそろっていないときは緑にも赤にもせず、UNKNOWN と表示します。安全側に倒して止まる、という意味で SAFE FAIL と呼んでいます。
              </p>
            </div>

            <div>
              <div className="space-y-2.5">
                {unknownCauses.map((c) => (
                  <div
                    key={c.t}
                    className="rounded-2xl border border-edge2 bg-paper2 px-6 py-5"
                  >
                    <h4 className="text-note font-bold text-slate">{c.t}</h4>
                    <p className="mt-2.5 text-note text-slate2">{c.d}</p>
                  </div>
                ))}
              </div>

              <div className="flex justify-center py-5" aria-hidden>
                <svg width="20" height="26" viewBox="0 0 20 26" fill="none">
                  <path
                    d="M10 1v22M3.5 16.5L10 23.5l6.5-7"
                    stroke="#63708A"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <div className="rounded-2xl border border-edge bg-paper2 px-6 py-7 text-center">
                <span className="num text-h3 font-semibold tracking-[0.14em] text-slate3">
                  UNKNOWN
                </span>
                <p className="mt-4 text-note text-slate2">
                  実還元率の欄は「—」になります。市場価格が FRESH でない限り、計算結果が
                  <span className="num"> 94% </span>
                  （普段なら SAFE にあたる数字）でも、SAFE とは表示しません。
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 border-t border-edge2 bg-paper2 p-8 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
            <div>
              <span className="eyebrow-lite">PRICE DATA STATE</span>
              <p className="mt-5 text-note text-slate2">
                市場価格の状態は、この3つで扱います。判定は画面を開いたときに行います。
              </p>
              <PriceFreshnessBadge className="mt-5" />
              <p className="mt-4 text-note text-slate3">
                上は、既定の更新周期（週1回・毎週月曜 04:00）で取り込めている場合の表示です。
              </p>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {[
                {
                  c: "FRESH",
                  d: "価格は新しい。実還元率を計算して表示します。",
                  t: "text-ok-ink",
                  f: "bg-ok/[0.08]",
                  e: "border-ok/30",
                },
                {
                  c: "STALE",
                  d: `${STALE_DAYS} 日を超えて更新できていない。数字は表示しません。`,
                  t: "text-warn-ink",
                  f: "bg-warn/[0.10]",
                  e: "border-warn/35",
                },
                {
                  c: "UNKNOWN",
                  d: "取り込めていない、または時刻が読み取れない。",
                  t: "text-slate3",
                  f: "bg-white",
                  e: "border-edge",
                },
              ].map((x) => (
                <div
                  key={x.c}
                  className={`rounded-2xl border ${x.e} ${x.f} px-5 py-5`}
                >
                  <span className={`num text-label ${x.t}`}>{x.c}</span>
                  <p className="mt-3 text-note text-slate2">{x.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.14}>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {howToRead.map((h) => (
            <div
              key={h.n}
              className="flex gap-5 rounded-3xl border border-edge bg-white p-7 sm:p-8"
            >
              <span className="num shrink-0 text-h3 font-semibold leading-none text-blue-ink">
                {h.n}
              </span>
              <div className="min-w-0">
                <h4 className="text-note font-bold text-slate">{h.t}</h4>
                <p className="mt-3 text-note text-slate2">{h.d}</p>
              </div>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.18}>
        <p className="mt-5 rounded-2xl border border-edge bg-paper2 px-6 py-6 text-note text-slate2">
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
