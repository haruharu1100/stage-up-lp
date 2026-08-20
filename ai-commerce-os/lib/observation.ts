/**
 * 実市場の「出品1件」を追いかける仕組み（Phase 3.6・§3〜§9 §19 §20）。
 *
 * 【なぜ相場テーブルと別に作るのか】
 * これまでの `venue_market_prices` は「メルカリのこの商品の相場は10万円」という表だった。
 * 今回やりたいのはそれではない。
 *
 *   「2026-08-20 に 105,000円 で出ていた"この1件"は、7日後にどうなったのか」
 *
 * を確かめたい。だから主語が「相場」ではなく「1件の出品」になる。
 * 相場テーブルは上書きされるが、こちらは**絶対に上書きしない**。
 *
 * 【この仕組みが守っている3つの約束】
 *
 *  1. 同じURLを観測するたび、新しい行を積む（上書きしない）。
 *     上書きすると「先週いくらだったか」が消え、値下げが起きたことすら分からなくなる。
 *
 *  2. 「ページが消えた＝売れた」にしない。
 *     消えた理由は、売れた／出品者が取り下げた／規約違反で消された／自分の見間違い、と何通りもある。
 *     消えただけなら `REMOVED_UNKNOWN`。売り切れ表示を実際に見たときだけ `CONFIRMED_SOLD`。
 *
 *  3. いくらで売れたかを推測しない。
 *     10万円で出ていた商品が売れても、10万円で売れたとは限らない（値下げ交渉・値下げ後の成約）。
 *     確認できなければ `sold_price_known = 0`。画面には「不明」と出す。0円とも出品価格とも書かない。
 *
 * 【自動巡回はしない】
 * ここに書いてあるのは「人が公開画面を見て書き写したものを受け取る」処理だけ。
 * URLへ自分でアクセスする処理は1行も無い（CLAUDE.md ルール1）。
 */
import { all, batch, one, run, nowIso } from './db/client';
import { parseCsv } from './csv';
import {
  cleanText, identityKey, modelKey, normalizeBrand, normalizeCategory, normalizeColor,
  normalizeCondition, normalizeJan, normalizeSize, parseIntOrNull, parseMoney,
} from './normalize';
import { judgeRealMarketData, sourceClassOf, SELF_OBSERVED_CAUTION } from './realdata';
import {
  canon, checkpointFor, listingKeyOf, parseListingState, workStepJa, normalizeWorkStep,
  parsePackageSize, parseShippingMethod, parseShippingPayer,
  LISTING_STATE_JA, TRACK_CHECKPOINTS, WORK_STEP_SECONDS_FIELDS,
  type CheckpointCode, type ListingState, type StateSource, type WorkStepCode,
} from './listing';

/**
 * 状態の名前・日本語訳・追跡予定・工程名・記入見本は `lib/listing.ts` にある。
 *
 * 【なぜ分けたか】
 * 画面（'use client' の部品）がこのファイルを読み込むと、データベース層の `node:path` まで
 * 引きずられてビルドが落ちる（`lib/conditions.ts` と `lib/normalize.ts` の関係と同じ）。
 * 言葉の定義だけを外に出し、ここからそのまま再輸出して呼び出し側の書き方は変えていない。
 */
export * from './listing';

// ============================================================
// CSVの取り込み（§3 §4）
// ============================================================

