'use server';

import { revalidatePath } from 'next/cache';
import { nowIso, run } from '@/lib/db/client';
import { runImport } from '@/lib/pipeline/import';
import { runAnalyze } from '@/lib/pipeline/analyze';
import { runRoutes } from '@/lib/pipeline/routes';
import { importMarketData } from '@/lib/marketdata';
import { importListingObservations, recordWork, WORK_STEPS, type WorkStepCode } from '@/lib/observation';
import { recordMatchReview } from '@/lib/matchreview';
import { isMatchVerdict, MATCH_VERDICT_JA } from '@/lib/listing';
import { ensureReady } from '@/lib/queries';
import { invalidateSettingsCache, setSetting, SETTING_DEFS } from '@/lib/settings';
import { CONDITION_RANKS, type ConditionRank } from '@/lib/conditions';
import { isBuyPaymentMethod } from '@/lib/paymentmethods';
import { recordOpenOutcome, recordPageOpen, setUrlStatus } from '@/lib/purchaselink';
import { isPurchaseOutcome } from '@/lib/producturl';
import { recordSellCheck } from '@/lib/sellcheck';

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

/**
 * 実市場の出品を1件ずつ観測して取り込む（Phase 3.6・§3〜§9）。
 *
 * 相場CSVの取込とは別の入口にしてある。混ぜると
 * 「相場の話」と「この1件の出品がどうなったかの話」が同じ数字に見えてしまう。
 * Routeの作りなおしはここでは行わない（観測は相場テーブルを直接動かさないため）。
 */
export async function importObservationsAction(_prev: unknown, form: FormData) {
  await ensureReady();

  const file = form.get('file');
  const pasted = String(form.get('text') ?? '');
  let text = pasted;
  if (file instanceof File && file.size > 0) text = await file.text();
  if (!text.trim()) return { ok: false, message: 'CSVファイルを選ぶか、CSVの中身を貼り付けてください。' };

  try {
    const result = await importListingObservations(text);

    // 取込にかかった時間が書いてあれば、工程「取り込む」として記録する（§19）。
    const importSeconds = Number(form.get('import_seconds') ?? 0);
    if (Number.isFinite(importSeconds) && importSeconds > 0) {
      await recordWork('IMPORT', 'IMPORT', importSeconds, result.observations, '画面からの取込');
    }
    // 1行ずつ書いてあった入力秒数は「数字を書き写す」工程としてまとめる。
    if (result.entrySecondsRows > 0) {
      await recordWork('RECORD', 'RECORD', result.entrySecondsTotal, result.entrySecondsRows, 'CSVの入力秒数欄から');
    }

    if (!result.ok) return { ok: false, message: result.message, result };
    await audit('IMPORT_LISTING_OBSERVATIONS', 'listing_observations', {
      observations: result.observations, newListings: result.newListings, real: result.realRows,
    });
    revalidatePath('/validation');
    return { ok: true, message: result.message, result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '取込に失敗しました。' };
  }
}

/** 工程ごとの作業時間を手で記録する（§19 §20）。感覚ではなく秒で残す。 */
export async function recordWorkAction(_prev: unknown, form: FormData) {
  await ensureReady();
  const step = String(form.get('step') ?? '');
  if (!WORK_STEPS.some((s) => s.code === step)) {
    return { ok: false, message: '工程を選んでください。' };
  }
  const seconds = Number(form.get('seconds') ?? 0);
  const rows = Number(form.get('rows') ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { ok: false, message: 'かかった時間（秒）を入れてください。' };
  }
  // 同じ日に同じ工程を何度でも記録できるよう、batch_id には時刻まで入れる。
  await recordWork(
    `MANUAL-${nowIso()}`, step as WorkStepCode, seconds, rows,
    String(form.get('note') ?? '') || undefined,
  );
  await audit('RECORD_WORK_TIME', 'observation_work_log', { step, seconds, rows });
  revalidatePath('/validation');
  return { ok: true, message: `記録しました（${seconds}秒 / ${rows}件）。` };
}

/**
 * 同一商品判定の答え合わせを記録する（ユーザー指示11／12）。
 *
 * 機械が「同じ商品だ」と判定した組み合わせに、人が答えを付ける。
 * ここで付けた答えは機械の判定を**上書きしない**。別の欄に残す。
 * 上書きすると「機械が何回間違えたか」が数えられなくなり、精度を測れなくなる。
 *
 * 「違う商品だった（INCORRECT_MATCH）」は重大として扱い、
 * 1件でもあるうちは100件へ進まない。
 * 利益商品の見逃しは儲け損ねで済むが、取り違えは実際にお金を失うため。
 */
