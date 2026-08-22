/**
 * Phase 3.9b（市場ごとの「許可」を8項目に分ける／Connector優先順位）の受け入れテスト。
 *
 * 【このテストが生まれた理由】
 * わたし（Claude）は前回、Yahoo!ショッピングについてこう判断した。
 *
 *   公式ヘルプに「原則 非商用」と書いてある → **使えない**
 *
 * ユーザーからの指摘：
 *
 *   「Yahoo!については『原則非商用だから使えない』と確定させるのはまだ早いです。」
 *   「Yahoo = PROHIBITED ではなく、Yahoo = APPLICATION /
 *     COMMERCIAL_USE_CONFIRMATION_REQUIRED くらいが適切です。」
 *   「`YAHOO_SHOPPING` と `YAHOO_AUCTIONS` を同じVenueとして扱わないでください。」
 *   「UNKNOWN項目を勝手に加点しないこと。」
 *   「SP-APIで取得できるからといって、すべてのAmazon市場データを自由に
 *     リサーチできるとは判断しないこと。」
 *   「最初の自動Connectorは『一番簡単』ではなく『一番価値がある』を選んでください。」
 *
 * つまり間違いの正体は「**確認していないもの**」を「**禁止**」と書いたことだった。
 * 逆向き（禁止と書かれていないから許可）と同じくらい危ない。
 *
 * だから次が将来なし崩しに戻らないように潰しにいく。
 *
 *   1. 「使える／使えない」の2択に戻ること（3分類が消えること）
 *   2. UNKNOWN が既定で YES 側に倒れること
 *   3. UNKNOWN に点が付くこと
 *   4. 同じ会社の別サービスが1つにまとめられること（Amazonの3つ／Yahoo!の2つ）
 *   5. 技術点だけ高い市場が、合計点の高さで第1接続先に選ばれること
 *   6. 第1自動市場が、人に相談されないまま確定すること
 *   7. 「調べていない」が「0件の問題」として画面に出ること
 */
import { all, one, migrate } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import {
  ACCESS_METHODS, CONNECTOR_STATES, CONNECTOR_STATE_JA,
  FIRST_LIVE_CONNECTOR, FIRST_LIVE_CONNECTOR_STATUS_JA,
  GATE_AXES, PERMISSION_FIELDS, PERMISSION_FIELD_JA, PERMISSION_VALUE_JA,
  SCORE_AXES, USAGE_VERDICTS, USAGE_VERDICT_JA, VENUE_RESEARCH,
  gateReasonJa, passesGate, priorityScore, rankedResearch,
  type PermissionField, type PermissionValue,
} from '../lib/venuepermissions';
import {
  connectorRanking, countUnknownPermissions, ensureConnectorResearch,
  mayStartAutoCollection, scoreBreakdown,
} from '../lib/connectors/permissions';
import { listVenues } from '../lib/venues';

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

/** ユーザー指示4に書かれている8項目。名前を勝手に変えない。 */
const REQUIRED_PERMISSION_FIELDS: PermissionField[] = [
  'api_exists',
  'commercial_use_allowed',
  'internal_business_use_allowed',
  'price_analysis_allowed',
  'data_storage_allowed',
  'automated_collection_allowed',
  'automated_purchase_allowed',
  'automated_listing_allowed',
];

const VALUES: PermissionValue[] = ['YES', 'NO', 'UNKNOWN'];

