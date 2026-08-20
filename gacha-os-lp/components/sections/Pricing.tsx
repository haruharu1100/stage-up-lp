import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import ViewTracker from "../ui/ViewTracker";
import TrackedLink from "../ui/TrackedLink";
import { baseFeatures, pricingStructure } from "@/content/site";
import {
  activeTiers,
  initialSetup,
  monitorHeadline,
  monitorOffer,
  optionCatalog,
  setupPriceLabel,
  taxNote,
  tierPriceLabel,
  type OsTier,
} from "@/config/pricing";
import LaborCompare from "./LaborCompare";
import { EV } from "@/lib/track";

/**
 * 金額のすぐ隣に必ず並べる「含まれる運営業務」。
 * 月額の数字だけを単独で見せると、安いだけのサービスと同じ土俵で比べられます。
 */
const INCLUDED_WORK = [
  "ガチャ設計の時間",
  "還元率の管理",
  "景品の価格確認",
  "発送",
  "問い合わせ対応",
  "赤字リスクの監視",
];

const EQUATION = [
  { k: "SYSTEM", j: "ガチャの土台" },
  { k: "AI", j: "設計と判断の支援" },
  { k: "AUTOMATION", j: "発送・対応の自動化" },
  { k: "SUPPORT", j: "監視と改善の継続" },
];

