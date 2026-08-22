/**
 * 料金のすぐ手前に置く、たった1枚の要約。
 *
 * ═══════════════════════════════════════════════
 * ★このセクションの役目
 * ═══════════════════════════════════════════════
 *
 *   ここまでで、見た人は8つのものを別々に見てきています。
 *     AIがガチャを作るところ／公開前に試すところ／お客様が引くところ／
 *     数字が動くところ／相場を見張るところ／発送を依頼するところ／
 *     AIが問い合わせに答えるところ／答えられないものを人が返すところ
 *
 *   このまま料金を出すと、「で、いくらのものを買うんだっけ？」が起きます。
 *   人は、バラバラに見せられたものを自分で足し算してくれません。
 *
 *   だからここで一度だけ、「さっき見た全部が、1つのOSです」と言い切り、
 *   そのすぐ下に金額を置きます。足し算をこちらでやってから渡す、という考え方です。
 *
 * ═══════════════════════════════════════════════
 * ★書くときの決まり
 * ═══════════════════════════════════════════════
 *
 *   ・ここで新しい機能の話を足さないこと。
 *     上で見せていないものを並べると、ただの機能一覧になります。
 *     8つはすべて、このページの上のほうで実際に見せたものだけにします。
 *
 *   ・金額は必ず config/pricing.ts から取ること。
 *     ここに数字を直接書くと、値上げ・値下げのときに直し漏れます。
 *
 *   ・「必ず儲かる」「絶対」のような断定は書かないこと（景品表示法）。
 *     ここは金額の手前なので、いちばん盛りたくなる場所です。書かないこと。
 */

import Reveal from "../ui/Reveal";
import { activeTiers, setupPriceLabel, tierPriceLabel } from "@/config/pricing";
import { jp } from "@/lib/jp";

/**
 * ここまでのページで、実際に画面を見せたものだけを並べる。
 *
 * ★8つとも、このセクションより「上」で目に入っています。
 *   01 AIガチャ設計 …… 02章の管理画面
 *   02 バックテスト …… 03章
 *   03 お客様の画面 …… 04章・05章
 *   04〜08 …………… 05章の触れるデモ（引くと残り口数と売上が動き、
 *                      相場が動けば警告が出て、発送を頼むと未発送が増え、
 *                      AIに聞くと答え、判断が要るものは要確認が1つ増え、
 *                      運営者が返信するとお客様の画面に戻る）
 *
 *   04〜08 のもっと詳しい話は、料金より下の 08章・09章にあります。
 *   href はそこへ飛ばしています。「まだ見ていないもの」は1つもありません。
 *
 * ★8つに増やした理由（2026-08-22）
 *   6つだったときは「市場価格の監視」と「人への引き継ぎ」が抜けていました。
 *   この2つは、このシステムがいちばん言いたいこと
 *   （赤字を先に止める／AIに任せきりにしない）そのものです。
 *   金額の直前の要約から抜けていると、その2つは買うものに入りません。
 *
 * ★where は短く保つこと（2026-08-22）。
 *   ここは「思い出す」ための場所で、「説明する」ための場所ではありません。
 *   説明は、それぞれのセクションで既に終わっています。
 *   1枚あたり1行を超えたら、それは長すぎます。
 */
const SEEN: { code: string; name: string; where: string; href: string }[] = [
  {
    code: "01",
    name: "AIガチャ設計",
    where: "伝えるだけで組み上がる",
    href: "#builder",
  },
  {
    code: "02",
    name: "公開前バックテスト",
    where: "公開前に赤字を試す",
    href: "#backtest",
  },
  {
    code: "03",
    name: "お客様のガチャ画面",
    where: "承認した瞬間に公開",
    href: "#play",
  },
  {
    code: "04",
    name: "リアルタイム還元率",
    where: "残り口数と売上が動く",
    href: "#rtp",
  },
  {
    code: "05",
    name: "市場価格監視",
    where: "相場が動けば警告",
    href: "#price",
  },
  {
    code: "06",
    name: "発送管理",
    where: "発送依頼がそのまま入る",
    href: "#shipping",
  },
  {
    code: "07",
    name: "AI問い合わせ",
    where: "AIがその場で答える",
    href: "#support",
  },
  {
    code: "08",
    name: "人への引き継ぎ",
    where: "難しいものは人が返す",
    href: "#play",
  },
];

