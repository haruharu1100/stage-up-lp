import Reveal from "../ui/Reveal";
import { timeModel } from "@/content/site";
import { activeTiers, tierPriceLabel } from "@/config/pricing";

/**
 * 「月額いくら？」で他社と比べさせないためのブロック。
 *
 * 比べる相手はシステムの月額ではなく、
 * いま実際に払っている人件費・かけている時間・起きうる事故です。
 *
 * ★数値の扱い（景品表示法）
 * 　ここに出る金額は入力条件から計算した「モデルケース」であり、
 * 　実測値でも保証値でもありません。必ずその旨を画面に表示します。
 */

/** モデルケースの前提。変更したい場合はここだけ直す */
const MODEL = {
  workdaysPerMonth: 22,
  hourlyWage: 1_500,
  staff: 2,
};

const beforeHoursPerDay = timeModel.reduce((a, r) => a + r.before, 0);
const afterHoursPerDay = timeModel.reduce((a, r) => a + r.after, 0);

const beforeHoursPerMonth = Math.round(beforeHoursPerDay * MODEL.workdaysPerMonth);
const afterHoursPerMonth = Math.round(afterHoursPerDay * MODEL.workdaysPerMonth);
const savedHours = beforeHoursPerMonth - afterHoursPerMonth;

const beforeCost = beforeHoursPerMonth * MODEL.hourlyWage;
const afterCost = afterHoursPerMonth * MODEL.hourlyWage;
const savedCost = beforeCost - afterCost;

const jpy = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

/** 金額が入っている一番安いプランを、比較の基準にする */
const cheapest =
  activeTiers.filter((t) => t.monthlyYen !== null).sort(
    (a, b) => (a.monthlyYen as number) - (b.monthlyYen as number)
  )[0] ?? null;

const RISKS = [
  {
    t: "相場が上がったことに気づかないまま売り切れる",
    b: "設定時は適正でも、景品の相場が上がれば実還元率は跳ね上がります。人が毎日確認するのは現実的ではありません。",
  },
  {
    t: "発送漏れ・二重発送",
    b: "件数が増えるほど、手作業の突き合わせは追いつかなくなります。1件の漏れがそのままクレームになります。",
  },
  {
    t: "抽選の正しさを後から説明できない",
    b: "「本当に公正だったのか」と聞かれたとき、記録が無ければ何も答えられません。信用の問題に直結します。",
  },
];