const ALIASES: Record<string, string[]> = {
  observed_at: ['observed_at', 'observedat', '確認日時', '確認日', '観測日時', '観測日', '日付', 'date'],
  venue: ['venue', 'venue_code', '市場', '市場コード', 'サイト'],
  product_name: ['product_name', 'title', 'name', '商品名', 'タイトル'],
  brand: ['brand', 'maker', 'ブランド', 'メーカー'],
  category: ['category', 'カテゴリ', 'カテゴリー', 'ジャンル'],
  model_number: ['model_number', 'model', '型番', '品番', 'モデル'],
  jan: ['jan', 'gtin', 'ean', 'upc', 'janコード'],
  sku: ['sku', '管理番号'],
  size: ['size', 'サイズ'],
  color: ['color', 'colour', '色', 'カラー'],
  condition: ['condition', '状態', '商品の状態', 'コンディション'],
  listing_price: ['listing_price', 'price', '価格', '出品価格', '販売価格'],
  shipping_included: ['shipping_included', 'shipping', '送料込み', '送料', '配送料の負担'],
  seller_type: ['seller_type', 'seller', '出品者', '出品者種別'],
  product_url: ['product_url', 'url', 'link', '商品url', '商品URL', 'リンク'],
  sold_status: ['sold_status', 'status', 'state', 'listing_state', '状況', '販売状況', '出品状況'],
  sold_price: ['sold_price', '成約価格', '売れた価格', '売却価格'],
  sold_at: ['sold_at', '成約日', '売れた日', '売却日'],
  notes: ['notes', 'note', 'memo', '備考', 'メモ'],
  // 追加（ユーザー指示の必須項目ではないが、あると精度が上がるもの）
  data_source: ['data_source', 'source_type', '取得方法', '取得元'],
  checkpoint: ['checkpoint', '観測回', 'タイミング'],
  entry_seconds: ['entry_seconds', 'seconds', 'total_input_seconds', '入力秒数', '入力時間', '作業秒数', '合計秒数'],
  // 工程ごとの秒数（Phase 3.8）。空欄でよい。ここが埋まると自動化の順番を数字で決められる。
  sec_find: ['sec_find', '発見秒数', '商品発見秒数', '探す秒数'],
  sec_inspect: ['sec_inspect', '情報確認秒数', '商品情報確認秒数'],
  sec_model: ['sec_model', '型番確認秒数', '型番秒数'],
  sec_condition: ['sec_condition', '状態確認秒数', '状態秒数'],
  sec_entry: ['sec_entry', '記入秒数', 'csv入力秒数', '入力欄秒数'],
  sec_other: ['sec_other', 'その他秒数', '他秒数'],
  // 送料の精度（Phase 3.7）。分からなければ空欄でよい。推測で埋めさせない。
  package_size: ['package_size', 'size_class', '荷物サイズ', '梱包サイズ', '配送サイズ'],
  shipping_method: ['shipping_method', '発送方法', '配送方法'],
  shipping_payer: ['shipping_payer', '送料負担', '送料の負担', '配送料の負担者'],
  estimated_shipping_cost: ['estimated_shipping_cost', '見込み送料', '想定送料', '予想送料'],
  actual_shipping_cost: ['actual_shipping_cost', '実際の送料', '実送料', '確定送料'],
};

export type ObservationImportResult = {
  ok: boolean;
  message: string;
  rowCount: number;
  /** 新しく追跡し始めた出品の件数 */
  newListings: number;
  /** 積み上がった観測の件数（同じ瞬間の重複は数えない） */
  observations: number;
  /** 取り込めなかった行 */
  invalid: number;
  errors: { row: number; reason: string }[];
  /** 気になるが止めるほどではないもの。黙って直さず、必ず出す。 */
  warnings: { row: number; reason: string }[];
  byState: Record<string, number>;
  /** 実市場データとして数えた行 */
  realRows: number;
  selfObservedRows: number;
  providedRows: number;
  /** 商品を特定できる情報（JAN／ブランド＋型番）がある行 */
  identifiableRows: number;
  caution: string | null;
  /** 人の入力にかかった合計秒数（書いてあった行だけ） */
  entrySecondsTotal: number;
  entrySecondsRows: number;
  /** 工程ごとの秒数を記録できた件数（Phase 3.8） */
  workStepRows: number;
};

type Existing = {
  listing_key: string;
  first_observed_at: string;
  latest_observed_at: string | null;
  latest_listing_price: number | null;
  latest_state: string;
};

