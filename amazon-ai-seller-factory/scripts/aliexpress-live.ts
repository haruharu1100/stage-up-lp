/**
 * 鍵を入れた直後に実行する固定テスト（STEP1 → STEP5 → 5件 → 20件）
 * ===================================================================
 * ユーザー指示（2026-08-20・待機フェーズ）：
 *   「『鍵を入れた直後に何を実行するか』を自動テスト手順として固定してください。」
 *   「絶対にいきなり20件取得しないでください。」
 *   「HTTP 200 だっただけで VERIFIED にしない。」
 *
 * 実行：
 *   npm run aliexpress:live                       … STEP1→STEP2 まで走り、商品1件が取れた時点で必ず止まる
 *   npm run aliexpress:live:continue              … ChatGPT監査が済んだあと、STEP3以降へ進める
 *   npm run aliexpress:live -- --plan             … 手順の確認だけ（外部APIを1回も呼ばない）
 *   npm run aliexpress:live -- --image <URL>      … STEP5（画像検索）に使うAmazon商品画像
 *   npm run aliexpress:live -- --keyword "..."    … 検索に使う言葉
 *
 * ★安全設計
 *   1. STEPは上から順にしか進まない。1つ落ちたらそこで止める。
 *   2. 「HTTP 200」だけでは合格にしない。中身のエラー（code / error / msg）も見る。
 *   3. 失敗を「0件」と言わない。7分類のどれかで必ず理由を出す。
 *   4. 応答の原文を監査用に残すが、鍵・署名・トークンは必ず伏せる。
 *   5. 20件へ進む前に8項目の関門を通す。1つでも欠けたら20件は取らない。
 *   6. ★STEP2で本物の商品を1件取れた瞬間に必ず止まる（2026-08-22 追加）。
 *      人がChatGPTで監査するまで、STEP3以降は1回も呼ばない。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AliExpressClient,
  AliExpressDiscoveryProvider,
  aliexpressConfigured,
  extractAliexpressItems,
  takeSupplierApiCallCount,
} from '../lib/providers/supplierDiscovery';
import {
  listContracts,
  contractStatus,
  advanceContract,
  CONTRACT_STATUS_LABEL,
  type ContractStatus,
} from '../lib/providers/apiContractRegistry';
import {
  ValueGuard,
  pickRaw,
  collectRawFields,
  rawDiffers,
  describeGuardReport,
  describePriceAnomalies,
  findAllSameRejections,
  VALUE_REJECT_LABEL,
} from '../lib/providers/aliexpressValues';
import {
  traceField,
  renderFieldTrace,
  traceProblems,
  isFullyCaptured,
  FIELD_STATE_LABEL,
  type FieldTrace,
} from '../lib/providers/fieldTrace';
import { classifyError, OUTCOME_LABEL, logDiscoveryCall, type DiscoveryOutcome } from '../lib/research/discoveryOutcome';
import {
  LIVE_TEST_STEPS,
  describePlan,
  canVerify,
  describeVerifyGaps,
  describeTwentyGate,
  canGoTwenty,
  AUDIT_PAUSE_FLAG,
  FIRST_PRODUCT_AUDIT_FIELDS,
  FIRST_PRODUCT_RAW_AUDIT_FIELDS,
  FIRST_PRODUCT_TRACE_AUDIT_FIELDS,
  type VerifyChecklist,
  type TwentyGate,
} from '../lib/research/liveTestPlan';
import { tokenState, recordTokenMeta, assertTokenUsable } from '../lib/providers/aliexpressToken';
import { scrubKnownSecrets, containsRawSecret, describeSecret } from '../lib/providers/secretMask';
import { keepaTokensConsumed, resetKeepaTokenMeter } from '../lib/providers/keepaTokens';
import { insert, newId, nowIso, migrate } from '../lib/db/client';

const PROVIDER = 'aliexpress';

/** .env の生の鍵。★画面にもログにもDBにも、この配列の中身をそのまま出さない */
const RAW_SECRETS = [
  process.env.ALIEXPRESS_APP_SECRET,
  process.env.ALIEXPRESS_ACCESS_TOKEN,
  process.env.ALIEXPRESS_REFRESH_TOKEN,
  process.env.ALIEXPRESS_APP_KEY,
];

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const HAS = (name: string) => process.argv.includes(`--${name}`);

/** 保存する前に、鍵が残っていないか必ず確かめる */
function safeBody(json: unknown): string {
  const text = scrubKnownSecrets(JSON.stringify(json ?? null, null, 2), RAW_SECRETS).slice(0, 20_000);
  if (containsRawSecret(text, RAW_SECRETS)) {
    // ★ここへ来たら、伏せ漏れがあるということ。中身は捨てて事実だけ残す。
    return '（★秘密情報が含まれていたため、本文は保存しませんでした）';
  }
  return text;
}

/**
 * ★RAW値を保存・表示する前の、秘密情報の最終確認だけを行う。
 *   ここでは値そのものを一切直さない（丸め・換算・大文字化・カンマ除去をしない）。
 *   万一 鍵が混ざっていたら、加工せず「丸ごと捨てて事実だけ残す」。
 *   ＝「加工して残す」より「残さない」を選ぶ、という意味。
 */
function safeRaw(text: string | null): string | null {
  if (text === null) return null;
  if (containsRawSecret(text, RAW_SECRETS)) {
    return '（★秘密情報が含まれていたため、生値は保存しませんでした）';
  }
  return text;
}

/**
 * ★価格・通貨をどの項目名から取るか。
 *   RAW値の取得と、システム解釈（ValueGuard）とで、必ずこの同じ順番を使う。
 *   別々に書くと、いつか片方だけ直されて「RAWと解釈後が別の項目を指す」状態になる。
 *   そうなると並べて見せる意味が消える。
 */
/**
 * ★検証結果を Obsidian へ保存する（2026-08-25 ユーザー指示・確定）。
 *   「検証結果は必ずObsidianへ保存し、次回AIが先に読む」
 *
 *   保存先は 事業Vault/Amazon AI Seller OS/検証結果/。
 *   そのフォルダが無い環境（別PC・CI）では data/live-audit/ に落とす。
 *   ★どちらにも書けなかった場合は「保存できなかった」と表示する。黙って成功にしない。
 */
function saveToObsidian(fileName: string, body: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), '..', '事業Vault', 'Amazon AI Seller OS', '検証結果'),
    path.resolve(process.cwd(), 'data', 'live-audit'),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const full = path.join(dir, fileName);
      fs.writeFileSync(full, body, 'utf8');
      return full;
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

/** 3段トレースを Markdown の表にする（Obsidianで開いてそのまま読めるように） */
function traceMarkdown(title: string, traces: FieldTrace[]): string[] {
  const out = [`### ${title}`, '', '| 項目 | ① 元レスポンス（無加工） | 状態 | 変換ルール | ② 正規化後 | ③ 画面表示値 |', '|---|---|---|---|---|---|'];
  for (const t of traces) {
    const cell = (s: string | null) => (s ?? '（なし）').replace(/\|/g, '\\|').slice(0, 120);
    out.push(
      `| ${t.label} | \`${t.rawField ?? '項目なし'}\` = ${cell(t.raw)} | ${FIELD_STATE_LABEL[t.state]} |` +
        ` ${cell(t.transform)} | ${cell(t.normalized)} | ${cell(t.displayed)} |`,
    );
  }
  out.push('');
  return out;
}

/**
 * ★「全件が同じ理由で弾かれた」なら止める（2026-08-25 ユーザー指示・確定）。
 *
 *   「『全件同じ特殊値』の場合は商品データ異常ではなく、
 *     API仕様の読み違い候補として止める」
 *
 *   1件だけ -1 なら、その商品が本当に不明なだけ、はありうる。
 *   だが全件が -1 なら、商品側の問題ではありえない。
 *   ほぼ確実に **こちらが見に行く項目名か単位を間違えている**。
 *
 * @returns true = 止めるべき
 */
