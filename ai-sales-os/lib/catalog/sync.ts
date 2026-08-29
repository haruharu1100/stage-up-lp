import fs from 'node:fs';
import path from 'node:path';
import { config } from '../env';
import { nowIso, upsert, all, parseJson } from '../db/client';
import { CAPABILITIES, OFFERS, type CapabilityDef, type OfferDef, type Readiness } from './definitions';

/**
 * Obsidian（正本）と、このOSが持っているカタログを突き合わせる。
 *
 * ・出典ファイルが実在しない項目は BLOCKED に落とす（根拠の消えた商品を売りに行かせない）
 * ・Vault側にあるのにカタログに無いプロジェクトは「未分類」として報告する
 *   （AIが勝手に商品として売り始めない。人が分類してから増やす）
 */

export type CatalogSyncReport = {
  vaultDir: string;
  vaultExists: boolean;
  offers: { code: string; status: string; evidenceOk: boolean; note: string }[];
  capabilities: { code: string; status: string; readiness: Readiness; evidenceOk: boolean }[];
  unclassifiedVaultDirs: string[];
  sellableCount: number;
};

function evidenceExists(rel: string): boolean {
  const abs = path.join(config.obsidianVaultDir, rel);
  return fs.existsSync(abs);
}

export async function syncCatalog(): Promise<CatalogSyncReport> {
  const at = nowIso();
  const vaultExists = fs.existsSync(config.obsidianVaultDir);

  const offerRows: CatalogSyncReport['offers'] = [];
  for (const o of OFFERS) {
    const ok = vaultExists ? evidenceExists(o.evidence) : false;
    // 根拠が確認できなければ、たとえ SELLABLE と書いてあっても売りに行かせない。
    const status = ok ? o.status : 'BLOCKED';
    const reason = ok
      ? (o.statusReason ?? null)
      : vaultExists
        ? `出典ファイルが見つからない（${o.evidence}）。根拠が確認できないので営業対象から外す。`
        : 'Obsidian（事業Vault）が見つからない。ORICOが未接続の可能性。';
    await upsert(
      'offers',
      {
        code: o.code,
        name: o.name,
        category: o.category,
        status,
        status_reason: reason,
        price_model: o.priceModel,
        price_min: o.priceMin,
        price_max: o.priceMax,
        gross_margin_rate: o.grossMarginRate,
        summary: o.summary,
        fit_industries: JSON.stringify(o.fitIndustries),
        fit_needs: JSON.stringify(o.fitNeeds),
        evidence_path: o.evidence,
        checked_at: at,
        updated_at: at,
      },
      ['code'],
    );
    offerRows.push({ code: o.code, status, evidenceOk: ok, note: reason ?? '' });
  }

  const capRows: CatalogSyncReport['capabilities'] = [];
  for (const c of CAPABILITIES) {
    const ok = vaultExists ? evidenceExists(c.evidence) : false;
    const status = ok ? c.status : 'BLOCKED';
    // ★根拠のファイルが消えたら、仕上がり具合も信用できない。
    //   定義に「本番で動いている」と書いてあっても、証拠が消えたなら実績としては出さない。
    const readiness = ok ? c.readiness : 'NOT_SELLABLE';
    const readinessReason = ok ? c.readinessReason : `出典ファイルが見つからない（${c.evidence}）。実績の裏づけが取れないので売り物にしない。`;
    await upsert(
      'capabilities',
      {
        code: c.code,
        name: c.name,
        kind: c.kind,
        status,
        readiness,
        readiness_reason: readinessReason,
        summary: c.summary,
        keywords: JSON.stringify(c.keywords),
        automation_rate: c.automationRate,
        unit_hours: c.unitHours,
        unit_label: c.unitLabel,
        evidence_path: c.evidence,
        updated_at: at,
      },
      ['code'],
    );
    capRows.push({ code: c.code, status, readiness, evidenceOk: ok });
  }

  // Vault側にあってカタログに無いもの＝人が分類していないプロジェクト
  let unclassified: string[] = [];
  if (vaultExists) {
    const known = new Set(
      [...OFFERS, ...CAPABILITIES].map((x) => x.evidence.split('/')[0]),
    );
    const skip = new Set(['20_KNOWLEDGE', 'MOC', 'テンプレート', '日次', 'プロジェクト', '.obsidian']);
    unclassified = fs
      .readdirSync(config.obsidianVaultDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => !n.startsWith('.') && !skip.has(n) && !known.has(n));
  }

  const sellable = offerRows.filter((o) => o.status === 'SELLABLE').length;
  return {
    vaultDir: config.obsidianVaultDir,
    vaultExists,
    offers: offerRows,
    capabilities: capRows,
    unclassifiedVaultDirs: unclassified,
    sellableCount: sellable,
  };
}

