import { all, nowIso, one, run } from './db/client';
import {
  canOpenPurchasePage, checkProductUrl, isUrlSource, isUrlStatus,
  outcomeIsSevere, outcomeNeedsNote,
  type PurchaseOutcome, type UrlSource, type UrlStatus,
} from './producturl';

/**
 * 「購入ページを開く」導線（Phase 3.9・ユーザー指示2〜4 12 14 15 16）。
 *
 * 【このファイルがやらないこと】
 * 商品を買わない。注文しない。決済しない。ログインしない。
 * 商品ページへ通信もしない（`fetch` を1回も呼ばない）。
 *
 * ユーザー指示4：
 * > AIは 購入ボタンを押す・注文確定・決済・ログイン操作 をまだ行いません。
 *
 * ここにあるのは次の3つだけ。
 *   1. 押してよいURLかどうかを確かめる
 *   2. 人が押した事実と、そのときのAIの判断を凍結して残す
 *   3. 人が「どうだったか」を報告した内容を受け取る
 */

/* ===================== 画面に出す仕入候補 ===================== */

export type BuyOpportunityRow = {
  listingKey: string;
  venueCode: string;
  productName: string | null;
  productUrl: string;
  imageUrl: string | null;
  urlSource: UrlSource;
  urlStatus: UrlStatus;
  urlVerifiedAt: string | null;
  /** 出品価格。分からないときは null（0にしない）。 */
  listingPrice: number | null;
  identityKey: string | null;
  /** 機械が同じ商品だと判定したものに、人が「違う商品だった」と答えているか。 */
  hasIncorrectMatch: boolean;
  /** すでに「購入ページを開く」を押したことがあるか。 */
  openCount: number;
  /** 押せるか（URL_STATUS が ACTIVE のときだけ） */
  canOpen: boolean;
};

/**
 * BUY OPPORTUNITIES に出す候補。
 *
 * 【いまは Route を繋いでいない（正直に書く）】
 * `arbitrage_routes` は仕入先商品（supplier_product_id）が起点で、
 * 実市場の出品1件が起点になっていない。つまり
 * 「この1件の出品を、この価格で買ったらいくら儲かるか」という形の計算がまだ無い。
 * だから利益・ROI・Route Score は、いまは出せない。
 *
 * ここで**それらしい数字を作らない。** 作れば画面は立派になるが、
 * 根拠の無い利益額を見て人が現金を出すことになる。
 * 繋ぎ込みは、実出品を仕入候補として扱う変換層を入れてから行う。
 */
export async function buyOpportunities(limit = 100): Promise<BuyOpportunityRow[]> {
  const rows = await all(
    `SELECT listing_key, venue_code, product_name, product_url, image_url,
            url_source, url_status, url_verified_at,
            latest_listing_price, first_listing_price, identity_key
       FROM tracked_listings
      WHERE real_market_data = 1
      ORDER BY updated_at DESC
      LIMIT ?`,
    [limit],
  );
  if (rows.length === 0) return [];

  const bad = await all(
    `SELECT DISTINCT listing_key FROM identity_match_reviews WHERE verdict = 'INCORRECT_MATCH'`,
  );
  const badKeys = new Set(bad.map((r) => String(r.listing_key)));

  const opens = await all(
    `SELECT listing_key, COUNT(*) AS n FROM page_open_events GROUP BY listing_key`,
  );
  const openCounts = new Map(opens.map((r) => [String(r.listing_key), Number(r.n)]));

  return rows.map((r) => {
    const status = (isUrlStatus(String(r.url_status)) ? String(r.url_status) : 'UNKNOWN') as UrlStatus;
    const key = String(r.listing_key);
    const price = r.latest_listing_price ?? r.first_listing_price;
    return {
      listingKey: key,
      venueCode: String(r.venue_code),
      productName: r.product_name === null ? null : String(r.product_name),
      productUrl: String(r.product_url),
      imageUrl: r.image_url === null || r.image_url === undefined ? null : String(r.image_url),
      urlSource: (isUrlSource(String(r.url_source)) ? String(r.url_source) : 'HUMAN_ENTRY') as UrlSource,
      urlStatus: status,
      urlVerifiedAt: r.url_verified_at === null || r.url_verified_at === undefined ? null : String(r.url_verified_at),
      listingPrice: price === null || price === undefined ? null : Number(price),
      identityKey: r.identity_key === null || r.identity_key === undefined ? null : String(r.identity_key),
      hasIncorrectMatch: badKeys.has(key),
      openCount: openCounts.get(key) ?? 0,
      canOpen: canOpenPurchasePage(status) && !badKeys.has(key),
    };
  });
}

