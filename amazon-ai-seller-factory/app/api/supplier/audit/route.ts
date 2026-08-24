import { NextResponse } from 'next/server';
import { getSupplierProviders, supplierProviderStatus } from '@/lib/providers/supplier';
import { SUPPLIER_REQUIRED_FIELDS, type SupplierListing } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 仕入先LIVE監査。
 *
 * ★ここでは利益判定を一切しません。Amazon検索もKeepaも呼びません。
 *   見るのは「この仕入先データは本物か」だけ：
 *     1. 商品が本当に取れたか
 *     2. 商品URLが開けるか
 *     3. 価格が入っていて、値としておかしくないか
 *     4. 通貨が正しいか
 *     5. 画像URLがあるか（開けるか）
 *     6. 最小ロット（MOQ）が入っているか
 *     7. 更新日時が入っているか
 *
 *   ★取れていない項目は UNKNOWN のまま報告します。推測で埋めません。
 */

/** 日本の物販で普通に扱う通貨だけを「正しい」と見なす。 */
const KNOWN_CURRENCIES = ['JPY', 'USD', 'CNY', 'EUR', 'GBP', 'KRW', 'HKD', 'TWD', 'SGD', 'AUD'];

type UrlCheck = { ok: boolean; status: number | null; note: string };

/** URLが本当に開けるか見る。中身は読まない（HEAD→ダメならGETの先頭だけ）。 */
async function checkUrl(url: string, timeoutMs = 12000): Promise<UrlCheck> {
  const attempt = async (method: 'HEAD' | 'GET'): Promise<UrlCheck> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; AmazonAISellerOS-LinkCheck/1.0)' },
      });
      // GETの時は本文を読まずに切る（相手のサーバーに余計な負荷をかけない）
      try {
        await res.body?.cancel();
      } catch {
        /* noop */
      }
      return {
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        note: res.status >= 200 && res.status < 400 ? '開けました' : `開けません（${res.status}）`,
      };
    } catch (e: any) {
      return { ok: false, status: null, note: e?.name === 'AbortError' ? '時間切れ' : `つながりません（${e?.message || e}）` };
    } finally {
      clearTimeout(timer);
    }
  };

  const head = await attempt('HEAD');
  if (head.ok) return head;
  // HEADを拒否するサイトが多いのでGETで念のため確認する
  const get = await attempt('GET');
  return get.ok ? get : head.status != null ? head : get;
}

