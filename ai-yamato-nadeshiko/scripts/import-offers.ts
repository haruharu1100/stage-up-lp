/**
 * 02_AFFILIATE/OFFERS.md（43社の全数調査台帳）を networks / offers へ取り込む。
 *
 * ★守っていること
 *   - UNKNOWN は UNKNOWN のまま入れる。null や false に潰さない
 *   - 機械で読めなかったセルは推測で埋めず、meta.unparsed に残して件数を報告する
 *   - 報酬が一次情報で確定していない行には verified_at を付けない（= 使用不可のまま残す）
 *   - アダルト主体の行は取り込まない（offers.adult_flag は 0 しか許さないスキーマ）
 *
 * 実行: npm run offers:import
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../lib/db.js";
import { COOKIE_UNLIMITED, FX, type OfferCategory, type TriState } from "../lib/offers.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const VAULT =
  process.env.VAULT_DIR ?? resolve(root, "..", "事業Vault", "AI YAMATO NADESHIKO");
const OFFERS_MD = resolve(VAULT, "02_AFFILIATE", "OFFERS.md");

// ===========================================================================
// markdown の小道具
// ===========================================================================

const clean = (s: string): string =>
  s.replace(/\*\*/g, "").replace(/`/g, "").replace(/★/g, "").trim();

function isTableLine(l: string): boolean {
  return l.trimStart().startsWith("|");
}

function isSeparator(l: string): boolean {
  return /^\|[\s:|-]+\|$/.test(l.trim());
}

function cellsOf(line: string): string[] {
  const t = line.trim();
  return t.slice(1, t.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
}

/** 見出しで囲まれた範囲を切り出す */
function section(lines: string[], startRe: RegExp, level: number): string[] {
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) return [];
  const stop = new RegExp(`^#{1,${level}} `);
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (stop.test(l)) return lines.slice(start + 1, i);
  }
  return lines.slice(start + 1);
}

/** 指定の見出し語を含むヘッダ行を持つ表を取り出す */
function findTable(lines: string[], required: string[]): string[][] {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (!isTableLine(l) || isSeparator(l)) continue;
    const header = cellsOf(l).map(clean);
    if (!required.every((r) => header.some((h) => h.includes(r)))) continue;
    const rows: string[][] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const r = lines[j] ?? "";
      if (!isTableLine(r)) break;
      if (isSeparator(r)) continue;
      rows.push(cellsOf(r));
    }
    return [header, ...rows];
  }
  return [];
}

// ===========================================================================
// 値の読み取り（読めなければ null。0や false にしない）
// ===========================================================================

type Evidence = "PRIMARY" | "SECONDARY" | "UNKNOWN";

function classify(value: string, source = ""): Evidence {
  const v = `${value} ${source}`;
  if (/UNKNOWN|記載なし|不明|確認できず|矛盾/.test(value)) return "UNKNOWN";
  if (/二次/.test(v)) return "SECONDARY";
  if (/一次/.test(v)) return "PRIMARY";
  return "UNKNOWN";
}

function hasUnknown(v: string): boolean {
  return /UNKNOWN|記載なし|不明|—|^-$/.test(v.trim());
}

/** 「禁止と書いていない＝許可」ではない。判断できないものは必ず UNKNOWN */
function triSocial(v: string): TriState {
  const s = clean(v);
  if (!s || hasUnknown(s)) return "UNKNOWN";
  if (/受け入れない|拒否|禁止(?!記載なし|なし)/.test(s)) return "NO";
  if (/明示的に許可|許可|⭕|可能|(^|[^不])可/.test(s)) return "YES";
  return "UNKNOWN";
}

function triJapan(v: string): TriState {
  const s = clean(v);
  if (!s || hasUnknown(s)) return "UNKNOWN";
  if (/対象外|不可|含まれない/.test(s)) return "NO";
  if (/禁止国リストに日本は無い|日本法人|日本企業|日本拠点|^可/.test(s)) return "YES";
  return "UNKNOWN";
}

/** 43社すべて「記載なし」。ここで YES を作らない */
function triAi(v: string): TriState {
  const s = clean(v);
  if (/許可|可能|OK/.test(s) && !/記載なし/.test(s)) return "YES";
  if (/禁止|不可|対象外/.test(s)) return "NO";
  return "UNKNOWN";
}

