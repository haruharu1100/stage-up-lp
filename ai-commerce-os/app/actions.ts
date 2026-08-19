'use server';

import { revalidatePath } from 'next/cache';
import { nowIso, run } from '@/lib/db/client';
import { runImport } from '@/lib/pipeline/import';
import { runAnalyze } from '@/lib/pipeline/analyze';
import { runRoutes } from '@/lib/pipeline/routes';
import { importMarketData } from '@/lib/marketdata';
import { ensureReady } from '@/lib/queries';
import { invalidateSettingsCache, setSetting, SETTING_DEFS } from '@/lib/settings';
import { CONDITION_RANKS, type ConditionRank } from '@/lib/conditions';

/**
 * 画面から呼べる操作はここだけ。
 * Phase 1 では金銭が動く操作を一切実装しない（購入・出品・決済・発送は存在しない）。
 */

async function audit(action: string, target: string, after: unknown): Promise<void> {
  await run('INSERT INTO audit_logs (actor, action, target, after_json, created_at) VALUES (?, ?, ?, ?, ?)', [
    'human',
    action,
    target,
    JSON.stringify(after),
    nowIso(),
  ]);
}

export async function importCsvAction(_prev: unknown, form: FormData) {
  await ensureReady();

  const supplierCode = String(form.get('supplier_code') ?? '').trim().toUpperCase();
  const file = form.get('file');
  const pasted = String(form.get('text') ?? '');
  const filename = form.get('filename') ? String(form.get('filename')) : undefined;

  let text = pasted;
  let name = filename;
  if (file instanceof File && file.size > 0) {
    text = await file.text();
    name = file.name;
  }

  if (!supplierCode) return { ok: false, message: '仕入先を選んでください。' };
  if (!text.trim()) return { ok: false, message: 'CSVファイルを選ぶか、CSVの中身を貼り付けてください。' };

  try {
    const stats = await runImport({ supplierCode, text, filename: name });
    const analyzed = await runAnalyze({});
    await audit('IMPORT_CSV', `${supplierCode}/${stats.importId}`, { stats, analyzed: analyzed.runId });
    revalidatePath('/');
    revalidatePath('/products');
    revalidatePath('/import');
    revalidatePath('/review');
    return { ok: true, message: '取込と分析が終わりました。', stats, analyzed };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '取込に失敗しました。' };
  }
}

export async function reanalyzeAction() {
  await ensureReady();
  const analyzed = await runAnalyze({ force: true });
  await audit('REANALYZE_ALL', 'all', { runId: analyzed.runId, analyzed: analyzed.analyzed });
  revalidatePath('/');
  revalidatePath('/products');
  return { ok: true, analyzed };
}

/** 市場ごとの相場CSVを取り込み、全市場×全市場のRouteを作りなおす。買わない・出品しない。 */
export async function importMarketDataAction(_prev: unknown, form: FormData) {
  await ensureReady();

  const file = form.get('file');
  const pasted = String(form.get('text') ?? '');
  let text = pasted;
  if (file instanceof File && file.size > 0) text = await file.text();
  if (!text.trim()) return { ok: false, message: 'CSVファイルを選ぶか、CSVの中身を貼り付けてください。' };

  try {
    const result = await importMarketData(text);
    if (!result.ok) return { ok: false, message: result.message, result };
    const routes = await runRoutes();
    await audit('IMPORT_MARKET_DATA', 'venue_market_prices', { inserted: result.inserted, runId: routes.runId });
    revalidatePath('/market');
    revalidatePath('/routes');
    revalidatePath('/matrix');
    revalidatePath('/capital');
    revalidatePath('/products');
    return { ok: true, message: `${result.message} Routeを作りなおしました。`, result, routes };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '取込に失敗しました。' };
  }
}

export async function rebuildRoutesAction() {
  await ensureReady();
  const routes = await runRoutes();
  await audit('REBUILD_ROUTES', 'all', { runId: routes.runId, generated: routes.routesGenerated });
  revalidatePath('/routes');
  revalidatePath('/matrix');
  revalidatePath('/capital');
  revalidatePath('/products');
  return { ok: true, routes };
}

export async function saveSettingsAction(_prev: unknown, form: FormData) {
  await ensureReady();
  const changed: Record<string, string> = {};
  for (const def of SETTING_DEFS) {
    const raw = form.get(def.key);
    if (raw === null) continue;
    const value = String(raw).trim();
    if (value === '') continue;
    const n = Number(value);
    if (Number.isNaN(n)) return { ok: false, message: `${def.label} には数値を入れてください。` };
    if (n < 0) return { ok: false, message: `${def.label} にマイナスは入れられません。` };
    await setSetting(def.key, def.value_type === 'int' ? String(Math.round(n)) : String(n));
    changed[def.key] = value;
  }
  invalidateSettingsCache();
  await audit('UPDATE_SETTINGS', 'settings', changed);

  // しきい値が変わると判定ルールの版も変わるので、全件やり直す
  const analyzed = await runAnalyze({ force: true });
  const routes = await runRoutes();
  revalidatePath('/');
  revalidatePath('/products');
  revalidatePath('/settings');
  revalidatePath('/routes');
  revalidatePath('/matrix');
  revalidatePath('/capital');
  return {
    ok: true,
    message: `設定を保存し、${analyzed.analyzed.toLocaleString()} 件を再判定、`
      + `${routes.routesGenerated.toLocaleString()} 件のRouteを作りなおしました。`,
  };
}