export async function importListingObservations(text: string): Promise<ObservationImportResult> {
  const out: ObservationImportResult = {
    ok: false, message: '', rowCount: 0, newListings: 0, observations: 0,
    invalid: 0, errors: [], warnings: [], byState: {},
    realRows: 0, selfObservedRows: 0, providedRows: 0, identifiableRows: 0,
    caution: null, entrySecondsTotal: 0, entrySecondsRows: 0, workStepRows: 0,
  };

  const grid = parseCsv(text);
  if (grid.length < 2) {
    out.message = 'データが空です。1行目に見出し、2行目以降に観測した内容を入れてください。';
    return out;
  }

  const lookup = new Map<string, string>();
  for (const [key, list] of Object.entries(ALIASES)) for (const a of list) lookup.set(canon(a), key);
  const map: Record<string, number> = {};
  grid[0].forEach((h, i) => {
    const k = lookup.get(canon(h));
    if (k && map[k] === undefined) map[k] = i;
  });

  if (map.product_url === undefined || map.observed_at === undefined) {
    out.message = '「商品URL」と「確認日時」の列が見つかりません。見出し行を確認してください。'
      + 'この2つが無いと、同じ出品を追いかけられません。';
    return out;
  }

  const knownVenues = new Set((await all('SELECT code FROM venues')).map((r) => String(r.code)));
  const existing = new Map<string, Existing>(
    (await all(
      `SELECT listing_key, first_observed_at, latest_observed_at, latest_listing_price, latest_state
         FROM tracked_listings`,
    )).map((r) => [String(r.listing_key), {
      listing_key: String(r.listing_key),
      first_observed_at: String(r.first_observed_at),
      latest_observed_at: r.latest_observed_at === null ? null : String(r.latest_observed_at),
      latest_listing_price: r.latest_listing_price === null ? null : Number(r.latest_listing_price),
      latest_state: String(r.latest_state),
    }]),
  );

  const now = nowIso();
  const stmts: { sql: string; args: unknown[] }[] = [];

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (row.length === 0 || row.every((c) => c.trim() === '')) continue;
    out.rowCount++;
    const rowNo = i + 1;
    const get = (k: string): string => (map[k] === undefined ? '' : (row[map[k]] ?? '').trim());

    const url = cleanText(get('product_url'));
    const key = listingKeyOf(url);
    if (!key) {
      out.invalid++;
      out.errors.push({ row: rowNo, reason: '商品URLが読み取れません（http／httpsのURLを入れてください）' });
      continue;
    }

    const observedAt = cleanText(get('observed_at'));
    const t = Date.parse(observedAt);
    if (!Number.isFinite(t)) {
      out.invalid++;
      out.errors.push({ row: rowNo, reason: '確認日時が読み取れません（例：2026-08-20 21:30）' });
      continue;
    }

    const prev = existing.get(key);
    const isFirst = prev === undefined;

    const venueRaw = get('venue').toUpperCase();
    // §1 でメルカリを最初の実市場に固定しているので、空欄はメルカリ。
    // ただし「知らない市場コードが書いてあった」ときは黙って直さない。止める。
    const venue = venueRaw === '' ? 'MERCARI' : venueRaw;
    if (!knownVenues.has(venue)) {
      out.invalid++;
      out.errors.push({ row: rowNo, reason: `市場コード「${get('venue')}」は登録されていません` });
      continue;
    }

    const price = parseMoney(get('listing_price'));
    const name = cleanText(get('product_name'));
    const cond = normalizeCondition(get('condition'));
    const stateWritten = parseListingState(get('sold_status'));

    const secondsRaw = get('entry_seconds') === '' ? null : Number(get('entry_seconds').replace(/[,\s秒]/g, ''));
    const totalSeconds = secondsRaw !== null && Number.isFinite(secondsRaw) && secondsRaw > 0 ? secondsRaw : null;

    if (isFirst) {
      const missing: string[] = [];
      if (!name) missing.push('商品名');
      if (price === null || price <= 0) missing.push('価格');
      if (!cond.raw) missing.push('状態');
      if (missing.length > 0) {
        out.invalid++;
        out.errors.push({
          row: rowNo,
          reason: `初めて登録する出品には ${missing.join('・')} が必要です`
            + '（分からない項目は空欄で構いませんが、この5つだけは埋めてください）',
        });
        continue;
      }
      /*
       * 入力秒数（TOTAL_INPUT_SECONDS）は初回だけ必須（Phase 3.8）。
       * この10件は商品データを集めるために入れるのではなく、
       * どこを自動化すべきかを決めるために入れる。秒数が無いとその目的が達成できない。
       * 「あとでまとめて書く」を許すと、思い出しながら書いた数字＝実測ではないものが混ざる。
       */
      if (totalSeconds === null) {
        out.invalid++;
        out.errors.push({
          row: rowNo,
          reason: '初めて登録する出品には「入力秒数」が必要です'
            + '（この1件を見つけて書き終えるまでに何秒かかったか。ここが無いと、どの工程を自動化すべきか決められません）',
        });
        continue;
      }
    }

    // ---- 状態を決める（§8）----
    let state: ListingState;
    let stateSource: StateSource;
    if (stateWritten !== null) {
      state = stateWritten;
      stateSource = 'HUMAN_INPUT';
    } else if (isFirst) {
      // 初回で状態の記入が無い＝画面で見て出品されていたはず、と決めつけない。
      state = 'UNKNOWN';
      stateSource = 'MISSING_INPUT';
    } else {
      state = 'UNKNOWN';
      stateSource = 'MISSING_INPUT';
    }

    /*
     * 価格が前回と違えば「価格が変わった」に格上げする。
     * これは推測ではない。前回の価格も今回の価格も、どちらも実際に観測した数字なので、
     * 「変わった」は観測から確実に言える。
     * ただし売り切れ・消えたを上書きはしない（そちらの方が重い情報）。
     */
    let priceDelta: number | null = null;
    if (!isFirst && price !== null && prev?.latest_listing_price != null) {
      priceDelta = price - prev.latest_listing_price;
      if (priceDelta !== 0 && (state === 'ACTIVE' || state === 'UNKNOWN')) {
        state = 'PRICE_CHANGED';
        stateSource = 'DERIVED_PRICE_DIFF';
      }
    }

    // ---- 売れた値段（§9）----
    const soldPriceRaw = parseMoney(get('sold_price'));
    let soldPrice: number | null = null;
    let soldKnown = 0;
    if (soldPriceRaw !== null && soldPriceRaw > 0) {
      if (state === 'CONFIRMED_SOLD') {
        soldPrice = soldPriceRaw;
        soldKnown = 1;
      } else {
        // 売り切れを確認していないのに成約価格だけ書いてある＝どこかがおかしい。
        // 黙って採用すると「消えた＝この値段で売れた」が出来上がる。採用しない。
        out.warnings.push({
          row: rowNo,
          reason: `成約価格が書かれていますが、状態が「${LISTING_STATE_JA[state]}」なので採用しませんでした`
            + '（売り切れを画面で確認できたときだけ成約価格として扱います）',
        });
      }
    } else if (state === 'CONFIRMED_SOLD') {
      // 売れたのは確認できたが、いくらで売れたかは不明。ここを出品価格で埋めない。
      out.warnings.push({
        row: rowNo,
        reason: '売り切れは確認できましたが、成約価格が分かりません（不明のまま記録しました。出品価格で代用していません）',
      });
    }

    // ---- 取得方法（自分で見て記録 or 事業者提供）----
    const dsRaw = get('data_source').toUpperCase().replace(/[\s-]/g, '_');
    const dataSource = dsRaw === '' ? 'MANUAL_OBSERVATION' : dsRaw;
    const notes = cleanText(get('notes')) || null;
    const judged = judgeRealMarketData({
      dataSource, sourceUrl: url, sourceNote: notes, observedAt,
    });
    const sourceClass = judged.isReal ? judged.sourceClass : sourceClassOf(dataSource);
    if (judged.isReal) {
      out.realRows++;
      if (judged.sourceClass === 'SELF_OBSERVED') out.selfObservedRows++;
      else out.providedRows++;
    } else {
      out.warnings.push({ row: rowNo, reason: `実市場データとして数えません：${judged.reason}` });
    }

    // ---- 商品の同定（§10）----
    const jan = normalizeJan(get('jan'));
    const brand = normalizeBrand(get('brand'));
    const mk = modelKey(get('model_number'));
    const idKey = identityKey({
      jan, brand, modelKey: mk,
      color: normalizeColor(get('color')), size: normalizeSize(get('size')),
    });
    if (idKey) out.identifiableRows++;

    // ---- 経過時間と観測回（§6）----
    const firstAt = isFirst ? observedAt : (prev?.first_observed_at ?? observedAt);
    const elapsedHours = Math.max(0, (t - Date.parse(firstAt)) / 3600000);
    const writtenCp = get('checkpoint').toUpperCase();
    const checkpoint = writtenCp !== '' && (TRACK_CHECKPOINTS.some((c) => c.code === writtenCp) || writtenCp === 'EXTRA')
      ? writtenCp
      : checkpointFor(elapsedHours);

    const shipRaw = canon(get('shipping_included'));
    const shippingIncluded = shipRaw === '' ? null
      : (['送料込み', '送料込', 'included', 'yes', '1', 'true', '込み'].some((w) => shipRaw.includes(canon(w))) ? 1 : 0);

    /*
     * 送料の精度（Phase 3.7）。
     * 読み取れない言葉は null のまま。「たぶん60サイズ」に寄せない。
     * 送料の負担者は、書かれていなければ「送料込み」欄から分かる範囲だけ埋める。
     * どちらも無ければ不明のままにする（0円にしない）。
     */
    const packageSize = parsePackageSize(get('package_size'));
    const shippingMethod = parseShippingMethod(get('shipping_method'));
    const shippingPayer = parseShippingPayer(get('shipping_payer'))
      ?? (shippingIncluded === 1 ? 'SELLER' : shippingIncluded === 0 ? 'BUYER' : null);
    const posInt = (k: string): number | null => {
      const v = get(k);
      if (v === '') return null;
      const n = Number(String(v).replace(/[,¥円\s]/g, ''));
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    };
    const estShip = posInt('estimated_shipping_cost');
    const actShip = posInt('actual_shipping_cost');

    const seconds = totalSeconds;
    if (seconds !== null) {
      out.entrySecondsTotal += seconds;
      out.entrySecondsRows++;
    }

    /*
     * 工程ごとの秒数（Phase 3.8）。
     *
     * 【なぜ観測の行ではなく作業ログの表へ入れるか】
     * 工程は「商品ごと」ではなく「工程ごと」に足し合わせて見たい。
     * 観測の行に6つの列を足すと、集計のたびに6列を縦に並べ替える処理が要る。
     * 既にある作業ログの表（observation_work_log）へ入れておけば、
     * 手で記録した分と同じ集計に自然に乗る。
     *
     * 【同じCSVを2回取り込んでも秒数が倍にならないようにする】
     * batch_id を「この出品のこの観測」に固定し、(batch_id, step) を一意にしてある。
     * 観測そのものが ON CONFLICT DO NOTHING なのに、作業時間だけ二重に積み上がると、
     * 「1件あたり◯秒」が実際の倍になり、自動化の判断を誤らせる。
     */
    const stepSeconds: { step: WorkStepCode; sec: number }[] = [];
    for (const f of WORK_STEP_SECONDS_FIELDS) {
      const raw = get(f.field);
      if (raw === '') continue;
      const v = Number(raw.replace(/[,\s秒]/g, ''));
      if (!Number.isFinite(v) || v <= 0) continue;
      stepSeconds.push({ step: f.step, sec: v });
    }
    if (stepSeconds.length > 0) {
      const stepTotal = stepSeconds.reduce((a, s) => a + s.sec, 0);
      // 工程の合計が入力秒数と大きく食い違うなら、どちらかが間違っている。黙って直さず言う。
      if (seconds !== null && Math.abs(stepTotal - seconds) > Math.max(30, seconds * 0.3)) {
        out.warnings.push({
          row: rowNo,
          reason: `工程ごとの秒数の合計（${Math.round(stepTotal)}秒）と入力秒数（${Math.round(seconds)}秒）が食い違っています`
            + '（どちらも記録しました。集計では工程ごとの数字をそのまま使います）',
        });
      }
      const batchId = `LISTING:${key}@${observedAt}`;
      for (const s of stepSeconds) {
        stmts.push({
          // 条件付きの一意制約を狙うので、ON CONFLICT 側にも同じ条件（WHERE）を書く。
          // 書かないと「その一意制約は知らない」と言われて取り込みごと落ちる。
          sql: `INSERT INTO observation_work_log (batch_id, step, seconds, rows, note, recorded_at)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(batch_id, step) WHERE batch_id LIKE 'LISTING:%' DO NOTHING`,
          args: [batchId, s.step, s.sec, 1, '観測CSVの工程別秒数', now],
        });
        out.workStepRows++;
      }
    }

    out.byState[state] = (out.byState[state] ?? 0) + 1;

    // ---- 追跡表（1出品1行）----
    if (isFirst) {
      out.newListings++;
      stmts.push({
        sql: `INSERT INTO tracked_listings
          (listing_key, venue_code, product_url, product_name, brand, category, model_number, jan, sku,
           size, color, condition_raw, condition_rank, identity_key, seller_type,
           first_observed_at, first_listing_price, latest_observed_at, latest_listing_price, latest_state,
           actual_sold_price, sold_price_known, sold_at, observation_count,
           data_source, source_class, real_market_data, identifiable, notes, created_at, updated_at,
           package_size, shipping_method, shipping_payer, estimated_shipping_cost, actual_shipping_cost)
         VALUES (?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?)
         ON CONFLICT(listing_key) DO NOTHING`,
        args: [
          key, venue, url, name || null, brand || null, normalizeCategory(get('category')) || null,
          cleanText(get('model_number')) || null, jan || null, cleanText(get('sku')) || null,
          normalizeSize(get('size')) || null, normalizeColor(get('color')) || null,
          cond.raw || null, cond.rank, idKey, cleanText(get('seller_type')) || null,
          observedAt, price, observedAt, price, state,
          soldPrice, soldKnown, cleanText(get('sold_at')) || null, 1,
          dataSource, sourceClass, judged.isReal ? 1 : 0, idKey ? 1 : 0, notes, now, now,
          packageSize, shippingMethod, shippingPayer, estShip, actShip,
        ],
      });
      existing.set(key, {
        listing_key: key, first_observed_at: observedAt,
        latest_observed_at: observedAt, latest_listing_price: price, latest_state: state,
      });
    } else {
      /*
       * 追跡表の「最新」だけを更新する。
       * ここを更新しても過去は消えない。過去は listing_observations に全部残っている。
       *
       * 成約価格は「一度確認できたら消さない」。
       * COALESCE で、既に分かっている値を空で上書きしないようにしてある。
       */
      stmts.push({
        sql: `UPDATE tracked_listings SET
                latest_observed_at = ?, latest_listing_price = COALESCE(?, latest_listing_price),
                latest_state = ?, observation_count = observation_count + 1,
                actual_sold_price = COALESCE(actual_sold_price, ?),
                sold_price_known = MAX(sold_price_known, ?),
                sold_at = COALESCE(sold_at, ?),
                package_size = COALESCE(?, package_size),
                shipping_method = COALESCE(?, shipping_method),
                shipping_payer = COALESCE(?, shipping_payer),
                estimated_shipping_cost = COALESCE(?, estimated_shipping_cost),
                actual_shipping_cost = COALESCE(?, actual_shipping_cost),
                updated_at = ?
              WHERE listing_key = ?`,
        args: [
          observedAt, price, state, soldPrice, soldKnown,
          cleanText(get('sold_at')) || null,
          // 後から分かった送料は足せる。既に入っている値を空で消さない（COALESCE）。
          packageSize, shippingMethod, shippingPayer, estShip, actShip,
          now, key,
        ],
      });
      const e = existing.get(key)!;
      e.latest_observed_at = observedAt;
      if (price !== null) e.latest_listing_price = price;
      e.latest_state = state;
    }

    // ---- 観測（追記のみ・§7）----
    stmts.push({
      sql: `INSERT INTO listing_observations
        (listing_key, venue_code, observed_at, checkpoint, elapsed_hours, listing_price,
         shipping_included, listing_state, state_source, sold_price, sold_price_known, sold_at,
         price_delta, data_source, source_class, real_market_data, entry_seconds, notes, created_at)
       VALUES (?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?)
       ON CONFLICT(listing_key, observed_at) DO NOTHING`,
      args: [
        key, venue, observedAt, checkpoint, elapsedHours, price,
        shippingIncluded, state, stateSource, soldPrice, soldKnown, cleanText(get('sold_at')) || null,
        priceDelta, dataSource, sourceClass, judged.isReal ? 1 : 0,
        seconds !== null && Number.isFinite(seconds) ? seconds : null, notes, now,
      ],
    });
    out.observations++;
  }

  for (let i = 0; i < stmts.length; i += 200) await batch(stmts.slice(i, i + 200));

  out.ok = out.observations > 0;
  out.caution = out.selfObservedRows > 0 ? SELF_OBSERVED_CAUTION : null;
  out.message = out.observations > 0
    ? `${out.observations}件の観測を記録しました（新しく追跡し始めた出品 ${out.newListings}件`
      + `／実市場データ ${out.realRows}件／商品を特定できる情報あり ${out.identifiableRows}件）。`
    : '取り込める行がありませんでした。';
  return out;
}

