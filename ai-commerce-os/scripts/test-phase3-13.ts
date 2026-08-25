/**
 * Phase 3.13（画像の読み取り／需要の材料を分けて持つ）の受け入れテスト。
 *
 * ------------------------------------------------------------------
 * 【このテストは Keepa へ一切アクセスしない】
 * 使うのは偽の応答オブジェクトだけ。APIキーが無くても最後まで通る。
 *
 * ------------------------------------------------------------------
 * 【ここで潰しておきたい将来の事故】
 *
 *   1. 画像が読めないのに「Keepaに画像が無い」で片づけられる（自分のバグが市場のせいになる）
 *   2. 旧名 `imagesCSV` から黙って読んで、仕様が古いことに誰も気づかない
 *   3. Keepaの月間購入回数を「実測販売数」と呼び始める
 *   4. 3つの需要の材料が1つの数字に統合され、出どころが消える
 *   5. 需要指標が食い違ったとき、勝手にどちらかが採用される
 *   6. 「比べられない」が「食い違いが無い（＝安心）」に化ける
 *   7. 分析専用の倍率が、いつのまにか仕入判定に混ざる
 *   8. Keepaの月間購入回数が無い商品が、それだけで低く評価される
 *   9. 既存4判定（SELLS / TOO_COMPETITIVE / NOT_SELLING / UNKNOWN）が勝手に増減する
 *  10. 「自分が月◯個売れる」という書き方が復活する
 *  11. 再解析スクリプトが、いつのまにか本物のKeepaを叩き始める（＝毎回枠が減る）
 *
 * ------------------------------------------------------------------
 * ★ソース全文を正規表現で検査するときは、**先にコメントを取り除く**（ルール64）。
 *   過去に4件、「歯止めをコメントで説明したら、その説明文にテストが反応して落ちた」
 *   という同じ形の間違いが起きている。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDemandEvidence,
  demandRatioAnalysisOnly,
  judgeDemandConflict,
  keepaAbsenceDowngradesScore,
  CALIBRATED_SELLABILITY_SCORE_PLAN_JA,
  DEMAND_CONFLICT_MESSAGE_JA,
  DEMAND_CONFLICT_RATIO_THRESHOLD,
  DEMAND_CONFLICT_STATUSES,
  DEMAND_SOURCES,
  DEMAND_SOURCE_JA,
  FORBIDDEN_SALES_WORDS,
  KEEPA_MONTHLY_SOLD_ABSENT_NOTE_JA,
  KEEPA_MONTHLY_SOLD_LABEL_JA,
  KEEPA_MONTHLY_SOLD_NOTE_JA,
} from '../lib/keepa/demand';
import {
  keepaImageUrl,
  parseKeepaImages,
  IMAGE_STATUSES,
  IMAGE_STATUS_JA,
  KEEPA_IMAGE_BASE_URL,
  KEEPA_IMAGE_FIELD_MAP,
  KEEPA_IMAGE_NOTE_JA,
} from '../lib/keepa/images';
import { normalizeKeepaProduct } from '../lib/keepa/normalize';
import { KEEPA_SHAPE_WATCH_GROUPS } from '../lib/keepa/scan';
import { SELLABILITY_VERDICTS } from '../lib/sellability';

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

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const readFile = (p: string) => fs.readFileSync(path.join(decodeURIComponent(ROOT), p), 'utf8');

/** コメントを取り除いた「実際のコードだけ」を返す（ルール64）。 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* 偽データ（実在のASINは使わない＝ルール54） */
const FAKE_ASIN = 'B0TESTP601';

