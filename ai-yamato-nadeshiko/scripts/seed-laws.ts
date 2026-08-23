import { getDb, nowIso } from "../lib/db.js";
import { REQUIRED_LAW_IDS } from "../lib/compliance.js";

// 00_SYSTEM/法令台帳.md の内容をDBへ写す。
// ★id は compliance.ts の LAW_FOR_CHECK と完全一致させる。
//   表記が1文字でもずれると、そのチェックは「台帳に行が無い」として永久に判定停止する。
//   実際にこの取り違えで全判定が止まったので、投入の最後に機械で照合する。
// ★条文・日付をコードへ直接書かないルールの例外はここだけ。
//   ここは「台帳の写し」であって判定ロジックではない。判定側は必ず laws テーブルを読む。
//   台帳を更新したら、このスクリプトを更新して再投入する（上書きせず版を積む）。
const LAWS = [
  {
    id: "EU_AI_ACT_50",
    name: "EU AI Act 第50条（透明性義務）",
    law_version: "Regulation (EU) 2024/1689 第50条（2026年に適用関係の改正条文あり）",
    source_url: "REQUIRES_PRIMARY_SOURCE:eur-lex",
    checked_at: "2026-08-22",
    effective_date: "2026-08-02",
    // 2026-08-02より前に市場投入された生成AIシステムの第50条(2)対応期限。
    // 「◯月◯日から全部同じ義務」と固定しないための欄
    transition_date: "2026-12-02",
    summary:
      "2026-08-02が主要な適用日。ただし市場投入時期によって対応期限が異なり経過措置がある。二次情報経由で一次未確認",
    is_primary_source: 0,
  },
  {
    id: "FTC_ENDORSEMENT",
    name: "米国FTC Endorsement Guides",
    law_version: "16 CFR Part 255（2023改訂）＋ 公式Q&A",
    source_url: "REQUIRES_PRIMARY_SOURCE:ftc.gov",
    checked_at: "2026-08-22",
    effective_date: "施行済み",
    transition_date: null,
    summary:
      "AIアバター/バーチャルインフルエンサーの広告利用自体は一律禁止ではない（blanket prohibition無し）。禁じられるのは使っていない商品を使ったと見せる虚偽・偽装。主張は真実・誤解を招かない・根拠が必要",
    is_primary_source: 0,
  },
  {
    id: "NY_SYNTHETIC_PERFORMER",
    name: "ニューヨーク州法（synthetic performer 開示）",
    law_version: "UNKNOWN",
    source_url: "REQUIRES_PRIMARY_SOURCE:ny",
    checked_at: "2026-08-22",
    effective_date: "2026-06",
    transition_date: null,
    summary: "商業広告で合成された演者を使う場合の開示義務。二次情報",
    is_primary_source: 0,
  },
  {
    id: "X_AUTHENTICITY",
    name: "X Authenticity ポリシー",
    law_version: "UNKNOWN",
    source_url: "REQUIRES_PRIMARY_SOURCE:help.x.com(403)",
    checked_at: "2026-08-22",
    effective_date: "施行済み",
    transition_date: null,
    summary: "禁止対象は欺瞞的ななりすまし。AIキャラ全般の開示義務ではない",
    is_primary_source: 0,
  },
  {
    id: "X_AUTOMATED_ACCOUNT",
    name: "X Automated Account ポリシー",
    law_version: "UNKNOWN",
    source_url: "REQUIRES_PRIMARY_SOURCE:help.x.com(403)",
    checked_at: "2026-08-22",
    effective_date: "施行済み",
    transition_date: null,
    summary: "完全自動運用時にAutomatedラベルと運営者明記が必要",
    is_primary_source: 0,
  },
  {
    id: "X_ADULT_CONTENT",
    name: "X Adult Content ポリシー",
    law_version: "UNKNOWN",
    source_url: "REQUIRES_PRIMARY_SOURCE:help.x.com(403)",
    checked_at: "2026-08-22",
    effective_date: "施行済み",
    transition_date: null,
    summary: "センシティブラベルでFor You・検索・トレンドから除外。暗示的表現も対象",
    is_primary_source: 0,
  },
  {
    id: "JP_KEIHYO",
    name: "景品表示法",
    law_version: "UNKNOWN",
    source_url: "REQUIRES_PRIMARY_SOURCE:caa.go.jp",
    checked_at: "2026-08-22",
    effective_date: "施行済み",
    transition_date: null,
    summary: "優良誤認・有利誤認、断定・誇大はNG。収益額を対外訴求しない",
    is_primary_source: 0,
  },
  {
    id: "JP_KEIHO_175",
    name: "刑法175条",
    law_version: "UNKNOWN",
    source_url: "REQUIRES_PRIMARY_SOURCE:e-gov",
    checked_at: "2026-08-22",
    effective_date: "施行済み",
    transition_date: null,
    summary:
      "海外サーバー・海外向けでも日本から閲覧可能なら国内犯として処罰可能。アダルト不採用の根拠",
    is_primary_source: 0,
  },
  {
    id: "US_CA_SB942",
    name: "カリフォルニア SB 942",
    law_version: "UNKNOWN",
    source_url: "REQUIRES_PRIMARY_SOURCE:ca.gov",
    checked_at: "2026-08-22",
    effective_date: "2026-08-02",
    transition_date: null,
    summary: "対象は月間100万ユーザー超の提供者。個人事業主は直接対象外",
    is_primary_source: 0,
  },
];

const db = getDb();
for (const law of LAWS) {
  await db.execute({
    sql: `INSERT INTO laws (id, name, law_version, source_url, checked_at,
            effective_date, transition_date, summary, is_primary_source)
          VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            law_version=excluded.law_version, source_url=excluded.source_url,
            checked_at=excluded.checked_at, effective_date=excluded.effective_date,
            transition_date=excluded.transition_date, summary=excluded.summary,
            is_primary_source=excluded.is_primary_source`,
    args: [
      law.id, law.name, law.law_version, law.source_url, law.checked_at,
      law.effective_date, law.transition_date, law.summary, law.is_primary_source,
    ],
  });
}

const stale = LAWS.filter((l) => {
  const days = (Date.now() - new Date(l.checked_at).getTime()) / 86400000;
  return days > 90;
});
const unverified = LAWS.filter((l) => l.source_url.startsWith("REQUIRES_PRIMARY_SOURCE"));

// 判定側が必要とするIDが台帳に揃っているかを照合する。欠けたらそのチェックは永久にHALTする
const seeded = new Set(LAWS.map((l) => l.id.toUpperCase()));
const missing = REQUIRED_LAW_IDS.filter((id) => !seeded.has(id.toUpperCase()));

console.log(`法令台帳を投入: ${LAWS.length}件（${nowIso().slice(0, 10)}）`);
console.log(`  一次情報URL未取得: ${unverified.length}件 → 人がブラウザで確認してURLと日付を入れること`);
console.log(`  CHECKED_AT が90日超: ${stale.length}件${stale.length ? " → 判定は停止し人へ通知されます" : ""}`);

if (missing.length) {
  console.error(`  ★判定側が必要とするIDが台帳に無い: ${missing.join(", ")}`);
  console.error(`   → このIDを使うコンプライアンス判定は全部 HALT します。IDの表記を合わせてください。`);
  process.exit(1);
}
console.log(`  判定側が必要とするID ${REQUIRED_LAW_IDS.length}件: すべて台帳にあります`);