// ============================================================
// 集計
// ============================================================

export type ValidationProgress = {
  /** 目標100件（§5） */
  goal: number;
  /** 実市場データとして数えられた追跡中の出品 */
  realListings: number;
  /** そのうち商品を特定できるもの（§10） */
  identifiable: number;
  /** 一点物・型番不明のもの。ここばかりで100件にしない。 */
  unidentifiable: number;
  /** 積み上がった観測の総数 */
  observations: number;
  byState: Record<string, number>;
  /** 7日後まで見届けた出品 */
  done7d: number;
  /** 30日後まで見届けた出品 */
  done30d: number;
  /** 売り切れを確認できた件数 */
  confirmedSold: number;
  /** そのうち、いくらで売れたかまで分かった件数 */
  soldPriceKnown: number;
  /** 消えたが売れたか不明の件数（ここを売れた扱いにしない） */
  removedUnknown: number;
};

export async function validationProgress(goal = 100): Promise<ValidationProgress> {
  const listings = await all(
    `SELECT listing_key, real_market_data, identifiable, latest_state, sold_price_known
       FROM tracked_listings`,
  );
  const real = listings.filter((r) => Number(r.real_market_data) === 1);
  const byState: Record<string, number> = {};
  for (const r of real) {
    const s = String(r.latest_state);
    byState[s] = (byState[s] ?? 0) + 1;
  }

  const obs = await all(
    `SELECT listing_key, checkpoint FROM listing_observations WHERE real_market_data = 1`,
  );
  const cpOf = new Map<string, Set<string>>();
  for (const o of obs) {
    const k = String(o.listing_key);
    if (!cpOf.has(k)) cpOf.set(k, new Set());
    cpOf.get(k)!.add(String(o.checkpoint));
  }
  const realKeys = new Set(real.map((r) => String(r.listing_key)));
  const hasCp = (cp: string) =>
    [...realKeys].filter((k) => cpOf.get(k)?.has(cp)).length;

  return {
    goal,
    realListings: real.length,
    identifiable: real.filter((r) => Number(r.identifiable) === 1).length,
    unidentifiable: real.filter((r) => Number(r.identifiable) !== 1).length,
    observations: obs.length,
    byState,
    done7d: hasCp('D7'),
    done30d: hasCp('D30'),
    confirmedSold: real.filter((r) => String(r.latest_state) === 'CONFIRMED_SOLD').length,
    soldPriceKnown: real.filter((r) => Number(r.sold_price_known) === 1).length,
    removedUnknown: real.filter((r) => String(r.latest_state) === 'REMOVED_UNKNOWN').length,
  };
}