export async function recordMatchReviewAction(_prev: unknown, form: FormData) {
  await ensureReady();
  /*
   * 画面では「この出品」と「比べた市場」を1つの選択肢にまとめているので、
   * `出品キー::市場コード` の形で送られてくる。個別に送られた場合も受ける。
   */
  const pair = String(form.get('pair') ?? '');
  const [pairKey, pairVenue] = pair.includes('::') ? pair.split('::') : ['', ''];
  const listingKey = (String(form.get('listing_key') ?? '') || pairKey).trim();
  const venue = (String(form.get('matched_venue_code') ?? '') || pairVenue).trim();
  const verdict = String(form.get('verdict') ?? '');
  if (listingKey === '' || venue === '') {
    return { ok: false, message: '確認する出品と、比べた市場を選んでください。' };
  }
  if (!isMatchVerdict(verdict)) {
    return { ok: false, message: '確認結果を選んでください。' };
  }
  const note = String(form.get('note') ?? '').trim();
  // 「違う商品だった」を選んだのに何が違ったか書かれていないと、次に同じ間違いを防げない。
  if (verdict === 'INCORRECT_MATCH' && note === '') {
    return {
      ok: false,
      message: '「違う商品だった」を選んだときは、何が違ったか（色・サイズ・年式・国内版か等）を書いてください。'
        + 'ここが空だと、次に同じ取り違えを防げません。',
    };
  }
  try {
    await recordMatchReview(listingKey, venue, verdict, note || undefined);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '記録に失敗しました。' };
  }
  await audit('RECORD_MATCH_REVIEW', 'identity_match_reviews', { listingKey, venue, verdict });
  revalidatePath('/validation');
  return {
    ok: true,
    message: verdict === 'INCORRECT_MATCH'
      ? '取り違えとして記録しました。重大な間違いなので、原因が分かるまで100件へは進みません。'
      : `記録しました（${MATCH_VERDICT_JA[verdict]}）。`,
  };
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

    // 文字で選ぶ設定（支払方法など）。数値として検査しない。
    // 知らない言葉は保存しない。近そうな方に寄せたり、空欄で埋めたりしない。
    if (def.value_type === 'text') {
      if (def.key === 'DEFAULT_MERCARI_BUY_PAYMENT_METHOD' && !isBuyPaymentMethod(value)) {
        return { ok: false, message: `${def.label} に知らない支払方法が入っています。一覧から選んでください。` };
      }
      await setSetting(def.key, value);
      changed[def.key] = value;
      continue;
    }

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

/* ================================================================
 * Phase 3.9：「購入ページを開く」導線
 *
 * ここにある操作は、どれも商品を買わない。
 * 買うのは人が商品ページで行い、このシステムは「押した」「どうだった」を記録するだけ。
 * 商品ページへの通信も行わない。
 * ================================================================ */

/** 商品ページの状態（出品中／売り切れ／消えた／不明）を人が記録する。 */
export async function setUrlStatusAction(_prev: unknown, form: FormData) {
  await ensureReady();
  const listingKey = String(form.get('listing_key') ?? '').trim();
  const status = String(form.get('url_status') ?? '').trim();
  if (!listingKey) return { ok: false, message: '対象の出品が見つかりません。' };

  const r = await setUrlStatus(listingKey, status);
  if (r.ok) {
    await audit('SET_URL_STATUS', listingKey, { status });
    revalidatePath('/buy');
    revalidatePath('/validation');
  }
  return r;
}

/**
 * 人が「購入ページを開く」を押した記録を残す。
 *
 * 【この操作は購入ではない】
 * 実際にページを開くのは画面上の普通のリンク。ここは記録だけ。
 * 名前を openPurchasePageAction にしているのは、やっていることがそれだけだから。
 */
export async function openPurchasePageAction(_prev: unknown, form: FormData) {
  await ensureReady();
  const listingKey = String(form.get('listing_key') ?? '').trim();
  if (!listingKey) return { ok: false, message: '対象の出品が見つかりません。' };

  const r = await recordPageOpen(listingKey);
  if (r.ok) {
    await audit('OPENED_FOR_PURCHASE', listingKey, { openId: r.openId });
    revalidatePath('/buy');
  }
  return r;
}

/** 開いたあと、どうだったかを人が報告する（5択）。 */
export async function recordOpenOutcomeAction(_prev: unknown, form: FormData) {
  await ensureReady();
  const openId = Number(form.get('open_id'));
  const outcome = String(form.get('outcome') ?? '');
  const note = String(form.get('note') ?? '');
  if (!openId) return { ok: false, message: '対象の記録が見つかりません。' };
  if (!isPurchaseOutcome(outcome)) return { ok: false, message: '結果を選んでください。' };

  // 「違う商品だった」を選んだときは理由を必ず書かせる（Phase 3.8 と同じ扱い）。
  if (outcome === 'DIFFERENT_ITEM' && note.trim() === '') {
    return { ok: false, message: '「違う商品だった」を選んだときは、何が違ったのかを必ず書いてください。' };
  }

  const numOrNull = (k: string) => {
    const v = String(form.get(k) ?? '').trim();
    if (v === '') return null;
    const n = Number(v.replace(/[,\s円]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const r = await recordOpenOutcome({
    openId,
    outcome,
    note,
    actualPrice: numOrNull('actual_price'),
    actualShipping: numOrNull('actual_shipping'),
    purchasedAt: String(form.get('purchased_at') ?? '').trim() || null,
  });
  if (r.ok) {
    await audit('PURCHASE_PAGE_OUTCOME', String(openId), { outcome });
    revalidatePath('/buy');
    revalidatePath('/validation');
  }
  return r;
}

/**
 * 売れるかテストを1件記録する（Phase 3.9d）。
 *
 * 【ここでも通信はしない】
 * Keepa の画面を開くのも、数字を読むのも人。
 * このシステムがやるのは「受け取って、同じ物差しで判定して、消さずに積む」だけ。
 */
export async function recordSellCheckAction(_prev: unknown, form: FormData) {
  await ensureReady();

  const s = (k: string) => String(form.get(k) ?? '').trim();

  const r = await recordSellCheck({
    productKey: s('product_key'),
    productName: s('product_name'),
    venueCode: s('venue_code'),
    sourceTool: s('source_tool'),
    productUrl: s('product_url'),
    observedAt: s('observed_at'),
    windowDays: s('window_days'),
    rankDrops: s('rank_drops'),
    salesRank: s('sales_rank'),
    offerCount: s('offer_count'),
    avgPrice: s('avg_price'),
    currentPrice: s('current_price'),
    note: s('note'),
  });

  if (r.ok) {
    await audit('SELLABILITY_CHECK', s('product_key'), { verdict: r.judged?.verdict, duplicate: r.duplicate });
    revalidatePath('/sellability');
  }
  return r;
}