/* ===================== URLの状態を人が更新する ===================== */

export type SimpleResult = { ok: boolean; message: string };

/**
 * 商品ページの状態を人が記録する。
 *
 * 【機械が勝手に決めない】
 * このシステムは商品ページへ通信しない。だから「いま生きているか」は人が見るしかない。
 * 見ていないものを ACTIVE にしない。
 */
export async function setUrlStatus(
  listingKey: string, status: string, verifiedBy = 'human',
): Promise<SimpleResult> {
  if (!isUrlStatus(status)) return { ok: false, message: '状態の指定が正しくありません。' };

  const row = await one(
    `SELECT listing_key, venue_code, product_url FROM tracked_listings WHERE listing_key = ?`,
    [listingKey],
  );
  if (!row) return { ok: false, message: 'その出品は登録されていません。' };

  // 状態を ACTIVE にするときだけ、URLそのものをもう一度確かめる。
  // 「押してよい」と印を付ける瞬間が、いちばん間違えてはいけないところ。
  if (status === 'ACTIVE') {
    const c = checkProductUrl(String(row.venue_code), String(row.product_url));
    if (!c.ok) {
      return { ok: false, message: `このURLは「出品中」にできません。${c.messageJa}` };
    }
  }

  await run(
    `UPDATE tracked_listings SET url_status = ?, url_verified_at = ?, updated_at = ? WHERE listing_key = ?`,
    [status, nowIso(), nowIso(), listingKey],
  );
  void verifiedBy;
  return { ok: true, message: '商品ページの状態を記録しました。' };
}

/* ===================== 開いた記録 ===================== */

export type OpenResult = SimpleResult & { openId?: number; url?: string };

/**
 * 人が「購入ページを開く」を押した記録を残す（ユーザー指示15）。
 *
 * 【この関数はページを開かない】
 * 実際にページを開くのは、画面上の普通のリンク（`target="_blank"`）である。
 * ここでやるのは記録だけ。AIはURLへ一度も触れない。
 *
 * 【押した時点の判断を凍結する】
 * あとから相場が動いても、この行は書き換えない。
 * 書き換えると「押したときAIは何と言っていたか」が消え、
 * AIの判断が当たっていたのかを永久に測れなくなる。
 */
