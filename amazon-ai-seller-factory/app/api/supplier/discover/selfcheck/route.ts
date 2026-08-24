import { NextResponse } from 'next/server';
import { prefilterDiscovered, selectForAmazonCheck, amazonMatchLikelihood } from '@/lib/research/discoveryFilter';
import type { SupplierListing } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * 自動探索の「無料の安全ルール」が本当に効いているかを、
 * 外部APIを1回も叩かずに確認する。
 *
 * ★これはテストデータであり、仕入判断には一切使われない。
 *   DBにも保存しない。実行しても課金は1円も発生しない。
 *
 * 見るべきこと：
 *   ・危ない商品（キャラクター物・電波法・食品）が Keepa を使う前に落ちているか
 *   ・URLや画像や価格が欠けた商品が落ちているか
 *   ・上限件数を超えた分が「捨てた」ではなく「次回に回した」になっているか
 */

function sample(init: Partial<SupplierListing> & { externalId: string; title: string }): SupplierListing {
  return {
    externalId: init.externalId,
    source: 'selfcheck',
    channel: 'other_overseas',
    supplier: init.supplier ?? 'テスト仕入先',
    title: init.title,
    brand: init.brand ?? null,
    modelNumber: init.modelNumber ?? null,
    gtin: init.gtin ?? null,
    currency: 'JPY',
    unitPriceOriginal: init.unitPriceJpy ?? 500,
    unitPriceJpy: init.unitPriceJpy ?? 500,
    moq: 1,
    domesticShippingJpy: 0,
    intlShippingPerUnitJpy: 0,
    dutyRate: 0,
    inspectionFeeJpy: 0,
    otherImportFeeJpy: 0,
    leadTimeDays: 14,
    imageUrls: init.imageUrls ?? ['https://example.test/a.jpg'],
    imageHash: null,
    attributes: { sizeCm: null, weightG: null, color: null, material: null, capacity: null, setCount: 1, spec: null },
    url: init.url === undefined ? 'https://example.test/item' : init.url,
    note: null,
    categoryHint: null,
    supplierRating: null,
    supplierOrderCount: null,
    depth: 0,
    stock: null,
    updatedAt: null,
    dataQuality: init.dataQuality ?? 'ESTIMATED',
    unknownFields: [],
  } as SupplierListing;
}

export async function GET() {
  const cases: { listing: SupplierListing; expect: string }[] = [
    { listing: sample({ externalId: 'ok-1', title: 'ステンレス 水切りラック 2段', gtin: '4901234567894' }), expect: '通す' },
    { listing: sample({ externalId: 'ok-2', title: 'シリコン 製氷皿 ふた付き 24個', modelNumber: 'SIL-24A' }), expect: '通す' },
    { listing: sample({ externalId: 'ip-1', title: 'ディズニー ミッキー 収納ケース' }), expect: 'HIGH_IP_RISK' },
    { listing: sample({ externalId: 'reg-1', title: 'Bluetooth ワイヤレス イヤホン' }), expect: 'REGULATION_RISK' },
    { listing: sample({ externalId: 'reg-2', title: 'モバイルバッテリー 10000mAh' }), expect: 'REGULATION_RISK' },
    { listing: sample({ externalId: 'nourl-1', title: '普通のタオル 3枚組', url: null }), expect: 'NO_PRODUCT_URL' },
    { listing: sample({ externalId: 'noimg-1', title: '普通のまな板', imageUrls: [] }), expect: 'NO_IMAGE' },
    { listing: sample({ externalId: 'cost-1', title: '値段不明の商品', unitPriceJpy: 0 }), expect: 'UNKNOWN_COST' },
    { listing: sample({ externalId: 'mock-1', title: 'サンプル商品', dataQuality: 'MOCK' }), expect: 'MOCK_DATA' },
    { listing: sample({ externalId: 'src-1', title: '転売用', supplier: 'Amazon マーケットプレイス' }), expect: 'FORBIDDEN_SOURCE' },
    { listing: sample({ externalId: 'ok-1', title: '重複した商品' }), expect: 'DUPLICATE' },
  ];

  const { passed, rejected } = prefilterDiscovered(cases.map((c) => c.listing), { mode: 'STANDARD' });

  // ★重複ケースだけは「同じ externalId をわざと2回渡す」ので、
  //   externalId ではなく商品名で結果を引く（1件目は通り、2件目が DUPLICATE になる）。
  const rejectedByTitle = new Map(rejected.map((r) => [r.listing.title, r.reason]));
  const passedTitles = new Set(passed.map((l) => l.title));

  const results = cases.map((c, i) => {
    const title = c.listing.title;
    const got = passedTitles.has(title) ? '通す' : (rejectedByTitle.get(title) ?? '（結果なし）');
    return { no: i + 1, title, expected: c.expect, got: String(got), ok: String(got) === c.expect };
  });

  // 上限の絞り込み：3件だけ通す設定にすると、残りは「捨てた」ではなく「次回に回した」
  const sel = selectForAmazonCheck(passed, 3);
  const ranked = passed
    .map((l) => ({ title: l.title, likelihood: amazonMatchLikelihood(l) }))
    .sort((a, b) => b.likelihood - a.likelihood);

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({
    ok: allOk,
    message: allOk
      ? '自動探索の無料ルールは、想定どおりに危ない商品と欠けた商品を落としています（外部APIは1回も使っていません）'
      : '★想定と違う結果があります。下の ok:false の行を確認してください',
    prefilter: results,
    passedCount: passed.length,
    rejectedCount: rejected.length,
    ranking: ranked,
    limitCheck: {
      note: '上限3件にした場合。deferred は「捨てた」ではなく「次回に回した」',
      selected: sel.selected.map((l) => l.title),
      deferred: sel.deferred.map((l) => l.title),
    },
  });
}
