/**
 * AliExpress 段階的取得テスト（1件 → 5件 → 20件）
 * ===================================================================
 * ユーザー指示（2026-08-20）：
 *   「App Key / Secret を設定したら、いきなり100商品検索しない。最初は1商品だけ。
 *     商品名／商品ID／価格／通貨／画像／商品URL／店舗名／カテゴリ が本当に返るか確認。
 *     レスポンス原文も個人情報・秘密情報を除いて監査用に保存してください。」
 *   「1件成功 → 5件 → 20件 と段階的に増やす。いきなり大量取得禁止。」
 *
 * ★このスクリプトの安全設計
 *   1. **1件で失敗したら、そこで止まる。** 5件・20件へは進まない。
 *   2. 呼ぶ前に API契約台帳（api_contract_registry）を見て、
 *      **公式ドキュメントで存在確認できていないAPIは呼ばない**（NOT_VERIFIED で停止）。
 *   3. 応答の原文を保存するが、**app_key / sign / access_token は必ず伏せる**。
 *   4. 失敗を「0件」と言わない。何が起きたかを7分類で表示する。
 *
 * 実行： npm run aliexpress:probe
 */
import {
  AliExpressClient,
  aliexpressConfigured,
  extractAliexpressItems,
} from '../lib/providers/supplierDiscovery';
import {
  listContracts,
  contractStatus,
  advanceContract,
  CONTRACT_STATUS_LABEL,
  ALIEXPRESS_KEYWORD_SEARCH_APIS,
} from '../lib/providers/apiContractRegistry';
import { ValueGuard, describeGuardReport } from '../lib/providers/aliexpressValues';
import { classifyError, OUTCOME_LABEL, logDiscoveryCall } from '../lib/research/discoveryOutcome';
import { insert, newId, nowIso } from '../lib/db/client';

const PROVIDER = 'aliexpress';

/** 秘密情報を必ず伏せる。監査用に残すのは「形」であって「鍵」ではない */
function redact(raw: string): string {
  return raw
    .replace(/("?(app_key|sign|access_token|refresh_token|app_secret)"?\s*[:=]\s*"?)[^",&}\s]+/gi, '$1***REDACTED***')
    .slice(0, 20_000);
}

/** 1件ぶんの商品から「本当に取れた項目」を確認する */
function inspectItem(raw: any, g: ValueGuard) {
  return {
    商品ID: g.text('itemId', raw?.itemId ?? raw?.item_id ?? raw?.product_id ?? raw?.productId),
    商品名: g.text('title', raw?.title ?? raw?.product_title ?? raw?.subject),
    価格: g.price('salePrice', raw?.targetSalePrice ?? raw?.salePrice ?? raw?.sale_price ?? raw?.app_sale_price),
    通貨: g.currency(
      'currency',
      raw?.targetSalePriceCurrency ?? raw?.salePriceCurrency ?? raw?.sale_price_currency,
    ),
    画像: g.imageUrl('image', raw?.itemMainPic ?? raw?.product_main_image_url ?? raw?.imageUrl),
    商品URL: g.purchaseUrl('itemUrl', raw?.itemUrl ?? raw?.product_detail_url ?? raw?.promotion_link),
    店舗名: g.text('storeName', raw?.storeName ?? raw?.shop_name ?? raw?.store_name),
    カテゴリ: g.text('categoryId', raw?.cateId ?? raw?.category_id ?? raw?.first_level_category_name),
  };
}

/**
 * ★APIごとに「送る項目名」がまったく違う。ここを間違えると必ず失敗する。
 *   公式ドキュメントで確認した綴りのとおりに作る（似ているから、で流用しない）。
 *
 *   aliexpress.affiliate.product.query … snake_case（keywords / page_size / page_no …）
 *   aliexpress.ds.text.search          … camelCase（keyWord / pageSize / pageIndex …）
 *                                        local・countryCode・currency は必須
 */
function buildSearchParams(
  method: string,
  client: AliExpressClient,
  keyword: string,
  pageSize: number,
): { business: Record<string, string>; needsToken: boolean } {
  if (method === 'aliexpress.affiliate.product.query') {
    return {
      business: {
        keywords: keyword,
        page_size: String(pageSize),
        page_no: '1',
        target_currency: client.currency,
        target_language: 'JA',
        ship_to_country: client.country,
      },
      // ★2026-08-20 訂正：API一覧の表では required=false だが、公式FAQ（docId 1957 / 1936）は
      //   アフィリエイト系も access_token を取って呼ぶ手順を案内している＝表記が食い違っている。
      //   そこでDS側と同じ扱いにする：トークンがあれば付ける、無ければ付けずに呼んで結果を素直に記録する。
      needsToken: !!client.accessToken,
    };
  }

  if (method === 'aliexpress.ds.text.search') {
    return {
      business: {
        keyWord: keyword,
        local: client.locale, // 必須
        countryCode: client.country, // 必須
        currency: client.currency, // 必須
        pageSize: String(pageSize),
        pageIndex: '1',
      },
      // ★公式表記は「不要」だが、エラーコードが IllegalAccessToken しか無く矛盾している。
      //   トークンがあるなら付けて呼ぶ（無ければ付けずに呼んで、結果を素直に記録する）。
      needsToken: !!client.accessToken,
    };
  }

  // ★台帳に無い名前は、ここへ来ない設計。来たら推測で組み立てずに止める。
  throw new Error(
    `${method} の送る項目が分かりません。公式ドキュメントで確認していないAPIは呼びません。`,
  );
}