type Money = { amount: number; currency: string };

function moneysIn(text: string): Money[] {
  const out: Money[] = [];
  const t = clean(text);
  for (const m of t.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)) {
    out.push({ amount: Number((m[1] ?? "").replace(/,/g, "")), currency: "USD" });
  }
  for (const m of t.matchAll(/€\s?([\d,]+(?:\.\d+)?)/g)) {
    out.push({ amount: Number((m[1] ?? "").replace(/,/g, "")), currency: "EUR" });
  }
  for (const m of t.matchAll(/£\s?([\d,]+(?:\.\d+)?)/g)) {
    out.push({ amount: Number((m[1] ?? "").replace(/,/g, "")), currency: "GBP" });
  }
  for (const m of t.matchAll(/([\d,]+(?:\.\d+)?)\s?円/g)) {
    out.push({ amount: Number((m[1] ?? "").replace(/,/g, "")), currency: "JPY" });
  }
  return out.filter((m) => Number.isFinite(m.amount));
}

function toUsd(m: Money): number {
  if (m.currency === "JPY") return m.amount / FX.JPY_PER_USD;
  if (m.currency === "EUR") return m.amount * FX.USD_PER_EUR;
  if (m.currency === "GBP") return m.amount * FX.USD_PER_GBP;
  return m.amount;
}

function parseMinPayoutUsd(v: string): number | null {
  const s = clean(v);
  if (!s || hasUnknown(s)) return null;
  // 台帳が「$5 or $50（矛盾）」と割れている段で片方を選ぶと、無い確実性を作ってしまう
  if (/矛盾/.test(s)) return null;
  if (/^なし/.test(s) || /最低.*なし|下限なし/.test(s)) return 0;
  const found = moneysIn(s);
  if (found.length === 0) return null;
  // 「PayPal = $0 ／ 銀行 = $50以上」のように複数あるときは最も早く現金化できる方
  return Math.min(...found.map(toUsd));
}

function parseCookieDays(v: string): number | null {
  const s = clean(v);
  if (!s || hasUnknown(s)) return null;
  if (/矛盾|or /.test(s)) return null; // 情報が割れている段は埋めない
  if (/無期限|never expire/i.test(s)) return COOKIE_UNLIMITED;
  const hour = s.match(/(\d+)\s?時間/);
  if (hour) return Math.max(0, Math.round(Number(hour[1]) / 24));
  if (/セッション/.test(s)) return 0;
  const range = s.match(/(\d+)\s?[〜~-]\s?(\d+)\s?日/);
  if (range) return null; // 幅がある＝確定していない
  const day = s.match(/(\d+)\s?日/);
  return day ? Number(day[1]) : null;
}

type Payout = {
  type: "CPA" | "REVSHARE" | null;
  amount: number | null;
  currency: string;
  revshare: number | null;
};

function parsePayout(v: string): Payout {
  const s = clean(v);
  if (!s || hasUnknown(s)) return { type: null, amount: null, currency: "USD", revshare: null };
  const pct = s.match(/([\d.]+)\s?%/);
  const money = moneysIn(s).filter((m) => m.amount > 0);
  const first = money[0] ?? null;
  return {
    type: first ? "CPA" : pct ? "REVSHARE" : null,
    amount: first ? first.amount : null,
    currency: first ? first.currency : "USD",
    revshare: pct ? Number(pct[1]) : null,
  };
}

function parsePayoutMethods(text: string): string[] {
  const t = clean(text);
  const table: [RegExp, string][] = [
    [/PayPal/i, "PayPal"],
    [/Payoneer/i, "Payoneer"],
    [/銀行|bank/i, "銀行送金"],
    [/ACH/i, "ACH"],
    [/暗号資産|crypto/i, "暗号資産"],
    [/クレカ|クレジット/, "クレカ"],
    [/Wise/i, "Wise"],
    [/Skrill/i, "Skrill"],
  ];
  const out = table.filter(([re]) => re.test(t)).map(([, name]) => name);
  if (/JPY(のみ|建て)/.test(t)) out.push("JPY建て(日本の銀行)");
  return out;
}

// ===========================================================================
// カテゴリ
// ===========================================================================

