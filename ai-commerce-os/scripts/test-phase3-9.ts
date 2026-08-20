/**
 * Phase 3.9（購入ページを開く導線）の受け入れテスト。
 *
 * 【このテストが守っているもの】
 * ユーザーからの指示はこうだった。
 *
 *   「商品一覧には必ず『購入ページを開く』ボタンを付けてください。」
 *
 *   「購入ボタン自体をAIが勝手に押すのはまだ行わず、最終購入だけ人間が
 *     商品ページで確認して行う形が安全です。」
 *
 *   「リンク先をAIが生成してはいけません。取得元データに実際に存在するURLだけ
 *     使用してください。」
 *
 *   「URLが無効な場合は『購入ページを開く』を無効化してください。」
 *
 *   「AUTO_PURCHASE_CAPABLE = true にできる構造だけ準備してください。
 *     （今は実装・有効化しない）」
 *
 *   「APIがあるだけで自動購入可能にしないでください。」
 *
 * この6つが将来なし崩しに戻らないように、次を潰しにいく。
 *
 *   1. AIがURLを組み立てる関数がこっそり足されること
 *   2. 状態が分からないものが「押してよい」既定値になること（Fail Closed の逆）
 *   3. 別の市場のURLが混ざり、違う店の違う商品を開かせること
 *   4. 「たぶん買った」のような曖昧な結果が選択肢に増えること
 *   5. 取り違え（違う商品だった）が理由なしで保存できるようになること
 *   6. 送料不明が 0円 として保存されること
 *   7. 押したときの判断が、あとから現在値で上書きされること
 *   8. 実際に買った記録が SHADOW（買ったつもりの記録）に混ざること
 *   9. 購入・注文・決済・発送の処理やテーブルが紛れ込むこと
 *  10. 9条件が揃っただけで自動購入が有効になること
 */
import { all, one, run, migrate, nowIso } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import {
  URL_SOURCES, URL_SOURCE_JA, URL_STATUSES, URL_STATUS_JA,
  PURCHASE_OUTCOMES, PURCHASE_OUTCOME_JA,
  canOpenPurchasePage, checkProductUrl, isPurchaseOutcome, isUrlSource, isUrlStatus,
  openBlockedReasonJa, outcomeIsSevere, outcomeNeedsNote, urlFreshnessJa,
  VENUE_HOSTS, type PurchaseOutcome, type UrlStatus,
} from '../lib/producturl';
import {
  buyOpportunities, openWithoutOutcome, purchaseLinkSummary,
  recordOpenOutcome, recordPageOpen, setUrlStatus,
} from '../lib/purchaselink';
import {
  AUTO_PURCHASE_CAPABLE, AUTO_PURCHASE_CONDITIONS, autoPurchaseStatusJa, checkAutoPurchase,
  type AutoPurchaseConditionCode,
} from '../lib/autopurchase';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  OK   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  NG   ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n[${title}]`);
}

/** ソースを読む。パスに日本語が入るので URL をそのまま渡す（CLAUDE.md ルール28）。 */
async function src(rel: string): Promise<string> {
  const fs = await import('node:fs');
  return fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
}

/**
 * テスト専用の目印（CLAUDE.md ルール54）。
 * 実在の商品URLを使うと、後片付けで本物のデータを巻き添えにする。
 */
const MARK = 'p39testonly';
const TEST_URL = `https://jp.mercari.com/item/${MARK}0001`;
const TEST_KEY = `jp.mercari.com/item/${MARK}0001`;

/** ユーザー指示17に書かれている9条件。名前を勝手に変えない。 */
const REQUIRED_AP_CONDITIONS: AutoPurchaseConditionCode[] = [
  'VENUE_OFFICIALLY_ALLOWS',
  'FEE_VERIFIED',
  'MATCH_CONFIDENCE_HIGH',
  'DECISION_STRONG_BUY',
  'CONSERVATIVE_ROI_OK',
  'REAL_PRECISION_OK',
  'STOCK_CONFIRMED',
  'WITHIN_BUDGET',
  'ALL_GATES_PASSED',
];