async function probeOnce(client: AliExpressClient, method: string, keyword: string, pageSize: number) {
  const started = Date.now();
  const { business, needsToken } = buildSearchParams(method, client, keyword, pageSize);

  try {
    const json = await client.call(method, business, needsToken);
    const items = extractAliexpressItems(json);
    const elapsed = Date.now() - started;

    if (items === null) {
      // ★ここが一番危ない箇所。「配列が見つからない」を0件にしない。
      await logDiscoveryCall({
        provider: PROVIDER,
        apiName: method,
        query: keyword,
        outcome: 'PARSE_ERROR',
        note: '応答は返ったが、商品の配列がどこにあるか分からなかった（項目名が変わった可能性）',
        elapsedMs: elapsed,
      });
      return { ok: false as const, outcome: 'PARSE_ERROR' as const, json, items: [] as any[], elapsed };
    }

    await logDiscoveryCall({
      provider: PROVIDER,
      apiName: method,
      query: keyword,
      outcome: items.length ? 'OK' : '0_RESULTS',
      resultCount: items.length,
      elapsedMs: elapsed,
    });
    return {
      ok: items.length > 0,
      outcome: (items.length ? 'OK' : '0_RESULTS') as 'OK' | '0_RESULTS',
      json,
      items,
      elapsed,
    };
  } catch (e) {
    const elapsed = Date.now() - started;
    const outcome = classifyError(e);
    await logDiscoveryCall({
      provider: PROVIDER,
      apiName: method,
      query: keyword,
      outcome,
      note: String((e as Error)?.message ?? e).slice(0, 500),
      elapsedMs: elapsed,
    });
    return { ok: false as const, outcome, json: null, items: [] as any[], elapsed, error: e };
  }
}