async function main(): Promise<void> {
  console.log('Phase 3.9b 受け入れテスト（許可の8項目とConnector優先順位）');
  console.log('='.repeat(72));
  await migrate();
  await ensureReady();
  await ensureConnectorResearch();

  const schemaSrc = await src('../lib/db/schema.ts');
  const vocabSrc = await src('../lib/venuepermissions.ts');
  const permSrc = await src('../lib/connectors/permissions.ts');
  const venuesSrc = await src('../lib/venues.ts');

  // ================================================================
  section('1. 許可を8項目に分けて持っている（ユーザー指示4）');

  check('8項目そろっている', PERMISSION_FIELDS.length === 8, `${PERMISSION_FIELDS.length}項目`);
  for (const f of REQUIRED_PERMISSION_FIELDS) {
    check(`${f} がある`, (PERMISSION_FIELDS as readonly string[]).includes(f));
    check(`${f} に日本語の説明がある`, (PERMISSION_FIELD_JA[f] ?? '').length > 0);
  }
  check('値は YES / NO / UNKNOWN の3つだけ', VALUES.every((v) => (PERMISSION_VALUE_JA[v] ?? '') !== ''));

  const vcCols = (await all(`PRAGMA table_info(venue_connectors)`)).map((c: any) => String(c.name));
  for (const f of REQUIRED_PERMISSION_FIELDS) {
    check(`データベースに ${f} の欄がある`, vcCols.includes(f));
  }
  check('3分類（usage_verdict）の欄がある', vcCols.includes('usage_verdict'));
  check('サービス単位と市場を結びつける欄（venue_ref）がある', vcCols.includes('venue_ref'));
  check('採点結果を残す欄がある', vcCols.includes('priority_score') && vcCols.includes('priority_score_json'));
  check('分かっていないことの一覧を残す欄がある', vcCols.includes('unknowns_json'));
  check('成約価格が取れるかを、価格とは別の欄で持っている', vcCols.includes('sold_data_available'));

  // ================================================================
  section('2. 既定は「まだ分からない」（UNKNOWN を YES 側に倒さない）');

  for (const f of REQUIRED_PERMISSION_FIELDS) {
    check(
      `${f} の既定値が UNKNOWN`,
      new RegExp(`ADD COLUMN ${f} TEXT NOT NULL DEFAULT 'UNKNOWN'`).test(schemaSrc),
    );
  }
  check(
    '既定値に YES を使っていない',
    !/ADD COLUMN \w*allowed \w*TEXT NOT NULL DEFAULT 'YES'/.test(schemaSrc)
    && !/DEFAULT 'ALLOWED'/.test(schemaSrc),
  );
  check(
    '3分類の既定は「まだ確認していない」',
    /ADD COLUMN usage_verdict TEXT NOT NULL DEFAULT 'CONFIRMATION_REQUIRED'/.test(schemaSrc),
  );
  check(
    '既定を CONFIRMED_ALLOWED にしていない',
    !/DEFAULT 'CONFIRMED_ALLOWED'/.test(schemaSrc),
  );
  /*
   * 【なぜ点数の欄に DEFAULT を付けないのか】
   * 事業Vault/DIGEST.md の原則：「本当に0点だった」と「まだ採点していない」を混ぜない。
   * DEFAULT 0 を付けると、採点前の行が「0点の市場」と見分けられなくなる。
   */
  check(
    '点数の欄に DEFAULT 0 を付けていない',
    /ADD COLUMN priority_score INTEGER`/.test(schemaSrc)
    && !/ADD COLUMN priority_score INTEGER NOT NULL DEFAULT 0/.test(schemaSrc),
  );

  // ================================================================
  section('3. 「使える／使えない」の2択にしていない（ユーザー指示1の訂正）');

  check('3分類がある', USAGE_VERDICTS.length === 3);
  check('「まだ確認していない」がある', (USAGE_VERDICTS as readonly string[]).includes('CONFIRMATION_REQUIRED'));
  check(
    '「まだ確認していない」の説明が、禁止ではないと言い切っている',
    USAGE_VERDICT_JA.CONFIRMATION_REQUIRED.includes('禁止という意味ではない'),
  );
  check(
    '状態に COMMERCIAL_USE_CONFIRMATION_REQUIRED がある',
    (CONNECTOR_STATES as readonly string[]).includes('COMMERCIAL_USE_CONFIRMATION_REQUIRED'),
  );
  check(
    'その状態の説明に「APIはある」と書いてある',
    CONNECTOR_STATE_JA.COMMERCIAL_USE_CONFIRMATION_REQUIRED.includes('APIはある'),
  );

  const yahooShop = VENUE_RESEARCH.find((r) => r.connector_code === 'YAHOO_SHOPPING');
  check('Yahoo!ショッピングを調査済み', !!yahooShop);
  check(
    '★Yahoo!ショッピングを PROHIBITED にしていない',
    yahooShop?.state !== 'PROHIBITED' && yahooShop?.verdict !== 'CONFIRMED_PROHIBITED',
    `state=${yahooShop?.state} / verdict=${yahooShop?.verdict}`,
  );
  check(
    'Yahoo!ショッピングの状態が「商用可否の確認待ち」になっている',
    yahooShop?.state === 'COMMERCIAL_USE_CONFIRMATION_REQUIRED',
  );
  check('Yahoo!ショッピングのAPIは現役だと記録している', yahooShop?.permissions.api_exists === 'YES');
  check(
    'Yahoo!ショッピングの商用可否は UNKNOWN（NO ではない）',
    yahooShop?.permissions.commercial_use_allowed === 'UNKNOWN',
  );
  check(
    'Yahoo!ショッピングは商品ページURLが公式に取れると記録している',
    (yahooShop?.scores.url ?? 0) === 10,
  );
  check(
    '★Yahoo!ショッピングの成約価格は「取れない」と確認済み（UNKNOWNで濁していない）',
    yahooShop?.sold_data === 'NO',
  );
  check(
    'Yahoo!ショッピングのRate Limitの矛盾を、矛盾したまま残している',
    (yahooShop?.rate_limit_note ?? '').includes('矛盾')
    && (yahooShop?.rate_limit_note ?? '').includes('一番厳しい'),
  );

  // ================================================================
  section('4. 同じ会社の別サービスを1つにまとめていない（ユーザー指示3・10）');

  const yahooAuc = VENUE_RESEARCH.find((r) => r.connector_code === 'YAHOO_AUCTIONS');
  check('ヤフオク!を別のConnectorとして調査している', !!yahooAuc);
  check(
    '★Yahoo!ショッピングとヤフオク!の結論が別になっている',
    yahooShop?.state !== yahooAuc?.state,
    `ショッピング=${yahooShop?.state} / ヤフオク=${yahooAuc?.state}`,
  );
  check('ヤフオク!のAPIは提供終了と記録している', yahooAuc?.permissions.api_exists === 'NO');
  check(
    'ヤフオク!とYahoo!ショッピングは、市場としても別の行になっている',
    yahooShop?.venue_ref !== yahooAuc?.venue_ref,
  );

  const venues = await listVenues();
  const codes = venues.map((v) => v.code);
  check('市場一覧に YAHOO_SHOPPING がある', codes.includes('YAHOO_SHOPPING'));
  check('市場一覧に YAHUOKU（ヤフオク!）がある', codes.includes('YAHUOKU'));
  check(
    '2つを同じ行にまとめていない',
    codes.filter((c) => c === 'YAHOO_SHOPPING' || c === 'YAHUOKU').length === 2,
  );
  check(
    '★ヤフオク!を「市場として使えない」扱いにしていない（止まっているのは自動取得だけ）',
    venues.find((v) => v.code === 'YAHUOKU')?.terms_status !== 'BLOCKED',
  );

  const amazonRows = VENUE_RESEARCH.filter((r) => r.venue_ref === 'AMAZON');
  check('★Amazonを1つにまとめていない', amazonRows.length >= 3, `${amazonRows.length}サービス`);
  const sp = VENUE_RESEARCH.find((r) => r.connector_code === 'AMAZON_SP_API');
  const creators = VENUE_RESEARCH.find((r) => r.connector_code === 'AMAZON_CREATORS_API');
  check('SP-API と Creators API の結論が別になっている', sp?.verdict !== creators?.verdict);
  check(
    '★Creators API は禁止と確認できている（技術点が高くても使わない）',
    creators?.verdict === 'CONFIRMED_PROHIBITED',
  );
  check(
    '★SP-APIで「Amazon以外で売るための仕入判断に使えるか」は UNKNOWN のままにしてある',
    sp?.permissions.price_analysis_allowed === 'UNKNOWN',
  );
  /*
   * ★2026-08-22 この2件は検査の中身を書き換えた（ルール64）。
   *   もとは「Keepaの話が未確認欄に残っているか」「商品ページURLの件が未確認欄に残っているか」
   *   を見ていた。2026-08-22 に公式本文（AUP日本語版・カタログAPI仕様）を実際に開いて
   *   2件とも確定させたので、未確認欄にあることを合格条件にしたままだと
   *   「ちゃんと調べて確定させると不合格になる」という逆さまの検査になる。
   *   そこで「未確認に残っているか」ではなく「確定した結果が原文つきで記録されているか」を見る。
   *   ★確定した＝安全になった、ではない。2件とも結論は当社に不利な内容。
   */
  check(
    '★Keepa併用の結論が、規約の原文つきで記録されている',
    (sp?.note ?? '').includes('Keepa') && (sp?.note ?? '').includes('AUP 4.3'),
  );
  check(
    '★カタログAPIが商品ページURLを返さないことが記録されている',
    (sp?.note ?? '').includes('商品ページURLを返さない'),
  );
  check(
    '★URLが取れないと分かっても、ASINからURLを組み立てる逃げ道を作っていない',
    (sp?.scores.url ?? -1) === 0,
  );
  check(
    '調べても公式に書かれていなかったものは、未確認のまま残してある',
    (sp?.unknowns ?? []).length > 0,
  );

  // ================================================================
  section('5. UNKNOWN に点を付けていない（ユーザー指示8）');

  check('観点は10個', SCORE_AXES.length === 10);
  for (const r of VENUE_RESEARCH) {
    const s = priorityScore(r);
    check(`${r.connector_code} の合計点が0〜100に収まっている`, s >= 0 && s <= 100, `${s}点`);
  }
  /*
   * 「商用に使ってよいか」が UNKNOWN なのに、その観点に点が入っていたら、
   * 分からないことを分かったことにしている。
   */
  for (const r of VENUE_RESEARCH) {
    if (r.permissions.commercial_use_allowed === 'UNKNOWN') {
      check(`${r.connector_code}：商用可否が未確認なので商用の点は0`, r.scores.commercial === 0);
    }
    if (r.permissions.data_storage_allowed === 'UNKNOWN') {
      check(`${r.connector_code}：保存可否が未確認なので保存の点は0`, r.scores.storage === 0);
    }
    if (r.permissions.internal_business_use_allowed === 'UNKNOWN') {
      check(`${r.connector_code}：社内利用が未確認なので社内利用の点は0`, r.scores.internal === 0);
    }
  }
  check(
    'ソースに「UNKNOWNは0点」と書いてある（あとから読む人が迷わない）',
    /UNKNOWN に点を与えない|UNKNOWN は/.test(vocabSrc),
  );

  // ================================================================
  section('6. 技術点だけ高い市場を、点数順で選ばない（Gate）');

  check('Gateの観点は「使ってよいか」の4つ', GATE_AXES.length === 4);
  check(
    'Gateに商用・社内利用・価格判断・保存が入っている',
    GATE_AXES.includes('commercial') && GATE_AXES.includes('internal')
    && GATE_AXES.includes('analysis') && GATE_AXES.includes('storage'),
  );
  check('★Creators API はGateを通らない', creators ? !passesGate(creators) : false);
  check(
    'Creators API に、通らない理由が日本語で付いている',
    creators ? (gateReasonJa(creators) ?? '').length > 0 : false,
  );
  check('★Yahoo!ショッピングもいまはGateを通らない', yahooShop ? !passesGate(yahooShop) : false);
  check('SP-API はGateを通る', sp ? passesGate(sp) : false);

  const ranked = rankedResearch();
  const firstGatePass = ranked.findIndex((r) => passesGate(r));
  check('★並び順で、Gateを通った市場が一番上に来る', firstGatePass === 0);
  const creatorsIdx = ranked.findIndex((r) => r.connector_code === 'AMAZON_CREATORS_API');
  const spIdx = ranked.findIndex((r) => r.connector_code === 'AMAZON_SP_API');
  check('★Creators API が SP-API より上に来ない', spIdx < creatorsIdx);

  // ================================================================
  section('7. 1つでも分からないことが残っていたら、自動取得を始めない');

  for (const r of VENUE_RESEARCH) {
    const may = mayStartAutoCollection(r);
    check(`${r.connector_code}：いま自動取得を始めない`, may.ok === false,
      may.ok ? '（始められる判定になっている）' : may.reasonJa);
  }
  check(
    '禁止と確認できた市場は、理由に「禁止」と出る',
    creators ? (mayStartAutoCollection(creators) as any).reasonJa.includes('禁止') : false,
  );

  // ================================================================
  section('8. 接続状況は、確認できたものだけ CONNECTED');

  const connected = await all(`SELECT venue_code FROM venue_connectors WHERE state = 'CONNECTED'`);
  check(
    'いま CONNECTED の市場は0件（1件も取得していないため）',
    connected.length === 0,
    connected.map((r: any) => String(r.venue_code)).join('・') || '0件',
  );
  const rows = await all(`SELECT * FROM venue_connectors ORDER BY venue_code, operation`);
  check('調査結果がデータベースに入っている', rows.length >= VENUE_RESEARCH.length * 2, `${rows.length}行`);
  check(
    'すべての行に出典URLと確認日と確認者が入っている',
    rows.every((r: any) => r.terms_source_url && r.terms_verified_at && r.verified_by),
  );
  check(
    'すべての行が、どの市場の話か分かるようになっている',
    rows.every((r: any) => String(r.venue_ref ?? '').length > 0),
  );
  /* 何度実行しても増えない・変わらないこと。調査をやり直したとき古い判定が残ると危ない。 */
  const before = rows.length;
  await ensureConnectorResearch();
  const after = (await all(`SELECT COUNT(*) AS n FROM venue_connectors`))[0];
  check('2回実行しても行が増えない', Number((after as any).n) === before);

  // ================================================================
  section('9. 「調べていない」を「問題なし」と表示しない');

  const ranking = connectorRanking();
  check('画面用の並びが作れる', ranking.length === VENUE_RESEARCH.length);
  check(
    'Yahoo!ショッピングに未確認の件数が出る（0件と言わない）',
    (ranking.find((r) => r.connector_code === 'YAHOO_SHOPPING')?.unknown_count ?? 0) > 0,
  );
  check(
    'SP-APIにも未確認の件数が出る',
    (ranking.find((r) => r.connector_code === 'AMAZON_SP_API')?.unknown_count ?? 0) > 0,
  );
  check(
    '採点の内訳を人間向けに出せる（なぜその点かを追える）',
    sp ? scoreBreakdown(sp).length === 10 : false,
  );
  check(
    '未確認の項目数を数える関数がある',
    yahooShop ? countUnknownPermissions(yahooShop) > 0 : false,
  );

  // ================================================================
  section('10. 第1自動市場を、人に相談しないまま確定していない');

  check('★第1自動市場はまだ決めていない', FIRST_LIVE_CONNECTOR === null);
  check(
    '画面の一行が「未確定」と言い切っている',
    FIRST_LIVE_CONNECTOR_STATUS_JA.includes('未確定'),
  );
  /*
   * ★2026-08-22 検査の中身を書き換えた（ルール64）。
   *   もとは「月額費用の話が書いてあるか」を見ていた。2026-08-22 に
   *   大口出品が契約済みだと分かり、追加費用が発生しないことが事実になったため、
   *   「月額費用」という言葉を必ず書かせる検査は、事実に反する文を強制することになる。
   *   ★ただし「費用の話が消えた＝黙っていい」ではない。
   *     費用の状況（契約済みで追加費用なし）を明示することを合格条件にする。
   *     金の話を画面から消させないという元の意図はそのまま残す。
   */
  check(
    'その一行に、費用がどうなっているかが書いてある',
    FIRST_LIVE_CONNECTOR_STATUS_JA.includes('大口出品')
      && FIRST_LIVE_CONNECTOR_STATUS_JA.includes('費用'),
  );
  check(
    '★費用が無くなったことを、進めてよい理由にしていない（別の論点を書いている）',
    FIRST_LIVE_CONNECTOR_STATUS_JA.includes('AUP 4.3')
      && FIRST_LIVE_CONNECTOR_STATUS_JA.includes('商品ページURL'),
  );
  check(
    'その一行に、既存サービス（Keepa）への影響が書いてある',
    FIRST_LIVE_CONNECTOR_STATUS_JA.includes('Keepa'),
  );
  check(
    'その一行が「ご本人と一緒に決める」と書いてある',
    FIRST_LIVE_CONNECTOR_STATUS_JA.includes('一緒に決めます'),
  );

  // ================================================================
  section('11. 相手のサイトを勝手に叩く近道を作っていない');

  for (const [f, s] of [['lib/venuepermissions.ts', vocabSrc], ['lib/connectors/permissions.ts', permSrc]] as const) {
    check(`${f} に通信処理が入っていない`, !/\bfetch\s*\(|axios|puppeteer|playwright|cheerio/.test(s));
    check(`${f} にログイン情報を組み立てる処理が入っていない`,
      !/\b(login|signin)\s*\(/i.test(s) && !/\b(password|passwd|pwd)\s*[:=][^=]/i.test(s));
  }
  /*
   * 【なぜコメントを外してから調べるのか】
   * このファイルには、ユーザー指示の原文や規約の引用がそのまま書いてある。
   * 文字列だけで探すと、その引用が「近道を作っている」と誤判定される。
   * 引用を消すのは本末転倒なので、検査の方をコード部分に限定する（ルール64）。
   */
  const vocabCode = vocabSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check(
    '「APIがあるから使ってよい」という近道を作っていない',
    !/commercial_use_allowed\s*:\s*'YES'\s*,?\s*\/\/\s*api/i.test(vocabCode)
    && !/if\s*\(\s*r\.permissions\.api_exists\s*===\s*'YES'\s*\)\s*return\s+true/.test(vocabCode),
  );
  check(
    '市場ファイルに「自動取得できない＝市場として使えない」と書き換えた跡がない',
    /terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',[\s\S]{0,200}ヤフオク/.test(venuesSrc)
    || /ヤフオク[\s\S]{0,600}terms_status: 'UNVERIFIED'/.test(venuesSrc),
  );

  // ================================================================
  section('12. 取得手段の分類が7段階のまま');

  check('取得手段は7段階', ACCESS_METHODS.length === 7);
  check(
    '事業者提供のCSVと、自分で見て記録したものを分けている',
    (ACCESS_METHODS as readonly string[]).includes('OFFICIAL_CSV')
    && (ACCESS_METHODS as readonly string[]).includes('MANUAL_OBSERVATION'),
  );
  check('状態は10種類（商用可否の確認待ちを足した）', CONNECTOR_STATES.length === 10);

  // ================================================================
  const gatePassed = VENUE_RESEARCH.filter((r) => passesGate(r));
  const prohibited = VENUE_RESEARCH.filter((r) => r.verdict === 'CONFIRMED_PROHIBITED');
  const totalUnknown = VENUE_RESEARCH.reduce(
    (n, r) => n + countUnknownPermissions(r) + r.unknowns.length, 0,
  );
  console.log(`\n${'='.repeat(72)}`);
  console.log('【現状の正直な数字】');
  console.log(`  調査した接続先：${VENUE_RESEARCH.length}件`);
  console.log(`  候補にできる（Gate通過）：${gatePassed.length}件 — ${gatePassed.map((r) => r.name).join('・') || 'なし'}`);
  console.log(`  禁止と確認できた：${prohibited.length}件`);
  console.log(`  いま自動でデータを取っている市場：0件`);
  console.log(`  まだ分かっていないこと：${totalUnknown}件`);
  console.log(`  第1自動市場：${FIRST_LIVE_CONNECTOR ?? '未確定（ご本人と一緒に決める）'}`);
  console.log('='.repeat(72));

  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.9b（許可の8項目とConnector優先順位）の受け入れ条件をすべて満たしています。');
  console.log('※ Yahoo!ショッピングは「禁止」ではなく「商用に使ってよいかを確認中」です。');
  console.log('※ Yahoo!ショッピングとヤフオク!、Amazonの3つのAPIは、それぞれ別に扱っています。');
  console.log('※ 分からなかった項目には点を付けていません（0点です）。');
  console.log('※ 大口出品は契約済みのため、Amazon SP-API に追加費用はかかりません（2026-08-22 確認）。');
  console.log('※ ただし規約本文を読んだ結果、Keepaを併用できなくなること・商品ページURLが取れないことが確定しました。');
  console.log('※ 第1自動市場は、この2点をご本人が判断してから決めます。');
}

main().catch((e) => { console.error(e); process.exit(1); });