/** ユーザー指示15に書かれている5択。 */
const REQUIRED_OUTCOMES: PurchaseOutcome[] = [
  'PURCHASED', 'PASSED', 'SOLD_OUT', 'PRICE_CHANGED', 'DIFFERENT_ITEM',
];

async function cleanup(): Promise<void> {
  await run(`DELETE FROM real_trade_candidates WHERE listing_key LIKE ?`, [`%${MARK}%`]);
  await run(`DELETE FROM page_open_events WHERE listing_key LIKE ?`, [`%${MARK}%`]);
  await run(`DELETE FROM identity_match_reviews WHERE listing_key LIKE ?`, [`%${MARK}%`]);
  await run(`DELETE FROM tracked_listings WHERE listing_key LIKE ?`, [`%${MARK}%`]);
}

async function main() {
  await migrate();
  await ensureReady();
  await cleanup();

  // ================================================================
  section('1. AIがURLを作らない（取得元に実在するURLだけ使う）');

  const purlSrc = await src('../lib/producturl.ts');
  const plinkSrc = await src('../lib/purchaselink.ts');
  const apSrc = await src('../lib/autopurchase.ts');

  check(
    'URLを組み立てる関数が存在しない',
    !/function\s+(build|make|generate|compose|construct)[A-Za-z]*(Url|URL|Link)/.test(purlSrc)
    && !/function\s+(build|make|generate|compose|construct)[A-Za-z]*(Url|URL|Link)/.test(plinkSrc),
  );
  check(
    'URLの出どころに「AIが作った」という選択肢が無い',
    !URL_SOURCES.some((s) => /AI|GENERATED|GUESS|INFERRED/i.test(s)),
    URL_SOURCES.join('・'),
  );
  check('URLの出どころはちょうど4種類', URL_SOURCES.length === 4);
  check(
    'URLの出どころすべてに日本語の説明がある',
    URL_SOURCES.every((s) => (URL_SOURCE_JA[s] ?? '').length > 0),
  );

  for (const f of ['lib/producturl.ts', 'lib/purchaselink.ts', 'lib/autopurchase.ts']) {
    const s = f.includes('producturl') ? purlSrc : f.includes('purchaselink') ? plinkSrc : apSrc;
    check(
      `${f} は外部サイトへ通信しない`,
      !/\bfetch\s*\(|\baxios\b|\bpuppeteer\b|\bplaywright\b|\bgot\s*\(/.test(s),
    );
    /*
     * 【なぜ「読む」と「使う」を区別するのか】
     * lib/producturl.ts には `if (u.username || u.password) return ng('HAS_CREDENTIALS')`
     * があり、これは **ログイン情報が埋まったURLを弾くための安全装置**。
     * 単純に password という語を禁止すると、この安全装置そのものが不合格になる。
     * 検査するのは「ログイン情報を組み立てる／送る／保存する」書き方だけにする。
     * （安全装置を消すのではなく、検査の方を実態に合わせる＝ルール46と同じ考え方）
     */
    check(
      `${f} はログイン情報を組み立てない・送らない・保存しない`,
      !/\b(login|signin|signIn|logIn)\s*\(/.test(s) &&
        !/\b(password|passwd|pwd)\s*[:=][^=]/i.test(s) &&
        !/document\.cookie|['"]cookie['"]|setCookie|credential_value|api_secret|access_token/i.test(
          s,
        ),
    );
  }

  // ================================================================
  section('2. 分からないものは押させない（Fail Closed）');

  check('商品ページの状態はちょうど4種類', URL_STATUSES.length === 4, URL_STATUSES.join('・'));
  check(
    '「たぶん出品中」のような曖昧な状態を作っていない',
    !URL_STATUSES.some((s) => /PROBABLY|MAYBE|LIKELY/i.test(s)),
  );
  check('押してよいのは ACTIVE だけ', canOpenPurchasePage('ACTIVE') === true);
  for (const s of ['SOLD', 'REMOVED', 'UNKNOWN'] as UrlStatus[]) {
    check(`${URL_STATUS_JA[s]} は押せない`, canOpenPurchasePage(s) === false);
  }
  check(
    '押せない理由が日本語で出る',
    (['SOLD', 'REMOVED', 'UNKNOWN'] as UrlStatus[]).every((s) => (openBlockedReasonJa(s) ?? '').length > 0)
    && openBlockedReasonJa('ACTIVE') === null,
  );

  const schemaSrc = await src('../lib/db/schema.ts');
  check(
    '列の既定値が UNKNOWN（ACTIVE を既定にしていない）',
    /url_status TEXT NOT NULL DEFAULT 'UNKNOWN'/.test(schemaSrc)
    && !/url_status TEXT NOT NULL DEFAULT 'ACTIVE'/.test(schemaSrc),
  );
  check(
    'URLの出どころの既定値は HUMAN_ENTRY',
    /url_source TEXT NOT NULL DEFAULT 'HUMAN_ENTRY'/.test(schemaSrc),
  );
  check('状態を一度も確認していないことが日本語で分かる', urlFreshnessJa(null).includes('一度も'));
  check(
    '最終確認からの経過時間が出る',
    urlFreshnessJa('2026-08-19T00:00:00.000Z', Date.parse('2026-08-20T00:00:00.000Z')).includes('1 日'),
  );

  // ================================================================
  section('3. 違う市場のURLを開かせない');

  check('メルカリの商品URLは通る', checkProductUrl('MERCARI', TEST_URL).ok === true);
  check(
    '市場とURLのホストが食い違うものは通さない',
    checkProductUrl('MERCARI', 'https://www.amazon.co.jp/dp/B00TEST').reason === 'HOST_MISMATCH',
  );
  check(
    '短縮URL・転送URLは通さない',
    checkProductUrl('MERCARI', 'https://bit.ly/abcdef').reason === 'REDIRECTOR',
  );
  check(
    'ログイン情報が入ったURLは通さない',
    checkProductUrl('MERCARI', 'https://user:pw@jp.mercari.com/item/m1').reason === 'HAS_CREDENTIALS',
  );
  check(
    'http／https 以外は通さない',
    checkProductUrl('MERCARI', 'javascript:alert(1)').reason === 'NOT_HTTP'
    || checkProductUrl('MERCARI', 'javascript:alert(1)').reason === 'NOT_A_URL',
  );
  check('空のURLは通さない', checkProductUrl('MERCARI', '').reason === 'EMPTY');
  check(
    '知らない市場は「拒否」ではなく「人の確認へ」',
    checkProductUrl('SOMETHING_NEW', 'https://example.com/x').reason === 'VENUE_UNKNOWN',
  );
  check(
    'ホストの一覧が主要市場ぶん登録されている',
    ['MERCARI', 'AMAZON', 'EBAY', 'SNKRDUNK', 'YAHUOKU', 'KOMEHYO'].every(
      (v) => (VENUE_HOSTS[v] ?? []).length > 0,
    ),
  );
  check(
    'ホストの一覧に「なんでも通す」書き方が無い',
    !Object.values(VENUE_HOSTS).flat().some((h) => h === '' || h.includes('*')),
  );

  // ================================================================
  section('4. 押した記録（開いただけ。買っていない）');

  const now = nowIso();
  await run(
    `INSERT INTO tracked_listings
       (listing_key, venue_code, product_url, product_name, model_number,
        first_observed_at, first_listing_price, latest_listing_price,
        latest_state, data_source, source_class, real_market_data, identifiable,
        url_source, url_status, created_at, updated_at)
     VALUES (?,?,?,?,?, ?,?,?, 'ON_SALE', 'MANUAL', 'SELF_OBSERVED', 1, 1,
             'HUMAN_ENTRY', 'UNKNOWN', ?, ?)`,
    [TEST_KEY, 'MERCARI', TEST_URL, `テスト用商品 ${MARK}`, `${MARK.toUpperCase()}-A`,
      now, 12000, 12000, now, now],
  );

  const beforeStatus = await recordPageOpen(TEST_KEY);
  check('状態が不明なうちは開けない', beforeStatus.ok === false);

  const bad = await setUrlStatus(TEST_KEY, 'NOT_A_STATUS');
  check('でたらめな状態は保存できない', bad.ok === false);

  const setOk = await setUrlStatus(TEST_KEY, 'ACTIVE');
  check('人が確認すれば「出品中」にできる', setOk.ok === true, setOk.message);

  const opened = await recordPageOpen(TEST_KEY);
  check('出品中なら開いた記録を残せる', opened.ok === true && typeof opened.openId === 'number');
  check('返すURLは登録されているURLそのもの', opened.url === TEST_URL);

  const openRow = await one(
    `SELECT * FROM page_open_events WHERE id = ?`, [Number(opened.openId)],
  );
  check('押した時点の価格を凍結している', Number(openRow?.opened_price) === 12000);
  check('押した時点の状態を凍結している', String(openRow?.url_status_at_open) === 'ACTIVE');
  check('押した直後は結果が空', openRow?.outcome === null || openRow?.outcome === undefined);

  // 相場が動いても、押したときの記録は変わらない。
  await run(
    `UPDATE tracked_listings SET latest_listing_price = 30000, updated_at = ? WHERE listing_key = ?`,
    [nowIso(), TEST_KEY],
  );
  const openRow2 = await one(
    `SELECT opened_price FROM page_open_events WHERE id = ?`, [Number(opened.openId)],
  );
  check(
    'あとから値段が変わっても、押したときの判断は書き換わらない',
    Number(openRow2?.opened_price) === 12000,
  );

  const waiting = await openWithoutOutcome(50);
  check(
    '結果がまだ入っていない記録として画面に出る',
    waiting.some((w: any) => Number(w.id) === Number(opened.openId)),
  );

  // ================================================================
  section('5. 開いたあとの結果は5択（曖昧な選択肢を作らない）');

  check('結果はちょうど5種類', PURCHASE_OUTCOMES.length === 5);
  for (const o of REQUIRED_OUTCOMES) {
    check(`指示どおりの選択肢がある：${PURCHASE_OUTCOME_JA[o]}`, isPurchaseOutcome(o));
  }
  check(
    '「たぶん買った」のような曖昧な選択肢が無い',
    !PURCHASE_OUTCOMES.some((o) => /PROBABLY|MAYBE|OTHER|MISC|ETC/i.test(o.code)),
    PURCHASE_OUTCOMES.map((o) => o.code).join('・'),
  );
  check(
    '重大なのは「違う商品だった」だけ',
    PURCHASE_OUTCOMES.filter((o) => o.severe).map((o) => o.code).join(',') === 'DIFFERENT_ITEM',
  );
  check('「違う商品だった」は重大として扱う', outcomeIsSevere('DIFFERENT_ITEM') === true);
  check('「見送った」は重大ではない', outcomeIsSevere('PASSED') === false);
  check('「違う商品だった」は理由が必須', outcomeNeedsNote('DIFFERENT_ITEM') === true);
  check('それ以外は理由が任意', REQUIRED_OUTCOMES.filter((o) => o !== 'DIFFERENT_ITEM')
    .every((o) => outcomeNeedsNote(o) === false));

  const noNote = await recordOpenOutcome({
    openId: Number(opened.openId), outcome: 'DIFFERENT_ITEM', note: '   ',
  });
  check('理由が空だと「違う商品だった」を保存できない', noNote.ok === false, noNote.message);

  const noPrice = await recordOpenOutcome({
    openId: Number(opened.openId), outcome: 'PURCHASED', note: '', actualPrice: null,
  });
  check('「購入した」は実際に払った金額が無いと保存できない', noPrice.ok === false);

  const zeroPrice = await recordOpenOutcome({
    openId: Number(opened.openId), outcome: 'PURCHASED', note: '', actualPrice: 0,
  });
  check('購入価格0円は受け付けない', zeroPrice.ok === false);

  const bought = await recordOpenOutcome({
    openId: Number(opened.openId), outcome: 'PURCHASED', note: '',
    actualPrice: 12000, actualShipping: null,
  });
  check('実際に買った報告は保存できる', bought.ok === true, bought.message);

  const trade = await one(
    `SELECT * FROM real_trade_candidates WHERE open_id = ?`, [Number(opened.openId)],
  );
  check('実購入価格が保存されている', Number(trade?.actual_purchase_price) === 12000);
  check(
    '送料不明を0円として保存していない',
    trade?.actual_shipping_cost === null || trade?.actual_shipping_cost === undefined,
  );

  // 同じ記録に2回報告しても、行が増えない（二重計上しない）。
  await recordOpenOutcome({
    openId: Number(opened.openId), outcome: 'PURCHASED', note: '',
    actualPrice: 12500, actualShipping: 800,
  });
  const tradeCount = await one(
    `SELECT COUNT(*) AS n FROM real_trade_candidates WHERE open_id = ?`, [Number(opened.openId)],
  );
  check('同じ記録に2回報告しても行が増えない', Number(tradeCount?.n ?? 0) === 1);

  // ================================================================
  section('6. 人の答えで機械の判定を上書きしない（Phase 3.8 のルール49）');

  const idBefore = await one(
    `SELECT identity_key FROM tracked_listings WHERE listing_key = ?`, [TEST_KEY],
  );
  await run(
    `INSERT INTO page_open_events
       (listing_key, venue_code, product_url, url_source, url_status_at_open, opened_at, created_at)
     VALUES (?,?,?, 'HUMAN_ENTRY', 'ACTIVE', ?, ?)`,
    [TEST_KEY, 'MERCARI', TEST_URL, nowIso(), nowIso()],
  );
  const second = await one(
    `SELECT id FROM page_open_events WHERE listing_key = ? ORDER BY id DESC LIMIT 1`, [TEST_KEY],
  );
  const diff = await recordOpenOutcome({
    openId: Number(second?.id), outcome: 'DIFFERENT_ITEM', note: '色が違った（黒ではなく紺）',
  });
  check('理由を書けば「違う商品だった」を保存できる', diff.ok === true);
  const idAfter = await one(
    `SELECT identity_key FROM tracked_listings WHERE listing_key = ?`, [TEST_KEY],
  );
  check(
    '「違う商品だった」でも機械の判定（identity_key）を書き換えない',
    String(idBefore?.identity_key ?? '') === String(idAfter?.identity_key ?? ''),
  );

  const sum = await purchaseLinkSummary();
  check('取り違えを重大として数えている', sum.severeCount >= 1);
  check('取り違えがあるときは次へ進まないと書いてある', sum.verdictJa.includes('進みません'));

  // 取り違えが記録された出品は、もう開かせない。
  await run(
    `INSERT INTO identity_match_reviews (listing_key, matched_venue_code, verdict, reviewer, note, reviewed_at)
     VALUES (?, 'AMAZON', 'INCORRECT_MATCH', 'phase3-9-test', '色違い', ?)`,
    [TEST_KEY, nowIso()],
  );
  const afterBad = await recordPageOpen(TEST_KEY);
  check('「違う商品だった」と分かった出品は開けなくなる', afterBad.ok === false, afterBad.message);

  const opps = await buyOpportunities(200);
  const mine = opps.find((o) => o.listingKey === TEST_KEY);
  check('画面の一覧にも「開けない」として出る', mine !== undefined && mine.canOpen === false);
  check('取り違えの印が画面に渡っている', mine?.hasIncorrectMatch === true);

  // ================================================================
  section('7. 買っていないものを「買った」と数えない（SHADOWと分ける）');

  check(
    '実購入の記録は SHADOW と別のテーブルに置いている',
    /CREATE TABLE IF NOT EXISTS real_trade_candidates/.test(schemaSrc)
    && !/route_shadow_trades[\s\S]{0,200}actual_purchase_price/.test(schemaSrc),
  );
  const shadowCols = await all(`PRAGMA table_info(route_shadow_trades)`);
  check(
    'SHADOW のテーブルに実購入価格の列を足していない',
    !shadowCols.some((c: any) => /actual_purchase_price|purchased_at/.test(String(c.name))),
  );

  // ================================================================
  section('8. 購入・注文・決済・発送の処理が存在しない');

  const actionsSrc = await src('../app/actions.ts');
  check(
    '購入・出品・発送・決済を実行するサーバー処理が無い',
    !/export async function (buy|purchase|listItem|ship|checkout|pay)[A-Za-z]*Action/i.test(actionsSrc),
  );
  check(
    '「購入ページを開く」はURLへ通信していない',
    !/fetch\s*\([^)]*product_url|fetch\s*\([^)]*productUrl/.test(plinkSrc),
  );

  const tables = (await all(
    `SELECT name FROM sqlite_master WHERE type='table'`,
  )).map((r: any) => String(r.name));
  check(
    '実行系（注文・決済・発送・カート）のテーブルが存在しない',
    !tables.some((t) => /^(orders|purchases|payments|shipments|checkouts|carts)$/i.test(t)),
  );
  check(
    '購入・注文・決済・発送を思わせる名前のテーブルを作っていない（ルール46）',
    !tables.some((t) => /purchase|order|payment|listing_publish|shipment/i.test(t)),
    tables.filter((t) => /purchase|order|payment|shipment/i.test(t)).join('・') || 'なし',
  );
  check('押した記録のテーブル名は page_open_events', tables.includes('page_open_events'));

  const openPageSrc = await src('../app/buy/OpenPurchaseLink.tsx');
  check(
    '画面のリンクはURLを組み立てず、渡されたURLをそのまま使う',
    /href=\{url\}/.test(openPageSrc) && !/href=\{`/.test(openPageSrc),
  );
  check('新しいタブで開く（今の画面を乗っ取らない）', /target="_blank"/.test(openPageSrc));
  check('開いた先からこの画面を操作できないようにしている', /rel="noopener noreferrer"/.test(openPageSrc));

  const buyPageSrc = await src('../app/buy/page.tsx');
  check(
    '画面に「買うのはご自身です」と書いてある',
    /買うのはご自身です|ご自身が判断/.test(buyPageSrc),
  );
  check(
    '出せない数字（利益・ROI）をでっち上げていない',
    !/expected_net_profit|conservativeRoi|routeScore/.test(buyPageSrc),
  );

  // ================================================================
  section('9. 自動購入は「構造だけ」（今は有効にしない）');

  check('自動購入はいま不可', AUTO_PURCHASE_CAPABLE === false);
  check('条件はちょうど9つ', AUTO_PURCHASE_CONDITIONS.length === 9);
  for (const c of REQUIRED_AP_CONDITIONS) {
    check(`指示どおりの条件がある：${c}`, AUTO_PURCHASE_CONDITIONS.some((x) => x.code === c));
  }
  check(
    'すべての条件に「なぜ必要か」が書いてある',
    AUTO_PURCHASE_CONDITIONS.every((c) => c.ja.length > 0 && c.why.length > 0),
  );

  const none = checkAutoPurchase({});
  check('何も渡さなければ9つとも不足（Fail Closed）', none.failed.length === 9 && none.passed.length === 0);
  check('何も渡さなければ自動購入しない', none.capable === false);

  const partial = checkAutoPurchase({ DECISION_STRONG_BUY: true, WITHIN_BUDGET: true });
  check('一部だけ満たしても不可', partial.capable === false && partial.failed.length === 7);

  const allTrue = Object.fromEntries(
    REQUIRED_AP_CONDITIONS.map((c) => [c, true]),
  ) as Record<AutoPurchaseConditionCode, boolean>;
  const full = checkAutoPurchase(allTrue);
  check('9つすべて満たしても、いまは自動購入しない', full.capable === false);
  check('その理由が日本語で書いてある', full.verdictJa.includes('有効にしません'));

  /*
   * 【なぜコメントを外してから調べるのか】
   * lib/autopurchase.ts の冒頭には、ユーザー指示17の原文
   * 「将来的に AUTO_PURCHASE_CAPABLE = true にできる構造だけ準備してください」
   * がそのまま引用してある。これは**指示の記録**であって、実行されるコードではない。
   * 文字列だけで探すと、この引用が「近道を作っている」と誤判定される。
   * 指示の原文をファイルから消すのは本末転倒なので、検査の方をコード部分に限定する。
   */
  const apCode = apSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check(
    '「APIがあるから自動購入可」という近道を作っていない',
    !/capable\s*=\s*true/.test(apCode) && !/AUTO_PURCHASE_CAPABLE\s*=\s*true/.test(apCode),
  );
  check(
    '環境変数で自動購入を有効にできない',
    !/process\.env/.test(apSrc),
  );
  check('画面に出す一行が「未実装」と言い切っている', autoPurchaseStatusJa().includes('未実装'));
  check(
    '最終購入は人が行うと画面の一行に書いてある',
    autoPurchaseStatusJa().includes('ご自身'),
  );

  // ================================================================
  section('10. 市場ごとの接続状況は、確認できたものだけ CONNECTED');

  const vcCols = (await all(`PRAGMA table_info(venue_connectors)`)).map((c: any) => String(c.name));
  check('市場接続状況のテーブルがある', vcCols.length > 0);
  for (const col of ['venue_code', 'operation', 'access_method', 'state',
    'terms_source_url', 'terms_verified_at', 'verified_by']) {
    check(`接続状況に ${col} の欄がある`, vcCols.includes(col));
  }
  check(
    '既定は「まだ調べていない」（CONNECTED を既定にしていない）',
    /state TEXT NOT NULL DEFAULT 'NOT_RESEARCHED'/.test(schemaSrc)
    && !/state TEXT NOT NULL DEFAULT 'CONNECTED'/.test(schemaSrc),
  );
  check(
    '取得手段の既定は「人が見て記録」',
    /access_method TEXT NOT NULL DEFAULT 'MANUAL_OBSERVATION'/.test(schemaSrc),
  );
  check(
    '認証情報そのものではなく、置き場所の名前だけを持つ',
    /credential_key/.test(schemaSrc) && !/credential_value|api_secret|access_token/.test(schemaSrc),
  );
  const connected = await all(
    `SELECT venue_code FROM venue_connectors WHERE state = 'CONNECTED'`,
  );
  check(
    'いま CONNECTED の市場は0件（調査で確認できたものが無いため）',
    connected.length === 0,
    connected.map((r: any) => String(r.venue_code)).join('・') || '0件',
  );

  // ================================================================
  section('11. 後片付け');

  await cleanup();
  const leftover = await one(
    `SELECT COUNT(*) AS n FROM tracked_listings WHERE listing_key LIKE ?`, [`%${MARK}%`],
  );
  check('テスト用に入れた行を残していない', Number(leftover?.n ?? 0) === 0);
  const leftover2 = await one(
    `SELECT COUNT(*) AS n FROM page_open_events WHERE listing_key LIKE ?`, [`%${MARK}%`],
  );
  check('テスト用の押した記録も残していない', Number(leftover2?.n ?? 0) === 0);

  // ================================================================
  const fin = await purchaseLinkSummary();
  console.log(`\n${'='.repeat(72)}`);
  console.log('【現状の正直な数字】');
  console.log(`  いま開ける候補：${fin.openableNow}件`);
  console.log(`  状態が未確認のまま：${fin.unknownStatus}件`);
  console.log(`  開いた回数：${fin.opened}件（結果記入済み ${fin.answered}件）`);
  console.log(`  実際に買ったと報告：${fin.purchasedCount}件`);
  console.log(`  違う商品だった：${fin.severeCount}件`);
  console.log(`  自動購入：${AUTO_PURCHASE_CAPABLE ? '可' : '未実装'}`);
  console.log('='.repeat(72));

  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.9（購入ページを開く導線）の受け入れ条件をすべて満たしています。');
  console.log('※ リンク先のURLはAIが作りません。取得元に実在するURLだけを使います。');
  console.log('※ 状態を確認していない商品ページは開けません（既定は「不明」）。');
  console.log('※ 購入・注文・決済・発送・自動ログインは、いまも未実装です。');
  console.log('※ 自動購入は9条件が揃っても有効になりません（この段階では実装しない方針のため）。');
}

main().catch((e) => { console.error(e); process.exit(1); });
