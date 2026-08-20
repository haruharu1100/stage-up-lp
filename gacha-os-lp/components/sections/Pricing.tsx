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
import { MoreDetail } from "../ui/Act";
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

/**
 * 3プランの違いを1行だけで示す要約。
 * 細かい機能の対照表は作らず、「どこから入ればよいか」が分かる粒度に留めます。
 * 金額は書きません（金額の出どころは config/pricing.ts の1か所だけ）。
 */
const TIER_SUMMARY = [
  { key: "STARTER", diff: "ガチャ運営に必要な機能ひと通り。まずここから始められます。" },
  { key: "GROWTH", diff: "STARTERに、複数ガチャの横断分析と自動警告・優先サポートが加わります。" },
  { key: "ENTERPRISE", diff: "GROWTHに、複数サイトの一括管理と独自開発・専任サポートが加わります。" },
];

/** カードに最初から見せる機能の数。残りは開いた人にだけ出す */
const VISIBLE_POINTS = 5;

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
      no="24"
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
      {/* ── 料金カードまでの距離を縮める。
             前置きは「金額に何が含まれるか」の1つだけを出し、
             残り（OSの構成式・3ブロック・プラン差分）は開いた人にだけ出す ── */}
      <Reveal>
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

      <Reveal delay={0.06} className="mt-4">
        <MoreDetail label="料金の考え方（OSの構成・3つのブロック・プランの違い）">
          {/* AI GACHA OS = SYSTEM + AI + AUTOMATION + SUPPORT */}
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

          {/* 3ブロック構成 */}
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {pricingStructure.blocks.map((b, i) => (
              <div
                key={b.code}
                className={`rounded-2xl border p-6 ${
                  i === 1
                    ? "border-blue-ink/20 bg-blue-pale"
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
                <p className="mt-4 text-h3 font-semibold text-slate">{b.name}</p>
                <p className="mt-3 text-note text-slate2">{b.body}</p>
              </div>
            ))}
          </div>

          {/* 3プランの違いを1行で。表を細かくしないための要約 */}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {TIER_SUMMARY.map((s, i) => (
              <div
                key={s.key}
                className={`rounded-2xl border px-6 py-5 ${
                  i === 0
                    ? "border-blue-ink/25 bg-blue-pale"
                    : "border-edge bg-paper2"
                }`}
              >
                <span
                  className={`num text-label ${
                    i === 0 ? "text-blue-ink" : "text-slate3"
                  }`}
                >
                  {s.key}
                </span>
                <p className="mt-3 text-note text-slate2">{s.diff}</p>
              </div>
            ))}
          </div>
        </MoreDetail>
      </Reveal>

      {/* 料金セクションがどれだけ見られているかを計測する */}
      <ViewTracker event={EV.pricingView} />

      {/* ── MONTHLY OS：STARTER / GROWTH / ENTERPRISE ── */}
      <GroupHead
        code="MONTHLY OS"
        title="月額OS利用料"
        note="システム利用・AI機能・監視・保守・アップデートを含みます。"
      />

      {/* ── 金額を出す前に、比べる相手を示す（ROIセクションへ戻す） ── */}
      <Reveal className="mt-7">
        <div className="flex flex-col gap-6 rounded-3xl border border-blue-ink/20 bg-gradient-to-b from-blue-pale/70 to-white px-7 py-8 shadow-lift sm:px-10 sm:py-9 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="num text-label text-blue-ink">BEFORE YOU LOOK</span>
            <p className="mt-5 text-h3 font-semibold leading-[1.6] text-slate">
              金額を見る前に、いまの運営コストと比べてください。
            </p>
            <p className="mt-4 max-w-[38em] text-note text-slate2">
              比べる相手は、他社システムの月額ではありません。いま実際にかかっている人の時間と人件費です。導入効果の試算に自社の数字を入れると、その差額が出ます。
            </p>
          </div>
          <a href="#roi" className="btn-outline shrink-0 lg:min-w-[260px]">
            今の運営コストを試算する
          </a>
        </div>
      </Reveal>

      {/* 比べる軸そのもの（人件費・時間・事故リスクの試算）は、
          読みたい人にだけ開いてもらう。内容は LaborCompare のまま */}
      <Reveal delay={0.04} className="mt-4">
        <MoreDetail label="人件費・時間・事故リスクで比べる（モデルケースの試算）">
          <div className="[&>*:first-child]:mt-0">
            <LaborCompare />
          </div>
        </MoreDetail>
      </Reveal>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {activeTiers.map((t, i) => (
          <Reveal key={t.key} delay={0.08 + i * 0.05}>
            <TierCard tier={t} />
          </Reveal>
        ))}
      </div>

      {monitorOffer.enabled && (
        <Reveal delay={0.2} className="mt-4">
          <MoreDetail label={monitorHeadline()}>
            <p className="text-note text-slate2">{monitorOffer.body}</p>

            <p className="mt-6 text-note font-bold text-slate">
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
          </MoreDetail>
        </Reveal>
      )}

      {/* ── INITIAL SETUP（検討が進んだ人だけが読む枠なので畳む。金額は見出しに出す） ── */}
      <Reveal delay={0.06} className="mt-4">
        <MoreDetail
          label={`${initialSetup.name}（初回のみ・月額とは別枠）　${setupPriceLabel}`}
        >
          <p className="text-note text-slate2">{initialSetup.lead}</p>

          <p className="mt-6 text-note font-bold text-slate">
            初期構築費に含まれるもの
          </p>
          <ul className="mt-4 grid gap-3.5 sm:grid-cols-2">
            {initialSetup.includes.map((t) => (
              <li key={t} className="flex gap-3.5 text-note text-slate2">
                <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-ink/70" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t border-edge2 pt-6 text-note text-slate3">
            {initialSetup.note}
          </p>
          <a href="#contact" className="btn-outline mt-6 w-full">
            自社の場合の費用を相談する
          </a>
        </MoreDetail>
      </Reveal>

      {/* ── OPTION（名前のチップと内訳の二重表示をやめ、内訳1本にまとめて畳む） ── */}
      <Reveal delay={0.08} className="mt-4">
        <MoreDetail label="オプション：運営まで任せたい方へ（集客・運営・商品）">
          <p className="text-note text-slate3">
            初期導入時に全部を選ぶ必要はありません。
          </p>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {optionCatalog.map((g) => (
              <div
                key={g.code}
                className="rounded-2xl border border-edge bg-white p-6"
              >
                <span className="num text-label text-gold-deep">{g.code}</span>
                <p className="mt-4 text-h3 font-semibold text-slate">{g.name}</p>
                <p className="mt-3 text-note text-slate2">{g.body}</p>

                <ul className="mt-5 space-y-4 border-t border-edge2 pt-5">
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
              </div>
            ))}
          </div>
        </MoreDetail>
      </Reveal>

      {/* 標準機能（一覧が長いので畳む。中身はそのまま） */}
      <Reveal delay={0.1} className="mt-4">
        <MoreDetail label="標準機能の一覧（ユーザー側／管理画面）">
          <div className="grid gap-5 lg:grid-cols-2">
            {(
              [
                { t: "ユーザー側 標準機能", list: baseFeatures.user },
                { t: "管理画面 標準機能", list: baseFeatures.admin },
              ] as const
            ).map((b) => (
              <div key={b.t}>
                <span className="num text-label text-slate3">{b.t}</span>
                <ul className="mt-5 space-y-3.5">
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
        </MoreDetail>
      </Reveal>

      <Reveal delay={0.18}>
        <p className="mx-auto mt-8 max-w-3xl text-center text-note text-slate3">
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
    <Reveal delay={0.06} className="mt-12 sm:mt-24">
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
  /** 入口として示すプラン。位置（先頭）とバッジの両方で分かるようにする */
  const isEntry = tier.key === "starter";
  const badge = isEntry ? "まずここから" : tier.note;
  const visible = tier.points.slice(0, VISIBLE_POINTS);
  const rest = tier.points.slice(VISIBLE_POINTS);

  return (
    <div
      className={`relative flex h-full flex-col rounded-3xl border p-7 transition-all duration-300 sm:p-8 ${
        isEntry
          ? "border-blue-ink/30 bg-white shadow-lift2 hover:shadow-blue-lift"
          : tier.featured
            ? "border-blue-ink/20 bg-gradient-to-b from-blue-pale/70 to-white shadow-lift2 hover:shadow-blue-lift"
            : "border-edge bg-white shadow-lift hover:shadow-lift2"
      }`}
    >
      {badge && (
        <span
          className={`absolute -top-3.5 left-7 rounded-full border px-4 py-1.5 text-note font-semibold leading-normal shadow-lift ${
            isEntry
              ? "border-blue-ink/25 bg-blue-ink text-white"
              : tier.featured
                ? "border-blue-ink/25 bg-white text-blue-ink"
                : "border-gold-deep/30 bg-white text-gold-deep"
          }`}
        >
          {badge}
        </span>
      )}

      <p
        className={`num text-label font-bold ${
          tier.featured || isEntry ? "text-blue-ink" : "text-slate3"
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
        {visible.map((t) => (
          <li key={t} className="flex gap-3.5 text-note text-slate2">
            <span
              className={`mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full ${
                tier.featured || isEntry ? "bg-blue-ink/70" : "bg-slate3/45"
              }`}
            />
            {t}
          </li>
        ))}

        {/* 残りは開いた人にだけ。カードを一覧表にしない */}
        {rest.length > 0 && (
          <li>
            <details className="group">
              <summary className="cursor-pointer list-none text-note font-medium text-slate3 transition-colors hover:text-blue-ink">
                ＋ ほか{rest.length}項目
              </summary>
              <ul className="mt-4 space-y-3.5">
                {rest.map((t) => (
                  <li key={t} className="flex gap-3.5 text-note text-slate2">
                    <span
                      className={`mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full ${
                        tier.featured || isEntry
                          ? "bg-blue-ink/70"
                          : "bg-slate3/45"
                      }`}
                    />
                    {t}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        )}
      </ul>

      {/* どのプランのボタンが押されたかを残す（プラン別の成約率を出すため）。
          plan を渡すと、計測だけでなく問い合わせ内容にも一緒に届く。 */}
      <TrackedLink
        href="#contact"
        event={EV.planSelect}
        params={{ plan: tier.key }}
        plan={tier.key}
        className={`mt-9 w-full ${
          tier.featured || isEntry ? "btn-primary" : "btn-outline"
        }`}
      >
        自社の場合の費用を相談する
      </TrackedLink>
    </div>
  );
}
