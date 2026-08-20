import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";

/**
 * ブロックA：ガチャを公開するまでの5ステップ（量で語る。所要時間は書かない）
 * ブロックB：人とAIの役割分担（左は少なく、右は多い。その差を見せる）
 */

type LaunchStep = {
  no: string;
  title: string;
  body: string;
  /** 入力例を添える最初のステップだけ持つ */
  sample?: string;
};

const launchSteps: LaunchStep[] = [
  {
    no: "01",
    title: "条件を入力",
    body: "1回料金・総口数・ジャンル・目標還元率。入力する項目はこれだけです。",
    sample: "例：500円 / 1000口 / スニーカー / 還元率93%",
  },
  {
    no: "02",
    title: "AIが賞の構成を設計",
    body: "等級ごとの景品と本数、当選確率、想定売上・原価・粗利までを一度に組み上げます。候補は複数案から選べます。",
  },
  {
    no: "03",
    title: "公開前バックテスト",
    body: "景品相場が動いた場合や、当たりが早く出た場合の収益を、公開する前に確認できます。",
  },
  {
    no: "04",
    title: "内容を確認して承認",
    body: "数字を見て、直すか進めるかを決めるのは人です。承認しないかぎり公開されません。",
  },
  {
    no: "05",
    title: "販売開始",
    body: "承認したガチャが公開され、同時に実還元率の監視が始まります。",
  },
];

const humanTasks = [
  { title: "商品を決める", body: "どの景品を扱うか。ここは事業の中身そのものです。" },
  { title: "条件を決める", body: "料金・口数・目標還元率。方針を決めるのは人の判断です。" },
  { title: "内容を確認する", body: "AIが出した構成を見て、承認するか作り直すかを決めます。" },
  { title: "仕入れる", body: "決めた景品を実際に仕入れます。ここは人の仕事として残ります。" },
];

const osTasks = [
  "ガチャ構成",
  "還元率計算",
  "バックテスト",
  "価格監視",
  "販売中監視",
  "発送管理",
  "問い合わせ対応",
  "データ分析",
];

export default function RoleSplit() {
  return (
    <Section
      id="role"
      no="02"
      eyebrow="YOUR PART / OUR PART"
      title={
        <>
          あなたがすることは、
          <br />
          思っているより少なくなります。
        </>
      }
      lead="難しい設定から始まりません。最初に決めるのは、扱う商品と、いくらで何口売るか。そこから先は、AI GACHA OS が受け持ちます。"
    >
      {/* ───────── ブロックA：公開までの5ステップ ───────── */}
      <Reveal>
        <div className="lp-card overflow-hidden p-5 sm:p-9">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span className="eyebrow-lite">STEPS TO LAUNCH</span>
            <span className="num text-label text-slate3">5 STEPS</span>
          </div>
          <p className="mt-5 max-w-[40em] text-body text-pretty text-slate sm:mt-6">
            ガチャを1本公開するまでに通る道は、5つです。
          </p>

          <ol className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-9 sm:gap-3 lg:grid-cols-5">
            {launchSteps.map((s) => (
              <li
                key={s.no}
                className="relative flex h-full flex-col rounded-2xl border border-edge2 bg-paper2 p-4 sm:p-6"
              >
                <div className="flex items-baseline gap-2.5">
                  <span className="num text-label text-slate3">STEP</span>
                  <span className="num text-h3 font-semibold leading-none text-blue-ink">
                    {s.no}
                  </span>
                </div>
                <h3 className="mt-3 text-body font-bold text-pretty text-slate sm:mt-5">
                  {s.title}
                </h3>
              </li>
            ))}
          </ol>

          <p className="mt-5 text-note text-pretty text-slate2">
            数字を見て、直すか進めるかを決めるのは人です。承認しないかぎり公開されません。
          </p>

          {/* 各ステップの補足は消さずにここへ畳む */}
          <div className="mt-4">
            <MoreDetail label="各ステップで何をするか">
              <ol className="space-y-4">
                {launchSteps.map((s) => (
                  <li key={s.no}>
                    <span className="num text-label text-slate3">
                      STEP {s.no}
                    </span>
                    <p className="mt-1 font-bold text-slate">{s.title}</p>
                    <p className="mt-1 text-pretty">{s.body}</p>
                    {s.sample ? (
                      <p className="num mt-2 text-blue-ink">{s.sample}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </MoreDetail>
          </div>
        </div>
      </Reveal>

      {/* ───────── ブロックB：役割分担の対比 ───────── */}
      <Reveal delay={0.08} className="mt-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* 左：あなたがすること（少ない・大きいカード） */}
          <div className="lp-card flex flex-col p-5 sm:p-9">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <span className="text-body font-bold text-slate">
                あなたがすること
              </span>
              <span className="num text-label text-slate3">4 ITEMS</span>
            </div>
            <div className="mt-5 grid flex-1 grid-cols-2 gap-2.5 sm:mt-8 sm:gap-3">
              {humanTasks.map((t) => (
                <div
                  key={t.title}
                  className="flex h-full flex-col rounded-2xl border border-edge bg-white p-4 shadow-lift sm:p-6"
                >
                  <p className="text-body font-bold text-pretty text-slate">
                    {t.title}
                  </p>
                  <p className="mt-2.5 text-note text-pretty text-slate2 sm:mt-3.5">
                    {t.body}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* 右：AI GACHA OS が支えること（多い・小さいチップ） */}
          <div className="lp-tint flex flex-col rounded-3xl p-5 sm:p-9">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <span className="text-body font-bold text-slate">
                AI GACHA OS が支えること
              </span>
              <span className="num text-label text-slate3">8 ITEMS</span>
            </div>
            <div className="mt-5 flex flex-1 flex-wrap content-start gap-2 sm:mt-8 sm:gap-2.5">
              {osTasks.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-2.5 rounded-full border border-blue-ink/15 bg-blue-pale px-3.5 py-2 text-note font-semibold text-blue-ink sm:px-4 sm:py-2.5"
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-ink/60"
                  />
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-5 border-t border-edge2 pt-5 text-note text-pretty text-slate2 sm:mt-8 sm:pt-6">
              販売中の監視でも、AIがするのは「検知して知らせる」ところまでです。
              販売を止めるかどうかは、管理画面で人が判断します。
            </p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.14} className="mt-5">
        <div className="rounded-3xl border border-edge bg-white px-6 py-7 text-center shadow-lift sm:px-10 sm:py-10">
          <p className="h-display text-h3 text-balance text-slate">
            運営をなくすのではなく、面倒な部分を減らします。
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