export type OfferRow = {
  code: string;
  name: string;
  category: string;
  status: string;
  status_reason: string | null;
  price_model: string | null;
  price_min: number | null;
  price_max: number | null;
  gross_margin_rate: number | null;
  summary: string;
  fitIndustries: string[];
  fitNeeds: string[];
};

export async function loadOffers(onlySellable = false): Promise<OfferRow[]> {
  const rows = await all(
    onlySellable ? `SELECT * FROM offers WHERE status = 'SELLABLE' ORDER BY code` : `SELECT * FROM offers ORDER BY code`,
  );
  return rows.map((r) => ({
    code: String(r.code),
    name: String(r.name),
    category: String(r.category),
    status: String(r.status),
    status_reason: r.status_reason ?? null,
    price_model: r.price_model ?? null,
    price_min: r.price_min === null ? null : Number(r.price_min),
    price_max: r.price_max === null ? null : Number(r.price_max),
    gross_margin_rate: r.gross_margin_rate === null ? null : Number(r.gross_margin_rate),
    summary: String(r.summary),
    fitIndustries: parseJson<string[]>(r.fit_industries, []),
    fitNeeds: parseJson<string[]>(r.fit_needs, []),
  }));
}

export type CapabilityRow = {
  code: string;
  name: string;
  kind: string;
  status: string;
  readiness: Readiness;
  readiness_reason: string;
  summary: string;
  keywords: string[];
  automation_rate: number;
  unit_hours: number;
  unit_label: string;
};

/**
 * 案件に当ててよい道具かどうか。
 *
 * ★NOT_SELLABLE は当てない。規約・法令で外に出せないものなので、
 *   これが当たったからといって応募に進んではいけない。
 * ★PROTOTYPE は当てる。ただし「実績」としては書かないし、人の判断を通す。
 *   ここを外してしまうと、本当は作れる仕事まで「できることが無い」として捨ててしまう。
 */
export function capabilityUsableForJobs(r: Readiness): boolean {
  return r !== 'NOT_SELLABLE';
}

export async function loadCapabilities(onlyReady = false): Promise<CapabilityRow[]> {
  const rows = await all(
    onlyReady
      ? `SELECT * FROM capabilities WHERE status = 'READY' OR readiness <> 'NOT_SELLABLE' ORDER BY code`
      : `SELECT * FROM capabilities ORDER BY code`,
  );
  return rows.map((r) => ({
    code: String(r.code),
    name: String(r.name),
    kind: String(r.kind),
    status: String(r.status),
    readiness: (String(r.readiness ?? 'PROTOTYPE') as Readiness),
    readiness_reason: String(r.readiness_reason ?? ''),
    summary: String(r.summary),
    keywords: parseJson<string[]>(r.keywords, []),
    automation_rate: Number(r.automation_rate ?? 0),
    unit_hours: Number(r.unit_hours ?? 1),
    unit_label: String(r.unit_label ?? '1件'),
  }));
}

/** 案件に当たったが「請けない」と分かる道具。理由を人に見せるために別で取る。 */
export async function loadUnsellableCapabilities(): Promise<CapabilityRow[]> {
  const caps = await loadCapabilities(false);
  return caps.filter((c) => c.readiness === 'NOT_SELLABLE');
}