export async function saveFeeRuleAction(_prev: unknown, form: FormData) {
  await ensureReady();
  const id = Number(form.get('fee_rule_id'));
  if (!id) return { ok: false, message: '対象の手数料設定が見つかりません。' };

  const numField = (k: string, integer: boolean) => {
    const v = String(form.get(k) ?? '').trim();
    const n = Number(v);
    if (v === '' || Number.isNaN(n) || n < 0) return null;
    return integer ? Math.round(n) : n;
  };

  const marketplace = numField('marketplace_fee_rate', false);
  const payment = numField('payment_fee_rate', false);
  if (marketplace === null || payment === null) return { ok: false, message: '手数料率は0以上の数値で入れてください。' };
  if (marketplace + payment >= 1) return { ok: false, message: '販売手数料と決済手数料の合計が100%以上です。計算できません。' };

  const shipping = numField('shipping_cost', true) ?? 0;
  const auth = numField('authentication_fee', true) ?? 0;
  const packing = numField('packing_cost', true) ?? 0;
  const ret = numField('expected_return_cost', true) ?? 0;
  const other = numField('other_cost', true) ?? 0;
  const isEstimated = form.get('is_estimated') === 'on' ? 1 : 0;
  const note = String(form.get('source_note') ?? '').trim() || null;

  await run(
    `UPDATE fee_rules SET marketplace_fee_rate = ?, payment_fee_rate = ?, shipping_cost = ?,
       authentication_fee = ?, packing_cost = ?, expected_return_cost = ?, other_cost = ?,
       is_estimated = ?, source_note = ?, updated_at = ? WHERE id = ?`,
    [marketplace, payment, shipping, auth, packing, ret, other, isEstimated, note, nowIso(), id],
  );
  await audit('UPDATE_FEE_RULE', String(id), { marketplace, payment, shipping, auth, packing, ret, other, isEstimated });

  const analyzed = await runAnalyze({ force: true });
  revalidatePath('/');
  revalidatePath('/products');
  revalidatePath('/settings');
  return { ok: true, message: `手数料を保存し、${analyzed.analyzed.toLocaleString()} 件を再計算しました。` };
}

export async function resolveConditionAction(_prev: unknown, form: FormData) {
  await ensureReady();
  const supplierCode = String(form.get('supplier_code') ?? '').trim().toUpperCase();
  const rawLabel = String(form.get('raw_label') ?? '').trim();
  const rank = String(form.get('condition_rank') ?? '').trim() as ConditionRank;

  if (!supplierCode || !rawLabel) return { ok: false, message: '対象の状態表記が見つかりません。' };
  if (!CONDITION_RANKS.includes(rank)) return { ok: false, message: '状態ランクを選んでください。' };

  await run(
    `INSERT INTO supplier_condition_map (supplier_code, raw_label, condition_rank, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(supplier_code, raw_label) DO UPDATE SET condition_rank = excluded.condition_rank, updated_at = excluded.updated_at`,
    [supplierCode, rawLabel, rank, nowIso()],
  );

  // 同じ表記の商品をまとめて確定させる
  const res = await run(
    `UPDATE supplier_products SET condition_rank = ?, pipeline_state = 'DISCOVERED', needs_review_reason = NULL, updated_at = ?
      WHERE supplier_code = ? AND raw_condition = ? AND pipeline_state = 'MANUAL_REVIEW'`,
    [rank, nowIso(), supplierCode, rawLabel],
  );
  await audit('MAP_CONDITION', `${supplierCode}/${rawLabel}`, { rank, affected: Number(res.rowsAffected ?? 0) });

  const analyzed = await runAnalyze({});
  revalidatePath('/review');
  revalidatePath('/products');
  revalidatePath('/');
  return { ok: true, message: `「${rawLabel}」を ${rank} として登録し、${analyzed.analyzed.toLocaleString()} 件を判定しました。` };
}

export async function reviewDecisionAction(_prev: unknown, form: FormData) {
  await ensureReady();
  const id = Number(form.get('id'));
  const verdict = String(form.get('verdict') ?? '');
  if (!id) return { ok: false, message: '対象商品が見つかりません。' };

  if (verdict === 'REJECT') {
    await run(
      `UPDATE supplier_products SET pipeline_state = 'SKIPPED', decision = 'SKIP',
         skip_reason = 'HUMAN_REJECTED', needs_review_reason = NULL, updated_at = ? WHERE id = ?`,
      [nowIso(), id],
    );
    await audit('REVIEW_REJECT', String(id), { verdict });
    revalidatePath('/review');
    return { ok: true, message: 'この商品を対象外にしました。' };
  }

  if (verdict === 'APPROVE') {
    // 人間が「データは正しい」と確認した。判定はやり直すが、購入は一切行わない。
    await run(
      `UPDATE supplier_products SET pipeline_state = 'DISCOVERED', skip_reason = NULL,
         needs_review_reason = NULL, human_verified = 1, updated_at = ? WHERE id = ?`,
      [nowIso(), id],
    );
    await audit('REVIEW_APPROVE', String(id), { verdict });
    await runAnalyze({ onlyIds: [id] });
    revalidatePath('/review');
    revalidatePath('/products');
    return { ok: true, message: 'データを正しいものとして再判定しました。（購入はしていません）' };
  }

  return { ok: false, message: '不明な操作です。' };
}
