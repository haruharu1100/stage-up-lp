import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";
/* ★画面に出す文字は jpDeep() を通す。日本語が語の途中で割れるのを止める */
import { jpDeep } from "@/lib/jp";

const settings = jpDeep([
  { l: "突入条件", v: "対象ガチャで特定カードを引いたとき" },
  { l: "継続条件", v: "継続判定に成功した場合" },
  { l: "継続率", v: "段階ごとに設定（管理画面から変更可）" },
  { l: "最大継続回数", v: "段階ごとに上限を設定" },
  { l: "当選内容", v: "ポイント / BOX / パック / PSA / 上乗せ / 倍率" },
  { l: "対象ガチャ", v: "個別に選択（対象外にもできる）" },
  { l: "終了条件", v: "継続失敗・上限到達・手動終了" },
]);

const chain = [
  { name: "CHANCE", tone: "from-blue-ink/6" },
  { name: "SUPER", tone: "from-blue-ink/10" },
  { name: "ULTRA", tone: "from-blue-ink/15" },
  { name: "LEGEND", tone: "from-blue-ink/20" },
  { name: "INFINITY", tone: "from-blue-ink/27" },
];

export default function Rush() {
  return (
    <Section
      id="rush"
      no=""
      eyebrow="RUSH MODE"
      title={
        <>
          もう一回引きたくなる、
          <br />
          <span className="text-gradient-royal">継続演出</span>を設計できる。
        </>
      }
      lead="一般的なガチャにはない、段階的に続いていく特別モード。突入条件・継続率・当選内容・対象ガチャ・終了条件を、すべて管理画面から設定できます。"
    >
      {/*
        以前はカードを2枚（RUSH CHAIN / RUSH SETTINGS）並べていました。
        スマホでは2枚が縦に積まれて、余白と見出しだけで数百pxを使うので、
        1枚にまとめ、PCのときだけ左右に分ける形にしています。
      */}
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-edge bg-gradient-to-b from-blue-pale/60 to-white p-5 shadow-lift sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-blue-ink/8 blur-3xl" />

          <div className="relative grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
            <div>
              <span className="eyebrow-lite">RUSH CHAIN</span>
              <div className="mt-4 space-y-2">
                {chain.map((c, i) => (
                  <div
                    key={c.name}
                    className={`relative flex items-center gap-3 overflow-hidden rounded-2xl border border-edge bg-gradient-to-r ${c.tone} to-transparent px-4 py-3 shadow-lift sm:px-5`}
                    style={{ marginLeft: `${i * 12}px` }}
                  >
                    <span className="num text-label text-slate3">
                      STAGE {i + 1}
                    </span>
                    <span className="num text-note font-bold tracking-[0.14em] text-blue-ink">
                      {c.name}
                    </span>
                    <span className="num ml-auto hidden text-note text-slate3 sm:inline">
                      継続判定
                    </span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden
                      className="ml-auto shrink-0 text-blue-ink sm:ml-0"
                    >
                      <path
                        d="M3 8h10M9 4l4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="eyebrow-lite">RUSH SETTINGS</span>
              <p className="mt-4 text-note leading-[1.95] text-slate2">
                突入条件から終了条件まで、7項目を管理画面から設定できます。RUSHで払い出される期待値は、そのガチャの還元率計算に
                <span className="font-bold text-blue-ink">合算されます</span>
                。演出だけが独走して、気づいたら原価が跳ね上がっていた、という状態を作りません。
              </p>

              {/* 設定項目の一覧は、検討が進んだ人だけが読む詳細なので畳んでいます */}
              <div className="mt-4">
                <MoreDetail label="設定できる項目を見る（7項目）">
                  <div className="divide-y divide-edge2">
                    {settings.map((s) => (
                      <div
                        key={s.l}
                        className="flex items-start justify-between gap-5 py-3.5 first:pt-0"
                      >
                        <span className="shrink-0 text-note font-medium text-slate">
                          {s.l}
                        </span>
                        <span className="text-right text-note leading-relaxed text-slate2">
                          {s.v}
                        </span>
                      </div>
                    ))}
                  </div>
                </MoreDetail>
              </div>

              <p className="mt-4 text-note leading-[1.9] text-slate3">
                確率や当選内容の表示方法は、景品表示法をはじめとする関連法令・決済事業者の規約・プラットフォームの表示ルールとの整合を取ったうえで設定します。個別の適合性は専門家のご確認をお願いしています。
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