export default function OsSummary() {
  /* ★金額の出どころは config/pricing.ts の1か所だけ。ここに数字を書かないこと */
  const starter = activeTiers.find((t) => t.key === "starter");

  return (
    <section
      id="os-summary"
      className="relative scroll-mt-24 bg-paper py-11 sm:py-24 lg:py-28"
    >
      {/*
        ★濃紺は「危ないこと」と「最後の一言」にしか使わない、が全体の決まりです。
          ここを濃紺にしているのは、ここがページ全体の結論であり、
          このすぐ下で金額を出すからです。
          白い面が続くページの中で、ここだけ色が変わることで
          「話が変わった」と体が気づきます。
      */}
      <div className="container-x relative z-10">
        <div className="console-deep relative overflow-hidden rounded-[32px] px-6 py-11 shadow-float sm:px-12 sm:py-20">
        <Reveal>
          <div className="mx-auto max-w-4xl text-center">
            <span className="num text-label tracking-[0.16em] text-white/45">
              ONE OPERATING SYSTEM
            </span>
            <h2 className="h-display mt-4 text-h1 text-balance text-white sm:mt-6">
              ここまで全部、
              <br className="sm:hidden" />
              1つのOSです。
            </h2>
            <p className="mx-auto mt-5 max-w-[34em] text-body text-pretty text-white/65 sm:mt-7">
              {jp(
                "別々のサービスを8つ契約する話ではありません。上でご覧いただいたものは、すべて同じ1つのシステムの中でつながっています。",
              )}
            </p>
          </div>
        </Reveal>

        {/* ── 上で実際に見せた8つ ── */}
        <Reveal delay={0.06}>
          {/*
            ★スマホでも2列にすること。1列に戻さないこと。

              1列にすると、1枚のカードの中で文字が左半分にしか乗らず、
              右側がずっと空いたまま縦に8枚積み上がります。
              「これで全部です」ということだけ伝えたい場所なのに、
              金額へたどり着くまでのスクロールが伸びてしまいます。

              2列だと8つが4行、PCでは4列で2行におさまり、
              「これで全部です」が一目で分かります。
          */}
          <ul className="mx-auto mt-9 grid max-w-5xl grid-cols-2 gap-2.5 sm:mt-14 lg:grid-cols-4">
            {SEEN.map((s) => (
              <li key={s.code}>
                <a
                  href={s.href}
                  className="flex h-full flex-col rounded-2xl border border-white/12 bg-white/[0.05] p-4 transition-colors duration-300 hover:border-white/25 hover:bg-white/[0.09] sm:p-6"
                >
                  <span className="num text-label text-blue-300/70">{s.code}</span>
                  <p className="mt-2.5 text-note font-bold text-white">
                    {jp(s.name)}
                  </p>
                  <p className="mt-1.5 text-note leading-[1.85] text-pretty text-white/55">
                    {jp(s.where)}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </Reveal>

        {/* ── ↓ ── */}
        <Reveal delay={0.1}>
          <div className="mt-8 flex justify-center sm:mt-12">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.06]">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 3v10M4 9l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-white/70"
                />
              </svg>
            </span>
          </div>
        </Reveal>

        {/* ── 金額 ── */}
        <Reveal delay={0.14}>
          <div className="mx-auto mt-8 max-w-2xl rounded-3xl border border-white/15 bg-white/[0.07] p-7 text-center sm:mt-12 sm:p-10">
            <span className="num text-label tracking-[0.16em] text-white/45">
              MONTHLY OS ／ ここから始められます
            </span>
            <p className="num mt-4 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
              <span className="text-h3 font-bold text-white/80">
                {starter?.name ?? "STARTER"}
              </span>
              <span className="text-hero font-extrabold leading-none text-white">
                {starter ? tierPriceLabel(starter) : "個別お見積り"}
              </span>
            </p>
            <p className="mt-5 text-note leading-[1.95] text-pretty text-white/60">
              {jp(
                "上の8つは、この月額の中にすべて含まれます。これとは別に、立ち上げのときだけ初期構築費がかかります。",
              )}
            </p>

            {/*
              ★月額だけを大きく出して終わらせないこと（景品表示法）。
                初期構築費を、開いた人しか見つけられない場所にだけ書いておくと、
                「月49,800円だけで始められる」と読まれかねません。
                実際にかかるのは 月額 ＋ 初回の初期構築費 の2本です。
                この行を消さないこと。
            */}
            <p className="mx-auto mt-6 flex max-w-md flex-wrap items-baseline justify-center gap-x-3 gap-y-1 rounded-2xl border border-white/12 bg-white/[0.05] px-5 py-4">
              <span className="num text-label text-blue-300/70">
                <span className="nb">INITIAL SETUP</span>
              </span>
              <span className="num text-note font-bold text-white">
                {setupPriceLabel}
              </span>
              <span className="text-note text-white/50">初回のみ</span>
            </p>

            {/*
              ★税の表記を消さないこと。
                金額だけを大きく出して税の扱いを書かないのは、
                有利誤認と受け取られる可能性があります（景品表示法）。
            */}
            <p className="mt-5 text-note leading-[1.9] text-pretty text-white/40">
              {jp(
                "金額はすべて税別です。初期構築費は、移行の有無や商品点数によって幅があります。詳しい内訳は、このすぐ下にあります。",
              )}
            </p>
          </div>
        </Reveal>
        </div>
      </div>
    </section>
  );
}
