// 事業Vault/AI YAMATO NADESHIKO/ を唯一の正として扱う。
// ★AIができるのは「末尾へ追記」だけ。既存行の書き換え・削除は一切できない。
//   ルール文と判断文は人間のものなので、機械が触れない構造にしておく。
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { today } from "./db.js";

export const VAULT = resolve(
  "/Volumes/ORICO/保存用/hp用/hp-auto-system/事業Vault/AI YAMATO NADESHIKO",
);

// AIが書き込んでよいファイルはこの3つだけ。増やす時は人間が判断する
export const WRITABLE = {
  learnings: "07_KNOWLEDGE/LEARNINGS.md",
  analytics: "05_ANALYTICS/日次実績ログ.md",
  applications: "02_AFFILIATE/申請ログ.md",
} as const;

export type WritableKey = keyof typeof WRITABLE;

// 分類のない記録は残さない。後から「これは事実か仮説か」を判別できなくなる
export type Kind = "FACT" | "HYPOTHESIS" | "ASSUMPTION" | "EXPERIMENT" | "DECISION";

// AIが書いた行だと一目で分かる印。人間が書いた行と混ざらないようにする
const AI_MARK = "🤖AI";

export interface Entry {
  kind: Kind;
  title: string;
  body: string;
  /** 事実主張なら必須。無い FACT は書かせない */
  sourceUrl?: string;
  /** 情報を確認した日。省略時は今日 */
  checkedAt?: string;
}

function pathOf(key: WritableKey): string {
  return resolve(VAULT, WRITABLE[key]);
}

function assertVaultAvailable(): void {
  if (!existsSync(VAULT)) {
    throw new Error(
      `事業Vault が見つかりません: ${VAULT}\nORICOが接続されているか確認してください。`,
    );
  }
}

export function appendEntry(key: WritableKey, e: Entry): string {
  assertVaultAvailable();

  if (e.kind === "FACT" && !e.sourceUrl) {
    throw new Error(
      `FACT には source_url が必要です（"${e.title}"）。` +
        `根拠の無い断定は HYPOTHESIS か ASSUMPTION で書いてください。`,
    );
  }

  const checkedAt = e.checkedAt ?? today();
  const file = pathOf(key);
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";

  const block = [
    "",
    `### ${AI_MARK} [${e.kind}] ${e.title}`,
    "",
    `- 記録日: ${checkedAt}`,
    e.sourceUrl ? `- 出典: ${e.sourceUrl}` : `- 出典: なし（${e.kind}）`,
    "",
    e.body.trimEnd(),
    "",
  ].join("\n");

  appendFileSync(file, block, "utf8");

  // 追記の前に存在した本文が1文字でも変わっていたら異常として止める
  const after = readFileSync(file, "utf8");
  if (!after.startsWith(before)) {
    throw new Error(`既存の記述が変化しました: ${file}（追記以外の書き換えは禁止）`);
  }

  return file;
}

// 外れた仮説・失敗は消さずに積む。消すと同じ失敗を繰り返す
export function appendLearning(e: Entry): string {
  return appendEntry("learnings", e);
}

export interface DailyNumbers {
  date: string;
  posts: number;
  fetchedOk: number;
  fetchedNg: number;
  impressions: number | null;
  urlLinkClicks: number | null;
  costUsd: number;
  atRisk: number;
}

// 数値の追記だけはAIが自動で行ってよい（判断文は書かない）
export function appendDaily(n: DailyNumbers): string {
  const num = (v: number | null) => (v === null ? "未取得" : v.toLocaleString("en-US"));
  return appendEntry("analytics", {
    kind: "FACT",
    title: `${n.date} の実績`,
    sourceUrl: "X API（自アカウントの実測値）",
    checkedAt: n.date,
    body: [
      `| 項目 | 値 |`,
      `|---|---|`,
      `| 対象投稿 | ${n.posts}件 |`,
      `| 取得できた | ${n.fetchedOk}件 |`,
      `| 取得できなかった | ${n.fetchedNg}件 |`,
      `| インプレッション | ${num(n.impressions)} |`,
      `| リンククリック | ${num(n.urlLinkClicks)} |`,
      `| 読み取り費用 | $${n.costUsd.toFixed(3)} |`,
      `| 期限が近い投稿 | ${n.atRisk}件 |`,
      "",
      n.atRisk > 0
        ? `★ 期限が近い投稿があります。30日を過ぎるとリンククリック数は永久に取得できません。`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}