function auditOne(l: SupplierListing) {
  const missing = new Set(l.unknownFields ?? []);
  const problems: string[] = [];

  // 3. 価格（仕入先の通貨のままの値。円換算は別に持つ）
  const price = Number(l.unitPriceOriginal);
  const priceJpy = Number(l.unitPriceJpy);
  const priceOk = Number.isFinite(price) && price > 0 && Number.isFinite(priceJpy) && priceJpy > 0;
  if (!priceOk) problems.push('価格が取れていません');
  else if (priceJpy > 10_000_000) problems.push('価格が異常に大きいです（桁を確認してください）');

  // 4. 通貨
  const cur = String(l.currency || '').toUpperCase();
  const currencyOk = KNOWN_CURRENCIES.includes(cur);
  if (!currencyOk) problems.push(`通貨が正しくありません（${l.currency || '空'}）`);

  // 6. MOQ
  const moqOk = !missing.has('minimum_order_quantity') && Number.isFinite(Number(l.moq)) && Number(l.moq) > 0;
  if (!moqOk) problems.push('最小ロット（MOQ）が取れていません');

  // 7. 更新日時
  const updatedOk = !!l.updatedAt;
  if (!updatedOk) problems.push('仕入先データの更新日時が取れていません');

  const imageUrl = l.imageUrls?.[0] ?? null;
  if (!imageUrl) problems.push('商品画像URLが取れていません');
  if (!l.url) problems.push('商品URLが取れていません（この商品はAランクにできません）');

  return {
    supplier: l.supplier,
    source: l.source,
    externalId: l.externalId,
    title: l.title,
    url: l.url ?? null,
    imageUrl,
    price: priceOk ? price : null,
    priceJpy: priceOk ? Math.round(priceJpy) : null,
    currency: cur || null,
    moq: moqOk ? Number(l.moq) : null,
    stock: l.stock ?? null,
    updatedAt: l.updatedAt ?? null,
    dataQuality: l.dataQuality,
    dataQualityNote: l.dataQualityNote ?? null,
    unknownFields: [...missing],
    filledFields: SUPPLIER_REQUIRED_FIELDS.filter((f) => !missing.has(f)).length,
    requiredFields: SUPPLIER_REQUIRED_FIELDS.length,
    priceOk,
    currencyOk,
    moqOk,
    updatedOk,
    problems,
    // URLチェックは後で入れる
    urlCheck: null as UrlCheck | null,
    imageCheck: null as UrlCheck | null,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}) as any);
    const limit = Math.min(100, Math.max(1, Number(body?.limit) || 20));
    const keyword = typeof body?.keyword === 'string' && body.keyword.trim() ? body.keyword.trim() : null;
    // URLを実際に開いて確かめるか（既定：する）
    const checkLinks = body?.checkLinks === false ? false : true;

    const status = supplierProviderStatus();
    const providers = getSupplierProviders().filter((p) => p.name !== 'sample');

    if (providers.length === 0) {
      return NextResponse.json({
        ok: false,
        verdict: 'NO_LIVE_SUPPLIER',
        message:
          '本物の仕入先が1つもつながっていません。Googleスプレッドシートを設定するか、AliExpressの鍵を入れてください。',
        providers: status,
        items: [],
      });
    }

    // ---- 実際に取ってくる（利益判定はしない）----
    const items: ReturnType<typeof auditOne>[] = [];
    const providerNotes: { name: string; got: number; error: string | null }[] = [];

    for (const p of providers) {
      if (items.length >= limit) break;
      try {
        const got = await p.fetchListings({ limit: limit - items.length, keyword });
        providerNotes.push({ name: p.name, got: got.length, error: null });
        for (const l of got) {
          items.push(auditOne(l));
          if (items.length >= limit) break;
        }
      } catch (e: any) {
        // ★失敗を「0件」で黙って隠さない。必ず理由を出す。
        providerNotes.push({ name: p.name, got: 0, error: e?.message || String(e) });
      }
    }

    // ---- URLと画像が本当に開けるか（同時に4件ずつ）----
    if (checkLinks) {
      const queue = [...items];
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (;;) {
          const it = queue.shift();
          if (!it) return;
          if (it.url) {
            it.urlCheck = await checkUrl(it.url);
            if (!it.urlCheck.ok) it.problems.push(`商品URL：${it.urlCheck.note}`);
          }
          if (it.imageUrl) {
            it.imageCheck = await checkUrl(it.imageUrl);
            if (!it.imageCheck.ok) it.problems.push(`画像URL：${it.imageCheck.note}`);
          }
        }
      });
      await Promise.all(workers);
    }

    // ---- 集計 ----
    const tally = { LIVE: 0, ESTIMATED: 0, UNKNOWN: 0, MOCK: 0 } as Record<string, number>;
    for (const it of items) tally[it.dataQuality] = (tally[it.dataQuality] ?? 0) + 1;

    const clean = items.filter((it) => it.problems.length === 0).length;
    const withUrlOk = items.filter((it) => it.urlCheck?.ok).length;
    const withImageOk = items.filter((it) => it.imageCheck?.ok).length;
    const anyMock = tally.MOCK > 0;

    // 合格の条件（★甘くしない）
    //   ・1件以上取れている
    //   ・サンプル（MOCK）が混ざっていない
    //   ・7割以上の商品でURLが実際に開ける
    //   ・価格と通貨は全件正しい
    const priceAllOk = items.length > 0 && items.every((it) => it.priceOk && it.currencyOk);
    const urlRate = items.length > 0 ? withUrlOk / items.length : 0;
    const passed = items.length > 0 && !anyMock && priceAllOk && (!checkLinks || urlRate >= 0.7);

    const blockers: string[] = [];
    if (items.length === 0) blockers.push('仕入先から1件も取れていません');
    if (anyMock) blockers.push('サンプル（架空）データが混ざっています');
    if (items.length > 0 && !priceAllOk) blockers.push('価格または通貨が正しくない商品があります');
    if (checkLinks && items.length > 0 && urlRate < 0.7) {
      blockers.push(`商品URLが開けた割合が ${Math.round(urlRate * 100)}%（7割未満）です`);
    }

    return NextResponse.json({
      ok: true,
      verdict: passed ? 'SUPPLIER_LIVE_PASS' : 'SUPPLIER_LIVE_FAIL',
      passed,
      checkedAt: new Date().toISOString(),
      summary: {
        fetched: items.length,
        requested: limit,
        clean,
        withUrlOk,
        withImageOk,
        tally,
        urlRatePct: Math.round(urlRate * 100),
        linksChecked: checkLinks,
      },
      blockers,
      providers: status,
      providerNotes,
      items,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
