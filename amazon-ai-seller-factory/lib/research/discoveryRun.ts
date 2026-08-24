import { all, insert, nowIso } from '../db/client';
import { num } from '../env';
import type { SupplierListing } from '../types';
import {
  DISCOVERY_MODE_LABEL,
  discoveryModePlan,
  getDiscoveryProviders,
  type DiscoveryDirection,
  type DiscoveryMode,
  type DiscoverySeed,
  type SupplierDiscoveryProvider,
} from '../providers/supplierDiscovery';
import {
  discoveryLimits,
  prefilterDiscovered,
  selectForAmazonCheck,
  type DiscoveryRejectReason,
  type DiscoveryStage,
} from './discoveryFilter';
// ★探索1回ごとの「結果の種類」を必ず残す。
//   「壊れていた」を「0件でした」と表示した事故を二度と起こさないため。
import { classifyError, logDiscoveryCall, OUTCOME_LABEL } from './discoveryOutcome';

/**
 * 自動探索（Supplier Discovery）の実行部。
 *
 * ★役割：「私が商品一覧を作らなくても、システムが自分で安い商品を探してくる」を実現する。
 *
 * 順番（安い処理から。高いAI・Keepaは最後の一部だけ）
 *   1. 仕入先APIから商品候補を大量に取る（費用ゼロ or ほぼゼロ）
 *   2. 無料のルールだけで一次除外する（prefilterDiscovered）
 *   3. Amazonで見つかりそうな順に並べ、上限件数だけ次の段へ渡す（selectForAmazonCheck）
 *   4. その先（Amazon照合→Keepa→月販→利益）は既存の runResearch がやる
 *
 * ★落とした商品は理由コードつきで全部 discovery_rejections に残す。
 *   「なぜ候補が0件なのか」を後から必ず説明できるようにするため。
 */

export interface DiscoveryRunOptions {
  mode?: DiscoveryMode;
  /** 探すキーワード。無指定ならモードごとの種語を使う */
  keywords?: string[];
  category?: string | null;
  minPriceJpy?: number | null;
  maxPriceJpy?: number | null;
  /** 仕入先から取る上限（.env の MAX_DISCOVERY_ITEMS を超えない） */
  maxDiscover?: number;
  /** Amazon照合へ送る上限（.env の MAX_AMAZON_CHECKS を超えない） */
  maxAmazonChecks?: number;
  /** 探索の向き。both = 両方向 */
  direction?: DiscoveryDirection | 'BOTH';
}

export interface DiscoveryRejectionRecord {
  externalId: string | null;
  source: string | null;
  title: string | null;
  url: string | null;
  priceJpy: number | null;
  stage: DiscoveryStage;
  reasonCode: DiscoveryRejectReason;
  reasonNote: string;
}

export interface DiscoveryRunResult {
  mode: DiscoveryMode;
  direction: DiscoveryDirection | 'BOTH';
  /** Amazon照合へ渡す商品（ここから先は既存のリサーチ処理） */
  selected: SupplierListing[];
  /** 上限で今回は見送った商品（捨てたわけではない） */
  deferred: SupplierListing[];
  rejections: DiscoveryRejectionRecord[];
  /** 両方向で同じ商品にたどり着いた externalId */
  bothWays: Set<string>;
  /** どちら向きで見つけたか（externalId → 向き） */
  directionOf: Map<string, DiscoveryDirection>;
  counts: {
    discovered: number;
    prefilterPassed: number;
    selectedForAmazon: number;
  };
  providersUsed: string[];
  notes: string[];
}

/** モードの種語。キーワード未指定のときだけ使う */
function keywordsFor(mode: DiscoveryMode, given?: string[]): (string | null)[] {
  const g = (given ?? []).map((s) => s.trim()).filter(Boolean);
  if (g.length) return g;
  const seeds = discoveryModePlan(mode).seeds;
  return seeds.length ? seeds : [null];
}

