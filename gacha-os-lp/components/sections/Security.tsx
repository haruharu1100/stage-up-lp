import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";
import { security } from "@/content/site";
import { BACKTEST_ENGINE_VERSION, RUNS } from "@/lib/backtest";
import { STALE_AFTER_HOURS } from "@/lib/priceFreshness";

const icons: Record<string, string> = {
  抽選の整合性: "M8 1.5l5.5 2.4v4.2c0 3.3-2.3 6.2-5.5 7-3.2-.8-5.5-3.7-5.5-7V3.9L8 1.5z",
  決済とポイント: "M2 4.5h12v7H2v-7zm0 2.6h12M4.5 9.6h2.5",
  アプリケーション防御: "M8 1.5l5.5 2.4v4.2c0 3.3-2.3 6.2-5.5 7-3.2-.8-5.5-3.7-5.5-7V3.9L8 1.5zM8 6v3M8 10.6v.2",
  データ保護: "M4.5 7V5a3.5 3.5 0 017 0v2M3.5 7h9v6.5h-9V7z",
};

/**
 * 回帰テストの件数。
 *
 * ★数字を書き換えるときは、必ず `npm test` を実際に流して
 *   最後に出る「# pass ◯◯」の値に合わせてください（推測で書かない）。
 *   実行対象は tests/backtest.golden / backtest.invariants / backtest.extreme です。
 */
const REGRESSION_TESTS = 57;

/** 価格が「古い」と判断されるまでの日数（lib/priceFreshness.ts の設定から算出） */
const STALE_AFTER_DAYS = Math.round(STALE_AFTER_HOURS / 24);

/** 折りたたみの中に入れる技術的な内訳。すべて実装を確認したものだけ */
const QUALITY_DETAIL: { t: string; d: string }[] = [
  {
    t: `回帰テスト ${REGRESSION_TESTS}件`,
    d: "公開前バックテストの計算を対象に、数字そのものを固定して見張っています。極端な入力（口数1・料金1円・景品0本・在庫超過など）でも計算が壊れないこと、危ない構成で「このまま公開できます」と出ないことを、変更のたびに確認します。",
  },
  {
    t: "公開前チェックの3段階判定",
    d: "外部サービスとの接続は、IMPLEMENTED（コードとして実装されているか）／ CONNECTED（本番の外部サービスに実際につながっているか）／ E2E VERIFIED（最後まで通ったのを人が自分の目で確かめたか）の3段階で見ます。3つそろって初めて完了扱いです。",
  },
  {
    t: "バックテストの再現性",
    d: `1構成あたり ${RUNS} 通りの当選順で試算します。乱数の種と判定ルールのバージョン（現在 ${BACKTEST_ENGINE_VERSION}）を結果に保存するため、同じ設定なら同じ結果になります。「前回と判定が違う」を後から追えます。`,
  },
  {
    t: "価格データの鮮度チェック",
    d: `市場価格には FRESH ／ STALE ／ UNKNOWN の状態を持たせ、最終更新から ${STALE_AFTER_DAYS} 日を過ぎた価格は「古い」として扱います。古い価格のときは実還元率の数字を出しません。`,
  },
  {
    t: "抽選の記録",
    d: "抽選は、誰が・いつ・どのガチャを・何回・抽選前残数・結果・消費ポイント・抽選後残数まで1件ずつ記録に残す設計です。後から書き換えにくい形で保持し、管理操作についても記録を残します。",
  },
];

export default function Security() {
  return (
    <Section
      id="security"
      no="20"
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
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {security.map((g, i) => (
          <Reveal key={g.group} delay={i * 0.05}>
            <div className="lp-card h-full p-5 sm:p-7">
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
              <h3 className="h-display mt-4 text-h3 text-slate">{g.group}</h3>
              <p className="num mt-3 text-label text-slate3">
                {g.items.length} 項目
              </p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1}>
        <div className="mt-3">
          <MoreDetail label="4分野の対応項目をすべて見る">
            <div className="space-y-7">
              {security.map((g) => (
                <div key={g.group}>
                  <p className="text-note font-bold text-slate">{g.group}</p>
                  <ul className="mt-3 space-y-2.5">
                    {g.items.map((t) => (
                      <li key={t} className="flex gap-3.5 text-note text-slate2">
                        <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-ink/60" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-7 border-t border-edge2 pt-6 text-note text-slate3">
              適用範囲・強度はご要件と規模に応じて設計し、設定が必要な項目（多要素認証・IP制限など）は個別に取り決めます。
            </p>
          </MoreDetail>
        </div>
      </Reveal>

      <Reveal delay={0.14}>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
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
            <div key={x.t} className="rounded-3xl border border-edge bg-paper2 p-5 sm:p-8">
              <h4 className="text-note font-bold leading-[1.75] text-slate">{x.t}</h4>
              <p className="mt-3 text-note text-slate2">{x.d}</p>
            </div>
          ))}
        </div>
      </Reveal>

      {/* ── 製品としての品質（技術用語は折りたたみの中へ入れる） ── */}
      <Reveal delay={0.06}>
        <div className="mt-3 rounded-3xl border border-edge bg-white px-6 py-8 shadow-lift sm:px-10 sm:py-12">
          <div className="grid gap-7 lg:grid-cols-[1fr_minmax(0,420px)] lg:items-start lg:gap-14">
            <div>
              <span className="num text-label text-slate3">QUALITY</span>
              <h3 className="h-display mt-5 text-h2 text-slate">
                見えない計算まで、
                <br />
                検証しています。
              </h3>
              <p className="mt-6 max-w-[34em] text-note text-slate2">
                画面が正しく見えていても、裏側の計算だけが間違っている――ガチャ運営でいちばん怖いのはこの状態です。重要な計算・入力の異常値・価格データの欠損を、回帰テストで見張っています。
              </p>
              <p className="mt-4 max-w-[34em] text-note text-slate3">
                <span className="font-bold text-slate">
                  SAFE FAIL（分からないときは、安全と言わない）。
                </span>
                景品が未登録・価格が0円といった入力不足を検知した場合、判定を「安全」とは表示せず、判定できない旨と不足している箇所を出します。画面だけが正常に見えて、判断材料が欠けている状態を作らないための決まりです。
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
              {[
                { k: "REGRESSION TESTS", v: `${REGRESSION_TESTS}`, s: "件" },
                { k: "BACKTEST RUNS", v: `${RUNS}`, s: "通り / 構成" },
                { k: "RELEASE CHECK", v: "3", s: "段階で判定" },
              ].map((x) => (
                <div
                  key={x.k}
                  className="rounded-2xl border border-edge2 bg-paper2 px-4 py-4 sm:px-6 sm:py-5"
                >
                  <span className="num text-label text-slate3">{x.k}</span>
                  <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
                    <span className="num text-h2 font-semibold leading-none text-blue-ink">
                      {x.v}
                    </span>
                    <span className="text-note text-slate2">{x.s}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7">
            <MoreDetail label="技術的な内訳を見る">
              <ul className="space-y-7">
                {QUALITY_DETAIL.map((x) => (
                  <li key={x.t}>
                    <p className="text-note font-bold text-slate">{x.t}</p>
                    <p className="mt-2 text-note text-slate2">{x.d}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-8 border-t border-edge2 pt-6 text-note text-slate3">
                ※ 事前のシミュレーションと検証であり、運営の成果や損失が出ないことをお約束するものではありません。
              </p>
            </MoreDetail>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
