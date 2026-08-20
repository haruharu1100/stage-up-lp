import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import BeforeAfter from "../ui/BeforeAfter";
import PriceFreshnessBadge from "../ui/PriceFreshnessBadge";
import { STALE_AFTER_HOURS } from "@/lib/priceFreshness";

const items = [
  { name: "AJ1 Retro High OG / 27.5cm", bought: 42000, now: 51800 },
  { name: "PSA10 リザードン ex SAR", bought: 128000, now: 139500 },
  { name: "限定復刻 ダンク Low / 26.0cm", bought: 31000, now: 28600 },
  { name: "ハイブランド 二つ折り財布", bought: 68000, now: 71200 },
];

const yen = (n: number) => "¥" + n.toLocaleString("ja-JP");

export default function MarketPrice() {
  return (
    <Section
      id="price"
      no="08"
      eyebrow="PRICE ENGINE"
      title={
        <>
          相場が動いたら、
          <br />
          還元率も動く。
        </>
      }
      lead="景品の価格は、入れた日の値段のままではありません。設定した周期で市場価格を取り込み、購入時価格との差を管理画面に出します。この価格が、そのまま実還元率の計算に入ります。"
    >
      <BeforeAfter id="price" className="mb-5" />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Reveal>
          <div className="lp-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge2 px-6 py-4">
              <span className="eyebrow-lite">MARKET PRICE MONITOR</span>
              <PriceFreshnessBadge />
            </div>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 border-b border-edge2 bg-paper2 px-6 py-3 text-note text-slate3">
              <span>景品</span>
              <span className="text-right">購入時価格</span>
              <span className="text-right">現在価格</span>
              <span className="text-right">変動率</span>
            </div>
            {items.map((it) => {
              const diff = it.now - it.bought;
              const rate = (diff / it.bought) * 100;
              const up = diff > 0;
              return (
                <div
                  key={it.name}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-3 border-b border-edge2 px-6 py-4 text-note last:border-0"
                >
                  <span className="truncate text-slate">{it.name}</span>
                  <span className="num text-right text-slate3">{yen(it.bought)}</span>
                  <span
                    className={`num text-right font-bold ${up ? "text-danger-ink" : "text-ok-ink"}`}
                  >
                    {yen(it.now)}
                  </span>
                  <span
                    className={`num text-right ${up ? "text-danger-ink" : "text-ok-ink"}`}
                  >
                    {up ? "▲" : "▼"} {Math.abs(rate).toFixed(1)}%
                  </span>
                </div>
              );
            })}
            <div className="flex items-center gap-3.5 border-t border-danger-ink/15 bg-danger/[0.06] px-6 py-4">
              <span className="h-2 w-2 shrink-0 rounded-full bg-danger-ink" />
              <p className="text-note text-danger-ink">
                価格上昇により、#128 スニーカーBOX の実還元率が 108.7% に再計算されました
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="lp-card h-full p-7 sm:p-8">
            <span className="eyebrow-lite">UPDATE SETTINGS</span>
            <div className="mt-7 space-y-3.5">
              {[
                { l: "更新周期", v: "週1回（毎週月曜 04:00）", on: true },
                { l: "更新後の再計算", v: "全公開中ガチャ", on: true },
                { l: "しきい値超過で通知", v: "LINE / メール", on: true },
                { l: "しきい値超過で自動停止", v: "任意設定", on: false },
              ].map((s) => (
                <div
                  key={s.l}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-edge2 bg-white px-5 py-4"
                >
                  <div>
                    <p className="text-note font-medium text-slate">{s.l}</p>
                    <p className="num mt-1 text-note leading-relaxed text-slate3">
                      {s.v}
                    </p>
                  </div>
                  <span
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      s.on ? "bg-blue-ink" : "bg-edge2"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full border border-edge2 bg-white shadow-lift transition-all ${
                        s.on ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-7 rounded-2xl border border-blue-ink/20 bg-blue-pale/60 p-5">
              <p className="text-note text-slate2">
                価格の取得元は、<span className="font-bold text-blue-ink">正式に利用可能なデータソース・API・許諾済みデータ</span>を使う前提で設計します。対象ジャンルによって使えるソースが異なるため、導入時に利用規約と取得方法を確認したうえで決定します。
              </p>
            </div>

            {/* SAFE FAIL：価格が取れないときに「安全です」と言わない */}
            <div className="mt-4 rounded-2xl border border-warn-ink/25 bg-warn/[0.07] p-5">
              <p className="num text-label text-warn-ink">
                IF PRICE DATA IS STALE
              </p>
              <p className="mt-3 text-note text-slate2">
                価格の取り込みに失敗したとき、
                <span className="font-bold text-slate">
                  古い価格で計算を続けて「安全です」とは表示しません。
                </span>
                最終更新から {Math.floor(STALE_AFTER_HOURS / 24)} 日を過ぎた場合、
                実還元率は <span className="num font-bold text-warn-ink">UNKNOWN</span> として扱い、
                その旨を画面に出します。
              </p>
              <p className="mt-3 text-note leading-relaxed text-slate3">
                画面がいつも通りに見えているのに、判断の材料だけが古い——
                これが運営でいちばん危ない状態だからです。
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