export async function recordPageOpen(listingKey: string): Promise<OpenResult> {
  const row = await one(
    `SELECT listing_key, venue_code, product_url, url_source, url_status,
            latest_listing_price, first_listing_price
       FROM tracked_listings WHERE listing_key = ?`,
    [listingKey],
  );
  if (!row) return { ok: false, message: 'その出品は登録されていません。' };

  const status = (isUrlStatus(String(row.url_status)) ? String(row.url_status) : 'UNKNOWN') as UrlStatus;
  if (!canOpenPurchasePage(status)) {
    return { ok: false, message: 'この商品ページは開けません。まず「出品中」であることを確認してください。' };
  }

  // 押す直前にもう一度URLを確かめる。登録後に市場コードが変わっている場合を弾く。
  const c = checkProductUrl(String(row.venue_code), String(row.product_url));
  if (!c.ok) return { ok: false, message: `この商品URLは開けません。${c.messageJa}` };

  // 「違う商品だった」と人が答えている出品は開かせない。
  // 一度取り違えが分かっているものを、もう一度押させる理由が無い。
  const badn = await one(
    `SELECT COUNT(*) AS n FROM identity_match_reviews
      WHERE listing_key = ? AND verdict = 'INCORRECT_MATCH'`,
    [listingKey],
  );
  if (Number(badn?.n ?? 0) > 0) {
    return { ok: false, message: 'この出品は「違う商品だった」と記録されています。開けません。' };
  }

  const now = nowIso();
  const price = row.latest_listing_price ?? row.first_listing_price ?? null;
  const res = await run(
    `INSERT INTO page_open_events
       (listing_key, venue_code, product_url, url_source, url_status_at_open, opened_at,
        opened_price, opened_decision, opened_expected_profit, opened_route_score, opened_route_id,
        outcome, outcome_at, outcome_note, created_at)
     VALUES (?,?,?,?,?,?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
    [
      listingKey, String(row.venue_code), String(row.product_url),
      String(row.url_source), status, now,
      price === null ? null : Number(price), now,
    ],
  );

  return {
    ok: true,
    message: '購入ページを開いた記録を残しました。実際に買うかどうかは、商品ページでご自身が判断してください。',
    openId: Number(res.lastInsertRowid),
    url: String(row.product_url),
  };
}

/* ===================== 開いたあとの報告（5択） ===================== */

export type OutcomeInput = {
  openId: number;
  outcome: PurchaseOutcome;
  note: string;
  /** 「購入した」を選んだときだけ使う。 */
  actualPrice?: number | null;
  actualShipping?: number | null;
  purchasedAt?: string | null;
};

/**
 * 開いた結果を記録する（ユーザー指示15 16）。
 *
 * 【「違う商品だった」は理由が必須】
 * Phase 3.8 の同一商品判定と同じ扱い。理由が残らないと、次に同じ取り違えを防げない。
 * そして取り違えは、画面上でいちばん儲かって見えるものに起きる。
 *
 * 【「購入した」でも、このシステムは買っていない】
 * 人が自分で買ったあとの報告を受け取るだけ。入力は実購入価格・実送料・購入日時の3つ。
 */
export async function recordOpenOutcome(i: OutcomeInput): Promise<SimpleResult> {
  const row = await one(
    `SELECT id, listing_key, venue_code, product_url, outcome
       FROM page_open_events WHERE id = ?`,
    [i.openId],
  );
  if (!row) return { ok: false, message: 'その記録が見つかりません。' };

  const note = String(i.note ?? '').trim();
  if (outcomeNeedsNote(i.outcome) && note === '') {
    return {
      ok: false,
      message: '「違う商品だった」を選んだときは、何が違ったのかを必ず書いてください。'
        + '（色違い／サイズ違い／年式違い／国内版と海外版／セット品と単品 など）',
    };
  }

  const now = nowIso();

  if (i.outcome === 'PURCHASED') {
    const price = Number(i.actualPrice ?? NaN);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, message: '実際に支払った購入価格を入れてください。' };
    }
    const at = String(i.purchasedAt ?? '').trim() || now;
    const ship = i.actualShipping === null || i.actualShipping === undefined || i.actualShipping === ('' as unknown)
      ? null
      : Number(i.actualShipping);
    if (ship !== null && (!Number.isFinite(ship) || ship < 0)) {
      return { ok: false, message: '送料の入れ方が正しくありません。分からないときは空欄のままにしてください。' };
    }

    await run(
      `INSERT INTO real_trade_candidates
         (open_id, listing_key, venue_code, product_url,
          actual_purchase_price, actual_shipping_cost, purchased_at, note, created_at)
       VALUES (?,?,?,?, ?,?,?,?, ?)
       ON CONFLICT(open_id) DO UPDATE SET
         actual_purchase_price = excluded.actual_purchase_price,
         actual_shipping_cost  = excluded.actual_shipping_cost,
         purchased_at          = excluded.purchased_at,
         note                  = excluded.note`,
      [
        i.openId, String(row.listing_key), String(row.venue_code), String(row.product_url),
        Math.round(price), ship === null ? null : Math.round(ship), at, note || null, now,
      ],
    );
  }

  await run(
    `UPDATE page_open_events SET outcome = ?, outcome_at = ?, outcome_note = ? WHERE id = ?`,
    [i.outcome, now, note || null, i.openId],
  );

  // 「違う商品だった」は、機械の判定を人が否定したのと同じ意味を持つ。
  // ここでは tracked_listings.identity_key を**書き換えない**（Phase 3.8 のルール）。
  // 書き換えると「機械が何回間違えたか」が数えられなくなる。
  if (i.outcome === 'DIFFERENT_ITEM') {
    return {
      ok: true,
      message: '記録しました。取り違えは重大な結果として数えます。'
        + '（1件でもあると、次の段階へは進みません）',
    };
  }
  if (i.outcome === 'SOLD_OUT' || i.outcome === 'PRICE_CHANGED') {
    return { ok: true, message: '記録しました。データの鮮度を測る材料として使います。' };
  }
  return { ok: true, message: '記録しました。' };
}

/* ===================== 集計 ===================== */

export type PurchaseLinkSummary = {
  opened: number;
  answered: number;
  byOutcome: Record<string, number>;
  severeCount: number;
  purchasedCount: number;
  openableNow: number;
  /** 状態が未確認のまま残っている出品の件数。 */
  unknownStatus: number;
  verdictJa: string;
};

export async function purchaseLinkSummary(): Promise<PurchaseLinkSummary> {
  const total = Number((await one(`SELECT COUNT(*) AS n FROM page_open_events`))?.n ?? 0);
  const rows = await all(
    `SELECT outcome, COUNT(*) AS n FROM page_open_events WHERE outcome IS NOT NULL GROUP BY outcome`,
  );
  const byOutcome: Record<string, number> = {};
  let answered = 0;
  let severeCount = 0;
  for (const r of rows) {
    const code = String(r.outcome);
    const n = Number(r.n);
    byOutcome[code] = n;
    answered += n;
    if (outcomeIsSevere(code as PurchaseOutcome)) severeCount += n;
  }

  const purchasedCount = Number(
    (await one(`SELECT COUNT(*) AS n FROM real_trade_candidates`))?.n ?? 0,
  );
  const openableNow = Number(
    (await one(
      `SELECT COUNT(*) AS n FROM tracked_listings WHERE real_market_data = 1 AND url_status = 'ACTIVE'`,
    ))?.n ?? 0,
  );
  const unknownStatus = Number(
    (await one(
      `SELECT COUNT(*) AS n FROM tracked_listings WHERE real_market_data = 1 AND url_status = 'UNKNOWN'`,
    ))?.n ?? 0,
  );

  let verdictJa: string;
  if (total === 0) {
    verdictJa = 'まだ「購入ページを開く」を1回も押していません。'
      + '押した記録が貯まると、AIの判断が実際に合っていたかを数えられるようになります。';
  } else if (severeCount > 0) {
    verdictJa = `違う商品だったものが ${severeCount}件 あります。`
      + '取り違えは実際に現金を失う間違いです。次の段階へは進みません。';
  } else if (answered < total) {
    verdictJa = `開いた ${total}件 のうち、${total - answered}件 がまだ結果未記入です。`
      + '結果が入らないと、AIの判断が合っていたかを数えられません。';
  } else {
    verdictJa = `開いた ${total}件 すべてに結果が入っています。取り違えは0件です。`;
  }

  return {
    opened: total, answered, byOutcome, severeCount, purchasedCount,
    openableNow, unknownStatus, verdictJa,
  };
}

/** 結果がまだ入っていない「開いた記録」。画面で選ばせる。 */
export async function openWithoutOutcome(limit = 50) {
  return all(
    `SELECT o.id, o.listing_key, o.opened_at, o.opened_price, o.venue_code,
            t.product_name
       FROM page_open_events o
       LEFT JOIN tracked_listings t ON t.listing_key = o.listing_key
      WHERE o.outcome IS NULL
      ORDER BY o.opened_at DESC
      LIMIT ?`,
    [limit],
  );
}