/** 1つのProviderから、キーワードを順に回して集める */
async function collectFrom(
  p: SupplierDiscoveryProvider,
  mode: DiscoveryMode,
  keywords: (string | null)[],
  opts: DiscoveryRunOptions,
  remaining: number,
  notes: string[],
): Promise<SupplierListing[]> {
  const plan = discoveryModePlan(mode);
  const out: SupplierListing[] = [];
  for (const kw of keywords) {
    if (out.length >= remaining) break;
    const startedAt = Date.now();
    try {
      const got = await p.discoverProducts({
        keyword: kw,
        category: opts.category ?? null,
        minPrice: opts.minPriceJpy ?? null,
        maxPrice: opts.maxPriceJpy ?? plan.maxPriceJpy ?? null,
        limit: Math.min(50, remaining - out.length),
        mode,
        page: plan.startPage,
      });
      out.push(...got);
      // ★成功も必ず記録する。0件だったのか、そもそも呼べていないのかを後から見分けるため。
      await logDiscoveryCall({
        provider: p.name,
        direction: 'SUPPLIER_TO_AMAZON',
        query: kw,
        outcome: got.length > 0 ? 'OK' : '0_RESULTS',
        resultCount: got.length,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (e: any) {
      // ★ここが今回の事故の再発防止点。
      //   失敗を「0件」として片づけず、失敗の種類を必ず残す。
      const outcome = classifyError(e, e?.httpStatus ?? null);
      await logDiscoveryCall({
        provider: p.name,
        direction: 'SUPPLIER_TO_AMAZON',
        query: kw,
        outcome,
        note: String(e?.message ?? e).slice(0, 300),
        resultCount: 0,
        httpStatus: e?.httpStatus ?? null,
        elapsedMs: Date.now() - startedAt,
      });
      notes.push(
        `仕入先「${p.name}」の自動探索に失敗しました（${OUTCOME_LABEL[outcome]}）：` +
          `${String(e?.message ?? e).slice(0, 140)}`,
      );
      break; // 同じProviderで同じ失敗を繰り返さない
    }
  }
  return out;
}

/** Amazon→仕入先の「種」選びのしきい値（.env で変えられる） */
export function reverseSeedGate() {
  return {
    minMonthlySales: num('REVERSE_SEED_MIN_MONTHLY_SALES', 10),
    maxSellers: num('REVERSE_SEED_MAX_SELLERS', 15),
    maxPriceSwingPct: num('REVERSE_SEED_MAX_PRICE_SWING_PCT', 20),
  };
}

export interface ReverseSeed extends DiscoverySeed {
  asin: string | null;
  /** Amazon側の1枚目の画像。公式の画像検索へ渡す種になる */
  imageUrl: string | null;
  amazonPriceJpy: number | null;
  monthlySales: number;
  /** 価格の振れ幅（%）。両方の平均価格が取れた時だけ数値。取れなければ null＝不明 */
  priceSwingPct: number | null;
}

/**
 * Amazon→仕入先の逆方向の「種」を選ぶ。★これが本命の入口。
 *
 * ユーザー指示（2026-08-20）：
 *   「Keepaで 月販10件以上・価格が安定・Amazon本体が売っていない・競合が少なめ を
 *     先に絞り、上位商品だけをSupplier Discoveryへ送ってください。」
 *
 * ★ここで落とした商品も、必ず理由コードつきで返す（0件の理由を説明できるようにする）。
 * ★不明（NULL）を「良い方」に丸めない。月販が取れていないものは種にしない。
 *
 * ★2026-08-20 修正：以前の実装は research_candidates に存在しない
 *   brand / model_number / gtin 列を SELECT していたため、SQLが必ず失敗し、
 *   catch で握りつぶして**常に0件**を返していた（逆方向は一度も動いていなかった）。
 *   仕入先の属性は supplier_listings 側にあるので、そこから結合して取る。
 */
async function seedsFromAmazon(
  limit: number,
  rejections: DiscoveryRejectionRecord[],
  notes: string[],
): Promise<ReverseSeed[]> {
  if (limit <= 0) return [];
  const gate = reverseSeedGate();

  let rows: any[];
  try {
    rows = await all(
      `SELECT rc.asin              AS asin,
              rc.amazon_title      AS amazon_title,
              rc.amazon_image      AS amazon_image,
              rc.amazon_price_jpy  AS amazon_price_jpy,
              rc.supplier_title    AS supplier_title,
              rc.category          AS category,
              rc.monthly_sales_est AS monthly_sales_est,
              rc.seller_count      AS seller_count,
              rc.amazon_selling    AS amazon_selling,
              rc.buybox_is_amazon  AS buybox_is_amazon,
              rc.avg_price_30d_jpy AS avg30,
              rc.avg_price_90d_jpy AS avg90,
              rc.live_data         AS live_data,
              sl.brand             AS brand,
              sl.model_number      AS model_number,
              sl.gtin              AS gtin
         FROM research_candidates rc
         LEFT JOIN supplier_listings sl
                ON sl.external_id = rc.listing_external_id
               AND sl.source      = rc.listing_source
        WHERE rc.asin IS NOT NULL
        ORDER BY rc.monthly_sales_est DESC, rc.created_at DESC
        LIMIT ?`,
      [Math.max(limit * 10, 50)],
    );
  } catch (e: any) {
    // ★ここが「逆検索が壊れているのに0件と表示」した事故の現場。
    //   黙って0件にせず、読めなかったことを記録にも画面にも必ず残す。
    await logDiscoveryCall({
      provider: 'reverse_seed_select',
      direction: 'AMAZON_TO_SUPPLIER',
      outcome: 'PARSE_ERROR',
      note: `種の読み出しに失敗：${String(e?.message ?? e).slice(0, 300)}`,
      resultCount: 0,
    });
    notes.push(
      `Amazon→仕入先の種を読み出せませんでした：${String(e?.message ?? e).slice(0, 160)}` +
        '（逆方向の探索は今回行いません。これは「0件」ではなく「失敗」です）',
    );
    return [];
  }

  const out: ReverseSeed[] = [];
  const seen = new Set<string>();
  let unknownSwing = 0;

  for (const r of rows) {
    const asin = r.asin ? String(r.asin) : null;
    if (asin && seen.has(asin)) continue;
    if (asin) seen.add(asin);

    const title = String(r.amazon_title ?? r.supplier_title ?? '').trim();
    const brand = r.brand ? String(r.brand) : null;
    const modelNumber = r.model_number ? String(r.model_number) : null;
    const gtin = r.gtin ? String(r.gtin) : null;
    const url = asin ? `https://www.amazon.co.jp/dp/${asin}` : null;

    const push = (reasonCode: DiscoveryRejectReason, reasonNote: string) => {
      rejections.push({
        externalId: asin,
        source: 'amazon',
        title: title || null,
        url,
        priceJpy: Number.isFinite(Number(r.amazon_price_jpy)) ? Number(r.amazon_price_jpy) : null,
        stage: 'SEED',
        reasonCode,
        reasonNote,
      });
    };

    // 手がかりが1つも無ければ探しようがない
    if (!title && !modelNumber && !gtin) {
      push('NO_SEED_KEY', '商品名・型番・JANのどれも無いため、仕入先を検索できません');
      continue;
    }

    // ① 売れているか（★不明は通さない。推測で埋めない）
    const sales = Number(r.monthly_sales_est);
    if (!Number.isFinite(sales)) {
      push('NO_SALES_DATA', '推定月販がまだ取れていないため、売れている商品と断定できません');
      continue;
    }
    if (sales < gate.minMonthlySales) {
      push('LOW_SALES', `推定月販${sales}個で、基準の${gate.minMonthlySales}個に届きません`);
      continue;
    }

    // ② Amazon本体が売っていないか
    if (Number(r.amazon_selling) === 1 || Number(r.buybox_is_amazon) === 1) {
      push('HIGH_COMPETITION', 'Amazon本体が販売中のため、価格で勝てず仕入先を探す価値が低い');
      continue;
    }

    // ③ 競合が多すぎないか（★出品者数が不明なら落とさず、後で注記する）
    const sellers = Number(r.seller_count);
    if (Number.isFinite(sellers) && sellers > gate.maxSellers) {
      push('HIGH_COMPETITION', `出品者が${sellers}人おり、基準の${gate.maxSellers}人を超えています`);
      continue;
    }

    // ④ 価格が安定しているか（30日平均と90日平均のズレ）
    const a30 = Number(r.avg30);
    const a90 = Number(r.avg90);
    let swing: number | null = null;
    if (Number.isFinite(a30) && Number.isFinite(a90) && a90 > 0) {
      swing = Math.round((Math.abs(a30 - a90) / a90) * 1000) / 10;
      if (swing > gate.maxPriceSwingPct) {
        push(
          'PRICE_UNSTABLE',
          `30日平均と90日平均の差が${swing}%あり、基準の${gate.maxPriceSwingPct}%を超えています`,
        );
        continue;
      }
    } else {
      unknownSwing++;
    }

    out.push({
      title,
      brand,
      modelNumber,
      gtin,
      category: r.category ? String(r.category) : null,
      asin,
      imageUrl: r.amazon_image ? String(r.amazon_image) : null,
      amazonPriceJpy: Number.isFinite(Number(r.amazon_price_jpy)) ? Number(r.amazon_price_jpy) : null,
      monthlySales: sales,
      priceSwingPct: swing,
    });
    if (out.length >= limit) break;
  }

  if (unknownSwing) {
    notes.push(
      `${unknownSwing}件は平均価格の履歴がまだ無いため、価格が安定しているかは「不明」のまま種にしました` +
        '（利益計算の時にあらためて確認されます）',
    );
  }
  return out;
}

export async function runDiscovery(opts: DiscoveryRunOptions = {}): Promise<DiscoveryRunResult> {
  const mode: DiscoveryMode = opts.mode ?? 'STANDARD';
  /**
   * ★2026-08-20 既定を変更：両方向を回し、**Amazon→仕入先を先に**動かす。
   *   ユーザー指示「特にBを重要視してください」「最終的にはAmazon→中国検索を主軸にする」。
   *   ただし逆方向は種（＝売れているとKeepaで確認済みの商品）が無いと動かないので、
   *   種が無い間は仕入先→Amazonが自動的に主役になる。片方が0でも黙って止まらない。
   */
  const direction = opts.direction ?? 'BOTH';
  const limits = discoveryLimits();
  const maxDiscover = Math.min(limits.maxDiscoveryItems, Math.max(1, opts.maxDiscover ?? limits.maxDiscoveryItems));
  const maxAmazonChecks = Math.min(limits.maxAmazonChecks, Math.max(1, opts.maxAmazonChecks ?? limits.maxAmazonChecks));
  const useImageSearch = limits.useImageSearch;

  const notes: string[] = [];
  const rejections: DiscoveryRejectionRecord[] = [];
  const directionOf = new Map<string, DiscoveryDirection>();
  const bothWays = new Set<string>();

  const providers = getDiscoveryProviders();
  if (!providers.length) {
    notes.push(
      '★自動探索できる仕入先が1つもありません。いまは商品を自分で探せません' +
        '（.env に仕入先APIの鍵を入れるか、Googleスプレッドシートで商品一覧を渡してください）',
    );
    return {
      mode,
      direction,
      selected: [],
      deferred: [],
      rejections,
      bothWays,
      directionOf,
      counts: { discovered: 0, prefilterPassed: 0, selectedForAmazon: 0 },
      providersUsed: [],
      notes,
    };
  }

  const plan = discoveryModePlan(mode);
  notes.push(`自動探索モード：${DISCOVERY_MODE_LABEL[mode]}（${plan.note}）`);

  // ---- 1. 集める --------------------------------------------------
  const raw: SupplierListing[] = [];
  const providersUsed: string[] = [];
  const keywords = keywordsFor(mode, opts.keywords);

  const wantForward = direction === 'SUPPLIER_TO_AMAZON' || direction === 'BOTH';
  const wantReverse = direction === 'AMAZON_TO_SUPPLIER' || direction === 'BOTH';

  /**
   * 仕入先→Amazon（Aの向き）。安い物を先に見つけて、後からAmazonで売れるか調べる。
   * ★順番が大事：本命は Amazon→仕入先（Bの向き）なので、こちらは**後**に回す。
   *   1回の取得上限（maxDiscover）を、確度の高いBの向きに先に使わせるため。
   */
  const runForward = async () => {
    for (const p of providers) {
      if (raw.length >= maxDiscover) break;
      const got = await collectFrom(p, mode, keywords, opts, maxDiscover - raw.length, notes);
      if (got.length && !providersUsed.includes(p.name)) providersUsed.push(p.name);
      for (const g of got) {
        if (directionOf.has(g.externalId)) {
          bothWays.add(g.externalId);
          continue;
        }
        directionOf.set(g.externalId, 'SUPPLIER_TO_AMAZON');
        raw.push(g);
      }
    }
  };

  if (wantReverse) {
    const gate = reverseSeedGate();
    const seedLimit = Math.max(1, Math.min(limits.maxSeeds || 20, Math.floor(maxDiscover / 5) || 1));
    const seedsBefore = rejections.length;
    const seeds = await seedsFromAmazon(seedLimit, rejections, notes);
    const seedRejected = rejections.length - seedsBefore;

    notes.push(
      `Amazon→仕入先（本命の向き）：Keepaで「月販${gate.minMonthlySales}個以上・Amazon本体が不在・` +
        `出品者${gate.maxSellers}人以下・価格の振れ${gate.maxPriceSwingPct}%以内」を満たす商品だけを種にします。` +
        `→ 種に選ばれたのは${seeds.length}件、条件に合わず外したのが${seedRejected}件です`,
    );

    if (!seeds.length) {
      notes.push(
        '★種が0件でした。まだ「売れている」とKeepaで確認できた商品がDBに無いためです' +
          '（先に仕入先→Amazonのリサーチを回すと種がたまります）。理由の内訳は下の一覧に全部残っています',
      );
    }

    for (const seed of seeds) {
      if (raw.length >= maxDiscover) break;
      const perSeed = Math.min(limits.maxExpandPerSeed || 10, maxDiscover - raw.length);
      let foundForSeed = 0;

      const take = (got: SupplierListing[], via: string) => {
        if (got.length && !providersUsed.includes(via)) providersUsed.push(via);
        for (const g of got) {
          if (directionOf.has(g.externalId)) {
            // 両方向から同じ商品に届いた＝確度が高い
            bothWays.add(g.externalId);
            continue;
          }
          directionOf.set(g.externalId, 'AMAZON_TO_SUPPLIER');
          // どのAmazon商品の種から来たのかを必ず残す（後で答え合わせできるように）
          g.attributes = { ...(g.attributes ?? {}), seedAsin: seed.asin ?? undefined };
          raw.push(g);
          foundForSeed++;
        }
      };

      for (const p of providers) {
        if (raw.length >= maxDiscover) break;

        // ①-a 公式の画像検索が使えるなら、まず画像で探す（同一商品の精度がいちばん高い）
        if (p.findByImage && seed.imageUrl && useImageSearch) {
          const startedAt = Date.now();
          try {
            const got = await p.findByImage(seed.imageUrl, perSeed);
            take(got, p.name);
            await logDiscoveryCall({
              provider: p.name,
              apiName: 'image_search',
              direction: 'AMAZON_TO_SUPPLIER',
              query: seed.asin ?? seed.title.slice(0, 60),
              outcome: got.length > 0 ? 'OK' : 'NO_MATCH',
              resultCount: got.length,
              elapsedMs: Date.now() - startedAt,
            });
          } catch (e: any) {
            const outcome = classifyError(e, e?.httpStatus ?? null);
            await logDiscoveryCall({
              provider: p.name,
              apiName: 'image_search',
              direction: 'AMAZON_TO_SUPPLIER',
              query: seed.asin ?? seed.title.slice(0, 60),
              outcome,
              note: String(e?.message ?? e).slice(0, 300),
              resultCount: 0,
              httpStatus: e?.httpStatus ?? null,
              elapsedMs: Date.now() - startedAt,
            });
            notes.push(
              `「${p.name}」の画像検索に失敗しました（${OUTCOME_LABEL[outcome]}）：` +
                `${String(e?.message ?? e).slice(0, 140)}（商品名・型番での検索に切り替えます）`,
            );
          }
        }
        if (raw.length >= maxDiscover) break;

        // ①-b 商品名・型番・JANで探す
        if (p.findBySeed) {
          const startedAt = Date.now();
          try {
            const got = await p.findBySeed(seed, Math.min(perSeed, maxDiscover - raw.length));
            take(got, p.name);
            // ★成功も記録する。「探したが同じ商品が無かった」のか
            //   「そもそも1回も呼べていない」のかを、後から必ず見分けられるようにする。
            await logDiscoveryCall({
              provider: p.name,
              direction: 'AMAZON_TO_SUPPLIER',
              query: seed.modelNumber || seed.title.slice(0, 60),
              outcome: got.length > 0 ? 'OK' : 'NO_MATCH',
              resultCount: got.length,
              elapsedMs: Date.now() - startedAt,
            });
          } catch (e: any) {
            // ★黙って0件にしない。失敗の種類を必ず残す。
            const outcome = classifyError(e, e?.httpStatus ?? null);
            await logDiscoveryCall({
              provider: p.name,
              direction: 'AMAZON_TO_SUPPLIER',
              query: seed.modelNumber || seed.title.slice(0, 60),
              outcome,
              note: String(e?.message ?? e).slice(0, 300),
              resultCount: 0,
              httpStatus: e?.httpStatus ?? null,
              elapsedMs: Date.now() - startedAt,
            });
            notes.push(
              `「${p.name}」でAmazon商品「${seed.title.slice(0, 30)}」の仕入先を探せませんでした` +
                `（${OUTCOME_LABEL[outcome]}）：${String(e?.message ?? e).slice(0, 140)}`,
            );
          }
        }
      }

      if (!foundForSeed) {
        rejections.push({
          externalId: seed.asin,
          source: 'amazon',
          title: seed.title || null,
          url: seed.asin ? `https://www.amazon.co.jp/dp/${seed.asin}` : null,
          priceJpy: seed.amazonPriceJpy,
          stage: 'SEED',
          reasonCode: 'NO_AMAZON_MATCH',
          reasonNote: '売れている商品だが、いまつながっている仕入先には同じ物が見つかりませんでした',
        });
      }
    }

  }

  // ★本命（Amazon→仕入先）で予算を使い切らなかった分だけ、仕入先→Amazonで埋める
  if (wantForward) {
    const before = raw.length;
    await runForward();
    if (wantReverse) {
      notes.push(`仕入先→Amazon（安い物から探す向き）で、残り枠に${raw.length - before}件を追加しました`);
    }
  }

  if (bothWays.size) {
    notes.push(`${bothWays.size}件は仕入先→Amazon・Amazon→仕入先の両方向で見つかりました（確度が高い候補です）`);
  }

  notes.push(`仕入先から${raw.length}件を自動で見つけました（1回の上限${maxDiscover}件）`);

  // ---- 2. 無料ルールで一次除外 --------------------------------------
  const pre = prefilterDiscovered(raw, {
    mode,
    minPriceJpy: opts.minPriceJpy ?? null,
    maxPriceJpy: opts.maxPriceJpy ?? null,
  });
  for (const r of pre.rejected) {
    rejections.push({
      externalId: r.listing.externalId ?? null,
      source: r.listing.source ?? null,
      title: r.listing.title ?? null,
      url: r.listing.url ?? null,
      priceJpy: Number.isFinite(r.listing.unitPriceJpy) ? r.listing.unitPriceJpy : null,
      stage: 'PREFILTER',
      reasonCode: r.reason,
      reasonNote: r.note,
    });
  }
  notes.push(`無料のルールだけで${pre.rejected.length}件を先に外し、${pre.passed.length}件が残りました（この時点でAI費用は0円）`);

  // ---- 3. Amazon照合へ送る分を絞る ----------------------------------
  const sel = selectForAmazonCheck(pre.passed, maxAmazonChecks);
  for (const d of sel.deferred) {
    rejections.push({
      externalId: d.externalId ?? null,
      source: d.source ?? null,
      title: d.title ?? null,
      url: d.url ?? null,
      priceJpy: Number.isFinite(d.unitPriceJpy) ? d.unitPriceJpy : null,
      stage: 'SELECT',
      reasonCode: 'OVER_API_BUDGET',
      reasonNote: `1回の上限（Amazon照合${maxAmazonChecks}件）に収まらなかったため今回は見送りました`,
    });
  }
  if (sel.deferred.length) {
    notes.push(
      `Amazonで照合するのは${sel.selected.length}件だけにしました` +
        `（残り${sel.deferred.length}件は次回。Keepaを無駄打ちしないためです）`,
    );
  }

  return {
    mode,
    direction,
    selected: sel.selected,
    deferred: sel.deferred,
    rejections,
    bothWays,
    directionOf,
    counts: {
      discovered: raw.length,
      prefilterPassed: pre.passed.length,
      selectedForAmazon: sel.selected.length,
    },
    providersUsed,
    notes,
  };
}

/** 落とした理由をDBへ保存する（改善分析用） */
export async function saveDiscoveryRejections(runId: string, list: DiscoveryRejectionRecord[]): Promise<void> {
  const at = nowIso();
  for (const r of list) {
    try {
      await insert('discovery_rejections', {
        run_id: runId,
        external_id: r.externalId,
        source: r.source,
        title: r.title ? String(r.title).slice(0, 300) : null,
        url: r.url,
        price_jpy: r.priceJpy,
        stage: r.stage,
        reason_code: r.reasonCode,
        reason_note: r.reasonNote ? String(r.reasonNote).slice(0, 300) : null,
        created_at: at,
      });
    } catch {
      /* 記録の失敗で本流を止めない */
    }
  }
}

/** 画面用：直近の実行で、どの理由で何件落ちたか */
export async function discoveryRejectionSummary(runId: string): Promise<
  { stage: string; reasonCode: string; count: number }[]
> {
  try {
    const rows = await all(
      `SELECT stage, reason_code, COUNT(*) AS c
         FROM discovery_rejections
        WHERE run_id = ?
        GROUP BY stage, reason_code
        ORDER BY c DESC`,
      [runId],
    );
    return rows.map((r: any) => ({
      stage: String(r.stage),
      reasonCode: String(r.reason_code),
      count: Number(r.c ?? 0),
    }));
  } catch {
    return [];
  }
}