function haltIfAllSame(guardToCheck: ValueGuard, stageLabel: string): boolean {
  const hits = findAllSameRejections(guardToCheck.report());
  if (!hits.length) return false;
  console.log(`\n★${stageLabel}テストを、ここで止めます。`);
  console.log('  理由：下の項目が「全件とも同じ理由」で弾かれています。');
  console.log('        商品データの異常ではなく、API仕様の読み違いの可能性が高い状態です。');
  for (const h of hits) {
    console.log(`    ・${h.field}：${h.count}件すべて「${VALUE_REJECT_LABEL[h.reason]}」`);
    console.log(`        弾いた値そのもの（無加工）：${h.samples.join(' , ')}`);
  }
  console.log('  → 項目名・単位・特殊値の読み方を直してから、1件だけ取り直してください。');
  console.log('  ★これは「0件だった」ではありません。「読み方が違う疑いがあるので止めた」です。');
  return true;
}

const PRICE_KEYS = ['targetSalePrice', 'salePrice'] as const;
const CURRENCY_KEYS = ['targetSalePriceCurrency', 'salePriceCurrency'] as const;

/** 候補の項目名を上から順に見て、最初に入っていた値を返す（`??` と同じ動き） */
function firstOf(item: any, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = item?.[k];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** STEPの結果を1行として台帳に残す。★未実行のSTEPは行を作らない */
async function recordStep(o: {
  no: number;
  key: string;
  apiName: string | null;
  outcome: DiscoveryOutcome | 'SKIPPED';
  passed: boolean;
  checked?: string[];
  unknown?: string[];
  note?: string;
  elapsedMs?: number | null;
  aliexpressCalls?: number | null;
}) {
  await insert('live_test_steps', {
    id: newId('lstep'),
    step_no: o.no,
    step_key: o.key,
    api_name: o.apiName,
    outcome: o.outcome,
    passed: o.passed ? 1 : 0,
    checked_fields: o.checked?.length ? JSON.stringify(o.checked) : null,
    unknown_fields: o.unknown?.length ? JSON.stringify(o.unknown) : null,
    note: o.note ?? null,
    elapsed_ms: o.elapsedMs ?? null,
    aliexpress_calls: o.aliexpressCalls ?? null,
    // ★Keepaのトークンは、数えられなければ null のまま（0で埋めない）
    keepa_tokens: keepaTokensConsumed(),
    // ★このスクリプトは OpenAI を1回も呼ばない。だからこれは「本当に0」
    openai_calls: 0,
    created_at: nowIso(),
  }).catch(() => {});
}

/** 段階を1つずつ上げる（飛び級しない。CONNECTEDを飛ばしてVERIFIEDにしない） */
async function climbTo(apiName: string, target: ContractStatus, note: string) {
  const order: ContractStatus[] = ['DOCUMENTED', 'AUTHORIZED', 'CONNECTED', 'VERIFIED'];
  for (const s of order) {
    const cur = await contractStatus(PROVIDER, apiName);
    if (cur === target) break;
    if (order.indexOf(s) <= order.indexOf(cur)) continue;
    const r = await advanceContract(PROVIDER, apiName, s, note);
    if (!r.ok) break;
    if (s === target) break;
  }
}

/** 1回の呼び出し。★HTTP 200 でも中身のエラーを必ず見る（client.call が中で見ている） */
async function callApi(
  client: AliExpressClient,
  method: string,
  business: Record<string, string>,
  needsToken: boolean,
  query: string,
) {
  const started = Date.now();
  const check: VerifyChecklist = {
    requestOk: false,
    responseOk: false,
    parseOk: false,
    displayOk: false,
    businessCodeOk: false,
  };
  try {
    if (needsToken) assertTokenUsable(method); // ★期限切れは「0件」ではなく AUTH_ERROR で止める
    const json = await client.call(method, business, needsToken);
    // client.call は error_response / envelope の code を見て投げるので、
    // ここまで来た＝通信も業務コードも正常。
    check.requestOk = true;
    check.responseOk = json !== null && json !== undefined;
    check.businessCodeOk = true;
    return { ok: true as const, json, check, elapsed: Date.now() - started, outcome: 'OK' as DiscoveryOutcome };
  } catch (e) {
    const outcome = classifyError(e);
    await logDiscoveryCall({
      provider: PROVIDER,
      apiName: method,
      query,
      outcome,
      note: String((e as Error)?.message ?? e).slice(0, 500),
      elapsedMs: Date.now() - started,
    });
    return { ok: false as const, json: null, check, elapsed: Date.now() - started, outcome, error: e };
  }
}

function line(label: string, value: unknown) {
  const v = value === null || value === undefined || value === '' ? '（取れませんでした＝UNKNOWN）' : String(value);
  console.log(`      ${label.padEnd(14)} ${v.slice(0, 100)}`);
}

async function main() {
  const keyword = arg('keyword') || 'stainless steel dish rack';
  const imageUrl = arg('image');

  console.log('=== AliExpress 鍵投入直後テスト（固定手順）===\n');

  // ---- 手順の確認だけ（外部APIを1回も呼ばない）-----------------------
  if (HAS('plan')) {
    for (const l of describePlan()) console.log(l);
    console.log('\n★外部APIは1回も呼んでいません。');
    return;
  }

  await migrate();
  resetKeepaTokenMeter();
  takeSupplierApiCallCount();

  // ==================================================================
  // STEP 1 : 認証確認だけ。商品はまだ取らない
  // ==================================================================
  const s1 = LIVE_TEST_STEPS[0];
  console.log(`【STEP ${s1.no}】${s1.title}`);

  console.log(`  ${describeSecret('APP_KEY   ', process.env.ALIEXPRESS_APP_KEY)}`);
  console.log(`  ${describeSecret('APP_SECRET', process.env.ALIEXPRESS_APP_SECRET)}`);
  const tk = await recordTokenMeta(PROVIDER);
  console.log(`  ${tk.summary}`);
  if (tk.present) {
    console.log(`    取得日時 ： ${tk.obtainedAt ?? '不明（.env に ALIEXPRESS_TOKEN_OBTAINED_AT が無い）'}`);
    console.log(`    期限     ： ${tk.expiresAt ?? '不明（.env に ALIEXPRESS_TOKEN_EXPIRES_AT が無い）'}`);
    console.log(`    refresh  ： ${tk.hasRefresh ? 'あり' : 'なし'}／期限 ${tk.refreshExpiresAt ?? '不明'}`);
    console.log(`    権限     ： ${tk.scopes ?? '不明（.env に ALIEXPRESS_TOKEN_SCOPES が無い）'}`);
  }

  if (!aliexpressConfigured()) {
    console.log('\n  AUTHENTICATED = false');
    console.log('  理由：APP_KEY / APP_SECRET が .env にありません。');
    console.log('  → 申請手順：事業Vault/Amazon AI Seller OS/13_AliExpress申請手順.md\n');
    console.log('  鍵が届いたら、この下の手順がそのまま自動で走ります：\n');
    for (const l of describePlan()) console.log(l);
    console.log('\n★外部APIは1回も呼んでいません（課金0円）。');
    console.log('★これは「0件でした」ではなく「まだ試していません」という意味です。');
    return;
  }

  const contracts = await listContracts(PROVIDER);
  const usable = contracts.filter((c) => c.officialDocumentUrl && c.status !== 'UNVERIFIED');
  console.log('\n  API契約台帳：');
  for (const c of contracts) console.log(`    ${c.apiName.padEnd(38)} ${CONTRACT_STATUS_LABEL[c.status]}`);
  if (!usable.length) {
    console.log('\n  AUTHENTICATED = false');
    console.log(`  ${OUTCOME_LABEL.NOT_VERIFIED}`);
    await recordStep({ no: 1, key: s1.key, apiName: null, outcome: 'NOT_VERIFIED', passed: false, note: '公式URL付きのAPIが台帳に無い' });
    process.exit(1);
  }

  console.log('\n  AUTHENTICATED = true（鍵が揃い、署名を作れ、公式確認済みのAPIがある）');
  console.log('  ★ただし断りを1つ：');
  console.log('    AliExpressには「認証だけを確かめる公式API」が確認できませんでした（UNKNOWN）。');
  console.log('    存在しないAPIを勝手に作って呼ぶことはしないので、');
  console.log('    相手サーバーが本当に受け入れたかは STEP2 の1回目で判定します。');
  console.log('    STEP2 で認証に失敗した場合、商品の中身は一切見ずに止めます。');
  await recordStep({
    no: 1,
    key: s1.key,
    apiName: null,
    outcome: 'OK',
    passed: true,
    checked: s1.checkFields,
    note: '鍵・署名・台帳を確認。商品は1件も取得していない',
    aliexpressCalls: 0,
  });

  const client = new AliExpressClient();
  const provider = new AliExpressDiscoveryProvider();
  const guard = new ValueGuard();

  // ==================================================================
  // STEP 2 : 商品を1件だけ取得
  // ==================================================================
  const s2 = LIVE_TEST_STEPS[1];
  console.log(`\n【STEP ${s2.no}】${s2.title}`);
  takeSupplierApiCallCount();
  /**
   * ★監査ログに残す「request項目」。
   *   ここには app_key / sign / access_token を入れない（入れてはいけない）。
   *   署名や鍵は client の中だけで組み立てられ、外へは出さない設計。
   */
  const req2: Record<string, string> = {
    keyWord: keyword,
    local: client.locale,
    countryCode: client.country,
    currency: client.currency,
    pageSize: '1',
    pageIndex: '1',
  };
  const r2 = await callApi(client, s2.apiName!, req2, !!client.accessToken, keyword);
  const calls2 = takeSupplierApiCallCount();

  if (!r2.ok) {
    console.log(`  結果：${OUTCOME_LABEL[r2.outcome]}`);
    console.log(`  詳細：${scrubKnownSecrets(String((r2 as any).error?.message ?? ''), RAW_SECRETS).slice(0, 300)}`);
    console.log('\n  ★ここで止めます。商品の中身は見ません。5件・20件へは進みません。');
    if (r2.outcome === 'AUTH_ERROR') console.log('  → 認証に失敗しました。鍵・署名・トークンの期限を確認してください。');
    if (r2.outcome === 'NO_PERMISSION') console.log('  → このAPIの権限が未承認です。AliExpressの管理画面を確認してください。');
    await recordStep({ no: 2, key: s2.key, apiName: s2.apiName, outcome: r2.outcome, passed: false, elapsedMs: r2.elapsed, aliexpressCalls: calls2 });
    process.exit(1);
  }

  // ★認証はここで初めて「本当に通った」と言える
  console.log('  認証：本物のAPIに受け入れられました（AUTH OK）');
  await climbTo(s2.apiName!, 'CONNECTED', '鍵で呼べて認証も通った');

  const items2 = extractAliexpressItems(r2.json);
  if (items2 === null) {
    console.log(`  結果：${OUTCOME_LABEL.PARSE_ERROR}`);
    console.log('  → 応答は返りましたが、商品の並びを取り出せませんでした（項目名が変わった可能性）。');
    console.log('  ★これは「0件」ではありません。');
    await recordStep({ no: 2, key: s2.key, apiName: s2.apiName, outcome: 'PARSE_ERROR', passed: false, elapsedMs: r2.elapsed, aliexpressCalls: calls2 });
    process.exit(1);
  }
  r2.check.parseOk = true;

  if (!items2.length) {
    console.log(`  結果：${OUTCOME_LABEL['0_RESULTS']}`);
    console.log('  → 別の言葉で試してください： npm run aliexpress:live -- --keyword "別の言葉"');
    await recordStep({ no: 2, key: s2.key, apiName: s2.apiName, outcome: '0_RESULTS', passed: false, elapsedMs: r2.elapsed, aliexpressCalls: calls2 });
    process.exit(1);
  }

  const raw = items2[0];
  const shown = {
    商品ID: guard.text('itemId', raw?.itemId ?? raw?.item_id ?? raw?.product_id),
    商品名: guard.text('title', raw?.title ?? raw?.product_title),
    価格: guard.price('salePrice', firstOf(raw, PRICE_KEYS)),
    通貨: guard.currency('currency', firstOf(raw, CURRENCY_KEYS)),
    商品画像: guard.imageUrl('image', raw?.itemMainPic ?? raw?.product_main_image_url),
    商品URL: guard.purchaseUrl('itemUrl', raw?.itemUrl ?? raw?.product_detail_url),
    店舗: guard.text('storeName', raw?.storeName ?? raw?.shop_name),
    カテゴリー: guard.text('categoryId', raw?.cateId ?? raw?.category_id),
  };
  console.log('\n    APIの生データと、システムが表示する値の照合：');
  for (const [k, v] of Object.entries(shown)) line(k, v);

  // ==================================================================
  // ★価格・通貨のRAW監査（2026-08-24 ユーザー指示で確定）
  // ------------------------------------------------------------------
  // 「APIが返した価格・通貨の生値と、システム解釈後の値を必ず並べて表示してください。
  //   RAW値は加工・丸め・換算禁止です。」
  //
  // ★ここで出す RAW 値には、一切手を加えていない。
  //   丸めない／換算しない／大文字にしない／カンマを消さない。
  //   JSON表記のまま出すので、引用符の有無で「文字列で来たのか数値で来たのか」まで判る。
  // ==================================================================
  const priceRaw = pickRaw(raw, [...PRICE_KEYS]);
  const currencyRaw = pickRaw(raw, [...CURRENCY_KEYS]);
  const priceLike = collectRawFields(raw);

  console.log('\n    ★価格・通貨の RAW 監査（生値 ⇔ システム解釈後）');
  console.log('      下の RAW は APIの応答そのままです。丸め・換算・大文字化を一切していません。');
  console.log(
    `      価格  RAW  ${priceRaw.field ?? '（どの候補項目にも値が無し）'}` +
      ` = ${priceRaw.raw ?? '（生値なし＝UNKNOWN）'}`,
  );
  console.log(`            解釈後  ${shown.価格 ?? '（UNKNOWN）'}`);
  console.log(
    `      通貨  RAW  ${currencyRaw.field ?? '（どの候補項目にも値が無し）'}` +
      ` = ${currencyRaw.raw ?? '（生値なし＝UNKNOWN）'}`,
  );
  console.log(`            解釈後  ${shown.通貨 ?? '（UNKNOWN）'}`);

  // ★食い違いは「不合格」ではない。人が目を止めるべき場所を示すだけ。
  const rawNotes: string[] = [];
  if (rawDiffers(priceRaw.raw, shown.価格)) {
    rawNotes.push(
      `価格：生値 ${priceRaw.raw ?? 'なし'} → 解釈後 ${shown.価格 ?? 'UNKNOWN'}` +
        '（文字列→数値なら正常。桁・カンマ・マイナスが動いていないか人が確認）',
    );
  }
  if (rawDiffers(currencyRaw.raw, shown.通貨)) {
    rawNotes.push(
      `通貨：生値 ${currencyRaw.raw ?? 'なし'} → 解釈後 ${shown.通貨 ?? 'UNKNOWN'}` +
        '（大文字化なら正常。別の通貨に変わっていたら異常）',
    );
  }
  if (rawNotes.length) {
    console.log('      ★生値と解釈後で見た目が変わった項目（要目視）：');
    for (const n of rawNotes) console.log(`        ・${n}`);
  } else {
    console.log('      生値と解釈後は、見た目も一致しています。');
  }

  // ★選ばなかった項目まで全部出す。「拾う項目名そのものを間違えていた」を見つけるため。
  console.log('      応答に含まれていた価格・通貨らしき項目（選ばなかったものも含め全部そのまま）：');
  if (!priceLike.length) {
    console.log('        （該当する項目名がありませんでした＝項目名が想定と全く違う可能性）');
  }
  for (const f of priceLike) {
    const chosen = f.field === priceRaw.field || f.field === currencyRaw.field ? ' ← これを採用' : '';
    console.log(`        ${f.field.padEnd(28)} = ${f.raw.slice(0, 60)}${chosen}`);
  }

  // ==================================================================
  // ★3段トレース（2026-08-25 ユーザー指示で確定）
  // ------------------------------------------------------------------
  //   「1商品取得時は、APIから返った元レスポンス → 正規化後 → 画面表示値を
  //     3段で並べて比較する」
  //   「価格だけでなく、送料・在庫・通貨・画像・URL・商品IDも同じ1件について追跡する」
  //   「UNKNOWN / NULL / NOT_AVAILABLE / 特殊値 / 0 / 実数 を別状態として扱う」
  //
  // ★必須群と参考群を分ける理由
  //   送料・在庫・MOQ・重量は、検索API（STEP2）の応答には元々入らないことがある。
  //   入らないものを「不整合」に数えると、STEP2 が永久に合格せず先へ進めなくなる。
  //   なので **追跡はするが、STEP2の合否には使わない**。
  //   その代わり STEP3（詳細）・STEP4（送料）で必ず同じ1件を追跡し直す。
  //   ＝「見ていないから合格」ではなく「どのSTEPで見るかを決めてある」。
  // ==================================================================
  const coreTraces: FieldTrace[] = [
    traceField({ label: '商品ID', item: raw, keys: ['itemId', 'item_id', 'product_id'], normalized: shown.商品ID }),
    traceField({ label: '商品名', item: raw, keys: ['title', 'product_title'], normalized: shown.商品名 }),
    traceField({ label: '価格', item: raw, keys: [...PRICE_KEYS], normalized: shown.価格 }),
    traceField({ label: '通貨', item: raw, keys: [...CURRENCY_KEYS], normalized: shown.通貨 }),
    traceField({ label: '商品画像', item: raw, keys: ['itemMainPic', 'product_main_image_url'], normalized: shown.商品画像 }),
    traceField({ label: '商品URL', item: raw, keys: ['itemUrl', 'product_detail_url'], normalized: shown.商品URL }),
  ];

  // 参考群：この1件について「今どうなっているか」だけ記録する（STEP2の合否には使わない）
  const refGuard = new ValueGuard(3);
  const SHIP_KEYS = ['shippingFee', 'freight', 'logisticsCost', 'shipping_cost'];
  const STOCK_KEYS = ['stock', 'itemStock', 'availableQuantity', 'inventory'];
  const MOQ_KEYS = ['minOrderQuantity', 'moq', 'min_order_quantity'];
  const WEIGHT_KEYS = ['packageWeight', 'itemWeight', 'weight'];
  const refTraces: FieldTrace[] = [
    traceField({ label: '送料', item: raw, keys: SHIP_KEYS, normalized: refGuard.num('shippingFee', firstOf(raw, SHIP_KEYS), { allowZero: true }) }),
    traceField({ label: '在庫', item: raw, keys: STOCK_KEYS, normalized: refGuard.stock('stock', firstOf(raw, STOCK_KEYS)) }),
    traceField({ label: 'MOQ', item: raw, keys: MOQ_KEYS, normalized: refGuard.moq('moq', firstOf(raw, MOQ_KEYS)) }),
    traceField({ label: '重量', item: raw, keys: WEIGHT_KEYS, normalized: refGuard.weightG('weight', firstOf(raw, WEIGHT_KEYS)) }),
  ];

  console.log('\n    ★3段トレース（① 元レスポンス → ② 正規化後 → ③ 画面表示値）');
  console.log('      ①は無加工です。引用符の有無で「文字列で来たのか数値で来たのか」まで判ります。');
  for (const l of renderFieldTrace(coreTraces)) console.log(l);

  console.log('\n    ［参考］この1件の 送料・在庫・MOQ・重量（STEP2の合否には使いません）');
  console.log('      検索APIの応答には元々入らないことがあります。STEP3・STEP4で同じ1件を追跡し直します。');
  for (const t of refTraces) {
    console.log(
      `      ${t.label.padEnd(6)} ${(t.rawField ?? '項目なし').padEnd(20)} = ${(t.raw ?? '（値なし）').slice(0, 40)}` +
        `  → ${FIELD_STATE_LABEL[t.state]}`,
    );
  }

  // ★不整合。1件でもあるうちは5件テストへ進まない（ユーザー指示・確定）
  const traceIssues = traceProblems(coreTraces);
  // 参考群からは「取れなかった」を除き、構造の異常だけを拾う
  const refIssues = traceProblems(refTraces).filter((s) => !s.includes('推測で埋めず'));
  const mismatches = [...traceIssues, ...refIssues];
  const fullyCaptured = isFullyCaptured(coreTraces);

  console.log('');
  if (fullyCaptured && !mismatches.length) {
    console.log('    この商品は「正常取得」です（追跡した必須6項目がすべてそろい、不整合0件）。');
  } else {
    console.log('    ★この商品は「正常取得」ではありません。');
    console.log('      取れなかった項目があるので、商品全体を「正常取得」と表示しません。');
    for (const m of mismatches) console.log(`      ・${m}`);
    console.log('      → この状態のまま5件テストへは進みません（不整合が0件になるまで止めます）。');
  }

  const unknown2 = Object.entries(shown).filter(([, v]) => v === null).map(([k]) => k);
  if (unknown2.length) {
    console.log(`\n    ★取れなかった項目：${unknown2.join(' / ')} → UNKNOWN のまま扱います（推測で埋めません）`);
  }
  // ★照合の合格判定：生データにある値が、そのまま表示されているか
  r2.check.displayOk = shown.商品ID !== null && shown.商品名 !== null;
  if (!shown.商品URL) {
    console.log('    ★商品URLが取れていないため、この商品はAランクにできません（決まりどおり）。');
  }

  await insert('api_response_samples', {
    id: newId('sample'),
    provider: PROVIDER,
    api_name: s2.apiName,
    sample_kind: 'live_step2',
    redacted_body: safeBody(r2.json),
    field_report: null,
    created_at: nowIso(),
  }).catch(() => {});

  // ==================================================================
  // 1商品目の監査ログ（13項目）
  // ------------------------------------------------------------------
  // ユーザー指示（2026-08-22）：「1商品目で必ず保存するもの」＝13項目。
  // ★Keepaで実際に起きた事故（画像形式の読み違い／-2 の意味の読み違い／
  //   寸法 -1 のすり抜け）は、どれも最初の1件の生データを残していなかったせいで
  //   後から確かめられなかった。同じことを繰り返さないための保険。
  // ★秘密情報は入れない。request_params は業務パラメータのみ。
  // ==================================================================
  const meta2 = client.lastMeta; // 呼んでいなければ null＝不明（「成功」ではない）
  const fetchedAt = nowIso();
  const auditId = newId('audit');
  await insert('live_first_product_audit', {
    id: auditId,
    provider: PROVIDER,
    api_name: s2.apiName,                                   // 1. 呼び出したAPI名
    request_params: safeBody(req2),                          // 2. request項目（鍵・署名は含まない）
    http_status: meta2?.httpStatus ?? null,                  // 3. HTTP status（不明なら null）
    aliexpress_code: meta2?.code ?? null,                    // 4. AliExpress側 code（返らなければ null＝UNKNOWN）
    success: meta2 ? (meta2.success ? 1 : 0) : null,         // 5. success / error（不明なら null）
    error_text: meta2?.message ?? null,
    product_id: shown.商品ID,                                 // 6. product ID
    product_title: shown.商品名,                              // 7. 商品名
    price: shown.価格 === null ? null : String(shown.価格),    // 8. 価格
    currency: shown.通貨,                                     // 9. 通貨
    image_url: shown.商品画像,                                 // 10. 画像
    product_url: shown.商品URL,                                // 11. 商品URL
    fetched_at: fetchedAt,                                    // 12. 取得日時
    unknown_fields: unknown2.length ? JSON.stringify(unknown2) : null, // 13. UNKNOWN項目
    // ★価格・通貨のRAW値（2026-08-24 確定・加工/丸め/換算なし）
    price_raw: safeRaw(priceRaw.raw),
    price_raw_field: priceRaw.field,
    currency_raw: safeRaw(currencyRaw.raw),
    currency_raw_field: currencyRaw.field,
    price_fields_raw: priceLike.length ? safeRaw(JSON.stringify(priceLike)) : null,
    // ★3段トレース（2026-08-25 確定）
    field_trace: safeRaw(JSON.stringify({ core: coreTraces, reference: refTraces })),
    incomplete_fields: (() => {
      const ng = coreTraces.filter((t) => !t.ok).map((t) => `${t.label}(${t.state})`);
      return ng.length ? JSON.stringify(ng) : null;
    })(),
    mismatch_count: mismatches.length,
    fully_captured: fullyCaptured ? 1 : 0,
    verdict: null,          // ← ChatGPT監査の結論を、人が後から入れる欄（勝手に埋めない）
    chatgpt_report: null,
    created_at: nowIso(),
  }).catch(() => {});
  console.log(`\n    監査ログを保存しました（13項目＋価格RAW5項目＋3段トレース4項目 / id=${auditId}）`);
  for (const f of FIRST_PRODUCT_AUDIT_FIELDS) console.log(`      ・${f}`);
  console.log('      ---- ここから価格RAW監査（2026-08-24 追加）----');
  for (const f of FIRST_PRODUCT_RAW_AUDIT_FIELDS) console.log(`      ・${f}`);
  console.log('      ---- ここから3段トレース（2026-08-25 追加）----');
  for (const f of FIRST_PRODUCT_TRACE_AUDIT_FIELDS) console.log(`      ・${f}`);

  const pass2 = canVerify(r2.check);
  console.log(`\n  STEP2 判定：${pass2 ? '合格' : '不合格'}`);
  if (!pass2) for (const g of describeVerifyGaps(r2.check)) console.log(`    ${g}`);
  await recordStep({
    no: 2, key: s2.key, apiName: s2.apiName, outcome: 'OK', passed: pass2,
    checked: s2.checkFields, unknown: unknown2, elapsedMs: r2.elapsed, aliexpressCalls: calls2,
  });
  if (!pass2) {
    console.log('  ★ここで止めます。VERIFIEDにはしません。');
    process.exit(1);
  }
  await climbTo(s2.apiName!, 'VERIFIED', `実商品1件を取得し、生データと表示の一致を確認（${nowIso().slice(0, 10)}）`);

  // ==================================================================
  // ★ここで必ず一度止まる（ChatGPT監査ゲート）
  // ------------------------------------------------------------------
  // ユーザー指示（2026-08-22）：
  //   「STEP2で、『AliExpressから本物の商品1件を取得できた』時点で一度止めてください。」
  //   「ChatGPT確認後に、STEP3以降へ進める形にしてください。」
  // ★止まるのが既定。飛ばしたいときは人が明示的に --after-audit を付けて再実行する。
  // ==================================================================
  console.log('\n==================================================================');
  console.log('★STEP2 完了：本物の商品を1件取得しました。ここで一度止まります。');
  console.log('  下の10項目を、そのままChatGPTに貼って監査してもらってください。');
  console.log('==================================================================');
  console.log(`  1. 使用したAPI            ： ${s2.apiName}`);
  console.log(`  2. 認証結果               ： 本物のAPIに受け入れられた（HTTP ${meta2?.httpStatus ?? '不明'} / code ${meta2?.code ?? '返ってこなかった＝UNKNOWN'}）`);
  console.log('  3. 実レスポンスから取得できた項目：');
  for (const [k, v] of Object.entries(shown)) {
    if (v !== null) console.log(`       ・${k.padEnd(8)} ${String(v).slice(0, 90)}`);
  }
  console.log(`  4. UNKNOWN項目            ： ${unknown2.length ? unknown2.join(' / ') : 'なし（8項目すべて取得できた）'}`);
  console.log('  5. 想定外だった点         ：');
  {
    const surprises: string[] = [];
    if (meta2?.code === null || meta2?.code === undefined) surprises.push('器の code が返ってこなかった（"00" を勝手に入れず UNKNOWN のままにした）');
    if (unknown2.length) surprises.push(`項目名が想定と違う可能性：${unknown2.join(' / ')} が取れなかった`);
    if (!shown.商品URL) surprises.push('商品URLが取れていない（根拠なくURLを作らないので、この商品はAランク不可）');
    if (!shown.商品画像) surprises.push('画像が取れていない（画像形式の読み違いがKeepaで実際に起きているため要確認）');
    // ★生値は返ってきたのに、システム側が弾いた＝仕様の読み違いが最も疑われる状態。
    //   Keepaの `-2` 事故と同じ形なので、必ず監査で見えるようにする。
    if (priceRaw.raw !== null && shown.価格 === null) {
      surprises.push(
        `価格の生値は返っている（${priceRaw.field} = ${priceRaw.raw}）のに、システムが弾いてUNKNOWNにした。` +
          '仕様の読み違い（特殊値・単位・桁）を最優先で確認',
      );
    }
    if (currencyRaw.raw !== null && shown.通貨 === null) {
      surprises.push(
        `通貨の生値は返っている（${currencyRaw.field} = ${currencyRaw.raw}）のに、システムが弾いてUNKNOWNにした`,
      );
    }
    if (priceRaw.raw === null && priceLike.length) {
      surprises.push(
        `想定していた価格項目（${PRICE_KEYS.join(' / ')}）が無いのに、別名の価格らしき項目はある：` +
          `${priceLike.map((f) => f.field).join(' / ')}。拾う項目名そのものが違う可能性`,
      );
    }
    // ★3段トレースで見つかった不整合も、そのまま監査へ出す（2026-08-25 追加）
    for (const m of mismatches) surprises.push(m);
    if (!surprises.length) console.log('       ・特になし（想定どおりの形で返ってきた）');
    for (const s of surprises) console.log(`       ・${s}`);
  }
  console.log(`  6. 商品URL                ： ${shown.商品URL ?? '取れませんでした＝UNKNOWN'}`);
  // ★7. 価格は「生値」と「解釈後」を必ず並べて出す（2026-08-24 ユーザー指示で確定）。
  //    監査する人が、システムの解釈を信じずに自分で突き合わせられるようにするため。
  console.log('  7. 価格                   ：');
  console.log(
    `       RAW（無加工）  ${priceRaw.field ?? '項目なし'} = ${priceRaw.raw ?? 'なし＝UNKNOWN'}` +
      ` ／ ${currencyRaw.field ?? '項目なし'} = ${currencyRaw.raw ?? 'なし＝UNKNOWN'}`,
  );
  console.log(
    `       システム解釈後 ${shown.価格 ?? '取れませんでした＝UNKNOWN'} ${shown.通貨 ?? '（通貨UNKNOWN）'}`,
  );
  if (rawNotes.length) {
    console.log('       ★生値と解釈後で見た目が変わった点（ここを重点的に見てください）：');
    for (const n of rawNotes) console.log(`         ・${n}`);
  } else {
    console.log('       ★生値と解釈後は見た目も一致（丸め・換算は発生していません）');
  }
  console.log('       応答にあった価格・通貨らしき項目すべて：');
  if (!priceLike.length) console.log('         （該当なし＝項目名が想定と違う可能性）');
  for (const f of priceLike) console.log(`         ${f.field} = ${f.raw.slice(0, 60)}`);
  console.log(`  8. 画像取得結果           ： ${shown.商品画像 ?? '取れませんでした＝UNKNOWN'}`);
  // ★3段トレースの結論。「正常取得」と言ってよいかは、ここだけで判断する（2026-08-25 追加）
  console.log('  8-2. 3段トレース（元レスポンス→正規化後→画面表示値）：');
  for (const l of renderFieldTrace(coreTraces)) console.log(`  ${l}`);
  console.log(
    `       結論：${fullyCaptured && !mismatches.length
      ? '正常取得（必須6項目すべて取得・不整合0件）'
      : `★正常取得ではない（不整合 ${mismatches.length}件）→ 5件テストへは進めない`}`,
  );
  console.log('  9. VERIFIEDにしてよいか   ： システム側の5項目（送信/応答/解析/表示/業務コード）は全て合格。');
  console.log('       ただし最終判断は人が行う。監査で仕様の読み違いが見つかったら差し戻すこと。');
  console.log('  10. 次のSTEP3へ進めてよいか： ★未判定。人が決めるまで進みません。');
  console.log('==================================================================');

  // ==================================================================
  // ★検証結果を Obsidian へ保存する（2026-08-25 ユーザー指示・確定）
  //   「検証結果は必ずObsidianへ保存し、次回AIが先に読む」
  //   画面のログは流れて消えるが、ここに残しておけば次のセッションのAIが先に読める。
  // ==================================================================
  {
    const day = fetchedAt.slice(0, 10);
    const md = [
      `# AliExpress 1商品目の実データ検証（${day}）`,
      '',
      `- 監査ログID： \`${auditId}\``,
      `- 使用API： \`${s2.apiName}\``,
      `- 検索キーワード： ${keyword}`,
      `- 取得日時： ${fetchedAt}`,
      `- 結論： ${fullyCaptured && !mismatches.length ? '**正常取得**（必須6項目すべて取得・不整合0件）' : `**正常取得ではない**（不整合 ${mismatches.length}件）→ 5件テストへ進まない`}`,
      '',
      '## 不整合（1件でもあるうちは5件テストへ進まない）',
      '',
      ...(mismatches.length ? mismatches.map((m) => `- ${m}`) : ['- なし']),
      '',
      '## 3段トレース（① 元レスポンス → ② 正規化後 → ③ 画面表示値）',
      '',
      '> ①は無加工です。丸め・換算・大文字化・カンマ除去を一切していません。',
      '> 引用符の有無で「文字列で来たのか数値で来たのか」まで判ります。',
      '',
      ...traceMarkdown('必須項目（STEP2の合否に使う）', coreTraces),
      ...traceMarkdown('参考項目（STEP3・STEP4で確認し直す）', refTraces),
      '## 応答に含まれていた価格・通貨らしき項目（選ばなかったものも含め全部）',
      '',
      ...(priceLike.length
        ? priceLike.map((f) => `- \`${f.field}\` = ${f.raw.slice(0, 100)}${f.field === priceRaw.field || f.field === currencyRaw.field ? ' ← これを採用' : ''}`)
        : ['- （該当なし＝項目名が想定と全く違う可能性）']),
      '',
      '## 次にやること',
      '',
      '1. この内容をそのまま ChatGPT に貼って監査を受ける',
      '2. 監査で問題が無ければ `npm run aliexpress:live:continue`',
      '3. **不整合が1件でも残っているうちは、5件テストへ進まない**',
      '',
    ].join('\n');
    const saved = saveToObsidian(`AliExpress実データ検証_1商品目_${day}.md`, md);
    if (saved) {
      console.log(`\n  検証結果をObsidianへ保存しました： ${saved}`);
      console.log('  （次回このプロジェクトを触るAIは、まずここを読みます）');
    } else {
      console.log('\n  ★検証結果をObsidianへ保存できませんでした（保存先に書き込めません）。');
      console.log('    DBの監査ログには残っています： live_first_product_audit / id=' + auditId);
    }
  }

  if (!HAS(AUDIT_PAUSE_FLAG)) {
    console.log('\n★ここで止めました。STEP3（商品詳細）以降はまだ1回も呼んでいません。');
    console.log('  理由：Keepaで実際に「画像形式の読み違い」「-2 の意味の読み違い」');
    console.log('        「寸法 -1 のすり抜け」が起きたため、最初の実レスポンスを必ず人が見る決まりです。');
    console.log('\n  監査が済み、問題なければ次のコマンドで STEP3 以降へ進みます：');
    console.log('      npm run aliexpress:live:continue');
    console.log(`\n  監査ログ： live_first_product_audit / id=${auditId}`);
    await recordStep({
      no: 2, key: s2.key, apiName: s2.apiName, outcome: 'OK', passed: true,
      note: 'STEP2成功後、ChatGPT監査のため意図的に停止（--after-audit 未指定）',
      aliexpressCalls: 0,
    });
    return;
  }
  console.log('\n（--after-audit が指定されているため、監査済みとみなして STEP3 へ進みます）');

  // 以降のSTEPで使う「1件」
  const listings = await provider.discoverProducts({ keyword, limit: 1, mode: 'STANDARD', page: 1 }).catch(() => []);
  const target = listings[0] ?? null;

  // ==================================================================
  // STEP 3 : 商品詳細を1件だけ
  // ==================================================================
  const s3 = LIVE_TEST_STEPS[2];
  console.log(`\n【STEP ${s3.no}】${s3.title}`);
  if (!tk.present) {
    console.log('  実行しませんでした：アクセストークンが未設定です。');
    console.log('  → MOQ・在庫・重量・SKU は UNKNOWN のままです（推測しません）。');
    console.log('  ★UNKNOWNがあるうちはAランクを出しません。');
    await recordStep({ no: 3, key: s3.key, apiName: s3.apiName, outcome: 'NO_CREDENTIALS', passed: false, note: 'access_token 未設定のため未実行', unknown: s3.checkFields });
  } else if (!target) {
    console.log('  実行しませんでした：STEP2の商品を保持できませんでした。');
    await recordStep({ no: 3, key: s3.key, apiName: s3.apiName, outcome: 'PARSE_ERROR', passed: false, note: 'STEP2の商品を保持できなかった' });
  } else {
    takeSupplierApiCallCount();
    const t0 = Date.now();
    try {
      await provider.fillDetail(target);
      const a: any = target.attributes ?? {};
      line('価格', target.unitPriceOriginal ? `${target.unitPriceOriginal} ${target.currency}` : null);
      line('MOQ', target.moq);
      line('在庫', target.stock);
      line('重量', a.weightG ? `${a.weightG} g` : null);
      line('SKU', a.aliexpressSkuId);
      line('商品詳細', target.title);
      const unknown3 = (target.unknownFields ?? []).filter((f) =>
        ['minimum_order_quantity', 'stock', 'weight', 'size', 'price'].includes(f),
      );
      if (unknown3.length) console.log(`\n    ★UNKNOWNのまま：${unknown3.join(' / ')}（推測で埋めません）`);
      await recordStep({
        no: 3, key: s3.key, apiName: s3.apiName, outcome: 'OK', passed: true,
        checked: s3.checkFields, unknown: unknown3, elapsedMs: Date.now() - t0,
        aliexpressCalls: takeSupplierApiCallCount(),
      });
      await climbTo(s3.apiName!, 'VERIFIED', `実商品1件の詳細を取得し中身を確認（${nowIso().slice(0, 10)}）`);
    } catch (e) {
      const outcome = classifyError(e);
      console.log(`  結果：${OUTCOME_LABEL[outcome]}`);
      console.log(`  詳細：${scrubKnownSecrets(String((e as Error)?.message ?? ''), RAW_SECRETS).slice(0, 300)}`);
      await recordStep({ no: 3, key: s3.key, apiName: s3.apiName, outcome, passed: false, elapsedMs: Date.now() - t0, aliexpressCalls: takeSupplierApiCallCount() });
    }
  }

  // ==================================================================
  // STEP 4 : 日本向け送料を1件だけ
  // ==================================================================
  const s4 = LIVE_TEST_STEPS[3];
  console.log(`\n【STEP ${s4.no}】${s4.title}`);
  if (!tk.present || !target) {
    console.log('  実行しませんでした：アクセストークンまたは対象商品がありません。');
    console.log('  → 送料は UNKNOWN のまま。★UNKNOWNの送料を着地原価に入れません。');
    await recordStep({ no: 4, key: s4.key, apiName: s4.apiName, outcome: 'NO_CREDENTIALS', passed: false, note: 'access_token または対象商品なし', unknown: s4.checkFields });
  } else {
    takeSupplierApiCallCount();
    const t0 = Date.now();
    try {
      const jpy = await provider.fetchFreightJpy(target, 1);
      line('配送先', client.country);
      line('数量', 1);
      line('送料(円)', jpy);
      line('配送方法', jpy === null ? null : '応答の中で最安の便を採用');
      if (jpy === null) {
        console.log('\n    ★送料が取れませんでした → UNKNOWN のまま利益計算します（0円扱いにしません）。');
        await recordStep({ no: 4, key: s4.key, apiName: s4.apiName, outcome: '0_RESULTS', passed: false, note: '送料の選択肢が返らなかった', unknown: ['送料'], elapsedMs: Date.now() - t0, aliexpressCalls: takeSupplierApiCallCount() });
      } else {
        console.log('\n    ★この値は、応答と表示が一致することを確認してから着地原価へ渡します。');
        await recordStep({ no: 4, key: s4.key, apiName: s4.apiName, outcome: 'OK', passed: true, checked: s4.checkFields, elapsedMs: Date.now() - t0, aliexpressCalls: takeSupplierApiCallCount() });
        await climbTo(s4.apiName!, 'VERIFIED', `日本向け実送料を1件取得して確認（${nowIso().slice(0, 10)}）`);
      }
    } catch (e) {
      const outcome = classifyError(e);
      console.log(`  結果：${OUTCOME_LABEL[outcome]}`);
      await recordStep({ no: 4, key: s4.key, apiName: s4.apiName, outcome, passed: false, elapsedMs: Date.now() - t0, aliexpressCalls: takeSupplierApiCallCount() });
    }
  }

  // ==================================================================
  // STEP 5 : 画像検索を1件だけ
  // ==================================================================
  const s5 = LIVE_TEST_STEPS[4];
  console.log(`\n【STEP ${s5.no}】${s5.title}`);
  if (!tk.present) {
    console.log('  実行しませんでした：アクセストークンが未設定です（画像検索には必須）。');
    await recordStep({ no: 5, key: s5.key, apiName: s5.apiName, outcome: 'NO_CREDENTIALS', passed: false, note: 'access_token 未設定' });
  } else if (!imageUrl) {
    console.log('  実行しませんでした：基準にするAmazon商品画像が指定されていません。');
    console.log('  → npm run aliexpress:live -- --image <Amazonの商品画像URL>');
    console.log('  ★これは失敗ではなく「未実行」です。0件とは記録しません。');
    await recordStep({ no: 5, key: s5.key, apiName: s5.apiName, outcome: 'SKIPPED', passed: false, note: '基準画像が指定されていないため未実行（失敗ではない）' });
  } else {
    takeSupplierApiCallCount();
    const t0 = Date.now();
    try {
      const found = await provider.findByImage(imageUrl, 5);
      console.log(`    候補：${found.length}件`);
      for (const f of found.slice(0, 5)) {
        console.log(`      ${String(f.title).slice(0, 46)}`);
        console.log(`        AliExpress側の類似度 ： ${f.note?.includes('画像類似度') ? f.note : '（返りませんでした＝UNKNOWN）'}`);
        console.log('        自前のMATCH SCORE   ： このSTEPでは計算しません（別々に保存します）');
      }
      console.log('\n    ★AliExpress側の類似度を、そのまま「同一商品」とは判定しません。');
      console.log('      同一判定は自前のMATCH SCOREで行い、2つの数字は別々に保存します。');
      const passed = found.length > 0;
      await recordStep({
        no: 5, key: s5.key, apiName: s5.apiName, outcome: passed ? 'OK' : '0_RESULTS', passed,
        checked: s5.checkFields, elapsedMs: Date.now() - t0, aliexpressCalls: takeSupplierApiCallCount(),
      });
      if (passed) await climbTo(s5.apiName!, 'VERIFIED', `Amazon画像で候補を取得し中身を確認（${nowIso().slice(0, 10)}）`);
    } catch (e) {
      const outcome = classifyError(e);
      console.log(`  結果：${OUTCOME_LABEL[outcome]}`);
      console.log(`  詳細：${scrubKnownSecrets(String((e as Error)?.message ?? ''), RAW_SECRETS).slice(0, 300)}`);
      await recordStep({ no: 5, key: s5.key, apiName: s5.apiName, outcome, passed: false, elapsedMs: Date.now() - t0, aliexpressCalls: takeSupplierApiCallCount() });
    }
  }

  // ==================================================================
  // 段階を上げる：5件 → （関門）→ 20件
  // ==================================================================
  console.log('\n=== 段階を上げる（1件 → 5件 → 20件）===');

  // ==================================================================
  // ★関門：1商品で不整合が1つでもあれば、5件テストへ進まない
  // ------------------------------------------------------------------
  // ユーザー指示（2026-08-25・確定）：
  //   「取得できなかった項目があれば、商品全体を『正常取得』と表示しない」
  //   「1商品で不整合が1つでも見つかったら、5件テストへ進まない」
  //   「1商品が完全一致した後に、5件 → 20件の順で広げる」
  //
  // ★なぜ件数を増やす前に止めるのか
  //   読み方が間違ったまま件数だけ増やすと、間違いが5倍・20倍になるだけで、
  //   「たくさん取れた」という見かけの安心だけが増える。
  //   1件を完全に理解できていない状態で広げても、得られる情報は増えない。
  // ==================================================================
  if (!fullyCaptured || mismatches.length) {
    console.log('\n★5件テストへは進みません。');
    console.log(`  理由：1商品目に不整合が ${mismatches.length}件 残っています。`);
    for (const m of mismatches) console.log(`    ・${m}`);
    console.log('  1件を完全に理解できていない状態で件数を増やしても、間違いが増えるだけです。');
    console.log('  項目名・単位・特殊値の読み方を直してから、もう一度1件だけ取り直してください。');
    console.log(`\n  監査ログ： live_first_product_audit / id=${auditId}`);
    await recordStep({
      no: 6, key: 'SCALE_5', apiName: s2.apiName, outcome: 'OK', passed: false,
      note: `1商品目の不整合 ${mismatches.length}件のため、5件テストを実行していない（0件だったのではない）`,
      aliexpressCalls: 0,
    });
    return;
  }

  console.log('\n--- 5件 ---');
  takeSupplierApiCallCount();
  const r5 = await callApi(
    client,
    s2.apiName!,
    { keyWord: keyword, local: client.locale, countryCode: client.country, currency: client.currency, pageSize: '5', pageIndex: '1' },
    !!client.accessToken,
    keyword,
  );
  const items5 = r5.ok ? extractAliexpressItems(r5.json) ?? [] : [];
  // ★件数が少ないので、弾いた値は全部控える（既定の5件上限だと取りこぼす）
  const g5 = new ValueGuard(items5.length || 5);
  let parseErr5 = 0;
  let url5 = 0;
  let img5 = 0;
  let price5 = 0;
  for (const it of items5) {
    const id = g5.text('itemId', it?.itemId);
    if (!id) parseErr5++;
    if (g5.purchaseUrl('itemUrl', it?.itemUrl ?? it?.product_detail_url)) url5++;
    if (g5.imageUrl('image', it?.itemMainPic)) img5++;
    if (g5.price('salePrice', firstOf(it, PRICE_KEYS))) price5++;
    // ★通貨も数える。価格だけ見て通貨を見ないと、桁は正しいのに通貨違いで赤字になる
    g5.currency('currency', firstOf(it, CURRENCY_KEYS));
  }
  const rate5 = items5.length ? Math.round(((items5.length - parseErr5) / items5.length) * 100) : 0;
  console.log(`  結果：${OUTCOME_LABEL[r5.outcome]}／${items5.length}件`);
  console.log(`  成功率：${rate5}%（重要項目の解析エラー ${parseErr5}件）`);
  console.log(`  商品URLあり ${url5}/${items5.length}件／画像あり ${img5}/${items5.length}件／価格あり ${price5}/${items5.length}件`);
  // ★弾いた値の内訳と「弾いた値そのもの」を必ず出す（2026-08-24 追加）
  //   これまでは集計だけ取って表示も保存もしておらず、捨てていた。
  console.log('\n  ★弾いた値の内訳（全体の取得率に混ぜない）：');
  for (const l of describePriceAnomalies(g5.report())) console.log(l);
  for (const l of describeGuardReport(g5.report())) console.log(l);
  await recordStep({
    no: 6, key: 'SCALE_5', apiName: s2.apiName, outcome: r5.outcome, passed: r5.ok && rate5 === 100,
    note: `成功率${rate5}%／URL ${url5}／画像 ${img5}／価格 ${price5}`, elapsedMs: r5.elapsed,
    aliexpressCalls: takeSupplierApiCallCount(),
  });
  // ★5件の検査結果も保存する（これまでは集計を取るだけで捨てていた）
  await insert('api_response_samples', {
    id: newId('sample'),
    provider: PROVIDER,
    api_name: s2.apiName,
    sample_kind: 'live_step5',
    redacted_body: safeBody(r5.json),
    field_report: JSON.stringify(g5.report()),
    created_at: nowIso(),
  }).catch(() => {});

  // ★全件が同じ理由で弾かれていたら、ここで止める（2026-08-25 追加）
  if (haltIfAllSame(g5, '5件')) {
    await recordStep({
      no: 7, key: 'SCALE_20', apiName: s2.apiName, outcome: 'OK', passed: false,
      note: '5件で「全件同じ理由」を検出したため、20件を実行していない（0件だったのではない）',
      aliexpressCalls: 0,
    });
    return;
  }

  const gate: TwentyGate = {
    oneItemPassed: pass2,
    fiveItemSuccessRate100: r5.ok && items5.length > 0 && rate5 === 100,
    criticalParseErrorsZero: parseErr5 === 0,
    productUrlOk: items5.length > 0 && url5 === items5.length,
    imageOk: items5.length > 0 && img5 === items5.length,
    priceOk: items5.length > 0 && price5 === items5.length,
    // ★送料は「取れた」か「UNKNOWNと明示した」のどちらかであればよい。黙って0円にしていないこと。
    freightOkOrUnknownStated: true,
    // ★このスクリプトは実APIしか呼ばない（Mockを呼ぶ経路が無い）ので0
    mockContaminationZero: true,
  };
  console.log('\n--- 20件へ進んでよいか（8項目の関門）---');
  for (const l of describeTwentyGate(gate)) console.log(l);

  if (!canGoTwenty(gate)) {
    console.log('\n★関門を通らなかったので、20件は取りません。ここで止めます。');
    console.log('  （「20件が0件だった」ではなく「20件を試していない」という意味です）');
    process.exit(1);
  }

  console.log('\n--- 20件 ---');
  takeSupplierApiCallCount();
  const r20 = await callApi(
    client,
    s2.apiName!,
    { keyWord: keyword, local: client.locale, countryCode: client.country, currency: client.currency, pageSize: '20', pageIndex: '1' },
    !!client.accessToken,
    keyword,
  );
  const items20 = r20.ok ? extractAliexpressItems(r20.json) ?? [] : [];
  const calls20 = takeSupplierApiCallCount();
  console.log(`  結果：${OUTCOME_LABEL[r20.outcome]}／${items20.length}件`);

  // ==================================================================
  // ★20件も1件ずつ検査する（2026-08-24 追加）
  // ------------------------------------------------------------------
  // これまで20件は「何件返ってきたか」しか見ておらず、中身を1件も検査していなかった。
  // さらに保存していた field_report は STEP2 で使った検査器のもので、
  // 20件の中身を表していなかった（見た目は記録されているのに、実体が無い状態）。
  //
  // ★ここで見たいのは1件ずつの良し悪しではなく「偏り」。
  //   20件中3件だけ価格が特殊値、のような形が早く分かれば、
  //   本番へ広げる前に仕様の読み違いへ気付ける。
  // ==================================================================
  const g20 = new ValueGuard(items20.length || 20); // 弾いた値は全件そのまま控える
  let price20 = 0;
  let url20 = 0;
  let img20 = 0;
  for (const it of items20) {
    g20.text('itemId', it?.itemId ?? it?.item_id ?? it?.product_id);
    if (g20.purchaseUrl('itemUrl', it?.itemUrl ?? it?.product_detail_url)) url20++;
    if (g20.imageUrl('image', it?.itemMainPic ?? it?.product_main_image_url)) img20++;
    if (g20.price('salePrice', firstOf(it, PRICE_KEYS))) price20++;
    g20.currency('currency', firstOf(it, CURRENCY_KEYS));
  }
  if (items20.length) {
    console.log(`  商品URLあり ${url20}/${items20.length}件／画像あり ${img20}/${items20.length}件／価格あり ${price20}/${items20.length}件`);
    console.log('\n  ★弾いた値の内訳（全体の取得率に混ぜない）：');
    for (const l of describePriceAnomalies(g20.report())) console.log(l);
    for (const l of describeGuardReport(g20.report())) console.log(l);
  }

  await insert('api_response_samples', {
    id: newId('sample'),
    provider: PROVIDER,
    api_name: s2.apiName,
    sample_kind: 'live_step20',
    redacted_body: safeBody(r20.json),
    // ★20件を検査した結果を保存する（STEP2の検査器を使い回さない）
    field_report: JSON.stringify(g20.report()),
    created_at: nowIso(),
  }).catch(() => {});
  await recordStep({
    no: 7, key: 'SCALE_20', apiName: s2.apiName, outcome: r20.outcome, passed: r20.ok && items20.length > 0,
    note: items20.length
      ? `URL ${url20}／画像 ${img20}／価格 ${price20}（各 ${items20.length}件中）`
      : undefined,
    elapsedMs: r20.elapsed, aliexpressCalls: calls20,
  });

  // ★20件でも「全件同じ理由」を検査する。ここは先へ進む経路が無いので警告として出す。
  haltIfAllSame(g20, '20件');

  console.log('\n=== ここまでの使用量（COST GUARD）===');
  console.log('  ★API が無料でも、回数は必ず数えます（無料＝無制限ではないため）。');
  console.log(`  AliExpress 呼び出し ： 台帳 live_test_steps に1STEPずつ記録済み`);
  console.log(`  Keepa 消費トークン  ： ${keepaTokensConsumed() ?? 'まだ出せません（数えていません）'}`);
  console.log('  OpenAI 使用回数     ： 0回（このテストでは1回も呼びません）');
  console.log('\n次にやること： npm run discovery:kpi ／ npm run api:registry で成績表と段階を確認');
}

main().catch((e) => {
  console.error('\n★想定外のエラーで止まりました（0件としては扱いません）：');
  console.error(scrubKnownSecrets(String(e?.message ?? e), RAW_SECRETS));
  process.exit(1);
});