// ============================================================
// 送料の精度（Phase 3.7）
// ============================================================

export type ShippingAccuracy = {
  /** 追跡中の実市場の出品のうち、荷物サイズが分かっている件数 */
  withPackageSize: number;
  withShippingMethod: number;
  withPayer: number;
  withEstimate: number;
  /** 見込みと実額の両方が入っていて、比べられる件数 */
  comparable: number;
  total: number;
  /** 平均のずれ（円）。実額 − 見込み。プラスなら見込みが甘かった。 */
  avgGapYen: number | null;
  /** 見込みより高くついた件数 */
  underestimated: number;
  /** ずれの大きさの平均（円）。符号を消して測る。 */
  avgAbsGapYen: number | null;
  /** 一言。測れないときは「測れない」と言う。 */
  verdictJa: string;
};

/**
 * 見込み送料と実際の送料のずれ。
 *
 * 【0件のときに「誤差0円・精度100%」と書かない】
 * 比べられる件数が0なら「まだ比べられません」と出す（CLAUDE.md ルール35）。
 * 送料は利益のうち大きな割合を占めるので、ここを良く見せると全部が狂う。
 */
export async function shippingAccuracy(): Promise<ShippingAccuracy> {
  const rows = await all(
    `SELECT package_size, shipping_method, shipping_payer,
            estimated_shipping_cost, actual_shipping_cost
       FROM tracked_listings WHERE real_market_data = 1`,
  );
  const pairs = rows
    .filter((r) => r.estimated_shipping_cost !== null && r.actual_shipping_cost !== null)
    .map((r) => Number(r.actual_shipping_cost) - Number(r.estimated_shipping_cost));

  const avg = (xs: number[]) => (xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));

  return {
    total: rows.length,
    withPackageSize: rows.filter((r) => r.package_size !== null && r.package_size !== 'UNKNOWN').length,
    withShippingMethod: rows.filter((r) => r.shipping_method !== null && r.shipping_method !== 'UNKNOWN').length,
    withPayer: rows.filter((r) => r.shipping_payer !== null && r.shipping_payer !== 'UNKNOWN').length,
    withEstimate: rows.filter((r) => r.estimated_shipping_cost !== null).length,
    comparable: pairs.length,
    avgGapYen: avg(pairs),
    avgAbsGapYen: avg(pairs.map(Math.abs)),
    underestimated: pairs.filter((g) => g > 0).length,
    verdictJa: pairs.length === 0
      ? '見込みと実額の両方が入った出品がまだ無いため、送料の精度は測れません。'
      : `${pairs.length}件で比べたところ、平均のずれは ${avg(pairs.map(Math.abs))}円 です`
        + `（実際の方が高くついたのは ${pairs.filter((g) => g > 0).length}件）。`,
  };
}