function main(): void {
  console.log('='.repeat(72));
  console.log(' Phase 3.13 受け入れテスト（画像の読み取り／需要の材料を分けて持つ）');
  console.log('='.repeat(72));

  // ================================================================
  console.log('\n[1. 画像は現在の公式仕様（images）から読む]');
  {
    const raw = {
      images: [
        { l: 'AAA.jpg', lH: 500, lW: 500, m: 'AAAm.jpg', variant: 'PT01' },
        { l: 'BBB.jpg', lH: 500, lW: 500, m: 'BBBm.jpg', variant: 'MAIN' },
      ],
    };
    const r = parseKeepaImages(raw);
    check('images から読めた', r.status === 'IMAGE_OK', r.reasonJa);
    check('枚数が数えられている', r.count === 2, String(r.count));
    check('variant=MAIN が主画像になる', r.mainFileName === 'BBB.jpg', String(r.mainFileName));
    check('主画像のURLが公式の形になる', r.mainUrl === `${KEEPA_IMAGE_BASE_URL}BBB.jpg`, String(r.mainUrl));
    check('旧名は使っていない', r.legacyFieldUsed === false);
  }

  // ================================================================
  console.log('\n[2. MAIN が無ければ先頭を主画像にする（推測で選ばない）]');
  {
    const r = parseKeepaImages({ images: [{ m: 'ONLY_M.jpg' }, { l: 'SECOND.jpg' }] });
    check('中サイズしか無くても読める', r.status === 'IMAGE_OK');
    check('先頭が主画像になる', r.mainFileName === 'ONLY_M.jpg', String(r.mainFileName));
    check('理由に選び方が書いてある', r.reasonJa.includes('MAIN が無いので先頭'), r.reasonJa);
  }

  // ================================================================
  console.log('\n[3. ★画像が無い理由を2つに分ける（絶対に混ぜない）]');
  {
    const none = parseKeepaImages({ title: 'ダミー' });
    check('項目そのものが無い → DATA_NOT_AVAILABLE',
      none.status === 'IMAGE_DATA_NOT_AVAILABLE', none.reasonJa);

    const emptyArr = parseKeepaImages({ images: [] });
    check('空の配列 → DATA_NOT_AVAILABLE',
      emptyArr.status === 'IMAGE_DATA_NOT_AVAILABLE', emptyArr.reasonJa);

    const broken = parseKeepaImages({ images: [{ lH: 500 }, { mW: 100 }] });
    check('中身はあるのにファイル名が取れない → ★PARSER_ERROR（当社の不具合）',
      broken.status === 'IMAGE_PARSER_ERROR', broken.reasonJa);

    const notArray = parseKeepaImages({ images: 'AAA.jpg,BBB.jpg' });
    check('配列でない形で来た → ★PARSER_ERROR（当社の不具合）',
      notArray.status === 'IMAGE_PARSER_ERROR', notArray.reasonJa);

    check('3つの状態がそろっている', IMAGE_STATUSES.length === 3);
    check('日本語の説明で「市場データ」と「システムの不具合」を言い分けている',
      IMAGE_STATUS_JA.IMAGE_DATA_NOT_AVAILABLE.includes('市場データ')
      && IMAGE_STATUS_JA.IMAGE_PARSER_ERROR.includes('不具合'));
  }

  // ================================================================
  console.log('\n[4. 旧名（imagesCSV）は黙って使わない]');
  {
    const legacy = parseKeepaImages({ imagesCSV: 'X.jpg,Y.jpg' });
    check('旧名でも読めはする', legacy.status === 'IMAGE_OK');
    check('★旧名を使ったことが必ず記録される', legacy.legacyFieldUsed === true);
    check('理由に「現在の公式仕様には無い」と書いてある',
      legacy.reasonJa.includes('現在の公式仕様には imagesCSV はありません'), legacy.reasonJa);

    const both = parseKeepaImages({ images: [{ l: 'NEW.jpg' }], imagesCSV: 'OLD.jpg' });
    check('現在仕様が先。旧名へ落ちない', both.mainFileName === 'NEW.jpg' && both.legacyFieldUsed === false);

    const map = KEEPA_IMAGE_FIELD_MAP;
    check('対応表に RAW_FIELD / RAW_TYPE / NORMALIZED_FIELD / CONVERSION_RULE がある',
      map.every((m) => m.rawField && m.rawType && m.normalizedField && m.conversionRuleJa));
    check('現在仕様（images）が先頭', map[0].rawField === 'images' && map[0].current === true);
    check('旧名は current=false と明記', map.some((m) => m.rawField === 'imagesCSV' && m.current === false));
  }

  // ================================================================
  console.log('\n[5. URLは「決まった形に当てはめる」だけ。推測しない]');
  {
    check('ファイル名が無ければ作らない', keepaImageUrl(null) === null && keepaImageUrl('') === null);
    check('スラッシュ入りは作らない', keepaImageUrl('a/b.jpg') === null);
    check('コロン入りは作らない', keepaImageUrl('http:x.jpg') === null);
    check('置き場所は公式仕様の形', KEEPA_IMAGE_BASE_URL === 'https://m.media-amazon.com/images/I/');
    check('当社の不具合だったと日本語で残している', KEEPA_IMAGE_NOTE_JA.includes('当社の読み取りの不具合'));
  }

  // ================================================================
  console.log('\n[6. 見張る項目名が現在仕様へ直っている]');
  {
    const g = KEEPA_SHAPE_WATCH_GROUPS.find((x) => x.group === 'images');
    check('images グループがある', !!g);
    check('★現在仕様 images を見張っている', g!.paths.includes('images'));
    check('現在仕様が先頭', g!.paths[0] === 'images');
    check('旧名も並べて見張る（来ていないことの確認用）', g!.paths.includes('imagesCSV'));
  }

  // ================================================================
  console.log('\n[7. 読み取り結果が「不明の帳簿」へ正しい理由で載る]');
  {
    const ok = normalizeKeepaProduct({ asin: FAKE_ASIN, domainId: 5, images: [{ l: 'Z.jpg' }] });
    check('読めたときは画像が不明に入らない', !ok.unknownFields.includes('商品画像'));
    check('画像の枚数が入る', ok.imageCount === 1);
    check('画像URLが入る', ok.imageMainUrl === `${KEEPA_IMAGE_BASE_URL}Z.jpg`);

    const dataMissing = normalizeKeepaProduct({ asin: FAKE_ASIN, domainId: 5 });
    const dm = dataMissing.unknownDetails.find((u) => u.labelJa === '商品画像');
    check('Keepaに無い → DATA_NOT_AVAILABLE として記録', dm?.reason === 'DATA_NOT_AVAILABLE', String(dm?.reason));
    check('★これは当社の不具合には数えない',
      !dataMissing.parserErrors.some((u) => u.labelJa === '商品画像'));
    check('枚数は0ではなくnull（0枚と不明を混ぜない）', dataMissing.imageCount === null);

    const parserBug = normalizeKeepaProduct({ asin: FAKE_ASIN, domainId: 5, images: [{ lH: 1 }] });
    check('★読めていない → PARSER_OR_SCHEMA_ERROR として当社の不具合に数える',
      parserBug.parserErrors.some((u) => u.labelJa === '商品画像'));
  }

  // ================================================================
  console.log('\n[8. ★Keepaの月間購入回数を「実測」と呼ばない]');
  {
    check('正しい呼び方が「◯個以上」の区分値になっている',
      KEEPA_MONTHLY_SOLD_LABEL_JA.includes('◯個以上') && KEEPA_MONTHLY_SOLD_LABEL_JA.includes('Keepa'));
    check('説明に「実測販売数とは呼びません」と書いてある',
      KEEPA_MONTHLY_SOLD_NOTE_JA.includes('「実測販売数」とは呼びません'));
    check('説明に「下限」であることが書いてある', KEEPA_MONTHLY_SOLD_NOTE_JA.includes('下限'));
    check('説明に「大半の商品では空」と書いてある', KEEPA_MONTHLY_SOLD_NOTE_JA.includes('大半の商品では空'));

    /*
     * ★ソース全体を機械的に見張る。
     *   コメントを外したうえで、禁止語がコードに残っていないかを見る。
     *   （demand.ts 自身は禁止語の一覧を持っているので対象から外す）
     */
    const targets = [
      'lib/keepa/normalize.ts', 'lib/keepa/store.ts', 'lib/keepa/schema.ts',
      'lib/keepa/scan.ts', 'lib/sellability.ts', 'lib/keepa/images.ts',
      'scripts/keepa-one.ts', 'scripts/keepa-five.ts', 'scripts/keepa-reanalyze.ts',
      'app/keepa/page.tsx', 'app/sellability/page.tsx',
    ];
    for (const f of targets) {
      const src = codeOnly(readFile(f));
      for (const word of FORBIDDEN_SALES_WORDS) {
        check(`${f} に「${word}」が無い`, !src.includes(word));
      }
    }
    check('禁止語の一覧が2語そろっている', FORBIDDEN_SALES_WORDS.length === 2);

    const norm = normalizeKeepaProduct({ asin: FAKE_ASIN, domainId: 5, monthlySold: 100 });
    check('正しい名前の項目に入る', norm.keepaMonthlySoldAtLeast === 100);
    check('無ければ0ではなくnull',
      normalizeKeepaProduct({ asin: FAKE_ASIN, domainId: 5 }).keepaMonthlySoldAtLeast === null);
  }

  // ================================================================
  console.log('\n[9. 3つの材料を1つの数字に統合しない（出どころを必ず持つ）]');
  {
    const ev = buildDemandEvidence({
      asin: FAKE_ASIN,
      rankDrops30: 30,
      keepaMonthlySoldAtLeast: 200,
      internalDemandSignal: 32,
      estimatedEqualShareOpportunity: 1.2,
      sellerCount: 24,
      amazonRetail: 'NO',
      dataAgeDays: 1,
    });
    const keys = ev.signals.map((s) => s.key);
    for (const k of [
      'RANK_DROPS_30D', 'KEEPA_MONTHLY_SOLD_AT_LEAST', 'INTERNAL_DEMAND_SIGNAL',
      'ESTIMATED_EQUAL_SHARE_OPPORTUNITY', 'SELLER_COUNT', 'AMAZON_RETAIL', 'DATA_FRESHNESS',
    ]) {
      check(`材料 ${k} がある`, keys.includes(k));
    }
    check('★すべての材料が出どころを持っている', ev.signals.every((s) => DEMAND_SOURCES.includes(s.source)));
    check('順位下落回数の出どころは Keepa',
      ev.signals.find((s) => s.key === 'RANK_DROPS_30D')!.source === 'KEEPA');
    check('等分の取り分の出どころは当社の計算',
      ev.signals.find((s) => s.key === 'ESTIMATED_EQUAL_SHARE_OPPORTUNITY')!.source === 'INTERNAL_CALCULATION');
    check('Keepaの月間購入回数の出どころは Keepa',
      ev.signals.find((s) => s.key === 'KEEPA_MONTHLY_SOLD_AT_LEAST')!.source === 'KEEPA');
    check('★材料は統合されず別々に残っている', ev.signals.length === 7);
    check('出どころの日本語が「当社の計算」と「Keepaが返した値」を言い分けている',
      DEMAND_SOURCE_JA.INTERNAL_CALCULATION.includes('当社の計算')
      && DEMAND_SOURCE_JA.KEEPA.includes('Keepaが返した値'));
    check('★順位下落回数は販売数ではないと明記',
      ev.signals.find((s) => s.key === 'RANK_DROPS_30D')!.noteJa.includes('販売数ではありません'));
  }

  // ================================================================
  console.log('\n[10. ★食い違いは食い違いのまま残す（どちらかへ寄せない）]');
  {
    const c1 = judgeDemandConflict(44, 5000);
    check('約100倍ずれたら CONFLICT', c1.status === 'CONFLICT', c1.reasonJa);
    check('真偽値も true になる', c1.demandSignalConflict === true);
    check('★画面の文言が決まっている', c1.messageJa === DEMAND_CONFLICT_MESSAGE_JA);
    check('文言が指示どおり', DEMAND_CONFLICT_MESSAGE_JA === '需要指標が食い違っています。追加検証が必要です');
    check('★どちらを採用するかを決めていない', c1.reasonJa.includes('どちらを採用するかはこの時点では決めません'));

    const c2 = judgeDemandConflict(32.7, 200);
    check('約6倍でも CONFLICT', c2.status === 'CONFLICT', c2.reasonJa);

    const c3 = judgeDemandConflict(40, 50);
    check('1.25倍なら CONSISTENT', c3.status === 'CONSISTENT', c3.reasonJa);
    check('CONSISTENT でも「どちらも正しい」とは言わない',
      c3.reasonJa.includes('「どちらも正しい」という意味ではありません'));

    const c4 = judgeDemandConflict(32, null);
    check('★片方が無ければ CANNOT_COMPARE', c4.status === 'CANNOT_COMPARE');
    check('★「食い違いが無い」に化けていない',
      c4.demandSignalConflict === false
      && c4.reasonJa.includes('「食い違いが無い」という意味ではありません'));
    check('比べられないときは倍率も出さない', c4.ratio === null);
    check('3つの状態がそろっている', DEMAND_CONFLICT_STATUSES.length === 3);
    check('しきい値が定数として1か所にある', DEMAND_CONFLICT_RATIO_THRESHOLD === 3);
  }

  // ================================================================
  console.log('\n[11. 倍率は分析専用。仕入判定には使わない]');
  {
    check('倍率が計算できる', demandRatioAnalysisOnly(44, 5000)! > 90);
    check('材料が欠けたら null（1で埋めない）',
      demandRatioAnalysisOnly(null, 5000) === null && demandRatioAnalysisOnly(44, null) === null);
    check('0で割らない', demandRatioAnalysisOnly(0, 5000) === null);

    /*
     * ★判定側（sellability）が需要の材料モジュールを読んでいないことを確認する。
     *   読んでいなければ、倍張りや食い違いが判定へ混ざりようがない。
     */
    const sell = codeOnly(readFile('lib/sellability.ts'));
    check('★判定側が demand を import していない', !/from\s+['"].*keepa\/demand['"]/.test(sell));
    check('★判定側に monthlySold が出てこない', !/monthlySold/.test(sell));
  }

  // ================================================================
  console.log('\n[12. 既存4判定は変えていない]');
  {
    /*
     * ★ご本人の指示では判定名を SELLS / TOO_COMPETITIVE / NOT_SELLING / UNKNOWN と
     *   書かれていたが、当社の実物の名前は SELLS / CROWDED / DOES_NOT_SELL / UNKNOWN である。
     *   指す中身は同じ（売れる／ライバルが多すぎる／売れていない／判断できない）。
     *   「判定はまだ変更しないこと」という指示に従い、**名前も変えずにそのまま残す**。
     *   ここで勝手に改名すると、保存済みの行と突き合わせられなくなる。
     */
    check('判定は4つのまま', SELLABILITY_VERDICTS.length === 4, SELLABILITY_VERDICTS.join('/'));
    for (const v of ['SELLS', 'CROWDED', 'DOES_NOT_SELL', 'UNKNOWN']) {
      check(`${v} がある`, (SELLABILITY_VERDICTS as readonly string[]).includes(v));
    }
  }

  // ================================================================
  console.log('\n[13. Keepaの値が無い商品を、それだけで低く見ない]');
  {
    check('「無いのが普通」と書いてある', KEEPA_MONTHLY_SOLD_ABSENT_NOTE_JA.includes('無いのが普通'));
    check('★「評価を下げてはいけません」と書いてある',
      KEEPA_MONTHLY_SOLD_ABSENT_NOTE_JA.includes('評価を下げてはいけません'));
    check('低評価にしないことが関数として固定されている', keepaAbsenceDowngradesScore() === false);

    const ev = buildDemandEvidence({
      asin: FAKE_ASIN, rankDrops30: 35, keepaMonthlySoldAtLeast: null,
      internalDemandSignal: 32, estimatedEqualShareOpportunity: 1.3,
      sellerCount: 25, amazonRetail: 'NO', dataAgeDays: 1,
    });
    const s = ev.signals.find((x) => x.key === 'KEEPA_MONTHLY_SOLD_AT_LEAST')!;
    check('★無いときは UNKNOWN と書く（0にしない）', s.value === null && s.textValue === 'UNKNOWN');
    check('他の材料は残っている', ev.signals.filter((x) => x.value !== null).length >= 4);
  }

  // ================================================================
  console.log('\n[14. 「自分が月◯個売れる」とは書かない]');
  {
    const ev = buildDemandEvidence({
      asin: FAKE_ASIN, rankDrops30: 35, keepaMonthlySoldAtLeast: null,
      internalDemandSignal: 32, estimatedEqualShareOpportunity: 1.3,
      sellerCount: 25, amazonRetail: 'NO', dataAgeDays: 1,
    });
    const s = ev.signals.find((x) => x.key === 'ESTIMATED_EQUAL_SHARE_OPPORTUNITY')!;
    check('名前が「等分したと仮定した場合」になっている', s.labelJa.includes('等分したと仮定'));
    check('★「自分が月◯個売れるという意味ではない」と書いてある',
      s.noteJa.includes('「自分が月◯個売れる」という意味ではありません'));

    const files = ['lib/keepa/demand.ts', 'scripts/keepa-reanalyze.ts'];
    for (const f of files) {
      const src = codeOnly(readFile(f));
      check(`${f} に「自分が月」という断定表現が無い`, !/自分が月\d/.test(src));
    }
  }

  // ================================================================
  console.log('\n[15. CALIBRATED_SELLABILITY_SCORE はまだ作らない]');
  {
    check('予定として文章で残っている', CALIBRATED_SELLABILITY_SCORE_PLAN_JA.includes('まだ作りません'));
    check('作らない理由が書いてある', CALIBRATED_SELLABILITY_SCORE_PLAN_JA.includes('確かめられない点数'));
    const src = codeOnly(readFile('lib/keepa/demand.ts'));
    check('★関数としては実装されていない',
      !/function\s+\w*[Cc]alibrated/.test(src) && !/calibratedSellabilityScore\s*[=(]/.test(src));
  }

  // ================================================================
  console.log('\n[16. 再解析は保存済みデータだけ。Keepaへ通信しない（枠0）]');
  {
    const src = codeOnly(readFile('scripts/keepa-reanalyze.ts'));
    check('★fetch を呼んでいない', !/\bfetch\s*\(/.test(src));
    check('★取得の入口（client）を読んでいない', !/keepa\/client/.test(src));
    check('★APIキーを読んでいない', !/KEEPA_API_KEY|process\.env/.test(src));
    check('読むのは保存済みの応答だけ', src.includes('keepa_raw_responses'));
    check('商品の応答だけに絞っている', src.includes("endpoint = 'product'"));
  }

  // ================================================================
  console.log('\n[17. 画像の読み取りは1ファイルに閉じている（ルール37）]');
  {
    const img = readFile('lib/keepa/images.ts');
    check('★images.ts は何も import しない', !/^\s*import\s/m.test(img));
    const demand = readFile('lib/keepa/demand.ts');
    check('★demand.ts も何も import しない', !/^\s*import\s/m.test(demand));
  }

  // ================================================================
  console.log('\n[18. 購入・出品・決済は、やはり存在しない]');
  {
    for (const f of ['lib/keepa/images.ts', 'lib/keepa/demand.ts', 'scripts/keepa-reanalyze.ts']) {
      const src = codeOnly(readFile(f));
      check(`${f} にカート追加が無い`, !/addToCart|add_to_cart/i.test(src));
      check(`${f} に注文の実行が無い`, !/placeOrder|createOrder|submitOrder/i.test(src));
      check(`${f} に決済が無い`, !/charge\(|payment\.|stripe/i.test(src));
    }
  }

  // ================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('不合格の項目：');
    for (const x of failures) console.log(`  - ${x}`);
    process.exit(1);
  }
  console.log('Phase 3.13（画像の読み取り／需要の材料を分けて持つ）の受け入れ条件をすべて満たしています。');
  console.log('※ このテストは Keepa へ一切アクセスしません。');
  console.log('※ 需要指標が食い違ったとき、どちらかを自動で採用することはありません。');
  console.log('※ 既存4判定（SELLS / CROWDED / DOES_NOT_SELL / UNKNOWN）は変えていません。');
}

main();
