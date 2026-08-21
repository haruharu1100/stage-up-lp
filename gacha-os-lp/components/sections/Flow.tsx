import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";

/**
 * 導入すると何が起きるかの時間軸。
 *
 * ★期間の表示について（景品表示法）
 * 　「2週間で公開」のような所要日数はここに書きません。
 * 　必要な作業量は、移行の有無・独自機能・決済の審査状況で大きく変わるためです。
 * 　DAY 1 だけは「初回のヒアリング」の意味で使い、それ以降の段階に日数を振りません。
 */
const STAGES: { code: string; title: string; body: string }[] = [
  {
    code: "DAY 1",
    title: "ヒアリング",
    body: "いまの運営体制と、どこに時間が溶けているかをうかがい、必要な機能範囲をここで決めます。",
  },
  {
    code: "SETUP",
    title: "ブランド・決済・配送などの設定",
    body: "ロゴと配色、決済の接続、発送と伝票の流れ、AWS環境、ガチャの等級構成。運営の型をそのまま設定に落とします。",
  },
  {
    code: "TEST",
    title: "デモ・動作確認",
    body: "テスト環境で実際に触っていただきます。抽選・ポイント・発送・管理画面を、公開前にご自身の目で確認できます。",
  },
  {
    code: "LAUNCH",
    title: "運営開始",
    body: "公開前チェックを通してから本番公開。管理画面の操作は、初期研修としてご説明します。",
  },
  {
    code: "SUPPORT",
    title: "継続改善",
    body: "公開後は監視と保守を継続します。実際の運営データを見ながら、還元率の設定や運用の手順を一緒に整えていきます。",
  },
];

export default function Flow() {
  return (
    <Section
      id="flow"
      no=""
      eyebrow="ONBOARDING"
      title={
        <>
          相談してから、
          <br />
          運営が始まるまで。
        </>
      }
      lead="いきなり作り始めません。現状を整理してから、必要な機能範囲とインフラ構成を確定します。"
    >
      {/* PC：横に並べる。スマホ：2列に並べて縦の長さを抑える */}
      <div className="relative">
        {/* 横のつなぎ線（PCのみ） */}
        <div className="absolute left-0 right-0 top-[17px] hidden h-px bg-edge lg:block" />

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5 lg:gap-3">
          {STAGES.map((s, i) => {
            const last = i === STAGES.length - 1;
            return (
              <Reveal key={s.code} delay={i * 0.06} className="h-full">
                <div className="relative flex h-full flex-col">
                  {/* 段階の名前。線の上に乗せるので白背景を敷く */}
                  <div className="relative z-10 flex items-center gap-3">
                    <span
                      className={`num inline-flex items-center rounded-full border px-3 py-1.5 text-label sm:px-4 sm:py-2 ${
                        i === 0
                          ? "border-blue-ink/25 bg-blue-pale text-blue-ink"
                          : last
                            ? "border-edge bg-paper2 text-slate2"
                            : "border-edge bg-white text-slate2"
                      }`}
                    >
                      {s.code}
                    </span>
                    <span className="h-px flex-1 bg-edge lg:hidden" />
                  </div>

                  <div className="mt-3 flex-1 rounded-3xl border border-edge bg-white p-5 shadow-lift transition-all duration-300 hover:shadow-lift2 sm:mt-5 sm:p-7">
                    <h3 className="text-body font-bold leading-[1.7] text-slate">
                      {s.title}
                    </h3>
                    <p className="mt-3 text-note text-slate2">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>

      <Reveal delay={0.14}>
        <p className="mt-5 rounded-2xl border border-edge bg-paper2 px-5 py-5 text-note text-slate2 sm:mt-8 sm:px-6">
          <span className="mr-3 inline-block rounded-full border border-edge bg-white px-3.5 py-1 text-note leading-normal text-blue-ink">
            期間について
          </span>
          かかる期間は、既存サイトからの移行の有無・独自機能・決済の審査状況によって変わります。あらかじめ日数をお約束することはしていません。ご要件をうかがったうえで、想定される進め方と目安をお伝えします。
        </p>
      </Reveal>

      {/* ご用意いただくもの（WHAT YOU PREPARE）は、
          具体的に検討が進んだ人だけが読む内容なので畳んでおく */}
      <Reveal delay={0.18} className="mt-4">
        <MoreDetail label="ご用意いただくもの（3つ）">
          <div className="grid gap-5 sm:grid-cols-3">
            {[
              { t: "商品の仕入れ", d: "景品そのものと、その仕入れ判断。ここだけは人の仕事として残ります。" },
              { t: "サイトの方向性", d: "扱うジャンル、ブランドの雰囲気、既存サイトがあればその情報。" },
              { t: "各種アカウント", d: "決済事業者・ドメイン・AWS。取得からご一緒することもできます。" },
            ].map((x) => (
              <div key={x.t}>
                <p className="text-note font-bold text-slate">{x.t}</p>
                <p className="mt-2.5 text-note text-slate2">{x.d}</p>
              </div>
            ))}
          </div>
        </MoreDetail>
      </Reveal>
    </Section>
  );
}