export default function Pricing() {
  return (
    <Section
      id="pricing"
      no="22"
      eyebrow="PRICING"
      title={
        <>
          作って終わりではなく、
          <br />
          毎月使い続けるOSとして。
        </>
      }
      lead={pricingStructure.lead}
    >
      {/* AI GACHA OS = SYSTEM + AI + AUTOMATION + SUPPORT */}
      <Reveal>
        <div className="lp-tint overflow-hidden rounded-3xl px-7 py-8 sm:px-10 sm:py-9">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-5">
            <span className="num text-h3 font-semibold tracking-[0.04em] text-gradient-royal">
              AI GACHA OS
            </span>
            <span className="num text-h3 font-light text-slate3/60">=</span>
            {EQUATION.map((e, i) => (
              <span key={e.k} className="flex items-center gap-4">
                {i > 0 && (
                  <span className="num text-h3 font-light text-slate3/60">+</span>
                )}
                <span className="rounded-2xl border border-edge bg-white px-5 py-3.5 shadow-lift">
                  <span className="num block text-label text-blue-ink">
                    {e.k}
                  </span>
                  <span className="mt-1.5 block text-note text-slate2">
                    {e.j}
                  </span>
                </span>
              </span>
            ))}
          </div>
        </div>
      </Reveal>

      {/* 3ブロック構成 */}
      <Reveal delay={0.06} className="mt-5">
        <div className="grid gap-5 md:grid-cols-3">
          {pricingStructure.blocks.map((b, i) => (
            <div
              key={b.code}
              className={`rounded-3xl border p-7 shadow-lift sm:p-8 ${
                i === 1
                  ? "border-blue-ink/20 bg-gradient-to-b from-blue-pale/70 to-white"
                  : "border-edge bg-white"
              }`}
            >
              <span
                className={`num text-label ${
                  i === 1 ? "text-blue-ink" : "text-slate3"
                }`}
              >
                {b.code}
              </span>
              <p className="mt-5 text-h3 font-semibold text-slate">{b.name}</p>
              <p className="mt-4 text-note text-slate2">{b.body}</p>
            </div>
          ))}
        </div>
      </Reveal>

      {/* 料金セクションがどれだけ見られているかを計測する */}
      <ViewTracker event={EV.pricingView} />

      {/* ── 比べる軸を先に示す（月額の安さ比べにさせない） ── */}
      <LaborCompare />

      {/* ── MONTHLY OS：STARTER / GROWTH / ENTERPRISE ── */}
      <GroupHead
        code="MONTHLY OS"
        title="月額OS利用料"
        note="システム利用・AI機能・監視・保守・アップデートを含みます。"
      />

      {/* 金額の前に「何が含まれるか」を置く。月額だけを単独で見せない */}
      <Reveal delay={0.04} className="mt-7">
        <div className="lp-card px-7 py-8 sm:px-9">
          <p className="text-body font-bold text-slate">
            この金額に含まれるのは、下の6つの運営業務です。
          </p>
          <ul className="mt-6 flex flex-wrap gap-2.5">
            {INCLUDED_WORK.map((w) => (
              <li
                key={w}
                className="rounded-full border border-edge bg-paper2 px-4 py-2 text-note leading-normal text-slate2"
              >
                {w}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-note text-slate2">
            1人分の作業を置き換えるのではなく、
            <span className="font-bold text-slate">運営業務そのものを減らす</span>
            ための金額です。
          </p>
        </div>
      </Reveal>

      <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {activeTiers.map((t, i) => (
          <Reveal key={t.key} delay={0.08 + i * 0.05}>
            <TierCard tier={t} />
          </Reveal>
        ))}
      </div>

      {monitorOffer.enabled && (
        <Reveal delay={0.2} className="mt-5">
          <div className="rounded-3xl border border-gold-deep/25 bg-gold/[0.06] px-7 py-7 shadow-lift sm:px-9">
            <span className="num text-label text-gold-deep">MONITOR</span>
            <p className="mt-4 text-h3 font-semibold text-slate">
              {monitorHeadline()}
            </p>
            <p className="mt-4 text-note text-slate2">{monitorOffer.body}</p>

            <p className="mt-7 border-t border-gold-deep/15 pt-6 text-note font-bold text-slate">
              ご協力いただく内容
            </p>
            <ul className="mt-4 space-y-3">
              {monitorOffer.conditions.map((c) => (
                <li key={c} className="flex gap-3.5 text-note text-slate2">
                  <span className="mt-[12px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold-deep/60" />
                  {c}
                </li>
              ))}
            </ul>

            {monitorOffer.target === "os" && (
              <p className="mt-5 text-note text-slate3">
                無料になるのは月額のOS利用料です。初期構築費は別途かかります。
              </p>
            )}
          </div>
        </Reveal>
      )}

      {/* ── INITIAL SETUP ── */}
      <GroupHead
        code={initialSetup.code}
        title={initialSetup.name}
        note="初回のみ発生します。月額とは別枠です。"
      />

      <Reveal delay={0.08} className="mt-7">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
          <div className="flex flex-col rounded-3xl border border-blue-ink/20 bg-gradient-to-b from-blue-pale/70 to-white p-7 shadow-lift2 sm:p-8">
            <p className="num text-label text-blue-ink">初期構築費</p>
            <p className="num mt-5 text-h3 font-semibold leading-tight text-slate">
              {setupPriceLabel}
            </p>
            <p className="mt-6 border-t border-edge2 pt-6 text-note text-slate2">
              {initialSetup.lead}
            </p>
            <a href="#contact" className="btn-outline mt-8 w-full">
              自社の場合の初期費用を聞く
            </a>
          </div>

          <div className="rounded-3xl border border-edge bg-white p-7 shadow-lift sm:p-8">
            <span className="num text-label text-slate3">INCLUDED</span>
            <ul className="mt-7 grid gap-3.5 sm:grid-cols-2">
              {initialSetup.includes.map((t) => (
                <li key={t} className="flex gap-3.5 text-note text-slate2">
                  <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-ink/70" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-7 border-t border-edge2 pt-6 text-note text-slate3">
              {initialSetup.note}
            </p>
          </div>
        </div>
      </Reveal>

      {/* ── OPTION（数が多いので3つのまとまりで見せ、詳細は開いた人だけに出す） ── */}
      <Reveal delay={0.06} className="mt-24">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-4">
            <span className="num text-label text-slate3">OPTION</span>
            <span className="h-px w-10 bg-edge" />
            <h3 className="h-display text-h3 text-slate">
              運営まで任せたい方へ。
            </h3>
          </div>
          <p className="text-note text-slate3">
            初期導入時に全部を選ぶ必要はありません。
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.1} className="mt-7">
        <div className="grid gap-5 lg:grid-cols-3">
          {optionCatalog.map((g) => (
            <div
              key={g.code}
              className="flex h-full flex-col rounded-3xl border border-edge bg-white p-7 shadow-lift transition-all duration-300 hover:border-gold-deep/30 hover:shadow-lift2 sm:p-8"
            >
              <span className="num text-label text-gold-deep">{g.code}</span>
              <p className="mt-5 text-h3 font-semibold text-slate">{g.name}</p>
              <p className="mt-4 text-note text-slate2">{g.body}</p>

              <div className="mt-6 flex flex-wrap gap-2">
                {g.items.map((o) => (
                  <span
                    key={o.name}
                    className="rounded-full border border-edge bg-paper2 px-3.5 py-1.5 text-note leading-normal text-slate2"
                  >
                    {o.name}
                  </span>
                ))}
              </div>

              <details className="group mt-auto pt-7">
                <summary className="cursor-pointer list-none text-note font-medium text-slate3 transition-colors hover:text-blue-ink">
                  ＋ 内容を見る
                </summary>
                <ul className="mt-5 space-y-5 border-t border-edge2 pt-6">
                  {g.items.map((o) => (
                    <li key={o.name}>
                      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-note font-bold text-slate">
                        {o.name}
                        <span className="num text-note font-normal text-slate3">
                          {o.yen === null
                            ? "個別お見積り"
                            : `${o.unit === "都度" ? "" : "月額 "}${o.yen.toLocaleString("ja-JP")}円`}
                        </span>
                      </p>
                      <p className="mt-1.5 text-note text-slate2">{o.body}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
        </div>
      </Reveal>

      {/* 標準機能 */}
      <Reveal delay={0.14} className="mt-5">
        <div className="grid gap-5 lg:grid-cols-2">
          {(
            [
              { t: "ユーザー側 標準機能", list: baseFeatures.user },
              { t: "管理画面 標準機能", list: baseFeatures.admin },
            ] as const
          ).map((b) => (
            <div key={b.t} className="lp-card p-7 sm:p-8">
              <span className="num text-label text-slate3">{b.t}</span>
              <ul className="mt-7 space-y-3.5">
                {b.list.map((t) => (
                  <li key={t} className="flex gap-3.5 text-note text-slate2">
                    <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-ok-ink/60" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.18}>
        <p className="mx-auto mt-10 max-w-3xl text-center text-note text-slate3">
          ※ {taxNote}要件・移行の有無・演出の量・件数によって変動します。決済手数料・AWS利用料・ドメイン費用は別途実費となります。オプションは内容ごとの個別見積りです。
        </p>
      </Reveal>
    </Section>
  );
}

function GroupHead({
  code,
  title,
  note,
}: {
  code: string;
  title: string;
  note: string;
}) {
  return (
    <Reveal delay={0.06} className="mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-4">
          <span className="num text-label text-slate3">{code}</span>
          <span className="h-px w-10 bg-edge" />
          <h3 className="h-display text-h3 text-slate">{title}</h3>
        </div>
        <p className="text-note text-slate3">{note}</p>
      </div>
    </Reveal>
  );
}

function TierCard({ tier }: { tier: OsTier }) {
  return (
    <div
      className={`relative flex h-full flex-col rounded-3xl border p-7 transition-all duration-300 sm:p-8 ${
        tier.featured
          ? "border-blue-ink/20 bg-gradient-to-b from-blue-pale/70 to-white shadow-lift2 hover:shadow-blue-lift"
          : "border-edge bg-white shadow-lift hover:shadow-lift2"
      }`}
    >
      {tier.note && (
        <span
          className={`absolute -top-3.5 left-7 rounded-full border bg-white px-4 py-1.5 text-note font-semibold leading-normal shadow-lift ${
            tier.featured
              ? "border-blue-ink/25 text-blue-ink"
              : "border-gold-deep/30 text-gold-deep"
          }`}
        >
          {tier.note}
        </span>
      )}

      <p
        className={`num text-label font-bold ${
          tier.featured ? "text-blue-ink" : "text-slate3"
        }`}
      >
        {tier.name}
      </p>
      <p className="mt-3 text-note text-slate2">{tier.target}</p>

      <p className="num mt-7 text-h3 font-semibold leading-tight text-slate">
        {tierPriceLabel(tier)}
      </p>
      <p className="mt-2.5 text-note text-slate3">{taxNote}</p>

      <ul className="mt-7 flex-1 space-y-3.5 border-t border-edge2 pt-7">
        {tier.inherits && (
          <li className="flex gap-3.5 text-note font-bold text-slate">
            <span
              className={`mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full ${
                tier.featured ? "bg-blue-ink" : "bg-slate3/60"
              }`}
            />
            {tier.inherits}
          </li>
        )}
        {tier.points.map((t) => (
          <li key={t} className="flex gap-3.5 text-note text-slate2">
            <span
              className={`mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full ${
                tier.featured ? "bg-blue-ink/70" : "bg-slate3/45"
              }`}
            />
            {t}
          </li>
        ))}
      </ul>

      {/* どのプランのボタンが押されたかを残す（プラン別の成約率を出すため）。
          plan を渡すと、計測だけでなく問い合わせ内容にも一緒に届く。 */}
      <TrackedLink
        href="#contact"
        event={EV.planSelect}
        params={{ plan: tier.key }}
        plan={tier.key}
        className={`mt-9 w-full ${tier.featured ? "btn-primary" : "btn-outline"}`}
      >
        このプランで相談する
      </TrackedLink>
    </div>
  );
}
