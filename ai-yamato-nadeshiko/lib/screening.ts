/**
 * 商標・同名調査の台帳（data/identity-screening.csv）を読む。
 *
 * ★ここを lib に置いた理由
 *   「調査が終わっているか」は、名前確定・顔生成・投稿生成の全部が参照する。
 *   スクリプトの中に読み込み処理を埋めると、片方だけ判定を緩めた版ができる。
 *   読み方を1本に固定して、どこから見ても同じ結論になるようにする。
 *
 * ★機械はこのCSVを書かない。人が実測して書き込む。
 *   X/Instagram/TikTok のハンドル空き確認は、本プロジェクトの原則
 *   （スクレイピング禁止・ブラウザ自動操作禁止・X公式API以外を叩かない）により
 *   機械では確認できない。人が目視で確認して埋める。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_SCREENINGS,
  type ScreeningGate,
  type ScreeningItem,
  type ScreeningStatus,
} from "./identity.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SCREENING_CSV = resolve(here, "..", "data/identity-screening.csv");

/** CSVを読む。引用符つきセル・セル内改行に対応する */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/**
 * 読めない値を CLEAR に丸めない。
 * "clear " や "OK" のような曖昧な記入は全部 UNKNOWN として扱う。
 */
export function toStatus(raw: string): ScreeningStatus {
  const v = raw.trim().toUpperCase();
  if (v === "CLEAR" || v === "CONFLICT") return v;
  return "UNKNOWN";
}

/**
 * 台帳を読み込む。
 * ★CLEAR でも確認日か出典URLが空なら UNKNOWN へ戻す。
 *   根拠が残っていない「問題なし」は、後から誰も検証できない＝調べていないのと同じ。
 */
export function loadScreening(csvPath: string = SCREENING_CSV): ScreeningItem[] {
  if (!existsSync(csvPath)) return [];

  const specById = new Map(REQUIRED_SCREENINGS.map((r) => [r.id, r]));
  const items: ScreeningItem[] = [];

  for (const r of parseCsv(readFileSync(csvPath, "utf8"))) {
    const id = r["id"] ?? "";
    if (!id) continue;
    const spec = specById.get(id);
    items.push({
      id,
      registry: r["registry"] ?? id,
      status: toStatus(r["status"] ?? ""),
      checkedAt: (r["checked_at"] ?? "").trim() || null,
      sourceUrl: (r["source_url"] ?? "").trim() || null,
      note: r["note"] ?? "",
      // ★ゲートはCSVからは読まず、必ずコード側の定義から引く。
      //   台帳に gate 列を作ると、人が NAME_LOCK を ACCOUNT に書き換えるだけで
      //   商標の衝突を素通りさせられてしまう。
      //   定義に無いIDは一番厳しい NAME_LOCK 扱いにする（安全側に倒す）。
      gate: spec?.gate ?? "NAME_LOCK",
      required: spec?.required ?? false,
    });
  }

  for (const it of items) {
    if (it.status === "CLEAR" && (!it.checkedAt || !it.sourceUrl)) {
      it.note = `${it.note ? it.note + " / " : ""}CLEARだが確認日か出典が空のため UNKNOWN として扱った`;
      it.status = "UNKNOWN";
    }
  }

  return items;
}

export interface RemainingItem {
  id: string;
  registry: string;
  gate: ScreeningGate;
  /** 機械では確認できず、人が目視で埋めるしかない項目か */
  humanOnly: boolean;
}

/**
 * 機械では確認できない項目。
 * 本プロジェクトはスクレイピング禁止・ブラウザ自動操作禁止・X公式API以外を叩かないため、
 * SNSのID空き確認は原理的に自動化できない。
 * 「自動でやれないか」を毎回考え直さないように、ここに明示して固定する。
 */
export const HUMAN_ONLY_SCREENINGS = new Set(["X_HANDLE", "INSTAGRAM_HANDLE", "TIKTOK_HANDLE"]);

/**
 * 必須項目のうち、まだ埋まっていないもの（UNKNOWN または行が無い）。
 *
 * @param gates 見たいゲートを絞る。省略時は全ゲート。
 *   - NAME_LOCK … 名前を確定してよいか
 *   - ACCOUNT   … 本番アカウントを作れるか
 *   - EXPANSION … その地域・商材へ広げてよいか
 */
export function remainingRequired(
  items: ScreeningItem[],
  gates?: ScreeningGate[],
): RemainingItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return REQUIRED_SCREENINGS.filter((r) => r.required)
    .filter((r) => !gates || gates.includes(r.gate))
    .flatMap((r) => {
      const found = byId.get(r.id);
      const unfilled = !found || found.status === "UNKNOWN";
      if (!unfilled) return [];
      return [
        {
          id: r.id,
          registry: r.registry,
          gate: r.gate,
          humanOnly: HUMAN_ONLY_SCREENINGS.has(r.id),
        },
      ];
    });
}