/**
 * 次に見に行くべき出品（§6）。
 * 「そろそろ7日目です」と機械が言えないと、追跡は必ず途切れる。
 */
export type DueListing = {
  listingKey: string;
  productUrl: string;
  productName: string | null;
  checkpoint: CheckpointCode;
  checkpointJa: string;
  dueAt: string;
  overdueHours: number;
  latestState: string;
};

export async function listingsDue(now = Date.now(), limit = 50): Promise<DueListing[]> {
  const rows = await all(
    `SELECT listing_key, product_url, product_name, first_observed_at, latest_state
       FROM tracked_listings
      WHERE latest_state NOT IN ('CONFIRMED_SOLD')`,
  );
  const obs = await all('SELECT listing_key, checkpoint FROM listing_observations');
  const doneOf = new Map<string, Set<string>>();
  for (const o of obs) {
    const k = String(o.listing_key);
    if (!doneOf.has(k)) doneOf.set(k, new Set());
    doneOf.get(k)!.add(String(o.checkpoint));
  }

  const out: DueListing[] = [];
  for (const r of rows) {
    const key = String(r.listing_key);
    const start = Date.parse(String(r.first_observed_at));
    if (!Number.isFinite(start)) continue;
    const done = doneOf.get(key) ?? new Set<string>();
    for (const c of TRACK_CHECKPOINTS) {
      if (c.code === 'INITIAL' || done.has(c.code)) continue;
      const due = start + c.hours * 3600000;
      if (due > now) break; // まだ来ていない予定より先は見なくてよい
      out.push({
        listingKey: key,
        productUrl: String(r.product_url),
        productName: r.product_name === null ? null : String(r.product_name),
        checkpoint: c.code,
        checkpointJa: c.ja,
        dueAt: new Date(due).toISOString(),
        overdueHours: (now - due) / 3600000,
        latestState: String(r.latest_state),
      });
      break; // 1件につき「いま一番古い未実施の予定」だけ出す
    }
  }
  return out.sort((a, b) => b.overdueHours - a.overdueHours).slice(0, limit);
}