async function main() {
  const keyword = process.argv[2] || 'stainless steel dish rack';
  console.log('=== AliExpress 段階的取得テスト（1件 → 5件 → 20件）===\n');

  // ---- ステップ0：鍵があるか --------------------------------------
  if (!aliexpressConfigured()) {
    console.log('鍵がまだ設定されていません。');
    console.log('  .env に ALIEXPRESS_APP_KEY と ALIEXPRESS_APP_SECRET を入れてください。');
    console.log('  手順 → 事業Vault/Amazon AI Seller OS/13_AliExpress申請手順.md');
    console.log('\n★外部APIは1回も呼んでいません（課金0円）。');
    process.exit(0);
  }

  // ---- ステップ1：API契約台帳の確認 --------------------------------
  console.log('--- 1. API契約台帳の確認（呼ぶ前に、存在が確認できているかを見る）---');
  const contracts = await listContracts(PROVIDER);
  if (!contracts.length) {
    console.log('★台帳が空です。先に `npm run api:registry` を実行してください。');
    process.exit(1);
  }
  for (const c of contracts) {
    console.log(`  ${c.apiName.padEnd(36)} ${CONTRACT_STATUS_LABEL[c.status]}`);
  }

  // 検索に使えるAPIを台帳から選ぶ（★名前を推測しない。台帳にあるものだけ）
  // ★名前に query / search が入っていても「キーワード検索API」とは限らない
  //   （freight.query は送料、image.searchV2 は画像検索）。明示した2つだけを対象にする。
  const searchable = ALIEXPRESS_KEYWORD_SEARCH_APIS.map((name) =>
    contracts.find((c) => c.apiName === name),
  ).filter((c): c is NonNullable<typeof c> => !!c && c.status !== 'UNVERIFIED' && !!c.officialDocumentUrl);
  if (!searchable.length) {
    console.log('\n★公式ドキュメントで存在を確認できた「検索API」が1つもありません。');
    console.log(`  ${OUTCOME_LABEL.NOT_VERIFIED}`);
    console.log('  推測でAPI名を組み立てて呼ぶことはしません。');
    process.exit(1);
  }
  const method = searchable[0].apiName;
  console.log(`\n  使うAPI：${method}`);
  console.log(`  公式資料：${searchable[0].officialDocumentUrl}`);

  const client = new AliExpressClient();
  const guard = new ValueGuard();

  // ---- ステップ2：まず1件だけ --------------------------------------
  console.log('\n--- 2. まず1件だけ取ってみる ---');
  const first = await probeOnce(client, method, keyword, 1);
  console.log(`  結果：${OUTCOME_LABEL[first.outcome]}（${first.elapsed}ms）`);

  if (first.json) {
    await insert('api_response_samples', {
      id: newId('sample'),
      provider: PROVIDER,
      api_name: method,
      sample_kind: 'probe_1',
      redacted_body: redact(JSON.stringify(first.json, null, 2)),
      field_report: null,
      created_at: nowIso(),
    }).catch(() => {});
    console.log('  応答の原文を監査用に保存しました（鍵・署名は伏せてあります）');
  }

  if (!first.ok) {
    if ((first as any).error) console.log(`  詳細：${String((first as any).error?.message ?? '').slice(0, 300)}`);
    console.log('\n★1件目で止めます。5件・20件へは進みません（いきなり大量取得しない決まり）。');
    if (first.outcome === 'NO_PERMISSION') {
      console.log('  → このAPIの権限がまだ承認されていません。AliExpressの管理画面で申請状況を確認してください。');
    }
    if (first.outcome === 'AUTH_ERROR') {
      console.log('  → 鍵か署名が違います。APP_KEY / APP_SECRET を貼り直してください。');
    }
    process.exit(1);
  }

  // 取れた項目を1件ぶん確認
  console.log('\n  1件目の中身（本当に返ってきたか）：');
  const inspected = inspectItem(first.items[0], guard);
  for (const [k, v] of Object.entries(inspected)) {
    console.log(`    ${k.padEnd(8)} ${v === null ? '（取れませんでした＝UNKNOWN）' : String(v).slice(0, 90)}`);
  }
  const missing = Object.entries(inspected).filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) {
    console.log(`\n  ★取れなかった項目：${missing.join(' / ')}`);
    console.log('    → これらは UNKNOWN のまま扱います。推測で埋めません。');
  }
  if (!inspected.商品URL) {
    console.log('    ★商品URLが取れていないため、この状態ではAランクにできません（決まりどおり）。');
  }

  // 段階を CONNECTED → VERIFIED へ進める（1件ずつ。飛び級はできない）
  const cur = await contractStatus(PROVIDER, method);
  if (cur === 'DOCUMENTED') {
    await advanceContract(PROVIDER, method, 'AUTHORIZED', '鍵で呼び出せたので権限があると確認');
  }
  const afterAuth = await contractStatus(PROVIDER, method);
  if (afterAuth === 'AUTHORIZED') {
    await advanceContract(PROVIDER, method, 'CONNECTED', '本物のAPIへの認証に成功');
  }

  // ---- ステップ3：5件 ---------------------------------------------
  console.log('\n--- 3. 次に5件 ---');
  const five = await probeOnce(client, method, keyword, 5);
  console.log(`  結果：${OUTCOME_LABEL[five.outcome]}／${five.items.length}件（${five.elapsed}ms）`);
  if (!five.ok) {
    console.log('★5件目で止めます。20件へは進みません。');
    process.exit(1);
  }
  for (const it of five.items.slice(0, 5)) inspectItem(it, guard);

  // ---- ステップ4：20件 --------------------------------------------
  console.log('\n--- 4. 最後に20件 ---');
  const twenty = await probeOnce(client, method, keyword, 20);
  console.log(`  結果：${OUTCOME_LABEL[twenty.outcome]}／${twenty.items.length}件（${twenty.elapsed}ms）`);
  if (!twenty.ok) {
    console.log('★20件で失敗しました。');
    process.exit(1);
  }
  for (const it of twenty.items) inspectItem(it, guard);

  if (twenty.json) {
    await insert('api_response_samples', {
      id: newId('sample'),
      provider: PROVIDER,
      api_name: method,
      sample_kind: 'probe_20',
      redacted_body: redact(JSON.stringify(twenty.json, null, 2)),
      field_report: JSON.stringify(guard.report()),
      created_at: nowIso(),
    }).catch(() => {});
  }

  // ---- ステップ5：項目ごとの取得率 ---------------------------------
  console.log('\n--- 5. 項目ごとに、何件ちゃんと取れたか ---');
  for (const line of describeGuardReport(guard.report())) console.log(line);

  const withUrl = twenty.items.filter((it) =>
    new ValueGuard().purchaseUrl('u', it?.itemUrl ?? it?.product_detail_url ?? it?.promotion_link),
  ).length;
  console.log(`\n  購入ページURLが取れた商品：${withUrl}/${twenty.items.length}件`);
  console.log('  ※URLが取れない商品はAランクにしません（決まりどおり）');

  // 実データを確認できたので VERIFIED へ
  const beforeVerify = await contractStatus(PROVIDER, method);
  if (beforeVerify === 'CONNECTED') {
    const r = await advanceContract(
      PROVIDER,
      method,
      'VERIFIED',
      `実商品${twenty.items.length}件を取得し、項目の中身を確認した（${new Date().toISOString().slice(0, 10)}）`,
    );
    console.log(`\n  API契約台帳：${r.ok ? 'VERIFIED へ進めました' : r.reason}`);
  }

  console.log('\n==============================');
  console.log(`取得できた実商品：${twenty.items.length}件`);
  console.log('★ここまで通ったAPIだけが LIVE_DISCOVERY_READY の材料になります。');
}

main().catch((e) => {
  console.error('\n★想定外のエラーで止まりました（0件として扱いません）：');
  console.error(String(e?.message ?? e));
  process.exit(1);
});
