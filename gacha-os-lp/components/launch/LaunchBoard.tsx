"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CheckItem, StageId, StageState } from "@/lib/readiness";
import { STAGE_LABEL, STAGE_MEANING, STAGE_ORDER } from "@/lib/readiness";

/**
 * 公開前チェック画面の本体。
 *
 * ★1項目につき必ず3段階で見ます。
 *   IMPLEMENTED   コードとして実装されているか（自動判定）
 *   CONNECTED     本番の外部サービスに実際につながっているか（設定値で自動判定）
 *   E2E VERIFIED  本当に最後まで通ったのを、人が自分の目で確かめたか（手動）
 *
 * 「IDを入れた」で完了にしないための画面です。
 * E2E VERIFIED に細目がある項目は、細目を全部チェックしない限り済みになりません。
 *
 * チェックの状態は、この端末のブラウザにだけ保存します（localStorage）。
 */

const STORE_KEY = "gos.launch.checked.v2";

/** 手動チェックの保存キー */
const stageKey = (item: string, stage: StageId) => `${item}::${stage}`;
const stepKey = (item: string, index: number) => `${item}::step::${index}`;

const STAGE_STYLE: Record<StageState, { chip: string; mark: string }> = {
  ok: { chip: "border-ok/40 bg-ok/[0.10] text-ok", mark: "✓" },
  todo: { chip: "border-danger/40 bg-danger/[0.07] text-danger", mark: "×" },
  na: { chip: "border-white/10 bg-white/[0.02] text-white/25", mark: "—" },
};