// ============================================================
// 人間の作業時間（§19 §20）
// ============================================================

/** 工程の一覧（`WORK_STEPS`）と日本語訳（`workStepJa`）は `lib/listing.ts` にある。 */
export async function recordWork(
  batchId: string, step: WorkStepCode | string, seconds: number, rows: number, note?: string,
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  // 知らない工程名を黙って OTHER に寄せない。寄せると「その他」だけが膨らんで何も分からなくなる。
  const s = normalizeWorkStep(step);
  if (!s) throw new Error(`工程「${step}」は登録されていません`);
  await run(
    `INSERT INTO observation_work_log (batch_id, step, seconds, rows, note, recorded_at)
     VALUES (?,?,?,?,?,?)`,
    [batchId, s, seconds, Math.max(0, Math.trunc(rows)), note ?? null, nowIso()],
  );
}

export type WorkSummary = {
  measured: boolean;
  totalSeconds: number;
  totalRows: number;
  /** 1件あたり何秒かかっているか */
  secondsPerRow: number | null;
  byStep: { step: string; ja: string; seconds: number; rows: number; secondsPerRow: number | null; share: number }[];
  /** いちばん時間を食っている工程。ここが自動化の第1候補。 */
  slowest: { step: string; ja: string; secondsPerRow: number | null } | null;
  /** 100件そろえるのに、この調子だとあと何時間かかるか */
  estimatedHoursTo100: number | null;
  note: string;
};