const CATEGORY_RULES: [RegExp, OfferCategory][] = [
  [/VPN|Surfshark|NordVPN|CyberGhost|Proton/i, "VPN"],
  [/eSIM|SIM|WiFi|Wi-Fi|Airalo|Holafly|Saily|Ubigi|Nomad/i, "ESIM"],
  [/語学|Pod101|italki|Preply|Innovative Language|Udemy/i, "JAPANESE_LANGUAGE"],
  [
    /TokyoTreat|Sakuraco|YumeTwins|nomakenolife|ICHIGO|和食器|MUSUBI|Kokoro|Japanese Taste|Bokksu|Crate|Buyee|ZenMarket|ZenPop|Amazon/i,
    "JAPAN_PRODUCTS",
  ],
  [
    /旅行|体験|ホテル|Travel|Trip|Viator|GetYourGuide|Klook|Expedia|JRPass|MagicalTrip|byFood|Booking|Agoda|Rakuten Travel|SafetyWing/i,
    "JAPAN_TRAVEL",
  ],
  [/ElevenLabs|Jasper|AIサービス|AI tools/i, "AI_TOOLS"],
];

function categoryOf(label: string): OfferCategory {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(label)) return cat;
  return "OTHER";
}

// ===========================================================================
// ID / 名前
// ===========================================================================

function stripParen(s: string): string {
  return clean(s).replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
}