export default function LaunchBoard({ items }: { items: CheckItem[] }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) setChecked(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* 読めなくても画面は使える */
    }
    setLoaded(true);
  }, []);

  const toggle = useCallback((key: string) => {
    setChecked((c) => {
      const next = { ...c, [key]: !c[key] };
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        /* 保存できなくても判定は動く */
      }
      return next;
    });
  }, []);

  /**
   * 人の確認結果を反映した、最終的な3段階の状態。
   *
   * ★細目（e2eSteps）がある項目は、細目が全部そろって初めて済みにします。
   *   「全体をまとめて確認済みにする」ボタンは置きません。
   *   まとめてチェックできると、結局「設定しただけ」で通ってしまうからです。
   */
  const resolve = useCallback(
    (item: CheckItem, stage: StageId): StageState => {
      const s = item.stages[stage];
      if (s.state !== "todo") return s.state;
      if (s.auto) return "todo";

      const steps = stage === "verified" ? item.e2eSteps : undefined;
      if (steps && steps.length > 0) {
        return steps.every((_, idx) => checked[stepKey(item.key, idx)])
          ? "ok"
          : "todo";
      }
      return checked[stageKey(item.key, stage)] ? "ok" : "todo";
    },
    [checked]
  );

  const resolved = useMemo(
    () =>
      items.map((item) => {
        const states = {} as Record<StageId, StageState>;
        for (const s of STAGE_ORDER) states[s] = resolve(item, s);
        return {
          item,
          states,
          ready: STAGE_ORDER.every((s) => states[s] !== "todo"),
          pending: STAGE_ORDER.filter((s) => states[s] === "todo"),
        };
      }),
    [items, resolve]
  );

  const required = resolved.filter((r) => r.item.required);
  const recommended = resolved.filter((r) => !r.item.required);
  const blocking = required.filter((r) => !r.ready);
  const recommendedLeft = recommended.filter((r) => !r.ready);
  const productionReady = blocking.length === 0;
  const doneRequired = required.length - blocking.length;

  return (
    <div className="space-y-6">
      {/* 判定バナー */}
      <div
        className={`rounded-2xl border p-6 ${
          !loaded
            ? "border-white/10 bg-white/[0.02]"
            : productionReady
              ? "border-ok/40 bg-ok/[0.07]"
              : "border-danger/40 bg-danger/[0.08]"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="num text-[10px] tracking-[0.2em] text-white/35">
            PRODUCTION READY
          </span>
          <span
            className={`num rounded-full border px-3 py-1 text-[11px] font-bold tracking-[0.16em] ${
              !loaded
                ? "border-white/15 text-white/40"
                : productionReady
                  ? "border-ok/40 text-ok"
                  : "border-danger/40 text-danger"
            }`}
          >
            {!loaded ? "CHECKING…" : productionReady ? "YES" : "NO"}
          </span>
          <span className="num text-[11px] text-white/40">
            必須 {doneRequired} / {required.length} 件
          </span>
        </div>

        <p className="mt-4 text-[16px] font-bold leading-[1.7] text-ink sm:text-[19px]">
          {!loaded
            ? "確認しています…"
            : productionReady
              ? "必須項目がすべて3段階そろいました。公開して問題ありません。"
              : `公開できません。必須項目が ${blocking.length} 件、3段階そろっていません。`}
        </p>

        {loaded && !productionReady && (
          <ul className="mt-4 space-y-1.5">
            {blocking.map((b) => (
              <li
                key={b.item.key}
                className="flex flex-wrap gap-x-2.5 gap-y-1 text-[12.5px] leading-[1.9] text-[#FFD7D7]"
              >
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-danger" />
                <span>{b.item.label}</span>
                <span className="num text-[10px] text-white/40">
                  残り：{b.pending.map((s) => STAGE_LABEL[s]).join(" / ")}
                </span>
              </li>
            ))}
          </ul>
        )}

        {loaded && productionReady && recommendedLeft.length > 0 && (
          <p className="mt-3 text-[12px] leading-[1.9] text-warn">
            推奨項目が {recommendedLeft.length} 件残っています。公開はできますが、
            公開後に数字が見えない・改善判断ができない状態になります。
          </p>
        )}

        <p className="mt-5 text-[11px] leading-[1.9] text-white/40">
          この判定は表示です。実際の公開（デプロイ）時にも同じ定義でチェックが走り、
          自動で判定できる必須項目が埋まっていない場合はビルドが失敗して公開されません。
          ただし
          <span className="text-white/70">
            「ビルドが通った」＝「公開してよい」ではありません。
          </span>
          人が目で確かめる段階（E2E VERIFIED）は、機械には判定できないためです。
        </p>
      </div>

      {/* 3段階の意味 */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="num text-[10px] tracking-[0.2em] text-white/35">
          3段階の意味
        </p>
        <div className="mt-3.5 grid gap-2 sm:grid-cols-3">
          {STAGE_ORDER.map((s) => (
            <div key={s} className="rounded-xl border border-white/8 px-3.5 py-3">
              <p className="num text-[10px] tracking-[0.12em] text-white/70">
                {STAGE_LABEL[s]}
              </p>
              <p className="mt-1.5 text-[11px] leading-[1.85] text-white/45">
                {STAGE_MEANING[s]}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3.5 text-[11px] leading-[1.9] text-white/40">
          3つそろって、はじめて公開できます。「コードは書いた」「IDを入れた」だけでは、
          本番で1件も届いていない・1件も計測されていない状態が起こりえます。
        </p>
      </div>

      <Group
        title="必須"
        note="1つでも3段階そろっていなければ公開しない項目です。"
        tone="danger"
        rows={required}
        checked={checked}
        onToggle={toggle}
      />
      <Group
        title="推奨"
        note="公開は止めませんが、埋めないと公開後の改善が感覚になります。"
        tone="warn"
        rows={recommended}
        checked={checked}
        onToggle={toggle}
      />
    </div>
  );
}

type Row = {
  item: CheckItem;
  states: Record<StageId, StageState>;
  ready: boolean;
  pending: StageId[];
};

function Group({
  title,
  note,
  tone,
  rows,
  checked,
  onToggle,
}: {
  title: string;
  note: string;
  tone: "danger" | "warn";
  rows: Row[];
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/8 px-5 py-3.5">
        <span
          className={`num text-[10px] tracking-[0.2em] ${
            tone === "danger" ? "text-danger" : "text-warn"
          }`}
        >
          {title}
        </span>
        <span className="text-[11px] text-white/35">{note}</span>
      </div>

      <div className="divide-y divide-white/5">
        {rows.map((row) => (
          <ItemRow
            key={row.item.key}
            row={row}
            checked={checked}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function ItemRow({
  row,
  checked,
  onToggle,
}: {
  row: Row;
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const { item, states, ready } = row;
  const steps = item.e2eSteps ?? [];
  const doneSteps = steps.filter((_, i) => checked[stepKey(item.key, i)]).length;

  return (
    <div className="px-5 py-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          className={`num text-[12px] ${ready ? "text-ok" : "text-danger"}`}
        >
          {ready ? "✓" : "×"}
        </span>
        <span className="text-[13.5px] font-bold text-white/90">{item.label}</span>
      </div>

      <p className="mt-2 text-[11.5px] leading-[1.9] text-white/50">{item.why}</p>

      {/* 3段階 */}
      <div className="mt-3.5 grid gap-2 lg:grid-cols-3">
        {STAGE_ORDER.map((s) => {
          const stage = item.stages[s];
          const state = states[s];
          const style = STAGE_STYLE[state];
          // 手動でチェックできるのは、細目が無い「未」の段階だけ
          const manual =
            !stage.auto &&
            stage.state === "todo" &&
            !(s === "verified" && steps.length > 0);

          return (
            <div
              key={s}
              className={`rounded-xl border px-3.5 py-3 ${
                state === "ok"
                  ? "border-ok/25 bg-ok/[0.04]"
                  : state === "todo"
                    ? "border-danger/25 bg-danger/[0.04]"
                    : "border-white/8 bg-white/[0.015]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`num rounded border px-1.5 py-0.5 text-[9px] tracking-[0.1em] ${style.chip}`}
                >
                  {style.mark} {STAGE_LABEL[s]}
                </span>
                {!stage.auto && state !== "na" && (
                  <span className="num rounded border border-white/12 px-1.5 py-0.5 text-[9px] text-white/35">
                    目視確認
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-[1.85] text-white/45">
                {stage.detail}
              </p>
              {manual && (
                <button
                  type="button"
                  onClick={() => onToggle(stageKey(item.key, s))}
                  aria-pressed={Boolean(checked[stageKey(item.key, s)])}
                  className="num mt-2.5 rounded-lg border border-white/12 px-3 py-1.5 text-[10.5px] text-white/45 transition-colors hover:border-white/30 hover:text-white/85"
                >
                  確認した
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* E2E の細目 */}
      {steps.length > 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="num text-[10px] tracking-[0.14em] text-white/45">
              E2E VERIFIED の条件
            </span>
            <span
              className={`num text-[10px] ${
                doneSteps === steps.length ? "text-ok" : "text-white/35"
              }`}
            >
              {doneSteps} / {steps.length}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-[1.85] text-white/40">
            全部そろって初めて E2E VERIFIED になります。1つでも残っている間は、
            この項目は済みになりません。
          </p>
          <ul className="mt-3 space-y-1.5">
            {steps.map((label, i) => {
              const k = stepKey(item.key, i);
              const on = Boolean(checked[k]);
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => onToggle(k)}
                    aria-pressed={on}
                    className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                      on
                        ? "border-ok/30 bg-ok/[0.06]"
                        : "border-white/10 hover:border-white/25"
                    }`}
                  >
                    <span
                      className={`num mt-[1px] shrink-0 text-[11px] ${
                        on ? "text-ok" : "text-white/25"
                      }`}
                    >
                      {on ? "✓" : "□"}
                    </span>
                    <span
                      className={`text-[11.5px] leading-[1.75] ${
                        on ? "text-white/70" : "text-white/45"
                      }`}
                    >
                      {label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