export async function workSummary(goal = 100, doneRows = 0): Promise<WorkSummary> {
  const raw = await all(
    `SELECT step, SUM(seconds) AS s, SUM(rows) AS r FROM observation_work_log GROUP BY step`,
  );
  /*
   * 旧い工程名（IDENTIFY / RECORD など）で記録された分を、今の6工程へ寄せてから足す。
   * 寄せずに並べると、同じ作業が2つの名前で別々に出て、割合の合計が意味を持たなくなる。
   */
  const merged = new Map<string, { s: number; r: number }>();
  for (const x of raw) {
    const k = normalizeWorkStep(String(x.step)) ?? String(x.step);
    const cur = merged.get(k) ?? { s: 0, r: 0 };
    cur.s += Number(x.s ?? 0);
    cur.r += Number(x.r ?? 0);
    merged.set(k, cur);
  }
  const rows = [...merged.entries()].map(([step, v]) => ({ step, s: v.s, r: v.r }));
  const totalSeconds = rows.reduce((a, r) => a + Number(r.s ?? 0), 0);
  const totalRows = rows.reduce((a, r) => a + Number(r.r ?? 0), 0);

  const byStep = rows.map((r) => {
    const s = Number(r.s ?? 0);
    const n = Number(r.r ?? 0);
    return {
      step: String(r.step),
      ja: workStepJa(String(r.step)),
      seconds: s,
      rows: n,
      secondsPerRow: n > 0 ? s / n : null,
      share: totalSeconds > 0 ? s / totalSeconds : 0,
    };
  }).sort((a, b) => b.seconds - a.seconds);

  if (rows.length === 0) {
    return {
      measured: false, totalSeconds: 0, totalRows: 0, secondsPerRow: null,
      byStep: [], slowest: null, estimatedHoursTo100: null,
      // 感覚で「たぶんここが重い」と書かない。測っていないなら測っていないと言う。
      note: 'まだ作業時間を1件も計測していません。どの工程を自動化すべきかは、まだ数字で言えません。',
    };
  }

  const perRow = totalRows > 0 ? totalSeconds / totalRows : null;
  const slowest = byStep.find((s) => s.secondsPerRow !== null) ?? null;
  const remaining = Math.max(0, goal - doneRows);
  return {
    measured: true,
    totalSeconds,
    totalRows,
    secondsPerRow: perRow,
    byStep,
    slowest: slowest ? { step: slowest.step, ja: slowest.ja, secondsPerRow: slowest.secondsPerRow } : null,
    estimatedHoursTo100: perRow !== null ? (perRow * remaining) / 3600 : null,
    note: slowest
      ? `いま一番時間がかかっている工程は「${slowest.ja}」（1件あたり ${Math.round(slowest.secondsPerRow ?? 0)}秒）です。`
        + '自動化を考えるなら、感覚ではなくここから手を付けるのが筋です。'
      : '工程ごとの件数が入っていないため、1件あたりの秒数を出せません。',
  };
}

/** テストデータと実データを混ぜないための確認用。 */
export async function countTracked(realOnly = true): Promise<number> {
  const r = await one(
    `SELECT COUNT(*) AS n FROM tracked_listings${realOnly ? ' WHERE real_market_data = 1' : ''}`,
  );
  return Number(r?.n ?? 0);
}

/** 記入見本（`OBSERVATION_CSV_TEMPLATE`）は `lib/listing.ts` にある。 */
