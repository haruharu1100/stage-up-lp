import Act from "../ui/Act";
import Reveal from "../ui/Reveal";
import BeforeAfter from "../ui/BeforeAfter";

const steps = [
  { n: "01", t: "当選者が発送依頼", d: "マイページから対象の景品を選んで依頼", who: "お客様" },
  { n: "02", t: "管理画面へ自動反映", d: "発送キューに集約。住所は暗号化して保持", who: "システム" },
  { n: "03", t: "発送対象を選ぶ", d: "まとめて選択。同一住所は自動でまとめる", who: "運営者" },
  { n: "04", t: "配送データ生成", d: "主要配送業者向けの伝票データを書き出し", who: "システム" },
  { n: "05", t: "追跡番号を登録", d: "取り込むだけでステータスが進む", who: "運営者" },
  { n: "06", t: "発送通知とマイページ反映", d: "お客様へ自動通知。履歴にも残る", who: "システム" },
];

const queue = [
  { user: "user_2841", item: "AJ1 Retro High OG 27.5cm", price: "¥51,800", state: "仕入れ待ち" },
  { user: "user_1190", item: "PSA10 リザードン ex SAR", price: "¥139,500", state: "梱包中" },
  { user: "user_3372", item: "限定復刻 ダンク Low 26.0cm", price: "¥28,600", state: "発送済" },
];

/** 誰がやる作業なのかを、色で見分けられるようにする */
const WHO: Record<string, string> = {
  システム: "bg-ok/[0.10] text-ok-ink",
  運営者: "bg-blue-pale text-blue-ink",
  お客様: "bg-paper2 text-slate3",
};

const STATE: Record<string, string> = {
  発送済: "bg-ok/[0.10] text-ok-ink",
  梱包中: "bg-blue-pale text-blue-ink",
  仕入れ待ち: "bg-warn/[0.12] text-warn-ink",
};

export default function Shipping() {
  return (
    <Act
      id="shipping"
      no="SECTION 12"
      eyebrow="SHIPPING ENGINE"
      wide
      title={
        <>
          選んで、押すだけ。
          <br />
          発送作業を流れにする。
        </>
      }
      lead="売れるほど人手が要る、という状態をやめます。発送依頼から伝票データ、追跡番号、通知、マイページ反映までを一本の流れにまとめました。"
    >
      <BeforeAfter id="ship" className="mb-8" />

      <Reveal>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className="group relative overflow-hidden rounded-3xl border border-edge bg-white p-7 shadow-lift transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="num text-label text-slate3">{s.n}</span>
                <span
                  className={`rounded-full px-3 py-1 text-note font-medium ${
                    WHO[s.who] ?? "bg-paper2 text-slate3"
                  }`}
                >
                  {s.who}
                </span>
              </div>
              <h3 className="mt-5 text-h3 font-bold text-slate">{s.t}</h3>
              <p className="mt-3 text-note leading-[1.9] text-slate2">{s.d}</p>
              {i < steps.length - 1 && (
                <span className="absolute bottom-6 right-7 text-edge transition-colors group-hover:text-blue-ink">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-4 overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
          <div className="flex flex-col gap-2 border-b border-edge bg-paper2/70 px-7 py-5 sm:flex-row sm:items-center sm:justify-between">
            <span className="num text-label text-slate3">
              SHIPPING QUEUE / 仕入れ支援つき
            </span>
            <span className="text-note text-slate2">
              景品ごとに、仕入れ先URLと現在価格を並べて表示します
            </span>
          </div>
          {queue.map((q) => (
            <div
              key={q.user}
              className="flex flex-col gap-3.5 border-b border-edge2 px-7 py-5 last:border-0 sm:flex-row sm:items-center"
            >
              <span className="num w-28 shrink-0 text-note text-slate3">
                {q.user}
              </span>
              <span className="min-w-0 flex-1 truncate text-note font-medium text-slate">
                {q.item}
              </span>
              <span className="num shrink-0 text-note text-slate2">{q.price}</span>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-note font-medium ${
                  STATE[q.state] ?? "bg-paper2 text-slate3"
                }`}
              >
                {q.state}
              </span>
              <span className="shrink-0 rounded-xl border border-edge bg-white px-4 py-2 text-note text-slate2">
                購入ページを開く
              </span>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.12}>
        <p className="mt-6 text-note leading-[1.9] text-slate3">
          ※ 対応する配送業者・データ形式は、ご利用の契約内容にあわせて設定します。
        </p>
      </Reveal>
    </Act>
  );
}