function slug(name: string, fallback: string): string {
  const base = stripParen(name)
    .split(/[／/]/)[0]
    ?? "";
  const s = base
    .replace(/\s+(inc|co|ltd|llc)\.?$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || fallback;
}

function nameKey(s: string): string {
  const base = stripParen(s).split(/[／/]/)[0] ?? "";
  return base
    .replace(/\s+(inc|co|ltd|llc)\.?$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// ===========================================================================
// 取り込み対象の中間形
// ===========================================================================

type Parsed = {
  id: string;
  name: string;
  ref: string;
  sec: "A" | "B" | "C";
  category: OfferCategory;
  raw: Record<string, string>;
  evidence: { primary: number; secondary: number; unknown: number };
  payout: Payout;
  cookieDays: number | null;
  minPayoutUsd: number | null;
  payoutMethods: string[];
  japanOk: TriState;
  allowsSocial: TriState;
  allowsAi: TriState;
  allowedTraffic: string;
  restrictions: string[];
  landingUrl: string | null;
  notes: string;
  payoutIsPrimary: boolean;
  excluded: boolean;
  excludedReason: string | null;
  unparsed: string[];
};

const ADULT_RE = /CrakRevenue|A\.W\. Empire|ExoClick|AdCombo|ClickDealer|FANZA|DMM/i;

function splitPhrases(s: string): string[] {
  return clean(s)
    .split(/[、,。\n／]/)
    .map((x) => x.replace(/\[.*?\]/g, "").trim())
    .filter((x) => x.length >= 3);
}

// ===========================================================================
// 本体
// ===========================================================================

const md = readFileSync(OFFERS_MD, "utf8");
const lines = md.split("\n");

const checkedAt =
  md.match(/checked_at:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
if (!checkedAt) {
  console.error("OFFERS.md から checked_at を読めなかった。推測で日付を作らないので中止する。");
  process.exit(1);
}

const parsed: Parsed[] = [];
const skipped: { name: string; reason: string }[] = [];

// ---------------------------------------------------------------- セクション A
const aHeadings = lines
  .map((l, i) => ({ l, i }))
  .filter(({ l }) => /^### A-\d+\./.test(l));

for (const { l, i } of aHeadings) {
  const ref = l.match(/^### (A-\d+)\./)?.[1] ?? "A-?";
  const title = clean(l.replace(/^### A-\d+\.\s*/, "")).replace(/申請\d+番目/, "").trim();
  const end = lines.findIndex((x, j) => j > i && /^#{2,3} /.test(x));
  const body = lines.slice(i + 1, end < 0 ? lines.length : end);

  const raw: Record<string, string> = {};
  const ev = { primary: 0, secondary: 0, unknown: 0 };
  const noteLines: string[] = [];
  const unparsed: string[] = [];
  let payoutIsPrimary = false;

  for (const line of body) {
    if (!isTableLine(line)) {
      const t = clean(line);
      if (t && !t.startsWith("|")) noteLines.push(t);
      continue;
    }
    if (isSeparator(line)) continue;
    const c = cellsOf(line);
    const key = clean(c[0] ?? "");
    const value = clean(c[1] ?? "");
    const src = clean(c[2] ?? "");
    if (!key || key === "項目") continue;
    if (!value) {
      unparsed.push(`${ref} ${key}: 値が空`);
      continue;
    }
    // 「最低支払 / 支払方法」のように1行が2項目のことがある。
    // 空白で囲まれた / だけを区切りとみなす（「X/SNS」を割らないため）
    for (const k of key.split(/\s+\/\s+/)) raw[k.trim()] = value;
    const kind = classify(value, src);
    if (kind === "PRIMARY") ev.primary++;
    else if (kind === "SECONDARY") ev.secondary++;
    else ev.unknown++;
    if (/報酬/.test(key) && kind === "PRIMARY") payoutIsPrimary = true;
  }

  const name = stripParen(title);
  const id = slug(title, ref.toLowerCase());
  const payoutRaw = raw["報酬"] ?? "";
  const methodRaw = [raw["支払方法"], raw["支払"], raw["通貨"], raw["USD受取"]]
    .filter(Boolean)
    .join(" ／ ");
  const snsRaw = raw["X/SNS"] ?? raw["X / SNS"] ?? "";
  const restrictionRaw = [raw["禁止トラフィック"], raw["禁止"], raw["商標PPC"], raw["PPC"]]
    .filter(Boolean)
    .join("、");

  parsed.push({
    id,
    name,
    ref,
    sec: "A",
    category: categoryOf(`${title} ${raw["報酬"] ?? ""}`),
    raw,
    evidence: ev,
    payout: parsePayout(payoutRaw),
    cookieDays: parseCookieDays(raw["Cookie"] ?? ""),
    minPayoutUsd: parseMinPayoutUsd(raw["最低支払"] ?? ""),
    payoutMethods: parsePayoutMethods(methodRaw),
    japanOk: triJapan(`${raw["日本在住"] ?? ""} ${raw["運営"] ?? ""}`),
    allowsSocial: triSocial(snsRaw),
    allowsAi: triAi(raw["AI生成可否"] ?? ""),
    allowedTraffic: snsRaw,
    restrictions: splitPhrases(restrictionRaw),
    landingUrl: (raw["公式"] ?? "").split(/\s|／/)[0] ?? null,
    notes: [raw["評判"] ?? "", ...noteLines].filter(Boolean).join(" "),
    payoutIsPrimary,
    excluded: false,
    excludedReason: null,
    unparsed,
  });
}

// ---------------------------------------------------------------- セクション B
{
  const body = section(lines, /^## B\./, 2);
  const table = findTable(body, ["案件", "報酬", "Cookie"]);
  const header = table[0] ?? [];
  const col = (want: string): number => header.findIndex((h) => clean(h).includes(want));
  const iName = col("案件");
  const iPay = col("報酬");
  const iCookie = col("Cookie");
  const iMin = col("最低支払");
  const iMethod = col("支払");
  const iJapan = col("日本在住");
  const iSns = col("X/SNS");
  const iAi = header.findIndex((h) => clean(h) === "AI");
  const iWhy = col("保留理由");

  for (const row of table.slice(1)) {
    const ref = clean(row[0] ?? "");
    if (!/^B-\d+$/.test(ref)) continue;
    const name = stripParen(row[iName] ?? "");
    if (!name) continue;
    if (ADULT_RE.test(name)) {
      skipped.push({ name, reason: "アダルト主体（offers.adult_flag=0 のスキーマに入れない）" });
      continue;
    }

    const get = (i: number) => (i >= 0 ? clean(row[i] ?? "") : "");
    const raw: Record<string, string> = {
      報酬: get(iPay),
      Cookie: get(iCookie),
      最低支払: get(iMin),
      支払: get(iMethod),
      日本在住: get(iJapan),
      "X/SNS": get(iSns),
      AI生成可否: get(iAi),
      保留理由: get(iWhy),
      ネットワーク: get(iMethod),
    };

    const ev = { primary: 0, secondary: 0, unknown: 0 };
    for (const k of ["報酬", "Cookie", "最低支払", "支払", "日本在住", "X/SNS", "AI生成可否"]) {
      const kind = classify(raw[k] ?? "");
      if (kind === "PRIMARY") ev.primary++;
      else if (kind === "SECONDARY") ev.secondary++;
      else ev.unknown++;
    }

    parsed.push({
      id: slug(name, ref.toLowerCase().replace("-", "_")),
      name,
      ref,
      sec: "B",
      category: categoryOf(`${clean(row[iName] ?? "")} ${raw["報酬"]}`),
      raw,
      evidence: ev,
      payout: parsePayout(raw["報酬"] ?? ""),
      cookieDays: parseCookieDays(raw["Cookie"] ?? ""),
      minPayoutUsd: parseMinPayoutUsd(raw["最低支払"] ?? ""),
      payoutMethods: parsePayoutMethods(raw["支払"] ?? ""),
      japanOk: triJapan(raw["日本在住"] ?? ""),
      allowsSocial: triSocial(raw["X/SNS"] ?? ""),
      allowsAi: triAi(raw["AI生成可否"] ?? ""),
      allowedTraffic: raw["X/SNS"] ?? "",
      restrictions: [],
      landingUrl: null,
      notes: raw["保留理由"] ?? "",
      payoutIsPrimary: classify(raw["報酬"] ?? "") === "PRIMARY",
      excluded: false,
      excludedReason: null,
      unparsed: [],
    });
  }
}

// ---------------------------------------------------------------- セクション C
{
  const body = section(lines, /^## C\./, 2);
  const table = findTable(body, ["案件", "不採用"]);
  for (const row of table.slice(1)) {
    const name = stripParen(row[0] ?? "");
    const reason = clean(row[1] ?? "");
    if (!name || !reason) continue;
    if (ADULT_RE.test(name)) {
      skipped.push({ name, reason: "アダルト主体（offers.adult_flag=0 のスキーマに入れない）" });
      continue;
    }
    parsed.push({
      id: slug(name, `c_${parsed.length}`),
      name,
      ref: "C",
      sec: "C",
      category: categoryOf(name),
      raw: { 不採用の理由: reason },
      evidence: { primary: 1, secondary: 0, unknown: 0 },
      payout: { type: null, amount: null, currency: "USD", revshare: null },
      cookieDays: null,
      minPayoutUsd: null,
      payoutMethods: [],
      japanOk: "UNKNOWN",
      allowsSocial: /受け入れない|記載が無い/.test(reason) ? "NO" : "UNKNOWN",
      allowsAi: "UNKNOWN",
      allowedTraffic: "",
      restrictions: [],
      landingUrl: null,
      notes: reason,
      payoutIsPrimary: false,
      excluded: true,
      excludedReason: reason,
      unparsed: [],
    });
  }
}

// ---------------------------------------------------------------- セクション D（申請可能タイミング）
const readiness = new Map<string, { when: string; prereq: string }>();
{
  const body = section(lines, /^## D\./, 2);
  const table = findTable(body, ["案件", "いつ"]);
  const header = table[0] ?? [];
  const iName = header.findIndex((h) => clean(h).includes("案件"));
  const iWhen = header.findIndex((h) => clean(h).includes("いつ"));
  const iPre = header.findIndex((h) => clean(h).includes("前提"));
  for (const row of table.slice(1)) {
    const key = nameKey(row[iName] ?? "");
    if (!key) continue;
    readiness.set(key, {
      when: clean(iWhen >= 0 ? row[iWhen] ?? "" : ""),
      prereq: clean(iPre >= 0 ? row[iPre] ?? "" : ""),
    });
  }
}

// ---------------------------------------------------------------- 書き込み
const db = getDb();
let nNetworks = 0;
let nOffers = 0;
let nVerified = 0;
const unknownReport: string[] = [];

for (const p of parsed) {
  const verifiedAt = p.payoutIsPrimary ? checkedAt : null;
  if (verifiedAt) nVerified++;
  else if (!p.excluded) {
    unknownReport.push(`${p.ref} ${p.name}: 報酬が一次情報で確定していない → verified_at なし`);
  }

  const read = readiness.get(nameKey(p.name)) ?? null;

  // networks は「プログラム運営元」の台帳（NETWORKS.md と同じ粒度）。
  // 1つの network 行を複数プログラムで共有すると SNS可否/日本在住可否が混ざるので分ける
  const networkId = p.id;
  const networkName = p.raw["ネットワーク"]
    ? `${p.name}（${clean(p.raw["ネットワーク"] ?? "")}）`
    : p.name;

  await db.execute({
    sql: `INSERT OR REPLACE INTO networks
            (id, name, login_url, payout_methods, min_payout_usd,
             allows_social_traffic, allows_ai_content, japan_ok, has_api, notes, source_url, verified_at)
          VALUES (?,?,?,?,?,?,?,?,0,?,?,?)`,
    args: [
      networkId,
      networkName,
      p.landingUrl,
      JSON.stringify(p.payoutMethods),
      p.minPayoutUsd,
      p.allowsSocial,
      p.allowsAi,
      p.japanOk,
      p.notes || null,
      p.landingUrl,
      verifiedAt,
    ],
  });
  nNetworks++;

  const meta = {
    ref: p.ref,
    section: p.sec,
    evidence: p.evidence,
    readiness: read,
    raw: p.raw,
    notes: p.notes,
    excluded: p.excluded,
    excludedReason: p.excludedReason,
    unparsed: p.unparsed,
  };

  await db.execute({
    sql: `INSERT OR REPLACE INTO offers
            (id, network_id, name, category, adult_flag, payout_type, payout_amount,
             payout_currency, revshare_pct, cookie_days, geo_allowed, allowed_traffic,
             restrictions, landing_url, tracking_url, approval_status, epc_reported,
             min_payout_usd, source, source_url, verified_at)
          VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?,NULL,'NOT_APPLIED',NULL,?,?,?,?)`,
    args: [
      p.id,
      networkId,
      p.name,
      p.category,
      p.payout.type,
      p.payout.amount,
      p.payout.currency,
      p.payout.revshare,
      p.cookieDays,
      null,
      p.allowedTraffic || null,
      JSON.stringify(p.restrictions),
      p.landingUrl,
      p.minPayoutUsd,
      JSON.stringify(meta),
      p.landingUrl,
      verifiedAt,
    ],
  });
  nOffers++;
}

// ---------------------------------------------------------------- 報告
const bySection = (s: string) => parsed.filter((p) => p.sec === s).length;
const unknownCells = parsed.reduce(
  (acc, p) => acc + p.evidence.unknown,
  0,
);
const noReadiness = parsed.filter((p) => !p.excluded && !readiness.has(nameKey(p.name))).length;
const unparsedAll = parsed.flatMap((p) => p.unparsed);

console.log(`OFFERS.md 取り込み 完了（checked_at: ${checkedAt}）`);
console.log(`  ファイル: ${OFFERS_MD}`);
console.log(`  networks: ${nNetworks}行 / offers: ${nOffers}行`);
console.log(`    A（最優先・一次情報確定）: ${bySection("A")}件`);
console.log(`    B（次点・未確認あり）    : ${bySection("B")}件`);
console.log(`    C（不採用・除外）        : ${bySection("C")}件`);
console.log(`  verified_at あり（報酬が一次情報）: ${nVerified}件`);
console.log(`  verified_at なし（使用不可）      : ${nOffers - nVerified}件`);
console.log(`  UNKNOWN のまま保持したセル: ${unknownCells}個`);
console.log(`  申請タイミング（セクションD）が無い案件: ${noReadiness}件 → 申請順に置けない`);
if (skipped.length) {
  console.log(`  取り込まなかった行: ${skipped.length}件`);
  for (const s of skipped) console.log(`    - ${s.name}: ${s.reason}`);
}
if (unparsedAll.length) {
  console.log(`  機械で読めなかったセル: ${unparsedAll.length}件（推測で埋めていない）`);
  for (const u of unparsedAll.slice(0, 20)) console.log(`    - ${u}`);
}
if (unknownReport.length) {
  console.log(`\n  ★verified_at を付けなかった案件（推薦対象から外れる）:`);
  for (const r of unknownReport) console.log(`    - ${r}`);
}
