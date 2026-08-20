import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { security } from "@/content/site";

const icons: Record<string, string> = {
  抽選の整合性: "M8 1.5l5.5 2.4v4.2c0 3.3-2.3 6.2-5.5 7-3.2-.8-5.5-3.7-5.5-7V3.9L8 1.5z",
  決済とポイント: "M2 4.5h12v7H2v-7zm0 2.6h12M4.5 9.6h2.5",
  アプリケーション防御: "M8 1.5l5.5 2.4v4.2c0 3.3-2.3 6.2-5.5 7-3.2-.8-5.5-3.7-5.5-7V3.9L8 1.5zM8 6v3M8 10.6v.2",
  データ保護: "M4.5 7V5a3.5 3.5 0 017 0v2M3.5 7h9v6.5h-9V7z",
};

export default function Security() {
  return (
    <Section
      id="security"
      no="18"
      eyebrow="SECURITY & INTEGRITY"
      title={
        <>
          「たぶん大丈夫」で、
          <br />
          お金は預かれない。
        </>
      }
      lead="ガチャは、抽選とポイントとお金が同時に動きます。二重抽選・残数のズレ・不正なポイント付与は、起きてから直すのでは遅い領域です。以下は、構築時の標準設計に含める項目です。"
    >
      <Reveal>
        <p className="mb-5 rounded-2xl border border-edge bg-paper2 px-6 py-6 text-note text-slate2">
          <span className="mr-3 inline-block rounded-full border border-edge bg-white px-3.5 py-1 text-note leading-normal text-blue-ink">
            標準設計
          </span>
          ここに挙げているのは、構築時の標準設計に含める項目です。適用範囲・強度はご要件と規模に応じて設計し、設定が必要な項目（多要素認証・IP制限など）は個別に取り決めます。
        </p>
      </Reveal>

      <div className="grid gap-5 sm:grid-cols-2">
        {security.map((g, i) => (
          <Reveal key={g.group} delay={i * 0.05}>
            <div className="lp-card group h-full p-7 transition-all duration-300 hover:border-blue-ink/25 hover:shadow-lift2 sm:p-9">
              <div className="flex items-center gap-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-ink/15 bg-blue-pale">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d={icons[g.group]}
                      stroke="#1B4BD8"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <h3 className="h-display text-h3 text-slate">{g.group}</h3>
              </div>
              <ul className="mt-8 space-y-3.5 border-t border-edge2 pt-7">
                {g.items.map((t) => (
                  <li key={t} className="flex gap-3.5 text-note text-slate2">
                    <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-ink/60" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.14}>
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {[
            {
              t: "同じ操作が2回走っても、抽選は1回",
              d: "通信の再送やボタンの連打で同じリクエストが届いた場合、2回目を無効化する設計にします。残数と履歴が食い違わないようにするための基本方針です。",
            },
            {
              t: "決済の通知は、署名を確かめてから受け取る",
              d: "決済事業者からの通知は署名検証を通ったものだけを処理する設計にします。同じ通知が複数回届いてもポイント付与が重ならないようにします。",
            },
            {
              t: "第三者によるコード監査を前提にする",
              d: "抽選整合性・残数競合・ポイント不正・個人情報の扱いについて、開発者とは別の視点で点検する工程を組み込みます。",
            },
          ].map((x) => (
            <div key={x.t} className="rounded-3xl border border-edge bg-paper2 p-7 sm:p-8">
              <h4 className="text-note font-bold leading-[1.75] text-slate">{x.t}</h4>
              <p className="mt-4 text-note text-slate2">{x.d}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