export default function LaborCompare() {
  return (
    <>
      <Reveal delay={0.06} className="mt-12 sm:mt-24">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-4">
            <span className="num text-label text-slate3">COMPARE</span>
            <span className="h-px w-10 bg-edge" />
            <h3 className="h-display text-h3 text-slate">
              比べるのは、月額ではありません。
            </h3>
          </div>
          <p className="text-note text-slate3">
            人件費・時間・事故リスクで見てください。
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.1} className="mt-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* BEFORE */}
          <div className="rounded-3xl border border-edge bg-paper2 p-6 sm:p-8">
            <span className="num text-label text-slate3">
              BEFORE ／ 人の手で回す場合
            </span>

            <div className="mt-6 flex flex-wrap gap-x-10 gap-y-5">
              <Stat label="担当スタッフ" value={`${MODEL.staff}人`} tone="mute" />
              <Stat
                label="毎月の運営作業"
                value={`${beforeHoursPerMonth}時間`}
                tone="mute"
              />
              <Stat label="人件費 相当" value={`${jpy(beforeCost)}／月`} tone="warn" />
            </div>

            <ul className="mt-6 space-y-3 border-t border-edge2 pt-5">
              {timeModel.map((r) => (
                <li
                  key={r.task}
                  className="flex items-baseline justify-between gap-5 text-note text-slate3"
                >
                  <span>{r.task}</span>
                  <span className="num shrink-0 tabular-nums text-slate3">
                    {r.before}h／日
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* AFTER */}
          <div className="rounded-3xl border border-blue-ink/20 bg-white p-6 shadow-lift2 sm:p-8">
            <span className="num text-label text-blue-ink">
              AFTER ／ AI&nbsp;GACHA&nbsp;OS
            </span>

            <div className="mt-6 flex flex-wrap gap-x-10 gap-y-5">
              <Stat label="人の役割" value="確認・承認" tone="ink" />
              <Stat
                label="毎月の運営作業"
                value={`${afterHoursPerMonth}時間`}
                tone="ink"
              />
              <Stat label="人件費 相当" value={`${jpy(afterCost)}／月`} tone="ok" />
            </div>

            <ul className="mt-6 space-y-3 border-t border-edge2 pt-5">
              {timeModel.map((r) => (
                <li
                  key={r.task}
                  className="flex items-baseline justify-between gap-5 text-note text-slate2"
                >
                  <span>{r.note}</span>
                  <span className="num shrink-0 tabular-nums text-blue-ink">
                    {r.after}h／日
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>

      {/* 差額の帯 */}
      <Reveal delay={0.14} className="mt-4">
        <div className="lp-tint rounded-3xl px-6 py-6 sm:px-9 sm:py-8">
          <div className="flex flex-wrap items-end gap-x-12 gap-y-6">
            <div>
              <p className="num text-label text-slate3">減る作業時間</p>
              <p className="num mt-3 text-h1 font-semibold leading-none text-slate">
                {savedHours}
                <span className="ml-2 text-note font-normal text-slate3">
                  時間／月
                </span>
              </p>
            </div>
            <div>
              <p className="num text-label text-slate3">人件費の差</p>
              <p className="num mt-3 text-h1 font-semibold leading-none text-blue-ink">
                {jpy(savedCost)}
                <span className="ml-2 text-note font-normal text-slate3">
                  ／月
                </span>
              </p>
            </div>
            {cheapest && (
              <div>
                <p className="num text-label text-slate3">
                  {cheapest.name} の月額
                </p>
                <p className="num mt-3 text-h3 font-semibold leading-none text-slate2">
                  {tierPriceLabel(cheapest).replace("月額 ", "")}
                </p>
              </div>
            )}
          </div>

          <p className="mt-6 border-t border-edge2 pt-5 text-note text-slate2">
            上記は「1日{beforeHoursPerDay}時間相当の運営作業が発生している事業者」を、月{MODEL.workdaysPerMonth}日・時給{MODEL.hourlyWage.toLocaleString("ja-JP")}円で換算した
            <span className="font-bold text-slate">モデルケース</span>
            です。実測値ではなく、この金額の達成をお約束するものではありません。実際の削減幅は、扱うジャンル・ガチャ本数・発送件数・体制によって変わります。
          </p>
        </div>
      </Reveal>

      {/* 事故リスク */}
      <Reveal delay={0.18} className="mt-4">
        <div className="rounded-3xl border border-edge bg-white p-6 shadow-lift sm:p-8">
          <span className="num text-label text-slate3">
            RISK ／ 金額に出ないコスト
          </span>
          <p className="mt-4 text-body text-slate2">
            人件費より重いのは、起きてしまったときに取り返せない事故のほうです。
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {RISKS.map((r) => (
              <div
                key={r.t}
                className="rounded-2xl border border-edge2 bg-paper2 p-5"
              >
                <p className="text-note font-bold text-slate">{r.t}</p>
                <p className="mt-3 text-note text-slate2">{r.b}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "mute" | "ink" | "ok" | "warn";
}) {
  const color =
    tone === "ok"
      ? "text-blue-ink"
      : tone === "warn"
        ? "text-slate"
        : tone === "ink"
          ? "text-slate"
          : "text-slate3";
  return (
    <div>
      <p className="num text-label text-slate3">{label}</p>
      <p className={`num mt-3 text-h3 font-semibold leading-none ${color}`}>
        {value}
      </p>
    </div>
  );
}
